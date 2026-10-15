// Pure thread logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// Rob, 2026-10-12: "There should be a process that should already be looking to see what threads exist and
// deciding whether we should start a new one or not, and then making it really easy to pick up... it
// should be based on a real recommendation." And: "Why are none of them linked? Shouldn't they all be linked?"
//
// A client's threads are found three ways:
//   (i)   a thread already linked to the client (by hand, from a chip, or by an earlier sync)
//   (ii)  a thread whose Claude Code sessions declared the client and no other project: the feed's
//         `threads` rows, matched to the app's threads through the pairs each session records about itself
//   (iii) a thread whose title merely looks like the client
// (i) and (ii) link themselves. (iii) never does: it is only offered on the row as a suggestion. A thread
// whose sessions also declared another project is none of these, for either client (`onlyClients`).
//
// ⛔ A thread is one client's. A thread linked to one client is never another client's thread, whatever
// session or title matched it: it is not linked to a second, and it is never the thread Update acts on
// for a second (`ownerOf`).

import { businessMsBetween } from './business-time'
import type { MmRow } from '../types'

import { MAY_NEED_OK, NOBODY, checkingTitle, cleanTitle, clockText, decidesText, fastState, hasDue, holdSentence, noThreadTitle, pinsNow, stillOpenTitle, titleFor, titleNames, withHolder, withTeammate } from './queue'
import type { FeedThread, QueueItem } from './queue'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TZ = 'America/New_York'

/** A thread counts as current for a client when its last activity is within this much business time. */
export const RECENT_THREAD_MS = 7 * DAY
/** Last activity further back than this is old, decided without counting business time (no calendar walk for a date years back). */
export const OLD_THREAD_MS = 60 * DAY

/**
 * (R8) A thread's own reading of its context window at or past this percent: its row offers no Claim. (0.5.11, Rob
 * 10-15: "Can you just automatically compress context at 60% instead of 100% to save tokens?") It no longer makes a
 * thread one to replace: Claude Code compacts a long thread instead (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE).
 */
export const LONG_CONTEXT_PERCENT = 60
/** A reading older than this says nothing. */
export const CONTEXT_READING_MAX_AGE_MS = 7 * DAY

/** A thread as the desktop app lists it. `link` is the app's own link to it, kept only when it is that thread's. */
export type AppThread = { sessionId: string; title?: string; pinned?: boolean; isArchived?: boolean; lastActivityAt?: string; link?: string }

/**
 * Claude Code session id → the app thread it runs in, as each session records about itself. `at` is when the
 * pair was last written (a session writes it again once a day, and a pair not written for 30 days is
 * forgotten); `since` (0.5.9) is when it was first written for that thread, written with every first write and
 * kept through those rewrites. A pair with no `since` (written before 0.5.9, or found late in the app's records
 * and dated then) says nothing about when its thread started.
 */
export type Pairs = Record<string, { app: string; at: number; since?: number }>

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
 * is never linked automatically, to either, and neither client's row offers it (`clientThreads`). The person
 * can still type /mm link in it.
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
 * The one client a thread's sessions declared in the feed's window: the project EVERY feed row of every
 * session that runs in the thread names. Undefined when there is no such row, when the rows name two or
 * more projects, whichever they are (the internal-ops project counts like any other), or when OW says one
 * of those sessions declared another project too, one the feed does not list (`sole: false`). B3,
 * 2026-10-13: a pipeline thread that loaded one client's skill for reference was linked to that client,
 * pinned and named as its thread, so that client's Update would have sent into it.
 */
export function soleClient(sid: string, feedThreads: readonly FeedThread[], pairs: Pairs): string | undefined {
  let only: string | undefined
  for (const t of feedThreads) {
    if (pairs[t.session_id]?.app !== sid) continue
    if (t.sole === false) return undefined
    if (only !== undefined && only !== t.project_id) return undefined
    only = t.project_id
  }
  return only
}

/**
 * Whether a thread is, by the feed or by its own marker, another client's as well as or instead of this
 * one's: a row of its sessions names another project, OW says such a session declared another project too
 * (`sole: false`), or the thread opened with an [mm-link] marker for another client (`marked`: the project
 * each thread's marker named). A row with no `sole` (an older OW) is read as it always was.
 */
export function declaredOther(projectId: string, sid: string, feedThreads: readonly FeedThread[], pairs: Pairs, marked: Readonly<Record<string, string>> = {}): boolean {
  if (marked[sid] !== undefined && marked[sid] !== projectId) return true
  return feedThreads.some(t => pairs[t.session_id]?.app === sid && (t.project_id !== projectId || t.sole === false))
}

/**
 * Whether a thread is this client's alone: what the bridge may link by itself, keep linked by itself, and
 * offer on the client's row. Every feed row of its sessions names that client (`soleClient`), and nothing
 * makes it another's (`declaredOther`). A thread the feed lists for nobody is not; whether a link the
 * bridge made to such a thread is undone is the sync's count of misses.
 */
export function onlyClients(projectId: string, sid: string, feedThreads: readonly FeedThread[], pairs: Pairs, marked: Readonly<Record<string, string>> = {}): boolean {
  return !declaredOther(projectId, sid, feedThreads, pairs, marked) && soleClient(sid, feedThreads, pairs) === projectId
}

