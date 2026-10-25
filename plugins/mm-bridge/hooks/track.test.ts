import { describe, expect, test } from 'claude-code/testing'

import {
  INTERNAL_NOTE, NOT_AVAILABLE, TIME_ROWS, WEEK_EVERY_MS, afterPersonClose, clientName, displayName, fmtHours, fmtMin, fmtX, kindOf, mergeCurrent, mergeTime, numbersNote, opensBySelf,
  parseClientTime, parseSkillMap, pressNote, secondLine, skillName, taskFrom, thisThread, trackLines, trackStatus, weekIsDue,
} from './track'

// The tracking part of the bridge (0.6.0), with no `$`: every made-up client and number here is a fixture.

const ACME = '11111111-1111-1111-1111-111111111111'
const NOW = Date.parse('2026-10-12T15:00:00Z')

describe('0.6.0: the words and numbers the Tracking part is drawn with (verbatim)', () => {
  test('minutes, hours and the parallel ratio', async () => {
    expect([fmtMin(0), fmtMin(42), fmtMin(59.6), fmtMin(65), fmtMin(125), fmtMin(-3)]).toEqual(['0m', '42m', '1h 00m', '1h 05m', '2h 05m', '0m'])
    expect([fmtHours(125), fmtHours(0), fmtHours(18)]).toEqual(['2.1', '0.0', '0.3'])
    expect([fmtX(1.296), fmtX(12.4), fmtX(0.456), fmtX(250.4), fmtX(0)]).toEqual(['1.3', '12', '0.46', '250', '0'])
  })

  test('the notes for Claude and the line above a second thread\'s client part', async () => {
    expect(pressNote('Acme Roofing', 'acme-roofing-project')).toBe(
      '[mm-bridge] The person marked this thread as Acme Roofing\'s work. Before your next step, load the acme-roofing-project skill with the Skill tool so the time tracker counts this thread\'s time to Acme Roofing.',
    )
    expect(INTERNAL_NOTE).toBe('[mm-bridge] The person marked this thread as Massmarket internal work. Before your next step, load the massmarket-internal-ops skill with the Skill tool so the time tracker counts it.')
    expect(secondLine('Acme Roofing', 'Roof quote')).toBe('This is a second thread for Acme Roofing. The reply package is picked up in "Roof quote".')
    expect(numbersNote('Acme Roofing')).toBe(
      'Tracked counts each minute once per person. In threads counts every thread in full. Parallel is the second divided by the first. Jarvis is work done for Acme Roofing with nobody in the thread.',
    )
  })

  test('the status line in each state', async () => {
    expect(trackStatus({ client: 'Acme Roofing', task: 'Phase 1 copy', minutes: 83, counted: true })).toBe('⏱ Acme Roofing · Phase 1 copy · this thread 1h 23m today')
    expect(trackStatus({ client: 'Acme Roofing', minutes: 42, counted: true })).toBe('⏱ Acme Roofing · this thread 42m today')
    expect(trackStatus({ client: 'Acme Roofing', counted: false })).toBe('⏱ Tracking to Acme Roofing')
    expect(trackStatus({ nudge: true })).toBe('⏱ Not tracked to a client yet')
    expect(trackStatus({})).toBeUndefined()
  })

  test('Massmarket\'s own projects by their own words', async () => {
    expect(displayName('internal_ops', 'x')).toBe('Massmarket internal')
    expect(displayName('self_funnel', 'x')).toBe('Massmarket sales and marketing')
    expect(displayName('client', 'Acme Roofing')).toBe('Acme Roofing')
    expect(clientName('Acme Roofing — Pat')).toBe('Acme Roofing')
    expect(kindOf('e6deffc3-2713-4def-a11d-b75a1efba9c1', [])).toBe('internal_ops')
    expect(kindOf(ACME, [])).toBe('client')
  })
})

