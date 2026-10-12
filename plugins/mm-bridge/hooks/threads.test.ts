import { describe, expect, test } from 'claude-code/testing'

import { buildQueue } from './queue'
import type { Feed, FeedThread, QueueItem } from './queue'
import { LABEL, PANE_SENTENCE, autoLinkFor, clientThreads, dueText, kickoffText, paneText, recommend, rowButtons, rowDetail, rowFor, titleLooksLike, titleSuggestion, waitingText } from './threads'
import type { AppThread, ClientThread, Pairs } from './threads'

// Every client and address below is made up.

/** A New York wall time in October 2026 (daylight time, UTC-4) as an instant. */
const et = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-04:00`)
const at = (s: string) => new Date(et(s)).toISOString()
/** Monday 11 AM. */
const NOW = et('2026-10-12 11:00')

const ACME = '11111111-1111-1111-1111-111111111111'
const BOLT = '22222222-2222-2222-2222-222222222222'
const CEDAR = '33333333-3333-3333-3333-333333333333'
const ME = 'builder-a@example.com'
const PKG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const FEED: Feed = {
  member: ME,
  role: 'builder',
  drafts: [{ package_id: PKG, project_id: ACME, project_name: 'Acme Roofing — Pat', status: 'prepared', covers_through: at('2026-10-12 08:00'), drafts_ready: 2, project_owner_email: ME }],
  mail: ['2026-10-12 09:00', '2026-10-12 10:00'].map(received => ({
    message_id_key: received, received_at: at(received), sender: 'client@example.com', subject: 'Question', snippet: 'hello',
    project_id: BOLT, project_name: 'Bolt Staffing (Sam)', reply_status: 'unanswered', project_owner_email: ME,
  })),
  tickets: { due_today: [{ ticket_id: 't1', project_id: CEDAR, project_name: 'Cedar Dental', title: 'Send the intake form', due_at: at('2026-10-12 16:00'), due_source: 'commitment', assignee_email: ME }] },
}
const item = (projectId: string): QueueItem => {
  const it = buildQueue(FEED, NOW).find(i => i.projectId === projectId)
  if (!it) throw new Error(`no fixture item for ${projectId}`)
  return it
}

const app = (sessionId: string, title: string, lastActive: string | undefined, over: Partial<AppThread> = {}): AppThread => ({
  sessionId, title, ...(lastActive ? { lastActivityAt: at(lastActive) } : {}), ...over,
})
const liveOf = (...threads: AppThread[]) => new Map(threads.map(t => [t.sessionId, t] as const))
const pairsOf = (map: Record<string, string>): Pairs => Object.fromEntries(Object.entries(map).map(([cli, a]) => [cli, { app: a, at: NOW }]))
const declared = (projectId: string, sessionId: string, last: string): FeedThread => ({ project_id: projectId, session_id: sessionId, last_activity_at: at(last) })
const known = (sid: string, title: string, lastActive: string): ClientThread => ({ sid, title, lastAt: et(lastActive), source: 'linked' })

describe('R2: the recommendation on each row', () => {
  test('a thread active in the last 7 business days: Update thread, with the day it was last active', async () => {
    const rec = recommend([known('local_a', 'Roof quote', '2026-10-09 15:00')], undefined, NOW)
    expect(rec).toEqual({ action: 'update', reason: 'thread from Fri, Oct 9 exists', target: { sid: 'local_a', title: 'Roof quote', suggested: false } })
  })

  test('7 business days count across weekends: Thursday Oct 1 at 11 AM is still current on Monday Oct 12 at 11 AM', async () => {
    // Oct 1 (13 h) + Oct 2 (24 h) + Oct 5 to 9 (120 h) + Oct 12 (11 h) = 168 business hours = exactly 7 business days,
    // over 11 calendar days and two weekends.
    expect(recommend([known('local_a', 'Roof quote', '2026-10-01 11:00')], undefined, NOW)).toMatchObject({ action: 'update', reason: 'thread from Thu, Oct 1 exists' })
    // one minute older than that is past it
    expect(recommend([known('local_a', 'Roof quote', '2026-10-01 10:59')], undefined, NOW)).toEqual({
      action: 'start', reason: 'last thread is from Oct 1', target: { sid: 'local_a', title: 'Roof quote', suggested: false },
    })
    // counted in calendar days, Saturday Oct 3 would be 9 days back; in business time it is 5 days and 11 hours
    expect(recommend([known('local_a', 'Roof quote', '2026-10-03 11:00')], undefined, NOW)).toMatchObject({ action: 'update', reason: 'thread from Sat, Oct 3 exists' })
  })

  test('the newest known thread is older than that: Start thread, saying when the last one was', async () => {
    const rec = recommend([known('local_old', 'Roof quote', '2026-09-22 10:00'), known('local_older', 'First call', '2026-09-10 10:00')], undefined, NOW)
    expect(rec).toEqual({ action: 'start', reason: 'last thread is from Sep 22', target: { sid: 'local_old', title: 'Roof quote', suggested: false } })
  })

  test('of several threads the most recently active one is the one to update', async () => {
    const rec = recommend([known('local_a', 'Older', '2026-10-06 10:00'), known('local_b', 'Newer', '2026-10-09 10:00')], undefined, NOW)
    expect(rec.target?.sid).toBe('local_b')
    expect(rec.reason).toBe('thread from Fri, Oct 9 exists')
  })

  test('no thread of any kind: Start thread, no thread yet, and nothing for Update to act on', async () => {
    expect(recommend([], undefined, NOW)).toEqual({ action: 'start', reason: 'no thread yet' })
  })

  test('only a title looks like the client: Update thread as a suggestion, quoting the title', async () => {
    const suggestion = titleSuggestion('Bolt Staffing', {}, liveOf(app('local_t', 'Bolt Staffing: invoice question', '2026-08-03 10:00')))
    expect(recommend([], suggestion, NOW)).toEqual({
      action: 'update', reason: '"Bolt Staffing: invoice question" looks like this client', target: { sid: 'local_t', title: 'Bolt Staffing: invoice question', suggested: true },
    })
  })

  test('a known thread, however old, comes before a title that merely looks right', async () => {
    const suggestion = { sid: 'local_t', title: 'Acme Roofing notes', suggested: true }
    expect(recommend([known('local_old', 'Roof quote', '2026-09-22 10:00')], suggestion, NOW)).toMatchObject({ action: 'start', reason: 'last thread is from Sep 22', target: { sid: 'local_old' } })
  })
})

describe('R1: which threads are a client\'s', () => {
  const live = liveOf(
    app('local_a', 'Roof quote', '2026-10-09 15:00'),
    app('local_b', 'Follow-up on the estimate', '2026-10-08 10:00'),
    app('local_gone', 'Archived one', '2026-10-10 10:00', { isArchived: true }),
    app('local_t', 'Acme Roofing: invoice question', '2026-10-10 12:00'),
  )
  const pairs = pairsOf({ 'cli-a': 'local_a', 'cli-b': 'local_b', 'cli-gone': 'local_gone' })
  const threads = [declared(ACME, 'cli-gone', '2026-10-10 10:00'), declared(ACME, 'cli-a', '2026-10-09 15:00'), declared(ACME, 'cli-b', '2026-10-08 10:00'), declared(ACME, 'cli-elsewhere', '2026-10-11 10:00')]

  test('a thread whose Claude Code session declared the client links itself: the most recently active one that is open here', async () => {
    // cli-elsewhere ran on another computer (no pair) and cli-gone's thread is archived
    expect(autoLinkFor(ACME, {}, threads, pairs, live)).toBe('local_a')
    expect(clientThreads(ACME, { [ACME]: 'local_a' }, threads, pairs, live).map(t => [t.sid, t.source])).toEqual([['local_a', 'linked'], ['local_b', 'matched']])
  })

  test('a title that looks like the client never links by itself; it is only a suggestion', async () => {
    expect(autoLinkFor(ACME, {}, [], pairs, live)).toBeUndefined()
    expect(clientThreads(ACME, {}, [], pairs, live)).toEqual([])
    expect(titleSuggestion('Acme Roofing', {}, live)).toEqual({ sid: 'local_t', title: 'Acme Roofing: invoice question', suggested: true })
  })

  test('a client that already has a thread keeps it, and a thread already another client\'s is not taken', async () => {
    expect(autoLinkFor(ACME, { [ACME]: 'local_b' }, threads, pairs, live)).toBeUndefined()
    expect(autoLinkFor(ACME, { [BOLT]: 'local_a' }, threads, pairs, live)).toBe('local_b')
  })

  test('a thread the person unlinked never links itself again, to any client', async () => {
    expect(autoLinkFor(ACME, {}, threads, pairs, live, { local_a: NOW })).toBe('local_b')
    expect(autoLinkFor(ACME, {}, threads, pairs, live, { local_a: NOW, local_b: NOW })).toBeUndefined()
    // it is still one of the client's threads, so the row can offer Update on it
    expect(clientThreads(ACME, {}, threads, pairs, live).map(t => t.sid)).toEqual(['local_a', 'local_b'])
  })

  test('a feed with no threads field links nothing by itself', async () => {
    expect(autoLinkFor(ACME, {}, [], pairs, live)).toBeUndefined()
  })

  test('last activity is the app\'s own for the thread; the feed\'s time stands in when the app gives none', async () => {
    const only = liveOf(app('local_a', 'Roof quote', '2026-10-12 09:00'), app('local_b', 'No time from the app', undefined))
    const got = clientThreads(ACME, {}, [declared(ACME, 'cli-a', '2026-09-20 10:00'), declared(ACME, 'cli-b', '2026-10-07 10:00')], pairs, only)
    expect(got.map(t => [t.sid, t.lastAt])).toEqual([['local_a', et('2026-10-12 09:00')], ['local_b', et('2026-10-07 10:00')]])
  })

  test('what counts as looking like the client', async () => {
    expect(titleLooksLike('client:acme-roofing', 'Acme Roofing')).toBe(true)
    expect(titleLooksLike('Acme Roofing: invoice question', 'Acme Roofing')).toBe(true)
    expect(titleLooksLike('🔴 Acme Roofing · reply overdue 6h', 'Acme Roofing')).toBe(true)
    expect(titleLooksLike('client:bolt-staffing', 'Acme Roofing')).toBe(false)
    expect(titleLooksLike('Recruiter proposal for Acme Roofing', 'Acme Roofing')).toBe(false)
    // a thread linked to some client is nobody's suggestion
    expect(titleSuggestion('Acme Roofing', { [BOLT]: 'local_t' }, live)).toBeUndefined()
  })
})

describe('R5: the kickoff message', () => {
  test('a prepared package', async () => {
    expect(kickoffText(item(ACME))).toBe(
      `[mm-link ${ACME}] Pick up the reply drafts for Acme Roofing — Pat (OW project ${ACME}). Load the client's project skill first, then follow client-reply-prep §9: show the five-part pickup view for package aaaaaaaa and wait for me. Send nothing without my go.`,
    )
  })

  test('client messages waiting and no package yet', async () => {
    expect(kickoffText(item(BOLT))).toBe(
      `[mm-link ${BOLT}] Bolt Staffing (Sam) (OW project ${BOLT}) needs a reply: 2 client message(s) waiting, reply due Tue, Oct 13 9 AM ET. Load the client's project skill first, then follow client-reply-prep §9: no package exists yet, so run prep first, then show the five-part pickup view and wait for me. Send nothing without my go.`,
    )
  })

  test('committed tasks only', async () => {
    expect(kickoffText(item(CEDAR))).toBe(
      `[mm-link ${CEDAR}] Cedar Dental (OW project ${CEDAR}) has 1 committed task(s) due Mon, Oct 12 4 PM ET. Load the client's project skill first, then show me what is due and wait for me. Send nothing without my go.`,
    )
  })

  test('Update puts what is new on the first line, and the kickoff follows unchanged', async () => {
    expect(kickoffText(item(BOLT), { update: true })).toBe(`New since this thread last worked on this client: 2 messages waiting.\n${kickoffText(item(BOLT))}`)
    expect(kickoffText(item(ACME), { update: true }).split('\n')[0]).toBe('New since this thread last worked on this client: drafts ready.')
    expect(kickoffText(item(CEDAR), { update: true }).split('\n')[0]).toBe('New since this thread last worked on this client: 1 task due.')
  })

  test('the thread a message lands in links itself: the tag is the one the prompt hook reads', async () => {
    for (const id of [ACME, BOLT, CEDAR]) expect(/\[mm-link ([0-9a-f-]{36})\]/.exec(kickoffText(item(id), { update: true }))?.[1]).toBe(id)
  })

  test('due times read in New York, with the date', async () => {
    expect(dueText(et('2026-10-13 09:00'))).toBe('Tue, Oct 13 9 AM ET')
    expect(dueText(et('2026-10-12 23:59'))).toBe('Mon, Oct 12 11:59 PM ET')
  })
})

