// (0.7.72) The "You" strip's indicators, each at and around its thresholds (health.ts). Every client is made up.

import { describe, expect, test } from 'claude-code/testing'
import { FILL_AMBER, FILL_RED, TIERS, WEEK_MS, compactLine, compactPoint, fillDot, fillPercent, lateDot, pinsDot, rcDot, repliesDot, sessionsDot, strip, tierDot, tierOf, trackDot } from './health'

const NOW = Date.parse('2026-11-24T15:00:00Z')
const resetIn = (ms: number) => new Date(NOW + ms).toISOString()

describe('0.7.72: Pins', () => {
  test('all that need the person pinned: green; none: green', () => {
    expect(pinsDot([{ client: 'Acme Roofing', pinned: true }, { client: 'Bolt Staffing', pinned: true }])).toEqual({ key: 'pins', level: 'green', short: '2/2', says: 'All 2 threads that need you are pinned.' })
    expect(pinsDot([]).level).toBe('green')
  })
  test('one that needs them is not pinned: amber, and the press names it', () => {
    const d = pinsDot([{ client: 'Acme Roofing', pinned: true }, { client: 'Bolt Staffing', pinned: false }])
    expect(d.level).toBe('amber')
    expect(d.short).toBe('1/2')
    expect(d.says).toBe('1 of 2 pinned. Not pinned: Bolt Staffing.')
  })
})

describe('0.7.72: Late, in business days', () => {
  test('nothing past due: green; a team clock behind: amber; a client date late: red', () => {
    expect(lateDot([]).level).toBe('green')
    expect(lateDot([{ client: 'Acme Roofing', clientClock: false }]).level).toBe('amber')
    const red = lateDot([{ client: 'Acme Roofing', clientClock: false }, { client: 'Bolt Staffing', clientClock: true }])
    expect(red.level).toBe('red')
    expect(red.short).toBe('2')
    expect(red.says).toBe('1 late (Bolt Staffing); 1 behind on a team clock (Acme Roofing). Counted in business days, Monday to Friday Eastern.')
  })
})

describe('0.7.72: Replies ready, Sessions', () => {
  test('replies: none green, any amber', () => {
    expect(repliesDot([]).level).toBe('green')
    expect(repliesDot(['Acme Roofing'])).toMatchObject({ level: 'amber', short: '1', says: '1 reply package is ready for your go: Acme Roofing.' })
  })
  test('sessions: the running count; amber while any waits on the person', () => {
    expect(sessionsDot(4, [])).toMatchObject({ level: 'green', short: '4', says: '4 threads run on this computer; none waits on you.' })
    expect(sessionsDot(1, ['Acme Roofing', 'Bolt Staffing'])).toMatchObject({ level: 'amber', short: '1·2', says: '1 thread runs on this computer; 2 wait on you: Acme Roofing, Bolt Staffing.' })
  })
})

describe('0.7.72: This thread\'s fill', () => {
  test(`the compaction point: the threshold, else the window measured against, else CLAUDE_CODE_AUTO_COMPACT_WINDOW, else the model's window`, () => {
    expect(compactPoint({ threshold: 450_000, rawMax: 500_000, envWindow: '400000', window: 1_000_000 })).toBe(450_000)
    expect(compactPoint({ rawMax: 500_000, envWindow: '400000', window: 1_000_000 })).toBe(500_000)
    expect(compactPoint({ envWindow: ' 400000 ', window: 1_000_000 })).toBe(400_000)
    expect(compactPoint({ envWindow: 'lots', window: 1_000_000 })).toBe(1_000_000)
    expect(compactPoint({ threshold: 0, rawMax: -1 })).toBeNull()
  })
  test(`green below ${FILL_AMBER}%, amber from ${FILL_AMBER}%, red from ${FILL_RED}%`, () => {
    expect(fillDot(fillPercent(69 * 4_000, 400_000)).level).toBe('green')
    expect(fillDot(fillPercent(70 * 4_000, 400_000)).level).toBe('amber')
    expect(fillDot(fillPercent(84 * 4_000, 400_000)).level).toBe('amber')
    const red = fillDot(fillPercent(85 * 4_000, 400_000), 85 * 4_000, 400_000)
    expect(red).toMatchObject({ level: 'red', short: '85%' })
    expect(red.says).toBe('This thread is 85% of the way to compacting (340k of 400k tokens). It compacts soon: start the next job in a new thread.')
  })
  test('no reading yet (a fresh or just-compacted thread): a dash, green', () => {
    expect(fillPercent(undefined, 400_000)).toBeNull()
    expect(fillPercent(1000, null)).toBeNull()
    expect(fillDot(null)).toMatchObject({ level: 'green', short: '–' })
  })
})

