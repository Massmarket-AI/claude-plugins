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

import { cleanTitle, clockText, titleFor, titleNames } from './queue'
import type { FeedThread, QueueItem } from './queue'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TZ = 'America/New_York'

/** A thread counts as current for a client when its last activity is within this much business time. */
export const RECENT_THREAD_MS = 7 * DAY
/** Last activity further back than this is old, decided without counting business time (no calendar walk for a date years back). */
export const OLD_THREAD_MS = 60 * DAY

/** A thread's own reading of its context window at or past this percent makes it long. */
export const LONG_CONTEXT_PERCENT = 60
/** And so does this many tokens used, whatever the percent (a 1M window at 30% is still a costly thread). */
export const LONG_CONTEXT_TOKENS = 300_000
/** With no reading fresh enough, this many worklog rows in the feed's window make a thread long. */
export const LONG_THREAD_ROWS = 1500
/** A reading older than this says nothing: the row count decides. */
export const CONTEXT_READING_MAX_AGE_MS = 7 * DAY

/** A thread as the desktop app lists it. `link` is the app's own link to it, kept only when it is that thread's. */
export type AppThread = { sessionId: string; title?: string; pinned?: boolean; isArchived?: boolean; lastActivityAt?: string; link?: string }

/** Claude Code session id → the app thread it runs in, as each session records about itself. */
export type Pairs = Record<string, { app: string; at: number }>

export type ClientThread = { sid: string; title: string; lastAt: number; source: 'linked' | 'matched' }

export type Target = { sid: string; title: string; suggested: boolean }

/** `start`: a new thread. `update`: the thread exists and lacks what is waiting. `current`: it has it. */
export type RowState = 'start' | 'update' | 'current'

export type Recommendation = {
  state: RowState
  /** Why, in a few words: shown on the row beside the action. For `current`, the whole phrase: `Thread updated 3 PM`. */
  reason: string
  /** The client's thread: what Update or Open acts on, and what a new thread takes over from. Absent when there is none. */
  target?: Target
  /** True when the client has no thread of any kind: the rows to notice first. (Kept when the thread is merely not visible now.) */
  fresh?: true
}

/** What Update last put into a client's thread: which thread, the signature of what it carried, and when. */
export type Sent = { sid: string; sig: string; at: number }

/** A session's reading of its own context window: four numbers, nothing else. */
export type ContextReading = { tokensUsed: number; contextWindow: number; percentUsed: number; at: number }

/** Why a thread is long: by its own context reading (with the percent used), or by the feed's row count. */
export type Length = { by: 'context'; percent: number } | { by: 'rows' } | null

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
 * How a thread is judged long, and by what.
 *   context  the thread's own reading of its context window (what its session recorded about itself)
 *   rows     the feed's row count for it, used only when there is no reading fresh enough
 * A fresh reading under both limits is NOT long, whatever the row count.
 */
export function threadLength(reading: ContextReading | undefined, rows: number | undefined, now: number): Length {
  if (reading && Number.isFinite(reading.at) && now - reading.at <= CONTEXT_READING_MAX_AGE_MS) {
    const long = reading.percentUsed >= LONG_CONTEXT_PERCENT || reading.tokensUsed >= LONG_CONTEXT_TOKENS
    return long ? { by: 'context', percent: Math.round(reading.percentUsed) } : null
  }
  return typeof rows === 'number' && rows >= LONG_THREAD_ROWS ? { by: 'rows' } : null
}

/**
 * The feed's row count for a thread and a client: that of the newest of the client's sessions that ran in
 * the thread (the feed lists newest first). Undefined when the feed carries none: a server that does not
 * send `rows` yet never makes a thread long.
 */
export function threadRows(sid: string, projectId: string, feedThreads: readonly FeedThread[], pairs: Pairs): number | undefined {
  const entry = feedThreads.find(t => t.project_id === projectId && pairs[t.session_id]?.app === sid)
  return entry && typeof entry.rows === 'number' && Number.isFinite(entry.rows) ? entry.rows : undefined
}

