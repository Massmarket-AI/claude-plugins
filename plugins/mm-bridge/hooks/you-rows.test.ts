// (0.7.72) The You section's client rows and the band's "next" (you.ts): what is needed, by when in business days, why, the pin, and the
// order. Pure functions over made-up items; every client is made up.

import { describe, expect, test } from 'claude-code/testing'
import type { QueueItem } from './queue'
import { NOTHING_NEEDS_YOU, shortAsk, subjectOf, youAsk, youBand, youBandText, youClock, youPin, youRow, youRows } from './you'

// Tuesday 2026-11-24, 10 AM in New York
const NOW = Date.parse('2026-11-24T15:00:00Z')
const H = 3600_000
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** An item as the sync builds one, with nothing on it but what a test sets. */
const item = (over: Partial<QueueItem> & { client: string }): QueueItem => ({
  projectId: P(1),
  projectName: over.client,
  dueAt: Infinity,
  kind: 'task',
  messages: 0,
  tasks: 0,
  packageId: null,
  coversThrough: null,
  packageUpdatedAt: null,
  flagged: false,
  mail: [],
  taskTitles: [],
  open: null,
  ok: null,
  newest: { mail: 0, pkg: 0, task: 0 },
  ...over,
})
const mail = (sender: string, subject: string, at = '2026-11-24T13:00:00Z') => ({ at, sender, subject, snippet: '' })

describe('0.7.72: what is needed, from the item itself', () => {
  test('a reply package ready for the go: approve the reply, to the newest sender, about their subject', () => {
    const it = item({ client: 'Crucial Hire', kind: 'ready', packageId: 'pkg', messages: 2, mail: [mail('Zach Hill <zach@crucial.example>', 'Re: Invite failures', '2026-11-24T14:00:00Z'), mail('amy@crucial.example', 'Older', '2026-11-23T14:00:00Z')] })
    expect(youAsk(it, NOW)).toEqual({ ask: 'approve the reply to Zach Hill about "Invite failures"', from: 'package' })
  })

  test('a package with no client message: the package itself', () => {
    expect(youAsk(item({ client: 'Paradigm Group', kind: 'ready', packageId: 'pkg' }), NOW)).toEqual({ ask: "approve Paradigm Group's reply package", from: 'package' })
  })

  test('a client message with no package yet: answer them, and how many more', () => {
    const it = item({ client: 'Acme Roofing', kind: 'reply', messages: 3, mail: [mail('jo.smith@acme.example', 'Fwd: Quote for the roof')] })
    expect(youAsk(it, NOW)).toEqual({ ask: 'answer Jo Smith about "Quote for the roof" (+2 more)', from: 'mail' })
  })

  test('a draft the person holds and has not sent', () => {
    const it = item({ client: 'Bolt Staffing', kind: 'reply', messages: 1, mail: [mail('Sam', 'Hours')], open: { id: 'o', state: 'held_by_me', by: '', at: null, unsent: 2, newer: 0 } })
    expect(youAsk(it, NOW)).toEqual({ ask: 'send your draft to Sam about "Hours" (2 left)', from: 'draft' })
  })

  test("the founder's OK, and who sends it", () => {
    const it = item({ client: 'Cedar Dental', kind: 'ok', packageId: 'pkg', messages: 1, mail: [mail('Dr Lee', 'Schedule')], ok: { sends: 'Asif' } })
    expect(youAsk(it, NOW)).toEqual({ ask: 'give your OK on the reply to Dr Lee about "Schedule" (Asif sends it)', from: 'ok' })
  })

  test("a teammate's internal ask, with its words", () => {
    const it = item({ client: 'Delta Law', kind: 'ask', asks: [{ id: 'a', asker: 'Asif', askedAt: NOW - H, dueAt: NOW + H, snippet: 'Can we move the call to Thursday?', hasDraft: false, link: '', draftSha: null }] })
    // the words are kept to letters, digits and plain punctuation (`cleanText`), as every text from the feed is
    expect(youAsk(it, NOW)).toEqual({ ask: 'answer Asif\'s ask: "Can we move the call to Thursday"', from: 'ask' })
  })

  test('an ETA owed, an owner to give, and a follow-up go', () => {
    expect(youAsk(item({ client: 'E', tasks: 1, etaAsks: [{ id: 'e', title: 'Inbound lead router', neededBy: NOW + H }] }), NOW)).toEqual({ ask: 'give an ETA for "Inbound lead router"', from: 'eta' })
    expect(youAsk(item({ client: 'F', tasks: 2, assignAsks: [{ id: 'f', title: 'Voice AI build', assignBy: NOW }, { id: 'g', title: 'KB', assignBy: NOW }] }), NOW)).toEqual({ ask: 'assign an owner to "Voice AI build" (+1 more)', from: 'owner' })
    const go = item({ client: 'G', kind: 'go', go: { packageId: P(9), steps: 3, firstAt: null, firstKind: 'client_sms', by: 'me', mine: true } })
    expect(youAsk(go, NOW)).toEqual({ ask: 'give your go on 3 follow-ups (first text)', from: 'go' })
  })

  test('a dated ticket: deliver it; past its start-by with the work not started: start it', () => {
    const it = item({ client: 'Hub Co', tasks: 1, taskTitles: ['Inbound lead router and assignment rules'], dueAt: NOW + 30 * H })
    expect(youAsk(it, NOW)).toEqual({ ask: 'deliver "Inbound lead router and assignment rules"', from: 'task' })
    expect(youAsk({ ...it, startBy: NOW - H }, NOW).ask).toBe('start "Inbound lead router and assignment rules"')
  })

  test('what the server found still open after our reply comes first', () => {
    const it = item({ client: 'Crucial Hire', kind: 'ready', packageId: 'pkg' })
    expect(youAsk(it, NOW, ['the invite link for Zach', 'the price'])).toEqual({ ask: 'finish what your reply to Crucial Hire left open: the invite link for Zach (+1 more)', from: 'open' })
  })

  test('nothing on the item names a specific ask: said so, as `none`', () => {
    expect(youAsk(item({ client: 'Quiet Co' }), NOW).from).toBe('none')
  })

  test('subjects lose their Re: and Fwd: and are cut to 60 characters', () => {
    expect(subjectOf('RE: Fwd: re: Invite failures')).toBe('Invite failures')
    expect([...subjectOf(`Re: ${'x'.repeat(90)}`)].length).toBeLessThanOrEqual(60)
  })
})

