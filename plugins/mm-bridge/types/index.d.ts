export type MmMarkdown = string

/**
 * The client part of the pane, drawn above the list: a client's prepared drafts when there is a package,
 * else the messages waiting on our reply and the tasks due; under either, (0.5.28) the viewer's open internal asks
 * about the client, each with its page once read. `heading` is `This thread: <client>` when it
 * is the client of the thread the pane is in, and empty for another client's (shown from its row's Drafts
 * button). An empty `text` draws no client part.
 */
export type MmView = { text: MmMarkdown; heading: string }

/** One client on the Needs-you pane: what is due, what is waiting, and the one thing to do about its thread. */
export type MmRow = {
  projectId: string
  client: string
  /** The thread name the bridge would give it: what is due and when. */
  title: string
  waiting: string
  /**
   * `start`: a new thread (none yet, or the existing one is old or long). `update`: the thread exists and
   * has not been given what is waiting now. `current`: it already has it.
   */
  state: 'start' | 'update' | 'current'
  /** Why, in a few words. For `current`, the whole phrase: when the thread was updated. */
  reason: string
  /** True when the client has no thread of any kind: the row is drawn in the first group, marked. Absent on a row an older version drew. */
  fresh?: boolean
  /** The app thread the row's button acts on, as this row was drawn. A press acts on this thread or on none. */
  target?: string
  /**
   * Set on a row under `With a teammate`: who holds the client's reply drafts, and to ask them before
   * writing a second reply. Such a row is not the viewer's to act on: it carries this sentence and the
   * Drafts button, and no action. For the founder, on a package flagged for his OK that a teammate holds,
   * the sentence is followed by ` · may need your OK`.
   */
  note?: string
  /**
   * For the founder alone: true on a row under `With a teammate` whose client's package a teammate sends
   * and sees through (0.5.1). Like a row with a `note`, it has the Drafts button and no action, sentence or not.
   */
  theirs?: boolean
  /**
   * (0.5.2, R8) What the server's check of our reply to the client found still open: drawn under the row. A
   * row with these is named `🟡 <client> · still open after your reply`.
   */
  stillOpen?: string[]
  /** (0.5.2, R8) With `stillOpen`: true when the row's one action is Claim in this thread (its thread is under 60% of its context). */
  claim?: boolean
  /** (0.5.2, R8) The server is checking our reply to this client: the row is under `Checking your reply`, named as its thread is, with Drafts alone. */
  checking?: true
}

/**
 * `rows` are the clients that need the viewer now. `teammate` and `older` are the two groups under them,
 * closed until the person opens one: clients whose drafts a teammate holds, and clients whose only items
 * were due before the list's floor, Wed 2026-10-14 (until 2026-10-20 the cut was 3 business days back; Rob
 * replaced it with LIST_FLOOR_MS). Neither is pinned or counted in the header.
 */
export type MmQueue = {
  header: string
  rows: MmRow[]
  note: string
  teammate?: MmRow[]
  older?: MmRow[]
  /** (0.5.2, R8) Clients whose reply the server is checking: a closed group `Checking your reply (n)`, never pinned or counted. */
  checking?: MmRow[]
  /**
   * One line under the header when the refresh after a press failed: the list shown is the one last loaded.
   * Gone with the next list drawn from a sync that worked. `warnedAt` is when it failed.
   */
  warning?: string
  warnedAt?: number
  /** (0.5.4) The sync the list was drawn from: a thread drawn from an older one than the store holds draws it again. */
  syncedAt?: number
  /**
   * (New people, OW ticket 549944b0) For the founder and a PM: people who wrote to us and whom no project matched,
   * newest first, drawn above the list under `New people (n)`. Absent when there are none (or the feed has none).
   */
  people?: MmPerson[]
  /** (New people) The projects Route to project offers, by name. */
  routeTo?: MmProject[]
}

/**
 * (New people) One person under `New people`: who, what they wrote about, when, what to check first, what we
 * already know of them, and the link to where they wrote. Every text is drawn as given; none goes to Claude.
 */
