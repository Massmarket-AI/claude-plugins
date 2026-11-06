// Pure queue logic for the Massmarket bridge: no `$`, so tests can call it directly.
//
// What is listed (Rob, 2026-10-20: "everything since last Thursday that wasn't closed should always show up
// now, and we can keep it clean going forward"): everything still open whose due time is on or after the cut,
// `listCutoff` (LIST_FLOOR_MS, Wed 2026-10-14 12:00 AM ET, or (0.7.12) 3 weeks back once that is later), however
// overdue, and everything not due yet, however far ahead. (Until 2026-10-20 the cut was 3 business days back; Rob
// replaced it with LIST_FLOOR_MS.) ⛔ (0.7.12, Rob 2026-10-30: "We shouldn't be considering anything that's older than
// the cutoff date") What was due before the cut is not considered anywhere. That is:
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
//   - (0.7.24, follow-ups that need a go) proposed follow-up steps on a follow-ups-only package (an ask we sent by hand)
//     that nobody approved: for whoever must give the go, due when the first step's window opens, and pinned at once
//     (kind `go` when nothing else lists the client); for the founder and the PM, a teammate's to check on (`watch`)
// A listed client pins while what it must act by is past or within the next 24 business hours (`pinsNow`).
// Work that must start now at 1.5 h a day waits for real hour estimates (quote line items).
//
// Two more lists are built beside that one (buildLists), and neither pins or is counted: clients whose
// reply drafts a teammate holds (not the viewer's to act on), and (R8) clients whose reply the server is checking.
// (Until 0.7.12 a third, Older, held clients whose only items were due before the floor.)
//
// Every client clock here counts business time (Rob, 2026-10-12: "the weekends don't count as days towards
// the 24-hour response time... We're only counting business days in our timelines for clients"): Saturday
// and Sunday, America/New_York, contribute zero. See ./business-time.ts.

import type { MmPerson, MmProject } from '../types'

import { businessDaysBetween, businessDeadline, businessMsBetween, isBusinessTime, subtractBusinessMs } from './business-time'

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
  /**
   * (0.7.27, OW #638) The package owes no reply and has nothing to send (`drafts_ready` and `drafts_unsent` 0): one go closes it.
   * Absent on a server that does not send it yet: the row is read as before.
   */
  no_reply?: boolean
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
  /**
   * (0.7.15, owner asks) The ticket's `details.commitment_basis` as OW stores it (OW closeout.ts, 2026-10-28): what its
   * `due_at` is. `assign_by` (ASSIGN_BY_BASIS) is H9's clock to give a ticket a team post handed him an owner, 12
   * business hours after the post; "OW prints no label for it: the bridge does". Every other value, and none, is read
   * as before.
   */
  commitment_basis?: string | null
  /**
   * (0.7.18) The ticket's status as OW sends it (`open`, `triaged`, `in_progress`). Read only for a teammate's ticket on
   * the PM's feed: `in_progress` is the one sign the bridge has that its work started (start-by, PM_CHECK_AHEAD_MS).
   */
  status?: string | null
  /**
   * (0.7.25) OW's `details.waiting_on` (src/lib/team-ops/eta.ts `isWaitingOnClient`): `client` while the ticket's next move
   * is the client's, set by a reply package's `waiting` outcome and cleared by the next one. Such a ticket is skipped
   * (`waitingOnClient`). Absent on a server that does not send it yet: read as before. (0.7.30) `owner_when_ready`: the
   * owner picks it up when ready, so it lists undated and never pins (`ownerWhenReady`). Any other value reads as none.
   */
  waiting_on?: string | null
  /**
   * (0.7.27) On a row of `tickets.undated` (the founder's own undated client tickets): the day the ticket last showed
   * activity, `YYYY-MM-DD`, or null with none to read. OW's port of the 3-week ticket rule's own measure. What `undatedWindow`
   * reads. Absent on a server that does not send it yet, and on every other list: the row is read as before.
   */
  last_activity_at?: string | null
}

/**
 * (0.7.25, Rob 2026-11-05, on a thread pinned for tickets of a client who never approved the plan: "I don't know why this
 * is pinned or what. Antu doesn't have anything to do for them... Why is this pinned?") A ticket waiting on the client is
 * nobody's late work: it never lists, pins, counts late or names a thread, whoever it is assigned to and whatever date it
 * carries. OW already drops its ETA ask (closeout.ts, "WAITING ON THE CLIENT"); this is the bridge's half.
 */
export const waitingOnClient = (tk: Pick<FeedTicket, 'waiting_on'>): boolean =>
  typeof tk.waiting_on === 'string' && tk.waiting_on.trim().toLowerCase() === 'client'

/**
 * (0.7.30, Rob 2026-11-06, on Drew Mays's tasks: "I'll pick this up when I'm ready to. It shouldn't be prompting me to do
 * anything. There should be no due date with the task.") A ticket its owner picks up when ready: OW's
 * `details.waiting_on = "owner_when_ready"`. It stays open and lists under `No due date`, and it never pins as
 * `needs a due date`, whatever its last activity. The mark says no date is owed: a ticket that has a date reads as any other.
 */
export const ownerWhenReady = (tk: Pick<FeedTicket, 'waiting_on'>): boolean =>
  typeof tk.waiting_on === 'string' && tk.waiting_on.trim().toLowerCase() === 'owner_when_ready'

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

/** (0.7.27) OW's word for a client's pace (src/lib/team-ops/pace-load.ts). `behind`: it needs more hours a day than the client pays for; `overbooked`: behind, and the holder's needed hours a day across their clients are more than a workday. */
export type PaceState = 'late' | 'behind' | 'overbooked' | 'on_track'

/**
 * (0.7.27, Rob 2026-11-05, "Yes, approve it") One row of the feed's `pace` (OW closeout-pace.ts): one holder's part of a
 * client with quoted work left. `date` is ISO. `hours_short`: for `late`, the hours past their date. `hours_logged_today`: everyone's
 * hours on the client today, the Eastern day; absent when it could not be read, which says nothing about whether anyone worked.
 * A member gets the rows they hold; the PM every holder's but the founder's, nobody's included; the founder gets no key.
 * ⛔ The key absent means not known (`keptPace`), never "everyone is on track"; `[]` means read, and nothing there.
 */
export type FeedPace = {
  project_id: string
  project_name: string
  holder_email: string | null
  state: PaceState
  need_per_day: number
  paid_per_day: number
  hours_logged_today?: number
  hours_left: number
  hours_short: number
  date: string
  date_kind: string
}

/**
 * (0.7.27) One teammate's latest pin report, on the PM's feed alone (OW closeout-member-pins.ts). `items`: each client the
 * report lists, whether its thread is pinned for them, and why it should be. No entry for a teammate: no report to read, and
 * nothing is said for them. An entry that does not list a client: not pinned for them.
 */
export type FeedMemberPins = { member_email: string; reported_at: string; items: Array<{ project_id: string; pinned: boolean; kind: string }> }

/** (0.7.27) A pace row as a client's item keeps it: the numbers its words give, and its date in ms. `logged` null: not known. */
export type PaceRef = { state: PaceState; need: number; paid: number; logged: number | null; short: number; date: number }

/** One of the feed's projects (OW's `projects`; for the founder and a PM, every active project they may see). */
export type FeedProject = { project_id: string; name: string; followups?: FeedFollowups | null }

/**
 * (0.7.24) A feed project's `followups` (OW closeout.ts `CloseoutFollowups`, migration 299 and R7 2026-10-21): the client's
 * running steps and the proposed ones waiting for a go. The bridge reads only the `go_` keys (OW, 2026-11-04), which OW
 * sends only when proposed steps sit on a FOLLOW-UPS-ONLY package (an ask we sent by hand, `package.followups_anchor`):
 * a package with a reply to send is approved with its reply, so its steps never need a go of their own. Rob, 2026-11-04:
 * "if it's approved, it shouldn't show up to me at all ... unless the system comes up with some new follow-ups that I
 * had left off somewhere that aren't approved. That's the only time it should surface to me." `go_first_at` is when the
 * first step's send window opens, `go_by` who gives the go (the package's sender, else the ask's sender, else whoever
 * holds it; null: nobody named). Every field may be missing or null. Absent on an OW that does not send them yet: nothing
 * changes.
 */
export type FeedFollowups = {
  active?: number | null
  next_at?: string | null
  next_kind?: string | null
  awaiting_go?: number | null
  go_package_id?: string | null
  go_first_at?: string | null
  go_first_kind?: string | null
  go_by?: string | null
  go_steps?: number | null
}

/**
 * (0.7.24) Follow-up steps that wait for a go, as a client's item keeps them: the follow-ups-only package (a lower-case
 * uuid: it goes into the kickoff and the pickup request), how many steps, when the first one's window opens (ms; null when
 * OW could not date it) and its step kind as OW names it (`client_sms`; '' when it is not one: lower-case letters and _ only),
 * and whose go it is: `mine` when it is the
 * viewer's to give, else `by`, the teammate's name (cleaned), for the founder and the PM to check on.
 */
export type GoRef = { packageId: string; steps: number; firstAt: number | null; firstKind: string; by: string; mine: boolean }

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
  /** (0.7.27) Each holder's pace on each client with quoted work left: read defensively, see `FeedPace`. */
  pace?: FeedPace[]
  /** (0.7.27) The PM's alone: each teammate's latest pin report, for `pinned for <teammate>` on his row. */
  member_pins?: FeedMemberPins[]
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
   * (0.7.24) `go`: listed by follow-up steps that wait for a go alone: `follow-ups need your go`.
   * (0.7.27) `pace`: listed by the viewer's own pace row alone (`paceOf`): quoted work left, nothing else open.
   */
  kind: 'ready' | 'reply' | 'task' | 'ok' | 'ask' | 'queue' | 'go' | 'pace'
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
   * current package flagged for his OK that a teammate sends, until its reply is due; ⛔ (0.7.23) and after it too, unless
   * that teammate asks him about the client (an open ask of theirs in the feed). The client then lists under With a
   * teammate. Absent otherwise, and on an item an older version stored.
   */
  theirs?: string
  /**
   * (0.7.23, for the founder alone) The package flagged for his OK that a teammate holds or sends (R2, `theirs`), once its
   * reply is due: who has it, the package's id, and since when it is late. Listed under Team · late (`teamLate`), never
   * pinned. Absent otherwise, and on an item an older version stored.
   */
  okLate?: { by: string; id: string; lateSince: number }
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
   * (0.7.15, owner asks) The viewer's own tickets on this client whose date is an `assign_by` clock: a team post handed
   * them over to be given an owner by then, not delivered by then (Rob, 2026-11-03: H9 "gets the build task, pinned in
   * his bridge, with a clock to assign a teammate"). Each is also counted in `tasks`, and is due at that clock. Absent
   * when there are none, and on an item an older version stored: read `assignAsksOf(it)`.
   */
  assignAsks?: AssignRef[]
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
  /**
   * (0.7.18, Rob 2026-11-03: "The pinned is for when action is needed from you") The soonest time something of the client's
   * that needs the VIEWER must be acted on: `actBy` without the parts a teammate is to see through (a reply whose drafts a
   * teammate holds, a package flagged for the founder's OK that a teammate decides on, a teammate's ticket). What R1 pins
   * by (`pinsFor`). Null (Infinity in a pass): nothing of the viewer's own has a clock. Absent on an item an older version
   * stored: read `ownActBy(it)`, which falls back to `actBy`.
   */
  own?: number | null
  /**
   * (0.7.18, for the PM) The teammates' parts of the client the viewer watches, soonest first: a reply a teammate holds the
   * drafts of, and a teammate's ticket that is late, nearly due or past its start-by. They pin only once `checkNow` says
   * so. Read `watchOf(it)`. ((0.7.18 to 0.7.20 the founder watched too: a reply a teammate held, a package flagged for his
   * OK that a teammate decided on, and his `mates`. Since 0.7.21 he watches none: `checkAheadOf`.)
   */
  watch?: WatchRef[]
  /** (0.7.18) How far ahead of a watched part's due time it pins for this viewer: PM_CHECK_AHEAD_MS (the PM alone since 0.7.21). Absent: never. */
  checkAhead?: number
  /**
   * (0.7.24, Rob 2026-11-04) Proposed follow-up steps of the client's that nobody approved and that wait for a go (`GoRef`).
   * The viewer's own (`mine`): due when the first step's window opens, and it pins at once, whatever that time (Rob: "it
   * should show up for them as soon as possible"); once the go is given OW stops sending it and it is gone. A teammate's,
   * for the founder and the PM: a watched part (`watch`, `what` 'follow-ups go'), pinned only once nearly due or late.
   * Absent with none, and on an item an older version stored: read `goOf(it)`.
   */
  go?: GoRef
  /** (0.7.27, OW #638) The package the viewer is to work owes no reply: what it reads (`NO_REPLY_WHAT`). Absent otherwise, and on an item an older version stored. */
  noReply?: true
  /** (0.7.27) The viewer's own pace on this client (the row they hold). Absent with none, and on an item an older version stored: read `paceOf(it)`. */
  pace?: PaceRef
  /** (0.7.27) How many of the viewer's undated tickets here are inside the window (`undatedWindow`): each pins, as `needs a due date`. Read `needsDateOf(it)`. */
  needsDate?: number
  /** (0.7.27) The earliest start-by of the viewer's own tickets here whose work has not started (OW status `in_progress` is the one sign it has). Past it, the client is `behind · not started`. */
  startBy?: number
}

/**
 * (0.7.18) A teammate's part of a client that the founder or the PM watches: whose it is (their name, cleaned), when it is
 * due, what it is (`reply` or `task`), and, for a ticket on the PM's feed whose work has not started, when it had to start
 * (`startBy`, OW's `start_by_at`). A ticket's id and title, when it is one.
 */
export type WatchRef = {
  by: string
  due: number
  what: 'reply' | 'task' | 'follow-ups go' | 'pace'
  startBy?: number
  id?: string
  title?: string
  /** (0.7.27) With `what` 'pace': the teammate's pace row, `late`, `overbooked` or `behind`. A part to check on as long as it reads so. */
  pace?: PaceRef
  /** (0.7.27) From the teammate's pin report: whether this client is pinned for them. Absent: no report to read, and nothing is said. */
  pin?: boolean
}

