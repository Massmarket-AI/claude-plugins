/**
 * (0.7.33) Whether the card carries what the page prints (Rob, 2026-11-06: "the copy passes. I already think we should go
 * ahead and implement that for everybody."). The card replaces the printed pickup page only where this says so: a thread
 * whose `mm card` answers not ready prints the whole page, and the signature box stays closed. It is the answer to a line
 * only OW prints, and to anything added to the page later.
 *
 * The page is read as the sections and items it prints, and each is held against the same section or item of the card, never
 * against the card as a whole: a reply line found only in their quoted message, or a Cc address found only as someone's
 * sender, is missing.
 * - To, Cc, Bcc and the subject are exact sets and text on that item. Bcc is one way: the page never prints it.
 * - A body the go sends is whole: same words, same order, same count.
 * - A piece of three words or fewer matches only a whole line or ` · ` piece; a longer one matches as consecutive words.
 * - Normalising collapses whitespace and strips markdown marks. Signs, currency, digits, separators, dots and hyphens stay.
 * - Only what the pane draws counts: never an address behind a link's words, never a button.
 * - A state line (STATE_LINES) is checked both ways: the card may not say what the page does not.
 * The card may otherwise hold more than the page. Pure: no `$`, no state, nothing logged.
 */
import type { MmCardNode, MmCardRun, MmCardTree } from '../types'

/** The lines of the page that carry nothing of the package. ⛔ A line goes here only if it is the same for every package. */
export const STRUCTURAL: readonly RegExp[] = [/^\|?[-:| ]+\|?$/, /^-{3,}$/, /^(?:Note|Transcript):$/, /^_No client email in this package\._$/]

/** A state line says what the go will do or what has happened, and neither hash covers all of them: both sides must say the same. */
export const STATE_LINES: readonly RegExp[] = [
  /^Dry run: none of these steps/,
  /^Switched off: none of these steps/,
  /^Approved(?: by .*)?, /,
  /^One go /,
  /^Nothing is left to send\. Package /,
  /^Closed: no reply needed\.$/,
  /^Suggestion: no reply needed$/,
  /^Already sent /,
  /^Questions not extracted yet\.$/,
  /^The ticket check could not be read/,
  /^\d+ of \d+ .*not answered/,
  /^\d+ of \d+ open tickets have no/,
  /^Audio: /,
  /^Deferred, not carried/,
  /arrived after these drafts were written$/,
  /^Not shown: \d+ cancelled/,
]

const SHORT_WORDS = 3
const IMAGE_REASON = 'the package holds an image or other media the side pane cannot draw'
/**
 * What a body can hold that the card cannot show, and nothing here tries to draw it: a media element, an attribute that loads a
 * file (never a link's `?src=`), CSS that does, or a markdown image. The same pattern as IMAGE_RE in client-reply-prep's
 * render_visual.py, which counts them in the tree's `images`.
 */
const IMAGE =
  /<(?:img|picture|source|svg|image|video|audio|iframe|frame|object|embed|applet)\b[^>]*|(?<![?&\w-])(?:src|srcset|background|poster)\s*=|background-image|\burl\s*\(|!\[[^\]\n]*\]\([^)\n]*\)/i
const INLINE_IMAGE_LINE = /^(?:> ?)*\*\*Inline image\*\*/m
/** A leaf whose words are a body or a quote: never a state line, and never marked up. */
const BODY_CLASS = /\brp-(?:body|bub|turn-text|qa|whatsnew)\b/
const SEND_BODY = /\brp-(?:mail-body|bub-out|dc-body|pre|quote)\b/
const STEP_HEAD = /^\*\*\d+\. /
const SECTIONS: Record<string, string> = {
  'Every question answered?': 'Every question answered?',
  'ETA or proof for every open ticket?': 'ETA or proof for every open ticket?',
  'Their message': 'Their message',
  'Client reply': 'Our reply to the client',
  'Suggestion: no reply needed': 'Our reply to the client',
  'Tickets from the call: give each a due date or drop it': 'Tickets from the call: give each a due date or drop it',
  'Team post': 'Team post',
  'Added by the team': 'Added by the team',
  'Follow-ups (sent only if they have not replied)': 'Follow-ups, sent only if they have not replied',
  'Proposed follow-ups': 'Proposed follow-ups',
  'Other items': 'Other items',
  Links: 'Links',
  Findings: 'Findings',
  'What the quote says': 'What the quote says',
}
/** (0.7.43) The four cells of a quote row: never a state line of the card, as the page's row is never one (`stateGap`). */
const QUOTE_CELL = /\brp-quote-(?:no|line|hours|amt)\b/
/** (0.7.43) The header of each quote table on the page: the card draws none. */
const QUOTE_TABLE_HEAD = /^\|\s*#\s*\|\s*Line\s*\|\s*Hours\s*\|\s*Amount\s*\|$/
/** (0.7.43) A line that carries its check's mark: the mark is part of what it says, so it is held as written. */
const MARKED = /^(?:✅|⚠)/u

/** One space for any whitespace, and no edges. Nothing else about the words changes. */
export function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * (0.7.46) A line without markdown's inline marks and the page's status icons, its leading list or quote mark kept: what a quoted cell
 * of the page's tables holds of a line (`cellsOf` reads the quotes first, so `unmark` never reaches a mark inside them).
 */
