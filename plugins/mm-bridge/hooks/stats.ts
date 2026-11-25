// (0.7.77, Rob 2026-11-25: "maybe some of the stats from daily it support image would be cool as well so they can see their hours
// and parallization score maybe others like total tokens. maybe there should be stats. i dont want to get overcluttered but a team
// stats dashboard would be good too.") Today's numbers in the side pane. Pure: what OW's `GET /api/ext/day-stats` answers, checked,
// and every word it is drawn with.
//
// ⛔ THE SAME FIGURES AS THE 9 AM TEAM IMAGE, FOR TODAY SO FAR. OW works them out with the image's own code (its `memberDayHours`):
// Hours are the time recorded to clients, parallel threads counted in full; Work hours are the wall clock of any work, overlaps once;
// Parallel is Hours ÷ Work hours; tokens are the person's Claude Code tokens of the New York day, the runners' left out. OW reads them
// at most once every 10 minutes for everyone, and the bridge asks every 10 minutes.
// ⛔ WHO SEES WHAT. Everyone gets their own line, under the You section's dots, and one line per person at the top of Team now
// (Rob, 2026-11-25: "no need to hide team view from anyone, its important for people to be a ble to see that a team member has
// starting working on something they handed over"). The bridge draws the team rows OW sends; an OW that sends none draws none.
// ⛔ Read-only: nothing here sends, pins, sounds or writes anywhere but the bridge's own store.

import type { MmDayStats, MmStatsPerson } from '../types'

/** One person's numbers, as OW answers them (checked). `me`: the person this bridge belongs to. */
export type StatsPerson = MmStatsPerson
/** Today's numbers: the person's own, and the team's. `at`: when OW worked them out. `day`: New York. */
export type DayStats = MmDayStats

/** One line of the drawing. */
export type StatsLine = { text: string; bold?: boolean; dim?: boolean }

const NY = 'America/New_York'
const MINUTE = 60_000

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const name = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, 40) : null
}

/** One person of OW's answer, checked; null when it is of another shape. */
function personFrom(raw: unknown, fallbackName?: string): StatsPerson | null {
  const p = obj(raw)
  const n = name(p?.name) ?? fallbackName ?? null
  const hours = num(p?.hours)
  const workHours = num(p?.work_hours)
  if (!p || !n || hours === null || workHours === null) return null
  return { name: n, me: p.me === true, hours, workHours, parallel: num(p.parallel), tokens: num(p.tokens), sessions: num(p.sessions) }
}

/** OW's answer, checked: a person of another shape is dropped, an answer of another shape is null. */
export function statsFrom(raw: unknown): DayStats | null {
  const o = obj(raw)
  const at = typeof o?.at === 'string' ? Date.parse(o.at) : NaN
  const day = typeof o?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : null
  if (!o || o.ok !== true || !Number.isFinite(at) || !day) return null
  const me = o.me === null || o.me === undefined ? null : personFrom(o.me)
  const team = Array.isArray(o.team) ? o.team.map(p => personFrom(p)).filter((p): p is StatsPerson => p !== null) : null
  const t = obj(o.totals)
  const total = team && t ? personFrom({ ...t, name: 'Team' }) : null
  return { at, day, me, team, total }
}

/** The New York calendar day of an instant, `2026-11-25`. */
export function nyDay(t: number): string {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(t))) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}`
}

/** `10:40 AM`, New York (the house clock, as Team now's `as of`). */
function nyClock(t: number): string {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t))) p[x.type] = x.value
  return `${p.hour}:${p.minute} ${String(p.dayPeriod ?? '').toUpperCase()}`
}

/** Whether a read is still today's: an answer of another New York day is never drawn as "Today". */
export const isToday = (s: Pick<DayStats, 'day'> | null | undefined, now: number): boolean => Boolean(s && s.day === nyDay(now))

/** `4.2 h` (one decimal, as on the image). */
export const hoursWords = (h: number): string => `${(Math.round(h * 10) / 10).toFixed(1)} h`
/** `3.0×` (one decimal, as on the image), or null with no work hours. */
export const parallelWords = (p: number | null): string | null => (p === null || !Number.isFinite(p) ? null : `${(Math.round(p * 10) / 10).toFixed(1)}×`)

/** `950`, `9.5K`, `12K`, `1.8M`, `123M`, `1.2B`: one decimal under 100 of a unit, none above. */
export function tokenWords(n: number): string {
  const unit = (v: number, u: string) => `${v < 100 ? String(Math.round(v * 10) / 10) : String(Math.round(v))}${u}`
  if (n >= 1e9) return unit(n / 1e9, 'B')
  if (n >= 1e6) return unit(n / 1e6, 'M')
  if (n >= 1e3) return unit(n / 1e3, 'K')
  return String(Math.round(n))
}

/** Whether anything is recorded for the person today. */
const tracked = (p: StatsPerson): boolean => p.hours > 0 || p.workHours > 0 || (p.tokens ?? 0) > 0

/** The figures of one person or the team, on one line: `4.2 h · 3.0× parallel · 1.8M tokens`. */
function figures(p: StatsPerson, parallelWord: boolean): string {
  const par = parallelWords(p.parallel)
  return [hoursWords(p.hours), ...(par ? [parallelWord ? `${par} parallel` : par] : []), ...(p.tokens !== null ? [`${tokenWords(p.tokens)} tokens`] : [])].join(' · ')
}

/** The person's own line under the You section's dots: `Today: 4.2 h · 3.0× parallel · 1.8M tokens`. Null: nothing to draw. */
export function myStatsLine(s: DayStats | null | undefined, now: number): string | null {
  if (!s || !s.me || !isToday(s, now)) return null
  return tracked(s.me) ? `Today: ${figures(s.me, true)}` : 'Today: nothing tracked yet'
}

/** What a press on the person's line says: what each figure counts, and when OW worked them out. */
export function myStatsSays(s: DayStats, now: number): string {
  const me = s.me
  if (!me) return ''
  const old = now - s.at > 15 * MINUTE ? ` (${Math.round((now - s.at) / MINUTE)} minutes ago)` : ''
  const par = parallelWords(me.parallel)
  const tokens = me.tokens !== null ? ` ${tokenWords(me.tokens)} tokens${me.sessions !== null ? ` across ${me.sessions} ${me.sessions === 1 ? 'session' : 'sessions'}` : ''}.` : ''
  return (
    `${hoursWords(me.hours)} recorded to clients today, parallel threads counted in full, in ${hoursWords(me.workHours)} of work time` +
    `${par ? `: ${par} parallel` : ''}.${tokens} As of ${nyClock(s.at)}${old}; the same figures as the 9 AM team image, for today so far.`
  )
}

/** The block at the top of Team now: a heading, one line a person in OW's order, then the team. None when OW sent no team rows. */
export function teamStatsLines(s: DayStats | null | undefined, now: number): StatsLine[] {
  if (!s || !s.team || !s.team.length || !isToday(s, now)) return []
  const out: StatsLine[] = [{ text: `Today · as of ${nyClock(s.at)}`, bold: true }]
  for (const p of s.team) out.push(tracked(p) ? { text: `  ${p.name} · ${figures(p, false)}` } : { text: `  ${p.name} · nothing tracked yet`, dim: true })
  if (s.total && s.team.length > 1) out.push({ text: `  Team · ${figures(s.total, false)}`, dim: true })
  return out
}

/** `/mm team`'s text: the block above Team now's, when there is one. */
export const teamStatsText = (s: DayStats | null | undefined, now: number): string => teamStatsLines(s, now).map(l => l.text).join('\n')
