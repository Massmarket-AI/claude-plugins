// The bridge against a pretend desktop app, feed and store: a client's REPLACED thread (0.7.62).
//
// Rob, 2026-11-19: "I noticed that even the old pinned bridge threads are still getting updated every time there's
// something new from the client. I think that's an issue that's probably wasting a lot of tokens team-wide. Once there's
// a new bridge thread, the old ones should stop being updated."
//
// What was found, Sellers Hub, 11-18: the client's new thread opened with the kickoff its old thread had handed out and
// took the link, and every update after that went to the new thread. But (1) an update sent at 6:08 PM to the old thread,
// in the middle of a turn then, was held by the app and delivered at 7:14 PM, a minute after the link moved; and (2) the
// old thread stayed one of the client's current threads (the feed still gave its sessions to the client), so its pane
// went on drawing the client and its reply package, and /mm status counted it.
//
// Every client and address below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import type { WorldOptions } from './register-world.test-helper'
import {
  NOW, HOUR, ago, LONG, ACME, SELF, thread, feed, world, sends, threadWrites, mm, pane, lines, ACME_KICKOFF, ACME_TITLE,
  HANDOVER, inOldWords, tickOnce, skillsOk, chipId, ourPin, PAIRS, acmeFeed, declared, ME,
} from './register-world.test-helper'

const DAY = 24 * HOUR
const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
  for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
}
/** Acme alone, its drafts ready: something to update a thread with. */
const acmeOnly = (): Feed => feed({ mail: [], tickets: {}, threads: [] })
const sentTo = (w: Parameters<typeof sends>[0]) => sends(w).map(c => String(c.args.session_id))
const status = ($: Parameters<typeof mm>[0]) => mm($, 'status')

/**
 * This thread is Acme's OLD thread: it opened with Acme's marker six days ago. Acme's new thread, local_new, opened with
 * the marker an hour ago and holds the link. The feed still gives this thread's sessions to Acme (its current project).
 */
const oldThreadWorld = (on: On, more: WorldOptions = {}) =>
  world(on, {
    skillMap: skillsOk,
    feed: acmeOnly(),
    threads: [thread('local_new', 'Acme Roofing: reply to the client', 1)],
    ...more,
    store: {
      'mm.links': { [ACME]: 'local_new' },
      'mm.marked': { [SELF]: ACME, local_new: ACME },
      'mm.markedAt': { [SELF]: NOW - 6 * DAY, local_new: NOW - HOUR },
      'mm.current': {
        [SELF]: { pid: ACME, how: 'feed', at: NOW - 10 * 60_000, declared: [ACME] },
        local_new: { pid: ACME, how: 'marker', at: NOW - HOUR, declared: [ACME] },
      },
      ...(more.store ?? {}),
    },
  })

