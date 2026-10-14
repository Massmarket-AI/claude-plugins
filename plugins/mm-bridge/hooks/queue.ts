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
//   - for the founder alone: a reply package flagged for his OK, whoever owns the client (kind `ok`); one a
//     teammate sends only once its reply is due (0.5.1, R2: until then it is theirs to decide)
// Work that must start now at 1.5 h a day waits for real hour estimates (quote line items).
//
// Two more lists are built beside that one (buildLists), and neither pins or is counted: clients whose
// reply drafts a teammate holds (not the viewer's to act on), and clients whose only items are more than
// 3 business days overdue (so that nothing drops off silently).
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
  /** (0.5.2, R17) `null`: no reply time (internal work, unless a person set one). Absent: 24 business hours after it arrived, as before. */
  reply_due_at?: string | null
  project_owner_email?: string | null
  /** (0.5.2, R18) The project is internal (Massmarket's own, a test or a template), when the feed says so. */
  internal?: boolean
  /** (0.5.2, R8) Our newest send to the client, when the feed gives it: what tells the bridge a reply went. */
  last_outbound_at?: string | null
}

export type FeedDraft = {
  package_id: string
  project_id: string
  project_name: string
  status: string
  covers_through?: string
  /** When the package was last changed, when the feed gives it: part of what tells a thread it has the latest. */
  updated_at?: string
  drafts_ready?: number
  /** Drafts not sent yet (ready, edited, sending, failed). Absent on a server that does not send it yet. */
  drafts_unsent?: number
  flagged_for_rob?: boolean
  picked_up_by?: string | null
  picked_up_at?: string | null
  project_owner_email?: string | null
  /**
   * (0.5.2, R8) What the server's check of our latest send to the client found, when the feed gives it: the
   * items it left open (team-safe short strings), the ones it answered, when it checked, and the time of the
   * send it checked. Absent on a server that does not send them yet: the package is read as in 0.5.1.
   */
  still_open?: unknown
  answered?: unknown
  /** (0.5.2, R17) `null`: the package has no reply time (internal work). Absent: 24 business hours after what it covers, as before. */
  due_at?: string | null
  /** (0.5.2, R18) The project is internal, when the feed says so. */
  internal?: boolean
  checked_at?: string | null
  checked_send_at?: string | null
  last_outbound_at?: string | null
}

export type FeedTicket = {
  ticket_id: string
  project_id: string
  project_name: string
  title: string
  /** (0.5.2, R17) `null`: no due time (internal work, unless a person set one). */
  due_at: string | null
  due_source?: string | null
  assignee_email?: string | null
  /** When the task was created, when the feed gives it. */
  created_at?: string | null
  /**
   * (0.5.2, R1) When the work has to start to finish by its due time: OW's `start_by_at`, the due time less
   * the ticket's estimate (`est_hours`) at 1.5 hours of work a business day (OW src/lib/start-by.ts). Null or
   * absent with no estimate: the task acts by its due time.
   */
  start_by_at?: string | null
  last_outbound_at?: string | null
  /** (0.5.2, R18) The project is internal, when the feed says so. */
  internal?: boolean
}

/**
 * One of the caller's own Claude Code sessions that declared a client: the feed's `threads` field. The
 * session id is what `$.session.id()` answers in that thread. Absent on a server that does not send it yet.
 * `rows` is how many worklog rows that session wrote for that project in the feed's window: the thread's
 * length when nothing better is known. Absent on a server that does not send it yet.
 * `sole` is OW's word on whether the session declared no other project of any kind in the window: OW lists
 * a session under one project at most, and only a project in the feed, so a session that also declared the
 * internal-ops project, or a client outside the feed, shows here as that one row alone. `false`: it did
 * (2026-10-13, the Pipeline-speed thread). Absent on a server that does not send it yet: the row is read
 * as it always was.
 */
export type FeedThread = { project_id: string; session_id: string; last_activity_at: string; rows?: number; sole?: boolean }

export type Feed = {
  member: string
  role: string
  mail?: FeedMail[]
  drafts?: FeedDraft[]
  /** `start_now` (0.5.2, R1): committed tickets due after the due-soon window whose start-by time has come or is within 24 business hours. */
  tickets?: { overdue?: FeedTicket[]; due_today?: FeedTicket[]; due_soon?: FeedTicket[]; start_now?: FeedTicket[] }
  threads?: FeedThread[]
}

/**
 * The client's open reply package when it is not simply "ready for you" (Rob, 2026-10-12: a thread that
 * held the drafts was told none were prepared).
 *   held_by_me     the viewer picked it up and a draft is not sent yet
 *   held_by_other  a teammate picked it up; `by` is their name
 *   stale          drafts exist but are marked out of date, and nobody holds it; for the founder, `by` is the
 *                  teammate it is with when it is a teammate's (R1, 0.5.1), else ''
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

/**
 * A package that is a teammate's and not the viewer's to pick up or rebuild: one a teammate holds, and (for
 * the founder) a stale one a teammate has (R1: `by` names them). The kickoff and the bridge note word the
 * two alike: show what is waiting, run no prep, draft no second reply (Opus, 10-13, M2).
 */
export const withHolder = (o: OpenPackage): boolean => o.state === 'held_by_other' || (o.state === 'stale' && o.by !== '')

/** The newest time of each kind of thing a client has for the viewer, in ms (0: none): a message received, the mail a package covers, a task created (or due, where the feed gives no creation time). */
export type Newest = { mail: number; pkg: number; task: number }

/** Who sends a package that waits for the founder's OK, when the feed names no owner for the client. */
export const NOBODY = 'nobody on record'

