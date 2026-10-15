import type { EngineInterface, Register } from 'claude-code'

import type { MmBand, MmFolds, MmNotice, MmQueue, MmView } from '../types'

import {
  INTERNAL_PROJECTS, MAIL_LOOKBACK_HOURS, buildLists, byDue, isNewerVersion, isVersion, checkingTitle, internalProjects, cleanName, cleanTitle, clearedTitle, clientInTitle, clientMarkdown, clockText, feedClients, fastState, holdBanner, isClosingRoute, isUuid, needsLine, noteText, pinsNow,
  threadTitle, threadTitleShort, titleFor, withHolder,
} from './queue'
import type { Feed, FeedThread, KnownClient, QueueItem } from './queue'
import {
  LABEL, PANE_SENTENCE, THREAD_ID, autoLinkFate, autoLinkFor, bandWords, buttonLabel, claimText, clientThreads, declaredOther, foldGroups, hasWaiting, isStillOpenRow, kickoffText, onlyClients,
  newerThreadFor, openCommand, ownerOf, platformOf, recommend, rowButtons, rowDetail, rowFor, rowGroups, sharedThreads, signatureOf, staleCopySentence, startKickoff, threadLink, titleSuggestion,
  REFRESH_FAILED, asksForPrep, autoUpdatable, autoUpdateDue, bandText, chipTitle, ownPackage, seenNow, waitingText,
  START_ALL_MAX, startAllKickoff, startAllLabel, startAllSummary,
} from './threads'
import type { AppThread, Fold, Pairs, Recommendation, Replaced, Row, RowButton, RowState, FirstSeen, Sent } from './threads'

// The Massmarket bridge.
// Pinned threads are each person's to-do list: a client's thread pins itself and its name says what is
// due and when; opening it shows the drafts in a side pane and leaves a short note for Claude.
//
// Rob, 2026-10-12: "There should be a process that should already be looking to see what threads exist and
// deciding whether we should start a new one or not, and then making it really easy to pick up." So a
// client's existing thread links itself (a thread whose Claude Code session declared that client), each row
// of the Needs-you pane carries a recommendation, and its buttons act on it.
//
// Rob, 2026-10-12, on seeing it: "I think it should be 'update thread', 'open thread', or 'start thread'...
// depending on whether you know what we should do." So a row has ONE action, chosen by its state: Start
// (no thread, or the existing one is old or long), Update (the thread lacks what is waiting now), or Open
// (it already has it). And: "How do we open this panel up in other threads where it's not already open?"
// So every desktop thread carries one line above the prompt with a button that opens the list.
//
// ⛔ NEVER BY ITSELF. Linking, pinning and renaming are the only things a sync does. A message goes into a
// thread only from a button the person pressed in the pane or a /mm command the person typed: updateThread
// and claimThread, reached from `press` and from `runCommand` when it runs for the person. That message
// starts a model turn in the client's thread: the one paid moment the bridge causes, and the person asked
// for it. (0.5.2, R4/R5, Rob 2026-10-13) A chip is minted by itself too, in every running thread, for a
// client that needs a new thread (`autoChips`): a chip starts nothing until the person clicks it.
// ⛔ (0.5.11, Rob 10-15: "I think we should start updating threads automatically") ONE exception, and only while
//    auto is on (/mm auto, the switch auto-start has had since 0.5.7): after each sync, a client on the person's own
//    list whose linked thread lacks what is waiting gets Update's message (in words that never take the package:
//    kickoffText's `auto`, the marker first), through Update's own send and guards, once this bridge has seen the
//    client unchanged for AUTO_QUIET_MS and its drafts are ready (or AUTO_NO_DRAFTS_MS have passed since it first saw
//    the mail waiting), within AUTO_UPDATES_PER_SYNC from one sync and AUTO_UPDATES_PER_HOUR and AUTO_UPDATES_PER_DAY
//    on this computer, never into a thread the person used in the last AUTO_IDLE_MS, never from a thread into itself,
//    and only where the time-tracking hook counts it as automatic (`autoUpdates`). It stamps nothing and claims
//    nothing: an automatic send is nobody's act (R11).
// ⛔ CLAUDE CANNOT DO EITHER. The model can call the `mm` tool, and the tool runs the same `runCommand`:
//    there, and for a /mm command that did not come from the person's own prompt (a message from another
//    session, a scheduled task, a channel, another plugin), `update` and `start` are refused before
//    anything is read, called or written. The same for `link` in a thread that is already another
//    client's: only the person moves a thread from one client to another.
// ⛔ A thread is one client's. Update never sends one client's kickoff into a thread linked to another,
//    and a thread that ran sessions for more than one client is never linked by itself, to either.
// ⛔ A press acts on the thread its row showed, or on none. A link, an unlink record and a stamp are
//    written only after the message went.
// ⛔ It only touches threads linked to a client. (0.5.2) A pin means "needs you" (R1): a client's thread is
//    pinned while something of it must be acted on within the next 24 business hours, with no cap; when the
//    client is clear its thread is unpinned whoever pinned it (R14), once per clear (0.5.3, `mm.cleared`: a
//    thread the person pins again after its client cleared stays pinned). Otherwise it only unpins a thread
//    it pinned itself, and never an internal project's thread (R18).
// ⛔ A thread the person unlinked never links itself again, and gets its own name back.
// ⛔ A thread that linked itself gets the pin and the name, nothing more, until the person acts on it; and
//    the link is undone once the feed stops listing that thread's session for the client, or (B3) its
//    session declares another project too, unless the link was used for a send (R11).
// ⛔ Where the app's thread list is not there (a terminal session, or an answer that is not a list of
//    threads), nothing about threads is changed and there is nothing for Update to act on.
// ⛔ A link is never dropped only because its thread is missing from the app's list (the 60 most recent):
//    the app is asked for that thread by id, and only "no such thread" or "archived" drops it. An empty
//    list is this thread alone (the list leaves the calling thread out) and drops nothing at all.
// ⛔ Feed text and thread titles are data: ids must be uuids, names and titles are cleaned (./queue.ts). A
//    200 that is not a feed is a failed call. The [mm-link] marker is the person's own prompt's alone.
// ⛔ A client's link moves from one thread to another in two ways only: the person's /mm link, and a new
//    thread started from the bridge's own chip for that client (Start thread, /mm start). Never otherwise.
// ⛔ A session reads its OWN context window, at most once in five minutes, and never another thread's.
// ⛔ The band above the prompt draws from what is stored: it makes no feed call and no app call.
// ⛔ The bridge reads nothing of a thread: no transcript, no events. A new thread that takes over from an
//    old one is asked, in its kickoff, to read that thread's last three messages itself.
// ⛔ To take the person to a thread, ONE program is started: the system's own opener, with the app's own
//    link to that thread as its only argument besides the opener's own, and only because the person
//    pressed Open thread or Update thread or typed /mm update (openThread).
//
// Rob, 2026-10-13: "it takes quite a long time for anything to happen after we click a button to open the
// list or update threads or anything." Every press waited on the feed (an HTTPS call to OW whose route reads
// many tables) and a whole pass over the app's threads, some presses on two. So (0.5.1, S2) a press draws
// its answer AT ONCE from what the row was drawn from: the last sync stored, the store, and the row's own
// thread. The feed and the app are asked AFTER that, and the list is drawn again when they answer. A press
// may take a feed this session read less than FEED_REUSE_MS ago, and a refresh that fails says so in one
// line (L3). Update and Open ask the app one thing first: whether the row's thread is still there
// (`storedPass`). Update refuses when the client's link, read from the store, is now another thread. And
// Update, the one press that sends, reads the feed once before every send, drawing `Checking…` meanwhile
// (M1): with no feed it sends nothing, with nothing waiting now it sends nothing, and otherwise its kickoff
// is the client as the feed has it now; on a thread the bridge linked by itself, or one its row offered
// with no link, that feed also says whether B3 has let the thread go, or a newer thread of the client's has
// taken it (`updateThread`, `takenOver`). ⛔ Nothing that guards a send moved: a press acts on the thread its
// row showed or on none, B3, a thread taken over and the second-send guards are asked before the send as
// before, and every write is made over a fresh copy and checked again.

const EXT = 'https://onboarding-wizard.massmarket.ai/api/ext'
// Keep equal to .claude-plugin/plugin.json; scripts/release.mjs checks it.
const VERSION = '0.5.12'
/** The version that changes the person's thread list view once per machine (R15): it is recorded with the change. */
const VIEW_VERSION = '0.5.2'
const CLIENT_HEADER = { 'X-MM-Client': `mm-bridge/${VERSION}` }
const VIEW = { plugin: 'mm-bridge', key: 'view' } as const
const QUEUE = { plugin: 'mm-bridge', key: 'queue' } as const
const NOTICE = { plugin: 'mm-bridge', key: 'notice' } as const
const BAND = { plugin: 'mm-bridge', key: 'band' } as const
const FOLDS = { plugin: 'mm-bridge', key: 'folds' } as const
const PANE_VIEW = 'mm-view'
const PANE_QUEUE = 'mm-queue'
const SYNC_MS = 5 * 60_000
const TICK_MS = 60_000
/** (0.5.3) How often a thread withdraws its own chips that are no longer wanted, from the store alone (`chipsPass`). */
const CHIPS_PASS_MS = 15_000
const LEASE_MS = 150_000
const MAX_WRITES = 24
const DAY_MS = 24 * 3_600_000
/** A session's own pair (Claude Code session id → app thread) is kept this long after it last ran. */
const PAIR_KEEP_MS = 30 * DAY_MS
/** The most threads the store remembers an original title, or an unlink, for. */
const REMEMBER_MAX = 300
/** A link the person made or used stays pinned this long, ahead of the cap. Real hours: this is not a client's clock. */
const ACTED_MS = DAY_MS
/** The desktop app's own record of a thread is read only when it changed in this long. */
const RECORD_MAX_AGE_MS = 30 * DAY_MS
/** `local_<id>.json`: one record per thread, named by the app's thread id. */
const RECORD_FILE = /^(local_[A-Za-z0-9_-]{1,100})\.json$/
/** The most record files opened in one sync. */
const RECORDS_PER_SYNC = 40
const SESSION_ID = /^[A-Za-z0-9_-]{1,100}$/
/** A link the bridge made by itself is undone once its thread is missing from the feed's threads this many syncs in a row. */
const AUTO_MISSES = 3
/** Two of those misses count only when they are this far apart: three /mm in a row are one sync, not three. */
const MISS_GAP_MS = 5 * 60_000
/** The most threads asked for by id in one sync: linked or pinned threads the app's list (its 60 most recent) left out. */
const LOOKUPS_PER_SYNC = 10
/** A chip the bridge minted is remembered this long: a thread started from it later than that is a thread like any other. */
const CHIP_KEEP_MS = 30 * DAY_MS
/** The most chips remembered at once. */
const CHIPS_MAX = 250
/** The most chips one thread mints by itself, soonest due first. */
const AUTO_CHIPS_MAX = 5
/**
 * (0.5.4, C1-C3) The chips a thread mints by itself from this version on carry this mark. One without it (0.5.3's
 * copy in every running thread) is withdrawn by the thread that minted it on its first pass (C6).
 */
const CHIP_GEN = 4
/** (0.5.4, C3) A thread whose tick ran no longer ago than this is running: it can hold a chip. */
const ALIVE_MS = 5 * 60_000
/** (0.5.4, C3) A no-thread client's chip moves to the thread the person works in once they have worked elsewhere this long. */
const HANDOVER_MS = 10 * 60_000
/** (0.5.7) How long a session goes by its last look at which session tools the app gives it (`sessionTools`). */
const TOOLS_EVERY_MS = 5 * 60_000
/** (0.5.7, Rob 10-14: start threads by itself) The most threads this machine starts by itself in an hour, and in a day. */
const AUTO_STARTS_PER_HOUR = 4
const AUTO_STARTS_PER_DAY = 20
/** (0.5.7) A thread a session is about to start by itself is that session's alone this long (`mm.starting`). */
const STARTING_MS = 2 * 60_000
/** (0.5.11, Rob 10-15: update threads by itself) The most client threads this machine updates by itself in an hour, and in a day. */
const AUTO_UPDATES_PER_HOUR = 6
const AUTO_UPDATES_PER_DAY = 40
/** (0.5.11) An update a session is about to send by itself is that session's alone this long (`mm.updating`). */
const UPDATING_MS = 2 * 60_000
/** (0.5.11, review of PR #15, F1) The most updates sent by itself from one sync: the rest wait for the next sync. */
const AUTO_UPDATES_PER_SYNC = 3
/** (0.5.11, review of PR #15, F5) A thread the person used this recently is not updated by itself: the next sync tries again. */
const AUTO_IDLE_MS = 10 * 60_000
/** (0.5.11, review of PR #15, F4) A session reads what the time-tracking hook is no more often than this. */
const HOOK_CHECK_MS = 10 * 60_000
/** (0.5.7) A band note (a thread started by itself, the hourly cap) shows in every thread this long. */
const NOTE_SHOW_MS = 15 * 60_000
/**
 * (0.5.7) What start_session's `background` carries, which a "fresh" session requires (at least 80 characters, the
 * app's own schema): the brief itself is the client's kickoff, unchanged.
 */
const START_BACKGROUND =
  'Opened by the Massmarket bridge (mm-bridge) for one client on the Needs-you list. The brief is the kickoff the bridge sends that client\'s thread; its [mm-link] marker links this thread to the client.'
/** R10: how long a press, or a chip minted by itself, waits for the app before it says so. */
const APP_WAIT_MS = 15_000
/** R10: after the app did not answer a chip, or refused one, this thread mints none by itself for this long (or until its next turn). */
const MINT_PAUSE_MS = 10 * 60_000
/** (R9) A sync on record older than this is not a read the band may call all clear from. */
const STALE_SYNC_MS = 3 * SYNC_MS
/** A chip whose withdrawal fails this many times is forgotten. */
const DISMISS_TRIES = 5
/** A press on a row's button is in flight no longer than this: after it, the row takes a press again. */
const PRESS_HOLD_MS = 30_000
/** The system's opener is given this long to take a thread's link. */
const OPEN_WAIT_MS = 10_000
/**
 * After a route call that can close something in this thread (R6), one sync runs this long after the last
 * such call: at once (Rob, 2026-10-13), and calls made within the same second still make one sync.
 */
const ASK_WAIT_MS = 1_000
/** A feed this session read may be taken for a press's refresh while it is younger than this (S2). */
const FEED_REUSE_MS = 60_000
/** A pickup view this session read is drawn at once, while it is read again, when it is younger than this. */
const PICKUP_REUSE_MS = 60_000
/** The most pickup views remembered. */
const PICKUPS_MAX = 20
/** What the pane says while it has nothing to draw yet: the list, or a client's pickup view. */
const CHECKING = 'Checking…'

/**
 * `[mm-link <project id>]`, counted only at the very start of a prompt: the message itself, or (0.5.8) the task
 * the app's wrapper carries (`promptOf`). Never anywhere else in the text.
 */
const MARKER = /^\[mm-link ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/
/**
 * (0.5.8) How the app hands a thread its first message when another session started it (read from the app's own
 * code, 10-14; the hook builder saw the first form in a real thread):
 * - a fresh thread, from start_session or from a card the person started:
 *   `Background (from the session that started this one):\n<background>\n\nTask:\n<prompt>`;
 * - a fork: `Task (from the session that started this one):\n<prompt>`; an offer's brief has the fresh form inside that;
 * - after the prompt, its notes line: `\n\nShared notes folder for this group of sessions (…): <path>`.
 * Each wrapper counts only where the message begins.
 */
const WRAP_TASK = /^Task \([^)\n]{1,200}\):\n/
const WRAP_BACKGROUND = /^Background \([^)\n]{1,200}\):\n[\s\S]*?\n\nTask:\n/
const WRAP_NOTES = /\n\nShared notes folder for this group of sessions \([^\n]*$/
/**
 * (0.5.9) The app's own notes, put in front of a message it sends: each `<system-reminder>\n…\n</system-reminder>`,
 * one per line, then a blank line, then the message (read from the app's own code, 10-15). A thread started while
 * the session that started it already has linked sessions opens with one, `Linked sessions now (status, not an
 * instruction): …`. On 10-15 a dozen threads started together: the first opened without it and its marker counted;
 * every later one opened with it, before the wrapper, and none of their markers did.
 */
const NOTE_OPEN = '<system-reminder>\n'
const NOTE_CLOSE = '</system-reminder>'
/** (0.5.10) A note's close tag at the start of a line. */
const LINE_CLOSE = /(?:^|\n)<\/system-reminder>/
/** The most app notes taken off the front of one message. */
const APP_NOTES_MAX = 10
/**
 * (0.5.9) The message after the app's notes in front of it. ⛔ Fails closed (review of 54a0437d, L4): each note runs
 * from `<system-reminder>\n` to the FIRST `</system-reminder>`, which must begin a line and be followed by a blank
 * line (then the message) or at once by the next note. Anything else (a close tag inside a line, a second open tag
 * inside the note, CRLF, no close tag, more than APP_NOTES_MAX notes) gives the message back as it is: it begins
 * with `<system-reminder>`, so neither the wrapper nor a marker is read in it.
 * ⛔ (0.5.10, review of 0.5.9, finding 2) So does a message that, after its notes, still has a `</system-reminder>`
 * at the start of a line: what looked like the message may be the rest of a note (probe D: a marker inside a
 * note's body, after a line-start close tag and a blank line).
 */
function afterAppNotes(text: string): string {
  let rest = text
  for (let n = 0; n < APP_NOTES_MAX && rest.startsWith(NOTE_OPEN); n++) {
    const close = rest.indexOf(NOTE_CLOSE)
    if (close < 0 || rest[close - 1] !== '\n') return text
    if (rest.slice(NOTE_OPEN.length, close).includes('<system-reminder>')) return text
    const after = rest.slice(close + NOTE_CLOSE.length)
    if (after.startsWith('\n\n')) return LINE_CLOSE.test(after.slice(2)) ? text : after.slice(2)
    if (!after.startsWith(`\n${NOTE_OPEN}`)) return text
    rest = after.slice(1)
  }
  return text
}
/**
 * (0.5.8) The prompt a message carries: the message itself, or, when it begins with the app's wrapper, the task
 * after it, its notes line taken off. `task`: it began `Task (…):`, the form the app sends as `auto-continuation`.
 * (0.5.9) The app's own notes in front of it are taken off first: the message begins after them (`afterAppNotes`).
 */
function promptOf(text: string): { prompt: string; task: boolean } {
  const body = afterAppNotes(text)
  const task = WRAP_TASK.exec(body)
  let rest = task ? body.slice(task[0].length) : body
  const background = WRAP_BACKGROUND.exec(rest)
  if (background) rest = rest.slice(background[0].length)
  if (!task && !background) return { prompt: body, task: false }
  return { prompt: rest.replace(WRAP_NOTES, ''), task: task !== null }
}
/**
 * Where a prompt or a /mm command is the person's own: typed here (`composer`), sent from their phone or
 * the web (`bridge`), or the app's own turn for them, as when it starts a thread from a chip (`sdk`).
 * ⛔ Nothing else: not another Claude session's message (`peer`), a schedule, a channel or a plugin.
 */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])
/**
 * (0.5.8) The app's own delivery of a started thread's first task, for a fork or an offer's brief. It counts for
 * the marker only in the app's `Task (…):` wrapper (`promptOf`), and for nothing else.
 */
const STARTED_TASK_ORIGIN = 'auto-continuation'

const NO_THREAD_LIST = 'The app\'s thread list is not available here.'
/** What `link` from anything but the person says of a client the person linked to another thread (F4). */
const alreadyHas = (client: string) => `${client} already has a thread. Only the person can move it: they type /mm link ${client} in the thread that should have it.`
/** R10: what a press that makes a chip says before it asks the app for anything. */
const MAKING_CHIP = (client: string) => `Making a chip for ${client}…`
/** (0.5.7) The same, where Start opens the thread itself (start_session). */
const STARTING_THREAD = (client: string) => `Starting ${client}'s thread…`
/** R10: what it says when the app does not answer that in APP_WAIT_MS. */
const NO_ANSWER = (client: string) => `The app did not answer in 15 seconds, so no chip was made. Type /mm start ${client} in any thread.`
/** (fix round 1, L10) What a second message to a client says while the first is still going out. */
const STILL_GOING = (client: string) => `A message to ${client}'s thread is still going out. Check that thread before pressing again.`
/** R10 (Opus, 10-13, decision 1): what Update or Claim says when the app has not confirmed its message in APP_WAIT_MS. */
const NOT_CONFIRMED = (client: string) => `The app has not confirmed the message to ${client}'s thread yet. Check that thread before pressing again.`
/** R15: said once in the pane, the time the thread list's view is changed on this machine. */
const VIEW_NOTICE = 'Your thread list is now grouped by date, newest activity first, with pinned threads on top. Change it any time from the sidebar\'s filter menu.'
const THREAD_GONE = 'That thread is no longer available. The list has been refreshed.'
/** What Claude is told when it calls the tool with a verb only the person may use. */
const ONLY_THE_PERSON = {
  update: 'Only the person can do this: press Update thread in the pane or type /mm update <client>.',
  start: 'Only the person can do this: press Start thread in the pane or type /mm start <client>.',
} as const

type Mcp = { content?: Array<{ type: string; text?: string }>; isError?: boolean }
/** `internal` (0.5.2, R18): the pin is on an internal project's thread, which the bridge never unpins. */
type Pin = { projectId: string; client: string; byUs: boolean; internal?: true }
type Last = {
  at: number
  member: string
  /** The clients that need the person now: what pins, and what the header and the band count. */
  items: QueueItem[]
  /** Clients whose reply drafts a teammate holds, and clients whose only items are more than 3 business days overdue: listed, never pinned, never counted. */
  teammate?: QueueItem[]
  older?: QueueItem[]
  /** (0.5.2, R8) Clients whose package waits for the server's check of our newer send: off the list, not pinned, not counted. */
  checking?: QueueItem[]
  pinned: number
  recs: Record<string, Recommendation>
  /** Every project id the last feed carried: the only ids an [mm-link] marker may name. */
  projects?: string[]
  error?: string
}
/** Every client the last sync listed, in any of its lists: what a button, a command or a thread's own pane may be about. */
const listedIn = (last: Last | null | undefined): QueueItem[] => [
  ...(Array.isArray(last?.items) ? last.items : []),
  ...(Array.isArray(last?.teammate) ? last.teammate : []),
  ...(Array.isArray(last?.older) ? last.older : []),
  ...(Array.isArray(last?.checking) ? last.checking : []),
]
/**
 * A pin the person took off a thread the bridge had pinned: when, and the newest time of each kind of
 * thing its client had then. The thread is not pinned again until one of them is newer.
 */
type Unpinned = { at: number; mail: number; pkg: number; task: number }
/**
 * (0.5.3) The person went on in the client's linked thread while a chip for a new thread (R3, or R8's long-thread
 * one) was waiting: in which thread, when, and the newest time of each kind of thing the client had then. Until
 * something newer than both comes for the client, or its link moves, those chips are spent and none is minted.
 */
type ClaimedHere = { sid: string; at: number; newest?: { mail: number; pkg: number; task: number } }

/**
 * (0.5.3) Whether a claim in place still holds: the client is still linked to the thread it was made in, and
 * nothing newer has come for the client since (each kind measured against the later of the claim and what the
 * client had then: a task's time can be its due time, still ahead).
 */
function claimHolds(claim: ClaimedHere | undefined, projectId: string, links: Readonly<Record<string, string>>, last: Last | null): claim is ClaimedHere {
  if (!claim || typeof claim !== 'object' || typeof claim.sid !== 'string' || !Number.isFinite(claim.at)) return false
  if (links[projectId] !== claim.sid) return false
  const it = listedIn(last).find(i => i.projectId === projectId)
  if (!it) return true
  for (const kind of ['mail', 'pkg', 'task'] as const) {
    if ((Number(it.newest?.[kind]) || 0) > Math.max(Number(claim.newest?.[kind]) || 0, claim.at)) return false
  }
  return true
}

/**
 * (0.5.3) A chip for a new thread that replaces the client's thread `sid`: R3's (minted while the client had it), or
 * R8's long-thread one. Never R4's, for a client with no thread, and (0.5.4) never a `Do it here` chip.
 */
const replacesThread = (c: Chip, sid: string): boolean => c.need !== 'here' && (c.had === sid || c.need === 'long')
/**
 * (0.5.4, C3) What each running thread last said of itself: when its tick last ran, and when the person last wrote
 * in it (their own prompt). The thread the person is working in now holds a no-thread client's chip.
 */
type Seen = Record<string, { tick: number; human?: number }>
type Verb = RowButton
/** A link the person made or used: which thread, and when. */
type Acted = Record<string, { sid: string; at: number }>
/**
 * A chip the bridge minted for a client and the person has not started yet. A chip shows only in the
 * thread that minted it, and only that thread's session can withdraw it, so the record says which.
 * One live chip per client: minting another marks the earlier one `superseded`.
 */
type Chip = {
  projectId: string
  /** What its prompt carries (signatureOf): the thread started from it already has this. */
  signature: string
  /** The app's id for the chip, from its answer to the mint; '' when it gave none (it cannot be withdrawn then). */
  taskId: string
  /** The thread it was minted in. */
  threadId: string
  at: number
  /** Its prompt exactly as minted: the thread that opens with this prompt was started from this chip. */
  prompt: string
  /** The thread the client was linked to when it was minted, if any: a link to any other thread since means the client has moved on. */
  had?: string
  superseded?: true
  /** Withdrawals that failed so far. */
  tries?: number
  /** (0.5.2, R5) Minted by the thread itself, not from a press: withdrawn once the need it was minted for is gone. */
  auto?: true
  /**
   * (0.5.2) What it was minted for: a new thread (`start`, R3/R4), or a new thread for a client still open after our
   * reply whose thread is long (`long`, R8); (0.5.4, C1) or the client's kickoff run in its own thread (`here`).
   */
  need?: 'start' | 'long' | 'here'
  /** (0.5.4) CHIP_GEN on a chip this version minted by itself. */
  gen?: number
  /** (0.5.4, C2/C3) The thread it is in, as the band names it (`threadTitleShort`), from that thread's title when it was minted. */
  place?: string
}
/**
 * A link the bridge made by itself and the person has not acted on: its thread, how many syncs in a row
 * the feed has not listed it, and when the last of those was counted.
 */
type Auto = Record<string, { sid: string; miss: number; at?: number; made?: number }>
/** What the app's record of a thread said when it was opened: its modified time then, and the session id if it gave one. */
type Records = Record<string, { m: number; cli?: string }>
/**
 * The app's threads as one sync sees them. `complete` is false for an empty list (the app's list leaves the
 * calling thread out, so a person with one open thread gets none): this thread is then the whole list, and
 * ⛔ nothing may be dropped on its word.
 */
type Listed = { threads: AppThread[]; complete: boolean }
/**
 * One pass over a feed. `listed` is false where the app's thread list could not be had. `unseen` holds the
 * linked or pinned threads the list left out and the app did not answer for: kept, and not acted on.
 * `stored`: no pass was made. A press's answer drawn from what the last sync stored, `live` holding at most
 * the row's own thread as the app answered for it by id (`storedPass`, S2).
 */
type Pass = { last: Last; live: Map<string, AppThread>; pairs: Pairs; listed: boolean; unseen: ReadonlySet<string>; stored?: true }
/** Who ran a /mm command: the person, or anything else (the model through the tool, another session, a schedule, a plugin). */
type By = 'person' | 'other'

/**
 * This session's thread, as the app answered `get_session self`, by the session's own id. In the app one
 * module serves one session, so this holds one entry; keyed by the session, several sessions run against
 * one store in a test (concurrency.test.ts) each know their own thread.
 */
const selves = new Map<string, string>()
/**
 * The presses in flight in this session, by client: when each began. A second press for a client whose
 * first has not returned does nothing (Rob pressed Update, saw nothing happen, pressed again, and the
 * thread got two messages).
 */
const pressing = new Map<string, number>()
let pressCount = 0
/** The one sync this session owes after a reply draft was sent or discarded in it (askSync): its timer, or none. */
let askTimer: { cancel: () => void } | null = null
/**
 * What this session's Update sent into a thread, by client and thread: the kickoff's signature. Asked before
 * every Update beside what is stored, so a second press never sends the same kickoff into the same thread,
 * even when the store refused every write after the first went (review of 79cbc596, F2).
 */
const sentHere = new Map<string, string>()
/**
 * The chips this session minted whose record the store refused, by client, thread and what they carry: a
 * second press mints none while the store cannot say the chip is there. Forgotten once the record is written,
 * or the client has moved on (M1).
 */
const mintedHere = new Set<string>()
/** The chip mints in flight in this session (thread, client, signature): a second is not started while one waits for the app. */
const minting = new Set<string>()
/**
 * Fix round 1, F4: every chip this session minted, by thread, client, id and time (`chipKey`), as this session
 * knows it, whatever the store lost to another session's write: a record missing from the store is written back
 * (the 1 to 3 second check, and every tick), never minted again, and still withdrawn. Forgotten once withdrawn.
 */
const ownChips = new Map<string, Chip>()
const chipKey = (c: Chip): string => `${c.threadId}\n${c.projectId}\n${c.taskId}\n${c.at}`
/**
 * R10, by session: no chip is minted by itself before `until` (the app did not answer one, or refused it), and
 * `atTurn`, the next turn in the thread tries again (the app did not answer one outside a turn). (Keyed by the
 * session as `selves` is: several sessions run against one module in a test.)
 */
const mintPause = new Map<string, { until: number; atTurn: boolean }>()
/** R15: the sessions that tried the view change already. */
const viewTried = new Set<string>()
/** The clients whose message (Update, Claim) is in flight in this session: their press stays held until the app answers it. */
const sending = new Set<string>()
/**
 * The feed this session read last: when, and the sync record the pass over it stored (`wrote`, as stored). A
 * press takes it again only while it is younger than FEED_REUSE_MS AND the store still holds that very
 * record: no other session has synced since, so the list drawn from it is the list drawn now (S2).
 */
let recent: { at: number; feed: Feed; wrote: string } | null = null
/** The pickup views this session read, by package: drawn at once for a press while they are read again. */
const pickups = new Map<string, { at: number; text: string }>()
/** Each session's newest draw of its client part: an older one still reading its view draws nothing over it. */
const viewDraws = new Map<string, number>()

/**
 * A write that failed after the person's act went (an Update's message, a chip): noted where the bridge's
 * other errors go, the heartbeat file the timer's and registration's errors go to. Never swallowed silently.
 */
async function noteFailure($: EngineInterface, what: string, err: unknown): Promise<void> {
  await beat($, { ok: false, writeError: short(`${what}: ${errorText(err)}`, 300) })
}

