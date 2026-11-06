/**
 * (0.7.26) The reply-package card in the side pane (Rob, 2026-11-05: "make our reply packages appear like it's a UI with
 * an approve button"; then: "I just want to make sure this doesn't cause it to take more time for my team to receive an
 * update after it hits their chat").
 *
 * Until 0.7.26 the thread drew the card itself: client-reply-prep §9.3 had it run `render_visual.py` and copy 16 to 39 KB
 * of HTML into `show_widget`, 5 to 12K output tokens on every pickup. Now the bridge draws it here, from the same
 * renderer, and the thread draws nothing:
 *
 * - Prepared on arrival. When a client part shows a package, the bridge runs `render_visual.py --package <id> --tree -`
 *   on this computer in the background (about 4 seconds, through the person's own gateway token: it reads, it writes
 *   nothing) and keeps the card by the `package_sha256` it was drawn from. No OW route stores it, and nothing of the
 *   client's leaves this computer.
 * - Drawn natively. The pane runs no page script, so the renderer hands over the exact card it draws for the widget as a
 *   tree of boxes and paragraphs (`--tree`), and this module draws it with the pane's own elements.
 * - Never stale. The signature box is offered only when the card's hash equals the package's current `package_sha256`
 *   (from the pickup read the pane already makes), every fingerprinted block matches what is drawn, the renderer itself
 *   offers it (its holds: an unanswered question, a placeholder, a newer client message, no hash), the part is this
 *   thread's own client, and this thread has printed that package's page (its closing line names the tag). Otherwise
 *   the card is drawn without the box and says why.
 * - Signing never sends. The box writes the signer's name in, folds the letter into an envelope, and puts exactly
 *   `Send package <12>` in the person's prompt box, as the Start buttons fill it. The person sends it with Enter; the
 *   thread then runs the go of §9.5. A draft of theirs in the box is never written over.
 */
import type { BoxProps, ButtonProps, ElementConstructor, EngineInterface, LinkProps, Register, RenderNode, SvgProps, TextProps } from 'claude-code'

import type { MmCard, MmCardMarks, MmCardNode, MmCardRun, MmCardSigned, MmCardTree } from '../types'

const CARD = { plugin: 'mm-bridge', key: 'card' } as const
const CARD_MARKS = { plugin: 'mm-bridge', key: 'cardMarks' } as const

/** The renderer's tree version this module draws. */
const TREE_V = 1
/** How long one render may run (the renderer reads the package, its documents and the plan through the gateway). */
const RENDER_MS = 90_000
/** The cards kept in memory, newest last. */
const CARDS_MAX = 12
/** The largest tree read from the renderer, in characters. */
const TREE_MAX_CHARS = 600_000
/** At most this many nodes and this deep: a tree past either is refused. */
const NODES_MAX = 5_000
const DEPTH_MAX = 24
/** How many printed tags a thread remembers. */
const PRINTED_MAX = 30
/** How long the signature and the envelope take before the words go in the prompt box (the widget's 3.05 s). */
export const SIGN_FILL_MS = 3_050
/** A signature older than this is drawn still, without the animation. */
const SIGN_ANIMATE_MS = 4_000

const SHA = /^[0-9a-f]{64}$/
const LABEL = /^[0-9a-f]{12}$/
/** The page's closing line: `One go … Package `<12>`.` (client-reply-prep §9.3). */
const CLOSING = /One go [^\n]*?Package `([0-9a-f]{12})`\./g

/** The card drawn for each package this session, by package id: the newest version read. */
const cards = new Map<string, MmCardTree>()
/** A render running for a package id. */
const running = new Map<string, Promise<MmCardTree | string>>()
/** The package's hash as the last pickup read gave it, by package id. */
const currents = new Map<string, string>()

export const NO_CARD: MmCard = { packageId: '', projectId: '', client: '', own: false, current: null, tree: null, status: 'none', at: 0 }
const NO_MARKS: MmCardMarks = { printed: [], signed: {} }

// ---------------------------------------------------------------- reading the renderer's tree

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as render_visual.py's `fp` and the widget's script compute it. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  const byte = (b: number) => {
    h ^= b
    h = Math.imul(h, 16777619) >>> 0
  }
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x80) byte(c)
    else if (c < 0x800) {
      byte(0xc0 | (c >> 6))
      byte(0x80 | (c & 63))
    } else if (c < 0x10000) {
      byte(0xe0 | (c >> 12))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    } else {
      byte(0xf0 | (c >> 18))
      byte(0x80 | ((c >> 12) & 63))
      byte(0x80 | ((c >> 6) & 63))
      byte(0x80 | (c & 63))
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const str = (v: unknown, max = 20_000): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)

