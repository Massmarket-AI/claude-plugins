// Pure queue logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// What is listed (Rob, 2026-10-20: "everything since last Thursday that wasn't closed should always show up
// now, and we can keep it clean going forward"): everything still open whose due time is on or after
// LIST_FLOOR_MS (Wed 2026-10-14 12:00 AM ET), however overdue, and everything not due yet, however far ahead.
// (Until 2026-10-20 the cut was 3 business days back; Rob replaced it with LIST_FLOOR_MS.) That is:
//   - an unanswered client message (its reply is due 24 business hours after it arrived)
//   - a prepared reply package (drafts ready)
//   - a reply package the viewer picked up, with a draft not sent, like a prepared one
//   - a ticket with a date WE committed to (clients never set dates; SLA and phase dates are not promises
//     and do not list)
//   - for the founder alone: a reply package flagged for his OK, whoever owns the client (kind `ok`); one a
//     teammate sends only once its reply is due (0.5.1, R2: until then it is theirs to decide)
//     (0.7.2 to 0.7.7 also made a teammate's client the founder's own when he had sent or approved its last
//     package within 3 business days. Rob removed that on 2026-10-28: "Just because I sent the last package
//     myself shouldn't mean that I took it over." On a client handed to the team, only a package flagged for his
//     OK (R2) and a package he picks up himself are his.)
//   - (0.5.28, internal asks) an internal ask of the viewer's: a teammate's Discord message that asks them for
//     something, on the item of the client it is about (or of the internal-ops project), due 24 business hours after
//     it was asked, internal or not (kind `ask` when nothing else lists the client)
//   - (0.7.3, internal queue) the viewer's own internal-ops tickets with no committed date, in rank order, on the
//     internal-ops project's item, with no due time and no clock (kind `queue` when nothing else lists it)
// A listed client pins while what it must act by is past or within the next 24 business hours (`pinsNow`).
// Work that must start now at 1.5 h a day waits for real hour estimates (quote line items).
//
// Two more lists are built beside that one (buildLists), and neither pins or is counted: clients whose
// reply drafts a teammate holds (not the viewer's to act on), and clients whose only items were due before
// the floor (so that nothing drops off silently).
//
// Every client clock here counts business time (Rob, 2026-10-12: "the weekends don't count as days towards
// the 24-hour response time... We're only counting business days in our timelines for clients"): Saturday
// and Sunday, America/New_York, contribute zero. See ./business-time.ts.

import type { MmPerson, MmProject } from '../types'

import { businessDaysBetween, businessDeadline, businessMsBetween, subtractBusinessMs } from './business-time'

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
  /**
   * (0.7.4, ETA asks; Rob, 2026-10-27: "Team members need to provide ETAs ... They need to provide an ETA in 24 hours")
   * On a teammate's internal ticket nobody dated (`due_at` and `due_source` null): when its ETA is needed by, 24
   * business hours after it was assigned. Present only on such a row.
   */
  eta_needed_by?: string | null
  /** (0.7.4, ETA asks) OW's words for it, `⏳ NO ETA — give one in Claude Code`: present only on such a row. Never shown as given (ETA_ASK_TEXT is). */
  eta_ask?: string | null
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

/**
 * (New people, OW ticket 549944b0, spec A7) Someone who wrote to us and whom no project matched: an open row of
 * OW's `inbound_person_alerts`. OW sends these to the founder and the PMs only. `source` is `gmail_unmatched`
 * (an email) or `hl_directory` (a HighLevel Directory lead: no address). Every field but `id` and `received_at`
 * may be missing or null. Absent on a server that does not send them yet.
 */
export type FeedPersonAlert = {
  id: string
  source?: string | null
  sender_name?: string | null
  sender_email?: string | null
  company?: string | null
  subject?: string | null
  received_at: string
  due_at?: string | null
  mailboxes?: string[] | null
  warnings?: string[] | null
  relationship_summary?: string | null
  source_link?: string | null
  shadow_bootstrap_candidate?: boolean | null
}

/**
 * (0.5.28, internal asks; Rob, 2026-10-23: "i think that should also trigger a 24 hr reply not just for me but for anyone
 * asked to do something internally. it should show up in my brige thread for creg with my draft reply to him") One of
 * the caller's open internal asks: a teammate's Discord message that asks this person for something (OW's `team_asks`,
 * one row per message and person asked; the feed's `asks`, oldest due first). `project_id` is the client the message is
 * about, or the internal-ops project (INTERNAL_OPS) when it is about Massmarket itself. Its reply is due `due_at`, 24
 * business hours after it was asked, internal or not. `snippet` is the first 240 characters of the message, mentions
 * shown as @Name. Every field but the ids, the asked address and the times may be missing or null. Absent on a server
 * that does not send them yet: nothing changes.
 */
export type FeedAsk = {
  ask_id: string
  project_id: string
  project_name: string
  internal?: boolean
  asker_name?: string | null
  asker_email?: string | null
  asked_email: string
  asked_at: string
  due_at: string | null
  channel_name?: string | null
  message_link?: string | null
  snippet?: string | null
  has_draft?: boolean
  draft_sha256?: string | null
  updated_at?: string | null
}

/**
 * (0.5.28, internal asks) An open ask as a client's item keeps it: its id (a lower-case uuid: it goes into the kickoff
 * and the page request), who asked (cleaned: it goes into the kickoff), when it was asked and when its reply is due (ms),
 * its snippet (drawn, never handed to Claude), whether a reply is drafted and that draft's hash, and the link to the
 * message (https only, or '').
 */
export type AskRef = { id: string; asker: string; askedAt: number; dueAt: number; snippet: string; hasDraft: boolean; link: string; draftSha: string | null }

/**
 * (0.7.3, internal queue; Rob, 2026-10-27: "I should be assigned all those tickets. They should just be in a queue... for
 * me to just handle in that thread as I can.") One of the caller's own tickets on the internal-ops project (INTERNAL_OPS)
 * that is open or in progress and has no committed date: the feed's `tickets.internal_queue`, ranked by `queue_rank`
 * (none last), then severity (critical, high, medium, low), then when it was detected; at most 10 of them, the feed's
 * `summary.internal_queue_total` counting all. `queue_tier` and `queue_reason` are the rank's tier (a number, 1 first, as OW
 * sends it on 2026-10-28; a word is taken too) and its one-line reason. Every field but the ids, the title and the assignee
 * may be missing or null. Absent on a server that does not send them yet: nothing changes.
 */
export type FeedQueueTicket = {
  ticket_id: string
  project_id: string
  project_name: string
  title: string
  severity?: string | null
  internal?: boolean
  assignee_email?: string | null
  queue_tier?: number | string | null
  queue_rank?: number | null
  queue_reason?: string | null
}

/**
 * (0.7.3, internal queue) A queued ticket as the internal-ops item keeps it: its id (a lower-case uuid), its title, tier
 * and reason (each cleaned: they go into the kickoff), its rank (null: none) and its severity (one of the four, or '').
 */
export type QueueRef = { id: string; title: string; tier: string; reason: string; rank: number | null; severity: string }

/** (0.7.3, internal queue) The viewer's queue on the internal-ops item: the top tickets in rank order, and how many there are in all. */
export type InternalQueue = { tickets: QueueRef[]; total: number }

/** One of the feed's projects (OW's `projects`; for the founder and a PM, every active project they may see). */
export type FeedProject = { project_id: string; name: string }

/** (New people) One project OW's resolve route accepts for `route`: the feed's `route_projects` (founder and PMs, uncapped). */
export type FeedRouteProject = { id: string; name: string }

export type Feed = {
  member: string
  role: string
  mail?: FeedMail[]
  drafts?: FeedDraft[]
  /** `start_now` (0.5.2, R1): committed tickets due after the due-soon window whose start-by time has come or is within 24 business hours. */
  /**
   * (0.7.4) `undated`: for the founder alone, his own tickets on client projects that nobody dated (Rob, 2026-10-27: "All
   * of those belong to client projects ... They should be routed to the client projects"), R17's undated rows.
   */
  tickets?: { overdue?: FeedTicket[]; due_today?: FeedTicket[]; due_soon?: FeedTicket[]; start_now?: FeedTicket[]; internal_queue?: FeedQueueTicket[]; undated?: FeedTicket[] }
  /** (0.7.3, internal queue) The feed's counts: `internal_queue_total`, how many tickets the caller's internal queue holds in all. */
  summary?: { internal_queue_total?: number | null }
  threads?: FeedThread[]
  /** The feed's projects: what Route offers when the feed gives no `route_projects` (an OW before them). */
  projects?: FeedProject[]
  /** (New people) Exactly the projects OW's resolve route accepts for `route`, uncapped: what Route offers when present. */
  route_projects?: FeedRouteProject[]
  /** (New people) Open alerts, founder and PMs only. */
  person_alerts?: FeedPersonAlert[]
  /** (0.5.28, internal asks) The caller's open internal asks. Absent on a server that does not send them yet. */
  asks?: FeedAsk[]
  /**
   * (0.7.11) The newest message FROM each client on any channel (email, text, Discord, a call transcript with them), one
   * row a project, for the clients the caller has. Absent on a server that does not send it yet: the bridge then knows a
   * client's activity from the mail and packages the feed lists, and from what it saw of them before (`mm.activity`).
   */
  client_activity?: FeedActivity[]
}

/** (0.7.11) A row of the feed's `client_activity`: when the client last wrote to us, or spoke with us. */
export type FeedActivity = { project_id: string; at: string }

