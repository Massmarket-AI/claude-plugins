// (0.7.75) Today's numbers in the side pane (stats.ts): the person's own line under the You section's dots, and the team's at the top
// of Team now for everyone, from OW's `GET /api/ext/day-stats`. Pure words first, then the bridge against a pretend
// desktop app and OW (register-world.test-helper.ts), on the desktop and on the phone. Read-only: nothing here sends, pins or sounds.
// Every person and client is made up.

import { describe, expect, test } from 'claude-code/testing'
import { NOW, LONG, PANE, feed, world, mm, pane, buttons, lines, onlyReads, sends, tickOnce } from './register-world.test-helper'
import type { Drawing } from './register-world.test-helper'
import { hoursWords, isToday, myStatsLine, myStatsSays, nyDay, parallelWords, statsFrom, teamStatsLines, teamStatsText, tokenWords } from './stats'

const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
// NOW is Monday 2026-10-12, 11 AM in New York
const TODAY = '2026-10-12'

const person = (name: string, hours: number, work: number, tokens: number | null, over: Record<string, unknown> = {}) => ({
  name,
  me: false,
  hours,
  work_hours: work,
  parallel: work > 0 ? Math.round((hours / work) * 100) / 100 : null,
  tokens,
  sessions: tokens === null ? null : 4,
  ...over,
})
const ME_ROW = person('Pat Builder', 4.2, 1.4, 1_840_000, { me: true, sessions: 6 })
/** An answer with the person's own numbers and no team rows (an OW from before the team rows went to everyone). */
const member = (over: Record<string, unknown> = {}) => ({ ok: true, at: iso(NOW - 2 * MIN), day: TODAY, role: 'member', me: ME_ROW, partial: [], ...over })
/** What OW answers anyone on the team: their own, then the team in its order and the totals. */
const everyone = (over: Record<string, unknown> = {}) => ({
  ok: true,
  at: iso(NOW - 2 * MIN),
  day: TODAY,
  role: 'member',
  me: ME_ROW,
  team: [person('Rob Example', 6.1, 1.8, 12_300_000), ME_ROW, person('Asif Example', 2.8, 1.75, null), person('Nayan Example', 0, 0, null)],
  totals: { hours: 13.1, work_hours: 4.95, parallel: 2.64, tokens: 14_140_000, members: 4 },
  partial: [],
  ...over,
})
const ok = (body: unknown) => ({ status: 200, body })
const statsFetches = (w: { fetched: string[] }) => w.fetched.filter(u => u.endsWith('/api/ext/day-stats')).length
const label = async (ui: Drawing, key: string): Promise<string | undefined> => (await buttons(ui)).find(b => b[0] === key)?.[1]
const MY_LINE = 'Today: 4.2 h · 3.0× parallel · 1.8M tokens'
const TEAM_BLOCK = ['Today · as of 10:58 AM', '  Rob Example · 6.1 h · 3.4× · 12.3M tokens', '  Pat Builder · 4.2 h · 3.0× · 1.8M tokens', '  Asif Example · 2.8 h · 1.6×', '  Nayan Example · nothing tracked yet', '  Team · 13.1 h · 2.6× · 14.1M tokens']

