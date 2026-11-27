// (0.7.86) Remote Control on the pinned threads: how many threads this computer can hold with it, and which ones.
// Pure, with no `$`: register.tsx (`rcFollowsPin`) reads the computer and the app, asks this file what to do, and does it.
//
// ⛔ (Rob, 2026-11-27: "we dont want all pins to have remote control since that slows the mac down too much. its supposed
// to be the most recently used 10 i think", and then "my main concern is computer memory, it would be best if it kept a
// monitor on memory and 10 was flexible based on the machine") The desktop app never unloads a thread that has Remote
// Control on, and its memory governor keeps only about max(6, RAM / 3 GB) threads loaded (`appLiveCap`: 16 on a 48 GB
// Mac). So Remote Control follows the pin on the most recently used pinned threads only, as many as the computer's memory
// allows: 5 in 8 of the app's live threads (`RC_SHARE`, 10 on Rob's 48 GB Mac), half that while memory is tight, and
// RC_FLOOR while it is critical. A computer whose memory cannot be read gets RC_MAX_THREADS, Rob's number.

/** A reading of this computer's memory: its size in bytes, the share free (0 to 100) and the system's own pressure level. Each is left out when it could not be read. */
export type MemRead = { ram?: number; free?: number; level?: 'normal' | 'warn' | 'critical' }
/** How short memory is: `unread` when neither the share free nor the pressure level could be read. */
export type MemTier = 'normal' | 'tight' | 'critical' | 'unread'
/** What the cap is now and why: `full` is the computer's cap with memory normal. */
export type RcWanted = { cap: number; full: number; tier: MemTier }
/** The cap the bridge last used (`mm.rccap`): `at`, the last reading that asked for this cap or a lower one. */
export type RcHeld = { cap: number; at: number; full: number; tier: MemTier; ram?: number }

/** (0.7.86) Threads with Remote Control on a computer whose memory cannot be read: Rob's number ("the most recently used 10 i think"). */
export const RC_MAX_THREADS = 10
/** (0.7.86) Of the threads the app keeps loaded (`appLiveCap`), at most this share are held by Remote Control, so its governor can still unload the rest: 10 of 16 on a 48 GB Mac. */
export const RC_SHARE = 5 / 8
/** (0.7.86) The fewest threads that keep Remote Control on a computer whose memory is critical: the most recently used. */
export const RC_FLOOR = 2
/** (0.7.86) Memory is tight below this share free (or at the system's warning level): the cap is halved. */
export const RC_TIGHT_FREE = 25
/** (0.7.86) Memory is critical below this share free (or at the system's critical level): the cap is RC_FLOOR. */
export const RC_CRITICAL_FREE = 12
/** (0.7.86) A lower cap is raised again only once memory has read better for this long, so a short dip does not switch threads off and on. */
export const RC_RAISE_MS = 10 * 60_000
/**
 * (0.7.86) A thread on record that the bridge saw with Remote Control on no longer ago than this, and now sees off while
 * the thread is in use (running, or used since): the person switched it off. Seen off any other way, it dropped.
 */
export const RC_SEEN_MS = 3 * 60_000

const GIB = 2 ** 30

/** (0.7.86) The threads the desktop app keeps loaded, as its memory governor counts them: max(6, RAM / 3 GB). 16 on a 48 GB Mac (measured, `[CliGovernor] at cap=16`). */
export function appLiveCap(ram: number): number {
  return Math.max(6, Math.floor(ram / (3 * GIB)))
}

/** (0.7.86) This computer's cap with memory normal: RC_SHARE of the app's live threads, at least RC_FLOOR; RC_MAX_THREADS when its size is not known. */
export function rcFull(ram?: number): number {
  return typeof ram === 'number' && ram > 0 ? Math.max(RC_FLOOR, Math.round(appLiveCap(ram) * RC_SHARE)) : RC_MAX_THREADS
}

/** (0.7.86) How short memory is now, by the system's pressure level where it has one, and the share free. */
export function memTier(m: MemRead): MemTier {
  const free = typeof m.free === 'number' ? m.free : undefined
  if (m.level === 'critical' || (free !== undefined && free < RC_CRITICAL_FREE)) return 'critical'
  if (m.level === 'warn' || (free !== undefined && free < RC_TIGHT_FREE)) return 'tight'
  if (m.level === undefined && free === undefined) return 'unread'
  return 'normal'
}

/** (0.7.86) The cap this reading asks for: the full cap, half of it while memory is tight, RC_FLOOR while it is critical (never above the full cap). */
export function rcWanted(m: MemRead): RcWanted {
  const full = rcFull(m.ram)
  const tier = memTier(m)
  const floor = Math.min(full, RC_FLOOR)
  const cap = tier === 'critical' ? floor : tier === 'tight' ? Math.max(floor, Math.floor(full / 2)) : full
  return { cap, full, tier }
}