/** (0.7.4, ETA asks) A ticket of the viewer's that owes an ETA: its id (a lower-case uuid), its title, and when the ETA is needed by. */
export type EtaRef = { id: string; title: string; neededBy: number }

/** (0.7.15, owner asks) A ticket of the viewer's to give an owner: its id (a lower-case uuid), its title, and the `assign_by` clock. */
export type AssignRef = { id: string; title: string; assignBy: number }

/**
 * (0.7.4) A teammate's late internal ticket, for the founder: whose (their name), its id, title and since when it is late;
 * `eta` when no ETA was ever given. (0.7.23) `ok`: not a ticket but a reply package flagged for his OK that the teammate
 * holds or sends, late since its reply was due (`okLate`); its id is the package's.
 */
export type MateRef = { by: string; id: string; title: string; lateSince: number; eta: boolean; ok?: true }

/** (0.7.4, ETA asks) What a ticket that owes an ETA says, in OW's words (ETA_ASK_TEXT): the feed's own copy of it is never shown. */
export const ETA_ASK_TEXT = '⏳ NO ETA — give one in Claude Code'

/** (0.7.15, owner asks) OW's `details.commitment_basis` for H9's clock to give a handed-off ticket an owner. */
export const ASSIGN_BY_BASIS = 'assign_by'

/** (0.7.15, owner asks) What a ticket on an `assign_by` clock says, the bridge's own words: OW prints none. */
export const ASSIGN_ASK_TEXT = 'Needs an owner: assign one in OW, or take it and give the ETA'

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

/** (0.7.15, owner asks) The viewer's tickets on a client to give an owner, as its item holds them: none on an item an older version stored. */
export const assignAsksOf = (it: Pick<QueueItem, 'assignAsks'>): AssignRef[] => (Array.isArray(it.assignAsks) ? it.assignAsks : [])

/** (0.7.4) The founder's teammates' late internal tickets on a client, as its item holds them. */
export const matesOf = (it: Pick<QueueItem, 'mates'>): MateRef[] => (Array.isArray(it.mates) ? it.mates : [])

/** (0.7.4, ETA asks) A client listed by tickets that owe an ETA and nothing else: no client message, no package, no ask. */
export const etaOnly = (it: QueueItem): boolean =>
  etaAsksOf(it).length > 0 && etaAsksOf(it).length === it.tasks && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0

/** (0.7.15, owner asks) A client listed by tickets to give an owner and nothing else: no client message, no package, no ask. */
export const assignOnly = (it: QueueItem): boolean =>
  assignAsksOf(it).length > 0 && assignAsksOf(it).length === it.tasks && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0

/**
 * (0.7.4) A client listed by the founder's undated client tickets alone (`tickets.undated`): nothing dated, no client
 * message, no package, no ask, no queue. Rob, 2026-10-27: "It doesn't necessarily create the need for a new reply." Its
 * thread is never updated by itself for them (`autoUpdatable`); they ride along with whatever does update it.
 */
export const undatedOnly = (it: QueueItem): boolean =>
  (it.undatedTasks ?? 0) > 0 && !hasDue(it) && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0 && queuedOf(it).length === 0

/** (0.7.27) A client under the closed group `No due date`: undated tickets alone, none of them pinning, and no pace row of the viewer's. */
export const noDateGroup = (it: QueueItem): boolean => undatedOnly(it) && needsDateOf(it) === 0 && paceOf(it) === null

/**
 * (0.7.4) How many of a client's tasks have no date at all (R17's rows and `tickets.undated`), never more than the tasks
 * that owe no ETA (and, 0.7.15, need no owner): what the note, the row and the kickoff call `with no due date`, never
 * `committed`.
 */
export const undatedCount = (it: Pick<QueueItem, 'tasks' | 'etaAsks' | 'assignAsks' | 'undatedTitles'>): number =>
  Math.max(0, Math.min(Array.isArray(it.undatedTitles) ? it.undatedTitles.length : 0, it.tasks - etaAsksOf(it).length - assignAsksOf(it).length))

/**
 * (0.7.15) How many of a client's tasks are dates we committed to: not one that owes an ETA, one to give an owner, or
 * one with no date. What the note, the row and the kickoff call `committed` or `due`.
 */
export const committedCount = (it: Pick<QueueItem, 'tasks' | 'etaAsks' | 'assignAsks' | 'undatedTitles'>): number =>
  it.tasks - etaAsksOf(it).length - assignAsksOf(it).length - undatedCount(it)

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

/** (0.7.24) The client's follow-up steps that wait for a go, checked again (an item an older version stored, or a store edited by hand, is read as data); null with none. */
export function goOf(it: Pick<QueueItem, 'go'>): GoRef | null {
  const g = it.go
  if (!g || typeof g !== 'object' || !isUuid(g.packageId) || !Number.isSafeInteger(g.steps) || g.steps < 1) return null
  return g
}

/** (0.7.24) Whether the viewer must give a go on follow-up steps of this client's: what pins it at once (`ownPins`). */
export const goMine = (it: Pick<QueueItem, 'go'>): boolean => goOf(it)?.mine === true

/** (0.7.24) A client listed by follow-up steps that wait for a go and nothing else: no client message, no package, no task, no ask, no queue. */
export const goOnly = (it: QueueItem): boolean =>
  goOf(it) !== null && it.messages === 0 && it.tasks === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0 && queuedOf(it).length === 0

/** (0.7.27, OW #638) What a row, a thread's name and a chip say for a package that owes no reply and has nothing to send. */
export const NO_REPLY_WHAT = 'no reply needed, one go closes it'

/** (0.7.24) What a row, a thread's name and a chip say for follow-up steps that wait for the viewer's go (Rob's words, 2026-11-04). */
export const GO_WHAT = 'follow-ups need your go'

/** (0.7.24) The same for a teammate's go, on the founder's or the PM's row (`with <Name>` stands beside it). */
export const GO_THEIRS = 'follow-ups need a go'

/** (0.7.24) A step kind as a word: `text`, `email`, `LinkedIn`, `call`, else `step`. */
export function stepWord(kind: unknown): string {
  const k = typeof kind === 'string' ? kind : ''
  return k === 'client_sms' ? 'text' : k === 'client_email' ? 'email' : k.startsWith('linkedin') ? 'LinkedIn' : k === 'call_task' ? 'call' : 'step'
}

/** (0.7.24) The first step and its date, as a row and a thread's name end with it: `first text Fri Nov 6`; with no date, `first text`. */
export function goFirstText(g: Pick<GoRef, 'firstAt' | 'firstKind'>): string {
  const word = stepWord(g.firstKind)
  if (typeof g.firstAt !== 'number' || !Number.isFinite(g.firstAt)) return `first ${word}`
  const a = etParts(shownDue(g.firstAt))
  return `first ${word} ${a.day} ${a.md}`
}

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

/** (0.7.11) Something of the client's waits now: a message of theirs with no reply, or a reply package; (0.7.24) or follow-up steps that wait for a go. */
export const clientWaiting = (it: QueueItem): boolean => it.messages > 0 || Boolean(it.packageId) || Boolean(it.open ?? null) || goOf(it) !== null

/**
 * (0.7.11) Something due for the viewer himself: a client's reply, or a dated ticket of his own; (0.7.24) or a go he must
 * give on follow-up steps. Never a teammate's ticket past its ETA (`mates`, `theirs`), a ticket with no date, one that
 * only owes an ETA, or an internal ask.
 */
export const dueForViewer = (it: QueueItem): boolean => it.messages > 0 || it.tasks - etaAsksOf(it).length - undatedCount(it) > 0 || goMine(it) || paceOf(it) !== null || needsDateOf(it) > 0

/**
 * (0.7.11) Whether a client may be offered a new thread (Start), or be followed to its own thread on a profile switch:
 * an internal project (its own rules, unchanged), a client with something of theirs waiting now or a message from them
 * in the last ACTIVE_WINDOW_MS (`lastFrom`, the newest the bridge knows), or something due for the viewer. Every other
 * client keeps its row, with no Start and no thread. ⛔ (0.7.12) Never whether its thread is pinned: a pin needs a clock
 * (R1, `pinsNow`). 0.7.11 also pinned an active client's thread whatever its time (`isActive`, gone in 0.7.12), and
 * threads with nothing dated were pinned with no clock.
 */
