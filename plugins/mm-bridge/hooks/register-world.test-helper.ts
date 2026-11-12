// TESTS ONLY: the world the two register-*.test.ts files share, moved out of register.test.ts on 2026-11-11. That one
// file took 360 to 600 s on CI's macOS runner, and the test kit kills a file at 600 s: it failed about half of the CI
// runs on 2026-11-11.
//
// Two files, balanced on CI's own per-test times, and not more. The files run at once. On a free 3-core runner, two
// files halve the time (about 180 s each). A busy runner can have fewer than 2 cores free (PR #97's second CI run).
// There a third file makes no file shorter, since the cores are the limit, and the files share them: split three ways,
// every test ran about three times slower, and a timer-heavy test passed the kit's 5 s default. Add a test to the file
// its topic belongs to, and keep the two about even.
//
// Never imported by the hooks module (hooks.json loads register.tsx alone).

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'
import type { Feed } from './queue'
import { SMS_TREE } from './card-fixture.test-helper'
import { withTopLevelStep } from './threads'
import type { PinReport } from './threads'
import { localClock } from './track'

// The bridge against a pretend desktop app, a pretend feed and a pretend store. Nothing here reaches the
// live feed or a real thread, and every client is made up.

/** Monday 2026-10-12, 11 AM in New York. */
export const NOW = Date.parse('2026-10-12T15:00:00Z')
export const HOUR = 3_600_000
export const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString()

/**
 * The tests that run the bridge's own timers through an hour or more of the test's clock (the update that goes
 * 120 minutes after a message was first seen, the 12-an-hour cap, pins held off sync after sync). The time goes
 * on the bridge's own work for each simulated minute, not on the test: about 1-3 s on an M-series Mac, and up to
 * about 2.6 times that on GitHub's runners, past the kit's 5 s default (CI, 2026-10-23). These tests alone get
 * 30 s; every other test keeps the default.
 *
 * (2026-11-11) Since register.test.ts was split, its files run at once, and on a busy runner they share fewer than
 * 2 free cores: every test there ran 2.2 to 3.1 times slower than on a free one (PR #97), and tests of ten minutes
 * to two hours of the clock passed 5 s. So every test that took over 1 s on CI's slowest green run of the single
 * file (43080447597 attempt 2) has 30 s too, 35 more. Give it to a new test that runs the timers for ten minutes or
 * more, or takes over 1 s on CI. The timeout guards against a test that hangs; no test asserts it.
 */
export const LONG = { timeoutMs: 30_000 }

export const ACME = '11111111-1111-1111-1111-111111111111'
export const BOLT = '22222222-2222-2222-2222-222222222222'
export const CEDAR = '33333333-3333-3333-3333-333333333333'
export const ME = 'builder-a@example.com'
/** This thread: the app's id for it, and the Claude Code session id its worklog rows carry. */
export const SELF = 'local_self'
export const SELF_CLI = 'cccccccc-0000-4000-8000-000000000000'
export const PKG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
/** (0.7.33) The line over a client's page on a computer whose renderer draws no card (this test world's, unless it says `renderer: 'tree'`). */
export const CARD_NOT_DRAWN = 'The card could not be drawn on this computer. Your thread prints the whole package instead.'

export type Thread = { sessionId: string; title: string; pinned: boolean; isArchived: boolean; lastActivityAt: string; link?: string; cwd?: string }
export type Call = { server: string; tool: string; args: Record<string, unknown> }

export const thread = (sessionId: string, title: string, hoursAgo: number, over: Partial<Thread> = {}): Thread => ({
  sessionId, title, pinned: false, isArchived: false, lastActivityAt: ago(hoursAgo), ...over,
})

/** Acme has a prepared package, Bolt two client messages and no package, Cedar one committed task. */
export const feed = (over: Partial<Feed> = {}): Feed => ({
  member: ME,
  role: 'builder',
  drafts: [{ package_id: PKG, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: ago(3), drafts_ready: 2, project_owner_email: ME }],
  mail: [1, 2].map(n => ({
    message_id_key: `bolt-${n}`, received_at: ago(n + 2), reply_due_at: new Date(NOW + (24 - n) * HOUR).toISOString(), sender: 'client@example.com',
    subject: 'Question', snippet: 'hello', project_id: BOLT, project_name: 'Bolt Staffing (Sam)', reply_status: 'unanswered', project_owner_email: ME,
  })),
  tickets: { due_today: [{ ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }] },
  ...over,
})

export type WorldOptions = {
  feed?: Feed
  /** (0.5.25) What the person's prompt box holds when a press reads it; `null`: the session has no box (a fill is refused). */
  box?: string | null
  /** (0.7.40) How a plugin's `$.prompt.submit` goes: entered (left out), refused with a drop, or failing. */
  submit?: 'drop' | 'throws'
  /** The app's other threads. Left out, there is one that is nobody's. (The app's list leaves the calling thread out: `threads: []` is a person with one open thread.) */
  threads?: Thread[]
  store?: Record<string, unknown>
  self?: Thread
  sendFails?: string
  terminal?: boolean
  /** What the app answers for its thread list, when it is not the list of `threads`. */
  listReturns?: unknown
  /** The app's thread list call answers an error. */
  listFails?: boolean
  /** Threads that are open but not in the app's list: it holds only the most recent. */
  unlisted?: string[]
  /** Asked for one thread by id (not this one), the app answers this error. */
  lookupFails?: string
  /** What the app answers when this session asks for its own usage: the whole answer, `plan` and all. Left out, the context is unavailable. */
  usage?: () => unknown
  /** The app takes this long to deliver a message into a thread: how a test presses twice while the first is in flight. */
  sendTakesMs?: number
  /** Withdrawing a chip fails. */
  dismissFails?: boolean
  /** No tracker token on this computer. */
  noToken?: boolean
  /** The system's opener: it takes the link (`works`), exits with an error (left out), or is not on this computer (`missing`). */
  opener?: 'works' | 'missing'
  /** A shell command in this thread: it runs (left out), it runs and fails (`error`), or it is refused before it runs (`deny`). */
  bash?: 'error' | 'deny'
  /** The feed's HTTP status for each fetch (200 when left out). */
  feedStatus?: () => number
  /** (0.7.14) `size`: what a stat says of a file whose text is not given in full (a long transcript). */
  files?: Record<string, { text: string; mtimeMs: number; size?: number }>
  env?: Record<string, string>
  /** Runs at each app call, before it is answered: what another session does to the store while a pass waits on the app. */
  during?: (call: Call, stored: Record<string, unknown>) => void
  /** (R15) This machine has not had the thread list's view changed yet. Left out, it has (`mm.viewSet` is on record). */
  firstRun?: boolean
  /** What the app answers `set_view` with: `ok` (left out), or `refused`. */
  setView?: 'ok' | 'refused'
  /** The app takes this long to answer `spawn_task` (R10: Start that said nothing). */
  spawnTakesMs?: number
  /** The app takes this long to answer `set_view` (fix round 1, L11). */
  setViewTakesMs?: number
  /**
   * (0.5.7) Which of the app's session tools this session has, as `$.tool.list()` names them: `spawn_task` alone (the
   * app before 10-14), `start_session` alone (since), or both. Left out, the listing names neither, as before 0.5.7.
   */
  tools?: 'spawn' | 'start' | 'both'
  /** (0.5.7) start_session refuses a start with this text (its proposals still go). */
  startFails?: string
  /** (0.5.7) With `tools`: the engine's listing names none of them (the session has them all the same). */
  toolsUnlisted?: boolean
  /** (0.5.7) start_session's answer to a start gives no session id. */
  startNoId?: boolean
  /** (0.5.12) The app takes this long to answer start_session: how a test sees whether two starts are ever in flight at once. */
  startTakesMs?: number
  /** (0.5.12) start_session refuses this one start (by its arguments) with this text; undefined: it starts. */
  startRefuses?: (args: Record<string, unknown>) => string | undefined
  /** (0.5.24) start_session refuses this one Start card (its proposal, by its arguments) with this text; undefined: the card is up. */
  cardRefuses?: (args: Record<string, unknown>) => string | undefined
  /** (0.5.24) The app takes this long to answer a Start card (Claude.app 3.1623 asks the person to approve each one first). */
  cardTakesMs?: number
  /** (0.5.11, review of PR #15) The feed takes this long to answer its n-th read (the closeout feed only). */
  fetchTakesMs?: (n: number) => number
  /** (0.5.17) How the closeout feed answers its next read: no answer at all (`network`), that status, or (undefined) as `feedStatus` says. */
  feedRead?: () => 'network' | number | undefined
  /**
   * (0.5.11, review of PR #15, F4) The time-tracking hook on this computer: one that counts the bridge's turns as
   * automatic (left out: 0.11.7's rule), one older than 0.11.5 (`old`), or none that can be read (`missing`).
   */
  hook?: 'old' | 'missing'
  /** (New people) How OW answers `POST /person-alert/resolve`: a status and a body, or no answer at all. Left out, 200 and the alert. */
  resolve?: (body: Record<string, unknown>) => { status: number; body?: unknown } | 'network'
  /** (0.5.28, internal asks) How OW answers `GET /team-ask?id=<id>&format=pickup`: a status and a body, or no answer at all. Left out, 404. */
  teamAsk?: (url: string) => { status: number; body?: unknown } | 'network'
  /** (0.6.0) How OW answers `GET /skill-map`. Left out, 404: an OW without the route yet. */
  skillMap?: (url: string) => { status: number; body?: unknown } | 'network'
  /** (0.6.0) How OW answers `GET /client-time?project_ids=...`. Left out, 404. */
  clientTime?: (url: string) => { status: number; body?: unknown } | 'network'
  /** (0.7.0) How OW answers `POST /scope-line/link`: a status and a body, or no answer at all. Left out, 404. */
  scopeLink?: (body: Record<string, unknown>) => { status: number; body?: unknown } | 'network'
  /** (0.7.0) How OW answers `POST /scope-proposal`. Left out, 404. */
  scopeProposal?: (body: Record<string, unknown>) => { status: number; body?: unknown } | 'network'
  /** (0.7.34) How OW answers `GET /team-now`. Left out, 404: an OW without the route yet. */
  teamNow?: () => { status: number; body?: unknown } | 'network'
  /** (0.7.53) How OW answers `GET /browser-now`. Left out, 404: an OW without the route yet. */
  browserNow?: () => { status: number; body?: unknown } | 'network'
  /** (0.7.53) How OW answers `POST /browser-answer`. Left out, 404. */
  browserAnswer?: (body: Record<string, unknown>) => { status: number; body?: unknown } | 'network'
  /** (0.7.23) How OW answers the sync's pin report (`POST /bridge-pins`): a status, or no answer at all. Left out, 404: an OW without the route yet. */
  bridgePins?: (body: PinReport) => { status: number; body?: unknown } | 'network'
  /**
   * (0.7.6) How the app answers `unarchive_session`: left out, the thread is unarchived and the app says so; `refuse`,
   * the person said no to the app's question (an error answer); `error`, the call itself fails; `silent`, the app never
   * answers (the person has not answered its question).
   */
  unarchive?: 'refuse' | 'error' | 'silent' | (() => 'refuse' | 'error' | 'silent' | undefined)
  /** (0.7.26) The renderer on this computer draws the card (the synthetic text package's tree), instead of being one from before --tree. */
  renderer?: 'tree'
  /** (0.7.26) What the reply-package pickup read answers, when not the plain page. */
  pickup?: Record<string, unknown>
}

