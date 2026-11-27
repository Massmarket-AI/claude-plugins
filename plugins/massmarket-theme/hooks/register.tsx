import type { EngineInterface, Register, ThemeColors, ThemeSetArgs, TurnUsage } from 'claude-code'

import { makeColors } from './make-colors.js'

// ============================================================================
// THE BRAND. A client edition copies this mod and replaces PLUGIN and BRAND
// with the client's own; everything below the line stays as it is, so every
// edition gets the same light-by-day, dark-at-night behaviour.
// ============================================================================

const PLUGIN = 'massmarket-theme'

// The massmarket.ai homepage hero, from src/app/globals.css and
// src/components/massmarket-rebrand-home.tsx on main (2026-11-24): paper
// #F2EFE8 / #EDE9E0 / #F7F5EF, ink #0A0A0A, muted #5F646B, accent #FF3D00,
// and the hero's mesh stops #F2EFE8, #D9D4C7, #9E998F, #787D85 under the
// hero's grid: 1px ink lines in 64 px cells, faded at the edges by its radial
// mask (black 30% to clear 75%), a touch stronger here to show through the app. Dark is the same idea after hours: warm ink with paper text.
const BRAND = {
  name: 'Massmarket',
  sceneId: 'hero-mesh',
  sceneAlt: 'A slow cream and gray mesh drifting over a faint grid',
  roles: { accent: '#ff3d00', danger: '#c2203a', success: '#2e7d4f', warning: '#b7791f', pro: '#5b5f97' },
  // Your messages in a solid rounded box with a hairline edge, Claude's words with no box (Rob, 2026-11-25; rounded
  // and edged 2026-11-27). `match`: your box in the hero's paper by day and black at night. `flip`: the reverse,
  // black by day and cream at night.
  boxes: {
    match: { light: { bg: '#f7f5ef', text: '#0a0a0a' }, dark: { bg: '#000000', text: '#f2efe8' } },
    flip: { light: { bg: '#0a0a0a', text: '#f2efe8' }, dark: { bg: '#f2efe8', text: '#0a0a0a' } },
  },
  light: {
    anchors: {
      'surface-0': '#ede9e0',
      'surface-1': '#f2efe8',
      'surface-2': '#f7f5ef',
      'text-primary': '#0a0a0a',
      'text-secondary': '#2a2a2a',
      'text-muted': '#5f646b',
    },
    scene: { base: '#f2efe8', blooms: ['#d9d4c7', '#bebab0', '#f7f5ef', '#9e998f', '#787d85'], grid: '#0a0a0a', gridOpacity: 0.16, meshOpacity: [1, 1, 1, 1] },
  },
  dark: {
    anchors: {
      'surface-0': '#0e0d0b',
      'surface-1': '#161512',
      'surface-2': '#1c1a17',
      'surface-3': '#22201c',
      'text-primary': '#f2efe8',
      'text-secondary': '#d9d4c7',
      'text-muted': '#a9a397',
    },
    // Night flips day: the same cream and grays as a light mesh on black.
    scene: { base: '#0a0a0a', blooms: ['#d9d4c7', '#bebab0', '#000000', '#f2efe8', '#9e998f'], grid: '#f2efe8', gridOpacity: 0.12, meshOpacity: [0.2, 0.28, 0.36, 0.46] },
  },
} as const

// ============================================================================
// Shared by every edition.
// ============================================================================

const { theme, problems } = makeColors({
  label: BRAND.name,
  roles: BRAND.roles,
  light: { gray: { anchors: BRAND.light.anchors } },
  dark: { gray: { anchors: BRAND.dark.anchors } },
})

/** match: your box in the page's own colors (paper by day, black at night); flip: the reverse. */
export type Boxes = 'match' | 'flip'
const BOXES: readonly Boxes[] = ['match', 'flip']

/**
 * Your messages' colors by mode, on a solid fill. Claude's get no message colors, so its words have no box and sit
 * on the scene in the page's own text color, as the app draws a reply with no theme.
 */
