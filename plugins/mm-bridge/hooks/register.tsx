import type { EngineInterface, Register } from 'claude-code'

import type { MmNotice, MmQueue } from '../types'

import { MAX_PINS, buildQueue, clearedTitle, clientMarkdown, titleFor } from './queue'
import type { Feed, QueueItem } from './queue'
import { LABEL, PANE_SENTENCE, autoLinkFor, clientThreads, kickoffText, recommend, rowButtons, rowDetail, rowFor, titleSuggestion } from './threads'
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
// thread, and a chip is minted, only from a button the person pressed or a command they typed
// (updateThread and startThread, reached from `act` and `runCommand` alone). That message starts a model
// turn in the client's thread: the one paid moment the bridge causes, and the person asked for it.
// ⛔ It only touches threads linked to a client, and only unpins a thread it pinned itself.
// ⛔ A thread the person unlinked never links itself again, and gets its own name back.

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.3.1'
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

type Mcp = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
type Pin = { projectId: string; client: string; byUs: boolean }
type Last = { at: number; member: string; items: QueueItem[]; pinned: number; recs: Record<string, Recommendation>; error?: string }
type Verb = 'update' | 'start' | 'drafts'

let selfCache: string | null = null
let instanceCache: string | null = null

const textOf = (r: Mcp) => (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
const short = (s: string, n = 200) => s.replace(/\s+/g, ' ').slice(0, n)
const errorText = (err: unknown) => short(err instanceof Error ? err.message : String(err), 300)
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

async function sessions($: EngineInterface): Promise<AppThread[]> {
  return desktopOnly(async () => {
    const others = (await mcpJson($, 'ccd_session_mgmt', 'list_sessions', { limit: 60 })) as AppThread[]
    const me = (await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as AppThread
    return [me, ...(Array.isArray(others) ? others : [])].filter(s => s && s.sessionId && !s.isArchived)
  }, [] as AppThread[])
}

async function fetchFeed($: EngineInterface): Promise<Feed> {
  const r = await $.http.fetch(`${EXT}/closeout?mail_hours=96`, { headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER } })
  if (!r.ok) throw new Error(`closeout HTTP ${r.status}: ${short(r.text, 160)}`)
  return JSON.parse(r.text) as Feed
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

/**
 * One pass over a feed: threads link themselves, the first MAX_PINS linked clients' threads are pinned and
 * named, the rest are let go, and every client gets its recommendation. `firstProjectId` is the client
 * whose button was just pressed: its thread is pinned and named in this pass whatever its place in line.
 * ⛔ Sends nothing and starts nothing.
 */
async function reconcile($: EngineInterface, feed: Feed, firstProjectId?: string): Promise<{ last: Last; live: Map<string, AppThread> }> {
  const now = await $.clock.now()
  const items = buildQueue(feed, now)
  const live = new Map((await sessions($)).map(s => [s.sessionId, s] as const))
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  const unlinked = await storeGet<Record<string, number>>($, 'mm.unlinked', {})
  const titles = await storeGet<Record<string, string>>($, 'mm.titles', {})
  const feedThreads = Array.isArray(feed.threads) ? feed.threads : []

  // A link to a thread that is gone, or that the person unlinked (a sync in another thread may have written
  // an older copy of the links back after the unlink), is dropped.
  for (const [pid, sid] of Object.entries(links)) if (!live.has(sid) || sid in unlinked) delete links[pid]
  // R1: a client with no thread takes the most recently active thread whose session declared it.
  for (const it of items) {
    const sid = autoLinkFor(it.projectId, links, feedThreads, pairs, live, unlinked)
    if (sid) links[it.projectId] = sid
  }

  // The threads that should be pinned now: linked clients, soonest due first, at most MAX_PINS.
  const inLine = firstProjectId ? [...items.filter(i => i.projectId === firstProjectId), ...items.filter(i => i.projectId !== firstProjectId)] : items
  const want = new Map<string, QueueItem>()
  for (const it of inLine) {
    const sid = links[it.projectId]
    if (sid && !want.has(sid) && want.size < MAX_PINS) want.set(sid, it)
  }

  let writes = 0
  const rename = async (s: AppThread, title: string): Promise<void> => {
    // The thread's own name is kept from before the first time we rename it, so /mm unlink can give it back.
    if (titles[s.sessionId] === undefined && s.title && !isOurTitle(s.title)) titles[s.sessionId] = s.title
    await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: s.sessionId, title })
    s.title = title
    writes++
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
  for (const [sid, pin] of Object.entries(pins)) {
    if (want.has(sid)) continue
    const s = live.get(sid)
    if (s && writes < MAX_WRITES) {
      if (pin.byUs && s.pinned) {
        await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
        s.pinned = false
        writes++
      }
      const still = items.find(i => i.projectId === pin.projectId)
      const title = still ? titleFor(still, now) : clearedTitle(pin.client, now)
      if (s.title !== title) await rename(s, title)
    }
    delete pins[sid]
  }

  // R2: each client's recommendation. A title that merely looks like the client is offered only when the
  // client has no known thread at all.
  const recs: Record<string, Recommendation> = {}
  const rows: Row[] = []
  for (const it of items) {
    const threads = clientThreads(it.projectId, links, feedThreads, pairs, live)
    const rec = recommend(threads, threads.length ? undefined : titleSuggestion(it.client, links, live), now)
    recs[it.projectId] = rec
    rows.push(rowFor(it, rec, now))
  }

  const last: Last = { at: now, member: feed.member, items, pinned: want.size, recs }
  await $.store.set('mm.links', links)
  await $.store.set('mm.pins', pins)
  await $.store.set('mm.titles', capped(titles))
  await $.store.set('mm.last', last)
  const queue: MmQueue = {
    header: items.length ? `Needs you now (${items.length}${items.length > MAX_PINS ? `, the first ${MAX_PINS} pin` : ''})` : 'Nothing needs you right now.',
    rows,
    note: `Updated ${new Date(now).toISOString().slice(11, 16)} UTC for ${feed.member}. ${PANE_SENTENCE}`,
  }
  await $.state.set(QUEUE, queue)
  const { value: notice } = await $.state.get(NOTICE)
  if (notice?.text && now - notice.at > SYNC_MS) await $.state.set(NOTICE, { text: '', at: now })
  $.ui.status(items.length ? `MM: ${items.length} need you · ${want.size} pinned` : 'MM: clear')
  return { last, live }
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

async function refreshSelf($: EngineInterface, force: boolean): Promise<string> {
  const me = await selfId($)
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pid = me ? Object.keys(links).find(k => links[k] === me) : undefined
  if (!pid) return 'This thread is not linked to a client. Use /mm link <client>.'
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const it = last?.items.find(i => i.projectId === pid)
  if (!it) return 'Nothing needs you on this client right now.'
  const sig = it.packageId ? `pkg:${it.packageId}:${it.coversThrough}` : `q:${it.messages}:${it.tasks}:${it.dueAt}`
  const noted = await storeGet<Record<string, string>>($, 'mm.noted', {})
  if (!force && noted[me] === sig) return 'Up to date.'
  const now = await $.clock.now()
  const md = (await renderPickup($, it)) ?? clientMarkdown(it, now)
  await $.state.set(VIEW, md)
  void $.ui.open({ id: PANE_VIEW, title: it.client })
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

async function beat($: EngineInterface, extra: Record<string, unknown>): Promise<void> {
  try {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    await $.fs.write(
      `${await home($)}/.claude/mm-hooks/bridge-state.json`,
      JSON.stringify({ version: VERSION, at: new Date(await $.clock.now()).toISOString(), session: await instanceId($), lastSync: last ? new Date(last.at).toISOString() : null, member: last?.member, need: last?.items.length ?? 0, pinned: last?.pinned ?? 0, error: last?.error ?? null, ...extra }, null, 1),
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

function matchProject(name: string, items: QueueItem[]): QueueItem | undefined {
  const q = name.trim().toLowerCase()
  if (!q) return undefined
  return items.find(i => i.client.toLowerCase() === q) ?? items.find(i => i.projectName.toLowerCase().includes(q))
}

const noClient = (name: string) => `No client matching "${name}" needs you right now. /mm shows who does.`

// ---------------------------------------------------------------- what a button or a command does
// ⛔ Everything below this line runs only because the person pressed a button or typed a command.

/**
 * Start thread. The app gives a plugin no way to open a new thread with a first message (no start_session
 * tool on this build), so this mints a chip whose prompt is the kickoff, and the person clicks Start on it.
 */
async function startThread($: EngineInterface, it: QueueItem): Promise<string> {
  const now = await $.clock.now()
  const r = (await $.mcp.call('ccd_session', 'spawn_task', {
    title: `${it.client}: ${it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`,
    tldr: `${it.client} needs you: ${titleFor(it, now).replace(/^\S+\s/, '')}. Start this to open a thread for that client with the drafts or the messages waiting.`,
    prompt: kickoffText(it),
  })) as Mcp

  return r.isError ? `Could not create the chip: ${short(textOf(r))}` : `A chip for ${it.client} is ready: click Start.`
}

/**
 * Update thread: the client's thread is linked, pinned and named, then gets the kickoff as a message. That
 * starts a model turn there. The app refuses to bring a thread forward unless this thread started it
 * (ccd_window.open_session_in), so the answer says which pinned thread to open.
 */
async function updateThread($: EngineInterface, feed: Feed, it: QueueItem, rec: Recommendation | undefined): Promise<string> {
  const target = rec?.target
  if (!target) return `No thread for ${it.client} yet: use /mm start ${it.client}.`
  const failed = (why: string) => `Could not send to ${it.client}'s thread: ${why}`
  let title = target.title
  try {
    await forgetUnlink($, target.sid)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    links[it.projectId] = target.sid
    await $.store.set('mm.links', links)
    const { live } = await reconcile($, feed, it.projectId)
    title = live.get(target.sid)?.title ?? title

    const text = kickoffText(it, { update: true })
    if (target.sid === (await selfId($))) {
      // The client's thread is this one, and the app's send does not take the sending thread: the kickoff
      // goes in here as the person's own prompt. Not awaited: it starts once this press or command returns.
      void Promise.resolve($.prompt.submit({ text, asUser: true }))
        .then(async r => {
          const drop = (r as { drop?: string } | undefined)?.drop
          if (drop) await say($, failed(short(drop)))
        })
        .catch(async err => say($, failed(errorText(err))))
    } else {
      const r = (await $.mcp.call('ccd_session_mgmt', 'send_message', { session_id: target.sid, message: text })) as Mcp
      if (r.isError) return failed(short(textOf(r)))
    }
  } catch (err) {
    return failed(errorText(err))
  }
  return `Sent to ${it.client}'s thread: open "${title}" under Pinned.`
}

/** Drafts: the client's five-part pickup view in the side pane. Links, pins and starts nothing. */
async function showDrafts($: EngineInterface, it: QueueItem): Promise<string> {
  const md = (await renderPickup($, it)) ?? clientMarkdown(it, await $.clock.now())
  await $.state.set(VIEW, md)
  await $.ui.open({ id: PANE_VIEW, title: it.client })
  return ''
}

async function act($: EngineInterface, verb: Verb, projectId: string, client: string): Promise<string> {
  if (verb === 'drafts') {
    const last = (await storeGet<Last | null>($, 'mm.last', null)) ?? (await sync($))
    const it = last.items.find(i => i.projectId === projectId)
    return it ? showDrafts($, it) : noClient(client)
  }
  const feed = await fetchFeed($)
  const { last } = await reconcile($, feed)
  const it = last.items.find(i => i.projectId === projectId)
  if (!it) return noClient(client)
  return verb === 'start' ? startThread($, it) : updateThread($, feed, it, last.recs[projectId])
}

async function say($: EngineInterface, text: string): Promise<void> {
  const notice: MmNotice = { text, at: await $.clock.now() }
  await $.state.set(NOTICE, notice)
  if (text) $.ui.toast(text)
}

async function press($: EngineInterface, verb: Verb, row: Row): Promise<void> {
  let text: string
  try {
    text = await act($, verb, row.projectId, row.client)
  } catch (err) {
    text = errorText(err)
  }
  await say($, text)
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = 'queue', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ')
  if (verb === 'pause' || verb === 'resume') {
    await $.store.set('mm.paused', verb === 'pause')
    return verb === 'pause' ? 'Paused on this computer: no pins or renames until /mm resume.' : 'Resumed.'
  }
  if (verb === 'status') {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    return [
      `member: ${last?.member ?? '?'}`,
      `last sync: ${last ? new Date(last.at).toISOString() : 'never'} · ${last?.items.length ?? 0} need you · ${last?.pinned ?? 0} pinned`,
      `linked threads: ${Object.keys(links).length} · this thread: ${await selfId($)}`,
      `poller: ${lease?.owner === (await instanceId($)) ? 'this thread' : 'another thread'}`,
      `paused: ${Boolean(await $.store.get('mm.paused'))}`,
      `last error: ${last?.error ?? 'none'}`,
    ].join('\n')
  }
  if (verb === 'view') return refreshSelf($, true)
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
  const { last } = await reconcile($, feed)
  if (verb === 'link' || verb === 'start' || verb === 'update') {
    const it = matchProject(arg, last.items)
    if (!it) return noClient(arg)
    if (verb === 'start') return startThread($, it)
    if (verb === 'update') return updateThread($, feed, it, last.recs[it.projectId])
    const me = await selfId($)
    if (!me) return 'Linking a thread works in the desktop app\'s Code tab only.'
    await forgetUnlink($, me)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    links[it.projectId] = me
    await $.store.set('mm.links', links)
    await reconcile($, feed)
    return `This thread is now ${it.client}'s. ${await refreshSelf($, true)}`
  }
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  return last.items.length ? `${last.items.length} client${last.items.length === 1 ? '' : 's'} need you; ${last.pinned} thread${last.pinned === 1 ? '' : 's'} pinned. The list is in the side pane.` : 'Nothing needs you right now.'
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
          'Massmarket bridge, the same as the /mm command. args: "" or "queue" (who needs the person now), "status", "view" (this thread\'s client in the side pane), "link <client>" (make this thread that client\'s), "update <client>" (send the kickoff message into that client\'s existing thread, which starts a turn there), "start <client>" (a chip for a new client thread), "unlink", "pause", "resume". Use it only when the person asks; it never sends anything to a client.',
        inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'what follows /mm' } } },
        isDeferred: false,
      })
    } catch (err) {
      await beat($, { registerError: short(String(err), 300) })
    }
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const m = /\[mm-link ([0-9a-f-]{36})\]/.exec(String(e.text ?? ''))
    const me = m ? await selfId($) : ''
    if (m && me) {
      await forgetUnlink($, me)
      const links = await storeGet<Record<string, string>>($, 'mm.links', {})
      links[m[1] as string] = me
      await $.store.set('mm.links', links)
    }
    return next(e)
  })

  on('command.run', { command: 'mm' }, async ($, e) => ({ text: await runCommand($, String(e.args ?? '')) }))

  on('tool.call', { tool: 'mcp__mm-bridge__mm' }, async ($, e) => ({
    result: await runCommand($, String((e as Record<string, unknown>).args ?? '')),
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