/** (0.5.11, review of PR #15, F4) The parts of the time-tracking hook's text the bridge reads: 0.11.7's, and 0.11.4's. */
export const HOOK_TEXT = {
  current: 'const HOOK_VERSION = "0.11.7";\nconst TURN_ORIGIN_MARKER_RE =\n  /^\\[mm-link [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\]/;\n',
  old: '// worklog hook (0.11.4)\nfunction postWorklog(entry) {}\n',
}

export function world(on: On, opts: WorldOptions = {}) {
  const clock = mock.clock(on, { now: NOW })
  // A terminal session has no desktop app behind it: its session tools are not there to call.
  mock.env(on, opts.env ?? { CLAUDE_CODE_ENTRYPOINT: opts.terminal ? 'cli' : 'claude-desktop', HOME: '/home/someone' })
  const stored: Record<string, unknown> = JSON.parse(JSON.stringify({ ...(opts.firstRun ? {} : { 'mm.viewSet': { at: 0, version: '0.5.2' } }), ...(opts.store ?? {}) }))
  on('store.get', (_$, e) => ({ value: stored[e.key] === undefined ? undefined : JSON.parse(JSON.stringify(stored[e.key])) }))
  on('store.set', (_$, e) => {
    stored[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })

  const self = opts.self ?? thread(SELF, 'Morning hub', 0)
  const threads = new Map<string, Thread>([self, ...(opts.threads ?? [thread('local_other', 'Unrelated notes', 100)])].map(t => [t.sessionId, { ...t }]))
  const calls: Call[] = []
  const prompts: Array<{ text: string; origin: unknown }> = []
  const opened: Array<{ id: string; title?: string }> = []
  const toasts: string[] = []
  const fetched: string[] = []
  const registered: string[] = []
  let theFeed = opts.feed ?? feed()
  /** (0.7.26) What the reply-package pickup read answers. */
  let pickupNow = opts.pickup
  /** (0.7.36) A pickup read that waits, so that a test can move on while a call is in flight. */
  let pickupGate: { gate: Promise<void>; arrived: () => void } | null = null
  let chipsMinted = 0
  let sessionsStarted = 0
  let startsNow = 0
  let mostStartsAtOnce = 0
  let cardsNow = 0
  let mostCardsAtOnce = 0
  // (0.5.7) the tools the model can call now, as the engine lists them
  if (opts.tools) {
    const names = [...(opts.tools !== 'start' ? ['mcp__ccd_session__spawn_task'] : []), ...(opts.tools !== 'spawn' ? ['mcp__ccd_session__start_session', 'mcp__ccd_session__list_start_targets'] : []), 'mcp__ccd_session__dismiss_task', 'Bash']
    on('tool.list', () => ({ value: opts.toolsUnlisted ? [] : names.map(name => ({ name, description: name, mcp: name.startsWith('mcp__') })) }))
  }
  on('session.cwd', () => ({ value: '/work' }))

  const text = (value: unknown) => ({ value: { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false } })
  on('mcp.call', async (_$, e) => {
    if (opts.terminal && e.server.startsWith('ccd_')) return { deny: `MCP server "${e.server}" is not connected` }
    calls.push({ server: e.server, tool: e.tool, args: e.args })
    opts.during?.({ server: e.server, tool: e.tool, args: e.args }, stored)
    const id = e.args.session_id === 'self' ? self.sessionId : String(e.args.session_id ?? '')
    const t = threads.get(id)
    const refused = (why: string) => ({ value: { content: [{ type: 'text' as const, text: why }], isError: true } })
    if (e.tool === 'get_session') {
      // As the app answers: this thread always; another by id with its `isArchived`; an id it does not have with an error.
      if (e.args.session_id !== 'self' && opts.lookupFails) return refused(opts.lookupFails)
      return t ? text(t) : refused(`Session ${id} not found.`)
    }
    if (e.tool === 'list_sessions' && opts.listFails) return refused('internal error')
    if (e.tool === 'list_sessions') {
      // (0.7.6) `include_archived`: the archived threads too, as the app lists them then
      return text(opts.listReturns !== undefined ? opts.listReturns : [...threads.values()].filter(x => x.sessionId !== self.sessionId && (e.args.include_archived === true || !x.isArchived) && !(opts.unlisted ?? []).includes(x.sessionId)))
    }
    // (0.7.6) as the app answers unarchive_session
    if (e.tool === 'unarchive_session') {
      // (0.7.10) a function: the answer as the test has it now
      const unarchive = typeof opts.unarchive === 'function' ? opts.unarchive() : opts.unarchive
      if (unarchive === 'silent') return new Promise<never>(() => undefined)
      if (unarchive === 'error') return { deny: 'mm-bridge: $.mcp.call: ccd_session_mgmt.unarchive_session failed: internal error' }
      if (unarchive === 'refuse') return refused('The user declined to unarchive this session.')
      if (!t) return refused(`Session ${id} not found.`)
      t.isArchived = false
      return text(`Session ${id} unarchived.`)
    }
    if (e.tool === 'set_session_title' && t) t.title = String(e.args.title)
    if (e.tool === 'set_pinned' && t) t.pinned = Boolean(e.args.pinned)
    // As the app answers a session asking for its own usage: the account's plan, and the session's context window.
    if (e.tool === 'get_usage') return text(opts.usage ? opts.usage() : { plan: { status: 'ok', plan: PLAN_MARK }, context: { session: 'self', status: 'unavailable' } })
    // As the app answers a chip being minted, and one being withdrawn.
    if (e.tool === 'set_view' && opts.setViewTakesMs) await clock.sleep(opts.setViewTakesMs)
    if (e.tool === 'set_view') return opts.setView === 'refused' ? refused('set_view is not available here.') : text({ group_by: 'date', sort_by: 'recency' })
    // (0.5.7) a tool this session does not have, as the engine answers for one
    const missing = (opts.tools === 'start' && e.tool === 'spawn_task') || (opts.tools === 'spawn' && e.tool === 'start_session')
    if (missing) return { deny: `mm-bridge: $.mcp.call: no connected MCP tool "${e.tool}" on a server named "ccd_session"` }
    if (e.tool === 'spawn_task' && opts.spawnTakesMs) await clock.sleep(opts.spawnTakesMs)
    if (e.tool === 'spawn_task') return text(`Noted (position ${++chipsMinted}, task_id: task_${String(chipsMinted).padStart(8, '0')}). A chip is showing for the user. If this suggestion becomes stale or superseded, call dismiss_task with this task_id.`)
    // (0.5.7) as the app answers start_session (Claude.app, 10-14): a proposal card, or a session started now
    if (e.tool === 'start_session' && e.args.initiation === 'own_initiative') {
      cardsNow++
      mostCardsAtOnce = Math.max(mostCardsAtOnce, cardsNow)
      if (opts.cardTakesMs) await clock.sleep(opts.cardTakesMs)
      cardsNow--
      const no = opts.cardRefuses?.(e.args)
      if (no) return refused(no)
      return text(`Proposed "${String(e.args.title)}" (task_id: task_${String(++chipsMinted).padStart(8, '0')}). The user sees a card and nothing runs until they start it.`)
    }
    if (e.tool === 'start_session') {
      if (opts.startFails) return refused(opts.startFails)
      // (0.5.12) how many starts the app has in hand at once, at most
      startsNow++
      mostStartsAtOnce = Math.max(mostStartsAtOnce, startsNow)
      if (opts.startTakesMs) await clock.sleep(opts.startTakesMs)
      startsNow--
      const no = opts.startRefuses?.(e.args)
      if (no) return refused(no)
      const sid = `local_started_${++sessionsStarted}`
      threads.set(sid, { sessionId: sid, title: String(e.args.title), pinned: false, isArchived: false, lastActivityAt: new Date(clock.now()).toISOString() })
      return text(`Started session "${String(e.args.title)}" (session_id: ${opts.startNoId ? '' : sid}, name: started-${sessionsStarted}). It runs on its own; you get a note here when its turn ends.`)
    }
    if (e.tool === 'dismiss_task') return opts.dismissFails ? refused('Could not dismiss.') : text('Dismissed.')
    if (e.tool === 'send_message') {
      // delivering a message can take time: a test holds it here while it presses again
      if (opts.sendTakesMs) await clock.sleep(opts.sendTakesMs)
      if (opts.sendFails) return refused(opts.sendFails)
      // a delivered message starts a turn there, which is activity
      if (t) t.lastActivityAt = new Date(clock.now()).toISOString()
      return text(`Message delivered to session ${id}; its turn has started on it. (delivery: delivered; message_id: m1)`)
    }
    return text('ok')
  })
  let feedReads = 0
  /** (New people) Every call to OW's resolve route, as it was made. */
  const resolves: Array<{ method: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  /** (0.7.0) Every call to OW's scope-line link and scope-proposal routes, as it was made. */
  const scopePosts: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  /** (0.7.23) Every pin report the bridge sent, as it was sent. */
  const pinPosts: Array<{ method: string; headers: Record<string, string>; body: PinReport }> = []
  /** (0.7.53) Every answer to a browser question the bridge sent, as it was sent. */
  const browserPosts: Array<{ method: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
  on('http.fetch', async (_$, e) => {
    fetched.push(e.url)
    if (e.url.endsWith('/api/ext/browser-now') || e.url.endsWith('/api/ext/browser-answer')) {
      const posting = e.url.endsWith('/browser-answer')
      const body = posting ? (JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>) : {}
      if (posting) browserPosts.push({ method: String(e.init?.method ?? 'GET'), headers: { ...(e.init?.headers ?? {}) }, body })
      const missing = { status: 404, body: { error: 'not_found' } }
      const answer = posting ? (opts.browserAnswer?.(body) ?? missing) : (opts.browserNow?.() ?? missing)
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: JSON.stringify(answer.body ?? {}) } }
    }
    if (e.url.endsWith('/api/ext/bridge-pins')) {
      const body = JSON.parse(String(e.init?.body ?? '{}')) as PinReport
      pinPosts.push({ method: String(e.init?.method ?? 'GET'), headers: { ...(e.init?.headers ?? {}) }, body })
      const answer = opts.bridgePins ? opts.bridgePins(body) : { status: 404, body: { error: 'not_found' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: JSON.stringify(answer.body ?? {}) } }
    }
    if (e.url.endsWith('/api/ext/team-now')) {
      const answer = opts.teamNow ? opts.teamNow() : { status: 404, body: { error: 'not_found' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: JSON.stringify(answer.body ?? {}) } }
    }
    if (e.url.endsWith('/api/ext/scope-line/link') || e.url.endsWith('/api/ext/scope-proposal')) {
      const body = JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>
      scopePosts.push({ url: e.url, method: String(e.init?.method ?? 'GET'), headers: { ...(e.init?.headers ?? {}) }, body })
      const route = e.url.endsWith('/scope-proposal') ? opts.scopeProposal : opts.scopeLink
      const answer = route ? route(body) : { status: 404, body: { error: 'not_found' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}) } }
    }
    if (e.url.endsWith('/api/ext/person-alert/resolve')) {
      const body = JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>
      resolves.push({ method: String(e.init?.method ?? 'GET'), headers: { ...(e.init?.headers ?? {}) }, body })
      const answer = opts.resolve ? opts.resolve(body) : { status: 200, body: { id: body.alert_id, status: 'routed' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}) } }
    }
    // (0.5.28, internal asks) an ask's page, as OW's team-ask route answers it
    if (e.url.includes('/api/ext/team-ask')) {
      const answer = opts.teamAsk ? opts.teamAsk(e.url) : { status: 404, body: { ok: false, error: 'not_found' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}) } }
    }
    // (0.6.0) the skill map and the client's time, as OW answers them (404 until it has the routes)
    if (e.url.includes('/api/ext/skill-map') || e.url.includes('/api/ext/client-time')) {
      const route = e.url.includes('/skill-map') ? opts.skillMap : opts.clientTime
      const answer = route ? route(e.url) : { status: 404, body: { error: 'not_found' } }
      if (answer === 'network') return { deny: 'fetch failed: socket hang up' }
      return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {}) } }
    }
    if (e.url.includes('/closeout') && opts.fetchTakesMs) {
      const ms = opts.fetchTakesMs(++feedReads)
      if (ms > 0) await clock.sleep(ms)
    }
    if (e.url.includes('/reply-package') && pickupGate) {
      const held = pickupGate
      pickupGate = null
      held.arrived()
      await held.gate
    }
    const read = e.url.includes('/closeout') ? opts.feedRead?.() : undefined
    if (read === 'network') return { deny: 'fetch failed: socket hang up' }
    const body = e.url.includes('/reply-package') ? pickupNow ?? { markdown: '## Acme Roofing\n\n1. What the client sent' } : theFeed
    const status = typeof read === 'number' ? read : !e.url.includes('/reply-package') && opts.feedStatus ? opts.feedStatus() : 200
    return { value: { status, ok: status === 200, headers: {}, text: JSON.stringify(status === 200 ? body : { error: 'boom' }) } }
  })
  // A pretend disk: the tracker token, and whatever record files a test puts under the app's data folder.
  const files = opts.files ?? {}
  const reads: string[] = []
  const hookReads: string[] = []
  const lists: string[] = []
  const written: Array<{ path: string; text: string }> = []
  // These tests run on a POSIX host, where the engine reads `C:\\Users\\...` as a relative path and puts the
  // working directory in front of it. On Windows it is absolute as written, so the pretend disk drops that.
  const asGiven = (path: string) => path.replace(/^.*\/(?=[A-Za-z]:\\)/, '')
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude/mm-hooks/token')) return opts.noToken ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: 'fixture-token-not-a-real-one' }
    // (0.5.11, review of PR #15, F4) the time-tracking hook, as the bridge reads it to know what it counts
    if (e.path.endsWith('/.claude/mm-hooks/worklog-hook.js')) {
      hookReads.push(e.path)
      return opts.hook === 'missing' ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: HOOK_TEXT[opts.hook ?? 'current'] }
    }
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
  // (0.7.14) a stat of the pretend disk: a file's own size when the test gives one, else its text's length
  on('fs.stat', (_$, e) => {
    const path = asGiven(e.path)
    const file = files[path]
    return file ? { value: { kind: 'file' as const, size: file.size ?? file.text.length, mtimeMs: file.mtimeMs, isLink: false } } : { deny: `ENOENT: no such file or directory, stat '${path}'` }
  })
  /** Every program the bridge started. */
  const ran: string[] = []
  /** (0.7.26) Every reply-package card the bridge drew on this computer: the renderer, apart from the programs above. */
  const renders: string[] = []
  /** (0.7.33) What the renderer draws now. */
  let treeNow = JSON.stringify(SMS_TREE)
  /** (0.7.36) How many of those free seconds went by. */
  let freeSeconds = 0
  on('process.run', async (_$, e) => {
    // (0.7.33) `mm card`'s free second: short here, and long enough for a mounted pane to draw
    if (e.argv[0] === 'sleep') {
      freeSeconds++
      await new Promise(resolve => setTimeout(resolve, 25))
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (e.argv.some(a => String(a).endsWith('/client-reply-prep/scripts/render_visual.py'))) {
      renders.push(JSON.stringify(e))
      if (opts.renderer === 'tree') return { value: { exitCode: 0, stdout: treeNow, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      // a renderer from before --tree: the pane shows the page alone, as before 0.7.26
      return { value: { exitCode: 2, stdout: '', stderr: 'render_visual.py: error: unrecognized arguments: --tree -', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    ran.push(JSON.stringify(e))
    if (opts.opener === 'missing') return { deny: `spawn ${String(e.argv[0])} ENOENT` }
    return { value: { exitCode: opts.opener === 'works' ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  /** Every shell command that reached the tool itself, as it reached it. */
  const shell: string[] = []
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    if (opts.bash === 'deny') return { deny: 'not allowed here' }
    shell.push(String((e as { command?: unknown }).command ?? ''))
    return { result: { stdout: SHELL_OUT, stderr: '', interrupted: false }, ...(opts.bash === 'error' ? { isError: true as const } : {}) } as never
  })
  on('session.id', () => ({ value: SELF_CLI }))
  // (0.6.0) the Skill tool, as it answers a skill that loaded
  on('tool.call', { tool: 'Skill' }, (_$, e) => ({ result: { success: true, commandName: String((e as { skill?: unknown }).skill ?? '') } }) as never)
  /** (0.6.0) Every pane close that reached the engine: which pane, and whose. */
  const closes: Array<{ id: string; origin: string }> = []
  on('ui.close', (_$, e, next) => {
    closes.push({ id: e.id, origin: e.origin.kind })
    return next(e)
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // (0.6.0) a surface attaching, and a turn ending, as the engine answers them
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  /** (0.7.36) The session's sub-agents, as `$.agent.list()` answers them, or a list that cannot be read. */
  let agentsNow: Array<{ id: string; status: string }> | 'throws' = []
  on('agent.list', () => {
    if (agentsNow === 'throws') throw new Error('the list could not be read')
    return { value: agentsNow }
  })
  on('command.register', (_$, e) => {
    registered.push(String(e.description ?? ''))
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => {
    registered.push(String(e.description ?? ''))
    return { value: { tool: `mcp__mm-bridge__${e.name}` } }
  })
  /** (0.7.33) Whether this surface can place a pane now. */
  let placed = true
  on('ui.open', (_$, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: placed ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'nothing can draw a pane here' } }
  })
  /** (0.7.33) Whether the pane is the one its surface shows, or a tab behind another. */
  let shownNow = true
  on('ui.panes', () => ({ value: [{ id: 'mm-queue', title: 'Massmarket', isShown: shownNow, isFocused: false, isPlaced: placed }] }))
  /** (0.6.0) Every status line the bridge set, in order (undefined: cleared). */
  const statuses: Array<string | undefined> = []
  on('ui.status', (_$, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    // (0.7.40) a submit the engine refuses (a Stop stands, a host's limit reached), or one that fails outright
    if (opts.submit === 'drop') return { drop: 'a Stop hook stands' }
    if (opts.submit === 'throws') throw new Error('the session could not take a prompt')
    prompts.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  // (0.5.25) the person's prompt box: what a Start press reads, and what it writes there
  const box = { text: opts.box ?? '' }
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: opts.box === null ? '' : box.text, cursor: box.text.length } }))
  on('prompt.fill', (_$, e) => {
    if (opts.box === null) return { isFilled: false, refusal: 'no_composer' as const }
    fills.push(e.text)
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    return { isFilled: true }
  })
  /** What the bridge added to this thread's transcript for the model to read (user rows). */
  const appended: string[] = []
  /** (0.7.41) The notices it added: rows the person sees in the chat and the model never reads (`system` rows). */
  const notices: string[] = []
  on('session.append', (_$, e, next) => {
    ;(e.message.type === 'system' ? notices : appended).push(JSON.stringify(e.message))
    return next(e)
  })

  /**
   * What a sync must never call: a message into a thread, or a chip. (0.5.2, R4/R5: the TIMER mints a chip by
   * itself for a client that needs a new thread, never a sync or a command: a test that runs the timer says
   * which chips it expects.)
   */
  const acted = () => calls.filter(c => c.tool === 'send_message' || c.tool === 'spawn_task')
  /** The chips this session asked the app for. */
  const minted = () => calls.filter(c => c.tool === 'spawn_task')
  return {
    clock, stored, threads, calls, prompts, opened, toasts, fetched, registered, acted, minted, reads, hookReads, lists, written, appended, notices, ran, renders, shell, box, fills, resolves, statuses, closes, scopePosts, pinPosts, browserPosts,
    /** The app calls that change a thread: a rename, a pin, a message, a chip. (Reading this session's own usage, and withdrawing a chip, change none.) */
    writes: () => calls.filter(c => !['get_session', 'list_sessions', 'get_usage', 'dismiss_task'].includes(c.tool)).map(c => [c.tool, c.args.session_id ?? '', c.args.title ?? c.args.pinned ?? ''].join(' | ')),
    /** The chips this session asked the app to withdraw, by their ids. */
    dismissed: () => calls.filter(c => c.tool === 'dismiss_task').map(c => String(c.args.task_id)),
    /** The argument array of every program the bridge started. */
    argvs: () => ran.map(r => (JSON.parse(r) as { argv: string[] }).argv),
    /** How often this session asked the app for its usage, and for whom. */
    usageAsked: () => calls.filter(c => c.tool === 'get_usage').map(c => String(c.args.session_id)),
    freeSeconds: () => freeSeconds,
    setPlaced: (can: boolean) => {
      placed = can
    },
    setShown: (is: boolean) => {
      shownNow = is
    },
    setTree: (tree: unknown) => {
      treeNow = JSON.stringify(tree)
    },
    setPickup: (answer: Record<string, unknown>) => {
      pickupNow = answer
    },
    /** (0.7.36) The sub-agents `$.agent.list()` answers from now on. */
    setAgents: (list: typeof agentsNow) => {
      agentsNow = list
    },
    /** (0.7.36) The next pickup read waits until this returns' `release` is called, and `reached` says it has got there. */
    holdPickup: () => {
      let release = () => {}
      const gate = new Promise<void>(r => (release = r))
      let at = false
      pickupGate = { gate, arrived: () => void (at = true) }
      return { release, reached: () => at }
    },
    setFeed: (f: Feed) => {
      theFeed = f
    },
    /** (0.5.12) The most start_session calls the app had in hand at the same time. */
    mostStartsAtOnce: () => mostStartsAtOnce,
    /** (0.5.24) The most Start cards the app had in hand at the same time. */
    mostCardsAtOnce: () => mostCardsAtOnce,
  }
}

/** The messages a test's world sent into threads (0.5.2: the timer mints chips by itself, R4/R5; a message only ever goes from a press or a typed command). */
export const sends = (w: { acted: () => Call[] }) => w.acted().filter(c => c.tool === 'send_message')
/** The app calls that change a thread, without the chips the timer mints by itself (R4/R5). */
export const threadWrites = (w: { writes: () => string[] }) => w.writes().filter(x => !x.startsWith('spawn_task |'))
/** The titles of the chips this session minted, in order. */
export const chipTitles = (w: { acted: () => Call[] }) => w.acted().filter(c => c.tool === 'spawn_task').map(c => String(c.args.title))

/** In the app's usage answer, beside the context: what the bridge must never read or keep. */
export const PLAN_MARK = 'PLAN-DO-NOT-KEEP'
/** What a shell command answers in these tests: a mark the bridge must never read or keep. */
export const SHELL_OUT = 'SHELL-OUTPUT-DO-NOT-KEEP'
/** A chip's id as the app answers a mint: the n-th one minted in a test. */
export const chipId = (n: number) => `task_${String(n).padStart(8, '0')}`

/** The band above the prompt, as the engine hands it to a hook. */
export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 5 }, view: {} }

export const PANE = { title: 'Needs you', isFocused: false, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
export const COMPOSER = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

export const mm = async ($: Engine, args: string): Promise<string> => String((await $.command.run({ command: 'mm', args, ...COMPOSER })).text ?? '')
export const pane = ($: Engine) => $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-queue', props: PANE })
export type Drawing = { findAll: (query: { type?: string; key?: string }) => Promise<FoundElement[]> }
/** Every text the pane draws, top to bottom. */
export const lines = async (ui: Drawing): Promise<string[]> =>
  // (0.7.34) a row's pin mark has tests of its own; the Needs you now heading is a button now, and reads as the heading it is
  (await ui.findAll({})).flatMap(e => (e.type === 'Text' && !PIN_MARKS.has(e.text) ? [e.text] : e.key === 'mm-needs-toggle' ? [e.text.replace(/\s+[▾▸]$/, '')] : []))
export const PIN_MARKS = new Set(['●', '○'])
export const buttons = async (ui: Drawing): Promise<Array<[string, string]>> => (await ui.findAll({ type: 'Button' })).map(b => [String(b.key), String(b.props.label)])

export const ACME_TITLE = '🟡 21h left · Acme Roofing · reply ready'
export const BOLT_TITLE = '🟡 22h left · Bolt Staffing · reply · 2 new'
export const CEDAR_TITLE = '🔴 5h left · Cedar Dental · task'
// The project's name as the kickoff carries it: cleaned, so the dash in "Acme Roofing — Pat" is a space.
/** (0.7.39) A signature keeps the page's name from before 0.7.39, so a new name updates nobody's thread (`signatureOf`). */
export const inOldWords = (kickoff: string): string => kickoff.split('the one-package page').join('the five-part pickup view')
/**
 * (0.7.44, Rob 2026-11-10: "we always want it to be parent threads") A prompt a new client thread opens with (a chip, a card,
 * kickoffs' arguments): the kickoff with the top-level step as its second paragraph. What the bridge records it by (its
 * signature) is the kickoff without it, as before.
 */
export const stepped = (kickoff: string): string => withTopLevelStep(kickoff)
export const ACME_KICKOFF = `[mm-link ${ACME}] Pick up the reply drafts for Acme Roofing Pat (OW project ${ACME}). Load the client's project skill first, then follow client-reply-prep §9: show the one-package page for package aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee and wait for me. Send nothing without my go.`
export const BOLT_KICKOFF = `[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the one-package page and wait for me. Send nothing without my go.`

/** Acme's thread carries Acme's name, whatever the hours left on the test's clock by then. */
export const ACME_NAMED = /^🟡 \d+h left · Acme Roofing · reply ready$/
export const CEDAR_KICKOFF = `[mm-link ${CEDAR}] Cedar Dental (OW project ${CEDAR}) has 1 committed task(s) due Mon, Oct 12 4 PM ET. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`
/**
 * (0.5.2, R4) A client on the list with no thread at all, due within the pin's window: its row's name. (0.7.5, the panel
 * redesign) Its one line, ending ` · no thread`, and red while it pins now.
 */
export const CEDAR_FRESH = '🔴 Cedar Dental · task · 5h left · no thread'
export const BOLT_FRESH = '🔴 Bolt Staffing · reply · 22h left · 2 new · no thread'
export const ACME_FRESH = '🔴 Acme Roofing · reply ready · 21h left · no thread'
/**
 * (0.7.5, the panel redesign) A client's row in the pane: ONE line, the chip, the client, what is needed, the time left
 * (the thread's own name, ACME_TITLE and the others, is unchanged).
 */
export const ACME_ROW = '🟡 Acme Roofing · reply ready · 21h left'
export const BOLT_ROW = '🟡 Bolt Staffing · reply · 22h left · 2 new'
export const CEDAR_ROW = '🔴 Cedar Dental · task · 5h left'
/** (0.7.5) The pane's one clock, at NOW in the person's own time (11:00 AM in New York; CI runs in UTC). */
export const UPDATED = `Updated ${localClock(NOW)}`
/** (0.7.9) The second line of an Update row whose linked thread is due to be updated by itself, as a sync at NOW words it. */
export const SOON = 'updates itself at about 11:10 AM'
/** Bolt's chip, as the timer mints it by itself (R4): Bolt has no thread either in a world with no threads. */
export const BOLT_AUTO_CHIP = {
  server: 'ccd_session',
  tool: 'spawn_task',
  args: {
    title: 'Bolt Staffing: reply to the client',
    tldr: 'Bolt Staffing needs you: Bolt Staffing · reply due tomorrow 9 AM · 2 new. Start this to open a thread for that client with the drafts or the messages waiting.',
    // (0.7.44) a chip's prompt carries the top-level step as its second paragraph (`stepped`)
    prompt: stepped(`[mm-link ${'22222222-2222-2222-2222-222222222222'}] Bolt Staffing (Sam) (OW project ${'22222222-2222-2222-2222-222222222222'}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the one-package page and wait for me. Send nothing without my go.`),
  },
}
/**
 * (0.5.2, R4/R5) The chip the TIMER mints by itself in a thread for Cedar, the client with no thread, as the
 * app is asked for it: 0.5.1's title, line and kickoff.
 */
export const CEDAR_AUTO_CHIP = {
  server: 'ccd_session',
  tool: 'spawn_task',
  args: { title: 'Cedar Dental: reply to the client', tldr: 'Cedar Dental needs you: Cedar Dental · task due 4 PM. Start this to open a thread for that client with the drafts or the messages waiting.', prompt: stepped(CEDAR_KICKOFF) },
}

/**
 * (0.5.4, C1: Rob, 10-14, "yes chips") The ONE chip for Acme, minted by itself in the thread Acme is linked to and
 * in no other: its kickoff, to run there with the app's Do it here.
 */
export const ACME_HERE_CHIP = {
  server: 'ccd_session',
  tool: 'spawn_task',
  args: { title: 'Do it here: Acme Roofing: review the reply drafts', tldr: 'Acme Roofing needs you: Acme Roofing · reply ready due tomorrow 8 AM. Recommended: Do it here.', prompt: stepped(ACME_KICKOFF) },
}

/** (0.5.11, Opus 10-15, verbatim) A kickoff sent by itself for drafts that are ready: shown, never taken. */
export const NOT_TAKEN = (pid: string, name: string) =>
  `[mm-link ${pid}] The reply drafts for ${name} (OW project ${pid}) are ready in package aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee. Load the client's project skill first, then follow client-reply-prep §9 to show the one-package page for that package, but do not take it: no pickup call until I answer here, so the team can still pick it up. Then wait for me. Send nothing without my go.`
/** (0.5.11, Opus 10-15, verbatim) Bolt's kickoff sent by itself: no package yet, so prep builds one, and it is not taken. */
export const BOLT_AUTO_KICKOFF = `[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Load the client's project skill first, then follow client-reply-prep: no package exists yet, so run prep (§2) to build one, then show the one-package page without taking the package: no pickup call until I answer here. Then wait for me. Send nothing without my go.`
/** (0.7.14, Opus 10-30, verbatim) Bolt's update sent by itself while Lane-2 may still build its drafts: they follow, no prep. */
export const BOLT_WAIT_KICKOFF = `[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Lane-2 is building the reply drafts, and they come into this thread as a second update once they are ready. Load the client's project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep before the drafts come unless I ask you to. Send nothing without my go.`
/**
 * (0.5.11, Rob 10-15: "I think we should start updating threads automatically") What a sync sends by itself into
 * Bolt's linked thread when it is another thread: (review of PR #15, F4) the marker first, then Update's first line,
 * then the words that never take a package. (0.7.14) 10 minutes after the mail was first seen, saying the drafts follow.
 */
export const BOLT_AUTO_UPDATE = (sid: string) => ({
  server: 'ccd_session_mgmt',
  tool: 'send_message',
  args: { session_id: sid, message: markerFirst(`New since this thread last worked on this client: 2 messages waiting.\n${BOLT_WAIT_KICKOFF}`) },
})
/**
 * (0.7.14) Its follow-up when no drafts came in the 120 minutes after the mail was first seen: case 6 sent by itself, run
 * prep, with no "New since" line (nothing new came).
 */
export const BOLT_PREP_UPDATE = (sid: string) => ({
  server: 'ccd_session_mgmt',
  tool: 'send_message',
  args: { session_id: sid, message: BOLT_AUTO_KICKOFF },
})
/** (0.5.11, review of PR #15, F4) An update sent by itself: its body's marker moved to the very start of the text. */
export function markerFirst(text: string): string {
  return text.replace(/^([^\n]*)\n(\[mm-link [0-9a-f-]{36}\] )/, '$2$1\n')
}

/** (0.5.4, C3, verbatim) The band's sentence, in every thread, for a client with no thread whose one chip is in `place` (this world's own thread, by default). */
export const chipIn = (client: string, due: string, place = 'Morning hub') => `🔴 ${client} has no thread (due ${due}): its chip is in ${place}.`

/** A thread's name as a sentence shows it: cleaned like any text that is not the bridge's own. */
export const ACME_SHOWN = '21h left Acme Roofing reply ready'
export const BOLT_SHOWN = '22h left Bolt Staffing reply 2 new'

/** The pairs two sessions wrote about themselves: Claude Code session id → the app thread it runs in. */
export const PAIRS = { 'cli-acme': { app: 'local_a', at: NOW }, 'cli-bolt': { app: 'local_b', at: NOW } }
export const declared = (projectId: string, sessionId: string, hoursAgo: number) => ({ project_id: projectId, session_id: sessionId, last_activity_at: ago(hoursAgo) })

// ======================================================================== the independent review, 2026-10-12
// Two blockers and seven should-fixes. Each of the reviewer's 25 probes is here as a regression test with
// the probe's id in brackets, asserting the fixed behaviour; the tests the fixes themselves call for sit
// beside them.

export const tool = async ($: Engine, args: string): Promise<string> => String(((await $.tool.call({ tool: 'mcp__mm-bridge__mm', args } as never)) as { result?: unknown }).result ?? '')
export const ONLY_UPDATE = 'Only the person can do this: press Update thread in the pane or type /mm update <client>.'
export const ONLY_START = 'Only the person starts a thread: they press Start thread in the pane or type /mm start <client>, which puts their words in the prompt box. On a turn the person typed to ask for it, call mm with "kickoffs <client>" (or "kickoffs" for every missing thread) and start each with start_session as it says.'
export const NO_LIST = 'The app\'s thread list is not available here.'
export const GONE = 'That thread is no longer available. The list has been refreshed.'
/** Everything the store holds, as one string: for "nothing was written". */
/** The store as it stands, but for (0.5.4, C3) the record of which threads run and where the person last wrote: every prompt of theirs writes it. */
/** What the store holds, less what any running thread writes for itself: its tick (`mm.seen`), and (0.6.0) OW's skill map as it read it. */
export const snapshot = (w: { stored: Record<string, unknown> }) => JSON.stringify({ ...w.stored, 'mm.seen': undefined, 'mm.skills': undefined })

// ======================================================================== one action a row, the band, long threads, chips
// Rob, 2026-10-12, on seeing 0.4.0: "it should be 'update thread', 'open thread', or 'start thread'... depending
// on whether you know what we should do", and "How do we open this panel up in other threads where it's not
// already open?"

export const bandOf = ($: Engine, props: typeof BAND_PROPS = BAND_PROPS) => $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props })
/**
 * (0.7.49) The person's close of the side pane drawn for `pid`, which the test kit cannot raise (its `$` has no `ui.close`, and a
 * close's origin is the engine's to stamp): this session's record reads as `rememberClose` leaves it (`afterPersonClose`: the
 * project the pane was drawn for) from `close()` on, until the bridge next writes the record, which keeps it (`setSess` writes
 * the record as it read it) unless that write ends the close, as an open of the pane does.
 */
export const personClose = (on: On, pid: string) => {
  let closing = false
  on('state.get', { plugin: 'mm-bridge' }, async (_$, e, next) => {
    const got = (await next(e)) as { value: { value?: unknown } }
    if (!closing || e.key !== 'sess') return got as never
    const was = got.value?.value && typeof got.value.value === 'object' ? (got.value.value as Record<string, unknown>) : {}
    return { value: { ...got.value, value: { prompts: 0, ...was, closed: pid } } } as never
  })
  on('state.set', { plugin: 'mm-bridge' }, async (_$, e, next) => {
    if (e.key === 'sess') closing = false
    return next(e)
  })
  return { close: () => { closing = true } }
}
/** A client's buttons on the pane, by their labels. */
export const buttonsOf = async (ui: Drawing, projectId: string): Promise<string[]> => (await buttons(ui)).filter(b => b[0].endsWith(projectId)).map(b => b[1])
/** (0.7.5) The text the pane draws right under a row's one line: its second line where it has one, else what comes next. */
export const under = async (ui: Drawing, row: string): Promise<string | undefined> => {
  const all = await lines(ui)
  const at = all.findIndex(l => l.endsWith(row))
  return at < 0 ? undefined : all[at + 1]
}
/** The feed, with something changed on Acme's package and the sessions it lists. */
export const acmeFeed = (over: Record<string, unknown> = {}, threads: NonNullable<Feed['threads']> = [declared(ACME, 'cli-acme', 30)]): Feed => {
  const f = feed({ threads })
  f.drafts = (f.drafts ?? []).map(d => ({ ...d, ...over }))
  return f
}
/** Acme has a thread, linked by itself, that has not been given what is waiting. */
export const acmeWorld = (on: On, over: WorldOptions = {}) => world(on, { feed: acmeFeed(), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS }, ...over })
export const HANDOVER = (title: string, sid: string, name: string, before = 'Before the pickup view') =>
  `This thread replaces "${title}" (thread ${sid}) for ${name}. ${before}, and without reading that thread in full: read only its last three messages with the session tools (list_events, a small limit) and list anything left open in it: a question waiting on me, something promised and not done, a draft that was not sent. Keep that list to ten lines, then carry on.`

// ======================================================================== the close-out list (Rob, 2026-10-12)
// (m) to (u): a package the caller holds is theirs; its thread links, is named, pinned and ticked like any
// other; a sync follows a draft that was sent or discarded; the founder sees what waits for his OK; nothing
// drops off silently; a pin taken off by hand stays off; a client whose drafts a teammate holds is not the
// viewer's.

export const FOUNDER = 'owner@example.com'
export const TEAMMATE_B = 'builder-b@example.com'
/** A reply package for a client, covering its mail through three hours ago: prepared, one draft ready. */
export const packageFor = (projectId: string, name: string, over: Record<string, unknown> = {}) => ({
  package_id: PKG, project_id: projectId, project_name: name, status: 'prepared', covers_through: ago(3), drafts_ready: 1, drafts_unsent: 1,
  flagged_for_rob: false, picked_up_by: null, picked_up_at: null, project_owner_email: ME, ...over,
})
export const heldBy = (by: string, over: Record<string, unknown> = {}) => ({ status: 'picked_up', picked_up_by: by, picked_up_at: ago(1), ...over })
/** An unanswered client message, received so many hours ago. */
export const mailFor = (projectId: string, name: string, hoursAgo: number, over: Record<string, unknown> = {}) => ({
  message_id_key: `${projectId}-${hoursAgo}`, received_at: ago(hoursAgo), sender: 'client@example.com', subject: 'Question', snippet: 'hello',
  project_id: projectId, project_name: name, reply_status: 'unanswered', project_owner_email: ME, ...over,
})
/** Our own pin on a client's thread, as an earlier sync left it on record. */
export const ourPin = (projectId: string, client: string) => ({ projectId, client, byUs: true })
export const tickOnce = async ($: Engine, w: { clock: { advance: (ms: number) => Promise<void> } }) => {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
  await w.clock.advance(4_000)
}
export const closeouts = (w: { fetched: string[] }) => w.fetched.filter(u => u.includes('/closeout')).length

// ======================================================================== 0.5.7

/** (0.5.7) The threads started now (start_session user_asked), and the proposal cards (own_initiative). */
export const starts = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'start_session' && c.args.initiation !== 'own_initiative')
export const proposals = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'start_session' && c.args.initiation === 'own_initiative')
/** The feed with Cedar alone: a committed task due at 4 PM today, and no thread. */
export const cedarAlone = () => feed({ drafts: [], mail: [] })