describe('R3 and R8: the rows of the Needs-you pane', () => {
  const update = rowFor(item(ACME), recommend([known('local_a', 'Roof quote', '2026-10-09 15:00')], undefined, NOW), NOW)
  const start = rowFor(item(CEDAR), recommend([], undefined, NOW), NOW)
  const stale = rowFor(item(CEDAR), recommend([known('local_old', 'Intake', '2026-09-22 10:00')], undefined, NOW), NOW)
  const suggested = rowFor(item(BOLT), recommend([], { sid: 'local_t', title: 'Bolt Staffing: invoice question', suggested: true }, NOW), NOW)

  test('the recommended action first, the other one second, then Drafts', async () => {
    expect(rowButtons(update).map(b => LABEL[b])).toEqual(['Update thread', 'Start thread', 'Drafts'])
    expect(rowButtons(stale).map(b => LABEL[b])).toEqual(['Start thread', 'Update thread', 'Drafts'])
    expect(rowButtons(suggested).map(b => LABEL[b])).toEqual(['Update thread', 'Start thread', 'Drafts'])
  })

  test('a client with no thread at all has no Update button: there is nothing to update', async () => {
    expect(rowButtons(start).map(b => LABEL[b])).toEqual(['Start thread', 'Drafts'])
  })

  test('what is waiting, as the row shows it', async () => {
    expect([waitingText(item(ACME)), waitingText(item(BOLT)), waitingText(item(CEDAR))]).toEqual(['drafts ready', '2 messages waiting', '1 task due'])
    expect(rowDetail(update)).toBe('drafts ready · Update thread: thread from Fri, Oct 9 exists')
  })

  test('the pane for one Update row, one Start row and one title suggestion', async () => {
    const text = paneText([start, update, suggested], 'Needs you now (3)', `Updated 15:00 UTC for ${ME}. ${PANE_SENTENCE}`)
    expect(text).toBe(
      [
        'Needs you now (3)',
        '',
        '1. 🔴 Cedar Dental · task due 4 PM',
        '   1 task due · Start thread: no thread yet',
        '   [ Start thread ] [ Drafts ]',
        '',
        '2. 🟡 Acme Roofing · reply ready due tomorrow 8 AM',
        '   drafts ready · Update thread: thread from Fri, Oct 9 exists',
        '   [ Update thread ] [ Start thread ] [ Drafts ]',
        '',
        '3. 🟡 Bolt Staffing · reply due tomorrow 9 AM · 2 new',
        '   2 messages waiting · Update thread: "Bolt Staffing: invoice question" looks like this client',
        '   [ Update thread ] [ Start thread ] [ Drafts ]',
        '',
        'Updated 15:00 UTC for builder-a@example.com. Pins: overdue by up to 3 business days, or due within the next 24 business hours. Weekends do not count. Threads for these clients link themselves; use Update or Start on a row to pick one up.',
      ].join('\n'),
    )
  })
})
