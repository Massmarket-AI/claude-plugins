import { expect, mock, test } from 'claude-code/testing'

import { levelFor, savingFor } from '../hooks/register.tsx'

// The glow follows what a fresh thread would save over the next 20 calls (Rob, 2026-11-25): little for a large thread
// being worked on, a lot for one whose cache has lapsed.

test('what a fresh thread would save picks the level', () => {
  // Warm: a fresh thread forfeits the cache, so a large thread mid-task glows late.
  expect(savingFor(150_000, false)).toBe(0)
  expect(levelFor(savingFor(300_000, false))).toBe(0)
  expect(levelFor(savingFor(400_000, false))).toBe(1)
  expect(levelFor(savingFor(500_000, false))).toBe(2)
  // Cold: the next message writes the whole thread again, so a fresh one saves 1 - 150K / tokens.
  expect(Math.round(savingFor(300_000, true) * 1000)).toBe(500)
  expect(levelFor(savingFor(190_000, true))).toBe(0)
  expect(levelFor(savingFor(200_000, true))).toBe(1)
  expect(levelFor(savingFor(260_000, true))).toBe(2)
  expect(levelFor(savingFor(400_000, true))).toBe(3)
  // A five-minute cache writes for less, but cold is still 1 - 150K / tokens.
  expect(Math.round(savingFor(300_000, true, '5m') * 1000)).toBe(500)
  expect(levelFor(undefined)).toBe(0)
})

const NOON = new Date(2026, 10, 25, 12, 0).getTime()
const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 500, model: 'claude-opus-5-5' }
const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage: USAGE } as const

test('a large thread glows when its cache lapses, and calms once it is worked on again', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  mock.store(on)
  let tokens = 300_000
  const scenes: string[] = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.id', () => ({ value: 's1' }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) } } }))
  on('theme.set', (_, e) => {
    scenes.push((e.backdrop as { scene?: string } | undefined)?.scene ?? '')

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  // 300K and nothing noted yet: counted warm, so nothing to gain by switching.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(scenes.at(-1)).toBe('hero-mesh-0')

  await $.turn.start({ text: 'go', turnId: 't1' })
  tokens = 420_000
  await $.turn.complete(TURN)
  expect(scenes.at(-1)).toBe('hero-mesh-1')

  // An hour and a minute later the cache has lapsed: a fresh thread would save 1 - 150/420, about 64%.
  await clock.advance(61 * 60_000)
  expect(scenes.at(-1)).toBe('hero-mesh-3')
  const said = JSON.stringify(await $.command.run({ command: 'look', args: '' }))
  expect(said).toContain('Its cache has lapsed (last reply 61 minutes ago, kept for an hour)')
  expect(said).toContain('a fresh thread would save about 64% of the next 20 steps')

  // Working in it again warms the cache: back to the size alone.
  await $.turn.start({ text: 'more', turnId: 't2' })
  expect(scenes.at(-1)).toBe('hero-mesh-1')

  const off = await $.command.run({ command: 'look', args: 'glow off' })
  expect(scenes.at(-1)).toBe('hero-mesh-0')
  expect(JSON.stringify(off)).toContain('Thread glow: off.')
})

test('a thread reopened after a restart remembers how long it sat', async ($, on) => {
  mock.clock(on, { now: NOON })
  mock.store(on, { 'massmarket-theme.threads': { s1: { at: NOON - 3 * 3_600_000, life: '1h', tokens: 260_000 } } })
  const scenes: string[] = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.id', () => ({ value: 's1' }))
  // Reopened: no live reading until its first reply, so the noted 260K counts.
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('theme.set', (_, e) => {
    scenes.push((e.backdrop as { scene?: string } | undefined)?.scene ?? '')

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(scenes.at(-1)).toBe('hero-mesh-2')
  expect(JSON.stringify(await $.command.run({ command: 'look', args: '' }))).toContain('last reply 3 hours ago')
})
