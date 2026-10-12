import type { EngineInterface, Register } from 'claude-code'

import type { MmBand, MmNotice, MmQueue, MmView } from '../types'

import { MAX_PINS, buildQueue, cleanName, cleanTitle, clearedTitle, clientInTitle, clientMarkdown, dueLine, isUuid, needsLine, titleFor } from './queue'
import type { Feed, FeedThread, QueueItem } from './queue'
import { LABEL, PANE_SENTENCE, THREAD_ID, autoLinkFor, bandWords, clientThreads, kickoffText, ownerOf, recommend, rowButtons, rowDetail, rowFor, rowGroups, sharedThreads, signatureOf, threadLength, threadLink, threadRows, titleSuggestion } from './threads'
import type { AppThread, ContextReading, Pairs, Recommendation, Replaced, Row, RowButton, RowState, Sent } from './threads'

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

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.4.0'
const CLIENT_HEADER = { 'X-MM-Client': `mm-bridge/${VERSION}` }
const VIEW = { plugin: 'mm-bridge', key: 'view' } as const
const QUEUE = { plugin: 'mm-bridge', key: 'queue' } as const
const NOTICE = { plugin: 'mm-bridge', key: 'notice' } as const
const BAND = { plugin: 'mm-bridge', key: 'band' } as const
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
  items: QueueItem[]
  pinned: number
  recs: Record<string, Recommendation>
  /** Every project id the last feed carried: the only ids an [mm-link] marker may name. */
  projects?: string[]
  error?: string
}
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

let selfCache: string | null = null
let instanceCache: string | null = null
/** When this session last asked the app for its own context reading (0: never). */
let contextAskedAt = 0
/**
 * The presses in flight in this session, by client: when each began. A second press for a client whose
 * first has not returned does nothing (Rob pressed Update, saw nothing happen, pressed again, and the
 * thread got two messages).
 */
const pressing = new Map<string, number>()
let pressCount = 0

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
  if (!selfCache) {
    const me = await desktopOnly(async () => (await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as AppThread, null)
    if (!me?.sessionId) return ''
    selfCache = me.sessionId
  }
  return selfCache
}

async function instanceId($: EngineInterface): Promise<string> {
  if (!instanceCache) instanceCache = String(await $.session.id())
  return instanceCache
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
  const r = await $.http.fetch(`${EXT}/closeout?mail_hours=96`, { headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER } })
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
 * The app's list of threads does not say which Claude Code session runs in each, and the feed names a
 * thread by that session id (it is what the worklog hook sends). So every session writes down its own
 * pair, and the session that syncs reads them all: a thread opened since this version was installed can
 * be matched to the client its session declared.
 */
