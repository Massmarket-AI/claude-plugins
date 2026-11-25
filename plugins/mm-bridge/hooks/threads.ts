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

import type { MmRow, MmTeam } from '../types'

import {
  ANSWER_LABEL, isAnswerType,
  MAY_NEED_OK, NOBODY, assignAsksOf, assignOnly, checkingTitle, cleanText, cleanTitle, clockAndDue, clockText, committedCount, decidesText, etaAsksOf, etaOnly, fastState, hasDue, heldInternal, holdSentence, isUuid, matesOf, openAsks,
  checkNow, clientDueOf, internalBehindAt, leadDueOf, newestFirst, olderTotal, ownPins, pinsFor, queueLine, queueMore, queueTotal, queuedOf, rowLine, shownDue, shownQueue, shownText, skillFor, stillOpenTitle, tasksBesidesUndated, titleNames, undatedCount, undatedOnly, whoseLate, withHolder, withTeammate,
  TEAM_BEHIND, TEAM_LATE, lateOnly, teamLate, teamLateCount, teamLateLine, teamLateSplit,
  goOf, goOnly, goWithMail, stepWord,
  NO_REPLY_WHAT, afterPackage, checkDot, noReplyNow, owesNoReply, paceOf, paceOnly, paceStatus, paceWord, statusOf,
} from './queue'
import type { AnswerType, AskRef, FeedThread, QueueItem, StatusDot } from './queue'
import { wallTime } from './business-time'

const TZ = 'America/New_York'

// (0.5.11, Rob 10-15: "Can you just automatically compress context at 60% instead of 100% to save tokens?") A thread's
// length decides nothing any more: Claude Code compacts a long thread (CLAUDE_AUTOCOMPACT_PCT_OVERRIDE), so it is
// never one to replace, and its row offers Claim whatever its length.
// (0.7.6, Rob 2026-10-27: "we should always pin the most recent thread from that client") Nor does its age:
// RECENT_THREAD_MS (7 business days) and OLD_THREAD_MS (60 days) are gone. A client's thread is updated however long
// ago it was last active (compaction keeps it usable, as decided 10-15), and Start is only for a client with no thread
// of its own.

/** A thread as the desktop app lists it. `link` is the app's own link to it, kept only when it is that thread's. */
/** (0.7.10) `cwd`: the folder the app says the thread runs in (the folder it was started in, never where its shell moved to). */
/**
 * (0.7.28) `scheduled`: the app said this thread is a scheduled task's run (`get_session`'s `scheduledTaskId`; its list does not
 * say). `byId`: this is its answer by id, so a thread without `scheduled` is known not to be one.
 */
/**
 * (0.7.44, Rob 2026-11-10: "when I pin a thread, it pins everything that's its child into the pinned section too")
 * `parentSessionId` and `detached`: `get_session`'s word for a thread another session started (`detached` true once it was
 * moved to top level); `startedBy`: the app's list's word for the same, on a linked session's row.
 */
export type AppThread = {
  sessionId: string
  title?: string
  pinned?: boolean
  isArchived?: boolean
  lastActivityAt?: string
  link?: string
  cwd?: string
  scheduled?: boolean
  byId?: boolean
  parentSessionId?: string
  detached?: boolean
  startedBy?: string
  /**
   * (0.7.64) The app says the thread is in the middle of a turn (`isRunning`). A message sent to it now is held by the app
   * and delivered when the turn ends, however long that takes and whatever has changed by then.
   */
  running?: boolean
}

/**
 * (0.7.44) Whether the app's answer for a thread says it is a child of another thread, still nested under it: it names the
 * thread that started it (`parentSessionId` by `get_session`, `startedBy` by the list) and it was not moved to top level.
 */
export const isChildThread = (t: Pick<AppThread, 'parentSessionId' | 'startedBy' | 'detached'> | null | undefined): boolean =>
  Boolean(t && (t.parentSessionId || t.startedBy) && t.detached !== true)

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
  /**
   * (0.5.23) True when the client's linked thread is in the person's other Claude profile on this computer: the link
   * is kept, and here the row offers Start (the person's press opens a thread here) while nothing is started or sent
   * by itself. Start missing threads counts such a client as one with no thread here.
   */
  away?: true
  /**
   * (0.7.10, Rob 2026-10-28: one thread per client, and Start only for a client that never had one) The client's newest
   * own thread, which the app here shows archived and the sync did not bring back by itself (the app refused or did not
   * answer, the person archived it again, the bridge is paused, or it waits behind this sync's REVIVALS_PER_SYNC): the
   * row offers Restore thread, never Start, and Start missing threads and `kickoffs` leave the client out.
   */
  archived?: string
  /**
   * (0.7.11, Rob 2026-10-30: "I don't think we need to be creating threads for people that haven't been active or sent us
   * anything for more than a couple months") A `start` for a client that is not ACTIVE (nothing of theirs waiting, no
   * message from them in the last ACTIVE_WINDOW_MS) and has nothing due for the viewer: its row stays, with no Start, and
   * Start missing threads, the profile-switch band and `kickoffs` leave it out. A new message from the client lifts it on
   * the next sync.
   */
  dormant?: true
}

/** (0.7.11) What a quiet client's row says where Start would have been. */
export const DORMANT_REASON = 'nothing from them in 6 weeks'

/**
 * (0.5.23) A client's row when its linked thread is in another Claude profile: Start, and why. (0.7.11) Only while it has
 * no thread of its own in this profile: one it has here is linked instead (`mm.profileLinks`).
 */
export const AWAY_REASON = 'its thread is in another Claude profile'

/** (0.7.10) A client's row when its own thread is archived and was not brought back by itself: Restore, and why. */
export const ARCHIVED_REASON = 'its thread is archived'

/**
 * What Update last put into a client's thread: which thread, the signature of what it carried, and when.
 * (0.5.11, review of PR #15, F3) `prep`: it went by itself and asked the thread to build the client's package
 * (kickoff case 6, `asksForPrep`): the package that then appears is the thread's own work, not something new for it.
 * (0.7.14) `wait`: it went by itself while Lane-2 could still build the client's reply drafts (`draftsComing`): the thread
 * was told they follow, not asked to build them, so the package Lane-2 then builds is something new for it (a second
 * update), and if none comes the thread is asked to build one (`prepDue`).
 */
