import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import type { Feed } from './queue'
import { PANE_SENTENCE } from './threads'

// The bridge against a pretend desktop app, a pretend feed and a pretend store. Nothing here reaches the
// live feed or a real thread, and every client is made up.

/** Monday 2026-10-12, 11 AM in New York. */
const NOW = Date.parse('2026-10-12T15:00:00Z')
const HOUR = 3_600_000
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

const ACME = '11111111-1111-1111-1111-111111111111'
const BOLT = '22222222-2222-2222-2222-222222222222'
const CEDAR = '33333333-3333-3333-3333-333333333333'
const ME = 'builder-a@example.com'
/** This thread: the app's id for it, and the Claude Code session id its worklog rows carry. */
const SELF = 'local_self'
const SELF_CLI = 'cccccccc-0000-4000-8000-000000000000'
const PKG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

type Thread = { sessionId: string; title: string; pinned: boolean; isArchived: boolean; lastActivityAt: string }
type Call = { server: string; tool: string; args: Record<string, unknown> }

const thread = (sessionId: string, title: string, hoursAgo: number, over: Partial<Thread> = {}): Thread => ({
  sessionId, title, pinned: false, isArchived: false, lastActivityAt: ago(hoursAgo), ...over,
})

/** Acme has a prepared package, Bolt two client messages and no package, Cedar one committed task. */
const feed = (over: Partial<Feed> = {}): Feed => ({
  member: ME,
  role: 'builder',
  drafts: [{ package_id: PKG, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: ago(3), drafts_ready: 2, project_owner_email: ME }],
  mail: [1, 2].map(n => ({
    message_id_key: `bolt-${n}`, received_at: ago(n), reply_due_at: new Date(NOW + (24 - n) * HOUR).toISOString(), sender: 'client@example.com',
    subject: 'Question', snippet: 'hello', project_id: BOLT, project_name: 'Bolt Staffing (Sam)', reply_status: 'unanswered', project_owner_email: ME,
  })),
  tickets: { due_today: [{ ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }] },
  ...over,
})

