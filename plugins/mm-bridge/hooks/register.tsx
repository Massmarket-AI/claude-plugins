import type { EngineInterface, Register } from 'claude-code'

import type { MmBand, MmFolds, MmNotice, MmQueue, MmView } from '../types'

import { MAIL_LOOKBACK_HOURS, MAX_PINS, buildLists, cleanName, cleanTitle, clearedTitle, clientInTitle, clientMarkdown, dueLine, feedClients, holdBanner, isDraftDone, isUuid, needsLine, noteText, titleFor } from './queue'
import type { Feed, FeedThread, KnownClient, QueueItem } from './queue'
import {
  LABEL, PANE_SENTENCE, THREAD_ID, autoLinkFate, autoLinkFor, bandWords, clientThreads, declaredOther, foldGroups, hasWaiting, kickoffText, openCommand, ownerOf, platformOf, recommend, rowButtons, rowDetail, rowFor,
  rowGroups, signatureOf, threadLength, threadLink, threadRows, titleSuggestion,
} from './threads'
import type { AppThread, ContextReading, Fold, Pairs, Recommendation, Replaced, Row, RowButton, RowState, Sent } from './threads'

// The Massmarket bridge.
// Pinned threads are each person's to-do list: a client's thread pins itself and its name says what is
// due and when; opening it shows the drafts in a side pane and leaves a short note for Claude.
//
// Rob, 2026-10-12: "There should be a process that should already be looking to see what threads exist and
// deciding whether we should start a new one or not, and then making it really easy to pick up." So a
// client's existing thread links itself (a thread whose Claude Code session declared that client), each row
// of the Needs-you pane carries a recommendation, and its buttons act on it.
//
// Rob, 2026-10-12, on seeing it: "I think it should be 'update thread', 'open thread', or 'start thread'...
// depending on whether you know what we should do." So a row has ONE action, chosen by its state: Start
// (no thread, or the existing one is old or long), Update (the thread lacks what is waiting now), or Open
// (it already has it). And: "How do we open this panel up in other threads where it's not already open?"
// So every desktop thread carries one line above the prompt with a button that opens the list.
//
// ⛔ NEVER BY ITSELF. Linking, pinning and renaming are the only things a sync does. A message goes into a
// thread, and a chip is minted, only from a button the person pressed in the pane or a /mm command the
// person typed: updateThread and startThread, reached from `press` and from `runCommand` when it runs for
// the person. That message starts a model turn in the client's thread: the one paid moment the bridge
// causes, and the person asked for it.
// ⛔ CLAUDE CANNOT DO EITHER. The model can call the `mm` tool, and the tool runs the same `runCommand`:
//    there, and for a /mm command that did not come from the person's own prompt (a message from another
//    session, a scheduled task, a channel, another plugin), `update` and `start` are refused before
//    anything is read, called or written. The same for `link` in a thread that is already another
//    client's: only the person moves a thread from one client to another.
// ⛔ A thread is one client's. Update never sends one client's kickoff into a thread linked to another,
//    and a thread that ran sessions for more than one client is never linked by itself, to either.
// ⛔ A press acts on the thread its row showed, or on none. A link, an unlink record and a stamp are
//    written only after the message went.
// ⛔ It only touches threads linked to a client, and only unpins a thread it pinned itself.
// ⛔ A thread the person unlinked never links itself again, and gets its own name back.
// ⛔ A thread the person acted on (Update, /mm link, a chip they started) stays pinned for a day, whatever
//    the cap of 8 says: the cap is filled with those first, then with threads that linked themselves.
// ⛔ A thread that linked itself gets the pin and the name, nothing more, until the person acts on it; and
//    the link is undone once the feed stops listing that thread's session for the client.
// ⛔ Where the app's thread list is not there (a terminal session, or an answer that is not a list of
//    threads), nothing about threads is changed and there is nothing for Update to act on.
// ⛔ A link is never dropped only because its thread is missing from the app's list (the 60 most recent):
//    the app is asked for that thread by id, and only "no such thread" or "archived" drops it. An empty
//    list is this thread alone (the list leaves the calling thread out) and drops nothing at all.
// ⛔ Feed text and thread titles are data: ids must be uuids, names and titles are cleaned (./queue.ts). A
//    200 that is not a feed is a failed call. The [mm-link] marker is the person's own prompt's alone.
// ⛔ A client's link moves from one thread to another in two ways only: the person's /mm link, and a new
//    thread started from the bridge's own chip for that client (Start thread, /mm start). Never otherwise.
// ⛔ A session reads its OWN context window, at most once in five minutes, and never another thread's.
// ⛔ The band above the prompt draws from what is stored: it makes no feed call and no app call.
// ⛔ The bridge reads nothing of a thread: no transcript, no events. A new thread that takes over from an
//    old one is asked, in its kickoff, to read that thread's last three messages itself.
// ⛔ To take the person to a thread, ONE program is started: the system's own opener, with the app's own
//    link to that thread as its only argument besides the opener's own, and only because the person
//    pressed Open thread or Update thread or typed /mm update (openThread).

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.4.1'
const CLIENT_HEADER = { 'X-MM-Client': `mm-bridge/${VERSION}` }
const VIEW = { plugin: 'mm-bridge', key: 'view' } as const
const QUEUE = { plugin: 'mm-bridge', key: 'queue' } as const
const NOTICE = { plugin: 'mm-bridge', key: 'notice' } as const
const BAND = { plugin: 'mm-bridge', key: 'band' } as const
const FOLDS = { plugin: 'mm-bridge', key: 'folds' } as const
const PANE_VIEW = 'mm-view'
const PANE_QUEUE = 'mm-queue'
const SYNC_MS = 5 * 60_000
const TICK_MS = 60_000
const LEASE_MS = 150_000
const MAX_WRITES = 24
const DAY_MS = 24 * 3_600_000
/** A session's own pair (Claude Code session id → app thread) is kept this long after it last ran. */
const PAIR_KEEP_MS = 30 * DAY_MS
/** The most threads the store remembers an original title, or an unlink, for. */
const REMEMBER_MAX = 300
/** A link the person made or used stays pinned this long, ahead of the cap. Real hours: this is not a client's clock. */
const ACTED_MS = DAY_MS
/** The desktop app's own record of a thread is read only when it changed in this long. */
const RECORD_MAX_AGE_MS = 30 * DAY_MS
/** `local_<id>.json`: one record per thread, named by the app's thread id. */
const RECORD_FILE = /^(local_[A-Za-z0-9_-]{1,100})\.json$/
/** The most record files opened in one sync. */
const RECORDS_PER_SYNC = 40
const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/
/** A link the bridge made by itself is undone once its thread is missing from the feed's threads this many syncs in a row. */
const AUTO_MISSES = 3
/** Two of those misses count only when they are this far apart: three /mm in a row are one sync, not three. */
const MISS_GAP_MS = 5 * 60_000
/** The most threads asked for by id in one sync: linked or pinned threads the app's list (its 60 most recent) left out. */
const LOOKUPS_PER_SYNC = 10
/** A session asks the app for its own context reading no more often than this. */
const CONTEXT_EVERY_MS = 5 * 60_000
/** A chip the bridge minted is remembered this long: a thread started from it later than that is a thread like any other. */
const CHIP_KEEP_MS = 30 * DAY_MS
/** The most chips remembered at once. */
const CHIPS_MAX = 100
/** A chip whose withdrawal fails this many times is forgotten. */
const DISMISS_TRIES = 5
/** A press on a row's button is in flight no longer than this: after it, the row takes a press again. */
const PRESS_HOLD_MS = 30_000
/** The system's opener is given this long to take a thread's link. */
const OPEN_WAIT_MS = 10_000
/** After a reply draft is sent or discarded in this thread, one sync runs this long after the last such call. */
const ASK_WAIT_MS = 10_000
/** The first line of the message Update sends: how a session knows an Update just arrived in its thread. */
const UPDATE_OPENS_WITH = 'New since this thread last worked on this client: '
/** `[mm-link <project id>]`, counted only at the very start of a prompt. */
const MARKER = /^\[mm-link ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/
/**
 * Where a prompt or a /mm command is the person's own: typed here (`composer`), sent from their phone or
 * the web (`bridge`), or the app's own turn for them, as when it starts a thread from a chip (`sdk`).
 * ⛔ Nothing else: not another Claude session's message (`peer`), a schedule, a channel or a plugin.
 */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

const NO_THREAD_LIST = 'The app\'s thread list is not available here.'
const THREAD_GONE = 'That thread is no longer available. The list has been refreshed.'
/** What Claude is told when it calls the tool with a verb only the person may use. */
const ONLY_THE_PERSON = {
  update: 'Only the person can do this: press Update thread in the pane or type /mm update <client>.',
  start: 'Only the person can do this: press Start thread in the pane or type /mm start <client>.',
} as const

type Mcp = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
type Pin = { projectId: string; client: string; byUs: boolean }
type Last = {
  at: number
  member: string
  /** The clients that need the person now: what pins, and what the header and the band count. */
  items: QueueItem[]
  /** Clients whose reply drafts a teammate holds, and clients whose only items are more than 3 business days overdue: listed, never pinned, never counted. */
  teammate?: QueueItem[]
  older?: QueueItem[]
  pinned: number
  recs: Record<string, Recommendation>
  /** Every project id the last feed carried: the only ids an [mm-link] marker may name. */
  projects?: string[]
  error?: string
}
/** Every client the last sync listed, in any of the three lists: what a button, a command or a thread's own pane may be about. */
const listedIn = (last: Last | null | undefined): QueueItem[] => [
  ...(Array.isArray(last?.items) ? last.items : []),
  ...(Array.isArray(last?.teammate) ? last.teammate : []),
  ...(Array.isArray(last?.older) ? last.older : []),
]
/**
 * A pin the person took off a thread the bridge had pinned: when, and the newest time of each kind of
 * thing its client had then. The thread is not pinned again until one of them is newer.
 */
type Unpinned = { at: number; mail: number; pkg: number; task: number }
type Verb = RowButton
/** A link the person made or used: which thread, and when. */
type Acted = Record<string, { sid: string; at: number }>
/**
 * A chip the bridge minted for a client and the person has not started yet. A chip shows only in the
 * thread that minted it, and only that thread's session can withdraw it, so the record says which.
 * One live chip per client: minting another marks the earlier one `superseded`.
 */
type Chip = {
  projectId: string
  /** What its prompt carries (signatureOf): the thread started from it already has this. */
  signature: string
  /** The app's id for the chip, from its answer to the mint; '' when it gave none (it cannot be withdrawn then). */
  taskId: string
  /** The thread it was minted in. */
  threadId: string
  at: number
  /** Its prompt exactly as minted: the thread that opens with this prompt was started from this chip. */
  prompt: string
  /** The thread the client was linked to when it was minted, if any: a link to any other thread since means the client has moved on. */
  had?: string
  superseded?: true
  /** Withdrawals that failed so far. */
  tries?: number
}
/**
 * A link the bridge made by itself and the person has not acted on: its thread, how many syncs in a row
 * the feed has not listed it, and when the last of those was counted.
 */
type Auto = Record<string, { sid: string; miss: number; at?: number }>
/** What the app's record of a thread said when it was opened: its modified time then, and the session id if it gave one. */
type Records = Record<string, { m: number; cli?: string }>
/**
 * The app's threads as one sync sees them. `complete` is false for an empty list (the app's list leaves the
 * calling thread out, so a person with one open thread gets none): this thread is then the whole list, and
 * ⛔ nothing may be dropped on its word.
 */
type Listed = { threads: AppThread[]; complete: boolean }
/**
 * One pass over a feed. `listed` is false where the app's thread list could not be had. `unseen` holds the
 * linked or pinned threads the list left out and the app did not answer for: kept, and not acted on.
 */
type Pass = { last: Last; live: Map<string, AppThread>; pairs: Pairs; listed: boolean; unseen: ReadonlySet<string> }
/** Who ran a /mm command: the person, or anything else (the model through the tool, another session, a schedule, a plugin). */
type By = 'person' | 'other'

/**
 * This session's thread, as the app answered `get_session self`, by the session's own id. In the app one
 * module serves one session, so this holds one entry; keyed by the session, several sessions run against
 * one store in a test (concurrency.test.ts) each know their own thread.
 */
const selves = new Map<string, string>()
/** When this session last asked the app for its own context reading (0: never). */
let contextAskedAt = 0
/**
 * The presses in flight in this session, by client: when each began. A second press for a client whose
 * first has not returned does nothing (Rob pressed Update, saw nothing happen, pressed again, and the
 * thread got two messages).
 */
const pressing = new Map<string, number>()
let pressCount = 0
/** The one sync this session owes after a reply draft was sent or discarded in it (askSync): its timer, or none. */
let askTimer: { cancel: () => void } | null = null
/**
 * What this session's Update sent into a thread, by client and thread: the kickoff's signature. Asked before
 * every Update beside what is stored, so a second press never sends the same kickoff into the same thread,
 * even when the store refused every write after the first went (review of 79cbc596, F2).
 */
const sentHere = new Map<string, string>()
/**
 * The chips this session minted whose record the store refused, by client, thread and what they carry: a
 * second press mints none while the store cannot say the chip is there. Forgotten once the record is written,
 * or the client has moved on (M1).
 */
const mintedHere = new Set<string>()

/**
 * A write that failed after the person's act went (an Update's message, a chip): noted where the bridge's
 * other errors go, the heartbeat file the timer's and registration's errors go to. Never swallowed silently.
 */
async function noteFailure($: EngineInterface, what: string, err: unknown): Promise<void> {
  await beat($, { ok: false, writeError: short(`${what}: ${errorText(err)}`, 300) })
}

const textOf = (r: Mcp) => (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
const short = (s: string, n = 200) => s.replace(/\s+/g, ' ').slice(0, n)
const errorText = (err: unknown) => short(err instanceof Error ? err.message : String(err), 300)
/** The member's address as the feed gave it, kept to what an address is made of. */
const memberText = (member: unknown) => (typeof member === 'string' ? member : '').replace(/[^A-Za-z0-9._%+@-]/g, '').slice(0, 120)
/** A thread name the bridge wrote itself: never anybody's original title. */
const isOurTitle = (title: string) => /^(?:🔴|🟡|✓)\s/u.test(title)

async function mcpJson($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const r = (await $.mcp.call(server, tool, args)) as Mcp
  const text = textOf(r)
  if (r.isError) throw new Error(`${server}.${tool}: ${short(text)}`)
  try {
    return JSON.parse(text.slice(text.search(/[[{]/)))
  } catch {
    return text
  }
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

async function token($: EngineInterface): Promise<string> {
  try {
    const t = (await $.fs.read(`${await home($)}/.claude/mm-hooks/token`)).trim()
    if (t) return t
  } catch {
    // no token file: handled below
  }
  throw new Error('not set up on this computer: no tracker token. Run the Massmarket installer from the time tracker extension.')
}

// The desktop app's session tools (list, rename, pin) exist only in its Code tab. Elsewhere (a terminal
// session) the bridge still answers /mm, it just has no threads to pin or rename.
async function desktopOnly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

async function selfId($: EngineInterface): Promise<string> {
  const cli = await instanceId($)
  const known = selves.get(cli)
  if (known) return known
  const me = await desktopOnly(async () => (await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as AppThread, null)
  if (!me?.sessionId) return ''
  selves.set(cli, me.sessionId)
  return me.sessionId
}

/** This thread's id as the timer already learnt it, or '': no app call is made to find it out. */
async function knownSelf($: EngineInterface): Promise<string> {
  return selves.get(await instanceId($)) ?? ''
}

async function instanceId($: EngineInterface): Promise<string> {
  return String((await $.session.id()) ?? '')
}

/** A thread as the app answered it, kept to the fields the bridge uses; null for anything that is not an open thread. */
function asThread(raw: unknown): AppThread | null {
  const t = raw as Partial<AppThread> | null | undefined
  if (!t || typeof t !== 'object' || typeof t.sessionId !== 'string' || !t.sessionId || t.isArchived) return null
  // the app's own link to the thread, kept only when it is exactly that thread's (threadLink)
  const link = threadLink(t as { sessionId: string; link?: unknown })
  return {
    sessionId: t.sessionId,
    title: typeof t.title === 'string' ? t.title : '',
    pinned: Boolean(t.pinned),
    isArchived: false,
    ...(typeof t.lastActivityAt === 'string' ? { lastActivityAt: t.lastActivityAt } : {}),
    ...(link ? { link } : {}),
  }
}

/**
 * The app's open threads, or null where the list cannot be had: no app to ask (a terminal session), a call
 * that failed, or an answer that is not a list. ⛔ null is "unknown", never "none".
 *
 * The app's list leaves the calling thread out, so a person with one open thread gets an empty list. An
 * empty list from a call that worked, in a session that knows its own thread, is a list of one: this
 * thread may link, pin and name itself. It is marked not `complete`: ⛔ an empty answer never drops a
 * link, a pin, a title or a record, because it cannot be told from the app answering nothing by mistake.
 */
async function sessions($: EngineInterface): Promise<Listed | null> {
  return desktopOnly<Listed | null>(async () => {
    const others = await mcpJson($, 'ccd_session_mgmt', 'list_sessions', { limit: 60 })
    if (!Array.isArray(others)) return null
    const me = asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' }))
    if (others.length === 0) return me ? { threads: [me], complete: false } : null
    const threads: AppThread[] = []
    for (const raw of [me, ...others]) {
      const t = asThread(raw)
      if (t && !threads.some(x => x.sessionId === t.sessionId)) threads.push(t)
    }
    return { threads, complete: true }
  }, null)
}

/**
 * One thread, asked for by id: for a linked or pinned thread the app's list left out (the list holds its 60
 * most recent). The thread when it is open; 'gone' ONLY when the app says there is no such thread or shows
 * it archived; 'unknown' for any error, any other answer, or no app to ask. ⛔ Only 'gone' may drop a link.
 */
async function lookup($: EngineInterface, sid: string): Promise<AppThread | 'gone' | 'unknown'> {
  const noSuchThread = (text: string) => text.includes(sid) && /\bnot found\b/i.test(text)
  try {
    const r = (await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: sid })) as Mcp
    const text = textOf(r)
    if (r.isError) return noSuchThread(text) ? 'gone' : 'unknown'
    let raw: Partial<AppThread> | null
    try {
      raw = JSON.parse(text.slice(text.search(/[[{]/))) as Partial<AppThread> | null
    } catch {
      return 'unknown' // an answer that is not a thread says nothing about this one
    }
    if (!raw || typeof raw !== 'object' || raw.sessionId !== sid) return 'unknown'
    return raw.isArchived ? 'gone' : (asThread(raw) ?? 'unknown')
  } catch (err) {
    // the call itself was refused: "no such thread" only when that is what the app said, about this thread
    return noSuchThread(errorText(err)) ? 'gone' : 'unknown'
  }
}

/** Every project id a feed carries, uuids only: what an [mm-link] marker may name. */
function feedProjects(feed: Feed): string[] {
  const ids = new Set<string>()
  const add = (id: unknown) => {
    if (isUuid(id) && ids.size < 500) ids.add(id)
  }
  for (const m of feed.mail ?? []) add(m.project_id)
  for (const d of feed.drafts ?? []) add(d.project_id)
  for (const k of [feed.tickets?.overdue, feed.tickets?.due_today, feed.tickets?.due_soon]) for (const t of k ?? []) add(t.project_id)
  for (const t of Array.isArray(feed.threads) ? feed.threads : []) add(t?.project_id)
  return [...ids]
}

/** The feed's `threads` rows that are usable: a uuid project and a session id the worklog hook could have sent. */
function feedThreadsOf(feed: Feed): FeedThread[] {
  return (Array.isArray(feed.threads) ? feed.threads : []).filter(t => t && isUuid(t.project_id) && typeof t.session_id === 'string' && SESSION_ID.test(t.session_id))
}

async function fetchFeed($: EngineInterface): Promise<Feed> {
  // (OW's most: mail old enough to go under Older is in the feed, MAIL_LOOKBACK_HOURS)
  const r = await $.http.fetch(`${EXT}/closeout?mail_hours=${MAIL_LOOKBACK_HOURS}`, { headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER } })
  const failed = () => new Error(`closeout HTTP ${r.status}: ${short(r.text, 160)}`)
  if (!r.ok) throw failed()
  const feed = JSON.parse(r.text) as Feed | null
  // ⛔ A 200 that is not a feed (neither `tickets` nor `mail` in it) is a failed call, not "nobody needs
  // you": read as an empty feed it would take every pin off and rename every thread "clear".
  if (!feed || typeof feed !== 'object' || !('tickets' in feed || 'mail' in feed)) throw failed()
  return feed
}

async function storeGet<T>($: EngineInterface, key: string, fallback: T): Promise<T> {
  const v = await $.store.get(key)
  return (v === undefined || v === null ? fallback : v) as T
}

/** Keeps the newest `max` entries of a record the store holds (insertion order). */
function capped<T>(record: Record<string, T>, max = REMEMBER_MAX): Record<string, T> {
  const keys = Object.keys(record)
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete record[k]
  return record
}

/**
 * ⛔ THE ONE WAY a map or a list that sessions share is written to the store (B1, 2026-10-13: of fifteen
 * threads started within a minute or two, two lost the link their [mm-link] marker wrote).
 *
 * Every desktop thread is a process of its own. The engine reads the store's file afresh on each get and
 * writes ONE key on each set, under a lock (its own source, 2.1.295), so a set never touches another key.
 * But a key is written whole: a session that writes back a map it read earlier takes away whatever another
 * session put into it since (a dozen threads linking themselves; a sync whose pass takes seconds of app
 * calls between its reads and its writes). So the key is read again immediately before the write, `change`
 * makes ONLY its caller's own change to that fresh copy, and it is written at once: nothing is awaited
 * between the read and the write. `change` answers false to write nothing; `stored` tells it whether the
 * store held the key at all. A value of the wrong shape (an older version's, a damaged file) is read as
 * `empty`.
 * The store has no compare-and-set, so two sessions can still meet between that read and that write; what
 * the person's own act wrote is checked again a moment later (`settleLater`).
 */
async function patchStore<T extends object>($: EngineInterface, key: string, empty: T, change: (fresh: T, stored: boolean) => boolean | void): Promise<T> {
  const v = await $.store.get(key)
  const shaped = v !== null && typeof v === 'object' && Array.isArray(v) === Array.isArray(empty)
  const fresh = (shaped ? v : empty) as T
  if (change(fresh, v !== undefined) === false) return fresh
  await $.store.set(key, fresh)
  return fresh
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** A copy of what a pass read, to tell later what the pass itself changed. */
const copyOf = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) ?? v

/**
 * What a pass changed in a map, entry by entry, made on the store's fresh copy (`patchStore`): `before` is
 * the map as the pass read it, `after` as the pass left it. An entry the pass did not change is left as the
 * store has it now, and so is one another session changed since the pass read it: a sync never takes back a
 * link, a pin or a record written while it ran (it sees it on its next pass). Answers whether it changed
 * anything. `only` makes just the entries it set (`set`) or just the ones it removed (`delete`): a record
 * another depends on is written before it and removed after it (F2).
 */
function applyChanges<V>(fresh: Record<string, V>, before: Readonly<Record<string, V>>, after: Readonly<Record<string, V>>, only?: 'set' | 'delete'): boolean {
  let changed = false
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const had = Object.hasOwn(before, k) ? before[k] : undefined
    const has = Object.hasOwn(after, k) ? after[k] : undefined
    if (sameValue(had, has)) continue
    if ((only === 'set' && has === undefined) || (only === 'delete' && has !== undefined)) continue
    const now = Object.hasOwn(fresh, k) ? fresh[k] : undefined
    if (!sameValue(now, had)) continue
    if (has === undefined) delete fresh[k]
    else fresh[k] = has as V
    changed = true
  }
  return changed
}

/** The same for a list of thread ids: what the pass took off it comes off, what it added goes on, the rest is the store's. */
function applyListChanges(fresh: string[], before: readonly string[], after: readonly string[]): boolean {
  const off = before.filter(x => !after.includes(x))
  const on = after.filter(x => !before.includes(x) && !fresh.includes(x))
  const kept = fresh.filter(x => !off.includes(x))
  if (kept.length === fresh.length && !on.length) return false
  fresh.splice(0, fresh.length, ...kept, ...on)
  return true
}

/** 1 to 3 seconds, spread by the thread's own id: a dozen threads that start together do not check again together. */
function settleMs(id: string): number {
  // FNV-1a, then mixed, so ids that differ in one character land far apart
  let h = 0x811c9dc5
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return 1_000 + (h % 2_001)
}

/**
 * Once, 1 to 3 seconds after a write the person's own act made (a marker's link, a session's own pair), it is
 * read again and written again if it is gone: what two sessions meeting between a read and a write can still
 * lose (patchStore), and what a set the engine could not lock in time never wrote. Anything going wrong here
 * is swallowed: the next sync is the fallback.
 */
function settleLater($: EngineInterface, id: string, check: () => Promise<void>): void {
  try {
    $.clock.after(settleMs(id), () => void check().catch(() => {}))
  } catch {
    // no timer here: nothing is checked again
  }
}

/**
 * The app's list of threads does not say which Claude Code session runs in each, and the feed names a
 * thread by that session id (it is what the worklog hook sends). So every session writes down its own
 * pair, and the session that syncs reads them all: a thread opened since this version was installed can
 * be matched to the client its session declared.
 */
async function recordSelf($: EngineInterface): Promise<void> {
  const app = await selfId($)
  const cli = await instanceId($)
  if (!app || !cli) return
  const now = await $.clock.now()
  const mine = (await storeGet<Pairs>($, 'mm.threads', {}))[cli]
  if (mine && mine.app === app && now - mine.at < DAY_MS) return
  const write = () =>
    patchStore<Pairs>($, 'mm.threads', {}, pairs => {
      pairs[cli] = { app, at: now }
      for (const [k, v] of Object.entries(pairs)) if (!v || now - v.at > PAIR_KEEP_MS) delete pairs[k]
    })
  // gone a moment later (another session's write met this one, or this one was never made): written again.
  // A pair the app's own record has since given another thread is the app's word, and is left.
  settleLater($, app, async () => {
    if (!(await storeGet<Pairs>($, 'mm.threads', {}))[cli]) await write()
  })
  await write()
}

/**
 * This session's reading of ITS OWN context window, kept under its thread's id: how a row knows a thread
 * is long (Rob, 2026-10-12: "if the context is too long, you should also recommend starting a new thread").
 *
 * ⛔ Asked for `self` only, never for another thread, and never from a button press. At most once in
 *    CONTEXT_EVERY_MS for this session, whatever the answer was.
 * ⛔ Four numbers are kept: tokens used, the window, the percent, and when. Nothing of the answer's `plan`
 *    is read. Any error, or a status that is not `ok`, changes nothing.
 */
async function recordContext($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (contextAskedAt && now - contextAskedAt < CONTEXT_EVERY_MS) return
  // The session's own thread, as the timer already learnt it: no call is made here to find it out.
  const me = await knownSelf($)
  if (!me) return
  contextAskedAt = now
  try {
    const answer = (await mcpJson($, 'ccd_session_mgmt', 'get_usage', { session_id: 'self' })) as { context?: Partial<ContextReading> & { status?: unknown } } | null
    const c = answer && typeof answer === 'object' ? answer.context : undefined
    if (!c || c.status !== 'ok') return
    const numbers = [c.tokensUsed, c.contextWindow, c.percentUsed]
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return
    const reading = { tokensUsed: c.tokensUsed as number, contextWindow: c.contextWindow as number, percentUsed: c.percentUsed as number, at: now }
    await patchStore<Record<string, ContextReading>>($, 'mm.ctx', {}, all => {
      // written last, so the cap keeps the readings most recently taken
      delete all[me]
      all[me] = reading
      capped(all)
    })
  } catch {
    // no reading this time: the row count decides until there is one
  }
}

/** A thread linked by the person (a command, a button, a chip's first message) may link itself again later. */
async function forgetUnlink($: EngineInterface, sid: string): Promise<void> {
  await patchStore<Record<string, number>>($, 'mm.unlinked', {}, unlinked => {
    if (!(sid in unlinked)) return false
    delete unlinked[sid]
  })
}

/** Where the desktop app keeps its record of each thread, by platform. The first folder that lists is used. */
async function recordRoots($: EngineInterface): Promise<string[]> {
  const roots: string[] = []
  const appData = await $.env.get('APPDATA')
  if (appData) roots.push(`${appData.replace(/[\\/]+$/, '')}\\Claude\\claude-code-sessions`)
  const h = await home($)
  if (h) roots.push(`${h}/Library/Application Support/Claude/claude-code-sessions`, `${h}/.config/Claude/claude-code-sessions`)
  return roots
}

/**
 * The second source for "which Claude Code session runs in which thread": the desktop app's own records,
 * the `local_<id>.json` files under its `claude-code-sessions` folder. They exist for every thread, so a thread links itself without
 * having to be opened again first (Rob, 2026-10-12: "Why are none of them linked?").
 *
 * ⛔ READ-ONLY, through the plugin's own file access. From each record ONLY two things are taken: the
 * thread id and `cliSessionId`. Nothing else in a record is kept, logged or sent anywhere, and nothing
 * from these files leaves this computer: the pairs are only compared with the feed's session ids here.
 *
 * ⛔ IT OPENS ONLY WHAT IT NEEDS. A record is opened only when it is the record of a thread the app listed
 * in this sync, not archived, that has no pair in the store yet; at most RECORDS_PER_SYNC in one sync, the
 * most recently modified first; never one not modified in 30 days. What a record said (its session id, or
 * that it gave none) is remembered with its modified time, so it is not opened again until it changes,
 * and each pair found goes into the store with the pairs the sessions wrote. The folder is listed, not
 * read, to find those files. Any error at all (no such folder, a file that cannot be read or parsed, a
 * different shape) is swallowed: what each session wrote down about itself is then the only source.
 */
async function readRecords($: EngineInterface, now: number, live: ReadonlyMap<string, AppThread>, pairs: Pairs): Promise<void> {
  const paired = new Set(Object.values(pairs).map(p => p?.app))
  const need = new Set<string>()
  for (const s of live.values()) if (!s.isArchived && !paired.has(s.sessionId)) need.add(s.sessionId)
  if (!need.size) return
  const seen = await storeGet<Records>($, 'mm.records', {})
  /** What this pass learnt from the records it opened: the only entries it writes. */
  const learnt: Records = {}
  const found: Pairs = {}
  let opened = 0
  for (const root of await recordRoots($)) {
    const sep = root.includes('\\') ? '\\' : '/'
    /** The newest record on disk for each thread that needs one. */
    const newest = new Map<string, { path: string; mtimeMs: number }>()
    const walk = async (dir: string, depth: number): Promise<void> => {
      for (const entry of await $.fs.list(dir)) {
        const path = `${dir}${sep}${entry.name}`
        if (entry.kind === 'dir') {
          // records sit two folders down today; one more level is allowed for
          if (depth < 3) await walk(path, depth + 1).catch(() => {})
          continue
        }
        const app = entry.kind === 'file' ? RECORD_FILE.exec(entry.name)?.[1] : undefined
        if (!app || !need.has(app) || now - entry.mtimeMs > RECORD_MAX_AGE_MS) continue
        const had = newest.get(app)
        if (!had || entry.mtimeMs > had.mtimeMs) newest.set(app, { path, mtimeMs: entry.mtimeMs })
      }
    }
    try {
      await walk(root, 0)
    } catch {
      continue // this platform's folder is not here: try the next
    }
    const unread = [...newest].filter(([app, file]) => seen[app]?.m !== file.mtimeMs).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)
    const said: Array<{ app: string; cli: string; mtimeMs: number }> = []
    for (const [app, file] of unread.slice(0, RECORDS_PER_SYNC)) {
      let cli = ''
      try {
        const record = JSON.parse(await $.fs.read(file.path)) as { sessionId?: unknown; cliSessionId?: unknown }
        // the record must be this thread's own, and name a session id the hook could have sent
        if ((record.sessionId === undefined || record.sessionId === app) && typeof record.cliSessionId === 'string' && SESSION_ID.test(record.cliSessionId)) {
          cli = record.cliSessionId
        }
      } catch {
        // unreadable, not JSON, too large: this record gives no pair
      }
      opened++
      learnt[app] = seen[app] = cli ? { m: file.mtimeMs, cli } : { m: file.mtimeMs }
      if (cli) said.push({ app, cli, mtimeMs: file.mtimeMs })
    }
    // A record just opened is the app's own word: it wins over a pair a session wrote down. Oldest first,
    // so where two records name one session the more recently modified thread has it.
    for (const r of said.sort((a, b) => a.mtimeMs - b.mtimeMs)) found[r.cli] = { app: r.app, at: now }
    // A record opened earlier whose pair has since dropped out of the store gives it back without being
    // opened again, unless another thread has that session by now.
    for (const [app, file] of newest) {
      const was = seen[app]
      if (was?.cli && was.m === file.mtimeMs && !pairs[was.cli] && !found[was.cli]) found[was.cli] = { app, at: now }
    }
    break
  }
  if (opened) {
    await patchStore<Records>($, 'mm.records', {}, records => {
      // each written last, so the cap keeps the records most recently opened
      for (const [app, said] of Object.entries(learnt)) {
        delete records[app]
        records[app] = said
      }
      capped(records)
    })
  }
  if (Object.keys(found).length) {
    Object.assign(pairs, found)
    // over a fresh copy: another session may have recorded itself since this pass began
    await patchStore<Pairs>($, 'mm.threads', {}, fresh => void Object.assign(fresh, found))
  }
}

/**
 * Every known pair: what each session wrote down about itself, and what the app's records gave. The
 * records are looked at only when the feed names at least one session to match.
 */
async function allPairs($: EngineInterface, now: number, live: ReadonlyMap<string, AppThread>, feedThreads: readonly FeedThread[]): Promise<Pairs> {
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  if (!feedThreads.length) return pairs
  try {
    await readRecords($, now, live, pairs)
  } catch {
    // no pairs from the app: the pairs each session records are the only source
  }
  return pairs
}

/** What a client's thread has now (Update sent it, or a chip it opened with carried it): written last, so the cap keeps the newest. */
async function putSent($: EngineInterface, projectId: string, sent: Sent): Promise<void> {
  await patchStore<Record<string, Sent>>($, 'mm.sent', {}, all => {
    delete all[projectId]
    all[projectId] = sent
    capped(all)
  })
}

/** The person made or used this link (Update, /mm link): its thread stays pinned for a day, and a pin they took off it comes back. */
async function stamp($: EngineInterface, projectId: string, sid: string): Promise<void> {
  const now = await $.clock.now()
  await patchStore<Acted>($, 'mm.acted', {}, acted => {
    for (const [pid, a] of Object.entries(acted)) if (!a || now - a.at >= ACTED_MS) delete acted[pid]
    acted[projectId] = { sid, at: now }
  })
  await pinAgain($, sid)
}

/** The person acted on this thread's client (Update, Start, /mm link): the pin they took off it may come back. */
async function pinAgain($: EngineInterface, sid: string | undefined): Promise<void> {
  if (!sid) return
  await patchStore<Record<string, Unpinned>>($, 'mm.unpinned', {}, unpinned => {
    if (!(sid in unpinned)) return false
    delete unpinned[sid]
  })
}

/**
 * The link is the person's from here on (Update, /mm link, /mm view, a chip they started), no longer one
 * the bridge made by itself: its thread may show the drafts pane, and the link is not undone by a sync.
 */
async function claim($: EngineInterface, projectId: string | undefined, sid: string): Promise<void> {
  await patchStore<Auto>($, 'mm.auto', {}, auto => {
    let changed = false
    for (const [pid, a] of Object.entries(auto)) {
      if (pid !== projectId && a?.sid !== sid) continue
      delete auto[pid]
      changed = true
    }
    return changed
  })
}

/**
 * One pass over a feed: threads link themselves, the linked clients' threads are pinned and named up to
 * the cap (a thread the person acted on in the last day first, and never dropped by the cap), the rest
 * are let go, and every client gets its recommendation. `known` carries the pairs of an earlier pass of
 * the same feed: the app's records are looked at once, and a link's misses are counted once, per feed.
 * ⛔ Sends nothing and starts nothing.
 */
async function reconcile($: EngineInterface, feed: Feed, known?: Pairs): Promise<Pass> {
  const now = await $.clock.now()
  // Three lists, a client in exactly one. Only `items` pins and is counted. The other two are listed
  // under the list, closed: clients whose reply drafts a teammate holds, and clients whose only items are
  // more than 3 business days overdue (nothing drops off silently).
  const lists = buildLists(feed, now)
  const items = lists.queue
  const quiet = [...lists.teammate, ...lists.older]
  /** The two other lists as the sync record keeps them: only when somebody is in them. */
  const also = { ...(lists.teammate.length ? { teammate: lists.teammate } : {}), ...(lists.older.length ? { older: lists.older } : {}) }
  const member = memberText(feed.member)
  const projects = feedProjects(feed)
  const listed = await sessions($)
  const live = new Map((listed?.threads ?? []).map(s => [s.sessionId, s] as const))
  const feedThreads = feedThreadsOf(feed)
  const before = await storeGet<Last | null>($, 'mm.last', null)
  /** The recommendation the last sync gave a client, in its words and without its thread: for a client whose thread cannot be seen now. */
  const carried = (it: QueueItem): Recommendation => {
    // (a sync by an older version stored the state under `action`)
    const was = before?.recs?.[it.projectId] as (Partial<Recommendation> & { action?: unknown }) | undefined
    const state = was?.state ?? was?.action
    const known = state === 'update' || state === 'start' || state === 'current'
    if (!was || !known || typeof was.reason !== 'string') return recommend([], undefined, now)
    // whether the client has no thread at all is carried too: a thread that cannot be seen now is still a thread
    const fresh = was.state !== undefined ? was.fresh === true : state === 'start' && !was.target
    return { state: state as RowState, reason: was.reason, ...(fresh ? { fresh: true as const } : {}) }
  }

  // No thread list here (a terminal session, or an answer from the app that is not a list of threads): the
  // list of clients is shown, each with the recommendation the last sync in the app gave it, and nothing
  // about threads is touched. Links, pins, unlink records and stored titles stay exactly as they are.
  // ⛔ No recommendation carries a thread: with no list there is nothing for Update to act on.
  if (listed === null) {
    const recs: Record<string, Recommendation> = {}
    for (const it of [...items, ...quiet]) recs[it.projectId] = carried(it)
    const last: Last = { at: now, member, items, ...also, pinned: before?.pinned ?? 0, recs, projects }
    await $.store.set('mm.last', last)
    const rowsOf = (list: readonly QueueItem[]): Row[] => list.map(it => rowFor(it, recs[it.projectId] as Recommendation, now))
    await showQueue($, member, items, rowsOf(items), last.pinned, now, { teammate: rowsOf(lists.teammate), older: rowsOf(lists.older) })
    return { last, live, pairs: known ?? {}, listed: false, unseen: new Set() }
  }

  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
  const unlinked = await storeGet<Record<string, number>>($, 'mm.unlinked', {})
  const titles = await storeGet<Record<string, string>>($, 'mm.titles', {})
  const acted = await storeGet<Acted>($, 'mm.acted', {})
  const auto = await storeGet<Auto>($, 'mm.auto', {})
  const sent = await storeGet<Record<string, Sent>>($, 'mm.sent', {})
  const readings = await storeGet<Record<string, ContextReading>>($, 'mm.ctx', {})
  const released = await storeGet<string[]>($, 'mm.released', [])
  const unpinned = await storeGet<Record<string, Unpinned>>($, 'mm.unpinned', {})
  /** The client each thread's [mm-link] marker named: never a thread the bridge links to another by itself. */
  const marked = await storeGet<Record<string, string>>($, 'mm.marked', {})
  /**
   * The shared maps as this pass read them. ⛔ The pass never writes one of them back whole: at its end each
   * gets only what the pass itself changed, over a fresh copy (`applyChanges`). Its app calls take seconds,
   * and a thread started meanwhile writes its own link into the same map (B1).
   */
  const was = { links: copyOf(links), pins: copyOf(pins), titles: copyOf(titles), auto: copyOf(auto), unpinned: copyOf(unpinned), released: Array.isArray(released) ? [...released] : [] }
  /** The threads linked as this pass began: one that is linked no more at its end loses its context reading. */
  const linkedBefore = new Set(Object.values(links))

  // ⛔ A thread missing from the app's list is not a thread that is gone: the list holds the 60 most
  // recent. Each linked or pinned thread the list left out is asked for by id. One the app shows open is a
  // thread like any other. One the app says does not exist, or shows archived, is `gone`. Anything else (an
  // error, no answer, more of them than one sync asks for) is `unseen`: its link, pin record and title are
  // kept exactly as they are, and nothing is done to it.
  // ⛔ And an empty list never drops anything at all, whatever a lookup says.
  const gone = new Set<string>()
  const unseen = new Set<string>()
  const missing = [...new Set([...Object.values(links), ...Object.keys(pins), ...released])].filter(sid => !live.has(sid))
  for (const [n, sid] of missing.entries()) {
    const found = n < LOOKUPS_PER_SYNC ? await lookup($, sid) : 'unknown'
    if (found === 'unknown') unseen.add(sid)
    else if (found !== 'gone') live.set(sid, found)
    else if (listed.complete) gone.add(sid)
    else unseen.add(sid)
  }
  const pairs = known ?? (await allPairs($, now, live, feedThreads))

  // A link to a thread that is gone, or that the person unlinked (a sync in another thread may have written
  // an older copy of the links back after the unlink), is dropped.
  for (const [pid, sid] of Object.entries(links)) if (gone.has(sid) || sid in unlinked) delete links[pid]
  // ⛔ A thread is one client's. Where two clients are linked to one thread (an older version allowed it),
  // the client it is pinned for keeps it, else the first; the other link is dropped.
  const owners = new Map<string, string>()
  for (const [pid, sid] of Object.entries(links)) if (!owners.has(sid) || pins[sid]?.projectId === pid) owners.set(sid, pid)
  for (const [pid, sid] of Object.entries(links)) if (owners.get(sid) !== pid) delete links[pid]

  // A link the bridge made by itself stops being one when the link is gone or the person acted on it.
  // (An entry of any other shape is dropped with them.)
  for (const [pid, a] of Object.entries(auto)) if (!a || typeof a.sid !== 'string' || links[pid] !== a.sid || acted[pid]?.sid === a.sid) delete auto[pid]
  // ⛔ And it is undone when it stops being true. At once, on this sync (B3, 2026-10-13), when it no longer
  // qualifies: the feed's rows for its thread's sessions name another client (alone, or beside this one;
  // the internal-ops project counts like any other), OW marks such a row `sole: false` (the session declared
  // another project the feed does not list), or the thread opened with an [mm-link] marker for another
  // client. More quietly, when the feed stops listing its thread's sessions at all, AUTO_MISSES
  // syncs in a row: those misses are counted once per feed, and only when the feed's list has entries (a
  // feed with no `threads`, or an empty one, says nothing either way and changes no count), and a miss
  // counts only when the one before it is MISS_GAP_MS old (three /mm in a row are one sync). A thread that
  // cannot be seen is left as it is. A link the person made is not in `auto`, and is never undone here.
  const undone: string[] = []
  if (!known) {
    for (const [pid, a] of Object.entries(auto)) {
      if (unseen.has(a.sid)) continue
      const fate = autoLinkFate(pid, a.sid, feedThreads, pairs, marked)
      if (fate === 'stays') {
        a.miss = 0
        delete a.at
        continue
      }
      if (fate === 'unlisted') {
        if (!feedThreads.length) continue
        if (typeof a.at === 'number' && now - a.at < MISS_GAP_MS) continue
        a.miss = (Number(a.miss) || 0) + 1
        a.at = now
        if (a.miss < AUTO_MISSES) continue
      }
      delete auto[pid]
      delete links[pid]
      undone.push(a.sid)
    }
  }

  // R1: a client with no thread takes the most recently active thread whose sessions declared it and no
  // other client, and that did not open with a marker for another (autoLinkFor).
  for (const it of items) {
    const sid = autoLinkFor(it.projectId, links, feedThreads, pairs, live, unlinked, marked)
    if (!sid) continue
    links[it.projectId] = sid
    auto[it.projectId] = { sid, miss: 0 }
  }

  // The threads that should be pinned now. First every thread the person acted on in the last day, whatever
  // the cap; then the other linked clients, soonest due first, while there is room under MAX_PINS.
  const byHand = (it: QueueItem): boolean => {
    const a = acted[it.projectId]
    return Boolean(a && a.sid === links[it.projectId] && now - a.at < ACTED_MS)
  }
  // ⛔ A pin the person took off stays off (Rob, 2026-10-12: a hand unpin lasted five minutes and he asked why
  // it came back). "We pinned this thread, and it is not pinned now though we did not unpin it" is the
  // person's doing: whenever the bridge unpins a thread itself, it drops or disowns the pin record first.
  // It is remembered with the newest time of each kind of thing the client had then, and the thread is not
  // pinned again until one of them is newer, or the person presses Update or Start for the client or types
  // /mm link there (`pinAgain`), or pins it again themselves. Its name is kept up to date all the while.
  const newestOf = (it: QueueItem): Omit<Unpinned, 'at'> => ({ mail: Number(it.newest?.mail) || 0, pkg: Number(it.newest?.pkg) || 0, task: Number(it.newest?.task) || 0 })
  for (const sid of Object.keys(unpinned)) if (gone.has(sid)) delete unpinned[sid]
  for (const it of items) {
    const sid = links[it.projectId]
    const s = sid ? live.get(sid) : undefined
    if (!sid || !s) continue
    if (s.pinned) {
      delete unpinned[sid] // pinned again, by the person
      continue
    }
    const pin = pins[sid]
    if (pin?.byUs && pin.projectId === it.projectId && !(sid in unpinned)) unpinned[sid] = { at: now, ...newestOf(it) }
  }
  /** Whether the person's unpin of this thread still stands: nothing new for its client since. */
  const staysOff = (sid: string, it: QueueItem): boolean => {
    const u = unpinned[sid]
    if (!u) return false
    const n = newestOf(it)
    if (n.mail <= (Number(u.mail) || 0) && n.pkg <= (Number(u.pkg) || 0) && n.task <= (Number(u.task) || 0)) return true
    delete unpinned[sid]
    return false
  }

  // (A linked thread that cannot be seen takes no place: nothing can be done to it in this sync.)
  const want = new Map<string, QueueItem>()
  // Threads that are named and not pinned: one whose pin the person took off, and the thread of a client
  // in one of the two closed groups. `unpin`: the bridge takes its own pin off it (never the person's).
  const named = new Map<string, { it: QueueItem; unpin: boolean }>()
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !named.has(sid) && staysOff(sid, it)) named.set(sid, { it, unpin: false })
  }
  for (const it of quiet) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !named.has(sid)) named.set(sid, { it, unpin: true })
  }
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && byHand(it) && !want.has(sid) && !named.has(sid)) want.set(sid, it)
  }
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !want.has(sid) && !named.has(sid) && want.size < MAX_PINS) want.set(sid, it)
  }

  let writes = 0
  const rename = async (s: AppThread, title: string): Promise<void> => {
    // The thread's own name is kept from before the first time we rename it, so /mm unlink can give it back.
    // ⛔ Stored BEFORE the app is asked to rename (review of 79cbc596, F2): a pass that fails after the rename
    // still leaves the name to give back. (A name another session stored first for the thread is kept.)
    const sid = s.sessionId
    const own = s.title
    if (titles[sid] === undefined && own && !isOurTitle(own)) {
      await patchStore<Record<string, string>>($, 'mm.titles', {}, fresh => {
        if (fresh[sid] !== undefined) return false
        fresh[sid] = own
      })
      titles[sid] = own
      was.titles[sid] = own
    }
    await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title })
    s.title = title
    writes++
  }
  /**
   * A pin record stored at once, BEFORE the app is asked to rename or pin the thread it is about (F2): a
   * pass that fails after those calls leaves the record, so a later sync takes our pin off and gives the
   * name back. Nothing is written when the store already has this record.
   */
  const recordPin = async (sid: string, record: Pin): Promise<void> => {
    if (sameValue(pins[sid], record)) return
    await patchStore<Record<string, Pin>>($, 'mm.pins', {}, fresh => {
      fresh[sid] = record
    })
    pins[sid] = record
    was.pins[sid] = copyOf(record)
  }

  // A thread its client has left for a new one started from the bridge's chip (linkFromMarker put it on
  // this list). It is given back like an undone link. One that cannot be seen now waits for a later sync;
  // one that is linked again since is a client's thread, not one to give back.
  const waiting: string[] = []
  const dropped = new Set<string>()
  for (const sid of released) {
    if (ownerOf(sid, links) !== undefined) continue
    dropped.add(sid)
    if (gone.has(sid)) {
      delete titles[sid]
      delete pins[sid]
    } else if (live.has(sid)) undone.push(sid)
    else waiting.push(sid)
  }

  // A link that was undone: its thread is unpinned if we pinned it and gets its own name back. No unlink
  // record: it may link itself again if the feed lists it again. (Skipped where the same pass linked the
  // thread to another client: the loop below renames it for that client.)
  for (const sid of undone) {
    if (want.has(sid) || named.has(sid)) continue
    const s = live.get(sid)
    if (s && pins[sid]?.byUs && s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
      s.pinned = false
      writes++
    }
    const own = titles[sid]
    if (s && own !== undefined && s.title !== own) {
      await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title: own })
      s.title = own
      writes++
    }
    delete titles[sid]
    delete pins[sid]
  }

  for (const [sid, it] of want) {
    const s = live.get(sid)
    if (!s || writes >= MAX_WRITES) continue
    // The record first, as the thread stands (a pin the person put on stays theirs), so a failed rename
    // leaves a record to give the name back by; then, just before we pin it, the record that the pin is
    // ours. (Recorded as ours any earlier, a rename that failed would read later as the person's unpin.)
    const record = (byUs: boolean): Pin => ({ projectId: it.projectId, client: it.client, byUs })
    await recordPin(sid, record(s.pinned ? (pins[sid]?.byUs ?? false) : false))
    const title = titleFor(it, now)
    if (s.title !== title) await rename(s, title)
    if (!s.pinned) {
      await recordPin(sid, record(true))
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: true })
      s.pinned = true
      writes++
    }
  }

  // Named, never pinned: the thread whose pin the person took off, the thread of a client whose drafts a
  // teammate holds (its name says who, where the clock would be), the thread of a client whose only items
  // are older than the window. The bridge takes its OWN pin off the last two, never the person's. The
  // record is kept, as not ours: it is what gives the thread its tick once nothing is left for its client.
  for (const [sid, n] of named) {
    const s = live.get(sid)
    if (!s || writes >= MAX_WRITES) continue
    if (n.unpin && pins[sid]?.byUs && s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
      s.pinned = false
      writes++
    }
    const title = titleFor(n.it, now)
    if (s.title !== title) await rename(s, title)
    pins[sid] = { projectId: n.it.projectId, client: n.it.client, byUs: false }
  }

  // A thread we were tracking that no longer needs the person: unpin it if we pinned it, and say so in its name.
  // ⛔ The record of a thread that cannot be seen is kept: it is what lets a later sync take our pin off.
  for (const [sid, pin] of Object.entries(pins)) {
    if (want.has(sid) || named.has(sid)) continue
    const s = live.get(sid)
    if (!s) {
      if (gone.has(sid)) delete pins[sid]
      continue
    }
    if (writes < MAX_WRITES) {
      if (pin.byUs && s.pinned) {
        await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
        s.pinned = false
        writes++
      }
      if (ownerOf(sid, links) !== pin.projectId) {
        // ⛔ The thread is no longer this client's (the client was moved to another thread, or its link went
        // some other way): its own name back, as an undone link gets it, never the name of a client it no
        // longer has (review of 79cbc596, F4: the thread a client was moved from kept that client's name).
        const own = titles[sid]
        if (own !== undefined && s.title !== own) {
          await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title: own })
          s.title = own
          writes++
        }
        delete titles[sid]
      } else {
        // ⛔ The tick is for a client with nothing left in play for the person: in none of the three lists.
        const still = [...items, ...quiet].find(i => i.projectId === pin.projectId)
        // the name in a pin record may be one an older version stored as the feed wrote it
        const title = still ? titleFor(still, now) : clearedTitle(cleanName(pin.client), now)
        if (s.title !== title) await rename(s, title)
      }
    }
    delete pins[sid]
  }

  // A client that is to get a new thread and has a live chip: its row says where the chip is. A chip shows
  // only in the thread that minted it, so "here" is this thread's word: it goes on this session's rows,
  // not into the recommendation that is stored for every session.
  const chips = await chipsOf($, now)
  const me = await selfId($)
  const chipLine = (it: QueueItem, rec: Recommendation): Recommendation => {
    const chip = rec.state === 'start' ? liveChip(chips, it.projectId) : undefined
    if (!chip) return rec
    if (chip.threadId === me) return { ...rec, reason: 'the chip is ready here' }
    const holder = live.get(chip.threadId)
    return holder ? { ...rec, reason: `a chip is waiting in "${cleanTitle(holder.title)}"` } : rec
  }

  // R2: each client's recommendation. A title that merely looks like the client is offered only when the
  // client has no known thread at all. ⛔ Never a thread linked to another client, and never one whose
  // sessions also declared another project, or that opened with a marker for another client: a thread the
  // B3 rule let go is not offered for Update either (clientThreads, titleSuggestion).
  const recs: Record<string, Recommendation> = {}
  const rowOf = (it: QueueItem): Row => {
    const linked = links[it.projectId]
    const threads = clientThreads(it.projectId, links, feedThreads, pairs, live, marked)
    const elsewhere = (sid: string) => declaredOther(it.projectId, sid, feedThreads, pairs, marked)
    const had = sent[it.projectId]
    // A client whose linked thread cannot be seen keeps the last recommendation's words, and no thread to act on.
    // Otherwise ONE of three: Start (no thread, or the thread is old or long), Update (the thread has not
    // been given what is waiting now), or current (it has: what Update last put there is what would go now).
    const rec =
      linked && unseen.has(linked)
        ? carried(it)
        : recommend(threads, threads.length ? undefined : titleSuggestion(it.client, links, live, elsewhere), now, {
            sent: had,
            // (a package the person holds, in the thread that was given it, is not new for that thread: hasWaiting)
            signature: had && hasWaiting(had.sig, it) ? had.sig : signatureOf(it),
            // by the thread's own context reading when it has a fresh one, else by the feed's row count
            length: sid => threadLength(readings[sid], threadRows(sid, it.projectId, feedThreads, pairs), now),
          })
    recs[it.projectId] = rec
    return rowFor(it, chipLine(it, rec), now)
  }
  const rows = items.map(rowOf)
  const folds = { teammate: lists.teammate.map(rowOf), older: lists.older.map(rowOf) }

  // A thread whose link was dropped in this pass loses its context reading with it. (Written over a fresh
  // copy: each session writes its own reading there, and may have since this pass began.)
  for (const sid of linkedBefore) if (ownerOf(sid, links) === undefined) dropped.add(sid)
  if ([...dropped].some(sid => sid in readings)) {
    await patchStore<Record<string, ContextReading>>($, 'mm.ctx', {}, fresh => {
      for (const sid of dropped) delete fresh[sid]
    })
  }
  await patchStore<string[]>($, 'mm.released', [], fresh => applyListChanges(fresh, was.released, waiting))

  const last: Last = { at: now, member, items, ...also, pinned: want.size, recs, projects }
  // ⛔ What this pass changed, and nothing else: a link, a pin, a name or a record another session wrote
  // while it ran is the store's, and stays. (A map the store does not hold yet is written, empty or not, as
  // a sync always left these five.)
  /** Its changes to a capped map, the oldest entries past the cap trimmed after. */
  const keepNewest = <V,>(fresh: Record<string, V>, before: Record<string, V>, after: Record<string, V>): boolean => {
    const changed = applyChanges(fresh, before, after)
    const had = Object.keys(fresh).length
    return Object.keys(capped(fresh)).length !== had || changed
  }
  // ⛔ In this order (review of 79cbc596, F2), so that a write the engine refuses midway leaves nothing half
  // done: what makes a link the bridge's own (its auto record) and the names to give back are written
  // BEFORE the links, and taken away only AFTER them. A link the bridge made never stands without its auto
  // record, so it can always be let go; one it lets go keeps its record until the link itself is gone.
  await patchStore<Auto>($, 'mm.auto', {}, (fresh, stored) => applyChanges(fresh, was.auto, auto, 'set') || !stored)
  await patchStore<Record<string, string>>($, 'mm.titles', {}, fresh => applyChanges(fresh, was.titles, titles, 'set'))
  await patchStore<Record<string, string>>($, 'mm.links', {}, (fresh, stored) => applyChanges(fresh, was.links, links) || !stored)
  // ⛔ The person's unpins BEFORE the pin records (F7): the pass that sees a pin taken off by hand both
  // records it and turns our pin record into not ours. Written the other way round, a refused second write
  // left neither, and the next sync pinned the thread again.
  await patchStore<Record<string, Unpinned>>($, 'mm.unpinned', {}, (fresh, stored) => keepNewest(fresh, was.unpinned, unpinned) || !stored)
  await patchStore<Record<string, Pin>>($, 'mm.pins', {}, (fresh, stored) => applyChanges(fresh, was.pins, pins) || !stored)
  await patchStore<Auto>($, 'mm.auto', {}, fresh => applyChanges(fresh, was.auto, auto, 'delete'))
  await patchStore<Record<string, string>>($, 'mm.titles', {}, (fresh, stored) => keepNewest(fresh, was.titles, titles) || !stored)
  await $.store.set('mm.last', last)
  await showQueue($, member, items, rows, want.size, now, folds)
  return { last, live, pairs, listed: true, unseen }
}

