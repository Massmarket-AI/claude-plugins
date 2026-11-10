import { describe, expect, test } from 'claude-code/testing'

import type { MmCard, MmCardMarks, MmCardTree } from '../types'
import {
  CHECK_BUTTON, CHECK_DRAFT, CHECK_TYPE, FEEDBACK_LABEL, FEEDBACK_MAX, FEEDBACK_PLACEHOLDER, FEEDBACK_SAID, FEEDBACK_SUBMIT, FEEDBACK_TEXT, NOT_DRAWN, NO_CARD, NO_OWNER_CHECK, SIGNED_NOTE, SIGN_FILL_MS, SIGN_VALID_MS, THREAD_CHECKING, THREAD_NOT_CHECKED, askedOf, busyOf, canChange, cardDrawable, cardVerdict, checkMissOf, checkedOf, copyCheck, currentOf, drawCard, feedbackOf, fnv1a, holdOf, holdText, isChecked, isFresh, marksOf, noteAsked, noteCurrent, notePending, noteVersion, prepareCard, pressAsk, pressCheck, pressFeedback, pressSign, readTree,
  printedTags, refreshCard, sha256Hex, signOf, signatureLine, signatureSvg, standing, turnBegan, turnEnded, turnMark, type CardDraw,
} from './card'
import { drawnText, pageGap } from './card-parity'
import { CARD_PAIRS } from './card-pairs.test-helper'
import { NEXT_LABEL as NEXT, NEXT_PAGE, NEXT_SHA, NEXT_TREE, SMS_PAGE, SMS_TREE } from './card-fixture.test-helper'
import { ME, fakeApp, hooks, mm, pid, press } from './fake-app.test-helper'
import { DRAW_FAILED, RESULT_HINT, ROW_AGAIN, ROW_FAILURES_MAX, ROW_GONE, ROW_LEFT, ROW_REPLACED, firstRowFailure } from './register'
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

/** (0.7.36) A drawing with this thread's check of the card on record: the wait for it has tests of its own, at the end of this file. */
const drawChecked = (d: Omit<CardDraw, 'checked' | 'busy' | 'checkMiss' | 'onCheck'>) => drawCard(ELS, { checked: { [d.card.tree?.label ?? '']: 0 }, busy: false, checkMiss: null, onCheck: () => undefined, ...d })
/** (0.7.36) Every package these tests draw: a thread starts with its check on record, and a test of the wait takes it away. */
const ALL_CHECKED = Object.fromEntries([LABEL, ...Object.values(CARD_PAIRS).map(p => (p.tree as { label: string }).label)].map(label => [label, 0]))