export type MmPerson = {
  /** OW's alert id (a uuid): what a press sends back. */
  id: string
  /** Who it is, as the notice after a press names them. */
  name: string
  /** `Isaac Gonzalez · True North Interiors`, and ` · via HighLevel Directory` for a Directory lead. */
  title: string
  /** `Subject: RFP for the Plano office`, or `(no subject)`. */
  subject: string
  /** `Received Fri Oct 16, 9:12 AM ET · 4 business days waiting`. */
  when: string
  /** The warnings, in words (`blank body`, `Bcc'd`, ...): drawn as small labels. */
  warnings: string[]
  /** `We know them: 1 recorded call (Feb 2026) · HighLevel contact`, or '' when the feed gives no summary. */
  known: string
  /** The Gmail or Directory link (https only), or ''. */
  link: string
  /**
   * A HighLevel Directory lead (`source` `hl_directory`): it has no email to route or start a project from, so OW
   * refuses `route` and `bootstrap` for it. Its row offers Mark handled (`handled`) and Not client mail only. Absent on
   * any other row.
   */
  directory?: true
}

/** (New people) A project Route to project can send someone to. */
export type MmProject = { projectId: string; name: string }

/**
 * (New people) What this thread's pane shows of the person's own presses on `New people`: whose project picker is
 * open, which of its pages it shows and what is picked in it, which rows have a press in flight (since when), and what OW answered a press that
 * did not go through, by alert id.
 */
export type MmPeople = { open?: string; pick?: string; page?: number; busy?: Record<string, number>; errors?: Record<string, string> }

/** Which of the two groups under the list the person has opened. */
export type MmFolds = { teammate?: boolean; older?: boolean; checking?: boolean }

/** What the last button press did, shown above the list. */
export type MmNotice = { text: string; at: number }

/**
 * The one line above the prompt: how many clients need the person, and this thread's client. An empty
 * `text` draws nothing. `drafts` is true in a thread that is a waiting client's: the line then carries a
 * second button that opens that client's pane.
 */
/**
 * `at` (0.5.4): the sync the line was worked out from. `missing` (0.5.14): how many clients need a new thread now, for
 * the band's Start missing threads button, which is always drawn (0 or absent: All threads started). (0.5.12's
 * `startAll` is no longer written or read.)
 */
export type MmBand = { text: string; drafts?: boolean; at?: number; missing?: number }

/**
 * (0.6.0) One line of the pane's Tracking part. `open`: the app thread (`local_…`) a press on the line opens, on a
 * row of `Threads today` that is another thread on this computer; such a line is drawn as a button.
 */
export type MmTrackLine = { text: string; dim?: boolean; bold?: boolean; open?: string }

/**
 * (0.6.0) What this thread's pane shows of its current project: which project (`pid`, '' when none), the pane's
 * title, the Tracking part line by line, and in a second thread of a client the dim line above the client part
 * (`second`). `client`: the project's name as shown.
 */
export type MmTrack = { pid: string; client: string; title: string; lines: MmTrackLine[]; second?: string }

/**
 * (0.6.0) This session's own record, for the pane and the band: the person's prompts so far, whether its first
 * prompt began `SINGLE-SESSION`, whether the person pressed Not client work, whether it runs for a person
 * (`interactive`) or unattended (`MM_UNATTENDED=1`), the project whose pane the person closed (`closed`) and the one
 * the pane was last opened for by itself (`opened`), the project the pane last drew (`handled`), and when this
 * session last asked OW for its project's time (`asked`).
 */
export type MmSession = {
  prompts: number
  /** Its first prompt has been seen. */
  first?: boolean
  single?: boolean
  notClient?: boolean
  interactive?: boolean
  unattended?: boolean
  closed?: string
  opened?: string
  handled?: string
  asked?: number
}

/** (0.6.0) A client the band offers to track this thread to: its project, its name, and the skill that counts it. */
export type MmSuggestion = { pid: string; client: string; skill: string }

/** (0.6.0) The band's line for a thread with no current project after the person's second prompt, and what it offers. */
export type MmNudge = { show: boolean; suggest: MmSuggestion[] }

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': {
      view: MmView
      queue: MmQueue
      notice: MmNotice
      band: MmBand
      folds: MmFolds
      people: MmPeople
      track: MmTrack
      sess: MmSession
      nudge: MmNudge
    }
  }
}
