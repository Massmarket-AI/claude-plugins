import { describe, expect, test } from 'claude-code/testing'

import { INTERNAL_OPS, buildQueue, ownPins, pinsNow } from './queue'
import type { Feed } from './queue'

// ⛔ A LinkedIn seat failure on one of Massmarket's own seats pins the Massmarket AI thread with a timer (Rob,
// 2026-11-26, a recommendation he approved: "Yes, build it"; before it: "those should be pinned and timing if they failed").
// seat-watch files the failure on the internal-ops project with `seat_failure: true` and dates it; OW lists a dated
// seat-failure ticket in the founder's dated lists (`due_today`, `overdue`, ...), not in `internal_queue`, with
// `seat_failure: true` on the row. Everything else on that thread stays undated (Rob, 2026-10-13): the internal queue
// never pins. These tests pin what the bridge does with each.

const FOUNDER = 'owner@example.com'
const NAME = 'Massmarket AI'
// Thursday 2026-11-26, 1:30 PM ET
const NOW = Date.parse('2026-11-26T18:30:00Z')
const H = 3_600_000

const seatFailure = (id: string, due: string | null) => ({
  ticket_id: id,
  project_id: INTERNAL_OPS,
  project_name: NAME,
  title: "11-26 Massmarket (Rob) LinkedIn: today's pass failed",
  status: 'open',
  due_at: due,
  due_source: due ? 'commitment' : null,
  assignee_email: FOUNDER,
  commitment_basis: due ? 'team_move' : null,
  seat_failure: true,
  internal: true,
})

const queueRow = (id: string) => ({
  ticket_id: id,
  id,
  project_id: INTERNAL_OPS,
  project_name: NAME,
  title: '11-26 Massmarket (Don) LinkedIn: search mna_market has run out',
  status: 'open',
  severity: 'medium',
  assignee_email: FOUNDER,
  internal: true,
  queue_tier: 'now',
  queue_rank: 1,
})

const founderFeed = (over: Partial<Feed> = {}): Feed => ({
  member: FOUNDER,
  role: 'founder',
  projects: [{ project_id: INTERNAL_OPS, name: NAME, why: ['pm_all'] }],
  ...over,
}) as Feed

const internalItem = (f: Feed) => buildQueue(f, NOW).find(i => i.projectId === INTERNAL_OPS)

describe("a seat failure on one of our own seats pins the Massmarket AI thread", () => {
  test('a dated seat failure due at 5 PM today: listed on the internal-ops item, and it pins', async () => {
    const due = new Date(NOW + 3.5 * H).toISOString()
    const it = internalItem(founderFeed({ tickets: { due_today: [seatFailure('9d000000-0000-4000-8000-000000000001', due)] } } as Partial<Feed>))
    expect(it?.tasks).toBe(1)
    expect(it && Number.isFinite(it.dueAt)).toBe(true)
    expect(pinsNow(it!, NOW)).toBe(true)
    expect(ownPins(it!, NOW)).toBe(true)
  })

  test('an overdue seat failure pins', async () => {
    const due = new Date(NOW - 2 * H).toISOString()
    const it = internalItem(founderFeed({ tickets: { overdue: [seatFailure('9d000000-0000-4000-8000-000000000002', due)] } } as Partial<Feed>))
    expect(ownPins(it!, NOW)).toBe(true)
  })

  test('beside the internal queue, the dated seat failure still pins; the queue alone never does', async () => {
    const due = new Date(NOW + 3.5 * H).toISOString()
    const both = internalItem(
      founderFeed({ tickets: { due_today: [seatFailure('9d000000-0000-4000-8000-000000000003', due)], internal_queue: [queueRow('9d000000-0000-4000-8000-000000000004')] } } as Partial<Feed>)
    )
    expect(ownPins(both!, NOW)).toBe(true)
    const queueOnly = internalItem(founderFeed({ tickets: { internal_queue: [queueRow('9d000000-0000-4000-8000-000000000005')] } } as Partial<Feed>))
    expect(queueOnly ? ownPins(queueOnly, NOW) : false).toBe(false)
  })

  test('resolved: gone from the feed, so the internal-ops item no longer pins', async () => {
    const it = internalItem(founderFeed({ tickets: { due_today: [], internal_queue: [queueRow('9d000000-0000-4000-8000-000000000006')] } } as Partial<Feed>))
    expect(it ? ownPins(it, NOW) : false).toBe(false)
  })
})