describe('0.7.75: the words (stats.ts)', () => {
  test('hours, parallel and tokens read as on the 9 AM image', () => {
    expect(hoursWords(4.2)).toBe('4.2 h')
    expect(hoursWords(0)).toBe('0.0 h')
    expect(parallelWords(3)).toBe('3.0×')
    expect(parallelWords(2.64)).toBe('2.6×')
    expect(parallelWords(null)).toBeNull()
    expect([950, 9_540, 12_000, 1_840_000, 12_340_000, 123_400_000, 1_230_000_000].map(tokenWords)).toEqual(['950', '9.5K', '12K', '1.8M', '12.3M', '123M', '1.2B'])
  })

  test("OW's answer is checked: another shape is null, a person of another shape is dropped, an answer with no team rows has none", () => {
    expect(statsFrom(null)).toBeNull()
    expect(statsFrom({ ok: false })).toBeNull()
    expect(statsFrom({ ...member(), day: 'today' })).toBeNull()
    const mine = statsFrom(member())
    expect(mine?.me).toEqual({ name: 'Pat Builder', me: true, hours: 4.2, workHours: 1.4, parallel: 3, tokens: 1_840_000, sessions: 6 })
    expect(mine?.team).toBeNull()
    expect(mine?.total).toBeNull()
    const all = statsFrom(everyone({ team: [...everyone().team, { name: 'Broken', hours: 'lots' }] }))
    expect(all?.team?.map(p => p.name)).toEqual(['Rob Example', 'Pat Builder', 'Asif Example', 'Nayan Example'])
    expect(all?.total).toMatchObject({ name: 'Team', hours: 13.1, workHours: 4.95, tokens: 14_140_000 })
  })

  test('the own line: the figures, "nothing tracked yet", no tokens part when none are measured, and nothing for another day', () => {
    const s = statsFrom(member())
    expect(myStatsLine(s, NOW)).toBe(MY_LINE)
    expect(myStatsLine(statsFrom(member({ me: person('Pat Builder', 0, 0, null, { me: true }) })), NOW)).toBe('Today: nothing tracked yet')
    expect(myStatsLine(statsFrom(member({ me: person('Pat Builder', 2, 1, null, { me: true }) })), NOW)).toBe('Today: 2.0 h · 2.0× parallel')
    expect(myStatsLine(statsFrom(member({ me: null })), NOW)).toBeNull()
    // yesterday's read is never drawn as today
    expect(isToday(s, NOW + 14 * 3600_000)).toBe(false)
    expect(myStatsLine(s, NOW + 14 * 3600_000)).toBeNull()
    expect(nyDay(NOW)).toBe(TODAY)
  })

  test('a press says what each figure counts, and when', () => {
    const s = statsFrom(member())
    expect(s && myStatsSays(s, NOW)).toBe(
      '4.2 h recorded to clients today, parallel threads counted in full, in 1.4 h of work time: 3.0× parallel. 1.8M tokens across 6 sessions. As of 10:58 AM; the same figures as the 9 AM team image, for today so far.',
    )
    expect(s && myStatsSays(s, NOW + 30 * MIN)).toContain('As of 10:58 AM (32 minutes ago)')
  })

  test("the team block: a heading, one line a person in OW's order, an empty one dim, then the team; none without a team", () => {
    const s = statsFrom(everyone())
    const block = teamStatsLines(s, NOW)
    expect(block.map(l => l.text)).toEqual(TEAM_BLOCK)
    expect(block[0]?.bold).toBe(true)
    expect(block.filter(l => l.dim).map(l => l.text)).toEqual(['  Nayan Example · nothing tracked yet', '  Team · 13.1 h · 2.6× · 14.1M tokens'])
    expect(teamStatsLines(statsFrom(member()), NOW)).toEqual([])
    expect(teamStatsText(statsFrom(member()), NOW)).toBe('')
    expect(teamStatsLines(s, NOW + 14 * 3600_000)).toEqual([])
  })
})