/**
 * What becomes of a link the bridge made by itself, by this sync's feed:
 *   stays     its thread's sessions declared this client alone (`onlyClients`), or (0.5.9) the feed lists
 *             none of them and the thread opened with this client's own [mm-link] marker
 *   goes      something makes the thread another client's too (`declaredOther`: a row for another project,
 *             a row OW marks `sole: false`, a marker for another client): let go on this sync (B3)
 *   unlisted  the feed lists none of its sessions: the sync counts a miss
 * (0.5.9) A thread that opened with this client's marker said so itself, and that does not age out of the
 * feed's window: a link R1b moved to such a thread is not undone by misses and then taken again (a loop).
 */
export function autoLinkFate(projectId: string, sid: string, feedThreads: readonly FeedThread[], pairs: Pairs, marked: Readonly<Record<string, string>> = {}): 'stays' | 'goes' | 'unlisted' {
  if (declaredOther(projectId, sid, feedThreads, pairs, marked)) return 'goes'
  if (feedThreads.some(t => pairs[t.session_id]?.app === sid)) return 'stays'
  return marked[sid] === projectId ? 'stays' : 'unlisted'
}

/**
 * (0.5.9) When a thread started, as far as the bridge knows: the earliest any Claude Code session was first
 * recorded running in it (each pair's `since`). Undefined, START-UNKNOWN, when no session of the thread has a pair,
 * or when any of its pairs has no `since` (review of 54a0437d, M1: a pair written before 0.5.9 carries its last
 * daily rewrite, and one the app's records gave late carries the day it was found; neither is when the thread
 * started). ⛔ Never its last activity: typing in a thread later does not make it newer.
 */
export function threadStart(sid: string, pairs: Pairs): number | undefined {
  let start: number | undefined
  for (const p of Object.values(pairs)) {
    if (!p || p.app !== sid) continue
    if (typeof p.since !== 'number' || !Number.isFinite(p.since)) return undefined
    if (start === undefined || p.since < start) start = p.since
  }
  return start
}

/**
 * R1b (0.5.9, Rob 2026-10-15: "Can we have it update to attach to the most recent thread for each client?"): the
 * thread a link the bridge made by itself moves to, when the client has a newer one. A candidate is open in the
 * app's list, not archived, not the linked thread, linked to no client, not one the person unlinked, not one a
 * client was moved off (`released`), not reached by sessions of more than one client (`shared`), not
 * another client's by the feed or by its marker (`declaredOther`), and it opened with this client's own marker
 * or its sessions declared this client alone (`onlyClients`). Its start (`threadStart`) must be known, and LATER
 * than both the linked thread's start and its last activity (M1: whichever of them is known and later; neither
 * known, nothing moves). The newest start wins. ⛔ A candidate whose start is unknown is never one.
 * ⛔ (0.5.10) And only on evidence dated at or after its own start: the marker recorded then or later (`markedAt`;
 * a marker with no time on record never counts here), or a feed row of its sessions for this client whose last
 * activity is then or later. An old thread reopened (paired again, so it looks new) is not this client's newest
 * thread on what its sessions did for the client before (review of 0.5.9, probe 240: X's link, pin and name landed
 * on a thread the person was using for client Y until the feed caught up).
 * ⛔ The newest thread, never the most recently active: typing in the old thread later never pulls the link back.
 * ⛔ Only for a link the bridge made by itself: the caller never asks this for a link the person made.
 */
export function newerThreadFor(
  projectId: string,
  linked: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
  skip: {
    unlinked?: Readonly<Record<string, unknown>>
    released?: readonly string[]
    marked?: Readonly<Record<string, string>>
    /** (0.5.10) When each thread's marker was recorded, where that is known. */
    markedAt?: Readonly<Record<string, number>>
    shared?: ReadonlySet<string>
  } = {},
): string | undefined {
  const marked = skip.marked ?? {}
  const unlinked = skip.unlinked ?? {}
  const released = skip.released ?? []
  const shared = skip.shared ?? sharedThreads(feedThreads, pairs)
  const known = [threadStart(linked, pairs), ms(live.get(linked)?.lastActivityAt)].filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
  if (!known.length) return undefined
  const from = Math.max(...known)
  let best: { sid: string; start: number } | undefined
  for (const s of live.values()) {
    const sid = s.sessionId
    if (s.isArchived || sid === linked || ownerOf(sid, links) !== undefined) continue
    if (sid in unlinked || released.includes(sid) || shared.has(sid)) continue
    // ⛔ a thread whose marker names another client, or that the feed gives to another, never qualifies
    if (declaredOther(projectId, sid, feedThreads, pairs, marked)) continue
    const start = threadStart(sid, pairs)
    if (start === undefined || start <= from) continue
    // (0.5.10) this client's, on evidence dated at or after the thread's start
    const markedAt = skip.markedAt?.[sid]
    const byMarker = marked[sid] === projectId && typeof markedAt === 'number' && Number.isFinite(markedAt) && markedAt >= start
    const byFeed =
      soleClient(sid, feedThreads, pairs) === projectId &&
      feedThreads.some(t => t.project_id === projectId && pairs[t.session_id]?.app === sid && ms(t.last_activity_at) >= start)
    if (!byMarker && !byFeed) continue
    if (!best || start > best.start) best = { sid, start }
  }
  return best?.sid
}