describe('0.6.0: what the bridge takes from a skill call and a worklog command', () => {
  test('the skill\'s own name, after any plugin or folder before it', async () => {
    expect(skillName('acme-roofing-project')).toBe('acme-roofing-project')
    expect(skillName('massmarket:acme-roofing-project')).toBe('acme-roofing-project')
    expect(skillName('apps/web:deploy')).toBe('deploy')
    expect(skillName(undefined)).toBe('')
  })

  test('the task a worklog-hook command declares, either form, at most 120 characters', async () => {
    expect(taskFrom('node ~/.claude/mm-hooks/worklog-hook.js --task "Phase 1 nurture sequence copy"')).toBe('Phase 1 nurture sequence copy')
    expect(taskFrom('node ~/.claude/mm-hooks/worklog-hook.js --task=f779a7a0-fix')).toBe('f779a7a0-fix')
    expect(taskFrom("node \"$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js\" --task 'Inbound router'")).toBe('Inbound router')
    expect(taskFrom(`node ~/.claude/mm-hooks/worklog-hook.js --task "${'x'.repeat(200)}"`)).toBe('x'.repeat(120))
    // not the hook, or the hook with no task: nothing
    expect(taskFrom('echo --task "not the hook"')).toBe('')
    expect(taskFrom('node ~/.claude/mm-hooks/worklog-hook.js --status')).toBe('')
    expect(taskFrom(42)).toBe('')
  })
})

describe('0.6.0: a thread\'s current project, the latest word winning', () => {
  test('a later word replaces an earlier one; an earlier one changes nothing; the same project keeps its task', async () => {
    const a = mergeCurrent(undefined, { pid: ACME, how: 'skill', at: 10 }, true)
    expect(a).toEqual({ pid: ACME, how: 'skill', at: 10, declared: [ACME] })
    const withTask = { ...(a as NonNullable<typeof a>), task: 'Copy' }
    expect(mergeCurrent(withTask, { pid: ACME, how: 'feed', at: 5 }, true)).toBeNull()
    expect(mergeCurrent(withTask, { pid: ACME, how: 'feed', at: 20 }, true)).toEqual({ pid: ACME, how: 'feed', at: 20, task: 'Copy', declared: [ACME] })
    const other = '22222222-2222-2222-2222-222222222222'
    expect(mergeCurrent(withTask, { pid: other, how: 'marker', at: 30 }, true)).toEqual({ pid: other, how: 'marker', at: 30, declared: [ACME, other] })
    // Massmarket's own projects are not a client the thread declared
    expect(mergeCurrent(withTask, { pid: other, how: 'skill', at: 30 }, false)).toEqual({ pid: other, how: 'skill', at: 30, declared: [ACME] })
    expect(mergeCurrent(undefined, { pid: 'not-a-uuid', how: 'skill', at: 1 }, true)).toBeNull()
  })
})

describe('0.6.0: OW\'s answers, checked', () => {
  test('the skill map keeps entries of the right shape only', async () => {
    const map = parseSkillMap({
      as_of: '2026-10-25T12:00:00Z',
      skills: [
        { skill_key: 'acme-roofing-project', project_id: ACME, name: 'Acme Roofing — Pat', kind: 'client' },
        { skill_key: 'Bad Key', project_id: ACME, name: 'x', kind: 'client' },
        { skill_key: 'no-project', project_id: 'nope', name: 'x', kind: 'client' },
        { skill_key: 'odd-kind', project_id: ACME, name: 'x', kind: 'partner' },
      ],
    })
    expect(map?.skills.map(s => s.skill_key)).toEqual(['acme-roofing-project'])
    expect(parseSkillMap({ skills: 'no' })).toBeNull()
    expect(parseSkillMap(null)).toBeNull()
  })

  test('client time: trimmed to what the store keeps, every text one line, a 200 of another shape is no answer', async () => {
    const many = Array.from({ length: 50 }, (_, n) => ({ session_id: `s${n}`, title: `T\n${n}`, member_email: 'a@example.com', member_name: 'A', task: null, ticket_id: null, minutes_today: n, last_activity_at: '', active_now: false }))
    const parsed = parseClientTime({ as_of: 'x', viewer: { email: 'a@example.com', can_see_leverage: true }, projects: [{ project_id: ACME, name: 'Acme', today: {}, week: {}, threads: many, leverage: null }, { project_id: 'bad' }] })
    expect(parsed?.projects.length).toBe(1)
    expect(parsed?.projects[0]?.threads.length).toBe(TIME_ROWS.threads)
    expect(parsed?.projects[0]?.threads[1]?.title).toBe('T 1')
    expect(parsed?.viewer.canSeeLeverage).toBe(true)
    expect(parseClientTime({ tickets: [] })).toBeNull()
  })
})

