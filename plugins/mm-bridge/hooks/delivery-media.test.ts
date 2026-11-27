// (0.7.88) What a delivery gives the client, on the card (Rob, 2026-11-27: "delivery packages should render like reply
// packages"; "if we can play video in thread on reply package thats best as well"): each QA video, walkthrough and
// document the delivery check lists, its poster frame or first page as a Markdown picture that opens it, its labelled link,
// and a Google Doc's text behind a button. No video plays in the card: the desktop has no video or frame element and
// claude.ai refuses outside media and frames (measured 2026-11-27; client-reply-prep's delivery_media.py has the evidence).
import { describe, expect, test } from 'claude-code/testing'

import type { MmCard, MmCardMarks, MmCardTree } from '../types'
import { DOC_HIDE, DOC_OPEN, MEDIA_TEXT_MAX, copyCheck, drawCard, marksOf, mediaLine, readMedia, readTree, toggleDoc, type CardDraw } from './card'
import { pageGap } from './card-parity'
import { DELIVERY_PAIRS } from './delivery-pairs.test-helper'

const MEDIA_PAIR = 'delivery check with videos and a doc'
const LOOM = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'
const DOC = 'https://docs.google.com/document/d/1ZZ_media_doc_id_000000000/edit'

const treeOf = (name: string): MmCardTree => readTree(JSON.parse(JSON.stringify(DELIVERY_PAIRS[name]?.tree))) as MmCardTree

type El = { type?: unknown; props?: Record<string, unknown> & { children?: unknown }; children?: unknown }

/** Every element of a drawing, depth first (the fake elements are plain data, children nested). */
function walk(node: unknown, out: El[] = []): El[] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out)
    return out
  }
  const o = node as El
  out.push(o)
  walk(o.props?.children, out)
  walk(o.children, out)
  return out
}

const ELS = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg', Markdown: 'Markdown' } as never
const ELS_NO_MARKDOWN = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg' } as never

function draw(marks: MmCardMarks = { signed: {} }, over: Partial<CardDraw> = {}, els: never = ELS) {
  const tree = treeOf(MEDIA_PAIR)
  const card: MmCard = { packageId: tree.package_id ?? '', projectId: tree.project_id, client: 'Example Dental', own: true, current: tree.package_sha256, tree, status: 'ready', at: 0 } as MmCard
  const docs: string[] = []
  const drawn = drawCard(els, {
    card, marks, checked: { [tree.label]: 0 }, busy: false, checkMiss: null, now: 1_000_000,
    onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, onDoc: href => docs.push(href), ...over,
  })
  return { all: walk(drawn), docs }
}

const of = (all: El[], type: string) => all.filter(e => e.type === type)
/** The words of every Text in a drawing, each Text's strings joined. */
const words = (all: El[]): string[] => of(all, 'Text').map(t => strings(t.props?.children ?? t.children).join(''))
function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap(strings)
  if (node && typeof node === 'object') return strings((node as El).props?.children ?? (node as El).children)
  return []
}
const button = (all: El[], label: string) => of(all, 'Button').find(b => b.props?.label === label)

describe('0.7.88 delivery media: what the renderer hands over is read, and nothing else', () => {
  test('a well-formed entry reads as written', () => {
    const m = readMedia({ item: 'qa_video', label: 'QA video', media: 'video', provider: 'Loom', title: 'ZZ', length: '5:54', url: LOOM, poster: 'https://cdn.example/zz.jpg' })
    expect(m).toEqual({ item: 'qa_video', label: 'QA video', media: 'video', provider: 'Loom', title: 'ZZ', length: '5:54', url: LOOM, poster: 'https://cdn.example/zz.jpg' })
    expect(mediaLine(m as never)).toBe('Loom · ZZ · 5:54')
  })

  test('an unknown item or kind, no label, or not an object is no media', () => {
    for (const bad of [null, 5, 'x', [], {}, { item: 'zz', label: 'X', media: 'video' }, { item: 'qa_video', label: 'X', media: 'audio' }, { item: 'qa_video', label: ' ', media: 'video' }])
      expect(readMedia(bad)).toBeNull()
  })

  test('only an https link the card can draw safely: never http, a script, a bracket that breaks Markdown, or the Onboarding Wizard', () => {
    const base = { item: 'walkthrough', label: 'Walkthrough', media: 'video' }
    for (const url of ['http://zz.example/v', 'javascript:alert(1)', 'https://zz.example/a)(b', 'https://zz.example/a b', 'https://zz.example/[x]', 'https://onboarding-wizard.massmarket.ai/qa-videos/zz.mp4'])
      expect(readMedia({ ...base, url, poster: 'https://cdn.example/p.jpg' })).toEqual({ item: 'walkthrough', label: 'Walkthrough', media: 'video' })
    // a poster without a link it would open is left off
    expect(readMedia({ ...base, poster: 'https://cdn.example/p.jpg' })).toEqual(base)
  })

  test("a document's text only on a document, with no control character but a newline or tab, at most MEDIA_TEXT_MAX", () => {
    const doc = { item: 'documentation', label: 'Documentation', media: 'doc', url: DOC }
    expect(readMedia({ ...doc, text: 'A\u000bB\r\nC\u0007\tD E' })?.text).toBe('A\nB\nC\tD\nE')
    expect(readMedia({ ...doc, text: 'x'.repeat(MEDIA_TEXT_MAX + 50) })?.text?.length).toBe(MEDIA_TEXT_MAX)
    expect(readMedia({ ...doc, text: '   ' })?.text).toBeUndefined()
    expect(readMedia({ ...doc, media: 'video', text: 'ZZ' })?.text).toBeUndefined()
    expect(readMedia({ ...doc, title: 'ZZ\u0000 title\n2' })?.title).toBe('ZZ title 2')
  })

  test('media the card cannot read leaves the paragraph and the rest of the tree as they were', () => {
    const tree = readTree({ ...(DELIVERY_PAIRS[MEDIA_PAIR]?.tree as object), nodes: [{ c: 'rp-media', r: [{ s: 'Loom', href: LOOM }], media: { item: 'zz' } }] })
    expect(tree?.nodes[0]).toEqual({ c: 'rp-media', r: [{ s: 'Loom', href: LOOM }] })
  })
})

