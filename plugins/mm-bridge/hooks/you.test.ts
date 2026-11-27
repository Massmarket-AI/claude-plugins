// (0.7.73) The "You" strip in the bridge itself: worked out from the store, this session's usage and the worklog hook's record, drawn
// first in the side pane (desktop and mobile; (0.7.77) no longer in the band, which is 0.7.72's again). Read-only. The
// bridge against a pretend desktop app, feed and store (register-world.test-helper.ts); every client is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, LONG, ACME, BOLT, CEDAR, ME, SELF_CLI, PANE, BAND_PROPS, ago, feed, thread, world, mm, pane, bandOf, buttons, details, lines, tickOnce } from './register-world.test-helper'

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
    expect(dots.map(([k]) => k)).toEqual(['mm-you:pins', 'mm-you:late', 'mm-you:replies', 'mm-you:sessions', 'mm-you:pace', 'mm-you:tier', 'mm-you:track', 'mm-you:rc'])
    expect(Object.fromEntries(dots)).toMatchObject({
      'mm-you:pace': '🟢 Pace on pace',
      'mm-you:tier': '🔴 Plan save',
      'mm-you:track': '🟢 Time tracking on',
      'mm-you:rc': '🟢 Remote Control on',
      'mm-you:late': '🟢 Late 0',
      'mm-you:replies': '🟢 Replies ready 0',
    })
    // the strip comes first in the pane
    expect((await lines(ui))[0]).toBe('You')
    await ui.press({ key: 'mm-you:tier' })
    expect(await lines(ui)).toContain('Plan usage is save: 5-hour 90%, weekly 20%, on pace for 35% of the week. Hand light work to GPT and keep threads short.')
    await ui.press({ key: 'mm-you:track' })
    expect(await lines(ui)).toContain("This thread's task is declared: Phase 1 nurture copy.")
    expect((await lines(ui)).some(l => l.startsWith('Plan usage is'))).toBe(false)
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
    expect(Object.fromEntries(dots)['mm-you:pace']).toBe('🟢 Pace on pace')
    await ui.press({ key: 'mm-you:rc' })
    expect(await lines(ui)).toContain('Remote Control follows the pin on this computer: your most recently used pinned threads reach your phone, as many as its memory allows.')
    await ui.unmount()
  })

  test('Pace: a client late on its date is red, and the press names it; one whose work had to start and has not is amber', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed({ drafts: [], mail: [{ message_id_key: 'a1', received_at: ago(90), reply_due_at: ago(74), sender: 'pat@acme.example', subject: 'Roof', snippet: '', project_id: ACME, project_name: 'Acme Roofing', reply_status: 'unanswered', project_owner_email: ME }] }) })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(Object.fromEntries(await strip(ui))['mm-you:pace']).toBe('🔴 Pace 1 late')
    await ui.press({ key: 'mm-you:pace' })
    expect(await lines(ui)).toContain('1 late (Acme Roofing). The rest are on pace.')
    // and the row says it in its own colour and words
    expect((await lines(ui)).some(l => /^🔴 \dd late · /.test(l))).toBe(true)
    expect((await lines(ui)).some(l => l.startsWith('🟢 on pace · '))).toBe(true)
    await ui.unmount()
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
    expect(dots['mm-you:pace']).toBe('🟢 Pace on pace')
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