async function recordSelf($: EngineInterface): Promise<void> {
  const app = await selfId($)
  const cli = String((await $.session.id()) ?? '')
  if (!app || !cli) return
  const now = await $.clock.now()
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  const mine = pairs[cli]
  if (mine && mine.app === app && now - mine.at < DAY_MS) return
  pairs[cli] = { app, at: now }
  for (const [k, v] of Object.entries(pairs)) if (now - v.at > PAIR_KEEP_MS) delete pairs[k]
  await $.store.set('mm.threads', pairs)
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
  const me = selfCache
  if (!me) return
  contextAskedAt = now
  try {
    const answer = (await mcpJson($, 'ccd_session_mgmt', 'get_usage', { session_id: 'self' })) as { context?: Partial<ContextReading> & { status?: unknown } } | null
    const c = answer && typeof answer === 'object' ? answer.context : undefined
    if (!c || c.status !== 'ok') return
    const numbers = [c.tokensUsed, c.contextWindow, c.percentUsed]
    if (!numbers.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return
    const all = await storeGet<Record<string, ContextReading>>($, 'mm.ctx', {})
    // written last, so the cap keeps the readings most recently taken
    delete all[me]
    all[me] = { tokensUsed: c.tokensUsed as number, contextWindow: c.contextWindow as number, percentUsed: c.percentUsed as number, at: now }
    await $.store.set('mm.ctx', capped(all))
  } catch {
    // no reading this time: the row count decides until there is one
  }
}

/** A thread linked by the person (a command, a button, a chip's first message) may link itself again later. */
async function forgetUnlink($: EngineInterface, sid: string): Promise<void> {
  const unlinked = await storeGet<Record<string, number>>($, 'mm.unlinked', {})
  if (!(sid in unlinked)) return
  delete unlinked[sid]
  await $.store.set('mm.unlinked', unlinked)
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
      delete seen[app]
      seen[app] = cli ? { m: file.mtimeMs, cli } : { m: file.mtimeMs }
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
  if (opened) await $.store.set('mm.records', capped(seen))
  if (Object.keys(found).length) {
    Object.assign(pairs, found)
    // written over a fresh copy: another session may have recorded itself since this pass began
    await $.store.set('mm.threads', { ...(await storeGet<Pairs>($, 'mm.threads', {})), ...found })
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

/** The person made or used this link (Update, /mm link): its thread stays pinned for a day. */
async function stamp($: EngineInterface, projectId: string, sid: string): Promise<void> {
  const now = await $.clock.now()
  const acted = await storeGet<Acted>($, 'mm.acted', {})
  for (const [pid, a] of Object.entries(acted)) if (now - a.at >= ACTED_MS) delete acted[pid]
  acted[projectId] = { sid, at: now }
  await $.store.set('mm.acted', acted)
}

/**
 * The link is the person's from here on (Update, /mm link, /mm view, a chip they started), no longer one
 * the bridge made by itself: its thread may show the drafts pane, and the link is not undone by a sync.
 */
async function claim($: EngineInterface, projectId: string | undefined, sid: string): Promise<void> {
  const auto = await storeGet<Auto>($, 'mm.auto', {})
  let changed = false
  for (const [pid, a] of Object.entries(auto)) {
    if (pid !== projectId && a?.sid !== sid) continue
    delete auto[pid]
    changed = true
  }
  if (changed) await $.store.set('mm.auto', auto)
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
  const items = buildQueue(feed, now)
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
    for (const it of items) recs[it.projectId] = carried(it)
    const last: Last = { at: now, member, items, pinned: before?.pinned ?? 0, recs, projects }
    await $.store.set('mm.last', last)
    await showQueue($, member, items, items.map(it => rowFor(it, recs[it.projectId] as Recommendation, now)), last.pinned, now)
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
  // ⛔ And it is undone when it stops being true: its thread's session missing from the feed's threads for
  // that client, or the thread now reached by sessions of more than one client, AUTO_MISSES syncs in a row.
  // Counted once per feed, and only when the feed's list has entries: a feed with no `threads`, or an
  // empty one, says nothing either way and changes no count. A miss counts only when the one before it is
  // MISS_GAP_MS old: three /mm in a row are one sync. A thread that cannot be seen is left as it is.
  const undone: string[] = []
  if (!known && feedThreads.length) {
    const shared = sharedThreads(feedThreads, pairs)
    for (const [pid, a] of Object.entries(auto)) {
      if (unseen.has(a.sid)) continue
      if (!shared.has(a.sid) && feedThreads.some(t => t.project_id === pid && pairs[t.session_id]?.app === a.sid)) {
        a.miss = 0
        delete a.at
        continue
      }
      if (typeof a.at === 'number' && now - a.at < MISS_GAP_MS) continue
      a.miss = (Number(a.miss) || 0) + 1
      a.at = now
      if (a.miss < AUTO_MISSES) continue
      delete auto[pid]
      delete links[pid]
      undone.push(a.sid)
    }
  }

  // R1: a client with no thread takes the most recently active thread whose session declared it, unless
  // that thread ran sessions for more than one client (autoLinkFor).
  for (const it of items) {
    const sid = autoLinkFor(it.projectId, links, feedThreads, pairs, live, unlinked)
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
  // (A linked thread that cannot be seen takes no place: nothing can be done to it in this sync.)
  const want = new Map<string, QueueItem>()
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && byHand(it) && !want.has(sid)) want.set(sid, it)
  }
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !want.has(sid) && want.size < MAX_PINS) want.set(sid, it)
  }

  let writes = 0
  const rename = async (s: AppThread, title: string): Promise<void> => {
    // The thread's own name is kept from before the first time we rename it, so /mm unlink can give it back.
    if (titles[s.sessionId] === undefined && s.title && !isOurTitle(s.title)) titles[s.sessionId] = s.title
    await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: s.sessionId, title })
    s.title = title
    writes++
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
    if (want.has(sid)) continue
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
    const title = titleFor(it, now)
    if (s.title !== title) await rename(s, title)
    const already = pins[sid]
    if (!s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: true })
      s.pinned = true
      writes++
      pins[sid] = { projectId: it.projectId, client: it.client, byUs: true }
    } else {
      pins[sid] = { projectId: it.projectId, client: it.client, byUs: already?.byUs ?? false }
    }
  }

  // A thread we were tracking that no longer needs the person: unpin it if we pinned it, and say so in its name.
  // ⛔ The record of a thread that cannot be seen is kept: it is what lets a later sync take our pin off.
  for (const [sid, pin] of Object.entries(pins)) {
    if (want.has(sid)) continue
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
      const still = items.find(i => i.projectId === pin.projectId)
      // the name in a pin record may be one an older version stored as the feed wrote it
      const title = still ? titleFor(still, now) : clearedTitle(cleanName(pin.client), now)
      if (s.title !== title) await rename(s, title)
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
  // client has no known thread at all. ⛔ Never a thread linked to another client (clientThreads, titleSuggestion).
  const recs: Record<string, Recommendation> = {}
  const rows: Row[] = []
  for (const it of items) {
    const linked = links[it.projectId]
    const threads = clientThreads(it.projectId, links, feedThreads, pairs, live)
    // A client whose linked thread cannot be seen keeps the last recommendation's words, and no thread to act on.
    // Otherwise ONE of three: Start (no thread, or the thread is old or long), Update (the thread has not
    // been given what is waiting now), or current (it has: what Update last put there is what would go now).
    const rec =
      linked && unseen.has(linked)
        ? carried(it)
        : recommend(threads, threads.length ? undefined : titleSuggestion(it.client, links, live), now, {
            sent: sent[it.projectId],
            signature: signatureOf(it),
            // by the thread's own context reading when it has a fresh one, else by the feed's row count
            length: sid => threadLength(readings[sid], threadRows(sid, it.projectId, feedThreads, pairs), now),
          })
    recs[it.projectId] = rec
    rows.push(rowFor(it, chipLine(it, rec), now))
  }

  // A thread whose link was dropped in this pass loses its context reading with it. (Written over a fresh
  // copy: each session writes its own reading there, and may have since this pass began.)
  for (const sid of linkedBefore) if (ownerOf(sid, links) === undefined) dropped.add(sid)
  if ([...dropped].some(sid => sid in readings)) {
    const fresh = await storeGet<Record<string, ContextReading>>($, 'mm.ctx', {})
    for (const sid of dropped) delete fresh[sid]
    await $.store.set('mm.ctx', fresh)
  }
  if (released.length || waiting.length) await $.store.set('mm.released', waiting)

  const last: Last = { at: now, member, items, pinned: want.size, recs, projects }
  await $.store.set('mm.links', links)
  await $.store.set('mm.pins', pins)
  await $.store.set('mm.titles', capped(titles))
  await $.store.set('mm.auto', auto)
  await $.store.set('mm.last', last)
  await showQueue($, member, items, rows, want.size, now)
  return { last, live, pairs, listed: true, unseen }
}

