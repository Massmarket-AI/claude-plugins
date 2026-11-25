/**
 * (0.7.72) The "You" strip: the person's own health as a row of small dots, at the top of the bridge's side pane, and one compact line in
 * the band beside "Needs you". Rob, 2026-11-24 ("Yep"), Phase 2c of the approved plan. ⛔ Read-only: it never sends, pins or unpins
 * anything, and it makes no sound.
 *
 * Eight indicators, each a level (green, amber, red), a short count and what a press opens:
 * 1. Pins: the threads that need the person that are pinned ("6 of 7 pinned"). Amber when one that needs them is not.
 * 2. Late: their items past due, in business time (Mon to Fri, Eastern: the house rule). Red for a client's date, amber for a team clock
 *    that is behind (an internal clock never reads late, 0.7.61).
 * 3. Replies ready: reply packages of theirs ready to approve. Amber while any wait.
 * 4. Sessions: how many threads run on this computer, and how many say they wait on the person (`mm waiting`). Amber while any wait.
 * 5. This thread's fill: context tokens over the compaction point. Amber from 70%, red from 85%.
 * 6. Plan usage tier: normal, conserve or save, with exactly the thresholds of the control tower's `usage-tier.mjs` (TIERS below).
 * 7. Time tracking: whether this thread has declared its task with the worklog hook. Amber until it has.
 * 8. Remote Control: whether it follows the pin on this computer (`/mm rc`). Amber while off.
 */

/** A dot's level. */
export type Level = 'green' | 'amber' | 'red'
/** Which indicator. */
export type DotKey = 'pins' | 'late' | 'replies' | 'sessions' | 'fill' | 'tier' | 'track' | 'rc'
/** One dot: its level, its short words (`6/7`), and the line a press or a hover says. */
export type Dot = { key: DotKey; level: Level; short: string; says: string }

/** The order the strip draws them in. */
export const DOT_ORDER: readonly DotKey[] = ['pins', 'late', 'replies', 'sessions', 'fill', 'tier', 'track', 'rc']
/** Each dot's name, as the pane heads it. */
export const DOT_NAME: Readonly<Record<DotKey, string>> = {
  pins: 'Pins',
  late: 'Late',
  replies: 'Replies ready',
  sessions: 'Sessions',
  fill: 'This thread',
  tier: 'Plan',
  track: 'Time tracking',
  rc: 'Remote Control',
}
/** The glyph each level is drawn with, in the band and on surfaces with no colour. */
export const LEVEL_GLYPH: Readonly<Record<Level, string>> = { green: '🟢', amber: '🟡', red: '🔴' }

// ---------------------------------------------------------------- 1. pins

/** A client whose thread should be pinned for the person, whether it is, and why not (the pane's own words: `you unpinned it`). */
export type Needing = { client: string; pinned: boolean; why?: string }

export function pinsDot(needing: readonly Needing[]): Dot {
  const pinned = needing.filter(n => n.pinned).length
  const missing = needing.filter(n => !n.pinned).map(n => (n.why ? `${n.client} (${n.why})` : n.client))
  const short = `${pinned}/${needing.length}`
  if (!missing.length) return { key: 'pins', level: 'green', short, says: needing.length ? `All ${needing.length} ${needing.length === 1 ? 'thread' : 'threads'} that need you are pinned.` : 'No thread needs you right now.' }
  return { key: 'pins', level: 'amber', short, says: `${pinned} of ${needing.length} pinned. Not pinned: ${listOf(missing)}.` }
}

// ---------------------------------------------------------------- 2. late

/** An item past its due time: its client, and whether its clock is a client's (late) or the team's own (behind). */
export type Overdue = { client: string; clientClock: boolean }

export function lateDot(overdue: readonly Overdue[]): Dot {
  const late = overdue.filter(o => o.clientClock)
  const behind = overdue.filter(o => !o.clientClock)
  if (!overdue.length) return { key: 'late', level: 'green', short: '0', says: 'Nothing of yours is past due.' }
  const parts = [late.length ? `${late.length} late (${listOf(late.map(o => o.client))})` : '', behind.length ? `${behind.length} behind on a team clock (${listOf(behind.map(o => o.client))})` : ''].filter(Boolean)
  return { key: 'late', level: late.length ? 'red' : 'amber', short: String(overdue.length), says: `${parts.join('; ')}. Counted in business days, Monday to Friday Eastern.` }
}

// ---------------------------------------------------------------- 3. replies ready

