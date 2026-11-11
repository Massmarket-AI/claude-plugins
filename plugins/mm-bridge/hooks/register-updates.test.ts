// The bridge against a pretend desktop app, feed and store. This file tests clears and chips (0.5.3 to 0.5.9), a
// client's thread updated by itself and Start all (0.5.11 to 0.5.23), new people, and internal asks, the internal queue
// and internal tickets (to 0.7.15).
//
// Moved here from register.test.ts on 2026-11-11. Why it is three files: the top of register-world.test-helper.ts,
// which holds the world and helpers the three share.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Feed, FeedAsk, FeedQueueTicket } from './queue'
import { clockText, isNewerVersion } from './queue'
import { VERSION } from './register'
import { REFRESH_FAILED, TOP_LEVEL_STEP, freshParagraph } from './threads'
import type { Thread, Call, WorldOptions, Drawing } from './register-world.test-helper'
import {
  NOW, HOUR, ago, LONG, ACME, BOLT, CEDAR, ME, SELF, SELF_CLI, CARD_NOT_DRAWN, thread, feed, world, sends, chipTitles,
  SHELL_OUT, chipId, PANE, mm, pane, lines, buttons, ACME_TITLE, BOLT_TITLE, stepped, ACME_KICKOFF, BOLT_KICKOFF,
  ACME_NAMED, CEDAR_KICKOFF, CEDAR_FRESH, BOLT_FRESH, ACME_FRESH, ACME_ROW, SOON, CEDAR_AUTO_CHIP, ACME_HERE_CHIP,
  NOT_TAKEN, BOLT_AUTO_KICKOFF, markerFirst, PAIRS, declared, tool, ONLY_START, snapshot, bandOf, buttonsOf, under,
  acmeFeed, acmeWorld, HANDOVER, FOUNDER, TEAMMATE_B, packageFor, heldBy, mailFor, ourPin, tickOnce, closeouts, starts,
  proposals, cedarAlone, START_ALL, FILLED_ALL, startOf, filledOne, kicksIn, kickoffsOf, sessionCalls, person, notes,
  bandLines,
} from './register-world.test-helper'

// ======================================================================== 0.5.3: the clear sweep

describe('0.5.3: a cleared client\'s thread is unpinned once per clear, whatever record there is (Opus, 10-14)', () => {
  const DUNE = '44444444-4444-4444-4444-444444444444'
  const ELM = '55555555-5555-4555-8555-555555555555'
  const INTERNAL_OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const DUNE_CLEAR = '✓ Dune Freight · clear 5:27 AM'
  const ELM_CLEAR = '✓ Elm Optics Insurance · clear 8:17 PM'
  /** The two live shapes of 10-14: cleared under 0.5.1, still linked, no pin record, pinned in the app. */
  const liveShapes = (on: On) =>
    world(on, {
      threads: [thread('local_d', DUNE_CLEAR, 30, { pinned: true }), thread('local_e', ELM_CLEAR, 40, { pinned: true })],
      store: { 'mm.links': { [DUNE]: 'local_d', [ELM]: 'local_e' } },
    })
  const pinWrites = (w: { writes: () => string[] }) => w.writes().filter(c => c.startsWith('set_pinned'))
  const BOTH_UNPINNED = ['set_pinned | local_d | false', 'set_pinned | local_e | false']

  test('the two live shapes (linked, cleared, no pin record, pinned) are unpinned once, their names and links kept, and the clears recorded', async ($, on) => {
    const w = liveShapes(on)
    expect(w.stored['mm.pins']).toBeUndefined()
    await mm($, '')
    expect(w.threads.get('local_d')).toMatchObject({ title: DUNE_CLEAR, pinned: false })
    expect(w.threads.get('local_e')).toMatchObject({ title: ELM_CLEAR, pinned: false })
    expect(pinWrites(w)).toEqual(BOTH_UNPINNED)
    expect(w.stored['mm.cleared']).toEqual({ local_d: NOW, local_e: NOW })
    expect(w.stored['mm.links']).toEqual({ [DUNE]: 'local_d', [ELM]: 'local_e' })
    // once: the next syncs write nothing more to them
    for (let i = 0; i < 3; i++) {
      await w.clock.advance(5 * 60_000)
      await mm($, '')
    }
    expect(pinWrites(w)).toEqual(BOTH_UNPINNED)
  })

  test('a thread the person pins again after its client cleared stays pinned, sync after sync', async ($, on) => {
    const w = liveShapes(on)
    await mm($, '')
    ;(w.threads.get('local_d') as Thread).pinned = true
    for (let i = 0; i < 3; i++) {
      await w.clock.advance(5 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_d')).toMatchObject({ title: DUNE_CLEAR, pinned: true })
    expect(pinWrites(w)).toEqual(BOTH_UNPINNED)
  })

  test('a new need, then a clear: unpinned again, once; pinned again by the person after that clear, it stays', async ($, on) => {
    const w = liveShapes(on)
    await mm($, '')
    ;(w.threads.get('local_d') as Thread).pinned = true
    // something new for Dune: its record goes
    await w.clock.advance(HOUR)
    w.setFeed(feed({ mail: [mailFor(DUNE, 'Dune Freight', 0.5)] as never }))
    await mm($, '')
    expect(w.threads.get('local_d')?.pinned).toBe(true)
    expect(w.stored['mm.cleared']).toEqual({ local_e: NOW })
    // it clears again: unpinned, and named clear
    await w.clock.advance(HOUR)
    w.setFeed(feed())
    await mm($, '')
    expect(w.threads.get('local_d')).toMatchObject({ title: '✓ Dune Freight · clear 1 PM', pinned: false })
    expect(pinWrites(w).filter(c => c.includes('local_d'))).toEqual(['set_pinned | local_d | false', 'set_pinned | local_d | false'])
    expect(w.stored['mm.cleared']).toEqual({ local_e: NOW, local_d: NOW + 2 * HOUR })
    // pinned again by the person after this clear: it stays
    ;(w.threads.get('local_d') as Thread).pinned = true
    for (let i = 0; i < 2; i++) {
      await w.clock.advance(5 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_d')?.pinned).toBe(true)
    expect(pinWrites(w).filter(c => c.includes('local_d')).length).toBe(2)
  })

  for (const [label, read] of [
    ['a feed with no internal flag', feed()],
    ['a feed whose rows carry the flag (so its known ids are not listed by it)', feed({ mail: (feed().mail ?? []).map(m => ({ ...m, internal: false })) as never })],
  ] as Array<[string, Feed]>) {
    test(`R18: an internal project's thread, pinned with nothing waiting and no pin record, is untouched: ${label}`, async ($, on) => {
      const w = world(on, { feed: read, threads: [thread('local_i', 'Ops notes', 1, { pinned: true })], store: { 'mm.links': { [INTERNAL_OPS]: 'local_i' } } })
      await mm($, '')
      await w.clock.advance(5 * 60_000)
      await mm($, '')
      expect(w.threads.get('local_i')).toMatchObject({ title: 'Ops notes', pinned: true })
      expect(pinWrites(w)).toEqual([])
      expect(w.stored['mm.cleared']).toBeUndefined()
    })
  }

  test('R18: a project the feed flags internal keeps the person\'s pin once its item clears, on every later sync too', async ($, on) => {
    const OWN = '66666666-6666-4666-8666-666666666666'
    const task = { ticket_id: 'to', project_id: OWN, project_name: 'Our Tools', title: 'Fix it', due_at: new Date(NOW + 3 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME, internal: true }
    const w = world(on, {
      feed: { member: ME, role: 'builder', drafts: [], mail: [], tickets: { due_today: [task] as never }, threads: [] },
      threads: [thread('local_o', 'Tools notes', 1, { pinned: true })],
      store: { 'mm.links': { [OWN]: 'local_o' } },
    })
    await mm($, '')
    expect((w.stored['mm.pins'] as Record<string, unknown>).local_o).toMatchObject({ projectId: OWN, byUs: false, internal: true })
    w.setFeed({ member: ME, role: 'builder', drafts: [], mail: [], tickets: {}, threads: [] })
    for (let i = 0; i < 3; i++) {
      await w.clock.advance(5 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_o')).toMatchObject({ title: 'Tools notes', pinned: true })
    expect(pinWrites(w)).toEqual([])
  })

  for (const [label, read] of [
    // (0.7.12) until 0.7.12 the first case was a client under Older (mail of 8 days ago); what was due before the cut is
    // treated as done now, so that client clears (the (s) tests). A client whose only item has no due date stands in for it.
    ['with no due date', feed({ drafts: [], tickets: {}, mail: [mailFor(BOLT, 'Bolt Staffing (Sam)', 2, { reply_due_at: null })] as never })],
    [
      'on the list, further out than the pin\'s window',
      feed({ drafts: [], mail: [], tickets: { due_soon: [{ ticket_id: 'tb', project_id: BOLT, project_name: 'Bolt Staffing', title: 'Plan', due_at: new Date(NOW + 96 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }] } }),
    ],
  ] as Array<[string, Feed]>) {
    test(`a thread linked to a client still waiting (${label}) keeps the person's pin`, async ($, on) => {
      const w = world(on, { feed: read, threads: [thread('local_b', 'Staffing plan', 20, { pinned: true })], store: { 'mm.links': { [BOLT]: 'local_b' } } })
      await mm($, '')
      await w.clock.advance(5 * 60_000)
      await mm($, '')
      expect(w.threads.get('local_b')?.pinned).toBe(true)
      expect(pinWrites(w)).toEqual([])
      expect(w.stored['mm.cleared']).toBeUndefined()
    })
  }
})

describe('0.5.3: a thread\'s chips pass runs every 15 seconds; minting and the feed stay on the minute\'s tick', () => {
  const chip = (projectId: string, n: number, threadId: string, over: Record<string, unknown> = {}) => ({ projectId, signature: `sig-${n}`, taskId: chipId(n), threadId, at: NOW - HOUR, prompt: `prompt-${n}`, ...over })

  test('a chip whose client got a thread is withdrawn by the pass 15 seconds in, before the minute\'s tick', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [] }) })
    await tickOnce($, w)
    expect(w.acted()).toEqual([CEDAR_AUTO_CHIP])
    w.stored['mm.links'] = { [CEDAR]: 'local_other' }
    // 14 seconds in: not yet
    await w.clock.advance(10_000)
    expect(w.dismissed()).toEqual([])
    // 15 seconds in: the pass
    await w.clock.advance(1_000)
    expect(w.dismissed()).toEqual([chipId(1)])
    expect(w.stored['mm.chips']).toEqual([])
    // and the minute's tick withdraws nothing twice
    await w.clock.advance(60_000)
    expect(w.dismissed()).toEqual([chipId(1)])
  })

  test('the pass reads no feed and mints nothing: a new need is minted on the minute\'s tick', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {} }), store: { 'mm.lease': { owner: 'another-session', until: NOW + 24 * HOUR, version: VERSION } } })
    await tickOnce($, w)
    // a sync in this thread (another session holds the lease) puts Cedar on record, with no thread
    w.setFeed(feed({ drafts: [], mail: [] }))
    await mm($, '')
    const fetches = closeouts(w)
    // the passes at 15, 30 and 45 seconds: no chip, no feed call
    await w.clock.advance(52_000)
    expect(w.acted()).toEqual([])
    expect(closeouts(w)).toBe(fetches)
    // the minute's tick mints it
    await w.clock.advance(4_000)
    expect(w.acted()).toEqual([CEDAR_AUTO_CHIP])
    expect(closeouts(w)).toBe(fetches)
  })

  test('a withdrawal that failed is left to the minute\'s tick: the pass does not try it again', async ($, on) => {
    const w = world(on, { dismissFails: true, feed: feed({ drafts: [], mail: [] }) })
    await tickOnce($, w)
    // its own chip, superseded: the pass at 15 s tries it, the passes at 30 and 45 s do not, the tick at 60 s does
    w.stored['mm.chips'] = (w.stored['mm.chips'] as Array<Record<string, unknown>>).map(c => ({ ...c, superseded: true }))
    await w.clock.advance(11_000)
    expect(w.dismissed()).toEqual([chipId(1)])
    await w.clock.advance(30_000)
    expect(w.dismissed()).toEqual([chipId(1)])
    await w.clock.advance(15_000)
    expect(w.dismissed()).toEqual([chipId(1), chipId(1)])
  })
})

// ======================================================================== 0.5.5

describe('0.5.5: a row says "this thread" only in the thread it acts on (Rob, 10-14: one client\'s Claim, drawn in another client\'s thread)', () => {
  const SENT_AT = ago(0.25)
  const CHECKED = { last_outbound_at: SENT_AT, checked_send_at: SENT_AT, checked_at: ago(0.1), still_open: ['the logo file'], answered: [] }

  test('in the client\'s own thread: Claim in this thread, and the press puts the message in here, as the person\'s prompt', async ($, on) => {
    const w = world(on, { feed: acmeFeed(CHECKED), store: { 'mm.links': { [ACME]: SELF } } })
    await mm($, '')
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Claim in this thread', 'Drafts'])
    await ui.press({ key: `claim:${ACME}` })
    expect(sends(w)).toEqual([])
    expect(w.prompts.map(p => p.text)).toEqual([expect.stringMatching(/^Still open for Acme Roofing after our reply of /)])
    await ui.unmount()
  })

  test('in another thread: Claim in <client>\'s thread, and the press sends to that thread only', async ($, on) => {
    const w = acmeWorld(on, { feed: acmeFeed(CHECKED) })
    await mm($, '')
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Claim in Acme Roofing\'s thread', 'Drafts'])
    await ui.press({ key: `claim:${ACME}` })
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })
})

describe('0.5.5: the band says when a later mod is installed than this thread runs (Rob, 10-14 ~12:10 ET)', () => {
  const CACHE = '/home/someone/.claude/plugins/cache/massmarket/mm-bridge'
  const installed = (...versions: string[]) => Object.fromEntries(versions.map(v => [`${CACHE}/${v}/.claude-plugin/plugin.json`, { text: '{}', mtimeMs: 0 }]))
  const NEWER = (v: string) => `A newer Claude mod (${v}) is installed: quit and reopen Claude to load it.`
  const bandLines = async ($: Engine) => {
    const band = await bandOf($)
    const out = await lines(band)
    await band.unmount()
    return out
  }

  test('(a) a later version in the plugin cache: the line, at the end of the band\'s first line', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {} }), files: installed('0.0.1', '9.0.0', '10.0.0-beta') })
    await tickOnce($, w)
    expect(await bandLines($)).toEqual([`Nothing needs you in the next 24 hours · ${NEWER('9.0.0')}`])
  })

  test('the version this thread runs, an older one, or a malformed one: no line', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {} }), files: installed('0.0.1', '10.0', 'latest', '10.0.0-beta', 'v10.0.0') })
    await tickOnce($, w)
    expect(await bandLines($)).toEqual(['Nothing needs you in the next 24 hours.'])
    // the version this thread runs, as it wrote it in the store: in the cache too, still no line
    const mine = String((w.stored['mm.versions'] as Record<string, { version: string }>)[SELF]?.version)
    expect(mine).toMatch(/^\d+\.\d+\.\d+$/)
    w.stored['mm.versions'] = { ...(w.stored['mm.versions'] as Record<string, unknown>), local_other: { version: mine, at: NOW } }
    await w.clock.advance(5 * 60_000)
    expect(await bandLines($)).toEqual(['Nothing needs you in the next 24 hours.'])
  })

  test('(b) a thread on this machine reported a later version in the last day: the line; one reported two days ago: none', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {} }), store: { 'mm.versions': { local_other: { version: '9.1.0', at: NOW - HOUR }, local_old: { version: '99.0.0', at: NOW - 48 * HOUR } } } })
    await tickOnce($, w)
    expect(await bandLines($)).toEqual([`Nothing needs you in the next 24 hours · ${NEWER('9.1.0')}`])
  })

  test('versions are compared by number, never as strings', async () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0', '0.9.0')).toBe(false)
    expect(isNewerVersion('latest', '0.9.0')).toBe(false)
  })
})

// ======================================================================== 0.7.19

describe('0.7.19: a thread behind a later bridge that has run here runs no sync of its own accord; the person\'s /mm still does', () => {
  const SENT = `node ~/.claude/skills/team-api-gateway/scripts/mm-api.mjs ext POST /reply-draft/sent --body '{"draft_id":"d1","sent_ref":"gmail:abc"}'`
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ result?: unknown; deny?: string; isError?: boolean }>
  /** A thread running a later bridge reported its version on this machine a minute ago (`mm.versions`): it has run here. */
  const later = { 'mm.versions': { local_later: { version: '99.0.0', at: NOW - 60_000 } } }
  const CACHE = '/home/someone/.claude/plugins/cache/massmarket/mm-bridge'

  test('its timer takes no lease and syncs nothing; a reply draft sent there leaves the request for the holder and syncs nothing here', async ($, on) => {
    const w = world(on, { store: later })
    await tickOnce($, w)
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(closeouts(w)).toBe(0)
    expect(w.stored['mm.lease']).toBeUndefined()
    // R6's request is still made, for the lease's holder to read at its next tick
    const at = w.clock.now()
    await bash($, SENT)
    expect(w.stored['mm.ask']).toBe(at)
    await w.clock.advance(5_000)
    expect(closeouts(w)).toBe(0)
    expect(w.stored['mm.last']).toBeUndefined()
    // the person's own /mm here brings the list up to date, and takes no lease
    await mm($, '')
    expect(closeouts(w)).toBe(1)
    expect(w.stored['mm.lease']).toBeUndefined()
  })

  test('the same thread with no later bridge run here: the request syncs here a second later, as before', async ($, on) => {
    const w = world(on, { store: { 'mm.lease': { owner: 'another-session', until: NOW + 24 * HOUR, version: VERSION } } })
    await tickOnce($, w)
    await bash($, SENT)
    await w.clock.advance(1_000)
    expect(closeouts(w)).toBe(1)
  })

  test('a later version only in the plugin cache: the restart line, and the holder keeps syncing; once a thread running it reports itself here, the holder stands down', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {} }), files: { [`${CACHE}/99.0.0/.claude-plugin/plugin.json`]: { text: '{}', mtimeMs: 0 } } })
    await tickOnce($, w)
    const band = await bandOf($)
    expect(await lines(band)).toEqual(['Nothing needs you in the next 24 hours · A newer Claude mod (99.0.0) is installed: quit and reopen Claude to load it.'])
    await band.unmount()
    expect(closeouts(w)).toBe(1)
    expect(w.stored['mm.lease']).toMatchObject({ version: VERSION })
    // installed, and no thread runs it yet: the sync goes on every five minutes, the lease held
    for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
    expect(closeouts(w)).toBe(3)
    expect((w.stored['mm.lease'] as { until: number }).until).toBeGreaterThan(w.clock.now())
    // a thread running 99.0.0 reports itself here: at its next look (within five minutes) the holder stands down
    w.stored['mm.versions'] = { ...(w.stored['mm.versions'] as Record<string, unknown>), local_later: { version: '99.0.0', at: w.clock.now() } }
    for (let i = 0; i < 5; i++) await w.clock.advance(60_000)
    const syncs = closeouts(w)
    for (let i = 0; i < 15; i++) await w.clock.advance(60_000)
    expect(closeouts(w)).toBe(syncs)
    expect((w.stored['mm.lease'] as { until: number }).until).toBeLessThan(w.clock.now())
  })
})

// ======================================================================== 0.5.6

describe('0.5.6: a thread started from a chip is a sub-session of the thread that held it (Rob, 10-14); nothing reads the parent', () => {
  /** The parent linked to Acme; the child, started from a chip in it, linked to Bolt. */
  const family = (on: On) =>
    world(on, {
      threads: [thread('local_par', 'Parent work', 2), { ...thread('local_kid', 'Child work', 1), parentSessionId: 'local_par' } as Thread],
      store: { 'mm.links': { [ACME]: 'local_par', [BOLT]: 'local_kid' } },
    })

  test('the parent\'s client clears: the parent is unpinned and named clear; the child keeps its pin, its name and its link, then and on the syncs after', async ($, on) => {
    const w = family(on)
    await mm($, '')
    expect(w.threads.get('local_par')).toMatchObject({ title: ACME_TITLE, pinned: true })
    expect(w.threads.get('local_kid')).toMatchObject({ title: BOLT_TITLE, pinned: true })
    const before = w.writes().length
    w.setFeed(feed({ drafts: [] }))
    await mm($, '')
    expect(w.threads.get('local_par')).toMatchObject({ title: '✓ Acme Roofing · clear 11 AM', pinned: false })
    expect(w.threads.get('local_kid')).toMatchObject({ title: BOLT_TITLE, pinned: true })
    // the clear sweep on the syncs after touches the child no more
    for (let i = 0; i < 2; i++) {
      await w.clock.advance(5 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_kid')).toMatchObject({ title: BOLT_TITLE, pinned: true })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_par', [BOLT]: 'local_kid' })
    // nothing was written to the child once its parent's client cleared
    expect(w.writes().slice(before).filter(c => c.includes('local_kid'))).toEqual([])
  })

  test('the child\'s client clears: the parent keeps its pin and its client', async ($, on) => {
    const w = family(on)
    await mm($, '')
    w.setFeed(feed({ mail: [] }))
    await mm($, '')
    expect(w.threads.get('local_kid')).toMatchObject({ title: '✓ Bolt Staffing · clear 11 AM', pinned: false })
    expect(w.threads.get('local_par')).toMatchObject({ title: ACME_TITLE, pinned: true })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_par', [BOLT]: 'local_kid' })
  })
})

describe('0.5.6 (Opus gate): a chip the person made holds back the auto chips only while it can stand for them', () => {
  type ChipRec = { projectId: string; signature: string; taskId: string; threadId: string; at: number; prompt: string; auto?: true; superseded?: true }
  const acmeChips = (w: { minted: () => Call[] }) => w.minted().filter(c => String(c.args.title).includes('Acme Roofing'))
  /** Acme is this thread's; the timer mints its Do it here chip, and the person then moves Acme's chip to another thread with Start there. */
  const movedAway = async ($: Engine, on: On) => {
    const w = world(on, { feed: acmeFeed(), store: { 'mm.links': { [ACME]: SELF } } })
    await tickOnce($, w)
    expect(acmeChips(w).length).toBe(1)
    const chips = w.stored['mm.chips'] as ChipRec[]
    const mine = chips.find(c => c.projectId === ACME) as ChipRec
    // what Start in local_other leaves on record: its own chip, carrying what is waiting now, and this thread's superseded
    w.stored['mm.chips'] = [...chips.map(c => (c.projectId === ACME ? { ...c, superseded: true as const } : c)), { projectId: ACME, signature: mine.signature, taskId: 'task_00000099', threadId: 'local_other', at: NOW + 4_000, prompt: mine.prompt }]
    return w
  }

  test('moved away from the linked thread, carrying what is waiting now: the linked thread mints no chip of its own beside it', async ($, on) => {
    const w = await movedAway($, on)
    const own = (w.stored['mm.chips'] as ChipRec[]).find(c => c.projectId === ACME && c.threadId === SELF)?.taskId
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(acmeChips(w).length).toBe(1)
    // its own, superseded, it withdrew
    expect(w.dismissed()).toEqual([own])
  })

  test('the same chip once something new comes for the client: the linked thread mints its chip again (a chip the person dismissed is not seen)', async ($, on) => {
    const w = await movedAway($, on)
    await w.clock.advance(60_000)
    expect(acmeChips(w).length).toBe(1)
    // a newer package for Acme: what is waiting now is something else
    w.setFeed(acmeFeed({ covers_through: ago(1) }))
    await mm($, '')
    await w.clock.advance(60_000)
    expect(acmeChips(w).length).toBe(2)
    expect(acmeChips(w).at(-1)?.args.title).toBe(ACME_HERE_CHIP.args.title)
  })

  test('a client with no thread: a chip the person made anywhere holds back every auto chip for it, whatever it carries', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [] }), store: { 'mm.chips': [{ projectId: CEDAR, signature: 'something older', taskId: 'task_00000088', threadId: 'local_other', at: NOW - HOUR, prompt: 'an older prompt' }] } })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(w.minted().filter(c => String(c.args.title).includes('Cedar Dental'))).toEqual([])
  })
})