function world(on: On, opts: { feed?: Feed; threads?: Thread[]; store?: Record<string, unknown>; self?: Thread; sendFails?: string; terminal?: boolean; files?: Record<string, { text: string; mtimeMs: number }>; env?: Record<string, string> } = {}) {
  const clock = mock.clock(on, { now: NOW })
  // A terminal session has no desktop app behind it: its session tools are not there to call.
  mock.env(on, opts.env ?? { CLAUDE_CODE_ENTRYPOINT: opts.terminal ? 'cli' : 'claude-desktop', HOME: '/home/someone' })
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify(opts.store ?? {}))
  on('store.get', (_$, e) => ({ value: stored[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(stored[e.key])) }))
  on('store.set', (_$, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })

  const self = opts.self ?? thread(SELF, 'Morning hub', 0)
  const threads = new Map<string, Thread>([self, ...(opts.threads ?? [])].map(t => [t.sessionId, { ...t }]))
  const calls: Call[] = []
  const prompts: Array<{ text: string; origin: unknown }> = []
  const opened: Array<{ id: string; title?: string }> = []
  const toasts: string[] = []
  const fetched: string[] = []
  const registered: string[] = []
  let theFeed = opts.feed ?? feed()

  const text = (value: unknown) => ({ value: { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false } })
  on('mcp.call', (_$, e) => {
    if (opts.terminal && e.server.startsWith('ccd_')) return { deny: `MCP server "${e.server}" is not connected` }
    calls.push({ server: e.server, tool: e.tool, args: e.args })
    const id = e.args.session_id === 'self' ? self.sessionId : String(e.args.session_id ?? '')
    const t = threads.get(id)
    if (e.tool === 'get_session') return text(t ?? {})
    if (e.tool === 'list_sessions') return text([...threads.values()].filter(x => x.sessionId !== self.sessionId))
    if (e.tool === 'set_session_title' && t) t.title = String(e.args.title)
    if (e.tool === 'set_pinned' && t) t.pinned = Boolean(e.args.pinned)
    if (e.tool === 'send_message') {
      if (opts.sendFails) return { value: { content: [{ type: 'text' as const, text: opts.sendFails }], isError: true } }
      // a delivered message starts a turn there, which is activity
      if (t) t.lastActivityAt = new Date(clock.now()).toISOString()
      return text(`Message delivered to session ${id}; its turn has started on it. (delivery: delivered; message_id: m1)`)
    }
    return text('ok')
  })
  on('http.fetch', (_$, e) => {
    fetched.push(e.url)
    const body = e.url.includes('/reply-package') ? { markdown: '## Acme Roofing\n\n1. What the client sent' } : theFeed
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  // A pretend disk: the tracker token, and whatever record files a test puts under the app's data folder.
  const files = opts.files ?? {}
  const reads: string[] = []
  const lists: string[] = []
  const written: Array<{ path: string; text: string }> = []
  // These tests run on a POSIX host, where the engine reads `C:\\Users\\...` as a relative path and puts the
  // working directory in front of it. On Windows it is absolute as written, so the pretend disk drops that.
  const asGiven = (path: string) => path.replace(/^.*\/(?=[A-Za-z]:\\)/, '')
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude/mm-hooks/token')) return { value: 'fixture-token-not-a-real-one' }
    const path = asGiven(e.path)
    reads.push(path)
    const file = files[path]
    return file ? { value: file.text } : { deny: `ENOENT: no such file or directory, open '${path}'` }
  })
  on('fs.list', (_$, e) => {
    const dir = asGiven(e.path)
    lists.push(dir)
    const sep = dir.includes('\\') ? '\\' : '/'
    const under = dir + sep
    const entries = new Map<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [path, file] of Object.entries(files)) {
      if (!path.startsWith(under)) continue
      const [name = '', ...deeper] = path.slice(under.length).split(sep)
      entries.set(name, deeper.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false })
    }
    return entries.size ? { value: [...entries.values()] } : { deny: `ENOENT: no such file or directory, scandir '${dir}'` }
  })
  on('fs.write', (_$, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.id', () => ({ value: SELF_CLI }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    registered.push(String(e.description ?? ''))
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => {
    registered.push(String(e.description ?? ''))
    return { value: { tool: `mcp__mm-bridge__${e.name}` } }
  })
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true as const } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    prompts.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })

  /** What a sync must never call: a message into a thread, or a chip. */
  const acted = () => calls.filter(c => c.tool === 'send_message' || c.tool === 'spawn_task')
  return {
    clock, stored, threads, calls, prompts, opened, toasts, fetched, registered, acted, reads, lists, written,
    /** The app calls that change a thread: a rename, a pin, a message, a chip. */
    writes: () => calls.filter(c => !['get_session', 'list_sessions'].includes(c.tool)).map(c => [c.tool, c.args.session_id ?? '', c.args.title ?? c.args.pinned ?? ''].join(' | ')),
    setFeed: (f: Feed) => {
      theFeed = f
    },
  }
}

