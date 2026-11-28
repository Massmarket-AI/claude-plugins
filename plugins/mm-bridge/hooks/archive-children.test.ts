// The bridge against a pretend desktop app, feed and store: finished threads under a pinned thread are archived (0.7.90).
//
// Rob, 2026-11-27, to the HL OW setup thread about its side sessions: "You should unpin your subthreads or archive them when
// they're finished to clear up clutter." Then: "and to focus me on the threads that actually need help, this should be how the
// bridge handles any pinned parent threads children". A pinned thread shows its children under it in the sidebar's Pinned
// section, so finished ones bury the threads that need him. Archiving can be undone; when in doubt the bridge leaves a thread.
//
// The app's answers modelled here were read in Claude.app 3.1795 (its tool descriptions and bundle, 2026-11-27): it asks the
// person before every archive_session except in bypass permissions (auto mode may ask), refuses a thread that is working,
// pinned or (outside bypass) on screen with an error answer, and answers `Archived session <id>.` when it archives. Every
// thread and client below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import { DETACH_SELF_NOTE, recordPrs, rowPrOpen } from './threads'
import type { Call, Thread, WorldOptions } from './register-world.test-helper'
import { NOW, HOUR, LONG, BOLT, SELF, PROFILE_B, feed, thread, world, tickOnce, profileRec, sends } from './register-world.test-helper'

const MIN = 60_000
/** The pinned thread the children are under. */
const P = 'local_par'
const RUN_TICKET = 'c3710000-0000-4000-8000-000000000009'
/** This thread, in bypass permissions (as the app answers `get_session self`), unless a test says otherwise. */
const me = (over: Record<string, unknown> = {}) => ({ ...thread(SELF, 'Builds lane', 0), permissionMode: 'bypassPermissions', ...over }) as Thread
/** A thread another started, as the app answers it: its parent named (by id and on the list) and not moved to top level. */
const child = (sid: string, hoursAgo = 2, parent = P, over: Record<string, unknown> = {}) =>
  ({ ...thread(sid, `${sid} work`, hoursAgo), parentSessionId: parent, startedBy: parent, detached: false, ...over }) as Thread
const pinnedParent = (over: Partial<Thread> = {}) => thread(P, 'HL OW setup', 1, { pinned: true, ...over })
/** A record whose last turn completed with nothing left, its pull request merged. */
const MERGED = { postTurnSummary: { status_category: 'completed', status_detail: 'Merged PR #5 on green; nothing waiting on you.' }, prs: [{ prNumber: 5, state: 'MERGED' }] }
/** A record whose last turn completed with nothing left, and no pull request: its deliverable handed over. */
const HANDED = { postTurnSummary: { status_category: 'completed', status_detail: 'Sent the research note to the thread that asked.' } }
const BLOCKED = { postTurnSummary: { status_category: 'blocked', status_detail: 'Waiting on Rob for the go.' } }
/** The app's records on this computer: this thread's own, and each thread's given here. */
const recs = (entries: Record<string, Record<string, unknown>>) =>
  Object.assign({}, profileRec(PROFILE_B, SELF), ...Object.entries(entries).map(([sid, over]) => profileRec(PROFILE_B, sid, over)))
/** Nothing on the feed for anyone: the sync pins and names nothing. */
const quietFeed = (): Feed => feed({ drafts: [], mail: [], tickets: {} })
const archives = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'archive_session').map(c => String(c.args.session_id))
const logOf = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('')
const archivedRec = (w: { stored: Record<string, unknown> }) => (w.stored['mm.archived'] ?? {}) as Record<string, { at: number; parent: string; ok: boolean | null; why?: string }>
const setup = (on: On, threads: Thread[], files: Record<string, Record<string, unknown>>, more: WorldOptions = {}) =>
  world(on, { feed: quietFeed(), self: me(), threads: [pinnedParent(), ...threads], files: recs(files), ...more })

