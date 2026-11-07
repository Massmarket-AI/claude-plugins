import { describe, expect, test } from 'claude-code/testing'

import type { MmCard, MmCardMarks, MmCardTree } from '../types'
import {
  NOT_DRAWN, NO_CARD, SIGN_FILL_MS, SIGN_VALID_MS, cardVerdict, copyCheck, currentOf, drawCard, fnv1a, holdOf, holdText, isFresh, noteCurrent, prepareCard, pressSign, readTree,
  refreshCard, sha256Hex, signOf, signatureLine, signatureSvg,
} from './card'
import { drawnText } from './card-parity'
import { CARD_PAIRS } from './card-pairs.test-helper'
import { SMS_PAGE, SMS_TREE } from './card-fixture.test-helper'
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

const TRANSCRIPT = 'c0ffee00-1111-4222-8333-444444444444'
const HOME = '/home/someone'
const SIGNED_FILE = `${HOME}/.claude/mm-hooks/card-signed.jsonl`

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
  const files = new Map<string, string>()
  const ran: string[][] = []
  const notes: string[] = []
  /** What the page read gives a press, and what the renderer draws on this computer. */
  const now = { page: { markdown: SMS_PAGE as string | null, sha: SHA as string | null }, render: JSON.stringify(SMS_TREE), session: TRANSCRIPT }
  const $ = {
    session: { id: async () => now.session },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return text
      },
      write: async (path: string, text: string) => void files.set(path, text),
      stat: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error(`ENOENT: no such file or directory, stat '${path}'`)
        return { kind: 'file', size: text.length, mtimeMs: 0, isLink: false }
      },
    },
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
    process: {
      run: async (argv: string[]) => {
        ran.push(argv)
        return { exitCode: 0, stdout: now.render, stderr: '' }
      },
    },
  }
  return {
    $: $ as never,
    state,
    fills,
    files,
    ran,
    notes,
    now,
    setTime: (at: number) => {
      time = at
    },
    log: { home: HOME, note: async (line: string) => void notes.push(line), readPage: async () => now.page },
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
    expect(t.blocks).toBe(12)
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
})

