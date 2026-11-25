/**
 * (0.7.71) Alerts: one phone notification when a thread is pinned for the person, and one quiet sound when a pin needs them or a reply
 * package of theirs lands. Rob, 2026-11-24, in the approved Phase 2 plan: alert only when someone has to act. A pin means the person has
 * to act, so a new pin is the one thing that notifies. Nothing on a re-pin, an unpin, or a thread that was already pinned when the
 * bridge started.
 *
 * - The pass that pins tells it: `reconcile` lists each thread it pinned just now for the person (`NewPin`), the feed's own pins and a
 *   thread that says it waits on the person (`mm waiting`). A thread a profile switch carried, already pinned, or pinned again over the
 *   person's own unpin (`again`) is not listed.
 * - A re-pin is a pin of the same client for the same thing: the same kind and act-by time, or the same declaration (`sig`). It is on
 *   record per computer, on the sync record every thread here reads (`mm.last`, `alerted`), so a pin taken off and put back, a profile switch that clears and re-pins, or two threads that
 *   sync one after the other never alert twice.
 * - A quiet pass alerts nothing and only records: the first pass on a computer with no record yet, and any pass after a gap of more than
 *   ALERT_GAP_MS since the last sync on record (the computer was asleep or the app closed). What it pins then was waiting when the
 *   person came back, and the sidebar shows it.
 * - The switch is per computer, `/mm alerts on|off`, on by default (`mm.alerts`). The plugin auto-updates on every teammate's computer,
 *   so anything that makes a noise can be turned off where it runs. Off, the record is still kept, so turning it on never floods.
 * - The notification is `$.ui.notify` (the mod API's own notification: the person's notification channel; in the desktop app the host
 *   raises it). One per new pin, at most ALERT_MAX in one pass and one line for the rest, each under ALERT_CHARS characters, keyed by
 *   client so a host holds one per client. It names the client and what is due, in the words the thread's name in the sidebar uses.
 * - It is raised from the pinned thread's own session (`ALERTS_DUE`, `claimDue`). The engine sends a mod's notification on the session
 *   that raised it, and the phone hears a thread over that thread's own Remote Control, which `/mm rc on` gives every pinned thread. So
 *   the thread that synced hands the alert to the pinned thread, which raises it within ALERTS_EVERY_MS (each running thread looks that
 *   often); one the pinned thread has not taken HANDOFF_MS later (it is not running here) is raised by any thread here that looks, and
 *   one still not raised after DUE_MAX_MS is dropped.
 * - The sound is the bridge's own file, `sounds/arrive.wav`: two soft sine notes (C5 then G5, 0.55 s, peak at a quarter of full scale),
 *   made for the bridge and like no system sound. One a pass at most, whatever landed.
 * ⛔ Nothing here sends to a client, a teammate or anyone: a notification and a sound on the person's own devices.
 */

/** The per-computer switch: `{ on: false }` turns alerts off. Absent, on. */
export const ALERTS_SWITCH = 'mm.alerts'
/** A pass after a gap this long since the last sync on record is quiet: it records and alerts nothing. */
export const ALERT_GAP_MS = 20 * 60_000
/** The most notifications one pass raises; past them, one line says how many more. */
export const ALERT_MAX = 5
/** A notification's body stays under this many characters (phones cut longer ones). */
export const ALERT_CHARS = 200
/** What heads every notification. */
export const ALERT_TITLE = 'Massmarket'
/** The bridge's own sound, a file of the plugin's. */
export const SOUND_ASSET = 'sounds/arrive.wav'
/** Its volume: quiet. */
export const SOUND_GAIN = 0.6
/** A pin's record is kept this long. */
export const PIN_KEEP_MS = 14 * 24 * 60 * 60_000
/** The packages kept on record: the newest. */
export const PACKAGES_KEEP = 300

/** A thread the pass pinned just now for the person. */
export type NewPin = {
  /** The client's OW project. */
  pid: string
  /** The thread pinned: the session that raises the notification. */
  sid: string
  /** The client's name, as the pin shows it. */
  client: string
  /** What the pin is for: the same `sig` again for the same client is a re-pin. */
  sig: string
  /** The words of the notification: the client and what is due. */
  text: string
}

/** The record, kept on the sync record as `alerted` (`mm.last`). */
export type Alerted = {
  /** Each client's last pin alerted for (or recorded quietly), and when. */
  pins: Record<string, { sig: string; at: number }>
  /** The reply packages seen ready for the person, newest last. */
  packages: string[]
  /** When this record was last written. */
  at: number
}

/** The notifications handed to the pinned threads, by thread: each raised once, by that thread or (late) by any thread here. */
export const ALERTS_DUE = 'mm.alertsDue'
/** One handed over: its words, its key, and when. */
export type AlertDue = { text: string; key: string; at: number }
/** How often each running thread looks for a notification handed to it. */
export const ALERTS_EVERY_MS = 30_000
/** Past this, a notification the pinned thread has not taken is raised by any thread here. */
export const HANDOFF_MS = 90_000
/** Past this, one still not raised is dropped. */
export const DUE_MAX_MS = 30 * 60_000