describe('0.7.88 delivery media: the card draws each link of what the client gets', () => {
  test('the pairs hold the page, the media ride outside it, and the copy check still passes', () => {
    expect(Object.keys(DELIVERY_PAIRS).length).toBe(7)
    for (const name of Object.keys(DELIVERY_PAIRS)) {
      const tree = treeOf(name)
      expect(pageGap(DELIVERY_PAIRS[name]?.page ?? '', tree)).toBe('')
      expect(copyCheck(tree)).toBe(true)
    }
    const media = treeOf(MEDIA_PAIR).nodes.flatMap(function all(n): typeof n[] { return [n, ...(n.k ?? []).flatMap(all)] }).filter(n => n.media)
    expect(media.map(n => n.media?.item)).toEqual(['qa_video', 'walkthrough', 'documentation'])
  })

  test("the check row's JSON is not on the page or the card once its section prints", () => {
    for (const name of ['delivery check ok, its row among the drafts', MEDIA_PAIR]) {
      expect(DELIVERY_PAIRS[name]?.page).toContain('### Delivery check')
      expect(DELIVERY_PAIRS[name]?.page).not.toContain('mm.delivery_check.v1')
      expect(JSON.stringify(DELIVERY_PAIRS[name]?.tree)).not.toContain('mm.delivery_check.v1')
    }
  })

  test('a poster frame or first page is a Markdown picture that opens the link, then the labelled link', () => {
    const { all } = draw()
    const pictures = of(all, 'Markdown').map(m => m.props?.text)
    expect(pictures).toEqual([
      `[![QA video poster frame: Loom · ZZ_qa_video · 5:54](https://zz.example/poster/qa_video.jpg)](${LOOM})`,
      '[![Walkthrough poster frame: YouTube · ZZ_walkthrough](https://zz.example/poster/walkthrough.jpg)](https://youtu.be/AbCdEfGhIjK)',
      `[![Documentation first page: Google Doc · ZZ_documentation](https://zz.example/poster/documentation.jpg)](${DOC})`,
    ])
    const links = of(all, 'Link').map(l => [l.props?.label, l.props?.href])
    expect(links).toContainEqual(['Loom · ZZ_qa_video · 5:54', LOOM])
    expect(links).toContainEqual(['Google Doc · ZZ_documentation', DOC])
  })

  test("a surface with no Markdown keeps the labelled links, and an older bridge's reading of the tree draws them alone", () => {
    const { all } = draw({ signed: {} }, {}, ELS_NO_MARKDOWN)
    expect(of(all, 'Markdown')).toEqual([])
    expect(of(all, 'Link').map(l => l.props?.label)).toContain('Loom · ZZ_qa_video · 5:54')
  })

  test("a Google Doc's text opens on the card at a press, one document at a time", () => {
    const shut = draw()
    expect(words(shut.all).some(w => w.includes('ZZ_doc_first_line'))).toBe(false)
    const open = button(shut.all, DOC_OPEN)
    expect(open).toBeTruthy()
    const press = ((open as { onPress?: unknown } | undefined)?.onPress ?? open?.props?.onPress) as () => void
    press()
    expect(shut.docs).toEqual([DOC])
    const shown = draw({ signed: {}, docOpen: DOC })
    expect(button(shown.all, DOC_HIDE)).toBeTruthy()
    expect(words(shown.all)).toContain('ZZ_doc_first_line\nZZ_doc_second_line')
    // no button where the thread gave no handler (a drawing with nothing to press)
    expect(button(draw({ signed: {} }, { onDoc: undefined }).all, DOC_OPEN)).toBeUndefined()
  })

  test('the open document is a mark of the thread: a second press closes it, another document replaces it', async () => {
    const values = new Map<string, unknown>()
    const $ = { state: { get: async (ref: { key: string }) => ({ value: values.get(ref.key) }), set: async (ref: { key: string }, v: unknown) => { values.set(ref.key, v) } } } as never
    await toggleDoc($, DOC)
    expect((await marksOf($)).docOpen).toBe(DOC)
    await toggleDoc($, LOOM)
    expect((await marksOf($)).docOpen).toBe(LOOM)
    await toggleDoc($, LOOM)
    expect((await marksOf($)).docOpen).toBeUndefined()
    expect((await marksOf($)).signed).toEqual({})
  })
})
