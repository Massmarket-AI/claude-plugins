// Pure tracking logic for the Massmarket bridge (0.6.0): no `$`, so tests can call it directly.
//
// Rob, 2026-10-25: "I think we need the side panel to be open on all bridge-connected threads... anytime a team
// member is talking about a client, the bridge connects, even if there's more than one thread per client... mainly
// I'm wanting there to always be a side panel if there's any work being done for a client where it shows the tasks
// that are being worked on and how much time is tracked to each of them across all their threads... It also gives
// them confirmation that their current work is being tracked."
//
// So each thread on this machine has a CURRENT PROJECT (`mm.current`), whatever told the bridge last: a skill the
// thread loaded, the feed's rows for its sessions, a marker kickoff, /mm link, the person's press on the band, or the
// thread being the client's linked (primary) thread. The pane shows the time OW tracked to that project today and
// this week, across every thread of it (`/api/ext/client-time`), and the status line says the thread is counted.
//
// ⛔ Everything drawn here is drawn only: names, titles and task labels are the person's or OW's text, kept to one
// line (`shownText`). Only `noteFor`'s words go to Claude, and those carry a cleaned client name and a skill key that
// matched SKILL_KEY.

import type { MmTrackLine } from '../types'

import { INTERNAL_OPS, cleanTitle, isUuid, shortName, shownText } from './queue'

const MINUTE = 60_000

/** What OW says a project is, for the time tracker's labels: a client, Massmarket's internal ops, or its own sales and marketing. */
export type ProjectKind = 'client' | 'internal_ops' | 'self_funnel'

/** One skill the time tracker knows, as `GET /api/ext/skill-map` answers it. */
export type SkillEntry = { skill_key: string; project_id: string; name: string; kind: ProjectKind }

/** What set a thread's current project (`Current.how`). */
export type How = 'skill' | 'feed' | 'marker' | 'link' | 'press' | 'primary'

/**
 * (0.6.0) A thread's current project on this machine (`mm.current`, by the app's thread id, or `cli:<session id>` for
 * a terminal session): which project, what set it and when (`at`: the latest source wins), the task the thread
 * declared for it (`--task`), when the sync last saw the thread in the app's list (`seen`), its last activity there
 * (`act`), when the sync last asked the app whether it was archived (`chk`), and the clients it has declared (the
 * hub check: a thread that declared another client is never made a client's primary by a skill load or a press).
 */
export type Current = { pid: string; how: How; at: number; task?: string; seen?: number; act?: number; chk?: number; declared?: string[] }

/** The most clients one thread's `declared` remembers. */
const DECLARED_MAX = 8

/** A skill key as the bridge accepts one from OW: what a skill folder is named. */
export const SKILL_KEY = /^[a-z0-9][a-z0-9-]{0,80}$/

/**
 * The skill's own name from what the Skill tool was called with: anything up to the last `:` is its plugin or its
 * folder (`plugin:skill`, `apps/web:deploy`), and goes.
 */
export function skillName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.slice(s.lastIndexOf(':') + 1).trim().toLowerCase()
}

const KINDS: ReadonlySet<string> = new Set(['client', 'internal_ops', 'self_funnel'])

/** OW's skill map, checked: each entry a known kind, a uuid project and a skill key of the right shape. Null for an answer that is not one. */
export function parseSkillMap(raw: unknown): { asOf: string; skills: SkillEntry[] } | null {
  const o = raw as { as_of?: unknown; skills?: unknown } | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.skills)) return null
  const skills: SkillEntry[] = []
  for (const s of o.skills.slice(0, 2_000) as Array<Partial<SkillEntry> | null>) {
    if (!s || typeof s !== 'object' || typeof s.skill_key !== 'string' || !SKILL_KEY.test(s.skill_key) || !isUuid(s.project_id) || !KINDS.has(String(s.kind))) continue
    // (the name as OW writes it, one line: the client's short name is cut from it where it is shown, `clientName`)
    skills.push({ skill_key: s.skill_key, project_id: s.project_id, name: shownText(s.name, 120), kind: s.kind as ProjectKind })
  }
  return { asOf: typeof o.as_of === 'string' ? o.as_of.slice(0, 40) : '', skills }
}