describe('0.6.0: the Tracking part, line by line', () => {
  const p = parseClientTime({
    as_of: new Date(NOW).toISOString(),
    viewer: { email: 'a@example.com', can_see_leverage: true },
    projects: [{
      project_id: ACME, name: 'Acme Roofing — Pat',
      today: { client_minutes: 65, thread_minutes: 65, parallel: null, jarvis_minutes: 0, people: [{ email: 'a@example.com', name: '', minutes: 65 }], tasks: [{ task: null, ticket_id: null, minutes: 65, thread_count: 1, people: ['a@example.com'], last_activity_at: '', active_now: true }] },
      week: { client_minutes: 65, thread_minutes: 65, parallel: null, jarvis_minutes: 0, people: [], tasks: [] },
      threads: [{ session_id: 'mine', title: null, member_email: 'a@example.com', member_name: '', task: null, ticket_id: null, minutes_today: 65, last_activity_at: '', active_now: true }],
      leverage: { ratio: 2, build_hours: 4, actual_hours: 2, window: '', note: '' },
    }],
  })?.projects[0]

  test('one thread, a task with no label, a person with no name: the address before the @, and one thread', async () => {
    const lines = trackLines({ client: 'Acme Roofing', time: { at: NOW, asOf: new Date(NOW).toISOString(), ...(p ? { p } : {}) }, missing: false, canSeeLeverage: false, mine: sid => sid === 'mine' })
    expect(lines.map(l => l.text).slice(0, 7)).toEqual([
      'Tracking to Acme Roofing · no task declared yet',
      'This thread: 1h 05m today · Acme Roofing today: 1h 05m tracked across 1 thread',
      'Tasks today',
      '● No task declared · 1h 05m · a',
      'Threads today',
      '● Untitled thread  a · no task · 1h 05m (this thread)',
      'Numbers',
    ])
    expect(lines[0]?.bold).toBe(true)
    expect(lines[1]?.dim).toBe(true)
    expect(lines.some(l => l.text.startsWith('Leverage'))).toBe(false)
    expect(thisThread(p, sid => sid === 'mine')).toEqual({ minutes: 65, counted: true })
  })

  test('no numbers yet: the heading, then Checking…, or that the numbers are not available', async () => {
    expect(trackLines({ client: 'Acme Roofing', missing: false, canSeeLeverage: true, mine: () => false }).map(l => l.text)).toEqual(['Tracking to Acme Roofing · no task declared yet', 'Checking…'])
    expect(trackLines({ client: 'Acme Roofing', task: 'Copy', missing: true, canSeeLeverage: true, mine: () => false }).map(l => l.text)).toEqual(['Tracking to Acme Roofing · Copy', NOT_AVAILABLE])
    expect(NOT_AVAILABLE).toBe('Time numbers are not available yet.')
  })
})

describe('0.6.0: when the pane opens by itself, and what the person\'s close holds', () => {
  const BOLT = '22222222-2222-2222-2222-222222222222'

  test('it opens for the thread\'s project; never in a SINGLE-SESSION run or under MM_UNATTENDED=1', async () => {
    expect(opensBySelf({}, ACME, false)).toBe(true)
    expect(opensBySelf({ single: true }, ACME, false)).toBe(false)
    expect(opensBySelf({}, ACME, true)).toBe(false)
  })

  test('the person\'s close holds for the project it was drawn for, until the project changes', async () => {
    const closed = afterPersonClose({ handled: ACME })
    expect(closed).toEqual({ closed: ACME })
    expect(opensBySelf(closed, ACME, false)).toBe(false)
    expect(opensBySelf(closed, BOLT, false)).toBe(true)
    // a close before any project was drawn holds for no project
    expect(afterPersonClose({})).toEqual({ closed: '' })
    expect(opensBySelf(afterPersonClose({}), ACME, false)).toBe(true)
  })
})