describe('0.7.75: today\'s numbers in the pane', () => {
  test('desktop: one dim line under the dots; a press says what it counts; an answer with no team rows draws no team block', LONG, async ($, on) => {
    const w = world(on, { feed: feed(), dayStats: () => ok(member()) })
    await tickOnce($, w)
    const ui = await pane($)
    expect(await label(ui, 'mm-stats')).toBe(MY_LINE)
    const stats = (await ui.findAll({ key: 'mm-stats' }))[0]
    expect(stats?.props.dimColor).toBe(true)
    // it sits in the You section, before its list
    const order = (await buttons(ui)).map(b => b[0])
    expect(order.indexOf('mm-stats')).toBeLessThan(order.indexOf('mm-teamnow-toggle'))
    expect((await lines(ui)).indexOf('Needs you (3)')).toBeGreaterThan(-1)
    await ui.press({ key: 'mm-stats' })
    expect((await lines(ui)).some(l => l.startsWith('4.2 h recorded to clients today'))).toBe(true)
    await ui.press({ key: 'mm-stats' })
    expect((await lines(ui)).some(l => l.startsWith('4.2 h recorded to clients today'))).toBe(false)
    await ui.press({ key: 'mm-teamnow-toggle' })
    expect((await lines(ui)).some(l => l.startsWith('Today ·'))).toBe(false)
    expect(onlyReads(w)).toBe(true)
    expect(sends(w)).toEqual([])
    await ui.unmount()
  })

  test('desktop, a teammate (any role): Team now opens on today\'s numbers, one line a person, above each person\'s block', LONG, async ($, on) => {
    const w = world(on, { feed: feed(), dayStats: () => ok(everyone()), store: { 'mm.panel': { teamNow: true } } })
    await tickOnce($, w)
    const ui = await pane($)
    expect(await label(ui, 'mm-stats')).toBe(MY_LINE)
    const drawn = await lines(ui)
    const at = drawn.indexOf(TEAM_BLOCK[0] as string)
    expect(at).toBeGreaterThan(-1)
    expect(drawn.slice(at, at + TEAM_BLOCK.length)).toEqual(TEAM_BLOCK)
    // closed, the block goes with it
    await ui.press({ key: 'mm-teamnow-toggle' })
    expect((await lines(ui)).some(l => l.startsWith('Today ·'))).toBe(false)
    await ui.unmount()
  })

  test('mobile: the same line and the same team block', LONG, async ($, on) => {
    const w = world(on, { feed: feed(), dayStats: () => ok(everyone()), store: { 'mm.panel': { teamNow: true } } })
    await tickOnce($, w)
    const ui = await $.ui.mount({ plugin: 'mm-bridge', surface: 'mobile', component: 'Pane', requestId: 'mm-queue', props: PANE })
    expect(await label(ui, 'mm-stats')).toBe(MY_LINE)
    const drawn = await lines(ui)
    const at = drawn.indexOf(TEAM_BLOCK[0] as string)
    expect(drawn.slice(at, at + TEAM_BLOCK.length)).toEqual(TEAM_BLOCK)
    await ui.press({ key: 'mm-stats' })
    expect((await lines(ui)).some(l => l.startsWith('4.2 h recorded to clients today'))).toBe(true)
    await ui.unmount()
  })

  test('the read: once every 10 minutes, not every minute; a failure keeps the last numbers', LONG, async ($, on) => {
    let answer: { status: number; body?: unknown } | 'network' = ok(member())
    const w = world(on, { feed: feed(), dayStats: () => answer })
    await tickOnce($, w)
    const first = statsFetches(w)
    expect(first).toBe(1)
    for (let i = 0; i < 8; i++) await w.clock.advance(MIN)
    expect(statsFetches(w)).toBe(first)
    answer = 'network'
    await w.clock.advance(2 * MIN)
    expect(statsFetches(w)).toBe(first + 1)
    const ui = await pane($)
    expect(await label(ui, 'mm-stats')).toBe(MY_LINE)
    await ui.unmount()
  })

  test('an OW without the route: no line, and not asked again for an hour', LONG, async ($, on) => {
    const w = world(on, { feed: feed() })
    await tickOnce($, w)
    const ui = await pane($)
    expect(await label(ui, 'mm-stats')).toBeUndefined()
    const asked = statsFetches(w)
    expect(asked).toBe(1)
    for (let i = 0; i < 30; i++) await w.clock.advance(MIN)
    expect(statsFetches(w)).toBe(asked)
    for (let i = 0; i < 31; i++) await w.clock.advance(MIN)
    expect(statsFetches(w)).toBe(asked + 1)
    await ui.unmount()
  })

  test('/mm team: the block above Team now, nothing more when OW sends no team rows; it sends nothing', LONG, async ($, on) => {
    let answer = ok(everyone())
    const w = world(on, { feed: feed(), dayStats: () => answer })
    await tickOnce($, w)
    expect((await mm($, 'team')).split('\n').slice(0, TEAM_BLOCK.length)).toEqual(TEAM_BLOCK)
    answer = ok(member())
    w.stored['mm.stats'] = {}
    await w.clock.advance(MIN)
    expect(await mm($, 'team')).not.toContain('Today ·')
    expect(sends(w)).toEqual([])
  })
})
