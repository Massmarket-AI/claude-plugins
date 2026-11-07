import { describe, expect, test } from 'claude-code/testing'

import { fakeApp, mm, pid as appPid } from './fake-app.test-helper'
import type { FakeThread } from './fake-app.test-helper'
import {
  NO_REPLY_WHAT, buildLists, checkNow, clientInTitle, clientMarkdown, clockAndDue, committedCount, draftsLine, etaAsksOf, fastState, keptPace, mayStart, needsYouNow, noDateGroup, noteText, paceOf, pastCutClients, pinReason, pinTitle, pinsFor, rowLine, shownDue, statusOf, teamLate, threadTitle, threadTitleShort, threadWhy, titleFor, titleNames, undatedCount, undatedOnly, waitingOnClient, withTeammate,
} from './queue'
import type { Feed, FeedAsk, FeedDraft, FeedMail, FeedPace, FeedTicket, QueueItem } from './queue'
import { autoUpdatable, kickoffText, pinReport, rowExtra, signatureOf, waitingText } from './threads'
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

  test('P4 (0.7.32, Rob 2026-11-06, over 11-05\'s "Shouldn\'t it be pinned?": "a ticket with no due date never pins and never asks for a date, for anyone"): an undated open item says `no due date` and does not pin, whatever its age', () => {
    const undated = feed({ member: ROB, role: 'founder', tickets: { undated: [ticket(1, null, { assignee_email: ROB })] } })
    expect(pinsFor(one(undated), NOW)).toBe(false)
    expect(titleFor(one(undated), NOW)).toBe(`🟡 ${ACME} · task · no due date`)
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

  test('P6 (0.7.34, Rob 2026-11-07, over his rule of 11-05: "I know we just made it so only H9 sees every single task pinned, but I still think that\'s the wrong architecture"): the PM is pinned for his own work, never a teammate\'s', () => {
    const pm = (dueIn: number) => feed({ member: 'h9@example.com', role: 'pm', tickets: { due_soon: [ticket(1, NOW + dueIn * H, { assignee_email: ASIF })] } })
    for (const dueIn of [-3, 4, 20, 30]) expect(all(pm(dueIn))).toEqual([])
    const own = one(feed({ member: 'h9@example.com', role: 'pm', tickets: { due_soon: [ticket(1, NOW + 4 * H, { assignee_email: 'h9@example.com' })] } }))
    expect(pinsFor(own, NOW)).toBe(true)
    expect(pinTitle(own, NOW)).not.toContain('check on')
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
    expect(pinReason(one(late), NOW)).toBe(`No pin needed: Asif holds the late reply to ${ACME}, flagged for your OK, and it is on the 9 AM image.`)
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
      feed({ member: 'h9@example.com', role: 'pm', tickets: { due_soon: [ticket(1, NOW + 4 * H, { assignee_email: 'h9@example.com' })] } }),
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
    expect(pinReason(one(fixtures[5] as Feed), NOW)).toStartWith('Pinned for you')
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

describe("Rob's statuses, one test per rule (0.7.27)", () => {
  const H9 = 'h9@example.com'
  /** Mon Nov 30, 5 PM ET: a date past the window, as the approved words give it. */
  const NOV_30 = Date.parse('2026-11-30T17:00:00-05:00')
  /** Mon Nov 9, 3 PM ET: inside the week. */
  const NOV_9 = Date.parse('2026-11-09T15:00:00-05:00')
  /** Thu Nov 5, the next business day after NOW, 9 AM ET. */
  const THU = Date.parse('2026-11-05T09:00:00-05:00')
  /** Sat Nov 7, noon ET. */
  const SAT = Date.parse('2026-11-07T12:00:00-05:00')
  const paceRow = (state: FeedPace['state'], over: Partial<FeedPace> = {}): FeedPace => ({
    project_id: P(1), project_name: `${ACME} — Jeff`, holder_email: ME, state, need_per_day: 2.4, paid_per_day: 1.5, hours_left: 20, hours_short: 3, date: iso(NOV_30), date_kind: 'ticket', ...over,
  })
  const onTrack = (over: Partial<FeedPace> = {}): FeedPace => paceRow('on_track', { need_per_day: 0.8, hours_short: 0, date: iso(NOV_9), ...over })
  const h9 = (over: Partial<Feed> = {}): Feed => feed({ member: H9, role: 'pm', ...over })
  const founder = (over: Partial<Feed> = {}): Feed => feed({ member: ROB, role: 'founder', ...over })
  const asifReport = (items: Array<{ project_id: string; pinned: boolean; kind: string }>) => ({ member_email: ASIF, reported_at: iso(NOW - H), items })
  /** The founder's own undated client ticket, as `tickets.undated` lists it. */
  const undatedRow = (over: Partial<FeedTicket> = {}): FeedTicket => ticket(1, null, { assignee_email: ROB, ...over })

  test('S2 (0.7.34, Rob 2026-11-07, over his rule of 11-05): nothing of a teammate\'s lists or pins for H9: a ticket, a missed start-by, a reply, a package, a pace row', () => {
    const tk = (dueIn: number, over: Partial<FeedTicket> = {}) => h9({ tickets: { due_soon: [ticket(1, NOW + dueIn * H, { assignee_email: ASIF, ...over })] } })
    for (const dueIn of [-3, 4, 20, 30]) expect(all(tk(dueIn))).toEqual([])
    expect(all(h9({ tickets: { start_now: [ticket(1, NOV_9, { assignee_email: ASIF, start_by_at: iso(NOW - 26 * H) })] } }))).toEqual([])
    expect(all(h9({ mail: [mail(1, NOW - 4 * H, { project_owner_email: ASIF, reply_due_at: iso(NOW + 20 * H) })] }))).toEqual([])
    expect(all(h9({ drafts: [pkg(1, { project_owner_email: ASIF, due_at: iso(NOW + 20 * H) })] }))).toEqual([])
    expect(all(h9({ drafts: [pkg(1, { status: 'picked_up', picked_up_by: ASIF, project_owner_email: 'antu@example.com', due_at: iso(NOW - H) })] }))).toEqual([])
    for (const state of ['behind', 'overbooked', 'late'] as const) expect(all(h9({ pace: [paceRow(state, { holder_email: ASIF })] })), state).toEqual([])
    // his own pace row, as anyone's
    expect(pinsFor(one(h9({ pace: [paceRow('behind', { holder_email: H9 })] })), NOW)).toBe(true)
  })

  test('S2b (approved 11-05: "never for undated items"; "H9 is NOT pinned for teammates\' green"): it never pins H9 for an undated item, an ETA ask, a teammate\'s on-track row, a row nobody holds or the founder\'s work', () => {
    expect(all(h9({ tickets: { due_soon: [ticket(1, null, { assignee_email: ASIF })] } }))).toEqual([])
    expect(all(h9({ tickets: { overdue: [{ ...ticket(1, null, { assignee_email: ASIF }), eta_needed_by: iso(NOW - H), eta_ask: 'no ETA' }] } }))).toEqual([])
    expect(all(h9({ tickets: { undated: [ticket(1, null, { assignee_email: ASIF })] } }))).toEqual([])
    expect(all(h9({ pace: [onTrack({ holder_email: ASIF })] }))).toEqual([])
    expect(all(h9({ pace: [paceRow('behind', { holder_email: null })] }))).toEqual([])
    const robs = 'rob@massmarket.ai'
    expect(all(h9({ tickets: { overdue: [ticket(1, NOW - H, { assignee_email: robs })] } }))).toEqual([])
    expect(all(h9({ mail: [mail(1, NOW - H, { project_owner_email: robs })] }))).toEqual([])
    expect(all(h9({ drafts: [pkg(1, { project_owner_email: robs, due_at: iso(NOW + H) })] }))).toEqual([])
    // a member sees nothing of a teammate's, as before
    expect(all(feed({ tickets: { overdue: [ticket(1, NOW - H, { assignee_email: ASIF })] }, pace: [paceRow('behind', { holder_email: ASIF })] }))).toEqual([])
  })

  test('S2c (0.7.34, Rob 2026-11-07, for his words of 11-05: "He can also have constant clarity about whether something\'s showing up for a teammate or not"): that clarity is Team now\'s; `member_pins` on the feed adds nothing to H9\'s list', () => {
    const f = { tickets: { due_soon: [ticket(1, NOW + 4 * H, { assignee_email: ASIF })] } }
    expect(all(h9({ ...f, member_pins: [asifReport([{ project_id: P(1), pinned: true, kind: 'task' }])] }))).toEqual([])
    expect(all(h9(f))).toEqual([])
  })

  test('S3 (11-05, approved "Yes, use them": "behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30"): a pace row\'s name and row, in the approved words', () => {
    const named = (f: Feed): string[] => {
      const it = one(f)
      return [titleFor(it, NOW), rowLine(it, NOW)]
    }
    const twice = (s: string): string[] => [s, s]
    expect(named(feed({ pace: [paceRow('behind')] }))).toEqual(twice(`🟡 ${ACME} · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`))
    expect(named(feed({ pace: [paceRow('overbooked')] }))).toEqual(twice(`🔴 ${ACME} · overbooked · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`))
    expect(named(feed({ pace: [paceRow('late', { date: iso(Date.parse('2026-11-02T17:00:00-05:00')) })] }))).toEqual(twice(`🔴 ${ACME} · late · 3 h past Mon Nov 2`))
    expect(named(feed({ pace: [onTrack()] }))).toEqual(twice(`🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day`))
    expect(named(feed({ pace: [onTrack({ hours_logged_today: 1.5 })] }))).toEqual(twice(`🟢 ${ACME} · today's hours done · due Mon 3 PM`))
    // start-by passed: a kind of behind, in place of `task not started`
    const late = ticket(1, NOV_9, { start_by_at: iso(Date.parse('2026-11-02T13:00:00-05:00')) })
    expect(named(feed({ tickets: { start_now: [late] } }))).toEqual(twice(`🟡 ${ACME} · behind · not started, had to start Mon 1 PM`))
    // one decimal, no trailing .0, and a date further out than a week never reads as this week's weekday
    expect(titleFor(one(feed({ pace: [paceRow('behind', { need_per_day: 3, paid_per_day: 1.25 })] })), NOW)).toBe(`🟡 ${ACME} · behind · needs 3 h/day, paid 1.3 · due Mon Nov 30`)
    expect(titleFor(one(feed({ pace: [onTrack({ date: iso(NOV_30) })] })), NOW)).toBe(`🟢 ${ACME} · on track · due Mon Nov 30 · 1.5 h/day`)
    // the bridge reads its own new mark as its own
    const green = `🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day`
    expect(clientInTitle(green)).toBe(ACME)
    expect(threadTitleShort(green)).toBe(ACME)
    expect(titleNames(green, ACME)).toBe(true)
    // a row with no usable date or number is no row
    expect(all(feed({ pace: [paceRow('behind', { date: 'soon' })] }))).toEqual([])
    expect(all(feed({ pace: [paceRow('behind', { need_per_day: 'lots' as never })] }))).toEqual([])
    expect(all(feed({ pace: [{ ...paceRow('behind'), state: 'cruising' as never }] }))).toEqual([])
  })

  test('S3b (11-05: "worst one shown per item"): the worst status names a client; a reply, an OK or a go the viewer owes keeps its name when it is at least as urgent', () => {
    const name = (over: Partial<Feed>) => titleFor(one(feed(over)), NOW)
    const due = (dueIn: number) => ({ due_soon: [ticket(1, NOW + dueIn * H)] })
    // a task: by the list. Red late, overbooked, due today; then yellow behind, due within 24 business hours
    expect(name({ tickets: due(4), pace: [paceRow('overbooked')] })).toBe(`🔴 ${ACME} · overbooked · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    expect(name({ tickets: due(4), pace: [paceRow('behind')] })).toBe(`🔴 4h left · ${ACME} · task`)
    expect(name({ tickets: due(20), pace: [paceRow('behind')] })).toBe(`🟡 ${ACME} · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    expect(name({ tickets: due(20), pace: [onTrack()] })).toBe(`🟡 20h left · ${ACME} · task`)
    expect(name({ tickets: due(50), pace: [onTrack()] })).toBe(`🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day`)
    expect(name({ tickets: { overdue: [ticket(1, NOW - 2 * H)] }, pace: [paceRow('late')] })).toBe(`🔴 2h late, due 1 PM · ${ACME} · task`)
    // a reply keeps its name when it is at least as urgent, and gives way when it is not
    const reply = (dueIn: number) => [mail(1, NOW - 5 * H, { reply_due_at: iso(NOW + dueIn * H) })]
    expect(name({ mail: reply(-1), pace: [paceRow('late')] })).toBe(`🔴 1h late, due 2 PM · ${ACME} · reply`)
    expect(name({ mail: reply(4), pace: [paceRow('overbooked')] })).toBe(`🔴 4h left · ${ACME} · reply`)
    expect(name({ mail: reply(20), pace: [paceRow('behind')] })).toBe(`🟡 20h left · ${ACME} · reply`)
    expect(name({ mail: reply(20), pace: [paceRow('overbooked')] })).toBe(`🔴 ${ACME} · overbooked · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    expect(name({ mail: reply(50), pace: [paceRow('behind')] })).toBe(`🟡 ${ACME} · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    // whatever names it, the client stays pinned and on the list as itself
    const it = one(feed({ mail: reply(20), pace: [paceRow('behind')] }))
    expect(it.kind).toBe('reply')
    expect(it.messages).toBe(1)
    // a go the viewer owes, a red one above it
    const go: Feed['projects'] = [{ project_id: P(1), name: `${ACME} — Jeff`, followups: { go_steps: 2, go_package_id: P(50), go_first_at: iso(NOV_9), go_first_kind: 'client_sms', go_by: ME } }]
    expect(name({ projects: go, pace: [paceRow('behind')] })).toBe(`🟡 3d left · ${ACME} · follow-ups need your go · first text Mon Nov 9`)
    expect(name({ projects: go, pace: [paceRow('overbooked')] })).toContain('overbooked')
    // ✓ clear is for nothing left to do: work in progress keeps a row
    const done = buildLists(feed({ pace: [onTrack({ hours_logged_today: 9 })] }), NOW)
    expect(done.queue.map(i => i.projectId)).toEqual([P(1)])
  })

  test('S3c (spec: "an absent key changes nothing and is never read as everyone is on track"): absent `pace`, and `[]`, change nothing; a feed with no key keeps the rows the last one gave', async () => {
    const base = feed({ tickets: { due_soon: [ticket(1, NOW + 50 * H), ticket(2, NOW + 2 * H)] }, mail: [mail(3, NOW - H)] })
    const lists = JSON.stringify(buildLists(base, NOW))
    expect(JSON.stringify(buildLists({ ...base, pace: [] }, NOW))).toBe(lists)
    expect(JSON.stringify(buildLists({ ...base, pace: undefined }, NOW))).toBe(lists)
    expect(JSON.stringify(buildLists({ ...base, member_pins: undefined }, NOW))).toBe(lists)
    // nothing reads as on track, and an unpinned client stays unpinned
    const far = one(feed({ tickets: { due_soon: [ticket(1, NOW + 50 * H)] } }))
    expect(titleFor(far, NOW)).toBe(`🟡 2d left · ${ACME} · task`)
    expect(pinsFor(far, NOW)).toBe(false)
    // the reader keeps what it had (OW left the key out: it could not read pace)
    const rows = [onTrack({ hours_logged_today: 0.5 })]
    expect(keptPace({ at: NOW - H, rows }, NOW)).toEqual(rows)
    expect(keptPace(null, NOW)).toBeNull()
    expect(keptPace({ at: NOW - H, rows: 'x' }, NOW)).toBeNull()
    expect(keptPace({ at: NOW + H, rows }, NOW)).toBeNull()
    // read on an earlier day its logged hours are that day's: not known today, so it stays pinned, `on track`
    const kept = keptPace({ at: NOW - H, rows: [onTrack({ hours_logged_today: 3 })] }, THU)
    expect('hours_logged_today' in (kept?.[0] ?? {})).toBe(false)
    expect(titleFor(one(feed({ pace: kept as FeedPace[] })), THU)).toBe(`🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day`)
    // and past 24 business hours nothing is known of them
    expect(keptPace({ at: NOW - H, rows }, Date.parse('2026-11-06T15:00:00-05:00'))).toBeNull()
  })

  test('S3d (the same): the sync keeps the last rows through a feed with no `pace`, and never takes the pin off for it', async () => {
    const row = { ...paceRow('behind'), project_id: appPid(1) }
    const f = feed({ pace: [row] })
    const w = fakeApp(f, [{ sessionId: 'local_hub', title: 'Hub' }, { sessionId: 'local_c1', title: 'Client work' }], [], { now: NOW })
    w.put('mm.links', { [appPid(1)]: 'local_c1' })
    await mm(w.session('local_hub'), '')
    await w.advance(6 * 60_000)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    expect(w.app.get('local_c1')?.title).toBe(`🟡 ${ACME} · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    delete f.pace
    await mm(w.session('local_hub'), '')
    await w.advance(6 * 60_000)
    expect(w.app.get('local_c1')?.pinned).toBe(true)
    expect(w.app.get('local_c1')?.title).toBe(`🟡 ${ACME} · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`)
    // `[]`: read, and nothing there
    f.pace = []
    await mm(w.session('local_hub'), '')
    await w.advance(6 * 60_000)
    expect(w.app.get('local_c1')?.pinned).toBe(false)
    expect(w.app.get('local_c1')?.title).toContain('clear')
  })

  test('S4 (11-05: "It should still be pinned, but it should say \'on track\'"): on track pins its holder each business day until the paid hours are logged; hours done unpins, and the next business day pins again; never H9', () => {
    const today = one(feed({ pace: [onTrack({ hours_logged_today: 1 })] }))
    expect(pinsFor(today, NOW)).toBe(true)
    const done = one(feed({ pace: [onTrack({ hours_logged_today: 1.5 })] }))
    expect(pinsFor(done, NOW)).toBe(false)
    expect(titleFor(done, NOW)).toBe(`🟢 ${ACME} · today's hours done · due Mon 3 PM`)
    // the next business day OW's count starts again
    const next = one(feed({ pace: [onTrack({ hours_logged_today: 0 })] }), THU)
    expect(pinsFor(next, THU)).toBe(true)
    expect(titleFor(next, THU)).toBe(`🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day`)
    // the client's own paid pace decides
    expect(pinsFor(one(feed({ pace: [onTrack({ paid_per_day: 3, hours_logged_today: 2 })] })), NOW)).toBe(true)
    expect(pinsFor(one(feed({ pace: [onTrack({ paid_per_day: 3, hours_logged_today: 3 })] })), NOW)).toBe(false)
    // hours not known: stays pinned and reads on track, never hours done
    const unknown = one(feed({ pace: [onTrack()] }))
    expect(pinsFor(unknown, NOW)).toBe(true)
    expect(titleFor(unknown, NOW)).toContain('on track')
    // business days only
    expect(pinsFor(one(feed({ pace: [onTrack()] }), SAT), SAT)).toBe(false)
    // never for H9 for a teammate's; his own, as anyone's
    expect(all(h9({ pace: [onTrack({ holder_email: ASIF })] }))).toEqual([])
    expect(pinsFor(one(h9({ pace: [onTrack({ holder_email: H9 })] })), NOW)).toBe(true)
    // behind, overbooked and late pin whatever is logged
    for (const state of ['behind', 'overbooked', 'late'] as const) expect(pinsFor(one(feed({ pace: [paceRow(state, { hours_logged_today: 9 })] })), NOW), state).toBe(true)
  })

  test('S4b (the same, on a thread): hours done takes the bridge\'s pin off and renames it; hours starting again the next business day pin it again, with no `still needs you`', async () => {
    const row = (logged: number) => [onTrack({ project_id: appPid(1), hours_logged_today: logged })]
    const f = feed({ pace: row(0.5) })
    const w = fakeApp(f, [{ sessionId: 'local_hub', title: 'Hub' }, { sessionId: 'local_c1', title: 'Client work' }], [], { now: NOW })
    w.put('mm.links', { [appPid(1)]: 'local_c1' })
    const pass = async () => {
      await mm(w.session('local_hub'), '')
      await w.advance(6 * 60_000)
    }
    await pass()
    expect(w.app.get('local_c1')).toMatchObject({ pinned: true, title: `🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day` })
    f.pace = row(1.5)
    await pass()
    expect(w.app.get('local_c1')).toMatchObject({ pinned: false, title: `🟢 ${ACME} · today's hours done · due Mon 3 PM` })
    // OW's count starts again with the Eastern day
    f.pace = row(0)
    await pass()
    expect(w.app.get('local_c1')).toMatchObject({ pinned: true, title: `🟢 ${ACME} · on track · due Mon 3 PM · 1.5 h/day` })
  })

  test('S6 (11-05: "Every status shows by name in each person\'s row on the 9 AM image"): the pin report carries each status as its kind, with its tone and date', () => {
    const report = (f: Feed, now = NOW) =>
      pinReport({
        now, listed: all(f, now), links: { [P(1)]: 'local_c1' }, thread: sid => (sid === 'local_c1' ? ({ sessionId: sid, title: 't', pinned: true } as never) : undefined),
        hidden: () => false, stayedOff: new Set(), capped: new Set(), byUs: () => true, client: () => ACME,
      }).items[0]
    expect(report(feed({ pace: [paceRow('behind')] }))).toMatchObject({ kind: 'behind', tone: 'yellow', due_at: iso(NOV_30), pinned: true, why_not: null })
    expect(report(feed({ pace: [paceRow('overbooked')] }))).toMatchObject({ kind: 'overbooked', tone: 'red', due_at: iso(NOV_30) })
    expect(report(feed({ pace: [paceRow('late')] }))).toMatchObject({ kind: 'late', tone: 'red', due_at: iso(NOV_30) })
    expect(report(feed({ pace: [onTrack()] }))).toMatchObject({ kind: 'on_track', tone: 'green', due_at: iso(NOV_9) })
    // (0.7.32, Rob 2026-11-06) an undated ticket is not one that should be pinned: the report no longer says `needs_date`
    expect(report(founder({ tickets: { undated: [undatedRow()] } }))).toBeUndefined()
    expect(report(feed({ tickets: { start_now: [ticket(1, NOV_9, { start_by_at: iso(NOW - 26 * H) })] } }))).toMatchObject({ kind: 'behind', tone: 'yellow', due_at: iso(NOV_9) })
    // today's hours done is not one that should be pinned
    expect(report(feed({ pace: [onTrack({ hours_logged_today: 1.5 })] }))).toBeUndefined()
    // what names nothing new reports as before
    expect(report(feed({ mail: [mail(1, NOW - H)] }))).toMatchObject({ kind: 'reply', tone: 'yellow' })
    expect(report(feed({ tickets: { overdue: [ticket(1, NOW - 2 * H)] } }))).toMatchObject({ kind: 'task', tone: 'red' })
    // the report's cap on a kind holds every one of them
    for (const k of ['behind', 'overbooked', 'on_track', 'late']) expect(k.length).toBeLessThanOrEqual(16)
  })

  test('S7 (11-03: "I don\'t know why this is pinned"; 0.7.25\'s rule): `pinReason` and `threadWhy` explain every status from the same test that sets the pin', () => {
    const why = (f: Feed, now = NOW) => pinReason(one(f, now), now)
    expect(why(feed({ pace: [onTrack({ hours_logged_today: 0.5 })] }))).toBe("Pinned for you: on track, 1.5 h a day is paid and today's hours aren't logged yet.")
    expect(why(feed({ pace: [onTrack()] }))).toBe("Pinned for you: on track, 1.5 h a day is paid and today's hours can't be read right now.")
    expect(why(feed({ pace: [onTrack({ hours_logged_today: 2 })] }))).toBe("No pin needed: today's hours are done.")
    expect(why(feed({ pace: [onTrack()] }), SAT)).toBe('No pin needed: on track, and paid hours count on business days only.')
    expect(why(feed({ pace: [paceRow('behind')] }))).toBe('Pinned for you: behind, this needs 2.4 h a day and 1.5 is paid, and it is due Mon Nov 30.')
    expect(why(feed({ pace: [paceRow('overbooked')] }))).toBe("Pinned for you: overbooked, this needs 2.4 h a day and 1.5 is paid, it is due Mon Nov 30, and you don't have the hours across your clients.")
    expect(why(feed({ pace: [paceRow('late')] }))).toBe('Pinned for you: late, 3 h of quoted work are past Mon Nov 30.')
    expect(why(founder({ tickets: { undated: [undatedRow()] } }))).toBe('No pin needed: nothing of yours here has a due date.')
    expect(why(feed({ tickets: { start_now: [ticket(1, NOV_9, { start_by_at: iso(NOW - 26 * H) })] } }))).toBe('Pinned for you: your task "Build the intake form" is due Mon 3 PM, and to land on time its work had to start Tue 1 PM.')
    // `Pinned` exactly when the thread pins, whichever status names it
    const fixtures: Array<[Feed, number]> = [
      ...(['behind', 'overbooked', 'late'] as const).flatMap(s => [[feed({ pace: [paceRow(s)] }), NOW]] as Array<[Feed, number]>),
      [feed({ pace: [onTrack()] }), NOW], [feed({ pace: [onTrack()] }), SAT], [feed({ pace: [onTrack({ hours_logged_today: 9 })] }), NOW],
      [feed({ pace: [onTrack({ hours_logged_today: 9 })], tickets: { due_soon: [ticket(1, NOW + 4 * H)] } }), NOW],
      [feed({ pace: [onTrack({ hours_logged_today: 9 })], mail: [mail(1, NOW - H)] }), NOW],
      [founder({ tickets: { undated: [undatedRow()] } }), NOW],
      [feed({ tickets: { due_soon: [ticket(1, NOW + 50 * H)] }, pace: [onTrack({ hours_logged_today: 9 })] }), NOW],
    ]
    for (const [f, now] of fixtures) for (const it of all(f, now)) expect(pinReason(it, now).startsWith('Pinned'), pinReason(it, now)).toBe(pinsFor(it, now))
    // the band's line, and the person's own pin beside an hours-done client
    expect(threadWhy(one(feed({ pace: [onTrack({ hours_logged_today: 2 })] })), ACME, NOW, { person: true })).toBe("No pin needed: today's hours are done. You pinned it yourself, so it stays until you unpin it.")
    expect(threadWhy(one(feed({ pace: [onTrack()] })), ACME, NOW, { again: true })).toBe("Pinned for you: on track, 1.5 h a day is paid and today's hours can't be read right now. You took its pin off, and it still needs you.")
  })

  test('S8 (the rest of the bridge, for a client listed by its pace alone): a row with a real line of what waits, Start offered, never an update by itself, a kickoff that promises nothing', () => {
    const it = one(feed({ pace: [paceRow('behind')] }))
    expect(it.kind).toBe('pace')
    expect(waitingText(it)).toBe('behind')
    expect(waitingText(one(feed({ pace: [onTrack()] })))).toBe('on track')
    expect(rowExtra(it)).toBe('')
    expect(mayStart(it, undefined, NOW)).toBe(true)
    expect(autoUpdatable(it, NOW)).toBe(false)
    expect(withTeammate(it)).toBe(false)
    const text = kickoffText(it)
    expect(text).toContain(`[mm-link ${P(1)}]`)
    expect(text).toContain('quoted work left')
    expect(text).toContain('Send nothing without my go')
    expect(text).not.toContain('committed task')
    // the kickoff is what a thread's "has it" is compared by: pace moving by the day is nothing new
    expect(signatureOf(one(feed({ pace: [paceRow('overbooked', { need_per_day: 9, date: iso(NOV_9) })] })))).toBe(signatureOf(it))
    // an item an older bridge stored has none of this
    const old = { ...it } as Partial<QueueItem>
    delete old.pace
    expect(paceOf(old as QueueItem)).toBeNull()
    expect(paceOf({ pace: { state: 'nope' } as never })).toBeNull()
  })

  test('S9 (OW #638): a package that owes no reply and has nothing to send lists as a prepared one does, opens at pickup and reads `no reply needed, one go closes it`; an absent key changes nothing', () => {
    const noReply = (over: Partial<FeedDraft> = {}): FeedDraft => pkg(1, { no_reply: true, drafts_ready: 0, drafts_unsent: 0, due_at: iso(NOW + 5 * H), ...over })
    // with the client's message still unanswered beside it: dropped until now, so it pinned as a reply with its clock
    const it = one(feed({ drafts: [noReply()], mail: [mail(1, NOW - 2 * H, { reply_due_at: iso(NOW + 20 * H) })] }))
    expect(it.kind).toBe('ready')
    expect(it.packageId).toBe(P(201))
    expect(it.dueAt).toBe(NOW + 5 * H)
    expect(pinsFor(it, NOW)).toBe(true)
    expect(NO_REPLY_WHAT).toBe('no reply needed, one go closes it')
    expect(titleFor(it, NOW)).toBe(`🔴 5h left · ${ACME} · no reply needed, one go closes it`)
    expect(rowLine(it, NOW)).toBe(`🔴 ${ACME} · no reply needed, one go closes it · 5h left`)
    expect(waitingText(it)).toContain('no reply needed, one go closes it')
    expect(waitingText(it)).not.toContain('draft')
    expect(draftsLine(it)).not.toContain('No reply drafts are prepared')
    expect(pinReason(it, NOW)).toBe(`Pinned for you, due 8 PM (5h left): ${ACME} is owed no reply, and one go closes it.`)
    // the holder's, whoever owns the client
    const held = one(feed({ drafts: [noReply({ status: 'picked_up', picked_up_by: ME, project_owner_email: ASIF })] }))
    expect(held.packageId).toBe(P(201))
    expect(titleFor(held, NOW)).toContain(NO_REPLY_WHAT)
    expect(waitingText(held)).toBe(NO_REPLY_WHAT)
    // a teammate's is not the viewer's, as a prepared package would not be
    expect(buildLists(feed({ drafts: [noReply({ project_owner_email: ASIF })] }), NOW).queue).toEqual([])
    // ⛔ the key absent or false: a package with no draft is dropped, as before, and the client's message lists as a reply
    for (const over of [{ no_reply: false }, {}]) {
      expect(all(feed({ drafts: [pkg(1, { drafts_ready: 0, drafts_unsent: 0, ...over })] }))).toEqual([])
    }
    const plain = one(feed({ drafts: [pkg(1, { drafts_ready: 0, drafts_unsent: 0 })], mail: [mail(1, NOW - 2 * H)] }))
    expect([plain.kind, plain.packageId]).toEqual(['reply', null])
    // and a package with drafts ready reads as it always did
    expect(titleFor(one(feed({ drafts: [pkg(1, { due_at: iso(NOW + 5 * H) })] })), NOW)).toBe(`🔴 5h left · ${ACME} · reply ready`)
  })
})

// ============================================================================================================================
// (0.7.32, Rob 2026-11-06) "Panels: a ticket with no due date never pins and never asks for a date, for anyone. It goes back
// under the closed No due date toggle, so it's still one press away." And: "a ticket's age no longer matters if no-date
// tickets never pin." Over his call of 2026-11-05 that shipped in 0.7.27 (`needs a due date`). ⛔ From OW's next release a
// teammate's and a PM's feed send `tickets.undated` as well, so the rules below hold for all three.
// ============================================================================================================================
describe('0.7.32: a ticket with no due date never pins and never asks for a date, for anyone', () => {
  const H9 = 'h9@example.com'
  const VIEWERS: ReadonlyArray<readonly [string, string, string]> = [['the founder', ROB, 'founder'], ['a teammate', ME, 'builder'], ['the PM', H9, 'pm']]
  const as = (who: string, role: string, over: Partial<Feed> = {}): Feed => feed({ member: who, role, ...over })
  /** The viewer's own undated client ticket, as `tickets.undated` lists it. */
  const noDate = (who: string, n = 0, over: Partial<FeedTicket> = {}): FeedTicket => ticket(1, null, { ticket_id: P(150 + n), title: `Not dated ${n}`, assignee_email: who, ...over })
  const paceBehind = (who: string): FeedPace => ({ project_id: P(1), project_name: `${ACME} — Jeff`, holder_email: who, state: 'behind', need_per_day: 2.4, paid_per_day: 1.5, hours_left: 20, hours_short: 3, date: iso(NOW + 300 * H), date_kind: 'ticket' })
  const etaAsk = (who: string): FeedTicket => ({ ...ticket(1, null, { ticket_id: P(102), assignee_email: who }), eta_needed_by: iso(NOW + 3 * H), eta_ask: 'no ETA' })

  for (const [name, who, role] of VIEWERS) {
    test(`${name}: a client with no-date tickets alone does not pin, is under the toggle, offers no Start and updates nothing`, () => {
      const it = one(as(who, role, { tickets: { undated: [noDate(who), noDate(who, 1)] } }))
      expect(pinsFor(it, NOW)).toBe(false)
      expect(noDateGroup(it)).toBe(true)
      expect(needsYouNow(it)).toBe(false)
      expect(mayStart(it, undefined, NOW)).toBe(false)
      expect(autoUpdatable(it, NOW)).toBe(false)
      expect(checkNow(it, NOW)).toBeNull()
      expect(statusOf(it, NOW)).toBeNull()
      expect([it.tasks, undatedCount(it), committedCount(it)]).toEqual([2, 2, 0])
      expect(titleFor(it, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
      expect(pinTitle(it, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
      expect(rowLine(it, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
      expect(pinReason(it, NOW)).toBe('No pin needed: nothing of yours here has a due date.')
      // a message from the client in the last six weeks offers Start with or without them (0.7.11): never the tickets themselves
      expect(mayStart(it, NOW - H, NOW)).toBe(true)
    })

    test(`${name}: a dated ticket beside them pins by itself, and the counts stay right`, () => {
      const tickets = (dueIn: number) => ({ due_soon: [ticket(1, NOW + dueIn * H, { assignee_email: who })], undated: [noDate(who), noDate(who, 1)] })
      const near = one(as(who, role, { tickets: tickets(4) }))
      expect(pinsFor(near, NOW)).toBe(true)
      expect(titleFor(near, NOW)).toBe(`🔴 4h left · ${ACME} · task`)
      expect([near.tasks, undatedCount(near), committedCount(near)]).toEqual([3, 2, 1])
      expect(waitingText(near)).toBe('1 task due, 2 tasks with no date')
      expect(noDateGroup(near)).toBe(false)
      expect(needsYouNow(near)).toBe(true)
      // due further out it pins by nothing, on the list by its own clock
      const far = one(as(who, role, { tickets: tickets(50) }))
      expect(pinsFor(far, NOW)).toBe(false)
      expect(titleFor(far, NOW)).toBe(`🟡 2d left · ${ACME} · task`)
      expect(noDateGroup(far)).toBe(false)
    })

    test(`${name}: an undated ticket older than the cut is still listed under the toggle`, () => {
      const ancient = { ...noDate(who), last_activity_at: '2026-01-05', created_at: '2026-01-05T12:00:00Z' } as FeedTicket
      const f = as(who, role, { tickets: { undated: [ancient] } })
      const it = one(f)
      expect(noDateGroup(it)).toBe(true)
      expect(pinsFor(it, NOW)).toBe(false)
      // the cut clears nothing here, so a client with nothing else open is not read as cleared by it
      expect([...pastCutClients(f, NOW)]).toEqual([])
      // whatever a row says of its last activity, each one counts, and none of them pins
      const both = one(as(who, role, { tickets: { undated: [ancient, { ...noDate(who, 1), last_activity_at: iso(NOW - H).slice(0, 10) } as FeedTicket] } }))
      expect(both.tasks).toBe(2)
      expect(pinsFor(both, NOW)).toBe(false)
      // the client's move: the existing skip, whatever its age
      expect(all(as(who, role, { tickets: { undated: [{ ...ancient, waiting_on: 'client' }] } }))).toEqual([])
      // (0.7.31, Rob 11-06: "It shouldn't be prompting me to do anything") the owner picks it up when ready: it reads as any undated ticket
      const whenReady = one(as(who, role, { tickets: { undated: [{ ...noDate(who), waiting_on: 'owner_when_ready' } as FeedTicket] } }))
      expect(pinsFor(whenReady, NOW)).toBe(false)
      expect(noDateGroup(whenReady)).toBe(true)
    })

    test(`${name}: a message, a package, an ETA ask or anything else beside them reads as it does without them`, () => {
      const reply = (over: Partial<FeedMail> = {}) => mail(1, NOW - 4 * H, { reply_due_at: iso(NOW + 20 * H), project_owner_email: who, ...over })
      const held = (by: string) => pkg(1, { status: 'picked_up', picked_up_by: by, picked_up_at: iso(NOW - H), project_owner_email: who, due_at: iso(NOW + 20 * H) })
      const scenarios: Record<string, Partial<Feed>> = {
        'a message': { mail: [reply()] },
        'a message due further out': { mail: [reply({ reply_due_at: iso(NOW + 50 * H) })] },
        'a message with no clock': { mail: [reply({ reply_due_at: null })] },
        'a package': { mail: [reply()], drafts: [pkg(1, { project_owner_email: who, due_at: iso(NOW + 20 * H) })] },
        'a package the viewer holds': { drafts: [held(who)] },
        'a reply a teammate holds': { mail: [reply()], drafts: [held(ASIF)] },
        'an ETA ask': { tickets: { due_today: [etaAsk(who)] } },
        'a late ETA ask': { tickets: { overdue: [{ ...etaAsk(who), eta_needed_by: iso(NOW - 3 * H) }] } },
        'an owner ask': { tickets: { due_today: [ticket(1, NOW + 3 * H, { ticket_id: P(103), assignee_email: who, commitment_basis: 'assign_by' })] } },
        'a dated task': { tickets: { due_soon: [ticket(1, NOW + 4 * H, { assignee_email: who })] } },
        'an internal ask': { asks: [{ ask_id: P(300), project_id: P(1), project_name: `${ACME} — Jeff`, asker_name: 'Asif', asker_email: ASIF, asked_email: who, asked_at: iso(NOW - H), due_at: iso(NOW + 5 * H) }] },
        'a go': { projects: [{ project_id: P(1), name: `${ACME} — Jeff`, followups: { go_steps: 2, go_package_id: P(50), go_first_at: iso(NOW + 72 * H), go_first_kind: 'client_sms', go_by: who } }] },
        "a teammate's go": { projects: [{ project_id: P(1), name: `${ACME} — Jeff`, followups: { go_steps: 2, go_package_id: P(50), go_first_at: iso(NOW + 3 * H), go_first_kind: 'client_sms', go_by: ASIF } }] },
        'a pace row': { pace: [paceBehind(who)] },
      }
      const read = (f: Feed) => {
        const l = buildLists(f, NOW)
        const it = [...l.queue, ...l.teammate, ...l.checking][0]
        if (!it) return null
        return {
          list: l.teammate.includes(it) ? 'teammate' : l.queue.includes(it) ? 'queue' : 'checking', kind: it.kind, due: it.dueAt, pins: pinsFor(it, NOW), toggle: noDateGroup(it), needsYou: needsYouNow(it), start: mayStart(it, undefined, NOW),
          auto: autoUpdatable(it, NOW), name: titleFor(it, NOW), pinned: pinTitle(it, NOW), row: rowLine(it, NOW), why: pinReason(it, NOW), signature: signatureOf(it),
        }
      }
      for (const [what, over] of Object.entries(scenarios)) {
        const without = read(as(who, role, over))
        const beside = read(as(who, role, { ...over, tickets: { ...over.tickets, undated: [noDate(who)] } }))
        // a teammate's go that is nothing to the viewer lists nothing without them, and then they stand alone
        if (without === null) expect(beside?.toggle, what).toBe(true)
        else expect(beside, what).toEqual(without)
      }
    })

    test(`${name}: an ETA ask stays an ETA ask, and a ticket on both lists counts once, as the ask`, () => {
      const it = one(as(who, role, { tickets: { due_today: [etaAsk(who)], undated: [noDate(who)] } }))
      expect(etaAsksOf(it).map(a => a.id)).toEqual([P(102)])
      expect(pinsFor(it, NOW)).toBe(true)
      expect(titleFor(it, NOW)).toBe(`🔴 3h left · ${ACME} · ETA needed`)
      expect([it.tasks, undatedCount(it)]).toEqual([2, 1])
      expect(noDateGroup(it)).toBe(false)
      const twice = one(as(who, role, { tickets: { due_today: [etaAsk(who)], undated: [noDate(who, 0, { ticket_id: P(102) })] } }))
      expect([twice.tasks, undatedCount(twice), twice.undatedTasks ?? 0]).toEqual([1, 0, 0])
      expect(titleFor(twice, NOW)).toBe(`🔴 3h left · ${ACME} · ETA needed`)
    })

    test(`${name}: a package that is not the viewer's lists nothing by itself, so it takes nothing out from under the toggle`, () => {
      const packages: FeedDraft[] = [
        // their own stale one (M1: a stale package alone lists nothing)
        pkg(1, { status: 'stale', project_owner_email: who, due_at: iso(NOW + 50 * H) }),
        // one a teammate holds, due further out than anyone checks on it
        pkg(1, { status: 'picked_up', picked_up_by: ASIF, picked_up_at: iso(NOW - H), project_owner_email: who, due_at: iso(NOW + 50 * H) }),
      ]
      for (const d of packages) {
        const it = one(as(who, role, { drafts: [d], tickets: { undated: [noDate(who)] } }))
        expect(undatedOnly(it), d.status).toBe(true)
        expect(noDateGroup(it), d.status).toBe(true)
        expect(withTeammate(it), d.status).toBe(false)
        expect(pinsFor(it, NOW), d.status).toBe(false)
        expect(mayStart(it, undefined, NOW), d.status).toBe(false)
        expect(autoUpdatable(it, NOW), d.status).toBe(false)
      }
    })

    test(`${name}: a teammate's row in the list goes nowhere, and neither \`holder_pin\` nor a start-by pins an undated row`, () => {
      expect(all(as(who, role, { tickets: { undated: [noDate(ASIF)] } }))).toEqual([])
      expect(all(as(who, role, { tickets: { undated: [{ ...noDate(ASIF), holder_pin: true } as FeedTicket] } }))).toEqual([])
      const own = one(as(who, role, { tickets: { undated: [{ ...noDate(who), holder_pin: true } as FeedTicket] } }))
      expect(pinsFor(own, NOW)).toBe(false)
      expect(checkNow(own, NOW)).toBeNull()
      expect(noDateGroup(own)).toBe(true)
      const started = one(as(who, role, { tickets: { undated: [noDate(who, 0, { start_by_at: iso(NOW - 26 * H) })] } }))
      expect(pinsFor(started, NOW)).toBe(false)
      expect(statusOf(started, NOW)).toBeNull()
      expect(titleFor(started, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
    })
  }

  test('what pins beside them is never hidden under the closed toggle: a go with no date, a pace row; (0.7.34) a teammate\'s late ticket no longer pins the PM', () => {
    const pm = one(as(H9, 'pm', { tickets: { overdue: [ticket(1, NOW - 3 * H, { ticket_id: P(105), assignee_email: ASIF })], undated: [noDate(H9)] } }))
    expect(pinsFor(pm, NOW)).toBe(false)
    expect(noDateGroup(pm)).toBe(true)
    const go = one(as(ME, 'builder', { tickets: { undated: [noDate(ME)] }, projects: [{ project_id: P(1), name: `${ACME} — Jeff`, followups: { go_steps: 2, go_package_id: P(50), go_first_at: null, go_first_kind: 'client_sms', go_by: ME } }] }))
    expect(pinsFor(go, NOW)).toBe(true)
    expect(noDateGroup(go)).toBe(false)
    const paced = one(as(ME, 'builder', { tickets: { undated: [noDate(ME)] }, pace: [paceBehind(ME)] }))
    expect(pinsFor(paced, NOW)).toBe(true)
    expect(noDateGroup(paced)).toBe(false)
  })

  test('nothing says `needs a due date`, and an item an older bridge stored with `needsDate` reads as any other', () => {
    const it = one(as(ROB, 'founder', { tickets: { undated: [noDate(ROB)] } }))
    for (const text of [titleFor(it, NOW), threadTitle(it, NOW), pinTitle(it, NOW), rowLine(it, NOW), pinReason(it, NOW), threadWhy(it, ACME, NOW), waitingText(it), kickoffText(it), noteText(it, ROB), clientMarkdown(it, NOW)]) {
      expect(text).not.toContain('needs a due date')
      expect(text).not.toContain('needs one')
    }
    const stored = JSON.parse(JSON.stringify({ ...it, needsDate: 3 })) as QueueItem
    expect(pinsFor(stored, NOW)).toBe(false)
    expect(statusOf(stored, NOW)).toBeNull()
    expect(noDateGroup(stored)).toBe(true)
    expect(titleFor(stored, NOW)).toBe(`🟡 ${ACME} · task · no due date`)
  })

  type Row = { projectId: string }
  type Queue = { header: string; rows: Row[]; undated?: Row[]; teammate?: Row[] }
  const ids = (rows: Row[] | undefined) => (rows ?? []).map(r => r.projectId)

  test('on a thread: a pin 0.7.27 put on one comes off and the name goes, for all three, and the row is under `No due date`, not `Needs you now`', async () => {
    for (const [name, who, role] of VIEWERS) {
      const w = fakeApp(as(who, role, { tickets: { undated: [noDate(who)] } }), [{ sessionId: 'local_hub', title: 'Hub' }, { sessionId: 'local_c1', title: `🟡 ${ACME} · needs a due date`, pinned: true }], [], { now: NOW })
      w.put('mm.links', { [P(1)]: 'local_c1' })
      w.put('mm.pins', { local_c1: { projectId: P(1), client: ACME, byUs: true } })
      await mm(w.session('local_hub'), '')
      expect(w.app.get('local_c1'), name).toMatchObject({ pinned: false, title: `🟡 ${ACME} · task · no due date` })
      const q = w.view('local_hub', 'queue') as Queue
      expect(q.header, name).toBe('Nothing needs you right now.')
      expect(ids(q.rows), name).toEqual([])
      expect(ids(q.undated), name).toEqual([P(1)])
    }
  })

  test('on the page: a reply a teammate holds beside them stays under With a teammate; the founder, whose page has no such part, finds the client under `No due date`', async () => {
    for (const [name, who, role] of VIEWERS) {
      const f = as(who, role, {
        mail: [mail(1, NOW - 4 * H, { reply_due_at: iso(NOW + 20 * H), project_owner_email: who })],
        drafts: [pkg(1, { status: 'picked_up', picked_up_by: ASIF, picked_up_at: iso(NOW - H), project_owner_email: who, due_at: iso(NOW + 20 * H) })],
        tickets: { undated: [noDate(who)] },
      })
      const w = fakeApp(f, [{ sessionId: 'local_hub', title: 'Hub' }], [], { now: NOW })
      await mm(w.session('local_hub'), '')
      const q = w.view('local_hub', 'queue') as Queue
      expect(ids(q.rows), name).toEqual([])
      expect(ids(q.teammate), name).toEqual(role === 'founder' ? [] : [P(1)])
      expect(ids(q.undated), name).toEqual(role === 'founder' ? [P(1)] : [])
    }
  })
})
