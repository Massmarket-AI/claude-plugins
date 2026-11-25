import { expect, test } from 'claude-code/testing'

import { placeFor, sunAt } from '../hooks/register.tsx'

function near(actual: number | string, hours: number): void {
  expect(typeof actual).toBe('number')
  expect(Math.abs((actual as number) - hours)).toBeLessThan(0.25)
}

test('Denver on Nov 24: up about 7:00 AM, down about 4:40 PM', () => {
  const [lat, lon] = placeFor('America/Denver', -7)
  near(sunAt(328, lat, lon, -7, true), 7.0)
  near(sunAt(328, lat, lon, -7, false), 16.67)
})

test('Denver on Jun 21 (daylight time): down about 8:30 PM', () => {
  const [lat, lon] = placeFor('America/Denver', -6)
  near(sunAt(172, lat, lon, -6, false), 20.53)
})

test('Dhaka on Nov 24: down about 5:10 PM', () => {
  const [lat, lon] = placeFor('Asia/Dhaka', 6)
  near(sunAt(328, lat, lon, 6, false), 17.18)
})

test('an unlisted zone takes its longitude from its offset', () => {
  expect(placeFor('Etc/Unknown', -5)).toEqual([35, -75])
})