describe('0.5.25: Start puts the person\'s own words in the prompt box (Rob, 10-22: "Maybe clicking the button just types \'start missing threads\' into the command line"); the model starts the thread on them', () => {
  test('Start (start_session alone): "Start Cedar Dental\'s thread" in the prompt box, and what to do; no call to start_session, no chip or card, nothing linked; pressed again, not written twice', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    expect(w.box.text).toBe(startOf('Cedar Dental'))
    expect(w.toasts.at(-1)).toBe(filledOne('Cedar Dental'))
    expect(await lines(ui)).toContain(filledOne('Cedar Dental'))
    expect(w.stored['mm.chips']).toBeUndefined()
    expect((w.stored['mm.links'] as Record<string, string> | undefined)?.[CEDAR]).toBeUndefined()
    await ui.press({ key: `start:${CEDAR}` })
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    expect(w.toasts.at(-1)).toBe(filledOne('Cedar Dental'))
    expect(starts(w)).toEqual([])
    await ui.unmount()
  })

  test('⛔ a draft of the person\'s in the prompt box is never written over: the press says what to send', async ($, on) => {
    const w = world(on, { tools: 'start', box: 'half a thought about Bolt' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    await ui.unmount()
    expect(w.fills).toEqual([])
    expect(w.box.text).toBe('half a thought about Bolt')
    expect(w.toasts.at(-1)).toBe(`Your prompt box has a draft, so it was left as it is. Send "${startOf('Cedar Dental')}" when you are ready: Claude starts the thread, and the app asks you to allow it.`)
    expect(starts(w)).toEqual([])
  })

  test('a session whose prompt box takes nothing: the press says what to type', async ($, on) => {
    const w = world(on, { tools: 'start', box: null })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    await ui.unmount()
    expect(w.toasts.at(-1)).toBe(`Type "${startOf('Cedar Dental')}" and send it: Claude starts the thread, and the app asks you to allow it.`)
    expect(starts(w)).toEqual([])
  })

  test('both tools: the words too (the app gives start_session); spawn_task alone (the app before 10-14): today\'s chip', async ($, on) => {
    const w = world(on, { tools: 'both' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    await ui.unmount()
  })

  test('spawn_task alone (the app before 10-14): today\'s chip, and the prompt box is left alone', async ($, on) => {
    const w = world(on, { tools: 'spawn' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    expect(starts(w)).toEqual([])
    expect(w.minted().length).toBe(1)
    expect(w.fills).toEqual([])
    expect(w.toasts.at(-1)).toBe('A chip for Cedar Dental is ready here: click Start on it.')
    await ui.unmount()
  })

  test('a typed /mm start <client>, and /mm start all, the same way; Claude through the tool cannot', async ($, on) => {
    const w = world(on, { tools: 'start' })
    expect(await mm($, 'start cedar dental')).toBe(filledOne('Cedar Dental'))
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    // (the box as the person left it after sending)
    w.box.text = ''
    expect(await mm($, 'start all')).toBe(FILLED_ALL)
    expect(w.fills).toEqual([startOf('Cedar Dental'), START_ALL])
    expect(await tool($, 'start cedar dental')).toBe(ONLY_START)
    expect(await tool($, 'start all')).toBe(ONLY_START)
    expect(w.fills.length).toBe(2)
    expect(starts(w)).toEqual([])
  })

  test('a listing that names neither: spawn_task first, and its "no connected MCP tool" answer turns Start to the words', async ($, on) => {
    const w = world(on, { tools: 'start', toolsUnlisted: true })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    expect(w.toasts.at(-1)).toBe(filledOne('Cedar Dental'))
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    expect(starts(w)).toEqual([])
    // the next press knows: no chip asked for at all
    w.box.text = ''
    const spawnsBefore = w.calls.filter(c => c.tool === 'spawn_task').length
    await ui.press({ key: `start:${BOLT}` })
    expect(w.calls.filter(c => c.tool === 'spawn_task').length).toBe(spawnsBefore)
    expect(w.fills.at(-1)).toBe(startOf('Bolt Staffing'))
    await ui.unmount()
  })

  test('(0.7.34) a card on record: the person\'s stands for the client\'s one chip; one made by itself for something older is withdrawn and a new one goes up; nothing is ever started', async ($, on) => {
    const card = (taskId: string, pid: string, auto: boolean) => ({ projectId: pid, signature: `sig of ${pid}`, taskId, threadId: SELF, at: NOW - 60_000, prompt: `[mm-link ${pid}] a kickoff`, ...(auto ? { auto: true, gen: 4, need: 'start' } : {}) })
    const w = world(on, { tools: 'start', store: { 'mm.chips': [card('task_p0000001', CEDAR, false), card('task_p0000002', BOLT, true)] } })
    await tickOnce($, w)
    await w.clock.advance(15_000)
    expect(w.dismissed()).toEqual(['task_p0000002'])
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
    const made = sessionCalls(w).map(c => String(c.args.prompt).slice(9, 45))
    expect(made.sort()).toEqual([ACME, BOLT].sort())
  })
})

describe('0.7.28: a sync that fails stops neither Start missing threads nor the mm tool (2026-11-06: the words never reached the prompt box, and `queue` and `kickoffs` answered "no tool.call hook answered")', () => {
  const FAILED = 'Error: ccd_sidebar.set_pinned: refused'
  /** A sync that worked, then the sync on record marked failed and every sync after it failing. */
  const failingAfterASync = async ($: Engine, on: On) => {
    let down = false
    const w = world(on, { tools: 'start', feedStatus: () => (down ? 503 : 200) })
    await mm($, '')
    down = true
    w.stored['mm.last'] = { ...(w.stored['mm.last'] as object), error: FAILED }
    return w
  }

  test('(b) Start missing threads with the sync on record failed and the sync it runs failing: the words still go in the prompt box, from the stored list', async ($, on) => {
    const w = await failingAfterASync($, on)
    const band = await bandOf($)
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(w.fills).toEqual([START_ALL])
    expect(w.box.text).toBe(START_ALL)
    expect(w.toasts.at(-1)).toBe(FILLED_ALL)
    expect(starts(w)).toEqual([])
  })

  test('Start missing threads with no list at all: nothing to go on, and the press says why', async ($, on) => {
    const w = await failingAfterASync($, on)
    w.stored['mm.last'] = { at: NOW, member: ME, pinned: 0, recs: {} }
    const band = await bandOf($)
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(w.fills).toEqual([])
    expect(w.toasts.at(-1)).toContain('closeout HTTP 503')
  })

  test('(c) mm kickoffs with the sync failing answers from the stored list, as if the sync had worked', async ($, on) => {
    await failingAfterASync($, on)
    const kicks = kicksIn(await tool($, 'kickoffs'))
    expect(kicks.map(k => k.client).sort()).toEqual(['Acme Roofing', 'Bolt Staffing', 'Cedar Dental'])
  })

  test('mm queue with the sync failing answers why, and from the stored list', async ($, on) => {
    await failingAfterASync($, on)
    for (const args of ['queue', '']) {
      const said = await tool($, args)
      expect(said).toContain('closeout HTTP 503')
      expect(said).toContain('From the list as last loaded: 3 clients need you')
    }
  })

  test('with no list at all every subcommand still answers, with the failure as its result', async ($, on) => {
    world(on, { tools: 'start', feedStatus: () => 503 })
    for (const args of ['kickoffs', 'kickoffs Acme Roofing', 'queue', '', 'restore Acme Roofing', 'link Acme Roofing']) expect(await tool($, args)).toContain('closeout HTTP 503')
    expect(await tool($, 'status')).toContain('last sync: never')
  })
})

describe('0.5.25: the mm tool\'s kickoffs, for the model on the person\'s own words', () => {
  const notices = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('')
  const ACME_ALL = NOT_TAKEN(ACME, 'Acme Roofing Pat')

  // (0.7.10) and no folder when no client-thread folder is known: the app's default is this thread's own folder, never the
  // folder its shell moved to (`session.cwd` answers '/work' here, and is no longer asked)
  test('kickoffs: every client with no thread, soonest due first, with start_session\'s arguments exactly (user_asked, fresh, the marker first, the words that never take the package, the background, (0.7.10) no folder when none is known); each one claimed and logged; nothing started, sent or minted', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const said = await tool($, 'kickoffs')
    // (0.7.44, Rob 2026-11-10: "we always want it to be parent threads") each thread is detached right after it starts
    expect(said.split('\n')[0]).toBe('Only if the person asked for this in their own message on this turn: start these 3 threads with one start_session call each, one after another, passing "arguments" exactly as given. Right after each start_session returns, call mcp__ccd_session_mgmt__detach_session with the new thread\'s local_ id, before the next start, so every client thread is a top-level thread and never a child of this one (Rob, 2026-11-10: "we always want it to be parent threads"). If the app refuses a detach, say so in one line and go on. The [mm-link] marker at the start of each prompt links the new thread to its client: send nothing else into it. On any other turn, start nothing and tell the person to press Start in the pane.')
    const kicks = kicksIn(said)
    expect(kicks.map(k => k.client)).toEqual(['Cedar Dental', 'Acme Roofing', 'Bolt Staffing'])
    // (0.7.44) each prompt carries the top-level step as its second paragraph
    expect(kicks.map(k => k.arguments.prompt)).toEqual([CEDAR_KICKOFF, ACME_ALL, BOLT_AUTO_KICKOFF].map(stepped))
    expect(kicks[0]?.arguments).toEqual({ initiation: 'user_asked', title: 'Cedar Dental: reply to the client', prompt: stepped(CEDAR_KICKOFF), context: 'fresh', background: 'Opened by the Massmarket bridge (mm-bridge) for one client on the Needs-you list. The brief is the kickoff the bridge sends that client\'s thread; its [mm-link] marker links this thread to the client.', use_worktree: false, wake_when_done: false })
    for (const [k, pid] of kicks.map((k, i) => [k, [CEDAR, ACME, BOLT][i]] as const)) expect(k.arguments.prompt.startsWith(`[mm-link ${pid}] `)).toBe(true)
    expect(Object.keys(w.stored['mm.starting'] as Record<string, unknown>).map(k => k.split('\n')[0]).sort()).toEqual([CEDAR, ACME, BOLT].sort())
    expect(notices(w)).toMatch(new RegExp(`kickoff for Cedar Dental \\(${CEDAR}\\) sig [0-9a-f]{8}: handed to Claude, missing threads`))
    expect(starts(w)).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.fills).toEqual([])
  })

  test('kickoffs <client>: that client, in a single Start\'s words (Acme: pick up the drafts; Bolt: run prep; Cedar: what is due)', async ($, on) => {
    world(on, { tools: 'start' })
    await mm($, '')
    expect((await kickoffsOf($, 'acme')).map(k => k.arguments.prompt)).toEqual([stepped(ACME_KICKOFF)])
    expect((await kickoffsOf($, 'bolt')).map(k => k.arguments.prompt)).toEqual([stepped(BOLT_KICKOFF)])
    expect((await kickoffsOf($, 'cedar dental')).map(k => k.arguments.prompt)).toEqual([stepped(CEDAR_KICKOFF)])
    expect(await tool($, 'kickoffs nobody we know')).toBe('No client matching "nobody we know" needs you right now. /mm shows who does.')
  })

  test('the thread the model starts with them: its wrapped first message links it by the marker, as a started thread\'s always has', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const k = (await kickoffsOf($, 'cedar'))[0]?.arguments as { prompt: string; background: string }
    await $.prompt.submit({ text: `Background (from the session that started this one):\n${k.background}\n\nTask:\n${k.prompt}`, wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toMatchObject({ [CEDAR]: SELF })
    expect((w.stored['mm.sent'] as Record<string, { sid: string }>)[CEDAR]?.sid).toBe(SELF)
  })

  test('⛔ a client another thread is starting now (its claim in mm.starting) is skipped and named; its claim is left as it is', async ($, on) => {
    const w = world(on, { tools: 'start', store: { 'mm.starting': { [`${BOLT}\n0badc0de`]: { owner: 'local_elsewhere', until: NOW + 60_000 } } } })
    await mm($, '')
    const said = await tool($, 'kickoffs')
    expect(kicksIn(said).map(k => k.client)).toEqual(['Cedar Dental', 'Acme Roofing'])
    expect(said.split('\n').at(-1)).toBe('Skipped: Bolt Staffing (another thread is starting it now).')
    expect((w.stored['mm.starting'] as Record<string, unknown>)[`${BOLT}\n0badc0de`]).toEqual({ owner: 'local_elsewhere', until: NOW + 60_000 })
    // asked again in this thread: (0.7.10; until 0.7.10 its own claims were its own, and the two came back) the two
    // just handed out are pending, and nothing is handed out twice
    const again = await tool($, 'kickoffs')
    expect(kicksIn(again)).toEqual([])
    expect(again).toContain('Already handed out in the last 10 minutes and not linked yet: Cedar Dental, Acme Roofing. Do not start them again')
  })

  test('nine clients: eight, and the ninth once those have threads', async ($, on) => {
    const pidOf = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
    const w = world(on, { tools: 'start', feed: feed({ drafts: [], tickets: {}, mail: Array.from({ length: 9 }, (_, i) => mailFor(pidOf(i), `Client ${i}`, 1 + i)) }) })
    await mm($, '')
    const said = await tool($, 'kickoffs')
    expect(kicksIn(said).length).toBe(8)
    expect(said.split('\n').at(-1)).toBe('1 more needs a thread: once these have started, call mm with "kickoffs" again.')
    // the eight start, and their markers link them
    w.stored['mm.links'] = Object.fromEntries(kicksIn(said).map((k, i) => [/^\[mm-link ([0-9a-f-]{36})\]/.exec(k.arguments.prompt)?.[1] ?? '', `local_new_${i}`]))
    // (0.7.20) and they are in the app: kickoffs now syncs before it hands out a client with no thread here, and a sync
    // drops a link to a thread the app and its records do not have
    for (let i = 0; i < 8; i++) w.threads.set(`local_new_${i}`, thread(`local_new_${i}`, `New thread ${i}`, 0))
    const rest = await tool($, 'kickoffs')
    expect(kicksIn(rest).length).toBe(1)
    expect(rest.split('\n')).toHaveLength(2)
  })

  test('nothing to start: it says so; where the app gives no start_session: it says nothing can be started from there', async ($, on) => {
    world(on, { tools: 'start', feed: feed({ drafts: [], mail: [], tickets: {} }) })
    await mm($, '')
    expect(await tool($, 'kickoffs')).toBe('No client needs a new thread now.')
  })

  test('where the app gives no start_session, kickoffs says nothing can be started from here', async ($, on) => {
    world(on, { tools: 'spawn' })
    await mm($, '')
    expect(await tool($, 'kickoffs')).toBe('This thread has no start_session (the desktop app\'s Code tab has it), so no thread can be started from here.')
  })
})

describe('0.5.25: a client with no thread: no thread started by itself, and (0.5.25 to 0.7.33) no card; (0.7.34, Rob 11-07: "still should have started a chip for them") its card again (Rob, 10-22: "it\'s kind of confusing having a button and chips appear that don\'t work")', () => {
  const INTERNAL_OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const notices = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).at(-1)?.text ?? ''

  test('a client with no thread: (0.7.34) its card, once, and no start, tick after tick; its row offers Start, and the band Start missing threads', async ($, on) => {
    const w = world(on, { tools: 'start', feed: cedarAlone() })
    await tickOnce($, w)
    for (let i = 0; i < 5; i++) await w.clock.advance(60_000)
    expect(starts(w)).toEqual([])
    expect(sessionCalls(w).length).toBe(1)
    expect((w.stored['mm.chips'] as unknown[]).length).toBe(1)
    const ui = await pane($)
    expect(await buttonsOf(ui, CEDAR)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'Start missing threads (1)']])
    await band.unmount()
  })

  test('an internal project: nothing for the founder; a teammate\'s assigned internal ticket with a date is a row like a client\'s, and gets its card', async ($, on) => {
    const iTicket = { ticket_id: 'ti', project_id: INTERNAL_OPS, project_name: 'Massmarket AI', title: 'Fix tracker', due_at: new Date(NOW + 3 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }
    const w = world(on, { tools: 'start', feed: { member: ME, role: 'builder', drafts: [], mail: [], tickets: { due_today: [iTicket] }, threads: [] }, threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(starts(w)).toEqual([])
    expect(sessionCalls(w).length).toBe(1)
  })

  test('the founder\'s internal ticket: no card', async ($, on) => {
    const iTicket = { ticket_id: 'ti', project_id: INTERNAL_OPS, project_name: 'Massmarket AI', title: 'Fix tracker', due_at: new Date(NOW + 3 * HOUR).toISOString(), due_source: 'commitment', assignee_email: 'rob@massmarket.ai' }
    const w = world(on, { tools: 'start', feed: { member: 'rob@massmarket.ai', role: 'founder', drafts: [], mail: [], tickets: { due_today: [iTicket] }, threads: [] }, threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(sessionCalls(w)).toEqual([])
  })

  test('0.5.23\'s record of threads started by itself changes nothing, and is left as it is', async ($, on) => {
    const earlier = Array.from({ length: 4 }, (_, i) => ({ at: NOW - (i + 1) * 600_000, pid: `9999999${i}-9999-4999-8999-999999999999`, client: `Client ${i}`, sig: '00000000', kind: 'nothread', by: 'local_x', ok: true, reason: 'no thread' }))
    const w = world(on, { tools: 'start', feed: cedarAlone(), store: { 'mm.autostarts': earlier } })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    expect(starts(w)).toEqual([])
    expect(w.stored['mm.autostarts']).toEqual(earlier)
  })

  test('/mm auto off and on: what the switch does now; no thread started either way', async ($, on) => {
    const w = world(on, { tools: 'start', feed: cedarAlone() })
    expect(await mm($, 'auto off')).toBe('Auto-update is off: a client\'s thread waits for you to press Update. A client with no thread gets a card to start it.')
    expect(await mm($, 'auto')).toBe('Auto-update is off on this computer. Type /mm auto off or /mm auto on.')
    expect(await mm($, 'status')).toContain('auto-update: off')
    await tickOnce($, w)
    await w.clock.advance(3_000)
    expect(starts(w)).toEqual([])
    expect(await mm($, 'auto on')).toBe('Auto-update is on: a client\'s thread is updated by itself when something new arrives, an old thread too. A client with no thread gets a card to start it.')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(starts(w)).toEqual([])
  })

  test('/mm auto off where the app has only spawn_task: today\'s chip', async ($, on) => {
    const w = world(on, { tools: 'spawn', feed: cedarAlone() })
    await mm($, 'auto off')
    await tickOnce($, w)
    expect(w.acted()).toEqual([CEDAR_AUTO_CHIP])
    expect(starts(w)).toEqual([])
  })

  test('where the app has only start_session, a thread\'s own Do it here chip is not made: Update in the pane does it', async ($, on) => {
    const w = world(on, { tools: 'start', feed: acmeFeed(), store: { 'mm.links': { [ACME]: SELF } } })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
  })
})

// ======================================================================== 0.5.8

describe('0.5.8: the marker in the app\'s wrapper around a started thread\'s first message (the hook builder, 10-14)', () => {
  /** What the app sends a fresh thread first, as its own code builds it: the background, the task, then its notes line. */
  const BG = 'Opened by the Massmarket bridge (mm-bridge) for one client on the Needs-you list. The brief is the kickoff the bridge sends that client\'s thread; its [mm-link] marker links this thread to the client.'
  const NOTES = '\n\nShared notes folder for this group of sessions (outside the repo; read siblings\' notes there, leave hand-over notes or large findings there instead of pasting them into messages): /Users/someone/notes/local_hub'
  const fresh = (prompt: string, background = BG, notes = NOTES) => `Background (from the session that started this one):\n${background}\n\nTask:\n${prompt}${notes}`
  /** A fork's first message (and an offer's brief, with the fresh form inside). */
  const fork = (prompt: string) => `Task (from the session that started this one):\n${prompt}`

  test('a fresh thread\'s wrapped first message links it from the start of its task, with or without the notes line; what it carries is recorded', async ($, on) => {
    const w = world(on)
    await mm($, '')
    for (const text of [fresh(BOLT_KICKOFF), fresh(BOLT_KICKOFF, BG, '')]) {
      w.stored['mm.links'] = {}
      delete w.stored['mm.sent']
      await $.prompt.submit({ text, wait: false, origin: { kind: 'sdk' } } as never)
      expect(w.stored['mm.links']).toEqual({ [BOLT]: SELF })
      // its task is the kickoff the bridge would send now (the notes line after it is the app's): on record as this thread's
      expect((w.stored['mm.sent'] as Record<string, unknown> | undefined)?.[BOLT]).toMatchObject({ sid: SELF })
    }
    expect(w.stored['mm.acted']).toBeUndefined()
  })

  test('a fork\'s first message links it: `Task (…):` as the app sends it (auto-continuation), or as the person\'s turn; and an offer\'s brief, the fresh form inside it', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const cases = [
      [fork(BOLT_KICKOFF), 'auto-continuation'],
      [fork(BOLT_KICKOFF), 'sdk'],
      [fork(fresh(BOLT_KICKOFF)), 'auto-continuation'],
    ] as const
    for (const [text, kind] of cases) {
      w.stored['mm.links'] = {}
      await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
      expect(w.stored['mm.links'], `${kind}: ${text.slice(0, 50)}`).toEqual({ [BOLT]: SELF })
    }
  })

  test('a marker anywhere else does nothing: in the middle of normal text, in the background, after a wrapper that does not begin the message', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const before = snapshot(w)
    const person = [
      `please look at ${BOLT_KICKOFF}`,
      `Some notes first.\n\n${BOLT_KICKOFF}`,
      // a Task: line with no wrapper above it, or the wrapper somewhere other than where the message begins
      `Notes.\n\nTask:\n${BOLT_KICKOFF}`,
      `Task:\n${BOLT_KICKOFF}`,
      `fyi\n${fresh(BOLT_KICKOFF)}`,
      `fyi\n${fork(BOLT_KICKOFF)}`,
      // the wrapper begins the message, but its task does not begin with the marker
      fresh(`Look at this: ${BOLT_KICKOFF}`),
      fork(`see ${BOLT_KICKOFF}`),
      // the marker in the background, not the task
      fresh('Do the thing.', `${BOLT_KICKOFF} ${BG}`),
    ]
    for (const text of person) await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    // the app's own delivery counts only in its `Task (…):` wrapper; another session's message or a notification never
    const others = [
      [BOLT_KICKOFF, 'auto-continuation'],
      [fresh(BOLT_KICKOFF), 'auto-continuation'],
      [fresh(BOLT_KICKOFF), 'peer'],
      [fork(BOLT_KICKOFF), 'peer'],
      [fork(BOLT_KICKOFF), 'task-notification'],
    ] as const
    for (const [text, kind] of others) await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
    expect(snapshot(w)).toBe(before)
    expect(w.stored['mm.links']).toEqual({})
    // every prompt went on to the session untouched
    expect(w.prompts.length).toBe(person.length + others.length)
  })

  test('a chip the person started: its wrapped thread is recognised as started from that chip, takes the client, and every chip for the client is superseded', async ($, on) => {
    const w = world(on, { tools: 'spawn', feed: cedarAlone() })
    await mm($, 'auto off')
    await tickOnce($, w)
    const card = w.minted()[0]?.args as { prompt: string }
    expect(card.prompt.startsWith(`[mm-link ${CEDAR}] `)).toBe(true)
    // the chip is in the hub, and another thread has its own copy of the client's chip
    const chips = w.stored['mm.chips'] as Array<Record<string, unknown>>
    const minted = chips.find(c => c.projectId === CEDAR) as Record<string, unknown>
    minted.threadId = 'local_hub'
    chips.push({ ...minted, taskId: 'task_p0000099', threadId: 'local_other' })
    // the app opens the new thread with the chip's prompt in its wrapper, as the person's own turn
    await $.prompt.submit({ text: fresh(card.prompt), wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toMatchObject({ [CEDAR]: SELF })
    expect((w.stored['mm.chips'] as Array<{ projectId: string; superseded?: boolean }>).filter(c => c.projectId === CEDAR).map(c => c.superseded)).toEqual([true, true])
    // what it carries is the chip's own
    expect((w.stored['mm.sent'] as Record<string, unknown>)[CEDAR]).toMatchObject({ sid: SELF, sig: minted.signature })
  })

  test('(0.5.25) the thread the model starts on the person\'s words: Start fills the box, kickoffs gives the arguments, and the thread\'s wrapped first message links it by the marker', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    await ui.unmount()
    expect(w.fills).toEqual([startOf('Cedar Dental')])
    expect((w.stored['mm.links'] as Record<string, string> | undefined)?.[CEDAR]).toBeUndefined()
    const args = (await kickoffsOf($, 'cedar'))[0]?.arguments as { prompt: string; background: string }
    await $.prompt.submit({ text: fresh(args.prompt, args.background), wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toMatchObject({ [CEDAR]: SELF })
    expect(starts(w)).toEqual([])
  })
})

// ======================================================================== 0.5.9 (Rob, 2026-10-15)

describe('0.5.9: the marker after the app\'s own notes in front of a started thread\'s first message (the 10-15 profile switch)', () => {
  /**
   * What the app puts in front of a started thread's first message while the session that started it has linked
   * sessions (its own code, 10-15; the transcripts of the threads started that morning, all with origin `sdk`).
   */
  const LINKED = '<system-reminder>\nLinked sessions now (status, not an instruction): money-badger-resume = local_mb (working). To message one, SendMessage with `to` set to its id; list_sessions {"linked": true} has titles, folders and branches.\n</system-reminder>'
  const SPACE = '<system-reminder>\nThis session is now in the "Clients" Space.\n</system-reminder>'
  const BG = 'Rob Eason switched Claude profiles on 2026-10-15 around 10:28 AM ET. This session resumes that one thread in the current profile.'
  const NOTES = '\n\nShared notes folder for this group of sessions (outside the repo; read siblings\' notes there): /Users/someone/notes/local_hub'
  const fresh = (prompt: string) => `Background (from the session that started this one):\n${BG}\n\nTask:\n${prompt}${NOTES}`
  const fork = (prompt: string) => `Task (from the session that started this one):\n${prompt}`

  test('the note, then the wrapper, then the marker: recorded and linked, as the first thread\'s was; with two notes, and before a plain kickoff, too', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const cases = [
      [`${LINKED}\n\n${fresh(BOLT_KICKOFF)}`, 'sdk'],
      [`${LINKED}\n${SPACE}\n\n${fresh(BOLT_KICKOFF)}`, 'sdk'],
      [`${LINKED}\n\n${BOLT_KICKOFF}`, 'sdk'],
      [`${LINKED}\n\n${fork(BOLT_KICKOFF)}`, 'auto-continuation'],
      [`${LINKED}\n\n${fresh(BOLT_KICKOFF)}`, 'composer'],
    ] as const
    for (const [text, kind] of cases) {
      w.stored['mm.links'] = {}
      delete w.stored['mm.marked']
      await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
      expect(w.stored['mm.marked'], `${kind}: ${text.slice(0, 60)}`).toEqual({ [SELF]: BOLT })
      expect(w.stored['mm.links'], `${kind}: ${text.slice(0, 60)}`).toEqual({ [BOLT]: SELF })
    }
    // what it carries is the kickoff the bridge would send now: on record as this thread's
    expect((w.stored['mm.sent'] as Record<string, unknown> | undefined)?.[BOLT]).toMatchObject({ sid: SELF })
    // every prompt went on to the session untouched
    expect(w.prompts.map(p => p.text)).toEqual(cases.map(c => c[0]))
  })

  test('the note changes nothing else: a marker not at the start of the task, a note not at the start of the message, a marker inside the note, an origin that never counts', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const before = snapshot(w)
    const person = [
      `${LINKED}\n\n${fresh(`Look at this: ${BOLT_KICKOFF}`)}`,
      `fyi\n${LINKED}\n\n${fresh(BOLT_KICKOFF)}`,
      `${LINKED}\nSome words.\n\n${BOLT_KICKOFF}`,
      `<system-reminder>\n${BOLT_KICKOFF}\n</system-reminder>\n\nHello.`,
      `${LINKED}\n\nNotes.\n\nTask:\n${BOLT_KICKOFF}`,
    ]
    for (const text of person) await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    // the app's own delivery counts only in its `Task (…):` wrapper; another session's message or a notification never
    const others = [
      [`${LINKED}\n\n${fresh(BOLT_KICKOFF)}`, 'auto-continuation'],
      [`${LINKED}\n\n${BOLT_KICKOFF}`, 'auto-continuation'],
      [`${LINKED}\n\n${fresh(BOLT_KICKOFF)}`, 'peer'],
      [`${LINKED}\n\n${fork(BOLT_KICKOFF)}`, 'task-notification'],
    ] as const
    for (const [text, kind] of others) await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
    expect(snapshot(w)).toBe(before)
    expect(w.stored['mm.links']).toEqual({})
    expect(w.prompts.length).toBe(person.length + others.length)
  })

  test('[M1] a session\'s pair: every first write carries `since`; written again a day later it keeps it; a pair from before 0.5.9 gets none; a pair that named another thread starts again', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.threads']).toEqual({ [SELF_CLI]: { app: SELF, at: NOW + 4_000, since: NOW + 4_000 } })
    // written again a day after its last write: still the first time
    w.stored['mm.threads'] = { [SELF_CLI]: { app: SELF, at: NOW - 25 * HOUR, since: NOW - 60 * HOUR } }
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.threads']).toEqual({ [SELF_CLI]: { app: SELF, at: NOW + 8_000, since: NOW - 60 * HOUR } })
    // a pair 0.5.8 wrote: its `at` is a rewrite, not the start, and it stays without one (its thread's start unknown)
    w.stored['mm.threads'] = { [SELF_CLI]: { app: SELF, at: NOW - 30 * HOUR } }
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.threads']).toEqual({ [SELF_CLI]: { app: SELF, at: NOW + 12_000 } })
    // the session's pair named another thread: this thread's pair starts now
    w.stored['mm.threads'] = { [SELF_CLI]: { app: 'local_elsewhere', at: NOW - 30 * HOUR, since: NOW - 90 * HOUR } }
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.threads']).toEqual({ [SELF_CLI]: { app: SELF, at: NOW + 16_000, since: NOW + 16_000 } })
  })

  test('[L4] the notes must be exactly the app\'s, or nothing is read: a stray close tag, more than ten notes, CRLF, no close tag, a note inside a note', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const before = snapshot(w)
    const ten = Array.from({ length: 10 }, (_, n) => `<system-reminder>\nNote ${n}.\n</system-reminder>`).join('\n')
    const eleven = `${ten}\n<system-reminder>\nNote 10.\n</system-reminder>`
    const bad = [
      // a close tag inside the note's text: the note ends there, and what follows it is not a blank line
      `<system-reminder>\nLinked sessions now: a </system-reminder> b\n</system-reminder>\n\n${fresh(BOLT_KICKOFF)}`,
      `<system-reminder>\nLinked sessions now.\n</system-reminder> trailing\n</system-reminder>\n\n${BOLT_KICKOFF}`,
      `${eleven}\n\n${fresh(BOLT_KICKOFF)}`,
      `<system-reminder>\r\nLinked sessions now.\r\n</system-reminder>\r\n\r\n${fresh(BOLT_KICKOFF)}`,
      `${LINKED}\r\n\r\n${fresh(BOLT_KICKOFF)}`,
      `<system-reminder>\nLinked sessions now, and no end.\n\n${fresh(BOLT_KICKOFF)}`,
      `<system-reminder>\nOuter\n<system-reminder>\nInner\n</system-reminder>\n\n${fresh(BOLT_KICKOFF)}`,
      `<system-reminder>\nOuter\n<system-reminder>\nInner\n</system-reminder>\n</system-reminder>\n\n${fresh(BOLT_KICKOFF)}`,
    ]
    for (const text of bad) await $.prompt.submit({ text, wait: false, origin: { kind: 'sdk' } } as never)
    expect(snapshot(w)).toBe(before)
    expect(w.stored['mm.links']).toEqual({})
    // ten notes are still the app's
    await $.prompt.submit({ text: `${ten}\n\n${fresh(BOLT_KICKOFF)}`, wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toEqual({ [BOLT]: SELF })
  })

  test('[L6] the person\'s message from their phone or the web (`bridge`), after the app\'s note: the marker counts', async ($, on) => {
    const w = world(on)
    await mm($, '')
    await $.prompt.submit({ text: `${LINKED}\n\n${BOLT_KICKOFF}`, wait: false, origin: { kind: 'bridge' } } as never)
    expect(w.stored['mm.marked']).toEqual({ [SELF]: BOLT })
    expect(w.stored['mm.links']).toEqual({ [BOLT]: SELF })
  })
})

describe('R1b (0.5.9) in the app: a sync never moves a link on an empty thread list, or to or from a thread it cannot see', () => {
  /** Acme linked by the bridge to its old thread; a newer thread of Acme's, its session declared Acme alone. */
  const store = (over: Record<string, unknown> = {}) => ({
    'mm.threads': { 'cli-old': { app: 'local_old', at: NOW - 72 * HOUR, since: NOW - 72 * HOUR }, 'cli-new': { app: 'local_new', at: NOW - HOUR, since: NOW - HOUR } },
    'mm.links': { [ACME]: 'local_old' },
    'mm.auto': { [ACME]: { sid: 'local_old', miss: 0, made: NOW - 2 * HOUR } },
    'mm.titles': { local_old: 'Roof quote' },
    'mm.pins': { local_old: ourPin(ACME, 'Acme Roofing') },
    ...over,
  })
  const rows = feed({ threads: [declared(ACME, 'cli-old', 70), declared(ACME, 'cli-new', 1)] })

  test('the list as it is: the link moves, the old thread gets its name back and our pin off, the new one is pinned and named', async ($, on) => {
    const w = world(on, { feed: rows, threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_new', 'Acme resume', 1)], store: store() })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_new' })
    expect(w.threads.get('local_old')).toMatchObject({ title: 'Roof quote', pinned: false })
    expect(w.threads.get('local_new')?.title).toMatch(ACME_NAMED)
    expect(w.threads.get('local_new')?.pinned).toBe(true)
    expect(w.acted()).toEqual([])
  })

  test('an empty thread list (this thread alone, not complete): nothing moves', async ($, on) => {
    const w = world(on, { feed: rows, threads: [], store: store() })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.stored['mm.auto']).toMatchObject({ [ACME]: { sid: 'local_old' } })
  })

  test('the linked thread left out of the list and not answered for by id: left as it is, and nothing moves', async ($, on) => {
    const w = world(on, { feed: rows, threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_new', 'Acme resume', 1)], unlisted: ['local_old'], lookupFails: 'internal error', store: store() })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.threads.get('local_old')).toMatchObject({ title: ACME_TITLE, pinned: true })
    expect(w.threads.get('local_new')).toMatchObject({ title: 'Acme resume', pinned: false })
  })

  test('[M2] the person links the old thread while the pass that moves the client waits on the app: the move is dropped, and the link stays theirs', async ($, on) => {
    let wrote = false
    const w = world(on, {
      feed: rows,
      threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_new', 'Acme resume', 1)],
      store: store(),
      during: (call, stored) => {
        // once the pass has decided the move: the person types /mm link Acme Roofing in the old thread
        if (wrote || call.tool !== 'set_pinned' || call.args.session_id !== 'local_old') return
        wrote = true
        stored['mm.links'] = { [ACME]: 'local_old' }
        stored['mm.auto'] = {}
        stored['mm.acted'] = { [ACME]: { sid: 'local_old', at: NOW } }
      },
    })
    await mm($, '')
    expect(wrote).toBe(true)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.stored['mm.auto']).toEqual({})
    // the next sync puts its pin and name back, and leaves the new thread as it was
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.threads.get('local_old')?.title).toMatch(ACME_NAMED)
    expect(w.threads.get('local_old')?.pinned).toBe(true)
    expect(w.threads.get('local_new')).toMatchObject({ title: 'Acme resume', pinned: false })
  })

  test('[L2] another session links the new thread to another client while the pass waits on the app: one thread, one client, and the client keeps its link', async ($, on) => {
    let wrote = false
    const w = world(on, {
      feed: rows,
      threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_new', 'Acme resume', 1)],
      store: store(),
      during: (call, stored) => {
        if (wrote || call.tool !== 'set_pinned' || call.args.session_id !== 'local_old') return
        wrote = true
        stored['mm.links'] = { [ACME]: 'local_old', [BOLT]: 'local_new' }
      },
    })
    await mm($, '')
    expect(wrote).toBe(true)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old', [BOLT]: 'local_new' })
    expect((w.stored['mm.auto'] as Record<string, { sid: string }>)[ACME]?.sid).toBe('local_old')
  })

  test('[L2] the same for a thread R1 links by itself: another client took it meanwhile, so it is not linked to a second', async ($, on) => {
    let wrote = false
    const w = world(on, {
      feed: feed({ threads: [declared(BOLT, 'cli-bolt', 20)] }),
      threads: [thread('local_b', 'Staffing plan', 20)],
      store: { 'mm.threads': PAIRS },
      during: (call, stored) => {
        if (wrote || call.tool !== 'set_session_title' || call.args.session_id !== 'local_b') return
        wrote = true
        stored['mm.links'] = { [CEDAR]: 'local_b' }
      },
    })
    await mm($, '')
    expect(wrote).toBe(true)
    expect(w.stored['mm.links']).toEqual({ [CEDAR]: 'local_b' })
    expect((w.stored['mm.auto'] as Record<string, unknown> | undefined)?.[BOLT]).toBeUndefined()
  })

  test('[M1] an old thread whose pair the app\'s records give late (dated the day it is found, with no `since`) is never taken', async ($, on) => {
    const root = '/Users/someone/Library/Application Support/Claude/claude-code-sessions'
    const w = world(on, {
      env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/Users/someone' },
      feed: feed({ threads: [declared(ACME, 'cli-old', 70), declared(ACME, 'cli-late', 100)] }),
      threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_late', 'Acme from last month', 100)],
      store: store({ 'mm.threads': { 'cli-old': { app: 'local_old', at: NOW - 72 * HOUR, since: NOW - 72 * HOUR } } }),
      files: { [`${root}/account-1/org-1/local_late.json`]: { text: JSON.stringify({ sessionId: 'local_late', cliSessionId: 'cli-late' }), mtimeMs: NOW - HOUR } },
    })
    await mm($, '')
    expect((w.stored['mm.threads'] as Record<string, unknown>)['cli-late']).toEqual({ app: 'local_late', at: NOW })
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.threads.get('local_late')).toMatchObject({ title: 'Acme from last month', pinned: false })
  })
})

describe('0.5.9: the tool, re-checked on the store when it writes (review of 54a0437d)', () => {
  test('[M3] the person links the old thread while the tool\'s sync runs: the tool is refused, as for any link the person made', async ($, on) => {
    let wrote = false
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-old', 70)] }),
      threads: [thread('local_old', ACME_TITLE, 70, { pinned: true })],
      store: {
        'mm.threads': { 'cli-old': { app: 'local_old', at: NOW - 72 * HOUR, since: NOW - 72 * HOUR } },
        'mm.links': { [ACME]: 'local_old' },
        'mm.auto': { [ACME]: { sid: 'local_old', miss: 0, made: NOW - 2 * HOUR } },
        'mm.titles': { local_old: 'Roof quote' },
        'mm.pins': { local_old: ourPin(ACME, 'Acme Roofing') },
      },
      during: (call, stored) => {
        if (wrote || call.tool !== 'list_sessions') return
        wrote = true
        stored['mm.links'] = { [ACME]: 'local_old' }
        stored['mm.auto'] = {}
        stored['mm.acted'] = { [ACME]: { sid: 'local_old', at: NOW } }
      },
    })
    expect(await tool($, 'link Acme Roofing')).toBe('Acme Roofing already has a thread. Only the person can move it: they type /mm link Acme Roofing in the thread that should have it.')
    expect(wrote).toBe(true)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(w.stored['mm.released']).toBeUndefined()
  })

  test('[L5] this thread becomes another client\'s while the tool\'s sync runs: the tool is refused with today\'s sentence', async ($, on) => {
    let wrote = false
    const w = world(on, {
      threads: [thread('local_other', 'Unrelated notes', 100)],
      during: (call, stored) => {
        if (wrote || call.tool !== 'list_sessions') return
        wrote = true
        stored['mm.links'] = { [BOLT]: SELF }
      },
    })
    expect(await tool($, 'link Acme Roofing')).toBe('This thread is Bolt Staffing\'s. Only the person can move it: they type /mm link Acme Roofing.')
    expect(wrote).toBe(true)
    expect(w.stored['mm.links']).toEqual({ [BOLT]: SELF })
  })
})

// ======================================================================== 0.5.11

describe('0.5.11: a client\'s thread updated by itself (Rob, 10-15: "I think we should start updating threads automatically")', () => {
  const notices = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).at(-1)?.text ?? ''
  /**
   * (0.5.13) Every line written to the notice log that matches, over all its writes: the pretend disk does not read back
   * what was written, so each write holds the one line written then (`notices` is only the last).
   */
  const noticeLines = (w: { written: Array<{ path: string; text: string }> }, re: RegExp) =>
    w.written.filter(f => f.path.endsWith('bridge-notices.log')).flatMap(f => f.text.split('\n')).filter(l => re.test(l))
  const bandLines = async ($: Engine) => {
    const band = await bandOf($)
    const out = await lines(band)
    await band.unmount()
    return out
  }
  type Rec = { at: number; pid: string; client: string; sig: string; sid: string; by: string; ok: boolean | null; reason: string; from?: number }
  const records = (w: { stored: Record<string, unknown> }) => (w.stored['mm.autoupdates'] ?? []) as Rec[]
  const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
    for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
  }
  /** (0.5.11, Opus 10-15) Update's message for Acme, drafts ready, in the words that never take the package. */
  const ACME_UPDATE = markerFirst(`New since this thread last worked on this client: drafts ready.\n${NOT_TAKEN(ACME, 'Acme Roofing Pat')}`)
  /** Acme alone: drafts ready, covering mail three hours old; nothing else in the feed. */
  const acmeOnly = (over: Record<string, unknown> = {}): Feed => {
    const f = feed({ mail: [], tickets: {}, threads: [] })
    f.drafts = (f.drafts ?? []).map(d => ({ ...d, ...over }))
    return f
  }
  /** Acme's thread is another one, linked by the person. */
  const linkedWorld = (on: On, more: WorldOptions = {}) => world(on, { feed: acmeOnly(), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' } }, ...more })
  const boltMail = (hoursAgo: number) => mailFor(BOLT, 'Bolt Staffing (Sam)', hoursAgo)

  /**
   * (Review of PR #15, F3) The first sync (at NOW + 4 s) is when this bridge first sees a client; the syncs come every
   * five minutes on the minute ticks after it (6, 11, 16 minutes on): the one at 11 minutes is the first to find it
   * seen for 10 minutes, and its update goes 1 to 3 seconds later.
   */
  const seenTen = async (w: { clock: { advance: (ms: number) => Promise<void> } }) => {
    await after(w, 11)
    await w.clock.advance(3_000)
  }
  /** (Review of PR #15) To the sync at 11 minutes: its claim made, its send not yet (1 to 3 seconds on). */
  const toClaim = async (w: { clock: { advance: (ms: number) => Promise<void> } }) => {
    await after(w, 10)
    await w.clock.advance(56_000)
  }

  test('Update\'s own message goes once, by itself, into the client\'s linked thread, (review of PR #15, F3) 10 minutes after this bridge first saw it; never twice; something new goes once more, 10 minutes after it is first seen', async ($, on) => {
    const w = linkedWorld(on)
    await tickOnce($, w)
    // the first sync is when this bridge first saw it: nothing yet, nor at the sync six minutes on
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    await after(w, 10)
    expect(sends(w)).toEqual([])
    // the sync at 11 minutes: sent once this session's claim has held, a second or three on
    const read = closeouts(w)
    await after(w, 1)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', ACME_UPDATE]])
    expect(records(w).map(r => [r.pid, r.sid, r.ok, r.by, r.client])).toEqual([[ACME, 'local_a', true, SELF, 'Acme Roofing']])
    expect((w.stored['mm.sent'] as Record<string, { sid: string }>)[ACME]?.sid).toBe('local_a')
    expect(w.stored['mm.updating']).toEqual({})
    expect((await bandLines($)).join(' ')).toContain('Updated Acme Roofing\'s thread.')
    expect(notices(w)).toMatch(new RegExp(`updated Acme Roofing \\(${ACME}\\) sig [0-9a-f]{8} in local_a: something new for the client: drafts ready`))
    // nothing opened, nothing typed, nothing said in the pane
    expect([w.ran, w.opened, w.toasts, w.prompts]).toEqual([[], [], [], []])
    // the sync's read, the update's own read before the send, and once more for the list after it
    expect(closeouts(w) - read).toBe(3)
    // the list was brought up to date: the row reads that the thread has it
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Open thread', 'Drafts'])
    await ui.unmount()
    // never twice: half an hour of syncs
    await after(w, 30)
    expect(sends(w).length).toBe(1)
    // something new: the package is rebuilt; it goes once this bridge has seen it for 10 minutes, and once only
    w.setFeed(acmeOnly({ updated_at: new Date(w.clock.now()).toISOString() }))
    await after(w, 6)
    expect(sends(w).length).toBe(1)
    await after(w, 14)
    expect(sends(w).length).toBe(2)
    await after(w, 20)
    expect(sends(w).length).toBe(2)
    expect(records(w).map(r => r.ok)).toEqual([true, true])
  })

  // (Review of PR #15, F3: the live feed gives no time for a package's drafts) the wait is measured from when this
  // bridge first saw the client as it is now, never from the feed's own times
  test('(review of PR #15, F3) a package the feed dates a day back, and one it gives no time at all, still wait 10 minutes from the first sync that saw them', async ($, on) => {
    const w = linkedWorld(on, { feed: acmeOnly({ covers_through: ago(30), updated_at: ago(24) }) })
    await tickOnce($, w)
    await after(w, 10)
    expect(sends(w)).toEqual([])
    await after(w, 1)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    // what this bridge has seen of the client is on record: since the first sync, with no mail waiting
    const seen = w.stored['mm.firstSeen'] as Record<string, { sig: string; at: number; mail: number }>
    expect(Object.keys(seen)).toEqual([ACME])
    expect(seen[ACME]?.at).toBe(NOW + 4_000)
    expect(seen[ACME]?.mail).toBe(0)
  })

  test('(review of PR #15, F3) a package rebuilt under the bridge\'s eyes waits 10 minutes from the first sync that saw it rebuilt', async ($, on) => {
    const w = linkedWorld(on, { feed: acmeOnly({ updated_at: ago(5 / 60) }) })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
  })

  // ⛔ (0.7.14, Rob 2026-10-30: "I'm not sure why I need to click Update. It should automatically update") Jason's email of
  // 10-30 sat as Update on his pinned thread's row for two hours while Lane-2 had not drafted: the mail goes in now
  test('(0.7.14) messages and no drafts: it goes 10 minutes after this bridge first saw the mail, however old the mail itself, saying the drafts follow; with none 120 minutes after, the thread is asked for prep, once', LONG, async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [boltMail(5)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    await after(w, 10)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
    // the sync at 11 minutes: seen unchanged for 10, though the mail is five hours old and no drafts are ready
    await after(w, 1)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b'])
    // (review of PR #15, F4) the marker first, then Update's first line, then words that build nothing: the drafts follow
    const first = String(sends(w)[0]?.args.message)
    expect(first.startsWith(`[mm-link ${BOLT}] New since this thread last worked on this client: 1 message waiting.\nBolt Staffing (Sam) (OW project ${BOLT}) needs a reply: `)).toBe(true)
    expect(first).toContain('Lane-2 is building the reply drafts, and they come into this thread as a second update once they are ready. Load the client\'s project skill first, then show me what the client sent and what is due, and wait for me. Do not run prep before the drafts come unless I ask you to.')
    expect(first).not.toContain('run prep (§2)')
    // on record as told the drafts follow, never as asked to build them
    expect((w.stored['mm.sent'] as Record<string, { prep?: boolean; wait?: boolean }>)[BOLT]).toMatchObject({ sid: 'local_b', wait: true })
    expect((w.stored['mm.sent'] as Record<string, { prep?: boolean }>)[BOLT]?.prep).toBeUndefined()
    // no drafts by the sync at 117 minutes (the syncs run five minutes from the one after the update): nothing more
    await after(w, 108)
    expect(sends(w).length).toBe(1)
    // the sync at 122 minutes: 120 and more since the mail was first seen, and still no package: case 6 sent by itself,
    // with no "New since" line, once
    await after(w, 3)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b', 'local_b'])
    const second = String(sends(w)[1]?.args.message)
    expect(second.startsWith(`[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 1 client message(s) waiting`)).toBe(true)
    expect(second).toContain('no package exists yet, so run prep (§2) to build one, then show the one-package page without taking the package: no pickup call until I answer here.')
    expect((w.stored['mm.sent'] as Record<string, { prep?: boolean; wait?: boolean }>)[BOLT]).toMatchObject({ sid: 'local_b', prep: true })
    expect((w.stored['mm.sent'] as Record<string, { wait?: boolean }>)[BOLT]?.wait).toBeUndefined()
    expect(records(w).map(r => r.sig.endsWith('+prep'))).toEqual([false, true])
    expect(notices(w)).toContain('its reply drafts did not come: it is asked to build them')
    await after(w, 60)
    expect(sends(w).length).toBe(2)
  })

  test('(0.7.14) messages and no drafts, then drafts ready: the mail goes at 10 minutes, and the drafts as a second update 10 minutes after they were first seen; never prep', LONG, async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [boltMail(1)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    await after(w, 30)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b'])
    expect(String(sends(w)[0]?.args.message)).toContain('Lane-2 is building the reply drafts')
    // Lane-2 has the drafts ready (no time on them, as the live feed has it)
    w.setFeed(feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(0.5) })], tickets: {}, mail: [boltMail(1)] }))
    await after(w, 5)
    expect(sends(w).length).toBe(1)
    await after(w, 11)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b', 'local_b'])
    expect(String(sends(w)[1]?.args.message)).toBe(markerFirst(`New since this thread last worked on this client: 1 message waiting.\n${NOT_TAKEN(BOLT, 'Bolt Staffing (Sam)')}`))
    // the drafts came: nothing asks for prep, two hours on
    await after(w, 120)
    expect(sends(w).length).toBe(2)
  })

  // ⛔ (0.7.14, Rob 2026-10-30: "if a new thread is recommended, the chip should show up in the old thread, and it should
  // be pinned") a long thread is updated as any other, and asked to put up a card for a fresh one, there
  const ACME_CLI = '0e7a1c2d-3b4f-4a5e-8c6d-7e8f9a0b1c2d'
  const transcriptOf = (cwd: string) => `/home/someone/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${ACME_CLI}.jsonl`
  const longWorld = (on: On, bytes: number) =>
    linkedWorld(on, {
      threads: [thread('local_a', 'Roof quote', 30, { cwd: '/home/someone/Clients' })],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.threads': { [ACME_CLI]: { app: 'local_a', at: NOW - HOUR } } },
      files: { [transcriptOf('/home/someone/Clients')]: { text: '', mtimeMs: NOW - HOUR, size: bytes } },
    })

  test('(0.7.14) a thread whose transcript is 12 MB or more: its update by itself ends with the paragraph that asks it to put up a card for a fresh thread', async ($, on) => {
    const w = longWorld(on, 20 * 1_048_576)
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect(String(sends(w)[0]?.args.message)).toBe(`${ACME_UPDATE}\n\n${freshParagraph('Acme Roofing Pat', 20 * 1_048_576)}`)
    expect(String(sends(w)[0]?.args.message)).toContain('call mm with "kickoffs Acme Roofing Pat" and propose that thread with start_session using exactly the title, prompt, background and cwd it gives, but with initiation "own_initiative"')
    // the transcript was stat'ed, never read
    expect(w.reads.filter(r => r.endsWith('.jsonl'))).toEqual([])
    // ⛔ nothing started, minted or proposed by the bridge
    expect(w.acted().filter(c => c.tool !== 'send_message')).toEqual([])
  })

  for (const [name, bytes, cwd] of [
    ['a shorter transcript', 12 * 1_048_576 - 1, '/home/someone/Clients'],
    ['no transcript where the thread runs', 20 * 1_048_576, '/home/someone/Elsewhere'],
  ] as const) {
    test(`(0.7.14) ${name}: the update by itself carries no such paragraph`, async ($, on) => {
      const w = linkedWorld(on, {
        threads: [thread('local_a', 'Roof quote', 30, { cwd })],
        store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.threads': { [ACME_CLI]: { app: 'local_a', at: NOW - HOUR } } },
        files: { [transcriptOf('/home/someone/Clients')]: { text: '', mtimeMs: NOW - HOUR, size: bytes } },
      })
      await tickOnce($, w)
      await seenTen(w)
      expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', ACME_UPDATE]])
    })
  }

  test('drafts ready with a message 15 minutes old: it goes 10 minutes after this bridge first saw it, without waiting the 120', async ($, on) => {
    const w = world(on, {
      feed: feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(0.25) })], tickets: {}, mail: [boltMail(0.25)] }),
      threads: [thread('local_b', 'Staffing plan', 20)],
      store: { 'mm.links': { [BOLT]: 'local_b' } },
    })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b'])
    expect(String(sends(w)[0]?.args.message)).toBe(markerFirst(`New since this thread last worked on this client: 1 message waiting.\n${NOT_TAKEN(BOLT, 'Bolt Staffing (Sam)')}`))
  })

  test('a task alone: it goes 10 minutes after this bridge first saw it (its due time is not asked)', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], mail: [] }), threads: [thread('local_c', 'Dental intake', 20)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_c', markerFirst(`New since this thread last worked on this client: 1 task due.\n${CEDAR_KICKOFF}`)]])
  })

  // ---- (review of PR #15, F3) the package the thread was asked to build is the thread's own work: P4 and P4b
  /**
   * Bolt's case 6 sent by itself, two hours after its mail was first seen ((0.7.14) its follow-up, after the update at 10
   * minutes that said the drafts follow): the world, and the time it went.
   */
  const boltPrepSent = async ($: Engine, on: On) => {
    const mail = boltMail(2)
    const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [mail] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    await after(w, 122)
    await w.clock.advance(3_000)
    expect(sends(w).length).toBe(2)
    return { w, mail }
  }
  for (const [name, over] of [
    ['[P4b] no time on it, as the live feed has it', {}],
    ['[P4] its own `updated_at`', { updated_at: 'now' }],
  ] as const) {
    test(`⛔ (review of PR #15, F3) ${name}: the package its prep built is recorded as what the thread has, and nothing more is sent`, LONG, async ($, on) => {
      const { w, mail } = await boltPrepSent($, on)
      const had = (w.stored['mm.sent'] as Record<string, { sig: string; prep?: boolean }>)[BOLT]
      expect(had?.prep).toBe(true)
      // the auto turn ran prep (client-reply-prep §2): a package now exists, prepared, covering the message
      const extra = 'updated_at' in over ? { updated_at: new Date(w.clock.now()).toISOString() } : {}
      w.setFeed(feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(1.9), ...extra })], tickets: {}, mail: [mail] }))
      await after(w, 30)
      expect(sends(w).length).toBe(2)
      const now = (w.stored['mm.sent'] as Record<string, { sig: string; prep?: boolean; sid: string }>)[BOLT]
      expect(now?.sid).toBe('local_b')
      expect(now?.sig).not.toBe(had?.sig)
      expect(now?.prep).toBeUndefined()
      expect(notices(w)).toContain(`not updated Bolt Staffing (${BOLT}) sig`)
      expect(notices(w)).toContain('in local_b: its package is the thread\'s own work (it was asked to build it)')
      expect(notices(w).match(/its package is the thread's own work/g)?.length).toBe(1)
      // the row says the thread has it
      const ui = await pane($)
      expect(await buttonsOf(ui, BOLT)).toEqual(['Open thread', 'Drafts'])
      await ui.unmount()
    })
  }

  test('(review of PR #15, F3) a client message after the send: the package is not only the thread\'s own work; it goes, 10 minutes after it was first seen', LONG, async ($, on) => {
    const { w, mail } = await boltPrepSent($, on)
    const newer = mailFor(BOLT, 'Bolt Staffing (Sam)', 0, { message_id_key: 'bolt-newer', received_at: new Date(w.clock.now() + 60_000).toISOString() })
    await after(w, 2)
    w.setFeed(feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(1.9) })], tickets: {}, mail: [mail, newer] }))
    await after(w, 20)
    expect(sends(w).length).toBe(3)
    expect(String(sends(w)[2]?.args.message).startsWith(`[mm-link ${BOLT}] New since this thread last worked on this client: `)).toBe(true)
    expect(notices(w)).not.toContain('its package is the thread\'s own work')
  })

  // ---- (0.7.9) Kin Properties, 2026-10-29: Rob pressed Update on mail with no drafts at 7:00 PM ET; the thread built and
  // picked up the package at 7:09, and the row said Update again, the bridge about to send the thread its own package
  for (const [name, over] of [
    ['picked up by the person, as the Kin thread did', heldBy(ME, { picked_up_at: ago(0.1) })],
    ['prepared', {}],
  ] as const) {
    test(`⛔ (0.7.9) Update pressed on mail with no drafts asks the thread to build them; the package it builds, ${name}, is its own work, never sent to it as new`, LONG, async ($, on) => {
      const mail = boltMail(0.5)
      const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [mail] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
      await tickOnce($, w)
      const ui = await pane($)
      await ui.press({ key: `update:${BOLT}` })
      await ui.unmount()
      expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b'])
      expect(String(sends(w)[0]?.args.message)).toContain('no package exists yet, so run prep first')
      // the press records that it asked for the package, as an update sent by itself does
      expect((w.stored['mm.sent'] as Record<string, { prep?: boolean }>)[BOLT]?.prep).toBe(true)
      // the thread runs prep: a package now exists, covering the message
      w.setFeed(feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(0.5), ...over })], tickets: {}, mail: [mail] }))
      await after(w, 30)
      expect(sends(w).length).toBe(1)
      expect(noticeLines(w, /in local_b: its package is the thread's own work \(it was asked to build it\)/).length).toBe(1)
      const now = (w.stored['mm.sent'] as Record<string, { prep?: boolean; sid: string }>)[BOLT]
      expect(now?.sid).toBe('local_b')
      expect(now?.prep).toBeUndefined()
      // the row says the thread has it
      const again = await pane($)
      expect(await buttonsOf(again, BOLT)).toEqual(['Open thread', 'Drafts'])
      await again.unmount()
    })
  }

  test('(0.7.9) a press that does not ask for the package records no such thing: a client message after it still goes to the thread', LONG, async ($, on) => {
    const w = linkedWorld(on)
    await tickOnce($, w)
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.unmount()
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect((w.stored['mm.sent'] as Record<string, { prep?: boolean }>)[ACME]?.prep).toBeUndefined()
  })

  // ---- (0.7.9, Rob 2026-10-29: "It seems like the threads aren't auto-updating anymore. They're not repinning
  // themselves.") A row whose thread is due to be updated by itself says when, and so does its thread's part of the pane
  /** (0.7.9) The line the pane draws right under Bolt's row. */
  const underBolt = async (ui: Drawing): Promise<string | undefined> => {
    const all = await lines(ui)
    const at = all.findIndex(l => l.includes('Bolt Staffing ·'))
    return at < 0 ? undefined : all[at + 1]
  }
  /**
   * (0.7.9) When the first sync (at NOW + 4 s) first saw Bolt's mail, plus the 10 minutes ((0.7.14) until 0.7.14 "when the
   * drafts are ready (by" 120 minutes after it)").
   */
  const BOLT_BY = `updates itself at about ${clockText(NOW + 4_000 + 10 * 60_000, NOW)}`

  test('(0.7.9) mail with no drafts: its row says its thread updates itself at about 10 minutes after the mail was first seen ((0.7.14) never "when the drafts are ready"); then the drafts, at about when; then nothing', LONG, async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [boltMail(0.5)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    const ui = await pane($)
    expect(BOLT_BY).toBe(SOON)
    expect(await underBolt(ui)).toBe(BOLT_BY)
    expect(await buttonsOf(ui, BOLT)).toEqual(['Update thread', 'Drafts'])
    await ui.unmount()
    // the update goes at its time, saying the drafts follow, and the row says the thread has it
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b'])
    const told = await pane($)
    expect(await buttonsOf(told, BOLT)).toEqual(['Open thread', 'Drafts'])
    expect((await lines(told)).join('\n')).not.toContain('updates itself')
    await told.unmount()
    // the drafts are ready: they go ten minutes after they were first seen, and the row says about when
    w.setFeed(feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', { covers_through: ago(0.4) })], tickets: {}, mail: [boltMail(0.5)] }))
    await after(w, 6)
    const ready = await pane($)
    expect(await underBolt(ready)).toMatch(/updates itself at about \d{1,2}(:\d\d)? (AM|PM)$/)
    await ready.unmount()
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b', 'local_b'])
    // and once the thread has it, no row says it
    const done = await pane($)
    expect((await lines(done)).join('\n')).not.toContain('updates itself')
    await done.unmount()
  })

  test('(0.7.9) in the client\'s own thread: its part of the pane and the note say the same', LONG, async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [boltMail(0.5)] }), store: { 'mm.links': { [BOLT]: SELF } } })
    await tickOnce($, w)
    const view = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-view', props: { ...PANE, title: 'Bolt Staffing' } })
    expect((await view.find({ type: 'Markdown' }))?.text ?? '').toContain(`\n\nThis thread ${BOLT_BY}.`)
    await view.unmount()
    expect(w.appended.length).toBe(1)
    expect(w.appended[0]).toContain(`no reply drafts are prepared yet. This thread ${BOLT_BY}. Nothing has been sent.`)
  })

  for (const [name, opts] of [
    ['auto is off (/mm auto off)', { 'mm.autostart': { on: false } }],
    ['the bridge is paused', { 'mm.paused': true }],
  ] as const) {
    test(`(0.7.9) ${name}: no row says its thread updates itself`, async ($, on) => {
      const w = world(on, { feed: feed({ drafts: [], tickets: {}, mail: [boltMail(0.5)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' }, ...opts } })
      await tickOnce($, w)
      const ui = await pane($)
      expect((await lines(ui)).join('\n')).not.toContain('updates itself')
      await ui.unmount()
    })
  }

  const SENT = ago(1)
  const skipped: Array<[string, WorldOptions]> = [
    ['a client a teammate has (With a teammate)', { feed: feed({ drafts: [packageFor(BOLT, 'Bolt Staffing (Sam)', heldBy(TEAMMATE_B))], tickets: {}, mail: [boltMail(2)] }), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } }],
    ['a package someone else holds, on a client listed for a task of the person\'s own', { feed: feed({ drafts: [packageFor(CEDAR, 'Cedar Dental', heldBy(TEAMMATE_B))], mail: [] }), threads: [thread('local_c', 'Dental intake', 20)], store: { 'mm.links': { [CEDAR]: 'local_c' } } }],
    ['a client whose reply the server is checking', { feed: acmeOnly({ last_outbound_at: ago(0.5), checked_send_at: ago(2) }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' } } }],
    ['a client still open after our reply (Claim is the person\'s)', { feed: acmeOnly({ last_outbound_at: SENT, checked_send_at: SENT, checked_at: ago(0.1), still_open: ['the logo file'], answered: [] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' } } }],
    // (0.7.12) until 0.7.12 this client was under Older; it is in no list now, and still never updated by itself
    ['a client whose only mail was due before the cut', { feed: feed({ drafts: [], tickets: {}, mail: [mailFor(ACME, 'Acme Roofing — Pat', 10 * 24)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' } } }],
    ['a client whose linked thread is the one running the sync', { feed: acmeOnly(), store: { 'mm.links': { [ACME]: SELF } } }],
    ['a client whose linked thread the sync could not see', { feed: acmeOnly(), threads: [thread('local_a', 'Roof quote', 30)], unlisted: ['local_a'], lookupFails: 'no answer', store: { 'mm.links': { [ACME]: 'local_a' } } }],
    ['a client whose row only suggests a thread by its title', { feed: acmeOnly(), threads: [thread('local_t', 'Acme Roofing: roof quote', 30)] }],
    ['a client with no thread (its thread is started, never updated)', { feed: acmeOnly() }],
  ]
  for (const [name, opts] of skipped) {
    test(`⛔ never ${name}`, async ($, on) => {
      const w = world(on, opts)
      await tickOnce($, w)
      await after(w, 30)
      expect(sends(w)).toEqual([])
      expect(records(w)).toEqual([])
      expect(w.prompts).toEqual([])
    })
  }

  const changed: Array<[string, Record<string, string>]> = [
    ['a thread the person made another client\'s meanwhile', { [BOLT]: 'local_a' }],
    ['a client the person unlinked meanwhile', {}],
  ]
  for (const [name, change] of changed) {
    test(`⛔ re-checked once the claim has held: ${name} gets nothing, and nothing writes the link back`, async ($, on) => {
      const w = linkedWorld(on)
      await tickOnce($, w)
      await toClaim(w)
      // between the choice and the send (the claim is checked 1 to 3 seconds on)
      expect(Object.keys(w.stored['mm.updating'] as object).length).toBe(1)
      w.stored['mm.links'] = change
      await w.clock.advance(3_000)
      expect(sends(w)).toEqual([])
      expect(records(w)).toEqual([])
      expect(w.stored['mm.updating']).toEqual({})
      expect(w.stored['mm.links']).toEqual(change)
    })
  }

  // ⛔ (review of PR #15, F2, the reviewer's P3) the person relinks the thread while the update asks the app for it and
  // reads the feed: the links are read again right before the send, and nothing goes into a thread that is no longer
  // the client's
  test('⛔ (review of PR #15, F2) [P3] the thread is made another client\'s while the update reads the app and the feed: nothing is sent into it, on record as not sent', async ($, on) => {
    let armed = true
    const w = linkedWorld(on, {
      during: (call, stored) => {
        const claims = stored['mm.updating'] as Record<string, unknown> | undefined
        if (armed && call.tool === 'get_session' && call.args.session_id === 'local_a' && claims && Object.keys(claims).length) {
          armed = false
          stored['mm.links'] = { [BOLT]: 'local_a' }
        }
      },
    })
    await tickOnce($, w)
    await seenTen(w)
    expect(armed).toBe(false)
    expect(sends(w)).toEqual([])
    expect(records(w).map(r => [r.pid, r.sid, r.ok])).toEqual([[ACME, 'local_a', false]])
    expect(records(w)[0]?.reason).toContain('not sent: the thread\'s link changed meanwhile')
    expect(notices(w)).toContain(`not updated Acme Roofing (${ACME}) sig`)
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_a' })
    expect(w.stored['mm.updating']).toEqual({})
    // and later syncs send Acme's update into no thread: it has none now
    await after(w, 30)
    expect(sends(w)).toEqual([])
  })

  test('⛔ (review of PR #15, F2) [P3, pressed] Update pressed, and the thread made another client\'s while the press reads the feed: nothing is sent, and the list is drawn again', async ($, on) => {
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autostart': { on: false } }, fetchTakesMs: n => (n >= 2 ? 1_500 : 0) })
    await mm($, '')
    const ui = await pane($)
    const press = ui.press({ key: `update:${ACME}` })
    await w.clock.advance(500)
    // the feed is being read for the press: the person links the thread to Bolt
    w.stored['mm.links'] = { [BOLT]: 'local_a' }
    await w.clock.advance(2_000)
    await press
    expect(sends(w)).toEqual([])
    expect(w.toasts.join(' ')).toContain('That thread is no longer available. The list has been refreshed.')
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_a' })
    expect(w.stored['mm.sent']).toBeUndefined()
    await ui.unmount()
  })

  test('⛔ (review of PR #15, F2) [P3, pressed] the client linked to another thread while the press reads the feed: nothing is sent into the old one', async ($, on) => {
    const w = linkedWorld(on, {
      threads: [thread('local_a', 'Roof quote', 30), thread('local_new', 'Acme follow-up', 1)],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autostart': { on: false } },
      fetchTakesMs: n => (n >= 2 ? 1_500 : 0),
    })
    await mm($, '')
    const ui = await pane($)
    const press = ui.press({ key: `update:${ACME}` })
    await w.clock.advance(500)
    // the person links Acme to the other thread (/mm link there) while the feed is read for the press
    w.stored['mm.links'] = { [ACME]: 'local_new' }
    await w.clock.advance(2_000)
    await press
    expect(sends(w)).toEqual([])
    expect(w.toasts.join(' ')).toContain('That thread is no longer available.')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_new' })
    await ui.unmount()
  })

  test('a press with nothing moved meanwhile still sends, after the slow feed read (the final check refuses only a move)', async ($, on) => {
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autostart': { on: false } }, fetchTakesMs: n => (n >= 2 ? 1_500 : 0) })
    await mm($, '')
    const ui = await pane($)
    const press = ui.press({ key: `update:${ACME}` })
    await w.clock.advance(2_000)
    await press
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}`]])
    await ui.unmount()
  })

  test('⛔ the feed is read once before the send: with no feed, nothing goes and nothing is recorded', async ($, on) => {
    let down = false
    const w = linkedWorld(on, { feedStatus: () => (down ? 503 : 200) })
    await tickOnce($, w)
    await toClaim(w)
    down = true
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
  })

  test('⛔ a client answered between the sync and the send gets nothing', async ($, on) => {
    const w = linkedWorld(on)
    await tickOnce($, w)
    await toClaim(w)
    w.setFeed(acmeOnly({ status: 'sent' }))
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
  })

  test('⛔ another session\'s claim since: that session sends it, this one does not; a claim that lapsed is taken again at the next sync, and it goes once', async ($, on) => {
    const w = linkedWorld(on)
    await tickOnce($, w)
    await toClaim(w)
    const claims = w.stored['mm.updating'] as Record<string, { owner: string; until: number; from: number }>
    const key = Object.keys(claims)[0] as string
    expect(key.startsWith(`${ACME}\n`)).toBe(true)
    expect(claims[key]?.owner).toBe(SELF)
    // (review of PR #15, F1) a claim says which sync it was chosen from
    expect(claims[key]?.from).toBe((w.stored['mm.last'] as { at: number }).at)
    // another session writes its own claim before this one's has held
    w.stored['mm.updating'] = { [key]: { owner: 'local_elsewhere', until: (claims[key]?.until ?? 0) } }
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    // that session never sent it: its claim runs out, and the next sync's choice here takes it
    await after(w, 6)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    await after(w, 20)
    expect(sends(w).length).toBe(1)
  })

  // ---- (review of PR #15, F1) the caps hold in a burst: the reviewer's P1, P2 and P2b
  const pidOf = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
  /** `n` clients, each with drafts ready and its own linked thread: all due at the same sync. */
  const many = (n: number): WorldOptions => {
    const drafts = Array.from({ length: n }, (_, i) => packageFor(pidOf(i), `Client ${i}`, { package_id: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i).padStart(12, '0')}` }))
    const threads = Array.from({ length: n }, (_, i) => thread(`local_t${i}`, `Topic ${i}`, 20))
    const links = Object.fromEntries(Array.from({ length: n }, (_, i) => [pidOf(i), `local_t${i}`]))
    return { feed: feed({ drafts, mail: [], tickets: {}, threads: [] }), threads, store: { 'mm.links': links } }
  }
  /** The most updates on record that went in any one hour, and from any one sync. */
  const most = (list: Rec[]) => {
    const went = list.filter(r => r.ok !== false)
    const perHour = Math.max(0, ...went.map(r => went.filter(o => o.at >= r.at && o.at - r.at < HOUR).length))
    const bySync = new Map<number, number>()
    for (const r of went) bySync.set(Number(r.from), (bySync.get(Number(r.from)) ?? 0) + 1)
    return { perHour, perSync: Math.max(0, ...bySync.values()), syncs: bySync.size }
  }
  for (const [name, takes] of [
    ['[P1] the feed answering at once', undefined],
    ['[P2b] the feed taking 0.4 s per read after the first', (n: number) => (n === 1 ? 0 : 400)],
    ['[P2] the feed taking 1.5 s per read after the first', (n: number) => (n === 1 ? 0 : 1_500)],
  ] as const) {
    test(`⛔ (review of PR #15, F1; 0.5.13, Rob 10-15: "12 updates an hour") ${name}: fifteen clients due at the same sync are never more than 3 sends from one sync, nor 12 in the hour; the rest go after the hour`, LONG, async ($, on) => {
      /** The most claims held at once for any one sync, as seen at every call to the app. */
      let claimed = 0
      const w = world(on, {
        ...many(15),
        ...(takes ? { fetchTakesMs: takes } : {}),
        during: (_call, stored) => {
          const bySync = new Map<number, number>()
          for (const c of Object.values((stored['mm.updating'] ?? {}) as Record<string, { from?: number }>)) bySync.set(Number(c.from), (bySync.get(Number(c.from)) ?? 0) + 1)
          claimed = Math.max(claimed, 0, ...bySync.values())
        },
      })
      await tickOnce($, w)
      await after(w, 13)
      // the sync at 11 minutes claimed three, the rest waited (the list read again after each send is a sync of its
      // own, so the next three go from it, a minute on)
      expect(claimed).toBe(3)
      expect(sends(w).length).toBeLessThanOrEqual(12)
      expect(most(records(w)).perSync).toBeLessThanOrEqual(3)
      // the hour: three from each sync, up to twelve, then nothing more in that hour
      await after(w, 50)
      expect(sends(w).length).toBe(12)
      expect(new Set(sends(w).map(c => c.args.session_id)).size).toBe(12)
      const m = most(records(w))
      expect(m.perHour).toBe(12)
      expect(m.perSync).toBeLessThanOrEqual(3)
      expect(m.syncs).toBeGreaterThanOrEqual(4)
      // and past the hour (the first three are an hour old by the sync at 76 minutes), the rest go
      await after(w, 20)
      expect(sends(w).length).toBe(15)
      expect(new Set(sends(w).map(c => c.args.session_id)).size).toBe(15)
      const end = most(records(w))
      expect(end.perHour).toBeLessThanOrEqual(12)
      expect(end.perSync).toBeLessThanOrEqual(3)
      expect(claimed).toBe(3)
    })
  }

  test('⛔ (review of PR #15, F1) a full list at the moment of the record refuses the send: another session\'s twelve records written while this one read the feed', async ($, on) => {
    const others: Rec[] = Array.from({ length: 12 }, (_, i) => ({ at: NOW + 9 * 60_000, pid: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, client: `Client ${i}`, sig: '00000000', sid: `local_x${i}`, by: 'local_y', ok: true, reason: 'x' }))
    let wrote = false
    const w = linkedWorld(on, {
      during: (call, stored) => {
        if (wrote || call.tool !== 'get_session' || call.args.session_id !== 'local_a' || !Object.keys((stored['mm.updating'] as object) ?? {}).length) return
        wrote = true
        stored['mm.autoupdates'] = [...((stored['mm.autoupdates'] as Rec[]) ?? []), ...others]
      },
    })
    await tickOnce($, w)
    await seenTen(w)
    expect(wrote).toBe(true)
    expect(sends(w)).toEqual([])
    expect(records(w).filter(r => r.pid === ACME)).toEqual([])
    expect(notices(w)).toContain(`not updated Acme Roofing (${ACME}) sig`)
  })

  test('the hour\'s cap: twelve in the last hour on this computer; past it nothing goes (logged once), and it goes once the hour has passed', async ($, on) => {
    const earlier = (count: number, startMin: number, stepMin: number, ok: boolean | null = true): Rec[] =>
      Array.from({ length: count }, (_, i) => ({ at: NOW - (startMin + i * stepMin) * 60_000, pid: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, client: `Client ${i}`, sig: '00000000', sid: `local_x${i}`, by: 'local_y', ok, reason: 'x' }))
    // (0.5.13, Rob 10-15: "12 updates an hour") the hour: twelve in the last hour, 4 to 15 minutes ago
    const hour = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autoupdates': earlier(12, 4, 1) } })
    await tickOnce($, hour)
    await after(hour, 30)
    expect(sends(hour)).toEqual([])
    expect(notices(hour)).toContain(`not updated Acme Roofing (${ACME}) sig`)
    expect(notices(hour)).toContain('this computer updated 12 threads in the last hour or 40 in the last day')
    // (0.5.13) once over every write, not only in the last one
    expect(noticeLines(hour, /not updated Acme Roofing/).length).toBe(1)
    // the oldest of them is an hour old by the sync at 45 minutes
    await after(hour, 21)
    expect(sends(hour).map(c => c.args.session_id)).toEqual(['local_a'])
  })

  test('the day\'s cap: forty in the last day, none of them in the last hour: nothing goes', async ($, on) => {
    const earlier = (count: number, ok: boolean | null): Rec[] =>
      Array.from({ length: count }, (_, i) => ({ at: NOW - (2 * 60 + i * 10) * 60_000, pid: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, client: `Client ${i}`, sig: '00000000', sid: `local_x${i}`, by: 'local_y', ok, reason: 'x' }))
    const day = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autoupdates': earlier(40, true) } })
    await tickOnce($, day)
    await after(day, 30)
    expect(sends(day)).toEqual([])
    expect(notices(day)).toContain('or 40 in the last day')
  })

  // (0.5.13) 10-15: fifteen identical "not updated … this computer updated 6 threads in the last hour" lines for one
  // client within 40 seconds, one per running thread. Each desktop thread is a process of its own, so the line is
  // kept to one per client per hour by the store (`mm.capLogged`), never by a thread's own memory.
  test('(0.5.13) the cap\'s line is written once per client per hour across every running thread: another thread wrote it 10 minutes ago, so this one does not; once that is an hour old it is written once, and again only after another hour; nothing else changes', LONG, async ($, on) => {
    // the day's cap holds for hours: forty in the last day, none of them in the last hour
    const dayFull: Rec[] = Array.from({ length: 40 }, (_, i) => ({ at: NOW - (2 * 60 + i * 10) * 60_000, pid: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, client: `Client ${i}`, sig: '00000000', sid: `local_x${i}`, by: 'local_y', ok: true, reason: 'x' }))
    // another running thread (a process of its own: nothing of this one's memory) wrote Acme's line 10 minutes ago;
    // Bolt's is two hours old
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autoupdates': dayFull, 'mm.capLogged': { [ACME]: NOW - 10 * 60_000, [BOLT]: NOW - 2 * HOUR } } })
    const acme = () => noticeLines(w, /not updated Acme Roofing/)
    await tickOnce($, w)
    // Acme is due from the sync at 11 minutes and capped at every sync after it: not written while the other thread's
    // line is under an hour old (to 50 minutes on)
    await after(w, 45)
    expect(acme()).toEqual([])
    expect(sends(w)).toEqual([])
    // the sync at 51 minutes: written, once
    await after(w, 10)
    expect(acme().length).toBe(1)
    expect(acme()[0]).toContain(`not updated Acme Roofing (${ACME}) sig`)
    expect(acme()[0]).toContain('this computer updated 12 threads in the last hour or 40 in the last day')
    // what the store keeps: Acme's, now; Bolt's, older than the hour, is dropped
    const logged = w.stored['mm.capLogged'] as Record<string, number>
    expect(Object.keys(logged)).toEqual([ACME])
    expect(logged[ACME]).toBeGreaterThanOrEqual(NOW + 50 * 60_000)
    expect(logged[ACME]).toBeLessThan(NOW + 56 * 60_000)
    // ten more capped syncs within that hour: not again
    await after(w, 50)
    expect(acme().length).toBe(1)
    // the hour has passed: written once more
    await after(w, 15)
    expect(acme().length).toBe(2)
    // ⛔ no decision changed: nothing sent, nothing recorded for Acme, nothing claimed
    expect(sends(w)).toEqual([])
    expect(records(w).filter(r => r.pid === ACME)).toEqual([])
    expect(w.stored['mm.updating'] ?? {}).toEqual({})
  })

  test('sends the threads did not take do not count toward the caps', async ($, on) => {
    // (0.5.13) twelve: the hour's cap, were they counted
    const failed: Rec[] = Array.from({ length: 12 }, (_, i) => ({ at: NOW - (10 + i) * 60_000, pid: `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`, client: `Client ${i}`, sig: '00000000', sid: `local_x${i}`, by: 'local_y', ok: false, reason: 'x' }))
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autoupdates': failed } })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).length).toBe(1)
  })

  test('a send the thread does not take: recorded and logged with why, and not tried again for the same thing', async ($, on) => {
    const w = linkedWorld(on, { sendFails: 'that session did not accept it (messages from other sessions can require approval there, or be turned off)' })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).length).toBe(1)
    expect(records(w).map(r => [r.ok, r.reason])).toEqual([[false, expect.stringContaining('; not sent: that session did not accept it')]])
    expect(notices(w)).toContain(`not updated Acme Roofing (${ACME})`)
    expect(w.stored['mm.sent']).toBeUndefined()
    expect((await bandLines($)).join(' ')).not.toContain('Updated Acme Roofing')
    await after(w, 30)
    expect(sends(w).length).toBe(1)
  })

  test('⛔ no stamp, no acted, no claim: a link the bridge made stays one it can let go; the unlink records and the links are as they were', async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    expect((w.stored['mm.auto'] as Record<string, { sid: string }>)[ACME]?.sid).toBe('local_a')
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect(w.stored['mm.acted']).toBeUndefined()
    expect((w.stored['mm.auto'] as Record<string, { sid: string }>)[ACME]?.sid).toBe('local_a')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.stored['mm.unlinked']).toBeUndefined()
  })

  // ---- (review of PR #15, F5) never into a thread the person used in the last 10 minutes: the reviewer's P5
  test('⛔ (review of PR #15, F5) [P5] the person is in the thread: not now, and nothing on record; it goes at a sync once the thread has been idle 10 minutes', async ($, on) => {
    const w = linkedWorld(on)
    await tickOnce($, w)
    await after(w, 9)
    // the person works in Acme's thread
    const active = w.threads.get('local_a') as Thread
    active.lastActivityAt = new Date(w.clock.now()).toISOString()
    // the sync at 11 minutes: due, but the thread was used 2 minutes ago
    await after(w, 2)
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
    expect(w.stored['mm.updating']).toEqual({})
    // the sync at 16 minutes: idle 7 minutes, still not
    await after(w, 5)
    expect(sends(w)).toEqual([])
    // the sync at 21 minutes: idle 12 minutes
    await after(w, 5)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', ACME_UPDATE]])
  })

  test('⛔ (review of PR #15, F5) case 1, a package the person holds, mid-reply in its thread: nothing goes while they are in it', async ($, on) => {
    const held = feed({ drafts: [packageFor(ACME, 'Acme Roofing — Pat', heldBy(ME))], mail: [], tickets: {}, threads: [] })
    const w = linkedWorld(on, { feed: held, threads: [thread('local_a', 'Roof quote', 0)] })
    await tickOnce($, w)
    // the person keeps working in the thread for twenty minutes
    for (let i = 0; i < 20; i++) {
      ;(w.threads.get('local_a') as Thread).lastActivityAt = new Date(w.clock.now()).toISOString()
      await after(w, 1)
    }
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
    // they stop: ten idle minutes on, it goes, the drafts carried on with
    await after(w, 16)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect(String(sends(w)[0]?.args.message).startsWith(`[mm-link ${ACME}] New since this thread last worked on this client: 1 draft not sent.\nCarry on with the reply drafts for Acme Roofing Pat`)).toBe(true)
  })

  // ---- (review of PR #15, F4) the time-tracking hook
  for (const [hook, why] of [
    ['old', 'the time-tracking hook on this computer is older than 0.11.5 and would count it as the person\'s time'],
    ['missing', 'the time-tracking hook on this computer could not be read'],
  ] as const) {
    test(`⛔ (review of PR #15, F4) a time-tracking hook that ${hook === 'old' ? 'counts every turn as the person\'s (0.11.4 and before)' : 'cannot be read'}: nothing is sent by itself, logged once; read again at most every 10 minutes`, async ($, on) => {
      const w = linkedWorld(on, { hook })
      await tickOnce($, w)
      await after(w, 40)
      expect(sends(w)).toEqual([])
      expect(records(w)).toEqual([])
      expect(w.stored['mm.updating']).toBeUndefined()
      expect(notices(w)).toContain(`no thread is updated by itself on this computer: ${why}`)
      expect(notices(w).match(/no thread is updated by itself on this computer/g)?.length).toBe(1)
      // the syncs at 10 to 40 minutes asked; the hook was read at 10, 20 and 30 (and 40) minutes at most
      expect(w.hookReads.length).toBeGreaterThanOrEqual(1)
      expect(w.hookReads.length).toBeLessThanOrEqual(4)
      // a Start, a press and the person's own Update are the person's and are not held back by it
      const ui = await pane($)
      await ui.press({ key: `update:${ACME}` })
      await ui.unmount()
      expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    })
  }

  test('(review of PR #15, F4) the text sent by itself opens with the client\'s marker: typed by the person in a thread, it links that thread as any kickoff does; arriving from another thread, it links nothing and claims nothing', async ($, on) => {
    const w = world(on, { feed: acmeOnly(), threads: [thread('local_other', 'Unrelated notes', 100)] })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
    // from another thread (the app's `peer`): nothing
    await $.prompt.submit({ text: ACME_UPDATE, wait: false, origin: { kind: 'peer' } } as never)
    expect(w.stored['mm.links']).toEqual({})
    expect(w.stored['mm.marked']).toBeUndefined()
    // the person's own prompt with that text: the marker at its very start links this thread to Acme
    await $.prompt.submit({ text: ACME_UPDATE, wait: false, origin: { kind: 'composer' } })
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(w.stored['mm.marked']).toEqual({ [SELF]: ACME })
  })

  test('/mm auto off: nothing is sent; /mm auto on: sent 10 minutes after the first sync that sees it, once', async ($, on) => {
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autostart': { on: false } } })
    await tickOnce($, w)
    await after(w, 30)
    expect(sends(w)).toEqual([])
    expect(w.stored['mm.updating']).toBeUndefined()
    expect(await mm($, 'auto on')).toContain('thread is updated by itself')
    await after(w, 16)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    await after(w, 20)
    expect(sends(w).length).toBe(1)
  })

  test('while the bridge is paused: nothing is sent', async ($, on) => {
    const w = linkedWorld(on, { store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.paused': true } })
    await tickOnce($, w)
    await after(w, 30)
    expect(sends(w)).toEqual([])
  })

  test('a long thread gets its update as any thread does: no fresh thread, nothing started, nothing moved', async ($, on) => {
    const w = linkedWorld(on, { tools: 'start', store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.ctx': { local_a: { tokensUsed: 700_000, contextWindow: 1_000_000, percentUsed: 70, at: NOW - HOUR } } } })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
    expect(w.calls.filter(c => c.tool === 'start_session')).toEqual([])
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect(w.threads.get('local_a')?.title).not.toContain('· moved')
  })

  test('C3: a client with no thread waits for the person\'s Start (0.5.25: no card by itself; 0.5.24: never a thread started); a client with one gets its update', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ mail: [] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' } } })
    await tickOnce($, w)
    await seenTen(w)
    expect(starts(w)).toEqual([])
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a'])
  })
})

// ======================================================================== 0.5.12

describe('0.5.12: Start all (Rob, 10-15: no clicks at all); (0.5.25) its press puts "Start the missing client threads" in the prompt box, and the model starts them from kickoffs', () => {
  const bandButtons = async ($: Engine) => {
    const band = await bandOf($)
    const out = await buttons(band)
    await band.unmount()
    return out
  }
  const startAllOn = async (ui: Drawing) => (await buttons(ui)).filter(b => b[0] === 'mm-start-all').map(b => b[1])
  /** (0.5.14) The band's one Start button, always drawn: Start missing threads (n), or All threads started. */
  const bandStart = async ($: Engine) => (await bandButtons($)).filter(b => b[0] === 'mm-start-missing')
  /** The Start all words of each of the three clients (0.5.11's `auto`, with no Update line): Acme's drafts shown, never taken. */
  const ACME_ALL = NOT_TAKEN(ACME, 'Acme Roofing Pat')

  test('N = 0: no Start all button in the pane; (0.5.14) the band\'s reads All threads started; /mm start all says so and fills nothing', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [], mail: [], tickets: {} }) })
    await mm($, '')
    const ui = await pane($)
    expect(await startAllOn(ui)).toEqual([])
    await ui.unmount()
    expect(await bandStart($)).toEqual([['mm-start-missing', 'All threads started']])
    expect(await mm($, 'start all')).toBe('No client needs a new thread now.')
    const band = await bandOf($)
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(w.toasts.at(-1)).toBe('No client needs a new thread now.')
    expect(w.fills).toEqual([])
    expect(starts(w)).toEqual([])
  })

  test('N = 1: (0.7.34) the button in the pane all the same, beside Needs you now; the row\'s own Start stays; (0.5.14) the band\'s says 1; /mm start all, typed, fills the box', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [], mail: [] }) })
    await mm($, '')
    const ui = await pane($)
    expect(await startAllOn(ui)).toEqual(['Start missing threads'])
    expect(await lines(ui)).toContain('1 thread not started')
    expect(await buttonsOf(ui, CEDAR)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    expect(await bandStart($)).toEqual([['mm-start-missing', 'Start missing threads (1)']])
    expect(await mm($, 'start all')).toBe(FILLED_ALL)
    expect(w.fills).toEqual([START_ALL])
    expect((await kickoffsOf($)).map(k => k.arguments.prompt)).toEqual([stepped(CEDAR_KICKOFF)])
    expect(starts(w)).toEqual([])
  })

  test('N = 2: (0.7.34) 2 threads not started and the one button in the pane, Start missing threads (2) on the band; the press fills the box; kickoffs gives both, soonest due first, in the words that never take the package; the buttons stay until the threads exist', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [] }) })
    await mm($, '')
    const ui = await pane($)
    expect(await startAllOn(ui)).toEqual(['Start missing threads'])
    expect(await lines(ui)).toContain('2 threads not started')
    expect(await bandButtons($)).toEqual([['mm-start-missing', 'Start missing threads (2)']])
    await ui.press({ key: 'mm-start-all' })
    expect(w.fills).toEqual([START_ALL])
    expect(w.toasts.at(-1)).toBe(FILLED_ALL)
    expect(await lines(ui)).toContain(FILLED_ALL)
    const kicks = await kickoffsOf($)
    expect(kicks.map(k => [k.arguments.initiation, k.arguments.title, k.arguments.context])).toEqual([
      ['user_asked', 'Cedar Dental: reply to the client', 'fresh'],
      ['user_asked', 'Bolt Staffing: reply to the client', 'fresh'],
    ])
    expect(kicks.map(k => k.arguments.prompt)).toEqual([CEDAR_KICKOFF, BOLT_AUTO_KICKOFF].map(stepped))
    // ⛔ the bridge itself never calls start_session: the model does, on the person's words
    expect(starts(w)).toEqual([])
    expect((w.stored['mm.links'] as Record<string, string> | undefined)?.[CEDAR]).toBeUndefined()
    await w.clock.advance(1_500)
    expect(await startAllOn(ui)).toEqual(['Start missing threads'])
    expect(await bandStart($)).toEqual([['mm-start-missing', 'Start missing threads (2)']])
    await ui.unmount()
  })

  test('the band\'s button does the same; kickoffs gives Acme\'s drafts shown and not taken, the marker first', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'Start missing threads (3)']])
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(w.fills).toEqual([START_ALL])
    const prompts = (await kickoffsOf($)).map(k => k.arguments.prompt)
    expect(prompts).toEqual([CEDAR_KICKOFF, ACME_ALL, BOLT_AUTO_KICKOFF].map(stepped))
    for (const [p, pid] of prompts.map((p, i) => [p, [CEDAR, ACME, BOLT][i]] as const)) expect(p.startsWith(`[mm-link ${pid}] `)).toBe(true)
    for (const p of prompts) expect(p).not.toContain('Pick up the reply drafts')
    expect(starts(w)).toEqual([])
  })

  test('⛔ three presses at once (the pane\'s twice, and the band\'s): the words go in once', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const ui = await pane($)
    const band = await bandOf($)
    await Promise.all([ui.press({ key: 'mm-start-all' }), ui.press({ key: 'mm-start-all' }), band.press({ key: 'mm-start-missing' })])
    expect(w.fills.length).toBeGreaterThanOrEqual(1)
    expect(new Set(w.fills)).toEqual(new Set([START_ALL]))
    expect(w.box.text).toBe(START_ALL)
    expect(starts(w)).toEqual([])
    await band.unmount()
    await ui.unmount()
  })

  test('⛔ nothing starts by itself: with the button offered, half an hour of ticks and syncs start nothing and fill nothing', async ($, on) => {
    const w = world(on, { tools: 'start', store: { 'mm.autostart': { on: false } } })
    await tickOnce($, w)
    for (let i = 0; i < 30; i++) await w.clock.advance(60_000)
    expect(await bandStart($)).toEqual([['mm-start-missing', 'Start missing threads (3)']])
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
  })

  test('where the app gives no start_session, there is no Start all button in the pane, and /mm start all says to use each row', async ($, on) => {
    const w = world(on, { tools: 'spawn' })
    await mm($, '')
    const ui = await pane($)
    expect(await startAllOn(ui)).toEqual([])
    await ui.unmount()
    // (0.5.14) the band's button is always drawn; its press says the same and starts nothing
    expect(await bandStart($)).toEqual([['mm-start-missing', 'Start missing threads (3)']])
    const band = await bandOf($)
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(w.toasts.at(-1)).toBe('Start all needs the app\'s start_session, which this thread does not have: press Start thread on each row.')
    expect(await mm($, 'start all')).toBe('Start all needs the app\'s start_session, which this thread does not have: press Start thread on each row.')
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.fills).toEqual([])
  })
})

