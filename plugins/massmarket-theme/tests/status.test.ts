import { expect, mock, test } from 'claude-code/testing'

import { hereFrom, sceneFor } from '../hooks/register.tsx'

// The thread's client status tints the mesh (Rob, 2026-11-24): the status picks the hue, the thread's fill how much.

const HUES = ['#2e7d4f', '#b7791f', '#c2203a', '#6fbf8a', '#e3a944', '#e86a7c']

test("the bridge's value: only a green, amber or red `here` counts", () => {
  expect(hereFrom({ here: { projectId: 'p1', client: 'Acme Legal', level: 'amber', words: 'behind' } })).toEqual({ status: 'amber', client: 'Acme Legal', words: 'behind' })
  expect(hereFrom({ dots: [], line: '', at: 1, here: { level: 'green' } })).toEqual({ status: 'green', client: '', words: '' })
  expect(hereFrom({ dots: [], line: '', at: 1 })).toBeUndefined()
  expect(hereFrom({ here: { level: 'blue' } })).toBeUndefined()
  expect(hereFrom({ here: 'red' })).toBeUndefined()
  expect(hereFrom(undefined)).toBeUndefined()
  expect(hereFrom(null)).toBeUndefined()
})

test('with no status the mesh keeps its own colors; a status tints it, more as the thread fills', () => {
  for (const level of [0, 1, 2, 3] as const) {
    const plain = sceneFor(level)
    expect(sceneFor(level, undefined)).toBe(plain)
    for (const hue of HUES) {
      expect(plain.includes(hue)).toBe(false)
    }
    // The grid and the base are the same with or without a tint.
    expect(sceneFor(level, 'red').includes('.base { fill: #f2efe8 }')).toBe(true)
    expect(sceneFor(level, 'red').includes('.grid { stroke: #0a0a0a; stroke-opacity: 0.16 }')).toBe(true)
  }
  // By day the first bloom (#d9d4c7) mixed toward red (#c2203a): 25% at level 0, 70% at level 3.
  expect(sceneFor(0, 'red')).toContain('.s1 { stop-color: #d3a7a4 }')
  expect(sceneFor(3, 'red')).toContain('.s1 { stop-color: #c95664 }')
  // The highlight is never tinted: the near-white by day, the black at night.
  expect(sceneFor(3, 'green')).toContain('.s3 { stop-color: #f7f5ef }')
  expect(sceneFor(3, 'green')).toContain('  .s3 { stop-color: #000000 }')
  // Each status its own hue.
  expect(sceneFor(2, 'green')).not.toBe(sceneFor(2, 'amber'))
  expect(sceneFor(2, 'amber')).not.toBe(sceneFor(2, 'red'))
})

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test("the scene follows the bridge's status, and the fill sets how deep it goes", async ($, on) => {
  const clock = mock.clock(on, { now: new Date(2026, 10, 24, 12, 0).getTime() })
  mock.store(on)
  let tokens = 150_000
  let you: unknown = { dots: [], line: '', at: 1, here: { projectId: 'p1', client: 'Acme Legal', level: 'amber', words: 'behind' } }
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
  on('state.get', () => ({ value: { value: you, version: you === undefined ? 0 : 1 } }))
  on('theme.set', (_, e) => {
    const b = e.backdrop as { scene?: string } | undefined
    scenes.push(b?.scene ?? '')

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(scenes.at(-1)).toBe('hero-mesh-0-amber')

  tokens = 440_000
  await $.turn.complete(TURN)
  expect(scenes.at(-1)).toBe('hero-mesh-3-amber')

  // The bridge says late: the next minute's tick draws it.
  you = { dots: [], line: '', at: 2, here: { projectId: 'p1', client: 'Acme Legal', level: 'red', words: '3h late' } }
  await clock.advance(60_000)
  expect(scenes.at(-1)).toBe('hero-mesh-3-red')

  const said = JSON.stringify(await $.command.run({ command: 'look', args: '' }))
  expect(said).toContain('Its tint: red, late, for Acme Legal (3h late).')

  // No client here any more: the mesh's own colors again.
  you = { dots: [], line: '', at: 3 }
  await $.turn.complete(TURN)
  expect(scenes.at(-1)).toBe('hero-mesh-3')

  // Glow off is the plain mesh, tint and all.
  you = { dots: [], line: '', at: 4, here: { projectId: 'p1', client: 'Acme Legal', level: 'green', words: 'on pace' } }
  const off = await $.command.run({ command: 'look', args: 'glow off' })
  expect(scenes.at(-1)).toBe('hero-mesh-0')
  expect(JSON.stringify(off)).toContain('Thread glow: off, and with it the client status tint.')

  await $.command.run({ command: 'look', args: 'glow on' })
  expect(scenes.at(-1)).toBe('hero-mesh-3-green')
})

test('no mm-bridge, or one older than 0.7.73: the scene is as it always was', async ($, on) => {
  mock.clock(on, { now: new Date(2026, 10, 24, 12, 0).getTime() })
  mock.store(on)
  const scenes: string[] = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 300_000, window: 1_000_000, percent: 30, breakdown: { autoCompactThreshold: 500_000, rawMaxTokens: 500_000 } } } }))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('theme.set', (_, e) => {
    scenes.push((e.backdrop as { scene?: string } | undefined)?.scene ?? '')

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(scenes.at(-1)).toBe('hero-mesh-1')
  expect(JSON.stringify(await $.command.run({ command: 'look', args: '' }))).toContain('No tint: mm-bridge has no client status for this thread.')
})
