// Business time for client clocks (Rob, 2026-10-12: "the weekends don't count as days towards the
// 24-hour response time... We're only counting business days in our timelines for clients").
//
// Saturday and Sunday contribute zero time; nothing else changes. The clock is paused from Saturday 00:00
// to Monday 00:00 America/New_York. No hours-of-day window and no holidays.
//   Friday 3 PM + 24 h   = Monday 3 PM (9 h Friday + 15 h Monday)
//   Saturday 10 AM + 24 h = the clock runs Monday 00:00 to Tuesday 00:00, read as Monday 11:59 PM
//
// Pure: Intl.DateTimeFormat and arithmetic only (a hooks module has no Node and no DOM), no imports.
// A plugin cannot import from another repo, so this is the plugin's own copy of the business-time module
// the onboarding-wizard server uses (src/lib/business-time.ts there). Keep the logic and the test vectors
// (business-time.test.ts) the same in both.

export const BUSINESS_TZ = 'America/New_York'
/** ISO weekdays that never count: 6 = Saturday, 7 = Sunday. */
export const BUSINESS_REST_DAYS: ReadonlySet<number> = new Set([6, 7])

const HOUR = 3_600_000

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number }
type Day = { start: number; end: number; rest: boolean }

const FMT = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string): Intl.DateTimeFormat {
  let f = FMT.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    FMT.set(tz, f)
  }
  return f
}

function localParts(ms: number, tz: string): Parts {
  const p = fmt(tz).formatToParts(new Date(ms))
  const g = (t: Intl.DateTimeFormatPartTypes): number => Number(p.find(x => x.type === t)?.value)
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') }
}

/** The instant local 00:00 begins on calendar date (y, m, d) in tz. Exact on DST change days. */
function localMidnight(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d) // 00:00 UTC of that date
  const want = new Date(guess)
  // every real UTC offset is inside this range
  for (let off = -14; off <= 14; off++) {
    const c = guess + off * HOUR
    const a = localParts(c, tz)
    const b = localParts(c - 1, tz)
    if (a.y === want.getUTCFullYear() && a.m === want.getUTCMonth() + 1 && a.d === want.getUTCDate() && a.h === 0 && a.mi === 0 && a.s === 0 && b.d !== a.d) return c
  }
  // half-hour zones: fall back to a minute walk
  for (let c = guess - 14 * HOUR; c <= guess + 14 * HOUR; c += 60_000) {
    const a = localParts(c, tz)
    const b = localParts(c - 1, tz)
    if (a.d === want.getUTCDate() && a.h === 0 && a.mi === 0 && b.d !== a.d) return c
  }
  return guess
}

function isoDow(y: number, m: number, d: number): number {
  const js = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  return js === 0 ? 7 : js
}

/** [start, end) of the local calendar day containing ms, plus whether it is a rest day. */
function dayOf(ms: number, tz: string, rest: ReadonlySet<number>): Day {
  const p = localParts(ms, tz)
  const start = localMidnight(p.y, p.m, p.d, tz)
  const n = new Date(Date.UTC(p.y, p.m - 1, p.d + 1))
  const end = localMidnight(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), tz)
  return { start, end, rest: rest.has(isoDow(p.y, p.m, p.d)) }
}

/** True when `ms` falls on a business day (Monday to Friday in tz). False when `ms` is not finite. */
export function isBusinessTime(ms: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): boolean {
  if (!Number.isFinite(ms)) return false
  return !dayOf(ms, tz, rest).rest
}

/** `ms` itself on a business day; otherwise 00:00 local of the next business day. NaN when `ms` is not finite. */
export function nextBusinessStart(ms: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  if (!Number.isFinite(ms)) return NaN
  let t = ms
  for (let i = 0; i < 8; i++) {
    const d = dayOf(t, tz, rest)
    if (!d.rest) return t
    t = d.end
  }
  return t
}

/** Elapsed ms from `fromMs` to `toMs` with rest days contributing zero. 0 when toMs <= fromMs or either is not finite. */
export function businessMsBetween(fromMs: number, toMs: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0
  let total = 0
  let t = fromMs
  while (t < toMs) {
    const d = dayOf(t, tz, rest)
    const stop = Math.min(d.end, toMs)
    if (!d.rest) total += stop - t
    t = stop
  }
  return total
}

/**
 * The instant at which `durationMs` of business time has elapsed since `startMs`. A start on a rest day
 * begins at 00:00 local of the next business day. Exact inverse of businessMsBetween from
 * nextBusinessStart(startMs). NaN when either argument is not finite.
 */
export function addBusinessMs(startMs: number, durationMs: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs)) return NaN
  let t = nextBusinessStart(startMs, tz, rest)
  let left = Math.max(0, durationMs)
  for (let i = 0; i < 4000; i++) {
    const d = dayOf(t, tz, rest)
    if (d.rest) {
      t = d.end
      continue
    }
    const room = d.end - t
    if (left < room) return t + left // strictly inside this business day
    if (left === room) return d.end // lands exactly on the day's end (Monday 24:00 = Tuesday 00:00)
    left -= room
    t = d.end
  }
  return t
}

/** Whole business days elapsed: floor(businessMsBetween / 24 h). For "Nd overdue", "Nd past", "waiting Nd". */
export function businessDaysBetween(fromMs: number, toMs: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  return Math.floor(businessMsBetween(fromMs, toMs, tz, rest) / (24 * HOUR))
}

/**
 * The latest instant t with businessMsBetween(t, endMs) === durationMs. For look-back windows
 * ("the last 48 business hours"). NaN when either argument is not finite.
 */
export function subtractBusinessMs(endMs: number, durationMs: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  if (!Number.isFinite(endMs) || !Number.isFinite(durationMs)) return NaN
  let t = endMs
  let left = Math.max(0, durationMs)
  for (let i = 0; i < 4000; i++) {
    const d = dayOf(t - 1, tz, rest) // the day that contains the instant just before t
    if (d.rest) {
      t = d.start
      continue
    }
    const room = t - d.start
    if (left <= room) return t - left
    left -= room
    t = d.start
  }
  return t
}

/**
 * A deadline a person reads: addBusinessMs, except that a result landing exactly on local midnight
 * (a weekend arrival, or a duration that ends with the business day) is given as 23:59 of the business
 * day that just ended, so no surface prints "Tue 12:00 AM" or "Sat 12:00 AM". NaN when either argument
 * is not finite.
 */
export function businessDeadline(startMs: number, durationMs: number, tz: string = BUSINESS_TZ, rest: ReadonlySet<number> = BUSINESS_REST_DAYS): number {
  const due = addBusinessMs(startMs, durationMs, tz, rest)
  if (!Number.isFinite(due)) return NaN
  const p = localParts(due, tz)
  return p.h === 0 && p.mi === 0 && p.s === 0 && due > startMs ? due - 60_000 : due
}
