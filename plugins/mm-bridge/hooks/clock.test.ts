// (0.7.60, Rob approved 2026-11-19 ('Yes, all five')) "Only a client date turns a thread red": a date we gave a client, or a
// client message waiting on us, shows late; an internal clock (INTERNAL_CLOCK_BASES, or an owed ETA) pins as before and,
// past its time, reads `behind` (yellow), never red, never late (Rob 2026-11-19: "i dont want it to stop showbin behind").
// And one owner per client reply: the holder of a client's open package answers its mail and takes its ready row.
import { describe, expect, test } from 'claude-code/testing'

import {
  INTERNAL_CLOCK_BASES, buildLists, clientMarkdown, dueLine, etaMarkdown, isInternalClockBasis, isRed, pinReason, pinsFor, rowLine, statusOf, titleFor,
} from './queue'
import type { Feed, FeedTicket, QueueItem } from './queue'
import { itemTime, itemTone } from './team'
import { pinReport } from './threads'

// Wed 2026-11-18 11:00 AM ET: a business day, well past the list's floor.
const NOW = Date.parse('2026-11-18T16:00:00Z')
const HOUR = 3_600_000
const iso = (h: number): string => new Date(NOW + h * HOUR).toISOString()
const P1 = '11111111-1111-1111-1111-111111111111'
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ME = 'builder-a@massmarket.ai'

const ticket = (over: Partial<FeedTicket> = {}): FeedTicket => ({
  ticket_id: T1, project_id: P1, project_name: 'Acme Legal', title: 'Build the intake form', due_at: iso(3), due_source: 'commitment',
  assignee_email: ME, status: 'open', ...over,
})
const feedOf = (tickets: Feed['tickets'], over: Partial<Feed> = {}): Feed => ({ member: ME, role: 'builder', tickets, ...over })
const only = (f: Feed, now = NOW): QueueItem => {
  const items = buildLists(f, now).queue
  expect(items.length).toBe(1)
  return items[0] as QueueItem
}
const report = (it: QueueItem, now = NOW) =>
  pinReport({
    now, listed: [it], links: {}, thread: () => undefined, hidden: () => false, stayedOff: new Set(), capped: new Set(),
    byUs: () => true, client: () => undefined,
  }).items
/** Every surface a client's line is drawn on, joined. */
const surfaces = (it: QueueItem, now = NOW): string =>
  [titleFor(it, now), rowLine(it, now), rowLine(it, now, { fresh: true, pins: pinsFor(it, now) }), pinReason(it, now), dueLine(it, now), clientMarkdown(it, now)].join('\n')

describe('(0.7.60) the internal clock bases', () => {
  test('exactly eta_owed, assign_by and assigned_by_rob; team_move, none and free text are a client clock', () => {
    expect([...INTERNAL_CLOCK_BASES]).toEqual(['eta_owed', 'assign_by', 'assigned_by_rob'])
    for (const b of INTERNAL_CLOCK_BASES) expect(isInternalClockBasis(b)).toBe(true)
    for (const b of ['team_move', 'client_eta', 'call_package', 'eta_commit', 'package_move', 'volunteered', 'group_settled', 'our_outbound_named_date', '', null, undefined, 3]) {
      expect(isInternalClockBasis(b)).toBe(false)
    }
  })
})