const PANE = { title: 'Needs you', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const COMPOSER = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

const mm = async ($: Engine, args: string): Promise<string> => String((await $.command.run({ command: 'mm', args, ...COMPOSER })).text ?? '')
const pane = ($: Engine) => $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-queue', props: PANE })
type Drawing = { findAll: (query: { type?: string }) => Promise<FoundElement[]> }
/** Every text the pane draws, top to bottom. */
const lines = async (ui: Drawing): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const buttons = async (ui: Drawing): Promise<Array<[string, string]>> => (await ui.findAll({ type: 'Button' })).map(b => [String(b.key), String(b.props.label)])

const ACME_TITLE = '🟡 Acme Roofing · reply ready due tomorrow 8 AM'
const BOLT_TITLE = '🟡 Bolt Staffing · reply due tomorrow 9 AM · 2 new'
const CEDAR_TITLE = '🔴 Cedar Dental · task due 4 PM'
const ACME_KICKOFF = `[mm-link ${ACME}] Pick up the reply drafts for Acme Roofing — Pat (OW project ${ACME}). Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package aaaaaaaa and wait for me. Send nothing without my go.`
const BOLT_KICKOFF = `[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the five-part pickup view and wait for me. Send nothing without my go.`

/** The pairs two sessions wrote about themselves: Claude Code session id → the app thread it runs in. */
const PAIRS = { 'cli-acme': { app: 'local_a', at: NOW }, 'cli-bolt': { app: 'local_b', at: NOW } }
const declared = (projectId: string, sessionId: string, hoursAgo: number) => ({ project_id: projectId, session_id: sessionId, last_activity_at: ago(hoursAgo) })

describe('R1: existing threads link themselves', () => {
  test('a thread whose session declared the client is linked, pinned and named, and nothing is sent or started', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_x', 'Something else', 2)],
      store: { 'mm.threads': PAIRS },
    })
    expect(await mm($, '')).toBe('3 clients need you; 1 thread pinned. The list is in the side pane.')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.writes()).toEqual([`set_session_title | local_a | ${ACME_TITLE}`, 'set_pinned | local_a | true'])
    expect(w.stored['mm.pins']).toEqual({ local_a: { projectId: ACME, client: 'Acme Roofing', byUs: true } })
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('a title that looks like the client is never linked: it is offered on the row', async ($, on) => {
    const w = world(on, { threads: [thread('local_t', 'Bolt Staffing: invoice question', 400)] })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
    expect(w.writes()).toEqual([])
    const ui = await pane($)
    expect(await lines(ui)).toContain('2 messages waiting · Update thread: "Bolt Staffing: invoice question" looks like this client')
    await ui.unmount()
  })

  test('a feed with no threads field behaves as before: only a thread linked by hand is pinned', async ($, on) => {
    const w = world(on, {
      threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Hand-linked', 50)],
      store: { 'mm.threads': PAIRS, 'mm.links': { [BOLT]: 'local_b' } },
    })
    expect(feed().threads).toBeUndefined()
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_b' })
    expect(w.writes()).toEqual([`set_session_title | local_b | ${BOLT_TITLE}`, 'set_pinned | local_b | true'])
    expect(w.acted()).toEqual([])
  })

  test('every session writes down its own pair, so the session that syncs can match it', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.threads']).toEqual({ [SELF_CLI]: { app: SELF, at: NOW + 4_000 } })
  })

  test('the timer links this thread to the client its own session declared, and calls no message or chip tool', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, SELF_CLI, 1), declared(BOLT, 'cli-bolt', 20)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.threads': PAIRS } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await w.clock.advance(5 * 60_000)
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF, [BOLT]: 'local_b' })
    expect(w.threads.get(SELF)?.title).toBe(ACME_TITLE)
    expect(w.threads.get('local_b')?.pinned).toBe(true)
    expect(w.fetched.filter(u => u.includes('/closeout')).length).toBeGreaterThan(0)
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('the same cap of 8 and "only unpin what we pinned" as a thread linked by hand', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30, { pinned: true })],
      store: { 'mm.threads': PAIRS },
    })
    await mm($, '')
    // already pinned by the person: named, and remembered as theirs
    expect(w.writes()).toEqual([`set_session_title | local_a | ${ACME_TITLE}`])
    expect(w.stored['mm.pins']).toEqual({ local_a: { projectId: ACME, client: 'Acme Roofing', byUs: false } })
    // the client stops needing the person: the name says so, and the person's own pin stays
    w.setFeed(feed({ drafts: [], threads: [declared(ACME, 'cli-acme', 30)] }))
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ pinned: true, title: '✓ Acme Roofing · clear 11 AM' })
  })
})

describe('unlinking is final for linking by itself, and the thread gets its own name back', () => {
  const linkedHere = (on: On) =>
    world(on, { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), self: thread(SELF, 'My roof thread', 1), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } } })

  test('/mm unlink: the thread is unpinned, renamed back, and never links itself again', async ($, on) => {
    const w = linkedHere(on)
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(w.stored['mm.titles']).toEqual({ [SELF]: 'My roof thread' })
    expect(w.threads.get(SELF)).toMatchObject({ title: ACME_TITLE, pinned: true })

    expect(await mm($, 'unlink')).toBe('This thread is no longer linked to a client.')
    expect(w.threads.get(SELF)).toMatchObject({ title: 'My roof thread', pinned: false })
    expect(w.stored['mm.titles']).toEqual({})
    expect(w.stored['mm.unlinked']).toEqual({ [SELF]: NOW })

    const before = w.writes().length
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
    expect(w.writes().length).toBe(before)
    expect(w.threads.get(SELF)?.title).toBe('My roof thread')
  })

  test('an older copy of the links written back after the unlink does not bring the link back', async ($, on) => {
    const w = linkedHere(on)
    await mm($, '')
    await mm($, 'unlink')
    // what a sync in another thread, begun before the unlink, would write
    w.stored['mm.links'] = { [ACME]: SELF }
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
    expect(w.threads.get(SELF)).toMatchObject({ title: 'My roof thread', pinned: false })
  })

  test('linking it by hand again clears that: /mm link', async ($, on) => {
    const w = linkedHere(on)
    await mm($, '')
    await mm($, 'unlink')
    expect(await mm($, 'link Acme Roofing')).toBe('This thread is now Acme Roofing\'s. Showing Acme Roofing in the side pane.')
    expect(w.stored['mm.unlinked']).toEqual({})
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    // a rename by hand keeps the thread's own name too, and the next unlink gives it back
    expect(w.threads.get(SELF)?.title).toBe(ACME_TITLE)
    expect(w.stored['mm.titles']).toEqual({ [SELF]: 'My roof thread' })
    // and from then on it links itself like any other thread
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    await mm($, 'unlink')
    expect(w.threads.get(SELF)).toMatchObject({ title: 'My roof thread', pinned: false })
  })

  test('pressing Update on its row clears it too', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30)],
      store: { 'mm.threads': PAIRS, 'mm.unlinked': { local_a: NOW - HOUR, local_other: NOW - HOUR } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
    const ui = await pane($)
    // not linked by itself, but still this client's thread: the row offers it
    expect(await lines(ui)).toContain('drafts ready · Update thread: thread from Sun, Oct 11 exists')
    await ui.press({ key: `update:${ACME}` })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.stored['mm.unlinked']).toEqual({ local_other: NOW - HOUR })
    await ui.unmount()
  })

  test('the name kept is the one from before the FIRST rename, and one of our own names is never kept', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, SELF_CLI, 1), declared(BOLT, 'cli-bolt', 20)] }),
      self: thread(SELF, 'A newer name', 1),
      threads: [thread('local_b', '✓ Bolt Staffing · clear 9 AM', 20)],
      store: { 'mm.threads': { ...PAIRS, [SELF_CLI]: { app: SELF, at: NOW } }, 'mm.titles': { [SELF]: 'The original name' } },
    })
    await mm($, '')
    expect(w.threads.get(SELF)?.title).toBe(ACME_TITLE)
    expect(w.threads.get('local_b')?.title).toBe(BOLT_TITLE)
    expect(w.stored['mm.titles']).toEqual({ [SELF]: 'The original name' })
    await mm($, 'unlink')
    expect(w.threads.get(SELF)?.title).toBe('The original name')
  })
})