describe('0.7.72: by when, in business days', () => {
  test('due later today: the clock; a client date past: how late, and when it was due', () => {
    expect(youClock(item({ client: 'A', dueAt: Date.parse('2026-11-24T20:45:00Z') }), NOW)).toMatchObject({ clock: 'soon', when: 'due 3:45 PM', short: 'due 3:45 PM' })
    const late = youClock(item({ client: 'B', dueAt: Date.parse('2026-11-23T15:00:00Z') }), NOW)
    expect(late).toMatchObject({ clock: 'late', short: '1d late' })
    expect(late.when).toBe('1d late, due Mon 10 AM')
  })

  test('the weekend does not count: due Friday 10 AM reads 2d late on Tuesday 10 AM', () => {
    expect(youClock(item({ client: 'C', dueAt: Date.parse('2026-11-20T15:00:00Z') }), NOW).short).toBe('2d late')
  })

  test('⛔ a team clock past due reads behind, never late, with the client date after it', () => {
    const it = item({ client: 'D', dueAt: NOW - 2 * H, internalDue: NOW - 2 * H, clientDue: Date.parse('2026-11-26T20:00:00Z') })
    const c = youClock(it, NOW)
    expect(c.clock).toBe('behind')
    expect(c.when).toBe('behind since 8 AM, due Thu 3 PM')
    expect(c.short).toBe('behind')
  })

  test('nothing dated: no due date, ordered last', () => {
    expect(youClock(item({ client: 'E' }), NOW)).toMatchObject({ clock: 'none', when: 'no due date', at: Infinity })
  })
})