function readRun(v: unknown): MmCardRun | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const s = str(o.s)
  if (s === undefined) return null
  const run: MmCardRun = { s }
  const c = str(o.c, 200)
  if (c) run.c = c
  const href = str(o.href, 2048)
  if (href && /^https?:\/\/[^\s<>"']+$/.test(href)) run.href = href
  const fp = str(o.fp, 8)
  if (fp && /^[0-9a-f]{8}$/.test(fp)) run.fp = fp
  return run
}

function readNodes(v: unknown, depth: number, count: { n: number }): MmCardNode[] | null {
  if (!Array.isArray(v) || depth > DEPTH_MAX) return null
  const out: MmCardNode[] = []
  for (const x of v) {
    if (++count.n > NODES_MAX) return null
    if (!x || typeof x !== 'object') return null
    const o = x as Record<string, unknown>
    const node: MmCardNode = {}
    const c = str(o.c, 200)
    if (c) node.c = c
    if (o.sign && typeof o.sign === 'object') {
      const sg = o.sign as Record<string, unknown>
      const label = str(sg.label, 12)
      if (!label || !LABEL.test(label)) return null
      node.sign = { label, signer: (str(sg.signer, 80) ?? '').trim() || 'Approver' }
    } else if (typeof o.btn === 'string') {
      node.btn = str(o.btn, 120)
      node.ask = str(o.ask, 2_000) ?? ''
    } else if (Array.isArray(o.k)) {
      const k = readNodes(o.k, depth + 1, count)
      if (!k) return null
      node.k = k
    } else if (Array.isArray(o.r)) {
      const r: MmCardRun[] = []
      for (const y of o.r) {
        const run = readRun(y)
        if (!run) return null
        r.push(run)
      }
      node.r = r
      const fp = str(o.fp, 8)
      if (fp && /^[0-9a-f]{8}$/.test(fp)) node.fp = fp
    } else return null
    out.push(node)
  }
  return out
}

/** The renderer's tree as this module draws it, or null for anything it did not write. */
export function readTree(v: unknown): MmCardTree | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.v !== TREE_V) return null
  const nodes = readNodes(o.nodes, 0, { n: 0 })
  if (!nodes) return null
  const sha = typeof o.package_sha256 === 'string' && SHA.test(o.package_sha256) ? o.package_sha256 : null
  const label = typeof o.label === 'string' && LABEL.test(o.label) ? o.label : ''
  const id = (x: unknown) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x.toLowerCase() : null)
  return {
    v: TREE_V,
    package_id: id(o.package_id),
    project_id: id(o.project_id),
    client: str(o.client, 120) ?? '',
    package_sha256: sha,
    label: sha && label && sha.startsWith(label) ? label : '',
    blocks: Number.isInteger(o.blocks) ? (o.blocks as number) : -1,
    signer: (str(o.signer, 80) ?? '').trim() || 'Approver',
    can_sign: o.can_sign === true,
    rendered_at: str(o.rendered_at, 40) ?? '',
    nodes,
  }
}

function* walk(nodes: readonly MmCardNode[]): Generator<MmCardNode> {
  for (const n of nodes) {
    yield n
    if (n.k) yield* walk(n.k)
  }
}

/**
 * The copy check (visual-view §4), here over the tree as read: every fingerprinted block's text, exactly as drawn, has
 * its fingerprint, and the card holds as many as it says. False on any difference: the pane then offers no signature.
 */
export function copyCheck(tree: MmCardTree): boolean {
  let n = 0
  for (const node of walk(tree.nodes)) {
    if (node.fp) {
      n++
      if (fnv1a((node.r ?? []).map(r => r.s).join('')) !== node.fp) return false
    }
    for (const r of node.r ?? []) {
      if (!r.fp) continue
      n++
      if (fnv1a(r.s) !== r.fp) return false
    }
  }
  return n === tree.blocks
}

/** The signature node the renderer drew, if it offers one. */
export function signOf(tree: MmCardTree | null): { label: string; signer: string } | null {
  if (!tree) return null
  for (const n of walk(tree.nodes)) if (n.sign) return n.sign
  return null
}

// ---------------------------------------------------------------- the package as it stands

/** What the pickup read said of the package's hash: OW's `package_sha256`. Called by the pickup read. */
export function noteCurrent(packageId: string, sha: unknown): void {
  if (typeof sha === 'string' && SHA.test(sha)) currents.set(packageId, sha)
}

/** The package's hash as last read: OW's full hash, else the 12 of a page drawn locally, else null. */
export function currentOf(packageId: string, page: string | null): string | null {
  const full = currents.get(packageId)
  if (full) return full
  const m = page ? /Package `([0-9a-f]{12})`/.exec(page) : null
  return m ? (m[1] as string) : null
}

/** The card was drawn from the package as it stands now. */
export function isFresh(tree: MmCardTree | null, current: string | null): boolean {
  if (!tree?.package_sha256 || !current) return false
  return current.length === 64 ? tree.package_sha256 === current : Boolean(tree.label) && tree.label === current
}