/**
 * The client's open reply package when it is not simply "ready for you" (Rob, 2026-10-12: a thread that
 * held the drafts was told none were prepared).
 *   held_by_me     the viewer picked it up and a draft is not sent yet
 *   held_by_other  a teammate picked it up; `by` is their name
 *   stale          drafts exist but are marked out of date, and nobody holds it; for the founder, `by` is the
 *                  teammate it is with when it is a teammate's (R1, 0.5.1), else ''
 *   prepared       drafts are ready, but the client does not pin for the viewer on them (another owner's
 *                  client, or a package due before the list's floor)
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
  /**
   * `ok`: for the founder alone, a package flagged for his OK that somebody else sends. (0.5.28, internal asks) `ask`:
   * listed by the viewer's internal asks alone (no client message, no package of theirs, no task): its title says
   * `internal ask` where a task's says `task`. A client with any of those as well keeps that kind, and its asks beside it.
   * (0.7.3, internal queue) `queue`: the internal-ops item listed by the viewer's internal queue alone: `internal queue`.
   */
  kind: 'ready' | 'reply' | 'task' | 'ok' | 'ask' | 'queue'
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
  /**
   * (0.5.28, internal asks) The viewer's open internal asks about this client, oldest due first: each one's reply is due,
   * and it pins, like a client message's, and the kickoff and the pane carry one paragraph each. Absent when there are
   * none, and on an item an older version stored: every read is `openAsks(it)`.
   */
  asks?: AskRef[]
  /**
   * (0.7.3, internal queue) The viewer's internal queue, on the internal-ops item only: never due, never a clock. The
   * kickoff, Update and the pane list it in rank order. Absent when there is none, and on an item an older version
   * stored: every read is `queuedOf(it)` and `queueTotal(it)`.
   */
  queue?: InternalQueue
  /**
   * (0.7.4, ETA asks) The viewer's own tickets on this client that owe an ETA: each is also counted in `tasks`, and is due
   * when its ETA is needed by. Absent when there are none, and on an item an older version stored: read `etaAsksOf(it)`.
   */
  etaAsks?: EtaRef[]
  /**
   * (0.7.4, for the founder alone) His teammates' internal tickets on this client that are late: past their ETA, or past
   * when their ETA was needed with none given (Rob, 2026-10-27: "it holds them accountable to that"). Never counted in
   * `tasks` and never in the kickoff: the row and the pane show them. Read `matesOf(it)`.
   */
  mates?: MateRef[]
  /**
   * (0.7.4, ETA asks) Set on an internal project's item when tickets assigned to the viewer (never the founder) list it:
   * it is shown like a client's, its row, chip and updates (`heldInternal`). Rob, 2026-10-27: "this should show up just
   * like any other client with a due date."
   */
  assigned?: true
  /** (0.7.4) How many of `tasks` are the founder's own undated client tickets (`tickets.undated`). */
  undatedTasks?: number
  /** (0.7.4) The titles of the tasks nobody dated (R17 and `tickets.undated`): the pane lists them apart from `taskTitles`, the committed ones. */
  undatedTitles?: string[]
}

/** (0.7.4, ETA asks) A ticket of the viewer's that owes an ETA: its id (a lower-case uuid), its title, and when the ETA is needed by. */
export type EtaRef = { id: string; title: string; neededBy: number }

/** (0.7.4) A teammate's late internal ticket, for the founder: whose (their name), its id, title and since when it is late; `eta` when no ETA was ever given. */
export type MateRef = { by: string; id: string; title: string; lateSince: number; eta: boolean }

/** (0.7.4, ETA asks) What a ticket that owes an ETA says, in OW's words (ETA_ASK_TEXT): the feed's own copy of it is never shown. */
export const ETA_ASK_TEXT = '⏳ NO ETA — give one in Claude Code'

/**
 * (0.5.28, internal asks; Rob, 2026-10-23: "there should be massmarket internal thread in bridge as well") Massmarket's
 * internal-ops project, "Massmarket AI": where an internal ask about Massmarket itself is listed, and the client of the
 * Massmarket internal thread.
 */
export const INTERNAL_OPS = 'e6deffc3-2713-4def-a11d-b75a1efba9c1'

/**
 * (0.5.2, R18) The projects that are internal by id, while the feed carries no internal flag: Massmarket's
 * internal-ops project and the Massmarket Core Snapshot. A feed row with `internal: true` makes any project so.
 */
export const INTERNAL_PROJECTS: ReadonlySet<string> = new Set([INTERNAL_OPS, '3e439f40-a17f-48e2-bcfe-723af5b741fc', 'e2c165f0-4020-4a4b-a2cf-19d2a653fdcc'])

/**
 * (0.7.4) Massmarket's second internal project, "Massmarket Internal - Discord Coordination" (OW #594): its tickets are
 * read as the internal-ops project's are.
 */
export const INTERNAL_DISCORD = 'e2c165f0-4020-4a4b-a2cf-19d2a653fdcc'

/** (0.7.4) The two internal projects the founder's internal queue and his teammates' ETA asks come from. */
export const INTERNAL_TICKET_PROJECTS: ReadonlySet<string> = new Set([INTERNAL_OPS, INTERNAL_DISCORD])

/** (0.5.28, internal asks) A client's open asks as its item holds them: none on an item an older version stored. */
export const openAsks = (it: Pick<QueueItem, 'asks'>): AskRef[] => (Array.isArray(it.asks) ? it.asks : [])

/** (0.7.4, ETA asks) The viewer's tickets on a client that owe an ETA, as its item holds them: none on an item an older version stored. */
export const etaAsksOf = (it: Pick<QueueItem, 'etaAsks'>): EtaRef[] => (Array.isArray(it.etaAsks) ? it.etaAsks : [])

/** (0.7.4) The founder's teammates' late internal tickets on a client, as its item holds them. */
export const matesOf = (it: Pick<QueueItem, 'mates'>): MateRef[] => (Array.isArray(it.mates) ? it.mates : [])

/** (0.7.4, ETA asks) A client listed by tickets that owe an ETA and nothing else: no client message, no package, no ask. */
export const etaOnly = (it: QueueItem): boolean =>
  etaAsksOf(it).length > 0 && etaAsksOf(it).length === it.tasks && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0

/**
 * (0.7.4) A client listed by the founder's undated client tickets alone (`tickets.undated`): nothing dated, no client
 * message, no package, no ask, no queue. Rob, 2026-10-27: "It doesn't necessarily create the need for a new reply." Its
 * thread is never updated by itself for them (`autoUpdatable`); they ride along with whatever does update it.
 */
export const undatedOnly = (it: QueueItem): boolean =>
  (it.undatedTasks ?? 0) > 0 && !hasDue(it) && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0 && queuedOf(it).length === 0

/**
 * (0.7.4) How many of a client's tasks have no date at all (R17's rows and `tickets.undated`), never more than the tasks
 * that owe no ETA: what the note, the row and the kickoff call `with no due date`, never `committed`.
 */
export const undatedCount = (it: Pick<QueueItem, 'tasks' | 'etaAsks' | 'undatedTitles'>): number =>
  Math.max(0, Math.min(Array.isArray(it.undatedTitles) ? it.undatedTitles.length : 0, it.tasks - etaAsksOf(it).length))

/** (0.7.4) The skill a kickoff loads first: massmarket-internal-ops for an internal project's tickets, else the client's. */
export const skillFor = (it: Pick<QueueItem, 'projectId'>): string =>
  INTERNAL_TICKET_PROJECTS.has(it.projectId) ? 'massmarket-internal-ops' : "the client's project skill"

/** (0.7.3, internal queue) The tickets of a client's internal queue as its item holds them, in rank order: none on any other item, or one an older version stored. */
export const queuedOf = (it: Pick<QueueItem, 'queue'>): QueueRef[] => {
  const q = it.queue ?? null
  return q && typeof q === 'object' && Array.isArray(q.tickets) ? q.tickets : []
}

/** (0.7.3, internal queue) How many tickets the internal queue holds in all: never fewer than the ones it lists. */
export const queueTotal = (it: Pick<QueueItem, 'queue'>): number => {
  const n = Number((it.queue ?? null)?.total)
  return Math.max(queuedOf(it).length, Number.isSafeInteger(n) && n > 0 ? n : 0)
}

/**
 * (0.7.3, internal queue; the coordinating thread's spec, 2026-10-27) The Massmarket internal thread's item while the
 * viewer has tickets in their internal queue: as with an open ask, it gets its row, its chip in its linked thread and its
 * thread updated by itself, with no clock. A viewer with no queue is held as before.
 */
export const internalQueueThread = (it: Pick<QueueItem, 'projectId' | 'queue'>): boolean => it.projectId === INTERNAL_OPS && queuedOf(it).length > 0

/**
 * (0.5.28, internal asks; spec 2026-10-23: "When it has an open ask it can be kicked off and chipped like a client (it
 * still is never auto-unpinned)") The Massmarket internal thread's item while it has an open ask: chipped, kicked off
 * and updated by itself as a client's is. Its pins follow R18 as before: the bridge takes off only a pin it put there.
 * (0.7.3, internal queue) Or while the viewer has an internal queue (`internalQueueThread`).
 */
export const internalAskThread = (it: Pick<QueueItem, 'projectId' | 'asks' | 'queue'>): boolean =>
  it.projectId === INTERNAL_OPS && (openAsks(it).length > 0 || internalQueueThread(it))

/**
 * (fix round 1, L8) An internal project's item, which gets no chip and no update by itself and no thread started by
 * itself: every internal one but (0.5.28, internal asks) the Massmarket internal thread's while it has an open ask
 * (`internalAskThread`), or (0.7.3) an internal queue, or (0.7.4) one listed by tickets assigned to the viewer, who is not
 * the founder (`assigned`): a teammate's internal ticket shows as a client's does (Rob, 2026-10-27). Its mail and
 * packages are read with it; an internal item with none of those tickets is held as before.
 */
export const heldInternal = (it: Pick<QueueItem, 'projectId' | 'asks' | 'internal' | 'queue' | 'assigned'>): boolean =>
  it.internal === true && !internalAskThread(it) && it.assigned !== true