const textOf = (r: Mcp) => (r.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n')
const short = (s: string, n = 200) => s.replace(/\s+/g, ' ').slice(0, n)
const errorText = (err: unknown) => short(err instanceof Error ? err.message : String(err), 300)
/** The member's address as the feed gave it, kept to what an address is made of. */
const memberText = (member: unknown) => (typeof member === 'string' ? member : '').replace(/[^A-Za-z0-9._%+@-]/g, '').slice(0, 120)
/** A thread name the bridge wrote itself: never anybody's original title. */
const isOurTitle = (title: string) => /^(?:🔴|🟡|✓)\s/u.test(title)

async function mcpJson($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const r = (await $.mcp.call(server, tool, args)) as Mcp
  const text = textOf(r)
  if (r.isError) throw new Error(`${server}.${tool}: ${short(text)}`)
  try {
    return JSON.parse(text.slice(text.search(/[[{]/)))
  } catch {
    return text
  }
}

/**
 * R10 (Rob, 2026-10-13: Start on a client said nothing at all, and no chip came): an app call given at most `ms`
 * to answer. `{ ok: false }` when it has not by then. The call itself goes on (nothing on `$` stops it): a caller
 * that must know how it ended takes `work` itself later. A call that fails before then rejects as it would have.
 */
async function within<T>($: EngineInterface, work: Promise<T>, ms = APP_WAIT_MS): Promise<{ ok: true; value: T } | { ok: false }> {
  const timer: { cancel?: () => void } = {}
  const timeout = new Promise<{ ok: false }>(resolve => {
    try {
      const t = $.clock.after(ms, () => resolve({ ok: false }))
      timer.cancel = () => t.cancel()
    } catch {
      // no timer here: the call is waited for, as in 0.5.1
    }
  })
  const answered = work.then(value => ({ ok: true as const, value }))
  // a call that fails after the wait ended has nobody left to tell
  answered.catch(() => {})
  try {
    return await Promise.race([answered, timeout])
  } finally {
    timer.cancel?.()
  }
}

/** mcpJson given at most APP_WAIT_MS: what the app answered, or `null` when it did not answer in time. */
async function mcpJsonWithin($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await within($, mcpJson($, server, tool, args))
  return r.ok ? r.value : null
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
}

// ---------------------------------------------------------------- (0.5.5) a newer mod installed on this machine

/** How often a thread looks for a newer mod. */
const VERSION_EVERY_MS = 5 * 60_000
/** The newest mm-bridge on this machine, by session, when it is later than this thread's own VERSION ('' otherwise), and when that was looked for. */
const newerMod = new Map<string, { version: string; at: number }>()

/**
 * (0.5.5, Rob 10-14: the band "could also say when there's an update and they need to restart their Claude Code")
 * Whether a later mm-bridge than the one this thread runs (VERSION) is installed on this machine. Two ways, both
 * read, the later version wins:
 *   (a) the plugin cache: the version folders beside this plugin's own (`$.plugin.root`, the engine's word for the
 *       directory holding plugin.json, whose parent holds one folder per installed version), listed with `$.fs.list`;
 *       else `~/.claude/plugins/cache/massmarket/mm-bridge`;
 *   (b) the store: each running thread writes the version it runs (`mm.versions`); any reported in the last day.
 * At most once in VERSION_EVERY_MS for a session. Nothing is called on the app.
 */
async function checkVersions($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const id = await instanceId($)
  const was = newerMod.get(id)
  if (was && now - was.at < VERSION_EVERY_MS) return
  const me = await knownSelf($)
  const versions = await storeGet<Record<string, { version?: unknown; at?: unknown }>>($, 'mm.versions', {})
  if (me && (versions[me]?.version !== VERSION || !(now - Number(versions[me]?.at) < DAY_MS / 24))) {
    await patchStore<Record<string, { version?: unknown; at?: unknown }>>($, 'mm.versions', {}, fresh => {
      fresh[me] = { version: VERSION, at: now }
      for (const [sid, v] of Object.entries(fresh)) if (!v || !(now - Number(v.at) <= DAY_MS)) delete fresh[sid]
    }).catch(() => {})
  }
  let newest = VERSION
  for (const v of await installedVersions($)) if (isNewerVersion(v, newest)) newest = v
  for (const v of Object.values(versions)) if (v && now - Number(v.at) <= DAY_MS && isNewerVersion(v.version, newest)) newest = String(v.version)
  newerMod.set(id, { version: newest === VERSION ? '' : newest, at: now })
}

/** (0.5.5, way (a)) The versions of mm-bridge in the plugin cache: the folder names that are versions. [] when it cannot be listed. */
async function installedVersions($: EngineInterface): Promise<string[]> {
  const dirs: string[] = []
  try {
    const root = String($.plugin.root ?? '')
    const last = root.split(/[\\/]/).pop() ?? ''
    if (isVersion(last)) dirs.push(root.slice(0, root.length - last.length - 1))
  } catch {
    // no word on this plugin's own folder: the usual place below
  }
  const h = await home($)
  if (h) dirs.push(`${h}/.claude/plugins/cache/massmarket/mm-bridge`)
  for (const dir of dirs) {
    try {
      return (await $.fs.list(dir)).filter(e => e.kind === 'dir' && isVersion(e.name)).map(e => e.name)
    } catch {
      // the next place
    }
  }
  return []
}

async function token($: EngineInterface): Promise<string> {
  try {
    const t = (await $.fs.read(`${await home($)}/.claude/mm-hooks/token`)).trim()
    if (t) return t
  } catch {
    // no token file: handled below
  }
  throw new Error('not set up on this computer: no tracker token. Run the Massmarket installer from the time tracker extension.')
}

// The desktop app's session tools (list, rename, pin) exist only in its Code tab. Elsewhere (a terminal
// session) the bridge still answers /mm, it just has no threads to pin or rename.
async function desktopOnly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

async function selfId($: EngineInterface): Promise<string> {
  const cli = await instanceId($)
  const known = selves.get(cli)
  if (known) return known
  // (R10: an app that does not answer in time leaves this thread unknown for now, as no app at all does)
  const me = await desktopOnly(async () => (await mcpJsonWithin($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as AppThread | null, null)
  if (!me?.sessionId) return ''
  selves.set(cli, me.sessionId)
  return me.sessionId
}

/** This thread's id as the timer already learnt it, or '': no app call is made to find it out. */
async function knownSelf($: EngineInterface): Promise<string> {
  return selves.get(await instanceId($)) ?? ''
}

async function instanceId($: EngineInterface): Promise<string> {
  return String((await $.session.id()) ?? '')
}

/** A thread as the app answered it, kept to the fields the bridge uses; null for anything that is not an open thread. */
function asThread(raw: unknown): AppThread | null {
  const t = raw as Partial<AppThread> | null | undefined
  if (!t || typeof t !== 'object' || typeof t.sessionId !== 'string' || !t.sessionId || t.isArchived) return null
  // the app's own link to the thread, kept only when it is exactly that thread's (threadLink)
  const link = threadLink(t as { sessionId: string; link?: unknown })
  return {
    sessionId: t.sessionId,
    title: typeof t.title === 'string' ? t.title : '',
    pinned: Boolean(t.pinned),
    isArchived: false,
    ...(typeof t.lastActivityAt === 'string' ? { lastActivityAt: t.lastActivityAt } : {}),
    ...(link ? { link } : {}),
  }
}

/**
 * The app's open threads, or null where the list cannot be had: no app to ask (a terminal session), a call
 * that failed, or an answer that is not a list. ⛔ null is "unknown", never "none".
 *
 * The app's list leaves the calling thread out, so a person with one open thread gets an empty list. An
 * empty list from a call that worked, in a session that knows its own thread, is a list of one: this
 * thread may link, pin and name itself. It is marked not `complete`: ⛔ an empty answer never drops a
 * link, a pin, a title or a record, because it cannot be told from the app answering nothing by mistake.
 */
async function sessions($: EngineInterface): Promise<Listed | null> {
  return desktopOnly<Listed | null>(async () => {
    // (R10: an app that does not answer in time is no list: unknown, never none)
    const others = await mcpJsonWithin($, 'ccd_session_mgmt', 'list_sessions', { limit: 60 })
    if (!Array.isArray(others)) return null
    const me = asThread(await mcpJsonWithin($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' }))
    if (others.length === 0) return me ? { threads: [me], complete: false } : null
    const threads: AppThread[] = []
    for (const raw of [me, ...others]) {
      const t = asThread(raw)
      if (t && !threads.some(x => x.sessionId === t.sessionId)) threads.push(t)
    }
    return { threads, complete: true }
  }, null)
}

/**
 * One thread, asked for by id: for a linked or pinned thread the app's list left out (the list holds its 60
 * most recent). The thread when it is open; 'gone' ONLY when the app says there is no such thread or shows
 * it archived; 'unknown' for any error, any other answer, or no app to ask. ⛔ Only 'gone' may drop a link.
 */
async function lookup($: EngineInterface, sid: string): Promise<AppThread | 'gone' | 'unknown'> {
  const noSuchThread = (text: string) => text.includes(sid) && /\bnot found\b/i.test(text)
  try {
    // (R10: no answer in time says nothing about the thread)
    const asked = await within($, $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: sid }) as Promise<Mcp>)
    if (!asked.ok) return 'unknown'
    const r = asked.value
    const text = textOf(r)
    if (r.isError) return noSuchThread(text) ? 'gone' : 'unknown'
    let raw: Partial<AppThread> | null
    try {
      raw = JSON.parse(text.slice(text.search(/[[{]/))) as Partial<AppThread> | null
    } catch {
      return 'unknown' // an answer that is not a thread says nothing about this one
    }
    if (!raw || typeof raw !== 'object' || raw.sessionId !== sid) return 'unknown'
    return raw.isArchived ? 'gone' : (asThread(raw) ?? 'unknown')
  } catch (err) {
    // the call itself was refused: "no such thread" only when that is what the app said, about this thread
    return noSuchThread(errorText(err)) ? 'gone' : 'unknown'
  }
}

/** Every project id a feed carries, uuids only: what an [mm-link] marker may name. */
function feedProjects(feed: Feed): string[] {
  const ids = new Set<string>()
  const add = (id: unknown) => {
    if (isUuid(id) && ids.size < 500) ids.add(id)
  }
  for (const m of feed.mail ?? []) add(m.project_id)
  for (const d of feed.drafts ?? []) add(d.project_id)
  // (fix round 1, F5) `start_now` too
  for (const k of [feed.tickets?.overdue, feed.tickets?.due_today, feed.tickets?.due_soon, feed.tickets?.start_now]) for (const t of k ?? []) add(t.project_id)
  for (const t of Array.isArray(feed.threads) ? feed.threads : []) add(t?.project_id)
  return [...ids]
}

/** The feed's `threads` rows that are usable: a uuid project and a session id the worklog hook could have sent. */
function feedThreadsOf(feed: Feed): FeedThread[] {
  return (Array.isArray(feed.threads) ? feed.threads : []).filter(t => t && isUuid(t.project_id) && typeof t.session_id === 'string' && SESSION_ID.test(t.session_id))
}

async function fetchFeed($: EngineInterface): Promise<Feed> {
  // (OW's most: mail old enough to go under Older is in the feed, MAIL_LOOKBACK_HOURS)
  const r = await $.http.fetch(`${EXT}/closeout?mail_hours=${MAIL_LOOKBACK_HOURS}`, { headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER } })
  const failed = () => new Error(`closeout HTTP ${r.status}: ${short(r.text, 160)}`)
  if (!r.ok) throw failed()
  const feed = JSON.parse(r.text) as Feed | null
  // ⛔ A 200 that is not a feed (neither `tickets` nor `mail` in it) is a failed call, not "nobody needs
  // you": read as an empty feed it would take every pin off and rename every thread "clear".
  if (!feed || typeof feed !== 'object' || !('tickets' in feed || 'mail' in feed)) throw failed()
  recent = { at: await $.clock.now(), feed, wrote: '' }
  return feed
}

/**
 * The feed for a press's refresh (S2): the one this session read last, while it is younger than
 * FEED_REUSE_MS and the store still holds the sync record made from it; else OW is asked again.
 */
async function recentFeed($: EngineInterface): Promise<Feed> {
  const r = recent
  if (r?.wrote && (await $.clock.now()) - r.at < FEED_REUSE_MS && JSON.stringify(await storeGet<Last | null>($, 'mm.last', null)) === r.wrote) return r.feed
  return fetchFeed($)
}

async function storeGet<T>($: EngineInterface, key: string, fallback: T): Promise<T> {
  const v = await $.store.get(key)
  return (v === undefined || v === null ? fallback : v) as T
}

/** Keeps the newest `max` entries of a record the store holds (insertion order). */
function capped<T>(record: Record<string, T>, max = REMEMBER_MAX): Record<string, T> {
  const keys = Object.keys(record)
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete record[k]
  return record
}

/**
 * ⛔ THE ONE WAY a map or a list that sessions share is written to the store (B1, 2026-10-13: of fifteen
 * threads started within a minute or two, two lost the link their [mm-link] marker wrote).
 *
 * Every desktop thread is a process of its own. The engine reads the store's file afresh on each get and
 * writes ONE key on each set, under a lock (its own source, 2.1.295), so a set never touches another key.
 * But a key is written whole: a session that writes back a map it read earlier takes away whatever another
 * session put into it since (a dozen threads linking themselves; a sync whose pass takes seconds of app
 * calls between its reads and its writes). So the key is read again immediately before the write, `change`
 * makes ONLY its caller's own change to that fresh copy, and it is written at once: nothing is awaited
 * between the read and the write. `change` answers false to write nothing; `stored` tells it whether the
 * store held the key at all. A value of the wrong shape (an older version's, a damaged file) is read as
 * `empty`.
 * The store has no compare-and-set, so two sessions can still meet between that read and that write; what
 * the person's own act wrote is checked again a moment later (`settleLater`).
 */
async function patchStore<T extends object>($: EngineInterface, key: string, empty: T, change: (fresh: T, stored: boolean) => boolean | void): Promise<T> {
  const v = await $.store.get(key)
  const shaped = v !== null && typeof v === 'object' && Array.isArray(v) === Array.isArray(empty)
  const fresh = (shaped ? v : empty) as T
  if (change(fresh, v !== undefined) === false) return fresh
  await $.store.set(key, fresh)
  return fresh
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** A copy of what a pass read, to tell later what the pass itself changed. */
const copyOf = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) ?? v

/**
 * What a pass changed in a map, entry by entry, made on the store's fresh copy (`patchStore`): `before` is
 * the map as the pass read it, `after` as the pass left it. An entry the pass did not change is left as the
 * store has it now, and so is one another session changed since the pass read it: a sync never takes back a
 * link, a pin or a record written while it ran (it sees it on its next pass). Answers whether it changed
 * anything. `only` makes just the entries it set (`set`) or just the ones it removed (`delete`): a record
 * another depends on is written before it and removed after it (F2).
 */
function applyChanges<V>(fresh: Record<string, V>, before: Readonly<Record<string, V>>, after: Readonly<Record<string, V>>, only?: 'set' | 'delete'): boolean {
  let changed = false
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const had = Object.hasOwn(before, k) ? before[k] : undefined
    const has = Object.hasOwn(after, k) ? after[k] : undefined
    if (sameValue(had, has)) continue
    if ((only === 'set' && has === undefined) || (only === 'delete' && has !== undefined)) continue
    const now = Object.hasOwn(fresh, k) ? fresh[k] : undefined
    if (!sameValue(now, had)) continue
    if (has === undefined) delete fresh[k]
    else fresh[k] = has as V
    changed = true
  }
  return changed
}

/**
 * (0.5.9, review of 54a0437d, L2) `applyChanges` for the links, where ⛔ a thread is one client's: a client this pass
 * links to a thread that another client holds in the store's fresh copy (another session linked it while this pass
 * ran) keeps what the store has for it.
 */
function applyLinkChanges(fresh: Record<string, string>, before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): boolean {
  const prior = { ...fresh }
  applyChanges(fresh, before, after)
  for (const [pid, sid] of Object.entries(fresh)) {
    if (prior[pid] === sid) continue
    if (!Object.entries(fresh).some(([other, held]) => other !== pid && held === sid)) continue
    if (prior[pid] === undefined) delete fresh[pid]
    else fresh[pid] = prior[pid] as string
  }
  return !sameValue(fresh, prior)
}

/** The same for a list of thread ids: what the pass took off it comes off, what it added goes on, the rest is the store's. */
function applyListChanges(fresh: string[], before: readonly string[], after: readonly string[]): boolean {
  const off = before.filter(x => !after.includes(x))
  const on = after.filter(x => !before.includes(x) && !fresh.includes(x))
  const kept = fresh.filter(x => !off.includes(x))
  if (kept.length === fresh.length && !on.length) return false
  fresh.splice(0, fresh.length, ...kept, ...on)
  return true
}

/** 1 to 3 seconds, spread by the thread's own id: a dozen threads that start together do not check again together. */
function settleMs(id: string): number {
  // FNV-1a, then mixed, so ids that differ in one character land far apart
  let h = 0x811c9dc5
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return 1_000 + (h % 2_001)
}

/**
 * Once, 1 to 3 seconds after a write the person's own act made (a marker's link, a session's own pair), it is
 * read again and written again if it is gone: what two sessions meeting between a read and a write can still
 * lose (patchStore), and what a set the engine could not lock in time never wrote. Anything going wrong here
 * is swallowed: the next sync is the fallback.
 */
function settleLater($: EngineInterface, id: string, check: () => Promise<void>): void {
  try {
    $.clock.after(settleMs(id), () => void check().catch(() => {}))
  } catch {
    // no timer here: nothing is checked again
  }
}

/**
 * The app's list of threads does not say which Claude Code session runs in each, and the feed names a
 * thread by that session id (it is what the worklog hook sends). So every session writes down its own
 * pair, and the session that syncs reads them all: a thread opened since this version was installed can
 * be matched to the client its session declared.
 */
async function recordSelf($: EngineInterface): Promise<void> {
  const app = await selfId($)
  const cli = await instanceId($)
  if (!app || !cli) return
  const now = await $.clock.now()
  const mine = (await storeGet<Pairs>($, 'mm.threads', {}))[cli]
  if (mine && mine.app === app && now - mine.at < DAY_MS) return
  const write = () =>
    patchStore<Pairs>($, 'mm.threads', {}, pairs => {
      // (0.5.9) when the pair was first written for this thread: written with every first write, and kept through
      // the daily rewrite. It is the thread's start for R1b (`threadStart`), so a thread the person goes back to is
      // not made newer by it. ⛔ A pair written before 0.5.9 has none and gets none (M1): its `at` is its last
      // rewrite, not when the thread started, and its thread's start stays unknown.
      const was = pairs[cli]
      if (!was || was.app !== app) pairs[cli] = { app, at: now, since: now }
      else pairs[cli] = typeof was.since === 'number' && Number.isFinite(was.since) ? { app, at: now, since: was.since } : { app, at: now }
      for (const [k, v] of Object.entries(pairs)) if (!v || now - v.at > PAIR_KEEP_MS) delete pairs[k]
    })
  // gone a moment later (another session's write met this one, or this one was never made): written again.
  // A pair the app's own record has since given another thread is the app's word, and is left.
  settleLater($, app, async () => {
    if (!(await storeGet<Pairs>($, 'mm.threads', {}))[cli]) await write()
  })
  await write()
}

/** A thread linked by the person (a command, a button, a chip's first message) may link itself again later. */
async function forgetUnlink($: EngineInterface, sid: string): Promise<void> {
  await patchStore<Record<string, number>>($, 'mm.unlinked', {}, unlinked => {
    if (!(sid in unlinked)) return false
    delete unlinked[sid]
  })
}

/** Where the desktop app keeps its record of each thread, by platform. The first folder that lists is used. */
async function recordRoots($: EngineInterface): Promise<string[]> {
  const roots: string[] = []
  const appData = await $.env.get('APPDATA')
  if (appData) roots.push(`${appData.replace(/[\\/]+$/, '')}\\Claude\\claude-code-sessions`)
  const h = await home($)
  if (h) roots.push(`${h}/Library/Application Support/Claude/claude-code-sessions`, `${h}/.config/Claude/claude-code-sessions`)
  return roots
}

/**
 * The second source for "which Claude Code session runs in which thread": the desktop app's own records,
 * the `local_<id>.json` files under its `claude-code-sessions` folder. They exist for every thread, so a thread links itself without
 * having to be opened again first (Rob, 2026-10-12: "Why are none of them linked?").
 *
 * ⛔ READ-ONLY, through the plugin's own file access. From each record ONLY two things are taken: the
 * thread id and `cliSessionId`. Nothing else in a record is kept, logged or sent anywhere, and nothing
 * from these files leaves this computer: the pairs are only compared with the feed's session ids here.
 *
 * ⛔ IT OPENS ONLY WHAT IT NEEDS. A record is opened only when it is the record of a thread the app listed
 * in this sync, not archived, that has no pair in the store yet; at most RECORDS_PER_SYNC in one sync, the
 * most recently modified first; never one not modified in 30 days. What a record said (its session id, or
 * that it gave none) is remembered with its modified time, so it is not opened again until it changes,
 * and each pair found goes into the store with the pairs the sessions wrote. The folder is listed, not
 * read, to find those files. Any error at all (no such folder, a file that cannot be read or parsed, a
 * different shape) is swallowed: what each session wrote down about itself is then the only source.
 */
async function readRecords($: EngineInterface, now: number, live: ReadonlyMap<string, AppThread>, pairs: Pairs): Promise<void> {
  const paired = new Set(Object.values(pairs).map(p => p?.app))
  const need = new Set<string>()
  for (const s of live.values()) if (!s.isArchived && !paired.has(s.sessionId)) need.add(s.sessionId)
  if (!need.size) return
  const seen = await storeGet<Records>($, 'mm.records', {})
  /** What this pass learnt from the records it opened: the only entries it writes. */
  const learnt: Records = {}
  const found: Pairs = {}
  let opened = 0
  for (const root of await recordRoots($)) {
    const sep = root.includes('\\') ? '\\' : '/'
    /** The newest record on disk for each thread that needs one. */
    const newest = new Map<string, { path: string; mtimeMs: number }>()
    const walk = async (dir: string, depth: number): Promise<void> => {
      for (const entry of await $.fs.list(dir)) {
        const path = `${dir}${sep}${entry.name}`
        if (entry.kind === 'dir') {
          // records sit two folders down today; one more level is allowed for
          if (depth < 3) await walk(path, depth + 1).catch(() => {})
          continue
        }
        const app = entry.kind === 'file' ? RECORD_FILE.exec(entry.name)?.[1] : undefined
        if (!app || !need.has(app) || now - entry.mtimeMs > RECORD_MAX_AGE_MS) continue
        const had = newest.get(app)
        if (!had || entry.mtimeMs > had.mtimeMs) newest.set(app, { path, mtimeMs: entry.mtimeMs })
      }
    }
    try {
      await walk(root, 0)
    } catch {
      continue // this platform's folder is not here: try the next
    }
    const unread = [...newest].filter(([app, file]) => seen[app]?.m !== file.mtimeMs).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)
    const said: Array<{ app: string; cli: string; mtimeMs: number }> = []
    for (const [app, file] of unread.slice(0, RECORDS_PER_SYNC)) {
      let cli = ''
      try {
        const record = JSON.parse(await $.fs.read(file.path)) as { sessionId?: unknown; cliSessionId?: unknown }
        // the record must be this thread's own, and name a session id the hook could have sent
        if ((record.sessionId === undefined || record.sessionId === app) && typeof record.cliSessionId === 'string' && SESSION_ID.test(record.cliSessionId)) {
          cli = record.cliSessionId
        }
      } catch {
        // unreadable, not JSON, too large: this record gives no pair
      }
      opened++
      learnt[app] = seen[app] = cli ? { m: file.mtimeMs, cli } : { m: file.mtimeMs }
      if (cli) said.push({ app, cli, mtimeMs: file.mtimeMs })
    }
    // A record just opened is the app's own word: it wins over a pair a session wrote down. Oldest first,
    // so where two records name one session the more recently modified thread has it.
    // (0.5.9, M1) dated the day it was found, with no `since`: when its thread started is not known from it
    for (const r of said.sort((a, b) => a.mtimeMs - b.mtimeMs)) found[r.cli] = { app: r.app, at: now }
    // A record opened earlier whose pair has since dropped out of the store gives it back without being
    // opened again, unless another thread has that session by now.
    for (const [app, file] of newest) {
      const was = seen[app]
      if (was?.cli && was.m === file.mtimeMs && !pairs[was.cli] && !found[was.cli]) found[was.cli] = { app, at: now }
    }
    break
  }
  if (opened) {
    await patchStore<Records>($, 'mm.records', {}, records => {
      // each written last, so the cap keeps the records most recently opened
      for (const [app, said] of Object.entries(learnt)) {
        delete records[app]
        records[app] = said
      }
      capped(records)
    })
  }
  if (Object.keys(found).length) {
    Object.assign(pairs, found)
    // over a fresh copy: another session may have recorded itself since this pass began
    await patchStore<Pairs>($, 'mm.threads', {}, fresh => void Object.assign(fresh, found))
  }
}

/**
 * Every known pair: what each session wrote down about itself, and what the app's records gave. The
 * records are looked at only when the feed names at least one session to match.
 */
async function allPairs($: EngineInterface, now: number, live: ReadonlyMap<string, AppThread>, feedThreads: readonly FeedThread[]): Promise<Pairs> {
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  if (!feedThreads.length) return pairs
  try {
    await readRecords($, now, live, pairs)
  } catch {
    // no pairs from the app: the pairs each session records are the only source
  }
  return pairs
}

/** What a client's thread has now (Update sent it, or a chip it opened with carried it): written last, so the cap keeps the newest. */
async function putSent($: EngineInterface, projectId: string, sent: Sent): Promise<void> {
  await patchStore<Record<string, Sent>>($, 'mm.sent', {}, all => {
    delete all[projectId]
    all[projectId] = sent
    capped(all)
  })
}

/** The person made or used this link (Update, /mm link): its thread stays pinned for a day, and a pin they took off it comes back. */
async function stamp($: EngineInterface, projectId: string, sid: string): Promise<void> {
  const now = await $.clock.now()
  await patchStore<Acted>($, 'mm.acted', {}, acted => {
    for (const [pid, a] of Object.entries(acted)) if (!a || now - a.at >= ACTED_MS) delete acted[pid]
    acted[projectId] = { sid, at: now }
  })
  await pinAgain($, sid)
}

/** The person acted on this thread's client (Update, Start, /mm link): the pin they took off it may come back. */
async function pinAgain($: EngineInterface, sid: string | undefined): Promise<void> {
  if (!sid) return
  await patchStore<Record<string, Unpinned>>($, 'mm.unpinned', {}, unpinned => {
    if (!(sid in unpinned)) return false
    delete unpinned[sid]
  })
}

/**
 * The link is the person's from here on (Update, /mm link, /mm view, a chip they started), no longer one
 * the bridge made by itself: its thread may show the drafts pane, and the link is not undone by a sync.
 */
async function claim($: EngineInterface, projectId: string | undefined, sid: string): Promise<void> {
  await patchStore<Auto>($, 'mm.auto', {}, auto => {
    let changed = false
    for (const [pid, a] of Object.entries(auto)) {
      if (pid !== projectId && a?.sid !== sid) continue
      delete auto[pid]
      changed = true
    }
    return changed
  })
}

/**
 * One pass over a feed: threads link themselves, the linked clients' threads are pinned and named up to
 * the cap (a thread the person acted on in the last day first, and never dropped by the cap), the rest
 * are let go, and every client gets its recommendation. `known` carries the pairs of an earlier pass of
 * the same feed: the app's records are looked at once, and a link's misses are counted once, per feed.
 * ⛔ Sends nothing and starts nothing.
 */
async function reconcile($: EngineInterface, feed: Feed, known?: Pairs): Promise<Pass> {
  const now = await $.clock.now()
  // Three lists, a client in exactly one. Only `items` pins and is counted. The other two are listed
  // under the list, closed: clients whose reply drafts a teammate holds, and clients whose only items are
  // more than 3 business days overdue (nothing drops off silently).
  const lists = buildLists(feed, now)
  const items = lists.queue
  const quiet = [...lists.teammate, ...lists.older]
  /** (R8) Clients whose package waits for the server's check of our newer send: in no list, their threads named for it and not pinned. */
  const checking = lists.checking
  /** The other lists as the sync record keeps them: only when somebody is in them. */
  const also = {
    ...(lists.teammate.length ? { teammate: lists.teammate } : {}),
    ...(lists.older.length ? { older: lists.older } : {}),
    ...(checking.length ? { checking } : {}),
  }
  const member = memberText(feed.member)
  const projects = feedProjects(feed)
  const listed = await sessions($)
  const live = new Map((listed?.threads ?? []).map(s => [s.sessionId, s] as const))
  const feedThreads = feedThreadsOf(feed)
  const before = await storeGet<Last | null>($, 'mm.last', null)
  /** The recommendation the last sync gave a client, in its words and without its thread: for a client whose thread cannot be seen now. */
  const carried = (it: QueueItem): Recommendation => {
    // (a sync by an older version stored the state under `action`)
    const was = before?.recs?.[it.projectId] as (Partial<Recommendation> & { action?: unknown }) | undefined
    const state = was?.state ?? was?.action
    const known = state === 'update' || state === 'start' || state === 'current'
    if (!was || !known || typeof was.reason !== 'string') return recommend([], undefined, now)
    // whether the client has no thread at all is carried too: a thread that cannot be seen now is still a thread
    const fresh = was.state !== undefined ? was.fresh === true : state === 'start' && !was.target
    return { state: state as RowState, reason: was.reason, ...(fresh ? { fresh: true as const } : {}) }
  }

  // No thread list here (a terminal session, or an answer from the app that is not a list of threads): the
  // list of clients is shown, each with the recommendation the last sync in the app gave it, and nothing
  // about threads is touched. Links, pins, unlink records and stored titles stay exactly as they are.
  // ⛔ No recommendation carries a thread: with no list there is nothing for Update to act on.
  if (listed === null) {
    const recs: Record<string, Recommendation> = {}
    for (const it of [...items, ...quiet, ...checking]) recs[it.projectId] = carried(it)
    const last: Last = { at: now, member, items, ...also, pinned: before?.pinned ?? 0, recs, projects }
    await storeLast($, feed, last)
    const rowsOf = (list: readonly QueueItem[], needsYou = false): Row[] => list.map(it => rowFor(it, recs[it.projectId] as Recommendation, now, { needsYou }))
    await showQueue($, member, items, rowsOf(items, true), last.pinned, now, { teammate: rowsOf(lists.teammate), older: rowsOf(lists.older), checking: rowsOf(checking) })
    return { last, live, pairs: known ?? {}, listed: false, unseen: new Set() }
  }

  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
  /** (R18) The internal projects, and whether a pin record is on one: the bridge never unpins such a thread. */
  const internal = internalProjects(feed)
  const internalPin = (pin: Pin | undefined): boolean => Boolean(pin && (pin.internal === true || internal.has(pin.projectId)))
  /** (R18; fix round 1, L8) What an unpin becomes on an internal project's thread: only a pin the bridge put there comes off. */
  const unpinFor = (it: QueueItem, unpin: 'ours' | 'any'): 'ours' | 'any' | false => (it.internal || internal.has(it.projectId) ? 'ours' : unpin)
  /** A pin record for a client: (R18) marked when the client is internal. */
  const pinOf = (it: QueueItem, byUs: boolean): Pin => ({ projectId: it.projectId, client: it.client, byUs, ...(it.internal || internal.has(it.projectId) ? { internal: true as const } : {}) })
  const unlinked = await storeGet<Record<string, number>>($, 'mm.unlinked', {})
  const titles = await storeGet<Record<string, string>>($, 'mm.titles', {})
  const acted = await storeGet<Acted>($, 'mm.acted', {})
  const auto = await storeGet<Auto>($, 'mm.auto', {})
  const sent = await storeGet<Record<string, Sent>>($, 'mm.sent', {})
  const released = await storeGet<string[]>($, 'mm.released', [])
  const unpinned = await storeGet<Record<string, Unpinned>>($, 'mm.unpinned', {})
  /** (0.5.3) The linked threads whose client's clear this bridge has already acted on, with when: unpinned once per clear. */
  const cleared = await storeGet<Record<string, number>>($, 'mm.cleared', {})
  /** The client each thread's [mm-link] marker named: never a thread the bridge links to another by itself. */
  const marked = await storeGet<Record<string, string>>($, 'mm.marked', {})
  /** (0.5.10) When each thread's marker was recorded, where it is known: R1b's dated evidence. */
  const markedAt = await storeGet<Record<string, number>>($, 'mm.markedAt', {})
  /**
   * The shared maps as this pass read them. ⛔ The pass never writes one of them back whole: at its end each
   * gets only what the pass itself changed, over a fresh copy (`applyChanges`). Its app calls take seconds,
   * and a thread started meanwhile writes its own link into the same map (B1).
   */
  const was = { links: copyOf(links), pins: copyOf(pins), titles: copyOf(titles), auto: copyOf(auto), unpinned: copyOf(unpinned), cleared: copyOf(cleared), released: Array.isArray(released) ? [...released] : [] }

  // ⛔ A thread missing from the app's list is not a thread that is gone: the list holds the 60 most
  // recent. Each linked or pinned thread the list left out is asked for by id. One the app shows open is a
  // thread like any other. One the app says does not exist, or shows archived, is `gone`. Anything else (an
  // error, no answer, more of them than one sync asks for) is `unseen`: its link, pin record and title are
  // kept exactly as they are, and nothing is done to it.
  // ⛔ And an empty list never drops anything at all, whatever a lookup says.
  const gone = new Set<string>()
  const unseen = new Set<string>()
  const missing = [...new Set([...Object.values(links), ...Object.keys(pins), ...released])].filter(sid => !live.has(sid))
  for (const [n, sid] of missing.entries()) {
    const found = n < LOOKUPS_PER_SYNC ? await lookup($, sid) : 'unknown'
    if (found === 'unknown') unseen.add(sid)
    else if (found !== 'gone') live.set(sid, found)
    else if (listed.complete) gone.add(sid)
    else unseen.add(sid)
  }
  const pairs = known ?? (await allPairs($, now, live, feedThreads))

  // A link to a thread that is gone, or that the person unlinked (a sync in another thread may have written
  // an older copy of the links back after the unlink), is dropped.
  for (const [pid, sid] of Object.entries(links)) if (gone.has(sid) || sid in unlinked) delete links[pid]
  // ⛔ A thread is one client's. Where two clients are linked to one thread (an older version allowed it),
  // the client it is pinned for keeps it, else the first; the other link is dropped.
  const owners = new Map<string, string>()
  for (const [pid, sid] of Object.entries(links)) if (!owners.has(sid) || pins[sid]?.projectId === pid) owners.set(sid, pid)
  for (const [pid, sid] of Object.entries(links)) if (owners.get(sid) !== pid) delete links[pid]

  // A link the bridge made by itself stops being one when the link is gone or the person acted on it.
  // (An entry of any other shape is dropped with them.)
  for (const [pid, a] of Object.entries(auto)) if (!a || typeof a.sid !== 'string' || links[pid] !== a.sid || acted[pid]?.sid === a.sid) delete auto[pid]
  // ⛔ And it is undone when it stops being true. At once, on this sync (B3, 2026-10-13), when it no longer
  // qualifies: the feed's rows for its thread's sessions name another client (alone, or beside this one;
  // the internal-ops project counts like any other), OW marks such a row `sole: false` (the session declared
  // another project the feed does not list), or the thread opened with an [mm-link] marker for another
  // client. More quietly, when the feed stops listing its thread's sessions at all, AUTO_MISSES
  // syncs in a row: those misses are counted once per feed, and only when the feed's list has entries (a
  // feed with no `threads`, or an empty one, says nothing either way and changes no count), and a miss
  // counts only when the one before it is MISS_GAP_MS old (three /mm in a row are one sync). A thread that
  // cannot be seen is left as it is. A link the person made is not in `auto`, and is never undone here.
  const undone: string[] = []
  /** (0.5.10) The bridge links this pass let go here: checked again on the store before the links are written. */
  const drops: Array<{ pid: string; sid: string }> = []
  if (!known) {
    for (const [pid, a] of Object.entries(auto)) {
      if (unseen.has(a.sid)) continue
      // When the link was made: a record an older version made is dated the first time this version sees it.
      if (typeof a.made !== 'number' || !Number.isFinite(a.made)) a.made = now
      // ⛔ R11 (final round, 10-14): a send is never evidence here. A link the bridge made becomes the person's
      // only through a closing route that succeeded in its own thread (`claimUsed`) or the person's own act (a
      // press, a typed /mm command, an [mm-link] marker); either one takes it out of `auto` before this loop.
      const fate = autoLinkFate(pid, a.sid, feedThreads, pairs, marked)
      if (fate === 'stays') {
        a.miss = 0
        delete a.at
        continue
      }
      if (fate === 'unlisted') {
        if (!feedThreads.length) continue
        if (typeof a.at === 'number' && now - a.at < MISS_GAP_MS) continue
        a.miss = (Number(a.miss) || 0) + 1
        a.at = now
        if (a.miss < AUTO_MISSES) continue
      }
      delete auto[pid]
      delete links[pid]
      undone.push(a.sid)
      drops.push({ pid, sid: a.sid })
    }
  }

  // R1b (0.5.9, Rob 2026-10-15: "Can we have it update to attach to the most recent thread for each client?"). At
  // 10:28 ET he switched profiles: this profile's sync dropped the other profile's links, R1 linked five clients to
  // their newest thread HERE (last active 10-08 to 10-12) and pinned them, and the threads he started for them
  // minutes later stayed unlinked. A link the bridge made by itself now follows the client's newest thread: one that
  // opened with this client's marker, or whose sessions declared this client alone (`newerThreadFor`), started
  // LATER than the linked one. The old thread is given back as an undone link is (its own name, our pin off, a pin
  // the person put on left alone); the pin lands on the new one in the pass below.
  // ⛔ Only a link in `auto`: one the person made, or that a closing route or their own act took out of `auto`,
  //    never moves this way. ⛔ Once per feed, as the undo above (`known`), never on an empty list (not
  //    `complete`), never on a feed that lists no sessions at all (L3), and never from or to a thread that cannot
  //    be seen. ⛔ A thread is one client's: a thread linked to any client, this pass's moves included, is never
  //    taken. ⛔ Checked again on the store just before the links are written (`moves`, M2).
  /** (0.5.9) The links R1b moved in this pass: client, the thread it had, the thread it moved to. */
  const moves: Array<{ pid: string; from: string; to: string }> = []
  if (!known && listed.complete && feedThreads.length > 0) {
    const shared = sharedThreads(feedThreads, pairs)
    const left = Array.isArray(released) ? released : []
    for (const [pid, a] of Object.entries(auto)) {
      if (!a || typeof a.sid !== 'string' || links[pid] !== a.sid || unseen.has(a.sid) || !live.has(a.sid)) continue
      const sid = newerThreadFor(pid, a.sid, links, feedThreads, pairs, live, { unlinked, released: left, marked, markedAt, shared })
      if (!sid || unseen.has(sid)) continue
      links[pid] = sid
      auto[pid] = { sid, miss: 0, made: now }
      undone.push(a.sid)
      moves.push({ pid, from: a.sid, to: sid })
    }
  }

  // R1: a client with no thread takes the most recently active thread whose sessions declared it and no
  // other client, and that did not open with a marker for another (autoLinkFor).
  for (const it of items) {
    const sid = autoLinkFor(it.projectId, links, feedThreads, pairs, live, unlinked, marked)
    if (!sid) continue
    links[it.projectId] = sid
    auto[it.projectId] = { sid, miss: 0, made: now }
  }

  // The threads that should be pinned now. R1 (0.5.2, Rob 2026-10-13: "Pinned is something the server
  // recognized needs to be done within the next 24 hours, whether it's a reply or work that must be started
  // within 24 hours to finish by an ETA. Once that's clear, it moves to un-pinned"): the linked thread of every
  // client on the list whose act-by time is past or within the next 24 business hours (`pinsNow`). No cap: a
  // pin means "needs you". A client further out is on the list, its thread named and not pinned.
  // ⛔ A pin the person took off stays off (Rob, 2026-10-12: a hand unpin lasted five minutes and he asked why
  // it came back). "We pinned this thread, and it is not pinned now though we did not unpin it" is the
  // person's doing: whenever the bridge unpins a thread itself, it drops or disowns the pin record first.
  // It is remembered with the newest time of each kind of thing the client had then, and the thread is not
  // pinned again until one of them is newer, or the person presses Update or Start for the client or types
  // /mm link there (`pinAgain`), or pins it again themselves. Its name is kept up to date all the while.
  const newestOf = (it: QueueItem): Omit<Unpinned, 'at'> => ({ mail: Number(it.newest?.mail) || 0, pkg: Number(it.newest?.pkg) || 0, task: Number(it.newest?.task) || 0 })
  for (const sid of Object.keys(unpinned)) if (gone.has(sid)) delete unpinned[sid]
  for (const it of items) {
    const sid = links[it.projectId]
    const s = sid ? live.get(sid) : undefined
    if (!sid || !s) continue
    if (s.pinned) {
      delete unpinned[sid] // pinned again, by the person
      continue
    }
    const pin = pins[sid]
    if (pin?.byUs && pin.projectId === it.projectId && !(sid in unpinned)) unpinned[sid] = { at: now, ...newestOf(it) }
  }
  /** Whether the person's unpin of this thread still stands: nothing new for its client since. */
  const staysOff = (sid: string, it: QueueItem): boolean => {
    const u = unpinned[sid]
    if (!u) return false
    const n = newestOf(it)
    if (n.mail <= (Number(u.mail) || 0) && n.pkg <= (Number(u.pkg) || 0) && n.task <= (Number(u.task) || 0)) return true
    delete unpinned[sid]
    return false
  }

  // (A linked thread that cannot be seen takes no place: nothing can be done to it in this sync.)
  const want = new Map<string, QueueItem>()
  // Threads that are named and not pinned, each with its name: one whose pin the person took off, the thread
  // of a client further out than the pin's window, the thread of a client in one of the two closed groups, and
  // (R8) the thread of a client whose newer send the server is checking. `unpin`: `ours`, the bridge takes its
  // own pin off it (never the person's); `any`, whoever pinned it (R8, R14: it is off the person's plate);
  // false, it is left as it is.
  const named = new Map<string, { it: QueueItem; unpin: 'ours' | 'any' | false; title: string }>()
  for (const it of checking) {
    const sid = links[it.projectId]
    const fast = fastState(it, now)
    if (sid && live.has(sid) && !named.has(sid) && fast) named.set(sid, { it, unpin: unpinFor(it, 'any'), title: checkingTitle(it.client, fast.at, now) })
  }
  for (const it of items) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !named.has(sid) && staysOff(sid, it)) named.set(sid, { it, unpin: false, title: threadTitle(it, now) })
  }
  for (const it of quiet) {
    const sid = links[it.projectId]
    if (sid && live.has(sid) && !named.has(sid)) named.set(sid, { it, unpin: unpinFor(it, 'ours'), title: titleFor(it, now) })
  }
  for (const it of items) {
    const sid = links[it.projectId]
    if (!sid || !live.has(sid) || want.has(sid) || named.has(sid)) continue
    if (pinsNow(it, now)) want.set(sid, it)
    else named.set(sid, { it, unpin: unpinFor(it, 'ours'), title: threadTitle(it, now) })
  }

  let writes = 0
  const rename = async (s: AppThread, title: string): Promise<void> => {
    // The thread's own name is kept from before the first time we rename it, so /mm unlink can give it back.
    // ⛔ Stored BEFORE the app is asked to rename (review of 79cbc596, F2): a pass that fails after the rename
    // still leaves the name to give back. (A name another session stored first for the thread is kept.)
    const sid = s.sessionId
    const own = s.title
    if (titles[sid] === undefined && own && !isOurTitle(own)) {
      await patchStore<Record<string, string>>($, 'mm.titles', {}, fresh => {
        if (fresh[sid] !== undefined) return false
        fresh[sid] = own
      })
      titles[sid] = own
      was.titles[sid] = own
    }
    await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title })
    s.title = title
    writes++
  }
  /**
   * A pin record stored at once, BEFORE the app is asked to rename or pin the thread it is about (F2): a
   * pass that fails after those calls leaves the record, so a later sync takes our pin off and gives the
   * name back. Nothing is written when the store already has this record.
   */
  const recordPin = async (sid: string, record: Pin): Promise<void> => {
    if (sameValue(pins[sid], record)) return
    await patchStore<Record<string, Pin>>($, 'mm.pins', {}, fresh => {
      fresh[sid] = record
    })
    pins[sid] = record
    was.pins[sid] = copyOf(record)
  }

  // A thread its client has left for a new one started from the bridge's chip (linkFromMarker put it on
  // this list). It is given back like an undone link. One that cannot be seen now waits for a later sync;
  // one that is linked again since is a client's thread, not one to give back.
  const waiting: string[] = []
  for (const sid of released) {
    if (ownerOf(sid, links) !== undefined) continue
    if (gone.has(sid)) {
      delete titles[sid]
      delete pins[sid]
    } else if (live.has(sid)) undone.push(sid)
    else waiting.push(sid)
  }

  // A link that was undone: its thread is unpinned if we pinned it and gets its own name back. No unlink
  // record: it may link itself again if the feed lists it again. (Skipped where the same pass linked the
  // thread to another client: the loop below renames it for that client.)
  for (const sid of undone) {
    if (want.has(sid) || named.has(sid)) continue
    const s = live.get(sid)
    if (s && pins[sid]?.byUs && s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
      s.pinned = false
      writes++
    }
    const own = titles[sid]
    if (s && own !== undefined && s.title !== own) {
      await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title: own })
      s.title = own
      writes++
    }
    delete titles[sid]
    delete pins[sid]
  }

  for (const [sid, it] of want) {
    const s = live.get(sid)
    if (!s || writes >= MAX_WRITES) continue
    // The record first, as the thread stands (a pin the person put on stays theirs), so a failed rename
    // leaves a record to give the name back by; then, just before we pin it, the record that the pin is
    // ours. (Recorded as ours any earlier, a rename that failed would read later as the person's unpin.)
    const record = (byUs: boolean): Pin => pinOf(it, byUs)
    await recordPin(sid, record(s.pinned ? (pins[sid]?.byUs ?? false) : false))
    const title = threadTitle(it, now)
    if (s.title !== title) await rename(s, title)
    if (!s.pinned) {
      await recordPin(sid, record(true))
      try {
        await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: true })
      } catch (err) {
        // ⛔ The app refused the pin: our record goes back to not ours, so the next sync pins it again
        // instead of reading a pin that never was as one the person took off (L3).
        await recordPin(sid, record(false)).catch(() => {})
        throw err
      }
      s.pinned = true
      writes++
    }
  }

  // Named, never pinned: the thread whose pin the person took off, the thread of a client whose drafts a
  // teammate holds (its name says who, where the clock would be), the thread of a client whose only items
  // are older than the window. The bridge takes its OWN pin off the last two, never the person's. The
  // record is kept, as not ours: it is what gives the thread its tick once nothing is left for its client.
  for (const [sid, n] of named) {
    const s = live.get(sid)
    if (!s || writes >= MAX_WRITES) continue
    if (((n.unpin === 'ours' && pins[sid]?.byUs) || n.unpin === 'any') && s.pinned) {
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
      s.pinned = false
      writes++
    }
    if (s.title !== n.title) await rename(s, n.title)
    pins[sid] = pinOf(n.it, false)
  }

  // A thread we were tracking that no longer needs the person: unpinned, and its name says so.
  // R7 + R14 (Rob, 2026-10-13: "Even if I manually pinned something, it should still unpin when it's cleared"):
  // a client in none of the lists is clear, by any path the feed knows (no reply owed, a manual package, a
  // reply sent later by hand, a closed package): its linked thread is unpinned WHOEVER pinned it, and named
  // `✓ <client> · clear <time>`. A thread that is no longer the client's keeps the person's own pin (only ours
  // comes off it), as before.
  // ⛔ The record of a thread that cannot be seen is kept: it is what lets a later sync take the pin off. So is
  // the record of a thread this sync had no writes left for: the next sync finishes it (0.5.1 dropped it, and
  // the thread kept its pin and its old name for good).
  for (const [sid, pin] of Object.entries(pins)) {
    if (want.has(sid) || named.has(sid)) continue
    const s = live.get(sid)
    if (!s) {
      if (gone.has(sid)) delete pins[sid]
      continue
    }
    if (writes >= MAX_WRITES) continue
    {
      const stillTheirs = ownerOf(sid, links) === pin.projectId
      // ⛔ The tick is for a client with nothing left in play for the person: in none of the lists.
      const still = [...items, ...quiet, ...checking].find(i => i.projectId === pin.projectId)
      const clear = stillTheirs && !still
      // R18 (Rob, 2026-10-13: "I still keep it pinned, though"): the person's pin on an internal project's thread
      // stays (fix round 1, L8: the bridge takes off only a pin it put there), and once its item clears the
      // thread gets its own name back, not a tick
      const inside = internalPin(pin)
      if ((pin.byUs || (clear && !inside)) && s.pinned) {
        await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
        s.pinned = false
        writes++
      }
      // (0.5.3) this clear is acted on: the sweep below leaves the thread alone until its client clears again.
      // (An internal project's too: its pin record, the one thing that says so once nothing of it is left in
      // the feed, goes below, and its thread is never the sweep's.)
      if (clear) cleared[sid] = now
      if (!stillTheirs || (inside && clear)) {
        // ⛔ The thread is no longer this client's (the client was moved to another thread, or its link went
        // some other way): its own name back, as an undone link gets it, never the name of a client it no
        // longer has (review of 79cbc596, F4: the thread a client was moved from kept that client's name).
        const own = titles[sid]
        if (own !== undefined && s.title !== own) {
          await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: sid, title: own })
          s.title = own
          writes++
        }
        delete titles[sid]
      } else {
        // the name in a pin record may be one an older version stored as the feed wrote it
        const title = still ? titleFor(still, now) : clearedTitle(cleanName(pin.client), now)
        if (s.title !== title) await rename(s, title)
      }
    }
    delete pins[sid]
  }

  // The clear sweep (0.5.3, Opus 10-14: two threads cleared under 0.5.1 stayed pinned with no pin record left,
  // and R14 acts only on a clear it sees through one). On every sync, a linked thread whose client is in none
  // of the lists (nothing waiting for this member: not on the Needs-you list, not a teammate's, not Older,
  // not being checked), that the app shows pinned and that is not an internal project's (R18), is unpinned
  // ONCE per clear. The clear is recorded (`mm.cleared`) the first time a sync sees it, pinned or not, and the
  // thread is not unpinned again until its client has something waiting again (the record goes) and clears
  // again: a thread the person pins again after its client cleared stays pinned. Its name is left as it is.
  // ⛔ A thread that cannot be seen waits for a later sync, and so does one this sync had no writes left for.
  const inPlay = new Set([...items, ...quiet, ...checking].map(i => i.projectId))
  for (const [pid, sid] of Object.entries(links)) {
    if (inPlay.has(pid)) {
      delete cleared[sid]
      continue
    }
    if (sid in cleared) continue
    const s = live.get(sid)
    // (an internal project with nothing waiting has no feed row to flag it: the known ids, and its pin record, say so)
    if (!s || internal.has(pid) || INTERNAL_PROJECTS.has(pid) || internalPin(was.pins[sid])) continue
    if (s.pinned) {
      if (writes >= MAX_WRITES) continue
      await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: sid, pinned: false })
      s.pinned = false
      writes++
    }
    cleared[sid] = now
  }
  // a record whose thread is no client's any more goes with its link
  for (const sid of Object.keys(cleared)) if (ownerOf(sid, links) === undefined) delete cleared[sid]

  // A client that is to get a new thread and has a live chip: its row says where the chip is. A chip shows
  // only in the thread that minted it, so "here" is this thread's word: it goes on this session's rows,
  // not into the recommendation that is stored for every session.
  const chips = await chipsOf($, now)
  const me = await selfId($)
  const chipLine = (it: QueueItem, rec: Recommendation): Recommendation => {
    const chip = rec.state === 'start' ? liveChip(chips, it.projectId) : undefined
    if (!chip) return rec
    if (chip.threadId === me) return { ...rec, reason: 'the chip is ready here' }
    // (0.5.6, Rob 10-14: "Start in the thread that I click it on") Start here moves it: the row says so
    const holder = live.get(chip.threadId)
    const where = holder ? cleanTitle(holder.title) : chip.place
    return where ? { ...rec, reason: `its chip is in "${where}"; Start thread moves it here` } : rec
  }

  // R2: each client's recommendation. A title that merely looks like the client is offered only when the
  // client has no known thread at all. ⛔ Never a thread linked to another client, and never one whose
  // sessions also declared another project, or that opened with a marker for another client: a thread the
  // B3 rule let go is not offered for Update either (clientThreads, titleSuggestion).
  const recs: Record<string, Recommendation> = {}
  const rowOf = (it: QueueItem, needsYou = false): Row => {
    const linked = links[it.projectId]
    const threads = clientThreads(it.projectId, links, feedThreads, pairs, live, marked)
    const elsewhere = (sid: string) => declaredOther(it.projectId, sid, feedThreads, pairs, marked)
    const had = sent[it.projectId]
    // A client whose linked thread cannot be seen keeps the last recommendation's words, and no thread to act on.
    // Otherwise ONE of three: Start (no thread, or the thread is old), Update (the thread has not been given
    // what is waiting now), or current (it has: what Update last put there is what would go now). (0.5.11, Rob
    // 10-15) A long thread is not one to replace: Claude Code compacts it.
    const rec =
      linked && unseen.has(linked)
        ? carried(it)
        : recommend(threads, threads.length ? undefined : titleSuggestion(it.client, links, live, elsewhere), now, {
            sent: had,
            // (a package the person holds, in the thread that was given it, is not new for that thread: hasWaiting)
            signature: had && hasWaiting(had.sig, it) ? had.sig : signatureOf(it),
          })
    recs[it.projectId] = rec
    return rowFor(it, chipLine(it, rec), now, { needsYou })
  }
  const rows = items.map(it => rowOf(it, true))
  // (R8, Opus decision 2) a client being checked is under `Checking your reply`, with a recommendation on record
  const folds = { teammate: lists.teammate.map(it => rowOf(it)), older: lists.older.map(it => rowOf(it)), checking: checking.map(it => rowOf(it)) }

  await patchStore<string[]>($, 'mm.released', [], fresh => applyListChanges(fresh, was.released, waiting))

  const last: Last = { at: now, member, items, ...also, pinned: want.size, recs, projects }
  // ⛔ What this pass changed, and nothing else: a link, a pin, a name or a record another session wrote
  // while it ran is the store's, and stays. (A map the store does not hold yet is written, empty or not, as
  // a sync always left these five.)
  /** Its changes to a capped map, the oldest entries past the cap trimmed after. */
  const keepNewest = <V,>(fresh: Record<string, V>, before: Record<string, V>, after: Record<string, V>): boolean => {
    const changed = applyChanges(fresh, before, after)
    const had = Object.keys(fresh).length
    return Object.keys(capped(fresh)).length !== had || changed
  }
  // ⛔ In this order (review of 79cbc596, F2), so that a write the engine refuses midway leaves nothing half
  // done: what makes a link the bridge's own (its auto record) and the names to give back are written
  // BEFORE the links, and taken away only AFTER them. A link the bridge made never stands without its auto
  // record, so it can always be let go; one it lets go keeps its record until the link itself is gone.
  // ⛔ (0.5.9, review of 54a0437d) The links this pass made by itself (R1, R1b) are checked again on the store first,
  // and one is dropped, link and auto record both, so the store keeps what was written while this pass waited on the
  // app: (L2) another client holds its thread now (one thread, one client); (M2) an R1b move whose client the person
  // acted on meanwhile (a /mm link, a press, a claim: the auto record no longer names the thread it had, or their
  // act names that thread). (The pins and names it touched are put right by the next sync.)
  // ⛔ (0.5.10, review of 0.5.9, finding 1) The same for a bridge link this pass let go (B3's "goes", the third miss):
  // one whose client the person acted on while this pass waited on the app (the auto record no longer names its
  // thread, or their act names it) is not let go here; the store keeps what they wrote. Checked first, so a link R1
  // made in its place this pass goes with it.
  if (drops.length) {
    const freshAuto = await storeGet<Auto>($, 'mm.auto', {})
    const freshActed = await storeGet<Acted>($, 'mm.acted', {})
    for (const d of drops) {
      if (freshAuto[d.pid]?.sid === d.sid && freshActed[d.pid]?.sid !== d.sid) continue
      links[d.pid] = d.sid
      const before = was.auto[d.pid]
      if (before) auto[d.pid] = copyOf(before)
      else delete auto[d.pid]
    }
  }
  const made = Object.keys(links).filter(pid => links[pid] !== was.links[pid])
  if (made.length) {
    const freshLinks = await storeGet<Record<string, string>>($, 'mm.links', {})
    const freshAuto = await storeGet<Auto>($, 'mm.auto', {})
    const freshActed = await storeGet<Acted>($, 'mm.acted', {})
    /** Whether the store has `other` on this thread now (not merely as this pass read it, when the pass takes it off). */
    const holds = (other: string, sid: string): boolean => freshLinks[other] === sid && !(was.links[other] === sid && links[other] !== sid)
    for (const pid of made) {
      const sid = links[pid] as string
      const m = moves.find(x => x.pid === pid)
      const taken = Object.keys(freshLinks).some(other => other !== pid && holds(other, sid))
      const acted = m !== undefined && (freshAuto[pid]?.sid !== m.from || freshActed[pid]?.sid === m.from)
      if (!taken && !acted) continue
      if (was.links[pid] === undefined) delete links[pid]
      else links[pid] = was.links[pid] as string
      const before = was.auto[pid]
      if (before) auto[pid] = copyOf(before)
      else delete auto[pid]
    }
  }
  // (0.5.11, review of PR #15, F6) No context reading is kept or taken any more: Claude Code compacts a long thread,
  // and nothing reads one. (`mm.ctx`, which an older version wrote, is left as it is.)
  await patchStore<Auto>($, 'mm.auto', {}, (fresh, stored) => applyChanges(fresh, was.auto, auto, 'set') || !stored)
  await patchStore<Record<string, string>>($, 'mm.titles', {}, fresh => applyChanges(fresh, was.titles, titles, 'set'))
  await patchStore<Record<string, string>>($, 'mm.links', {}, (fresh, stored) => applyLinkChanges(fresh, was.links, links) || !stored)
  // ⛔ The person's unpins BEFORE the pin records (F7): the pass that sees a pin taken off by hand both
  // records it and turns our pin record into not ours. Written the other way round, a refused second write
  // left neither, and the next sync pinned the thread again.
  await patchStore<Record<string, Unpinned>>($, 'mm.unpinned', {}, (fresh, stored) => keepNewest(fresh, was.unpinned, unpinned) || !stored)
  await patchStore<Record<string, Pin>>($, 'mm.pins', {}, (fresh, stored) => applyChanges(fresh, was.pins, pins) || !stored)
  await patchStore<Record<string, number>>($, 'mm.cleared', {}, fresh => applyChanges(fresh, was.cleared, cleared))
  await patchStore<Auto>($, 'mm.auto', {}, fresh => applyChanges(fresh, was.auto, auto, 'delete'))
  await patchStore<Record<string, string>>($, 'mm.titles', {}, (fresh, stored) => keepNewest(fresh, was.titles, titles) || !stored)
  await storeLast($, feed, last)
  await showQueue($, member, items, rows, want.size, now, folds)
  return { last, live, pairs, listed: true, unseen }
}

