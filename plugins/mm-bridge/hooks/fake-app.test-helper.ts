// TESTS ONLY: imported by sessions.test.ts, never by the hooks module (hooks.json loads register.tsx alone).
// A pretend desktop app for tests of the bridge's own hooks, without the engine's `$`: one app, one store,
// one clock, and a `$` for each thread, as each desktop thread is a process of its own with its own copy of
// the bridge. The store keeps what the engine keeps: a get reads it as it is now, and a
// set writes one key whole; a set can be refused, as the engine refuses one it cannot lock in time. Nothing
// here reaches a real thread, the feed or the store on disk, and every client is made up.

import type { On } from 'claude-code'

import type { Feed } from './queue'
import { register } from './register'

/** Tuesday 2026-10-13, 9 AM in New York. */
export const NOW = Date.parse('2026-10-13T13:00:00Z')
export const HOUR = 3_600_000
export const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()
export const ME = 'owner@example.com'
/** A made-up project id: `0000000n-0000-4000-8000-00000000000n`. */
export const pid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

export type FakeThread = { sessionId: string; title: string; pinned: boolean; isArchived: boolean; lastActivityAt: string }
type Hook = ($: unknown, e: Record<string, unknown>, next: (e: unknown) => unknown) => Promise<unknown>
type Mcp = { content: Array<{ type: 'text'; text: string }>; isError: boolean }

/** The bridge's hooks as the engine holds them: by event, and by command or tool where the hook names one. */
function hooksOf(): Record<string, Hook> {
  const found: Record<string, Hook> = {}
  const on = (event: string, a: unknown, b?: unknown) => {
    const matcher = typeof a === 'function' ? undefined : (a as Record<string, string>)
    const hook = (typeof a === 'function' ? a : b) as Hook
    found[matcher?.command ? `${event}:${matcher.command}` : matcher?.tool ? `${event}:${matcher.tool}` : matcher ? `${event}:${JSON.stringify(matcher)}` : event] = hook
    return { catch: () => undefined }
  }
  register(on as unknown as On, {} as never)
  return found
}

export const hooks = hooksOf()
export const next = (e: unknown) => e

/**
 * The app and its store. `threads` are the app's open threads; `unlisted` ones are open but left out of its
 * list (asked for by id). Each thread's `$` has a session id of its own, `cli:<thread>`.
 * `every`: the clock's repeating timers run too (a session's minute tick and its 15-second chips pass); left
 * out, only its one-off timers do, as before.
 */
