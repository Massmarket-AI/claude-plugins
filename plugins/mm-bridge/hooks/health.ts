/**
 * (0.7.73) The "You" strip: the person's own health as a row of small dots, at the top of the bridge's side pane, and one compact line in
 * the band beside "Needs you". Rob, 2026-11-24 ("Yep"), Phase 2c of the approved plan. ⛔ Read-only: it never sends, pins or unpins
 * anything, and it makes no sound.
 *
 * Eight indicators, each a level (green, amber, red), a short count and what a press opens:
 * 1. Pins: the threads that need the person that are pinned ("6 of 7 pinned"). Amber when one that needs them is not.
 * 2. Late: their items past due, in business time (Mon to Fri, Eastern: the house rule). Red for a client's date, amber for a team clock
 *    that is behind (an internal clock never reads late, 0.7.61).
 * 3. Replies ready: reply packages of theirs ready to approve. Amber while any wait.
 * 4. Sessions: how many threads are open on this computer, and how many say they wait on the person (`mm waiting`). Amber while any wait.
 * 5. Pace (0.7.73, Rob 2026-11-24, in place of this thread's fill, which the theme's glow already shows): whether each client of theirs is on
 *    pace to finish on time. Green on pace or ahead, amber behind (a pace row, a start-by passed, a team clock), red late on a client date.
 * 6. Plan usage tier: normal, conserve or save, with exactly the thresholds of the control tower's `usage-tier.mjs` (TIERS below).
 * 7. Time tracking: whether this thread has declared its task with the worklog hook. Amber until it has.
 * 8. Remote Control: whether it follows the pin on this computer (`/mm rc`). Amber while off.
 */

/** A dot's level. */
export type Level = 'green' | 'amber' | 'red'
/** Which indicator. */
export type DotKey = 'pins' | 'late' | 'replies' | 'sessions' | 'pace' | 'tier' | 'track' | 'rc'
/** One dot: its level, its short words (`6/7`), and the line a press or a hover says. */
export type Dot = { key: DotKey; level: Level; short: string; says: string }

/** The order the strip draws them in. */
export const DOT_ORDER: readonly DotKey[] = ['pins', 'late', 'replies', 'sessions', 'pace', 'tier', 'track', 'rc']
/** Each dot's name, as the pane heads it. */
export const DOT_NAME: Readonly<Record<DotKey, string>> = {
  pins: 'Pins',
  late: 'Late',
  replies: 'Replies ready',
  sessions: 'Sessions',
  pace: 'Pace',
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
  // (0.7.77, Rob 2026-11-25: "Why does it say 'sessions 30.1'? What does that mean?") `30·1` read as a decimal: the count waiting is named
  const short = waiting.length ? `${running} · ${waiting.length} waiting` : String(running)
  // a thread counts while its bridge ticked in the last 5 minutes: open in the app, working or not
  const runs = `${running} ${running === 1 ? 'thread is' : 'threads are'} open on this computer`
  if (!waiting.length) return { key: 'sessions', level: 'green', short, says: `${runs}; none waits on you.` }
  return { key: 'sessions', level: 'amber', short, says: `${runs}; ${waiting.length} ${waiting.length === 1 ? 'waits' : 'wait'} on you: ${listOf(waiting)}.` }
}

// ---------------------------------------------------------------- 5. pace

/** A client's pace as you.ts `youPace` reads it: its level and its words (`on pace`, `ahead today`, `behind`, `2d late`). */
export type Paced = { client: string; level: Level; words: string }

export function paceDot(clients: readonly Paced[]): Dot {
  const late = clients.filter(c => c.level === 'red')
  const behind = clients.filter(c => c.level === 'amber')
  if (late.length) return { key: 'pace', level: 'red', short: `${late.length} late`, says: `${[`${late.length} late (${listOf(late.map(c => c.client))})`, behind.length ? `${behind.length} behind (${listOf(behind.map(c => c.client))})` : ''].filter(Boolean).join('; ')}. The rest are on pace.` }
  if (behind.length) return { key: 'pace', level: 'amber', short: `${behind.length} behind`, says: `${behind.length} behind: ${listOf(behind.map(c => `${c.client} (${c.words})`))}. The rest are on pace.` }
  const ahead = clients.filter(c => c.words.startsWith('ahead'))
  if (clients.length && ahead.length === clients.length) return { key: 'pace', level: 'green', short: 'ahead', says: `Every client of yours is ahead today: ${listOf(ahead.map(c => c.client))}.` }
  return { key: 'pace', level: 'green', short: 'on pace', says: clients.length ? `All ${clients.length} ${clients.length === 1 ? 'client is' : 'clients are'} on pace to finish on time.` : 'Nothing of yours has a clock to keep pace with.' }
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
  if (on) return { key: 'rc', level: 'green', short: 'on', says: 'Remote Control follows the pin on this computer: your most recently used pinned threads reach your phone, as many as its memory allows.' }
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
  pace: readonly Paced[]
  tier: ReturnType<typeof tierOf>
  task: string | null
  rc: boolean
}

/** The eight dots, in the strip's order. */
export const youDots = (i: YouInput): Dot[] =>
  strip([pinsDot(i.needing), lateDot(i.overdue), repliesDot(i.ready), sessionsDot(i.running, i.waiting), paceDot(i.pace), tierDot(i.tier), trackDot(i.task), rcDot(i.rc)])

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

