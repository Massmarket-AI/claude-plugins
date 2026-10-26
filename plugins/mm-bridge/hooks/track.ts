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

import { INTERNAL_OPS, cleanText, cleanTitle, isUuid, shortName, shownText } from './queue'

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

// ---------------------------------------------------------------- deliverable lines (0.7.0, OW `with=lines`)
//
// Rob, 2026-10-26: "I want the live panel not just to show what clients are being tracked, but also the task that it
// thinks we're working on. Maybe even separately, it could show which specific deliverable line those hours are being
// added for. If it's something that's a new scope, it would be showing up on a new line. That probably should trigger
// the thread to ask for approval to create the new line, or ask if it would be reconciled."
//
// So OW's client-time answer carries, with `&with=lines`, each project's quote lines (`lines`) and its proposed new
// lines (`proposals`), each thread's line (`thread.line`: what its minutes count toward, and when they match none, the
// lines they could be) and each task's line (`task.line_key`). An OW that does not have them yet answers as before:
// every new field is optional here, and a field that is absent or of another shape draws nothing (0.6.0's pane).

/** What a line of a client's quote is: a deliverable, the fixes line, Rob's own time, or an hour bank. */
export type LineType = 'deliverable' | 'fixes' | 'rob_time' | 'bank'
/**
 * One line of a project's quote. `minutes`: this period's counted minutes on it; null when the viewer may not see them
 * (an estimated line, for anyone but a PM or the founder). (0.7.1) `told`: new scope the client was told about (it went
 * ahead without waiting for a yes); `billed`: whether it is on an invoice yet. Each only from an OW that sends it.
 */
export type ScopeLine = { line_key: string; title: string; line_type: LineType; status: string; estimate_hours: number | null; minutes: number | null; told?: boolean; billed?: boolean }
/**
 * (0.7.1, Rob 2026-10-26, decision_log 99395076) How OW settled new scope: small, so it goes ahead and the client is
 * told (`tell_and_go`); it waits for the client's yes (`needs_yes`); or it is urgent and goes ahead now (`urgent`).
 */
export type ProposalMode = 'tell_and_go' | 'needs_yes' | 'urgent'
/** (0.7.1) Where small new scope is billed: on the next invoice, or out of the client's prepaid hours. */
export type ProposalSettle = 'next_invoice' | 'prepaid_hours'
/** (0.7.1) Why OW chose the mode. */
export type ProposalReason = 'small' | 'over_limit' | 'always_ask' | 'small_items_cap' | 'no_estimate' | 'urgent'
/** A proposed new line: an OW ticket waiting for the client's yes. (0.7.1) With how OW settled it, from an OW that sends it. */
export type ScopeProposal = { ticket_id8: string; title: string; created_at: string; mode?: ProposalMode; estimate_hours?: number; reason?: ProposalReason }
/** What OW makes of a thread's minutes. */
export type LineSignal = 'on_line' | 'account_work' | 'fix' | 'unmatched' | 'maybe_new_scope' | 'no_quote' | 'proposed'
/** How a thread's line was found: the line its task label declared, its ticket's line, the hour bank, or none. */
export type LineVia = 'declared' | 'ticket' | 'bank' | 'none'
export type LineRef = { line_key: string; title: string; line_type: LineType }
/** (0.7.0) A thread's line as OW gives it (`thread.line`). */
export type ThreadLine = {
  via: LineVia
  line_key: string | null
  title: string | null
  line_type: LineType | null
  estimate_hours: number | null
  signal: LineSignal
  candidates: LineRef[]
  proposal: { ticket_id8: string; title: string; mode?: ProposalMode } | null
}

/** A line's key as OW writes it (`L-1a2b3c4d`), in characters that are safe in a sentence for Claude and in a shell command. */
export const LINE_KEY = /^L-[0-9A-Za-z]{4,32}$/
/** An OW ticket's short id: its first 8 hex digits. */
export const TICKET8 = /^[0-9a-f]{8}$/i
/** The most lines, proposals and candidates kept from an answer. */
export const LINE_ROWS = { lines: 40, proposals: 10, candidates: 5 } as const

const LINE_TYPES: ReadonlySet<string> = new Set(['deliverable', 'fixes', 'rob_time', 'bank'])
const SIGNALS: ReadonlySet<string> = new Set(['on_line', 'account_work', 'fix', 'unmatched', 'maybe_new_scope', 'no_quote', 'proposed'])
const VIAS: ReadonlySet<string> = new Set(['declared', 'ticket', 'bank', 'none'])
const MODES: ReadonlySet<string> = new Set(['tell_and_go', 'needs_yes', 'urgent'])
const SETTLES: ReadonlySet<string> = new Set(['next_invoice', 'prepaid_hours'])
const REASONS: ReadonlySet<string> = new Set(['small', 'over_limit', 'always_ask', 'small_items_cap', 'no_estimate', 'urgent'])

