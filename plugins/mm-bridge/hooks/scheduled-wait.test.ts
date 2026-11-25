// The bridge against a pretend desktop app, feed and store: a linked thread that waits only on a scheduled run (0.7.70).
//
// Rob, 2026-11-24: "When we're waiting for a scheduled run before something needs me again, it should probably unpin and then
// only repin after the run goes or it fails. This is something that could help clear up my pin list and everybody else's
// system-wide." Then, the same day: "If something is not running properly, it's supposed to pin itself ... But if everything I
// need to do is already scheduled and we're waiting for the send to know that it's been fixed, I think we can unpin until we
// know there's an issue again that I need to do something with."
//
// So the thread declares it through the mm tool (`waiting scheduled <when>[, <when>] ticket <id> -- <what>`), and the bridge
// takes its own pin off and keeps it off, whatever the feed has due for the client then, until a run's result needs the person
// (anything new for the client) or a run has not noted its ticket within 2 hours of its time. The 2 hours are Claude's
// recommendation in the build, not Rob's number. Every client below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Feed } from './queue'
import {
  RUN_GRACE_MS, RUN_WAIT_REFUSED, RUN_WAIT_TOOL_TEXT, baselineOf, newSince, reportedAt, runMissedTitle, runState, runTime, runWaitArgs,
  runWaitNoted, runWaitNotedUnlinked, runWaitSuffix, runWaitWhy, runWaitsOf,
} from './threads'
import type { PinReport, RunWait } from './threads'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, HOUR, LONG, ACME, ME, SELF, feed, world, tool, tickOnce, minutesOn, ago } from './register-world.test-helper'

const MIN = 60_000
const RUN_TICKET = 'c3710000-0000-4000-8000-000000000001'
const TASK = 'aa000000-0000-4000-8000-000000000001'
const SHORT_TASK = 'aa000000-0000-4000-8000-000000000002'
/** NOW is Monday 2026-10-12 11:00 New York time (15:00Z). */
const ET = (hhmm: string) => `2026-10-12 ${hhmm}`
const task = (id: string, dueIn: number, created: string, title = 'Day-one launch check') => ({
  ticket_id: id, project_id: ACME, project_name: 'Acme Roofing — Pat', title, due_at: new Date(NOW + dueIn).toISOString(), due_source: 'commitment', assignee_email: ME, created_at: created,
})
/** Acme has one committed task due in 5 hours: the feed pins its thread. Nothing else is on the feed. */
const committed = (extra: ReturnType<typeof task>[] = []): Feed =>
  feed({ drafts: [], mail: [], tickets: { due_today: [task(TASK, 5 * HOUR, ago(24)), ...extra] }, projects: [{ project_id: ACME, name: 'Acme Roofing — Pat' }] } as Partial<Feed>)
/** Nothing on the feed for anyone. */
const silent = (): Feed => feed({ drafts: [], mail: [], tickets: {}, projects: [{ project_id: ACME, name: 'Acme Roofing — Pat' }] } as Partial<Feed>)
const linked = { 'mm.links': { [ACME]: SELF } }
type W = ReturnType<typeof world>
const pinnedHere = (w: W) => w.threads.get(SELF)?.pinned === true
const titleHere = (w: W) => w.threads.get(SELF)?.title ?? ''
const pinRecord = (w: W) => (w.stored['mm.pins'] as Record<string, Record<string, unknown>> | undefined)?.[SELF]
const waitHere = (w: W) => (w.stored['mm.runwait'] as Record<string, RunWait> | undefined)?.[SELF]
const settle = async (w: W) => w.clock.advance(2_000)
/** A ticket whose notes are whatever `notes.text` holds when it is read. */
const ticketWith = (notes: { text: string | 'network' }) => (url: string) =>
  notes.text === 'network' ? ('network' as const) : url.includes(RUN_TICKET) ? { status: 200, body: { ok: true, ticket: { ticket_id: RUN_TICKET, resolution_notes: notes.text } } } : { status: 404, body: { error: 'Ticket not found.' } }