describe('R3: the buttons on each row', () => {
  const twoThreads = (on: On, over: Parameters<typeof world>[1] = {}) =>
    world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_t', 'Bolt Staffing: invoice question', 400)],
      store: { 'mm.threads': PAIRS },
      ...over,
    })

  test('each row draws its recommendation and its buttons, the recommended one first, on every surface', async ($, on) => {
    twoThreads(on)
    await mm($, '')
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      expect(await lines(ui)).toEqual([
        'Needs you now (3)',
        `1. ${CEDAR_TITLE}`,
        '1 task due · Start thread: no thread yet',
        `2. ${ACME_TITLE}`,
        'drafts ready · Update thread: thread from Sun, Oct 11 exists',
        `3. ${BOLT_TITLE}`,
        '2 messages waiting · Update thread: "Bolt Staffing: invoice question" looks like this client',
        `Updated 15:00 UTC for ${ME}. ${PANE_SENTENCE}`,
      ])
      expect(await buttons(ui)).toEqual([
        [`start:${CEDAR}`, 'Start thread'], [`drafts:${CEDAR}`, 'Drafts'],
        [`update:${ACME}`, 'Update thread'], [`start:${ACME}`, 'Start thread'], [`drafts:${ACME}`, 'Drafts'],
        [`update:${BOLT}`, 'Update thread'], [`start:${BOLT}`, 'Start thread'], [`drafts:${BOLT}`, 'Drafts'],
      ])
      expect((await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary').map(b => b.key)).toEqual([`start:${CEDAR}`, `update:${ACME}`, `update:${BOLT}`])
      await ui.unmount()
    }
  })

  test('Update thread: the thread is linked, pinned and named, then gets the kickoff as a message', async ($, on) => {
    const w = twoThreads(on)
    await mm($, '')
    const ui = await pane($)
    const before = w.calls.length
    await ui.press({ key: `update:${ACME}` })
    const made = w.calls.slice(before).filter(c => !['get_session', 'list_sessions'].includes(c.tool))
    expect(made).toEqual([
      { server: 'ccd_session_mgmt', tool: 'send_message', args: { session_id: 'local_a', message: `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}` } },
    ])
    expect(w.threads.get('local_a')).toMatchObject({ title: ACME_TITLE, pinned: true })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    const said = `Sent to Acme Roofing's thread: open "${ACME_TITLE}" under Pinned.`
    expect(await lines(ui)).toContain(said)
    expect(w.toasts).toEqual([said])
    expect(w.calls.filter(c => c.tool === 'spawn_task')).toEqual([])
    expect(w.calls.some(c => c.server === 'ccd_window')).toBe(false)
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('Update thread on a title suggestion links that thread by the person\'s press, then sends', async ($, on) => {
    const w = twoThreads(on)
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${BOLT}` })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a', [BOLT]: 'local_t' })
    expect(w.stored['mm.titles']).toEqual({ local_a: 'Roof quote', local_t: 'Bolt Staffing: invoice question' })
    expect(w.threads.get('local_t')).toMatchObject({ title: BOLT_TITLE, pinned: true })
    expect(w.acted()).toEqual([
      { server: 'ccd_session_mgmt', tool: 'send_message', args: { session_id: 'local_t', message: `New since this thread last worked on this client: 2 messages waiting.\n${BOLT_KICKOFF}` } },
    ])
    expect(await lines(ui)).toContain(`Sent to Bolt Staffing's thread: open "${BOLT_TITLE}" under Pinned.`)
    await ui.unmount()
  })

  test('Update thread from inside the client\'s own thread: the kickoff goes in here as the person\'s prompt', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } } })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([
      { text: `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } },
    ])
    expect(await lines(ui)).toContain('Picking up Acme Roofing in this thread.')
    expect(w.toasts).toEqual(['Picking up Acme Roofing in this thread.'])
    // linked, pinned and named like any other Update
    expect(w.threads.get(SELF)).toMatchObject({ title: ACME_TITLE, pinned: true })
    await ui.unmount()
  })

  test('Update thread when the app refuses the message: it says so, and says why', async ($, on) => {
    const w = twoThreads(on, { sendFails: 'Session local_a is archived.' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    expect(await lines(ui)).toContain('Could not send to Acme Roofing\'s thread: Session local_a is archived.')
    expect(w.toasts).toEqual(['Could not send to Acme Roofing\'s thread: Session local_a is archived.'])
    await ui.unmount()
  })

  test('a thread the person acted on stays pinned: nine clients, Update on the ninth, and the cap unpins a thread that linked itself instead', async ($, on) => {
    // Nine clients, each with a thread that links itself. Client n is due n hours from now, so the ninth is last in line.
    const ids = Array.from({ length: 9 }, (_, i) => `4444444${i}-4444-4444-4444-444444444444`)
    const w = world(on, {
      feed: feed({
        drafts: [],
        mail: [],
        tickets: { due_today: ids.map((id, i) => ({ ticket_id: `t${i}`, project_id: id, project_name: `Client ${i}`, title: 'Do it', due_at: new Date(NOW + (i + 1) * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME })) },
        threads: ids.map((id, i) => declared(id, `cli-${i}`, 10 + i)),
      }),
      threads: ids.map((_, i) => thread(`local_${i}`, `Thread ${i}`, 10 + i)),
      store: { 'mm.threads': Object.fromEntries(ids.map((_, i) => [`cli-${i}`, { app: `local_${i}`, at: NOW }])) },
    })
    const pinned = () => ids.map((_, i) => (w.threads.get(`local_${i}`)?.pinned ? i : -1)).filter(i => i >= 0)

    expect(await mm($, '')).toBe('9 clients need you; 8 threads pinned. The list is in the side pane.')
    expect(Object.keys(w.stored['mm.links'] as object)).toHaveLength(9)
    expect(pinned()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(w.threads.get('local_8')).toMatchObject({ title: 'Thread 8', pinned: false })

    const ui = await pane($)
    expect((await lines(ui))[0]).toBe('Needs you now (9, the first 8 pin)')
    await ui.press({ key: `update:${ids[8]}` })
    // the ninth is pinned and named; the eighth, which only linked itself, gave up its place
    expect(pinned()).toEqual([0, 1, 2, 3, 4, 5, 6, 8])
    expect(w.threads.get('local_8')).toMatchObject({ title: '🔴 Client 8 · task due 8 PM', pinned: true })
    expect(w.acted().map(c => c.args.session_id)).toEqual(['local_8'])
    expect(w.stored['mm.acted']).toEqual({ [ids[8] as string]: { sid: 'local_8', at: NOW } })
    await ui.unmount()

    // the next sync keeps it that way
    await w.clock.advance(6 * 60_000)
    expect(await mm($, '')).toBe('9 clients need you; 8 threads pinned. The list is in the side pane.')
    expect(pinned()).toEqual([0, 1, 2, 3, 4, 5, 6, 8])
    // still its own name on the eighth: the bridge unpinned it, it did not unlink it
    expect((w.stored['mm.links'] as Record<string, string>)[ids[7] as string]).toBe('local_7')

    // a day later the press no longer holds the place: the cap goes back to the soonest eight
    await w.clock.advance(24 * HOUR)
    await mm($, '')
    expect(pinned()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  test('/mm link stamps this thread the same way, and a chip the person started stamps the thread it opens', async ($, on) => {
    const w = world(on)
    expect(await mm($, 'link Bolt Staffing')).toBe('This thread is now Bolt Staffing\'s. Showing Bolt Staffing in the side pane.')
    expect(w.stored['mm.acted']).toEqual({ [BOLT]: { sid: SELF, at: NOW } })
    await $.prompt.submit({ text: ACME_KICKOFF, wait: false, origin: { kind: 'composer' } })
    expect(w.stored['mm.acted']).toEqual({ [BOLT]: { sid: SELF, at: NOW }, [ACME]: { sid: SELF, at: NOW } })
  })

  test('Start thread: a chip whose prompt is the kickoff, and the person clicks Start', async ($, on) => {
    const w = twoThreads(on)
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${BOLT}` })
    expect(w.acted()).toEqual([
      {
        server: 'ccd_session', tool: 'spawn_task',
        args: {
          title: 'Bolt Staffing: reply to the client',
          tldr: 'Bolt Staffing needs you: Bolt Staffing · reply due tomorrow 9 AM · 2 new. Start this to open a thread for that client with the drafts or the messages waiting.',
          prompt: BOLT_KICKOFF,
        },
      },
    ])
    expect(await lines(ui)).toContain('A chip for Bolt Staffing is ready: click Start.')
    // nothing about the title-suggested thread changed: Start links and pins nothing
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.threads.get('local_t')).toMatchObject({ title: 'Bolt Staffing: invoice question', pinned: false })
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('Drafts: the five-part view in the side pane, and nothing linked, pinned, sent or started', async ($, on) => {
    const w = twoThreads(on)
    await mm($, '')
    const ui = await pane($)
    const before = { calls: w.calls.length, links: JSON.stringify(w.stored['mm.links']), opened: w.opened.length }
    await ui.press({ key: `drafts:${ACME}` })
    expect(w.calls.length).toBe(before.calls)
    expect(JSON.stringify(w.stored['mm.links'])).toBe(before.links)
    expect(w.opened.slice(before.opened)).toEqual([{ id: 'mm-view', title: 'Acme Roofing' }])
    expect(w.fetched.at(-1)).toBe(`https://onboarding-wizard.massmarket.ai/api/ext/reply-package?package_id=${PKG}&format=pickup`)
    const view = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-view', props: { ...PANE, title: 'Acme Roofing' } })
    expect((await view.find({ type: 'Markdown' }))?.text).toBe('## Acme Roofing\n\n1. What the client sent')
    await view.unmount()

    // a client with no package shows what is waiting instead
    await ui.press({ key: `drafts:${BOLT}` })
    const second = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-view', props: { ...PANE, title: 'Bolt Staffing' } })
    expect((await second.find({ type: 'Markdown' }))?.text).toContain('### Waiting on our reply')
    await second.unmount()
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('only the bridge\'s own host is ever fetched, and the token goes nowhere else', async ($, on) => {
    const w = twoThreads(on)
    await mm($, '')
    const ui = await pane($)
    for (const key of [`update:${ACME}`, `start:${BOLT}`, `drafts:${ACME}`]) await ui.press({ key })
    await ui.unmount()
    expect(w.fetched.every(u => u.startsWith('https://onboarding-wizard.massmarket.ai/api/ext/'))).toBe(true)
    expect(JSON.stringify(w.calls)).not.toContain('fixture-token')
    expect(JSON.stringify(w.prompts) + w.toasts.join(' ')).not.toContain('fixture-token')
  })
})