/** Puts the list in the Needs-you pane and on the status line. `folds` are the two closed groups under it: neither is counted. */
async function showQueue($: EngineInterface, member: string, items: QueueItem[], rows: Row[], pinned: number, now: number, folds: { teammate: Row[]; older: Row[] }): Promise<void> {
  const queue: MmQueue = {
    header: items.length ? `Needs you now (${items.length}${items.length > MAX_PINS ? `, the first ${MAX_PINS} pin` : ''})` : 'Nothing needs you right now.',
    rows,
    note: `Updated ${new Date(now).toISOString().slice(11, 16)} UTC for ${member}. ${PANE_SENTENCE}`,
    ...(folds.teammate.length ? { teammate: folds.teammate } : {}),
    ...(folds.older.length ? { older: folds.older } : {}),
  }
  await $.state.set(QUEUE, queue)
  const { value: notice } = await $.state.get(NOTICE)
  if (notice?.text && now - notice.at > SYNC_MS) await $.state.set(NOTICE, { text: '', at: now })
  $.ui.status(items.length ? `MM: ${items.length} need you · ${pinned} pinned` : 'MM: clear')
}

async function sync($: EngineInterface): Promise<Last> {
  return (await reconcile($, await fetchFeed($))).last
}

async function renderPickup($: EngineInterface, it: QueueItem): Promise<string | null> {
  // The package that is the viewer's to work, or (for the founder) the one that waits for his OK: he reads it, he does not pick it up.
  const packageId = it.packageId ?? (it.kind === 'ok' ? ((it.open ?? null)?.id ?? null) : null)
  if (!packageId || !isUuid(packageId)) return null
  try {
    const r = await $.http.fetch(`${EXT}/reply-package?package_id=${packageId}&format=pickup`, {
      headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER },
    })
    if (r.ok) {
      const j = JSON.parse(r.text) as { markdown?: string }
      if (j.markdown) return j.markdown
    }
  } catch {
    // fall through to the local renderer
  }
  const script = `${await home($)}/.claude/skills/client-reply-prep/scripts/render_pickup.py`
  for (const py of [['python3'], ['python'], ['py', '-3']]) {
    try {
      const out = await $.process.run([...py, script, '--package', packageId], { timeoutMs: 90_000 })
      if (out.exitCode === 0 && out.stdout.trim()) return out.stdout
    } catch {
      // that interpreter is not here; try the next
    }
  }
  return null
}