// ======================================================================== 0.5.16

describe('0.5.16: never a wall of errors (Rob, 10-19: "When it says it actually has to be started by me saying it here in the thread, that causes issues."); (0.5.25) the bridge never asks the app to start anything, so the app\'s sentence never comes', () => {
  /** Any part of the app's sentence, anywhere the person reads it. */
  const APP_TEXT = /own words|Propose the session|automated event|initiation/
  const USER_WORDS = 'Start sessions only on the user\'s own words to you here; this turn runs an automated event, another session\'s message, or the task another session gave you. Propose the session instead (initiation "own_initiative")'

  test('(a) a single Start, where the app would refuse a start for want of the person\'s own words: no call to start_session, the words in the box, one short line', async ($, on) => {
    const w = world(on, { tools: 'start', startFails: USER_WORDS })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `start:${CEDAR}` })
    expect(starts(w)).toEqual([])
    expect(w.toasts.at(-1)).toBe(filledOne('Cedar Dental'))
    expect(w.toasts.join('\n')).not.toMatch(APP_TEXT)
    expect((await lines(ui)).join('\n')).not.toMatch(APP_TEXT)
    expect(JSON.stringify(w.stored['mm.notes'] ?? [])).not.toMatch(APP_TEXT)
    await ui.unmount()
  })

  test('(b) Start all, the same app: no call to start_session, the words in the box, no band note', async ($, on) => {
    const w = world(on, { tools: 'start', startFails: USER_WORDS })
    await mm($, '')
    const band = await bandOf($)
    await band.press({ key: 'mm-start-missing' })
    await band.unmount()
    expect(starts(w)).toEqual([])
    expect(w.toasts.at(-1)).toBe(FILLED_ALL)
    expect(w.stored['mm.notes']).toBeUndefined()
    expect(w.toasts.join('\n')).not.toMatch(APP_TEXT)
  })

  test('a client with no thread, by itself, where the app would refuse a start: nothing asked of the app at all', async ($, on) => {
    const w = world(on, { tools: 'start', feed: cedarAlone(), startFails: USER_WORDS })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    expect(starts(w)).toEqual([])
    expect(JSON.stringify(w.stored['mm.notes'] ?? [])).not.toMatch(APP_TEXT)
  })
})