// ---------------------------------------------------------------- preparing the card

/**
 * The card for this version of the package: kept, else drawn by the renderer on this computer. One render a package at
 * a time. Resolves the tree, or a one-line reason it could not be drawn.
 */
async function render($: EngineInterface, home: string, packageId: string, signer: string): Promise<MmCardTree | string> {
  const was = running.get(packageId)
  if (was) return was
  const job = (async (): Promise<MmCardTree | string> => {
    const script = `${home}/.claude/skills/client-reply-prep/scripts/render_visual.py`
    let reason = 'python3 is not on this computer'
    for (const py of [['python3'], ['python'], ['py', '-3']]) {
      let out: { exitCode: number | null; stdout: string; stderr: string }
      try {
        out = (await $.process.run([...py, script, '--package', packageId, '--signer', signer, '--tree', '-'], { timeoutMs: RENDER_MS })) as typeof out
      } catch {
        continue
      }
      if (out.exitCode !== 0) {
        const err = String(out.stderr ?? '')
        reason = /unrecognized arguments: --tree/.test(err)
          ? 'this computer has an older client-reply-prep (the skill sync brings the card)'
          : (err.trim().split('\n').pop() ?? '').slice(0, 160) || `the renderer stopped (${out.exitCode})`
        return reason
      }
      if (out.stdout.length > TREE_MAX_CHARS) return 'the card is too large for the pane'
      try {
        const tree = readTree(JSON.parse(out.stdout))
        if (!tree) return 'the renderer drew a card this bridge cannot read'
        return tree
      } catch {
        return 'the renderer drew a card this bridge cannot read'
      }
    }
    return reason
  })()
  running.set(packageId, job)
  try {
    return await job
  } finally {
    running.delete(packageId)
  }
}

function keep(packageId: string, tree: MmCardTree): void {
  cards.delete(packageId)
  cards.set(packageId, tree)
  for (const old of [...cards.keys()].slice(0, Math.max(0, cards.size - CARDS_MAX))) cards.delete(old)
}

export type CardFor = {
  packageId: string
  projectId: string
  client: string
  own: boolean
  /** The package's hash as the pickup read just gave it (currentOf). */
  current: string | null
  signer: string
  home: string
  /** Whether this draw of the client part is still the session's newest. */
  isNewest: () => Promise<boolean>
}

/**
 * The card for a client part with a package, drawn with what is kept at once (no wait): the kept card when there is one
 * (without the signature box until it is known fresh), else nothing yet. Called where the part is drawn at once.
 */
export async function showKept($: EngineInterface, f: Omit<CardFor, 'signer' | 'home'>): Promise<void> {
  const tree = cards.get(f.packageId) ?? null
  if (!(await f.isNewest())) return
  await $.state.set(CARD, {
    packageId: f.packageId, projectId: f.projectId, client: f.client, own: f.own, current: f.current, tree,
    status: tree ? (isFresh(tree, f.current) ? 'ready' : 'rendering') : 'rendering', at: await $.clock.now(),
  } satisfies MmCard)
}

/**
 * The card for a client part with a package, after its pickup read: the kept card when it was drawn from the package as
 * it stands, else a new one drawn now (the kept one shows meanwhile, without the box). Only the session's newest draw
 * lands. Never throws: a card that cannot be drawn leaves the page alone in the pane, with one line saying why.
 */
export async function prepareCard($: EngineInterface, f: CardFor): Promise<void> {
  try {
    const kept = cards.get(f.packageId) ?? null
    const base = { packageId: f.packageId, projectId: f.projectId, client: f.client, own: f.own, current: f.current }
    if (kept && isFresh(kept, f.current)) {
      if (await f.isNewest()) await $.state.set(CARD, { ...base, tree: kept, status: 'ready', at: await $.clock.now() } satisfies MmCard)
      return
    }
    if (await f.isNewest()) await $.state.set(CARD, { ...base, tree: kept, status: 'rendering', at: await $.clock.now() } satisfies MmCard)
    const got = await render($, f.home, f.packageId, f.signer)
    if (typeof got !== 'string') keep(f.packageId, got)
    if (!(await f.isNewest())) return
    const at = await $.clock.now()
    if (typeof got === 'string') await $.state.set(CARD, { ...base, tree: kept, status: 'failed', error: got, at } satisfies MmCard)
    else await $.state.set(CARD, { ...base, tree: got, status: 'ready', at } satisfies MmCard)
  } catch {
    // the page stands alone
  }
}

/** The card as this thread's state holds it (NO_CARD when there is none or an older version left another shape). */
export async function cardOf($: EngineInterface): Promise<MmCard> {
  const { value } = await $.state.get(CARD)
  return value && typeof value === 'object' && typeof value.packageId === 'string' ? value : NO_CARD
}