function colorsFor(boxes: Boxes): ThemeColors {
  const b = BRAND.boxes[boxes]

  return {
    ...theme,
    inputs: {
      ...theme.inputs,
      light: { ...theme.inputs.light, 'bg-user-message': b.light.bg, 'text-user-message': b.light.text },
      dark: { ...theme.inputs.dark, 'bg-user-message': b.dark.bg, 'text-user-message': b.dark.text },
    },
  }
}

// Five soft blooms drifting on long loops over the hero's grid: by day a
// dark mesh on cream, at night the flip, a cream mesh on black. The scene
// reads the look's mode through prefers-color-scheme, so the night half
// follows the switch below. Each bloom rests where the markup puts it, so it
// looks finished with motion turned off.
//
// What the thread costs to keep going sets the level, 0 to 3 (levelFor, below):
// the same mesh grows and deepens, in its own colors and nothing new (Rob,
// 2026-11-24: flip the colors "instead of adding new colors like white or
// red"). Level 3 breathes slowly (9 s), well under any flashing.
const L = BRAND.light.scene
const D = BRAND.dark.scene
const DEPTH = [1, 1.4, 1.8, 2.2] as const

export type Level = 0 | 1 | 2 | 3

function op(base: number, level: Level): string {
  return Math.min(1, base * DEPTH[level]).toFixed(3)
}

