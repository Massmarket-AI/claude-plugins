import { describe, expect, test } from 'claude-code/testing'

import { itemTime, itemTone, spanWords, teamCounts, teamFrom, teamHeadingNow, teamLines, teamText, withMoves } from './team'

/** Monday 2026-11-09, 2 PM in New York. */
const NOW = Date.parse('2026-11-09T19:00:00Z')
const iso = (t: number) => new Date(t).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const answer = (people: unknown[], over: Record<string, unknown> = {}) => ({ ok: true, at: iso(NOW), role: 'member', partial: [], people, ...over })
const person = (over: Record<string, unknown> = {}) => ({ name: 'Asif', me: false, report: null, bridge_version: '0.7.34', bridge_seen_at: iso(NOW), running: [], assigned: [], ...over })
const item = (over: Record<string, unknown> = {}) => ({ client: 'Acme Legal', kind: 'task', tone: 'yellow', due_at: iso(NOW + 3 * HOUR), pinned: true, why_not: null, ...over })
const report = (items: unknown[], extra: unknown[] = []) => ({ reported_at: iso(NOW - 5 * MIN), items, extra })
const thread = (over: Record<string, unknown> = {}) => ({ session_ref: 'abcd1234', client: 'Acme Legal', project_id: null, working: true, auto: false, since: iso(NOW - 25 * MIN), since_capped: false, last_at: iso(NOW - MIN), task: null, title: null, ...over })
const read = (people: unknown[], over: Record<string, unknown> = {}) => {
  const team = teamFrom(answer(people, over))
  if (!team) throw new Error('no team')
  return team
}
const texts = (people: unknown[], over: Record<string, unknown> = {}) => teamLines(read(people, over), NOW).map(l => l.text)

describe('0.7.34: what OW answers, checked', () => {
  test('an answer of another shape is no answer', () => {
    expect(teamFrom(null)).toBeNull()
    expect(teamFrom({ ok: false })).toBeNull()
    expect(teamFrom({ ok: true, at: 'soon', people: [] })).toBeNull()
    expect(teamFrom({ ok: true, at: iso(NOW) })).toBeNull()
  })
  test('a row of another shape goes; the rest stays', () => {
    const team = read([person({ report: report([item(), item({ tone: 'blue' }), { client: '' }]), running: [thread(), { working: true }], assigned: [{ ticket_ref: 'aaaa1111', client: 'Acme Legal', at: iso(NOW) }, { ticket_ref: 'bbbb2222', client: '', at: iso(NOW) }] }), { name: '' }, 'x'])
    expect(team.people.length).toBe(1)
    expect(team.people[0]?.items.length).toBe(1)
    expect(team.people[0]?.running.length).toBe(1)
    expect(team.people[0]?.assigned.length).toBe(1)
  })
  test("a client's long name reads as its first part", () => {
    const team = read([person({ report: report([item({ client: 'Sonya Vicars — AI Receptionist for Movers' })]), running: [thread({ client: "Creg McDonald - Stay a Little Longer / Life's Operating System" })] })])
    expect(team.people[0]?.items[0]?.client).toBe('Sonya Vicars')
    expect(team.people[0]?.running[0]?.client).toBe('Creg McDonald')
  })
})

describe('0.7.34: a person as the daily photo has them (verbatim)', () => {
  test('the heading: how many to pin and pinned, and how old the report is', () => {
    expect(texts([person({ report: report([item(), item({ pinned: false, why_not: 'no_thread' })]) })])[0]).toBe('Asif · 2 to pin · 1 pinned | as of 1:55 PM')
    expect(texts([person({ report: report([]) })])[0]).toBe('Asif · Nothing to pin | as of 1:55 PM')
    expect(texts([person({ report: { ...report([]), reported_at: iso(NOW - 26 * HOUR) } })])[0]).toBe('Asif · Nothing to pin | last report 1d ago')
    expect(texts([person()])[0]).toBe('Asif | No report from this bridge')
    expect(texts([person({ bridge_seen_at: null })])[0]).toBe('Asif | No bridge yet')
  })
  test('a row: its mark, the client, what it is, when, and whether it is pinned', () => {
    const lines = texts([person({ report: report([item({ kind: 'ready' }), item({ kind: 'ok', pinned: false, why_not: 'person_unpinned' }), item({ kind: 'mystery', due_at: null, pinned: false, why_not: 'nonsense' }), item({ due_at: iso(NOW - 3 * HOUR), kind: 'on_track', pinned: false, why_not: 'write_cap' })]) })])
    expect(lines).toContain('  ● Acme Legal · reply ready · due Mon 5:00 PM · pinned')
    expect(lines).toContain('  ○ Acme Legal · needs OK · due Mon 5:00 PM · they unpinned it')
    expect(lines).toContain('  ○ Acme Legal · mystery · not pinned')
    expect(lines).toContain('  ○ Acme Legal · on track · 3h late · not pinned yet')
  })
  test('red once the due time has passed, whatever the report said; the colours', () => {
    expect(itemTone({ tone: 'green', dueAt: NOW - 1 }, NOW)).toBe('red')
    expect(itemTone({ tone: 'green', dueAt: NOW + 1 }, NOW)).toBe('green')
    const colors = teamLines(read([person({ report: report([item({ tone: 'green' }), item({ tone: 'yellow' }), item({ tone: 'red' })]) })]), NOW).filter(l => l.text.includes('Acme')).map(l => l.color)
    expect(colors).toEqual(['success', 'warning', 'error'])
  })
  test('late counts business time: a weekend adds nothing', () => {
    // due Friday 5 PM, seen Monday 9 AM: 16 hours of Friday night and Monday morning
    const monday = Date.parse('2026-11-09T14:00:00Z')
    expect(itemTime({ dueAt: Date.parse('2026-11-06T22:00:00Z') }, monday)).toBe('16h late')
  })
  test('at most 10 rows, then +N more; the threads pinned with nothing due', () => {
    const lines = texts([person({ report: report(Array.from({ length: 12 }, () => item()), [{ project_id: null, client: 'Foo Co', by: 'bridge' }, { project_id: null, client: null, by: 'person' }]) })])
    expect(lines.filter(l => l.includes('Acme Legal')).length).toBe(10)
    expect(lines).toContain('  +2 more')
    expect(lines).toContain('  Also pinned with nothing due: Foo Co, a thread')
  })
  test('the last line says what the marks mean and when it was read', () => {
    expect(texts([]).at(-1)).toBe('▶ working now   ● pinned   ○ not pinned · as of 2:00 PM')
    expect(texts([])[0]).toBe('Nobody has reported yet.')
  })
})

