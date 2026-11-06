import { describe, expect, test } from 'claude-code/testing'

import type { MmCard, MmCardTree } from '../types'
import {
  NO_CARD, SIGN_FILL_MS, copyCheck, currentOf, drawCard, fnv1a, holdOf, holdText, isFresh, noteCurrent, prepareCard, pressSign, printedTags, readTree,
  signOf, signatureSvg,
} from './card'
import { SMS_TREE } from './card-fixture.test-helper'
import { ME, fakeApp, mm, pid, press } from './fake-app.test-helper'
import type { Feed } from './queue'

const tree = (): MmCardTree => readTree(JSON.parse(JSON.stringify(SMS_TREE))) as MmCardTree
const SHA = SMS_TREE.package_sha256
const LABEL = SMS_TREE.label
const OTHER = 'f'.repeat(64)

/** A card in this thread's pane, as the bridge writes it after a pickup read. */
const cardOf = (over: Partial<MmCard> = {}): MmCard => ({
  packageId: SMS_TREE.package_id, projectId: SMS_TREE.project_id, client: 'Example Dental', own: true, current: SHA, tree: tree(), status: 'ready', at: 0, ...over,
})

/** The pickup page's closing line, as client-reply-prep §9.3 prints it. */
const CLOSING = `One go sends 1 item. Package \`${LABEL}\`.`

/** Every string the drawing holds, in order (the elements are the fake's: plain data, children nested). */
function texts(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const n of node) texts(n, out)
    return out
  }
  if (typeof node === 'object') {
    const o = node as { props?: Record<string, unknown>; children?: unknown }
    if (typeof o.props?.label === 'string') out.push(`[${o.props.label}]`)
    texts(o.props?.children, out)
    texts(o.children, out)
  }
  return out
}

/** The buttons of a drawing, by label. */
function buttons(node: unknown, out = new Map<string, () => void>()): Map<string, () => void> {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) buttons(n, out)
    return out
  }
  const o = node as { props?: Record<string, unknown>; children?: unknown; onPress?: unknown }
  const onPress = o.onPress ?? o.props?.onPress
  if (typeof o.props?.label === 'string' && typeof onPress === 'function') out.set(o.props.label, onPress as () => void)
  buttons(o.props?.children, out)
  buttons(o.children, out)
  return out
}

const ELS = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg' } as never

/** A thread's `$` for the card alone: its state, a clock whose timers run when told, and a prompt box. */
function thread(box = '') {
  const state = new Map<string, unknown>()
  const timers: Array<{ at: number; fn: () => unknown }> = []
  let time = 1_000_000
  const fills: string[] = []
  const $ = {
    state: {
      get: async (ref: { key: string }) => ({ value: state.get(ref.key), version: 1 }),
      set: async (ref: { key: string }, value: unknown) => {
        state.set(ref.key, value)
        return { isSet: true, version: 2 }
      },
    },
    clock: {
      now: async () => time,
      after: async (ms: number, fn: () => unknown) => void timers.push({ at: time + ms, fn }),
    },
    prompt: {
      read: async () => ({ text: box, cursor: 0 }),
      fill: async (input: { text: string }) => {
        fills.push(input.text)
        return { isFilled: true, text: input.text, cursor: input.text.length }
      },
    },
    process: { run: async () => ({ exitCode: 0, stdout: JSON.stringify(SMS_TREE), stderr: '' }) },
  }
  return {
    $: $ as never,
    state,
    fills,
    advance: async (ms: number) => {
      time += ms
      const due = timers.filter(x => x.at <= time)
      for (const t of due) timers.splice(timers.indexOf(t), 1)
      for (const t of due) await t.fn()
    },
  }
}

