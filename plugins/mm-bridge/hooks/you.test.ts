// (0.7.73) The "You" strip in the bridge itself: worked out from the store, this session's usage and the worklog hook's record, drawn
// first in the side pane (desktop and mobile) and as one line in the band (desktop; the terminal's band has no buttons). Read-only. The
// bridge against a pretend desktop app, feed and store (register-world.test-helper.ts); every client is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, LONG, ACME, BOLT, CEDAR, ME, SELF_CLI, PANE, BAND_PROPS, ago, feed, thread, world, mm, pane, bandOf, buttons, lines, tickOnce } from './register-world.test-helper'

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

describe('0.7.73: the "You" strip at the top of the side pane', () => {
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

describe('0.7.73: the strip\'s one line in the band', () => {
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

// ---------------------------------------------------------------- (0.7.73) the clients that need the person, in the You section

const ACME_ROW_HEAD = "Acme Roofing: approve Acme Roofing's reply package"
const BOLT_ROW_HEAD = 'Bolt Staffing: answer Client about "Question" (+1 more)'
const CEDAR_ROW_HEAD = 'Cedar Dental: deliver "Send the intake form"'
/** Acme's thread as the app lists it, linked, with the app's own link for it. */
const LINK_A = 'claude://claude.ai/epitaxy/local_a'
const acmeLinked = (over: WorldOptions = {}): WorldOptions => ({
  threads: [{ ...thread('local_a', 'Roof quote', 1), link: LINK_A } as never],
  ...over,
  store: { 'mm.links': { [ACME]: 'local_a' }, ...(over.store ?? {}) },
})
/** The You rows' heads as drawn: a Text without a thread, the button that opens it with one. */
const heads = async (ui: Parameters<typeof buttons>[0]) =>
  (await ui.findAll({})).flatMap(e => (e.type === 'Text' && /^\d+\. /.test(e.text) ? [e.text] : e.type === 'Button' && String(e.key).startsWith('mm-you-open:') ? [String(e.props.label)] : []))

describe('0.7.73: the You section replaces Needs you now', () => {
  test('desktop: under the dots, one row per client, soonest deadline first, each with what is needed, by when, its pin and why', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    const all = await lines(ui)
    expect(all[0]).toBe('You')
    expect(all).toContain('Needs you (3)')
    expect(await heads(ui)).toEqual([`1. ${CEDAR_ROW_HEAD}`, `2. ${ACME_ROW_HEAD}`, `3. ${BOLT_ROW_HEAD}`])
    // by when, in business time: today's clock, then tomorrow's
    expect(all).toContain('due 4 PM')
    expect(all).toContain('due Tue 8 AM')
    expect(all).toContain('due Tue 9 AM')
    // why, and the pin
    expect(all.some(l => l.startsWith('· ') && l.includes('reply ready for your go'))).toBe(true)
    expect(all.some(l => l.startsWith('· ') && l.includes('the client wrote'))).toBe(true)
    expect(all.some(l => /^· (pinned|needs a pin: .+|no pin needed yet)$/.test(l))).toBe(true)
    // no dropdown, and no Needs you now heading: the rows are always open; Team now stays closed below
    const keys = (await buttons(ui)).map(([k]) => k)
    expect(keys).not.toContain('mm-needs-toggle')
    expect(all.some(l => l.startsWith('Needs you now'))).toBe(false)
    expect((await buttons(ui)).find(([k]) => k === 'mm-teamnow-toggle')?.[1]).toMatch(/▸$/)
    // each row keeps its own buttons under it: Start for a client with no thread, Drafts
    expect(keys).toEqual(expect.arrayContaining([`start:${CEDAR}`, `drafts:${ACME}`, `start:${BOLT}`]))
    await ui.unmount()
  })

  test('mobile: the same rows, in the same order', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'mobile', component: 'Pane', requestId: 'mm-queue', props: PANE })
    await w.clock.advance(1_000)
    expect(await heads(ui)).toEqual([`1. ${CEDAR_ROW_HEAD}`, `2. ${ACME_ROW_HEAD}`, `3. ${BOLT_ROW_HEAD}`])
    expect(await lines(ui)).toContain('Needs you (3)')
    await ui.unmount()
  })

  test('a client with its own thread: a press on its row opens that thread, and nothing is sent, pinned or filled', LONG, async ($, on) => {
    const w = youWorld(on, acmeLinked({ feed: feed() }))
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(await heads(ui)).toContain(`2. ${ACME_ROW_HEAD}`)
    const acted = w.acted().length
    await ui.press({ key: `mm-you-open:${ACME}` })
    expect(w.ran.some(r => r.includes(LINK_A))).toBe(true)
    expect(w.acted().slice(acted)).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.fills).toEqual([])
    await ui.unmount()
  })

  test('late first, the most overdue first, in business days; a client date late reads late', LONG, async ($, on) => {
    const late = (key: string, project: string, name: string, dueHoursAgo: number) => ({
      message_id_key: key, received_at: ago(dueHoursAgo + 30), reply_due_at: ago(dueHoursAgo), sender: 'Kim Park <kim@example.com>',
      subject: `Re: ${name} follow-up`, snippet: 'hi', project_id: project, project_name: name, reply_status: 'unanswered', project_owner_email: ME,
    })
    // Bolt was due 50 business hours ago (2d late), Acme 26 (1d late); Cedar's task is due today
    const w = youWorld(on, { feed: feed({ drafts: [], mail: [late('a1', ACME, 'Acme Roofing', 26), late('b1', BOLT, 'Bolt Staffing (Sam)', 50)] }) })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(await heads(ui)).toEqual(['1. Bolt Staffing: answer Kim Park about "Bolt Staffing (Sam) follow-up"', '2. Acme Roofing: answer Kim Park about "Acme Roofing follow-up"', `3. ${CEDAR_ROW_HEAD}`])
    const all = await lines(ui)
    expect(all.find(l => l.startsWith('2d late'))).toMatch(/^2d late, due /)
    expect(all.find(l => l.startsWith('1d late'))).toMatch(/^1d late, due /)
    await ui.unmount()
  })

  test('a thread that waits on the person (mm waiting): its question beside its client\'s row', LONG, async ($, on) => {
    const w = youWorld(on, {
      ...acmeLinked({ feed: feed() }),
      store: {
        'mm.links': { [ACME]: 'local_a' },
        'mm.waiting': { local_a: { type: 'send', ask: 'Send the reply to Pat now', at: NOW } },
        'mm.pins': { local_a: { projectId: ACME, client: 'Acme Roofing', byUs: true, waiting: true } },
        'mm.rcpin': { on: true },
      },
    })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    await ui.unmount()
    const again = await pane($)
    await w.clock.advance(1_000)
    expect((await lines(again)).some(l => l.includes('waiting on you: Send the reply to Pat now'))).toBe(true)
    await again.unmount()
  })
})