/**
 * R1: the thread a client links itself to when it has none: the most recently active thread whose Claude
 * Code sessions declared that client and no other (`onlyClients`). A thread already linked to another
 * client is left alone, a thread the person unlinked is never linked again by itself (`unlinked`), a
 * thread that ran sessions for more than one client, or opened with a marker for another, is never linked
 * by itself, and a title match is never enough.
 */
export function autoLinkFor(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
  unlinked: Readonly<Record<string, unknown>> = {},
  marked: Readonly<Record<string, string>> = {},
): string | undefined {
  if (links[projectId]) return undefined
  const taken = new Set(Object.values(links))
  return matchedThreads(projectId, links, feedThreads, pairs, live).find(t => !taken.has(t.sid) && !(t.sid in unlinked) && onlyClients(projectId, t.sid, feedThreads, pairs, marked))?.sid
}

/**
 * A client's known threads, what its row may offer (Open, Update, the thread a new one takes over from):
 * the thread linked to it, and every thread whose sessions declared that client alone (`onlyClients`), each
 * once, newest first.
 * ⛔ Never a thread linked to a different client, and never one whose sessions also declared another
 * project or that opened with a marker for another client (Opus, 2026-10-13: the Pipeline-speed thread, once
 * its link was let go, was still offered for Update on that client's row).
 */