export type QueueItem = {
  projectId: string
  projectName: string
  client: string
  dueAt: number
  /** `ok`: for the founder alone, a package flagged for his OK that somebody else sends. */
  kind: 'ready' | 'reply' | 'task' | 'ok'
  messages: number
  tasks: number
  packageId: string | null
  coversThrough: string | null
  /** The package's `updated_at` as the feed gave it, or null. Compared, never shown. */
  packageUpdatedAt: string | null
  flagged: boolean
  mail: Array<{ at: string; sender: string; subject: string; snippet: string }>
  taskTitles: string[]
  open: OpenPackage | null
  /** Set with kind `ok`: who sends the package once the founder has given his OK (the owner on record, cleaned, or NOBODY). Every read is `it.ok ?? null`. */
  ok: { sends: string } | null
  /** What "something new arrived" is measured against. Every read is `it.newest ?? …`: an item an older version stored has none. */
  newest: Newest
  /**
   * For the founder alone: the teammate a client's package is with when it is theirs to see through, not his
   * (0.5.1). R1: a stale package a teammate sends, with a client message waiting after its drafts. R2: a
   * current package flagged for his OK that a teammate sends, until its reply is due. The client then lists
   * under With a teammate. Absent otherwise, and on an item an older version stored.
   */
  theirs?: string
  /**
   * (0.5.2, R1) The soonest time something of the client's must be acted on: a reply's due time, a package's,
   * a task's start-by time when the feed gives one, else its due time. Its thread is pinned while this is past
   * or within the next 24 business hours. Every read is `it.actBy ?? it.dueAt`: an item an older version
   * stored has none.
   */
  actBy?: number
  /** (0.5.2, R8) Our newest send to the client in the feed, in ms (0: none given). */
  lastOut?: number
  /** (0.5.2, R8) The server's check of our latest send, on the client's own package: absent when the feed gives none. */
  check?: PackageCheck | null
  /**
   * (0.5.2, R17) True when the client is listed for something with no due time (internal work, unless a person
   * set one): its `dueAt` is then Infinity (stored as null), it is listed last, shows no clock, never pins and
   * never gets a no-thread chip.
   */
  noDue?: true
  /** (0.5.2, R18) An internal project (Massmarket's own, a test or a template): its thread is never unpinned by the bridge. */
  internal?: true
}

/**
 * (0.5.2, R18) The projects that are internal by id, while the feed carries no internal flag: Massmarket's
 * internal-ops project and the Massmarket Core Snapshot. A feed row with `internal: true` makes any project so.
 */
export const INTERNAL_PROJECTS: ReadonlySet<string> = new Set(['e6deffc3-2713-4def-a11d-b75a1efba9c1', '3e439f40-a17f-48e2-bcfe-723af5b741fc'])

/** (R17) Whether a client has a due time at all (an item stored by the bridge keeps Infinity as null). */
export const hasDue = (it: Pick<QueueItem, 'dueAt'>): boolean => typeof it.dueAt === 'number' && Number.isFinite(it.dueAt)

/** Soonest due first; a client with no due time last (R17). */
export const byDue = (a: Pick<QueueItem, 'dueAt'>, b: Pick<QueueItem, 'dueAt'>): number => {
  const x = hasDue(a) ? a.dueAt : Infinity
  const y = hasDue(b) ? b.dueAt : Infinity
  return x === y ? 0 : x < y ? -1 : 1
}

/**
 * (0.5.2, R8) What the server's check found on the client's package: the time of the send it checked
 * (`checked_send_at`, ms, 0 for none), what it left open, and what the package covers through (ms, 0 unknown).
 */
export type PackageCheck = { sendAt: number; stillOpen: string[]; covers: number }

/**
 * What a row under With a teammate adds to its sentence when the package there is flagged for the founder's
 * OK (R2, Opus's words): the teammate decides whether it needs him (client-reply-prep §1 rule 13, §5.2).
 */
export const MAY_NEED_OK = 'may need your OK'

/** (the founder, R2) What such a row's title and waiting text say in place of `needs your OK · <X> sends`, before its reply is due (Opus's words). */
export const decidesText = (who: string): string => `${MAY_NEED_OK} · ${who} decides`

const HOUR = 3_600_000
const DAY = 24 * HOUR
/**
 * Both windows are business time: 3 business days back, 24 business hours ahead. (0.5.2, R1) The list holds
 * everything the feed gives that is overdue by up to 3 business days or not due yet, however far ahead; the
 * 24 business hours ahead are the pin's window (`pinsNow`): a client's thread pins while something of it must
 * be acted on within them, or already should have been.
 */
export const WINDOW_BACK_MS = 3 * DAY
export const WINDOW_AHEAD_MS = DAY
/**
 * (0.5.2, R8) How long a send waits for the server's check before the client is listed as it was: a check that
 * never lands does not keep a client off the list. Real time (it is not a client's clock).
 */
export const CHECK_WAIT_MS = 2 * HOUR
export const MAX_PINS = 8
/**
 * How far back the feed is asked for client mail, in business hours: OW's `mail_hours`, which takes 1 to
 * 168. A reply is due 24 business hours after a message, and a client goes under Older once that is more
 * than 3 business days past, so mail belongs under Older only when it is more than 96 business hours old.
 * The 96 asked for until 2026-10-13 meant Older could never hold any mail (review of 79cbc596, F1). Rob, that
 * day: "I kind of do think expanding that to 7 days would be better." The list keeps its 3-business-day
 * cut; mail 3 to 7 business days overdue goes under Older. Mail OW sends from further back than this is read
 * the same way, and goes under Older too.
 */
export const MAIL_LOOKBACK_HOURS = 168

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

/**
 * Every client the feed has something of the viewer's for, in the three lists the pane draws. A client is
 * in exactly one.
 *   queue     needs the viewer now: what pins and what the header counts. Soonest due first.
 *   teammate  a teammate holds its reply drafts and the viewer has no task of their own due there: not the
 *             viewer's to act on (Rob, 2026-10-12: "They should only be seeing theirs... when you pass it
 *             to somebody else, it should show up for only the person who's passed it"). Never pinned,
 *             never counted. The pane lists them under `With a teammate (n)`.
 *   older     its only items are more than 3 business days overdue (Rob, 2026-10-12: two clients with
 *             unanswered mail from ten and six days ago were not shown at all). Never pinned, never
 *             counted. The pane lists them last, under `Older (n)`, most overdue first.
 */
export type Lists = { queue: QueueItem[]; teammate: QueueItem[]; older: QueueItem[]; checking: QueueItem[] }

/**
 * A teammate holds this client's reply drafts and nothing else keeps it in the viewer's list: no committed
 * task of the viewer's own due there, and (for the founder) no package waiting for his OK. For the founder
 * too: a client whose package a teammate sends and that is theirs to see through (`theirs`, R1 and R2).
 */