/** No card, written at once (a client part cleared). */
export async function resetCard($: EngineInterface): Promise<void> {
  await $.state.set(CARD, NO_CARD)
}

/** No card: the client part shows no package. */
export async function clearCard($: EngineInterface): Promise<void> {
  const { value } = await $.state.get(CARD)
  if (value && value.packageId) await $.state.set(CARD, NO_CARD)
}

// ---------------------------------------------------------------- the thread's own marks: pages printed, signatures

export async function marksOf($: EngineInterface): Promise<MmCardMarks> {
  const { value } = (await $.state.get(CARD_MARKS)) as { value: Partial<MmCardMarks> | undefined }
  return {
    printed: Array.isArray(value?.printed) ? value.printed.filter(x => typeof x === 'string' && LABEL.test(x)) : [],
    signed: value?.signed && typeof value.signed === 'object' ? (value.signed as Record<string, MmCardSigned>) : {},
    ...(value?.pageOpen === true ? { pageOpen: true } : {}),
  }
}

/** The tags of every pickup page closing line in a response of this thread. */
export function printedTags(text: string): string[] {
  return [...text.matchAll(CLOSING)].map(m => m[1] as string)
}

/** A response of this thread printed a pickup page: its tag is one this pane may offer the signature for. */
export async function notePrinted($: EngineInterface, text: string): Promise<void> {
  const tags = printedTags(text)
  if (!tags.length) return
  const marks = await marksOf($)
  const printed = [...marks.printed.filter(t => !tags.includes(t)), ...tags].slice(-PRINTED_MAX)
  await $.state.set(CARD_MARKS, { ...marks, printed })
}

export async function togglePage($: EngineInterface): Promise<void> {
  const marks = await marksOf($)
  await $.state.set(CARD_MARKS, { ...marks, pageOpen: !marks.pageOpen })
}

/** Words put in the prompt box, as a Start press puts them (`fillStart`): a draft of the person's is never written over. */
export async function fillWords($: EngineInterface, words: string): Promise<'filled' | 'draft' | 'none'> {
  try {
    const box = await $.prompt.read()
    const draft = String(box?.text ?? '').trim()
    if (draft === words) return 'filled'
    if (draft) return 'draft'
    return (await $.prompt.fill({ text: words, mode: 'replace' })).isFilled ? 'filled' : 'none'
  } catch {
    return 'none'
  }
}

/** Why the pane offers no signature for this card now, or '' when it offers one. */
export function holdOf(card: MmCard, marks: MmCardMarks): string {
  const tree = card.tree
  const sign = signOf(tree)
  if (!tree || !sign) return 'no-sign'
  if (!copyCheck(tree)) return 'drift'
  if (!isFresh(tree, card.current)) return 'stale'
  if (!card.own) return 'not-own'
  if (!marks.printed.includes(sign.label)) return 'not-printed'
  return ''
}

/**
 * A press on Click to sign and send: the signature is recorded (the pane draws it inking in and the envelope), then,
 * when the envelope has flown, exactly `Send package <12>` goes in the prompt box, if the card still holds then. One
 * signature a tag: a second press does nothing.
 */
export async function pressSign($: EngineInterface, label: string): Promise<void> {
  const { value: card } = await $.state.get(CARD)
  const marks = await marksOf($)
  if (!card || !card.tree || marks.signed[label]) return
  if (holdOf(card, marks) || signOf(card.tree)?.label !== label) return
  const signed: MmCardSigned = { label, signer: signOf(card.tree)?.signer ?? card.tree.signer, at: await $.clock.now() }
  await $.state.set(CARD_MARKS, { ...marks, signed: { ...marks.signed, [label]: signed } })
  await $.clock.after(SIGN_FILL_MS, async () => {
    const { value: now } = await $.state.get(CARD)
    const m = await marksOf($)
    // the package changed, or the pane moved to another package, while the envelope flew: nothing goes in the box
    const holds = !now || now.tree?.label !== label || Boolean(holdOf(now, m))
    const filled = holds ? 'stale' : await fillWords($, `Send package ${label}`)
    const was = m.signed[label]
    if (was) await $.state.set(CARD_MARKS, { ...m, signed: { ...m.signed, [label]: { ...was, filled } } })
  })
}

/** A press on one of the card's own buttons (Read the whole transcript, Fix these first): its words in the prompt box. */
export async function pressAsk($: EngineInterface, words: string): Promise<void> {
  await fillWords($, words)
}

/**
 * (0.7.26) Every response block of this thread is read for a pickup page's closing line: once the page of a package is
 * printed here, the pane may offer its signature. Reads only; the row is stored as it came.
 */