// ---------------------------------------------------------------- client time (OW's /api/ext/client-time)

export type TimePerson = { email: string; name: string; minutes: number }
export type TimeTask = { task: string | null; ticket_id: string | null; minutes: number; thread_count: number; people: string[]; last_activity_at: string; active_now: boolean }
export type TimePeriod = {
  client_minutes: number
  by_source: { claude_code: number; timer: number; browser: number; meeting: number }
  thread_minutes: number
  parallel: number | null
  jarvis_minutes: number
  people: TimePerson[]
  tasks: TimeTask[]
}
export type TimeThread = { session_id: string; title: string | null; member_email: string; member_name: string; task: string | null; ticket_id: string | null; minutes_today: number; last_activity_at: string; active_now: boolean }
export type TimeLeverage = { ratio: number | null; build_hours: number; actual_hours: number; window: string; note: string }
/**
 * One project's time. A period OW was not asked for (`periods=today`) is null; `threads` come with today alone and
 * `leverage` with the week alone.
 */
export type TimeProject = { project_id: string; name: string; today: TimePeriod | null; week: TimePeriod | null; threads: TimeThread[]; leverage: TimeLeverage | null }
export type ClientTime = { asOf: string; day: string; weekStart: string; viewer: { email: string; canSeeLeverage: boolean }; skipped: string[]; projects: TimeProject[] }

/** The most rows of each list kept from an answer, so the store stays far under its cap. */
export const TIME_ROWS = { threads: 30, tasks: 20, people: 20 } as const

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const str = (v: unknown, max: number): string => shownText(v, max)
const optStr = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? shownText(v, max) : null)

function period(raw: unknown): TimePeriod {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const src = (p.by_source && typeof p.by_source === 'object' ? p.by_source : {}) as Record<string, unknown>
  const people = (Array.isArray(p.people) ? p.people : []).slice(0, TIME_ROWS.people).map(x => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    return { email: str(o.email, 120), name: str(o.name, 60), minutes: num(o.minutes) }
  })
  const tasks = (Array.isArray(p.tasks) ? p.tasks : []).slice(0, TIME_ROWS.tasks).map(x => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    return {
      task: optStr(o.task, 120), ticket_id: optStr(o.ticket_id, 60), minutes: num(o.minutes), thread_count: num(o.thread_count),
      people: (Array.isArray(o.people) ? o.people : []).slice(0, 10).map(e => str(e, 120)).filter(Boolean),
      last_activity_at: str(o.last_activity_at, 40), active_now: o.active_now === true,
    }
  })
  const parallel = typeof p.parallel === 'number' && Number.isFinite(p.parallel) && p.parallel >= 0 ? p.parallel : null
  return {
    client_minutes: num(p.client_minutes),
    by_source: { claude_code: num(src.claude_code), timer: num(src.timer), browser: num(src.browser), meeting: num(src.meeting) },
    thread_minutes: num(p.thread_minutes), parallel, jarvis_minutes: num(p.jarvis_minutes), people, tasks,
  }
}

/**
 * OW's client-time answer, checked and trimmed (TIME_ROWS): each project a uuid, every number a number, every text one
 * line. Null for an answer that is not one (a 200 with another shape is a failed read, never "no time").
 */
