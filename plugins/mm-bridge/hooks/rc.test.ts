import { describe, expect, test } from 'claude-code/testing'

import {
  RC_FLOOR, RC_MAX_THREADS, RC_RAISE_MS, RC_SEEN_MS, appLiveCap, heldOf, memOfMeminfo, memOfSysctl, memOfWindows, memTier, rcFull, rcHold, rcPlan, rcWanted,
} from './rc'
import type { RcPass, RcRecord, RcView } from './rc'

// (0.7.86, Rob 2026-11-27: "its supposed to be the most recently used 10 i think" and "my main concern is computer memory,
// it would be best if it kept a monitor on memory and 10 was flexible based on the machine")

const GIB = 2 ** 30
const NOW = Date.parse('2026-11-27T18:00:00Z')

describe('0.7.86 how many threads this computer can hold with Remote Control', () => {
  test('the app\'s live threads, as its governor counts them: max(6, RAM / 3 GB); 16 on Rob\'s 48 GB Mac (measured)', () => {
    expect(appLiveCap(48 * GIB)).toBe(16)
    expect(appLiveCap(16 * GIB)).toBe(6)
    expect(appLiveCap(8 * GIB)).toBe(6)
    expect(appLiveCap(64 * GIB)).toBe(21)
  })

  test('the full cap is 5 in 8 of those: 10 on 48 GB, Rob\'s number; fewer on a smaller computer, more on a bigger one; 10 when the size is not known', () => {
    expect(rcFull(48 * GIB)).toBe(10)
    expect(rcFull(32 * GIB)).toBe(6)
    expect(rcFull(16 * GIB)).toBe(4)
    expect(rcFull(8 * GIB)).toBe(4)
    expect(rcFull(64 * GIB)).toBe(13)
    expect(rcFull(96 * GIB)).toBe(20)
    expect(rcFull(undefined)).toBe(RC_MAX_THREADS)
    expect(rcFull(0)).toBe(RC_MAX_THREADS)
  })

  test('memory: normal, tight below 25% free or at the warning level, critical below 12% or at the critical level; unread with neither', () => {
    expect(memTier({ free: 63, level: 'normal' })).toBe('normal')
    expect(memTier({ free: 24 })).toBe('tight')
    expect(memTier({ free: 60, level: 'warn' })).toBe('tight')
    expect(memTier({ free: 11 })).toBe('critical')
    expect(memTier({ free: 60, level: 'critical' })).toBe('critical')
    expect(memTier({ ram: 48 * GIB })).toBe('unread')
    expect(memTier({})).toBe('unread')
  })

  test('the cap a reading asks for: full, half while tight, RC_FLOOR while critical, never above the full cap', () => {
    expect(rcWanted({ ram: 48 * GIB, free: 63, level: 'normal' })).toEqual({ cap: 10, full: 10, tier: 'normal' })
    expect(rcWanted({ ram: 48 * GIB, free: 20 })).toEqual({ cap: 5, full: 10, tier: 'tight' })
    expect(rcWanted({ ram: 48 * GIB, level: 'critical' })).toEqual({ cap: RC_FLOOR, full: 10, tier: 'critical' })
    expect(rcWanted({ ram: 8 * GIB, free: 20 })).toEqual({ cap: 2, full: 4, tier: 'tight' })
    expect(rcWanted({})).toEqual({ cap: 10, full: 10, tier: 'unread' })
  })

  test('a lower cap at once; a higher one only after RC_RAISE_MS since the last low reading; nothing written while memory stays normal', () => {
    const normal = rcWanted({ ram: 48 * GIB, free: 63 })
    const tight = rcWanted({ ram: 48 * GIB, free: 20 })
    const first = rcHold(normal, 48 * GIB, null, NOW)
    expect(first).toEqual({ cap: 10, write: { cap: 10, at: NOW, full: 10, tier: 'normal', ram: 48 * GIB } })
    const held = first.write
    expect(rcHold(normal, 48 * GIB, held, NOW + 60_000)).toEqual({ cap: 10, write: null })
    const low = rcHold(tight, 48 * GIB, held, NOW + 120_000)
    expect(low).toEqual({ cap: 5, write: { cap: 5, at: NOW + 120_000, full: 10, tier: 'tight', ram: 48 * GIB } })
    // tight again a minute on: the time a raise waits from moves
    const again = rcHold(tight, 48 * GIB, low.write, NOW + 180_000)
    expect(again.cap).toBe(5)
    expect(again.write?.at).toBe(NOW + 180_000)
    // normal: held for RC_RAISE_MS, the record saying memory is normal again
    const waiting = rcHold(normal, 48 * GIB, again.write, NOW + 180_000 + RC_RAISE_MS - 1)
    expect(waiting).toEqual({ cap: 5, write: { cap: 5, at: NOW + 180_000, full: 10, tier: 'normal', ram: 48 * GIB } })
    expect(rcHold(normal, 48 * GIB, waiting.write, NOW + 180_000 + RC_RAISE_MS - 1)).toEqual({ cap: 5, write: null })
    expect(rcHold(normal, 48 * GIB, waiting.write, NOW + 180_000 + RC_RAISE_MS).cap).toBe(10)
  })

  test('a held cap from the store: anything but a record with a cap and a time is none', () => {
    expect(heldOf(null)).toBeNull()
    expect(heldOf({ cap: '10', at: 1 })).toBeNull()
    expect(heldOf({ cap: 10, at: 1 })).toEqual({ cap: 10, at: 1, full: 10, tier: 'unread' })
    expect(heldOf({ cap: 5, at: 1, full: 10, tier: 'tight', ram: 48 * GIB })).toEqual({ cap: 5, at: 1, full: 10, tier: 'tight', ram: 48 * GIB })
  })
})