export function cardHooks(on: Parameters<Register>[0]): void {
  on('session.append', { door: 'response' }, async ($, e, next) => {
    try {
      if (!e.agentId && e.message.type === 'assistant') {
        const text = (e.message.content ?? []).map(b => (b && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n')
        if (text.includes('Package `')) await notePrinted($, text)
      }
    } catch {
      // the row is stored as it came
    }
    return next(e)
  })
}

// ---------------------------------------------------------------- drawing

/** The elements the card draws with: what every surface carries, and a desktop's Svg and Button where it has them. */
export type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button?: ElementConstructor<ButtonProps>
  Link?: ElementConstructor<LinkProps>
  Svg?: ElementConstructor<SvgProps>
}

type Node = RenderNode | null

const has = (c: string | undefined, name: string) => ` ${c ?? ''} `.includes(` ${name} `)

const DC_TEXT = '#dbdee1'
const DC_DIM = '#949ba4'

type Ctx = { dark: boolean; out: 'sms' | 'imessage' | null; parent: string; own: boolean; onAsk: (words: string) => void; keyOf: () => string }

function toneColor(c: string | undefined): string | undefined {
  if (has(c, 'rp-ok')) return 'success'
  if (has(c, 'rp-bad')) return 'error'
  if (has(c, 'rp-warn')) return 'warning'
  return undefined
}

/** A run's own text style, from the card's classes on it. */
function runStyle(c: string | undefined, ctx: Ctx): TextProps {
  const p: TextProps = {}
  if (has(c, 'rp-mono')) p.mono = true
  if (has(c, 'rp-b')) p.weight = 'bold'
  if (has(c, 'rp-ph')) Object.assign(p, { color: 'warning', weight: 'semibold', underline: true })
  if (has(c, 'rp-mention')) Object.assign(p, { color: '#c9cdfb', backgroundColor: '#3c4270' })
  if (has(c, 'rp-chip') || has(c, 'rp-mark')) {
    const tone = toneColor(c)
    if (tone) p.color = tone
    else p.dimColor = true
    p.size = 'footnote'
  }
  if (has(c, 'rp-qtag')) Object.assign(p, { color: 'suggestion', weight: 'semibold', size: 'caption' })
  if (has(c, 'rp-qn')) Object.assign(p, { weight: 'semibold', dimColor: true })
  if (has(c, 'rp-k')) p.dimColor = true
  if (has(c, 'rp-ts')) Object.assign(p, { dimColor: true, mono: true })
  if (has(c, 'rp-them')) p.color = 'suggestion'
  if (has(c, 'rp-dc-bot')) Object.assign(p, { color: '#ffffff', backgroundColor: '#5865f2', size: 'caption' })
  if (has(c, 'rp-dc-ts')) Object.assign(p, { color: DC_DIM, size: 'caption', weight: 'regular' })
  if (ctx.dark && !p.color && !has(c, 'rp-dc-bot')) p.color = DC_TEXT
  return p
}

/** A paragraph's text style, from its classes and where it sits. */
function paraStyle(c: string | undefined, ctx: Ctx): TextProps {
  const p: TextProps = { wrap: 'wrap' }
  const dim = (): TextProps => (ctx.dark ? { color: DC_DIM } : { dimColor: true })
  if (has(c, 'rp-title')) Object.assign(p, { size: 'heading', weight: 'semibold' })
  if (has(c, 'rp-sub') || has(c, 'rp-foot') || has(c, 'rp-bmeta') || has(c, 'rp-when') || has(c, 'rp-hdr') || has(c, 'rp-att') || has(c, 'rp-phone-head'))
    Object.assign(p, { size: 'caption' }, dim())
  if (has(c, 'rp-whatsnew') || has(c, 'rp-qa-us')) Object.assign(p, { size: 'footnote' }, dim())
  if (has(c, 'rp-h')) Object.assign(p, { weight: 'semibold', size: 'footnote' }, dim())
  if (has(c, 'rp-subj')) Object.assign(p, { weight: 'semibold' })
  if (has(c, 'rp-mail-subj')) Object.assign(p, { weight: 'semibold' })
  if (has(c, 'rp-from') || has(c, 'rp-tl-head') || has(c, 'rp-dtitle') || has(c, 'rp-closing') || has(c, 'rp-qa-them') || has(c, 'rp-noteby') || has(c, 'rp-find-what'))
    p.weight = 'semibold'
  if (has(c, 'rp-dtitle') || has(c, 'rp-tl-head') || has(c, 'rp-noteby')) p.size = 'footnote'
  if (has(c, 'rp-turn-who')) Object.assign(p, { size: 'caption', weight: 'semibold' }, has(c, 'rp-us') ? dim() : {})
  if (has(c, 'rp-av')) Object.assign(p, { weight: 'semibold', color: 'suggestion' })
  if (has(c, 'rp-pre')) p.mono = true
  if (has(c, 'rp-dc-name')) Object.assign(p, { weight: 'semibold', color: '#f2f3f5' })
  if (has(c, 'rp-dc-chan') || has(c, 'rp-dc-meta')) Object.assign(p, { size: 'caption', color: DC_DIM })
  if (has(c, 'rp-gap')) Object.assign(p, { dimColor: true })
  if (has(c, 'rp-banner')) {
    const tone = toneColor(ctx.parent)
    if (tone) p.color = tone
  }
  if (has(c, 'rp-bub-out')) p.color = '#ffffff'
  if (ctx.dark && !p.color) p.color = DC_TEXT
  return p
}

/** A box's layout, from its classes. */
function boxStyle(c: string | undefined, ctx: Ctx): BoxProps {
  const p: BoxProps = { flexDirection: 'column' }
  const card: BoxProps = { borderStyle: 'round', borderColor: 'subtle', paddingX: 1, marginY: 'xs' }
  if (has(c, 'rp-head') || has(c, 'rp-mail-from') || has(c, 'rp-call-head') || has(c, 'rp-item-head') || has(c, 'rp-dc-msg') || has(c, 'rp-q') || has(c, 'rp-li'))
    Object.assign(p, { flexDirection: 'row', gap: 1, alignItems: 'flex-start' })
  if (has(c, 'rp-head')) Object.assign(p, { alignItems: 'center', marginBottom: 1 })
  if (has(c, 'rp-grow')) Object.assign(p, { flexGrow: 1, flexShrink: 1 })
  if (has(c, 'rp-sec')) Object.assign(p, { marginTop: 1 })
  if (has(c, 'rp-note')) Object.assign(p, { paddingX: 1, marginBottom: 1, borderStyle: 'round', borderColor: 'subtle' })
  if (has(c, 'rp-mail') || has(c, 'rp-call') || has(c, 'rp-item')) Object.assign(p, card)
  if (has(c, 'rp-phone')) Object.assign(p, card, { paddingY: 'xs' })
  if (has(c, 'rp-row')) Object.assign(p, { alignItems: has(c, 'rp-out') ? 'flex-end' : 'flex-start', marginY: 'xs' })
  if (has(c, 'rp-turn')) Object.assign(p, { paddingX: 1 }, has(c, 'rp-turn-q') ? { borderStyle: 'round', borderColor: 'suggestion' } : {})
  if (has(c, 'rp-dc')) Object.assign(p, { backgroundColor: '#313338', borderStyle: 'round', borderColor: '#313338', paddingX: 1, marginY: 'xs' })
  if (has(c, 'rp-find') || has(c, 'rp-tl')) Object.assign(p, { marginY: 'xs' })
  if (has(c, 'rp-go')) Object.assign(p, { marginTop: 1 })
  if (has(c, 'rp-actions')) Object.assign(p, { flexDirection: 'row', flexWrap: 'wrap', gap: 1, marginY: 'xs' })
  if (has(c, 'rp-banner')) {
    const tone = toneColor(c)
    Object.assign(p, { borderStyle: 'round', borderColor: tone ?? 'subtle', paddingX: 1, marginY: 'xs' })
  }
  void ctx
  return p
}

function drawRuns(els: Els, runs: readonly MmCardRun[], ctx: Ctx): Node[] {
  const { Text } = els
  return runs.map(r => <Text {...runStyle(r.c, ctx)}>{r.s}</Text>)
}

function drawPara(els: Els, node: MmCardNode, ctx: Ctx): Node {
  const { Box, Text, Link } = els
  const runs = node.r ?? []
  const c = node.c
  // a paragraph holding a link: its pieces side by side, each link a Link (a Text cannot hold one)
  if (runs.some(r => r.href) && Link) {
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {has(c, 'rp-li') ? <Text dimColor>•</Text> : null}
        {runs.map(r => (r.href ? <Link href={r.href} label={r.s.trim() || r.href} /> : r.s.trim() ? <Text {...paraStyle(c, ctx)} {...runStyle(r.c, ctx)}>{r.s}</Text> : null))}
      </Box>
    )
  }
  const text = (
    <Text {...paraStyle(c, ctx)}>
      {has(c, 'rp-qa-them') ? '“' : ''}
      {drawRuns(els, runs, ctx)}
      {has(c, 'rp-qa-them') ? '”' : ''}
    </Text>
  )
  // a bubble: ours green (blue for iMessage) with white words, theirs in an outline
  if (has(c, 'rp-bub-out')) return <Box backgroundColor={ctx.out === 'imessage' ? '#0a72e8' : '#248a3d'} borderStyle="round" borderColor={ctx.out === 'imessage' ? '#0a72e8' : '#248a3d'} paddingX={1}>{text}</Box>
  if (has(c, 'rp-bub-in')) return <Box borderStyle="round" borderColor="subtle" paddingX={1}>{text}</Box>
  // a quoted step or note: a bar on its left
  if (has(c, 'rp-quote')) return <Box flexDirection="row" gap={1}><Text dimColor>▎</Text><Box flexShrink={1}>{text}</Box></Box>
  if (has(c, 'rp-pre')) return <Box borderStyle="round" borderColor="subtle" paddingX={1}>{text}</Box>
  return text
}

