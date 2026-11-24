// The bridge against a pretend desktop app, feed and store: a client's thread that says it waits on the person (0.7.68).
//
// Rob, 2026-11-23, of two client threads that ended their turn waiting on him with nothing on OW's feed to pin them: "why
// are they waiting on me but not pinned? yeah you should pin them and we may need to fix something". Then: "it depends on
// what the question is and how important it is I answer it. you almost always end with a question. we can probably come up
// with some rules around what types of questions need answering." Claude recommended four kinds of question (send, money,
// only-you, risk), and he approved them: "Yes, build it". (The four kinds are the approved recommendation, not his words.)
//
// So the thread declares it through the mm tool (`waiting <type> -- <question>`), and the bridge pins it until the person
// answers there, the thread takes it back, a newer declaration replaces it, or the thread is archived or unlinked. Every
// client below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { answerTitle, answerWhy, threadWhy } from './queue'
import type { Feed } from './queue'
import { ANSWER_CLEARED, ANSWER_CLIENTS_ONLY, ANSWER_REFUSED, ANSWER_TOOL_TEXT, ASK_MAX, answerArgs, answerNoted, cutAsk, declaredOf, pinReport } from './threads'
import type { PinReport } from './threads'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, HOUR, LONG, ACME, SELF, thread, feed, world, tool, person, tickOnce, bandLines, minutesOn } from './register-world.test-helper'

const ACME_NAME = 'Acme Roofing'
/** Nothing on OW's feed for anyone: every client is clear. The member's projects still name Acme. */
const silent = (over: Partial<Feed> = {}): Feed => feed({ drafts: [], mail: [], tickets: {}, projects: [{ project_id: ACME, name: 'Acme Roofing — Pat' }], ...over } as Partial<Feed>)
/** This thread (the one the tool runs in) is Acme's linked thread. */
const linked = { 'mm.links': { [ACME]: SELF } }
type W = ReturnType<typeof world>
const pinnedHere = (w: W, sid = SELF) => w.threads.get(sid)?.pinned === true
const pinRecord = (w: W, sid = SELF) => (w.stored['mm.pins'] as Record<string, unknown> | undefined)?.[sid]
const declaredHere = (w: W) => (w.stored['mm.waiting'] ?? {}) as Record<string, { type: string; ask: string; at: number }>
/** The sync a declaration (or its clearing) asks for runs a second later. */
const settle = async (w: W) => w.clock.advance(2_000)
const acmeWorld = (on: On, over: WorldOptions = {}) => world(on, { feed: silent(), ...over, store: { ...linked, ...(over.store ?? {}) } })
const whyLine = async ($: Engine) => (await bandLines($)).lines.find(l => l.startsWith('Pinned') || l.startsWith('No pin needed'))
const ASK = 'Schedule the four follow-ups as printed?'

