// The bridge against a pretend desktop app, feed and store: an update by itself goes as soon as a package's drafts are
// stored (0.7.69).
//
// Rob, 2026-11-24, of Peter MD's call on 11-23: "Update should have hit as soon as the transcript finished processing." The
// times that day, in UTC: the package's two drafts were stored at 22:25:51; this bridge's five-minute sync first saw them at
// 22:28:56; it held them 10 minutes (AUTO_QUIET_MS) and the thread's note said "updates itself at about 5:38 PM"; they went
// from the next sync after that, at 22:41:05 (bridge-notices.log). 15 minutes 14 seconds in all.
//
// So the thread that polls asks OW's drafts pulse every minute (`GET /drafts-pulse`: a key over the newest draft write and
// the packages still being built), syncs at once when its key moves, and a finished package the client's thread has not
// been given goes at once. A package Lane-2's build helper may still rewrite (the feed's `building`) waits for it. An OW
// without the pulse changes nothing. Every client below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import { AUTO_QUIET_MS, BUILD_HOLD_MS, packageGiven, readyPackage, selfUpdateAt, updatePace } from './threads'
import { buildLists } from './queue'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, LONG, ACME, PKG, thread, feed, world, sends, tickOnce, closeouts, markerFirst, NOT_TAKEN } from './register-world.test-helper'

type W = ReturnType<typeof world>
/** Acme's thread is another one, linked by the person; this thread (SELF) is not Acme's. */
const ACME_THREAD = 'local_a'
/** Nothing for anyone on the feed yet. */
const quiet = (): Feed => feed({ drafts: [], mail: [], tickets: {}, threads: [] })
/** Acme's package, its two drafts stored: `over` on its row (e.g. `building: true`). */
const drafted = (over: Record<string, unknown> = {}): Feed => {
  const f = feed({ mail: [], tickets: {}, threads: [] })
  f.drafts = (f.drafts ?? []).map(d => ({ ...d, ...over }))
  return f
}
/** (0.5.11, Opus 10-15) The words an update by itself carries for Acme's drafts: the package shown, never taken. */
const ACME_UPDATE = markerFirst(`New since this thread last worked on this client: drafts ready.\n${NOT_TAKEN(ACME, 'Acme Roofing Pat')}`)
/** OW's pulse as the test sets it: a key, or no route at all (404). */
const pulsed = (key: () => string | null) => ({
  draftsPulse: () => {
    const k = key()
    return k === null ? { status: 404, body: { error: 'not_found' } } : { status: 200, body: { ok: true, as_of: '', key: k, drafts_at: null, building: 0 } }
  },
})
const acmeWorld = (on: On, more: WorldOptions = {}) =>
  world(on, { feed: quiet(), threads: [thread(ACME_THREAD, 'Roof quote', 30)], store: { 'mm.links': { [ACME]: ACME_THREAD } }, ...more })
const sentAt = (w: W): number | undefined => (w.stored['mm.sent'] as Record<string, { at: number }> | undefined)?.[ACME]?.at
const pulseReads = (w: W) => w.fetched.filter(u => u.endsWith('/api/ext/drafts-pulse')).length
/** The test's clock runs on, five seconds at a time, until the bridge has sent into Acme's thread or `ms` have passed. */
const untilSent = async (w: W, ms: number) => {
  for (let t = 0; t < ms && sends(w).length === 0; t += 5_000) await w.clock.advance(5_000)
}