function drawNodes(els: Els, nodes: readonly MmCardNode[], ctx: Ctx, sign: (s: { label: string; signer: string }) => Node): Node[] {
  const { Box, Text, Button } = els
  return nodes.map(node => {
    if (node.sign) return sign(node.sign)
    if (node.btn !== undefined) {
      if (!Button || !ctx.own) return <Text dimColor>{node.btn}</Text>
      const words = node.ask ?? ''
      return <Button key={`mm-card-ask:${ctx.keyOf()}`} label={node.btn} onPress={() => ctx.onAsk(words)} />
    }
    if (node.k) {
      const inner: Ctx = {
        ...ctx,
        dark: ctx.dark || has(node.c, 'rp-dc'),
        out: has(node.c, 'rp-imessage') ? 'imessage' : has(node.c, 'rp-sms') ? 'sms' : ctx.out,
        parent: node.c ?? '',
      }
      return <Box {...boxStyle(node.c, inner)}>{drawNodes(els, node.k, inner, sign)}</Box>
    }
    return drawPara(els, node, ctx)
  })
}

const HAND = '"Snell Roundhand","Segoe Script","Bradley Hand","Brush Script MT",cursive'
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The signature and the envelope (Rob, 2026-11-05: "it could show the signature appearing", "Maybe it folds up into an
 * envelope and then sends"), as one SVG: the name inks in over 1.1 s, then a letter carrying it drops into an envelope,
 * the flap closes, a seal lands and the envelope flies off. `still`: the signature alone, signed (a redraw later on).
 */
export function signatureSvg(name: string, still: boolean): string {
  const n = xml(name.slice(0, 40))
  const sig = `<text x="18" y="52" font-family='${HAND}' font-size="34" fill="currentColor" style="fill:#1f3b73">${n}</text>`
  const line = '<line x1="14" y1="64" x2="426" y2="64" stroke="#888780" stroke-width="1"/>'
  if (still) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 76" width="440" height="76">${sig}${line}</svg>`
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 230" width="440" height="230">' +
    '<defs><clipPath id="ink"><rect x="0" y="0" width="0" height="76"><animate attributeName="width" from="0" to="440" dur="1.1s" fill="freeze"/></rect></clipPath></defs>' +
    `<g clip-path="url(#ink)">${sig}</g>${line}` +
    '<g opacity="0"><set attributeName="opacity" to="1" begin="1.15s" fill="freeze"/>' +
    '<g><animateTransform attributeName="transform" type="translate" from="0 0" to="250 -120" begin="2.05s" dur="0.9s" fill="freeze"/>' +
    '<animate attributeName="opacity" from="1" to="0" begin="2.05s" dur="0.9s" fill="freeze"/>' +
    '<rect x="150" y="128" width="140" height="84" rx="6" fill="#cdb489"/>' +
    `<g><animateTransform attributeName="transform" type="translate" from="0 -70" to="0 0" begin="1.15s" dur="0.6s" fill="freeze"/>` +
    '<rect x="162" y="120" width="116" height="74" rx="4" fill="#ffffff" stroke="#d8d4c8"/>' +
    '<rect x="172" y="130" width="96" height="4" rx="2" fill="#e2dfd6"/><rect x="172" y="140" width="96" height="4" rx="2" fill="#e2dfd6"/><rect x="172" y="150" width="58" height="4" rx="2" fill="#e2dfd6"/>' +
    `<text x="172" y="176" font-family='${HAND}' font-size="18" style="fill:#1f3b73">${n}</text></g>` +
    '<polygon points="150,151 220,184 290,151 290,212 150,212" fill="#e6d2a8"/>' +
    '<polygon points="150,128 290,128 220,80" fill="#bfa478"><animate attributeName="points" from="150,128 290,128 220,80" to="150,128 290,128 220,177" begin="1.8s" dur="0.4s" fill="freeze"/></polygon>' +
    '<circle cx="220" cy="168" r="0" fill="#b3261e"><animate attributeName="r" from="0" to="13" begin="2.15s" dur="0.2s" fill="freeze"/></circle>' +
    '</g></g></svg>'
  )
}