function sceneFor(level: Level): string {
  const grow = 1 + level * 0.1
  const r = (n: number): string => (n * grow).toFixed(0)
  const breathe = level === 3 ? ' br' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.base { fill: ${L.base} }
.s1 { stop-color: ${L.blooms[0]} }
.s2 { stop-color: ${L.blooms[1]} }
.s3 { stop-color: ${L.blooms[2]} }
.s4 { stop-color: ${L.blooms[3]} }
.s5 { stop-color: ${L.blooms[4]} }
.grid { stroke: ${L.grid}; stroke-opacity: ${L.gridOpacity} }
.mesh { opacity: ${L.meshOpacity[level]} }
.m1 { animation: d1 45s ease-in-out infinite }
.m2 { animation: d2 60s ease-in-out infinite }
.m3 { animation: d3 52s ease-in-out infinite }
.m4 { animation: d2 70s ease-in-out infinite reverse }
.m4.br { animation: d2 70s ease-in-out infinite reverse, breathe 9s ease-in-out infinite }
.m1.br { animation: d1 45s ease-in-out infinite, breathe 9s ease-in-out infinite }
@keyframes d1 { 0%, 100% { transform: translate(0px, 0px) } 33% { transform: translate(-40px, 14px) } 66% { transform: translate(40px, -14px) } }
@keyframes d2 { 0%, 100% { transform: translate(0px, 0px) } 50% { transform: translate(-56px, 24px) } }
@keyframes d3 { 0%, 100% { transform: translate(0px, 0px) } 40% { transform: translate(30px, 30px) } 75% { transform: translate(-24px, -12px) } }
@keyframes breathe { 0%, 100% { opacity: 0.8 } 50% { opacity: 1 } }
@media (prefers-color-scheme: dark) {
  .base { fill: ${D.base} }
  .s1 { stop-color: ${D.blooms[0]} }
  .s2 { stop-color: ${D.blooms[1]} }
  .s3 { stop-color: ${D.blooms[2]} }
  .s4 { stop-color: ${D.blooms[3]} }
  .s5 { stop-color: ${D.blooms[4]} }
  .grid { stroke: ${D.grid}; stroke-opacity: ${D.gridOpacity} }
  .mesh { opacity: ${D.meshOpacity[level]} }
}
</style>
<defs>
<radialGradient id="g1"><stop offset="0" class="s1" stop-opacity="${op(0.9, level)}"/><stop offset="1" class="s1" stop-opacity="0"/></radialGradient>
<radialGradient id="g2"><stop offset="0" class="s2" stop-opacity="${op(0.75, level)}"/><stop offset="1" class="s2" stop-opacity="0"/></radialGradient>
<radialGradient id="g3"><stop offset="0" class="s3" stop-opacity="${op(0.9, level)}"/><stop offset="1" class="s3" stop-opacity="0"/></radialGradient>
<radialGradient id="g4"><stop offset="0" class="s4" stop-opacity="${op(0.45, level)}"/><stop offset="1" class="s4" stop-opacity="0"/></radialGradient>
<radialGradient id="g5"><stop offset="0" class="s5" stop-opacity="${op(0.3, level)}"/><stop offset="1" class="s5" stop-opacity="0"/></radialGradient>
<pattern id="grid" width="58" height="58" patternUnits="userSpaceOnUse"><path d="M58 0H0V58" fill="none" class="grid" stroke-width="1"/></pattern>
<radialGradient id="gmr"><stop offset="0.3" stop-color="#ffffff"/><stop offset="0.75" stop-color="#000000"/></radialGradient>
<mask id="gm"><rect width="1600" height="1000" fill="url(#gmr)"/></mask>
</defs>
<rect class="base" width="1600" height="1000"/>
<g class="mesh">
<ellipse class="m1" cx="480" cy="400" rx="${r(780)}" ry="${r(520)}" fill="url(#g1)"/>
<ellipse class="m2" cx="1120" cy="600" rx="${r(640)}" ry="${r(460)}" fill="url(#g2)"/>
<ellipse class="m3" cx="800" cy="500" rx="${r(720)}" ry="${r(620)}" fill="url(#g3)"/>
<ellipse class="m4${breathe}" cx="1380" cy="170" rx="${r(460)}" ry="${r(320)}" fill="url(#g4)"/>
<ellipse class="m1${breathe}" cx="180" cy="880" rx="${r(420)}" ry="${r(300)}" fill="url(#g5)"/>
</g>
<rect width="1600" height="1000" fill="url(#grid)" mask="url(#gm)"/>
</svg>`
}

// ------------------------------------------------ what the thread costs to keep going
//
// Rob, 2026-11-25: the glow follows "the thread cost to keep going, not only its size", without leading anyone to
// abandon an expensive thread mid-task ("There may be some scenarios where, even though the cost is high, that's just
// what it's going to be to complete a task of that magnitude").
//
// So it measures what starting fresh would save, not what this thread costs. Every model call re-reads the whole
// thread. While its prompt cache is warm, that re-read costs a tenth of the full price; once the thread has sat idle
// past the cache's life (an hour here, five minutes on some plans), the next message writes all of it again at full
// price and more. A fresh thread pays its own write once, and then re-reads less on every call. Weighed over the next
// HORIZON calls, a large thread being worked on saves little by switching (the warm cache is the point), and a large
// thread that has gone cold saves a lot. The glow rises with that saving.

/**
 * The context a fresh thread carries once it is going: on Rob's Mac (1,569 threads, the 14 days to 2026-11-25) the
 * median thread answered its first message over 111K tokens, its 10th call over 146K and its 30th over 190K.
 */
export const FRESH_TOKENS = 150_000
/** The stretch of work weighed: the next 20 model calls, about a turn or two of real work. */
const HORIZON = 20
/** Prompt cache prices as a share of the full input price: a read, and a write for each cache life. */
const READ = 0.1
export type CacheLife = '1h' | '5m'
const WRITE: Record<CacheLife, number> = { '1h': 2, '5m': 1.25 }
export const LIFE_MS: Record<CacheLife, number> = { '1h': 3_600_000, '5m': 300_000 }

/**
 * The share of the next HORIZON calls' input cost that a fresh thread would save, 0 to 1: `tokens` is the context
 * this thread re-reads each call, `isCold` whether its cache has lapsed, so its next call writes it all again.
 */
export function savingFor(tokens: number, isCold: boolean, life: CacheLife = '1h'): number {
  const rest = (HORIZON - 1) * READ
  const here = tokens * ((isCold ? WRITE[life] : READ) + rest)
  const fresh = FRESH_TOKENS * (WRITE[life] + rest)

  return here > 0 ? Math.max(0, 1 - fresh / here) : 0
}

/**
 * The glow level for what a fresh thread would save. With an hour's cache that is, for a thread being worked on,
 * level 1 from 390K tokens and 2 from 488K; for one gone cold, 1 from 200K, 2 from 250K and 3 from 334K.
 */
export function levelFor(saving: number | undefined): Level {
  if (saving === undefined || !(saving >= 0.25)) {
    return 0
  }
  if (saving < 0.4) {
    return 1
  }
  if (saving < 0.55) {
    return 2
  }

  return 3
}

// The app's sans for reading, mono for tool rows, semibold small headings.
// The app takes only generic font families. Only your messages have a box:
// rounded, with a hairline edge, on a solid fill (Rob tried feathered edges,
// 2026-11-24, and liked it better without; square corners read as a different
// box from the app's own, so 2026-11-27 he asked for the app's rounded, edged
// box every time). Claude's words and its tool rows have none, so
// nothing of Claude's is boxed in one place and bare in another (Rob,
// 2026-11-25: "I kind of like it better with Claude's messages having the
// transparent background and mine having the solid white or solid cream").
const TYPE_STYLE = {
  Text: { fontFamily: ['sans'], fontSize: 15, lineHeight: 24 },
  Heading: { fontFamily: ['sans'], fontWeight: 'semibold', letterSpacing: -0.2 },
  ToolUse: { fontFamily: ['mono'] },
} as const satisfies NonNullable<ThemeSetArgs['style']>

// The app's own rounding (10 points, measured off Rob's screenshot of 2026-11-27) and a hairline in the app's border
// gray, which follows the mode, so the box reads as one on paper and on black. The fill and words are named here, not
// left to the app, so the app always has an opaque fill to judge the words' contrast against over the mesh.
const USER_BOX = {
  radius: 10,
  paddingX: 16,
  paddingY: 12,
  shadow: 'none',
  borderColor: 'border',
  borderWidth: 1,
  backgroundColor: 'bg-user-message',
  color: 'text-user-message',
} as const

function styleFor(): ThemeSetArgs['style'] {
  return { ...TYPE_STYLE, UserMessage: USER_BOX }
}

// The app frosts its own panels (the side panel, the thread list) over the
// scene with no blur (any blur wipes out the grid's 1px lines) and a veil of
// 40%, so the grid and mesh read through while their words stay legible.
function lookFor(scheme: 'light' | 'dark' | undefined, level: Level, boxes: Boxes): ThemeSetArgs {
  const look: ThemeSetArgs = { colors: colorsFor(boxes), backdrop: { scene: `${BRAND.sceneId}-${level}`, glass: { blur: 0, opacity: 0.4 } }, style: styleFor() }

  return scheme ? { ...look, overrideColorScheme: scheme } : look
}

// ---------------------------------------------------------------- the switch

/** auto: light by day and dark at night on this computer's clock; light or dark: always; app: the app's own setting. */
export type Mode = 'auto' | 'light' | 'dark' | 'app'
/**
 * In auto, what day means: `sun`, sunrise to sunset where this computer's time
 * zone is (so it follows the seasons), or `hours`, fixed hours the person set.
 * `glow`: whether the scene deepens and glows as the thread nears compacting.
 * `boxes`: your messages' box, in the page's own color or the reverse.
 */
export type Prefs = { mode: Mode; schedule: 'sun' | 'hours'; lightFrom: number; darkFrom: number; glow: boolean; boxes: Boxes }

const DEFAULTS: Prefs = { mode: 'auto', schedule: 'sun', lightFrom: 7, darkFrom: 19, glow: true, boxes: 'match' }
const PREFS_KEY = `${PLUGIN}.prefs`
const MODES: readonly Mode[] = ['auto', 'light', 'dark', 'app']

/** The mode to draw at a local hour (0 to 23) on fixed hours: light, dark, or undefined for the app's own. */
export function schemeAt(hour: number, prefs: Pick<Prefs, 'mode' | 'lightFrom' | 'darkFrom'>): 'light' | 'dark' | undefined {
  if (prefs.mode === 'light' || prefs.mode === 'dark') {
    return prefs.mode
  }
  if (prefs.mode === 'app') {
    return undefined
  }
  const { lightFrom, darkFrom } = prefs
  const isDay = lightFrom < darkFrom ? hour >= lightFrom && hour < darkFrom : hour >= lightFrom || hour < darkFrom

  return isDay ? 'light' : 'dark'
}

// Where a time zone's own city is, for sunrise and sunset. A zone not listed
// takes its longitude from its UTC offset and a mid-northern latitude.
const ZONES: Readonly<Record<string, readonly [number, number]>> = {
  'America/New_York': [40.71, -74.01],
  'America/Detroit': [42.33, -83.05],
  'America/Toronto': [43.65, -79.38],
  'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99],
  'America/Boise': [43.62, -116.2],
  'America/Phoenix': [33.45, -112.07],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Anchorage': [61.22, -149.9],
  'Pacific/Honolulu': [21.31, -157.86],
  'America/Mexico_City': [19.43, -99.13],
  'America/Sao_Paulo': [-23.55, -46.63],
  'Europe/London': [51.51, -0.13],
  'Europe/Paris': [48.86, 2.35],
  'Asia/Dubai': [25.2, 55.27],
  'Asia/Karachi': [24.86, 67.0],
  'Asia/Kolkata': [22.57, 88.36],
  'Asia/Calcutta': [22.57, 88.36],
  'Asia/Dhaka': [23.81, 90.41],
  'Asia/Manila': [14.6, 120.98],
  'Australia/Sydney': [-33.87, 151.21],
}

/** A time zone's place: its city where listed, else its UTC offset's longitude at 35 degrees north. */
export function placeFor(zone: string, offsetHours: number): readonly [number, number] {
  return ZONES[zone] ?? [35, offsetHours * 15]
}

const RAD = Math.PI / 180

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max
}

/**
 * Local sunrise or sunset, in hours after local midnight, for a day of the
 * year at a place, with the local UTC offset in hours (the almanac method,
 * to within a few minutes). `day` or `night` where the sun neither rises nor
 * sets that day.
 */
export function sunAt(dayOfYear: number, lat: number, lon: number, offsetHours: number, rising: boolean): number | 'day' | 'night' {
  const lngHour = lon / 15
  const t = dayOfYear + ((rising ? 6 : 18) - lngHour) / 24
  const m = 0.9856 * t - 3.289
  const l = wrap(m + 1.916 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 282.634, 360)
  let ra = wrap(Math.atan(0.91764 * Math.tan(l * RAD)) / RAD, 360)
  ra = (ra + (Math.floor(l / 90) * 90 - Math.floor(ra / 90) * 90)) / 15
  const sinDec = 0.39782 * Math.sin(l * RAD)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosH = (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD))

  if (cosH > 1) {
    return 'night'
  }
  if (cosH < -1) {
    return 'day'
  }
  const h = (rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD) / 15
  const ut = wrap(h + ra - 0.06571 * t - 6.622 - lngHour, 24)

  return wrap(ut + offsetHours, 24)
}

function dayOfYear(d: Date): number {
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86_400_000)
}

/** Today's sunrise and sunset where this computer's time zone is, in local hours; undefined where the sun stays up or down. */
function sunToday(now: Date): { rise: number; set: number } | 'day' | 'night' {
  const offset = -now.getTimezoneOffset() / 60
  const [lat, lon] = placeFor(timeZoneName(), offset)
  const n = dayOfYear(now)
  const rise = sunAt(n, lat, lon, offset, true)
  const set = sunAt(n, lat, lon, offset, false)

  if (rise === 'day' || set === 'day') {
    return 'day'
  }
  if (rise === 'night' || set === 'night') {
    return 'night'
  }

  return { rise, set }
}

/** The mode to draw now: the person's choice, else day or night by the sun or their hours. */
function schemeNow(now: Date, prefs: Prefs): 'light' | 'dark' | undefined {
  if (prefs.mode !== 'auto' || prefs.schedule === 'hours') {
    return schemeAt(now.getHours(), prefs)
  }
  const sun = sunToday(now)

  if (sun === 'day' || sun === 'night') {
    return sun === 'day' ? 'light' : 'dark'
  }
  const h = now.getHours() + now.getMinutes() / 60

  return h >= sun.rise && h < sun.set ? 'light' : 'dark'
}

function isHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23
}

/** This computer's choices, kept across sessions; anything unreadable falls back to the defaults. */
async function readPrefs($: EngineInterface): Promise<Prefs> {
  const raw = (await $.store.get(PREFS_KEY)) as Partial<Prefs> | null | undefined
  const mode = raw && MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : DEFAULTS.mode
  const schedule = raw && (raw.schedule === 'sun' || raw.schedule === 'hours') ? raw.schedule : DEFAULTS.schedule
  const lightFrom = raw && isHour(raw.lightFrom) ? raw.lightFrom : DEFAULTS.lightFrom
  const darkFrom = raw && isHour(raw.darkFrom) && raw.darkFrom !== lightFrom ? raw.darkFrom : DEFAULTS.darkFrom
  const glow = raw && typeof raw.glow === 'boolean' ? raw.glow : DEFAULTS.glow
  const boxes = raw && BOXES.includes(raw.boxes as Boxes) ? (raw.boxes as Boxes) : DEFAULTS.boxes

  return { mode, schedule, lightFrom, darkFrom: darkFrom === lightFrom ? DEFAULTS.darkFrom : darkFrom, glow, boxes }
}

function clockMinutes(hours: number): string {
  const total = Math.round(hours * 60) % (24 * 60)
  const h24 = Math.floor(total / 60)
  const mm = String(total % 60).padStart(2, '0')
  const h = h24 % 12 === 0 ? 12 : h24 % 12

  return `${h}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`
}

function clockTime(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12

  return `${h} ${hour < 12 ? 'AM' : 'PM'}`
}

function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "this computer's time zone"
  } catch {
    return "this computer's time zone"
  }
}

/**
 * Each thread's last model activity on this computer, by session id: when (`at`), its cache's life and the context
 * its last call re-read. Kept in the store so a thread reopened after a restart still knows how long it sat.
 */
type Seen = { at: number; life: CacheLife; tokens?: number }
const SEEN_KEY = `${PLUGIN}.threads`
const SEEN_MAX = 300
const SEEN_DAYS_MS = 14 * 86_400_000

async function readSeen($: EngineInterface): Promise<Record<string, Seen>> {
  const raw = (await $.store.get(SEEN_KEY)) as Record<string, Partial<Seen>> | null | undefined
  const out: Record<string, Seen> = {}

  if (raw && typeof raw === 'object') {
    for (const [sid, v] of Object.entries(raw)) {
      if (v && typeof v.at === 'number' && (v.life === '1h' || v.life === '5m')) {
        out[sid] = { at: v.at, life: v.life, ...(typeof v.tokens === 'number' && v.tokens > 0 ? { tokens: v.tokens } : {}) }
      }
    }
  }

  return out
}

async function sessionId($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

/**
 * Notes model activity in this thread now: at a turn's start (its calls keep the cache warm from then on) and at its
 * end, with the cache life the turn's writes named and the context its last call re-read.
 */
async function noteActivity($: EngineInterface, usage?: TurnUsage): Promise<void> {
  const sid = await sessionId($)

  if (sid === undefined) {
    return
  }
  const all = await readSeen($)
  const prev = all[sid]
  const now = await $.clock.now()
  const life: CacheLife = usage?.ephemeral_1h_input_tokens ? '1h' : usage?.ephemeral_5m_input_tokens ? '5m' : (prev?.life ?? '1h')
  let tokens = prev?.tokens

  try {
    tokens = (await $.session.usage()).context.tokens ?? tokens
  } catch {
    // Keep the last reading.
  }
  all[sid] = { at: now, life, ...(tokens !== undefined ? { tokens } : {}) }
  const kept = Object.entries(all)
    .filter(([, v]) => now - v.at < SEEN_DAYS_MS)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, SEEN_MAX)
  await $.store.set(SEEN_KEY, Object.fromEntries(kept))
}

/** What this thread costs to keep going: undefined before it has a reading. */
export type Cost = { tokens: number; life: CacheLife; at?: number; isCold: boolean; saving: number }

async function costNow($: EngineInterface): Promise<Cost | undefined> {
  const sid = await sessionId($)
  const seen = sid === undefined ? undefined : (await readSeen($))[sid]
  let tokens: number | undefined

  try {
    tokens = (await $.session.usage()).context.tokens
  } catch {
    tokens = undefined
  }
  tokens = tokens ?? seen?.tokens
  if (tokens === undefined) {
    return undefined
  }
  const life = seen?.life ?? '1h'
  // A thread with no activity noted (one that started before this version) counts as warm: never a nudge it can't back.
  const isCold = seen !== undefined && (await $.clock.now()) - seen.at > LIFE_MS[life]

  return { tokens, life, at: seen?.at, isCold, saving: savingFor(tokens, isCold, life) }
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000)

  if (min < 1) {
    return 'just now'
  }
  if (min < 90) {
    return `${min} minute${min === 1 ? '' : 's'} ago`
  }
  const h = Math.round(min / 60)

  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`
}

