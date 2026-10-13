import { describe, expect, test } from 'claude-code/testing'

import { ME, NOW, ago, bandButtons, fakeApp, hooks, mm, next, paneButtons, pid, press, tool } from './fake-app.test-helper'
import type { Feed } from './queue'

// The bridge's own hooks in a pretend desktop app (fake-app.test-helper.ts): one store and one app shared by the threads
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

describe('F2: a write the engine refuses midway leaves nothing half done', () => {
  /** Client One's session ran in local_a and declared it alone: the sync links it by itself. */
  const declaredAlone = (sole: boolean): Feed => ({
    member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {},
    threads: [{ project_id: pid(1), session_id: 'cli-a', last_activity_at: ago(1), sole }],
  })
  /** Whether the bridge noted a failed write where its errors go (its heartbeat file). */
  const noted = (w: ReturnType<typeof fakeApp>, what: string) => w.written.some(f => f.text.includes('"writeError"') && f.text.includes(what))

  test('a refused mm.auto write leaves no link that `sole: false` cannot let go (P2)', async () => {
    const feed = declaredAlone(true)
    const w = fakeApp(feed, [{ sessionId: 'local_p2hub' }, { sessionId: 'local_p2a', title: 'Pipeline speed work' }])
    w.put('mm.threads', { 'cli-a': { app: 'local_p2a', at: Date.parse(ago(0)) } })
    const hub = w.session('local_p2hub')
    w.refuse('mm.auto', 1)
    let failed = ''
    await mm(hub, '').catch((err: unknown) => void (failed = String(err)))
    expect(failed).toContain('Lock file is already being held')
    // the link was never written without its auto record; what the sync did to the thread is on record
    expect(linksOf(w)[pid(1)]).toBeUndefined()
    expect((w.stored('mm.titles') as Record<string, string>).local_p2a).toBe('Pipeline speed work')
    expect((w.stored('mm.pins') as Record<string, { byUs: boolean }>).local_p2a?.byUs).toBe(true)
    // OW now says that session declared another project too: the thread is given back
    feed.threads = [{ project_id: pid(1), session_id: 'cli-a', last_activity_at: ago(1), sole: false }]
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(linksOf(w)[pid(1)]).toBeUndefined()
    expect(w.app.get('local_p2a')).toMatchObject({ title: 'Pipeline speed work', pinned: false })
    expect((w.stored('mm.pins') as Record<string, unknown>).local_p2a).toBeUndefined()
  })

  test('a link the bridge makes by itself always has its auto record, so `sole: false` lets it go', async () => {
    const feed = declaredAlone(true)
    const w = fakeApp(feed, [{ sessionId: 'local_p2bhub' }, { sessionId: 'local_p2b', title: 'Pipeline speed work' }])
    w.put('mm.threads', { 'cli-a': { app: 'local_p2b', at: Date.parse(ago(0)) } })
    const hub = w.session('local_p2bhub')
    // the links write itself refused: the auto record is there, the link is not
    w.refuse('mm.links', 1)
    await mm(hub, '').catch(() => undefined)
    expect(linksOf(w)[pid(1)]).toBeUndefined()
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(linksOf(w)[pid(1)]).toBe('local_p2b')
    expect((w.stored('mm.auto') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_p2b')
    feed.threads = [{ project_id: pid(1), session_id: 'cli-a', last_activity_at: ago(1), sole: false }]
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(linksOf(w)[pid(1)]).toBeUndefined()
    expect(w.app.get('local_p2b')).toMatchObject({ title: 'Pipeline speed work', pinned: false })
  })

  test('Update went, then the link write was refused: the second Update sends nothing, and the link is written again 1 to 3 seconds later (P6)', async () => {
    const w = fakeApp(declaredAlone(true), [{ sessionId: 'local_p6hub' }, { sessionId: 'local_p6a', title: 'Client One work' }])
    w.put('mm.threads', { 'cli-a': { app: 'local_p6a', at: Date.parse(ago(0)) } })
    const hub = w.session('local_p6hub')
    await mm(hub, '')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_p6a' })
    // the write of the link after the message went is refused
    w.refuse('mm.links', 1)
    expect(await mm(hub, 'update Client One')).toContain('Sent to Client One\'s thread')
    expect(w.sends().length).toBe(1)
    expect(noted(w, 'update: the link')).toBe(true)
    // what the thread now has was written first: the row reads Open, and the second Update sends nothing
    expect((w.stored('mm.sent') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_p6a')
    expect(await mm(hub, 'update Client One')).toBe('Client One\'s thread already has this. Open "22h left Client One reply" under Pinned.')
    expect(w.sends().length).toBe(1)
    // the check a moment later: the person's link, claimed and stamped
    await w.advance(3_100)
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_p6a' })
    expect(w.stored('mm.auto')).toEqual({})
    expect((w.stored('mm.acted') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_p6a')
  })

  test('Update went, then even the record of it was refused: this session still sends nothing twice, and the record is written again', async () => {
    const w = fakeApp(declaredAlone(true), [{ sessionId: 'local_p6bhub' }, { sessionId: 'local_p6b', title: 'Client One work' }])
    w.put('mm.threads', { 'cli-a': { app: 'local_p6b', at: Date.parse(ago(0)) } })
    const hub = w.session('local_p6bhub')
    await mm(hub, '')
    w.refuse('mm.sent', 1)
    expect(await mm(hub, 'update Client One')).toContain('Sent to Client One\'s thread')
    expect(noted(w, 'update: what the thread now has')).toBe(true)
    // the writes after it were each made on their own
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_p6b' })
    expect((w.stored('mm.acted') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_p6b')
    expect(await mm(hub, 'update Client One')).toContain('already has this')
    expect(w.sends().length).toBe(1)
    await w.advance(3_100)
    expect((w.stored('mm.sent') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_p6b')
  })

  test('a refused title write keeps the thread\'s own name: it is not renamed until its name is on record', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_tthub' }, { sessionId: 'local_tt', title: 'My own name' }])
    w.put('mm.links', { [pid(1)]: 'local_tt' })
    const hub = w.session('local_tthub')
    w.refuse('mm.titles', 1)
    await mm(hub, '').catch(() => undefined)
    expect(w.app.get('local_tt')).toMatchObject({ title: 'My own name', pinned: false })
    // the next sync keeps its name first, then renames and pins it
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect((w.stored('mm.titles') as Record<string, string>).local_tt).toBe('My own name')
    expect(w.app.get('local_tt')).toMatchObject({ title: '🟡 22h left · Client One · reply', pinned: true })
    // and /mm unlink gives it back
    await mm(w.session('local_tt'), 'unlink')
    expect(w.app.get('local_tt')).toMatchObject({ title: 'My own name', pinned: false })
  })

  test('F7: a pin the person took off stays off when the sync that saw it could not record it', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_f7hub' }, { sessionId: 'local_f7', title: 'Client One work' }])
    w.put('mm.links', { [pid(1)]: 'local_f7' })
    const hub = w.session('local_f7hub')
    await mm(hub, '')
    expect(w.app.get('local_f7')?.pinned).toBe(true)
    // the person takes our pin off; the sync that sees it cannot record that
    const thread = w.app.get('local_f7')
    if (thread) thread.pinned = false
    w.refuse('mm.unpinned', 1)
    await w.advance(6 * 60_000)
    await mm(hub, '').catch(() => undefined)
    // the next sync still sees it was the person: recorded now, and not pinned again
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(Object.keys(w.stored('mm.unpinned') as object)).toEqual(['local_f7'])
    expect(w.app.get('local_f7')?.pinned).toBe(false)
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(w.app.get('local_f7')?.pinned).toBe(false)
  })

  test('Start: the chip\'s record refused is noted, and written again 1 to 3 seconds later', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [] }
    const w = fakeApp(feed, [{ sessionId: 'local_sthub' }])
    const hub = w.session('local_sthub')
    w.refuse('mm.chips', 1)
    expect(await mm(hub, 'start Client One')).toBe('A chip for Client One is ready here: click Start on it.')
    expect(noted(w, 'start: the chip record')).toBe(true)
    await w.advance(3_100)
    const chips = w.stored('mm.chips') as Array<{ projectId: string; threadId: string }>
    expect(chips.map(c => [c.projectId, c.threadId])).toEqual([[pid(1), 'local_sthub']])
    expect(w.calls.filter(c => c.tool === 'spawn_task').length).toBe(1)
  })
})

describe('re-review of a446f5ab: Start after a chip was spent, a re-check after a move, a refused pin, the same name twice', () => {
  /**
   * Start pressed in a hub thread mints a chip; the person starts a thread from it, which takes the client;
   * later that thread is long, so the row offers Start again. `usedAfterCheck`: the chip is used after Start's
   * 1-to-3-second check, else before it.
   */
  async function chipSpentThenStartAgain(usedAfterCheck: boolean, tag: string) {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], mail: [mail(1, 'Client One')] }
    const hubId = `local_${tag}hub`
    const freshId = `local_${tag}new`
    const w = fakeApp(feed, [{ sessionId: hubId }, { sessionId: freshId, title: 'Fresh thread', lastActivityAt: ago(0) }])
    const hub = w.session(hubId)
    await mm(hub, '')
    const spawns = () => w.calls.filter(c => c.tool === 'spawn_task')
    expect(await press(hub, `start:${pid(1)}`)).toBe(true)
    expect(spawns().length).toBe(1)
    const prompt = String(spawns()[0]?.args.prompt)
    if (usedAfterCheck) await w.advance(3_100)
    // the person clicks Start on the chip: the new thread opens with its prompt and takes the client
    await hooks['prompt.submit']?.(w.session(freshId), { text: prompt, origin: { kind: 'sdk' } }, next)
    if (!usedAfterCheck) await w.advance(3_100)
    expect(linksOf(w)).toEqual({ [pid(1)]: freshId })
    // ⛔ the spent chip is not written back by Start's check: no chip waits for the client anywhere
    const waiting = ((w.stored('mm.chips') ?? []) as Array<{ projectId: string; superseded?: boolean }>).filter(c => c.projectId === pid(1) && !c.superseded)
    expect(waiting).toEqual([])
    // later that day the new thread is long, and nothing new came from the client: the row offers Start again
    w.put('mm.ctx', { [freshId]: { tokensUsed: 700_000, contextWindow: 1_000_000, percentUsed: 70, at: NOW } })
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect([...(await paneButtons(hub)).keys()]).toContain(`start:${pid(1)}`)
    expect(await press(hub, `start:${pid(1)}`)).toBe(true)
    // ⛔ and it mints: the spent chip is no reason to refuse it
    expect(spawns().length).toBe(2)
  }

  test('M1: the chip used within Start\'s 1-to-3-second check is not written back, and a later Start in the same thread mints (P8)', async () => {
    await chipSpentThenStartAgain(false, 'm1a')
  })

  test('M1: the chip used after that check: a later Start in the same thread mints (P8b)', async () => {
    await chipSpentThenStartAgain(true, 'm1b')
  })

  test('L2: Update, then the person makes that thread another client\'s within the check: it is not linked back to the first (P9)', async () => {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], mail: [mail(1, 'Client One'), mail(2, 'Client Two')] }
    const w = fakeApp(feed, [{ sessionId: 'local_l2hub' }, { sessionId: 'local_l2a', title: 'A work', lastActivityAt: ago(1) }])
    w.put('mm.links', { [pid(1)]: 'local_l2a' })
    const hub = w.session('local_l2hub')
    await mm(hub, '')
    expect(await press(hub, `update:${pid(1)}`)).toBe(true)
    expect(w.sends().length).toBe(1)
    // within a second, in that thread, the person makes it Client Two's
    expect(await mm(w.session('local_l2a'), 'link Client Two')).toBe('This thread is now Client Two\'s. Showing Client Two in the side pane.')
    await w.advance(3_100)
    const links = linksOf(w)
    expect(Object.values(links).filter(s => s === 'local_l2a').length).toBe(1)
    expect(links).toEqual({ [pid(2)]: 'local_l2a' })
  })

  test('L3: a pin the app refused is pinned on the next sync, never read as the person\'s unpin (P10)', async () => {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], mail: [mail(1, 'Client One')] }
    const w = fakeApp(feed, [{ sessionId: 'local_l3hub' }, { sessionId: 'local_l3a', title: 'A work' }])
    w.put('mm.links', { [pid(1)]: 'local_l3a' })
    const hub = w.session('local_l3hub')
    w.failPins.add('local_l3a')
    let failed = ''
    await mm(hub, '').catch((err: unknown) => void (failed = String(err)))
    expect(failed).toContain('set_pinned failed')
    expect((w.stored('mm.pins') as Record<string, { byUs: boolean }>).local_l3a?.byUs).toBe(false)
    w.failPins.clear()
    await w.advance(6 * 60_000)
    await mm(hub, '')
    expect(w.app.get('local_l3a')?.pinned).toBe(true)
    expect(w.stored('mm.unpinned') ?? {}).toEqual({})
  })

  test('L4: two clients with the same full name are told apart by their ids, and /mm link takes either form', async () => {
    const feed: Feed = { member: ME, role: 'builder', tickets: {}, threads: [], mail: [mail(1, 'Acme'), answered(2, 'Acme')] }
    const w = fakeApp(feed, [{ sessionId: 'local_l4' }])
    const t = w.session('local_l4')
    expect(await mm(t, 'link acme')).toBe('More than one client matches "acme": Acme (00000001), Acme (00000002). Type more of the name.')
    expect(w.stored('mm.links')).toBeUndefined()
    expect(await mm(t, 'link 00000002')).toBe('This thread is now Acme\'s. Nothing needs you on this client right now.')
    expect(linksOf(w)).toEqual({ [pid(2)]: 'local_l4' })
    expect(await mm(t, 'link Acme (00000001)')).toBe('This thread is now Acme\'s. Showing Acme in the side pane.')
    expect(linksOf(w)).toEqual({ [pid(1)]: 'local_l4' })
  })
})

