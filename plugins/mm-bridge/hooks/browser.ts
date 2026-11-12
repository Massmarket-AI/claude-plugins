// Pure "Working manually in browser" logic for the Massmarket bridge (0.7.53): no `$`, so tests can call it directly.
//
// Rob approved the design on 2026-11-11 ("You're good to go on all those recommendations"). The time tracker records a client for
// each browser minute (the HighLevel sub-account on screen, the Gmail thread, the Drive doc, the Meta ad account, the client's own
// site; the thread nearby as a low-confidence guess). OW's `GET /api/ext/browser-now` turns the last minutes into:
//   - LINES: someone active on a client's pages in the last 15 minutes, the site and the page title. The pane draws each beside that
//     client's thread (under its row in the list, else in one short block), tagged `no thread` when no Claude Code thread of that
//     person ran for that client in that stretch;
//   - the QUESTION: about 10 active minutes in a 20-minute stretch with no client (or more than one) and no thread covering it. One
//     tap answers it: the likely clients, then Internal, then Personal (`POST /api/ext/browser-answer`). OW asks at most once an hour
//     and 3 times a day, one open at a time, and never Rob; the first Personal of the day suggests a separate Chrome profile;
//   - the END-OF-DAY LIST: from 4 PM New York, today's stretches still unanswered, in a fold that stays closed until opened, never an
//     interruption.
// ⛔ Each person sees only their own lines and questions; Rob sees everyone's lines. OW decides who sees what; the bridge draws what
// OW answered for this token, and keeps it on this computer only.
// ⛔ Drawn only: a site, a title and a client name are the person's or OW's text, one line each (`shownText`). Nothing here goes to
// Claude, and no URL is ever kept or drawn.

import type { MmBrowserAsk, MmBrowserChoice, MmBrowserLine } from '../types'

import { isUuid, shortName, shownText } from './queue'

/** At most this many lines are kept from one read. */
const LINES_MAX = 40
/** At most this many stretches on the end-of-day list. */
const CONFIRM_MAX = 12
/** At most this many choices on a question (OW offers 3). */
const CHOICES_MAX = 3

/** What the bridge keeps of one read of OW's `browser-now`. */
export type BrowserRead = {
  founder: boolean
  lines: MmBrowserLine[]
  question: MmBrowserAsk | null
  confirm: MmBrowserAsk[]
}

const SITE = /^[a-z0-9.-]{1,253}$/

function site(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return SITE.test(s) ? s : ''
}

function time(raw: unknown): number {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isFinite(t) ? t : NaN
}

function choicesOf(raw: unknown): MmBrowserChoice[] {
  if (!Array.isArray(raw)) return []
  const out: MmBrowserChoice[] = []
  for (const c of raw.slice(0, CHOICES_MAX) as Array<{ project_id?: unknown; client?: unknown } | null>) {
    if (!c || !isUuid(c.project_id) || out.some(o => o.projectId === c.project_id)) continue
    const client = shortName(shownText(c.client, 120))
    if (client) out.push({ projectId: c.project_id as string, client })
  }
  return out
}

function askOf(raw: unknown): MmBrowserAsk | null {
  const q = raw as { id?: unknown; stretch_start?: unknown; stretch_end?: unknown; minutes?: unknown; site?: unknown; title?: unknown; choices?: unknown } | null
  if (!q || typeof q !== 'object' || !isUuid(q.id)) return null
  const from = time(q.stretch_start)
  const to = time(q.stretch_end)
  const s = site(q.site)
  if (!Number.isFinite(from) || !Number.isFinite(to) || !s) return null
  const minutes = Number(q.minutes)
  return {
    id: q.id as string,
    from,
    to,
    minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
    site: s,
    title: shownText(q.title, 80),
    choices: choicesOf(q.choices),
  }
}

