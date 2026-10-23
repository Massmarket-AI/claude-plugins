import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { Feed } from './queue'
import { register } from './register'

// B1, 2026-10-13: Rob started fifteen chips within a minute or two. Ten of the new threads opened with a valid
// [mm-link] marker; two of those links never reached the store, though both projects were in the last feed.
//
// Every desktop thread is a process of its own, with its own copy of the bridge, and all of them share ONE
// store file. These tests run a dozen sessions of the bridge's own hooks, each with its own `$` (its own
// session id and thread), against one pretend store whose gets and sets interleave, with a sync running
// across them. The store keeps what the engine keeps: a get reads the file as it is now, and a set writes
// one key whole (the engine's own code, 2.1.295: a fresh read on every get, one key merged under a lock on
// every set). Nothing here reaches a real thread, the feed or the store on disk.

/** Tuesday 2026-10-13, 9 AM in New York. */
const NOW = Date.parse('2026-10-13T13:00:00Z')
const HOUR = 3_600_000
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()
const ME = 'owner@example.com'
const N = 12
/** The twelve clients the chips were for, and eight clients whose threads were linked before. */
const fresh = (n: number) => `0000${String(n).padStart(4, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
const older = (n: number) => `1111${String(n).padStart(4, '0')}-1111-4111-8111-${String(n).padStart(12, '0')}`
const NEW_THREAD = (n: number) => `local_new_${n}`
const OLD_THREAD = (n: number) => `local_old_${n}`
const KICKOFF = (n: number) => `[mm-link ${fresh(n)}] Pick up the reply drafts for Client ${n} (OW project ${fresh(n)}). Send nothing without my go.`

type Thread = { sessionId: string; title: string; pinned: boolean; isArchived: boolean; lastActivityAt: string }
type Hook = ($: unknown, e: Record<string, unknown>, next: (e: unknown) => unknown) => Promise<unknown>
type Mcp = { content: Array<{ type: 'text'; text: string }>; isError: boolean }

/** A small deterministic generator: the same seed, the same interleaving. */
function random(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0
    return s / 2 ** 32
  }
}

/** The bridge's hooks as the engine holds them, by event (and by command, for /mm). */
function hooksOf(): Record<string, Hook> {
  const found: Record<string, Hook> = {}
  const on = (event: string, a: unknown, b?: unknown) => {
    const matcher = typeof a === 'function' ? undefined : (a as Record<string, string>)
    const hook = (typeof a === 'function' ? a : b) as Hook
    found[matcher?.command ? `${event}:${matcher.command}` : matcher ? `${event}:${JSON.stringify(matcher)}` : event] = hook
    return { catch: () => undefined }
  }
  register(on as unknown as On, {} as never)
  return found
}

type WorldOptions = {
  seed: number
  /** More threads the app has, recently active (fix round 1, F4: a dozen of a test's own). */
  extra?: string[]
  /** (0.5.7) The session has start_session and not spawn_task (the app since 10-14), and the engine lists them so. */
  startOnly?: boolean
}

/**
 * One app, one store, one clock, and a session per thread. `session(cli, thread)` is that thread's `$`.
 * Every app call and every store call waits a few turns first, chosen by the seed, so the sessions' calls
 * interleave the way a dozen processes' do.
 */
function world(opts: WorldOptions) {
  const rnd = random(opts.seed)
  const turns = async (most: number) => {
    for (let n = Math.floor(rnd() * (most + 1)); n > 0; n--) await Promise.resolve()
  }
  const stored: Record<string, string> = {}
  /** Sets of this key the engine refuses next, as it refuses one it cannot lock in time. */
  const refusing = { key: '', times: 0 }
  let time = NOW
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = []
  const app = new Map<string, Thread>()
  const thread = (sessionId: string, title: string, over: Partial<Thread> = {}): Thread => ({ sessionId, title, pinned: false, isArchived: false, lastActivityAt: ago(1), ...over })
  app.set('local_poller', thread('local_poller', 'Morning hub'))
  for (let n = 1; n <= 8; n++) app.set(OLD_THREAD(n), thread(OLD_THREAD(n), `Old client ${n} work`, { lastActivityAt: ago(30 + n) }))
  for (let n = 1; n <= N; n++) app.set(NEW_THREAD(n), thread(NEW_THREAD(n), `Chip ${n}`, { lastActivityAt: ago(0) }))
  for (const id of opts.extra ?? []) app.set(id, thread(id, `Thread ${id}`, { lastActivityAt: ago(0) }))
  // the app's list holds its most recent threads: the older ones are asked for by id, which takes a while
  const unlisted = new Set([...app.keys()].filter(id => id.startsWith('local_old_')))

  const feed: Feed = {
    member: ME,
    role: 'founder',
    mail: [],
    tickets: {},
    threads: [],
    drafts: [
      ...Array.from({ length: N }, (_, i) => ({ package_id: `aaaa${String(i + 1).padStart(4, '0')}-0000-4000-8000-000000000000`, project_id: fresh(i + 1), project_name: `Client ${i + 1}`, status: 'prepared', covers_through: ago(3), drafts_ready: 1, drafts_unsent: 1, flagged_for_rob: false, project_owner_email: ME })),
      ...Array.from({ length: 8 }, (_, i) => ({ package_id: `bbbb${String(i + 1).padStart(4, '0')}-0000-4000-8000-000000000000`, project_id: older(i + 1), project_name: `Old client ${i + 1}`, status: 'prepared', covers_through: ago(4), drafts_ready: 1, drafts_unsent: 1, flagged_for_rob: false, project_owner_email: ME })),
    ],
  }
  const text = (value: unknown): Mcp => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false })
  /** The thread each chip was minted in, in order (the n-th has the id `task_<n>`), and the chips withdrawn. */
  const spawned: string[] = []
  const dismissed: string[] = []
  /** (0.5.7) The prompts of the threads start_session started now, in order. */
  const startedNow: string[] = []
  /** (0.5.24) The prompts of the Start cards start_session put up, in order. */
  const cards: string[] = []

  const session = (cli: string, self: string) => {
    const state = new Map<string, unknown>()
    return {
      store: {
        get: async (key: string) => {
          await turns(4)
          const v = stored[key]
          await turns(2)
          return v === undefined ? undefined : JSON.parse(v)
        },
        set: async (key: string, value: unknown) => {
          await turns(4)
          if (refusing.key === key && refusing.times > 0) {
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
          await turns(tool === 'get_session' && args.session_id !== 'self' ? 40 : 12)
          const id = args.session_id === 'self' ? self : String(args.session_id ?? '')
          const t = app.get(id)
          if (tool === 'get_session') return t ? text(t) : { content: [{ type: 'text', text: `Session ${id} not found.` }], isError: true }
          if (tool === 'list_sessions') return text([...app.values()].filter(x => x.sessionId !== self && !unlisted.has(x.sessionId)))
          if (tool === 'set_session_title' && t) t.title = String(args.title)
          if (tool === 'set_pinned' && t) t.pinned = Boolean(args.pinned)
          if (tool === 'get_usage') return text({ context: { status: 'unavailable' } })
          if (tool === 'spawn_task' && opts.startOnly) throw new Error('mm-bridge: $.mcp.call: no connected MCP tool "spawn_task" on a server named "ccd_session"')
          if (tool === 'spawn_task') {
            spawned.push(self)
            return text(`Noted (task_id: task_${String(spawned.length).padStart(8, '0')}).`)
          }
          // (0.5.7) as the app answers start_session: a proposal card, or a session started now
          if (tool === 'start_session' && args.initiation === 'own_initiative') {
            spawned.push(self)
            cards.push(String(args.prompt))
            return text(`Proposed "${String(args.title)}" (task_id: task_${String(spawned.length).padStart(8, '0')}).`)
          }
          if (tool === 'start_session') {
            const sid = `local_started_${opts.seed}_${startedNow.push(String(args.prompt))}`
            app.set(sid, thread(sid, String(args.title)))
            return text(`Started session "${String(args.title)}" (session_id: ${sid}). It runs on its own.`)
          }
          if (tool === 'dismiss_task') {
            dismissed.push(String(args.task_id))
            return text('Dismissed.')
          }
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
        write: async () => undefined,
      },
      http: { fetch: async () => ({ status: 200, ok: true, headers: {}, text: JSON.stringify(feed) }) },
      clock: {
        now: async () => time,
        after: (ms: number, fn: () => void) => {
          const timer = { at: time + ms, fn, done: false }
          timers.push(timer)
          return { cancel: () => void (timer.done = true) }
        },
        every: () => ({ cancel: () => undefined }),
      },
      session: { id: async () => cli, append: async () => ({}) },
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
      prompt: { read: async () => ({ text: '', cursor: 0 }), fill: async (input: { text: string }) => ({ isFilled: true, text: input.text, cursor: input.text.length }) },
      tool: {
        register: async () => ({ tool: 'mcp__mm-bridge__mm' }),
        // (0.5.7) the tools the model can call now
        list: async () => (opts.startOnly ? ['mcp__ccd_session__start_session', 'mcp__ccd_session__dismiss_task'] : []).map(name => ({ name, description: name, mcp: true })),
      },
    }
  }

  return {
    spawned,
    dismissed,
    startedNow,
    cards,
    session,
    stored: (key: string) => (stored[key] === undefined ? undefined : JSON.parse(stored[key] as string)),
    put: (key: string, value: unknown) => void (stored[key] = JSON.stringify(value)),
    /** The next `times` sets of `key`, from any session, are refused. */
    refuse: (key: string, times: number) => Object.assign(refusing, { key, times }),
    /**
     * Moves the clock on and runs every timer that falls due, in the order they fall due: those due at the
     * same moment together, each moment's work run to its end before the next (a check 1.2 s on is over
     * long before one 1.9 s on starts).
     */
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
        // what the timers started runs to its end
        for (let i = 0; i < 2_000; i++) await Promise.resolve()
      }
      time = until
    },
  }
}

const hooks = hooksOf()
const next = (e: unknown) => e
const sdk = { kind: 'sdk' }
/** /mm, as the person runs it: the sync it starts, then the pane. */
const syncIn = ($: unknown) => hooks['command.run:mm']?.($, { command: 'mm', args: '', origin: { kind: 'composer' } }, next)
/** A thread started from a chip: its session starts, and its first prompt is the chip's, marker first. */
const start = async ($: unknown, n: number) => {
  await hooks['session.start']?.($, { cwd: '/work', surface: 'desktop', isInteractive: false }, next)
  await hooks['prompt.submit']?.($, { text: KICKOFF(n), origin: sdk }, next)
}

/** The poller has synced, linked the eight older clients' threads and holds the lease; then the dozen start. */
async function before(w: ReturnType<typeof world>) {
  const poller = w.session('cli-poller', 'local_poller')
  w.put('mm.links', Object.fromEntries(Array.from({ length: 8 }, (_, i) => [older(i + 1), OLD_THREAD(i + 1)])))
  w.put('mm.lease', { owner: 'cli-poller', until: NOW + HOUR })
  await syncIn(poller)
  return { poller, threads: Array.from({ length: N }, (_, i) => w.session(`cli-new-${i + 1}`, NEW_THREAD(i + 1))) }
}

/** What did not reach the store: a new client not linked to its own thread, an older link gone, a session's pair gone. */
function losses(w: ReturnType<typeof world>) {
  const links = (w.stored('mm.links') ?? {}) as Record<string, string>
  const pairs = (w.stored('mm.threads') ?? {}) as Record<string, { app: string }>
  return {
    links: Array.from({ length: N }, (_, i) => i + 1).filter(n => links[fresh(n)] !== NEW_THREAD(n)).map(n => `Client ${n}`),
    older: Array.from({ length: 8 }, (_, i) => i + 1).filter(n => links[older(n)] !== OLD_THREAD(n)).map(n => `Old client ${n}`),
    pairs: Array.from({ length: N }, (_, i) => i + 1).filter(n => pairs[`cli-new-${n}`]?.app !== NEW_THREAD(n)).map(n => `cli-new-${n}`),
  }
}

const SEEDS = [1, 7, 42, 99, 2026, 1013]
const none = { links: [], older: [], pairs: [] }

describe('B1: a dozen threads started at once against one store, with a sync running across them', () => {
  for (const seed of SEEDS) {
    test(`(a) twelve marker starts at once, nothing else running: every link is there (seed ${seed})`, async () => {
      const w = world({ seed })
      const { threads } = await before(w)
      await Promise.all(threads.map((t, i) => hooks['prompt.submit']?.(t, { text: KICKOFF(i + 1), origin: sdk }, next)))
      await w.advance(3_100)
      expect(losses(w).links).toEqual([])
    })

    test(`(b) a sync whose pass reads the links before the dozen write theirs and writes after: every link is there (seed ${seed})`, async () => {
      const w = world({ seed })
      const { poller, threads } = await before(w)
      // the poller's next sync, five minutes on; the markers arrive one after another while it runs
      await w.advance(5 * 60_000)
      await Promise.all([
        syncIn(poller),
        (async () => {
          for (const [i, t] of threads.entries()) await hooks['prompt.submit']?.(t, { text: KICKOFF(i + 1), origin: sdk }, next)
        })(),
      ])
      await w.advance(3_100)
      const { links, older: old } = losses(w)
      expect({ links, older: old }).toEqual({ links: [], older: [] })
    })

    test(`the whole burst: sessions start, markers, the 4-second ticks and two syncs, all at once (seed ${seed})`, async () => {
      const w = world({ seed })
      const { poller, threads } = await before(w)
      await w.advance(5 * 60_000)
      await Promise.all([syncIn(poller), ...threads.map((t, i) => start(t, i + 1))])
      // the checks 1 to 3 seconds on, then every new thread's first tick (its own pair) with another sync
      await w.advance(3_100)
      await Promise.all([w.advance(1_000), syncIn(poller)])
      await w.advance(3_100)
      expect(losses(w)).toEqual(none)
      // and the sync after it pins and names nobody's link away: the twelve are still theirs
      await syncIn(poller)
      expect(losses(w)).toEqual(none)
    })
  }

  test('a set the engine cannot lock in time: the link is written again 1 to 3 seconds later', async () => {
    const w = world({ seed: 5 })
    const { threads } = await before(w)
    w.refuse('mm.links', 3)
    await Promise.all(threads.slice(0, 3).map((t, i) => hooks['prompt.submit']?.(t, { text: KICKOFF(i + 1), origin: sdk }, next)))
    // the three refused writes left no link
    const links = (w.stored('mm.links') ?? {}) as Record<string, string>
    expect([1, 2, 3].filter(n => links[fresh(n)] === NEW_THREAD(n)).length).toBeLessThan(3)
    await w.advance(3_100)
    expect([1, 2, 3].filter(n => (w.stored('mm.links') as Record<string, string>)[fresh(n)] !== NEW_THREAD(n))).toEqual([])
  })

  test('a thread the person unlinked in those seconds is not linked again by the check', async () => {
    const w = world({ seed: 11 })
    const { threads } = await before(w)
    await hooks['prompt.submit']?.(threads[0], { text: KICKOFF(1), origin: sdk }, next)
    expect((w.stored('mm.links') as Record<string, string>)[fresh(1)]).toBe(NEW_THREAD(1))
    // /mm unlink in that thread, before the check
    await hooks['command.run:mm']?.(threads[0], { command: 'mm', args: 'unlink', origin: { kind: 'composer' } }, next)
    await w.advance(3_100)
    expect((w.stored('mm.links') as Record<string, string>)[fresh(1)]).toBeUndefined()
    expect(w.stored('mm.unlinked')).toEqual({ [NEW_THREAD(1)]: NOW })
  })
})

// Fix round 1, F4 (review of e832775b): a dozen threads that tick at once write the one `mm.chips` record over each
// other. (0.5.4, C3: Rob, 10-14, "yes chips") A client with no thread has ONE chip, in one thread: threads that
// start together and each mint one come down to the copies of the one thread that holds them, on the next tick,
// and nothing is minted again.
describe('F4: chip records when a dozen threads tick at once', () => {
  const tickAll = async (w: ReturnType<typeof world>, threads: unknown[]) => {
    await Promise.all(threads.map(t => hooks['session.start']?.(t, { cwd: '/work', surface: 'desktop', isInteractive: false }, next)))
    await w.advance(4_000)
    await w.advance(3_100)
  }
  for (const seed of [1, 7, 42, 99, 2026, 1013, 5, 11]) {
    test(`twelve threads tick at once: the clients with no thread end with one chip each, five in all, in one thread; the next tick mints none (seed ${seed})`, async () => {
      // (thread ids of this test's own: the bridge's module is one for the whole file, as each app thread's is one per thread)
      const ids = Array.from({ length: N }, (_, i) => `local_f4_${seed}_${i + 1}`)
      const w = world({ seed, extra: ids })
      await before(w)
      // the thread that polls is one of the twelve, as it is in the app: its session holds the lease, and its pair is on record
      w.put('mm.lease', { owner: `cli-f4-${seed}-1`, until: NOW + HOUR })
      w.put('mm.threads', { ...((w.stored('mm.threads') ?? {}) as Record<string, unknown>), [`cli-f4-${seed}-1`]: { app: ids[0], at: NOW } })
      const threads = ids.map((id, i) => w.session(`cli-f4-${seed}-${i + 1}`, id))
      await tickAll(w, threads)
      const live = () => ((w.stored('mm.chips') ?? []) as Array<{ taskId: string; threadId: string; projectId: string; superseded?: boolean }>).filter(r => ids.includes(r.threadId) && !r.superseded)
      // the next tick: any copy minted beside the poller's is withdrawn
      await w.advance(60_000)
      await tickAll(w, threads)
      expect(live().length).toBe(5)
      expect(new Set(live().map(r => r.projectId)).size).toBe(5)
      expect([...new Set(live().map(r => r.threadId))]).toEqual([ids[0]])
      // and the tick after mints nothing and withdraws nothing
      const spawned = w.spawned.length
      const dismissed = w.dismissed.length
      await w.advance(60_000)
      await tickAll(w, threads)
      expect(w.spawned.length).toBe(spawned)
      expect(w.dismissed.length).toBe(dismissed)
      expect(live().length).toBe(5)
    })
  }
})

// (0.5.7, Rob 10-14 ~13:35 ET) Where the app has start_session, a client with no thread got its thread started by
// itself. (0.5.24) It got its Start card instead. (0.5.25, Rob 10-22: "it's kind of confusing having a button and chips
// appear that don't work") Now nothing at all by itself: a dozen threads that tick at once, none knowing which thread
// polls, start no thread and put up no card; the client's row waits for the person's Start.
describe('0.5.7: a dozen threads that tick at once never start one client\'s thread twice; (0.5.25) nor start it or put up its card at all', () => {
  const tickAll = async (w: ReturnType<typeof world>, threads: unknown[]) => {
    await Promise.all(threads.map(t => hooks['session.start']?.(t, { cwd: '/work', surface: 'desktop', isInteractive: false }, next)))
    await w.advance(4_000)
    await w.advance(3_100)
  }
  for (const seed of [1, 7, 42, 99, 2026, 1013, 5, 11]) {
    test(`twelve threads, no poller they know of: no thread is started and no card is put up (seed ${seed})`, async () => {
      const ids = Array.from({ length: N }, (_, i) => `local_as_${seed}_${i + 1}`)
      const w = world({ seed, extra: ids, startOnly: true })
      await before(w)
      // the lease is held by a session none of them knows: nobody is the poller to them
      w.put('mm.lease', { owner: 'cli-nobody', until: NOW + HOUR })
      const threads = ids.map((id, i) => w.session(`cli-as-${seed}-${i + 1}`, id))
      for (let i = 0; i < 2; i++) {
        await tickAll(w, threads)
        await w.advance(60_000)
      }
      expect(w.startedNow).toEqual([])
      expect(w.cards).toEqual([])
    })
  }
})