// ---------------------------------------------------------------------------------------------------- 0.5.1
// Rob, 2026-10-13: "it takes quite a long time for anything to happen after we click a button to open the list
// or update threads or anything." S2: a press draws its answer at once from what its row was drawn from; the
// feed and the app are asked after, and the list is drawn again when they answer.

describe('S3: a press answers within 100 ms of fake time while OW takes 5 seconds to answer the feed', () => {
  type Queue = { header: string; note: string; rows: Array<{ projectId: string; state: string; reason: string }> }
  type Notice = { text: string }
  /** As many turns of the event loop as the work a press set going needs, with the fake clock standing still. */
  const settle = async () => {
    for (let i = 0; i < 20_000; i++) await Promise.resolve()
  }
  /**
   * Client One has a thread the person linked (local_s3a); Client Two has none. The hub synced once at 9 AM,
   * which is what the rows are drawn from; six minutes later OW is slow.
   */
  async function slowOw(tag: string) {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], drafts: [], mail: [mail(1, 'Client One'), mail(2, 'Client Two')] }
    const hubId = `local_${tag}hub`
    const w = fakeApp(feed, [{ sessionId: hubId }, { sessionId: `local_${tag}a`, title: 'Client One work' }])
    w.put('mm.links', { [pid(1)]: `local_${tag}a` })
    const hub = w.session(hubId)
    await mm(hub, '')
    await w.advance(6 * 60_000)
    w.delayFeed(5_000)
    const queue = () => w.view(hubId, 'queue') as Queue | undefined
    const notice = () => (w.view(hubId, 'notice') as Notice | undefined)?.text ?? ''
    const closeouts = () => w.fetched.filter(u => u.includes('/closeout')).length
    return { w, hub, hubId, queue, notice, closeouts }
  }

  test('the band\'s Open list and a typed /mm open the pane at once, drawn from the last sync; the refresh draws it again', async () => {
    const { w, hub, hubId, queue, closeouts } = await slowOw('s3l')
    const t0 = w.now()
    // the band's button, in a thread whose pane has nothing drawn yet
    const other = w.session('local_s3la')
    const open = (await bandButtons(hub)).get('mm-open-list')
    expect(open).toBeDefined()
    const before = w.opened.length
    open?.()
    await settle()
    expect(w.now() - t0).toBeLessThanOrEqual(100)
    expect(w.opened.slice(before)).toEqual([{ thread: hubId, id: 'mm-queue' }])
    expect(queue()?.header).toBe('Needs you now (2)')
    // drawn from the 9 AM sync, and it says so; the feed is being asked, and has not answered
    expect(queue()?.note).toContain('Updated 13:00 UTC')
    const asked = closeouts()
    await w.advance(5_000)
    await settle()
    expect(closeouts()).toBe(asked)
    expect(queue()?.note).toContain('Updated 13:06 UTC')
    // a typed /mm in another thread: the same at once, and its answer once the feed has answered
    const opens = w.opened.length
    const typed = mm(other, '')
    await settle()
    expect(w.opened.slice(opens)).toEqual([{ thread: 'local_s3la', id: 'mm-queue' }])
    expect((w.view('local_s3la', 'queue') as Queue | undefined)?.header).toBe('Needs you now (2)')
    await w.advance(5_000)
    expect(await typed).toBe('2 clients need you; 1 thread pinned. The list is in the side pane.')
  })

  test('Update says it is checking at once and sends exactly once when the feed answers; Start answers at once; Open and Drafts draw within 100 ms; each refresh then draws the list again', async () => {
    const { w, hub, hubId, queue, notice } = await slowOw('s3p')
    const t0 = w.now()
    const spawns = () => w.calls.filter(c => c.tool === 'spawn_task').length

    // Update on Client One: the one press that sends reads the feed first, whoever linked the thread (M1)
    expect(await press(hub, `update:${pid(1)}`)).toBe(true)
    expect(w.now() - t0).toBeLessThanOrEqual(100)
    expect(notice()).toBe('Checking…')
    expect(w.sends()).toEqual([])
    // the feed answers: one send, then the pass over that same feed pins and names the thread, the line says
    // where it is, and the row reads Open thread
    await w.advance(5_000)
    await settle()
    expect(w.sends().map(s => s.args.session_id)).toEqual(['local_s3pa'])
    expect(notice()).toBe('Sent to Client One\'s thread: open "22h left Client One reply" under Pinned.')
    expect(w.app.get('local_s3pa')).toMatchObject({ title: '🟡 22h left · Client One · reply', pinned: true })
    expect(queue()?.rows.find(r => r.projectId === pid(1))?.state).toBe('current')

    // Open, once the feed this session read is a minute old: the answer at once, the refresh after
    await w.advance(61_000)
    const t1 = w.now()
    expect(await press(hub, `open:${pid(1)}`)).toBe(true)
    expect(w.now() - t1).toBeLessThanOrEqual(100)
    expect(notice()).toBe('Open "22h left Client One reply" under Pinned.')
    expect(w.sends().length).toBe(1)

    // Drafts on Client Two: its part of the pane, at once, with nothing fetched for it
    const reads = w.fetched.length
    expect(await press(hub, `drafts:${pid(2)}`)).toBe(true)
    expect(w.now() - t1).toBeLessThanOrEqual(100)
    expect((w.view(hubId, 'view') as { text: string } | undefined)?.text).toContain('## Client Two')
    expect(w.fetched.slice(reads).filter(u => !u.includes('/closeout'))).toEqual([])

    // Start on Client Two: one chip, at once
    expect(await press(hub, `start:${pid(2)}`)).toBe(true)
    expect(w.now() - t1).toBeLessThanOrEqual(100)
    expect(spawns()).toBe(1)
    expect(notice()).toBe('A chip for Client Two is ready here: click Start on it.')
    // the refreshes land: Client Two's row then says where its chip is
    await w.advance(5_000)
    await settle()
    expect(queue()?.rows.find(r => r.projectId === pid(2))?.reason).toBe('the chip is ready here')
    expect(w.sends().length).toBe(1)
    expect(spawns()).toBe(1)
  })

  test('Update on a thread the bridge linked by itself asks the feed first (B3), says it is checking at once, and sends once', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [{ project_id: pid(1), session_id: 'cli-s3b', last_activity_at: ago(1), sole: true }] }
    const w = fakeApp(feed, [{ sessionId: 'local_s3bhub' }, { sessionId: 'local_s3ba', title: 'Client One work' }])
    w.put('mm.threads', { 'cli-s3b': { app: 'local_s3ba', at: Date.parse(ago(0)) } })
    const hub = w.session('local_s3bhub')
    await mm(hub, '')
    expect((w.stored('mm.auto') as Record<string, { sid: string }>)[pid(1)]?.sid).toBe('local_s3ba')
    w.delayFeed(5_000)
    expect(await press(hub, `update:${pid(1)}`)).toBe(true)
    // nothing sent until the feed says the thread is still Client One's alone; the press says it is at it
    expect(w.sends()).toEqual([])
    expect((w.view('local_s3bhub', 'notice') as Notice | undefined)?.text).toBe('Checking…')
    await w.advance(5_000)
    await settle()
    expect(w.sends().map(s => s.args.session_id)).toEqual(['local_s3ba'])
    expect((w.view('local_s3bhub', 'notice') as Notice | undefined)?.text).toContain('Sent to Client One\'s thread')
  })

  test('Update on a thread the bridge linked by itself, whose session the feed now shows declared another project too: nothing is sent (B3)', async () => {
    const feed: Feed = { member: ME, role: 'founder', mail: [mail(1, 'Client One')], tickets: {}, threads: [{ project_id: pid(1), session_id: 'cli-s3c', last_activity_at: ago(1), sole: true }] }
    const w = fakeApp(feed, [{ sessionId: 'local_s3chub' }, { sessionId: 'local_s3ca', title: 'Pipeline speed' }])
    w.put('mm.threads', { 'cli-s3c': { app: 'local_s3ca', at: Date.parse(ago(0)) } })
    const hub = w.session('local_s3chub')
    await mm(hub, '')
    // drawn while the link stood; the feed then says otherwise
    feed.threads = [{ project_id: pid(1), session_id: 'cli-s3c', last_activity_at: ago(1), sole: false }]
    expect(await press(hub, `update:${pid(1)}`)).toBe(true)
    await settle()
    expect(w.sends()).toEqual([])
    expect((w.view('local_s3chub', 'notice') as Notice | undefined)?.text).toBe('That thread is no longer available. The list has been refreshed.')
    // and the refresh after it let the link go: its own name back, our pin off
    expect(w.stored('mm.links')).toEqual({})
    expect(w.app.get('local_s3ca')).toMatchObject({ title: 'Pipeline speed', pinned: false })
  })
})

