import { describe, expect, test } from 'claude-code/testing'

import { fakeApp, mm, pid as appPid } from './fake-app.test-helper'
import type { FakeThread } from './fake-app.test-helper'
import {
  buildLists, clockAndDue, fastState, mayStart, pinReason, pinTitle, pinsFor, rowLine, shownDue, teamLate, threadWhy, titleFor, waitingOnClient,
} from './queue'
import type { Feed, FeedAsk, FeedDraft, FeedMail, FeedTicket, QueueItem } from './queue'
import { isBusinessTime } from './business-time'
import { VERSION } from './register'

// ============================================================================================================================
// Rob's rules for pins, clocks and client threads, ONE TEST EACH (2026-11-05).
//
// The six-week pass over Rob's own messages (2026-09-24 to 2026-11-05) found 110 lines in 50 sessions about how the
// bridge pins and clocks client threads, and about 52 questions of "why is this pinned?". Each rule below is the newest
// form of what he said (a newer word wins over an older one), with the date and his words; each test checks it. Where a
// rule has a thorough test elsewhere that needs a harness this file does not have (a profile switch, the lease), its test
// here says so and names it. The list is in the 0.7.23 PR description and in the bridge's report to Rob.
// ============================================================================================================================

const H = 3_600_000
/** Wed 2026-11-04, 3 PM in New York (EST). The cut (`listCutoff`) is 3 weeks back: Wed Oct 14, 3 PM. */
const NOW = Date.parse('2026-11-04T15:00:00-05:00')
const iso = (t: number) => new Date(t).toISOString()
const ME = 'builder-a@example.com'
const ROB = 'owner@example.com'
const ASIF = 'asif@example.com'
const P = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
const ACME = 'Acme Legal'

const feed = (over: Partial<Feed> = {}): Feed => ({ member: ME, role: 'builder', mail: [], drafts: [], tickets: {}, threads: [], ...over })
/** An unanswered client message to the viewer's client, from Jeff Smith. `due` given: the feed's reply time. */
const mail = (n: number, receivedAt: number, over: Partial<FeedMail> = {}): FeedMail => ({
  message_id_key: `m${n}-${receivedAt}`, received_at: iso(receivedAt), sender: 'Jeff Smith <jeff@acme.example>', subject: 'Question', snippet: 'hello',
  project_id: P(n), project_name: `${ACME} — Jeff`, reply_status: 'unanswered', project_owner_email: ME, ...over,
})
/** A committed ticket of the viewer's (null: nobody dated it). */
const ticket = (n: number, dueAt: number | null, over: Partial<FeedTicket> = {}): FeedTicket => ({
  ticket_id: P(100 + n), project_id: P(n), project_name: `${ACME} — Jeff`, title: 'Build the intake form', due_at: dueAt === null ? null : iso(dueAt),
  due_source: dueAt === null ? null : 'commitment', assignee_email: ME, ...over,
})
/** The client's reply package: prepared, drafts covering a message two hours ago. */
const pkg = (n: number, over: Partial<FeedDraft> = {}): FeedDraft => ({
  package_id: P(200 + n), project_id: P(n), project_name: `${ACME} — Jeff`, status: 'prepared', covers_through: iso(NOW - 2 * H), drafts_ready: 1, drafts_unsent: 1,
  project_owner_email: ME, ...over,
})
/** Every client the lists hold, whichever list. */
const all = (f: Feed, now = NOW): QueueItem[] => {
  const l = buildLists(f, now)
  return [...l.queue, ...l.teammate, ...l.checking]
}
const one = (f: Feed, now = NOW): QueueItem => {
  const it = all(f, now)[0]
  if (!it) throw new Error('no client listed')
  return it
}
const pins = (f: Feed, now = NOW): boolean => all(f, now).some(it => pinsFor(it, now))