/**
 * (0.7.86) The cap to use now, given the one held: a lower cap at once, a higher one only once RC_RAISE_MS have passed since
 * the last reading that asked for the held cap or lower. `write` is the record to store, or null when nothing changed (a
 * computer with memory normal writes nothing pass after pass).
 */
export function rcHold(want: RcWanted, ram: number | undefined, held: RcHeld | null, now: number): { cap: number; write: RcHeld | null } {
  const record = (cap: number): RcHeld => ({ cap, at: now, full: want.full, tier: want.tier, ...(typeof ram === 'number' ? { ram } : {}) })
  if (!held) return { cap: want.cap, write: record(want.cap) }
  if (want.cap > held.cap && now - held.at < RC_RAISE_MS) {
    const said = held.tier !== want.tier || held.full !== want.full
    return { cap: held.cap, write: said ? { ...held, full: want.full, tier: want.tier } : null }
  }
  // a reading below the full cap is the time a later raise waits from
  const changed = want.cap !== held.cap || want.tier !== held.tier || want.full !== held.full || ram !== held.ram || want.cap < want.full
  return { cap: want.cap, write: changed ? record(want.cap) : null }
}

/** (0.7.86) A held cap from the store, or null when it is not one. */
export function heldOf(v: unknown): RcHeld | null {
  const h = v as Partial<RcHeld> | null | undefined
  if (!h || typeof h !== 'object' || typeof h.cap !== 'number' || typeof h.at !== 'number') return null
  const tier: MemTier = h.tier === 'normal' || h.tier === 'tight' || h.tier === 'critical' ? h.tier : 'unread'
  return { cap: h.cap, at: h.at, full: typeof h.full === 'number' ? h.full : h.cap, tier, ...(typeof h.ram === 'number' ? { ram: h.ram } : {}) }
}

const LEVELS: Record<string, MemRead['level']> = { '1': 'normal', '2': 'warn', '4': 'critical' }
const percent = (n: number): number | undefined => (Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined)

/**
 * (0.7.86) A Mac's memory from `sysctl hw.memsize kern.memorystatus_level kern.memorystatus_vm_pressure_level` (names
 * printed, so a name this Mac lacks leaves only its own field out): the size, the share free as `memory_pressure` says it,
 * and the pressure level (1 normal, 2 warning, 4 critical).
 */
export function memOfSysctl(stdout: string): MemRead {
  const out: MemRead = {}
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^\s*([\w.]+)\s*[:=]\s*(\d+)\s*$/.exec(line)
    if (!m) continue
    const n = Number(m[2])
    if (m[1] === 'hw.memsize' && n > 0) out.ram = n
    else if (m[1] === 'kern.memorystatus_level') {
      const p = percent(n)
      if (p !== undefined) out.free = p
    } else if (m[1] === 'kern.memorystatus_vm_pressure_level' && LEVELS[m[2] as string]) out.level = LEVELS[m[2] as string]
  }
  return out
}

