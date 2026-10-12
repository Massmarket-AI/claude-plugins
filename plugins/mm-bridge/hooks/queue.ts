// Pure queue logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// What pins (Rob, 2026-10-08): "for what shows up in the pins, we really just want to be talking about
// what's going on right now, nothing more than 3 days old." A client pins when one of these is true:
//   - an unanswered client message whose reply is due (24 business hours after it arrived) between
//     3 business days ago and 24 business hours from now
//   - a prepared reply package (drafts ready) less than 3 business days past its reply time
//   - a ticket with a date WE committed to, between 3 business days overdue and 24 business hours from now
//     (clients never set dates; SLA and phase dates are not promises and do not pin)
// Work that must start now at 1.5 h a day waits for real hour estimates (quote line items).
//
// Every client clock here counts business time (Rob, 2026-10-12: "the weekends don't count as days towards
// the 24-hour response time... We're only counting business days in our timelines for clients"): Saturday
// and Sunday, America/New_York, contribute zero. See ./business-time.ts.

import { businessDeadline, businessMsBetween } from './business-time'

export type FeedMail = {
  message_id_key: string
  received_at: string
  sender?: string
  subject?: string
  snippet?: string
  project_id: string | null
  project_name: string | null
  reply_status: string
  reply_due_at?: string
  project_owner_email?: string | null
}

export type FeedDraft = {
  package_id: string
  project_id: string
  project_name: string
  status: string
  covers_through?: string
  drafts_ready?: number
  flagged_for_rob?: boolean
  picked_up_by?: string | null
  project_owner_email?: string | null
}

export type FeedTicket = {
  ticket_id: string
  project_id: string
  project_name: string
  title: string
  due_at: string
  due_source?: string
  assignee_email?: string | null
}

/**
 * One of the caller's own Claude Code sessions that declared a client: the feed's `threads` field. The
 * session id is what `$.session.id()` answers in that thread. Absent on a server that does not send it yet.
 */
export type FeedThread = { project_id: string; session_id: string; last_activity_at: string }

export type Feed = {
  member: string
  role: string
  mail?: FeedMail[]
  drafts?: FeedDraft[]
  tickets?: { overdue?: FeedTicket[]; due_today?: FeedTicket[]; due_soon?: FeedTicket[] }
  threads?: FeedThread[]
}

export type QueueItem = {
  projectId: string
  projectName: string
  client: string
  dueAt: number
  kind: 'ready' | 'reply' | 'task'
  messages: number
  tasks: number
  packageId: string | null
  coversThrough: string | null
  flagged: boolean
  mail: Array<{ at: string; sender: string; subject: string; snippet: string }>
  taskTitles: string[]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Both windows are business time: 3 business days back, 24 business hours ahead. */
export const WINDOW_BACK_MS = 3 * DAY
export const WINDOW_AHEAD_MS = DAY
export const MAX_PINS = 8

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

/** The client's short name: the project name before " — ", " - " or " (". */
export function shortName(projectName: string): string {
  const cut = projectName.split(/\s+[—–-]\s+|\s+\(/)[0] ?? projectName
  const name = cut.trim() || projectName.trim()
  return name.length > 32 ? `${name.slice(0, 31)}…` : name
}

function isMine(owner: string | null | undefined, feed: Feed): boolean {
  if (owner) return owner.toLowerCase() === feed.member.toLowerCase()
  return feed.role === 'founder' // unowned clients are Rob's until someone owns them
}

/**
 * businessMsBetween(fromMs, toMs) <= limit, without walking the calendar when real time already settles it.
 * Business time never exceeds real time, so a stretch no longer than `limit` is within it. Each weekend
 * adds at most 49 real hours (a 25-hour Sunday when the clocks go back) and a stretch holding `limit` of
 * business time touches at most floor(limit / 5 days) + 1 weekends, so a longer stretch than that is not.
 * Only what lies in between is measured, which keeps a far-off date in the feed from costing a long walk.
 */
function businessWithin(fromMs: number, toMs: number, limit: number): boolean {
  const real = toMs - fromMs
  if (real <= limit) return true
  if (real > limit + (Math.floor(limit / (5 * DAY)) + 1) * (2 * DAY + HOUR)) return false
  return businessMsBetween(fromMs, toMs) <= limit
}

export function buildQueue(feed: Feed, now: number): QueueItem[] {
  // Overdue by up to 3 business days, or due within the next 24 business hours.
  const inWindow = (due: number): boolean =>
    Number.isFinite(due) && (due < now ? businessWithin(due, now, WINDOW_BACK_MS) : businessWithin(now, due, WINDOW_AHEAD_MS))
  const byProject = new Map<string, QueueItem>()
  const item = (projectId: string, projectName: string): QueueItem => {
    let it = byProject.get(projectId)
    if (!it) {
      it = {
        projectId, projectName, client: shortName(projectName), dueAt: Infinity, kind: 'task',
        messages: 0, tasks: 0, packageId: null, coversThrough: null, flagged: false, mail: [], taskTitles: [],
      }
      byProject.set(projectId, it)
    }
    return it
  }

  for (const m of feed.mail ?? []) {
    if (m.reply_status !== 'unanswered' || !m.project_id || !m.project_name) continue
    if (!isMine(m.project_owner_email, feed)) continue
    // The feed's reply time is trusted when it gives one; otherwise 24 business hours after the message arrived.
    const due = Number.isFinite(ms(m.reply_due_at)) ? ms(m.reply_due_at) : businessDeadline(ms(m.received_at), DAY)
    if (!inWindow(due)) continue
    const it = item(m.project_id, m.project_name)
    it.messages += 1
    it.dueAt = Math.min(it.dueAt, due)
    if (it.kind === 'task') it.kind = 'reply'
    it.mail.push({ at: m.received_at, sender: m.sender ?? '?', subject: m.subject ?? '', snippet: m.snippet ?? '' })
  }

  for (const d of feed.drafts ?? []) {
    if (d.status !== 'prepared' || (d.drafts_ready ?? 0) < 1) continue
    if (!isMine(d.project_owner_email, feed)) continue
    if (d.picked_up_by && d.picked_up_by.toLowerCase() !== feed.member.toLowerCase()) continue
    const due = Number.isFinite(ms(d.covers_through)) ? businessDeadline(ms(d.covers_through), DAY) : now
    if (due < now && !businessWithin(due, now, WINDOW_BACK_MS)) continue
    const it = item(d.project_id, d.project_name)
    it.kind = 'ready'
    it.packageId = d.package_id
    it.coversThrough = d.covers_through ?? null
    it.flagged = Boolean(d.flagged_for_rob)
    it.dueAt = Math.min(it.dueAt, due)
  }

  const t = feed.tickets ?? {}
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? []]) {
    for (const tk of k) {
      if (tk.due_source !== 'commitment') continue
      if ((tk.assignee_email ?? '').toLowerCase() !== feed.member.toLowerCase()) continue
      const due = ms(tk.due_at)
      if (!inWindow(due)) continue
      const it = item(tk.project_id, tk.project_name)
      it.tasks += 1
      it.dueAt = Math.min(it.dueAt, due)
      it.taskTitles.push(tk.title)
    }
  }

  return [...byProject.values()]
    .filter(i => Number.isFinite(i.dueAt))
    .sort((a, b) => a.dueAt - b.dueAt)
}