/** The sync record a pass made, stored; and, when the pass was over the feed this session read last, kept with it (recentFeed). */

async function storeLast($: EngineInterface, feed: Feed, last: Last): Promise<void> {
  await $.store.set('mm.last', last)
  if (recent?.feed === feed) recent.wrote = JSON.stringify(last)
}

/**
 * Puts the list in the Needs-you pane and on the status line. `folds` are the two closed groups under it:
 * neither is counted. `syncedAt` is when the list was worked out: the list drawn from a stored sync says that
 * sync's time, not the time it was drawn.
 */
async function showQueue($: EngineInterface, member: string, items: QueueItem[], rows: Row[], pinned: number, now: number, folds: { teammate: Row[]; older: Row[]; checking?: Row[] }, syncedAt = now): Promise<void> {
  const queue: MmQueue = {
    // (R1: no cap on pins any more; the header counts the list)
    header: items.length ? `Needs you now (${items.length})` : 'Nothing needs you right now.',
    rows,
    note: `Updated ${new Date(syncedAt).toISOString().slice(11, 16)} UTC for ${member}. ${PANE_SENTENCE}`,
    syncedAt,
    ...(folds.teammate.length ? { teammate: folds.teammate } : {}),
    ...(folds.older.length ? { older: folds.older } : {}),
    ...(folds.checking?.length ? { checking: folds.checking } : {}),
  }
  await $.state.set(QUEUE, queue)
  const { value: notice } = await $.state.get(NOTICE)
  if (notice?.text && now - notice.at > SYNC_MS) await $.state.set(NOTICE, { text: '', at: now })
  $.ui.status(items.length ? `MM: ${items.length} need you · ${pinned} pinned` : 'MM: clear')
}

async function sync($: EngineInterface): Promise<Last> {
  return (await reconcile($, await fetchFeed($))).last
}

/** A press's refresh (S2): the list brought up to date after the press drew its answer, with a feed OW gave this session less than a minute ago when there is one. */
async function refreshList($: EngineInterface): Promise<Pass> {
  return reconcile($, await recentFeed($))
}

/**
 * The refresh after a press failed (L3): the pane says so in one line, under the list it still shows. The list
 * is the one last drawn; the line goes with the next list drawn from a sync that worked (`showQueue`), or, in a
 * thread that does not sync, once the store holds a sync newer than the failure (`clearRefreshFailed`).
 */
async function refreshFailed($: EngineInterface, err: unknown = 'no reason given'): Promise<void> {
  try {
    const { value: queue } = await $.state.get(QUEUE)
    if (queue && Array.isArray(queue.rows)) await $.state.set(QUEUE, { ...queue, warning: REFRESH_FAILED, warnedAt: await $.clock.now() } satisfies MmQueue)
  } catch {
    // the line is a convenience: its failure breaks nothing
  }
  // (0.5.4) why, by which session and thread, and when: kept in the store, so every session's heartbeat file
  // (bridge-state.json, which the session that wrote last owns) shows the last one
  try {
    const record = { session: await instanceId($), thread: await knownSelf($), at: new Date(await $.clock.now()).toISOString(), reason: errorText(err) }
    await $.store.set('mm.refreshError', record)
    await beat($, { ok: false })
  } catch {
    // as above
  }
  await refreshBand($)
}

/**
 * (0.5.4; Rob's screenshot, 10-14 10:27 ET: a thread that does not poll kept `Couldn't refresh the list` above a
 * sync the poller had written a minute before) A thread whose band, or whose list, was drawn from an older sync
 * than the store holds draws them again from it: on every tick and every chips pass, before anything that waits on
 * the app. A refresh-failed line older than that sync goes with it; one from this thread's own refresh that failed
 * after it stays. No feed call and no app call.
 */
async function catchUp($: EngineInterface): Promise<void> {
  try {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    if (!last || !Number.isFinite(last.at)) return
    const { value: queue } = await $.state.get(QUEUE)
    const { value: band } = await $.state.get(BAND)
    const listBehind = Boolean(
      queue && Array.isArray(queue.rows) && Array.isArray(last.items) && (queue.warning ? last.at > (queue.warnedAt ?? Infinity) : !(Number(queue.syncedAt) >= last.at)),
    )
    if (listBehind) await drawStored($, last, await $.clock.now())
    if (listBehind || !(Number(band?.at) >= last.at)) await refreshBand($)
  } catch {
    // the next tick, or the next pass, tries again
  }
}

/**
 * The line a failed refresh left, taken off once the store holds a sync newer than it (any session's). R13
 * (0.5.2): the list is drawn again from that sync at the same time, so the line never goes while the pane still
 * shows the list it was about (a thread that does not poll draws only what it synced itself).
 */
async function clearRefreshFailed($: EngineInterface): Promise<void> {
  try {
    const { value: queue } = await $.state.get(QUEUE)
    if (!queue?.warning) return
    const last = await storeGet<Last | null>($, 'mm.last', null)
    if (!last || !(last.at > (queue.warnedAt ?? Infinity))) return
    if (Array.isArray(last.items)) {
      await drawStored($, last, await $.clock.now())
      return
    }
    const { warning: _warning, warnedAt: _warnedAt, ...clear } = queue
    await $.state.set(QUEUE, clear)
  } catch {
    // as above
  }
}

/**
 * A client's recommendation as the last sync stored it, with the thread it named: what a press acts on (S2).
 * Undefined when there is none, or it has a shape no version wrote. (A sync by an older version stored the
 * state under `action`.)
 */
function storedRec(last: Last | null, projectId: string): Recommendation | undefined {
  const was = last?.recs?.[projectId] as (Partial<Recommendation> & { action?: unknown }) | undefined
  const state = was?.state ?? was?.action
  if (!was || (state !== 'update' && state !== 'start' && state !== 'current') || typeof was.reason !== 'string') return undefined
  const t = was.target as { sid?: unknown; title?: unknown; suggested?: unknown } | null | undefined
  const target = t && typeof t === 'object' && typeof t.sid === 'string' && t.sid && typeof t.title === 'string' ? { sid: t.sid, title: t.title, suggested: t.suggested === true } : undefined
  const fresh = was.state !== undefined ? was.fresh === true : state === 'start' && !target
  return { state, reason: was.reason, ...(target ? { target } : {}), ...(fresh ? { fresh: true as const } : {}) }
}

/**
 * The three lists as the last sync stored them, drawn in this thread's pane: no feed call and no app call (S2).
 * R16 (0.5.2): its rows are worded at that sync's own moment, the one the threads were named at, so a row and
 * its thread's name never disagree (Rob saw `1d late` on a row and `2d late` on its thread).
 */
async function drawStored($: EngineInterface, last: Last, now: number): Promise<void> {
  const list = (v: unknown): QueueItem[] => (Array.isArray(v) ? (v as QueueItem[]) : [])
  const at = Number.isFinite(last.at) ? last.at : now
  const rowsOf = (items: readonly QueueItem[], needsYou = false): Row[] => items.map(it => rowFor(it, storedRec(last, it.projectId) ?? recommend([], undefined, at), at, { needsYou }))
  const items = list(last.items)
  await showQueue($, memberText(last.member), items, rowsOf(items, true), Number(last.pinned) || 0, now, { teammate: rowsOf(list(last.teammate)), older: rowsOf(list(last.older)), checking: rowsOf(list(last.checking)) }, at)
}

/** The package a client's pickup view reads, or null: the one that is the viewer's to work, or (for the founder) the one that waits for his OK. */
function pickupOf(it: QueueItem): string | null {
  const packageId = it.packageId ?? (it.kind === 'ok' ? ((it.open ?? null)?.id ?? null) : null)
  return packageId && isUuid(packageId) ? packageId : null
}

async function renderPickup($: EngineInterface, it: QueueItem): Promise<string | null> {
  // The package that is the viewer's to work, or (for the founder) the one that waits for his OK: he reads it, he does not pick it up.
  const packageId = pickupOf(it)
  if (!packageId) return null
  try {
    const r = await $.http.fetch(`${EXT}/reply-package?package_id=${packageId}&format=pickup`, {
      headers: { Authorization: `Bearer ${await token($)}`, ...CLIENT_HEADER },
    })
    if (r.ok) {
      const j = JSON.parse(r.text) as { markdown?: string }
      if (j.markdown) return j.markdown
    }
  } catch {
    // fall through to the local renderer
  }
  const script = `${await home($)}/.claude/skills/client-reply-prep/scripts/render_pickup.py`
  for (const py of [['python3'], ['python'], ['py', '-3']]) {
    try {
      const out = await $.process.run([...py, script, '--package', packageId], { timeoutMs: 90_000 })
      if (out.exitCode === 0 && out.stdout.trim()) return out.stdout
    } catch {
      // that interpreter is not here; try the next
    }
  }
  return null
}

/** This draw of the client part is now this session's newest: an older one still reading its view draws nothing over it. */
async function newDraw($: EngineInterface): Promise<() => Promise<boolean>> {
  const id = await instanceId($)
  const draw = (viewDraws.get(id) ?? 0) + 1
  viewDraws.set(id, draw)
  return async () => viewDraws.get(id) === draw
}

/**
 * The client part of the pane: a client's prepared drafts when there is a package (under a line saying the
 * viewer holds it, when they do), else the messages waiting on our reply, the tasks due and what is true of
 * its reply drafts. `own` is the client of the thread the pane is in: its part is headed `This thread:
 * <client>`. One package read (the pickup view), in this thread's own session.
 * In two steps (S2). This call draws at once what needs no network: the whole part for a client with no
 * package; for one with a package and `atOnce` (a press), the pickup view this session read less than a
 * minute ago, else the client's heading and `Checking…`. The step it answers reads the pickup view and draws
 * it. Only this session's newest draw lands: a press on another row meanwhile is not drawn over.
 */
async function beginClient($: EngineInterface, it: QueueItem, own: boolean, atOnce: boolean): Promise<() => Promise<void>> {
  const heading = own ? `This thread: ${it.client}` : ''
  const newest = await newDraw($)
  const draw = async (text: string): Promise<void> => {
    if (await newest()) await $.state.set(VIEW, { text, heading } satisfies MmView)
  }
  const withBanner = (view: string): string => [holdBanner(it), view].filter(Boolean).join('\n\n')
  const now = await $.clock.now()
  const packageId = pickupOf(it)
  if (!packageId) {
    await draw(clientMarkdown(it, now))
    return async () => {}
  }
  if (atOnce) {
    const seen = pickups.get(packageId)
    await draw(seen && now - seen.at < PICKUP_REUSE_MS ? withBanner(seen.text) : [`## ${it.projectName}`, titleFor(it, now), CHECKING].join('\n\n'))
  }
  return async () => {
    const view = await renderPickup($, it)
    if (view) {
      pickups.delete(packageId)
      pickups.set(packageId, { at: await $.clock.now(), text: view })
      for (const old of [...pickups.keys()].slice(0, Math.max(0, pickups.size - PICKUPS_MAX))) pickups.delete(old)
    }
    await draw(view ? withBanner(view) : clientMarkdown(it, await $.clock.now()))
  }
}

/** No client part: the pane holds the list alone (and a client part still being read is not drawn after this). */
async function clearClient($: EngineInterface): Promise<() => Promise<void>> {
  await newDraw($)
  await $.state.set(VIEW, { text: '', heading: '' })
  return async () => {}
}

/** The client part, drawn when it is read: what the timer and a pass draw (no `Checking…` in a pane the person may be reading). */
async function showClient($: EngineInterface, it: QueueItem, own: boolean): Promise<void> {
  await (await beginClient($, it, own, false))()
}

/** What a client's part shows, in a word: the thread's note and its part are drawn again only when this changes. */
function partSig(it: QueueItem): string {
  const o = it.open ?? null
  return o
    ? `open:${o.id}:${o.state}:${it.coversThrough ?? ''}:${o.unsent}:${o.newer}:${it.messages}:${it.tasks}`
    : it.packageId ? `pkg:${it.packageId}:${it.coversThrough}` : `q:${it.messages}:${it.tasks}:${it.dueAt}`
}

/** The client part as the state holds it; a session an older version left its view in held plain text there. */
async function clientPart($: EngineInterface): Promise<MmView> {
  const { value } = (await $.state.get(VIEW)) as { value: MmView | string | undefined }
  if (typeof value === 'string') return { text: value, heading: '' }
  return value && typeof value.text === 'string' ? { text: value.text, heading: typeof value.heading === 'string' ? value.heading : '' } : { text: '', heading: '' }
}