// ======================================================================== 0.5.17: a press's refresh tries once more
// Rob, 10-19: OW's closeout feed answered 500 now and then (a database read past its timeout), and
// every press that met one drew "Couldn't refresh the list".

describe('(0.5.17) a press\'s refresh asks OW once more when the feed answered 5xx or not at all', () => {
  /**
   * This thread is Acme's and the timer's first sync is on record; a minute on, the band's Drafts brings the list up
   * to date with a fresh read (`recentFeed`). `answers` is how the closeout feed answers each read from the press on.
   */
  const pressDrafts = async ($: Engine, on: On, answers: Array<'network' | number>) => {
    const plan: Array<'network' | number> = []
    const w = world(on, { store: { 'mm.links': { [ACME]: SELF } }, feedRead: () => plan.shift() })
    await tickOnce($, w)
    await w.clock.advance(61_000)
    plan.push(...answers)
    const before = closeouts(w)
    const band = await bandOf($)
    // (0.7.41) Acme's package waits: the waiting line's button opens the pane, as Drafts did
    await band.press({ key: 'mm-open-waiting' })
    await band.unmount()
    const ui = await pane($)
    const shown = await lines(ui)
    await ui.unmount()
    return { w, reads: closeouts(w) - before, shown, error: w.stored['mm.refreshError'] as { reason?: string } | undefined }
  }

  for (const first of [500, 503, 'network'] as const) {
    test(`a first read that got ${first === 'network' ? 'no answer' : first} is tried once more; its answer is the list, and nothing says the refresh failed`, async ($, on) => {
      const { reads, shown, error } = await pressDrafts($, on, [first, 200])
      expect(reads).toBe(2)
      expect(shown).toContain('Needs you now (3)')
      expect(shown).not.toContain(REFRESH_FAILED)
      expect(error).toBeUndefined()
    })
  }

  test('two 5xx: two reads, never a third, and the refresh fails as before', async ($, on) => {
    const { reads, shown, error } = await pressDrafts($, on, [500, 503, 200])
    expect(reads).toBe(2)
    expect(shown).toContain(REFRESH_FAILED)
    expect(error?.reason).toContain('closeout HTTP 503')
  })

  for (const status of [401, 404]) {
    test(`a ${status} is not tried again: one read, and the refresh fails as before`, async ($, on) => {
      const { reads, shown, error } = await pressDrafts($, on, [status, 200])
      expect(reads).toBe(1)
      expect(shown).toContain(REFRESH_FAILED)
      expect(error?.reason).toContain(`closeout HTTP ${status}`)
    })
  }

  test('⛔ the timer\'s sync reads once, as before: one read a sync, whatever the feed answers', async ($, on) => {
    const old = { at: NOW - 10 * 60_000, member: ME, items: [], pinned: 0, recs: {} }
    const w = world(on, { store: { 'mm.last': old }, feedRead: () => 500 })
    await tickOnce($, w)
    expect(closeouts(w)).toBe(1)
    expect((w.stored['mm.last'] as { error?: string }).error).toContain('closeout HTTP 500')
    // the sync on record failed, so the next tick syncs again: one more read, not two
    await w.clock.advance(60_000)
    expect(closeouts(w)).toBe(2)
  })

  test('⛔ the read that guards an Update reads once, as before: on a 503 nothing is sent and the feed is not asked again', async ($, on) => {
    const plan: Array<'network' | number> = []
    const w = world(on, { threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.autostart': { on: false } }, feedRead: () => plan.shift() })
    await mm($, '')
    const ui = await pane($)
    plan.push(503, 200)
    const before = closeouts(w)
    await ui.press({ key: `update:${ACME}` })
    await w.clock.advance(2_000)
    expect(closeouts(w) - before).toBe(1)
    expect(sends(w)).toEqual([])
    expect(w.toasts.join(' ')).toContain('Nothing was sent')
    await ui.unmount()
  })
})

// ======================================================================== 0.5.23

describe('0.5.23 (Rob, 10-21: "change auto-starts to update the older thread"): by itself, an old linked thread is updated, not replaced', () => {
  const notices = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).at(-1)?.text ?? ''
  type Rec = { pid: string; sid: string; ok: boolean | null; reason: string }
  const records = (w: { stored: Record<string, unknown> }) => (w.stored['mm.autoupdates'] ?? []) as Rec[]
  const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
    for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
  }
  /** To the sync 11 minutes on, the first to find the client seen for 10 minutes, and the 1 to 3 seconds its send waits. */
  const seenTen = async (w: { clock: { advance: (ms: number) => Promise<void> } }) => {
    await after(w, 11)
    await w.clock.advance(3_000)
  }
  /** Two weeks back: Mon Sep 28, 10 business days before NOW, so older than 7. */
  const OLD_H = 14 * 24
  const ACME_UPDATE = markerFirst(`New since this thread last worked on this client: drafts ready.\n${NOT_TAKEN(ACME, 'Acme Roofing Pat')}`)
  /** Acme alone: drafts ready; nothing else in the feed. */
  const acmeOnly = (): Feed => feed({ mail: [], tickets: {}, threads: [] })
  /**
   * Acme's linked thread was last active two weeks ago: until 0.7.6 its row said Start, `last thread is from Sep 28`.
   * (0.7.6) Its row says Update, as any linked thread's.
   */
  const oldWorld = (on: On, more: WorldOptions = {}) =>
    world(on, { tools: 'start', feed: acmeOnly(), threads: [thread('local_old', 'Roof quote', OLD_H)], ...more, store: { 'mm.links': { [ACME]: 'local_old' }, ...(more.store ?? {}) } })

  test('a linked thread older than 7 business days: Update\'s own message goes into it by itself, under the same wait; no thread is started and no card is made; (0.7.6) the log says it as for any thread', async ($, on) => {
    const w = oldWorld(on)
    await tickOnce($, w)
    // (0.7.6) the row says Update (until 0.7.6, Start); (0.7.5) its one line does not call it a client with no thread
    const before = await pane($)
    expect(await lines(before)).toContain(`1. ${ACME_ROW}`)
    expect(await buttonsOf(before, ACME)).toEqual(['Update thread', 'Drafts'])
    await before.unmount()
    // the same 10 minutes from when this bridge first saw it as any update sent by itself
    await after(w, 10)
    expect(sends(w)).toEqual([])
    await after(w, 1)
    await w.clock.advance(3_000)
    // into the old thread, in the words that never take the package, the marker first
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_old', ACME_UPDATE]])
    // ⛔ no start, no proposal card, no chip
    expect(starts(w)).toEqual([])
    expect(proposals(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.stored['mm.autostarts']).toBeUndefined()
    // on record and in the notice log: (0.7.6) as any update, with no word of an older thread (until 0.7.6, "last
    // thread is from Sep 28, so that thread was updated instead of starting a new one; ..."): no row says Start for age
    expect(records(w).map(r => [r.pid, r.sid, r.ok])).toEqual([[ACME, 'local_old', true]])
    expect(records(w)[0]?.reason).toBe('something new for the client: drafts ready')
    expect(notices(w)).toMatch(new RegExp(`updated Acme Roofing \\(${ACME}\\) sig [0-9a-f]{8} in local_old: something new for the client: drafts ready`))
    expect(notices(w)).not.toContain('last thread is from')
    // the link is the person's as it was; the thread now has what is waiting, so its row says Open
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect((w.stored['mm.sent'] as Record<string, { sid: string }>)[ACME]?.sid).toBe('local_old')
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Open thread', 'Drafts'])
    await ui.unmount()
    // never twice, and still never a start
    await after(w, 30)
    expect(sends(w).length).toBe(1)
    expect(starts(w)).toEqual([])
  })

  test('an update the row asked for (a recent thread) is logged as before, with no word of an older thread', async ($, on) => {
    const w = oldWorld(on, { threads: [thread('local_old', 'Roof quote', 30)] })
    await tickOnce($, w)
    await seenTen(w)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_old'])
    expect(records(w)[0]?.reason).toBe('something new for the client: drafts ready')
    expect(notices(w)).not.toContain('last thread is from')
  })

  for (const [name, more] of [
    ['the time-tracking hook on this computer is older than 0.11.5', { hook: 'old' }],
    ['/mm auto off', { store: { 'mm.autostart': { on: false } } }],
    ['the bridge is paused', { store: { 'mm.paused': true } }],
  ] as Array<[string, WorldOptions]>) {
    test(`⛔ every guard of an update sent by itself still holds for an old thread: ${name}: nothing is sent, and nothing is started either`, async ($, on) => {
      const w = oldWorld(on, more)
      await tickOnce($, w)
      await after(w, 30)
      expect(sends(w)).toEqual([])
      expect(records(w)).toEqual([])
      expect(starts(w)).toEqual([])
      expect(w.prompts).toEqual([])
    })
  }

  /** The first message of a thread start_session opened, as the app wraps it. */
  const wrapped = (args: { prompt: string; background: string }) => `Background (from the session that started this one):\n${args.background}\n\nTask:\n${args.prompt}`

  test('(0.5.25) a client with no thread: no card by itself and no thread started; its row waits for the person\'s Start', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [], mail: [] }) })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    await after(w, 30)
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
    expect(sends(w)).toEqual([])
    expect(notices(w)).not.toContain('card for')
    expect(w.stored['mm.autostarts']).toBeUndefined()
    const ui = await pane($)
    expect((await buttonsOf(ui, CEDAR))[0]).toBe('Start thread')
    await ui.unmount()
  })

  test('an old thread that is not the client\'s linked one (the person unlinked it): never updated by itself; (0.5.25) no card either, and kickoffs gives the client\'s start with the hand-over', async ($, on) => {
    const f = acmeOnly()
    f.threads = [declared(ACME, 'cli-acme', OLD_H)]
    const w = world(on, { tools: 'start', feed: f, threads: [thread('local_a', 'Roof quote', OLD_H)], store: { 'mm.threads': PAIRS, 'mm.unlinked': { local_a: NOW - 48 * HOUR } } })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    await after(w, 30)
    expect(starts(w)).toEqual([])
    expect(sends(w).filter(c => c.args.session_id === 'local_a')).toEqual([])
    expect(records(w)).toEqual([])
    expect(notices(w)).not.toContain('card for')
    // (0.7.6) its row offers that thread by Update, as it did for a recent one the person unlinked (until 0.7.6 an old
    // one's row said Start): the person's own press links it back. So Start missing threads leaves Acme out, and
    // kickoffs for Acme by name gives its start with the hand-over
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Update thread', 'Drafts'])
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(w.stored['mm.links']).toEqual({})
    const kicks = await kickoffsOf($, 'acme')
    expect(kicks.map(k => k.client)).toEqual(['Acme Roofing'])
    expect(kicks[0]?.arguments.prompt).toContain(HANDOVER('Roof quote', 'local_a', 'Acme Roofing Pat'))
    expect(kicks[0]?.arguments.prompt.startsWith(`[mm-link ${ACME}] `)).toBe(true)
    expect(starts(w)).toEqual([])
  })

  test('the person\'s Start on a client whose linked thread is old: (0.5.25) the client\'s words in the prompt box; kickoffs gives its start with the hand-over; while that start is claimed the old thread is not updated by itself; the thread started from it takes the client', async ($, on) => {
    const w = oldWorld(on)
    await tickOnce($, w)
    // nine of the ten minutes an update by itself waits
    await after(w, 9)
    // (0.7.6) the row says Update now, however old the thread (until 0.7.6 this was the row's Start press): the
    // person's Start for that client is typed
    const ui = await pane($)
    expect(await buttonsOf(ui, ACME)).toEqual(['Update thread', 'Drafts'])
    await ui.unmount()
    expect(await mm($, 'start acme')).toBe(filledOne('Acme Roofing'))
    expect(w.fills).toEqual([startOf('Acme Roofing')])
    expect(starts(w)).toEqual([])
    const kicks = await kickoffsOf($, 'acme')
    expect(kicks.length).toBe(1)
    expect(kicks[0]?.arguments).toMatchObject({ initiation: 'user_asked', context: 'fresh' })
    expect(kicks[0]?.arguments.prompt).toBe(stepped(`${ACME_KICKOFF}\n\n${HANDOVER('Roof quote', 'local_old', 'Acme Roofing Pat')}`))
    // the link stays where it was until the new thread opens
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    // the ten minutes pass while the start is claimed: nothing goes into the old thread
    await after(w, 1)
    await w.clock.advance(3_000)
    expect(sends(w)).toEqual([])
    expect(records(w)).toEqual([])
    // the thread the model started opens with that kickoff: it takes the client, and the old thread is given back
    await $.prompt.submit({ text: wrapped(kicks[0]?.arguments as { prompt: string; background: string }), wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(w.stored['mm.released']).toEqual(['local_old'])
    expect(starts(w)).toEqual([])
  })

  test('Start missing threads, pressed: (0.5.25) the words in the prompt box; kickoffs gives the clients with no thread; the client whose linked thread is old is not one of them', async ($, on) => {
    const w = oldWorld(on, { feed: feed({ threads: [] }) })
    await mm($, '')
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'Start missing threads (2)']])
    const pressed = band.press({ key: 'mm-start-missing' })
    await w.clock.advance(2_000)
    await pressed
    await band.unmount()
    expect(w.fills).toEqual([START_ALL])
    expect(starts(w)).toEqual([])
    expect((await kickoffsOf($)).map(k => k.arguments.prompt)).toEqual([CEDAR_KICKOFF, BOLT_AUTO_KICKOFF].map(stepped))
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_old' })
    expect(sends(w)).toEqual([])
  })

  test('/mm start typed for that client: (0.5.25) the client\'s words in the prompt box, and kickoffs gives its start with the hand-over, never an update', async ($, on) => {
    const w = oldWorld(on)
    await tickOnce($, w)
    expect(await mm($, 'start acme')).toBe(filledOne('Acme Roofing'))
    expect(w.fills).toEqual([startOf('Acme Roofing')])
    expect(starts(w)).toEqual([])
    const kicks = await kickoffsOf($, 'acme')
    // (0.7.44) the top-level step between the kickoff and the hand-over
    expect(kicks[0]?.arguments.prompt.startsWith(`${ACME_KICKOFF}\n\n${TOP_LEVEL_STEP}\n\nThis thread replaces "Roof quote" (thread local_old)`)).toBe(true)
    expect(sends(w)).toEqual([])
  })
})

