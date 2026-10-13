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
  reply_due_at?: string
  project_owner_email?: string | null
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
}

export type FeedTicket = {
  ticket_id: string
  project_id: string
  project_name: string
  title: string
  due_at: string
  due_source?: string
  assignee_email?: string | null
  /** When the task was created, when the feed gives it. */
  created_at?: string | null
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
}

/**
 * What a row under With a teammate adds to its sentence when the package there is flagged for the founder's
 * OK (R2, Opus's words): the teammate decides whether it needs him (client-reply-prep §1 rule 13, §5.2).
 */
export const MAY_NEED_OK = 'may need your OK'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Both windows are business time: 3 business days back, 24 business hours ahead. */
export const WINDOW_BACK_MS = 3 * DAY
export const WINDOW_AHEAD_MS = DAY
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
export type Lists = { queue: QueueItem[]; teammate: QueueItem[]; older: QueueItem[] }

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
  return {
    queue: current.filter(i => !withTeammate(i)),
    teammate: [...current, ...past].filter(withTeammate),
    older: past.filter(i => !withTeammate(i)),
  }
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
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? []]) for (const tk of k) add(tk?.project_id, tk?.project_name)
  return [...out.values()]
}

/**
 * One pass over the feed. `older` false: what is overdue by up to 3 business days or due within the next
 * 24 business hours. `older` true: only what is more than 3 business days overdue, by the same rules of
 * whose it is.
 */