describe('0.7.90 (Rob, 11-27: "this should be how the bridge handles any pinned parent threads children"): finished children of a pinned thread are archived', () => {
  // ---------------------------------------------------------------- what is archived

  test('a finished child (its PR merged, its last turn completed, quiet for 2 hours): archived through the app, on record, logged; nothing else', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1'])
    expect(w.calls.find(c => c.tool === 'archive_session')?.args).toEqual({ session_id: 'local_c1', reason: 'finished, under a pinned thread (mm-bridge)' })
    expect(w.threads.get('local_c1')?.isArchived).toBe(true)
    expect(archivedRec(w).local_c1).toMatchObject({ parent: P, ok: true })
    expect(logOf(w)).toContain(`archive: archived local_c1 under pinned ${P}: finished, its pull request merged or closed`)
    // ⛔ never a delete, a message, a pin or a name; the pinned thread itself stays
    expect(w.calls.some(c => c.tool === 'delete_session')).toBe(false)
    expect(w.writes()).toEqual(['archive_session | local_c1 | '])
    expect(w.threads.get(P)?.isArchived).toBe(false)
  })

  test('a finished child with no pull request (its deliverable handed over), last on screen an hour ago: archived', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: { ...HANDED, lastFocusedAt: NOW - HOUR } })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1'])
    expect(logOf(w)).toContain(`archive: archived local_c1 under pinned ${P}: finished`)
  })

  test('a pull request closed unmerged counts as done: archived', async ($, on) => {
    const w = setup(on, [child('local_c1', 2, P, { prNumber: 9, prState: 'CLOSED' })], { local_c1: { ...HANDED, prs: [{ prNumber: 9, state: 'CLOSED' }] } })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1'])
  })

  test('the person\'s own pin on the parent counts as the bridge\'s does: any pinned thread\'s children', async ($, on) => {
    // no pin record: the person pinned it
    const w = setup(on, [child('local_c1')], { local_c1: MERGED })
    await tickOnce($, w)
    expect(w.stored['mm.pins'] ?? {}).toEqual({})
    expect(archives(w)).toEqual(['local_c1'])
  })

  test('a finished child with a finished child of its own: both archived, the upper one first', async ($, on) => {
    const w = setup(on, [child('local_c1'), child('local_g1', 3, 'local_c1')], { local_c1: MERGED, local_g1: HANDED })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1', 'local_g1'])
  })

  test('a finished grandchild under an unfinished child: the grandchild alone', async ($, on) => {
    const w = setup(on, [child('local_c1'), child('local_g1', 3, 'local_c1')], { local_c1: BLOCKED, local_g1: HANDED })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_g1'])
    expect(archivedRec(w).local_g1).toMatchObject({ parent: P, ok: true })
  })

  test('at most 5 a sync: seven finished children, five now and two at the next sync', LONG, async ($, on) => {
    const kids = Array.from({ length: 7 }, (_, i) => child(`local_c${i}`, 2 + i))
    const w = setup(on, kids, Object.fromEntries(kids.map(k => [k.sessionId, MERGED])))
    await tickOnce($, w)
    expect(archives(w)).toHaveLength(5)
    // the pass lists every thread at most every 15 minutes: the sync 5 minutes on lists none
    await w.clock.advance(6 * MIN)
    expect(archives(w)).toHaveLength(5)
    await w.clock.advance(10 * MIN)
    expect(new Set(archives(w))).toEqual(new Set(kids.map(k => k.sessionId)))
    expect(archives(w)).toHaveLength(7)
  })

  // ---------------------------------------------------------------- what is left alone

  const left: Array<[string, Thread[], Record<string, Record<string, unknown>>]> = [
    ['still working (a turn in flight)', [child('local_c1', 2, P, { isRunning: true })], { local_c1: MERGED }],
    ['starting', [child('local_c1', 2, P, { starting: true })], { local_c1: MERGED }],
    ['in use in the last 10 minutes', [child('local_c1', 0.1)], { local_c1: MERGED }],
    ['holding an open PR, by the app\'s list', [child('local_c1', 2, P, { prNumber: 7, prState: 'OPEN' })], { local_c1: HANDED }],
    ['holding a PR in a merge queue, by the app\'s list', [child('local_c1', 2, P, { prNumber: 7, prState: 'QUEUED' })], { local_c1: HANDED }],
    ['holding an open PR, by its record (one merged, one open)', [child('local_c1')], { local_c1: { ...MERGED, prs: [{ prNumber: 5, state: 'MERGED' }, { prNumber: 6, state: 'OPEN' }] } }],
    ['pinned in its own right (waiting on the person)', [child('local_c1', 2, P, { pinned: true })], { local_c1: MERGED }],
    ['its last turn blocked', [child('local_c1')], { local_c1: BLOCKED }],
    ['its last turn ready for review', [child('local_c1')], { local_c1: { postTurnSummary: { status_category: 'review_ready', status_detail: 'PR #8 is green.' } } }],
    ['its last turn needing an action of the person', [child('local_c1')], { local_c1: { postTurnSummary: { status_category: 'completed', status_detail: 'Done.', needs_action: 'Approve the merge' } } }],
    ['its last turn saying something is left', [child('local_c1')], { local_c1: { postTurnSummary: { status_category: 'completed', status_detail: 'Built it; not yet merged.' } } }],
    ['cut short, waiting on the person', [child('local_c1')], { local_c1: { ...MERGED, interruptedAwaitingPerson: true } }],
    ['a prompt of the person\'s after its last turn', [child('local_c1')], { local_c1: { ...MERGED, lastTurnEdgeAt: NOW - 3 * HOUR, latestUserFrameAt: NOW - 2 * HOUR } }],
    ['no summary of its last turn', [child('local_c1')], { local_c1: { prs: [{ prNumber: 5, state: 'MERGED' }] } }],
    ['no record to read', [child('local_c1')], {}],
    ['brought on screen by the person 5 minutes ago', [child('local_c1')], { local_c1: { ...MERGED, lastFocusedAt: NOW - 5 * MIN } }],
    ['moved to top level', [child('local_c1', 2, P, { detached: true })], { local_c1: MERGED }],
    ['with a working child of its own', [child('local_c1'), child('local_g1', 3, 'local_c1', { isRunning: true })], { local_c1: MERGED, local_g1: MERGED }],
    ['with an unfinished child of its own', [child('local_c1'), child('local_g1', 3, 'local_c1')], { local_c1: MERGED, local_g1: BLOCKED }],
    ['with a pinned child of its own', [child('local_c1'), child('local_g1', 3, 'local_c1', { pinned: true })], { local_c1: MERGED, local_g1: MERGED }],
  ]
  for (const [what, threads, files] of left) {
    test(`⛔ left alone: a child ${what}`, async ($, on) => {
      const w = setup(on, threads, files)
      await tickOnce($, w)
      expect(archives(w)).toEqual([])
      expect(w.stored['mm.archived']).toBeUndefined()
      expect([...w.threads.values()].filter(t => t.isArchived)).toEqual([])
    })
  }

  const leftByStore: Array<[string, Record<string, unknown>]> = [
    ['waiting only on a scheduled run (mm waiting scheduled)', { 'mm.runwait': { local_c1: { what: 'the 4:15 PM send', ticket: RUN_TICKET, at: NOW - HOUR, runs: [{ at: NOW + HOUR }] } } }],
    ['a scheduled task\'s run', { 'mm.scheduled': { local_c1: NOW - HOUR } }],
    ['brought back from the archive by the person (archived by the bridge, open again)', { 'mm.archived': { local_c1: { at: NOW - 2 * HOUR, parent: P, ok: true } } }],
    ['asked before with no answer yet', { 'mm.archived': { local_c1: { at: NOW - 7 * HOUR, parent: P, ok: null } } }],
    ['refused in the last 6 hours', { 'mm.archived': { local_c1: { at: NOW - 5 * HOUR, parent: P, ok: false, why: 'a side session of it is still working' } } }],
  ]
  for (const [what, store] of leftByStore) {
    test(`⛔ left alone: a finished child ${what}`, async ($, on) => {
      const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { store })
      await tickOnce($, w)
      expect(archives(w)).toEqual([])
      expect(w.threads.get('local_c1')?.isArchived).toBe(false)
    })
  }

  test('⛔ left alone: a client\'s linked thread, waiting on the person (mm waiting): its declaration stands, nothing is archived', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, {
      feed: feed({ drafts: [], tickets: {} }),
      store: { 'mm.links': { [BOLT]: 'local_c1' }, 'mm.waiting': { local_c1: { type: 'only-you', ask: 'Sign in to the client account?', at: NOW - HOUR } } },
    })
    await tickOnce($, w)
    expect(archives(w)).toEqual([])
    expect(Object.keys(w.stored['mm.waiting'] as object)).toEqual(['local_c1'])
  })

  test('⛔ left alone: the children of a thread that is not pinned', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { threads: [pinnedParent({ pinned: false }), child('local_c1')] })
    await tickOnce($, w)
    expect(archives(w)).toEqual([])
  })

  test('⛔ left alone: this thread and every thread above it; a finished sibling of the one above is archived', async ($, on) => {
    // this thread is a child of local_c1, itself a finished child of the pinned thread: archiving local_c1 could archive this thread with it
    const w = setup(on, [child('local_c1'), child('local_c2')], { local_c1: MERGED, local_c2: MERGED }, {
      self: me({ parentSessionId: 'local_c1', startedBy: 'local_c1', detached: false }),
    })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c2'])
  })

  test('⛔ the app, asked by id just before, shows it working now: not archived, nothing on record', async ($, on) => {
    // the list (asked first) shows it quiet; the app's answer by id says a turn started since
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, {
      during: call => {
        if (call.tool === 'get_session' && call.args.session_id === 'local_c1') Object.assign(w.threads.get('local_c1') as Thread, { isRunning: true })
      },
    })
    await tickOnce($, w)
    expect(archives(w)).toEqual([])
    expect(w.stored['mm.archived']).toBeUndefined()
  })

  test('⛔ paused (/mm pause): nothing is archived', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { store: { 'mm.paused': true } })
    await tickOnce($, w)
    expect(archives(w)).toEqual([])
  })

  for (const [what, self] of [
    ['default permissions', me({ permissionMode: 'default' })],
    ['auto mode (the app may still ask)', me({ permissionMode: 'auto' })],
    ['a mode the app does not say', thread(SELF, 'Builds lane', 0)],
  ] as Array<[string, Thread]>) {
    test(`⛔ outside bypass permissions (${what}): the app would ask the person, so nothing is asked, listed or written`, async ($, on) => {
      const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { self })
      await tickOnce($, w)
      expect(archives(w)).toEqual([])
      expect(w.calls.filter(c => c.tool === 'list_sessions' && c.args.limit === 5_000)).toEqual([])
      expect(w.stored['mm.archived']).toBeUndefined()
      expect(logOf(w)).not.toContain('archive:')
    })
  }

  // ---------------------------------------------------------------- the app refusing, failing or not answering

  test('the app refuses: quietly on record with its words, logged once; not asked again for 6 hours, then asked again', LONG, async ($, on) => {
    let refuse = true
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { archive: () => (refuse ? 'refuse' : undefined) })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1'])
    expect(archivedRec(w).local_c1).toMatchObject({ parent: P, ok: false, why: 'Session local_c1 was not archived: a side session of it is still working.' })
    expect(logOf(w)).toContain(`archive: local_c1 under pinned ${P} not archived: Session local_c1 was not archived: a side session of it is still working.`)
    expect(w.threads.get('local_c1')?.isArchived).toBe(false)
    // the next pass asks nothing
    await w.clock.advance(16 * MIN)
    expect(archives(w)).toEqual(['local_c1'])
    // 6 hours on, it is asked again
    refuse = false
    archivedRec(w).local_c1 = { ...(archivedRec(w).local_c1 as { at: number; parent: string; ok: boolean }), at: NOW - 6 * HOUR }
    await w.clock.advance(16 * MIN)
    expect(archives(w)).toEqual(['local_c1', 'local_c1'])
    expect(w.threads.get('local_c1')?.isArchived).toBe(true)
    expect(archivedRec(w).local_c1).toMatchObject({ ok: true })
  })

  test('the call itself fails: on record as refused, with the error', async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { archive: 'error' })
    await tickOnce($, w)
    expect(archivedRec(w).local_c1).toMatchObject({ ok: false })
    expect(archivedRec(w).local_c1?.why).toContain('internal error')
    expect(w.threads.get('local_c1')?.isArchived).toBe(false)
  })

  test('the app never answers: on record as asked, logged; never asked again', LONG, async ($, on) => {
    const w = setup(on, [child('local_c1')], { local_c1: MERGED }, { archive: 'silent' })
    await tickOnce($, w)
    await w.clock.advance(20_000)
    expect(archives(w)).toEqual(['local_c1'])
    expect(archivedRec(w).local_c1).toMatchObject({ parent: P, ok: null })
    expect(logOf(w)).toContain(`archive: asked to archive local_c1 under pinned ${P} (finished, its pull request merged or closed); no answer from the app yet`)
    for (let i = 0; i < 2; i++) await w.clock.advance(16 * MIN)
    expect(archives(w)).toEqual(['local_c1'])
  })

  test('⛔ one refusal stops nothing else: the next finished child is archived in the same sync', async ($, on) => {
    const w = setup(on, [child('local_c1'), child('local_c2', 3)], { local_c1: MERGED, local_c2: HANDED }, { archive: sid => (sid === 'local_c1' ? 'refuse' : undefined) })
    await tickOnce($, w)
    expect(archives(w)).toEqual(['local_c1', 'local_c2'])
    expect(w.threads.get('local_c2')?.isArchived).toBe(true)
  })

  // ---------------------------------------------------------------- the top-level pass's note (0.7.44)

  const notes = (w: { acted: () => Call[] }) => sends(w).filter(c => c.args.message === DETACH_SELF_NOTE).map(c => String(c.args.session_id))
  /** Bolt's thread, pinned by the sync for Bolt's mail, with a finished child that is not a client's: the note's case (7) "finished". */
  const clientParent = (on: On, more: WorldOptions = {}) =>
    world(on, {
      feed: feed({ drafts: [], tickets: {} }),
      self: me(),
      threads: [thread(P, 'Staffing plan', 20), child('local_k5', 20)],
      files: recs({ local_k5: MERGED }),
      store: { 'mm.links': { [BOLT]: P }, 'mm.detachAsked': { [P]: NOW - HOUR } },
      ...more,
    })

  test('⛔ a finished child under a pinned client thread is archived, never woken with the top-level note', LONG, async ($, on) => {
    const w = clientParent(on)
    await tickOnce($, w)
    expect(w.threads.get(P)?.pinned).toBe(true)
    expect(archives(w)).toEqual(['local_k5'])
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * MIN)
    expect(notes(w)).toEqual([])
  })

  test('the app refuses to archive it: the top-level note goes instead, as before 0.7.90', LONG, async ($, on) => {
    const w = clientParent(on, { archive: 'refuse' })
    await tickOnce($, w)
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * MIN)
    expect(archives(w)).toEqual(['local_k5'])
    expect(notes(w)).toEqual(['local_k5'])
  })

  test('outside bypass permissions the note goes, as before 0.7.90', LONG, async ($, on) => {
    const w = clientParent(on, { self: thread(SELF, 'Builds lane', 0) })
    await tickOnce($, w)
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * MIN)
    expect(archives(w)).toEqual([])
    expect(notes(w)).toEqual(['local_k5'])
  })

  // ---------------------------------------------------------------- what the app's answers are read as

  test('a list row\'s pull request: open unless MERGED or CLOSED; no prNumber, none', () => {
    expect(rowPrOpen({ prNumber: 1, prState: 'OPEN' })).toBe(true)
    expect(rowPrOpen({ prNumber: 1, prState: 'QUEUED' })).toBe(true)
    expect(rowPrOpen({ prNumber: 1 })).toBe(true)
    expect(rowPrOpen({ prNumber: 1, prState: 'MERGED' })).toBe(false)
    expect(rowPrOpen({ prNumber: 1, prState: 'CLOSED' })).toBe(false)
    expect(rowPrOpen({ prState: 'OPEN' })).toBe(false)
    expect(rowPrOpen(null)).toBe(false)
  })

  test('a record\'s pull requests: any not merged or closed is open (a state missing too); merged when one is', () => {
    expect(recordPrs({})).toEqual({ open: false, merged: false })
    expect(recordPrs({ prs: [] })).toEqual({ open: false, merged: false })
    expect(recordPrs({ prs: [{ state: 'MERGED' }, { state: 'CLOSED' }] })).toEqual({ open: false, merged: true })
    expect(recordPrs({ prs: [{ state: 'MERGED' }, { state: 'OPEN' }] })).toEqual({ open: true, merged: true })
    expect(recordPrs({ prs: [{ prNumber: 3 }] })).toEqual({ open: true, merged: false })
    expect(recordPrs({ prs: 'not a list' })).toEqual({ open: false, merged: false })
  })
})
