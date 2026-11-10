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
 *   thread's own client, and the card carries what the page prints (`pageGap`, card-parity.ts). Otherwise the card is drawn
 *   without the box and says why.
 * - It replaces the page. (0.7.33, Rob, 2026-11-06: "the copy passes. I already think we should go ahead and implement that
 *   for everybody.") A thread asks `mm card <package id>` at pickup (`cardVerdict`): ready, it prints one line and waits;
 *   not ready, it prints the whole page. (0.7.36) Most pickups run with the thread in the background, where nothing is placed
 *   or drawn until it is opened, so ready no longer needs the card on the screen: the card waits in the pane, and the thread's
 *   line says the person can ask there for the page. A run no surface will ever attach to is still not ready.
 * - The box waits for the thread. (0.7.36; on 2026-11-07 a person pressed and sent while the thread's checks were still
 *   running, and those checks then found two real problems. That thread had asked `mm card` 15 seconds into its turn and made
 *   30 more tool calls after it, so the answer alone proves nothing.) A turn that gets `card ready` for this exact version, or
 *   prints its page, leaves it pending (`cardPending`); when that turn ends with an answer and no background sub-agent is still
 *   at work, it is on record as checked (`cardChecked`, `turnEnded`). Until then the card is drawn in full with no box, and a
 *   button in its place asks the thread to check. A turn that stops short (interrupted, refused, an error) or leaves a sub-agent
 *   at work drops what was pending, so the thread asks again, and a session that dies keeps nothing: the box stays closed and the
 *   button still works. A new `package_sha256` clears both for the old version (`noteVersion`) and closes the box; a page that
 *   changes under the same hash does not. This wait is no hold (`holdOf`, `cardVerdict`): it opens on the answer they decide.
 * - The box is closed while the thread works. (0.7.36; a person says "change the second paragraph" and could still press while
 *   the thread worked on it.) `cardBusy` is true from the start of a turn of the main conversation, and at any end of one it stays
 *   true only while a background sub-agent of this session is at work, or the list of them cannot be read (`turnEnded`). A check
 *   on record outlasts this while the hash is the same: the box is back when the thread stops. Busy stuck? `Check this package`
 *   starts a new turn, and that turn's end clears it.
 * - The card on screen is the current render. (0.7.33) Plan state, the follow-up switch and rolled dates are in no hash, so
 *   `mm card` and a press each read OW's page and render again (`refreshCard`). OW with no usable hash means not ready. A
 *   fresh card that differs replaces the kept one, and a press in that state records nothing: the box says to read it again.
 * - One press is the go. (0.7.41, Rob, 2026-11-09, after signing a card and finding nothing had sent: "I thought clicking the
 *   button was all I needed to do. It really should be that, or just sending this message. I don't know why we need both.") The
 *   box writes the signer's name in, records the signature for the send gate (~/.claude/mm-hooks/card-signed.jsonl, with the hash
 *   of the page it was checked against), leaves a note in the transcript (`SIGNED_NOTE`, a row a thread's own words cannot make),
 *   folds the letter into an envelope, and then sends exactly `Send package <12>` into this thread as the person's own message
 *   (`sendGo`, `$.prompt.submit` with `asUser`). The thread runs the go of §9.5 on it, and the send gate clears that run only beside
 *   the press's own note (send-gate.js `pressGoText`). The bridge itself sends nothing to a client. Up to 0.7.40 the words went in
 *   the prompt box and the person had to press Enter as well. They still do where the engine refuses the message: the words then
 *   go in the box, and a draft of the person's there is never written over (nor is it touched when the go is sent).
 * - It is drawn in the thread too. (0.7.40, Rob, 2026-11-09: "I want to push that so it's the way reply packages are always shown,
 *   even inside the thread, instead of just the side panel.") The row of the thread's own `mm card` call that got `card ready` is
 *   the card itself (register.tsx, the `ToolUse` hook), drawn by the same `drawCard` from the same state with the same handlers
 *   (`drawLiveCard`), so a press in either place is one press and the holds are the same. The model reads only the one-line answer.
 * - Changes go in from the card. (0.7.40, Rob, 2026-11-09: "Once a team member leaves feedback, it should kick into the thread for
 *   revision, or it should make the revision and then show it in the thread for approval.") On every card of the thread's own client
 *   that can still change (`canChange`: not closed, sent or approved) and whose go is not armed (no standing signature), above the sign
 *   box, a `Changes` field sends `Feedback on Package <12> from <signer>: <words>` into the thread as the person's own prompt
 *   (`pressFeedback`). It never writes the go, a signature record or a note, and clears a go for that tag left in the prompt box: the
 *   thread revises, asks `mm card` again, and the new card is drawn under that call.
 * - (0.7.43) The quote view. (Rob, 2026-11-09: "When pricing pages are attached in reply packets, or when PDF quotes are, we need
 *   some sort of render of the invoice, the line items, and the hours quoted in the reply package visualization in the side panel…
 *   It also needs to update itself if the work in the thread changes.") Under our reply, `What the quote says`: a box per quote PDF
 *   (`rp-quote`) with its file and draft, its source and invoice lines, each table row on one line (number, words, hours, amount, the
 *   last two kept short), a subtotal muted, and a ⚠️ check in the warning tone. OW binds the quote into `package_sha256`, so a quote
 *   that changes is a new version: drawn again by `freshenPackage`, its box closed until the thread checks it. `quotesGap` holds the
 *   page's section against it (card-parity.ts).
 */
import type { BoxProps, ButtonProps, ElementConstructor, EngineInterface, InputProps, LinkProps, Register, RenderNode, SvgProps, TextProps } from 'claude-code'

import type { MmCard, MmCardAsked, MmCardChecked, MmCardFeedback, MmCardMarks, MmCardNode, MmCardRun, MmCardSigned, MmCardTree } from '../types'
import { isOwUrl, pageGap, settleLines } from './card-parity'
import { platformOf } from './threads'

const CARD = { plugin: 'mm-bridge', key: 'card' } as const
const CARD_MARKS = { plugin: 'mm-bridge', key: 'cardMarks' } as const
const CARD_CHECKED = { plugin: 'mm-bridge', key: 'cardChecked' } as const
const CARD_PENDING = { plugin: 'mm-bridge', key: 'cardPending' } as const
const CARD_BUSY = { plugin: 'mm-bridge', key: 'cardBusy' } as const
const CARD_CHECK_MISS = { plugin: 'mm-bridge', key: 'cardCheckMiss' } as const
const CARD_ASKED = { plugin: 'mm-bridge', key: 'cardAsked' } as const
const CARD_FEEDBACK = { plugin: 'mm-bridge', key: 'cardFeedback' } as const

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
/** The signature records kept in the send gate's file: the newest. */
const SIGNED_KEEP = 200
/** The largest record file read (`$.fs.read` refuses past it): a file this large is left alone, and nothing is signed. */
const SIGNED_MAX_BYTES = 4 * 1024 * 1024
/** How long a signature stands: the send gate asks for a new one past this, so the box then offers one. */
export const SIGN_VALID_MS = 2 * 60 * 60 * 1000
/** (0.7.36) How many checked versions a thread remembers: the newest. */
const CHECKED_MAX = 30
/** A press still checking the package after this has died: the box opens again. */
const CHECKING_MS = 120_000
/** How long the signature and the envelope take before the go is sent (the widget's 3.05 s). */
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
/** (0.7.36) The last usable hash OW gave of each package: `noteCurrent` forgets one on an answer with none, and this tells a new one from the last. */
const lastHashes = new Map<string, string>()
/** The page a kept card with a gap was last drawn again for, by package id: one new render for each new page, not one a draw. */
const redrawnFor = new Map<string, string>()
/** (0.7.33) The card the pane last put on the screen, by what it holds, (0.7.40) on each surface. None for a surface whose client part shows none. */
const onScreen = new Map<string, { packageId: string; key: string }>()

/**
 * (0.7.33) What the pane says when the card cannot be drawn on this computer, in place of the renderer's own error: the raw
 * error, a path or a Python line among it, goes in bridge-notices.log (`CardFor.note`).
 */
export const NOT_DRAWN = 'The card could not be drawn on this computer. Your thread prints the whole package instead.'
/**
 * (0.7.33) The send gate's own words for a computer whose signature records it cannot check. It ties a record to this user with
 * node's process.getuid, which Windows does not have, so there it refuses every signed go: the card says so, its box stays closed
 * and `mm card` answers not ready, so the thread prints the page and the go is given from that.
 */
export const NO_OWNER_CHECK = "signatures can't be checked on this computer"
/** (0.7.33) The failures already noted this session, one line each. */
const notedFailures = new Set<string>()

export const NO_CARD: MmCard = { packageId: '', projectId: '', client: '', own: false, current: null, tree: null, status: 'none', at: 0 }

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
  // ⛔ never a link to the Onboarding Wizard (Rob, 2026-11-06), whichever renderer drew this
  if (href && /^https?:\/\/[^\s<>"']+$/.test(href) && !isOwUrl(href)) run.href = href
  const m = str(o.m, 20)
  if (m && /^\d{15,20}$/.test(m)) run.m = m
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
    images: Number.isInteger(o.images) && (o.images as number) > 0 ? (o.images as number) : 0,
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

/**
 * (0.7.40) The renderer's lines for a package nothing more can change: closed with no reply owed (`Closed: no reply needed.`), with
 * everything in it already sent (`Nothing is left to send.`, as the closing line or as the foot where the go would be), or approved
 * (`Approved by <name>, <time>.`, the banner where the box would be). client-reply-prep's render_pickup.py `closing_lines` and
 * render_visual.py `part_approve` write them; card-parity.ts holds them as state lines (`STATE_LINES`).
 */
const SETTLED: readonly RegExp[] = [/^Closed: no reply needed\.$/, /^Nothing is left to send\./, /^Approved(?: by .*)?, /]

/**
 * (0.7.40) Whether the package this card was drawn from can still change: not closed, not already sent and not approved (`SETTLED`), as
 * the renderer's closing, foot and banner lines say it (`settleLines`), never a subject or any client text: a client whose subject is
 * "Approved, thanks" settles nothing.
 */
export function canChange(tree: MmCardTree): boolean {
  for (const text of settleLines(tree)) if (SETTLED.some(re => re.test(text))) return false
  return true
}

// ---------------------------------------------------------------- the package as it stands

/** What the pickup read said of the package's hash: OW's `package_sha256`. An answer with no usable hash clears the old one. */
export function noteCurrent(packageId: string, sha: unknown): void {
  if (typeof sha === 'string' && SHA.test(sha)) currents.set(packageId, sha)
  else currents.delete(packageId)
}

/**
 * (0.7.36) `noteCurrent` for a read of OW, which can also bring a new hash: that clears what stands for the version before it, so a
 * package that comes back to an earlier version waits for the thread again. A failed write costs nothing a new tag does not already close.
 */
export async function noteVersion($: EngineInterface, packageId: string, sha: unknown): Promise<void> {
  noteCurrent(packageId, sha)
  if (typeof sha !== 'string' || !SHA.test(sha)) return
  const was = lastHashes.get(packageId)
  lastHashes.set(packageId, sha)
  if (was && was !== sha) await forgetVersion($, was.slice(0, 12)).catch(() => {})
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
  for (const old of [...cards.keys()].slice(0, Math.max(0, cards.size - CARDS_MAX))) {
    cards.delete(old)
    redrawnFor.delete(old)
  }
}

/** One read of OW's page for a package: its markdown and OW's hash from the same answer. Either is null when unusable. */
export type PageRead = { markdown: string | null; sha: string | null }

/** Lowercase hex SHA-256 of the exact UTF-8 bytes of a string, as the send gate recomputes it for the page. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** A short key for all that a card draws, to tell which card reached the screen. */
function keyOf(tree: MmCardTree): string {
  return `${tree.package_sha256 ?? ''}:${fnv1a(JSON.stringify(tree.nodes))}`
}

/** The pane says which card it just drew, or that it drew none. Called from its render. */
export function noteDrawn(card: MmCard | null, surface: string): void {
  if (card?.tree && card.packageId) onScreen.set(surface, { packageId: card.packageId, key: keyOf(card.tree) })
  else onScreen.delete(surface)
}

/** This card of this package is what the pane last drew: on that surface, or on any with none named. */
export function isOnScreen(packageId: string, tree: MmCardTree | null, surface?: string): boolean {
  if (!tree) return false
  const key = keyOf(tree)
  const drawn = surface ? [onScreen.get(surface)] : [...onScreen.values()]
  return drawn.some(o => Boolean(o && o.packageId === packageId && o.key === key))
}

/**
 * (0.7.40) Whether this thread draws the card: its client part is drawn (`text`, the pane's client part) and holds the card of a package
 * as read. ⛔ ONE test for the pane, the row of the thread's own `mm card` call and a press on the box: where it fails the pane draws no
 * card, the row draws one dim line and a press signs nothing.
 */
export function cardDrawable(text: string | undefined, card: MmCard | null | undefined): boolean {
  return Boolean(text && card?.packageId && card.tree)
}

export type CardFor = {
  packageId: string
  projectId: string
  client: string
  own: boolean
  /** The package's hash as the pickup read just gave it (currentOf). */
  current: string | null
  /** (0.7.33) The page that read returned, for the parity check (`pageGap`); null when it could not be read. */
  page: string | null
  signer: string
  home: string
  /** (0.7.33) One line in bridge-notices.log. */
  note: (line: string) => Promise<void>
  /** Whether this draw of the client part is still the session's newest. */
  isNewest: () => Promise<boolean>
}

/** (0.7.33) The raw error of a render goes in the log, once a reason, and never in the pane. Cut before any JSON it quotes: that is the package. */
async function noteFailure(note: (line: string) => Promise<void>, packageId: string, got: string): Promise<void> {
  const key = `${packageId}\n${got}`
  if (notedFailures.has(key)) return
  notedFailures.add(key)
  await note(`card for package ${packageId} could not be drawn: ${got.split('{')[0]?.trim() ?? ''}`).catch(() => {})
}

/** (0.7.0) Whether this computer runs Windows. The engine says nothing of the platform: `$.env` is how this plugin tells. */
export async function onWindows($: EngineInterface): Promise<boolean> {
  return platformOf({ OS: await $.env.get('OS'), HOME: await $.env.get('HOME') }) === 'windows'
}

/**
 * (0.7.33) What one read of the page says of a card: its gap, for a card drawn from the package as it stands (any other is held
 * as stale), and the page's own hash, which is what a signature is for.
 */
async function pageFacts($: EngineInterface, tree: MmCardTree | null, page: string | null, current: string | null): Promise<{ gap?: string; pageSha?: string }> {
  const gap = !tree || !isFresh(tree, current) ? '' : (await onWindows($)) ? NO_OWNER_CHECK : pageGap(page, tree)
  return { ...(gap ? { gap } : {}), ...(page ? { pageSha: await sha256Hex(page) } : {}) }
}

/**
 * The card for a client part with a package, drawn with what is kept at once (no wait): the kept card when there is one
 * (without the signature box until it is known fresh), else nothing yet. Called where the part is drawn at once.
 */
export async function showKept($: EngineInterface, f: Omit<CardFor, 'signer' | 'home' | 'note'>): Promise<void> {
  const tree = cards.get(f.packageId) ?? null
  // before the check that this draw is still the newest, and nothing slow between that check and the write
  const facts = await pageFacts($, tree, f.page, f.current)
  const at = await $.clock.now()
  if (!(await f.isNewest())) return
  await $.state.set(CARD, {
    packageId: f.packageId, projectId: f.projectId, client: f.client, own: f.own, current: f.current, tree,
    status: tree ? (isFresh(tree, f.current) ? 'ready' : 'rendering') : 'rendering', ...facts, at,
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
    const facts = await pageFacts($, kept, f.page, f.current)
    const base = { packageId: f.packageId, projectId: f.projectId, client: f.client, own: f.own, current: f.current, ...(facts.pageSha ? { pageSha: facts.pageSha } : {}) }
    // (0.7.33) a gap is drawn again once for each new page: rolled dates, a Cc or the follow-up switch are in no hash
    const gap = facts.gap ? { gap: facts.gap } : {}
    const began = await $.clock.now()
    if (kept && isFresh(kept, f.current) && (!gap.gap || !f.page || redrawnFor.get(f.packageId) === f.page)) {
      if (await f.isNewest()) await $.state.set(CARD, { ...base, tree: kept, status: 'ready', ...gap, at: began } satisfies MmCard)
      return
    }
    if (kept && f.page && gap.gap) redrawnFor.set(f.packageId, f.page)
    if (await f.isNewest()) await $.state.set(CARD, { ...base, tree: kept, status: 'rendering', at: began } satisfies MmCard)
    const got = await render($, f.home, f.packageId, f.signer)
    if (typeof got !== 'string') keep(f.packageId, got)
    const drawn = typeof got === 'string' ? {} : await pageFacts($, got, f.page, f.current)
    const at = await $.clock.now()
    if (!(await f.isNewest())) return
    if (typeof got === 'string') {
      await $.state.set(CARD, { ...base, tree: kept, status: 'failed', error: got, at } satisfies MmCard)
      await noteFailure(f.note, f.packageId, got)
    } else await $.state.set(CARD, { ...base, tree: got, status: 'ready', ...drawn, at } satisfies MmCard)
  } catch {
    // the page stands alone
  }
}

/**
 * (0.7.33) The card brought up to what the package is now, from one read of OW's page: drawn again, and if its words differ
 * from the kept card's, the kept card replaced. Plan state, the follow-up switch and rolled dates are in no hash, so a hash
 * that matches proves none of them. OW with no usable hash, or a page it did not give, closes the box. Never throws.
 * Says what became of it: `same`, `changed`, `no-hash`, `failed`, or `other` when the pane no longer holds this package.
 */
export async function refreshCard(
  $: EngineInterface,
  f: { packageId: string; signer: string; home: string; note: (line: string) => Promise<void> },
  read: PageRead,
): Promise<'same' | 'changed' | 'no-hash' | 'failed' | 'other'> {
  try {
    const was = await cardOf($)
    if (was.packageId !== f.packageId) return 'other'
    if (!read.sha || !read.markdown) {
      const { gap: _gap, pageSha: _pageSha, ...rest } = was
      await $.state.set(CARD, { ...rest, current: null, at: await $.clock.now() } satisfies MmCard)
      return 'no-hash'
    }
    // a render running began before this read, so it says nothing of the package now: wait for it, then draw again
    await running.get(f.packageId)?.catch(() => undefined)
    const got = await render($, f.home, f.packageId, f.signer)
    const facts = await pageFacts($, typeof got === 'string' ? null : got, read.markdown, read.sha)
    const now = await cardOf($)
    if (now.packageId !== f.packageId) return 'other'
    const at = await $.clock.now()
    if (typeof got === 'string') {
      const { gap: _gap, ...rest } = now
      await $.state.set(CARD, { ...rest, current: read.sha, status: 'failed', error: got, pageSha: facts.pageSha as string, at } satisfies MmCard)
      await noteFailure(f.note, f.packageId, got)
      return 'failed'
    }
    keep(f.packageId, got)
    const same = Boolean(now.tree) && now.tree?.package_sha256 === got.package_sha256 && JSON.stringify(now.tree?.nodes) === JSON.stringify(got.nodes)
    const { gap: _gap, error: _error, ...rest } = now
    await $.state.set(CARD, { ...rest, tree: same ? now.tree : got, current: read.sha, status: 'ready', ...facts, at } satisfies MmCard)
    return same ? 'same' : 'changed'
  } catch {
    return 'failed'
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

// ---------------------------------------------------------------- the thread's own marks: signatures, the page as text

export async function marksOf($: EngineInterface): Promise<MmCardMarks> {
  const { value } = (await $.state.get(CARD_MARKS)) as { value: Partial<MmCardMarks> | undefined }
  return {
    signed: value?.signed && typeof value.signed === 'object' ? (value.signed as Record<string, MmCardSigned>) : {},
    ...(value?.pageOpen === true ? { pageOpen: true } : {}),
    ...(value?.checking ? { checking: value.checking } : {}),
    ...(value?.notice ? { notice: value.notice } : {}),
  }
}

export async function togglePage($: EngineInterface): Promise<void> {
  const marks = await marksOf($)
  await $.state.set(CARD_MARKS, { ...marks, pageOpen: !marks.pageOpen })
}

/** (0.7.36) The versions this thread has finished checking (`MmCardChecked`). A restart loses them, which only closes the box. */
export async function checkedOf($: EngineInterface): Promise<MmCardChecked> {
  const { value } = await $.state.get(CARD_CHECKED)
  return value && typeof value === 'object' ? value : {}
}

/** (0.7.36) The versions the turn under way got `card ready` for, or printed the page of (`MmCardChecked`). */
async function pendingOf($: EngineInterface): Promise<MmCardChecked> {
  const { value } = await $.state.get(CARD_PENDING)
  return value && typeof value === 'object' ? value : {}
}

type CardCheckMiss = { label: string; filled: 'draft' | 'none' }

/** (0.7.36) Whether this thread is working (`CARD_BUSY`): never written means no turn has started here. */
export async function busyOf($: EngineInterface): Promise<boolean> {
  return (await $.state.get(CARD_BUSY)).value === true
}

async function setBusy($: EngineInterface, busy: boolean): Promise<void> {
  if ((await busyOf($)) !== busy) await $.state.set(CARD_BUSY, busy)
}

/** (0.7.36) The tag whose Check button could not put its words in the prompt box, and why; null with none. */
export async function checkMissOf($: EngineInterface): Promise<CardCheckMiss | null> {
  const { value } = await $.state.get(CARD_CHECK_MISS)
  return value && typeof value === 'object' ? value : null
}

/** (0.7.36) This thread has finished checking this version of the package. Pending does not count: the turn may still be checking. */
export const isChecked = (checked: MmCardChecked, label: string): boolean => Object.hasOwn(checked, label)

/** These tags, newest last, on top of what stands: the newest CHECKED_MAX are kept. */
function withTags(had: MmCardChecked, tags: readonly string[], at: number): MmCardChecked {
  const kept = Object.entries(had).filter(([label]) => !tags.includes(label))
  return Object.fromEntries([...kept, ...tags.map(label => [label, at] as const)].slice(-CHECKED_MAX))
}

/** (0.7.36) The turn under way got `card ready` for these versions, or printed their pages: they are checked once it ends (`turnEnded`). */
export async function notePending($: EngineInterface, labels: readonly string[]): Promise<void> {
  const tags = labels.filter(label => LABEL.test(label))
  if (tags.length) await $.state.set(CARD_PENDING, withTags(await pendingOf($), tags, await $.clock.now()))
}

/**
 * (0.7.36) How many times a turn of the main conversation has started or ended in this process. A module's and not the state: one dispatch
 * reads the state at one moment, so a `mm card` still running could never see a turn begin there. It keeps what this said when it started
 * (`turnMark`), and a call that outlived its turn leaves nothing pending.
 */
let turnMarks = 0
export const turnMark = (): number => turnMarks

/** Where a loop is at work (`AgentStatus`): about to run, running a turn, or held on background work it owns. `idle` waits for a message; the rest have ended. */
const AT_WORK: ReadonlySet<string> = new Set(['pending', 'running', 'waiting'])

/**
 * (0.7.36) Whether a background sub-agent of this session is still at work. Measured on 2026-11-07 in a main-loop turn, at its `turn.complete`:
 * `$.agent.list()` answers, a foreground agent has already left the list, and a background one reads `running`. When that one ends it reads
 * `completed`, and the engine starts a new main turn, whose end clears the busy. ⛔ A list that cannot be read counts as at work. A teammate
 * in a terminal pane of its own is left out: it runs no loop here (its id is its address), and the word it last wrote outlives a dead pane,
 * so no turn's end could ever clear it.
 */
async function subAgentAtWork($: EngineInterface): Promise<boolean> {
  try {
    return (await $.agent.list()).some(a => AT_WORK.has(a.status) && a.id !== a.teammateId)
  } catch {
    return true
  }
}

/**
 * (0.7.36) Whether this engine can say what the sub-agents are doing at all. Review round 2 (2026-11-07): where `$.agent.list()` is
 * missing or always fails, every turn's end counts as busy, so the box would never open while `mm card` kept answering ready, and the
 * thread would never print the page. `mm card` answers not ready there instead, and the thread prints it.
 */
export async function agentListReadable($: EngineInterface): Promise<boolean> {
  try {
    await $.agent.list()
    return true
  } catch {
    return false
  }
}

/**
 * (0.7.36) The end of a turn of the main conversation, for any reason. Busy stays only while a background sub-agent is at work. One that
 * ended with an answer, with none at work, has finished: what it left pending is on record as checked, and the box opens. Otherwise what
 * it left pending is dropped, so that the thread has to ask again: a turn that stopped short (interrupted, refused, an error), or a
 * sub-agent started after the ask, which may yet find something. A pending version a dead session left never gets here, and that session's
 * state is gone with it: the box stays closed there, and `Check this package` starts a turn that can open it.
 */
export async function turnEnded($: EngineInterface, finished: boolean): Promise<void> {
  turnMarks++
  const busy = await subAgentAtWork($)
  const tags = Object.keys(await pendingOf($))
  if (tags.length) {
    if (finished && !busy) await $.state.set(CARD_CHECKED, withTags(await checkedOf($), tags, await $.clock.now()))
    await $.state.set(CARD_PENDING, {})
  }
  await setBusy($, busy)
}

/**
 * (0.7.36) The start of a turn of the main conversation: the box closes while the thread works. What is still pending belongs to a turn that
 * is over, and is dropped so that only the same turn's end can make it checked. What the Check button said about the prompt box is over
 * too: the person has sent something.
 */
export async function turnBegan($: EngineInterface): Promise<void> {
  turnMarks++
  await setBusy($, true)
  if (Object.keys(await pendingOf($)).length) await $.state.set(CARD_PENDING, {})
  if (await checkMissOf($)) await $.state.set(CARD_CHECK_MISS, null)
}

/** (0.7.36) Nothing stands for this version any more, pending or checked. */
async function forgetVersion($: EngineInterface, label: string): Promise<void> {
  const checked = await checkedOf($)
  if (isChecked(checked, label)) await $.state.set(CARD_CHECKED, Object.fromEntries(Object.entries(checked).filter(([tag]) => tag !== label)))
  const pending = await pendingOf($)
  if (isChecked(pending, label)) await $.state.set(CARD_PENDING, Object.fromEntries(Object.entries(pending).filter(([tag]) => tag !== label)))
}

/** The tags of every pickup page closing line in a response of this thread. */
export function printedTags(text: string): string[] {
  return [...text.matchAll(CLOSING)].map(m => m[1] as string)
}

/**
 * (0.7.36) Every response block of this thread is read for a pickup page's closing line: a printed page leaves that version pending, and
 * the end of the turn makes it checked. Measured on 2026-11-07 in a main-loop turn: a turn's last block reaches `session.append` before
 * `turn.complete` fires, so a page printed last counts at the end of that same turn. Reads only; the row is stored as it came.
 */
export function cardHooks(on: Parameters<Register>[0]): void {
  on('session.append', { door: 'response' }, async ($, e, next) => {
    try {
      if (!e.agentId && e.message.type === 'assistant') {
        const text = (e.message.content ?? []).map(b => (b && (b as { type?: string }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : '')).join('\n')
        if (text.includes('Package `')) await notePending($, printedTags(text))
      }
    } catch {
      // the row is stored as it came
    }
    return next(e)
  })
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

/**
 * What of the card itself holds its signature box back, or '' when nothing does. ⛔ (0.7.36) The wait for the thread's check (`isChecked`)
 * is not in here: `mm card` answers from this, and its ready is what ends that wait, so it could never answer ready.
 */
export function holdOf(card: MmCard): string {
  const tree = card.tree
  const sign = signOf(tree)
  if (!tree || !sign) return 'no-sign'
  if (!copyCheck(tree)) return 'drift'
  // (0.7.33) a card that could not be drawn again says nothing of the package now, whatever its hash
  if (!isFresh(tree, card.current) || card.status === 'failed') return 'stale'
  if (!card.own) return 'not-own'
  if (card.gap === NO_OWNER_CHECK) return 'no-owner-check'
  // (0.7.33) the page holds something this card does not: the thread prints the page, and the go is given from it
  if (card.gap) return 'page'
  return ''
}

/**
 * (0.7.33) What `mm card` answers for this card, in words a thread can print after `card not ready: `, or '' when the card
 * stands in for the page: it is that package's, drawn, and nothing holds its signature box back.
 */
export function cardVerdict(card: MmCard, packageId: string): string {
  if (card.packageId !== packageId) return 'the side pane is not showing this package'
  if (card.status === 'rendering') return 'the card is still being drawn'
  if (card.status !== 'ready' || !card.tree) return 'the card could not be drawn on this computer'
  switch (holdOf(card)) {
    case '':
      return ''
    case 'no-sign':
      return 'the card offers no signature box for this package'
    case 'drift':
      return 'the card does not match the stored drafts'
    case 'stale':
      return card.current ? 'the card was drawn from an older version of this package' : 'OW gave no usable hash for this package'
    case 'not-own':
      return "this is not the client's own thread"
    case 'page':
      return card.gap ?? 'the page holds a line the card does not'
    case 'no-owner-check':
      return NO_OWNER_CHECK
    default:
      return 'the card cannot stand in for the page'
  }
}

/** (0.7.33) Where a press records its signature, how it reads OW's page, and where a record that could not be written is said. */
export type SignLog = {
  home: string
  note: (line: string) => Promise<void>
  readPage: (packageId: string) => Promise<PageRead>
  /** (0.7.40) Whether this thread draws the card now (`cardDrawable` over the pane's client part): a press where it does not signs nothing. */
  held: () => Promise<boolean>
}

/** What the file holds now, '' when it is not there yet. ⛔ Anything else throws, so that it is never written over: a read error, a file too large, a link. */
async function recordsOf($: EngineInterface, path: string): Promise<string> {
  let stat: { kind: string; size: number; isLink: boolean }
  try {
    stat = await $.fs.stat(path)
  } catch (err) {
    if (/ENOENT/.test(err instanceof Error ? err.message : String(err))) return ''
    throw err
  }
  if (stat.isLink || stat.kind !== 'file') throw new Error('the record file is not a regular file')
  if (stat.size > SIGNED_MAX_BYTES) throw new Error('the record file is too large')
  return $.fs.read(path)
}

/** (0.7.33) One record, with no line break: the exact bytes of the send gate's pinned example (card.test.ts holds it). */
export async function signatureLine(r: { sessionId: string; packageId: string; sha: string; markdown: string; signer: string; at: number }): Promise<string> {
  return JSON.stringify({
    v: 1,
    session_id: r.sessionId,
    package_id: r.packageId,
    package_sha256: r.sha,
    page_sha256: await sha256Hex(r.markdown),
    label: r.sha.slice(0, 12),
    signer: r.signer.trim() || 'Approver',
    at: new Date(r.at).toISOString(),
  })
}

/**
 * (0.7.33) The signature, for the send gate (global-config/hooks/send-gate.js reads this exact shape): one line appended to
 * ~/.claude/mm-hooks/card-signed.jsonl, the newest SIGNED_KEEP kept, mode 0600. `session_id` is `$.session.id()`, the
 * transcript's id: what a PreToolUse hook gets as `session_id`, never the app's `local_` id. `page_sha256` is the hash of the
 * page read for this press, which the gate recomputes at the go. ⛔ False when it could not be written, and the file is left
 * as it was: no record means nothing is signed, and the box says to try again.
 */
async function recordSignature($: EngineInterface, card: MmCard, signer: string, markdown: string, log: SignLog): Promise<boolean> {
  try {
    const sha = card.tree?.package_sha256
    if (!sha || !SHA.test(sha)) throw new Error('the card has no package hash')
    const path = `${log.home}/.claude/mm-hooks/card-signed.jsonl`
    const had = await recordsOf($, path)
    const line = await signatureLine({ sessionId: await $.session.id(), packageId: card.packageId, sha, markdown, signer, at: await $.clock.now() })
    const lines = `${had}${line}\n`.split('\n').filter(Boolean).slice(-SIGNED_KEEP)
    await $.fs.write(path, `${lines.join('\n')}\n`)
    // `$.fs.write` takes no mode. The gate takes a record only from a file of this user's, mode 0600, so a chmod that fails leaves
    // a record it refuses. On Windows it can check neither and refuses every signed go: no box is offered there (NO_OWNER_CHECK).
    await $.process.run(['chmod', '600', path], { timeoutMs: 5_000 }).catch(() => undefined)
    return true
  } catch (err) {
    await log.note(`card signature for package ${card.packageId} not recorded: ${err instanceof Error ? err.message.slice(0, 160) : 'no reason given'}`).catch(() => {})
    return false
  }
}

/**
 * (0.7.36) The note a press leaves in the transcript, word for word: the version it signed and the first 12 of the record's `page_sha256`.
 * ⛔ send-gate.js `CARD_PRESS_NOTE` in the control tower parses these words: change both together.
 */
export const SIGNED_NOTE = (label: string, page12: string): string => `[Massmarket bridge, no reply needed] Card signed in the side pane: Package ${label}, page ${page12}. Nothing has been sent.`

/**
 * (0.7.36) The press's mark in the transcript, for the send gate: a row a thread's own words cannot make, stored `isMeta` under the
 * bridge's name as `origin`, which starts no turn. ⛔ False when it could not be appended (the engine refused it, or a plugin above
 * answered `{ deny }`): no note means no words in the prompt box, as for a record that could not be written.
 */
async function appendSigned($: EngineInterface, card: MmCard, label: string, page12: string, log: SignLog): Promise<boolean> {
  try {
    const stored = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: SIGNED_NOTE(label, page12) }] } })
    if (stored.deny !== undefined) throw new Error(stored.deny)
    return true
  } catch (err) {
    await log.note(`card signature note for package ${card.packageId} not appended: ${err instanceof Error ? err.message.slice(0, 160) : 'no reason given'}`).catch(() => {})
    return false
  }
}

/**
 * (0.7.33) The signature that stands for this tag: under SIGN_VALID_MS old, and for the page as it reads now. Past either the gate no
 * longer takes it, so the card reads unsigned and a press writes a new record: plan approval adds a Cc, and rolled dates or the
 * follow-up switch change the page, with the package's hash the same.
 */
export function standing(marks: MmCardMarks, label: string, card: Pick<MmCard, 'pageSha'>, now: number): MmCardSigned | undefined {
  const signed = marks.signed[label]
  return signed && now - signed.at < SIGN_VALID_MS && signed.pageSha && signed.pageSha === card.pageSha ? signed : undefined
}

/** Whether this press is still checking the package, so the box waits. */
const isChecking = (marks: MmCardMarks, label: string, now: number) => marks.checking?.label === label && now - marks.checking.at < CHECKING_MS

/**
 * A press on Click to sign and send. First the package is read and drawn again (`refreshCard`): the signature is for the card as
 * it stands now. A card that changed is replaced, nothing is recorded and the box says to read it again; a read or a record that
 * fails records nothing and the box says to try again. Then the signature goes on record and (0.7.36) its note in the transcript
 * (`appendSigned`), always in that order (the pane draws it inking in and the envelope), and when the envelope has flown, exactly
 * `Send package <12>` is sent into this thread as the person's go (`sendGo`; 0.7.41, before it went in the prompt box for Enter), if
 * the card still holds then and the thread is not working. A note that cannot be appended stops there, as a record that cannot be
 * written does: the record stands in its file, with no note and no words.
 * One signature a tag while it stands (`standing`): once the gate would no longer take it, a new press signs again.
 * (0.7.36) A press while this thread is working, or for a version it has not finished checking, records nothing, while its turn is still
 * running too: the box is not drawn then, so this is the second line of defence for a press that was already under way.
 */
export async function pressSign($: EngineInterface, label: string, log: SignLog): Promise<void> {
  // (0.7.41) one press of a tag at a time: two clicks a few milliseconds apart both read the marks before either set `checking`,
  // and each would sign and send a go
  if (pressing.has(label)) return
  pressing.add(label)
  try {
    await signOnce($, label, log)
  } finally {
    pressing.delete(label)
  }
}

/** (0.7.41) The tags whose press is under way in this session, up to its record and note (the go follows on the timer). */
const pressing = new Set<string>()

async function signOnce($: EngineInterface, label: string, log: SignLog): Promise<void> {
  const { value: card } = await $.state.get(CARD)
  const marks = await marksOf($)
  const pressed = await $.clock.now()
  if ((await busyOf($)) || !isChecked(await checkedOf($), label)) return
  if (!card || !card.tree || standing(marks, label, card, pressed) || isChecking(marks, label, pressed)) return
  if (holdOf(card) || signOf(card.tree)?.label !== label) return
  const { notice: _notice, ...kept } = marks
  // (0.7.40) the pane draws no card here (its client part shows none): a box still on screen signs nothing, and says to try again
  if (!(await log.held())) {
    await $.state.set(CARD_MARKS, { ...kept, notice: { packageId: card.packageId, kind: 'retry' } })
    return
  }
  await $.state.set(CARD_MARKS, { ...kept, checking: { label, at: pressed } })
  const end = async (after: Partial<MmCardMarks>) => {
    const { checking: _checking, notice: _old, ...m } = await marksOf($)
    await $.state.set(CARD_MARKS, { ...m, ...after })
  }
  const packageId = card.packageId
  const stop = (kind: 'changed' | 'retry') => end({ notice: { packageId, kind } })
  let read: PageRead
  try {
    read = await log.readPage(packageId)
  } catch {
    return stop('retry')
  }
  const signer = signOf(card.tree)?.signer ?? card.tree.signer
  const outcome = await refreshCard($, { packageId, signer, home: log.home, note: log.note }, read)
  if (outcome === 'no-hash' || outcome === 'failed' || outcome === 'other' || !read.markdown) return stop('retry')
  const fresh = await cardOf($)
  if (outcome === 'changed' || holdOf(fresh) || signOf(fresh.tree)?.label !== label) return stop('changed')
  const at = await $.clock.now()
  const pageSha = await sha256Hex(read.markdown)
  // (0.7.40) and still drawn here once the page is read again, or nothing goes on record
  if (!(await log.held())) return stop('retry')
  // (0.7.33) on record before the words can reach the prompt box
  if (!(await recordSignature($, fresh, signer, read.markdown, log))) return stop('retry')
  // (0.7.36) then the note, right after it: the send gate matches it to the record's page, session and time. Record, note, words, always
  if (!(await appendSigned($, fresh, label, pageSha.slice(0, 12), log))) return stop('retry')
  const signed: MmCardSigned = { label, signer, at, pageSha }
  const m = await marksOf($)
  await end({ signed: { ...m.signed, [label]: signed } })
  await $.clock.after(SIGN_FILL_MS, async () => {
    const { value: now } = await $.state.get(CARD)
    const latest = await marksOf($)
    // the package or its page changed, or the pane moved to another package, while the envelope flew: nothing is sent
    const holds = !now || now.tree?.label !== label || now.pageSha !== pageSha || Boolean(holdOf(now))
    // (0.7.40) nor when the thread has started a turn since (a change sent from the card, say). The signature is dropped, so nothing stands
    // for this tag and the box comes back by its usual holds once the turn ends; the record line already written stays, and a new press
    // writes a new one. The card says why.
    if (!holds && (await busyOf($))) {
      const { [label]: _dropped, ...signed } = latest.signed
      await $.state.set(CARD_MARKS, { ...latest, signed, notice: { packageId, kind: 'busy' } })
      return
    }
    const filled = holds ? 'stale' : await sendGo($, label)
    // read again: the go's own turn may have begun while it was sent, and it writes these marks too
    const after = await marksOf($)
    const mine = after.signed[label]
    if (mine) await $.state.set(CARD_MARKS, { ...after, signed: { ...after.signed, [label]: { ...mine, filled } } })
  })
}

/**
 * (0.7.41) The go of a press, sent: exactly `Send package <12>` into this thread as the person's own message (`asUser`: the model reads it
 * bare, as theirs; the transcript stores it under the bridge's origin, which no thread can write, and the send gate takes it as the
 * person's go only right after the bridge's note of a press on that same package, send-gate.js `pressGoText`). Called only by a press
 * (`pressSign`), after the record and the note, with the card still holding and the thread idle. `sent` when it entered the session.
 * - ⛔ The prompt box is never written over: a draft of the person's stays as it is. Only the exact go of this tag left there by an older
 *   press is cleared, so it can never be sent a second time.
 * - A message the engine refuses (`{ drop }`) falls back to the prompt box as up to 0.7.40 (`fillWords`): `filled`, or `draft` / `none`
 *   when the box holds other text or cannot be filled. The card then says to press Enter or what to type. One that throws may have gone
 *   in before it failed, so the box is left alone (`unsure`) and the card says to type the go only if it does not show in the thread.
 */
export async function sendGo($: EngineInterface, label: string): Promise<'sent' | 'filled' | 'draft' | 'none' | 'unsure'> {
  const words = `Send package ${label}`
  let went = false
  try {
    const r = (await $.prompt.submit({ text: words, asUser: true })) as { drop?: unknown } | undefined
    went = !(r && typeof r === 'object' && r.drop !== undefined)
  } catch {
    // (review of 0.7.41) a submit that throws may have gone in before it failed: words in the box then invite a second go
    return 'unsure'
  }
  if (!went) return fillWords($, words)
  try {
    const box = await $.prompt.read()
    if (String(box?.text ?? '').trim() === words) await $.prompt.fill({ text: '', mode: 'replace' })
  } catch {
    // a box that cannot be read or filled is left as it is
  }
  return 'sent'
}

/** A press on one of the card's own buttons (Read the whole transcript, Fix these first): its words in the prompt box. */
export async function pressAsk($: EngineInterface, words: string): Promise<void> {
  await fillWords($, words)
}

/**
 * (0.7.36) A press on Check this package: its words in the prompt box. It never fails silently: when the box holds other text
 * (`CHECK_DRAFT`), or cannot be read or filled (`CHECK_TYPE`), the pane says what to type.
 */
export async function pressCheck($: EngineInterface, label: string): Promise<void> {
  const filled = await fillWords($, `Check package ${label}`)
  const miss = filled === 'filled' ? null : { label, filled }
  const had = await checkMissOf($)
  if (had?.label !== miss?.label || had?.filled !== miss?.filled) await $.state.set(CARD_CHECK_MISS, miss)
}

// ---------------------------------------------------------------- (0.7.40) the card in the thread, and the Changes field

/** (0.7.40) The live `mm card` call: the main thread's own call whose answer was the last `card ready` (`MmCardAsked`). Null with none. */
export async function askedOf($: EngineInterface): Promise<MmCardAsked | null> {
  const { value } = await $.state.get(CARD_ASKED)
  return value && typeof value === 'object' && typeof value.toolUseId === 'string' && typeof value.label === 'string' ? value : null
}

/** (0.7.40) This call's `card ready` is the live one now: its row draws the card, and every earlier ready row a line. A later ready replaces it. */
export async function noteAsked($: EngineInterface, asked: { packageId: string; label: string; toolUseId: string }): Promise<void> {
  if (!asked.toolUseId || !LABEL.test(asked.label)) return
  await $.state.set(CARD_ASKED, { ...asked, at: await $.clock.now() } satisfies MmCardAsked)
}

/** (0.7.40) What the Changes field last said, for the tag it was sent for (`MmCardFeedback`). Null with none. */
export async function feedbackOf($: EngineInterface): Promise<MmCardFeedback | null> {
  const { value } = await $.state.get(CARD_FEEDBACK)
  return value && typeof value === 'object' && typeof value.label === 'string' && typeof value.said === 'string' ? value : null
}

/** (0.7.40) The most of the person's words one Changes submit carries, in characters. */
export const FEEDBACK_MAX = 4_000
/** (0.7.40) The prompt the Changes field sends into the thread. */
export const FEEDBACK_TEXT = (label: string, signer: string, words: string): string => `Feedback on Package ${label} from ${signer}: ${words}`
/** (0.7.40) What the card says under the field after a submit, by what became of it. */
export const FEEDBACK_SAID = {
  sent: 'Sent to your thread. It is revising the package and will show the new card here.',
  go: 'That reads like a go. Use the box below to sign and send.',
  filled: 'That did not reach your thread, so it is in your prompt box. Press Enter to send it.',
  draft: 'Your prompt box holds a draft. Type the change in the chat box instead.',
  none: 'That did not reach your thread. Type the change in the chat box instead.',
  busy: 'Your thread is busy, so it reads this when it finishes. A send already under way is not stopped by this: press Stop for that.',
  changed: 'This package changed while you typed. Read the new card and send your change again.',
} as const
export const FEEDBACK_LABEL = 'Changes'
export const FEEDBACK_PLACEHOLDER = 'What should change? Your thread revises the package and shows it here again.'
export const FEEDBACK_SUBMIT = 'Send to thread'
/** (0.7.40) Words that read like the go: the field never sends them, and says to use the box. */
const READS_LIKE_GO = /^send\s+package/i

/**
 * (0.7.40) Enter in the Changes field: the person's words, trimmed and cut to FEEDBACK_MAX characters, go into this thread as their own
 * prompt (`FEEDBACK_TEXT`, `asUser`), for the tag that was DRAWN with the field and its signer, and the card says it went. A thread at
 * work takes it once idle, and the card says so (`busy`). Empty words do nothing.
 * - ⛔ Refused, nothing sent: another client's card, another package, a package closed, sent or approved since (`canChange`), and while a
 *   signature for this tag stands (a go is armed). A card whose tag moved on while the person typed says so (`changed`), under the new tag.
 * - ⛔ Words that read like the go (`Send package ...`) are never sent from here: the go is the box's alone.
 * - ⛔ No signature record, no note, no `Send package` words: this is not a press. Once the change is in, a go left in the prompt box for
 *   this tag (exactly `Send package <tag>`) is cleared and the tag's signature mark dropped: no go stays armed beside a change request.
 * - A submit the engine refuses, or that fails, falls back to the prompt box, a draft of the person's never written over.
 */
export async function pressFeedback($: EngineInterface, drawn: { packageId: string; label: string }, value: string): Promise<void> {
  const words = Array.from(String(value ?? '').trim()).slice(0, FEEDBACK_MAX).join('')
  if (!words) return
  const card = await cardOf($)
  const tag = drawn.label
  if (!LABEL.test(tag) || !card.own || !card.packageId || card.packageId !== drawn.packageId || !card.tree) return
  const say = (label: string, said: MmCardFeedback['said']) => $.state.set(CARD_FEEDBACK, { label, said } satisfies MmCardFeedback)
  if (card.tree.label !== tag) {
    if (LABEL.test(card.tree.label)) await say(card.tree.label, 'changed')
    return
  }
  // a package closed, sent or approved since the field was drawn takes no changes, and nor does one whose go is armed or being signed
  const marks = await marksOf($)
  const at = await $.clock.now()
  if (!canChange(card.tree) || standing(marks, tag, card, at) || isChecking(marks, tag, at)) return
  if (READS_LIKE_GO.test(words)) {
    await say(tag, 'go')
    return
  }
  const signer = signOf(card.tree)?.signer ?? card.tree.signer ?? 'Approver'
  const text = FEEDBACK_TEXT(tag, signer, words)
  const busy = await busyOf($)
  let went = false
  try {
    // the person's own words, typed in the card: the model reads them bare, as theirs (the origin every hook sees stays this plugin's)
    const r = (await $.prompt.submit({ text, asUser: true })) as { drop?: unknown } | undefined
    went = !(r && typeof r === 'object' && r.drop !== undefined)
  } catch {
    went = false
  }
  if (!went) {
    await say(tag, await fillWords($, text))
    return
  }
  await disarm($, tag)
  await say(tag, busy ? 'busy' : 'sent')
}

/** (0.7.40) After a change request: the go for this tag left in the prompt box is cleared, and its signature mark dropped. Nothing else is touched. */
async function disarm($: EngineInterface, tag: string): Promise<void> {
  try {
    const box = await $.prompt.read()
    if (box?.text === `Send package ${tag}`) await $.prompt.fill({ text: '', mode: 'replace' })
  } catch {
    // a box that cannot be read or filled is left as it is
  }
  const marks = await marksOf($)
  if (!marks.signed[tag]) return
  const { [tag]: _dropped, ...signed } = marks.signed
  await $.state.set(CARD_MARKS, { ...marks, signed })
}

// ---------------------------------------------------------------- drawing

/** The elements the card draws with: what every surface carries, and a desktop's Svg and Button where it has them. */
export type Els = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button?: ElementConstructor<ButtonProps>
  Link?: ElementConstructor<LinkProps>
  Svg?: ElementConstructor<SvgProps>
  /** (0.7.40) The Changes field: on every surface but mobile, which draws no field. */
  Input?: ElementConstructor<InputProps>
}

type Node = RenderNode | null

const has = (c: string | undefined, name: string) => ` ${c ?? ''} `.includes(` ${name} `)
/** (0.7.43) The four cells of a quote row, as render_visual.py classes them. */
const QUOTE_CELL = /(?:^|\s)rp-quote-(?:no|line|hours|amt)(?:\s|$)/

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

/** A paragraph's text style, from its classes and where it sits; (0.7.43) a quote's check also by the mark its words open with. */
function paraStyle(c: string | undefined, ctx: Ctx, words = ''): TextProps {
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
  // (0.7.43) the quote view: its head like a draft's title, its source lines small, each row's cells in one line
  if (has(c, 'rp-quote-head')) Object.assign(p, { weight: 'semibold', size: 'footnote' })
  if (has(c, 'rp-quote-src') || has(c, 'rp-quote-inv') || has(c, 'rp-quote-more')) Object.assign(p, { size: 'caption' }, dim())
  if (has(c, 'rp-quote-tt')) Object.assign(p, { weight: 'semibold', size: 'caption' }, dim())
  if (QUOTE_CELL.test(c ?? '')) Object.assign(p, { size: 'footnote' }, has(ctx.parent, 'rp-quote-sub') ? { ...dim(), italic: true } : {})
  if (has(c, 'rp-quote-no')) p.dimColor = true
  if (has(c, 'rp-quote-hours') || has(c, 'rp-quote-amt')) p.tabular = true
  if (has(c, 'rp-quote-total')) Object.assign(p, { weight: 'semibold', size: 'footnote' })
  if (has(c, 'rp-quote-check')) {
    p.size = 'footnote'
    const tone = toneColor(c) ?? (words.startsWith('⚠') ? 'warning' : words.startsWith('✅') ? 'success' : undefined)
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
  // (0.7.43) a quote PDF is a card of its own, and each of its table rows one line of four cells
  if (has(c, 'rp-quote')) Object.assign(p, card)
  if (has(c, 'rp-quote-row')) Object.assign(p, { flexDirection: 'row', gap: 1, alignItems: 'flex-start' })
  void ctx
  return p
}

/** (0.7.43) A quote row's cell, in a box of its own: the number narrow, the words taking the room and wrapping, hours and amount kept short at the right. */
function quoteCell(els: Els, c: string | undefined, text: Node): Node {
  const { Box } = els
  if (has(c, 'rp-quote-no')) return <Box minWidth={3} flexShrink={0}>{text}</Box>
  if (has(c, 'rp-quote-line')) return <Box flexGrow={1} flexShrink={1}>{text}</Box>
  return <Box minWidth={has(c, 'rp-quote-amt') ? 9 : 6} flexShrink={0} alignItems="flex-end">{text}</Box>
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
    <Text {...paraStyle(c, ctx, runs.map(r => r.s).join(''))}>
      {has(c, 'rp-qa-them') ? '“' : ''}
      {drawRuns(els, runs, ctx)}
      {has(c, 'rp-qa-them') ? '”' : ''}
    </Text>
  )
  if (QUOTE_CELL.test(c ?? '')) return quoteCell(els, c, text)
  // a bubble: ours green (blue for iMessage) with white words, theirs in an outline
  if (has(c, 'rp-bub-out')) return <Box backgroundColor={ctx.out === 'imessage' ? '#0a72e8' : '#248a3d'} borderStyle="round" borderColor={ctx.out === 'imessage' ? '#0a72e8' : '#248a3d'} paddingX={1}>{text}</Box>
  if (has(c, 'rp-bub-in')) return <Box borderStyle="round" borderColor="subtle" paddingX={1}>{text}</Box>
  // a quoted step or note: boxed like the other text that goes out
  if (has(c, 'rp-quote')) return <Box borderStyle="round" borderColor="subtle" paddingX={1}>{text}</Box>
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
    case 'page':
      // (0.7.33) true of both: `mm card` answers not ready for either, so the thread prints the page
      return 'This view does not match the stored drafts, so signing is off here. Go by the page printed in the thread.'
    case 'stale':
      return card.status === 'failed'
        ? `This card was drawn from package ${label || 'with no tag'}; the package is now ${now}, and it could not be drawn again here. Go by the page printed in the thread.`
        : `This card was drawn from package ${label || 'with no tag'}; the package is now ${now}. Drawing it again…`
    case 'not-own':
      return `Sign in ${card.client || 'the client'}'s own thread. This card is here to read.`
    case 'no-owner-check':
      return "Signatures can't be checked on this computer, so signing is off here. Go by the page printed in the thread."
    default:
      return ''
  }
}

/** What the box says when a press recorded nothing. */
/** (0.7.41) What the box says under its button: one press is the whole go. */
export const SIGN_CAPTION = (label: string): string => `One press signs and sends: "Send package ${label}" goes to your thread as your go, and it sends the package.`

const NOTICE = {
  changed: 'The package changed, so nothing was signed. Read it again, then sign.',
  retry: 'That did not go through, so nothing was signed. Try again, or ask your thread to print the page.',
  busy: 'Your thread started working while you signed, so nothing was sent. Sign again once it finishes.',
} as const

/**
 * (0.7.36) What the pane says in place of the box: while this thread is working, once it has stopped without checking this version, when
 * the prompt box holds other text, and when it cannot be read or filled; and the button that asks it to check.
 */
export const THREAD_CHECKING = 'This thread is still checking this package. The signature box opens when it finishes.'
export const THREAD_NOT_CHECKED = 'This thread has not checked this version of the package yet.'
export const CHECK_DRAFT = (label: string): string => `Your prompt box holds a draft, so type: Check package ${label}`
export const CHECK_TYPE = (label: string): string => `Type this in the thread: Check package ${label}`
export const CHECK_BUTTON = 'Check this package'

export type CardDraw = {
  card: MmCard
  marks: MmCardMarks
  /** (0.7.36) The versions this thread has finished checking (`checkedOf`). */
  checked: MmCardChecked
  /** (0.7.36) This thread is working (`busyOf`). */
  busy: boolean
  /** (0.7.36) The tag whose Check button could not put its words in the prompt box, and why (`checkMissOf`). */
  checkMiss: CardCheckMiss | null
  now: number
  onSign: (label: string) => void
  onCheck: (label: string) => void
  onAsk: (words: string) => void
  onPage: () => void
  /** (0.7.40) What the Changes field last said (`feedbackOf`); its line is drawn for that tag alone. */
  feedback?: MmCardFeedback | null
  /** (0.7.40) Enter in the Changes field, with the tag drawn and the words (`pressFeedback`). Left out, no field is drawn. */
  onFeedback?: (label: string, words: string) => void
  /**
   * (0.7.40) The surface this drawing is for (`e.surface`). The Changes field, and the caption that names it, are drawn on the desktop
   * alone: the engine completes every element table, so an `Input` in it says nothing of whether the surface draws one (mobile does not).
   */
  surface?: string
}

/**
 * The card, drawn: the renderer's tree with its signature box (or the reason there is none), and under it a button that
 * opens the page as text. Null when there is no card to draw yet; the pane then shows the page as before.
 */
export function drawCard(els: Els, d: CardDraw): Node {
  const { Box, Text, Button, Svg, Input } = els
  const { card, marks } = d
  const tree = card.tree
  if (!card.packageId) return null
  if (!tree) {
    if (card.status === 'failed') return <Text dimColor>{NOT_DRAWN}</Text>
    return <Text dimColor>Drawing the card…</Text>
  }
  const hold = holdOf(card)
  const notice = marks.notice?.packageId === card.packageId ? NOTICE[marks.notice.kind] : ''
  let n = 0
  const ctx: Ctx = { dark: false, out: null, parent: '', own: card.own, onAsk: d.onAsk, keyOf: () => `${card.packageId}:${n++}` }
  // (0.7.40) the Changes field, on every card of the thread's own client that can still change, whatever its box shows (a hold, the
  // thread at work: a submit waits until the thread is idle), with the line it last left for this tag alone. Drawn once, just above the
  // sign box, or at the card's end when the renderer drew none. Enter sends the words into the thread, never the go. ⛔ Nothing at all
  // while a signature for this tag stands (a go is armed) or once the package is closed, sent or approved (`canChange`).
  const fb = tree.label && d.feedback?.label === tree.label ? (FEEDBACK_SAID[d.feedback.said] ?? '') : ''
  const onFeedback = d.onFeedback
  // (0.7.40) the field itself on the desktop alone (`surface`), and never while a press is being checked (`isChecking`)
  const open = card.own && tree.label && canChange(tree) && !standing(marks, tree.label, card, d.now) && !isChecking(marks, tree.label, d.now)
  const fieldHere = d.surface === 'desktop' && Input && onFeedback ? { Input, onFeedback } : null
  const changes =
    open && (fb || fieldHere) ? (
      <Box key={`mm-card-changes:${tree.label}`} flexDirection="column">
        {fb ? <Text color={d.feedback?.said === 'sent' ? 'success' : 'warning'}>{fb}</Text> : null}
        {fieldHere ? <fieldHere.Input key={`mm-card-feedback:${tree.label}`} label={FEEDBACK_LABEL} placeholder={FEEDBACK_PLACEHOLDER} submitLabel={FEEDBACK_SUBMIT} rows={3} onSubmit={value => fieldHere.onFeedback(tree.label, value)} /> : null}
      </Box>
    ) : null
  // (0.7.40) the caption names the Changes box only where it is drawn above the box: on the desktop, with the field open
  const fieldDrawn = Boolean(open && fieldHere)
  let changesPlaced = false
  const withChanges = (label: string, node: Node): Node => {
    if (!changes || changesPlaced) return node
    changesPlaced = true
    return (
      <Box key={`mm-card-signarea:${label}`} flexDirection="column">
        {changes}
        {node}
      </Box>
    )
  }
  const sign = (s: { label: string; signer: string }): Node => withChanges(s.label, signArea(s))
  const signArea = (s: { label: string; signer: string }): Node => {
    // the send gate no longer takes a signature past SIGN_VALID_MS, or for another page, so the box asks for a new one and never says Sealed
    const signed = standing(marks, s.label, card, d.now)
    if (signed) {
      const still = d.now - signed.at > SIGN_ANIMATE_MS
      const said =
        signed.filled === 'sent'
          ? `Sealed and sent: your go for Package ${s.label} is in the thread, and it is sending the package now.`
          : signed.filled === 'filled'
            ? `Sealed, but the go did not reach your thread, so "Send package ${s.label}" is in your prompt box. Press Enter to send it.`
            : signed.filled === 'draft'
              ? `Sealed, but the go did not reach your thread and your prompt box holds a draft, so type: Send package ${s.label}`
              : signed.filled === 'stale'
                ? 'The package changed while signing, so nothing was sent. Read the new package and sign again.'
                : signed.filled === 'none'
                  ? `Sealed, but the go did not reach your thread. Type this in the thread: Send package ${s.label}`
                  : signed.filled === 'unsure'
                    ? `Sealed. If "Send package ${s.label}" does not show in your thread, type it there.`
                    : 'Signing…'
      return (
        <Box key={`mm-card-signed:${s.label}`} flexDirection="column">
          {Svg ? <Svg key={`mm-card-sig:${s.label}:${still ? 'still' : 'ink'}`} source={signatureSvg(signed.signer, still)} alt={`Signed by ${signed.signer}`} isInteractive /> : null}
          <Text size="caption" dimColor>{`Signed by ${signed.signer} · ${etTime(signed.at)} · Package ${s.label}`}</Text>
          <Text color={signed.filled === 'sent' ? 'success' : signed.filled === 'stale' || signed.filled === 'filled' || signed.filled === 'draft' || signed.filled === 'none' || signed.filled === 'unsure' ? 'warning' : undefined}>{said}</Text>
        </Box>
      )
    }
    if (hold) return (
      <Box key={`mm-card-hold:${s.label}`} flexDirection="column">
        {notice ? <Text color="warning">{notice}</Text> : null}
        <Text color={hold === 'drift' || hold === 'page' ? 'error' : undefined} dimColor={hold !== 'drift' && hold !== 'page'}>{holdText(hold, card, tree.label)}</Text>
      </Box>
    )
    // (0.7.36) the thread is working, or has not checked this version: the card stands in full, and the box waits
    if (d.busy || !isChecked(d.checked, s.label)) return (
      <Box key={`mm-card-wait:${s.label}`} flexDirection="column">
        {notice ? <Text color="warning">{notice}</Text> : null}
        <Text dimColor>{d.busy ? THREAD_CHECKING : THREAD_NOT_CHECKED}</Text>
        {d.checkMiss?.label === s.label ? <Text>{d.checkMiss.filled === 'draft' ? CHECK_DRAFT(s.label) : CHECK_TYPE(s.label)}</Text> : null}
        {Button ? <Button key={`mm-card-check:${s.label}`} label={CHECK_BUTTON} onPress={() => d.onCheck(s.label)} /> : <Text dimColor>{CHECK_BUTTON}</Text>}
      </Box>
    )
    if (isChecking(marks, s.label, d.now)) return <Text dimColor>Checking this is still the package…</Text>
    return (
      <Box key={`mm-card-sign:${s.label}`} flexDirection="column" borderStyle="round" borderColor="suggestion" paddingX={1}>
        {notice ? <Text color="warning">{notice}</Text> : null}
        {Button ? <Button key={`mm-card-sign-btn:${s.label}`} label="✍  Click to sign and send" variant="primary" onPress={() => d.onSign(s.label)} /> : <Text>{`Type in the thread: Send package ${s.label}`}</Text>}
        <Text size="caption" dimColor>{`${s.signer} · your signature is the go for exactly this package, ${s.label}`}</Text>
        <Text size="caption" dimColor>{fieldDrawn ? `${SIGN_CAPTION(s.label)} Changes go in the Changes box above or the chat box.` : `${SIGN_CAPTION(s.label)} Changes go in the chat box.`}</Text>
      </Box>
    )
  }
  const nodes = drawNodes(els, tree.nodes, ctx, sign)
  return (
    <Box key={`mm-card:${card.packageId}`} flexDirection="column">
      {hold === 'drift' || hold === 'page' ? <Text color="error">This view does not match the stored drafts, so signing is off here. Go by the page printed in the thread.</Text> : null}
      {hold === 'stale' && !signOf(tree) ? <Text dimColor>{holdText('stale', card, tree.label)}</Text> : null}
      {notice && !signOf(tree) ? <Text color="warning">{notice}</Text> : null}
      {nodes}
      {changesPlaced ? null : changes}
      {Button ? <Button key={`mm-card-page:${card.packageId}`} plain label={marks.pageOpen ? 'Hide the page as text  ▾' : 'Anything missing? Show the whole package as text  ▸'} onPress={() => d.onPage()} /> : null}
    </Box>
  )
}