/** (0.7.1) OW's mode, settle and reason, each when it is one OW uses. */
export const modeOf = (v: unknown): ProposalMode | undefined => (MODES.has(String(v)) ? (v as ProposalMode) : undefined)
export const settleOf = (v: unknown): ProposalSettle | undefined => (SETTLES.has(String(v)) ? (v as ProposalSettle) : undefined)
export const reasonOf = (v: unknown): ProposalReason | undefined => (REASONS.has(String(v)) ? (v as ProposalReason) : undefined)

const objOf = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** A number OW may leave out: a finite number of zero or more, else null. */
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
/** (0.7.1) An estimate of hours as OW or Claude gives one: a finite number above zero, else undefined. */
const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

function scopeLine(raw: unknown): ScopeLine | null {
  const o = objOf(raw)
  if (typeof o.line_key !== 'string' || !LINE_KEY.test(o.line_key) || !LINE_TYPES.has(String(o.line_type))) return null
  return {
    line_key: o.line_key, title: shownText(o.title, 120) || o.line_key, line_type: o.line_type as LineType, status: shownText(o.status, 40),
    estimate_hours: optNum(o.estimate_hours), minutes: optNum(o.minutes),
    // (0.7.1) only from an OW that sends them
    ...(typeof o.told === 'boolean' ? { told: o.told } : {}),
    ...(typeof o.billed === 'boolean' ? { billed: o.billed } : {}),
  }
}

function lineRef(raw: unknown): LineRef | null {
  const o = objOf(raw)
  if (typeof o.line_key !== 'string' || !LINE_KEY.test(o.line_key)) return null
  return { line_key: o.line_key, title: shownText(o.title, 120) || o.line_key, line_type: LINE_TYPES.has(String(o.line_type)) ? (o.line_type as LineType) : 'deliverable' }
}

function scopeProposal(raw: unknown): ScopeProposal | null {
  const o = objOf(raw)
  if (typeof o.ticket_id8 !== 'string' || !TICKET8.test(o.ticket_id8)) return null
  const mode = modeOf(o.mode)
  const estimate = posNum(o.estimate_hours)
  const reason = reasonOf(o.reason)
  return {
    ticket_id8: o.ticket_id8.toLowerCase(), title: shownText(o.title, 120) || o.ticket_id8.toLowerCase(), created_at: shownText(o.created_at, 40),
    // (0.7.1) only from an OW that sends them
    ...(mode ? { mode } : {}),
    ...(estimate !== undefined ? { estimate_hours: estimate } : {}),
    ...(reason ? { reason } : {}),
  }
}

/** (0.7.0) A thread's line, checked: undefined for one that is absent or whose signal OW does not use. */
export function parseThreadLine(raw: unknown): ThreadLine | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = objOf(raw)
  if (!SIGNALS.has(String(o.signal))) return undefined
  const proposal = objOf(o.proposal)
  const proposalMode = modeOf(proposal.mode)
  return {
    via: VIAS.has(String(o.via)) ? (o.via as LineVia) : 'none',
    line_key: typeof o.line_key === 'string' && LINE_KEY.test(o.line_key) ? o.line_key : null,
    title: optStr(o.title, 120),
    line_type: LINE_TYPES.has(String(o.line_type)) ? (o.line_type as LineType) : null,
    estimate_hours: optNum(o.estimate_hours),
    signal: o.signal as LineSignal,
    candidates: (Array.isArray(o.candidates) ? o.candidates : []).slice(0, 20).map(lineRef).filter((x): x is LineRef => x !== null).slice(0, LINE_ROWS.candidates),
    proposal: typeof proposal.ticket_id8 === 'string' && TICKET8.test(proposal.ticket_id8)
      ? { ticket_id8: proposal.ticket_id8.toLowerCase(), title: shownText(proposal.title, 120), ...(proposalMode ? { mode: proposalMode } : {}) }
      : null,
  }
}

/**
 * (0.7.1) What OW's client-time answer says of a project's new-scope settings (`with=lines`): the prepaid hours it has
 * left (null: none to draw on), whether it is set to always ask first, and the most hours a small item may take. Each
 * only when OW sends it in the right shape: a field that is absent or of another shape stays absent (0.7.0's rules).
 */
export type ScopeSettings = { prepaid_hours_left?: number | null; always_ask?: boolean; small_limit_hours?: number }