export function parseClientTime(raw: unknown): ClientTime | null {
  const o = raw as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.projects)) return null
  const viewer = (o.viewer && typeof o.viewer === 'object' ? o.viewer : {}) as Record<string, unknown>
  const projects: TimeProject[] = []
  for (const x of o.projects.slice(0, 40) as unknown[]) {
    const p = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    if (!isUuid(p.project_id)) continue
    const lev = p.leverage && typeof p.leverage === 'object' ? (p.leverage as Record<string, unknown>) : null
    projects.push({
      project_id: p.project_id, name: str(p.name, 80), today: p.today == null ? null : period(p.today), week: p.week == null ? null : period(p.week),
      threads: (Array.isArray(p.threads) ? p.threads : []).slice(0, TIME_ROWS.threads).map(t => {
        const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
        return {
          session_id: str(r.session_id, 100), title: optStr(r.title, 80), member_email: str(r.member_email, 120), member_name: str(r.member_name, 60),
          task: optStr(r.task, 120), ticket_id: optStr(r.ticket_id, 60), minutes_today: num(r.minutes_today), last_activity_at: str(r.last_activity_at, 40), active_now: r.active_now === true,
        }
      }),
      leverage: lev
        ? { ratio: typeof lev.ratio === 'number' && Number.isFinite(lev.ratio) && lev.ratio >= 0 ? lev.ratio : null, build_hours: num(lev.build_hours), actual_hours: num(lev.actual_hours), window: str(lev.window, 60), note: str(lev.note, 200) }
        : null,
    })
  }
  return {
    asOf: typeof o.as_of === 'string' ? o.as_of.slice(0, 40) : '',
    day: typeof o.day === 'string' ? o.day.slice(0, 20) : '',
    weekStart: typeof o.week_start === 'string' ? o.week_start.slice(0, 20) : '',
    viewer: { email: str(viewer.email, 120), canSeeLeverage: viewer.can_see_leverage === true },
    skipped: (Array.isArray(o.skipped) ? o.skipped : []).filter(isUuid).slice(0, 40),
    projects,
  }
}

// ---------------------------------------------------------------- a thread's current project

/**
 * (0.6.0) A source's word on a thread's current project, merged with what is on record: the latest source wins (by
 * `at`). The same project keeps its task (a new one replaces it); another project starts with the task given, or
 * none. Null when nothing changes: an older source than the one on record, or the same word again.
 */
export function mergeCurrent(prev: Current | undefined, next: { pid: string; how: How; at: number; task?: string | undefined }, client: boolean): Current | null {
  if (!isUuid(next.pid) || !Number.isFinite(next.at)) return null
  const had = prev && typeof prev === 'object' && isUuid(prev.pid) ? prev : undefined
  if (had && Number(had.at) > next.at) return null
  const declared = [...(had?.declared ?? []).filter(isUuid)]
  if (client && !declared.includes(next.pid)) declared.push(next.pid)
  const kept = declared.slice(-DECLARED_MAX)
  const extra = { ...(had?.seen ? { seen: had.seen } : {}), ...(had?.act ? { act: had.act } : {}), ...(had?.chk ? { chk: had.chk } : {}), ...(kept.length ? { declared: kept } : {}) }
  if (had && had.pid === next.pid) {
    const task = next.task ?? had.task
    const merged: Current = { pid: next.pid, how: next.how, at: next.at, ...(task ? { task } : {}), ...extra }
    return JSON.stringify(merged) === JSON.stringify(had) ? null : merged
  }
  return { pid: next.pid, how: next.how, at: next.at, ...(next.task ? { task: next.task } : {}), ...extra }
}