describe('(0.7.60) only a client date turns a thread red', () => {
  test('1. an eta_owed ticket due in 3 business hours pins yellow, with no late text', () => {
    const it = only(feedOf({ due_today: [ticket({ commitment_basis: 'eta_owed' })] }))
    expect(pinsFor(it, NOW)).toBe(true)
    expect(isRed(it, NOW)).toBe(false)
    expect(titleFor(it, NOW).startsWith('🟡 3h left')).toBe(true)
    expect(rowLine(it, NOW, { fresh: true, pins: true }).startsWith('🟡')).toBe(true)
    expect(surfaces(it)).not.toMatch(/late|overdue/i)
    const [r] = report(it)
    expect(r?.tone).toBe('yellow')
    expect(r?.clock).toBe('internal')
    expect(r?.due_at).toBe(iso(3))
  })

  test('2. the same ticket 1 hour past due keeps pinning, yellow, as behind, with no late text', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'eta_owed', due_at: iso(-1) })] }))
    expect(pinsFor(it, NOW)).toBe(true)
    expect(isRed(it, NOW)).toBe(false)
    expect(statusOf(it, NOW)?.kind).toBe('behind')
    expect(statusOf(it, NOW)?.dot).toBe('🟡')
    expect(titleFor(it, NOW)).toBe('🟡 Acme Legal · behind · due 10 AM')
    expect(pinReason(it, NOW)).toBe('Pinned for you, behind since 10 AM: your task "Build the intake form".')
    expect(surfaces(it)).not.toMatch(/late|overdue|\d+[hd] /i)
    const [r] = report(it)
    expect(r).toEqual({ project_id: P1, client: 'Acme Legal', kind: 'behind', tone: 'yellow', due_at: iso(-1), pinned: false, why_not: 'no_thread', clock: 'internal' })
  })

  test('3. a client_eta ticket 1 hour past due is red and late, as before', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'client_eta', due_at: iso(-1) })] }))
    expect(isRed(it, NOW)).toBe(true)
    expect(titleFor(it, NOW)).toBe('🔴 1h late, due 10 AM · Acme Legal · task')
    const [r] = report(it)
    expect(r?.tone).toBe('red')
    expect(r?.clock).toBe('client')
  })

  test('4. a ticket with no basis past due is red and late, as before', () => {
    const it = only(feedOf({ overdue: [ticket({ due_at: iso(-1) })] }))
    expect(isRed(it, NOW)).toBe(true)
    expect(titleFor(it, NOW)).toMatch(/^🔴 1h late/)
    expect(report(it)[0]?.clock).toBe('client')
  })

  test('5. a free-text basis past due is red, as before', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'our_outbound_named_date', due_at: iso(-1) })] }))
    expect(isRed(it, NOW)).toBe(true)
    expect(titleFor(it, NOW)).toMatch(/^🔴 1h late/)
  })

  test('5b. a team_move ticket 1 hour past due is red and late: a teammate may have moved a date the client was told', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'team_move', due_at: iso(-1) })] }))
    expect(isRed(it, NOW)).toBe(true)
    expect(titleFor(it, NOW)).toBe('🔴 1h late, due 10 AM · Acme Legal · task')
    expect(report(it)[0]).toMatchObject({ tone: 'red', clock: 'client', kind: 'task' })
  })

  test('6. an owed ETA past its eta_needed_by keeps pinning, yellow, as behind, with no late text', () => {
    const it = only(feedOf({ overdue: [ticket({ due_at: null, due_source: null, eta_needed_by: iso(-1), eta_ask: '⏳ NO ETA — give one in Claude Code' })] }))
    expect(pinsFor(it, NOW)).toBe(true)
    expect(isRed(it, NOW)).toBe(false)
    expect(titleFor(it, NOW)).toBe('🟡 Acme Legal · behind · due 10 AM')
    expect(pinReason(it, NOW)).toBe('Pinned for you, behind since 10 AM: you owe an ETA on 1 ticket.')
    expect(etaMarkdown(it, NOW)).toContain('ETA was needed by 10 AM, behind')
    expect(surfaces(it)).not.toMatch(/late|overdue/i)
    expect(report(it)[0]).toMatchObject({ kind: 'behind', tone: 'yellow', clock: 'internal', due_at: iso(-1) })
  })

  test('an internal clock past due whose work has not started: yellow, behind, pinned', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'assigned_by_rob', due_at: iso(-1), start_by_at: iso(-5) })] }))
    expect(pinsFor(it, NOW)).toBe(true)
    expect(isRed(it, NOW)).toBe(false)
    const s = statusOf(it, NOW)
    expect(s?.kind).toBe('behind')
    expect(s?.dot).toBe('🟡')
    expect(titleFor(it, NOW)).toBe('🟡 Acme Legal · behind · not started, had to start 6 AM')
    expect(surfaces(it)).not.toMatch(/late|overdue/i)
    expect(report(it)[0]).toMatchObject({ kind: 'behind', tone: 'yellow', clock: 'internal' })
  })

  test('an internal clock due later today is yellow; a client clock due today beside it is still red', () => {
    const alone = only(feedOf({ due_today: [ticket({ commitment_basis: 'assign_by', due_at: iso(5) })] }))
    expect(isRed(alone, NOW)).toBe(false)
    const both = only(feedOf({ due_today: [ticket({ commitment_basis: 'eta_owed', due_at: iso(-1) }), ticket({ ticket_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', commitment_basis: 'client_eta', due_at: iso(4) })] }))
    expect(isRed(both, NOW)).toBe(true)
    // the client's clock leads the name: never the internal one's late count
    expect(titleFor(both, NOW)).toBe('🔴 4h left · Acme Legal · task')
    expect(pinReason(both, NOW)).not.toMatch(/late/)
  })

  test('a stored item whose internal clock passes between two syncs never reads late', () => {
    const it = only(feedOf({ due_today: [ticket({ commitment_basis: 'eta_owed', due_at: iso(1) })] }))
    const stored = JSON.parse(JSON.stringify(it)) as QueueItem
    const later = NOW + 2 * HOUR
    expect(titleFor(stored, later)).toBe('🟡 Acme Legal · behind · due 12 PM')
    expect(surfaces(stored, later)).not.toMatch(/late|overdue/i)
    expect(report(stored, later)[0]).toMatchObject({ tone: 'yellow', clock: 'internal' })
  })

  test('an item an older bridge stored (no internalDue) reads exactly as before', () => {
    const it = only(feedOf({ overdue: [ticket({ commitment_basis: 'eta_owed', due_at: iso(-1) })] }))
    const old = JSON.parse(JSON.stringify(it)) as QueueItem
    delete old.internalDue
    delete old.clientDue
    delete old.clientOwn
    expect(isRed(old, NOW)).toBe(true)
    expect(titleFor(old, NOW)).toMatch(/^🔴 1h late/)
  })
})

describe('(0.7.60) Team now never draws an internal clock red or late', () => {
  test('internal: yellow and `due ...` past its time; a client row: red and late, as before', () => {
    const due = NOW - 2 * HOUR
    expect(itemTone({ tone: 'red', dueAt: due, internal: true }, NOW)).toBe('yellow')
    expect(itemTone({ tone: 'yellow', dueAt: due, internal: true }, NOW)).toBe('yellow')
    expect(itemTime({ dueAt: due, internal: true }, NOW)).toMatch(/^due /)
    expect(itemTone({ tone: 'yellow', dueAt: due }, NOW)).toBe('red')
    expect(itemTime({ dueAt: due }, NOW)).toBe('2h late')
  })
})

describe('(0.7.60) one owner per client reply', () => {
  const NAYAN = 'nayan@massmarket.ai'
  const SHEZAN = 'shezan@massmarket.ai'
  const PKG = 'ce533126-0000-4000-8000-000000000000'
  const remverMail = { message_id_key: 'm1', received_at: iso(-2), reply_due_at: iso(22), sender: 'client@remver.com', subject: 'Hi', snippet: 'hello', project_id: P1, project_name: 'Remver Consulting', reply_status: 'unanswered', project_owner_email: NAYAN, reply_holder_email: SHEZAN }
  const remverPkg = { package_id: PKG, project_id: P1, project_name: 'Remver Consulting', status: 'picked_up', covers_through: iso(-2), drafts_ready: 1, drafts_unsent: 1, picked_up_by: SHEZAN, picked_up_at: iso(-1), project_owner_email: NAYAN, reply_holder_email: SHEZAN }

  test('9. the owner who does not hold the package: no pin, no pin reason, listed with the holder', () => {
    for (const drafts of [[], [remverPkg]]) {
      const lists = buildLists({ member: NAYAN, role: 'builder', mail: [remverMail], drafts } as unknown as Feed, NOW)
      expect(lists.queue.length).toBe(0)
      expect(lists.teammate.length).toBe(1)
      const it = lists.teammate[0] as QueueItem
      expect(pinsFor(it, NOW)).toBe(false)
      expect(report(it)).toEqual([])
    }
  })

  test('9. the holder keeps it: pinned, and the mail counts on their row', () => {
    const lists = buildLists({ member: SHEZAN, role: 'builder', mail: [remverMail], drafts: [remverPkg] } as unknown as Feed, NOW)
    expect(lists.queue.length).toBe(1)
    const it = lists.queue[0] as QueueItem
    expect(it.kind).toBe('ready')
    expect(it.messages).toBe(1)
    expect(pinsFor(it, NOW)).toBe(true)
    expect(report(it).length).toBe(1)
  })

  test('9. the owner keeps a task of their own on the client: the row is for the task, never `reply`', () => {
    const lists = buildLists({ member: NAYAN, role: 'builder', mail: [remverMail], tickets: { due_today: [ticket({ assignee_email: NAYAN, project_name: 'Remver Consulting', due_at: iso(2), commitment_basis: 'client_eta' })] } } as unknown as Feed, NOW)
    const it = lists.queue[0] as QueueItem
    expect(it.kind).toBe('task')
    expect(it.messages).toBe(0)
    expect(report(it)[0]?.kind).toBe('task')
  })

  test('a prepared package whose assignee is a teammate: the owner gets no ready row, the assignee does', () => {
    const ASIF = 'asif@massmarket.ai'
    const pkg = { package_id: '21f9c346-0000-4000-8000-000000000000', project_id: P1, project_name: 'Sonya Vicars', status: 'prepared', covers_through: iso(-2), drafts_ready: 1, drafts_unsent: 1, picked_up_by: null, project_owner_email: ASIF, reply_holder_email: NAYAN }
    const asif = buildLists({ member: ASIF, role: 'builder', drafts: [pkg] } as unknown as Feed, NOW)
    expect(asif.queue.length).toBe(0)
    const nayan = buildLists({ member: NAYAN, role: 'builder', drafts: [pkg] } as unknown as Feed, NOW)
    expect(nayan.queue.length).toBe(1)
    expect(nayan.queue[0]?.kind).toBe('ready')
  })

  test('no holder named: the owner, as before', () => {
    const { reply_holder_email: _h, ...plain } = remverMail
    const lists = buildLists({ member: NAYAN, role: 'builder', mail: [plain] } as unknown as Feed, NOW)
    expect(lists.queue.length).toBe(1)
    expect(lists.queue[0]?.kind).toBe('reply')
  })
})