describe('0.7.68: the question, as the bridge keeps it', () => {
  test('cutAsk: one line, no double quotes, cut on a word boundary at about 140 characters', () => {
    expect(cutAsk('  Send the\nrecap to "Pat"?  ')).toBe("Send the recap to 'Pat'?")
    const long = `${'word '.repeat(60)}end?`
    const cut = cutAsk(long)
    expect([...cut].length).toBeLessThanOrEqual(ASK_MAX)
    expect(cut.endsWith('word…')).toBe(true)
    expect(cutAsk(undefined)).toBe('')
  })

  test('answerArgs: the four kinds and a question; clear; anything else refused in one line naming the four', () => {
    expect(answerArgs(`send -- ${ASK}`)).toEqual({ type: 'send', ask: ASK })
    expect(answerArgs('ONLY-YOU -- Sign in to the client\'s HighLevel?')).toEqual({ type: 'only-you', ask: "Sign in to the client's HighLevel?" })
    expect(answerArgs('money--Credit the $40 back?')).toEqual({ type: 'money', ask: 'Credit the $40 back?' })
    expect(answerArgs('clear')).toEqual({ clear: true })
    for (const bad of ['urgent -- Is this OK?', 'send --', 'send -- ', 'send', '', 'risk Is the data safe?']) expect(answerArgs(bad)).toBe(ANSWER_REFUSED)
    expect(ANSWER_REFUSED).not.toContain('\n')
    for (const t of ['send', 'money', 'only-you', 'risk']) expect(ANSWER_REFUSED).toContain(t)
  })

  test('declaredOf: a damaged entry is none', () => {
    expect(declaredOf({ local_a: { type: 'send', ask: 'Go?', at: 1 }, local_b: { type: 'later', ask: 'Go?', at: 1 }, local_c: { type: 'risk', ask: '', at: 1 }, nope: { type: 'risk', ask: 'x', at: 1 }, local_d: { type: 'risk', ask: 'x' } })).toEqual({ local_a: { type: 'send', ask: 'Go?', at: 1 } })
    expect(declaredOf(null)).toEqual({})
    expect(declaredOf([1])).toEqual({})
  })

  test('the pin sentence names the kind; the feed\'s own Pinned sentence wins over it', () => {
    expect(answerWhy('send', ASK)).toBe(`Pinned for you: this thread needs your answer (a go to send): "${ASK}".`)
    expect(answerWhy('money', 'Credit it?')).toBe('Pinned for you: this thread needs your answer (money): "Credit it?".')
    expect(answerWhy('only-you', 'Sign in?')).toBe('Pinned for you: this thread needs your answer (only you can do this): "Sign in?".')
    expect(answerWhy('risk', 'Pause the flow?')).toBe('Pinned for you: this thread needs your answer (a risk): "Pause the flow?".')
    expect(threadWhy(undefined, ACME_NAME, NOW, { answer: { type: 'send', ask: ASK } })).toBe(answerWhy('send', ASK))
    expect(threadWhy(undefined, ACME_NAME, NOW)).toBe(`No pin needed: nothing of ${ACME_NAME}'s waits on you.`)
    expect(answerTitle(ACME_NAME)).toBe('🟡 Acme Roofing · waiting on you')
  })

  test('the pin report: kind `waiting`, no due time, and only the ids go in', () => {
    const report: PinReport = pinReport({
      now: NOW,
      listed: [],
      links: { [ACME]: 'local_a' },
      thread: () => ({ sessionId: 'local_a', title: 't', pinned: true, isArchived: false, lastActivityAt: '' }) as never,
      hidden: () => false,
      stayedOff: new Set(),
      capped: new Set(),
      waiting: new Map([[ACME, 'local_a']]),
      byUs: () => true,
      client: () => ACME_NAME,
    })
    expect(report.items).toEqual([{ project_id: ACME, client: ACME_NAME, kind: 'waiting', tone: 'yellow', due_at: null, pinned: true, why_not: null, clock: 'internal' }])
    expect(report.extra).toEqual([])
  })
})