function unmarkInline(line: string): string {
  return squash(line.replace(/\*\*/g, '').replace(/`/g, '').replace(/[✅⛔]|⚠️?/gu, ' '))
}

/** A line of the page, or of the card's frame, without markdown's marks and the page's status icons. */
function unmark(line: string): string {
  let s = unmarkInline(line)
  s = s.replace(/^(?:>\s?)*(?:#{1,6} |- )?/, '')
  if (s.length > 1 && s.startsWith('_') && s.endsWith('_')) s = s.slice(1, -1)
  return s.trim()
}

/** The Onboarding Wizard, live or a preview. The card never links there (Rob, 2026-11-06), so the page's address of it is left out. */
export function isOwUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().startsWith('onboarding-wizard')
  } catch {
    return true
  }
}

function withoutOw(line: string): string {
  return line.replace(/https?:\/\/\S+/g, url => (isOwUrl(url) ? '' : url)).replace(/[\s:]+$/, '')
}

// ---------------------------------------------------------------- the card

const isIcon = (r: MmCardRun) => /\brp-icon\b/.test(r.c ?? '')
/** A run as the check reads it: a mention by whose id it names, because the name on it comes from a roster. */
const runWords = (r: MmCardRun) => (r.m ? `<@${r.m}>` : r.s)

interface Leaf {
  c: string
  runs: readonly MmCardRun[]
  /** The words drawn, without icons; a body keeps its marks and its line breaks. */
  text: string
  isBody: boolean
}

function leafOf(n: MmCardNode): Leaf {
  const c = n.c ?? ''
  const runs = (n.r ?? []).filter(r => !isIcon(r))
  const isBody = BODY_CLASS.test(c)
  const words = runs.map(runWords).join('')
  return { c, runs, text: isBody ? words : unmark(words), isBody }
}

/** Every paragraph of these nodes, in order. A button to a message's real source is not one: the page has no such line. */
function leavesOf(nodes: readonly MmCardNode[]): Leaf[] {
  const out: Leaf[] = []
  for (const n of nodes) {
    if (/\brp-src\b/.test(n.c ?? '')) continue
    if (n.r) out.push(leafOf(n))
    if (n.k) out.push(...leavesOf(n.k))
  }
  return out
}

/** Every node with this class among these nodes or below them, not looking inside one it found. */
function findAll(nodes: readonly MmCardNode[], cls: string): MmCardNode[] {
  const re = new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`)
  const out: MmCardNode[] = []
  const walk = (list: readonly MmCardNode[]) => {
    for (const n of list) {
      if (re.test(n.c ?? '')) out.push(n)
      else if (n.k) walk(n.k)
    }
  }
  walk(nodes)
  return out
}

interface Hay {
  lines: Set<string>
  joined: string
}

function hayOf(leaves: readonly Leaf[]): Hay {
  const lines = new Set<string>()
  for (const leaf of leaves) {
    lines.add(squash(leaf.text))
    for (const line of leaf.text.split('\n')) {
      lines.add(squash(line))
      for (const seg of line.split(' · ')) lines.add(squash(seg))
    }
  }
  return { lines, joined: ` ${leaves.map(l => squash(l.text)).join(' ')} ` }
}

/** A short piece is a whole line or ` · ` piece; a longer one is consecutive words, cut at no word. */
function holds(hay: Hay, piece: string): boolean {
  if (!piece) return true
  return piece.split(' ').length <= SHORT_WORDS ? hay.lines.has(piece) : hay.joined.includes(` ${piece} `)
}

interface CardItem {
  title: string
  leaves: Leaf[]
}

interface Card {
  root: Leaf[]
  sections: Map<string, MmCardNode>
  items: CardItem[]
  /** Lines outside every body: what a state line is looked for in. */
  frame: Set<string>
}

/** (0.7.40) The renderer's closing line, its foot lines and its banners: where it says what the go will do or has done. */
const SETTLE_LEAF = /\brp-(?:closing|foot|banner)\b/

/**
 * (0.7.40) The card's closing, foot and banner lines (`rp-closing`, `rp-foot`, `rp-banner`), and nothing else: never a subject, a title,
 * a body, a quote or any other words a client or a teammate wrote, so that none of them reads as the card's state. `canChange` reads it.
 */
export function settleLines(tree: MmCardTree): string[] {
  return leavesOf(tree.nodes).filter(l => SETTLE_LEAF.test(l.c) && !l.isBody && !SEND_BODY.test(l.c)).map(l => squash(l.text))
}

function readCard(tree: MmCardTree): Card {
  const root: MmCardNode[] = []
  const sections = new Map<string, MmCardNode>()
  for (const n of tree.nodes) {
    if (/\brp-sec\b/.test(n.c ?? '')) {
      const head = (n.k ?? []).find(k => /\brp-h\b/.test(k.c ?? ''))
      if (head) sections.set(leafOf(head).text, n)
    } else root.push(n)
  }
  const items: CardItem[] = []
  for (const name of ['Our reply to the client', 'Team post', 'Other items']) {
    let open: CardItem | null = null
    for (const n of sections.get(name)?.k ?? []) {
      if (/\brp-dtitle\b/.test(n.c ?? '')) {
        const words = (n.r ?? []).filter(r => !/\brp-chip\b/.test(r.c ?? '') && !isIcon(r)).map(r => r.s).join('')
        open = { title: unmark(words), leaves: leavesOf([n]) }
        items.push(open)
      } else if (/\brp-item\b/.test(n.c ?? '')) {
        const leaves = leavesOf([n])
        items.push({ title: leaves.find(l => /\brp-from\b/.test(l.c))?.text ?? '', leaves })
        open = null
      } else if (open) open.leaves.push(...leavesOf([n]))
    }
  }
  const frame = new Set<string>()
  for (const leaf of leavesOf(tree.nodes)) if (!leaf.isBody && !QUOTE_CELL.test(leaf.c)) frame.add(squash(leaf.text))
  return { root: leavesOf(root), sections, items, frame }
}

/** The text the pane draws. Never a link's address behind its words, never a button: neither is on the screen as words. */
export function drawnText(nodes: readonly MmCardNode[]): string {
  const out: string[] = []
  const walk = (list: readonly MmCardNode[]) => {
    for (const n of list) {
      if (n.r) out.push(n.r.map(r => r.s).join(''))
      if (n.k) walk(n.k)
    }
  }
  walk(nodes)
  return out.join(' ')
}

// ---------------------------------------------------------------- the page

type Block = { kind: 'line'; text: string } | { kind: 'fence'; text: string } | { kind: 'blank' }

interface PageSection {
  head: string
  blocks: Block[]
}

function blocksOf(page: string): Block[] {
  const out: Block[] = []
  let fence = ''
  let quoted = false
  let body: string[] = []
  for (const raw of page.split('\n')) {
    if (fence) {
      const line = quoted ? raw.replace(/^> ?/, '') : raw
      if (line.trim() === fence) {
        out.push({ kind: 'fence', text: body.join('\n') })
        fence = ''
        body = []
      } else body.push(line)
      continue
    }
    const open = /^(>\s?)?(`{3,})(?:text)?\s*$/.exec(raw)
    if (open) {
      fence = open[2] as string
      quoted = Boolean(open[1])
      continue
    }
    out.push(raw.trim() ? { kind: 'line', text: raw } : { kind: 'blank' })
  }
  if (fence) out.push({ kind: 'fence', text: body.join('\n') }) // a fence the page never closed: its lines still count
  return out
}

/** The page by section: what stands before the first `###`, each section, then what follows Findings (its closing). */
function sectionsOf(blocks: readonly Block[]): PageSection[] {
  let now: PageSection = { head: '', blocks: [] }
  const out = [now]
  let hasWords = false
  for (const b of blocks) {
    if (b.kind === 'line' && /^### /.test(b.text)) {
      now = { head: b.text.slice(4).trim(), blocks: [] }
      out.push(now)
      hasWords = false
      continue
    }
    if (b.kind === 'blank' && now.head === 'Findings' && hasWords) {
      now = { head: '(closing)', blocks: [] }
      out.push(now)
      continue
    }
    if (b.kind !== 'blank') hasWords = true
    now.blocks.push(b)
  }
  return out
}

/** Every piece of the page the check holds against the card, in order. */
export function contentPieces(page: string): string[] {
  const out: string[] = []
  for (const b of blocksOf(page)) {
    if (b.kind === 'fence') out.push(squash(b.text))
    else if (b.kind === 'line' && !STRUCTURAL.some(p => p.test(b.text.trim()))) out.push(unmark(b.text))
  }
  return out.filter(Boolean)
}

const lineOf = (piece: string) => `the page holds a line the card does not (${piece.replace(/\s+/g, ' ').slice(0, 60)})`
const skip = (raw: string) => STRUCTURAL.some(p => p.test(raw.trim())) || !unmark(raw)

/** The missing piece of a line in this part of the card, or ''. */
function lineGap(hay: Hay, raw: string): string {
  const whole = unmark(raw)
  if (skip(raw) || holds(hay, whole)) return ''
  const missing = whole.split(' · ').find(part => !holds(hay, part.trim()))
  return missing === undefined ? '' : lineOf(missing)
}

function plainGap(hay: Hay, blocks: readonly Block[]): string {
  for (const b of blocks) {
    const gap = b.kind === 'line' ? lineGap(hay, b.text) : b.kind === 'fence' && !holds(hay, squash(b.text)) ? lineOf(squash(b.text)) : ''
    if (gap) return gap
  }
  return ''
}

// ---------------------------------------------------------------- a body as the card draws it

const ENTITY: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  copy: '©', reg: '®', trade: '™', bull: '•', middot: '·',
}
const HTML_TOKEN = /<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s>/]*)[^>]*>|<([a-zA-Z][^\s>/]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g
const PARAGRAPH = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'pre', 'hr'])
const LINE = new Set(['div', 'tr', 'section', 'article', 'header', 'footer'])
const HIDDEN = new Set(['style', 'script', 'head', 'title'])

