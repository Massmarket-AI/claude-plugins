import { describe, expect, test } from 'claude-code/testing'

import type { MmCardNode, MmCardRun, MmCardTree } from '../types'
import { readTree } from './card'
import { STRUCTURAL, contentPieces, drawnText, holdsImage, pageGap, squash } from './card-parity'
import { SMS_PAGE, SMS_TREE } from './card-fixture.test-helper'
import { CARD_PAIRS } from './card-pairs.test-helper'

const realTree = (): MmCardTree => readTree(JSON.parse(JSON.stringify(SMS_TREE))) as MmCardTree
const para = (s: string | MmCardRun[], c?: string): MmCardNode => ({ ...(c ? { c } : {}), r: typeof s === 'string' ? [{ s }] : s })
/** A tree drawing these paragraphs, the words a run each, in no section. */
const cardWith = (...words: Array<string | MmCardRun[]>): MmCardTree => ({ ...realTree(), nodes: words.map(w => para(w)) })
/** A section of the card, as the renderer heads it. */
const sec = (head: string, ...k: MmCardNode[]): MmCardNode => ({ c: 'rp-sec', k: [para(head, 'rp-h'), ...k] })
const cardOf = (...nodes: MmCardNode[]): MmCardTree => ({ ...realTree(), nodes })
const fence = (body: string) => `\`\`\`text\n${body}\n\`\`\``
const MISSING = (piece: string) => `the page holds a line the card does not (${piece.slice(0, 60)})`
const pair = (name: string) => {
  const p = CARD_PAIRS[name]
  if (!p) throw new Error(`no pair ${name}`)
  return { page: p.page, tree: readTree(JSON.parse(JSON.stringify(p.tree))) as MmCardTree }
}

describe('0.7.33 the card against the page: real pairs, from the two renderers themselves', () => {
  test('a text message package', () => {
    expect(contentPieces(SMS_PAGE).length).toBeGreaterThan(5)
    expect(pageGap(SMS_PAGE, realTree())).toBe('')
  })

  for (const name of ['everything', 'source links', "rob's mail, plan not approved", "rob's mail, plan approved", 'html email', 'no reply', 'closed no reply', 'later messages', 'ticket check unreadable', 'follow-ups live', 'follow-ups switched off', 'tickets from the call', 'tickets from the call, all decided', 'tickets from the call, unread', 'tickets from the call, ticket check off', 'ticket gap under enforce, a teammate', "ticket gap under enforce, rob's machine", 'quotes', 'quotes, revised', 'date moves', 'date moves, ticket check off', 'answered', 'every ticket answered', 'quotes, columns']) {
    test(`${name}: the page and the card agree`, () => {
      const { page, tree } = pair(name)
      expect(contentPieces(page).length).toBeGreaterThan(5)
      expect(pageGap(page, tree)).toBe('')
    })
  }

  test('an html email: the page prints its tags, the card what its reader sees, and a word changed on the card is a gap', () => {
    const { page, tree } = pair('html email')
    expect(page).toContain('<p>The <a href="https://x.example/zz_book">booking link</a>')
    expect(drawnText(tree.nodes)).toContain('The booking link (https://x.example/zz_book) is live.')
    const text = JSON.stringify(tree).replace('is live.', 'is broken.')
    const changed = JSON.parse(text) as MmCardTree
    expect(pageGap(page, changed)).toContain('the page holds a line the card does not')
  })

  test('a no-reply page: the suggestion is said on both sides', () => {
    const { page, tree } = pair('no reply')
    expect(page).toContain('### Suggestion: no reply needed')
    expect(pageGap(page, tree)).toBe('')
    const said = JSON.stringify(tree).replaceAll('Suggestion: no reply needed', 'A reply is owed')
    expect(pageGap(page, JSON.parse(said) as MmCardTree)).toBe(MISSING('Suggestion: no reply needed'))
  })

  test('a follow-ups page: a step dropped from the card, or the words of one step on another, is a gap', () => {
    const { page, tree } = pair('everything')
    expect(page).toContain('### Follow-ups (sent only if they have not replied)')
    const drop = JSON.parse(JSON.stringify(tree)) as MmCardTree
    const steps = drop.nodes.flatMap(n => n.k ?? []).find(n => n.c === 'rp-tl') as MmCardNode
    steps.k = steps.k?.slice(0, -1) ?? []
    expect(pageGap(page, drop)).toContain('the page holds a line the card does not (4. Call task for ZZ_assignee')
    const swap = JSON.parse(JSON.stringify(tree).replace('ZZ_fu_email_body', 'ZZ_other')) as MmCardTree
    expect(pageGap(page, swap)).toBe(MISSING('ZZ_fu_email_body'))
  })

  test('each draft stands against its own item: To and Cc are exact sets, both ways, and the subject is exact', () => {
    const { page, tree } = pair('everything')
    const wrong = (from: string, to: string) => pageGap(page, JSON.parse(JSON.stringify(tree).replace(from, to)) as MmCardTree)
    expect(wrong('zz_d1_to@x.example', 'zz_other@x.example')).toContain("the page's To is not the card's")
    expect(wrong('zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai', 'zz_d1_cc@x.example, rob@massmarket.ai')).toContain("the page's Cc is not the card's")
    expect(wrong('zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai', 'zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai, more@x.example')).toContain("the page's Cc is not the card's")
    expect(wrong('ZZ_d1_subject', 'ZZ_d1_subject two')).toBe(MISSING('Subject: ZZ_d1_subject'))
    expect(wrong('e1e1e1e1e1e1', 'e9e9e9e9e9e9')).toBe(MISSING('hash `e1e1e1e1e1e1`'))
  })

  test('the Cc that plan approval adds, on a card drawn before it, with that address elsewhere on the card: a gap', () => {
    const page = `### Client reply\n\n#### 1. Reply\n**To:** a@x.example · **Cc:** support@letaidothehardwork.com · **Subject:** S · **From:** rob@massmarket.ai · hash \`e1e1e1e1e1e1\`\n${fence('Hi')}`
    const mail = (cc: string) =>
      cardOf(
        sec(
          'Our reply to the client',
          para('1. Reply', 'rp-dtitle'),
          {
            c: 'rp-mail',
            k: [
              para([{ s: 'S', c: 'rp-subj' }, { s: 'e1e1e1e1e1e1', c: 'rp-chip' }], 'rp-mail-subj'),
              para('rob@massmarket.ai', 'rp-from'),
              para([{ s: 'To', c: 'rp-k' }, { s: ' ' }, { s: 'a@x.example', c: 'rp-v' }], 'rp-hdr'),
              para([{ s: 'Cc', c: 'rp-k' }, { s: ' ' }, { s: cc, c: 'rp-v' }], 'rp-hdr'),
              para('Hi', 'rp-body rp-mail-body'),
            ],
          },
        ),
        sec('Follow-ups, sent only if they have not replied', para('Cc: support@letaidothehardwork.com', 'rp-foot')),
      )
    expect(pageGap(page, mail('(none)'))).toContain("the page's Cc is not the card's")
    expect(pageGap(page, mail('support@letaidothehardwork.com'))).toBe('')
  })

  test('finding 3: a card drawn before plan approval, against the page after it: the Cc differs, and the other way round', () => {
    const before = pair("rob's mail, plan not approved")
    const after = pair("rob's mail, plan approved")
    expect(pageGap(after.page, before.tree)).toContain("the page's Cc is not the card's")
    expect(pageGap(before.page, after.tree)).toContain("the page's Cc is not the card's")
  })

  test('a mention is who it names: the card keeps the id behind the name it draws', () => {
    const { page, tree } = pair('everything')
    expect(pageGap(page, JSON.parse(JSON.stringify(tree).replaceAll('"m":"900000000000000002"', '"m":"900000000000000009"')) as MmCardTree)).not.toBe('')
    expect(pageGap(page, JSON.parse(JSON.stringify(tree).replaceAll('"m":"900000000000000003"', '"m":"900000000000000009"')) as MmCardTree)).not.toBe('')
  })

  test('the buttons to the real source are no line of the card: the page has no such line, and a page line that reads like one is not held by them', () => {
    const { page, tree } = pair('source links')
    expect(drawnText(tree.nodes)).toContain('Open email')
    expect(drawnText(tree.nodes)).toContain('Fireflies')
    expect(page).not.toContain('Open email')
    expect(pageGap(page, tree)).toBe('')
    const asked = page.replace('### Their message\n', '### Their message\nOpen email\n')
    expect(pageGap(asked, tree)).toBe(MISSING('Open email'))
  })

  test('a link to the Onboarding Wizard: the page prints the address, the card only its words, and that is no gap', () => {
    const page = '### Links\n- Plan: https://onboarding-wizard.massmarket.ai/dashboard/projects/x\n- Doc: https://x.example/doc'
    const links = (...lines: MmCardNode[]) => cardOf(sec('Links', { c: 'rp-links', k: lines }))
    expect(pageGap(page, links(para('Plan', 'rp-li'), para([{ s: 'Doc: ' }, { s: 'https://x.example/doc', href: 'https://x.example/doc' }], 'rp-li')))).toBe('')
    expect(pageGap(page, links(para('Plan', 'rp-li'), para([{ s: 'Doc', href: 'https://x.example/doc' }], 'rp-li')))).toBe(MISSING('Doc: https://x.example/doc'))
  })
})