/** (0.5.24) A client's Start cards on record, not superseded. */
export const cardsFor = (w: { stored: Record<string, unknown> }, pid: string) => ((w.stored['mm.chips'] ?? []) as Array<{ projectId: string; threadId: string; prompt: string; taskId: string; superseded?: boolean }>).filter(c => c.projectId === pid && !c.superseded)
/** (0.5.24) What a press said once a client's Start card was up in this thread. */
export const CEDAR_CARD = 'A Start card for Cedar Dental is ready here: click Start on it.'

/** (0.5.25) What Start missing threads (and /mm start all) puts in the prompt box, and what the press says then. */
export const START_ALL = 'Start the missing client threads'
export const FILLED_ALL = `"${START_ALL}" is in the prompt box: press Enter to send it. Claude starts each missing thread, and the app asks you to allow each one.`
/** (0.5.25) A row's Start (and /mm start <client>): the client's words, and what the press says. */
export const startOf = (client: string) => `Start ${client}'s thread`
export const filledOne = (client: string) => `"${startOf(client)}" is in the prompt box: press Enter to send it. Claude starts the thread, and the app asks you to allow it.`
/** (0.5.25) The threads the mm tool's `kickoffs` hands Claude: each client, and start_session's arguments. */
export type Kick = { client: string; arguments: Record<string, unknown> & { prompt: string; title: string; background: string } }
export const kicksIn = (text: string): Kick[] => JSON.parse(text.split('\n').find(l => l.startsWith('[{')) ?? '[]') as Kick[]
export const kickoffsOf = async ($: Engine, arg = ''): Promise<Kick[]> => kicksIn(await tool($, `kickoffs${arg ? ` ${arg}` : ''}`))
/** (0.5.25) Every call to start_session: (0.7.34) a no-thread client's card, or a start. */
export const sessionCalls = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'start_session')