function scopeSettings(p: Record<string, unknown>): ScopeSettings {
  const prepaid = p.prepaid_hours_left === null ? null : optNum(p.prepaid_hours_left) ?? undefined
  const limit = posNum(p.small_limit_hours)
  return {
    ...(prepaid !== undefined ? { prepaid_hours_left: prepaid } : {}),
    ...(typeof p.always_ask === 'boolean' ? { always_ask: p.always_ask } : {}),
    ...(limit !== undefined ? { small_limit_hours: limit } : {}),
  }
}

/** (0.7.0) A project's lines or proposals: undefined when OW sent no list (it does not have them yet), else the entries of the right shape. */
function listOf<T>(raw: unknown, each: (x: unknown) => T | null, max: number): T[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.slice(0, 200).map(each).filter((x): x is T => x !== null).slice(0, max)
}

// ---------------------------------------------------------------- client time (OW's /api/ext/client-time)

export type TimePerson = { email: string; name: string; minutes: number }
/** (0.7.0) `line_key`: the line the task's minutes count toward, when OW says. */
export type TimeTask = { task: string | null; ticket_id: string | null; minutes: number; thread_count: number; people: string[]; last_activity_at: string; active_now: boolean; line_key?: string }
export type TimePeriod = {
  client_minutes: number
  by_source: { claude_code: number; timer: number; browser: number; meeting: number }
  thread_minutes: number
  parallel: number | null
  jarvis_minutes: number
  people: TimePerson[]
  tasks: TimeTask[]
}
/** (0.7.0) `line`: what OW makes of the thread's minutes (`thread.line`), when it says. */
export type TimeThread = { session_id: string; title: string | null; member_email: string; member_name: string; task: string | null; ticket_id: string | null; minutes_today: number; last_activity_at: string; active_now: boolean; line?: ThreadLine }
export type TimeLeverage = { ratio: number | null; build_hours: number; actual_hours: number; window: string; note: string }
/**
 * One project's time. A period OW was not asked for (`periods=today`) is null; `threads` come with today alone and
 * `leverage` with the week alone. (0.7.0) `lines` and `proposals` come with today too, only from an OW that has them
 * (`with=lines`): absent, not empty, when it does not. (0.7.1) So do the new-scope settings (`ScopeSettings`).
 */