describe('0.7.26 when the pane offers the signature box', () => {
  const marks = () => ({ signed: {} })

  test('only with every hold clear, and each hold says why', () => {
    expect(holdOf(cardOf())).toBe('')
    expect(holdOf(cardOf({ current: OTHER }))).toBe('stale')
    expect(holdOf(cardOf({ own: false }))).toBe('not-own')
    expect(holdOf(cardOf({ gap: 'the page holds a line the card does not (x)' }))).toBe('page')
    const drift = tree()
    ;(drift.nodes[1]?.k?.[0]?.r?.[0] as { s: string }).s += ' (edited)'
    expect(holdOf(cardOf({ tree: drift }))).toBe('drift')
    expect(holdText('stale', cardOf({ current: OTHER }), LABEL)).toBe(`This card was drawn from package ${LABEL}; the package is now ffffffffffff. Drawing it again…`)
    expect(holdText('not-own', cardOf(), LABEL)).toBe("Sign in Example Dental's own thread. This card is here to read.")
    expect(holdText('page', cardOf(), LABEL)).toBe('This view does not match the stored drafts, so signing is off here. Go by the page printed in the thread.')
  })

  test('(0.7.33) no page need be printed here: the box opens on a fresh card of the thread\'s own client', () => {
    const drawn = drawCard(ELS, { card: cardOf(), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).not.toContain('Signing opens once')
  })

  test('(0.7.33) the page holds a line the card does not: the box stays closed, and the note says to go by the page the thread prints', () => {
    const drawn = drawCard(ELS, { card: cardOf({ gap: 'the page holds a line the card does not (x)' }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).toContain('Go by the page printed in the thread.')
  })

  test('(0.7.33) a card that could not be drawn: the pane says one plain line, never the error or a path', () => {
    const raw = 'Traceback: /Users/someone/.claude/skills/client-reply-prep/scripts/render_visual.py line 12'
    const drawn = drawCard(ELS, { card: cardOf({ tree: null, status: 'failed', error: raw }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect(texts(drawn)).toEqual([NOT_DRAWN])
    expect(NOT_DRAWN).toBe('The card could not be drawn on this computer. Your thread prints the whole package instead.')
    // nor when a card older than the package stays drawn
    const stale = holdText('stale', cardOf({ current: OTHER, status: 'failed', error: raw }), LABEL)
    expect(stale).toBe(`This card was drawn from package ${LABEL}; the package is now ffffffffffff, and it could not be drawn again here. Go by the page printed in the thread.`)
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
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
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
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([`Send package ${LABEL}`])
  })

  test('a draft of the person\'s in the box is never written over: the pane says what to type', async () => {
    const t = thread('a note I was writing')
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
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
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    t.state.set('card', cardOf({ current: OTHER }))
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect((t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }).signed[LABEL]?.filled).toBe('stale')
  })

  test('no signature where the pane holds it back: another client\'s part, a stale card, a page line the card lacks', async () => {
    for (const card of [cardOf({ own: false }), cardOf({ current: OTHER }), cardOf({ gap: 'the page holds a line the card does not (x)' })]) {
      const t = thread()
      t.state.set('card', card)
      t.state.set('cardMarks', { signed: {} })
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.fills).toEqual([])
      expect((t.state.get('cardMarks') as { signed: Record<string, unknown> }).signed).toEqual({})
      expect(t.files.size).toBe(0)
    }
  })

  /**
   * ⛔ The send gate's own check of one line, as global-config/hooks/send-gate.js has it (`cardRecordOk`, and in `cardGoRefusal`
   * the session, the hash, and the label as the hash's first 12): a line that fails any of these reads as "the card was not
   * signed", so every go through the card would ask. If the gate changes, this changes with it.
   */
  const gateTakes = (r: Record<string, unknown>, session: string, sha: string): boolean =>
    r.v === 1 &&
    typeof r.session_id === 'string' && r.session_id !== '' && r.session_id === session &&
    typeof r.package_id === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(r.package_id) &&
    typeof r.package_sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.package_sha256) && r.package_sha256 === sha &&
    typeof r.page_sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.page_sha256) &&
    typeof r.label === 'string' && r.label === sha.slice(0, 12) &&
    typeof r.signer === 'string' && r.signer.trim() !== '' &&
    typeof r.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]00:?00)$/.test(r.at) && !Number.isNaN(Date.parse(r.at))

  test('(0.7.33) a press records the signature for the send gate, parsed as the gate parses it, before the words go in the prompt box', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    await pressSign(t.$, LABEL, t.log)
    expect(t.fills).toEqual([])
    const text = t.files.get(SIGNED_FILE) ?? ''
    expect(text.endsWith('\n')).toBe(true)
    const lines = text.split('\n').filter(line => line.trim())
    expect(lines.length).toBe(1)
    const record = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(gateTakes(record, TRANSCRIPT, SHA)).toBe(true)
    expect(record).toEqual({ v: 1, session_id: TRANSCRIPT, package_id: SMS_TREE.package_id, package_sha256: SHA, page_sha256: await sha256Hex(SMS_PAGE), label: LABEL, signer: 'Test Signer', at: new Date(1_000_000).toISOString() })
    // ⛔ the transcript's id the hook payload carries, never the app's
    expect(String(record.session_id).startsWith('local_')).toBe(false)
    // 0600 right after the write
    expect(t.ran.at(-1)).toEqual(['chmod', '600', SIGNED_FILE])
    expect(t.notes).toEqual([])
    // and the person's words are exactly the go the gate clears, nothing more
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([`Send package ${SHA.slice(0, 12)}`])
  })

  test('(0.7.33) the file keeps the newest 200 records, and what is already in it', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    const older = Array.from({ length: 205 }, (_, i) => JSON.stringify({ v: 1, n: i }))
    t.files.set(SIGNED_FILE, `${older.join('\n')}\n`)
    await pressSign(t.$, LABEL, t.log)
    const lines = (t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean)
    expect(lines.length).toBe(200)
    expect(JSON.parse(lines[0] as string).n).toBe(6)
    expect(JSON.parse(lines[199] as string).label).toBe(LABEL)
  })

  /**
   * ⛔ The send gate's pinned example, copied as it stands from global-config/hooks/fixtures/ in the control tower: its tests
   * run these exact bytes through the real gate, and this one has the bridge write them, so the two cannot drift.
   */
  const PINNED_LINE = '{"v":1,"session_id":"11111111-2222-4333-8444-555555555555","package_id":"66666666-7777-4888-8999-aaaaaaaaaaaa","package_sha256":"0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9","page_sha256":"0cc270fe28406aeac526872993f4936e5b8e5040d37575eb5d6d649bf40ee977","label":"0a1b2c3d4e5f","signer":"Example Signer","at":"2026-11-06T16:00:00.000Z"}\n'
  const PINNED_PAGE = "## Example Client · reply package · Package 0a1b2c3d4e5f\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | Is Thursday still on? | \"Yes, Thursday at 2 PM ET\" | ✅ |\n\n### Their message\nEverything since our last reply, Mon Oct 19, 9:12 AM ET: the café plan.\n\n#### Example Person · Mon Oct 19, 9:12 AM ET · gmail\nTo: support@letaidothehardwork.com · Subject: Thursday\n> ```text\n> Is Thursday still on?\n> ```\n\n### Client reply\n\n#### 1. Re: Thursday\n**To:** person@client.example · **Cc:** (none) · **Subject:** Re: Thursday — the café · **From:** support@letaidothehardwork.com · **Channel:** gmail · hash `aaaaaaaaaaaa`\n```text\nHi there,\n\nYes, Thursday at 2 PM ET, at the café.\n\nRob\n```\n\n### Team post\n_No team post in this package._\n\n### Links\n- none\n\n### Findings\n- Nothing to decide.\n\nOne go sends 1 item. Package 0a1b2c3d4e5f.\n"

  test('(0.7.33) the record is, byte for byte, the send gate\'s pinned example, and page_sha256 the exact bytes of the page', async () => {
    const r = JSON.parse(PINNED_LINE) as { session_id: string; package_id: string; package_sha256: string; signer: string; at: string; page_sha256: string }
    expect(await sha256Hex(PINNED_PAGE)).toBe(r.page_sha256)
    expect(`${await signatureLine({ sessionId: r.session_id, packageId: r.package_id, sha: r.package_sha256, markdown: PINNED_PAGE, signer: r.signer, at: Date.parse(r.at) })}\n`).toBe(PINNED_LINE)
  })

  test('(0.7.33) page_sha256 is over UTF-8 bytes, not characters', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
  })

  test('(0.7.33) finding 10: a record that cannot be written records nothing, puts no words in the box, and the box says to try again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    ;(t.$ as unknown as { fs: { write: () => Promise<void> } }).fs.write = async () => {
      throw new Error('EACCES: no write here')
    }
    await pressSign(t.$, LABEL, t.log)
    expect(t.notes).toEqual([`card signature for package ${SMS_TREE.package_id} not recorded: EACCES: no write here`])
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.signed).toEqual({})
    expect(marks.notice?.kind).toBe('retry')
    const drawn = texts(drawCard(ELS, { card: t.state.get('card') as MmCard, marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
    expect(drawn).toContain('That did not go through, so nothing was signed. Try again, or ask your thread to print the page.')
    expect(drawn).toContain('[✍  Click to sign and send]')
  })

  test('(0.7.33) finding 10: a read error leaves the record file as it was, with no new line, and the box says to try again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    const before = '{"v":1,"kept":true}\n'
    t.files.set(SIGNED_FILE, before)
    ;(t.$ as unknown as { fs: { read: () => Promise<string> } }).fs.read = async () => {
      throw new Error('EIO: i/o error')
    }
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.get(SIGNED_FILE)).toBe(before)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('retry')
    expect(t.notes.join('\n')).toContain('EIO')
  })

  test('(0.7.33) finding 10: a stat that fails for any reason but a missing file is no first signature: nothing is written', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    ;(t.$ as unknown as { fs: { stat: () => Promise<never> } }).fs.stat = async () => {
      throw new Error('EACCES: no looking here')
    }
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('retry')
  })

  test('(0.7.33) finding 10: a file too large to read whole is left alone, and nothing is signed', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    const before = 'x'.repeat(10)
    t.files.set(SIGNED_FILE, before)
    ;(t.$ as unknown as { fs: { stat: () => Promise<unknown> } }).fs.stat = async () => ({ kind: 'file', size: 5 * 1024 * 1024, mtimeMs: 0, isLink: false })
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.get(SIGNED_FILE)).toBe(before)
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('retry')
    expect(t.notes.join('\n')).toContain('too large')
  })

  test('(0.7.33) finding 10: a symlink at the record path is refused before any write: its target is never truncated', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    ;(t.$ as unknown as { fs: { stat: () => Promise<unknown> } }).fs.stat = async () => ({ kind: 'other', size: 0, mtimeMs: 0, isLink: true })
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('retry')
    expect(t.notes.join('\n')).toContain('not a regular file')
  })

  test('(0.7.33) finding 10: past 2 hours a signature no longer stands: the box says Sign, never Sealed, and a press signs again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills.length).toBe(1)
    const draw = (now: number) => texts(drawCard(ELS, { card: t.state.get('card') as MmCard, marks: t.state.get('cardMarks') as MmCardMarks, now, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
    const signedAt = (t.state.get('cardMarks') as MmCardMarks).signed[LABEL]?.at as number
    expect(draw(signedAt + SIGN_VALID_MS - 1)).toContain('Sealed')
    expect(draw(signedAt + SIGN_VALID_MS)).not.toContain('Sealed')
    expect(draw(signedAt + SIGN_VALID_MS)).toContain('[✍  Click to sign and send]')
    // before then a second press does nothing; after, it writes a new record
    await pressSign(t.$, LABEL, t.log)
    expect((t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean).length).toBe(1)
    await t.advance(SIGN_VALID_MS)
    await pressSign(t.$, LABEL, t.log)
    expect((t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean).length).toBe(2)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills.length).toBe(2)
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
    const id = '77777777-1111-4222-8333-444444444444'
    const runs: string[][] = []
    ;(t.$ as unknown as { process: { run: (argv: string[]) => Promise<unknown> } }).process.run = async (argv: string[]) => {
      runs.push(argv)
      return { exitCode: 0, stdout: JSON.stringify(SMS_TREE), stderr: '' }
    }
    const f = { packageId: id, projectId: SMS_TREE.project_id, client: 'Example Dental', own: true, current: SHA, page: SMS_PAGE, signer: 'Owner', home: '/home/someone', note: async () => undefined, isNewest: async () => true }
    await prepareCard(t.$, f)
    expect(runs).toEqual([['python3', '/home/someone/.claude/skills/client-reply-prep/scripts/render_visual.py', '--package', id, '--signer', 'Owner', '--tree', '-']])
    expect((t.state.get('card') as MmCard).status).toBe('ready')
    expect((t.state.get('card') as MmCard).tree?.label).toBe(LABEL)
    await prepareCard(t.$, f)
    expect(runs.length).toBe(1)
  })

  test('an older client-reply-prep on this computer (no --tree): the card says so, and the page stands alone', async () => {
    const t = thread()
    ;(t.$ as unknown as { process: { run: () => Promise<unknown> } }).process.run = async () => ({ exitCode: 2, stdout: '', stderr: 'render_visual.py: error: unrecognized arguments: --tree -' })
    await prepareCard(t.$, { packageId: '44444444-4444-4444-8444-444444444444', projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, page: SMS_PAGE, signer: 'Owner', home: '/h', note: t.log.note, isNewest: async () => true })
    const card = t.state.get('card') as MmCard
    expect(card.status).toBe('failed')
    expect(card.error).toBe('this computer has an older client-reply-prep (the skill sync brings the card)')
    expect(card.tree).toBeNull()
    expect(t.notes).toEqual(['card for package 44444444-4444-4444-8444-444444444444 could not be drawn: this computer has an older client-reply-prep (the skill sync brings the card)'])
  })

  test('(0.7.33) the raw error goes in the log once a reason, and never what it quotes of the package', async () => {
    const t = thread()
    ;(t.$ as unknown as { process: { run: () => Promise<unknown> } }).process.run = async () => ({ exitCode: 1, stdout: '', stderr: 'no open package: http 500 {"client_words":"made-up words"}' })
    const f = { packageId: '77777777-7777-4777-8777-777777777777', projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, page: SMS_PAGE, signer: 'Owner', home: '/h', note: t.log.note, isNewest: async () => true }
    await prepareCard(t.$, f)
    await prepareCard(t.$, f)
    expect(t.notes).toEqual(['card for package 77777777-7777-4777-8777-777777777777 could not be drawn: no open package: http 500'])
  })

  test('(0.7.33) the card is checked against the page it was read with: a line it lacks closes its box, and only a card as it stands is checked', async () => {
    const t = thread()
    const packageId = '88888888-8888-4888-8888-888888888888'
    const f = { packageId, projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, page: SMS_PAGE, signer: 'Owner', home: '/h', note: t.log.note, isNewest: async () => true }
    await prepareCard(t.$, f)
    expect((t.state.get('card') as MmCard).gap).toBeUndefined()
    expect(holdOf(t.state.get('card') as MmCard)).toBe('')
    await prepareCard(t.$, { ...f, page: `${SMS_PAGE}\n\nA line only OW prints.` })
    expect((t.state.get('card') as MmCard).gap).toBe('the page holds a line the card does not (A line only OW prints.)')
    expect(holdOf(t.state.get('card') as MmCard)).toBe('page')
    await prepareCard(t.$, { ...f, page: null })
    expect((t.state.get('card') as MmCard).gap).toBe('the page could not be read to compare')
  })

  test('a newer draw of the client part meanwhile: this one writes nothing', async () => {
    const t = thread()
    await prepareCard(t.$, { packageId: '55555555-5555-4555-8555-555555555555', projectId: SMS_TREE.project_id, client: 'X', own: true, current: SHA, page: SMS_PAGE, signer: 'Owner', home: '/h', note: async () => undefined, isNewest: async () => false })
    expect(t.state.get('card')).toBeUndefined()
    expect(NO_CARD.packageId).toBe('')
  })
})

