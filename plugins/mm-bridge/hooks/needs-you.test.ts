// (0.7.81, Rob 2026-11-25: "The need view is basically supposed to show them and help them confirm that they have everything pinned
// they're supposed to have pinned. It's also supposed to mirror the things that show up under each of their names on the team view.")
// Needs you lists exactly the clients the pin report says should be pinned; the rest of the dated list is one Coming up line.
// Pure functions over made-up items; every client is made up.

import { describe, expect, test } from 'claude-code/testing'
import type { QueueItem } from './queue'
import { COMING_UP_MAX, comingUpText, needsYouSet } from './you'

// Wednesday 2026-11-25, 11:40 AM in New York
const NOW = Date.parse('2026-11-25T16:40:00Z')
const H = 3600_000
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// Wednesday 5 PM and Friday 5 PM in New York
const WED_5PM = Date.parse('2026-11-25T22:00:00Z')
const FRI_5PM = Date.parse('2026-11-27T22:00:00Z')

/** An item as the sync builds one, with nothing on it but what a test sets. */
const item = (n: number, over: Partial<QueueItem> & { client: string }): QueueItem => ({
  projectId: P(n),
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
/** A dated task of the person's own, due at `at`. */
const task = (n: number, client: string, at: number): QueueItem => item(n, { client, dueAt: at, actBy: at, own: at, tasks: 1, taskTitles: ['Do the thing'] })

const today = task(1, 'Acme Roofing', WED_5PM)
const friday = task(2, 'Bolt Staffing', FRI_5PM)
const waitsOnRun = task(3, 'Cedar Dental', WED_5PM)
const undated = item(4, { client: 'Dune Legal', undatedTasks: 2 })

describe('0.7.81: Needs you is the pin report', () => {
  test("with a report: exactly the report's clients, whatever their dates say", () => {
    // the report held Cedar Dental off for its scheduled run, so it is not one that should be pinned
    const set = needsYouSet([today, friday, waitsOnRun, undated], { [P(1)]: { pinned: true } }, NOW)
    expect([...set]).toEqual([P(1)])
  })

  test('a report with nothing to pin: nothing needs you', () => {
    expect(needsYouSet([today, friday], {}, NOW).size).toBe(0)
  })

  test("a client in the report but not on the person's own list is not drawn as theirs", () => {
    expect([...needsYouSet([friday], { [P(9)]: { pinned: false, why: 'no_thread' } }, NOW)]).toEqual([])
  })

  test("no report (an older version's record): R1's own test, within the next 24 business hours", () => {
    const set = needsYouSet([today, friday, undated], undefined, NOW)
    expect(set.has(P(1))).toBe(true)
    expect(set.has(P(2))).toBe(false)
    expect(set.has(P(4))).toBe(false)
  })
})

describe('0.7.81: the Coming up line', () => {
  test('the dated clients that do not pin, soonest first; a held one says its run, as its thread name does', () => {
    const text = comingUpText([friday, today, waitsOnRun, undated], new Set([P(1)]), { [P(3)]: 'waits on a run 4:15 PM' }, NOW)
    expect(text).toBe('Coming up, not pinned yet: Cedar Dental · waits on a run 4:15 PM; Bolt Staffing · due Fri 5 PM')
  })

  test('a client with nothing dated (a message with no reply due) is last, with no due date', () => {
    const quiet = item(6, { client: 'Elm Clinic', kind: 'reply', messages: 1 })
    expect(comingUpText([quiet, friday], new Set(), undefined, NOW)).toBe('Coming up, not pinned yet: Bolt Staffing · due Fri 5 PM; Elm Clinic · no due date')
  })

  test('nothing left over: no line', () => {
    expect(comingUpText([today, undated], new Set([P(1)]), undefined, NOW)).toBe('')
  })

  test('the internal queue is never on it', () => {
    const queue = item(5, { client: 'Massmarket AI', kind: 'queue', dueAt: FRI_5PM })
    expect(comingUpText([queue], new Set(), undefined, NOW)).toBe('')
  })

  test(`past ${COMING_UP_MAX} clients: the rest as a count`, () => {
    const many = Array.from({ length: COMING_UP_MAX + 2 }, (_, i) => task(10 + i, `Client ${String.fromCharCode(65 + i)}`, FRI_5PM + i * H))
    const text = comingUpText(many, new Set(), undefined, NOW)
    expect(text.endsWith(' (+2 more)')).toBe(true)
    expect(text.split('; ').length).toBe(COMING_UP_MAX)
  })
})