describe('0.5.23 (the 14 refused starts of 10-19 and 10-20): a link lasts until its thread is archived or deleted, and a client with no thread takes back the one that opened with its marker', () => {
  // The cause, found in the store: the person works in two Claude profiles on this computer. From a session in one,
  // the app answers "not found" for a thread of the other, and the sync took that as "deleted" and dropped the link.
  const ROOT = '/home/someone/Library/Application Support/Claude/claude-code-sessions'
  /** This profile's folder of records, where this thread's own record is; and the other profile's. */
  const HERE = `${ROOT}/acct-here/org-here`
  const OTHER = `${ROOT}/acct-other/org-other`
  /** One record file as the app writes it (only `sessionId` and `isArchived` are ever read from it). */
  const rec = (dir: string, sid: string, archived = false, mtimeMs = NOW - HOUR) => ({
    [`${dir}/${sid}.json`]: { text: JSON.stringify({ sessionId: sid, isArchived: archived, title: 'not read', model: 'not read' }), mtimeMs },
  })
  const mine = rec(HERE, SELF)
  type Rec = { pid: string; sid: string; ok: boolean | null; reason: string }
  const records = (w: { stored: Record<string, unknown> }) => (w.stored['mm.autoupdates'] ?? []) as Rec[]
  const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
    for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
  }
  const acmeOnly = (): Feed => feed({ mail: [], tickets: {}, threads: [] })
  const recordReads = (w: { reads: string[] }) => w.reads.filter(p => p.includes('claude-code-sessions'))
  const askedById = (w: { calls: Call[] }, sid: string) => w.calls.filter(c => c.tool === 'get_session' && c.args.session_id === sid)
  /** Acme is linked to a thread of the other profile, pinned and named there by the bridge. */
  const awayWorld = (on: On, more: WorldOptions = {}) =>
    world(on, {
      tools: 'start',
      feed: acmeOnly(),
      threads: [thread('local_other', 'Unrelated notes', 100)],
      files: { ...mine, ...rec(OTHER, 'local_p2') },
      ...more,
      store: { 'mm.links': { [ACME]: 'local_p2' }, 'mm.pins': { local_p2: ourPin(ACME, 'Acme Roofing') }, 'mm.titles': { local_p2: 'Roof quote' }, ...(more.store ?? {}) },
    })

  // ---- fix 1: keep links

  test('a linked thread of the other profile ("not found" here, its record open in the other profile\'s folder): link, pin record and name are kept; its row offers Start and says why; nothing is started, sent or carded by itself', async ($, on) => {
    const w = awayWorld(on)
    await tickOnce($, w)
    const ui = await pane($)
    // (0.7.5) the why is not drawn: the row is a Start whose one line does not call it a client with no thread
    expect(await lines(ui)).toContain(`1. ${ACME_ROW}`)
    expect(await buttonsOf(ui, ACME)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    await after(w, 30)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_p2' })
    expect(w.stored['mm.pins']).toEqual({ local_p2: ourPin(ACME, 'Acme Roofing') })
    expect(w.stored['mm.titles']).toEqual({ local_p2: 'Roof quote' })
    // ⛔ by itself: no start, no chip, no message. (0.7.35, Rob 11-07: "still should have started a chip for them") Its one card, which starts nothing.
    expect(starts(w)).toEqual([])
    expect(proposals(w).length).toBe(1)
    expect(w.minted()).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.stored['mm.autostarts']).toBeUndefined()
    // its record said where it is: the app here was never asked for it by id
    expect(askedById(w, 'local_p2')).toEqual([])
    // ⛔ only the two records were opened (this thread's own, to know its folder; and that thread's), nothing written there
    expect(new Set(recordReads(w))).toEqual(new Set([`${HERE}/${SELF}.json`, `${OTHER}/local_p2.json`]))
    expect(w.written.filter(f => f.path.includes('claude-code-sessions'))).toEqual([])
  })

  test('back in the other profile (the thread is in the app\'s list again): the link was there all along, and the update goes into that thread by itself', async ($, on) => {
    const w = awayWorld(on)
    await tickOnce($, w)
    await after(w, 20)
    expect(sends(w)).toEqual([])
    // the person switches profiles: the thread is this app's again
    w.threads.set('local_p2', thread('local_p2', 'Roof quote', 2))
    await after(w, 20)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_p2'])
    expect(records(w).map(r => [r.pid, r.sid, r.ok])).toEqual([[ACME, 'local_p2', true]])
    expect(starts(w)).toEqual([])
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_p2' })
  })

  test('the same where this thread\'s own record cannot be read: a "not found" whose record is open counts as the other profile\'s, after the app is asked', async ($, on) => {
    const w = awayWorld(on, { files: rec(OTHER, 'local_p2') })
    await tickOnce($, w)
    expect(askedById(w, 'local_p2').length).toBeGreaterThan(0)
    await after(w, 30)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_p2' })
    expect(starts(w)).toEqual([])
  })

  for (const [name, files] of [
    ['its record says archived', { ...mine, ...rec(OTHER, 'local_p2', true) }],
    ['its record is in this thread\'s own folder (the app here would have found it)', { ...mine, ...rec(HERE, 'local_p2') }],
    ['its record has not changed in 30 days', { ...mine, ...rec(OTHER, 'local_p2', false, NOW - 31 * 24 * HOUR) }],
    ['there is no record of it at all', { ...mine }],
    ['no records can be listed on this computer', {}],
  ] as Array<[string, Record<string, { text: string; mtimeMs: number }>]>) {
    test(`a linked thread the app here has no such thread for, where ${name}: the link, pin record and name are dropped, as before`, async ($, on) => {
      const w = awayWorld(on, { tools: undefined, files })
      await mm($, '')
      expect(w.stored['mm.links']).toEqual({})
      expect((w.stored['mm.pins'] as Record<string, unknown>).local_p2).toBeUndefined()
      const ui = await pane($)
      // (0.7.5) the client has no thread now, and its one line says so
      expect(await lines(ui)).toContain(`◆ 1. ${ACME_FRESH}`)
      await ui.unmount()
    })
  }

  // (0.7.6) the app here showing it archived is what counts, never its record: the link is dropped, and the client's
  // own thread is then brought back (until 0.7.6 it was let go); when the app does not unarchive it, it stays dropped
  for (const [how, more, links] of [
    ['the app unarchives it: brought back and linked again', {}, { [ACME]: 'local_p2' }],
    ['the app does not unarchive it: the link stays dropped', { unarchive: 'refuse' }, {}],
  ] as Array<[string, WorldOptions, Record<string, string>]>) {
    test(`the app showing the thread archived still drops the link, whatever its record says; (0.7.6) ${how}`, async ($, on) => {
      const w = awayWorld(on, { tools: undefined, threads: [thread('local_other', 'Unrelated notes', 100), thread('local_p2', 'Roof quote', 5, { isArchived: true })], files: { ...mine, ...rec(HERE, 'local_p2') }, ...more })
      await mm($, '')
      expect(w.calls.filter(c => c.tool === 'unarchive_session').map(c => c.args.session_id)).toEqual(['local_p2'])
      expect(w.stored['mm.links']).toEqual(links)
    })
  }

  test('forty-five linked threads of the other profile: none asked for by id, at most 40 record files opened in a sync, every link kept', async ($, on) => {
    const pids = Array.from({ length: 45 }, (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`)
    const files: Record<string, { text: string; mtimeMs: number }> = { ...mine }
    for (let i = 0; i < 45; i++) Object.assign(files, rec(OTHER, `local_p${i}`))
    const links = Object.fromEntries(pids.map((pid, i) => [pid, `local_p${i}`]))
    const w = world(on, { feed: acmeOnly(), threads: [thread('local_other', 'Unrelated notes', 100)], files, store: { 'mm.links': links } })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual(links)
    expect(recordReads(w).length).toBeLessThanOrEqual(40)
    // (0.7.35) the ones whose records were not opened this sync: the listing says they are not here, and the app is not asked
    expect(w.calls.filter(c => c.tool === 'get_session' && c.args.session_id !== 'self')).toEqual([])
  })

  test('Start missing threads, pressed in this profile: the client whose thread is in the other profile is one of them, as when its link was dropped; (0.5.25) the words go in the prompt box, kickoffs gives its start, and the link stays until the new thread opens', async ($, on) => {
    const w = awayWorld(on, { feed: feed({ threads: [] }), store: { 'mm.pins': {}, 'mm.titles': {} } })
    await mm($, '')
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'Start missing threads (3)']])
    const pressed = band.press({ key: 'mm-start-missing' })
    await w.clock.advance(2_000)
    await pressed
    await band.unmount()
    expect(w.fills).toEqual([START_ALL])
    expect(starts(w)).toEqual([])
    const kicks = await kickoffsOf($)
    expect(kicks.length).toBe(3)
    expect(kicks.some(k => k.arguments.prompt.startsWith(`[mm-link ${ACME}] `))).toBe(true)
    expect((w.stored['mm.links'] as Record<string, string>)[ACME]).toBe('local_p2')
    expect(sends(w)).toEqual([])
  })

  test('the person\'s Start on that row: (0.5.25) the client\'s words in the prompt box, and kickoffs gives its start; (0.7.11) with a hand-over that names the old thread (its record gives no transcript here)', async ($, on) => {
    const w = awayWorld(on)
    await tickOnce($, w)
    const ui = await pane($)
    await ui.press({ key: `start:${ACME}` })
    await ui.unmount()
    expect(w.fills).toEqual([startOf('Acme Roofing')])
    expect(starts(w)).toEqual([])
    // (0.7.11) until 0.7.11 no hand-over at all: the session tools here cannot open the old thread. Its id and name now go
    // in, and its transcript when its record names one (the 0.7.11 tests); this record names none.
    const handover = 'This client\'s last thread is in another Claude profile: thread local_p2 ("Roof quote") for Acme Roofing Pat. The session tools here cannot open it. Its transcript could not be found from here, so carry on from the client\'s project skill and records.'
    expect((await kickoffsOf($, 'acme')).map(k => k.arguments.prompt)).toEqual([stepped(`${ACME_KICKOFF}\n\n${handover}`)])
  })

  // ---- fix 2: a client with no linked thread takes back its marked thread

  test('a client with no linked thread takes back the newest open thread that opened with its marker; recent, so its update goes there by itself, and nothing is started', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: acmeOnly(),
      threads: [thread('local_m1', 'Roof quote', 120), thread('local_m2', 'Acme follow-up', 30)],
      store: { 'mm.marked': { local_m1: ACME, local_m2: ACME }, 'mm.markedAt': { local_m1: NOW - 9 * 24 * HOUR, local_m2: NOW - 3 * 24 * HOUR } },
    })
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_m2' })
    // the bridge's own link, as R1 makes one
    expect(w.stored['mm.auto']).toEqual({ [ACME]: { sid: 'local_m2', miss: 0, made: expect.any(Number) } })
    await after(w, 20)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_m2'])
    expect(records(w)[0]?.reason).toBe('something new for the client: drafts ready')
    expect(starts(w)).toEqual([])
    expect(proposals(w)).toEqual([])
  })

  test('its only marked thread is older than 7 business days: taken back all the same, and updated by itself (0.7.6: as any thread)', async ($, on) => {
    // (a marker 0.5.9 recorded, with no time on record, still counts here)
    const w = world(on, { tools: 'start', feed: acmeOnly(), threads: [thread('local_m1', 'Roof quote', 14 * 24)], store: { 'mm.marked': { local_m1: ACME } } })
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_m1' })
    await after(w, 20)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_m1'])
    // (0.7.6) its row says Update, so the reason is the news alone (until 0.7.6, "last thread is from Sep 28, so that
    // thread was updated instead of starting a new one; ...")
    expect(records(w)[0]?.reason).toBe('something new for the client: drafts ready')
    expect(starts(w)).toEqual([])
  })

  for (const [name, files] of [
    ['archived (its record says so)', { ...mine, ...rec(HERE, 'local_m2', true) }],
    ['deleted (no record of it)', { ...mine }],
  ] as Array<[string, Record<string, { text: string; mtimeMs: number }>]>) {
    test(`the newest marked thread is ${name}: the next newest that is open is taken back`, async ($, on) => {
      const w = world(on, {
        feed: acmeOnly(),
        threads: [thread('local_m1', 'Roof quote', 120)],
        files,
        store: { 'mm.marked': { local_m1: ACME, local_m2: ACME }, 'mm.markedAt': { local_m1: NOW - 9 * 24 * HOUR, local_m2: NOW - 3 * 24 * HOUR } },
      })
      await mm($, '')
      expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_m1' })
    })
  }

  test('the newest marked thread is this profile\'s, older than the app\'s list: the app is asked for it by id, and it is taken back', async ($, on) => {
    const w = world(on, {
      feed: acmeOnly(),
      threads: [thread('local_m1', 'Roof quote', 120), thread('local_m2', 'Acme follow-up', 30)],
      unlisted: ['local_m2'],
      files: { ...mine, ...rec(HERE, 'local_m2') },
      store: { 'mm.marked': { local_m1: ACME, local_m2: ACME }, 'mm.markedAt': { local_m1: NOW - 9 * 24 * HOUR, local_m2: NOW - 3 * 24 * HOUR } },
    })
    await mm($, '')
    expect(askedById(w, 'local_m2').length).toBe(1)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_m2' })
  })

  test('⛔ the newest marked thread cannot be found out about in this sync (the app does not answer for it): no older one is taken past it', async ($, on) => {
    const w = world(on, {
      feed: acmeOnly(),
      threads: [thread('local_m1', 'Roof quote', 120)],
      lookupFails: 'internal error',
      files: { ...mine, ...rec(HERE, 'local_m2') },
      store: { 'mm.marked': { local_m1: ACME, local_m2: ACME }, 'mm.markedAt': { local_m1: NOW - 9 * 24 * HOUR, local_m2: NOW - 3 * 24 * HOUR } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({})
  })

  test('the newest marked thread is in the other profile, and none is here: taken back, kept as that profile\'s (its row offers Start here), and nothing is started or sent by itself', async ($, on) => {
    // (0.7.11) with an older marked thread HERE as well (local_m1, until 0.7.11 part of this test), that one is linked
    // instead: a client's own thread in the profile in use comes first (the 0.7.11 tests)
    const w = world(on, {
      tools: 'start',
      feed: acmeOnly(),
      threads: [thread('local_other', 'Unrelated notes', 100)],
      files: { ...mine, ...rec(OTHER, 'local_m2') },
      store: { 'mm.marked': { local_m2: ACME }, 'mm.markedAt': { local_m2: NOW - 3 * 24 * HOUR } },
    })
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_m2' })
    const ui = await pane($)
    // (0.7.5) a Start here, whose one line does not call it a client with no thread (the why is not drawn)
    expect(await lines(ui)).toContain(`1. ${ACME_ROW}`)
    expect(await buttonsOf(ui, ACME)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    await after(w, 30)
    expect(starts(w)).toEqual([])
    // (0.7.35) its one card, which starts nothing
    expect(proposals(w).length).toBe(1)
    expect(sends(w)).toEqual([])
  })

  test('⛔ only the marker counts: a thread whose title looks like the client is never taken back (its row offers it, as before) and nothing is done by itself', async ($, on) => {
    const w = world(on, { tools: 'start', feed: acmeOnly(), threads: [thread('local_t', 'Acme Roofing: reply to the client', 20)] })
    await tickOnce($, w)
    await after(w, 30)
    expect((w.stored['mm.links'] as Record<string, string>)[ACME]).toBeUndefined()
    expect(starts(w)).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('⛔ a thread the person unlinked, one marked for another client and one linked to another client are never taken back; (0.5.25) the client waits for the person\'s Start, with no card', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: acmeOnly(),
      threads: [thread('local_u', 'Roof quote', 30), thread('local_o', 'Bolt intake', 40), thread('local_x', 'Notes', 50)],
      store: {
        'mm.marked': { local_u: ACME, local_o: BOLT, local_x: ACME },
        'mm.markedAt': { local_u: NOW - HOUR, local_o: NOW - HOUR, local_x: NOW - HOUR },
        'mm.unlinked': { local_u: NOW - 2 * HOUR },
        'mm.links': { [CEDAR]: 'local_x' },
      },
    })
    await tickOnce($, w)
    await w.clock.advance(3_000)
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
    expect((w.stored['mm.links'] as Record<string, string>)[ACME]).toBeUndefined()
    expect((w.stored['mm.links'] as Record<string, string>)[CEDAR]).toBe('local_x')
    expect(sends(w)).toEqual([])
    expect((await kickoffsOf($)).map(k => k.arguments.prompt.slice(0, 47))).toEqual([`[mm-link ${ACME}] `])
  })

  test('a client that already has a linked thread keeps it: an older or a newer marked thread does not take it here', async ($, on) => {
    const w = world(on, {
      feed: acmeOnly(),
      threads: [thread('local_a', 'Roof quote', 10), thread('local_m2', 'Acme follow-up', 3)],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.marked': { local_m2: ACME }, 'mm.markedAt': { local_m2: NOW - HOUR } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
  })
})

// ---------------------------------------------------------------- New people (OW ticket 549944b0, spec Part B)
// Someone wrote to us and no project matched. Every person, address and link here is made up.

describe('New people: the founder and a PM route, start or dismiss someone no project matched', () => {
  const DANA = 'a1a1a1a1-0000-4000-8000-000000000001'
  const MARCUS = 'a2a2a2a2-0000-4000-8000-000000000002'
  const PRIYA = 'a3a3a3a3-0000-4000-8000-000000000003'
  const DANA_LINK = 'https://mail.google.com/mail/u/support@example.com/#all/18f0000000000001'
  /** As the pane draws it: an `@` after the host is `%40` (a surface draws a link holding a raw one as plain text). */
  const DANA_SHOWN = 'https://mail.google.com/mail/u/support%40example.com/#all/18f0000000000001'
  /** One with warnings, one Directory lead, one we have history with. */
  const ALERTS: NonNullable<Feed['person_alerts']> = [
    {
      id: DANA, source: 'gmail_unmatched', sender_name: 'Dana Whitfield', sender_email: 'dana@northwind.example', company: 'Northwind Interiors',
      subject: 'RFP: office build-out, Plano', received_at: '2026-10-08T13:40:00Z', due_at: '2026-10-09T13:40:00Z', mailboxes: ['support@example.com'],
      warnings: ['blank_body', 'bcc_only', 'attachment_only'], relationship_summary: 'no history found', source_link: DANA_LINK, shadow_bootstrap_candidate: false,
    },
    {
      id: MARCUS, source: 'hl_directory', sender_name: 'Marcus Lee', sender_email: null, company: null, subject: 'New message from Marcus Lee',
      received_at: '2026-10-12T13:05:00Z', due_at: '2026-10-13T13:05:00Z', mailboxes: ['support@example.com'], warnings: [], relationship_summary: 'no history found',
      source_link: 'https://app.example.com/v2/location/loc1/conversations/abc123', shadow_bootstrap_candidate: false,
    },
    {
      id: PRIYA, source: 'gmail_unmatched', sender_name: 'Priya Raman', sender_email: 'priya@fabrikam.example', company: 'Fabrikam Health', subject: 'Following up on our call',
      received_at: '2026-10-09T14:15:00Z', due_at: '2026-10-12T14:15:00Z', mailboxes: ['founder@example.com'], warnings: [],
      relationship_summary: '2 recorded calls (Feb 2026) · HighLevel contact · 3 past emails with this domain',
      source_link: 'https://mail.google.com/mail/u/founder@example.com/#all/18f0000000000003', shadow_bootstrap_candidate: true,
    },
  ]
  const PROJECTS = [
    { project_id: BOLT, name: 'Bolt Staffing (Sam)' },
    { project_id: ACME, name: 'Acme Roofing — Pat' },
  ]
  /** The founder's feed: the usual three clients (his own here), and whoever wrote to us. */
  const founderFeed = (over: Partial<Feed> = {}): Feed => feed({ role: 'founder', projects: PROJECTS, person_alerts: ALERTS, ...over })
  /** What the section draws, top to bottom, for these three, on the test's clock (Mon Oct 12, 11 AM ET). */
  const SECTION = [
    'New people (3)',
    'Wrote to us, and no project matched.',
    '• Marcus Lee · via HighLevel Directory',
    'Subject: New message from Marcus Lee',
    'Received Mon Oct 12, 9:05 AM ET · under 1 business day waiting',
    'We know them: no history found',
    '• Priya Raman · Fabrikam Health',
    'Subject: Following up on our call',
    'Received Fri Oct 9, 10:15 AM ET · 1 business day waiting',
    'We know them: 2 recorded calls (Feb 2026) · HighLevel contact · 3 past emails with this domain',
    '• Dana Whitfield · Northwind Interiors',
    'Subject: RFP: office build-out, Plano',
    'Received Thu Oct 8, 9:40 AM ET · 2 business days waiting',
    'We know them: no history found',
    'Check first:',
    '[blank body]',
    "[Bcc'd]",
    '[attachment only]',
  ]
  const personButtons = (id: string) => [
    [`mm-person:route:${id}`, 'Route to project'],
    [`mm-person:bootstrap:${id}`, 'Start project'],
    [`mm-person:not_client:${id}`, 'Not client mail'],
  ]
  const peopleButtons = async (ui: Drawing) => (await buttons(ui)).filter(([key]) => key.startsWith('mm-person:'))
  /** A HighLevel Directory lead's row: Mark handled and Not client mail only (OW refuses route and bootstrap for one). */
  const directoryButtons = (id: string) => [
    [`mm-person:handled:${id}`, 'Mark handled'],
    [`mm-person:not_client:${id}`, 'Not client mail'],
  ]
  /** OW's 200 to a Route, filing `n` of the person's emails. */
  const routed = (n: number) => (body: Record<string, unknown>) => ({ status: 200, body: { id: body.alert_id, status: 'routed', requeued_count: n } })
  /**
   * (0.7.5, the panel redesign) New people is one of the groups under the list, closed until its button is pressed (it
   * stays open in this thread from then on): the tests below that read its rows press it first.
   */
  const PEOPLE = 'mm-fold:people'
  /** `n` projects OW's resolve route accepts, as the feed's `route_projects` gives them: `Client 001` ... */
  const routeProjects = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, name: `Client ${String(i + 1).padStart(3, '0')}` }))

  test('the founder sees New people ((0.7.5) under the list, closed until its button opens it), newest first, each with Source and three buttons; the list is as before', async ($, on) => {
    const w = world(on, { feed: founderFeed() })
    await mm($, '')
    // (0.7.5) closed: its button in the line of groups under the list, and nothing of it drawn
    const closed = await pane($)
    expect((await buttons(closed)).filter(b => b[0].startsWith('mm-fold:'))).toEqual([[PEOPLE, 'New people (3)']])
    expect((await lines(closed)).some(l => l.startsWith('New people') || l.startsWith('• '))).toBe(false)
    expect(await peopleButtons(closed)).toEqual([])
    await closed.press({ key: PEOPLE })
    await closed.unmount()
    for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      const drawn = await lines(ui)
      expect(drawn[0]).toBe('Needs you now (3)')
      // (0.7.5) the list first, then the section
      expect(drawn.slice(1, 4)).toEqual([`◆ 1. ${CEDAR_FRESH}`, `◆ 2. ${ACME_FRESH}`, `◆ 3. ${BOLT_FRESH}`])
      expect(drawn.slice(4, 4 + SECTION.length)).toEqual(SECTION)
      expect(await peopleButtons(ui)).toEqual([...directoryButtons(MARCUS), ...personButtons(PRIYA), ...personButtons(DANA)])
      expect((await ui.findAll({ type: 'Link' })).map(l => [l.props.label, l.props.href])).toEqual([
        ['Source', 'https://app.example.com/v2/location/loc1/conversations/abc123'],
        ['Source', 'https://mail.google.com/mail/u/founder%40example.com/#all/18f0000000000003'],
        ['Source', DANA_SHOWN],
      ])
      await ui.unmount()
    }
    // nothing but the feed was fetched (and (0.7.23) the sync's pin report): no resolve until a press
    expect(w.resolves).toEqual([])
    expect(w.fetched.filter(u => !u.endsWith('/api/ext/bridge-pins')).every(u => u.startsWith('https://onboarding-wizard.massmarket.ai/api/ext/closeout?'))).toBe(true)
  })

  test('a feed with no person_alerts key (an OW that does not send them yet) draws the pane exactly as before', async ($, on) => {
    const without = founderFeed()
    delete without.person_alerts
    const w = world(on, { feed: without })
    await mm($, '')
    const ui = await pane($)
    const drawn = await lines(ui)
    expect(drawn[0]).toBe('Needs you now (3)')
    expect(drawn.some(l => l.startsWith('New people'))).toBe(false)
    expect(await peopleButtons(ui)).toEqual([])
    expect(await ui.findAll({ type: 'Link' })).toEqual([])
    expect(await ui.findAll({ type: 'Select' })).toEqual([])
    expect(w.stored['mm.last']).not.toHaveProperty('people')
    await ui.unmount()
    // the same list with them is that list and the section, nothing else ((0.7.5) closed, the list alone; opened, the
    // section under the list, before the pane's one clock)
    w.setFeed(founderFeed())
    await mm($, '')
    const ui2 = await pane($)
    expect(await lines(ui2)).toEqual(drawn)
    await ui2.press({ key: PEOPLE })
    const all = await lines(ui2)
    const at = drawn.length - 1
    expect(all.slice(at, at + SECTION.length)).toEqual(SECTION)
    expect([...all.slice(0, at), ...all.slice(at + SECTION.length)]).toEqual(drawn)
    // and once OW sends none again, the section goes
    w.setFeed(without)
    await mm($, '')
    expect(await lines(ui2)).toEqual(drawn)
    expect(w.resolves).toEqual([])
    await ui2.unmount()
  })

  test('only the founder and a PM see it: a builder whose feed carries alerts sees none, and an empty list is no section', async ($, on) => {
    const w = world(on, { feed: feed({ projects: PROJECTS, person_alerts: ALERTS }) })
    await mm($, '')
    let ui = await pane($)
    expect((await lines(ui)).some(l => l.startsWith('New people'))).toBe(false)
    expect(await peopleButtons(ui)).toEqual([])
    // (0.7.5) nor its button
    expect((await buttons(ui)).map(b => b[0])).not.toContain(PEOPLE)
    await ui.unmount()
    w.setFeed(feed({ member: 'pm@example.com', role: 'pm', projects: PROJECTS, person_alerts: [ALERTS[0]!] }))
    await mm($, '')
    ui = await pane($)
    // (0.7.5) opened by its button
    await ui.press({ key: PEOPLE })
    expect((await lines(ui)).slice(1, 3)).toEqual(['New people (1)', 'Wrote to us, and no project matched.'])
    await ui.unmount()
    w.setFeed(feed({ member: 'pm@example.com', role: 'pm', projects: PROJECTS, person_alerts: [] }))
    await mm($, '')
    ui = await pane($)
    expect((await lines(ui)).some(l => l.startsWith('New people'))).toBe(false)
    expect(w.stored['mm.last']).not.toHaveProperty('people')
    expect(w.stored['mm.last']).not.toHaveProperty('routeTo')
    await ui.unmount()
  })

  test('Not client mail: ONE call to the resolve route; on 200 the row leaves, the pane says so, and the feed is read again', async ($, on) => {
    const w = world(on, { feed: founderFeed() })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    const feedReads = () => w.fetched.filter(u => u.includes('/api/ext/closeout?')).length
    const reads = feedReads()
    await ui.press({ key: `mm-person:not_client:${DANA}` })
    expect(w.resolves.map(r => [r.method, r.body])).toEqual([['POST', { alert_id: DANA, action: 'not_client' }]])
    expect(w.resolves[0]?.headers.Authorization).toBe('Bearer fixture-token-not-a-real-one')
    expect(w.resolves[0]?.headers['Content-Type']).toBe('application/json')
    expect(w.resolves[0]?.headers['X-MM-Client']).toMatch(/^mm-bridge\/\d+\.\d+\.\d+$/)
    expect(w.fetched.filter(u => u.includes('/person-alert/'))).toEqual(['https://onboarding-wizard.massmarket.ai/api/ext/person-alert/resolve'])
    const drawn = await lines(ui)
    expect(drawn).toContain('Dana Whitfield marked not client mail.')
    expect(drawn).toContain('New people (2)')
    expect(drawn.some(l => l.includes('Dana Whitfield ·'))).toBe(false)
    expect(w.toasts).toContain('Dana Whitfield marked not client mail.')
    expect(w.stored['mm.peopleDone']).toEqual({ [DANA]: NOW })
    // (askSync) the feed is read again: OW, which still lists her until it has it, does not bring her back
    await w.clock.advance(1_000)
    expect(feedReads()).toBe(reads + 1)
    expect((await lines(ui)).some(l => l.includes('Dana Whitfield ·'))).toBe(false)
    // nothing was sent to anybody, and no thread was touched by the press
    expect(w.acted()).toEqual([])
    await ui.unmount()
  })

  test('a person resolved stays off for 30 minutes whatever a feed read before still says, and shows again after if OW still has them open', async ($, on) => {
    const w = world(on, { feed: founderFeed() })
    await mm($, '')
    let ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:handled:${MARCUS}` })
    expect(w.resolves.map(r => r.body)).toEqual([{ alert_id: MARCUS, action: 'handled' }])
    expect(await lines(ui)).toContain('Marcus Lee marked handled.')
    await ui.unmount()
    await w.clock.advance(29 * 60_000)
    await mm($, '')
    ui = await pane($)
    expect((await lines(ui)).some(l => l.startsWith('• Marcus Lee'))).toBe(false)
    await ui.unmount()
    await w.clock.advance(2 * 60_000)
    await mm($, '')
    ui = await pane($)
    expect((await lines(ui)).filter(l => l.startsWith('• Marcus Lee'))).toEqual(['• Marcus Lee · via HighLevel Directory'])
    await ui.unmount()
  })

  test('Route to project: the picker (from projects[], the feed giving no route_projects), then Route to <project> sends that project; Cancel closes it with no call', async ($, on) => {
    const w = world(on, { feed: founderFeed(), resolve: routed(2) })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:route:${PRIYA}` })
    const picker = await ui.find({ type: 'Select' })
    expect(picker?.key).toBe(`mm-person:pick:${PRIYA}`)
    expect(picker?.props.options).toEqual([
      { value: 'none', label: 'Choose a project' },
      { value: ACME, label: 'Acme Roofing Pat' },
      { value: BOLT, label: 'Bolt Staffing (Sam)' },
    ])
    // nothing picked: Cancel alone, and the other rows keep their buttons
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(PRIYA))).toEqual([[`mm-person:cancel:${PRIYA}`, 'Cancel']])
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(DANA))).toEqual(personButtons(DANA))
    await ui.press({ key: `mm-person:cancel:${PRIYA}` })
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    expect(w.resolves).toEqual([])
    // again, a pick, and the route
    await ui.press({ key: `mm-person:route:${PRIYA}` })
    await ui.select({ key: `mm-person:pick:${PRIYA}`, value: BOLT })
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(PRIYA))).toEqual([
      [`mm-person:send:${PRIYA}`, 'Route to Bolt Staffing (Sam)'],
      [`mm-person:cancel:${PRIYA}`, 'Cancel'],
    ])
    expect(w.resolves).toEqual([])
    await ui.press({ key: `mm-person:send:${PRIYA}` })
    expect(w.resolves.map(r => r.body)).toEqual([{ alert_id: PRIYA, action: 'route', project_id: BOLT }])
    expect(await lines(ui)).toContain('Routed to Bolt Staffing (Sam). 2 emails filed.')
    expect(w.toasts).toContain('Routed to Bolt Staffing (Sam). 2 emails filed.')
    expect((await lines(ui)).some(l => l.startsWith('• Priya Raman'))).toBe(false)
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    await ui.unmount()
  })

  test('a pick that is not one of the projects offered routes nothing', async ($, on) => {
    const w = world(on, { feed: founderFeed() })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:route:${PRIYA}` })
    await ui.select({ key: `mm-person:pick:${PRIYA}`, value: 'none' })
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(PRIYA))).toEqual([[`mm-person:cancel:${PRIYA}`, 'Cancel']])
    expect(w.resolves).toEqual([])
    await ui.unmount()
  })

  test('OW refuses: the row stays and says what OW answered; no answer at all says so too; a later press that works clears it', async ($, on) => {
    let answer: { status: number; body?: unknown } | 'network' = { status: 409, body: { error: 'Alert already resolved by pm@example.com' } }
    const w = world(on, { feed: founderFeed(), resolve: () => answer })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:not_client:${DANA}` })
    let drawn = await lines(ui)
    expect(drawn).toContain("Couldn't mark it not client mail: Alert already resolved by pm@example.com (HTTP 409)")
    expect(drawn).toContain('New people (3)')
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(DANA))).toEqual(personButtons(DANA))
    expect(w.stored['mm.peopleDone']).toBeUndefined()
    answer = { status: 500, body: '<html>oops</html>' }
    await ui.press({ key: `mm-person:bootstrap:${DANA}` })
    expect(await lines(ui)).toContain("Couldn't start a project: HTTP 500")
    answer = 'network'
    await ui.press({ key: `mm-person:bootstrap:${DANA}` })
    expect((await lines(ui)).filter(l => l.startsWith("Couldn't start a project: ") && l.includes('socket hang up'))).toHaveLength(1)
    answer = { status: 200, body: { id: DANA, status: 'bootstrap_requested' } }
    await ui.press({ key: `mm-person:bootstrap:${DANA}` })
    drawn = await lines(ui)
    expect(drawn.some(l => l.startsWith("Couldn't"))).toBe(false)
    expect(drawn).toContain('New people (2)')
    expect(w.resolves.map(r => r.body.action)).toEqual(['not_client', 'bootstrap', 'bootstrap', 'bootstrap'])
    await ui.unmount()
  })

  test('the mobile app has no picker: it offers Start project and Not client mail, and says where Route is', async ($, on) => {
    world(on, { feed: founderFeed() })
    await mm($, '')
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'mobile', component: 'Pane', requestId: 'mm-queue', props: PANE })
    await ui.press({ key: PEOPLE })
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(DANA))).toEqual(personButtons(DANA).slice(1))
    // (not on Marcus's: a Directory lead is never routed, on any surface)
    expect((await lines(ui)).filter(l => l === 'Route to project is in the desktop app.')).toHaveLength(2)
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(MARCUS))).toEqual(directoryButtons(MARCUS))
    await ui.unmount()
  })

  test('a HighLevel Directory lead shows exactly Mark handled and Not client mail on every surface: never routed or started', async ($, on) => {
    const w = world(on, { feed: founderFeed({ person_alerts: [ALERTS[1]!] }) })
    await mm($, '')
    const opener = await pane($)
    await opener.press({ key: PEOPLE })
    await opener.unmount()
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      expect(await peopleButtons(ui)).toEqual([
        [`mm-person:handled:${MARCUS}`, 'Mark handled'],
        [`mm-person:not_client:${MARCUS}`, 'Not client mail'],
      ])
      expect(await ui.findAll({ type: 'Select' })).toEqual([])
      expect((await lines(ui)).some(l => l.startsWith('Route to project'))).toBe(false)
      await ui.unmount()
    }
    // the stored row says so
    expect(((w.stored['mm.last'] as { people?: Array<{ id: string; directory?: boolean }> }).people ?? []).map(p => [p.id, p.directory])).toEqual([[MARCUS, true]])
    // Mark handled sends `handled`, and the row leaves
    const ui = await pane($)
    await ui.press({ key: `mm-person:handled:${MARCUS}` })
    expect(w.resolves.map(r => r.body)).toEqual([{ alert_id: MARCUS, action: 'handled' }])
    expect(await lines(ui)).toContain('Marcus Lee marked handled.')
    expect((await lines(ui)).some(l => l.startsWith('New people'))).toBe(false)
    await ui.unmount()
  })

  test('Mark handled is a Directory lead\'s alone: an email\'s row has Route, Start project and Not client mail, never Mark handled', async ($, on) => {
    world(on, { feed: founderFeed() })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    const keys = (await peopleButtons(ui)).map(([k]) => k)
    expect(keys.filter(k => k.startsWith('mm-person:handled:'))).toEqual([`mm-person:handled:${MARCUS}`])
    expect(keys.filter(k => k.startsWith('mm-person:bootstrap:'))).toEqual([`mm-person:bootstrap:${PRIYA}`, `mm-person:bootstrap:${DANA}`])
    await ui.unmount()
  })

  test('Route\'s notice says how many emails OW filed: none (they may already be on it), one, or several', async ($, on) => {
    let filed = 0
    const w = world(on, { feed: founderFeed(), resolve: body => routed(filed)(body) })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    const route = async (id: string, projectId: string) => {
      await ui.press({ key: `mm-person:route:${id}` })
      await ui.select({ key: `mm-person:pick:${id}`, value: projectId })
      await ui.press({ key: `mm-person:send:${id}` })
    }
    await route(PRIYA, ACME)
    expect(await lines(ui)).toContain('Routed to Acme Roofing Pat. No emails were filed, they may already be on it.')
    filed = 1
    await route(DANA, BOLT)
    expect(await lines(ui)).toContain('Routed to Bolt Staffing (Sam). 1 email filed.')
    expect(w.resolves.map(r => r.body)).toEqual([
      { alert_id: PRIYA, action: 'route', project_id: ACME },
      { alert_id: DANA, action: 'route', project_id: BOLT },
    ])
    await ui.unmount()
  })

  test('the picker is the feed\'s route_projects when it gives them, all 150 selectable, a page of 50 at a time (a Select holds 64 options at most)', async ($, on) => {
    const many = routeProjects(150)
    const w = world(on, { feed: founderFeed({ route_projects: [...many].reverse() }), resolve: routed(3) })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:route:${PRIYA}` })
    const picker = async () => (await ui.find({ type: 'Select' }))?.props as { label: string; options: Array<{ value: string; label: string }>; value: string }
    const send = async () => (await peopleButtons(ui)).filter(([k]) => k === `mm-person:send:${PRIYA}`)
    // three pages, each well under the engine's 64 options, every project on one of them, by name, and none of
    // projects[] (Acme and Bolt are not route projects here)
    const seen: string[] = []
    const pages = [
      { label: 'Project (1 to 50 of 150)', prev: null, next: 'More: Client 051 to Client 100 ▸', items: many.slice(0, 50) },
      { label: 'Project (51 to 100 of 150)', prev: '◂ Earlier: Client 001 to Client 050', next: 'More: Client 101 to Client 150 ▸', items: many.slice(50, 100) },
      { label: 'Project (101 to 150 of 150)', prev: '◂ Earlier: Client 051 to Client 100', next: null, items: many.slice(100) },
    ]
    for (const [i, page] of pages.entries()) {
      const shown = await picker()
      expect(shown.label).toBe(page.label)
      expect(shown.options).toEqual([
        { value: 'none', label: 'Choose a project' },
        ...(page.prev ? [{ value: 'page-prev', label: page.prev }] : []),
        ...page.items.map(p => ({ value: p.id, label: p.name })),
        ...(page.next ? [{ value: 'page-next', label: page.next }] : []),
      ])
      expect(shown.options.length).toBeLessThanOrEqual(64)
      expect(shown.options.some(o => o.value === ACME || o.value === BOLT)).toBe(false)
      // each project on the page can be picked
      for (const p of page.items) {
        await ui.select({ key: `mm-person:pick:${PRIYA}`, value: p.id })
        expect(await send()).toEqual([[`mm-person:send:${PRIYA}`, `Route to ${p.name}`]])
        expect((await picker()).value).toBe(p.id)
        seen.push(p.id)
      }
      // on to the next page: what was picked goes
      if (i < pages.length - 1) {
        await ui.select({ key: `mm-person:pick:${PRIYA}`, value: 'page-next' })
        expect(await send()).toEqual([])
      }
    }
    expect(seen).toEqual(many.map(p => p.id))
    // and back
    await ui.select({ key: `mm-person:pick:${PRIYA}`, value: 'page-prev' })
    expect((await picker()).label).toBe('Project (51 to 100 of 150)')
    await ui.select({ key: `mm-person:pick:${PRIYA}`, value: 'page-next' })
    await ui.select({ key: `mm-person:pick:${PRIYA}`, value: many[149]!.id })
    expect(w.resolves).toEqual([])
    await ui.press({ key: `mm-person:send:${PRIYA}` })
    expect(w.resolves.map(r => r.body)).toEqual([{ alert_id: PRIYA, action: 'route', project_id: many[149]!.id }])
    expect(await lines(ui)).toContain('Routed to Client 150. 3 emails filed.')
    await ui.unmount()
  })

  test('a feed whose route_projects is empty offers nothing to route to, never projects[]', async ($, on) => {
    const w = world(on, { feed: founderFeed({ route_projects: [] }) })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: PEOPLE })
    await ui.press({ key: `mm-person:route:${PRIYA}` })
    expect(await ui.find({ type: 'Select' })).toBeUndefined()
    expect(await lines(ui)).toContain('No project in your feed to route to.')
    expect((await peopleButtons(ui)).filter(([k]) => k.endsWith(PRIYA))).toEqual([[`mm-person:cancel:${PRIYA}`, 'Cancel']])
    expect(w.resolves).toEqual([])
    await ui.unmount()
  })

  test('nothing of theirs reaches Claude: the mm tool and /mm say what they said before', async ($, on) => {
    world(on, { feed: founderFeed() })
    const said = await mm($, '')
    expect(said).not.toMatch(/Dana|Marcus|Priya|Northwind|Fabrikam/)
    expect(await tool($, '')).not.toMatch(/Dana|Marcus|Priya|Northwind|Fabrikam/)
    expect(await tool($, 'status')).not.toMatch(/Dana|Marcus|Priya|Northwind|Fabrikam/)
  })
})

