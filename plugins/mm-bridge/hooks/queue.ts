// Pure queue logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// What pins (Rob, 2026-10-08): "for what shows up in the pins, we really just want to be talking about
// what's going on right now, nothing more than 3 days old." A client pins when one of these is true:
//   - an unanswered client message whose reply is due (24 business hours after it arrived) between
//     3 business days ago and 24 business hours from now
//   - a prepared reply package (drafts ready) less than 3 business days past its reply time
//   - a reply package the viewer picked up, with a draft not sent, pins like a prepared one
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
  /** Drafts not sent yet (ready, edited, sending, failed). Absent on a server that does not send it yet. */
  drafts_unsent?: number
  flagged_for_rob?: boolean
  picked_up_by?: string | null
  picked_up_at?: string | null
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

/**
 * The client's open reply package when it is not simply "ready for you" (Rob, 2026-10-12: a thread that
 * held the drafts was told none were prepared).
 *   held_by_me     the viewer picked it up and a draft is not sent yet
 *   held_by_other  a teammate picked it up; `by` is their name
 *   stale          drafts exist but are marked out of date, and nobody holds it
 *   prepared       drafts are ready, but the client does not pin for the viewer on them (another owner's
 *                  client, or a package older than the window)
 * `unsent` is the drafts not sent on a held package, the drafts ready otherwise. `newer` is the client
 * messages that arrived after a package the viewer holds was written.
 */