describe('0.7.33 finding 6: each hole has a gap, and its control line passes', () => {
  const HOLES: Array<{ name: string; page: string; card: MmCardTree; control: MmCardTree }> = [
    { name: 'an amount-only line', page: fence('$5000'), card: cardWith('Hi Dana'), control: cardWith('$5000') },
    { name: 'a one-word line found in another line', page: fence('No'), card: cardWith('Team post: no action'), control: cardWith('No') },
    {
      name: 'a reply line found only in their quoted message',
      page: `### Client reply\n${fence('We will refund you $500 by Friday.')}`,
      card: cardOf(sec('Their message', para('We will refund you $500 by Friday.', 'rp-body')), sec('Our reply to the client', para('Hi Dana', 'rp-body'))),
      control: cardOf(sec('Our reply to the client', para('We will refund you $500 by Friday.', 'rp-body'))),
    },
    { name: 'a line sent three times, drawn once', page: fence('Call me today.\nCall me today.\nCall me today.'), card: cardWith('Call me today.'), control: cardWith('Call me today.\nCall me today.\nCall me today.') },
    { name: 'swapped lines', page: fence('Do not sign.\nSign today.'), card: cardWith('Sign today.', 'Do not sign.'), control: cardWith('Do not sign.', 'Sign today.') },
    { name: 'a sign', page: fence('Credit -$500 applied'), card: cardWith('Credit $500 applied'), control: cardWith('Credit -$500 applied') },
    { name: 'a currency', page: fence('Total €500'), card: cardWith('Total $500'), control: cardWith('Total €500') },
    { name: 'a separator', page: fence('Total 1,000'), card: cardWith('Total 1.000'), control: cardWith('Total 1,000') },
    { name: 'a percent', page: fence('Fee 5%'), card: cardWith('Fee 5'), control: cardWith('Fee 5%') },
    { name: 'an address', page: '**To:** jo.smith@acme.com', card: cardWith('jo-smith@acme.com'), control: cardWith('To: jo.smith@acme.com') },
    { name: 'a path', page: fence('https://x.com/a-b'), card: cardWith('https://x.com/a/b'), control: cardWith('https://x.com/a-b') },
    { name: 'a Cc found only as someone\'s sender', page: '**To:** a@x.com · **Cc:** b@y.com', card: cardWith('To a@x.com Cc (none)', 'From b@y.com'), control: cardWith('To: a@x.com · Cc: b@y.com') },
    { name: 'a link with nothing drawn', page: '- Plan: https://x.com/plan', card: cardWith(), control: cardWith('Plan: https://x.com/plan') },
    { name: 'an address behind a link\'s words', page: '- Plan: https://x.com/plan', card: cardWith([{ s: 'Plan', href: 'https://x.com/plan' }]), control: cardWith([{ s: 'Plan: ' }, { s: 'https://x.com/plan', href: 'https://x.com/plan' }]) },
    { name: 'a mention of another person', page: 'Must act: <@123456789012345678>', card: cardWith('Must act: @Someone Else'), control: cardWith([{ s: 'Must act: ' }, { s: '@Dana', m: '123456789012345678' }]) },
    { name: 'the closing of another hash', page: 'One go sends 9 items. Package `abcdefabcdef`.', card: cardWith('One go sends 1 item. Package 111111111111.'), control: cardWith('One go sends 9 items. Package abcdefabcdef.') },
    { name: 'a reply line the card does not have', page: fence('We will refund you $500 by Friday.'), card: cardWith('Hi Dana'), control: cardWith('We will refund you $500 by Friday.') },
  ]
  for (const hole of HOLES) {
    test(hole.name, () => {
      expect(pageGap(hole.page, hole.card)).not.toBe('')
      expect(pageGap(hole.page, hole.control)).toBe('')
    })
  }
})