/** The task label a worklog-hook command declares (`--task "<label>"` or `--task=<label>`), as typed, at most 120 characters; '' when it declares none. */
export function taskFrom(command: unknown): string {
  if (typeof command !== 'string' || command.length > 20_000 || !/worklog-hook\.js\b/.test(command)) return ''
  const m = /worklog-hook\.js\b[^\n]*?\s--task(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'][^\s]*))/.exec(command)
  if (!m) return ''
  const label = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1')
  return taskLabel(label)
}

/** A task label as it is kept: one line, its first 120 characters. */
export function taskLabel(text: unknown): string {
  const one = (typeof text === 'string' ? text : '').normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return one.slice(0, 120).trim()
}

// ---------------------------------------------------------------- what is shown

/** (0.6.0) The pane's title and the name a thread's project goes by: internal ops and self-funnel by their own words. */
export const INTERNAL_NAME = 'Massmarket internal'
export const SELF_FUNNEL_NAME = 'Massmarket sales and marketing'

export function displayName(kind: ProjectKind, name: string): string {
  return kind === 'internal_ops' ? INTERNAL_NAME : kind === 'self_funnel' ? SELF_FUNNEL_NAME : name
}

/** A project's kind when OW's skill map does not say: Massmarket's internal-ops project by its id, any other a client. */
export const kindOf = (pid: string, skills: readonly SkillEntry[]): ProjectKind => skills.find(s => s.project_id === pid)?.kind ?? (pid === INTERNAL_OPS ? 'internal_ops' : 'client')

/** A client's name from the skill map's or OW's project name: the short name the bridge gives clients everywhere. */
export const clientName = (name: string): string => (name ? shortName(name) : '')

/** `42m`, `1h 05m`. */
export function fmtMin(m: number): string {
  const t = Math.max(0, Math.round(Number(m) || 0))
  return t < 60 ? `${t}m` : `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m`
}

/** Hours with one decimal: `1.3`. */
export const fmtHours = (m: number): string => (Math.max(0, Number(m) || 0) / 60).toFixed(1)

/** A number of hours as OW gives them, with one decimal. */
const fmtH = (h: number): string => Math.max(0, Number(h) || 0).toFixed(1)

/** Two significant digits: `1.3`, `12`, `0.46`. */
export function fmtX(x: number): string {
  const v = Number(x)
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v >= 100) return String(Math.round(v))
  const s = v.toPrecision(2)
  return s.includes('e') ? String(Math.round(v)) : s
}

/** A moment as the person's own clock writes it: `2:14 PM`. */
export function localClock(t: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(t)).replace(/ /g, ' ')
  } catch {
    return new Date(t).toISOString().slice(11, 16)
  }
}

/** Someone's first name, or the part of their address before the @ when OW gives no name. */
export function firstName(name: string, email: string): string {
  const first = (name || '').trim().split(/\s+/)[0] ?? ''
  return first || (email.split('@')[0] ?? '') || 'someone'
}

/**
 * What a thread has on record of its project's time (`mm.time`): the project as last read, today's read (`at`, `asOf`)
 * and the week's (`weekAt`, `weekAsOf`) each with its own time, and a read that failed after them.
 */
export type TimeRecord = { at?: number; asOf?: string; weekAt?: number; weekAsOf?: string; p?: TimeProject; failedAt?: number; skipped?: true }

/** (0.6.0, OW contract 2026-10-25) A project's week (and leverage) is asked for at most this often; today on every read. */
export const WEEK_EVERY_MS = 30 * 60_000

/** (0.6.0) Whether a read of this project asks for the week too: on its first read, and once WEEK_EVERY_MS has passed. */
export const weekIsDue = (rec: TimeRecord | undefined, now: number): boolean => !(now - (Number(rec?.weekAt) || 0) < WEEK_EVERY_MS)

/**
 * (0.6.0) An answer for one project merged into its record: today (and its threads) from this read when it carries
 * today, the week (and its leverage) from this read when the week was asked for and came, and otherwise each kept as
 * last read, with that read's own as-of. A failure noted before is cleared.
 */
export function mergeTime(prev: TimeRecord | undefined, got: TimeProject, at: number, asOf: string, askedWeek: boolean): TimeRecord {
  const old = prev?.p
  const todayCame = got.today !== null
  const weekCame = askedWeek && got.week !== null
  const p: TimeProject = {
    project_id: got.project_id,
    name: got.name || old?.name || '',
    today: todayCame ? got.today : (old?.today ?? null),
    week: weekCame ? got.week : (old?.week ?? null),
    threads: todayCame ? got.threads : (old?.threads ?? []),
    leverage: weekCame ? got.leverage : (old?.leverage ?? null),
  }
  const rec: TimeRecord = {
    at: todayCame || prev?.at === undefined ? at : prev.at,
    asOf: todayCame || prev?.asOf === undefined ? asOf : prev.asOf,
    p,
  }
  if (askedWeek) rec.weekAt = at
  else if (prev?.weekAt !== undefined) rec.weekAt = prev.weekAt
  if (weekCame) rec.weekAsOf = asOf
  else if (prev?.weekAsOf !== undefined) rec.weekAsOf = prev.weekAsOf
  return rec
}