/** A client's pane: the pickup view (under a line saying the viewer holds it, when they do), or what is waiting. */
async function paneMarkdown($: EngineInterface, it: QueueItem, now: number): Promise<string> {
  const view = await renderPickup($, it)
  return view ? [holdBanner(it), view].filter(Boolean).join('\n\n') : clientMarkdown(it, now)
}

/**
 * The client part of the pane: a client's prepared drafts when there is a package (under a line saying the
 * viewer holds it, when they do), else the messages waiting on our reply, the tasks due and what is true of
 * its reply drafts (paneMarkdown). `own` is the client of the thread the pane is in: its part is headed
 * `This thread: <client>`. One package read (the pickup view), in this thread's own session.
 */
async function showClient($: EngineInterface, it: QueueItem, own: boolean): Promise<void> {
  const text = await paneMarkdown($, it, await $.clock.now())
  await $.state.set(VIEW, { text, heading: own ? `This thread: ${it.client}` : '' } satisfies MmView)
}

/** The client part as the state holds it; a session an older version left its view in held plain text there. */
async function clientPart($: EngineInterface): Promise<MmView> {
  const { value } = (await $.state.get(VIEW)) as { value: MmView | string | undefined }
  if (typeof value === 'string') return { text: value, heading: '' }
  return value && typeof value.text === 'string' ? { text: value.text, heading: typeof value.heading === 'string' ? value.heading : '' } : { text: '', heading: '' }
}