function decoded(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITY[name.toLowerCase()] ?? all
    const code = dec ? Number(dec) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
  })
}

function attr(attrs: string, name: string): string {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
  return decoded(m?.[1] ?? m?.[2] ?? m?.[3] ?? '')
}

/** An HTML body as its reader sees it: the rules of PlainText in render_pickup.py, whose spacing the comparison then drops. */
function htmlWords(body: string): string {
  const parts: string[] = []
  const links: { href: string; start: number }[] = []
  let hidden = 0
  for (const m of body.matchAll(HTML_TOKEN)) {
    const end = m[1]?.toLowerCase()
    const start = m[2]?.toLowerCase()
    if (start) {
      if (HIDDEN.has(start)) hidden += 1
      else if (start === 'br') parts.push('\n')
      else if (start === 'li') parts.push('\n- ')
      else if (PARAGRAPH.has(start) || LINE.has(start)) parts.push('\n')
      else if (start === 'td' || start === 'th') parts.push(' ')
      else if (start === 'a') links.push({ href: attr(m[3] ?? '', 'href'), start: parts.length })
    } else if (end) {
      if (HIDDEN.has(end)) hidden = Math.max(0, hidden - 1)
      else if (end === 'a') {
        const link = links.pop()
        if (link) {
          const target = link.href.toLowerCase().startsWith('mailto:') ? link.href.slice(7) : link.href
          if (target && !target.startsWith('#') && !parts.slice(link.start).join('').includes(target)) parts.push(` (${target})`)
        }
      } else if (PARAGRAPH.has(end) || LINE.has(end)) parts.push('\n')
    } else if (!m[0].startsWith('<') || m[0] === '<') {
      if (!hidden) parts.push(decoded(m[0]))
    }
  }
  return squash(parts.join('').replace(/ /g, ' '))
}