/** Puts the list in the Needs-you pane and on the status line. */
async function showQueue($: EngineInterface, member: string, items: QueueItem[], rows: Row[], pinned: number, now: number): Promise<void> {
  const queue: MmQueue = {
    header: items.length ? `Needs you now (${items.length}${items.length > MAX_PINS ? `, the first ${MAX_PINS} pin` : ''})` : 'Nothing needs you right now.',
    rows,
    note: `Updated ${new Date(now).toISOString().slice(11, 16)} UTC for ${member}. ${PANE_SENTENCE}`,
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
  if (!it.packageId) return null
  try {
    const r = await $.http.fetch(`${EXT}/reply-package?package_id=${it.packageId}&format=pickup`, {
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
      const out = await $.process.run([...py, script, '--package', it.packageId], { timeoutMs: 90_000 })
      if (out.exitCode === 0 && out.stdout.trim()) return out.stdout
    } catch {
      // that interpreter is not here; try the next
    }
  }
  return null
}

/**
 * The client part of the pane: a client's prepared drafts when there is a package, else the messages
 * waiting on our reply and the tasks due. `own` is the client of the thread the pane is in: its part is
 * headed `This thread: <client>`. One package read (the pickup view), in this thread's own session.
 */
async function showClient($: EngineInterface, it: QueueItem, own: boolean): Promise<void> {
  const text = (await renderPickup($, it)) ?? clientMarkdown(it, await $.clock.now())
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
  const it = last?.items.find(i => i.projectId === pid)
  if (!it) return 'Nothing needs you on this client right now.'
  const sig = it.packageId ? `pkg:${it.packageId}:${it.coversThrough}` : `q:${it.messages}:${it.tasks}:${it.dueAt}`
  const noted = await storeGet<Record<string, string>>($, 'mm.noted', {})
  if (!force && noted[me] === sig) return 'Up to date.'
  const now = await $.clock.now()
  await showClient($, it, true)
  if (force) await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  if (noted[me] !== sig) {
    const body = it.packageId
      ? `Reply package ${it.packageId.slice(0, 8)} is prepared${it.flagged ? ' and flagged for approval' : ''}; the five-part pickup view is in the side pane. When the person asks to act on it, follow client-reply-prep §9 with --package ${it.packageId}.`
      : `${it.messages} client message${it.messages === 1 ? '' : 's'} waiting on our reply and ${it.tasks} committed task${it.tasks === 1 ? '' : 's'} due; no reply drafts are prepared yet.`
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `[Massmarket bridge, no reply needed] ${it.projectName}: ${titleFor(it, now)}. ${body} Nothing has been sent.` }] },
    })
    noted[me] = sig
    await $.store.set('mm.noted', noted)
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
  const me = selfCache
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
      if (!last || now - last.at >= SYNC_MS) await sync($)
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
 * The clients a typed name could mean. One whose short name or full name it is exactly, if there is one;
 * otherwise every client whose name contains it. More than one is a question for the person, never a guess.
 */
