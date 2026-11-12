import { describe, expect, test } from 'claude-code/testing'

import { ASK_HEADING, BROWSER_HEADING, PROFILE_TIP, askText, blockLineText, confirmHeading, confirmText, parseBrowserNow, rowLineText, savedText, withoutAnswered } from './browser'

// (0.7.53, Rob approved 2026-11-11: "You're good to go on all those recommendations") Working manually in browser: OW's answer as the
// bridge keeps it, and every word the pane draws for it. Every client, site and person below is made up.

const NOW = Date.parse('2026-11-11T19:00:00Z')
const MIN = 60_000
const iso = (ms: number) => new Date(ms).toISOString()
const ACME = '11111111-1111-4111-8111-111111111111'
const BOLT = '22222222-2222-4222-8222-222222222222'
const Q1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const Q2 = 'aaaaaaaa-0000-4000-8000-000000000002'

const line = (over: Record<string, unknown> = {}) => ({
  member_email: 'builder-a@example.com', project_id: ACME, client: 'Acme Roofing — Pat', site: 'app.gohighlevel.com', title: 'Workflows',
  last_at: iso(NOW - 2 * MIN), minutes: 9, no_thread: true, confidence: 'high', member: null, me: true, ...over,
})
const ask = (over: Record<string, unknown> = {}) => ({
  id: Q1, stretch_start: iso(NOW - 25 * MIN), stretch_end: iso(NOW - 5 * MIN), minutes: 14, site: 'plumber.example', title: 'Plumber admin',
  choices: [{ project_id: ACME, client: 'Acme Roofing — Pat' }, { project_id: BOLT, client: 'Bolt Staffing (Sam)' }], ...over,
})
const answer = (over: Record<string, unknown> = {}) => ({
  ok: true, as_of: iso(NOW), viewer: { email: 'builder-a@example.com', founder: false }, lines: [line()], question: ask(), confirm: [], questions: 'on', ...over,
})

describe('0.7.53: OW\'s browser-now answer, as the bridge keeps it', () => {
  test('a line, the question and its choices: the short client name, the site, the title, the times', async () => {
    const read = parseBrowserNow(answer())
    expect(read?.founder).toBe(false)
    expect(read?.lines).toEqual([
      { projectId: ACME, client: 'Acme Roofing', site: 'app.gohighlevel.com', title: 'Workflows', lastAt: NOW - 2 * MIN, minutes: 9, noThread: true, member: null, me: true },
    ])
    expect(read?.question).toEqual({
      id: Q1, from: NOW - 25 * MIN, to: NOW - 5 * MIN, minutes: 14, site: 'plumber.example', title: 'Plumber admin',
      choices: [{ projectId: ACME, client: 'Acme Roofing' }, { projectId: BOLT, client: 'Bolt Staffing' }],
    })
    expect(read?.confirm).toEqual([])
  })

  test('not an answer: nothing kept', async () => {
    for (const raw of [null, 'x', [], {}, { ok: false, lines: [] }, { ok: true }, { ok: true, lines: 'no' }]) expect(parseBrowserNow(raw)).toBeNull()
  })

  test('a line with no project, client, site or time is dropped; a site that is not a host is dropped; a long title is cut', async () => {
    const read = parseBrowserNow(
      answer({
        lines: [
          line({ project_id: 'nope' }),
          line({ client: '' }),
          line({ site: 'https://evil.example/path?q=1' }),
          line({ last_at: 'yesterday' }),
          line({ title: `a‮bc​\n${'x'.repeat(200)}` }),
        ],
      }),
    )
    expect(read?.lines.length).toBe(1)
    const kept = read?.lines[0]
    expect(kept?.title.length).toBe(80)
    expect(kept?.title.startsWith('a bc x')).toBe(true)
    expect(kept?.title.endsWith('…')).toBe(true)
  })

  test('⛔ never a question in the founder\'s pane, whatever OW said; a teammate\'s name only in the founder\'s view, never on their own line', async () => {
    const founder = parseBrowserNow(answer({ viewer: { email: 'x@example.com', founder: true }, lines: [line({ member: 'Asif', me: false }), line({ member: 'Rob', me: true })], confirm: [ask({ id: Q2 })] }))
    expect(founder?.question).toBeNull()
    expect(founder?.confirm).toEqual([])
    expect(founder?.lines.map(l => l.member)).toEqual(['Asif', null])
    // a teammate's pane names nobody, even if OW sent a name
    const mate = parseBrowserNow(answer({ lines: [line({ member: 'Asif', me: false })] }))
    expect(mate?.lines[0]?.member).toBeNull()
  })

  test('a question with a bad id, no site or no times is dropped; choices past 3, repeated or with a bad id are dropped', async () => {
    expect(parseBrowserNow(answer({ question: ask({ id: 'x' }) }))?.question).toBeNull()
    expect(parseBrowserNow(answer({ question: ask({ site: '' }) }))?.question).toBeNull()
    expect(parseBrowserNow(answer({ question: ask({ stretch_end: null }) }))?.question).toBeNull()
    const many = [
      { project_id: ACME, client: 'A' },
      { project_id: ACME, client: 'A again' },
      { project_id: 'bad', client: 'B' },
      { project_id: BOLT, client: 'Bolt' },
      { project_id: '33333333-3333-4333-8333-333333333333', client: 'Past three' },
    ]
    expect(parseBrowserNow(answer({ question: ask({ choices: many }) }))?.question?.choices).toEqual([{ projectId: ACME, client: 'A' }])
  })

  test('the end-of-day list leaves the open question out, and a question answered here leaves the pane at once', async () => {
    const read = parseBrowserNow(answer({ confirm: [ask(), ask({ id: Q2, title: 'Second' })] }))
    expect(read?.confirm.map(q => q.id)).toEqual([Q2])
    const after = read && withoutAnswered(read, new Set([Q1]))
    expect(after?.question).toBeNull()
    expect(after?.confirm.map(q => q.id)).toEqual([Q2])
    expect(read && withoutAnswered(read, new Set([Q2]))?.confirm).toEqual([])
  })
})

