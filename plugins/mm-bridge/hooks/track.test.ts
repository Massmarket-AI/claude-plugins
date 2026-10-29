import { describe, expect, test } from 'claude-code/testing'

import {
  INTERNAL_NOTE, NOT_AVAILABLE, TIME_ROWS, WEEK_EVERY_MS, afterPersonClose, clientName, displayName, fmtHours, fmtMin, fmtX, kindOf, mergeCurrent, mergeTime, numbersNote, opensBySelf,
  parseClientTime, parseSkillMap, pressNote, secondLine, skillName, taskFrom, thisThread, trackLines, trackStatus, weekIsDue,
  LINES_TODAY, LINE_BANK, LINE_LATER, LINE_NEW, askNote, asksForLine, asksInSession, bankLine, bankNote, countsToward, declareLineText, fmtEst, forClaude, hookCommand, lineAskKey, lineAskText,
  lineButton, lineNote, lineOfThread, linkedText, newScopeNote, noBankText, parseThreadLine, proposalArgs, proposedText, statusLineTitle, ticketOf, withoutPrefix,
  BAD_ESTIMATE, ESTIMATE_HOURS, NEXT_INVOICE, fmtAbout, goesAhead, modeOf, noPrepaidText, offersPrepaid, proposalMode, reasonOf, recordedText, settleOf, toldUnbilled,
} from './track'
import type { ThreadLine, TimeProject } from './track'

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
    // (0.7.5) the note behind More, in the plain words of the redesign (`your time`, `thread time`)
    expect(numbersNote('Acme Roofing')).toBe(
      'Your time counts each minute once per person. Thread time counts every thread in full, so two threads at once count twice. Parallel is thread time divided by your time. Jarvis is work done for Acme Roofing with nobody in the thread.',
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
    // (0.7.5) closed to its one line (this thread's minutes in it), then one numbers line and ONE time list by task:
    // the person with no name is the address before the @, and one thread is not counted as threads
    expect(lines.map(l => l.text).slice(0, 3)).toEqual([
      '⏱ This thread: Acme Roofing · no task declared yet · 1h 05m today',
      'Today: 1.1 h of your time · 1.1 h of thread time',
      'No task declared · 1h 05m · a (this thread)',
    ])
    expect(lines[0]?.part).toBe('head')
    expect(lines[1]?.part).toBeUndefined()
    expect(lines.some(l => /· \d+ threads/.test(l.text))).toBe(false)
    expect(lines.some(l => l.text.startsWith('Leverage'))).toBe(false)
    expect(thisThread(p, sid => sid === 'mine')).toEqual({ minutes: 65, counted: true })
  })

  test('no numbers yet: the heading, then Checking…, or that the numbers are not available', async () => {
    // (0.7.5) the heading is the one line the part closes to
    expect(trackLines({ client: 'Acme Roofing', missing: false, canSeeLeverage: true, mine: () => false }).map(l => l.text)).toEqual(['⏱ This thread: Acme Roofing · no task declared yet', 'Checking…'])
    expect(trackLines({ client: 'Acme Roofing', task: 'Copy', missing: true, canSeeLeverage: true, mine: () => false }).map(l => l.text)).toEqual(['⏱ This thread: Acme Roofing · Copy', NOT_AVAILABLE])
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
    // (0.7.5) in plain words; Jarvis has its own line, behind More
    expect(lines).toContain('Today: 1.1 h of your time · 1.1 h of thread time')
    expect(lines).toContain('Jarvis: 0.0 h today')
    expect(lines.some(l => l.startsWith('This week'))).toBe(false)
  })
})

// ======================================================================== 0.7.0: the deliverable line the work counts toward
// Rob, 2026-10-26: "I want the live panel not just to show what clients are being tracked, but also the task that it
// thinks we're working on. Maybe even separately, it could show which specific deliverable line those hours are being
// added for." Every line, title and key here is a fixture.

