import { expect, mock, test } from 'claude-code/testing'

import { schemeAt } from '../hooks/register.tsx'

/** A local time today, as the computer's own clock reads it. */
function at(hour: number, minute = 0): number {
  const d = new Date(2026, 10, 24, hour, minute, 0, 0)

  return d.getTime()
}

test('the hour picks the mode, in each preference', async () => {
  const auto = { mode: 'auto', lightFrom: 7, darkFrom: 19 } as const

  expect(schemeAt(6, auto)).toBe('dark')
  expect(schemeAt(7, auto)).toBe('light')
  expect(schemeAt(18, auto)).toBe('light')
  expect(schemeAt(19, auto)).toBe('dark')
  expect(schemeAt(23, auto)).toBe('dark')
  // A night-owl schedule that wraps past midnight.
  expect(schemeAt(23, { mode: 'auto', lightFrom: 22, darkFrom: 6 })).toBe('light')
  expect(schemeAt(12, { mode: 'auto', lightFrom: 22, darkFrom: 6 })).toBe('dark')
  expect(schemeAt(12, { mode: 'dark', lightFrom: 7, darkFrom: 19 })).toBe('dark')
  expect(schemeAt(2, { mode: 'light', lightFrom: 7, darkFrom: 19 })).toBe('light')
  expect(schemeAt(12, { mode: 'app', lightFrom: 7, darkFrom: 19 })).toBeUndefined()
})

test('on fixed hours: light at 6:59 PM, dark from 7 PM, light again at 7 AM', async ($, on) => {
  const clock = mock.clock(on, { now: at(18, 59) })
  mock.store(on, { 'massmarket-theme.prefs': { mode: 'auto', schedule: 'hours', lightFrom: 7, darkFrom: 19, glow: true } })
  const sets: Array<string | undefined> = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('theme.set', (_, e) => {
    sets.push(e.overrideColorScheme)

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets).toEqual(['light'])

  await clock.advance(60_000)
  expect(sets).toEqual(['light', 'dark'])

  // A quiet night sets nothing more.
  await clock.advance(3 * 60 * 60_000)
  expect(sets).toEqual(['light', 'dark'])

  await clock.set(at(7, 0) + 24 * 60 * 60_000)
  await clock.advance(60_000)
  expect(sets.at(-1)).toBe('light')
})

test('/look dark holds dark at noon, /look auto goes back to the sun', async ($, on) => {
  mock.clock(on, { now: at(12, 0) })
  mock.store(on)
  const sets: Array<string | undefined> = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('theme.set', (_, e) => {
    sets.push(e.overrideColorScheme)

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.at(-1)).toBe('light')

  const dark = await $.command.run({ command: 'look', args: 'dark' })
  expect(sets.at(-1)).toBe('dark')
  expect(JSON.stringify(dark)).toContain('always dark')

  const auto = await $.command.run({ command: 'look', args: 'auto' })
  expect(sets.at(-1)).toBe('light')
  expect(JSON.stringify(auto)).toContain('light from sunrise')

  const bad = await $.command.run({ command: 'look', args: 'hours 7 7' })
  expect(JSON.stringify(bad)).toContain('two different hours')
})
