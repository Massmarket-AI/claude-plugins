import { describe, expect, test } from 'claude-code/testing'

import { buildQueue, needsYouNow, rowLine } from './queue'
import type { Feed, QueueItem } from './queue'
import { BUILD_SHOWN, LABEL, buildHeading, buildMore, buildOf, buildShown, foldGroups, paneText, recommend, rowDetail, rowExtra, rowFor } from './threads'
import type { Row } from './threads'
import { MORE, numbersNote, parseClientTime, plainNumbers, taskKey, trackLines } from './track'
import type { TimeProject } from './track'

// (0.7.5) The side panel redesign. Rob, 2026-10-27: "Yes, redesign the side panel the way you laid out: queue first, one
// merged time list, plain numbers." Every client and address below is made up.

/** A New York wall time in October 2026 (daylight time, UTC-4) as an instant. */
const et = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-04:00`)
const at = (s: string) => new Date(et(s)).toISOString()
/** Monday 11 AM. */
const NOW = et('2026-10-12 11:00')

const ACME = '11111111-1111-1111-1111-111111111111'
const ME = 'builder-a@example.com'

const FEED: Feed = {
  member: ME,
  role: 'builder',
  tickets: { due_today: [{ ticket_id: 't1', project_id: ACME, project_name: 'Acme Roofing — Pat', title: 'Send the intake form', due_at: at('2026-10-12 16:00'), due_source: 'commitment', assignee_email: ME }] },
}
/** Acme with one committed task due at 4 PM today, then whatever a test sets on it. */
const acme = (over: Partial<QueueItem> = {}): QueueItem => {
  const it = buildQueue(FEED, NOW).find(i => i.projectId === ACME)
  if (!it) throw new Error('no fixture item')
  return { ...it, ...over }
}
const update = recommend([{ sid: 'local_a', title: 'Acme', lastAt: et('2026-10-12 09:00'), source: 'linked' }], undefined, NOW)
const none = recommend([], undefined, NOW)

describe('0.7.5: a row is one line: the chip, the client, what is needed, the time left', () => {
  test('due today, late, nothing due, the founder\'s OK', async () => {
    expect(rowLine(acme(), NOW)).toBe('🔴 Acme Roofing · task · 5h left')
    // (0.7.12) late says when it was due, and undated says so (until 0.7.12: `1d late`, and nothing for undated)
    expect(rowLine(acme({ dueAt: et('2026-10-09 11:00') }), NOW)).toBe('🔴 Acme Roofing · task · 1d late, due Fri 11 AM')
    expect(rowLine(acme({ dueAt: et('2026-10-13 09:00') }), NOW)).toBe('🟡 Acme Roofing · task · 22h left')
    expect(rowLine(acme({ noDue: true, dueAt: Number.NaN }), NOW)).toBe('🟡 Acme Roofing · task · no due date')
    expect(rowLine(acme({ kind: 'ok', messages: 1, tasks: 0, dueAt: et('2026-10-09 11:00') }), NOW)).toBe('🔴 Acme Roofing · your OK · 1d late, due Fri 11 AM')
  })

  test('then what else the thread\'s name says: how many new, with whom, flagged; and no thread yet', async () => {
    expect(rowLine(acme({ kind: 'reply', messages: 3, flagged: true }), NOW)).toBe('🔴 Acme Roofing · reply · 5h left · 3 new · flagged')
    expect(rowLine(acme({ kind: 'reply', messages: 1, open: { id: 'p', state: 'held_by_other', by: 'J Smith', unsent: 1, newer: false } as QueueItem['open'] }), NOW)).toContain(' · with J Smith')
    expect(rowLine(acme({ dueAt: et('2026-10-14 15:00') }), NOW, { fresh: true })).toBe('🟡 Acme Roofing · task · 2d left · no thread')
    // R4: no thread and due within the pin's window: red
    expect(rowLine(acme({ dueAt: et('2026-10-14 15:00') }), NOW, { fresh: true, pins: true })).toBe('🔴 Acme Roofing · task · 2d left · no thread')
  })

  test('a row holds that line as its title, and never the action or its reason', async () => {
    const row = rowFor(acme(), update, NOW, { needsYou: true })
    expect(row.title).toBe('🔴 Acme Roofing · task · 5h left')
    expect(rowDetail(row)).toBe('')
    expect(paneText([row], 'Needs you now (1)', 'Updated 11:00 AM')).toBe(
      ['Needs you now (1)', '1. 🔴 Acme Roofing · task · 5h left', `   [ ${LABEL.update} ] [ ${LABEL.drafts} ]`, '', 'Updated 11:00 AM'].join('\n'),
    )
    const fresh = rowFor(acme(), none, NOW, { needsYou: true })
    expect(fresh.title).toBe('🔴 Acme Roofing · task · 5h left · no thread')
  })
})

describe('0.7.5: a second line only for what the first does not say', () => {
  test('drafts not sent, out of date, ready', async () => {
    const mine = (unsent: number) => ({ id: 'p', state: 'held_by_me', by: ME, unsent, newer: false }) as QueueItem['open']
    expect(rowExtra(acme({ kind: 'reply', messages: 1, tasks: 0, open: mine(2) }))).toBe('2 drafts not sent')
    expect(rowExtra(acme({ kind: 'reply', messages: 1, tasks: 0, open: mine(0) }))).toBe('')
    expect(rowExtra(acme({ kind: 'reply', messages: 1, tasks: 0, open: { id: 'p', state: 'stale', by: '', unsent: 0, newer: true } as QueueItem['open'] }))).toBe('drafts out of date')
    expect(rowExtra(acme({ kind: 'ready', messages: 1, tasks: 0, packageId: 'p' }))).toBe('')
  })

  test('the founder\'s OK: who sends it; a task beside a reply; one message beside a task', async () => {
    expect(rowExtra(acme({ kind: 'ok', messages: 1, tasks: 0, ok: { sends: 'Asif' } }))).toBe('Asif sends')
    expect(rowExtra(acme({ kind: 'reply', messages: 1 }))).toBe('1 task due')
    expect(rowExtra(acme({ messages: 1 }))).toBe('1 message waiting')
    // the first line's `task` is the one there is: nothing to add
    expect(rowExtra(acme())).toBe('')
  })

  test('tasks of every kind, counted as what they are', async () => {
    const it = acme({ kind: 'task', tasks: 4, etaAsks: [{ id: 'e1', title: 'ETA', neededBy: NOW, ask: '' }], undatedTitles: ['a', 'b'] } as Partial<QueueItem>)
    expect(rowExtra(it)).toBe('1 task due · 1 needs an ETA · 2 tasks with no date')
  })

  test('a row not the viewer\'s, or with items still open, has none: its note or its items say it', async () => {
    const row: Row = { ...rowFor(acme(), update, NOW), extra: 'x', note: 'Ask J Smith first' }
    expect(rowDetail(row)).toBe('')
    expect(rowDetail({ ...rowFor(acme(), update, NOW), extra: 'x', stillOpen: ['the logo'] })).toBe('')
    // a row an older version drew has no `extra`: one line
    const { extra: _drop, ...older } = { ...rowFor(acme({ messages: 1 }), update, NOW) }
    expect(rowDetail(older as Row)).toBe('')
  })
})

describe('0.7.5: Your build queue, and the groups on one line', () => {
  const queued = (n: number): QueueItem =>
    acme({
      projectId: ACME, client: 'Massmarket AI', kind: 'queue', tasks: 0, noDue: true, dueAt: Number.NaN,
      queue: { tickets: Array.from({ length: n }, (_, i) => ({ id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `Ticket ${i + 1}`, tier: 'tier 1', reason: 'why', severity: '', rank: i })), total: 257 },
    } as Partial<QueueItem>)

  test('the top 3 by rank, then how many more and where', async () => {
    const it = queued(10)
    const linked = buildOf(it, rowFor(it, update, NOW))
    expect(linked?.top).toEqual(['Ticket 1', 'Ticket 2', 'Ticket 3'])
    expect(BUILD_SHOWN).toBe(3)
    expect(linked && buildHeading(linked)).toBe('Your build queue · 257')
    expect(linked && buildMore(linked)).toBe('+ 254 more in your Massmarket AI thread')
    const unlinked = buildOf(it, rowFor(it, none, NOW))
    expect(unlinked && buildMore(unlinked)).toBe('+ 254 more in the queue')
    expect(buildOf(acme(), rowFor(acme(), update, NOW))).toBeUndefined()
  })

  test('a long title is cut to one line; the founder\'s late teammate tickets ride along, as they did on its row', async () => {
    const long = queued(1)
    const ticket = { ...(long.queue?.tickets[0] as NonNullable<QueueItem['queue']>['tickets'][number]), title: 'HighLevel mobile app cannot answer inbound calls - at least 3 clients affected in the last few days' }
    const mates = [
      { by: 'Has9', id: '99999999-1111-4111-8111-111111111111', title: 'A', lateSince: NOW - 3_600_000, eta: true },
      { by: 'Has9', id: '99999999-2222-4111-8111-111111111111', title: 'B', lateSince: NOW - 3_600_000, eta: true },
      { by: 'Asif', id: '99999999-3333-4111-8111-111111111111', title: 'C', lateSince: NOW - 3_600_000, eta: false },
    ]
    const it = { ...long, queue: { tickets: [ticket], total: 1 }, mates } as QueueItem
    const b = buildOf(it, rowFor(it, update, NOW))
    expect(b?.top).toEqual(['HighLevel mobile app cannot answer inbound calls - at least 3 clients a…'])
    expect(b?.top[0]?.length).toBe(72)
    expect(b?.late).toBe('3 late with Has9 and Asif')
    expect(buildMore(b as NonNullable<typeof b>)).toBe('')
  })

  test('drawn in every thread but the one it points at; never counted under Needs you now', async () => {
    const it = queued(10)
    const b = buildOf(it, rowFor(it, update, NOW))
    expect(buildShown(b, 'local_other')).toBe(true)
    expect(buildShown(b, 'local_a')).toBe(false)
    expect(needsYouNow(it)).toBe(false)
    expect(needsYouNow(acme())).toBe(true)
    // the founder's undated client tickets alone: under No due date, not Needs you now
    expect(needsYouNow(acme({ tasks: 2, noDue: true, dueAt: Number.NaN, undatedTasks: 2, undatedTitles: ['a', 'b'] } as Partial<QueueItem>))).toBe(false)
  })

  test('No due date is the last group; the headings are drawn on one line in the plain text', async () => {
    const row = rowFor(acme(), update, NOW, { needsYou: true })
    const old = rowFor(acme({ client: 'Bolt' }), update, NOW)
    // (0.7.12) the Older group is gone: With a teammate stands where it stood (until 0.7.12: `older: [old]`, 'Older (1)')
    const groups = foldGroups({ rows: [row], teammate: [old], undated: [old, old] })
    expect(groups.map(g => g.heading)).toEqual(['With a teammate (1)', 'No due date (2)'])
    expect(groups[1]?.rows.map(r => r.n)).toEqual([3, 4])
    const it = queued(10)
    const text = paneText([row], 'Needs you now (1)', 'Updated 11:00 AM', { teammate: [old], build: buildOf(it, rowFor(it, update, NOW)) })
    expect(text.split('\n').slice(3, 10)).toEqual([
      '',
      'Your build queue · 257',
      ' 1. Ticket 1',
      ' 2. Ticket 2',
      ' 3. Ticket 3',
      ' + 254 more in your Massmarket AI thread',
      `   [ ${LABEL.open} ]`,
    ])
    expect(text).toContain('\n\nWith a teammate (1)\n')
    // (0.7.12) a pane stored by 0.7.11 with an `older` group draws no such group
    const stale = paneText([row], 'Needs you now (1)', 'Updated 11:00 AM', { older: [old] } as Parameters<typeof paneText>[3])
    expect(stale).not.toContain('Older')
    expect(foldGroups({ rows: [row], older: [old] } as Parameters<typeof foldGroups>[0])).toEqual([])
  })
})

describe('0.7.5: the Tracking part at the bottom, closed to one line, one time list, plain numbers', () => {
  const p = parseClientTime({
    as_of: new Date(NOW).toISOString(),
    viewer: { email: 'rob@example.com', can_see_leverage: true },
    projects: [{
      project_id: ACME, name: 'Acme Roofing — Pat',
      today: {
        client_minutes: 150, thread_minutes: 204, parallel: 1.36, jarvis_minutes: 30,
        people: [{ email: 'rob@example.com', name: 'Rob Eason', minutes: 131 }, { email: 'asif@example.com', name: 'Asif K', minutes: 19 }],
        tasks: [
          { task: 'Breach cleanup', ticket_id: null, minutes: 101, thread_count: 2, people: ['rob@example.com'], last_activity_at: '', active_now: true },
          { task: 'Side panel for Joseph', ticket_id: null, minutes: 85, thread_count: 1, people: ['rob@example.com'], last_activity_at: '', active_now: false },
          { task: 'Marketplace price', ticket_id: null, minutes: 19, thread_count: 1, people: ['asif@example.com'], last_activity_at: '', active_now: false },
        ],
      },
      week: { client_minutes: 600, thread_minutes: 900, parallel: 1.5, jarvis_minutes: 120, people: [], tasks: [] },
      threads: [
        { session_id: 'mine', title: 'Breach cleanup', member_email: 'rob@example.com', member_name: 'Rob', task: 'Breach cleanup', ticket_id: null, minutes_today: 42, last_activity_at: '', active_now: true },
        { session_id: 'other', title: 'Breach rotation', member_email: 'rob@example.com', member_name: 'Rob', task: 'Breach cleanup', ticket_id: null, minutes_today: 59, last_activity_at: '', active_now: false },
        { session_id: 'joseph', title: 'Joseph thread', member_email: 'rob@example.com', member_name: 'Rob', task: 'Side panel for Joseph', ticket_id: null, minutes_today: 85, last_activity_at: '', active_now: false },
      ],
      leverage: { ratio: 2, build_hours: 4, actual_hours: 2, window: '', note: '' },
    }],
  })?.projects[0] as TimeProject
  const drawn = (mine = 'mine', failedAt?: number) =>
    trackLines({ client: 'Massmarket internal', task: 'Breach cleanup', time: { at: NOW, asOf: new Date(NOW).toISOString(), p, ...(failedAt ? { failedAt } : {}) }, missing: false, canSeeLeverage: true, mine: sid => sid === mine, openable: sid => `app_${sid}` })

  test('the one line it closes to: this thread, its task, its minutes today, or not counted yet', async () => {
    expect(drawn()[0]).toEqual({ text: '⏱ This thread: Massmarket internal · Breach cleanup · 42m today', part: 'head' })
    expect(drawn('nobody')[0]?.text).toBe('⏱ This thread: Massmarket internal · Breach cleanup · not counted yet')
    expect(trackLines({ client: 'Acme Roofing', missing: true, canSeeLeverage: false, mine: () => false }).map(l => l.text)).toEqual(['⏱ This thread: Acme Roofing · no task declared yet', 'Time numbers are not available yet.'])
  })

  test('opened: one numbers line in plain words, then ONE time list by task; no Tasks today, no Threads today, no As of', async () => {
    const body = drawn().filter(l => l.part === undefined && l.under === undefined)
    expect(body.map(l => l.text)).toEqual([
      'Today: 2.5 h of your time · 3.4 h of thread time',
      'Breach cleanup · 1h 41m · Rob · 2 threads',
      'Side panel for Joseph · 1h 25m · Rob',
      'Marketplace price · 19m · Asif',
    ])
    const texts = drawn().map(l => l.text)
    for (const gone of ['Tasks today', 'Threads today', 'Numbers']) expect(texts).not.toContain(gone)
    expect(texts.some(t => t.startsWith('As of'))).toBe(false)
    expect(plainNumbers('Today', p.today as NonNullable<TimeProject['today']>)).toBe('Today: 2.5 h of your time · 3.4 h of thread time')
  })

  test('a task with one other thread opens it on a press; one with several opens to its threads', async () => {
    const lines = drawn()
    expect(lines.find(l => l.text.startsWith('Side panel for Joseph'))?.open).toBe('app_joseph')
    const key = taskKey({ task: 'Breach cleanup' })
    expect(lines.find(l => l.text.startsWith('Breach cleanup'))?.toggle).toBe(key)
    expect(lines.filter(l => l.under === key)).toEqual([
      { text: 'Breach cleanup · Rob · 42m (this thread)', under: key },
      { text: 'Breach rotation · Rob · 59m', under: key, open: 'app_other' },
    ])
    // from the Joseph thread itself: its own task opens nothing, and says so
    expect(drawn('joseph').find(l => l.text.startsWith('Side panel for Joseph'))).toEqual({ text: 'Side panel for Joseph · 1h 25m · Rob (this thread)' })
  })

  test('behind More: the week, parallel, Jarvis, leverage and the note, in the new words', async () => {
    expect(drawn().filter(l => l.part === 'more').map(l => l.text)).toEqual([
      'This week: 10.0 h of your time · 15.0 h of thread time',
      'Parallel: 1.4× today · 1.5× this week',
      'Jarvis: 0.5 h today · 2.0 h this week',
      'Leverage: 2.0× (4.0 quoted hours done in 2.0 h, last 20 business days)',
      numbersNote('Massmarket internal'),
    ])
    expect(numbersNote('Acme Roofing')).toBe(
      'Your time counts each minute once per person. Thread time counts every thread in full, so two threads at once count twice. Parallel is thread time divided by your time. Jarvis is work done for Acme Roofing with nobody in the thread.',
    )
    expect(MORE).toBe('More')
  })

  test('a read that failed says when its numbers are from, in the person\'s own clock', async () => {
    const lines = drawn('mine', NOW + 60_000)
    const failed = lines.find(l => l.text.startsWith('Could not refresh'))
    expect(failed?.dim).toBe(true)
    expect(failed?.text).toMatch(/^Could not refresh; these numbers are from \d{1,2}:\d{2}\s[AP]M\.$/)
    expect(failed?.text).not.toContain('UTC')
  })
})
