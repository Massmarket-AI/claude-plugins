// The bridge against a pretend desktop app, feed and store. This file tests a client's thread updated by itself
// (0.5.11), time tracking and quote lines (0.6.0 to 0.7.1), one thread per client, profile switches and pins (0.7.5 to
// 0.7.23), and the reply-package card, Team now and top-level threads (0.7.26 to 0.7.44).
//
// Moved here from register.test.ts on 2026-11-11. Why it is two files: the top of register-world.test-helper.ts, which
// holds the world and helpers the two share.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Feed, FeedQueueTicket, FeedTicket } from './queue'
import { buildLists, cleanTitle, clockText } from './queue'
import { NEXT_LABEL, NEXT_PAGE, NEXT_SHA, NEXT_TREE, SMS_PAGE, SMS_TREE } from './card-fixture.test-helper'
import { CARD_PAIRS } from './card-pairs.test-helper'
import { VERSION } from './register'
import { DETACH_SELF_NOTE, TOP_LEVEL_STEP, carryKickoff, freshParagraph, lookupOrder, packageArrived, pinReport, readyPackages, signatureOf } from './threads'
import type { PinReport } from './threads'
import { localClock } from './track'
import type { Thread, Call, WorldOptions, Drawing, Kick } from './register-world.test-helper'
import {
  NOW, HOUR, ago, LONG, ACME, BOLT, CEDAR, ME, SELF, SELF_CLI, PKG, CARD_NOT_DRAWN, thread, feed, world, sends,
  threadWrites, BAND_PROPS, PANE, mm, pane, lines, buttons, ACME_TITLE, BOLT_TITLE, CEDAR_TITLE, inOldWords, stepped,
  ACME_KICKOFF, ACME_NAMED, CEDAR_KICKOFF, CEDAR_FRESH, UPDATED, SOON, NOT_TAKEN, BOLT_AUTO_UPDATE, markerFirst,
  ACME_SHOWN, PAIRS, declared, tool, bandOf, buttonsOf, under, acmeFeed, acmeWorld, FOUNDER, TEAMMATE_B, packageFor,
  heldBy, mailFor, ourPin, tickOnce, closeouts, starts, proposals, cedarAlone, START_ALL, kicksIn, kickoffsOf,
  sessionCalls, INTERNAL, skillsOk, TASK, clientTimeBody, param, byPeriods, timeOk, periodsAsked, idsAsked, HEAD,
  TODAY_LINE, PAT_ROW, NUMBERS, LEVERAGE, NOTE_LINE, TRACKED, openTrack, trackHead, trackPart, onlyReads, skill,
  person, tree, L_COPY, L_ROUTER, L_SITE, L_BANK, QUOTE_LINES, PROPOSAL, ON_LINE, NEW_SCOPE, UNMATCHED, PROPOSED,
  linesBody, linesOk, linedWorld, started, notes, ASK_NOTE, bandLines, lineButtons, proof, lastStatus, settledOk,
  proposalOk, RUN_SPANISH, WHY, PROFILES_ROOT, PROFILE_A, PROFILE_B, profileRec, minutesOn, awayLine, DAYS,
} from './register-world.test-helper'

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

  test('Update\'s own message goes once, by itself, into the client\'s linked thread, (review of PR #15, F3) 10 minutes after this bridge first saw it; never twice; something new goes once more, 10 minutes after it is first seen', LONG, async ($, on) => {
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
    test(`⛔ never ${name}`, LONG, async ($, on) => {
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
  test('⛔ (review of PR #15, F2) [P3] the thread is made another client\'s while the update reads the app and the feed: nothing is sent into it, on record as not sent', LONG, async ($, on) => {
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

  test('⛔ another session\'s claim since: that session sends it, this one does not; a claim that lapsed is taken again at the next sync, and it goes once', LONG, async ($, on) => {
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

  test('the hour\'s cap: twelve in the last hour on this computer; past it nothing goes (logged once), and it goes once the hour has passed', LONG, async ($, on) => {
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

  test('the day\'s cap: forty in the last day, none of them in the last hour: nothing goes', LONG, async ($, on) => {
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

  test('a send the thread does not take: recorded and logged with why, and not tried again for the same thing', LONG, async ($, on) => {
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

  test('⛔ (review of PR #15, F5) case 1, a package the person holds, mid-reply in its thread: nothing goes while they are in it', LONG, async ($, on) => {
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
    test(`⛔ (review of PR #15, F4) a time-tracking hook that ${hook === 'old' ? 'counts every turn as the person\'s (0.11.4 and before)' : 'cannot be read'}: nothing is sent by itself, logged once; read again at most every 10 minutes`, LONG, async ($, on) => {
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

  test('/mm auto off: nothing is sent; /mm auto on: sent 10 minutes after the first sync that sees it, once', LONG, async ($, on) => {
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

describe('0.6.0: a skill load makes a thread its client\'s, as the primary only when the client has none', () => {
  test('a skill for a client with no thread: this thread becomes its primary through R1\'s path, is pinned and named, and its pane opens', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.stored['mm.links']).toEqual({})
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    // the bridge's own link (R1's path): the note waits for the person's act
    expect(w.stored['mm.auto']).toEqual({ [ACME]: { sid: SELF, miss: 0, made: NOW + 4_000 } })
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'skill' })
    // the sync it asked for pinned and named it
    expect(w.threads.get(SELF)?.title).toMatch(ACME_NAMED)
    expect(w.threads.get(SELF)?.pinned).toBe(true)
    expect(w.opened).toEqual([{ id: 'mm-queue', title: 'Acme Roofing' }])
    expect(w.appended).toEqual([])
    expect(onlyReads(w)).toBe(true)
  })

  test('a plugin-qualified name (plugin:skill) counts as the skill; a subagent\'s load, a refused load and an unknown skill do not', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'acme-roofing-project', { agentId: 'agent_1' }).catch(() => undefined)
    await skill($, 'no-such-client-project')
    await w.clock.advance(2_000)
    expect(w.stored['mm.current']).toBeUndefined()
    await skill($, 'massmarket:acme-roofing-project')
    await w.clock.advance(2_000)
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
  })

  test('a skill for a client another thread holds: a second thread. The primary keeps everything; this thread is never pinned or renamed', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, threads: [thread('local_a', 'Roof quote', 2)], store: { 'mm.links': { [ACME]: 'local_a' } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const primaryTitle = w.threads.get('local_a')?.title as string
    expect(primaryTitle).toMatch(ACME_NAMED)
    await skill($, 'acme-roofing-project')
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a' })
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'skill' })
    expect(w.threads.get(SELF)).toMatchObject({ title: 'Morning hub', pinned: false })
    expect(threadWrites(w).filter(x => x.includes(SELF))).toEqual([])
    // its pane: the second thread's line, the client part, the Tracking part, and no note, no pickup
    // (0.7.5) the second thread's line first; the Tracking part at the bottom, closed to its one line until pressed
    expect(w.opened).toEqual([{ id: 'mm-queue', title: 'Acme Roofing' }])
    const ui = await pane($)
    const all = await lines(ui)
    expect(all.slice(0, 2)).toEqual([
      `This is a second thread for Acme Roofing. The reply package is picked up in "${primaryTitle}".`,
      'This thread: Acme Roofing',
    ])
    expect(await trackHead(ui)).toBe('⏱ This thread: Acme Roofing · no task declared yet  ▸')
    await openTrack(ui)
    expect(await lines(ui)).toContain('Time numbers are not available yet.')
    await ui.unmount()
    expect(w.appended).toEqual([])
    expect(onlyReads(w)).toBe(true)
    expect(sends(w)).toEqual([])
    expect(await mm($, 'status')).toContain('current threads: 2 on 1 projects · second threads: 1')
  })

  test('a hub thread that declared one client is never made another client\'s primary by a skill load', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, threads: [thread('local_b', 'Staffing plan', 3)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'bolt-staffing-project')
    await w.clock.advance(1_000)
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    // Acme has no thread, and still has none: this thread declared Bolt too
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_b' })
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'skill', declared: [BOLT, ACME] })
  })

  test('a thread whose marker named another client is never made a client\'s primary by a skill load either', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, store: { 'mm.marked': { [SELF]: BOLT } } })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    expect(w.stored['mm.links'] ?? {}).toEqual({})
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'skill' })
  })

  test('Massmarket\'s own skills set the thread\'s project for the pane and the time, and never link, pin or name anything', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'massmarket-internal-ops')
    await w.clock.advance(2_000)
    expect(w.stored['mm.links']).toEqual({})
    expect(w.opened).toEqual([{ id: 'mm-queue', title: 'Massmarket internal' }])
    await skill($, 'massmarket-self-funnel')
    await w.clock.advance(2_000)
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Massmarket sales and marketing' })
    expect(w.stored['mm.links']).toEqual({})
    const ui = await pane($)
    // (0.7.5) the Tracking part's one line, a button at the bottom of the pane
    expect(await trackHead(ui)).toBe('⏱ This thread: Massmarket sales and marketing · no task declared yet  ▸')
    // no client part in Massmarket's own thread
    expect(await lines(ui)).not.toContain('This thread: Acme Roofing')
    await ui.unmount()
  })
})

describe('0.6.0: a marker kickoff, R1b and /mm unlink with second threads', () => {
  test('a marker for a client another thread holds: this thread is a second thread, told so in the verbatim sentence with the client\'s skill', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, threads: [thread('local_a', 'Roof quote', 2)], store: { 'mm.links': { [ACME]: 'local_a' } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    // a session with no skill map reads it once (here, on a skill load: Massmarket's own, which links nothing)
    await skill($, 'massmarket-internal-ops')
    await w.clock.advance(1_000)
    // the name as a sentence to Claude carries it: cleaned to one plain line
    const primaryTitle = cleanTitle(w.threads.get('local_a')?.title)
    expect(primaryTitle).toBe('21h left Acme Roofing reply ready')
    await person($, ACME_KICKOFF)
    await w.clock.advance(100)
    expect(w.prompts.at(-1)?.text).toBe(
      `${ACME_KICKOFF}\n\nAnother thread of yours already holds Acme Roofing's reply package ("${primaryTitle}"). Do not run prep and do not pick up the package here. This thread stays linked to Acme Roofing as a second thread: load the acme-roofing-project skill and then wait for the person.`,
    )
    expect(w.stored['mm.links']).toMatchObject({ [ACME]: 'local_a' })
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'marker' })
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Acme Roofing' })
  })

  test('R1b moves a client to its newer thread: the old primary keeps its current project and is a second thread from then on, unpinned with its own name back', async ($, on) => {
    const w = world(on, {
      feed: feed({ threads: [declared(ACME, 'cli-old', 70), declared(ACME, 'cli-new', 1)] }),
      threads: [thread('local_old', ACME_TITLE, 70, { pinned: true }), thread('local_new', 'Acme resume', 1)],
      store: {
        'mm.threads': { 'cli-old': { app: 'local_old', at: NOW - 72 * HOUR, since: NOW - 72 * HOUR }, 'cli-new': { app: 'local_new', at: NOW - HOUR, since: NOW - HOUR } },
        'mm.links': { [ACME]: 'local_old' },
        'mm.auto': { [ACME]: { sid: 'local_old', miss: 0, made: NOW - 2 * HOUR } },
        'mm.titles': { local_old: 'Roof quote' },
        'mm.pins': { local_old: { projectId: ACME, client: 'Acme Roofing', byUs: true } },
      },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_new' })
    expect(w.threads.get('local_old')).toMatchObject({ title: 'Roof quote', pinned: false })
    const current = w.stored['mm.current'] as Record<string, { pid: string }>
    expect(current.local_old?.pid).toBe(ACME)
    expect(current.local_new?.pid).toBe(ACME)
    expect(await mm($, 'status')).toContain('current threads: 2 on 1 projects · second threads: 1')
    // nothing releases it for being second: a sync later it is still Acme's
    await mm($, '')
    expect((w.stored['mm.current'] as Record<string, { pid: string }>).local_old?.pid).toBe(ACME)
    expect(w.threads.get('local_old')).toMatchObject({ title: 'Roof quote', pinned: false })
  })

  test('/mm unlink clears the thread\'s current project; /mm link sets it', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toBeDefined()
    await mm($, 'unlink')
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toBeUndefined()
    await mm($, 'link Bolt Staffing')
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: BOLT, how: 'link' })
  })
})

describe('0.6.0: the task the time-tracking hook was given', () => {
  test('--task "<label>" and --task=<label> set this thread\'s task; one declared before the project goes with the first project', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await $.tool.call({ tool: 'Bash', command: `node ~/.claude/mm-hooks/worklog-hook.js --task "${TASK}"` } as never)
    expect(w.stored['mm.current']).toBeUndefined()
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, task: TASK })
    await $.tool.call({ tool: 'Bash', command: 'node "$HOME/.claude/mm-hooks/worklog-hook.js" --task=f779a7a0-fix' } as never)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, task: 'f779a7a0-fix' })
    const ui = await pane($)
    // (0.7.5) the Tracking part's one line, a button at the bottom of the pane
    expect(await trackHead(ui)).toBe('⏱ This thread: Acme Roofing · f779a7a0-fix  ▸')
    await ui.unmount()
    // a command that only mentions it does nothing
    await $.tool.call({ tool: 'Bash', command: 'grep -n "--task" notes.txt' } as never)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ task: 'f779a7a0-fix' })
  })
})

describe('0.6.0: the pane opens by itself for the thread\'s current project, and the person\'s close holds', () => {
  const linked = (on: On, over: WorldOptions = {}) => world(on, { skillMap: skillsOk, store: { 'mm.links': { [ACME]: SELF } }, ...over })

  test('it opens at session start and again on each surface that attaches, and for each new project', async ($, on) => {
    const w = linked(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.opened.length).toBeGreaterThan(0)
    expect(w.opened.every(o => o.id === 'mm-queue')).toBe(true)
    const before = w.opened.length
    await $.session.attach({ surface: 'mobile', clientId: 'mobile:phone' })
    await w.clock.advance(100)
    expect(w.opened.length).toBe(before + 1)
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Acme Roofing' })
    // the timer alone opens nothing more for the same project
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(w.opened.length).toBe(before + 1)
    // another project: it opens for that one
    await skill($, 'bolt-staffing-project')
    await w.clock.advance(2_000)
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Bolt Staffing' })
    // (the person's close, which the test kit cannot raise, is held by \`opensBySelf\` and \`afterPersonClose\`: track.test.ts)
    expect(onlyReads(w)).toBe(true)
  })

  test('opening and drawing it read only: the pickup view, never a pickup, a hold or a claim, and no note', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), threads: [thread('local_a', 'Roof quote', 2)], store: { 'mm.links': { [ACME]: 'local_a' } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'acme-roofing-project')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(w.opened).toEqual([{ id: 'mm-queue', title: 'Acme Roofing' }])
    expect(onlyReads(w)).toBe(true)
    expect(w.fetched.some(u => u.includes('/reply-package?') && u.endsWith('&format=pickup'))).toBe(true)
    expect(w.appended).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.stored['mm.acted']).toBeUndefined()
  })

  test('never by itself with MM_UNATTENDED=1, or in a session whose first prompt begins SINGLE-SESSION', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'acme-roofing-project')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME })
    expect(w.opened).toEqual([])
  })

  test('SINGLE-SESSION: no pane by itself for the rest of the session', async ($, on) => {
    const w = world(on, { skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await $.prompt.submit({ text: 'SINGLE-SESSION reconcile one client', wait: false, origin: { kind: 'sdk' } })
    await skill($, 'acme-roofing-project')
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(w.opened).toEqual([])
  })

  test('SINGLE-SESSION as the first prompt after the pane opened by itself: the bridge closes it again (its own close)', async ($, on) => {
    const w = linked(on)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Acme Roofing' })
    await $.prompt.submit({ text: 'SINGLE-SESSION reconcile one client', wait: false, origin: { kind: 'sdk' } })
    expect(w.closes).toEqual([{ id: 'mm-queue', origin: 'plugin' }])
    const opened = w.opened.length
    await $.session.attach({ surface: 'mobile', clientId: 'mobile:phone' })
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(w.opened.length).toBe(opened)
  })

  test('a terminal session opens it too, at its project; a run nobody watches (claude -p) tracks nothing', async ($, on) => {
    const w = world(on, { terminal: true, skillMap: skillsOk, clientTime: timeOk() })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(100)
    expect(w.opened).toEqual([{ id: 'mm-queue', title: 'Acme Roofing' }])
    expect((w.stored['mm.current'] as Record<string, unknown>)[`cli:${SELF_CLI}`]).toMatchObject({ pid: ACME, how: 'skill' })
    // no link in a terminal session: there is no app thread to link
    expect(w.stored['mm.links']).toBeUndefined()
    // its own project's time, read at once (no timer or poller here)
    expect(w.fetched.filter(u => u.includes('/client-time'))).toEqual([`https://onboarding-wizard.massmarket.ai/api/ext/client-time?project_ids=${ACME}&periods=today,week&with=lines`])
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'terminal', component: 'Pane', requestId: 'mm-queue', props: PANE })
    // (0.7.5) the Tracking part closed to its one line (a button) with this thread's minutes; opened, today's numbers
    expect(await trackHead(ui)).toBe(`${HEAD(undefined)}  ▸`)
    await openTrack(ui)
    expect(await lines(ui)).toContain(TODAY_LINE)
    await ui.unmount()
  })

  test('a run nobody watches: no tracking at all', async ($, on) => {
    const w = world(on, { terminal: true, skillMap: skillsOk, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', HOME: '/home/someone' } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(100)
    expect(w.stored['mm.current']).toBeUndefined()
    expect(w.opened).toEqual([])
    expect(w.fetched).toEqual([])
  })
})

describe('0.6.0: the time numbers are read sparingly', () => {
  test('a thread whose project was just set waits 15 seconds, and a change meanwhile starts the wait again', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), store: { 'mm.lease': { owner: 'someone-else', until: NOW + 10 * HOUR, version: VERSION } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await skill($, 'acme-roofing-project')
    await w.clock.advance(5_000)
    await skill($, 'bolt-staffing-project')
    await w.clock.advance(14_000)
    expect(w.fetched.filter(u => u.includes('/client-time'))).toEqual([])
    await w.clock.advance(2_000)
    expect(w.fetched.filter(u => u.includes('/client-time'))).toEqual([`https://onboarding-wizard.massmarket.ai/api/ext/client-time?project_ids=${BOLT}&periods=today,week&with=lines`])
  })

  test('once a minute per project on this computer, and not again while the numbers are under 2 minutes old', async ($, on) => {
    const w = world(on, { terminal: true, skillMap: skillsOk, clientTime: timeOk(), store: { 'mm.timeAsked': { [ACME]: NOW - 30_000 } } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(100)
    // another thread here asked for Acme 30 seconds ago
    expect(w.fetched.filter(u => u.includes('/client-time'))).toEqual([])
    await w.clock.advance(3 * 60_000)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await w.clock.advance(100)
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBe(1)
    // a turn a minute later: the numbers are fresh, and the terminal reads at most every 2 minutes
    await w.clock.advance(60_000)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await w.clock.advance(100)
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBe(1)
  })

  test('a 404 (an OW without the route yet): not asked again for 30 minutes, and the pane says the numbers are not available yet', async ($, on) => {
    const w = world(on, { terminal: true, skillMap: skillsOk })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(100)
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBe(1)
    for (let i = 0; i < 5; i++) {
      await w.clock.advance(3 * 60_000)
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
      await w.clock.advance(100)
    }
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBe(1)
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'terminal', component: 'Pane', requestId: 'mm-queue', props: PANE })
    // (0.7.5) the Tracking part closed to its one line (a button); opened, the line under it
    expect(await trackHead(ui)).toBe('⏱ This thread: Acme Roofing · no task declared yet  ▸')
    await openTrack(ui)
    expect(await lines(ui)).toContain('Time numbers are not available yet.')
    await ui.unmount()
    await w.clock.advance(20 * 60_000)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await w.clock.advance(100)
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBe(2)
  })

  test('the thread that polls reads the projects of this computer\'s threads in one call after each sync', LONG, async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), threads: [thread('local_b', 'Staffing plan', 3)], store: { 'mm.links': { [ACME]: SELF, [BOLT]: 'local_b' } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const reads = w.fetched.filter(u => u.includes('/client-time'))
    expect(reads.length).toBe(1)
    expect(idsAsked(reads[0])).toEqual(new Set([ACME, BOLT]))
    // the skill map, at most hourly
    expect(w.fetched.filter(u => u.endsWith('/skill-map')).length).toBe(1)
    for (let i = 0; i < 30; i++) await w.clock.advance(60_000)
    expect(w.fetched.filter(u => u.endsWith('/skill-map')).length).toBe(1)
    expect(w.fetched.filter(u => u.includes('/client-time')).length).toBeGreaterThan(1)
  })
})

describe('0.6.0 (OW contract 2026-10-25): today on every read, the week at most every 30 minutes, at most 15 projects', () => {
  test('a project\'s first read asks for today and the week; the syncs after it today alone, until its week is 30 minutes old', LONG, async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), store: { 'mm.links': { [ACME]: SELF } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(periodsAsked(w)).toEqual(['today,week'])
    // the next syncs (every 5 minutes): today alone
    for (let i = 0; i < 20; i++) await w.clock.advance(60_000)
    const asked = periodsAsked(w)
    expect(asked.length).toBeGreaterThan(2)
    expect(asked.slice(1).every(x => x === 'today')).toBe(true)
    // a today-only answer keeps the week and the leverage last read, each with its own as-of
    const rec = (w.stored['mm.time'] as Record<string, { at: number; weekAt: number; asOf: string; weekAsOf: string; p: { week: unknown; leverage: unknown } }>)[ACME]
    expect(rec?.p.week).not.toBeNull()
    expect(rec?.p.leverage).not.toBeNull()
    expect(rec && rec.at > rec.weekAt).toBe(true)
    expect(typeof rec?.weekAsOf).toBe('string')
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-queue', props: PANE })
    // (0.7.5) the week and the leverage are behind the Tracking part's More
    await openTrack(ui, true)
    const shown = await lines(ui)
    expect(shown).toContain(NUMBERS[0])
    expect(shown).toContain(LEVERAGE)
    await ui.unmount()
    // 30 minutes after the week was read, the next sync asks for it again
    for (let i = 0; i < 12; i++) await w.clock.advance(60_000)
    expect(periodsAsked(w).slice(asked.length)).toContain('today,week')
  })

  test('two projects, one with its week due: two calls, the week asked for that one alone', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), threads: [thread('local_b', 'Staffing plan', 3)], store: { 'mm.links': { [ACME]: SELF, [BOLT]: 'local_b' }, 'mm.time': { [ACME]: { at: NOW - 60_000, weekAt: NOW - 60_000, asOf: '', p: clientTimeBody(true).projects[0] } } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const reads = w.fetched.filter(u => u.includes('/client-time'))
    expect(reads.length).toBe(2)
    expect(reads.map(u => param(u, 'periods'))).toEqual(['today,week', 'today'])
    expect(idsAsked(reads[0])).toEqual(new Set([BOLT]))
    expect(idsAsked(reads[1])).toEqual(new Set([ACME]))
  })

  test('a week never read (null) is not loaded: no This week line, never zeros', async ($, on) => {
    const w = world(on, { terminal: true, skillMap: skillsOk, clientTime: () => ({ status: 200, body: clientTimeBody(true, { week: null, leverage: null }) }) })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await skill($, 'acme-roofing-project')
    await w.clock.advance(100)
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'terminal', component: 'Pane', requestId: 'mm-queue', props: PANE })
    // (0.7.5) opened, More too: where the week would be
    await openTrack(ui, true)
    const shown = await lines(ui)
    expect(shown).toContain(TODAY_LINE)
    expect(shown.some(l => l.startsWith('This week'))).toBe(false)
    expect(shown.some(l => l.startsWith('Leverage'))).toBe(false)
    await ui.unmount()
  })

  test('the thread that polls reads at most 15 projects: threads active in the last 2 days first, then up to 7 days', async ($, on) => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    const current: Record<string, unknown> = {}
    // ten active in the last 2 days, ten 3 to 5 days ago, two 8 days ago (too old)
    for (let n = 0; n < 10; n++) current[`cli:hot${n}`] = { pid: id(n), how: 'skill', at: NOW - (n + 1) * HOUR }
    for (let n = 10; n < 20; n++) current[`cli:warm${n}`] = { pid: id(n), how: 'skill', at: NOW - 3 * 24 * HOUR - (n - 10) * 5 * HOUR }
    for (let n = 20; n < 22; n++) current[`cli:old${n}`] = { pid: id(n), how: 'skill', at: NOW - 8 * 24 * HOUR }
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk(), store: { 'mm.current': current } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const reads = w.fetched.filter(u => u.includes('/client-time'))
    expect(reads.length).toBe(1)
    expect(idsAsked(reads[0])).toEqual(new Set([...Array.from({ length: 10 }, (_, n) => id(n)), id(10), id(11), id(12), id(13), id(14)]))
  })
})

describe('0.6.0: the Tracking part, as the spec words it', () => {
  const tracked = (on: On, canSee: boolean, over: WorldOptions = {}) =>
    world(on, {
      skillMap: skillsOk,
      clientTime: timeOk(canSee),
      threads: [thread('local_pat', 'Pat on Acme', 1)],
      store: { 'mm.links': { [ACME]: SELF }, 'mm.threads': { 'cli-pat': { app: 'local_pat', at: NOW } }, 'mm.current': { [SELF]: { pid: ACME, how: 'skill', at: NOW - 60_000, task: TASK } } },
      ...over,
    })

  for (const surface of ['desktop', 'terminal'] as const) {
    test(`the whole of it, with leverage for a viewer who may see it (${surface})`, async ($, on) => {
      const w = tracked(on, true)
      await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
      await w.clock.advance(4_000)
      const ui = await $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
      // (0.7.5) at the bottom of the pane, opened and its More opened; the pane's one clock under it
      await openTrack(ui, true)
      const drawn = await tree(ui)
      expect(trackPart(drawn)).toEqual(TRACKED(TASK))
      expect(drawn.at(-1)).toBe(`(dim) Updated ${localClock(NOW)}`)
      // Pat's thread is on this computer: its row is a button that opens it
      expect((await buttons(ui)).some(([key, label]) => key.startsWith('mm-track-open:') && label === PAT_ROW)).toBe(true)
      await ui.unmount()
    })
  }

  test('a viewer who may not see leverage: no leverage line', async ($, on) => {
    const w = tracked(on, false)
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const ui = await pane($)
    // (0.7.5) opened, More too: the further numbers and the note, with no leverage between them
    await openTrack(ui, true)
    const all = await lines(ui)
    expect(all.some(l => l.startsWith('Leverage'))).toBe(false)
    expect(trackPart(await tree(ui))).toEqual(TRACKED(TASK, false))
    await ui.unmount()
  })

  test('leverage with no ratio: its note', async ($, on) => {
    const w = tracked(on, true, { clientTime: () => ({ status: 200, body: clientTimeBody(true, { leverage: { ratio: null, build_hours: 0, actual_hours: 0, window: 'last 20 business days', note: 'No quoted hours in the last 20 business days.' } }) }) })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const ui = await pane($)
    // (0.7.5) behind the Tracking part's More
    await openTrack(ui, true)
    expect(await lines(ui)).toContain('Leverage: No quoted hours in the last 20 business days.')
    await ui.unmount()
  })

  test('nothing tracked yet today, and this thread not in the numbers yet', async ($, on) => {
    const zero = { client_minutes: 0, by_source: { claude_code: 0, timer: 0, browser: 0, meeting: 0 }, thread_minutes: 0, parallel: null, jarvis_minutes: 0, people: [], tasks: [] }
    const w = tracked(on, true, { clientTime: () => ({ status: 200, body: clientTimeBody(true, { today: zero, week: zero, threads: [], leverage: null }) }) })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const ui = await pane($)
    // (0.7.5) its one line says this thread is not counted yet; opened (More too), the plain numbers at zero
    await openTrack(ui, true)
    expect(trackPart(await tree(ui))).toEqual([
      `[⏱ This thread: Acme Roofing · ${TASK} · not counted yet  ▾]`,
      'Today: 0.0 h of your time · 0.0 h of thread time',
      '(dim) Nothing tracked to Acme Roofing yet today.',
      '[More  ▾]',
      'This week: 0.0 h of your time · 0.0 h of thread time',
      'Jarvis: 0.0 h today · 0.0 h this week',
      `(dim) ${NOTE_LINE}`,
    ])
    await ui.unmount()
  })

  test('a read that failed after one that worked: the last numbers, marked', async ($, on) => {
    let fail = false
    const w = tracked(on, true, { clientTime: () => (fail ? { status: 500, body: { error: 'boom' } } : { status: 200, body: clientTimeBody(true) }) })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    fail = true
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    const ui = await pane($)
    // (0.7.5) opened: the last numbers, and the line that says they are from the last read that worked
    await openTrack(ui)
    const all = await lines(ui)
    expect(all).toContain(`Could not refresh; these numbers are from ${localClock(NOW)}.`)
    expect(await trackHead(ui)).toBe(`${HEAD(TASK)}  ▾`)
    expect(all).toContain(TODAY_LINE)
    await ui.unmount()
  })

  for (const canSee of [true, false]) {
    test(`[render proof] the pane as drawn on the desktop, can_see_leverage ${canSee}`, async ($, on) => {
      const w = tracked(on, canSee)
      await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
      await w.clock.advance(4_000)
      const ui = await pane($)
      // (0.7.5) the Tracking part opened, More too
      await openTrack(ui, true)
      const drawn = await tree(ui)
      ;(globalThis as unknown as { console?: { log: (s: string) => void } }).console?.log(`RENDER-PROOF can_see_leverage=${canSee}\n${drawn.join('\n')}\nEND-RENDER-PROOF`)
      expect(drawn.includes(LEVERAGE)).toBe(canSee)
      expect(drawn.includes(`[${PAT_ROW}]`)).toBe(true)
      await ui.unmount()
    })
  }
})

describe('0.6.0: the status line and the band say whether the thread is counted', () => {
  test('the status line in each state', async ($, on) => {
    const w = world(on, { skillMap: skillsOk, clientTime: timeOk() })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const last = () => String(w.statuses.at(-1) ?? '')
    expect(last()).not.toContain('⏱')
    await person($, 'look at this')
    await person($, 'and this')
    await w.clock.advance(100)
    expect(last()).toBe('MM: 3 need you · 0 pinned  ⏱ Not tracked to a client yet')
    await skill($, 'acme-roofing-project')
    await w.clock.advance(2_000)
    expect(last()).toBe('MM: 3 need you · 1 pinned  ⏱ Tracking to Acme Roofing')
    await w.clock.advance(15_000)
    expect(last()).toBe('MM: 3 need you · 1 pinned  ⏱ Acme Roofing · this thread 1h 23m today')
    await $.tool.call({ tool: 'Bash', command: `node ~/.claude/mm-hooks/worklog-hook.js --task "${TASK}"` } as never)
    await w.clock.advance(100)
    expect(last()).toBe(`MM: 3 need you · 1 pinned  ⏱ Acme Roofing · ${TASK} · this thread 1h 23m today`)
    await mm($, 'unlink')
    await w.clock.advance(100)
    expect(last()).toBe('MM: 3 need you · 1 pinned  ⏱ Not tracked to a client yet')
  })

  const nudged = async ($: Engine, on: On, title = 'Acme Roofing nurture copy') => {
    const w = world(on, { skillMap: skillsOk, self: thread(SELF, title, 0) })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    return w
  }
  const band = ($: Engine) => $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })

  test('after the person\'s second prompt (marker kickoffs and the app\'s wrapped prompts do not count), with its offers', async ($, on) => {
    const w = await nudged($, on)
    await person($, 'first')
    await $.prompt.submit({ text: 'Task (from the session that started this one):\nCheck the roof quote', wait: false, origin: { kind: 'auto-continuation' } } as never)
    await w.clock.advance(100)
    let b = await band($)
    expect(await lines(b)).not.toContain('This thread is not tracked to a client yet.')
    await b.unmount()
    await person($, 'second')
    await w.clock.advance(100)
    b = await band($)
    expect(await lines(b)).toContain('This thread is not tracked to a client yet.')
    expect((await buttons(b)).slice(-3)).toEqual([[`mm-track:${ACME}`, 'Track to Acme Roofing'], ['mm-track-internal', 'Massmarket internal'], ['mm-track-none', 'Not client work']])
    await b.unmount()
  })

  test('Track to <Client>: the thread is the client\'s, its pane opens, and Claude gets the verbatim note', async ($, on) => {
    const w = await nudged($, on)
    await person($, 'first')
    await person($, 'second')
    await w.clock.advance(100)
    const b = await band($)
    await b.press({ key: `mm-track:${ACME}` })
    await b.unmount()
    await w.clock.advance(2_000)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: ACME, how: 'press' })
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Acme Roofing' })
    expect(w.appended.map(a => (JSON.parse(a) as { content: Array<{ text: string }> }).content[0]?.text)).toEqual([
      '[mm-bridge] The person marked this thread as Acme Roofing\'s work. Before your next step, load the acme-roofing-project skill with the Skill tool so the time tracker counts this thread\'s time to Acme Roofing.',
    ])
    // the band's line is gone: the thread is tracked
    const after = await band($)
    expect(await lines(after)).not.toContain('This thread is not tracked to a client yet.')
    await after.unmount()
    expect(w.prompts.length).toBe(2)
  })

  test('Massmarket internal: internal ops, and its verbatim note', async ($, on) => {
    const w = await nudged($, on, 'Fix the tracker')
    await person($, 'first')
    await person($, 'second')
    await w.clock.advance(100)
    const b = await band($)
    expect((await buttons(b)).map(([key]) => key).filter(key => key.startsWith('mm-track'))).toEqual(['mm-track-internal', 'mm-track-none'])
    await b.press({ key: 'mm-track-internal' })
    await b.unmount()
    await w.clock.advance(100)
    expect((w.stored['mm.current'] as Record<string, unknown>)[SELF]).toMatchObject({ pid: INTERNAL, how: 'press' })
    expect(w.stored['mm.links']).toEqual({})
    expect(w.appended.map(a => (JSON.parse(a) as { content: Array<{ text: string }> }).content[0]?.text)).toEqual([
      '[mm-bridge] The person marked this thread as Massmarket internal work. Before your next step, load the massmarket-internal-ops skill with the Skill tool so the time tracker counts it.',
    ])
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Massmarket internal' })
  })

  test('Not client work: no band line and no status for the rest of the session, and no note', async ($, on) => {
    const w = await nudged($, on, 'Personal errands')
    await person($, 'first')
    await person($, 'second')
    await w.clock.advance(100)
    const b = await band($)
    await b.press({ key: 'mm-track-none' })
    await b.unmount()
    await person($, 'third')
    await w.clock.advance(100)
    const again = await band($)
    expect(await lines(again)).not.toContain('This thread is not tracked to a client yet.')
    await again.unmount()
    expect(String(w.statuses.at(-1) ?? '')).not.toContain('⏱')
    expect(w.appended).toEqual([])
    expect(w.stored['mm.current']).toBeUndefined()
  })
})

describe('0.7.0: the pane names the line the work counts toward', () => {
  test('the client-time read asks for the lines (with=lines)', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: ON_LINE }))
    await started($, w)
    const reads = w.fetched.filter(u => u.includes('/client-time'))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(u => u.endsWith('&with=lines'))).toBe(true)
    expect(onlyReads(w)).toBe(true)
  })

  test('an OW without lines yet: the pane, the status line and the band exactly as 0.6.0 drew them, and no note', async ($, on) => {
    const w = linedWorld(on, timeOk(true))
    await started($, w)
    const ui = await pane($)
    // (0.7.5) "as 0.6.0 drew them" is now: the Tracking part every project with no lines gets (0.6.0's tests above), opened with More
    await openTrack(ui, true)
    expect(trackPart(await tree(ui))).toEqual(TRACKED(TASK))
    const all = await lines(ui)
    expect(all.some(l => l.startsWith('Counts toward') || l.startsWith('Proposed') || l === 'Lines today')).toBe(false)
    await ui.unmount()
    expect(lastStatus(w)).toBe(`MM: 3 need you · 1 pinned  ⏱ Acme Roofing · ${TASK} · this thread 1h 23m today`)
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toEqual([])
  })

  test('[render proof] (a) on a line with an estimate, as a PM: the line, the tasks\' lines, Lines today and the status line', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: ON_LINE, proposals: [PROPOSAL] }))
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened: its one line, the line it counts toward, today, the one time list
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(a) on_line with estimate, PM', drawn)
    proof('(a) status line', [lastStatus(w)])
    expect(trackPart(drawn)).toEqual([
      `[${HEAD(TASK)}  ▾]`,
      'Counts toward: Phase 1 nurture sequence · est 12 h · 1h 04m today',
      TODAY_LINE,
      `${TASK} · 1h 04m · Builder → Phase 1 nurture sequence (this thread)`,
      '[f779a7a0 Fix inbound router · 42m · Pat → Inbound lead router and ass…]',
      'No task declared · 19m · Builder, Pat · 2 threads',
      '**Lines today',
      'Phase 1 nurture sequence · 1h 04m · est 12 h',
      'Inbound lead router and assignment rules · 42m · est 6 h',
      'Support hour bank · 19m · est 10 h',
      'Proposed: Spanish landing page · waiting for yes',
      '[More  ▸]',
    ])
    await ui.unmount()
    expect(lastStatus(w)).toBe(`MM: 3 need you · 1 pinned  ⏱ Acme Roofing · ${TASK} → Phase 1 nurture sequence · this thread 1h 23m today`)
    // on a line: no band, no note
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toEqual([])
  })

  test('[render proof] (b) on a line as a non-PM: no minutes for estimated lines anywhere', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: ON_LINE, pm: false }))
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened, More too (where leverage would be)
    await openTrack(ui, true)
    const drawn = await tree(ui)
    proof('(b) on_line, not a PM (minutes null)', drawn)
    expect(trackPart(drawn).slice(0, 10)).toEqual([
      `[${HEAD(TASK)}  ▾]`,
      'Counts toward: Phase 1 nurture sequence · est 12 h',
      TODAY_LINE,
      `${TASK} · 1h 04m · Builder → Phase 1 nurture sequence (this thread)`,
      '[f779a7a0 Fix inbound router · 42m · Pat → Inbound lead router and ass…]',
      'No task declared · 19m · Builder, Pat · 2 threads',
      '**Lines today',
      'Support hour bank · 19m · est 10 h',
      '[More  ▾]',
      NUMBERS[0],
    ])
    expect(drawn.some(l => l.startsWith('Leverage'))).toBe(false)
    await ui.unmount()
  })

  test('[render proof] (c) maybe new scope, three candidates and a bank: the pane, the band, and the one note', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }))
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(c) maybe_new_scope, 3 candidates + bank: pane', drawn)
    expect(trackPart(drawn).slice(0, 3)).toEqual([`[${HEAD(TASK)}  ▾]`, 'Counts toward: no line yet', TODAY_LINE])
    await ui.unmount()
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const band = await tree(b)
    proof('(c) maybe_new_scope, 3 candidates + bank: band', band)
    expect(band.slice(-7)).toEqual(['Acme Roofing: this doesn\'t match a line on the quote.', '[Website refresh]', '[Inbound lead router and ass…]', '[Phase 1 nurture sequence]', '[New scope]', '[Prepaid hours]', '[Not now]'])
    await b.unmount()
    expect(lastStatus(w)).toBe(`MM: 3 need you · 1 pinned  ⏱ Acme Roofing · ${TASK} · this thread 1h 23m today`)
    expect(notes(w)).toEqual([ASK_NOTE])
    proof('(c) the one note to Claude', notes(w))
  })

  test('[render proof] (d) proposed: the proposed line, waiting for the client', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: PROPOSED, proposals: [PROPOSAL] }), {}, 'abcdef12 Spanish landing page')
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(d) proposed', drawn)
    expect(trackPart(drawn).slice(0, 2)).toEqual([`[${HEAD('abcdef12 Spanish landing page')}  ▾]`, 'Proposed new line: Spanish landing page · waiting for Acme Roofing\'s yes'])
    expect(drawn).toContain('Proposed: Spanish landing page · waiting for yes')
    await ui.unmount()
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toEqual([])
  })

  test('the other signals under the heading: account work in the bank, a fix with no line, no quote', async ($, on) => {
    let line: Record<string, unknown> = { via: 'bank', line_key: L_BANK, title: 'Support hour bank', line_type: 'bank', estimate_hours: 10, signal: 'account_work', candidates: [], proposal: null }
    let quote: unknown[] | undefined
    const w = linedWorld(on, url => ({ status: 200, body: byPeriods(linesBody({ line, ...(quote ? { lines: quote } : {}) }) as ReturnType<typeof clientTimeBody>, url) }))
    // (0.7.5) the line under the Tracking part's one line, at the bottom of the pane: opened once (the fold holds for the thread)
    const second = async () => {
      const ui = await pane($)
      if ((await trackHead(ui))?.endsWith('▸')) await openTrack(ui)
      const text = trackPart(await tree(ui))[1]
      await ui.unmount()
      return text
    }
    await started($, w)
    expect(await second()).toBe('Counts toward: account work · Support hour bank (hour bank)')
    // the next reads (the syncs every 5 minutes)
    line = { ...line, via: 'none', line_key: null, title: null, line_type: null, signal: 'fix' }
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(await second()).toBe('Counts toward: no line yet (a fix)')
    line = { ...line, signal: 'no_quote' }
    quote = []
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(await second()).toBe('Counts toward: no quote on record for Acme Roofing')
    // none of these asks
    expect(notes(w)).toEqual([])
  })
})

describe('0.7.0: the band asks which line, once per task label, and every press only adds a note', () => {
  test('unmatched: which line, each candidate, New scope, Prepaid hours and Not now', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }))
    await started($, w)
    const band = await bandLines($)
    expect(band.lines).toContain('Acme Roofing: which line does this work count toward?')
    expect(lineButtons(band.buttons)).toEqual([
      [`mm-line:${L_SITE}`, 'Website refresh'],
      [`mm-line:${L_ROUTER}`, 'Inbound lead router and ass…'],
      [`mm-line:${L_COPY}`, 'Phase 1 nurture sequence'],
      ['mm-line-new', 'New scope'],
      ['mm-line-bank', 'Prepaid hours'],
      ['mm-line-later', 'Not now'],
    ])
  })

  test('a client with no hour bank (an OW that does not say prepaid hours): no Prepaid hours button, and the note says nothing of them', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED, lines: QUOTE_LINES.filter(l => l.line_type !== 'bank') }))
    await started($, w)
    expect(lineButtons((await bandLines($)).buttons).map(([key]) => key)).toEqual([`mm-line:${L_SITE}`, `mm-line:${L_ROUTER}`, `mm-line:${L_COPY}`, 'mm-line-new', 'mm-line-later'])
    expect(notes(w)).toHaveLength(1)
    expect(notes(w)[0]).not.toContain('prepaid hours')
    expect(notes(w)[0]).not.toContain('"bank"')
  })

  test('a candidate: its verbatim note, the band gone for this label, no turn started and nothing sent', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await b.press({ key: `mm-line:${L_SITE}` })
    await b.unmount()
    expect(notes(w)).toEqual([
      ASK_NOTE,
      `[mm-bridge] The person says this thread's work counts toward Acme Roofing's line "Website refresh". Before your next step, call the mm tool with "line ${L_SITE}" and do what it returns.`,
    ])
    expect(w.prompts).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.scopePosts).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    // the syncs after it (OW still says unmatched for this label) ask nothing again
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toHaveLength(2)
  })

  test('New scope: its verbatim note', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await b.press({ key: 'mm-line-new' })
    await b.unmount()
    expect(notes(w)).toEqual([
      ASK_NOTE,
      '[mm-bridge] The person says this thread\'s work is new scope for Acme Roofing. Before your next step, write a short title for it (the words the client would see on a quote), one line on why, and your estimate in hours, and decide whether it is urgent (something broken that is costing the client money right now). Then call the mm tool with "propose <title> -- <why> -- <N>h" (add " urgent" when it is) and do what it returns. A fix to something Massmarket built is not new scope: if that is what this is, say so to the person instead.',
    ])
    expect(w.prompts).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.scopePosts).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('Prepaid hours (0.7.0\'s Hour bank, a client with a bank and an OW that does not say): its verbatim note', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await b.press({ key: 'mm-line-bank' })
    await b.unmount()
    expect(notes(w)).toEqual([ASK_NOTE, '[mm-bridge] The person says this thread\'s work comes out of Acme Roofing\'s prepaid hours. Before your next step, call the mm tool with "bank" and do what it returns.'])
    expect(w.prompts).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('Not now: hidden for this label with no note; a new label OW counted as unmatched asks again, once', async ($, on) => {
    let task = TASK
    const w = linedWorld(on, url => ({ status: 200, body: byPeriods(linesBody({ line: UNMATCHED, threadTask: task }) as ReturnType<typeof clientTimeBody>, url) }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    await b.press({ key: 'mm-line-later' })
    await b.unmount()
    expect(notes(w)).toEqual([ASK_NOTE])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    // the thread declares another task: OW's row still carries the old label, so nothing is asked for the new one yet
    await $.tool.call({ tool: 'Bash', command: 'node ~/.claude/mm-hooks/worklog-hook.js --task "Router copy tweaks"' } as never)
    await w.clock.advance(100)
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toHaveLength(1)
    // once OW counts the new label (still no line): the band and the one note for it
    task = 'Router copy tweaks'
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(lineButtons((await bandLines($)).buttons).map(([key]) => key)).toContain('mm-line-new')
    expect(notes(w)).toHaveLength(2)
    expect(notes(w)[1]).toContain('this thread\'s work ("Router copy tweaks") does not match a line')
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(notes(w)).toHaveLength(2)
  })
})

describe('0.7.0: the thread asks too, once, and only where a person works on a client', () => {
  test('one note per session and task label, however often the pane is drawn', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }))
    await started($, w)
    for (let i = 0; i < 12; i++) await w.clock.advance(60_000)
    await person($, 'keep going')
    await w.clock.advance(100)
    expect(notes(w)).toEqual([ASK_NOTE])
    // the person's own prompt is the only one: the bridge started no turn
    expect(w.prompts.map(p => p.text)).toEqual(['keep going'])
  })

  test('never with MM_UNATTENDED=1', LONG, async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }), { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
    await started($, w)
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.fetched.some(u => u.includes('/client-time'))).toBe(true)
    expect(notes(w)).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('never in a SINGLE-SESSION run', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }))
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await $.prompt.submit({ text: 'SINGLE-SESSION reconcile one client', wait: false, origin: { kind: 'sdk' } })
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.fetched.some(u => u.includes('/client-time'))).toBe(true)
    expect(notes(w)).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('never for Massmarket\'s own projects', async ($, on) => {
    const w = world(on, {
      skillMap: skillsOk,
      clientTime: linesOk({ line: UNMATCHED, project: INTERNAL }),
      store: { 'mm.current': { [SELF]: { pid: INTERNAL, how: 'skill', at: NOW - 60_000, task: TASK } } },
    })
    await started($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened
    await openTrack(ui)
    expect(trackPart(await tree(ui)).slice(0, 2)).toEqual([`[⏱ This thread: Massmarket internal · ${TASK} · 1h 23m today  ▾]`, 'Counts toward: no line yet'])
    await ui.unmount()
    expect(notes(w)).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('a run nobody watches (claude -p): nothing read, nothing asked', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }), { terminal: true, env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', HOME: '/home/someone' } })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    await w.clock.advance(4_000)
    expect(w.fetched).toEqual([])
    expect(notes(w)).toEqual([])
  })
})

describe('0.7.0: mm line, propose and bank act on the answer, and never send anything to a client', () => {
  const ticketTask = 'f779a7a0 Fix inbound router'

  test('line, in a thread working a ticket: OW links the ticket to the line (Claude\'s call)', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED, threadTask: ticketTask }), { scopeLink: body => ({ status: 200, body: { ok: true, changed: true, line_key: body.line_key, ticket_id: 'f779a7a0-0000-4000-8000-000000000000', ticket_title: 'Fix inbound router', link_source: 'member' } }) }, ticketTask)
    await started($, w)
    expect(lineButtons((await bandLines($)).buttons).length).toBeGreaterThan(0)
    const said = await tool($, `line ${L_SITE}`)
    expect(said).toBe('Linked ticket f779a7a0 to Website refresh; its time counts there now.')
    expect(w.scopePosts).toEqual([{
      url: 'https://onboarding-wizard.massmarket.ai/api/ext/scope-line/link',
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-not-a-real-one', 'X-MM-Client': `mm-bridge/${VERSION}`, 'Content-Type': 'application/json' },
      body: { line_key: L_SITE, ticket_id: 'f779a7a0', link_source: 'member' },
    }])
    expect(said).not.toContain('fixture-token')
    // the band for this label is answered
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('line on a ticket another line holds (409): OW\'s words and how to move it; "move" moves it', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: ON_LINE, threadTask: ticketTask }), {
      scopeLink: body => (body.move === true ? { status: 200, body: { ok: true, changed: true, line_key: body.line_key, ticket_id: 'x', ticket_title: 'Fix inbound router', link_source: 'member', moved_from: L_COPY } } : { status: 409, body: { ok: false, error: 'ticket is on another line' } }),
    }, ticketTask)
    await started($, w)
    expect(await tool($, `line ${L_SITE}`)).toBe(`Ticket f779a7a0 is on another line (the Onboarding Wizard said: ticket is on another line). To move it to Website refresh, call the mm tool with "line ${L_SITE} move".`)
    expect(await tool($, `line ${L_SITE} move`)).toBe('Linked ticket f779a7a0 to Website refresh; its time counts there now.')
    expect(w.scopePosts.map(p => p.body)).toEqual([
      { line_key: L_SITE, ticket_id: 'f779a7a0', link_source: 'member' },
      { line_key: L_SITE, ticket_id: 'f779a7a0', move: true, link_source: 'member' },
    ])
  })

  test('line, in a thread with no ticket: the command that declares the line (and PowerShell\'s on Windows); nothing posted', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }))
    await started($, w)
    expect(await tool($, `line ${L_SITE}`)).toBe(`Run this to count this thread's work to Website refresh from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_SITE} ${TASK}"`)
    expect(w.scopePosts).toEqual([])
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
  })

  test('line on Windows: PowerShell\'s form too', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: UNMATCHED }), { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', OS: 'Windows_NT' } }, `${L_COPY} ${TASK}`)
    await started($, w)
    expect(await mm($, `line ${L_SITE}`)).toBe(
      `Run this to count this thread's work to Website refresh from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_SITE} ${TASK}" (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "${L_SITE} ${TASK}")`,
    )
  })

  test('line: a key that is not the client\'s, an OW without lines, a refusal, and a thread with no client', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: ON_LINE, threadTask: ticketTask }), { scopeLink: () => ({ status: 500, body: { error: 'boom' } }) }, ticketTask)
    await started($, w)
    expect(await tool($, 'line L-99999999')).toBe(`L-99999999 is not one of Acme Roofing's lines. Its lines: ${L_COPY} (Phase 1 nurture sequence), ${L_ROUTER} (Inbound lead router and assignment rules), ${L_SITE} (Website refresh), ${L_BANK} (Support hour bank).`)
    expect(await tool($, 'line')).toContain('That is not one of Acme Roofing\'s lines.')
    expect(await tool($, `line ${L_SITE}`)).toBe('Couldn\'t link ticket f779a7a0 to Website refresh: boom (HTTP 500).')
    await mm($, 'unlink')
    expect(await tool($, `line ${L_SITE}`)).toBe('This thread is not tracked to a client yet: load the client\'s project skill first, then try again.')
  })

  test('line with an OW that does not list lines yet: nothing changes', async ($, on) => {
    const w = linedWorld(on, timeOk(true))
    await started($, w)
    expect(await tool($, `line ${L_SITE}`)).toBe('The Onboarding Wizard does not list Acme Roofing\'s quote lines yet, so nothing was changed.')
    expect(await tool($, 'bank')).toBe('The Onboarding Wizard does not list Acme Roofing\'s quote lines yet, so nothing was changed.')
    expect(w.scopePosts).toEqual([])
  })

  test('propose: a new proposal, one already there, and a refusal', async ($, on) => {
    let existing = false
    let refuse = false
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }), {
      scopeProposal: body => (refuse ? { status: 500, body: { error: 'boom' } } : { status: 200, body: { ok: true, ticket_id: 'abcdef12-0000-4000-8000-000000000000', ticket_id8: 'abcdef12', title: body.title, existing } }),
    })
    await started($, w)
    expect(await tool($, 'propose Spanish landing page -- the client asked for a Spanish version on the call')).toBe(
      'Proposed "Spanish landing page" for Acme Roofing (ticket abcdef12). Run this so the work counts to the proposal: node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page"',
    )
    expect(w.scopePosts[0]).toEqual({
      url: 'https://onboarding-wizard.massmarket.ai/api/ext/scope-proposal',
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-not-a-real-one', 'X-MM-Client': `mm-bridge/${VERSION}`, 'Content-Type': 'application/json' },
      body: { project_id: ACME, title: 'Spanish landing page', why: 'the client asked for a Spanish version on the call', session_id: SELF_CLI },
    })
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    existing = true
    expect(await mm($, 'propose Spanish landing page')).toBe(
      'Already proposed "Spanish landing page" for Acme Roofing (ticket abcdef12). Run this so the work counts to the proposal: node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page"',
    )
    expect(w.scopePosts[1]?.body).toEqual({ project_id: ACME, title: 'Spanish landing page', why: '', session_id: SELF_CLI })
    refuse = true
    expect(await tool($, 'propose Spanish landing page -- why')).toBe('Couldn\'t propose new scope for Acme Roofing: boom (HTTP 500).')
    expect(await tool($, 'propose')).toBe('Give the new scope a title: mm propose <title> -- <why> -- <N>h (the words the client would see on a quote, one line on why, then your estimate in hours; add " urgent" when it is).')
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('bank: the client\'s hour bank as line does; a client with none is told so', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }))
    await started($, w)
    expect(await mm($, 'bank')).toBe(`Run this to count this thread's work to Support hour bank from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_BANK} ${TASK}"`)
  })

  test('bank, for a client with no hour bank', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE, lines: QUOTE_LINES.filter(l => l.line_type !== 'bank') }))
    await started($, w)
    expect(await tool($, 'bank')).toBe('Acme Roofing has no hour bank on record; ask the person which line, or propose new scope.')
  })

  test('bank, in a thread working a ticket: the ticket goes to the bank line', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE, threadTask: ticketTask }), { scopeLink: body => ({ status: 200, body: { ok: true, changed: true, line_key: body.line_key } }) }, ticketTask)
    await started($, w)
    expect(await tool($, 'bank')).toBe('Linked ticket f779a7a0 to Support hour bank; its time counts there now.')
    expect(w.scopePosts.map(p => p.body)).toEqual([{ line_key: L_BANK, ticket_id: 'f779a7a0', link_source: 'member' }])
  })
})

describe('0.7.1: mm propose sends the estimate and urgent, and says whether to carry on or pause', () => {
  test('tell_and_go: the estimate goes to OW; carry on, the next reply tells the client, billed at the estimate', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: null, always_ask: false, small_limit_hours: 2 }, { line: NEW_SCOPE }), {
      scopeProposal: proposalOk(() => ({ mode: 'tell_and_go', settle: 'next_invoice', reason: 'small', estimate_hours: 1.5 })),
    })
    await started($, w)
    expect(await tool($, `propose Spanish landing page -- ${WHY} -- 1.5h`)).toBe(
      `Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it goes on the next invoice at about 1.5 h. Run this so the work counts to it: ${RUN_SPANISH}`,
    )
    expect(w.scopePosts).toEqual([{
      url: 'https://onboarding-wizard.massmarket.ai/api/ext/scope-proposal',
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token-not-a-real-one', 'X-MM-Client': `mm-bridge/${VERSION}`, 'Content-Type': 'application/json' },
      body: { project_id: ACME, title: 'Spanish landing page', why: WHY, estimate_hours: 1.5, session_id: SELF_CLI },
    }])
    // the band for this label is answered; no turn, nothing to a client
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('each mode and reason as OW answers it, with urgent sent when Claude says so', async ($, on) => {
    let how: Record<string, unknown> = {}
    let existing = false
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 4, always_ask: false, small_limit_hours: 2 }, { line: NEW_SCOPE }), { scopeProposal: proposalOk(() => how, () => existing) })
    await started($, w)
    const head = 'Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12).'
    const spent = `Run this so any time already spent counts to it: ${RUN_SPANISH}`
    const counts = `Run this so the work counts to it: ${RUN_SPANISH}`
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
      [`-- ${WHY} -- 1.5 h`, { mode: 'tell_and_go', settle: 'prepaid_hours', reason: 'small', estimate_hours: 1.5 }, { estimate_hours: 1.5 },
        `${head} It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it comes out of their prepaid hours at about 1.5 h. ${counts}`],
      [`-- ${WHY} -- 6 hours`, { mode: 'needs_yes', reason: 'over_limit', estimate_hours: 6 }, { estimate_hours: 6 },
        `${head} At about 6 h it needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. ${spent}`],
      [`-- ${WHY} -- 1h`, { mode: 'needs_yes', reason: 'always_ask', estimate_hours: 1 }, { estimate_hours: 1 },
        `${head} Acme Roofing is set to always ask first, so pause the new part: the next reply asks for it. ${spent}`],
      [`-- ${WHY} -- 1h`, { mode: 'needs_yes', reason: 'small_items_cap', estimate_hours: 1 }, { estimate_hours: 1 },
        `${head} Acme Roofing's small new-scope items since the last invoice already add up to 2 hours, so this one needs their yes first. Pause the new part: the next reply asks for it. ${spent}`],
      [`-- ${WHY}`, { mode: 'needs_yes', reason: 'no_estimate' }, {},
        `${head} Without an estimate it needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. ${spent}`],
      [`-- ${WHY} -- 1.5h urgent`, { mode: 'urgent', settle: 'next_invoice', reason: 'urgent', estimate_hours: 1.5 }, { estimate_hours: 1.5, urgent: true },
        `Recorded "Spanish landing page" as urgent new scope for Acme Roofing (ticket abcdef12). Carry on now: the next reply tells Acme Roofing we're on it, and it goes on the next invoice at about 1.5 h. ${counts}`],
      [`-- ${WHY} -- urgent`, { mode: 'urgent', settle: 'next_invoice', reason: 'urgent' }, { urgent: true },
        `Recorded "Spanish landing page" as urgent new scope for Acme Roofing (ticket abcdef12). Carry on now: the next reply tells Acme Roofing we're on it, and the actual time goes on the next invoice. ${counts}`],
      // the estimate OW gives back is the one said
      [`-- ${WHY} -- 1.4h`, { mode: 'tell_and_go', settle: 'next_invoice', reason: 'small', estimate_hours: 1.5 }, { estimate_hours: 1.4 },
        `${head} It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it goes on the next invoice at about 1.5 h. ${counts}`],
    ]
    for (const [n, [args, answer, sent, text]] of cases.entries()) {
      how = answer
      expect(await (n % 2 ? mm : tool)($, `propose Spanish landing page ${args}`)).toBe(text)
      const why = args.startsWith(`-- ${WHY}`) ? WHY : ''
      expect(w.scopePosts.at(-1)?.body).toEqual({ project_id: ACME, title: 'Spanish landing page', why, ...sent, session_id: SELF_CLI })
    }
    existing = true
    how = { mode: 'tell_and_go', settle: 'next_invoice', reason: 'small', estimate_hours: 1.5 }
    expect(await tool($, `propose Spanish landing page -- ${WHY} -- 1.5h`)).toBe(
      `Already recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it goes on the next invoice at about 1.5 h. ${counts}`,
    )
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
  })

  test('an OW that gives no mode: 0.7.0\'s answer, with the estimate still sent', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }), { scopeProposal: proposalOk(() => ({})) })
    await started($, w)
    expect(await tool($, `propose Spanish landing page -- ${WHY} -- 2h urgent`)).toBe(
      `Proposed "Spanish landing page" for Acme Roofing (ticket abcdef12). Run this so the work counts to the proposal: ${RUN_SPANISH}`,
    )
    expect(w.scopePosts[0]?.body).toEqual({ project_id: ACME, title: 'Spanish landing page', why: WHY, estimate_hours: 2, urgent: true, session_id: SELF_CLI })
  })

  test('an estimate out of range: nothing recorded, and Claude is told the range', async ($, on) => {
    const w = linedWorld(on, linesOk({ line: NEW_SCOPE }), { scopeProposal: proposalOk(() => ({ mode: 'tell_and_go' })) })
    await started($, w)
    for (const n of ['0.1h', '250 hours']) {
      expect(await tool($, `propose Spanish landing page -- ${WHY} -- ${n}`)).toBe('The estimate is in hours, from 0.25 to 200: mm propose <title> -- <why> -- <N>h (add " urgent" when it is). Nothing was recorded.')
    }
    expect(w.scopePosts).toEqual([])
    // the band is still asking
    expect(lineButtons((await bandLines($)).buttons).length).toBeGreaterThan(0)
  })
})

describe('0.7.1: Prepaid hours on the band, and mm bank', () => {
  test('[render proof] (e) the band with Prepaid hours: the client has prepaid hours left; its press adds only its note', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 4, always_ask: false, small_limit_hours: 2 }, { line: NEW_SCOPE }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const band = await tree(b)
    proof('(e) the band with Prepaid hours (4 h left)', band)
    expect(band.slice(-7)).toEqual(['Acme Roofing: this doesn\'t match a line on the quote.', '[Website refresh]', '[Inbound lead router and ass…]', '[Phase 1 nurture sequence]', '[New scope]', '[Prepaid hours]', '[Not now]'])
    await b.press({ key: 'mm-line-bank' })
    await b.unmount()
    expect(notes(w)).toEqual([ASK_NOTE, '[mm-bridge] The person says this thread\'s work comes out of Acme Roofing\'s prepaid hours. Before your next step, call the mm tool with "bank" and do what it returns.'])
    expect(w.prompts).toEqual([])
    expect(sends(w)).toEqual([])
    expect(w.scopePosts).toEqual([])
  })

  test('prepaid hours left and no bank line: Prepaid hours is still offered', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 2 }, { line: UNMATCHED, lines: QUOTE_LINES.filter(l => l.line_type !== 'bank') }))
    await started($, w)
    expect(lineButtons((await bandLines($)).buttons).map(([key]) => key)).toEqual([`mm-line:${L_SITE}`, `mm-line:${L_ROUTER}`, `mm-line:${L_COPY}`, 'mm-line-new', 'mm-line-bank', 'mm-line-later'])
    expect(notes(w)[0]).toContain('or does it come out of their prepaid hours?')
  })

  test('no prepaid hours left: no Prepaid hours, even with a bank line, and the note asks nothing of them', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 0 }, { line: UNMATCHED }))
    await started($, w)
    expect(lineButtons((await bandLines($)).buttons).map(([key]) => key)).toEqual([`mm-line:${L_SITE}`, `mm-line:${L_ROUTER}`, `mm-line:${L_COPY}`, 'mm-line-new', 'mm-line-later'])
    expect(notes(w)).toHaveLength(1)
    expect(notes(w)[0]).not.toContain('prepaid hours')
    expect(notes(w)[0]).not.toContain('"bank"')
  })

  test('prepaid hours null (none to draw on): no Prepaid hours, even with a bank line', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: null }, { line: UNMATCHED }))
    await started($, w)
    expect(lineButtons((await bandLines($)).buttons).map(([key]) => key)).not.toContain('mm-line-bank')
    expect(notes(w)[0]).not.toContain('prepaid hours')
  })

  test('mm bank with no prepaid hours left: told so; nothing posted, no command given', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 0 }, { line: NEW_SCOPE, threadTask: 'f779a7a0 Fix inbound router' }), { scopeLink: () => ({ status: 200, body: { ok: true } }) }, 'f779a7a0 Fix inbound router')
    await started($, w)
    expect(await tool($, 'bank')).toBe('Acme Roofing has no prepaid hours left; ask the person which line, or record it as new scope.')
    expect(await mm($, 'bank')).toBe('Acme Roofing has no prepaid hours left; ask the person which line, or record it as new scope.')
    expect(w.scopePosts).toEqual([])
  })

  test('mm bank with prepaid hours left: as 0.7.0, to the bank line', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 4 }, { line: NEW_SCOPE }))
    await started($, w)
    expect(await mm($, 'bank')).toBe(`Run this to count this thread's work to Support hour bank from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_BANK} ${TASK}"`)
  })

  test('[render proof] (f) the band for a client set to always ask first', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 0, always_ask: true, small_limit_hours: 2 }, { line: UNMATCHED }))
    await started($, w)
    const b = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    const band = await tree(b)
    proof('(f) the band, always ask first (no prepaid hours left)', band)
    expect(band.slice(-6)).toEqual(['Acme Roofing: which line does this work count toward? (Acme Roofing is set to always ask first)', '[Website refresh]', '[Inbound lead router and ass…]', '[Phase 1 nurture sequence]', '[New scope]', '[Not now]'])
    await b.unmount()
  })

  test('[render proof] (f2) always ask first and prepaid hours left, together', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 3, always_ask: true }, { line: NEW_SCOPE }))
    await started($, w)
    const band = (await bandLines($))
    proof('(f2) the band, always ask first with prepaid hours left', [...band.lines, ...lineButtons(band.buttons).map(([, label]) => `[${label}]`)])
    expect(band.lines).toContain('Acme Roofing: this doesn\'t match a line on the quote. (Acme Roofing is set to always ask first)')
    expect(lineButtons(band.buttons).map(([key]) => key)).toContain('mm-line-bank')
  })
})

describe('0.7.1: the pane shows how new scope goes', () => {
  const SPANISH_TASK = 'abcdef12 Spanish landing page'

  test('[render proof] (g) a tell_and_go proposal: told in the next reply, in Tracking and in Lines today', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: null, always_ask: false, small_limit_hours: 2 }, { line: PROPOSED, proposals: [{ ...PROPOSAL, mode: 'tell_and_go', estimate_hours: 1.5, reason: 'small' }] }), {}, SPANISH_TASK)
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(g) tell_and_go proposal: Tracking + Lines today', drawn)
    expect(trackPart(drawn).slice(0, 2)).toEqual([`[${HEAD(SPANISH_TASK)}  ▾]`, 'New scope: Spanish landing page · Acme Roofing is told in the next reply'])
    const at = drawn.indexOf('**Lines today')
    expect(drawn.slice(at, at + 5)).toEqual([
      '**Lines today',
      'Phase 1 nurture sequence · 1h 04m · est 12 h',
      'Inbound lead router and assignment rules · 42m · est 6 h',
      'Support hour bank · 19m · est 10 h',
      'New scope: Spanish landing page · told in the next reply',
    ])
    expect(drawn.some(l => l.startsWith('Proposed'))).toBe(false)
    await ui.unmount()
    expect(lineButtons((await bandLines($)).buttons)).toEqual([])
    expect(notes(w)).toEqual([])
  })

  test('an urgent proposal reads the same', async ($, on) => {
    const w = linedWorld(on, settledOk({}, { line: PROPOSED, proposals: [{ ...PROPOSAL, mode: 'urgent', reason: 'urgent' }] }), {}, SPANISH_TASK)
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened: the line under its one line
    await openTrack(ui)
    const drawn = await tree(ui)
    expect(trackPart(drawn)[1]).toBe('New scope: Spanish landing page · Acme Roofing is told in the next reply')
    expect(drawn).toContain('New scope: Spanish landing page · told in the next reply')
    await ui.unmount()
  })

  test('[render proof] (h) a needs_yes proposal: waiting for the client\'s yes, as 0.7.0', async ($, on) => {
    const w = linedWorld(on, settledOk({ prepaid_hours_left: null, always_ask: false, small_limit_hours: 2 }, { line: PROPOSED, proposals: [{ ...PROPOSAL, mode: 'needs_yes', estimate_hours: 6, reason: 'over_limit' }] }), {}, SPANISH_TASK)
    await started($, w)
    const ui = await pane($)
    // (0.7.5) the Tracking part at the bottom, opened
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(h) needs_yes proposal', drawn)
    expect(trackPart(drawn).slice(0, 2)).toEqual([`[${HEAD(SPANISH_TASK)}  ▾]`, 'Proposed new line: Spanish landing page · waiting for Acme Roofing\'s yes'])
    expect(drawn).toContain('Proposed: Spanish landing page · waiting for yes')
    expect(drawn.some(l => l.startsWith('New scope:'))).toBe(false)
    await ui.unmount()
  })

  test('[render proof] (i) a told, unbilled line: new scope, next invoice', async ($, on) => {
    const lines = QUOTE_LINES.map(l => (l.line_key === L_COPY ? { ...l, told: true, billed: false } : l.line_key === L_ROUTER ? { ...l, told: true, billed: true } : l))
    const w = linedWorld(on, settledOk({ prepaid_hours_left: 4, always_ask: false, small_limit_hours: 2 }, { line: ON_LINE, lines }))
    await started($, w)
    const ui = await pane($)
    // (0.7.5) Lines today is in the Tracking part, opened
    await openTrack(ui)
    const drawn = await tree(ui)
    proof('(i) told, unbilled line in Lines today', drawn)
    const at = drawn.indexOf('**Lines today')
    expect(drawn.slice(at, at + 4)).toEqual([
      '**Lines today',
      'Phase 1 nurture sequence · 1h 04m · est 12 h · new scope, next invoice',
      'Inbound lead router and assignment rules · 42m · est 6 h',
      'Support hour bank · 19m · est 10 h',
    ])
    await ui.unmount()
  })
})

// (0.7.5) The side panel redesign. Rob, 2026-10-27: "Yes, redesign the side panel the way you laid out: queue first, one
// merged time list, plain numbers." Needs you now counts what needs the viewer now; the internal queue is its own part
// under it, and the founder's clients listed only by tickets nobody dated are a closed group in the line of groups.
describe('(0.7.5) the pane: Needs you now, then Your build queue, then the groups on one line', () => {
  const OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
  const qt = (n: number): FeedQueueTicket => ({
    ticket_id: tid(n), project_id: OPS, project_name: 'Massmarket AI', title: `Ticket ${n}`, severity: 'high', internal: true, assignee_email: ME,
    queue_tier: 'now', queue_rank: n, queue_reason: `reason ${n}`,
  })
  const undated = (n: number): FeedTicket => ({ ticket_id: tid(100 + n), project_id: BOLT, project_name: 'Bolt Staffing (Sam)', title: `Undated ${n}`, due_at: null, due_source: null, assignee_email: ME })
  /** The founder: Cedar's task due at 4 PM, his internal queue (40 in all, 4 listed), and two undated tickets on Bolt. */
  const founder = (): Feed => {
    const base = feed()
    return { ...base, role: 'founder', mail: [], drafts: [], tickets: { ...base.tickets, internal_queue: [qt(1), qt(2), qt(3), qt(4)], undated: [undated(1), undated(2)] }, summary: { internal_queue_total: 40 } }
  }

  test('the header and the status line count what needs you now: not the internal queue, not the clients with no due date', async ($, on) => {
    const w = world(on, { feed: founder(), threads: [] })
    expect(await mm($, '')).toMatch(/^1 client need you; /)
    expect(String(w.statuses.at(-1) ?? '')).toMatch(/^MM: 1 need you · \d+ pinned/)
    const ui = await pane($)
    const drawn = await lines(ui)
    expect(drawn.slice(0, 2)).toEqual(['Needs you now (1)', `◆ 1. ${CEDAR_FRESH}`])
    // the queue in its own part, the top 3 by rank, then how many more: no thread is linked to it here
    expect(drawn.slice(drawn.indexOf('Your build queue · 40'))).toEqual(['Your build queue · 40', ' 1. Ticket 1', ' 2. Ticket 2', ' 3. Ticket 3', ' + 37 more in the queue', UPDATED])
    expect((await buttons(ui)).filter(([k]) => k.startsWith('mm-fold:') || k === 'mm-build-open')).toEqual([['mm-fold:undated', 'No due date (1)']])
    // closed until pressed; then Bolt's row, numbered on from the list's, with what its first line does not say
    expect(drawn.some(l => l.includes('Bolt Staffing'))).toBe(false)
    await ui.press({ key: 'mm-fold:undated' })
    const open = await lines(ui)
    // (0.7.11, Rob 10-30) Bolt's only items are undated tickets and nothing came from Bolt in six weeks: its row stays,
    // says so, and offers no Start (until 0.7.11 it offered Start thread); (0.7.12) its line says `no due date` where the
    // clock would be (until 0.7.12: '2. 🟡 Bolt Staffing · task · no thread')
    expect(open.slice(open.indexOf('No due date (1)'))).toEqual(['No due date (1)', '2. 🟡 Bolt Staffing · task · no due date · no thread', '2 tasks with no date · nothing from them in 6 weeks', UPDATED])
    expect(await buttonsOf(ui, BOLT)).toEqual(['Drafts'])
    expect(sends(w)).toEqual([])
    await ui.unmount()
  })

  test('linked to another thread: the part says so, and its Open thread opens that thread and sends nothing', async ($, on) => {
    const w = world(on, { feed: founder(), threads: [thread('local_ops', 'Massmarket ops', 1)], store: { 'mm.links': { [OPS]: 'local_ops' } } })
    await mm($, '')
    const ui = await pane($)
    const drawn = await lines(ui)
    expect(drawn.slice(drawn.indexOf('Your build queue · 40'), drawn.indexOf('Your build queue · 40') + 5)).toEqual(['Your build queue · 40', ' 1. Ticket 1', ' 2. Ticket 2', ' 3. Ticket 3', ' + 37 more in your Massmarket AI thread'])
    expect((await buttons(ui)).find(([k]) => k === 'mm-build-open')).toEqual(['mm-build-open', 'Open thread'])
    w.toasts.length = 0
    await ui.press({ key: 'mm-build-open' })
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toContain('Massmarket')
    expect(sends(w)).toEqual([])
    expect(w.prompts).toEqual([])
    await ui.unmount()
  })
})

// ======================================================================== (0.7.6) one thread per client, always pinned
// Rob, 2026-10-27: "I think we should always pin the most recent thread from that client"; "New clients rarely get
// assigned, and it's better for us to have everything pinned that needs to be pinned, even if it needs to be updated or
// restarted." Approved the design: "Yeah, go ahead with all three."
describe('0.7.6 (Rob, 10-27: "always pin the most recent thread from that client"): a client keeps its one thread; Start only for a client with none', () => {
  const ROAD = '44444444-4444-4444-8444-444444444444'
  const LT = '88888888-8888-4888-8888-888888888888'
  const FNI = '77777777-7777-4777-8777-777777777777'
  /** Road Dog's own thread, archived (a made-up id: the real one, archived on 10-23, was local_e3d41434-…). */
  const ROAD_SID = 'local_roaddog'
  const ROAD_OLD_TITLE = '🔴 3h late · Road Dog Industrial · your draft'
  /** The name a thread of Road Dog's gets while its drafts are ready, whatever the hours left on the test's clock. */
  const ROAD_NAMED = /^🟡 \d+h left · Road Dog Industrial · reply ready$/
  const LT_SID = 'local_leadertr'
  /** Every line written to the notice log (the pretend disk never reads a write back, so each write holds its new line alone). */
  const notices = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('')
  const count = (text: string, part: string) => text.split(part).length - 1
  const after = async (w: { clock: { advance: (ms: number) => Promise<void> } }, minutes: number) => {
    for (let i = 0; i < minutes; i++) await w.clock.advance(60_000)
  }
  const unarchives = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'unarchive_session').map(c => String(c.args.session_id))
  /** A client's prepared package, its drafts ready, covering mail up to `covers`. */
  const draftFor = (projectId: string, name: string, covers = ago(3)) => ({
    package_id: `aaaaaaaa-bbbb-4ccc-8ddd-${projectId.slice(-12)}`, project_id: projectId, project_name: name, status: 'prepared', covers_through: covers, drafts_ready: 1, project_owner_email: ME,
  })
  const roadFeed = (covers = ago(3)): Feed => feed({ drafts: [draftFor(ROAD, 'Road Dog Industrial', covers)], mail: [], tickets: {}, threads: [] })
  /** Road Dog on the list, its own thread archived in the app (last active 13 days ago); an unrelated open thread keeps the list complete. */
  const roadWorld = (on: On, more: WorldOptions = {}) =>
    world(on, {
      tools: 'start',
      feed: roadFeed(),
      threads: [thread('local_other', 'Unrelated notes', 100), thread(ROAD_SID, ROAD_OLD_TITLE, 13 * 24, { isArchived: true })],
      ...more,
      store: { 'mm.links': { [ROAD]: ROAD_SID }, 'mm.titles': { [ROAD_SID]: "Road Dog: send Mark's email as Jim or as Rob?" }, ...(more.store ?? {}) },
    })

  for (const [how, store] of [
    ['linked when it was archived', {}],
    ['let go by an older version (10-23: "archived = let go"), and opened with its marker', { 'mm.links': {}, 'mm.marked': { [ROAD_SID]: ROAD }, 'mm.markedAt': { [ROAD_SID]: NOW - 13 * 24 * HOUR } }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`[Road Dog] its own archived thread (${how}) is unarchived, linked, pinned and named, and its update goes in by itself; no Start is offered`, LONG, async ($, on) => {
      const w = roadWorld(on, { store })
      await tickOnce($, w)
      expect(unarchives(w)).toEqual([ROAD_SID])
      expect(w.stored['mm.links']).toEqual({ [ROAD]: ROAD_SID })
      // the bridge's own link, as one it takes back
      expect((w.stored['mm.auto'] as Record<string, { sid: string }>)[ROAD]?.sid).toBe(ROAD_SID)
      const t = w.threads.get(ROAD_SID)
      expect(t?.isArchived).toBe(false)
      expect(t?.pinned).toBe(true)
      expect(t?.title).toMatch(ROAD_NAMED)
      expect(count(notices(w), `brought back Road Dog Industrial (${ROAD}): unarchived ${ROAD_SID}, its own thread, to link, pin and name it`)).toBe(1)
      // its row is its thread's Update, and no client needs a thread started
      const ui = await pane($)
      expect(await buttonsOf(ui, ROAD)).toEqual(['Update thread', 'Drafts'])
      await ui.unmount()
      expect(await kickoffsOf($)).toEqual([])
      // the update by itself, under its own wait: into that thread, the marker first
      await after(w, 11)
      await w.clock.advance(3_000)
      expect(sends(w).map(c => c.args.session_id)).toEqual([ROAD_SID])
      expect(String(sends(w)[0]?.args.message).startsWith(`[mm-link ${ROAD}] `)).toBe(true)
      // ⛔ nothing started, carded or minted, and the app is asked once
      await after(w, 30)
      expect(sends(w).length).toBe(1)
      expect(unarchives(w)).toEqual([ROAD_SID])
      expect(starts(w)).toEqual([])
      expect(w.minted()).toEqual([])
      expect(w.fills).toEqual([])
    })
  }

  for (const how of ['refuse', 'error', 'silent'] as const) {
    test(`the app does not unarchive it (${how}): nothing is linked, pinned, named or stamped; one line in the notice log; (0.7.10) the row offers Restore thread, never Start; asked again only when something newer arrives`, LONG, async ($, on) => {
      const w = roadWorld(on, { unarchive: how })
      await tickOnce($, w)
      // (silent: the sync waits the app out, 15 seconds)
      await w.clock.advance(16_000)
      expect(unarchives(w)).toEqual([ROAD_SID])
      expect(w.stored['mm.links']).toEqual({})
      expect(w.stored['mm.acted']).toBeUndefined()
      expect(w.threads.get(ROAD_SID)).toMatchObject({ isArchived: true, pinned: false, title: ROAD_OLD_TITLE })
      // the one app call for that thread is the ask itself: no pin, no name, no message
      expect(w.writes().filter(x => x.includes(ROAD_SID))).toEqual([`unarchive_session | ${ROAD_SID} | `])
      expect((w.stored['mm.revived'] as Record<string, { pid: string; ok: boolean | null }>)[ROAD_SID]).toMatchObject({ pid: ROAD, ok: false })
      const line = `not brought back Road Dog Industrial (${ROAD}) ${ROAD_SID}: the app did not unarchive it (refused, failed, or no answer in 15 seconds); asked again only when something newer arrives`
      expect(count(notices(w), line)).toBe(1)
      // (0.7.10, Rob 10-28; until 0.7.10 its row was a Start, and Start missing threads gave it) its own thread is still
      // its own: the row offers Restore thread, and no new thread is handed out for it
      const ui = await pane($)
      expect(await buttonsOf(ui, ROAD)).toEqual(['Restore thread', 'Drafts'])
      await ui.unmount()
      expect(await kickoffsOf($)).toEqual([])
      // ⛔ not asked again on every sync
      await after(w, 30)
      expect(unarchives(w)).toEqual([ROAD_SID])
      expect(count(notices(w), line)).toBe(1)
      expect(sends(w)).toEqual([])
      // something newer arrives for the client: asked once more
      w.setFeed(roadFeed(ago(1)))
      await after(w, 7)
      expect(unarchives(w)).toEqual([ROAD_SID, ROAD_SID])
      await after(w, 30)
      expect(unarchives(w)).toEqual([ROAD_SID, ROAD_SID])
      expect(w.stored['mm.links']).toEqual({})
      expect(starts(w)).toEqual([])
    })
  }

  test('archived again by the person after it was brought back: it stays archived until something newer arrives, then it is brought back once', LONG, async ($, on) => {
    const w = roadWorld(on)
    await tickOnce($, w)
    expect(unarchives(w)).toEqual([ROAD_SID])
    expect(w.stored['mm.links']).toEqual({ [ROAD]: ROAD_SID })
    // the person archives it again
    const t = w.threads.get(ROAD_SID)
    if (t) t.isArchived = true
    await after(w, 30)
    expect(unarchives(w)).toEqual([ROAD_SID])
    expect(w.stored['mm.links']).toEqual({})
    // meanwhile (0.7.10; until 0.7.10 a Start) its row offers Restore thread
    const ui = await pane($)
    expect(await buttonsOf(ui, ROAD)).toEqual(['Restore thread', 'Drafts'])
    await ui.unmount()
    // something newer for Road Dog: brought back, once
    w.setFeed(roadFeed(ago(1)))
    await after(w, 7)
    expect(unarchives(w)).toEqual([ROAD_SID, ROAD_SID])
    expect(w.stored['mm.links']).toEqual({ [ROAD]: ROAD_SID })
    expect(w.threads.get(ROAD_SID)).toMatchObject({ isArchived: false, pinned: true })
    await after(w, 30)
    expect(unarchives(w)).toEqual([ROAD_SID, ROAD_SID])
    expect(starts(w)).toEqual([])
  })

  test('at most three threads are asked to come back in one sync; the rest come back on the next', async ($, on) => {
    const ids = [1, 2, 3, 4].map(n => `0000000${n}-0000-4000-8000-00000000000${n}`)
    const f = feed({ drafts: ids.map((id, i) => draftFor(id, `Client ${i + 1}`)), mail: [], tickets: {}, threads: [] })
    const w = world(on, {
      feed: f,
      threads: [thread('local_other', 'Unrelated notes', 100), ...ids.map((_, i) => thread(`local_arch${i + 1}`, `Client ${i + 1} work`, 48, { isArchived: true }))],
      store: { 'mm.links': Object.fromEntries(ids.map((id, i) => [id, `local_arch${i + 1}`])) },
    })
    await mm($, '')
    expect(unarchives(w).length).toBe(3)
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect(new Set(unarchives(w))).toEqual(new Set(ids.map((_, i) => `local_arch${i + 1}`)))
    expect(unarchives(w).length).toBe(4)
    expect(w.stored['mm.links']).toEqual(Object.fromEntries(ids.map((id, i) => [id, `local_arch${i + 1}`])))
  })

  test('while the bridge is paused, no thread is asked to come back', async ($, on) => {
    const w = roadWorld(on, { store: { 'mm.paused': true } })
    await tickOnce($, w)
    await mm($, '')
    await after(w, 30)
    expect(unarchives(w)).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('[Leader Transcend] a thread whose only marker came in an Update: the Update puts it on record, and once its link is gone the thread is taken back; no Start', LONG, async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [draftFor(LT, 'Leader Transcend')], mail: [], tickets: {}, threads: [] }), threads: [thread('local_other', 'Unrelated notes', 100), thread(LT_SID, 'Vistage chair candidates Long Island', 30)], store: { 'mm.links': { [LT]: LT_SID } } })
    await tickOnce($, w)
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual([LT_SID])
    // the update's marker is the thread's on record, as an opening message's is
    expect((w.stored['mm.marked'] as Record<string, string>)[LT_SID]).toBe(LT)
    expect(typeof (w.stored['mm.markedAt'] as Record<string, number>)[LT_SID]).toBe('number')
    // the link goes the way it went on 10-19 (an older version took the app's "not found" from another profile for
    // "deleted"), and the feed lists no session of the thread: before 0.7.6 nothing could take it back
    w.stored['mm.links'] = {}
    w.stored['mm.auto'] = {}
    await after(w, 7)
    expect(w.stored['mm.links']).toEqual({ [LT]: LT_SID })
    const ui = await pane($)
    expect((await buttonsOf(ui, LT))[0]).not.toBe('Start thread')
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(starts(w)).toEqual([])
    expect(unarchives(w)).toEqual([])
  })

  test('[Leader Transcend] the same from what an older version left: no marker, no link, but its kickoff last went to that thread (`mm.sent`): taken back; no Start', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: feed({ drafts: [draftFor(LT, 'Leader Transcend')], mail: [], tickets: {}, threads: [] }),
      threads: [thread('local_other', 'Unrelated notes', 100), thread(LT_SID, '✓ Leader Transcend · clear 10:07 PM', 11 * 24)],
      store: { 'mm.sent': { [LT]: { sid: LT_SID, sig: 'an older signature', at: NOW - 11 * 24 * HOUR } } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [LT]: LT_SID })
    const ui = await pane($)
    expect(await buttonsOf(ui, LT)).toEqual(['Update thread', 'Drafts'])
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(starts(w)).toEqual([])
  })

  test('a pressed Update puts the client\'s marker on record for its thread too; never over another client\'s marker', async ($, on) => {
    const w = world(on, { threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [ACME]: 'local_a', [BOLT]: 'local_b' }, 'mm.marked': { local_b: CEDAR } } })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.press({ key: `update:${BOLT}` })
    await ui.unmount()
    expect(sends(w).map(c => c.args.session_id)).toEqual(['local_a', 'local_b'])
    expect(w.stored['mm.marked']).toEqual({ local_a: ACME, local_b: CEDAR })
  })

  test('a linked thread 30 business days old: its row says Update, its update goes into it by itself, and nothing is started', async ($, on) => {
    const w = world(on, { tools: 'start', feed: roadFeed(), threads: [thread('local_other', 'Unrelated notes', 100), thread(ROAD_SID, 'Road Dog intake', 42 * 24)], store: { 'mm.links': { [ROAD]: ROAD_SID } } })
    await tickOnce($, w)
    const ui = await pane($)
    expect(await buttonsOf(ui, ROAD)).toEqual(['Update thread', 'Drafts'])
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    await after(w, 11)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => c.args.session_id)).toEqual([ROAD_SID])
    expect((w.stored['mm.autoupdates'] as Array<{ reason: string }>)[0]?.reason).toBe('something new for the client: drafts ready')
    await after(w, 30)
    expect(sends(w).length).toBe(1)
    expect(starts(w)).toEqual([])
    expect(w.minted()).toEqual([])
    expect(w.fills).toEqual([])
    expect(w.threads.get(ROAD_SID)?.pinned).toBe(true)
  })

  test('[F&I] a client worked only in threads shared with another client: its row keeps Start, and a shared thread is never pinned, named, unarchived or updated for it, even once the feed stops listing its sessions', LONG, async ($, on) => {
    const rows = [declared(FNI, 'cli-f1', 20), declared(ACME, 'cli-a1', 10), declared(FNI, 'cli-f2', 100), declared(ACME, 'cli-a2', 90)]
    const fni = (threads: Feed['threads']): Feed => feed({ drafts: [draftFor(FNI, 'F&I Solutions'), draftFor(ACME, 'Acme Roofing — Pat')], mail: [], tickets: {}, threads })
    const w = world(on, {
      tools: 'start',
      feed: fni(rows),
      threads: [thread('local_other', 'Unrelated notes', 100), thread('local_shared', 'F&I and Acme notes', 10), thread('local_shared2', 'F&I first call', 90, { isArchived: true })],
      store: {
        'mm.threads': { 'cli-f1': { app: 'local_shared', at: NOW }, 'cli-a1': { app: 'local_shared', at: NOW }, 'cli-f2': { app: 'local_shared2', at: NOW }, 'cli-a2': { app: 'local_shared2', at: NOW } },
        // the archived one opened with F&I's marker: it is still shared, so it is nobody's by itself (B3)
        'mm.marked': { local_shared2: FNI },
      },
    })
    await tickOnce($, w)
    await after(w, 30)
    const untouched = () => {
      expect(unarchives(w)).toEqual([])
      expect(w.writes().filter(x => x.includes('local_shared'))).toEqual([])
      expect((w.stored['mm.links'] as Record<string, string> | undefined)?.[FNI]).toBeUndefined()
      expect(Object.values((w.stored['mm.links'] ?? {}) as Record<string, string>).filter(s => s.startsWith('local_shared'))).toEqual([])
    }
    untouched()
    // on record for good (`mm.shared`)
    expect(Object.keys((w.stored['mm.shared'] ?? {}) as Record<string, number>).sort()).toEqual(['local_shared', 'local_shared2'])
    const ui = await pane($)
    expect(await buttonsOf(ui, FNI)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    expect((await kickoffsOf($)).map(k => k.client)).toContain('F&I Solutions')
    // the feed lists the last 14 days only: once it no longer lists those sessions, the shared threads stay nobody's
    w.setFeed(fni([]))
    await after(w, 30)
    untouched()
    expect(starts(w)).toEqual([])
  })
})

// ======================================================================== (0.7.10) kickoffs and archived own threads
// Rob, 2026-10-28, backfilling one thread per client: nine clients came back in the next kickoffs batch before their new
// threads' markers linked them; the batch's threads took the asking thread's shell folder after a `cd`; and a client
// whose own thread stayed archived was offered a fresh Start. Rule (10-27/10-28): one thread per client, and Start only
// for a client that never had a thread of its own. Rob, 10-29: the team works from the one folder they allowed the time
// tracker to track, so a client's thread must never start outside it.
describe('0.7.10 (Rob, 10-28): kickoffs never hand a client out twice, start in the client-thread folder, and an archived own thread is restored, never restarted', () => {
  const ROAD = '44444444-4444-4444-8444-444444444444'
  const ROAD_SID = 'local_roaddog'
  const ROAD_OLD_TITLE = '🔴 3h late · Road Dog Industrial · your draft'
  const unarchives = (w: { calls: Call[] }) => w.calls.filter(c => c.tool === 'unarchive_session').map(c => String(c.args.session_id))
  const roadFeed = (covers = ago(3)): Feed =>
    feed({
      drafts: [{ package_id: `aaaaaaaa-bbbb-4ccc-8ddd-${ROAD.slice(-12)}`, project_id: ROAD, project_name: 'Road Dog Industrial', status: 'prepared', covers_through: covers, drafts_ready: 1, project_owner_email: ME }],
      mail: [],
      tickets: {},
      threads: [],
    })
  /** Road Dog on the list, its own thread archived; the app answers unarchive_session as `mode()` says at the time. */
  const roadWorld = (on: On, mode: () => 'refuse' | 'error' | 'silent' | undefined, more: WorldOptions = {}) =>
    world(on, {
      tools: 'start',
      feed: roadFeed(),
      unarchive: mode,
      threads: [thread('local_other', 'Unrelated notes', 100), thread(ROAD_SID, ROAD_OLD_TITLE, 13 * 24, { isArchived: true })],
      ...more,
      store: { 'mm.links': { [ROAD]: ROAD_SID }, ...(more.store ?? {}) },
    })
  const pidOf = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
  const tenClients = () => feed({ drafts: [], tickets: {}, mail: Array.from({ length: 10 }, (_, i) => mailFor(pidOf(i), `Client ${i}`, 1 + i)) })
  const pidIn = (k: Kick) => /^\[mm-link ([0-9a-f-]{36})\]/.exec(k.arguments.prompt)?.[1] ?? ''

  test('[10-28] ten clients, kickoffs asked again before the new threads link: the next batch hands out only the two not yet handed out, and names the eight as pending; nobody twice', async ($, on) => {
    const w = world(on, { tools: 'start', feed: tenClients() })
    await mm($, '')
    const first = await tool($, 'kickoffs')
    const batch1 = kicksIn(first)
    expect(batch1.length).toBe(8)
    expect(first.split('\n').at(-1)).toBe('2 more need a thread: once these have started, call mm with "kickoffs" again.')
    // the model does as told, before any of the eight new threads has linked itself
    const second = await tool($, 'kickoffs')
    const batch2 = kicksIn(second)
    expect(batch2.length).toBe(2)
    expect(batch2.map(pidIn).filter(pid => batch1.map(pidIn).includes(pid))).toEqual([])
    expect(second).toContain(`Already handed out in the last 10 minutes and not linked yet: ${batch1.map(k => k.client).join(', ')}. Do not start them again`)
    expect(second).not.toContain('more need')
    // and once more: nothing left to hand out, and all ten pending
    const third = await tool($, 'kickoffs')
    expect(kicksIn(third)).toEqual([])
    expect(third).toContain('Already handed out in the last 10 minutes and not linked yet: ')
    expect(third).not.toBe('No client needs a new thread now.')
    // a single ask for one of them is held back too
    const one = await tool($, 'kickoffs Client 0')
    expect(kicksIn(one)).toEqual([])
    expect(one).toContain('not linked yet: Client 0. Do not start it again')
    // the band's button stays until the threads exist (0.5.25): a press of it only asks kickoffs again, which holds them back
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'Start missing threads (10)']])
    await band.unmount()
    expect(starts(w)).toEqual([])
  })

  test('a pending client comes back once KICKOFF_PENDING_MS has passed with its thread still not linked; one that linked does not', async ($, on) => {
    const w = world(on, { tools: 'start', feed: feed({ drafts: [], tickets: {}, mail: [0, 1].map(i => mailFor(pidOf(i), `Client ${i}`, 1 + i)) }) })
    await mm($, '')
    expect((await kickoffsOf($)).length).toBe(2)
    expect(await kickoffsOf($)).toEqual([])
    // Client 0's thread opened and linked itself; Client 1's start was never allowed
    w.stored['mm.links'] = { [pidOf(0)]: 'local_new_0' }
    // (0.7.20) the new thread is in the app: kickoffs now syncs before it hands out Client 1, and a sync drops a link to a
    // thread the app and its records do not have
    w.threads.set('local_new_0', thread('local_new_0', 'Client 0 work', 0))
    for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
    expect((await kickoffsOf($)).map(k => k.client)).toEqual(['Client 1'])
  })

  test('the folder: the one the member\'s linked client threads run in, inside the tracked folder; never the asking thread\'s shell folder', async ($, on) => {
    const env = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/Users/someone' }
    const consent = { '/Users/someone/.claude/mm-hooks/consent.json': { text: JSON.stringify({ v: 2, allowlist: ['/Users/someone/Library/Application Support/Claude/scratch-workspaces', '/Users/someone/Massmarket'] }), mtimeMs: NOW } }
    const w = world(on, {
      tools: 'start',
      env,
      files: consent,
      threads: [thread('local_a', 'Acme Roofing work', 2, { cwd: '/Users/someone/Massmarket' }), thread('local_x', 'Repo work', 1, { cwd: '/Users/someone/Massmarket/claude-plugins' })],
      store: { 'mm.links': { [ACME]: 'local_a' } },
    })
    await mm($, '')
    expect(w.stored['mm.folder']).toMatchObject({ dir: '/Users/someone/Massmarket' })
    const kicks = await kickoffsOf($)
    expect(kicks.map(k => k.client)).toEqual(['Cedar Dental', 'Bolt Staffing'])
    for (const k of kicks) expect(k.arguments.cwd).toBe('/Users/someone/Massmarket')
  })

  for (const [how, threadDir, consentList, want] of [
    ['client threads in a folder inside the tracked one', '/Users/someone/Massmarket/clients', ['/Users/someone/Massmarket'], '/Users/someone/Massmarket/clients'],
    ['client threads outside every tracked folder: the tracked folder', '/Users/someone/Elsewhere', ['/Users/someone/Massmarket'], '/Users/someone/Massmarket'],
    ['no client thread names a folder: the tracked folder, the app\'s scratch folder passed over', undefined, ['/Users/someone/Library/Application Support/Claude/scratch-workspaces', '/Users/someone/Massmarket'], '/Users/someone/Massmarket'],
    ['nothing says which folders are tracked: the client threads\' folder', '/Users/someone/Elsewhere', undefined, '/Users/someone/Elsewhere'],
    ['nothing known at all: no folder, so the app uses this thread\'s own', undefined, undefined, undefined],
  ] as Array<[string, string | undefined, string[] | undefined, string | undefined]>) {
    test(`the folder, ${how}`, async ($, on) => {
      const w = world(on, {
        tools: 'start',
        env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/Users/someone' },
        files: consentList ? { '/Users/someone/.claude/mm-hooks/consent.json': { text: JSON.stringify({ v: 2, allowlist: consentList }), mtimeMs: NOW } } : {},
        threads: [thread('local_a', 'Acme Roofing work', 2, threadDir ? { cwd: threadDir } : {})],
        store: { 'mm.links': { [ACME]: 'local_a' } },
      })
      await mm($, '')
      const kicks = await kickoffsOf($)
      expect(kicks.length).toBe(2)
      for (const k of kicks) expect(k.arguments.cwd).toBe(want)
      expect(starts(w)).toEqual([])
    })
  }

  test('[Road Dog] its own thread stays archived (the app refused): Restore thread on its row, never Start; kickoffs hands out nothing for it, and a single ask says to restore it', LONG, async ($, on) => {
    const w = roadWorld(on, () => 'refuse')
    await tickOnce($, w)
    expect(unarchives(w)).toEqual([ROAD_SID])
    expect(w.stored['mm.links']).toEqual({})
    expect((w.stored['mm.last'] as { recs: Record<string, { archived?: string; reason: string }> }).recs[ROAD]).toMatchObject({ state: 'start', reason: 'its thread is archived', archived: ROAD_SID })
    const ui = await pane($)
    expect(await buttonsOf(ui, ROAD)).toEqual(['Restore thread', 'Drafts'])
    await ui.unmount()
    expect(await tool($, 'kickoffs')).toBe('No client needs a new thread now.')
    const one = await tool($, 'kickoffs road dog')
    expect(kicksIn(one)).toEqual([])
    expect(one).toBe('Own thread archived: Road Dog Industrial. Never start a new thread for it: bring it back with mm "restore Road Dog Industrial" (the app may ask the person first).')
    // ⛔ not in the band's Start missing threads, and not on its no-thread list
    const band = await bandOf($)
    expect((await buttons(band)).filter(b => b[0] === 'mm-start-missing')).toEqual([['mm-start-missing', 'All threads started']])
    await band.unmount()
    expect(w.minted()).toEqual([])
    expect(starts(w)).toEqual([])
  })

  test('[Road Dog] Restore thread, pressed: the same thread is unarchived, linked, pinned and named; nothing is started', LONG, async ($, on) => {
    let mode: 'refuse' | undefined = 'refuse'
    const w = roadWorld(on, () => mode)
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({})
    // the person presses Restore thread, and this time allows the app's question
    mode = undefined
    const ui = await pane($)
    await ui.press({ key: `restore:${ROAD}` })
    await w.clock.advance(1_000)
    await ui.unmount()
    expect(unarchives(w)).toEqual([ROAD_SID, ROAD_SID])
    expect(w.stored['mm.links']).toEqual({ [ROAD]: ROAD_SID })
    expect(w.threads.get(ROAD_SID)).toMatchObject({ isArchived: false, pinned: true })
    expect(w.threads.get(ROAD_SID)?.title).not.toBe(ROAD_OLD_TITLE)
    const again = await pane($)
    expect((await buttonsOf(again, ROAD))[0]).not.toBe('Start thread')
    expect((await buttonsOf(again, ROAD))[0]).not.toBe('Restore thread')
    await again.unmount()
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
  })

  test('[Road Dog] /mm restore <client> (and the mm tool\'s restore): the same; refused again, nothing is linked and it says so', LONG, async ($, on) => {
    let mode: 'refuse' | undefined = 'refuse'
    const w = roadWorld(on, () => mode)
    await tickOnce($, w)
    expect(await tool($, 'restore road dog')).toBe('The app did not bring back Road Dog Industrial\'s thread (refused, failed, or no answer in 15 seconds). Nothing was started: press Restore thread to ask again.')
    expect(w.stored['mm.links']).toEqual({})
    mode = undefined
    expect(await mm($, 'restore road dog')).toMatch(/^Road Dog Industrial's own thread is back: ".+"\. It is linked again, and pinned and named as the list comes up to date\.$/)
    expect(w.stored['mm.links']).toEqual({ [ROAD]: ROAD_SID })
    expect(w.threads.get(ROAD_SID)).toMatchObject({ isArchived: false, pinned: true })
    expect(starts(w)).toEqual([])
  })

  test('a client that never had a thread of its own still gets Start, and has nothing to restore', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const ui = await pane($)
    expect(await buttonsOf(ui, CEDAR)).toEqual(['Start thread', 'Drafts'])
    await ui.unmount()
    expect(await mm($, 'restore cedar')).toBe('Cedar Dental has no archived thread of its own to bring back.')
    expect(unarchives(w)).toEqual([])
    expect((await kickoffsOf($, 'cedar')).length).toBe(1)
  })
})

describe('0.7.11 (Rob, 10-30: "switching profiles all the time. It needs to be able to detect and adapt to that."): a client\'s thread follows the person across Claude profiles', () => {
  const CLI_A1 = 'dddddddd-0000-4000-8000-0000000000a1'
  const CLI_LT = 'dddddddd-0000-4000-8000-0000000000b2'
  const LT = '88888888-8888-4888-8888-888888888888'
  const acmeOnly = (): Feed => feed({ mail: [], tickets: {}, threads: [] })
  /** Where Acme's thread in A keeps its transcript on this computer. */
  const TRANSCRIPT = `/home/someone/.claude/projects/-work-acme/${CLI_A1}.jsonl`
  /** The band's words for Acme, its reply due Tuesday 8 AM ET. */
  const ACME_AWAY = 'You switched Claude profiles. 1 client that needs you has its thread in the other one: Acme Roofing (reply due Tue 8 AM ET).'
  /** In profile B now. Acme is linked to local_a1, its thread in profile A (pinned there, run in /work/acme), pinned and named by the bridge. */
  const inB = (on: On, more: { threads?: Thread[]; files?: Record<string, { text: string; mtimeMs: number }>; store?: Record<string, unknown>; feed?: Feed } = {}) =>
    world(on, {
      tools: 'start',
      feed: more.feed ?? acmeOnly(),
      threads: [thread('local_other', 'Unrelated notes', 100), ...(more.threads ?? [])],
      files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_a1', { isStarred: true, cliSessionId: CLI_A1, cwd: '/work/acme' }), ...(more.files ?? {}) },
      store: { 'mm.links': { [ACME]: 'local_a1' }, 'mm.pins': { local_a1: ourPin(ACME, 'Acme Roofing') }, 'mm.titles': { local_a1: 'Roof quote' }, ...(more.store ?? {}) },
    })
  /** Leader Transcend: on no list in B, its thread pinned in A. */
  const ltIn = (on: On, store: Record<string, unknown> = {}) =>
    inB(on, {
      feed: feed({ drafts: [], mail: [], tickets: {}, threads: [] }),
      files: profileRec(PROFILE_A, 'local_lt', { isStarred: true, cliSessionId: CLI_LT, cwd: '/work/lt' }),
      store: { 'mm.links': { [LT]: 'local_lt' }, 'mm.pins': { local_lt: ourPin(LT, 'Leader Transcend') }, 'mm.titles': { local_lt: 'LT build' }, ...store },
    })
  const LT_KICKOFF = `[mm-link ${LT}] Leader Transcend (OW project ${LT}) has nothing on my list right now, and its pinned thread is in another Claude profile. Load the client's project skill first, then show me where it stands and wait for me. Send nothing without my go.\n\nThis client's last thread is in another Claude profile: thread local_lt ("LT build") for Leader Transcend. The session tools here cannot open it. Before anything else, read the last part of its transcript on this computer, /home/someone/.claude/projects/-work-lt/${CLI_LT}.jsonl (only its last 200 lines or so, never the whole file), and list anything left open in it: a question waiting on me, something promised and not done, a draft that was not sent. Keep that list to ten lines, then carry on from where that thread stopped.`

  for (const [how, store] of [
    ['its link in B from before', { 'mm.profileLinks': { [PROFILE_B]: { [ACME]: 'local_b1' } } }],
    ['the thread in B that opened with its marker', { 'mm.marked': { local_b1: ACME }, 'mm.markedAt': { local_b1: NOW - 5 * DAYS } }],
  ] as Array<[string, Record<string, unknown>]>) {
    test(`A to B, the client has an older thread of its own in B (${how}): linked to it, pinned, and its update goes in by itself; no Start, no band, no kickoff`, LONG, async ($, on) => {
      const w = inB(on, { threads: [thread('local_b1', 'Acme, last week', 5 * 24)], store })
      await tickOnce($, w)
      expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_b1' })
      expect(w.threads.get('local_b1')?.pinned).toBe(true)
      // each profile keeps its own link: A's is the one the way back takes
      expect(w.stored['mm.profileLinks']).toEqual({ [PROFILE_B]: { [ACME]: 'local_b1' }, [PROFILE_A]: { [ACME]: 'local_a1' } })
      const ui = await pane($)
      expect(await buttonsOf(ui, ACME)).toEqual(['Update thread', 'Drafts'])
      expect(await awayLine(ui)).toBeUndefined()
      await ui.unmount()
      expect(await kickoffsOf($)).toEqual([])
      await minutesOn(w, 20)
      await w.clock.advance(3_000)
      expect(sends(w).map(c => c.args.session_id)).toEqual(['local_b1'])
      expect(String(sends(w)[0]?.args.message).startsWith(`[mm-link ${ACME}] `)).toBe(true)
      // ⛔ by itself: no start, no card, no words in the box
      expect(starts(w)).toEqual([])
      expect(w.fills).toEqual([])
    })
  }

  test('A to B, no thread of its own in B: (0.7.34) the pane counts it beside Needs you now, with the one button; the press puts the words in the box; kickoffs gives its start with the old thread\'s id and transcript; nothing by itself', LONG, async ($, on) => {
    const w = inB(on)
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a1' })
    const ui = await pane($)
    // (0.7.34, Rob 2026-11-07: "it can say if there are any threads not started and have a 'Start missing threads' button only")
    expect(await awayLine(ui)).toBeUndefined()
    expect(await lines(ui)).toContain('1 thread not started')
    expect((await buttons(ui)).filter(b => b[0] === 'mm-start-all')).toEqual([['mm-start-all', 'Start missing threads']])
    const pressed = ui.press({ key: 'mm-start-all' })
    await w.clock.advance(2_000)
    await pressed
    await ui.unmount()
    expect(w.fills).toEqual([START_ALL])
    expect(starts(w)).toEqual([])
    const kicks = await kickoffsOf($)
    expect(kicks.length).toBe(1)
    const prompt = String(kicks[0]?.arguments.prompt)
    expect(prompt.startsWith(`[mm-link ${ACME}] `)).toBe(true)
    expect(prompt).toContain('This client\'s last thread is in another Claude profile: thread local_a1 ("Roof quote") for Acme Roofing Pat. The session tools here cannot open it.')
    expect(prompt).toContain(`read the last part of its transcript on this computer, ${TRANSCRIPT} (only its last 200 lines or so, never the whole file)`)
    await minutesOn(w, 30)
    expect(starts(w)).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('back to A, the store as the switch to B left it: linked to its thread in A again, pinned there; nothing started and no kickoff after the first visit', LONG, async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: acmeOnly(),
      threads: [thread('local_other', 'Unrelated notes', 100), thread('local_a1', 'Roof quote', 30)],
      files: { ...profileRec(PROFILE_A, SELF), ...profileRec(PROFILE_B, 'local_b1') },
      store: {
        'mm.links': { [ACME]: 'local_b1' },
        'mm.auto': { [ACME]: { sid: 'local_b1', miss: 0, made: NOW - HOUR } },
        'mm.profileLinks': { [PROFILE_B]: { [ACME]: 'local_b1' }, [PROFILE_A]: { [ACME]: 'local_a1' } },
        'mm.profile': { dir: PROFILE_B, since: NOW - 2 * HOUR },
      },
    })
    await tickOnce($, w)
    expect(w.stored['mm.links']).toEqual({ [ACME]: 'local_a1' })
    expect(w.threads.get('local_a1')?.pinned).toBe(true)
    expect(w.stored['mm.profile']).toMatchObject({ dir: PROFILE_A })
    const ui = await pane($)
    expect(await awayLine(ui)).toBeUndefined()
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    await minutesOn(w, 30)
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
  })

  // ⛔ (0.7.13, Rob 10-30: "its saying i have 15 missing client threads which cant be right, all those should exist") A
  // client off the Needs-you list, its thread pinned in A, is not away any more: nothing of it needs the person, its thread
  // is open in A, and the switch routine carries that thread when it was left unfinished in the 24 hours before the switch.
  test('(0.7.13) a client off the Needs-you list whose thread is pinned in A, and that wrote in the last six weeks: not in the band or kickoffs', async ($, on) => {
    const w = ltIn(on, { 'mm.activity': { [LT]: NOW - 3 * DAYS } })
    await tickOnce($, w)
    const ui = await pane($)
    expect(await awayLine(ui)).toBeUndefined()
    expect((await buttons(ui)).filter(b => b[0] === 'mm-away-start')).toEqual([])
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(carryKickoff(LT, 'Leader Transcend', { sid: 'local_lt', title: 'LT build', transcript: `/home/someone/.claude/projects/-work-lt/${CLI_LT}.jsonl` })).toBe(LT_KICKOFF)
    expect(starts(w)).toEqual([])
  })

  test('two presses of Start, then kickoffs twice: the client is handed out once, and the second time it is named as pending', async ($, on) => {
    const w = inB(on)
    await tickOnce($, w)
    const ui = await pane($)
    for (let i = 0; i < 2; i++) {
      const pressed = ui.press({ key: 'mm-start-all' })
      await w.clock.advance(2_000)
      await pressed
    }
    await ui.unmount()
    expect([...new Set(w.fills)]).toEqual([START_ALL])
    expect(starts(w)).toEqual([])
    expect((await kickoffsOf($)).map(k => k.client)).toEqual(['Acme Roofing'])
    const again = await tool($, 'kickoffs')
    expect(kicksIn(again)).toEqual([])
    expect(again).toContain('Already handed out in the last 10 minutes and not linked yet: Acme Roofing. Do not start it again')
  })

  test('the first prompt the person types with no profile seen before carries one line naming the clients in the other profile, once; it starts nothing', async ($, on) => {
    const LINE = `[mm-bridge] ${ACME_AWAY} Do not start any thread on this turn. At the end of your reply, offer the person one button that sends "${START_ALL}" (with no buttons, ask them to send those words).`
    const w = inB(on)
    await tickOnce($, w)
    // no profile on record before this one: not a switch the routine runs for
    expect((w.stored['mm.profile'] as { from?: unknown }).from).toBeUndefined()
    await $.prompt.submit({ text: 'morning', wait: false, origin: { kind: 'composer' } })
    await $.prompt.submit({ text: 'and this', wait: false, origin: { kind: 'composer' } })
    expect(w.prompts.map(p => p.text)).toEqual([`morning\n\n${LINE}`, 'and this'])
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
    expect(sends(w)).toEqual([])
  })

  // ⛔ (0.7.13, Rob 10-30: "i would want all threads pinned unpinned and then only unfinished threads from previous 24 hrs
  // (consolidated when appropriate) and clients that need me per usual bridge procedure repinned")
  const routineOf = (text: string | undefined): string => String(text ?? '').split('\n\n').slice(1).join('\n\n')
  test('(0.7.13) a real switch (A, then B): the first prompt the person types carries the switch routine\'s line, with the switch time and the clients that need him; once a switch; a later switch runs it again; the bridge starts nothing', async ($, on) => {
    const w = inB(on, { store: { 'mm.profile': { dir: PROFILE_A, since: NOW - DAYS } } })
    await tickOnce($, w)
    const profile = w.stored['mm.profile'] as { dir: string; since: number; from: string }
    expect(profile).toMatchObject({ dir: PROFILE_B, from: PROFILE_A })
    await $.prompt.submit({ text: 'morning', wait: false, origin: { kind: 'composer' } })
    await $.prompt.submit({ text: 'and this', wait: false, origin: { kind: 'composer' } })
    expect(w.prompts.map(p => p.text.split('\n\n')[0])).toEqual(['morning', 'and this'])
    const line = routineOf(w.prompts[0]?.text)
    expect(line.startsWith('[mm-bridge] You switched Claude profiles (this one since ')).toBe(true)
    expect(line).toContain(`Standing rule (Rob, 2026-10-30): before anything else on this turn, load the profile-switch skill and run its "Automatic switch routine" with --at ${profile.since}.`)
    expect(line).toContain('It unpins every thread pinned here before the switch, starts and pins only the threads left unfinished in the 24 hours before it (one session for threads that belong together), and starts the client threads that need you with the mm tool\'s kickoffs (1 client that needs you has its thread in the other profile: Acme Roofing (reply due Tue 8 AM ET)).')
    expect(line.endsWith('Then answer the message above. Where start_session or that skill is not available, start nothing and say so in one line.')).toBe(true)
    expect(w.prompts[1]?.text).toBe('and this')
    // the person went to A and came back: the sync finds this thread in B's folder again, after one in A's
    w.stored['mm.profile'] = { dir: PROFILE_A, since: NOW - HOUR }
    await w.clock.advance(60_000)
    await mm($, '')
    await $.prompt.submit({ text: 'back', wait: false, origin: { kind: 'composer' } })
    expect(routineOf(w.prompts.at(-1)?.text)).toContain(`"Automatic switch routine" with --at ${(w.stored['mm.profile'] as { since: number }).since}.`)
    // ⛔ the bridge itself starts, fills and sends nothing
    expect(starts(w)).toEqual([])
    expect(w.fills).toEqual([])
    expect(sends(w)).toEqual([])
  })

  test('(0.7.13) a real switch with no client away: the routine\'s line still rides on the first prompt, saying no client that needs him is there', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: feed({ mail: [], tickets: {}, threads: [] }),
      threads: [thread('local_other', 'Unrelated notes', 100)],
      files: profileRec(PROFILE_B, SELF),
      store: { 'mm.profile': { dir: PROFILE_A, since: NOW - DAYS } },
    })
    await tickOnce($, w)
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
    expect(routineOf(w.prompts[0]?.text)).toContain('starts the client threads that need you with the mm tool\'s kickoffs (no client that needs you has its thread in the other profile).')
    expect(starts(w)).toEqual([])
  })

  test('(0.7.13) no line on a prompt that is not the person\'s own or on a kickoff; the person\'s next own prompt carries the routine', async ($, on) => {
    const w = inB(on, { store: { 'mm.profile': { dir: PROFILE_A, since: NOW - DAYS } } })
    await tickOnce($, w)
    await $.prompt.submit({ text: 'a task note', wait: false, origin: { kind: 'task-notification' } })
    await $.prompt.submit({ text: `[mm-link ${ACME}] kickoff`, wait: false, origin: { kind: 'composer' } })
    expect(w.prompts[0]?.text).toBe('a task note')
    // a kickoff carries what its marker gives it (R5), never the routine
    expect(w.prompts[1]?.text.startsWith(`[mm-link ${ACME}] kickoff`)).toBe(true)
    expect(w.prompts[1]?.text).not.toContain('Automatic switch routine')
    await $.prompt.submit({ text: 'mine', wait: false, origin: { kind: 'composer' } })
    expect(routineOf(w.prompts.at(-1)?.text)).toContain('"Automatic switch routine"')
  })
})

describe('0.7.11 (Rob, 10-30: "I don\'t think we need to be creating threads for people that haven\'t been active or sent us anything for more than a couple months"): only an ACTIVE client, or one with something due for the person, gets a new thread', () => {
  const REM = '99999999-9999-4999-8999-999999999999'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000aa`
  const undatedOn = (pid: string, name: string, n = 1): FeedTicket => ({ ticket_id: tid(n), project_id: pid, project_name: name, title: `Undated ${n}`, due_at: null, due_source: null, assignee_email: ME })
  /** The founder: Bolt listed by an undated ticket of his alone (nothing from Bolt in the feed). */
  const quietBolt = (over: Partial<Feed> = {}): Feed => ({ member: ME, role: 'founder', mail: [], drafts: [], tickets: { undated: [undatedOn(BOLT, 'Bolt Staffing (Sam)')] }, threads: [], ...over })
  const recOf = (w: { stored: Record<string, unknown> }, pid: string) => (w.stored['mm.last'] as { recs: Record<string, Record<string, unknown>> }).recs[pid]
  /** A teammate's ticket on Remver, its ETA needed four hours ago: Remver's only item on the founder's feed. */
  const remverLate = (): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], drafts: [], threads: [],
    tickets: { overdue: [{ ticket_id: tid(9), project_id: REM, project_name: 'Remver Consulting', title: 'Source the NDA', due_at: null, due_source: null, assignee_email: ME, eta_needed_by: new Date(NOW - 4 * HOUR).toISOString(), eta_ask: 'no ETA' } as FeedTicket] },
  })

  test('a client listed by undated tickets alone, with nothing from it in six weeks: its row stays with no Start; Start missing threads and kickoffs leave it out; a new message from it brings Start back on the next sync', async ($, on) => {
    const w = world(on, { tools: 'start', feed: quietBolt(), threads: [] })
    await mm($, '')
    expect(recOf(w, BOLT)).toMatchObject({ state: 'start', dormant: true })
    const ui = await pane($)
    await ui.press({ key: 'mm-fold:undated' })
    expect(await buttonsOf(ui, BOLT)).toEqual(['Drafts'])
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(await mm($, 'start all')).toBe('No client needs a new thread now.')
    // Bolt writes: ACTIVE at once
    w.setFeed(quietBolt({ mail: [mailFor(BOLT, 'Bolt Staffing (Sam)', 1)] }))
    await mm($, '')
    expect(recOf(w, BOLT)?.dormant).toBeUndefined()
    const again = await pane($)
    expect(await buttonsOf(again, BOLT)).toEqual(['Start thread', 'Drafts'])
    await again.unmount()
    expect((await kickoffsOf($)).map(k => k.client)).toEqual(['Bolt Staffing'])
    expect(starts(w)).toEqual([])
  })

  test('the six weeks: a message five weeks ago (off the feed now, its time kept by the bridge) keeps Start; seven weeks ago, none', async ($, on) => {
    const w = world(on, { tools: 'start', feed: quietBolt(), threads: [], store: { 'mm.activity': { [BOLT]: NOW - 35 * DAYS } } })
    await mm($, '')
    expect(recOf(w, BOLT)?.dormant).toBeUndefined()
    w.stored['mm.activity'] = { [BOLT]: NOW - 49 * DAYS }
    await mm($, '')
    expect(recOf(w, BOLT)).toMatchObject({ state: 'start', dormant: true })
    // the time past the window is dropped from the record
    expect(w.stored['mm.activity']).toEqual({})
  })

  test('OW\'s `client_activity` (any channel) counts and is kept: a text from the client last week gives it Start', async ($, on) => {
    const w = world(on, { tools: 'start', feed: quietBolt({ client_activity: [{ project_id: BOLT, at: ago(5 * 24) }] }), threads: [] })
    await mm($, '')
    expect(recOf(w, BOLT)?.dormant).toBeUndefined()
    expect(w.stored['mm.activity']).toEqual({ [BOLT]: NOW - 5 * DAYS })
    expect((await kickoffsOf($)).map(k => k.client)).toEqual(['Bolt Staffing'])
  })

  test('a teammate\'s late ticket is never a reason for a Start: that client, its thread in the other profile, is not in the band or kickoffs; (0.7.13) nor once it wrote in the last six weeks: nothing of it has a clock for the person', async ($, on) => {
    const w = world(on, { tools: 'start', feed: remverLate(), threads: [thread('local_other', 'Unrelated notes', 100)], files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_r1') }, store: { 'mm.links': { [REM]: 'local_r1' } } })
    await mm($, '')
    expect(recOf(w, REM)).toMatchObject({ state: 'start', away: true, dormant: true })
    const ui = await pane($)
    expect(await awayLine(ui)).toBeUndefined()
    await ui.unmount()
    expect(await kickoffsOf($)).toEqual([])
    await $.prompt.submit({ text: 'morning', wait: false, origin: { kind: 'composer' } })
    expect(w.prompts.map(p => p.text)).toEqual(['morning'])
    // Remver wrote two days ago
    w.stored['mm.activity'] = { [REM]: NOW - 2 * DAYS }
    await mm($, '')
    const again = await pane($)
    expect(await awayLine(again)).toBeUndefined()
    await again.unmount()
    expect(await kickoffsOf($)).toEqual([])
    expect(starts(w)).toEqual([])
  })

  test('a quiet client\'s old thread is left alone on a profile switch: its link stays where it was, and its thread here is not linked or pinned', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      feed: quietBolt(),
      threads: [thread('local_other', 'Unrelated notes', 100), thread('local_bb', 'Bolt, in B', 20)],
      files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_ba') },
      store: { 'mm.links': { [BOLT]: 'local_ba' }, 'mm.profileLinks': { [PROFILE_B]: { [BOLT]: 'local_bb' } } },
    })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_ba' })
    expect(w.threads.get('local_bb')).toMatchObject({ title: 'Bolt, in B', pinned: false })
    expect(await kickoffsOf($)).toEqual([])
  })
})

// (0.7.12, Rob 10-30: "It usually says 'due in XYZ hours.' ... I'm not sure why they were pinned in the first place") 0.7.11
// pinned an ACTIVE client's thread whatever its time, undated rows included. A pin needs a clock again: overdue since the
// cut, or due within the next 24 business hours. The count that matches the sidebar (0.7.11) is kept.
describe('0.7.11, as 0.7.12 has it: an ACTIVE client\'s thread with nothing dated is NOT pinned; the count is what the sidebar shows', () => {
  const LT = '88888888-8888-4888-8888-888888888888'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000bb`
  /** The founder: Bolt listed by an undated ticket of his alone, as 26 clients were on 10-30; and Cedar's task due today. */
  const undatedBolt = (): Feed => {
    const base = feed()
    return { ...base, role: 'founder', mail: [], drafts: [], tickets: { ...base.tickets, undated: [{ ticket_id: tid(1), project_id: BOLT, project_name: 'Bolt Staffing (Sam)', title: 'Undated 1', due_at: null, due_source: null, assignee_email: ME }] }, threads: [] }
  }
  const notOurs = { projectId: BOLT, client: 'Bolt Staffing', byUs: false }

  test('[10-30] Bolt wrote three days ago and its only items are undated tickets: (0.7.12) its linked thread is named `no due date` and not pinned (0.7.11 pinned it)', async ($, on) => {
    const w = world(on, { feed: undatedBolt(), threads: [thread('local_b', 'Bolt work', 20)], store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: notOurs }, 'mm.activity': { [BOLT]: NOW - 3 * DAYS } } })
    await mm($, '')
    expect(w.threads.get('local_b')).toMatchObject({ title: '🟡 Bolt Staffing · task · no due date', pinned: false })
    expect(w.writes().filter(c => c.startsWith('set_pinned | local_b'))).toEqual([])
  })

  test('(0.7.12) a pin the bridge put on that active client\'s undated thread comes off', async ($, on) => {
    const w = world(on, {
      feed: undatedBolt(),
      threads: [thread('local_b', 'Bolt work', 20, { pinned: true })],
      store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: { ...notOurs, byUs: true } }, 'mm.activity': { [BOLT]: NOW - 3 * DAYS } },
    })
    await mm($, '')
    expect(w.threads.get('local_b')).toMatchObject({ title: '🟡 Bolt Staffing · task · no due date', pinned: false })
    expect(w.writes().filter(c => c.startsWith('set_pinned | local_b'))).toEqual(['set_pinned | local_b | false'])
    // and it stays off, sync after sync: nothing pins it again
    for (let i = 0; i < 3; i++) await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
    expect(w.writes().filter(c => c.startsWith('set_pinned | local_b'))).toEqual(['set_pinned | local_b | false'])
  })

  test('(0.7.12) a pin the person put on that active client\'s undated thread stays', async ($, on) => {
    const w = world(on, {
      feed: undatedBolt(),
      threads: [thread('local_b', 'Bolt work', 20, { pinned: true })],
      store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: notOurs }, 'mm.activity': { [BOLT]: NOW - 3 * DAYS } },
    })
    for (let i = 0; i < 3; i++) await mm($, '')
    expect(w.threads.get('local_b')).toMatchObject({ title: '🟡 Bolt Staffing · task · no due date', pinned: true })
    expect(w.writes().filter(c => c.startsWith('set_pinned'))).toEqual([])
  })

  test('the person unpinned it: it stays unpinned while nothing newer comes', async ($, on) => {
    const w = world(on, {
      feed: undatedBolt(),
      threads: [thread('local_b', 'Bolt work', 20)],
      store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: { ...notOurs, byUs: true } }, 'mm.activity': { [BOLT]: NOW - 3 * DAYS } },
    })
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
    expect(w.writes().filter(c => c.startsWith('set_pinned | local_b'))).toEqual([])
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
  })

  test('a quiet client (nothing from it in six weeks): its thread is not pinned for it, and our pin comes off', async ($, on) => {
    const w = world(on, { feed: undatedBolt(), threads: [thread('local_b', 'Bolt work', 20, { pinned: true })], store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: { ...notOurs, byUs: true } } } })
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
  })

  test('the count is the client threads this profile shows pinned: the person\'s own pin on a quiet client\'s thread counts; a pin record of a thread in another profile does not', async ($, on) => {
    const w = world(on, {
      feed: undatedBolt(),
      threads: [thread('local_other', 'Unrelated notes', 100), thread('local_b', 'Bolt work', 20, { pinned: true })],
      files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_lt', { isStarred: true }) },
      store: { 'mm.links': { [BOLT]: 'local_b', [LT]: 'local_lt' }, 'mm.pins': { local_b: notOurs, local_lt: ourPin(LT, 'Leader Transcend') } },
    })
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(true)
    expect((w.stored['mm.last'] as { pinned: number }).pinned).toBe(1)
    expect(String(w.statuses.at(-1) ?? '')).toMatch(/^MM: 1 need you · 1 pinned/)
  })
})

// ======================================================================== 0.7.16 (Rob, 2026-11-03)

// (0.7.16, Rob 2026-11-03: "The profile switch routine is supposed to work in conjunction with the bridge and shouldn't
// prevent the bridge from pinning or unpinning anything that should be pinned. I never pinned it myself. Of course, if I
// pin something myself, it should stay there until I unpin it, except for when I'm switching profiles.") At the switch of
// 11-03 the switch routine pinned a new Roman Seges thread; the bridge first saw it pinned, recorded the pin as his, and
// with no clock for that client the thread stayed pinned for good. A switch now hands the client threads' pins to the
// bridge once, and a brand-new kickoff thread's first pin is the bridge's.
describe('0.7.16 (Rob, 11-03: "We always clear out all the pins and then figure out the best way to reorganize"): after a profile switch the bridge decides the pins on client threads', () => {
  const ROMAN = 'abcdabcd-0000-4000-8000-000000000716'
  const CORE = '3e439f40-a17f-48e2-bcfe-723af5b741fc'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000000cc`
  /** When the switch into B was recorded: ten minutes ago. */
  const SINCE = NOW - 10 * 60_000
  const switched = (since = SINCE) => ({ dir: PROFILE_B, since, from: PROFILE_A })
  /** The founder's feed: Roman Seges listed only by a teammate's ticket past its ETA (no clock for him), as on 11-03. */
  const romanLate = (): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], drafts: [], threads: [],
    tickets: { overdue: [{ ticket_id: tid(1), project_id: ROMAN, project_name: 'Roman Seges', title: 'Send the onboarding form', due_at: null, due_source: null, assignee_email: ME, eta_needed_by: new Date(NOW - 4 * HOUR).toISOString(), eta_ask: 'no ETA' } as FeedTicket] },
  })
  /** The founder's feed: Bolt listed only by an undated ticket of his (no clock), and Cedar's task due in 5 hours (a clock). */
  const boltAndCedar = (cedarDue = NOW + 5 * HOUR): Feed => {
    const base = feed()
    const cedar = { ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(cedarDue).toISOString(), due_source: 'commitment', assignee_email: ME }
    return { ...base, role: 'founder', mail: [], drafts: [], threads: [], tickets: { ...(cedarDue - NOW < 24 * HOUR ? { due_today: [cedar] } : { due_soon: [cedar] }), undated: [{ ticket_id: tid(2), project_id: BOLT, project_name: 'Bolt Staffing (Sam)', title: 'Undated 1', due_at: null, due_source: null, assignee_email: ME }] } } as Feed
  }
  /** His own pin on a thread, as the bridge recorded it when it first saw the thread pinned. */
  const hisPin = (projectId: string, client: string) => ({ projectId, client, byUs: false })
  /** In profile B, the switch from A on record (`switch`), with these threads and this store. */
  const inB = (on: On, f: Feed, threads: Thread[], store: Record<string, unknown>, profile: unknown = switched()) =>
    world(on, {
      feed: f,
      threads: [thread('local_other', 'Unrelated notes', 100), ...threads],
      files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_away', { isStarred: true }) },
      store: { ...(profile ? { 'mm.profile': profile } : {}), ...store },
    })
  const pinsOf = (w: { stored: Record<string, unknown> }) => (w.stored['mm.pins'] ?? {}) as Record<string, { byUs: boolean }>
  const pinCalls = (w: { writes: () => string[] }, sid: string) => w.writes().filter(c => c.startsWith(`set_pinned | ${sid} `))

  for (const [what, f, pid, client] of [
    ['[Roman Seges, 11-03] a teammate\'s late ticket', romanLate(), ROMAN, 'Roman Seges'],
    ['undated tickets only', boltAndCedar(), BOLT, 'Bolt Staffing'],
  ] as Array<[string, Feed, string, string]>) {
    // ⛔ (0.7.21, Rob 2026-11-05: "When things are overdue but not assigned to me, I don't think they should be pinned here") a
    // teammate's late ticket never pins the founder's thread: Roman Seges's is handed over and the pass takes it off, as for
    // Bolt (0.7.18 to 0.7.20 kept it pinned, as ours, named `🔴 Roman Seges · check on Builder A · task 4h late`)
    const roman = pid === ROMAN
    test(`(a) a switch hands his recorded pin on a client thread with no clock to the bridge, and the pass takes it off (${what}); with no switch on record it stays, as before`, async ($, on) => {
      const w = inB(on, f, [thread('local_c1', 'Client work', 1, { pinned: true })], { 'mm.links': { [pid]: 'local_c1' }, 'mm.pins': { local_c1: hisPin(pid, client) } })
      await mm($, '')
      expect(w.threads.get('local_c1')?.pinned).toBe(false)
      expect(pinCalls(w, 'local_c1')).toEqual(['set_pinned | local_c1 | false'])
      if (roman) expect(w.threads.get('local_c1')?.title).toBe('🟡 with Builder A · Roman Seges · no ETA')
      expect(w.stored['mm.switchPins']).toEqual({ since: SINCE, at: NOW })
      // the switch stays where it was: this pass did not see a new one
      expect(w.stored['mm.profile']).toEqual(switched())
    })

    test(`(a) control: the same thread with no switch on record keeps his pin (${what})`, async ($, on) => {
      const w = inB(on, f, [thread('local_c1', 'Client work', 1, { pinned: true })], { 'mm.links': { [pid]: 'local_c1' }, 'mm.pins': { local_c1: hisPin(pid, client) } }, { dir: PROFILE_B, since: SINCE })
      await mm($, '')
      expect(w.threads.get('local_c1')?.pinned).toBe(true)
      expect(pinCalls(w, 'local_c1')).toEqual([])
      expect(pinsOf(w).local_c1?.byUs).toBe(false)
      expect(w.stored['mm.switchPins']).toBeUndefined()
    })
  }

  test('(b) a switch hands his pin on a client thread with a clock to the bridge: it stays pinned, now as ours, and comes off once the client has no clock', async ($, on) => {
    const w = inB(on, boltAndCedar(), [thread('local_c', 'Cedar work', 1, { pinned: true })], { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: hisPin(CEDAR, 'Cedar Dental') } })
    await mm($, '')
    expect(w.threads.get('local_c')).toMatchObject({ title: CEDAR_TITLE, pinned: true })
    expect(pinCalls(w, 'local_c')).toEqual([])
    expect(pinsOf(w).local_c).toEqual({ projectId: CEDAR, client: 'Cedar Dental', byUs: true })
    // the task moves out to next week: the pin is ours, so it comes off (his would have stayed)
    w.setFeed(boltAndCedar(NOW + 7 * DAYS))
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(false)
    expect(pinCalls(w, 'local_c')).toEqual(['set_pinned | local_c | false'])
  })

  // ⛔ (0.7.18, B; Rob 2026-11-03: "Our bridge should repin it if there's still something needed") his unpin no longer stays
  // while its client has a clock, switch or not: until 0.7.18 it stayed off until the switch dropped it
  test('(b) a switch drops his unpin: a client thread he took the pin off is pinned again while its client has a clock ((0.7.18) by the next pass, switch or not)', async ($, on) => {
    const w = inB(on, boltAndCedar(), [thread('local_c', 'Cedar work', 1)], { 'mm.links': { [CEDAR]: 'local_c' } }, { dir: PROFILE_B, since: SINCE })
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(true)
    // he takes the pin off: (0.7.18) pinned again by the next pass, named so (until 0.7.18 it stayed off, sync after sync)
    const cedar = w.threads.get('local_c') as Thread
    cedar.pinned = false
    for (let i = 0; i < 2; i++) {
      await w.clock.advance(6 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_c')).toMatchObject({ title: `${CEDAR_TITLE} · still needs you`, pinned: true })
    expect(w.stored['mm.unpinned'] ?? {}).toEqual({})
    // he switches to A and back: it stays pinned, ours, and nothing more is called
    w.stored['mm.profile'] = switched(w.clock.now() - 60_000)
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_c')).toEqual(['set_pinned | local_c | true', 'set_pinned | local_c | true'])
    expect(w.stored['mm.unpinned'] ?? {}).toEqual({})
    expect(pinsOf(w).local_c?.byUs).toBe(true)
  })

  test('(c) an internal project\'s thread is never touched: his pin stays, its record stays his; a thread of the other profile keeps its record', async ($, on) => {
    const coreTask = { ticket_id: 'tc', project_id: CORE, project_name: 'Massmarket Core Snapshot', title: 'Tracker', due_at: null, due_source: null, assignee_email: ME }
    const away = hisPin(ACME, 'Acme Roofing')
    const w = inB(on, feed({ drafts: [], mail: [], tickets: { due_soon: [coreTask] } }), [thread('local_core', 'Massmarket · Tracker', 1, { pinned: true })], {
      'mm.links': { [CORE]: 'local_core', [ACME]: 'local_away' },
      'mm.pins': { local_core: { ...hisPin(CORE, 'Massmarket Core Snapshot'), internal: true }, local_away: away },
    })
    await mm($, '')
    expect(w.threads.get('local_core')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_core')).toEqual([])
    expect(pinsOf(w).local_core).toEqual({ projectId: CORE, client: 'Massmarket Core Snapshot', byUs: false, internal: true })
    expect(pinsOf(w).local_away).toEqual(away)
    // the switch is handed over all the same: nothing here was the bridge's to take
    expect(w.stored['mm.switchPins']).toEqual({ since: SINCE, at: NOW })
  })

  test('(d) the hand-over runs once a switch: a pin he puts back after it stays his, sync after sync; the next switch hands it over again', async ($, on) => {
    const w = inB(on, boltAndCedar(), [thread('local_b', 'Bolt work', 1, { pinned: true })], { 'mm.links': { [BOLT]: 'local_b' }, 'mm.pins': { local_b: hisPin(BOLT, 'Bolt Staffing') } })
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
    // he pins it again himself
    const bolt = w.threads.get('local_b') as Thread
    bolt.pinned = true
    for (let i = 0; i < 3; i++) {
      await w.clock.advance(6 * 60_000)
      await mm($, '')
    }
    expect(w.threads.get('local_b')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_b')).toEqual(['set_pinned | local_b | false'])
    expect(pinsOf(w).local_b?.byUs).toBe(false)
    expect(w.stored['mm.switchPins']).toEqual({ since: SINCE, at: NOW })
    // he switched to A and back: a new switch on record, handed over once more
    w.stored['mm.profile'] = switched(w.clock.now() - 60_000)
    await mm($, '')
    expect(w.threads.get('local_b')?.pinned).toBe(false)
    expect(pinCalls(w, 'local_b')).toEqual(['set_pinned | local_b | false', 'set_pinned | local_b | false'])
    expect((w.stored['mm.switchPins'] as { since: number }).since).toBe(w.clock.now() - 60_000)
  })

  // (0.7.18) (e) and (f) on Bolt, listed by an undated ticket alone (no clock): until 0.7.18 they were on Roman Seges, whose
  // teammate's late ticket now pins for the founder to check on them (0.7.18, C; (a) above)
  for (const [age, handed] of [
    [47, true],
    [49, false],
  ] as Array<[number, boolean]>) {
    test(`(e) the upgrade: no switch handed over on record, and the switch on record is ${age} hours old: ${handed ? 'handed over' : 'left alone'}`, async ($, on) => {
      const w = inB(on, boltAndCedar(), [thread('local_r', 'Bolt work', 1, { pinned: true })], { 'mm.links': { [BOLT]: 'local_r' }, 'mm.pins': { local_r: hisPin(BOLT, 'Bolt Staffing') } }, switched(NOW - age * HOUR))
      await mm($, '')
      expect(w.threads.get('local_r')?.pinned).toBe(!handed)
      expect(pinCalls(w, 'local_r')).toEqual(handed ? ['set_pinned | local_r | false'] : [])
      expect(w.stored['mm.switchPins']).toEqual(handed ? { since: NOW - age * HOUR, at: NOW } : undefined)
    })
  }

  test('(e) with a switch handed over on record, a later one is handed over whatever its age', async ($, on) => {
    const w = inB(on, boltAndCedar(), [thread('local_r', 'Bolt work', 1, { pinned: true })], {
      'mm.links': { [BOLT]: 'local_r' },
      'mm.pins': { local_r: hisPin(BOLT, 'Bolt Staffing') },
      'mm.switchPins': { since: NOW - 9 * DAYS, at: NOW - 9 * DAYS },
    }, switched(NOW - 3 * DAYS))
    await mm($, '')
    expect(w.threads.get('local_r')?.pinned).toBe(false)
    expect(w.stored['mm.switchPins']).toEqual({ since: NOW - 3 * DAYS, at: NOW })
  })

  for (const [minutes, ours] of [
    [10, true],
    [45, false],
  ] as Array<[number, boolean]>) {
    test(`(f) a new thread found pinned with no pin record, its [mm-link] marker for its client ${minutes} minutes old: recorded as ${ours ? 'ours' : 'his'}`, async ($, on) => {
      const w = world(on, {
        feed: boltAndCedar(),
        threads: [thread('local_k', 'Cedar Dental: the intake form', 0, { pinned: true })],
        store: { 'mm.links': { [CEDAR]: 'local_k' }, 'mm.marked': { local_k: CEDAR }, 'mm.markedAt': { local_k: NOW - minutes * 60_000 } },
      })
      await mm($, '')
      expect(w.threads.get('local_k')?.pinned).toBe(true)
      expect(pinsOf(w).local_k).toEqual({ projectId: CEDAR, client: 'Cedar Dental', byUs: ours })
    })
  }

  test('(f) [Roman Seges, 11-03] the kickoff thread the switch routine pinned, its client with no clock: the pin comes off; marked 45 minutes ago, or for another client, it stays his', async ($, on) => {
    // (0.7.18) on Bolt, listed by an undated ticket alone (no clock); the other client's marker is Acme's
    const w = world(on, {
      feed: boltAndCedar(),
      threads: [thread('local_new', 'Bolt Staffing', 0, { pinned: true }), thread('local_old', 'Bolt, older', 2, { pinned: true }), thread('local_odd', 'Bolt, odd', 1, { pinned: true })],
      store: {
        'mm.links': { [BOLT]: 'local_new' },
        'mm.marked': { local_new: BOLT, local_old: BOLT, local_odd: ACME },
        'mm.markedAt': { local_new: NOW - 17 * 60_000, local_old: NOW - 45 * 60_000, local_odd: NOW - 5 * 60_000 },
      },
    })
    await mm($, '')
    expect(w.threads.get('local_new')?.pinned).toBe(false)
    expect(pinCalls(w, 'local_new')).toEqual(['set_pinned | local_new | false'])
    // the older-marked and the other client's threads, each linked in a world of its own, keep his pin
    for (const [sid, marker, at] of [
      ['local_old', BOLT, NOW - 45 * 60_000],
      ['local_odd', ACME, NOW - 5 * 60_000],
    ] as Array<[string, string, number]>) {
      w.stored['mm.links'] = { [BOLT]: sid }
      w.stored['mm.marked'] = { [sid]: marker }
      w.stored['mm.markedAt'] = { [sid]: at }
      delete w.stored['mm.pins']
      await mm($, '')
      expect(w.threads.get(sid)?.pinned).toBe(true)
      expect(pinCalls(w, sid)).toEqual([])
      expect(pinsOf(w)[sid]?.byUs).toBe(false)
    }
  })
})

// ======================================================================== 0.7.18 (Rob, 2026-11-03)

// (0.7.18) C: "The pinned is for when action is needed from you, not when something has a timer left for a teammate to
// answer." B: "if something needs attention from the team member and they've unpinned it, the most recent thread for that
// client should always be repinned again." A: "we should open those so that it can always repin the oldest one in the
// future": a client whose thread is in this profile is linked to it, never counted as missing.
describe('0.7.18 C (Rob, 11-03: "The pinned is for when action is needed from you"): a teammate\'s part pins only for the PM to check on them; (0.7.21) never for the founder', () => {
  const ASIF = 'asif@example.com'
  const PKG2 = 'aaaaaaa2-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000007c0`
  const pinCalls = (w: { writes: () => string[] }, sid: string) => w.writes().filter(c => c.startsWith(`set_pinned | ${sid} `))
  /** The founder's feed: Acme's package flagged for his OK, which Asif sends, its reply due in `dueH` hours; and his own undated task there. */
  const robFeed = (dueH: number): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], threads: [],
    drafts: [{ package_id: PKG2, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: ago(3), due_at: new Date(NOW + dueH * HOUR).toISOString(), drafts_ready: 2, flagged_for_rob: true, project_owner_email: ASIF }],
    tickets: { undated: [{ ticket_id: tid(1), project_id: ACME, project_name: 'Acme Roofing — Pat', title: 'Check the roof sizes', due_at: null, due_source: null, assignee_email: FOUNDER }] },
  })

  test('[11-03] the founder: "may need your OK · Asif decides" is named and NOT pinned, 19 hours left or (0.7.21) 1', async ($, on) => {
    const w = world(on, { feed: robFeed(19), threads: [thread('local_a', 'Acme work', 2)], store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.activity': { [ACME]: NOW - DAYS } } })
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: '🟡 19h left · Acme Roofing · may need your OK · Asif decides', pinned: false })
    expect(pinCalls(w, 'local_a')).toEqual([])
    // 1 hour left: (0.7.21) still Asif's, never pinned for the founder to check on him (0.7.18 to 0.7.20 pinned it from 2
    // business hours out, named `🔴 Acme Roofing · check on Asif · reply due 12 PM`)
    w.setFeed(robFeed(1))
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: '🔴 1h left · Acme Roofing · may need your OK · Asif decides', pinned: false })
    expect(pinCalls(w, 'local_a')).toEqual([])
    // Asif sent it (the feed lists it no more): the client is clear, and the pin comes off
    w.setFeed({ ...robFeed(1), drafts: [] })
    await mm($, '')
    expect(w.threads.get('local_a')?.pinned).toBe(false)
  })

  test('(0.7.34) the PM: a teammate\'s ticket past its start-by with no sign it started pins nothing, and a pin 0.7.33 left for it comes off', async ($, on) => {
    const H9 = 'has9@example.com'
    const t = (startByH: number, status = 'open'): FeedTicket => ({
      ticket_id: tid(2), project_id: CEDAR, project_name: 'Cedar Dental', title: 'Build the intake flow', due_at: new Date(NOW + 30 * HOUR).toISOString(), due_source: 'commitment',
      assignee_email: ASIF, start_by_at: new Date(NOW + startByH * HOUR).toISOString(), status,
    })
    const pmFeed = (tk: FeedTicket): Feed => ({ member: H9, role: 'pm', mail: [], drafts: [], threads: [], tickets: { due_soon: [tk] } })
    const w = world(on, {
      feed: pmFeed(t(-1)),
      threads: [thread('local_c', '🟡 Cedar Dental · check on Asif · behind · not started, had to start 10 AM', 2, { pinned: true })],
      store: { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: { projectId: CEDAR, client: 'Cedar Dental', byUs: true } } },
    })
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(false)
    expect((w.stored['mm.last'] as { teammate?: unknown[] }).teammate ?? []).toEqual([])
  })
})

describe('0.7.18 B (Rob, 11-03: "Our bridge should repin it if there\'s still something needed"): the person\'s unpin never hides a client that still needs them', () => {
  const pinCalls = (w: { writes: () => string[] }, sid: string) => w.writes().filter(c => c.startsWith(`set_pinned | ${sid} `))
  const cedarIn = (dueH: number): Feed => feed({ drafts: [], mail: [], threads: [], tickets: { [dueH < 24 ? 'due_today' : 'due_soon']: [{ ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(NOW + dueH * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }] } })

  test('the person takes the pin off while the task is due in 5 hours: pinned again on the next pass, named `· still needs you`, again after a second unpin; once nothing pins it, our pin comes off and the name is plain', async ($, on) => {
    const w = world(on, { feed: cedarIn(5), threads: [thread('local_c', 'Cedar work', 2)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
    await mm($, '')
    expect(w.threads.get('local_c')).toMatchObject({ title: CEDAR_TITLE, pinned: true })
    const cedar = w.threads.get('local_c') as Thread
    cedar.pinned = false
    await mm($, '')
    expect(w.threads.get('local_c')).toMatchObject({ title: `${CEDAR_TITLE} · still needs you`, pinned: true })
    expect((w.stored['mm.pins'] as Record<string, unknown>).local_c).toEqual({ projectId: CEDAR, client: 'Cedar Dental', byUs: true, again: true })
    // the marker stays while it is pinned for it, sync after sync
    await mm($, '')
    expect(w.threads.get('local_c')).toMatchObject({ title: `${CEDAR_TITLE} · still needs you`, pinned: true })
    cedar.pinned = false
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_c')).toEqual(['set_pinned | local_c | true', 'set_pinned | local_c | true', 'set_pinned | local_c | true'])
    // the task moves out to next week: nothing pins it; our pin comes off and the marker goes
    w.setFeed(cedarIn(7 * 24))
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(false)
    expect(w.threads.get('local_c')?.title).not.toContain('still needs you')
    expect((w.stored['mm.pins'] as Record<string, { again?: true }>).local_c?.again).toBeUndefined()
  })

  test('an unpin of a thread with nothing needed stays off, something new arriving or not; a pin the person put on stays theirs', async ($, on) => {
    const w = world(on, { feed: cedarIn(3 * 24), threads: [thread('local_c', 'Cedar work', 2, { pinned: true }), thread('local_d', 'Mine', 3, { pinned: true })], store: { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: ourPin(CEDAR, 'Cedar Dental') } } })
    // ours comes off: the task is three days out
    await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(false)
    // a second task arrives, still days out: nothing pins it
    w.setFeed(feed({ drafts: [], mail: [], threads: [], tickets: { due_soon: [1, 2].map(n => ({ ticket_id: `t${n}`, project_id: CEDAR, project_name: 'Cedar Dental', title: `Task ${n}`, due_at: new Date(NOW + (70 + n) * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME })) } }))
    for (let i = 0; i < 2; i++) await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(false)
    expect(w.threads.get('local_c')?.title).not.toContain('still needs you')
    // the person's own pin on a thread that is no client's is never touched
    expect(w.threads.get('local_d')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_d')).toEqual([])
  })

  test('a client thread the person pinned stays pinned and theirs, nothing needed or not', async ($, on) => {
    const w = world(on, { feed: cedarIn(3 * 24), threads: [thread('local_c', 'Cedar work', 2, { pinned: true })], store: { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: { projectId: CEDAR, client: 'Cedar Dental', byUs: false } } } })
    for (let i = 0; i < 2; i++) await mm($, '')
    expect(w.threads.get('local_c')?.pinned).toBe(true)
    expect(pinCalls(w, 'local_c')).toEqual([])
    expect(w.threads.get('local_c')?.title).not.toContain('still needs you')
  })
})

describe('0.7.18 A (Rob, 11-03: "it can always repin the oldest one"): a client whose thread is in this profile is linked to it, never counted as missing', () => {
  /** The founder's feed: Bolt listed by an undated ticket of his alone, as Black-Peak and Ground Crew Systems were on 11-03. */
  const undatedBolt = (): Feed => {
    const base = feed()
    return { ...base, role: 'founder', mail: [], drafts: [], tickets: { undated: [{ ticket_id: '00000001-0000-4000-8000-0000000007a0', project_id: BOLT, project_name: 'Bolt Staffing (Sam)', title: 'Undated 1', due_at: null, due_source: null, assignee_email: ME }] }, threads: [] }
  }
  /** Forty-five pin records of threads in profile A, as 54 were on 11-03: they spend the sync's record files (RECORDS_PER_SYNC). */
  const farPins = Object.fromEntries(Array.from({ length: 45 }, (_, n) => [`local_p${n}`, ourPin(`${String(n).padStart(8, '0')}-0000-4000-8000-0000000007a1`, `Client ${n}`)]))
  const farFiles = Object.assign({}, ...Array.from({ length: 45 }, (_, n) => profileRec(PROFILE_A, `local_p${n}`)))
  const inB = (on: On, f: Feed, threads: Thread[], store: Record<string, unknown>, files: Record<string, { text: string; mtimeMs: number }> = {}) =>
    world(on, {
      tools: 'start',
      feed: f,
      threads: [thread('local_other', 'Unrelated notes', 100), ...threads],
      files: { ...profileRec(PROFILE_B, SELF), ...files },
      store: { 'mm.profile': { dir: PROFILE_B, since: NOW - DAYS, from: PROFILE_A }, 'mm.switchPins': { since: NOW - DAYS, at: NOW - DAYS }, 'mm.activity': { [BOLT]: NOW - 15 * DAYS, [ACME]: NOW - 2 * DAYS }, ...store },
    })

  test('[Black-Peak, 11-03] its thread here is marked as its own, its newest own thread (the last kickoff\'s) is in another profile, and the sync\'s record files are spent: linked to its thread here, named, and not counted as missing', async ($, on) => {
    const w = inB(on, undatedBolt(), [thread('local_bp', '🔴 2h left · Bolt Staffing · your draft', 3)], {
      'mm.pins': farPins,
      'mm.marked': { local_bp: BOLT, local_far: BOLT },
      'mm.markedAt': { local_far: NOW - 20 * DAYS },
      'mm.sent': { [BOLT]: { sid: 'local_far', sig: 'x', at: NOW - 15 * DAYS } },
    }, { ...farFiles, ...profileRec(PROFILE_A, 'local_far') })
    await mm($, '')
    expect((w.stored['mm.links'] as Record<string, string>)[BOLT]).toBe('local_bp')
    expect(w.threads.get('local_bp')).toMatchObject({ title: '🟡 Bolt Staffing · task · no due date', pinned: false })
    expect(await kickoffsOf($)).toEqual([])
    expect(await tool($, 'kickoffs')).not.toContain('Bolt')
  })

  test('linked to a thread of the other profile: moved to the client\'s own thread here (by its pin record), pinned and named', async ($, on) => {
    const acme = feed({ mail: [], tickets: {}, threads: [] })
    const w = inB(on, acme, [thread('local_here', 'Roof quote, older', 30)], {
      'mm.links': { [ACME]: 'local_a1' },
      'mm.pins': { local_a1: ourPin(ACME, 'Acme Roofing'), local_here: { projectId: ACME, client: 'Acme Roofing', byUs: false } },
    }, profileRec(PROFILE_A, 'local_a1', { isStarred: true }))
    await mm($, '')
    expect((w.stored['mm.links'] as Record<string, string>)[ACME]).toBe('local_here')
    expect(w.threads.get('local_here')?.pinned).toBe(true)
    expect(w.threads.get('local_here')?.title).toContain('Acme Roofing')
  })

  test('⛔ a link to a thread open here is never touched, however new the client\'s other own thread here is', async ($, on) => {
    const acme = feed({ mail: [], tickets: {}, threads: [] })
    const w = inB(on, acme, [thread('local_x', 'Acme, older', 30), thread('local_y', 'Acme, newer', 1)], { 'mm.links': { [ACME]: 'local_x' }, 'mm.marked': { local_y: ACME }, 'mm.markedAt': { local_y: NOW - HOUR } })
    await mm($, '')
    expect((w.stored['mm.links'] as Record<string, string>)[ACME]).toBe('local_x')
  })

  test('⛔ another client\'s thread is never taken: by its marker, its pin record, the bridge\'s name for it, its last kickoff, or one shared; a name the bridge gave it for this client is enough', async ($, on) => {
    const w = inB(on, undatedBolt(), [
      thread('local_m', 'Cedar, by marker', 1),
      thread('local_p', 'Cedar, by pin', 2),
      thread('local_t', '🟡 Cedar Dental · task · no due date', 3),
      thread('local_k', 'Cedar, its kickoff', 4),
    ], {
      'mm.marked': { local_m: CEDAR },
      'mm.pins': { local_p: ourPin(CEDAR, 'Cedar Dental') },
      'mm.titles': { local_t: 'Cedar notes' },
      'mm.sent': { [CEDAR]: { sid: 'local_k', sig: 'x', at: NOW - DAYS } },
    })
    await mm($, '')
    expect((w.stored['mm.links'] as Record<string, string>)[BOLT]).toBeUndefined()
    // the bridge's own name for Bolt, on a thread whose own name is on record: Bolt's
    w.threads.set('local_n', thread('local_n', '🟡 Bolt Staffing · task · no due date', 5))
    w.stored['mm.titles'] = { ...(w.stored['mm.titles'] as Record<string, string>), local_n: 'Bolt notes' }
    await mm($, '')
    expect((w.stored['mm.links'] as Record<string, string>)[BOLT]).toBe('local_n')
  })

  test('[Black-Peak, 11-03] /mm link <project id> links a client listed only by an undated ticket (it answered "No client named ... is in your feed")', async ($, on) => {
    const w = inB(on, undatedBolt(), [], {})
    expect(await mm($, `link ${BOLT}`)).not.toContain('is in your feed')
    expect((w.stored['mm.links'] as Record<string, string>)[BOLT]).toBe(SELF)
  })
})

// ======================================================================== 0.7.20 (Rob, 2026-11-04)

// ⛔ (0.7.20, measured 2026-11-04 16:48 UTC on Rob's computer, 0.7.19 holding the sync; Rob answered "Yes, fix it" to "Fix
// the bridge so it recognizes a client's existing thread by its name?") After a profile switch the mm tool's `kickoffs`
// offered to start new threads for Agile Process Solutions and Legacy Law, each linked to its thread in another profile,
// though each had an OPEN thread in this profile named by the bridge for it (`🔴 16h left · Agile Process Solutions · reply
// ready`, an older bridge's wording, and `✓ Legacy Law · clear 4:28 PM`). 0.7.18's `ownHere` would have taken either by
// that name, but it looks only in the app's list, which holds the 60 most recently active threads: the two were last active
// on 10-19 and 10-20, and 93 open threads of that profile were more recent. When another thread sent each one a message at
// 16:50 (both went to the top of the list), the next sync, at 16:51:11, linked Agile by that very rule. Here Apex Process
// Partners stands for Agile, and Linden Law (project "Linden Law — Jo Park") for Legacy Law; `unlisted` threads are open
// but older than the app's 60 most recent, so the app answers for them only when asked by id.
describe('0.7.20 (Rob, 11-04: "Yes, fix it"): a client\'s thread here is found by its name, never counted as missing', () => {
  const APEX = '44444444-4444-4444-8444-444444444444'
  const LINDEN = '55555555-5555-4555-8555-555555555555'
  const PROFILE_C = `${PROFILES_ROOT}/acct-c/org-c`
  const CLI_F4 = 'eeeeeeee-0000-4000-8000-0000000000f4'
  const CLI_B0 = 'eeeeeeee-0000-4000-8000-0000000000b0'
  /** Their threads here, as the app named them on 11-04: the bridge's names, given while each was linked here. */
  const APEX_HERE = '🔴 16h left · Apex Process Partners · reply ready'
  const LINDEN_HERE = '✓ Linden Law · clear 4:28 PM'
  const ticket = (n: number, projectId: string, projectName: string, dueH: number) => ({
    ticket_id: `${String(n).padStart(8, '0')}-0000-4000-8000-0000000007d0`, project_id: projectId, project_name: projectName, title: `Task ${n}`,
    due_at: new Date(NOW + dueH * HOUR).toISOString(), due_source: 'commitment', assignee_email: FOUNDER,
  })
  /** The founder's feed: a task of Apex's due in 5 hours, one of Linden Law's 2 hours late, and Cedar Dental's in 30. */
  const robFeed = (more: Partial<Feed> = {}): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], drafts: [], threads: [],
    tickets: { due_today: [ticket(1, APEX, 'Apex Process Partners', 5)], overdue: [ticket(2, LINDEN, 'Linden Law — Jo Park', -2)], due_soon: [ticket(3, CEDAR, 'Cedar Dental', 30)] },
    ...more,
  })
  /** The store as it was at 16:48: each client linked to its thread in profile A, where its last kickoff went. */
  const before = (): Record<string, unknown> => ({
    'mm.profile': { dir: PROFILE_B, since: NOW - DAYS, from: PROFILE_A },
    'mm.switchPins': { since: NOW - DAYS, at: NOW - DAYS },
    'mm.links': { [APEX]: 'local_49', [LINDEN]: 'local_96' },
    // the threads' own names, kept when the bridge first named them
    'mm.titles': { local_f4: 'Dana Pike: answer her 4:17 AM email (partner question)', local_b0: 'jo' },
    'mm.threads': { [CLI_F4]: { app: 'local_f4', at: NOW - 16 * DAYS }, [CLI_B0]: { app: 'local_b0', at: NOW - 15 * DAYS } },
    'mm.sent': { [APEX]: { sid: 'local_49', sig: 'x', at: NOW - 2 * DAYS }, [LINDEN]: { sid: 'local_96', sig: 'x', at: NOW - 5 * DAYS } },
    'mm.marked': { local_49: APEX, local_96: LINDEN, local_d0: APEX },
    'mm.profileLinks': { [PROFILE_A]: { [APEX]: 'local_49', [LINDEN]: 'local_96' }, [PROFILE_C]: { [APEX]: 'local_d0' } },
    'mm.activity': { [APEX]: NOW - DAYS, [LINDEN]: NOW - 5 * DAYS },
  })
  const records = () => ({
    ...profileRec(PROFILE_B, SELF),
    ...profileRec(PROFILE_B, 'local_f4'),
    ...profileRec(PROFILE_B, 'local_b0'),
    ...profileRec(PROFILE_A, 'local_49'),
    ...profileRec(PROFILE_A, 'local_96'),
    ...profileRec(PROFILE_C, 'local_d0'),
  })
  const here = (over: { f4?: Partial<Thread>; b0?: Partial<Thread> } = {}): Thread[] => [
    thread('local_other', 'Unrelated notes', 2),
    thread('local_f4', APEX_HERE, 16 * 24, over.f4),
    thread('local_b0', LINDEN_HERE, 15 * 24, over.b0),
  ]
  const at1648 = (on: On, opts: { feed?: Feed; threads?: Thread[]; store?: Record<string, unknown>; unlisted?: string[]; files?: Record<string, { text: string; mtimeMs: number }> } = {}) => {
    const disk: Record<string, { text: string; mtimeMs: number }> = { ...records(), ...(opts.files ?? {}) }
    const w = world(on, { tools: 'start', feed: opts.feed ?? robFeed(), threads: opts.threads ?? here(), unlisted: opts.unlisted ?? ['local_f4', 'local_b0'], files: disk, store: { ...before(), ...(opts.store ?? {}) } })
    return Object.assign(w, { disk })
  }
  const linksOf = (w: { stored: Record<string, unknown> }) => w.stored['mm.links'] as Record<string, string>
  const kicked = async ($: Engine) => kicksIn(await tool($, 'kickoffs')).map(k => k.client)

  test('[Agile Process Solutions, 11-04] its thread here, past the app\'s 60 most recent, carries an older bridge\'s name for it, and its link is its thread in another profile: linked to its thread here, pinned and named, and kickoffs offers no new one', async ($, on) => {
    const w = at1648(on)
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_f4')
    expect(w.threads.get('local_f4')).toMatchObject({ title: '🔴 5h left · Apex Process Partners · task', pinned: true })
    const kicks = await tool($, 'kickoffs')
    expect(kicks).not.toContain('Apex Process Partners')
    expect(kicksIn(kicks).map(k => k.client)).not.toContain('Apex Process Partners')
  })

  test('[Legacy Law, 11-04] its thread here, past the app\'s 60 most recent, is named "✓ Linden Law · clear 4:28 PM" for the project "Linden Law — Jo Park" (its kickoff calls it Linden Law Jo Park): linked to it, and kickoffs offers no new one', async ($, on) => {
    const w = at1648(on)
    await mm($, '')
    expect(linksOf(w)[LINDEN]).toBe('local_b0')
    expect(w.threads.get('local_b0')?.title).toContain('Linden Law')
    expect(w.threads.get('local_b0')?.pinned).toBe(true)
    // (Cedar Dental, with no thread anywhere, is the one handed out)
    expect(await kicked($)).toEqual(['Cedar Dental'])
  })

  test('(control, as 0.7.18 and 0.7.19 already did) the same two threads inside the app\'s list are linked by their names: the name and every record gate let them through, so the list alone kept them out', async ($, on) => {
    const w = at1648(on, { unlisted: [] })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_f4')
    expect(linksOf(w)[LINDEN]).toBe('local_b0')
  })

  test('kickoffs, asked before any sync has linked the thread here (it took the bridge\'s name since): it looks first, links it, and names it in its answer instead of handing the client out', async ($, on) => {
    const w = at1648(on, { threads: here({ f4: { title: 'Dana Pike: answer her 4:17 AM email (partner question)' } }) })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_49')
    // the thread takes the bridge's name (here, as the bridge in another profile would name it), and the app writes its record
    const f4 = w.threads.get('local_f4')
    if (f4) f4.title = APEX_HERE
    w.disk[`${PROFILE_B}/local_f4.json`] = { text: JSON.stringify({ sessionId: 'local_f4', isArchived: false, title: APEX_HERE }), mtimeMs: NOW }
    // the sync on record is fresh: until 0.7.20 kickoffs handed Apex out from it as it was
    const answer = await tool($, 'kickoffs')
    expect(kicksIn(answer).map(k => k.client)).not.toContain('Apex Process Partners')
    expect(answer).toContain('Already has a thread in this profile, now linked: Apex Process Partners ("5h left Apex Process Partners task")')
    expect(linksOf(w)[APEX]).toBe('local_f4')
    expect(starts(w)).toEqual([])
  })

  test('a link whose whereabouts the sync could not find out (the app\'s lookups spent before it) is asked for first: not open here, the client takes its thread here by its name', async ($, on) => {
    // ten links of clients not in the feed come first and spend the sync's LOOKUPS_PER_SYNC; Apex's link has no record here
    const filler = Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`${String(n).padStart(8, '0')}-0000-4000-8000-0000000007d1`, `local_gone${n}`]))
    const w = at1648(on, { unlisted: [], store: { 'mm.links': { ...filler, [APEX]: 'local_49x' }, 'mm.sent': {}, 'mm.marked': {}, 'mm.profileLinks': {} } })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_f4')
  })

  test('an older bridge\'s name with a two-digit rank in front, on a thread whose own name is not on record, in the app\'s list: linked by that name', async ($, on) => {
    const w = at1648(on, { unlisted: [], threads: here({ f4: { title: '07 🔴 Apex Process Partners · reply overdue 6h' } }), store: { 'mm.titles': {} } })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_f4')
  })

  test('the sync asks for at most NAMED_LOOKUPS_PER_SYNC threads past the list, keeps what it learnt, and the next sync goes on from there', async ($, on) => {
    // 25 threads the bridge named for nobody in the feed, each more recently written than Apex's
    const others = Array.from({ length: 25 }, (_, n) => `local_n${String(n).padStart(2, '0')}`)
    const files = Object.fromEntries(others.map((sid, n) => [`${PROFILE_B}/${sid}.json`, { text: JSON.stringify({ sessionId: sid, isArchived: false, title: 'x' }), mtimeMs: NOW - HOUR + n + 1 }]))
    const w = at1648(on, {
      threads: [...here(), ...others.map(sid => thread(sid, `🟡 Elm Clinic ${sid} · task`, 20 * 24))],
      unlisted: ['local_f4', 'local_b0', ...others],
      files: { ...files, [`${PROFILE_B}/local_f4.json`]: { text: '{}', mtimeMs: NOW - 2 * HOUR } },
      store: { 'mm.titles': { ...Object.fromEntries(others.map(sid => [sid, 'own name'])), local_f4: 'Dana Pike', local_b0: 'jo' } },
    })
    const asked = () => w.calls.filter(c => c.tool === 'get_session' && String(c.args.session_id).startsWith('local_n')).length
    await mm($, '')
    expect(asked()).toBeLessThanOrEqual(20)
    expect(linksOf(w)[APEX]).toBe('local_49')
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_f4')
    // each of them asked once: what they were named is on record, and their records have not changed
    expect(asked()).toBe(25)
    await mm($, '')
    expect(asked()).toBe(25)
  })

  // ⛔ every exclusion of 0.7.18 stands, past the list as in it
  test('⛔ a name of the bridge\'s for ANOTHER client in the feed is never this client\'s', async ($, on) => {
    const w = at1648(on, { threads: here({ f4: { title: '🔴 16h left · Cedar Dental · task' } }) })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_49')
    expect(await kicked($)).toContain('Apex Process Partners')
  })

  test('⛔ a link to a thread open here is never moved, past the list too, however new the named thread is', async ($, on) => {
    const w = at1648(on, { threads: [...here(), thread('local_x', 'Apex, older work', 30 * 24)], unlisted: ['local_f4', 'local_b0', 'local_x'], store: { 'mm.links': { [APEX]: 'local_x', [LINDEN]: 'local_96' } } })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_x')
  })

  test('⛔ a link whose whereabouts the sync could not find out, and that is open here when asked, is never moved', async ($, on) => {
    const filler = Object.fromEntries(Array.from({ length: 10 }, (_, n) => [`${String(n).padStart(8, '0')}-0000-4000-8000-0000000007d1`, `local_gone${n}`]))
    const w = at1648(on, { threads: [...here(), thread('local_x', 'Apex, older work', 30 * 24)], unlisted: ['local_x'], store: { 'mm.links': { ...filler, [APEX]: 'local_x' } } })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_x')
  })

  test('⛔ an archived thread with the bridge\'s name for the client is never taken by its name, and never brought back by it', async ($, on) => {
    const w = at1648(on, { threads: here({ f4: { isArchived: true } }) })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_49')
    expect(w.threads.get('local_f4')?.isArchived).toBe(true)
    expect(w.calls.filter(c => c.tool === 'unarchive_session')).toEqual([])
  })

  test('⛔ a name two clients in the feed could both claim is evidence for neither', async ($, on) => {
    const twins = robFeed({ tickets: { due_today: [ticket(1, APEX, 'Apex Process Partners — East', 5), ticket(4, CEDAR, 'Apex Process Partners — West', 6)], overdue: [ticket(2, LINDEN, 'Linden Law — Jo Park', -2)] } })
    const w = at1648(on, { feed: twins })
    await mm($, '')
    expect(linksOf(w)[APEX]).toBe('local_49')
    expect(linksOf(w)[CEDAR]).toBeUndefined()
    // Linden Law's name is its own: linked as before
    expect(linksOf(w)[LINDEN]).toBe('local_b0')
  })

  for (const [why, store] of [
    ['the person unlinked it', { 'mm.unlinked': { local_f4: NOW - DAYS } }],
    ['a client was moved off it', { 'mm.released': ['local_f4'] }],
    ['it is shared with another client (a hub)', { 'mm.shared': { local_f4: NOW - DAYS } }],
    ['it is linked to another client', { 'mm.links': { [APEX]: 'local_49', [LINDEN]: 'local_96', [CEDAR]: 'local_f4' } }],
    ['its pin record is another client\'s', { 'mm.pins': { local_f4: ourPin(CEDAR, 'Cedar Dental') } }],
    ['it opened with another client\'s marker', { 'mm.marked': { local_49: APEX, local_96: LINDEN, local_f4: CEDAR } }],
  ] as const) {
    test(`⛔ never taken by its name when ${why}`, async ($, on) => {
      const w = at1648(on, { store })
      await mm($, '')
      expect(linksOf(w)[APEX]).not.toBe('local_f4')
    })
  }

  test('⛔ a thread whose sessions worked on two clients (a hub) is never taken by its name', async ($, on) => {
    const hub = robFeed({ threads: [{ project_id: APEX, session_id: CLI_F4, last_activity_at: ago(2) }, { project_id: CEDAR, session_id: CLI_F4, last_activity_at: ago(1) }] })
    const w = at1648(on, { feed: hub })
    await mm($, '')
    expect(linksOf(w)[APEX]).not.toBe('local_f4')
  })
})

// ======================================================================== 0.7.21 (Rob, 2026-11-05)

// Rob, 2026-11-05: "My side panel is now just getting really overcluttered with things that are late. I'm supposed to check
// on a team member, and while I need to see those, it's making it hard for me to know what I still need to handle... When
// things are overdue but not assigned to me, I don't think they should be pinned here. I think they should all show up in
// the same thing that shows the system stats. It should show people and which tasks are overdue for which clients, so I can
// run through those with the team in the morning." Measured that day on his machine: 24 threads pinned, 52 of his
// teammates' late tickets riding on his own rows. Every client, ticket and address below is made up.
describe('0.7.21 (Rob, 11-05: "When things are overdue but not assigned to me, I don\'t think they should be pinned here"): Team · late', () => {
  const tid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000721`
  const B = TEAMMATE_B
  const C = 'builder-c@example.com'
  const pinCalls = (w: { writes: () => string[] }, sid: string) => w.writes().filter(c => c.startsWith(`set_pinned | ${sid} `))
  /** A teammate's ticket that owes an ETA, needed `h` hours ago: late, `no ETA given`. */
  const lateAsk = (n: number, who: string, h: number, pid: string, name: string, title: string) => ({
    ticket_id: tid(n), project_id: pid, project_name: name, title, due_at: null, due_source: null, assignee_email: who,
    eta_needed_by: new Date(NOW - h * HOUR).toISOString(), eta_ask: '⏳ NO ETA — give one in Claude Code',
  })
  /**
   * The founder's feed: his own task on Cedar due in `cedarH` hours, and his teammates' late tickets: Builder B's on Cedar
   * (his client too) and on Acme (nothing of his there), Builder C's on Acme. `mates: false`: his own task alone.
   */
  const robFeed = (cedarH = 5, mates = true): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], drafts: [], threads: [],
    tickets: {
      [cedarH < 24 ? 'due_today' : 'due_soon']: [{ ticket_id: tid(1), project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(NOW + cedarH * HOUR).toISOString(), due_source: 'commitment', assignee_email: FOUNDER }],
      ...(mates
        ? { overdue: [lateAsk(2, B, 4, CEDAR, 'Cedar Dental', 'Order the signage'), lateAsk(3, B, 2, ACME, 'Acme Roofing — Pat', 'Build the quote page'), lateAsk(4, C, 1, ACME, 'Acme Roofing — Pat', 'Send the roof photos')] }
        : {}),
    },
  })
  /** A pin of ours, as 0.7.18 to 0.7.20 left it on a thread pinned to check on a teammate. */
  const checkPin = (projectId: string, client: string) => ({ projectId, client, byUs: true })

  test('a thread the bridge pinned only to check on a teammate (ours) is unpinned on the next sync and named for what is there; the person\'s own pin stays', async ($, on) => {
    const w = world(on, {
      feed: robFeed(50),
      threads: [
        thread('local_c', '🔴 Cedar Dental · check on Builder B · task 4h late', 2, { pinned: true }),
        thread('local_a', '🔴 Acme Roofing · check on Builder B · task 2h late', 3, { pinned: true }),
      ],
      store: { 'mm.links': { [CEDAR]: 'local_c', [ACME]: 'local_a' }, 'mm.pins': { local_c: checkPin(CEDAR, 'Cedar Dental'), local_a: checkPin(ACME, 'Acme Roofing') } },
    })
    await mm($, '')
    // Cedar: his own task is 2 days out, so nothing of his pins it; the pin was ours, so it comes off
    expect(w.threads.get('local_c')).toMatchObject({ title: '🟡 2d left · Cedar Dental · task', pinned: false })
    expect(pinCalls(w, 'local_c')).toEqual(['set_pinned | local_c | false'])
    // Acme: theirs alone, named for whose it is, our pin off
    expect(w.threads.get('local_a')).toMatchObject({ title: '🟡 with Builder B and Builder C · Acme Roofing · no ETA', pinned: false })
    expect(pinCalls(w, 'local_a')).toEqual(['set_pinned | local_a | false'])
    const pins = w.stored['mm.pins'] as Record<string, { byUs: boolean }>
    expect([pins.local_c?.byUs, pins.local_a?.byUs]).toEqual([false, false])
    expect((w.stored['mm.last'] as { pinned: number }).pinned).toBe(0)
    // and the next sync leaves both alone: nothing pins them again
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect([w.threads.get('local_c')?.pinned, w.threads.get('local_a')?.pinned]).toEqual([false, false])
    expect([...pinCalls(w, 'local_c'), ...pinCalls(w, 'local_a')]).toHaveLength(2)
  })

  test('a pin the person put on the thread of a client of theirs alone is the person\'s: it stays', async ($, on) => {
    const w = world(on, {
      feed: robFeed(50),
      threads: [thread('local_a', 'Acme work', 3, { pinned: true })],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.pins': { local_a: { projectId: ACME, client: 'Acme Roofing', byUs: false } } },
    })
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: '🟡 with Builder B and Builder C · Acme Roofing · no ETA', pinned: true })
    expect(pinCalls(w, 'local_a')).toEqual([])
  })

  test('his own task still pins his thread, named for what is his; his row carries nothing of theirs; (0.7.27) his page has neither section, the sync still knows them by person, then client', async ($, on) => {
    const w = world(on, { feed: robFeed(5), threads: [thread('local_c', 'Cedar work', 2)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
    await mm($, '')
    expect(w.threads.get('local_c')).toMatchObject({ title: CEDAR_TITLE, pinned: true })
    const ui = await pane($)
    const before = await lines(ui)
    // his row: one line, no `1 late with Builder B` under it (0.7.4 to 0.7.20)
    const row = before.findIndex(l => l.includes('🔴 Cedar Dental · task · 5h left'))
    expect(row).toBeGreaterThan(-1)
    expect(before.some(l => l.includes('late with'))).toBe(false)
    // (0.7.21 to 0.7.26: Team · late, by person, then client, the last button on the line of groups)
    expect((await buttons(ui)).filter(b => b[0].startsWith('mm-fold:'))).toEqual([])
    expect(before.some(l => l.includes('Team · late') || l.includes('With a teammate'))).toBe(false)
    await ui.unmount()
    expect((await mm($, 'status')).split('\n')).toContain('late with the team: 3 (Builder B 2, Builder C 1)')
    expect(sends(w)).toEqual([])
  })

  test('(0.7.27) the status line says nothing of the team; /mm status keeps naming who is late', async ($, on) => {
    const w = world(on, { feed: robFeed(5), threads: [thread('local_c', 'Cedar work', 2)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
    await mm($, '')
    // (0.7.21 to 0.7.26: `MM: 1 need you · 1 pinned · 3 late with the team`)
    expect(String(w.statuses.at(-1) ?? '')).toMatch(/^MM: 1 need you · 1 pinned(  |$)/)
    const status = await mm($, 'status')
    expect(status.split('\n')).toContain('late with the team: 3 (Builder B 2, Builder C 1)')
    // nobody late: the line as it was
    w.setFeed(robFeed(5, false))
    await mm($, '')
    expect(String(w.statuses.at(-1) ?? '')).toMatch(/^MM: 1 need you · 1 pinned(  |$)/)
    expect(await mm($, 'status')).not.toContain('late with the team')
  })

  test('⛔ a teammate\'s feed and the PM\'s: no Team · late, and the status line is as it was', async ($, on) => {
    const w = world(on, { feed: { ...robFeed(5), member: ME, role: 'builder' }, threads: [] })
    await mm($, '')
    expect(String(w.statuses.at(-1) ?? '')).not.toContain('late with the team')
    const ui = await pane($)
    expect((await buttons(ui)).some(b => b[0] === 'mm-fold:team')).toBe(false)
    await ui.unmount()
    w.setFeed({ ...robFeed(5), member: 'has9@example.com', role: 'pm' })
    await mm($, '')
    expect(String(w.statuses.at(-1) ?? '')).not.toContain('late with the team')
    expect(await mm($, 'status')).not.toContain('late with the team')
  })

  test('S1 (0.7.27, Rob 11-05: "everything that shows up as needing to be worked on right now ... shouldn\'t show up for me and clutter my page"): the founder\'s pane and strip have neither Team · late nor With a teammate, drawn from a sync or from the stored one; (0.7.34) a PM\'s has none either', async ($, on) => {
    const held = { package_id: PKG, project_id: BOLT, project_name: 'Bolt Staffing (Sam)', status: 'picked_up', picked_up_by: 'builder-b@example.com', picked_up_at: ago(1), covers_through: ago(2), drafts_ready: 1, drafts_unsent: 1, project_owner_email: 'builder-b@example.com' }
    const w = world(on, { feed: { ...robFeed(5), drafts: [held] }, threads: [thread('local_c', 'Cedar work', 2)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
    await mm($, '')
    const last = w.stored['mm.last'] as { founder?: boolean; teammate?: unknown[] }
    // the sync still holds them: its status counts and the thread names read them
    expect(last.founder).toBe(true)
    expect(last.teammate?.length ?? 0).toBeGreaterThan(0)
    const ui = await pane($)
    expect((await buttons(ui)).filter(b => b[0].startsWith('mm-fold:'))).toEqual([])
    const shown = await lines(ui)
    expect(shown.some(l => l.includes('With a teammate') || l.includes('Team · late') || l.includes('late with'))).toBe(false)
    expect(String(w.statuses.at(-1) ?? '')).not.toContain('late with the team')
    await ui.unmount()
    // (0.7.34) and a PM's page has none either: Team now shows him the team's
    const t: FeedTicket = { ticket_id: tid(2), project_id: CEDAR, project_name: 'Cedar Dental', title: 'Build the intake flow', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: 'builder-b@example.com' }
    w.setFeed({ member: 'has9@example.com', role: 'pm', mail: [], drafts: [], threads: [], tickets: { due_soon: [t] } })
    await mm($, '')
    expect((w.stored['mm.last'] as { founder?: boolean }).founder).toBeUndefined()
    const pm = await pane($)
    expect((await buttons(pm)).filter(b => b[0].startsWith('mm-fold:'))).toEqual([])
    await pm.unmount()
  })
})

// ⛔ (0.7.23, measured on Rob's computer 2026-11-05: 107 linked or pinned threads past the app's list of 60, asked by id in
// link order, 10 a sync, so the same first 10 every sync; a thread the bridge pinned in 0.7.20 sat 29th and kept its pin and
// its `check on <teammate>` name after 0.7.21) The clients and threads here are made up.
describe('0.7.23 (A): threads past the app\'s list are asked for by id in turn, the bridge\'s own pins first', () => {
  const pidOf = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000a0722`
  const sidOf = (n: number) => `local_n${String(n).padStart(2, '0')}`
  /** The threads the app was asked for by id (never this one), from call `from` on. */
  const asked = (w: { calls: Call[] }, from = 0) => w.calls.slice(from).filter(c => c.tool === 'get_session' && c.args.session_id !== 'self' && c.args.session_id !== SELF).map(c => String(c.args.session_id))
  /** A teammate's ticket on Acme that owes an ETA, needed `h` hours ago. */
  const mateLate = (n: number, who: string, h: number, title: string) => ({
    ticket_id: `${String(n).padStart(8, '0')}-0000-4000-8000-0000000b0722`, project_id: ACME, project_name: 'Acme Roofing — Pat', title, due_at: null, due_source: null,
    assignee_email: who, eta_needed_by: new Date(NOW - h * HOUR).toISOString(), eta_ask: '⏳ NO ETA — give one in Claude Code',
  })
  /** The founder's feed: Builder B's and Builder C's late tickets on Acme, nothing of his. */
  const lateFeed = (): Feed => ({
    member: FOUNDER, role: 'founder', mail: [], drafts: [], threads: [],
    tickets: { overdue: [mateLate(1, TEAMMATE_B, 2, 'Build the quote page'), mateLate(2, 'builder-c@example.com', 1, 'Send the roof photos')] },
  })
  /** `n` made-up clients, each with a linked thread the app does not list. */
  const pastTheList = (n: number) => {
    const threads = Array.from({ length: n }, (_, i) => thread(sidOf(i + 1), `Notes ${i + 1}`, 40 + i))
    return { threads, links: Object.fromEntries(threads.map((t, i) => [pidOf(i + 1), t.sessionId])) as Record<string, string> }
  }

  test('lookupOrder: the bridge\'s own pins first unless a lookup found them unpinned; then the one asked longest ago; a tie in link order', async () => {
    const ours = (sid: string) => sid === 'c' || sid === 'd'
    expect(lookupOrder(['a', 'b', 'c', 'd'], ours, { a: { at: 5 }, b: { at: 1 }, c: { at: 9, off: true }, d: { at: 9 } })).toEqual(['d', 'b', 'a', 'c'])
    // never asked counts as asked longest ago; a malformed record is never asked
    expect(lookupOrder(['a', 'b', 'c'], () => false, { a: { at: 3 }, b: null as never, c: { at: Number.NaN } })).toEqual(['b', 'c', 'a'])
    expect(lookupOrder([], ours, {})).toEqual([])
  })

  test('(a) a thread the bridge pinned, 14th of 14 past the list in link order, is asked on the first sync: its pin comes off and it is named for what is there', async ($, on) => {
    const { threads, links } = pastTheList(13)
    const w = world(on, {
      feed: lateFeed(),
      threads: [...threads, thread('local_a', '🔴 Acme Roofing · check on Builder B · task 2h late', 30, { pinned: true })],
      unlisted: [...threads.map(t => t.sessionId), 'local_a'],
      store: { 'mm.links': { ...links, [ACME]: 'local_a' }, 'mm.pins': { local_a: ourPin(ACME, 'Acme Roofing') } },
    })
    await mm($, '')
    const first = asked(w)
    // (until 0.7.23: local_n01 to local_n10, every sync, and local_a never)
    expect(first[0]).toBe('local_a')
    expect(first.length).toBeLessThanOrEqual(10)
    expect(w.threads.get('local_a')).toMatchObject({ title: '🟡 with Builder B and Builder C · Acme Roofing · no ETA', pinned: false })
    expect(w.writes().filter(c => c.startsWith('set_pinned | local_a '))).toEqual(['set_pinned | local_a | false'])
    expect((w.stored['mm.pins'] as Record<string, { byUs: boolean }>).local_a?.byUs).toBe(false)
    // and every other one is asked by the second sync
    const mark = w.calls.length
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    const second = asked(w, mark)
    expect(second.length).toBeLessThanOrEqual(10)
    expect(new Set([...first, ...second])).toEqual(new Set([...threads.map(t => t.sessionId), 'local_a']))
  })

  test('(b) every thread past the list is asked within ceil(n/10)+1 syncs, each once before any is asked again', async ($, on) => {
    const n = 25
    const { threads, links } = pastTheList(n)
    const ids = threads.map(t => t.sessionId)
    const w = world(on, { feed: lateFeed(), threads, unlisted: ids, store: { 'mm.links': links } })
    const all: string[] = []
    for (let sync = 0; sync < Math.ceil(n / 10) + 1; sync++) {
      const mark = w.calls.length
      await mm($, '')
      const now = asked(w, mark).filter(sid => ids.includes(sid))
      expect(now.length).toBeLessThanOrEqual(10)
      all.push(...now)
      await w.clock.advance(6 * 60_000)
    }
    // (until 0.7.23: local_n01 to local_n10 each sync, local_n11 to local_n25 never)
    expect(new Set(all.slice(0, n))).toEqual(new Set(ids))
    expect(all.slice(0, n)).toHaveLength(n)
    // the record of when each was asked is in the store, and only for threads in play
    expect(Object.keys(w.stored['mm.lookups'] as Record<string, unknown>).sort()).toEqual([...ids].sort())
  })

  test('(2) a thread whose pin record is ours, found open and not pinned, stops going first even while its record stays ours', async ($, on) => {
    const { threads, links } = pastTheList(12)
    const stale = ['local_s1', 'local_s2', 'local_s3']
    const staleLinks = Object.fromEntries(stale.map((sid, i) => [`${String(i + 1).padStart(8, '0')}-0000-4000-8000-0000000c0722`, sid]))
    const records = Object.fromEntries(Object.entries(staleLinks).map(([pid, sid]) => [sid, ourPin(pid, `Stale Client ${sid.slice(-1)}`)]))
    const w = world(on, {
      feed: lateFeed(),
      threads: [...threads, ...stale.map((sid, i) => thread(sid, `Old work ${i + 1}`, 60 + i))],
      unlisted: [...threads.map(t => t.sessionId), ...stale],
      store: { 'mm.links': { ...links, ...staleLinks }, 'mm.pins': records },
    })
    await mm($, '')
    const first = asked(w)
    // ours first, though last in link order
    expect(first.slice(0, 3)).toEqual(stale)
    expect(first.slice(3)).toEqual(['local_n01', 'local_n02', 'local_n03', 'local_n04', 'local_n05', 'local_n06', 'local_n07'])
    const seen = w.stored['mm.lookups'] as Record<string, { at: number; off?: boolean }>
    expect(stale.map(sid => seen[sid]?.off)).toEqual([true, true, true])
    // the records left as a pass that ran out of writes would leave them: still ours
    w.stored['mm.pins'] = JSON.parse(JSON.stringify(records))
    const mark = w.calls.length
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    // not first again: the ones never asked, then the one asked longest ago (until the fix's (2) they went first every sync)
    expect(asked(w, mark)).toEqual(['local_n08', 'local_n09', 'local_n10', 'local_n11', 'local_n12', 'local_n01', 'local_n02', 'local_n03', 'local_n04', 'local_n05'])
  })
})

// (0.7.23, Rob 2026-11-05: "it should be everything that should be pinned, and there should be another indicator, like a green
// light beside it, to show if it is or not.") The clients here are made up.
describe('0.7.23 (B): the pin report: what should be pinned, whether it is, and why not', () => {
  const DUNE = '44444444-4444-4444-4444-444444444444'
  const pidOf = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-0000000d0722`
  const nameOf = (n: number) => `Willow Client ${String(n).padStart(2, '0')}`
  const OK = { status: 200, body: { ok: true } }
  /** The founder's own task on a client, due in `h` hours. */
  const taskOn = (n: number, pid: string, name: string, h: number) => ({
    ticket_id: `${String(n).padStart(8, '0')}-0000-4000-8000-0000000e0722`, project_id: pid, project_name: name, title: 'Send the intake form',
    due_at: new Date(NOW + h * HOUR).toISOString(), due_source: 'commitment', assignee_email: FOUNDER,
  })
  /**
   * The founder: his own tasks on 13 clients (each with a linked thread on the list), due one after another; Bolt's late
   * mail (no thread); Dune's task, its thread past the list (`unseen` once a lookup cannot answer); Acme: his teammates'
   * late tickets alone, its thread pinned by the person.
   */
  const reportFeed = (n = 13): Feed => ({
    member: FOUNDER, role: 'founder', drafts: [], threads: [],
    mail: [mailFor(BOLT, 'Bolt Staffing (Sam)', 74, { project_owner_email: FOUNDER })],
    tickets: {
      due_today: [...Array.from({ length: n }, (_, i) => taskOn(i + 1, pidOf(i + 1), nameOf(i + 1), 1 + i * 0.25)), taskOn(20, DUNE, 'Dune Labs', 0.75)],
      overdue: [{ ticket_id: '00000030-0000-4000-8000-0000000e0722', project_id: ACME, project_name: 'Acme Roofing — Pat', title: 'Build the quote page', due_at: null, due_source: null, assignee_email: TEAMMATE_B, eta_needed_by: new Date(NOW - 2 * HOUR).toISOString(), eta_ask: '⏳ NO ETA — give one in Claude Code' }],
    },
  })
  /** `n` of the 13 Willow clients (13: the pass runs out of writes for the 13th; 3: it never does). */
  const reportWorld = (on: On, more: WorldOptions = {}, n = 13) => {
    const threads = Array.from({ length: n }, (_, i) => thread(`local_w${String(i + 1).padStart(2, '0')}`, `Willow work ${i + 1}`, 2 + i))
    return world(on, {
      feed: reportFeed(n),
      threads: [...threads, thread('local_d', 'Dune work', 50), thread('local_acme', 'Acme work', 3, { pinned: true })],
      unlisted: ['local_d'],
      lookupFails: 'internal error',
      store: { 'mm.links': { ...Object.fromEntries(threads.map((t, i) => [pidOf(i + 1), t.sessionId])), [DUNE]: 'local_d', [ACME]: 'local_acme' } },
      bridgePins: () => OK,
      ...more,
    })
  }
  /** What a pass left: every thread's name and pin, the pin records, and how many it counted pinned. */
  const outcome = (w: ReturnType<typeof reportWorld>) => ({
    threads: [...w.threads.values()].map(t => [t.sessionId, t.title, t.pinned]),
    pins: w.stored['mm.pins'],
    pinned: (w.stored['mm.last'] as { pinned: number }).pinned,
  })

  test('the payload: each item that should be pinned once, whether it is, and why not; the threads pinned for nothing on the list', async ($, on) => {
    const w = reportWorld(on)
    await mm($, '')
    expect(w.pinPosts).toHaveLength(1)
    const sent = w.pinPosts[0] as (typeof w.pinPosts)[number]
    expect(sent.method).toBe('POST')
    expect(sent.headers).toEqual({ Authorization: 'Bearer fixture-token-not-a-real-one', 'X-MM-Client': `mm-bridge/${VERSION}`, 'Content-Type': 'application/json' })
    const body = sent.body
    expect(Object.keys(body).sort()).toEqual(['at', 'extra', 'items'])
    expect(body.at).toBe(new Date(NOW).toISOString())
    const by = (pid: string) => body.items.find(i => i.project_id === pid)
    // pinned: a green light, no reason
    expect(by(pidOf(1))).toEqual({ project_id: pidOf(1), client: nameOf(1), kind: 'task', tone: 'yellow', due_at: new Date(NOW + HOUR).toISOString(), pinned: true, why_not: null })
    // no thread of its own; red: its reply is past due
    expect(by(BOLT)).toMatchObject({ client: 'Bolt Staffing', kind: 'reply', tone: 'red', pinned: false, why_not: 'no_thread' })
    // its thread past the app's list, and the lookup could not say
    expect(by(DUNE)).toMatchObject({ client: 'Dune Labs', kind: 'task', tone: 'yellow', pinned: false, why_not: 'unseen' })
    // wanted pinned, and the pass had no writes left for it
    expect(by(pidOf(13))).toMatchObject({ client: nameOf(13), pinned: false, why_not: 'write_cap' })
    // each item once; every one pins (`pinsFor`); why_not null exactly when pinned
    expect(new Set(body.items.map(i => i.project_id)).size).toBe(body.items.length)
    for (const i of body.items) expect(i.why_not === null).toBe(i.pinned)
    // the threads pinned: the items' green lights and the extra
    expect(body.items.filter(i => i.pinned).length + body.extra.length).toBe((w.stored['mm.last'] as { pinned: number }).pinned)
    // Acme: nothing of his (Team · late alone), its thread pinned by the person: extra, never an item
    expect(by(ACME)).toBeUndefined()
    expect(body.extra).toEqual([{ project_id: ACME, client: 'Acme Roofing', by: 'person' }])
    // the whole of it, as OW gets it: Bolt's late reply, Dune's task, then the Willow tasks by when they are due
    const due = (h: number) => new Date(NOW + h * HOUR).toISOString()
    const willow = (n: number, pinned: boolean) => ({ project_id: pidOf(n), client: nameOf(n), kind: 'task', tone: 'yellow', due_at: due(1 + (n - 1) * 0.25), pinned, why_not: pinned ? null : 'write_cap' })
    expect(body).toEqual({
      at: '2026-10-12T15:00:00.000Z',
      items: [
        { project_id: BOLT, client: 'Bolt Staffing', kind: 'reply', tone: 'red', due_at: '2026-10-12T13:00:00.000Z', pinned: false, why_not: 'no_thread' },
        { project_id: DUNE, client: 'Dune Labs', kind: 'task', tone: 'yellow', due_at: due(0.75), pinned: false, why_not: 'unseen' },
        ...Array.from({ length: 13 }, (_, i) => willow(i + 1, i < 12)),
      ],
      extra: [{ project_id: ACME, client: 'Acme Roofing', by: 'person' }],
    })
    // ⛔ never kept, logged or written anywhere: only its hash and when it went
    expect(Object.keys(w.stored['mm.pinReport'] as Record<string, unknown>).sort()).toEqual(['at', 'hash'])
    expect(JSON.stringify(w.written)).not.toContain('why_not')
    expect(JSON.stringify(w.stored)).not.toContain('why_not')
  })

  test('pinReport: an item listed twice (a row and a quiet one) is reported once, the first; one that does not pin is not reported; extra names only linked threads pinned', async () => {
    // his task on Cedar an hour late, and one on Bolt 30 hours out (listed; it does not pin: past 24 business hours)
    const l = buildLists({ member: FOUNDER, role: 'founder', mail: [], drafts: [], tickets: { overdue: [taskOn(1, CEDAR, 'Cedar Dental', -1)], due_soon: [taskOn(2, BOLT, 'Bolt Staffing (Sam)', 30)] } }, NOW)
    const listed = [...l.queue, ...l.queue.filter(i => i.projectId === CEDAR).map(i => ({ ...i, client: 'Cedar Dental again' }))]
    expect(listed.map(i => i.projectId)).toEqual([CEDAR, BOLT, CEDAR])
    const r = pinReport({
      now: NOW,
      listed,
      links: { [CEDAR]: 'local_c', [ACME]: 'local_a', [DUNE]: 'local_d' },
      thread: sid => ({ local_c: { sessionId: 'local_c', title: 'x', pinned: true }, local_a: { sessionId: 'local_a', title: 'y', pinned: true }, local_d: { sessionId: 'local_d', title: 'z', pinned: false } } as Record<string, never>)[sid],
      hidden: () => false,
      stayedOff: new Set(),
      capped: new Set(),
      byUs: sid => sid === 'local_a',
      client: () => 'Acme Roofing',
    })
    expect(r.items).toEqual([{ project_id: CEDAR, client: 'Cedar Dental', kind: 'task', tone: 'red', due_at: new Date(NOW - HOUR).toISOString(), pinned: true, why_not: null }])
    expect(r.extra).toEqual([{ project_id: ACME, client: 'Acme Roofing', by: 'bridge' }])
  })

  test('change detection: unchanged, it goes again only once 30 minutes have passed; changed, at the next sync; never twice in one sync', async ($, on) => {
    const w = reportWorld(on, {}, 3)
    await mm($, '')
    expect(w.pinPosts).toHaveLength(1)
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect(w.pinPosts).toHaveLength(1)
    await w.clock.advance(25 * 60_000)
    await mm($, '')
    expect(w.pinPosts).toHaveLength(2)
    expect(w.pinPosts[1]?.body.items).toEqual(w.pinPosts[0]?.body.items)
    // a change: Bolt's mail answered, so Bolt is off the report, and it goes at the next sync
    w.setFeed({ ...reportFeed(3), mail: [] })
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect(w.pinPosts).toHaveLength(3)
    expect(w.pinPosts[2]?.body.items.some(i => i.project_id === BOLT)).toBe(false)
  })

  for (const status of [404, 405]) {
    test(`OW without the route (${status}): the bridge waits 6 hours before it sends again, changed or not`, async ($, on) => {
      const w = reportWorld(on, { bridgePins: () => ({ status }) }, 3)
      await mm($, '')
      expect(w.pinPosts).toHaveLength(1)
      expect((w.stored['mm.pinReport'] as { missingUntil: number }).missingUntil).toBe(NOW + 6 * HOUR)
      await w.clock.advance(31 * 60_000)
      w.setFeed({ ...reportFeed(3), mail: [] })
      await mm($, '')
      expect(w.pinPosts).toHaveLength(1)
      await w.clock.advance(6 * HOUR)
      await mm($, '')
      expect(w.pinPosts).toHaveLength(2)
    })
  }

  // (`200` here is the yardstick: the same sync, with OW taking the report)
  for (const answer of [{ status: 200 }, { status: 500 }, 'network'] as const) {
    const label = typeof answer === 'string' ? 'no answer' : String(answer.status)
    test(`whatever OW answers the report (${label}), the sync is the same; a failed one goes again at the next sync`, async ($, on) => {
      const w = reportWorld(on, { bridgePins: () => answer }, 3)
      expect(await mm($, '')).toBe('5 clients need you; 4 threads pinned. The list is in the side pane.')
      const after = outcome(w)
      expect(after.pinned).toBe(4)
      expect(after.threads.filter(t => t[2] === true).map(t => t[0]).sort()).toEqual(['local_acme', 'local_w01', 'local_w02', 'local_w03'])
      // the same names, pins and records whatever OW answered
      expect(after.threads).toEqual([
        ['local_self', 'Morning hub', false],
        ['local_w01', '🔴 1h left · Willow Client 01 · task', true],
        ['local_w02', '🔴 1h left · Willow Client 02 · task', true],
        ['local_w03', '🔴 2h left · Willow Client 03 · task', true],
        ['local_d', 'Dune work', false],
        ['local_acme', '🟡 with Builder B · Acme Roofing · no ETA', true],
      ])
      expect(after.pins).toEqual({
        ...Object.fromEntries([1, 2, 3].map(n => [`local_w0${n}`, { projectId: pidOf(n), client: nameOf(n), byUs: true }])),
        local_acme: { projectId: ACME, client: 'Acme Roofing', byUs: false },
      })
      expect(w.pinPosts).toHaveLength(1)
      const took = typeof answer !== 'string' && answer.status === 200
      expect(w.stored['mm.pinReport'] !== undefined).toBe(took)
      await w.clock.advance(6 * 60_000)
      await mm($, '')
      expect(w.pinPosts).toHaveLength(took ? 1 : 2)
      // (the names' clocks moved on six minutes; the pins and records did not)
      const later = outcome(w)
      expect(later.threads.map(t => [t[0], t[2]])).toEqual(after.threads.map(t => [t[0], t[2]]))
      expect([later.pins, later.pinned]).toEqual([after.pins, after.pinned])
    })
  }

  // (0.7.23, coordinator 2026-11-05) R8 takes a client whose newer send is being checked off the person's plate and unpins its
  // thread whoever pinned it: never one that should be pinned, so never in the report's items
  test('a client in checking with a newer send being checked is not in the items; the rest are as before', async ($, on) => {
    const w = acmeWorld(on, { bridgePins: () => OK })
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: ACME_TITLE, pinned: true })
    expect(w.pinPosts.at(-1)?.body.items.find(i => i.project_id === ACME)).toMatchObject({ pinned: true, why_not: null })
    // our send is in the feed, newer than any check: the checking loop names its thread and unpins it
    w.setFeed(acmeFeed({ last_outbound_at: ago(0.25) }))
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    expect(w.threads.get('local_a')).toMatchObject({ title: '✓ Acme Roofing · sent 10:45 AM · checking', pinned: false })
    expect(w.pinPosts).toHaveLength(2)
    const body = w.pinPosts[1]?.body as PinReport
    expect(body.items.map(i => i.project_id)).not.toContain(ACME)
    expect(body.extra.map(e => e.project_id)).not.toContain(ACME)
    // Cedar and Bolt, with no thread, as before
    expect(body.items.map(i => [i.project_id, i.why_not])).toEqual(expect.arrayContaining([[CEDAR, 'no_thread'], [BOLT, 'no_thread']]))
  })

  test('a teammate\'s view sends its own report too', async ($, on) => {
    const w = world(on, { feed: feed(), bridgePins: () => OK })
    await mm($, '')
    expect(w.pinPosts).toHaveLength(1)
    expect(Array.isArray(w.pinPosts[0]?.body.items)).toBe(true)
  })
})

describe('0.7.26 the reply-package card in the bridge\'s own pane, on the desktop and in the terminal', () => {
  const LABEL = SMS_TREE.label
  const PAGE = SMS_PAGE
  const PICKUP = { markdown: PAGE, package_sha256: SMS_TREE.package_sha256 }
  const SURFACES = ['desktop', 'terminal'] as const
  const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ plugin: 'mm-bridge', surface, component: 'Pane', requestId: 'mm-queue', props: PANE })
  /** (0.7.36) The press's note in the transcript, word for word, with the first 12 of the record's `page_sha256`. */
  const SIGNED = (page12: string) => `[Massmarket bridge, no reply needed] Card signed in the side pane: Package ${LABEL}, page ${page12}. Nothing has been sent.`
  const SIGNED_START = `Card signed in the side pane: Package ${LABEL}, page `
  /** (0.7.36) The turn under way ends, as the engine raises it: for the main conversation, unless a subagent's is named. */
  const endTurn = ($: Engine, over: Record<string, unknown> = {}) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...over } as never)
  test('Drafts on another client\'s row: the card is drawn from the renderer on both surfaces, to read, with no signature box and the page a press away', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS }, renderer: 'tree', pickup: PICKUP })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `drafts:${ACME}` })
    expect(w.renders).toHaveLength(1)
    const argv = JSON.parse(w.renders[0] ?? '{}').argv as string[]
    expect(argv.at(-7)).toMatch(/\/client-reply-prep\/scripts\/render_visual\.py$/)
    expect(argv.slice(-6)).toEqual(['--package', PKG, '--signer', argv.at(-3), '--tree', '-'])
    await ui.unmount()
    for (const surface of SURFACES) {
      const u = await mount($, surface)
      const text = (await lines(u)).join('\n')
      expect(text, surface).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      expect(text, surface).toContain('Every question answered?')
      expect(text, surface).toContain('own thread. This card is here to read.')
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn')), surface).toBe(false)
      // the page is under "Show the page as text", and opens on a press
      expect(await u.find({ type: 'Markdown' }), surface).toBeUndefined()
      await u.press({ key: `mm-card-page:${PKG}` })
      expect((await u.find({ type: 'Markdown' }))?.text, surface).toBe(PAGE)
      await u.press({ key: `mm-card-page:${PKG}` })
      await u.unmount()
    }
    // drawn once a package version: a second look draws nothing again
    const again = await pane($)
    await again.press({ key: `drafts:${ACME}` })
    expect(w.renders).toHaveLength(1)
    expect(w.fills).toEqual([])
    expect(w.prompts).toEqual([])
    await again.unmount()
  })

  for (const surface of SURFACES) {
    test(`in the client's own thread (${surface}): the box opens at the end of the turn that got \`mm card\`'s ready, with no page printed, and a signature is recorded and (0.7.41) sends exactly the go into the thread as the person's own message`, async ($, on) => {
      const w = world(on, { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } }, renderer: 'tree', pickup: PICKUP })
      await mm($, '')
      const u = await mount($, surface)
      await u.press({ key: `drafts:${ACME}` })
      // (0.7.36) until the thread answers for this version the card stands without the box
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn')), surface).toBe(false)
      expect(await tool($, `card ${PKG}`), surface).toContain(`card ready: Package ${LABEL}.`)
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn')), surface).toBe(false)
      await endTurn($)
      const signBtn = (await buttons(u)).find(([k]) => k === `mm-card-sign-btn:${LABEL}`)
      expect(signBtn?.[1], surface).toBe('✍  Click to sign and send')
      await u.press({ key: `mm-card-sign-btn:${LABEL}` })
      // on record for the send gate, by the transcript's id, before anything is in the prompt box (the press goes on past a real digest of the page)
      const recorded = () => w.written.findLast(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl'))
      for (let i = 0; i < 200 && !recorded(); i++) await new Promise(r => setTimeout(r, 2))
      const record = JSON.parse(recorded()?.text ?? '{}') as Record<string, unknown>
      expect(record, surface).toMatchObject({ v: 1, session_id: SELF_CLI, package_id: PKG, package_sha256: SMS_TREE.package_sha256, label: LABEL })
      // the name and the envelope first; the words only once it has flown, and never sent
      expect(w.fills, surface).toEqual([])
      if (surface === 'desktop') expect(await u.find({ type: 'Svg' }), surface).toBeDefined()
      // (0.7.36) and its mark in the transcript, once, before the words
      for (let i = 0; i < 200 && !w.appended.some(t => t.includes(SIGNED_START)); i++) await new Promise(r => setTimeout(r, 2))
      const signedNote = SIGNED(String(record.page_sha256).slice(0, 12))
      expect(w.appended.filter(t => t.includes(SIGNED_START)).map(t => JSON.parse(t)), surface).toEqual([{ type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: signedNote }] }])
      expect(w.fills, surface).toEqual([])
      expect(w.prompts, surface).toEqual([])
      await w.clock.advance(3_100)
      // (0.7.41) one press is the go: the words go into the thread under the bridge's origin, as the person's own, and nothing in the prompt box
      for (let i = 0; i < 200 && !w.prompts.length; i++) await new Promise(r => setTimeout(r, 2))
      expect(w.prompts, surface).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
      expect(w.fills, surface).toEqual([])
      expect((await lines(u)).join('\n'), surface).toContain(`Sealed and sent: your go for Package ${LABEL} is in the thread, and it is sending the package now.`)
      await u.unmount()
    })
  }

  describe('0.7.33 `mm card <package id>`: whether the thread prints the page', () => {
    const READY = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call, and in the side pane. Do not print the page. Print one line saying the card is above, the go comes from its box, and they can say "print the page" if any of it doesn't show, ending "Package ${LABEL}.", then wait for the person.`
    /** (0.7.36) Ready with the pane not on a screen. */
    const OFF_SCREEN = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call; the side pane draws it too when this thread is open on a screen. Do not print the page. Print one line saying the card is above, the go comes from its box, and they can say "print the page" if they can't see it or any of it doesn't show, ending "Package ${LABEL}.", then wait for the person.`
    const WHOLE_ID = 'card not ready: give the whole package id, not the 8-character tag, and ask again.'
    const notReady = (why: string) => `card not ready: ${why}. Print the whole page.`
    const own = { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } }, renderer: 'tree' as const, pickup: PICKUP }
    /** This thread's client in the pane, drawn. */
    const shown = async ($: Engine, surface: (typeof SURFACES)[number] = 'desktop') => {
      await mm($, '')
      const u = await mount($, surface)
      await u.press({ key: `drafts:${ACME}` })
      return u
    }

    test('ready: its one form, through the tool and a typed /mm, and it sends, starts and picks up nothing', async ($, on) => {
      const w = world(on, own)
      const u = await shown($)
      const calls = w.calls.length
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      expect(await mm($, `card ${PKG}`)).toBe(READY)
      expect(w.fills).toEqual([])
      expect(w.prompts).toEqual([])
      expect(w.minted()).toEqual([])
      expect(sends(w)).toEqual([])
      expect(w.calls.length).toBe(calls)
      await u.unmount()
    })

    test('not ready, each in plain words: no id, another package, another client\'s part', async ($, on) => {
      const w = world(on, { ...own, feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS } })
      expect(await tool($, 'card')).toBe(WHOLE_ID)
      expect(await tool($, 'card not-a-uuid')).toBe(WHOLE_ID)
      expect(await tool($, `card ${PKG}`)).toBe(notReady('the side pane is not showing this package'))
      const u = await shown($)
      expect(await tool($, 'card 99999999-9999-4999-8999-999999999999')).toBe(notReady('the side pane is not showing this package'))
      expect(await tool($, `card ${PKG}`)).toBe(notReady("this is not the client's own thread"))
      expect(w.fills).toEqual([])
      await u.unmount()
    })

    test('the page holds a line the card does not: not ready, naming 60 characters of it, the box closed and nothing of it in the log', async ($, on) => {
      const LINE = `A line only OW prints about the package, long enough to be cut ${'x'.repeat(40)}`
      const w = world(on, { ...own, pickup: { ...PICKUP, markdown: `${PAGE}\n\n${LINE}` } })
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(notReady(`the page holds a line the card does not (${LINE.slice(0, 60)})`))
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
      // (0.7.46) the card is the version as it stands: the pane says why it cannot stand in for the page, never that it is an older view
      const said = (await lines(u)).join('\n')
      expect(said).toContain(`This card is the package as it stands now, but it cannot stand in for the page: the page holds a line the card does not (${LINE.slice(0, 60)}). Signing is off here. Go by the page printed in the thread.`)
      expect(said).not.toContain('does not match the stored drafts')
      expect(w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('\n')).not.toContain('A line only OW prints')
      await u.unmount()
    })

    test('the package moved on since the pane read it: not ready, and the box closes', async ($, on) => {
      const w = world(on, { ...own, pickup: PICKUP })
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      w.setPickup({ ...PICKUP, package_sha256: 'f'.repeat(64) })
      expect(await tool($, `card ${PKG}`)).toBe(notReady('the card was drawn from an older version of this package'))
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
      await u.unmount()
    })

    test('a card that could not be drawn: one plain line in the pane, the raw error in the log only, and not ready', async ($, on) => {
      const w = world(on, { ...own, renderer: undefined })
      const u = await shown($)
      const text = (await lines(u)).join('\n')
      expect(text).toContain('The card could not be drawn on this computer. Your thread prints the whole package instead.')
      expect(text).not.toContain('--tree')
      expect(text).not.toContain('client-reply-prep')
      // the page stands in the pane
      expect((await u.find({ type: 'Markdown' }))?.text).toBe(PAGE)
      expect(w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('\n')).toContain('could not be drawn: this computer has an older client-reply-prep')
      expect(await tool($, `card ${PKG}`)).toBe(notReady('the card could not be drawn on this computer'))
      await u.unmount()
    })

    test('finding 9: OW answers with no usable hash, for a newer page: not ready, and the box closes', async ($, on) => {
      const w = world(on, own)
      const u = await shown($)
      for (const hash of [null, undefined, 'not-a-hash']) {
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        w.setPickup({ ...PICKUP, markdown: PAGE.replace(LABEL, 'bbbbbbbbbbbb'), package_sha256: hash })
        expect(await tool($, `card ${PKG}`)).toBe(notReady('OW gave no usable hash for this package'))
        expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
        w.setPickup(PICKUP)
      }
      await u.unmount()
    })

    test('finding 3: a Cc added after plan approval, in no hash: the fresh card is in the pane before `mm card` answers ready', async ($, on) => {
      const before = CARD_PAIRS["rob's mail, plan not approved"] as { page: string; tree: { package_sha256: string } }
      const after = CARD_PAIRS["rob's mail, plan approved"] as { page: string; tree: { package_sha256: string } }
      const pick = (p: { page: string; tree: { package_sha256: string } }) => ({ ok: true, markdown: p.page, package_sha256: p.tree.package_sha256 })
      const w = world(on, { ...own, pickup: pick(before) })
      w.setTree(before.tree)
      const u = await shown($)
      expect((await lines(u)).join('\n')).toContain('Cc (none)')
      expect(await tool($, `card ${PKG}`)).toContain('card ready:')
      // the plan is approved: the same package hash, a new Cc on OW's page
      w.setPickup(pick(after))
      w.setTree(after.tree)
      // the engine draws a shown pane again within a tenth of a second of the write; the kit's drawing does when it is read
      let answered = ''
      const asked = tool($, `card ${PKG}`).then(said => {
        answered = String(said)
      })
      while (!answered) {
        await lines(u)
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      await asked
      expect(answered).toContain('card ready:')
      const drawn = (await lines(u)).join('\n')
      expect(drawn).toContain('Cc support@letaidothehardwork.com')
      // and the page folded under it is the page it was checked against
      await u.press({ key: `mm-card-page:${PKG}` })
      expect((await u.findAll({ type: 'Markdown' })).map(m => m.text)).toContain(after.page)
      await u.unmount()
    })

    test('finding 3: a kept card and a page that moved past what this computer draws: not ready, and the fresh card in the pane is the one that says so', async ($, on) => {
      const before = CARD_PAIRS["rob's mail, plan not approved"] as { page: string; tree: { package_sha256: string } }
      const after = CARD_PAIRS["rob's mail, plan approved"] as { page: string; tree: { package_sha256: string } }
      const w = world(on, { ...own, pickup: { ok: true, markdown: before.page, package_sha256: before.tree.package_sha256 } })
      w.setTree(before.tree)
      const u = await shown($)
      w.setPickup({ ok: true, markdown: after.page, package_sha256: after.tree.package_sha256 })
      expect(await tool($, `card ${PKG}`)).toContain("card not ready: the page's Cc is not the card's")
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
      await u.unmount()
    })

    test('finding 8: two `mm view` calls empty the client part, the card still in state: not ready, with no card on the screen', async ($, on) => {
      const w = world(on, { ...own, store: { ...own.store, 'mm.links': { [SELF_CLI]: ACME, [SELF]: ACME } } })
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      w.setFeed(feed({ drafts: [] }))
      await mm($, 'view')
      await mm($, 'view')
      expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
      expect(await tool($, `card ${PKG}`)).toBe(notReady('the side pane is not showing this package'))
      expect(w.fills).toEqual([])
      await u.unmount()
    })

    test('(0.7.36) the pane behind another tab: ready, and it says the card is waiting rather than on screen', async ($, on) => {
      const w = world(on, own)
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      w.setShown(false)
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
      w.setShown(true)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      await u.unmount()
    })

    test('(0.7.36) placed and shown, but the pane has not drawn this card: ready, and it says the card is waiting rather than on screen', async ($, on) => {
      const w = world(on, own)
      const u = await shown($)
      await u.unmount()
      // nothing draws the pane now: a new card, its check passing, goes into the state and reaches no screen
      w.setTree(JSON.parse(JSON.stringify(SMS_TREE).replace('"s":"prepared"', '"s":"prepared again"')))
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
    })

    test('asked while the pane is still drawing the card: ready, and never "still being drawn"', async ($, on) => {
      const w = world(on, own)
      await mm($, '')
      const u = await mount($, 'desktop')
      await u.press({ key: `drafts:${ACME}` })
      // a pass drawing the client part again as the thread asks: the state reads `rendering` for the whole of this dispatch
      const passing = mm($, '')
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      await passing
      expect(w.fills).toEqual([])
      await u.unmount()
    })

    test('a computer whose signature records the send gate cannot check: not ready, in its words, and no box to press', async ($, on) => {
      world(on, { ...own, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', OS: 'Windows_NT', HOME: 'C:\\Users\\someone' } })
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(notReady("signatures can't be checked on this computer"))
      const drawn = (await lines(u)).join('\n')
      expect(drawn).not.toContain('Click to sign and send')
      expect(drawn).toContain("Signatures can't be checked on this computer")
      await u.unmount()
    })

    test('the draw report comes after the draw: a draw stopped before the card leaves nothing on record as drawn, so `mm card` never says it is on screen', async ($, on) => {
      world(on, own)
      // The pane's draw is held where it reads the signature record, before it builds the card, for as long as `mm card` waits
      // for it. A draw that throws there stops at the same point; the test held it instead because CLI 2.1.321's kit fails any
      // test in which a plugin's ui.render hook throws (2.1.317's failed only on the test's own hooks).
      let hold: Promise<void> | undefined
      let release = () => {}
      let reached = () => {}
      const atHold = new Promise<void>(resolve => { reached = resolve })
      on('state.get', { plugin: 'mm-bridge' }, async (_$, e, next) => {
        if (hold && e.key === 'cardMarks') {
          reached()
          await hold
        }
        return next(e)
      })
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      hold = new Promise(resolve => { release = resolve })
      // the pane draws again as the screen reads it, and that draw is held: `mm card` asked meanwhile waits for it, then gives up
      const drawing = lines(u)
      await atHold
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
      hold = undefined
      release()
      // once the draw is made, it is on record, and `mm card` says so
      expect((await drawing).length).toBeGreaterThan(0)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      await u.unmount()
    })

    test('(0.7.36) the pane not placed, as in a thread running in the background: ready, it says the card is waiting, and the pane is still opened', async ($, on) => {
      const w = world(on, own)
      await mm($, '')
      const u = await mount($, 'desktop')
      await u.press({ key: `drafts:${ACME}` })
      await u.unmount()
      w.setPlaced(false)
      const opened = w.opened.length
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
      expect(w.opened.length).toBe(opened + 1)
      expect(w.fills).toEqual([])
      expect(w.prompts).toEqual([])
      expect(sends(w)).toEqual([])
    })

    test('(0.7.36) off screen, it waits no second for a pane that will not draw', async ($, on) => {
      const w = world(on, own)
      const u = await shown($)
      await u.unmount()
      w.setPlaced(false)
      const before = w.freeSeconds()
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
      expect(w.freeSeconds()).toBe(before)
    })

    test('(0.7.36) both forms start with the sentence the send gate parses, for this tag, and the on-screen words have not moved', () => {
      // global-config/hooks/send-gate.js, CARD_READY: its first capture is held against the go's 12
      const CARD_READY = /^card ready: Package ([0-9a-f]{12})\./
      for (const said of [READY, OFF_SCREEN]) expect(CARD_READY.exec(said)?.[1]).toBe(LABEL)
      expect(READY).toBe(`card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call, and in the side pane. Do not print the page. Print one line saying the card is above, the go comes from its box, and they can say "print the page" if any of it doesn't show, ending "Package ${LABEL}.", then wait for the person.`)
      expect(OFF_SCREEN.endsWith(`ending "Package ${LABEL}.", then wait for the person.`)).toBe(true)
    })

    describe('(0.7.36) a run no surface will ever attach to stays not ready, in the words it always had', () => {
      const NO_SURFACE = notReady('the side pane is not open on a surface that can draw it')
      test('`claude -p`: not a person\'s session, by what session.start found', async ($, on) => {
        const w = world(on, own)
        // the card drawn first, as in a person's session; then the session reads as session.start records a `claude -p`
        let headless = false
        on('state.get', { plugin: 'mm-bridge' }, async (_$, e, next) => {
          const got = (await next(e)) as { value: { value?: unknown } }
          if (!headless || e.key !== 'sess') return got as never
          return { value: { ...got.value, value: { prompts: 0, interactive: false } } } as never
        })
        const u = await shown($)
        await u.unmount()
        w.setPlaced(false)
        headless = true
        expect(await tool($, `card ${PKG}`)).toBe(NO_SURFACE)
      })

      test('MM_UNATTENDED=1', async ($, on) => {
        world(on, { ...own, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(NO_SURFACE)
        await u.unmount()
      })

      test('a first prompt that begins SINGLE-SESSION', async ($, on) => {
        world(on, own)
        await $.prompt.submit({ text: 'SINGLE-SESSION reconcile one client', wait: false, origin: { kind: 'sdk' } })
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(NO_SURFACE)
        await u.unmount()
      })

      test('nothing of it opens the box', async ($, on) => {
        world(on, { ...own, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
        const u = await shown($)
        await tool($, `card ${PKG}`)
        await endTurn($)
        expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
        await u.unmount()
      })

      test('a person at a terminal REPL is not one of these: the pane waits for a wider window, and the card is ready', async ($, on) => {
        const w = world(on, { ...own, terminal: true, store: { ...own.store, 'mm.current': { [`cli:${SELF_CLI}`]: { pid: ACME, how: 'primary', at: NOW } } } })
        await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
        const u = await shown($, 'terminal')
        await u.unmount()
        w.setPlaced(false)
        expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
      })
    })

    describe('(0.7.36) the box waits for this thread: the end of the turn that got `card ready`, or printed the page', () => {
      const CHECK_WORDS = `Check package ${LABEL}`
      const WAITING = 'This thread is still checking this package. The signature box opens when it finishes.'
      const NOT_CHECKED = 'This thread has not checked this version of the package yet.'
      /** A turn of the main conversation starts. */
      const startTurn = ($: Engine, turnId = 't1') => $.turn.start({ text: 'go', turnId })
      const hasBox = async (u: Drawing) => (await buttons(u)).some(([k]) => k === `mm-card-sign-btn:${LABEL}`)
      /** The thread prints the package's page, as a client thread's answer does: a response row of the main loop. */
      const prints = ($: Engine, text: string, agentId?: string) =>
        $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] }, door: 'response', origin: { kind: 'model', model: 'claude-opus-5-5' }, uuid: `row-${text.length}`, ...(agentId ? { agentId } : {}) } as never)
      const pair = CARD_PAIRS["rob's mail, plan not approved"] as { page: string; tree: { package_sha256: string; label: string } }
      const approved = CARD_PAIRS["rob's mail, plan approved"] as { page: string; tree: { package_sha256: string; label: string } }
      const pick = (p: { page: string; tree: { package_sha256: string } }) => ({ ok: true, markdown: p.page, package_sha256: p.tree.package_sha256 })

      for (const surface of SURFACES) {
        test(`the card stands in full with the words and the button in place of the box, and the end of the turn that got \`mm card\` opens it (${surface})`, async ($, on) => {
          world(on, own)
          const u = await shown($, surface)
          const text = (await lines(u)).join('\n')
          expect(text, surface).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
          expect(text, surface).toContain(NOT_CHECKED)
          expect(text, surface).not.toContain(WAITING)
          expect(await hasBox(u), surface).toBe(false)
          expect((await buttons(u)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1], surface).toBe('Check this package')
          await startTurn($)
          expect((await lines(u)).join('\n'), surface).toContain(WAITING)
          expect((await lines(u)).join('\n'), surface).not.toContain(NOT_CHECKED)
          expect((await buttons(u)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1], surface).toBe('Check this package')
          // (0.7.40) the on-screen words only for a pane the desktop drew: the terminal's gets the words that say they can ask for the page
          expect(await tool($, `card ${PKG}`), surface).toBe(surface === 'desktop' ? READY : OFF_SCREEN)
          expect(await hasBox(u), surface).toBe(false)
          await endTurn($)
          expect(await hasBox(u), surface).toBe(true)
          expect((await lines(u)).join('\n'), surface).not.toContain(WAITING)
          expect((await lines(u)).join('\n'), surface).not.toContain(NOT_CHECKED)
          expect((await buttons(u)).some(([k]) => k === `mm-card-check:${LABEL}`), surface).toBe(false)
          await u.unmount()
        })
      }

      test('the button puts exactly the words in the prompt box, and sends nothing', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await u.press({ key: `mm-card-check:${LABEL}` })
        expect(w.fills).toEqual([CHECK_WORDS])
        expect(w.prompts).toEqual([])
        expect(sends(w)).toEqual([])
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('a draft of the person\'s is never written over, and the pane says what to type', async ($, on) => {
        const w = world(on, { ...own, box: 'a note I was writing' })
        const u = await shown($)
        await u.press({ key: `mm-card-check:${LABEL}` })
        expect(w.fills).toEqual([])
        const said = `Your prompt box holds a draft, so type: Check package ${LABEL}`
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes(said); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).toContain(said)
        // the person sends it, and the line is over
        await startTurn($)
        expect((await lines(u)).join('\n')).not.toContain(said)
        await u.unmount()
      })

      test('a prompt box that cannot be filled: the pane says what to type, with the button still there, and the line goes when a turn starts', async ($, on) => {
        const w = world(on, { ...own, box: null })
        const u = await shown($)
        await u.press({ key: `mm-card-check:${LABEL}` })
        const said = `Type this in the thread: Check package ${LABEL}`
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes(said); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).toContain(said)
        expect((await lines(u)).join('\n')).not.toContain('holds a draft')
        expect(w.fills).toEqual([])
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1]).toBe('Check this package')
        await startTurn($)
        expect((await lines(u)).join('\n')).not.toContain(said)
        await u.unmount()
      })

      test('"change the second paragraph": an open box closes when the turn starts and comes back when it ends, with the hash the same', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        await startTurn($, 't2')
        expect(await hasBox(u)).toBe(false)
        expect((await lines(u)).join('\n')).toContain(WAITING)
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1]).toBe('Check this package')
        // a same-hash re-check while it works does not open it
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        expect(await hasBox(u)).toBe(false)
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(true)
        expect(w.written.filter(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl'))).toEqual([])
        await u.unmount()
      })

      test('a `mm card` still in flight when its turn ended and the next began opens nothing', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await startTurn($)
        const held = w.holdPickup()
        const said = tool($, `card ${PKG}`)
        for (let i = 0; i < 500 && !held.reached(); i++) await new Promise(r => setTimeout(r, 2))
        expect(held.reached()).toBe(true)
        await endTurn($, { reason: 'aborted', isAborted: true })
        await startTurn($, 't2')
        held.release()
        expect(await said).toBe(READY)
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(false)
        expect((await lines(u)).join('\n')).toContain(NOT_CHECKED)
        // asked in the turn that is under way, it does
        await startTurn($, 't3')
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($, { turnId: 't3' })
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('a stuck busy: the list cannot be read at the turn\'s end, the Check button starts a new turn, and that turn\'s end clears it', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await startTurn($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        w.setAgents('throws')
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        expect((await lines(u)).join('\n')).toContain(WAITING)
        await u.press({ key: `mm-card-check:${LABEL}` })
        expect(w.fills).toEqual([CHECK_WORDS])
        w.setAgents([])
        await startTurn($, 't2')
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('(review round 2) a sub-agent list this engine can never read: `mm card` answers not ready, so the thread prints the page', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        w.setAgents('throws')
        await startTurn($)
        expect(await tool($, `card ${PKG}`)).toBe("card not ready: this bridge cannot see whether the thread's background work has finished. Print the whole page.")
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        w.setAgents([])
        await startTurn($, 't2')
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('the thread prints the page: its closing line opens the box at the end of that turn, whether or not `mm card` was asked', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        expect(await hasBox(u)).toBe(false)
        await prints($, `Above the page, my read.\n\n${PAGE}`)
        expect(await hasBox(u)).toBe(false)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        expect(w.fills).toEqual([])
        await u.unmount()
      })

      test('a tag named in passing, a sub-agent\'s page, and another package\'s page do not', async ($, on) => {
        world(on, own)
        const u = await shown($)
        await prints($, `The old tag was Package \`${LABEL}\`.`)
        expect(await hasBox(u)).toBe(false)
        await prints($, PAGE, 'agent_1')
        expect(await hasBox(u)).toBe(false)
        await prints($, 'One go sends 1 item. Package `0123456789ab`.')
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('a sub-agent\'s `mm card` gets the same answer and opens nothing: its thread is still at work, and the gate reads the main chain alone', async ($, on) => {
        world(on, own)
        const u = await shown($)
        const said = String(((await $.tool.call({ tool: 'mcp__mm-bridge__mm', args: `card ${PKG}`, agentId: 'agent_1' } as never)) as { result?: unknown }).result ?? '')
        expect(said).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('a typed /mm card gets the same answer and opens nothing: it runs no turn, and the gate does not count it', async ($, on) => {
        world(on, own)
        const u = await shown($)
        expect(await mm($, `card ${PKG}`)).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('the real order from 2026-11-07: ready at the start of the turn, more tool calls, and the box stays closed until that turn ends', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await startTurn($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        for (const command of ['first check', 'second check', 'third check']) {
          await $.tool.call({ tool: 'Bash', command } as never)
          expect(await hasBox(u)).toBe(false)
        }
        expect((await lines(u)).join('\n')).toContain(WAITING)
        expect(w.written.filter(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl'))).toEqual([])
        expect(w.appended.filter(t => t.includes(SIGNED_START))).toEqual([])
        expect(w.fills).toEqual([])
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        await u.press({ key: `mm-card-sign-btn:${LABEL}` })
        for (let i = 0; i < 200 && !w.appended.some(t => t.includes(SIGNED_START)); i++) await new Promise(r => setTimeout(r, 2))
        expect(w.written.filter(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl')).length).toBe(1)
        await w.clock.advance(3_100)
        for (let i = 0; i < 200 && !w.prompts.length; i++) await new Promise(r => setTimeout(r, 2))
        expect(w.prompts).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
        expect(w.fills).toEqual([])
        await u.unmount()
      })

      test('a ready that lands after its interrupted turn ended opens nothing: the next turn starts by dropping it', async ($, on) => {
        world(on, own)
        const u = await shown($)
        await endTurn($, { reason: 'aborted', isAborted: true })
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await $.turn.start({ text: 'next', turnId: 't2' })
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('a sub-agent\'s turn starting does not make the thread busy, and one that ended before the turn did leaves its ready standing', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await $.turn.start({ text: 'a look', turnId: 't2', agentId: 'agent_1' } as never)
        expect((await lines(u)).join('\n')).toContain(NOT_CHECKED)
        await startTurn($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await $.turn.start({ text: 'a look', turnId: 't3', agentId: 'agent_2' } as never)
        w.setAgents([{ id: 'agent_2', status: 'completed' }])
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('a background sub-agent started after the ask and still running at the turn\'s end: the box stays closed and the thread asks again', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        await startTurn($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        w.setAgents([{ id: 'agent_1', status: 'running' }])
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        expect((await lines(u)).join('\n')).toContain(WAITING)
        // it ends, and the engine starts a new main turn: busy clears at that turn's end, and the ready was dropped
        w.setAgents([{ id: 'agent_1', status: 'completed' }])
        await endTurn($, { turnId: 'a1', agentId: 'agent_1' })
        expect(await hasBox(u)).toBe(false)
        await startTurn($, 't2')
        await endTurn($, { turnId: 't2' })
        expect(await hasBox(u)).toBe(false)
        expect((await lines(u)).join('\n')).toContain(NOT_CHECKED)
        await startTurn($, 't3')
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($, { turnId: 't3' })
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('a sub-agent\'s turn ending is not this thread\'s: the box stays closed until the thread\'s own turn ends', async ($, on) => {
        world(on, own)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($, { agentId: 'agent_1' })
        expect(await hasBox(u)).toBe(false)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      for (const [why, over] of [['interrupted', { reason: 'aborted', isAborted: true }], ['ended by an error', { reason: 'error' }]] as const) {
        test(`a turn ${why} has not finished: what it left pending is dropped, and only a new ready opens the box`, async ($, on) => {
          const w = world(on, own)
          const u = await shown($)
          expect(await tool($, `card ${PKG}`)).toBe(READY)
          await endTurn($, over)
          expect(await hasBox(u)).toBe(false)
          await endTurn($)
          expect(await hasBox(u)).toBe(false)
          // the button still asks, and the turn it starts can open the box
          await u.press({ key: `mm-card-check:${LABEL}` })
          expect(w.fills).toEqual([CHECK_WORDS])
          expect(await tool($, `card ${PKG}`)).toBe(READY)
          await endTurn($)
          expect(await hasBox(u)).toBe(true)
          await u.unmount()
        })
      }

      test('an answer that is not ready opens nothing: another package, a tag, a page with a line the card lacks', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        expect(await tool($, 'card 99999999-9999-4999-8999-999999999999')).toBe(notReady('the side pane is not showing this package'))
        expect(await tool($, 'card 3f1c9a7e')).toBe(WHOLE_ID)
        expect(await hasBox(u)).toBe(false)
        w.setPickup({ ...PICKUP, markdown: `${PAGE}\n\nA line only OW prints about the package.` })
        expect(await tool($, `card ${PKG}`)).toContain('card not ready: the page holds a line')
        await endTurn($)
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      test('answered off screen, the box is open when the person arrives', async ($, on) => {
        const w = world(on, own)
        const first = await shown($)
        await first.unmount()
        w.setPlaced(false)
        expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
        await endTurn($)
        w.setPlaced(true)
        const u = await mount($, 'desktop')
        expect(await hasBox(u)).toBe(true)
        await u.unmount()
      })

      test('a new package_sha256 closes the box until the thread answers for it', async ($, on) => {
        const w = world(on, own)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        // a revision: a new hash on OW's page, and the renderer draws it
        w.setPickup({ markdown: NEXT_PAGE, package_sha256: NEXT_SHA })
        w.setTree(JSON.parse(NEXT_TREE))
        await u.press({ key: `drafts:${ACME}` })
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes(NOT_CHECKED); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).toContain(NOT_CHECKED)
        expect((await buttons(u)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${NEXT_LABEL}`)?.[1]).toBe('Check this package')
        expect(await tool($, `card ${PKG}`)).toContain(`card ready: Package ${NEXT_LABEL}.`)
        await endTurn($)
        expect((await buttons(u)).some(([k]) => k === `mm-card-sign-btn:${NEXT_LABEL}`)).toBe(true)
        // the package comes back to the first version: what stood for it was cleared, so the box waits for the thread again
        w.setPickup(PICKUP)
        w.setTree(SMS_TREE)
        await u.press({ key: `drafts:${ACME}` })
        for (let i = 0; i < 200 && !(await buttons(u)).some(([k]) => k === `mm-card-check:${LABEL}`); i++) await new Promise(r => setTimeout(r, 2))
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1]).toBe('Check this package')
        expect(await hasBox(u)).toBe(false)
        await u.unmount()
      })

      // (0.7.42, Rob 2026-11-09: "It also needs to update itself if the work in the thread changes. It seems like it stales sometimes")
      test('(0.7.42) a revision nobody pressed for: the next sync draws the newer card by itself, with no new note to the model', LONG, async ($, on) => {
        const w = world(on, own)
        await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
        await w.clock.advance(4_000)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        const notes = w.appended.length
        // a revision made with no press here (a reconcile run folding new mail, a PATCH): a new hash on OW's page, and nothing
        // the feed lists for the client changes
        w.setPickup({ markdown: NEXT_PAGE, package_sha256: NEXT_SHA })
        w.setTree(JSON.parse(NEXT_TREE))
        for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes(NOT_CHECKED); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).toContain(NOT_CHECKED)
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${NEXT_LABEL}`)?.[1]).toBe('Check this package')
        expect(await hasBox(u)).toBe(false)
        // the pane followed it; the model was told nothing new
        expect(w.appended.length).toBe(notes)
        // the same version on the syncs after: nothing is drawn again
        const renders = w.renders.length
        for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
        expect(w.renders.length).toBe(renders)
        await u.unmount()
      })

      // (0.7.46) a read where OW gave no usable hash left the card with no version known, and no sync ever drew it again
      test('(0.7.46) a card left with no version known: the next sync with a hash draws it again, and nothing is drawn after that', LONG, async ($, on) => {
        const w = world(on, own)
        await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
        await w.clock.advance(4_000)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toBe(READY)
        await endTurn($)
        expect(await hasBox(u)).toBe(true)
        w.setPickup({ ...PICKUP, package_sha256: null })
        expect(await tool($, `card ${PKG}`)).toBe(notReady('OW gave no usable hash for this package'))
        await endTurn($)
        expect((await lines(u)).join('\n')).toContain('the package is now unknown')
        expect(await hasBox(u)).toBe(false)
        const notes = w.appended.length
        // OW gives the hash again, of the very version the card holds
        w.setPickup(PICKUP)
        for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
        for (let i = 0; i < 200 && (await lines(u)).join('\n').includes('the package is now unknown'); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).not.toContain('the package is now unknown')
        expect(await hasBox(u)).toBe(true)
        expect(w.appended.length).toBe(notes)
        // the version is known again: the syncs after draw nothing
        const renders = w.renders.length
        for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
        expect(w.renders.length).toBe(renders)
        await u.unmount()
      })

      // (0.7.43, Rob 2026-11-09, the quote view: "It also needs to update itself if the work in the thread changes.") OW binds the
      // read's `quotes` into package_sha256, so a quote is followed as any revision is: nothing here looks at what changed
      test('(0.7.43) only the quote changed: OW\'s new hash, and the next sync draws the new amount by itself, its box closed until checked', async ($, on) => {
        const before = CARD_PAIRS.quotes as { page: string; tree: { package_sha256: string; label: string } }
        const after = CARD_PAIRS['quotes, revised'] as { page: string; tree: { package_sha256: string; label: string } }
        expect(after.tree.package_sha256).not.toBe(before.tree.package_sha256)
        const w = world(on, { ...own, pickup: pick(before) })
        w.setTree(before.tree)
        await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
        await w.clock.advance(4_000)
        const u = await shown($)
        const box = async (label: string) => (await buttons(u)).some(([k]) => k === `mm-card-sign-btn:${label}`)
        expect(await tool($, `card ${PKG}`)).toContain(`card ready: Package ${before.tree.label}.`)
        await endTurn($)
        expect(await box(before.tree.label)).toBe(true)
        expect((await lines(u)).join('\n')).toContain('ZZ_quote_total 10.5 h, $2,619')
        const notes = w.appended.length
        const renders = w.renders.length
        // the quote changed (a line's amount, so the total), and nothing the feed lists for the client did
        w.setPickup(pick(after))
        w.setTree(after.tree)
        for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes('$3,119'); i++) await new Promise(r => setTimeout(r, 2))
        const text = (await lines(u)).join('\n')
        expect(text).toContain('ZZ_quote_total 10.5 h, $3,119')
        expect(text).toContain('$2,497')
        expect(text).not.toContain('ZZ_quote_total 10.5 h, $2,619')
        expect(text).toContain(NOT_CHECKED)
        expect(w.renders.length).toBeGreaterThan(renders)
        expect(await box(before.tree.label)).toBe(false)
        expect(await box(after.tree.label)).toBe(false)
        expect((await buttons(u)).find(([k]) => k === `mm-card-check:${after.tree.label}`)?.[1]).toBe('Check this package')
        expect(w.appended.length).toBe(notes)
        // the thread checks the new version: ready for it, and its box opens
        expect(await tool($, `card ${PKG}`)).toContain(`card ready: Package ${after.tree.label}.`)
        await endTurn($)
        expect(await box(after.tree.label)).toBe(true)
        await u.unmount()
      })

      test('a page that changes with the hash the same keeps the box open', async ($, on) => {
        const w = world(on, { ...own, pickup: pick(pair) })
        w.setTree(pair.tree)
        const u = await shown($)
        expect(await tool($, `card ${PKG}`)).toContain('card ready:')
        await endTurn($)
        const box = async () => (await buttons(u)).some(([k]) => k === `mm-card-sign-btn:${pair.tree.label}`)
        expect(await box()).toBe(true)
        expect(approved.tree.package_sha256).toBe(pair.tree.package_sha256)
        w.setPickup(pick(approved))
        w.setTree(approved.tree)
        await u.press({ key: `drafts:${ACME}` })
        for (let i = 0; i < 200 && !(await lines(u)).join('\n').includes('Cc support@letaidothehardwork.com'); i++) await new Promise(r => setTimeout(r, 2))
        expect((await lines(u)).join('\n')).toContain('Cc support@letaidothehardwork.com')
        expect(await box()).toBe(true)
        expect((await lines(u)).join('\n')).not.toContain(WAITING)
        await u.unmount()
      })
    })

    test('(0.7.36) a tag answers with what to do, and does not tell the thread to print the page', async ($, on) => {
      world(on, own)
      const u = await shown($)
      expect(await tool($, 'card 3f1c9a7e')).toBe(WHOLE_ID)
      expect(await mm($, 'card 3f1c9a7e')).toBe(WHOLE_ID)
      expect(WHOLE_ID).not.toContain('Print the whole page')
      await u.unmount()
    })

    test('(G11) under the card the banner, the asks and the queue stay in sight, and only the page folds', async ($, on) => {
      const held = { package_id: PKG, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'picked_up', covers_through: ago(3), drafts_ready: 2, drafts_unsent: 2, picked_up_by: ME, picked_up_at: ago(1), project_owner_email: ME }
      world(on, { ...own, feed: feed({ drafts: [held], threads: [declared(ACME, SELF_CLI, 1)] }) })
      const u = await shown($)
      const under = await u.find({ type: 'Markdown' })
      expect(under?.text).toContain('**You picked this up**')
      expect(under?.text).not.toContain('Every question answered?')
      await u.press({ key: `mm-card-page:${PKG}` })
      const all = await u.findAll({ type: 'Markdown' })
      expect(all.map(m => m.text)).toEqual([under?.text, PAGE])
      await u.unmount()
    })

    test('the person\'s go stays exactly their words: the line after a switch of profiles waits for their next prompt', async ($, on) => {
      const w = world(on, { ...own, store: { ...own.store, 'mm.profile': { dir: '/elsewhere', since: NOW - HOUR } } })
      await mm($, '')
      await w.clock.advance(60_000)
      await mm($, '')
      await $.prompt.submit({ text: `Send package ${LABEL}`, wait: false, origin: { kind: 'composer' } })
      expect(w.prompts.at(-1)?.text).toBe(`Send package ${LABEL}`)
    })
  })

  describe('0.7.40 the card in the thread: the row of the thread\'s own `mm card` call is the whole card, with a Changes field', () => {
    const READY = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call, and in the side pane. Do not print the page. Print one line saying the card is above, the go comes from its box, and they can say "print the page" if any of it doesn't show, ending "Package ${LABEL}.", then wait for the person.`
    const OFF_SCREEN = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call; the side pane draws it too when this thread is open on a screen. Do not print the page. Print one line saying the card is above, the go comes from its box, and they can say "print the page" if they can't see it or any of it doesn't show, ending "Package ${LABEL}.", then wait for the person.`
    /** The send gate's own two patterns (global-config/hooks/send-gate.js `CARD_READY` and `CARD_PRESS_NOTE`), copied here as it pins them. */
    const CARD_READY = /^card ready: Package ([0-9a-f]{12})\./
    const CARD_PRESS_NOTE = /^\[Massmarket bridge, no reply needed\] Card signed in the side pane: Package ([0-9a-f]{12}), page ([0-9a-f]{12})\. Nothing has been sent\.$/
    const own = { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } }, renderer: 'tree' as const, pickup: PICKUP }
    const shown = async ($: Engine) => {
      await mm($, '')
      const u = await mount($, 'desktop')
      await u.press({ key: `drafts:${ACME}` })
      return u
    }
    /** The live call as the tool hook notes it: the last value written to `cardAsked`, as the engine's state takes the write. */
    const watchAsked = (on: On) => {
      let last: { packageId: string; label: string; toolUseId: string } | undefined
      on('state.set', { plugin: 'mm-bridge' }, async (_$, e, next) => {
        if (e.key === 'cardAsked') last = e.value as typeof last
        return next(e)
      })
      return () => last
    }
    /** The row of one `mm card` call, as the desktop draws it once the call has answered. */
    const row = ($: Engine, toolUseId: string, output: unknown, surface: 'desktop' | 'terminal' = 'desktop') =>
      $.ui.mount({
        plugin: 'mm-bridge', surface, component: 'ToolUse', requestId: toolUseId,
        props: { tool_use_id: toolUseId, tool: 'mcp__mm-bridge__mm', input: { args: `card ${PKG}` }, isRunning: false, isErrored: false, isInterrupted: false, output } as never,
      })
    const hasBox = async (u: Drawing) => (await buttons(u)).some(([k]) => k === `mm-card-sign-btn:${LABEL}`)
    const SEALED = `Sealed and sent: your go for Package ${LABEL} is in the thread, and it is sending the package now.`
    const recorded = (w: { written: Array<{ path: string; text: string }> }) => w.written.findLast(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl'))
    const ROW_GONE_TEXT = 'This card is not held here right now. Open this client in the side pane, or ask your thread to show the package again.'

    // (0.7.42, Rob 2026-11-09: "If a reply package is updated by a thread after it's already been created, it should be displayed inside
    // the thread for clicking and sending, and the old one should disappear from the side panel at that time.")
    test('(0.7.42) the live row of a version since replaced, no newer row yet: it says the newer card is in the side pane; once checked, below', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      expect(said).toBe(READY)
      const live = String(asked()?.toolUseId)
      w.setPickup({ markdown: NEXT_PAGE, package_sha256: NEXT_SHA })
      w.setTree(JSON.parse(NEXT_TREE))
      await u.press({ key: `drafts:${ACME}` })
      for (let i = 0; i < 200 && !(await buttons(u)).some(([k]) => k === `mm-card-check:${NEXT_LABEL}`); i++) await new Promise(r => setTimeout(r, 2))
      const r = await row($, live, said)
      expect(await lines(r)).toEqual([`Package ${LABEL} was replaced by Package ${NEXT_LABEL}. The newer card is in the side pane, and your thread draws it here once it checks it.`])
      await r.unmount()
      // the thread checks the newer version: its own row draws that, and the old row says it is below
      expect(await tool($, `card ${PKG}`)).toContain(`card ready: Package ${NEXT_LABEL}.`)
      const old = await row($, live, said)
      expect(await lines(old)).toEqual([`Package ${LABEL} was replaced by Package ${NEXT_LABEL}. Read and sign the newer card below.`])
      await old.unmount()
      await u.unmount()
    })

    test('both ready answers start with the sentence the send gate parses, for this tag, and say the card is in the thread', async ($, on) => {
      for (const said of [READY, OFF_SCREEN]) expect(CARD_READY.exec(said)?.[1]).toBe(LABEL)
      const w = world(on, own)
      const u = await shown($)
      expect(await tool($, `card ${PKG}`)).toBe(READY)
      await u.unmount()
      w.setPlaced(false)
      expect(await tool($, `card ${PKG}`)).toBe(OFF_SCREEN)
    })

    test('the row of the live ready call draws the whole card, the pane\'s own drawing, and its box opens when the turn ends, in both', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      expect(said).toBe(READY)
      const live = asked()
      expect(live).toMatchObject({ packageId: PKG, label: LABEL })
      expect(typeof live?.toolUseId).toBe('string')
      const r = await row($, String(live?.toolUseId), said)
      const rowText = (await lines(r)).join('\n')
      expect(rowText).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      expect(rowText).toContain('Hi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off.')
      expect(rowText).toContain('Every question answered?')
      // the same drawing: every line of the row is a line of the pane's card
      const paneText = await lines(u)
      for (const line of await lines(r)) expect(paneText).toContain(line)
      // the box waits for the end of the turn there as here, with the same button in its place
      expect(await hasBox(r)).toBe(false)
      expect((await buttons(r)).find(([k]) => k === `mm-card-check:${LABEL}`)?.[1]).toBe('Check this package')
      await endTurn($)
      expect(await hasBox(r)).toBe(true)
      expect(await hasBox(u)).toBe(true)
      expect((await r.findAll({ type: 'Input' })).map(i => i.key)).toEqual([`mm-card-feedback:${LABEL}`])
      expect(rowText).not.toContain('card ready:')
      // a turn that starts closes both boxes again; the Changes field stays, as a submit waits until the thread is idle
      await $.turn.start({ text: 'change the second paragraph', turnId: 't2' })
      expect(await hasBox(r)).toBe(false)
      expect(await hasBox(u)).toBe(false)
      expect((await r.findAll({ type: 'Input' })).map(i => i.key)).toEqual([`mm-card-feedback:${LABEL}`])
      expect((await u.findAll({ type: 'Input' })).map(i => i.key)).toEqual([`mm-card-feedback:${LABEL}`])
      await r.unmount()
      await u.unmount()
    })

    test('a press in the row is the pane\'s press: the same record and the same note, which the send gate\'s patterns match, and Sealed in both', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      for (let i = 0; i < 200 && !recorded(w); i++) await new Promise(res => setTimeout(res, 2))
      const record = JSON.parse(recorded(w)?.text.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>
      expect(record).toMatchObject({ v: 1, session_id: SELF_CLI, package_id: PKG, package_sha256: SMS_TREE.package_sha256, label: LABEL })
      expect(record.page_sha256).toMatch(/^[0-9a-f]{64}$/)
      for (let i = 0; i < 200 && !w.appended.some(t => t.includes(SIGNED_START)); i++) await new Promise(res => setTimeout(res, 2))
      const notes = w.appended.filter(t => t.includes(SIGNED_START)).map(t => JSON.parse(t) as { content: Array<{ text: string }> })
      expect(notes).toHaveLength(1)
      const note = notes[0]?.content[0]?.text ?? ''
      expect(note).toBe(SIGNED(String(record.page_sha256).slice(0, 12)))
      const m = CARD_PRESS_NOTE.exec(note)
      expect(m?.[1]).toBe(LABEL)
      expect(m?.[2]).toBe(String(record.page_sha256).slice(0, 12))
      expect(w.fills).toEqual([])
      expect(w.prompts).toEqual([])
      await w.clock.advance(3_100)
      for (let i = 0; i < 200 && !w.prompts.length; i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
      expect(w.fills).toEqual([])
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(SEALED); i++) await new Promise(res => setTimeout(res, 2))
      expect((await lines(r)).join('\n')).toContain(SEALED)
      expect((await lines(u)).join('\n')).toContain(SEALED)
      // a press in the pane now writes nothing more: one signature for both, one go
      await u.press({ key: `mm-card-sign-btn:${LABEL}` }).catch(() => undefined)
      await w.clock.advance(3_100)
      expect(w.appended.filter(t => t.includes(SIGNED_START))).toHaveLength(1)
      expect(w.prompts).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
      await r.unmount()
      await u.unmount()
    })

    test('the row\'s record has the send gate\'s fields in the order the pane\'s has them, one line, mode set to 0600', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      for (let i = 0; i < 200 && !recorded(w); i++) await new Promise(res => setTimeout(res, 2))
      const text = recorded(w)?.text ?? ''
      expect(text.endsWith('\n')).toBe(true)
      expect(text.trim().split('\n')).toHaveLength(1)
      expect(Object.keys(JSON.parse(text.trim()) as Record<string, unknown>)).toEqual(['v', 'session_id', 'package_id', 'package_sha256', 'page_sha256', 'label', 'signer', 'at'])
      for (let i = 0; i < 200 && !w.argvs().some(a => a[0] === 'chmod'); i++) await new Promise(res => setTimeout(res, 2))
      expect(w.argvs().find(a => a[0] === 'chmod')).toEqual(['chmod', '600', '/home/someone/.claude/mm-hooks/card-signed.jsonl'])
      await r.unmount()
      await u.unmount()
    })

    test('an earlier ready of the same tag says it is shown again below; the newest draws the card', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const first = await tool($, `card ${PKG}`)
      const firstId = String(asked()?.toolUseId)
      const second = await tool($, `card ${PKG}`)
      const secondId = String(asked()?.toolUseId)
      expect(secondId).not.toBe(firstId)
      const old = await row($, firstId, first)
      expect(await lines(old)).toEqual([`Shown again below. Package ${LABEL}.`])
      expect(await buttons(old)).toEqual([])
      const now = await row($, secondId, second)
      expect((await lines(now)).join('\n')).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      await old.unmount()
      await now.unmount()
      await u.unmount()
    })

    test('a ready of a tag since replaced names the newer one, and the newer call draws the newer card', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const first = await tool($, `card ${PKG}`)
      const firstId = String(asked()?.toolUseId)
      await endTurn($)
      w.setPickup({ markdown: NEXT_PAGE, package_sha256: NEXT_SHA })
      w.setTree(JSON.parse(NEXT_TREE))
      await u.press({ key: `drafts:${ACME}` })
      for (let i = 0; i < 200 && !(await buttons(u)).some(([k]) => k === `mm-card-check:${NEXT_LABEL}`); i++) await new Promise(res => setTimeout(res, 2))
      const second = await tool($, `card ${PKG}`)
      expect(CARD_READY.exec(second)?.[1]).toBe(NEXT_LABEL)
      const old = await row($, firstId, first)
      expect(await lines(old)).toEqual([`Package ${LABEL} was replaced by Package ${NEXT_LABEL}. Read and sign the newer card below.`])
      expect(await buttons(old)).toEqual([])
      const now = await row($, String(asked()?.toolUseId), second)
      expect((await buttons(now)).some(([k]) => k === `mm-card-check:${NEXT_LABEL}`)).toBe(true)
      await endTurn($)
      expect((await buttons(now)).some(([k]) => k === `mm-card-sign-btn:${NEXT_LABEL}`)).toBe(true)
      expect((await buttons(old)).some(([k]) => k.startsWith('mm-card-sign-btn'))).toBe(false)
      await old.unmount()
      await now.unmount()
      await u.unmount()
    })

    test('a ready row for a package the bridge no longer holds says so', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const other = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
      const r = await $.ui.mount({
        plugin: 'mm-bridge', surface: 'desktop', component: 'ToolUse', requestId: 'toolu_other',
        props: { tool_use_id: 'toolu_other', tool: 'mcp__mm-bridge__mm', input: { args: `card ${other}` }, isRunning: false, isErrored: false, isInterrupted: false, output: said } as never,
      })
      // (0.7.41) the last sync lists that package nowhere: no longer waiting, never "open it again"
      expect(await lines(r)).toEqual([`Package ${LABEL} is no longer waiting: the last sync lists nothing of it for you to send.`])
      await r.unmount()
      await u.unmount()
    })

    test('a sub-agent\'s ready call is never the live one: the main thread\'s stands, and with none on record its row draws a line', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const sub = String(((await $.tool.call({ tool: 'mcp__mm-bridge__mm', args: `card ${PKG}`, agentId: 'agent_1' } as never)) as { result?: unknown }).result ?? '')
      expect(sub).toBe(READY)
      expect(asked()).toBeUndefined()
      // (0.7.40) no live call on record: a ready row says the card is not held here, never that it is shown below
      const subRow = await row($, 'toolu_sub', sub)
      expect(await lines(subRow)).toEqual([ROW_GONE_TEXT])
      await subRow.unmount()
      const said = await tool($, `card ${PKG}`)
      const live = asked()
      expect(live?.label).toBe(LABEL)
      await $.tool.call({ tool: 'mcp__mm-bridge__mm', args: `card ${PKG}`, agentId: 'agent_1' } as never)
      expect(asked()).toEqual(live)
      const r = await row($, String(live?.toolUseId), said)
      expect((await lines(r)).join('\n')).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      await r.unmount()
      await u.unmount()
    })

    test('a typed /mm card is never the live one either, and not-ready answers note nothing', async ($, on) => {
      world(on, { ...own, feed: feed({ threads: [declared(ACME, 'cli-acme', 30)] }), threads: [thread('local_a', 'Roof quote', 30)], store: { 'mm.threads': PAIRS } })
      const asked = watchAsked(on)
      await mm($, '')
      const u = await mount($, 'desktop')
      await u.press({ key: `drafts:${ACME}` })
      expect(await tool($, `card ${PKG}`)).toContain('card not ready:')
      expect(await mm($, `card ${PKG}`)).toContain('card not ready:')
      expect(asked()).toBeUndefined()
      await u.unmount()
    })

    test('on the terminal the row is the engine\'s: the card is in the pane there', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      // the engine's own row, beneath the plugins
      on('ui.render', { component: 'ToolUse' }, (t$, e) => (t$.ui.resolve(e) as { Text: (p: { children: string }) => unknown }).Text({ children: 'the engine\'s own row' }) as never)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said, 'terminal')
      expect(await lines(r)).toEqual(['the engine\'s own row'])
      expect((await buttons(r)).some(([k]) => k.startsWith('mm-card-'))).toBe(false)
      // and the desktop's is the card
      const d = await row($, String(asked()?.toolUseId), said)
      expect((await lines(d)).join('\n')).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      await d.unmount()
      await r.unmount()
      await u.unmount()
    })

    test('the Changes field sends exactly the feedback prompt into the thread, writes no record and no note, and says so in the row and the pane', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.input({ key: `mm-card-feedback:${LABEL}`, text: '  Make the second paragraph shorter.  ' })
      const sent = 'Sent to your thread. It is revising the package and will show the new card here.'
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(sent); i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts.map(p => p.text)).toEqual([`Feedback on Package ${LABEL} from Test Signer: Make the second paragraph shorter.`])
      // the person's own words: the model reads them bare, and every hook still sees this plugin's origin
      expect(w.prompts[0]?.origin).toMatchObject({ kind: 'plugin', name: 'mm-bridge', asUser: true })
      expect((await lines(r)).join('\n')).toContain(sent)
      expect((await lines(u)).join('\n')).toContain(sent)
      expect(recorded(w)).toBeUndefined()
      expect(w.appended.filter(t => t.includes(SIGNED_START))).toEqual([])
      expect(w.fills).toEqual([])
      await w.clock.advance(3_100)
      expect(w.fills).toEqual([])
      await r.unmount()
      await u.unmount()
    })

    test('the Changes field in the pane does the same: one field, one handler', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      await tool($, `card ${PKG}`)
      await endTurn($)
      expect((await u.findAll({ type: 'Input' })).map(i => i.key)).toEqual([`mm-card-feedback:${LABEL}`])
      await u.input({ key: `mm-card-feedback:${LABEL}`, text: 'Use her first name' })
      for (let i = 0; i < 200 && !w.prompts.length; i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts.map(p => p.text)).toEqual([`Feedback on Package ${LABEL} from Test Signer: Use her first name`])
      await u.unmount()
    })

    test('empty words, and words that read like the go, send nothing; the go stays the box\'s', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.input({ key: `mm-card-feedback:${LABEL}`, text: '   ' })
      for (let i = 0; i < 20; i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts).toEqual([])
      await r.input({ key: `mm-card-feedback:${LABEL}`, text: `Send package ${LABEL}` })
      const go = 'That reads like a go. Use the box below to sign and send.'
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(go); i++) await new Promise(res => setTimeout(res, 2))
      expect((await lines(r)).join('\n')).toContain(go)
      expect(w.prompts).toEqual([])
      expect(w.fills).toEqual([])
      expect(recorded(w)).toBeUndefined()
      await r.unmount()
      await u.unmount()
    })

    test('a submit the engine refuses puts the same words in the prompt box and says to press Enter', async ($, on) => {
      const w = world(on, { ...own, submit: 'drop' })
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.input({ key: `mm-card-feedback:${LABEL}`, text: 'tighten the subject line' })
      const filled = 'That did not reach your thread, so it is in your prompt box. Press Enter to send it.'
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(filled); i++) await new Promise(res => setTimeout(res, 2))
      expect(w.fills).toEqual([`Feedback on Package ${LABEL} from Test Signer: tighten the subject line`])
      expect(w.prompts).toEqual([])
      expect(recorded(w)).toBeUndefined()
      await r.unmount()
      await u.unmount()
    })

    test('the field stays on a card whose box is closed, and a submit while the thread works is taken as the person\'s words', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      await $.turn.start({ text: 'pick it up', turnId: 't1' })
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      expect(await hasBox(r)).toBe(false)
      expect((await lines(r)).join('\n')).toContain('This thread is still checking this package.')
      await r.input({ key: `mm-card-feedback:${LABEL}`, text: 'and add the Saturday hours' })
      for (let i = 0; i < 200 && !w.prompts.length; i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts.map(p => p.text)).toEqual([`Feedback on Package ${LABEL} from Test Signer: and add the Saturday hours`])
      // (0.7.40) the thread was working: the card says it reads this when it finishes, and that Stop is the way to stop a send
      const busySaid = 'Your thread is busy, so it reads this when it finishes. A send already under way is not stopped by this: press Stop for that.'
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(busySaid); i++) await new Promise(res => setTimeout(res, 2))
      expect((await lines(r)).join('\n')).toContain(busySaid)
      expect((await lines(u)).join('\n')).toContain(busySaid)
      expect(recorded(w)).toBeUndefined()
      await r.unmount()
      await u.unmount()
    })

    /** The engine's own drawing of a component beneath the plugins, as a test stands in for it: one line naming it. */
    const engineDraws = (on: On, component: 'ToolResult' | 'ToolGroup' | 'ToolUse', seen?: Array<Record<string, unknown>>) =>
      on('ui.render', { component }, (t$, e) => {
        seen?.push(e.props as Record<string, unknown>)
        return (t$.ui.resolve(e) as { Text: (p: { children: string }) => unknown }).Text({ children: `the engine's ${component}` }) as never
      })
    const result = ($: Engine, toolUseId: string, output: unknown) =>
      $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'ToolResult', requestId: toolUseId, props: { tool_use_id: toolUseId, tool: 'mcp__mm-bridge__mm', output, isErrored: false } as never })

    test('the model\'s answer under the card is not drawn for the person, the fail-safe line is in its place; under a row the bridge left to the engine it is', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      engineDraws(on, 'ToolResult')
      engineDraws(on, 'ToolUse')
      const u = await shown($)
      const first = await tool($, `card ${PKG}`)
      const firstId = String(asked()?.toolUseId)
      const second = await tool($, `card ${PKG}`)
      const secondId = String(asked()?.toolUseId)
      // the card's row, then under it in place of its answer one dim line: how to get the page if any of the card does not show
      const r = await row($, secondId, second)
      const res = await result($, secondId, second)
      expect(await lines(res)).toEqual([`If any part of the card above doesn't show, say "print the page" and your thread prints the whole package as text.`])
      expect(await res.drawn()).toMatchObject({ type: 'Text' })
      expect(JSON.stringify(await res.drawn())).not.toContain('card ready')
      // an earlier ready row draws its line, and its answer is hidden, with nothing in its place
      const old = await row($, firstId, first)
      expect(await lines(old)).toEqual([`Shown again below. Package ${LABEL}.`])
      const oldRes = await result($, firstId, first)
      expect(await lines(oldRes)).toEqual([])
      // a not-ready row is the engine's, and so is its answer
      const notReady = 'card not ready: the card is still being drawn. Print the whole page.'
      const nr = await row($, 'toolu_not_ready', notReady)
      expect(await lines(nr)).toEqual(["the engine's ToolUse"])
      const nrRes = await result($, 'toolu_not_ready', notReady)
      expect(await lines(nrRes)).toEqual(["the engine's ToolResult"])
      // and a result whose row was never drawn
      const stray = await result($, 'toolu_stray', second)
      expect(await lines(stray)).toEqual(["the engine's ToolResult"])
      for (const m of [r, res, old, oldRes, nr, nrRes, stray, u]) await m.unmount()
    })

    test('a group the desktop folds is unfolded when it holds the live call, and left as it is otherwise', async ($, on) => {
      world(on, own)
      const asked = watchAsked(on)
      const seen: Array<Record<string, unknown>> = []
      engineDraws(on, 'ToolGroup', seen)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const live = String(asked()?.toolUseId)
      const call = (id: string, tool = 'mcp__mm-bridge__mm') => ({ tool_use_id: id, tool, input: { args: `card ${PKG}` }, isRunning: false, isErrored: false, isInterrupted: false, output: said })
      const group = (calls: unknown[], requestId: string) =>
        $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'ToolGroup', requestId, props: { calls, isActive: false, isExpanded: false } as never })
      const holding = await group([call('toolu_read', 'Read'), call(live)], 'g1')
      expect(seen.at(-1)?.isExpanded).toBe(true)
      const other = await group([call('toolu_read', 'Read'), call('toolu_elsewhere')], 'g2')
      expect(seen.at(-1)?.isExpanded).toBe(false)
      for (const m of [holding, other, u]) await m.unmount()
    })

    test('where the pane draws no card (its client part emptied), the row draws one dim line, and a box already on screen signs nothing', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      // the client part as `/mm link` to a client on no list leaves it: emptied, with the card still held
      let emptied = false
      on('state.get', { plugin: 'mm-bridge' }, async (_$, e, next) => {
        const got = (await next(e)) as { value: { value?: unknown } }
        if (!emptied || e.key !== 'view') return got as never
        return { value: { ...got.value, value: { text: '', heading: '' } } } as never
      })
      const notices: unknown[] = []
      on('state.set', { plugin: 'mm-bridge' }, async (_$, e, next) => {
        if (e.key === 'cardMarks') notices.push((e.value as { notice?: unknown } | null)?.notice)
        return next(e)
      })
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      expect(await hasBox(r)).toBe(true)
      emptied = true
      // a press on the box drawn before: no record, no note, no words, and the box says to try again
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      await w.clock.advance(3_100)
      for (let i = 0; i < 50; i++) await new Promise(res => setTimeout(res, 1))
      expect(recorded(w)).toBeUndefined()
      expect(w.appended.filter(t => t.includes(SIGNED_START))).toEqual([])
      expect(w.fills).toEqual([])
      // refused by the pane's own test, with the box's own try-again notice, and never a check of the page begun
      expect(notices.at(-1)).toEqual({ packageId: PKG, kind: 'retry' })
      // drawn again, the row is the line, with no box to press, as the pane has no card
      await r.unmount()
      const again = await row($, String(asked()?.toolUseId), said)
      expect(await lines(again)).toEqual([ROW_GONE_TEXT])
      expect(await buttons(again)).toEqual([])
      expect((await lines(u)).join('\n')).not.toContain('Hi! Is the new booking link live yet?')
      for (const m of [again, u]) await m.unmount()
    })

    test('the field is the desktop\'s alone: the terminal\'s pane draws the card with no field, and its caption names the chat box', async ($, on) => {
      world(on, own)
      await mm($, '')
      const t = await $.ui.mount({ plugin: 'mm-bridge', surface: 'terminal', component: 'Pane', requestId: 'mm-queue', props: PANE })
      await t.press({ key: `drafts:${ACME}` })
      await tool($, `card ${PKG}`)
      await endTurn($)
      const said = (await lines(t)).join('\n')
      expect(said).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      expect(await t.findAll({ type: 'Input' })).toEqual([])
      expect(said).toContain(`One press signs and sends: "Send package ${LABEL}" goes to your thread as your go, and it sends the package. Changes go in the chat box.`)
      expect(said).not.toContain('Changes box')
      await t.unmount()
    })

    test('a turn that starts while the envelope flies sends nothing and drops the signature: the box closes, says why, and comes back for a second press once the turn ends', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      for (let i = 0; i < 200 && !w.appended.some(t => t.includes(SIGNED_START)); i++) await new Promise(res => setTimeout(res, 2))
      expect(recorded(w)).toBeDefined()
      expect(w.appended.filter(t => t.includes(SIGNED_START))).toHaveLength(1)
      // a change sent from the card, say: the thread is at work before the words go in
      await $.turn.start({ text: 'make it shorter', turnId: 't-change' })
      await w.clock.advance(3_100)
      expect(w.fills).toEqual([])
      expect(w.prompts.filter(p => p.text.startsWith('Send package'))).toEqual([])
      const BUSY = 'Your thread started working while you signed, so nothing was sent. Sign again once it finishes.'
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(BUSY); i++) await new Promise(res => setTimeout(res, 2))
      expect((await lines(r)).join('\n')).toContain(BUSY)
      expect((await lines(u)).join('\n')).toContain(BUSY)
      expect((await lines(r)).join('\n')).not.toContain(SEALED)
      expect(await hasBox(r)).toBe(false)
      expect(await hasBox(u)).toBe(false)
      // the turn ends: the box is offered again for the same tag, in the row and the pane
      await endTurn($)
      expect(await hasBox(r)).toBe(true)
      expect(await hasBox(u)).toBe(true)
      // a second press: a second record line and note, then exactly the go
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      for (let i = 0; i < 200 && w.appended.filter(t => t.includes(SIGNED_START)).length < 2; i++) await new Promise(res => setTimeout(res, 2))
      expect(w.appended.filter(t => t.includes(SIGNED_START))).toHaveLength(2)
      expect(w.written.filter(f => f.path.endsWith('/.claude/mm-hooks/card-signed.jsonl'))).toHaveLength(2)
      await w.clock.advance(3_100)
      for (let i = 0; i < 200 && !w.prompts.some(p => p.text.startsWith('Send package')); i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts.filter(p => p.text.startsWith('Send package'))).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
      expect(w.fills).toEqual([])
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(SEALED); i++) await new Promise(res => setTimeout(res, 2))
      expect((await lines(r)).join('\n')).toContain(SEALED)
      for (const m of [r, u]) await m.unmount()
    })

    test('once the row is signed there is no Changes field in the row or the pane, and nothing in its place', async ($, on) => {
      const w = world(on, own)
      const asked = watchAsked(on)
      const u = await shown($)
      const said = await tool($, `card ${PKG}`)
      const r = await row($, String(asked()?.toolUseId), said)
      await endTurn($)
      expect((await r.findAll({ type: 'Input' })).map(i => i.key)).toEqual([`mm-card-feedback:${LABEL}`])
      await r.press({ key: `mm-card-sign-btn:${LABEL}` })
      for (let i = 0; i < 200 && !w.appended.some(t => t.includes(SIGNED_START)); i++) await new Promise(res => setTimeout(res, 2))
      await w.clock.advance(3_100)
      for (let i = 0; i < 200 && !(await lines(r)).join('\n').includes(SEALED); i++) await new Promise(res => setTimeout(res, 2))
      expect(w.prompts).toEqual([{ text: `Send package ${LABEL}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
      expect(w.fills).toEqual([])
      expect((await lines(r)).join('\n')).toContain(SEALED)
      expect(await r.findAll({ type: 'Input' })).toEqual([])
      expect(await u.findAll({ type: 'Input' })).toEqual([])
      for (const m of [r, u]) await m.unmount()
    })
  })
})

// ======================================================================== 0.7.34

// (0.7.34, Rob 2026-11-07) "I still think that's the wrong architecture. I think in the side panel there should be a dropdown
// that reveals something that looks just like what we added to the bottom of the daily team photo."
describe('0.7.34: Team now, Needs you now that folds, the pin marks and the no-thread card', () => {
  const MIN = 60_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const asif = (over: Record<string, unknown> = {}) => ({
    name: 'Asif', me: false, bridge_version: '0.7.34', bridge_seen_at: iso(NOW - MIN),
    report: { reported_at: iso(NOW - 4 * MIN), items: [{ project_id: ACME, client: 'Acme Roofing', kind: 'ready', tone: 'yellow', due_at: iso(NOW + 3 * HOUR), pinned: true, why_not: null }], extra: [] },
    running: [{ session_ref: 'r1', client: 'Acme Roofing', project_id: ACME, working: true, auto: false, since: iso(NOW - 25 * MIN), since_capped: false, last_at: iso(NOW - MIN), task: 'reply drafts', title: null }],
    assigned: [],
    ...over,
  })
  const read = (...people: unknown[]) => ({ status: 200, body: { ok: true, at: iso(NOW), role: 'founder', partial: [], people } })
  const teamFetches = (w: { fetched: string[] }) => w.fetched.filter(u => u.endsWith('/api/ext/team-now')).length
  const TOGGLE = 'mm-teamnow-toggle'
  const label = async (ui: Drawing, key: string): Promise<string | undefined> => (await buttons(ui)).find(b => b[0] === key)?.[1]

  describe('Team now', () => {
    test('closed, its one line carries the counts; pressed, it opens on what the photo shows, read at once; pressed again, it closes', async ($, on) => {
      const w = world(on, { feed: feed(), teamNow: () => read(asif()) })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await label(ui, TOGGLE)).toBe('Team now · 1 working  ▸')
      expect((await lines(ui)).some(l => l.startsWith('Asif'))).toBe(false)
      const before = teamFetches(w)
      await ui.press({ key: TOGGLE })
      expect(teamFetches(w)).toBe(before + 1)
      expect(await label(ui, TOGGLE)).toBe('Team now · 1 working  ▾')
      const open = await lines(ui)
      expect(open.some(l => l.startsWith('Asif · 1 pinned') || /^Asif · .*1 pinned/.test(l))).toBe(true)
      expect(open).toContain('  ▶ Acme Roofing · 25m · reply drafts')
      expect(open.some(l => l.startsWith('  ● Acme Roofing · reply ready'))).toBe(true)
      await ui.press({ key: TOGGLE })
      expect((await lines(ui)).some(l => l.startsWith('Asif'))).toBe(false)
      await ui.unmount()
    })

    test('it stays as the person left it, in every thread on this computer', async ($, on) => {
      const w = world(on, { feed: feed(), teamNow: () => read(asif()), store: { 'mm.panel': { teamNow: true, needs: false } } })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await label(ui, TOGGLE)).toBe('Team now · 1 working  ▾')
      expect((await lines(ui)).some(l => l.startsWith('Asif'))).toBe(true)
      expect(await label(ui, 'mm-needs-toggle')).toBe('Needs you now (3)  ▸')
      await ui.unmount()
    })

    test('the read: every minute while it is open, every 5 minutes while it is closed, and the tick of a thread that does not poll asks nothing', async ($, on) => {
      const w = world(on, { feed: feed(), teamNow: () => read(asif()), store: { 'mm.panel': { teamNow: true } } })
      await tickOnce($, w)
      const open = teamFetches(w)
      expect(open).toBeGreaterThan(0)
      await w.clock.advance(MIN)
      expect(teamFetches(w)).toBe(open + 1)
      w.stored['mm.panel'] = { teamNow: false }
      const closed = teamFetches(w)
      for (let i = 0; i < 4; i++) await w.clock.advance(MIN)
      expect(teamFetches(w)).toBe(closed)
      await w.clock.advance(MIN)
      expect(teamFetches(w)).toBe(closed + 1)
    })

    test('an OW without the route: it says so, and is not asked again for a day; a read that fails keeps the last one', async ($, on) => {
      let answer: { status: number; body?: unknown } | 'network' = { status: 404 }
      const w = world(on, { feed: feed(), teamNow: () => answer, store: { 'mm.panel': { teamNow: true } } })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await lines(ui)).toContain('Team now is not available yet.')
      const asked = teamFetches(w)
      await w.clock.advance(5 * MIN)
      expect(teamFetches(w)).toBe(asked)
      // opened by a press, it asks all the same
      answer = read(asif())
      await ui.press({ key: TOGGLE })
      await ui.press({ key: TOGGLE })
      expect((await lines(ui)).some(l => l.startsWith('Asif'))).toBe(true)
      answer = 'network'
      await w.clock.advance(MIN)
      expect((await lines(ui)).some(l => l.startsWith('Asif'))).toBe(true)
      await ui.unmount()
    })

    test('a task assigned to a teammate shows as new, and moving to another shows who it came from', async ($, on) => {
      const task = { ticket_ref: 't1', ticket_id: null, client: 'Acme Roofing', project_id: ACME, title: 'Fix the form', at: iso(NOW - 2 * MIN) }
      let team = read(asif({ assigned: [task], running: [] }), { ...asif({ name: 'Nayan', running: [], report: null }) })
      const w = world(on, { feed: feed(), teamNow: () => team, store: { 'mm.panel': { teamNow: true } } })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await lines(ui)).toContain('  → New: Acme Roofing · Fix the form · 2m ago')
      team = read(asif({ assigned: [], running: [] }), asif({ name: 'Nayan', running: [], report: null, assigned: [{ ...task, at: iso(NOW + MIN) }] }))
      await w.clock.advance(MIN)
      const moved = await lines(ui)
      expect(moved.some(l => l.startsWith('  → From Asif: Acme Roofing'))).toBe(true)
      // and it keeps saying so on the next read, while the task is on the list
      await w.clock.advance(MIN)
      expect((await lines(ui)).some(l => l.startsWith('  → From Asif: Acme Roofing'))).toBe(true)
      await ui.unmount()
    })

    test('/mm team says it in text, and sends nothing', async ($, on) => {
      const w = world(on, { feed: feed(), teamNow: () => read(asif()) })
      await tickOnce($, w)
      const text = await mm($, 'team')
      expect(text).toContain('Team now')
      expect(text).toContain('▶ Acme Roofing · 25m · reply drafts')
      expect(sends(w)).toEqual([])
    })
  })

  describe('Needs you now', () => {
    test('it folds, and the rows go with it; the groups under it stay', async ($, on) => {
      const w = world(on, { feed: feed(), threads: [] })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await label(ui, 'mm-needs-toggle')).toBe('Needs you now (3)  ▾')
      expect((await lines(ui)).some(l => l.includes('Cedar Dental'))).toBe(true)
      await ui.press({ key: 'mm-needs-toggle' })
      expect(await label(ui, 'mm-needs-toggle')).toBe('Needs you now (3)  ▸')
      expect((await lines(ui)).some(l => l.includes('Cedar Dental'))).toBe(false)
      await ui.press({ key: 'mm-needs-toggle' })
      expect((await lines(ui)).some(l => l.includes('Cedar Dental'))).toBe(true)
      await ui.unmount()
    })

    test('beside it: how many threads are not started and one button, from one client up', async ($, on) => {
      const w = world(on, { tools: 'start', feed: cedarAlone(), threads: [] })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await lines(ui)).toContain('1 thread not started')
      expect((await buttons(ui)).filter(b => b[0] === 'mm-start-all')).toEqual([['mm-start-all', 'Start missing threads']])
      await ui.unmount()
    })

    test('three missing: the count says so, and still the one button', async ($, on) => {
      const w = world(on, { tools: 'start', feed: feed(), threads: [] })
      await tickOnce($, w)
      const ui = await pane($)
      expect(await lines(ui)).toContain('3 threads not started')
      expect((await buttons(ui)).filter(b => b[0] === 'mm-start-all')).toEqual([['mm-start-all', 'Start missing threads']])
      await ui.unmount()
    })

    test('with none missing, the row holds the heading alone', async ($, on) => {
      const w = world(on, { tools: 'start', feed: feed({ drafts: [], mail: [] }), threads: [thread('local_c', 'Cedar', 5)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
      await tickOnce($, w)
      const ui = await pane($)
      expect((await lines(ui)).some(l => l.endsWith('not started'))).toBe(false)
      expect((await buttons(ui)).filter(b => b[0] === 'mm-start-all')).toEqual([])
      await ui.unmount()
    })

    test('the marks: ● green on a row whose thread is pinned, ○ amber on one that should be and is not; only a thread that exists says why', async ($, on) => {
      const w = world(on, { feed: feed(), threads: [thread('local_a', 'Roof quote', 30), thread('local_b', 'Bolt', 30)], store: { 'mm.links': { [ACME]: 'local_a', [BOLT]: 'local_b' } } })
      await tickOnce($, w)
      const ui = await pane($)
      const texts = await ui.findAll({ type: 'Text' })
      const marks = texts.filter(t => t.text === '●' || t.text === '○')
      expect(marks.length).toBe(3)
      expect(marks.filter(t => t.text === '●').every(t => t.props.color === 'success')).toBe(true)
      expect(marks.filter(t => t.text === '○').every(t => t.props.color === 'warning')).toBe(true)
      // Cedar has no thread: its row says so, and no second line says it again
      expect(await lines(ui)).not.toContain('not pinned: no thread')
      await ui.unmount()
    })
  })

  describe('the no-thread card (Rob: "still should have started a chip for them"; "Once they had reply packages ready")', () => {
        /** A package ready for a client far outside the pin's window: never pinned, as Doug Brockbank, Advanced Credit Therapy and Nirvvana were on 11-07. */
    const farPackage = () => feed({ mail: [], tickets: {}, drafts: [{ package_id: PKG, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: ago(3), due_at: new Date(NOW + 60 * HOUR).toISOString(), drafts_ready: 2, project_owner_email: ME }] })

    test('a client due now with no thread: a proposal card, no folder, never a start', async ($, on) => {
      const w = world(on, { tools: 'start', feed: cedarAlone(), threads: [] })
      await tickOnce($, w)
      await w.clock.advance(60_000)
      const cards = sessionCalls(w)
      expect(cards.length).toBe(1)
      expect(cards[0]?.args).toMatchObject({ initiation: 'own_initiative', context: 'fresh', title: expect.stringContaining('Cedar Dental') })
      expect(String(cards[0]?.args.prompt)).toStartWith(`[mm-link ${CEDAR}]`)
      expect(String(cards[0]?.args.background).length).toBeGreaterThanOrEqual(80)
      expect(cards[0]?.args.cwd).toBeUndefined()
      // and no second one on the next ticks
      for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
      expect(sessionCalls(w).length).toBe(1)
    })

    test('a client never pinned whose reply package is ready gets its card however far off the reply is due; it is still not pinned', async ($, on) => {
      const w = world(on, { tools: 'start', feed: farPackage(), threads: [] })
      await tickOnce($, w)
      await w.clock.advance(60_000)
      expect(sessionCalls(w).map(c => String(c.args.prompt))).toEqual([expect.stringContaining(`[mm-link ${ACME}]`)])
    })

    test('a client whose mail has no package yet: no card for 2 hours from the message, so its thread opens with the reply ready; then its card', LONG, async ($, on) => {
      const message = { message_id_key: 'bolt-1', received_at: new Date(NOW - 30 * 60_000).toISOString(), reply_due_at: new Date(NOW + 20 * HOUR).toISOString(), sender: 'client@example.com', subject: 'Question', snippet: 'hello', project_id: BOLT, project_name: 'Bolt Staffing (Sam)', reply_status: 'unanswered', project_owner_email: ME }
      const w = world(on, { tools: 'start', feed: feed({ drafts: [], tickets: {}, mail: [message] }), threads: [] })
      await tickOnce($, w)
      for (let i = 0; i < 60; i++) await w.clock.advance(60_000)
      expect(starts(w)).toEqual([])
      for (let i = 0; i < 40; i++) await w.clock.advance(60_000)
      expect(sessionCalls(w).map(c => String(c.args.prompt))).toEqual([expect.stringContaining(`[mm-link ${BOLT}]`)])
    })

    test('a thread outside the client folder holds none: a card opens where the thread that holds it runs', async ($, on) => {
      on('session.root', () => ({ value: '/somewhere/worktree' }))
      const w = world(on, { tools: 'start', feed: cedarAlone(), threads: [], store: { 'mm.folder': { dir: '/Users/someone/Clients' } } })
      await tickOnce($, w)
      for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
      expect(starts(w)).toEqual([])
    })

    test('the thread that holds it withdraws the card once the client has a thread', async ($, on) => {
      const w = world(on, { tools: 'start', feed: cedarAlone(), threads: [] })
      await tickOnce($, w)
      await w.clock.advance(60_000)
      expect(sessionCalls(w).length).toBe(1)
      const [chip] = w.stored['mm.chips'] as Array<{ taskId: string }>
      w.stored['mm.links'] = { [CEDAR]: 'local_new' }
      await w.clock.advance(15_000)
      expect(w.calls.filter(c => c.tool === 'dismiss_task').map(c => c.args.task_id)).toEqual([chip?.taskId])
      for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
      expect(sessionCalls(w).length).toBe(1)
    })
  })

  describe('H9 (Rob: "this is only impacting what\'s pinning for S9. What\'s pinning for me is correct right now")', () => {
    const H9 = 'has9@massmarket.ai'
    const teammateLate = { ticket_id: 't9', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Build', due_at: new Date(NOW - 3 * HOUR).toISOString(), due_source: 'commitment', assignee_email: 'asif@example.com' }

    test('a teammate\'s late ticket lists nothing for him, and the pin 0.7.33 put on its thread comes off', async ($, on) => {
      const w = world(on, {
        feed: { member: H9, role: 'pm', drafts: [], mail: [], tickets: { overdue: [teammateLate] }, threads: [] } as Feed,
        threads: [thread('local_c', '🔴 Cedar Dental · check on Asif · task 3h late', 5, { pinned: true })],
        store: { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: { projectId: CEDAR, client: 'Cedar Dental', byUs: true } } },
      })
      await tickOnce($, w)
      const ui = await pane($)
      expect((await lines(ui)).some(l => l.includes('Cedar Dental'))).toBe(false)
      await ui.unmount()
      expect(w.threads.get('local_c')?.pinned).toBe(false)
    })

    test('his own work pins him as it pins anyone', async ($, on) => {
      const mine = { ...teammateLate, assignee_email: H9 }
      const w = world(on, { feed: { member: H9, role: 'pm', drafts: [], mail: [], tickets: { overdue: [mine] }, threads: [] } as Feed, threads: [thread('local_c', 'Cedar', 5)], store: { 'mm.links': { [CEDAR]: 'local_c' } } })
      await tickOnce($, w)
      const ui = await pane($)
      expect((await lines(ui)).some(l => l.includes('Cedar Dental · task'))).toBe(true)
      await ui.unmount()
    })
  })
})

describe('0.7.35 (measured 11-07: 73 of 97 pin records were threads of the profile Rob left on 11-05, and NextProjectX, due Monday, read neither away nor missing)', () => {
  const recOf = (w: { stored: Record<string, unknown> }, pid: string) => (w.stored['mm.last'] as { recs: Record<string, Record<string, unknown>> }).recs[pid]
  /** Forty-five pin records of threads in profile A: they spend the sync's record files before Cedar's link is reached. */
  const farPins = Object.fromEntries(Array.from({ length: 45 }, (_, n) => [`local_p${n}`, ourPin(`${String(n).padStart(8, '0')}-0000-4000-8000-0000000007a1`, `Client ${n}`)]))
  const farFiles = Object.assign({}, ...Array.from({ length: 45 }, (_, n) => profileRec(PROFILE_A, `local_p${n}`))) as Record<string, { text: string; mtimeMs: number }>
  /** Cedar, due now, linked to its thread in profile A; this thread in profile B. */
  const inB = (on: On, f: Feed, store: Record<string, unknown> = {}, files: Record<string, { text: string; mtimeMs: number }> = {}) =>
    world(on, {
      tools: 'start',
      feed: f,
      threads: [thread('local_other', 'Unrelated notes', 100)],
      files: { ...profileRec(PROFILE_B, SELF), ...profileRec(PROFILE_A, 'local_far'), ...files },
      store: { 'mm.profile': { dir: PROFILE_B, since: NOW - DAYS, from: PROFILE_A }, 'mm.switchPins': { since: NOW - DAYS, at: NOW - DAYS }, 'mm.links': { [CEDAR]: 'local_far' }, 'mm.titles': { local_far: 'Cedar build' }, ...store },
    })

  test('the sync\'s record files spent on other threads: the client still reads as away, is counted as missing, keeps its link, and the app is not asked about it', async ($, on) => {
    const w = inB(on, cedarAlone(), { 'mm.pins': farPins }, farFiles)
    await mm($, '')
    expect(recOf(w, CEDAR)).toMatchObject({ state: 'start', away: true })
    expect((w.stored['mm.last'] as { rowPins: Record<string, unknown> }).rowPins[CEDAR]).toEqual({ pinned: false, why: 'no_thread' })
    expect(w.calls.filter(c => c.tool === 'get_session' && c.args.session_id === 'local_far')).toEqual([])
    expect((w.stored['mm.links'] as Record<string, string>)[CEDAR]).toBe('local_far')
    expect((await kickoffsOf($)).map(k => k.arguments.prompt)).toEqual([expect.stringContaining(`[mm-link ${CEDAR}]`)])
    const ui = await pane($)
    expect(await lines(ui)).toContain('1 thread not started')
    expect((await buttons(ui)).filter(b => b[0] === 'mm-start-all').map(b => b[1])).toEqual(['Start missing threads'])
    await ui.unmount()
  })

  test('a client that pins, its thread in the other profile: its card, carrying which thread that was, no folder, and never a start', async ($, on) => {
    const w = inB(on, cedarAlone())
    await tickOnce($, w)
    await w.clock.advance(60_000)
    const cards = sessionCalls(w)
    expect(cards.length).toBe(1)
    expect(cards[0]?.args).toMatchObject({ initiation: 'own_initiative', context: 'fresh', title: expect.stringContaining('Cedar Dental') })
    expect(String(cards[0]?.args.prompt)).toStartWith(`[mm-link ${CEDAR}]`)
    expect(String(cards[0]?.args.prompt)).toContain('This client\'s last thread is in another Claude profile: thread local_far ("Cedar build")')
    expect(cards[0]?.args.cwd).toBeUndefined()
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(sessionCalls(w).length).toBe(1)
  })

  test('a client that does not pin, its thread in the other profile: its row keeps its Start and no card comes, ready package or not (0.7.13)', async ($, on) => {
    const far = feed({ mail: [], tickets: {}, drafts: [{ package_id: PKG, project_id: CEDAR, project_name: 'Cedar Dental', status: 'prepared', covers_through: ago(3), due_at: new Date(NOW + 60 * HOUR).toISOString(), drafts_ready: 2, project_owner_email: ME }] })
    const w = inB(on, far)
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(recOf(w, CEDAR)).toMatchObject({ state: 'start', away: true })
    expect(sessionCalls(w)).toEqual([])
  })

  test('the card is withdrawn once the client has its own thread here', async ($, on) => {
    const w = inB(on, cedarAlone())
    await tickOnce($, w)
    await w.clock.advance(60_000)
    expect(sessionCalls(w).length).toBe(1)
    const [chip] = w.stored['mm.chips'] as Array<{ taskId: string }>
    w.threads.set('local_here', thread('local_here', 'Cedar, new', 1))
    w.stored['mm.links'] = { [CEDAR]: 'local_here' }
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.calls.filter(c => c.tool === 'dismiss_task').map(c => c.args.task_id)).toEqual([chip?.taskId])
    expect(sessionCalls(w).length).toBe(1)
  })
})

describe('0.7.38 (Rob 2026-11-07: "Any Reply package should appear above the team member tracking. And if one arrives, the side panel should scroll up to the top to see it automatically")', () => {
  const keysOf = async (ui: Parameters<typeof buttons>[0]) => (await buttons(ui)).map(b => b[0])

  test('in a client\'s thread: its reply package first, then Needs you now and its rows, then Team now', async ($, on) => {
    const w = world(on, { store: { 'mm.links': { [ACME]: SELF } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    const ui = await pane($)
    expect((await lines(ui)).slice(0, 3)).toEqual(['This thread: Acme Roofing', CARD_NOT_DRAWN, 'Needs you now (3)'])
    const keys = await keysOf(ui)
    expect(keys.indexOf('mm-teamnow-toggle')).toBeGreaterThan(keys.indexOf(`drafts:${BOLT}`))
    expect(keys.indexOf('mm-teamnow-toggle')).toBeGreaterThan(keys.indexOf('mm-needs-toggle'))
    await ui.unmount()
  })

  test('a package that arrives is one the last list did not have; never on a thread\'s first list; a teammate\'s or one in prep is none', () => {
    const ready = (packageId: string, over: Record<string, unknown> = {}) => ({ kind: 'ready' as const, packageId, theirs: undefined, ...over })
    expect(readyPackages([ready('b'), ready('a'), ready('a'), { kind: 'ok', packageId: 'c', theirs: undefined }])).toEqual(['a', 'b', 'c'])
    expect(readyPackages([ready('a', { theirs: true }), { kind: 'reply', packageId: 'd', theirs: undefined }, ready('')])).toEqual([])
    expect(packageArrived(null, ['a'])).toBe(false)
    expect(packageArrived([], ['a'])).toBe(true)
    expect(packageArrived(['a'], ['a'])).toBe(false)
    expect(packageArrived(['a', 'b'], ['a'])).toBe(false)
    expect(packageArrived(['a'], ['a', 'b'])).toBe(true)
  })

  test('a sync whose list brings a package does not fail where the surface has no window to move', async ($, on) => {
    const w = world(on, { feed: feed({ drafts: [] }) })
    await tickOnce($, w)
    const ui = await pane($)
    w.setFeed(feed())
    await mm($, '')
    expect((await lines(ui))).toContain('Needs you now (3)')
    await ui.unmount()
  })
})

// ======================================================================== 0.7.41: a sent package leaves the pane, and the chat says one waits
// Rob, 2026-11-09, in a client's thread: "I sent the reply package, but it's still showing up in my side panel like I didn't send
// it... Probably should also make it disappear from the side panel once it's sent, whether you send it in the side panel or from
// the chat." And: "it's important that the chat tells them a reply package is waiting in the side panel when there is one."
describe('(0.7.41) a sent package leaves the side pane, and the chat says while one waits', () => {
  const WAITING = 'A reply package for Acme Roofing is waiting in the side pane. Open it there to read and sign it.'
  const NOTICE = JSON.stringify({ type: 'system', content: [{ type: 'text', text: WAITING }] })
  const partText = async ($: Engine) => {
    const view = await $.ui.mount({ plugin: 'mm-bridge', surface: 'desktop', component: 'Pane', requestId: 'mm-view', props: { ...PANE, title: 'Acme Roofing' } })
    const text = (await view.find({ type: 'Markdown' }))?.text ?? ''
    await view.unmount()
    return text
  }
  const bandTexts = async ($: Engine) => {
    const band = await bandOf($)
    const out = { texts: await lines(band), buttons: await buttons(band) }
    await band.unmount()
    return out
  }
  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ result?: unknown; deny?: string; isError?: boolean }>
  const SEND = `cd /Users/me/Projects/massmarket-ops-control-tower && python3 skills/client-reply-prep/scripts/send_package.py --package ${PKG} --package-sha256 ${'f'.repeat(64)} 2>&1 | tail -20`

  test('a package waiting in this thread\'s pane: one line in the chat that the model never reads, and the band says it while it waits', async ($, on) => {
    const w = world(on, { store: { 'mm.links': { [ACME]: SELF } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    // the note to the model, as before, and the notice for the person: a system row, which never reaches the model
    expect(w.appended.length).toBe(1)
    expect(w.appended[0]).toContain('[Massmarket bridge, no reply needed] Acme Roofing Pat: ')
    expect(w.notices).toEqual([NOTICE])
    expect(w.stored['mm.told']).toEqual({ [SELF]: PKG })
    // the band: the waiting line first, with its own button where Drafts was
    const band = await bandTexts($)
    expect(band.texts[0]).toBe(WAITING)
    expect(band.buttons).toEqual([['mm-open-waiting', 'Open the side pane'], ['mm-start-missing', 'Start missing threads (2)']])
    const b = await bandOf($)
    const opened = w.opened.length
    await b.press({ key: 'mm-open-waiting' })
    expect(w.opened.length).toBe(opened + 1)
    expect(w.opened.at(-1)).toEqual({ id: 'mm-queue', title: 'Acme Roofing' })
    await b.unmount()
    // later syncs of the same package say nothing more in the chat
    for (let i = 0; i < 12; i++) await w.clock.advance(60_000)
    expect(w.notices).toEqual([NOTICE])
  })

  test('the package sent from the chat: the next sync takes its page, its card and the band\'s line away (until 0.7.41 they stayed)', async ($, on) => {
    const w = world(on, { store: { 'mm.links': { [ACME]: SELF } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    expect(await partText($)).toBe('## Acme Roofing\n\n1. What the client sent')
    expect(w.stored['mm.noted']).toMatchObject({ [SELF]: `pkg:${PKG}:${ago(3)}` })
    // OW records the package sent: the feed lists it no more
    w.setFeed(feed({ drafts: [] }))
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(await partText($)).toBe('')
    const ui = await pane($)
    expect(await lines(ui)).not.toContain('This thread: Acme Roofing')
    await ui.unmount()
    const band = await bandTexts($)
    expect(band.texts).not.toContain(WAITING)
    expect(band.buttons.map(x => x[0])).not.toContain('mm-open-waiting')
    // the note to the model comes again only if the client is listed again
    expect((w.stored['mm.noted'] as Record<string, string>)[SELF]).toBeUndefined()
    // and a second sync with nothing listed writes nothing more
    const appended = w.appended.length
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.appended.length).toBe(appended)
    expect(w.notices).toEqual([NOTICE])
  })

  test('a run of send_package.py in the thread reads the feed again a second later, as the reply-draft routes do', async ($, on) => {
    const w = world(on, { store: { 'mm.links': { [ACME]: SELF } } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    const before = closeouts(w)
    w.setFeed(feed({ drafts: [] }))
    await bash($, SEND)
    expect(w.shell).toEqual([SEND])
    await w.clock.advance(1_000)
    expect(closeouts(w)).toBe(before + 1)
    expect(await partText($)).toBe('')
    // a dry run sends nothing and reads nothing again
    await bash($, `${SEND} --dry-run`)
    await w.clock.advance(1_000)
    expect(closeouts(w)).toBe(before + 1)
  })

  test('⛔ a thread that linked itself gets no line in the chat, as it gets no note', async ($, on) => {
    const w = world(on, { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), self: thread(SELF, 'My roof thread', 1), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } } })
    await mm($, '')
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    for (let i = 0; i < 6; i++) await w.clock.advance(60_000)
    expect(w.appended).toEqual([])
    expect(w.notices).toEqual([])
  })
})

// ======================================================================== 0.7.44 (Rob, 2026-11-10)

describe('0.7.44 (Rob, 11-10: "we always want it to be parent threads"): client threads are top-level threads; switch pins follow his own', () => {
  /** A thread another thread started, as the app answers it: its parent named (by id and on the list) and not moved to top level. */
  const child = (sid: string, title: string, hoursAgo: number, parent = 'local_par', over: Record<string, unknown> = {}) =>
    ({ ...thread(sid, title, hoursAgo), parentSessionId: parent, startedBy: parent, detached: false, ...over }) as Thread
  /** The housekeeping notes the bridge sent, as (thread, words). */
  const notes = (w: { acted: () => Call[] }) => sends(w).filter(c => c.args.message === DETACH_SELF_NOTE).map(c => String(c.args.session_id))
  const logOf = (w: { written: Array<{ path: string; text: string }> }) => w.written.filter(f => f.path.endsWith('bridge-notices.log')).map(f => f.text).join('')
  /** The prompt a new thread opens with: its marker first, then the top-level step once, as its second paragraph. */
  const expectStepped = (prompt: unknown, name: string) => {
    const text = String(prompt)
    expect(/^\[mm-link [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\] /.test(text), name).toBe(true)
    expect(text.split('\n\n')[1], name).toBe(TOP_LEVEL_STEP)
    expect(text.split(TOP_LEVEL_STEP).length - 1, name).toBe(1)
  }
  /** What the app's session tools get from a started thread: the background, then its task. */
  const opened = (args: { prompt: string; background: string }) => `Background (from the session that started this one):\n${args.background}\n\nTask:\n${args.prompt}`
  /** The item the feed gives for a client now: what its signature is made from. */
  const sigOf = (f: Feed, pid: string): string => {
    const it = buildLists(f, NOW).queue.find(i => i.projectId === pid)
    if (!it) throw new Error(`no item for ${pid}`)
    return signatureOf(it)
  }
  const boltOnly = () => feed({ drafts: [], tickets: {} })
  const acmeOnly = () => feed({ mail: [], tickets: {}, threads: [] })

  // ---------------------------------------------------------------- 1. every new client thread detaches itself

  test('kickoffs, a chip and a Start card: every new thread\'s prompt opens with its marker, then the step once, as its second paragraph', async ($, on) => {
    world(on, { tools: 'start' })
    await mm($, '')
    const kicks = await kickoffsOf($)
    expect(kicks.length).toBe(3)
    for (const k of kicks) expectStepped(k.arguments.prompt, `kickoffs ${k.client}`)
  })

  test('a chip (spawn_task) carries the step as its second paragraph', async ($, on) => {
    const w = world(on)
    await mm($, 'start Acme Roofing')
    expect(w.minted().length).toBe(1)
    expectStepped(w.minted()[0]?.args.prompt, 'chip')
    expect(w.minted()[0]?.args.prompt).toBe(stepped(ACME_KICKOFF))
  })

  test('a Start card (start_session own_initiative) carries the step as its second paragraph', async ($, on) => {
    const w = world(on, { tools: 'start', feed: cedarAlone() })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(proposals(w).length).toBe(1)
    expectStepped(proposals(w)[0]?.args.prompt, 'card')
    expect(proposals(w)[0]?.args.prompt).toBe(stepped(CEDAR_KICKOFF))
  })

  // ⛔ (0.7.44) Adding the step moves no signature: every record is made from the kickoff without it, as in 0.7.43, so no
  // thread on any computer is updated again by this release. CEDAR_KICKOFF is the literal 0.7.43 sent and recorded.
  test('⛔ signatures do not move: a kickoff\'s record, a chip\'s, and what the new thread then has are the kickoff\'s, as in 0.7.43; the step is in none of them', async ($, on) => {
    const w = world(on, { tools: 'start' })
    await mm($, '')
    const k = (await kickoffsOf($, 'cedar'))[0]?.arguments as { prompt: string; background: string }
    const handed = (w.stored['mm.kickoffs'] as Array<{ projectId: string; signature: string; prompt: string }>).find(r => r.projectId === CEDAR)
    expect(handed).toMatchObject({ signature: `${CEDAR_KICKOFF}\n\n`, prompt: stepped(CEDAR_KICKOFF) })
    expect(handed?.signature).toBe(sigOf(feed(), CEDAR))
    expect(handed?.signature).not.toContain(TOP_LEVEL_STEP)
    // the thread the model starts opens with that prompt: it is linked by it, and has what the kickoff carried
    await $.prompt.submit({ text: opened(k), wait: false, origin: { kind: 'sdk' } } as never)
    expect(w.stored['mm.links']).toMatchObject({ [CEDAR]: SELF })
    expect((w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[CEDAR]).toMatchObject({ sid: SELF, sig: `${CEDAR_KICKOFF}\n\n` })
  })

  test('⛔ a thread that opens with a stepped kickoff no record here names (another computer handed it out): the same link and the same signature as the plain kickoff', async ($, on) => {
    const w = world(on)
    await mm($, '')
    await $.prompt.submit({ text: stepped(ACME_KICKOFF), wait: false, origin: { kind: 'composer' } })
    expect(w.stored['mm.links']).toEqual({ [ACME]: SELF })
    const sent = (w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[ACME]
    expect(sent?.sid).toBe(SELF)
    expect(sent?.sig).toBe(sigOf(feed(), ACME))
    expect(sent?.sig).toBe(`${inOldWords(ACME_KICKOFF)}\n${ago(3)}\n`)
  })

  // ---------------------------------------------------------------- 2. an update into a child carries the step

  /** Bolt's thread, linked; asked to detach an hour ago, so the housekeeping note leaves it be and the update alone is seen. */
  const boltThread = (on: On, t: Thread, more: Record<string, unknown> = {}) =>
    world(on, { feed: boltOnly(), threads: [t], store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.detachAsked': { local_b: NOW - HOUR } }, ...more })
  const boltUpdate = BOLT_AUTO_UPDATE('local_b').args.message
  const runToUpdate = async ($: Engine, w: { clock: { advance: (ms: number) => Promise<void> } }) => {
    await tickOnce($, w)
    for (let i = 0; i < 11; i++) await w.clock.advance(60_000)
    await w.clock.advance(3_000)
  }

  test('an update by itself into a thread the app shows as a child (a parent, detached false): the step is its second paragraph; what the thread has is the item\'s signature, as for any thread; the ask is on record', LONG, async ($, on) => {
    const w = boltThread(on, child('local_b', 'Staffing plan', 20))
    await runToUpdate($, w)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_b', stepped(boltUpdate)]])
    expect(String(sends(w)[0]?.args.message).startsWith(`[mm-link ${BOLT}] `)).toBe(true)
    expect(String(sends(w)[0]?.args.message).split('\n\n')[1]).toBe(TOP_LEVEL_STEP)
    expect((w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[BOLT]).toMatchObject({ sid: 'local_b', sig: sigOf(boltOnly(), BOLT) })
    expect((w.stored['mm.detachAsked'] as Record<string, number>).local_b).toBeGreaterThan(NOW)
    // and no housekeeping note beside it
    expect(notes(w)).toEqual([])
  })

  for (const [what, t] of [
    ['detached (moved to top level)', child('local_b', 'Staffing plan', 20, 'local_par', { detached: true })],
    ['no parent', thread('local_b', 'Staffing plan', 20)],
  ] as Array<[string, Thread]>) {
    test(`an update by itself into a thread with ${what}: no step; the same signature on record`, LONG, async ($, on) => {
      const w = boltThread(on, t)
      await runToUpdate($, w)
      expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_b', boltUpdate]])
      expect((w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[BOLT]).toMatchObject({ sid: 'local_b', sig: sigOf(boltOnly(), BOLT) })
      expect((w.stored['mm.detachAsked'] as Record<string, number>).local_b).toBe(NOW - HOUR)
    })
  }

  const acmeUpdate = `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}`
  const pressWorld = (on: On, t: Thread, more: Record<string, unknown> = {}) =>
    world(on, { feed: acmeOnly(), threads: [t], store: { 'mm.links': { [ACME]: 'local_a' } }, ...more })

  test('the person\'s Update into a child: the step after its first paragraph; what the thread has is the item\'s signature; the ask is on record', async ($, on) => {
    const w = pressWorld(on, child('local_a', 'Roof quote', 30))
    expect(await mm($, 'update acme roofing')).toBe(`Sent to Acme Roofing's thread: open "${ACME_SHOWN}" under Pinned.`)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', stepped(acmeUpdate)]])
    expect(String(sends(w)[0]?.args.message).split('\n\n')).toEqual([acmeUpdate, TOP_LEVEL_STEP])
    expect((w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[ACME]).toMatchObject({ sid: 'local_a', sig: sigOf(acmeOnly(), ACME) })
    expect((w.stored['mm.detachAsked'] as Record<string, number>).local_a).toBe(NOW)
  })

  for (const [what, t, more] of [
    ['detached', child('local_a', 'Roof quote', 30, 'local_par', { detached: true }), {}],
    ['with no parent', thread('local_a', 'Roof quote', 30), {}],
    ['the app not answering for it by id', child('local_a', 'Roof quote', 30), { lookupFails: 'internal error' }],
  ] as Array<[string, Thread, Record<string, unknown>]>) {
    test(`the person's Update into a thread ${what}: no step, the same signature`, async ($, on) => {
      const w = pressWorld(on, t, more)
      await mm($, 'update acme roofing')
      expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_a', acmeUpdate]])
      expect((w.stored['mm.sent'] as Record<string, { sid: string; sig: string }>)[ACME]).toMatchObject({ sid: 'local_a', sig: sigOf(acmeOnly(), ACME) })
      expect(w.stored['mm.detachAsked']).toBeUndefined()
    })
  }

  // ---------------------------------------------------------------- 6. a client thread the bridge links or pins is made top level

  test('(6) a child client thread the sync pins gets the note once: through the app\'s send, logged; a second and third sync send nothing; nothing else changes', LONG, async ($, on) => {
    const w = world(on, { feed: boltOnly(), threads: [child('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    expect(w.threads.get('local_b')?.pinned).toBe(true)
    expect(notes(w)).toEqual(['local_b'])
    expect(sends(w)).toHaveLength(1)
    expect((w.stored['mm.detachAsked'] as Record<string, number>).local_b).toBeGreaterThanOrEqual(NOW)
    expect(logOf(w)).toContain('top level: asked local_b (Bolt Staffing) to detach itself (pinned)')
    // ⛔ nothing else of the thread's: its link, pin, name and what it has stay as the sync left them
    expect(w.stored['mm.links']).toEqual({ [BOLT]: 'local_b' })
    expect(w.stored['mm.sent'] ?? {}).toEqual({})
    expect(threadWrites(w).filter(x => !x.startsWith('send_message'))).toEqual([`set_session_title | local_b | ${BOLT_TITLE}`, 'set_pinned | local_b | true'])
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual(['local_b'])
  })

  test('(6) a thread at top level gets nothing: detached, or with no parent', LONG, async ($, on) => {
    const w = world(on, {
      feed: feed({ tickets: {} }),
      threads: [child('local_b', 'Staffing plan', 20, 'local_par', { detached: true }), thread('local_a', 'Roof quote', 30)],
      store: { 'mm.links': { [BOLT]: 'local_b', [ACME]: 'local_a' } },
    })
    await tickOnce($, w)
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual([])
    expect(w.stored['mm.detachAsked']).toBeUndefined()
  })

  test('(6) no answer from the app for the thread by id: nothing is sent and nothing is on record', LONG, async ($, on) => {
    const w = world(on, { feed: boltOnly(), threads: [child('local_b', 'Staffing plan', 20)], store: { 'mm.links': { [BOLT]: 'local_b' } }, lookupFails: 'internal error' })
    await tickOnce($, w)
    await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual([])
    expect(w.stored['mm.detachAsked']).toBeUndefined()
  })

  /** Acme's thread already has what waits for it: no update goes by itself, so a note is the only message it can get. */
  const acmeHas = () => ({ [ACME]: { sid: 'local_a', sig: sigOf(acmeOnly(), ACME), at: NOW - HOUR } })

  test('(6) a thread in use now (active in the last 10 minutes) waits; it gets the note once it is quiet', LONG, async ($, on) => {
    const w = world(on, { feed: acmeOnly(), threads: [child('local_a', 'Roof quote', 0)], store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.sent': acmeHas() } })
    await tickOnce($, w)
    expect(notes(w)).toEqual([])
    for (let i = 0; i < 3; i++) await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual(['local_a'])
  })

  test('(6) an update by itself in flight for the client carries the step: no note beside it, then or after', LONG, async ($, on) => {
    // used half a minute ago: the note waits for it to be quiet; by then the update by itself (10 minutes after the mail was
    // first seen) is claimed, and it carries the step
    const w = world(on, { feed: boltOnly(), threads: [child('local_b', 'Staffing plan', 0.01)], store: { 'mm.links': { [BOLT]: 'local_b' } } })
    await tickOnce($, w)
    for (let i = 0; i < 25; i++) await w.clock.advance(60_000)
    await w.clock.advance(3_000)
    expect(sends(w).map(c => [c.args.session_id, c.args.message])).toEqual([['local_b', stepped(boltUpdate)]])
    expect(notes(w)).toEqual([])
  })

  test('(6) an update claimed by another thread for the client: no note while the claim holds', LONG, async ($, on) => {
    const w = world(on, {
      feed: acmeOnly(),
      threads: [child('local_a', 'Roof quote', 30)],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.sent': acmeHas(), 'mm.updating': { [`${ACME}\n0badc0de`]: { owner: 'local_elsewhere', until: NOW + 7 * 60_000, from: NOW } } },
    })
    await tickOnce($, w)
    expect(notes(w)).toEqual([])
    for (let i = 0; i < 2; i++) await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual(['local_a'])
  })

  test('(6) at most 3 notes a sync: five child client threads, three now and two at the next sync', LONG, async ($, on) => {
    const pidOf = (i: number) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`
    const w = world(on, {
      feed: feed({ drafts: [], tickets: {}, mail: Array.from({ length: 5 }, (_, i) => mailFor(pidOf(i), `Client ${i}`, 1 + i)) }),
      threads: Array.from({ length: 5 }, (_, i) => child(`local_k${i}`, `Client ${i} work`, 20)),
      store: { 'mm.links': Object.fromEntries(Array.from({ length: 5 }, (_, i) => [pidOf(i), `local_k${i}`])) },
    })
    await tickOnce($, w)
    expect(notes(w)).toHaveLength(3)
    await w.clock.advance(6 * 60_000)
    expect(new Set(notes(w))).toEqual(new Set(Array.from({ length: 5 }, (_, i) => `local_k${i}`)))
    expect(notes(w)).toHaveLength(5)
  })

  test('(6) asked again only after 7 days, and only while the app still shows it a child', LONG, async ($, on) => {
    const w = world(on, { feed: acmeOnly(), threads: [child('local_a', 'Roof quote', 30)], store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.detachAsked': { local_a: NOW - 6 * DAYS } } })
    await tickOnce($, w)
    expect(notes(w)).toEqual([])
    w.stored['mm.detachAsked'] = { local_a: NOW - 7 * DAYS }
    await w.clock.advance(6 * 60_000)
    expect(notes(w)).toEqual(['local_a'])
  })

  test('(6) ⛔ the note in the thread it reaches: an app message (peer), so no link, no record of what it has, and not the person\'s first prompt after a switch', async ($, on) => {
    const w = world(on, { tools: 'start', feed: acmeOnly(), store: { 'mm.profile': { dir: '/x/a', since: NOW - DAYS, from: '/x/b' } } })
    await mm($, '')
    const links = JSON.stringify(w.stored['mm.links'] ?? {})
    await $.prompt.submit({ text: DETACH_SELF_NOTE, wait: false, origin: { kind: 'peer' } } as never)
    expect(w.prompts.at(-1)?.text).toBe(DETACH_SELF_NOTE)
    expect(JSON.stringify(w.stored['mm.links'] ?? {})).toBe(links)
    expect(w.stored['mm.sent']).toBeUndefined()
    // the person's own first prompt still carries the switch routine's line: the note did not count as theirs
    await $.prompt.submit({ text: 'morning', wait: false, origin: { kind: 'composer' } })
    expect(w.prompts.at(-1)?.text).toContain('"Automatic switch routine"')
  })

  // ---------------------------------------------------------------- 7. children under a pinned client thread

  test('(7) under a pinned client thread: another client\'s work, internal work and finished work leave it; its own client\'s and unfinished work stay; never an archived or running one', LONG, async ($, on) => {
    const P = 'local_b'
    const kid = (sid: string, hoursAgo = 20, over: Record<string, unknown> = {}) => child(sid, `${sid} work`, hoursAgo, P, over)
    const w = world(on, {
      feed: feed({ tickets: {} }),
      threads: [
        thread(P, 'Staffing plan', 20),
        kid('local_k1'), // linked to Acme: another client's thread (and a child itself)
        kid('local_k2'), // on Acme by its work (mm.current)
        kid('local_k3'), // on the internal-ops project
        kid('local_k4'), // on Bolt, P's own client
        kid('local_k5'), // no link, no project, finished
        kid('local_k6'), // no link, no project, not finished
        kid('local_k7', 20, { isArchived: true }), // on Acme, but archived
        kid('local_k8', 0), // on Acme, but in use now
      ],
      files: {
        ...profileRec(PROFILE_B, SELF),
        ...profileRec(PROFILE_B, 'local_k5', { postTurnSummary: { status_category: 'completed', status_detail: 'Merged the fix; nothing waiting on you.' } }),
        ...profileRec(PROFILE_B, 'local_k6', { postTurnSummary: { status_category: 'blocked', status_detail: 'Waiting on the client.' } }),
      },
      store: {
        'mm.links': { [BOLT]: P, [ACME]: 'local_k1' },
        'mm.current': {
          local_k2: { pid: ACME, how: 'skill', at: NOW - HOUR },
          local_k3: { pid: INTERNAL, how: 'skill', at: NOW - HOUR },
          local_k4: { pid: BOLT, how: 'skill', at: NOW - HOUR },
          local_k7: { pid: ACME, how: 'skill', at: NOW - HOUR },
          local_k8: { pid: ACME, how: 'skill', at: NOW - HOUR },
        },
      },
    })
    await tickOnce($, w)
    expect(w.threads.get(P)?.pinned).toBe(true)
    expect(notes(w)).toHaveLength(3)
    await w.clock.advance(6 * 60_000)
    expect(new Set(notes(w))).toEqual(new Set(['local_k1', 'local_k2', 'local_k3', 'local_k5']))
    expect(notes(w)).toHaveLength(4)
    const log = logOf(w)
    expect(log).toContain(`top level: asked local_k2 to leave pinned ${P} (Bolt Staffing): on another client's project`)
    expect(log).toContain(`top level: asked local_k3 to leave pinned ${P} (Bolt Staffing): on the internal-ops project`)
    expect(log).toContain(`top level: asked local_k5 to leave pinned ${P} (Bolt Staffing): finished`)
    // the thread linked to Acme is a client thread the bridge links: asked as one (item 6), once
    expect(log).toMatch(/top level: asked local_k1 \(Acme Roofing\) to detach itself \((pinned|linked)\)/)
    // ⛔ the pinned thread itself is at top level: nothing for it
    expect(notes(w)).not.toContain(P)
  })

  test('(7) children of a thread that is not pinned stay where they are', LONG, async ($, on) => {
    const w = world(on, {
      feed: feed({ drafts: [], mail: [], tickets: {} }),
      threads: [thread('local_b', 'Staffing plan', 20), child('local_k2', 'Acme work', 20, 'local_b')],
      store: { 'mm.links': { [BOLT]: 'local_b' }, 'mm.current': { local_k2: { pid: ACME, how: 'skill', at: NOW - HOUR } } },
    })
    await tickOnce($, w)
    await w.clock.advance(6 * 60_000)
    expect(w.threads.get('local_b')?.pinned).toBe(false)
    expect(notes(w)).toEqual([])
  })

  // ---------------------------------------------------------------- 3. pins after a switch

  describe('3. a switch: his own pin stays where he pinned the client\'s thread in the profile he left and did not finish it', () => {
    const SINCE = NOW - 10 * 60_000
    const switched = { dir: PROFILE_B, since: SINCE, from: PROFILE_A }
    /** The founder's feed: Bolt listed by an undated ticket alone (no clock), Cedar's task due in 5 hours (a clock). */
    const boltAndCedar = (): Feed => {
      const base = feed()
      const cedar = { ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: new Date(NOW + 5 * HOUR).toISOString(), due_source: 'commitment', assignee_email: ME }
      return { ...base, role: 'founder', mail: [], drafts: [], threads: [], tickets: { due_today: [cedar], undated: [{ ticket_id: 'tb', project_id: BOLT, project_name: 'Bolt Staffing (Sam)', title: 'Undated 1', due_at: null, due_source: null, assignee_email: ME }] } } as Feed
    }
    const hisPin = (projectId: string, client: string) => ({ projectId, client, byUs: false })
    /** The client's thread in A, as its record there says: pinned by him, and unfinished unless said otherwise. */
    const inA = (sid: string, over: Record<string, unknown> = {}) => profileRec(PROFILE_A, sid, { isStarred: true, postTurnSummary: { status_category: 'blocked', status_detail: 'Waiting on the client.' }, ...over })
    const inBNow = (on: On, threads: Thread[], store: Record<string, unknown>, files: Record<string, { text: string; mtimeMs: number }> = {}) =>
      world(on, {
        feed: boltAndCedar(),
        threads: [thread('local_other', 'Unrelated notes', 100), ...threads],
        files: { ...profileRec(PROFILE_B, SELF), ...files },
        store: { 'mm.profile': switched, ...store },
      })
    const pinsOf = (w: { stored: Record<string, unknown> }) => (w.stored['mm.pins'] ?? {}) as Record<string, Record<string, unknown>>
    const CARRIED = 'profile switch: Bolt Staffing (22222222-2222-2222-2222-222222222222) stays pinned: you pinned its thread local_ab in the profile you left and it is not finished'

    test('(a) a client with a clock: its thread stays pinned, the bridge\'s (unchanged)', async ($, on) => {
      const w = inBNow(on, [thread('local_c', 'Cedar work', 1, { pinned: true })], { 'mm.links': { [CEDAR]: 'local_c' }, 'mm.pins': { local_c: hisPin(CEDAR, 'Cedar Dental') } })
      await mm($, '')
      expect(w.threads.get('local_c')?.pinned).toBe(true)
      expect(pinsOf(w).local_c).toEqual({ projectId: CEDAR, client: 'Cedar Dental', byUs: true })
    })

    for (const [how, store] of [
      ['its link there (mm.profileLinks)', { 'mm.profileLinks': { [PROFILE_A]: { [BOLT]: 'local_ab' } } }],
      ['the pin record that names the client', { 'mm.pins': { local_ab: hisPin(BOLT, 'Bolt Staffing') } }],
    ] as Array<[string, Record<string, unknown>]>) {
      test(`(b) no clock, his thread in A (found by ${how}) pinned by him and unfinished: it stays pinned here, his record says so, his unpin goes, and it is logged`, async ($, on) => {
        const pins = { local_c1: hisPin(BOLT, 'Bolt Staffing'), ...((store['mm.pins'] as object) ?? {}) }
        const w = inBNow(on, [thread('local_c1', 'Bolt work', 1)], { ...store, 'mm.links': { [BOLT]: 'local_c1' }, 'mm.pins': pins, 'mm.unpinned': { local_c1: { at: NOW - 2 * HOUR, mail: 0, pkg: 0, task: 0 } } }, inA('local_ab'))
        await mm($, '')
        expect(w.threads.get('local_c1')?.pinned).toBe(true)
        expect(pinsOf(w).local_c1).toEqual({ projectId: BOLT, client: 'Bolt Staffing', byUs: false, carried: 'local_ab', at: NOW })
        expect((w.stored['mm.unpinned'] ?? {}) as Record<string, unknown>).toEqual({})
        expect(logOf(w)).toContain(CARRIED)
        // and on the syncs after: still his, still pinned
        for (let i = 0; i < 2; i++) {
          await w.clock.advance(6 * 60_000)
          await mm($, '')
        }
        expect(w.threads.get('local_c1')?.pinned).toBe(true)
        expect(pinsOf(w).local_c1).toMatchObject({ byUs: false, carried: 'local_ab' })
      })
    }

    test('(b) the same, his thread here already pinned: it stays so, with no call to the app', async ($, on) => {
      const w = inBNow(on, [thread('local_c1', 'Bolt work', 1, { pinned: true })], { 'mm.links': { [BOLT]: 'local_c1' }, 'mm.pins': { local_c1: hisPin(BOLT, 'Bolt Staffing') }, 'mm.profileLinks': { [PROFILE_A]: { [BOLT]: 'local_ab' } } }, inA('local_ab'))
      await mm($, '')
      expect(w.threads.get('local_c1')?.pinned).toBe(true)
      expect(w.writes().filter(c => c.startsWith('set_pinned | local_c1'))).toEqual([])
      expect(pinsOf(w).local_c1).toMatchObject({ byUs: false, carried: 'local_ab' })
    })

    for (const [what, store, files] of [
      ['(c) his old pin there was the bridge\'s', { 'mm.pins': { local_c1: hisPin(BOLT, 'Bolt Staffing'), local_ab: ourPin(BOLT, 'Bolt Staffing') } }, inA('local_ab')],
      ['(d) his thread there is finished', { 'mm.profileLinks': { [PROFILE_A]: { [BOLT]: 'local_ab' } } }, inA('local_ab', { postTurnSummary: { status_category: 'completed', status_detail: 'Sent the reply.' } })],
      ['(d) his thread there was not pinned by him', { 'mm.profileLinks': { [PROFILE_A]: { [BOLT]: 'local_ab' } } }, inA('local_ab', { isStarred: false })],
      ['(e) no thread of the client in the profile left', {}, {}],
    ] as Array<[string, Record<string, unknown>, Record<string, { text: string; mtimeMs: number }>]>) {
      test(`${what}: as before, the pin is the bridge's and comes off (no clock)`, async ($, on) => {
        const pins = { local_c1: hisPin(BOLT, 'Bolt Staffing'), ...((store['mm.pins'] as object) ?? {}) }
        const w = inBNow(on, [thread('local_c1', 'Bolt work', 1, { pinned: true })], { ...store, 'mm.links': { [BOLT]: 'local_c1' }, 'mm.pins': pins }, files)
        await mm($, '')
        expect(w.threads.get('local_c1')?.pinned).toBe(false)
        expect(pinsOf(w).local_c1?.carried).toBeUndefined()
        expect(logOf(w)).not.toContain('stays pinned')
      })
    }

    test('(f) his thread there cannot be read: as before (the pin comes off), and the log says it could not read it', async ($, on) => {
      const w = inBNow(on, [thread('local_c1', 'Bolt work', 1, { pinned: true })], { 'mm.links': { [BOLT]: 'local_c1' }, 'mm.pins': { local_c1: hisPin(BOLT, 'Bolt Staffing') }, 'mm.profileLinks': { [PROFILE_A]: { [BOLT]: 'local_gone' } } })
      await mm($, '')
      expect(w.threads.get('local_c1')?.pinned).toBe(false)
      expect(pinsOf(w).local_c1?.carried).toBeUndefined()
      expect(logOf(w)).toContain('profile switch: Bolt Staffing (22222222-2222-2222-2222-222222222222) could not read')
    })
  })

  // ---------------------------------------------------------------- 4. the switch line on the FIRST prompt after a switch

  describe('4. the switch line rides on the first prompt the person types in another account, and once a switch', () => {
    const ACCT_A = 'aaaaaaaa-1111-4111-8111-111111111111'
    const ORG_A = 'aaaaaaaa-2222-4222-8222-222222222222'
    const ACCT_B = 'bbbbbbbb-1111-4111-8111-111111111111'
    const ORG_B = 'bbbbbbbb-2222-4222-8222-222222222222'
    const KEY_A = `${ACCT_A}/${ORG_A}`
    const KEY_B = `${ACCT_B}/${ORG_B}`
    const envOf = (account?: string, org?: string): Record<string, string> => ({
      CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone',
      ...(account ? { CLAUDE_CODE_ACCOUNT_UUID: account } : {}),
      ...(org ? { CLAUDE_CODE_ORGANIZATION_UUID: org } : {}),
    })
    const routineLines = (w: { prompts: Array<{ text: string }> }) => w.prompts.filter(p => p.text.includes('"Automatic switch routine"'))
    /** In profile B; the sync last ran in A (or, with `profile` null, nothing on record). */
    const inBEnv = (on: On, env: Record<string, string>, store: Record<string, unknown> = {}, tools: 'start' | 'spawn' = 'start') =>
      world(on, {
        tools, env,
        feed: acmeOnly(),
        threads: [thread('local_other', 'Unrelated notes', 100)],
        files: profileRec(PROFILE_B, SELF),
        store: { 'mm.profile': { dir: PROFILE_A, since: NOW - DAYS }, ...store },
      })
    const say = async ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

    test('the account changed: the FIRST prompt carries the routine\'s line at once (before any sync here), with --at its own time; the sync\'s record of the same switch after it brings no second line', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B), { 'mm.account': { key: KEY_A, since: NOW - DAYS } })
      await say($, 'morning')
      expect(routineLines(w)).toHaveLength(1)
      expect(w.prompts[0]?.text.startsWith('morning\n\n[mm-bridge] You switched Claude profiles')).toBe(true)
      expect(w.prompts[0]?.text).toContain(`"Automatic switch routine" with --at ${NOW}.`)
      expect(w.stored['mm.account']).toEqual({ key: KEY_B, since: NOW, from: KEY_A })
      // the sync runs here: it records the switch into B
      await tickOnce($, w)
      expect(w.stored['mm.profile']).toMatchObject({ dir: PROFILE_B, from: PROFILE_A })
      await say($, 'and this')
      await w.clock.advance(60_000)
      await say($, 'and that')
      expect(routineLines(w)).toHaveLength(1)
      expect(w.prompts.map(p => p.text.split('\n\n')[0])).toEqual(['morning', 'and this', 'and that'])
      expect(starts(w)).toEqual([])
      // ⛔ the ids are kept in mm.account alone: nothing written or logged carries them
      expect(JSON.stringify(w.written)).not.toContain(ACCT_B)
      expect(JSON.stringify(w.written)).not.toContain(ORG_A)
    })

    test('the sync recorded the switch first, then the account is seen on the first prompt: one line, once', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B), { 'mm.account': { key: KEY_A, since: NOW - DAYS } })
      await tickOnce($, w)
      await say($, 'morning')
      await say($, 'again')
      expect(routineLines(w)).toHaveLength(1)
      expect(routineLines(w)[0]?.text.startsWith('morning')).toBe(true)
    })

    test('no account in the environment: today\'s behavior (no line before the sync records the switch; then one), and nothing written to mm.account', async ($, on) => {
      const w = inBEnv(on, envOf(), { 'mm.account': { key: KEY_A, since: NOW - DAYS } })
      await say($, 'morning')
      expect(routineLines(w)).toHaveLength(0)
      await tickOnce($, w)
      await say($, 'next')
      await say($, 'again')
      expect(routineLines(w).map(p => p.text.split('\n\n')[0])).toEqual(['next'])
      expect(w.stored['mm.account']).toEqual({ key: KEY_A, since: NOW - DAYS })
    })

    test('one of the two ids missing: no account detection', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B), { 'mm.account': { key: KEY_A, since: NOW - DAYS } })
      await say($, 'morning')
      expect(routineLines(w)).toHaveLength(0)
      expect(w.stored['mm.account']).toEqual({ key: KEY_A, since: NOW - DAYS })
    })

    test('the same account as on record, and no switch recorded: no line', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B), { 'mm.account': { key: KEY_B, since: NOW - DAYS }, 'mm.profile': { dir: PROFILE_B, since: NOW - DAYS } })
      await say($, 'morning')
      await tickOnce($, w)
      await say($, 'again')
      expect(routineLines(w)).toHaveLength(0)
      expect(w.stored['mm.account']).toEqual({ key: KEY_B, since: NOW - DAYS })
    })

    // (A world's environment is fixed for its test: the way back to A starts from the store as the way to B left it.)
    test('A to B, then B to A: one line for each switch', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B), { 'mm.account': { key: KEY_A, since: NOW - DAYS }, 'mm.profile': { dir: PROFILE_B, since: NOW - DAYS } })
      await say($, 'in B')
      await say($, 'still B')
      expect(routineLines(w).map(p => p.text.split('\n\n')[0])).toEqual(['in B'])
      // what the way back starts from
      expect(w.stored['mm.account']).toEqual({ key: KEY_B, since: NOW, from: KEY_A })
      expect(w.stored['mm.awayTold']).toEqual({ since: NOW - DAYS, keys: [], at: NOW, routine: true, account: NOW })
    })

    test('B to A, the store as A to B left it an hour before: the line again, once, with its own time', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_A, ORG_A), {
        'mm.account': { key: KEY_B, since: NOW - HOUR, from: KEY_A },
        'mm.awayTold': { since: NOW - DAYS, keys: [], at: NOW - HOUR, routine: true, account: NOW - HOUR },
        'mm.profile': { dir: PROFILE_B, since: NOW - DAYS },
      })
      await say($, 'in A')
      await say($, 'still A')
      expect(routineLines(w).map(p => p.text.split('\n\n')[0])).toEqual(['in A'])
      expect(routineLines(w)[0]?.text).toContain(`--at ${NOW}.`)
      expect(w.stored['mm.account']).toEqual({ key: KEY_A, since: NOW, from: KEY_B })
    })

    test('first run after the upgrade: no mm.account yet and a switch on record: today\'s line, once; the account is written with no switch', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B))
      await tickOnce($, w)
      const since = (w.stored['mm.profile'] as { since: number }).since
      await say($, 'morning')
      await say($, 'again')
      expect(routineLines(w)).toHaveLength(1)
      expect(routineLines(w)[0]?.text).toContain(`--at ${since}.`)
      expect(w.stored['mm.account']).toMatchObject({ key: KEY_B })
      expect((w.stored['mm.account'] as { from?: unknown }).from).toBeUndefined()
    })

    test('a thread without start_session leaves the switch on record as it was, for a thread that can carry its line', async ($, on) => {
      const w = inBEnv(on, envOf(ACCT_B, ORG_B), { 'mm.account': { key: KEY_A, since: NOW - DAYS } }, 'spawn')
      await say($, 'morning')
      expect(routineLines(w)).toHaveLength(0)
      expect(w.stored['mm.account']).toEqual({ key: KEY_A, since: NOW - DAYS })
    })
  })
})