describe('0.7.33 what `mm card` says of a card', () => {
  test('ready only for that package\'s card, drawn, with nothing holding its box back; each other case in plain words', () => {
    const id = SMS_TREE.package_id
    expect(cardVerdict(cardOf(), id)).toBe('')
    expect(cardVerdict(cardOf(), '99999999-9999-4999-8999-999999999999')).toBe('the side pane is not showing this package')
    expect(cardVerdict(NO_CARD, id)).toBe('the side pane is not showing this package')
    expect(cardVerdict(cardOf({ status: 'rendering' }), id)).toBe('the card is still being drawn')
    const raw = 'Traceback /Users/someone/x.py'
    expect(cardVerdict(cardOf({ status: 'failed', error: raw, tree: null }), id)).toBe('the card could not be drawn on this computer')
    expect(cardVerdict(cardOf({ current: OTHER }), id)).toBe('the card was drawn from an older version of this package')
    expect(cardVerdict(cardOf({ current: null }), id)).toBe('OW gave no usable hash for this package')
    expect(cardVerdict(cardOf({ own: false }), id)).toBe("this is not the client's own thread")
    const drift = tree()
    ;(drift.nodes[1]?.k?.[0]?.r?.[0] as { s: string }).s += ' (edited)'
    expect(cardVerdict(cardOf({ tree: drift }), id)).toBe('the card does not match the stored drafts')
    const held = tree()
    const go = held.nodes.at(-1) as { k: Array<{ k?: unknown[] }> }
    go.k = [go.k[0] as never]
    expect(cardVerdict(cardOf({ tree: held }), id)).toBe('the card offers no signature box for this package')
    expect(cardVerdict(cardOf({ gap: 'the page holds a line the card does not (x)' }), id)).toBe('the page holds a line the card does not (x)')
  })

})