/** The waiting client this thread is linked to, if it is linked to one. */
async function ownClient($: EngineInterface, items: readonly QueueItem[]): Promise<QueueItem | undefined> {
  const me = await selfId($)
  const pid = me ? ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {})) : undefined
  return pid ? items.find(i => i.projectId === pid) : undefined
}

/**
 * The pane, as the person asked for it (/mm, /mm view, the band's buttons): ONE pane with two parts in a
 * thread that is a waiting client's, the client's part on top and the Needs-you list under it; the list
 * alone in any other thread (Rob, 2026-10-12: "Needs you shows up on the bottom half of the panel on the
 * right, and the one for that specific client shows up on the top half").
 * ⛔ Opened only because the person asked. Nothing opens a pane from a timer: the API has no way to make
 *    one available without drawing it, and drawing it opens a closed side panel.
 */
async function openPane($: EngineInterface, items: readonly QueueItem[]): Promise<void> {
  const mine = await ownClient($, items)
  if (mine) await showClient($, mine, true)
  else await $.state.set(VIEW, { text: '', heading: '' })
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
}

/**
 * This thread's client in the pane, with a short note for Claude. `force` is the person asking for it
 * (/mm view, /mm link, the band's Drafts button); without it this is the timer.
 * ⛔ The timer opens no pane. It keeps the client part current, so a pane the person has open shows what
 *    is waiting now, and that is all it does to the pane.
 * ⛔ A thread that linked itself gets the pin and the name only. Nothing is added to its transcript, and
 *    its client part is not read, until the person acts on that link: Update, /mm link, or /mm view here.
 */