describe('0.7.77 (Rob 2026-11-25: "I also didn\'t want to add the U panel above where I type. I just wanted to remove the ship button. The way it was before was good for that"): the band as before, with no strip and no next', () => {
  test('desktop, something not green and clients waiting: the band\'s own words and Start missing threads, as in 0.7.72; no You line, no next button, no Ship', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000, five: 65 })
    await mm($, '')
    const first = await bandOf($)
    await w.clock.advance(1_000)
    await first.unmount()
    const band = await bandOf($)
    const all = await lines(band)
    expect(all.some(l => l.startsWith('Needs you: '))).toBe(true)
    expect(all.some(l => l.includes('You:') || l.includes('Plan conserve'))).toBe(false)
    expect(all.some(l => l.includes(' · next:'))).toBe(false)
    const keys = (await buttons(band)).map(([k]) => k)
    expect(keys).toContain('mm-start-missing')
    expect(keys).not.toContain('mm-next')
    expect(keys.some(k => /ship/i.test(k))).toBe(false)
    await band.unmount()
  })

  test('desktop, nothing needs the person: the old words, and Start missing threads drawn dim as All threads started', LONG, async ($, on) => {
    const w = youWorld(on)
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const band = await bandOf($)
    await w.clock.advance(1_000)
    expect(await lines(band)).toEqual(['Nothing needs you in the next 24 hours.'])
    expect(await buttons(band)).toEqual([['mm-start-missing', 'All threads started']])
    await band.unmount()
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
/** The You rows' heads as drawn: (0.7.77) plain text, with or without a thread. */
const heads = async (ui: Parameters<typeof buttons>[0]) => (await ui.findAll({})).flatMap(e => (e.type === 'Text' && /^\d+\. /.test(e.text) ? [e.text] : []))
/** (0.7.77) A You row's Details page, as drawn under it once opened: the Markdown's text, or undefined while closed. */
const page = async (ui: Parameters<typeof buttons>[0], projectId: string): Promise<string | undefined> => {
  const box = (await ui.findAll({ type: 'Box' })).find(e => e.key === `mm-you-page:${projectId}`)
  if (!box) return undefined
  const md = (await ui.findAll({ type: 'Markdown' })).find(m => box.children.includes(m as never)) ?? (await ui.findAll({ type: 'Markdown' })).at(-1)
  return String(md?.props.text ?? md?.text ?? '')
}

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
    // the row's second line, one line: on pace (its dot's colour and words first), by when in business time (today's clock,
    // then tomorrow's), its pin, and why
    expect(all).toContain('🟢 on pace · due 4 PM · needs a pin: no thread · due within 24 business hours · your ticket')
    expect(all).toContain('🟢 on pace · due Tue 8 AM · needs a pin: no thread · due within 24 business hours · reply ready for your go')
    expect(all).toContain('🟢 on pace · due Tue 9 AM · needs a pin: no thread · due within 24 business hours · the client wrote')
    // (0.7.77, Rob 2026-11-25: "Need you: still needs to be collapsible") the heading is its fold again, open at first; no Needs
    // you now heading; Team now stays closed below
    const keys = (await buttons(ui)).map(([k]) => k)
    expect((await buttons(ui)).find(([k]) => k === 'mm-needs-toggle')?.[1]).toBe('Needs you (3)  ▾')
    expect(all.some(l => l.startsWith('Needs you now'))).toBe(false)
    expect((await buttons(ui)).find(([k]) => k === 'mm-teamnow-toggle')?.[1]).toMatch(/▸$/)
    // ⛔ (0.7.77, Rob 2026-11-25: "I don't think we need the Update and Open Thread buttons, or the Draft button ... in the 'Needs
    // You'") Start for a client with no thread, and each row's Details; no Update, Open or Drafts, and no press on a row's words
    expect(keys).toEqual(expect.arrayContaining([`start:${CEDAR}`, `start:${BOLT}`, `mm-you-more:${ACME}`, `mm-you-more:${BOLT}`, `mm-you-more:${CEDAR}`]))
    expect(keys.filter(k => /^(update|open|drafts|mm-you-open):/.test(k))).toEqual([])
    await ui.unmount()
  })

  test('(0.7.77, Rob 2026-11-25: "Need you: still needs to be collapsible") the fold hides the rows, is remembered on this computer, and opens again', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    await ui.press({ key: 'mm-needs-toggle' })
    expect((await buttons(ui)).find(([k]) => k === 'mm-needs-toggle')?.[1]).toBe('Needs you (3)  ▸')
    expect(await heads(ui)).toEqual([])
    expect((await buttons(ui)).map(([k]) => k).filter(k => k.endsWith(CEDAR) || k.endsWith(ACME) || k.endsWith(BOLT))).toEqual([])
    // the dots above it stay
    expect((await lines(ui))[0]).toBe('You')
    await ui.unmount()
    // closed in every pane on this computer until it is opened again
    const again = await pane($)
    expect(await heads(again)).toEqual([])
    await again.press({ key: 'mm-needs-toggle' })
    expect(await heads(again)).toEqual([`1. ${CEDAR_ROW_HEAD}`, `2. ${ACME_ROW_HEAD}`, `3. ${BOLT_ROW_HEAD}`])
    await again.unmount()
    // read-only: folding asked for nothing
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
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

  test('(Rob 2026-11-25: "more specific client task details" than the thread name) under each row, desktop and mobile: what the item itself says beyond the head', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      await w.clock.advance(1_000)
      expect(await details(ui, ACME)).toEqual(['  Reply package: ready, covers mail through 8 AM'])
      expect(await details(ui, BOLT)).toEqual(['  Client wrote 3h ago: "hello" (2 messages)'])
      // Cedar's one ticket is its head already: nothing more to say
      expect(await details(ui, CEDAR)).toEqual([])
      await ui.unmount()
    }
    // read-only: drawing them asked for nothing
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('(0.7.77, Rob 2026-11-25: "I would just click the thread in the left-hand panel") a client with its own thread: its row\'s words are no press, and no Update, Open or Drafts is drawn for it', LONG, async ($, on) => {
    const w = youWorld(on, acmeLinked({ feed: feed() }))
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(await heads(ui)).toContain(`2. ${ACME_ROW_HEAD}`)
    expect((await buttons(ui)).filter(([k]) => k.endsWith(ACME)).map(([k]) => k)).toEqual([`mm-you-more:${ACME}`])
    await ui.unmount()
  })

  test('(0.7.77, Rob 2026-11-25: "I think we need some more detail") Details under a row opens the client\'s whole part there, on desktop and mobile, and closes on a second press; read-only', LONG, async ($, on) => {
    const w = youWorld(on, acmeLinked({ feed: feed() }))
    usage(on, { tokens: 10_000 })
    await mm($, '')
    for (const surface of ['desktop', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      await w.clock.advance(1_000)
      expect((await buttons(ui)).find(([k]) => k === `mm-you-more:${ACME}`)?.[1], surface).toBe('  Details  ▸')
      expect(await page(ui, ACME), surface).toBeUndefined()
      await ui.press({ key: `mm-you-more:${ACME}` })
      expect((await buttons(ui)).find(([k]) => k === `mm-you-more:${ACME}`)?.[1], surface).toBe('  Details  ▾')
      const text = await page(ui, ACME)
      expect(text?.split('\n')[0], surface).toBe('- Nothing we sent to Acme Roofing is in the feed.')
      expect(text, surface).toContain('Reply package: ready, covers mail through 8 AM')
      // only Acme's part opened
      expect(await page(ui, BOLT), surface).toBeUndefined()
      await ui.press({ key: `mm-you-more:${ACME}` })
      expect(await page(ui, ACME), surface).toBeUndefined()
      await ui.unmount()
    }
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([])
    expect(w.fills).toEqual([])
  })

  test('(0.7.77) an opened Details stays open in another pane on this computer, until closed', LONG, async ($, on) => {
    const w = youWorld(on, { feed: feed() })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    await ui.press({ key: `mm-you-more:${BOLT}` })
    await ui.unmount()
    const again = await pane($)
    expect((await page(again, BOLT))?.length).toBeGreaterThan(0)
    expect(await page(again, ACME)).toBeUndefined()
    await again.unmount()
  })

  test('late first, the most overdue first, in business days; a client date late reads late', LONG, async ($, on) => {
    const late = (key: string, project: string, name: string, dueHoursAgo: number) => ({
      message_id_key: key, received_at: ago(dueHoursAgo + 30), reply_due_at: ago(dueHoursAgo), sender: 'Kim Park <kim@example.com>',
      subject: `Re: ${name} follow-up`, snippet: 'hi', project_id: project, project_name: name, reply_status: 'unanswered', project_owner_email: ME,
    })
    // a Monday: Bolt was due Thursday 9 AM (50 business hours, 2d late), Acme Friday 9 AM (26, 1d late); Cedar's task is due today
    const w = youWorld(on, { feed: feed({ drafts: [], mail: [late('a1', ACME, 'Acme Roofing', 74), late('b1', BOLT, 'Bolt Staffing (Sam)', 98)] }) })
    usage(on, { tokens: 10_000 })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(await heads(ui)).toEqual(['1. Bolt Staffing: answer Kim Park about "Bolt Staffing (Sam) follow-up"', '2. Acme Roofing: answer Kim Park about "Acme Roofing follow-up"', `3. ${CEDAR_ROW_HEAD}`])
    const all = await lines(ui)
    expect(all.some(l => l.startsWith('🔴 2d late · 2d late, due Thu 9 AM · '))).toBe(true)
    expect(all.some(l => l.startsWith('🔴 1d late · 1d late, due Fri 9 AM · '))).toBe(true)
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

describe('0.7.73 (Rob 2026-11-25: "i dont think i want to make the gradient in the chat pane change color based on dueness of task"): no colour for the theme\'s glow', () => {
  test('a thread linked to a late client: `you` carries no `here`, so massmarket-theme keeps its plain mesh; the row and the thread\'s name say late', LONG, async ($, on) => {
    const w = youWorld(on, {
      ...acmeLinked({ feed: feed({ drafts: [], mail: [{ message_id_key: 'a1', received_at: ago(90), reply_due_at: ago(74), sender: 'pat@acme.example', subject: 'Roof', snippet: '', project_id: ACME, project_name: 'Acme Roofing', reply_status: 'unanswered', project_owner_email: ME }] }) }),
      self: thread('local_a', 'Roof quote', 1),
    })
    usage(on, { tokens: 10_000 })
    // what the bridge keeps as `you`, as the theme reads it
    const youSet: Array<{ here?: unknown }> = []
    on('state.set', { plugin: 'mm-bridge' }, async (_$, e, next) => {
      if (e.key === 'you') youSet.push(e.value as { here?: unknown })
      return next(e)
    })
    await mm($, '')
    const ui = await pane($)
    await w.clock.advance(1_000)
    expect(youSet.length).toBeGreaterThan(0)
    expect(youSet.every(v => !('here' in (v as object)))).toBe(true)
    // the indicator stays where it was: the row's own dot
    expect((await lines(ui)).some(l => l.startsWith('🔴 1d late · '))).toBe(true)
    await ui.unmount()
  })
})