export type TimeProject = { project_id: string; name: string; today: TimePeriod | null; week: TimePeriod | null; threads: TimeThread[]; leverage: TimeLeverage | null; lines?: ScopeLine[]; proposals?: ScopeProposal[] } & ScopeSettings
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
      ...(typeof o.line_key === 'string' && LINE_KEY.test(o.line_key) ? { line_key: o.line_key } : {}),
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
    // (0.7.0) only from an OW that sends them: absent stays absent
    const lines = listOf(p.lines, scopeLine, LINE_ROWS.lines)
    const proposals = listOf(p.proposals, scopeProposal, LINE_ROWS.proposals)
    projects.push({
      project_id: p.project_id, name: str(p.name, 80), today: p.today == null ? null : period(p.today), week: p.week == null ? null : period(p.week),
      threads: (Array.isArray(p.threads) ? p.threads : []).slice(0, TIME_ROWS.threads).map(t => {
        const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
        const line = parseThreadLine(r.line)
        return {
          session_id: str(r.session_id, 100), title: optStr(r.title, 80), member_email: str(r.member_email, 120), member_name: str(r.member_name, 60),
          task: optStr(r.task, 120), ticket_id: optStr(r.ticket_id, 60), minutes_today: num(r.minutes_today), last_activity_at: str(r.last_activity_at, 40), active_now: r.active_now === true,
          ...(line ? { line } : {}),
        }
      }),
      leverage: lev
        ? { ratio: typeof lev.ratio === 'number' && Number.isFinite(lev.ratio) && lev.ratio >= 0 ? lev.ratio : null, build_hours: num(lev.build_hours), actual_hours: num(lev.actual_hours), window: str(lev.window, 60), note: str(lev.note, 200) }
        : null,
      ...(lines ? { lines } : {}),
      ...(proposals ? { proposals } : {}),
      // (0.7.1) only from an OW that sends them
      ...scopeSettings(p),
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
  // (0.7.0) the lines and proposals come with today, as the threads do; (0.7.1) and so do the new-scope settings
  const lines = todayCame ? got.lines : old?.lines
  const proposals = todayCame ? got.proposals : old?.proposals
  const from = todayCame ? got : old
  const settings: ScopeSettings = {
    ...(from?.prepaid_hours_left !== undefined ? { prepaid_hours_left: from.prepaid_hours_left } : {}),
    ...(from?.always_ask !== undefined ? { always_ask: from.always_ask } : {}),
    ...(from?.small_limit_hours !== undefined ? { small_limit_hours: from.small_limit_hours } : {}),
  }
  const p: TimeProject = {
    project_id: got.project_id,
    name: got.name || old?.name || '',
    today: todayCame ? got.today : (old?.today ?? null),
    week: weekCame ? got.week : (old?.week ?? null),
    threads: todayCame ? got.threads : (old?.threads ?? []),
    leverage: weekCame ? got.leverage : (old?.leverage ?? null),
    ...(lines ? { lines } : {}),
    ...(proposals ? { proposals } : {}),
    ...settings,
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
  // (0.7.0) what this thread's minutes count toward, under the heading; nothing from an OW that does not say
  const line = lineOfThread(p, t.mine)?.line
  if (line) out.push({ text: countsToward(line, p, t.client) })
  const here = thisThread(p, t.mine)
  const today = `${t.client} today: ${fmtMin(day.client_minutes)} tracked across ${threads(p.threads.length)}`
  out.push({ text: here.counted ? `This thread: ${fmtMin(here.minutes)} today · ${today}` : `This thread: not in the numbers yet (they refresh every 5 minutes) · ${today}`, dim: true })

  out.push({ text: 'Tasks today', bold: true })
  if (!day.tasks.length) out.push({ text: `Nothing tracked to ${t.client} yet today.`, dim: true })
  const names = new Map(day.people.map(x => [x.email.toLowerCase(), x.name]))
  for (const task of day.tasks) {
    const who = task.people.map(e => firstName(names.get(e.toLowerCase()) ?? '', e)).join(', ')
    // (0.7.0) the line the task counts toward, when it is one of the project's lines
    const onLine = task.line_key ? lineByKey(p, task.line_key) : undefined
    out.push({ text: `${task.active_now ? '● ' : '  '}${task.task ?? 'No task declared'} · ${fmtMin(task.minutes)}${who ? ` · ${who}` : ''}${onLine ? ` → ${shownText(onLine.title, 28)}` : ''}` })
  }

  // (0.7.0) the lines that took minutes today (those the viewer may see), then the new lines proposed
  const counted = (p.lines ?? []).filter(l => l.minutes !== null && l.minutes > 0)
  const proposed = p.proposals ?? []
  if (counted.length || proposed.length) {
    out.push({ text: LINES_TODAY, bold: true })
    for (const l of counted) out.push({ text: `${l.title} · ${fmtMin(l.minutes ?? 0)}${l.estimate_hours !== null && l.minutes !== null ? ` · est ${fmtEst(l.estimate_hours)} h` : ''}${toldUnbilled(l) ? NEXT_INVOICE : ''}` })
    // (0.7.1) new scope that goes ahead (small or urgent) is told in the next reply; the rest waits for a yes
    for (const pr of proposed) out.push({ text: goesAhead(pr.mode) ? `New scope: ${pr.title} · told in the next reply` : `Proposed: ${pr.title} · waiting for yes` })
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

/**
 * (0.6.0, verbatim) The status line: what this thread is counted to, or that it is not counted yet. Undefined clears it.
 * (0.7.0) A thread on a line names it after the task: `→ <line title>`, at most 24 characters.
 */
export function trackStatus(o: { client?: string | undefined; task?: string | undefined; minutes?: number | undefined; counted?: boolean; nudge?: boolean; line?: string | undefined }): string | undefined {
  if (o.client) {
    if (o.counted) return `⏱ ${o.client}${o.task ? ` · ${o.task}` : ''}${o.line ? ` → ${shownText(o.line, 24)}` : ''} · this thread ${fmtMin(o.minutes ?? 0)} today`
    return `⏱ Tracking to ${o.client}`
  }
  return o.nudge ? '⏱ Not tracked to a client yet' : undefined
}

// ---------------------------------------------------------------- (0.7.0) the line a thread counts toward

/** (0.7.0) The heading of the pane's part that lists the lines that took minutes today. */
export const LINES_TODAY = 'Lines today'

/** Hours as an estimate is written: `12`, `1.5`. */
export function fmtEst(h: number): string {
  const r = Math.round(Math.max(0, Number(h) || 0) * 10) / 10
  return String(r)
}

/** A project line by its key. */
export const lineByKey = (p: TimeProject | undefined, key: string | null | undefined): ScopeLine | undefined => (key ? (p?.lines ?? []).find(l => l.line_key === key) : undefined)

/** (0.7.1) Whether new scope goes ahead without waiting for a yes: small (`tell_and_go`) or urgent. */
export const goesAhead = (mode: ProposalMode | undefined): boolean => mode === 'tell_and_go' || mode === 'urgent'

/** (0.7.1) A thread's proposal's mode: OW's on the thread's line, else the project's proposal's by its ticket. */
export const proposalMode = (l: ThreadLine, p: TimeProject | undefined): ProposalMode | undefined =>
  l.proposal?.mode ?? (l.proposal ? (p?.proposals ?? []).find(x => x.ticket_id8 === l.proposal?.ticket_id8)?.mode : undefined)

/** (0.7.1, verbatim) What a told, unbilled line adds to its Lines today row. */
export const NEXT_INVOICE = ' · new scope, next invoice'

/** (0.7.1) New scope the client was told about and that is on no invoice yet. */
export const toldUnbilled = (l: ScopeLine): boolean => l.told === true && l.billed === false

/** A line status that says it no longer takes time. */
const ENDED = /^(closed|done|complete|completed|cancelled|canceled|archived|exhausted|inactive|declined|rejected)$/i

/** (0.7.0) The project's hour bank: its most recent active bank line (the last OW lists), or undefined. */
export function bankLine(p: TimeProject | undefined): ScopeLine | undefined {
  const banks = (p?.lines ?? []).filter(l => l.line_type === 'bank' && !ENDED.test(l.status))
  const active = banks.filter(l => /^active$/i.test(l.status))
  return (active.length ? active : banks).at(-1)
}

/**
 * (0.7.0) This thread's line: from the newest of its own sessions' rows that carries one, with the task label that
 * row was counted under (a line OW worked out for an older label is not this label's).
 */
export function lineOfThread(p: TimeProject | undefined, mine: (sessionId: string) => boolean): { line: ThreadLine; task: string } | undefined {
  const rows = (p?.threads ?? []).filter(t => t.line && mine(t.session_id))
  rows.sort((a, b) => (Date.parse(b.last_activity_at) || 0) - (Date.parse(a.last_activity_at) || 0))
  const row = rows[0]
  return row?.line ? { line: row.line, task: row.task ?? '' } : undefined
}

/** (0.7.0) Whether the thread's minutes count toward a line: on one, or a fix on one. */
export const onALine = (l: ThreadLine): boolean => l.signal === 'on_line' || (l.signal === 'fix' && l.via !== 'none' && Boolean(l.title || l.line_key))

/** The title of the line a thread counts toward: OW's, else the project line's, else its key. */
const titleOf = (l: ThreadLine, p: TimeProject | undefined): string => l.title || lineByKey(p, l.line_key)?.title || l.line_key || ''

/** (0.7.0) The line's title the status line names, when the thread is on one. */
export const statusLineTitle = (l: ThreadLine | undefined, p: TimeProject | undefined): string | undefined => (l && onALine(l) ? titleOf(l, p) || undefined : undefined)

/** (0.7.0, verbatim) The line under the Tracking heading: what this thread's minutes count toward. */
export function countsToward(l: ThreadLine, p: TimeProject | undefined, client: string): string {
  switch (l.signal) {
    case 'on_line':
    case 'fix': {
      if (!onALine(l)) return 'Counts toward: no line yet (a fix)'
      const title = titleOf(l, p) || 'a line on the quote'
      if (l.via === 'bank') return `Counts toward: ${title} (hour bank)`
      const line = lineByKey(p, l.line_key)
      const est = l.estimate_hours ?? line?.estimate_hours ?? null
      const today = line && line.minutes !== null && line.minutes > 0 ? ` · ${fmtMin(line.minutes)} today` : ''
      return `Counts toward: ${title}${est !== null ? ` · est ${fmtEst(est)} h` : ''}${today}`
    }
    case 'account_work': {
      if (l.via !== 'bank') return 'Counts toward: account work'
      const bank = l.title || lineByKey(p, l.line_key)?.title || bankLine(p)?.title
      return bank ? `Counts toward: account work · ${bank} (hour bank)` : 'Counts toward: account work (hour bank)'
    }
    case 'proposed': {
      const title = l.proposal?.title || l.title || 'new scope'
      // (0.7.1) new scope that goes ahead (small or urgent): the client is told in the next reply
      if (goesAhead(proposalMode(l, p))) return `New scope: ${title} · ${client} is told in the next reply`
      return `Proposed new line: ${title} · waiting for ${client}'s yes`
    }
    case 'no_quote':
      return `Counts toward: no quote on record for ${client}`
    default:
      return 'Counts toward: no line yet'
  }
}

// ---------------------------------------------------------------- (0.7.0) the line band and the notes for Claude

/** The signals the thread asks about: its minutes match no line on the quote. */
export const asksForLine = (l: ThreadLine | undefined): l is ThreadLine => l?.signal === 'unmatched' || l?.signal === 'maybe_new_scope'

/** The most candidate lines the band and the thread's note offer. */
export const LINE_CHOICES = 3

/** (0.7.0) The key the band and the thread's note go by: once per project and task label in a session. */
export const lineAskKey = (pid: string, task: string | undefined): string => `${pid}|${task ?? ''}`

/** (0.7.0) Whether the line band and the thread's note may show: a client's thread in a person's session that is not a SINGLE-SESSION run or MM_UNATTENDED=1. */
export const asksInSession = (s: { single?: boolean }, unattended: boolean, client: boolean): boolean => client && !s.single && !unattended

/** (0.7.0, verbatim) The band's words. (0.7.1) For a client set to always ask first, they say so. */
export const lineAskText = (client: string, signal: LineSignal, alwaysAsk = false): string =>
  `${signal === 'maybe_new_scope' ? `${client}: this doesn't match a line on the quote.` : `${client}: which line does this work count toward?`}${alwaysAsk ? ` (${client} is set to always ask first)` : ''}`
export const LINE_NEW = 'New scope'
/** (0.7.1) The button that was Hour bank in 0.7.0. */
export const LINE_BANK = 'Prepaid hours'
export const LINE_LATER = 'Not now'

/**
 * (0.7.1) Whether the band offers Prepaid hours (and the thread's note asks about them): when the client has prepaid
 * hours left, from an OW that says (`prepaid_hours_left`); from one that does not, 0.7.0's rule (it has an hour bank).
 */
export const offersPrepaid = (p: TimeProject | undefined): boolean => {
  const left = p?.prepaid_hours_left
  return left === undefined ? Boolean(bankLine(p)) : typeof left === 'number' && left > 0
}
/** A candidate's button: its title, at most 28 characters. */
export const lineButton = (title: string): string => shownText(title, 28)

/** Text from OW or the person as it may go into a sentence for Claude or a shell command: letters, digits and . , & ' ( ) / - only. */
export const forClaude = (text: unknown, max = 120): string => cleanText(text, max)

/** (0.7.0, verbatim) The note a press on a candidate adds for Claude. */
export const lineNote = (client: string, title: string, key: string): string =>
  `[mm-bridge] The person says this thread's work counts toward ${client}'s line "${title}". Before your next step, call the mm tool with "line ${key}" and do what it returns.`

/**
 * (0.7.1, verbatim) The note a press on New scope adds for Claude. Rob, 2026-10-26 (decision_log 99395076): new scope
 * never comes out of revision hours; small new scope goes ahead and the client is told, bigger scope (or scope with no
 * estimate) waits for the client's yes, and urgent work (actively costing the client money) carries on now.
 */
export const newScopeNote = (client: string): string =>
  `[mm-bridge] The person says this thread's work is new scope for ${client}. Before your next step, write a short title for it (the words the client would see on a quote), one line on why, and your estimate in hours, and decide whether it is urgent (something broken that is costing the client money right now). Then call the mm tool with "propose <title> -- <why> -- <N>h" (add " urgent" when it is) and do what it returns. A fix to something Massmarket built is not new scope: if that is what this is, say so to the person instead.`

/** (0.7.1, verbatim) The note a press on Prepaid hours adds for Claude. */
export const bankNote = (client: string): string =>
  `[mm-bridge] The person says this thread's work comes out of ${client}'s prepaid hours. Before your next step, call the mm tool with "bank" and do what it returns.`

/** `a`, `a or b`, `a, b or c`. */
const orList = (items: readonly string[]): string => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`)

/**
 * (0.7.0, verbatim) The one note a thread gets the first time its work matches no line (per session and task label):
 * Claude asks the person where it counts, and keeps working. Only the candidates that exist are named; with no hour
 * bank its clause (and "bank") goes, and with no candidates the "does it count toward" clause (and "line") goes.
 * (0.7.1) New scope as Rob set it on 2026-10-26 (small items go ahead, bigger ones wait for a yes), and the bank as the
 * client's prepaid hours: `bank` is whether the band offers Prepaid hours (`offersPrepaid`).
 */
export function askNote(o: { client: string; task: string; candidates: readonly { line_key: string; title: string }[]; bank: boolean }): string {
  const cands = o.candidates.slice(0, LINE_CHOICES).map(c => `"${c.title}" (${c.line_key})`)
  const asks = [
    ...(cands.length ? [`does it count toward ${orList(cands)}`] : []),
    'is it new scope (small items go ahead and the client is told; bigger ones wait for their yes)',
    ...(o.bank ? ['does it come out of their prepaid hours'] : []),
  ]
  const question = asks.length > 1 ? `${asks.slice(0, -1).join(', ')}, or ${asks[asks.length - 1]}` : asks[0]
  const acts = orList([...(cands.length ? ['"line <line_key>"'] : []), '"propose <title> -- <why> -- <N>h"', ...(o.bank ? ['"bank" (prepaid hours)'] : [])])
  const work = o.task ? `this thread's work ("${o.task}")` : 'this thread\'s work'
  return `[mm-bridge] Massmarket time tracking: ${work} does not match a line on ${o.client}'s quote yet, so its minutes are not counted to a deliverable. In your next reply, ask the person one short question: ${question}? Then act on the answer with the mm tool: ${acts}. Keep working while you wait for the answer.`
}

// ---------------------------------------------------------------- (0.7.0) what `mm line`, `propose` and `bank` answer

/** The OW ticket a task label works, by the 8 hex digits it starts with; '' when it starts with none. */
export function ticketOf(task: string | undefined): string {
  const m = /^([0-9a-f]{8})(?![0-9a-z])/i.exec((task ?? '').trim())
  return m ? (m[1] ?? '').toLowerCase() : ''
}

/** A task label without the line key or ticket id it starts with. */
export const withoutPrefix = (task: string | undefined): string => (task ?? '').trim().replace(/^(?:L-[0-9A-Za-z]{4,32}|[0-9a-f]{8})(?![0-9A-Za-z])[\s:-]*/i, '').trim()

/** (0.7.0) The time-tracking hook's command that declares a task label, as the person runs it; on Windows, PowerShell's form after it. */
export function hookCommand(label: string, windows: boolean): string {
  const unix = `node ~/.claude/mm-hooks/worklog-hook.js --task "${label}"`
  return windows ? `${unix} (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "${label}")` : unix
}

/** (0.7.0, verbatim) `mm line` on a thread that works no ticket: the command that counts its work to the line from now on. */
export function declareLineText(o: { key: string; title: string; task: string | undefined; windows: boolean }): string {
  const rest = forClaude(withoutPrefix(o.task), 100) || forClaude(o.title, 100)
  return `Run this to count this thread's work to ${forClaude(o.title)} from now on: ${hookCommand(`${o.key} ${rest}`.trim(), o.windows)}`
}

/** (0.7.0, verbatim) `mm line` on a thread working a ticket, after OW linked it. */
export const linkedText = (id8: string, title: string): string => `Linked ticket ${id8} to ${forClaude(title)}; its time counts there now.`

/** (0.7.0, verbatim) `mm propose`, after OW recorded the proposal. */
export function proposedText(o: { title: string; client: string; id8: string; existing: boolean; windows: boolean }): string {
  const title = forClaude(o.title, 100)
  return `${o.existing ? 'Already proposed' : 'Proposed'} "${title}" for ${o.client} (ticket ${o.id8}). Run this so the work counts to the proposal: ${hookCommand(`${o.id8} ${title}`, o.windows)}`
}

/** (0.7.0, verbatim) `mm bank` for a client with no hour bank. */
export const noBankText = (client: string): string => `${client} has no hour bank on record; ask the person which line, or propose new scope.`

/** (0.7.1, verbatim) `mm bank` for a client OW says has no prepaid hours left. */
export const noPrepaidText = (client: string): string => `${client} has no prepaid hours left; ask the person which line, or record it as new scope.`

/** (0.7.1) The fewest and most hours an estimate may give (OW's contract). */
export const ESTIMATE_HOURS = { min: 0.25, max: 200 } as const

/** (0.7.1) The end of `mm propose`'s arguments: an estimate (`<N>h`, `<N> h`, `<N> hours`) and ` urgent` after it, or `urgent` alone. */
const ESTIMATE_PART = /^(?:(\d+(?:\.\d+)?|\.\d+)\s*(?:h|hrs?|hours?))?\s*(urgent)?$/i

/** (0.7.1) `mm propose`'s arguments: the title, why, the estimate in hours and whether it is urgent; `badEstimate` when the estimate is out of range. */
export type ProposalArgs = { title: string; why: string; estimate?: number; urgent: boolean; badEstimate?: true }

/**
 * (0.7.0) `mm propose <title> -- <why>`, split: the title (1 to 120 characters) and why (at most 500); null when there
 * is no title. (0.7.1) `-- <N>h` after it gives the estimate (0.25 to 200 hours) and ` urgent` says it is urgent, both
 * optional: `propose <title> -- <why> -- <N>h urgent`. Only a whole last part reads so (`-- urgent` alone too), so a
 * why that merely ends in the word "urgent" stays the why.
 */
export function proposalArgs(arg: string): ProposalArgs | null {
  const at = arg.indexOf(' -- ')
  const head = (at >= 0 ? arg.slice(0, at) : arg.replace(/\s--\s*$/, '')).trim()
  let rest = at >= 0 ? arg.slice(at + 4).replace(/\s--\s*$/, '').trim() : ''
  let estimate: number | undefined
  let urgent = false
  // the estimate and urgent come last, as one part or two (`-- 2h urgent`, `-- 2h -- urgent`)
  for (let i = 0; i < 2 && rest; i++) {
    const cut = rest.lastIndexOf(' -- ')
    const last = (cut >= 0 ? rest.slice(cut + 4) : rest).trim()
    const m = ESTIMATE_PART.exec(last)
    if (!m || (!m[1] && !m[2]) || (m[1] && estimate !== undefined)) break
    if (m[1]) estimate = Number(m[1])
    if (m[2]) urgent = true
    rest = cut >= 0 ? rest.slice(0, cut).trim() : ''
  }
  const title = shownText(head, 120)
  if (!title) return null
  const bad = estimate !== undefined && !(estimate >= ESTIMATE_HOURS.min && estimate <= ESTIMATE_HOURS.max)
  return { title, why: shownText(rest, 500), ...(estimate !== undefined && !bad ? { estimate } : {}), urgent, ...(bad ? { badEstimate: true as const } : {}) }
}

/** (0.7.1) `mm propose` with an estimate out of range: nothing is recorded. */
export const BAD_ESTIMATE = `The estimate is in hours, from ${ESTIMATE_HOURS.min} to ${ESTIMATE_HOURS.max}: mm propose <title> -- <why> -- <N>h (add " urgent" when it is). Nothing was recorded.`

/** (0.7.1) Hours as an estimate is said back: at most two decimals (`2`, `1.5`, `0.25`). */
export const fmtAbout = (h: number): string => String(Math.round(Math.max(0, Number(h) || 0) * 100) / 100)

/**
 * (0.7.1, verbatim; Rob 2026-10-26, decision_log 99395076) `mm propose`, after OW recorded new scope and said how it
 * goes: small, so Claude carries on and the next reply tells the client (billed at the estimate on the next invoice,
 * or out of their prepaid hours); it waits for the client's yes (over 2 hours, set to always ask, the small items
 * since the last invoice at their cap, or no estimate); or urgent, so Claude carries on now. The estimate is what is
 * billed, never the time an agent took; with no estimate, the actual time is. An OW that gives no mode gets 0.7.0's
 * answer (`proposedText`).
 */
export function recordedText(o: {
  title: string; client: string; id8: string; existing: boolean; windows: boolean
  mode: ProposalMode; settle?: ProposalSettle | undefined; reason?: ProposalReason | undefined; estimate?: number | undefined; limit?: number | undefined
}): string {
  const title = forClaude(o.title, 100)
  const c = o.client
  const cmd = hookCommand(`${o.id8} ${title}`, o.windows)
  const head = `${o.existing ? 'Already recorded' : 'Recorded'} "${title}" as ${o.mode === 'urgent' ? 'urgent ' : ''}new scope for ${c} (ticket ${o.id8}).`
  const n = o.estimate !== undefined && o.estimate > 0 ? fmtAbout(o.estimate) : ''
  const billed =
    o.settle === 'prepaid_hours'
      ? n ? `it comes out of their prepaid hours at about ${n} h` : 'the actual time comes out of their prepaid hours'
      : n ? `it goes on the next invoice at about ${n} h` : 'the actual time goes on the next invoice'
  if (o.mode === 'tell_and_go') return `${head} It's small${n ? ` (about ${n} h)` : ''}, so carry on: the next reply tells ${c}, and ${billed}. Run this so the work counts to it: ${cmd}`
  if (o.mode === 'urgent') return `${head} Carry on now: the next reply tells ${c} we're on it, and ${billed}. Run this so the work counts to it: ${cmd}`
  const pause = 'pause the new part: the next reply asks for it.'
  const limit = fmtAbout(o.limit !== undefined && o.limit > 0 ? o.limit : 2)
  const why =
    o.reason === 'over_limit' && n ? `At about ${n} h it needs ${c}'s yes first, so ${pause}`
    : o.reason === 'always_ask' ? `${c} is set to always ask first, so ${pause}`
    : o.reason === 'small_items_cap' ? `${c}'s small new-scope items since the last invoice already add up to ${limit} hour${limit === '1' ? '' : 's'}, so this one needs their yes first. Pause the new part: the next reply asks for it.`
    : o.reason === 'no_estimate' ? `Without an estimate it needs ${c}'s yes first, so ${pause}`
    : `It needs ${c}'s yes first, so ${pause}`
  return `${head} ${why} Run this so any time already spent counts to it: ${cmd}`
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