export function repliesDot(ready: readonly string[]): Dot {
  if (!ready.length) return { key: 'replies', level: 'green', short: '0', says: 'No reply package waits for your go.' }
  return { key: 'replies', level: 'amber', short: String(ready.length), says: `${ready.length} reply ${ready.length === 1 ? 'package is' : 'packages are'} ready for your go: ${listOf(ready)}.` }
}

// ---------------------------------------------------------------- 4. sessions

export function sessionsDot(running: number, waiting: readonly string[]): Dot {
  const short = waiting.length ? `${running}·${waiting.length}` : String(running)
  const runs = `${running} ${running === 1 ? 'thread runs' : 'threads run'} on this computer`
  if (!waiting.length) return { key: 'sessions', level: 'green', short, says: `${runs}; none waits on you.` }
  return { key: 'sessions', level: 'amber', short, says: `${runs}; ${waiting.length} ${waiting.length === 1 ? 'waits' : 'wait'} on you: ${listOf(waiting)}.` }
}

// ---------------------------------------------------------------- 5. this thread's fill

/** Amber from this share of the compaction point, red from the next. */
export const FILL_AMBER = 70
export const FILL_RED = 85

/**
 * The compaction point, in tokens: the breakdown's `autoCompactThreshold`, else its `rawMaxTokens`, else CLAUDE_CODE_AUTO_COMPACT_WINDOW,
 * else the model's window. A figure that is not a positive number is skipped.
 */
export function compactPoint(o: { threshold?: unknown; rawMax?: unknown; envWindow?: unknown; window?: unknown }): number | null {
  for (const v of [o.threshold, o.rawMax, typeof o.envWindow === 'string' ? Number(o.envWindow.trim()) : o.envWindow, o.window]) {
    const n = typeof v === 'number' ? v : NaN
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** The thread's fill as a whole percentage of the compaction point, or null before the first answer. */
export function fillPercent(tokens: unknown, point: number | null): number | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0 || !point) return null
  return Math.round((tokens / point) * 100)
}

export function fillDot(percent: number | null, tokens?: number, point?: number | null): Dot {
  if (percent === null) return { key: 'fill', level: 'green', short: '–', says: 'This thread has no reading yet: it shows after its next answer.' }
  const level: Level = percent >= FILL_RED ? 'red' : percent >= FILL_AMBER ? 'amber' : 'green'
  const of = typeof tokens === 'number' && point ? ` (${thousands(tokens)} of ${thousands(point)} tokens)` : ''
  const tail = level === 'red' ? ' It compacts soon: start the next job in a new thread.' : level === 'amber' ? ' Getting full.' : ''
  return { key: 'fill', level, short: `${percent}%`, says: `This thread is ${percent}% of the way to compacting${of}.${tail}` }
}

// ---------------------------------------------------------------- 6. plan usage tier

/**
 * ⛔ The control tower's `skills/gpt-delegation/scripts/usage-tier.mjs`, exactly (Claude's recommendation, approved by Rob 2026-11-11):
 * save at 5-hour >= 85% or weekly >= 90% or weekly on pace for >= 120% by its reset; conserve at 60%, 70% and 100%. Change both together.
 */
export const TIERS = { save: { five: 85, week: 90, pace: 120 }, conserve: { five: 60, week: 70, pace: 100 } } as const
export const WEEK_MS = 7 * 24 * 3600 * 1000
export type Tier = 'normal' | 'conserve' | 'save'
/** One rate-limit window as `$.session.usage().rateLimits` gives it. */
export type RateWindow = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * The tier from the windows the last answer reported. No 5-hour window counts as 0. Pace is the weekly share over the share of the week
 * gone, and waits until 24 hours of the week have passed (usage-tier.mjs: `elapsed >= 1/7`).
 */
export function tierOf(windows: readonly RateWindow[], now: number): { tier: Tier; five: number; week: number; pace: number | null; read: boolean } {
  let five: number | null = null
  let week: number | null = null
  let reset: number | null = null
  for (const w of Array.isArray(windows) ? windows : []) {
    if (!w || typeof w.percentUsed !== 'number' || !Number.isFinite(w.percentUsed)) continue
    if (w.kind === 'five_hour') five = Math.max(five ?? 0, w.percentUsed)
    else if (w.kind === 'seven_day' && (week === null || w.percentUsed > week)) {
      week = w.percentUsed
      const at = typeof w.resetsAt === 'string' ? Date.parse(w.resetsAt) : NaN
      reset = Number.isFinite(at) ? at : reset
    }
  }
  const read = five !== null || week !== null
  const f = five ?? 0
  const wk = week ?? 0
  let pace: number | null = null
  if (reset !== null && week !== null) {
    const elapsed = 1 - (reset - now) / WEEK_MS
    if (elapsed >= 1 / 7 && elapsed <= 1) pace = Math.round(wk / elapsed)
  }
  const hits = (t: { five: number; week: number; pace: number }) => f >= t.five || wk >= t.week || (pace !== null && pace >= t.pace)
  const tier: Tier = hits(TIERS.save) ? 'save' : hits(TIERS.conserve) ? 'conserve' : 'normal'
  return { tier, five: f, week: wk, pace, read }
}