export function mayStart(it: QueueItem, lastFrom: number | undefined, now: number, internal = false): boolean {
  if (internal || it.internal === true || it.kind === 'queue') return true
  return clientWaiting(it) || isRecent(lastFrom, now) || dueForViewer(it)
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
 * now, and we can keep it clean going forward"). Replaces the rolling 3-business-day cut of 2026-10-08. Wed 2026-10-14
 * 12:00 AM ET: the week the team installed the bridge. (Until 2026-10-21 the floor was Thu 2026-10-15; Rob moved it to
 * Wed 2026-10-14: "it should actually be last Wednesday".) The cut itself is `listCutoff`: this floor, or 3 weeks back
 * once that is later. (Until 0.7.12 what was due before the floor was listed under Older.)
 */
export const LIST_FLOOR_MS = Date.parse('2026-10-14T04:00:00Z')
/**
 * (0.7.12, Rob 2026-10-30: "We shouldn't be considering anything that's older than the cutoff date from the week before
 * the team left") How far back the cut rolls: 21 days, the same 3 weeks after which the nightly stale-ticket job
 * (launchd com.massmarket.stale-ticket-rule) closes a quiet ticket, so what the bridge ignores and what gets closed line
 * up. Calendar days, not business days: it matches that job. The one number to change.
 */
export const CUTOFF_WINDOW_MS = 21 * DAY
/**
 * (0.7.12) The cut, at `now`: the later of the floor (LIST_FLOOR_MS) and 3 weeks back (CUTOFF_WINDOW_MS). Anything still
 * open that was due before it is not considered anywhere: no row, no clock, no pin, no count, no band, no kickoff, no
 * Start and no update by itself; the client is as if it had nothing. Until Wed 2026-11-04 the floor decides; then it rolls.
 */
export const listCutoff = (now: number): number => (Number.isFinite(now) ? Math.max(LIST_FLOOR_MS, now - CUTOFF_WINDOW_MS) : LIST_FLOOR_MS)
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
 * further back is read the same way, and (0.7.12) left out when its reply was due before the cut (`listCutoff`; until
 * 0.7.12 it went under Older). The cut never reaches further back than the floor, so this always covers it. The 168 (the look-back since 2026-10-13, review of
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
 * Every client the feed has something of the viewer's for, in the lists the pane draws. A client is in
 * exactly one.
 *   queue     needs the viewer now: what pins and what the header counts. Soonest due first.
 *   teammate  a teammate holds its reply drafts and the viewer has no task of their own due there: not the
 *             viewer's to act on (Rob, 2026-10-12: "They should only be seeing theirs... when you pass it
 *             to somebody else, it should show up for only the person who's passed it"). Never pinned,
 *             never counted. The pane lists them under `With a teammate (n)`.
 *   checking  (0.5.2, R8) its package waits for the server's check of our newer send.
 * ⛔ (0.7.12, Rob 2026-10-30: "We shouldn't be considering anything that's older than the cutoff date") Nothing due
 * before the cut (`listCutoff`) is in any of them: a client whose only items were due before it is in none, as a client
 * with nothing is. Until 0.7.12 a fourth list, `older`, held those clients under `Older (n)`, and the band counted them
 * (`· N older overdue`).
 */
export type Lists = { queue: QueueItem[]; teammate: QueueItem[]; checking: QueueItem[] }

/**
 * A teammate holds this client's reply drafts and nothing else keeps it in the viewer's list: no committed
 * task of the viewer's own due there, and (for the founder) no package waiting for his OK. For the founder
 * too: a client whose package a teammate sends and that is theirs to see through (`theirs`, R1 and R2).
 * (0.5.28, internal asks) An open ask of the viewer's keeps the client in their list as a task of theirs does: it was
 * asked of them, whoever holds the client's drafts. (0.7.3, internal queue) So does their internal queue. (0.7.24) So
 * does a go of theirs on follow-up steps. (0.7.27) So does a pace row they hold.
 */
export const withTeammate = (it: QueueItem): boolean =>
  it.tasks === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0 && !goMine(it) && paceOf(it) === null && (Boolean(it.theirs) || ((it.open ?? null)?.state === 'held_by_other' && it.kind !== 'ok'))

/**
 * (0.7.12, the coordinator for Rob, 2026-10-30: "the bridge never touches a pin you made") The clients in none of the lists
 * only because of the cut: the feed still holds something of theirs that the lists would show if nothing were cut, and all
 * of it was due before the cut. Such a client is clear (its thread is named `✓ <client> · clear` and the bridge takes its
 * OWN pin off), but a pin the person put on its thread stays. Never used to list, count, pin or start anything.
 */
export function pastCutClients(feed: Feed, now: number): Set<string> {
  const kept = new Set(build(feed, now).map(i => i.projectId))
  return new Set(build(feed, now, -Infinity).map(i => i.projectId).filter(pid => !kept.has(pid)))
}

export function buildLists(feed: Feed, now: number): Lists {
  const current = build(feed, now)
  // (0.5.2, R8) a client whose package waits for the server's check of our newer send is in neither of the
  // other lists: off the Needs-you list, not pinned, not counted. Its thread is named for it (`checkingTitle`).
  const checks = (i: QueueItem): boolean => fastState(i, now)?.state === 'checking'
  return {
    queue: current.filter(i => !withTeammate(i) && !checks(i)),
    teammate: current.filter(withTeammate),
    checking: current.filter(i => !withTeammate(i) && checks(i)),
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

// ---------------------------------------------------------------- 0.7.18: a pin is for action the viewer must take

/**
 * (0.7.18, Rob 2026-11-03: "It should only show up to me and Husnain if somebody's late or very close to being late, maybe
 * 5 hours until the reply packet's due, or maybe even 2 hours ... Probably should [surface] to H9 before it [surfaces] to
 * me") How far ahead of a teammate's due time a part of theirs pins for the PM (H9, the feed's role `pm`): 5 business
 * hours. Opus's number; Rob may change it. The one number to change.
 * ⛔ (0.7.27, Rob 2026-11-05: "everything that's yellow or red should show up pinned for H9 as well if it's yellow or red for
 * any of the team members") 24 business hours, the same window that pins the teammate: H9 is pinned whenever they are.
 */
export const PM_CHECK_AHEAD_MS = 24 * HOUR

/**
 * (0.7.18) The window a viewer's role watches teammates' parts with, or null for a role that watches none: the PM alone.
 * ⛔ (0.7.21, Rob 2026-11-05: "When things are overdue but not assigned to me, I don't think they should be pinned here. I
 * think they should all show up in the same thing that shows the system stats.") Not the founder any more: from 0.7.18 to
 * 0.7.20 he had FOUNDER_CHECK_AHEAD_MS (2 business hours), and his threads were pinned and named `check on <teammate>` for
 * teammates' late tickets, 24 pins on 11-05 with 52 of their tickets riding on his rows. A teammate's part never pins his
 * thread or names it now; their late tickets are listed under Team · late (`teamLate`), by person, then client.
 */
export function checkAheadOf(role: unknown): number | null {
  return role === 'pm' ? PM_CHECK_AHEAD_MS : null
}

/**
 * (0.7.18) The soonest time something of the client's that needs the viewer must be acted on (`QueueItem.own`). An item an
 * older version stored has none: its `actBy`, else its due time, as R1 always read it.
 */
export function ownActBy(it: Pick<QueueItem, 'dueAt' | 'actBy' | 'own'>): number {
  if (typeof it.own === 'number') return it.own
  if (it.own === null) return Infinity
  return Number.isFinite(it.actBy) ? (it.actBy as number) : it.dueAt
}

/**
 * (0.7.18) The teammates' parts the viewer watches on a client, soonest first (`watch`). ⛔ (0.7.21) Never the founder's
 * teammates' late internal tickets (`mates`): from 0.7.18 to 0.7.20 they were watched here and pinned his thread to check
 * on them. They are listed under Team · late instead, and never pin, even on an item a 0.7.20 bridge stored.
 */
export function watchOf(it: Pick<QueueItem, 'watch'>): WatchRef[] {
  const listed = (Array.isArray(it.watch) ? it.watch : []).filter(w => w && typeof w.by === 'string' && Number.isFinite(w.due))
  const first = (w: WatchRef): number => Math.min(w.due, Number.isFinite(w.startBy) ? (w.startBy as number) : Infinity)
  return [...listed].sort((a, b) => first(a) - first(b))
}

/** (0.7.18) A watched part to check on now, with why: `late` (past its due time), or `notStarted` (past its start-by), else nearly due. */
export type CheckNow = WatchRef & { late: boolean; notStarted: boolean }

/**
 * (0.7.18) The teammate's part of a client the viewer should check on now, the soonest first: one past its due time, one
 * due within the viewer's window (`checkAhead`: PM_CHECK_AHEAD_MS, in business time), or (a ticket) one whose start-by time
 * has passed with no sign its work started. Null with none, and always for a viewer who watches none: (0.7.21) every
 * viewer but the PM, the founder included.
 */
export function checkNow(it: Pick<QueueItem, 'watch' | 'checkAhead'>, now: number): CheckNow | null {
  const ahead = typeof it.checkAhead === 'number' ? it.checkAhead : NaN
  if (!Number.isFinite(ahead) || ahead < 0) return null
  // (0.7.27) the worst of them by the status list, the soonest first among equals; a pace row reading late, overbooked or
  // behind is a part to check on for as long as it reads so, whatever its date
  let worst: CheckNow | null = null
  let worstRank = Infinity
  for (const w of watchOf(it)) {
    const pace = goodPace(w.pace)
    if (w.what === 'pace' && (!pace || pace.state === 'on_track')) continue
    const late = pace ? pace.state === 'late' : w.due <= now
    const notStarted = !pace && !late && Number.isFinite(w.startBy) && (w.startBy as number) <= now
    if (!pace && !late && !notStarted && !businessWithin(now, w.due, ahead)) continue
    const rank = pace ? paceStatus(pace, now).rank : late ? RANK.late : isToday(w.due, now) ? RANK.dueToday : notStarted ? RANK.behind : RANK.dueSoon
    if (rank < worstRank) {
      worst = { ...w, late, notStarted }
      worstRank = rank
    }
  }
  return worst
}

/**
 * (0.7.18, Rob 2026-11-03: "The pinned is for when action is needed from you, not when something has a timer left for a
 * teammate to answer") Whether a client's thread pins now: what needs the viewer by R1 (`pinsNow` on `ownActBy`: past, or
 * within the next 24 business hours), or (the PM's) a teammate's part to check on (`checkNow`). A reply a teammate holds the
 * drafts of, a package a teammate decides on and a teammate's ticket never pin while their time is left. ⛔ (0.7.21) For the
 * founder, never at all: his own items alone pin his threads (`ownPins`), and his teammates' late tickets are Team · late's.
 * (0.7.24) Nor does a teammate's go on follow-up steps (the PM's checks it 5 business hours out); the viewer's own go pins
 * at once (`ownPins`).
 */
export function pinsFor(it: Pick<QueueItem, 'dueAt' | 'actBy' | 'own' | 'watch' | 'checkAhead' | 'go' | 'pace' | 'needsDate'>, now: number): boolean {
  return ownPins(it, now) || checkNow(it, now) !== null
}

/**
 * (0.7.18) Whether what needs the viewer pins now (R1's rule, on `ownActBy`). (0.7.24, Rob 2026-11-04: "If the other one's
 * supposed to give approval, it should show up for them as soon as possible") A go the viewer must give on follow-up steps
 * pins at once, however far off the first step is: `goMine`. (0.7.27) So do the viewer's own pace row (`pacePins`) and an
 * undated ticket of theirs inside the window (`needsDateOf`): neither has a clock of its own.
 */
export const ownPins = (it: Pick<QueueItem, 'dueAt' | 'actBy' | 'own' | 'go' | 'pace' | 'needsDate'>, now: number): boolean =>
  goMine(it) || needsDateOf(it) > 0 || pacePins(it, now) || pinsNow({ dueAt: Infinity, actBy: ownActBy(it) }, now)

/**
 * (0.7.18) A thread's name while it is pinned only to check on a teammate: who, and what of theirs is due when, in the
 * bridge's one-line style: `🔴 Acme Legal · check on Asif · reply due 3 PM`, once late `🔴 Acme Legal · check on Asif · reply
 * 1h late`. (0.7.27) Its colour is the status's (`checkDot`), and past a ticket's start-by, or on a pace row, its words are
 * the statuses' (`checkWords`): `🟡 Acme Legal · check on Asif · behind · not started, had to start Mon 1 PM`.
 */
export function checkTitle(it: Pick<QueueItem, 'client'>, c: CheckNow, now: number): string {
  return `${checkDot(c, now)} ${it.client} · check on ${cleanText(c.by, 40) || 'a teammate'} · ${checkWords(c, now)}`
}

/** (0.7.27) A teammate's part as a status says it: a pace row's words; a ticket past its start-by (and not due today) `behind · not started, ...`; else what it is and when. */
export function checkWords(c: CheckNow, now: number): string {
  if (c.pace) return paceStatus(c.pace, now).words
  if (c.notStarted && !isToday(c.due, now)) return notStartedWords(c.startBy as number, now)
  return `${c.what} ${c.late ? clockLead(c.due, now) : `due ${clockText(shownDue(c.due), now)}`}`
}

/** (0.7.27) A teammate's part's colour, by the status list: red late, overbooked or due today, else yellow. */
export function checkDot(c: CheckNow, now: number): StatusDot {
  if (c.pace) return paceStatus(c.pace, now).dot
  return c.late || isToday(c.due, now) ? '🔴' : '🟡'
}

/**
 * (0.7.27, Rob 2026-11-05: "He can also have constant clarity about whether something's showing up for a teammate or not")
 * What the PM's row says from the teammate's pin report (`WatchRef.pin`): `pinned for Asif`, `not pinned for Asif`, or
 * neither ('') with no report to read.
 */
export function pinnedForText(c: Pick<WatchRef, 'by' | 'pin'>): string {
  const by = cleanText(c.by, 40) || 'a teammate'
  return c.pin === true ? `pinned for ${by}` : c.pin === false ? `not pinned for ${by}` : ''
}

/** (0.7.18, B) What a thread's name ends with while the bridge pins it again after the person took its pin off: it still needs them. */
export const STILL_NEEDS_YOU = 'still needs you'

/**
 * (0.7.18) The name of a client's thread the bridge pins: what is due (`threadTitle`) when something of the viewer's own
 * pins it, else, when only a teammate's part does, who to check on (`checkTitle`). `again` (B): the person took the pin off
 * while the client still needed them, and the bridge put it back: ` · still needs you` at the end.
 */
export function pinTitle(it: QueueItem, now: number, again = false): string {
  const c = ownPins(it, now) ? null : checkNow(it, now)
  const title = c ? checkTitle(it, c, now) : threadTitle(it, now)
  return again ? `${title} · ${STILL_NEEDS_YOU}` : title
}

// ---------------------------------------------------------------- 0.7.27: the statuses

/**
 * (0.7.27, Rob 2026-11-05, approved "Yes, use them" and "Yes, all three") The status list, worst first: what a client's name
 * shows when it is more urgent than what the name says already (`statusOf`). Red: late, overbooked, due today. Yellow: behind,
 * due within 24 business hours, needs a due date. Green: on track, today's hours done.
 */
const RANK = { late: 0, overbooked: 1, dueToday: 2, behind: 3, dueSoon: 4, needsDate: 5, onTrack: 6, hoursDone: 7 } as const

export type StatusDot = '🔴' | '🟡' | '🟢'

/**
 * (0.7.27) A status that names a client: `kind` as the pin report says it (`hours_done` never pins, so it is never reported),
 * its colour and rank, its words, the date it is about (NaN: none) and `why`, the one sentence `pinReason` gives for it
 * ('' for one whose sentence `pinReason` already has).
 */
export type ClientStatus = {
  kind: 'late' | 'overbooked' | 'behind' | 'on_track' | 'hours_done' | 'needs_date'
  dot: StatusDot
  rank: number
  words: string
  at: number
  why: string
}

const PACE_STATES: readonly string[] = ['late', 'overbooked', 'behind', 'on_track']

/** (0.7.27) A pace ref checked again (an item a store holds is read as data), or null. */
function goodPace(p: PaceRef | null | undefined): PaceRef | null {
  if (!p || typeof p !== 'object' || !PACE_STATES.includes(p.state)) return null
  return Number.isFinite(p.need) && Number.isFinite(p.paid) && Number.isFinite(p.short) && Number.isFinite(p.date) ? p : null
}

/** (0.7.27) The viewer's own pace on a client (the row they hold), or null. */
export const paceOf = (it: Pick<QueueItem, 'pace'>): PaceRef | null => goodPace(it.pace)

/** (0.7.27) A feed row as an item keeps it, or null for a row whose words could not be written (a number or its date missing). */
export function paceRefOf(r: FeedPace): PaceRef | null {
  const logged = r.hours_logged_today
  return goodPace({ state: r.state, need: r.need_per_day, paid: r.paid_per_day, logged: typeof logged === 'number' && Number.isFinite(logged) ? logged : null, short: r.hours_short, date: ms(r.date) })
}

/**
 * (0.7.27, Rob: "It should still be pinned, but it should say 'on track'") Today's paid hours are logged on an on-track client:
 * OW's `hours_logged_today` is client-wide, so it is compared to the client's own paid pace. Not known (null): not done.
 */
export const hoursDone = (p: PaceRef): boolean => p.state === 'on_track' && p.logged !== null && p.paid > 0 && p.logged >= p.paid

/**
 * (0.7.27) Whether the viewer's own pace row pins now. Late, overbooked and behind pin as long as they read so. On track pins
 * its holder each business day until today's paid hours are logged (`hoursDone`), and then not until the next business day:
 * OW's count starts again with the Eastern day.
 */
export function pacePins(it: Pick<QueueItem, 'pace'>, now: number): boolean {
  const p = paceOf(it)
  if (!p) return false
  return p.state !== 'on_track' || (!hoursDone(p) && isBusinessTime(now))
}

/** (0.7.27) A client listed by the viewer's own pace row alone. */
export const paceOnly = (it: Pick<QueueItem, 'kind'>): boolean => it.kind === 'pace'

/** (0.7.27) How many of the viewer's undated tickets on a client pin as `needs a due date`. */
export const needsDateOf = (it: Pick<QueueItem, 'needsDate'>): number => {
  const n = it.needsDate
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0
}

/**
 * (0.7.27) What places an undated ticket in the window: its last activity (`last_activity_at`, OW's port of the 3-week ticket
 * rule's own measure). ⛔ Rob has not yet confirmed last activity over a ticket's age: to measure by age, this line becomes
 * `ms(tk.created_at)`, and nothing else changes.
 */
const undatedMeasure = (tk: Pick<FeedTicket, 'last_activity_at' | 'created_at'>): number => ms(tk.last_activity_at)

/**
 * (0.7.27, Rob 2026-11-05: "Shouldn't it be pinned?") Where an undated ticket stands against the list's cut (`listCutoff`, 3
 * weeks back, never before Oct 14): `inside` pins for its owner, `outside` counts nowhere, and `unknown` (nothing to measure
 * by) lists undated and does not pin, as before 0.7.27. By the day: `last_activity_at` is a date.
 */
export function undatedWindow(tk: Pick<FeedTicket, 'last_activity_at' | 'created_at'>, cut: number): 'inside' | 'outside' | 'unknown' {
  const at = undatedMeasure(tk)
  if (!Number.isFinite(at)) return 'unknown'
  return at >= Math.floor(cut / DAY) * DAY ? 'inside' : 'outside'
}

/** (0.7.27) Hours as a status says them: one decimal at most, `2.4`, `1.5`, `3`. */
const hoursText = (n: number): string => String(Math.round(n * 10) / 10)

/** (0.7.27) A date as a status says it: `Mon Nov 30`. Never a weekend day (`shownDue`). */
function dayText(t: number): string {
  const a = etParts(shownDue(t))
  return `${a.day} ${a.md}`
}

/** (0.7.27) Whether a moment falls today in New York, as `isRed` reads `due today`. */
const isToday = (t: number, now: number): boolean => etParts(t).date === etParts(now).date

/**
 * (0.7.27) An on-track client's due words: `3 PM` today, `Mon 3 PM` within the week, and past that `Mon Nov 30`, because a
 * weekday alone would read as this week's (`dueWhen` keeps to the same six days looking back).
 */
function onTrackDue(t: number, now: number): string {
  return etParts(shownDue(t)).serial - etParts(now).serial <= 6 ? clockText(shownDue(t), now) : dayText(t)
}

/** (0.7.27) Start-by passed: a kind of behind (Rob, "Yes, use them"). It replaces `task not started, due ...`. */
const notStartedWords = (startBy: number, now: number): string => `behind · not started, had to start ${dueWhen(startBy, now)}`

/** (0.7.27) A pace row in a sentence, for whoever holds it (`you`, or a teammate). */
function paceClause(p: PaceRef, you: boolean): string {
  const need = `this needs ${hoursText(p.need)} h a day and ${hoursText(p.paid)} is paid`
  if (p.state === 'late') return `late, ${hoursText(p.short)} h of quoted work ${p.short === 1 ? 'is' : 'are'} past ${dayText(p.date)}`
  if (p.state === 'overbooked') return `overbooked, ${need}, it is due ${dayText(p.date)}, and ${you ? "you don't have the hours across your clients" : "they don't have the hours across their clients"}`
  if (p.state === 'behind') return `behind, ${need}, and it is due ${dayText(p.date)}`
  return `on track, ${hoursText(p.paid)} h a day is paid and today's hours ${p.logged === null ? "can't be read right now" : "aren't logged yet"}`
}

/** (0.7.27) A pace row's status: Rob's approved words, exactly. */
export function paceStatus(p: PaceRef, now: number): ClientStatus {
  const need = `needs ${hoursText(p.need)} h/day, paid ${hoursText(p.paid)}`
  const pinned = `Pinned for you: ${paceClause(p, true)}.`
  if (p.state === 'late') return { kind: 'late', dot: '🔴', rank: RANK.late, words: `late · ${hoursText(p.short)} h past ${dayText(p.date)}`, at: p.date, why: pinned }
  if (p.state === 'overbooked') return { kind: 'overbooked', dot: '🔴', rank: RANK.overbooked, words: `overbooked · ${need} · due ${dayText(p.date)}`, at: p.date, why: pinned }
  if (p.state === 'behind') return { kind: 'behind', dot: '🟡', rank: RANK.behind, words: `behind · ${need} · due ${dayText(p.date)}`, at: p.date, why: pinned }
  const due = onTrackDue(p.date, now)
  if (hoursDone(p)) return { kind: 'hours_done', dot: '🟢', rank: RANK.hoursDone, words: `today's hours done · due ${due}`, at: p.date, why: "No pin needed: today's hours are done." }
  return { kind: 'on_track', dot: '🟢', rank: RANK.onTrack, words: `on track · due ${due} · ${hoursText(p.paid)} h/day`, at: p.date, why: isBusinessTime(now) ? pinned : 'No pin needed: on track, and paid hours count on business days only.' }
}

/**
 * (0.7.27) How urgent the name a client already has is, on the status list: its due time, or what pins it by R1. A reply, an OK,
 * a go or an internal ask the viewer owes keeps its name when it is at least as urgent, so it counts as the best of its colour;
 * a task falls under the list as it stands, and gives way only to something worse. Nothing of the viewer's own with a clock:
 * no name to keep.
 */
function namedRank(it: QueueItem, now: number): number {
  if (!Number.isFinite(ownActBy(it))) return goMine(it) ? RANK.behind - 0.5 : Infinity
  const due = hasDue(it) ? it.dueAt : Infinity
  const rank = due < now ? RANK.late : Number.isFinite(due) && isToday(due, now) ? RANK.dueToday : pinsNow({ dueAt: Infinity, actBy: ownActBy(it) }, now) ? RANK.dueSoon : Infinity
  const owed = (it.kind !== 'task' && it.kind !== 'pace' && it.kind !== 'queue') || openAsks(it).length > 0 || goMine(it)
  if (!owed) return rank
  if (rank <= RANK.dueToday) return RANK.late - 0.5
  return rank === RANK.dueSoon || goMine(it) ? RANK.behind - 0.5 : rank
}

/**
 * (0.7.27, Rob 2026-11-05: "worst one shown per item") The status a client's name shows, or null when the name it already has
 * stands (`titleFor`, `rowLine`): the worst of its pace row, a start-by passed with its work not started, and tickets that need
 * a due date, when that is worse than what the name says. Nothing of these: null, and nothing about the client changes.
 * ⛔ `pinReason` reads this too, so the sentence and the name never disagree.
 */
export function statusOf(it: QueueItem, now: number): ClientStatus | null {
  const found: ClientStatus[] = []
  const p = paceOf(it)
  if (p) found.push(paceStatus(p, now))
  const startBy = it.startBy
  if (typeof startBy === 'number' && Number.isFinite(startBy) && startBy <= now) found.push({ kind: 'behind', dot: '🟡', rank: RANK.behind, words: notStartedWords(startBy, now), at: hasDue(it) ? it.dueAt : NaN, why: '' })
  const undatedOpen = needsDateOf(it)
  if (undatedOpen > 0) {
    const why = `Pinned for you: ${several(undatedOpen, 'open ticket')} here ${undatedOpen === 1 ? 'has no due date and needs one' : 'have no due date and need one'}.`
    found.push({ kind: 'needs_date', dot: '🟡', rank: RANK.needsDate, words: 'needs a due date', at: NaN, why })
  }
  if (!found.length) return null
  const worst = found.reduce((a, b) => (b.rank < a.rank ? b : a))
  return namedRank(it, now) <= worst.rank ? null : worst
}

/** (0.7.27) What a pace-only client is listed for, in a word or two: `behind`, `on track`, `today's hours done`. */
export function paceWord(it: Pick<QueueItem, 'pace'>): string {
  const p = paceOf(it)
  if (!p) return 'work left'
  return hoursDone(p) ? "today's hours done" : p.state === 'on_track' ? 'on track' : p.state
}

/**
 * (0.7.27) ⛔ ABSENT MEANS NOT KNOWN (OW closeout-pace.ts: "a reader keeps what it had, and never takes the absence for
 * 'everyone is on track'"). How long the last pace rows are kept when OW leaves the key out because it could not read them:
 * 24 business hours, and past that nothing is known of them.
 */
export const PACE_KEPT_MS = DAY

/**
 * (0.7.27) The rows the last feed gave, for a feed with no `pace` key: what the reader keeps. Read on another Eastern day their
 * `hours_logged_today` is yesterday's, so it is dropped, which reads as not known (on track, still pinned). Null: nothing kept.
 */
export function keptPace(stored: unknown, now: number): FeedPace[] | null {
  const rec = stored as { at?: unknown; rows?: unknown } | null
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.rows) || typeof rec.at !== 'number' || !Number.isFinite(rec.at) || rec.at > now) return null
  if (!businessWithin(rec.at, now, PACE_KEPT_MS)) return null
  const rows = rec.rows as FeedPace[]
  if (isToday(rec.at, now)) return rows
  return rows.map(r => {
    if (!r || typeof r !== 'object') return r
    const { hours_logged_today: _old, ...rest } = r
    return rest
  })
}

/** (0.7.27) The founder's address: he is nobody's teammate to check on (OW src/lib/founder.ts, `FOUNDER_EMAIL`). */
const FOUNDER_EMAIL = 'rob@massmarket.ai'

// ---------------------------------------------------------------- 0.7.25: why a thread is pinned, said in the thread

/**
 * (0.7.25) Who wrote a client message, as a sentence names them: the display name before the address (`Jeff Smith
 * <jeff@acme.com>`), else the address's own part (`jeff.smith@acme.com` is `Jeff Smith`), cleaned; '' when neither.
 */
export function senderName(sender: unknown): string {
  const s = typeof sender === 'string' ? sender : ''
  const bare = s.replace(/<[^>]*>/g, ' ')
  if (!bare.includes('@')) return cleanText(bare, 40)
  const local = (/[^\s<>"',;]+@[^\s<>"',;]+/.exec(s)?.[0] ?? '').split('@')[0] ?? ''
  return cleanText(local.replace(/[._-]+/g, ' '), 40).replace(/(^|\s)\p{L}/gu, ch => ch.toUpperCase())
}

const several = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** (0.7.25) The first thing of the viewer's own on a client, in plain words: what a pinned thread's reason names. */
function ownReason(it: QueueItem): string {
  const o = it.open ?? null
  if (it.noReply === true) return `${it.client} is owed no reply, and one go closes it`
  if (o?.state === 'held_by_me') return `your draft to ${it.client} is not sent yet${o.unsent > 1 ? ` (${o.unsent} left)` : ''}`
  if (it.messages > 0 && !withTeammate(it) && !it.theirs && o?.state !== 'held_by_other') {
    const who = senderName(it.mail[0]?.sender) || it.client
    return `${who} is waiting on your reply${it.messages > 1 ? ` to ${it.messages} messages` : ''}${it.kind === 'ready' ? ', and the drafts are ready' : ''}`
  }
  if (it.kind === 'ready') return `the reply to ${it.client} is drafted and yours to send`
  if (it.kind === 'ok' && !it.theirs) {
    const sends = it.ok?.sends && it.ok.sends !== NOBODY ? ` (${it.ok.sends} sends it)` : ''
    return `the reply to ${it.client} waits on your OK${sends}`
  }
  const asks = openAsks(it)
  if (asks.length) return `${asks[0]?.asker || 'a teammate'} asked you something in Discord${asks.length > 1 ? ` (${asks.length} asks)` : ''}`
  const eta = etaAsksOf(it).length
  if (eta) return `you owe an ETA on ${several(eta, 'ticket')}`
  const owners = assignAsksOf(it).length
  if (owners) return `${several(owners, 'ticket')} ${owners === 1 ? 'needs' : 'need'} an owner from you`
  const committed = committedCount(it)
  if (committed === 1 && it.taskTitles[0]) return `your task "${cleanText(it.taskTitles[0], 60)}"`
  if (committed > 0) return `${several(committed, 'task')} of yours`
  return whatOf(it)
}

/**
 * (0.7.25) Why a client's thread is pinned, or why it is not, in one sentence the thread's band shows (Rob asked about 52
 * times in the six weeks to 2026-11-05 why a thread was pinned; 11-03: "Why does it say there's 23 hours left here? Do I
 * owe him something?" and "I don't know if this is supposed to be pinned for me or if the team is handling this"). It
 * says who must act, what is owed and to whom, and by when, from the same tests the pin itself is decided by (`ownPins`,
 * `checkNow`, and R8's `checking`, which unpins), so the sentence and the pin never disagree: it starts `Pinned` exactly when
 * the bridge pins the thread.
 *   Pinned for you, 3h late, due 3 PM: Jeff Smith is waiting on your reply, and the drafts are ready.
 *   Pinned for you: your task "Build the intake form" is due Fri 3 PM, and to land on time its work had to start Tue 3 PM.
 *   Pinned to check on Asif: their reply is due 3 PM (4h left).
 *   No pin needed: Asif has Acme Legal's reply drafts, so nothing here needs you.
 *   No pin needed: nothing of yours here has a due date.
 *   No pin needed: the next thing of yours is due Fri 3 PM, more than 24 business hours away.
 */
export function pinReason(it: QueueItem, now: number): string {
  // (R8) our send is being checked: the client is off the list and its thread unpinned, whatever its clock says
  const fast = fastState(it, now)
  if (fast?.state === 'checking') return `No pin needed: your reply went at ${clockText(fast.at, now)}, and the server is checking it answered everything.`
  // (0.7.27) what the client's name says, when a status names it (`statusOf`)
  const status = statusOf(it, now)
  if (ownPins(it, now)) {
    if (status?.why) return status.why
    const own = ownActBy(it)
    // a start-by (the work's own estimate at the client's pace) came before every due time: the work must start
    if (own < it.dueAt && committedCount(it) > 0 && it.messages === 0) {
      const due = clockText(shownDue(it.dueAt), now)
      return own <= now
        ? `Pinned for you: ${ownReason(it)} is due ${due}, and to land on time its work had to start ${dueWhen(own, now)}.`
        : `Pinned for you: ${ownReason(it)} is due ${due}, and to land on time its work must start by ${clockText(shownDue(own), now)}.`
    }
    const when = own <= now ? clockAndDue(own, now) : `due ${clockText(shownDue(own), now)} (${clockLead(own, now)})`
    return `Pinned for you, ${when}: ${ownReason(it)}.`
  }
  const c = checkNow(it, now)
  if (c) {
    const by = cleanText(c.by, 40) || 'a teammate'
    if (c.pace) return `Pinned to check on ${by}: ${paceClause(c.pace, false)}.`
    const when = c.late ? `is ${clockAndDue(c.due, now)}` : `${c.notStarted ? 'has not started and ' : ''}is due ${clockText(shownDue(c.due), now)} (${clockLead(c.due, now)})`
    return `Pinned to check on ${by}: their ${c.what} ${when}.`
  }
  // (0.7.27) today's hours are done, or on track on a day that is not a business day
  if (status?.why) return status.why
  // (0.7.23) a teammate's late package flagged for the founder's OK, with nothing of his own beside it. (0.7.27) He sees it once a day, on the 9 AM image
  if (okLateOnly(it)) return `No pin needed: ${cleanText(it.okLate?.by, 40) || 'a teammate'} holds the late reply to ${it.client}, flagged for your OK, and it is on the 9 AM image.`
  if (withTeammate(it)) return `No pin needed: ${it.theirs ?? it.open?.by ?? 'a teammate'} has ${it.client}'s reply drafts, so nothing here needs you.`
  if (lateOnly(it)) return `No pin needed: only ${whoseLate(matesOf(it))}'s late tickets are here, and they are on the 9 AM image.`
  if (it.kind === 'ok' && it.theirs) return `No pin needed: ${it.theirs} decides whether the reply to ${it.client} needs your OK.`
  if (it.kind === 'queue') return 'No pin needed: the internal queue has no due dates.'
  const own = ownActBy(it)
  if (!Number.isFinite(own)) return 'No pin needed: nothing of yours here has a due date.'
  return `No pin needed: the next thing of yours is due ${clockText(shownDue(own), now)}, more than 24 business hours away.`
}

/**
 * (0.7.25) The line a client's own thread shows under its band: `pinReason`, with how a pin stands beside it. `it`: the
 * client as the last sync listed it (Needs you, With a teammate or checking); undefined once the client is clear, named
 * by `client`. `pin.person`: the last sync found the person's own pin on the thread (`Pin.byUs` false), which the bridge
 * leaves (Rob, 2026-11-03: "if I pin something myself, it should stay there until I unpin it"). `pin.again`: the bridge
 * pinned it back after the person took its pin off while the client still needed them (`Pin.again`). '' with nothing to
 * say: a clear client with no name on record.
 */
export function threadWhy(it: QueueItem | undefined, client: string, now: number, pin: { person?: boolean; again?: boolean } = {}): string {
  if (!it) {
    const name = cleanName(client)
    if (!name) return ''
    return `No pin needed: nothing of ${name}'s waits on you.${pin.person ? ' You pinned it yourself, so it stays until you unpin it.' : ''}`
  }
  const why = pinReason(it, now)
  if (why.startsWith('Pinned')) return pin.again ? `${why} You took its pin off, and it still needs you.` : why
  return pin.person ? `${why} You pinned it yourself, so it stays until you unpin it.` : why
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
export function whoseLate(refs: readonly Pick<MateRef, 'by'>[]): string {
  const names = [...new Set(refs.map(r => r.by))]
  if (names.length <= 1) return names[0] ?? 'a teammate'
  return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more`
}

// ---------------------------------------------------------------- 0.7.21: Team · late, the founder's teammates' late tickets

/**
 * (0.7.21) A client listed for the founder by his teammates' late internal tickets alone: nothing of his own there (no task,
 * no client message, no package, no ask, no internal queue), as the pass decides it (`build`). It stays in the quiet list,
 * so its thread is named `🟡 with <teammate> · <client> · no ETA` and never pinned by the bridge, but the pane draws it under
 * Team · late only, never under With a teammate. An item a 0.7.20 bridge stored is read the same way.
 */
export const lateOnly = (it: QueueItem): boolean =>
  matesOf(it).length > 0 && it.kind === 'task' && it.tasks === 0 && it.messages === 0 && !it.packageId && !(it.open ?? null) && openAsks(it).length === 0 && queuedOf(it).length === 0

/**
 * (0.7.23) Whether something of the founder's own lists a client beside a package of a teammate's: a task, an internal ask
 * or his internal queue, a client message whose drafts no teammate holds, or (0.7.24) his own go on follow-up steps.
 */
export const ownBesides = (it: QueueItem): boolean =>
  it.tasks > 0 || openAsks(it).length > 0 || queuedOf(it).length > 0 || (it.messages > 0 && (it.open ?? null)?.state !== 'held_by_other') || goMine(it)

/**
 * (0.7.23) A client listed for the founder by a teammate's late package flagged for his OK alone (`okLate`, nothing of his
 * own there): it stays in the quiet list, its thread named for the teammate (`🟡 with Asif · Acme Legal · may need your OK
 * · Asif decides`) and never pinned, and the pane draws it under Team · late alone, as a `lateOnly` client is.
 */
export const okLateOnly = (it: QueueItem): boolean => it.kind === 'ok' && Boolean(it.okLate) && !ownBesides(it)

/** (0.7.23) A client the pane draws under Team · late alone, never under With a teammate. */
export const teamLateOnly = (it: QueueItem): boolean => lateOnly(it) || okLateOnly(it)

/** (0.7.21) The pane group's title, and what the status line says after its count (`MM: 4 need you · 2 pinned · 5 late with the team`). */
export const TEAM_LATE = 'Team · late'
export const LATE_WITH_TEAM = 'late with the team'

/** (0.7.21) One teammate in Team · late: their name, how many of their tickets are late, and those tickets by client. */
export type TeamLate = { by: string; count: number; clients: Array<{ projectId: string; client: string; refs: MateRef[] }> }

/**
 * (0.7.21, Rob 2026-11-05: "It should show people and which tasks are overdue for which clients, so I can run through those
 * with the team in the morning") The founder's teammates' late internal tickets (`mates`, on whichever of his items carries
 * them: his own rows' and `lateOnly` ones alike), each ticket once, grouped by person, then client. People by how many are
 * late, most first (a tie by name); a person's clients by their first late ticket; a client's tickets by when each went
 * late. Empty for every viewer but the founder: no other feed gives `mates`. ⛔ Feed text is data: an id that is not a
 * lower-case uuid, a time that is not one, or a title with nothing left once cleaned drops the ticket. (0.7.23) A package
 * flagged for his OK that a teammate holds or sends and whose reply is late (`okLate`) is one more line under that
 * teammate and client (`reply 1d late, flagged for your OK`), counted with the tickets.
 */
export function teamLate(items: readonly QueueItem[]): TeamLate[] {
  const seen = new Set<string>()
  const people = new Map<string, Map<string, { projectId: string; client: string; refs: MateRef[] }>>()
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    // (0.7.23) and a package flagged for his OK that a teammate holds or sends, once late (`okLate`): one line, `reply`
    const ok = it.okLate && typeof it.okLate === 'object' ? [{ by: it.okLate.by, id: it.okLate.id, title: 'reply', lateSince: it.okLate.lateSince, eta: false, ok: true as const }] : []
    for (const r of [...matesOf(it), ...ok]) {
      if (!r || typeof r !== 'object' || !isUuid(r.id) || seen.has(r.id) || !Number.isFinite(r.lateSince)) continue
      const title = cleanText(r.title, MATE_TITLE_MAX)
      if (!title) continue
      seen.add(r.id)
      const by = cleanText(r.by, 40) || 'a teammate'
      const clients = people.get(by) ?? new Map<string, { projectId: string; client: string; refs: MateRef[] }>()
      const at = clients.get(it.projectId) ?? { projectId: it.projectId, client: cleanName(it.client) || cleanName(it.projectName) || 'a client', refs: [] }
      at.refs.push({ by, id: r.id, title, lateSince: r.lateSince, eta: r.eta === true, ...(r.ok === true ? { ok: true as const } : {}) })
      clients.set(it.projectId, at)
      people.set(by, clients)
    }
  }
  const byName = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' })
  const out: TeamLate[] = []
  for (const [by, clients] of people) {
    const list = [...clients.values()].map(c => ({ ...c, refs: [...c.refs].sort((a, b) => a.lateSince - b.lateSince || byName(a.title, b.title)) }))
    list.sort((a, b) => (a.refs[0]?.lateSince ?? 0) - (b.refs[0]?.lateSince ?? 0) || byName(a.client, b.client))
    out.push({ by, count: list.reduce((n, c) => n + c.refs.length, 0), clients: list })
  }
  return out.sort((a, b) => b.count - a.count || byName(a.by, b.by))
}

/** (0.7.21) How many tickets Team · late holds. */
export const teamLateCount = (team: readonly Pick<TeamLate, 'count'>[]): number => team.reduce((n, p) => n + (Number.isFinite(p.count) ? p.count : 0), 0)

/** (0.7.21) Who is late with how many, as `mm status` says it: `Asif 20, Antu 9`. */
export const teamLateWho = (team: readonly Pick<TeamLate, 'by' | 'count'>[]): string => team.map(p => `${p.by} ${p.count}`).join(', ')

/**
 * (0.7.21) One ticket's line in Team · late: its title, when it went late in the bridge's clock text for a late item's due
 * time (`dueWhen`: `3 PM` today, `Mon 3 PM` this week, `Oct 14` before that, never a weekend day), and why it is late:
 * `no ETA given` (its ETA was needed by then and none came), else `past its ETA`.
 */
export function teamLateLine(r: Pick<MateRef, 'title' | 'lateSince' | 'eta' | 'ok'>, now: number): string {
  // (0.7.23) a teammate's late package flagged for his OK: how late its reply is, `reply 1d late, flagged for your OK`
  if (r.ok === true) return `reply ${clockLead(r.lateSince, now)}, flagged for your OK`
  return `${cleanText(r.title, MATE_TITLE_MAX)} · late since ${dueWhen(r.lateSince, now)} · ${r.eta ? 'no ETA given' : 'past its ETA'}`
}

/** (0.7.21) What the status line adds after `· P pinned`: ` · 5 late with the team`, or '' with none (every viewer but the founder). */
export const teamLateSegment = (count: number): string => (Number.isFinite(count) && count > 0 ? ` · ${count} ${LATE_WITH_TEAM}` : '')

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
 * One pass over the feed: everything still open that was due on or after the cut (`listCutoff`: the floor,
 * LIST_FLOOR_MS, or (0.7.12) 3 weeks back once that is later), however overdue, everything not due yet, however far
 * ahead, and what has no due time. (Until 2026-10-20 the cut was 3 business days back; Rob replaced it with
 * LIST_FLOOR_MS. Until 0.7.12 a second pass took what was due before the floor, for Older.)
 */
function build(feed: Feed, now: number, cut: number = listCutoff(now)): QueueItem[] {
  // ⛔ (0.7.12) Not considered at all: due before the cut, and more than 3 business days ago (WINDOW_BACK_MS: from Sat
  // 2026-10-17 12:00 AM ET on, everything due before the cut is, so the cut alone decides). `cut` is the cut itself;
  // only `pastCutClients` passes another (none at all), to tell which clients the cut alone cleared.
  const tooOld = (due: number): boolean => due < now && due < cut && !businessWithin(due, now, WINDOW_BACK_MS)
  // (0.5.2, R1) everything else with a due time is this pass's: overdue since the cut, or not due yet however far
  // ahead; whether it pins is `pinsNow`
  const inWindow = (due: number): boolean => Number.isFinite(due) && !tooOld(due)
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
  // (0.7.18) Who each act-by is for, kept apart so a teammate's part never pins the viewer while its time is left: the
  // viewer's own parts (a package of theirs, their tickets and asks), the client's messages (their reply is the viewer's
  // unless a teammate holds the drafts), and a package that waits for the founder's OK (his unless a teammate decides on it).
  // Settled once the pass knows whose each is (`own`, `watch`, at the end).
  const ownAct = new Map<string, number>()
  const mailAct = new Map<string, number>()
  const okAct = new Map<string, number>()
  const soonest = (into: Map<string, number>, it: QueueItem, at: number): void => {
    if (Number.isFinite(at)) into.set(it.projectId, Math.min(into.get(it.projectId) ?? Infinity, at))
  }
  /** (0.7.18) An act-by of the viewer's own. */
  const mine = (it: QueueItem, at: number): void => {
    act(it, at)
    soonest(ownAct, it, at)
  }

  /** (0.7.18, the PM) The window the PM checks on a teammate's part with; null for every other viewer. */
  const pmAhead = feed.role === 'pm' ? PM_CHECK_AHEAD_MS : null
  /** (0.7.18, the PM) His teammates' parts to check on now, by project. */
  const pmWatch = new Map<string, { name: string; refs: WatchRef[] }>()
  /** (0.7.18, the PM) The same, sorted, once they are on their items. */
  const pmRefs = new Map<string, WatchRef[]>()
  const viewer = typeof feed.member === 'string' ? feed.member.toLowerCase() : ''
  /** (0.7.27) A teammate, by address: somebody named who is neither the viewer nor the founder (nobody checks on him). */
  const isTeammate = (who: string): boolean => who !== '' && who !== viewer && who !== FOUNDER_EMAIL
  /**
   * (0.7.27, Rob 2026-11-05: "everything that's yellow or red should show up pinned for H9 as well if it's yellow or red for any
   * of the team members") A teammate's reply on the PM's feed: on his list as soon as it pins for them, late or within 24
   * business hours. One a client, per teammate: the soonest.
   */
  const watchReply = (pid: string, name: string, who: string, due: number): void => {
    if (pmAhead === null || !isTeammate(who) || !inWindow(due) || (due > now && !businessWithin(now, due, pmAhead))) return
    const watch = pmWatch.get(pid) ?? { name, refs: [] }
    const by = holderName(who)
    const had = watch.refs.find(r => r.what === 'reply' && r.by === by)
    if (had) had.due = Math.min(had.due, due)
    else watch.refs.push({ by, due, what: 'reply' })
    pmWatch.set(pid, watch)
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
    soonest(mailAct, it, due)
    if (it.kind === 'task') it.kind = 'reply'
    it.mail.push({ at: m.received_at, sender: m.sender ?? '?', subject: m.subject ?? '', snippet: m.snippet ?? '' })
    seen(it, 'mail', ms(m.received_at))
  }
  for (const m of feed.mail ?? []) {
    if (m.reply_status !== 'unanswered' || !m.project_id || !m.project_name) continue
    if (!usable(m.project_id, m.project_name)) continue
    if (!isMine(m.project_owner_email, feed)) {
      watchReply(m.project_id, m.project_name, (m.project_owner_email ?? '').toLowerCase(), replyDue(m))
      continue
    }
    const due = replyDue(m)
    if (due === Infinity) {
      const it = item(m.project_id, m.project_name)
      countMail(it, m, due)
      undated(it)
      continue
    }
    if (!inWindow(due)) continue
    countMail(item(m.project_id, m.project_name), m, due)
  }

  const me = typeof feed.member === 'string' ? feed.member.toLowerCase() : ''
  /**
   * (the founder) The clients whose row is a package that waits for his OK and that a teammate sends (R2). (0.7.23) With that
   * teammate's address (the holder's, else the owner's on record): an ask of theirs about the client hands him the OK.
   */
  const okTheirs = new Map<string, string>()
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
    // (0.7.27, OW #638) A package that owes no reply has no draft to count, and still lists: dropped, its client pinned as an unanswered reply.
    const noReply = d.no_reply === true
    if (held ? (unsent < 1 && !noReply) || holder === '' : (d.status !== 'prepared' && d.status !== 'stale') || (ready < 1 && !noReply)) continue
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
    // (its reply time on or after the cut, or none; (0.7.12) one due before the cut is not considered)
    const inReach = noDue || !tooOld(due)
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
      if (noReply) it.noReply = true
      else delete it.noReply
      // (R8) what the server's check of our latest send found on this package
      it.check = checkOf(d)
      if (inReach) {
        it.dueAt = Math.min(it.dueAt, due)
        mine(it, due)
        if (noDue) undated(it)
        seen(it, 'pkg', ms(d.covers_through))
      }
      it.open = heldByMe ? open('held_by_me') : null
      continue
    }
    // (0.7.27, the PM) a package a teammate holds, or a prepared one of a teammate's client: pinned for them, so on his list too
    if (!noDue && d.status !== 'stale') watchReply(d.project_id, d.project_name, held ? holder : sender, due)
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
        mine(it, due)
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
      // R2: one a teammate sends is theirs to decide (below)
      if (mates) okTheirs.set(d.project_id, held ? holder : sender)
      else okTheirs.delete(d.project_id)
      if (inReach) {
        // (0.7.23) its due time goes on the client's clock below, once it is known whose it is
        act(it, due)
        soonest(okAct, it, due)
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
      // (0.7.25) the client's move, not ours: no row, no pin, no late count, for the viewer, the PM or the founder
      if (!tk || waitingOnClient(tk)) continue
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
        // (0.7.18, Rob 2026-11-03: "Probably should [surface] to H9 before it [surfaces] to me when something's late or
        // hasn't been started on and it should have been, judging by the hours") The PM's feed lists his teammates' tickets
        // (OW `ticketVisible`). A committed one on a client reaches him only once he should check on it: late, due within
        // PM_CHECK_AHEAD_MS, or past its start-by (`start_by_at`, as OW sends it) with no sign its work started (OW status
        // `in_progress`). It counts nothing of his and goes in no kickoff. Any other teammate's ticket: nothing, as before.
        // ⛔ (0.7.27) Never for an undated item, an ETA ask included; and the founder's ticket is nobody's to check on.
        if (pmAhead !== null) {
          if (!isTeammate(assignee) || undatedRow || etaAsk || internalRow || internal.has(tk.project_id) || !isUuid(tk.ticket_id) || !inWindow(due)) continue
          const startBy = ms(tk.start_by_at)
          const late = due <= now
          const notStarted = !late && Number.isFinite(startBy) && startBy <= now && tk.status !== 'in_progress'
          if (!late && !notStarted && !businessWithin(now, due, pmAhead)) continue
          const title = cleanText(tk.title, MATE_TITLE_MAX)
          if (!title) continue
          const watch = pmWatch.get(tk.project_id) ?? { name: tk.project_name, refs: [] }
          if (!watch.refs.some(r => r.id === tk.ticket_id)) {
            watch.refs.push({ by: holderName(assignee), due, what: 'task', id: tk.ticket_id, title, ...(notStarted ? { startBy } : {}) })
          }
          pmWatch.set(tk.project_id, watch)
          continue
        }
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
      // (a ticket nobody dated has no due time to cut by: it lists, undated)
      if (!(undatedRow && !etaAsk) && !inWindow(due)) continue
      // (0.7.27, Rob 2026-11-05: "Shouldn't it be pinned?") ...but by its last activity, once OW sends it: inside the window it
      // pins for its owner as `needs a due date`; outside it counts nowhere; with nothing to measure by, it lists as before.
      // (0.7.30) ...and never for a ticket its owner picks up when ready: it lists undated, as one with nothing to measure by.
      const undatedPlace = undatedRow && !etaAsk && !ownerWhenReady(tk) ? undatedWindow(tk, cut) : 'unknown'
      if (undatedPlace === 'outside') continue
      // (0.7.15, owner asks) a dated ticket on H9's `assign_by` clock: due then, to be given an owner by then (or taken
      // and given an ETA), never delivered by then. OW prints no label for it: the row, the pane and the kickoff do.
      const assignAsk = !undatedRow && tk.commitment_basis === ASSIGN_BY_BASIS
      // (0.7.4, ETA asks) the ticket id goes into the kickoff, for its ETA to be recorded against: a lower-case uuid;
      // (0.7.15) so does an owner ask's, for an ETA if the viewer takes it
      if ((etaAsk || assignAsk) && !isUuid(tk.ticket_id)) continue
      if (typeof tk.ticket_id === 'string') counting.add(tk.ticket_id)
      const it = item(tk.project_id, tk.project_name)
      it.tasks += 1
      it.dueAt = Math.min(it.dueAt, due)
      // R1: a task acts by its start-by time when the feed gives one (OW's `start_by_at`, from the ticket's
      // estimate), else by its due time. (0.7.15) An owner ask acts by its clock: the estimate is the work's, not the
      // assigning's.
      const startBy = assignAsk ? NaN : ms(tk.start_by_at)
      mine(it, Number.isFinite(startBy) && startBy < due ? startBy : due)
      // (0.7.27) past it with no sign the work started, the client is `behind · not started` (`statusOf`)
      if (Number.isFinite(startBy) && startBy < due && tk.status !== 'in_progress') it.startBy = Math.min(it.startBy ?? Infinity, startBy)
      if (undatedPlace === 'inside') it.needsDate = needsDateOf(it) + 1
      if (undatedRow && !etaAsk) undated(it)
      if (k === 'undated') it.undatedTasks = (it.undatedTasks ?? 0) + 1
      if (etaAsk) it.etaAsks = [...etaAsksOf(it), { id: tk.ticket_id, title: cleanText(tk.title, MATE_TITLE_MAX) || 'Untitled ticket', neededBy }].sort((a, b) => a.neededBy - b.neededBy)
      if (assignAsk) it.assignAsks = [...assignAsksOf(it), { id: tk.ticket_id, title: cleanText(tk.title, MATE_TITLE_MAX) || 'Untitled ticket', assignBy: due }].sort((a, b) => a.assignBy - b.assignBy)
      // (0.7.4, ETA asks) a ticket of a teammate's own on an internal project: the item is theirs to work as a client's
      if (!founder && internal.has(tk.project_id)) it.assigned = true
      // the pane lists each task under what it is: a committed date, an ETA owed (`etaAsks`), an owner to give
      // (`assignAsks`), or no date at all
      if (undatedRow && !etaAsk) it.undatedTitles = [...(it.undatedTitles ?? []), tk.title]
      else if (!etaAsk && !assignAsk) it.taskTitles.push(tk.title)
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
  /** (0.7.23) Who asked the viewer about each client in an open ask of theirs (addresses, lower case). */
  const askers = new Map<string, Set<string>>()
  for (const a of Array.isArray(feed.asks) ? feed.asks : []) {
    if (!a || typeof a !== 'object' || !isUuid(a.ask_id) || askIds.has(a.ask_id)) continue
    if (!usable(a.project_id, a.project_name)) continue
    if (me === '' || typeof a.asked_email !== 'string' || a.asked_email.toLowerCase() !== me) continue
    const asked = ms(a.asked_at)
    const due = Number.isFinite(ms(a.due_at)) ? ms(a.due_at as string) : Number.isFinite(asked) ? businessDeadline(asked, DAY) : NaN
    if (!inWindow(due)) continue
    askIds.add(a.ask_id)
    if (typeof a.asker_email === 'string' && a.asker_email) askers.set(a.project_id, (askers.get(a.project_id) ?? new Set<string>()).add(a.asker_email.toLowerCase()))
    const it = item(a.project_id, a.project_name)
    it.dueAt = Math.min(it.dueAt, due)
    mine(it, due)
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
  const queued = ownQueueRows(feed).filter(q => !counting.has(q.ticket_id))
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

  // (0.7.24, Rob 2026-11-04: "if it's approved, it shouldn't show up to me at all ... unless the system comes up with some
  // new follow-ups that I had left off somewhere that aren't approved. That's the only time it should surface to me";
  // "If the other one's supposed to give approval, it should show up for them as soon as possible") Follow-up steps nobody
  // approved, on a follow-ups-only package (OW's `go_` keys: an ask we sent by hand). The go is the package's sender's (OW's
  // `go_by`), the founder's when nobody is named, as a client with no owner on record is (`isMine`). Theirs: listed, due
  // when the first step's window opens, and pinned at once (`ownPins`). For the founder and the PM a teammate's go is a
  // part to check on (`watch`, below), pinned only once nearly due or late; any other viewer: nothing. ⛔ A package the
  // drafts list carries is a reply package: its steps are approved with its reply, and it is not listed twice. ⛔ The
  // package id goes into the kickoff and the pickup request: a lower-case uuid, or the row is dropped, as a package's is.
  // ⛔ (0.7.12) A first step whose window opened before the cut is not considered, as anything due before it.
  /** (0.7.24) A teammate's go the viewer watches, by project: when the first step's window opens. */
  const goAct = new Map<string, number>()
  const draftPackages = new Set((feed.drafts ?? []).map(d => d?.package_id).filter(isUuid))
  const watchesGo = founder || feed.role === 'pm'
  for (const p of Array.isArray(feed.projects) ? feed.projects : []) {
    const f = p && typeof p === 'object' ? p.followups : null
    if (!f || typeof f !== 'object') continue
    const steps = typeof f.go_steps === 'number' && Number.isSafeInteger(f.go_steps) ? f.go_steps : 0
    if (steps < 1 || !isUuid(f.go_package_id) || draftPackages.has(f.go_package_id)) continue
    if (!usable(p.project_id, p.name)) continue
    const by = typeof f.go_by === 'string' ? f.go_by.trim().toLowerCase() : ''
    const mineGo = by !== '' ? by === me : founder
    if (!mineGo && !watchesGo) continue
    const first = ms(f.go_first_at)
    if (Number.isFinite(first) && !inWindow(first)) continue
    const it = item(p.project_id, p.name)
    it.go = { packageId: f.go_package_id, steps, firstAt: Number.isFinite(first) ? first : null, firstKind: typeof f.go_first_kind === 'string' && /^[a-z_]{1,24}$/.test(f.go_first_kind) ? f.go_first_kind : '', by: mineGo ? '' : holderName(by), mine: mineGo }
    if (Number.isFinite(first)) {
      it.dueAt = Math.min(it.dueAt, first)
      act(it, first)
      soonest(mineGo ? ownAct : goAct, it, first)
    } else if (mineGo) undated(it)
    // listed by its go alone: what its title and chip call it (a client message, a package, a task or an ask keeps its own)
    if (it.kind === 'task' && it.tasks === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0) it.kind = 'go'
  }

  // (0.7.27, Rob 2026-11-05, "Yes, approve it") Each holder's pace on each client with quoted work left. The viewer's own row
  // goes on the client's item, and lists it even with nothing else open, due at its date: it pins by `pacePins`, never by a
  // clock (`ownAct` stays out of it). For the PM a teammate's row reading late, overbooked or behind is a part to check on;
  // ⛔ never their on-track row, and never a row nobody holds. ⛔ `pace` absent changes nothing here, and is never read as
  // everyone on track: `keptPace` is the reader's memory of it.
  for (const row of Array.isArray(feed.pace) ? feed.pace : []) {
    if (!row || typeof row !== 'object' || !usable(row.project_id, row.project_name)) continue
    const ref = paceRefOf(row)
    if (!ref) continue
    const holder = typeof row.holder_email === 'string' ? row.holder_email.trim().toLowerCase() : ''
    if (holder !== '' && holder === viewer) {
      const it = item(row.project_id, row.project_name)
      const had = paceOf(it)
      if (!had || paceStatus(ref, now).rank < paceStatus(had, now).rank) it.pace = ref
      if (it.kind === 'task' && it.tasks === 0 && openAsks(it).length === 0 && queuedOf(it).length === 0) it.kind = 'pace'
      continue
    }
    if (pmAhead === null || ref.state === 'on_track' || !isTeammate(holder)) continue
    const watch = pmWatch.get(row.project_id) ?? { name: row.project_name, refs: [] }
    watch.refs.push({ by: holderName(holder), due: ref.date, what: 'pace', pace: ref })
    pmWatch.set(row.project_id, watch)
  }
  for (const it of byProject.values()) {
    const p = paceOf(it)
    if (it.kind === 'pace' && p) it.dueAt = Math.min(it.dueAt, p.date)
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
      // ⛔ (0.7.23, Rob 2026-11-05: "I thought we made it so that when a teammate's holding it, but it's late, it shows up on
      // the morning meeting post instead of pinned on my side panel"; and the same day: "When things are overdue but not
      // assigned to me, I don't think they should be pinned here.") A package flagged for his OK that a teammate holds or
      // sends stays theirs after its reply is due too: until 0.7.21 it became his then (`needs your OK`, pinned, and
      // pinned again as `still needs you` when he took the pin off). Once late it is listed under Team · late (`okLate`).
      // It is his only when that teammate asks him about the client (an open ask of theirs in the feed: the one signal OW
      // sends for it); his own client's flagged package (`ready`) is his as before.
      const mate = okTheirs.get(it.projectId)
      const askedHim = mate !== undefined && mate !== '' && (askers.get(it.projectId)?.has(mate) ?? false)
      const name =
        it.kind === 'ok'
          ? mate !== undefined && !askedHim ? (o?.state === 'held_by_other' ? o.by : (it.ok ?? null)?.sends) : undefined
          : it.kind === 'ready' ? undefined : staleTheirs.get(it.projectId)
      if (name) it.theirs = name
      if (it.kind !== 'ok') continue
      const okDue = okAct.get(it.projectId)
      if (okDue === undefined) continue
      // late once past its due time, as its clock reads (`clockLead`: at the minute it is due it is `<1h left`)
      const late = Boolean(name) && okDue < now && o !== null && isUuid(o.id)
      if (late) it.okLate = { by: name as string, id: (o as OpenPackage).id, lateSince: okDue }
      // its due time is on the client's clock, unless it is a teammate's and late and something of his own lists the
      // client: his row and his thread's name are then for what is his (as his teammates' late tickets are, 0.7.21)
      if (!(late && ownBesides(it))) it.dueAt = Math.min(it.dueAt, okDue)
    }
  }

  // (0.7.4, for the founder) His teammates' late internal tickets, on their clients' items. Where nothing of his own lists
  // the client (`lateOnly`), it is in the quiet list, named for whose they are (`theirs`) and due when the first went late:
  // never pinned, never counted. Where something of his does, his row is for that (B1). A client whose drafts a teammate
  // holds keeps who holds them. ⛔ (0.7.21, Rob 2026-11-05: "It should show people and which tasks are overdue for which
  // clients, so I can run through those with the team in the morning") The pane shows them under Team · late alone
  // (`teamLate`): by person, then client. They no longer ride on his rows (0.7.4 to 0.7.20: `2 late with Asif`), a
  // `lateOnly` client is not drawn under With a teammate, and none of them pins his thread (0.7.18 to 0.7.20 did).
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

  // (0.7.18, the PM) His teammates' tickets to check on, on their clients' items, as the founder's late ones are above: where
  // nothing of his own lists the client, it lists under With a teammate, named for whose they are and due at the first.
  // (0.7.27) And their replies: a reply a teammate holds the drafts of is the holder's, whoever owns the client, and one whose
  // drafts the PM holds himself is no teammate's. A package of a teammate's beside them (held, or prepared) is nothing of his.
  for (const [pid, w] of pmWatch) {
    const it = byProject.get(pid) ?? item(pid, w.name)
    const o = it.open ?? null
    const refs = w.refs
      .filter(r => r.what !== 'reply' || o?.state !== 'held_by_me')
      .map(r => (r.what === 'reply' && o?.state === 'held_by_other' && o.by ? { ...r, by: o.by } : r))
      .sort((a, b) => a.due - b.due)
    pmRefs.set(pid, refs)
    const first = refs[0]
    const nothingOwn = it.kind === 'task' && it.tasks === 0 && it.messages === 0 && !it.packageId && (!o || o.state === 'held_by_other' || o.state === 'prepared') && openAsks(it).length === 0 && queuedOf(it).length === 0
    if (first && nothingOwn && !it.theirs) {
      it.dueAt = Math.min(it.dueAt, first.due)
      it.theirs = whoseLate(refs)
    }
  }

  // (0.7.24, for the founder and the PM) A teammate's go on follow-up steps, where nothing of the viewer's own lists the
  // client: it lists under With a teammate, named for whose it is, as their late tickets do above.
  for (const it of byProject.values()) {
    const g = goOf(it)
    if (!g || g.mine || it.theirs) continue
    const nothingOwn = (it.kind === 'task' || it.kind === 'go') && it.tasks === 0 && it.messages === 0 && !it.packageId && !it.open && openAsks(it).length === 0 && queuedOf(it).length === 0
    if (nothingOwn) it.theirs = g.by
  }

  // (0.7.18, Rob 2026-11-03: "The pinned is for when action is needed from you, not when something has a timer left for a
  // teammate to answer") Whose each part is, now that the pass knows: the client's messages are a teammate's to answer when
  // a teammate holds the drafts (or, for the founder, R1's stale package is theirs), and a package that waits for his OK is
  // theirs to decide while `theirs` says so (R2). `own` is the rest: what pins (`pinsFor`). The founder and the PM watch
  // the teammates' parts (`watch`), which pin only once late or nearly due (`checkNow`).
  const ahead = checkAheadOf(feed.role)
  const reported = memberPinsByName(feed)
  for (const it of byProject.values()) {
    const pid = it.projectId
    const o = it.open ?? null
    const mailTheirs = o?.state === 'held_by_other' || staleTheirs.has(pid)
    const okIsTheirs = it.kind === 'ok' && Boolean(it.theirs)
    const mail = mailAct.get(pid) ?? Infinity
    const ok = okAct.get(pid) ?? Infinity
    it.own = Math.min(ownAct.get(pid) ?? Infinity, mailTheirs ? Infinity : mail, okIsTheirs ? Infinity : ok)
    if (ahead === null) continue
    const watch: WatchRef[] = []
    if (mailTheirs && Number.isFinite(mail)) watch.push({ by: o?.state === 'held_by_other' ? o.by : (staleTheirs.get(pid) ?? it.theirs ?? ''), due: mail, what: 'reply' })
    if (okIsTheirs && Number.isFinite(ok)) watch.push({ by: o?.state === 'held_by_other' ? o.by : (it.theirs as string), due: ok, what: 'reply' })
    watch.push(...(pmRefs.get(pid) ?? []))
    // (0.7.24) a teammate's go on follow-up steps, due when the first step's window opens
    const go = goAct.get(pid) ?? Infinity
    const g = goOf(it)
    if (g && !g.mine && Number.isFinite(go)) watch.push({ by: g.by, due: go, what: 'follow-ups go' })
    // (0.7.27, approved 2026-11-05: "H9's row says pinned / not pinned for <teammate> from the pin reports") from each
    // teammate's report: an entry for them that lists the client says which, one that does not list it says not pinned, and
    // with no entry for them (or no key at all) nothing is said
    if (watch.length) it.watch = watch.map(w => withReportedPin(w, reported, pid)).sort((a, b) => a.due - b.due)
    // (0.7.21) the PM alone (`checkAheadOf`): the founder's teammates' parts never pin his threads
    if (watch.length) it.checkAhead = ahead
  }

  // (R17) a client with nothing dated is listed too, last
  return [...byProject.values()]
    .filter(i => Number.isFinite(i.dueAt) || i.noDue === true)
    .sort(byDue)
}

/** (0.7.27) The PM's `member_pins`, by the name a watched part carries: each teammate's report as client id to pinned. */
function memberPinsByName(feed: Feed): Map<string, Map<string, boolean>> {
  const out = new Map<string, Map<string, boolean>>()
  for (const entry of Array.isArray(feed.member_pins) ? feed.member_pins : []) {
    if (!entry || typeof entry.member_email !== 'string' || !entry.member_email || !Array.isArray(entry.items)) continue
    const clients = new Map<string, boolean>()
    for (const row of entry.items) if (row && typeof row.project_id === 'string' && typeof row.pinned === 'boolean') clients.set(row.project_id, row.pinned)
    out.set(holderName(entry.member_email.toLowerCase()), clients)
  }
  return out
}

function withReportedPin(w: WatchRef, reported: Map<string, Map<string, boolean>>, pid: string): WatchRef {
  const report = reported.get(w.by)
  return report ? { ...w, pin: report.get(pid) === true } : w
}

// ---------------------------------------------------------------- names

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A moment in New York: its weekday (`Mon`), its calendar date as a key, its time (`3 PM`, `3:30 PM`), and (0.7.12) its
 * month and day (`Oct 14`) and its date as a whole number of days (`serial`), to count calendar days back by.
 */
function etParts(t: number): { day: string; date: string; time: string; md: string; serial: number } {
  try {
    const d = new Date(t)
    const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d)
    const time = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
      .format(d)
      .replace(':00', '')
    const [m = 1, dd = 1, y = 1970] = date.split('/').map(Number)
    return { day, date, time, md: `${MONTHS[m - 1] ?? ''} ${dd}`, serial: Math.round(Date.UTC(y, m - 1, dd) / DAY) }
  } catch {
    // No Intl time zones: Eastern daylight time, which covers the weeks this ships in.
    const d = new Date(t - 4 * HOUR)
    const h = d.getUTCHours()
    const mm = d.getUTCMinutes()
    const time = `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
    return {
      day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] ?? '', date: d.toISOString().slice(0, 10), time,
      md: `${MONTHS[d.getUTCMonth()] ?? ''} ${d.getUTCDate()}`, serial: Math.floor(d.getTime() / DAY),
    }
  }
}

/**
 * (0.7.12) A due time as it is shown: never on a Saturday or a Sunday (Rob, 2026-10-12: only business days count in a
 * client's timeline). One that falls there is shown as 11:59 PM of the Friday before, as `businessDeadline` gives a
 * deadline that ends with a business day: no later in business time, so how late it reads does not change.
 */
export function shownDue(due: number): number {
  return Number.isFinite(due) && !isBusinessTime(due) ? subtractBusinessMs(due, 0) - 60_000 : due
}

/**
 * (0.7.12, Rob 2026-10-30: "If there's something the system thinks is overdue, it should also say that when it was")
 * When a late item was due, in New York time: `3 PM` earlier today, `Mon 3 PM` one to six days back, `Oct 14` before
 * that (a weekday name further back would read as this week's). Never a weekend day (`shownDue`).
 */
export function dueWhen(due: number, now: number): string {
  const a = etParts(shownDue(due))
  const back = etParts(now).serial - a.serial
  return back <= 0 ? a.time : back <= 6 ? `${a.day} ${a.time}` : a.md
}

/** How late, as `overdue` and `late` say it: `6h`, `2d`. Business time: weekends do not count. */
function lateSpan(due: number, now: number): string {
  const late = businessMsBetween(due, now) // weekends do not count toward how late
  // R16 (0.5.2): whole business days COMPLETED, so 1.5 days late is `1d` everywhere, never `2d` in one place
  return late < DAY ? `${Math.max(1, Math.round(late / HOUR))}h` : `${Math.floor(late / DAY)}d`
}

/**
 * When something is due, as a chip and a recommendation say it: `due 3 PM`, `due tomorrow 3 PM`, `due Fri 3 PM`; once
 * late, how late and (0.7.12) when it was due: `overdue 6h, due Mon 3 PM`.
 */
export function whenText(due: number, now: number): string {
  if (due < now) return `overdue ${lateSpan(due, now)}, due ${dueWhen(due, now)}`
  const a = etParts(shownDue(due))
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
 * never had an ETA, else `past ETA`. (0.7.15) A client whose only tasks are to give an owner: `assign an owner`. (0.7.24) A
 * client listed by follow-up steps that wait for a go alone: `follow-ups need your go · first text Fri Nov 6`.
 */
const whatOf = (it: QueueItem): string =>
  it.noReply === true
    ? NO_REPLY_WHAT
    : it.open?.state === 'held_by_me'
    ? 'your draft'
    : it.kind === 'ok' ? (it.okLate && ownBesides(it) ? ownWhat(it) : it.theirs ? decidesText(it.theirs) : 'needs your OK') : it.kind === 'ready' ? 'reply ready' : it.kind === 'reply' ? 'reply' : it.kind === 'ask' ? 'internal ask' : it.kind === 'queue' ? 'internal queue' : it.kind === 'go' ? goWhat(it) : it.kind === 'pace' ? paceWord(it) : taskWhat(it)

/** (0.7.24) What a `go` item is due for: `follow-ups need your go · first text Fri Nov 6`, or for a teammate's, `follow-ups need a go · ...`. */
function goWhat(it: QueueItem): string {
  const g = goOf(it)
  if (!g) return GO_THEIRS
  return `${g.mine ? GO_WHAT : GO_THEIRS} · ${goFirstText(g)}`
}

/**
 * (0.7.23) What is the founder's own on a client whose package flagged for his OK is a teammate's and late (`okLate`): his
 * thread's name and row say that, never the package (it is listed under Team · late).
 */
function ownWhat(it: QueueItem): string {
  if (it.messages > 0 && (it.open ?? null)?.state !== 'held_by_other') return 'reply'
  if (it.tasks > 0) return taskWhat(it)
  // (0.7.24) his own go on the client's follow-up steps
  if (goMine(it)) return goWhat(it)
  return openAsks(it).length > 0 ? 'internal ask' : 'internal queue'
}

/** (0.7.4) What a `task` item is due for: see whatOf. */
function taskWhat(it: QueueItem): string {
  const asks = etaAsksOf(it).length
  if (asks > 0 && asks === it.tasks) return 'ETA needed'
  const owners = assignAsksOf(it).length
  if (owners > 0 && owners === it.tasks) return 'assign an owner'
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
 * (0.7.12, Rob 2026-10-30) The clock a thread's name and a pane row give: the time left (`10h left`), or, once late, how
 * late with when it was due after it, the hours first (Rob, 2026-10-12): `3h late, due 3 PM`, `2d late, due Mon 3 PM`,
 * `12d late, due Oct 14` (`dueWhen`).
 */
export function clockAndDue(due: number, now: number): string {
  return due < now ? `${clockLead(due, now)}, due ${dueWhen(due, now)}` : clockLead(due, now)
}

/**
 * (0.7.12, Rob 2026-10-30: "I saw some things that were pinned with no hours left or hours overdue ... I'm not sure why
 * they were pinned in the first place") What a thread's name and a row say where the clock would be, when nothing of the
 * client's is dated: a missing clock is never a mystery.
 */
export const NO_DUE_DATE = 'no due date'

/**
 * (0.7.12) Whether a name or a row says `no due date`: an item with no due time that is the viewer's own. Not one a
 * teammate holds (who has it stands where the clock would), and not the internal queue (never dated, and it says so).
 */
const saysNoDue = (it: QueueItem, theirs: boolean): boolean => !theirs && !hasDue(it) && it.kind !== 'queue'

/** (0.7.12) The most characters a thread's name keeps its `N new` count within: past it, the count goes first, never the clock or the client. */
export const THREAD_TITLE_MAX = 60

/**
 * The pinned thread's name: `🔴 3d late, due Fri 3 PM · Acme Legal · reply · 17 new`. It leads with the hours (Rob,
 * 2026-10-12: "hours before overdue or something like that, as the first part of the message"), and (0.7.12) once late
 * it says when it was due (`clockAndDue`). Nothing dated: `🟡 Acme Legal · task · no due date`. A name longer than
 * THREAD_TITLE_MAX drops its `N new` count; the clock and the client always stay.
 */
export function titleFor(it: QueueItem, now: number): string {
  // A client whose drafts a teammate holds, and that is not the viewer's to act on: who has it stands where
  // the clock would (`🟡 with J Smith · Acme Legal · reply`), and nothing about it reads as late.
  const theirs = withTeammate(it)
  // (`your draft` for a package the viewer holds, and `with <Name>` when a teammate holds it: 0.4.1; for the
  // founder, the teammate it is with when it is theirs to see through: 0.5.1)
  // (R17) nothing due: `🟡 <client> · <what>`, no clock and never red; (0.7.12) and `no due date` after it
  const lead = theirs ? `🟡 with ${it.theirs ?? it.open?.by ?? ''}` : hasDue(it) ? `${isRed(it, now) ? '🔴' : '🟡'} ${clockAndDue(it.dueAt, now)}` : ''
  // (0.7.27) the worst status names it, when it is more urgent than what is due: `🟡 Acme Legal · behind · needs 2.4 h/day, paid 1.5 · due Mon Nov 30`
  const status = theirs ? null : statusOf(it, now)
  const parts = status ? [`${status.dot} ${it.client}`, status.words] : lead ? [lead, it.client, whatOf(it)] : [`🟡 ${it.client}`, whatOf(it), ...(saysNoDue(it, theirs) ? [NO_DUE_DATE] : [])]
  const count = it.messages > 1 ? `${it.messages} new` : ''
  const rest: string[] = []
  if (it.open?.state === 'held_by_other' && !theirs) rest.push(`with ${it.open.by}`)
  if (it.flagged) rest.push('flagged')
  const full = [...parts, ...(count ? [count] : []), ...rest].join(' · ')
  // (0.7.12, "keep titles short") the count goes before anything that says what is due, when, or for whom
  return count && [...full].length > THREAD_TITLE_MAX ? [...parts, ...rest].join(' · ') : full
}

/**
 * (0.7.5, the panel redesign; Rob, 2026-10-27: "queue first, one merged time list, plain numbers") A row of the pane in
 * ONE line: the chip, the client, what is needed, then the time left: `🔴 ReGen Society · your OK · 1d late, due Wed 3 PM`
 * ((0.7.12) once late, with when it was due), and after it what else the thread's name says (`3 new`, `with <Name>`,
 * `flagged`). A client whose drafts a teammate holds and that is not the viewer's: no clock, `with <Name>`. Nothing due:
 * no clock (R17), and (0.7.12) `no due date` where it would be. `fresh`: the client has no thread at all (` · no thread`
 * last), red when it pins now (R4).
 */
export function rowLine(it: QueueItem, now: number, opts: { fresh?: boolean; pins?: boolean } = {}): string {
  const theirs = withTeammate(it)
  const due = !theirs && hasDue(it)
  const what = whatOf(it)
  const red = opts.pins === true || (due && isRed(it, now))
  // (0.7.27, the PM) a teammate's part to check on: what pins the row when nothing of his own does, its status's words
  const mate = checkNow(it, now)
  const check = mate && !ownPins(it, now) ? mate : null
  // (0.7.27) the worst status names it, when it is more urgent than what is due (`statusOf`)
  const status = check || theirs ? null : statusOf(it, now)
  const named = check ? [`${checkDot(check, now)} ${it.client}`, checkWords(check, now)] : status ? [`${status.dot} ${it.client}`, status.words] : null
  const parts = named ?? [`${red ? '🔴' : '🟡'} ${it.client}`, what === 'needs your OK' ? 'your OK' : what]
  // (0.7.12) once late, when it was due as well (`6h late, due Mon 3 PM`); nothing dated, `no due date`
  if (!named && due) parts.push(clockAndDue(it.dueAt, now))
  else if (!named && saysNoDue(it, theirs)) parts.push(NO_DUE_DATE)
  if (it.messages > 1) parts.push(`${it.messages} new`)
  // (0.7.27, the PM) from the teammate's pin report: `pinned for Asif` or `not pinned for Asif`; neither with no report to read
  const pinned = mate ? pinnedForText(mate) : ''
  if (pinned) parts.push(pinned)
  else if (theirs) parts.push(`with ${it.theirs ?? it.open?.by ?? ''}`)
  else if (check) parts.push(`with ${cleanText(check.by, 40) || 'a teammate'}`)
  else if (it.open?.state === 'held_by_other') parts.push(`with ${it.open.by}`)
  if (it.flagged) parts.push('flagged')
  if (opts.fresh) parts.push('no thread')
  return parts.join(' · ')
}

/**
 * (0.7.5) Whether a client of the viewer's own list is drawn under `Needs you now`: not one listed by the internal queue
 * alone (its own part, `Your build queue`), and not one listed by undated tickets alone (`No due date`, under the list).
 * (0.7.27) One whose undated tickets pin (`needs a due date`) is listed here: `noDateGroup`.
 */
export const needsYouNow = (it: QueueItem): boolean => it.kind !== 'queue' && !noDateGroup(it)

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
 * (`🔴 3d late, due Fri 3 PM · Acme Legal · reply`, or `🟡 with J Smith · Acme Legal · reply` when a teammate holds
 * its drafts, or `🟡 Acme Legal · task · no due date`), those before it (`🔴 3d late · Acme Legal · reply` until
 * 0.7.12, `🔴 Acme Legal · reply overdue 6h`), the cleared one (`✓ Acme Legal · clear 11 AM`), with or without a
 * two-digit rank in front. For any other title, what stands before its first ` · `.
 */
export function clientInTitle(title: string): string {
  const marked = /^[🔴🟡🟢✓]\s/u.test(title.replace(/^\d{2}\s+/, ''))
  const parts = title.replace(/^\d{2}\s+/, '').replace(/^[🔴🟡🟢✓]\s*/u, '').replace(/^client:\s*/i, '').split(' · ')
  const first = parts[0]?.trim() ?? ''
  // what leads the name: the clock ((0.7.12) once late, with when it was due: `3h late, due Mon 3 PM`), or (in a name
  // of the bridge's only) who holds the drafts, or (0.5.2) that the client has no thread
  const lead = /^(?:<1h|\d+[hd]) (?:late|left)(?:, due \S.*)?$/.test(first) || (marked && parts.length > 2 && /^with \S/.test(first)) || (marked && first === 'NO THREAD')
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
  if (/^(?:\d{2}\s+)?[🔴🟡🟢✓]\s/u.test(raw)) {
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
  if (it.noReply === true) return `_${NO_REPLY_WHAT[0]?.toUpperCase()}${NO_REPLY_WHAT.slice(1)}. ${ask('Pick up')}._`
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
  // (0.7.15, owner asks) and the tickets to give an owner: which, and that the date is for the owner, not the delivery
  const own = assignAsksOf(it).filter(a => isUuid(a?.id))
  const one = own.length === 1
  const owners = own.length ? ` ${own.length} ticket${one ? '' : 's'} of ${holderName(member)}'s need${one ? 's' : ''} an owner (ticket ${own.map(a => a.id.slice(0, 8)).join(', ')}): a team post handed ${one ? 'it' : 'them'} over to be assigned in OW by ${one ? 'its due time' : 'their due times'}, which ${one ? 'is not a delivery date' : 'are not delivery dates'}. A ticket ${holderName(member)} takes instead needs an ETA, recorded as task-chip-flow §5.3 says, with task_fingerprint "ticket:<id>".` : ''
  // (0.7.4, for the founder) and his teammates' late internal tickets: whose, never his to do
  const late = lateSentence(matesOf(it))
  const mates = late ? ` ${late} (late); the side pane lists them. They are the teammate's to answer, not ${holderName(member)}'s.` : ''
  // (0.7.24) and follow-up steps that wait for a go, where the body is not already about them
  const go = goOnly(it) ? '' : goSentence(it, member)
  return `${noteBody(it, member)}${more}${queue}${etas}${owners}${mates}${go ? ` ${go}` : ''}`
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
 * have no date: `1 committed task due, 1 ticket that needs an ETA, 3 tasks with no due date`. (0.7.15) And the tickets to
 * give an owner: `1 ticket that needs an owner`.
 */
function taskPhrase(it: QueueItem): string {
  const eta = etaAsksOf(it).length
  const owners = assignAsksOf(it).length
  const nodate = undatedCount(it)
  const dated = committedCount(it)
  if (!eta && !owners && !nodate) return `${it.tasks} committed task${it.tasks === 1 ? '' : 's'} due`
  return [
    dated > 0 ? `${dated} committed task${dated === 1 ? '' : 's'} due` : '',
    eta > 0 ? `${eta} ticket${eta === 1 ? ' that needs' : 's that need'} an ETA` : '',
    owners > 0 ? `${owners} ticket${owners === 1 ? ' that needs' : 's that need'} an owner` : '',
    nodate > 0 ? `${nodate} task${nodate === 1 ? '' : 's'} with no due date` : '',
  ].filter(Boolean).join(', ')
}

/**
 * (0.7.24) What the bridge note says of follow-up steps that wait for a go: whose go, which package, how many steps, when
 * the first opens, and how to show them. '' with none.
 */
export function goSentence(it: QueueItem, member: string): string {
  const g = goOf(it)
  if (!g) return ''
  const n = `${g.steps} proposed follow-up step${g.steps === 1 ? '' : 's'}`
  const at = typeof g.firstAt === 'number' && Number.isFinite(g.firstAt) ? etParts(shownDue(g.firstAt)) : null
  const first = at ? `; the first, a ${stepWord(g.firstKind)}, opens ${at.day}, ${at.md} ${at.time} ET` : ''
  if (!g.mine) return `Package ${g.packageId.slice(0, 8)} holds ${n} that wait for ${g.by}'s go${first}. They are ${g.by}'s to approve, not ${holderName(member)}'s.`
  return `Package ${g.packageId.slice(0, 8)} holds ${n} that nobody has approved and that wait for ${holderName(member)}'s go${first}. Nothing goes until the go. When the person asks to act on them, follow client-reply-prep §9 with --package ${g.packageId}.`
}

function noteBody(it: QueueItem, member: string): string {
  if (goOnly(it)) return goSentence(it, member)
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
  // (0.7.15, owner asks) the viewer's tickets to give an owner, each with its clock
  const owners = assignMarkdown(it, now)
  if (owners) out.push('', owners)
  // (0.7.4) the tasks nobody dated, apart from the committed ones
  const undatedTitles = Array.isArray(it.undatedTitles) ? it.undatedTitles : []
  if (undatedTitles.length) {
    out.push('', '### Open tickets (no due date)')
    for (const t of undatedTitles.slice(0, UNDATED_SHOWN_MAX)) out.push(`- ${t}`)
    if (undatedTitles.length > UNDATED_SHOWN_MAX) out.push(`- and ${undatedTitles.length - UNDATED_SHOWN_MAX} more`)
  }
  // (0.7.24) follow-up steps that wait for a go
  const go = goMarkdown(it, now)
  if (go) out.push('', go)
  // (0.7.4) nothing of a reply's in play (no client message, no package): no word of reply drafts, whatever else lists
  // the client (Rob, 2026-10-27: a task alone "doesn't necessarily create the need for a new reply")
  const noReply = !it.mail.length && !it.packageId && !(it.open ?? null)
  if (asks) out.push('', asks)
  // (0.7.4, for the founder) his teammates' late internal tickets, last: theirs, not his
  const mates = matesMarkdown(it, now)
  if (mates) out.push('', mates)
  // (0.7.18, for the PM) his teammates' tickets to check on, last with them: theirs, not his
  const watched = watchMarkdown(it, now)
  if (watched) out.push('', watched)
  if (!noReply) out.push('', draftsLine(it))
  return out.join('\n')
}

/**
 * (0.7.24) The pane's part for follow-up steps that wait for a go: whose go, how many steps, the first and when its window
 * opens (`late` once it has passed), and the package. '' with none.
 */
export function goMarkdown(it: QueueItem, now: number): string {
  const g = goOf(it)
  if (!g) return ''
  const steps = `${g.steps} step${g.steps === 1 ? '' : 's'}`
  const at = typeof g.firstAt === 'number' && Number.isFinite(g.firstAt) ? g.firstAt : NaN
  const when = Number.isFinite(at) ? (at < now ? `its window opened ${clockText(shownDue(at), now)}, ${lateText(at, now)}` : `its window opens ${clockText(shownDue(at), now)}`) : 'not dated'
  const head = g.mine ? `### ${GO_WHAT[0].toUpperCase()}${GO_WHAT.slice(1)} (${steps})` : `### Follow-ups waiting for ${cleanText(g.by, 40) || 'a teammate'}'s go (${steps})`
  const ask = g.mine ? `Nobody has approved them and nothing goes until you do. Ask Claude: "Show me the follow-ups for ${it.client}"` : `They are theirs to approve.`
  return [head, '', `- First ${stepWord(g.firstKind)} · ${when} · package ${g.packageId.slice(0, 8)}`, '', `_${ask}._`].join('\n')
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

/** (0.7.15, owner asks) The pane's part for the viewer's tickets to give an owner: what to do, then each with its clock. '' with none. */
export function assignMarkdown(it: QueueItem, now: number): string {
  const asks = assignAsksOf(it).filter(a => a && isUuid(a.id) && Number.isFinite(a.assignBy))
  if (!asks.length) return ''
  const lines = asks.map(a => `- ${cleanText(a.title, MATE_TITLE_MAX)} (ticket ${a.id.slice(0, 8)}) · ${a.assignBy < now ? `owner was needed by ${clockText(a.assignBy, now)}, ${lateText(a.assignBy, now)}` : `owner needed by ${clockText(a.assignBy, now)}`}`)
  return [`### ${ASSIGN_ASK_TEXT}`, '', ...lines].join('\n')
}

/** (0.7.4, for the founder) The pane's part for his teammates' late internal tickets on the client. '' with none. */
export function matesMarkdown(it: QueueItem, now: number): string {
  const refs = matesOf(it).filter(r => r && isUuid(r.id) && Number.isFinite(r.lateSince))
  if (!refs.length) return ''
  const lines = refs.map(r => `- ${cleanText(r.by, 40)} · ${cleanText(r.title, MATE_TITLE_MAX)} (ticket ${r.id.slice(0, 8)}) · ${r.eta ? 'no ETA given' : 'past its ETA'}, ${lateText(r.lateSince, now)}`)
  return [`### Late with a teammate (${refs.length})`, '', ...lines].join('\n')
}

/**
 * (0.7.18, for the PM) The pane's part for his teammates' tickets on the client that he should check on: whose, which, and
 * why now (`2h late`, `behind · not started, had to start Mon 1 PM`, `due 3 PM`); (0.7.27) and a pace row of theirs, in its words. '' with none.
 */
export function watchMarkdown(it: QueueItem, now: number): string {
  const refs = (Array.isArray(it.watch) ? it.watch : []).filter(w => w && Number.isFinite(w.due) && (w.what === 'task' ? isUuid(w.id) : w.what === 'pace' && goodPace(w.pace) !== null))
  if (!refs.length) return ''
  const why = (w: WatchRef): string =>
    w.due <= now ? lateText(w.due, now) : Number.isFinite(w.startBy) && (w.startBy as number) <= now ? notStartedWords(w.startBy as number, now) : `due ${clockText(shownDue(w.due), now)}`
  const lines = refs.map(w => {
    const pace = goodPace(w.pace)
    return pace ? `- ${cleanText(w.by, 40)} · ${paceStatus(pace, now).words}` : `- ${cleanText(w.by, 40)} · ${cleanText(w.title, MATE_TITLE_MAX)} (ticket ${(w.id as string).slice(0, 8)}) · ${why(w)}`
  })
  return [`### Check on a teammate (${refs.length})`, '', ...lines].join('\n')
}

/** (0.7.4) How late something is, as the pane says it: `3h late`, `2d late` (business time, R16). */
function lateText(since: number, now: number): string {
  // ((0.7.12) no longer from whenText, which now says when it was due as well)
  return `${lateSpan(since, now)} late`
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