export const withTeammate = (it: QueueItem): boolean =>
  it.tasks === 0 && (Boolean(it.theirs) || ((it.open ?? null)?.state === 'held_by_other' && it.kind !== 'ok'))

export function buildLists(feed: Feed, now: number): Lists {
  const current = build(feed, now, false)
  const inCurrent = new Set(current.map(i => i.projectId))
  const past = build(feed, now, true).filter(i => !inCurrent.has(i.projectId))
  // (0.5.2, R8) a client whose package waits for the server's check of our newer send is in none of the
  // three lists: off the Needs-you list, not pinned, not counted. Its thread is named for it (`checkingTitle`).
  const checks = (i: QueueItem): boolean => fastState(i, now)?.state === 'checking'
  return {
    queue: current.filter(i => !withTeammate(i) && !checks(i)),
    teammate: [...current, ...past].filter(withTeammate),
    older: past.filter(i => !withTeammate(i) && !checks(i)),
    checking: [...current, ...past].filter(i => !withTeammate(i) && checks(i)),
  }
}

// ---------------------------------------------------------------- 0.5.2: what pins, and a send being checked

/**
 * R1 (Rob, 2026-10-13: "Pinned is something the server recognized needs to be done within the next 24 hours,
 * whether it's a reply or work that must be started within 24 hours to finish by an ETA"): whether a client on
 * the Needs-you list pins now. Its act-by time (a reply's due time, a task's start-by time, else its due
 * time) is past, or within the next 24 BUSINESS hours (weekends do not count: Friday 3 PM to Monday 3 PM is 24).
 */
export function pinsNow(it: Pick<QueueItem, 'dueAt'> & { actBy?: number }, now: number): boolean {
  const at = Number.isFinite(it.actBy) ? (it.actBy as number) : it.dueAt
  if (!Number.isFinite(at)) return false
  return at <= now || businessWithin(now, at, WINDOW_AHEAD_MS)
}

/**
 * (R18) The internal projects. Every project a feed row marks `internal: true`; and (fix round 1, L9)
 * INTERNAL_PROJECTS only while no row of the feed carries the flag at all (a boolean either way): once OW sends
 * it, the feed alone says.
 */
export function internalProjects(feed: Feed): Set<string> {
  const flagged = new Set<string>()
  let carries = false
  const add = (row: { project_id?: string | null; internal?: boolean } | null | undefined): void => {
    if (!row || typeof row.internal !== 'boolean') return
    carries = true
    if (row.internal && isUuid(row.project_id)) flagged.add(row.project_id)
  }
  for (const m of feed.mail ?? []) add(m)
  for (const d of feed.drafts ?? []) add(d)
  const t = feed.tickets ?? {}
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? []]) for (const tk of k) add(tk)
  return carries ? flagged : new Set(INTERNAL_PROJECTS)
}

/** Every client's newest `last_outbound_at`, from every row of it the feed gives one on, in ms. */
export function lastOutbound(feed: Feed): Map<string, number> {
  const out = new Map<string, number>()
  const add = (pid: unknown, at: unknown): void => {
    const t = typeof at === 'string' ? ms(at) : NaN
    if (!isUuid(pid) || !Number.isFinite(t)) return
    out.set(pid, Math.max(out.get(pid) ?? 0, t))
  }
  for (const m of feed.mail ?? []) add(m?.project_id, m?.last_outbound_at)
  for (const d of feed.drafts ?? []) add(d?.project_id, d?.last_outbound_at)
  const t = feed.tickets ?? {}
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? []]) for (const tk of k) add(tk?.project_id, tk?.last_outbound_at)
  return out
}

/** At most this many items of what a check left open are kept, each cut to this length (team-safe short strings: OW keeps them under 120). */
const STILL_OPEN_MAX = 8
const STILL_OPEN_LEN = 120

/** A package row's check, as the bridge keeps it: what is still open is server text, cleaned like any (it goes into a message Claude reads). */
function checkOf(d: FeedDraft): PackageCheck {
  const raw = Array.isArray(d.still_open) ? (d.still_open as unknown[]) : []
  const stillOpen = raw.map(x => cleanText(x, STILL_OPEN_LEN)).filter(Boolean).slice(0, STILL_OPEN_MAX)
  const sendAt = ms(d.checked_send_at)
  const covers = ms(d.covers_through)
  return { sendAt: Number.isFinite(sendAt) ? sendAt : 0, stillOpen, covers: Number.isFinite(covers) ? covers : 0 }
}

/** What R8 makes of a client: our newer send is being checked, or the check found something still open after it. */
export type Fast = { state: 'checking'; at: number } | { state: 'still_open'; at: number; items: string[] }

/**
 * R8 (Rob, 2026-10-13, "yes fast close"), from the client's package and our newest send, both the feed's:
 *   checking    our send is newer than the last check of the package (`last_outbound_at` > `checked_send_at`)
 *               and newer than what the package covers, and no older than CHECK_WAIT_MS
 *   still_open  the check of our send has landed (`checked_send_at` >= our newest send) and left items open
 * null otherwise: no package, no check, nothing open, or a feed that gives none of these fields (0.5.1).
 */
export function fastOf(c: PackageCheck | null | undefined, lastOut: number, now: number): Fast | null {
  if (!c) return null
  const out = Number(lastOut) || 0
  const checked = Number(c.sendAt) || 0
  if (out > 0 && out > checked && out > (Number(c.covers) || 0)) return now - out <= CHECK_WAIT_MS ? { state: 'checking', at: out } : null
  const items = Array.isArray(c.stillOpen) ? c.stillOpen : []
  if (checked > 0 && items.length && !(out > checked)) return { state: 'still_open', at: checked, items }
  return null
}

/**
 * fastOf for a client as the lists hold it. (The founder's package that waits for his OK is somebody else's
 * send: never.) Fix round 1, F3: never `checking` while something else of the client's still needs the person
 * whatever our send answered: a client message that arrived after it, a committed task, or a package they hold
 * with a draft not sent.
 */