export function tierDot(t: ReturnType<typeof tierOf>): Dot {
  if (!t.read) return { key: 'tier', level: 'green', short: 'normal', says: 'Plan usage: no reading yet (it comes with the next answer), so normal.' }
  const level: Level = t.tier === 'save' ? 'red' : t.tier === 'conserve' ? 'amber' : 'green'
  const pace = t.pace !== null ? `, on pace for ${t.pace}% of the week` : ''
  const tail = t.tier === 'save' ? ' Hand light work to GPT and keep threads short.' : t.tier === 'conserve' ? ' Hand searches and copy placement to GPT.' : ''
  return { key: 'tier', level, short: t.tier, says: `Plan usage is ${t.tier}: 5-hour ${t.five}%, weekly ${t.week}%${pace}.${tail}` }
}

// ---------------------------------------------------------------- 7. time tracking, 8. Remote Control

export function trackDot(task: string | null): Dot {
  if (task) return { key: 'track', level: 'green', short: 'on', says: `This thread's task is declared: ${task}.` }
  return { key: 'track', level: 'amber', short: 'off', says: 'This thread has not declared its task, so its time is not counted to one. Claude declares it with the worklog hook.' }
}

export function rcDot(on: boolean): Dot {
  if (on) return { key: 'rc', level: 'green', short: 'on', says: 'Remote Control follows the pin on this computer: a pinned thread reaches your phone.' }
  return { key: 'rc', level: 'amber', short: 'off', says: 'Remote Control does not follow the pin on this computer, so a pinned thread does not reach your phone. Type /mm rc on.' }
}

// ---------------------------------------------------------------- the strip

/** How often each running thread works the strip out again, besides at the end of each turn. */
export const YOU_EVERY_MS = 60_000
/** What heads the strip in the pane. */
export const YOU_HEADING = 'You'

/** Everything the strip is worked out from, read by the bridge (register.tsx `youPass`). */
export type YouInput = {
  needing: readonly Needing[]
  overdue: readonly Overdue[]
  ready: readonly string[]
  running: number
  waiting: readonly string[]
  fill: { percent: number | null; tokens?: number; point?: number | null }
  tier: ReturnType<typeof tierOf>
  task: string | null
  rc: boolean
}

/** The eight dots, in the strip's order. */
export const youDots = (i: YouInput): Dot[] =>
  strip([pinsDot(i.needing), lateDot(i.overdue), repliesDot(i.ready), sessionsDot(i.running, i.waiting), fillDot(i.fill.percent, i.fill.tokens, i.fill.point), tierDot(i.tier), trackDot(i.task), rcDot(i.rc)])

/** A dot as its button reads: the glyph, the name and the short count (`🟡 Pins 6/7`). */
export const dotLabel = (d: Pick<Dot, 'key' | 'level' | 'short'>): string => `${LEVEL_GLYPH[d.level]} ${DOT_NAME[d.key]} ${d.short}`

/** Whether the band shows the line: something is not green. */
export const youNeedsLook = (dots: readonly Pick<Dot, 'level'>[]): boolean => dots.some(d => d.level !== 'green')
/** Whether the band shows it even with nothing else to say: something is red. */
export const youRed = (dots: readonly Pick<Dot, 'level'>[]): boolean => dots.some(d => d.level === 'red')

/** The strip's dots in their order. */
export const strip = (dots: readonly Dot[]): Dot[] => DOT_ORDER.map(k => dots.find(d => d.key === k)).filter((d): d is Dot => Boolean(d))

/** The band's one line: the worst level first, then each dot that is not green, short; all green, one word. */
export function compactLine(dots: readonly Dot[]): string {
  const off = strip(dots).filter(d => d.level !== 'green')
  if (!off.length) return `${LEVEL_GLYPH.green} You: all clear`
  return `You: ${off.map(dotLabel).join(' · ')}`
}

// ---------------------------------------------------------------- words

function listOf(names: readonly string[]): string {
  const uniq = [...new Set(names.filter(Boolean))]
  if (uniq.length <= 3) return uniq.join(', ')
  return `${uniq.slice(0, 3).join(', ')} and ${uniq.length - 3} more`
}

const thousands = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