describe('0.7.69: an update by itself goes as soon as a package\'s drafts are stored (Rob, 2026-11-24)', () => {
  test('replay of 2026-11-23: drafts stored between two syncs reach the client\'s thread within a minute, set off by the pulse', LONG, async ($, on) => {
    let key = 'aaaaaaaaaaaaaaa1'
    const w = acmeWorld(on, pulsed(() => key))
    await tickOnce($, w)
    // two and a half minutes of quiet: the first sync, and the pulse asked every minute, its first key recorded
    for (let i = 0; i < 2; i++) await w.clock.advance(60_000)
    await w.clock.advance(25_000)
    expect(sends(w)).toEqual([])
    const readsBefore = closeouts(w)
    // Lane-2 stores the drafts: OW's feed has the package, and the pulse's key moves
    const stored = w.clock.now()
    w.setFeed(drafted())
    key = 'aaaaaaaaaaaaaaa2'
    await untilSent(w, 5 * 60_000)
    // ⛔ the update, in its own words, into Acme's linked thread only
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([[ACME_THREAD, ACME_UPDATE]])
    const at = sentAt(w) as number
    console.log(`replay 0.7.69: drafts stored ${(stored - NOW) / 1000}s after the first sync's tick began, update sent ${(at - stored) / 1000}s after the drafts`)
    // within a minute of the drafts being stored (the tick that read the pulse, its sync, the claim's 1 to 3 seconds)
    expect(at - stored).toBeGreaterThan(0)
    expect(at - stored).toBeLessThanOrEqual(75_000)
    // the sync it took was the pulse's, not the five-minute one: under three minutes after the first sync
    expect(closeouts(w)).toBeGreaterThan(readsBefore)
    expect(at - NOW).toBeLessThan(5 * 60_000)
    // the record and the notice say what went
    expect((w.stored['mm.autoupdates'] as Array<{ pid: string; sid: string; ok: boolean; reason: string }>).map(r => [r.pid, r.sid, r.ok, r.reason])).toEqual([
      [ACME, ACME_THREAD, true, 'something new for the client: drafts ready'],
    ])
    // never twice: half an hour of syncs and pulses
    for (let i = 0; i < 30; i++) await w.clock.advance(60_000)
    expect(sends(w).length).toBe(1)
  })

  test('the same replay on an OW without the pulse: the update waits 10 minutes from the sync that first saw it, as before 0.7.69', LONG, async ($, on) => {
    const w = acmeWorld(on, pulsed(() => null))
    await tickOnce($, w)
    for (let i = 0; i < 2; i++) await w.clock.advance(60_000)
    await w.clock.advance(25_000)
    const stored = w.clock.now()
    w.setFeed(drafted())
    // nothing within nine minutes of the drafts: the next five-minute sync first sees them, and holds them 10 minutes
    for (let i = 0; i < 9; i++) await w.clock.advance(60_000)
    expect(sends(w)).toEqual([])
    await untilSent(w, 10 * 60_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual([ACME_THREAD])
    const late = (sentAt(w) as number) - stored
    console.log(`replay 0.7.68 rules (no pulse): update sent ${late / 1000}s after the drafts`)
    expect(late).toBeGreaterThanOrEqual(AUTO_QUIET_MS)
    // 11 to 16 minutes, as Peter MD's 15 minutes 14 seconds
    expect(late).toBeLessThanOrEqual(16 * 60_000)
    // an OW without the route is asked once, then not for half an hour
    expect(pulseReads(w)).toBe(1)
  })

  test('a package Lane-2\'s build helper may still rewrite waits for it, then goes within a minute of the build ending', LONG, async ($, on) => {
    let key = 'bbbbbbbbbbbbbbb1'
    const w = acmeWorld(on, pulsed(() => key))
    await tickOnce($, w)
    await w.clock.advance(60_000)
    w.setFeed(drafted({ building: true }))
    key = 'bbbbbbbbbbbbbbb2'
    // eight minutes of the build: the package is on the feed, and nothing goes
    for (let i = 0; i < 8; i++) await w.clock.advance(60_000)
    expect(sends(w)).toEqual([])
    // the build helper rewrites the drafts and leaves in `work` only what waits: OW stops calling it building
    const built = w.clock.now()
    w.setFeed(drafted())
    key = 'bbbbbbbbbbbbbbb3'
    await untilSent(w, 5 * 60_000)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([[ACME_THREAD, ACME_UPDATE]])
    console.log(`replay 0.7.69 building: update sent ${((sentAt(w) as number) - built) / 1000}s after the build ended`)
    expect((sentAt(w) as number) - built).toBeLessThanOrEqual(75_000)
  })

  test('a feed that keeps saying building lets the update go BUILD_HOLD_MS after the package was first seen', LONG, async ($, on) => {
    const w = acmeWorld(on, pulsed(() => 'ccccccccccccccc1'))
    await tickOnce($, w)
    w.setFeed(drafted({ building: true }))
    for (let i = 0; i < 28; i++) await w.clock.advance(60_000)
    expect(sends(w)).toEqual([])
    await untilSent(w, 10 * 60_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual([ACME_THREAD])
  })

  test('the pulse never sends, never syncs for a key it has synced for, and an OW that fails it keeps the five-minute cadence', LONG, async ($, on) => {
    let answer: 'ok' | 'fail' = 'ok'
    const w = acmeWorld(on, {
      draftsPulse: () => (answer === 'ok' ? { status: 200, body: { ok: true, key: 'ddddddddddddddd1' } } : { status: 503, body: { error: 'x', code: 'read_failed' } }),
    })
    await tickOnce($, w)
    const first = closeouts(w)
    // a key that does not move: the syncs come every five minutes, as before (6 and 11 minutes on)
    for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
    expect(closeouts(w) - first).toBe(2)
    // a pulse that fails: no extra sync (the one at 16 minutes alone), and asked again on the next tick
    answer = 'fail'
    const reads = pulseReads(w)
    const syncs = closeouts(w)
    for (let i = 0; i < 5; i++) await w.clock.advance(60_000)
    expect(pulseReads(w) - reads).toBe(5)
    expect(closeouts(w) - syncs).toBe(1)
    expect(sends(w)).toEqual([])
  })
})

describe('0.7.69: updatePace, the rule', () => {
  const acme = (over: Record<string, unknown> = {}) => buildLists(drafted(over), NOW).queue.find(i => i.projectId === ACME)
  const it = acme()
  test('a finished package the thread has not been given goes now; one being built waits for it; neither without an OW that says so', () => {
    if (!it) throw new Error('no Acme item')
    expect(readyPackage(it)).toBe(true)
    expect(updatePace(it, undefined, ACME_THREAD, true)).toBe('now')
    expect(updatePace({ ...it, building: true }, undefined, ACME_THREAD, true)).toBe('building')
    expect(updatePace(it, undefined, ACME_THREAD, false)).toBe('quiet')
  })
  test('a package the thread was given, as it is now, is not news: its next change waits AUTO_QUIET_MS', () => {
    if (!it) throw new Error('no Acme item')
    const lines = ['words for package ' + PKG, it.coversThrough ?? '', it.packageUpdatedAt ?? '']
    const had = lines.join('\n')
    expect(packageGiven(had, it)).toBe(true)
    expect(updatePace(it, { sid: ACME_THREAD, sig: had, at: NOW }, ACME_THREAD, true)).toBe('quiet')
    // given to another thread: news for this one
    expect(updatePace(it, { sid: 'local_other', sig: had, at: NOW }, ACME_THREAD, true)).toBe('now')
    // revised in place (Peter MD's 45138705: the same id, a newer covers_through): news
    const revised = { ...it, coversThrough: new Date(NOW).toISOString() }
    expect(packageGiven(had, revised)).toBe(false)
    expect(updatePace(revised, { sid: ACME_THREAD, sig: had, at: NOW }, ACME_THREAD, true)).toBe('now')
  })
  test('client mail with no package, and a package someone holds, wait AUTO_QUIET_MS as before', () => {
    if (!it) throw new Error('no Acme item')
    expect(updatePace({ ...it, packageId: null, kind: 'reply' }, undefined, ACME_THREAD, true)).toBe('quiet')
    expect(updatePace({ ...it, open: { id: PKG, state: 'held_by_me', by: '', at: null, unsent: 2, newer: 0 } }, undefined, ACME_THREAD, true)).toBe('quiet')
  })
  test('selfUpdateAt: now at the first sight, building BUILD_HOLD_MS on, quiet AUTO_QUIET_MS on', () => {
    const seen = { sig: 'x', at: NOW, mail: 0 }
    expect(selfUpdateAt(seen, 'now')).toBe(NOW)
    expect(selfUpdateAt(seen, 'building')).toBe(NOW + BUILD_HOLD_MS)
    expect(selfUpdateAt(seen)).toBe(NOW + AUTO_QUIET_MS)
  })
})