function clientsNamed(name: string, items: readonly QueueItem[]): QueueItem[] {
  const q = cleanName(name).toLowerCase()
  if (!q) return []
  const short = (i: QueueItem) => i.client.replace(/…$/, '').toLowerCase()
  const exact = items.filter(i => short(i) === q || i.projectName.toLowerCase() === q)
  return exact.length ? exact : items.filter(i => i.projectName.toLowerCase().includes(q) || short(i).includes(q))
}

// What the person typed is echoed cleaned, like any other text that did not come from this file.
const noClient = (name: string) => `No client matching "${cleanName(name)}" needs you right now. /mm shows who does.`

function severalClients(name: string, found: readonly QueueItem[]): string {
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
 */
async function startThread($: EngineInterface, it: QueueItem, pass: Pass): Promise<string> {
  const now = await $.clock.now()
  const me = await selfId($)
  const signature = signatureOf(it)
  // ⛔ One chip per client. A chip for this client, carrying this, already in this thread: nothing is minted.
  const before = await chipsOf($, now)
  if (me && before.some(c => c.projectId === it.projectId && !c.superseded && c.threadId === me && c.signature === signature)) {
    return `A chip for ${it.client} is already here: click Start on it.`
  }
  // A client that already has a thread: the new one is asked to look at how the old one ended (handoverText).
  const prompt = kickoffText(it, { replaces: await replaced($, it, pass) })
  const r = (await $.mcp.call('ccd_session', 'spawn_task', {
    title: `${it.client}: ${it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`,
    tldr: `${it.client} needs you: ${needsLine(it, now)}. Start this to open a thread for that client with the drafts or the messages waiting.`,
    prompt,
  })) as Mcp
  if (r.isError) return `Could not create the chip: ${short(textOf(r))}`
  try {
    // The chip shows in this thread only, so the record says which thread: the person is told where it
    // is from any other, and this thread's session withdraws it once it is no longer wanted. Any earlier
    // chip for the client, here or in another thread, is superseded by this one.
    const answer = textOf(r)
    const taskId = /\btask_id:\s*(task_[A-Za-z0-9]{1,40})/.exec(answer)?.[1] ?? /\b(task_[0-9a-f]{6,40})\b/.exec(answer)?.[1] ?? ''
    const chips = await chipsOf($, now)
    for (const c of chips) if (c.projectId === it.projectId) c.superseded = true
    const had = (await storeGet<Record<string, string>>($, 'mm.links', {}))[it.projectId]
    chips.push({ projectId: it.projectId, signature, taskId, threadId: me, at: now, prompt, ...(had ? { had } : {}) })
    await $.store.set('mm.chips', chips.slice(-CHIPS_MAX))
  } catch {
    // the chip is there either way; its thread then links like one started by hand
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
  const stored = await storeGet<unknown>($, 'mm.chips', [])
  if (!Array.isArray(stored)) return []
  return (stored as Array<Partial<Chip> | null>).filter(
    (c): c is Chip =>
      Boolean(c) && typeof c === 'object' && isUuid(c?.projectId) && typeof c?.signature === 'string' && typeof c?.taskId === 'string' && typeof c?.threadId === 'string' && typeof c?.prompt === 'string' && typeof c?.at === 'number' && now - c.at <= CHIP_KEEP_MS,
  )
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
  const me = selfCache
  if (!me) return
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  const mine = chips.filter(c => c.threadId === me)
  if (!mine.length) return
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  // With no sync on record there is no saying who still needs the person: no chip is withdrawn for that.
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const waiting = last && Array.isArray(last.items) ? new Set(last.items.map(i => i.projectId)) : null
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
  // written over a fresh copy: another thread may have minted or claimed a chip while this one was calling
  const fresh = await chipsOf($, now)
  const same = (a: Chip, b: Chip) => a.threadId === b.threadId && a.projectId === b.projectId && a.taskId === b.taskId && a.at === b.at
  const kept = fresh.filter(f => ![...forget].some(c => same(c, f))).map(f => {
    const tried = mine.find(c => same(c, f))
    return tried?.tries ? { ...f, tries: tried.tries } : f
  })
  await $.store.set('mm.chips', kept)
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
 * Opens a thread in the app, from a button press. ⛔ NOT BUILT YET: it answers false, and the caller says
 * where the thread is instead.
 *
 * What this build's plugin API offers (checked 2026-10-12, claude-code.d.ts 2.1.293):
 *   - a `Link` element: on the desktop surface an href that is not `https:` is drawn as plain text, so the
 *     app's `claude://` link is no anchor there;
 *   - no open-URL call anywhere on `$`;
 *   - `ccd_window.open_session_in`: only for this thread, or one this thread started.
 * The one way left is to start the system's opener with `$.process.run`. That is a new process on every
 * teammate's computer, so it waits for an explicit yes.
 *
 * ⛔ Whatever opens it, the only thing ever opened is `threadLink(thread)`: the app's own link for that
 *    thread, of exactly the shape `claude://claude.ai/epitaxy/<its id>`, for a thread the row showed.
 *    Never a URL from the feed, a title or a message.
 */
async function openThread(_$: EngineInterface, thread: AppThread | undefined): Promise<boolean> {
  if (!threadLink(thread)) return false
  return false
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
    const other = ownerName(owner, pass.last.items, (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[sid], pass.live.get(sid)?.title)
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
  if (pass.last.recs[it.projectId]?.state === 'current') {
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

  // The message went. Only now: the link, the unlink record, the stamp, what the thread now has, and the
  // pin and the name.
  let thread = pass.live.get(target.sid)
  try {
    await forgetUnlink($, target.sid)
    // read again: the pass before the send may be seconds old
    const fresh = await storeGet<Record<string, string>>($, 'mm.links', {})
    fresh[it.projectId] = target.sid
    await $.store.set('mm.links', fresh)
    await claim($, it.projectId, target.sid)
    // The person acted on this thread: it is pinned first, and the cap of 8 does not unpin it for a day.
    await stamp($, it.projectId, target.sid)
    // What the thread has now: while this is what would be sent, its row reads Open thread, not Update.
    const sent = await storeGet<Record<string, Sent>>($, 'mm.sent', {})
    delete sent[it.projectId]
    sent[it.projectId] = { sid: target.sid, sig: signatureOf(it), at: await $.clock.now() }
    await $.store.set('mm.sent', capped(sent))
    thread = (await reconcile($, feed, pass.pairs)).live.get(target.sid) ?? thread
  } catch {
    // the message is in the thread either way; the next sync pins and names it
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
    const it = last.items.find(i => i.projectId === row.projectId)
    return it ? showDrafts($, it) : noClient(row.client)
  }
  const feed = await fetchFeed($)
  const pass = await reconcile($, feed)
  const it = pass.last.items.find(i => i.projectId === row.projectId)
  if (!it) return noClient(row.client)
  if (verb === 'start') return started($, feed, pass, await startThread($, it, pass))
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
  await say($, said)
  await refreshBand($)
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
    return [
      `member: ${memberText(last?.member) || '?'}`,
      `last sync: ${last ? new Date(last.at).toISOString() : 'never'} · ${last?.items.length ?? 0} need you · ${last?.pinned ?? 0} pinned`,
      `linked threads: ${Object.keys(links).length} · this thread: ${await selfId($)}`,
      `poller: ${lease?.owner === (await instanceId($)) ? 'this thread' : 'another thread'}`,
      `paused: ${Boolean(await $.store.get('mm.paused'))}`,
      `last error: ${last?.error ?? 'none'}`,
    ].join('\n')
  }
  if (verb === 'view') {
    // /mm view shows this thread's client. A name typed after it is only checked: two clients it could mean is a question.
    if (arg) {
      const found = clientsNamed(arg, (await storeGet<Last | null>($, 'mm.last', null))?.items ?? [])
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
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
    for (const k of Object.keys(links)) if (links[k] === me) delete links[k]
    if (me && pins[me]?.byUs) await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: me, pinned: false })
    delete pins[me]
    await $.store.set('mm.links', links)
    await $.store.set('mm.pins', pins)
    if (me) {
      await claim($, undefined, me)
      // Unlinking is final for linking by itself: this thread is never auto-linked again, to any client.
      const unlinked = await storeGet<Record<string, number>>($, 'mm.unlinked', {})
      unlinked[me] = await $.clock.now()
      await $.store.set('mm.unlinked', capped(unlinked))
      // And its own name comes back.
      const titles = await storeGet<Record<string, string>>($, 'mm.titles', {})
      const own = titles[me]
      if (own !== undefined) {
        await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: me, title: own })
        delete titles[me]
        await $.store.set('mm.titles', titles)
      }
      // The link is dropped, and the thread's context reading with it.
      const readings = await storeGet<Record<string, ContextReading>>($, 'mm.ctx', {})
      if (me in readings) {
        delete readings[me]
        await $.store.set('mm.ctx', readings)
      }
    }
    return 'This thread is no longer linked to a client.'
  }

  const feed = await fetchFeed($)
  let named: QueueItem | undefined
  if (verb === 'link' || verb === 'start' || verb === 'update') {
    // The name is settled before anything is touched: no client, or more than one, does nothing at all.
    const queue = buildQueue(feed, await $.clock.now())
    const found = clientsNamed(arg, queue)
    if (found.length > 1) return severalClients(arg, found)
    named = found[0]
    if (!named) return noClient(arg)
    // ⛔ Only the person moves a thread from one client to another. For anyone else (Claude through the
    // tool, a /mm that is not the person's) `link` in a thread that is already another client's is refused
    // here, before anything is written. A thread that is nobody's may still be linked.
    if (verb === 'link' && by !== 'person') {
      const me = await selfId($)
      const owner = me && !(me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) ? ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {})) : undefined
      if (owner !== undefined && owner !== named.projectId) {
        const pin = (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[me]
        const here = await desktopOnly(async () => asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })), null)
        // the client's name wherever it can still be read; failing all of that, the sentence names no one
        const other = ownerName(owner, queue, pin, here?.title) || 'another client'
        return `This thread is ${other}'s. Only the person can move it: they type /mm link ${named.client}.`
      }
    }
  }
  const pass = await reconcile($, feed)
  const { last, pairs } = pass
  if (named) {
    const it = last.items.find(i => i.projectId === named.projectId)
    if (!it) return noClient(arg)
    // The person typed it: /mm start starts a new thread and /mm update updates the existing one, whatever
    // the row recommends (only a thread that already has this is not sent it again).
    if (verb === 'start') return started($, feed, pass, await startThread($, it, pass))
    if (verb === 'update') {
      const said = await updateThread($, feed, it, pass, { typed: true })
      return typeof said === 'string' ? said : said.text
    }
    const me = await selfId($)
    if (!me) return 'Linking a thread works in the desktop app\'s Code tab only.'
    await forgetUnlink($, me)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    // ⛔ a thread is one client's: linked here by hand, it is no longer any other client's
    for (const k of Object.keys(links)) if (links[k] === me && k !== it.projectId) delete links[k]
    links[it.projectId] = me
    await $.store.set('mm.links', links)
    await claim($, it.projectId, me)
    await stamp($, it.projectId, me)
    await reconcile($, feed, pairs)
    return `This thread is now ${it.client}'s. ${await refreshSelf($, true)}`
  }
  // The pane: this thread's client on top when it is a waiting client's thread, the list under it.
  await openPane($, last.items)
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
 */