describe('0.7.26 the card the renderer draws, read and checked here', () => {
  test('the fingerprint is the renderer\'s FNV-1a over UTF-8, accents, curly quotes, CJK, emoji and line breaks included', () => {
    // the values render_visual.py's fp() gives for the same strings
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('Hi Dana')).toBe('3054a788')
    expect(fnv1a('café ✓')).toBe('c8c613d2')
    expect(fnv1a('“quoted” — 日本 😀')).toBe('a3f299f1')
    expect(fnv1a('line one\nline two')).toBe('6917dbef')
  })

  test('the renderer\'s tree for the synthetic text package reads whole, passes the copy check and offers its signature', () => {
    const t = tree()
    expect(t.package_sha256).toBe(SHA)
    expect(t.label).toBe(LABEL)
    expect(t.blocks).toBe(9)
    expect(copyCheck(t)).toBe(true)
    expect(signOf(t)).toEqual({ label: LABEL, signer: 'Test Signer' })
  })

  test('one changed word, or a block left out, fails the copy check', () => {
    const changed = tree()
    const bubble = JSON.stringify(changed).replace('Saturday 9 to 1 shows on it.', 'Saturday 9 to 2 shows on it.')
    expect(copyCheck(readTree(JSON.parse(bubble)) as MmCardTree)).toBe(false)
    const fewer = tree()
    fewer.blocks += 1
    expect(copyCheck(fewer)).toBe(false)
  })

  test('anything the renderer did not write is refused: another version, a tag that is not the hash\'s, a script link', () => {
    expect(readTree({ ...SMS_TREE, v: 2 })).toBeNull()
    expect(readTree({ ...SMS_TREE, nodes: [{ sign: { label: 'nothex', signer: 'x' } }] })).toBeNull()
    expect(readTree({ ...SMS_TREE, label: '0123456789ab' })?.label).toBe('')
    const link = readTree({ ...SMS_TREE, nodes: [{ r: [{ s: 'open', href: 'javascript:alert(1)' }] }] })
    expect(link?.nodes[0]?.r?.[0]).toEqual({ s: 'open' })
    expect(readTree(null)).toBeNull()
    expect(readTree('{}')).toBeNull()
  })

  test('fresh only when drawn from the package as it stands: OW\'s full hash, or the 12 of a page drawn on this computer', () => {
    expect(isFresh(tree(), SHA)).toBe(true)
    expect(isFresh(tree(), LABEL)).toBe(true)
    expect(isFresh(tree(), OTHER)).toBe(false)
    expect(isFresh(tree(), 'ffffffffffff')).toBe(false)
    expect(isFresh(tree(), null)).toBe(false)
    expect(isFresh(null, SHA)).toBe(false)
    // the pickup read's hash wins over the page's own tag
    noteCurrent('11111111-1111-4111-8111-111111111111', OTHER)
    expect(currentOf('11111111-1111-4111-8111-111111111111', `# A\n\nPackage \`${LABEL}\`.`)).toBe(OTHER)
    expect(currentOf('22222222-2222-4222-8222-222222222222', `# A\n\nOne go sends 1 item. Package \`${LABEL}\`.`)).toBe(LABEL)
    expect(currentOf('33333333-3333-4333-8333-333333333333', null)).toBeNull()
  })

  test('the tags of the pages a response printed are read off their closing lines, and nothing else', () => {
    expect(printedTags(`…\n\n${CLOSING}`)).toEqual([LABEL])
    expect(printedTags('One go sends all 3 items now and schedules 2 follow-ups. Package `0123456789ab`.')).toEqual(['0123456789ab'])
    expect(printedTags('One go closes this package: no reply needed. Package `abcdefabcdef`.')).toEqual(['abcdefabcdef'])
    expect(printedTags(`The old tag was Package \`${LABEL}\`.`)).toEqual([])
    expect(printedTags('Send package 3f1c9a7e5b2d')).toEqual([])
  })
})