const note = (at: number, text: string) => `[${new Date(at).toISOString()}] agent@example.com: note — ${text}`
const acmeWorld = (on: On, over: WorldOptions = {}) => world(on, { feed: committed(), ...over, store: { ...linked, ...(over.store ?? {}) } })
const declare = ($: Parameters<typeof tool>[0], when: string) => tool($, `waiting scheduled ${when} ticket ${RUN_TICKET} -- the day-one launch check`)

describe('0.7.70: what the thread says, as the bridge reads it', () => {
  test('runTime: New York wall time (EDT and EST), an ISO time with its offset; anything else is not a time', () => {
    expect(runTime('2026-10-12 14:00')).toBe(Date.parse('2026-10-12T18:00:00Z'))
    expect(runTime('2026-11-25 16:15 ET')).toBe(Date.parse('2026-11-25T21:15:00Z'))
    expect(runTime('2026-11-25T21:15:00Z')).toBe(Date.parse('2026-11-25T21:15:00Z'))
    expect(runTime('2026-11-25T16:15-05:00')).toBe(Date.parse('2026-11-25T21:15:00Z'))
    // no offset: New York time, as with a space
    expect(runTime('2026-11-25T16:15')).toBe(Date.parse('2026-11-25T21:15:00Z'))
    for (const bad of ['tomorrow 4 PM', '2026-11-25', '2026-02-30 10:00', '2026-11-25 25:00', '2026-11-25 16:15 PT']) expect(runTime(bad)).toBeNaN()
  })

  test('runWaitArgs: the runs in order, the ticket and what they check; refused in one line otherwise', () => {
    expect(runWaitArgs(`scheduled ${ET('16:15')}, ${ET('14:00')} ticket ${RUN_TICKET.toUpperCase()} -- Day one and day three`, NOW)).toEqual({
      runs: [runTime(ET('14:00')), runTime(ET('16:15'))], ticket: RUN_TICKET, what: 'Day one and day three',
    })
    const bad = [
      `scheduled ${ET('14:00')} -- no ticket`,
      `scheduled ${ET('14:00')} ticket c371d9ef -- a short id`,
      `scheduled ${ET('14:00')} ticket ${RUN_TICKET} --`,
      `scheduled ${ET('08:30')} ticket ${RUN_TICKET} -- more than 2 hours ago`,
      `scheduled 2026-10-27 09:00 ticket ${RUN_TICKET} -- more than 14 days out`,
      `scheduled ${['12:00', '12:10', '12:20', '12:30', '12:40', '12:50', '13:00'].map(ET).join(', ')} ticket ${RUN_TICKET} -- seven runs`,
      `scheduled soon ticket ${RUN_TICKET} -- no time`,
    ]
    for (const b of bad) expect(runWaitArgs(b, NOW)).toBe(RUN_WAIT_REFUSED)
    expect(RUN_WAIT_REFUSED).not.toContain('\n')
    expect(RUN_WAIT_TOOL_TEXT).toContain('waiting scheduled')
  })

  test('runState: waiting for the next run, missed 2 hours after it with no report, done once every run reported', () => {
    const w = { at: NOW, runs: [{ at: NOW + HOUR }, { at: NOW + 3 * HOUR }] }
    expect(runState(w, NOW)).toEqual({ kind: 'waiting', due: NOW + HOUR })
    expect(runState(w, NOW + HOUR + RUN_GRACE_MS - 1)).toEqual({ kind: 'waiting', due: NOW + HOUR })
    expect(runState(w, NOW + HOUR + RUN_GRACE_MS)).toEqual({ kind: 'missed', due: NOW + HOUR, since: NOW + HOUR + RUN_GRACE_MS })
    // a later run's report never stands for an earlier one's
    expect(runState({ at: NOW, runs: [{ at: NOW + HOUR }, { at: NOW + 3 * HOUR, seen: NOW + 4 * HOUR }] }, NOW + 6 * HOUR).kind).toBe('missed')
    expect(runState({ at: NOW, runs: [{ at: NOW + HOUR, seen: NOW + HOUR + MIN }] }, NOW + 9 * HOUR)).toEqual({ kind: 'done', last: NOW + HOUR })
  })

  test('reportedAt: the first OW note stamped at or after the run; none before it counts', () => {
    const notes = [note(NOW - HOUR, 'set up the checks'), note(NOW + 20 * MIN, 'Day one check: on plan'), note(NOW + 2 * HOUR, 'later')].join('\n')
    expect(reportedAt(notes, NOW)).toBe(NOW + 20 * MIN)
    expect(reportedAt(notes, NOW + 3 * HOUR)).toBeUndefined()
    expect(reportedAt(null, NOW)).toBeUndefined()
    expect(reportedAt('no stamps here', NOW)).toBeUndefined()
  })

  test('newSince: a newer message, package or task, or a ticket of the viewer\'s that opens or reopens; nothing else', () => {
    const it = { newest: { mail: 10, pkg: 0, task: 20 }, taskIds: [TASK] }
    const base = baselineOf(it)
    expect(base).toEqual({ mail: 10, pkg: 0, task: 20, ids: [TASK] })
    expect(newSince(it, base)).toBe(false)
    expect(newSince({ ...it, newest: { ...it.newest, mail: 11 } }, base)).toBe(true)
    expect(newSince({ ...it, newest: { ...it.newest, pkg: 1 } }, base)).toBe(true)
    expect(newSince({ ...it, newest: { ...it.newest, task: 21 } }, base)).toBe(true)
    // a ticket created before the wait that reopens for the viewer (a watchdog's): new by its id
    expect(newSince({ ...it, taskIds: [TASK, SHORT_TASK] }, base)).toBe(true)
    // the covered ticket closing is nothing new
    expect(newSince({ ...it, taskIds: [] }, base)).toBe(false)
    expect(newSince(undefined, base)).toBe(false)
  })

  test('runWaitsOf: a damaged entry is none', () => {
    const good = { what: 'x', ticket: RUN_TICKET, at: NOW, runs: [{ at: NOW + HOUR }], base: { mail: 0, pkg: 0, task: 0, ids: [] } }
    expect(runWaitsOf({ local_a: good, local_b: { ...good, ticket: 'c371d9ef' }, local_c: { ...good, runs: [] }, local_d: { ...good, runs: [{ at: 'soon' }] }, nope: good })).toEqual({ local_a: good })
    expect(runWaitsOf(null)).toEqual({})
  })

  test('the words: what it answers, the end of the name, the band\'s sentences', () => {
    const w = { what: 'the day-one launch check', ticket: RUN_TICKET, runs: [{ at: runTime(ET('14:00')) }] }
    expect(runWaitNoted(w)).toBe(`Recorded: this thread waits on a scheduled run (Mon, Oct 12 2 PM ET), each noting ticket c3710000. The bridge takes its own pin off at its next sync and keeps it off until a run's result needs the person (anything new for this client) or a run has not noted the ticket within 2 hours of its time; then it pins the thread again. "waiting clear" takes it back.`)
    expect(runWaitSuffix({ kind: 'waiting', due: runTime(ET('14:00')) }, NOW)).toBe('waits on a run 2 PM')
    expect(runWaitSuffix({ kind: 'waiting', due: runTime('2026-10-15 16:15') }, NOW)).toBe('waits on a run Thu 4:15 PM')
    expect(runWaitSuffix({ kind: 'missed', due: NOW, since: NOW + RUN_GRACE_MS }, NOW)).toBe('run missed')
    expect(runWaitWhy(w, { kind: 'missed', due: runTime(ET('14:00')), since: 0 })).toBe('Pinned for you: a scheduled run (the day-one launch check) was due Mon, Oct 12 2 PM ET and has not noted ticket c3710000 since. Check that it ran.')
    expect(runWaitWhy(w, { kind: 'waiting', due: runTime(ET('14:00')) })).toBe('No pin needed until a scheduled run reports: the day-one launch check, due Mon, Oct 12 2 PM ET. It is pinned again if its result needs you or it has not noted ticket c3710000 by Mon, Oct 12 4 PM ET.')
    expect(runMissedTitle('Acme Roofing')).toBe('🔴 Acme Roofing · run missed')
  })
})