describe('0.7.33 tickets from the call', () => {
  const HEAD = 'Tickets from the call: give each a due date or drop it'

  test('a package that has them is ready, and they are a section of its own', () => {
    const { page, tree } = pair('tickets from the call')
    expect(page).toContain(`### ${HEAD}`)
    expect(page).toContain('ZZ_call_ticket_one')
    expect(pageGap(page, tree)).toBe('')
  })

  test('a ticket the card lacks, or another owner on it, is a gap', () => {
    const { page, tree } = pair('tickets from the call')
    expect(pageGap(page, JSON.parse(JSON.stringify(tree).replace('ZZ_call_ticket_one', 'ZZ_call_ticket_oth')) as MmCardTree)).toContain('the page holds a line the card does not')
    expect(pageGap(page.replace('ZZ_call_ticket_one', 'ZZ_call_ticket_oth'), tree)).toContain('the page holds a line the card does not')
    expect(pageGap(page.replace('owner zz_owner@example.com', 'owner zz_someone@example.com'), tree)).toContain('the page holds a line the card does not')
  })

  test('the section gone from the card is a gap, and so is any other new section', () => {
    const { page, tree } = pair('tickets from the call')
    const without = { ...tree, nodes: tree.nodes.filter(n => !JSON.stringify(n).includes(HEAD)) }
    expect(pageGap(page, without)).toBe(`the page holds a section the card does not (${HEAD})`)
    expect(pageGap(`${page}\n### Something new\nZZ_new\n`, tree)).toContain('Something new')
  })

  test('the page saying they could not be read stands on the card too', () => {
    const { page, tree } = pair('tickets from the call, unread')
    expect(page).toContain('The tickets from the call could not be read.')
    expect(pageGap(page, tree)).toBe('')
    expect(pageGap(page, JSON.parse(JSON.stringify(tree).replace('could not be read.', 'were read.')) as MmCardTree)).toContain('the page holds a line the card does not')
  })
})

describe('0.7.43 what the quote says: each block, line and row of the page against its own box on the card', () => {
  const HEAD = 'What the quote says'
  const copy = (t: MmCardTree) => JSON.parse(JSON.stringify(t)) as MmCardTree
  /** The card's quote section, and its boxes, one a PDF. */
  const section = (t: MmCardTree) => t.nodes.find(n => /(?:^|\s)rp-quotes(?:\s|$)/.test(n.c ?? '')) as MmCardNode
  const boxes = (t: MmCardTree) => (section(t).k ?? []).filter(k => k.c === 'rp-quote')
  /** The tree with its first match of `from` replaced: a replacer, so a `$` in the words is a `$`. */
  const swap = (t: MmCardTree, from: string, to: string) => JSON.parse(JSON.stringify(t).replace(from, () => to)) as MmCardTree

  test('the section stands after our reply, holds both blocks, and the page and card agree', () => {
    const { page, tree } = pair('quotes')
    expect(page.indexOf(`### ${HEAD}`)).toBeGreaterThan(page.indexOf('### Client reply'))
    expect(page.indexOf(`### ${HEAD}`)).toBeLessThan(page.indexOf('### Team post'))
    expect(page).toContain('| 1 | ZZ_row_one \\| with a bar | 8 h | $1,997 |')
    expect(boxes(tree).length).toBe(2)
    expect(pageGap(page, tree)).toBe('')
  })

  test('a page without quotes is as it was, and a card that has them is no gap against it', () => {
    const quotes = pair('quotes')
    const plain = pair('everything')
    const at = quotes.page.indexOf(`\n### ${HEAD}\n`)
    expect(quotes.page.slice(0, at) + quotes.page.slice(quotes.page.indexOf('\n### Team post\n'))).toBe(plain.page)
    expect(plain.page).not.toContain(HEAD)
    expect(pageGap(plain.page, plain.tree)).toBe('')
    expect(pageGap(plain.page, quotes.tree)).toBe('')
  })

  test('a card without the section is not ready, as an older bridge is with any new section', () => {
    const { page, tree } = pair('quotes')
    const without = { ...tree, nodes: tree.nodes.filter(n => n !== section(tree)) }
    expect(pageGap(page, without)).toBe(`the page holds a section the card does not (${HEAD})`)
  })

  test('a row the card leaves out, or one more on it, is a gap', () => {
    const { page, tree } = pair('quotes')
    const fewer = copy(tree)
    const first = boxes(fewer)[0] as MmCardNode
    first.k = (first.k ?? []).filter(k => !(k.c === 'rp-quote-row' && JSON.stringify(k).includes('ZZ_row_two')))
    expect(pageGap(page, fewer)).toBe(MISSING('2'))
    const last = copy(tree)
    const box = boxes(last)[0] as MmCardNode
    const lastRow = (box.k ?? []).filter(k => /\brp-quote-row\b/.test(k.c ?? '')).at(-1) as MmCardNode
    box.k = [...(box.k ?? []), lastRow]
    expect(pageGap(page, last)).toBe('the page holds 4 rows in quote block 1, the card 5')
    const gone = copy(tree)
    const one = boxes(gone)[0] as MmCardNode
    one.k = (one.k ?? []).filter(k => !(k.c === 'rp-quote-row' && JSON.stringify(k).includes('ZZ_row_three')))
    expect(pageGap(page, gone)).toBe('the page holds more rows in quote block 1 than the card (ZZ_row_three)')
  })

  test('another amount, other hours, other words or another number in a row is a gap, each cell against its own leaf', () => {
    const { page, tree } = pair('quotes')
    expect(pageGap(page, swap(tree, '"s":"$1,997"', '"s":"$2,497"'))).toBe(MISSING('$1,997'))
    expect(pageGap(page, swap(tree, '"s":"2.5 h"', '"s":"3 h"'))).toBe(MISSING('2.5 h'))
    expect(pageGap(page, swap(tree, 'ZZ_row_one | with a bar', 'ZZ_row_one with a bar'))).toBe(MISSING('ZZ_row_one | with a bar'))
    expect(pageGap(page, swap(tree, '"s":"3"', '"s":"7"'))).toBe(MISSING('3'))
    // an empty cell is its dash on both sides
    expect(pageGap(page, swap(tree, '"s":"—"', '"s":"0 h"'))).toBe(MISSING('—'))
    // a cell's words found in another cell of the row do not stand for it
    expect(pageGap(page, swap(tree, '"s":"8 h"', '"s":"$1,997"'))).toBe(MISSING('8 h'))
    // and the page's side: a changed amount there is a gap too
    expect(pageGap(page.replace('| 3 | ZZ_row_three | 2.5 h | $622 |', '| 3 | ZZ_row_three | 2.5 h | $722 |'), tree)).toBe(MISSING('$722'))
  })

  test('a block whose head the card lacks, or another block, is a gap, and the counts are equal', () => {
    const { page, tree } = pair('quotes')
    const headless = copy(tree)
    const second = boxes(headless)[1] as MmCardNode
    second.k = (second.k ?? []).filter(k => k.c !== 'rp-quote-head')
    expect(pageGap(page, headless)).toBe(MISSING('ZZ_second.pdf · on 1. ZZ_d1_title'))
    const one = copy(tree)
    const sec = section(one)
    sec.k = (sec.k ?? []).filter(k => k !== boxes(one)[1])
    expect(pageGap(page, one)).toBe(MISSING('ZZ_second.pdf · on 1. ZZ_d1_title'))
    const three = copy(tree)
    section(three).k = [...(section(three).k ?? []), boxes(three)[1] as MmCardNode]
    expect(pageGap(page, three)).toBe('the page holds 2 quote blocks, the card 3')
    expect(pageGap(page, swap(tree, 'ZZ_second.pdf', 'ZZ_other.pdf'))).toBe(MISSING('ZZ_second.pdf · on 1. ZZ_d1_title'))
  })

  test('each plain line is a whole line of its own block: the source, the invoice, a title, the rows left out, the total', () => {
    const { page, tree } = pair('quotes')
    for (const line of ['ZZ_quote_source_line from quote record ZZ-Q1 version 2.', 'ZZ_quote_invoice_line INV-000001.', 'Table: ZZ_table_one · Build', '4 more rows are in the PDF.', 'ZZ_quote_total 10.5 h, $2,619']) {
      const changed = swap(tree, line, `${line} more`)
      expect(pageGap(page, changed), line).toBe(MISSING(line))
    }
    // the second block's words in the first block's box do not stand for them
    const moved = copy(tree)
    const [a, b] = boxes(moved) as [MmCardNode, MmCardNode]
    const src = (b.k ?? []).find(k => k.c === 'rp-quote-src') as MmCardNode
    b.k = (b.k ?? []).filter(k => k !== src)
    a.k = [...(a.k ?? []), src]
    expect(pageGap(page, moved)).toBe(MISSING('ZZ_unreadable_source'))
  })

  test('a check is held with its mark: a ✅ where the page says ⚠️ is a gap, either way', () => {
    const { page, tree } = pair('quotes')
    expect(page).toContain('\n⚠️ ZZ_quote_check_warn\n')
    expect(pageGap(page, swap(tree, '⚠️ ZZ_quote_check_warn', '✅ ZZ_quote_check_warn'))).toBe(MISSING('ZZ_quote_check_warn'))
    expect(pageGap(page, swap(tree, '✅ ZZ_quote_check_ok', '⚠️ ZZ_quote_check_ok'))).toBe(MISSING('ZZ_quote_check_ok'))
    expect(pageGap(page.replace('✅ ZZ_quote_check_ok', '⚠️ ZZ_quote_check_ok'), tree)).toBe(MISSING('ZZ_quote_check_ok'))
  })

  test('a row whose words read like a state line is no state line on either side', () => {
    const { page, tree } = pair('quotes')
    const said = 'Approved, ZZ_row_two'
    expect(pageGap(page.replace('| ZZ_row_two |', `| ${said} |`), swap(tree, '"s":"ZZ_row_two"', `"s":"${said}"`))).toBe('')
  })

  test('a quote that changed is a new version: the card drawn before it is not the page after it', () => {
    const before = pair('quotes')
    const after = pair('quotes, revised')
    expect(after.tree.label).not.toBe(before.tree.label)
    expect(after.page).toContain('| 1 | ZZ_row_one \\| with a bar | 8 h | $2,497 |')
    expect(pageGap(after.page, before.tree)).not.toBe('')
    // and with the hash put aside, the changed amount itself is what the check finds
    expect(pageGap(after.page.replaceAll(after.tree.label, before.tree.label), before.tree)).toBe(MISSING('$2,497'))
    expect(pageGap(after.page, after.tree)).toBe('')
  })
})