export type TrackInput = {
  /** The project's name as shown (`displayName`). */
  client: string
  task?: string | undefined
  time?: TimeRecord | undefined
  /** OW answered 404 for the route in the last 30 minutes. */
  missing: boolean
  canSeeLeverage: boolean
  /** Whether a session id is one of this thread's own. */
  mine: (sessionId: string) => boolean
  /** The app thread a row's press opens, when it is another thread on this machine. */
  openable?: (sessionId: string) => string | undefined
}

/** (0.6.0, verbatim) What the dim explanation under the numbers says. */
export const numbersNote = (client: string): string =>
  `Tracked counts each minute once per person. In threads counts every thread in full. Parallel is the second divided by the first. Jarvis is work done for ${client} with nobody in the thread.`

export const NOT_AVAILABLE = 'Time numbers are not available yet.'
export const CHECKING_TIME = 'Checking…'
export const COULD_NOT_REFRESH = ' · could not refresh; showing the last numbers'

const threads = (n: number): string => `${n} thread${n === 1 ? '' : 's'}`

/** This thread's minutes today, and whether its session is in the numbers at all. */
export function thisThread(p: TimeProject | undefined, mine: (sid: string) => boolean): { minutes: number; counted: boolean } {
  const rows = (p?.threads ?? []).filter(t => mine(t.session_id))
  return { minutes: rows.reduce((sum, t) => sum + t.minutes_today, 0), counted: rows.length > 0 }
}

function numbersLine(label: string, p: TimePeriod): string {
  const parallel = p.parallel === null ? '' : ` · parallel ${fmtX(p.parallel)}×`
  return `${label}: ${fmtHours(p.client_minutes)} h tracked · ${fmtHours(p.thread_minutes)} h in threads${parallel} · Jarvis ${fmtHours(p.jarvis_minutes)} h`
}

/**
 * (0.6.0) The Tracking part of the pane, line by line, in the words of the spec (2026-10-25, verbatim labels): the
 * heading, this thread and the client today, the tasks today, the threads today, the numbers, and when they are from.
 */
export function trackLines(t: TrackInput): MmTrackLine[] {
  const out: MmTrackLine[] = []
  out.push({ text: `Tracking to ${t.client} · ${t.task ? t.task : 'no task declared yet'}`, bold: true })
  const rec = t.time
  const p = rec?.p
  const day = p?.today
  if (!p || !day) {
    out.push({ text: rec?.skipped || rec?.failedAt || t.missing ? NOT_AVAILABLE : CHECKING_TIME, dim: true })
    return out
  }
  const here = thisThread(p, t.mine)
  const today = `${t.client} today: ${fmtMin(day.client_minutes)} tracked across ${threads(p.threads.length)}`
  out.push({ text: here.counted ? `This thread: ${fmtMin(here.minutes)} today · ${today}` : `This thread: not in the numbers yet (they refresh every 5 minutes) · ${today}`, dim: true })

  out.push({ text: 'Tasks today', bold: true })
  if (!day.tasks.length) out.push({ text: `Nothing tracked to ${t.client} yet today.`, dim: true })
  const names = new Map(day.people.map(x => [x.email.toLowerCase(), x.name]))
  for (const task of day.tasks) {
    const who = task.people.map(e => firstName(names.get(e.toLowerCase()) ?? '', e)).join(', ')
    out.push({ text: `${task.active_now ? '● ' : '  '}${task.task ?? 'No task declared'} · ${fmtMin(task.minutes)}${who ? ` · ${who}` : ''}` })
  }

  if (p.threads.length) {
    out.push({ text: 'Threads today', bold: true })
    for (const th of p.threads) {
      const mine = t.mine(th.session_id)
      const name = th.member_name || (th.member_email.split('@')[0] ?? '') || 'someone'
      const row = `${th.active_now ? '● ' : '  '}${th.title ?? 'Untitled thread'}  ${name} · ${th.task ?? 'no task'} · ${fmtMin(th.minutes_today)}${mine ? ' (this thread)' : ''}`
      const open = mine ? undefined : t.openable?.(th.session_id)
      out.push(open ? { text: row, open } : { text: row })
    }
  }

  out.push({ text: 'Numbers', bold: true })
  out.push({ text: numbersLine('Today', day) })
  // a week never read yet is not loaded: no line, never zeros
  if (p.week) out.push({ text: numbersLine('This week', p.week) })
  const lev = p.leverage
  if (t.canSeeLeverage && lev) {
    if (lev.ratio !== null) out.push({ text: `Leverage: ${fmtX(lev.ratio)}× (${fmtH(lev.build_hours)} quoted hours done in ${fmtH(lev.actual_hours)} h, last 20 business days)` })
    else if (lev.note) out.push({ text: `Leverage: ${lev.note}` })
  }
  out.push({ text: numbersNote(t.client), dim: true })

  const asOf = Date.parse(rec?.asOf ?? '')
  const when = Number.isFinite(asOf) ? asOf : Number(rec?.at) || 0
  const failed = Number(rec?.failedAt) > (Number(rec?.at) || 0)
  out.push({ text: `As of ${localClock(when)}${failed ? COULD_NOT_REFRESH : ''}`, dim: true })
  return out
}