describe('0.7.70: a thread that waits only on a scheduled run is unpinned until the run needs the person (Rob, 2026-11-24)', () => {
  test('unpinned: the feed pins it for a task due in 5 hours; the wait takes the bridge\'s pin off and keeps it off', LONG, async ($, on) => {
    const w = acmeWorld(on, { bridgePins: () => ({ status: 200, body: { ok: true } }) })
    await tickOnce($, w)
    expect(pinnedHere(w)).toBe(true)
    expect(await declare($, ET('14:00'))).toBe(runWaitNoted({ runs: [{ at: runTime(ET('14:00')) }], ticket: RUN_TICKET }))
    expect(waitHere(w)?.base.ids).toEqual([TASK])
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    expect(titleHere(w).endsWith(' · waits on a run 2 PM')).toBe(true)
    expect(pinRecord(w)?.byUs).toBe(false)
    await minutesOn(w, 11)
    expect(pinnedHere(w)).toBe(false)
    // and the pin report does not count it as a client that should be pinned
    const sent = w.pinPosts.at(-1)?.body as PinReport | undefined
    expect(sent?.items.some(i => i.project_id === ACME)).toBe(false)
  })

  test('the person\'s own pin stays theirs: only the bridge\'s comes off', LONG, async ($, on) => {
    const w = acmeWorld(on, { self: { sessionId: SELF, title: 'Acme work', pinned: true, isArchived: false, lastActivityAt: ago(0) } })
    await tickOnce($, w)
    expect(pinRecord(w)?.byUs).toBe(false)
    await declare($, ET('14:00'))
    await settle(w)
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(true)
  })

  test('on plan: the run notes its ticket and nothing new comes of it; the thread stays unpinned', LONG, async ($, on) => {
    const notes = { text: note(NOW - 3 * HOUR, 'checks set up') }
    const w = acmeWorld(on, { ticketStatus: ticketWith(notes) })
    await tickOnce($, w)
    await declare($, ET('10:30'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    notes.text += `\n${note(NOW + 5 * MIN, 'Day one check: on plan. Nothing short; no fix owed.')}`
    await minutesOn(w, 6)
    expect(waitHere(w)?.runs[0]?.seen).toBe(NOW + 5 * MIN)
    expect(titleHere(w).endsWith(' · runs reported')).toBe(true)
    // past the grace and past the task's own due time: still not pinned
    await w.clock.advance(6 * HOUR)
    await minutesOn(w, 1)
    expect(pinnedHere(w)).toBe(false)
  })

  test('a result that needs the person: the run files a new ticket for them; the wait ends and the thread is pinned again', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await declare($, ET('14:00'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    w.setFeed(committed([task(SHORT_TASK, 2 * HOUR, new Date(NOW + MIN).toISOString(), 'Acme LinkedIn day one short: requests 0 of 5')]))
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(true)
    expect(waitHere(w)).toBeUndefined()
  })

  test('a watchdog\'s ticket that reopens for the person (created before the wait) ends it too', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await declare($, ET('14:00'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    w.setFeed(committed([task(SHORT_TASK, 2 * HOUR, ago(48), 'Seat watch: seat not running')]))
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(true)
    expect(waitHere(w)).toBeUndefined()
  })

  test('missed: no note 2 hours after the run, the feed pinning it too; named `run missed`; a late note unpins it again', LONG, async ($, on) => {
    const notes = { text: '' }
    const w = acmeWorld(on, { ticketStatus: ticketWith(notes) })
    await tickOnce($, w)
    // due 1 h 50 min ago: missed 10 minutes from now
    await declare($, ET('09:10'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    await minutesOn(w, 12)
    expect(pinnedHere(w)).toBe(true)
    expect(titleHere(w).endsWith(' · run missed')).toBe(true)
    expect(waitHere(w)).toBeDefined()
    notes.text = note(NOW + 15 * MIN, 'Day one check: on plan.')
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
    expect(titleHere(w).endsWith(' · runs reported')).toBe(true)
  })

  test('missed with nothing else on the feed: pinned as the bridge\'s on its own; the person\'s unpin after that stands', LONG, async ($, on) => {
    const w = world(on, { feed: silent(), store: linked, ticketStatus: () => 'network' })
    await tickOnce($, w)
    expect(pinnedHere(w)).toBe(false)
    await declare($, ET('09:10'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    // OW cannot be read: a run whose report cannot be read is unproven, and pinned once its grace is over
    await minutesOn(w, 12)
    expect(pinnedHere(w)).toBe(true)
    expect(titleHere(w)).toBe(runMissedTitle('Acme Roofing'))
    expect(pinRecord(w)).toEqual({ projectId: ACME, client: 'Acme Roofing', byUs: true, waiting: true })
    ;(w.threads.get(SELF) as { pinned: boolean }).pinned = false
    await minutesOn(w, 11)
    expect(pinnedHere(w)).toBe(false)
  })

  test('`waiting clear` takes it back: the feed pins the thread again', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await declare($, ET('14:00'))
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    await tool($, 'waiting clear')
    await settle(w)
    expect(waitHere(w)).toBeUndefined()
    expect(pinnedHere(w)).toBe(true)
  })

  test('a question for the person declared after it replaces it, and a wait replaces a question', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await declare($, ET('14:00'))
    await tool($, 'waiting send -- Send the recap?')
    expect(waitHere(w)).toBeUndefined()
    await declare($, ET('14:00'))
    expect((w.stored['mm.waiting'] as Record<string, unknown> | undefined)?.[SELF]).toBeUndefined()
    expect(waitHere(w)).toBeDefined()
  })

  test('a thread linked to no project (an internal thread of the person\'s own): it unpins itself; the bridge pins it once for a missed run, and takes that pin off when the note lands', LONG, async ($, on) => {
    const notes = { text: '' }
    const w = world(on, { feed: committed(), ticketStatus: ticketWith(notes), self: { sessionId: SELF, title: 'Seat watch fix', pinned: true, isArchived: false, lastActivityAt: ago(0) } })
    await tickOnce($, w)
    expect(await declare($, ET('09:10'))).toBe(runWaitNotedUnlinked({ runs: [{ at: runTime(ET('09:10')) }], ticket: RUN_TICKET }))
    expect(waitHere(w)?.project).toBeUndefined()
    // the thread's own unpin, as the answer tells it to
    ;(w.threads.get(SELF) as { pinned: boolean }).pinned = false
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(true)
    expect(titleHere(w)).toBe('Seat watch fix')
    expect(waitHere(w)?.repinned).toBeDefined()
    notes.text = note(NOW + 13 * MIN, 'Fix check: on plan.')
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
    expect(waitHere(w)).toBeUndefined()
  })

  test('a thread linked to no project: the person\'s unpin of the missed-run pin stands', LONG, async ($, on) => {
    const w = world(on, { feed: committed(), ticketStatus: () => ({ status: 404, body: {} }) })
    await tickOnce($, w)
    await declare($, ET('09:10'))
    await minutesOn(w, 12)
    expect(pinnedHere(w)).toBe(true)
    ;(w.threads.get(SELF) as { pinned: boolean }).pinned = false
    await minutesOn(w, 11)
    expect(pinnedHere(w)).toBe(false)
  })
})
