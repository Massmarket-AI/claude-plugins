export type MmMarkdown = string

/**
 * The client part of the pane, drawn above the list: a client's prepared drafts when there is a package,
 * else the messages waiting on our reply and the tasks due; under either, (0.5.28) the viewer's open internal asks
 * about the client, each with its page once read, and (0.7.3) on the Massmarket AI item the viewer's internal queue,
 * in rank order, with no due dates. `heading` is `This thread: <client>` when it
 * is the client of the thread the pane is in, and empty for another client's (shown from its row's Drafts
 * button). An empty `text` draws no client part.
 */
export type MmView = {
  text: MmMarkdown
  heading: string
  /** (0.7.33) With a pickup view: the page alone, which folds under the card (`Show the page as text`). */
  page?: MmMarkdown
  /** (0.7.33) With a pickup view: the hold banner, the open asks and the internal queue, drawn under the card and never folded with the page. */
  extra?: MmMarkdown
}

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
  /**
   * (0.7.5, the panel redesign) The row's second line: what is waiting that its first line (`title`) does not already
   * say, such as `2 drafts not sent`. Absent when there is nothing to add: the row is one line.
   */
  extra?: string
  /**
   * (0.7.10) The client's own thread, archived and not brought back by itself: the row's action is Restore thread, which
   * asks the app to unarchive this thread, never Start.
   */
  archived?: string
  /**
   * (0.7.11) A client with no message in the last six weeks, nothing of theirs waiting and nothing due for the viewer: the
   * row stays, with no Start (Drafts alone), and no thread is started for it.
   */
  dormant?: true
  /** (0.7.34) On a row of `Needs you now` that should be pinned: whether its thread is, and why not, as the pin report says. */
  pin?: { pinned: boolean; why?: string }
}

/**
 * `rows` are the clients that need the viewer now. `teammate` is a group under them, closed until the person opens
 * it: clients whose drafts a teammate holds. It is not pinned or counted in the header. ((0.7.12) Until 0.7.12 an
 * `older` group held clients whose only items were due before the list's floor; nothing due before the cut is
 * considered now, and a pane stored with one draws no such group.)
 */
export type MmQueue = {
  header: string
  rows: MmRow[]
  note: string
  teammate?: MmRow[]
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
  /**
   * (0.7.5) The viewer's own clients listed by undated tickets alone: a closed group `No due date (n)` in the line of
   * groups under the list. Never pinned or counted in the header.
   */
  undated?: MmRow[]
  /** (0.7.5) The viewer's internal queue, drawn under the list as `Your build queue · N`. Absent for a viewer with none. */
  build?: MmBuild
    /**
   * (0.7.21, for the founder) Team · late: his teammates' late internal tickets, by person, then client, each ticket one
   * line. A closed group `Team · late (n)` at the end of the line of groups under the list, drawn below the others once
   * opened. Never pinned, and never counted in the header: the status line says `· n late with the team`. Absent: none.
   */
  team?: MmTeam[]
}

/**
 * (0.7.21) One teammate in Team · late: their name, how many of their tickets are late, and those tickets by client, each
 * worded as one line (`Send the onboarding form · late since Mon 3 PM · no ETA given`). Every text is drawn as given; none
 * goes to Claude.
 */
export type MmTeam = { by: string; count: number; clients: Array<{ client: string; lines: string[] }> }

/**
 * (0.7.5, the panel redesign) `Your build queue · N` under the list: how many tickets the viewer's internal queue holds,
 * the top few in rank order (one line each), and the internal-ops row, whose linked thread the part's button opens.
 * ((0.7.5 to 0.7.20 also the founder's teammates' late internal tickets, `late`: Team · late's alone since 0.7.21.)
 */
export type MmBuild = { total: number; top: string[]; row: MmRow }

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

/** Which of the groups under the list the person has opened. ((0.7.12) No `older`: that group is gone.) */
export type MmFolds = {
  teammate?: boolean
  checking?: boolean
  /** (0.7.5) `New people` is closed until opened, as the other groups are. */
  people?: boolean
  /** (0.7.5) `No due date`. */
  undated?: boolean
  /** (0.7.21) `Team · late`. */
  team?: boolean
  /** (0.7.34) `Needs you now` and `Team now`, this thread's press. Absent: this computer's last one (`mm.panel`). */
  needs?: boolean
  teamNow?: boolean
  /** (0.7.5) The Tracking part, closed to its one line until opened; `more`: its further numbers. */
  track?: boolean
  more?: boolean
  /** (0.7.5) The tasks of the time list opened to their threads, by key (`MmTrackLine.toggle`). */
  tasks?: string[]
}