export function fakeApp(feed: Feed, threads: Array<Partial<FakeThread> & { sessionId: string }>, unlisted: readonly string[] = [], opts: { every?: boolean; tools?: 'spawn' | 'start' | 'both' } = {}) {
  /** (0.5.7) The session tools as the engine lists them; left out, the listing names neither, as before 0.5.7. */
  const toolNames = opts.tools
    ? [...(opts.tools !== 'start' ? ['mcp__ccd_session__spawn_task'] : []), ...(opts.tools !== 'spawn' ? ['mcp__ccd_session__start_session'] : []), 'mcp__ccd_session__dismiss_task']
    : []
  let started = 0
  const stored: Record<string, string> = {}
  /** Sets of `key` refused next: `skip` sets first go through, then `times` are refused. */
  const refusing = { key: '', times: 0, skip: 0 }
  let time = NOW
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = []
  const app = new Map<string, FakeThread>()
  for (const t of threads) app.set(t.sessionId, { title: t.sessionId, pinned: false, isArchived: false, lastActivityAt: ago(1), ...t })
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
  /** What the bridge added to each thread's transcript. */
  const appends: Array<{ thread: string; text: string }> = []
  /** Every file the bridge wrote (its heartbeat: where its errors go). */
  const written: Array<{ path: string; text: string }> = []
  const fetched: string[] = []
  /** Every pane a thread's bridge opened, in order. */
  const opened: Array<{ thread: string; id: string }> = []
  /** OW answers the closeout feed this long after it is asked (0: at once): a slow feed, on the fake clock. */
  let feedDelayMs = 0
  /** The closeout feed's HTTP status (200: it answers). */
  let feedStatus = 200
  /** Threads the app refuses to pin. */
  const failPins = new Set<string>()
  const text = (value: unknown): Mcp => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false })
  const views = new Map<string, Map<string, unknown>>()

  const session = (self: string) => {
    const state = new Map<string, unknown>()
    views.set(self, state)
    return {
      store: {
        get: async (key: string) => (stored[key] === undefined ? undefined : JSON.parse(stored[key] as string)),
        set: async (key: string, value: unknown) => {
          if (refusing.key === key && refusing.skip > 0) refusing.skip--
          else if (refusing.key === key && refusing.times > 0) {
            refusing.times--
            throw new Error('mm-bridge: $.store.set failed: Lock file is already being held')
          }
          stored[key] = JSON.stringify(value)
        },
        delete: async (key: string) => void delete stored[key],
        keys: async () => Object.keys(stored),
      },
      mcp: {
        call: async (_server: string, tool: string, args: Record<string, unknown>): Promise<Mcp> => {
          calls.push({ tool, args })
          const id = args.session_id === 'self' ? self : String(args.session_id ?? '')
          const t = app.get(id)
          if (tool === 'get_session') return t ? text(t) : { content: [{ type: 'text', text: `Session ${id} not found.` }], isError: true }
          if (tool === 'list_sessions') return text([...app.values()].filter(x => x.sessionId !== self && !x.isArchived && !unlisted.includes(x.sessionId)))
          if (tool === 'set_session_title' && t) t.title = String(args.title)
          if (tool === 'set_pinned' && failPins.has(id)) return { content: [{ type: 'text', text: 'set_pinned failed' }], isError: true }
          if (tool === 'set_pinned' && t) t.pinned = Boolean(args.pinned)
          if (tool === 'get_usage') return text({ context: { status: 'unavailable' } })
          // (0.5.7) a tool this session does not have, as the engine answers for one
          if ((opts.tools === 'start' && tool === 'spawn_task') || (opts.tools === 'spawn' && tool === 'start_session')) {
            throw new Error(`mm-bridge: $.mcp.call: no connected MCP tool "${tool}" on a server named "ccd_session"`)
          }
          if (tool === 'spawn_task') return text(`Noted (task_id: task_${String(calls.filter(c => c.tool === 'spawn_task').length).padStart(8, '0')}).`)
          // (0.5.7) as the app answers start_session (Claude.app, 10-14)
          if (tool === 'start_session' && args.initiation === 'own_initiative') return text(`Proposed "${String(args.title)}" (task_id: task_p${String(calls.length).padStart(7, '0')}). The user sees a card.`)
          if (tool === 'start_session') {
            const sid = `local_started_${++started}`
            app.set(sid, { sessionId: sid, title: String(args.title), pinned: false, isArchived: false, lastActivityAt: new Date(time).toISOString() })
            return text(`Started session "${String(args.title)}" (session_id: ${sid}, name: started-${started}). It runs on its own.`)
          }
          if (tool === 'send_message') return text(`Message delivered to session ${id}.`)
          return text('ok')
        },
      },
      env: { get: async (name: string) => ({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone' })[name] },
      fs: {
        read: async (path: string) => {
          if (path.endsWith('/.claude/mm-hooks/token')) return 'fixture-token-not-a-real-one'
          // (0.5.11, review of PR #15, F4) a time-tracking hook that counts the bridge's turns as automatic (0.11.7's rule)
          if (path.endsWith('/.claude/mm-hooks/worklog-hook.js')) return 'const HOOK_VERSION = "0.11.7";\nconst TURN_ORIGIN_MARKER_RE = /^\\[mm-link [0-9a-f-]{36}\\]/;\n'
          throw new Error(`ENOENT: no such file or directory, open '${path}'`)
        },
        list: async (path: string) => {
          throw new Error(`ENOENT: no such file or directory, scandir '${path}'`)
        },
        write: async (path: string, text: string) => void written.push({ path, text }),
      },
      http: {
        fetch: async (url: string) => {
          fetched.push(url)
          if (feedDelayMs > 0 && url.includes('/closeout')) await new Promise<void>(resolve => void timers.push({ at: time + feedDelayMs, fn: resolve, done: false }))
          if (feedStatus !== 200 && url.includes('/closeout')) return { status: feedStatus, ok: false, headers: {}, text: 'unavailable' }
          return { status: 200, ok: true, headers: {}, text: JSON.stringify(url.includes('/reply-package') ? { markdown: '## A client\n\n1. What the client sent' } : feed) }
        },
      },
      clock: {
        now: async () => time,
        after: (ms: number, fn: () => void) => {
          const timer = { at: time + ms, fn, done: false }
          timers.push(timer)
          return { cancel: () => void (timer.done = true) }
        },
        every: (ms: number, fn: () => void) => {
          if (!opts.every) return { cancel: () => undefined }
          let cancelled = false
          const fire = () => {
            if (cancelled) return
            timers.push({ at: time + ms, fn: fire, done: false })
            fn()
          }
          timers.push({ at: time + ms, fn: fire, done: false })
          return { cancel: () => void (cancelled = true) }
        },
      },
      session: {
        id: async () => `cli:${self}`,
        append: async (row: { message: { content: Array<{ text: string }> } }) => {
          appends.push({ thread: self, text: row.message.content.map(c => c.text).join('') })
          return {}
        },
      },
      state: {
        get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 1 }),
        set: async (ref: { key: string }, value: unknown) => {
          state.set(ref.key, value)
          return { isSet: true, version: 2 }
        },
      },
      ui: {
        resolve: () => ({ Box: 'Box', Button: 'Button', Markdown: 'Markdown', Text: 'Text' }),
        status: () => undefined,
        toast: () => undefined,
        open: async (spec: { id: string }) => {
          opened.push({ thread: self, id: spec.id })
          return { isPlaced: true }
        },
        scroll: async () => undefined,
      },
      process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      command: { register: async () => ({ command: 'mm' }) },
      tool: { register: async () => ({ tool: 'mcp__mm-bridge__mm' }), list: async () => toolNames.map(name => ({ name, description: name, mcp: true })) },
      prompt: { submit: async () => ({}) },
    }
  }

  return {
    app,
    calls,
    appends,
    written,
    fetched,
    opened,
    failPins,
    session,
    /** The fake clock now. */
    now: () => time,
    /** From now on OW answers the closeout feed `ms` after it is asked (0: at once). */
    delayFeed: (ms: number) => void (feedDelayMs = ms),
    /** From now on the closeout feed answers with this HTTP status (200: as normal). */
    feedAnswers: (status: number) => void (feedStatus = status),
    /** What a thread's pane holds: its Needs-you rows, by the state key the bridge writes. */
    view: (self: string, key: string) => views.get(self)?.get(key),
    stored: (key: string) => (stored[key] === undefined ? undefined : JSON.parse(stored[key] as string)),
    put: (key: string, value: unknown) => void (stored[key] = JSON.stringify(value)),
    refuse: (key: string, times: number, skip = 0) => void Object.assign(refusing, { key, times, skip }),
    /** Every message sent into a thread. */
    sends: () => calls.filter(c => c.tool === 'send_message'),
    /** Moves the clock on and runs the timers that fall due, in the order they fall due, each moment's work to its end. */
    advance: async (ms: number) => {
      const until = time + ms
      for (;;) {
        const due = timers.filter(t => !t.done && t.at <= until)
        if (!due.length) break
        const at = Math.min(...due.map(t => t.at))
        const now = due.filter(t => t.at === at)
        for (const t of now) t.done = true
        time = Math.max(time, at)
        await Promise.all(now.map(t => Promise.resolve().then(t.fn)))
        for (let i = 0; i < 2_000; i++) await Promise.resolve()
      }
      time = until
    },
  }
}

