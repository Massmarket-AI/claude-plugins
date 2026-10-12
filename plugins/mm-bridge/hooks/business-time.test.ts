import { describe, expect, test } from 'claude-code/testing'

import {
  addBusinessMs, businessDaysBetween, businessDeadline, businessMsBetween, isBusinessTime, nextBusinessStart, subtractBusinessMs,
} from './business-time'

// The same vectors as the server's business-time tests. All wall times are America/New_York.
const H = 3_600_000
// 2026: daylight time runs from Sunday March 8, 2:00 AM to Sunday November 1, 2:00 AM. Written out here
// so the expected instants do not come from the code under test.
const DST_START = Date.UTC(2026, 2, 8, 7)
const DST_END = Date.UTC(2026, 10, 1, 6)
/** "2026-10-09 15:00" in New York as an instant. */
const et = (s: string): number => {
  const z = Date.parse(`${s.replace(' ', 'T')}:00Z`)
  const daylight = z + 4 * H
  return daylight >= DST_START && daylight < DST_END ? daylight : z + 5 * H
}

describe('the runtime has what business time needs', () => {
  test('Intl.DateTimeFormat knows America/New_York, in daylight and in standard time', async () => {
    expect(typeof Intl).toBe('object')
    const hour = (ms: number) =>
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(ms))
        .filter(p => p.type === 'hour' || p.type === 'minute')
        .map(p => p.value)
        .join(':')
    expect(hour(Date.UTC(2026, 9, 12, 19))).toBe('15:00') // Oct 12, UTC-4
    expect(hour(Date.UTC(2026, 10, 2, 20))).toBe('15:00') // Nov 2, UTC-5
    expect(hour(Date.UTC(2026, 9, 12, 4))).toBe('00:00') // midnight reads 00, never 24
  })
})

describe('addBusinessMs: the clock is paused Saturday 00:00 to Monday 00:00', () => {
  const cases: Array<[string, number, number]> = [
    ['Fri 3 PM + 24h', addBusinessMs(et('2026-10-09 15:00'), 24 * H), et('2026-10-12 15:00')],
    ['Sat 10 AM + 24h', addBusinessMs(et('2026-10-10 10:00'), 24 * H), et('2026-10-13 00:00')],
    ['Sun 11 PM + 24h', addBusinessMs(et('2026-10-11 23:00'), 24 * H), et('2026-10-13 00:00')],
    ['Mon 12:01 AM + 24h', addBusinessMs(et('2026-10-12 00:01'), 24 * H), et('2026-10-13 00:01')],
    ['Thu 9 AM + 24h', addBusinessMs(et('2026-10-08 09:00'), 24 * H), et('2026-10-09 09:00')],
    ['Fri 11 PM + 4h (critical)', addBusinessMs(et('2026-10-09 23:00'), 4 * H), et('2026-10-12 03:00')],
    ['Thu 6:21 AM + 72h (medium)', addBusinessMs(et('2026-10-08 06:21'), 72 * H), et('2026-10-13 06:21')],
    ['Wed 9 AM + 168h (low)', addBusinessMs(et('2026-10-07 09:00'), 168 * H), et('2026-10-16 09:00')],
    ['clocks go back: Fri Oct 30 3 PM + 24h', addBusinessMs(et('2026-10-30 15:00'), 24 * H), et('2026-11-02 15:00')],
    ['clocks go forward: Fri Mar 6 3 PM + 24h', addBusinessMs(et('2026-03-06 15:00'), 24 * H), et('2026-03-09 15:00')],
    ['Fri 3 PM + 150 min', addBusinessMs(et('2026-10-09 15:00'), 150 * 60_000), et('2026-10-09 17:30')],
  ]
  for (const [label, got, want] of cases) test(label, async () => expect(got).toBe(want))
})

describe('businessMsBetween: Saturday and Sunday contribute zero', () => {
  const hours: Array<[string, number, number]> = [
    ['Fri 3 PM to Mon 3 PM', businessMsBetween(et('2026-10-09 15:00'), et('2026-10-12 15:00')) / H, 24],
    ['Fri 3 PM to Sat 3 PM', businessMsBetween(et('2026-10-09 15:00'), et('2026-10-10 15:00')) / H, 9],
    ['Fri 3 PM to Sun 11 PM', businessMsBetween(et('2026-10-09 15:00'), et('2026-10-11 23:00')) / H, 9],
    ['Sat 10 AM to Sun 10 PM', businessMsBetween(et('2026-10-10 10:00'), et('2026-10-11 22:00')) / H, 0],
    ['Fri Oct 2 6:21 AM to Mon Oct 12 6:21 AM', businessMsBetween(et('2026-10-02 06:21'), et('2026-10-12 06:21')) / H, 144],
    ['clocks go back: Fri Oct 30 3 PM to Mon Nov 2 3 PM', businessMsBetween(et('2026-10-30 15:00'), et('2026-11-02 15:00')) / H, 24],
    ['clocks go forward: Fri Mar 6 3 PM to Mon Mar 9 3 PM', businessMsBetween(et('2026-03-06 15:00'), et('2026-03-09 15:00')) / H, 24],
  ]
  for (const [label, got, want] of hours) test(`${label} is ${want} h`, async () => expect(got).toBe(want))

  test('whole business days: Fri Oct 2 6:21 AM to Mon Oct 12 6:21 AM is 6', async () => {
    expect(businessDaysBetween(et('2026-10-02 06:21'), et('2026-10-12 06:21'))).toBe(6)
  })
})