async function refreshSelf($: EngineInterface, force: boolean): Promise<string> {
  const me = await selfId($)
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pid = me ? ownerOf(me, links) : undefined
  if (!pid) return 'This thread is not linked to a client. Use /mm link <client>.'
  if ((await storeGet<Auto>($, 'mm.auto', {}))[pid]?.sid === me) {
    if (!force) return ''
    await claim($, pid, me)
  }
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const it = listedIn(last).find(i => i.projectId === pid)
  if (!it) {
    // A client on none of the lists (one /mm link may name): asked for by the person, the pane's client part
    // is emptied, so it does not go on showing the client this thread was before.
    if (force) await $.state.set(VIEW, { text: '', heading: '' })
    return 'Nothing needs you on this client right now.'
  }
  const o = it.open ?? null
  const sig = o
    ? `open:${o.id}:${o.state}:${it.coversThrough ?? ''}:${o.unsent}:${o.newer}:${it.messages}:${it.tasks}`
    : it.packageId ? `pkg:${it.packageId}:${it.coversThrough}` : `q:${it.messages}:${it.tasks}:${it.dueAt}`
  const noted = await storeGet<Record<string, string>>($, 'mm.noted', {})
  if (!force && noted[me] === sig) return 'Up to date.'
  const now = await $.clock.now()
  await showClient($, it, true)
  if (force) await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  if (noted[me] !== sig) {
    const body = noteText(it, last?.member ?? '')
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `[Massmarket bridge, no reply needed] ${it.projectName}: ${titleFor(it, now)}. ${body} Nothing has been sent.` }] },
    })
    await patchStore<Record<string, string>>($, 'mm.noted', {}, fresh => {
      fresh[me] = sig
    })
  }
  return `Showing ${it.client} in the side pane.`
}

/**
 * The one line above the prompt, in every desktop thread (Rob, 2026-10-12: "How do we open this panel up
 * in other threads where it's not already open?"): how many clients need the person and, in a thread that
 * is a waiting client's, which client and what is due. '' draws nothing: no client waiting, the bridge
 * paused, a terminal session, or no tracker token on this computer.
 * ⛔ From what is stored only: the last sync, the links, and this thread's id as the timer already learnt
 *    it. No feed call, no app call, no sync.
 */
async function bandLine($: EngineInterface): Promise<MmBand> {
  const nothing: MmBand = { text: '' }
  if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return nothing
  if (await $.store.get('mm.paused')) return nothing
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const items = Array.isArray(last?.items) ? last.items : []
  if (!items.length) return nothing
  try {
    await token($)
  } catch {
    return nothing
  }
  // The clients with no thread at all are counted out: they are the ones nothing reminds the person of yet.
  const fresh = items.filter(i => {
    const rec = last?.recs?.[i.projectId] as (Partial<Recommendation> & { action?: unknown }) | undefined
    // (a sync by an older version did not say: there, Start with no thread to act on is no thread)
    return rec?.state !== undefined ? rec.fresh === true : rec?.action === 'start' && !rec.target
  }).length
  const needs = `Needs you: ${items.length} client${items.length === 1 ? '' : 's'}${fresh ? ` · ${fresh} with no thread yet` : ''}`
  const me = await knownSelf($)
  const mine = me ? ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {})) : undefined
  const it = mine ? items.find(i => i.projectId === mine) : undefined
  // In a waiting client's thread the line names it, and carries the button that opens its part of the pane.
  return it ? { text: `${needs} · this thread: ${cleanName(it.client)} · ${dueLine(it, await $.clock.now())}`, drafts: true } : { text: needs }
}

/** Works the band's line out again and redraws it when it changed. */
async function refreshBand($: EngineInterface): Promise<void> {
  try {
    const band = await bandLine($)
    const { value: was } = await $.state.get(BAND)
    if ((was?.text ?? '') !== band.text || Boolean(was?.drafts) !== Boolean(band.drafts)) await $.state.set(BAND, band)
  } catch {
    // the band is a convenience: it never breaks a sync or a command
  }
}

async function beat($: EngineInterface, extra: Record<string, unknown>): Promise<void> {
  try {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    // how many pairs the app's records have given: a count, nothing from them
    const appPairs = Object.values(await storeGet<Records>($, 'mm.records', {})).filter(r => r && r.cli).length
    await $.fs.write(
      `${await home($)}/.claude/mm-hooks/bridge-state.json`,
      JSON.stringify({ version: VERSION, at: new Date(await $.clock.now()).toISOString(), session: await instanceId($), lastSync: last ? new Date(last.at).toISOString() : null, member: last?.member, need: last?.items.length ?? 0, pinned: last?.pinned ?? 0, appPairs, error: last?.error ?? null, ...extra }, null, 1),
    )
  } catch {
    // a heartbeat must never break the bridge
  }
}

async function tick($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
    await recordSelf($)
    if (await $.store.get('mm.paused')) {
      await refreshBand($) // paused: the band goes with the pins
      return
    }
    // this session's own context reading, at most once in five minutes
    await recordContext($)
    const now = await $.clock.now()
    const id = await instanceId($)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    if (!lease || lease.until < now || lease.owner === id) {
      await $.store.set('mm.lease', { owner: id, until: now + LEASE_MS })
      const last = await storeGet<Last | null>($, 'mm.last', null)
      // Due every SYNC_MS, and at once when a thread asked since the last one (a reply draft was sent or
      // discarded there: `askSync`).
      const asked = Number(await storeGet<number>($, 'mm.ask', 0)) || 0
      if (!last || now - last.at >= SYNC_MS || asked > last.at) await sync($)
    }
    await refreshSelf($, false)
    // the chips this session minted that are no longer wanted
    await withdrawChips($).catch(() => {})
    await refreshBand($)
    await beat($, { ok: true })
  } catch (err) {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    if (last) await $.store.set('mm.last', { ...last, error: short(String(err), 300) })
    $.ui.status(`MM: error, /mm status`)
    await refreshBand($)
    await beat($, { ok: false, tickError: short(String(err), 300) })
  }
}

/**
 * A reply draft was just sent or discarded in this thread (the gateway call finished): the list is brought
 * up to date now, not at the next five-minute sync (Rob, 2026-10-12).
 *
 * Two things, both through what is already there:
 *   - the request is left in the store (`mm.ask`, a time), which the thread that polls reads on its tick:
 *     it syncs at once when a request is newer than its last sync. That is the whole of it for a terminal
 *     session, which has no thread list to pin or name with;
 *   - in the desktop app, ONE sync runs in this thread, ASK_WAIT_MS after the last such call: a person
 *     sending three drafts in a row gets one sync, after the third. It is the sync /mm runs from any
 *     thread. It does not take the poller's lease, and it is skipped when a sync newer than the request
 *     is already on record (the poller got there first), and while the bridge is paused.
 * ⛔ Sends nothing, starts nothing, and knows nothing of the call but that it was made.
 */
async function askSync($: EngineInterface): Promise<void> {
  await $.store.set('mm.ask', await $.clock.now())
  askTimer?.cancel()
  askTimer = $.clock.after(ASK_WAIT_MS, () => {
    askTimer = null
    void syncAsked($)
  })
}

async function syncAsked($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
    if (await $.store.get('mm.paused')) return
    const asked = Number(await storeGet<number>($, 'mm.ask', 0)) || 0
    const last = await storeGet<Last | null>($, 'mm.last', null)
    if (last && last.at >= asked) return
    await sync($)
    await refreshSelf($, false)
    await refreshBand($)
  } catch {
    // the next tick's sync is the fallback: the request is still in the store
  }
}

/**
 * The clients a typed name could mean. One whose short name or full name it is exactly, if there is one;
 * otherwise every client whose name contains it. More than one is a question for the person, never a guess.
 */
function clientsNamed<T extends KnownClient>(name: string, items: readonly T[]): T[] {
  const q = cleanName(name).toLowerCase()
  if (!q) return []
  const exact = items.filter(i => nameMatch(q, i) === 'exact')
  return exact.length ? exact : items.filter(i => nameMatch(q, i) === 'contains')
}

/** How a typed name (cleaned, lower case) meets a client's: its short name or full name `exact`ly, or one of them `contains` it. */
function nameMatch(q: string, i: KnownClient): 'exact' | 'contains' | undefined {
  const short = i.client.replace(/…$/, '').toLowerCase()
  const full = i.projectName.toLowerCase()
  if (short === q || full === q) return 'exact'
  return short.includes(q) || full.includes(q) ? 'contains' : undefined
}

// What the person typed is echoed cleaned, like any other text that did not come from this file.
const noClient = (name: string) => `No client matching "${cleanName(name)}" needs you right now. /mm shows who does.`
/** /mm link's answer when nothing anywhere in the feed is that client: not a name, not an id. */
const noFeedClient = (name: string) => `No client named "${cleanName(name)}" is in your feed. /mm link takes a client's name or project id.`

/** A project id as the person may type it: the whole uuid, or its first 8 characters (`client 1a08666a` too, as a sentence names one). */
const ID_TYPED = /^(?:client\s+)?([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)$/

/**
 * The clients `/mm link <x>` could mean (Rob, 2026-10-13: a client with nothing waiting could not be
 * linked), among every client the pane's three lists hold and every client the feed names (its mail,
 * reply packages and tickets), together. The first of these that finds any:
 *   1. the clients whose short name or full name it is exactly
 *   2. the clients whose name contains it
 *   3. a project id: the whole uuid, or its first 8 characters when only one project the feed carries
 *      starts with them (the feed's `threads` included, which carry an id and no name)
 * ⛔ Never a guess (review of 79cbc596, F3: "Acme" linked "Acme Legal Group" on the list though the feed
 * named a client "Acme"). More than one at a stage is a question for the person; so is an exact name off
 * the lists beside a client on them whose name contains it: both come back, and the caller asks.
 * A client known only by its id comes back with no name: the caller names it (`nameOfId`).
 */
function linkable(arg: string, listed: readonly QueueItem[], feed: Feed): KnownClient[] {
  const named = feedClients(feed)
  /** Every client either knows, each once: the lists' own item for a client on them. */
  const pool: KnownClient[] = [...listed, ...named.filter(n => !listed.some(l => l.projectId === n.projectId))]
  const q = cleanName(arg).toLowerCase()
  if (q) {
    const exact = pool.filter(i => nameMatch(q, i) === 'exact')
    if (exact.length) {
      const onLists = exact.some(e => listed.some(l => l.projectId === e.projectId))
      return onLists ? exact : [...exact, ...listed.filter(i => nameMatch(q, i) === 'contains')]
    }
    const contains = pool.filter(i => nameMatch(q, i) === 'contains')
    if (contains.length) return contains
  }
  const typed = ID_TYPED.exec(arg.trim().toLowerCase())?.[1]
  if (!typed) return []
  const ids = feedProjects(feed).filter(id => (typed.length === 8 ? id.startsWith(typed) : id === typed))
  // (one known only by its id is told apart from another by the whole id, should a sentence list both)
  return ids.map(id => listed.find(i => i.projectId === id) ?? named.find(n => n.projectId === id) ?? { projectId: id, projectName: id, client: '' })
}

/**
 * The name of a client the feed knows only by its id, for a sentence: from what `ownerName` reads (a pin
 * record of the bridge's for that client, else the name the bridge gave the thread linked to it), failing
 * those `client <first 8 characters of the id>`. Its thread's name is asked of the app only when it is linked.
 */
async function nameOfId($: EngineInterface, projectId: string): Promise<string> {
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
  const pin = Object.values(pins).find(p => p?.projectId === projectId)
  const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[projectId]
  const thread = linked && THREAD_ID.test(linked) ? await desktopOnly(async () => asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: linked })), null) : null
  return ownerName(projectId, [], pin, thread?.title) || `client ${projectId.slice(0, 8)}`
}