describe('0.7.86 reading this computer\'s memory', () => {
  test('a Mac, by sysctl with the names printed (measured on Rob\'s Mac, 11-27); a name this Mac lacks leaves only its own field out', () => {
    expect(memOfSysctl('hw.memsize: 51539607552\nkern.memorystatus_level: 65\nkern.memorystatus_vm_pressure_level: 1\n')).toEqual({ ram: 51539607552, free: 65, level: 'normal' })
    expect(memOfSysctl('hw.memsize: 51539607552\nkern.memorystatus_vm_pressure_level: 4\n')).toEqual({ ram: 51539607552, level: 'critical' })
    expect(memOfSysctl('kern.memorystatus_vm_pressure_level: 2')).toEqual({ level: 'warn' })
    expect(memOfSysctl('kern.memorystatus_level: 140\nkern.memorystatus_vm_pressure_level: 3')).toEqual({})
    expect(memOfSysctl('')).toEqual({})
  })

  test('Linux, by /proc/meminfo: MemTotal, and MemAvailable as the share free', () => {
    expect(memOfMeminfo('MemTotal:       16777216 kB\nMemFree:         1048576 kB\nMemAvailable:    4194304 kB\n')).toEqual({ ram: 16 * GIB, free: 25 })
    expect(memOfMeminfo('MemTotal:       16777216 kB\n')).toEqual({ ram: 16 * GIB })
    expect(memOfMeminfo('nothing here')).toEqual({})
  })

  test('Windows, by Win32_OperatingSystem: the size and what is free, in KB', () => {
    expect(memOfWindows('33554432 8388608\r\n')).toEqual({ ram: 32 * GIB, free: 25 })
    expect(memOfWindows('')).toEqual({})
  })
})