describe('0.7.53: the words the pane draws', () => {
  const read = parseBrowserNow(answer({ lines: [line(), line({ no_thread: false, title: '' })] }))
  const [noThread, covered] = read?.lines ?? []

  test('beside the client\'s row, and in the block that names the client', async () => {
    expect(BROWSER_HEADING).toBe('Working manually in browser')
    expect(noThread && rowLineText(noThread)).toBe('Working manually in browser · app.gohighlevel.com · Workflows · no thread')
    expect(covered && rowLineText(covered)).toBe('Working manually in browser · app.gohighlevel.com')
    expect(noThread && blockLineText(noThread)).toBe('Acme Roofing · app.gohighlevel.com · Workflows · no thread')
  })

  test('the founder\'s view of a teammate starts with their name', async () => {
    const f = parseBrowserNow(answer({ viewer: { email: 'x@example.com', founder: true }, lines: [line({ member: 'Asif', me: false })] }))
    const l = f?.lines[0]
    expect(l && rowLineText(l)).toBe('Asif working manually in browser · app.gohighlevel.com · Workflows · no thread')
    expect(l && blockLineText(l)).toBe('Asif · Acme Roofing · app.gohighlevel.com · Workflows · no thread')
  })

  test('the question, the end-of-day list and what a press saved', async () => {
    const q = read?.question
    expect(ASK_HEADING).toBe('Needs a client')
    expect(q && askText(q)).toBe('14m in the browser · plumber.example · Plumber admin')
    expect(q && askText({ ...q, minutes: 75 })).toBe('1h 15m in the browser · plumber.example · Plumber admin')
    expect(q && confirmText(q, t => (t === NOW - 25 * MIN ? '1:35 PM' : '1:55 PM'))).toBe('1:35 PM to 1:55 PM · 14m · plumber.example · Plumber admin')
    expect(confirmHeading(2)).toBe('To confirm today (2)')
    expect(savedText('Acme Roofing', false, 'plumber.example')).toBe('Saved: Acme Roofing.')
    expect(savedText('Internal', true, 'plumber.example')).toBe("Saved: Internal. It won't ask about plumber.example again.")
    expect(PROFILE_TIP).toBe('Tip: a separate Chrome profile for personal browsing keeps it out of the tracker.')
  })

  test('no word of it holds a URL: the site is a host alone', async () => {
    const all = JSON.stringify(parseBrowserNow(answer({ lines: [line({ site: 'app.gohighlevel.com/v2/location/abc' })] })))
    expect(all.includes('/v2/location')).toBe(false)
  })
})
