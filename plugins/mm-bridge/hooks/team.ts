// (0.7.34, Rob 2026-11-07) The pane's `Team now`: "a dropdown that reveals something that looks just like what we added to the
// bottom of the daily team photo", live. Pure: what OW's `GET /api/ext/team-now` answers, checked, and every word it is drawn
// with. The words of the pins are the photo's own (OW `src/lib/team-ops/morning-pins-core.ts`, PINS_COPY), kept the same on
// purpose; the 9 AM photo stays in the team thread.
//
// ⛔ WHAT IS LIVE. A row of `Working now` is a thread whose time-tracking hook wrote a tool call in the last 10 minutes and has
// not written the end of that turn (OW works it out; the hook writes in seconds). The pins are each bridge's own report, at
// most 5 minutes behind. A task assigned to someone is OW's own stamp, read directly. The bridge reads the route once a minute
// while the dropdown is open, every 5 minutes while it is closed.
// ⛔ WHAT IT CANNOT SHOW. A long silent tool call (no row until it ends), a turn that ran no tool, a thread outside a folder
// its person approved for tracking, a machine with no hook, and work in Codex. An interrupted turn writes no end, so it reads
// as working for up to 10 minutes after its last row.

import type { MmTeamItem, MmTeamPerson, MmTeamRead, MmTeamTask, MmTeamThread } from '../types'
import { businessMsBetween } from './business-time'

/** What a pin row's kind reads as (the photo's words). Anything else is shown as sent. */
const KIND: Readonly<Record<string, string>> = {
  reply: 'reply',
  ready: 'reply ready',
  ask: 'team ask',
  queue: 'internal queue',
  task: 'task',
  ok: 'needs OK',
  check: 'check on team',
  package: 'package',
  late: 'late',
  behind: 'behind',
  overbooked: 'overbooked',
  on_track: 'on track',
  needs_date: 'needs a due date',
}