describe("Rob's pin and clock rules, one test each (0.7.25)", () => {
  // -------------------------------------------------------------------------------------------------------- what pins
  test('P1 (10-14, 11-04: "the clock is supposed to pin it when I have something due in less than 24 hours (like a reply or an ETA)"): due within 24 business hours or late pins; further out does not', () => {
    expect(pins(feed({ mail: [mail(1, NOW - 4 * H, { reply_due_at: iso(NOW + 20 * H) })] }))).toBe(true)
    expect(pins(feed({ mail: [mail(1, NOW - 4 * H, { reply_due_at: iso(NOW + 30 * H) })] }))).toBe(false)
    expect(pins(feed({ tickets: { overdue: [ticket(1, NOW - 2 * H)] } }))).toBe(true)
    expect(pins(feed({ tickets: { due_soon: [ticket(1, NOW + 22 * H)] } }))).toBe(true)
    expect(pins(feed({ tickets: { due_soon: [ticket(1, NOW + 50 * H)] } }))).toBe(false)
  })

  test('P2 (10-08, 11-04: "pin it if I have a task due for them that\'s going to require me to work 1.5 hours a day to complete it on time"): a task whose start-by has come pins days before its due date', () => {
    // due Tue Nov 10 3 PM; OW's start-by (its estimate at the client's pace) was this morning
    const late = { ...ticket(1, Date.parse('2026-11-10T15:00:00-05:00')), start_by_at: iso(NOW - 6 * H) }
    expect(pins(feed({ tickets: { start_now: [late] } }))).toBe(true)
    // the same task with no estimate acts by its due date alone
    expect(pins(feed({ tickets: { start_now: [{ ...late, start_by_at: null }] } }))).toBe(false)
  })

  test('P3 (11-04: "if a client sent me a reply and they sent me a message, the reply package should be pinned as soon as possible"): a client message pins its thread the minute it arrives', () => {
    // no reply time from the feed: 24 business hours after it arrived, inside the window from the first minute
    const f = feed({ mail: [mail(1, NOW - 60_000)] })
    expect(pins(f)).toBe(true)
    expect(pins(feed({ mail: [mail(1, NOW - 60_000)], drafts: [pkg(1, { covers_through: iso(NOW - 60_000) })] }))).toBe(true)
  })

  test('P4 (10-30: "I saw some things that were pinned with no hours left or hours overdue ... I\'m not sure why they were pinned"): a pin needs a clock; an undated item never pins and says `no due date`', () => {
    const it = one(feed({ tickets: { due_soon: [ticket(1, null)] } }))
    expect(pinsFor(it, NOW)).toBe(false)
    expect(titleFor(it, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
  })

  test('P5 (11-04: "The pinned is for when action is needed from you, not when something has a timer left for a teammate to answer"; 11-05: "When things are overdue but not assigned to me, I don\'t think they should be pinned here"): a teammate\'s part never pins the founder', () => {
    const founder = (over: Partial<Feed>) => feed({ member: ROB, role: 'founder', ...over })
    // a teammate's internal ticket on a client, late with no ETA: listed under Team · late, never pinned
    const late = { ...ticket(1, null, { assignee_email: ASIF, internal: true }), eta_needed_by: iso(NOW - 5 * H), eta_ask: 'no ETA' }
    const f1 = founder({ tickets: { overdue: [late] } })
    expect(pins(f1)).toBe(false)
    expect(teamLate(all(f1)).map(p => [p.by, p.count])).toEqual([['Asif', 1]])
    // a package flagged for his OK that Asif sends and decides on, due in 2 hours: not his to act on yet
    const ok = pkg(2, { flagged_for_rob: true, project_owner_email: ASIF, due_at: iso(NOW + 2 * H) })
    const f2 = founder({ drafts: [ok] })
    expect(pins(f2)).toBe(false)
    expect(titleFor(one(f2), NOW)).toContain('Asif decides')
  })

  test('P6 (11-04: "It should only show up to me and Husnain if somebody\'s late or very close to being late ... Probably should [surface] to H9 before it [surfaces] to me"): the PM is pinned 5 business hours ahead of a teammate\'s due time, named who to check on', () => {
    const pm = (dueIn: number) => feed({ member: 'h9@example.com', role: 'pm', tickets: { due_soon: [ticket(1, NOW + dueIn * H, { assignee_email: ASIF })] } })
    const near = one(pm(4))
    expect(pinsFor(near, NOW)).toBe(true)
    expect(pinTitle(near, NOW)).toBe(`🔴 ${ACME} · check on Asif · task due 7 PM`)
    expect(all(pm(8)).some(it => pinsFor(it, NOW))).toBe(false)
  })

  test('P7 (11-03: "whoever sent the ETA should have been showing up in their Claude after that, pinned"; "he has a 24-hour timer to assign it to a teammate"): an ETA owed and an owner to give each pin, by their own clocks', () => {
    const eta = { ...ticket(1, null), eta_needed_by: iso(NOW + 3 * H), eta_ask: 'no ETA' }
    const etaItem = one(feed({ tickets: { due_soon: [eta] } }))
    expect(pinsFor(etaItem, NOW)).toBe(true)
    expect(titleFor(etaItem, NOW)).toBe(`🔴 3h left · ${ACME} · ETA needed`)
    const assign = ticket(2, NOW + 5 * H, { commitment_basis: 'assign_by' })
    const assignItem = one(feed({ tickets: { due_soon: [assign] } }))
    expect(pinsFor(assignItem, NOW)).toBe(true)
    expect(titleFor(assignItem, NOW)).toBe(`🔴 5h left · ${ACME} · assign an owner`)
  })

  test('P8 (10-23: "that should also trigger a 24 hr reply not just for me but for anyone asked to do something internally"; 11-05: "Should work the same way for the team members"): an internal ask gives whoever is asked a 24-business-hour clock on that client\'s thread', () => {
    const ask = (asked: string): FeedAsk => ({
      ask_id: P(300), project_id: P(1), project_name: `${ACME} — Jeff`, asker_name: 'Rob', asker_email: ROB, asked_email: asked, asked_at: iso(NOW - H), due_at: null,
    })
    const mine = one(feed({ asks: [ask(ME)] }))
    expect(mine.kind).toBe('ask')
    expect(pinsFor(mine, NOW)).toBe(true)
    // 24 business hours after it was asked: Thu 2 PM
    expect(titleFor(mine, NOW)).toBe(`🟡 23h left · ${ACME} · internal ask`)
    // one asked of someone else is theirs, not the viewer's
    expect(all(feed({ asks: [ask(ASIF)] }))).toEqual([])
  })

  test('P9 (11-05, on tickets of a client who never approved the plan: "Antu doesn\'t have anything to do for them... Why is this pinned?"): a ticket waiting on the client never lists, pins or counts late, for anyone', () => {
    const waiting = ticket(1, NOW - 5 * H, { waiting_on: 'client' })
    expect(waitingOnClient(waiting)).toBe(true)
    expect(all(feed({ tickets: { overdue: [waiting] } }))).toEqual([])
    // the PM's check on a teammate, and the founder's Team · late, skip it too
    const theirs = { ...waiting, assignee_email: ASIF }
    expect(all(feed({ member: 'h9@example.com', role: 'pm', tickets: { overdue: [theirs] } }))).toEqual([])
    expect(teamLate(all(feed({ member: ROB, role: 'founder', tickets: { overdue: [{ ...theirs, internal: true }] } })))).toEqual([])
    // the same ticket with the client's move done (OW clears `waiting_on`) is late again
    expect(pins(feed({ tickets: { overdue: [{ ...waiting, waiting_on: null }] } }))).toBe(true)
  })

  test('P10 (10-26: "He sent us an email. I\'m not sure why this thread still says 23 hours left"): a message that needs no reply starts no clock', () => {
    for (const status of ['no_reply_needed', 'answered', 'unknown']) expect(all(feed({ mail: [mail(1, NOW - H, { reply_status: status })] }))).toEqual([])
    expect(pins(feed({ mail: [mail(1, NOW - H)] }))).toBe(true)
  })

  test('P11 (11-03: "The follow-ups are supposed to be automatic once they\'re approved"): a package whose drafts all went is clear, whatever approved follow-ups it schedules (unapproved ones: PR #62)', () => {
    const held = pkg(1, { status: 'picked_up', picked_up_by: ME, picked_up_at: iso(NOW - H), drafts_unsent: 0 })
    expect(all(feed({ drafts: [held] }))).toEqual([])
    // one draft still unsent is not clear
    expect(pins(feed({ drafts: [{ ...held, drafts_unsent: 1 }] }))).toBe(true)
  })

  test('P12 (10-20, 10-30: "We shouldn\'t be considering anything that\'s older than the cutoff date"): nothing due before the cut (the later of Oct 14 and 3 weeks back) counts anywhere', () => {
    expect(all(feed({ tickets: { overdue: [ticket(1, Date.parse('2026-10-13T15:00:00-04:00'))] } }))).toEqual([])
    const inside = one(feed({ tickets: { overdue: [ticket(1, Date.parse('2026-10-15T15:00:00-04:00'))] } }))
    expect(pinsFor(inside, NOW)).toBe(true)
    expect(titleFor(inside, NOW)).toBe(`🔴 14d late, due Oct 15 · ${ACME} · task`)
  })

  test('P13 (10-12: "the weekends don\'t count as days towards the 24-hour response time"): clocks count business hours, and no due time shows on a weekend', () => {
    // received Fri Nov 6 3 PM: due Mon Nov 9 3 PM; read Mon 10 AM it has 5 hours left, not a weekend's worth late
    const fri = Date.parse('2026-11-06T15:00:00-05:00')
    const mon = Date.parse('2026-11-09T10:00:00-05:00')
    const it = one(feed({ mail: [mail(1, fri)] }), mon)
    expect(titleFor(it, mon)).toBe(`🔴 5h left · ${ACME} · reply`)
    // a due time the feed puts on a Saturday is shown on the Friday before
    expect(isBusinessTime(shownDue(Date.parse('2026-11-07T12:00:00-05:00')))).toBe(true)
  })

  // ------------------------------------------------------------------------------------------------------- clearing
  test('C1 (10-19, 10-23: "Since we sent the email to the other thread, the timer should no longer be showing 7 hours left"; 10-27; 11-04): a reply sent from any thread, profile or teammate clears the clock', () => {
    // OW marks the message answered whoever sent the reply: nothing listed
    expect(all(feed({ mail: [mail(1, NOW - 3 * H, { reply_status: 'answered', last_outbound_at: iso(NOW - 10 * 60_000) })] }))).toEqual([])
    // with a package open, our newer send moves it to checking: off the list, unpinned, named so
    const f = feed({ drafts: [pkg(1, { covers_through: iso(NOW - 3 * H), last_outbound_at: iso(NOW - 10 * 60_000), checked_send_at: null })] })
    const l = buildLists(f, NOW)
    expect(l.queue).toEqual([])
    expect(l.checking.map(i => i.projectId)).toEqual([P(1)])
    const sent = l.checking[0] as QueueItem
    expect(fastState(sent, NOW)?.state).toBe('checking')
    expect(pinReason(sent, NOW)).toBe('No pin needed: your reply went at 2:50 PM, and the server is checking it answered everything.')
  })

  test('C2 (10-28: "I\'m not sure why this got unpinned and says \'clear\' when I haven\'t sent the reply to them"): until the owed reply is actually sent, the thread stays pinned', () => {
    const f = feed({ mail: [mail(1, NOW - 30 * H)], drafts: [pkg(1, { covers_through: iso(NOW - 30 * H) })] })
    const it = one(f)
    expect(pinsFor(it, NOW)).toBe(true)
    expect(titleFor(it, NOW)).toMatch(/^🔴 \d+h late, due .* · Acme Legal · reply ready$/)
  })

  // ------------------------------------------------------------------------------------- the person's pins, in the app
  /** The client's linked thread `local_c1`, beside the hub the sync runs in. */
  const linked = (f: Feed, thread: Partial<FakeThread>, store: Record<string, unknown> = {}) => {
    const w = fakeApp(f, [{ sessionId: 'local_hub', title: 'Hub' }, { sessionId: 'local_c1', title: 'Client work', ...thread }], [], { now: NOW })
    w.put('mm.links', { [appPid(1)]: 'local_c1' })
    for (const [k, v] of Object.entries(store)) w.put(k, v)
    return w
  }
  const appMail = (n: number, hoursAgo: number): FeedMail => ({ ...mail(n, NOW - hoursAgo * H), project_id: appPid(n) })
  const appFeed = (over: Partial<Feed> = {}): Feed => feed({ member: ME, ...over })
  const sync = async (w: ReturnType<typeof fakeApp>, times = 1) => {
    for (let i = 0; i < times; i++) {
      await mm(w.session('local_hub'), '')
      await w.advance(6 * 60_000)
    }
  }

  test('C3 (10-14: "Even if I manually pinned something, it should still unpin when it\'s cleared"; 11-03 to 11-05, seven times: "If you\'re done here, you can unpin the thread"): a client that clears has its thread unpinned whoever pinned it, once', async () => {
    const f = appFeed({ mail: [appMail(1, 2)] })
    const w = linked(f, { pinned: true }, { 'mm.pins': { local_c1: { projectId: appPid(1), client: ACME, byUs: false } } })
    await sync(w)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    // the reply went: the client is clear
    f.mail = []
    await sync(w)
    expect(w.app.get('local_c1')).toMatchObject({ pinned: false })
    expect(w.app.get('local_c1')?.title).toMatch(/^✓ Acme Legal · clear /)
    // once per clear: the person pins it again afterwards, and it stays theirs
    ;(w.app.get('local_c1') as FakeThread).pinned = true
    await sync(w, 3)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
  })

  test('C4 (11-03: "if I pin something myself, it should stay there until I unpin it, except for when I\'m switching profiles"): the person\'s pin on a client with no clock stays, sync after sync (the switch: register.test.ts 0.7.16 (a)/(b))', async () => {
    const w = linked(appFeed({ tickets: { due_soon: [{ ...ticket(1, null), project_id: appPid(1) }] }, client_activity: [{ project_id: appPid(1), at: iso(NOW - 24 * H) }] }), { pinned: true })
    await sync(w, 3)
    expect(w.app.get('local_c1')).toMatchObject({ pinned: true, title: `🟡 ${ACME} · task · no due date` })
    expect(w.calls.filter(c => c.tool === 'set_pinned' && c.args.session_id === 'local_c1')).toEqual([])
  })

  test('C5 (11-03: "Our bridge should repin it if there\'s still something needed"; 10-12: an unpin with nothing needed stays): an unpin while the client needs you is put back, named `still needs you`', async () => {
    const f = appFeed({ mail: [appMail(1, 2)] })
    const w = linked(f, {})
    await sync(w)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    ;(w.app.get('local_c1') as FakeThread).pinned = false
    await sync(w)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    expect(w.app.get('local_c1')?.title).toMatch(/ · still needs you$/)
    // nothing needed: the client's only item is undated now, and the person's unpin stands
    f.mail = []
    f.tickets = { due_soon: [{ ...ticket(1, null), project_id: appPid(1) }] }
    await sync(w)
    ;(w.app.get('local_c1') as FakeThread).pinned = false
    await sync(w, 3)
    expect(w.app.get('local_c1')?.pinned).toBe(false)
  })

  test('C6 (10-26: "Shouldn\'t this be in a team member\'s Claude Code thread? I thought I gave them everything they needed"; 11-05: "when a teammate\'s holding it, but it\'s late, it shows up on the morning meeting post instead of pinned on my side panel"): a package a teammate holds never pins the founder, flagged or not, late or not, unless that teammate asks him', () => {
    const founder = (over: Partial<Feed>) => feed({ member: ROB, role: 'founder', ...over })
    // handed over with his answers (nothing flagged for him), late: never his
    const handed = pkg(1, { status: 'picked_up', picked_up_by: ASIF, picked_up_at: iso(NOW - H), project_owner_email: ASIF, covers_through: iso(NOW - 30 * H) })
    expect(pins(founder({ drafts: [handed] }))).toBe(false)
    // still flagged for his OK and late: still Asif's, listed under Team · late (0.7.23), and the thread says so
    const flagged = { ...handed, flagged_for_rob: true }
    const late = founder({ drafts: [flagged] })
    expect(pins(late)).toBe(false)
    expect(teamLate(all(late)).map(p => [p.by, p.count])).toEqual([['Asif', 1]])
    expect(pinReason(one(late), NOW)).toBe(`No pin needed: Asif holds the late reply to ${ACME}, flagged for your OK, and it is listed under Team · late.`)
    // Asif asks him about the client: then it is his (his ask's 24-hour clock, P8)
    const ask: FeedAsk = { ask_id: P(300), project_id: P(1), project_name: `${ACME} — Jeff`, asker_name: 'Asif', asker_email: ASIF, asked_email: ROB, asked_at: iso(NOW - H), due_at: null }
    expect(pins(founder({ drafts: [flagged], asks: [ask] }))).toBe(true)
  })

  // --------------------------------------------------------------------------------------------------------- labels
  test('L1 (10-12: "hours before overdue ... as the first part of the message"; 10-30: "If there\'s something the system thinks is overdue, it should also say that when it was"): the name leads with the clock, and late says when it was due', () => {
    expect(titleFor(one(feed({ mail: [mail(1, NOW - H, { reply_due_at: iso(NOW + 10 * H) })] })), NOW)).toBe(`🟡 10h left · ${ACME} · reply`)
    expect(titleFor(one(feed({ mail: [mail(1, NOW - 30 * H, { reply_due_at: iso(NOW - 3 * H) })] })), NOW)).toBe(`🔴 3h late, due 12 PM · ${ACME} · reply`)
  })

  test('L2 (10-14: "inside the thread, Niju says 1 day late, but..."): lateness comes from a real due date only, and the name and the row show the same clock', () => {
    const it = one(feed({ tickets: { overdue: [ticket(1, NOW - 30 * H)] } }))
    const clock = clockAndDue(it.dueAt, NOW)
    expect(titleFor(it, NOW)).toContain(clock)
    expect(rowLine(it, NOW)).toContain(clock)
    // no date, no lateness anywhere
    const undated = one(feed({ tickets: { due_soon: [ticket(1, null)] } }))
    expect(`${titleFor(undated, NOW)} ${rowLine(undated, NOW)}`).not.toMatch(/late|left/)
  })

  test('L3 (11-03: "Why does it say there\'s 23 hours left here? Do I owe him something?"; "I don\'t know if this is supposed to be pinned for me or if the team is handling this"; ~52 such questions): the thread says why it is pinned, or why no pin is needed', async () => {
    // the sentence and the pin come from the same test: `Pinned` exactly when the thread pins
    const fixtures: Feed[] = [
      feed({ mail: [mail(1, NOW - H)] }),
      feed({ mail: [mail(1, NOW - H)], drafts: [pkg(1)] }),
      feed({ tickets: { due_soon: [ticket(1, null)] } }),
      feed({ tickets: { due_soon: [ticket(1, NOW + 50 * H)] } }),
      feed({ tickets: { start_now: [{ ...ticket(1, Date.parse('2026-11-09T15:00:00-05:00')), start_by_at: iso(NOW - 2 * H) }] } }),
      feed({ member: 'h9@example.com', role: 'pm', tickets: { due_soon: [ticket(1, NOW + 4 * H, { assignee_email: ASIF })] } }),
      feed({ member: ROB, role: 'founder', drafts: [pkg(1, { status: 'picked_up', picked_up_by: ASIF, project_owner_email: ASIF, flagged_for_rob: true })] }),
    ]
    fixtures.push(feed({ drafts: [pkg(1, { covers_through: iso(NOW - 3 * H), last_outbound_at: iso(NOW - 10 * 60_000) })] }))
    // R8: a client whose newer send the server is checking is unpinned, whatever its clock
    const bridgePins = (it: QueueItem) => pinsFor(it, NOW) && fastState(it, NOW)?.state !== 'checking'
    for (const f of fixtures) for (const it of all(f)) expect(pinReason(it, NOW).startsWith('Pinned')).toBe(bridgePins(it))
    // who must act, what is owed, to whom, by when
    expect(pinReason(one(fixtures[1] as Feed), NOW)).toBe('Pinned for you, due Thu 1 PM (22h left): Jeff Smith is waiting on your reply, and the drafts are ready.')
    expect(pinReason(one(fixtures[2] as Feed), NOW)).toBe('No pin needed: nothing of yours here has a due date.')
    expect(pinReason(one(fixtures[3] as Feed), NOW)).toBe('No pin needed: the next thing of yours is due Fri 5 PM, more than 24 business hours away.')
    expect(pinReason(one(fixtures[4] as Feed), NOW)).toBe('Pinned for you: your task "Build the intake form" is due Mon 3 PM, and to land on time its work had to start 1 PM.')
    expect(pinReason(one(fixtures[5] as Feed), NOW)).toBe('Pinned to check on Asif: their task is due 7 PM (4h left).')
    expect(pinReason(one(fixtures[6] as Feed), NOW)).toBe(`No pin needed: Asif has ${ACME}'s reply drafts, so nothing here needs you.`)
    // the person's own pin, and a pin put back over their unpin, are said too
    expect(threadWhy(one(fixtures[2] as Feed), ACME, NOW, { person: true })).toBe('No pin needed: nothing of yours here has a due date. You pinned it yourself, so it stays until you unpin it.')
    expect(threadWhy(undefined, ACME, NOW)).toBe(`No pin needed: nothing of ${ACME}'s waits on you.`)
    // and the thread shows it: the band's `why` in the client's own thread, none in another
    const w = linked(appFeed({ mail: [appMail(1, 1)] }), {})
    await sync(w)
    await mm(w.session('local_c1'), '')
    expect((w.view('local_c1', 'band') as { why?: string } | undefined)?.why).toBe('Pinned for you, due Thu 2 PM (23h left): Jeff Smith is waiting on your reply.')
    expect((w.view('local_hub', 'band') as { why?: string } | undefined)?.why).toBeUndefined()
  })

  // -------------------------------------------------------------------------------------------------------- threads
  test('T1 (10-15: "Can we have it update to attach to the most recent"; 10-27: "It is here. I just don\'t know why it wants to do a new one"): the client\'s thread here is linked by itself and never counted missing', async () => {
    const f = appFeed({ mail: [appMail(1, 2)], threads: [{ project_id: appPid(1), session_id: 'cli-c1', last_activity_at: iso(NOW - H), sole: true }] })
    const w = fakeApp(f, [{ sessionId: 'local_hub', title: 'Hub' }, { sessionId: 'local_c1', title: 'Acme work' }], [], { now: NOW })
    w.put('mm.threads', { 'cli-c1': { app: 'local_c1', at: NOW } })
    await sync(w)
    expect((w.stored('mm.links') as Record<string, string>)[appPid(1)]).toBe('local_c1')
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    expect((w.view('local_hub', 'band') as { missing?: number } | undefined)?.missing ?? 0).toBe(0)
  })

  test('T2 (10-30: "I don\'t think we need to be creating threads for people that haven\'t been active"; kept 11-03): no Start for a quiet client, unless something is due for you', () => {
    const quiet = one(feed({ tickets: { due_soon: [ticket(1, null)] } }))
    expect(mayStart(quiet, NOW - 50 * 24 * H, NOW)).toBe(false)
    expect(mayStart(quiet, NOW - 10 * 24 * H, NOW)).toBe(true)
    expect(mayStart(one(feed({ tickets: { due_soon: [ticket(1, NOW + 5 * H)] } })), undefined, NOW)).toBe(true)
  })

  test('T3 (10-27: "I should be assigned all those tickets. They should just be in a queue"): the founder\'s internal tickets are a ranked queue on the Massmarket AI thread, with no clock and no pin', () => {
    const OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'
    const q = { ticket_id: P(400), project_id: OPS, project_name: 'Massmarket AI', title: 'Fix the router', severity: 'high', internal: true, assignee_email: ROB, queue_tier: 1, queue_rank: 1, queue_reason: 'breaks sends' }
    const it = one(feed({ member: ROB, role: 'founder', tickets: { internal_queue: [q] }, summary: { internal_queue_total: 1 } }))
    expect(it.kind).toBe('queue')
    expect(pinsFor(it, NOW)).toBe(false)
    expect(titleFor(it, NOW)).toBe('🟡 Massmarket AI · internal queue')
  })

  test('T4 (10-12: "some of them got renamed in an older fashion"; 11-04: "appearing and disappearing"): the newest bridge on the machine holds the sync (sessions.test.ts 0.7.19); this release is newer than every one before it', () => {
    const [a = 0, b = 0, c = 0] = VERSION.split('.').map(Number)
    expect(a * 1e6 + b * 1e3 + c).toBeGreaterThan(7 * 1e3 + 23)
  })
})