/** A thread's `$` for the card alone: its state, a clock whose timers run when told, and a prompt box. */
function thread(box = '') {
  const state = new Map<string, unknown>([['cardChecked', ALL_CHECKED]])
  const timers: Array<{ at: number; fn: () => unknown }> = []
  let time = 1_000_000
  const fills: string[] = []
  /** (0.7.41) What went into the thread as the person's own message: a press's go. */
  const gos: string[] = []
  const files = new Map<string, string>()
  const ran: string[][] = []
  const notes: string[] = []
  /** (0.7.36) What a press appended to the transcript, and the order of the record, the note and the words. */
  const appends: unknown[] = []
  const order: string[] = []
  /** What the page read gives a press, what the renderer draws on this computer, and how an append goes. */
  const now = { page: { markdown: SMS_PAGE as string | null, sha: SHA as string | null }, render: JSON.stringify(SMS_TREE), session: TRANSCRIPT, os: undefined as string | undefined, append: 'stores' as 'stores' | 'throws' | 'denied', agents: [] as Array<{ id: string; status: string; teammateId?: string }> | 'throws', held: true as boolean | (() => boolean), submit: 'enters' as 'enters' | 'drop' | 'throws' }
  /** (0.7.41) Every submit with its options, as the press made it. */
  const submits: Array<Record<string, unknown>> = []
  const $ = {
    session: {
      id: async () => now.session,
      append: async (args: unknown) => {
        if (now.append === 'throws') throw new Error('a run no plugin may shape')
        if (now.append === 'denied') return { deny: 'a plugin above refused it' }
        appends.push(args)
        order.push('note')
        return { message: {}, uuid: 'row-1' }
      },
    },
    env: { get: async (name: string) => ({ HOME, OS: now.os })[name] },
    agent: {
      list: async () => {
        if (now.agents === 'throws') throw new Error('the list could not be read')
        return now.agents
      },
    },
    fs: {
      read: async (path: string) => {
        const text = files.get(path)
        if (text === undefined) throw new Error('ENOENT')
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
        if (path === SIGNED_FILE) order.push('record')
      },
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
        order.push('words')
        if (/^Send package [0-9a-f]{12}$/.test(box.trim())) box = input.text
        return { isFilled: true, text: input.text, cursor: input.text.length }
      },
      submit: async (input: { text: string }) => {
        submits.push({ ...input })
        if (now.submit === 'throws') throw new Error('the session could not take a prompt')
        if (now.submit === 'drop') return { drop: 'a Stop hook stands' }
        gos.push(input.text)
        order.push('go')
        return { text: input.text }
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
    gos,
    submits,
    box: () => box,
    files,
    ran,
    notes,
    appends,
    order,
    now,
    setTime: (at: number) => {
      time = at
    },
    log: { home: HOME, note: async (line: string) => void notes.push(line), readPage: async () => now.page, held: async () => (typeof now.held === 'function' ? now.held() : now.held) },
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
    const drawn = drawChecked({ card: cardOf(), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).not.toContain('Signing opens once')
  })

  test('(0.7.33) the page holds a line the card does not: the box stays closed, and the note says to go by the page the thread prints', () => {
    const drawn = drawChecked({ card: cardOf({ gap: 'the page holds a line the card does not (x)' }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).toContain('Go by the page printed in the thread.')
  })

  test('(0.7.33) a card that could not be drawn: the pane says one plain line, never the error or a path', () => {
    const raw = 'Traceback: /Users/someone/.claude/skills/client-reply-prep/scripts/render_visual.py line 12'
    const drawn = drawChecked({ card: cardOf({ tree: null, status: 'failed', error: raw }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
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
    const drawn = drawChecked({ card: cardOf({ tree: held }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect(texts(drawn).join(' ')).toContain('Not ready for the go')
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect([...buttons(drawn).keys()]).toContain('Fix these first ↗')
  })

  test('drawn: the client\'s text, our reply, the checks and the box, with the go one press sends', () => {
    const drawn = drawChecked({ card: cardOf(), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    const all = texts(drawn).join('\n')
    expect(all).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
    expect(all).toContain('Hi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off.')
    expect(all).toContain('Is the new booking link live yet?')
    expect(all).toContain(`One go sends 1 item. Package ${LABEL}.`)
    // (0.7.40) no Changes field in this drawing (no Input, no handler), so the caption names the chat box alone
    expect(all).toContain(`One press signs and sends: "Send package ${LABEL}" goes to your thread as your go, and it sends the package. Changes go in the chat box.`)
    expect([...buttons(drawn).keys()]).toContain('✍  Click to sign and send')
  })

  test('a changed package: the card stays drawn, without the box, saying the package moved on', () => {
    const drawn = drawChecked({ card: cardOf({ current: OTHER, status: 'rendering' }), marks: marks(), now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    expect([...buttons(drawn).keys()]).not.toContain('✍  Click to sign and send')
    expect(texts(drawn).join(' ')).toContain(`This card was drawn from package ${LABEL}; the package is now ffffffffffff.`)
  })
})

describe('0.7.26 signing: the name, the envelope, then (0.7.41) exactly the go sent into the thread, never a client send', () => {
  test('(0.7.41) a press records the signature; when the envelope has flown, "Send package <12>" goes into the thread as the person\'s own message, once, with nothing in the prompt box', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    const signed = (t.state.get('cardMarks') as { signed: Record<string, { signer: string; filled?: string }> }).signed[LABEL]
    expect(signed?.signer).toBe('Test Signer')
    expect(signed?.filled).toBeUndefined()
    expect(t.gos).toEqual([])
    await t.advance(SIGN_FILL_MS - 1)
    expect(t.gos).toEqual([])
    await t.advance(1)
    // exactly the go, as the person's own words (the model reads it bare), and no Enter: nothing is put in the prompt box
    expect(t.submits).toEqual([{ text: `Send package ${LABEL}`, asUser: true }])
    expect(t.gos).toEqual([`Send package ${LABEL}`])
    expect(t.fills).toEqual([])
    // record, note, then the go: always in that order
    expect(t.order).toEqual(['record', 'note', 'go'])
    expect((t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }).signed[LABEL]?.filled).toBe('sent')
    const drawn = texts(drawChecked({ card: t.state.get('card') as MmCard, marks: t.state.get('cardMarks') as never, now: 1_000_000 + 10_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
    expect(drawn).toContain(`Sealed and sent: your go for Package ${LABEL} is in the thread, and it is sending the package now.`)
    expect(drawn).not.toContain('Press Enter')
    // a second press does nothing
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
  })

  test('(0.7.41) a message the engine refuses falls back to the prompt box as before (Press Enter, or what to type over a draft); one that throws leaves the box alone', async () => {
    for (const [how, box, filled, said] of [
      ['drop', '', 'filled', `Sealed, but the go did not reach your thread, so "Send package ${LABEL}" is in your prompt box. Press Enter to send it.`],
      ['drop', 'a note I was writing', 'draft', `Sealed, but the go did not reach your thread and your prompt box holds a draft, so type: Send package ${LABEL}`],
      // (review of 0.7.41) a throw may have gone in before it failed: nothing in the box, and type it only if it does not show
      ['throws', '', 'unsure', `Sealed. If "Send package ${LABEL}" does not show in your thread, type it there.`],
    ] as const) {
      const t = thread(box)
      t.now.submit = how
      t.state.set('card', cardOf())
      t.state.set('cardMarks', { signed: {} })
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.gos, how).toEqual([])
      expect(t.fills, how).toEqual(filled === 'filled' ? [`Send package ${LABEL}`] : [])
      const m = t.state.get('cardMarks') as MmCardMarks
      expect(m.signed[LABEL]?.filled, how).toBe(filled)
      expect(texts(drawChecked({ card: t.state.get('card') as MmCard, marks: m, now: 1_000_000 + 10_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' '), how).toContain(said)
    }
  })

  test('(0.7.41) two clicks a few milliseconds apart are one press: one record, one note, one go', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await Promise.all([pressSign(t.$, LABEL, t.log), pressSign(t.$, LABEL, t.log)])
    await t.advance(SIGN_FILL_MS)
    expect(t.files.get(SIGNED_FILE)?.trim().split('\n')).toHaveLength(1)
    expect(t.appends).toHaveLength(1)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
  })

  test('(0.7.41) the exact go an older press left in the prompt box is cleared once the go is sent, so it can never be sent twice', async () => {
    const t = thread(`Send package ${LABEL}`)
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
    expect(t.fills).toEqual([''])
    expect(t.box()).toBe('')
  })

  test('(0.7.41) a draft of the person\'s in the box is never written over or touched: the go is sent beside it', async () => {
    const t = thread('a note I was writing')
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
    expect(t.fills).toEqual([])
    expect(t.box()).toBe('a note I was writing')
    const m = t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }
    expect(m.signed[LABEL]?.filled).toBe('sent')
  })

  test('(0.7.40) the thread starts a turn while the envelope flies: nothing is sent, the signature is dropped, and the box comes back for a new one once the turn ends', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    // the record and the note as always, in that order
    expect(t.order).toEqual(['record', 'note'])
    expect(t.files.get(SIGNED_FILE)?.trim().split('\n')).toHaveLength(1)
    expect(t.appends).toHaveLength(1)
    t.state.set('cardBusy', true)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.submits).toEqual([])
    const m = t.state.get('cardMarks') as MmCardMarks
    // nothing stands for the tag: the signature is dropped, never left as a stale one that holds the box shut
    expect(m.signed).toEqual({})
    expect(m.notice).toEqual({ packageId: SMS_TREE.package_id, kind: 'busy' })
    const BUSY = 'Your thread started working while you signed, so nothing was sent. Sign again once it finishes.'
    const at = (busy: boolean) =>
      drawCard(ELS, { card: t.state.get('card') as MmCard, marks: t.state.get('cardMarks') as MmCardMarks, checked: { [LABEL]: 0 }, busy, checkMiss: null, now: 1_000_000 + SIGN_FILL_MS, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    // while the thread works: the box is closed, and the card says why
    expect([...buttons(at(true)).keys()]).not.toContain('✍  Click to sign and send')
    expect(texts(at(true)).join(' ')).toContain(BUSY)
    // the turn ends: the box is offered again for the same tag, the notice with it
    t.state.set('cardBusy', false)
    expect([...buttons(at(false)).keys()]).toContain('✍  Click to sign and send')
    expect(texts(at(false)).join(' ')).toContain(BUSY)
    // and a second press signs again: a new record line and a new note, then exactly the go, sent
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.get(SIGNED_FILE)?.trim().split('\n')).toHaveLength(2)
    expect(t.appends).toHaveLength(2)
    await t.advance(SIGN_FILL_MS)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
    expect(t.fills).toEqual([])
    const after = t.state.get('cardMarks') as MmCardMarks
    expect(after.signed[LABEL]?.filled).toBe('sent')
    expect(after.notice).toBeUndefined()
  })

  test('the package changes while the envelope flies: nothing is sent', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    await pressSign(t.$, LABEL, t.log)
    t.state.set('card', cardOf({ current: OTHER }))
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.submits).toEqual([])
    expect((t.state.get('cardMarks') as { signed: Record<string, { filled?: string }> }).signed[LABEL]?.filled).toBe('stale')
  })

  test('(0.7.40) where the pane draws no card, a press signs nothing: no record, no note, no words, and the box says to try again', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    t.now.held = false
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.gos).toEqual([])
    expect(t.files.size).toBe(0)
    expect(t.appends).toEqual([])
    const m = t.state.get('cardMarks') as MmCardMarks
    expect(m.signed).toEqual({})
    expect(m.notice).toEqual({ packageId: SMS_TREE.package_id, kind: 'retry' })
    expect(m.checking).toBeUndefined()
    expect(texts(drawChecked({ card: cardOf(), marks: m, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')).toContain('That did not go through, so nothing was signed. Try again, or ask your thread to print the page.')
  })

  test('(0.7.40) and one whose client part goes while the page is read again signs nothing either', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    t.state.set('cardMarks', { signed: {} })
    let asks = 0
    t.now.held = () => ++asks === 1
    await pressSign(t.$, LABEL, t.log)
    await t.advance(SIGN_FILL_MS)
    expect(asks).toBe(2)
    expect(t.fills).toEqual([])
    expect(t.files.size).toBe(0)
    expect(t.appends).toEqual([])
    const m = t.state.get('cardMarks') as MmCardMarks
    expect(m.signed).toEqual({})
    expect(m.notice?.kind).toBe('retry')
  })

  test('no signature where the pane holds it back: another client\'s part, a stale card, a page line the card lacks', async () => {
    for (const card of [cardOf({ own: false }), cardOf({ current: OTHER }), cardOf({ gap: 'the page holds a line the card does not (x)' })]) {
      const t = thread()
      t.state.set('card', card)
      t.state.set('cardMarks', { signed: {} })
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.fills).toEqual([])
      expect(t.gos).toEqual([])
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
    expect(t.gos).toEqual([`Send package ${SHA.slice(0, 12)}`])
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
    expect(t.gos).toEqual([])
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.signed).toEqual({})
    expect(marks.notice?.kind).toBe('retry')
    const drawn = texts(drawChecked({ card: t.state.get('card') as MmCard, marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
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
    expect(t.gos).toEqual([])
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
    expect(t.gos.length).toBe(1)
    const draw = (now: number) => texts(drawChecked({ card: t.state.get('card') as MmCard, marks: t.state.get('cardMarks') as MmCardMarks, now, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
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
    expect(t.gos.length).toBe(2)
  })

  describe('(0.7.33) a signature is for the page it read, not only the hash', () => {
    const before = CARD_PAIRS["rob's mail, plan not approved"] as { page: string; tree: { package_id: string; package_sha256: string; label: string } }
    const after = CARD_PAIRS["rob's mail, plan approved"] as { page: string; tree: { package_id: string; package_sha256: string; label: string } }
    const sha = before.tree.package_sha256
    const label = before.tree.label
    const drawn = (t: ReturnType<typeof thread>) =>
      texts(drawChecked({ card: t.state.get('card') as MmCard, marks: t.state.get('cardMarks') as MmCardMarks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join('\n')
    const lines = (t: ReturnType<typeof thread>) => (t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    /** A thread that has pressed and been filled, on the page before plan approval. */
    const signed = async () => {
      const t = thread()
      t.now.page = { markdown: before.page, sha }
      t.now.render = JSON.stringify(before.tree)
      t.state.set('card', cardOf({ packageId: before.tree.package_id, tree: readTree(JSON.parse(JSON.stringify(before.tree))) as MmCardTree, current: sha }))
      await pressSign(t.$, label, t.log)
      await t.advance(SIGN_FILL_MS)
      t.setTime(1_000_000)
      return t
    }

    test('the two pages are the real pair: the hash the same, the words of the Cc not', () => {
      expect(after.tree.package_sha256).toBe(sha)
      expect(after.page).not.toBe(before.page)
      expect(pageGap(after.page, readTree(JSON.parse(JSON.stringify(before.tree))) as MmCardTree)).toContain('Cc')
    })

    test('press, plan approval adds a Cc with the hash the same, a refresh: unsigned, the box back, and a press writes a record the gate takes', async () => {
      const t = await signed()
      expect(t.gos).toEqual([`Send package ${label}`])
      expect(drawn(t)).toContain('Sealed')
      expect(lines(t).length).toBe(1)
      expect(lines(t)[0]?.page_sha256).toBe(await sha256Hex(before.page))

      // plan approval: OW's page and this computer's render both say the new Cc, and the package's hash has not moved
      t.now.page = { markdown: after.page, sha }
      t.now.render = JSON.stringify(after.tree)
      expect(await refreshCard(t.$, { packageId: before.tree.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, t.now.page)).toBe('changed')
      const card = t.state.get('card') as MmCard
      expect(card.pageSha).toBe(await sha256Hex(after.page))
      expect(holdOf(card)).toBe('')
      const now = drawn(t)
      expect(now).not.toContain('Sealed')
      expect(now).not.toContain('Signed by')
      expect(now).not.toContain('Press Enter')
      expect(now).toContain('[✍  Click to sign and send]')

      // the press is no longer swallowed, and its record is for the page the gate will read
      await pressSign(t.$, label, t.log)
      expect(lines(t).length).toBe(2)
      const fresh = lines(t)[1] as Record<string, unknown>
      expect(gateTakes(fresh, TRANSCRIPT, sha)).toBe(true)
      expect(fresh.page_sha256).toBe(await sha256Hex(after.page))
      expect(fresh.package_sha256).toBe(sha)
      expect(fresh.label).toBe(label)
      await t.advance(SIGN_FILL_MS)
      expect(t.gos).toEqual([`Send package ${label}`, `Send package ${label}`])
      expect(drawn(t)).toContain('Sealed')
    })

    test('the same page read again keeps the signature, and a second press writes nothing', async () => {
      const t = await signed()
      expect(await refreshCard(t.$, { packageId: before.tree.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, t.now.page)).toBe('same')
      expect(drawn(t)).toContain('Sealed')
      await pressSign(t.$, label, t.log)
      expect(lines(t).length).toBe(1)
    })

    test('a page that changes while the envelope flies: nothing goes in the prompt box', async () => {
      const t = thread()
      t.now.page = { markdown: before.page, sha }
      t.now.render = JSON.stringify(before.tree)
      t.state.set('card', cardOf({ packageId: before.tree.package_id, tree: readTree(JSON.parse(JSON.stringify(before.tree))) as MmCardTree, current: sha }))
      await pressSign(t.$, label, t.log)
      t.now.page = { markdown: after.page, sha }
      t.now.render = JSON.stringify(after.tree)
      await refreshCard(t.$, { packageId: before.tree.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, t.now.page)
      await t.advance(SIGN_FILL_MS)
      expect(t.fills).toEqual([])
      expect(t.gos).toEqual([])
      expect(drawn(t)).toContain('[✍  Click to sign and send]')
    })

    test('a mark an older version left, with no page on it, does not stand', () => {
      const marks: MmCardMarks = { signed: { [label]: { label, signer: 'Test Signer', at: 1_000_000 } } }
      expect(standing(marks, label, { pageSha: 'a'.repeat(64) }, 1_000_001)).toBeUndefined()
      expect(standing(marks, label, {}, 1_000_001)).toBeUndefined()
    })

    test('OW with no usable hash takes the page away, and the signature does not stand', async () => {
      const t = await signed()
      expect(await refreshCard(t.$, { packageId: before.tree.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, { markdown: null, sha: null })).toBe('no-hash')
      expect((t.state.get('card') as MmCard).pageSha).toBeUndefined()
      expect(drawn(t)).not.toContain('Sealed')
    })
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

describe('0.7.33 a computer whose signature records the send gate cannot check', () => {
  const read = { markdown: SMS_PAGE, sha: SHA }
  const refresh = (t: ReturnType<typeof thread>) => refreshCard(t.$, { packageId: SMS_TREE.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, read)

  test('on Windows: not ready in the gate\'s words, no box, and a press records nothing', async () => {
    const t = thread()
    t.now.os = 'Windows_NT'
    t.state.set('card', cardOf())
    expect(await refresh(t)).toBe('same')
    const card = t.state.get('card') as MmCard
    expect(card.gap).toBe(NO_OWNER_CHECK)
    expect(holdOf(card)).toBe('no-owner-check')
    expect(cardVerdict(card, SMS_TREE.package_id)).toBe("signatures can't be checked on this computer")
    const drawn = texts(drawChecked({ card, marks: { signed: {} }, now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join('\n')
    expect(drawn).not.toContain('Click to sign and send')
    expect(drawn).toContain("Signatures can't be checked on this computer")
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.has(SIGNED_FILE)).toBe(false)
    expect(t.fills).toEqual([])
  })

  test('on a Mac or Linux: nothing changes', async () => {
    const t = thread()
    t.state.set('card', cardOf())
    await refresh(t)
    expect(cardVerdict(t.state.get('card') as MmCard, SMS_TREE.package_id)).toBe('')
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
      return links(drawChecked({ card: cardOf({ packageId: tree.package_id as string, tree }), marks: { signed: {} }, now: 0, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined }))
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
    expect(t.gos).toEqual([])
    const marks = t.state.get('cardMarks') as MmCardMarks
    expect(marks.signed).toEqual({})
    expect(marks.notice).toEqual({ packageId: after.id, kind: 'changed' })
    const now = t.state.get('card') as MmCard
    expect(drawnText(now.tree?.nodes ?? [])).toContain('Cc support@letaidothehardwork.com')
    const drawn = texts(drawChecked({ card: now, marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')
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
    expect(texts(drawChecked({ card: cardOf(), marks, now: 1_000_000, onSign: () => undefined, onAsk: () => undefined, onPage: () => undefined })).join(' ')).toContain('Checking this is still the package…')
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
    // the draw goes on after the press answers, past a real digest of the page
    for (let i = 0; i < 200 && (w.view('local_hub', 'card') as MmCard | undefined)?.status !== 'ready'; i++) await new Promise(r => setTimeout(r, 2))
    expect(ran.filter(a => a.some(x => x.endsWith('render_visual.py'))).length).toBe(1)
    const card = w.view('local_hub', 'card') as MmCard
    expect(card.status).toBe('ready')
    expect(card.own).toBe(false)
    expect(card.current).toBe(SHA)
  })
})

describe('0.7.36 the box waits for the thread: it opens once this thread has finished checking this exact version', () => {
  const draw = (card: MmCard, checked: Record<string, number>, over: Partial<CardDraw> = {}) =>
    drawCard(ELS, { card, marks: { signed: {} }, checked, busy: false, checkMiss: null, now: 1_000_000, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, ...over })
  const SIGN = '✍  Click to sign and send'
  /** The card as this thread's pane draws it now. */
  const drawn = async (t: ReturnType<typeof thread>, over: Partial<CardDraw> = {}) =>
    draw(t.state.get('card') as MmCard, await checkedOf(t.$), { busy: await busyOf(t.$), checkMiss: await checkMissOf(t.$), ...over })
  /** A thread with nothing checked yet. */
  const unchecked = (box = '') => {
    const t = thread(box)
    t.state.delete('cardChecked')
    t.state.set('card', cardOf())
    return t
  }
  const nextCard = () => cardOf({ current: NEXT_SHA, tree: readTree(JSON.parse(NEXT_TREE)) as MmCardTree })
  /** A turn that got `card ready` for this version, or printed its page, and ended with an answer. */
  const checkedNow = async ($: never, label: string) => {
    await notePending($, [label])
    await turnEnded($, true)
  }

  test('the pane says what is true: not checked and stopped, or working; the card is drawn in full with the same button, and no box', () => {
    expect(THREAD_CHECKING).toBe('This thread is still checking this package. The signature box opens when it finishes.')
    expect(THREAD_NOT_CHECKED).toBe('This thread has not checked this version of the package yet.')
    expect(CHECK_BUTTON).toBe('Check this package')
    for (const [busy, says, not] of [[false, THREAD_NOT_CHECKED, THREAD_CHECKING], [true, THREAD_CHECKING, THREAD_NOT_CHECKED]] as const) {
      const card = draw(cardOf(), {}, { busy })
      const all = texts(card).join('\n')
      expect(all).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      expect(all).toContain('Hi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off.')
      expect(all).toContain(says)
      expect(all).not.toContain(not)
      expect([...buttons(card).keys()]).toContain('Check this package')
      expect([...buttons(card).keys()]).not.toContain(SIGN)
      expect(all).not.toContain('your signature is the go')
    }
  })

  test('checked and stopped: the box, and neither line nor the button. Checked and working: the working line, the button and no box', () => {
    const open = draw(cardOf(), { [LABEL]: 0 })
    expect([...buttons(open).keys()]).toContain(SIGN)
    expect([...buttons(open).keys()]).not.toContain('Check this package')
    expect(texts(open).join('\n')).not.toContain(THREAD_CHECKING)
    expect(texts(open).join('\n')).not.toContain(THREAD_NOT_CHECKED)
    const working = draw(cardOf(), { [LABEL]: 0 }, { busy: true })
    expect([...buttons(working).keys()]).toEqual(expect.arrayContaining(['Check this package']))
    expect([...buttons(working).keys()]).not.toContain(SIGN)
    expect(texts(working).join('\n')).toContain(THREAD_CHECKING)
  })

  test('the button asks for exactly the words, and with any text in the prompt box it writes nothing and says so, as the sign path does', async () => {
    const asked: string[] = []
    buttons(draw(cardOf(), {}, { onCheck: label => asked.push(label) })).get('Check this package')?.()
    expect(asked).toEqual([LABEL])
    const t = unchecked()
    await pressCheck(t.$, LABEL)
    expect(t.fills).toEqual([`Check package ${LABEL}`])
    expect(await checkMissOf(t.$)).toBeNull()
    expect(texts(await drawn(t)).join('\n')).not.toContain('holds a draft')
    expect(texts(await drawn(t)).join('\n')).not.toContain('Type this in the thread')
    expect(CHECK_DRAFT(LABEL)).toBe(`Your prompt box holds a draft, so type: Check package ${LABEL}`)
    for (const busy of [false, true]) {
      const drafting = unchecked('a note I was writing')
      if (busy) await turnBegan(drafting.$)
      await pressCheck(drafting.$, LABEL)
      expect(drafting.fills).toEqual([])
      expect(texts(await drawn(drafting)).join('\n')).toContain(`Your prompt box holds a draft, so type: Check package ${LABEL}`)
      expect([...buttons(await drawn(drafting)).keys()]).toContain('Check this package')
    }
  })

  test('the draft line goes when the person sends something, and when a press finds the box clear; it is only for that version', async () => {
    const sent = unchecked('a note I was writing')
    await pressCheck(sent.$, LABEL)
    await turnBegan(sent.$)
    expect(await checkMissOf(sent.$)).toBeNull()
    const cleared = unchecked('a note I was writing')
    await pressCheck(cleared.$, LABEL)
    expect(await checkMissOf(cleared.$)).toEqual({ label: LABEL, filled: 'draft' })
    // on another version the line is not drawn
    expect(texts(draw(nextCard(), {}, { checkMiss: await checkMissOf(cleared.$) })).join('\n')).not.toContain('holds a draft')
    // the person clears the box and presses again: the words go in, and the line goes
    ;(cleared.$ as unknown as { prompt: { read: () => Promise<{ text: string; cursor: number }> } }).prompt.read = async () => ({ text: '', cursor: 0 })
    await pressCheck(cleared.$, LABEL)
    expect(cleared.fills).toEqual([`Check package ${LABEL}`])
    expect(await checkMissOf(cleared.$)).toBeNull()
    // the words already in the box are no draft: nothing is written, and nothing is said
    const same = unchecked(`Check package ${LABEL}`)
    await pressCheck(same.$, LABEL)
    expect(same.fills).toEqual([])
    expect(await checkMissOf(same.$)).toBeNull()
  })

  describe('a prompt box that cannot be read or filled', () => {
    type Box = { prompt: { read: () => Promise<unknown>; fill: () => Promise<unknown> } }
    const WORDS = `Type this in the thread: Check package ${LABEL}`
    const CASES: Array<[string, (b: Box['prompt']) => void]> = [
      ['the box cannot be read', b => void (b.read = async () => { throw new Error('no prompt box on this surface') })],
      ['the box cannot be filled', b => void (b.fill = async () => { throw new Error('no prompt box on this surface') })],
      ['the fill is refused', b => void (b.fill = async () => ({ isFilled: false }))],
    ]

    test('the words', () => {
      expect(CHECK_TYPE(LABEL)).toBe(WORDS)
    })

    for (const [why, breakBox] of CASES) {
      for (const busy of [false, true]) {
        test(`${why}, ${busy ? 'while the thread works' : 'with the thread stopped'}: the pane says what to type, with the button still there and no box`, async () => {
          const t = unchecked()
          if (busy) await turnBegan(t.$)
          breakBox((t.$ as unknown as Box).prompt)
          await pressCheck(t.$, LABEL)
          expect(t.fills).toEqual([])
          expect(await checkMissOf(t.$)).toEqual({ label: LABEL, filled: 'none' })
          const said = await drawn(t)
          expect(texts(said).join('\n')).toContain(WORDS)
          expect(texts(said).join('\n')).not.toContain('holds a draft')
          expect([...buttons(said).keys()]).toContain('Check this package')
          expect([...buttons(said).keys()]).not.toContain(SIGN)
        })
      }
    }

    test('the line goes when a turn starts, and when a press gets its words in; it is only for that version, and a draft found later says the draft line', async () => {
      const started = unchecked()
      ;(started.$ as unknown as Box).prompt.read = async () => { throw new Error('no prompt box') }
      await pressCheck(started.$, LABEL)
      expect(texts(draw(nextCard(), {}, { checkMiss: await checkMissOf(started.$) })).join('\n')).not.toContain('Type this in the thread')
      await turnBegan(started.$)
      expect(await checkMissOf(started.$)).toBeNull()

      const t = unchecked()
      const box = (t.$ as unknown as Box).prompt
      const reads = box.read
      box.read = async () => { throw new Error('no prompt box') }
      await pressCheck(t.$, LABEL)
      expect(await checkMissOf(t.$)).toEqual({ label: LABEL, filled: 'none' })
      box.read = async () => ({ text: 'a note I was writing', cursor: 0 })
      await pressCheck(t.$, LABEL)
      expect(await checkMissOf(t.$)).toEqual({ label: LABEL, filled: 'draft' })
      expect(texts(await drawn(t)).join('\n')).toContain(`Your prompt box holds a draft, so type: Check package ${LABEL}`)
      expect(texts(await drawn(t)).join('\n')).not.toContain('Type this in the thread')
      box.read = reads
      await pressCheck(t.$, LABEL)
      expect(t.fills).toEqual([`Check package ${LABEL}`])
      expect(await checkMissOf(t.$)).toBeNull()
    })

    test('a value from an older version, or an odd one, reads as none', async () => {
      const t = unchecked()
      t.state.set('cardCheckMiss', 'something older')
      expect(await checkMissOf(t.$)).toBeNull()
    })
  })

  test('a surface with no Button: the words and the label stand as text, as the card\'s other buttons do', () => {
    const noButton = { Box: 'Box', Text: 'Text' } as never
    const card = drawCard(noButton, { card: cardOf(), marks: { signed: {} }, checked: {}, busy: true, checkMiss: null, now: 0, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined })
    const all = texts(card).join('\n')
    expect(all).toContain(THREAD_CHECKING)
    expect(all).toContain(CHECK_BUTTON)
    expect(all).not.toContain('Type in the thread')
  })

  test('the holds speak first: a card that is held says why, and asks for no check', () => {
    for (const card of [cardOf({ own: false }), cardOf({ current: OTHER }), cardOf({ gap: 'the page holds a line the card does not (x)' })]) {
      for (const busy of [false, true]) {
        const held = draw(card, {}, { busy })
        expect(texts(held).join('\n')).not.toContain(THREAD_CHECKING)
        expect(texts(held).join('\n')).not.toContain(THREAD_NOT_CHECKED)
        expect([...buttons(held).keys()]).not.toContain('Check this package')
      }
    }
  })

  test('the real order from 2026-11-07: a press before the check is on record writes no record and puts no words in the box', async () => {
    const t = unchecked()
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.gos).toEqual([])
    expect((t.state.get('cardMarks') as MmCardMarks | undefined)?.signed ?? {}).toEqual({})
    // ready at t1, more tool calls, a press at t2 while the turn runs: refused the same way
    await turnBegan(t.$)
    await notePending(t.$, [LABEL])
    expect(buttons(draw(t.state.get('card') as MmCard, await checkedOf(t.$))).has('✍  Click to sign and send')).toBe(false)
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    expect(t.appends).toEqual([])
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.gos).toEqual([])
    expect((t.state.get('cardMarks') as MmCardMarks | undefined)?.signed ?? {}).toEqual({})
    // the turn ends: the same press now signs, and the words go in
    await turnEnded(t.$, true)
    expect(buttons(draw(t.state.get('card') as MmCard, await checkedOf(t.$))).has('✍  Click to sign and send')).toBe(true)
    await pressSign(t.$, LABEL, t.log)
    expect((t.files.get(SIGNED_FILE) ?? '').split('\n').filter(Boolean).length).toBe(1)
    await t.advance(SIGN_FILL_MS)
    expect(t.gos).toEqual([`Send package ${LABEL}`])
  })

  test('a new hash closes the box until the thread answers for that version; a press on it records nothing', async () => {
    const t = unchecked()
    await checkedNow(t.$, LABEL)
    expect([...buttons(draw(t.state.get('card') as MmCard, await checkedOf(t.$))).keys()]).toContain('✍  Click to sign and send')
    t.state.set('card', nextCard())
    expect(holdOf(t.state.get('card') as MmCard)).toBe('')
    const closed = draw(t.state.get('card') as MmCard, await checkedOf(t.$))
    expect([...buttons(closed).keys()]).toContain('Check this package')
    expect([...buttons(closed).keys()]).not.toContain('✍  Click to sign and send')
    await pressSign(t.$, NEXT, t.log)
    expect(t.files.size).toBe(0)
    await checkedNow(t.$, NEXT)
    expect([...buttons(draw(t.state.get('card') as MmCard, await checkedOf(t.$))).keys()]).toContain('✍  Click to sign and send')
  })

  test('a page that changes under the same hash does not close it: the Cc plan approval adds', async () => {
    const before = CARD_PAIRS["rob's mail, plan not approved"] as { tree: { package_id: string; package_sha256: string; label: string } }
    const after = CARD_PAIRS["rob's mail, plan approved"] as { page: string; tree: { package_sha256: string; label: string } }
    expect(after.tree.package_sha256).toBe(before.tree.package_sha256)
    const t = unchecked()
    t.state.set('card', cardOf({ packageId: before.tree.package_id, current: before.tree.package_sha256, tree: readTree(JSON.parse(JSON.stringify(before.tree))) as MmCardTree }))
    await checkedNow(t.$, before.tree.label)
    t.now.page = { markdown: after.page, sha: after.tree.package_sha256 }
    t.now.render = JSON.stringify(after.tree)
    expect(await refreshCard(t.$, { packageId: before.tree.package_id, signer: 'Test Signer', home: HOME, note: async () => undefined }, t.now.page)).toBe('changed')
    const drawn = draw(t.state.get('card') as MmCard, await checkedOf(t.$))
    expect([...buttons(drawn).keys()]).toContain('✍  Click to sign and send')
    expect(texts(drawn).join('\n')).not.toContain(THREAD_CHECKING)
  })

  test('a printed page is read off its closing line, and nothing else opens the box', () => {
    expect(printedTags(`…\n\nOne go sends 1 item. Package \`${LABEL}\`.`)).toEqual([LABEL])
    expect(printedTags('One go sends all 3 items now and schedules 2 follow-ups. Package `0123456789ab`.')).toEqual(['0123456789ab'])
    expect(printedTags('One go closes this package: no reply needed. Package `abcdefabcdef`.')).toEqual(['abcdefabcdef'])
    expect(printedTags(`The old tag was Package \`${LABEL}\`.`)).toEqual([])
    expect(printedTags('Send package 3f1c9a7e5b2d')).toEqual([])
    expect(printedTags('One go posts this reply. Ask `3f1c9a7e5b2d`.')).toEqual([])
  })

  test('the wait is no hold: `holdOf` and `cardVerdict` say nothing of it, or `mm card` could never answer ready', async () => {
    const t = unchecked()
    expect(await checkedOf(t.$)).toEqual({})
    const card = t.state.get('card') as MmCard
    expect(holdOf(card)).toBe('')
    expect(cardVerdict(card, SMS_TREE.package_id)).toBe('')
  })

  test('the end of a turn: one that answered makes what it left pending checked, and one that stopped short drops it', async () => {
    const t = unchecked()
    await notePending(t.$, [LABEL])
    expect(await checkedOf(t.$)).toEqual({})
    await turnEnded(t.$, false)
    expect(await checkedOf(t.$)).toEqual({})
    // nothing pending is left for a later turn to open
    await turnEnded(t.$, true)
    expect(await checkedOf(t.$)).toEqual({})
    await notePending(t.$, [LABEL])
    await turnEnded(t.$, true)
    expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
    // once: the next turn's end has nothing new to do
    const had = await checkedOf(t.$)
    t.setTime(2_000_000)
    await turnEnded(t.$, true)
    expect(await checkedOf(t.$)).toEqual(had)
  })

  test('only the same turn: a ready that lands after its interrupted turn ended is gone when the next turn starts', async () => {
    const t = unchecked()
    await turnEnded(t.$, false)
    await notePending(t.$, [LABEL])
    await turnBegan(t.$)
    await turnEnded(t.$, true)
    expect(await checkedOf(t.$)).toEqual({})
    // what the earlier turns finished stands
    await checkedNow(t.$, LABEL)
    await turnBegan(t.$)
    expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
  })

  test('a session that dies before its turn ends keeps nothing: the box is closed, the button works, and the next finished turn opens it', async () => {
    const dying = unchecked()
    await notePending(dying.$, [LABEL])
    // its state goes with it: what a new process of the thread starts from
    const t = unchecked()
    const fresh = await drawn(t, { onCheck: label => void pressCheck(t.$, label) })
    expect(buttons(fresh).has('✍  Click to sign and send')).toBe(false)
    buttons(fresh).get('Check this package')?.()
    await new Promise(r => setTimeout(r, 0))
    expect(t.fills).toEqual([`Check package ${LABEL}`])
    await checkedNow(t.$, LABEL)
    expect(buttons(draw(t.state.get('card') as MmCard, await checkedOf(t.$))).has('✍  Click to sign and send')).toBe(true)
  })

  test('a new hash from OW clears both for the old version; the same hash, and a read with none, clear nothing', async () => {
    const id = '12121212-1212-4212-8212-121212121212'
    const t = unchecked()
    await noteVersion(t.$, id, SHA)
    await checkedNow(t.$, LABEL)
    await notePending(t.$, [LABEL])
    await noteVersion(t.$, id, SHA)
    expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
    await noteVersion(t.$, id, null)
    expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
    expect(currentOf(id, null)).toBeNull()
    await noteVersion(t.$, id, NEXT_SHA)
    expect(currentOf(id, null)).toBe(NEXT_SHA)
    expect(await checkedOf(t.$)).toEqual({})
    // and nothing pending comes back at the end of the turn
    await turnEnded(t.$, true)
    expect(await checkedOf(t.$)).toEqual({})
    // back to the first version: it waits for the thread again
    await noteVersion(t.$, id, SHA)
    expect(isChecked(await checkedOf(t.$), LABEL)).toBe(false)
  })

  describe('the note a press leaves in the transcript', () => {
    /** The first 12 of the record's `page_sha256`, off the file the send gate reads. */
    const recordPage = (t: ReturnType<typeof thread>) => (JSON.parse((t.files.get(SIGNED_FILE) ?? '').trim().split('\n').at(-1) as string) as { page_sha256: string }).page_sha256.slice(0, 12)
    /** A thread with this card and its check on record. */
    const ready = async () => {
      const t = unchecked()
      await checkedNow(t.$, LABEL)
      return t
    }

    test('its words with the page the record signed, as a user row of one text block, written once, and always record, note, then (0.7.41) the go', async () => {
      expect(SIGNED_NOTE('3f1c9a7e5b2d', 'abcdefabcdef')).toBe('[Massmarket bridge, no reply needed] Card signed in the side pane: Package 3f1c9a7e5b2d, page abcdefabcdef. Nothing has been sent.')
      const t = await ready()
      await pressSign(t.$, LABEL, t.log)
      const page12 = recordPage(t)
      expect(page12).toBe((await sha256Hex(SMS_PAGE)).slice(0, 12))
      expect(t.appends).toEqual([{ message: { type: 'user', content: [{ type: 'text', text: `[Massmarket bridge, no reply needed] Card signed in the side pane: Package ${LABEL}, page ${page12}. Nothing has been sent.` }] } }])
      expect(t.order).toEqual(['record', 'note'])
      await t.advance(SIGN_FILL_MS)
      expect(t.order).toEqual(['record', 'note', 'go'])
      // a second press while the signature stands writes neither
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.appends.length).toBe(1)
      expect(t.order).toEqual(['record', 'note', 'go'])
    })

    for (const how of ['throws', 'denied'] as const) {
      test(`an append that ${how === 'throws' ? 'the engine refuses' : 'a plugin above answers with a deny'}: no go sent and no words in the box, the box says to try again, and the record stands with no note`, async () => {
        const t = await ready()
        t.now.append = how
        await pressSign(t.$, LABEL, t.log)
        await t.advance(SIGN_FILL_MS)
        expect(t.order).toEqual(['record'])
        expect(t.fills).toEqual([])
        expect(t.submits).toEqual([])
        expect(t.appends).toEqual([])
        const marks = t.state.get('cardMarks') as MmCardMarks
        expect(marks.signed).toEqual({})
        expect(marks.notice?.kind).toBe('retry')
        expect(t.notes.join('\n')).toContain('not appended')
        expect(t.notes.join('\n')).not.toContain('Nothing has been sent')
        const said = texts(draw(t.state.get('card') as MmCard, await checkedOf(t.$), { marks })).join(' ')
        expect(said).toContain('That did not go through, so nothing was signed. Try again, or ask your thread to print the page.')
        // it goes through on the next press: a record and a note of its own, then the go
        t.now.append = 'stores'
        await pressSign(t.$, LABEL, t.log)
        await t.advance(SIGN_FILL_MS)
        expect(t.order).toEqual(['record', 'record', 'note', 'go'])
        expect(t.appends.length).toBe(1)
      })
    }

    test('a record that cannot be written leaves no note either', async () => {
      const t = await ready()
      ;(t.$ as unknown as { fs: { write: () => Promise<void> } }).fs.write = async () => {
        throw new Error('EACCES: no write here')
      }
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.appends).toEqual([])
      expect(t.fills).toEqual([])
      expect(t.submits).toEqual([])
    })

    test('nothing reaches the transcript when the press is refused for want of a check, or for a card that moved', async () => {
      const first = unchecked()
      await notePending(first.$, [LABEL])
      await pressSign(first.$, LABEL, first.log)
      expect(first.appends).toEqual([])
      const moved = await ready()
      moved.now.page = { markdown: NEXT_PAGE, sha: NEXT_SHA }
      moved.now.render = NEXT_TREE
      await pressSign(moved.$, LABEL, moved.log)
      expect(moved.appends).toEqual([])
    })
  })

  describe('the box is closed while the thread works', () => {
    const working = (status: string, more: { teammateId?: string; id?: string } = {}) => ({ id: 'agent_1', status, ...more })

    test('"change the second paragraph": an open box closes when the turn starts, a press is refused, and the check stands when the turn ends with the same hash', async () => {
      const t = unchecked()
      await checkedNow(t.$, LABEL)
      expect(await busyOf(t.$)).toBe(false)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
      // the person sends a change
      await turnBegan(t.$)
      expect(await busyOf(t.$)).toBe(true)
      const closed = await drawn(t)
      expect([...buttons(closed).keys()]).not.toContain(SIGN)
      expect(texts(closed).join('\n')).toContain(THREAD_CHECKING)
      await pressSign(t.$, LABEL, t.log)
      await t.advance(SIGN_FILL_MS)
      expect(t.files.size).toBe(0)
      expect(t.appends).toEqual([])
      expect(t.fills).toEqual([])
      expect((t.state.get('cardMarks') as MmCardMarks | undefined)?.signed ?? {}).toEqual({})
      // a same-hash re-check in the turn does not open it either
      await notePending(t.$, [LABEL])
      expect([...buttons(await drawn(t)).keys()]).not.toContain(SIGN)
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(false)
      expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
    })

    test('a turn that adds no check leaves one on record for the same hash', async () => {
      const t = unchecked()
      await checkedNow(t.$, LABEL)
      await turnBegan(t.$)
      await turnEnded(t.$, true)
      expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
    })

    test('any end of a turn clears busy with no sub-agent at work, whatever its reason', async () => {
      const t = unchecked()
      await turnBegan(t.$)
      await turnEnded(t.$, false)
      expect(await busyOf(t.$)).toBe(false)
      expect(texts(await drawn(t)).join('\n')).toContain(THREAD_NOT_CHECKED)
    })

    test('a background sub-agent still at work at the end of the turn: busy stays, the pending ready is dropped, and the thread has to ask again', async () => {
      const t = unchecked()
      await turnBegan(t.$)
      await notePending(t.$, [LABEL])
      t.now.agents = [working('running')]
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(true)
      expect(await checkedOf(t.$)).toEqual({})
      const held = await drawn(t)
      expect([...buttons(held).keys()]).not.toContain(SIGN)
      expect(texts(held).join('\n')).toContain(THREAD_CHECKING)
      // it ends, the engine starts a turn, and that turn's end clears busy: nothing pending came through
      t.now.agents = [working('completed')]
      await turnBegan(t.$)
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(false)
      expect(await checkedOf(t.$)).toEqual({})
      expect(texts(await drawn(t)).join('\n')).toContain(THREAD_NOT_CHECKED)
      // the thread asks again, and that turn's end opens the box
      await turnBegan(t.$)
      await notePending(t.$, [LABEL])
      await turnEnded(t.$, true)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
    })

    test('a check on record stands while a later turn leaves a sub-agent at work; the box waits for it', async () => {
      const t = unchecked()
      await checkedNow(t.$, LABEL)
      await turnBegan(t.$)
      t.now.agents = [working('running')]
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(true)
      expect(isChecked(await checkedOf(t.$), LABEL)).toBe(true)
      expect([...buttons(await drawn(t)).keys()]).not.toContain(SIGN)
      await pressSign(t.$, LABEL, t.log)
      expect(t.files.size).toBe(0)
      t.now.agents = []
      await turnBegan(t.$)
      await turnEnded(t.$, true)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
    })

    for (const status of ['pending', 'running', 'waiting']) {
      test(`a sub-agent ${status} counts as at work`, async () => {
        const t = unchecked()
        t.now.agents = [working('completed', { id: 'agent_0' }), working(status)]
        await turnBegan(t.$)
        await turnEnded(t.$, true)
        expect(await busyOf(t.$)).toBe(true)
      })
    }

    for (const status of ['idle', 'completed', 'failed', 'killed']) {
      test(`a sub-agent ${status} does not`, async () => {
        const t = unchecked()
        t.now.agents = [working(status)]
        await turnBegan(t.$)
        await turnEnded(t.$, true)
        expect(await busyOf(t.$)).toBe(false)
      })
    }

    test('a teammate in a terminal pane of its own does not: the word it last wrote outlives a dead pane. One in this session does', async () => {
      const t = unchecked()
      t.now.agents = [working('running', { id: 'sam@team', teammateId: 'sam@team' })]
      await turnBegan(t.$)
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(false)
      t.now.agents = [working('running', { id: 'agent_2', teammateId: 'sam@team' })]
      await turnBegan(t.$)
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(true)
    })

    test('a list that cannot be read stays busy and drops what was pending; the Check button starts a new turn, and that turn\'s end clears it', async () => {
      const t = unchecked()
      await turnBegan(t.$)
      await notePending(t.$, [LABEL])
      t.now.agents = 'throws'
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(true)
      expect(await checkedOf(t.$)).toEqual({})
      const stuck = await drawn(t, { onCheck: label => void pressCheck(t.$, label) })
      expect([...buttons(stuck).keys()]).not.toContain(SIGN)
      buttons(stuck).get('Check this package')?.()
      await new Promise(r => setTimeout(r, 0))
      expect(t.fills).toEqual([`Check package ${LABEL}`])
      // the person presses Enter
      t.now.agents = []
      await turnBegan(t.$)
      await notePending(t.$, [LABEL])
      await turnEnded(t.$, true)
      expect(await busyOf(t.$)).toBe(false)
      expect([...buttons(await drawn(t)).keys()]).toContain(SIGN)
    })

    test('the turn mark moves at every start and end of a turn, so a call can tell it outlived its turn', async () => {
      const t = unchecked()
      const at = turnMark()
      await turnBegan(t.$)
      expect(turnMark()).toBe(at + 1)
      await turnEnded(t.$, true)
      expect(turnMark()).toBe(at + 2)
    })
  })

  test('a thread keeps the newest 30 versions, an odd value reads as none, and only a tag goes on record', async () => {
    const t = unchecked()
    const tags = Array.from({ length: 35 }, (_, i) => i.toString(16).padStart(12, '0'))
    for (const tag of tags) await checkedNow(t.$, tag)
    const kept = await checkedOf(t.$)
    expect(Object.keys(kept).length).toBe(30)
    expect(isChecked(kept, tags[4] as string)).toBe(false)
    expect(isChecked(kept, tags[5] as string)).toBe(true)
    expect(isChecked(kept, 'constructor')).toBe(false)
    await notePending(t.$, ['not a tag', ''])
    await turnEnded(t.$, true)
    expect(Object.keys(await checkedOf(t.$)).length).toBe(30)
    t.state.set('cardChecked', 'something older')
    expect(await checkedOf(t.$)).toEqual({})
  })

  test('a press after the check still reads the package again: a card whose hash moved records nothing, and the words stay out', async () => {
    const t = unchecked()
    await checkedNow(t.$, LABEL)
    t.now.page = { markdown: NEXT_PAGE, sha: NEXT_SHA }
    t.now.render = NEXT_TREE
    await pressSign(t.$, LABEL, t.log)
    expect(t.files.size).toBe(0)
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.gos).toEqual([])
    expect((t.state.get('cardMarks') as MmCardMarks).notice?.kind).toBe('changed')
    // and the box is closed on the new version, saying why
    const said = texts(draw(t.state.get('card') as MmCard, await checkedOf(t.$), { marks: t.state.get('cardMarks') as MmCardMarks })).join('\n')
    expect(said).toContain(THREAD_NOT_CHECKED)
    expect(said).toContain('The package changed, so nothing was signed. Read it again, then sign.')
  })
})

describe('0.7.40 the Changes field: the person\'s words go into the thread, never the go', () => {
  const ELS_IN = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg', Input: 'Input' } as never
  const draw = (card: MmCard, over: Partial<CardDraw> = {}) =>
    drawCard(ELS_IN, { card, marks: { signed: {} }, checked: { [LABEL]: 0 }, busy: false, checkMiss: null, now: 1_000_000, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, onFeedback: () => undefined, surface: 'desktop', ...over })
  /** The Inputs of a drawing, in order, with their props. */
  const inputs = (node: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) {
      for (const n of node) inputs(n, out)
      return out
    }
    // the engine's elements carry an Input's handlers beside `props`, as one `onEvent` that Enter reaches with `{ kind: 'submit', value }`
    const o = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown; onEvent?: unknown }
    const onEvent = o.onEvent as ((e: { kind: string; value: string }) => void) | undefined
    if (o.type === 'Input') out.push({ ...(o.props ?? {}), onSubmit: typeof onEvent === 'function' ? (value: string) => onEvent({ kind: 'submit', value }) : o.props?.onSubmit })
    inputs(o.props?.children, out)
    inputs(o.children, out)
    return out
  }
  /** What the person's words became: the prompts the thread got, the box's words, the record file and the transcript. */
  const withSubmit = (how: 'enters' | 'drop' | 'throws' = 'enters', box = '') => {
    const t = thread(box)
    t.state.set('card', cardOf())
    const submitted: string[] = []
    /** Every submit as the field made it, its options with it. */
    const asks: Array<Record<string, unknown>> = []
    ;(t.$ as unknown as { prompt: Record<string, unknown> }).prompt.submit = async (input: { text: string }) => {
      asks.push({ ...input })
      if (how === 'throws') throw new Error('the session could not take a prompt')
      if (how === 'drop') return { drop: 'a Stop hook stands' }
      submitted.push(input.text)
      return { text: input.text }
    }
    return { ...t, submitted, asks }
  }
  const PKG_ID = SMS_TREE.package_id as string
  /** The card the field was drawn on: its package and tag. */
  const DRAWN = { packageId: PKG_ID, label: LABEL }
  /** A tree whose drawn text has `from` swapped for `to`, as the renderer would draw that package. */
  const swapped = (from: string, to: string): MmCardTree => readTree(JSON.parse(JSON.stringify(SMS_TREE).replace(from, to))) as MmCardTree

  test('the field sits just above the open box, in the client\'s own thread, with its words; the caption names it', () => {
    const open = draw(cardOf())
    const fields = inputs(open)
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ key: `mm-card-feedback:${LABEL}`, label: 'Changes', placeholder: 'What should change? Your thread revises the package and shows it here again.', submitLabel: 'Send to thread', rows: 3 })
    expect([FEEDBACK_LABEL, FEEDBACK_PLACEHOLDER, FEEDBACK_SUBMIT]).toEqual(['Changes', 'What should change? Your thread revises the package and shows it here again.', 'Send to thread'])
    expect(texts(open).join('\n')).toContain(`One press signs and sends: "Send package ${LABEL}" goes to your thread as your go, and it sends the package. Changes go in the Changes box above or the chat box.`)
    expect(texts(open).join('\n')).not.toContain('Changes go in the chat box as usual.')
    // above the box: the field comes before the sign button in the drawing
    const order = JSON.stringify(open)
    expect(order.indexOf(`mm-card-feedback:${LABEL}`)).toBeLessThan(order.indexOf(`mm-card-sign-btn:${LABEL}`))
  })

  test('the field is not tied to the box: it shows while the thread works, before the check and under a hold, once, above the sign area', () => {
    const field = [{ key: `mm-card-feedback:${LABEL}` }]
    expect(inputs(draw(cardOf(), { busy: true }))).toMatchObject(field)
    expect(inputs(draw(cardOf(), { checked: {} }))).toMatchObject(field)
    expect(inputs(draw(cardOf({ current: OTHER })))).toMatchObject(field)
    expect(inputs(draw(cardOf({ gap: 'the page holds a line the card does not' })))).toMatchObject(field)
    for (const d of [draw(cardOf(), { busy: true }), draw(cardOf({ current: OTHER }))]) {
      expect(inputs(d)).toHaveLength(1)
      const order = JSON.stringify(d)
      const under = Math.max(order.indexOf(`mm-card-wait:${LABEL}`), order.indexOf(`mm-card-hold:${LABEL}`))
      expect(under).toBeGreaterThan(-1)
      expect(order.indexOf(`mm-card-feedback:${LABEL}`)).toBeLessThan(under)
    }
  })

  test('while a signature for this tag stands (a go is armed) there is no field and nothing in its place; once it no longer stands the field is back', () => {
    const signedAt = 1_000_000 - 60_000
    const mark = { label: LABEL, signer: 'Test Signer', at: signedAt, pageSha: 'p'.repeat(64), filled: 'sent' as const }
    const sealed = draw(cardOf({ pageSha: 'p'.repeat(64) }), { marks: { signed: { [LABEL]: mark } }, feedback: { label: LABEL, said: 'sent' } })
    expect(texts(sealed).join('\n')).toContain(`Sealed and sent: your go for Package ${LABEL} is in the thread`)
    expect(inputs(sealed)).toEqual([])
    expect(JSON.stringify(sealed)).not.toContain('mm-card-changes:')
    expect(texts(sealed).join('\n')).not.toContain(FEEDBACK_SAID.sent)
    // past SIGN_VALID_MS, or for another page, the signature stands no more: the field is back
    expect(inputs(draw(cardOf({ pageSha: 'p'.repeat(64) }), { marks: { signed: { [LABEL]: mark } }, now: signedAt + SIGN_VALID_MS + 1 }))).toHaveLength(1)
    expect(inputs(draw(cardOf({ pageSha: 'q'.repeat(64) }), { marks: { signed: { [LABEL]: mark } } }))).toHaveLength(1)
  })

  test('a card the renderer drew with no sign box still has the field, once, at its end', () => {
    const pair = CARD_PAIRS['later messages'] as { tree: unknown }
    const t = readTree(JSON.parse(JSON.stringify(pair.tree))) as MmCardTree
    expect(signOf(t)).toBeNull()
    expect(canChange(t)).toBe(true)
    const d = draw(cardOf({ tree: t, current: t.package_sha256 }), { checked: { [t.label]: 0 } })
    expect(inputs(d)).toMatchObject([{ key: `mm-card-feedback:${t.label}` }])
    const order = JSON.stringify(d)
    expect(order.indexOf(`mm-card-feedback:${t.label}`)).toBeLessThan(order.indexOf('mm-card-page:'))
  })

  test('canChange reads the closing, foot and banner lines alone: a client subject "Approved, thanks" settles nothing, the approval banner does', () => {
    const pair = CARD_PAIRS['everything'] as { tree: unknown }
    const everything = readTree(JSON.parse(JSON.stringify(pair.tree))) as MmCardTree
    expect(canChange(everything)).toBe(true)
    const subject = readTree(JSON.parse(JSON.stringify(pair.tree).replace('ZZ_hdr_subject', 'Approved, thanks'))) as MmCardTree
    expect(JSON.stringify(subject)).toContain('Approved, thanks')
    expect(canChange(subject)).toBe(true)
    // a follow-up's subject, and a draft title, are no state line either
    expect(canChange(readTree(JSON.parse(JSON.stringify(pair.tree).replace('ZZ_fu_subject', 'Approved, thanks'))) as MmCardTree)).toBe(true)
    // the banner the renderer draws in place of the box once the package is approved (render_visual.py part_approve)
    const banner = tree()
    const swap = (nodes: MmCardTree['nodes']): void => {
      for (const [i, n] of nodes.entries()) {
        if (n.sign) nodes[i] = { c: 'rp-banner rp-ok', r: [{ s: '✓', c: 'rp-icon' }, { s: 'Approved by Rob Eason, Mon Nov 9, 2:00 PM ET.' }] }
        else if (n.k) swap(n.k)
      }
    }
    swap(banner.nodes)
    expect(signOf(banner)).toBeNull()
    expect(canChange(banner)).toBe(false)
    expect(inputs(draw(cardOf({ tree: banner })))).toEqual([])
  })

  test('an approved package is settled as a closed or a sent one is: no field, nothing in its place; a body that says "Approved" settles nothing', () => {
    const approved = swapped('One go sends 1 item. Package ', 'Approved by Rob Eason, Mon Nov 9, 2:00 PM ET. Package ')
    expect(canChange(approved)).toBe(false)
    const d = draw(cardOf({ tree: approved }), { feedback: { label: LABEL, said: 'sent' } })
    expect(inputs(d)).toEqual([])
    expect(JSON.stringify(d)).not.toContain('mm-card-changes:')
    expect(canChange(swapped('One go sends 1 item. Package ', 'Approved, Mon Nov 9, 2:00 PM ET. Package '))).toBe(false)
    // the client's own words, or ours in a draft, never read as the card's state
    expect(canChange(swapped('Hi! Is the new booking link live yet? Do Saturday slots show?', 'Approved, thanks. Do Saturday slots show?'))).toBe(true)
    expect(canChange(swapped('Book a test slot and tell us if anything looks off.', 'Approved, by us.'))).toBe(true)
  })

  test('no field on a package that can no longer change: closed with no reply owed, or with nothing left to send', () => {
    const closed = readTree(JSON.parse(JSON.stringify((CARD_PAIRS['closed no reply'] as { tree: unknown }).tree))) as MmCardTree
    expect(canChange(closed)).toBe(false)
    expect(inputs(draw(cardOf({ tree: closed, current: closed.package_sha256 }), { checked: { [closed.label]: 0 } }))).toEqual([])
    const sent = swapped('One go sends 1 item. Package ', 'Nothing is left to send. Package ')
    expect(canChange(sent)).toBe(false)
    expect(inputs(draw(cardOf({ tree: sent })))).toEqual([])
    const foot = swapped('Nothing for Rob to decide.', 'Nothing is left to send.')
    expect(canChange(foot)).toBe(false)
    // the words alone inside a body are no state line
    expect(canChange(swapped('Book a test slot and tell us if anything looks off.', 'Book a test slot. Nothing is left to send.'))).toBe(true)
    expect(canChange(tree())).toBe(true)
    // and the line it left is not drawn there either
    expect(texts(draw(cardOf({ tree: sent }), { feedback: { label: LABEL, said: 'sent' } })).join('\n')).not.toContain(FEEDBACK_SAID.sent)
  })

  test('no field on another client\'s card, on a surface with no Input, or with no handler; the line still shows where the field cannot', () => {
    expect(inputs(draw(cardOf({ own: false })))).toEqual([])
    expect(texts(draw(cardOf({ own: false }), { feedback: { label: LABEL, said: 'sent' } })).join('\n')).not.toContain(FEEDBACK_SAID.sent)
    const noInput = drawCard(ELS, { card: cardOf(), marks: { signed: {} }, checked: { [LABEL]: 0 }, busy: false, checkMiss: null, now: 1_000_000, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, onFeedback: () => undefined, feedback: { label: LABEL, said: 'sent' } })
    expect(inputs(noInput)).toEqual([])
    expect(texts(noInput).join('\n')).toContain(FEEDBACK_SAID.sent)
    expect(inputs(draw(cardOf(), { onFeedback: undefined }))).toEqual([])
  })

  test('where no field is drawn (a surface with no Input, as mobile), the caption under the box does not name the Changes box', () => {
    const noInput = drawCard(ELS, { card: cardOf(), marks: { signed: {} }, checked: { [LABEL]: 0 }, busy: false, checkMiss: null, now: 1_000_000, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, onFeedback: () => undefined })
    const said = texts(noInput).join('\n')
    expect(said).toContain(`One press signs and sends: "Send package ${LABEL}" goes to your thread as your go, and it sends the package. Changes go in the chat box.`)
    expect(said).not.toContain('Changes box')
    expect(texts(draw(cardOf(), { onFeedback: undefined })).join('\n')).not.toContain('Changes box')
    // with the field above it, the caption names it
    expect(texts(draw(cardOf())).join('\n')).toContain('Changes go in the Changes box above or the chat box.')
  })

  test('the field and the caption that names it are the desktop\'s alone: an Input in the element table says nothing of the surface', () => {
    // every surface's table holds an Input (the engine completes them), mobile's included: the surface decides
    for (const surface of ['mobile', 'terminal', 'vscode', undefined]) {
      const d = draw(cardOf(), { surface })
      expect(inputs(d), String(surface)).toEqual([])
      const said = texts(d).join('\n')
      expect(said, String(surface)).toContain(`One press signs and sends: "Send package ${LABEL}" goes to your thread as your go, and it sends the package. Changes go in the chat box.`)
      expect(said, String(surface)).not.toContain('Changes box')
      // the line a submit left still shows there
      expect(texts(draw(cardOf(), { surface, feedback: { label: LABEL, said: 'sent' } })).join('\n'), String(surface)).toContain(FEEDBACK_SAID.sent)
    }
    expect(inputs(draw(cardOf(), { surface: 'desktop' }))).toHaveLength(1)
  })

  test('while a press is being checked there is no field, and the field takes nothing: the go may be about to be armed', async () => {
    const checking = { signed: {}, checking: { label: LABEL, at: 1_000_000 - 1_000 } }
    const d = draw(cardOf(), { marks: checking })
    expect(inputs(d)).toEqual([])
    expect(JSON.stringify(d)).not.toContain('mm-card-changes:')
    const t = withSubmit()
    t.state.set('cardMarks', checking)
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.submitted).toEqual([])
    expect(t.fills).toEqual([])
    expect(await feedbackOf(t.$)).toBeNull()
    // a check long since over holds nothing back
    expect(inputs(draw(cardOf(), { marks: { signed: {}, checking: { label: LABEL, at: 0 } } }))).toHaveLength(1)
  })

  test('Enter hands the drawn tag and the words to the handler', () => {
    const got: Array<[string, string]> = []
    const field = inputs(draw(cardOf(), { onFeedback: (label, words) => void got.push([label, words]) }))[0]
    ;(field?.onSubmit as (v: string) => void)('make it shorter')
    expect(got).toEqual([[LABEL, 'make it shorter']])
  })

  test('the line it leaves is drawn for that tag alone, while the box is open and while the thread works; a new tag clears it', () => {
    const sent = { label: LABEL, said: 'sent' as const }
    expect(texts(draw(cardOf(), { feedback: sent })).join('\n')).toContain(FEEDBACK_SAID.sent)
    expect(texts(draw(cardOf(), { feedback: sent, busy: true })).join('\n')).toContain(FEEDBACK_SAID.sent)
    expect(texts(draw(cardOf(), { feedback: { label: 'aaaaaaaaaaaa', said: 'sent' } })).join('\n')).not.toContain(FEEDBACK_SAID.sent)
    expect(FEEDBACK_SAID.sent).toBe('Sent to your thread. It is revising the package and will show the new card here.')
    expect(FEEDBACK_SAID.go).toBe('That reads like a go. Use the box below to sign and send.')
    expect(FEEDBACK_SAID.filled).toBe('That did not reach your thread, so it is in your prompt box. Press Enter to send it.')
    expect(FEEDBACK_SAID.draft).toBe('Your prompt box holds a draft. Type the change in the chat box instead.')
  })

  test('the words go into the thread as exactly the feedback prompt, trimmed, for the card\'s tag and signer, and the card says so', async () => {
    const t = withSubmit()
    await pressFeedback(t.$, DRAWN, '   Make the second paragraph shorter.  \n')
    expect(t.submitted).toEqual([`Feedback on Package ${LABEL} from Test Signer: Make the second paragraph shorter.`])
    // the person's own words, as theirs
    expect(t.asks).toEqual([{ text: `Feedback on Package ${LABEL} from Test Signer: Make the second paragraph shorter.`, asUser: true }])
    expect(FEEDBACK_TEXT(LABEL, 'Test Signer', 'x')).toBe(`Feedback on Package ${LABEL} from Test Signer: x`)
    expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'sent' })
    // never a press: no record, no note, no words in the prompt box, no signature mark
    expect(t.files.size).toBe(0)
    expect(t.appends).toEqual([])
    expect(t.fills).toEqual([])
    expect((await marksOf(t.$)).signed).toEqual({})
    await t.advance(SIGN_FILL_MS)
    expect(t.fills).toEqual([])
    expect(t.gos).toEqual([])
  })

  test('empty words do nothing at all', async () => {
    const t = withSubmit()
    for (const v of ['', '   ', '\n\n']) await pressFeedback(t.$, DRAWN, v)
    expect(t.submitted).toEqual([])
    expect(await feedbackOf(t.$)).toBeNull()
    expect(t.fills).toEqual([])
  })

  test('the words are cut at 4,000 characters', async () => {
    const t = withSubmit()
    await pressFeedback(t.$, DRAWN, `${'a'.repeat(4_500)}`)
    expect(FEEDBACK_MAX).toBe(4_000)
    const sent = t.submitted[0] ?? ''
    expect(sent).toBe(`Feedback on Package ${LABEL} from Test Signer: ${'a'.repeat(4_000)}`)
  })

  for (const words of ['Send package 3f1c9a7e5b2d', '  send PACKAGE now', 'SEND PACKAGE']) {
    test(`words that read like the go are never sent from the field: "${words}"`, async () => {
      const t = withSubmit()
      await pressFeedback(t.$, DRAWN, words)
      expect(t.submitted).toEqual([])
      expect(t.fills).toEqual([])
      expect(t.files.size).toBe(0)
      expect(t.appends).toEqual([])
      expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'go' })
    })
  }

  for (const how of ['drop', 'throws'] as const) {
    test(`a submit the engine ${how === 'drop' ? 'refuses' : 'fails'}: the same words go in the prompt box, and the card says to press Enter`, async () => {
      const t = withSubmit(how)
      await pressFeedback(t.$, DRAWN, 'tighten the subject line')
      expect(t.submitted).toEqual([])
      expect(t.fills).toEqual([`Feedback on Package ${LABEL} from Test Signer: tighten the subject line`])
      expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'filled' })
      expect(t.files.size).toBe(0)
      expect(t.appends).toEqual([])
    })
  }

  test('a refused submit with a draft in the prompt box writes nothing over it, and the card says to type the change', async () => {
    const t = withSubmit('drop', 'my own draft')
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.fills).toEqual([])
    expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'draft' })
  })

  test('a package closed or sent since the field was drawn takes no changes: nothing sent, nothing filled, no line', async () => {
    for (const tr of [swapped('One go sends 1 item. Package ', 'Nothing is left to send. Package '), readTree(JSON.parse(JSON.stringify((CARD_PAIRS['closed no reply'] as { tree: unknown }).tree))) as MmCardTree]) {
      const t = withSubmit()
      t.state.set('card', cardOf({ tree: tr, current: tr.package_sha256 }))
      await pressFeedback(t.$, { packageId: PKG_ID, label: tr.label }, 'tighten the subject line')
      expect(t.submitted).toEqual([])
      expect(t.fills).toEqual([])
      expect(await feedbackOf(t.$)).toBeNull()
    }
  })

  test('the words go for the tag that was drawn; a card that moved on while the person typed sends nothing and says so under the new tag', async () => {
    const t = withSubmit()
    const next = readTree(JSON.parse(NEXT_TREE)) as MmCardTree
    t.state.set('card', cardOf({ current: NEXT_SHA, tree: next }))
    await pressFeedback(t.$, DRAWN, 'one more change')
    expect(t.submitted).toEqual([])
    expect(t.fills).toEqual([])
    expect(await feedbackOf(t.$)).toEqual({ label: NEXT, said: 'changed' })
    expect(FEEDBACK_SAID.changed).toBe('This package changed while you typed. Read the new card and send your change again.')
    // the new card draws that line, under its own field
    expect(texts(draw(cardOf({ current: NEXT_SHA, tree: next }), { checked: { [NEXT]: 0 }, feedback: { label: NEXT, said: 'changed' } })).join('\n')).toContain(FEEDBACK_SAID.changed)
    // the drawn tag on the card that is current: sent for it
    await pressFeedback(t.$, { packageId: PKG_ID, label: NEXT }, 'one more change')
    expect(t.submitted).toEqual([`Feedback on Package ${NEXT} from ${signOf(next)?.signer}: one more change`])
  })

  test('another client\'s card, or another package, takes no changes: nothing sent, nothing filled, no line', async () => {
    for (const [card, drawn] of [
      [cardOf({ own: false }), DRAWN],
      [cardOf(), { packageId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', label: LABEL }],
      [cardOf({ packageId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' }), DRAWN],
      [cardOf({ tree: null }), DRAWN],
    ] as Array<[MmCard, { packageId: string; label: string }]>) {
      const t = withSubmit()
      t.state.set('card', card)
      await pressFeedback(t.$, drawn, 'tighten the subject line')
      expect(t.submitted).toEqual([])
      expect(t.fills).toEqual([])
      expect(await feedbackOf(t.$)).toBeNull()
    }
  })

  test('while a signature for this tag stands, the field takes nothing: the go is armed, so nothing is sent beside it', async () => {
    const t = withSubmit()
    t.state.set('card', cardOf({ pageSha: 'p'.repeat(64) }))
    t.state.set('cardMarks', { signed: { [LABEL]: { label: LABEL, signer: 'Test Signer', at: 1_000_000 - 1_000, pageSha: 'p'.repeat(64), filled: 'filled' } } })
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.submitted).toEqual([])
    expect(t.fills).toEqual([])
    expect(await feedbackOf(t.$)).toBeNull()
  })

  test('an approved package takes no changes either', async () => {
    const t = withSubmit()
    t.state.set('card', cardOf({ tree: swapped('One go sends 1 item. Package ', 'Approved by Rob Eason, Mon Nov 9, 2:00 PM ET. Package ') }))
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.submitted).toEqual([])
    expect(await feedbackOf(t.$)).toBeNull()
  })

  test('a thread at work takes the words once it finishes, and the card says so, Stop included', async () => {
    const t = withSubmit()
    t.state.set('cardBusy', true)
    expect(await busyOf(t.$)).toBe(true)
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.submitted).toEqual([`Feedback on Package ${LABEL} from Test Signer: tighten the subject line`])
    expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'busy' })
    expect(FEEDBACK_SAID.busy).toBe('Your thread is busy, so it reads this when it finishes. A send already under way is not stopped by this: press Stop for that.')
    expect(texts(draw(cardOf(), { busy: true, feedback: { label: LABEL, said: 'busy' } })).join('\n')).toContain(FEEDBACK_SAID.busy)
  })

  test('once the change is in, a go left in the prompt box for this tag is cleared and its signature mark dropped: no go stays armed', async () => {
    const t = withSubmit('enters', `Send package ${LABEL}`)
    // a signature that no longer stands (another page), its words still in the box
    t.state.set('card', cardOf({ pageSha: 'q'.repeat(64) }))
    const old = { label: LABEL, signer: 'Test Signer', at: 1_000_000 - 1_000, pageSha: 'p'.repeat(64), filled: 'filled' as const }
    const other = { ...old, label: '0'.repeat(12) }
    t.state.set('cardMarks', { signed: { [LABEL]: old, ['0'.repeat(12)]: other } })
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.submitted).toEqual([`Feedback on Package ${LABEL} from Test Signer: tighten the subject line`])
    expect(t.fills).toEqual([''])
    expect((await marksOf(t.$)).signed).toEqual({ ['0'.repeat(12)]: other })
    expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'sent' })
    expect(t.files.size).toBe(0)
    expect(t.appends).toEqual([])
  })

  test('a prompt box holding anything but this tag\'s go is never touched: a draft, another package\'s go', async () => {
    for (const box of ['my own draft', `Send package ${'0'.repeat(12)}`, `Send package ${LABEL} and more`]) {
      const t = withSubmit('enters', box)
      await pressFeedback(t.$, DRAWN, 'tighten the subject line')
      expect(t.submitted).toHaveLength(1)
      expect(t.fills).toEqual([])
    }
  })

  test('a submit the thread did not take clears nothing: the go stays as it was, and the words go to the box as before', async () => {
    const t = withSubmit('drop', `Send package ${LABEL}`)
    t.state.set('cardMarks', { signed: { [LABEL]: { label: LABEL, signer: 'Test Signer', at: 0, pageSha: 'p'.repeat(64), filled: 'filled' } } })
    await pressFeedback(t.$, DRAWN, 'tighten the subject line')
    expect(t.fills).toEqual([])
    expect(Object.keys((await marksOf(t.$)).signed)).toEqual([LABEL])
    expect(await feedbackOf(t.$)).toEqual({ label: LABEL, said: 'draft' })
  })
})

describe('0.7.40 the row of the thread\'s own `mm card` call: everything but a ready answer is the engine\'s row', () => {
  const rowHook = hooks['ui.render:{"component":"ToolUse"}'] as (($: unknown, e: Record<string, unknown>, next: (e: unknown) => unknown) => Promise<unknown>) | undefined
  const PKG = SMS_TREE.package_id as string
  const READY = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call, and in the side pane.`
  const row = (over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
    surface: 'desktop', component: 'ToolUse', requestId: 'toolu_1',
    props: { tool_use_id: 'toolu_1', tool: 'mcp__mm-bridge__mm', input: { args: `card ${PKG}` }, isRunning: false, isErrored: false, isInterrupted: false, output: READY, ...props },
    ...over,
  })
  /** The thread's `$` with a surface's elements, and the engine's own row as `next` answers it. */
  const drawing = () => {
    const t = thread()
    ;(t.$ as unknown as Record<string, unknown>).ui = { resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg', Input: 'Input', Markdown: 'Markdown' }) }
    // the pane's client part, drawn: the pane shows this card
    t.state.set('view', { text: '## Example Dental · reply package', heading: '' })
    return t
  }
  const ENGINE_ROW = { engine: 'row' }
  const engine = () => ENGINE_ROW
  const passes = async (t: ReturnType<typeof drawing>, e: Record<string, unknown>) => expect(await rowHook?.(t.$, e, engine)).toBe(ENGINE_ROW)

  test('the hook is registered', () => {
    expect(typeof rowHook).toBe('function')
  })

  test('not ready, any other text, another command, another tool: the engine\'s row, untouched', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    await passes(t, row({}, { output: 'card not ready: the card is still being drawn. Print the whole page.' }))
    await passes(t, row({}, { output: 'something else' }))
    await passes(t, row({}, { output: undefined }))
    await passes(t, row({}, { input: { args: 'queue' }, output: READY }))
    await passes(t, row({}, { input: { args: `card ${PKG.slice(0, 8)}` } }))
    await passes(t, row({}, { input: {} }))
    await passes(t, row({}, { tool: 'Bash' }))
    await passes(t, row({}, { tool: 'mcp__other__mm' }))
  })

  test('a call still running, errored or interrupted: the engine\'s row', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    await passes(t, row({}, { isRunning: true, output: undefined }))
    await passes(t, row({}, { isErrored: true }))
    await passes(t, row({}, { isInterrupted: true }))
  })

  test('every surface but the desktop: the engine\'s row', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    for (const surface of ['terminal', 'mobile', 'vscode']) await passes(t, row({ surface }))
    // and the desktop draws its own
    expect(await rowHook?.(t.$, row(), engine)).not.toBe(ENGINE_ROW)
  })

  test('a draw that throws is the engine\'s row, with one line in bridge-notices.log', async () => {
    const t = drawing()
    t.state.set('card', cardOf({ tree: { ...tree(), nodes: 5 as never } }))
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    await passes(t, row())
    for (let i = 0; i < 50; i++) await Promise.resolve()
    const log = t.files.get(`${HOME}/.claude/mm-hooks/bridge-notices.log`) ?? ''
    expect(log).toContain(`card for package ${PKG} could not be drawn in the thread: `)
    // the same failure again draws the engine's row and writes no second line
    await passes(t, row())
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect((t.files.get(`${HOME}/.claude/mm-hooks/bridge-notices.log`) ?? '').trim().split('\n')).toHaveLength(1)
  })

  test('the draw failures noted once each are kept to 200, the oldest dropped first', () => {
    expect(ROW_FAILURES_MAX).toBe(200)
    const key = (n: number) => `cap-test-${n}`
    for (let n = 0; n <= 200; n++) expect(firstRowFailure(key(n))).toBe(true)
    // 201 noted: the first has gone, so it is noted again; the newest is still held
    expect(firstRowFailure(key(200))).toBe(false)
    expect(firstRowFailure(key(1))).toBe(false)
    expect(firstRowFailure(key(0))).toBe(true)
  })

  test('the three lines in place of the card, word for word', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_2' })
    // the same tag, not the live call
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_AGAIN(LABEL)])
    expect(ROW_AGAIN(LABEL)).toBe(`Shown again below. Package ${LABEL}.`)
    // a tag since replaced
    const older = `card ready: Package ${'0'.repeat(12)}. The whole package is checked and drawn in this thread, under this call, and in the side pane.`
    expect(texts(await rowHook?.(t.$, row({}, { output: older }), engine))).toEqual([ROW_REPLACED('0'.repeat(12), LABEL)])
    expect(ROW_REPLACED('0'.repeat(12), LABEL)).toBe(`Package ${'0'.repeat(12)} was replaced by Package ${LABEL}. Read and sign the newer card below.`)
    // a package the bridge no longer holds
    t.state.set('card', NO_CARD)
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
    expect(ROW_GONE).toBe('This card is not held here right now. Open this client in the side pane, or ask your thread to show the package again.')
  })

  // (0.7.41, Rob 2026-11-09: "make it disappear from the side panel once it's sent, whether you send it in the side panel or from the chat")
  test('(0.7.41) a package the last sync lists nowhere (sent, closed, handed on): its row says so, never to open it again', async () => {
    const t = drawing()
    const stored: Record<string, unknown> = {}
    ;(t.$ as unknown as Record<string, unknown>).store = { get: async (k: string) => stored[k] }
    t.state.set('card', NO_CARD)
    t.state.set('view', { text: '', heading: '' })
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    // no sync on record: the line it had
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
    // a sync that still lists the package (its client's own, or open): the line it had
    stored['mm.last'] = { at: 1, items: [{ projectId: 'p', packageId: PKG, kind: 'ready', open: null }] }
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
    stored['mm.last'] = { at: 1, items: [{ projectId: 'p', packageId: null, kind: 'task', open: { id: PKG, state: 'held_by_other' } }] }
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
    // a sync that lists it nowhere
    stored['mm.last'] = { at: 2, items: [{ projectId: 'q', packageId: null, kind: 'task', open: null }] }
    const drawn = await rowHook?.(t.$, row(), engine)
    expect(texts(drawn)).toEqual([ROW_LEFT(LABEL)])
    expect(buttons(drawn).size).toBe(0)
    expect(ROW_LEFT(LABEL)).toBe(`Package ${LABEL} is no longer waiting: the last sync lists nothing of it for you to send.`)
    // a store that cannot be read: the line it had
    ;(t.$ as unknown as Record<string, unknown>).store = { get: async () => { throw new Error('no store') } }
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
  })

  test('where the pane draws no card (its client part shows none), the live row draws one dim line and no box: the pane\'s own test', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    expect(cardDrawable('## Example Dental · reply package', cardOf())).toBe(true)
    for (const view of [{ text: '', heading: '' }, undefined]) {
      t.state.set('view', view)
      expect(cardDrawable(view?.text, cardOf())).toBe(false)
      const drawn = await rowHook?.(t.$, row(), engine)
      expect(texts(drawn)).toEqual([ROW_GONE])
      expect(buttons(drawn).size).toBe(0)
    }
    // a card not yet read is not drawn by the pane either
    expect(cardDrawable('## Example Dental · reply package', cardOf({ tree: null }))).toBe(false)
  })

  test('with no live call on record (a new process), every ready row draws the not-held line, never "Shown again below"', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    expect(await askedOf(t.$)).toBeNull()
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
    const older = `card ready: Package ${'0'.repeat(12)}. The whole package is checked and drawn in this thread, under this call, and in the side pane.`
    expect(texts(await rowHook?.(t.$, row({}, { output: older }), engine))).toEqual([ROW_GONE])
    // a live call for another package is none for this one
    await noteAsked(t.$, { packageId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', label: LABEL, toolUseId: 'toolu_1' })
    expect(texts(await rowHook?.(t.$, row(), engine))).toEqual([ROW_GONE])
  })

  test('the live call draws the card, from content blocks as well as a plain string', async () => {
    const t = drawing()
    t.state.set('card', cardOf())
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
    for (const output of [READY, [{ type: 'text', text: READY }], { content: [{ type: 'text', text: READY }], isError: false }, { result: READY }]) {
      const all = texts(await rowHook?.(t.$, row({}, { output }), engine)).join('\n')
      expect(all).toContain('Hi! Is the new booking link live yet? Do Saturday slots show?')
      expect(all).toContain('✍  Click to sign and send')
    }
    expect(await askedOf(t.$)).toMatchObject({ packageId: PKG, label: LABEL, toolUseId: 'toolu_1' })
  })
})

describe('0.7.40 the answer under a row the bridge drew is hidden, and a folded group holding the live call is unfolded', () => {
  type Hook = ($: unknown, e: Record<string, unknown>, next: (e: unknown) => unknown) => Promise<unknown>
  const rowHook = hooks['ui.render:{"component":"ToolUse"}'] as Hook
  const resultHook = hooks['ui.render:{"component":"ToolResult"}'] as Hook
  const groupHook = hooks['ui.render:{"component":"ToolGroup"}'] as Hook
  const PKG = SMS_TREE.package_id as string
  const READY = `card ready: Package ${LABEL}. The whole package is checked and drawn in this thread, under this call, and in the side pane.`
  const ENGINE = { engine: 'drawing' }
  const engine = () => ENGINE
  const drawing = () => {
    const t = thread()
    const invalidated: string[] = []
    ;(t.$ as unknown as Record<string, unknown>).ui = {
      resolve: () => ({ Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg', Input: 'Input', Markdown: 'Markdown' }),
      invalidate: (event: string) => void invalidated.push(event),
    }
    t.state.set('card', cardOf())
    t.state.set('view', { text: '## Example Dental · reply package', heading: '' })
    return { ...t, invalidated }
  }
  const useRow = (id: string, props: Record<string, unknown> = {}, surface = 'desktop') => ({
    surface, component: 'ToolUse', requestId: id,
    props: { tool_use_id: id, tool: 'mcp__mm-bridge__mm', input: { args: `card ${PKG}` }, isRunning: false, isErrored: false, isInterrupted: false, output: READY, ...props },
  })
  const resultRow = (id: string, props: Record<string, unknown> = {}, surface = 'desktop') => ({
    surface, component: 'ToolResult', requestId: id, props: { tool_use_id: id, tool: 'mcp__mm-bridge__mm', output: READY, isErrored: false, ...props },
  })
  /** An empty Box: nothing visible. */
  const isEmptyBox = (tree: unknown) => {
    const o = tree as { type?: unknown; props?: { children?: unknown }; children?: unknown }
    const kids = [o.props?.children, o.children].flat().filter(x => x !== undefined && x !== null && x !== false && !(Array.isArray(x) && x.length === 0))
    return o.type === 'Box' && kids.length === 0 && texts(tree).length === 0
  }

  test('the hooks are registered', () => {
    expect(typeof resultHook).toBe('function')
    expect(typeof groupHook).toBe('function')
  })

  test('under the live card one dim line says how to get the page; under each of the three lines nothing visible. Any other result: the engine\'s', async () => {
    const t = drawing()
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_r1' })
    // the live call: the card, and under it the fail-safe line in place of the model's answer, drawn by the result itself
    expect(texts(await rowHook(t.$, useRow('toolu_r1'), engine)).join('\n')).toContain('Hi! Is the new booking link live yet?')
    const hint = (await resultHook(t.$, resultRow('toolu_r1'), engine)) as { type?: unknown; props?: { dimColor?: unknown } }
    expect(texts(hint)).toEqual([RESULT_HINT])
    expect(hint.type).toBe('Text')
    expect(hint.props?.dimColor).toBe(true)
    expect(RESULT_HINT).toBe(`If any part of the card above doesn't show, say "print the page" and your thread prints the whole package as text.`)
    expect(texts(hint).join('')).not.toContain('card ready')
    // an earlier ask of the same tag: its line, and its answer hidden too
    expect(texts(await rowHook(t.$, useRow('toolu_r0'), engine))).toEqual([ROW_AGAIN(LABEL)])
    expect(isEmptyBox(await resultHook(t.$, resultRow('toolu_r0'), engine))).toBe(true)
    // a row the hook never drew, another tool, another surface: the engine's
    expect(await resultHook(t.$, resultRow('toolu_never'), engine)).toBe(ENGINE)
    expect(await resultHook(t.$, resultRow('toolu_r1', { tool: 'Bash' }), engine)).toBe(ENGINE)
    expect(await resultHook(t.$, resultRow('toolu_r1', {}, 'terminal'), engine)).toBe(ENGINE)
    // the first draw of each row asked for one redraw, so an answer drawn before its row is hidden too; a second draw asks for none
    expect(t.invalidated).toEqual(['ui.render', 'ui.render'])
    await rowHook(t.$, useRow('toolu_r1'), engine)
    expect(t.invalidated).toEqual(['ui.render', 'ui.render'])
  })

  test('a row whose draw fell back to the engine\'s keeps its answer: a not-ready answer, a terminal row, a draw that throws', async () => {
    const t = drawing()
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_f1' })
    expect(await rowHook(t.$, useRow('toolu_f2', { output: 'card not ready: the card is still being drawn. Print the whole page.' }), engine)).toBe(ENGINE)
    expect(await resultHook(t.$, resultRow('toolu_f2', { output: 'card not ready: the card is still being drawn. Print the whole page.' }), engine)).toBe(ENGINE)
    expect(await rowHook(t.$, useRow('toolu_f1', {}, 'terminal'), engine)).toBe(ENGINE)
    expect(await resultHook(t.$, resultRow('toolu_f1', {}, 'terminal'), engine)).toBe(ENGINE)
    // drawn, then a later draw of the same row falls back (it throws): its answer shows again
    expect(texts(await rowHook(t.$, useRow('toolu_f1'), engine)).join('\n')).toContain('Hi! Is the new booking link live yet?')
    expect(texts(await resultHook(t.$, resultRow('toolu_f1'), engine))).toEqual([RESULT_HINT])
    expect(t.invalidated).toEqual(['ui.render'])
    t.state.set('card', cardOf({ tree: { ...tree(), nodes: 5 as never } }))
    expect(await rowHook(t.$, useRow('toolu_f1'), engine)).toBe(ENGINE)
    expect(await resultHook(t.$, resultRow('toolu_f1'), engine)).toBe(ENGINE)
    // unlisting a listed row asks for one redraw, so an answer already hidden is drawn again; a row never listed asks for none
    expect(t.invalidated).toEqual(['ui.render', 'ui.render'])
    expect(await rowHook(t.$, useRow('toolu_f1'), engine)).toBe(ENGINE)
    expect(t.invalidated).toEqual(['ui.render', 'ui.render'])
  })

  test('a draw failure of the live ready row tells the thread once a tag, framed as the bridge\'s; never for an old row, a not-ready answer or no live call', async () => {
    // a tag no other test here fails on: the told tags are kept for the session
    const next = readTree(JSON.parse(NEXT_TREE)) as MmCardTree
    const NEXT_READY = `card ready: Package ${NEXT}. The whole package is checked and drawn in this thread, under this call, and in the side pane.`
    const t = drawing()
    const asks: Array<Record<string, unknown>> = []
    ;(t.$ as unknown as { prompt: Record<string, unknown> }).prompt.submit = async (input: Record<string, unknown>) => {
      asks.push({ ...input })
      return { text: input.text }
    }
    const settle = async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    t.state.set('card', cardOf({ current: NEXT_SHA, tree: { ...next, nodes: 5 as never } }))
    // with no live call on record, and for a row that is not the live one: their lines, which draw, and nothing told
    expect(texts(await rowHook(t.$, useRow('toolu_x1', { output: NEXT_READY }), engine))).toEqual([ROW_GONE])
    await noteAsked(t.$, { packageId: PKG, label: NEXT, toolUseId: 'toolu_x2' })
    expect(texts(await rowHook(t.$, useRow('toolu_x1', { output: NEXT_READY }), engine))).toEqual([ROW_AGAIN(NEXT)])
    // a not-ready answer of the live call never reaches the draw
    expect(await rowHook(t.$, useRow('toolu_x2', { output: 'card not ready: the card is still being drawn. Print the whole page.' }), engine)).toBe(ENGINE)
    await settle()
    expect(asks).toEqual([])
    // the live ready row: told once, framed (no asUser), in exactly these words
    expect(await rowHook(t.$, useRow('toolu_x2', { output: NEXT_READY }), engine)).toBe(ENGINE)
    await settle()
    expect(asks).toEqual([{ text: DRAW_FAILED(NEXT) }])
    expect(DRAW_FAILED(NEXT)).toBe(`[Massmarket bridge] The card for Package ${NEXT} could not be drawn in this thread. Print the whole page now, as client-reply-prep §9.3 says for a card that is not ready.`)
    // and never again for this tag: a redraw, a later live call
    expect(await rowHook(t.$, useRow('toolu_x2', { output: NEXT_READY }), engine)).toBe(ENGINE)
    await noteAsked(t.$, { packageId: PKG, label: NEXT, toolUseId: 'toolu_x3' })
    expect(await rowHook(t.$, useRow('toolu_x3', { output: NEXT_READY }), engine)).toBe(ENGINE)
    await settle()
    expect(asks).toHaveLength(1)
    // no record, no note, no words in the prompt box
    expect(t.files.has(SIGNED_FILE)).toBe(false)
    expect(t.appends).toEqual([])
    expect(t.fills).toEqual([])
  })

  test('the card\'s page button asks whether anything is missing; open, it says what it always said', () => {
    const els = { Box: 'Box', Text: 'Text', Button: 'Button', Link: 'Link', Svg: 'Svg', Input: 'Input' } as never
    const base = { card: cardOf(), checked: { [LABEL]: 0 }, busy: false, checkMiss: null, now: 1_000_000, onSign: () => undefined, onCheck: () => undefined, onAsk: () => undefined, onPage: () => undefined, surface: 'desktop' }
    expect([...buttons(drawCard(els, { ...base, marks: { signed: {} } })).keys()]).toContain('Anything missing? Show the whole package as text  ▸')
    expect([...buttons(drawCard(els, { ...base, marks: { signed: {} } })).keys()]).not.toContain('Show the page as text  ▸')
    expect([...buttons(drawCard(els, { ...base, marks: { signed: {}, pageOpen: true } })).keys()]).toContain('Hide the page as text  ▾')
  })

  test('a folded group that holds the live call is unfolded; any other group, an unfolded one, or another surface is the engine\'s', async () => {
    const t = drawing()
    await noteAsked(t.$, { packageId: PKG, label: LABEL, toolUseId: 'toolu_g1' })
    const call = (id?: string) => ({ ...(id ? { tool_use_id: id } : {}), tool: 'mcp__mm-bridge__mm', input: { args: `card ${PKG}` }, isRunning: false, isErrored: false, isInterrupted: false, output: READY })
    const group = (calls: unknown[], over: Record<string, unknown> = {}, surface = 'desktop') => ({ surface, component: 'ToolGroup', requestId: 'g', props: { calls, isActive: false, isExpanded: false, ...over } })
    let seen: unknown
    const next = (e: unknown) => {
      seen = e
      return ENGINE
    }
    const holding = group([{ tool_use_id: 'toolu_read', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }, call('toolu_g1')])
    expect(await groupHook(t.$, holding, next)).toBe(ENGINE)
    expect(seen).toEqual({ ...holding, props: { ...holding.props, isExpanded: true } })
    for (const e of [group([call('toolu_other')]), group([call()]), group([call('toolu_g1')], { isExpanded: true }), group([call('toolu_g1')], {}, 'terminal'), group([])]) {
      expect(await groupHook(t.$, e, next)).toBe(ENGINE)
      expect(seen).toBe(e)
    }
    // with no live call on record, nothing is unfolded
    t.state.delete('cardAsked')
    expect(await groupHook(t.$, holding, next)).toBe(ENGINE)
    expect(seen).toBe(holding)
  })
})