export function fastState(it: QueueItem, now: number): Fast | null {
  if (it.kind === 'ok') return null
  const fast = fastOf(it.check ?? null, Number(it.lastOut) || 0, now)
  if (fast?.state !== 'checking') return fast
  const o = it.open ?? null
  const newerMail = (Number(it.newest?.mail) || 0) > fast.at
  if (newerMail || it.tasks > 0 || (o?.state === 'held_by_me' && o.unsent > 0)) return null
  return fast
}

/** R8: the thread's name while the server checks our send: `✓ Acme Legal · sent 3 PM · checking`. */
export function checkingTitle(client: string, at: number, now: number): string {
  return `✓ ${client} · sent ${clockText(at, now)} · checking`
}

/** R8: the thread's name once the check found something still open: `🟡 Acme Legal · still open after your reply`. */
export function stillOpenTitle(client: string): string {
  return `🟡 ${client} · still open after your reply`
}

/** R4: the row of a client on the Needs-you list with no thread at all: `🔴 NO THREAD · Acme Legal · due 3 PM`. */
export function noThreadTitle(it: QueueItem, now: number): string {
  return `🔴 NO THREAD · ${it.client} · due ${clockText(it.dueAt, now)}`
}

/** The name a client's linked thread is given: still open after our reply (R8), else what is due (titleFor). */
export function threadTitle(it: QueueItem, now: number): string {
  return fastState(it, now)?.state === 'still_open' && !withTeammate(it) ? stillOpenTitle(it.client) : titleFor(it, now)
}

/** The clients that need the viewer now: what pins. Soonest due first. */
export function buildQueue(feed: Feed, now: number): QueueItem[] {
  return buildLists(feed, now).queue
}

/** A client as a name or an id may mean it: its id, its project's name and its short name, both cleaned. */
export type KnownClient = Pick<QueueItem, 'projectId' | 'projectName' | 'client'>

/**
 * Every client the feed names, whether or not anything of it is waiting on the viewer: each project on a
 * mail row, a reply package or a ticket (all three buckets), with the name that row gives it. What `/mm link`
 * may mean beyond the three lists (Rob, 2026-10-13: a client with nothing waiting could not be linked).
 * ⛔ The same rule as the lists: a lower-case uuid and a name with something left once cleaned, or nothing.
 * The feed's `threads` carry no name: a project known only there is named by its id (register.tsx).
 */
export function feedClients(feed: Feed): KnownClient[] {
  const out = new Map<string, KnownClient>()
  const add = (projectId: unknown, projectName: unknown) => {
    if (!isUuid(projectId) || out.has(projectId) || cleanName(projectName) === '') return
    out.set(projectId, { projectId, projectName: cleanName(projectName), client: shortName(projectName as string) })
  }
  for (const m of feed.mail ?? []) add(m?.project_id, m?.project_name)
  for (const d of feed.drafts ?? []) add(d?.project_id, d?.project_name)
  const t = feed.tickets ?? {}
  // (fix round 1, F5) `start_now` too: a client listed only by a task that must start now is a client the feed names
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? []]) for (const tk of k) add(tk?.project_id, tk?.project_name)
  return [...out.values()]
}

/**
 * One pass over the feed. `older` false: what is overdue by up to 3 business days or due within the next
 * 24 business hours. `older` true: only what is more than 3 business days overdue, by the same rules of
 * whose it is.
 */
