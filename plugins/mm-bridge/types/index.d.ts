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
}

export type MmQueue = { header: string; rows: MmRow[]; note: string }

/** What the last button press did, shown above the list. */
export type MmNotice = { text: string; at: number }

/**
 * The one line above the prompt: how many clients need the person, and this thread's client. An empty
 * `text` draws nothing. `drafts` is true in a thread that is a waiting client's: the line then carries a
 * second button that opens that client's pane.
 */
export type MmBand = { text: string; drafts?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': { view: MmView; queue: MmQueue; notice: MmNotice; band: MmBand }
  }
}