/** (R17) Whether a client has a due time at all (an item stored by the bridge keeps Infinity as null). */
export const hasDue = (it: Pick<QueueItem, 'dueAt'>): boolean => typeof it.dueAt === 'number' && Number.isFinite(it.dueAt)

// ---------------------------------------------------------------- (0.7.11) active clients

/**
 * (0.7.11, Rob 2026-10-30: "I don't think we need to be creating threads for people that haven't been active or sent us
 * anything for more than a couple months ... maybe we could even say a few weeks before that") How far back a message
 * from the client keeps the client ACTIVE: six weeks, rolling. The one number to change.
 */
export const ACTIVE_WINDOW_MS = 42 * 24 * 60 * 60 * 1000

/**
 * (0.7.11) The newest message FROM each client that the feed shows, in ms: every mail row of the client (each is a message
 * the client sent us, answered or not), what each open reply package covers (the newest client message it answers), and
 * the feed's `client_activity` when OW sends it (every channel). Never our own sends, a ticket, a phase date or a
 * teammate's work.
 */
export function clientActivity(feed: Feed): Map<string, number> {
  const out = new Map<string, number>()
  const add = (pid: unknown, at: unknown): void => {
    const t = typeof at === 'string' ? ms(at) : NaN
    if (!isUuid(pid) || !Number.isFinite(t)) return
    out.set(pid, Math.max(out.get(pid) ?? 0, t))
  }
  for (const m of Array.isArray(feed.mail) ? feed.mail : []) add(m?.project_id, m?.received_at)
  for (const d of Array.isArray(feed.drafts) ? feed.drafts : []) add(d?.project_id, d?.covers_through)
  for (const a of Array.isArray(feed.client_activity) ? feed.client_activity : []) add(a?.project_id, a?.at)
  return out
}

/** (0.7.11) Something of the client's waits now: a message of theirs with no reply, or a reply package. */
export const clientWaiting = (it: QueueItem): boolean => it.messages > 0 || Boolean(it.packageId) || Boolean(it.open ?? null)

/**
 * (0.7.11) Something due for the viewer himself: a client's reply, or a dated ticket of his own. Never a teammate's
 * ticket past its ETA (`mates`, `theirs`), a ticket with no date, one that only owes an ETA, or an internal ask.
 */
export const dueForViewer = (it: QueueItem): boolean => it.messages > 0 || it.tasks - etaAsksOf(it).length - undatedCount(it) > 0

/**
 * (0.7.11) Whether a client may be offered a new thread (Start), have its thread pinned for it being active, or be
 * followed to its own thread on a profile switch: an internal project (its own rules, unchanged), a client with
 * something of theirs waiting now or a message from them in the last ACTIVE_WINDOW_MS (`lastFrom`, the newest the bridge
 * knows), or something due for the viewer. Every other client keeps its row, with no Start and no thread.
 */
export function mayStart(it: QueueItem, lastFrom: number | undefined, now: number, internal = false): boolean {
  if (internal || it.internal === true || it.kind === 'queue') return true
  return clientWaiting(it) || isRecent(lastFrom, now) || dueForViewer(it)
}

/** (0.7.11) ACTIVE: something of the client's waits now, or they wrote to us in the last ACTIVE_WINDOW_MS. */
export function isActive(it: QueueItem, lastFrom: number | undefined, now: number): boolean {
  return clientWaiting(it) || isRecent(lastFrom, now)
}

/** (0.7.11) A time inside the active window (a time ahead of now counts: a clock a little off is no reason to drop a client). */
export const isRecent = (at: number | undefined, now: number): boolean => typeof at === 'number' && Number.isFinite(at) && at > 0 && now - at <= ACTIVE_WINDOW_MS

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
 * The list's floor (Rob, 2026-10-20: "everything since last Thursday that wasn't closed should always show up
 * now, and we can keep it clean going forward"). Replaces the rolling 3-business-day cut of 2026-10-08. Anything
 * still open whose due time is on or after it stays on the Needs-you list however overdue; only what was due
 * before it goes under Older. Wed 2026-10-14 12:00 AM ET: the week the team installed the bridge.
 * (Until 2026-10-21 the floor was Thu 2026-10-15; Rob moved it to Wed 2026-10-14: "it should actually be last Wednesday".)
 */
export const LIST_FLOOR_MS = Date.parse('2026-10-14T04:00:00Z')
/**
 * The pin's window, in business time: 24 business hours ahead (`pinsNow`). A client's thread pins while
 * something of it must be acted on within them, or already should have been. (0.5.2, R1) The list itself holds
 * everything not due yet, however far ahead.
 */
export const WINDOW_AHEAD_MS = DAY
/**
 * The 2026-10-08 cut (3 business days back), kept only as the list's least reach: the floor widens the list
 * and never narrows it. From Sat 2026-10-17 12:00 AM ET on, everything due before the floor is more than 3
 * business days overdue, so this decides nothing and the floor alone is the cut; it only keeps a clock before
 * that day (the tests' fixed early-October dates) reading as it did. (Until 2026-10-20 the cut was 3 business
 * days back; Rob replaced it with LIST_FLOOR_MS.)
 */
export const WINDOW_BACK_MS = 3 * DAY
/**
 * (0.5.2, R8) How long a send waits for the server's check before the client is listed as it was: a check that
 * never lands does not keep a client off the list. Real time (it is not a client's clock).
 */
export const CHECK_WAIT_MS = 2 * HOUR
export const MAX_PINS = 8
/** The least mail look-back asked of OW, in business hours (Rob, 2026-10-13: "expanding that to 7 days"). */
export const MAIL_LOOKBACK_MIN_HOURS = 168
/** The most: OW's `mail_hours` cap from 2026-10-20 (it took 1 to 168 before). */
export const MAIL_LOOKBACK_MAX_HOURS = 720

/**
 * Business hours of mail to ask OW for: back to 24 business hours before the floor (mail due on the floor arrived then), at least 168, at most 720 (OW's cap from 2026-10-20).
 *
 * A reply is due 24 business hours after a message, so every message whose reply is due on or after the floor
 * arrived on or after `subtractBusinessMs(LIST_FLOOR_MS, DAY)` (Tue 2026-10-13 12:00 AM ET). Mail OW sends from
 * further back is read the same way, and goes under Older. The 168 (the look-back since 2026-10-13, review of
 * 79cbc596, F1) is the least: it is what this asks for until Thu 2026-10-22 12:00 AM ET, so it is safe to ship
 * before OW's 720 cap deploys; from then on it asks for more than 168, which an OW that still caps at 168
 * refuses (HTTP 400). Past 720 (from Tue 2026-11-24) mail due just after the floor starts to fall out of the
 * look-back; "keep it clean going forward" is what keeps that list short.
 */
export function mailLookbackHours(now: number): number {
  const from = subtractBusinessMs(LIST_FLOOR_MS, DAY)
  // a stretch too long to hold 720 business hours is not walked day by day (businessWithin)
  if (!businessWithin(from, now, MAIL_LOOKBACK_MAX_HOURS * HOUR)) return MAIL_LOOKBACK_MAX_HOURS
  const since = businessMsBetween(from, now)
  return Math.min(MAIL_LOOKBACK_MAX_HOURS, Math.max(MAIL_LOOKBACK_MIN_HOURS, Math.ceil(since / HOUR)))
}

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
 *   older     its only items were due before the floor, LIST_FLOOR_MS (Rob, 2026-10-12: two clients with
 *             unanswered mail from ten and six days ago were not shown at all). Never pinned, never
 *             counted. The pane lists them last, under `Older (n)`, most overdue first. (Until 2026-10-20
 *             the cut was 3 business days back; Rob replaced it with LIST_FLOOR_MS.)
 */
export type Lists = { queue: QueueItem[]; teammate: QueueItem[]; older: QueueItem[]; checking: QueueItem[] }

/**
 * A teammate holds this client's reply drafts and nothing else keeps it in the viewer's list: no committed
 * task of the viewer's own due there, and (for the founder) no package waiting for his OK. For the founder
 * too: a client whose package a teammate sends and that is theirs to see through (`theirs`, R1 and R2).
 * (0.5.28, internal asks) An open ask of the viewer's keeps the client in their list as a task of theirs does: it was
 * asked of them, whoever holds the client's drafts. (0.7.3, internal queue) So does their internal queue.
 */
export const withTeammate = (it: QueueItem): boolean =>
  it.tasks === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0 && (Boolean(it.theirs) || ((it.open ?? null)?.state === 'held_by_other' && it.kind !== 'ok'))

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
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? [], t.undated ?? []]) for (const tk of k) add(tk)
  const out = carries ? flagged : new Set(INTERNAL_PROJECTS)
  // (0.5.28, internal asks) an ask row the feed marks internal adds its project; ask rows alone never decide whether the
  // feed carries the flag (L9), so the other internal projects are read exactly as they were
  for (const a of Array.isArray(feed.asks) ? feed.asks : []) if (a && a.internal === true && isUuid(a.project_id)) out.add(a.project_id)
  // (0.7.3, internal queue) the same for the viewer's own queued tickets: additive, never deciding L9. (0.7.4) The queue
  // lists on the internal-ops item whichever internal project a ticket is on, so that item is internal too.
  for (const q of ownQueueRows(feed)) if (q.internal === true) out.add(q.project_id).add(INTERNAL_OPS)
  return out
}

/** (0.7.3, internal queue) The most queued tickets the internal-ops item lists, the kickoff carries and the pane draws: the feed's own cap. */
export const QUEUE_SHOWN_MAX = 10
/** (0.7.3, internal queue) The most characters of a queued ticket's title, as it goes into the kickoff and the pane. */
const QUEUE_TITLE_MAX = 120
/** (0.7.3, internal queue) The most characters of its one-line reason. */
const QUEUE_REASON_MAX = 140
/** (0.7.3, internal queue) The most characters of its tier. */
const QUEUE_TIER_MAX = 24
/** (0.7.3, internal queue) The severities OW gives a ticket, worst first: the order the queue falls back on after its rank. */
const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
/** (0.7.4) The most characters of a ticket's title as an ETA ask or a teammate's late ticket shows it. */
const MATE_TITLE_MAX = 120