/**
 * The waiting client this thread is linked to, if it is linked to one. From what is stored and this thread's
 * id as the timer (or a pass) already learnt it: no app call (S2).
 */
async function ownIn($: EngineInterface, items: readonly QueueItem[]): Promise<QueueItem | undefined> {
  const me = await knownSelf($)
  const pid = me ? ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {})) : undefined
  return pid ? items.find(i => i.projectId === pid) : undefined
}

/**
 * The pane, as the person asked for it (/mm, the band's Open list, the tool's ""): ONE pane with two parts in
 * a thread that is a waiting client's, the client's part on top and the Needs-you list under it; the list
 * alone in any other thread (Rob, 2026-10-12: "Needs you shows up on the bottom half of the panel on the
 * right, and the one for that specific client shows up on the top half").
 * S2: it opens AT ONCE, drawn from what the last sync stored; the list is then brought up to date and drawn
 * again, and the client part with it when what it shows changed. A press (`press`, the band's button) may take
 * a feed this session read less than a minute ago; a typed /mm asks OW again.
 * ⛔ Opened only because the person asked. Nothing opens a pane from a timer: the API has no way to make
 *    one available without drawing it, and drawing it opens a closed side panel.
 */
async function showList($: EngineInterface, press: boolean): Promise<string> {
  const now = await $.clock.now()
  const kept = await storeGet<Last | null>($, 'mm.last', null)
  let before: QueueItem | undefined
  let finish: () => Promise<void>
  try {
    if (kept && Array.isArray(kept.items)) await drawStored($, kept, now)
    before = await ownIn($, listedIn(kept))
    finish = before ? await beginClient($, before, true, true) : await clearClient($)
  } catch {
    // a stored list this version cannot draw (an older version's, a damaged file): the pass below draws it
    before = undefined
    finish = await clearClient($)
  }
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  // after the pane is open: its client part read, and the list brought up to date, side by side
  const reading = finish()
  let last: Last
  try {
    last = (await reconcile($, press ? await recentFeed($) : await fetchFeed($))).last
  } catch (err) {
    // the list it opened with stays, and the pane says it is the one last loaded (L3). A typed /mm still
    // answers with the failure, as before; the band's button has said all there is to say.
    await refreshFailed($, err)
    if (!press) throw err
    return REFRESH_FAILED
  } finally {
    await reading
  }
  const after = await ownIn($, listedIn(last))
  if ((after ? `${after.projectId}\n${partSig(after)}` : '') !== (before ? `${before.projectId}\n${partSig(before)}` : '')) {
    if (after) await showClient($, after, true)
    else await clearClient($)
  }
  return last.items.length ? `${last.items.length} client${last.items.length === 1 ? '' : 's'} need you; ${last.pinned} thread${last.pinned === 1 ? '' : 's'} pinned. The list is in the side pane.` : 'Nothing needs you right now.'
}

/**
 * This thread's client in the pane, with a short note for Claude. `force` is the person asking for it
 * (/mm view, /mm link, the band's Drafts button); without it this is the timer.
 * ⛔ The timer opens no pane. It keeps the client part current, so a pane the person has open shows what
 *    is waiting now, and that is all it does to the pane.
 * ⛔ A thread that linked itself gets the pin and the name only. Nothing is added to its transcript, and
 *    its client part is not read, until the person acts on that link: Update, /mm link, or /mm view here.
 */
async function refreshSelf($: EngineInterface, force: boolean): Promise<string> {
  const me = await selfId($)
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const pid = me ? ownerOf(me, links) : undefined
  if (!pid) return 'This thread is not linked to a client. Use /mm link <client>.'
  if ((await storeGet<Auto>($, 'mm.auto', {}))[pid]?.sid === me) {
    if (!force) return ''
    await claim($, pid, me)
  }
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const it = listedIn(last).find(i => i.projectId === pid)
  if (!it) {
    // A client on none of the lists (one /mm link may name): asked for by the person, the pane's client part
    // is emptied, so it does not go on showing the client this thread was before.
    if (force) await $.state.set(VIEW, { text: '', heading: '' })
    return 'Nothing needs you on this client right now.'
  }
  const sig = partSig(it)
  const noted = await storeGet<Record<string, string>>($, 'mm.noted', {})
  if (!force && noted[me] === sig) return 'Up to date.'
  const now = await $.clock.now()
  // asked for by the person, the pane opens at once and its client part is read after (S2); the timer draws
  // the part only once it has read it
  const finish = await beginClient($, it, true, force)
  if (force) await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  await finish()
  if (noted[me] !== sig) {
    const body = noteText(it, last?.member ?? '')
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: `[Massmarket bridge, no reply needed] ${it.projectName}: ${titleFor(it, now)}. ${body} Nothing has been sent.` }] },
    })
    await patchStore<Record<string, string>>($, 'mm.noted', {}, fresh => {
      fresh[me] = sig
    })
  }
  return `Showing ${it.client} in the side pane.`
}

/** (R9) A client of the last sync with no thread of any kind (an older version's record: Start with no thread to act on). */
function isFresh(last: Last, projectId: string): boolean {
  const rec = last.recs?.[projectId] as (Partial<Recommendation> & { action?: unknown }) | undefined
  return rec?.state !== undefined ? rec.fresh === true : rec?.action === 'start' && !rec?.target
}

/**
 * The one line above the prompt, in every desktop thread (Rob, 2026-10-12: "How do we open this panel up
 * in other threads where it's not already open?"): what needs the person, by R9. In a thread that is a waiting
 * client's, its second button opens that client's part of the pane. '' draws nothing: no sync on record yet,
 * the bridge paused, a terminal session, or no tracker token on this computer.
 * ⛔ From what is stored only: the last sync, the links, the chips, and this thread's id as the timer already
 *    learnt it. No feed call, no app call, no sync.
 */
async function bandLine($: EngineInterface): Promise<MmBand> {
  const nothing: MmBand = { text: '' }
  if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return nothing
  if (await $.store.get('mm.paused')) return nothing
  const last = await storeGet<Last | null>($, 'mm.last', null)
  if (!last || !Array.isArray(last.items)) return nothing
  try {
    await token($)
  } catch {
    return nothing
  }
  const now = await $.clock.now()
  const items = last.items
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const me = await knownSelf($)
  const noThread = items.filter(i => isFresh(last, i.projectId) && links[i.projectId] === undefined && pinsNow(i, now))
  const chips = await chipsOf($, now)
  /** (0.5.4) Where a chip is, by the band's name for its thread: the one it was minted with, else here or elsewhere. */
  const placeOf = (c: Chip): string => c.place || (c.threadId === me ? 'this thread' : 'another thread')
  // (C3) each no-thread client's one chip, wherever it is
  const chipIn = (pid: string): string | undefined => {
    const c = liveChip(chips, pid)
    return c ? placeOf(c) : undefined
  }
  // (C2) the chips of the person's clients with a thread, held by other threads: one entry for each thread
  const elsewhere = new Map<string, string>()
  for (const c of chips) {
    if (c.superseded || !c.auto || c.gen !== CHIP_GEN || c.threadId === me || links[c.projectId] === undefined) continue
    if (!items.some(i => i.projectId === c.projectId)) continue
    if (!elsewhere.has(c.threadId)) elsewhere.set(c.threadId, placeOf(c))
  }
  // (0.5.4) this thread's own refresh failed after the sync on record: the band says so too, until a newer sync
  const { value: queue } = await $.state.get(QUEUE)
  const ownFailed = Boolean(queue?.warning && (queue.warnedAt ?? 0) >= last.at)
  const recOf = (pid: string) => storedRec(last, pid)
  const linkedTarget = (i: QueueItem): boolean => {
    const t = recOf(i.projectId)?.target
    return Boolean(t && !t.suggested && links[i.projectId] === t.sid)
  }
  const stillOpen = items.find(i => fastState(i, now)?.state === 'still_open' && Boolean(recOf(i.projectId)?.target) && !recOf(i.projectId)?.target?.suggested)
  const update = items.find(i => recOf(i.projectId)?.state === 'update' && linkedTarget(i) && pinsNow(i, now))
  const text = bandText({
    pinned: Number(last.pinned) || 0,
    // (fix round 1, L7) anything due within the window, with a thread or not, says Needs you
    pinsNow: items.some(i => pinsNow(i, now)),
    noThread: noThread.map(i => ({ client: cleanName(i.client), due: clockText(i.dueAt, now), chipIn: chipIn(i.projectId), chipHere: Boolean(me) && liveChip(chips, i.projectId)?.threadId === me })),
    chipsElsewhere: [...elsewhere.values()],
    stillOpen: stillOpen ? cleanName(stillOpen.client) : undefined,
    update: update ? cleanName(update.client) : undefined,
    stale: Boolean(last.error) || !(Number.isFinite(last.at) && now - last.at <= STALE_SYNC_MS) || ownFailed,
    older: Array.isArray(last.older) ? last.older.length : 0,
    // (0.5.5) what this session's last look found (`checkVersions`): no call from here
    newer: newerMod.get(await instanceId($))?.version || undefined,
    // (0.5.7) the notes of the last NOTE_SHOW_MS
    notes: (await storeGet<BandNote[]>($, 'mm.notes', [])).filter(n => n && typeof n.text === 'string' && now - n.at < NOTE_SHOW_MS).map(n => n.text),
  })
  if (!text) return { text: '', at: last.at }
  // (0.5.12) the Start all button, when two or more clients need a new thread (or one a capped press left)
  const offer = await startAllOffer($)
  const all = offer > 0 ? { startAll: offer } : {}
  // In a waiting client's thread the line carries the button that opens its part of the pane.
  const mine = me ? ownerOf(me, links) : undefined
  return mine && items.some(i => i.projectId === mine) ? { text, drafts: true, at: last.at, ...all } : { text, at: last.at, ...all }
}

/** Works the band's line out again and redraws it when it changed. */
async function refreshBand($: EngineInterface): Promise<void> {
  try {
    const band = await bandLine($)
    const { value: was } = await $.state.get(BAND)
    // (0.5.4) the sync it was drawn from is kept with it, so a thread can tell it is behind the store (`catchUp`)
    if ((was?.text ?? '') !== band.text || Boolean(was?.drafts) !== Boolean(band.drafts) || was?.at !== band.at || (was?.startAll ?? 0) !== (band.startAll ?? 0)) await $.state.set(BAND, band)
  } catch {
    // the band is a convenience: it never breaks a sync or a command
  }
}

async function beat($: EngineInterface, extra: Record<string, unknown>): Promise<void> {
  try {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    // how many pairs the app's records have given: a count, nothing from them
    const appPairs = Object.values(await storeGet<Records>($, 'mm.records', {})).filter(r => r && r.cli).length
    // (0.5.4) the last refresh that failed, in any thread: its session, thread, time and reason
    const refreshError = await storeGet<unknown>($, 'mm.refreshError', null)
    await $.fs.write(
      `${await home($)}/.claude/mm-hooks/bridge-state.json`,
      JSON.stringify({ version: VERSION, at: new Date(await $.clock.now()).toISOString(), session: await instanceId($), lastSync: last ? new Date(last.at).toISOString() : null, member: last?.member, need: last?.items.length ?? 0, pinned: last?.pinned ?? 0, appPairs, error: last?.error ?? null, refreshError, ...extra }, null, 1),
    )
  } catch {
    // a heartbeat must never break the bridge
  }
}

/**
 * R15 (Rob, 2026-10-13: "I always have it sorted by date... sorting by date is also ideal"): on this machine's
 * first run of 0.5.2, the app's thread list is set once to group by date, newest activity first (pinned threads
 * stay on top), and the pane says so once (VIEW_NOTICE). Recorded (`mm.viewSet`), so it never runs again on this
 * machine, whatever the person sets afterwards: their choice stands. A call that fails or is refused records no
 * `mm.viewSet` and says nothing; it is tried again in a later session, at most once a day (`mm.viewTry`: the time
 * of the last try, and nothing else).
 * ⛔ Not a press and not the person's act: it touches no pin, title or link. Only the thread that polls runs it.
 */
async function setViewOnce($: EngineInterface): Promise<void> {
  const id = await instanceId($)
  if (viewTried.has(id) || (await $.store.get('mm.viewSet'))) return
  const now = await $.clock.now()
  const tried = Number(await $.store.get('mm.viewTry')) || 0
  if (tried && now - tried < DAY_MS) return
  viewTried.add(id)
  await $.store.set('mm.viewTry', now)
  const done = async (): Promise<void> => {
    await $.store.set('mm.viewSet', { at: now, version: VIEW_VERSION })
    await say($, VIEW_NOTICE, false)
  }
  let set = false
  try {
    const call = $.mcp.call('ccd_sidebar', 'set_view', { group_by: 'date', sort_by: 'recency' }) as Promise<Mcp>
    const r = await within($, call)
    set = r.ok && !r.value.isError
    // (fix round 1, L11) an answer that comes after the wait, and says it worked, is recorded then
    if (!r.ok) void call.then(late => (late.isError ? undefined : done()), () => undefined).catch(() => undefined)
  } catch {
    set = false
  }
  if (set) await done()
}

async function tick($: EngineInterface): Promise<void> {
  /** (fix round 1, L12) The sync this tick ran failed: the time of the sync on record it was to replace. */
  let failed: { at: number | null } | null = null
  try {
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
    // (0.5.4) first, before anything that waits on the app: a band and a list drawn from an older sync than the
    // store holds are drawn again from it
    await catchUp($)
    await recordSelf($)
    if (await $.store.get('mm.paused')) {
      await refreshBand($) // paused: the band goes with the pins
      return
    }
    // (0.5.4, C3) this thread is running
    await noteSeen($, false).catch(() => {})
    // (0.5.5) a later mod installed on this machine than the one this thread runs
    await checkVersions($).catch(() => {})
    const now = await $.clock.now()
    const id = await instanceId($)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    if (!lease || lease.until < now || lease.owner === id) {
      await $.store.set('mm.lease', { owner: id, until: now + LEASE_MS })
      const last = await storeGet<Last | null>($, 'mm.last', null)
      // Due every SYNC_MS, and at once when a thread asked since the last one (a reply draft was sent or
      // discarded there: `askSync`).
      const asked = Number(await storeGet<number>($, 'mm.ask', 0)) || 0
      if (!last || now - last.at >= SYNC_MS || asked > last.at) {
        try {
          await sync($)
        } catch (err) {
          failed = { at: last?.at ?? null }
          throw err
        }
      }
      // R15: the thread list's view, once on this machine
      await setViewOnce($).catch(() => {})
    }
    // (0.5.11, Rob 10-15) in every running thread, once for each sync on record: the clients' threads to update by
    // themselves (the thread that synced, at once; every other, on its next tick)
    await autoUpdates($).catch(err => noteFailure($, 'auto update', err))
    await refreshSelf($, false)
    // R5: this thread's own chips: the ones no longer wanted withdrawn, the missing ones minted
    await chipsTick($).catch(() => {})
    await refreshBand($)
    // a failed refresh's line, once a sync since has worked (L3)
    await clearRefreshFailed($)
    await beat($, { ok: true })
  } catch (err) {
    // (fix round 1, L12) the sync on record says it failed only when the sync itself did, and only while no
    // other session has synced since (its `at` unchanged): anything else that goes wrong in a tick is the
    // heartbeat's to say, and never makes the band read a working sync as stale
    // (TypeScript narrows `failed` to null here, since it cannot see the assignment inside the inner catch)
    const f = failed as { at: number | null } | null
    if (f) {
      const last = await storeGet<Last | null>($, 'mm.last', null)
      if (last && last.at === f.at) await $.store.set('mm.last', { ...last, error: short(String(err), 300) })
    }
    $.ui.status(`MM: error, /mm status`)
    await refreshBand($)
    await beat($, { ok: false, tickError: short(String(err), 300) })
  }
}

/**
 * A reply draft was just sent or discarded in this thread (the gateway call finished): the list is brought
 * up to date now, not at the next five-minute sync (Rob, 2026-10-12).
 *
 * Two things, both through what is already there:
 *   - the request is left in the store (`mm.ask`, a time), which the thread that polls reads on its tick:
 *     it syncs at once when a request is newer than its last sync. That is the whole of it for a terminal
 *     session, which has no thread list to pin or name with;
 *   - in the desktop app, ONE sync runs in this thread, ASK_WAIT_MS after the last such call: a person
 *     sending three drafts in a row gets one sync, after the third. It is the sync /mm runs from any
 *     thread. It does not take the poller's lease, and it is skipped when a sync newer than the request
 *     is already on record (the poller got there first), and while the bridge is paused.
 * ⛔ Sends nothing, starts nothing, and knows nothing of the call but that it was made.
 */
async function askSync($: EngineInterface): Promise<void> {
  await $.store.set('mm.ask', await $.clock.now())
  askTimer?.cancel()
  askTimer = $.clock.after(ASK_WAIT_MS, () => {
    askTimer = null
    void syncAsked($)
  })
}

/**
 * R11 (Rob, 2026-10-13: the F&I thread lost its link when its session also declared the internal-ops project):
 * a route call that can close something (the R6 routes: `isClosingRoute`) worked in this thread, so a link the
 * bridge made by itself for this thread has been used to close a reply. It is the person's from here on
 * (`claim`): a session that also declares another project no longer lets it go. ⛔ (final round, 10-14) This and
 * the person's own act are the only two ways: a send by any other path (a Gmail script, an HL call) claims
 * nothing, and B3 releases a link no route or act has claimed.
 */
async function claimUsed($: EngineInterface): Promise<void> {
  const me = (await knownSelf($)) || (await selfId($))
  if (!me) return
  const pid = ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {}))
  if (pid === undefined || (await storeGet<Auto>($, 'mm.auto', {}))[pid]?.sid !== me) return
  await claim($, pid, me)
}

async function syncAsked($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
    if (await $.store.get('mm.paused')) return
    const asked = Number(await storeGet<number>($, 'mm.ask', 0)) || 0
    const last = await storeGet<Last | null>($, 'mm.last', null)
    // (a sync made in the very millisecond of the request may have read the store before the change it is for)
    if (last && last.at > asked) return
    await sync($)
    // (0.5.11) as a tick does, once the sync is on record
    await autoUpdates($).catch(err => noteFailure($, 'auto update', err))
    await refreshSelf($, false)
    await refreshBand($)
  } catch {
    // the next tick's sync is the fallback: the request is still in the store
  }
}

/**
 * The clients a typed name could mean. One whose short name or full name it is exactly, if there is one;
 * otherwise every client whose name contains it. More than one is a question for the person, never a guess.
 */
function clientsNamed<T extends KnownClient>(name: string, items: readonly T[]): T[] {
  const q = cleanName(name).toLowerCase()
  if (!q) return []
  const exact = items.filter(i => nameMatch(q, i) === 'exact')
  return exact.length ? exact : items.filter(i => nameMatch(q, i) === 'contains')
}

/** How a typed name (cleaned, lower case) meets a client's: its short name or full name `exact`ly, or one of them `contains` it. */
function nameMatch(q: string, i: KnownClient): 'exact' | 'contains' | undefined {
  const short = i.client.replace(/…$/, '').toLowerCase()
  const full = i.projectName.toLowerCase()
  if (short === q || full === q) return 'exact'
  return short.includes(q) || full.includes(q) ? 'contains' : undefined
}

// What the person typed is echoed cleaned, like any other text that did not come from this file.
const noClient = (name: string) => `No client matching "${cleanName(name)}" needs you right now. /mm shows who does.`
/** /mm link's answer when nothing anywhere in the feed is that client: not a name, not an id. */
const noFeedClient = (name: string) => `No client named "${cleanName(name)}" is in your feed. /mm link takes a client's name or project id.`

/**
 * A project id as the person may type it: the whole uuid, or its first 8 characters; also as a sentence
 * names one, `client 1a08666a`, or after a name, `Acme (1a08666a)` (severalClients).
 */
const ID_TYPED = /^(?:client\s+|.*\(\s*)?([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)\s*\)?$/

/**
 * The clients `/mm link <x>` could mean (Rob, 2026-10-13: a client with nothing waiting could not be
 * linked), among every client the pane's three lists hold and every client the feed names (its mail,
 * reply packages and tickets), together. The first of these that finds any:
 *   1. the clients whose short name or full name it is exactly
 *   2. the clients whose name contains it
 *   3. a project id: the whole uuid, or its first 8 characters when only one project the feed carries
 *      starts with them (the feed's `threads` included, which carry an id and no name)
 * ⛔ Never a guess (review of 79cbc596, F3: "Acme" linked "Acme Legal Group" on the list though the feed
 * named a client "Acme"). More than one at a stage is a question for the person; so is an exact name off
 * the lists beside a client on them whose name contains it: both come back, and the caller asks.
 * A client known only by its id comes back with no name: the caller names it (`nameOfId`).
 */
function linkable(arg: string, listed: readonly QueueItem[], feed: Feed): KnownClient[] {
  const named = feedClients(feed)
  /** Every client either knows, each once: the lists' own item for a client on them. */
  const pool: KnownClient[] = [...listed, ...named.filter(n => !listed.some(l => l.projectId === n.projectId))]
  const q = cleanName(arg).toLowerCase()
  if (q) {
    const exact = pool.filter(i => nameMatch(q, i) === 'exact')
    if (exact.length) {
      const onLists = exact.some(e => listed.some(l => l.projectId === e.projectId))
      return onLists ? exact : [...exact, ...listed.filter(i => nameMatch(q, i) === 'contains')]
    }
    const contains = pool.filter(i => nameMatch(q, i) === 'contains')
    if (contains.length) return contains
  }
  const typed = ID_TYPED.exec(arg.trim().toLowerCase())?.[1]
  if (!typed) return []
  const ids = feedProjects(feed).filter(id => (typed.length === 8 ? id.startsWith(typed) : id === typed))
  // (one known only by its id is told apart from another by the whole id, should a sentence list both)
  return ids.map(id => listed.find(i => i.projectId === id) ?? named.find(n => n.projectId === id) ?? { projectId: id, projectName: id, client: '' })
}

/**
 * The name of a client the feed knows only by its id, for a sentence: from what `ownerName` reads (a pin
 * record of the bridge's for that client, else the name the bridge gave the thread linked to it), failing
 * those `client <first 8 characters of the id>`. Its thread's name is asked of the app only when it is linked.
 */
async function nameOfId($: EngineInterface, projectId: string): Promise<string> {
  const pins = await storeGet<Record<string, Pin>>($, 'mm.pins', {})
  const pin = Object.values(pins).find(p => p?.projectId === projectId)
  const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[projectId]
  const thread = linked && THREAD_ID.test(linked) ? await desktopOnly(async () => asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: linked })), null) : null
  return ownerName(projectId, [], pin, thread?.title) || `client ${projectId.slice(0, 8)}`
}

function severalClients(name: string, found: readonly KnownClient[]): string {
  const short = found.map(i => i.client)
  const full = found.map(i => i.projectName)
  const distinct = (names: readonly string[]) => new Set(names).size === names.length
  // two clients with the same short name are told apart by their full names; with the same full name too, by
  // the first 8 characters of their project ids, which /mm link takes (L4)
  const names = distinct(short) ? short : distinct(full) ? full : found.map(i => `${i.projectName} (${i.projectId.slice(0, 8)})`)
  return `More than one client matches "${cleanName(name)}": ${names.join(', ')}. Type more of the name.`
}

/**
 * The name of the client a thread is linked to, for a sentence: from the queue, else from the thread's pin
 * record, else from the name the bridge itself gave the thread. '' when none of those has it.
 */
function ownerName(projectId: string, items: readonly QueueItem[], pin: Pin | undefined, title: string | undefined): string {
  const inQueue = items.find(i => i.projectId === projectId)?.client
  if (inQueue) return inQueue
  if (pin?.projectId === projectId && cleanName(pin.client)) return cleanName(pin.client)
  // (in today's shape of that name, or the one before it)
  return title && isOurTitle(title) ? cleanName(clientInTitle(title)) : ''
}

// ---------------------------------------------------------------- what a button or a command does
// ⛔ Everything below this line runs only because the person pressed a button or typed a command.
// ⛔ startThread and updateThread are never reached for Claude: see `runCommand`.

/** 0.5.1's title for a chip that opens a new thread for a client. (A stale package a teammate has is worded as one a teammate holds: M2.) */
function startTitle(it: QueueItem): string {
  return chipTitle(startWhat(it))
}

/** 0.5.1's words for what a client's chip is for, uncut: `<client>: review the reply drafts` and the like. */
function startWhat(it: QueueItem): string {
  return `${it.client}: ${it.kind === 'ok' ? 'needs your OK' : it.open && withHolder(it.open) ? `reply drafts are with ${it.open.by}` : it.kind === 'ready' ? 'review the reply drafts' : 'reply to the client'}`
}

/** 0.5.1's line under that title. */
function startTldr(it: QueueItem, now: number): string {
  return `${it.client} needs you: ${needsLine(it, now)}. Start this to open a thread for that client with the drafts or the messages waiting.`
}

/**
 * (0.5.4, C1: Rob, 10-14, "yes chips") The chip a client's own thread mints, titled with the action it recommends,
 * verbatim: `Do it here: <what>` (the client's kickoff, run in this thread with the app's Do it here). Cut to 60
 * characters. Its line ends with `Recommended: Do it here.` (0.5.11: no `Start a fresh thread` chip from a thread's
 * length any more: Claude Code compacts a long thread.)
 */
function hereTitle(it: QueueItem): string {
  return chipTitle(`Do it here: ${startWhat(it)}`)
}
function hereTldr(it: QueueItem, now: number): string {
  return `${it.client} needs you: ${needsLine(it, now)}. Recommended: Do it here.`
}

/**
 * Fix round 1, F4: the chips on record, with this thread's own that the store lost written back first (as this
 * session knows them), so that a lost record never causes a second chip. Old ones this session remembers are
 * forgotten after CHIP_KEEP_MS, as the store's are.
 */
async function ownChipsWritten($: EngineInterface, me: string, now: number): Promise<Chip[]> {
  for (const [k, c] of ownChips) if (now - c.at > CHIP_KEEP_MS) ownChips.delete(k)
  const chips = await chipsOf($, now)
  const lost = [...ownChips.values()].filter(c => c.threadId === me && !chips.some(s => sameChip(s, c)))
  if (!lost.length) return chips
  await patchChips($, now, fresh => {
    const add = lost.filter(c => !fresh.some(f => sameChip(f, c)))
    return add.length ? [...fresh, ...add] : false
  }).catch(() => {})
  // a dozen threads ticking together can take this write away too: looked at again 1 to 3 seconds on
  scheduleOwnCheck($, me)
  return [...chips, ...lost]
}

/** One chip to mint: for which client and need, what it carries, and in which thread. */
type MintSpec = { it: QueueItem; signature: string; need: 'start' | 'long' | 'here'; auto: boolean; title: string; tldr: string; prompt: string; me: string; now: number; place?: string | undefined }
type Minted = { made: true } | { made: false; why: 'no-answer' } | { made: false; why: 'refused' | 'no-tool'; text: string }

/**
 * Mints one chip and records it. R10 (Rob, 2026-10-13: Start on ELV Capital Homes said nothing and made no chip,
 * and the store held no `mm.chips` at all, so the app's `spawn_task` never answered): the app is given
 * APP_WAIT_MS. When it has not answered by then, `no-answer`, and nothing is recorded yet; should its answer
 * come later, the chip is recorded then, so that this thread can withdraw it like any other.
 * ⛔ One mint per thread, client and signature at a time (`minting`).
 */
async function mintChip($: EngineInterface, m: MintSpec): Promise<Minted> {
  const key = `${m.it.projectId}\n${m.me}\n${m.signature}`
  minting.add(key)
  let call: Promise<Mcp>
  let answered: { ok: true; value: Mcp } | { ok: false }
  // (0.5.7) the app's chip (spawn_task), or where the app has only start_session, its proposal card (own_initiative):
  // it shows like a chip, starts nothing until the person starts it, and is withdrawn the same way (dismiss_task)
  const ask = (proposal: boolean): Promise<Mcp> =>
    (proposal
      ? $.mcp.call('ccd_session', 'start_session', { initiation: 'own_initiative', title: m.title, prompt: m.prompt, context: 'fresh', background: START_BACKGROUND })
      : $.mcp.call('ccd_session', 'spawn_task', { title: m.title, tldr: m.tldr, prompt: m.prompt })) as Promise<Mcp>
  try {
    const tools = await sessionTools($)
    let proposal = !tools.spawn && tools.start
    try {
      call = ask(proposal)
      answered = await within($, call)
    } catch (err) {
      // the tool the app no longer (or does not yet) gives this session: the other one (for a chip the person
      // asked for, Start opens the thread instead: `startThread`)
      if (!noTool(err)) throw err
      await sawTools($, proposal ? { start: false, spawn: true } : { start: true, spawn: false })
      if (!m.auto) {
        minting.delete(key)
        return { made: false, why: 'no-tool', text: errorText(err) }
      }
      proposal = !proposal
      call = ask(proposal)
      answered = await within($, call)
    }
  } catch (err) {
    minting.delete(key)
    return { made: false, why: 'refused', text: errorText(err) }
  }
  if (!answered.ok) {
    void call
      .then(
        async r => {
          if (!r.isError) await recordChip($, m, textOf(r))
        },
        () => undefined,
      )
      .catch(() => undefined)
      .finally(() => minting.delete(key))
    return { made: false, why: 'no-answer' }
  }
  minting.delete(key)
  if (answered.value.isError) return { made: false, why: 'refused', text: textOf(answered.value) }
  await recordChip($, m, textOf(answered.value))
  return { made: true }
}

// ---------------------------------------------------------------- (0.5.7) starting a thread with start_session

/**
 * (0.5.7, Rob 10-14 13:20 ET: "Could not create the chip: ... no connected MCP tool "spawn_task"") Which of the app's
 * two ways this session has: `start_session` (the app since 10-14, beside list_start_targets and hand_off_to_session)
 * or `spawn_task` (before it). Read from `$.tool.list()` (EngineInterface.tool.list: the tools the model can call now,
 * MCP ones as `mcp__<server>__<tool>`), at most once in TOOLS_EVERY_MS for a session; never from a version. A listing
 * that names neither says nothing: spawn_task first, as before 0.5.7, and the app's "no connected MCP tool" answer
 * then says which it is (`noTool`, `sawTools`).
 */
const toolsSeen = new Map<string, { start: boolean; spawn: boolean; at: number }>()
async function sessionTools($: EngineInterface): Promise<{ start: boolean; spawn: boolean }> {
  const id = await instanceId($)
  const now = await $.clock.now()
  const was = toolsSeen.get(id)
  if (was && now - was.at < TOOLS_EVERY_MS) return was
  let names: string[] = []
  try {
    names = (await $.tool.list()).map(t => t.name)
  } catch {
    // no listing: as one that names neither
  }
  const start = names.includes('mcp__ccd_session__start_session')
  const spawn = names.includes('mcp__ccd_session__spawn_task')
  const seen = start || spawn ? { start, spawn, at: now } : { start: false, spawn: true, at: now }
  toolsSeen.set(id, seen)
  return seen
}
async function sawTools($: EngineInterface, tools: { start: boolean; spawn: boolean }): Promise<void> {
  toolsSeen.set(await instanceId($), { ...tools, at: await $.clock.now() })
}
/** The engine's word for a call to a tool the app does not give this session. */
const noTool = (err: unknown): boolean => /no connected MCP tool/i.test(errorText(err))

/** What start_session answered for a thread started now: the new thread's id when the answer gives it. */
type StartedNow = { ok: true; sid?: string | undefined } | { ok: false; why: 'refused' | 'no-answer' | 'no-tool'; text: string }

/**
 * (0.5.7) Starts the client's thread now: `start_session` with `initiation: "user_asked"`, for a person's Start (the
 * person pressing it is the user asking) and for a thread the bridge starts by itself on Rob's standing instruction
 * (Rob, 10-14 ~13:35 ET: "we can automatically start the new thread"). Never for anything else. Its answer, the app's
 * own (Claude.app, 10-14): `Started session "<title>" (session_id: local_…, name: …). …`.
 */
async function startNow($: EngineInterface, title: string, prompt: string): Promise<StartedNow> {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    // no word on this session's folder: the app's default, where this session runs
  }
  const args = { initiation: 'user_asked', title, prompt, context: 'fresh', background: START_BACKGROUND, use_worktree: false, wake_when_done: false, ...(cwd ? { cwd } : {}) }
  let answered: { ok: true; value: Mcp } | { ok: false }
  try {
    answered = await within($, $.mcp.call('ccd_session', 'start_session', args) as Promise<Mcp>)
  } catch (err) {
    if (noTool(err)) {
      await sawTools($, { start: false, spawn: true })
      return { ok: false, why: 'no-tool', text: errorText(err) }
    }
    return { ok: false, why: 'refused', text: errorText(err) }
  }
  if (!answered.ok) return { ok: false, why: 'no-answer', text: `the app did not answer in ${APP_WAIT_MS / 1000} seconds` }
  const text = textOf(answered.value)
  if (answered.value.isError) return { ok: false, why: 'refused', text }
  const sid = /\bsession_id:\s*(local_[A-Za-z0-9_-]{1,100})/.exec(text)?.[1]
  return { ok: true, sid }
}

/**
 * (0.5.7) A thread just started for a client, by the person's Start or by itself: every chip or proposal for the client
 * in any thread is superseded (each thread withdraws its own on its next pass; this one now), and, when the app gave
 * the new thread's id, it is linked, claimed and stamped at once (the person's act: pinned first), and a sync a second
 * on pins and names it. With no id, the kickoff's [mm-link] marker links it on its first turn, as a chip's does: a
 * record of what it was started with lets it take the client from the thread the client had (`linkFromMarker`).
 * (0.5.11) With an id, what the thread opened with is recorded at once too (`mm.sent`): the client's kickoff, whatever
 * hand-over it carried. Its own marker says so only once its first turn runs, and its kickoff with a hand-over never
 * does (it is not the bare kickoff): until then its row would read Update, and a thread just started would be sent
 * Update's message by itself (`autoUpdates`).
 */