describe('R6: the commands', () => {
  test('/mm update <client> does what the button does', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS } })
    expect(await mm($, 'update acme roofing')).toBe(`Sent to Acme Roofing's thread: open "${ACME_TITLE}" under Pinned.`)
    expect(w.acted()).toEqual([
      { server: 'ccd_session_mgmt', tool: 'send_message', args: { session_id: 'local_a', message: `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}` } },
    ])
    expect(w.threads.get('local_a')).toMatchObject({ title: ACME_TITLE, pinned: true })
  })

  test('/mm update on a client with no thread, and on nobody', async ($, on) => {
    const w = world(on)
    expect(await mm($, 'update Cedar Dental')).toBe('No thread for Cedar Dental yet: use /mm start Cedar Dental.')
    expect(await mm($, 'update Nobody Inc')).toBe('No client matching "Nobody Inc" needs you right now. /mm shows who does.')
    expect(w.acted()).toEqual([])
  })

  test('/mm start <client> mints the same chip, with the same kickoff', async ($, on) => {
    const w = world(on)
    expect(await mm($, 'start Acme Roofing')).toBe('A chip for Acme Roofing is ready: click Start.')
    expect(w.acted().map(c => [c.tool, c.args.title, c.args.prompt])).toEqual([['spawn_task', 'Acme Roofing: review the reply drafts', ACME_KICKOFF]])
  })

  test('the chip\'s first message links the new thread to the client', async ($, on) => {
    const w = world(on)
    await $.prompt.submit({ text: ACME_KICKOFF, wait: false, origin: { kind: 'composer' } })
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
  })

  test('the command and the tool both list update <client>, and the old verbs are still there', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    expect(w.registered.length).toBe(2)
    expect(w.registered[0]).toBe('Massmarket: /mm (what needs you) · /mm link <client> · /mm update <client> · /mm start <client> · /mm view · /mm unlink · /mm status · /mm pause|resume')
    for (const verb of ['"update <client>"', '"start <client>"', '"link <client>"', '"view"', '"unlink"', '"status"', '"pause"', '"resume"']) expect(w.registered[1]).toContain(verb)
    expect(await mm($, 'pause')).toBe('Paused on this computer: no pins or renames until /mm resume.')
    expect(await mm($, 'resume')).toBe('Resumed.')
    expect(await mm($, 'status')).toContain(`this thread: ${SELF}`)
    expect(await mm($, 'view')).toBe('This thread is not linked to a client. Use /mm link <client>.')
  })
})