/** (0.7.4) Whose late tickets these are, as a row names them: `Asif`, `Asif and Nayan`, `Asif and 2 more`. */
export function whoseLate(refs: readonly MateRef[]): string {
  const names = [...new Set(refs.map(r => r.by))]
  if (names.length <= 1) return names[0] ?? 'a teammate'
  return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`
}

/**
 * (0.7.3, internal queue) The viewer's own queued tickets the feed gives, each once: the row's ticket id a lower-case uuid,
 * its project the internal-ops project (INTERNAL_OPS: the only item the queue lists on) with a name left once cleaned, a
 * title left once cleaned, and its assignee the viewer (any case). ⛔ Anything else is dropped: a teammate's ticket is
 * theirs, and a viewer with no queue of their own sees no change at all.
 * (0.7.4; Rob, 2026-10-27: "Mine is the only one that should work in a queue") The founder's feed alone: any other
 * viewer's internal tickets owe an ETA and list with a due time. And either internal project's ticket
 * (INTERNAL_TICKET_PROJECTS): the queue is one list, on the internal-ops item.
 */
export function ownQueueRows(feed: Feed): FeedQueueTicket[] {
  const rows = (feed.tickets ?? {}).internal_queue
  const me = typeof feed.member === 'string' ? feed.member.toLowerCase() : ''
  if (!Array.isArray(rows) || me === '' || feed.role !== 'founder') return []
  const seen = new Set<string>()
  const out: FeedQueueTicket[] = []
  for (const q of rows) {
    if (!q || typeof q !== 'object' || !isUuid(q.ticket_id) || seen.has(q.ticket_id)) continue
    if (!INTERNAL_TICKET_PROJECTS.has(q.project_id) || cleanName(q.project_name) === '' || queueTitle(q.title) === '') continue
    if (typeof q.assignee_email !== 'string' || q.assignee_email.toLowerCase() !== me) continue
    seen.add(q.ticket_id)
    out.push(q)
  }
  return out
}

/**
 * (0.7.3, internal queue) A queued ticket's text as the kickoff and the pane write it: `; ` reads `, ` and `: ` reads
 * ` - ` first (cleanText drops both, and OW's titles and reasons use them), then cleaned, and cut with `…`.
 */
function queueText(text: unknown, max: number): string {
  const full = cleanText(typeof text === 'string' ? text.replace(/;\s+/g, ', ').replace(/:\s+/g, ' - ') : text, 2000)
  return full.length > max ? `${full.slice(0, max - 1).trimEnd()}…` : full
}

/** (0.7.3, internal queue) A text the item keeps, cleaned again before it is written anywhere: a cut keeps its `…`. */
function queueAgain(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : ''
  const cut = s.endsWith('…')
  const kept = cleanText(cut ? s.slice(0, -1) : s, max)
  return cut && kept ? `${kept}…` : kept
}

/**
 * (0.7.3, internal queue) A queued ticket's title as the kickoff and the pane write it (`queueText`), without the
 * `[internal]` tag internal tickets open with (every ticket in the queue is internal).
 */
const queueTitle = (title: unknown): string => queueText(typeof title === 'string' ? title.replace(/^\s*\[internal\]\s*/i, '') : title, QUEUE_TITLE_MAX)

/** (0.7.3, internal queue) A tier as the kickoff and the pane write it: `tier 1` for OW's number (or a word of digits), else the word, cleaned. */
export function queueTier(tier: unknown): string {
  if (typeof tier === 'number') return Number.isSafeInteger(tier) && tier >= 0 ? `tier ${tier}` : ''
  const word = cleanText(tier, QUEUE_TIER_MAX)
  return /^\d+$/.test(word) ? `tier ${word}` : word
}

/** (0.7.3, internal queue) A queued ticket as the internal-ops item keeps it (QueueRef): every text cleaned. */
function queueRefOf(q: FeedQueueTicket): QueueRef {
  const rank = typeof q.queue_rank === 'number' && Number.isFinite(q.queue_rank) ? q.queue_rank : null
  const severity = typeof q.severity === 'string' ? q.severity.toLowerCase() : ''
  return {
    id: q.ticket_id,
    title: queueTitle(q.title),
    tier: queueTier(q.queue_tier),
    reason: queueText(q.queue_reason, QUEUE_REASON_MAX),
    rank,
    severity: (SEVERITIES as readonly string[]).includes(severity) ? severity : '',
  }
}

/**
 * (0.7.3, internal queue) The queue in rank order, as the feed's contract orders it: rank first (none last), then
 * severity (worst first, none last), then the feed's own order (OW's third key, when it was detected).
 */
function byRank(list: readonly QueueRef[]): QueueRef[] {
  const sev = (s: string): number => {
    const i = (SEVERITIES as readonly string[]).indexOf(s)
    return i < 0 ? SEVERITIES.length : i
  }
  return list
    .map((q, i) => ({ q, i }))
    .sort((a, b) => (a.q.rank ?? Infinity) - (b.q.rank ?? Infinity) || sev(a.q.severity) - sev(b.q.severity) || a.i - b.i)
    .map(x => x.q)
}

/** Every client's newest `last_outbound_at`, from every row of it the feed gives one on, in ms. */
function lastOutbound(feed: Feed): Map<string, number> {
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
 * with a draft not sent. (0.5.28, internal asks) Or an open internal ask of theirs, as a task.
 */
export function fastState(it: QueueItem, now: number): Fast | null {
  if (it.kind === 'ok') return null
  const fast = fastOf(it.check ?? null, Number(it.lastOut) || 0, now)
  if (fast?.state !== 'checking') return fast
  const o = it.open ?? null
  const newerMail = (Number(it.newest?.mail) || 0) > fast.at
  if (newerMail || it.tasks > 0 || openAsks(it).length > 0 || queuedOf(it).length > 0 || (o?.state === 'held_by_me' && o.unsent > 0)) return null
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
  // (0.7.4) and the founder's undated ones (`tickets.undated`)
  for (const k of [t.overdue ?? [], t.due_today ?? [], t.due_soon ?? [], t.start_now ?? [], t.undated ?? []]) for (const tk of k) add(tk?.project_id, tk?.project_name)
  // (0.5.28, internal asks) and the project of each of the caller's asks: the Massmarket internal thread's among them
  for (const a of Array.isArray(feed.asks) ? feed.asks : []) add(a?.project_id, a?.project_name)
  // (0.7.3, internal queue) and the internal-ops project when the viewer has a queue there: `/mm link Massmarket AI`
  const home = queueHome(feed)
  if (home) add(home.projectId, home.projectName)
  return [...out.values()]
}

/**
 * (0.7.4, internal queue) Where the founder's internal queue lists: the internal-ops item (INTERNAL_OPS), whichever
 * internal project its tickets are on, named as the feed names that project ("Massmarket AI"; that name when no queued
 * ticket is on it). Null when he has no queue.
 */
export function queueHome(feed: Feed): { projectId: string; projectName: string } | null {
  const rows = ownQueueRows(feed)
  if (!rows.length) return null
  const named = rows.find(q => q.project_id === INTERNAL_OPS)
  return { projectId: INTERNAL_OPS, projectName: named ? named.project_name : 'Massmarket AI' }
}

// ---------------------------------------------------------------- New people (OW ticket 549944b0)
// Someone wrote to us and no project matched (a real RFP sat unseen for four business days, 2026-10-16). OW lists
// each open one in the feed's `person_alerts`, for the founder and the PMs; the pane shows them under `New
// people`, newest first, each with Route to project, Start project and Not client mail; a HighLevel Directory lead with
// Mark handled and Not client mail (register.tsx).
// ⛔ The pane alone shows them: nothing of theirs goes into a thread's name, a kickoff, a note, the band or an
//    answer to the `mm` tool. Their text is a stranger's, so it is drawn as text and never handed to Claude.

/** (New people) The roles OW sends `person_alerts` to: the founder (Rob) and the PMs. Nobody else is shown any. */
export const seesPeople = (feed: Pick<Feed, 'role'>): boolean => feed.role === 'founder' || feed.role === 'pm'

/** (New people) The words for each warning OW puts on an alert (spec A5's labels). A code not here is not shown. */
export const WARNING_LABELS: Readonly<Record<string, string>> = {
  blank_body: 'blank body',
  bcc_only: "Bcc'd",
  attachment_only: 'attachment only',
  spam_label: 'Gmail marked a copy spam',
  dmarc_fail: 'sender authentication failed',
}

/**
 * Text of a stranger's as the pane draws it: control and format characters (line breaks, bidirectional
 * overrides, zero-width marks) become spaces, runs of spaces collapse, and it is cut at `max` with an ellipsis.
 * Lighter than `cleanText` because it is only ever drawn, never handed to Claude: a subject keeps its `:` and `?`.
 */
export function shownText(text: unknown, max: number): string {
  const one = (typeof text === 'string' ? text : '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1).trim()}…` : one
}

/**
 * A link the pane may draw as `Source`: https only, no spaces, no user name or password before the host, at most
 * 2,048 characters (what a Link may carry). An `@` after the host is written `%40`: a surface draws a link whose
 * address holds a raw `@` as plain text (the engine, 2.1.304), and OW's Gmail links name the mailbox in the path
 * (`/mail/u/<mailbox>/#all/<id>`).
 */
export function sourceLink(link: unknown): string {
  if (typeof link !== 'string' || /\s/.test(link)) return ''
  try {
    const url = new URL(link)
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    // (with no user name or password, the address as URL writes it starts with its origin)
    const safe = url.origin + url.href.slice(url.origin.length).replace(/@/g, '%40')
    return url.href.startsWith(url.origin) && safe.length <= 2048 ? safe : ''
  } catch {
    return ''
  }
}

/** `Fri Oct 16, 9:12 AM` in New York. */
export function dateText(t: number): string {
  try {
    const d = new Date(t)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(d)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d)
    return `${day.replace(',', '')}, ${time}`
  } catch {
    // No Intl time zones: Eastern daylight time, as etParts
    const d = new Date(t - 4 * HOUR)
    const h = d.getUTCHours()
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? ''
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] ?? ''
    return `${day} ${month} ${d.getUTCDate()}, ${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`
  }
}

