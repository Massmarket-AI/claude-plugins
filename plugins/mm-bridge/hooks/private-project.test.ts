import { describe, expect, test } from 'claude-code/testing'

import { buildQueue, feedClients, internalProjects, ownerPrivateProjects, pinsNow } from './queue'
import type { Feed } from './queue'

// (0.7.67) The founder's own private projects (Rob, 2026-11-20: "start a new project just for this... so that it pins
// itself... when it needs attention and is not flowing properly through our plan"). OW lists such a project on the
// founder's own feed only (owner_only_user_id his, exclude_from_automation true; OW PR "founder private projects"), and
// its tickets come as his client tasks: assigned to him, dated by their own commitment. These tests pin what the bridge
// does with that feed: the project can be linked, its thread pins on a ticket due within 24 business hours or overdue, it
// does not pin on an undated or far-off ticket, and it unpins once the ticket is resolved (gone from the feed). It is not
// an internal project: the internal queue never pins.

const FOUNDER = 'owner@example.com'
const PRIV = '9a000000-0000-4000-8000-000000000001'
const NAME = 'Data licensing'
const OTHER = '9a000000-0000-4000-8000-000000000002'
// Friday 2026-11-20, 11 AM ET
const NOW = Date.parse('2026-11-20T16:00:00Z')
const H = 3_600_000

const ticket = (id: string, due: string | null) => ({
  ticket_id: id,
  project_id: PRIV,
  project_name: NAME,
  title: due ? 'Workspace org export ready to download' : 'Ledger item past its next step',
  status: 'open',
  due_at: due,
  due_source: due ? 'commitment' : null,
  assignee_email: FOUNDER,
  commitment_basis: due ? 'team_move' : null,
})

const founderFeed = (over: Partial<Feed> = {}): Feed => ({
  member: FOUNDER,
  role: 'founder',
  projects: [{ project_id: PRIV, name: NAME, why: ['pm_all'], owner_private: true }, { project_id: OTHER, name: 'Acme Plumbing', why: ['pm_all'] }],
  ...over,
}) as Feed

describe('the founder\'s own private project', () => {
  test('a ticket due later today: listed on the project, and it pins', async () => {
    const due = new Date(NOW + 4 * H).toISOString()
    const f = founderFeed({ tickets: { due_today: [ticket('9c000000-0000-4000-8000-000000000001', due)] } } as Partial<Feed>)
    const [it] = buildQueue(f, NOW)
    expect(it?.projectId).toBe(PRIV)
    expect(it?.client).toBeTruthy()
    expect(it?.tasks).toBe(1)
    expect(pinsNow(it!, NOW)).toBe(true)
    expect(internalProjects(f).has(PRIV)).toBe(false)
  })

  test('an overdue ticket pins', async () => {
    const due = new Date(NOW - 30 * H).toISOString()
    const f = founderFeed({ tickets: { overdue: [ticket('9c000000-0000-4000-8000-000000000002', due)] } } as Partial<Feed>)
    const [it] = buildQueue(f, NOW)
    expect(it?.projectId).toBe(PRIV)
    expect(pinsNow(it!, NOW)).toBe(true)
  })

  test('Friday to Monday is 24 business hours: a ticket due Monday 10 AM pins on Friday 11 AM; one due Tuesday 3 PM does not', async () => {
    const monday = Date.parse('2026-11-23T15:00:00Z')
    const tuesday = Date.parse('2026-11-24T20:00:00Z')
    const soon = founderFeed({ tickets: { due_soon: [ticket('9c000000-0000-4000-8000-000000000003', new Date(monday).toISOString())] } } as Partial<Feed>)
    const later = founderFeed({ tickets: { due_soon: [ticket('9c000000-0000-4000-8000-000000000004', new Date(tuesday).toISOString())] } } as Partial<Feed>)
    expect(pinsNow(buildQueue(soon, NOW)[0]!, NOW)).toBe(true)
    const [far] = buildQueue(later, NOW)
    expect(far ? pinsNow(far, NOW) : false).toBe(false)
  })

  test('an undated ticket never pins', async () => {
    const f = founderFeed({ tickets: { undated: [ticket('9c000000-0000-4000-8000-000000000005', null)] } } as Partial<Feed>)
    const items = buildQueue(f, NOW)
    expect(items.every(i => !pinsNow(i, NOW))).toBe(true)
  })

  test('resolved: the ticket is gone from the feed, so nothing is listed and nothing pins', async () => {
    const f = founderFeed({ tickets: { due_today: [] } } as Partial<Feed>)
    expect(buildQueue(f, NOW).filter(i => i.projectId === PRIV)).toEqual([])
  })

  test('it can be linked with no ticket open: the feed names it by its mark; an unmarked project it lists is not named', async () => {
    const f = founderFeed({ tickets: { due_today: [] } } as Partial<Feed>)
    expect(feedClients(f).find(c => c.projectId === PRIV)?.projectName).toBe(NAME)
    expect(feedClients(f).some(c => c.projectId === OTHER)).toBe(false)
    expect(ownerPrivateProjects(f)).toEqual([{ projectId: PRIV, projectName: NAME }])
  })

  test('the mark counts on the founder\'s feed only: a PM\'s or a teammate\'s feed that carried one names nothing', async () => {
    for (const role of ['pm', 'member'] as const) {
      const f = founderFeed({ role, tickets: { due_today: [] } } as Partial<Feed>)
      expect(ownerPrivateProjects(f)).toEqual([])
      expect(feedClients(f).some(c => c.projectId === PRIV)).toBe(false)
    }
  })

  test('a mark that is not exactly true, or a row with no usable id or name, is not taken', async () => {
    const rows = [
      { project_id: PRIV, name: NAME, why: [], owner_private: 'true' },
      { project_id: 'not-a-uuid', name: NAME, why: [], owner_private: true },
      { project_id: OTHER, name: '   ', why: [], owner_private: true },
    ]
    expect(ownerPrivateProjects(founderFeed({ projects: rows } as unknown as Partial<Feed>))).toEqual([])
  })
})