describe('0.7.68: a client\'s thread that says it waits on the person is pinned (Rob, 2026-11-23: "yeah you should pin them")', () => {
  for (const [type, label] of [['send', 'a go to send'], ['money', 'money'], ['only-you', 'only you can do this'], ['risk', 'a risk']] as const) {
    test(`${type}: pinned as the bridge's with OW's feed silent, named for it, and its band says why`, LONG, async ($, on) => {
      const w = acmeWorld(on)
      await tickOnce($, w)
      expect(pinnedHere(w)).toBe(false)
      expect(await tool($, `waiting ${type} -- ${ASK}`)).toBe(answerNoted(type))
      expect(declaredHere(w)[SELF]).toEqual({ type, ask: ASK, at: NOW + 4_000 })
      await settle(w)
      expect(pinnedHere(w)).toBe(true)
      expect(pinRecord(w)).toEqual({ projectId: ACME, client: ACME_NAME, byUs: true, waiting: true })
      expect(w.threads.get(SELF)?.title).toBe(answerTitle(ACME_NAME))
      expect(await whyLine($)).toBe(`Pinned for you: this thread needs your answer (${label}): "${ASK}".`)
      // and it stays pinned, sync after sync, while nothing has answered it
      await minutesOn(w, 11)
      expect(pinnedHere(w)).toBe(true)
    })
  }

  test('an unknown kind, or no question, is refused in one line, and nothing is stored or pinned', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    expect(await tool($, 'waiting urgent -- Is this OK?')).toBe(ANSWER_REFUSED)
    expect(await tool($, 'waiting send --')).toBe(ANSWER_REFUSED)
    expect(await tool($, 'waiting send')).toBe(ANSWER_REFUSED)
    expect(w.stored['mm.waiting']).toBeUndefined()
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
  })

  test('a thread linked to no client is told the bridge pins client threads only; nothing is stored, nothing pinned', LONG, async ($, on) => {
    const w = world(on, { feed: silent() })
    await tickOnce($, w)
    expect(await tool($, `waiting send -- ${ASK}`)).toBe(ANSWER_CLIENTS_ONLY)
    expect(w.stored['mm.waiting']).toBeUndefined()
    expect(await tool($, 'waiting clear')).toBe(ANSWER_CLEARED)
    expect(w.stored['mm.waiting']).toBeUndefined()
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
  })

  test('the person\'s next prompt in the thread answers it: the declaration goes and the bridge\'s pin comes off; a bridge update or another session\'s message does not', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    await $.prompt.submit({ text: '[mm-bridge] an update', wait: false, origin: { kind: 'peer' } })
    await settle(w)
    expect(declaredHere(w)[SELF]?.ask).toBe(ASK)
    expect(pinnedHere(w)).toBe(true)
    await person($, 'Yes, schedule them.')
    expect(declaredHere(w)[SELF]).toBeUndefined()
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    expect(pinRecord(w)).toBeUndefined()
    expect((await whyLine($))?.startsWith('No pin needed')).toBe(true)
  })

  test('`waiting clear` takes it back, and the bridge\'s pin comes off', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await tool($, `waiting risk -- Pause the client's flow until the data is checked?`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    expect(await tool($, 'waiting clear')).toBe(ANSWER_CLEARED)
    expect(declaredHere(w)[SELF]).toBeUndefined()
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
  })

  test('a newer declaration replaces it: still pinned, with the new question', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    await w.clock.advance(60_000)
    await tool($, 'waiting money -- Take $150 off the second invoice?')
    expect(declaredHere(w)[SELF]?.ask).toBe('Take $150 off the second invoice?')
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    expect(await whyLine($)).toBe('Pinned for you: this thread needs your answer (money): "Take $150 off the second invoice?".')
  })

  test('a thread the person pinned themselves stays theirs, while it waits and after it is answered', LONG, async ($, on) => {
    // (its client's clear was acted on before they pinned it, so R14's sweep leaves their pin alone, as before 0.7.68)
    const w = acmeWorld(on, { self: thread(SELF, 'Morning hub', 0, { pinned: true }), store: { 'mm.cleared': { [SELF]: NOW - HOUR } } })
    await tickOnce($, w)
    expect(pinnedHere(w)).toBe(true)
    await tool($, `waiting only-you -- Sign in to the client's Google Ads so I can read the account?`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    expect(pinRecord(w)).toEqual({ projectId: ACME, client: ACME_NAME, byUs: false, waiting: true })
    await tool($, 'waiting clear')
    await settle(w)
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(true)
    expect(w.calls.filter(c => c.tool === 'set_pinned' && c.args.pinned === false)).toEqual([])
  })

  test('the person takes the pin off after the declaration: it stays off for it, sync after sync; a newer declaration pins it again', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    ;(w.threads.get(SELF) as { pinned: boolean }).pinned = false
    await minutesOn(w, 12)
    expect(pinnedHere(w)).toBe(false)
    expect((w.stored['mm.unpinned'] as Record<string, unknown>)[SELF]).toBeDefined()
    expect(declaredHere(w)[SELF]?.ask).toBe(ASK)
    await tool($, 'waiting send -- Send the revised recap to Pat?')
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
  })

  test('an archived thread\'s declaration goes with it', LONG, async ($, on) => {
    const w = world(on, {
      feed: silent(),
      // (another open thread too: an empty list from the app never drops anything)
      threads: [thread('local_c1', 'Acme follow-ups', 1), thread('local_other', 'Unrelated notes', 100)],
      store: { 'mm.links': { [ACME]: 'local_c1' }, 'mm.waiting': { local_c1: { type: 'send', ask: ASK, at: NOW - 60_000 } } },
    })
    await tickOnce($, w)
    expect(pinnedHere(w, 'local_c1')).toBe(true)
    ;(w.threads.get('local_c1') as { isArchived: boolean }).isArchived = true
    await minutesOn(w, 6)
    expect(declaredHere(w).local_c1).toBeUndefined()
    // and it is not pinned for it if it comes back
    ;(w.threads.get('local_c1') as { isArchived: boolean; pinned: boolean }).isArchived = false
    ;(w.threads.get('local_c1') as { pinned: boolean }).pinned = false
    await minutesOn(w, 6)
    expect(pinnedHere(w, 'local_c1')).toBe(false)
  })

  test('an unlinked thread\'s declaration goes with its link', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    await tool($, 'unlink')
    expect(declaredHere(w)[SELF]).toBeUndefined()
    await minutesOn(w, 6)
    expect(pinnedHere(w)).toBe(false)
  })

  test('a client the feed lists but does not pin (a task due later in the week): pinned for the declaration under the feed\'s own name, and our pin comes off once it is answered', LONG, async ($, on) => {
    const later = new Date(NOW + 4 * 24 * HOUR).toISOString()
    const w = acmeWorld(on, {
      feed: silent({ tickets: { due_soon: [{ ticket_id: 't9', project_id: ACME, project_name: 'Acme Roofing — Pat', title: 'Build the intake form', due_at: later, due_source: 'commitment', assignee_email: 'builder-a@example.com' }] } } as Partial<Feed>),
      bridgePins: () => ({ status: 200, body: { ok: true } }),
    })
    await tickOnce($, w)
    expect(pinnedHere(w)).toBe(false)
    const feedName = w.threads.get(SELF)?.title
    expect(feedName).toContain(ACME_NAME)
    const feedWhy = await whyLine($)
    expect(feedWhy?.startsWith('No pin needed')).toBe(true)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    expect(w.threads.get(SELF)?.title).toBe(feedName)
    expect(await whyLine($)).toBe(answerWhy('send', ASK))
    // (listed, so OW's report knew the client already; not pinned by the feed, so it is an item only as `waiting`)
    expect((w.pinPosts.at(-1)?.body as PinReport).items.map(i => [i.project_id, i.kind, i.pinned])).toEqual([[ACME, 'waiting', true]])
    await person($, 'Yes.')
    await settle(w)
    expect(pinnedHere(w)).toBe(false)
    expect(await whyLine($)).toBe(feedWhy)
  })

  test('a thread the feed pins too keeps the feed\'s own sentence and name', LONG, async ($, on) => {
    // the default feed: Acme's reply drafts are ready, due within 24 business hours
    const w = world(on, { store: linked })
    await tickOnce($, w)
    expect(pinnedHere(w)).toBe(true)
    const feedWhy = await whyLine($)
    expect(feedWhy?.startsWith('Pinned for you, due')).toBe(true)
    await tool($, `waiting send -- ${ASK}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    expect(await whyLine($)).toBe(feedWhy)
    expect((pinRecord(w) as { waiting?: unknown }).waiting).toBeUndefined()
  })

  test('⛔ the question and its kind never reach the pin report OW gets: the thread is an item of kind `waiting`, no due time', LONG, async ($, on) => {
    const SECRET = 'Approve the ZQXJ discount for the board call?'
    const w = acmeWorld(on, { bridgePins: () => ({ status: 200, body: { ok: true } }) })
    await tickOnce($, w)
    await tool($, `waiting only-you -- ${SECRET}`)
    await settle(w)
    expect(pinnedHere(w)).toBe(true)
    const body = w.pinPosts.at(-1)?.body as PinReport
    expect(body.items).toEqual([{ project_id: ACME, client: ACME_NAME, kind: 'waiting', tone: 'yellow', due_at: null, pinned: true, why_not: null, clock: 'internal' }])
    const sent = JSON.stringify(w.pinPosts.map(p => p.body))
    expect(sent).not.toContain('ZQXJ')
    expect(sent).not.toContain('only-you')
    expect(sent).not.toContain('only you can do this')
    // nor does any other fetch carry it
    expect(w.fetched.join('\n')).not.toContain('ZQXJ')
  })

  test('the mm tool\'s own description carries the four kinds and the never-list, verbatim', async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    const description = w.registered.find(d => d.startsWith('Massmarket bridge, the same as the /mm command.'))
    expect(description).toContain(ANSWER_TOOL_TEXT)
    expect(description).toContain('Never for a go to merge, migrate or deploy our own code, housekeeping, a choice you can make yourself, or anything that can wait.')
  })
})