export type Sent = { sid: string; sig: string; at: number; prep?: true; wait?: true }

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
 * bridge made to such a thread is undone is not decided by the feed (0.5.23: only by its thread's archive or deletion, or B3).
 */
export function onlyClients(projectId: string, sid: string, feedThreads: readonly FeedThread[], pairs: Pairs, marked: Readonly<Record<string, string>> = {}): boolean {
  return !declaredOther(projectId, sid, feedThreads, pairs, marked) && soleClient(sid, feedThreads, pairs) === projectId
}

/**
 * What becomes of a link the bridge made by itself, by this sync's feed (0.5.23: `unlisted` no longer undoes it; the
 * sync sets its count of misses back to 0):
 *   stays     its thread's sessions declared this client alone (`onlyClients`), or (0.5.9) the feed lists
 *             none of them and the thread opened with this client's own [mm-link] marker
 *   goes      something makes the thread another client's too (`declaredOther`: a row for another project,
 *             a row OW marks `sole: false`, a marker for another client): let go on this sync (B3)
 *   unlisted  the feed lists none of its sessions: (until 0.5.22) the sync counted a miss; (0.5.23) it stays
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
 * (0.5.23) The threads that opened with this client's own [mm-link] marker, as the bridge recorded each one when its
 * opening message came in (`mm.marked`, with when: `mm.markedAt`): the threads a client with no linked thread takes
 * back, newest first (when its marker was recorded; for a marker with no time on record, when its thread started; else
 * last). The app's records hold no thread's opening message, and the bridge reads no transcript, so this record of
 * its own is the only place the marker can be read from.
 * ⛔ Never a thread linked to any client, one the person unlinked, one a client was moved off (`released`), one reached
 * by sessions of more than one client (`shared`), or one the feed or a marker gives to another client (`declaredOther`).
 * ⛔ Only the marker counts: a title never does, and a session's declaration is R1's (`autoLinkFor`).
 * Whether each is still open (not archived, not deleted) is the caller's to find out.
 * (0.7.6) From 0.7.6 `mm.marked` also records the marker an Update carried into a thread (the bridge's own send, which
 * the thread's hook never reads as a marker: it does not open the thread, and it is not the person's prompt), and the
 * link of a linked thread the app showed archived, when its link went: see `ownThreads`.
 */
export function markedThreads(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  skip: OwnSkip = {},
): string[] {
  return byNewest(markedOf(projectId, links, feedThreads, pairs, skip)).map(o => o.sid)
}

/**
 * (0.7.64, Rob 2026-11-19: "I noticed that even the old pinned bridge threads are still getting updated every time there's
 * something new from the client... Once there's a new bridge thread, the old ones should stop being updated.") The thread
 * that replaced `sid` for client `pid`, when `sid` is an OLDER bridge thread of the client: it carries the client's own
 * [mm-link] marker (`marked`: it opened with it, or an Update carried it in), and the client's linked thread is another
 * one whose marker for the client was recorded LATER (`markedAt`). Undefined for anything else: the linked thread
 * itself, a thread of no marker or another client's, a second thread opened with the marker AFTER the linked one (R5, a
 * second thread by the person's own start), or a time not on record for either.
 * Read from the links as they are NOW, so it never outlives them: the person's /mm link in the old thread makes it the
 * linked one again, and it is not replaced; a client with no linked thread has no replaced thread. What it changes is the
 * bridge's own reading of the old thread (`currentIn`: not one of the client's current threads, no client part in its
 * pane). Updates, auto-updates and the reply-ready note already go to the linked thread alone, and the pin follows the
 * link, so nothing else needs this rule.
 */
export function replacedBy(
  sid: string,
  pid: string,
  links: Readonly<Record<string, string>>,
  marked: Readonly<Record<string, string>>,
  markedAt: Readonly<Record<string, number>>,
): string | undefined {
  const linked = Object.hasOwn(links, pid) ? links[pid] : undefined
  if (!linked || linked === sid || !THREAD_ID.test(sid) || !THREAD_ID.test(linked)) return undefined
  if (marked[sid] !== pid || marked[linked] !== pid) return undefined
  const was = markedAt[sid]
  const now = markedAt[linked]
  return typeof was === 'number' && typeof now === 'number' && Number.isFinite(was) && Number.isFinite(now) && was < now ? linked : undefined
}

/** (0.7.6) What `markedThreads` and `ownThreads` pass over, and the records they read. */
type OwnSkip = {
  unlinked?: Readonly<Record<string, unknown>>
  released?: readonly string[]
  marked?: Readonly<Record<string, string>>
  markedAt?: Readonly<Record<string, number>>
  shared?: ReadonlySet<string>
}

/** (0.7.6) Newest first; a tie by id, so every session orders them alike. */
const byNewest = (list: Array<{ sid: string; at: number }>): Array<{ sid: string; at: number }> =>
  list.sort((a, b) => (b.at === a.at ? (a.sid < b.sid ? -1 : 1) : b.at > a.at ? 1 : -1))

/** (0.7.6) Whether a thread is one a client with no linked thread may take back or bring back by itself (`markedThreads`'s rules). */
function mayTakeBack(projectId: string, sid: string, links: Readonly<Record<string, string>>, feedThreads: readonly FeedThread[], pairs: Pairs, skip: OwnSkip, shared: ReadonlySet<string>): boolean {
  if (!THREAD_ID.test(sid)) return false
  if (ownerOf(sid, links) !== undefined || sid in (skip.unlinked ?? {}) || (skip.released ?? []).includes(sid) || shared.has(sid)) return false
  return !declaredOther(projectId, sid, feedThreads, pairs, skip.marked ?? {})
}

/** The threads `markedThreads` gives, each with when its marker was recorded (else when its thread started). */
function markedOf(projectId: string, links: Readonly<Record<string, string>>, feedThreads: readonly FeedThread[], pairs: Pairs, skip: OwnSkip): Array<{ sid: string; at: number }> {
  const marked = skip.marked ?? {}
  const shared = skip.shared ?? sharedThreads(feedThreads, pairs)
  const out: Array<{ sid: string; at: number }> = []
  for (const [sid, pid] of Object.entries(marked)) {
    if (pid !== projectId || !mayTakeBack(projectId, sid, links, feedThreads, pairs, skip, shared)) continue
    const at = skip.markedAt?.[sid]
    out.push({ sid, at: typeof at === 'number' && Number.isFinite(at) ? at : (threadStart(sid, pairs) ?? -Infinity) })
  }
  return out
}

/**
 * (0.7.6, Rob 2026-10-27: "we should always pin the most recent thread from that client") A client's OWN threads, newest
 * first: what a client with no linked thread takes back (an open one) or brings back from the archive (an archived one)
 * before its row offers Start. Two records say a thread is the client's own:
 *   the marker    `markedThreads`: the thread opened with the client's [mm-link] marker, or (0.7.6) an Update carried
 *                 that marker into it, or (0.7.6) it was the client's linked thread when the app showed it archived
 *   the last send `given` (`mm.sent`): the thread the bridge last gave this client's kickoff to, dated when it went.
 *                 Every Update carries the client's marker, and before 0.7.6 that was recorded nowhere else (Leader
 *                 Transcend, 10-27: a thread holding an Update with its marker, unlinked, and a new thread offered)
 * A thread in both is dated by the later of the two. ⛔ Every rule of `markedThreads` holds for each: never a thread
 * linked to any client, one the person unlinked, one a client was moved off (`released`), one reached by sessions of
 * more than one client (`shared`, B3), or one the feed or a marker gives to another client (`declaredOther`).
 * Whether each is still open, archived or gone is the caller's to find out.
 */
export function ownThreads(
  projectId: string,
  links: Readonly<Record<string, string>>,
  feedThreads: readonly FeedThread[],
  pairs: Pairs,
  skip: OwnSkip & { given?: Sent | undefined } = {},
): string[] {
  const shared = skip.shared ?? sharedThreads(feedThreads, pairs)
  const out = markedOf(projectId, links, feedThreads, pairs, { ...skip, shared })
  const g = skip.given
  if (g && typeof g === 'object' && typeof g.sid === 'string' && mayTakeBack(projectId, g.sid, links, feedThreads, pairs, skip, shared)) {
    const at = Number.isFinite(g.at) ? g.at : -Infinity
    const same = out.find(o => o.sid === g.sid)
    if (same) same.at = Math.max(same.at, at)
    else out.push({ sid: g.sid, at })
  }
  return byNewest(out).map(o => o.sid)
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
 * (0.7.3, internal queue) The queue is read as its listed tickets alone, without its total: a ticket that comes or goes
 * below the top QUEUE_SHOWN_MAX is not something new for the thread, a change to the top of the queue is.
 * (0.7.4) And without the tickets nobody dated: one that comes or goes is not something new for the thread either (Rob,
 * 2026-10-27: "It doesn't necessarily create the need for a new reply"). They ride along with what is.
 * (0.7.39) And in the words from before 0.7.39 where only the words changed: the page's name (`PAGE_WORDS`), and a package that owes
 * no reply, with nothing from the client after it. A thread that has the package already has that, so a change of words
 * updates nobody's thread: every thread with an open package would get a turn for nothing, one waiting on its person too.
 */
export function signatureOf(it: QueueItem): string {
  const o = it.open ?? null
  const mine = o?.state === 'held_by_me'
  // A package is read as it was before anyone picked it up, and without how many of its drafts are left:
  // picking it up or sending one of its drafts is not something new for the thread that has it.
  const unpicked: QueueItem = mine ? { ...it, open: null } : o ? { ...it, open: { ...o, unsent: 0 } } : it
  // (0.7.3) the queue's total is not something new; (0.7.56) neither are the words of a ticket's activity (`new today` is
  // `new yesterday` after midnight) nor the tickets under the Older toggle (never in a kickoff): its order and its top are
  const queuedPlain: QueueItem = queuedOf(it).length
    ? { ...unpicked, queue: newestFirst(it) ? { tickets: queuedOf(it).map(q => ({ ...q, when: '' })), total: 0, newest: true } : { tickets: queuedOf(it), total: 0 } }
    : unpicked
  const nodate = undatedCount(it)
  const plain: QueueItem = nodate ? { ...queuedPlain, tasks: it.tasks - nodate, undatedTitles: [], undatedTasks: 0 } : queuedPlain
  const said = owesNoReply(plain) && afterPackage(it) === 0 ? withoutNoReply(plain) : plain
  return [kickoffText(said).split(PAGE_WORDS).join(PAGE_WORDS_BEFORE), it.coversThrough ?? '', mine ? `held:${o.newer}` : (it.packageUpdatedAt ?? '')].join('\n')
}

/** (0.7.39) What the kickoffs call the page client-reply-prep §9.3 prints, and what they called it before 0.7.39 (`signatureOf`). */
const PAGE_WORDS = 'the one-package page'
const PAGE_WORDS_BEFORE = 'the five-part pickup view'

/** (0.7.39) An item as it reads with no word of its package owing no reply (`signatureOf`). */
function withoutNoReply(it: QueueItem): QueueItem {
  const { noReply: _item, ...rest } = it
  const o = rest.open ?? null
  if (!o?.noReply) return rest
  const { noReply: _open, ...open } = o
  return { ...rest, open }
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

/**
 * (0.5.11) Something new for a client goes into its thread by itself only once this bridge has seen it, unchanged,
 * for this long (review of PR #15, F3: measured from when the bridge first saw it, `FirstSeen`, never from the feed's
 * times: the live feed gives no time for a package's drafts, and a message's time says nothing of them).
 */
export const AUTO_QUIET_MS = 10 * 60_000
/**
 * (0.5.11, review of PR #15, F3) With client mail waiting and no package at all, Lane-2 may still build the reply drafts
 * this long after the bridge first saw the oldest waiting message. OW holds its own notice 120 minutes, and Lane-2 aims
 * to have the drafts ready in 60: the thread is not asked to build them while Lane-2 still may.
 * (0.7.14, Rob 2026-10-30: "It should automatically update") Until 0.7.14 the update itself waited this long for the
 * drafts. It goes after AUTO_QUIET_MS now, saying the drafts follow (`draftsComing`); this is when a thread whose drafts
 * never came is asked to build them (`prepDue`).
 */
export const AUTO_NO_DRAFTS_MS = 120 * 60_000

/**
 * (0.5.11, review of PR #15, F3) What this bridge has seen of a client on the person's own list, as the syncs had it
 * (`mm.firstSeen`): what it has now (`sig`, a short hash of its signature), since when this bridge has seen exactly that
 * (`at`), and since when client mail has been waiting without a break (`mail`; 0: none waits).
 */
export type FirstSeen = { sig: string; at: number; mail: number }

/** (0.5.11, review of PR #15, F3) `FirstSeen` for a client as a sync at `at` has it, from what was seen before. */
export function seenNow(prev: FirstSeen | undefined, it: QueueItem, sig: string, at: number): FirstSeen {
  const kept = (t: unknown): number => (typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= at ? t : 0)
  const since = prev && prev.sig === sig ? kept(prev.at) : 0
  const mail = it.messages > 0 ? kept(prev?.mail) || at : 0
  return { sig, at: since || at, mail }
}

/**
 * (0.5.11, review of PR #15, F3) Kickoff case 6: client mail waiting and no package at all, so the thread is asked
 * to build one (prep). Sent by itself, the package that then appears is the thread's own work (`Sent.prep`).
 */
export const asksForPrep = (it: QueueItem): boolean => it.messages > 0 && !it.packageId && !(it.open ?? null) && it.kind !== 'ok' && !goWithMail(it)

/**
 * (0.5.11, Rob 10-15: "I think we should start updating threads automatically") Whether a client on the person's
 * own list is one whose thread may be updated by itself: never one a teammate has (`withTeammate`; the founder's
 * `theirs`), never one whose package someone else holds (`withHolder`), never one whose reply the server is
 * checking or found still open (R8: Claim is the person's press), and never an internal project's (as no thread
 * is started by itself for one). (0.5.28, internal asks) Except the Massmarket internal thread's while it has an open
 * ask (`heldInternal`): it is updated like a client's. (0.7.3) So it is while the viewer has an internal queue.
 */
export function autoUpdatable(it: QueueItem, now: number): boolean {
  const o = it.open ?? null
  // (0.7.4) never for the viewer's undated client tickets alone (`undatedOnly`): they ride along with what does update it
  // (0.7.27) nor for its pace row alone: quoted work left is nothing new for its thread
  return !heldInternal(it) && !it.theirs && !withTeammate(it) && !(o && withHolder(o)) && fastState(it, now) === null && !undatedOnly(it) && !paceOnly(it)
}

/**
 * (0.5.23, Rob 2026-10-21: "change auto-starts to update the older thread") The thread an update sent by itself goes
 * to, from the client's recommendation as the last sync stored it (`rec`) and the client's linked thread (`linked`):
 * the row says Update, and its thread is the linked one.
 * (0.7.6) Until 0.7.6 a second case, `older`: a row that said Start because its linked thread was older than 7 business
 * days had that same thread updated instead. A row never says Start for a thread's age any more (`recommend`), so an old
 * linked thread's row says Update and lands in the case above; a row a sync before 0.7.6 stored with Start is no
 * target (the next sync stores it again).
 * ⛔ Only ever the client's LINKED thread, and never one its row only suggests by a title: every guard of an update
 * sent by itself still applies (`autoUpdates`). A client with no linked thread gets none here (nothing is started by
 * itself: it takes back or brings back a thread of its own first, else its row waits for the person's Start), and
 * neither does a client whose thread is not its linked one (the person unlinked it). A person's Start, Start missing
 * threads and /mm start are not decided here.
 * (0.7.14) `followUp`: the thread is due the follow-up that asks it for prep (`prepDue`): it has what is waiting, so its
 * row says so (`current`), and that row's thread is the target too.
 */
export function autoUpdateTarget(rec: Recommendation | undefined, linked: string | undefined, followUp = false): { sid: string } | undefined {
  const target = rec?.target
  if (!rec || !target || target.suggested || !THREAD_ID.test(target.sid) || target.sid !== linked) return undefined
  // (0.7.14) the follow-up that asks for prep (`prepDue`) goes to a thread that has what is waiting: its row says so
  return rec.state === 'update' || (followUp && rec.state === 'current') ? { sid: target.sid } : undefined
}

/**
 * (0.5.11, Rob 10-15: "[A client]'s call ended a little while back... I don't understand why it
 * hasn't already handed the new context there so the draft is ready when I open the thread up") Whether it is time
 * to update a client's thread by itself, from what this bridge has seen of the client (`seen`, for what it has
 * NOW: the caller gives the record of this signature only): the bridge has seen it, unchanged, for AUTO_QUIET_MS.
 * Never the feed's own times.
 * (0.7.14, Rob 2026-10-30: "I'm not sure why I need to click Update. It should automatically update") Until 0.7.14, with
 * client mail waiting, it also waited for the reply drafts, up to AUTO_NO_DRAFTS_MS: Jason's email of 10-30 sat on his
 * pinned thread's row as Update for two hours while Lane-2 had not drafted. The mail goes in now, saying the drafts
 * follow (`draftsComing`), and the drafts go in as a second update when they are ready: they are something new for the
 * thread (its signature changes).
 */
export function autoUpdateDue(seen: FirstSeen | undefined, now: number, pace: Pace = 'quiet'): boolean {
  return Boolean(seen) && now >= selfUpdateAt(seen as FirstSeen, pace)
}

/**
 * (0.7.76, Rob 2026-11-24, of Peter MD's call: "Update should have hit as soon as the transcript finished processing") How
 * long an update sent by itself waits after this bridge first saw what the client has now (`FirstSeen.at`):
 *   now       a reply package this thread has not been given, its drafts stored and finished: at once
 *   building  the same package while Lane-2's build helper may still rewrite its drafts (the feed's `building`): until it
 *             is done, and at most BUILD_HOLD_MS
 *   quiet     anything else (mail, tasks, asks, a package OW cannot say is finished): AUTO_QUIET_MS, as before 0.7.76
 * Until 0.7.76 every update waited AUTO_QUIET_MS: on 2026-11-23 Peter MD's drafts were stored at 22:25:51 UTC, first seen
 * by the sync at 22:28:56, due at 22:38:56, and sent from the next sync, at 22:41:05.
 */
export type Pace = 'now' | 'building' | 'quiet'

/**
 * (0.7.76) The longest an update by itself waits for Lane-2's build helper (`Pace` building), from when this bridge first
 * saw the client as it is now. The helper has 15 minutes (client-reply-prep references/build-run.md) and OW stops calling a
 * package building 20 minutes after its newest draft write; this only bounds a feed that keeps saying so.
 */
export const BUILD_HOLD_MS = 30 * 60_000

/**
 * (0.7.76) A reply package is on the item for the viewer to work, not held by anyone: its drafts are stored (or it owes no
 * reply), and the thread is to show its page. The package a thread asked to build is not this (`ownPackage` comes first).
 */
export function readyPackage(it: QueueItem): boolean {
  return Boolean(it.packageId) && it.kind === 'ready' && !(it.open ?? null)
}

/**
 * (0.7.76) Whether a thread given `had` (the signature stored when Update went, `Sent.sig`) was given this package as it is
 * now: its id in the words, and the same `covers_through` and `updated_at` (the last two lines of `signatureOf`). A package
 * revised in place (Peter MD's 45138705 on 11-23: same id, new drafts, a newer `covers_through`) is a package not given.
 */
export function packageGiven(had: string, it: QueueItem): boolean {
  if (!it.packageId || !had.includes(`package ${it.packageId}`)) return false
  const lines = had.split('\n')
  return lines.at(-2) === (it.coversThrough ?? '') && lines.at(-1) === (it.packageUpdatedAt ?? '')
}

/**
 * (0.7.76) How soon an update by itself goes into thread `sid` for `it` (`Pace`). `given`: what the bridge last gave the
 * client's thread (`mm.sent`). `knows`: this computer has a fresh answer from an OW that says when a package is still being
 * built (`GET /drafts-pulse`, the same release as the feed's `building`). ⛔ Without it, every update waits AUTO_QUIET_MS, as
 * before 0.7.76: an OW that cannot say so would have a thread show a package whose drafts the build helper is still
 * rewriting (about one package in seven, measured on 316 packages from 2026-11-10 to 11-24), against Rob's rule of
 * 2026-11-05 that the build is done before anyone sees the package.
 */
export function updatePace(it: QueueItem, given: Sent | undefined, sid: string, knows: boolean): Pace {
  if (!knows || !readyPackage(it)) return 'quiet'
  if (given && given.sid === sid && packageGiven(given.sig, it)) return 'quiet'
  return it.building ? 'building' : 'now'
}

/**
 * (0.7.14) Lane-2 may still build the client's reply drafts: client mail waits with no package at all (kickoff case 6,
 * `asksForPrep`), and the bridge first saw the oldest waiting message less than AUTO_NO_DRAFTS_MS ago (or has no record
 * of it yet). An update sent by itself then says the drafts follow (kickoffText's `wait`), never asks for prep.
 */
export function draftsComing(it: QueueItem, now: number, seen: FirstSeen | undefined): boolean {
  return asksForPrep(it) && !(seen && seen.mail > 0 && now - seen.mail >= AUTO_NO_DRAFTS_MS)
}

/**
 * (0.7.14) The thread was updated by itself while the drafts could still come (`Sent.wait`), with what the client has
 * now, and they did not come: still no package, AUTO_NO_DRAFTS_MS after the oldest waiting message was first seen. Its
 * follow-up asks it to build them (case 6 sent by itself), as 0.5.11's one update did at that time.
 */
export function prepDue(given: Sent | undefined, sid: string, it: QueueItem, now: number, seen: FirstSeen | undefined): boolean {
  return !!given && given.wait === true && given.sid === sid && hasWaiting(given.sig, it) && asksForPrep(it) && !draftsComing(it, now, seen)
}

/**
 * (0.7.9, Rob 2026-10-29: "It seems like the threads aren't auto-updating anymore. They're not repinning themselves.")
 * When a client's linked thread is due to be updated by itself, from what this bridge has seen of the client (`seen`, as
 * `seenNow` has it for what the client has now): AUTO_QUIET_MS after it was first seen unchanged, as `autoUpdateDue`
 * asks. (0.7.14) Until 0.7.14, with mail waiting and no drafts, up to AUTO_NO_DRAFTS_MS later, "when the drafts are
 * ready": no update waits for them now.
 * This says when, never whether: every guard of the send still applies when the time comes (`autoUpdates`).
 */
export function selfUpdateAt(seen: FirstSeen, pace: Pace = 'quiet'): number {
  // (0.7.76) a finished package this thread has not been given goes at once; one still being built waits for its build
  return seen.at + (pace === 'now' ? 0 : pace === 'building' ? BUILD_HOLD_MS : AUTO_QUIET_MS)
}

/**
 * (0.7.9) What a row, the client's part of the pane and its thread's note say of it: `updates itself at about 7:07 PM`,
 * and `updates itself shortly` once that time has passed (the next sync sends it, or the thread is in use and it waits
 * until the thread has been quiet AUTO_IDLE_MS).
 */
export function selfUpdateText(at: number, now: number): string {
  return at > now ? `updates itself at about ${clockText(at, now)}` : 'updates itself shortly'
}

/**
 * (0.7.78, Rob 2026-11-25, of a thread's cost to keep going: "I also think that's what should trigger the chip to restart
 * the thread once we hit a certain threshold"; "I just want to make sure we don't prevent ourselves from completing hard
 * tasks to the best of our abilities, accidentally, by abandoning expensive threads") A client's thread is asked to put up
 * a card for a fresh one (`freshParagraph`) when a fresh thread would save FRESH_SAVING or more of the input cost of the
 * next FRESH_HORIZON model calls. The same rule as massmarket-theme's glow (`savingFor` there; keep the two equal).
 *
 * Every call re-reads the whole thread: a tenth of the full price while its prompt cache is warm, a full write again once
 * the thread has sat longer than the cache keeps (an hour; five minutes on some plans). A fresh thread writes its own
 * start once and then re-reads less on every call. So a large thread being worked on never gets the card (its warm cache
 * is the point: 488K tokens before it would, past Rob's 500K compaction), and one that has sat over an hour gets it from
 * 250K. It replaces 0.7.14's 12 MiB transcript (`FRESH_THREAD_BYTES`), which kept counting what compaction had cleared.
 *
 * FRESH_TOKENS: the context a fresh thread carries once it is going. On Rob's Mac (1,569 threads, the 14 days to
 * 2026-11-25) the median thread answered its first message over 111K tokens, its 10th call over 146K, its 30th over 190K.
 */
export const FRESH_TOKENS = 150_000
export const FRESH_HORIZON = 20
export const FRESH_SAVING = 0.4
export type CacheLife = '1h' | '5m'
export const CACHE_LIFE_MS: Record<CacheLife, number> = { '1h': 3_600_000, '5m': 300_000 }
const CACHE_READ = 0.1
const CACHE_WRITE: Record<CacheLife, number> = { '1h': 2, '5m': 1.25 }

/**
 * (0.7.78) The share of the next FRESH_HORIZON calls' input cost a fresh thread would save, 0 to 1: massmarket-theme's
 * `savingFor`, copied as it is there (fresh-theme-parity.test.ts holds the two equal). Cold, that is 1 - FRESH_TOKENS /
 * tokens on either cache life; warm, 1 - FRESH_TOKENS x (write + 1.9) / (tokens x 2).
 */
export function freshSaving(tokens: number, isCold: boolean, life: CacheLife = '1h'): number {
  const rest = (FRESH_HORIZON - 1) * CACHE_READ
  const here = tokens * ((isCold ? CACHE_WRITE[life] : CACHE_READ) + rest)
  const fresh = FRESH_TOKENS * (CACHE_WRITE[life] + rest)
  return here > 0 ? Math.max(0, 1 - fresh / here) : 0
}

/**
 * (0.7.78) Each thread's last model activity on this computer, by its Claude Code session id (`mm.cost`): when, its
 * cache's life (from what its turns wrote), and the context its last call re-read. Every thread notes its own at the
 * start and the end of each of its turns (`noteCost`).
 */
export type CostSeen = Record<string, { at: number; life: CacheLife; tokens?: number }>

/** (0.7.78) What the card says of a thread: its context, how long it has sat, whether past its cache's life, the saving. */
export type FreshReading = { tokens: number; idleMs: number; isCold: boolean; life: CacheLife; saving: number }

/**
 * (0.7.78) A thread's reading from its note, or undefined with none (a thread that has run no turn since 0.7.78 gets no
 * card until it has). The app's own word on its last activity counts too: anything newer than the note keeps it warm.
 */
export function freshReading(seen: CostSeen[string] | undefined, lastActivityAt: string | undefined, now: number): FreshReading | undefined {
  if (!seen || !(typeof seen.tokens === 'number' && seen.tokens > 0) || typeof seen.at !== 'number') return undefined
  const life: CacheLife = seen.life === '5m' ? '5m' : '1h'
  const idleMs = Math.max(0, now - Math.max(seen.at, Date.parse(lastActivityAt ?? '') || 0))
  const isCold = idleMs > CACHE_LIFE_MS[life]
  return { tokens: seen.tokens, idleMs, isCold, life, saving: freshSaving(seen.tokens, isCold, life) }
}

function sat(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 90) return `${min} minutes`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`
}

/**
 * (0.7.14; 0.7.78 says why) What an update sent by itself into a thread a fresh one would save on (`FRESH_SAVING`)
 * carries last: put up a card for a fresh thread for the client, in this thread, through the mm tool's kickoffs (whose
 * kickoff carries this thread's hand-over and, once started, takes the client's link and its pin), unless one is up
 * already. The card starts nothing: the person clicks it or not. `name`: the client's full name, as kickoffs finds it.
 */
export function freshParagraph(name: string, r: FreshReading): string {
  const k = `${Math.round(r.tokens / 1000)}K`
  const pct = Math.round(r.saving * 100)
  const why = r.isCold
    ? `This thread re-reads ${k} tokens on every step and has sat ${sat(r.idleMs)} since it last worked, longer than its cache keeps (${r.life === '1h' ? 'an hour' : 'five minutes'}), so a fresh thread would save about ${pct}% of what comes next.`
    : `This thread re-reads ${k} tokens on every step, so a fresh thread would save about ${pct}% of what comes next.`
  return `${why} Unless this thread already shows a card for one, call mm with "kickoffs ${name}" and propose that thread with start_session using exactly the title, prompt, background and cwd it gives, but with initiation "own_initiative", so the card waits here for my click. If kickoffs says it is pending, a card is up already: propose nothing. Started, the new thread gets this thread's hand-over and takes over the client's link and pin. Then carry on with the update above.`
}

/**
 * (0.5.11, review of PR #15, F3) After an update that went by itself and asked the thread to build the client's
 * package (`Sent.prep`), the package that appears is that thread's own work: not something new to send it. So it is
 * while the client has a package now, in that thread, with no client message received since the send.
 */
export function ownPackage(given: Sent | undefined, sid: string, it: QueueItem): boolean {
  if (!given?.prep || given.sid !== sid || asksForPrep(it)) return false
  if (!it.packageId && !(it.open ?? null)) return false
  return !((Number(it.newest?.mail) || 0) > given.at)
}

/**
 * What to do about a client's thread, and why. ONE action per client:
 *
 *   start    Start thread  · no thread yet                            no thread of the client's own at all
 *   update   Update thread · thread from Mon, Oct 12 exists           a thread exists and has not been given this
 *            Update thread · new since this thread was updated        the bridge updated it before, with less
 *            Update thread · "<title>" looks like this client         no known thread, but a title matches
 *   current  Thread updated 3 PM                                      the thread already has what is waiting now
 *
 * The thread is the client's linked one when it has one, else the most recently active matched one.
 * `current` is decided by `sent`: the thread and the signature the bridge stored when Update last went.
 * (0.5.11, Rob 10-15) A thread's length is no reason for a new one: Claude Code compacts it instead.
 * (0.7.6, Rob 2026-10-27: "it's better for us to have everything pinned that needs to be pinned, even if it needs to
 * be updated or restarted") Nor is its age. Until 0.7.6 a thread last active more than 7 business days back (or 60
 * days) made the row `Start thread · last thread is from Oct 2`; it is Update now, however old the thread.
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
  // (0.7.39) a package that owes no reply has no drafts to count: a teammate's says whose it is
  const drafts = !o || it.noReply === true ? '' : owesNoReply(it) ? (o.state === 'held_by_other' ? `no reply needed, with ${o.by}` : NO_REPLY_WHAT) : o.state === 'held_by_me' ? `${o.unsent} draft${o.unsent === 1 ? '' : 's'} not sent` : o.state === 'held_by_other' ? `drafts with ${o.by}` : o.state === 'stale' ? 'drafts out of date' : 'drafts ready'
  // for the founder, a package that waits for his OK: that first, and who sends it once he has given it; one a
  // teammate decides on, before its reply is due, says so instead (R2)
  const ok = it.kind === 'ok' ? (it.theirs ? decidesText(it.theirs) : `needs your OK · ${(it.ok ?? null)?.sends ?? NOBODY} sends`) : ''
  // (0.7.4) the tasks as what they are: committed and due, owing an ETA, (0.7.15) to give an owner, or with no date at all
  const eta = etaAsksOf(it).length
  const owners = assignAsksOf(it).length
  const nodate = undatedCount(it)
  const dated = committedCount(it)
  const tasks = [
    dated > 0 ? `${dated} task${dated > 1 ? 's' : ''} due` : '',
    eta > 0 ? `${eta} need${eta > 1 ? '' : 's'} an ETA` : '',
    owners > 0 ? `${owners} need${owners > 1 ? '' : 's'} an owner` : '',
    nodate > 0 ? `${nodate} task${nodate > 1 ? 's' : ''} with no date` : '',
  ]
  // (0.7.24) follow-up steps that wait for a go: `3 follow-ups need your go` (a teammate's: `3 follow-ups need Asif's go`)
  const g = goOf(it)
  const go = g ? `${g.steps} follow-up${g.steps > 1 ? 's' : ''} need${g.steps > 1 ? '' : 's'} ${g.mine ? 'your' : `${g.by}'s`} go` : ''
  // (0.7.27) the viewer's own pace on the client: `on track`, `behind`
  const pace = paceOf(it) ? paceWord(it) : ''
  // (0.7.27, OW #638) a package that owes no reply says so, whatever else is on it. (0.7.39) The messages it covers are not
  // waiting on a reply, so they are not counted beside it (§9.3's words alone); one that came after it is, and it says so.
  const messages = it.noReply === true ? afterPackage(it) : goWithMail(it) ? 0 : it.messages
  const parts = [it.noReply === true ? (noReplyNow(it) ? NO_REPLY_WHAT : 'package says no reply') : '', ok, messages ? `${messages} message${messages > 1 ? 's' : ''} waiting` : '', ...tasks, drafts, go, pace]
  const base = parts.filter(Boolean).join(', ')
  // (0.5.28, internal asks) and then the viewer's open asks, `1 internal ask`: after what the client has otherwise (a
  // package of theirs with nothing else waiting is still `drafts ready`), or alone for a client listed by its asks alone
  const n = openAsks(it).length
  const asked = n ? `${n} internal ask${n > 1 ? 's' : ''}` : ''
  // (0.7.3, internal queue) and last the viewer's internal queue, `312 tickets in the internal queue`: never a due time
  // (0.7.56) newest first, it counts the active tickets alone: `24 open tickets in the internal queue`
  const q = queuedOf(it).length ? queueTotal(it) : 0
  const queued = q ? `${q}${newestFirst(it) ? ' open' : ''} ticket${q > 1 ? 's' : ''} in the internal queue` : ''
  // (0.7.4, for the founder) and his teammates' late internal tickets: `2 late with Asif`. ⛔ (0.7.21) Only on a client listed
  // by them alone (`lateOnly`): on a row of his own they no longer ride along (Team · late lists them)
  const m = lateOnly(it) ? matesOf(it) : []
  const late = m.length ? `${m.length} late with ${whoseLate(m)}` : ''
  if (!asked && !queued && !late) return base || 'drafts ready'
  const extra = [asked, queued, late].filter(Boolean).join(', ')
  return base ? `${base}, ${extra}` : it.packageId ? `drafts ready, ${extra}` : extra
}

/**
 * (0.7.5, the panel redesign; spec 2026-10-27: "A second line appears only when it adds something the first lacks (for
 * example '2 drafts not sent'); never repeat the status") A row's second line: what is waiting that its first line
 * (`rowLine`) does not say, '' when nothing does. Never the internal queue (its own part, `Your build queue`), and never
 * the action or its reason: the row's button says what it does.
 */
export function rowExtra(it: QueueItem): string {
  const o = it.open ?? null
  const parts: string[] = []
  // the founder's OK given, who sends it
  if (it.kind === 'ok' && !it.theirs) parts.push(`${(it.ok ?? null)?.sends ?? NOBODY} sends`)
  // one client message where the first line names no reply or draft for it (two or more: its `N new`)
  const forMail = it.kind === 'reply' || it.kind === 'ready' || it.kind === 'ok' || o?.state === 'held_by_me'
  if (it.messages === 1 && !forMail) parts.push('1 message waiting')
  // the tasks as what they are, unless the first line's `task`, `ETA needed` or `assign an owner` is the one there is
  const eta = etaAsksOf(it).length
  const owners = assignAsksOf(it).length
  const nodate = undatedCount(it)
  const dated = committedCount(it)
  if (!(it.kind === 'task' && it.tasks === 1)) {
    if (dated > 0) parts.push(`${dated} task${dated > 1 ? 's' : ''} due`)
    if (eta > 0) parts.push(`${eta} need${eta > 1 ? '' : 's'} an ETA`)
    if (owners > 0) parts.push(`${owners} need${owners > 1 ? '' : 's'} an owner`)
    if (nodate > 0) parts.push(`${nodate} task${nodate > 1 ? 's' : ''} with no date`)
  }
  // the drafts, where the first line does not say them (`your draft`, `reply ready`, `with <Name>`)
  if (o?.state === 'held_by_me' && o.unsent > 0) parts.push(`${o.unsent} draft${o.unsent === 1 ? '' : 's'} not sent`)
  else if (o?.state === 'stale') parts.push('drafts out of date')
  else if (o && o.state !== 'held_by_me' && o.state !== 'held_by_other' && it.kind !== 'ready' && it.kind !== 'ok') parts.push(owesNoReply(it) ? NO_REPLY_WHAT : 'drafts ready')
  // the viewer's open asks, past the one the first line names
  const asks = openAsks(it).length
  if (asks && !(it.kind === 'ask' && asks === 1)) parts.push(`${asks} internal ask${asks > 1 ? 's' : ''}`)
  // ⛔ (0.7.21, Rob 2026-11-05: "it's making it hard for me to know what I still need to handle") never the founder's
  // teammates' late internal tickets: Team · late lists them (`teamPane`). 0.7.4 to 0.7.20 added `2 late with Asif` here.
  return parts.join(' · ')
}

/**
 * (0.7.4, ETA asks; Rob, 2026-10-27: "Team members need to provide ETAs ... They need to provide an ETA in 24 hours to me or
 * to the system") The paragraph a kickoff and an Update carry for the viewer's tickets that owe an ETA: how to record one
 * (task-chip-flow §5.3, `eta-commit` with the ticket's fingerprint), then each ticket with its full id and when its ETA
 * is needed by. '' with none. ⛔ Every id is checked again: it goes into the call Claude makes.
 */
export function etaParagraph(it: QueueItem): string {
  const asks = etaAsksOf(it).filter(a => a && isUuid(a.id) && Number.isFinite(a.neededBy))
  if (!asks.length) return ''
  const lines = asks.map((a, i) => `${i + 1}. ${cleanText(a.title, 120) || 'Untitled ticket'} (ticket ${a.id}) · ETA needed by ${dueText(a.neededBy)}`)
  return [
    `My tickets with no ETA yet (⏳ NO ETA). For each, ask me when it will be delivered, then record it as task-chip-flow §5.3 says: POST /api/ext/eta-commit with task_fingerprint "ticket:<its id>". Do not draft a client email for these.`,
    ...lines,
  ].join('\n')
}

/**
 * (0.7.15, owner asks; Rob, 2026-11-03: H9 "gets the build task, pinned in his bridge, with a clock to assign a
 * teammate") The paragraph a kickoff and an Update carry for the viewer's tickets on an `assign_by` clock: each is to be
 * given an owner by then (POST /api/ext/ticket-status, `assignee`), never delivered by then; one the viewer takes instead gets an ETA (task-chip-flow §5.3).
 * '' with none. ⛔ Every id is checked again: it goes into the call Claude makes.
 */
export function assignParagraph(it: QueueItem): string {
  const asks = assignAsksOf(it).filter(a => a && isUuid(a.id) && Number.isFinite(a.assignBy))
  if (!asks.length) return ''
  const lines = asks.map((a, i) => `${i + 1}. ${cleanText(a.title, 120) || 'Untitled ticket'} (ticket ${a.id}) · owner needed by ${dueText(a.assignBy)}`)
  return [
    `My tickets that need an owner: a team post handed them to me to assign. The time on each is when it needs an owner, not when the work is due. For each, ask me who will own it, then assign it from here: POST /api/ext/ticket-status with {"ticket_id":"<its id>","assignee":"<the name or email I give>","reason":"<why>"} (mm-api.mjs ext POST /ticket-status; never the OW dashboard). If I take one myself, ask me when it will be delivered and record it as task-chip-flow §5.3 says: POST /api/ext/eta-commit with task_fingerprint "ticket:<its id>". Do not draft a client email for these.`,
    ...lines,
  ].join('\n')
}

/**
 * (0.7.3, internal queue; spec 2026-10-27: "In the linked thread's update ... show the queue in rank order: the top 10,
 * each with its tier and one-line reason, then 'N more' from the total") The paragraph a kickoff and an Update carry for
 * the viewer's internal queue: each listed ticket's line (`queueLine`) and how many more. '' with none. ⛔ No due date
 * and no clock anywhere in it (Rob, 10-13).
 */
export function queueParagraph(it: QueueItem): string {
  const shown = shownQueue(it)
  if (!shown.length) return ''
  const total = queueTotal(it)
  const more = queueMore(it)
  // (0.7.56, Rob 2026-11-13: tickets with no activity in 3 weeks go "out of the top 10 and out of the kickoff") newest
  // first: the active tickets alone, and how many older ones the pane keeps under its Older toggle. ⛔ Never one listed here.
  const older = olderTotal(it)
  const head = newestFirst(it)
    ? `My internal queue, newest first (top ${shown.length} of ${total} open, no due dates${older ? `; ${older} older, no activity in 3 weeks, under the Older toggle` : ''}):`
    : `My internal queue, in rank order (top ${shown.length} of ${total}, no due dates):`
  return [head, ...shown.map((q, i) => queueLine(q, i + 1)), ...(more ? [more] : [])].join('\n')
}

/**
 * (0.5.28, internal asks) The asks a kickoff carries: each one's id a lower-case uuid and its due time a time, and who
 * asked cleaned again (an item an older version stored, or a store edited by hand, is read like the feed: as data).
 */
function kickoffAsks(it: QueueItem): AskRef[] {
  return openAsks(it)
    .filter(a => a && typeof a === 'object' && isUuid(a.id) && typeof a.dueAt === 'number' && Number.isFinite(a.dueAt))
    .map(a => ({ ...a, asker: cleanText(a.asker, 40) || 'a teammate' }))
}

/**
 * (0.5.28, internal asks; spec 2026-10-23, verbatim, values substituted) The paragraph a kickoff and an Update carry
 * for each open ask: who asked, its short id and due time (as the kickoff writes due times, `dueText`), how to print its
 * page, to draft the reply first when none is stored, and to wait for the person's go. ⛔ It never posts: the post goes
 * from the thread, after the go, through `/team-ask/post`.
 */
export function askParagraph(a: Pick<AskRef, 'id' | 'asker' | 'dueAt'>): string {
  return `Internal ask from ${a.asker} (ask ${a.id.slice(0, 8)}, due ${dueText(a.dueAt)}): print it with node ~/.claude/skills/team-api-gateway/scripts/mm-api.mjs ext GET "/team-ask?id=${a.id}&format=pickup". If it has no reply drafted, draft my reply first (client-reply-prep §9.1c, discord-posting) and store it with /team-ask/draft. Then show me the whole page and wait for my go. Post nothing without my go.`
}

/**
 * (0.7.24, Rob 2026-11-04) The first line of a kickoff for a client listed by follow-up steps that wait for a go alone. The
 * viewer's own go: show the steps on the follow-ups-only package's pickup view and wait for the go (client-reply-prep §9;
 * the same approve schedules them, §9.5 step 5). A teammate's (for the founder and the PM): show them and wait, approving
 * nothing for the teammate.
 */
export function goKickoff(it: QueueItem, who: string): string {
  const g = goOf(it)
  if (!g) return `[mm-link ${it.projectId}] ${who}: follow-up steps wait for a go. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`
  const pkg = g.packageId
  const first = typeof g.firstAt === 'number' && Number.isFinite(g.firstAt) ? `, the first (a ${stepWord(g.firstKind)}) opening ${dueText(g.firstAt)}` : ''
  const n = `${g.steps} follow-up step(s)`
  // (0.7.39) with client messages it already covers (`goWithMail`): this package is the client's, and the thread never builds another
  const covers = it.messages > 0 ? ` It already covers the ${it.messages} client message(s) waiting, so do not run prep and do not build a second package.` : ''
  if (!g.mine) {
    return `[mm-link ${it.projectId}] ${who}: package ${pkg} holds ${n} that wait for ${g.by}'s go${first}.${covers} Load the client's project skill first, then follow client-reply-prep §9 to show the one-package page for that package, but do not take it and do not approve it: the go is ${g.by}'s. Then wait for me. Send nothing without my go.`
  }
  return `[mm-link ${it.projectId}] ${who} has ${n} that nobody has approved, in package ${pkg}${first}.${covers} Nothing goes until I give the go. Load the client's project skill first, then follow client-reply-prep §9: show the one-package page for package ${pkg} with every step in full and wait for me. Send nothing without my go.`
}

/**
 * (0.7.39, Rob 2026-11-04: "it's just us approving that we don't need to do anything") The first line of a kickoff for an
 * open package that owes no reply and has nothing to send (client-reply-prep §2b, §9.3): it is a package, so it points at the
 * page for that package id. Never "reply drafts", never a count of them, and never prep: there is nothing to draft, and the
 * package exists (BST Executive Search, 2026-11-06: package bf68fd64, and the kickoff said "no package exists yet"). The
 * words for taking it follow the other kickoffs: sent by itself it is shown and not taken, and a teammate's stays theirs.
 */
function noReplyKickoff(it: QueueItem, who: string, auto: boolean): string {
  const o = it.open ?? null
  const id = it.projectId
  const pkg = it.packageId ?? o?.id ?? ''
  const stop = 'Do not run prep and do not draft a reply. Send nothing without my go.'
  if (o?.state === 'held_by_other') return `[mm-link ${id}] ${who}: package ${pkg} owes no reply, and ${o.by} holds it. Load the client's project skill first, then show me what the client sent and wait for me. ${stop}`
  const since = afterPackage(it)
  const newer = since > 0 ? ` ${since} client message(s) arrived after it, so read them before it closes.` : ''
  if (o?.state === 'held_by_me') return `[mm-link ${id}] ${who}: I already picked up package ${pkg}, which owes no reply and has no draft, and one go closes it.${newer} Load the client's project skill first, then follow client-reply-prep §9: read the package again, show the one-package page and wait for me. ${stop}`
  const first = `[mm-link ${id}] ${who}: package ${pkg} owes no reply and has no draft, and one go closes it.${newer} Load the client's project skill first, then follow client-reply-prep §9`
  return auto
    ? `${first} to show the one-package page for that package, but do not take it: no pickup call until I answer here, so the team can still pick it up. Then wait for me. ${stop}`
    : `${first}: show the one-package page for package ${pkg} and wait for me. ${stop}`
}

/**
 * (0.7.24) The paragraph a kickoff and an Update carry for follow-up steps that wait for a go, on a client listed for
 * something else as well (a client listed by them alone opens with `goKickoff` instead). '' with none.
 */
export function goParagraph(it: QueueItem): string {
  const g = goOf(it)
  if (!g) return ''
  const pkg = g.packageId
  const first = typeof g.firstAt === 'number' && Number.isFinite(g.firstAt) ? `, the first (a ${stepWord(g.firstKind)}) opening ${dueText(g.firstAt)}` : ''
  return g.mine
    ? `Package ${pkg} also holds ${g.steps} follow-up step(s) that nobody has approved${first}. Show them with client-reply-prep §9 for package ${pkg} once the rest is done, and wait for my go on them.`
    : `Package ${pkg} also holds ${g.steps} follow-up step(s) that wait for ${g.by}'s go${first}. They are ${g.by}'s to approve: do not approve them.`
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
 *   6. client messages with no package yet (0.7.39: a follow-ups-only package that covers them is one: `goKickoff`)
 *   7. committed tasks only (a package that is out of date, or another owner's, changes nothing here:
 *      the client is in the list for the task)
 * (0.7.14) `wait`, with `auto`: case 6 sent while Lane-2 may still build the drafts (`draftsComing`): its words say they
 *    follow as a second update and ask for no prep (Opus's, 10-30, verbatim). A thread they never reach is asked for prep
 *    later, in case 6's own words (`prepDue`).
 * ⛔ (0.5.11) `auto`: the message an update sent by itself carries (`autoUpdate`), which no person pressed for (with
 *    `update`, the marker comes first: F4 below). It
 *    never takes the package (client-reply-prep §9.1's pickup call): taken by a send nobody pressed for, OW would
 *    show it held by the person, teammates would be refused it (409 held_by_another), and the 24-hour "nobody
 *    picked this up" warning would stop counting it. Cases 2, 4, 5 and 6 then have words of their own (Opus's,
 *    10-15, verbatim); 1, 3, 7 and the founder's OK are as pressed. A pressed Update's text is unchanged.
 * (0.5.28, internal asks) A client listed by the viewer's internal asks alone (no package, no client message, no task)
 *    has a case of its own in 7's place: a first line that names the client, as 7's does. In every case the body is
 *    followed by one paragraph per open ask (`askParagraph`, the spec's words verbatim), before any hand-over. An ask
 *    is not a package and its paragraph takes nothing, so a send by itself carries the same words.
 * (0.7.3, internal queue) The internal-ops item listed by the viewer's internal queue alone (no package, no client
 *    message, no task, no ask) has a case of its own after the asks': a first line that names it, how many tickets the
 *    queue holds, with no due dates, and to show the queue and wait. In every case the queue (`queueParagraph`) comes
 *    last in the body, after any ask's paragraph and before any hand-over. It takes nothing, so a send by itself carries
 *    the same words. ⛔ No due date and no clock for it anywhere. (0.7.56) From an OW that sends its groups, the first line
 *    counts the open (active) tickets, newest first, and the queue lists them alone (`queueParagraph`).
 */
export function kickoffText(it: QueueItem, opts: { update?: boolean; replaces?: Replaced | undefined; auto?: boolean; wait?: boolean } = {}): string {
  const id = it.projectId
  const who = `${it.projectName} (OW project ${id})`
  // (R17) nothing due: the kickoff says no due time (the clause is left out, never "due Invalid Date")
  const due = hasDue(it) ? dueText(it.dueAt) : ''
  const replyDue = due ? `, reply due ${due}` : ''
  const tasksDue = due ? ` due ${due}` : ''
  const o = it.open ?? null
  /** (0.5.28, internal asks) The viewer's open asks, each checked again before its paragraph goes in. */
  const asks = kickoffAsks(it)
  /** (0.7.3, internal queue) The viewer's internal queue, its tickets checked again: '' with none. */
  const queue = queueParagraph(it)
  // (0.5.11, Opus 10-15, verbatim) cases 2 and 5 sent by itself: the pickup view, and no pickup call
  const notTaken = (pkg: string): string =>
    `[mm-link ${id}] The reply drafts for ${who} are ready in package ${pkg}. Load the client's project skill first, then follow client-reply-prep §9 to show the one-package page for that package, but do not take it: no pickup call until I answer here, so the team can still pick it up. Then wait for me. Send nothing without my go.`
  const lead =
    // (0.7.39) a package that owes no reply, whoever's it is: a prepared one that is not the viewer's only where it is what lists the client, as for any other
    owesNoReply(it) && (it.packageId || o?.state === 'held_by_other' || (o && it.messages > 0))
      ? noReplyKickoff(it, who, opts.auto === true)
      : o?.state === 'held_by_me' && it.packageId
      ? `[mm-link ${id}] Carry on with the reply drafts for ${who}. I already picked up package ${it.packageId}: ${o.unsent} draft(s) not sent yet${o.newer > 0 ? `, and ${o.newer} client message(s) arrived since` : ''}. Load the client's project skill first, then follow client-reply-prep §9: read the package again, show the one-package page and wait for me. Send nothing without my go.`
      : it.packageId
        ? opts.auto
          ? notTaken(it.packageId)
          : `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the one-package page for package ${it.packageId} and wait for me. Send nothing without my go.`
        : it.kind === 'ok' && o
          ? okKickoff(it, o)
        : o?.state === 'held_by_other'
          ? `[mm-link ${id}] ${who}: ${o.by} picked up the reply drafts (package ${o.id}) and has ${o.unsent} not sent yet. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep and do not draft a second reply. Send nothing without my go.`
        : o && withHolder(o)
          ? // (the founder) a stale package a teammate has, not held: Opus's words, 10-13
            `[mm-link ${id}] ${who}: ${o.by} has the reply drafts (package ${o.id}), and they are marked out of date. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep and do not draft a second reply. Send nothing without my go.`
          : o?.state === 'stale' && it.messages > 0
            ? opts.auto
              ? // (0.5.11, Opus 10-15, verbatim) case 4 sent by itself
                `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Package ${o.id} is marked out of date. Load the client's project skill first, then show me what the client sent, the current drafts and what is due, and wait for me. Do not take the package or rebuild the drafts until I answer here. Send nothing without my go.`
              : `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Load the client's project skill first, then follow client-reply-prep §9: package ${o.id} exists but is marked out of date, so pick it up, rebuild the drafts, then show the one-package page and wait for me. Send nothing without my go.`
            : o?.state === 'prepared' && it.messages > 0
              ? opts.auto
                ? notTaken(o.id)
                : `[mm-link ${id}] Pick up the reply drafts for ${who}. Load the client's project skill first, then follow client-reply-prep §9: show the one-package page for package ${o.id} and wait for me. Send nothing without my go.`
              : goWithMail(it)
                ? // (0.7.39) client messages a follow-ups-only package already covers: that package is the client's, never prep
                  goKickoff(it, who)
              : it.messages > 0
                ? opts.auto && opts.wait
                  ? // (0.7.14, Opus 10-30, verbatim) case 6 sent by itself while Lane-2 may still build the drafts (`draftsComing`)
                    `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Lane-2 is building the reply drafts, and they come into this thread as a second update once they are ready. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep before the drafts come unless I ask you to. Send nothing without my go.`
                  : opts.auto
                  ? // (0.5.11, Opus 10-15, verbatim) case 6 sent by itself
                    `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Load the client's project skill first, then follow client-reply-prep: no package exists yet, so run prep (§2) to build one, then show the one-package page without taking the package: no pickup call until I answer here. Then wait for me. Send nothing without my go.`
                  : `[mm-link ${id}] ${who} needs a reply: ${it.messages} client message(s) waiting${replyDue}. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the one-package page and wait for me. Send nothing without my go.`
                : goOnly(it)
                  ? // (0.7.24) listed by follow-up steps that wait for a go alone
                    goKickoff(it, who)
                : paceOnly(it)
                  ? // (0.7.27) listed by the viewer's own pace row alone: no state or numbers here, they change by the day and this text is what `signatureOf` compares
                    `[mm-link ${id}] ${who} has quoted work left on my plate and nothing else waiting. Load the client's project skill first, then show me what is left on the quote and wait for me. Send nothing without my go.`
                : tasksBesidesUndated(it) === 0 && asks.length
                  ? // (0.5.28, internal asks) listed by its asks alone: a first line that names the client, then each ask's paragraph
                    `[mm-link ${id}] ${who} has ${asks.length} internal ask(s) waiting on my reply. Load the client's project skill first.`
                  : tasksBesidesUndated(it) === 0 && queue
                    ? // (0.7.3, internal queue) listed by its queue alone: a first line that names it, with no due time, then the queue
                      `[mm-link ${id}] ${who} has ${queueTotal(it)} ${newestFirst(it) ? 'open ticket(s) in my internal queue, newest first' : 'ticket(s) in my internal queue'}, with no due dates. Load massmarket-internal-ops first, then show me the queue below as it stands now and wait for me to pick what to work on here.`
                    : etaOnly(it)
                      ? // (0.7.4, ETA asks) listed by tickets that owe an ETA alone: a first line that names them, then their paragraph
                        `[mm-link ${id}] ${who} has ${etaAsksOf(it).length} ticket(s) of mine that need an ETA${due ? `, the first needed by ${due}` : ''}. Load ${skillFor(it)} first, then ask me for the ETA of each ticket below and record it. Send nothing else without my go.`
                      : assignOnly(it)
                        ? // (0.7.15, owner asks) listed by tickets to give an owner alone: a first line that names them, then their paragraph
                          `[mm-link ${id}] ${who} has ${assignAsksOf(it).length} ticket(s) of mine that need an owner${due ? `, the first by ${due}` : ''}. Load ${skillFor(it)} first, then ask me who should own each ticket below and wait for me. Send nothing without my go.`
                        : tasksLead(it, who, tasksDue)
  // (0.5.28, internal asks) once per open ask, after the body and before any hand-over: `askParagraph`, verbatim;
  // (0.7.4, ETA asks) then the tickets that owe an ETA (`etaParagraph`); (0.7.15, owner asks) then the tickets to give an
  // owner (`assignParagraph`); (0.7.3, internal queue) then the queue, in rank order (`queueParagraph`)
  const body = [lead, ...asks.map(askParagraph), etaParagraph(it), assignParagraph(it), goOnly(it) || goWithMail(it) ? '' : goParagraph(it), queue].filter(Boolean).join('\n\n')
  const news = `New since this thread last worked on this client: ${waitingText(it)}.`
  // ⛔ (0.5.11, review of PR #15, F4) sent by itself: the marker first, at the very start of the text, as every hook
  // that tells the person's time from the bridge's reads it (a time-tracking hook too old to read the app's own
  // `peer` stamp counts a turn that opens with the marker as automatic). Then the first line, then the body
  // without its own marker. A pressed Update's text is as it was.
  const marker = `[mm-link ${id}] `
  if (opts.update && opts.auto) return `${marker}${news}\n${body.startsWith(marker) ? body.slice(marker.length) : body}`
  if (opts.update) return `${news}\n${body}`
  const handover = opts.replaces ? handoverText(it, opts.replaces) : ''
  return handover ? `${body}\n\n${handover}` : body
}

/**
 * (0.7.4) The kickoff's first line for a client listed by its tasks: the committed ones with their due time, as it always
 * was, then the tickets nobody dated, never called committed (Rob, 2026-10-27, of those: "It doesn't necessarily create
 * the need for a new reply"). (0.7.15) Tickets that need an owner have their own paragraph and are never called
 * committed: with no committed or undated task beside them, the first line names them (and any that owe an ETA).
 */
function tasksLead(it: QueueItem, who: string, tasksDue: string): string {
  const id = it.projectId
  const nodate = undatedCount(it)
  const dated = committedCount(it)
  const open = `${nodate} open ticket(s) of mine with no due date`
  const owners = assignAsksOf(it).length
  if (!nodate && dated <= 0 && owners > 0) {
    const eta = etaAsksOf(it).length
    return `[mm-link ${id}] ${who} has ${owners} ticket(s) of mine that need an owner${eta ? ` and ${eta} that need an ETA` : ''}${tasksDue ? `, the first${tasksDue}` : ''}. Load ${skillFor(it)} first, then go through each ticket below and wait for me. Send nothing without my go.`
  }
  if (!nodate) return `[mm-link ${id}] ${who} has ${dated} committed task(s)${tasksDue}. Load ${skillFor(it)} first, then show me what is due and wait for me. Send nothing without my go.`
  if (dated <= 0) return `[mm-link ${id}] ${who} has ${open}. Load ${skillFor(it)} first, then show me what is open and wait for me. Send nothing without my go.`
  return `[mm-link ${id}] ${who} has ${dated} committed task(s)${tasksDue}, and ${open}. Load ${skillFor(it)} first, then show me what is due and wait for me. Send nothing without my go.`
}

/**
 * The kickoff for a package that waits for the founder's OK and that somebody else sends (kind `ok`): he
 * is shown the package and what needs his OK. He does not pick it up, and nothing is drafted or sent.
 */
function okKickoff(it: QueueItem, o: NonNullable<QueueItem['open']>): string {
  const who = `${it.projectName} (OW project ${it.projectId})`
  const sends = (it.ok ?? null)?.sends ?? NOBODY
  return `[mm-link ${it.projectId}] ${who}: reply package ${o.id} is flagged for my OK${o.state === 'stale' ? ' and is marked out of date' : ''}, and ${sends} sends it. Load the client's project skill first, then follow client-reply-prep §9: show the one-package page for that package and what needs my OK, and wait for me. Do not pick the package up and do not draft a second reply. Send nothing without my go.`
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
 * (0.6.0, spec 2026-10-25, verbatim; R5's sentence until 0.5.28) What a kickoff carries when the client already has a
 * linked (primary) thread other than the one starting: this thread stays the client's as a second thread, and leaves
 * the reply package to the primary. `title` is the primary thread's name; `skill` the client's skill from OW's skill
 * map, else the kickoff's own words for it (the client's project skill).
 */
export function secondThreadSentence(client: string, title: string, skill?: string): string {
  const load = skill ? `load the ${skill} skill` : "load the client's project skill"
  return `Another thread of yours already holds ${client}'s reply package ("${title}"). Do not run prep and do not pick up the package here. This thread stays linked to ${client} as a second thread: ${load} and then wait for the person.`
}

/**
 * The kickoff of a new thread for a client (Start, a chip): 0.5.1's start kickoff, with the hand-over from the
 * client's old thread. One case 0.5.1 never listed (R8): a stale package of the viewer's whose check left items
 * open, with no client message and no task (and, 0.5.28, no internal ask); its kickoff is the Claim message behind the
 * client's marker.
 */
export function startKickoff(it: QueueItem, replaces: Replaced | undefined, now: number): string {
  const fast = fastState(it, now)
  const o = it.open ?? null
  if (fast?.state === 'still_open' && !it.packageId && it.messages === 0 && tasksBesidesUndated(it) === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0 && !(o && withHolder(o))) {
    const body = `[mm-link ${it.projectId}] ${claimText(it.client, fast.at, fast.items, now)}`
    const handover = replaces ? handoverText(it, replaces) : ''
    return handover ? `${body}\n\n${handover}` : body
  }
  return kickoffText(it, { replaces })
}

// ---------------------------------------------------------------- (0.5.12) Start all

/**
 * (0.5.12, Rob 10-15: no clicks at all; the app starts a thread only on the person's own words or press, so a new
 * client's thread needs one person action) The most threads one Start all opens: the rest wait for a second press.
 */
export const START_ALL_MAX = 8

/**
 * (0.5.12) The Start all button, with how many clients need a new thread now. (0.5.14, Rob 10-16: "It should just
 * pretty much always be 'start missing threads.'") Named for what it does, in the pane and on the band alike; the
 * typed command is still /mm start all.
 */
export const startAllLabel = (n: number): string => `Start missing threads (${n})`

/** (0.5.14) The band's Start missing threads button when no client needs a new thread: drawn dim, and a press only checks again. */
export const ALL_STARTED = 'All threads started'

/**
 * (0.5.14) The band's one button, always drawn (it took Open list's place): Start missing threads with how many, or
 * All threads started when there are none. Either way a press is Start all's (`pressStartAll`).
 */
export const startMissingLabel = (n: number): string => (n > 0 ? startAllLabel(n) : ALL_STARTED)

/**
 * (0.5.12) The first message of a thread Start all opens: the new-thread kickoff (`startKickoff`) in the words that never
 * take the package (kickoffText's `auto`, with no Update line, so the client's marker is first: cases 2, 4, 5 and 6
 * show the drafts and make no pickup call until the person answers), with the hand-over from the client's old thread
 * as a single Start has it. A client still open after our reply, with nothing else, opens with its Claim words, as
 * Start has them. A single Start's own kickoff is unchanged.
 */
export function startAllKickoff(it: QueueItem, replaces: Replaced | undefined, now: number): string {
  const fast = fastState(it, now)
  const o = it.open ?? null
  if (fast?.state === 'still_open' && !it.packageId && it.messages === 0 && tasksBesidesUndated(it) === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0 && !(o && withHolder(o))) return startKickoff(it, replaces, now)
  return kickoffText(it, { replaces, auto: true })
}

/**
 * (0.5.16, Rob 10-19: "When it says it actually has to be started by me saying it here in the thread, that causes
 * issues.") The app's answer when it will not start a thread from this turn: it starts one (`user_asked`) only on the
 * person's own typed words in this thread, and a press in a thread that some other session started, or that an
 * automatic Update woke last, is not that. Its sentence: `Start sessions only on the user's own words to you here;
 * this turn runs an automated event, ... Propose the session instead (initiation "own_initiative")`. Told by its two
 * stable parts and nothing broader, so that any other refusal still reads as the error it is.
 */
export const needsCard = (text: string): boolean => /\buser['’]s own words\b|\bpropose the session instead\b/i.test(text)

/** (0.5.16) What a press says when the app wants the person's own words and a card was made instead (`needsCard`). */
export const cardReady = (client: string): string => `A Start card for ${client} is ready here: click Start on it.`

/**
 * (0.5.12) The one line a Start all leaves, in the band of every thread and above the list: the threads it started,
 * the ones the app did not start and why, the ones it skipped (a thread or another start got there first), and how
 * many still need a thread after the cap (START_ALL_MAX) for a second press. (0.5.16) And how many wait as Start cards
 * in this thread, where the app wanted the person's own words (`needsCard`): a count, never the app's sentence.
 */
export function startAllSummary(started: readonly string[], failed: ReadonlyArray<{ client: string; why: string }>, skipped: ReadonlyArray<{ client: string; why: string }>, left: number, cards = 0): string {
  const out: string[] = []
  if (started.length) out.push(`Started ${started.length} thread${started.length === 1 ? '' : 's'}: ${started.join(', ')}.`)
  if (cards > 0) out.push(`${cards} ready to start here: click Start on ${cards === 1 ? 'its card' : 'each card'}.`)
  if (failed.length) out.push(`Not started: ${failed.map(f => `${f.client} (${f.why})`).join('; ')}.`)
  if (skipped.length) out.push(`Skipped: ${skipped.map(f => `${f.client} (${f.why})`).join('; ')}.`)
  if (left > 0) out.push(`${left} more need${left === 1 ? 's' : ''} a thread: press Start missing threads again.`)
  return out.join(' ') || 'No client needs a new thread now.'
}

// ---------------------------------------------------------------- (0.5.25) Start on the person's own words

/**
 * (0.5.25, Rob 10-22: "I'm still having a hard time starting missing threads unless I type it... Maybe clicking the
 * button just types 'start missing threads' into the command line") Claude.app starts a thread (start_session
 * `user_asked`) only on a turn the person typed, and since 3.1623 asks the person to allow every start_session call; a
 * Start card the bridge made never opened for him. So a Start press puts the person's own words in the prompt box, they
 * send them with Enter, and the model starts each thread with what the mm tool's `kickoffs` gives it. What Start missing
 * threads (and /mm start all) puts there:
 */
export const START_ALL_WORDS = 'Start the missing client threads'

/**
 * (0.7.34, Rob 2026-11-07: "those clients ... had never been pinned before, and rightfully so ... But I guess, yeah, still should
 * have started a chip for them. Once they had reply packages ready") Whether the viewer has a reply package of this client's
 * ready to work: drafts ready for them, or waiting on their OK, and no teammate deciding it.
 */
export const packageReady = (it: Pick<QueueItem, 'kind' | 'packageId' | 'theirs'>): boolean => (it.kind === 'ready' || it.kind === 'ok') && Boolean(it.packageId) && !it.theirs

/** (0.7.38) The viewer's ready reply packages (`packageReady`) in a list, once each and sorted: what a thread's pane keeps between lists. */
export const readyPackages = (items: readonly Pick<QueueItem, 'kind' | 'packageId' | 'theirs'>[]): string[] =>
  [...new Set(items.filter(packageReady).map(it => String(it.packageId)))].sort()

/**
 * (0.7.38, Rob 2026-11-07: "if one arrives, the side panel should scroll up to the top to see it automatically") Whether a list
 * brings a ready package the thread's last list did not have. Never on a thread's first list (`had` null): a thread that starts,
 * or the bridge reloading, does not jump.
 */
export const packageArrived = (had: readonly string[] | null, ready: readonly string[]): boolean => had !== null && ready.some(id => !had.includes(id))

/** (0.7.34) Whether a client's mail still waits for its package, up to `wait` after the newest message: no chip for its new thread yet. */
export const awaitingPackage = (it: Pick<QueueItem, 'messages' | 'packageId' | 'newest'>, now: number, wait: number): boolean =>
  it.messages > 0 && !it.packageId && now - (Number(it.newest?.mail) || 0) < wait

/** (0.7.34) Beside `Needs you now`: how many client threads are not started. */
export const notStartedText = (n: number): string => `${n} thread${n === 1 ? '' : 's'} not started`
/** (0.7.34) The one button beside it. */
export const START_MISSING = 'Start missing threads'

/** (0.7.34) A row's pin, as the pin report has it: whether its thread is pinned, and why not. The photo's words, for the viewer's own row. */
export type RowPin = { pinned: boolean; why?: string }
const OWN_WHY: Readonly<Record<string, string>> = {
  no_thread: 'not pinned: no thread',
  unseen: "not pinned: can't see thread",
  person_unpinned: 'not pinned: you unpinned it',
  write_cap: 'not pinned yet',
  // (0.7.59) the app refused the bridge's pin
  refused: 'not pinned: the app refused',
}
export const rowPinWords = (pin: RowPin): string => (pin.pinned ? 'pinned' : (pin.why && Object.hasOwn(OWN_WHY, pin.why) ? (OWN_WHY[pin.why] as string) : 'not pinned'))
/** (0.7.34) The report's rows by client, for the pane's marks. */
export const rowPinsOf = (report: Pick<PinReport, 'items'>): Record<string, RowPin> =>
  Object.fromEntries(report.items.map(i => [i.project_id, i.pinned ? { pinned: true } : { pinned: false, ...(i.why_not ? { why: i.why_not } : {}) }]))

/**
 * ⛔ (0.7.59, Rob 2026-11-16: "Yes, build it") The pane's line under `Needs you now` when the app refused `n` of the rows' pins:
 * the reason the person can act on. The app's `set_pinned` asks the person first for a thread other than the caller (or one it
 * started) unless the session runs in Bypass permissions mode; asked from the bridge, nobody answers, and the pin is refused.
 * Opus-authored, placed verbatim.
 */
export const refusedPinsText = (n: number): string =>
  `The Claude app refused ${n} pin${n === 1 ? '' : 's'}. It asks before the bridge pins a thread unless Claude Code runs in Bypass permissions mode: switch the mode, or pin ${n === 1 ? 'it' : 'them'} yourself.`

/** (0.7.59) How many of these rows' pins the app refused, by the pin report's marks (`rowPinsOf`). */
export const refusedPinCount = (rows: Iterable<{ pin?: RowPin } | undefined>): number => {
  let n = 0
  for (const r of rows) if (r?.pin && !r.pin.pinned && r.pin.why === 'refused') n++
  return n
}

/**
 * (0.7.59) The report as an OW from before `refused` takes it: each `refused` item reads `unknown` and carries no `why_text`.
 * OW answers 400 for a `why_not` it does not know, so `sendPinReport` sends this once after a 400 to a report with a `refused`
 * item: the rest of the report still reaches the team. Null when the report has no `refused` item (nothing to send again).
 */
export function pinReportForOlderOw(report: PinReport): PinReport | null {
  if (!report.items.some(i => i.why_not === 'refused')) return null
  return {
    ...report,
    items: report.items.map(i => {
      if (i.why_not !== 'refused') return i
      const { why_text: _whyText, ...rest } = i
      return { ...rest, why_not: 'unknown' }
    }),
  }
}


/** (0.5.25) What a row's Start, and /mm start <client>, puts there. */
export const startWords = (client: string): string => `Start ${client}'s thread`

/**
 * (0.5.25) What a press says: its words are in the prompt box (`filled`); the box held a draft of the person's, which
 * is never written over (`draft`); or no box took them (`none`: a surface with none, or one that refused).
 */
export function startFillSaid(words: string, all: boolean, how: 'filled' | 'draft' | 'none'): string {
  const then = all ? 'Claude starts each missing thread, and the app asks you to allow each one.' : 'Claude starts the thread, and the app asks you to allow it.'
  if (how === 'filled') return `"${words}" is in the prompt box: press Enter to send it. ${then}`
  if (how === 'draft') return `Your prompt box has a draft, so it was left as it is. Send "${words}" when you are ready: ${then}`
  return `Type "${words}" and send it: ${then}`
}

// ---------------------------------------------------------------- (0.7.44) client threads are top-level threads

/**
 * ⛔ (0.7.44, Rob 2026-11-10: "I'd prefer it if each client was started in its own project rather than just a child of
 * another thread ... when I pin a thread, it pins everything that's its child into the pinned section too"; "we always want
 * it to be parent threads. If needed, the threads can detach themselves and reattach their children properly") The step every
 * prompt a new client thread opens with carries, as its second paragraph (`withTopLevelStep`), and every update into a
 * client thread the app shows as a child (`isChildThread`). The bridge cannot detach another thread (the app lets only the
 * thread that started it, or the thread itself, do it), so the thread detaches itself. Verbatim.
 */
export const TOP_LEVEL_STEP = `Before anything else on this turn: call mcp__ccd_session_mgmt__get_session with "self". If it shows a parentSessionId and detached is false, call mcp__ccd_session_mgmt__detach_session with "self", so this client's thread is a top-level thread (Rob, 2026-11-10: "when I pin a thread, it pins everything that's its child into the pinned section too"). Detach only this thread, never a thread it starts: those stay under it. If the app refuses, go on without a word about it.`

/**
 * (0.7.44) The prompt with TOP_LEVEL_STEP as its own paragraph right after its first (the text up to the first blank line,
 * the one that opens with the client's [mm-link] marker), so the marker stays the first characters. A prompt that carries the
 * step already is given back as it is: it is never there twice. ⛔ Applied only where a prompt is finally built: every
 * signature and record is made from the text without it (`withoutTopLevelStep`), never from this.
 */
export function withTopLevelStep(text: string): string {
  if (text.includes(TOP_LEVEL_STEP)) return text
  const cut = text.indexOf('\n\n')
  return cut < 0 ? `${text}\n\n${TOP_LEVEL_STEP}` : `${text.slice(0, cut)}\n\n${TOP_LEVEL_STEP}${text.slice(cut)}`
}

/** (0.7.44) The prompt without the paragraph `withTopLevelStep` put in: what the bridge compares with a kickoff. */
export function withoutTopLevelStep(text: string): string {
  const at = text.indexOf(`\n\n${TOP_LEVEL_STEP}`)
  return at < 0 ? text : `${text.slice(0, at)}${text.slice(at + 2 + TOP_LEVEL_STEP.length)}`
}

/**
 * ⛔ (0.7.44, Rob 2026-11-10: "The bridge should probably know when it pins a client thread to make sure it's top level. It
 * can automatically do that every time." Then: "It connects to a thread.") The one housekeeping message the bridge sends a
 * client thread it links or pins that the app shows as a child, and a child under a pinned client thread that is not that
 * client's own work (`topLevelPass`). No [mm-link] marker: it is never a kickoff or an update, and it writes no record of what
 * the thread has. Verbatim.
 */
export const DETACH_SELF_NOTE = `[mm-bridge] Housekeeping only: call mcp__ccd_session_mgmt__get_session with "self". If it shows a parentSessionId and detached is false, call mcp__ccd_session_mgmt__detach_session with "self". Do nothing else on this turn and answer in one line. (Rob, 2026-11-10: "The bridge should probably know when it pins a client thread to make sure it's top level. It can automatically do that every time.")`

/**
 * (0.7.44) The profile-switch routine's test of a finished thread (control tower `skills/profile-switch/switch-plan.py`,
 * `unfinished()`): what a status line says is still left open, and what says nothing is.
 */
const LEFT_OPEN = /\brecommends?\b|\bstill (?:not|to\b|needs?|open|undone|unsent|unanswered)|\bnot (?:yet )?(?:done|sent|merged|applied|checked|answered|approved|decided)|\b(?:waits?|waiting) (?:on|for) (?:you|rob|your)|\byour (?:go|call|decision|answer|ok)\b|\bfor you to\b|\byou (?:send|decide|pick|choose)\b/i
const NOTHING_LEFT = /\bnothing (?:waits?|waiting|needed|open|left|pending)|\bno (?:action|reply) needed/i

/**
 * ⛔ (0.7.44, Rob 2026-11-10: "if it looks like I finished what I was working on there, you can unpin them") Whether the
 * app's own record of a thread says its work is finished, from the record alone (never its transcript), as the switch routine
 * judges it: archived is finished; a turn cut short, one waiting on the person, a prompt of the person's after its last turn,
 * a `blocked` or `review_ready` summary, an action or an answer it needs, or a `completed` one whose words leave something
 * open (and do not say nothing is) is not; `completed` with none of those is. Anything else (no summary, another status) is
 * not finished: the person's own pin stays.
 */
export function recordLooksFinished(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false
  const r = record as {
    isArchived?: unknown
    lastTurnCutShort?: unknown
    interruptedAwaitingPerson?: unknown
    latestUserFrameAt?: unknown
    lastTurnEdgeAt?: unknown
    postTurnSummary?: { status_category?: unknown; status_detail?: unknown; needs_action?: unknown } | null
    turnWrapUp?: { needsUser?: unknown } | null
  }
  if (r.isArchived === true) return true
  if (r.lastTurnCutShort || r.interruptedAwaitingPerson) return false
  if ((Number(r.latestUserFrameAt) || 0) > (Number(r.lastTurnEdgeAt) || 0) + 5000) return false
  const summary = r.postTurnSummary && typeof r.postTurnSummary === 'object' ? r.postTurnSummary : undefined
  const status = summary?.status_category
  if (status === 'blocked' || status === 'review_ready') return false
  // (as switch-plan.py's `(x or "").strip()`: an empty, null or false value is blank)
  const blank = (v: unknown): boolean => !v || String(v).trim() === ''
  if (!blank(summary?.needs_action)) return false
  const wrap = r.turnWrapUp && typeof r.turnWrapUp === 'object' ? r.turnWrapUp : undefined
  if (!blank(wrap?.needsUser)) return false
  if (status !== 'completed') return false
  const detail = typeof summary?.status_detail === 'string' ? summary.status_detail : ''
  return !(LEFT_OPEN.test(detail) && !NOTHING_LEFT.test(detail))
}

// ---------------------------------------------------------------- (0.7.68) a client's thread says it waits on the person

/**
 * ⛔ (0.7.68, Rob 2026-11-23: "it depends on what the question is and how important it is I answer it. you almost always end
 * with a question. we can probably come up with some rules around what types of questions need answering." Then, of Claude's
 * recommended four kinds: "Yes, build it".) What a client's thread declared through `mm waiting <type> -- <question>`, by
 * thread (`mm.waiting`): the kind (`ANSWER_TYPES`), the question as the thread put it (`cutAsk`), and when. It stands until the
 * first of: the person's own prompt in that thread at or after `at`; `mm waiting clear` there; a newer declaration there; the
 * thread archived, gone or unlinked. ⛔ LOCAL ONLY: the question and the kind never leave this computer (the pin report sends
 * kind `waiting`, never either).
 */
export type Declared = { type: AnswerType; ask: string; at: number }

/** (0.7.68) The most characters of a thread's question the bridge keeps, cut on a word boundary. */
export const ASK_MAX = 140

/**
 * (0.7.68) A thread's question as the bridge keeps and shows it: control characters and line breaks become spaces, runs of
 * spaces collapse, a double quote becomes a single one (the sentence quotes it), and past ASK_MAX characters it is cut at the
 * last space (or at ASK_MAX when there is none past half of it) with `…`. '' for nothing.
 */
export function cutAsk(raw: unknown): string {
  const text = (typeof raw === 'string' ? raw : '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/"/g, "'").replace(/\s+/g, ' ').trim()
  const chars = [...text]
  if (chars.length <= ASK_MAX) return text
  const head = chars.slice(0, ASK_MAX - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > ASK_MAX / 2 ? head.slice(0, space) : head).replace(/[\s.,;:!?-]+$/u, '')}…`
}

/** (0.7.68) The declarations on record, each checked again (a thread id, a known kind, a question, a time): a damaged entry is none. */
export function declaredOf(raw: unknown): Record<string, Declared> {
  const out: Record<string, Declared> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [sid, d] of Object.entries(raw as Record<string, unknown>)) {
    if (!THREAD_ID.test(sid) || !d || typeof d !== 'object') continue
    const { type, ask, at } = d as { type?: unknown; ask?: unknown; at?: unknown }
    if (!isAnswerType(type) || typeof ask !== 'string' || ask === '' || typeof at !== 'number' || !Number.isFinite(at)) continue
    out[sid] = { type, ask, at }
  }
  return out
}

/**
 * ⛔ (0.7.68) The mm tool's own words for `waiting`, verbatim as the coordinator gave them for Rob's approved recommendation:
 * when a thread may say it waits on the person, and the never-list.
 */
export const ANSWER_TOOL_TEXT = `"waiting <send|money|only-you|risk> -- <question>" says this thread's work stops until the person answers that question, and pins the thread until they answer: send = a go on something that reaches a client, prospect or the team (email, text, LinkedIn, follow-up schedule, reply package, Discord post); money = a price off the price book, a discount, credit or refund that needs them, or spend over $10; only-you = something only they can do (sign in, a fact or promise only they have, a call only they take); risk = a client relationship at risk, client data or privacy, or a security problem. Never for a go to merge, migrate or deploy our own code, housekeeping, a choice you can make yourself, or anything that can wait. "waiting clear" takes it back.`

/** (0.7.68) What `mm waiting` answers for a kind it does not know, or no question: one line, naming the four kinds. */
export const ANSWER_REFUSED = 'Not recorded: say "waiting <type> -- <question>" with type send, money, only-you or risk and the question itself, or "waiting clear".'
/** (0.7.68) What it answers in a thread that is no client's linked thread here: nothing is stored. */
export const ANSWER_CLIENTS_ONLY = "Not recorded: the bridge pins client threads only, and this thread is not linked to a client's project here."
/** (0.7.68) What it answers once the declaration is on record. */
export const answerNoted = (type: AnswerType): string =>
  `Recorded: this thread waits on the person's answer (${ANSWER_LABEL[type]}). The bridge pins it at its next sync and keeps it pinned until they answer here or you call "waiting clear".`
/** (0.7.68) What `waiting clear` answers, whether there was a declaration or not. */
export const ANSWER_CLEARED = 'Cleared: this thread no longer says it waits on the person. Its pin follows the usual rules from the next sync.'

/** (0.7.68) `mm waiting <type> -- <question>`, or `mm waiting clear`: what it asks for, or ANSWER_REFUSED. */
export function answerArgs(arg: string): { clear: true } | { type: AnswerType; ask: string } | string {
  const text = arg.trim()
  if (/^clear$/i.test(text)) return { clear: true }
  const m = /^(\S+)\s+--\s*([\s\S]*)$/.exec(text) ?? /^(\S+)--\s*([\s\S]*)$/.exec(text)
  const type = m?.[1]?.toLowerCase()
  const ask = cutAsk(m?.[2])
  if (!isAnswerType(type) || !ask) return ANSWER_REFUSED
  return { type, ask }
}

// ---------------------------------------------------------------- (0.7.70) a thread waits on a scheduled run

/**
 * ⛔ (0.7.70, Rob 2026-11-24: "When we're waiting for a scheduled run before something needs me again, it should probably unpin
 * and then only repin after the run goes or it fails. This is something that could help clear up my pin list and everybody
 * else's system-wide. It doesn't need my attention between now and then, and I'm constantly checking it as I'm clicking through
 * all the different threads and having to bring my head back to the fact that I'm just waiting on a run." Then, the same day:
 * "we set up the watchdogs to make sure outreach is running right in all channels for clients. If something is not running
 * properly, it's supposed to pin itself ... But if everything I need to do is already scheduled and we're waiting for the send
 * to know that it's been fixed, I think we can unpin until we know there's an issue again that I need to do something with.")
 * What a linked thread declared through `mm waiting scheduled <when>[, <when>] ticket <id> -- <what>`, by thread
 * (`mm.runwait`): what the runs check (`what`, cut as a question is), the OW ticket every run notes its result on (`ticket`),
 * when it was declared (`at`), each run's due time and, once the bridge found it, when its report was stamped (`seen`), and
 * what the client had for the viewer then (`base`). ⛔ LOCAL ONLY, as a declaration is: the pin report sends no part of it.
 */
export type RunWait = { what: string; ticket: string; at: number; runs: WaitRun[]; base?: RunBaseline; project?: string; repinned?: number }
// (0.7.70) `base` absent: the last sync's item for the client did not carry the ticket ids yet (a sync of a bridge before 0.7.70),
// so the first pass after the declaration takes it.
// (0.7.70) `project`: the project the thread was linked to when it declared the wait, absent for a thread linked to none (an
// internal thread of the person's own): that one unpins itself, and the bridge only pins it again for a missed run (`repinned`,
// when it did) and takes that pin off once the run's note lands.

/** (0.7.70) One scheduled run: when it is due, and (`seen`) the stamp of the first note on the wait's ticket at or after then. */
export type WaitRun = { at: number; seen?: number }

/**
 * (0.7.70) What the client had for the viewer when the wait began (`baselineOf`): the newest time of each kind (`newest`) and
 * the ids of the viewer's own tickets (`taskIds`). Anything past it is something new (`newSince`), and ends the wait.
 */
export type RunBaseline = { mail: number; pkg: number; task: number; ids: string[] }

/**
 * (0.7.70) How long after its due time a run has to note its ticket before the bridge reads it as failed and pins the thread
 * again: two hours (a check that waits for an idle runner can take one, and launchd runs a missed time on wake). Claude's
 * recommendation in the build, not Rob's number.
 */
export const RUN_GRACE_MS = 2 * 60 * 60_000
/** (0.7.70) The furthest ahead a run may be: a wait is for a run that is set up and near, never for "some day". */
export const RUN_AHEAD_MAX_MS = 14 * 24 * 60 * 60_000
/** (0.7.70) The most runs one wait holds (a day-one and a day-three check is two). */
export const RUN_WAIT_RUNS_MAX = 6
/**
 * (0.7.70) How long a wait whose runs all reported stands, the client still listed and nothing new: 21 days after its last run,
 * the three weeks after which a quiet ticket closes. Past it the usual rules act on the thread again (quiet is never done).
 */
export const RUN_DONE_KEEP_MS = 21 * 24 * 60 * 60_000

/** (0.7.70) What the client has for the viewer now, as a wait's baseline. No item: nothing. */
export function baselineOf(it: Pick<QueueItem, 'newest' | 'taskIds'> | undefined): RunBaseline {
  const n = it?.newest
  const ids = Array.isArray(it?.taskIds) ? [...new Set(it.taskIds.filter(isUuid).map(id => id.toLowerCase()))] : []
  return { mail: Number(n?.mail) || 0, pkg: Number(n?.pkg) || 0, task: Number(n?.task) || 0, ids }
}

/**
 * ⛔ (0.7.70) Whether the client has something for the viewer that it did not have when the wait began: a newer message, package
 * or task or ask, or a ticket of the viewer's own that opened or reopened since (a watchdog's ticket, a run's "short" ticket).
 * That is a result that needs the person, and it ends the wait. No item (the client is on none of the lists): nothing new.
 */
export function newSince(it: Pick<QueueItem, 'newest' | 'taskIds'> | undefined, base: RunBaseline): boolean {
  if (!it) return false
  const now = baselineOf(it)
  if (now.mail > base.mail || now.pkg > base.pkg || now.task > base.task) return true
  const had = new Set(base.ids)
  return now.ids.some(id => !had.has(id))
}

/**
 * (0.7.70) Where a wait stands: `waiting` for its next run (due `due`); `missed`, a run past its due time and RUN_GRACE_MS with no
 * report (since `since`), which pins the thread again; `done`, every run reported (the last due `last`). Runs are read in order:
 * a later run's report never stands for an earlier one's.
 */
export type RunState = { kind: 'waiting'; due: number } | { kind: 'missed'; due: number; since: number } | { kind: 'done'; last: number }
export function runState(w: Pick<RunWait, 'runs' | 'at'>, now: number): RunState {
  const runs = [...w.runs].sort((a, b) => a.at - b.at)
  const open = runs.find(r => !Number.isFinite(r.seen))
  if (!open) return { kind: 'done', last: runs.length ? (runs[runs.length - 1] as WaitRun).at : w.at }
  const since = open.at + RUN_GRACE_MS
  return now >= since ? { kind: 'missed', due: open.at, since } : { kind: 'waiting', due: open.at }
}

/**
 * (0.7.70) The stamp of the first note on a ticket at or after `after`, from its `resolution_notes` as OW's ticket-status GET
 * gives them: every OW change and note is a line that opens `[<ISO time>] <who>: ...` (OW `composeResolutionNote`). Undefined
 * with none.
 */
export function reportedAt(notes: unknown, after: number): number | undefined {
  if (typeof notes !== 'string' || !Number.isFinite(after)) return undefined
  let best: number | undefined
  for (const m of notes.matchAll(/^\[(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2}))\]/gm)) {
    const t = Date.parse(m[1] as string)
    if (Number.isFinite(t) && t >= after && (best === undefined || t < best)) best = t
  }
  return best
}

/** (0.7.70) The waits on record, each checked again (a thread id, a ticket id, a time, one to RUN_WAIT_RUNS_MAX runs): a damaged entry is none. */
export function runWaitsOf(raw: unknown): Record<string, RunWait> {
  const out: Record<string, RunWait> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [sid, w] of Object.entries(raw as Record<string, unknown>)) {
    if (!THREAD_ID.test(sid) || !w || typeof w !== 'object') continue
    const { what, ticket, at, runs, base } = w as Record<string, unknown>
    if (typeof what !== 'string' || !what || !isUuid(ticket) || typeof at !== 'number' || !Number.isFinite(at)) continue
    if (!Array.isArray(runs) || runs.length < 1 || runs.length > RUN_WAIT_RUNS_MAX) continue
    const kept: WaitRun[] = []
    for (const r of runs) {
      const t = r && typeof r === 'object' ? (r as { at?: unknown }).at : undefined
      const seen = r && typeof r === 'object' ? (r as { seen?: unknown }).seen : undefined
      if (typeof t !== 'number' || !Number.isFinite(t)) continue
      kept.push({ at: t, ...(typeof seen === 'number' && Number.isFinite(seen) ? { seen } : {}) })
    }
    if (kept.length !== runs.length) continue
    const b = base && typeof base === 'object' ? (base as Record<string, unknown>) : undefined
    const ids = b && Array.isArray(b.ids) ? b.ids.filter(isUuid) : []
    const { project, repinned } = w as Record<string, unknown>
    out[sid] = {
      what, ticket, at, runs: kept.sort((x, y) => x.at - y.at), ...(b ? { base: { mail: Number(b.mail) || 0, pkg: Number(b.pkg) || 0, task: Number(b.task) || 0, ids } } : {}),
      ...(isUuid(project) ? { project } : {}), ...(typeof repinned === 'number' && Number.isFinite(repinned) ? { repinned } : {}),
    }
  }
  return out
}

/** (0.7.70) The mm tool's words for a scheduled wait, after the four kinds. */
export const RUN_WAIT_TOOL_TEXT = `"waiting scheduled <when>[, <when>] ticket <ticket id> -- <what the run checks>" says this thread waits only on scheduled runs that are already set up (a launchd one-shot, a runner's check), each <when> as YYYY-MM-DD HH:MM New York time (or an ISO time with its offset) within 14 days, every run noting its result on that OW ticket: the bridge takes its own pin off and keeps it off, whatever is due for the client then, until a run's result needs the person (anything new for the client: a ticket, a message, a package) or a run has not noted the ticket within 2 hours of its time, and then pins it again. Never for a run that is not set up yet, or while anything else in the thread still needs the person.`

/** (0.7.70) What it answers for words it cannot read. */
export const RUN_WAIT_REFUSED = 'Not recorded: say "waiting scheduled <when>[, <when>] ticket <ticket id> -- <what the run checks>", each <when> as YYYY-MM-DD HH:MM New York time (or an ISO time with its offset), no earlier than 2 hours ago and within 14 days, at most 6 runs, and the full id of the OW ticket the runs note their results on.'

/** (0.7.70) What it answers once the wait is on record. */
export function runWaitNoted(w: Pick<RunWait, 'runs' | 'ticket'>): string {
  const times = w.runs.map(r => dueText(r.at)).join(', ')
  const n = w.runs.length
  return `Recorded: this thread waits on ${n === 1 ? 'a scheduled run' : `${n} scheduled runs`} (${times}), each noting ticket ${w.ticket.slice(0, 8)}. The bridge takes its own pin off at its next sync and keeps it off until a run's result needs the person (anything new for this client) or a run has not noted the ticket within 2 hours of its time; then it pins the thread again. "waiting clear" takes it back.`
}

/** (0.7.70) What `mm waiting scheduled` answers in a thread that is no linked thread here: nothing is stored. */
export const RUN_WAIT_NO_THREAD = 'Not recorded: the bridge could not tell which thread this is.'

/**
 * (0.7.70) What it answers in a thread linked to no project here (an internal thread of the person's own): the bridge has no pin
 * of its own on it to take off, so the thread unpins itself; the bridge pins it again only for a missed run.
 */
export function runWaitNotedUnlinked(w: Pick<RunWait, 'runs' | 'ticket'>): string {
  const times = w.runs.map(r => dueText(r.at)).join(', ')
  const n = w.runs.length
  return `Recorded: this thread waits on ${n === 1 ? 'a scheduled run' : `${n} scheduled runs`} (${times}), each noting ticket ${w.ticket.slice(0, 8)}. It is linked to no project here, so unpin it yourself now (mcp__ccd_sidebar__set_pinned with pinned false). The bridge pins it again if a run has not noted the ticket within 2 hours of its time, and takes that pin off once the note lands. "waiting clear" takes it back.`
}

/** (0.7.70) The end of a thread's name while it waits on a run: ` · waits on a run Wed 4:15 PM`, and once one is missed ` · run missed`. */
export const runWaitSuffix = (s: RunState, now: number): string =>
  s.kind === 'missed' ? 'run missed' : s.kind === 'waiting' ? `waits on a run ${runWhen(s.due, now)}` : 'runs reported'

/** (0.7.70) When a run is due, short: `4:15 PM` today, `Fri 4:15 PM` within the week, else `Nov 30 4:15 PM`. New York time. */
export function runWhen(t: number, now: number): string {
  const time = fmt(t, { hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  const day = (x: number) => fmt(x, { year: 'numeric', month: '2-digit', day: '2-digit' })
  if (day(t) === day(now)) return time
  return t - now < 6 * 24 * 60 * 60_000 && t > now ? `${fmt(t, { weekday: 'short' })} ${time}` : `${monthDay(t)} ${time}`
}

/** (0.7.70) The band's sentence while a wait holds the pin off, once a run is missed, and once every run reported. */
export function runWaitWhy(w: Pick<RunWait, 'what' | 'ticket'>, s: RunState): string {
  if (s.kind === 'missed') return `Pinned for you: a scheduled run (${w.what}) was due ${dueText(s.due)} and has not noted ticket ${w.ticket.slice(0, 8)} since. Check that it ran.`
  if (s.kind === 'waiting') return `No pin needed until a scheduled run reports: ${w.what}, due ${dueText(s.due)}. It is pinned again if its result needs you or it has not noted ticket ${w.ticket.slice(0, 8)} by ${dueText(s.due + RUN_GRACE_MS)}.`
  return `No pin needed: the scheduled runs (${w.what}) reported on ticket ${w.ticket.slice(0, 8)} and nothing new for you came of them.`
}

/** (0.7.70) The name of a thread a missed run pins while its client is on none of the lists. */
export const runMissedTitle = (client: string): string => `🔴 ${client} · run missed`

/** (0.7.70) `mm waiting scheduled ...`: the runs (ms, in order), the ticket and what they check, or RUN_WAIT_REFUSED. */
export function runWaitArgs(arg: string, now: number): { runs: number[]; ticket: string; what: string } | string {
  const m = /^scheduled\s+([\s\S]+?)\s+ticket\s+(\S+)\s*--\s*([\s\S]*)$/i.exec(arg.trim())
  if (!m) return RUN_WAIT_REFUSED
  const ticket = (m[2] as string).toLowerCase()
  const what = cutAsk(m[3])
  if (!isUuid(ticket) || !what) return RUN_WAIT_REFUSED
  const runs: number[] = []
  for (const part of (m[1] as string).split(/\s*,\s*/)) {
    const t = runTime(part.trim())
    if (!Number.isFinite(t) || t < now - RUN_GRACE_MS || t > now + RUN_AHEAD_MAX_MS) return RUN_WAIT_REFUSED
    if (!runs.includes(t)) runs.push(t)
  }
  if (!runs.length || runs.length > RUN_WAIT_RUNS_MAX) return RUN_WAIT_REFUSED
  return { runs: runs.sort((a, b) => a - b), ticket, what }
}

/** (0.7.70) One run time: `2026-11-25 16:15` (New York time, an `ET` after it allowed), or an ISO time with `Z` or an offset. NaN otherwise. */
export function runTime(text: string): number {
  const wall = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(?:ET|EST|EDT))?$/i.exec(text)
  if (wall) return wallTime(Number(wall[1]), Number(wall[2]), Number(wall[3]), Number(wall[4]), Number(wall[5]))
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return Date.parse(text)
  return NaN
}

/** (0.5.25) One thread for the model to start: the client, and start_session's arguments exactly as the bridge would pass them. */
export type Kickoff = { client: string; args: Record<string, unknown> }

/**
 * (0.7.10; 10-28: nine clients came back in the next batch, before their new threads' markers linked them) A client
 * whose kickoff `kickoffs` handed out this recently, and whose link has not changed since, is pending: held back from
 * the next batch and from a single ask, so that following the answer's own "call kickoffs again" never starts it twice.
 */
export const KICKOFF_PENDING_MS = 10 * 60_000

/**
 * (0.5.25) What the mm tool's `kickoffs` answers: how to use what follows, the threads to start (one JSON line), the
 * clients it skipped and why, and how many more need a thread after START_ALL_MAX. (0.7.10) And the clients held back:
 * `pending`, whose kickoff went out in the last KICKOFF_PENDING_MS, and `restore`, whose own thread is archived.
 * (0.7.20) And `here`: each client the sync `kickoffs` ran first found a thread of its own in this profile for and linked
 * it to, with that thread's name.
 */
export function kickoffsAnswer(
  kicks: readonly Kickoff[],
  skipped: ReadonlyArray<{ client: string; why: string }>,
  left: number,
  held: { pending?: readonly string[]; restore?: readonly string[]; here?: readonly string[] } = {},
): string {
  const out: string[] = []
  if (kicks.length) {
    // (0.7.44, Rob 2026-11-10: "we always want it to be parent threads") each new thread is detached to top level right after it starts
    out.push(
      `Only if the person asked for this in their own message on this turn: start ${kicks.length === 1 ? 'this thread' : `these ${kicks.length} threads`} with one start_session call each, one after another, passing "arguments" exactly as given. Right after each start_session returns, call mcp__ccd_session_mgmt__detach_session with the new thread's local_ id, before the next start, so every client thread is a top-level thread and never a child of this one (Rob, 2026-11-10: "we always want it to be parent threads"). If the app refuses a detach, say so in one line and go on. The [mm-link] marker at the start of each prompt links the new thread to its client: send nothing else into it. On any other turn, start nothing and tell the person to press Start in the pane.`,
    )
    out.push(JSON.stringify(kicks.map(k => ({ client: k.client, arguments: k.args }))))
  }
  if (skipped.length) out.push(`Skipped: ${skipped.map(s => `${s.client} (${s.why})`).join('; ')}.`)
  const pending = held.pending ?? []
  if (pending.length) {
    out.push(
      `Already handed out in the last ${KICKOFF_PENDING_MS / 60_000} minutes and not linked yet: ${pending.join(', ')}. Do not start ${pending.length === 1 ? 'it' : 'them'} again: a new thread links itself when its first message arrives.`,
    )
  }
  const restore = held.restore ?? []
  if (restore.length) {
    out.push(
      `Own thread archived: ${restore.join(', ')}. Never start a new thread for ${restore.length === 1 ? 'it' : 'them'}: bring ${restore.length === 1 ? 'it' : 'each'} back with mm ${restore.map(c => `"restore ${c}"`).join(', ')} (the app may ask the person first).`,
    )
  }
  // (0.7.20, 11-04: Agile Process Solutions and Legacy Law were handed out with an open thread of their own here) a client
  // whose thread here the sync before the hand-out found and linked: named with its thread, never started again
  const here = held.here ?? []
  if (here.length) {
    out.push(
      `Already has a thread in this profile, now linked: ${here.join(', ')}. Never start a new thread for ${here.length === 1 ? 'it' : 'them'}: its work goes on in that thread.`,
    )
  }
  if (left > 0) out.push(`${left} more need${left === 1 ? 's' : ''} a thread: once these have started, call mm with "kickoffs" again.`)
  return out.join('\n') || 'No client needs a new thread now.'
}

/** `local_<id>`: the app's id for a thread, which is what the session tools take. */
export const THREAD_ID = /^local_[A-Za-z0-9_-]{1,100}$/

// ---------------------------------------------------------------- (0.7.11) a client's thread follows you across Claude profiles

/**
 * (0.7.11, Rob 2026-10-30: "switching profiles all the time. It needs to be able to detect and adapt to that.") A client
 * whose linked thread is in another Claude profile on this computer and that has no thread of its own in this one (the
 * sync found none to link here): what the pane's band, the line on the first prompt after a switch and `kickoffs` say
 * of it. A client with its own thread here is linked to that one instead, and is never one of these.
 */
export type AwayClient = {
  projectId: string
  client: string
  /** Its thread in the other profile (the app's id). */
  sid: string
  /** The folder of the app's records that holds that thread: one per Claude profile. */
  dir?: string
  /** When what it is listed for is due, where something is due. */
  due?: number
  /** With `due`: `reply` or `task`. */
  what?: string
  /**
   * Where the sync listed it: Needs you (`items`), a closed group under it, or no list at all (`none`: its thread is
   * pinned in the other profile). ((0.7.12) `older` is gone with the Older group: a record that says it is dropped.)
   */
  listed: 'items' | 'teammate' | 'checking' | 'none'
  /** That thread's transcript on this computer, when its record names its session and folder (`transcriptPath`). */
  transcript?: string
  /** That thread's own title, as the bridge kept it before renaming it. */
  title?: string
}

/** (0.7.11) How many names the band and the prompt line list before `and N more`. */
export const AWAY_NAMES_MAX = 8

/** (0.7.11) Due first, soonest first; the rest after, in the order given. */
export function awaySorted(list: readonly AwayClient[]): AwayClient[] {
  const at = (a: AwayClient): number => (typeof a.due === 'number' && Number.isFinite(a.due) ? a.due : Infinity)
  return list.map((a, i) => ({ a, i })).sort((x, y) => at(x.a) - at(y.a) || x.i - y.i).map(x => x.a)
}

/**
 * (0.7.11) One away client as the band names it: `PlacementCorp (reply due 5:27 PM ET)`, `(reply 2h late, due 3 PM ET)`
 * ((0.7.12) once late, when it was due as well), or the name alone. A due time is never shown on a weekend (`shownDue`).
 */
export function awayLabel(a: AwayClient, now: number): string {
  if (typeof a.due !== 'number' || !Number.isFinite(a.due) || !a.what) return a.client
  if (a.due < now) return `${a.client} (${a.what} ${clockAndDue(a.due, now)} ET)`
  return `${a.client} (${a.what} due ${clockText(shownDue(a.due), now)} ET)`
}

/** (0.7.13) The away clients as the band and the prompt lines name them: due first, AWAY_NAMES_MAX at most, then `and N more`. */
function awayNames(list: readonly AwayClient[], now: number): string {
  const sorted = awaySorted(list)
  const shown = sorted.slice(0, AWAY_NAMES_MAX).map(a => awayLabel(a, now))
  const more = sorted.length - shown.length
  return more > 0 ? `${shown.join(', ')}, and ${more} more` : shown.join(', ')
}

/**
 * (0.7.11) The pane's band, at the very top, while any client is away with no thread here. ⛔ (0.7.13, Rob 2026-10-30: "its
 * saying i have 15 missing client threads which cant be right, all those should exist") Only a client that needs the
 * person by the pin rule is away now (`pinsNow`), and the band says its thread is there, not missing: `You switched
 * Claude profiles. 1 client that needs you has its thread in the other one: Roman Seges (reply due Mon 3:06 PM ET).`
 */
export function awayBandText(list: readonly AwayClient[], now: number): string {
  const n = list.length
  return `You switched Claude profiles. ${n} client${n === 1 ? ' that needs you has its' : 's that need you have their'} thread in the other one: ${awayNames(list, now)}.`
}

/** (0.7.11) The band's one button: it puts START_ALL_WORDS in the prompt box, as Start missing threads does. */
export const awayButton = (n: number): string => (n === 1 ? 'Start it here' : 'Start them here')

/**
 * (0.7.11) The one line the first prompt the person types after a switch carries for Claude: the band's words, then to
 * offer one button that sends START_ALL_WORDS, and to start nothing itself. ⛔ It never asks Claude to start a thread:
 * the person's own words do that, on a turn of their own.
 */
export function awayPromptLine(list: readonly AwayClient[], now: number): string {
  return `[mm-bridge] ${awayBandText(list, now)} Do not start any thread on this turn. At the end of your reply, offer the person one button that sends "${START_ALL_WORDS}" (with no buttons, ask them to send those words).`
}

/**
 * ⛔ (0.7.13, Rob 2026-10-30: "i would want all threads pinned unpinned and then only unfinished threads from previous 24
 * hrs (consolidated when appropriate) and clients that need me per usual bridge procedure repinned") The one line the
 * first prompt the person types after a switch of Claude profiles carries for Claude, in place of `awayPromptLine`: run
 * the profile-switch skill's switch routine on this turn. The app starts a thread (start_session `user_asked`) only on a
 * turn the person typed, so the routine rides on that turn; the bridge itself still starts nothing. `since` is when the
 * sync first ran in this profile: the plan's switch time (`--at`), the end of its 24 hours.
 */
export function switchPromptLine(list: readonly AwayClient[], since: number, now: number): string {
  const clients = list.length
    ? `${list.length} client${list.length === 1 ? ' that needs you has its' : 's that need you have their'} thread in the other profile: ${awayNames(list, now)}`
    : 'no client that needs you has its thread in the other profile'
  // (0.7.44, Rob 2026-11-10: "It's better if it's a fresh project thread") and every thread it starts is detached to top level
  return `[mm-bridge] You switched Claude profiles (this one since ${clockText(since, now)} ET). Standing rule (Rob, 2026-10-30): before anything else on this turn, load the profile-switch skill and run its "Automatic switch routine" with --at ${since}. It unpins every thread pinned here before the switch, starts and pins only the threads left unfinished in the 24 hours before it (one session for threads that belong together), and starts the client threads that need you with the mm tool's kickoffs (${clients}). Every thread it or the mm tool's kickoffs starts is detached to top level right after start_session (detach_session), so a pinned thread carries only its own work (Rob, 2026-11-10: "It's better if it's a fresh project thread so that anything it generates that also needs to be finished before I unpin it is underneath it in the pinned section."). Then answer the message above. Where start_session or that skill is not available, start nothing and say so in one line.`
}

/** (0.7.11) A Claude Code session id as a record names it: a uuid. */
const CLI_SESSION = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * (0.7.11) Where Claude Code keeps a session's transcript: `<home>/.claude/projects/<folder>/<session>.jsonl`, the folder
 * being the session's working folder with every character but a letter or a digit made `-`
 * (`/Users/rob/Projects` → `-Users-rob-Projects`). Undefined when a part is not what a record holds (an absolute folder,
 * a uuid session) or the folder's name is longer than Claude Code keeps whole (200: it shortens longer ones).
 */
export function transcriptPath(home: string, cwd: unknown, cli: unknown): string | undefined {
  if (!home || typeof cwd !== 'string' || typeof cli !== 'string' || !CLI_SESSION.test(cli)) return undefined
  // eslint-disable-next-line no-control-regex
  if (cwd.length > 1000 || /[\u0000-\u001f]/.test(cwd) || !/^(\/|[A-Za-z]:[\\/])/.test(cwd)) return undefined
  const folder = cwd.replace(/[^A-Za-z0-9]/g, '-')
  if (folder.length > 200) return undefined
  const sep = /^[A-Za-z]:\\/.test(home) ? '\\' : '/'
  return [home.replace(/[\\/]+$/, ''), '.claude', 'projects', folder, `${cli}.jsonl`].join(sep)
}

/**
 * (0.7.11) The paragraph a new thread's kickoff carries for a client whose last thread is in another Claude profile: the
 * session tools here cannot open that thread, so the new thread reads the end of its transcript on disk first and
 * carries on from it, rather than starting cold. '' when the old thread's id is not an app thread id.
 * ⛔ The title is the thread's own text: cleaned to one line and cut at 60 before it goes in.
 */
export function awayHandoverText(projectName: string, a: Pick<AwayClient, 'sid' | 'title' | 'transcript'>): string {
  if (!THREAD_ID.test(a.sid)) return ''
  const named = a.title ? ` ("${cleanTitle(a.title)}")` : ''
  const read = a.transcript
    ? `Before anything else, read the last part of its transcript on this computer, ${a.transcript} (only its last 200 lines or so, never the whole file), and list anything left open in it: a question waiting on me, something promised and not done, a draft that was not sent. Keep that list to ten lines, then carry on from where that thread stopped.`
    : 'Its transcript could not be found from here, so carry on from the client\'s project skill and records.'
  return `This client's last thread is in another Claude profile: thread ${a.sid}${named} for ${projectName}. The session tools here cannot open it. ${read}`
}

/**
 * (0.7.11) The kickoff for a client on no list whose thread is pinned in another Claude profile (the profile-switch
 * skill's pinned `BRIDGE` row): its marker first, then to show where it stands, then the hand-over.
 */
export function carryKickoff(projectId: string, client: string, a: Pick<AwayClient, 'sid' | 'title' | 'transcript'>): string {
  const lead = `[mm-link ${projectId}] ${client} (OW project ${projectId}) has nothing on my list right now, and its pinned thread is in another Claude profile. Load the client's project skill first, then show me where it stands and wait for me. Send nothing without my go.`
  const handover = awayHandoverText(client, a)
  return handover ? `${lead}\n\n${handover}` : lead
}

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

export const LABEL = { update: 'Update thread', start: 'Start thread', open: 'Open thread', drafts: 'Drafts', claim: 'Claim in this thread', restore: 'Restore thread' } as const
export type RowButton = keyof typeof LABEL

/** R8: the sentence under the list. */
export const PANE_SENTENCE =
  'Pins: overdue in the last 3 weeks (never from before Wed Oct 14), or due within the next 24 business hours. Weekends do not count. Threads for these clients link themselves; use Update or Start on a row to pick one up.'

/** A row of the Needs-you pane (the plugin's state contract holds the shape). */
export type Row = MmRow

/** A row's state, also for a row an older version of the bridge drew (it called it `action`). */
export const rowState = (row: Row): RowState => {
  const state = row.state ?? (row as { action?: unknown }).action
  return state === 'update' || state === 'current' ? state : 'start'
}

/**
 * How a row is drawn beyond its recommendation (0.5.2): `needsYou` for a row of the Needs-you list (R4 names a
 * client there with no thread at all). (0.5.11: no context reading any more; R8's Claim shows whatever the
 * thread's length.)
 */
export type RowOptions = { needsYou?: boolean; self?: string }

export function rowFor(it: QueueItem, rec: Recommendation, now: number, opts: RowOptions = {}): Row {
  // a client whose drafts a teammate holds, and that is not the viewer's to act on: who to ask, and no action
  const withMate = withTeammate(it)
  // R8: the check of our reply left items open, and the client has a thread to claim them in
  const fast = withMate ? null : fastState(it, now)
  const still = fast?.state === 'still_open' && rec.target && !rec.target.suggested ? fast : null
  // on the Needs-you list with no thread of any kind: ` · no thread`, and (R4) red when it is due within the pin's window
  const fresh = !withMate && opts.needsYou === true && rec.fresh === true
  // R8: the server is checking our reply: the row is named as its thread is
  const checking = !withMate && fast?.state === 'checking' ? fast : null
  // (0.7.5, the panel redesign) ONE line: the chip, the client, what is needed, the time left (`rowLine`)
  const title = checking ? checkingTitle(it.client, checking.at, now) : still ? stillOpenTitle(it.client) : rowLine(it, now, { fresh, pins: fresh && pinsFor(it, now) })
  // (0.7.5) and a second line only for what the first does not say (never for a row not the viewer's: its note says it),
  // with the one reason a button does not carry: Update would go to a thread whose title only looks like the client
  const guess = rec.target?.suggested ? rec.reason : ''
  // (0.7.9, Rob 10-29) and, on an Update row whose thread is due to be updated by itself, when (`selfUpdateText`)
  const self = rec.state === 'update' && !guess ? opts.self ?? '' : ''
  // (0.7.11) and, where Start would have been for a quiet client, why there is none
  const quiet = rec.dormant === true && rec.state === 'start' && !rec.archived ? DORMANT_REASON : ''
  const extra = withMate || still || checking ? '' : [rowExtra(it), guess, self, quiet].filter(Boolean).join(' · ')
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
    // (0.7.10) the client's own archived thread: what Restore thread brings back
    ...(rec.archived && rec.state === 'start' ? { archived: rec.archived } : {}),
    // (0.7.11) a quiet client: no Start
    ...(rec.dormant === true && rec.state === 'start' && !rec.archived ? { dormant: true as const } : {}),
    ...(note ? { note } : {}),
    ...(extra ? { extra } : {}),
    // (the founder's alone, 0.5.1) a teammate's to see through: no action, with a sentence or without one
    ...(withMate && it.theirs ? { theirs: true } : {}),
    // R8: what is still open, drawn under the row, and its one action, Claim in this thread ((0.5.11, Opus 10-15)
    // whatever the thread's length: a long thread is compacted, not replaced)
    ...(still ? { stillOpen: [...still.items], claim: true } : {}),
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
  // R8: Claim in this thread ((0.5.11) whatever the thread's length; a row an older version drew with no Claim keeps none)
  if (isStillOpenRow(row)) return row.claim ? ['claim', 'drafts'] : ['drafts']
  const state = rowState(row)
  // (0.7.10) a client whose own thread is archived gets that thread back, never a new one
  if (state === 'start' && typeof row.archived === 'string' && THREAD_ID.test(row.archived)) return ['restore', 'drafts']
  // (0.7.11) a client with nothing from them in ACTIVE_WINDOW_MS and nothing due for the viewer: no new thread
  if (state === 'start' && row.dormant === true) return ['drafts']
  return [state === 'current' ? 'open' : state, 'drafts']
}

/**
 * The second line of a row, '' for none. (0.7.5, the panel redesign; spec 2026-10-27: "Each row is ONE line ... A second
 * line appears only when it adds something the first lacks ... never repeat the status") What is waiting that the
 * row's first line does not say (`extra`), and never the action or its reason: the row's button says what it does. A
 * row not the viewer's (its `note` says whose it is) and a row with items still open (drawn under it) have none.
 */
export function rowDetail(row: Row): string {
  if (notMine(row) || isStillOpenRow(row)) return ''
  return typeof row.extra === 'string' ? row.extra : ''
}

/** (0.5.5) Whether the thread a row acts on is the thread drawing the pane. */
const isHere = (row: Row, here: string | undefined): boolean => Boolean(here) && row.target === here
/** (0.5.5) The most characters of a button's label. */
export const LABEL_MAX = 40

/**
 * (0.5.5, Rob 10-14: in one client's thread pane, another client's row offered "Claim in this thread", as if it would
 * claim that client there) A row's button as it is drawn in the thread `here`: `Claim in this thread` only in the thread it
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
 * and both draw a Button.) (0.5.14) The band's button is Start missing threads now, not Open list: /mm opens the
 * list, from the band of a surface with no button as from any other.
 */
export const bandWords = (text: string, hasButton: boolean): string => (hasButton ? text : `${text} · type /mm to open the list`)

/** A row for a client that has no thread at all: the ones to notice first. ((0.7.6) A thread's age or length never makes one.) */
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

export type Fold = 'checking' | 'teammate' | 'undated'

/** The groups under the list as a pane holds them. */
export type Folds = { checking?: readonly Row[]; teammate?: readonly Row[]; undated?: readonly Row[] }

/**
 * The groups under the list, in the order they are drawn: (0.5.2, R8, Opus decision 2) `Checking your reply
 * (n)`, then `With a teammate (n)`, then (0.7.5) `No due date (n)`: the viewer's own clients listed by undated tickets
 * alone. Each is closed until the person opens it, and one with nobody in it is not drawn. (0.7.5) Their headings are
 * drawn on one line, each its own button (`New people` first, where there is anyone). Their rows are numbered on from
 * the list's. Nobody in them is pinned, and the header does not count them. ((0.7.12) No `Older (n)` any more: what
 * was due before the cut is not considered at all, `listCutoff`. A pane an older version stored with one draws none.)
 */
export function foldGroups(queue: { rows: readonly Row[] } & Folds): Array<{ key: Fold; heading: string; rows: Array<{ row: Row; n: number }> }> {
  const checking = Array.isArray(queue.checking) ? queue.checking : []
  const teammate = Array.isArray(queue.teammate) ? queue.teammate : []
  const undated = Array.isArray(queue.undated) ? queue.undated : []
  const numbered = (group: readonly Row[], from: number) => group.map((row, i) => ({ row, n: from + i + 1 }))
  const groups: Array<{ key: Fold; heading: string; rows: Array<{ row: Row; n: number }> }> = [
    { key: 'checking', heading: `Checking your reply (${checking.length})`, rows: numbered(checking, queue.rows.length) },
    { key: 'teammate', heading: `With a teammate (${teammate.length})`, rows: numbered(teammate, queue.rows.length + checking.length) },
    { key: 'undated', heading: `No due date (${undated.length})`, rows: numbered(undated, queue.rows.length + checking.length + teammate.length) },
  ]
  return groups.filter(g => g.rows.length > 0)
}

/** (0.7.5) How many tickets of the internal queue `Your build queue` lists in the pane; the linked thread's update keeps its top 10. */
export const BUILD_SHOWN = 3
/** (0.7.5) The most characters of a ticket's title there: one line of the pane. */
export const BUILD_TITLE_MAX = 72

/** (0.7.5) The pane's part for the viewer's internal queue, as it holds it (`MmBuild`). */
export type Build = { total: number; top: readonly string[]; row: Row }

/**
 * (0.7.5, spec 2026-10-27: "'Your build queue · N' follows, only for a viewer with internal tickets ... The panel shows the
 * top 3, then '+ N more in your Massmarket AI thread'") The part for the internal-ops item that lists the viewer's internal
 * queue: its total, its top tickets' titles in rank order (one line each), and its row (the button opens its linked
 * thread). Undefined for an item with no queue. ((0.7.5 to 0.7.20, for the founder, his teammates' late internal tickets
 * rode along here too: `9 late with Has9 and 2 more`. Since 0.7.21 they are Team · late's alone.)
 */
export function buildOf(it: QueueItem, row: Row): Build | undefined {
  const shown = shownQueue(it)
  if (!shown.length) return undefined
  // ⛔ (0.7.21) the founder's teammates' late internal tickets no longer ride along here (0.7.5 to 0.7.20: `9 late with Has9
  // and 2 more`): Team · late lists them
  return { total: queueTotal(it), top: shown.slice(0, BUILD_SHOWN).map(q => shownText(q.title, BUILD_TITLE_MAX)), row }
}

/** (0.7.5) The heading of `Your build queue`, and what its last line says of the tickets it does not list. */
export const buildHeading = (b: Pick<Build, 'total'>): string => `Your build queue · ${b.total}`

export function buildMore(b: Build): string {
  const more = b.total - b.top.length
  if (more <= 0) return ''
  return b.row.target ? `+ ${more} more in your ${b.row.client} thread` : `+ ${more} more in the queue`
}

/** (0.7.5) Whether the part is drawn in the thread `here`: never in the thread it points at, where the client part above lists the queue already. */
export const buildShown = (b: Build | undefined, here: string | undefined): b is Build => Boolean(b) && !(here && b?.row.target === here)

/**
 * The pane as plain text, one line per thing drawn: for tests and for a surface that draws no buttons. `folds` are the groups under the list, each drawn open.
 * `here` (0.5.5): the thread drawing it, as for `rowDetail` and `buttonLabel`.
 */
export function paneText(rows: readonly Row[], header: string, note: string, folds: Folds & { build?: Build; team?: readonly TeamPane[] } = {}, here?: string): string {
  const out = [header]
  const draw = (row: Row, lead: string): void => {
    out.push(`${lead} ${row.title}`)
    const detail = rowDetail(row)
    if (detail) out.push(`   ${detail}`)
    if (row.note) out.push(`   ${row.note}`)
    for (const item of isStillOpenRow(row) ? (row.stillOpen as string[]) : []) out.push(`   - ${item}`)
    out.push(`   ${rowButtons(row).map(b => `[ ${buttonLabel(b, row, here)} ]`).join(' ')}`)
  }
  // (0.7.5) one list, the clients with no thread yet first and marked
  for (const group of rowGroups(rows)) for (const { row, n, mark } of group.rows) draw(row, `${mark}${n}.`)
  if (buildShown(folds.build, here)) {
    const b = folds.build
    out.push('', buildHeading(b), ...b.top.map((t, i) => ` ${i + 1}. ${t}`))
    const more = buildMore(b)
    if (more) out.push(` ${more}`)
    if (b.row.target) out.push(`   [ ${LABEL.open} ]`)
  }
  const groups = foldGroups({ rows, ...folds })
  // (0.7.21) Team · late last, after the founder's own groups
  const team = Array.isArray(folds.team) ? folds.team : []
  const headings = [...groups.map(g => g.heading), ...(team.length ? [teamHeading(team)] : [])]
  if (headings.length) out.push('', headings.join(' · '))
  for (const group of groups) {
    out.push('', group.heading)
    for (const { row, n } of group.rows) draw(row, `${n}.`)
  }
  if (team.length) out.push('', ...teamLines(team))
  out.push('', note)
  return out.join('\n')
}

// ---------------------------------------------------------------- 0.7.21: Team · late in the pane

/** (0.7.21) Team · late as the pane holds it (`MmTeam`): each teammate, their count, and their tickets' lines by client. */
export type TeamPane = MmTeam

/**
 * (0.7.21, Rob 2026-11-05: "It should show people and which tasks are overdue for which clients, so I can run through those
 * with the team in the morning") Team · late for the pane, worded at `now`: `teamLate`'s people, clients and tickets, each
 * ticket one line (`teamLateLine`). Empty for every viewer but the founder.
 */
export function teamPane(items: readonly QueueItem[], now: number): TeamPane[] {
  return teamLate(items).map(p => ({ by: p.by, count: p.count, ...(p.behind > 0 ? { behind: p.behind } : {}), clients: p.clients.map(c => ({ client: c.client, lines: c.refs.map(r => teamLateLine(r, now)) })) }))
}

/** (0.7.21) Team · late as the pane stores it, each part checked again: a pane an older version stored has none. */
export function teamOf(v: unknown): TeamPane[] {
  if (!Array.isArray(v)) return []
  const text = (t: unknown): t is string => typeof t === 'string' && t !== ''
  return v.filter(
    (p): p is TeamPane =>
      Boolean(p) &&
      typeof p === 'object' &&
      text(p.by) &&
      Number.isFinite(p.count) &&
      Array.isArray(p.clients) &&
      p.clients.every((c: unknown) => {
        const one = c as Partial<TeamPane['clients'][number]> | null
        return one !== null && typeof one === 'object' && text(one.client) && Array.isArray(one.lines) && one.lines.every(text)
      }),
  )
}

/** (0.7.21) How many tickets Team · late holds, as the pane stores it. */
export const teamCount = (team: readonly TeamPane[]): number => teamLateCount(team)

/** (0.7.21) Team · late's heading, with how many tickets it holds: `Team · late (5)`. */
export const teamHeading = (team: readonly TeamPane[]): string => {
  // (0.7.61, Rob approved 2026-11-19 ('Yes, all five')) `Team · behind` when every ref is on an internal clock, else `Team · late`
  const { late, behind } = teamLateSplit(team)
  return `${late === 0 && behind > 0 ? TEAM_BEHIND : TEAM_LATE} (${teamCount(team)})`
}

/** (0.7.21) A teammate's heading in it: `Asif (3)`. */
export const teamPerson = (p: Pick<TeamPane, 'by' | 'count'>): string => `${p.by} (${p.count})`

/**
 * (0.7.21) Team · late as plain lines, as the pane draws it open: its heading, then each teammate (`Asif (3)`), each of
 * their clients under them, and each ticket under its client.
 */
export function teamLines(team: readonly TeamPane[]): string[] {
  const out = [teamHeading(team)]
  for (const p of team) {
    out.push(teamPerson(p))
    for (const c of p.clients) out.push(`  ${c.client}`, ...c.lines.map(l => `    - ${l}`))
  }
  return out
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
  // ((fix round 1, F6) to 0.7.11: `older`, how many of the person's clients waited under Older, said as `· N older
  // overdue`. Gone in 0.7.12: what was due before the cut is not considered at all, `listCutoff`.)
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
  const elsewhere = f.chipsElsewhere ?? []
  let first = ''
  if (f.noThread.length) first = `Needs you: ${f.pinned} pinned · ${f.noThread.length} with no thread: ${f.noThread.map(n => n.client).join(', ')}.`
  else if (f.pinsNow || f.pinned > 0 || f.stillOpen) first = `Needs you: ${f.pinned} pinned.`
  // ((fix round 1, F6) to 0.7.11 this said `· N older overdue` for the clients under Older; (0.7.12) nothing due before
  // the cut is considered, so there are none)
  else if (!f.stale) first = 'Nothing needs you in the next 24 hours.'
  // R8, when no client without a thread comes before it
  if (first && !f.noThread.length && f.stillOpen) first = `${first.replace(/\.$/, '')} · ${f.stillOpen} still open after your reply.`
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

// ---------------------------------------------------------------- 0.7.23: lookups past the app's list, and the pin report

/**
 * (0.7.23) What the sync keeps of each linked or pinned thread it asked the app for by id because the app's list left it
 * out (`mm.lookups`): when it last asked (`at`), and (`off`) that the app showed that thread open and not pinned while its
 * pin record said the pin was the bridge's.
 */
export type LookupSeen = { at: number; off?: true }

/**
 * (0.7.23) The order the sync asks the app, by id, for the linked or pinned threads its list of the 60 most recent left out
 * (at most LOOKUPS_PER_SYNC of them a sync). Measured on Rob's computer on 2026-11-05: 107 such threads, asked in the same
 * order every sync (links first, then pin records, then released threads), so the same 10 were asked each time and the rest
 * never were; a thread the bridge pinned in 0.7.20 sat 29th, so it kept its pin and its old `check on <teammate>` name after
 * 0.7.21 should have taken both off. Now the threads whose pin record is the bridge's (`ours`) go first, unless a lookup
 * since found them not pinned (`off`: such a record no longer counts as a bridge pin here, so stale records cannot take every
 * lookup); then every other one. Within each, the one asked longest ago first (never asked first), then the order they came
 * in: round-robin, so every thread is asked within a few syncs and none waits for good.
 */
export function lookupOrder(missing: readonly string[], ours: (sid: string) => boolean, seen: Readonly<Record<string, LookupSeen>>): string[] {
  const at = (sid: string): number => {
    const s = seen[sid]
    return s && typeof s === 'object' && Number.isFinite(s.at) ? s.at : 0
  }
  const first = (sid: string): boolean => ours(sid) && (seen[sid] as Partial<LookupSeen> | undefined)?.off !== true
  return missing
    .map((sid, i) => ({ sid, i, rank: first(sid) ? 0 : 1, at: at(sid) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at || a.i - b.i)
    .map(x => x.sid)
}

/**
 * (0.7.23) Why a client that should be pinned is not, as the pin report says it. ⛔ (0.7.59, Rob 2026-11-16: "Yes, build it",
 * the bridge fix so a refused pin shows its reason) `refused`: the app refused the pass's `set_pinned`, or a refusal of the last
 * PIN_WAIT_MS is still holding it back. Before 0.7.59 that read `unknown`, so Team now said "not pinned" with no reason while
 * the teammates' apps, outside Bypass permissions mode, asked before every pin of another thread and nobody answered.
 */
export type PinWhyNot = 'no_thread' | 'unseen' | 'person_unpinned' | 'write_cap' | 'refused' | 'unknown'

/** (0.7.59) The most characters of the app's own words a `refused` item carries (OW's `BRIDGE_PINS_WHY_TEXT_MAX`). */
export const PIN_REPORT_WHY_TEXT_MAX = 120

/** (0.7.23) One client in the pin report: one that should be pinned (R1, `pinsFor`), and whether it is. */
export type PinReportItem = {
  project_id: string
  client: string
  kind: string
  tone: 'red' | 'yellow' | 'green'
  due_at: string | null
  pinned: boolean
  why_not: PinWhyNot | null
  /** (0.7.59) With `refused` alone: the app's own words, cleaned and cut at PIN_REPORT_WHY_TEXT_MAX. */
  why_text?: string
  /**
   * ⛔ (0.7.60, Rob approved 2026-11-19 ('Yes, all five'): "Only a client date turns a thread red") Whose clock `due_at` is:
   * `internal` for one of the person's own clocks (an owed ETA, or INTERNAL_CLOCK_BASES), which OW never draws red or late;
   * `client` for every other. OW before it ignores the key.
   */
  clock: 'client' | 'internal'
}

/** (0.7.23) A client thread that is pinned though its client is not in the report's items: who pinned it. */
export type PinReportExtra = { project_id: string | null; client: string | null; by: 'bridge' | 'person' }

/** (0.7.23) The pin report, exactly as OW's `POST /api/ext/bridge-pins` takes it. */
export type PinReport = { at: string; items: PinReportItem[]; extra: PinReportExtra[] }

/** (0.7.23) The most items and extra rows a report carries: past that it is trimmed, never refused. */
export const PIN_REPORT_ITEMS_MAX = 200
export const PIN_REPORT_EXTRA_MAX = 100

/** (0.7.27) A status's colour as the pin report says it. */
const REPORT_TONE: Record<StatusDot, PinReportItem['tone']> = { '🔴': 'red', '🟡': 'yellow', '🟢': 'green' }

/** (0.7.23) A text cut to `max` characters (by code point), as the report's contract caps its strings. */
const capText = (text: string, max: number): string => [...text].slice(0, max).join('')

/**
 * (0.7.23, Rob 2026-11-05, for the team's daily "Pins by person" image: "it should be everything that should be pinned, and
 * there should be another indicator, like a green light beside it, to show if it is or not.") What one sync reports to OW
 * after its pin pass. `items`: every client on the person's lists (the Needs-you list, then With a teammate, then Checking
 * your reply; a client once, the first wins) that should be pinned by R1's test (`pinsFor`), with whether its linked thread
 * is pinned once the pass is done and, when not, why: `no_thread` (no link), `unseen` (its thread could not be seen this
 * sync: `unseen` or `away`), `person_unpinned` (the person's unpin stands: `staysOff`), `write_cap` (the pass wanted it pinned
 * but had no writes left, MAX_WRITES), (0.7.59) `refused` (the app refused the pin, or a refusal still holds it back: `refused`,
 * with the app's words as `why_text`), else `unknown`. `tone` is red once the clock its thread's name shows is past, and
 * `due_at` that clock. `extra`: the client threads pinned once the pass is done whose client is not in `items`, and whether
 * the pin is the bridge's or the person's; never a thread linked to no client (the person's own). ⛔ Pure: it reads only what
 * it is given. (0.7.23, coordinator 2026-11-05) A client whose thread the pass named through the checking loop
 * (`checkedOff`: R8, a newer send being checked, its thread unpinned whoever pinned it) is not in `items`: it is off the
 * person's plate, so it is not one that should be pinned. One the loop did not name that way stays in, as the pass treats
 * it; its thread, if still pinned, may be in `extra`.
 */
export function pinReport(o: {
  now: number
  listed: readonly QueueItem[]
  links: Readonly<Record<string, string>>
  thread: (sid: string) => AppThread | undefined
  hidden: (sid: string) => boolean
  /** (0.7.35) A thread of the person's other Claude profile: no thread here, so `no_thread`, never `unseen`. */
  elsewhere?: (sid: string) => boolean
  stayedOff: ReadonlySet<string>
  capped: ReadonlySet<string>
  /** (0.7.59) The threads whose pin the app refused this pass, or whose refusal still holds them back: thread id → the app's words. */
  refused?: ReadonlyMap<string, string>
  /** (0.7.23) The clients (project ids) whose thread the pass named through the checking loop (R8). */
  checkedOff?: ReadonlySet<string>
  /**
   * ⛔ (0.7.68) The client threads whose own declaration (`mm waiting`) should pin them this pass, the feed not pinning them:
   * project id → thread. Each is an item of kind `waiting`, with no due time. ⛔ Only the ids go in: the thread's question and
   * its kind never reach the report.
   */
  waiting?: ReadonlyMap<string, string>
  byUs: (sid: string) => boolean
  client: (projectId: string, sid: string) => string | undefined
}): PinReport {
  const seen = new Set<string>()
  const items: PinReportItem[] = []
  for (const it of o.listed) {
    if (!it || typeof it !== 'object' || seen.has(it.projectId)) continue
    seen.add(it.projectId)
    if (!pinsFor(it, o.now) || o.checkedOff?.has(it.projectId)) continue
    const sid = o.links[it.projectId]
    const s = sid ? o.thread(sid) : undefined
    const pinned = s?.pinned === true
    const whyNot: PinWhyNot | null = pinned
      ? null
      : !sid || o.elsewhere?.(sid)
        ? 'no_thread'
        : !s
          ? o.hidden(sid) ? 'unseen' : 'unknown'
          : o.stayedOff.has(sid)
            ? 'person_unpinned'
            : o.refused?.has(sid)
              ? 'refused'
              : o.capped.has(sid)
                ? 'write_cap'
                : 'unknown'
    const whyText = whyNot === 'refused' && sid ? cleanText(o.refused?.get(sid), PIN_REPORT_WHY_TEXT_MAX) : ''
    // the clock its thread's name shows (`pinTitle`): a teammate's part to check on (the PM's), else the client's due time
    const c = ownPins(it, o.now) ? null : checkNow(it, o.now)
    // (0.7.27, Rob 2026-11-05: "Every status shows by name in each person's row on the 9 AM image") the status that names the
    // thread, when one does: its kind, its colour and its date
    const status = c ? (c.pace ? paceStatus(c.pace, o.now) : null) : statusOf(it, o.now)
    const notStarted = c !== null && c.pace === undefined && c.notStarted && checkDot(c, o.now) === '🟡'
    // ⛔ (0.7.60) the clock its name shows is the client's own due time once an internal one has passed (`leadDueOf`); with
    // none, the internal one, sent as such
    const lead = leadDueOf(it, o.now)
    const behind = internalBehindAt(it, o.now)
    const at = status ? status.at : c ? c.due : Number.isFinite(lead) ? lead : Number.isFinite(behind) ? behind : NaN
    // whose clock that is: an internal one passed (`behind`), or (no status, or a not-started start-by, the one status with
    // no sentence of its own) the client's soonest due time while it is not the client's own. A pace row's date is a client's.
    const internal = c === null && Number.isFinite(at) && (status ? status.internal === true || (status.why === '' && at < clientDueOf(it)) : at < clientDueOf(it))
    items.push({
      project_id: it.projectId,
      client: capText(cleanText(it.client, 80), 80),
      kind: capText(status ? status.kind : notStarted ? 'behind' : String(it.kind ?? ''), 16),
      tone: status ? REPORT_TONE[status.dot] : Number.isFinite(at) && at <= o.now && !internal ? 'red' : 'yellow',
      due_at: Number.isFinite(at) ? new Date(at).toISOString() : null,
      pinned,
      why_not: whyNot,
      ...(whyText ? { why_text: whyText } : {}),
      clock: internal ? 'internal' : 'client',
    })
  }
  // ⛔ (0.7.68, Rob 2026-11-23) a thread that waits on the person's answer by its own declaration, the feed not pinning it: kind
  // `waiting`, yellow, no due time and so no clock of a client's (`clock: 'internal'`: OW never draws it red or late). Its why
  // when not pinned is as for any item: `person_unpinned` while the person's unpin stands for that declaration (`stayedOff`).
  // (a client listed but not pinned by the feed is not an item yet: `seen` holds every listed client, so the items are asked)
  const reported = new Set(items.map(i => i.project_id))
  for (const [pid, sid] of o.waiting ?? []) {
    // (OW refuses a whole report with an item that names no client: one with no name on record is left out)
    const name = cleanText(o.client(pid, sid) ?? '', 80)
    if (!isUuid(pid) || reported.has(pid) || !name) continue
    reported.add(pid)
    const s = o.thread(sid)
    const pinned = s?.pinned === true
    const whyNot: PinWhyNot | null = pinned
      ? null
      : !s
        ? o.hidden(sid) ? 'unseen' : 'unknown'
        : o.stayedOff.has(sid)
          ? 'person_unpinned'
          : o.refused?.has(sid)
            ? 'refused'
            : o.capped.has(sid)
              ? 'write_cap'
              : 'unknown'
    const whyText = whyNot === 'refused' ? cleanText(o.refused?.get(sid), PIN_REPORT_WHY_TEXT_MAX) : ''
    items.push({
      project_id: pid,
      client: capText(name, 80),
      kind: 'waiting',
      tone: 'yellow',
      due_at: null,
      pinned,
      why_not: whyNot,
      ...(whyText ? { why_text: whyText } : {}),
      clock: 'internal',
    })
  }
  const inItems = new Set(items.map(i => i.project_id))
  const extra: PinReportExtra[] = []
  for (const [pid, sid] of Object.entries(o.links)) {
    if (inItems.has(pid) || o.thread(sid)?.pinned !== true) continue
    const name = cleanText(o.client(pid, sid) ?? '', 80)
    extra.push({ project_id: isUuid(pid) ? pid : null, client: name ? capText(name, 80) : null, by: o.byUs(sid) ? 'bridge' : 'person' })
  }
  return { at: new Date(o.now).toISOString(), items: items.slice(0, PIN_REPORT_ITEMS_MAX), extra: extra.slice(0, PIN_REPORT_EXTRA_MAX) }
}
