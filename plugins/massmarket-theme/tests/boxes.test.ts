import { expect, mock, test } from 'claude-code/testing'

// Only the person's messages have a box (Rob, 2026-11-25): Claude's words and tool rows have none. The box is the
// page's own color (match, the default) or the reverse (flip), chosen with /look boxes.

type Look = {
  colors?: { inputs?: Record<'light' | 'dark', Record<string, string>> }
  style?: Record<string, Record<string, unknown> | undefined>
}

test("your box is the page's color by default, the reverse with /look boxes flip, and Claude's words have none", async ($, on) => {
  mock.clock(on, { now: new Date(2026, 10, 25, 12, 0).getTime() })
  mock.store(on)
  const looks: Look[] = []

  on('command.register', () => ({ value: { command: 'look' } }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 10_000, window: 1_000_000, percent: 1 } } }))
  on('theme.set', (_, e) => {
    looks.push(e as Look)

    return { value: { isDrawn: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const match = looks.at(-1)!
  const light = match.colors!.inputs!.light
  const dark = match.colors!.inputs!.dark

  expect(light['bg-user-message']).toBe('#ffffff')
  expect(light['text-user-message']).toBe('#0a0a0a')
  expect(dark['bg-user-message']).toBe('#000000')
  expect(dark['text-user-message']).toBe('#f2efe8')
  // Claude's words: no message colors and no box rule, in either mode.
  for (const mode of [light, dark]) {
    expect(mode['bg-assistant-message']).toBeUndefined()
    expect(mode['text-assistant-message']).toBeUndefined()
  }
  expect(match.style!.AssistantMessage).toBeUndefined()
  expect(match.style!.ToolUse).toEqual({ fontFamily: ['mono'] })
  // Your box: square, solid, with a hairline so white on cream and black on black still read as a box.
  expect(match.style!.UserMessage).toEqual({ radius: 0, paddingX: 16, paddingY: 12, shadow: 'none', borderColor: 'border', borderWidth: 1 })

  const flipped = await $.command.run({ command: 'look', args: 'boxes flip' })
  const flip = looks.at(-1)!

  expect(flip.colors!.inputs!.light['bg-user-message']).toBe('#0a0a0a')
  expect(flip.colors!.inputs!.light['text-user-message']).toBe('#f2efe8')
  expect(flip.colors!.inputs!.dark['bg-user-message']).toBe('#f2efe8')
  expect(flip.colors!.inputs!.dark['text-user-message']).toBe('#0a0a0a')
  expect(flip.style!.UserMessage).toEqual({ radius: 0, paddingX: 16, paddingY: 12, shadow: 'none' })
  expect(flip.style!.AssistantMessage).toBeUndefined()
  expect(JSON.stringify(flipped)).toContain('black by day and cream at night')

  // Kept on this computer: a new session draws the flip.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(looks.at(-1)!.colors!.inputs!.light['bg-user-message']).toBe('#0a0a0a')

  await $.command.run({ command: 'look', args: 'boxes match' })
  expect(looks.at(-1)!.colors!.inputs!.light['bg-user-message']).toBe('#ffffff')

  // A word it doesn't know changes nothing and says how the look stands.
  const said = JSON.stringify(await $.command.run({ command: 'look', args: 'boxes purple' }))
  expect(said).toContain("white by day and black at night")
  expect(looks.at(-1)!.colors!.inputs!.light['bg-user-message']).toBe('#ffffff')
})