/** (0.7.34) One row of a person's pins on `Team now`, as the daily photo has it. */
export type MmTeamItem = { client: string; kind: string; tone: 'red' | 'yellow' | 'green'; dueAt: number | null; pinned: boolean; whyNot: string | null }
/** (0.7.34) One of a person's threads with a tracked row in the last 30 minutes. A thread with no client said has none, and no task. */
export type MmTeamThread = { client: string | null; working: boolean; auto: boolean; since: number | null; capped: boolean; lastAt: number; task: string | null }
/** (0.7.34) A task assigned to a person in the last day. `from`: who this bridge last saw it with. */
export type MmTeamTask = { ref: string; client: string; title: string | null; at: number; from?: string }
/** (0.7.34) One person on `Team now`. */
export type MmTeamPerson = { name: string; me: boolean; reportedAt: number | null; items: MmTeamItem[]; extra: Array<string | null>; seen: boolean; running: MmTeamThread[]; assigned: MmTeamTask[] }
/** (0.7.34) OW's last read of the team, checked (`teamFrom`). */
export type MmTeamRead = { at: number; partial: string[]; people: MmTeamPerson[] }
/** (0.7.34) The pane's `Team now`: OW's last read; `missing` while OW has no such route. */
export type MmTeamNow = { team?: MmTeamRead; got?: number; missing?: boolean }

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
/**
 * `why` (0.7.25): in a client's own thread, the one line under the band that says why the thread is pinned or why no pin
 * is needed (`threadWhy`); absent in any other thread.
 */
export type MmBand = { text: string; drafts?: boolean; at?: number; missing?: number; why?: string }

/**
 * (0.6.0) One line of the pane's Tracking part. `open`: the app thread (`local_…`) a press on the line opens, on a
 * row of `Threads today` that is another thread on this computer; such a line is drawn as a button.
 */
/**
 * (0.7.5) `part`: `head` is the one line the Tracking part closes to (a press opens it), `more` is drawn only once its
 * More is opened; any other line is drawn while the part is open. `toggle`: a task with several threads, a press opens
 * it to them; `under`: a thread row of that task, drawn only while it is open.
 */
export type MmTrackLine = { text: string; dim?: boolean; bold?: boolean; open?: string; part?: 'head' | 'more'; toggle?: string; under?: string }

/**
 * (0.6.0) What this thread's pane shows of its current project: which project (`pid`, '' when none), the pane's
 * title, the Tracking part line by line, and in a second thread of a client the dim line above the client part
 * (`second`). `client`: the project's name as shown.
 */
export type MmTrack = { pid: string; client: string; title: string; lines: MmTrackLine[]; second?: string; /** (0.7.5) When its numbers are from (ms), for the pane's one `Updated` line where it has no list. */ at?: number }

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
  /** (0.7.0) The project and task labels (`lineAskKey`) whose line band the person answered or put off (Not now). */
  lineDone?: string[]
  /** (0.7.0) The project and task labels whose one note to Claude (no line matched) was added. */
  lineNoted?: string[]
}

/** (0.6.0) A client the band offers to track this thread to: its project, its name, and the skill that counts it. */
export type MmSuggestion = { pid: string; client: string; skill: string }

/** (0.6.0) The band's line for a thread with no current project after the person's second prompt, and what it offers. */
export type MmNudge = { show: boolean; suggest: MmSuggestion[] }

/** (0.7.0) A line of a client's quote the band offers: its key and its title. */
export type MmLineChoice = { line_key: string; title: string }

/**
 * (0.7.0) The band's line for a client's thread whose work matches no line on the quote: the project, its name as
 * shown, the project and task label it was worked out for (`key`), whether nothing matched (`unmatched`) or the work
 * looks like new scope (`maybe_new_scope`), the candidate lines (at most 3) and the hour bank, when the client has one.
 * (0.7.1) `prepaid`: whether the band offers Prepaid hours (the client has prepaid hours left; from an OW that does not
 * say, whether it has an hour bank); `alwaysAsk`: the client is set to always ask first.
 */
export type MmLineAsk = {
  show: boolean
  pid?: string
  client?: string
  key?: string
  signal?: 'unmatched' | 'maybe_new_scope'
  candidates?: MmLineChoice[]
  bank?: MmLineChoice | null
  prepaid?: boolean
  alwaysAsk?: boolean
}

