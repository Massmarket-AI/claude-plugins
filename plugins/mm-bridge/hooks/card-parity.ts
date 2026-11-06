/**
 * (0.7.30) Whether the card carries what the page prints (Rob, 2026-11-06: "the copy passes. I already think we should go
 * ahead and implement that for everybody."). The card replaces the printed pickup page only where this says so: a thread
 * whose `mm card` answers not ready prints the whole page, and the signature box stays closed. It is the answer to a line
 * only OW prints, and to anything added to the page later.
 *
 * The page is cut into content pieces: its lines, then its table cells, its ` · ` pairs and its mentions (the card draws a
 * mention as the person's name). Every piece must be in the text the card draws, as whole words, once both have lost their
 * case, punctuation and markdown marks. The card may hold more, never less. What is left out of the check is structure,
 * listed in STRUCTURAL, and a label the card draws as its own frame (LABEL). Pure: no `$`, no state, nothing logged.
 */
import type { MmCardNode, MmCardTree } from '../types'

/**
 * The lines of the page that carry nothing of the package: headings the card words as its own, the table's head and rule,
 * the labels above a step's words, and the closing line (the card prints the same words, and its go stands under them).
 * ⛔ A line goes here only if it is the same for every package; a line with the package's words in it never does.
 */
export const STRUCTURAL: readonly RegExp[] = [
  /^## .* · reply package · Package /,
  /^### (?:Every question answered\?|ETA or proof for every open ticket\?|Their message|Client reply|Suggestion: no reply needed|Team post|Added by the team|Follow-ups \(sent only if they have not replied\)|Proposed follow-ups|Other items|Links|Findings)$/,
  /^\| # \|/,
  /^\|?[-:| ]+\|?$/,
  /^-{3,}$/,
  /^(?:Note|Transcript):$/,
  /^_No client email in this package\._$/,
  /^One go .*Package `?[0-9a-f]{12}`?\.$/,
  /^Nothing is left to send\. Package `?[0-9a-f]{12}`?\.$/,
  /^Closed: no reply needed\.$/,
]

/** A label the card draws as its frame (the mail card's subject line, its hash chip): the value after it is the content. */
const LABEL = /^(?:\*\*[^*]+:\*\*|To:|Cc:|From:|Subject:|hash|Status:)\s*/
const MENTION = /<@!?\d{15,20}>/g
/** A body the page prints raw that the card draws as its reader sees it, by the tags render_pickup's HTML_HINT knows. */
const HTML_HINT = /<(?:p|br|div|a|ul|ol|li|table|span|b|strong|i|em|h[1-6])\b[^>]*>/i
const HIDDEN = /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const TAG = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi
const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decoded(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITY[name.toLowerCase()] ?? all
    const code = dec ? Number(dec) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
  })
}

/** Letters, digits and @ only, one space between: the page and the card may frame a line differently, never word it so. */
export function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@]+/gu, ' ')
    .trim()
}

/** The text the pane draws, each link's address beside its words. */
export function drawnText(nodes: readonly MmCardNode[]): string {
  const out: string[] = []
  const walk = (list: readonly MmCardNode[]) => {
    for (const n of list) {
      if (n.r) out.push(n.r.map(r => (r.href ? `${r.s} ${r.href} ` : r.s)).join(''))
      if (n.btn) out.push(n.btn)
      if (n.k) walk(n.k)
    }
  }
  walk(nodes)
  return out.join(' ')
}

/** A stored body between fences: an HTML one by the words between its tags (the card draws it rendered), any other by its lines. */
function bodyPieces(lines: readonly string[]): string[] {
  const body = lines.join('\n')
  if (!HTML_HINT.test(body)) return [...lines]
  return body
    .replace(HIDDEN, ' ')
    .split(TAG)
    .flatMap(bit => decoded(bit).split('\n'))
}

/** Every content piece of the page, in order. */
export function contentPieces(page: string): string[] {
  const out: string[] = []
  const add = (piece: string) => {
    for (const bit of piece.split(MENTION)) {
      const words = squash(bit)
      if (words && !/^\d+$/.test(words)) out.push(bit.trim())
    }
  }
  let fence = ''
  let body: string[] = []
  for (const raw of page.split('\n')) {
    const line = raw.trim().replace(/^(?:> ?)+/, '')
    if (fence) {
      if (line === fence) {
        bodyPieces(body).forEach(add)
        fence = ''
        body = []
      } else body.push(line)
      continue
    }
    const open = /^(`{3,})(?:text)?$/.exec(line)
    if (open) {
      fence = open[1] as string
      continue
    }
    if (!line || STRUCTURAL.some(p => p.test(line))) continue
    const bare = line.replace(/^- /, '')
    const cells = bare.startsWith('|') ? bare.replace(/^\||\|$/g, '').split('|') : [bare]
    for (const cell of cells) for (const part of cell.trim().split(' · ')) add(part.replace(LABEL, ''))
  }
  // a fence the page never closed: its lines still count
  bodyPieces(body).forEach(add)
  return out
}

/** Whether the package holds an inline image: the page's line, or the card's copy of it. No element of the side pane can draw one. */
export function holdsInlineImage(page: string, tree: MmCardTree): boolean {
  if (/^(?:> ?)*\*\*Inline image\*\*/m.test(page)) return true
  return /(?:^| )Inline image \[image: /.test(drawnText(tree.nodes))
}

/**
 * Why the card cannot stand in for this page, in words a thread can print after `card not ready: `, or '' when it can.
 * ⛔ The reason holds at most 60 characters of the page: it is never to go in a log.
 */
export function pageGap(page: string | null, tree: MmCardTree): string {
  if (!page) return 'the page could not be read to compare'
  if (holdsInlineImage(page, tree)) return 'the package holds an inline image the side pane cannot draw'
  const drawn = ` ${squash(drawnText(tree.nodes))} `
  for (const piece of contentPieces(page)) {
    if (!drawn.includes(` ${squash(piece)} `)) return `the page holds a line the card does not (${piece.replace(/\s+/g, ' ').slice(0, 60)})`
  }
  return ''
}