/** OW's answer, checked field by field; null for an answer that is not one. */
export function parseBrowserNow(raw: unknown): BrowserRead | null {
  const o = raw as { ok?: unknown; viewer?: { founder?: unknown } | null; lines?: unknown; question?: unknown; confirm?: unknown } | null
  if (!o || typeof o !== 'object' || o.ok !== true || !Array.isArray(o.lines)) return null
  const founder = o.viewer?.founder === true
  const lines: MmBrowserLine[] = []
  for (const l of o.lines.slice(0, LINES_MAX) as Array<Record<string, unknown> | null>) {
    if (!l || typeof l !== 'object' || !isUuid(l.project_id)) continue
    const client = shortName(shownText(l.client, 120))
    const s = site(l.site)
    const lastAt = time(l.last_at)
    if (!client || !s || !Number.isFinite(lastAt)) continue
    const minutes = Number(l.minutes)
    const me = l.me === true
    lines.push({
      projectId: l.project_id as string,
      client,
      site: s,
      title: shownText(l.title, 80),
      lastAt,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0,
      noThread: l.no_thread === true,
      // a name only in the founder's view, and never on the viewer's own line
      member: founder && !me ? shownText(l.member, 40) || null : null,
      me,
    })
  }
  // ⛔ Never Rob: whatever OW said, the founder's pane asks nothing.
  const question = founder ? null : askOf(o.question)
  const confirm = founder || !Array.isArray(o.confirm) ? [] : (o.confirm.slice(0, CONFIRM_MAX).map(askOf).filter(Boolean) as MmBrowserAsk[])
  return { founder, lines, question, confirm: confirm.filter(q => q.id !== question?.id) }
}

/** The read with the questions this computer has answered left out (the answer is in OW; the next read agrees). */
export function withoutAnswered(read: BrowserRead, answered: ReadonlySet<string>): BrowserRead {
  return {
    ...read,
    question: read.question && !answered.has(read.question.id) ? read.question : null,
    confirm: read.confirm.filter(q => !answered.has(q.id)),
  }
}

// ---------------------------------------------------------------- the words

/** The block of lines whose client has no row in the list. */
export const BROWSER_HEADING = 'Working manually in browser'
/** The question's heading. */
export const ASK_HEADING = 'Needs a client'
export const ANSWER_INTERNAL = 'Internal'
export const ANSWER_PERSONAL = 'Personal'
/** On the question and each end-of-day stretch while its answer flies. */
export const SAVING = 'Saving…'
/** The first Personal of the day. */
export const PROFILE_TIP = 'Tip: a separate Chrome profile for personal browsing keeps it out of the tracker.'
/** Under the end-of-day list's heading. */
export const CONFIRM_NOTE = 'Browser time with no client yet. One tap each.'

/** The site and the title, one line: `app.gohighlevel.com · Workflows`. */
function page(l: { site: string; title: string }): string {
  return l.title ? `${l.site} · ${l.title}` : l.site
}

/**
 * A line under the client's own row (the client is already named there):
 * `Working manually in browser · app.gohighlevel.com · Workflows · no thread`; in the founder's view, a teammate's line starts with
 * their name: `Asif working manually in browser · …`.
 */
export function rowLineText(l: MmBrowserLine): string {
  const who = l.member ? `${l.member} working manually in browser` : BROWSER_HEADING
  return `${who} · ${page(l)}${l.noThread ? ' · no thread' : ''}`
}

/** A line in the block, which names the client: `Acme Roofing · app.gohighlevel.com · Workflows · no thread` (`Asif · Acme Roofing · …`). */
export function blockLineText(l: MmBrowserLine): string {
  return `${l.member ? `${l.member} · ` : ''}${l.client} · ${page(l)}${l.noThread ? ' · no thread' : ''}`
}

/** `14m`, `1h 5m`. */
function span(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** The question's line: `14m in the browser · plumber.example · Plumber admin`. */
export function askText(q: MmBrowserAsk): string {
  return `${q.minutes ? `${span(q.minutes)} in the browser · ` : ''}${page(q)}`
}

/** One stretch on the end-of-day list: `2:05 PM to 2:25 PM · 14m · plumber.example · Plumber admin`. */
export function confirmText(q: MmBrowserAsk, clock: (t: number) => string): string {
  return `${clock(q.from)} to ${clock(q.to)}${q.minutes ? ` · ${span(q.minutes)}` : ''} · ${page(q)}`
}

/** The end-of-day list's fold button and heading: `To confirm today (2)`. */
export function confirmHeading(n: number): string {
  return `To confirm today (${n})`
}

/** What a press saved: `Saved: Acme Roofing.`, and when it is kept for the page, ` It won't ask about plumber.example again.` */
export function savedText(label: string, learned: boolean, s: string): string {
  return `Saved: ${label}.${learned ? ` It won't ask about ${s} again.` : ''}`
}