function costWords(cost: Cost | undefined, now: number): string {
  if (cost === undefined) {
    return 'Thread glow: on. It shows what a fresh thread would save; this thread has no reading yet.'
  }
  const k = (n: number): string => `${Math.round(n / 1000)}K`
  const level = levelFor(cost.saving)
  const life = cost.life === '1h' ? 'an hour' : 'five minutes'
  const pct = Math.round(cost.saving * 100)
  const size = `Each step here re-reads ${k(cost.tokens)} tokens; a fresh thread carries about ${k(FRESH_TOKENS)} once it is going.`
  const state = cost.isCold
    ? `Its cache has lapsed (last reply ${ago(now - (cost.at ?? now))}, kept for ${life}), so the next message re-reads all of it at full price: a fresh thread would save about ${pct}% of the next ${HORIZON} steps.`
    : `Its cache is warm${cost.at === undefined ? '' : ` (last activity ${ago(now - cost.at)}, kept for ${life})`}, so a fresh thread would save about ${pct}% of the next ${HORIZON} steps${pct < 25 ? ': keep going here' : ''}.`

  return `Thread glow: on, level ${level} of 3 (it shows from a 25% saving). ${size} ${state}`
}

/** The last look this copy drew (mode, level and boxes): a tick that finds the same sets nothing. */
let drawn: string | undefined