/**
 * What a thread must already hold to be up to date: the kickoff that would be sent now (without Update's
 * first line), and the package's `covers_through` and `updated_at` when the feed gives them. A new client
 * message, another package, a package that changed: each makes it a different text.
 */
export function signatureOf(it: QueueItem): string {
  return [kickoffText(it), it.coversThrough ?? '', it.packageUpdatedAt ?? ''].join('\n')
}

/**
 * What to do about a client's thread, and why. ONE action per client:
 *
 *   start    Start thread  · no thread yet
 *            Start thread  · last thread is from Oct 2                the thread is older than 7 business days
 *            Start thread  · the existing thread has used 61% of its context, a new one is cheaper and cleaner
 *            Start thread  · the existing thread is long, a new one keeps the context clean
 *   update   Update thread · thread from Mon, Oct 12 exists           a thread exists and has not been given this
 *            Update thread · new since this thread was updated        the bridge updated it before, with less
 *            Update thread · "<title>" looks like this client         no known thread, but a title matches
 *   current  Thread updated 3 PM                                      the thread already has what is waiting now
 *
 * The thread is the client's linked one when it has one, else the most recently active matched one.
 * `current` is decided by `sent`: the thread and the signature the bridge stored when Update last went.
 */
export function recommend(
  threads: readonly ClientThread[],
  suggestion: Target | undefined,
  now: number,
  known: { sent?: Sent | undefined; signature?: string; length?: (sid: string) => Length } = {},
): Recommendation {
  const own = threads.filter(t => t.source === 'linked')
  const thread = [...(own.length ? own : threads)].sort((a, b) => b.lastAt - a.lastAt)[0]
  if (thread) {
    const target = { sid: thread.sid, title: thread.title, suggested: false }
    // More than 60 days back is old whatever the weekends were: business time is only counted inside that.
    const recent = now - thread.lastAt <= OLD_THREAD_MS && businessMsBetween(thread.lastAt, now) <= RECENT_THREAD_MS
    if (!recent) return { state: 'start', reason: `last thread is from ${monthDay(thread.lastAt)}`, target }
    const length = known.length?.(thread.sid) ?? null
    if (length?.by === 'context') return { state: 'start', reason: `the existing thread has used ${length.percent}% of its context, a new one is cheaper and cleaner`, target }
    if (length?.by === 'rows') return { state: 'start', reason: 'the existing thread is long, a new one keeps the context clean', target }
    const sent = known.sent && known.sent.sid === thread.sid ? known.sent : undefined
    if (sent && known.signature !== undefined && sent.sig === known.signature) return { state: 'current', reason: `Thread updated ${clockText(sent.at, now)}`, target }
    return { state: 'update', reason: sent ? 'new since this thread was updated' : `thread from ${weekdayMonthDay(thread.lastAt)} exists`, target }
  }
  // the title is the thread's own text: cleaned and cut before it is shown
  if (suggestion) return { state: 'update', reason: `"${cleanTitle(suggestion.title)}" looks like this client`, target: suggestion }
  return { state: 'start', reason: 'no thread yet', fresh: true }
}

/** What is waiting on a client, as its row shows it: `2 messages waiting, 1 task due`, or `drafts ready`. */
export function waitingText(it: QueueItem): string {
  const parts = [it.messages ? `${it.messages} message${it.messages > 1 ? 's' : ''} waiting` : '', it.tasks ? `${it.tasks} task${it.tasks > 1 ? 's' : ''} due` : '']
  return parts.filter(Boolean).join(', ') || 'drafts ready'
}

/**
 * R5: the one message that starts a client's reply in a thread. The Start chip carries it as its prompt and
 * Update sends it into the existing thread, with a first line saying what is new. Three cases: a prepared
 * package, client messages with no package yet, and committed tasks only.
 */
