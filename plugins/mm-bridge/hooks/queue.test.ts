import { describe, expect, test } from 'claude-code/testing'

import { buildQueue, clearedTitle, shortName, titleFor, titleNames } from './queue'
import type { Feed } from './queue'

const NOW = Date.parse('2026-10-08T15:00:00Z') // 11 AM ET
const iso = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3_600_000).toISOString()
const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'
const P3 = '33333333-3333-3333-3333-333333333333'

const mail = (pid: string, name: string, receivedH: number, owner: string | null = 'builder-a@example.com') => ({
  message_id_key: `${pid}-${receivedH}`, received_at: iso(receivedH), reply_due_at: iso(receivedH + 24),
  sender: 'client@example.com', subject: 'Hi', snippet: 'hello', project_id: pid, project_name: name,
  reply_status: 'unanswered', project_owner_email: owner,
})

const feed = (over: Partial<Feed> = {}): Feed => ({ member: 'builder-a@example.com', role: 'builder', ...over })

describe('what pins (Rob, 2026-10-08: nothing more than 3 days old)', () => {
  test('a message whose reply is 2 days late pins; one 4 days late does not', async () => {
    const q = buildQueue(feed({ mail: [mail(P1, 'Contoso Cooling — Bill', -72), mail(P2, 'Old Client', -120)] }), NOW)
    expect(q.map(i => i.projectId)).toEqual([P1])
  })

  test('only my clients pin; an unowned client pins for the founder only', async () => {
    const f = feed({ mail: [mail(P1, 'Mine', -2), mail(P2, 'Theirs', -2, 'builder-b@example.com'), mail(P3, 'Nobody', -2, null)] })
    expect(buildQueue(f, NOW).map(i => i.projectId)).toEqual([P1])
    const founder = { ...f, member: 'owner@example.com', role: 'founder' }
    expect(buildQueue(founder, NOW).map(i => i.projectId)).toEqual([P3])
  })

  test('tickets pin only on a date we committed to, within the window', async () => {
    const t = (pid: string, dueH: number, src: string) => ({
      ticket_id: `${pid}-${dueH}`, project_id: pid, project_name: pid, title: 't', due_at: iso(dueH), due_source: src, assignee_email: 'builder-a@example.com',
    })
    const q = buildQueue(feed({ tickets: { overdue: [t(P1, -10, 'commitment'), t(P2, -10, 'sla'), t(P3, -100, 'commitment')], due_soon: [] } }), NOW)
    expect(q.map(i => i.projectId)).toEqual([P1])
  })

  test('a prepared package marks the client "reply ready"; a stale one does not', async () => {
    const d = (pid: string, status: string) => ({
      package_id: `pkg-${pid}`, project_id: pid, project_name: 'Northwind Dental — Building', status, covers_through: iso(-3), drafts_ready: 2, project_owner_email: 'builder-a@example.com',
    })
    const q = buildQueue(feed({ drafts: [d(P1, 'prepared'), d(P2, 'stale')] }), NOW)
    expect(q.length).toBe(1)
    expect(q[0]?.kind).toBe('ready')
    expect(q[0]?.client).toBe('Northwind Dental')
  })
})

describe('thread names', () => {
  test('overdue is red and says how late', async () => {
    const [it] = buildQueue(feed({ mail: [mail(P1, 'Contoso Cooling — Bill', -30), mail(P1, 'Contoso Cooling — Bill', -2)] }), NOW)
    expect(it && titleFor(it, NOW)).toBe('🔴 Contoso Cooling · reply overdue 6h · 2 new')
  })

  test('due tomorrow is yellow', async () => {
    const [it] = buildQueue(feed({ mail: [mail(P1, 'Acme Legal (Pat)', -2)] }), NOW + 0)
    expect(it && titleFor(it, NOW)).toBe('🟡 Acme Legal · reply due tomorrow 9 AM')
  })

  test('short names and matching an existing thread title', async () => {
    expect(shortName('Houston Industrial Tradesmen — Kellie Stewart')).toBe('Houston Industrial Tradesmen')
    expect(titleNames('🔴 Contoso Cooling · reply overdue 6h', 'Contoso Cooling')).toBe(true)
    expect(titleNames('Contoso Cooling: auto-assign fix', 'Contoso Cooling')).toBe(true)
    expect(titleNames('Answer the 7 Meta ad decisions', 'Contoso Cooling')).toBe(false)
    expect(clearedTitle('Contoso Cooling', NOW)).toMatch(/^✓ Contoso Cooling · clear 11/)
  })
})