describe('subtractBusinessMs: a look-back window in business time', () => {
  const cases: Array<[string, number, number]> = [
    ['Mon 9 AM minus 48 business h', subtractBusinessMs(et('2026-10-12 09:00'), 48 * H), et('2026-10-08 09:00')],
    ['Mon 9 AM minus 96 business h', subtractBusinessMs(et('2026-10-12 09:00'), 96 * H), et('2026-10-06 09:00')],
    ['Sun noon minus 24 business h', subtractBusinessMs(et('2026-10-11 12:00'), 24 * H), et('2026-10-09 00:00')],
    ['Wed 3 PM minus 24 business h', subtractBusinessMs(et('2026-10-14 15:00'), 24 * H), et('2026-10-13 15:00')],
  ]
  for (const [label, got, want] of cases) test(label, async () => expect(got).toBe(want))
})

describe('businessDeadline: a deadline a person reads never lands on midnight', () => {
  const cases: Array<[string, number, number]> = [
    ['Fri 3 PM + 24h is Mon 3 PM', businessDeadline(et('2026-10-09 15:00'), 24 * H), et('2026-10-12 15:00')],
    ['Sat 10 AM + 24h is Mon 11:59 PM', businessDeadline(et('2026-10-10 10:00'), 24 * H), et('2026-10-12 23:59')],
    ['Sun 11 PM + 24h is Mon 11:59 PM', businessDeadline(et('2026-10-11 23:00'), 24 * H), et('2026-10-12 23:59')],
    ['Thu 00:00 + 48h is Fri 11:59 PM', businessDeadline(et('2026-10-08 00:00'), 48 * H), et('2026-10-09 23:59')],
  ]
  for (const [label, got, want] of cases) test(label, async () => expect(got).toBe(want))
})

describe('business days, other zones, bad input', () => {
  test('a weekend instant is not business time and starts Monday 00:00', async () => {
    expect(isBusinessTime(et('2026-10-09 23:59'))).toBe(true)
    expect(isBusinessTime(et('2026-10-10 00:00'))).toBe(false)
    expect(isBusinessTime(et('2026-10-11 23:59'))).toBe(false)
    expect(isBusinessTime(et('2026-10-12 00:00'))).toBe(true)
    expect(nextBusinessStart(et('2026-10-10 10:00'))).toBe(et('2026-10-12 00:00'))
    expect(nextBusinessStart(et('2026-10-11 23:00'))).toBe(et('2026-10-12 00:00'))
    expect(nextBusinessStart(et('2026-10-09 15:00'))).toBe(et('2026-10-09 15:00'))
    // the weekend the clocks go back is 49 hours long, and still counts nothing
    expect(nextBusinessStart(et('2026-10-31 00:00'))).toBe(et('2026-11-02 00:00'))
    expect(et('2026-11-02 00:00') - et('2026-10-31 00:00')).toBe(49 * H)
  })

  test('another zone keeps its own week: Asia/Dhaka (UTC+6, no clock changes)', async () => {
    const dhaka = (local: string) => Date.parse(`${local}:00+06:00`)
    expect(addBusinessMs(dhaka('2026-10-09T15:00'), 24 * H, 'Asia/Dhaka')).toBe(dhaka('2026-10-12T15:00'))
    expect(businessMsBetween(dhaka('2026-10-09T15:00'), dhaka('2026-10-12T15:00'), 'Asia/Dhaka')).toBe(24 * H)
    // Friday 3 PM in Dhaka is still Friday 5 AM in New York: the two zones measure the same weekend differently
    expect(businessMsBetween(dhaka('2026-10-09T15:00'), dhaka('2026-10-10T15:00'), 'Asia/Dhaka')).toBe(9 * H)
    expect(businessMsBetween(dhaka('2026-10-09T15:00'), dhaka('2026-10-10T15:00'))).toBe(19 * H)
  })

  test('a date that is not a date measures 0 and adds to NaN, never an error', async () => {
    expect(businessMsBetween(NaN, et('2026-10-12 09:00'))).toBe(0)
    expect(businessMsBetween(et('2026-10-12 09:00'), NaN)).toBe(0)
    expect(businessMsBetween(et('2026-10-12 09:00'), et('2026-10-09 09:00'))).toBe(0)
    expect(businessDaysBetween(NaN, et('2026-10-12 09:00'))).toBe(0)
    expect(addBusinessMs(NaN, 24 * H)).toBeNaN()
    expect(addBusinessMs(et('2026-10-12 09:00'), NaN)).toBeNaN()
    expect(subtractBusinessMs(NaN, 24 * H)).toBeNaN()
    expect(businessDeadline(NaN, 24 * H)).toBeNaN()
    expect(nextBusinessStart(NaN)).toBeNaN()
    expect(isBusinessTime(NaN)).toBe(false)
  })
})

describe('properties over four weeks that include the weekend the clocks go back', () => {
  const base = et('2026-10-05 00:00')
  const N = 600
  const instants = Array.from({ length: N }, (_, i) => base + Math.floor((i / N) * 28 * 24 * H) + ((i * 7919) % H)).sort((a, b) => a - b)

  test('measuring what was added gives the duration back, and a later start is never due earlier', { timeoutMs: 30_000 }, async () => {
    let inverse = 0
    let backwards = 0
    let previous = -Infinity
    for (const s of instants) {
      const due = addBusinessMs(s, 24 * H)
      if (businessMsBetween(nextBusinessStart(s), due) !== 24 * H) inverse++
      if (due < previous) backwards++
      previous = due
    }
    expect(inverse).toBe(0)
    expect(backwards).toBe(0)
  })

  test('measuring from what was subtracted gives the duration back', { timeoutMs: 30_000 }, async () => {
    let inverse = 0
    for (const e of instants) if (businessMsBetween(subtractBusinessMs(e, 48 * H), e) !== 48 * H) inverse++
    expect(inverse).toBe(0)
  })
})
