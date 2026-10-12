export type MmMarkdown = string

/** One client on the Needs-you pane: what is due, what is waiting, and what to do about its thread. */
export type MmRow = {
  projectId: string
  client: string
  /** The thread name the bridge would give it: what is due and when. */
  title: string
  waiting: string
  /** The recommended action, and why in a few words. */
  action: 'update' | 'start'
  reason: string
  /** False when the client has no thread of any kind: there is nothing for Update to act on. */
  canUpdate: boolean
  /** The app thread Update acts on, as this row was drawn. A press acts on this thread or on none. */
  target?: string
}

export type MmQueue = { header: string; rows: MmRow[]; note: string }

/** What the last button press did, shown above the list. */
export type MmNotice = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': { view: MmMarkdown; queue: MmQueue; notice: MmNotice }
  }
}