function severalClients(name: string, found: readonly KnownClient[]): string {
  const short = found.map(i => i.client)
  // two clients with the same short name are told apart by their full names
  const names = new Set(short).size === short.length ? short : found.map(i => i.projectName)
  return `More than one client matches "${cleanName(name)}": ${names.join(', ')}. Type more of the name.`
}

/**
 * The name of the client a thread is linked to, for a sentence: from the queue, else from the thread's pin
 * record, else from the name the bridge itself gave the thread. '' when none of those has it.
 */
function ownerName(projectId: string, items: readonly QueueItem[], pin: Pin | undefined, title: string | undefined): string {
  const inQueue = items.find(i => i.projectId === projectId)?.client
  if (inQueue) return inQueue
  if (pin?.projectId === projectId && cleanName(pin.client)) return cleanName(pin.client)
  // (in today's shape of that name, or the one before it)
  return title && isOurTitle(title) ? cleanName(clientInTitle(title)) : ''
}

// ---------------------------------------------------------------- what a button or a command does
// ⛔ Everything below this line runs only because the person pressed a button or typed a command.
// ⛔ startThread and updateThread are never reached for Claude: see `runCommand`.

/**
 * Start thread. The app gives a plugin no way to open a new thread with a first message (no start_session
 * tool on this build), so this mints a chip whose prompt is the kickoff, and the person clicks Start on it.
 * `typed` is the person's own /mm start <client>: it always mints. The chip on record for this thread may
 * be one the person dismissed, which the bridge cannot see; the new one supersedes it.
 */
async function startThread($: EngineInterface, it: QueueItem, pass: Pass, typed: boolean): Promise<string> {
  const now = await $.clock.now()
  const me = await selfId($)
  const signature = signatureOf(it)
  // ⛔ One chip per client. The button, with a chip for this client carrying this already in this thread:
  //    nothing is minted.
  const before = await chipsOf($, now)
  const minted = `${it.projectId}\n${me}\n${signature}`
  if (!typed && me && (before.some(c => c.projectId === it.projectId && !c.superseded && c.threadId === me && c.signature === signature) || mintedHere.has(minted))) {
    return `A chip for ${it.client} is already here: click Start on it.`
  }
  // A client that already has a thread: the new one is asked to look at how the old one ended (handoverText).
  const prompt = kickoffText(it, { replaces: await replaced($, it, pass) })
  const r = (await $.mcp.call('ccd_session', 'spawn_task', {
    title: `${it.client}: ${it.kind === 'ok' ? 'needs your OK' : it.open?.state === 'held_by_other' ? `reply drafts are with ${it.open.by}` : it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`,
    tldr: `${it.client} needs you: ${needsLine(it, now)}. Start this to open a thread for that client with the drafts or the messages waiting.`,
    prompt,
  })) as Mcp
  if (r.isError) return `Could not create the chip: ${short(textOf(r))}`
  // The chip shows in this thread only, so the record says which thread: the person is told where it is from
  // any other, and this thread's session withdraws it once it is no longer wanted. Any earlier chip for the
  // client, here or in another thread, is superseded by this one.
  // ⛔ The chip's record FIRST, then the rest, each on its own: a write the engine refuses is noted where the
  // bridge's errors go and written again by the check 1 to 3 seconds later (review of 79cbc596, F2). The chip
  // is there either way; with no record its thread links like one started by hand.
  // ⛔ This session remembers the chip (`mintedHere`) ONLY while its record is not written: once the record is
  // there, it alone says whether the chip is still waiting, and a chip spent, withdrawn or superseded is no
  // longer the reason to refuse a Start (re-review of a446f5ab, M1).
  const answer = textOf(r)
  const taskId = /\btask_id:\s*(task_[A-Za-z0-9]{1,40})/.exec(answer)?.[1] ?? /\b(task_[0-9a-f]{6,40})\b/.exec(answer)?.[1] ?? ''
  const had = (await storeGet<Record<string, string>>($, 'mm.links', {}).catch(() => ({}) as Record<string, string>))[it.projectId]
  const chip: Chip = { projectId: it.projectId, signature, taskId, threadId: me, at: now, prompt, ...(had ? { had } : {}) }
  const record = () =>
    patchChips($, now, chips => {
      for (const c of chips) if (c.projectId === it.projectId) c.superseded = true
      return [...chips, chip]
    })
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `start: ${what}`, err)
    }
  }
  let recorded = false
  await step('the chip record', async () => {
    await record()
    recorded = true
  })
  if (!recorded) mintedHere.add(minted)
  // The person asked for this client: a pin they took off its thread may come back.
  await step('the pin coming back', () => pinAgain($, had))
  // Checked again 1 to 3 seconds later, and written again ONLY when the first write failed: a record that
  // was written and is gone now was spent (a thread started from the chip took the client), withdrawn or
  // superseded, and is never written back. Nor is one whose client has since moved to another thread.
  if (!recorded) {
    settleLater($, me || it.projectId, async () => {
      const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[it.projectId]
      if ((linked !== undefined && linked !== had) || (await chipsOf($, now)).some(c => sameChip(c, chip))) {
        mintedHere.delete(minted)
        return
      }
      await step('the chip record, again', async () => {
        await record()
        mintedHere.delete(minted)
      })
    })
  }
  return `A chip for ${it.client} is ready here: click Start on it.`
}

/** After Start: the list is drawn again, so the client's row says where its chip is. Answers what Start said. */
async function started($: EngineInterface, feed: Feed, pass: Pass, said: string): Promise<string> {
  await reconcile($, feed, pass.pairs).catch(() => {})
  return said
}

/** The chips on record: well-formed ones, minted no longer ago than CHIP_KEEP_MS. */
async function chipsOf($: EngineInterface, now: number): Promise<Chip[]> {
  return validChips(await storeGet<unknown>($, 'mm.chips', []), now)
}

function validChips(stored: unknown, now: number): Chip[] {
  if (!Array.isArray(stored)) return []
  return (stored as Array<Partial<Chip> | null>).filter(
    (c): c is Chip =>
      Boolean(c) && typeof c === 'object' && isUuid(c?.projectId) && typeof c?.signature === 'string' && typeof c?.taskId === 'string' && typeof c?.threadId === 'string' && typeof c?.prompt === 'string' && typeof c?.at === 'number' && now - c.at <= CHIP_KEEP_MS,
  )
}

/** One chip told from another: the thread that minted it, its client, its id and when. */
const sameChip = (a: Chip, b: Chip): boolean => a.threadId === b.threadId && a.projectId === b.projectId && a.taskId === b.taskId && a.at === b.at

/**
 * The chips on record, changed by `change` over a fresh copy (patchStore): the chips another thread minted,
 * spent or withdrew meanwhile stay as that thread left them. What is written is well-formed and recent.
 */
async function patchChips($: EngineInterface, now: number, change: (chips: Chip[]) => Chip[] | false): Promise<void> {
  await patchStore<unknown[]>($, 'mm.chips', [], raw => {
    const next = change(validChips(raw, now))
    if (next === false) return false
    raw.splice(0, raw.length, ...next.slice(-CHIPS_MAX))
  })
}

/** A client's live chip: the newest one on record for it that nothing has superseded. */
const liveChip = (chips: readonly Chip[], projectId: string): Chip | undefined => [...chips].reverse().find(c => c.projectId === projectId && !c.superseded)

/**
 * This session withdraws the chips IT minted that are no longer wanted: one a newer chip superseded, one
 * whose client has since been linked to a thread, one whose client no longer needs the person. A chip can
 * only be withdrawn from the thread that minted it, so no session touches another's.
 * A withdrawal that fails is tried again on later ticks, DISMISS_TRIES times in all, then forgotten.
 * ⛔ From what is stored: no feed call. The one app call is the withdrawal itself.
 */
async function withdrawChips($: EngineInterface): Promise<void> {
  const me = await knownSelf($)
  if (!me) return
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  const mine = chips.filter(c => c.threadId === me)
  if (!mine.length) return
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  // With no sync on record there is no saying who still needs the person: no chip is withdrawn for that.
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const waiting = last && Array.isArray(last.items) ? new Set(listedIn(last).map(i => i.projectId)) : null
  const forget = new Set<Chip>()
  let changed = false
  for (const c of mine) {
    const linked = links[c.projectId]
    const movedOn = linked !== undefined && linked !== c.had
    if (!c.superseded && !movedOn && (!waiting || waiting.has(c.projectId))) continue
    changed = true
    // a chip the app gave no id for cannot be withdrawn: it is only forgotten
    let done = !c.taskId
    if (c.taskId) {
      try {
        const r = (await $.mcp.call('ccd_session', 'dismiss_task', { task_id: c.taskId })) as Mcp
        // an answer that it was already started or dismissed is an answer: only an error is a failure
        done = !r.isError
      } catch {
        done = false
      }
    }
    if (done) forget.add(c)
    else {
      c.tries = (c.tries ?? 0) + 1
      if (c.tries >= DISMISS_TRIES) forget.add(c)
    }
  }
  if (!changed) return
  // over a fresh copy: another thread may have minted or claimed a chip while this one was calling
  await patchChips($, now, fresh =>
    fresh.filter(f => ![...forget].some(c => sameChip(c, f))).map(f => {
      const tried = mine.find(c => sameChip(c, f))
      return tried?.tries ? { ...f, tries: tried.tries } : f
    }),
  )
}

/**
 * The thread a new one for this client takes over from, when the client has one: its app id, and its own
 * title (the one it had before the bridge first renamed it, when that was stored; else the one it has).
 * Not a thread that only looks like the client by its title.
 */
async function replaced($: EngineInterface, it: QueueItem, pass: Pass): Promise<Replaced | undefined> {
  const target = pass.last.recs[it.projectId]?.target
  if (!target || target.suggested || !THREAD_ID.test(target.sid)) return undefined
  const own = (await storeGet<Record<string, string>>($, 'mm.titles', {}))[target.sid]
  return { sid: target.sid, title: typeof own === 'string' && own ? own : (pass.live.get(target.sid)?.title ?? target.title) }
}

/**
 * Opens a thread in the app: true when the system's opener took the link. On false the caller says where
 * the thread is instead.
 *
 * Why a program is started (checked 2026-10-12, claude-code.d.ts 2.1.293): the plugin API has no other
 * way. A `Link` whose href is not `https:` is drawn as plain text on the desktop surface, so the app's
 * `claude://` link is no anchor there; there is no open-URL call anywhere on `$`; and
 * `ccd_window.open_session_in` takes only this thread, or one this thread started. Rob, 2026-10-12, asked
 * for a button that takes him to the thread.
 *
 * ⛔ ONLY FROM THE PERSON: reached from `showThread` (the Open thread button) and from `updateThread`
 *    after its message went (the Update thread button, a typed /mm update). Never from a timer, a sync,
 *    the band, or Claude's tool.
 * ⛔ ONE COMMAND, and nothing else is ever started here: the platform's own opener (`open`, `rundll32
 *    url.dll,FileProtocolHandler`, `xdg-open`) with the link as its last argument, as an argument array.
 *    No shell, and nothing joined into an argument (`openCommand`).
 * ⛔ ONE LINK: the app's own link for that thread, of exactly the shape `claude://claude.ai/epitaxy/<its
 *    id>`, for a thread the app listed and the row showed (`threadLink`). Never a URL from the feed, a
 *    title or a message.
 * A platform that cannot be told, an opener that is not there, one that does not answer in OPEN_WAIT_MS,
 * or one that exits with an error: false.
 */
async function openThread($: EngineInterface, thread: AppThread | undefined): Promise<boolean> {
  const argv = openCommand(thread, platformOf({ OS: await $.env.get('OS'), HOME: await $.env.get('HOME') }))
  if (!argv) return false
  try {
    return (await $.process.run(argv, { timeoutMs: OPEN_WAIT_MS })).exitCode === 0
  } catch {
    return false
  }
}

/**
 * Update thread: the client's thread gets the kickoff as a message, which starts a model turn there, and
 * is then linked, pinned and named. The app refuses to bring a thread forward unless this thread started
 * it (ccd_window.open_session_in), so the answer says which pinned thread to open.
 *
 * `how` says where it came from. A press carries the thread its row showed (`shown`): it acts on that
 * thread or on none. A typed /mm update never acts on a thread that only looks like the client by its
 * title, and cannot pick up this thread itself (the engine refuses a prompt submitted from a command).
 *
 * ⛔ Nothing is written before the message went: no link, no unlink record forgotten, no stamp.
 * ⛔ Never into a thread linked to another client.
 */
