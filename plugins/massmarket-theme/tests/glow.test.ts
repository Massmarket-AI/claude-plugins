import { expect, mock, test } from 'claude-code/testing'

import { levelFor } from '../hooks/register.tsx'

test('the fill picks the glow level', () => {
  expect(levelFor(undefined)).toBe(0)
  expect(levelFor(0.3)).toBe(0)
  expect(levelFor(0.5)).toBe(1)
  expect(levelFor(0.69)).toBe(1)
  expect(levelFor(0.7)).toBe(2)
  expect(levelFor(0.85)).toBe(3)
  expect(levelFor(1.2)).toBe(3)
})

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('the scene deepens as the thread fills, and /look glow off calms it', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 10, 24, 12, 0).getTime() })
  mock.store(on)
  let tokens = 150_000
  const scenes: string[] = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.usage', (_, e) => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        tokens,
        window: 1_000_000,
        percent: Math.round(tokens / 10_000),
        ...(e && (e as { breakdown?: unknown }).breakdown ? { breakdown: { autoCompactThreshold: 500_000, rawMaxTokens: 500_000 } } : {}),
      },
    },
  }))
  on('theme.set', (_, e) => {
    const b = e.backdrop as { scene?: string } | undefined
    scenes.push(b?.scene ?? '')

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(scenes.at(-1)).toBe('hero-mesh-0')

  tokens = 300_000
  await $.turn.complete(TURN)
  expect(scenes.at(-1)).toBe('hero-mesh-1')

  tokens = 440_000
  await $.turn.complete(TURN)
  expect(scenes.at(-1)).toBe('hero-mesh-3')

  const off = await $.command.run({ command: 'look', args: 'glow off' })
  expect(scenes.at(-1)).toBe('hero-mesh-0')
  expect(JSON.stringify(off)).toContain('Thread glow: off')
})