describe('0.7.26 when the pane offers the signature box', () => {
  const marks = (printed: string[] = [LABEL]) => ({ printed, signed: {} })

  test('only with every hold clear, and each hold says why', () => {
    expect(holdOf(cardOf(), marks())).toBe('')
    expect(holdOf(cardOf({ current: OTHER }), marks())).toBe('stale')
    expect(holdOf(cardOf({ own: false }), marks())).toBe('not-own')
    expect(holdOf(cardOf(), marks([]))).toBe('not-printed')
    const drift = tree()
    ;(drift.nodes[1]?.k?.[0]?.r?.[0] as { s: string }).s += ' (edited)'
    expect(holdOf(cardOf({ tree: drift }), marks())).toBe('drift')
    expect(holdText('stale', cardOf({ current: OTHER }), LABEL)).toBe(`This card was drawn from package ${LABEL}; the package is now ffffffffffff. Drawing it again…`)
    expect(holdText('not-printed', cardOf(), LABEL)).toBe(`Signing opens once this thread prints the package's page (Package ${LABEL}). Ask it to show the package.`)
    expect(holdText('not-own', cardOf(), LABEL)).toBe("Sign in Example Dental's own thread. This card is here to read.")
  })

  test('the renderer\'s own holds stay: a card it drew with no signature box offers none here either', () => {
    const held = tree()
    const go = held.nodes.at(-1) as { k: Array<{ k?: unknown[] }> }
    go.k = [go.k[0] as never, { c: 'rp-banner rp-bad', r: [{ s: 'Not ready for the go: 1 of 2 questions are not answered in the drafts.' }] }, { btn: 'Fix these first ↗', ask: `Fix what blocks package ${LABEL} before the go.` }] as never
    expect(signOf(held)).toBeNull()
    expect(holdOf(cardOf({ tree: held }), marks())).toBe('no-sign')
    const drawn = drawCard(ELS, { card: cardOf({ tree: held }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect(texts(drawn).join(' ')).toContain('Not ready for the go')
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect([...buttons(drawn).keys()]).toContain('Fix these first ↗')
  })

  test('drawn: the client\'s text, our reply, the checks and the box, with the words it puts in the prompt box', () => {
    const drawn = drawCard(ELS, { card: cardOf(), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    const all = texts(drawn).join('\n')
    expect(all).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
    expect(all).toContain('Hi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off.')
    expect(all).toContain('Is the new booking link live yet?')
    expect(all).toContain(`One go sends 1 item. Package ${LABEL}.`)
    expect(all).toContain(`Signing puts "Send package ${LABEL}" in your prompt box; Enter sends it. Changes go in the chat box as usual.`)
    expect([...buttons(drawn).keys()]).toContain('✍  Click to sign and send')
  })

  test('a changed package: the card stays drawn, without the box, saying the package moved on', () => {
    const drawn = drawCard(ELS, { card: cardOf({ current: OTHER, status: 'rendering' }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).toContain(`This card was drawn from package ${LABEL}; the package is now ffffffffffff.`)
  })
})

describe('0.7.26 signing: the name, the envelope, then exactly the go in the prompt box, never a send', () => {
  test('a press records the signature; when the envelope has flown, "Send package <12>" is in the prompt box, once', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { printed: [LABEL], signed: {} })
    await pressSign(t.$, LABEL)
    const signed = (t.state.get('cardMarks') as { signed: Record<string, { signer: string; filled?: string }> }).signed[LABEL]
    expect(signed?.signer).toBe('Test Signer')
    expect(signed?.filled).toBeUndefined()
    expect(t.fills).toEqual([])
    await t.advance(SIGN_FILL_MS - 1)
    expect(t.fills).toEqual([])
    await t.advance(1)
    expect(t.fills).toEqual([`Send package ${LABEL}`])
    expect((t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }).signed[LABEL]?.filled).toBe('filled')
    // a second press does nothing
    await pressSign(t.$, LABEL)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([`Send package ${LABEL}`])
  })

  test('a draft of the person\'s in the box is never written over: the pane says what to type', async () => {
    const t = thread('a note I was writing')
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { printed: [LABEL], signed: {} })
    await pressSign(t.$, LABEL)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    const m = t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }
    expect(m.signed[LABEL]?.filled).toBe('draft')
    const drawn = drawCard(ELS, { card: cardOf(), marks: m as never, now: 1_000_000 + 10_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect(texts(drawn).join(' ')).toContain(`Sealed. Your prompt box holds a draft, so type: Send package ${LABEL}`)
  })

  test('the package changes while the envelope flies: nothing goes in the box', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { printed: [LABEL], signed: {} })
    await pressSign(t.$, LABEL)
    t.state.set('card', cardOf({ current: OTHER }))
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect((t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }).signed[LABEL]?.filled).toBe('stale')
  })

  test('no signature where the pane holds it back: another client\'s part, a page not printed here, a stale card', async () => {
    for (const [card, printed] of [[cardOf({ own: false }), [LABEL]], [cardOf(), []], [cardOf({ current: OTHER }), [LABEL]]] as const) {
      const t = thread()
      t.state.set('card', card)
      t.state.set('cardMarks', { printed, signed: {} })
      await pressSign(t.$, LABEL)
      await t.advance(SIGN_FILL_MS)
      expect(t.fills).toEqual([])
      expect((t.state.get('cardMarks') as { signed: Record<string, unknown> }).signed).toEqual({})
    }
  })

  test('the signature SVG carries the name escaped, and no script', () => {
    const svg = signatureSvg('Dana <script>alert(1)</script> & Co', false)
    expect(svg).toContain('Dana &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co')
    expect(svg).not.toContain('<script')
    expect(signatureSvg('Rob Eason', true)).not.toContain('<animate')
  })
})

describe('0.7.26 prepared on arrival: the renderer runs once a package version, on this computer', () => {
  test('a pickup read with the hash: the card is drawn from render_visual.py --tree and kept; the next read reuses it', async () => {
    const t = thread()
    const runs: string[][] = []
    ;(t.$ as unknown as { process: { run: (argv: string[]) => Promise<unknown> } }).process.run = async (argv: string[]) => {
      runs.push(argv)
      return { exitCode: 0, stdout: JSON.stringify(SMS_TREE), stderr: '' }
    }
    const f = { packageId: SMS_TREE.package_id, projectId: SMS_TREE.project_id, client: 'Example Dental', own: true, current: SHA, signer: 'Owner', home: '/home/someone', isNewest: async () => true }
    await prepareCard(t.$, f)
    expect(runs).toEqual([['python3', '/home/someone/.claude/skills/client-reply-prep/scripts/render_visual.py', '--package', SMS_TREE.package_id, '--signer', 'Owner', '--tree', '-']])
    expect((t.state.get('card') as MmCard).status).toBe('ready')
    expect((t.state.get('card') as MmCard).tree?.label).toBe(LABEL)
    await prepareCard(t.$, f)
    expect(runs.length).toBe(1)
  })

  test('an older client-reply-prep on this computer (no --tree): the card says so, and the page stands alone', async () => {
    const t = thread()
    ;(t.$ as unknown as { process: { run: () => Promise<unknown> } }).process.run = async () => ({ exitCode: 2, stdout: '', stderr: 'render_visual.py: error: unrecognized arguments: --tree -' })
    await prepareCard(t.$, { packageId: '44444444-4444-4444-8444-444444444444', projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, signer: 'Owner', home: '/h', isNewest: async () => true })
    const card = t.state.get('card') as MmCard
    expect(card.status).toBe('failed')
    expect(card.error).toBe('this computer has an older client-reply-prep (the skill sync brings the card)')
    expect(card.tree).toBeNull()
  })

  test('a newer draw of the client part meanwhile: this one writes nothing', async () => {
    const t = thread()
    await prepareCard(t.$, { packageId: '55555555-5555-4555-8555-555555555555', projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, signer: 'Owner', home: '/h', isNewest: async () => false })
    expect(t.state.get('card')).toBeUndefined()
    expect(NO_CARD.packageId).toBe('')
  })
})

describe('0.7.26 in the bridge: the pane draws the card above the page as the client part shows a package', () => {
  test('Drafts on a row: the pane reads the package, draws its card from the renderer, and offers no signature outside that client\'s own thread', async () => {
    // a package id of its own: the card kept for the fixture's id by the tests above would be reused (as it should)
    const PKG = '66666666-6666-4666-8666-666666666666'
    const feed: Feed = {
      member: ME, role: 'builder', tickets: {}, threads: [], mail: [],
      drafts: [{ package_id: PKG, project_id: pid(1), project_name: 'Example Dental', status: 'prepared', covers_through: new Date(Date.parse('2026-10-13T11:00:00Z')).toISOString(), drafts_ready: 1, project_owner_email: ME }],
    }
    const w = fakeApp(feed, [{ sessionId: 'local_hub', title: 'Morning hub' }])
    const hub = w.session('local_hub') as unknown as { process: { run: (argv: string[]) => Promise<unknown> }; http: { fetch: (url: string) => Promise<unknown> } }
    const ran: string[][] = []
    hub.process.run = async (argv: string[]) => {
      ran.push(argv)
      return argv.some(a => a.endsWith('render_visual.py')) ? { exitCode: 0, stdout: JSON.stringify(SMS_TREE), stderr: '' } : { exitCode: 1, stdout: '', stderr: '' }
    }
    const fetch = hub.http.fetch
    hub.http.fetch = async (url: string) =>
      url.includes('/reply-package') ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ markdown: `## Example Dental\n\n${CLOSING}`, package_sha256: SHA }) } : fetch(url)
    await mm(hub, '')
    expect(await press(hub, `drafts:${pid(1)}`)).toBe(true)
    expect(ran.filter(a => a.some(x => x.endsWith('render_visual.py'))).length).toBe(1)
    const card = w.view('local_hub', 'card') as MmCard
    expect(card.status).toBe('ready')
    expect(card.own).toBe(false)
    expect(card.current).toBe(SHA)
  })
})