export function kickoffText(it: QueueItem, opts: { update?: boolean; replaces?: Replaced | undefined } = {}): string {
  const id = it.projectId
  const who = `${it.projectName} (OW project ${id})`
  const due = dueText(it.dueAt)
  const body = it.packageId
    ? `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package ${it.packageId.slice(0, 8)} and wait for me. Send nothing without my go.`
    : it.messages > 0
      ? `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting, reply due ${due}. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the five-part pickup view and wait for me. Send nothing without my go.`
      : `[mm-link ${id}] ${who} has ${it.tasks} committed task(s) due ${due}. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`
  if (opts.update) return `New since this thread last worked on this client: ${waitingText(it)}.\n${body}`
  const handover = opts.replaces ? handoverText(it, opts.replaces) : ''
  return handover ? `${body}\n\n${handover}` : body
}

/** The thread a new one takes over from: the app's id for it and its own title. */
export type Replaced = { sid: string; title: string }

/** `local_<id>`: the app's id for a thread, which is what the session tools take. */
export const THREAD_ID = /^local_[A-Za-z0-9_-]{1,100}$/

/**
 * The second paragraph of a kickoff that starts a new thread while the client already has one (Rob,
 * 2026-10-12: "inspect the recent context of an existing thread for anything unreconciled before creating
 * the new one"). The NEW thread's Claude reads the old thread's last three messages; the bridge reads
 * nothing of it. '' when the old thread's id is not an app thread id.
 * ⛔ The title is the thread's own text: cleaned to one line and cut at 60 before it goes in.
 */
export function handoverText(it: QueueItem, old: Replaced): string {
  if (!THREAD_ID.test(old.sid)) return ''
  const before = it.packageId || it.messages > 0 ? 'Before the pickup view' : 'Before showing me what is due'
  return `This thread replaces "${cleanTitle(old.title)}" (thread ${old.sid}) for ${it.projectName}. ${before}, and without reading that thread in full: read only its last three messages with the session tools (list_events, a small limit) and list anything left open in it: a question waiting on me, something promised and not done, a draft that was not sent. Keep that list to ten lines, then carry on.`
}

/**
 * The link that opens a thread in the app, as the app's own list gives it. ⛔ Only this exact shape, and
 * only for the thread it names: `claude://claude.ai/epitaxy/<that thread's id>`. Anything else is no link.
 */
export function threadLink(thread: { sessionId: string; link?: unknown } | undefined): string | undefined {
  if (!thread || typeof thread.link !== 'string' || !THREAD_ID.test(thread.sessionId)) return undefined
  return thread.link === `claude://claude.ai/epitaxy/${thread.sessionId}` ? thread.link : undefined
}

/**
 * The system's own opener on each platform: the program, and what stands before the link. The app gives a
 * plugin no call that opens a thread, so this is the one way a button can take the person to it.
 * ⛔ These three programs and no other. `rundll32 url.dll,FileProtocolHandler` on Windows, not `cmd /c
 *    start`: no shell reads the link.
 */
export const OPENERS = {
  mac: ['open'],
  windows: ['rundll32', 'url.dll,FileProtocolHandler'],
  linux: ['xdg-open'],
} as const
export type Platform = keyof typeof OPENERS

/**
 * Which platform this computer is, from its environment: Windows sets `OS` to `Windows_NT`; a home folder
 * under `/Users/` is a Mac's and one under `/home/` is Linux's. Undefined when it cannot be told: nothing
 * is started then.
 */
export function platformOf(env: { OS?: string | null | undefined; HOME?: string | null | undefined }): Platform | undefined {
  if (env.OS === 'Windows_NT') return 'windows'
  const home = typeof env.HOME === 'string' ? env.HOME : ''
  if (home.startsWith('/Users/')) return 'mac'
  if (home.startsWith('/home/')) return 'linux'
  return undefined
}

/**
 * The one command that opens a thread, as an argument array: the platform's opener, then the thread's link
 * as its last argument, alone. Undefined when the thread has no link that is exactly its own (threadLink),
 * or the platform is not known: nothing is started then.
 * ⛔ Never a string for a shell, and nothing is ever joined into an argument.
 */
export function openCommand(thread: { sessionId: string; link?: unknown } | undefined, platform: Platform | undefined): readonly string[] | undefined {
  const link = threadLink(thread)
  if (!link || !platform || !Object.hasOwn(OPENERS, platform)) return undefined
  return [...OPENERS[platform], link]
}

// ---------------------------------------------------------------- the pane