// ======================================================================== 0.6.0: every client thread linked, the pane always open
// Rob, 2026-10-25: "I think we need the side panel to be open on all bridge-connected threads... anytime a team member
// is talking about a client, the bridge connects, even if there's more than one thread per client... It also gives them
// confirmation that their current work is being tracked."

export const INTERNAL = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
export const FUNNEL = 'd9fe5433-0000-4000-8000-000000000000'
export const SKILL_MAP = {
  as_of: new Date(NOW).toISOString(),
  skills: [
    { skill_key: 'acme-roofing-project', project_id: ACME, name: 'Acme Roofing — Pat', kind: 'client' },
    { skill_key: 'bolt-staffing-project', project_id: BOLT, name: 'Bolt Staffing (Sam)', kind: 'client' },
    { skill_key: 'cedar-dental-project', project_id: CEDAR, name: 'Cedar Dental', kind: 'client' },
    { skill_key: 'massmarket-internal-ops', project_id: INTERNAL, name: 'Massmarket internal ops', kind: 'internal_ops' },
    { skill_key: 'massmarket-self-funnel', project_id: FUNNEL, name: 'Massmarket self-funnel', kind: 'self_funnel' },
  ],
}
export const skillsOk = () => ({ status: 200, body: SKILL_MAP })
export const PAT = 'pat-morgan@example.com'
export const TASK = 'Phase 1 nurture sequence copy'
/** OW's client-time answer for Acme: two threads (this one and Pat's), three tasks today. */
export const clientTimeBody = (canSeeLeverage: boolean, over: Record<string, unknown> = {}) => {
  const people = [{ email: ME, name: 'Builder A', minutes: 95 }, { email: PAT, name: 'Pat Morgan', minutes: 30 }]
  return {
    as_of: new Date(NOW).toISOString(), day: '2026-10-12', week_start: '2026-10-12',
    viewer: { email: ME, can_see_leverage: canSeeLeverage },
    skipped: [],
    projects: [{
      project_id: ACME, name: 'Acme Roofing — Pat',
      today: {
        client_minutes: 125, by_source: { claude_code: 100, timer: 25, browser: 0, meeting: 0 }, thread_minutes: 162, parallel: 1.296, jarvis_minutes: 18, people,
        tasks: [
          { task: TASK, ticket_id: null, minutes: 64, thread_count: 1, people: [ME], last_activity_at: ago(0.1), active_now: true },
          { task: 'f779a7a0 Fix inbound router', ticket_id: 'f779a7a0', minutes: 42, thread_count: 1, people: [PAT], last_activity_at: ago(1), active_now: false },
          { task: null, ticket_id: null, minutes: 19, thread_count: 2, people: [ME, PAT], last_activity_at: ago(2), active_now: false },
        ],
      },
      week: { client_minutes: 610, by_source: { claude_code: 500, timer: 110, browser: 0, meeting: 0 }, thread_minutes: 790, parallel: 1.295, jarvis_minutes: 95, people, tasks: [] },
      threads: [
        { session_id: SELF_CLI, title: 'Acme nurture build', member_email: ME, member_name: 'Builder A', task: TASK, ticket_id: null, minutes_today: 83, last_activity_at: ago(0.1), active_now: true },
        { session_id: 'cli-pat', title: null, member_email: PAT, member_name: 'Pat Morgan', task: 'f779a7a0 Fix inbound router', ticket_id: 'f779a7a0', minutes_today: 42, last_activity_at: ago(1), active_now: false },
      ],
      leverage: { ratio: 3.4, build_hours: 41, actual_hours: 12.1, window: 'last 20 business days', note: '' },
      ...over,
    }],
  }
}
/** (OW contract 2026-10-25) An answer shaped by the call's `periods`: a period not asked for is null, threads come with today, leverage with the week. */
/** A query parameter of a URL the bridge fetched (the test runtime may have no URL class). */
export const param = (url: string | undefined, name: string): string | null => {
  const m = new RegExp(`[?&]${name}=([^&]*)`).exec(url ?? '')
  return m ? decodeURIComponent(m[1] ?? '') : null
}
export const byPeriods = (body: ReturnType<typeof clientTimeBody>, url: string) => {
  const periods = (param(url, 'periods') ?? 'today,week').split(',')
  const today = periods.includes('today')
  const week = periods.includes('week')
  return {
    ...body,
    projects: body.projects.map(p => ({ ...p, today: today ? p.today : null, threads: today ? p.threads : [], week: week ? p.week : null, leverage: week ? p.leverage : null })),
  }
}
export const timeOk = (canSeeLeverage = true) => (url: string) => ({ status: 200, body: byPeriods(clientTimeBody(canSeeLeverage), url) })
/** The periods each client-time call asked for, in order. */
export const periodsAsked = (w: { fetched: string[] }) => w.fetched.filter(u => u.includes('/client-time')).map(u => param(u, 'periods'))
/** The projects one client-time call asked for. */
export const idsAsked = (u: string | undefined) => new Set((param(u, 'project_ids') ?? '').split(','))
/**
 * (0.7.5, the panel redesign) The Tracking part's one line, as the fixture draws it: this thread's client, its task and its
 * minutes today. It is a button at the bottom of the pane: the part is closed to it until it is pressed.
 */
