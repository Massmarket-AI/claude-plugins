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

describe('0.7.30 the card against the page: real pairs, from the two renderers themselves', () => {
  test('a text message package', () => {
    expect(contentPieces(SMS_PAGE).length).toBeGreaterThan(5)
    expect(pageGap(SMS_PAGE, realTree())).toBe('')
  })

  for (const name of ['everything', 'source links', "rob's mail, plan not approved", "rob's mail, plan approved", 'html email', 'no reply', 'closed no reply', 'later messages', 'ticket check unreadable', 'follow-ups live', 'follow-ups switched off']) {
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

describe('0.7.30 finding 6: each hole has a gap, and its control line passes', () => {
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

describe('0.7.30 finding 4: any image in a body is not ready', () => {
  const IMAGE = 'the package holds an image the side pane cannot draw'
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
  test('words about an image, and a link, are no image', () => {
    expect(holdsImage(fence('the image is attached [here](https://x.example/a.png)'), card)).toBe(false)
  })
})

describe('0.7.30 finding 5: state lines are checked both ways', () => {
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

describe('0.7.30 the normalising and the frame', () => {
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