describe('0.7.33 the card\'s links: the real source, never the Onboarding Wizard', () => {
  test('a run with a link to the wizard keeps its words and loses the link, whichever renderer drew it', () => {
    const made = JSON.parse(JSON.stringify(SMS_TREE)) as { nodes: unknown[] }
    made.nodes.unshift({ r: [{ s: 'OW', href: 'https://onboarding-wizard.massmarket.ai/dashboard/projects/x' }, { s: 'Preview', href: 'https://onboarding-wizard-git-x.vercel.app/y' }, { s: 'Doc', href: 'https://x.example/onboarding-wizard' }] })
    const read = readTree(made) as MmCardTree
    expect(read.nodes[0]?.r).toEqual([{ s: 'OW' }, { s: 'Preview' }, { s: 'Doc', href: 'https://x.example/onboarding-wizard' }])
  })

  test('the pane draws a message\'s source as a link of its own, in the card that has one, and none where OW gave none', () => {
    const links = (node: unknown, out: Array<[string, string]> = []): Array<[string, string]> => {
      if (!node || typeof node !== 'object') return out
      if (Array.isArray(node)) {
        for (const n of node) links(n, out)
        return out
      }
      const o = node as { props?: Record<string, unknown>; children?: unknown }
      if (typeof o.props?.href === 'string') out.push([String(o.props.label), o.props.href])
      links(o.props?.children, out)
      links(o.children, out)
      return out
    }
    const draw = (name: string) => {
      const tree = readTree(JSON.parse(JSON.stringify(CARD_PAIRS[name]?.tree))) as MmCardTree
      return links(drawCard(ELS, { card: cardOf({ packageId: tree.package_id as string, tree }), marks: { signed: {} }, now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined }))
    }
    const got = draw('source links')
    expect(got).toContainEqual(['Open email', 'https://mail.google.com/mail/u/support@letaidothehardwork.com/#all/zz'])
    expect(got).toContainEqual(['Fireflies', 'https://app.fireflies.ai/view/zz'])
    expect(draw('everything').filter(([label]) => ['Open email', 'Fireflies', 'HighLevel'].includes(label))).toEqual([])
    expect(got.filter(([, href]) => href.includes('onboarding-wizard'))).toEqual([])
  })
})

