import { describe, expect, test } from 'claude-code/testing'

import { ME, ago, fakeApp, mm, pid, tool } from './fake-app'
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

/** A client the feed knows with nothing waiting: its mail was answered. */
const answered = (n: number, name: string) => ({ ...mail(n, name, 30), reply_status: 'replied' })
/** A client the feed knows only by a ticket with no date we committed to. */
const ticketOnly = (n: number, name: string) => ({ ticket_id: `t${n}`, project_id: pid(n), project_name: name, title: 'Follow up', due_at: ago(-5), due_source: 'phase', assignee_email: ME })
const linksOf = (w: ReturnType<typeof fakeApp>) => (w.stored('mm.links') ?? {}) as Record<string, string>

describe('F3: /mm link never picks one client of several the name could mean', () => {
  test('an exact name off the lists beside a listed client whose name contains it: the question, and nothing is written', async () => {
    // the reviewer's P1: "Acme Legal Group" needs the person; the feed also names a client "Acme"
    const feed: Feed = { member: ME, role: 'builder', mail: [mail(1, 'Acme Legal Group')], tickets: { due_soon: [ticketOnly(2, 'Acme')] }, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_t1' }, { sessionId: 'local_other' }])
    const t1 = w.session('local_t1')
    expect(await mm(t1, 'link Acme')).toBe('More than one client matches "Acme": Acme, Acme Legal Group. Type more of the name.')
    expect(w.stored('mm.links')).toBeUndefined()
    // the whole name settles it, either way
    expect(await mm(t1, 'link Acme Legal Group')).toBe('This thread is now Acme Legal Group\'s. Showing Acme Legal Group in the side pane.')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_t1' })
  })

  test('an exact name beats a name that contains it: on the lists over the feed, on the lists over the lists, in the feed over the feed', async () => {
    const feed: Feed = {
      member: ME, role: 'builder', tickets: {}, threads: [],
      mail: [mail(1, 'Acme'), mail(2, 'Acme Legal Group'), answered(3, 'Acme Glass'), answered(4, 'Zen'), answered(5, 'Zen Garden Spa')],
    }
    const w = fakeApp(feed, [{ sessionId: 'local_t1' }])
    const t1 = w.session('local_t1')
    // "acme": exactly Acme on the list; Acme Legal Group (list) and Acme Glass (feed) only contain it
    expect(await mm(t1, 'link acme')).toBe('This thread is now Acme\'s. Showing Acme in the side pane.')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_t1' })
    // "zen": exactly Zen in the feed; Zen Garden Spa only contains it
    expect(await mm(t1, 'link zen')).toBe('This thread is now Zen\'s. Nothing needs you on this client right now.')
    expect(linksOf(w)).toEqual({ [pid(4)]: 'local_t1' })
  })

  test('more than one at a stage is a question: two exact names, or two that contain it', async () => {
    const feed: Feed = { member: ME, role: 'builder', tickets: {}, threads: [], mail: [mail(1, 'Acme'), answered(2, 'Acme — North'), answered(3, 'Bolt Glass'), answered(4, 'Bolt Steel')] }
    const w = fakeApp(feed, [{ sessionId: 'local_t1' }])
    const t1 = w.session('local_t1')
    // the listed Acme and the feed's "Acme — North" (short name Acme): told apart by their full names
    expect(await mm(t1, 'link acme')).toBe('More than one client matches "acme": Acme, Acme North. Type more of the name.')
    expect(await mm(t1, 'link bolt')).toBe('More than one client matches "bolt": Bolt Glass, Bolt Steel. Type more of the name.')
    expect(w.stored('mm.links')).toBeUndefined()
  })
})

describe('F4: only the person moves a client, or undoes their own unlink', () => {
  const oneClient = (): Feed => ({ member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [] })

  test('the tool cannot take a client from the thread the person linked it to (P3), nor can a /mm that is not the person\'s', async () => {
    const w = fakeApp(oneClient(), [{ sessionId: 'local_t1', title: 'Client One work' }, { sessionId: 'local_t2', title: 'Other client work' }])
    w.put('mm.links', { [pid(1)]: 'local_t1' })
    w.put('mm.acted', { [pid(1)]: { sid: 'local_t1', at: Date.parse(ago(0)) } })
    const t2 = w.session('local_t2')
    const refusal = 'Client One already has a thread. Only the person can move it: they type /mm link Client One in the thread that should have it.'
    expect(await tool(t2, 'link Client One')).toBe(refusal)
    expect(await mm(t2, 'link Client One', 'peer')).toBe(refusal)
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_t1' })
    expect(w.calls.filter(c => c.tool === 'set_session_title' || c.tool === 'set_pinned')).toEqual([])
  })

  test('the tool cannot link a thread the person unlinked, and the unlink stays (P3b)', async () => {
    const w = fakeApp(oneClient(), [{ sessionId: 'local_t2', title: 'Mine' }])
    const unlinkedAt = Date.parse(ago(0)) - 1_000
    w.put('mm.unlinked', { local_t2: unlinkedAt })
    const t2 = w.session('local_t2')
    expect(await tool(t2, 'link Client One')).toBe('This thread was unlinked by the person. Only they can link it again: they type /mm link Client One here.')
    expect(w.stored('mm.unlinked')).toEqual({ local_t2: unlinkedAt })
    expect(w.stored('mm.links')).toBeUndefined()
    // the person can
    expect(await mm(t2, 'link Client One')).toBe('This thread is now Client One\'s. Showing Client One in the side pane.')
    expect(w.stored('mm.unlinked')).toEqual({})
  })

  test('a client whose thread is gone may be linked by the tool, and a link the tool makes is never stamped', async () => {
    const w = fakeApp(oneClient(), [{ sessionId: 'local_t2', title: 'Mine' }])
    // linked to a thread the app no longer has
    w.put('mm.links', { [pid(1)]: 'local_gone' })
    const t2 = w.session('local_t2')
    expect(await tool(t2, 'link Client One')).toBe('This thread is now Client One\'s. Showing Client One in the side pane.')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_t2' })
    expect(w.stored('mm.acted')).toBeUndefined()
  })

  test('the thread a client is moved from gets its own name back and our pin off, never a frozen client name (P3c)', async () => {
    const w = fakeApp(oneClient(), [{ sessionId: 'local_t1', title: 'Original one' }, { sessionId: 'local_t2', title: 'Other client work' }])
    w.put('mm.links', { [pid(1)]: 'local_t1' })
    const t1 = w.session('local_t1')
    await mm(t1, '')
    expect(w.app.get('local_t1')).toMatchObject({ title: '🟡 22h left · Client One · reply', pinned: true })
    // the tool is refused; the person moves it, typing /mm link in the other thread
    const t2 = w.session('local_t2')
    expect(await tool(t2, 'link Client One')).toContain('already has a thread')
    expect(await mm(t2, 'link Client One')).toBe('This thread is now Client One\'s. Showing Client One in the side pane.')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_t2' })
    expect(w.app.get('local_t1')).toMatchObject({ title: 'Original one', pinned: false })
    expect(w.app.get('local_t2')).toMatchObject({ title: '🟡 22h left · Client One · reply', pinned: true })
    // and later syncs leave it so
    await w.advance(6 * 60_000)
    await mm(t1, '')
    expect(w.app.get('local_t1')).toMatchObject({ title: 'Original one', pinned: false })
    expect((w.stored('mm.titles') as Record<string, string>).local_t1).toBeUndefined()
  })
})
