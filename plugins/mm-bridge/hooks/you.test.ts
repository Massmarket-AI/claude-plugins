// (0.7.72) The "You" strip in the bridge itself: worked out from the store, this session's usage and the worklog hook's record, drawn
// first in the side pane (desktop and mobile) and as one line in the band (desktop; the terminal's band has no buttons). Read-only. The
// bridge against a pretend desktop app, feed and store (register-world.test-helper.ts); every client is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, LONG, SELF_CLI, PANE, BAND_PROPS, feed, world, mm, pane, bandOf, buttons, lines, tickOnce } from './register-world.test-helper'

const DECLARED = `/home/someone/.claude/mm-hooks/state/declarations/${SELF_CLI}.json`
const clear = (): Feed => feed({ drafts: [], mail: [], tickets: {} })

/** This session's usage as `$.session.usage()` answers it: `tokens` of a 400k compaction point, and the plan's windows. */
function usage(on: On, o: { tokens?: number; five?: number; week?: number } = {}) {
  const asked: unknown[] = []
  on('session.usage', (_$, e) => {
    asked.push(e)
    const rateLimits = [...(o.five !== undefined ? [{ kind: 'five_hour', percentUsed: o.five }] : []), ...(o.week !== undefined ? [{ kind: 'seven_day', percentUsed: o.week, resetsAt: new Date(NOW + 3 * 24 * 3600_000).toISOString() }] : [])]
    const breakdown = (e as { breakdown?: unknown }).breakdown ? { autoCompactThreshold: 400_000, rawMaxTokens: 500_000 } : undefined
    return { value: { startedAt: NOW - 3600_000, context: { tokens: o.tokens, window: 1_000_000, ...(breakdown ? { breakdown } : {}) }, rateLimits } as never }
  })
  return asked
}

/** A world whose thread has declared its task with the worklog hook and follows the pin over Remote Control: those two dots green. */
const youWorld = (on: On, over: WorldOptions = {}) =>
  world(on, { feed: clear(), ...over, files: { [DECLARED]: { text: JSON.stringify({ declared_skill: 'acme-roofing-project', declared_task: 'Phase 1 nurture copy' }), mtimeMs: NOW }, ...(over.files ?? {}) }, store: { 'mm.rcpin': { on: true }, ...(over.store ?? {}) } })

/** The strip's buttons, as [key, label]. */
const strip = async (ui: Parameters<typeof buttons>[0]) => (await buttons(ui)).filter(([k]) => k.startsWith('mm-you:'))

