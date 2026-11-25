import { describe, expect, test } from 'claude-code/testing'

import { FRESH_SAVING, FRESH_TOKENS, freshSaving } from './threads'

// (0.7.78, Rob 2026-11-25: "I also think that's what should trigger the chip to restart the thread once we hit a certain
// threshold") The bridge's card for a fresh thread follows the same rule as massmarket-theme's glow (0.6.5): `freshSaving`
// is the theme's `savingFor`, and the card shows from the glow's level 2. A test may not import another plugin's files,
// so the theme's `levelFor` is copied here as it is there, and the cases below are the theme's own glow test
// (plugins/massmarket-theme/tests/glow.test.ts), word for word but for the name. A change to one rule that the other does
// not take fails one of the two suites.

/** massmarket-theme's `levelFor`, as it is there. */
function levelFor(saving: number | undefined): 0 | 1 | 2 | 3 {
  if (saving === undefined || !(saving >= 0.25)) {
    return 0
  }
  if (saving < 0.4) {
    return 1
  }
  if (saving < 0.55) {
    return 2
  }
  return 3
}

describe('(0.7.78) the card for a fresh thread and massmarket-theme\'s glow agree', () => {
  test('the theme\'s glow cases, on the bridge\'s saving', () => {
    expect(FRESH_TOKENS).toBe(150_000)
    expect(freshSaving(150_000, false)).toBe(0)
    expect(levelFor(freshSaving(300_000, false))).toBe(0)
    expect(levelFor(freshSaving(400_000, false))).toBe(1)
    expect(levelFor(freshSaving(500_000, false))).toBe(2)
    expect(Math.round(freshSaving(300_000, true) * 1000)).toBe(500)
    expect(levelFor(freshSaving(190_000, true))).toBe(0)
    expect(levelFor(freshSaving(200_000, true))).toBe(1)
    expect(levelFor(freshSaving(260_000, true))).toBe(2)
    expect(levelFor(freshSaving(400_000, true))).toBe(3)
    expect(Math.round(freshSaving(300_000, true, '5m') * 1000)).toBe(500)
    expect(levelFor(undefined)).toBe(0)
  })

  test('the card shows exactly where the glow reaches level 2', () => {
    for (const tokens of [200_000, 249_000, 250_000, 320_000, 333_000, 334_000, 393_000, 394_000, 487_000, 488_000, 650_000, 1_000_000]) {
      for (const cold of [false, true]) {
        for (const life of ['1h', '5m'] as const) {
          const saving = freshSaving(tokens, cold, life)
          expect(saving >= FRESH_SAVING).toBe(levelFor(saving) >= 2)
        }
      }
    }
  })
})