export const HEAD = (task: string | undefined) => `⏱ This thread: Acme Roofing · ${task ?? 'no task declared yet'} · 1h 23m today`
/** (0.7.5) Today's numbers, in plain words. */
export const TODAY_LINE = 'Today: 2.1 h of your time · 2.7 h of thread time'
/** (0.7.5) Pat's task in the one time list: its one thread is on this computer, so the row is a button that opens it. */
export const PAT_ROW = 'f779a7a0 Fix inbound router · 42m · Pat'
/** (0.7.5) The one time list by task, as `tree` draws it: this thread's own task, Pat's, and the minutes with no task. */
export const TASKS = [`${TASK} · 1h 04m · Builder (this thread)`, `[${PAT_ROW}]`, 'No task declared · 19m · Builder, Pat · 2 threads']
/** (0.7.5) Behind More: the week, parallel and Jarvis in plain words (then leverage, then the note). */
export const NUMBERS = ['This week: 10.2 h of your time · 13.2 h of thread time', 'Parallel: 1.3× today · 1.3× this week', 'Jarvis: 0.3 h today · 1.6 h this week']
export const LEVERAGE = 'Leverage: 3.4× (41.0 quoted hours done in 12.1 h, last 20 business days)'
export const NOTE_LINE = 'Your time counts each minute once per person. Thread time counts every thread in full, so two threads at once count twice. Parallel is thread time divided by your time. Jarvis is work done for Acme Roofing with nobody in the thread.'
/** (0.7.5) The Tracking part as the fixture draws it (`tree`), opened and its More opened: from its one line to the note. */
export const TRACKED = (task: string | undefined, leverage = true) => [
  `[${HEAD(task)}  ▾]`,
  TODAY_LINE,
  ...TASKS,
  '[More  ▾]',
  ...NUMBERS,
  ...(leverage ? [LEVERAGE] : []),
  `(dim) ${NOTE_LINE}`,
]
export type Pressable = { press: (q: { key: string }) => Promise<unknown> }
/** (0.7.5) Opens the Tracking part (it opens on a press of its one line), and with `more` its further numbers. The fold holds for the thread. */
export const openTrack = async (ui: Pressable, more = false): Promise<void> => {
  await ui.press({ key: 'mm-track-head' })
  if (more) await ui.press({ key: 'mm-track-more' })
}
/** (0.7.5) The Tracking part's one line: the label of its button. */
export const trackHead = async (ui: Drawing): Promise<string | undefined> => (await buttons(ui)).find(([key]) => key === 'mm-track-head')?.[1]
/** (0.7.5) The Tracking part as `tree` draws it: from its one line down to the pane's `Updated` line (not included). */
export const trackPart = (drawn: string[]): string[] => {
  const at = drawn.findIndex(l => l.startsWith('[⏱ '))
  if (at < 0) return []
  const end = drawn.findIndex((l, n) => n > at && l.startsWith('(dim) Updated '))
  return drawn.slice(at, end < 0 ? undefined : end)
}
/** Every fetch the bridge made is a read of one of its own GET routes: never a pickup, a hold or a resolve. */
// (0.7.23) and the sync's pin report (`/bridge-pins`): what is pinned and what should be, never a pickup, a hold or a claim
// (0.7.53) and Working manually in browser (`/browser-now`): its read records a new stretch's question, never an answer
export const onlyReads = (w: { fetched: string[] }) =>
  w.fetched.every(u => /\/api\/ext\/(?:closeout\?|skill-map$|client-time\?project_ids=|reply-package\?package_id=[0-9a-f-]+&format=pickup$|team-ask\?|bridge-pins$|team-now$|browser-now$)/.test(u))