function build(feed: Feed, now: number, older: boolean): QueueItem[] {
  const tooOld = (due: number): boolean => due < now && !businessWithin(due, now, WINDOW_BACK_MS)
  // (0.5.2, R1) not due yet: listed however far ahead; whether it pins is `pinsNow`
  const inWindow = (due: number): boolean => Number.isFinite(due) && (older ? tooOld(due) : due < now ? businessWithin(due, now, WINDOW_BACK_MS) : true)
  /** (R8) Our newest send to each client, from every row of it the feed gives one on. */
  const lastOut = lastOutbound(feed)
  /** (R18) The internal projects: by the feed's own flag on any row, else by id. */
  const internal = internalProjects(feed)
  const founder = feed.role === 'founder'
  const byProject = new Map<string, QueueItem>()
  // ⛔ A row whose project id is not a lower-case uuid, or whose name has nothing left once cleaned, is
  // dropped: the id goes into the [mm-link] marker and the name into the kickoff, both read by Claude.
  const usable = (projectId: unknown, projectName: unknown): boolean => isUuid(projectId) && cleanName(projectName) !== ''
  const item = (projectId: string, projectName: string): QueueItem => {
    let it = byProject.get(projectId)
    if (!it) {
      it = {
        projectId, projectName: cleanName(projectName), client: shortName(projectName), dueAt: Infinity, kind: 'task',
        messages: 0, tasks: 0, packageId: null, coversThrough: null, packageUpdatedAt: null, flagged: false, mail: [], taskTitles: [], open: null,
        ok: null, newest: { mail: 0, pkg: 0, task: 0 }, actBy: Infinity, lastOut: lastOut.get(projectId) ?? 0, check: null,
        ...(internal.has(projectId) ? { internal: true as const } : {}),
      }
      byProject.set(projectId, it)
    }
    return it
  }
  /** The newest time of each kind of thing a client has: what "something new arrived" is measured against. */
  const seen = (it: QueueItem, kind: keyof Newest, at: number): void => {
    if (Number.isFinite(at) && at > it.newest[kind]) it.newest[kind] = at
  }
  /** (R1) The soonest something of the client's must be acted on. */
  const act = (it: QueueItem, at: number): void => {
    if (Number.isFinite(at)) it.actBy = Math.min(it.actBy ?? Infinity, at)
  }

  /** The mail rows counted for the viewer: a message is counted once. */
  const counted = new Set<FeedMail>()
  /**
   * The feed's reply time is trusted when it gives one; otherwise 24 business hours after the message arrived.
   * (R17, R18) None at all, Infinity, when the feed gives `null` or the project is internal: nobody set one.
   */
  const replyDue = (m: FeedMail): number =>
    m.reply_due_at === null || internal.has(m.project_id ?? '') ? Infinity : Number.isFinite(ms(m.reply_due_at)) ? ms(m.reply_due_at as string) : businessDeadline(ms(m.received_at), DAY)
  /** (R17) A row with no due time is listed in the current pass only (it is never overdue), and marks its client. */
  const undated = (it: QueueItem): void => {
    it.noDue = true
  }
  /** A client message waiting on our reply, on the client's item. */
  const countMail = (it: QueueItem, m: FeedMail, due: number): void => {
    counted.add(m)
    it.messages += 1
    it.dueAt = Math.min(it.dueAt, due)
    act(it, due)
    if (it.kind === 'task') it.kind = 'reply'
    it.mail.push({ at: m.received_at, sender: m.sender ?? '?', subject: m.subject ?? '', snippet: m.snippet ?? '' })
    seen(it, 'mail', ms(m.received_at))
  }
  for (const m of feed.mail ?? []) {
    if (m.reply_status !== 'unanswered' || !m.project_id || !m.project_name) continue
    if (!usable(m.project_id, m.project_name)) continue
    if (!isMine(m.project_owner_email, feed)) continue
    const due = replyDue(m)
    if (due === Infinity) {
      if (older) continue
      const it = item(m.project_id, m.project_name)
      countMail(it, m, due)
      undated(it)
      continue
    }
    if (!inWindow(due)) continue
    countMail(item(m.project_id, m.project_name), m, due)
  }

  const me = typeof feed.member === 'string' ? feed.member.toLowerCase() : ''
  /** (the founder) The clients whose row is a package that waits for his OK and that a teammate sends (R2). */
  const okTheirs = new Set<string>()
  /** (the founder) The teammate who sends a stale package of the client's, where a client message waits after its drafts (R1). */
  const staleTheirs = new Map<string, string>()
  /**
   * (the founder) For each client with a stale package a teammate has: that teammate, and the client messages
   * waiting after its drafts, in this pass's window. Counted only for the client's place under With a teammate,
   * once nothing else of the founder's lists the client (below).
   */
  const staleMail = new Map<string, { name: string; mail: Array<{ m: FeedMail; due: number }> }>()
  for (const d of feed.drafts ?? []) {
    // the package id goes into the kickoff and the pickup request: a lower-case uuid or nothing
    if (!usable(d.project_id, d.project_name) || !isUuid(d.package_id)) continue
    const holder = (d.picked_up_by ?? '').toLowerCase()
    const held = d.status === 'picked_up'
    const ready = d.drafts_ready ?? 0
    // R12 (0.5.2): the feed lists a picked-up package only while a draft of it is not sent (OW #455), whatever
    // state that draft is in (`edited`, `sending`, `failed` are not `ready`): with no `drafts_unsent` given, a
    // held package still has one. It is never read as "no drafts".
    const unsent = typeof d.drafts_unsent === 'number' && Number.isFinite(d.drafts_unsent) ? d.drafts_unsent : held ? Math.max(1, ready) : ready
    // What counts: a held package with a draft not sent, or a prepared or stale one with a draft ready.
    if (held ? unsent < 1 || holder === '' : (d.status !== 'prepared' && d.status !== 'stale') || ready < 1) continue
    // (the founder) A teammate has this package to see through (Opus, 10-13): the teammate who holds it, whoever
    // owns the client; with nobody holding it, the owner on record when that is a teammate. ⛔ A package he
    // holds is his, and so is one with no holder on a client with no owner on record (R3).
    const sender = typeof d.project_owner_email === 'string' ? d.project_owner_email.toLowerCase() : ''
    const mates = founder && (held ? holder !== me : sender !== '' && sender !== me)
    // ⛔ R1 (0.5.1): a stale package a teammate has never puts a row on the founder's list, flagged or not
    // (Rob's 16 rows, 10-13: Mugen, ReGen, Remver and Talon were answered by hand; the owner's stale reminder
    // carries what is still open). So it is never a package that waits for his OK. (A stale package is held
    // by nobody: it is the owner's on record.)
    const staleTheirsHere = mates && d.status === 'stale'
    const forOk = founder && d.flagged_for_rob === true && !staleTheirsHere
    const heldByMe = held && holder === me
    const it = item(d.project_id, d.project_name)
    // (R17, R18) no reply time for a package the feed gives none, or on an internal project: Infinity
    const noDue = d.due_at === null || internal.has(d.project_id)
    const due = noDue ? Infinity : typeof d.due_at === 'string' && Number.isFinite(ms(d.due_at)) ? ms(d.due_at) : Number.isFinite(ms(d.covers_through)) ? businessDeadline(ms(d.covers_through), DAY) : now
    // (this pass's side of the window: not yet 3 business days past its reply time, or only what is past that)
    const inReach = noDue ? !older : older ? tooOld(due) : !tooOld(due)
    // `by`: the teammate who holds it; for the founder, also the teammate a stale package is with (R1), so
    // that its pane names them instead of inviting him to pick it up
    const open = (state: OpenPackage['state']): OpenPackage => ({
      id: d.package_id, state, by: state === 'held_by_other' ? holderName(holder) : state === 'stale' && staleTheirsHere ? holderName(sender) : '',
      at: held ? d.picked_up_at ?? null : null, unsent: held ? unsent : ready, newer: 0,
    })
    // ⛔ The holder is asked first, the owner second: a package the viewer holds is theirs to finish whoever
    // owns the client (Rob, 2026-10-12: a client owned by a teammate, picked up and sent by the founder,
    // never appeared on the founder's list). A prepared one is theirs when the client is.
    const readyForMe = d.status === 'prepared' && (holder === '' || holder === me) && isMine(d.project_owner_email, feed) && inReach
    if (heldByMe || readyForMe) {
      it.kind = 'ready'
      it.packageId = d.package_id
      it.coversThrough = d.covers_through ?? null
      it.packageUpdatedAt = typeof d.updated_at === 'string' ? d.updated_at : null
      it.flagged = Boolean(d.flagged_for_rob)
      it.ok = null
      // (R8) what the server's check of our latest send found on this package
      it.check = checkOf(d)
      if (inReach) {
        it.dueAt = Math.min(it.dueAt, due)
        act(it, due)
        if (noDue) undated(it)
        seen(it, 'pkg', ms(d.covers_through))
      }
      it.open = heldByMe ? open('held_by_me') : null
      continue
    }
    // Any other open package never pins by itself: it only changes what the client's row, pane and note say.
    if (it.packageId) continue
    // ⛔ (the founder) A client listed for a package that waits for his OK keeps that package as its own: a
    // later package of the client's that is not flagged (or that a teammate sends and is stale, R1) does not
    // take its place on the row, in the pane or in the kickoff (B4, 2026-10-13).
    if (it.kind === 'ok' && !forOk) continue
    it.open = open(held ? 'held_by_other' : d.status === 'stale' ? 'stale' : 'prepared')
    // (0.5.2, R8) A stale package of the viewer's own (nobody holds it, the client is theirs, no teammate sends
    // it): while our latest send waits for the server's check, or the check left something open, the client is
    // listed by it, so its thread is named for that and pins again on what is still open. Otherwise it changes
    // nothing here, as before (M1: a stale package alone lists nothing).
    if (d.status === 'stale' && !held && !staleTheirsHere && !forOk && isMine(d.project_owner_email, feed)) {
      const c = checkOf(d)
      it.check = c
      if (fastOf(c, it.lastOut ?? 0, now) && inReach) {
        it.dueAt = Math.min(it.dueAt, due)
        act(it, due)
        seen(it, 'pkg', ms(d.covers_through))
      }
    }
    // R1: with a client message waiting after its drafts were built, the client lists under With a teammate,
    // like any reply a teammate holds; with none, it is not listed. The messages are only noted here: they are
    // counted after the tasks, and only where they are all that lists the client (Opus, 10-13, B1).
    if (staleTheirsHere) {
      const after = ms(d.covers_through)
      const waiting = staleMail.get(d.project_id) ?? { name: holderName(sender), mail: [] }
      for (const m of feed.mail ?? []) {
        if (m.project_id !== d.project_id || m.reply_status !== 'unanswered' || waiting.mail.some(w => w.m === m)) continue
        if (Number.isFinite(after) && !(ms(m.received_at) > after)) continue
        const due = replyDue(m)
        if (inWindow(due)) waiting.mail.push({ m, due })
      }
      if (waiting.mail.length) staleMail.set(d.project_id, waiting)
      continue
    }
    // ⛔ With one exception, for the founder alone: a package flagged for his OK is listed whoever owns the
    // client, as its own kind (Rob, 2026-10-12: six such packages were missing from his panel). It is due
    // when a prepared one would be. Somebody else sends it: the owner on record.
    // ⛔ Not the founder's own client's (or an unowned client's) STALE flagged package: with no client
    // message waiting it lists nothing, and that stays so (Rob's 10-13 morning meeting, finding M1: 12 of
    // 102 packages in 14 days went stale because we had already replied by hand; listing them would invite
    // a second reply, and OW's fix will close such packages). With a message waiting, the message lists it.
    if (forOk && (held || !isMine(d.project_owner_email, feed))) {
      it.kind = 'ok'
      it.ok = { sends: d.project_owner_email ? holderName(d.project_owner_email) : NOBODY }
      // R2: one a teammate sends is theirs to decide until its reply is due (below)
      if (mates) okTheirs.add(d.project_id)
      else okTheirs.delete(d.project_id)
      if (inReach) {
        it.dueAt = Math.min(it.dueAt, due)
        act(it, due)
        seen(it, 'pkg', ms(d.covers_through))
      }
    }
  }

  const t = feed.tickets ?? {}
  // (0.5.2, R1) `start_now` too: committed tasks due further out whose work must start within 24 business hours
  const counting = new Set<string>()
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? []]) {
    for (const tk of k) {
      // (R17) a ticket with no due time (internal work nobody dated) has no due source either: it lists, undated
      const undatedRow = tk.due_at === null
      if (tk.due_source !== 'commitment' && !(undatedRow && (tk.due_source === null || tk.due_source === undefined))) continue
      if (!usable(tk.project_id, tk.project_name)) continue
      if ((tk.assignee_email ?? '').toLowerCase() !== feed.member.toLowerCase()) continue
      // a ticket is in one of the feed's lists only; counted once whatever a feed sends
      if (typeof tk.ticket_id === 'string' && counting.has(tk.ticket_id)) continue
      const due = undatedRow ? Infinity : ms(tk.due_at)
      if (undatedRow ? older : !inWindow(due)) continue
      if (typeof tk.ticket_id === 'string') counting.add(tk.ticket_id)
      const it = item(tk.project_id, tk.project_name)
      it.tasks += 1
      it.dueAt = Math.min(it.dueAt, due)
      // R1: a task acts by its start-by time when the feed gives one (OW's `start_by_at`, from the ticket's
      // estimate), else by its due time
      const startBy = ms(tk.start_by_at)
      act(it, Number.isFinite(startBy) && startBy < due ? startBy : due)
      if (undatedRow) undated(it)
      it.taskTitles.push(tk.title)
      seen(it, 'task', Number.isFinite(ms(tk.created_at)) ? ms(tk.created_at) : due)
    }
  }

  // How many client messages arrived after the drafts of a package the viewer holds were written.
  for (const it of byProject.values()) {
    const through = ms(it.coversThrough)
    if (it.open?.state !== 'held_by_me' || !Number.isFinite(through)) continue
    const after = (feed.mail ?? []).filter(m => m.project_id === it.projectId && m.reply_status === 'unanswered' && ms(m.received_at) > through)
    it.open.newer = after.length
    // (they are new for this client whoever owns it: the package is the viewer's to finish)
    for (const m of after) seen(it, 'mail', ms(m.received_at))
  }

  // (the founder) Whose a client is to see through, when it is a teammate's (0.5.1). ⛔ A package of his own,
  // or one he holds, is his (R3).
  //   R2: a current package flagged for his OK that a teammate sends is theirs to decide, the person holding it
  //       approving it with a one-line reason or asking him (Rob, 10-07: client-reply-prep §1 rule 13, §5.2),
  //       until its reply is due: the due time its row shows, in business time. From then it is in his list,
  //       as the `ok` kind always was. With a teammate: whoever holds it, else the one who sends it.
  //   R1: a stale package a teammate sends, with a client message waiting after its drafts. ⛔ Those messages
  //       place the client under With a teammate and nothing more: where anything of his own lists the client
  //       (a task of his, his own mail, a package of his or one that waits for his OK), his row is for that, and
  //       they are not added to it (Opus, 10-13, B1: his task row was turned into a reply and pinned as one).
  if (founder) {
    for (const [pid, waiting] of staleMail) {
      const it = byProject.get(pid)
      if (!it || it.tasks > 0 || it.messages > 0 || it.kind !== 'task' || it.packageId) continue
      for (const { m, due } of waiting.mail) if (!counted.has(m)) countMail(it, m, due)
      if (it.messages > 0) staleTheirs.set(pid, waiting.name)
    }
    for (const it of byProject.values()) {
      const o = it.open ?? null
      const name =
        it.kind === 'ok'
          ? okTheirs.has(it.projectId) && it.dueAt > now ? (o?.state === 'held_by_other' ? o.by : (it.ok ?? null)?.sends) : undefined
          : it.kind === 'ready' ? undefined : staleTheirs.get(it.projectId)
      if (name) it.theirs = name
    }
  }

  // (R17) a client with nothing dated is listed too, in the current pass, last
  return [...byProject.values()]
    .filter(i => Number.isFinite(i.dueAt) || (!older && i.noDue === true))
    .sort(byDue)
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
    // R16 (0.5.2): whole business days COMPLETED, so 1.5 days late is `1d` everywhere, never `2d` in one place
    return late < DAY ? `overdue ${Math.max(1, Math.round(late / HOUR))}h` : `overdue ${Math.floor(late / DAY)}d`
  }
  const a = etParts(due)
  const today = etParts(now)
  const tomorrow = etParts(now + DAY)
  if (a.date === today.date) return `due ${a.time}`
  if (a.date === tomorrow.date) return `due tomorrow ${a.time}`
  return `due ${a.day} ${a.time}`
}