describe('0.7.73: the band says what needs you and what is next', () => {
  test('desktop: Needs you: 3 and the soonest deadline as next; none of the lines about work the bridge does by itself', LONG, async ($, on) => {
    const w = youWorld(on, acmeLinked({ feed: feed() }))
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const band = await bandOf($)
    await w.clock.advance(1_000)
    const all = await lines(band)
    expect(all).toContain('Needs you: 3 · next:')
    expect((await buttons(band)).find(([k]) => k === 'mm-next')?.[1]).toBe('Cedar Dental, deliver "Send the intake form", due 4 PM')
    for (const gone of ['An update is ready to claim', "'s thread.", 'All threads started', 'chip is in', 'a chip is ready', 'Nothing needs you in the next 24 hours']) expect(all.some(l => l.includes(gone))).toBe(false)
    expect((await buttons(band)).map(([, label]) => label)).not.toContain('All threads started')
    await band.unmount()
  })

  test('next is the most overdue first; a press on it opens its thread, and nothing is sent', LONG, async ($, on) => {
    const w = youWorld(on, acmeLinked({ feed: feed({ drafts: [], mail: [{ message_id_key: 'a1', received_at: ago(40), reply_due_at: ago(26), sender: 'pat@acme.example', subject: 'Roof', snippet: '', project_id: ACME, project_name: 'Acme Roofing', reply_status: 'unanswered', project_owner_email: ME }] }) }))
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const band = await bandOf($)
    await w.clock.advance(1_000)
    expect(await lines(band)).toContain('Needs you: 2 · 1 late · next:')
    expect((await buttons(band)).find(([k]) => k === 'mm-next')?.[1]).toBe('Acme Roofing, answer Pat, 1d late')
    const acted = w.acted().length
    await band.press({ key: 'mm-next' })
    expect(w.ran.some(r => r.includes(LINK_A))).toBe(true)
    expect(w.acted().slice(acted)).toEqual([])
    await band.unmount()
  })

  test('nothing needs the person: a few words, and no button', LONG, async ($, on) => {
    const w = youWorld(on)
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const band = await bandOf($)
    await w.clock.advance(1_000)
    expect(await lines(band)).toContain('Nothing needs you right now.')
    expect((await buttons(band)).map(([k]) => k)).not.toContain('mm-next')
    await band.unmount()
  })
})