export const LABEL = { update: 'Update thread', start: 'Start thread', open: 'Open thread', drafts: 'Drafts' } as const
export type RowButton = keyof typeof LABEL

/** R8: the sentence under the list. */
export const PANE_SENTENCE =
  'Pins: overdue by up to 3 business days, or due within the next 24 business hours. Weekends do not count. Threads for these clients link themselves; use Update or Start on a row to pick one up.'

/** A row of the Needs-you pane (the plugin's state contract holds the shape). */
export type Row = MmRow

/** A row's state, also for a row an older version of the bridge drew (it called it `action`). */
export const rowState = (row: Row): RowState => {
  const state = row.state ?? (row as { action?: unknown }).action
  return state === 'update' || state === 'current' ? state : 'start'
}

export function rowFor(it: QueueItem, rec: Recommendation, now: number): Row {
  return {
    projectId: it.projectId, client: it.client, title: titleFor(it, now), waiting: waitingText(it), state: rec.state, reason: rec.reason,
    // no thread of any kind: the row goes in the first group, marked
    fresh: rec.fresh === true,
    // the thread this row's button acts on: a press acts on this one or on none
    ...(rec.target ? { target: rec.target.sid } : {}),
  }
}

/**
 * The buttons on a row: ONE action, chosen by its state, then Drafts (Rob, 2026-10-12: "it should be
 * 'update thread', 'open thread', or 'start thread'... depending on whether you know what we should do").
 */
export function rowButtons(row: Row): RowButton[] {
  const state = rowState(row)
  return [state === 'current' ? 'open' : state, 'drafts']
}

/** The second line of a row: what is waiting, then the action and its reason, or when the thread was updated. */
export function rowDetail(row: Row): string {
  const state = rowState(row)
  return state === 'current' ? `${row.waiting} · ${row.reason}` : `${row.waiting} · ${LABEL[state]}: ${row.reason}`
}

/**
 * The band's line as it is drawn: as it is beside its button, and with how to open the list where the
 * band can carry no button. (On this build the band is raised on the terminal and desktop surfaces only,
 * and both draw a Button.)
 */
export const bandWords = (text: string, hasButton: boolean): string => (hasButton ? text : `${text} · type /mm to open the list`)

/** A row for a client that has no thread at all: the ones to notice first (not a client whose thread is old or long). */
export const isNewRow = (row: Row): boolean => row.fresh ?? (rowState(row) === 'start' && !row.target)

/** The mark before the number of a row with no thread yet. */
export const NEW_MARK = '◆ '

/**
 * The list in the two groups it is drawn in (Rob, 2026-10-12: clients "that have sent a message and don't
 * have a thread yet should be highlighted somehow in the list"): first the clients with no thread yet,
 * then the ones in a thread. Each keeps the order it came in (soonest due first), and a group with nobody
 * in it is not drawn. `n` is the row's number in the whole list.
 */
export function rowGroups(rows: readonly Row[]): Array<{ heading: string; rows: Array<{ row: Row; n: number; mark: string }> }> {
  const fresh = rows.filter(isNewRow)
  const threaded = rows.filter(r => !isNewRow(r))
  const numbered = (group: readonly Row[], from: number, mark: string) => group.map((row, i) => ({ row, n: from + i + 1, mark }))
  return [
    { heading: `New: no thread yet (${fresh.length})`, rows: numbered(fresh, 0, NEW_MARK) },
    { heading: `In a thread (${threaded.length})`, rows: numbered(threaded, fresh.length, '') },
  ].filter(g => g.rows.length > 0)
}

/** The pane as plain text, one line per thing drawn: for tests and for a surface that draws no buttons. */
export function paneText(rows: readonly Row[], header: string, note: string): string {
  const out = [header]
  for (const group of rowGroups(rows)) {
    out.push('', group.heading)
    for (const { row, n, mark } of group.rows) out.push('', `${mark}${n}. ${row.title}`, `   ${rowDetail(row)}`, `   ${rowButtons(row).map(b => `[ ${LABEL[b]} ]`).join(' ')}`)
  }
  out.push('', note)
  return out.join('\n')
}