// ---------------------------------------------------------------------------------------------------- 0.5.1 fix round 1
// The independent review of e4511774: M1, Update sent from a stale stored sync (A1, A2); L3, a refresh that
// failed after a press was silent.

describe('M1: Update, the one press that sends, reads the feed once before every send', () => {
  type Notice = { text: string }
  const settle = async () => {
    for (let i = 0; i < 20_000; i++) await Promise.resolve()
  }
  /** Client Three has one unanswered message and a thread the person linked; the hub has synced once. */
  async function linkedRow(tag: string, n: number) {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], drafts: [], mail: [mail(n, 'Client Three')] }
    const hubId = `local_${tag}hub`
    const w = fakeApp(feed, [{ sessionId: hubId }, { sessionId: `local_${tag}a`, title: 'Client Three work' }])
    w.put('mm.links', { [pid(n)]: `local_${tag}a` })
    const hub = w.session(hubId)
    await mm(hub, '')
    const notice = () => (w.view(hubId, 'notice') as Notice | undefined)?.text ?? ''
    return { feed, w, hub, hubId, notice }
  }

  test('A1: its message answered since the row was drawn: nothing is sent, it says so, and the list is drawn again', async () => {
    const { feed, w, hub, hubId, notice } = await linkedRow('m1a', 31)
    feed.mail = []
    await w.advance(4 * 60_000)
    expect(await press(hub, `update:${pid(31)}`)).toBe(true)
    await settle()
    expect(w.sends()).toEqual([])
    expect(notice()).toBe('Client Three has nothing waiting now. The list has been refreshed.')
    expect((w.view(hubId, 'queue') as { header: string } | undefined)?.header).toBe('Nothing needs you right now.')
  })

  test('A2: the feed down, and a stored sync two days old: nothing is sent, and it says so', async () => {
    const { w, hub, notice } = await linkedRow('m1b', 32)
    w.feedAnswers(503)
    await w.advance(48 * 3_600_000)
    expect(await press(hub, `update:${pid(32)}`)).toBe(true)
    await settle()
    expect(w.sends()).toEqual([])
    expect(notice()).toBe('Couldn\'t reach the list to check Client Three. Nothing was sent; try again in a minute.')
  })

  test('a second message since the row was drawn: the kickoff is the client as the feed has it now', async () => {
    const { feed, w, hub } = await linkedRow('m1c', 33)
    feed.mail = [...(feed.mail ?? []), mail(33, 'Client Three', 1)]
    expect(await press(hub, `update:${pid(33)}`)).toBe(true)
    await settle()
    const sent = w.sends()
    expect(sent.length).toBe(1)
    expect(String(sent[0]?.args.message)).toContain('New since this thread last worked on this client: 2 messages waiting.')
    expect(String(sent[0]?.args.message)).toContain('needs a reply: 2 client message(s) waiting')
  })
})