async function linkFromMarker($: EngineInterface, text: string, origin: string | undefined): Promise<void> {
  const projectId = MARKER.exec(text)?.[1]
  if (!projectId || !origin || !PERSON_ORIGINS.has(origin)) return
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const inFeed = Array.isArray(last?.projects) ? last.projects : (last?.items ?? []).map(i => i.projectId)
  if (!inFeed.includes(projectId)) return
  const me = await selfId($)
  if (!me || me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) return
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const owner = ownerOf(me, links)
  if (owner !== undefined && owner !== projectId) return
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  // the chip this thread was started from: the one for this client whose prompt is this prompt, to the letter
  const chip = [...chips].reverse().find(c => c.projectId === projectId && c.prompt.trim() === text.trim())
  const had = links[projectId]
  if (had !== undefined && had !== me && !chip) return
  if (had !== me) {
    links[projectId] = me
    await $.store.set('mm.links', links)
    if (had !== undefined) {
      const released = await storeGet<string[]>($, 'mm.released', [])
      if (!released.includes(had)) await $.store.set('mm.released', [...released, had].slice(-REMEMBER_MAX))
    }
  }
  // the person started this: the link is theirs, not one the bridge made by itself
  await claim($, projectId, me)
  // What this thread has: the kickoff it opened with. From the chip, what the chip carried; with no chip
  // on record, only when its prompt is exactly the kickoff that would be sent now.
  const it = (last?.items ?? []).find(i => i.projectId === projectId)
  const sig = chip ? chip.signature : it && kickoffText(it) === text.trim() ? signatureOf(it) : undefined
  if (sig !== undefined) {
    const sent = await storeGet<Record<string, Sent>>($, 'mm.sent', {})
    delete sent[projectId]
    sent[projectId] = { sid: me, sig, at: now }
    await $.store.set('mm.sent', capped(sent))
  }
  if (chip) {
    // The person started it: the chip is spent. Any other chip for the client is superseded, for the
    // thread that minted it to withdraw on its own tick.
    const rest = chips.filter(c => c !== chip)
    for (const c of rest) if (c.projectId === projectId) c.superseded = true
    await $.store.set('mm.chips', rest)
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
          'Massmarket bridge, the same as the /mm command. args: "" or "queue" (who needs the person now), "status", "view" (this thread\'s client in the side pane), "link <client>" (make this thread that client\'s), "unlink", "pause", "resume". Starting or updating a client thread is for the person only: they press the button in the pane or type /mm start <client> or /mm update <client>. Use it only when the person asks; it never sends anything to a client.',
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
  on('ui.render', { component: 'Pane', requestId: PANE_QUEUE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const { value: queue } = await $.state.get(QUEUE)
    const { value: notice } = await $.state.get(NOTICE)
    const client = await clientPart($)
    // Nothing synced yet, or a value an older version of this plugin left in this session.
    const hasList = Boolean(queue && Array.isArray(queue.rows))
    if (!hasList && !client.text) return <Text dimColor>Checking…</Text>
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
                {group.rows.map(({ row, n, mark }) => (
                  <Box flexDirection="column" marginTop={1}>
                    <Text>{`${mark}${n}. ${row.title}`}</Text>
                    <Text dimColor>{rowDetail(row)}</Text>
                    <Box flexDirection="row" gap={1}>
                      {rowButtons(row).map((verb, i) =>
                        i === 0 ? (
                          <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} variant="primary" onPress={() => void press($, verb, row)} />
                        ) : (
                          <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} onPress={() => void press($, verb, row)} />
                        ),
                      )}
                    </Box>
                  </Box>
                ))}
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