/** How long someone has waited, in whole business days completed (weekends do not count), as the row says it. */
export function waitedText(receivedAt: number, now: number): string {
  if (!Number.isFinite(receivedAt)) return ''
  const n = businessDaysBetween(receivedAt, now)
  return n < 1 ? 'under 1 business day waiting' : `${n} business day${n === 1 ? '' : 's'} waiting`
}

/**
 * (New people) The feed's open alerts as the pane's rows, newest first: for the founder and a PM only, and none
 * from a feed that has no `person_alerts` (an OW that does not send them yet). An alert whose id is not a
 * lower-case uuid is dropped: the id is what a press sends back to OW. One whose time cannot be read is kept, last.
 * The row is worded at `now`, the sync's own moment.
 */
export function peopleRows(feed: Feed, now: number): MmPerson[] {
  if (!seesPeople(feed) || !Array.isArray(feed.person_alerts)) return []
  const seen = new Set<string>()
  const rows: Array<{ at: number; row: MmPerson }> = []
  for (const a of feed.person_alerts) {
    if (!a || typeof a !== 'object' || !isUuid(a.id) || seen.has(a.id)) continue
    seen.add(a.id)
    const at = ms(a.received_at)
    const directory = a.source === 'hl_directory'
    const name = shownText(a.sender_name, 80) || shownText(a.sender_email, 120) || 'Unknown sender'
    const company = shownText(a.company, 80)
    const title = [name, company, directory ? 'via HighLevel Directory' : ''].filter(Boolean).join(' · ')
    const subject = shownText(a.subject, 160)
    const warnings = (Array.isArray(a.warnings) ? a.warnings : []).map(w => (typeof w === 'string' ? WARNING_LABELS[w] : undefined)).filter((w, i, all): w is string => Boolean(w) && all.indexOf(w) === i)
    const known = shownText(a.relationship_summary, 160)
    const when = Number.isFinite(at) ? `Received ${dateText(at)} ET · ${waitedText(at, now)}` : 'Received at a time the feed did not give'
    const row: MmPerson = {
      id: a.id, name, title, subject: subject ? `Subject: ${subject}` : '(no subject)', when, warnings, known: known ? `We know them: ${known}` : '', link: sourceLink(a.source_link),
      // (a Directory lead has no email: OW refuses route and bootstrap for it, so its row offers Mark handled and Not client mail only)
      ...(directory ? { directory: true as const } : {}),
    }
    rows.push({ at: Number.isFinite(at) ? at : -Infinity, row })
  }
  return rows.sort((x, y) => y.at - x.at).map(r => r.row)
}

/**
 * (New people) The projects a person may route someone to, by name: the feed's `route_projects` when it gives them
 * (exactly the projects OW's resolve route accepts, uncapped), every one of them; else, from an OW before them, its
 * `projects` (for the founder and a PM, every active project they may see). Uuids and names with something left once
 * cleaned. None for anyone else.
 */
export function routeChoices(feed: Feed): MmProject[] {
  if (!seesPeople(feed)) return []
  const rows: Array<{ id: unknown; name: unknown }> = Array.isArray(feed.route_projects)
    ? feed.route_projects.map(p => ({ id: p?.id, name: p?.name }))
    : Array.isArray(feed.projects) ? feed.projects.map(p => ({ id: p?.project_id, name: p?.name })) : []
  const out = new Map<string, MmProject>()
  for (const p of rows) {
    if (!isUuid(p.id) || out.has(p.id) || cleanName(p.name) === '') continue
    out.set(p.id, { projectId: p.id, name: cleanName(p.name) })
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * (New people) The most projects one page of the Route picker lists. The engine (2.1.304) refuses a whole pane whose
 * Select holds more than 64 options, and a founder's or PM's feed can offer more projects than that (150 and up), so
 * the picker shows them a page at a time: `Choose a project`, at most this many projects, and an option to each
 * neighbouring page. Every project is on some page.
 */
export const ROUTE_PAGE = 50

/**
 * (New people) One page of the Route picker, by name as `routeChoices` sorts them: its projects, where it starts, and
 * the projects of the page before and after it (null when there is none). A page past the ends is the nearest one.
 */
export function routePage(projects: readonly MmProject[], page: number): { page: number; pages: number; from: number; items: MmProject[]; prev: MmProject[] | null; next: MmProject[] | null } {
  const pages = Math.max(1, Math.ceil(projects.length / ROUTE_PAGE))
  const at = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0))
  const slice = (n: number): MmProject[] => projects.slice(n * ROUTE_PAGE, (n + 1) * ROUTE_PAGE)
  return { page: at, pages, from: at * ROUTE_PAGE, items: slice(at), prev: at > 0 ? slice(at - 1) : null, next: at < pages - 1 ? slice(at + 1) : null }
}

/**
 * (New people) The notice after a Route OW answered 200, by its `requeued_count` (how many of the person's emails it
 * filed to the project). A count the answer does not give (an OW before it): the project alone.
 */
export function routedText(project: string, requeued: unknown): string {
  const n = typeof requeued === 'number' && Number.isInteger(requeued) && requeued >= 0 ? requeued : null
  if (n === null) return `Routed to ${project}.`
  return n === 0 ? `Routed to ${project}. No emails were filed, they may already be on it.` : `Routed to ${project}. ${n} email${n === 1 ? '' : 's'} filed.`
}

// ---------------------------------------------------------------- (0.5.28) internal asks

/** (0.5.28, internal asks) The most characters of an ask's snippet the pane draws: the feed's own cut (240). */
const ASK_SNIPPET_MAX = 240
/** (0.5.28, internal asks) The most characters of an asker's name, as it goes into the kickoff and the pane. */
const ASKER_MAX = 40
/** A draft's sha256, as OW gives it: 64 lower-case hex characters. */
const SHA256 = /^[0-9a-f]{64}$/

/**
 * (0.5.28, internal asks) Who asked, as the kickoff and the pane name them: the feed's name for them, cleaned (it goes
 * into a message Claude reads), else the part of their address before the @ (`holderName`, 'a teammate' with none).
 */
export const askerName = (name: unknown, email: unknown): string => cleanText(name, ASKER_MAX) || holderName(email)

/** (0.5.28, internal asks) An ask of the feed's as its client's item keeps it (AskRef): every text cleaned or checked. */
function askRefOf(a: FeedAsk, askedAt: number, dueAt: number): AskRef {
  return {
    id: a.ask_id,
    asker: askerName(a.asker_name, a.asker_email),
    askedAt: Number.isFinite(askedAt) ? askedAt : 0,
    dueAt,
    snippet: shownText(a.snippet, ASK_SNIPPET_MAX),
    hasDraft: a.has_draft === true,
    link: sourceLink(a.message_link),
    draftSha: typeof a.draft_sha256 === 'string' && SHA256.test(a.draft_sha256) ? a.draft_sha256 : null,
  }
}

/** (0.5.28, internal asks) An open ask's line in the pane (spec, 2026-10-23): `Ask from Shezan · due Mon 3:11 PM`. */
export const askLine = (a: Pick<AskRef, 'asker' | 'dueAt'>, now: number): string => `Ask from ${a.asker} · due ${clockText(a.dueAt, now)}`

/**
 * (0.5.28, internal asks) A client's open asks in its part of the pane: each one's line and snippet, and under them the
 * ask's page (`/team-ask?id=<id>&format=pickup`) when it was read (`pages`, by ask id). '' for a client with none. A
 * page that could not be read leaves the line and the snippet alone: never an error in its place.
 */
export function asksMarkdown(it: Pick<QueueItem, 'asks'>, now: number, pages: Readonly<Record<string, string>> = {}): string {
  const asks = openAsks(it).filter(a => isUuid(a?.id) && Number.isFinite(a?.dueAt))
  if (!asks.length) return ''
  const out = [`### Internal asks (${asks.length})`]
  for (const a of asks) {
    out.push('', `- ${askLine({ asker: cleanText(a.asker, ASKER_MAX) || 'a teammate', dueAt: a.dueAt }, now)}`)
    const snippet = shownText(a.snippet, ASK_SNIPPET_MAX)
    if (snippet) out.push(`  > ${snippet}`)
    const page = typeof pages[a.id] === 'string' ? (pages[a.id] as string).trim() : ''
    if (page) out.push('', page)
  }
  return out.join('\n')
}

/**
 * One pass over the feed. `older` false: everything still open that was due on or after the floor
 * (LIST_FLOOR_MS), however overdue, and everything not due yet, however far ahead. `older` true: only what was
 * due before the floor, by the same rules of whose it is. (Until 2026-10-20 the cut was 3 business days back;
 * Rob replaced it with LIST_FLOOR_MS.)
 */
