import { describe, expect, test } from 'claude-code/testing'

import { ME, ago, fakeApp, mm, pid } from './fake-app'
import type { Feed } from './queue'

// The bridge's own hooks in a pretend desktop app (fake-app.ts): one store and one app shared by the threads
// that run them, as each desktop thread is a process of its own. Round 3's review (79cbc596) found these.

/** An unanswered client message, received so many hours ago, on a client the viewer owns. */
const mail = (n: number, name: string, hoursAgo = 2) => ({
  message_id_key: `m${n}-${hoursAgo}`, received_at: ago(hoursAgo), sender: 'client@example.com', subject: 'Question', snippet: 'hello',
  project_id: pid(n), project_name: name, reply_status: 'unanswered', project_owner_email: ME,
})

describe('F1: the feed is asked for mail far enough back for Older to hold any', () => {
  test('the closeout feed is asked for 168 business hours of mail, OW\'s most', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_hub' }])
    await mm(w.session('local_hub'), '')
    const closeout = w.fetched.filter(u => u.includes('/closeout'))
    expect(closeout.length).toBe(1)
    expect(closeout[0]).toBe('https://onboarding-wizard.massmarket.ai/api/ext/closeout?mail_hours=168')
  })

  test('a client whose only mail is a week old is listed under Older, not dropped', async () => {
    // received last Tuesday morning: 168 hours ago, five business days
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One', 7 * 24 - 1)], tickets: {}, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_hub' }])
    const hub = w.session('local_hub')
    expect(await mm(hub, '')).toBe('Nothing needs you right now.')
    const last = w.stored('mm.last') as { items: unknown[]; older?: Array<{ projectId: string }> }
    expect(last.items).toEqual([])
    expect(last.older?.map(i => i.projectId)).toEqual([pid(1)])
  })
})