describe('0.7.62: once a client\'s new bridge thread holds the link, its old thread is replaced', () => {
  test('the old thread\'s own view: not one of the client\'s current threads, no client part, no note, no pin, no name; the update goes to the new thread', LONG, async ($, on) => {
    const w = oldThreadWorld(on)
    await tickOnce($, w)
    expect(await status($)).toContain('current threads: 1 on 1 projects · second threads: 0 · replaced threads: 1')
    // its pane does not open by itself for the client, and draws no client part and no second-thread line
    expect(w.opened.filter(o => o.title === 'Acme Roofing')).toEqual([])
    const ui = await pane($)
    const drawn = await lines(ui)
    expect(drawn).not.toContain('This thread: Acme Roofing')
    expect(drawn.filter(l => l.startsWith('This is a second thread for Acme Roofing'))).toEqual([])
    await ui.unmount()
    // half an hour of syncs: the one update goes into the new thread; nothing into this one, by a send or a note
    await after(w, 30)
    await w.clock.advance(3_000)
    expect(sentTo(w)).toEqual(['local_new'])
    expect(w.appended).toEqual([])
    expect(threadWrites(w).filter(x => x.includes(SELF))).toEqual([])
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_new' })
    expect(await status($)).toContain('replaced threads: 1')
  })

  test('the old thread\'s /mm line says where the client\'s work is now, and how to bring the client back', async ($, on) => {
    const w = oldThreadWorld(on)
    await tickOnce($, w)
    const said = await mm($, 'line acme-site')
    expect(said).toContain('This thread was replaced for Acme Roofing')
    expect(said).toContain('/mm link Acme Roofing')
  })

  test('the person\'s /mm link in the old thread makes it the client\'s again: no longer replaced, and the newer thread is a second thread', async ($, on) => {
    const w = oldThreadWorld(on)
    await tickOnce($, w)
    await mm($, 'link Acme Roofing')
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(await status($)).toContain('current threads: 2 on 1 projects · second threads: 1 · replaced threads: 0')
  })

  test('the second-thread case: a thread that opened with the marker AFTER the linked one stays a second thread; the primary keeps every update', LONG, async ($, on) => {
    const w = world(on, {
      skillMap: skillsOk,
      feed: acmeOnly(),
      threads: [thread('local_a', 'Roof quote', 30)],
      store: {
        'mm.links': { [ACME]: 'local_a' },
        'mm.marked': { local_a: ACME, [SELF]: ACME },
        'mm.markedAt': { local_a: NOW - 2 * DAY, [SELF]: NOW - HOUR },
        'mm.current': { [SELF]: { pid: ACME, how: 'marker', at: NOW - HOUR, declared: [ACME] } },
      },
    })
    await tickOnce($, w)
    expect(await status($)).toContain('current threads: 2 on 1 projects · second threads: 1 · replaced threads: 0')
    const ui = await pane($)
    expect((await lines(ui)).filter(l => l.startsWith('This is a second thread for Acme Roofing'))).toHaveLength(1)
    await ui.unmount()
    await after(w, 30)
    await w.clock.advance(3_000)
    expect(sentTo(w)).toEqual(['local_a'])
    expect(w.appended).toEqual([])
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
  })

  // The replace case end to end, as on 11-18: the old thread put up the card (kickoffs), and this thread was started from it
  const prompt = `${ACME_KICKOFF}\n\n${HANDOVER('Roof quote', 'local_a', 'Acme Roofing Pat')}`
  const signature = `${inOldWords(ACME_KICKOFF)}\n${ago(3)}\n`
  const replacing = (on: On) =>
    world(on, {
      skillMap: skillsOk,
      feed: acmeFeed({}, [declared(ACME, 'cli-acme', 1)]),
      threads: [thread('local_a', ACME_TITLE, 1, { pinned: true })],
      store: {
        'mm.threads': PAIRS,
        'mm.links': { [ACME]: 'local_a' },
        'mm.pins': { local_a: ourPin(ACME, 'Acme Roofing') },
        'mm.titles': { local_a: 'Roof quote' },
        'mm.marked': { local_a: ACME },
        'mm.markedAt': { local_a: NOW - 6 * DAY },
        'mm.current': { local_a: { pid: ACME, how: 'feed', at: NOW - HOUR, declared: [ACME] } },
        'mm.chips': [{ projectId: ACME, signature, taskId: chipId(3), threadId: 'local_a', at: NOW - 60_000, prompt, had: 'local_a' }],
        'mm.last': { at: NOW - 60_000, member: ME, items: [], pinned: 1, recs: {}, projects: [ACME] },
      },
    })

  test('the replace case: the thread started from the old thread\'s card takes the link, and the old thread is replaced at once: unpinned, its name back, never updated or pinned again though the feed still gives it the client', LONG, async ($, on) => {
    const w = replacing(on)
    expect(await status($)).toContain('current threads: 1 on 1 projects · second threads: 0 · replaced threads: 0')
    await $.prompt.submit({ text: prompt, wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(await status($)).toContain('current threads: 1 on 1 projects · second threads: 0 · replaced threads: 1')
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: 'Roof quote', pinned: false })
    // the old thread is the one the person types into, and its sessions go on declaring the client
    w.threads.set('local_a', thread('local_a', 'Roof quote', 0))
    await after(w, 30)
    await w.clock.advance(3_000)
    expect(sentTo(w).filter(sid => sid === 'local_a')).toEqual([])
    expect(w.threads.get('local_a')).toMatchObject({ title: 'Roof quote', pinned: false })
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(await status($)).toContain('replaced threads: 1')
  })
})

describe('0.7.62: no update goes by itself into a thread in the middle of a turn', () => {
  test('the thread is busy: nothing is sent and nothing is on record; once its turn ends, the next sync sends it', LONG, async ($, on) => {
    const w = world(on, { feed: acmeOnly(), threads: [thread('local_a', 'Roof quote', 30, { isRunning: true })], store: { 'mm.links': { [ACME]: 'local_a' } } })
    await tickOnce($, w)
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect((w.stored['mm.autoupdates'] as unknown[] | undefined) ?? []).toEqual([])
    ;(w.threads.get('local_a') as { isRunning?: boolean }).isRunning = false
    await after(w, 6)
    await w.clock.advance(3_000)
    expect(sentTo(w)).toEqual(['local_a'])
  })

  test('Sellers Hub, 11-18: the client\'s thread is busy, and its new thread takes the link meanwhile; the update goes to the new thread, never the old one', LONG, async ($, on) => {
    const w = world(on, {
      feed: acmeOnly(),
      threads: [thread('local_a', 'Roof quote', 30, { isRunning: true }), thread('local_new', 'Acme Roofing: reply to the client', 2)],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.marked': { local_a: ACME }, 'mm.markedAt': { local_a: NOW - 6 * DAY } },
    })
    await tickOnce($, w)
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    // the new thread opens with the client's marker and takes the link (as linkFromMarker records it)
    w.stored['mm.links'] = { [ACME]: 'local_new' }
    w.stored['mm.marked'] = { local_a: ACME, local_new: ACME }
    w.stored['mm.markedAt'] = { local_a: NOW - 6 * DAY, local_new: w.clock.now() }
    await after(w, 6)
    await w.clock.advance(3_000)
    ;(w.threads.get('local_a') as { isRunning?: boolean }).isRunning = false
    await after(w, 30)
    await w.clock.advance(3_000)
    expect(sentTo(w)).toEqual(['local_new'])
  })
})