/**
 * What a thread raises now from the notifications handed over (`due`, read fresh): its own, and anyone's older than HANDOFF_MS; the
 * rest stay for their threads, and any older than DUE_MAX_MS goes. `me` '': its id is not known yet, so only the late ones.
 */
export function claimDue(due: Readonly<Record<string, AlertDue>>, me: string, now: number): { mine: AlertDue[]; keep: Record<string, AlertDue> } {
  const mine: AlertDue[] = []
  const keep: Record<string, AlertDue> = {}
  for (const [sid, a] of Object.entries(due)) {
    if (!a || typeof a !== 'object' || typeof a.text !== 'string' || typeof a.key !== 'string' || typeof a.at !== 'number') continue
    const age = now - a.at
    if (age > DUE_MAX_MS) continue
    if ((me && sid === me) || age > HANDOFF_MS) mine.push(a)
    else keep[sid] = a
  }
  return { mine, keep }
}

/** What one pass does: the notifications to raise, whether to play the sound, and the record to keep. */
export type AlertPlan = { notify: NewPin[]; more: number; sound: boolean; next: Alerted }

/** A record of the right shape, or null (none yet, or one this version cannot read). */
export function alertedOf(v: unknown): Alerted | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Partial<Alerted>
  if (!r.pins || typeof r.pins !== 'object' || Array.isArray(r.pins) || !Array.isArray(r.packages) || typeof r.at !== 'number') return null
  const pins: Alerted['pins'] = {}
  for (const [pid, p] of Object.entries(r.pins)) if (p && typeof p === 'object' && typeof p.sig === 'string' && typeof p.at === 'number') pins[pid] = { sig: p.sig, at: p.at }
  return { pins, packages: r.packages.filter((id): id is string => typeof id === 'string'), at: r.at }
}

/** Whether alerts are on on this computer: on unless the person turned them off. */
export function alertsOn(v: unknown): boolean {
  return !(v && typeof v === 'object' && (v as { on?: unknown }).on === false)
}

/** One line, at most ALERT_CHARS - 1 characters, cut on a word with `…`. */
export function cutAlert(raw: string): string {
  const text = raw.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...text]
  if (chars.length < ALERT_CHARS) return text
  const head = chars.slice(0, ALERT_CHARS - 2).join('')
  const space = head.lastIndexOf(' ')
  return `${(space > ALERT_CHARS / 2 ? head.slice(0, space) : head).trimEnd()}…`
}

/** A pin of the feed's: the thread's name in the sidebar says the client, how long is left and what is due. */
export const pinAlertText = (title: string): string => cutAlert(`Pinned for you: ${title}`)
/** A thread that says it waits on the person: its name, and the question. */
export const waitingAlertText = (title: string, ask: string): string => cutAlert(`Pinned for you: ${title}: "${ask}"`)
/** The line for the pins past ALERT_MAX in one pass. */
export const moreAlertText = (n: number): string => `${n} more ${n === 1 ? 'thread is' : 'threads are'} pinned for you.`
/** What a pin of the feed's is for: its kind and act-by time. */
export const pinSig = (kind: string, actBy: number): string => `${kind}:${Number.isFinite(actBy) ? actBy : 'none'}`
/** What a declaration's pin is for: the kind and when it was declared (a newer declaration is a new question). */
export const waitingSig = (type: string, at: number): string => `waiting:${type}:${at}`

/**
 * One pass's alerts, from the record as it stands now (`had`, read fresh just before it is written), the pins the pass made, and the
 * person's ready packages now. `quiet`: the pass records and alerts nothing (no sync on record before it, or one older than
 * ALERT_GAP_MS). A record that is missing or unreadable is quiet too: a computer's first pass alerts nothing.
 */
export function planAlerts(had: Alerted | null, o: { now: number; quiet: boolean; on: boolean; pins: readonly NewPin[]; ready: readonly string[] }): AlertPlan {
  const loud = had !== null && !o.quiet && o.on
  const pins: Alerted['pins'] = {}
  for (const [pid, p] of Object.entries(had?.pins ?? {})) if (o.now - p.at <= PIN_KEEP_MS) pins[pid] = p
  const fresh: NewPin[] = []
  for (const pin of o.pins) {
    if (pins[pin.pid]?.sig === pin.sig || fresh.some(f => f.pid === pin.pid)) continue
    pins[pin.pid] = { sig: pin.sig, at: o.now }
    fresh.push(pin)
  }
  const seen = had?.packages ?? []
  const landed = o.ready.filter(id => !seen.includes(id))
  const packages = [...seen.filter(id => !landed.includes(id)), ...landed].slice(-PACKAGES_KEEP)
  const notify = loud ? fresh.slice(0, ALERT_MAX) : []
  return {
    notify,
    more: loud ? Math.max(0, fresh.length - ALERT_MAX) : 0,
    sound: loud && (fresh.length > 0 || landed.length > 0),
    next: { pins, packages, at: o.now },
  }
}