export const skill = async ($: Engine, name: string, over: Record<string, unknown> = {}) => $.tool.call({ tool: 'Skill', skill: name, ...over } as never)
export const person = async ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
/** Everything a mounted drawing shows, in order: each Text, and each Button as `[label]`. */
export const tree = async (ui: { drawn: () => Promise<unknown> }): Promise<string[]> => {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') return
    if (Array.isArray(node)) return node.forEach(walk)
    const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    const kids = el.children ?? el.props?.children
    const text = (v: unknown): string => (Array.isArray(v) ? v.map(text).join('') : typeof v === 'string' || typeof v === 'number' ? String(v) : '')
    if (el.type === 'Text') return void out.push(`${el.props?.bold ? '**' : ''}${el.props?.dimColor ? '(dim) ' : ''}${text(kids)}`)
    if (el.type === 'Button') return void out.push(`[${String(el.props?.label ?? '')}]`)
    if (el.type === 'Markdown') return void out.push(`<markdown: ${String(el.props?.text ?? '').split('\n')[0]}>`)
    walk(kids)
  }
  walk(await ui.drawn())
  return out
}

// ======================================================================== 0.7.0: the deliverable line the work counts toward
// Rob, 2026-10-26: "I want the live panel not just to show what clients are being tracked, but also the task that it
// thinks we're working on. Maybe even separately, it could show which specific deliverable line those hours are being
// added for. If it's something that's a new scope, it would be showing up on a new line. That probably should trigger
// the thread to ask for approval to create the new line, or ask if it would be reconciled." Every line is a fixture.