describe('L3: a refresh that fails after a press shows in one line, until a sync works', () => {
  const settle = async () => {
    for (let i = 0; i < 20_000; i++) await Promise.resolve()
  }
  type Queue = { header: string; warning?: string }
  /** Every text the thread's pane draws. */
  async function paneTexts($: unknown): Promise<string[]> {
    const tree = await hooks['ui.render:{"component":"Pane","requestId":"mm-queue"}']?.($, { props: {} }, next)
    const out: string[] = []
    const walk = (node: unknown, depth: number): void => {
      if (typeof node === 'string') out.push(node)
      if (!node || typeof node !== 'object' || depth > 40) return
      if (Array.isArray(node)) {
        for (const n of node) walk(n, depth + 1)
        return
      }
      const o = node as { props?: Record<string, unknown>; children?: unknown }
      walk(o.props?.children, depth + 1)
      walk(o.children, depth + 1)
    }
    walk(tree, 0)
    return out
  }
  const LINE = 'Couldn\'t refresh the list. Showing what was last loaded.'
  /** Client Four has no thread: its row's Start answers at once, and the list is then brought up to date. */
  async function startThenFail(tag: string, n: number) {
    const feed: Feed = { member: ME, role: 'founder', tickets: {}, threads: [], drafts: [], mail: [mail(n, 'Client Four')] }
    const hubId = `local_${tag}hub`
    const w = fakeApp(feed, [{ sessionId: hubId }])
    const hub = w.session(hubId)
    await mm(hub, '')
    // a minute on, OW stops answering: the press answers, and its refresh fails
    await w.advance(61_000)
    w.feedAnswers(503)
    expect(await press(hub, `start:${pid(n)}`)).toBe(true)
    await settle()
    expect((w.view(hubId, 'notice') as { text: string } | undefined)?.text).toBe('A chip for Client Four is ready here: click Start on it.')
    return { w, hub, hubId }
  }

  test('the press answers, its refresh fails: one line under the list it still shows; the next sync that works takes it away', async () => {
    const { w, hub, hubId } = await startThenFail('l3a', 34)
    expect((w.view(hubId, 'queue') as Queue | undefined)?.warning).toBe(LINE)
    expect(await paneTexts(hub)).toContain(LINE)
    expect((await paneTexts(hub)).filter(t => t === LINE).length).toBe(1)
    expect(await paneTexts(hub)).toContain('Needs you now (1)')
    // OW answers again: a sync that works draws the list without it
    w.feedAnswers(200)
    await mm(hub, '')
    expect((w.view(hubId, 'queue') as Queue | undefined)?.warning).toBeUndefined()
    expect(await paneTexts(hub)).not.toContain(LINE)
  })

  test('in a thread that does not sync, the line goes once the store holds a sync newer than the failure', async () => {
    const { w, hub, hubId } = await startThenFail('l3b', 35)
    expect((w.view(hubId, 'queue') as Queue | undefined)?.warning).toBe(LINE)
    // another thread holds the sync, and its sync works a moment later
    w.feedAnswers(200)
    await w.advance(1_000)
    const other = w.session('local_l3bother')
    await mm(other, '')
    w.put('mm.lease', { owner: 'cli:local_l3bother', until: w.now() + 24 * 3_600_000 })
    // this thread's own timer: no sync of its own, and the line goes
    await hooks['session.start']?.(hub, { cwd: '/w', surface: 'desktop', isInteractive: false }, next)
    await w.advance(4_000)
    await settle()
    expect((w.view(hubId, 'queue') as Queue | undefined)?.warning).toBeUndefined()
  })
})