export function isRed(it: QueueItem, now: number): boolean {
  // (R17) nothing due: never red
  if (!hasDue(it)) return false
  return it.dueAt < now || etParts(it.dueAt).date === etParts(now).date
}

/** A moment as the pane writes times: `3 PM` when it is today in New York, `Fri 3 PM` when it is not. */
export function clockText(t: number, now: number): string {
  const a = etParts(t)
  return a.date === etParts(now).date ? a.time : `${a.day} ${a.time}`
}

/**
 * What is due, in a word or two: a package the viewer picked up is `your draft`, one that waits for the
 * founder's OK `needs your OK`; one a teammate decides on before its reply is due `may need your OK ·
 * <teammate> decides` (R2).
 */
const whatOf = (it: QueueItem): string =>
  it.open?.state === 'held_by_me'
    ? 'your draft'
    : it.kind === 'ok' ? (it.theirs ? decidesText(it.theirs) : 'needs your OK') : it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : 'task'

/** What is due for a client and when, in words: `reply ready due tomorrow 8 AM`. */
export function dueLine(it: QueueItem, now: number): string {
  // (R17) nothing due: what it is, and no clock
  return hasDue(it) ? `${whatOf(it)} ${whenText(it.dueAt, now)}` : whatOf(it)
}

/** A client and what is due, as a chip says it: `Acme Legal · reply ready due 7 PM · 3 new`, and who holds its drafts when a teammate does. */
export function needsLine(it: QueueItem, now: number): string {
  const parts = [it.client, dueLine(it, now)]
  if (it.messages > 1) parts.push(`${it.messages} new`)
  if (it.open?.state === 'held_by_other') parts.push(`with ${it.open.by}`)
  if (it.flagged) parts.push('flagged')
  return parts.join(' · ')
}

