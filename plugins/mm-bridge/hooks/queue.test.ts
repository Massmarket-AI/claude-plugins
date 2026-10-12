import { describe, expect, test } from 'claude-code/testing'

import { businessMsBetween } from './business-time'
import { WINDOW_AHEAD_MS, WINDOW_BACK_MS, buildQueue, clearedTitle, shortName, titleFor, titleNames } from './queue'
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
    const q = buildQueue(feed({ mail: [mail(P1, 'Contoso Cooling — Sam', -72), mail(P2, 'Old Client', -120)] }), NOW)
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
    const [it] = buildQueue(feed({ mail: [mail(P1, 'Contoso Cooling — Sam', -30), mail(P1, 'Contoso Cooling — Sam', -2)] }), NOW)
    expect(it && titleFor(it, NOW)).toBe('🔴 Contoso Cooling · reply overdue 6h · 2 new')
  })

  test('due tomorrow is yellow', async () => {
    const [it] = buildQueue(feed({ mail: [mail(P1, 'Acme Legal (Pat)', -2)] }), NOW + 0)
    expect(it && titleFor(it, NOW)).toBe('🟡 Acme Legal · reply due tomorrow 9 AM')
  })

  test('short names and matching an existing thread title', async () => {
    expect(shortName('Fabrikam Industrial Staffing — Jordan Lee')).toBe('Fabrikam Industrial Staffing')
    expect(titleNames('🔴 Contoso Cooling · reply overdue 6h', 'Contoso Cooling')).toBe(true)
    expect(titleNames('Contoso Cooling: auto-assign fix', 'Contoso Cooling')).toBe(true)
    expect(titleNames('Answer the 7 Meta ad decisions', 'Contoso Cooling')).toBe(false)
    expect(clearedTitle('Contoso Cooling', NOW)).toMatch(/^✓ Contoso Cooling · clear 11/)
  })
})

// ---------------------------------------------------------------- business time
// Rob, 2026-10-12: "the weekends don't count as days towards the 24-hour response time... We're only
// counting business days in our timelines for clients." Every time below is America/New_York.