function build(feed: Feed, now: number, older: boolean): QueueItem[] {
  // Under Older: due before the floor, and more than 3 business days ago (WINDOW_BACK_MS: from Sat 2026-10-17
  // 12:00 AM ET on, everything due before the floor is, so the floor alone decides)
  const tooOld = (due: number): boolean => due < now && due < LIST_FLOOR_MS && !businessWithin(due, now, WINDOW_BACK_MS)
  // (0.5.2, R1) everything else with a due time is the current pass's: overdue since the floor, or not due yet
  // however far ahead; whether it pins is `pinsNow`
  const inWindow = (due: number): boolean => Number.isFinite(due) && (older ? tooOld(due) : !tooOld(due))
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
   * waiting after its drafts, on this pass's side of the floor. Counted only for the client's place under With
   * a teammate, once nothing else of the founder's lists the client (below).
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
    // (Rob's 16 rows, 10-13: four such clients were answered by hand; the owner's stale reminder
    // carries what is still open). So it is never a package that waits for his OK. (A stale package is held
    // by nobody: it is the owner's on record.)
    const staleTheirsHere = mates && d.status === 'stale'
    const forOk = founder && d.flagged_for_rob === true && !staleTheirsHere
    const heldByMe = held && holder === me
    const it = item(d.project_id, d.project_name)
    // (R17, R18) no reply time for a package the feed gives none, or on an internal project: Infinity
    const noDue = d.due_at === null || internal.has(d.project_id)
    const due = noDue ? Infinity : typeof d.due_at === 'string' && Number.isFinite(ms(d.due_at)) ? ms(d.due_at) : Number.isFinite(ms(d.covers_through)) ? businessDeadline(ms(d.covers_through), DAY) : now
    // (this pass's side of the floor: its reply time on or after LIST_FLOOR_MS, or only what was due before it)
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
  /** (0.7.4) The founder's teammates' late internal tickets, by project: the rows of With a teammate for them. */
  const lateMates = new Map<string, { name: string; refs: MateRef[] }>()
  // (0.7.4) `undated` too: the founder's own client tickets nobody dated (R17's rows; Rob, 2026-10-27: "They should be
  // routed to the client projects ... It doesn't necessarily create the need for a new reply")
  const lists: [FeedTicket[] | undefined, '' | 'undated'][] = [[t.overdue, ''], [t.due_today, ''], [t.due_soon, ''], [t.start_now, ''], [t.undated, 'undated']]
  for (const [list, k] of lists) {
    for (const tk of list ?? []) {
      // (R17) a ticket with no due time (internal work nobody dated) has no due source either: it lists, undated
      const undatedRow = tk.due_at === null
      if (tk.due_source !== 'commitment' && !(undatedRow && (tk.due_source === null || tk.due_source === undefined))) continue
      if (!usable(tk.project_id, tk.project_name)) continue
      // (0.7.4, ETA asks) an undated ticket that owes an ETA is due when the ETA is needed by: 24 business hours after
      // it was assigned (OW's clock). It lists with that clock and is late past it, as any dated task is (Rob,
      // 2026-10-27: "this should show up just like any other client with a due date"). Never one of `undated`.
      const neededBy = undatedRow && k !== 'undated' ? ms(tk.eta_needed_by) : NaN
      const etaAsk = Number.isFinite(neededBy)
      const assignee = (tk.assignee_email ?? '').toLowerCase()
      if (assignee !== feed.member.toLowerCase()) {
        // (0.7.4; Rob, 2026-10-27: "it holds them accountable to that") For the founder alone, a teammate's internal
        // ticket that is late reaches him: past its ETA, or past when the ETA was needed with none given. On his feed OW
        // lists every teammate's internal ticket (an ETA ask, or a commitment item on an internal project). It counts
        // nothing of his and goes in no kickoff: the client's row and pane say whose it is.
        const due = etaAsk ? neededBy : ms(tk.due_at)
        const internalRow = etaAsk || INTERNAL_TICKET_PROJECTS.has(tk.project_id) || tk.internal === true
        if (!founder || assignee === '' || !internalRow || !isUuid(tk.ticket_id) || !(due < now) || !inWindow(due)) continue
        const title = cleanText(tk.title, MATE_TITLE_MAX)
        if (!title) continue
        const late = lateMates.get(tk.project_id) ?? { name: tk.project_name, refs: [] }
        if (!late.refs.some(r => r.id === tk.ticket_id)) late.refs.push({ by: holderName(assignee), id: tk.ticket_id, title, lateSince: due, eta: etaAsk })
        lateMates.set(tk.project_id, late)
        continue
      }
      // a ticket is in one of the feed's lists only; counted once whatever a feed sends
      if (typeof tk.ticket_id === 'string' && counting.has(tk.ticket_id)) continue
      const due = etaAsk ? neededBy : undatedRow ? Infinity : ms(tk.due_at)
      if (undatedRow && !etaAsk ? older : !inWindow(due)) continue
      // (0.7.4, ETA asks) the ticket id goes into the kickoff, for its ETA to be recorded against: a lower-case uuid
      if (etaAsk && !isUuid(tk.ticket_id)) continue
      if (typeof tk.ticket_id === 'string') counting.add(tk.ticket_id)
      const it = item(tk.project_id, tk.project_name)
      it.tasks += 1
      it.dueAt = Math.min(it.dueAt, due)
      // R1: a task acts by its start-by time when the feed gives one (OW's `start_by_at`, from the ticket's
      // estimate), else by its due time
      const startBy = ms(tk.start_by_at)
      act(it, Number.isFinite(startBy) && startBy < due ? startBy : due)
      if (undatedRow && !etaAsk) undated(it)
      if (k === 'undated') it.undatedTasks = (it.undatedTasks ?? 0) + 1
      if (etaAsk) it.etaAsks = [...etaAsksOf(it), { id: tk.ticket_id, title: cleanText(tk.title, MATE_TITLE_MAX) || 'Untitled ticket', neededBy }].sort((a, b) => a.neededBy - b.neededBy)
      // (0.7.4, ETA asks) a ticket of a teammate's own on an internal project: the item is theirs to work as a client's
      if (!founder && internal.has(tk.project_id)) it.assigned = true
      // the pane lists each task under what it is: a committed date, an ETA owed (`etaAsks`), or no date at all
      if (undatedRow && !etaAsk) it.undatedTitles = [...(it.undatedTitles ?? []), tk.title]
      else if (!etaAsk) it.taskTitles.push(tk.title)
      seen(it, 'task', Number.isFinite(ms(tk.created_at)) ? ms(tk.created_at) : due)
    }
  }

  // (0.5.28, internal asks; Rob, 2026-10-23: "it should route to whatever client bridge thread the question relates to,
  // if internal, ... there should be massmarket internal thread in bridge as well") Each of the viewer's open asks lists
  // on its project's item: a client's, or the internal-ops project's (INTERNAL_OPS). Its reply is due at its `due_at`
  // (24 business hours after it was asked, OW's clock; with none given, the same counted here), and that is what the
  // client acts by, so it pins on R1's rule. ⛔ An internal project's ask KEEPS its clock (R17's no-clock rule is for
  // mail, packages and tickets). ⛔ Only an ask of the viewer's own (`asked_email`, any case): one a teammate was asked
  // is theirs. ⛔ The ask id goes into the kickoff and the page request: a lower-case uuid, or the row is dropped, as a
  // package's is; the project, as any row's (`usable`). An ask alone makes no package. Its time counts as a task's for
  // "something new arrived" (`newest.task`): it is work the person was asked for.
  const askIds = new Set<string>()
  for (const a of Array.isArray(feed.asks) ? feed.asks : []) {
    if (!a || typeof a !== 'object' || !isUuid(a.ask_id) || askIds.has(a.ask_id)) continue
    if (!usable(a.project_id, a.project_name)) continue
    if (me === '' || typeof a.asked_email !== 'string' || a.asked_email.toLowerCase() !== me) continue
    const asked = ms(a.asked_at)
    const due = Number.isFinite(ms(a.due_at)) ? ms(a.due_at as string) : Number.isFinite(asked) ? businessDeadline(asked, DAY) : NaN
    if (!inWindow(due)) continue
    askIds.add(a.ask_id)
    const it = item(a.project_id, a.project_name)
    it.dueAt = Math.min(it.dueAt, due)
    act(it, due)
    // listed by its asks alone: what its title and chip call it (a client message, a package or a task keeps its own)
    if (it.kind === 'task' && it.tasks === 0) it.kind = 'ask'
    it.asks = [...openAsks(it), askRefOf(a, asked, due)].sort((x, y) => x.dueAt - y.dueAt)
    seen(it, 'task', Number.isFinite(asked) ? asked : due)
  }

  // (0.7.3, internal queue; Rob, 2026-10-27: "I should be assigned all those tickets. They should just be in a queue...
  // for me to just handle in that thread as I can.") The viewer's own queued tickets (`ownQueueRows`: on the internal-ops
  // project, assigned to them) list on the internal-ops item, in rank order, at most QUEUE_SHOWN_MAX, with the feed's
  // total. ⛔ No due time and no clock (Rob, 10-13; R17): the item is marked undated and its due time is untouched, so it
  // lists in the current pass only, last, and never pins by the queue. ⛔ A queued ticket is not a committed task: it is
  // never counted in `tasks`, and one the feed also lists with a date is counted there alone. A viewer with no queue
  // of their own: nothing here at all.
  // (0.7.4) The founder's alone, on the internal-ops item whichever internal project a ticket is on (`queueHome`).
  const queued = older ? [] : ownQueueRows(feed).filter(q => !counting.has(q.ticket_id))
  const home = queueHome(feed)
  if (queued.length && home) {
    const it = item(home.projectId, home.projectName)
    undated(it)
    // listed by its queue alone: what its title and chip call it (anything else of its keeps its own kind)
    if (it.kind === 'task' && it.tasks === 0 && openAsks(it).length === 0) it.kind = 'queue'
    const shown = byRank(queued.map(queueRefOf)).slice(0, QUEUE_SHOWN_MAX)
    // the feed's total, a whole number, never fewer than the tickets it listed
    const total = (feed.summary ?? null)?.internal_queue_total
    it.queue = { tickets: shown, total: Math.max(queued.length, typeof total === 'number' && Number.isSafeInteger(total) && total > 0 ? total : 0) }
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
  //       (0.5.28, internal asks) An ask of his is his own too: its kind `ask` is not `task`, and an ask is never counted as a message.
  if (founder) {
    for (const [pid, waiting] of staleMail) {
      const it = byProject.get(pid)
      if (!it || it.tasks > 0 || it.messages > 0 || it.kind !== 'task' || openAsks(it).length > 0 || it.packageId) continue
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

  // (0.7.4, for the founder) His teammates' late internal tickets, on their clients' items. Where nothing of his own lists
  // the client, it lists under With a teammate, named for whose they are (`theirs`) and due when the first went late:
  // never pinned, never counted. Where something of his does, his row is for that (B1), and they ride along on its row
  // and its pane only. A client whose drafts a teammate holds keeps who holds them.
  for (const [pid, late] of lateMates) {
    const own = byProject.get(pid)
    const it = own ?? item(pid, late.name)
    const refs = late.refs.sort((a, b) => a.lateSince - b.lateSince)
    it.mates = refs
    const first = refs[0]
    const nothingOwn = it.kind === 'task' && it.tasks === 0 && it.messages === 0 && !it.packageId && !it.open && openAsks(it).length === 0 && queuedOf(it).length === 0
    if (first && nothingOwn && !it.theirs) {
      it.dueAt = Math.min(it.dueAt, first.lateSince)
      it.theirs = whoseLate(refs)
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
 * <teammate> decides` (R2). (0.5.28) A client listed by the viewer's internal asks alone: `internal ask`. (0.7.3) The
 * internal-ops item listed by the viewer's internal queue alone: `internal queue`. (0.7.4) A client whose only tasks owe
 * an ETA: `ETA needed`; for the founder, a client listed by a teammate's late tickets alone: `no ETA` while one of them
 * never had an ETA, else `past ETA`.
 */
const whatOf = (it: QueueItem): string =>
  it.open?.state === 'held_by_me'
    ? 'your draft'
    : it.kind === 'ok' ? (it.theirs ? decidesText(it.theirs) : 'needs your OK') : it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : it.kind === 'ask' ? 'internal ask' : it.kind === 'queue' ? 'internal queue' : taskWhat(it)

/** (0.7.4) What a `task` item is due for: see whatOf. */
function taskWhat(it: QueueItem): string {
  const asks = etaAsksOf(it).length
  if (asks > 0 && asks === it.tasks) return 'ETA needed'
  const mates = matesOf(it)
  if (it.tasks === 0 && mates.length) return mates.some(m => m.eta) ? 'no ETA' : 'past ETA'
  return 'task'
}

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
 * The business-time distance to a due instant, as a thread's name leads with it: `<1h late`, `5h late`, `3d late`,
 * `3h left`, `2d left`. Hours under 24 business hours, whole business days from there. Weekends do not count.
 */
export function clockLead(due: number, now: number): string {
  const late = due < now
  const span = late ? businessMsBetween(due, now) : businessMsBetween(now, due)
  // (0.5.14) under an hour: `<1h`, so a reply 13 minutes late does not read as an hour late (it read `1h`)
  // under a business day: 1 to 23 hours (59 minutes short of a day is 23h, not 24h); from there, whole days
  // R16 (0.5.2): whole business days COMPLETED (Math.floor): 1.49 and 1.51 days both read `1d`, 2.0 reads `2d`
  const n = span < HOUR ? '<1h' : span < DAY ? `${Math.min(23, Math.round(span / HOUR))}h` : `${Math.floor(span / DAY)}d`
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
 * (0.7.5, the panel redesign; Rob, 2026-10-27: "queue first, one merged time list, plain numbers") A row of the pane in
 * ONE line: the chip, the client, what is needed, then the time left: `🔴 ReGen Society · your OK · 1d late`, and after
 * it what else the thread's name says (`3 new`, `with <Name>`, `flagged`). A client whose drafts a teammate holds and
 * that is not the viewer's: no clock, `with <Name>`. Nothing due: no clock (R17). `fresh`: the client has no thread at
 * all (` · no thread` last), red when it pins now (R4).
 */
export function rowLine(it: QueueItem, now: number, opts: { fresh?: boolean; pins?: boolean } = {}): string {
  const theirs = withTeammate(it)
  const due = !theirs && hasDue(it)
  const what = whatOf(it)
  const red = opts.pins === true || (due && isRed(it, now))
  const parts = [`${red ? '🔴' : '🟡'} ${it.client}`, what === 'needs your OK' ? 'your OK' : what]
  if (due) parts.push(clockLead(it.dueAt, now))
  if (it.messages > 1) parts.push(`${it.messages} new`)
  if (theirs) parts.push(`with ${it.theirs ?? it.open?.by ?? ''}`)
  else if (it.open?.state === 'held_by_other') parts.push(`with ${it.open.by}`)
  if (it.flagged) parts.push('flagged')
  if (opts.fresh) parts.push('no thread')
  return parts.join(' · ')
}

/**
 * (0.7.5) Whether a client of the viewer's own list is drawn under `Needs you now`: not one listed by the internal queue
 * alone (its own part, `Your build queue`), and not one listed by undated tickets alone (`No due date`, under the list).
 */
export const needsYouNow = (it: QueueItem): boolean => it.kind !== 'queue' && !undatedOnly(it)

/**
 * For a client whose drafts a teammate holds: who has them, how many are not sent, and to ask before
 * writing a second reply (0.4.1's own sentence, as the client's pane ends with it). '' for any other client.
 */
export function holdSentence(it: QueueItem): string {
  if ((it.open ?? null)?.state === 'held_by_other') return draftsLine(it).replace(/^_|_$/g, '')
  // (0.7.4, for the founder) a client listed by a teammate's late internal tickets alone: whose, and what is late
  return it.tasks === 0 && it.theirs ? lateSentence(matesOf(it)) : ''
}

/** (0.7.4) `Asif owes an ETA on 2 internal tickets`, `Asif is past the ETA on 1 internal ticket`, or with both, `Asif: 3 internal tickets late, 2 with no ETA`. */
export function lateSentence(refs: readonly MateRef[]): string {
  const n = refs.length
  if (!n) return ''
  const who = whoseLate(refs)
  const tickets = `${n} internal ticket${n === 1 ? '' : 's'}`
  const noEta = refs.filter(r => r.eta).length
  const owes = new Set(refs.map(r => r.by)).size > 1 ? 'owe' : 'owes'
  const is = new Set(refs.map(r => r.by)).size > 1 ? 'are' : 'is'
  return noEta === n ? `${who} ${owes} an ETA on ${tickets}` : noEta === 0 ? `${who} ${is} past the ETA on ${tickets}` : `${who}: ${tickets} late, ${noEta} with no ETA`
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
  const lead = /^(?:<1h|\d+[hd]) (?:late|left)$/.test(first) || (marked && parts.length > 2 && /^with \S/.test(first)) || (marked && first === 'NO THREAD')
  return lead ? (parts[1]?.trim() ?? '') : first
}

/** (0.5.5) A version as plugin.json states one: three whole numbers. Anything else (`0.6`, `latest`, `1.0.0-beta`) is no version here. */
const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/
export const isVersion = (v: unknown): v is string => typeof v === 'string' && SEMVER.test(v)

/** (0.5.5) Whether `a` is a later version than `b`, by number, part by part (never by string: `0.10.0` is later than `0.9.0`). A malformed `a` never is. */
export function isNewerVersion(a: unknown, b: unknown): boolean {
  const x = typeof a === 'string' ? SEMVER.exec(a) : null
  if (!x) return false
  const y = typeof b === 'string' ? SEMVER.exec(b) : null
  if (!y) return true
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i])
    if (d !== 0) return d > 0
  }
  return false
}

/** (0.5.4) The most characters of a thread's own name the band gives. */
const SHORT_TITLE_MAX = 40

/**
 * (0.5.4, C2/C3) A thread's name as the band gives it: for a name of the bridge's, the client it is for (its clock
 * changes by the hour); for any other, the name itself, cleaned and cut to SHORT_TITLE_MAX characters.
 */
export function threadTitleShort(title: unknown): string {
  const raw = typeof title === 'string' ? title : ''
  // (our marks, read before the name is cleaned: cleaning takes them off)
  if (/^(?:\d{2}\s+)?[🔴🟡✓]\s/u.test(raw)) {
    const client = cleanName(clientInTitle(raw))
    if (client) return client
  }
  const t = cleanTitle(raw)
  return t.length > SHORT_TITLE_MAX ? `${t.slice(0, SHORT_TITLE_MAX - 1)}…` : t
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

/**
 * What the bridge's note tells Claude about a client's reply drafts and what is waiting. `member` is the viewer's address.
 * (0.5.28, internal asks) With an open ask of the viewer's, one sentence more: how many, their short ids, and that the
 * pane lists them (the kickoff and Update carry what to do with each).
 */
export function noteText(it: QueueItem, member: string): string {
  const asks = openAsks(it).filter(a => isUuid(a?.id))
  const more = asks.length ? ` ${asks.length} internal ask${asks.length === 1 ? '' : 's'} from the team wait${asks.length === 1 ? 's' : ''} on ${holderName(member)}'s reply (ask ${asks.map(a => a.id.slice(0, 8)).join(', ')}); the side pane lists ${asks.length === 1 ? 'it' : 'them'}.` : ''
  // (0.7.3, internal queue) and, with an internal queue, how many tickets it holds: never a due time
  const shown = shownQueue(it).length
  const total = queueTotal(it)
  const queue = shown ? ` ${holderName(member)}'s internal queue holds ${total} ticket${total === 1 ? '' : 's'}, with no due dates; the side pane lists the top ${shown} in rank order.` : ''
  // (0.7.4, ETA asks) and the tickets that owe an ETA: which, so it can be recorded against each
  const eta = etaAsksOf(it).filter(a => isUuid(a?.id))
  const etas = eta.length ? ` ${eta.length} ticket${eta.length === 1 ? '' : 's'} of ${holderName(member)}'s need${eta.length === 1 ? 's' : ''} an ETA (ticket ${eta.map(a => a.id.slice(0, 8)).join(', ')}): record each as task-chip-flow §5.3 says, with task_fingerprint "ticket:<id>".` : ''
  // (0.7.4, for the founder) and his teammates' late internal tickets: whose, never his to do
  const late = lateSentence(matesOf(it))
  const mates = late ? ` ${late} (late); the side pane lists them. They are the teammate's to answer, not ${holderName(member)}'s.` : ''
  return `${noteBody(it, member)}${more}${queue}${etas}${mates}`
}

/** (0.7.3, internal queue) The queued tickets an item lists, each checked again (an item an older version stored, or a store edited by hand, is read as data). */
export function shownQueue(it: Pick<QueueItem, 'queue'>): QueueRef[] {
  return queuedOf(it)
    .filter(q => q && typeof q === 'object' && isUuid(q.id))
    .map(q => ({ ...q, title: queueAgain(q.title, QUEUE_TITLE_MAX), tier: cleanText(q.tier, QUEUE_TIER_MAX), reason: queueAgain(q.reason, QUEUE_REASON_MAX), severity: cleanText(q.severity, 10) }))
    .filter(q => q.title !== '')
    .slice(0, QUEUE_SHOWN_MAX)
}

/**
 * (0.7.3, internal queue; spec 2026-10-27: "show the queue in rank order: the top 10, each with its tier and one-line
 * reason, then 'N more' from the total") One queued ticket's line, numbered, as the kickoff and the pane write it:
 * `1. tier 1 · Rotate the sandbox key (ticket 1a2b3c4d) · the breach checklist still lists it`. Its tier (its severity when
 * it has none), its title, its short id and its reason. ⛔ Never a due time or a clock.
 */
export const queueLine = (q: QueueRef, n: number): string => {
  const tier = q.tier || q.severity
  return `${n}. ${tier ? `${tier} · ` : ''}${q.title} (ticket ${q.id.slice(0, 8)})${q.reason ? ` · ${q.reason}` : ''}`
}

/** (0.7.3, internal queue) `304 more in the queue.`, or '' when the queue lists every ticket it holds. */
export function queueMore(it: Pick<QueueItem, 'queue'>): string {
  const more = queueTotal(it) - shownQueue(it).length
  return more > 0 ? `${more} more in the queue.` : ''
}

/**
 * (0.7.3, internal queue) The viewer's internal queue in its part of the pane: a heading with how many tickets it holds,
 * each listed ticket's line in rank order, then how many more. '' for an item with none.
 */
export function queueMarkdown(it: Pick<QueueItem, 'queue'>): string {
  const shown = shownQueue(it)
  if (!shown.length) return ''
  const total = queueTotal(it)
  const out = [`### Internal queue (${total} ticket${total === 1 ? '' : 's'}, no due dates)`, '', ...shown.map((q, i) => queueLine(q, i + 1))]
  const more = queueMore(it)
  if (more) out.push('', more)
  return out.join('\n')
}

/**
 * (0.7.4) The tasks as the bridge note says them: `2 committed tasks due`, as it always has, unless some owe an ETA or
 * have no date: `1 committed task due, 1 ticket that needs an ETA, 3 tasks with no due date`.
 */
function taskPhrase(it: QueueItem): string {
  const eta = etaAsksOf(it).length
  const nodate = undatedCount(it)
  const dated = it.tasks - eta - nodate
  if (!eta && !nodate) return `${it.tasks} committed task${it.tasks === 1 ? '' : 's'} due`
  return [
    dated > 0 ? `${dated} committed task${dated === 1 ? '' : 's'} due` : '',
    eta > 0 ? `${eta} ticket${eta === 1 ? ' that needs' : 's that need'} an ETA` : '',
    nodate > 0 ? `${nodate} task${nodate === 1 ? '' : 's'} with no due date` : '',
  ].filter(Boolean).join(', ')
}

function noteBody(it: QueueItem, member: string): string {
  const waiting = `${it.messages} client message${it.messages === 1 ? '' : 's'} waiting on our reply and ${taskPhrase(it)}`
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
  // (0.7.4) tasks alone are not a reply to prepare (Rob, 2026-10-27: "It doesn't necessarily create the need for a new reply")
  if (it.messages === 0) return `${waiting}; no client message is waiting, so there is no reply to prepare.`
  return `${waiting}; no reply drafts are prepared yet.`
}

/**
 * What a client's thread shows when the pickup view is not shown: the messages waiting, the tasks due, and what is true of its reply drafts.
 * (0.5.28, internal asks) Then the viewer's open asks (`asksMarkdown`, with each page in `pages` that was read). A client
 * listed by its asks alone, with nothing of a reply's in play, says nothing of reply drafts: there are none to pick up.
 * (0.7.3, internal queue) Then the viewer's internal queue (`queueMarkdown`); the same holds for an item listed by its
 * asks and its queue alone.
 */
export function clientMarkdown(it: QueueItem, now: number, pages: Readonly<Record<string, string>> = {}, self = ''): string {
  const asks = [asksMarkdown(it, now, pages), queueMarkdown(it)].filter(Boolean).join('\n\n')
  // (0.7.9, Rob 10-29) when its thread is due to be updated by itself, under the title: `This thread updates itself ...`
  const out = [`## ${it.projectName}`, self ? `${titleFor(it, now)}\n\nThis thread ${self}.` : `${titleFor(it, now)}`]
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
  // (0.7.4, ETA asks) the viewer's tickets that owe an ETA, each with when it is needed by
  const eta = etaMarkdown(it, now)
  if (eta) out.push('', eta)
  // (0.7.4) the tasks nobody dated, apart from the committed ones
  const undatedTitles = Array.isArray(it.undatedTitles) ? it.undatedTitles : []
  if (undatedTitles.length) {
    out.push('', '### Open tickets (no due date)')
    for (const t of undatedTitles.slice(0, UNDATED_SHOWN_MAX)) out.push(`- ${t}`)
    if (undatedTitles.length > UNDATED_SHOWN_MAX) out.push(`- and ${undatedTitles.length - UNDATED_SHOWN_MAX} more`)
  }
  // (0.7.4) nothing of a reply's in play (no client message, no package): no word of reply drafts, whatever else lists
  // the client (Rob, 2026-10-27: a task alone "doesn't necessarily create the need for a new reply")
  const noReply = !it.mail.length && !it.packageId && !(it.open ?? null)
  if (asks) out.push('', asks)
  // (0.7.4, for the founder) his teammates' late internal tickets, last: theirs, not his
  const mates = matesMarkdown(it, now)
  if (mates) out.push('', mates)
  if (!noReply) out.push('', draftsLine(it))
  return out.join('\n')
}

/** (0.7.4) The most undated tasks the pane lists for one client. */
const UNDATED_SHOWN_MAX = 10

/** (0.7.4, ETA asks) The pane's part for the viewer's tickets that owe an ETA: OW's words, then each with when it is needed by. '' with none. */
export function etaMarkdown(it: QueueItem, now: number): string {
  const asks = etaAsksOf(it).filter(a => a && isUuid(a.id) && Number.isFinite(a.neededBy))
  if (!asks.length) return ''
  const lines = asks.map(a => `- ${cleanText(a.title, MATE_TITLE_MAX)} (ticket ${a.id.slice(0, 8)}) · ${a.neededBy < now ? `ETA was needed by ${clockText(a.neededBy, now)}, ${lateText(a.neededBy, now)}` : `ETA needed by ${clockText(a.neededBy, now)}`}`)
  return [`### ${ETA_ASK_TEXT}`, '', ...lines].join('\n')
}

/** (0.7.4, for the founder) The pane's part for his teammates' late internal tickets on the client. '' with none. */
export function matesMarkdown(it: QueueItem, now: number): string {
  const refs = matesOf(it).filter(r => r && isUuid(r.id) && Number.isFinite(r.lateSince))
  if (!refs.length) return ''
  const lines = refs.map(r => `- ${cleanText(r.by, 40)} · ${cleanText(r.title, MATE_TITLE_MAX)} (ticket ${r.id.slice(0, 8)}) · ${r.eta ? 'no ETA given' : 'past its ETA'}, ${lateText(r.lateSince, now)}`)
  return [`### Late with a teammate (${refs.length})`, '', ...lines].join('\n')
}

/** (0.7.4) How late something is, as the pane says it: `3h late`, `2d late` (business time, R16). */
function lateText(since: number, now: number): string {
  return `${whenText(since, now).replace(/^overdue /, '')} late`
}

// ---------------------------------------------------------------- a route call that can close something

/**
 * The team gateway's routes that can close something for a client (R6, Rob 2026-10-13: names and pins change
 * only from the server's data, and the feed is read again at once after any of these): the reply-draft routes
 * that end a draft (`sent`, `discard`, and `post-team`, which posts a team draft and records it sent in the same
 * call, client-reply-prep §9.5), and ANY write to a reply package (`/reply-package`, `/reply-package/no-reply`,
 * `/reply-package/<anything>`). Each can change what the feed lists for the client. Judged by the route and the
 * method, never by a fixed list of commands.
 * (0.5.28, internal asks; spec 2026-10-23: "Resync after a Bash call to /team-ask/(draft|post|close), as for the
 * reply-draft routes") And the three writes to an internal ask: `/team-ask/draft` (its reply stored: the pane's page
 * changes), `/team-ask/post` (posted after the person's go: the ask is answered) and `/team-ask/close`. A read of an
 * ask's page (`GET /team-ask?id=...`) is not one.
 */
const CLOSING_ROUTE = String.raw`\/(?:reply-draft\/(?:sent|discard|post-team)|reply-package(?:\/[\w-]+)*|team-ask\/(?:draft|post|close))(?![\w\/-])`
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