describe('the app\'s own thread records: a thread links itself without being opened again first', () => {
  const MARK = 'RECORD-FIELD-DO-NOT-KEEP'
  /** A record as the app writes one: the two fields the bridge takes, among others it must never keep. */
  const record = (app: string, cli: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ sessionId: app, cliSessionId: cli, title: `${MARK} title`, cwd: `/${MARK}/path`, model: MARK, previousTitles: [MARK], ...extra })
  const recent = NOW - HOUR

  const PLATFORMS = [
    ['macOS', { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/Users/someone' }, '/Users/someone/Library/Application Support/Claude/claude-code-sessions', '/'],
    ['Windows', { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', USERPROFILE: 'C:\\Users\\someone', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' }, 'C:\\Users\\someone\\AppData\\Roaming\\Claude\\claude-code-sessions', '\\'],
    ['Linux', { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone' }, '/home/someone/.config/Claude/claude-code-sessions', '/'],
  ] as const

  for (const [platform, env, root, sep] of PLATFORMS) {
    test(`${platform}: the pair comes from ${root}, and only the thread id and the session id are taken`, async ($, on) => {
      const path = [root, 'account-1', 'org-1', 'local_a.json'].join(sep)
      const w = world(on, {
        env,
        feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
        threads: [thread('local_a', 'Roof quote', 30)],
        // ⛔ nothing in the store: this thread has not run since the plugin was installed
        files: { [path]: { text: record('local_a', 'cli-acme'), mtimeMs: recent } },
      })
      await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
      await w.clock.advance(4_000)
      expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
      expect(w.threads.get('local_a')).toMatchObject({ title: ACME_TITLE, pinned: true })
      expect(w.reads).toEqual([path])
      // nothing else of the record is kept, logged or sent anywhere
      const everything = JSON.stringify([w.stored, w.calls, w.written, w.fetched, w.prompts, w.toasts])
      expect(everything).not.toContain(MARK)
      expect(w.fetched.every(u => u.startsWith('https://onboarding-wizard.massmarket.ai/api/ext/'))).toBe(true)
      expect(w.fetched.join(' ')).not.toContain('cli-acme')
      // the heartbeat says how many pairs the records gave: a number, nothing from them
      expect(JSON.parse(w.written.at(-1)?.text ?? '{}')).toMatchObject({ appPairs: 1 })
      expect(w.acted()).toEqual([])
    })
  }

  const ROOT = '/home/someone/Library/Application Support/Claude/claude-code-sessions'
  const at = (name: string) => `${ROOT}/account-1/org-1/${name}`

  test('a record that cannot be read as one gives no pair, and the others still do', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30), declared(BOLT, 'cli-bolt', 20), declared(CEDAR, 'cli-cedar', 10)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Staffing plan', 20), thread('local_c', 'Intake', 10), thread('local_d', 'Other', 5)],
      files: {
        [at('local_a.json')]: { text: '{ this is not JSON', mtimeMs: recent },
        // a different shape: the session id is not text
        [at('local_b.json')]: { text: JSON.stringify({ sessionId: 'local_b', cliSessionId: 42 }), mtimeMs: recent },
        // a record that says it is another thread's
        [at('local_d.json')]: { text: record('local_zzz', 'cli-cedar'), mtimeMs: recent },
        [at('local_c.json')]: { text: record('local_c', 'cli-cedar'), mtimeMs: recent },
        [at('notes.txt')]: { text: 'not a record', mtimeMs: recent },
      },
    })
    expect(await mm($, '')).toBe('3 clients need you; 1 thread pinned. The list is in the side pane.')
    expect(w.stored['mm.links']).toEqual({ [CEDAR]: 'local_c' })
    expect(w.reads).not.toContain(at('notes.txt'))
    // a record that gave no pair is not opened again until it changes
    const opened = w.reads.length
    await mm($, '')
    expect(w.reads.length).toBe(opened)
  })

  test('two records name one session: the more recently modified thread has it', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'A fork of it', 2)],
      files: {
        [at('local_b.json')]: { text: record('local_b', 'cli-acme'), mtimeMs: recent },
        [at('local_a.json')]: { text: record('local_a', 'cli-acme'), mtimeMs: recent - 5 * HOUR },
      },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_b' })
  })

  test('no such folder: what each session wrote down about itself is the only source, as before', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS } })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.reads).toEqual([])
    expect(w.lists.length).toBeGreaterThan(0)
  })

  test('the app\'s record and a stored pair disagree: the app\'s record wins', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Staffing plan', 20)],
      // the store says this session runs in local_b; the app's own record says local_a
      store: { 'mm.threads': { 'cli-acme': { app: 'local_b', at: NOW } } },
      files: { [at('local_a.json')]: { text: record('local_a', 'cli-acme'), mtimeMs: recent } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    // the store's own copy is left as the session wrote it
    expect(w.stored['mm.threads']).toEqual({ 'cli-acme': { app: 'local_b', at: NOW } })
  })

  test('a record not modified in 30 days is not opened', async ($, on) => {
    const DAY = 24 * HOUR
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30), declared(BOLT, 'cli-bolt', 20)] }),
      threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Staffing plan', 20)],
      files: {
        [at('local_a.json')]: { text: record('local_a', 'cli-acme'), mtimeMs: NOW - 31 * DAY },
        [at('local_b.json')]: { text: record('local_b', 'cli-bolt'), mtimeMs: NOW - 29 * DAY },
      },
    })
    await mm($, '')
    expect(w.reads).toEqual([at('local_b.json')])
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_b' })
  })

  test('one scan per sync, and a record that has not changed is not read again', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }),
      threads: [thread('local_a', 'Roof quote', 30)],
      files: { [at('local_a.json')]: { text: record('local_a', 'cli-acme'), mtimeMs: recent } },
    })
    const scans = () => w.lists.filter(p => p === ROOT).length
    await mm($, '')
    expect(scans()).toBe(1)
    expect(w.reads).toEqual([at('local_a.json')])
    // Update runs two passes over the feed (before and after linking) and scans once
    await mm($, 'update Acme Roofing')
    expect(scans()).toBe(2)
    expect(w.reads).toEqual([at('local_a.json')])
    // nothing is ever written under the app's folder
    expect(w.written.filter(f => f.path.includes('claude-code-sessions'))).toEqual([])
  })
})

describe('/mm in a terminal session, where the app\'s thread list is not there', () => {
  const STORE = {
    'mm.links': { [ACME]: 'local_a', [BOLT]: 'local_b' },
    'mm.pins': { local_a: { projectId: ACME, client: 'Acme Roofing', byUs: true } },
    'mm.unlinked': { local_x: NOW - HOUR },
    'mm.titles': { local_a: 'Roof quote' },
    'mm.threads': PAIRS,
  }

  test('it shows the list and leaves every stored link, unlink record, pin and title as they were', async ($, on) => {
    const w = world(on, { terminal: true, store: STORE, feed: feed({ threads: [declared(CEDAR, 'cli-acme', 3)] }) })
    expect(await mm($, '')).toContain('3 clients need you')
    for (const key of ['mm.links', 'mm.pins', 'mm.unlinked', 'mm.titles', 'mm.threads'] as const) expect(w.stored[key], key).toEqual(STORE[key])
    expect(w.calls).toEqual([])
    expect(await mm($, 'status')).toContain('linked threads: 2')
  })
})
