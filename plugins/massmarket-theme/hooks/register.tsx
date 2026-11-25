import type { EngineInterface, Register, ThemeColors, ThemeSetArgs } from 'claude-code'

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
  light: {
    anchors: {
      'surface-0': '#ede9e0',
      'surface-1': '#f2efe8',
      'surface-2': '#f7f5ef',
      'text-primary': '#0a0a0a',
      'text-secondary': '#2a2a2a',
      'text-muted': '#5f646b',
    },
    messages: { userBg: '#0a0a0a', userText: '#f2efe8', replyBg: '#f7f5ef', replyText: '#0a0a0a' },
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
    // Night flips the boxes too: your messages cream with ink words, replies black with cream words.
    messages: { userBg: '#f2efe8', userText: '#0a0a0a', replyBg: '#000000', replyText: '#f2efe8' },
    // Night flips day: the same cream and grays as a light mesh on black.
    scene: { base: '#0a0a0a', blooms: ['#d9d4c7', '#bebab0', '#000000', '#f2efe8', '#9e998f'], grid: '#f2efe8', gridOpacity: 0.12, meshOpacity: [0.2, 0.28, 0.36, 0.46] },
  },
  // The hue of the thread's client status (mm-bridge's `you.here.level`): green on pace or ahead, amber behind, red
  // late. By day the deep hues mix into the grays; at night lighter ones mix into the creams, so they read on black.
  status: {
    light: { green: '#2e7d4f', amber: '#b7791f', red: '#c2203a' },
    dark: { green: '#6fbf8a', amber: '#e3a944', red: '#e86a7c' },
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

// Message colors by mode, on solid fills, so words never sit on the moving scene.
const colors: ThemeColors = {
  ...theme,
  inputs: {
    ...theme.inputs,
    light: {
      ...theme.inputs.light,
      'bg-user-message': BRAND.light.messages.userBg,
      'text-user-message': BRAND.light.messages.userText,
      'bg-assistant-message': BRAND.light.messages.replyBg,
      'text-assistant-message': BRAND.light.messages.replyText,
    },
    dark: {
      ...theme.inputs.dark,
      'bg-user-message': BRAND.dark.messages.userBg,
      'text-user-message': BRAND.dark.messages.userText,
      'bg-assistant-message': BRAND.dark.messages.replyBg,
      'text-assistant-message': BRAND.dark.messages.replyText,
    },
  },
}

// Five soft blooms drifting on long loops over the hero's grid: by day a
// dark mesh on cream, at night the flip, a cream mesh on black. The scene
// reads the look's mode through prefers-color-scheme, so the night half
// follows the switch below. Each bloom rests where the markup puts it, so it
// looks finished with motion turned off.
//
// The thread's fill sets the level, 0 to 3: as the thread nears the point
// where it compacts, the same mesh grows and deepens (Rob, 2026-11-24: flip
// the colors "instead of adding new colors like white or red"). Level 3
// breathes slowly (9 s), well under any flashing.
//
// The thread's client status tints it (Rob, later on 2026-11-24, in the bridge
// thread: "A color that represents if you're on pace to complete it on time.
// Or when they're ahead of schedule"; "Maybe it's lightly the color indicating
// the status of the project, and then the more intense the gradient appears,
// that's the context"). The status picks the hue and the level how much of it:
// a light tint while the thread is short, near full strength as it nears
// compacting. Every bloom takes it but the highlight (by day the near-white,
// at night the black). With no status (no client, or no mm-bridge 0.7.73 to
// say), the mesh is its own colors, exactly as before.
const L = BRAND.light.scene
const D = BRAND.dark.scene
const DEPTH = [1, 1.4, 1.8, 2.2] as const
// How much of the hue each bloom takes, by level. The night mesh is faint (20% at level 0), so it takes more hue to
// show its status at a glance.
const TINT = { light: [0.25, 0.4, 0.55, 0.7], dark: [0.5, 0.6, 0.7, 0.8] } as const
const HIGHLIGHT = 2

export type Level = 0 | 1 | 2 | 3
export type Status = 'green' | 'amber' | 'red'
const STATUSES: readonly Status[] = ['green', 'amber', 'red']

function op(base: number, level: Level): string {
  return Math.min(1, base * DEPTH[level]).toFixed(3)
}

/** `a` mixed toward `b` by `t` (0 to 1), both `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const out = [0, 1, 2].map(i => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t))

  return `#${out.map(n => n.toString(16).padStart(2, '0')).join('')}`
}

/** One mode's bloom colors at a level, tinted by the status when there is one. */
function bloomsFor(blooms: readonly string[], hue: string | undefined, amount: number): readonly string[] {
  return hue === undefined ? blooms : blooms.map((c, i) => (i === HIGHLIGHT ? c : mix(c, hue, amount)))
}

export function sceneFor(level: Level, status?: Status): string {
  const grow = 1 + level * 0.1
  const r = (n: number): string => (n * grow).toFixed(0)
  const breathe = level === 3 ? ' br' : ''
  const lb = bloomsFor(L.blooms, status && BRAND.status.light[status], TINT.light[level])
  const db = bloomsFor(D.blooms, status && BRAND.status.dark[status], TINT.dark[level])

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<style>
.base { fill: ${L.base} }
.s1 { stop-color: ${lb[0]} }
.s2 { stop-color: ${lb[1]} }
.s3 { stop-color: ${lb[2]} }
.s4 { stop-color: ${lb[3]} }
.s5 { stop-color: ${lb[4]} }
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
  .s1 { stop-color: ${db[0]} }
  .s2 { stop-color: ${db[1]} }
  .s3 { stop-color: ${db[2]} }
  .s4 { stop-color: ${db[3]} }
  .s5 { stop-color: ${db[4]} }
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

/** How full the thread is, as a share of the point where it compacts, to a level. */
export function levelFor(fill: number | undefined): Level {
  if (fill === undefined || !(fill >= 0.5)) {
    return 0
  }
  if (fill < 0.7) {
    return 1
  }
  if (fill < 0.85) {
    return 2
  }

  return 3
}

// Square corners, the app's sans for reading, mono for tool rows, semibold
// small headings. The app takes only generic font families.
const BASE_STYLE: NonNullable<ThemeSetArgs['style']> = {
  Text: { fontFamily: ['sans'], fontSize: 15, lineHeight: 24 },
  Heading: { fontFamily: ['sans'], fontWeight: 'semibold', letterSpacing: -0.2 },
  UserMessage: { radius: 0, paddingX: 16, paddingY: 12, shadow: 'none' },
  AssistantMessage: { radius: 0, paddingX: 18, paddingY: 14, shadow: 'none' },
  ToolUse: { fontFamily: ['mono'], backgroundColor: 'surface-1', radius: 0, paddingX: 10 },
}

// Plain square boxes on solid fills (Rob tried feathered edges, 2026-11-24,
// and liked it better without).
function styleFor(_scheme: 'light' | 'dark' | undefined): ThemeSetArgs['style'] {
  return BASE_STYLE
}

// The app frosts its own panels (the side panel, the thread list) over the
// scene with no blur (any blur wipes out the grid's 1px lines) and a veil of
// 40%, so the grid and mesh read through while their words stay legible.
function lookFor(scheme: 'light' | 'dark' | undefined, level: Level, status?: Status): ThemeSetArgs {
  const scene = `${BRAND.sceneId}-${level}${status ? `-${status}` : ''}`
  const look: ThemeSetArgs = { colors, backdrop: { scene, glass: { blur: 0, opacity: 0.4 } }, style: styleFor(scheme) }

  return scheme ? { ...look, overrideColorScheme: scheme } : look
}

// ------------------------------------------------- the thread's client status

/**
 * mm-bridge's session value for this thread (0.7.73 and later, desktop, interactive sessions): its `here` is this
 * thread's client's pace. Read only, with no dependency on mm-bridge: a computer without it, an older bridge or a
 * thread with no client reads nothing, and the mesh keeps its own colors.
 */
const BRIDGE_YOU = { plugin: 'mm-bridge', key: 'you' } as const

export type Here = { status: Status; client: string; words: string }

/** The client status in mm-bridge's `you` value, or undefined when it holds none we can use. */
export function hereFrom(value: unknown): Here | undefined {
  const here = value && typeof value === 'object' ? (value as { here?: unknown }).here : undefined

  if (!here || typeof here !== 'object') {
    return undefined
  }
  const { level, client, words } = here as { level?: unknown; client?: unknown; words?: unknown }

  if (!STATUSES.includes(level as Status)) {
    return undefined
  }

  return { status: level as Status, client: typeof client === 'string' ? client : '', words: typeof words === 'string' ? words : '' }
}

async function hereNow($: EngineInterface): Promise<Here | undefined> {
  try {
    // mm-bridge's contract types this key, and the theme deliberately does not list mm-bridge under "dependencies":
    // a dependency installs and turns on mm-bridge with the theme, measured 2026-11-24. So the ref is untyped here,
    // and hereFrom checks the value's shape instead.
    // @ts-ignore
    const { value } = await $.state.get(BRIDGE_YOU)

    return hereFrom(value)
  } catch {
    return undefined
  }
}

const STATUS_WORDS: Record<Status, string> = { green: 'green, on pace or ahead', amber: 'amber, behind', red: 'red, late' }

// ---------------------------------------------------------------- the switch

/** auto: light by day and dark at night on this computer's clock; light or dark: always; app: the app's own setting. */
export type Mode = 'auto' | 'light' | 'dark' | 'app'
/**
 * In auto, what day means: `sun`, sunrise to sunset where this computer's time
 * zone is (so it follows the seasons), or `hours`, fixed hours the person set.
 * `glow`: whether the scene deepens and glows as the thread nears compacting.
 */
export type Prefs = { mode: Mode; schedule: 'sun' | 'hours'; lightFrom: number; darkFrom: number; glow: boolean }

const DEFAULTS: Prefs = { mode: 'auto', schedule: 'sun', lightFrom: 7, darkFrom: 19, glow: true }
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

  return { mode, schedule, lightFrom, darkFrom: darkFrom === lightFrom ? DEFAULTS.darkFrom : darkFrom, glow }
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

/** The token count at which this thread compacts, read once per copy of the mod. */
let compactAt: number | undefined
let compactRead = false

async function compactPoint($: EngineInterface, window: number): Promise<number> {
  if (!compactRead) {
    compactRead = true
    try {
      // `summary` estimates locally and sends nothing.
      const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
      compactAt = b?.autoCompactThreshold ?? b?.rawMaxTokens
    } catch {
      compactAt = undefined
    }
    if (!(compactAt && compactAt > 0)) {
      const env = Number(await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW'))
      compactAt = env > 0 ? env : undefined
    }
  }

  return compactAt && compactAt > 0 ? compactAt : window
}

/** How far the thread is toward compacting, 0 to 1 and over; undefined before its first reply. */
async function fillNow($: EngineInterface): Promise<number | undefined> {
  try {
    const { context } = await $.session.usage()

    if (context.tokens === undefined) {
      return undefined
    }

    return context.tokens / (await compactPoint($, context.window))
  } catch {
    return undefined
  }
}

/** The last look this copy drew (mode, level and status): a tick that finds the same sets nothing. */
let drawn: string | undefined

async function draw($: EngineInterface, scheme: 'light' | 'dark' | undefined, level: Level, status?: Status): Promise<void> {
  const look = lookFor(scheme, level, status)

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

/**
 * Draws the mode this hour, the level this thread and the tint its client's status call for, if they differ from
 * what is drawn (or always, when forced). Glow off is the plain mesh: no growth and no tint.
 */
async function apply($: EngineInterface, force = false): Promise<void> {
  const prefs = await readPrefs($)
  const scheme = schemeNow(new Date(await $.clock.now()), prefs)
  const level = prefs.glow ? levelFor(await fillNow($)) : 0
  const status = prefs.glow ? (await hereNow($))?.status : undefined
  const key = `${scheme ?? 'app'}:${level}:${status ?? 'none'}`

  if (force || key !== drawn) {
    drawn = key
    await draw($, scheme, level, status)
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
  const fill = await fillNow($)
  const here = await hereNow($)
  const tint = here
    ? ` Its tint: ${STATUS_WORDS[here.status]}${here.client ? `, for ${here.client}` : ''}${here.words ? ` (${here.words})` : ''}.`
    : ' No tint: mm-bridge has no client status for this thread.'
  const glow = !prefs.glow
    ? 'Thread glow: off, and with it the client status tint.'
    : fill === undefined
      ? `Thread glow: on. It starts at half the way to compacting; this thread has no reading yet.${tint}`
      : `Thread glow: on. This thread is ${Math.round(fill * 100)}% of the way to compacting (glow level ${levelFor(fill)} of 3; it starts at 50%).${tint}`

  return `${where}\n${glow}\nChange it with /look auto (sunrise to sunset), /look hours 7 19 (fixed hours light and dark start, 0 to 23), /look light, /look dark, /look app, or /look glow on|off.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))

    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }

    await $.command.register({
      name: 'look',
      description: `${BRAND.name} look: light from sunrise to sunset, dark at night. /look auto, hours 7 19, light, dark, app, glow on|off`,
    })
    await apply($, true)

    // Once a minute: crosses into day or night on time, follows a change made
    // in another session, and catches up after the computer sleeps or travels.
    $.clock.every(60_000, () => {
      void apply($).catch(error => $.ui.log(String(error)))
    })

    return next(e)
  })

  // After each reply the thread's fill has moved: redraw if its level changed.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
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

    // `hero-mesh-<level>`, or `hero-mesh-<level>-<status>` when the thread's client status tints it.
    const [n, s] = e.props.scene.slice(prefix.length).split('-')
    const level: Level = n === '1' ? 1 : n === '2' ? 2 : n === '3' ? 3 : 0
    const status = STATUSES.find(x => x === s)
    const { Svg } = $.ui.resolve(e)

    return <Svg source={sceneFor(level, status)} alt={BRAND.sceneAlt} />
  })
}
