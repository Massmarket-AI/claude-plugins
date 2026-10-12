// Pure thread logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// Rob, 2026-10-12: "There should be a process that should already be looking to see what threads exist and
// deciding whether we should start a new one or not, and then making it really easy to pick up... it
// should be based on a real recommendation." And: "Why are none of them linked? Shouldn't they all be linked?"
//
// A client's threads are found three ways:
//   (i)   a thread already linked to the client (by hand, from a chip, or by an earlier sync)
//   (ii)  a thread whose Claude Code session declared the client: the feed's `threads` rows, matched to
//         the app's threads through the pairs each session records about itself
//   (iii) a thread whose title merely looks like the client
// (i) and (ii) link themselves. (iii) never does: it is only offered on the row as a suggestion.
//
// ⛔ A thread is one client's. A thread linked to one client is never another client's thread, whatever
// session or title matched it: it is not linked to a second, and it is never the thread Update acts on
// for a second (`ownerOf`).

import { businessMsBetween } from './business-time'
import type { MmRow } from '../types'

import { cleanTitle, titleFor, titleNames } from './queue'
import type { FeedThread, QueueItem } from './queue'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TZ = 'America/New_York'

/** A thread counts as current for a client when its last activity is within this much business time. */
export const RECENT_THREAD_MS = 7 * DAY
/** Last activity further back than this is old, decided without counting business time (no calendar walk for a date years back). */
export const OLD_THREAD_MS = 60 * DAY

/** A thread as the desktop app lists it. */
export type AppThread = { sessionId: string; title?: string; pinned?: boolean; isArchived?: boolean; lastActivityAt?: string }

/** Claude Code session id → the app thread it runs in, as each session records about itself. */
export type Pairs = Record<string, { app: string; at: number }>

export type ClientThread = { sid: string; title: string; lastAt: number; source: 'linked' | 'matched' }

export type Target = { sid: string; title: string; suggested: boolean }

export type Recommendation = {
  action: 'update' | 'start'
  /** Why, in a few words: shown on the row beside the action. */
  reason: string
  /** The thread Update acts on. Absent when the client has no thread of any kind. */
  target?: Target
}

/** The client a thread is linked to: the first project whose link is that thread. */
export function ownerOf(sid: string, links: Readonly<Record<string, string>>): string | undefined {
  for (const [projectId, linked] of Object.entries(links)) if (linked === sid) return projectId
  return undefined
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

function fmt(t: number, opts: Intl.DateTimeFormatOptions): string {
  try {
    // some runtimes put a narrow no-break space before AM and PM
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(t)).replace(/\u202f/g, ' ')
  } catch {
    // No Intl time zones: the UTC date, which is the same day for most of the working day.
    return new Date(t).toISOString().slice(0, 10)
  }
}