/**
 * The business-time distance to a due instant, as a thread's name leads with it: `5h late`, `3d late`,
 * `3h left`, `2d left`. Hours under 24 business hours, whole business days from there. Weekends do not count.
 */
export function clockLead(due: number, now: number): string {
  const late = due < now
  const span = late ? businessMsBetween(due, now) : businessMsBetween(now, due)
  // under a business day: 1 to 23 hours (59 minutes short of a day is 23h, not 24h); from there, whole days
  // R16 (0.5.2): whole business days COMPLETED (Math.floor): 1.49 and 1.51 days both read `1d`, 2.0 reads `2d`
  const n = span < DAY ? `${Math.min(23, Math.max(1, Math.round(span / HOUR)))}h` : `${Math.floor(span / DAY)}d`
  return `${n} ${late ? 'late' : 'left'}`
}

/**
 * The pinned thread's name: `🔴 3d late · Acme Legal · reply · 17 new`. It leads with the hours (Rob,
 * 2026-10-12: "hours before overdue or something like that, as the first part of the message").
 */
export function titleFor(it: QueueItem, now: number): string {
  // A client whose drafts a teammate holds, and that is not the viewer's to act on: who has it stands where
  // the clock would (`🟡 with J Smith · Acme Legal · reply`), and nothing about it reads as late.
  const theirs = withTeammate(it)
  // (`your draft` for a package the viewer holds, and `with <Name>` when a teammate holds it: 0.4.1; for the
  // founder, the teammate it is with when it is theirs to see through: 0.5.1)
  // (R17) nothing due: `🟡 <client> · <what>`, no clock and never red
  const lead = theirs ? `🟡 with ${it.theirs ?? it.open?.by ?? ''}` : hasDue(it) ? `${isRed(it, now) ? '🔴' : '🟡'} ${clockLead(it.dueAt, now)}` : ''
  const parts = lead ? [lead, it.client, whatOf(it)] : [`🟡 ${it.client}`, whatOf(it)]
  if (it.messages > 1) parts.push(`${it.messages} new`)
  if (it.open?.state === 'held_by_other' && !theirs) parts.push(`with ${it.open.by}`)
  if (it.flagged) parts.push('flagged')
  return parts.join(' · ')
}

/**
 * For a client whose drafts a teammate holds: who has them, how many are not sent, and to ask before
 * writing a second reply (0.4.1's own sentence, as the client's pane ends with it). '' for any other client.
 */