/** Why a row is not pinned (the photo's words). */
const WHY_NOT: Readonly<Record<string, string>> = {
  no_thread: 'no thread',
  unseen: "can't see thread",
  person_unpinned: 'they unpinned it',
  write_cap: 'not pinned yet',
  unknown: 'not pinned',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** The most pin rows drawn for a person, as on the photo; the rest are `+N more`. */
export const TEAM_ROW_CAP = 10
/** The most tasks drawn as newly assigned for a person. */
export const TEAM_ASSIGNED_CAP = 3
/** A task assigned this recently is drawn as just moved. */
export const TEAM_JUST_MOVED_MS = 15 * MINUTE
/** A report this old or newer reads `as of <time>`, as on the photo. */
const FRESH_REPORT_MS = 3 * HOUR
const NY = 'America/New_York'

export type TeamTone = MmTeamItem['tone']
export type TeamItem = MmTeamItem
export type TeamThread = MmTeamThread
export type TeamTask = MmTeamTask
export type TeamPerson = MmTeamPerson
export type TeamNow = MmTeamRead

/** One line of the dropdown. `person`: a person's heading. */
export type TeamLine = { text: string; bold?: boolean; dim?: boolean; color?: 'error' | 'warning' | 'success'; person?: boolean }

const when = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : null
}
const text = (v: unknown, max = 80): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}
/** A client's name for one line: what comes before ` — ` or ` - ` (`Sonya Vicars — AI Receptionist for Movers` reads `Sonya Vicars`). */
const shortClient = (v: unknown): string | null => {
  const t = text(v)
  return t ? (t.split(/\s[—–-]\s/)[0] as string).trim() || t : null
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** OW's answer, checked: a row of another shape is dropped, an answer of another shape is null. */
export function teamFrom(raw: unknown): TeamNow | null {
  const o = obj(raw)
  const at = when(o?.at)
  if (!o || o.ok !== true || at === null || !Array.isArray(o.people)) return null
  const people: TeamPerson[] = []
  for (const r of o.people) {
    const p = obj(r)
    const name = text(p?.name)
    if (!p || !name) continue
    const report = obj(p.report)
    const items: TeamItem[] = []
    for (const i of list(report?.items)) {
      const it = obj(i)
      const client = shortClient(it?.client)
      const tone = it?.tone
      if (!it || !client || (tone !== 'red' && tone !== 'yellow' && tone !== 'green')) continue
      items.push({ client, kind: text(it.kind, 16) ?? 'task', tone, dueAt: when(it.due_at), pinned: it.pinned === true, whyNot: text(it.why_not, 24) })
    }
    const running: TeamThread[] = []
    for (const t of list(p.running)) {
      const th = obj(t)
      const lastAt = when(th?.last_at)
      if (!th || lastAt === null) continue
      running.push({ client: shortClient(th.client), working: th.working === true, auto: th.auto === true, since: when(th.since), capped: th.since_capped === true, lastAt, task: text(th.task) })
    }
    const assigned: TeamTask[] = []
    for (const t of list(p.assigned)) {
      const a = obj(t)
      const ref = text(a?.ticket_ref, 16)
      const client = shortClient(a?.client)
      const at2 = when(a?.at)
      if (!a || !ref || !client || at2 === null) continue
      assigned.push({ ref, client, title: text(a.title), at: at2 })
    }
    people.push({
      name,
      me: p.me === true,
      reportedAt: when(report?.reported_at),
      items,
      extra: list(report?.extra).map(e => shortClient(obj(e)?.client)),
      seen: when(p.bridge_seen_at) !== null,
      running,
      assigned,
    })
  }
  return { at, partial: list(o.partial).filter((s): s is string => typeof s === 'string'), people }
}

/** Who each task on the list was last read with, and who it moved from, by its ticket ref. */
export type TeamSeen = Record<string, { to: string; from?: string }>

/**
 * Who each task assigned in the last day was with at the last read (`seen`: ticket ref to person), so a task that moved says
 * from whom. OW keeps no history of a reassignment: a task this bridge never saw with someone says nothing of where it was.
 */
export function withMoves(team: TeamNow, seen: Readonly<TeamSeen>): { team: TeamNow; seen: TeamSeen } {
  const next: TeamSeen = {}
  const people = team.people.map(p => ({
    ...p,
    assigned: p.assigned.map(a => {
      const was = seen[a.ref]
      // who it came from stays on the line while it is on the list, not for one read alone
      const from = was ? (was.to !== p.name ? was.to : was.from) : undefined
      next[a.ref] = { to: p.name, ...(from ? { from } : {}) }
      return from ? { ...a, from } : a
    }),
  }))
  return { team: { ...team, people }, seen: next }
}

/** A span in words, for how long a thread has run: `<1m`, `25m`, `2h 10m`. Real time: this is no client clock. */
export function spanWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return '<1m'
  const m = Math.floor(ms / MINUTE)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

/** The photo's span: `<1h`, `15h`, `2d`. */
const photoSpan = (ms: number): string => (!Number.isFinite(ms) || ms < HOUR ? '<1h' : ms < DAY ? `${Math.floor(ms / HOUR)}h` : `${Math.floor(ms / DAY)}d`)

function nyParts(t: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t))) out[p.type] = p.value
  return out
}
const nyClock = (t: number): string => {
  const p = nyParts(t)
  return `${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toUpperCase()}`
}
const nyWeekdayClock = (t: number): string => `${nyParts(t).weekday} ${nyClock(t)}`

const hasKey = (o: Readonly<Record<string, string>>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)
const kindWord = (kind: string): string => (hasKey(KIND, kind) ? (KIND[kind] as string) : kind)
const whyWord = (why: string | null): string => (why && hasKey(WHY_NOT, why) ? (WHY_NOT[why] as string) : (WHY_NOT.unknown as string))

/** A row's colour: red once its due time has passed, whatever the report said, else the report's (the photo's rule). */
export const itemTone = (i: Pick<TeamItem, 'tone' | 'dueAt'>, now: number): TeamTone => (i.dueAt !== null && i.dueAt <= now ? 'red' : i.tone)
const TONE_COLOR: Readonly<Record<TeamTone, 'error' | 'warning' | 'success'>> = { red: 'error', yellow: 'warning', green: 'success' }

/** `15h late` (business time: a weekend adds nothing), `due Wed 2:29 PM`, or null with no due time. */
export function itemTime(i: Pick<TeamItem, 'dueAt'>, now: number): string | null {
  if (i.dueAt === null) return null
  return i.dueAt <= now ? `${photoSpan(businessMsBetween(i.dueAt, now))} late` : `due ${nyWeekdayClock(i.dueAt)}`
}

/** How many threads are working, and how many rows should be pinned and are not, across the team. */
export const teamCounts = (team: TeamNow): { working: number; notPinned: number } => ({
  working: team.people.reduce((n, p) => n + p.running.filter(t => t.working).length, 0),
  notPinned: team.people.reduce((n, p) => n + p.items.filter(i => !i.pinned).length, 0),
})

