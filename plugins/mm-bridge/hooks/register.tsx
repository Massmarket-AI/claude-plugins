import type { EngineInterface, Register } from 'claude-code'

import { MAX_PINS, buildQueue, clearedTitle, clientMarkdown, queueMarkdown, titleFor, titleNames } from './queue'
import type { Feed, QueueItem } from './queue'

// The Massmarket bridge.
// Pinned threads are each person's to-do list: a client's thread pins itself and its name says what is
// due and when; opening it shows the drafts in a side pane and leaves a short note for Claude.
// ⛔ It never starts a model turn: no $.prompt.submit anywhere. The only paid moment is when the person types.
// ⛔ It only touches threads linked to a client, and only unpins a thread it pinned itself.

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.3.1'
const CLIENT_HEADER = { 'X-MM-Client': `mm-bridge/${VERSION}` }
const VIEW = { plugin: 'mm-bridge', key: 'view' } as const
const QUEUE = { plugin: 'mm-bridge', key: 'queue' } as const
const PANE_VIEW = 'mm-view'
const PANE_QUEUE = 'mm-queue'
const SYNC_MS = 5 * 60_000
const TICK_MS = 60_000
const LEASE_MS = 150_000
const MAX_WRITES = 24

type Mcp = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
type Sess = { sessionId: string; title?: string; pinned?: boolean; isArchived?: boolean }
type Pin = { projectId: string; client: string; byUs: boolean }
type Last = { at: number; member: string; items: QueueItem[]; pinned: number; error?: string }

let selfCache: string | null = null
let instanceCache: string | null = null

const textOf = (r: Mcp) => (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
const short = (s: string, n = 200) => s.replace(/\s+/g, ' ').slice(0, n)

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
    const me = await desktopOnly(async () => (await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Sess, null)
    if (!me?.sessionId) return ''
    selfCache = me.sessionId
  }
  return selfCache
}

async function instanceId($: EngineInterface): Promise<string> {
  if (!instanceCache) instanceCache = String(await $.session.id())
  return instanceCache
}

async function sessions($: EngineInterface): Promise<Sess[]> {
  return desktopOnly(async () => {
    const others = (await mcpJson($, 'ccd_session_mgmt', 'list_sessions', { limit: 60 })) as Sess[]
    const me = (await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as Sess
    return [me, ...(Array.isArray(others) ? others : [])].filter(s => s && s.sessionId && !s.isArchived)
  }, [] as Sess[])
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

async function sync($: EngineInterface): Promise<Last> {
  const feed = await fetchFeed($)
  const now = await $.clock.now()
  const items = buildQueue(feed, now)
  const live = new Map((await sessions($)).map(s => [s.sessionId, s] as const))
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})

  for (const [pid, sid] of Object.entries(links)) if (!live.has(sid)) delete links[pid]
  for (const it of items) {
    if (links[it.projectId]) continue
    const match = [...live.values()].find(s => s.title && titleNames(s.title, it.client))
    if (match && !Object.values(links).includes(match.sessionId)) links[it.projectId] = match.sessionId
  }

  // The threads that should be pinned now: linked clients, soonest due first, at most MAX_PINS.
  const want = new Map<string, QueueItem>()
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && !want.has(sid) && want.size < MAX_PINS) want.set(sid, it)
  }

  let writes = 0
  for (const [sid, it] of want) {
    const s = live.get(sid)
    if (!s || writes >= MAX_WRITES) continue
    const title = titleFor(it, now)
    if (s.title !== title) {
      await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title })
      writes++
    }
    const already = pins[sid]
    if (!s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: true })
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
        writes++
      }
      const still = items.find(i => i.projectId === pin.projectId)
      const title = still ? titleFor(still, now) : clearedTitle(pin.client, now)
      if (s.title !== title) {
        await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title })
        writes++
      }
    }
    delete pins[sid]
  }

  const last: Last = { at: now, member: feed.member, items, pinned: want.size }
  await $.store.set('mm.links', links)
  await $.store.set('mm.pins', pins)
  await $.store.set('mm.last', last)
  const note = `_Updated ${new Date(now).toISOString().slice(11, 16)} UTC for ${feed.member}. Pins: overdue by up to 3 business days, or due within the next 24 business hours. Weekends do not count. /mm link <client> links this thread to a client._`
  await $.state.set(QUEUE, queueMarkdown(items, links, now, note))
  $.ui.status(items.length ? `MM: ${items.length} need you · ${want.size} pinned` : 'MM: clear')
  return last
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
    if (await $.store.get('mm.paused')) return
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
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

async function startThread($: EngineInterface, it: QueueItem): Promise<string> {
  const r = (await $.mcp.call('ccd_session', 'spawn_task', {
    title: `${it.client}: ${it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`,
    tldr: `${it.client} needs you: ${titleFor(it, Date.now()).replace(/^\S+\s/, '')}. Start this to open a thread for that client with the drafts or the messages waiting.`,
    prompt: `[mm-link ${it.projectId}] Pick up the reply drafts for ${it.projectName} (OW project ${it.projectId}). Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view${it.packageId ? ` for package ${it.packageId}` : ''} and wait for the person. Nothing is sent without their go.`,
  })) as Mcp

  return r.isError ? `Could not create the chip: ${short(textOf(r))}` : `A chip for ${it.client} is ready in this thread: click Start.`
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
    return 'This thread is no longer linked to a client.'
  }

  const last = await sync($)
  if (verb === 'link' || verb === 'start') {
    const it = matchProject(arg, last.items)
    if (!it) return `No client matching "${arg}" needs you right now. /mm shows who does.`
    if (verb === 'start') return startThread($, it)
    const me = await selfId($)
    if (!me) return 'Linking a thread works in the desktop app\'s Code tab only.'
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    links[it.projectId] = me
    await $.store.set('mm.links', links)
    await sync($)
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
        description: 'Massmarket: /mm (what needs you) · /mm link <client> · /mm start <client> · /mm view · /mm unlink · /mm status · /mm pause|resume',
      })
      await $.tool.register({
        name: 'mm',
        description:
          'Massmarket bridge, the same as the /mm command. args: "" or "queue" (who needs the person now), "status", "view" (this thread\'s client in the side pane), "link <client>" (make this thread that client\'s), "start <client>" (a chip for a new client thread), "unlink", "pause", "resume". Use it only when the person asks; it never sends anything to a client.',
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

  on('ui.render', { component: 'Pane', requestId: PANE_QUEUE }, async ($, e) => {
    const { Markdown, Text } = $.ui.resolve(e)
    const { value: text = '' } = await $.state.get(QUEUE)
    return text ? <Markdown text={text} /> : <Text dimColor>Checking…</Text>
  })
}