export function clientThreads(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  live: ReadonlyMap<string, AppThread>,
  marked: Readonly<Record<string, string>> = {},
): ClientThread[] {
  const out = matchedThreads(projectId, links, feedThreads, pairs, live).filter(t => onlyClients(projectId, t.sid, feedThreads, pairs, marked))
  const linked = links[projectId] ? live.get(links[projectId] as string) : undefined
  if (linked && !linked.isArchived && ownerOf(linked.sessionId, links) === projectId) {
    const same = out.find(t => t.sid === linked.sessionId)
    if (same) same.source = 'linked'
    else out.push({ sid: linked.sessionId, title: linked.title ?? '', lastAt: ms(linked.lastActivityAt), source: 'linked' })
  }
  return out.filter(t => Number.isFinite(t.lastAt)).sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * R1 (iii): the most recently active open thread, linked to nobody, whose title looks like this client.
 * ⛔ Not one `other` says is another client's (`declaredOther`): a title never brings back a thread the feed
 * or its marker gives to another client.
 */
export function titleSuggestion(client: string, links: Readonly<Record<string, string>>, live: ReadonlyMap<string, AppThread>, other: (sid: string) => boolean = () => false): Target | undefined {
  const taken = new Set(Object.values(links))
  let best: AppThread | undefined
  for (const s of live.values()) {
    if (s.isArchived || taken.has(s.sessionId) || !s.title || !titleLooksLike(s.title, client) || other(s.sessionId)) continue
    if (!best || (ms(s.lastActivityAt) || 0) > (ms(best.lastActivityAt) || 0)) best = s
  }
  return best ? { sid: best.sessionId, title: best.title ?? '', suggested: true } : undefined
}

/**
 * What a thread must already hold to be up to date: the kickoff that would be sent now (without Update's
 * first line), and the package's `covers_through` and `updated_at` when the feed gives them. A new client
 * message, another package, a package that changed: each makes it a different text.
 */
export function signatureOf(it: QueueItem): string {
  const o = it.open ?? null
  const mine = o?.state === 'held_by_me'
  // A package is read as it was before anyone picked it up, and without how many of its drafts are left:
  // picking it up or sending one of its drafts is not something new for the thread that has it.
  const plain: QueueItem = mine ? { ...it, open: null } : o ? { ...it, open: { ...o, unsent: 0 } } : it
  return [kickoffText(plain), it.coversThrough ?? '', mine ? `held:${o.newer}` : (it.packageUpdatedAt ?? '')].join('\n')
}

/**
 * Whether a thread that was given `had` (the signature stored when Update went, or the chip's) already has
 * what is waiting on `it` now. The same signature, or: a package the viewer holds, with nothing from the
 * client since its drafts were written, in the thread that was given that package. The package's own
 * `updated_at` is not asked then: while the viewer holds it, a change to it is their own doing.
 */
export function hasWaiting(had: string, it: QueueItem): boolean {
  const want = signatureOf(it)
  if (had === want) return true
  const o = it.open ?? null
  if (o?.state !== 'held_by_me' || o.newer > 0) return false
  const head = (s: string): string => s.slice(0, Math.max(0, s.lastIndexOf('\n')))
  return head(had) === head(want)
}

// ---------------------------------------------------------------- (0.5.11) Update by itself

/** (0.5.11) Something new for a client goes into its thread by itself only once nothing newer has come for this long. */
export const AUTO_QUIET_MS = 10 * 60_000
/** (0.5.11) With client mail waiting and no reply drafts ready, it goes once the newest message is this old. */
export const AUTO_NO_DRAFTS_MS = 60 * 60_000

/**
 * (0.5.11, Rob 10-15: "I think we should start updating threads automatically") Whether a client on the person's
 * own list is one whose thread may be updated by itself: never one a teammate has (`withTeammate`; the founder's
 * `theirs`), never one whose package someone else holds (`withHolder`), never one whose reply the server is
 * checking or found still open (R8: Claim is the person's press), and never an internal project's (as no thread
 * is started by itself for one).
 */
export function autoUpdatable(it: QueueItem, now: number): boolean {
  const o = it.open ?? null
  return it.internal !== true && !it.theirs && !withTeammate(it) && !(o && withHolder(o)) && fastState(it, now) === null
}

/**
 * (0.5.11, Rob 10-15: "Joe's call from Second Peak Training ended a little while back... I don't understand why it
 * hasn't already handed the new context there so the draft is ready when I open the thread up") Whether it is time
 * to update a client's thread by itself: nothing newer has come for the client for AUTO_QUIET_MS (a message
 * received, the mail a package covers, the package's own update, a task created), and then reply drafts are ready
 * (a package prepared for the person, or one they hold), or the newest client message is AUTO_NO_DRAFTS_MS old, or
 * no client message waits at all (tasks only). A time more than AUTO_QUIET_MS ahead is a task's due time standing
 * in for when it was created, not something that arrived; one less far ahead is read as now.
 */
export function autoUpdateDue(it: QueueItem, now: number): boolean {
  const n = it.newest ?? { mail: 0, pkg: 0, task: 0 }
  const arrived = (t: unknown): number => {
    const v = Number(t)
    return Number.isFinite(v) && v > 0 && v <= now + AUTO_QUIET_MS ? Math.min(v, now) : 0
  }
  const newest = Math.max(arrived(n.mail), arrived(n.pkg), arrived(n.task), arrived(ms(it.packageUpdatedAt)))
  if (now - newest < AUTO_QUIET_MS) return false
  if (it.messages === 0) return true
  const o = it.open ?? null
  const ready = it.kind === 'ready' || o?.state === 'prepared' || o?.state === 'held_by_me'
  return ready || now - arrived(n.mail) >= AUTO_NO_DRAFTS_MS
}

/**
 * What to do about a client's thread, and why. ONE action per client:
 *
 *   start    Start thread  · no thread yet
 *            Start thread  · last thread is from Oct 2                the thread is older than 7 business days
 *   update   Update thread · thread from Mon, Oct 12 exists           a thread exists and has not been given this
 *            Update thread · new since this thread was updated        the bridge updated it before, with less
 *            Update thread · "<title>" looks like this client         no known thread, but a title matches
 *   current  Thread updated 3 PM                                      the thread already has what is waiting now
 *
 * The thread is the client's linked one when it has one, else the most recently active matched one.
 * `current` is decided by `sent`: the thread and the signature the bridge stored when Update last went.
 * (0.5.11, Rob 10-15) A thread's length is no reason for a new one: Claude Code compacts it instead.
 */
export function recommend(
  threads: readonly ClientThread[],
  suggestion: Target | undefined,
  now: number,
  known: { sent?: Sent | undefined; signature?: string } = {},
): Recommendation {
  const own = threads.filter(t => t.source === 'linked')
  const thread = [...(own.length ? own : threads)].sort((a, b) => b.lastAt - a.lastAt)[0]
  if (thread) {
    const target = { sid: thread.sid, title: thread.title, suggested: false }
    // More than 60 days back is old whatever the weekends were: business time is only counted inside that.
    const recent = now - thread.lastAt <= OLD_THREAD_MS && businessMsBetween(thread.lastAt, now) <= RECENT_THREAD_MS
    if (!recent) return { state: 'start', reason: `last thread is from ${monthDay(thread.lastAt)}`, target }
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
  const o = it.open ?? null
  const drafts = !o ? '' : o.state === 'held_by_me' ? `${o.unsent} draft${o.unsent === 1 ? '' : 's'} not sent` : o.state === 'held_by_other' ? `drafts with ${o.by}` : o.state === 'stale' ? 'drafts out of date' : 'drafts ready'
  // for the founder, a package that waits for his OK: that first, and who sends it once he has given it; one a
  // teammate decides on, before its reply is due, says so instead (R2)
  const ok = it.kind === 'ok' ? (it.theirs ? decidesText(it.theirs) : `needs your OK · ${(it.ok ?? null)?.sends ?? NOBODY} sends`) : ''
  const parts = [ok, it.messages ? `${it.messages} message${it.messages > 1 ? 's' : ''} waiting` : '', it.tasks ? `${it.tasks} task${it.tasks > 1 ? 's' : ''} due` : '', drafts]
  return parts.filter(Boolean).join(', ') || 'drafts ready'
}

/**
 * R5: the one message that starts a client's reply in a thread. The Start chip carries it as its prompt and
 * Update sends it into the existing thread, with a first line saying what is new. Seven cases, the first
 * that holds (and, for the founder alone, an eighth between 2 and 3: a package that waits for his OK and
 * that somebody else sends, `okKickoff`):
 *   1. a package the person already picked up, with a draft not sent: carry on with it
 *   2. a prepared package that is theirs to pick up
 *   3. a package a teammate picked up: show what is waiting, run no prep, draft no second reply (and, for
 *      the founder, a stale package a teammate has, not held: the same, in words of its own)
 *   4. client messages waiting and a package marked out of date: pick it up and rebuild the drafts
 *   5. client messages waiting and a prepared package older than the window: pick it up
 *   6. client messages with no package yet
 *   7. committed tasks only (a package that is out of date, or another owner's, changes nothing here:
 *      the client is in the list for the task)
 */
export function kickoffText(it: QueueItem, opts: { update?: boolean; replaces?: Replaced | undefined } = {}): string {
  const id = it.projectId
  const who = `${it.projectName} (OW project ${id})`
  // (R17) nothing due: the kickoff says no due time (the clause is left out, never "due Invalid Date")
  const due = hasDue(it) ? dueText(it.dueAt) : ''
  const replyDue = due ? `, reply due ${due}` : ''
  const tasksDue = due ? ` due ${due}` : ''
  const o = it.open ?? null
  const body =
    o?.state === 'held_by_me' && it.packageId
      ? `[mm-link ${id}] Carry on with the reply drafts for ${who}. I already picked up package ${it.packageId.slice(0, 8)}: ${o.unsent} draft(s) not sent yet${o.newer > 0 ? `, and ${o.newer} client message(s) arrived since` : ''}. Load the client's project skill first, then follow client-reply-prep §9: read the package again, show the five-part pickup view and wait for me. Send nothing without my go.`
      : it.packageId
        ? `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package ${it.packageId.slice(0, 8)} and wait for me. Send nothing without my go.`
        : it.kind === 'ok' && o
          ? okKickoff(it, o)
        : o?.state === 'held_by_other'
          ? `[mm-link ${id}] ${who}: ${o.by} picked up the reply drafts (package ${o.id.slice(0, 8)}) and has ${o.unsent} not sent yet. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep and do not draft a second reply. Send nothing without my go.`
        : o && withHolder(o)
          ? // (the founder) a stale package a teammate has, not held: Opus's words, 10-13
            `[mm-link ${id}] ${who}: ${o.by} has the reply drafts (package ${o.id.slice(0, 8)}), and they are marked out of date. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep and do not draft a second reply. Send nothing without my go.`
          : o?.state === 'stale' && it.messages > 0
            ? `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Load the client's project skill first, then follow client-reply-prep §9: package ${o.id.slice(0, 8)} exists but is marked out of date, so pick it up, rebuild the drafts, then show the five-part pickup view and wait for me. Send nothing without my go.`
            : o?.state === 'prepared' && it.messages > 0
              ? `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package ${o.id.slice(0, 8)} and wait for me. Send nothing without my go.`
              : it.messages > 0
                ? `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the five-part pickup view and wait for me. Send nothing without my go.`
                : `[mm-link ${id}] ${who} has ${it.tasks} committed task(s)${tasksDue}. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`
  if (opts.update) return `New since this thread last worked on this client: ${waitingText(it)}.\n${body}`
  const handover = opts.replaces ? handoverText(it, opts.replaces) : ''
  return handover ? `${body}\n\n${handover}` : body
}

/**
 * The kickoff for a package that waits for the founder's OK and that somebody else sends (kind `ok`): he
 * is shown the package and what needs his OK. He does not pick it up, and nothing is drafted or sent.
 */
function okKickoff(it: QueueItem, o: NonNullable<QueueItem['open']>): string {
  const who = `${it.projectName} (OW project ${it.projectId})`
  const sends = (it.ok ?? null)?.sends ?? NOBODY
  return `[mm-link ${it.projectId}] ${who}: reply package ${o.id.slice(0, 8)} is flagged for my OK${o.state === 'stale' ? ' and is marked out of date' : ''}, and ${sends} sends it. Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for that package and what needs my OK, and wait for me. Do not pick the package up and do not draft a second reply. Send nothing without my go.`
}

/** The thread a new one takes over from: the app's id for it and its own title. */
export type Replaced = { sid: string; title: string }

/**
 * R8 (Rob, 2026-10-13): what Claim in this thread sends into the client's thread, in Rob's words: what the
 * server's check of our reply found still open. `at` is the time of that reply. The items are the feed's,
 * cleaned (queue.ts, checkOf).
 */
export function claimText(client: string, at: number, items: readonly string[], now: number): string {
  return `Still open for ${client} after our reply of ${clockText(at, now)}: ${items.join('; ')}. Load the client's project skill first, then follow client-reply-prep §9: show me what is still open and the drafts for it, and wait for me. Send nothing without my go.`
}

/** (fix round 1, L13) A chip's title is at most this many characters. */
export const CHIP_TITLE_MAX = 60
/** A chip's title, cut to CHIP_TITLE_MAX characters (the last one an ellipsis when it was cut). */
export const chipTitle = (title: string): string => (title.length > CHIP_TITLE_MAX ? `${title.slice(0, CHIP_TITLE_MAX - 1)}…` : title)

/**
 * R5 (Rob, 2026-10-13): the sentence a kickoff carries when the client already has a linked thread other than
 * the one starting (a chip copy started after another copy, or another thread, took the client): that thread
 * says which thread has the client, and stops.
 */
export function staleCopySentence(client: string): string {
  return `If ${client} already has a thread other than this one, tell me its name and stop: do not run prep, do not link this thread.`
}

/**
 * The kickoff of a new thread for a client (Start, a chip): 0.5.1's start kickoff, with the hand-over from the
 * client's old thread. One case 0.5.1 never listed (R8): a stale package of the viewer's whose check left items
 * open, with no client message and no task; its kickoff is the Claim message behind the client's marker.
 */
export function startKickoff(it: QueueItem, replaces: Replaced | undefined, now: number): string {
  const fast = fastState(it, now)
  const o = it.open ?? null
  if (fast?.state === 'still_open' && !it.packageId && it.messages === 0 && it.tasks === 0 && !(o && withHolder(o))) {
    const body = `[mm-link ${it.projectId}] ${claimText(it.client, fast.at, fast.items, now)}`
    const handover = replaces ? handoverText(it, replaces) : ''
    return handover ? `${body}\n\n${handover}` : body
  }
  return kickoffText(it, { replaces })
}

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
  // (a kickoff that shows no pickup view: tasks only, or a package a teammate holds or, stale, has)
  const o = it.open ?? null
  const before = it.packageId || it.kind === 'ok' || (it.messages > 0 && !(o && withHolder(o))) ? 'Before the pickup view' : 'Before showing me what is due'
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

export const LABEL = { update: 'Update thread', start: 'Start thread', open: 'Open thread', drafts: 'Drafts', claim: 'Claim in this thread' } as const
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

/**
 * How a row is drawn beyond its recommendation (0.5.2): `needsYou` for a row of the Needs-you list (R4 names a
 * client there with no thread at all), and `percent`, the context reading of the client's thread when it has a
 * fresh one (R8: at 60% or more, no Claim button; 0.5.11: and no chip for a new thread).
 */
export type RowOptions = { needsYou?: boolean; percent?: number | undefined }

export function rowFor(it: QueueItem, rec: Recommendation, now: number, opts: RowOptions = {}): Row {
  // a client whose drafts a teammate holds, and that is not the viewer's to act on: who to ask, and no action
  const withMate = withTeammate(it)
  // R8: the check of our reply left items open, and the client has a thread to claim them in
  const fast = withMate ? null : fastState(it, now)
  const still = fast?.state === 'still_open' && rec.target && !rec.target.suggested ? fast : null
  // R4: on the Needs-you list, no thread of any kind, and due within the pin's window
  const noThread = !withMate && opts.needsYou === true && rec.fresh === true && pinsNow(it, now)
  // R8: the server is checking our reply: the row is named as its thread is
  const checking = !withMate && fast?.state === 'checking' ? fast : null
  const title = checking ? checkingTitle(it.client, checking.at, now) : noThread ? noThreadTitle(it, now) : still ? stillOpenTitle(it.client) : titleFor(it, now)
  // (the founder) a package flagged for his OK that a teammate has, theirs to decide until its reply is due:
  // the row's sentence is followed by Opus's words, R2. A row with no sentence (a prepared package) gets no
  // line of them alone: its title and waiting text already say it (Opus, 10-13).
  const hold = withMate ? holdSentence(it) : ''
  const note = hold && it.theirs && it.kind === 'ok' ? `${hold} · ${MAY_NEED_OK}` : hold
  return {
    projectId: it.projectId, client: it.client, title, waiting: waitingText(it), state: rec.state, reason: rec.reason,
    // no thread of any kind: the row goes in the first group, marked
    fresh: rec.fresh === true,
    // the thread this row's button acts on: a press acts on this one or on none
    ...(rec.target ? { target: rec.target.sid } : {}),
    ...(note ? { note } : {}),
    // (the founder's alone, 0.5.1) a teammate's to see through: no action, with a sentence or without one
    ...(withMate && it.theirs ? { theirs: true } : {}),
    // R8: what is still open, drawn under the row, and whether its one action is Claim in this thread
    ...(still ? { stillOpen: [...still.items], claim: !(typeof opts.percent === 'number' && opts.percent >= LONG_CONTEXT_PERCENT) } : {}),
    ...(checking ? { checking: true as const } : {}),
  }
}

/** R8: a row whose client's reply left items open (the server's check). */
export const isStillOpenRow = (row: Row): boolean => Array.isArray(row.stillOpen) && row.stillOpen.length > 0

/** A row under `With a teammate`, or (R8) under `Checking your reply`: not the viewer's to act on now. */
const notMine = (row: Row): boolean => Boolean(row.note) || row.theirs === true || row.checking === true

/**
 * The buttons on a row: ONE action, chosen by its state, then Drafts (Rob, 2026-10-12: "it should be
 * 'update thread', 'open thread', or 'start thread'... depending on whether you know what we should do").
 * A row under `With a teammate` is not the viewer's to act on: Drafts alone.
 */
export function rowButtons(row: Row): RowButton[] {
  if (notMine(row)) return ['drafts']
  // R8: Claim in this thread while its context is under 60%; past that, Drafts alone (0.5.11: no chip for a new thread)
  if (isStillOpenRow(row)) return row.claim ? ['claim', 'drafts'] : ['drafts']
  const state = rowState(row)
  return [state === 'current' ? 'open' : state, 'drafts']
}

/**
 * The second line of a row: what is waiting, then the action and its reason, or when the thread was updated. A row with no action: what is waiting.
 * `here` (0.5.5): the thread drawing the pane. A reason that says "this thread" says so only there: anywhere else it names the client's thread.
 */
export function rowDetail(row: Row, here?: string): string {
  if (notMine(row) || isStillOpenRow(row)) return row.waiting
  const state = rowState(row)
  const reason = row.reason === UPDATED_HERE && !isHere(row, here) ? `new since ${row.client}'s thread was updated` : row.reason
  return state === 'current' ? `${row.waiting} · ${reason}` : `${row.waiting} · ${LABEL[state]}: ${reason}`
}

/** The reason recommend gives a thread that was updated before and has something newer since. */
const UPDATED_HERE = 'new since this thread was updated'
/** (0.5.5) Whether the thread a row acts on is the thread drawing the pane. */
const isHere = (row: Row, here: string | undefined): boolean => Boolean(here) && row.target === here
/** (0.5.5) The most characters of a button's label. */
export const LABEL_MAX = 40

/**
 * (0.5.5, Rob 10-14: in the Buy Oklahoma thread's pane, Black-Peak's row offered "Claim in this thread", as if it would
 * claim Black-Peak there) A row's button as it is drawn in the thread `here`: `Claim in this thread` only in the thread it
 * acts on; in any other, `Claim in <client>'s thread`, the client's name cut to keep the label within LABEL_MAX.
 */
export function buttonLabel(verb: RowButton, row: Row, here: string | undefined): string {
  if (verb !== 'claim' || isHere(row, here)) return LABEL[verb]
  const room = LABEL_MAX - "Claim in 's thread".length
  const client = row.client.length > room ? `${row.client.slice(0, room - 1).trimEnd()}…` : row.client
  return `Claim in ${client}'s thread`
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

export type Fold = 'checking' | 'teammate' | 'older'

/** The groups under the list as a pane holds them. */
export type Folds = { checking?: readonly Row[]; teammate?: readonly Row[]; older?: readonly Row[] }

/**
 * The groups under the list, in the order they are drawn: (0.5.2, R8, Opus decision 2) `Checking your reply
 * (n)`, then `With a teammate (n)`, then `Older (n)`. Each is closed until the person opens it, and one with
 * nobody in it is not drawn. Their rows are numbered on from the list's. Nobody in them is pinned, and the
 * header does not count them.
 */
export function foldGroups(queue: { rows: readonly Row[] } & Folds): Array<{ key: Fold; heading: string; rows: Array<{ row: Row; n: number }> }> {
  const checking = Array.isArray(queue.checking) ? queue.checking : []
  const teammate = Array.isArray(queue.teammate) ? queue.teammate : []
  const older = Array.isArray(queue.older) ? queue.older : []
  const numbered = (group: readonly Row[], from: number) => group.map((row, i) => ({ row, n: from + i + 1 }))
  const groups: Array<{ key: Fold; heading: string; rows: Array<{ row: Row; n: number }> }> = [
    { key: 'checking', heading: `Checking your reply (${checking.length})`, rows: numbered(checking, queue.rows.length) },
    { key: 'teammate', heading: `With a teammate (${teammate.length})`, rows: numbered(teammate, queue.rows.length + checking.length) },
    { key: 'older', heading: `Older (${older.length})`, rows: numbered(older, queue.rows.length + checking.length + teammate.length) },
  ]
  return groups.filter(g => g.rows.length > 0)
}

/**
 * The pane as plain text, one line per thing drawn: for tests and for a surface that draws no buttons. `folds` are the groups under the list, each drawn open.
 * `here` (0.5.5): the thread drawing it, as for `rowDetail` and `buttonLabel`.
 */
export function paneText(rows: readonly Row[], header: string, note: string, folds: Folds = {}, here?: string): string {
  const out = [header]
  const draw = (row: Row, lead: string): void => {
    out.push('', `${lead} ${row.title}`, `   ${rowDetail(row, here)}`)
    if (row.note) out.push(`   ${row.note}`)
    for (const item of isStillOpenRow(row) ? (row.stillOpen as string[]) : []) out.push(`   - ${item}`)
    out.push(`   ${rowButtons(row).map(b => `[ ${buttonLabel(b, row, here)} ]`).join(' ')}`)
  }
  for (const group of rowGroups(rows)) {
    out.push('', group.heading)
    for (const { row, n, mark } of group.rows) draw(row, `${mark}${n}.`)
  }
  for (const group of foldGroups({ rows, ...folds })) {
    out.push('', group.heading)
    for (const { row, n } of group.rows) draw(row, `${n}.`)
  }
  out.push('', note)
  return out.join('\n')
}

// ---------------------------------------------------------------- the band (R9)

/** The pane's one line when the refresh after a press failed (Opus, 10-13, L3): until the next sync that works. Also the band's, when the last read failed (R9). */
export const REFRESH_FAILED = 'Couldn\'t refresh the list. Showing what was last loaded.'

/** The band's words for what it carries, in the order R9 sets: its first line, then the alert that is most specific. */
export type BandFacts = {
  /** Threads the last sync pinned. */
  pinned: number
  /** Whether anything on the list pins now (past, or within the next 24 business hours). */
  pinsNow: boolean
  /**
   * R4: clients on the list due within that window with no thread at all, soonest first, with their due times, and
   * (0.5.4, C3) the thread their one chip is in, as `threadTitleShort` names it, when there is one.
   */
  noThread: Array<{ client: string; due: string; chipIn?: string | undefined; chipHere?: boolean | undefined }>
  /** (0.5.4, C2) The other threads that hold a chip for a client of the person's with a thread, one entry each, by name. */
  chipsElsewhere?: string[]
  /** (0.5.5) A later mm-bridge installed on this machine than the one this thread runs: its version. */
  newer?: string | undefined
  /** (0.5.7) Lines the band shows in every thread for a while: a thread started by itself, the hourly cap reached. */
  notes?: string[]
  /** R8: the first client still open after our reply, with a thread to claim it in. */
  stillOpen?: string | undefined
  /** R9: the first client whose pinned thread has an update ready to claim. */
  update?: string | undefined
  /** The last sync failed, or is older than STALE_SYNC_MS: never an all-clear from it. */
  stale: boolean
  /** (fix round 1, F6) The person's own clients listed under Older: more than 3 business days overdue. */
  older?: number
}

/**
 * R9 (Rob, 2026-10-13: "the band line is the alert"; and "yes band": the line always states the full truth, so an
 * empty Pinned list can never read as all clear while someone still needs the person). Its words, verbatim:
 *   something pinned, no client without a thread   `Needs you: <n> pinned.`
 *   clients without a thread (R4)                  `Needs you: <n> pinned · <m> with no thread: <names>.`, and for
 *                                                  one client, R9's open-a-thread line after it
 *   a client still open after our reply (R8)       ` · <client> still open after your reply.` on the first line
 *   an update ready on a pinned thread             R9's line after the first
 *   nothing within 24 business hours, no client    `Nothing needs you in the next 24 hours.`
 *   without a thread
 *   the last read failed or is stale               0.5.1's refresh-failed line, and never the all-clear one
 * (0.5.4, Rob 10-14 "yes chips", verbatim) A client's chip is in one thread only:
 *   chips of clients with a thread, elsewhere (C2) ` · a chip is ready in <thread>` on the first line, or
 *                                                  ` · chips ready in <n> threads` for more than one
 *   a client with no thread whose chip exists (C3) `🔴 <client> has no thread (due <due>): its chip is in <thread>.`,
 *                                                  in every thread, for each such client; (0.5.6) in any thread but
 *                                                  that one, followed by ` Press Start thread in the pane to bring it here.`
 * (0.5.5, Rob 10-14, verbatim) A later mod installed than this thread runs: ` · A newer Claude mod (<version>) is
 * installed: quit and reopen Claude to load it.` at the end of the first line (of the last, when there is no first).
 */
export function bandText(f: BandFacts): string {
  const out: string[] = []
  const older = Number(f.older) || 0
  const elsewhere = f.chipsElsewhere ?? []
  let first = ''
  if (f.noThread.length) first = `Needs you: ${f.pinned} pinned · ${f.noThread.length} with no thread: ${f.noThread.map(n => n.client).join(', ')}.`
  else if (f.pinsNow || f.pinned > 0 || f.stillOpen) first = `Needs you: ${f.pinned} pinned.`
  // (fix round 1, F6) never all clear while the person's own clients wait under Older
  else if (!f.stale) first = older > 0 ? `Nothing due in the next 24 hours · ${older} older overdue.` : 'Nothing needs you in the next 24 hours.'
  // R8, when no client without a thread comes before it
  if (first && !f.noThread.length && f.stillOpen) first = `${first.replace(/\.$/, '')} · ${f.stillOpen} still open after your reply.`
  // F6: the other forms say how many wait under Older
  if (first.startsWith('Needs you:') && older > 0) first = `${first.replace(/\.$/, '')} · ${older} older overdue.`
  // (0.5.4, C2) where the chips of the person's clients with a thread are, when not here
  if (first.startsWith('Needs you:') && elsewhere.length) first = `${first.replace(/\.$/, '')} · ${elsewhere.length === 1 ? `a chip is ready in ${elsewhere[0]}` : `chips ready in ${elsewhere.length} threads`}.`
  // (0.5.5) a later mod installed on this machine
  const newer = f.newer ? `A newer Claude mod (${f.newer}) is installed: quit and reopen Claude to load it.` : ''
  if (first && newer) first = `${first.replace(/\.$/, '')} · ${newer}`
  if (first) out.push(first)
  // (0.5.4, C3) each client with no thread whose one chip exists: where it is; (0.5.6) and, in any other thread
  // than that one, that Start thread brings it here
  for (const n of f.noThread) {
    if (!n.chipIn) continue
    out.push(`🔴 ${n.client} has no thread (due ${n.due}): its chip is in ${n.chipIn}.${n.chipHere ? '' : ' Press Start thread in the pane to bring it here.'}`)
  }
  const one = f.noThread.length === 1 ? f.noThread[0] : undefined
  if (one && !one.chipIn) out.push(`Open a thread for ${one.client} (due ${one.due}): type /mm start ${one.client}.`)
  else if (!f.noThread.length && !f.stillOpen && f.update) out.push(`An update is ready to claim in the ${f.update} thread.`)
  // (0.5.7) a thread started by itself, the hourly cap reached: for a while, in every thread
  for (const note of f.notes ?? []) out.push(note)
  if (f.stale) out.push(REFRESH_FAILED)
  // (with no first line, after the last one there is)
  if (newer && !first) {
    const tail = out.pop()
    out.push(tail ? `${tail.replace(/\.$/, '')} · ${newer}` : newer)
  }
  return out.join(' ')
}