describe('0.7.72: the "You" strip at the top of the side pane', () => {
  test('desktop: eight dots in order, each with its count; a press opens its line under the strip, a second press closes it', LONG, async ($, on) => {
    const w = youWorld(on)
    usage(on, { tokens: 340_000, five: 90, week: 20 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    const dots = await strip(ui)
    expect(dots.map(([k]) => k)).toEqual(['mm-you:pins', 'mm-you:late', 'mm-you:replies', 'mm-you:sessions', 'mm-you:fill', 'mm-you:tier', 'mm-you:track', 'mm-you:rc'])
    expect(Object.fromEntries(dots)).toMatchObject({
      'mm-you:fill': '🔴 This thread 85%',
      'mm-you:tier': '🔴 Plan save',
      'mm-you:track': '🟢 Time tracking on',
      'mm-you:rc': '🟢 Remote Control on',
      'mm-you:late': '🟢 Late 0',
      'mm-you:replies': '🟢 Replies ready 0',
    })
    // the strip comes first in the pane
    expect((await lines(ui))[0]).toBe('You')
    await ui.press({ key: 'mm-you:fill' })
    expect(await lines(ui)).toContain('This thread is 85% of the way to compacting (340k of 400k tokens). It compacts soon: start the next job in a new thread.')
    await ui.press({ key: 'mm-you:track' })
    expect(await lines(ui)).toContain("This thread's task is declared: Phase 1 nurture copy.")
    expect((await lines(ui)).some(l => l.startsWith('This thread is 85%'))).toBe(false)
    await ui.press({ key: 'mm-you:track' })
    expect((await lines(ui)).some(l => l.startsWith("This thread's task"))).toBe(false)
    await ui.unmount()
  })

  test('mobile: the same strip, first, with the same presses', LONG, async ($, on) => {
    const w = youWorld(on)
    usage(on, { tokens: 100_000 })
    await mm($, '')
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'mobile', component: 'Pane', requestId: 'mm-queue', props: PANE })
    await w.clock.advance(1_000)
    const dots = await strip(ui)
    expect(dots).toHaveLength(8)
    expect(Object.fromEntries(dots)['mm-you:fill']).toBe('🟢 This thread 25%')
    await ui.press({ key: 'mm-you:rc' })
    expect(await lines(ui)).toContain('Remote Control follows the pin on this computer: a pinned thread reaches your phone.')
    await ui.unmount()
  })

  test('the compaction point is asked for once a session, from the summary breakdown, ahead of CLAUDE_CODE_AUTO_COMPACT_WINDOW', LONG, async ($, on) => {
    const w = youWorld(on, { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '200000' } })
    const asked = usage(on, { tokens: 150_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    // the breakdown's own threshold (400k) wins over the variable (200k): 150k is 38%
    expect(Object.fromEntries(await strip(ui))['mm-you:fill']).toBe('🟢 This thread 38%')
    await ui.press({ key: 'mm-you:fill' })
    await ui.unmount()
    const again = await pane($)
    await w.clock.advance(1_000)
    expect(asked.filter(a => (a as { breakdown?: unknown }).breakdown).length).toBe(1)
    await again.unmount()
  })

  test('no declaration from the worklog hook and Remote Control off: both amber, and their lines say what to do', LONG, async ($, on) => {
    const w = world(on, { feed: clear() })
    usage(on, {})
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    const dots = Object.fromEntries(await strip(ui))
    expect(dots['mm-you:track']).toBe('🟡 Time tracking off')
    expect(dots['mm-you:rc']).toBe('🟡 Remote Control off')
    expect(dots['mm-you:fill']).toBe('🟢 This thread –')
    expect(dots['mm-you:tier']).toBe('🟢 Plan normal')
    await ui.press({ key: 'mm-you:rc' })
    expect(await lines(ui)).toContain('Remote Control does not follow the pin on this computer, so a pinned thread does not reach your phone. Type /mm rc on.')
    await ui.unmount()
  })

  test('the replies a person can approve come from the sync', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed({ mail: [], tickets: {} }) })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    const dots = Object.fromEntries(await strip(ui))
    expect(dots['mm-you:replies']).toMatch(/^🟡 Replies ready [1-9]\d*$/)
    await ui.press({ key: 'mm-you:replies' })
    expect((await lines(ui)).some(l => /^\d+ reply packages? (?:is|are) ready for your go: /.test(l))).toBe(true)
    await ui.unmount()
  })

  test('⛔ read-only: working the strip out and pressing its dots asks the app, OW and the prompt box for nothing', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed({ mail: [], tickets: {} }) })
    usage(on, { tokens: 380_000, five: 95 })
    await mm($, '')
    const calls = w.calls.length
    const fetched = w.fetched.length
    const ui = await pane($)
    await w.clock.advance(1_000)
    for (const [key] of await strip(ui)) await ui.press({ key })
    expect(w.calls.slice(calls)).toEqual([])
    expect(w.fetched.slice(fetched)).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.fills).toEqual([])
    await ui.unmount()
  })
})

describe('0.7.72: the strip\'s one line in the band', () => {
  test('desktop: beside the band\'s own line when something is not green', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed({ drafts: [], tickets: {} }) })
    usage(on, { tokens: 300_000 })
    await mm($, '')
    const first = await bandOf($)
    await w.clock.advance(1_000)
    await first.unmount()
    const band = await bandOf($)
    expect((await lines(band)).some(l => l.includes('You: ') && l.includes('🟡 This thread 75%'))).toBe(true)
    await band.unmount()
  })

  test('desktop: all green, no line; the thread filling past 85%, the line comes within the minute', LONG, async ($, on) => {
    const w = youWorld(on)
    let tokens = 10_000
    on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens, window: 1_000_000 }, rateLimits: [] } as never }))
    // a started session: its minute timer works the strip out again
    await tickOnce($, w)
    await mm($, '')
    const quiet = await bandOf($)
    await w.clock.advance(1_000)
    await quiet.unmount()
    const still = await bandOf($)
    expect((await lines(still)).some(l => l.includes('You:'))).toBe(false)
    await still.unmount()
    tokens = 950_000
    await w.clock.advance(61_000)
    const red = await bandOf($)
    expect((await lines(red)).some(l => l.includes('You: 🔴 This thread 95%'))).toBe(true)
    await red.unmount()
  })

  test('terminal: no strip in the band (the bridge\'s band is the desktop app\'s), and nothing breaks', async ($, on) => {
    world(on, { feed: clear(), terminal: true })
    usage(on, { tokens: 950_000 })
    const band = await $.ui.mount({ plugin: 'mm-bridge', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, isCollapsed: false } })
    expect((await lines(band)).some(l => l.includes('You:'))).toBe(false)
    await band.unmount()
  })
})