async function updateThread($: EngineInterface, feed: Feed, it: QueueItem, pass: Pass, how: { typed: true } | { typed: false; shown: string | undefined }): Promise<Said> {
  // With no thread list there is nothing to act on: a thread remembered from an earlier sync may be gone.
  if (!pass.listed) return NO_THREAD_LIST
  const target = pass.last.recs[it.projectId]?.target
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  // The same for a client whose linked thread the app's list left out and the app did not answer for.
  const linked = links[it.projectId]
  if ((linked && pass.unseen.has(linked)) || (!how.typed && how.shown && pass.unseen.has(how.shown))) return NO_THREAD_LIST
  /** The refusal for a thread that is another client's, or null when it is free or this client's. */
  const anothers = async (sid: string): Promise<string | null> => {
    const owner = ownerOf(sid, links)
    if (owner === undefined || owner === it.projectId) return null
    const other = ownerName(owner, listedIn(pass.last), (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[sid], pass.live.get(sid)?.title)
    // a client whose name this session cannot read anywhere has no name here to give
    return other ? `That thread belongs to ${other}. Use Start thread for ${it.client}.` : THREAD_GONE
  }
  if (how.typed) {
    if (!target) return `No thread for ${it.client} yet: use /mm start ${it.client}.`
    if (target.suggested) return `No linked thread for ${it.client} yet. Press Update thread on its row to use "${cleanTitle(target.title)}", or type /mm start ${it.client}.`
  } else {
    const refused = how.shown ? await anothers(how.shown) : null
    if (refused) return refused
    // the list was drawn again by the pass that ran before this
    if (!how.shown || !target || target.sid !== how.shown) return THREAD_GONE
  }
  const refused = await anothers(target.sid)
  if (refused) return refused
  // The thread already has what is waiting now: nothing is sent twice. (Its row draws no Update button;
  // this is the typed command, or a row drawn before another thread's Update went.)
  // ⛔ Asked of what is stored too, and of what this session sent (F2): a second press never sends the same
  // kickoff into the same thread, whatever became of the writes after the first one went.
  const signature = signatureOf(it)
  const sent = (await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[it.projectId]
  const has = (sent && sent.sid === target.sid && hasWaiting(sent.sig, it)) || sentHere.get(`${it.projectId}\n${target.sid}`) === signature
  if (pass.last.recs[it.projectId]?.state === 'current' || has) {
    return `${it.client}'s thread already has this. Open "${cleanTitle(pass.live.get(target.sid)?.title ?? target.title)}" under Pinned.`
  }
  const here = target.sid === (await selfId($))
  if (here && how.typed) return `You are already in ${it.client}'s thread. Press Update thread on its row in the pane to pick it up here.`

  const failed = (why: string) => `Could not send to ${it.client}'s thread: ${why}`
  const text = kickoffText(it, { update: true })
  try {
    if (here) {
      // The client's thread is this one, and the app's send does not take the sending thread: the kickoff
      // goes in here as the person's own prompt. Only a press reaches this.
      const r = (await $.prompt.submit({ text, asUser: true })) as { drop?: string } | undefined
      if (r?.drop) return failed(short(r.drop))
    } else {
      const r = (await $.mcp.call('ccd_session_mgmt', 'send_message', { session_id: target.sid, message: text })) as Mcp
      if (r.isError) return failed(short(textOf(r)))
    }
  } catch (err) {
    return failed(errorText(err))
  }

  // The message went. Only now: what the thread now has, the unlink record, the link, the claim, the stamp,
  // and the pin and the name.
  // ⛔ What the thread now has FIRST (review of 79cbc596, F2): while that is what would be sent, its row reads
  // Open thread, not Update, and a second press sends nothing. Then each other write on its own: one the
  // engine refuses does not stop the next, is noted where the bridge's errors go, and is written again by the
  // check 1 to 3 seconds later. None of it holds back the answer: the message is in the thread either way.
  const pid = it.projectId
  const sid = target.sid
  const at = await $.clock.now()
  sentHere.set(`${pid}\n${sid}`, signature)
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `update: ${what}`, err)
    }
  }
  const linkIt = () =>
    // over a fresh copy: the pass before the send may be seconds old
    patchStore<Record<string, string>>($, 'mm.links', {}, fresh => {
      fresh[pid] = sid
    })
  await step('what the thread now has', () => putSent($, pid, { sid, sig: signature, at }))
  await step('the unlink record', () => forgetUnlink($, sid))
  await step('the link', linkIt)
  await step('the claim', () => claim($, pid, sid))
  // The person acted on this thread: it is pinned first, and the cap of 8 does not unpin it for a day.
  await step('the stamp', () => stamp($, pid, sid))
  // Checked again once, 1 to 3 seconds later, as a marker's link is: what is missing is written again. A
  // link another thread holds by the person's hand since, or an unlink the person made since, is left.
  settleLater($, sid, async () => {
    if (!(await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[pid]) await step('what the thread now has, again', () => putSent($, pid, { sid, sig: signature, at }))
    const unlinkedAt = (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))[sid]
    if (unlinkedAt !== undefined) {
      if (unlinkedAt > at) return
      await step('the unlink record, again', () => forgetUnlink($, sid))
    }
    const holder = (await storeGet<Record<string, string>>($, 'mm.links', {}))[pid]
    const auto = await storeGet<Auto>($, 'mm.auto', {})
    if (holder !== sid && (holder === undefined || auto[pid]?.sid === holder)) await step('the link, again', linkIt)
    if ((await storeGet<Record<string, string>>($, 'mm.links', {}))[pid] !== sid) return
    if (auto[pid]) await step('the claim, again', () => claim($, pid, sid))
    if ((await storeGet<Acted>($, 'mm.acted', {}))[pid]?.sid !== sid) await step('the stamp, again', () => stamp($, pid, sid))
  })
  let thread = pass.live.get(sid)
  try {
    thread = (await reconcile($, feed, pass.pairs)).live.get(sid) ?? thread
  } catch (err) {
    // the next sync pins and names it
    await noteFailure($, 'update: the sync after it', err)
  }
  if (here) return `Picking up ${it.client} in this thread.`
  // The toast says it went. Update also takes the person there when the app can be told to open the
  // thread; when it cannot, the line the pane keeps says where the thread is.
  const went = `Sent to ${it.client}'s thread.`
  if (await openThread($, thread)) return went
  return { text: `Sent to ${it.client}'s thread: open "${cleanTitle(thread?.title ?? target.title)}" under Pinned.`, toast: went }
}

/**
 * Open thread: the client's thread already has what is waiting. Sends nothing, links nothing. It opens the
 * thread the row showed when the app can be told to; otherwise it says where the thread is.
 */
async function showThread($: EngineInterface, it: QueueItem, pass: Pass, shown: string | undefined): Promise<string> {
  if (!pass.listed) return NO_THREAD_LIST
  const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[it.projectId]
  if ((linked && pass.unseen.has(linked)) || (shown && pass.unseen.has(shown))) return NO_THREAD_LIST
  const target = pass.last.recs[it.projectId]?.target
  // the list was drawn again by the pass that ran before this
  if (!shown || !target || target.suggested || target.sid !== shown) return THREAD_GONE
  const thread = pass.live.get(shown)
  if (await openThread($, thread)) return ''
  return `Open "${cleanTitle(thread?.title ?? target.title)}" under Pinned.`
}

/**
 * Drafts, on a row: that client's part goes to the top of the pane (its five-part pickup view when there
 * is a package, else what is waiting and due) and the pane shows its top. Links, pins and starts nothing.
 */
async function showDrafts($: EngineInterface, it: QueueItem): Promise<string> {
  const mine = await ownClient($, [it])
  await showClient($, it, mine !== undefined)
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  // the row pressed may be far down the list: the part just drawn is at the top
  await Promise.resolve($.ui.scroll({ to: 'start', in: PANE_QUEUE })).catch(() => {})
  return ''
}

/** What a button or a command answers: one sentence, or the line the pane keeps with a shorter toast. */
type Said = string | { text: string; toast: string }

/** A button on a row. `row` is the row as it was drawn: Update and Open act on the thread that row showed. */
async function act($: EngineInterface, verb: Verb, row: Row): Promise<Said> {
  if (verb === 'drafts') {
    const last = (await storeGet<Last | null>($, 'mm.last', null)) ?? (await sync($))
    const it = listedIn(last).find(i => i.projectId === row.projectId)
    return it ? showDrafts($, it) : noClient(row.client)
  }
  const feed = await fetchFeed($)
  const pass = await reconcile($, feed)
  const it = listedIn(pass.last).find(i => i.projectId === row.projectId)
  if (!it) return noClient(row.client)
  if (verb === 'start') return started($, feed, pass, await startThread($, it, pass, false))
  if (verb === 'open') return showThread($, it, pass, row.target)
  return updateThread($, feed, it, pass, { typed: false, shown: row.target })
}

async function say($: EngineInterface, said: Said): Promise<void> {
  const text = typeof said === 'string' ? said : said.text
  const notice: MmNotice = { text, at: await $.clock.now() }
  await $.state.set(NOTICE, notice)
  const toast = typeof said === 'string' ? said : said.toast
  if (toast) $.ui.toast(toast)
}

/**
 * A press on a row's button.
 * ⛔ One at a time per client. While a press on Update, Start or Open is in flight for a client, another
 * for that client does nothing: no call, no message, no toast. The hold ends when the first returns, or
 * after PRESS_HOLD_MS. (Taken and released with no await in between, so two presses cannot both pass.)
 */
async function press($: EngineInterface, verb: Verb, row: Row): Promise<void> {
  const held = verb !== 'drafts'
  if (held && pressing.has(row.projectId)) return
  const mine = ++pressCount
  if (held) {
    pressing.set(row.projectId, mine)
    $.clock.after(PRESS_HOLD_MS, () => {
      if (pressing.get(row.projectId) === mine) pressing.delete(row.projectId)
    })
  }
  let said: Said
  try {
    said = await act($, verb, row)
  } catch (err) {
    said = errorText(err)
  } finally {
    if (held && pressing.get(row.projectId) === mine) pressing.delete(row.projectId)
  }
  try {
    await say($, said)
    await refreshBand($)
  } catch {
    // the thread went away while the press was in flight: there is nobody to tell
  }
}

/** Opens or closes one of the two groups under the list, in this thread's pane. The person's press: nothing is fetched, called or changed. */
async function toggleFold($: EngineInterface, key: Fold): Promise<void> {
  try {
    const { value } = await $.state.get(FOLDS)
    await $.state.set(FOLDS, { ...(value ?? {}), [key]: !value?.[key] } satisfies MmFolds)
  } catch {
    // a group that does not open is not worth an error
  }
}

/** The band's button: the Needs-you list, in this thread, as /mm opens it. Sends nothing. */
async function openList($: EngineInterface): Promise<void> {
  try {
    await runCommand($, '', 'person')
  } catch (err) {
    await say($, errorText(err))
  }
  await refreshBand($)
}

/** The band's second button, in a waiting client's thread: the pane with that client's part on top, as /mm view opens it. Sends nothing. */
async function openDrafts($: EngineInterface): Promise<void> {
  try {
    await runCommand($, 'view', 'person')
  } catch (err) {
    await say($, errorText(err))
  }
  await refreshBand($)
}

/**
 * /mm, and the `mm` tool. `by` is who ran it.
 * ⛔ `update` and `start` are the person's alone. For anyone else (Claude through the tool, a /mm that came
 * from another session, a schedule, a channel or a plugin) they are refused here, first, before anything
 * is fetched, called, stored or stamped.
 */
async function runCommand($: EngineInterface, args: string, by: By): Promise<string> {
  const [verb = 'queue', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ')
  if (by !== 'person' && (verb === 'update' || verb === 'start')) return ONLY_THE_PERSON[verb]
  if (verb === 'pause' || verb === 'resume') {
    await $.store.set('mm.paused', verb === 'pause')
    return verb === 'pause' ? 'Paused on this computer: no pins or renames until /mm resume.' : 'Resumed.'
  }
  if (verb === 'status') {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    // the pins the person took off and that are still off: of threads linked to a client now
    const unpinned = await storeGet<Record<string, Unpinned>>($, 'mm.unpinned', {})
    const off = new Set(Object.values(links).filter(sid => sid in unpinned)).size
    return [
      `member: ${memberText(last?.member) || '?'}`,
      `last sync: ${last ? new Date(last.at).toISOString() : 'never'} · ${last?.items.length ?? 0} need you · ${last?.pinned ?? 0} pinned`,
      `linked threads: ${Object.keys(links).length} · this thread: ${await selfId($)}`,
      `pins you took off: ${off}`,
      `poller: ${lease?.owner === (await instanceId($)) ? 'this thread' : 'another thread'}`,
      `paused: ${Boolean(await $.store.get('mm.paused'))}`,
      `last error: ${last?.error ?? 'none'}`,
    ].join('\n')
  }
  if (verb === 'view') {
    // /mm view shows this thread's client. A name typed after it is only checked: two clients it could mean is a question.
    if (arg) {
      const found = clientsNamed(arg, listedIn(await storeGet<Last | null>($, 'mm.last', null)))
      if (found.length > 1) return severalClients(arg, found)
    }
    // The pane it opens is the one /mm opens, so the list under the client's part is brought up to date too.
    // In a terminal session, or with the feed not answering, the client's part is still shown. (Not while
    // the bridge is paused: /mm view then shows what the last sync stored, as it always has.)
    if (!(await $.store.get('mm.paused'))) await sync($).catch(() => {})
    return refreshSelf($, true)
  }
  if (verb === 'unlink') {
    const me = await selfId($)
    // (each map changed over a fresh copy: this thread's own entries come off, nothing else is touched)
    await patchStore<Record<string, string>>($, 'mm.links', {}, (links, stored) => {
      const had = Object.keys(links).length
      for (const k of Object.keys(links)) if (links[k] === me) delete links[k]
      return Object.keys(links).length !== had || !stored
    })
    if (me && (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[me]?.byUs) await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: me, pinned: false })
    await patchStore<Record<string, Pin>>($, 'mm.pins', {}, (pins, stored) => {
      if (!(me in pins) && stored) return false
      delete pins[me]
    })
    if (me) {
      await claim($, undefined, me)
      // Unlinking is final for linking by itself: this thread is never auto-linked again, to any client.
      const at = await $.clock.now()
      await patchStore<Record<string, number>>($, 'mm.unlinked', {}, unlinked => {
        unlinked[me] = at
        capped(unlinked)
      })
      // And its own name comes back.
      const own = (await storeGet<Record<string, string>>($, 'mm.titles', {}))[me]
      if (own !== undefined) {
        await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: me, title: own })
        await patchStore<Record<string, string>>($, 'mm.titles', {}, titles => {
          if (titles[me] !== own) return false
          delete titles[me]
        })
      }
      // The link is dropped, and the thread's context reading with it.
      await patchStore<Record<string, ContextReading>>($, 'mm.ctx', {}, readings => {
        if (!(me in readings)) return false
        delete readings[me]
      })
      // So is the note that the person took our pin off it: it is no client's thread now.
      await pinAgain($, me)
    }
    return 'This thread is no longer linked to a client.'
  }

  const feed = await fetchFeed($)
  let named: KnownClient | undefined
  if (verb === 'link' || verb === 'start' || verb === 'update') {
    // The name is settled before anything is touched: no client, or more than one, does nothing at all.
    // (any client the pane lists, in the list or in one of the two groups under it; for `link`, any client
    // the feed knows, by name or by id: `linkable`)
    const lists = buildLists(feed, await $.clock.now())
    const queue = [...lists.queue, ...lists.teammate, ...lists.older]
    const found = verb === 'link' ? linkable(arg, queue, feed) : clientsNamed(arg, queue)
    // a client the feed knows only by its id gets its name before any sentence uses it
    for (const [n, f] of found.entries()) if (!f.client) found[n] = { ...f, client: await nameOfId($, f.projectId) }
    if (found.length > 1) return severalClients(arg, found)
    named = found[0]
    if (!named) return verb === 'link' ? noFeedClient(arg) : noClient(arg)
    // ⛔ Only the person moves a client or a thread, and only the person undoes their own unlink. For anyone
    // else (Claude through the tool, a /mm that is not the person's) `link` is refused here, before
    // anything is written, when this thread is one the person unlinked, when it is already another client's,
    // or when the client is already linked to another thread that is still there (review of 79cbc596, F4).
    // A thread that is nobody's may still be linked to a client that has no thread.
    if (verb === 'link' && by !== 'person') {
      const me = await selfId($)
      if (me && me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) {
        return `This thread was unlinked by the person. Only they can link it again: they type /mm link ${named.client} here.`
      }
      const links = await storeGet<Record<string, string>>($, 'mm.links', {})
      const owner = me ? ownerOf(me, links) : undefined
      if (owner !== undefined && owner !== named.projectId) {
        const pin = (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[me]
        const here = await desktopOnly(async () => asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })), null)
        // the client's name wherever it can still be read; failing all of that, the sentence names no one
        const other = ownerName(owner, queue, pin, here?.title) || 'another client'
        return `This thread is ${other}'s. Only the person can move it: they type /mm link ${named.client}.`
      }
      // (a thread the app says is gone, or archived, holds nothing; one it cannot answer for is still there)
      const holder = links[named.projectId]
      if (holder !== undefined && holder !== me && (await lookup($, holder)) !== 'gone') {
        return `${named.client} already has a thread. Only the person can move it: they type /mm link ${named.client} in the thread that should have it.`
      }
    }
  }
  const pass = await reconcile($, feed)
  const { last, pairs } = pass
  if (named) {
    const pid = named.projectId
    const it = listedIn(last).find(i => i.projectId === pid)
    // (a client on none of the three lists is one `link` alone may name)
    if (!it && verb !== 'link') return noClient(arg)
    // The person typed it: /mm start starts a new thread and /mm update updates the existing one, whatever
    // the row recommends (only a thread that already has this is not sent it again). A typed /mm start
    // always mints its chip.
    if (it && verb === 'start') return started($, feed, pass, await startThread($, it, pass, true))
    if (it && verb === 'update') {
      const said = await updateThread($, feed, it, pass, { typed: true })
      return typeof said === 'string' ? said : said.text
    }
    const me = await selfId($)
    if (!me) return 'Linking a thread works in the desktop app\'s Code tab only.'
    await forgetUnlink($, me)
    await patchStore<Record<string, string>>($, 'mm.links', {}, links => {
      // ⛔ a thread is one client's: linked here by hand, it is no longer any other client's
      for (const k of Object.keys(links)) if (links[k] === me && k !== pid) delete links[k]
      links[pid] = me
    })
    await claim($, pid, me)
    // ⛔ Only the person's own link stamps: one Claude or anything else made is not pinned ahead of the cap.
    if (it && by === 'person') await stamp($, pid, me)
    else if (!it) {
      // A client with nothing waiting: linked, and nothing more. No stamp (nothing was acted on, so nothing
      // pins). The bridge's record of this thread, when it has one, is now this client's: the sync takes our
      // pin off and the thread's name says this client is clear, instead of naming the client it was.
      const client = named.client
      await patchStore<Record<string, Pin>>($, 'mm.pins', {}, pins => {
        if (!pins[me]) return false
        pins[me] = { ...pins[me], projectId: pid, client }
      })
    }
    await reconcile($, feed, pairs)
    return `This thread is now ${(it ?? named).client}'s. ${await refreshSelf($, true)}`
  }
  // The pane: this thread's client on top when it is a waiting client's thread, the list under it.
  await openPane($, listedIn(last))
  return last.items.length ? `${last.items.length} client${last.items.length === 1 ? '' : 's'} need you; ${last.pinned} thread${last.pinned === 1 ? '' : 's'} pinned. The list is in the side pane.` : 'Nothing needs you right now.'
}