/** (0.7.86) A Linux computer's memory from /proc/meminfo: MemTotal, and MemAvailable as the share free. */
export function memOfMeminfo(text: string): MemRead {
  const kb = (name: string): number | undefined => {
    const m = new RegExp(`^${name}:\\s*(\\d+)\\s*kB`, 'm').exec(String(text))
    return m ? Number(m[1]) * 1024 : undefined
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  const out: MemRead = {}
  if (total && total > 0) {
    out.ram = total
    if (available !== undefined) {
      const p = percent(Math.round((available / total) * 100))
      if (p !== undefined) out.free = p
    }
  }
  return out
}

/** (0.7.86) A Windows computer's memory from Win32_OperatingSystem: `<TotalVisibleMemorySize> <FreePhysicalMemory>`, both in KB. */
export function memOfWindows(stdout: string): MemRead {
  const m = /(\d+)\s+(\d+)/.exec(String(stdout))
  if (!m) return {}
  const total = Number(m[1]) * 1024
  const free = Number(m[2]) * 1024
  if (!(total > 0)) return {}
  const p = percent(Math.round((free / total) * 100))
  return { ram: total, ...(p !== undefined ? { free: p } : {}) }
}

/**
 * (0.5.19) The threads whose Remote Control the bridge switched on (`mm.rc`): when it did. (0.7.86) `seen`, the last pass that
 * saw it on, `act`, the thread's last activity then, and `by`, the bridge process that saw it (a restart of the app starts new
 * ones); `dropped`, when a pass first saw it off since the bridge switched it on; `person`, the bridge saw the person switch
 * it off.
 */
export type RcEntry = { at: number; seen?: number; act?: string; by?: string; dropped?: number; person?: true }
export type RcRecord = Record<string, RcEntry>
/** A thread as the plan reads it: (0.7.86) `running`, the app says a turn is going in it. */
export type RcView = { sid: string; pinned: boolean; on: boolean; activity: string; running: boolean }
/**
 * (0.7.86) What one pass does. `off` and `on` are calls to make, in that order (switching off first frees memory first), `on`
 * most recently used first: the caller leaves out one switch-on from its end for each switch-off that did not happen, so a
 * refused switch-off never leaves more threads on than the cap. `forget` comes off the record; `person` is marked as the
 * person's own switch-off; `seen` is stamped as seen on now; `dropped` is stamped as found off; `top` is every thread Remote
 * Control should be on for, most recently used first; `held` counts the threads whose Remote Control the bridge did not
 * switch on, which use the cap all the same.
 */
export type RcPlan = { on: string[]; off: string[]; forget: string[]; person: string[]; seen: string[]; dropped: string[]; top: string[]; held: number }
/**
 * (0.7.86) What else the plan reads: `refused`, the threads the app refused or did not answer and that have not been used
 * since (`mm.rcwait`, its activity still theirs); `by`, this bridge process.
 */
export type RcPass = { refused: ReadonlySet<string>; by: string }

/** Newest first; a thread with no time last. */
const newestFirst = (a: RcView, b: RcView): number => (b.activity || '').localeCompare(a.activity || '')

/**
 * (0.7.86) The pass, decided. Every thread with Remote Control on that the bridge did not switch on (the person's own,
 * pinned or not, and one on record that came back on with no switch-on of the bridge's since it was found off) keeps it and
 * uses one of the `cap` places: it keeps its thread loaded all the same. ⛔ The bridge never switches those off. The rest go
 * to the pinned threads, most recently used first, skipping one the app refused and that has not been used since (most
 * likely unloaded: it would only be refused again) while another can take its place; it takes a place left over:
 *   - in the top: switched on when off, unless the person switched it off while using it (`person`, kept while it stays
 *     pinned): off no more than RC_SEEN_MS after this same bridge process saw it on, with the thread running or used since.
 *     Off any other way it dropped (it went idle, was unloaded, the app restarted, a switch-on still connecting) and is
 *     switched on again;
 *   - past the top, on record: switched off, or, already off, taken off the record (so it gets Remote Control again
 *     once it is back in the top). Not on record: nothing.
 * An unpinned thread on record is switched off, or taken off the record when already off.
 */
export function rcPlan(threads: readonly RcView[], record: Readonly<RcRecord>, cap: number, now: number, pass: RcPass): RcPlan {
  const plan: RcPlan = { on: [], off: [], forget: [], person: [], seen: [], dropped: [], top: [], held: 0 }
  // an entry of the wrong shape (an older version's, a damaged file) is still on record, with nothing else known
  const entry = (sid: string): RcEntry | undefined => {
    if (!Object.hasOwn(record, sid)) return undefined
    const e = record[sid] as unknown
    return e && typeof e === 'object' ? (e as RcEntry) : { at: 0 }
  }
  const candidates: RcView[] = []
  for (const t of threads) {
    const e = entry(t.sid)
    if (t.on && (!e || e.person || typeof e.dropped === 'number')) {
      // the person's own Remote Control: it uses a place and is never touched
      plan.held++
      if (e) plan.forget.push(t.sid)
      continue
    }
    if (!t.pinned) {
      if (e && t.on) plan.off.push(t.sid)
      else if (e) plan.forget.push(t.sid)
      continue
    }
    if (e && !t.on) {
      if (e.person) continue
      const watched = typeof e.seen === 'number' && e.by === pass.by && now - e.seen <= RC_SEEN_MS
      const used = t.running || (typeof e.act === 'string' && t.activity !== e.act)
      if (watched && used) {
        plan.person.push(t.sid)
        continue
      }
    }
    candidates.push(t)
  }
  const ranked = [...candidates].sort(newestFirst)
  const waiting = (t: RcView) => !t.on && pass.refused.has(t.sid)
  const top = new Set<string>()
  let room = Math.max(0, cap - plan.held)
  for (const t of ranked) {
    if (room > 0 && !waiting(t)) {
      top.add(t.sid)
      room--
    }
  }
  for (const t of ranked) {
    if (room > 0 && !top.has(t.sid)) {
      top.add(t.sid)
      room--
    }
  }
  for (const t of ranked) {
    const e = entry(t.sid)
    if (top.has(t.sid)) {
      plan.top.push(t.sid)
      if (t.on) plan.seen.push(t.sid)
      else {
        plan.on.push(t.sid)
        if (e && typeof e.dropped !== 'number') plan.dropped.push(t.sid)
      }
    } else if (e && t.on) plan.off.push(t.sid)
    else if (e) plan.forget.push(t.sid)
  }
  return plan
}