/**
 * (0.7.26, the reply-package card) One run of a card paragraph, as `render_visual.py --tree` writes it: its exact text,
 * the card's classes on it, a link, and the fingerprint of a block that is one run.
 */
export type MmCardRun = {
  s: string
  c?: string
  href?: string
  fp?: string
  /** (0.7.33) A mention: the Discord id whose name `s` draws, so the check can tell who it names. */
  m?: string
}

/**
 * (0.7.26) One node of the card: a box of nodes (`k`), a paragraph of runs (`r`, with `fp` when it is a fingerprinted
 * block), a button that puts words in the prompt box (`btn`, `ask`), or the signature box (`sign`).
 */
export type MmCardNode = {
  c?: string
  k?: MmCardNode[]
  r?: MmCardRun[]
  fp?: string
  btn?: string
  ask?: string
  sign?: { label: string; signer: string }
}

/** (0.7.26) The card `render_visual.py --tree` draws for one version of a reply package. */
export type MmCardTree = {
  v: number
  package_id: string | null
  project_id: string | null
  client: string
  package_sha256: string | null
  label: string
  blocks: number
  signer: string
  can_sign: boolean
  /** (0.7.33) How many images the words that go out hold: none of them can be drawn, so the card cannot stand in for the page. */
  images?: number
  rendered_at: string
  nodes: MmCardNode[]
}

/**
 * (0.7.26) The card in this thread's pane: the package the client part shows, whether it is this thread's own client,
 * the package's hash as the last pickup read gave it (`current`: 64 hex, or the 12 of a page read locally), the card
 * drawn for it and how its drawing stands. `packageId` '' is no card.
 */
export type MmCard = {
  packageId: string
  projectId: string
  client: string
  own: boolean
  current: string | null
  tree: MmCardTree | null
  status: 'ready' | 'rendering' | 'failed' | 'none'
  error?: string
  /**
   * (0.7.33) Why this card cannot stand in for the page (`pageGap`), when it cannot: its signature box stays closed and
   * `mm card` answers not ready. Holds up to 60 characters of the page: never logged.
   */
  gap?: string
  /** (0.7.33) The hash of the page this card was last held against: what a signature is for (`standing`). None when no page was read. */
  pageSha?: string
  at: number
}

/** (0.7.26) A signature given in this thread's pane: the tag signed, by whom, when, (0.7.33) the hash of the page it read, and what became of the words. */
export type MmCardSigned = { label: string; signer: string; at: number; pageSha?: string; filled?: 'filled' | 'draft' | 'none' | 'stale' }

/** (0.7.26) What this thread did with cards: each signature given here by tag, and whether the page as text is open under the card. */
export type MmCardMarks = {
  signed: Record<string, MmCardSigned>
  pageOpen?: boolean
  /** (0.7.33) A press reading the package again: which tag, and since when. */
  checking?: { label: string; at: number }
  /** (0.7.33) What the last press found when it recorded nothing: the card changed, or a read or record failed. */
  notice?: { packageId: string; kind: 'changed' | 'retry' }
}

/**
 * (0.7.36) Versions of a package by tag (the hash's first 12), and when. `cardPending`: this thread's turn got `card ready` for it, or
 * printed its page, and has not ended. `cardChecked`: such a turn ended, so this thread has finished checking it. Keys of their own and
 * not fields of `MmCardMarks`: one dispatch reads the state at one moment and `mm card` runs for seconds, so a shared key would write a
 * press's marks back over what they became.
 */
export type MmCardChecked = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'mm-bridge': {
      view: MmView
      queue: MmQueue
      notice: MmNotice
      band: MmBand
      folds: MmFolds
      teamNow: MmTeamNow
      people: MmPeople
      track: MmTrack
      sess: MmSession
      nudge: MmNudge
      lineAsk: MmLineAsk
      card: MmCard
      cardMarks: MmCardMarks
      cardChecked: MmCardChecked
      cardPending: MmCardChecked
      /** (0.7.36) This thread is working: a turn of the main conversation is running, or a background sub-agent outlived the last one. No box then. */
      cardBusy: boolean
      /** (0.7.36) The tag whose Check button could not put its words in the prompt box, and why: the pane says what to type. Null with none. */
      cardCheckMiss: { label: string; filled: 'draft' | 'none' } | null
      /** (0.7.37) The ready reply packages this thread's pane listed last: a new one scrolls the pane to its top. */
      seenPackages: string[]
    }
  }
}