/** The Eastern time of a signature, as the widget writes it. */
function etTime(at: number): string {
  try {
    return `${new Date(at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
  } catch {
    return new Date(at).toISOString()
  }
}

/** What the pane says in place of the signature box, by why it holds it back. */
export function holdText(hold: string, card: MmCard, label: string): string {
  const now = card.current ? card.current.slice(0, 12) : 'unknown'
  switch (hold) {
    case 'drift':
      return 'This view does not match the stored drafts, so signing is off here. Go by the page printed in the thread.'
    case 'stale':
      return card.status === 'failed'
        ? `This card was drawn from package ${label || 'with no tag'}; the package is now ${now}, and it could not be drawn again here (${card.error ?? 'no reason given'}). Go by the page printed in the thread.`
        : `This card was drawn from package ${label || 'with no tag'}; the package is now ${now}. Drawing it again…`
    case 'not-own':
      return `Sign in ${card.client || 'the client'}'s own thread. This card is here to read.`
    case 'not-printed':
      return `Signing opens once this thread prints the package's page (Package ${label}). Ask it to show the package.`
    default:
      return ''
  }
}

export type CardDraw = {
  card: MmCard
  marks: MmCardMarks
  now: number
  onSign: (label: string) => void
  onAsk: (words: string) => void
  onPage: () => void
}