// (0.5.28, internal asks) Rob, 2026-10-23: an internal ask "should show up in my brige thread for creg with my draft
// reply to him", and "there should be massmarket internal thread in bridge as well". OW's feed lists the caller's open
// asks (`asks`); the bridge lists each on its client's item, pins its thread on the ask's clock, shows the ask's page in
// the pane, and reads the feed again after a write to it. It sends and posts nothing.
describe('(0.5.28, internal asks) the bridge lists, pins and shows an internal ask, and a write to it resyncs', () => {
  const ASK = '5c1e2f3a-8b4d-4e6f-9a0b-1c2d3e4f5a6b'
  const OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const DUNE = '44444444-4444-4444-4444-444444444444'
  const PAGE_URL = `https://onboarding-wizard.massmarket.ai/api/ext/team-ask?id=${ASK}&format=pickup`
  const PAGE = '## Internal ask from Shezan: Dune Labs · Ask `none`\n\n**Due:** Tue 10/13 10:00 AM ET (24 business hours after the ask)\n\n### Your reply\nNo reply drafted yet.\n\nNothing to post yet: draft the reply, store it, then print this page again.'
  const askFor = (projectId: string, projectName: string, over: Partial<FeedAsk> = {}): FeedAsk => ({
    ask_id: ASK, project_id: projectId, project_name: projectName, internal: false, asker_name: 'Shezan', asker_email: 'shezan@example.com', asked_email: ME,
    asked_at: ago(1), due_at: new Date(NOW + 23 * HOUR).toISOString(), channel_name: 'mmai-it-support', message_link: 'https://discord.com/channels/1/2/3',
    snippet: 'Hey @Builder, which one should we use?', has_draft: false, draft_sha256: null, ...over,
  })
  const ASKS_PART = '### Internal asks (1)\n\n- Ask from Shezan · due Tue 10 AM\n  > Hey @Builder, which one should we use?'
  const page = () => ({ status: 200, body: { ok: true, markdown: PAGE, draft_sha256: null } })
  const notThePoller = { 'mm.lease': { owner: 'another-session', until: NOW + 24 * HOUR, version: VERSION } }
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ result?: unknown; deny?: string; isError?: boolean }>

  test('an ask for me on a client with a package: under This thread, the pickup view, then the ask\'s line, snippet and page', async ($, on) => {
    const w = world(on, { feed: feed({ asks: [askFor(ACME, 'Acme Roofing — Pat')] }), store: { 'mm.links': { [ACME]: SELF } }, teamAsk: page })
    await mm($, '')
    const ui = await pane($)
    expect((await lines(ui)).slice(0, 3)).toEqual(['This thread: Acme Roofing', CARD_NOT_DRAWN, 'Needs you now (3)'])
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`## Acme Roofing\n\n1. What the client sent\n\n${ASKS_PART}\n\n${PAGE}`)
    // the page is read in this thread's own session, after the package's
    expect(w.fetched.filter(u => u.includes('/team-ask'))).toEqual([PAGE_URL])
    // its row counts the ask ((0.7.5) on its second line, what its first does not say); nothing is sent, posted or started
    expect((await lines(ui)).filter(l => l.includes('internal ask'))).toEqual([`1 internal ask · ${SOON}`])
    expect(await under(ui, ACME_ROW)).toBe(`1 internal ask · ${SOON}`)
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  for (const [name, answer] of [
    ['OW answers 500', { status: 500, body: { error: 'boom' } }],
    ['no answer at all', 'network'],
    ['an answer with no markdown', { status: 200, body: { ok: true } }],
    ['an answer that is not JSON', { status: 200, body: 'not json' }],
  ] as Array<[string, { status: number; body?: unknown } | 'network']>) {
    test(`a page that cannot be read (${name}) leaves the ask's line and snippet alone: never an error in their place`, async ($, on) => {
      const w = world(on, { feed: feed({ asks: [askFor(ACME, 'Acme Roofing — Pat')] }), store: { 'mm.links': { [ACME]: SELF } }, teamAsk: () => answer })
      await mm($, '')
      const ui = await pane($)
      expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`## Acme Roofing\n\n1. What the client sent\n\n${ASKS_PART}`)
      expect(JSON.stringify(await lines(ui))).not.toMatch(/boom|500|socket|not json/)
      expect(w.fetched.filter(u => u.includes('/team-ask'))).toEqual([PAGE_URL])
      await ui.unmount()
    })
  }

  test('an ask alone lists its client, pins its linked thread on the ask\'s clock, and shows its page with no word of reply drafts', async ($, on) => {
    const w = world(on, { feed: feed({ asks: [askFor(DUNE, 'Dune Labs')] }), store: { 'mm.links': { [DUNE]: SELF } }, teamAsk: page })
    expect(await mm($, '')).toBe('4 clients need you; 1 thread pinned. The list is in the side pane.')
    expect(w.threads.get(SELF)).toMatchObject({ title: '🟡 23h left · Dune Labs · internal ask', pinned: true })
    const ui = await pane($)
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`## Dune Labs\n🟡 23h left · Dune Labs · internal ask\n\nThis thread ${SOON}.\n\n${ASKS_PART}\n\n${PAGE}`)
    expect((await ui.find({ type: 'Markdown' }))?.text).not.toContain('reply drafts')
    await ui.unmount()
  })

  test('an older feed without asks: the same list and the same client part as before, and no ask page is read', async ($, on) => {
    const w = world(on, { feed: feed(), store: { 'mm.links': { [ACME]: SELF } }, teamAsk: page })
    expect(await mm($, '')).toBe('3 clients need you; 1 thread pinned. The list is in the side pane.')
    const ui = await pane($)
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('## Acme Roofing\n\n1. What the client sent')
    expect(JSON.stringify(await lines(ui))).not.toContain('internal ask')
    expect(w.fetched.filter(u => u.includes('/team-ask'))).toEqual([])
    await ui.unmount()
  })

  test('the Massmarket internal thread pins on an internal ask\'s clock; the person\'s own pin on it is never taken off, the bridge\'s own comes off once the ask is answered (R18)', async ($, on) => {
    const onOps = feed({ asks: [askFor(OPS, 'Massmarket AI', { internal: true })] })
    // the person pinned it themselves
    const w = world(on, { feed: onOps, threads: [thread('local_ops', 'Massmarket ops', 1, { pinned: true })], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    await mm($, '')
    expect(w.threads.get('local_ops')).toMatchObject({ title: '🟡 23h left · Massmarket AI · internal ask', pinned: true })
    expect((w.stored['mm.pins'] as Record<string, unknown>)['local_ops']).toEqual({ projectId: OPS, client: 'Massmarket AI', byUs: false, internal: true })
    // answered: its pin stays, and it gets its own name back (R18)
    w.setFeed(feed())
    await mm($, '')
    expect(w.threads.get('local_ops')).toMatchObject({ title: 'Massmarket ops', pinned: true })
    expect(sends(w)).toEqual([])
  })

  test('the Massmarket internal thread, pinned by the bridge for an ask: its own pin comes off once the ask is answered', async ($, on) => {
    const w = world(on, { feed: feed({ asks: [askFor(OPS, 'Massmarket AI', { internal: true })] }), threads: [thread('local_ops', 'Massmarket ops', 1)], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    await mm($, '')
    expect(w.threads.get('local_ops')).toMatchObject({ title: '🟡 23h left · Massmarket AI · internal ask', pinned: true })
    w.setFeed(feed())
    await mm($, '')
    expect(w.threads.get('local_ops')).toMatchObject({ title: 'Massmarket ops', pinned: false })
  })

  test('the Massmarket internal thread is a normal link key: its kickoff\'s marker links the thread that opens with it', async ($, on) => {
    const w = world(on, { feed: feed({ asks: [askFor(OPS, 'Massmarket AI', { internal: true })] }) })
    await mm($, '')
    const kickoff = `[mm-link ${OPS}] Massmarket AI (OW project ${OPS}) has 1 internal ask(s) waiting on my reply. Load the client's project skill first.`
    await $.prompt.submit({ text: kickoff, wait: false, origin: { kind: 'composer' } })
    expect(w.stored['mm.links']).toEqual({ [OPS]: SELF })
  })

  test('the Massmarket internal thread with an open ask gets its chip like a client', async ($, on) => {
    const w = world(on, { feed: { member: ME, role: 'builder', mail: [], drafts: [], tickets: {}, asks: [askFor(OPS, 'Massmarket AI', { internal: true })] }, threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual(['Massmarket AI: reply to the internal ask'])
  })

  test('⛔ with no open ask it gets none, as before (L8): the founder\'s internal ticket due soon mints no chip; (0.7.4) a teammate\'s own one mints its chip', async ($, on) => {
    const opsTask = { ticket_id: 'ops-t1', project_id: OPS, project_name: 'Massmarket AI', title: 'Rotate the key', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME, internal: true }
    const w = world(on, { feed: { member: ME, role: 'founder', mail: [], drafts: [], tickets: { due_today: [opsTask] } }, threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual([])
  })

  test('(0.7.4) a teammate\'s own internal ticket due soon mints its chip, as a client\'s task does', async ($, on) => {
    // Rob, 2026-10-27: "this should show up just like any other client with a due date"
    const opsTask = { ticket_id: 'ops-t1', project_id: OPS, project_name: 'Massmarket AI', title: 'Rotate the key', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME, internal: true }
    const w = world(on, { feed: { member: ME, role: 'builder', mail: [], drafts: [], tickets: { due_today: [opsTask] } }, threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual(['Massmarket AI: work the internal task'])
  })

  const helper = 'node ~/.claude/skills/team-api-gateway/scripts/mm-api.mjs'
  for (const [name, command] of [
    ['its reply stored', `${helper} ext POST /team-ask/draft --body-file BODY-DO-NOT-KEEP.json`],
    ['its reply posted after the go', `${helper} ext POST /team-ask/post --body '{"id":"${ASK}","draft_sha256":"${'a'.repeat(64)}"}'`],
    ['the ask closed', `${helper} ext POST /team-ask/close --body '{"id":"${ASK}","reason":"answered on the call"}'`],
  ] as Array<[string, string]>) {
    test(`a write to an ask (${name}) is followed by one sync, a second after; nothing of the command is kept`, async ($, on) => {
      const w = world(on, { store: notThePoller })
      await tickOnce($, w)
      expect(closeouts(w)).toBe(0)
      const answer = await bash($, command)
      expect(w.shell).toEqual([command])
      expect(answer).toMatchObject({ result: { stdout: SHELL_OUT } })
      await w.clock.advance(999)
      expect(closeouts(w)).toBe(0)
      await w.clock.advance(1)
      expect(closeouts(w)).toBe(1)
      const kept = JSON.stringify([w.stored, w.written, w.appended, w.toasts, w.fetched, w.calls, w.prompts])
      for (const mark of ['BODY-DO-NOT-KEEP', SHELL_OUT, 'team-ask', 'answered on the call']) expect(kept.includes(mark), mark).toBe(false)
      expect(sends(w)).toEqual([])
      expect(w.prompts).toEqual([])
    })
  }

  test('a read of an ask\'s page is not a write: no request and no sync', async ($, on) => {
    const w = world(on, { store: notThePoller })
    await tickOnce($, w)
    await bash($, `${helper} ext GET "/team-ask?id=${ASK}&format=pickup"`)
    await w.clock.advance(30_000)
    expect(closeouts(w)).toBe(0)
    expect(w.stored['mm.ask']).toBeUndefined()
  })
})

// ======================================================================== 0.7.3: the internal queue
// Rob, 2026-10-27: "I should be assigned all those tickets. They should just be in a queue... for me to just handle in
// that thread as I can." OW's feed lists the caller's own internal-ops tickets with no committed date
// (`tickets.internal_queue`, ranked); the Massmarket internal thread gets its row, its chip in its linked thread and its
// updates, with the queue in rank order and no clock. A member with no queue sees no change.
describe('(0.7.3, internal queue) the Massmarket internal thread lists, chips and updates the viewer\'s queue, with no clock', () => {
  const OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
  const qt = (n: number, over: Partial<FeedQueueTicket> = {}): FeedQueueTicket => ({
    ticket_id: tid(n), project_id: OPS, project_name: 'Massmarket AI', title: `Ticket ${n}`, severity: 'high', internal: true, assignee_email: ME,
    queue_tier: 'now', queue_rank: n, queue_reason: `reason ${n}`, ...over,
  })
  // (0.7.4; Rob, 2026-10-27: "Mine is the only one that should work in a queue") the founder's feed: the only one it lists on
  const queueFeed = (rows: FeedQueueTicket[] = [qt(2), qt(1)], total = 40, role = 'founder'): Feed => ({ member: ME, role, mail: [], drafts: [], tickets: { internal_queue: rows }, summary: { internal_queue_total: total } })
  const QUEUE_PART = '### Internal queue (40 tickets, no due dates)\n\n1. now · Ticket 1 (ticket 00000001) · reason 1\n2. now · Ticket 2 (ticket 00000002) · reason 2\n\n38 more in the queue.'
  const QUEUE_KICKOFF = `[mm-link ${OPS}] Massmarket AI (OW project ${OPS}) has 40 ticket(s) in my internal queue, with no due dates. Load massmarket-internal-ops first, then show me the queue below as it stands now and wait for me to pick what to work on here.\n\nMy internal queue, in rank order (top 2 of 40, no due dates):\n1. now · Ticket 1 (ticket 00000001) · reason 1\n2. now · Ticket 2 (ticket 00000002) · reason 2\n38 more in the queue.`
  /** ⛔ (Rob, 10-13) Anything that reads as a clock or a due time. */
  const CLOCK = /\d+[hd] (?:late|left)|\bdue (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|today|tomorrow)|NO THREAD/
  const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
    for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
  }

  test('linked to this thread: its row, its name with no clock, never pinned by the bridge, and the queue in the pane', async ($, on) => {
    const w = world(on, { feed: queueFeed(), threads: [], store: { 'mm.links': { [OPS]: SELF } } })
    // (0.7.5) listed by the internal queue alone, it is not counted under Needs you now: it is `Your build queue`
    expect(await mm($, '')).toBe('Nothing needs you right now.')
    expect(w.threads.get(SELF)).toMatchObject({ title: '🟡 Massmarket AI · internal queue', pinned: false })
    const ui = await pane($)
    expect((await lines(ui)).slice(0, 2)).toEqual(['This thread: Massmarket AI', 'Nothing needs you right now.'])
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe(`## Massmarket AI\n🟡 Massmarket AI · internal queue\n\nThis thread ${SOON}.\n\n${QUEUE_PART}`)
    // (0.7.5) in the thread it points at, the client part above lists the queue: no row and no `Your build queue` part here
    expect((await lines(ui)).filter(l => l.includes('internal queue') || l.startsWith('Your build queue'))).toEqual([])
    expect(JSON.stringify(await lines(ui))).not.toMatch(CLOCK)
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })

  test('linked to this thread: its chip is minted here (Do it here), though it is never due', async ($, on) => {
    const w = world(on, { feed: queueFeed(), threads: [], store: { 'mm.links': { [OPS]: SELF } } })
    await tickOnce($, w)
    await after(w, 3)
    expect(chipTitles(w)).toEqual(['Do it here: Massmarket AI: work the internal queue'])
    expect(w.minted().at(-1)?.args.prompt).toBe(stepped(QUEUE_KICKOFF))
    expect(w.minted().at(-1)?.args.tldr).toBe('Massmarket AI needs you: Massmarket AI · internal queue. Recommended: Do it here.')
    expect(sends(w)).toEqual([])
  })

  test('⛔ with no linked thread it gets no chip (it is never due) and nothing is started or sent for it', async ($, on) => {
    const w = world(on, { feed: queueFeed(), threads: [] })
    await tickOnce($, w)
    await after(w, 12)
    expect(chipTitles(w)).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.acted().filter(c => c.tool === 'start_session')).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('linked to another thread: the queue goes there by itself once, with no clock; the total or a ticket below the top changes nothing; a new top ticket goes once more', LONG, async ($, on) => {
    const w = world(on, { feed: queueFeed(), threads: [thread('local_ops', 'Tracker', 30, { pinned: true })], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    await tickOnce($, w)
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_ops', markerFirst(`New since this thread last worked on this client: 40 tickets in the internal queue.\n${QUEUE_KICKOFF}`)]])
    expect(String(sends(w)[0]?.args.message)).not.toMatch(CLOCK)
    // its name says what it is, with no clock; the person's own pin stays (R18)
    expect(w.threads.get('local_ops')).toMatchObject({ title: '🟡 Massmarket AI · internal queue', pinned: true })
    // more tickets below the top: nothing new for the thread
    w.setFeed(queueFeed([qt(2), qt(1)], 41))
    await after(w, 20)
    expect(sends(w).length).toBe(1)
    // a ticket ranked to the top: something new, sent once it has been seen for 10 minutes
    w.setFeed(queueFeed([qt(2), qt(1), qt(3, { queue_rank: 0 })], 42))
    await after(w, 16)
    expect(sends(w).length).toBe(2)
    expect(String(sends(w)[1]?.args.message)).toContain('\n1. now · Ticket 3 (ticket 00000003) · reason 3\n')
    // the queue emptied: the thread gets its own name back and keeps the person's pin
    w.setFeed(queueFeed([], 0))
    await after(w, 6)
    expect(w.threads.get('local_ops')).toMatchObject({ title: 'Tracker', pinned: true })
    expect(sends(w).length).toBe(2)
  })

  test('/mm link Massmarket AI links this thread, as the feed names it by the queue', async ($, on) => {
    const w = world(on, { feed: queueFeed(), threads: [] })
    expect(await mm($, 'link Massmarket AI')).toBe('This thread is now Massmarket AI\'s. Showing Massmarket AI in the side pane.')
    expect(w.stored['mm.links']).toEqual({ [OPS]: SELF })
  })

  test('⛔ a queue that is not mine changes nothing: no row, no name, no chip, no update', async ($, on) => {
    const w = world(on, { feed: queueFeed([qt(1, { assignee_email: 'rob@massmarket.ai' })]), threads: [thread('local_ops', 'Ops notes', 30)], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    expect(await mm($, '')).toBe('Nothing needs you right now.')
    await after(w, 12)
    expect(chipTitles(w)).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.threads.get('local_ops')?.title).toBe('Ops notes')
  })

  test('⛔ (0.7.4) a queue on a feed that is not the founder\'s changes nothing, even rows that are the viewer\'s own', async ($, on) => {
    const w = world(on, { feed: queueFeed([qt(2), qt(1)], 40, 'builder'), threads: [thread('local_ops', 'Ops notes', 30)], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    expect(await mm($, '')).toBe('Nothing needs you right now.')
    await after(w, 12)
    expect(chipTitles(w)).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.threads.get('local_ops')?.title).toBe('Ops notes')
  })
})

// (0.7.4) Rob, 2026-10-27: "Team members need to provide ETAs, and this should show up just like any other client with a
// due date. They need to provide an ETA in 24 hours to me or to the system, and then it holds them accountable to that."
describe('(0.7.4) a teammate\'s internal ticket owes an ETA: listed with its clock, chipped and pinned as a client\'s; late, it reaches the founder', () => {
  const OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const TID = '0000e7a0-0000-4000-8000-000000000001'
  /** An ETA ask as OW #593 lists it: no due time or source, and when its ETA is needed by (here 1 PM ET, two hours ahead). */
  const etaRow = (over: Record<string, unknown> = {}) => ({
    ticket_id: TID, project_id: OPS, project_name: 'Massmarket AI', title: 'Fix the tracker export', due_at: null, due_source: null,
    assignee_email: ME, eta_needed_by: new Date(NOW + 2 * HOUR).toISOString(), eta_ask: '⏳ NO ETA — give one in Claude Code', ...over,
  })
  const mateFeed = (rows = [etaRow()]) => ({ member: ME, role: 'builder', mail: [], drafts: [], tickets: { due_today: rows } })

  test('no thread yet: its chip asks for the ETA, and its kickoff says how to record it; nothing is sent', async ($, on) => {
    const w = world(on, { feed: mateFeed(), threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual(['Massmarket AI: give your ETA'])
    const prompt = String(w.minted().at(-1)?.args.prompt)
    expect(prompt.startsWith(`[mm-link ${OPS}] Massmarket AI (OW project ${OPS}) has 1 ticket(s) of mine that need an ETA, the first needed by Mon, Oct 12 1 PM ET. Load massmarket-internal-ops first`)).toBe(true)
    expect(prompt).toContain('POST /api/ext/eta-commit with task_fingerprint "ticket:<its id>"')
    expect(prompt).toContain(`1. Fix the tracker export (ticket ${TID}) · ETA needed by Mon, Oct 12 1 PM ET`)
    expect(sends(w)).toEqual([])
  })

  test('linked to this thread: pinned on the ETA clock, named for it, and the pane lists the ticket under OW\'s words', async ($, on) => {
    const w = world(on, { feed: mateFeed(), threads: [], store: { 'mm.links': { [OPS]: SELF } } })
    await mm($, '')
    expect(w.threads.get(SELF)).toMatchObject({ title: '🔴 2h left · Massmarket AI · ETA needed', pinned: true })
    const ui = await pane($)
    const md = String((await ui.find({ type: 'Markdown' }))?.text)
    expect(md).toContain('### ⏳ NO ETA — give one in Claude Code\n\n- Fix the tracker export (ticket 0000e7a0) · ETA needed by ')
    expect(md).not.toContain('reply drafts')
    expect(sends(w)).toEqual([])
    await ui.unmount()
  })

  /** A teammate's ETA ask on a client's project, its ETA needed four hours ago. */
  const lateAsk = () => etaRow({ project_id: ACME, project_name: 'Acme Roofing — Pat', eta_needed_by: new Date(NOW - 4 * HOUR).toISOString() })

  test('for the founder: a teammate\'s ticket past when its ETA was needed: never pinned, chipped or sent; (0.7.27) off his page, on the 9 AM image, and counted by /mm status', async ($, on) => {
    const w = world(on, { feed: { member: FOUNDER, role: 'founder', mail: [], drafts: [], tickets: { overdue: [lateAsk()] } }, threads: [] })
    expect(await mm($, '')).toBe('Nothing needs you right now.')
    const ui = await pane($)
    // (0.7.21) not under With a teammate any more (0.7.5 to 0.7.20: `With a teammate (1)`, its row `🟡 Acme Roofing · no ETA
    // · with Builder A` and the note `Builder A owes an ETA on 1 internal ticket`). (0.7.21 to 0.7.26: under Team · late)
    expect((await buttons(ui)).filter(b => b[0].startsWith('mm-fold:'))).toEqual([])
    const all = await lines(ui)
    expect(all.some(l => l.includes('with Builder A') || l.includes('Team · late'))).toBe(false)
    await ui.unmount()
    expect(String(w.statuses.at(-1) ?? '')).toMatch(/^MM: clear(  |$)/)
    expect(await mm($, 'status')).toContain('late with the team: 1 (Builder A 1)')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('⛔ another teammate\'s feed never shows it', async ($, on) => {
    const w = world(on, { feed: { member: TEAMMATE_B, role: 'builder', mail: [], drafts: [], tickets: { overdue: [lateAsk()] } }, threads: [] })
    expect(await mm($, '')).toBe('Nothing needs you right now.')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual([])
  })
})

// (0.7.15) Rob, 2026-11-03: a released client's team post hands the build task to H9, "pinned in his bridge, with a clock
// to assign a teammate". OW lists it as a commitment whose `commitment_basis` is `assign_by` and prints no label for it.
describe('(0.7.15) a ticket on an `assign_by` clock: chipped, pinned and named as an owner to assign, never a delivery', () => {
  const TID = '0000a551-0000-4000-8000-000000000001'
  /** A ticket a team post handed the viewer to give an owner, its clock two hours ahead (1 PM ET). */
  const ownerRow = (over: Record<string, unknown> = {}) => ({
    ticket_id: TID, project_id: ACME, project_name: 'Acme Roofing — Pat', title: 'Build the booking page', due_at: new Date(NOW + 2 * HOUR).toISOString(),
    due_source: 'commitment', assignee_email: ME, commitment_basis: 'assign_by', ...over,
  })
  const pmFeed = (rows = [ownerRow()]) => ({ member: ME, role: 'pm', mail: [], drafts: [], tickets: { due_today: rows } })

  test('no thread yet: its chip asks for an owner, and its kickoff says to assign one in OW by the clock; nothing is sent', async ($, on) => {
    const w = world(on, { feed: pmFeed(), threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(chipTitles(w)).toEqual(['Acme Roofing: assign an owner'])
    const prompt = String(w.minted().at(-1)?.args.prompt)
    expect(prompt.startsWith(`[mm-link ${ACME}] Acme Roofing Pat (OW project ${ACME}) has 1 ticket(s) of mine that need an owner, the first by Mon, Oct 12 1 PM ET.`)).toBe(true)
    expect(prompt).toContain('The time on each is when it needs an owner in OW, not when the work is due.')
    expect(prompt).toContain(`1. Build the booking page (ticket ${TID}) · owner needed by Mon, Oct 12 1 PM ET`)
    expect(prompt).not.toContain('committed task')
    expect(sends(w)).toEqual([])
  })

  test('linked to this thread: pinned on the clock, named for an owner, and the pane lists it apart from committed dates', async ($, on) => {
    const w = world(on, { feed: pmFeed(), threads: [], store: { 'mm.links': { [ACME]: SELF } } })
    await mm($, '')
    expect(w.threads.get(SELF)).toMatchObject({ title: '🔴 2h left · Acme Roofing · assign an owner', pinned: true })
    const ui = await pane($)
    const md = String((await ui.find({ type: 'Markdown' }))?.text)
    expect(md).toContain('### Needs an owner: assign one in OW, or take it and give the ETA\n\n- Build the booking page (ticket 0000a551) · owner needed by ')
    expect(md).not.toContain('Due (dates we committed to)')
    expect(sends(w)).toEqual([])
    await ui.unmount()
  })

  test('⛔ any other basis is the committed task it always was', async ($, on) => {
    const w = world(on, { feed: pmFeed([ownerRow({ commitment_basis: 'eta_commit' })]), threads: [], store: { 'mm.links': { [ACME]: SELF } } })
    await mm($, '')
    expect(w.threads.get(SELF)).toMatchObject({ title: '🔴 2h left · Acme Roofing · task', pinned: true })
    const ui = await pane($)
    const md = String((await ui.find({ type: 'Markdown' }))?.text)
    expect(md).toContain('### Due (dates we committed to)\n- Build the booking page')
    expect(md).not.toContain('Needs an owner')
    await ui.unmount()
  })
})