async function adoptStarted($: EngineInterface, it: QueueItem, sid: string | undefined, prompt: string, me: string, now: number): Promise<void> {
  const pid = it.projectId
  const had = (await storeGet<Record<string, string>>($, 'mm.links', {}))[pid]
  await patchChips($, now, fresh => {
    for (const c of fresh) if (c.projectId === pid) c.superseded = true
    if (!sid) fresh.push({ projectId: pid, signature: signatureOf(it), taskId: '', threadId: me, at: now, prompt, ...(had ? { had } : {}) })
    return fresh
  }).catch(err => noteFailure($, 'start: the chips it replaces', err))
  void chipsPass($)
  if (!sid) return
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `start: ${what}`, err)
    }
  }
  await step('the link', () =>
    patchStore<Record<string, string>>($, 'mm.links', {}, fresh => {
      fresh[pid] = sid
    }),
  )
  await step('what the thread now has', () => putSent($, pid, { sid, sig: signatureOf(it), at: now }))
  await step('the unlink record', () => forgetUnlink($, sid))
  await step('the claim', () => claim($, pid, sid))
  await step('the stamp', () => stamp($, pid, sid))
  await askSync($).catch(() => {})
}

// ---------------------------------------------------------------- (0.5.7) threads the bridge starts by itself

/**
 * (0.5.7, Rob 10-14 ~13:35 ET: "If there's something from a client and there's no thread for it, or a thread needs to
 * be started fresh, we can automatically start the new thread, unpin the old one, and the team members see no
 * disruption") A thread started by itself, on record (`mm.autostarts`, every session's, the last day's): for which
 * client and what it carried (`sig`, a short hash of the signature), why, by which thread, and whether the app
 * started it (`ok`: null while it is being asked).
 */
type AutoStart = { at: number; pid: string; client: string; sig: string; kind: string; by: string; ok: boolean | null; reason: string }
/** A line the band shows in every thread for NOTE_SHOW_MS: a thread started by itself, the hourly cap reached. */
type BandNote = { text: string; at: number; key: string }

/** (0.5.7) Whether threads start by themselves on this computer: on unless the person typed /mm auto off. */
async function autoStartOn($: EngineInterface): Promise<boolean> {
  const v = await storeGet<{ on?: unknown } | null>($, 'mm.autostart', null)
  return v?.on !== false
}

/** (0.5.7) A short, stable name for a signature (FNV-1a, 32 bits): what the record and the log say a start carried. */
function sigHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** (0.5.7) The starts this session has claimed and not yet finished: a second tick does not claim one again. */
const autoInFlight = new Set<string>()

/**
 * (0.5.7) What becomes of a need for a new thread (C3; 0.5.11: no longer a thread 60% full) where the app gives
 * start_session and auto-start is on:
 *   skip    it is started, or being started (here or by another session: its claim in `mm.starting`), or a thread
 *           already has what it would carry
 *   card    the app refused to start it: the card instead
 *   capped  this machine started AUTO_STARTS_PER_HOUR in the last hour, or AUTO_STARTS_PER_DAY in the last day: the card
 *   start   claimed here (`mm.starting`, a lease per client and signature) and started once the claim has held
 *           (`autoStart`): two sessions that claim it together never both start it
 */
async function autoVerdict($: EngineInterface, n: Need, me: string, now: number): Promise<'skip' | 'card' | 'capped' | 'start'> {
  const pid = n.it.projectId
  const sig = sigHash(n.signature)
  const key = `${pid}\n${sig}`
  if (autoInFlight.has(key)) return 'skip'
  const tries = (await storeGet<AutoStart[]>($, 'mm.autostarts', [])).filter(t => t && typeof t === 'object')
  const these = tries.filter(t => t.pid === pid && t.sig === sig)
  if (these.some(t => t.ok !== false)) return 'skip'
  if (these.length) return 'card'
  const given = (await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[pid]
  if (given && given.sig === n.signature) return 'skip'
  const claimed = (await storeGet<Record<string, { owner?: string; until?: number }>>($, 'mm.starting', {}))[key]
  if (claimed && claimed.owner !== me && Number(claimed.until) > now) return 'skip'
  const started = tries.filter(t => t.ok !== false)
  if (started.filter(t => now - t.at < 3_600_000).length >= AUTO_STARTS_PER_HOUR || started.filter(t => now - t.at < DAY_MS).length >= AUTO_STARTS_PER_DAY) return 'capped'
  let mine = false
  await patchStore<Record<string, { owner?: string; until?: number }>>($, 'mm.starting', {}, fresh => {
    for (const [k, v] of Object.entries(fresh)) if (!v || !(Number(v.until) > now)) delete fresh[k]
    const held = fresh[key]
    if (held && held.owner !== me) return false
    fresh[key] = { owner: me, until: now + STARTING_MS }
    mine = true
  })
  if (!mine) return 'skip'
  autoInFlight.add(key)
  $.clock.after(settleMs(`${me}#${key}`), () => void autoStart($, n, me, key).finally(() => autoInFlight.delete(key)))
  return 'start'
}

/**
 * (0.5.7) Starts the client's thread by itself, once this session's claim has held (another session's write since
 * means that session starts it): `start_session` user_asked, with the kickoff a chip would carry. Recorded before the
 * app is asked, so no other session starts it meanwhile, and logged either way (`logAuto`). Started: linked and pinned
 * as a person's Start does it (`adoptStarted`); the band says so once. Refused: the card instead, at once.
 * (0.5.11, Rob 10-15) Never for a thread's length: no thread is replaced, or unpinned and renamed ` · moved`, for it.
 */
async function autoStart($: EngineInterface, n: Need, me: string, key: string): Promise<void> {
  const pid = n.it.projectId
  const sig = sigHash(n.signature)
  try {
    const now = await $.clock.now()
    const claimed = (await storeGet<Record<string, { owner?: string }>>($, 'mm.starting', {}))[key]
    if (claimed?.owner !== me) return
    if (!(await autoStartOn($)) || !(await sessionTools($)).start) return
    // checked again, now that the claim has held
    const tries = (await storeGet<AutoStart[]>($, 'mm.autostarts', [])).filter(t => t && typeof t === 'object')
    if (tries.some(t => t.pid === pid && t.sig === sig)) return
    const started = tries.filter(t => t.ok !== false)
    if (started.filter(t => now - t.at < 3_600_000).length >= AUTO_STARTS_PER_HOUR || started.filter(t => now - t.at < DAY_MS).length >= AUTO_STARTS_PER_DAY) return
    const entry: AutoStart = { at: now, pid, client: cleanName(n.it.client), sig, kind: n.kind, by: me, ok: null, reason: 'no thread' }
    await patchStore<AutoStart[]>($, 'mm.autostarts', [], list => {
      list.push(entry)
      list.splice(0, list.length, ...list.filter(t => t && now - Number(t.at) <= DAY_MS).slice(-200))
    })
    const title = startTitle(n.it)
    const answer = await startNow($, title, n.prompt)
    await patchStore<AutoStart[]>($, 'mm.autostarts', [], list => {
      const e = list.find(t => t && t.pid === pid && t.sig === sig && t.at === now && t.by === me)
      if (!e) return false
      e.ok = answer.ok
      if (!answer.ok) e.reason = `${e.reason}; not started: ${short(answer.text, 160)}`
    }).catch(() => {})
    await logAuto($, `${answer.ok ? 'started' : 'not started'} ${entry.client} (${pid}) sig ${sig}: ${entry.reason}${answer.ok ? '' : `; ${short(answer.text, 160)}`}`)
    if (!answer.ok) {
      // the card instead (where start_session itself is gone, the next tick makes the app's chip)
      if (answer.why !== 'no-tool') await mintChip($, { ...n, auto: true, me, now: await $.clock.now() })
      return
    }
    await adoptStarted($, n.it, answer.sid, n.prompt, me, now)
    await bandNote($, `Started ${entry.client}'s thread: it is under Pinned.`, `started\n${key}`)
  } catch (err) {
    await noteFailure($, 'auto start', err)
  } finally {
    await patchStore<Record<string, { owner?: string }>>($, 'mm.starting', {}, fresh => {
      if (fresh[key]?.owner !== me) return false
      delete fresh[key]
    }).catch(() => {})
  }
}

/** (0.5.7) A line for the band, in every thread, for NOTE_SHOW_MS, once for its `key`. */
async function bandNote($: EngineInterface, text: string, key: string): Promise<void> {
  const now = await $.clock.now()
  await patchStore<BandNote[]>($, 'mm.notes', [], list => {
    if (list.some(n => n && n.key === key && now - n.at < NOTE_SHOW_MS)) return false
    list.push({ text, at: now, key })
    list.splice(0, list.length, ...list.filter(n => n && now - n.at < NOTE_SHOW_MS).slice(-10))
  }).catch(() => {})
  await refreshBand($)
}

/**
 * (0.5.7) One line in the bridge's notice log (`~/.claude/mm-hooks/bridge-notices.log`, the last 500 lines) for every
 * thread started by itself, or not started: the client, what it carried and why, so it can be audited.
 */
async function logAuto($: EngineInterface, line: string): Promise<void> {
  try {
    const path = `${await home($)}/.claude/mm-hooks/bridge-notices.log`
    let had = ''
    try {
      had = await $.fs.read(path)
    } catch {
      // a first line
    }
    const lines = `${had}${new Date(await $.clock.now()).toISOString()} ${line}\n`.split('\n').filter(Boolean).slice(-500)
    await $.fs.write(path, `${lines.join('\n')}\n`)
  } catch {
    // the log is for audit: its failure stops nothing
  }
}

// ---------------------------------------------------------------- (0.5.11) client threads the bridge updates by itself

/**
 * (0.5.11, Rob 10-15: "I think we should start updating threads automatically") An update sent by itself, on record
 * (`mm.autoupdates`, every session's, the last day's): for which client and what it carried (`sig`, a short hash of
 * the signature, as `mm.autostarts` names it), into which thread (`sid`), by which thread, from which sync (`from`,
 * that sync's time), and whether it went (`ok`: null while it is being sent). ⛔ One on record for a client, a
 * signature and a thread is never sent again, whatever became of it: a send the thread did not take waits for
 * something new for the client.
 */
type AutoUpdate = { at: number; pid: string; client: string; sig: string; sid: string; by: string; ok: boolean | null; reason: string; from?: number }

/** (0.5.11) A session's claim on an update it is about to send (`mm.updating`): whose, until when, and (F1) from which sync. */
type UpdateClaim = { owner?: string; until?: number; from?: number }

/** (0.5.11) The updates this session has claimed and not finished: a second sync does not claim one again. */
const autoUpdating = new Set<string>()
/** (0.5.11) The caps this session has logged, by client and signature: once each, not on every sync. */
const capLogged = new Set<string>()

/** (0.5.11) The updates on record (every session's). */
async function autoUpdatesOf($: EngineInterface): Promise<AutoUpdate[]> {
  const list = await storeGet<AutoUpdate[]>($, 'mm.autoupdates', [])
  return Array.isArray(list) ? list.filter(t => t && typeof t === 'object') : []
}

/**
 * (0.5.11, review of PR #15, F1) The updates that count toward the caps: each one on record that went or is being sent,
 * and each unexpired claim (`mm.updating`) not on record yet, counted from when it was claimed (its lease's start) and
 * from the sync it was chosen from. `except`: the caller's own claim. A burst of claims made before any is on record
 * counts in full, so ten clients due at once are never ten sends.
 */
function countedUpdates(tries: readonly AutoUpdate[], claims: Readonly<Record<string, UpdateClaim>>, now: number, except?: string): Array<{ at: number; from: number | undefined }> {
  const out = tries.filter(t => t.ok !== false).map(t => ({ at: Number(t.at), from: t.from }))
  for (const [k, c] of Object.entries(claims)) {
    if (k === except || !c || typeof c !== 'object' || !(Number(c.until) > now)) continue
    const since = Number(c.until) - UPDATING_MS
    // a claim whose send is on record already is counted there
    if (tries.some(t => `${t.pid}\n${t.sig}` === k && t.by === c.owner && Number(t.at) >= since)) continue
    out.push({ at: since, from: c.from })
  }
  return out
}

/**
 * (0.5.11) The cap one more update would pass, or null: AUTO_UPDATES_PER_HOUR in the last hour, AUTO_UPDATES_PER_DAY in
 * the last day, or (review of PR #15, F1) AUTO_UPDATES_PER_SYNC from the sync it was chosen from (`from`).
 */
function capOf(counted: ReadonlyArray<{ at: number; from: number | undefined }>, now: number, from: number): 'hour' | 'day' | 'sync' | null {
  if (counted.filter(t => now - t.at < 3_600_000).length >= AUTO_UPDATES_PER_HOUR) return 'hour'
  if (counted.filter(t => now - t.at < DAY_MS).length >= AUTO_UPDATES_PER_DAY) return 'day'
  if (counted.filter(t => t.from === from).length >= AUTO_UPDATES_PER_SYNC) return 'sync'
  return null
}

/** (0.5.11) Whether one is on record for this client, signature and thread. */
const triedHere = (list: readonly AutoUpdate[], pid: string, sig: string, sid: string): boolean => list.some(t => t.pid === pid && t.sig === sig && t.sid === sid)

/** (0.5.11) The sync on record each session last chose updates from: each sync is chosen from once in each thread. */
const autoChosen = new Map<string, number>()

/**
 * (0.5.11, review of PR #15, F1) The writes to `mm.autoupdates` this session makes, one after another: a record pushed
 * while another is being settled is never lost to it within the session.
 */
let autoRecords: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = autoRecords.then(work, work)
  autoRecords = run.catch(() => {})
  return run
}

/**
 * (0.5.11, review of PR #15, F3) What this bridge has seen of each client on the person's own list, brought up to the
 * sync on record (`seenNow`): since when it has had exactly what it has now, and since when its mail has waited. A
 * client off the list is forgotten. Written only when something changed.
 */
async function recordSeen($: EngineInterface, last: Last): Promise<Record<string, FirstSeen>> {
  return patchStore<Record<string, FirstSeen>>($, 'mm.firstSeen', {}, all => {
    const before = JSON.stringify(all)
    const on = new Set<string>()
    for (const it of last.items) {
      if (!isUuid(it.projectId)) continue
      on.add(it.projectId)
      const prev = all[it.projectId]
      all[it.projectId] = seenNow(prev && typeof prev === 'object' ? prev : undefined, it, sigHash(signatureOf(it)), last.at)
    }
    for (const pid of Object.keys(all)) if (!on.has(pid)) delete all[pid]
    return JSON.stringify(all) !== before
  })
}

/** (0.5.11, review of PR #15, F3) What this bridge has seen of a client, when it is what the client has now (`signature`). */
const seenOf = (seen: Readonly<Record<string, FirstSeen>>, pid: string, signature: string): FirstSeen | undefined => {
  const s = seen[pid]
  return s && typeof s === 'object' && s.sig === sigHash(signature) ? s : undefined
}

/**
 * (0.5.11, review of PR #15, F4) Whether the time tracking on this computer counts a turn the bridge starts in another
 * thread as automatic, never as the person's: the Massmarket hook (`~/.claude/mm-hooks/worklog-hook.js`) from 0.11.5
 * on does, by the app's `peer` stamp and by the marker at the very start of the text (`TURN_ORIGIN_MARKER_RE`); 0.11.4
 * and before count every turn as the person's. Read from the hook's own text, the only place it says what it is (it
 * writes its version nowhere else on the computer). ⛔ A hook that cannot be read, or one without that rule: no update
 * is sent by itself on this computer. Read again at most every HOOK_CHECK_MS.
 */
let hookChecked: { at: number; ok: boolean; why: string } | null = null
async function hookCountsAuto($: EngineInterface, now: number): Promise<{ ok: boolean; why: string }> {
  if (hookChecked && now - hookChecked.at < HOOK_CHECK_MS) return hookChecked
  let ok = false
  let why: string
  try {
    const text = await $.fs.read(`${await home($)}/.claude/mm-hooks/worklog-hook.js`)
    ok = text.includes('TURN_ORIGIN_MARKER_RE')
    why = ok ? 'the time-tracking hook counts it as automatic' : 'the time-tracking hook on this computer is older than 0.11.5 and would count it as the person\'s time'
  } catch {
    why = 'the time-tracking hook on this computer could not be read'
  }
  hookChecked = { at: now, ok, why }
  return hookChecked
}

/**
 * (0.5.11, review of PR #15, F3) The package a thread was asked to build by itself (kickoff case 6, `Sent.prep`) is
 * there now: it is that thread's own work, recorded as what the thread has, and nothing is sent. Written over the
 * store's fresh copy, only while it still says what this pass read (once, whichever thread gets there first).
 */
async function ownWork($: EngineInterface, it: QueueItem, sid: string, signature: string, given: Sent, now: number): Promise<void> {
  const pid = it.projectId
  let mine = false
  await patchStore<Record<string, Sent>>($, 'mm.sent', {}, all => {
    const had = all[pid]
    if (!had?.prep || had.sid !== sid || had.sig !== given.sig) return false
    delete all[pid]
    all[pid] = { sid, sig: signature, at: now }
    capped(all)
    mine = true
  })
  if (!mine) return
  sentHere.set(`${pid}\n${sid}`, signature)
  await logAuto($, `not updated ${cleanName(it.client)} (${pid}) sig ${sigHash(signature)} in ${sid}: its package is the thread's own work (it was asked to build it)`)
}

/**
 * (0.5.11, Rob 10-15) Once for each sync on record, in every running thread, while auto is on (`/mm auto`, the switch
 * auto-start has): each client on the person's OWN list (the Needs-you list: never a client under With a teammate,
 * Older or Checking your reply) whose row says Update, on its linked thread (never a thread its row only suggests),
 * once it is time (`autoUpdateDue`, from what this bridge has seen, `mm.firstSeen`), and never one a teammate has, whose
 * package someone else holds, or that is still open after our reply (`autoUpdatable`). From what is stored only: no
 * feed call and no app call here.
 * ⛔ Never into the thread choosing (the app's send refuses it, and here the message would be a prompt the person
 * did not write): the thread that synced leaves its own client to the other running threads, which choose from the
 * same sync on their next tick. Never into a thread linked to another client, and never what the thread already
 * has (`mm.sent`, `sentHere`); a thread the sync could not see has no row to update (its row carries no thread).
 * (F3) The package a thread was asked to build by itself is its own work (`ownWork`): nothing is sent for it.
 * Each one is claimed (`mm.updating`, a lease per client and signature, as `mm.starting` is) and sent once the claim
 * has held (`autoUpdate`): two threads never both send it. At a cap (the hour's, the day's, or AUTO_UPDATES_PER_SYNC
 * from this sync), nothing more from this sync. (F4) Nothing at all where the time-tracking hook would count it as
 * the person's time (`hookCountsAuto`).
 */
async function autoUpdates($: EngineInterface): Promise<void> {
  if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
  if (!(await autoStartOn($)) || (await $.store.get('mm.paused'))) return
  const me = await knownSelf($)
  if (!me) return
  const now = await $.clock.now()
  const last = await storeGet<Last | null>($, 'mm.last', null)
  // a sync that failed, or one too old to say anything, chooses nothing
  if (!last || last.error || !Array.isArray(last.items) || !Number.isFinite(last.at) || now - last.at > STALE_SYNC_MS) return
  const id = await instanceId($)
  if ((autoChosen.get(id) ?? -Infinity) >= last.at) return
  autoChosen.set(id, last.at)
  const seen = await recordSeen($, last)
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const sent = await storeGet<Record<string, Sent>>($, 'mm.sent', {})
  for (const it of last.items.slice().sort(byDue)) {
    const pid = it.projectId
    const rec = storedRec(last, pid)
    const target = rec?.target
    if (rec?.state !== 'update' || !target || target.suggested || !THREAD_ID.test(target.sid) || !isUuid(pid)) continue
    const sid = target.sid
    // ⛔ its linked thread, no other client's, and not this one
    if (links[pid] !== sid || ownerOf(sid, links) !== pid || sid === me) continue
    if (!autoUpdatable(it, now)) continue
    const signature = signatureOf(it)
    const given = sent[pid]
    if ((given && given.sid === sid && hasWaiting(given.sig, it)) || sentHere.get(`${pid}\n${sid}`) === signature) continue
    if (given && ownPackage(given, sid, it)) {
      await ownWork($, it, sid, signature, given, now)
      continue
    }
    if (!autoUpdateDue(it, now, seenOf(seen, pid, signature))) continue
    const hook = await hookCountsAuto($, now)
    if (!hook.ok) {
      if (!capLogged.has(`hook\n${hook.why}`)) {
        capLogged.add(`hook\n${hook.why}`)
        await logAuto($, `not updated ${cleanName(it.client)} (${pid}) sig ${sigHash(signature)}: no thread is updated by itself on this computer: ${hook.why}`)
      }
      return
    }
    const r = await autoUpdateClaim($, it, sid, signature, me, now, last.at)
    // the rest of this sync's clients wait for the next sync
    if (r === 'sync') return
    if (r !== 'capped') continue
    const key = `${pid}\n${sigHash(signature)}`
    if (!capLogged.has(key)) {
      capLogged.add(key)
      await logAuto($, `not updated ${cleanName(it.client)} (${pid}) sig ${sigHash(signature)}: this computer updated ${AUTO_UPDATES_PER_HOUR} threads in the last hour or ${AUTO_UPDATES_PER_DAY} in the last day`)
    }
    return
  }
}

/**
 * (0.5.11) What becomes of a client's update a thread chose:
 *   skip     it is on record for this thread already, or being sent (here, or by another session: its claim in
 *            `mm.updating`)
 *   capped   this machine updated AUTO_UPDATES_PER_HOUR threads by itself in the last hour, or AUTO_UPDATES_PER_DAY
 *            in the last day, counting the claims not on record yet (F1)
 *   sync     (F1) AUTO_UPDATES_PER_SYNC are claimed or sent from this sync already: the rest wait for the next sync
 *   claimed  claimed here, and sent once the claim has held (`autoUpdate`)
 * ⛔ (Review of PR #15, F1) The caps are asked of the claims and the records as read, and again inside the write that
 * claims, over the store's fresh claims: a burst of due clients is never claimed past a cap.
 */
async function autoUpdateClaim($: EngineInterface, it: QueueItem, sid: string, signature: string, me: string, now: number, from: number): Promise<'skip' | 'capped' | 'sync' | 'claimed'> {
  const pid = it.projectId
  const sig = sigHash(signature)
  const key = `${pid}\n${sig}`
  if (autoUpdating.has(key)) return 'skip'
  const tries = await autoUpdatesOf($)
  if (triedHere(tries, pid, sig, sid)) return 'skip'
  const claims = await storeGet<Record<string, UpdateClaim>>($, 'mm.updating', {})
  const held = claims[key]
  if (held && held.owner !== me && Number(held.until) > now) return 'skip'
  const cap = (c: Readonly<Record<string, UpdateClaim>>): 'capped' | 'sync' | null => {
    const at = capOf(countedUpdates(tries, c, now, key), now, from)
    return at === null ? null : at === 'sync' ? 'sync' : 'capped'
  }
  const before = cap(claims)
  if (before) return before
  let mine = false
  let full: 'capped' | 'sync' | null = null
  await patchStore<Record<string, UpdateClaim>>($, 'mm.updating', {}, fresh => {
    for (const [k, v] of Object.entries(fresh)) if (!v || !(Number(v.until) > now)) delete fresh[k]
    const other = fresh[key]
    if (other && other.owner !== me) return false
    full = cap(fresh)
    if (full) return false
    fresh[key] = { owner: me, until: now + UPDATING_MS, from }
    mine = true
  })
  if (full) return full
  if (!mine) return 'skip'
  autoUpdating.add(key)
  try {
    $.clock.after(settleMs(`${me}#update#${key}`), () => void autoUpdate($, it, sid, signature, me, key, from).finally(() => autoUpdating.delete(key)))
  } catch {
    // no timer here: the claim runs out, and a later sync claims it again
    autoUpdating.delete(key)
    return 'skip'
  }
  return 'claimed'
}

/**
 * (0.5.11, Rob 10-15: "so the draft is ready when I open the thread up") Sends the client's update by itself, once this
 * session's claim has held (another session's write since means that session sends it): what Update sends, in the
 * words for a send no person pressed for (`kickoffText(cur, { update: true, auto: true })`: ⛔ the package is never
 * taken, and the marker comes first), through Update's own send (`sendInto`), after Update's guards, all of them,
 * asked again now: the client's link is still this thread and the thread is no other client's; the app answers for
 * the thread by id, open, and (F5) the person has not used it in the last AUTO_IDLE_MS (else the next sync tries
 * again); the feed is read once before the send (with no feed, nothing goes), and as it has the client NOW, the
 * client is still on the person's own list, still one to update by itself, still due, and still carries what the
 * sync saw (anything newer waits for the next sync); B3 and a newer thread of the client's (`stillTheClients`); and
 * the thread does not already have it. Recorded before the app is asked (`mm.autoupdates`), (F1) with the caps asked
 * again inside that write, over the store's fresh list (a full list: nothing goes), and logged either way
 * (`logAuto`). ⛔ (F2) Right before the send, once the record is written: the client's link, the thread's client
 * and this session's claim are read again, and the record itself must still be there; any of them moved, nothing
 * goes. Sent: what the thread now has, as Update writes it (F3: and, for a thread asked to build the package, that
 * the package is its own work), checked again 1 to 3 seconds later; the band says so once; the list is brought up
 * to date.
 * ⛔ Nothing else Update writes. No stamp and no acted: nobody acted. No claim: a send is never evidence (R11), so a
 * link the bridge made stays one it can let go. No link and no unlink record: the thread was the client's linked
 * thread before the send, and a move or an unlink made meanwhile is the person's and stands. No thread is opened.
 */
async function autoUpdate($: EngineInterface, it: QueueItem, sid: string, signature: string, me: string, key: string, from: number): Promise<void> {
  const pid = it.projectId
  const sig = sigHash(signature)
  const client = cleanName(it.client)
  let entry: AutoUpdate | null = null
  /** The record as this send wrote it, in a list. */
  const isMine = (t: AutoUpdate, mine: AutoUpdate): boolean => t && t.pid === pid && t.sig === sig && t.sid === sid && t.at === mine.at && t.by === me
  /** The record's outcome, written over a fresh copy. */
  const settle = async (ok: boolean, why: string): Promise<void> => {
    const mine = entry
    if (!mine) return
    mine.ok = ok
    await oneAtATime(() =>
      patchStore<AutoUpdate[]>($, 'mm.autoupdates', [], list => {
        const e = list.find(t => isMine(t, mine))
        if (!e) return false
        e.ok = ok
        if (!ok) e.reason = `${e.reason}; not sent: ${short(why, 160)}`
      }),
    ).catch(() => {})
  }
  const claimOf = async (): Promise<string | undefined> => (await storeGet<Record<string, UpdateClaim>>($, 'mm.updating', {}))[key]?.owner
  try {
    if ((await claimOf()) !== me) return
    if (!(await autoStartOn($)) || (await $.store.get('mm.paused'))) return
    if (sid === (await knownSelf($))) return
    const now = await $.clock.now()
    // checked again, now that the claim has held
    const tries = await autoUpdatesOf($)
    if (triedHere(tries, pid, sig, sid) || capOf(countedUpdates(tries, await storeGet<Record<string, UpdateClaim>>($, 'mm.updating', {}), now, key), now, from)) return
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    if (links[pid] !== sid || ownerOf(sid, links) !== pid) return
    const found = await lookup($, sid)
    if (found === 'gone' || found === 'unknown' || found.isArchived) return
    // ⛔ (review of PR #15, F5) the person used the thread in the last AUTO_IDLE_MS: not now. Nothing is on record, so
    // the next sync tries again.
    const active = found.lastActivityAt ? Date.parse(found.lastActivityAt) : NaN
    if (Number.isFinite(active) && now - active < AUTO_IDLE_MS) return
    let read: Feed
    try {
      read = await fetchFeed($)
    } catch {
      return
    }
    const cur = buildLists(read, now).queue.find(i => i.projectId === pid)
    if (!cur || !autoUpdatable(cur, now) || signatureOf(cur) !== signature) return
    if (!autoUpdateDue(cur, now, seenOf(await storeGet<Record<string, FirstSeen>>($, 'mm.firstSeen', {}), pid, signature))) return
    if (!(await stillTheClients($, pid, { sid, title: found.title ?? '', suggested: false }, sid, links, read, { live: new Map([[sid, found]]) }))) return
    const given = (await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[pid]
    if ((given && given.sid === sid && hasWaiting(given.sig, cur)) || sentHere.get(`${pid}\n${sid}`) === signature) return
    // one message to a client at a time: a press sending to it now has it
    if (sending.has(pid)) return
    const made: AutoUpdate = { at: now, pid, client, sig, sid, by: me, ok: null, reason: `something new for the client: ${short(waitingText(cur), 120)}`, from }
    // ⛔ (F1) recorded over the store's fresh list, the caps asked again there: a list that is full refuses it
    let full: string | null = null
    await oneAtATime(() =>
      patchStore<AutoUpdate[]>($, 'mm.autoupdates', [], list => {
        if (triedHere(list, pid, sig, sid)) {
          full = 'it is on record already'
          return false
        }
        const at = capOf(countedUpdates(list, {}, now), now, from)
        if (at) {
          full = at === 'sync' ? `${AUTO_UPDATES_PER_SYNC} updated from this sync already` : `this computer updated ${AUTO_UPDATES_PER_HOUR} threads in the last hour or ${AUTO_UPDATES_PER_DAY} in the last day`
          return false
        }
        list.push({ ...made })
        list.splice(0, list.length, ...list.filter(t => t && now - Number(t.at) <= DAY_MS).slice(-200))
      }),
    )
    if (full) {
      if (full !== 'it is on record already') await logAuto($, `not updated ${client} (${pid}) sig ${sig} in ${sid}: ${full}`)
      return
    }
    entry = made
    // ⛔ (F2) read again right before the send: the record is still there (no other write took it), the client's
    // link is still this thread and the thread no other client's, and the claim is still this session's
    const moved = !(await autoUpdatesOf($)).some(t => isMine(t, made))
      ? 'its record was not kept'
      : await (async () => {
          const now2 = await storeGet<Record<string, string>>($, 'mm.links', {})
          if (now2[pid] !== sid || ownerOf(sid, now2) !== pid) return 'the thread\'s link changed meanwhile'
          return (await claimOf()) !== me ? 'another thread has it' : null
        })()
    if (moved) {
      await settle(false, moved)
      await logAuto($, `not updated ${client} (${pid}) sig ${sig} in ${sid}: ${moved}`)
      return
    }
    let why: string | null
    try {
      // ⛔ (0.5.11, Opus 10-15) the words for a send no person pressed for: the package is never taken (`auto`)
      const r = await sendInto($, cur.client, pid, false, sid, kickoffText(cur, { update: true, auto: true }), true)
      why = r === null ? null : typeof r === 'object' ? 'a message to this client was already going out' : r
    } catch (err) {
      why = errorText(err)
    }
    await settle(why === null, why ?? '')
    await logAuto($, `${why === null ? 'updated' : 'not updated'} ${client} (${pid}) sig ${sig} in ${sid}: ${made.reason}${why === null ? '' : `; ${short(why, 160)}`}`)
    if (why !== null) return
    const at = await $.clock.now()
    sentHere.set(`${pid}\n${sid}`, signature)
    // (F3) a thread asked to build the client's package: the package that then appears is its own work
    const has: Sent = { sid, sig: signature, at, ...(asksForPrep(cur) ? { prep: true as const } : {}) }
    try {
      await putSent($, pid, has)
    } catch (err) {
      await noteFailure($, 'auto update: what the thread now has', err)
    }
    settleLater($, `${sid}#auto`, async () => {
      if (!(await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[pid]) await putSent($, pid, has)
    })
    await bandNote($, `Updated ${client}'s thread.`, `updated\n${key}`)
    await refreshList($).catch(err => noteFailure($, 'auto update: the sync after it', err))
  } catch (err) {
    await noteFailure($, 'auto update', err)
    if (entry?.ok === null) await settle(false, errorText(err))
  } finally {
    await patchStore<Record<string, UpdateClaim>>($, 'mm.updating', {}, fresh => {
      if (fresh[key]?.owner !== me) return false
      delete fresh[key]
    }).catch(() => {})
  }
}

/**
 * A chip the app made, on record. A chip shows in the thread that minted it only, and only that thread can
 * withdraw it, so the record says which (R5). It supersedes THIS thread's own earlier chips for the client:
 * every running thread keeps its own copy (R5), so another thread's is never touched.
 * ⛔ The chip's record FIRST, then the rest, each on its own: a write the engine refuses is noted where the
 * bridge's errors go and written again by the check 1 to 3 seconds later (review of 79cbc596, F2). The chip
 * is there either way; with no record its thread links like one started by hand.
 * ⛔ This session remembers the chip (`mintedHere`) ONLY while its record is not written: once the record is
 * there, it alone says whether the chip is still waiting (re-review of a446f5ab, M1).
 */
async function recordChip($: EngineInterface, m: MintSpec, answer: string): Promise<void> {
  const { it, me, now, signature } = m
  const minted = `${it.projectId}\n${me}\n${signature}`
  const taskId = /\btask_id:\s*(task_[A-Za-z0-9]{1,40})/.exec(answer)?.[1] ?? /\b(task_[0-9a-f]{6,40})\b/.exec(answer)?.[1] ?? ''
  const had = (await storeGet<Record<string, string>>($, 'mm.links', {}).catch(() => ({}) as Record<string, string>))[it.projectId]
  const chip: Chip = {
    projectId: it.projectId, signature, taskId, threadId: me, at: now, prompt: m.prompt,
    ...(had ? { had } : {}), ...(m.auto ? { auto: true as const, gen: CHIP_GEN } : {}), ...(m.need !== 'start' ? { need: m.need } : {}),
    ...(m.place ? { place: m.place } : {}),
  }
  const key = chipKey(chip)
  // this thread's own earlier chips for the client are superseded, in this session's own record too
  for (const [k, c] of ownChips) if (c.threadId === me && c.projectId === it.projectId) ownChips.set(k, { ...c, superseded: true })
  ownChips.set(key, chip)
  const record = () =>
    patchChips($, now, chips => {
      for (const c of chips) if (c.projectId === it.projectId && c.threadId === me) c.superseded = true
      return [...chips, chip]
    })
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `start: ${what}`, err)
    }
  }
  let recorded = false
  await step('the chip record', async () => {
    await record()
    recorded = true
  })
  if (!recorded) mintedHere.add(minted)
  // The person asked for this client: a pin they took off its thread may come back. (A chip the thread minted
  // by itself is nobody's act.)
  if (!m.auto) await step('the pin coming back', () => pinAgain($, had))
  // Fix round 1, F4: ALWAYS checked again 1 to 3 seconds later (a dozen threads that mint together can take
  // each other's writes away): this thread's records missing then are written back, all in one write.
  scheduleOwnCheck($, me)
}