/** /mm as the person types it (or, with another `kind`, as anything else sends it). */
export const mm = async ($: unknown, args: string, kind = 'composer'): Promise<string> =>
  String(((await hooks['command.run:mm']?.($, { command: 'mm', args, origin: { kind } }, next)) as { text?: unknown } | undefined)?.text ?? '')
/**
 * The buttons a thread's Needs-you pane draws, by key, each with its own handler: the pane is drawn through
 * the bridge's own render hook. (The engine's elements carry the handler beside `props`, a plain JSX
 * factory inside them: both are read.)
 */
export async function paneButtons($: unknown): Promise<Map<string, () => void>> {
  return buttonsIn(await hooks['ui.render:{"component":"Pane","requestId":"mm-queue"}']?.($, { props: {} }, next))
}

/** The buttons the band above the prompt draws in a thread, by key, each with its own handler. */
export async function bandButtons($: unknown): Promise<Map<string, () => void>> {
  return buttonsIn(await hooks['ui.render:{"component":"AbovePrompt"}']?.($, { props: { hasSurvey: false } }, next))
}

function buttonsIn(tree: unknown): Map<string, () => void> {
  const found = new Map<string, () => void>()
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 40) return
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1)
      return
    }
    const o = node as { key?: unknown; props?: Record<string, unknown>; children?: unknown; onPress?: unknown }
    const key = o.props?.key ?? o.key
    const onPress = o.onPress ?? o.props?.onPress
    if (typeof key === 'string' && typeof onPress === 'function') found.set(key, onPress as () => void)
    walk(o.props?.children, depth + 1)
    walk(o.children, depth + 1)
  }
  walk(tree, 0)
  return found
}

/** Presses the pane's button with this key as the person does, then lets what it set going finish. False when the pane draws no such button. */
export async function press($: unknown, key: string): Promise<boolean> {
  const onPress = (await paneButtons($)).get(key)
  if (!onPress) return false
  onPress()
  for (let i = 0; i < 20_000; i++) await Promise.resolve()
  return true
}

/** The `mm` tool, as Claude calls it. */
export const tool = async ($: unknown, args: string): Promise<string> =>
  String(((await hooks['tool.call:mcp__mm-bridge__mm']?.($, { tool: 'mcp__mm-bridge__mm', args }, next)) as { result?: unknown } | undefined)?.result ?? '')