// ---------------------------------------------------------------- names

function etParts(t: number): { day: string; date: string; time: string } {
  try {
    const d = new Date(t)
    const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
      .format(d)
      .replace(':00', '')
    return { day, date, time }
  } catch {
    // No Intl time zones: Eastern daylight time, which covers the weeks this ships in.
    const d = new Date(t - 4 * HOUR)
    const h = d.getUTCHours()
    const mm = d.getUTCMinutes()
    const time = `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
    return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? '', date: d.toISOString().slice(0, 10), time }
  }
}

export function whenText(due: number, now: number): string {
  if (due < now) {
    const late = businessMsBetween(due, now) // weekends do not count toward how late
    return late < DAY ? `overdue ${Math.max(1, Math.round(late / HOUR))}h` : `overdue ${Math.round(late / DAY)}d`
  }
  const a = etParts(due)
  const today = etParts(now)
  const tomorrow = etParts(now + DAY)
  if (a.date === today.date) return `due ${a.time}`
  if (a.date === tomorrow.date) return `due tomorrow ${a.time}`
  return `due ${a.day} ${a.time}`
}

export function isRed(it: QueueItem, now: number): boolean {
  return it.dueAt < now || etParts(it.dueAt).date === etParts(now).date
}

/** The pinned thread's name: `🔴 Acme Legal · reply ready · due 7 PM · 3 new`. */
export function titleFor(it: QueueItem, now: number): string {
  const what = it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : 'task'
  const when = whenText(it.dueAt, now)
  const parts = [`${isRed(it, now) ? '🔴' : '🟡'} ${it.client}`, `${what} ${when}`.replace('reply due', 'reply due')]
  if (it.messages > 1) parts.push(`${it.messages} new`)
  if (it.flagged) parts.push('flagged')
  return parts.join(' · ')
}

export function clearedTitle(client: string, now: number): string {
  return `✓ ${client} · clear ${etParts(now).time}`
}

/** A session title names this client when, stripped of our marks, it starts with the client's name. */
export function titleNames(title: string, client: string): boolean {
  const bare = title.replace(/^[🔴🟡✓]\s*/u, '').replace(/^client:\s*/i, '').split(' · ')[0]?.trim().toLowerCase() ?? ''
  const c = client.toLowerCase().replace(/…$/, '')
  return bare.length > 0 && (bare === c || bare.startsWith(c) || (bare.length >= 6 && c.startsWith(bare)))
}

/** What a client's own thread shows when it has no prepared drafts: the messages waiting and the tasks due. */
export function clientMarkdown(it: QueueItem, now: number): string {
  const out = [`## ${it.projectName}`, `${titleFor(it, now)}`]
  if (it.mail.length) {
    out.push('', '### Waiting on our reply')
    for (const m of it.mail.sort((a, b) => a.at.localeCompare(b.at))) {
      out.push(`- **${m.sender}** · ${etParts(Date.parse(m.at)).day} ${etParts(Date.parse(m.at)).time} · ${m.subject}`)
      if (m.snippet) out.push(`  > ${m.snippet.replace(/\s+/g, ' ').slice(0, 220)}`)
    }
  }
  if (it.taskTitles.length) {
    out.push('', '### Due (dates we committed to)')
    for (const t of it.taskTitles) out.push(`- ${t}`)
  }
  out.push('', '_No reply drafts are prepared yet. Ask Claude: "Pick up the reply drafts for ' + it.client + '"._')
  return out.join('\n')
}