/** F4: the threads whose check of their own chip records is waiting in this session. */
const ownCheck = new Set<string>()

/**
 * Fix round 1, F4: 1 to 3 seconds on (spread by the thread's id and the round), this thread's own chip records
 * the store lost are written back, as this session knows them, in ONE write (a thread's chips never race each
 * other); and when it wrote any, it looks again on a later round, up to five, until none is missing. Not a
 * record this thread withdrew (it is no longer its own), and not one whose client has since moved to another
 * thread (the tick withdraws that one). A spent record is never missing: spending marks it superseded.
 */
function scheduleOwnCheck($: EngineInterface, me: string, round = 0): void {
  if (!me || (round === 0 && ownCheck.has(me))) return
  ownCheck.add(me)
  const check = async (): Promise<void> => {
    ownCheck.delete(me)
    const now = await $.clock.now()
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    const chips = await chipsOf($, now)
    const own = [...ownChips.values()].filter(c => c.threadId === me)
    for (const c of own) if (chips.some(s => sameChip(s, c))) mintedHere.delete(`${c.projectId}\n${me}\n${c.signature}`)
    const lost = own.filter(c => !chips.some(s => sameChip(s, c)) && (links[c.projectId] === undefined || links[c.projectId] === c.had))
    if (!lost.length) return
    try {
      await patchChips($, now, fresh => {
        const add = lost.filter(c => !fresh.some(f => sameChip(f, c)))
        return add.length ? [...fresh, ...add] : false
      })
    } catch (err) {
      await noteFailure($, 'start: the chip record, again', err)
    }
    if (round < 4) scheduleOwnCheck($, me, round + 1)
  }
  try {
    $.clock.after(settleMs(round ? `${me}#${round}` : me), () => void check().catch(() => ownCheck.delete(me)))
  } catch {
    ownCheck.delete(me)
  }
}

/**
 * Start thread. (0.5.7) Where the app gives this session `start_session` (the app since 10-14), the client's thread
 * is opened at once with the kickoff as its first message (`startNow`). Where it gives only `spawn_task` (before
 * that), this mints a chip whose prompt is the kickoff, and the person clicks Start on it.
 * `typed` is the person's own /mm start <client>: it always mints. The chip on record for this thread may
 * be one the person dismissed, which the bridge cannot see; the new one supersedes it.
 * R10: the press has already said it is making the chip (`press`); the app is given APP_WAIT_MS to answer.
 */
async function startThread($: EngineInterface, it: QueueItem, pass: Pass, typed: boolean): Promise<string> {
  const now = await $.clock.now()
  const me = await selfId($)
  const signature = signatureOf(it)
  // (0.5.7, Rob 10-14: "can we just straight start sessions now?") Where the app gives this session start_session,
  // Start opens the client's thread at once, with the kickoff a chip would carry. Where it does not, the chip below.
  const openNow = async (): Promise<string | null> => {
    const title = startTitle(it)
    const prompt = startKickoff(it, await replaced($, it, pass), now)
    // (0.5.12) a Start all in another thread, or a start by itself, is starting this client now: not twice
    const key = `${it.projectId}\n${sigHash(signature)}`
    if (!(await claimStart($, it.projectId, key, me, now))) return `${it.client}'s thread is being started from another thread. It will be under Pinned in a moment.`
    let opened: StartedNow
    try {
      opened = await startNow($, title, prompt)
    } finally {
      await releaseStart($, key, me)
    }
    const started = opened
    if (started.ok) {
      await adoptStarted($, it, started.sid, prompt, me, now)
      return `Started ${it.client}'s thread: "${title}". It is under Pinned.`
    }
    // (the app's own sentence, without its last full stop: the line has its own)
    if (started.why !== 'no-tool') return `Could not start ${it.client}'s thread: ${short(started.text).replace(/\.+$/, '')}. Type /mm start ${it.client} to try again.`
    return null
  }
  if ((await sessionTools($)).start) {
    const said = await openNow()
    if (said !== null) return said
  }
  // ⛔ One chip per client in a thread. The button, with a chip for this client carrying this already in this
  //    thread (or one on its way): nothing is minted.
  const before = await chipsOf($, now)
  const minted = `${it.projectId}\n${me}\n${signature}`
  // (F4) this session's own chip the store lost counts as here; one the store holds is judged as the store has it
  const ownLive = [...ownChips.values()].some(c => c.threadId === me && c.projectId === it.projectId && !c.superseded && c.signature === signature && !before.some(s => sameChip(s, c)))
  if (!typed && me && (before.some(c => c.projectId === it.projectId && !c.superseded && c.threadId === me && c.signature === signature) || ownLive || mintedHere.has(minted) || minting.has(minted))) {
    return `A chip for ${it.client} is already here: click Start on it.`
  }
  // A client that already has a thread: the new one is asked to look at how the old one ended (handoverText).
  const prompt = startKickoff(it, await replaced($, it, pass), now)
  // (0.5.6, Rob 10-14: "Start in the thread that I click it on") the client's chip in another thread, moved here
  const elsewhere = before.filter(c => c.projectId === it.projectId && !c.superseded && c.threadId !== me)
  const made = await mintChip($, { it, signature, need: 'start', auto: false, title: startTitle(it), tldr: startTldr(it, now), prompt, me, now })
  // (0.5.7) the app no longer gives this session spawn_task: Start opens the thread
  if (!made.made && made.why === 'no-tool') return (await openNow()) ?? `Could not create the chip: ${short(made.text)}`
  if (!made.made) return made.why === 'no-answer' ? NO_ANSWER(it.client) : `Could not create the chip: ${short(made.text)}`
  // (0.5.6) where it is, as the band and the other threads' rows name it: asked for after the answer, never before it
  void placeChip($, me, it.projectId, now).catch(() => {})
  if (!elsewhere.length) return `A chip for ${it.client} is ready here: click Start on it.`
  // Only once the one here is made: the other is superseded, and the thread it is in withdraws it on its next
  // chips pass (a chip can be withdrawn only by the thread that minted it).
  await patchChips($, now, fresh => {
    for (const f of fresh) if (elsewhere.some(c => sameChip(c, f))) f.superseded = true
    return fresh
  }).catch(err => noteFailure($, 'start: the chip moved here', err))
  // its thread's name: as the pass saw it, as the chip was minted with, else as the app says it now
  const from = elsewhere.at(-1) as Chip
  let title = cleanTitle(pass.live.get(from.threadId)?.title ?? '') || from.place || ''
  if (!title) {
    const found = await lookup($, from.threadId)
    title = typeof found === 'object' ? cleanTitle(found.title ?? '') : ''
  }
  return `A chip for ${it.client} is ready here: click Start on it. The one in "${title || 'another thread'}" is withdrawn.`
}

/** (0.5.6) A chip the person made here, given the name of the thread it is in once the app says it (`ownPlace`). */
async function placeChip($: EngineInterface, me: string, projectId: string, at: number): Promise<void> {
  const place = await ownPlace($)
  if (!place) return
  await patchChips($, await $.clock.now(), fresh => {
    const mine = fresh.filter(c => c.threadId === me && c.projectId === projectId && c.at === at && !c.place)
    if (!mine.length) return false
    for (const c of mine) c.place = place
    return fresh
  })
  for (const [k, c] of ownChips) if (c.threadId === me && c.projectId === projectId && c.at === at) ownChips.set(k, { ...c, place })
}

// ---------------------------------------------------------------- (0.5.12) Start all

/**
 * (0.5.12, Rob 10-15: no clicks at all) The clients on the person's own Needs-you list that need a new thread now, as
 * the stored sync has them, soonest due first: the row's one action is Start (`rowButtons`, as the pane draws it) and
 * the client has no linked thread. A client linked to a thread that is old keeps its own row's Start: Start all is for
 * clients with no thread of their own.
 */
function needingThreads(last: Last, links: Readonly<Record<string, string>>, now: number): QueueItem[] {
  if (!Array.isArray(last.items)) return []
  return last.items
    .filter(it => {
      const rec = storedRec(last, it.projectId)
      if (!rec || rec.state !== 'start' || !isUuid(it.projectId) || links[it.projectId] !== undefined) return false
      return rowButtons(rowFor(it, rec, now, { needsYou: true }))[0] === 'start'
    })
    .sort(byDue)
}

/**
 * (0.5.12) How many clients the Start all button offers, or 0 when it is not drawn: two or more that need a new thread
 * (with one, its row's own Start is the button), or one left over by a press that stopped at START_ALL_MAX (the band
 * said so, and the button stays for the second press while that line shows). From what is stored only.
 */
async function startAllOffer($: EngineInterface): Promise<number> {
  const last = await storeGet<Last | null>($, 'mm.last', null)
  if (!last || !Array.isArray(last.items) || !(await sessionTools($)).start) return 0
  const now = await $.clock.now()
  const n = needingThreads(last, await storeGet<Record<string, string>>($, 'mm.links', {}), now).length
  if (n >= 2) return n
  const left = await storeGet<{ at?: number } | null>($, 'mm.startAllLeft', null)
  return n === 1 && left && now - Number(left.at) < NOTE_SHOW_MS ? 1 : 0
}

/** (0.5.12) A Start all running in this session: a second press, or /mm start all, does nothing meanwhile. */
let startingAll = false

/**
 * (0.5.12) A start claimed for a client (`mm.starting`, a lease per client and signature, as the thread started by itself
 * claims it): false when another press or thread holds an unexpired claim for the client, whatever it carries. Over the
 * store's fresh copy.
 */
async function claimStart($: EngineInterface, pid: string, key: string, me: string, now: number): Promise<boolean> {
  let mine = false
  await patchStore<Record<string, { owner?: string; until?: number }>>($, 'mm.starting', {}, fresh => {
    for (const [k, v] of Object.entries(fresh)) if (!v || !(Number(v.until) > now)) delete fresh[k]
    if (Object.entries(fresh).some(([k, v]) => k.startsWith(`${pid}\n`) && v?.owner !== me)) return false
    fresh[key] = { owner: me, until: now + STARTING_MS }
    mine = true
  })
  return mine
}
/** (0.5.12) The claim let go, when it is still this session's. */
async function releaseStart($: EngineInterface, key: string, me: string): Promise<void> {
  await patchStore<Record<string, { owner?: string }>>($, 'mm.starting', {}, fresh => {
    if (fresh[key]?.owner !== me) return false
    delete fresh[key]
  }).catch(() => {})
}

/** (0.5.12) What one client's turn in a Start all came to. */
type StartAllOne = { done: 'started' } | { done: 'failed'; why: string } | { done: 'skipped'; why: string }

/**
 * (0.5.12) One client's thread, in a Start all: ⛔ checked again just before it runs, and skipped if the client has a
 * live linked thread now (a thread linked meanwhile, by a person, a marker or a sync; one the app says is gone does not
 * count), a press on its own row is in flight, or another press or thread is starting it (`mm.starting`). Then claimed
 * and held as a row's press holds it (its row's Start does nothing meanwhile), started as a single Start starts a
 * thread (`startNow`, user_asked, the person's press) with its kickoff in the words that never take the package
 * (`startAllKickoff`), and recorded and linked as a single Start does (`adoptStarted`: what the thread has, the link, the
 * claim and the stamp; the sync after it pins and names it). Logged either way.
 */
async function startOneOfAll($: EngineInterface, it: QueueItem, pass: Pass, me: string): Promise<StartAllOne> {
  const pid = it.projectId
  if (pressing.has(pid)) return { done: 'skipped', why: 'its own Start is running' }
  const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[pid]
  if (linked !== undefined && (await lookup($, linked)) !== 'gone') return { done: 'skipped', why: 'it has a thread now' }
  const now = await $.clock.now()
  const key = `${pid}\n${sigHash(signatureOf(it))}`
  if (!(await claimStart($, pid, key, me, now))) return { done: 'skipped', why: 'another thread is starting it' }
  const hold = ++pressCount
  pressing.set(pid, hold)
  try {
    const title = startTitle(it)
    const prompt = startAllKickoff(it, await replaced($, it, pass), now)
    const answer = await startNow($, title, prompt)
    const client = cleanName(it.client)
    await logAuto($, `${answer.ok ? 'started' : 'not started'} ${client} (${pid}) sig ${sigHash(signatureOf(it))}: Start all, pressed${answer.ok ? '' : `; ${short(answer.text, 160)}`}`)
    if (!answer.ok) return { done: 'failed', why: short(answer.text).replace(/\.+$/, '') }
    await adoptStarted($, it, answer.sid, prompt, me, now)
    return { done: 'started' }
  } finally {
    if (pressing.get(pid) === hold) pressing.delete(pid)
    await releaseStart($, key, me)
  }
}

/**
 * (0.5.12, Rob 10-15: "no clicks at all") Start all: the person's one press (the band's or the pane's Start all button)
 * or their typed /mm start all opens a thread for each client that needs one (`needingThreads`), one after another,
 * never two at once, at most START_ALL_MAX for a press (the rest wait for a second press; the band says how many),
 * each one checked again just before it runs (`startOneOfAll`). One line says what it came to (`startAllSummary`), in
 * the band of every thread and above the list. ⛔ Only from the person's press or command: never from a timer, a sync,
 * the tool or another session. Nothing it does starts anything by itself later.
 */
async function startAll($: EngineInterface): Promise<string> {
  if (startingAll) return 'Start all is already running.'
  startingAll = true
  try {
    if (!(await sessionTools($)).start) return 'Start all needs the app\'s start_session, which this thread does not have: press Start thread on each row.'
    const me = await selfId($)
    let last = await storeGet<Last | null>($, 'mm.last', null)
    const at = await $.clock.now()
    if (!last || last.error || !Array.isArray(last.items) || !Number.isFinite(last.at) || at - last.at > STALE_SYNC_MS) last = await sync($)
    const want = needingThreads(last, await storeGet<Record<string, string>>($, 'mm.links', {}), at)
    if (!want.length) return startAllSummary([], [], [], 0)
    const pass: Pass = { last, live: new Map(), pairs: {}, listed: true, unseen: new Set(), stored: true }
    const started: string[] = []
    const failed: Array<{ client: string; why: string }> = []
    const skipped: Array<{ client: string; why: string }> = []
    let reached = 0
    // one after another: each start is answered before the next is asked for
    for (const it of want) {
      if (started.length + failed.length >= START_ALL_MAX) break
      reached++
      const client = cleanName(it.client)
      const one = await startOneOfAll($, it, pass, me)
      if (one.done === 'started') started.push(client)
      else if (one.done === 'failed') failed.push({ client, why: one.why })
      else skipped.push({ client, why: one.why })
    }
    const left = want.length - reached
    await patchStore<{ at?: number }>($, 'mm.startAllLeft', {}, fresh => {
      if (left > 0) fresh.at = at
      else if (fresh.at === undefined) return false
      else delete fresh.at
    }).catch(() => {})
    const line = startAllSummary(started, failed, skipped, left)
    await bandNote($, line, `startall\n${me}\n${at}`)
    return line
  } finally {
    startingAll = false
  }
}

/** (0.5.12) The Start all button, in the band or the pane: the person's press. The line says it is at it first, then what it came to; the list is brought up to date after. */
async function pressStartAll($: EngineInterface): Promise<void> {
  if (startingAll) return
  let said: string
  try {
    await say($, 'Starting the threads that are missing…', false).catch(() => {})
    said = await startAll($)
  } catch (err) {
    said = errorText(err)
  }
  try {
    await say($, said)
    await refreshBand($)
  } catch {
    // the thread went away while the press was in flight
  }
  try {
    await refreshList($)
  } catch (err) {
    await refreshFailed($, `start all: ${errorText(err)}`)
  }
}

/** One chip a thread mints by itself: for a client, a need, and what it carries. `place`: the thread it is in, as the band names it. */
type Need = {
  it: QueueItem
  signature: string
  need: 'start' | 'here'
  title: string
  tldr: string
  prompt: string
  place?: string | undefined
  /** (0.5.7) For whom: a client with no thread (C3), or its kickoff run in its own thread. (0.5.11: never a new thread for a thread's length.) */
  kind: 'nothread' | 'here'
}

/** (0.5.4) What one thread knows, from the store, to decide which chips are its own to hold. */
type ChipWorld = {
  me: string
  links: Readonly<Record<string, string>>
  titles: Readonly<Record<string, string>>
  claims: Readonly<Record<string, ClaimedHere>>
  sent: Readonly<Record<string, Sent>>
  chips: readonly Chip[]
  seen: Readonly<Seen>
  /** The thread that polls (holds the lease), when it is known: a tie between threads goes to it. */
  poller: string
}

/**
 * (0.5.4, C1-C3: Rob, 10-14, "yes chips"; this replaces R5's chip in every running thread) The chips THIS thread
 * mints by itself, from the last sync on record (no feed call), at most AUTO_CHIPS_MAX, soonest due first. ONE
 * chip per client, in one thread, so the thread that shows it can withdraw it the moment it is used:
 *   a client with a linked thread (C1)  that thread's, and no other's (C2: the band points to it):
 *     here   `Do it here: <what>`, the client's kickoff, to run in this thread (its recommendation is Update, or
 *            Start for a thread that is old)
 *            None when the thread already has what is waiting, or when the client is still open after our reply
 *            (Claim in the pane), or (0.5.3) while the person went on in this thread with a fresh-thread chip
 *            waiting (`claimHolds`). (0.5.11, Rob 10-15: "Can you just automatically compress context at 60%
 *            instead of 100% to save tokens?") No `Start a fresh thread` chip from 60% of a thread's context any
 *            more (R3's and R8's `start` and `long`): Claude Code compacts a long thread instead.
 *   a client with no linked thread (C3)  ONE chip, 0.5.1's start chip, in the thread the person is working in now
 *            (`noThreadHolder`).
 * Never for an internal project (fix round 1, L8), nor a client further out than the pin's window.
 */
function needsFor(last: Last, w: ChipWorld, now: number): Need[] {
  const out: Need[] = []
  const items = (Array.isArray(last.items) ? last.items : []).slice().sort(byDue)
  for (const it of items) {
    if (out.length >= AUTO_CHIPS_MAX) break
    if (!isUuid(it.projectId) || !pinsNow(it, now) || it.internal) continue
    const rec = storedRec(last, it.projectId)
    if (!rec) continue
    const signature = signatureOf(it)
    const linked = w.links[it.projectId]
    // A chip the person made (Start thread, /mm start) stands for the client's one chip, and nothing is minted beside
    // it: for a client with no thread, wherever it is; in this thread, always; and (0.5.6: Start moves the chip to the
    // thread it is pressed in) in another thread while it carries what is waiting now. The bridge cannot see a chip the
    // person dismissed, so one for something older never holds back the client's own thread once something new comes.
    if (w.chips.some(c => c.projectId === it.projectId && !c.auto && !c.superseded && (linked === undefined || c.threadId === w.me || c.signature === signature))) continue
    if (linked === undefined) {
      // C3: a client with no linked thread, when its recommendation is a new thread
      if (rec.state !== 'start' || noThreadHolder(it.projectId, w, now) !== w.me) continue
      const target = rec.target && !rec.target.suggested && THREAD_ID.test(rec.target.sid) ? rec.target : undefined
      const replaces = target ? { sid: target.sid, title: w.titles[target.sid] || target.title } : undefined
      out.push({ it, signature, need: 'start', title: startTitle(it), tldr: startTldr(it, now), prompt: startKickoff(it, replaces, now), kind: 'nothread' })
      continue
    }
    // C1: only the client's own thread; C2: every other thread mints nothing for it
    if (linked !== w.me) continue
    if (claimHolds(w.claims[it.projectId], it.projectId, w.links, last)) continue
    const fast = fastState(it, now)
    const place = cleanName(it.client)
    // still open after our reply: Claim in this thread, in the pane
    if (fast?.state === 'still_open') continue
    // the thread already has what is waiting
    if (rec.state === 'current') continue
    const given = w.sent[it.projectId]
    if (given && given.sid === w.me && hasWaiting(given.sig, it)) continue
    out.push({ it, signature, need: 'here', title: hereTitle(it), tldr: hereTldr(it, now), prompt: kickoffText(it), place, kind: 'here' })
  }
  return out
}

/**
 * (0.5.4, C3) The thread that holds a no-thread client's chip: the thread the person is working in now (the
 * running thread whose last prompt from the person is newest; a tie goes to the lowest id). Where the person has
 * written in no running thread yet, the thread that polls (so that threads that start together do not each mint
 * one). The thread that has the chip keeps it until the person has worked in another thread for HANDOVER_MS
 * without using it (counted from the later of their last prompt there and the chip's minting), or stops running;
 * then it withdraws it, and the thread they work in mints it.
 */
function noThreadHolder(projectId: string, w: ChipWorld, now: number): string {
  const running = (sid: string): boolean => sid === w.me || now - (Number(w.seen[sid]?.tick) || -Infinity) <= ALIVE_MS
  const human = (sid: string): number => Number(w.seen[sid]?.human) || 0
  const runningIds = [...new Set([w.me, ...Object.keys(w.seen)])].filter(sid => THREAD_ID.test(sid) && running(sid)).sort()
  let best = ''
  for (const sid of runningIds) if (human(sid) > 0 && (!best || human(sid) > human(best))) best = sid
  // the client's chips of this version's, on record (threads that start together may each have minted one)
  const live = w.chips.filter(c => c.projectId === projectId && c.auto && c.gen === CHIP_GEN && !c.superseded && c.had === undefined && (c.need ?? 'start') === 'start')
  // Nobody has written in a running thread yet: the thread that polls; else, the record itself says, the lowest
  // thread that holds one (every thread reads the same record); else the lowest running thread.
  if (!best) return w.poller || live.map(c => c.threadId).sort()[0] || runningIds[0] || w.me
  const held = live.find(c => c.threadId === best) ?? live.at(-1)
  if (!held || held.threadId === best || !running(held.threadId)) return best
  // (a thread the person never wrote in holds it only until they write in one)
  const there = human(held.threadId)
  const since = there > 0 ? Math.max(there, held.at) : 0
  return now - since < HANDOVER_MS || human(best) <= since ? held.threadId : best
}

/**
 * R5: this thread's own chips, on its tick (and, R10, at the start of its next turn when the app did not
 * answer one outside a turn): the ones no longer wanted withdrawn, then the missing ones minted. Only from a
 * sync on record that is fresh and did not fail: a stale list neither mints nor withdraws for a need.
 * ⛔ Mints nothing while the bridge is paused, in a thread that does not know its own id, or (R10) while a mint
 * the app did not answer, or refused, is less than MINT_PAUSE_MS old.
 */
async function chipsTick($: EngineInterface, atTurn = false): Promise<void> {
  const me = await knownSelf($)
  if (!me || (await $.store.get('mm.paused'))) return
  const now = await $.clock.now()
  const needs = await storedNeeds($, now)
  await withdrawChips($, needs)
  const id = await instanceId($)
  if (!needs || (!atTurn && now < (mintPause.get(id)?.until ?? 0))) return
  const chips = await ownChipsWritten($, me, now)
  const tools = await sessionTools($)
  const auto = await autoStartOn($)
  /** (C3) this thread's own name, as the band gives it, asked for once and only when a no-thread client's chip is to be minted here */
  let place: string | undefined
  for (const n of needs) {
    const key = `${n.it.projectId}\n${me}\n${n.signature}`
    if (minting.has(key) || mintedHere.has(key)) continue
    if (chips.some(c => c.threadId === me && c.projectId === n.it.projectId && sameNeed(c, n))) continue
    // (0.5.7) where the app gives only start_session, a client's kickoff run in its own thread has no card: the pane's
    // Update does it there
    if (n.kind === 'here' && !tools.spawn) continue
    // (0.5.7, Rob 10-14) a new thread, for a client with none: started by itself, within the hourly and daily caps;
    // past them, or where the app refused it, the card below
    if (n.kind !== 'here' && tools.start && auto) {
      const verdict = await autoVerdict($, n, me, now)
      if (verdict === 'start' || verdict === 'skip') continue
      if (verdict === 'capped') await bandNote($, `${cleanName(n.it.client)}: started threads paused for this hour; its card is ready to start.`, `capped\n${n.it.projectId}\n${sigHash(n.signature)}`)
    }
    if (n.place === undefined && place === undefined) place = await ownPlace($)
    const made = await mintChip($, { ...n, auto: true, me, now, place: n.place ?? place })
    if (made.made) continue
    mintPause.set(id, { until: now + MINT_PAUSE_MS, atTurn: made.why === 'no-answer' })
    await noteFailure($, 'auto chip', made.why === 'no-answer' ? `the app did not answer in ${APP_WAIT_MS / 1000} s` : made.text)
    return
  }
}

/**
 * Whether a chip on record is the one a need asks for: the same client, what it carries, what it is for, a chip
 * of this version's (C6: a chip 0.5.3 minted by itself is not), and not superseded.
 */
const sameNeed = (c: Chip, n: Need): boolean => !c.superseded && c.gen === CHIP_GEN && c.projectId === n.it.projectId && c.signature === n.signature && (c.need ?? 'start') === n.need

/** The chips this thread is to hold now, from the sync on record when it is fresh and did not fail (null otherwise): store reads only. */
async function storedNeeds($: EngineInterface, now: number): Promise<Need[] | null> {
  const me = await knownSelf($)
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const fresh = Boolean(last && Array.isArray(last.items) && !last.error && Number.isFinite(last.at) && now - last.at <= STALE_SYNC_MS)
  if (!me || !fresh || !last) return null
  const lease = await storeGet<{ owner?: string } | null>($, 'mm.lease', null)
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  // (a lease that has run out names nobody: its holder has stopped ticking)
  const poller = lease && typeof lease.owner === 'string' && !(Number((lease as { until?: unknown }).until) < now) ? (pairs[lease.owner]?.app ?? '') : ''
  const chips = await chipsOf($, now)
  return needsFor(
    last,
    {
      me,
      links: await storeGet<Record<string, string>>($, 'mm.links', {}),
      titles: await storeGet<Record<string, string>>($, 'mm.titles', {}),
      claims: await storeGet<Record<string, ClaimedHere>>($, 'mm.claimedHere', {}),
      sent: await storeGet<Record<string, Sent>>($, 'mm.sent', {}),
      chips,
      seen: await storeGet<Seen>($, 'mm.seen', {}),
      poller,
    },
    now,
  )
}

/** (0.5.4, C3) This thread's own name as the band gives it (`threadTitleShort`), from the app; '' when it does not answer. */
async function ownPlace($: EngineInterface): Promise<string> {
  const me = await desktopOnly(async () => (await mcpJsonWithin($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })) as AppThread | null, null)
  return me?.title ? threadTitleShort(me.title) : ''
}

/**
 * (0.5.4, C3) This thread says it is running (its tick) and, for a prompt of the person's own, that they are
 * working in it now. Its own entry only, over a fresh copy; entries a day old go.
 */
async function noteSeen($: EngineInterface, human: boolean): Promise<void> {
  const me = await knownSelf($)
  if (!me) return
  const now = await $.clock.now()
  const mine = (await storeGet<Seen>($, 'mm.seen', {}))[me]
  // (the tick's word is needed only every couple of minutes: ALIVE_MS is five)
  if (!human && mine && now - mine.tick < ALIVE_MS / 2) return
  await patchStore<Seen>($, 'mm.seen', {}, seen => {
    const was = seen[me]
    seen[me] = { tick: now, ...(human ? { human: now } : was?.human ? { human: was.human } : {}) }
    for (const [sid, s] of Object.entries(seen)) if (!s || !(now - Number(s.tick) <= DAY_MS)) delete seen[sid]
  })
}

/**
 * (0.5.3, Rob 10-14: "how long it takes for that chip to close in the other threads... anything we can do to speed
 * up") Every CHIPS_PASS_MS, this thread withdraws its own chips that are no longer wanted, from what is stored:
 * no feed call, and nothing minted. Minting and the feed stay on the minute's tick.
 */
async function chipsPass($: EngineInterface): Promise<void> {
  try {
    if ((await $.env.get('CLAUDE_CODE_ENTRYPOINT')) !== 'claude-desktop') return
    // (0.5.4) a band and a list drawn from an older sync than the store holds: drawn again from it
    await catchUp($)
    if (!(await knownSelf($)) || (await $.store.get('mm.paused'))) return
    await withdrawChips($, await storedNeeds($, await $.clock.now()), true)
    // (0.5.4, C2/C3) the band says where each client's chip is: drawn again from the store, as chips come and go
    await refreshBand($)
  } catch {
    // the minute's tick withdraws it
  }
}

/**
 * (0.5.3) The person wrote in the thread linked to a client while a chip for a new thread to replace that thread
 * was waiting (R3, R8; Rob 10-14: sixteen copies of Crucial Hire's stayed while he went on in its thread): the
 * claim is recorded (`mm.claimedHere`), every thread's chips pass withdraws its own copy, and none is minted again
 * until something newer comes for the client or its link moves (`claimHolds`). This thread withdraws its own now.
 * (0.5.4) The fresh-thread chip is this thread's own now (C1); a `Do it here` chip is never claimed this way.
 * ⛔ The person's own prompt only (PERSON_ORIGINS), never a marker kickoff, and only in a thread that knows its id.
 */
async function claimInPlace($: EngineInterface, text: string, origin: string | undefined): Promise<void> {
  if (!origin || !PERSON_ORIGINS.has(origin) || MARKER.test(promptOf(text).prompt)) return
  const me = await knownSelf($)
  if (!me) return
  const projectId = ownerOf(me, await storeGet<Record<string, string>>($, 'mm.links', {}))
  if (projectId === undefined) return
  const now = await $.clock.now()
  if (!(await chipsOf($, now)).some(c => c.projectId === projectId && !c.superseded && replacesThread(c, me))) return
  const it = listedIn(await storeGet<Last | null>($, 'mm.last', null)).find(i => i.projectId === projectId)
  const newest = { mail: Number(it?.newest?.mail) || 0, pkg: Number(it?.newest?.pkg) || 0, task: Number(it?.newest?.task) || 0 }
  await patchStore<Record<string, ClaimedHere>>($, 'mm.claimedHere', {}, fresh => {
    fresh[projectId] = { sid: me, at: now, newest }
  })
  void chipsPass($)
}

/** After Start: the list is drawn again, so the client's row says where its chip is. Answers what Start said. */
async function started($: EngineInterface, feed: Feed, pass: Pass, said: string): Promise<string> {
  await reconcile($, feed, pass.pairs).catch(() => {})
  return said
}

/** The chips on record: well-formed ones, minted no longer ago than CHIP_KEEP_MS. */
async function chipsOf($: EngineInterface, now: number): Promise<Chip[]> {
  return validChips(await storeGet<unknown>($, 'mm.chips', []), now)
}

function validChips(stored: unknown, now: number): Chip[] {
  if (!Array.isArray(stored)) return []
  return (stored as Array<Partial<Chip> | null>).filter(
    (c): c is Chip =>
      Boolean(c) && typeof c === 'object' && isUuid(c?.projectId) && typeof c?.signature === 'string' && typeof c?.taskId === 'string' && typeof c?.threadId === 'string' && typeof c?.prompt === 'string' && typeof c?.at === 'number' && now - c.at <= CHIP_KEEP_MS,
  )
}

/** One chip told from another: the thread that minted it, its client, its id and when. */
const sameChip = (a: Chip, b: Chip): boolean => a.threadId === b.threadId && a.projectId === b.projectId && a.taskId === b.taskId && a.at === b.at

/**
 * The chips on record, changed by `change` over a fresh copy (patchStore): the chips another thread minted,
 * spent or withdrew meanwhile stay as that thread left them. What is written is well-formed and recent.
 */
async function patchChips($: EngineInterface, now: number, change: (chips: Chip[]) => Chip[] | false): Promise<void> {
  await patchStore<unknown[]>($, 'mm.chips', [], raw => {
    const next = change(validChips(raw, now))
    if (next === false) return false
    raw.splice(0, raw.length, ...next.slice(-CHIPS_MAX))
  })
}

/** A client's live chip: the newest one on record for it that nothing has superseded. */
const liveChip = (chips: readonly Chip[], projectId: string): Chip | undefined => [...chips].reverse().find(c => c.projectId === projectId && !c.superseded)

/**
 * This session withdraws the chips IT minted that are no longer wanted: one a newer chip superseded, one
 * whose client has since been linked to a thread, one whose client no longer needs the person, and (R5) one it
 * minted by itself whose need is gone (`needs`, from a fresh sync; null: not asked). A chip can
 * only be withdrawn from the thread that minted it, so no session touches another's.
 * A withdrawal that fails is tried again on later ticks, DISMISS_TRIES times in all, then forgotten.
 * (0.5.3) Also one for a new thread to replace the client's thread that the person went on in instead, minted
 * before they did (`mm.claimedHere`, while the claim holds).
 * ⛔ From what is stored: no feed call. The one app call is the withdrawal itself.
 * ⛔ One at a time in a thread (the 15-second pass and the minute's tick meet every minute): a chip is withdrawn once.
 */
async function withdrawChips($: EngineInterface, needs: readonly Need[] | null = null, quick = false): Promise<void> {
  const me = await knownSelf($)
  if (!me) return
  const run = (withdrawing.get(me) ?? Promise.resolve()).then(() => withdrawNow($, me, needs, quick))
  const settled = run.catch(() => undefined)
  withdrawing.set(me, settled)
  try {
    await run
  } finally {
    if (withdrawing.get(me) === settled) withdrawing.delete(me)
  }
}

/** (0.5.3) The withdrawal running in each thread of this session, if one is: the next waits for it. */
const withdrawing = new Map<string, Promise<void>>()
/** (0.5.3) The chips this session withdrew (`chipKey`, with when each was minted): a record of one written back is only dropped. */
const withdrawnHere = new Map<string, number>()