describe('0.7.33 the card on screen is the current render: read at `mm card` and again at the press', () => {
  const id = SMS_TREE.package_id
  const RENDERER = { packageId: id, signer: 'Test Signer', home: HOME, note: async () => undefined }
  const pairOf = (name: string) => {
    const p = CARD_PAIRS[name]
    if (!p) throw new Error(name)
    const tree = readTree(JSON.parse(JSON.stringify(p.tree))) as MmCardTree
    return { page: p.page, tree, id: tree.package_id as string, sha: tree.package_sha256 as string, label: tree.label }
  }
  /** The renderer's card with its text-message body changed, as a Cc, a date or a switch change the words with no new hash. */
  const moved = () => JSON.stringify(SMS_TREE).replaceAll('Example Dental (Dana Example)', 'Example Dental (Dana Example) moved')

  test('the same words: the kept card stays, and the renderer did run', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    expect(await refreshCard(t.$, RENDERER, { markdown: SMS_PAGE, sha: SHA })).toBe('same')
    expect(t.ran.length).toBe(1)
    expect((t.state.get('card') as MmCard).gap).toBeUndefined()
    expect(cardVerdict(t.state.get('card') as MmCard, id)).toBe('')
  })

  test('finding 12: new words under the same hash replace the kept card, and the new card is what is checked', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.now.render = moved()
    expect(await refreshCard(t.$, RENDERER, { markdown: SMS_PAGE, sha: SHA })).toBe('changed')
    const now = t.state.get('card') as MmCard
    expect(JSON.stringify(now.tree)).toContain('moved')
    expect(now.gap).toContain('the page holds a line the card does not')
  })

  test('finding 3: a Cc added after plan approval, in no hash: the card drawn before it is replaced, and the box is open on the new one', async () => {
    const before = pairOf("rob's mail, plan not approved")
    const after = pairOf("rob's mail, plan approved")
    const t = thread()
    t.state.set('card', cardOf({ packageId: after.id, current: after.sha, tree: before.tree }))
    t.now.render = JSON.stringify(after.tree)
    expect(drawnText(before.tree.nodes)).not.toContain('Cc support@letaidothehardwork.com')
    expect(await refreshCard(t.$, { ...RENDERER, packageId: after.id }, { markdown: after.page, sha: after.sha })).toBe('changed')
    const now = t.state.get('card') as MmCard
    expect(now.gap).toBeUndefined()
    expect(holdOf(now)).toBe('')
    expect(drawnText(now.tree?.nodes ?? [])).toContain('Cc support@letaidothehardwork.com')
  })

  test('finding 5: the follow-up switch, in no hash: a card drawn with it off is replaced by the live one', async () => {
    const off = pairOf('follow-ups switched off')
    const live = pairOf('follow-ups live')
    const t = thread()
    t.state.set('card', cardOf({ packageId: live.id, current: live.sha, tree: off.tree }))
    t.now.render = JSON.stringify(live.tree)
    expect(await refreshCard(t.$, { ...RENDERER, packageId: live.id }, { markdown: live.page, sha: live.sha })).toBe('changed')
    const now = t.state.get('card') as MmCard
    expect(now.gap).toBeUndefined()
    expect(drawnText(now.tree?.nodes ?? [])).not.toContain('none of these steps will send')
  })

  test('finding 9: OW with no usable hash, or no page: the box closes on the kept card, with nothing drawn', async () => {
    for (const read of [{ markdown: SMS_PAGE, sha: null }, { markdown: null, sha: SHA }, { markdown: null, sha: null }]) {
      const t = thread()
      t.state.set('card', cardOf())
      expect(await refreshCard(t.$, RENDERER, read)).toBe('no-hash')
      expect(t.ran).toEqual([])
      const now = t.state.get('card') as MmCard
      expect(holdOf(now)).toBe('stale')
      expect(cardVerdict(now, id)).toBe('OW gave no usable hash for this package')
    }
  })

  test('finding 9: an answer with no hash clears the old one, so nothing can match it', () => {
    noteCurrent(id, SHA)
    expect(currentOf(id, null)).toBe(SHA)
    noteCurrent(id, null)
    expect(currentOf(id, null)).toBeNull()
    noteCurrent(id, 'not a hash')
    expect(currentOf(id, null)).toBeNull()
  })

  test('a render that fails: the card says so and its box closes', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.now.render = 'not a tree'
    expect(await refreshCard(t.$, RENDERER, { markdown: SMS_PAGE, sha: SHA })).toBe('failed')
    expect(cardVerdict(t.state.get('card') as MmCard, id)).toBe('the card could not be drawn on this computer')
  })

  test('the pane moved to another package meanwhile: nothing is written over it', async () => {
    const t = thread()
    t.state.set('card', cardOf({ packageId: '99999999-9999-4999-8999-999999999999' }))
    expect(await refreshCard(t.$, RENDERER, { markdown: SMS_PAGE, sha: SHA })).toBe('other')
    expect(t.ran).toEqual([])
  })

  test('finding 3: a press on a card whose words moved writes no record, replaces the card, and the box says to read it again', async () => {
    const before = pairOf("rob's mail, plan not approved")
    const after = pairOf("rob's mail, plan approved")
    const t = thread()
    t.state.set('card', cardOf({ packageId: after.id, current: after.sha, tree: before.tree }))
    t.now.render = JSON.stringify(after.tree)
    t.now.page = { markdown: after.page, sha: after.sha }
    await pressSign(t.$, after.label, t.log)
    expect(t.files.size).toBe(0)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.signed).toEqual({})
    expect(marks.notice).toEqual({ packageId: after.id, kind: 'changed' })
    const now = t.state.get('card') as MmCard
    expect(drawnText(now.tree?.nodes ?? [])).toContain('Cc support@letaidothehardwork.com')
    const drawn = texts(drawCard(ELS, { card: now, marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
    expect(drawn).toContain('The package changed, so nothing was signed. Read it again, then sign.')
    // read again, the next press signs, with the hash of the page that press read
    await pressSign(t.$, after.label, t.log)
    const lines = (t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean)
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0] as string).page_sha256).toBe(await sha256Hex(after.page))
    expect((t.state.get('cardMarks') as MmCardMarks).notice).toBeUndefined()
  })

  test('finding 9: a press where OW gives no usable hash records nothing, and the box says to try again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.now.page = { markdown: SMS_PAGE, sha: null }
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('retry')
  })

  test('a page read that throws: nothing recorded, the box open again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    await pressSign(t.$, LABEL, { ...t.log, readPage: async () => { throw new Error('no network') } })
    expect(t.files.size).toBe(0)
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.checking).toBeUndefined()
    expect(marks.notice?.kind).toBe('retry')
  })

  test('while a press checks the package the box waits, and a second press does nothing', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    let reads = 0
    const first = pressSign(t.$, LABEL, { ...t.log, readPage: async () => { reads += 1; await gate; return t.now.page } })
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.checking?.label).toBe(LABEL)
    expect(texts(drawCard(ELS, { card: cardOf(), marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')).toContain('Checking this is still the package…')
    await pressSign(t.$, LABEL, { ...t.log, readPage: async () => { reads += 1; return t.now.page } })
    expect(reads).toBe(1)
    release()
    await first
    expect((t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean).length).toBe(1)
  })

  test('finding 12: a kept card with a gap is drawn again for a new page, once a page, and passes when the render has caught up', async () => {
    const t = thread()
    const f = { packageId: id, projectId: SMS_TREE.project_id, client: 'Example Dental', own: true, current: SHA, signer: 'Test Signer', home: HOME, note: async () => undefined, isNewest: async () => true }
    t.state.set('card', NO_CARD)
    await prepareCard(t.$, { ...f, page: SMS_PAGE })
    const drawn = t.ran.length
    // the dates rolled: the page moved, with the same hash
    const rolled = `${SMS_PAGE}\n\nA line the kept card does not hold yet`
    await prepareCard(t.$, { ...f, page: rolled })
    expect(t.ran.length).toBe(drawn + 1)
    // the same page again: no second render for it
    await prepareCard(t.$, { ...f, page: rolled })
    expect(t.ran.length).toBe(drawn + 1)
    expect((t.state.get('card') as MmCard).gap).toContain('A line the kept card does not hold yet')
    // the page goes back: the gap goes, with no render
    await prepareCard(t.$, { ...f, page: SMS_PAGE })
    expect(t.ran.length).toBe(drawn + 1)
    expect((t.state.get('card') as MmCard).gap).toBeUndefined()
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
      url.includes('/reply-package') ? { status: 200, ok: true, headers: {}, text: JSON.stringify({ markdown: SMS_PAGE, package_sha256: SHA }) } : fetch(url)
    await mm(hub, '')
    expect(await press(hub, `drafts:${pid(1)}`)).toBe(true)
    expect(ran.filter(a => a.some(x => x.endsWith('render_visual.py'))).length).toBe(1)
    const card = w.view('local_hub', 'card') as MmCard
    expect(card.status).toBe('ready')
    expect(card.own).toBe(false)
    expect(card.current).toBe(SHA)
  })
})