/**
 * The card, drawn: the renderer's tree with its signature box (or the reason there is none), and under it a button that
 * opens the page as text. Null when there is no card to draw yet; the pane then shows the page as before.
 */
export function drawCard(els: Els, d: CardDraw): Node {
  const { Box, Text, Button, Svg } = els
  const { card, marks } = d
  const tree = card.tree
  if (!card.packageId) return null
  if (!tree) {
    if (card.status === 'failed') return <Text dimColor>{`The card could not be drawn here (${card.error ?? 'no reason given'}). The page is below.`}</Text>
    return <Text dimColor>Drawing the card…</Text>
  }
  const hold = holdOf(card, marks)
  let n = 0
  const ctx: Ctx = { dark: false, out: null, parent: '', own: card.own, onAsk: d.onAsk, keyOf: () => `${card.packageId}:${n++}` }
  const sign = (s: { label: string; signer: string }): Node => {
    const signed = marks.signed[s.label]
    if (signed) {
      const still = d.now - signed.at > SIGN_ANIMATE_MS
      const said =
        signed.filled === 'filled'
          ? `Sealed: "Send package ${s.label}" is in your prompt box. Press Enter to send it.`
          : signed.filled === 'draft'
            ? `Sealed. Your prompt box holds a draft, so type: Send package ${s.label}`
            : signed.filled === 'stale'
              ? 'The package changed while signing, so nothing went in the prompt box. Look at the new page and sign again.'
              : signed.filled === 'none'
                ? `Sealed. Type this in the thread: Send package ${s.label}`
                : 'Signing…'
      return (
        <Box key={`mm-card-signed:${s.label}`} flexDirection="column">
          {Svg ? <Svg key={`mm-card-sig:${s.label}:${still ? 'still' : 'ink'}`} source={signatureSvg(signed.signer, still)} alt={`Signed by ${signed.signer}`} isInteractive /> : null}
          <Text size="caption" dimColor>{`Signed by ${signed.signer} · ${etTime(signed.at)} · Package ${s.label}`}</Text>
          <Text color={signed.filled === 'filled' ? 'success' : signed.filled === 'stale' ? 'warning' : undefined}>{said}</Text>
        </Box>
      )
    }
    if (hold) return <Text color={hold === 'drift' ? 'error' : undefined} dimColor={hold !== 'drift'}>{holdText(hold, card, tree.label)}</Text>
    return (
      <Box key={`mm-card-sign:${s.label}`} flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
        {Button ? <Button key={`mm-card-sign-btn:${s.label}`} label="✍  Click to sign and send" variant="primary" onPress={() => d.onSign(s.label)} /> : <Text>{`Type in the thread: Send package ${s.label}`}</Text>}
        <Text size="caption" dimColor>{`${s.signer} · your signature is the go for exactly this package, ${s.label}`}</Text>
        <Text size="caption" dimColor>{`Signing puts "Send package ${s.label}" in your prompt box; Enter sends it. Changes go in the chat box as usual.`}</Text>
      </Box>
    )
  }
  return (
    <Box key={`mm-card:${card.packageId}`} flexDirection="column">
      {hold === 'drift' ? <Text color="error">This view does not match the stored drafts, so signing is off here. Go by the page printed in the thread.</Text> : null}
      {hold === 'stale' && !signOf(tree) ? <Text dimColor>{holdText('stale', card, tree.label)}</Text> : null}
      {drawNodes(els, tree.nodes, ctx, sign)}
      {Button ? <Button key={`mm-card-page:${card.packageId}`} plain label={`${marks.pageOpen ? 'Hide' : 'Show'} the page as text  ${marks.pageOpen ? '▾' : '▸'}`} onPress={() => d.onPage()} /> : null}
    </Box>
  )
}
