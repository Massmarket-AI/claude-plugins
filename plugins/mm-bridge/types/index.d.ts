export type MmMarkdown = string

/**
 * The client part of the pane, drawn above the list: a client's prepared drafts when there is a package,
 * else the messages waiting on our reply and the tasks due. `heading` is `This thread: <client>` when it
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
 * were due before the list's floor, Thu 2026-10-15 (until 2026-10-20 the cut was 3 business days back; Rob
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
}

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

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': { view: MmView; queue: MmQueue; notice: MmNotice; band: MmBand; folds: MmFolds }
  }
}