/** `Oct 12` */
export const monthDay = (t: number): string => fmt(t, { month: 'short', day: 'numeric' })
/** `Mon, Oct 12` */
export const weekdayMonthDay = (t: number): string => fmt(t, { weekday: 'short', month: 'short', day: 'numeric' })
/** `Mon, Oct 12 3 PM ET` */
export function dueText(t: number): string {
  const time = fmt(t, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return `${weekdayMonthDay(t)} ${time} ET`
}

const slug = (s: string): string => s.toLowerCase().replace(/…$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** A title looks like a client when it reads `client:<slug>`, or, stripped of our marks, starts with the client's name. */
export function titleLooksLike(title: string, client: string): boolean {
  const tagged = /^client:\s*(\S+)/i.exec(title.trim())
  if (tagged && slug(tagged[1] ?? '') === slug(client) && slug(client) !== '') return true
  return titleNames(title, client)
}

/**
 * The feed's threads for one client that are open in the app now, most recently active first.
 * A session the app does not know (another computer, a headless run, opened before this plugin) is skipped.
 * ⛔ So is a thread linked to a different client: one app thread can have run sessions for two clients (a
 * /clear, a resume), and it stays the client's it is linked to.
 * "Last activity" is the app's own for the thread; the feed's time stands in only when the app gives none.
 */
function matchedThreads(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
): ClientThread[] {
  const out: ClientThread[] = []
  for (const t of feedThreads) {
    if (t.project_id !== projectId) continue
    const app = pairs[t.session_id]?.app
    const s = app ? live.get(app) : undefined
    if (!s || s.isArchived || out.some(o => o.sid === s.sessionId)) continue
    const owner = ownerOf(s.sessionId, links)
    if (owner !== undefined && owner !== projectId) continue
    const at = ms(s.lastActivityAt)
    out.push({ sid: s.sessionId, title: s.title ?? '', lastAt: Number.isFinite(at) ? at : ms(t.last_activity_at), source: 'matched' })
  }
  return out.sort((a, b) => (Number.isFinite(b.lastAt) ? b.lastAt : -Infinity) - (Number.isFinite(a.lastAt) ? a.lastAt : -Infinity))
}

/**
 * The app threads reached by sessions of more than one client: one thread that ran a session for one
 * client and, after a /clear or a resume, a session for another. ⛔ Such a thread is nobody's by itself: it
 * is never linked automatically, to either. The person can still press Update on a row that shows it, or
 * type /mm link in it.
 */
export function sharedThreads(feedThreads: readonly FeedThread[], pairs: Pairs): Set<string> {
  const clients = new Map<string, Set<string>>()
  for (const t of feedThreads) {
    const app = pairs[t.session_id]?.app
    if (!app) continue
    const of = clients.get(app) ?? new Set<string>()
    of.add(t.project_id)
    clients.set(app, of)
  }
  return new Set([...clients].filter(([, of]) => of.size > 1).map(([app]) => app))
}

/**
 * R1: the thread a client links itself to when it has none: the most recently active thread whose Claude
 * Code session declared that client. A thread already linked to another client is left alone, a thread the
 * person unlinked is never linked again by itself (`unlinked`), a thread that ran sessions for more than
 * one client is never linked by itself (`sharedThreads`), and a title match is never enough.
 */
export function autoLinkFor(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
  unlinked: Readonly<Record<string, unknown>> = {},
): string | undefined {
  if (links[projectId]) return undefined
  const taken = new Set(Object.values(links))
  const shared = sharedThreads(feedThreads, pairs)
  return matchedThreads(projectId, links, feedThreads, pairs, live).find(t => !taken.has(t.sid) && !(t.sid in unlinked) && !shared.has(t.sid))?.sid
}

/**
 * A client's known threads: the linked one and every matched one, each once, newest first.
 * ⛔ Never a thread linked to a different client.
 */
export function clientThreads(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
): ClientThread[] {
  const out = matchedThreads(projectId, links, feedThreads, pairs, live)
  const linked = links[projectId] ? live.get(links[projectId] as string) : undefined
  if (linked && !linked.isArchived && ownerOf(linked.sessionId, links) === projectId) {
    const same = out.find(t => t.sid === linked.sessionId)
    if (same) same.source = 'linked'
    else out.push({ sid: linked.sessionId, title: linked.title ?? '', lastAt: ms(linked.lastActivityAt), source: 'linked' })
  }
  return out.filter(t => Number.isFinite(t.lastAt)).sort((a, b) => b.lastAt - a.lastAt)
}

/** R1 (iii): the most recently active open thread, linked to nobody, whose title looks like this client. */
export function titleSuggestion(client: string, links: Readonly<Record<string, string>>, live: ReadonlyMap<string, AppThread>): Target | undefined {
  const taken = new Set(Object.values(links))
  let best: AppThread | undefined
  for (const s of live.values()) {
    if (s.isArchived || taken.has(s.sessionId) || !s.title || !titleLooksLike(s.title, client)) continue
    if (!best || (ms(s.lastActivityAt) || 0) > (ms(best.lastActivityAt) || 0)) best = s
  }
  return best ? { sid: best.sessionId, title: best.title ?? '', suggested: true } : undefined
}

/**
 * R2: what to do about a client's thread, and why.
 *   Update thread · thread from Mon, Oct 12 exists     a known thread was active in the last 7 business days
 *   Start thread  · last thread is from Oct 2          the newest known thread is older than that
 *   Update thread · "<title>" looks like this client   no known thread, but a title matches
 *   Start thread  · no thread yet                      nothing at all
 */
export function recommend(threads: readonly ClientThread[], suggestion: Target | undefined, now: number): Recommendation {
  const newest = [...threads].sort((a, b) => b.lastAt - a.lastAt)[0]
  if (newest) {
    const target = { sid: newest.sid, title: newest.title, suggested: false }
    // More than 60 days back is old whatever the weekends were: business time is only counted inside that.
    const current = now - newest.lastAt <= OLD_THREAD_MS && businessMsBetween(newest.lastAt, now) <= RECENT_THREAD_MS
    return current
      ? { action: 'update', reason: `thread from ${weekdayMonthDay(newest.lastAt)} exists`, target }
      : { action: 'start', reason: `last thread is from ${monthDay(newest.lastAt)}`, target }
  }
  // the title is the thread's own text: cleaned and cut before it is shown
  if (suggestion) return { action: 'update', reason: `"${cleanTitle(suggestion.title)}" looks like this client`, target: suggestion }
  return { action: 'start', reason: 'no thread yet' }
}

/** What is waiting on a client, as its row shows it: `2 messages waiting, 1 task due`, or `drafts ready`. */
export function waitingText(it: QueueItem): string {
  const o = it.open ?? null
  const drafts = !o ? '' : o.state === 'held_by_me' ? `${o.unsent} draft${o.unsent === 1 ? '' : 's'} not sent` : o.state === 'held_by_other' ? `drafts with ${o.by}` : o.state === 'stale' ? 'drafts out of date' : 'drafts ready'
  const parts = [it.messages ? `${it.messages} message${it.messages > 1 ? 's' : ''} waiting` : '', it.tasks ? `${it.tasks} task${it.tasks > 1 ? 's' : ''} due` : '', drafts]
  return parts.filter(Boolean).join(', ') || 'drafts ready'
}

/**
 * R5: the one message that starts a client's reply in a thread. The Start chip carries it as its prompt and
 * Update sends it into the existing thread, with a first line saying what is new. Seven cases, the first
 * that holds:
 *   1. a package the person already picked up, with a draft not sent: carry on with it
 *   2. a prepared package that is theirs to pick up
 *   3. a package a teammate picked up: show what is waiting, run no prep, draft no second reply
 *   4. a package marked out of date: pick it up and rebuild the drafts
 *   5. a prepared package the client does not pin for them on: pick it up
 *   6. client messages with no package yet
 *   7. committed tasks only
 */
export function kickoffText(it: QueueItem, opts: { update?: boolean } = {}): string {
  const id = it.projectId
  const who = `${it.projectName} (OW project ${id})`
  const due = dueText(it.dueAt)
  const o = it.open ?? null
  const body =
    o?.state === 'held_by_me' && it.packageId
      ? `[mm-link ${id}] Carry on with the reply drafts for ${who}. I already picked up package ${it.packageId.slice(0, 8)}: ${o.unsent} draft(s) not sent yet${o.newer > 0 ? `, and ${o.newer} client message(s) arrived since` : ''}. Load the client's project skill first, then follow client-reply-prep §9: read the package again, show the five-part pickup view and wait for me. Send nothing without my go.`
      : it.packageId
        ? `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package ${it.packageId.slice(0, 8)} and wait for me. Send nothing without my go.`
        : o?.state === 'held_by_other'
          ? `[mm-link ${id}] ${who}: ${o.by} picked up the reply drafts (package ${o.id.slice(0, 8)}) and has ${o.unsent} not sent yet. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep and do not draft a second reply. Send nothing without my go.`
          : o?.state === 'stale'
            ? `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting, reply due ${due}. Load the client's project skill first, then follow client-reply-prep §9: package ${o.id.slice(0, 8)} exists but is marked out of date, so pick it up, rebuild the drafts, then show the five-part pickup view and wait for me. Send nothing without my go.`
            : o?.state === 'prepared'
              ? `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package ${o.id.slice(0, 8)} and wait for me. Send nothing without my go.`
              : it.messages > 0
                ? `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting, reply due ${due}. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the five-part pickup view and wait for me. Send nothing without my go.`
                : `[mm-link ${id}] ${who} has ${it.tasks} committed task(s) due ${due}. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`
  return opts.update ? `New since this thread last worked on this client: ${waitingText(it)}.\n${body}` : body
}

// ---------------------------------------------------------------- the pane

export const LABEL = { update: 'Update thread', start: 'Start thread', drafts: 'Drafts' } as const

/** R8: the sentence under the list. */
export const PANE_SENTENCE =
  'Pins: overdue by up to 3 business days, or due within the next 24 business hours. Weekends do not count. Threads for these clients link themselves; use Update or Start on a row to pick one up.'

/** A row of the Needs-you pane (the plugin's state contract holds the shape). */
export type Row = MmRow

export function rowFor(it: QueueItem, rec: Recommendation, now: number): Row {
  return {
    projectId: it.projectId, client: it.client, title: titleFor(it, now), waiting: waitingText(it), action: rec.action, reason: rec.reason,
    canUpdate: Boolean(rec.target),
    // the thread this row's Update button acts on: a press acts on this one or on none
    ...(rec.target ? { target: rec.target.sid } : {}),
  }
}

/** The buttons on a row: the recommended action first, the other one second, then Drafts. */
export function rowButtons(row: Row): Array<'update' | 'start' | 'drafts'> {
  const other = row.action === 'update' ? 'start' : 'update'
  return [row.action, ...(other === 'update' && !row.canUpdate ? [] : [other]), 'drafts'] as Array<'update' | 'start' | 'drafts'>
}

/** The second line of a row: what is waiting, then the recommendation and its reason. */
export const rowDetail = (row: Row): string => `${row.waiting} · ${LABEL[row.action]}: ${row.reason}`

/** The pane as plain text, one line per thing drawn: for tests and for a surface that draws no buttons. */
export function paneText(rows: readonly Row[], header: string, note: string): string {
  const out = [header]
  rows.forEach((r, i) => out.push('', `${i + 1}. ${r.title}`, `   ${rowDetail(r)}`, `   ${rowButtons(r).map(b => `[ ${LABEL[b]} ]`).join(' ')}`))
  out.push('', note)
  return out.join('\n')
}