/** (0.6.0, verbatim) The status line: what this thread is counted to, or that it is not counted yet. Undefined clears it. */
export function trackStatus(o: { client?: string | undefined; task?: string | undefined; minutes?: number | undefined; counted?: boolean; nudge?: boolean }): string | undefined {
  if (o.client) {
    if (o.counted) return `⏱ ${o.client}${o.task ? ` · ${o.task}` : ''} · this thread ${fmtMin(o.minutes ?? 0)} today`
    return `⏱ Tracking to ${o.client}`
  }
  return o.nudge ? '⏱ Not tracked to a client yet' : undefined
}

// ---------------------------------------------------------------- the pane opening by itself (§4)

/** What the opening rule reads of the session's own record. */
export type PaneSession = { single?: boolean; closed?: string; handled?: string }

/**
 * (0.6.0) Whether the pane may open by itself for `pid`: never in a SINGLE-SESSION run or under MM_UNATTENDED=1, and
 * not for the project whose pane the person closed in this session (another project opens it again).
 */
export const opensBySelf = (s: PaneSession, pid: string, unattended: boolean): boolean => !s.single && !unattended && !(s.closed !== undefined && s.closed === pid)

/** (0.6.0) The person closed the pane: what the session keeps, the project it was drawn for (none yet: ''). */
export const afterPersonClose = (s: PaneSession): { closed: string } => ({ closed: s.handled ?? '' })

// ---------------------------------------------------------------- the band (§5) and the notes for Claude

export const NUDGE_TEXT = 'This thread is not tracked to a client yet.'
export const NUDGE_INTERNAL = 'Massmarket internal'
export const NUDGE_NONE = 'Not client work'
export const trackLabel = (client: string): string => `Track to ${client}`
/** The person's prompts after which a thread with no current project says so. */
export const NUDGE_AFTER = 2

/** (0.6.0, verbatim) The note a Track to <Client> press adds for Claude. */
export const pressNote = (client: string, skill: string): string =>
  `[mm-bridge] The person marked this thread as ${client}'s work. Before your next step, load the ${skill} skill with the Skill tool so the time tracker counts this thread's time to ${client}.`

/** (0.6.0, verbatim) The note a Massmarket internal press adds for Claude. */
export const INTERNAL_NOTE = '[mm-bridge] The person marked this thread as Massmarket internal work. Before your next step, load the massmarket-internal-ops skill with the Skill tool so the time tracker counts it.'

/** (0.6.0, verbatim) The line above the client part in a second thread. */
export const secondLine = (client: string, title: string): string => `This is a second thread for ${client}. The reply package is picked up in "${title}".`

/** A thread title as it may go into a sentence for Claude. */
export const titleForClaude = (title: string): string => cleanTitle(title) || 'another thread'