export type OpenPackage = {
  id: string
  state: 'held_by_me' | 'held_by_other' | 'stale' | 'prepared'
  by: string
  at: string | null
  unsent: number
  newer: number
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
  open: OpenPackage | null
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

// ---------------------------------------------------------------- feed text is data
// A project's name and id come from the feed, and a thread's title from the app. Both end up in places
// Claude reads (a kickoff, a tool result, a thread's name), so neither is ever passed on as written.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A lower-case uuid: the only shape of project id (or package id) the bridge acts on. */
export const isUuid = (id: unknown): id is string => typeof id === 'string' && UUID.test(id)

/**
 * Text kept to letters, digits, spaces and . , & ' ( ) / - : every other character (a line break, a
 * bracket, a quote, a symbol) becomes a space, runs of spaces collapse, and it is cut at `max`.
 */
export function cleanText(text: unknown, max: number): string {
  const kept = (typeof text === 'string' ? text : '').normalize('NFC').replace(/[^\p{L}\p{N} .,&'()/-]/gu, ' ')
  return kept.replace(/ +/g, ' ').trim().slice(0, max).trim()
}
/** A client or project name, as it may go into a kickoff, a result, a thread title or a tool argument. */
export const cleanName = (name: unknown): string => cleanText(name, 80)
/** A thread's title, as it may be shown in a sentence. */
export const cleanTitle = (title: unknown): string => cleanText(title, 60)

/** A teammate's name as it may be shown or passed on: the part of their address before the @, cleaned. */
export function holderName(address: unknown): string {
  const local = (typeof address === 'string' ? address : '').split('@')[0] ?? ''
  const name = cleanText(local.replace(/[._-]+/g, ' '), 40).replace(/(^|\s)\p{L}/gu, c => c.toUpperCase())
  return name || 'a teammate'
}

/** The client's short name: the project name before " — ", " - " or " (", cleaned. */
export function shortName(projectName: string): string {
  const cut = projectName.split(/\s+[—–-]\s+|\s+\(/)[0] ?? projectName
  const name = cleanName(cut) || cleanName(projectName)
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
  // ⛔ A row whose project id is not a lower-case uuid, or whose name has nothing left once cleaned, is
  // dropped: the id goes into the [mm-link] marker and the name into the kickoff, both read by Claude.
  const usable = (projectId: unknown, projectName: unknown): boolean => isUuid(projectId) && cleanName(projectName) !== ''
  const item = (projectId: string, projectName: string): QueueItem => {
    let it = byProject.get(projectId)
    if (!it) {
      it = {
        projectId, projectName: cleanName(projectName), client: shortName(projectName), dueAt: Infinity, kind: 'task',
        messages: 0, tasks: 0, packageId: null, coversThrough: null, flagged: false, mail: [], taskTitles: [], open: null,
      }
      byProject.set(projectId, it)
    }
    return it
  }

  for (const m of feed.mail ?? []) {
    if (m.reply_status !== 'unanswered' || !m.project_id || !m.project_name) continue
    if (!usable(m.project_id, m.project_name)) continue
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

  const me = feed.member.toLowerCase()
  for (const d of feed.drafts ?? []) {
    // the package id goes into the kickoff and the pickup request: a lower-case uuid or nothing
    if (!usable(d.project_id, d.project_name) || !isUuid(d.package_id)) continue
    const holder = (d.picked_up_by ?? '').toLowerCase()
    const held = d.status === 'picked_up'
    const ready = d.drafts_ready ?? 0
    const unsent = d.drafts_unsent ?? ready
    // What counts: a held package with a draft not sent, or a prepared or stale one with a draft ready.
    if (held ? unsent < 1 || holder === '' : (d.status !== 'prepared' && d.status !== 'stale') || ready < 1) continue
    const heldByMe = held && holder === me
    const it = item(d.project_id, d.project_name)
    const due = Number.isFinite(ms(d.covers_through)) ? businessDeadline(ms(d.covers_through), DAY) : now
    const inReach = !(due < now && !businessWithin(due, now, WINDOW_BACK_MS))
    const open = (state: OpenPackage['state']): OpenPackage => ({
      id: d.package_id, state, by: state === 'held_by_other' ? holderName(holder) : '', at: held ? d.picked_up_at ?? null : null,
      unsent: held ? unsent : ready, newer: 0,
    })
    // A package the viewer holds is theirs to finish whoever owns the client. A prepared one is theirs when the client is.
    const readyForMe = d.status === 'prepared' && (holder === '' || holder === me) && isMine(d.project_owner_email, feed) && inReach
    if (heldByMe || readyForMe) {
      it.kind = 'ready'
      it.packageId = d.package_id
      it.coversThrough = d.covers_through ?? null
      it.flagged = Boolean(d.flagged_for_rob)
      if (inReach) it.dueAt = Math.min(it.dueAt, due)
      it.open = heldByMe ? open('held_by_me') : null
      continue
    }
    // Any other open package never pins by itself: it only changes what the client's row, pane and note say.
    if (it.packageId) continue
    it.open = open(held ? 'held_by_other' : d.status === 'stale' ? 'stale' : 'prepared')
  }

  const t = feed.tickets ?? {}
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? []]) {
    for (const tk of k) {
      if (tk.due_source !== 'commitment') continue
      if (!usable(tk.project_id, tk.project_name)) continue
      if ((tk.assignee_email ?? '').toLowerCase() !== feed.member.toLowerCase()) continue
      const due = ms(tk.due_at)
      if (!inWindow(due)) continue
      const it = item(tk.project_id, tk.project_name)
      it.tasks += 1
      it.dueAt = Math.min(it.dueAt, due)
      it.taskTitles.push(tk.title)
    }
  }

  // How many client messages arrived after the drafts of a package the viewer holds were written.
  for (const it of byProject.values()) {
    const through = ms(it.coversThrough)
    if (it.open?.state !== 'held_by_me' || !Number.isFinite(through)) continue
    it.open.newer = (feed.mail ?? []).filter(m => m.project_id === it.projectId && m.reply_status === 'unanswered' && ms(m.received_at) > through).length
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
  const what = it.open?.state === 'held_by_me' ? 'your draft' : it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : 'task'
  const when = whenText(it.dueAt, now)
  const parts = [`${isRed(it, now) ? '🔴' : '🟡'} ${it.client}`, `${what} ${when}`.replace('reply due', 'reply due')]
  if (it.messages > 1) parts.push(`${it.messages} new`)
  if (it.open?.state === 'held_by_other') parts.push(`with ${it.open.by}`)
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

const pickedAt = (at: string | null): string => {
  const t = ms(at)
  return Number.isFinite(t) ? ` (${etParts(t).day} ${etParts(t).time})` : ''
}
const draftCount = (n: number): string => `${n} draft${n === 1 ? '' : 's'}`

/** The last line of a client's pane when the pickup view is not shown: what is true of its reply drafts. */
export function draftsLine(it: QueueItem): string {
  const ask = (verb: string) => `Ask Claude: "${verb} the reply drafts for ${it.client}"`
  const o = it.open ?? null
  if (o?.state === 'held_by_me') return `_You picked up the reply drafts for this client: ${draftCount(o.unsent)} not sent yet. ${ask('Show me')}._`
  if (it.packageId) return `_Reply drafts are prepared for this client, but the pickup view could not be loaded here. ${ask('Show me')}._`
  if (o?.state === 'held_by_other') return `_${o.by} picked up the reply drafts for this client${pickedAt(o.at)} and has ${draftCount(o.unsent)} not sent yet. Ask ${o.by} before writing a second reply._`
  if (o?.state === 'stale') return `_Reply drafts exist for this client but are marked out of date. ${ask('Pick up')} and it will rebuild them first._`
  if (o?.state === 'prepared') return `_Reply drafts are prepared for this client. ${ask('Pick up')}._`
  return `_No reply drafts are prepared yet. ${ask('Pick up')}._`
}

/** One line above the pickup view when the viewer holds the package: that they hold it, what is unsent, what arrived since. */
export function holdBanner(it: QueueItem): string {
  const o = it.open ?? null
  if (o?.state !== 'held_by_me') return ''
  const newer = o.newer > 0 ? ` ${o.newer} client message${o.newer === 1 ? '' : 's'} arrived after ${o.unsent === 1 ? 'it was' : 'they were'} written.` : ''
  return `> **You picked this up**${pickedAt(o.at)}. ${draftCount(o.unsent)} not sent yet.${newer}`
}

/** What the bridge's note tells Claude about a client's reply drafts and what is waiting. `member` is the viewer's address. */
export function noteText(it: QueueItem, member: string): string {
  const waiting = `${it.messages} client message${it.messages === 1 ? '' : 's'} waiting on our reply and ${it.tasks} committed task${it.tasks === 1 ? '' : 's'} due`
  const o = it.open ?? null
  if (o?.state === 'held_by_me' && it.packageId) {
    const newer = o.newer > 0
      ? ` ${o.newer} client message${o.newer === 1 ? '' : 's'} arrived after ${o.unsent === 1 ? 'that draft was' : 'those drafts were'} written: read the package again and revise the open draft, never write a second email.`
      : ''
    return `Reply package ${it.packageId.slice(0, 8)} is already picked up by ${holderName(member)}, the person in this session, with ${draftCount(o.unsent)} not sent yet${it.flagged ? ', flagged for approval' : ''}; the five-part pickup view is in the side pane.${newer} The drafts are being worked in the thread that picked them up: to act on them, follow client-reply-prep §9 with --package ${it.packageId}.`
  }
  if (it.packageId) return `Reply package ${it.packageId.slice(0, 8)} is prepared${it.flagged ? ' and flagged for approval' : ''}; the five-part pickup view is in the side pane. When the person asks to act on it, follow client-reply-prep §9 with --package ${it.packageId}.`
  if (o?.state === 'held_by_other') return `${waiting}; ${o.by} picked up the reply drafts for this client (package ${o.id.slice(0, 8)}) and has ${draftCount(o.unsent)} not sent yet. Do not write a second reply: ask ${o.by}.`
  if (o?.state === 'stale') return `${waiting}; reply drafts exist (package ${o.id.slice(0, 8)}) but are marked out of date. When the person asks for the reply, pick the package up and rebuild the drafts first (client-reply-prep §9 with --package ${o.id}).`
  if (o?.state === 'prepared') return `${waiting}; reply drafts are prepared for this client (package ${o.id.slice(0, 8)}). When the person asks to act on them, follow client-reply-prep §9 with --package ${o.id}.`
  return `${waiting}; no reply drafts are prepared yet.`
}

/** What a client's thread shows when the pickup view is not shown: the messages waiting, the tasks due, and what is true of its reply drafts. */
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
  out.push('', draftsLine(it))
  return out.join('\n')
}
