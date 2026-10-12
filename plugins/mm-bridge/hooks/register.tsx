import type { EngineInterface, Register } from 'claude-code'

import type { MmNotice, MmQueue } from '../types'

import { MAX_PINS, buildQueue, cleanName, cleanTitle, clearedTitle, clientMarkdown, holdBanner, isUuid, noteText, titleFor } from './queue'
import type { Feed, FeedThread, QueueItem } from './queue'
import { LABEL, PANE_SENTENCE, autoLinkFor, clientThreads, kickoffText, ownerOf, recommend, rowButtons, rowDetail, rowFor, sharedThreads, titleSuggestion } from './threads'
import type { AppThread, Pairs, Recommendation, Row } from './threads'

// The Massmarket bridge.
// Pinned threads are each person's to-do list: a client's thread pins itself and its name says what is
// due and when; opening it shows the drafts in a side pane and leaves a short note for Claude.
//
// Rob, 2026-10-12: "There should be a process that should already be looking to see what threads exist and
// deciding whether we should start a new one or not, and then making it really easy to pick up." So a
// client's existing thread links itself (a thread whose Claude Code session declared that client), each row
// of the Needs-you pane carries a recommendation, and its buttons act on it.
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

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.4.0'
const CLIENT_HEADER = { 'X-MM-Client': `mm-bridge/${VERSION}` }
const VIEW = { plugin: 'mm-bridge', key: 'view' } as const
const QUEUE = { plugin: 'mm-bridge', key: 'queue' } as const
const NOTICE = { plugin: 'mm-bridge', key: 'notice' } as const
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
type Verb = 'update' | 'start' | 'drafts'
/** A link the person made or used: which thread, and when. */
type Acted = Record<string, { sid: string; at: number }>
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
  return {
    sessionId: t.sessionId,
    title: typeof t.title === 'string' ? t.title : '',
    pinned: Boolean(t.pinned),
    isArchived: false,
    ...(typeof t.lastActivityAt === 'string' ? { lastActivityAt: t.lastActivityAt } : {}),
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
    const was = before?.recs?.[it.projectId]
    return was && (was.action === 'update' || was.action === 'start') && typeof was.reason === 'string' ? { action: was.action, reason: was.reason } : recommend([], undefined, now)
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

  // ⛔ A thread missing from the app's list is not a thread that is gone: the list holds the 60 most
  // recent. Each linked or pinned thread the list left out is asked for by id. One the app shows open is a
  // thread like any other. One the app says does not exist, or shows archived, is `gone`. Anything else (an
  // error, no answer, more of them than one sync asks for) is `unseen`: its link, pin record and title are
  // kept exactly as they are, and nothing is done to it.
  // ⛔ And an empty list never drops anything at all, whatever a lookup says.
  const gone = new Set<string>()
  const unseen = new Set<string>()
  const missing = [...new Set([...Object.values(links), ...Object.keys(pins)])].filter(sid => !live.has(sid))
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

  // R2: each client's recommendation. A title that merely looks like the client is offered only when the
  // client has no known thread at all. ⛔ Never a thread linked to another client (clientThreads, titleSuggestion).
  const recs: Record<string, Recommendation> = {}
  const rows: Row[] = []
  for (const it of items) {
    const linked = links[it.projectId]
    const threads = clientThreads(it.projectId, links, feedThreads, pairs, live)
    // A client whose linked thread cannot be seen keeps the last recommendation's words, and no thread to act on.
    const rec = linked && unseen.has(linked) ? carried(it) : recommend(threads, threads.length ? undefined : titleSuggestion(it.client, links, live), now)
    recs[it.projectId] = rec
    rows.push(rowFor(it, rec, now))
  }

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

/** A client's pane: the pickup view (under a line saying the viewer holds it, when they do), or what is waiting. */
async function paneMarkdown($: EngineInterface, it: QueueItem, now: number): Promise<string> {
  const view = await renderPickup($, it)
  return view ? [holdBanner(it), view].filter(Boolean).join('\n\n') : clientMarkdown(it, now)
}

/**
 * This thread's client in the side pane, with a short note for Claude. `force` is the person asking for it
 * (/mm view, /mm link); without it this is the timer.
 * ⛔ A thread that linked itself gets the pin and the name only. The pane is not opened and nothing is
 * added to its transcript until the person acts on that link: Update, /mm link, or /mm view here.
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
  const o = it.open ?? null
  const sig = o
    ? `open:${o.id}:${o.state}:${it.coversThrough ?? ''}:${o.unsent}:${o.newer}:${it.messages}:${it.tasks}`
    : it.packageId ? `pkg:${it.packageId}:${it.coversThrough}` : `q:${it.messages}:${it.tasks}:${it.dueAt}`
  const noted = await storeGet<Record<string, string>>($, 'mm.noted', {})
  if (!force && noted[me] === sig) return 'Up to date.'
  const now = await $.clock.now()
  const md = await paneMarkdown($, it, now)
  await $.state.set(VIEW, md)
  void $.ui.open({ id: PANE_VIEW, title: it.client })
  if (noted[me] !== sig) {
    const body = noteText(it, last?.member ?? '')
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `[Massmarket bridge, no reply needed] ${it.projectName}: ${titleFor(it, now)}. ${body} Nothing has been sent.` }] },
    })
    noted[me] = sig
    await $.store.set('mm.noted', noted)
  }
  return `Showing ${it.client} in the side pane.`
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
    if (await $.store.get('mm.paused')) return
    const now = await $.clock.now()
    const id = await instanceId($)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    if (!lease || lease.until < now || lease.owner === id) {
      await $.store.set('mm.lease', { owner: id, until: now + LEASE_MS })
      const last = await storeGet<Last | null>($, 'mm.last', null)
      if (!last || now - last.at >= SYNC_MS) await sync($)
    }
    await refreshSelf($, false)
    await beat($, { ok: true })
  } catch (err) {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    if (last) await $.store.set('mm.last', { ...last, error: short(String(err), 300) })
    $.ui.status(`MM: error, /mm status`)
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
  return title && isOurTitle(title) ? cleanName(title.replace(/^\S+\s/u, '').split(' · ')[0]) : ''
}

// ---------------------------------------------------------------- what a button or a command does
// ⛔ Everything below this line runs only because the person pressed a button or typed a command.
// ⛔ startThread and updateThread are never reached for Claude: see `runCommand`.

/**
 * Start thread. The app gives a plugin no way to open a new thread with a first message (no start_session
 * tool on this build), so this mints a chip whose prompt is the kickoff, and the person clicks Start on it.
 */
async function startThread($: EngineInterface, it: QueueItem): Promise<string> {
  const now = await $.clock.now()
  const r = (await $.mcp.call('ccd_session', 'spawn_task', {
    title: `${it.client}: ${it.open?.state === 'held_by_other' ? `reply drafts are with ${it.open.by}` : it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`,
    tldr: `${it.client} needs you: ${titleFor(it, now).replace(/^\S+\s/, '')}. Start this to open a thread for that client with the drafts or the messages waiting.`,
    prompt: kickoffText(it),
  })) as Mcp

  return r.isError ? `Could not create the chip: ${short(textOf(r))}` : `A chip for ${it.client} is ready: click Start.`
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
async function updateThread($: EngineInterface, feed: Feed, it: QueueItem, pass: Pass, how: { typed: true } | { typed: false; shown: string | undefined }): Promise<string> {
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

  // The message went. Only now: the link, the unlink record, the stamp, and the pin and the name.
  let title = target.title
  try {
    await forgetUnlink($, target.sid)
    // read again: the pass before the send may be seconds old
    const fresh = await storeGet<Record<string, string>>($, 'mm.links', {})
    fresh[it.projectId] = target.sid
    await $.store.set('mm.links', fresh)
    await claim($, it.projectId, target.sid)
    // The person acted on this thread: it is pinned first, and the cap of 8 does not unpin it for a day.
    await stamp($, it.projectId, target.sid)
    title = (await reconcile($, feed, pass.pairs)).live.get(target.sid)?.title ?? title
  } catch {
    // the message is in the thread either way; the next sync pins and names it
  }
  return here ? `Picking up ${it.client} in this thread.` : `Sent to ${it.client}'s thread: open "${cleanTitle(title)}" under Pinned.`
}

/** Drafts: the client's five-part pickup view in the side pane. Links, pins and starts nothing. */
async function showDrafts($: EngineInterface, it: QueueItem): Promise<string> {
  const md = await paneMarkdown($, it, await $.clock.now())
  await $.state.set(VIEW, md)
  await $.ui.open({ id: PANE_VIEW, title: it.client })
  return ''
}

/** A button on a row. `row` is the row as it was drawn: Update acts on the thread that row showed. */
async function act($: EngineInterface, verb: Verb, row: Row): Promise<string> {
  if (verb === 'drafts') {
    const last = (await storeGet<Last | null>($, 'mm.last', null)) ?? (await sync($))
    const it = last.items.find(i => i.projectId === row.projectId)
    return it ? showDrafts($, it) : noClient(row.client)
  }
  const feed = await fetchFeed($)
  const pass = await reconcile($, feed)
  const it = pass.last.items.find(i => i.projectId === row.projectId)
  if (!it) return noClient(row.client)
  return verb === 'start' ? startThread($, it) : updateThread($, feed, it, pass, { typed: false, shown: row.target })
}

async function say($: EngineInterface, text: string): Promise<void> {
  const notice: MmNotice = { text, at: await $.clock.now() }
  await $.state.set(NOTICE, notice)
  if (text) $.ui.toast(text)
}

async function press($: EngineInterface, verb: Verb, row: Row): Promise<void> {
  let text: string
  try {
    text = await act($, verb, row)
  } catch (err) {
    text = errorText(err)
  }
  await say($, text)
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
    if (verb === 'start') return startThread($, it)
    if (verb === 'update') return updateThread($, feed, it, pass, { typed: true })
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
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
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
  if (links[projectId] !== me) {
    links[projectId] = me
    await $.store.set('mm.links', links)
  }
  // the person started this: the link is theirs, not one the bridge made by itself
  await claim($, projectId, me)
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
    try {
      await linkFromMarker($, String(e.text ?? ''), (e.origin as { kind?: string } | undefined)?.kind)
    } catch {
      // a marker that cannot be acted on never holds a prompt back
    }
    return next(e)
  })

  // ⛔ The person's own /mm only: typed here, or sent from their phone. A /mm that arrived any other way is
  // answered like the tool.
  on('command.run', { command: 'mm' }, async ($, e) => ({
    text: await runCommand($, String(e.args ?? ''), PERSON_ORIGINS.has(String((e.origin as { kind?: string } | undefined)?.kind)) ? 'person' : 'other'),
  }))

  // ⛔ Claude calls this. It never starts or updates a thread: `runCommand` refuses both for it.
  on('tool.call', { tool: 'mcp__mm-bridge__mm' }, async ($, e) => ({
    result: await runCommand($, String((e as Record<string, unknown>).args ?? ''), 'other'),
  }))

  on('ui.render', { component: 'Pane', requestId: PANE_VIEW }, async ($, e) => {
    const { Markdown, Text } = $.ui.resolve(e)
    const { value: text = '' } = await $.state.get(VIEW)
    return text ? <Markdown text={text} /> : <Text dimColor>Nothing to show yet.</Text>
  })

  // Needs you: a row per client with its recommendation, and the buttons that act on it.
  on('ui.render', { component: 'Pane', requestId: PANE_QUEUE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: queue } = await $.state.get(QUEUE)
    const { value: notice } = await $.state.get(NOTICE)
    // Nothing synced yet, or a value an older version of this plugin left in this session.
    if (!queue || !Array.isArray(queue.rows)) return <Text dimColor>Checking…</Text>
    return (
      <Box flexDirection="column">
        <Text bold>{queue.header}</Text>
        {notice?.text ? <Text>{notice.text}</Text> : null}
        {queue.rows.map((row, i) => (
          <Box flexDirection="column" marginTop={1}>
            <Text>{`${i + 1}. ${row.title}`}</Text>
            <Text dimColor>{rowDetail(row)}</Text>
            <Box flexDirection="row" gap={1}>
              {rowButtons(row).map((verb, n) =>
                n === 0 ? (
                  <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} variant="primary" onPress={() => void press($, verb, row)} />
                ) : (
                  <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} onPress={() => void press($, verb, row)} />
                ),
              )}
            </Box>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>{queue.note}</Text>
        </Box>
      </Box>
    )
  })
}