describe('0.6.0 (OW contract 2026-10-25): the periods asked for, and a today-only answer merged in', () => {
  const answer = (o: Record<string, unknown>) =>
    parseClientTime({ as_of: o.as_of, viewer: {}, projects: [{ project_id: ACME, name: 'Acme Roofing', threads: [], leverage: null, ...o }] })?.projects[0]
  const day = (m: number) => ({ client_minutes: m, thread_minutes: m, parallel: null, jarvis_minutes: 0, people: [], tasks: [] })
  const lev = { ratio: 2, build_hours: 4, actual_hours: 2, window: '', note: '' }

  test('a period not asked for comes back null; the week is due on the first read and every 30 minutes', async () => {
    const p = answer({ today: day(5), week: null })
    expect(p?.today?.client_minutes).toBe(5)
    expect(p?.week).toBeNull()
    expect(WEEK_EVERY_MS).toBe(30 * 60_000)
    expect(weekIsDue(undefined, NOW)).toBe(true)
    expect(weekIsDue({ weekAt: NOW - 29 * 60_000 }, NOW)).toBe(false)
    expect(weekIsDue({ weekAt: NOW - 30 * 60_000 }, NOW)).toBe(true)
    expect(weekIsDue({ at: NOW }, NOW)).toBe(true)
  })

  test('a today-only answer keeps the last week and leverage, each period with its own as-of', async () => {
    const first = answer({ today: day(10), week: day(100), leverage: lev, threads: [{ session_id: 'a', minutes_today: 10 }] })
    const later = answer({ today: day(20), week: null, leverage: null, threads: [{ session_id: 'a', minutes_today: 20 }] })
    if (!first || !later) throw new Error('fixture')
    const a = mergeTime(undefined, first, NOW, 'T1', true)
    expect(a).toMatchObject({ at: NOW, asOf: 'T1', weekAt: NOW, weekAsOf: 'T1' })
    const b = mergeTime(a, later, NOW + 300_000, 'T2', false)
    expect(b).toMatchObject({ at: NOW + 300_000, asOf: 'T2', weekAt: NOW, weekAsOf: 'T1' })
    expect(b.p?.today?.client_minutes).toBe(20)
    expect(b.p?.threads[0]?.minutes_today).toBe(20)
    expect(b.p?.week?.client_minutes).toBe(100)
    expect(b.p?.leverage).toEqual(lev)
    // the next week read replaces the week and the leverage (none now) and its as-of
    const c = mergeTime(b, answer({ today: day(30), week: day(130), leverage: null }) ?? later, NOW + 1_800_000, 'T3', true)
    expect(c).toMatchObject({ asOf: 'T3', weekAt: NOW + 1_800_000, weekAsOf: 'T3' })
    expect(c.p?.week?.client_minutes).toBe(130)
    expect(c.p?.leverage).toBeNull()
    // a failure noted before is cleared by an answer
    expect(mergeTime({ ...a, failedAt: NOW + 1 }, later, NOW + 2, 'T4', false).failedAt).toBeUndefined()
  })

  test('drawn with no week yet: the Today line and no This week line, never zeros', async () => {
    const p = answer({ as_of: new Date(NOW).toISOString(), today: day(65), week: null })
    const lines = trackLines({ client: 'Acme Roofing', time: { at: NOW, asOf: new Date(NOW).toISOString(), ...(p ? { p } : {}) }, missing: false, canSeeLeverage: true, mine: () => false }).map(l => l.text)
    expect(lines).toContain('Today: 1.1 h tracked · 1.1 h in threads · Jarvis 0.0 h')
    expect(lines.some(l => l.startsWith('This week'))).toBe(false)
  })
})