/** What the card may draw for a body the page prints raw: as stored, its HTML read, its JSON indented, or a team post's marks read. */
function bodyForms(raw: string, node: Leaf): Set<string> {
  const forms = new Set([squash(raw)])
  if (/\brp-dc-body\b/.test(node.c)) forms.add(squash(raw.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/<@!/g, '<@')))
  else {
    forms.add(htmlWords(raw))
    try {
      forms.add(squash(JSON.stringify(JSON.parse(raw), null, 2)))
    } catch {
      /* not JSON: nothing to add */
    }
  }
  return forms
}

function bodyHeld(raw: string, leaves: readonly Leaf[]): boolean {
  return leaves.some(l => SEND_BODY.test(l.c) && bodyForms(raw, l).has(squash(l.text)))
}

// ---------------------------------------------------------------- each section

const asSet = (value: string) =>
  new Set(
    value
      .split(',')
      .map(squash)
      .filter(Boolean),
  )
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(x => b.has(x))
const firstOf = (leaves: readonly Leaf[], cls: RegExp) => leaves.find(l => cls.test(l.c))

/** The `rp-hdr` rows of a mail card, by their key. */
function rowsOf(leaves: readonly Leaf[]): Map<string, string> {
  const rows = new Map<string, string>()
  for (const l of leaves) {
    if (!/\brp-hdr\b/.test(l.c) || !l.runs[0]) continue
    rows.set(l.runs[0].s.trim(), squash(l.runs.slice(1).map(r => r.s).join('')))
  }
  return rows
}

const recipientGap = (key: string, value: string, rows: Map<string, string>): string =>
  sameSet(asSet(value), asSet(rows.get(key) ?? '')) ? '' : `the page's ${key} is not the card's (${value.slice(0, 40)})`