describe('0.7.72: the pin, and why', () => {
  test('pinned; needs a pin, with the pane\'s own words; not on the pin report: no pin needed yet', () => {
    expect(youPin({ pinned: true })).toEqual({ pin: 'pinned' })
    expect(youPin({ pinned: false, why: 'person_unpinned' })).toEqual({ pin: 'needs_pin', pinWhy: 'you unpinned it' })
    expect(youPin(undefined)).toEqual({ pin: 'later' })
  })

  test('why: the clock and what is waiting, and a thread\'s mm waiting question', () => {
    const it = item({ client: 'Crucial Hire', kind: 'ready', packageId: 'pkg', messages: 1, mail: [mail('Zach', 'Invite failures')], dueAt: Date.parse('2026-11-24T20:45:00Z') })
    const r = youRow(it, NOW, { pin: { pinned: true }, waiting: 'Send the reply now?', target: 'local_x' })
    expect(r).toMatchObject({ client: 'Crucial Hire', ask: 'approve the reply to Zach about "Invite failures"', when: 'due 3:45 PM', pin: 'pinned', target: 'local_x' })
    expect(r.why).toBe('due within 24 business hours · reply ready for your go · waiting on you: Send the reply now')
  })
})

describe('0.7.72: the order, and the band\'s next', () => {
  const rows = youRows(
    [
      item({ projectId: P(1), client: 'Soon Co', dueAt: Date.parse('2026-11-24T20:45:00Z'), kind: 'ready', packageId: 'pkg' }),
      item({ projectId: P(2), client: 'Later Co', dueAt: Date.parse('2026-11-27T20:00:00Z'), tasks: 1, taskTitles: ['Build it'] }),
      item({ projectId: P(3), client: 'Late Co', dueAt: Date.parse('2026-11-23T15:00:00Z'), kind: 'reply', messages: 1, mail: [mail('Kim', 'Help')] }),
      item({ projectId: P(4), client: 'Latest Co', dueAt: Date.parse('2026-11-19T15:00:00Z'), kind: 'reply', messages: 1, mail: [mail('Lee', 'Again')] }),
      item({ projectId: P(5), client: 'Undated Co', asks: [{ id: 'a', asker: 'Asif', askedAt: NOW, dueAt: Infinity, snippet: 'ok?', hasDraft: false, link: '', draftSha: null }], kind: 'ask' }),
      item({ projectId: P(6), client: 'Behind Co', dueAt: NOW - H, internalDue: NOW - H, clientDue: Date.parse('2026-11-30T15:00:00Z'), tasks: 1, taskTitles: ['Wire it'] }),
    ],
    NOW,
    { pins: { [P(4)]: { pinned: true }, [P(3)]: { pinned: false, why: 'unseen' } }, targets: { [P(4)]: 'local_latest' } },
  )

  test('late first, the most overdue first; then by deadline (a passed team clock before any ahead); nothing dated last', () => {
    expect(rows.map(r => r.client)).toEqual(['Latest Co', 'Late Co', 'Behind Co', 'Soon Co', 'Later Co', 'Undated Co'])
    expect(rows.map(r => r.pin)).toEqual(['pinned', 'needs_pin', 'later', 'later', 'later', 'later'])
  })

  test('next is the most overdue: its client, its ask short, its clock; and the counts', () => {
    const b = youBand(rows)
    expect(b.head).toBe('Needs you: 6 · 2 late · 1 behind')
    expect(b.next).toEqual({ words: 'Latest Co, answer Lee, 3d late', projectId: P(4), target: 'local_latest' })
    expect(youBandText(b)).toBe('Needs you: 6 · 2 late · 1 behind · next: Latest Co, answer Lee, 3d late')
  })

  test('with nothing late, the soonest deadline is next', () => {
    const b = youBand(rows.filter(r => r.clock !== 'late' && r.clock !== 'behind'))
    expect(b.head).toBe('Needs you: 3')
    expect(b.next?.words).toBe("Soon Co, approve Soon Co's reply package, due 3:45 PM")
  })

  test('nothing needs the person: a few words, and no next', () => {
    expect(youBand([])).toEqual({ head: NOTHING_NEEDS_YOU })
    expect(youBandText(youBand([]))).toBe('Nothing needs you right now.')
  })

  test('the band keeps an ask short: its first clause, at most 48 characters', () => {
    expect(shortAsk('approve the reply to Zach about "Invite failures"')).toBe('approve the reply to Zach')
    expect(shortAsk('answer Asif\'s ask: "Can we move the call?"')).toBe("answer Asif's ask")
    expect([...shortAsk(`deliver "${'y'.repeat(80)}"`)].length).toBeLessThanOrEqual(48)
  })
})