describe('0.7.34: what each person is working on now', () => {
  test('a working thread: which client, how long, and the task when OW sends it', () => {
    const lines = texts([person({ running: [thread({ task: 'reply drafts' }), thread({ client: null, since: null }), thread({ auto: true, client: 'Foo Co', since_capped: true, since: iso(NOW - 3 * HOUR) })] })])
    expect(lines).toContain('  ▶ Acme Legal · 25m · reply drafts')
    expect(lines).toContain('  ▶ a thread, no client said')
    expect(lines).toContain('  ▶ Foo Co · 3h+ · automatic')
  })
  test('nothing running says so, and when they were last active', () => {
    expect(texts([person()])).toContain('  Nothing running')
    expect(texts([person({ running: [thread({ working: false, last_at: iso(NOW - 12 * MIN) })] })])).toContain('  Nothing running · last active 12m ago')
  })
  test('how long, in words', () => {
    expect(spanWords(20_000)).toBe('<1m')
    expect(spanWords(59 * MIN)).toBe('59m')
    expect(spanWords(2 * HOUR)).toBe('2h')
    expect(spanWords(130 * MIN)).toBe('2h 10m')
  })
  test('what could not be read is said', () => {
    expect(texts([], { partial: ['running'] })).toContain('Which threads are working could not be read just now.')
    expect(texts([], { partial: ['assigned'] })).toContain('New assignments could not be read just now.')
  })
})

describe('0.7.34: a task that pops over to someone', () => {
  const assigned = (over: Record<string, unknown> = {}) => ({ ticket_ref: 'aaaa1111', ticket_id: null, client: 'Acme Legal', project_id: null, title: null, at: iso(NOW - 2 * MIN), ...over })
  test('new to them, bold while it just moved, dim after; at most three', () => {
    const lines = teamLines(read([person({ assigned: [assigned({ title: 'Fix the form' }), assigned({ at: iso(NOW - 3 * HOUR) }), assigned(), assigned()] })]), NOW)
    expect(lines.find(l => l.text === '  → New: Acme Legal · Fix the form · 2m ago')?.bold).toBe(true)
    expect(lines.find(l => l.text === '  → New: Acme Legal · 3h ago')?.dim).toBe(true)
    expect(lines.filter(l => l.text.includes('→')).length).toBe(3)
  })
  test('a task seen with someone else last says from whom', () => {
    const first = withMoves(read([person({ name: 'Nayan', assigned: [assigned()] })]), {})
    expect(first.seen).toEqual({ aaaa1111: { to: 'Nayan' } })
    expect(first.team.people[0]?.assigned[0]?.from).toBeUndefined()
    const second = withMoves(read([person({ name: 'Asif', assigned: [assigned()] })]), first.seen)
    expect(second.team.people[0]?.assigned[0]?.from).toBe('Nayan')
    expect(teamLines(second.team, NOW).map(l => l.text)).toContain('  → From Nayan: Acme Legal · 2m ago')
    expect(second.seen).toEqual({ aaaa1111: { to: 'Asif', from: 'Nayan' } })
    // and on the reads after, while the task is on the list
    const third = withMoves(read([person({ name: 'Asif', assigned: [assigned()] })]), second.seen)
    expect(third.team.people[0]?.assigned[0]?.from).toBe('Nayan')
    expect(third.seen).toEqual(second.seen)
  })
})

describe('0.7.34: the dropdown\'s own line', () => {
  test('how many threads work and how many rows are not pinned, across the team; neither when none', () => {
    const team = read([person({ running: [thread(), thread({ working: false })], report: report([item({ pinned: false, why_not: 'no_thread' })]) }), person({ name: 'Nayan', running: [thread()] })])
    expect(teamCounts(team)).toEqual({ working: 2, notPinned: 1 })
    expect(teamHeadingNow(team)).toBe('Team now · 2 working · 1 not pinned')
    expect(teamHeadingNow(read([person()]))).toBe('Team now')
    expect(teamHeadingNow(null)).toBe('Team now')
  })
  test('/mm team: the same as text', () => {
    expect(teamText(null, NOW)).toBe('Team now has not been read yet.')
    expect(teamText(read([person()]), NOW).split('\n').slice(0, 3)).toEqual(['Team now', 'Asif | No report from this bridge', '  Nothing running'])
  })
})