async function draw($: EngineInterface, scheme: 'light' | 'dark' | undefined, level: Level, boxes: Boxes): Promise<void> {
  const look = lookFor(scheme, level, boxes)

  try {
    const set = await $.theme.set(look)

    if (!set.isDrawn) {
      $.ui.status(set.reason)
    }
  } catch (error) {
    // A build that doesn't take `style`: the same look without it.
    $.ui.log(String(error))
    const { style: _style, ...plain } = look
    await $.theme.set(plain)
  }
}

/** Draws the mode this hour and the level this thread call for, if they differ from what is drawn (or always, when forced). */
async function apply($: EngineInterface, force = false): Promise<void> {
  const prefs = await readPrefs($)
  const scheme = schemeNow(new Date(await $.clock.now()), prefs)
  const level = prefs.glow ? levelFor((await costNow($))?.saving) : 0
  const key = `${scheme ?? 'app'}:${level}:${prefs.boxes}`

  if (force || key !== drawn) {
    drawn = key
    await draw($, scheme, level, prefs.boxes)
  }
}

async function describe($: EngineInterface): Promise<string> {
  const prefs = await readPrefs($)
  const now = new Date(await $.clock.now())
  const scheme = schemeNow(now, prefs)
  const zone = timeZoneName()
  let day: string

  if (prefs.schedule === 'hours') {
    day = `light from ${clockTime(prefs.lightFrom)} to ${clockTime(prefs.darkFrom)}, dark otherwise`
  } else {
    const sun = sunToday(now)
    day =
      sun === 'day' || sun === 'night'
        ? `the sun ${sun === 'day' ? 'stays up' : 'stays down'} today, so ${sun === 'day' ? 'light' : 'dark'} all day`
        : `light from sunrise (${clockMinutes(sun.rise)}) to sunset (${clockMinutes(sun.set)}) today, dark otherwise`
  }
  const where =
    prefs.mode === 'auto'
      ? `${BRAND.name} look: automatic, ${day}, on this computer's clock (${zone}). Now: ${scheme}.`
      : prefs.mode === 'app'
        ? `${BRAND.name} look: following the app's own light or dark setting.`
        : `${BRAND.name} look: always ${prefs.mode}.`
  const glow = !prefs.glow ? 'Thread glow: off.' : costWords(await costNow($), now.getTime())

  const boxes =
    prefs.boxes === 'match'
      ? "Your messages: a rounded box with a thin edge, paper by day and black at night. Claude's have no box."
      : "Your messages: a rounded box with a thin edge, black by day and cream at night. Claude's have no box."

  return `${where}\n${glow}\n${boxes}\nChange it with /look auto (sunrise to sunset), /look hours 7 19 (fixed hours light and dark start, 0 to 23), /look light, /look dark, /look app, /look glow on|off, or /look boxes match|flip.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    await $.command.register({
      name: 'look',
      description: `${BRAND.name} look: light from sunrise to sunset, dark at night. /look auto, hours 7 19, light, dark, app, glow on|off, boxes match|flip`,
    })
    await apply($, true)

    // Once a minute: crosses into day or night on time, follows a change made
    // in another session, and catches up after the computer sleeps or travels.
    $.clock.every(60_000, () => {
      void apply($).catch(error => $.ui.log(String(error)))
    })

    return next(e)
  })

  // A turn of the main thread keeps its cache warm from its start.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await noteActivity($).catch(error => $.ui.log(String(error)))
      await apply($).catch(error => $.ui.log(String(error)))
    }

    return next(e)
  })

  // After each reply the thread has grown: note it, and redraw if its level changed.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await noteActivity($, e.usage).catch(error => $.ui.log(String(error)))
    }
    await apply($).catch(error => $.ui.log(String(error)))

    return result
  })

  on('command.run', { command: 'look' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const prefs = await readPrefs($)
    const first = words[0]

    if (first === undefined) {
      return { text: await describe($) }
    }

    if (first === 'auto' || first === 'sun') {
      await $.store.set(PREFS_KEY, { ...prefs, mode: 'auto', schedule: 'sun' })
    } else if (MODES.includes(first as Mode)) {
      await $.store.set(PREFS_KEY, { ...prefs, mode: first as Mode })
    } else if (first === 'hours') {
      const lightFrom = Number(words[1])
      const darkFrom = Number(words[2])

      if (!isHour(lightFrom) || !isHour(darkFrom) || lightFrom === darkFrom) {
        return { text: 'Give two different hours from 0 to 23: when light starts, then when dark starts. For example /look hours 7 19.' }
      }
      await $.store.set(PREFS_KEY, { ...prefs, mode: 'auto', schedule: 'hours', lightFrom, darkFrom })
    } else if (first === 'glow' && (words[1] === 'on' || words[1] === 'off')) {
      await $.store.set(PREFS_KEY, { ...prefs, glow: words[1] === 'on' })
    } else if (first === 'boxes' && BOXES.includes(words[1] as Boxes)) {
      await $.store.set(PREFS_KEY, { ...prefs, boxes: words[1] as Boxes })
    } else {
      return { text: await describe($) }
    }

    await apply($, true)

    return { text: await describe($) }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    const prefix = `${BRAND.sceneId}-`

    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== PLUGIN || !e.props.scene.startsWith(prefix)) {
      return next(e)
    }

    const n = Number(e.props.scene.slice(prefix.length))
    const level: Level = n === 1 || n === 2 || n === 3 ? n : 0
    const { Svg } = $.ui.resolve(e)

    return <Svg source={sceneFor(level)} alt={BRAND.sceneAlt} />
  })
}