/**
 * A prompt that begins `[mm-link <project id>]` links this thread to that client: a chip the person
 * started opens its new thread with exactly that.
 * ⛔ Only at the very start of the prompt, only for a project the person's last feed carried, and only
 * when the prompt is the person's own (`composer`, `bridge`, `sdk`). Another Claude session's message, a
 * channel, a scheduled task, a task notification or anything else is ignored, as is a marker anywhere
 * else in the text. (Update's kickoff needs no marker: the press that sent it wrote the link.)
 * ⛔ It never forgets an unlink record and never stamps: a thread the person unlinked stays unlinked, and a
 * thread that is another client's stays theirs.
 * ⛔ A client that already has a thread keeps it, with ONE exception: the thread that opens with exactly
 * the prompt of a chip the bridge minted for that client (Start thread, /mm start) was started from that
 * chip, and it takes the client. The thread the client had is given back on the next sync: its own title,
 * our pin off. No other thread ever takes a client this way.
 * ⛔ Each map is changed over a fresh copy (patchStore), and the link is checked again a moment later
 * (settleLater): a dozen threads started together each keep their own (B1).
 */
async function linkFromMarker($: EngineInterface, text: string, origin: string | undefined): Promise<void> {
  const projectId = MARKER.exec(text)?.[1]
  if (!projectId || !origin || !PERSON_ORIGINS.has(origin)) return
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const inFeed = Array.isArray(last?.projects) ? last.projects : (last?.items ?? []).map(i => i.projectId)
  if (!inFeed.includes(projectId)) return
  const me = await selfId($)
  if (!me) return
  // ⛔ This thread declared this client: the bridge never links it by itself to another one (B3), whatever
  // becomes of the link this prompt makes. Kept whether or not it links (an unlinked thread, another
  // client's thread).
  await patchStore<Record<string, string>>($, 'mm.marked', {}, marked => {
    if (marked[me] === projectId) return false
    delete marked[me]
    marked[me] = projectId
    capped(marked)
  })
  if (me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) return
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  // the chip this thread was started from: the one for this client whose prompt is this prompt, to the letter
  const chip = [...chips].reverse().find(c => c.projectId === projectId && c.prompt.trim() === text.trim())
  // What this thread has: the kickoff it opened with. From the chip, what the chip carried; with no chip
  // on record, only when its prompt is exactly the kickoff that would be sent now.
  const it = listedIn(last).find(i => i.projectId === projectId)
  const sig = chip ? chip.signature : it && kickoffText(it) === text.trim() ? signatureOf(it) : undefined
  /** The thread the client had, when this one takes it by the chip rule. */
  let had: string | undefined
  /** Whether this thread is the client's once the link is written (it may have been already). */
  let ours = false
  const link = () =>
    patchStore<Record<string, string>>($, 'mm.links', {}, links => {
      // decided on the fresh copy: whose this thread is, and who holds the client, NOW
      const owner = ownerOf(me, links)
      if (owner !== undefined && owner !== projectId) return false
      const holder = links[projectId]
      if (holder !== undefined && holder !== me && !chip) return false
      ours = true
      if (holder === me) return false
      had = holder
      links[projectId] = me
    })
  // Checked again 1 to 3 seconds later, once: gone (another session's write met this one, or the engine
  // could not lock the store in time), and the thread is not one the person unlinked since, and no other
  // thread took the client by the chip rule (this one is then on the list of threads given back): written
  // again. A client another thread holds now is left with it, unless the bridge linked that one by itself.
  settleLater($, me, async () => {
    // (only a link this prompt made or found: one it was refused is never written later)
    if (!ours || me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) return
    const released = await storeGet<string[]>($, 'mm.released', [])
    if (Array.isArray(released) && released.includes(me)) return
    const auto = await storeGet<Auto>($, 'mm.auto', {})
    let again = false
    await patchStore<Record<string, string>>($, 'mm.links', {}, links => {
      const holder = links[projectId]
      const owner = ownerOf(me, links)
      if (holder === me || (owner !== undefined && owner !== projectId)) return false
      if (holder !== undefined && auto[projectId]?.sid !== holder) return false
      links[projectId] = me
      again = true
    })
    if (!again) return
    await claim($, projectId, me)
    if (sig !== undefined && !(await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[projectId]) await putSent($, projectId, { sid: me, sig, at: now })
  })
  await link()
  if (!ours) return
  if (had !== undefined) {
    const given = had
    await patchStore<string[]>($, 'mm.released', [], released => {
      if (released.includes(given)) return false
      released.push(given)
      released.splice(0, Math.max(0, released.length - REMEMBER_MAX))
    })
  }
  // the person started this: the link is theirs, not one the bridge made by itself
  await claim($, projectId, me)
  if (sig !== undefined) await putSent($, projectId, { sid: me, sig, at: now })
  if (chip) {
    // The person started it: the chip is spent. Any other chip for the client is superseded, for the
    // thread that minted it to withdraw on its own tick.
    await patchChips($, now, fresh => {
      const rest = fresh.filter(c => !sameChip(c, chip))
      for (const c of rest) if (c.projectId === projectId) c.superseded = true
      return rest
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Runs in a person's session only: the terminal REPL (isInteractive) or the desktop app's Code tab, which
    // reports isInteractive false but CLAUDE_CODE_ENTRYPOINT=claude-desktop. Never in -p runs (Lane-2, daily runs).
    const entry = await $.env.get('CLAUDE_CODE_ENTRYPOINT')
    if (!e.isInteractive && entry !== 'claude-desktop') return started
    if (entry === 'claude-desktop') {
      $.clock.after(4_000, () => void tick($))
      $.clock.every(TICK_MS, () => void tick($))
    }
    try {
      await $.command.register({
        name: 'mm',
        description: 'Massmarket: /mm (what needs you) · /mm link <client> · /mm update <client> · /mm start <client> · /mm view · /mm unlink · /mm status · /mm pause|resume',
      })
      await $.tool.register({
        name: 'mm',
        description:
          'Massmarket bridge, the same as the /mm command. args: "" or "queue" (who needs the person now), "status", "view" (this thread\'s client in the side pane), "link <client>" (make this thread that client\'s: a name or project id of any client in the feed), "unlink", "pause", "resume". Starting or updating a client thread is for the person only: they press the button in the pane or type /mm start <client> or /mm update <client>. Use it only when the person asks; it never sends anything to a client.',
        inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'what follows /mm' } } },
        isDeferred: false,
      })
    } catch (err) {
      await beat($, { registerError: short(String(err), 300) })
    }
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const text = String(e.text ?? '')
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    try {
      await linkFromMarker($, text, origin)
      // An Update just arrived in this thread from another one: this session takes its own context
      // reading (its own, and no more often than its timer would).
      if (origin === 'peer' && text.includes(UPDATE_OPENS_WITH)) await recordContext($)
    } catch {
      // a marker that cannot be acted on never holds a prompt back
    }
    return next(e)
  })

  // ⛔ The person's own /mm only: typed here, or sent from their phone. A /mm that arrived any other way is
  // answered like the tool.
  on('command.run', { command: 'mm' }, async ($, e) => {
    const text = await runCommand($, String(e.args ?? ''), PERSON_ORIGINS.has(String((e.origin as { kind?: string } | undefined)?.kind)) ? 'person' : 'other')
    await refreshBand($)
    return { text }
  })

  // ⛔ Claude calls this. It never starts or updates a thread: `runCommand` refuses both for it.
  on('tool.call', { tool: 'mcp__mm-bridge__mm' }, async ($, e) => {
    const result = await runCommand($, String((e as Record<string, unknown>).args ?? ''), 'other')
    await refreshBand($)
    return { result }
  })

  // A reply draft was sent or discarded from this thread: the list is brought up to date now (askSync).
  // ⛔ The command runs first, exactly as it would have, and its answer is handed back untouched.
  // ⛔ All that is looked at: whether the call was refused or failed, and whether the command names one of
  //    the three reply-draft routes (isDraftDone). Nothing of the command or of its output is read
  //    further, kept, logged or sent anywhere.
  // ⛔ It never refuses a command and never holds one back: anything going wrong here is swallowed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const finished = !answer.deny && !answer.isError
      if (finished && isDraftDone((e as { command?: unknown }).command)) await askSync($)
    } catch {
      // the next five-minute sync shows it
    }
    return answer
  })

  // The band: one line above the prompt in every desktop thread, with the button that opens the list.
  // ⛔ It draws what `refreshBand` last worked out from the store. No feed call and no app call from here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: band } = await $.state.get(BAND)
    // nothing to say, or a survey holds the band: the engine's own
    if (e.props.hasSurvey || !band?.text) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e) as Partial<ReturnType<typeof $.ui.resolve>> & Pick<ReturnType<typeof $.ui.resolve>, 'Box' | 'Text'>
    // a surface that draws no button there says how to open the list instead
    if (!Button) return <Text>{bandWords(band.text, false)}</Text>
    return (
      <Box flexDirection="row" gap={1}>
        <Text>{bandWords(band.text, true)}</Text>
        <Button key="mm-open-list" label="Open list" onPress={() => void openList($)} />
        {band.drafts ? <Button key="mm-open-drafts" label="Drafts" onPress={() => void openDrafts($)} /> : null}
      </Box>
    )
  })

  // The pane an older version opened for a client's drafts: a thread that still has it open sees the
  // client part there. Nothing opens it any more: the client part is the top of the one pane below.
  on('ui.render', { component: 'Pane', requestId: PANE_VIEW }, async ($, e) => {
    const { Markdown, Text } = $.ui.resolve(e)
    const { text } = await clientPart($)
    return text ? <Markdown text={text} /> : <Text dimColor>Nothing to show yet.</Text>
  })

  // The one pane. In a waiting client's thread: that client's part on top (`This thread: <client>`), then
  // the Needs-you list. In any other thread: the list. The API has no split inside a pane (a Box clips or
  // it does not: no part of a pane scrolls by itself), so it is one scrolling pane, the client part first
  // and the list after it in full.
  // The list: the clients with no thread yet first, marked, then the ones in a thread; ONE action a row.
  // Under it, two groups that are closed until the person opens one (each heading is its own button):
  // `With a teammate (n)`, then `Older (n)`. Nobody in them is pinned or counted in the header.
  on('ui.render', { component: 'Pane', requestId: PANE_QUEUE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const { value: queue } = await $.state.get(QUEUE)
    const { value: notice } = await $.state.get(NOTICE)
    const { value: folds } = await $.state.get(FOLDS)
    const client = await clientPart($)
    // Nothing synced yet, or a value an older version of this plugin left in this session.
    const hasList = Boolean(queue && Array.isArray(queue.rows))
    if (!hasList && !client.text) return <Text dimColor>Checking…</Text>
    const drawRow = (row: Row, lead: string) => (
      <Box flexDirection="column" marginTop={1}>
        <Text>{`${lead} ${row.title}`}</Text>
        <Text dimColor>{rowDetail(row)}</Text>
        {row.note ? <Text dimColor>{row.note}</Text> : null}
        <Box flexDirection="row" gap={1}>
          {rowButtons(row).map(verb =>
            verb === 'drafts' ? (
              <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} onPress={() => void press($, verb, row)} />
            ) : (
              <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} variant="primary" onPress={() => void press($, verb, row)} />
            ),
          )}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {client.text ? (
          <Box key="mm-client" flexDirection="column" marginBottom={1}>
            {client.heading ? <Text bold>{client.heading}</Text> : null}
            <Markdown text={client.text} />
          </Box>
        ) : null}
        {hasList && queue ? <Text bold>{queue.header}</Text> : <Text dimColor>Checking…</Text>}
        {notice?.text ? <Text>{notice.text}</Text> : null}
        {hasList && queue
          ? rowGroups(queue.rows).map(group => (
              <Box flexDirection="column" marginTop={1}>
                <Text bold dimColor>
                  {group.heading}
                </Text>
                {group.rows.map(({ row, n, mark }) => drawRow(row, `${mark}${n}.`))}
              </Box>
            ))
          : null}
        {hasList && queue
          ? foldGroups(queue).map(group => (
              <Box flexDirection="column" marginTop={1}>
                <Button key={`mm-fold:${group.key}`} label={group.heading} onPress={() => void toggleFold($, group.key)} />
                {folds?.[group.key] ? group.rows.map(({ row, n }) => drawRow(row, `${n}.`)) : null}
              </Box>
            ))
          : null}
        {hasList && queue ? (
          <Box marginTop={1}>
            <Text dimColor>{queue.note}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
