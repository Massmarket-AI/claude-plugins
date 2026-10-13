// A pretend desktop app for tests of the bridge's own hooks, without the engine's `$`: one app, one store,
// one clock, and a `$` for each thread, as each desktop thread is a process of its own with its own copy of
// the bridge (sessions.test.ts). The store keeps what the engine keeps: a get reads it as it is now, and a
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
 */
export function fakeApp(feed: Feed, threads: Array<Partial<FakeThread> & { sessionId: string }>, unlisted: readonly string[] = []) {
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
          if (tool === 'set_pinned' && t) t.pinned = Boolean(args.pinned)
          if (tool === 'get_usage') return text({ context: { status: 'unavailable' } })
          if (tool === 'spawn_task') return text(`Noted (task_id: task_${String(calls.filter(c => c.tool === 'spawn_task').length).padStart(8, '0')}).`)
          if (tool === 'send_message') return text(`Message delivered to session ${id}.`)
          return text('ok')
        },
      },
      env: { get: async (name: string) => ({ CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone' })[name] },
      fs: {
        read: async (path: string) => {
          if (path.endsWith('/.claude/mm-hooks/token')) return 'fixture-token-not-a-real-one'
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
        every: () => ({ cancel: () => undefined }),
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
      ui: { status: () => undefined, toast: () => undefined, open: async () => ({ isPlaced: true }), scroll: async () => undefined },
      process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
      command: { register: async () => ({ command: 'mm' }) },
      tool: { register: async () => ({ tool: 'mcp__mm-bridge__mm' }) },
      prompt: { submit: async () => ({}) },
    }
  }

  return {
    app,
    calls,
    appends,
    written,
    fetched,
    session,
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
/** The `mm` tool, as Claude calls it. */
export const tool = async ($: unknown, args: string): Promise<string> =>
  String(((await hooks['tool.call:mcp__mm-bridge__mm']?.($, { tool: 'mcp__mm-bridge__mm', args }, next)) as { result?: unknown } | undefined)?.result ?? '')