export const L_COPY = 'L-1a2b3c4d'
export const L_ROUTER = 'L-2b3c4d5e'
export const L_SITE = 'L-3c4d5e6f'
export const L_BANK = 'L-4d5e6f7a'
/** Acme's quote as a PM sees it: three deliverables and an hour bank. */
export const QUOTE_LINES = [
  { line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable', status: 'active', estimate_hours: 12, minutes: 64 },
  { line_key: L_ROUTER, title: 'Inbound lead router and assignment rules', line_type: 'deliverable', status: 'active', estimate_hours: 6, minutes: 42 },
  { line_key: L_SITE, title: 'Website refresh', line_type: 'deliverable', status: 'active', estimate_hours: 20, minutes: 0 },
  { line_key: L_BANK, title: 'Support hour bank', line_type: 'bank', status: 'active', estimate_hours: 10, minutes: 19 },
]
export const PROPOSAL = { ticket_id8: 'abcdef12', title: 'Spanish landing page', created_at: ago(2) }
export const ON_LINE = { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable', estimate_hours: 12, signal: 'on_line', candidates: [], proposal: null }
export const CANDIDATES = [
  { line_key: L_SITE, title: 'Website refresh', line_type: 'deliverable' },
  { line_key: L_ROUTER, title: 'Inbound lead router and assignment rules', line_type: 'deliverable' },
  { line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable' },
]
export const NEW_SCOPE = { via: 'none', line_key: null, title: null, line_type: null, estimate_hours: null, signal: 'maybe_new_scope', candidates: CANDIDATES, proposal: null }
export const UNMATCHED = { ...NEW_SCOPE, signal: 'unmatched' }
export const PROPOSED = { via: 'none', line_key: null, title: null, line_type: null, estimate_hours: null, signal: 'proposed', candidates: [], proposal: { ticket_id8: 'abcdef12', title: 'Spanish landing page' } }

/**
 * OW's client-time answer for Acme with lines (`with=lines`): the quote's lines (a non-PM sees no minutes on an
 * estimated line), its proposals, this thread's line, and the first two tasks on their lines.
 */
export const linesBody = (o: { line?: Record<string, unknown>; pm?: boolean; lines?: unknown[]; proposals?: unknown[]; threadTask?: string | null; project?: string } = {}) => {
  const base = clientTimeBody(o.pm ?? true, o.project ? { project_id: o.project } : {})
  const p = base.projects[0] as (typeof base.projects)[number]
  const lines = o.lines ?? (o.pm === false ? QUOTE_LINES.map(l => (l.line_type === 'bank' ? l : { ...l, minutes: null })) : QUOTE_LINES)
  return {
    ...base,
    projects: [{
      ...p,
      lines,
      proposals: o.proposals ?? [],
      today: { ...p.today, tasks: p.today.tasks.map((t, n) => (n === 0 ? { ...t, line_key: L_COPY } : n === 1 ? { ...t, line_key: L_ROUTER } : t)) },
      threads: p.threads.map(t => (t.session_id === SELF_CLI ? { ...t, ...(o.threadTask !== undefined ? { task: o.threadTask } : {}), ...(o.line ? { line: o.line } : {}) } : t)),
    }],
  }
}
export const linesOk = (o: Parameters<typeof linesBody>[0] = {}) => (url: string) => ({ status: 200, body: byPeriods(linesBody(o) as ReturnType<typeof clientTimeBody>, url) })
/** A world where this thread is Acme's, its task declared, and OW answers its time with `answer`. */
export const linedWorld = (on: On, answer: WorldOptions['clientTime'], over: WorldOptions = {}, task: string = TASK) =>
  world(on, {
    skillMap: skillsOk,
    clientTime: answer,
    threads: [thread('local_pat', 'Pat on Acme', 1)],
    store: { 'mm.links': { [ACME]: SELF }, 'mm.threads': { 'cli-pat': { app: 'local_pat', at: NOW } }, 'mm.current': { [SELF]: { pid: ACME, how: 'skill', at: NOW - 60_000, task } } },
    ...over,
  })
export const started = async ($: Engine, w: { clock: { advance: (ms: number) => Promise<unknown> } }) => {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
  await w.clock.advance(4_000)
}
/**
 * The notes the time tracking added for Claude (`[mm-bridge] ...`), in order. (A thread the person linked also gets the
 * client part's own note, `[Massmarket bridge, no reply needed] ...`, as before 0.7.0: not one of these.)
 */
export const notes = (w: { appended: string[] }) => w.appended.map(a => String((JSON.parse(a) as { content: Array<{ text: string }> }).content[0]?.text ?? '')).filter(t => t.startsWith('[mm-bridge]'))
export const ASK_NOTE = `[mm-bridge] Massmarket time tracking: this thread's work ("${TASK}") does not match a line on Acme Roofing's quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: does it count toward "Website refresh" (${L_SITE}), "Inbound lead router and assignment rules" (${L_ROUTER}) or "Phase 1 nurture sequence" (${L_COPY}), is it new scope (small items go ahead and the client is told; bigger ones wait for their yes), or does it come out of their prepaid hours? Then act on the answer with the mm tool: "line <line_key>", "propose <title> -- <why> -- <N>h" or "bank" (prepaid hours). Keep working while you wait for the answer.`
export const bandLines = async ($: Engine) => {
  const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
  const out = { lines: await lines(b), buttons: await buttons(b) }
  await b.unmount()
  return out
}
export const lineButtons = (bs: Array<[string, string]>) => bs.filter(([key]) => key.startsWith('mm-line'))
export const proof = (name: string, drawn: string[]) => (globalThis as unknown as { console?: { log: (s: string) => void } }).console?.log(`RENDER-PROOF ${name}\n${drawn.join('\n')}\nEND-RENDER-PROOF`)
export const lastStatus = (w: { statuses: Array<string | undefined> }) => String(w.statuses.at(-1) ?? '')

// ======================================================================== 0.7.1: new scope goes ahead when small, waits for a yes when big
// Rob, 2026-10-26 (decision_log 99395076): new scope never comes out of revision hours. Small new scope (about 2 h or
// less) = tell the client and go (billed on the next invoice, or from prepaid hours not sold against quote lines);
// over 2 h or no estimate = wait for the client's yes; urgent (actively costing the client money) = carry on now; a
// client set to always ask first always waits; small unbilled items are capped at 2 h in all. The estimate is what is
// billed, never agent time. Every line is a fixture.

/** OW's answer for Acme with lines, and the project's new-scope fields `extra` (`prepaid_hours_left`, `always_ask`, `small_limit_hours`). */
export const settledOk = (extra: Record<string, unknown>, o: Parameters<typeof linesBody>[0] = {}) => (url: string) => {
  const body = linesBody(o)
  return { status: 200, body: byPeriods({ ...body, projects: body.projects.map(p => ({ ...p, ...extra })) } as ReturnType<typeof clientTimeBody>, url) }
}
/** OW's scope-proposal route as the 0.7.1 contract answers: the ticket, and how the new scope goes (`how`). */
export const proposalOk = (how: () => Record<string, unknown>, existing: () => boolean = () => false) => (body: Record<string, unknown>) =>
  ({ status: 200, body: { ok: true, ticket_id: 'abcdef12-0000-4000-8000-000000000000', ticket_id8: 'abcdef12', title: body.title, existing: existing(), ...how() } })
export const RUN_SPANISH = 'node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page"'
export const WHY = 'the client asked for a Spanish version on the call'

// ======================================================================== 0.7.11 (Rob, 2026-10-30)

/** (0.7.11) The app's records of two Claude profiles on this computer: the one the person left (A) and the one in use (B). */
export const PROFILES_ROOT = '/home/someone/Library/Application Support/Claude/claude-code-sessions'
export const PROFILE_A = `${PROFILES_ROOT}/acct-a/org-a`
export const PROFILE_B = `${PROFILES_ROOT}/acct-b/org-b`
/** One record file as the app writes it: `isStarred` is the sidebar's pin, `cliSessionId` and `cwd` say where its transcript is. */
export const profileRec = (dir: string, sid: string, over: Record<string, unknown> = {}) => ({
  [`${dir}/${sid}.json`]: { text: JSON.stringify({ sessionId: sid, isArchived: false, title: 'not read', ...over }), mtimeMs: NOW - HOUR },
})
export const minutesOn = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
  for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
}
export const awayLine = async (ui: Drawing): Promise<string | undefined> => (await lines(ui)).find(l => l.startsWith('You switched Claude profiles'))
export const DAYS = 24 * HOUR