/** `quick`: the 15-second pass, which leaves a withdrawal that already failed to the minute's tick (DISMISS_TRIES ticks in all). */
async function withdrawNow($: EngineInterface, me: string, needs: readonly Need[] | null, quick: boolean): Promise<void> {
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  // (fix round 1, F4) this thread's own chips the store lost are still this thread's to withdraw
  const mine = [...chips.filter(c => c.threadId === me), ...[...ownChips.values()].filter(c => c.threadId === me && !chips.some(s => sameChip(s, c)))]
  if (!mine.length) return
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  // With no sync on record there is no saying who still needs the person: no chip is withdrawn for that.
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const waiting = last && Array.isArray(last.items) ? new Set(listedIn(last).map(i => i.projectId)) : null
  const claims = await storeGet<Record<string, ClaimedHere>>($, 'mm.claimedHere', {})
  const forget = new Set<Chip>()
  let changed = false
  for (const [k, at] of withdrawnHere) if (now - at > CHIP_KEEP_MS) withdrawnHere.delete(k)
  for (const c of mine) {
    // (0.5.3) a record of a chip this thread already withdrew, written back by another thread's write that met
    // this one's: it goes from the record, with no second call to the app
    if (withdrawnHere.has(chipKey(c))) {
      changed = true
      forget.add(c)
      continue
    }
    const linked = links[c.projectId]
    const movedOn = linked !== undefined && linked !== c.had
    // (R5) a chip the thread minted by itself is wanted only while its need is (from a fresh sync); (0.5.4, C6) and
    // only when this version minted it: 0.5.3's copies go on the first pass that has a fresh sync
    const needed = !c.auto || !needs || (c.gen === CHIP_GEN && needs.some(n => n.it.projectId === c.projectId && n.signature === c.signature && n.need === (c.need ?? 'start')))
    // (0.5.3) a new thread for a client the person went on with in its own thread, minted before they did
    const claim = claims[c.projectId]
    const spent = claimHolds(claim, c.projectId, links, last) && c.at <= claim.at && replacesThread(c, claim.sid)
    if (!c.superseded && !movedOn && needed && !spent && (!waiting || waiting.has(c.projectId))) continue
    if (quick && (c.tries ?? 0) > 0) continue
    changed = true
    // a chip the app gave no id for cannot be withdrawn: it is only forgotten
    let done = !c.taskId
    if (c.taskId) {
      try {
        const r = (await $.mcp.call('ccd_session', 'dismiss_task', { task_id: c.taskId })) as Mcp
        // an answer that it was already started or dismissed is an answer: only an error is a failure
        done = !r.isError
      } catch {
        done = false
      }
    }
    if (done) {
      forget.add(c)
      withdrawnHere.set(chipKey(c), c.at)
    } else if (!ownChips.has(chipKey(c))) {
      // (0.5.7) a chip this session did not mint (an earlier session of this thread's, as from before the app's
      // update of 10-14, whose dismiss_task may not know its id): one try, then it is only forgotten
      forget.add(c)
    } else {
      c.tries = (c.tries ?? 0) + 1
      if (c.tries >= DISMISS_TRIES) forget.add(c)
      const own = ownChips.get(chipKey(c))
      if (own) ownChips.set(chipKey(c), { ...own, tries: c.tries })
    }
  }
  for (const c of forget) ownChips.delete(chipKey(c))
  if (!changed) return
  // over a fresh copy: another thread may have minted or claimed a chip while this one was calling
  await patchChips($, now, fresh =>
    fresh.filter(f => ![...forget].some(c => sameChip(c, f))).map(f => {
      const tried = mine.find(c => sameChip(c, f))
      return tried?.tries ? { ...f, tries: tried.tries } : f
    }),
  )
}

/**
 * The thread a new one for this client takes over from, when the client has one: its app id, and its own
 * title (the one it had before the bridge first renamed it, when that was stored; else the one it has).
 * Not a thread that only looks like the client by its title.
 */
async function replaced($: EngineInterface, it: QueueItem, pass: Pass): Promise<Replaced | undefined> {
  const target = pass.last.recs[it.projectId]?.target
  if (!target || target.suggested || !THREAD_ID.test(target.sid)) return undefined
  const own = (await storeGet<Record<string, string>>($, 'mm.titles', {}))[target.sid]
  return { sid: target.sid, title: typeof own === 'string' && own ? own : (pass.live.get(target.sid)?.title ?? target.title) }
}

/**
 * Opens a thread in the app: true when the system's opener took the link. On false the caller says where
 * the thread is instead.
 *
 * Why a program is started (checked 2026-10-12, claude-code.d.ts 2.1.293): the plugin API has no other
 * way. A `Link` whose href is not `https:` is drawn as plain text on the desktop surface, so the app's
 * `claude://` link is no anchor there; there is no open-URL call anywhere on `$`; and
 * `ccd_window.open_session_in` takes only this thread, or one this thread started. Rob, 2026-10-12, asked
 * for a button that takes him to the thread.
 *
 * ⛔ ONLY FROM THE PERSON: reached from `showThread` (the Open thread button) and from `updateThread`
 *    after its message went (the Update thread button, a typed /mm update). Never from a timer, a sync,
 *    the band, or Claude's tool.
 * ⛔ ONE COMMAND, and nothing else is ever started here: the platform's own opener (`open`, `rundll32
 *    url.dll,FileProtocolHandler`, `xdg-open`) with the link as its last argument, as an argument array.
 *    No shell, and nothing joined into an argument (`openCommand`).
 * ⛔ ONE LINK: the app's own link for that thread, of exactly the shape `claude://claude.ai/epitaxy/<its
 *    id>`, for a thread the app listed and the row showed (`threadLink`). Never a URL from the feed, a
 *    title or a message.
 * A platform that cannot be told, an opener that is not there, one that does not answer in OPEN_WAIT_MS,
 * or one that exits with an error: false.
 */
async function openThread($: EngineInterface, thread: AppThread | undefined): Promise<boolean> {
  const argv = openCommand(thread, platformOf({ OS: await $.env.get('OS'), HOME: await $.env.get('HOME') }))
  if (!argv) return false
  try {
    return (await $.process.run(argv, { timeoutMs: OPEN_WAIT_MS })).exitCode === 0
  } catch {
    return false
  }
}

/**
 * (S2) Whether another thread has taken the client from a thread its row offered with no link: refused, as the
 * pass before the press refused it in 0.5.0 (Opus, 2026-10-13: "restore the refusal"). By the feed Update has
 * just read, another open thread whose sessions declared that client alone, and that is no other client's,
 * is the client's thread now: one more recently active than the row's thread (each dated as the row's
 * recommendation dates it: the app's last activity, else the feed's), or any at all where the row offered
 * only a title look-alike. (A link moves only through mm.links, which the press has read already.)
 * The app is asked for each such thread by id, at most LOOKUPS_PER_SYNC: local calls, no network.
 */
async function takenOver(
  $: EngineInterface,
  projectId: string,
  target: { sid: string; suggested: boolean },
  links: Readonly<Record<string, string>>,
  rows: readonly FeedThread[],
  pairs: Pairs,
  marked: Readonly<Record<string, string>>,
  shown: AppThread | undefined,
): Promise<boolean> {
  /** The newest the feed has for each thread of the client's: the row's own, and every other. */
  const feedAt = new Map<string, number>()
  for (const t of rows) {
    const sid = t.project_id === projectId ? pairs[t.session_id]?.app : undefined
    if (!sid) continue
    const at = Date.parse(t.last_activity_at)
    feedAt.set(sid, Math.max(feedAt.get(sid) ?? -Infinity, Number.isFinite(at) ? at : -Infinity))
  }
  const dated = (t: AppThread | undefined, sid: string): number => {
    const at = t?.lastActivityAt ? Date.parse(t.lastActivityAt) : NaN
    return Number.isFinite(at) ? at : (feedAt.get(sid) ?? -Infinity)
  }
  const mine = dated(shown, target.sid)
  const others = [...feedAt.keys()].filter(sid => {
    if (sid === target.sid) return false
    const owner = ownerOf(sid, links)
    return (owner === undefined || owner === projectId) && onlyClients(projectId, sid, rows, pairs, marked)
  })
  for (const sid of others.slice(0, LOOKUPS_PER_SYNC)) {
    const found = await lookup($, sid)
    if (found === 'gone' || found === 'unknown') continue
    const at = dated(found, sid)
    if (Number.isFinite(at) && (target.suggested || !Number.isFinite(mine) || at > mine)) return true
  }
  return false
}

/**
 * (S2, M1, B3) Before a press sends (Update, Claim): whether the thread its row showed is still the client's, by
 * the feed just read. A link the person made always is. A thread the bridge linked by itself, or one the row
 * offered with no link, is the client's only while the feed's rows for its sessions say so (B3; ⛔ a send is
 * never evidence, R11 final round), and while no newer thread of the client's has taken it (`takenOver`).
 */
async function stillTheClients(
  $: EngineInterface,
  projectId: string,
  target: { sid: string; title: string; suggested: boolean },
  linked: string | undefined,
  links: Readonly<Record<string, string>>,
  read: Feed,
  pass: Pick<Pass, 'live'>,
): Promise<boolean> {
  const auto = await storeGet<Auto>($, 'mm.auto', {})
  const own = auto[projectId]
  if (linked === target.sid && own?.sid !== target.sid) return true
  const rows = feedThreadsOf(read)
  const pairs = await storeGet<Pairs>($, 'mm.threads', {})
  const marked = await storeGet<Record<string, string>>($, 'mm.marked', {})
  if (linked === target.sid) return autoLinkFate(projectId, target.sid, rows, pairs, marked) !== 'goes'
  return (
    (target.suggested ? !declaredOther(projectId, target.sid, rows, pairs, marked) : onlyClients(projectId, target.sid, rows, pairs, marked)) &&
    !(await takenOver($, projectId, target, links, rows, pairs, marked, pass.live.get(target.sid)))
  )
}

/**
 * Update thread: the client's thread gets the kickoff as a message, which starts a model turn there, and
 * is then linked, pinned and named. The app refuses to bring a thread forward unless this thread started
 * it (ccd_window.open_session_in), so the answer says which pinned thread to open.
 *
 * `how` says where it came from. A press carries the thread its row showed (`shown`): it acts on that
 * thread or on none. A typed /mm update never acts on a thread that only looks like the client by its
 * title, and cannot pick up this thread itself (the engine refuses a prompt submitted from a command).
 *
 * ⛔ Nothing is written before the message went: no link, no unlink record forgotten, no stamp.
 * ⛔ Never into a thread linked to another client.
 *
 * A press whose pass is `stored` (S2) answers as soon as the message went and the writes after it are made:
 * the list is brought up to date after that answer (`after`), and where the thread could not be opened, the
 * line the pane keeps then says where it is, by the name that pass gave it. `feed` is the feed the typed
 * command (or a press the stored state could not vouch for) brought the list up to date with; null for a
 * `stored` pass.
 */
async function updateThread($: EngineInterface, feed: Feed | null, it: QueueItem, pass: Pass, how: { typed: true } | { typed: false; shown: string | undefined }): Promise<Answer> {
  // With no thread list there is nothing to act on: a thread remembered from an earlier sync may be gone.
  if (!pass.listed) return { said: NO_THREAD_LIST }
  const target = pass.last.recs[it.projectId]?.target
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  // The same for a client whose linked thread the app's list left out and the app did not answer for.
  const linked = links[it.projectId]
  if ((linked && pass.unseen.has(linked)) || (!how.typed && how.shown && pass.unseen.has(how.shown))) return { said: NO_THREAD_LIST }
  /** The refusal for a thread that is another client's, or null when it is free or this client's. */
  const anothers = async (sid: string): Promise<string | null> => {
    const owner = ownerOf(sid, links)
    if (owner === undefined || owner === it.projectId) return null
    const other = ownerName(owner, listedIn(pass.last), (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[sid], pass.live.get(sid)?.title)
    // a client whose name this session cannot read anywhere has no name here to give
    return other ? `That thread belongs to ${other}. Use Start thread for ${it.client}.` : THREAD_GONE
  }
  if (how.typed) {
    if (!target) return { said: `No thread for ${it.client} yet: use /mm start ${it.client}.` }
    if (target.suggested) return { said: `No linked thread for ${it.client} yet. Press Update thread on its row to use "${cleanTitle(target.title)}", or type /mm start ${it.client}.` }
  } else {
    const refused = how.shown ? await anothers(how.shown) : null
    if (refused) return { said: refused }
    // the list was drawn again by the pass that ran before this
    if (!how.shown || !target || target.sid !== how.shown) return { said: THREAD_GONE }
    // (S2) with no pass before it: the client's link, read now, is no other thread. Moved since the row was
    // drawn, the client's thread is that other one, which the row never showed.
    if (pass.stored && linked !== undefined && linked !== target.sid) return { said: THREAD_GONE }
  }
  const refused = await anothers(target.sid)
  if (refused) return { said: refused }
  // ⛔ (S2, M1) Update is the one press that sends, so it reads the feed ONCE before every send (Opus, 10-13:
  // the review's A1 and A2 sent a kickoff for mail answered since, and with the feed down). `Checking…` is
  // drawn at once. The feed cannot be had: nothing is sent. The client has nothing waiting now: nothing is
  // sent, and the list is drawn again. Otherwise the kickoff, and whether the thread already has it, come from
  // the client as the feed has it NOW (`cur`). The pass after the answer is made over that feed.
  // ⛔ And B3 guards a send, which only that feed can answer: a thread the bridge linked by itself, or one the
  // row offered with no link, is this client's only while the feed's rows for its sessions say so (the
  // Pipeline speed thread, 2026-10-13). A link the person made is never let go by B3. A row's thread with no
  // link is no longer the client's once a newer thread of the client's has taken it (`takenOver`): refused,
  // as in 0.5.0.
  let guard: Feed | null = null
  let cur = it
  if (pass.stored) {
    await say($, CHECKING, false)
    let read: Feed
    try {
      read = await fetchFeed($)
    } catch {
      return { said: `Couldn't reach the list to check ${it.client}. Nothing was sent; try again in a minute.`, after: undefined }
    }
    guard = read
    const lists = buildLists(read, await $.clock.now())
    const fresh = [...lists.queue, ...lists.teammate, ...lists.older].find(i => i.projectId === it.projectId)
    if (!fresh) return { said: `${it.client} has nothing waiting now. The list has been refreshed.`, after: async () => void (await reconcile($, read)) }
    cur = fresh
    if (!(await stillTheClients($, it.projectId, target, linked, links, read, pass))) return { said: THREAD_GONE, after: async () => void (await reconcile($, read)) }
  }
  // The thread already has what is waiting now: nothing is sent twice. (Its row draws no Update button;
  // this is the typed command, or a row drawn before another thread's Update went.)
  // ⛔ Asked of what is stored too, and of what this session sent (F2): a second press never sends the same
  // kickoff into the same thread, whatever became of the writes after the first one went. (A press asks of
  // the client as the feed has it now, not of the stored sync's word that the thread was current.)
  const signature = signatureOf(cur)
  const sent = (await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[cur.projectId]
  const has = (sent && sent.sid === target.sid && hasWaiting(sent.sig, cur)) || sentHere.get(`${cur.projectId}\n${target.sid}`) === signature
  if ((!pass.stored && pass.last.recs[it.projectId]?.state === 'current') || has) {
    return { said: `${it.client}'s thread already has this. Open "${cleanTitle(pass.live.get(target.sid)?.title ?? target.title)}" under Pinned.` }
  }
  const here = target.sid === (await selfId($))
  if (here && how.typed) return { said: `You are already in ${it.client}'s thread. Press Update thread on its row in the pane to pick it up here.` }

  const failed = (why: string): Answer => ({ said: `Could not send to ${it.client}'s thread: ${why}` })
  const text = kickoffText(cur, { update: true })
  // ⛔ (0.5.11, review of PR #15, F2) The links read again right before the send: the press read them before the feed,
  // and the person may have moved one since. The thread is another client's now, or the client's link is not what the
  // press read (other than linked now to this very thread): nothing is sent.
  const linksNow = await storeGet<Record<string, string>>($, 'mm.links', {})
  const ownerNow = ownerOf(target.sid, linksNow)
  if ((ownerNow !== undefined && ownerNow !== it.projectId) || (linksNow[it.projectId] !== linked && !(linked === undefined && linksNow[it.projectId] === target.sid))) {
    const seen = guard
    return { said: THREAD_GONE, after: seen ? async () => void (await reconcile($, seen)) : undefined }
  }
  try {
    // (here: the client's thread is this one, and the app's send does not take the sending thread, so the
    // kickoff goes in here as the person's own prompt; only a press reaches this)
    const why = await sendInto($, it.client, it.projectId, here, target.sid, text)
    if (why !== null && typeof why === 'object') return { said: why.busy }
    if (why !== null) return failed(why)
  } catch (err) {
    return failed(errorText(err))
  }

  // The message went. Only now: what the thread now has, the unlink record, the link, the claim, the stamp,
  // and the pin and the name.
  // ⛔ What the thread now has FIRST (review of 79cbc596, F2): while that is what would be sent, its row reads
  // Open thread, not Update, and a second press sends nothing. Then each other write on its own: one the
  // engine refuses does not stop the next, is noted where the bridge's errors go, and is written again by the
  // check 1 to 3 seconds later. None of it holds back the answer: the message is in the thread either way.
  const pid = it.projectId
  const sid = target.sid
  const at = await $.clock.now()
  sentHere.set(`${pid}\n${sid}`, signature)
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `update: ${what}`, err)
    }
  }
  const linkIt = () =>
    // over a fresh copy: the pass before the send may be seconds old
    patchStore<Record<string, string>>($, 'mm.links', {}, fresh => {
      fresh[pid] = sid
    })
  await step('what the thread now has', () => putSent($, pid, { sid, sig: signature, at }))
  await step('the unlink record', () => forgetUnlink($, sid))
  await step('the link', linkIt)
  await step('the claim', () => claim($, pid, sid))
  // The person acted on this thread: it is pinned first, and the cap of 8 does not unpin it for a day.
  await step('the stamp', () => stamp($, pid, sid))
  // Checked again once, 1 to 3 seconds later, as a marker's link is: what is missing is written again. A
  // link another thread holds by the person's hand since, or an unlink the person made since, is left.
  settleLater($, sid, async () => {
    if (!(await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[pid]) await step('what the thread now has, again', () => putSent($, pid, { sid, sig: signature, at }))
    const unlinkedAt = (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))[sid]
    if (unlinkedAt !== undefined) {
      if (unlinkedAt > at) return
      await step('the unlink record, again', () => forgetUnlink($, sid))
    }
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    // ⛔ a thread is one client's: one the person has made another client's since is left as it is (L2)
    const owner = ownerOf(sid, links)
    if (owner !== undefined && owner !== pid) return
    const holder = links[pid]
    const auto = await storeGet<Auto>($, 'mm.auto', {})
    if (holder !== sid && (holder === undefined || auto[pid]?.sid === holder)) await step('the link, again', linkIt)
    if ((await storeGet<Record<string, string>>($, 'mm.links', {}))[pid] !== sid) return
    if (auto[pid]) await step('the claim, again', () => claim($, pid, sid))
    if ((await storeGet<Acted>($, 'mm.acted', {}))[pid]?.sid !== sid) await step('the stamp, again', () => stamp($, pid, sid))
  })
  let thread = pass.live.get(sid)
  /** The pass that pins and names it (over the feed B3 was asked of, when it was); on its failure the next sync does. */
  const settle = async (): Promise<void> => {
    try {
      thread = (await (feed ? reconcile($, feed, pass.pairs) : guard ? reconcile($, guard) : refreshList($))).live.get(sid) ?? thread
    } catch (err) {
      await noteFailure($, 'update: the sync after it', err)
      // (a press's refresh that failed shows in the pane: L3)
      if (pass.stored) await refreshFailed($, err)
    }
  }
  // The toast says it went. Update also takes the person there when the app can be told to open the
  // thread; when it cannot, the line the pane keeps says where the thread is.
  const went = `Sent to ${it.client}'s thread.`
  const where = () => `Sent to ${it.client}'s thread: open "${cleanTitle(thread?.title ?? target.title)}" under Pinned.`
  if (pass.stored) {
    // S2: the answer now; the pass after it. Where the thread could not be opened, the toast says it went at
    // once, and the line the pane keeps says where the thread is once that pass has named it.
    if (here) return { said: `Picking up ${it.client} in this thread.`, after: settle }
    if (await openThread($, thread)) return { said: went, after: settle }
    return {
      said: went,
      after: async () => {
        await settle()
        return where()
      },
    }
  }
  await settle()
  if (here) return { said: `Picking up ${it.client} in this thread.` }
  if (await openThread($, thread)) return { said: went }
  return { said: { text: where(), toast: went } }
}

/**
 * Open thread: the client's thread already has what is waiting. Sends nothing, links nothing. It opens the
 * thread the row showed when the app can be told to; otherwise it says where the thread is.
 */
async function showThread($: EngineInterface, it: QueueItem, pass: Pass, shown: string | undefined): Promise<string> {
  if (!pass.listed) return NO_THREAD_LIST
  const linked = (await storeGet<Record<string, string>>($, 'mm.links', {}))[it.projectId]
  if ((linked && pass.unseen.has(linked)) || (shown && pass.unseen.has(shown))) return NO_THREAD_LIST
  const target = pass.last.recs[it.projectId]?.target
  // the list was drawn again by the pass that ran before this
  if (!shown || !target || target.suggested || target.sid !== shown) return THREAD_GONE
  // (S2) with no pass before it: the client's link, read now, is no other thread
  if (pass.stored && linked !== undefined && linked !== shown) return THREAD_GONE
  const thread = pass.live.get(shown)
  if (await openThread($, thread)) return ''
  return `Open "${cleanTitle(thread?.title ?? target.title)}" under Pinned.`
}

/**
 * The one send of Update and Claim: into this thread as the person's own prompt, or into another with the app's
 * send. Answers why it failed, or null when it went. R10 (Opus, 10-13, decision 1): no cutoff. When the app has
 * not answered in APP_WAIT_MS, the pane says so (NOT_CONFIRMED) and the send is still waited for; while it is in
 * flight the client's press stays held (`sending`), so a second press never sends it again.
 * (0.5.11) `quiet`: an update sent by itself (`autoUpdate`), which nobody pressed: the pane says nothing of it.
 */
async function sendInto($: EngineInterface, client: string, projectId: string, here: boolean, sid: string, text: string, quiet = false): Promise<string | null | { busy: string }> {
  // (fix round 1, L10) one message to a client at a time: a typed /mm update, or the other button, while one is going out
  if (sending.has(projectId)) return { busy: STILL_GOING(client) }
  sending.add(projectId)
  try {
    if (here) {
      const call = $.prompt.submit({ text, asUser: true }) as Promise<{ drop?: string } | undefined>
      const first = await within($, call)
      if (!first.ok) await say($, NOT_CONFIRMED(client)).catch(() => {})
      const r = first.ok ? first.value : await call
      return r?.drop ? short(r.drop) : null
    }
    const call = $.mcp.call('ccd_session_mgmt', 'send_message', { session_id: sid, message: text }) as Promise<Mcp>
    const first = await within($, call)
    if (!first.ok && !quiet) await say($, NOT_CONFIRMED(client)).catch(() => {})
    const r = first.ok ? first.value : await call
    return r.isError ? short(textOf(r)) : null
  } finally {
    sending.delete(projectId)
  }
}

/**
 * R8, Claim in this thread (Rob, 2026-10-13): the server's check of our reply left items open. (0.5.11, Opus 10-15:
 * whatever the length of the client's thread: Claude Code compacts a long one.) The Claim message (claimText, Rob's words) goes into THAT thread, the one
 * the row showed, and starts a model turn there: show what is still open and its drafts, and wait. Update's
 * guards, all of them: a press acts on the thread its row showed or on none; never into a thread linked to
 * another client; the feed is read once before the send, and the client must still be open after our reply as
 * the feed has it now; never the same message twice into the same thread (this session's word, and the store's).
 * ⛔ Nothing is written before the message went.
 */