describe('0.7.86 which threads keep Remote Control in a pass', () => {
  const view = (sid: string, hoursAgo: number, more: Partial<RcView> = {}): RcView => ({ sid, pinned: true, on: false, activity: new Date(NOW - hoursAgo * 3_600_000).toISOString(), running: false, ...more })
  const P: RcPass = { refused: new Set<string>(), by: 'this process' }

  test('the most recently used pinned threads up to the cap; the rest, not on record, are left alone', () => {
    const plan = rcPlan([view('a', 3), view('b', 1), view('c', 2)], {}, 2, NOW, P)
    expect(plan.on).toEqual(['b', 'c'])
    expect(plan.top).toEqual(['b', 'c'])
    expect(plan.off).toEqual([])
  })

  test('past the top, on record: switched off when on, taken off the record when off already', () => {
    const record: RcRecord = { a: { at: NOW - 1 }, b: { at: NOW - 1 }, d: { at: NOW - 1 } }
    const plan = rcPlan([view('a', 5, { on: true }), view('b', 1, { on: true }), view('d', 6)], record, 1, NOW, P)
    expect(plan.top).toEqual(['b'])
    expect(plan.seen).toEqual(['b'])
    expect(plan.off).toEqual(['a'])
    expect(plan.forget).toEqual(['d'])
  })

  test('⛔ Remote Control the bridge did not switch on is never switched off, and uses a place', () => {
    const plan = rcPlan([view('own', 9, { on: true }), view('free', 1, { pinned: false, on: true }), view('a', 1), view('b', 2)], {}, 3, NOW, P)
    expect(plan.held).toBe(2)
    expect(plan.on).toEqual(['a'])
    expect(plan.off).toEqual([])
  })

  test('off on record: the person\'s only when this same process saw it on within RC_SEEN_MS and it was in use; any other way it dropped, and is stamped so', () => {
    const act = new Date(NOW - 3_600_000).toISOString()
    const seenRecently = { at: NOW - 600_000, seen: NOW - 60_000, act, by: P.by }
    const record: RcRecord = {
      idle: seenRecently,
      running: seenRecently,
      used: seenRecently,
      stale: { at: NOW - 600_000, seen: NOW - RC_SEEN_MS - 1, act, by: P.by },
      restarted: { at: NOW - 600_000, seen: NOW - 90_000, act, by: 'the process before the restart' },
      connecting: { at: NOW - 60_000 },
      old: { at: NOW - 86_400_000 },
      kept: { at: NOW - 600_000, person: true },
    }
    const plan = rcPlan(
      [
        view('idle', 1), view('running', 1, { running: true }), view('used', 0), view('stale', 0, { running: true }), view('restarted', 0, { running: true }),
        view('connecting', 0.1, { running: true }), view('old', 2), view('kept', 0.5), view('next', 3),
      ],
      record, 6, NOW, P,
    )
    expect(plan.person.sort()).toEqual(['running', 'used'])
    expect(plan.on).toEqual(['stale', 'restarted', 'connecting', 'idle', 'old', 'next'])
    expect(plan.dropped.sort()).toEqual(['connecting', 'idle', 'old', 'restarted', 'stale'])
    expect(plan.forget).toEqual([])
  })

  test('a thread on record that comes back on with no switch-on of the bridge\'s since it was found off is the person\'s: off the record, a place used, never switched off', () => {
    const plan = rcPlan([view('back', 9, { on: true }), view('a', 1)], { back: { at: NOW - 86_400_000, dropped: NOW - 600_000 } }, 1, NOW, P)
    expect(plan.forget).toEqual(['back'])
    expect(plan.held).toBe(1)
    expect(plan.off).toEqual([])
    expect(plan.on).toEqual([])
  })

  test('a thread on record the person switched on again is theirs: off the record, and it uses a place', () => {
    const plan = rcPlan([view('mine', 1, { on: true })], { mine: { at: NOW - 1, person: true } }, 1, NOW, P)
    expect(plan.forget).toEqual(['mine'])
    expect(plan.held).toBe(1)
    expect(plan.off).toEqual([])
  })

  test('a thread the app refused and that is unused since gives its place to the next one; it takes a place only when one is left over', () => {
    const refused = { refused: new Set(['unloaded']), by: P.by }
    const plan = rcPlan([view('unloaded', 0), view('a', 1, { on: true }), view('b', 2, { on: true })], { a: { at: 1 }, b: { at: 1 } }, 2, NOW, refused)
    expect(plan.top).toEqual(['a', 'b'])
    expect(plan.on).toEqual([])
    expect(plan.off).toEqual([])
    const spare = rcPlan([view('unloaded', 0), view('a', 1, { on: true })], { a: { at: 1 } }, 2, NOW, refused)
    expect(spare.top).toEqual(['unloaded', 'a'])
    expect(spare.on).toEqual(['unloaded'])
  })

  test('an entry of the wrong shape is still on record: a dropped thread in the top is switched on, never a throw', () => {
    const plan = rcPlan([view('bad', 1), view('null', 2, { pinned: false, on: true })], { bad: 7, null: null } as unknown as RcRecord, 2, NOW, P)
    expect(plan.on).toEqual(['bad'])
    expect(plan.off).toEqual(['null'])
  })

  test('unpinned, on record: switched off when on, taken off when off', () => {
    const plan = rcPlan([view('a', 1, { pinned: false, on: true }), view('b', 1, { pinned: false })], { a: { at: 1 }, b: { at: 1, person: true } }, 10, NOW, P)
    expect(plan.off).toEqual(['a'])
    expect(plan.forget).toEqual(['b'])
  })
})
