import { describe, expect, test } from 'claude-code/testing'

import type { MmCardTree } from '../types'
import { readTree } from './card'
import { STRUCTURAL, contentPieces, drawnText, holdsInlineImage, pageGap, squash } from './card-parity'
import { SMS_PAGE, SMS_TREE } from './card-fixture.test-helper'

const realTree = (): MmCardTree => readTree(JSON.parse(JSON.stringify(SMS_TREE))) as MmCardTree
/** A tree drawing these paragraphs, the words a run each. */
const cardWith = (...words: string[]): MmCardTree => ({ ...realTree(), nodes: words.map(s => ({ r: [{ s }] })) })
const CLOSE = 'One go sends 1 item. Package `3f1c9a7e5b2d`.'

describe('0.7.30 the card against the page: every content line of the page is in what the card draws', () => {
  test('a real pair: the page render_pickup.py prints and the tree render_visual.py draws for one made-up package', () => {
    expect(contentPieces(SMS_PAGE).length).toBeGreaterThan(5)
    expect(pageGap(SMS_PAGE, realTree())).toBe('')
  })

  test('the structural allowlist: each line it holds, and nothing with a package\'s words in it', () => {
    const lines = [
      '## Example Dental · reply package · Package `3f1c9a7e5b2d`',
      '### Every question answered?',
      '### ETA or proof for every open ticket?',
      '### Their message',
      '### Client reply',
      '### Suggestion: no reply needed',
      '### Team post',
      '### Added by the team',
      '### Follow-ups (sent only if they have not replied)',
      '### Proposed follow-ups',
      '### Other items',
      '### Links',
      '### Findings',
      '| # | They asked | Our reply says | |',
      '|---|---|---|---|',
      '---',
      'Note:',
      'Transcript:',
      '_No client email in this package._',
      'One go sends 1 item. Package `3f1c9a7e5b2d`.',
      'One go sends all 3 items now and schedules 2 follow-ups. Package `0123456789ab`.',
      'One go closes this package: no reply needed. Package `abcdefabcdef`.',
      'Nothing is left to send. Package `abcdefabcdef`.',
      'Closed: no reply needed.',
    ]
    for (const line of lines) {
      expect(STRUCTURAL.some(p => p.test(line)), line).toBe(true)
      expect(contentPieces(line), line).toEqual([])
    }
    // the same frames holding anything else are content
    for (const line of ['### Their message to Dana', 'Note: call Dana back', 'Nothing is left to send but the invoice.', 'Closed: no reply needed, says Dana.', 'One go sends Dana the wrong price']) {
      expect(STRUCTURAL.some(p => p.test(line)), line).toBe(false)
      expect(contentPieces(line).length, line).toBeGreaterThan(0)
    }
  })

  test('the normalising: markdown marks, labels, table cells, ` · ` pairs and quote marks are the page\'s frame, not its words', () => {
    expect(squash('**To:** Dana_Example `x`  —  “Hello”')).toBe('to dana example x hello')
    expect(squash('Dana@Example.com')).toBe('dana@example com')
    expect(contentPieces('> **To:** dana@example.com · **Cc:** pat@example.com')).toEqual(['dana@example.com', 'pat@example.com'])
    expect(contentPieces('| 1 | Is it live? | Yes, it is | ✅ |')).toEqual(['Is it live?', 'Yes, it is'])
    expect(pageGap(`- **Subject:** Booking link\n\n${CLOSE}`, cardWith('Booking link'))).toBe('')
    expect(pageGap(`> \`\`\`text\n> Hi *Dana*\n> \`\`\`\n\n${CLOSE}`, cardWith('Hi Dana'))).toBe('')
  })

  test('a mention is split from the words around it: the card draws it as the person\'s name', () => {
    expect(contentPieces('Update from <@123456789012345678> for <@!987654321098765432>, please look')).toEqual(['Update from', 'for', ', please look'])
    expect(pageGap('Update from <@123456789012345678>, today', cardWith('Update from Dana, today'))).toBe('')
  })

  test('the words are whole: a word inside a longer one is not the word', () => {
    expect(pageGap('Cat', cardWith('concatenate'))).toBe('the page holds a line the card does not (Cat)')
    expect(pageGap('Cat', cardWith('the cat sat'))).toBe('')
  })

  test('a line the card lacks is named by its first 60 characters, on one line, and nothing later on the page', () => {
    const long = `Only OW prints this line ${'x'.repeat(100)}`
    expect(pageGap(`${long}\n\nAnother line the card lacks`, cardWith('something else'))).toBe(`the page holds a line the card does not (${long.slice(0, 60)})`)
  })

  test('a page that could not be read is not ready', () => {
    expect(pageGap(null, realTree())).toBe('the page could not be read to compare')
    expect(pageGap('', realTree())).toBe('the page could not be read to compare')
  })

  test('the card may hold more than the page, never less', () => {
    expect(pageGap(CLOSE, realTree())).toBe('')
  })

  test('a link\'s address on the page is found beside its words on the card', () => {
    const tree: MmCardTree = { ...realTree(), nodes: [{ r: [{ s: 'the plan', href: 'https://example.com/plan' }] }] }
    expect(drawnText(tree.nodes)).toContain('https://example.com/plan')
    expect(pageGap('https://example.com/plan', tree)).toBe('')
  })

  test('fences: a line inside is content, even one that reads as structure, and a longer fence holds a shorter one', () => {
    expect(contentPieces('```text\nClosed: no reply needed.\n```')).toEqual(['Closed: no reply needed.'])
    expect(contentPieces('````text\n```\nkept words\n```\n````')).toEqual(['```', 'kept words', '```'].filter(x => squash(x)))
    expect(pageGap('```text\n### Their message\nsomething\n```', cardWith('### Their message something'))).toBe('')
    expect(pageGap('```text\n### Their message\n```', cardWith('nothing like it'))).toBe('the page holds a line the card does not (### Their message)')
  })

  test('a stored HTML body: the page prints it raw, the card rendered. The same words pass; different words do not', () => {
    const html = (body: string) => `### Client reply\n\n\`\`\`text\n${body}\n\`\`\`\n\n${CLOSE}`
    const body = '<!doctype html><html><head><title>x</title><style>p{color:red}</style></head><body><!-- [if mso]><p>not shown</p><![endif] --><p>Hi Dana &amp; team,</p><p>The <a href="https://example.com/book">booking link</a> is&nbsp;live.</p><script>nope()</script></body></html>'
    expect(contentPieces(html(body))).toEqual(['Hi Dana & team,', 'The', 'booking link', 'is live.'])
    expect(pageGap(html(body), cardWith('Hi Dana & team,', 'The booking link (https://example.com/book) is live.'))).toBe('')
    expect(pageGap(html(body), cardWith('Hi Dana & team,', 'The booking link is broken.'))).toBe('the page holds a line the card does not (is live.)')
    // not HTML: angle brackets in plain words stay words
    expect(contentPieces('```text\nDana <dana@example.com> said 1 < 2\n```')).toEqual(['Dana <dana@example.com> said 1 < 2'])
  })

  test('a roster name on the page and an address on the card are not the same words: not ready', () => {
    expect(pageGap(`#### Pat Builder · Thu Nov 5, 10:02 AM ET\n\n${CLOSE}`, cardWith('pat@massmarket.ai · Thu Nov 5, 10:02 AM ET'))).toBe('the page holds a line the card does not (Pat Builder)')
  })

  test('a mail sender\'s address: the page prints it, so the card must', () => {
    const page = `#### Dana Example <dana@example.com> · Thu Nov 5, 10:02 AM ET · gmail\n\n${CLOSE}`
    expect(pageGap(page, cardWith('Dana Example', 'Thu Nov 5, 10:02 AM ET · gmail'))).toBe('the page holds a line the card does not (Dana Example <dana@example.com>)')
    expect(pageGap(page, cardWith('Dana Example <dana@example.com>', 'Thu Nov 5, 10:02 AM ET · gmail'))).toBe('')
  })

  test('(G10) the pane has no image element, so a card holding an inline image answers not ready, by the page or by the card', () => {
    const inlinePage = `**Inline image** dana.png\n\n${CLOSE}`
    expect(holdsInlineImage(inlinePage, cardWith('x'))).toBe(true)
    expect(pageGap(inlinePage, cardWith('Inline image dana.png'))).toBe('the package holds an inline image the side pane cannot draw')
    const carded = cardWith('Inline image [image: dana.png]')
    expect(holdsInlineImage(CLOSE, carded)).toBe(true)
    expect(pageGap(CLOSE, carded)).toBe('the package holds an inline image the side pane cannot draw')
    expect(holdsInlineImage(CLOSE, cardWith('the image is attached'))).toBe(false)
  })
})