async function claimThread($: EngineInterface, feed: Feed | null, it: QueueItem, pass: Pass, shown: string | undefined): Promise<Answer> {
  if (!pass.listed) return { said: NO_THREAD_LIST }
  const links = await storeGet<Record<string, string>>($, 'mm.links', {})
  const linked = links[it.projectId]
  if ((linked && pass.unseen.has(linked)) || (shown && pass.unseen.has(shown))) return { said: NO_THREAD_LIST }
  const target = pass.last.recs[it.projectId]?.target
  const owner = shown ? ownerOf(shown, links) : undefined
  if (shown && owner !== undefined && owner !== it.projectId) {
    const other = ownerName(owner, listedIn(pass.last), (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[shown], pass.live.get(shown)?.title)
    return { said: other ? `That thread belongs to ${other}. Use Start thread for ${it.client}.` : THREAD_GONE }
  }
  if (!shown || !target || target.suggested || target.sid !== shown) return { said: THREAD_GONE }
  if (pass.stored && linked !== undefined && linked !== shown) return { said: THREAD_GONE }
  let cur = it
  let guard: Feed | null = null
  if (pass.stored) {
    await say($, CHECKING, false)
    let read: Feed
    try {
      read = await fetchFeed($)
    } catch {
      return { said: `Couldn't reach the list to check ${it.client}. Nothing was sent; try again in a minute.`, after: undefined }
    }
    guard = read
    const fresh = buildLists(read, await $.clock.now()).queue.find(i => i.projectId === it.projectId)
    if (!fresh) return { said: `${it.client} has nothing waiting now. The list has been refreshed.`, after: async () => void (await reconcile($, read)) }
    cur = fresh
    // (fix round 1, F2) Update's guard, on the same feed: B3 and a newer thread of the client's
    if (!(await stillTheClients($, it.projectId, target, linked, links, read, pass))) return { said: THREAD_GONE, after: async () => void (await reconcile($, read)) }
  }
  const now = await $.clock.now()
  const fast = fastState(cur, now)
  const refreshed = guard
  if (fast?.state !== 'still_open') return { said: `${it.client} has nothing waiting now. The list has been refreshed.`, after: async () => void (await (refreshed ? reconcile($, refreshed) : refreshList($))) }
  const text = claimText(cur.client, fast.at, fast.items, now)
  const pid = cur.projectId
  const sid = target.sid
  const key = `claim\n${pid}\n${sid}`
  const had = (await storeGet<Record<string, Sent>>($, 'mm.claimed', {}))[pid]
  if (sentHere.get(key) === text || (had && had.sid === sid && had.sig === text)) {
    return { said: `${it.client}'s thread already has this. Open "${cleanTitle(pass.live.get(sid)?.title ?? target.title)}" under Pinned.` }
  }
  const here = sid === (await selfId($))
  const failed = (why: string): Answer => ({ said: `Could not send to ${it.client}'s thread: ${why}` })
  try {
    const why = await sendInto($, it.client, pid, here, sid, text)
    if (why !== null && typeof why === 'object') return { said: why.busy }
    if (why !== null) return failed(why)
  } catch (err) {
    return failed(errorText(err))
  }
  // The message went. Only now: what the thread was given, the claim (the person used this link: R11), the stamp.
  sentHere.set(key, text)
  const at = await $.clock.now()
  const step = async (what: string, write: () => Promise<unknown>): Promise<void> => {
    try {
      await write()
    } catch (err) {
      await noteFailure($, `claim: ${what}`, err)
    }
  }
  await step('what the thread was given', () =>
    patchStore<Record<string, Sent>>($, 'mm.claimed', {}, all => {
      delete all[pid]
      all[pid] = { sid, sig: text, at }
      capped(all)
    }),
  )
  await step('the claim', () => claim($, pid, sid))
  await step('the stamp', () => stamp($, pid, sid))
  let thread = pass.live.get(sid)
  const settle = async (): Promise<void> => {
    try {
      thread = (await (feed ? reconcile($, feed, pass.pairs) : refreshed ? reconcile($, refreshed) : refreshList($))).live.get(sid) ?? thread
    } catch (err) {
      await noteFailure($, 'claim: the sync after it', err)
      if (pass.stored) await refreshFailed($, err)
    }
  }
  const went = `Sent to ${it.client}'s thread.`
  if (here) return { said: `Picking up ${it.client} in this thread.`, after: settle }
  if (await openThread($, thread)) return { said: went, after: settle }
  return {
    said: went,
    after: async () => {
      await settle()
      return `Sent to ${it.client}'s thread: open "${cleanTitle(thread?.title ?? target.title)}" under Pinned.`
    },
  }
}

/**
 * Drafts, on a row: that client's part goes to the top of the pane (its five-part pickup view when there
 * is a package, else what is waiting and due) and the pane shows its top. Links, pins and starts nothing.
 * S2: the pane opens at once with what needs no network (beginClient); the pickup view is read after.
 */
async function showDrafts($: EngineInterface, it: QueueItem): Promise<Answer> {
  const mine = await ownIn($, [it])
  const finish = await beginClient($, it, mine !== undefined, true)
  await $.ui.open({ id: PANE_QUEUE, title: 'Needs you' })
  // the row pressed may be far down the list: the part just drawn is at the top
  await Promise.resolve($.ui.scroll({ to: 'start', in: PANE_QUEUE })).catch(() => {})
  return { said: '', after: finish }
}

/** What a button or a command answers: one sentence, or the line the pane keeps with a shorter toast. */
type Said = string | { text: string; toast: string }

/**
 * What a press answers at once, and what it does after that answer is drawn (S2): the list brought up to date,
 * a pickup view read. A line `after` answers is what the pane keeps from then on (no second toast).
 */
type Answer = { said: Said; after?: () => Promise<Said | void> }

/**
 * S2: what a press acts on, from what its row was drawn from, with no feed call and at most one app call.
 *   { it, pass }  the client as the last sync stored it, and a `stored` pass: that sync's recommendations,
 *                 and for Update and Open the row's thread as the app answers for it by id now. That is the
 *                 one call before the press acts: the thread must still be there.
 *   { said }      refused here, as the pass before the press refused it in 0.5.0: the row's thread is no
 *                 longer the one the stored sync names for the client, or the app says it is gone, or no
 *                 app answers for threads here
 *   null          what is stored cannot vouch for the row: the caller brings the list up to date first
 */
async function storedPass($: EngineInterface, verb: Exclude<Verb, 'drafts'>, row: Row): Promise<{ it: QueueItem; pass: Pass } | { said: Said } | null> {
  const last = await storeGet<Last | null>($, 'mm.last', null)
  if (!last || !Array.isArray(last.items) || !last.recs || typeof last.recs !== 'object') return null
  const it = listedIn(last).find(i => i.projectId === row.projectId)
  if (!it) return null
  const pass: Pass = { last, live: new Map(), pairs: {}, listed: true, unseen: new Set(), stored: true }
  if (verb === 'start') return { it, pass }
  if (!row.target) {
    // a row drawn with no thread to act on: no app answered for threads when it was drawn
    return (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) === 'claude-desktop' ? null : { said: NO_THREAD_LIST }
  }
  const target = storedRec(last, it.projectId)?.target
  if (!target) return null
  if (target.sid !== row.target) return { said: THREAD_GONE }
  const found = await lookup($, row.target)
  if (found === 'unknown') return { said: NO_THREAD_LIST }
  if (found === 'gone') return { said: THREAD_GONE }
  pass.live.set(found.sessionId, found)
  return { it, pass }
}

/** A button on a row. `row` is the row as it was drawn: Update and Open act on the thread that row showed. */
async function act($: EngineInterface, verb: Verb, row: Row): Promise<Answer> {
  if (verb === 'drafts') {
    const last = (await storeGet<Last | null>($, 'mm.last', null)) ?? (await sync($))
    const it = listedIn(last).find(i => i.projectId === row.projectId)
    return it ? showDrafts($, it) : { said: noClient(row.client) }
  }
  // S2: from what the row was drawn from, the list brought up to date after the answer
  const after = async (): Promise<void> => void (await refreshList($))
  const quick = await storedPass($, verb, row)
  if (quick && 'said' in quick) return { said: quick.said, after }
  if (quick) {
    const { it, pass } = quick
    if (verb === 'start') return { said: await startThread($, it, pass, false), after }
    if (verb === 'open') return { said: await showThread($, it, pass, row.target), after }
    if (verb === 'claim') {
      const answer = await claimThread($, null, it, pass, row.target)
      return 'after' in answer ? answer : { ...answer, after }
    }
    // (an Update that sent nothing is answered too, and the list brought up to date after it, unless it says
    // there is nothing to bring it up to date with)
    const answer = await updateThread($, null, it, pass, { typed: false, shown: row.target })
    return 'after' in answer ? answer : { ...answer, after }
  }
  // What is stored cannot vouch for the row: the list is brought up to date first, as in 0.5.0, and the
  // press says it is at it meanwhile. (Update with no feed sends nothing, and says so: M1.)
  await say($, CHECKING, false)
  let feed: Feed
  try {
    feed = await fetchFeed($)
  } catch (err) {
    if (verb === 'update' || verb === 'claim') return { said: `Couldn't reach the list to check ${row.client}. Nothing was sent; try again in a minute.` }
    throw err
  }
  const pass = await reconcile($, feed)
  const it = listedIn(pass.last).find(i => i.projectId === row.projectId)
  if (!it) return { said: noClient(row.client) }
  if (verb === 'start') return { said: await started($, feed, pass, await startThread($, it, pass, false)) }
  if (verb === 'open') return { said: await showThread($, it, pass, row.target) }
  if (verb === 'claim') return claimThread($, feed, it, pass, row.target)
  return updateThread($, feed, it, pass, { typed: false, shown: row.target })
}

/** Puts what a press or a command said above the list, and in a toast (`toast` false: the line alone, for what the work after a press says). */
async function say($: EngineInterface, said: Said, toast = true): Promise<void> {
  const text = typeof said === 'string' ? said : said.text
  const notice: MmNotice = { text, at: await $.clock.now() }
  await $.state.set(NOTICE, notice)
  const brief = typeof said === 'string' ? said : said.toast
  if (toast && brief) $.ui.toast(brief)
}

/**
 * A press on a row's button.
 * ⛔ One at a time per client. While a press on Update, Start or Open is in flight for a client, another
 * for that client does nothing: no call, no message, no toast. The hold ends when the first returns, or
 * after PRESS_HOLD_MS. (Taken and released with no await in between, so two presses cannot both pass.)
 * S2: the press answers as soon as it has acted (`act`); what it does after that answer (`after`: the list
 * brought up to date, a pickup view read) runs once the answer is drawn and the hold is released. Its
 * failure is noted where the bridge's errors go; the next sync is the fallback.
 */
async function press($: EngineInterface, verb: Verb, row: Row): Promise<void> {
  const held = verb !== 'drafts'
  if (held && pressing.has(row.projectId)) return
  const mine = ++pressCount
  if (held) {
    pressing.set(row.projectId, mine)
    // (a message still in flight keeps the hold until the app answers it: decision 1, Opus 10-13)
    $.clock.after(PRESS_HOLD_MS, () => {
      if (pressing.get(row.projectId) === mine && !sending.has(row.projectId)) pressing.delete(row.projectId)
    })
  }
  let answer: Answer
  try {
    // R10: a press that makes a chip says so before it asks the app for anything
    if (verb === 'start') await say($, (await sessionTools($)).start ? STARTING_THREAD(row.client) : MAKING_CHIP(row.client), false).catch(() => {})
    answer = await act($, verb, row)
  } catch (err) {
    answer = { said: errorText(err) }
  } finally {
    if (held && pressing.get(row.projectId) === mine) pressing.delete(row.projectId)
  }
  try {
    await say($, answer.said)
    await refreshBand($)
  } catch {
    // the thread went away while the press was in flight: there is nobody to tell
  }
  if (!answer.after) return
  try {
    const later = await answer.after()
    if (later) await say($, later, false)
  } catch (err) {
    // and the pane says so, in one line (L3); the reason goes where the heartbeat shows it
    await refreshFailed($, `${verb}: ${errorText(err)}`)
  }
  try {
    await refreshBand($)
  } catch {
    // as above
  }
}

/** Opens or closes one of the two groups under the list, in this thread's pane. The person's press: nothing is fetched, called or changed. */
async function toggleFold($: EngineInterface, key: Fold): Promise<void> {
  try {
    const { value } = await $.state.get(FOLDS)
    await $.state.set(FOLDS, { ...(value ?? {}), [key]: !value?.[key] } satisfies MmFolds)
  } catch {
    // a group that does not open is not worth an error
  }
}

/** The band's button: the Needs-you list, in this thread, as /mm opens it (a press: S2). Sends nothing. */
async function openList($: EngineInterface): Promise<void> {
  try {
    await runCommand($, '', 'person', true)
  } catch (err) {
    await say($, errorText(err))
  }
  await refreshBand($)
}

/** The band's second button, in a waiting client's thread: the pane with that client's part on top, as /mm view opens it (a press: S2). Sends nothing. */
async function openDrafts($: EngineInterface): Promise<void> {
  try {
    await runCommand($, 'view', 'person', true)
  } catch (err) {
    await say($, errorText(err))
  }
  await refreshBand($)
}

/**
 * /mm, and the `mm` tool. `by` is who ran it. `press` is the band's buttons, which run /mm and /mm view: the
 * list may then be brought up to date with a feed this session read less than a minute ago (S2).
 * ⛔ `update` and `start` are the person's alone. For anyone else (Claude through the tool, a /mm that came
 * from another session, a schedule, a channel or a plugin) they are refused here, first, before anything
 * is fetched, called, stored or stamped.
 */
async function runCommand($: EngineInterface, args: string, by: By, press = false): Promise<string> {
  const [verb = 'queue', ...rest] = args.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ')
  if (by !== 'person' && (verb === 'update' || verb === 'start')) return ONLY_THE_PERSON[verb]
  if (verb === 'pause' || verb === 'resume') {
    await $.store.set('mm.paused', verb === 'pause')
    return verb === 'pause' ? 'Paused on this computer: no pins or renames until /mm resume.' : 'Resumed.'
  }
  // (0.5.7) whether threads start by themselves on this computer (on unless turned off); (0.5.11) and whether a
  // client's thread is updated by itself: the same switch
  if (verb === 'auto') {
    if (arg !== 'on' && arg !== 'off') return `Auto-start and auto-update are ${(await autoStartOn($)) ? 'on' : 'off'} on this computer. Type /mm auto off or /mm auto on.`
    await $.store.set('mm.autostart', { on: arg === 'on' })
    return arg === 'on'
      ? 'Auto-start and auto-update are on: a client\'s new thread starts by itself, and its thread is updated by itself when something new arrives.'
      : 'Auto-start and auto-update are off: a client\'s new thread waits as a card for you to start, and its thread waits for you to press Update.'
  }
  if (verb === 'status') {
    const last = await storeGet<Last | null>($, 'mm.last', null)
    const lease = await storeGet<{ owner: string; until: number } | null>($, 'mm.lease', null)
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    // the pins the person took off and that are still off: of threads linked to a client now
    const unpinned = await storeGet<Record<string, Unpinned>>($, 'mm.unpinned', {})
    const off = new Set(Object.values(links).filter(sid => sid in unpinned)).size
    return [
      `member: ${memberText(last?.member) || '?'}`,
      `last sync: ${last ? new Date(last.at).toISOString() : 'never'} · ${last?.items.length ?? 0} need you · ${last?.pinned ?? 0} pinned`,
      `linked threads: ${Object.keys(links).length} · this thread: ${await selfId($)}`,
      `pins you took off: ${off}`,
      `poller: ${lease?.owner === (await instanceId($)) ? 'this thread' : 'another thread'}`,
      `paused: ${Boolean(await $.store.get('mm.paused'))}`,
      `auto-start and auto-update: ${(await autoStartOn($)) ? 'on' : 'off'}`,
      `last error: ${last?.error ?? 'none'}`,
    ].join('\n')
  }
  if (verb === 'view') {
    // /mm view shows this thread's client. A name typed after it is only checked: two clients it could mean is a question.
    if (arg) {
      const found = clientsNamed(arg, listedIn(await storeGet<Last | null>($, 'mm.last', null)))
      if (found.length > 1) return severalClients(arg, found)
    }
    // The pane it opens is the one /mm opens, so the list under the client's part is brought up to date too.
    // In a terminal session, or with the feed not answering, the client's part is still shown. (Not while
    // the bridge is paused: /mm view then shows what the last sync stored, as it always has.)
    if (await $.store.get('mm.paused')) return refreshSelf($, true)
    // S2: when the last sync stored this thread's client, its part opens at once from that, and the list is
    // brought up to date after; the part is drawn again (and the note for Claude added) only if that changed it.
    let said = ''
    try {
      if (await ownIn($, listedIn(await storeGet<Last | null>($, 'mm.last', null)))) said = await refreshSelf($, true)
    } catch {
      // a stored record this version cannot draw: as before, the list first
    }
    if (said) {
      // (a refresh that fails leaves the list as it was, and the pane says so: L3)
      await (press ? refreshList($) : sync($)).catch(err => refreshFailed($, err))
      await refreshSelf($, false)
      return said
    }
    await sync($).catch(() => {})
    return refreshSelf($, true)
  }
  if (verb === 'unlink') {
    const me = await selfId($)
    // (each map changed over a fresh copy: this thread's own entries come off, nothing else is touched)
    await patchStore<Record<string, string>>($, 'mm.links', {}, (links, stored) => {
      const had = Object.keys(links).length
      for (const k of Object.keys(links)) if (links[k] === me) delete links[k]
      return Object.keys(links).length !== had || !stored
    })
    if (me && (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[me]?.byUs) await mcpJson($, 'ccd_sidebar', 'set_pinned', { session_id: me, pinned: false })
    await patchStore<Record<string, Pin>>($, 'mm.pins', {}, (pins, stored) => {
      if (!(me in pins) && stored) return false
      delete pins[me]
    })
    if (me) {
      await claim($, undefined, me)
      // Unlinking is final for linking by itself: this thread is never auto-linked again, to any client.
      const at = await $.clock.now()
      await patchStore<Record<string, number>>($, 'mm.unlinked', {}, unlinked => {
        unlinked[me] = at
        capped(unlinked)
      })
      // And its own name comes back.
      const own = (await storeGet<Record<string, string>>($, 'mm.titles', {}))[me]
      if (own !== undefined) {
        await mcpJson($, 'ccd_session_mgmt', 'set_session_title', { session_id: me, title: own })
        await patchStore<Record<string, string>>($, 'mm.titles', {}, titles => {
          if (titles[me] !== own) return false
          delete titles[me]
        })
      }
      // The link is dropped, and so is the note that the person took our pin off it: it is no client's thread now.
      await pinAgain($, me)
    }
    return 'This thread is no longer linked to a client.'
  }

  // The pane: this thread's client on top when it is a waiting client's thread, the list under it. It opens
  // at once from what the last sync stored, and the list is brought up to date after (S2).
  if (verb !== 'link' && verb !== 'start' && verb !== 'update') return showList($, press)
  // (0.5.12) /mm start all, typed by the person (anyone else was refused above): Start all
  if (verb === 'start' && arg.toLowerCase() === 'all') return startAll($)
  const feed = await fetchFeed($)
  // The name is settled before anything is touched: no client, or more than one, does nothing at all.
  // (any client the pane lists, in the list or in one of the two groups under it; for `link`, any client
  // the feed knows, by name or by id: `linkable`)
  const lists = buildLists(feed, await $.clock.now())
  const queue = [...lists.queue, ...lists.teammate, ...lists.older]
  const found = verb === 'link' ? linkable(arg, queue, feed) : clientsNamed(arg, queue)
  // a client the feed knows only by its id gets its name before any sentence uses it
  for (const [n, f] of found.entries()) if (!f.client) found[n] = { ...f, client: await nameOfId($, f.projectId) }
  if (found.length > 1) return severalClients(arg, found)
  const named = found[0]
  if (!named) return verb === 'link' ? noFeedClient(arg) : noClient(arg)
  // ⛔ Only the person moves a client or a thread, and only the person undoes their own unlink. For anyone
  // else (Claude through the tool, a /mm that is not the person's) `link` is refused here, before
  // anything is written, when this thread is one the person unlinked, when it is already another client's,
  // or when the client is already linked to another thread that is still there (review of 79cbc596, F4).
  // A thread that is nobody's may still be linked to a client that has no thread.
  // (0.5.9, Rob 10-15: "You should be able to relink these when you're asked to") And a client the bridge linked
  // by itself (`mm.auto`) may be moved here: that link is not the person's. The thread it had is given back on the
  // next sync (`mm.released`: its own name, our pin off). ⛔ A client the person linked is still refused.
  /** For anything but the person: a thread the client may be taken from because the app says it is gone. */
  let allowed: string | undefined
  /** This thread is another client's: the sentence, the client's name wherever it can still be read. */
  const ownedBy = async (owner: string, me: string): Promise<string> => {
    const pin = (await storeGet<Record<string, Pin>>($, 'mm.pins', {}))[me]
    const here = await desktopOnly(async () => asThread(await mcpJson($, 'ccd_session_mgmt', 'get_session', { session_id: 'self' })), null)
    // the client's name wherever it can still be read; failing all of that, the sentence names no one
    const other = ownerName(owner, queue, pin, here?.title) || 'another client'
    return `This thread is ${other}'s. Only the person can move it: they type /mm link ${named.client}.`
  }
  if (verb === 'link' && by !== 'person') {
    const me = await selfId($)
    if (me && me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) {
      return `This thread was unlinked by the person. Only they can link it again: they type /mm link ${named.client} here.`
    }
    const links = await storeGet<Record<string, string>>($, 'mm.links', {})
    const owner = me ? ownerOf(me, links) : undefined
    if (owner !== undefined && owner !== named.projectId) return ownedBy(owner, me)
    // (a thread the app says is gone, or archived, holds nothing; one it cannot answer for is still there)
    // (0.5.9) a thread the bridge linked by itself passes here: the write below takes the client from it only while
    // the store, read after the sync, still says the bridge made that link (`autoNow`, M3)
    const holder = links[named.projectId]
    if (holder !== undefined && holder !== me && (await storeGet<Auto>($, 'mm.auto', {}))[named.projectId]?.sid !== holder) {
      if ((await lookup($, holder)) !== 'gone') return alreadyHas(named.client)
      allowed = holder
    }
  }
  const pass = await reconcile($, feed)
  const { last, pairs } = pass
  const pid = named.projectId
  const it = listedIn(last).find(i => i.projectId === pid)
  // (a client on none of the three lists is one `link` alone may name)
  if (!it && verb !== 'link') return noClient(arg)
  // The person typed it: /mm start starts a new thread and /mm update updates the existing one, whatever
  // the row recommends (only a thread that already has this is not sent it again). A typed /mm start
  // always mints its chip.
  if (it && verb === 'start') return started($, feed, pass, await startThread($, it, pass, true))
  if (it && verb === 'update') {
    const { said } = await updateThread($, feed, it, pass, { typed: true })
    return typeof said === 'string' ? said : said.text
  }
  const me = await selfId($)
  if (!me) return 'Linking a thread works in the desktop app\'s Code tab only.'
  await forgetUnlink($, me)
  /** (0.5.9) For anything but the person: the bridge's own link for the client as the store has it now (the sync above may have moved it). */
  const autoNow = by !== 'person' ? (await storeGet<Auto>($, 'mm.auto', {}))[pid]?.sid : undefined
  /** The thread that had the client when this one took it. */
  let had: string | undefined
  let refused = false
  /** (0.5.9, L5) The client this thread became meanwhile, for anything but the person. */
  let ownerNow: string | undefined
  await patchStore<Record<string, string>>($, 'mm.links', {}, links => {
    const holder = links[pid]
    if (by !== 'person') {
      // ⛔ (0.5.9) checked again on the fresh copy: this thread is not now another client's (L5), and a client the
      // person linked to another thread meanwhile stays there (M3): only a gone thread, or one the bridge linked
      // by itself as the store says after the sync, gives it up
      const owner = ownerOf(me, links)
      if (owner !== undefined && owner !== pid) {
        ownerNow = owner
        return false
      }
      if (holder !== undefined && holder !== me && holder !== allowed && holder !== autoNow) {
        refused = true
        return false
      }
    }
    // ⛔ a thread is one client's: linked here by hand, it is no longer any other client's
    for (const k of Object.keys(links)) if (links[k] === me && k !== pid) delete links[k]
    had = holder !== me ? holder : undefined
    links[pid] = me
  })
  if (ownerNow !== undefined) return ownedBy(ownerNow, me)
  if (refused) return alreadyHas(named.client)
  // (0.5.9) the thread the bridge had linked the client to by itself is given back on the next sync
  const given = had
  if (by !== 'person' && given !== undefined && given === autoNow) {
    await patchStore<string[]>($, 'mm.released', [], released => {
      if (released.includes(given)) return false
      released.push(given)
      released.splice(0, Math.max(0, released.length - REMEMBER_MAX))
    })
  }
  await claim($, pid, me)
  // ⛔ Only the person's own link stamps: one Claude or anything else made is not pinned ahead of the cap.
  if (it && by === 'person') await stamp($, pid, me)
  else if (!it) {
    // A client with nothing waiting: linked, and nothing more. No stamp (nothing was acted on, so nothing
    // pins). The bridge's record of this thread, when it has one, is now this client's: the sync takes our
    // pin off and the thread's name says this client is clear, instead of naming the client it was.
    const client = named.client
    await patchStore<Record<string, Pin>>($, 'mm.pins', {}, pins => {
      if (!pins[me]) return false
      pins[me] = { ...pins[me], projectId: pid, client }
    })
  }
  await reconcile($, feed, pairs)
  return `This thread is now ${(it ?? named).client}'s. ${await refreshSelf($, true)}`
}

/**
 * A prompt that begins `[mm-link <project id>]` links this thread to that client: a chip the person
 * started opens its new thread with exactly that.
 * (0.5.8) A thread start_session opened, or a card the person started, gets its first message in the app's wrapper
 * (`Background (…):\n…\n\nTask:\n<prompt>`, or `Task (…):\n<prompt>` for a fork): the prompt is the task part, and
 * the marker counts at its start as it does at the start of the message (`promptOf`).
 * ⛔ Only at the very start of the prompt, only for a project the person's last feed carried, and only
 * when the prompt is the person's own (`composer`, `bridge`, `sdk`), or the app's own delivery of a started
 * thread's task in its `Task (…):` wrapper (`auto-continuation`). Another Claude session's message, a
 * channel, a scheduled task, a task notification or anything else is ignored, as is a marker anywhere
 * else in the text. (Update's kickoff needs no marker: the press that sent it wrote the link.)
 * ⛔ It never forgets an unlink record and never stamps: a thread the person unlinked stays unlinked, and a
 * thread that is another client's stays theirs.
 * ⛔ A client that already has a thread keeps it, with ONE exception: the thread that opens with exactly
 * the prompt of a chip the bridge minted for that client (Start thread, /mm start) was started from that
 * chip, and it takes the client. The thread the client had is given back on the next sync: its own title,
 * our pin off. No other thread ever takes a client this way.
 * (0.5.9) And one more: a client the bridge linked by itself (`mm.auto`) is taken by any thread that opens with its
 * marker. The marker is the person's own act, so the link becomes theirs (out of `auto`), and the thread the bridge
 * had linked is given back on the next sync, as above. A client the person linked keeps its thread exactly as before.
 * ⛔ Each map is changed over a fresh copy (patchStore), and the link is checked again a moment later
 * (settleLater): a dozen threads started together each keep their own (B1).
 * R5 (0.5.2): every running thread mints its own copy of a client's chip, and they share one prompt. A copy
 * started after the client already has a newer linked thread (another copy, or any other thread, took the
 * client since the chip was minted) is stale: it does not link and does not take the client, and the answer is
 * the sentence its kickoff gets (staleCopySentence), so that its first answer names the thread that has the
 * client and stops. So does a marker for a client that already has another linked thread, with no chip.
 * Answers that sentence, or undefined.
 */
async function linkFromMarker($: EngineInterface, text: string, origin: string | undefined): Promise<string | undefined> {
  const { prompt, task } = promptOf(text)
  const projectId = MARKER.exec(prompt)?.[1]
  if (!projectId || !origin || !(PERSON_ORIGINS.has(origin) || (origin === STARTED_TASK_ORIGIN && task))) return undefined
  const last = await storeGet<Last | null>($, 'mm.last', null)
  const inFeed = Array.isArray(last?.projects) ? last.projects : (last?.items ?? []).map(i => i.projectId)
  if (!inFeed.includes(projectId)) return undefined
  const me = await selfId($)
  if (!me) return undefined
  // (0.5.10) this session's pair first: the thread's start is on record no later than its marker (a session's
  // first message comes before its timer's first write)
  await recordSelf($).catch(() => {})
  // ⛔ This thread declared this client: the bridge never links it by itself to another one (B3), whatever
  // becomes of the link this prompt makes. Kept whether or not it links (an unlinked thread, another
  // client's thread).
  let markedNow = false
  await patchStore<Record<string, string>>($, 'mm.marked', {}, marked => {
    if (marked[me] === projectId) return false
    delete marked[me]
    marked[me] = projectId
    capped(marked)
    markedNow = true
  })
  // (0.5.10) and when, in a map of its own (`mm.marked` keeps its form: a thread still running 0.5.9 reads it), the
  // first time this thread was marked for this client. A marker with no time on record (one 0.5.9 made) is not
  // evidence for R1b; it counts everywhere else as before.
  const at = await $.clock.now()
  await patchStore<Record<string, number>>($, 'mm.markedAt', {}, times => {
    if (!markedNow && typeof times[me] === 'number') return false
    delete times[me]
    times[me] = at
    capped(times)
  })
  if (me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) return undefined
  const now = await $.clock.now()
  const chips = await chipsOf($, now)
  // the chip this thread was started from: the one for this client whose prompt is this prompt, to the letter
  // ((0.5.8) the task part, when the app wrapped it)
  const chip = [...chips].reverse().find(c => c.projectId === projectId && c.prompt.trim() === prompt.trim())
  // What this thread has: the kickoff it opened with. From the chip, what the chip carried; with no chip
  // on record, only when its prompt is exactly the kickoff that would be sent now.
  const it = listedIn(last).find(i => i.projectId === projectId)
  const sig = chip ? chip.signature : it && kickoffText(it) === prompt.trim() ? signatureOf(it) : undefined
  /** The thread the client had, when this one takes it by the chip rule. */
  let had: string | undefined
  /** Whether this thread is the client's once the link is written (it may have been already). */
  let ours = false
  /** (R5) Another linked thread has the client: this one is a stale copy, or a marker with no chip. */
  let taken = false
  /**
   * (0.5.9) The thread the bridge linked the client to by itself, as the store has it now: a marker takes the client
   * from it (Rob, 10-15: the threads he started for five clients stayed unlinked while R1's links to their older
   * threads held them).
   */
  const autoHolder = (await storeGet<Auto>($, 'mm.auto', {}))[projectId]?.sid
  const link = () =>
    patchStore<Record<string, string>>($, 'mm.links', {}, links => {
      // decided on the fresh copy: whose this thread is, and who holds the client, NOW
      const owner = ownerOf(me, links)
      if (owner !== undefined && owner !== projectId) return false
      const holder = links[projectId]
      // a chip takes the client only from the thread it had when it was minted (none, or the old one R3 hands over
      // from); (0.5.9) any marker takes it from a thread the bridge linked by itself, which is given back on the next
      // sync. ⛔ A thread the person linked keeps the client (R5: the stale copy's sentence).
      if (holder !== undefined && holder !== me && (!chip || holder !== chip.had) && holder !== autoHolder) {
        taken = true
        return false
      }
      ours = true
      if (holder === me) return false
      had = holder
      links[projectId] = me
    })
  // Checked again 1 to 3 seconds later, once: gone (another session's write met this one, or the engine
  // could not lock the store in time), and the thread is not one the person unlinked since, and no other
  // thread took the client by the chip rule (this one is then on the list of threads given back): written
  // again. A client another thread holds now is left with it, unless the bridge linked that one by itself.
  settleLater($, me, async () => {
    // (only a link this prompt made or found: one it was refused is never written later)
    if (!ours || me in (await storeGet<Record<string, number>>($, 'mm.unlinked', {}))) return
    const released = await storeGet<string[]>($, 'mm.released', [])
    if (Array.isArray(released) && released.includes(me)) return
    const auto = await storeGet<Auto>($, 'mm.auto', {})
    const acted = await storeGet<Acted>($, 'mm.acted', {})
    let again = false
    await patchStore<Record<string, string>>($, 'mm.links', {}, links => {
      const holder = links[projectId]
      const owner = ownerOf(me, links)
      if (holder === me || (owner !== undefined && owner !== projectId)) return false
      // a holder is taken from only while the store says the bridge linked it by itself, and (0.5.9, review of
      // 54a0437d, L1) while the person has not acted on it
      if (holder !== undefined && (auto[projectId]?.sid !== holder || acted[projectId]?.sid === holder)) return false
      links[projectId] = me
      again = true
    })
    if (!again) return
    await claim($, projectId, me)
    if (sig !== undefined && !(await storeGet<Record<string, Sent>>($, 'mm.sent', {}))[projectId]) await putSent($, projectId, { sid: me, sig, at: now })
  })
  await link()
  if (!ours) {
    if (!taken) return undefined
    const named = listedIn(last).find(i => i.projectId === projectId)?.client
    return staleCopySentence(named ? cleanName(named) : await nameOfStored($, projectId))
  }
  if (had !== undefined) {
    const given = had
    await patchStore<string[]>($, 'mm.released', [], released => {
      if (released.includes(given)) return false
      released.push(given)
      released.splice(0, Math.max(0, released.length - REMEMBER_MAX))
    })
  }
  // the person started this: the link is theirs, not one the bridge made by itself
  await claim($, projectId, me)
  if (sig !== undefined) await putSent($, projectId, { sid: me, sig, at: now })
  if (chip) {
    // The person started it: the chip is spent. Every chip for the client is superseded, this one's copies in
    // other threads too (they share its prompt: which copy was clicked cannot be told), for each thread that
    // minted one to withdraw on its own tick (a started chip answers that it was started, and is forgotten).
    await patchChips($, now, fresh => {
      for (const c of fresh) if (c.projectId === projectId) c.superseded = true
      return fresh
    })
    // (0.5.4, C4) a chip used here, with Do it here in the thread that holds it, is withdrawn at once; one used
    // with Start goes from its thread on that thread's next chips pass
    void chipsPass($)
  }
  // The new link pins and names itself now, not at the next five-minute sync (R3: it takes the pin, and the
  // thread the client had is given back).
  await askSync($).catch(() => {})
  return undefined
}

/** A client's name with no app call: its pin record's, else `client <first 8 of its id>`. */
async function nameOfStored($: EngineInterface, projectId: string): Promise<string> {
  const pin = Object.values(await storeGet<Record<string, Pin>>($, 'mm.pins', {})).find(p => p?.projectId === projectId)
  return pin && cleanName(pin.client) ? cleanName(pin.client) : `client ${projectId.slice(0, 8)}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // Runs in a person's session only: the terminal REPL (isInteractive) or the desktop app's Code tab, which
    // reports isInteractive false but CLAUDE_CODE_ENTRYPOINT=claude-desktop. Never in -p runs (Lane-2, daily runs).
    const entry = await $.env.get('CLAUDE_CODE_ENTRYPOINT')
    if (!e.isInteractive && entry !== 'claude-desktop') return started
    if (entry === 'claude-desktop') {
      $.clock.after(4_000, () => void tick($))
      $.clock.every(TICK_MS, () => void tick($))
      // (0.5.3) a chip no longer wanted goes within 15 seconds, not at the next minute's tick
      $.clock.every(CHIPS_PASS_MS, () => void chipsPass($))
    }
    try {
      await $.command.register({
        name: 'mm',
        description: 'Massmarket: /mm (what needs you) · /mm link <client> · /mm update <client> · /mm start <client> · /mm view · /mm unlink · /mm status · /mm pause|resume',
      })
      await $.tool.register({
        name: 'mm',
        description:
          'Massmarket bridge, the same as the /mm command. args: "" or "queue" (who needs the person now), "status", "view" (this thread\'s client in the side pane), "link <client>" (make this thread that client\'s: a name or project id of any client in the feed), "unlink", "pause", "resume". Starting or updating a client thread is for the person only: they press the button in the pane or type /mm start <client> or /mm update <client>. Use it only when the person asks; it never sends anything to a client.',
        inputSchema: { type: 'object', properties: { args: { type: 'string', description: 'what follows /mm' } } },
        isDeferred: false,
      })
    } catch (err) {
      await beat($, { registerError: short(String(err), 300) })
    }
    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const text = String(e.text ?? '')
    const origin = (e.origin as { kind?: string } | undefined)?.kind
    let sentence: string | undefined
    try {
      // (0.5.4, C3) the person is working in this thread now
      if (origin && PERSON_ORIGINS.has(origin)) await noteSeen($, true).catch(() => {})
      // (0.5.3) the person going on in a client's thread while a chip to replace it waits: a claim in place
      // (before the marker is read: a kickoff never claims, and the link is as it was)
      await claimInPlace($, text, origin).catch(() => {})
      sentence = await linkFromMarker($, text, origin)
    } catch {
      // a marker that cannot be acted on never holds a prompt back
    }
    // R5: a kickoff for a client another linked thread already has carries Rob's sentence, last
    return next(sentence ? { ...e, text: `${text}\n\n${sentence}` } : e)
  })

  // R10: a chip the app did not answer outside a turn is tried again at the start of this thread's next turn
  on('turn.start', async ($, e, next) => {
    try {
      const id = await instanceId($)
      const paused = mintPause.get(id)
      if (paused?.atTurn) {
        mintPause.delete(id)
        void chipsTick($, true).catch(() => {})
      }
    } catch {
      // a turn is never held back for a chip
    }
    return next(e)
  })

  // ⛔ The person's own /mm only: typed here, or sent from their phone. A /mm that arrived any other way is
  // answered like the tool.
  on('command.run', { command: 'mm' }, async ($, e) => {
    const text = await runCommand($, String(e.args ?? ''), PERSON_ORIGINS.has(String((e.origin as { kind?: string } | undefined)?.kind)) ? 'person' : 'other')
    await refreshBand($)
    return { text }
  })

  // ⛔ Claude calls this. It never starts or updates a thread: `runCommand` refuses both for it.
  on('tool.call', { tool: 'mcp__mm-bridge__mm' }, async ($, e) => {
    const result = await runCommand($, String((e as Record<string, unknown>).args ?? ''), 'other')
    await refreshBand($)
    return { result }
  })

  // A route that can close something was called from this thread and worked (R6: a reply draft sent or
  // discarded, a team draft posted, any write to a reply package): the list is brought up to date now
  // (askSync), and (R11) a link this thread has by itself becomes the person's.
  // ⛔ The command runs first, exactly as it would have, and its answer is handed back untouched.
  // ⛔ All that is looked at: whether the call was refused or failed, and whether the command names one of
  //    those routes (isClosingRoute). Nothing of the command or of its output is read further, kept,
  //    logged or sent anywhere.
  // ⛔ It never refuses a command and never holds one back: anything going wrong here is swallowed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    try {
      const finished = !answer.deny && !answer.isError
      const command = (e as { command?: unknown }).command
      if (finished && isClosingRoute(command)) {
        // R6: the feed is read again at once
        await askSync($)
        // R11: a link this thread has by itself is the person's from here on: a closing route worked in this
        // thread. ⛔ Only a route: a send by any other path (a Gmail script, an HL call) claims nothing.
        await claimUsed($)
      }
    } catch {
      // the next five-minute sync shows it
    }
    return answer
  })

  // The band: one line above the prompt in every desktop thread, with the button that opens the list.
  // ⛔ It draws what `refreshBand` last worked out from the store. No feed call and no app call from here.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: band } = await $.state.get(BAND)
    // nothing to say, or a survey holds the band: the engine's own
    if (e.props.hasSurvey || !band?.text) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e) as Partial<ReturnType<typeof $.ui.resolve>> & Pick<ReturnType<typeof $.ui.resolve>, 'Box' | 'Text'>
    // a surface that draws no button there says how to open the list instead
    if (!Button) return <Text>{bandWords(band.text, false)}</Text>
    return (
      <Box flexDirection="row" gap={1}>
        <Text>{bandWords(band.text, true)}</Text>
        <Button key="mm-open-list" label="Open list" onPress={() => void openList($)} />
        {band.drafts ? <Button key="mm-open-drafts" label="Drafts" onPress={() => void openDrafts($)} /> : null}
        {band.startAll ? <Button key="mm-start-all" label={startAllLabel(band.startAll)} variant="primary" onPress={() => void pressStartAll($)} /> : null}
      </Box>
    )
  })

  // The pane an older version opened for a client's drafts: a thread that still has it open sees the
  // client part there. Nothing opens it any more: the client part is the top of the one pane below.
  on('ui.render', { component: 'Pane', requestId: PANE_VIEW }, async ($, e) => {
    const { Markdown, Text } = $.ui.resolve(e)
    const { text } = await clientPart($)
    return text ? <Markdown text={text} /> : <Text dimColor>Nothing to show yet.</Text>
  })

  // The one pane. In a waiting client's thread: that client's part on top (`This thread: <client>`), then
  // the Needs-you list. In any other thread: the list. The API has no split inside a pane (a Box clips or
  // it does not: no part of a pane scrolls by itself), so it is one scrolling pane, the client part first
  // and the list after it in full.
  // The list: the clients with no thread yet first, marked, then the ones in a thread; ONE action a row.
  // Under it, two groups that are closed until the person opens one (each heading is its own button):
  // `With a teammate (n)`, then `Older (n)`. Nobody in them is pinned or counted in the header.
  on('ui.render', { component: 'Pane', requestId: PANE_QUEUE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const { value: queue } = await $.state.get(QUEUE)
    const { value: notice } = await $.state.get(NOTICE)
    const { value: folds } = await $.state.get(FOLDS)
    const client = await clientPart($)
    // Nothing synced yet, or a value an older version of this plugin left in this session.
    const hasList = Boolean(queue && Array.isArray(queue.rows))
    if (!hasList && !client.text) return <Text dimColor>{CHECKING}</Text>
    // (0.5.5) the thread drawing this pane, as the timer already learnt it: a row says "this thread" only of it
    const here = await knownSelf($)
    // (0.5.12) the Start all button, from what is stored: two or more clients that need a new thread
    const offer = hasList ? await startAllOffer($) : 0
    const drawRow = (row: Row, lead: string) => (
      <Box flexDirection="column" marginTop={1}>
        <Text>{`${lead} ${row.title}`}</Text>
        <Text dimColor>{rowDetail(row, here)}</Text>
        {row.note ? <Text dimColor>{row.note}</Text> : null}
        {isStillOpenRow(row) ? (row.stillOpen as string[]).map(item => <Text dimColor>{`- ${item}`}</Text>) : null}
        <Box flexDirection="row" gap={1}>
          {rowButtons(row).map(verb =>
            verb === 'drafts' ? (
              <Button key={`${verb}:${row.projectId}`} label={LABEL[verb]} onPress={() => void press($, verb, row)} />
            ) : (
              <Button key={`${verb}:${row.projectId}`} label={buttonLabel(verb, row, here)} variant="primary" onPress={() => void press($, verb, row)} />
            ),
          )}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {client.text ? (
          <Box key="mm-client" flexDirection="column" marginBottom={1}>
            {client.heading ? <Text bold>{client.heading}</Text> : null}
            <Markdown text={client.text} />
          </Box>
        ) : null}
        {hasList && queue ? <Text bold>{queue.header}</Text> : <Text dimColor>{CHECKING}</Text>}
        {offer > 0 ? <Button key="mm-start-all" label={startAllLabel(offer)} variant="primary" onPress={() => void pressStartAll($)} /> : null}
        {notice?.text ? <Text>{notice.text}</Text> : null}
        {hasList && queue?.warning ? <Text>{queue.warning}</Text> : null}
        {hasList && queue
          ? rowGroups(queue.rows).map(group => (
              <Box flexDirection="column" marginTop={1}>
                <Text bold dimColor>
                  {group.heading}
                </Text>
                {group.rows.map(({ row, n, mark }) => drawRow(row, `${mark}${n}.`))}
              </Box>
            ))
          : null}
        {hasList && queue
          ? foldGroups(queue).map(group => (
              <Box flexDirection="column" marginTop={1}>
                <Button key={`mm-fold:${group.key}`} label={group.heading} onPress={() => void toggleFold($, group.key)} />
                {folds?.[group.key] ? group.rows.map(({ row, n }) => drawRow(row, `${n}.`)) : null}
              </Box>
            ))
          : null}
        {hasList && queue ? (
          <Box marginTop={1}>
            <Text dimColor>{queue.note}</Text>
          </Box>
        ) : null}
      </Box>
    )
  })
}