export function holdSentence(it: QueueItem): string {
  return (it.open ?? null)?.state === 'held_by_other' ? draftsLine(it).replace(/^_|_$/g, '') : ''
}

export function clearedTitle(client: string, now: number): string {
  return `✓ ${client} · clear ${etParts(now).time}`
}

/**
 * The client a thread name of the bridge's names, whichever shape it has: today's
 * (`🔴 3d late · Acme Legal · reply`, or `🟡 with J Smith · Acme Legal · reply` when a teammate holds its
 * drafts), the one before it (`🔴 Acme Legal · reply overdue 6h`), the cleared one
 * (`✓ Acme Legal · clear 11 AM`), with or without a two-digit rank in front. For any other title, what
 * stands before its first ` · `.
 */
export function clientInTitle(title: string): string {
  const marked = /^[🔴🟡✓]\s/u.test(title.replace(/^\d{2}\s+/, ''))
  const parts = title.replace(/^\d{2}\s+/, '').replace(/^[🔴🟡✓]\s*/u, '').replace(/^client:\s*/i, '').split(' · ')
  const first = parts[0]?.trim() ?? ''
  // what leads the name: the clock, or (in a name of the bridge's only) who holds the drafts, or (0.5.2) that
  // the client has no thread
  const lead = /^\d+[hd] (?:late|left)$/.test(first) || (marked && parts.length > 2 && /^with \S/.test(first)) || (marked && first === 'NO THREAD')
  return lead ? (parts[1]?.trim() ?? '') : first
}

/** A session title names this client when, stripped of our marks, it starts with the client's name. */
export function titleNames(title: string, client: string): boolean {
  const bare = clientInTitle(title).toLowerCase()
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
  // (the founder) a stale package a teammate has: not his to pick up (R1, Opus's words)
  if (o?.state === 'stale' && o.by) return `_${o.by} has these drafts. Their reminder lists what is still open._`
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
  // (the founder) a stale package a teammate has is treated as one a teammate holds: never "pick it up" (M2),
  // its first sentence in Opus's words for a package nobody picked up
  if (o && withHolder(o)) return `${waiting}; ${o.by} has the reply drafts (package ${o.id.slice(0, 8)}), and they are marked out of date. Do not write a second reply: ask ${o.by}.`
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

// ---------------------------------------------------------------- a route call that can close something

/**
 * The team gateway's routes that can close something for a client (R6, Rob 2026-10-13: names and pins change
 * only from the server's data, and the feed is read again at once after any of these): the reply-draft routes
 * that end a draft (`sent`, `discard`, and `post-team`, which posts a team draft and records it sent in the same
 * call, client-reply-prep §9.5), and ANY write to a reply package (`/reply-package`, `/reply-package/no-reply`,
 * `/reply-package/<anything>`). Each can change what the feed lists for the client. Judged by the route and the
 * method, never by a fixed list of commands.
 */
const CLOSING_ROUTE = String.raw`\/(?:reply-draft\/(?:sent|discard|post-team)|reply-package(?:\/[\w-]+)*)(?![\w\/-])`
/** A write: what a read (GET) never is. */
const WRITE = String.raw`(?:POST|PATCH|PUT|DELETE)`
/** As the gateway helper is called: `mm-api.mjs ext POST /reply-draft/sent ...`, the path quoted or not. */
const VIA_HELPER = new RegExp(String.raw`\bmm-api\.mjs["']?\s+ext\s+${WRITE}\s+["']?${CLOSING_ROUTE}`)
/** And as the route itself is called: a write to `.../api/ext/reply-draft/sent`. */
const VIA_URL = new RegExp(String.raw`\/api\/ext${CLOSING_ROUTE}`)
const WRITE_WORD = new RegExp(String.raw`\b${WRITE}\b`)

/**
 * Whether a shell command is a call to one of those routes. ⛔ This is all the bridge ever looks at of a
 * command: it answers yes or no, and nothing of the command is kept, logged or passed on.
 * The route is matched, never a loose word: `revise`, `claim-send`, `rob-ok`, `release` and a GET are not it.
 */
export function isClosingRoute(command: unknown): boolean {
  return typeof command === 'string' && command.length <= 200_000 && (VIA_HELPER.test(command) || (VIA_URL.test(command) && WRITE_WORD.test(command)))
}

/** The name 0.5.1 gave it (a reply draft was sent or discarded); the same test now. */
export const isDraftDone = isClosingRoute

// ---------------------------------------------------------------- a client email or message sent from this thread

/**
 * The shapes of a command that sends a client email or message straight from a thread (R11, fix round 1, F1:
 * the F&I send of 2026-10-13 was a Gmail script, no gateway route): Gmail's send endpoints, spelled whole, split
 * (a quoted send path beside the Gmail host) or through the Google client library; HighLevel's conversation
 * message and email send; and the Massmarket send script. The same shapes the send gate knows
 * (global-config/hooks/send-gate.js, PATTERNS).
 */
const CLIENT_SEND: ReadonlyArray<{ path: RegExp; also?: RegExp }> = [
  { path: /gmail\.googleapis\.com\/gmail\/v1\/users\/[^/\s'"]+\/(?:drafts|messages)\/send/i },
  { path: /["'`]\/(?:messages|drafts)\/send\b/i, also: /gmail\.googleapis\.com/i },
  { path: /\busers\(\)\s*\.\s*(?:messages|drafts)\(\)\s*\.\s*send\s*\(|\busers\.(?:messages|drafts)\.send\s*\(/i },
  { path: /services\.leadconnectorhq\.com\/conversations\/messages/i, also: /\bPOST\b|\.post\(|method['"]?\s*[:=]\s*['"`]?POST/i },
  { path: /services\.leadconnectorhq\.com\/emails\/[^\s'"]*send/i },
  { path: /\bsend-client-email\.py\b/ },
]

/**
 * Whether a shell command sends a client email or message itself. ⛔ As with isClosingRoute: yes or no, and
 * nothing of the command is kept, logged or passed on.
 */
export function isClientSend(command: unknown): boolean {
  if (typeof command !== 'string' || command.length > 200_000) return false
  return CLIENT_SEND.some(s => s.path.test(command) && (!s.also || s.also.test(command)))
}