describe('0.7.72: Plan usage tier, exactly usage-tier.mjs', () => {
  const at = (five: number | null, week: number | null, resetMs = 3 * 24 * 3600 * 1000) =>
    tierOf([...(five !== null ? [{ kind: 'five_hour', percentUsed: five }] : []), ...(week !== null ? [{ kind: 'seven_day', percentUsed: week, resetsAt: resetIn(resetMs) }] : [])], NOW)
  test('the thresholds are the control tower\'s', () => {
    expect(TIERS).toEqual({ save: { five: 85, week: 90, pace: 120 }, conserve: { five: 60, week: 70, pace: 100 } })
  })
  test('5-hour: conserve at 60, save at 85', () => {
    expect(at(59.9, 0).tier).toBe('normal')
    expect(at(60, 0).tier).toBe('conserve')
    expect(at(84.9, 0).tier).toBe('conserve')
    expect(at(85, 0).tier).toBe('save')
  })
  test('weekly: conserve at 70, save at 90 (with the week nearly over, so pace says less)', () => {
    const late = 1 * 3600 * 1000
    expect(at(0, 69, late).tier).toBe('normal')
    expect(at(0, 70, late).tier).toBe('conserve')
    expect(at(0, 90, late).tier).toBe('save')
  })
  test('pace: the weekly share over the share of the week gone; conserve at 100, save at 120', () => {
    // three and a half days gone: half the week, so 50% used is on pace for 100%
    expect(at(0, 50, WEEK_MS / 2)).toMatchObject({ tier: 'conserve', pace: 100 })
    expect(at(0, 49, WEEK_MS / 2)).toMatchObject({ tier: 'normal', pace: 98 })
    expect(at(0, 60, WEEK_MS / 2)).toMatchObject({ tier: 'save', pace: 120 })
  })
  test('pace waits until 24 hours of the week have passed', () => {
    // 23 hours gone, 20% used: on pace for far more, but not counted yet
    expect(at(0, 20, WEEK_MS - 23 * 3600 * 1000)).toMatchObject({ tier: 'normal', pace: null })
    expect(at(0, 20, WEEK_MS - 24 * 3600 * 1000)).toMatchObject({ tier: 'save', pace: 140 })
  })
  test('no 5-hour window counts as 0; no reading at all is normal, and says so', () => {
    expect(at(null, 10)).toMatchObject({ tier: 'normal', five: 0, read: true })
    const none = tierOf([], NOW)
    expect(none).toMatchObject({ tier: 'normal', read: false })
    expect(tierDot(none)).toMatchObject({ level: 'green', short: 'normal' })
  })
  test('the dot: normal green, conserve amber, save red', () => {
    expect(tierDot(at(10, 10)).level).toBe('green')
    expect(tierDot(at(60, 10))).toMatchObject({ level: 'amber', short: 'conserve' })
    expect(tierDot(at(90, 10))).toMatchObject({ level: 'red', short: 'save' })
    expect(tierDot(at(90, 10)).says).toBe('Plan usage is save: 5-hour 90%, weekly 10%, on pace for 18% of the week. Hand light work to GPT and keep threads short.')
  })
})

describe('0.7.72: Time tracking, Remote Control, and the band\'s one line', () => {
  test('a declared task is green, none amber; Remote Control on green, off amber', () => {
    expect(trackDot('Phase 1 nurture copy').level).toBe('green')
    expect(trackDot(null).level).toBe('amber')
    expect(rcDot(true).level).toBe('green')
    expect(rcDot(false)).toMatchObject({ level: 'amber', short: 'off' })
  })
  test('the band: one word when all is green, else each dot that is not, in the strip\'s order', () => {
    const green = [pinsDot([]), lateDot([]), repliesDot([]), sessionsDot(2, []), fillDot(10), tierDot(tierOf([], NOW)), trackDot('x'), rcDot(true)]
    expect(strip(green).map(d => d.key)).toEqual(['pins', 'late', 'replies', 'sessions', 'fill', 'tier', 'track', 'rc'])
    expect(compactLine(green)).toBe('🟢 You: all clear')
    const mixed = [rcDot(false), fillDot(88), pinsDot([{ client: 'Acme Roofing', pinned: false }]), lateDot([])]
    expect(compactLine(mixed)).toBe('You: 🟡 Pins 0/1 · 🔴 This thread 88% · 🟡 Remote Control off')
  })
})