// (0.7.50) Get Your Funds, 2026-11-11: OW #731 prints a table it read from the PDF under its own header, one cell a column, and the
// card draws that header (`rp-quote-cols`) and one `rp-quote-cell` a column. Before, the header line was read as a row and every row
// of N cells as a mismatch, so such a package answered card not ready.
describe('0.7.50 a quote table read from the PDF: its own header and its own cells against the card', () => {
  const copy = (t: MmCardTree) => JSON.parse(JSON.stringify(t)) as MmCardTree
  const box = (t: MmCardTree) => ((t.nodes.find(n => /(?:^|\s)rp-quotes(?:\s|$)/.test(n.c ?? '')) as MmCardNode).k ?? []).find(k => k.c === 'rp-quote') as MmCardNode
  const parts = (t: MmCardTree, cls: string) => (box(t).k ?? []).filter(k => new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`).test(k.c ?? ''))
  /** The tree with its first match of `from` replaced: a replacer, so a `$` in the words is a `$`. */
  const swap = (t: MmCardTree, from: string, to: string) => JSON.parse(JSON.stringify(t).replace(from, () => to)) as MmCardTree
  const HEAD = '| # | Line | Estimate | Fixes (25%) | Hours | Milestone |'
  const ROW_1 = '| 1 | Booking flow \\| two calendars | 1.5 | 0.375 | 1.875 | M1 |'

  test('the page prints both tables under their own headers, the card draws them, and they agree', () => {
    const { page, tree } = pair('quotes, columns')
    expect(page).toContain(`\n${HEAD}\n|---|---|---|---|---|---|\n`)
    expect(page).toContain('\n| Optional | Estimate | Hours | With the build | On its own |\n|---|---|---|---|---|\n')
    expect(page).toContain('| 2 | Missed-call text-back | 0.5 | 0.125 | 0.625 | M2 |')
    expect(parts(tree, 'rp-quote-cols').length).toBe(2)
    expect(parts(tree, 'rp-quote-row').length).toBe(6)
    expect(pageGap(page, tree)).toBe('')
  })

  test('a row the card leaves out is a gap, in the middle of a table or at its end', () => {
    const { page, tree } = pair('quotes, columns')
    const middle = copy(tree)
    box(middle).k = (box(middle).k ?? []).filter(k => !JSON.stringify(k).includes('Missed-call text-back'))
    expect(pageGap(page, middle)).toBe(MISSING('2'))
    const last = copy(tree)
    box(last).k = (box(last).k ?? []).filter(k => !JSON.stringify(k).includes('A row the PDF left short'))
    expect(pageGap(page, last)).toBe('the page holds more rows in quote block 1 than the card (4)')
    const more = copy(tree)
    box(more).k = [...(box(more).k ?? []), parts(more, 'rp-quote-row').at(-1) as MmCardNode]
    expect(pageGap(page, more)).toBe('the page holds 6 rows in quote block 1, the card 7')
  })

  test('a changed cell is a gap, on the card or on the page, and so are two cells in each other\'s place', () => {
    const { page, tree } = pair('quotes, columns')
    // the misreading that started it: 0.625 h shown as 0.63
    expect(pageGap(page, swap(tree, '"s":"0.625"', '"s":"0.63"'))).toBe(MISSING('0.625'))
    expect(pageGap(page.replace('| 0.5 | 0.125 | 0.625 | M2 |', '| 0.5 | 0.125 | 0.63 | M2 |'), tree)).toBe(MISSING('0.63'))
    expect(pageGap(page, swap(tree, '"s":"$75"', '"s":"$57"'))).toBe(MISSING('$75'))
    expect(pageGap(page, swap(tree, 'Booking flow | two calendars', 'Booking flow two calendars'))).toBe(MISSING('Booking flow | two calendars'))
    expect(pageGap(page.replace(ROW_1, '| 1 | Booking flow \\| two calendars | 0.375 | 1.5 | 1.875 | M1 |'), tree)).toBe(MISSING('0.375'))
    // an empty cell is its dash on both sides
    expect(pageGap(page.replace('| — | Build | 2 | 0.5 | 2.5 | — |', '| — | Build | 2 | 0.5 | 2.5 | M1 |'), tree)).toBe(MISSING('M1'))
  })

  test('a cell the card lacks, or one more on it, is a gap', () => {
    const { page, tree } = pair('quotes, columns')
    const fewer = copy(tree)
    const first = parts(fewer, 'rp-quote-row')[1] as MmCardNode
    first.k = (first.k ?? []).filter(k => !JSON.stringify(k).includes('"M1"'))
    expect(pageGap(page, fewer)).toBe(MISSING(ROW_1))
    const more = copy(tree)
    const row = parts(more, 'rp-quote-row')[1] as MmCardNode
    row.k = [...(row.k ?? []), { c: 'rp-quote-cell', r: [{ s: 'M9' }] }]
    expect(pageGap(page, more)).toBe(MISSING(ROW_1))
  })

  test('a page header the card lacks is a gap, and a card header the page lacks, or another word in one', () => {
    const { page, tree } = pair('quotes, columns')
    const headless = copy(tree)
    box(headless).k = (box(headless).k ?? []).filter(k => k !== parts(headless, 'rp-quote-cols')[0])
    expect(pageGap(page, headless)).toBe(MISSING(HEAD))
    const second = page.replace('| Optional | Estimate | Hours | With the build | On its own |\n|---|---|---|---|---|\n', '')
    expect(second).not.toBe(page)
    expect(pageGap(second, tree)).toBe('the card holds a table header the page does not (Optional | Estimate | Hours | With the build | On its own)')
    const extra = copy(tree)
    box(extra).k = [...(box(extra).k ?? []), parts(extra, 'rp-quote-cols')[0] as MmCardNode]
    expect(pageGap(page, extra)).toBe('the page holds 2 table headers in quote block 1, the card 3')
    expect(pageGap(page, swap(tree, '"s":"Fixes (25%)"', '"s":"Fixes"'))).toBe(MISSING('Fixes (25%)'))
    expect(pageGap(page.replace(HEAD, '| # | Line | Estimate | Fixes (25%) | Hours |'), tree)).toBe(MISSING('| # | Line | Estimate | Fixes (25%) | Hours |'))
  })

  test('a card drawn before OW read the columns, four cells a row and no header, is not ready', () => {
    const { page, tree } = pair('quotes, columns')
    const old = copy(tree)
    const four = (): MmCardNode => ({ c: 'rp-quote-row', k: ['no', 'line', 'hours', 'amt'].map(c => para('—', `rp-quote-${c}`)) })
    box(old).k = (box(old).k ?? []).filter(k => !/\brp-quote-cols\b/.test(k.c ?? '')).map(k => (/\brp-quote-row\b/.test(k.c ?? '') ? four() : k))
    expect(parts(old, 'rp-quote-row').length).toBe(6)
    expect(pageGap(page, old)).toBe(MISSING(HEAD))
    // and a page row of N cells against a row of the four: the counts differ
    expect(pageGap(page.replace(`${HEAD}\n|---|---|---|---|---|---|\n`, ''), old)).toBe(MISSING('| Phase 1 · the build | — | — | — | — | — |'))
  })

  test('a cell or a header word that reads like a state line is no state line on either side', () => {
    const { page, tree } = pair('quotes, columns')
    const said = page.replace('| Review requests |', '| Approved, review requests |').replace('| Optional | Estimate |', '| Approved, optional | Estimate |')
    const drawn = swap(swap(tree, '"s":"Review requests"', '"s":"Approved, review requests"'), '"s":"Optional"', '"s":"Approved, optional"')
    expect(pageGap(said, drawn)).toBe('')
  })
})

describe('0.7.45 date moves and a ticket the reply answers (OW #717): each line against its own leaf, one to one, both ways', () => {
  const copy = (t: MmCardTree) => JSON.parse(JSON.stringify(t)) as MmCardTree
  /** The tree with its first match of `from` replaced: a replacer, so a `$` in the words is a `$`. */
  const swap = (t: MmCardTree, from: string, to: string) => JSON.parse(JSON.stringify(t).replace(from, () => to)) as MmCardTree
  const has = (n: MmCardNode, cls: string) => new RegExp(`(?:^|\\s)${cls}(?:\\s|$)`).test(n.c ?? '')
  /** The tree without any node of this class, wherever it sits. */
  const drop = (t: MmCardTree, cls: string, which?: (n: MmCardNode) => boolean): MmCardTree => {
    const walk = (list: readonly MmCardNode[]): MmCardNode[] =>
      list.filter(n => !(has(n, cls) && (!which || which(n)))).map(n => (n.k ? { ...n, k: walk(n.k) } : n))
    return { ...t, nodes: walk(t.nodes) }
  }
  const movesSection = (t: MmCardTree) => t.nodes.find(n => JSON.stringify(n).includes('"Date moves"')) as MmCardNode
  const TICKET_MOVE =
    'Ticket aaaaaaaa "ZZ_ticket_title": Thu Nov 12 → Mon Nov 16 (ZZ_move_reason_one). Source: ZZ_move_call_title, Nov 10: "ZZ_move_call_quote push it to Monday"'
  const PHASE_MOVE = 'Phase 2 "ZZ_phase_title": none → Tue Nov 17 (ZZ_move_reason_two). Source: this email: "ZZ_move_email_quote"'
  const ANSWERED_LINE = 'Ticket aaaaaaaa "ZZ_answered_title": closes on send — answered by: "ZZ_answered_quote: the login redirect is fixed."'

  test('the moves are a section of their own after the tickets, in the words OW prints, and the page and card agree', () => {
    const { page, tree } = pair('date moves')
    expect(page).toContain(`\n### Date moves\n- ${TICKET_MOVE}\n- ${PHASE_MOVE}\n`)
    expect(page.indexOf('### Date moves')).toBeGreaterThan(page.indexOf('### ETA or proof for every open ticket?'))
    expect(page.indexOf('### Date moves')).toBeLessThan(page.indexOf('### Their message'))
    expect(pageGap(page, tree)).toBe('')
  })

  test('a page with no move is as it was: no section, the same page, and its own card agrees', () => {
    const moves = pair('date moves')
    const plain = pair('everything')
    const at = moves.page.indexOf('\n### Date moves\n')
    expect(moves.page.slice(0, at) + moves.page.slice(moves.page.indexOf('\n### Their message\n'))).toBe(plain.page)
    expect(plain.page).not.toContain('Date moves')
    expect(plain.page).not.toContain('closes on send')
    expect(pageGap(plain.page, plain.tree)).toBe('')
  })

  test('a move the card lacks, another date on it, or one more on the card is a gap', () => {
    const { page, tree } = pair('date moves')
    expect(pageGap(page, drop(tree, 'rp-move', n => JSON.stringify(n).includes('ZZ_phase_title')))).toBe(MISSING(PHASE_MOVE))
    expect(pageGap(page, drop(tree, 'rp-move', n => JSON.stringify(n).includes('ZZ_ticket_title')))).toBe(MISSING(TICKET_MOVE))
    expect(pageGap(page, swap(tree, 'Mon Nov 16', 'Tue Nov 17'))).toBe(MISSING(TICKET_MOVE))
    expect(pageGap(page, swap(tree, 'ZZ_move_reason_two', 'ZZ_move_reason_oth'))).toBe(MISSING(PHASE_MOVE))
    const more = copy(tree)
    const section = movesSection(more)
    section.k = [...(section.k ?? []), { c: 'rp-qa rp-move', r: [{ s: 'Ticket bbbbbbbb: none → Fri Nov 20 (ZZ_extra). Source: this email: "ZZ_extra"' }] }]
    expect(pageGap(page, more)).toBe('the page holds 2 date moves, the card 3')
  })

  test('the moves in another order are a gap: each line stands against its own leaf', () => {
    const { page, tree } = pair('date moves')
    const turned = copy(tree)
    const section = movesSection(turned)
    const moves = (section.k ?? []).filter(n => has(n, 'rp-move'))
    section.k = [...(section.k ?? []).filter(n => !has(n, 'rp-move')), ...moves.reverse()]
    expect(pageGap(page, turned)).toBe(MISSING(TICKET_MOVE))
  })

  test('the section gone from the card is a gap, and the card showing moves the page does not is one too', () => {
    const { page, tree } = pair('date moves')
    expect(pageGap(page, { ...tree, nodes: tree.nodes.filter(n => n !== movesSection(tree)) })).toBe(
      'the page holds a section the card does not (Date moves)',
    )
    expect(pageGap(pair('everything').page, tree)).toBe('the card says what the page does not (Date moves)')
  })

  test('with the ticket check off the moves still stand, on both sides', () => {
    const { page, tree } = pair('date moves, ticket check off')
    expect(page).not.toContain('### ETA or proof')
    expect(page).toContain(`### Date moves\n- ${TICKET_MOVE}\n`)
    expect(pageGap(page, tree)).toBe('')
  })

  test('an answered ticket is its own line under the table, not a row, and the page and card agree', () => {
    const { page, tree } = pair('answered')
    expect(page).toContain(`|\n\n- ${ANSWERED_LINE}\n`)
    expect(page).toContain('1 of 3 open tickets have no ETA')
    expect(pageGap(page, tree)).toBe('')
  })

  test('with every ticket answered there is no table, on either side', () => {
    const { page, tree } = pair('every ticket answered')
    expect(page).toContain(`### ETA or proof for every open ticket?\n- ${ANSWERED_LINE}\n`)
    expect(page).not.toContain('| # | Ticket |')
    expect(pageGap(page, tree)).toBe('')
  })

  test('an answered line the card lacks or words otherwise, a row for it, or one the page does not have, is a gap', () => {
    const { page, tree } = pair('answered')
    expect(pageGap(page, drop(tree, 'rp-answered'))).toBe(MISSING(ANSWERED_LINE))
    expect(pageGap(page, swap(tree, 'closes on send', 'stays open'))).toBe(MISSING(ANSWERED_LINE))
    expect(pageGap(page, swap(tree, 'the login redirect is fixed.', 'the login redirect is next.'))).toBe(MISSING(ANSWERED_LINE))
    // drawn as a row instead: one row more than the page's table
    expect(pageGap(page, swap(tree, '"c":"rp-qa rp-answered"', '"c":"rp-q"'))).toBe(
      'the page holds 2 rows in ETA or proof for every open ticket?, the card 3',
    )
    // a card with the line, against a page without it, or with no ticket section at all to say it
    expect(pageGap(page.replace(`\n\n- ${ANSWERED_LINE}`, ''), tree)).toBe('the page holds 0 answered tickets, the card 1')
    const all = pair('every ticket answered')
    const at = all.page.indexOf('\n### ETA or proof for every open ticket?\n')
    const cut = all.page.slice(0, at) + all.page.slice(all.page.indexOf('\n### Their message\n'))
    expect(cut).not.toContain('closes on send')
    expect(pageGap(cut, all.tree)).toBe('the card says what the page does not (an answered ticket)')
  })
})