/** A New York wall time in October 2026 (daylight time, UTC-4) as an instant. */
const et = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-04:00`)
const at = (s: string) => new Date(et(s)).toISOString()
const ME = feed().member

/** An unanswered client message. With no `replyDue` the feed gives no reply time and the plugin works it out. */
const mailAt = (pid: string, name: string, received: string, replyDue?: string) => ({
  message_id_key: `${pid}-${received}`, received_at: at(received), ...(replyDue ? { reply_due_at: at(replyDue) } : {}),
  sender: 'client@example.com', subject: 'Hi', snippet: 'hello', project_id: pid, project_name: name,
  reply_status: 'unanswered', project_owner_email: ME,
})
const committed = (pid: string, name: string, dueIso: string) => ({
  ticket_id: `${pid}-${dueIso}`, project_id: pid, project_name: name, title: 't', due_at: dueIso, due_source: 'commitment', assignee_email: ME,
})
const titleAt = (f: Feed, now: string) => {
  const [it] = buildQueue(f, et(now))
  return it ? titleFor(it, et(now)) : null
}

describe('client clocks count business days (Rob, 2026-10-12: weekends do not count)', () => {
  const friday = feed({ mail: [mailAt(P1, 'Acme Roofing — Pat', '2026-10-09 15:00')] })

  test('a message that arrived Friday 3 PM is due Monday 3 PM, and is pinned Friday 4 PM', async () => {
    const [it] = buildQueue(friday, et('2026-10-09 16:00'))
    expect(it?.dueAt).toBe(et('2026-10-12 15:00'))
    expect(titleAt(friday, '2026-10-09 16:00')).toBe('🟡 Acme Roofing · reply due Mon 3 PM')
  })

  test('it stays pinned over the weekend and Monday 9 AM reads due today at 3 PM', async () => {
    expect(titleAt(friday, '2026-10-10 15:01')).toBe('🟡 Acme Roofing · reply due Mon 3 PM')
    expect(titleAt(friday, '2026-10-11 12:00')).toBe('🟡 Acme Roofing · reply due tomorrow 3 PM')
    expect(titleAt(friday, '2026-10-12 09:00')).toBe('🔴 Acme Roofing · reply due 3 PM')
  })

  test('Tuesday 3 PM it reads overdue 1d', async () => {
    expect(titleAt(friday, '2026-10-12 16:00')).toBe('🔴 Acme Roofing · reply overdue 1h')
    expect(titleAt(friday, '2026-10-13 15:00')).toBe('🔴 Acme Roofing · reply overdue 1d')
  })

  test('it is pinned through Thursday 3 PM (3 business days late) and gone at 3:01 PM', async () => {
    expect(titleAt(friday, '2026-10-15 15:00')).toBe('🔴 Acme Roofing · reply overdue 3d')
    expect(buildQueue(friday, et('2026-10-15 15:01'))).toEqual([])
  })

  test('a message that arrived Saturday 10 AM is due Monday 11:59 PM', async () => {
    const saturday = feed({ mail: [mailAt(P1, 'Acme Roofing — Pat', '2026-10-10 10:00')] })
    const [it] = buildQueue(saturday, et('2026-10-10 11:00'))
    expect(it?.dueAt).toBe(et('2026-10-12 23:59'))
    expect(titleAt(saturday, '2026-10-10 11:00')).toBe('🟡 Acme Roofing · reply due Mon 11:59 PM')
    expect(titleAt(saturday, '2026-10-12 09:00')).toBe('🔴 Acme Roofing · reply due 11:59 PM')
  })

  test('a message that arrived Thursday 3 PM is still pinned Monday 3:01 PM', async () => {
    const thursday = feed({ mail: [mailAt(P1, 'Acme Roofing — Pat', '2026-10-08 15:00')] })
    expect(buildQueue(thursday, et('2026-10-12 15:01'))[0]?.dueAt).toBe(et('2026-10-09 15:00'))
    expect(titleAt(thursday, '2026-10-12 15:01')).toBe('🔴 Acme Roofing · reply overdue 1d')
  })

  test('a ticket we committed for Friday 5 PM reads overdue 16h Monday 9 AM, and pins until Wednesday 5 PM', async () => {
    const f = feed({ tickets: { overdue: [committed(P1, 'Acme Roofing — Pat', at('2026-10-09 17:00'))] } })
    expect(titleAt(f, '2026-10-12 09:00')).toBe('🔴 Acme Roofing · task overdue 16h')
    expect(titleAt(f, '2026-10-12 17:01')).toBe('🔴 Acme Roofing · task overdue 1d')
    expect(titleAt(f, '2026-10-14 17:00')).toBe('🔴 Acme Roofing · task overdue 3d')
    expect(buildQueue(f, et('2026-10-14 17:01'))).toEqual([])
  })

  test('a reply package covering Friday 3 PM is due Monday 3 PM, not 2 days overdue on Monday morning', async () => {
    const f = feed({
      drafts: [{ package_id: 'pkg-1', project_id: P1, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: at('2026-10-09 15:00'), drafts_ready: 1, project_owner_email: ME }],
    })
    expect(titleAt(f, '2026-10-12 09:00')).toBe('🔴 Acme Roofing · reply ready due 3 PM')
    expect(titleAt(f, '2026-10-15 15:00')).toBe('🔴 Acme Roofing · reply ready overdue 3d')
    expect(buildQueue(f, et('2026-10-15 15:01'))).toEqual([])
  })

  test('a reply time from the feed is used as given, whichever way the server counted it', async () => {
    // a server that counts business time says Monday 3 PM: pinned from Friday, not from Sunday
    const counted = feed({ mail: [mailAt(P1, 'Acme Roofing — Pat', '2026-10-09 15:00', '2026-10-12 15:00')] })
    expect(titleAt(counted, '2026-10-09 16:00')).toBe('🟡 Acme Roofing · reply due Mon 3 PM')
    // a server that still counts real hours says Saturday 3 PM: pinned all the same, and the weekend adds no lateness
    const real = feed({ mail: [mailAt(P1, 'Acme Roofing — Pat', '2026-10-09 15:00', '2026-10-10 15:00')] })
    expect(titleAt(real, '2026-10-09 16:00')).toBe('🟡 Acme Roofing · reply due tomorrow 3 PM')
    expect(titleAt(real, '2026-10-12 09:00')).toBe('🔴 Acme Roofing · reply overdue 9h')
  })

  test('a message with no usable date is skipped and does not hide the client\'s other message', async () => {
    const broken = { ...mailAt(P1, 'Acme Roofing — Pat', '2026-10-09 15:00'), message_id_key: 'broken', received_at: 'not a date' }
    const q = buildQueue(feed({ mail: [broken, mailAt(P1, 'Acme Roofing — Pat', '2026-10-09 15:00')] }), et('2026-10-09 16:00'))
    expect(q.length).toBe(1)
    expect(q[0]?.messages).toBe(1)
    expect(q[0]?.dueAt).toBe(et('2026-10-12 15:00'))
  })

  test('the window is exactly 3 business days back and 24 business hours ahead, across weekends and the clock change', { timeoutMs: 30_000 }, async () => {
    const HOUR = 3_600_000
    const nows = [
      et('2026-10-09 16:00'), et('2026-10-10 11:00'), et('2026-10-11 23:30'), et('2026-10-12 09:00'), et('2026-10-14 13:37'),
      Date.UTC(2026, 9, 31, 16), Date.UTC(2026, 10, 1, 12), Date.UTC(2026, 10, 2, 14), Date.UTC(2026, 10, 5, 5), // the weekend the clocks go back
    ]
    let checked = 0
    let pinned = 0
    for (const now of nows) {
      for (let off = -130 * HOUR; off <= 80 * HOUR; off += 127 * 60_000) {
        const due = now + off
        const want = due < now ? businessMsBetween(due, now) <= WINDOW_BACK_MS : businessMsBetween(now, due) <= WINDOW_AHEAD_MS
        const got = buildQueue(feed({ tickets: { overdue: [committed(P1, 'Acme Roofing — Pat', new Date(due).toISOString())] } }), now).length === 1
        expect(got, `now ${new Date(now).toISOString()} due ${new Date(due).toISOString()}`).toBe(want)
        checked++
        if (got) pinned++
      }
    }
    expect(checked).toBe(nows.length * 100)
    expect(pinned).toBeGreaterThan(nows.length * 40)
    expect(pinned).toBeLessThan(checked)
  })

  test('a date far in the past or the future does not pin, and is decided without walking the calendar', async () => {
    const f = feed({
      tickets: { overdue: [committed(P1, 'Long Ago', '1970-01-01T00:00:00Z'), committed(P2, 'Far Off', '9999-12-31T00:00:00Z'), committed(P3, 'Acme Roofing — Pat', at('2026-10-09 17:00'))] },
      drafts: [{ package_id: 'pkg-old', project_id: P2, project_name: 'Far Off', status: 'prepared', covers_through: '1970-01-01T00:00:00Z', drafts_ready: 1, project_owner_email: ME }],
    })
    expect(buildQueue(f, et('2026-10-12 09:00')).map(i => i.projectId)).toEqual([P3])
  })
})