/** The ` · ` parts of a draft's marks line as the page wrote them: a value that holds ` · ` stays in one piece. */
function marksOf(raw: string): { pairs: [string, string][]; loose: string[] } {
  const pairs: [string, string][] = []
  const loose: string[] = []
  for (const part of raw.split(' · ')) {
    const pair = /^\*\*([^*]+):\*\*\s?(.*)$/.exec(part)
    const last = pairs[pairs.length - 1]
    if (pair) pairs.push([pair[1] as string, pair[2] as string])
    else if (/^hash `|needs Rob's OK$|^a record: nothing sends$/.test(part)) loose.push(part)
    else if (last) last[1] += ` · ${part}`
    else loose.push(part)
  }
  return { pairs, loose }
}

function chipsOf(leaves: readonly Leaf[]): Set<string> {
  const chips = new Set<string>()
  for (const l of leaves) for (const r of l.runs) if (/\brp-chip\b/.test(r.c ?? '')) chips.add(squash(r.s))
  return chips
}

function idsOf(text: string): Set<string> {
  return new Set([...text.matchAll(/<@!?(\d+)>/g)].map(m => m[1] as string))
}

function marksGap(raw: string, item: CardItem): string {
  const { pairs, loose } = marksOf(raw)
  const rows = rowsOf(item.leaves)
  const chips = chipsOf(item.leaves)
  const frame = hayOf(item.leaves.filter(l => !l.isBody))
  const chan = firstOf(item.leaves, /\brp-dc-chan\b/)?.text.split(' · ').map(squash)
  const meta = firstOf(item.leaves, /\brp-dc-meta\b/)?.text.split(' · ').map(squash)
  const whens = firstOf(item.leaves, /\brp-when\b/)?.text.split(' · ').map(squash)
  for (const [rawKey, rawValue] of pairs) {
    const key = squash(rawKey)
    const value = unmark(rawValue)
    if (rows.size && (key === 'To' || key === 'Cc' || key === 'Bcc')) {
      const gap = recipientGap(key, value, rows)
      if (gap) return gap
      continue
    }
    let held: boolean
    if (key === 'Subject' && firstOf(item.leaves, /\brp-mail-subj\b/)) {
      const subject = firstOf(item.leaves, /\brp-mail-subj\b/)?.runs.filter(r => /\brp-subj\b/.test(r.c ?? '')).map(r => r.s).join('') ?? ''
      held = unmark(subject) === value
    } else if (key === 'From' && firstOf(item.leaves, /\brp-from\b/)) held = firstOf(item.leaves, /\brp-from\b/)?.text === value
    else if (key === 'Channel' && chan) held = chan[0] === value
    else if (key === 'Channel' && whens) held = whens.includes(value)
    else if (key === 'In reply to' && chan) held = chan.includes(`reply to ${value}`)
    else if ((key === 'Must act' || key === 'FYI') && meta) {
      const drawn = meta.find(x => x.startsWith(`${key}: `))
      held = drawn !== undefined && sameSet(idsOf(rawValue), idsOf(drawn))
    } else if (key === 'Owners' && meta) held = meta.includes(`Owners: ${value}`)
    else if (key === 'Status') held = chips.has(value)
    else held = holds(frame, `${key}: ${value}`)
    if (!held) return lineOf(`${key}: ${value}`)
  }
  for (const part of loose) {
    const hash = /^hash `([^`]*)`$/.exec(part)
    if (hash?.[1] && !chips.has(hash[1])) return lineOf(part)
    if (!hash && !/needs Rob's OK$|^a record: nothing sends$/.test(part) && !holds(frame, unmark(part))) return lineOf(unmark(part))
  }
  // both ways: a chip that says what the go does, on the card and not on the page, is a gap too
  for (const chip of ["needs Rob's OK", 'a record: nothing sends']) {
    const onPage = loose.some(part => part.endsWith(chip))
    if (onPage !== chips.has(chip)) return lineOf(chip)
  }
  return ''
}

function itemGap(blocks: readonly Block[], item: CardItem): string {
  const frame = hayOf(item.leaves.filter(l => !l.isBody))
  for (const b of blocks) {
    if (b.kind === 'fence') {
      if (!bodyHeld(b.text, item.leaves)) return lineOf(squash(b.text))
    } else if (b.kind === 'line') {
      const gap = /(?:^| · )hash `/.test(b.text) ? marksGap(b.text, item) : lineGap(frame, b.text)
      if (gap) return gap
    }
  }
  return ''
}

/** The sections that hold drafts: what stands before the first `####` in that section of the card, each draft by its number and title. */
function draftsGap(section: PageSection, card: Card, used: Set<CardItem>): string {
  let i = 0
  const before: Block[] = []
  while (i < section.blocks.length) {
    const b = section.blocks[i] as Block
    if (b.kind === 'line' && /^#### /.test(b.text)) break
    before.push(b)
    i += 1
  }
  if (before.some(b => (b.kind === 'line' && !skip(b.text)) || b.kind === 'fence')) {
    const node = card.sections.get(SECTIONS[section.head] ?? '')
    if (!node) return `the page holds a section the card does not (${section.head.slice(0, 60)})`
    const gap = plainGap(hayOf(leavesOf([node])), before)
    if (gap) return gap
  }
  while (i < section.blocks.length) {
    const head = section.blocks[i] as Extract<Block, { kind: 'line' }>
    const blocks: Block[] = []
    i += 1
    while (i < section.blocks.length) {
      const b = section.blocks[i] as Block
      if (b.kind === 'line' && /^#### /.test(b.text)) break
      blocks.push(b)
      i += 1
    }
    const title = unmark(head.text)
    const item = card.items.find(x => x.title === title && !used.has(x))
    if (!item) return lineOf(title)
    used.add(item)
    const gap = itemGap(blocks, item)
    if (gap) return gap
  }
  return ''
}

function cellsOf(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map(cell => unmark(cell.replace(/\\\|/g, '|')))
}

const QUOTED = /^"(.*)"$/s

/** A table of the page against that section's rows, one to one in order; a cell is found inside its own row only. */
function rowsGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? `the page holds a section the card does not (${section.head.slice(0, 60)})` : ''
  const rows = findAll(node.k ?? [], 'rp-q')
  const lines = section.blocks.filter((b): b is Extract<Block, { kind: 'line' }> => b.kind === 'line')
  const table = lines.filter(b => /^\|/.test(b.text.trim()) && !STRUCTURAL.some(p => p.test(b.text.trim())) && !/^\| # \|/.test(b.text.trim()))
  if (table.length !== rows.length) return `the page holds ${table.length} rows in ${section.head.slice(0, 40)}, the card ${rows.length}`
  for (const [n, line] of table.entries()) {
    const leaves = leavesOf([rows[n] as MmCardNode])
    const joined = ` ${leaves.map(l => unmark(l.text)).join(' ')} `
    const them = firstOf(leaves, /\brp-qa-them\b/)
    const us = firstOf(leaves, /\brp-qa-us\b/)
    const title = firstOf(leaves, /\brp-qa\b/)
    const cells = cellsOf(line.text).slice(1)
    for (const [c, cell] of cells.entries()) {
      if (!cell || cell === '—') continue
      const bare = QUOTED.exec(cell)?.[1] ?? cell
      let held: boolean
      if (them && c === 0) held = unmark(them.text) === cell
      // (0.7.46) or the leaf with its own leading mark kept, as the quotes kept it (`unmarkInline`): a row quoting a bullet line of our
      // reply, `"- Setup by step…"`, against a leaf `unmark` read as `Setup by step…`, was a gap on every package that had one (NFE,
      // 2026-11-11). The mark is held, never dropped: `">2 weeks"` against a leaf `2 weeks` is still a gap.
      else if (us && c === 1) held = unmark(us.text) === bare || unmarkInline(us.text) === bare
      else if (!them && c === 0 && title) held = joined.includes(` ${cell} `) && cell.endsWith(unmark(title.text))
      else held = joined.includes(` ${cell} `) || joined.includes(` ${bare} `)
      if (!held) return lineOf(cell)
    }
  }
  const rest = section.blocks.filter(b => !(b.kind === 'line' && /^\|/.test(b.text.trim())))
  return plainGap(hayOf(leavesOf(node.k ?? [])), rest)
}

/** "Their message": every line and body inside this section; a message's To, Cc and subject against that message's own mail card. */
function theirGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? 'the page holds a section the card does not (Their message)' : ''
  const hay = hayOf(leavesOf(node.k ?? []))
  const mails = findAll(node.k ?? [], 'rp-mail').map(m => leavesOf([m]))
  let who: string[] = []
  for (const b of section.blocks) {
    if (b.kind === 'fence') {
      if (!holds(hay, squash(b.text))) return lineOf(squash(b.text))
      continue
    }
    if (b.kind !== 'line') continue
    if (/^#### /.test(b.text)) who = unmark(b.text).split(' · ').map(squash)
    if (!/^(?:To|Cc|Subject): /.test(b.text.trim())) {
      const gap = lineGap(hay, b.text)
      if (gap) return gap
      continue
    }
    const mail = mails.find(leaves => firstOf(leaves, /\brp-from\b/)?.text === who[0] && (firstOf(leaves, /\brp-when\b/)?.text ?? '').startsWith(who[1] ?? '\0'))
    if (!mail) {
      if (!hay.lines.has(unmark(b.text))) return lineOf(unmark(b.text))
      continue
    }
    const rows = rowsOf(mail)
    const pairs = b.text.trim().split(/ · (?=(?:To|Cc|Subject): )/)
    for (const pair of pairs) {
      const at = pair.indexOf(': ')
      const key = pair.slice(0, at)
      const value = unmark(pair.slice(at + 2))
      if (key === 'Subject') {
        const subject = firstOf(mail, /\brp-mail-subj\b/)?.runs.filter(r => /\brp-subj\b/.test(r.c ?? '')).map(r => r.s).join('') ?? ''
        if (unmark(subject) !== value) return lineOf(`Subject: ${value}`)
      } else {
        const gap = recipientGap(key, value, rows)
        if (gap) return gap
      }
    }
  }
  return ''
}

/** The steps of the follow-ups, one to one in order: each line of a step is a whole line of that step on the card, and its body its body. */
function followupsGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? `the page holds a section the card does not (${section.head.slice(0, 60)})` : ''
  const steps = findAll(node.k ?? [], 'rp-tl').flatMap(tl => findAll(tl.k ?? [], 'rp-li'))
  const outside = (node.k ?? []).filter(n => !/\brp-tl\b/.test(n.c ?? ''))
  const hay = hayOf(leavesOf(outside))
  let n = -1
  let inStep = false
  let leaves: Leaf[] = []
  let frame = new Set<string>()
  for (const b of section.blocks) {
    if (b.kind === 'blank') {
      inStep = false
      continue
    }
    if (b.kind === 'line' && STEP_HEAD.test(b.text)) {
      n += 1
      const step = steps[n]
      if (!step) return lineOf(unmark(b.text))
      leaves = leavesOf([step])
      frame = new Set(leaves.filter(l => !l.isBody).map(l => squash(l.text)))
      inStep = true
    }
    if (!inStep) {
      const gap = b.kind === 'line' ? lineGap(hay, b.text) : lineOf(squash(b.text))
      if (gap) return gap
    } else if (b.kind === 'fence') {
      if (!bodyHeld(b.text, leaves)) return lineOf(squash(b.text))
    } else if (b.kind === 'line' && !skip(b.text) && !frame.has(unmark(b.text))) return lineOf(unmark(b.text))
  }
  return n + 1 === steps.length ? '' : `the page holds ${n + 1} follow-up steps, the card ${steps.length}`
}

/** Links in order and count: each line of the page is the whole line on the card, its address drawn. */
function linksGap(section: PageSection, node: MmCardNode | undefined): string {
  const lines = section.blocks
    .filter((b): b is Extract<Block, { kind: 'line' }> => b.kind === 'line' && /^- /.test(b.text.trim()))
    .map(b => withoutOw(unmark(b.text)))
    .filter(Boolean)
  const drawn = findAll(node?.k ?? [], 'rp-li').map(n => leafOf(n).text)
  const missing = lines.find((line, i) => drawn[i] !== line)
  if (missing !== undefined) return lineOf(missing)
  if (lines.length !== drawn.length) return `the page holds ${lines.length} links, the card ${drawn.length}`
  const rest = section.blocks.filter(b => !(b.kind === 'line' && /^- /.test(b.text.trim())))
  return plainGap(hayOf(leavesOf(node?.k ?? [])), rest)
}

/** Findings in order and count: what it is, and what we recommend, each on its own line of its own finding. */
function findingsGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? 'the page holds a section the card does not (Findings)' : ''
  const finds = findAll(node.k ?? [], 'rp-find').map(n => leavesOf([n]))
  const lines = section.blocks.filter((b): b is Extract<Block, { kind: 'line' }> => b.kind === 'line' && /^- /.test(b.text.trim()))
  if (lines.length !== finds.length) return `the page holds ${lines.length} findings, the card ${finds.length}`
  for (const [n, line] of lines.entries()) {
    const leaves = finds[n] as Leaf[]
    const text = unmark(line.text)
    // the first one, where the renderer cuts it: a recommendation may open with the word itself
    const at = text.indexOf(' Recommend: ')
    const what = at < 0 ? text : text.slice(0, at)
    if (squash(firstOf(leaves, /\brp-find-what\b/)?.text ?? '') !== what) return lineOf(what)
    if (at >= 0 && firstOf(leaves, /\brp-rec\b/)?.text !== `Recommend ${text.slice(at + 12)}`) return lineOf(text.slice(at + 1))
  }
  const rest = section.blocks.filter(b => !(b.kind === 'line' && /^- /.test(b.text.trim())))
  return plainGap(hayOf(leavesOf(node.k ?? [])), rest)
}

/**
 * "Added by the team" is never sent. Each addition, one to one in order: its time and its words, whole. Never its name: OW's page
 * prints the roster's name, and the card, which cannot read the roster, the address (render_pickup.py contributor_name).
 */
function contributionsGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? 'the page holds a section the card does not (Added by the team)' : ''
  const bys = findAll(node.k ?? [], 'rp-noteby').map(leafOf)
  const words = findAll(node.k ?? [], 'rp-quote').map(leafOf)
  const timeOf = (line: string) => line.slice(line.lastIndexOf(' · ') + 3)
  const hay = hayOf(leavesOf(node.k ?? []))
  let n = -1
  for (const b of section.blocks) {
    if (b.kind === 'line' && /^#### /.test(b.text)) {
      n += 1
      const time = timeOf(unmark(b.text))
      if (timeOf(bys[n]?.text ?? '') !== time) return lineOf(time)
    } else if (b.kind === 'fence') {
      if (squash(words[n]?.text ?? '') !== squash(b.text)) return lineOf(squash(b.text))
    } else if (b.kind === 'line') {
      const gap = lineGap(hay, b.text)
      if (gap) return gap
    }
  }
  return n + 1 === bys.length ? '' : `the page holds ${n + 1} additions by the team, the card ${bys.length}`
}

/**
 * (0.7.43) "What the quote says" (Rob, 2026-11-09: "we need some sort of render of the invoice, the line items, and the hours
 * quoted"). Its blocks one to one in order with the card's `rp-quote` boxes, each by its `####` head. Each plain line of a block is a
 * whole line of that block's box, a ✅ or ⚠️ line with its mark; each table row one to one in order with the box's `rp-quote-row`s,
 * its four cells each equal to the leaf the card draws for it. The counts of blocks and of rows are equal.
 */
function quotesGap(section: PageSection, node: MmCardNode | undefined): string {
  if (!node) return section.blocks.some(b => b.kind !== 'blank') ? 'the page holds a section the card does not (What the quote says)' : ''
  const boxes = findAll(node.k ?? [], 'rp-quote')
  const outside = hayOf(leavesOf((node.k ?? []).filter(n => !/(?:^|\s)rp-quote(?:\s|$)/.test(n.c ?? ''))))
  let n = -1
  let rows: MmCardNode[] = []
  let row = 0
  let frame = new Set<string>()
  let marked = new Set<string>()
  const done = (): string => (n >= 0 && row !== rows.length ? `the page holds ${row} rows in quote block ${n + 1}, the card ${rows.length}` : '')
  for (const b of section.blocks) {
    if (b.kind === 'blank') continue
    if (b.kind === 'fence') return lineOf(squash(b.text))
    const raw = b.text.trim()
    if (/^#### /.test(raw)) {
      const gap = done()
      if (gap) return gap
      n += 1
      const box = boxes[n]
      const head = unmark(raw.slice(5))
      if (!box) return lineOf(head)
      const leaves = leavesOf((box.k ?? []).filter(k => !/\brp-quote-row\b/.test(k.c ?? '')))
      if (firstOf(leaves, /\brp-quote-head\b/)?.text !== head) return lineOf(head)
      rows = findAll(box.k ?? [], 'rp-quote-row')
      row = 0
      frame = new Set(leaves.map(l => squash(l.text)))
      marked = new Set(leaves.map(l => squash(l.runs.map(runWords).join(''))))
      continue
    }
    if (STRUCTURAL.some(p => p.test(raw)) || QUOTE_TABLE_HEAD.test(raw)) continue
    if (n < 0) {
      const gap = lineGap(outside, b.text)
      if (gap) return gap
      continue
    }
    if (/^\|/.test(raw)) {
      const cells = cellsOf(raw)
      const drawn = rows[row]
      row += 1
      if (!drawn) return `the page holds more rows in quote block ${n + 1} than the card (${unmark(cells[1] ?? '').slice(0, 40)})`
      const leaves = leavesOf([drawn])
      const want = ['rp-quote-no', 'rp-quote-line', 'rp-quote-hours', 'rp-quote-amt'].map(cls => firstOf(leaves, new RegExp(`\\b${cls}\\b`))?.text)
      if (cells.length !== want.length) return lineOf(unmark(raw))
      const at = cells.findIndex((cell, i) => cell !== want[i])
      if (at >= 0) return lineOf(cells[at] as string)
      continue
    }
    if (MARKED.test(raw) ? !marked.has(squash(raw)) : !frame.has(unmark(raw))) return lineOf(unmark(raw))
  }
  const gap = done()
  if (gap) return gap
  return n + 1 === boxes.length ? '' : `the page holds ${n + 1} quote blocks, the card ${boxes.length}`
}

/** A state line on one side and not the other. */
function stateGap(page: readonly Block[], card: Card): string {
  const lines = new Set<string>()
  for (const b of page) if (b.kind === 'line') lines.add(unmark(b.text))
  for (const state of STATE_LINES) {
    const onPage = [...lines].filter(x => state.test(x))
    const onCard = [...card.frame].filter(x => state.test(x))
    const missing = onPage.find(x => !card.frame.has(x))
    if (missing !== undefined) return lineOf(missing)
    const extra = onCard.find(x => !lines.has(x))
    if (extra !== undefined) return `the card says what the page does not (${extra.slice(0, 60)})`
  }
  return ''
}

/** Whether a body holds an image or other media (IMAGE), as written or with its entities read, the page's inline image line, or the renderer's flag. */
export function holdsImage(page: string, tree: MmCardTree): boolean {
  if ((tree.images ?? 0) > 0 || INLINE_IMAGE_LINE.test(page)) return true
  if (blocksOf(page).some(b => b.kind === 'fence' && (IMAGE.test(b.text) || IMAGE.test(decoded(b.text))))) return true
  return /(?:^| )Inline image \[image: /.test(drawnText(tree.nodes))
}

/**
 * Why the card cannot stand in for this page, in words a thread can print after `card not ready: `, or '' when it can.
 * ⛔ The reason holds at most 60 characters of the page: it is never to go in a log.
 */
export function pageGap(page: string | null, tree: MmCardTree): string {
  if (!page) return 'the page could not be read to compare'
  if (holdsImage(page, tree)) return IMAGE_REASON
  const blocks = blocksOf(page)
  const card = readCard(tree)
  const state = stateGap(blocks, card)
  if (state) return state
  const used = new Set<CardItem>()
  for (const section of sectionsOf(blocks)) {
    const node = card.sections.get(SECTIONS[section.head] ?? '')
    let gap = ''
    if (section.head === '' || section.head === '(closing)') {
      const top = section.blocks.filter(b => !(b.kind === 'line' && /^## /.test(b.text)))
      const heading = section.blocks.find((b): b is Extract<Block, { kind: 'line' }> => b.kind === 'line' && /^## /.test(b.text))
      if (heading) {
        const m = /^## (.*) · reply package · Package `([^`]*)`$/.exec(heading.text.trim())
        if (!m) gap = lineOf(unmark(heading.text))
        else if (m[2] !== tree.label) gap = `the page's package hash is not the card's (${(m[2] as string).slice(0, 12)})`
        else if (firstOf(card.root, /\brp-title\b/)?.text !== unmark(m[1] as string)) gap = lineOf(unmark(m[1] as string))
      }
      gap ||= plainGap(hayOf(card.root), top)
    } else if (section.head === 'Every question answered?' || section.head === 'ETA or proof for every open ticket?') gap = rowsGap(section, node)
    else if (section.head === 'Their message') gap = theirGap(section, node)
    else if (section.head === 'Client reply' || section.head === 'Suggestion: no reply needed' || section.head === 'Team post' || section.head === 'Other items')
      gap = draftsGap(section, card, used)
    else if (section.head === 'Added by the team') gap = contributionsGap(section, node)
    else if (section.head === 'Links') gap = linksGap(section, node)
    else if (section.head === 'Findings') gap = findingsGap(section, node)
    else if (section.head === 'What the quote says') gap = quotesGap(section, node)
    else if (section.head.startsWith('Follow-ups') || section.head === 'Proposed follow-ups') gap = followupsGap(section, node)
    else if (!(section.head in SECTIONS) || !node) {
      if (section.blocks.some(b => b.kind !== 'blank')) gap = `the page holds a section the card does not (${section.head.slice(0, 60)})`
    } else gap = plainGap(hayOf(leavesOf(node.k ?? [])), section.blocks)
    if (gap) return gap
  }
  return ''
}