/** The dropdown's own line: `Team now · 5 working · 2 not pinned`. */
export function teamHeadingNow(team: TeamNow | null | undefined): string {
  if (!team) return 'Team now'
  const { working, notPinned } = teamCounts(team)
  return ['Team now', ...(working ? [`${working} working`] : []), ...(notPinned ? [`${notPinned} not pinned`] : [])].join(' · ')
}

/** `<Name> · <N> to pin · <M> pinned`, `<Name> · Nothing to pin`, or the name alone with no report (the photo's words). */
function personLeft(p: TeamPerson): string {
  if (p.reportedAt === null) return p.name
  if (!p.items.length) return `${p.name} · Nothing to pin`
  return `${p.name} · ${p.items.length} to pin · ${p.items.filter(i => i.pinned).length} pinned`
}

/** `as of 8:55 AM`, or, amber on the photo, how old the report is, or that there is none. */
function personRight(p: TeamPerson, now: number): string {
  if (p.reportedAt !== null) return now - p.reportedAt <= FRESH_REPORT_MS ? `as of ${nyClock(p.reportedAt)}` : `last report ${photoSpan(now - p.reportedAt)} ago`
  return p.seen ? 'No report from this bridge' : 'No bridge yet'
}

/** A thread of `Working now`: `▶ Doug Brockbank · 25m · reply drafts`. A thread with no client said is never named: it may be personal. */
function threadLine(t: TeamThread, now: number): string {
  const span = t.since === null ? '' : `${spanWords(now - t.since)}${t.capped ? '+' : ''}`
  return `▶ ${[t.client ?? 'a thread, no client said', ...(span ? [span] : []), ...(t.task ? [t.task] : []), ...(t.auto ? ['automatic'] : [])].join(' · ')}`
}

/** A task assigned to someone in the last day: `→ New: Acme · task title · 2m ago`, `→ From H9: Acme · 2m ago`. */
function taskLine(a: TeamTask, now: number): string {
  return `→ ${a.from ? `From ${a.from}` : 'New'}: ${[a.client, ...(a.title ? [a.title] : []), `${spanWords(now - a.at)} ago`].join(' · ')}`
}

/** The dropdown, top to bottom: each person's heading, what they are working on now, what just moved to them, then their pins as the photo has them. */
export function teamLines(team: TeamNow, now: number): TeamLine[] {
  const out: TeamLine[] = []
  if (team.partial.includes('running')) out.push({ text: 'Which threads are working could not be read just now.', dim: true })
  if (team.partial.includes('assigned')) out.push({ text: 'New assignments could not be read just now.', dim: true })
  if (!team.people.length) out.push({ text: 'Nobody has reported yet.', dim: true })
  for (const p of team.people) {
    out.push({ text: `${personLeft(p)} | ${personRight(p, now)}`, bold: true, person: true })
    const working = p.running.filter(t => t.working)
    for (const t of working) out.push({ text: `  ${threadLine(t, now)}`, color: 'success' })
    if (!working.length) {
      const last = p.running.reduce((m, t) => Math.max(m, t.lastAt), 0)
      out.push({ text: last ? `  Nothing running · last active ${spanWords(now - last)} ago` : '  Nothing running', dim: true })
    }
    for (const a of p.assigned.slice(0, TEAM_ASSIGNED_CAP)) {
      const just = now - a.at <= TEAM_JUST_MOVED_MS
      out.push({ text: `  ${taskLine(a, now)}`, ...(just ? { bold: true } : { dim: true }) })
    }
    for (const i of p.items.slice(0, TEAM_ROW_CAP)) {
      const time = itemTime(i, now)
      out.push({ text: `  ${i.pinned ? '●' : '○'} ${[i.client, kindWord(i.kind), ...(time ? [time] : []), i.pinned ? 'pinned' : whyWord(i.whyNot)].join(' · ')}`, color: TONE_COLOR[itemTone(i, now)] })
    }
    if (p.items.length > TEAM_ROW_CAP) out.push({ text: `  +${p.items.length - TEAM_ROW_CAP} more`, dim: true })
    if (p.extra.length) out.push({ text: `  Also pinned with nothing due: ${p.extra.map(c => c ?? 'a thread').join(', ')}`, dim: true })
  }
  out.push({ text: `▶ working now   ● pinned   ○ not pinned · as of ${nyClock(team.at)}`, dim: true })
  return out
}

/** The dropdown as plain text: `/mm team`. */
export const teamText = (team: TeamNow | null | undefined, now: number): string =>
  team ? [teamHeadingNow(team), ...teamLines(team, now).map(l => l.text)].join('\n') : 'Team now has not been read yet.'