describe('0.7.33 added by the team: never sent, so the name is not compared, its time and words are', () => {
  /** OW's page prints the roster's name where this computer's renderer prints the address. */
  const onOwPage = (page: string) => page.replace(/^(#### )[^\n·]*@[^\n·]*( · )/gm, '$1Roster Name$2')

  test('the marker package has additions, and the page and card agree', () => {
    const { page, tree } = pair('everything')
    expect(page).toContain('### Added by the team')
    expect(pageGap(page, tree)).toBe('')
  })

  test("the roster's name on OW's page against the address on the card: no gap", () => {
    const { page, tree } = pair('everything')
    expect(onOwPage(page)).not.toBe(page)
    expect(pageGap(onOwPage(page), tree)).toBe('')
  })

  const section = (page: string) => page.slice(page.indexOf('### Added by the team'), page.indexOf('\n### ', page.indexOf('### Added by the team') + 1))

  test('a changed word in what they added is a gap, on the page or on the card', () => {
    const { page, tree } = pair('everything')
    const added = section(page)
    const word = /[>`\n]\s*(ZZ_\w+)/.exec(added.slice(added.indexOf('```')))?.[1] as string
    expect(word).toBeTruthy()
    expect(pageGap(page.replace(added, added.replace(word, 'ZZ_changed')), tree)).toContain('the page holds a line the card does not')
    expect(pageGap(onOwPage(page).replace(section(onOwPage(page)), section(onOwPage(page)).replace(word, 'ZZ_changed')), tree)).toContain('the page holds a line the card does not')
  })

  test('another time on the by-line is a gap', () => {
    const { page, tree } = pair('everything')
    const added = section(page)
    const changed = added.replace(/^(#### .* · )(.*)$/m, '$1Fri Jan 1, 9:00 AM ET')
    expect(changed).not.toBe(added)
    expect(pageGap(page.replace(added, changed), tree)).toBe(MISSING('Fri Jan 1, 9:00 AM ET'))
  })

  test('an addition the card lacks, or one more on the card, is a gap', () => {
    const { page, tree } = pair('everything')
    const added = section(page)
    const more = `${added}\n#### Roster Name · Fri Jan 1, 9:00 AM ET\n> \`\`\`\n> ZZ_one_more\n> \`\`\`\n`
    expect(pageGap(page.replace(added, more), tree)).toContain('the page holds a line the card does not')
    const only = added.slice(0, added.indexOf('#### '))
    expect(pageGap(page.replace(added, only), tree)).toContain('additions by the team')
  })

  test('words only one addition holds do not stand for another: each is held against its own', () => {
    const { page, tree } = pair('everything')
    const bodies = findQuotes(tree)
    expect(bodies.length).toBeGreaterThan(0)
    expect(pageGap(page, tree)).toBe('')
    const noted = JSON.parse(JSON.stringify(tree)) as MmCardTree
    for (const n of findQuotes(noted)) n.r = [{ s: 'ZZ_something_else' }]
    expect(pageGap(page, noted)).toContain('the page holds a line the card does not')
  })
})

/** The nodes of a card that hold what the team added. */
function findQuotes(tree: MmCardTree): MmCardNode[] {
  const out: MmCardNode[] = []
  const walk = (list: readonly MmCardNode[]) => {
    for (const n of list) {
      if (/\brp-quote\b/.test(n.c ?? '')) out.push(n)
      else if (n.k) walk(n.k)
    }
  }
  walk(tree.nodes)
  return out
}

describe('0.7.33 findings', () => {
  const page = (line: string) => `### Findings\n- ${line}\n`
  const card = (what: string, rec: string) =>
    cardOf(sec('Findings', { c: 'rp-find', k: [para(what, 'rp-find-what'), { c: 'rp-rec', r: [{ s: 'Recommend', c: 'rp-k' }, { s: ' ' }, { s: rec, c: 'rp-v' }] }] }))

  test('a recommendation that opens with the word itself: cut where the renderer cuts it', () => {
    expect(pageGap(page('Rob: decide this Recommend: Recommend: go with it'), card('Rob: decide this', 'Recommend: go with it'))).toBe('')
  })

  test('another word in what it is, or in what we recommend, is a gap', () => {
    expect(pageGap(page('Rob: decide that Recommend: go with it'), card('Rob: decide this', 'go with it'))).toBe(MISSING('Rob: decide that'))
    expect(pageGap(page('Rob: decide this Recommend: stop'), card('Rob: decide this', 'go with it'))).toBe(MISSING('Recommend: stop'))
  })
})

describe('0.7.33 finding 4: any image in a body is not ready', () => {
  const IMAGE = 'the package holds an image or other media the side pane cannot draw'
  const card = cardWith('Hi Dana')
  for (const [name, body] of [
    ['an <img> with no alt', 'Hi Dana\n<img src="https://cdn.example/pricing-table.png">'],
    ['an <img> with alt', '<p>Hi Dana</p><IMG alt="pricing" src="x.png"/>'],
    ['a markdown image', 'Hi Dana\n![pricing](https://cdn.example/p.png)'],
    ['a markdown image with no words', '![](p.png)'],
  ] as const) {
    test(name, () => {
      expect(holdsImage(fence(body), card)).toBe(true)
      expect(pageGap(fence(body), card)).toBe(IMAGE)
    })
  }
  test('a body behind `> ` counts too, and the page\'s inline image line, and the renderer\'s flag', () => {
    expect(pageGap(`> \`\`\`text\n> <img src="x.png">\n> \`\`\``, card)).toBe(IMAGE)
    expect(pageGap('**Inline image** `[image: a.png]`: a.png', card)).toBe(IMAGE)
    expect(pageGap('Hi Dana', { ...card, images: 1 })).toBe(IMAGE)
  })
  for (const [name, body] of [
    ['a table background', '<table background="https://cdn.example/b.png"><tr><td>Hi</td></tr></table>'],
    ['css background-image', '<div style="background-image:url(https://cdn.example/b.png)">Hi</div>'],
    ['css url( alone', '<div style="background:url(https://cdn.example/b.png)">Hi</div>'],
    ['an entity hiding the url(', '<div style="background:u&#114;l(https://cdn.example/b.png)">Hi</div>'],
    ['a picture and its source', '<picture><source srcset="https://cdn.example/b.png"></picture>'],
    ['an svg image', '<svg><image href="https://cdn.example/b.png"/></svg>'],
    ['a video', '<video controls src="https://cdn.example/b.mp4"></video>'],
    ['an audio', '<audio controls src="https://cdn.example/b.mp3"></audio>'],
    ['an iframe', '<iframe src="https://cdn.example/b"></iframe>'],
    ['an object', '<object data="https://cdn.example/b.pdf"></object>'],
    ['an embed', '<embed type="application/pdf">'],
    ['a quote mark before src', '<x alt="p"src="https://cdn.example/b.png">'],
  ] as const) {
    test(`${name} in a body that goes out is not ready`, () => {
      const page = `## X · reply package · Package \`${realTree().label}\`\n\n### Client reply\n#### 1. Reply\n${fence(body)}\n`
      expect(holdsImage(page, realTree())).toBe(true)
      expect(pageGap(page, realTree())).toBe('the package holds an image or other media the side pane cannot draw')
    })
  }

  test('the renderer\'s flag for any of them holds the box without the page', () => {
    expect(pageGap(SMS_PAGE, { ...realTree(), images: 1 })).toBe('the package holds an image or other media the side pane cannot draw')
  })

  test('a link with ?src= in it, and words about a video or a background, are no media', () => {
    for (const body of ['Book here: https://x.example/b?src=mail&utm_source=a', '<a href="https://x.example/b?src=mail">book</a>', 'We looked at the background of the video call.'])
      expect(holdsImage(`### Client reply\n${fence(body)}\n`, realTree())).toBe(false)
  })

  test('words about an image, and a link, are no image', () => {
    expect(holdsImage(fence('the image is attached [here](https://x.example/a.png)'), card)).toBe(false)
  })
})

describe('0.7.33 finding 5: state lines are checked both ways', () => {
  const OFF = 'Switched off: none of these steps will send while follow-ups are switched off.'
  test('a card saying none of these steps will send, against a live page: a gap', () => {
    const live = pair('follow-ups live')
    const off = pair('follow-ups switched off')
    expect(pageGap(live.page, off.tree)).toContain('the card says what the page does not (Switched off: none of these steps')
  })
  test('a page saying so, against a card that does not: a gap', () => {
    const live = pair('follow-ups live')
    const off = pair('follow-ups switched off')
    expect(pageGap(off.page, live.tree)).toContain(MISSING('Switched off: none of these steps').slice(0, 40))
  })
  test('the same line on both sides passes, and the same words in a body are no state line', () => {
    expect(pageGap(OFF, cardWith(OFF))).toBe('')
    expect(pageGap('', cardWith('x'))).toBe('the page could not be read to compare')
    expect(pageGap('Hi', cardOf(para('Hi'), para(OFF, 'rp-body')))).toBe('')
    expect(pageGap('Hi', cardWith('Hi', OFF))).toContain('the card says what the page does not')
  })
  test('the closing, an approval and a closed package each stand both ways', () => {
    const closed = pair('closed no reply')
    expect(pageGap(closed.page, closed.tree)).toBe('')
    expect(pageGap(closed.page, pair('no reply').tree)).not.toBe('')
    expect(pageGap('One go sends 1 item. Package `abcabcabcabc`.', cardWith('One go sends 1 item. Package abcabcabcabc.', 'Closed: no reply needed.'))).toContain('the card says what the page does not')
    expect(pageGap('_Approved by a@x.example, Thu Nov 5, 10:00 AM ET._', cardWith('x'))).toContain('Approved by a@x.example')
    expect(pageGap('Hi', cardWith('Hi', 'Approved by a@x.example, Thu Nov 5, 10:00 AM ET.'))).toContain('the card says what the page does not')
  })
  test('a chip that says what the go does: on the card and not the page, or the other way, is a gap', () => {
    const { page, tree } = pair('everything')
    expect(page).toContain("needs Rob's OK")
    expect(pageGap(page.replace(" · ⚠️ needs Rob's OK", ''), tree)).toBe(MISSING("needs Rob's OK"))
  })
})

describe('0.7.33 the normalising and the frame', () => {
  test('it collapses whitespace and strips markdown marks, and nothing else', () => {
    expect(squash('  a \n\t b  ')).toBe('a b')
    expect(squash('Jo.Smith@Acme.com -$1,000 5% /a-b')).toBe('Jo.Smith@Acme.com -$1,000 5% /a-b')
    expect(pageGap('- **Booking** `link` here today', cardWith('Booking link here today'))).toBe('')
    expect(pageGap('_Booking link here today_', cardWith('Booking link here today'))).toBe('')
    expect(pageGap('⛔ Booking link here today', cardWith('Booking link here today'))).toBe('')
  })

  test('case stays', () => {
    expect(pageGap('Booking Link', cardWith('booking link'))).toBe(MISSING('Booking Link'))
  })

  test('the structural allowlist: only lines the same for every package', () => {
    for (const line of ['|---|---|---|---|', '---', 'Note:', 'Transcript:', '_No client email in this package._']) {
      expect(STRUCTURAL.some(p => p.test(line)), line).toBe(true)
    }
    for (const line of ['Note: call Dana back', '| 1 | Is it live? |', 'One go sends 1 item.']) expect(STRUCTURAL.some(p => p.test(line)), line).toBe(false)
  })

  test('a section the card does not know is a gap, and a row more or fewer in a table', () => {
    expect(pageGap('### Something new\nA line', cardWith('A line'))).toBe('the page holds a section the card does not (Something new)')
    const q = (n: number) => ({ c: 'rp-q', k: [para(`Q${n}`), { c: 'rp-grow', k: [para('Is it live?', 'rp-qa rp-qa-them'), para('Yes', 'rp-qa rp-qa-us')] }] })
    const page = '### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | Is it live? | "Yes" | ✅ |'
    expect(pageGap(page, cardOf(sec('Every question answered?', q(1))))).toBe('')
    expect(pageGap(page, cardOf(sec('Every question answered?', q(1), q(2))))).toBe('the page holds 1 rows in Every question answered?, the card 2')
    expect(pageGap(page.replace('"Yes"', '"No"'), cardOf(sec('Every question answered?', q(1))))).toBe(MISSING('"No"'))
  })

  // (0.7.46) NFE, 2026-11-11: rows 8 to 22 of a 24-row check each quoted a bullet line of our reply, and the card was held off for it
  test('a row quoting a bullet line of our reply is the same row on the card, and other words in it are still a gap', () => {
    const row = (us: string) => ({ c: 'rp-q', k: [para('Q1'), { c: 'rp-grow', k: [para('Could you break the hours down by step?', 'rp-qa rp-qa-them'), para(us, 'rp-qa rp-qa-us')] }] })
    const table = (cell: string) => `### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | Could you break the hours down by step? | ${cell} | ✅ |`
    for (const mark of ['- ', '> ']) {
      const us = `${mark}Setup by step, and a price for just the key and test lead`
      expect(pageGap(table(`"${us}"`), cardOf(sec('Every question answered?', row(us))))).toBe('')
      expect(pageGap(table(`"${us}"`), cardOf(sec('Every question answered?', row(`${mark}Setup by step, and a price for the whole build`))))).toBe(MISSING(`"${us}"`))
    }
    // a plain quote is held exactly as before
    expect(pageGap(table('"Yes, we can split it."'), cardOf(sec('Every question answered?', row('Yes, we can split it.'))))).toBe('')
    expect(pageGap(table('"Yes, we can split it."'), cardOf(sec('Every question answered?', row('No, we cannot split it.'))))).toBe(MISSING('"Yes, we can split it."'))
    // the mark is held, never dropped (review round 1): the page saying more than the leaf, or a mark the leaf lacks, is still a gap
    expect(pageGap(table('">2 weeks"'), cardOf(sec('Every question answered?', row('2 weeks'))))).toBe(MISSING('">2 weeks"'))
    expect(pageGap(table('">2 weeks"'), cardOf(sec('Every question answered?', row('>2 weeks'))))).toBe('')
    expect(pageGap(table('"- 5 hours"'), cardOf(sec('Every question answered?', row('5 hours'))))).toBe(MISSING('"- 5 hours"'))
    // a row with no reply leaf: the quoted words are looked for as the page wrote them, mark and all, as before
    const bare = { c: 'rp-q', k: [para('Q1'), { c: 'rp-grow', k: [para('Yes or no: can you split it?', 'rp-qa rp-qa-them')] }] }
    expect(pageGap(table('"- Yes"').replace('Could you break the hours down by step?', 'Yes or no: can you split it?'), cardOf(sec('Every question answered?', bare)))).toBe(MISSING('"- Yes"'))
  })

  test('the page\'s heading is the card\'s client and hash', () => {
    const { page, tree } = pair('everything')
    expect(pageGap(page.replace(`Package \`${tree.label}\`.`, 'Package `aaaaaaaaaaaa`.'), tree)).not.toBe('')
    const line = page.split('\n')[0] as string
    expect(pageGap(page.replace(line, line.replace(tree.label, 'aaaaaaaaaaaa')), tree)).toContain("the page's package hash is not the card's")
  })

  test('a page that could not be read is not ready', () => {
    expect(pageGap(null, realTree())).toBe('the page could not be read to compare')
  })

  test('a line the card lacks is named by its first 60 characters, on one line', () => {
    const long = `Only OW prints this line ${'x'.repeat(100)}`
    expect(pageGap(`${long}\n\nAnother line the card lacks`, cardWith('something else'))).toBe(MISSING(long))
  })

  test('fences: a line inside is a body, even one that reads as structure, and a longer fence holds a shorter one', () => {
    expect(pageGap(fence('### Their message'), cardOf(para('### Their message', 'rp-body')))).toBe('')
    expect(pageGap(fence('### Their message'), cardWith('nothing like it'))).toBe(MISSING('### Their message'))
    expect(pageGap('````text\n```\nkept words here now\n```\n````', cardOf(para('```\nkept words here now\n```', 'rp-body')))).toBe('')
  })

  test('drawnText is what the pane draws: never a link\'s address behind its words, never a button', () => {
    const nodes: MmCardNode[] = [{ r: [{ s: 'the plan', href: 'https://example.com/plan' }] }, { btn: 'Read it', ask: 'x' }]
    expect(drawnText(nodes)).toBe('the plan')
  })
})