function build(feed: Feed, now: number, older: boolean): QueueItem[] {
  const tooOld = (due: number): boolean => due < now && !businessWithin(due, now, WINDOW_BACK_MS)
  const inWindow = (due: number): boolean =>
    Number.isFinite(due) && (older ? tooOld(due) : due < now ? businessWithin(due, now, WINDOW_BACK_MS) : businessWithin(now, due, WINDOW_AHEAD_MS))
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
        ok: null, newest: { mail: 0, pkg: 0, task: 0 },
      }
      byProject.set(projectId, it)
    }
    return it
  }
  /** The newest time of each kind of thing a client has: what "something new arrived" is measured against. */
  const seen = (it: QueueItem, kind: keyof Newest, at: number): void => {
    if (Number.isFinite(at) && at > it.newest[kind]) it.newest[kind] = at
  }

  /** The mail rows counted for the viewer: a message is counted once. */
  const counted = new Set<FeedMail>()
  /** The feed's reply time is trusted when it gives one; otherwise 24 business hours after the message arrived. */
  const replyDue = (m: FeedMail): number => (Number.isFinite(ms(m.reply_due_at)) ? ms(m.reply_due_at) : businessDeadline(ms(m.received_at), DAY))
  /** A client message waiting on our reply, on the client's item. */
  const countMail = (it: QueueItem, m: FeedMail, due: number): void => {
    counted.add(m)
    it.messages += 1
    it.dueAt = Math.min(it.dueAt, due)
    if (it.kind === 'task') it.kind = 'reply'
    it.mail.push({ at: m.received_at, sender: m.sender ?? '?', subject: m.subject ?? '', snippet: m.snippet ?? '' })
    seen(it, 'mail', ms(m.received_at))
  }
  for (const m of feed.mail ?? []) {
    if (m.reply_status !== 'unanswered' || !m.project_id || !m.project_name) continue
    if (!usable(m.project_id, m.project_name)) continue
    if (!isMine(m.project_owner_email, feed)) continue
    const due = replyDue(m)
    if (!inWindow(due)) continue
    countMail(item(m.project_id, m.project_name), m, due)
  }

  const me = typeof feed.member === 'string' ? feed.member.toLowerCase() : ''
  /** (the founder) The clients whose row is a package that waits for his OK and that a teammate sends (R2). */
  const okTheirs = new Set<string>()
  /** (the founder) The teammate who sends a stale package of the client's, where a client message waits after its drafts (R1). */
  const staleTheirs = new Map<string, string>()
  for (const d of feed.drafts ?? []) {
    // the package id goes into the kickoff and the pickup request: a lower-case uuid or nothing
    if (!usable(d.project_id, d.project_name) || !isUuid(d.package_id)) continue
    const holder = (d.picked_up_by ?? '').toLowerCase()
    const held = d.status === 'picked_up'
    const ready = d.drafts_ready ?? 0
    const unsent = d.drafts_unsent ?? ready
    // What counts: a held package with a draft not sent, or a prepared or stale one with a draft ready.
    if (held ? unsent < 1 || holder === '' : (d.status !== 'prepared' && d.status !== 'stale') || ready < 1) continue
    // (the founder) A teammate sends this package: the owner on record, set and not the viewer. ⛔ A client
    // with no owner on record is not a teammate's: it stays the founder's (R3).
    const sender = typeof d.project_owner_email === 'string' ? d.project_owner_email.toLowerCase() : ''
    const mates = founder && sender !== '' && sender !== me
    // ⛔ R1 (0.5.1): a stale package a teammate sends never puts a row on the founder's list, flagged or not
    // (Rob's 16 rows, 10-13: Mugen, ReGen, Remver and Talon were answered by hand; the owner's stale reminder
    // carries what is still open). So it is never a package that waits for his OK.
    const staleTheirsHere = mates && d.status === 'stale'
    const forOk = founder && d.flagged_for_rob === true && !staleTheirsHere
    const heldByMe = held && holder === me
    const it = item(d.project_id, d.project_name)
    const due = Number.isFinite(ms(d.covers_through)) ? businessDeadline(ms(d.covers_through), DAY) : now
    // (this pass's side of the window: not yet 3 business days past its reply time, or only what is past that)
    const inReach = older ? tooOld(due) : !tooOld(due)
    const open = (state: OpenPackage['state']): OpenPackage => ({
      id: d.package_id, state, by: state === 'held_by_other' ? holderName(holder) : '', at: held ? d.picked_up_at ?? null : null,
      unsent: held ? unsent : ready, newer: 0,
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
      if (inReach) {
        it.dueAt = Math.min(it.dueAt, due)
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
    // R1: with a client message waiting after its drafts were built, the client lists under With a teammate,
    // like any reply a teammate holds (the message is counted for him there, whoever owns the client); with
    // none, it is not listed. A message the viewer's own mail already counted is not counted twice.
    if (staleTheirsHere) {
      const after = ms(d.covers_through)
      for (const m of feed.mail ?? []) {
        if (counted.has(m) || m.project_id !== d.project_id || m.reply_status !== 'unanswered') continue
        if (Number.isFinite(after) && !(ms(m.received_at) > after)) continue
        const due = replyDue(m)
        if (inWindow(due)) countMail(it, m, due)
      }
      if (it.messages > 0) staleTheirs.set(d.project_id, holderName(sender))
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
        seen(it, 'pkg', ms(d.covers_through))
      }
    }
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
  //   R1: a stale package a teammate sends, with a client message waiting after its drafts (above).
  if (founder) {
    for (const it of byProject.values()) {
      const o = it.open ?? null
      const name =
        it.kind === 'ok'
          ? okTheirs.has(it.projectId) && it.dueAt > now ? (o?.state === 'held_by_other' ? o.by : (it.ok ?? null)?.sends) : undefined
          : it.kind === 'ready' ? undefined : staleTheirs.get(it.projectId)
      if (name) it.theirs = name
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

/** A moment as the pane writes times: `3 PM` when it is today in New York, `Fri 3 PM` when it is not. */
export function clockText(t: number, now: number): string {
  const a = etParts(t)
  return a.date === etParts(now).date ? a.time : `${a.day} ${a.time}`
}

/** What is due, in a word or two: a package the viewer picked up is `your draft`, one that waits for the founder's OK `needs your OK`. */
const whatOf = (it: QueueItem): string =>
  it.open?.state === 'held_by_me' ? 'your draft' : it.kind === 'ok' ? 'needs your OK' : it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : 'task'

/** What is due for a client and when, in words: `reply ready due tomorrow 8 AM`. */
export function dueLine(it: QueueItem, now: number): string {
  return `${whatOf(it)} ${whenText(it.dueAt, now)}`
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
  const n = span < DAY ? `${Math.min(23, Math.max(1, Math.round(span / HOUR)))}h` : `${Math.round(span / DAY)}d`
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
  const parts = [theirs ? `🟡 with ${it.theirs ?? it.open?.by ?? ''}` : `${isRed(it, now) ? '🔴' : '🟡'} ${clockLead(it.dueAt, now)}`, it.client, whatOf(it)]
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
  // what leads the name: the clock, or (in a name of the bridge's only) who holds the drafts
  const lead = /^\d+[hd] (?:late|left)$/.test(first) || (marked && parts.length > 2 && /^with \S/.test(first))
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

// ---------------------------------------------------------------- a reply draft was sent or discarded

/**
 * The team gateway's routes that end a reply draft: `sent` and `discard`, and `post-team`, which posts a
 * team draft and records it sent in the same call (client-reply-prep §9.5). Each changes what the feed
 * lists for the client.
 */
const DRAFT_ROUTE = String.raw`\/reply-draft\/(?:sent|discard|post-team)(?![\w\/-])`
/** As the gateway helper is called: `mm-api.mjs ext POST /reply-draft/sent ...`, the path quoted or not. */
const VIA_HELPER = new RegExp(String.raw`\bmm-api\.mjs["']?\s+ext\s+POST\s+["']?${DRAFT_ROUTE}`)
/** And as the route itself is called: a POST to `.../api/ext/reply-draft/sent`. */
const VIA_URL = new RegExp(String.raw`\/api\/ext${DRAFT_ROUTE}`)

/**
 * Whether a shell command is a call to one of those routes. ⛔ This is all the bridge ever looks at of a
 * command: it answers yes or no, and nothing of the command is kept, logged or passed on.
 * The route is matched, never a loose word: `revise`, `claim-send`, `rob-ok`, `release` and a GET are not it.
 */
export function isDraftDone(command: unknown): boolean {
  return typeof command === 'string' && command.length <= 200_000 && (VIA_HELPER.test(command) || (VIA_URL.test(command) && /\bPOST\b/.test(command)))
}