const L_COPY = 'L-1a2b3c4d'
const L_ROUTER = 'L-2b3c4d5e'
const L_SITE = 'L-3c4d5e6f'
const L_BANK = 'L-4d5e6f7a'
const LINES = [
  { line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable', status: 'active', estimate_hours: 12, minutes: 64 },
  { line_key: L_ROUTER, title: 'Inbound lead router and assignment rules', line_type: 'deliverable', status: 'active', estimate_hours: 6, minutes: 42 },
  { line_key: L_SITE, title: 'Website refresh', line_type: 'deliverable', status: 'active', estimate_hours: 20, minutes: 0 },
  { line_key: L_BANK, title: 'Support hour bank', line_type: 'bank', status: 'active', estimate_hours: 10, minutes: 0 },
]
const day = (tasks: unknown[] = []) => ({ client_minutes: 106, thread_minutes: 106, parallel: null, jarvis_minutes: 0, people: [{ email: 'a@example.com', name: 'Avery Lane', minutes: 106 }], tasks })
const lined = (o: { line?: unknown; lines?: unknown; proposals?: unknown; tasks?: unknown[]; task?: string | null } = {}): TimeProject => {
  const parsed = parseClientTime({
    as_of: new Date(NOW).toISOString(),
    viewer: { email: 'a@example.com', can_see_leverage: true },
    projects: [{
      project_id: ACME, name: 'Acme Roofing — Pat',
      today: day(o.tasks ?? []), week: null, leverage: null,
      threads: [{ session_id: 'mine', title: 'Acme copy', member_email: 'a@example.com', member_name: 'Avery Lane', task: o.task === undefined ? 'Copy' : o.task, ticket_id: null, minutes_today: 64, last_activity_at: new Date(NOW).toISOString(), active_now: true, ...(o.line !== undefined ? { line: o.line } : {}) }],
      ...(o.lines !== undefined ? { lines: o.lines } : {}),
      ...(o.proposals !== undefined ? { proposals: o.proposals } : {}),
    }],
  })?.projects[0]
  if (!parsed) throw new Error('fixture')
  return parsed
}
const thread = (signal: string, over: Record<string, unknown> = {}) => ({ via: 'none', line_key: null, title: null, line_type: null, estimate_hours: null, signal, candidates: [], proposal: null, ...over })
const tl = (signal: string, over: Record<string, unknown> = {}): ThreadLine => {
  const l = parseThreadLine(thread(signal, over))
  if (!l) throw new Error('fixture')
  return l
}
const drawn = (p: TimeProject, task = 'Copy') => trackLines({ client: 'Acme Roofing', task, time: { at: NOW, asOf: new Date(NOW).toISOString(), p }, missing: false, canSeeLeverage: false, mine: sid => sid === 'mine' }).map(l => l.text)

describe('0.7.0: OW\'s new fields, checked (absent, malformed, complete)', () => {
  test('absent: nothing new is kept, the project and its threads as 0.6.0 had them', async () => {
    const p = lined({ tasks: [{ task: 'Copy', ticket_id: null, minutes: 64, thread_count: 1, people: [], last_activity_at: '', active_now: true }] })
    expect('lines' in p).toBe(false)
    expect('proposals' in p).toBe(false)
    expect('line' in (p.threads[0] ?? {})).toBe(false)
    expect('line_key' in (p.today?.tasks[0] ?? {})).toBe(false)
    expect(lineOfThread(p, sid => sid === 'mine')).toBeUndefined()
    // and the pane draws what it draws with none of them: (0.7.5) the one line, the numbers, the time list, and no line's words
    expect(drawn(p).slice(0, 3)).toEqual(['⏱ This thread: Acme Roofing · Copy · 1h 04m today', 'Today: 1.8 h of your time · 1.8 h of thread time', 'Copy · 1h 04m (this thread)'])
    expect(drawn(p)).not.toContain(LINES_TODAY)
    expect(drawn(p).some(l => l.startsWith('Counts toward') || l.startsWith('Proposed'))).toBe(false)
  })

  test('malformed: a list that is not one is absent; entries of the wrong shape go; a signal OW does not use is no line', async () => {
    expect('lines' in lined({ lines: 'nope', proposals: { a: 1 } })).toBe(false)
    const p = lined({
      lines: [
        LINES[0],
        { line_key: 'L-1; rm -rf ~', title: 'x', line_type: 'deliverable' },
        { line_key: 'L-99999999', title: 'y', line_type: 'retainer' },
        null,
        { line_key: 'L-aaaaaaaa', title: 'Line\nwith a break', line_type: 'fixes', status: 'active', estimate_hours: -1, minutes: 'ten' },
      ],
      proposals: [{ ticket_id8: 'zzzzzzzz', title: 'bad' }, { ticket_id8: 'ABCDEF12', title: 'Spanish landing page', created_at: '2026-10-26T12:00:00Z' }],
      tasks: [{ task: 'Copy', minutes: 1, line_key: 'not a key' }, { task: 'Router', minutes: 1, line_key: L_ROUTER }],
      line: { signal: 'mystery', via: 'declared' },
    })
    expect(p.lines?.map(l => l.line_key)).toEqual([L_COPY, 'L-aaaaaaaa'])
    expect(p.lines?.[1]).toEqual({ line_key: 'L-aaaaaaaa', title: 'Line with a break', line_type: 'fixes', status: 'active', estimate_hours: null, minutes: null })
    expect(p.proposals).toEqual([{ ticket_id8: 'abcdef12', title: 'Spanish landing page', created_at: '2026-10-26T12:00:00Z' }])
    expect('line_key' in (p.today?.tasks[0] ?? {})).toBe(false)
    expect(p.today?.tasks[1]?.line_key).toBe(L_ROUTER)
    expect('line' in (p.threads[0] ?? {})).toBe(false)
    // a line whose parts are of the wrong shape keeps its signal and drops the parts
    expect(parseThreadLine({ signal: 'unmatched', via: 'teleport', line_key: 'nope', line_type: 'x', estimate_hours: 'many', candidates: [{ line_key: 'bad' }, { line_key: L_SITE, title: 'Website refresh' }], proposal: { ticket_id8: 'xyz' } })).toEqual({
      via: 'none', line_key: null, title: null, line_type: null, estimate_hours: null, signal: 'unmatched', candidates: [{ line_key: L_SITE, title: 'Website refresh', line_type: 'deliverable' }], proposal: null,
    })
    expect(parseThreadLine(null)).toBeUndefined()
    expect(parseThreadLine('on_line')).toBeUndefined()
  })

  test('complete: every field kept, trimmed to what the store keeps', async () => {
    const many = Array.from({ length: 60 }, (_, n) => ({ ...LINES[0], line_key: `L-${String(n).padStart(8, '0')}` }))
    const p = lined({
      lines: many,
      line: thread('on_line', { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable', estimate_hours: 12, candidates: Array.from({ length: 9 }, (_, n) => ({ line_key: `L-c000000${n}`, title: `C${n}`, line_type: 'deliverable' })), proposal: { ticket_id8: 'F779A7A0', title: 'Spanish landing page' } }),
    })
    expect(p.lines?.length).toBe(40)
    const line = lineOfThread(p, sid => sid === 'mine')
    expect(line?.task).toBe('Copy')
    expect(line?.line).toMatchObject({ via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence', line_type: 'deliverable', estimate_hours: 12, signal: 'on_line', proposal: { ticket_id8: 'f779a7a0', title: 'Spanish landing page' } })
    expect(line?.line.candidates.length).toBe(5)
    // another thread's line is not this thread's
    expect(lineOfThread(p, () => false)).toBeUndefined()
  })

  test('the lines and proposals come with today: a read without today keeps them; a today without them has none', async () => {
    const first = lined({ lines: LINES, proposals: [{ ticket_id8: 'abcdef12', title: 'Spanish landing page', created_at: '' }] })
    const a = mergeTime(undefined, first, NOW, 'T1', true)
    expect(a.p?.lines?.length).toBe(4)
    const weekOnly: TimeProject = { ...first, today: null, threads: [] }
    delete weekOnly.lines
    delete weekOnly.proposals
    const b = mergeTime(a, weekOnly, NOW + 1, 'T2', true)
    expect(b.p?.lines?.length).toBe(4)
    expect(b.p?.proposals?.length).toBe(1)
    const c = mergeTime(b, lined(), NOW + 2, 'T3', false)
    expect(c.p && 'lines' in c.p).toBe(false)
  })
})

describe('0.7.0: the Tracking part names the line (verbatim)', () => {
  const p = lined({ lines: LINES })

  test('each signal\'s line under the heading', async () => {
    const cases: Array<[ThreadLine, string]> = [
      [tl('on_line', { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence', estimate_hours: 12 }), 'Counts toward: Phase 1 nurture sequence · est 12 h · 1h 04m today'],
      [tl('on_line', { via: 'ticket', line_key: L_SITE, title: 'Website refresh', estimate_hours: 20 }), 'Counts toward: Website refresh · est 20 h'],
      [tl('on_line', { via: 'ticket', line_key: 'L-77777777', title: 'Unlisted line' }), 'Counts toward: Unlisted line'],
      [tl('on_line', { via: 'bank', line_key: L_BANK, title: 'Support hour bank', line_type: 'bank' }), 'Counts toward: Support hour bank (hour bank)'],
      [tl('account_work', { via: 'bank', line_key: L_BANK, title: 'Support hour bank' }), 'Counts toward: account work · Support hour bank (hour bank)'],
      [tl('account_work', { via: 'none' }), 'Counts toward: account work'],
      [tl('fix', { via: 'ticket', line_key: L_ROUTER, title: 'Inbound lead router and assignment rules', estimate_hours: 6 }), 'Counts toward: Inbound lead router and assignment rules · est 6 h · 42m today'],
      [tl('fix', { via: 'none' }), 'Counts toward: no line yet (a fix)'],
      [tl('proposed', { proposal: { ticket_id8: 'abcdef12', title: 'Spanish landing page' } }), 'Proposed new line: Spanish landing page · waiting for Acme Roofing\'s yes'],
      [tl('unmatched'), 'Counts toward: no line yet'],
      [tl('maybe_new_scope', { candidates: [{ line_key: L_SITE, title: 'Website refresh' }] }), 'Counts toward: no line yet'],
      [tl('no_quote'), 'Counts toward: no quote on record for Acme Roofing'],
    ]
    for (const [line, text] of cases) expect(countsToward(line, p, 'Acme Roofing')).toBe(text)
    // the estimate from the project's line when the thread's has none; a minutes of null (not the viewer's to see) shows no today
    const hidden = lined({ lines: LINES.map(l => ({ ...l, minutes: null })) })
    expect(countsToward(tl('on_line', { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence' }), hidden, 'Acme Roofing')).toBe('Counts toward: Phase 1 nurture sequence · est 12 h')
  })

  test('drawn as the second line, under the heading; absent, no line at all', async () => {
    const on = lined({ lines: LINES, line: thread('on_line', { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence', estimate_hours: 12 }) })
    // (0.7.5) under the one line the part closes to, before the numbers
    expect(drawn(on).slice(0, 3)).toEqual(['⏱ This thread: Acme Roofing · Copy · 1h 04m today', 'Counts toward: Phase 1 nurture sequence · est 12 h · 1h 04m today', 'Today: 1.8 h of your time · 1.8 h of thread time'])
    expect(drawn(lined({ lines: LINES }))[1]).toBe('Today: 1.8 h of your time · 1.8 h of thread time')
  })

  test('a task row names its line, at most 28 characters; a key that is no line of the project names none', async () => {
    const q = lined({
      lines: LINES,
      tasks: [
        { task: 'Copy', minutes: 64, people: ['a@example.com'], active_now: true, line_key: L_COPY },
        { task: 'f779a7a0 Router', minutes: 42, people: [], line_key: L_ROUTER },
        { task: 'Other', minutes: 5, people: [], line_key: 'L-99999999' },
      ],
    })
    const rows = drawn(q)
    // (0.7.5) the one time list by task: no activity mark, and this thread's own task says so
    expect(rows).toContain('Copy · 1h 04m · Avery → Phase 1 nurture sequence (this thread)')
    expect(rows).toContain('f779a7a0 Router · 42m → Inbound lead router and ass…')
    expect(rows).toContain('Other · 5m')
    expect(lineButton('Inbound lead router and assignment rules')).toBe('Inbound lead router and ass…')
  })

  test('Lines today: each line with minutes today, with its estimate, then each proposal; omitted when there are none', async () => {
    const q = lined({ lines: LINES, proposals: [{ ticket_id8: 'abcdef12', title: 'Spanish landing page', created_at: '' }], tasks: [{ task: 'Copy', minutes: 64, people: [] }] })
    const rows = drawn(q)
    const at = rows.indexOf(LINES_TODAY)
    // (0.7.5) right under the one time list (here, its one task)
    expect(at).toBe(rows.indexOf('Copy · 1h 04m (this thread)') + 1)
    expect(at).toBeGreaterThan(0)
    expect(rows.slice(at, at + 4)).toEqual([LINES_TODAY, 'Phase 1 nurture sequence · 1h 04m · est 12 h', 'Inbound lead router and assignment rules · 42m · est 6 h', 'Proposed: Spanish landing page · waiting for yes'])
    // a line with no estimate, and lines the viewer may not see (null minutes)
    const r = drawn(lined({ lines: [{ ...LINES[0], estimate_hours: null }, { ...LINES[1], minutes: null }] }))
    expect(r.slice(r.indexOf(LINES_TODAY), r.indexOf(LINES_TODAY) + 2)).toEqual([LINES_TODAY, 'Phase 1 nurture sequence · 1h 04m'])
    expect(r).not.toContain('Inbound lead router and assignment rules · 42m · est 6 h')
    // no minutes on any line and no proposal: no section
    expect(drawn(lined({ lines: LINES.map(l => ({ ...l, minutes: null })), proposals: [] }))).not.toContain(LINES_TODAY)
    expect(fmtEst(12)).toBe('12')
    expect(fmtEst(1.25)).toBe('1.3')
  })

  test('the status line names the line, at most 24 characters, when the thread is on one', async () => {
    expect(trackStatus({ client: 'Acme Roofing', task: 'Copy', minutes: 64, counted: true, line: 'Phase 1 nurture sequence' })).toBe('⏱ Acme Roofing · Copy → Phase 1 nurture sequence · this thread 1h 04m today')
    expect(trackStatus({ client: 'Acme Roofing', task: 'Copy', minutes: 64, counted: true, line: 'Inbound lead router and assignment rules' })).toBe('⏱ Acme Roofing · Copy → Inbound lead router and… · this thread 1h 04m today')
    expect(trackStatus({ client: 'Acme Roofing', task: 'Copy', minutes: 64, counted: true })).toBe('⏱ Acme Roofing · Copy · this thread 1h 04m today')
    expect(statusLineTitle(tl('on_line', { via: 'declared', line_key: L_COPY, title: 'Phase 1 nurture sequence' }), p)).toBe('Phase 1 nurture sequence')
    expect(statusLineTitle(tl('on_line', { via: 'ticket', line_key: L_ROUTER }), p)).toBe('Inbound lead router and assignment rules')
    expect(statusLineTitle(tl('fix', { via: 'ticket', line_key: L_ROUTER, title: 'Router' }), p)).toBe('Router')
    for (const s of ['fix', 'unmatched', 'maybe_new_scope', 'no_quote', 'proposed', 'account_work']) expect(statusLineTitle(tl(s), p)).toBeUndefined()
    expect(statusLineTitle(undefined, p)).toBeUndefined()
  })
})

describe('0.7.0: the line band and the notes for Claude (verbatim)', () => {
  test('when it asks, and where', async () => {
    expect(asksForLine(tl('unmatched'))).toBe(true)
    expect(asksForLine(tl('maybe_new_scope'))).toBe(true)
    for (const s of ['on_line', 'fix', 'account_work', 'proposed', 'no_quote']) expect(asksForLine(tl(s))).toBe(false)
    expect(asksForLine(undefined)).toBe(false)
    expect(asksInSession({}, false, true)).toBe(true)
    expect(asksInSession({ single: true }, false, true)).toBe(false)
    expect(asksInSession({}, true, true)).toBe(false)
    expect(asksInSession({}, false, false)).toBe(false)
    expect(lineAskKey(ACME, 'Copy')).toBe(`${ACME}|Copy`)
    expect(lineAskKey(ACME, undefined)).toBe(`${ACME}|`)
  })

  test('the band\'s words, its buttons and the note each press adds', async () => {
    expect(lineAskText('Acme Roofing', 'unmatched')).toBe('Acme Roofing: which line does this work count toward?')
    expect(lineAskText('Acme Roofing', 'maybe_new_scope')).toBe('Acme Roofing: this doesn\'t match a line on the quote.')
    expect([LINE_NEW, LINE_BANK, LINE_LATER]).toEqual(['New scope', 'Prepaid hours', 'Not now'])
    expect(lineNote('Acme Roofing', 'Website refresh', L_SITE)).toBe(
      `[mm-bridge] The person says this thread's work counts toward Acme Roofing's line "Website refresh". Before your next step, call the mm tool with "line ${L_SITE}" and do what it returns.`,
    )
    expect(newScopeNote('Acme Roofing')).toBe(
      '[mm-bridge] The person says this thread\'s work is new scope for Acme Roofing. Before your next step, write a short title for it (the words the client would see on a quote), one line on why, and your estimate in hours, and decide whether it is urgent (something broken that is costing the client money right now). Then call the mm tool with "propose <title> -- <why> -- <N>h" (add " urgent" when it is) and do what it returns. A fix to something Massmarket built is not new scope: if that is what this is, say so to the person instead.',
    )
    expect(bankNote('Acme Roofing')).toBe('[mm-bridge] The person says this thread\'s work comes out of Acme Roofing\'s prepaid hours. Before your next step, call the mm tool with "bank" and do what it returns.')
    // text from OW goes to Claude cleaned: no quotes, no shell characters
    expect(forClaude('Fix "router" $(whoami) `x` \\ now')).toBe('Fix router (whoami) x now')
  })

  test('the thread\'s one note: three candidates and a bank, as the spec words it', async () => {
    expect(askNote({ client: 'Acme Roofing', task: 'Copy', candidates: [{ line_key: L_COPY, title: 'Phase 1 nurture sequence' }, { line_key: L_ROUTER, title: 'Router' }, { line_key: L_SITE, title: 'Website refresh' }], bank: true })).toBe(
      `[mm-bridge] Massmarket time tracking: this thread's work ("Copy") does not match a line on Acme Roofing's quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: does it count toward "Phase 1 nurture sequence" (${L_COPY}), "Router" (${L_ROUTER}) or "Website refresh" (${L_SITE}), is it new scope (small items go ahead and the client is told; bigger ones wait for their yes), or does it come out of their prepaid hours? Then act on the answer with the mm tool: "line <line_key>", "propose <title> -- <why> -- <N>h" or "bank" (prepaid hours). Keep working while you wait for the answer.`,
    )
  })

  test('the thread\'s one note: only the candidates that exist; no bank clause without a bank; no "count toward" clause without candidates', async () => {
    expect(askNote({ client: 'Acme Roofing', task: 'Copy', candidates: [{ line_key: L_SITE, title: 'Website refresh' }], bank: false })).toBe(
      `[mm-bridge] Massmarket time tracking: this thread's work ("Copy") does not match a line on Acme Roofing's quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: does it count toward "Website refresh" (${L_SITE}), or is it new scope (small items go ahead and the client is told; bigger ones wait for their yes)? Then act on the answer with the mm tool: "line <line_key>" or "propose <title> -- <why> -- <N>h". Keep working while you wait for the answer.`,
    )
    expect(askNote({ client: 'Acme Roofing', task: 'Copy', candidates: [], bank: true })).toBe(
      '[mm-bridge] Massmarket time tracking: this thread\'s work ("Copy") does not match a line on Acme Roofing\'s quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: is it new scope (small items go ahead and the client is told; bigger ones wait for their yes), or does it come out of their prepaid hours? Then act on the answer with the mm tool: "propose <title> -- <why> -- <N>h" or "bank" (prepaid hours). Keep working while you wait for the answer.',
    )
    expect(askNote({ client: 'Acme Roofing', task: '', candidates: [], bank: false })).toBe(
      '[mm-bridge] Massmarket time tracking: this thread\'s work does not match a line on Acme Roofing\'s quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: is it new scope (small items go ahead and the client is told; bigger ones wait for their yes)? Then act on the answer with the mm tool: "propose <title> -- <why> -- <N>h". Keep working while you wait for the answer.',
    )
    // at most three candidates
    const four = [L_COPY, L_ROUTER, L_SITE, 'L-55555555'].map((k, n) => ({ line_key: k, title: `C${n}` }))
    expect(askNote({ client: 'Acme Roofing', task: 'Copy', candidates: four, bank: false })).not.toContain('L-55555555')
  })
})

describe('0.7.0: what mm line, propose and bank answer (verbatim)', () => {
  test('the ticket a label works, and the label without its prefix', async () => {
    expect(ticketOf('f779a7a0 Fix inbound router')).toBe('f779a7a0')
    expect(ticketOf('F779A7A0-fix')).toBe('f779a7a0')
    expect(ticketOf('L-1a2b3c4d Copy')).toBe('')
    expect(ticketOf('deadbeefcafe build')).toBe('')
    expect(ticketOf('Copy')).toBe('')
    expect(ticketOf(undefined)).toBe('')
    expect(withoutPrefix('L-1a2b3c4d Phase 1 copy')).toBe('Phase 1 copy')
    expect(withoutPrefix('f779a7a0 Fix inbound router')).toBe('Fix inbound router')
    expect(withoutPrefix('f779a7a0-fix')).toBe('fix')
    expect(withoutPrefix('Phase 1 copy')).toBe('Phase 1 copy')
  })

  test('the hook command, with PowerShell\'s form on Windows', async () => {
    expect(hookCommand(`${L_COPY} Copy`, false)).toBe(`node ~/.claude/mm-hooks/worklog-hook.js --task "${L_COPY} Copy"`)
    expect(hookCommand(`${L_COPY} Copy`, true)).toBe(
      `node ~/.claude/mm-hooks/worklog-hook.js --task "${L_COPY} Copy" (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "${L_COPY} Copy")`,
    )
    expect(declareLineText({ key: L_COPY, title: 'Phase 1 nurture sequence', task: 'L-99999999 Nurture "copy"', windows: false })).toBe(
      `Run this to count this thread's work to Phase 1 nurture sequence from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_COPY} Nurture copy"`,
    )
    // no task declared: the line's title is the task
    expect(declareLineText({ key: L_COPY, title: 'Phase 1 nurture sequence', task: undefined, windows: false })).toBe(
      `Run this to count this thread's work to Phase 1 nurture sequence from now on: node ~/.claude/mm-hooks/worklog-hook.js --task "${L_COPY} Phase 1 nurture sequence"`,
    )
    expect(linkedText('f779a7a0', 'Website refresh')).toBe('Linked ticket f779a7a0 to Website refresh; its time counts there now.')
    expect(noBankText('Acme Roofing')).toBe('Acme Roofing has no hour bank on record; ask the person which line, or propose new scope.')
  })

  test('propose: its arguments, and what it answers new or existing', async () => {
    expect(proposalArgs('Spanish landing page -- the client asked for a Spanish version on the call')).toEqual({ title: 'Spanish landing page', why: 'the client asked for a Spanish version on the call', urgent: false })
    expect(proposalArgs('Spanish landing page')).toEqual({ title: 'Spanish landing page', why: '', urgent: false })
    expect(proposalArgs(' -- why only')).toBeNull()
    expect(proposalArgs('')).toBeNull()
    expect(proposalArgs(`${'t'.repeat(200)} -- ${'w'.repeat(900)}`)?.title.length).toBe(120)
    expect(proposalArgs(`t -- ${'w'.repeat(900)}`)?.why.length).toBe(500)
    expect(proposedText({ title: 'Spanish landing page', client: 'Acme Roofing', id8: 'abcdef12', existing: false, windows: false })).toBe(
      'Proposed "Spanish landing page" for Acme Roofing (ticket abcdef12). Run this so the work counts to the proposal: node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page"',
    )
    expect(proposedText({ title: 'Spanish landing page', client: 'Acme Roofing', id8: 'abcdef12', existing: true, windows: true })).toBe(
      'Already proposed "Spanish landing page" for Acme Roofing (ticket abcdef12). Run this so the work counts to the proposal: node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page" (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "abcdef12 Spanish landing page")',
    )
  })

  test('the hour bank: the most recent active bank line; a closed one is none', async () => {
    expect(bankLine(lined({ lines: LINES }))?.line_key).toBe(L_BANK)
    const two = lined({ lines: [...LINES, { ...LINES[3], line_key: 'L-bbbbbbbb', title: 'Second bank' }] })
    expect(bankLine(two)?.line_key).toBe('L-bbbbbbbb')
    expect(bankLine(lined({ lines: [...LINES.slice(0, 3), { ...LINES[3], status: 'closed' }] }))).toBeUndefined()
    expect(bankLine(lined({ lines: LINES.slice(0, 3) }))).toBeUndefined()
    expect(bankLine(lined())).toBeUndefined()
  })
})

// ======================================================================== 0.7.1: new scope goes ahead when small, waits for a yes when big
// Rob, 2026-10-26 (decision_log 99395076): new scope never comes out of revision hours. Small new scope (about 2 h or
// less) = tell the client and go, billed on the next invoice or from prepaid hours; over 2 h or no estimate = wait for
// the client's yes; urgent (actively costing the client money) = carry on now; a client set to always ask first always
// waits; small unbilled items are capped at 2 h in all. The estimate is what is billed, never agent time. Every client,
// line and number here is a fixture.

/** A project as OW's client-time answer gives it, with the project-level fields `extra` adds (`prepaid_hours_left`, ...). */
const settled = (extra: Record<string, unknown>, o: { line?: unknown; lines?: unknown; proposals?: unknown; tasks?: unknown[] } = {}): TimeProject => {
  const parsed = parseClientTime({
    as_of: new Date(NOW).toISOString(),
    viewer: { email: 'a@example.com', can_see_leverage: true },
    projects: [{
      project_id: ACME, name: 'Acme Roofing — Pat',
      today: day(o.tasks ?? []), week: null, leverage: null,
      threads: [{ session_id: 'mine', title: 'Acme copy', member_email: 'a@example.com', member_name: 'Avery Lane', task: 'Copy', ticket_id: null, minutes_today: 64, last_activity_at: new Date(NOW).toISOString(), active_now: true, ...(o.line !== undefined ? { line: o.line } : {}) }],
      lines: o.lines ?? LINES,
      ...(o.proposals !== undefined ? { proposals: o.proposals } : {}),
      ...extra,
    }],
  })?.projects[0]
  if (!parsed) throw new Error('fixture')
  return parsed
}
const SPANISH = { ticket_id8: 'abcdef12', title: 'Spanish landing page', created_at: '2026-10-26T12:00:00Z' }
const CMD = 'node ~/.claude/mm-hooks/worklog-hook.js --task "abcdef12 Spanish landing page"'
const PS = ' (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "abcdef12 Spanish landing page")'
const rec = (over: Partial<Parameters<typeof recordedText>[0]> = {}) =>
  recordedText({ title: 'Spanish landing page', client: 'Acme Roofing', id8: 'abcdef12', existing: false, windows: false, mode: 'tell_and_go', ...over })

describe('0.7.1: OW\'s new-scope fields, checked (absent, malformed, complete)', () => {
  test('absent: nothing new is kept, as 0.7.0 had it', async () => {
    const p = lined({ lines: LINES, proposals: [SPANISH] })
    for (const k of ['prepaid_hours_left', 'always_ask', 'small_limit_hours']) expect(k in p).toBe(false)
    expect('told' in (p.lines?.[0] ?? {})).toBe(false)
    expect('billed' in (p.lines?.[0] ?? {})).toBe(false)
    expect(p.proposals).toEqual([SPANISH])
    expect(offersPrepaid(p)).toBe(true)
  })

  test('complete: every field kept', async () => {
    const p = settled(
      { prepaid_hours_left: 3.5, always_ask: true, small_limit_hours: 2 },
      { lines: [{ ...LINES[0], told: true, billed: false }, LINES[1]], proposals: [{ ...SPANISH, mode: 'tell_and_go', estimate_hours: 1.5, reason: 'small' }], line: thread('proposed', { proposal: { ticket_id8: 'ABCDEF12', title: 'Spanish landing page', mode: 'urgent' } }) },
    )
    expect([p.prepaid_hours_left, p.always_ask, p.small_limit_hours]).toEqual([3.5, true, 2])
    expect(p.lines?.[0]).toMatchObject({ told: true, billed: false })
    expect(p.proposals?.[0]).toEqual({ ...SPANISH, mode: 'tell_and_go', estimate_hours: 1.5, reason: 'small' })
    expect(lineOfThread(p, sid => sid === 'mine')?.line.proposal).toEqual({ ticket_id8: 'abcdef12', title: 'Spanish landing page', mode: 'urgent' })
    // null prepaid hours: none to draw on
    expect(settled({ prepaid_hours_left: null }).prepaid_hours_left).toBeNull()
  })

  test('malformed: each field of another shape is absent (0.7.0\'s rules), never a guess', async () => {
    const p = settled(
      { prepaid_hours_left: '5', always_ask: 'yes', small_limit_hours: 0 },
      { lines: [{ ...LINES[0], told: 'yes', billed: 1 }], proposals: [{ ...SPANISH, mode: 'maybe', estimate_hours: -2, reason: 'because' }] },
    )
    for (const k of ['prepaid_hours_left', 'always_ask', 'small_limit_hours']) expect(k in p).toBe(false)
    expect('told' in (p.lines?.[0] ?? {})).toBe(false)
    expect('billed' in (p.lines?.[0] ?? {})).toBe(false)
    expect(p.proposals).toEqual([SPANISH])
    expect('prepaid_hours_left' in settled({ prepaid_hours_left: -1 })).toBe(false)
    expect([modeOf('tell_and_go'), modeOf('needs_yes'), modeOf('urgent'), modeOf('later'), modeOf(undefined)]).toEqual(['tell_and_go', 'needs_yes', 'urgent', undefined, undefined])
    expect([settleOf('next_invoice'), settleOf('prepaid_hours'), settleOf('cash')]).toEqual(['next_invoice', 'prepaid_hours', undefined])
    expect(['small', 'over_limit', 'always_ask', 'small_items_cap', 'no_estimate', 'urgent', 'other'].map(reasonOf)).toEqual(['small', 'over_limit', 'always_ask', 'small_items_cap', 'no_estimate', 'urgent', undefined])
  })

  test('the settings come with today, as the lines do: a read without today keeps them; a today without them has none', async () => {
    const first = settled({ prepaid_hours_left: 4, always_ask: true, small_limit_hours: 2 })
    const a = mergeTime(undefined, first, NOW, 'T1', true)
    expect([a.p?.prepaid_hours_left, a.p?.always_ask, a.p?.small_limit_hours]).toEqual([4, true, 2])
    const weekOnly: TimeProject = { project_id: ACME, name: '', today: null, week: null, threads: [], leverage: null }
    const b = mergeTime(a, weekOnly, NOW + 1, 'T2', true)
    expect([b.p?.prepaid_hours_left, b.p?.always_ask, b.p?.small_limit_hours]).toEqual([4, true, 2])
    const c = mergeTime(b, lined(), NOW + 2, 'T3', false)
    for (const k of ['prepaid_hours_left', 'always_ask', 'small_limit_hours']) expect(c.p && k in c.p).toBe(false)
  })
})

describe('0.7.1: mm propose reads the estimate and urgent', () => {
  test('the forms of -- <N>h: <N>h, <N> h, <N> hours', async () => {
    const why = 'the client asked for a Spanish version on the call'
    expect(proposalArgs(`Spanish landing page -- ${why} -- 1.5h`)).toEqual({ title: 'Spanish landing page', why, estimate: 1.5, urgent: false })
    expect(proposalArgs(`Spanish landing page -- ${why} -- 1.5 h`)?.estimate).toBe(1.5)
    expect(proposalArgs(`Spanish landing page -- ${why} -- 3 hours`)?.estimate).toBe(3)
    expect(proposalArgs(`Spanish landing page -- ${why} -- 1 hour`)?.estimate).toBe(1)
    expect(proposalArgs(`Spanish landing page -- ${why} -- 2H`)?.estimate).toBe(2)
    expect(proposalArgs(`Spanish landing page -- ${why} -- .5h`)?.estimate).toBe(0.5)
    expect(proposalArgs(`Spanish landing page -- ${why} -- ${ESTIMATE_HOURS.min}h`)?.estimate).toBe(0.25)
    expect(proposalArgs(`Spanish landing page -- ${why} -- ${ESTIMATE_HOURS.max} hours`)?.estimate).toBe(200)
    // with no why: the estimate is still read
    expect(proposalArgs('Spanish landing page -- 2h')).toEqual({ title: 'Spanish landing page', why: '', estimate: 2, urgent: false })
    // a number with no unit is part of the why
    expect(proposalArgs('Spanish landing page -- pages for 2026 -- 2')).toEqual({ title: 'Spanish landing page', why: 'pages for 2026 -- 2', urgent: false })
  })

  test('urgent: after the estimate, as its own part, or alone; a why that ends in "urgent" stays the why', async () => {
    expect(proposalArgs('Fix booking form -- form is down and leads are lost -- 1.5h urgent')).toEqual({ title: 'Fix booking form', why: 'form is down and leads are lost', estimate: 1.5, urgent: true })
    expect(proposalArgs('Fix booking form -- form is down -- 2 hours urgent')).toMatchObject({ estimate: 2, urgent: true, why: 'form is down' })
    expect(proposalArgs('Fix booking form -- form is down -- 2h -- urgent')).toMatchObject({ estimate: 2, urgent: true, why: 'form is down' })
    expect(proposalArgs('Fix booking form -- form is down -- URGENT')).toEqual({ title: 'Fix booking form', why: 'form is down', urgent: true })
    expect(proposalArgs('Spanish landing page -- the client says it is not urgent')).toEqual({ title: 'Spanish landing page', why: 'the client says it is not urgent', urgent: false })
    expect(proposalArgs('Spanish landing page -- not urgent -- 2h')).toEqual({ title: 'Spanish landing page', why: 'not urgent', estimate: 2, urgent: false })
  })

  test('an estimate out of range (0.25 to 200 hours) is refused, nothing kept', async () => {
    for (const n of ['0.1h', '0h', '201h', '500 hours']) {
      const a = proposalArgs(`Spanish landing page -- why -- ${n}`)
      expect(a?.badEstimate).toBe(true)
      expect(a && 'estimate' in a).toBe(false)
    }
    expect(BAD_ESTIMATE).toBe('The estimate is in hours, from 0.25 to 200: mm propose <title> -- <why> -- <N>h (add " urgent" when it is). Nothing was recorded.')
    // still no title, still null
    expect(proposalArgs(' -- why -- 2h')).toBeNull()
  })
})

describe('0.7.1: what mm propose answers, by OW\'s mode and reason (verbatim)', () => {
  test('tell_and_go: carry on, the next reply tells the client, billed at the estimate on the next invoice', async () => {
    expect(rec({ estimate: 1.5 })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it goes on the next invoice at about 1.5 h. Run this so the work counts to it: ${CMD}`)
    expect(rec({ estimate: 1.5, settle: 'next_invoice' })).toBe(rec({ estimate: 1.5 }))
  })

  test('tell_and_go from prepaid hours', async () => {
    expect(rec({ estimate: 0.25, settle: 'prepaid_hours' })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It's small (about 0.25 h), so carry on: the next reply tells Acme Roofing, and it comes out of their prepaid hours at about 0.25 h. Run this so the work counts to it: ${CMD}`)
  })

  test('needs_yes: over the limit, always ask, the small items at their cap, no estimate', async () => {
    const spent = `Run this so any time already spent counts to it: ${CMD}`
    expect(rec({ mode: 'needs_yes', reason: 'over_limit', estimate: 6 })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). At about 6 h it needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. ${spent}`)
    expect(rec({ mode: 'needs_yes', reason: 'always_ask', estimate: 1 })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). Acme Roofing is set to always ask first, so pause the new part: the next reply asks for it. ${spent}`)
    expect(rec({ mode: 'needs_yes', reason: 'small_items_cap', estimate: 1 })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). Acme Roofing's small new-scope items since the last invoice already add up to 2 hours, so this one needs their yes first. Pause the new part: the next reply asks for it. ${spent}`)
    expect(rec({ mode: 'needs_yes', reason: 'small_items_cap', estimate: 1, limit: 2 })).toBe(rec({ mode: 'needs_yes', reason: 'small_items_cap', estimate: 1 }))
    expect(rec({ mode: 'needs_yes', reason: 'no_estimate' })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). Without an estimate it needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. ${spent}`)
    // a reason OW did not give: the yes, plainly
    expect(rec({ mode: 'needs_yes' })).toBe(`Recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. ${spent}`)
  })

  test('urgent: carry on now, billed at the estimate; with no estimate, the actual time', async () => {
    expect(rec({ mode: 'urgent', reason: 'urgent', estimate: 1.5 })).toBe(`Recorded "Spanish landing page" as urgent new scope for Acme Roofing (ticket abcdef12). Carry on now: the next reply tells Acme Roofing we're on it, and it goes on the next invoice at about 1.5 h. Run this so the work counts to it: ${CMD}`)
    expect(rec({ mode: 'urgent', reason: 'urgent' })).toBe(`Recorded "Spanish landing page" as urgent new scope for Acme Roofing (ticket abcdef12). Carry on now: the next reply tells Acme Roofing we're on it, and the actual time goes on the next invoice. Run this so the work counts to it: ${CMD}`)
  })

  test('already recorded, Windows, and text from OW cleaned', async () => {
    expect(rec({ estimate: 1.5, existing: true })).toBe(`Already recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). It's small (about 1.5 h), so carry on: the next reply tells Acme Roofing, and it goes on the next invoice at about 1.5 h. Run this so the work counts to it: ${CMD}`)
    expect(rec({ mode: 'needs_yes', reason: 'no_estimate', existing: true, windows: true })).toBe(`Already recorded "Spanish landing page" as new scope for Acme Roofing (ticket abcdef12). Without an estimate it needs Acme Roofing's yes first, so pause the new part: the next reply asks for it. Run this so any time already spent counts to it: ${CMD}${PS}`)
    expect(rec({ title: 'Spanish "landing" page $(x)', estimate: 1 })).toContain('"Spanish landing page (x)"')
    expect([fmtAbout(2), fmtAbout(1.5), fmtAbout(0.25), fmtAbout(1.333)]).toEqual(['2', '1.5', '0.25', '1.33'])
  })

  test('mm bank with no prepaid hours left', async () => {
    expect(noPrepaidText('Acme Roofing')).toBe('Acme Roofing has no prepaid hours left; ask the person which line, or record it as new scope.')
  })
})

describe('0.7.1: the pane and the band (verbatim)', () => {
  /** Acme with the Spanish landing page proposed (in `mode`, when OW gives one) and this thread working it. */
  const proposed = (mode?: string) => settled({}, { proposals: [{ ...SPANISH, ...(mode ? { mode } : {}) }], line: thread('proposed', { proposal: { ticket_id8: 'abcdef12', title: 'Spanish landing page' } }) })

  test('a proposal that goes ahead is told in the next reply; one that waits is waiting for a yes', async () => {
    const line = tl('proposed', { proposal: { ticket_id8: 'abcdef12', title: 'Spanish landing page' } })
    expect(countsToward(line, proposed('tell_and_go'), 'Acme Roofing')).toBe('New scope: Spanish landing page · Acme Roofing is told in the next reply')
    expect(countsToward(line, proposed('urgent'), 'Acme Roofing')).toBe('New scope: Spanish landing page · Acme Roofing is told in the next reply')
    expect(countsToward(line, proposed('needs_yes'), 'Acme Roofing')).toBe('Proposed new line: Spanish landing page · waiting for Acme Roofing\'s yes')
    expect(countsToward(line, proposed(), 'Acme Roofing')).toBe('Proposed new line: Spanish landing page · waiting for Acme Roofing\'s yes')
    // the mode on the thread's own line wins over the project's proposal
    const own = tl('proposed', { proposal: { ticket_id8: 'abcdef12', title: 'Spanish landing page', mode: 'tell_and_go' } })
    expect(proposalMode(own, proposed('needs_yes'))).toBe('tell_and_go')
    expect([goesAhead('tell_and_go'), goesAhead('urgent'), goesAhead('needs_yes'), goesAhead(undefined)]).toEqual([true, true, false, false])
  })

  test('Lines today: a proposal row by its mode', async () => {
    const rows = (mode?: string) => {
      const r = drawn(proposed(mode))
      return r.slice(r.indexOf(LINES_TODAY))
    }
    expect(rows('tell_and_go')).toContain('New scope: Spanish landing page · told in the next reply')
    expect(rows('urgent')).toContain('New scope: Spanish landing page · told in the next reply')
    expect(rows('needs_yes')).toContain('Proposed: Spanish landing page · waiting for yes')
    expect(rows()).toContain('Proposed: Spanish landing page · waiting for yes')
    // (0.7.5) under the one line the part closes to
    expect(drawn(proposed('tell_and_go')).slice(0, 2)).toEqual(['⏱ This thread: Acme Roofing · Copy · 1h 04m today', 'New scope: Spanish landing page · Acme Roofing is told in the next reply'])
  })

  test('Lines today: a told, unbilled line says it goes on the next invoice; billed or not told, it does not', async () => {
    const p = settled({}, { lines: [{ ...LINES[0], told: true, billed: false }, { ...LINES[1], told: true, billed: true }, { ...LINES[3], minutes: 19, told: false, billed: false }] })
    const r = drawn(p)
    expect(r.slice(r.indexOf(LINES_TODAY), r.indexOf(LINES_TODAY) + 4)).toEqual([
      LINES_TODAY,
      'Phase 1 nurture sequence · 1h 04m · est 12 h · new scope, next invoice',
      'Inbound lead router and assignment rules · 42m · est 6 h',
      'Support hour bank · 19m · est 10 h',
    ])
    expect(NEXT_INVOICE).toBe(' · new scope, next invoice')
    expect((p.lines ?? []).map(toldUnbilled)).toEqual([true, false, false])
  })

  test('Prepaid hours: offered with prepaid hours left; not with none, or null; with no word from OW, where there is a bank', async () => {
    expect(offersPrepaid(settled({ prepaid_hours_left: 3 }))).toBe(true)
    expect(offersPrepaid(settled({ prepaid_hours_left: 3 }, { lines: LINES.slice(0, 3) }))).toBe(true)
    expect(offersPrepaid(settled({ prepaid_hours_left: 0 }))).toBe(false)
    expect(offersPrepaid(settled({ prepaid_hours_left: null }))).toBe(false)
    expect(offersPrepaid(settled({}))).toBe(true)
    expect(offersPrepaid(settled({}, { lines: LINES.slice(0, 3) }))).toBe(false)
    expect(offersPrepaid(undefined)).toBe(false)
  })

  test('the band\'s words for a client set to always ask first', async () => {
    expect(lineAskText('Acme Roofing', 'unmatched', true)).toBe('Acme Roofing: which line does this work count toward? (Acme Roofing is set to always ask first)')
    expect(lineAskText('Acme Roofing', 'maybe_new_scope', true)).toBe('Acme Roofing: this doesn\'t match a line on the quote. (Acme Roofing is set to always ask first)')
    expect(lineAskText('Acme Roofing', 'unmatched', false)).toBe('Acme Roofing: which line does this work count toward?')
  })
})
