// (0.7.80) Open thread on a computer where the system's opener does not take the person to the thread. Shezan, in
// #mmai-it-support on 2026-11-25 (Discord 1575178267260887081): on Ubuntu 24.04, GNOME on X11, every press said only
// `Open "<title>" under Pinned.`, and nobody could tell why. Each failure now says why (the toast, the line above the list,
// bridge-notices.log, and the pin report to OW for a day), and a failed Open thread offers one press that sends the client's
// update into that thread anyway, so the person does not have to ask Claude for it by hand.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { OPEN_FAILED_OFFER } from './register'
import {
  HANDLER_QUERY, OPEN_DETAIL_MAX, OPEN_FAILURE_KEEP_MS, detailLine, handlerOf, openFailureFor, openRejection, openWhyWords,
} from './threads'
import type { OpenWhy, PinReport } from './threads'
import type { WorldOptions } from './register-world.test-helper'
import { ACME, ACME_SHOWN, NOW, PAIRS, acmeWorld, buttonsOf, lines, mm, pane, rowsAsBefore, thread } from './register-world.test-helper'

const LINK_A = 'claude://claude.ai/epitaxy/local_a'
const DESKTOP = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' }
const ENV = {
  mac: { ...DESKTOP, HOME: '/Users/someone' },
  windows: { ...DESKTOP, OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\someone', APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' },
  linux: { ...DESKTOP, HOME: '/home/someone' },
}
const OK_PINS = { bridgePins: () => ({ status: 200, body: { ok: true } }) }
/** Acme's thread as the app lists it, with the link the app gives for it. */
const acmeLinked = (on: On, over: WorldOptions = {}, link: unknown = LINK_A) =>
  acmeWorld(on, { threads: [{ ...thread('local_a', 'Roof quote', 30), link } as never, thread('local_x', 'Unrelated notes', 5)], ...over })
const SHORT = 'Sent to Acme Roofing\'s thread.'
const SENT_LINE = `Sent to Acme Roofing's thread: open "${ACME_SHOWN}" under Pinned.`
const WHERE_BECAUSE = (why: string) => `Couldn't open "${ACME_SHOWN}": ${why}. Open it under Pinned.`
const QUERY = [...HANDLER_QUERY]
/** The lines the bridge wrote to its notice log, newest last. */
const logLines = (w: { written: Array<{ path: string; text: string }> }) =>
  w.written.filter(f => f.path.endsWith('/.claude/mm-hooks/bridge-notices.log')).flatMap(f => f.text.split('\n').filter(Boolean))
const openLog = (w: { written: Array<{ path: string; text: string }> }) => logLines(w).filter(l => l.includes('open thread failed'))
const why = (o: Partial<OpenWhy> & Pick<OpenWhy, 'reason'>): OpenWhy => ({ platform: 'linux', program: 'xdg-open', code: null, detail: null, ...o })

describe('0.7.80: why a thread did not open, in plain words', () => {
  test('each reason says what happened, naming the program', () => {
    expect(openWhyWords(why({ reason: 'no_link', program: null }), 10_000)).toBe('the Claude app gave no link for this thread')
    expect(openWhyWords(why({ reason: 'no_platform', platform: null, program: null }), 10_000)).toBe('the bridge could not tell which system this computer runs')
    expect(openWhyWords(why({ reason: 'no_opener' }), 10_000)).toBe('xdg-open is not installed on this computer')
    expect(openWhyWords(why({ reason: 'exit', platform: 'mac', program: 'open', code: 1 }), 10_000)).toBe('open stopped with error code 1')
    expect(openWhyWords(why({ reason: 'exit', code: 4, handler: '' }), 10_000)).toBe('no app on this computer is set to open claude:// links (xdg-open stopped with error code 4)')
    expect(openWhyWords(why({ reason: 'exit', code: 3, handler: 'claude-desktop.desktop' }), 10_000)).toBe('claude:// links go to claude-desktop.desktop (xdg-open stopped with error code 3)')
    expect(openWhyWords(why({ reason: 'exit', code: 4, handler: null }), 10_000)).toBe('xdg-open stopped with error code 4')
    expect(openWhyWords(why({ reason: 'timeout' }), 10_000)).toBe('xdg-open did not answer within 10 seconds')
    expect(openWhyWords(why({ reason: 'timeout', handler: '' }), 10_000)).toBe('xdg-open did not answer within 10 seconds; no app on this computer is set to open claude:// links')
    expect(openWhyWords(why({ reason: 'failed', detail: 'spawn xdg-open EACCES' }), 10_000)).toBe('xdg-open could not start: spawn xdg-open EACCES')
    expect(openWhyWords(why({ reason: 'failed' }), 10_000)).toBe('xdg-open could not start')
  })

  test('a rejected start: not installed, out of time (by its words, or by the clock), or anything else', () => {
    expect(openRejection(new Error('spawn xdg-open ENOENT'), 5, 10_000).reason).toBe('no_opener')
    expect(openRejection('Command timed out after 10000ms', 5, 10_000).reason).toBe('timeout')
    expect(openRejection(new Error('killed'), 10_000, 10_000).reason).toBe('timeout')
    expect(openRejection(new Error('spawn xdg-open EACCES'), 5, 10_000)).toEqual({ reason: 'failed', detail: 'spawn xdg-open EACCES' })
    expect(openRejection(undefined, 5, 10_000).reason).toBe('failed')
  })

  test('the handler answer: a desktop file, none, or not readable; never a path', () => {
    expect(handlerOf('claude-desktop.desktop\n')).toBe('claude-desktop.desktop')
    expect(handlerOf('com.anthropic.Claude.desktop')).toBe('com.anthropic.Claude.desktop')
    expect(handlerOf('\n')).toBe('')
    expect(handlerOf('')).toBe('')
    expect(handlerOf('/usr/share/applications/claude.desktop')).toBeNull()
    expect(handlerOf('not a desktop file')).toBeNull()
    expect(handlerOf(undefined)).toBeNull()
  })

  test('an opener\'s own words: the first line, without the link or a home folder, cut short', () => {
    expect(detailLine(`\nxdg-open: no method available for opening '${LINK_A}'\nmore`)).toBe("xdg-open: no method available for opening '<link>'")
    expect(detailLine('cannot read /home/shezan/.config/mimeapps.list')).toBe('cannot read ~/.config/mimeapps.list')
    expect(detailLine('C:\\Users\\someone\\x failed')).toBe('~\\x failed')
    expect(detailLine('a\u0007b')).toBe('a b')
    expect([...(detailLine('x'.repeat(500)) ?? '')].length).toBe(OPEN_DETAIL_MAX)
    expect(detailLine('   ')).toBeNull()
    expect(detailLine(42)).toBeNull()
  })

  test('the record OW gets: well formed and less than a day old, its own fields alone', () => {
    const at = new Date(NOW - 60_000).toISOString()
    const kept = { at, reason: 'exit', platform: 'linux', program: 'xdg-open', code: 4, handler: '', detail: 'xdg-open: no method', title: 'Roof quote', link: LINK_A }
    expect(openFailureFor(kept, NOW)).toEqual({ at, reason: 'exit', platform: 'linux', program: 'xdg-open', code: 4, handler: '', detail: 'xdg-open: no method' })
    // a handler not asked stays out; one that is not a desktop file's name is not readable
    expect(openFailureFor({ ...kept, handler: undefined }, NOW)).not.toHaveProperty('handler')
    expect(openFailureFor({ ...kept, handler: '/etc/passwd' }, NOW)?.handler).toBeNull()
    // a program that is not an opener, and a platform not known, are not passed on
    expect(openFailureFor({ ...kept, program: 'sh', platform: 'beos' }, NOW)).toMatchObject({ program: null, platform: null })
    expect(openFailureFor({ ...kept, at: new Date(NOW - OPEN_FAILURE_KEEP_MS).toISOString() }, NOW)).toBeUndefined()
    expect(openFailureFor({ ...kept, reason: 'gremlins' }, NOW)).toBeUndefined()
    for (const junk of [null, undefined, 'x', [], { at: 'yesterday', reason: 'exit' }]) expect(openFailureFor(junk, NOW)).toBeUndefined()
  })
})

describe('0.7.80: a failed Open thread says why, logs it, and tells OW', () => {
  const CASES: Array<[string, WorldOptions, string, string[][], Partial<OpenWhy>]> = [
    [
      'Linux, no app set to open claude:// links (xdg-open exits 4)',
      { env: ENV.linux, opener: 4 },
      'no app on this computer is set to open claude:// links (xdg-open stopped with error code 4)',
      [['xdg-open', LINK_A], QUERY],
      { reason: 'exit', platform: 'linux', program: 'xdg-open', code: 4, handler: '', detail: "xdg-open: no method available for opening '<link>'" },
    ],
    [
      'Linux, the opener hangs, and claude:// links go to an app',
      { env: ENV.linux, opener: 'hangs', handler: 'claude-desktop.desktop' },
      'xdg-open did not answer within 10 seconds; claude:// links go to claude-desktop.desktop',
      [['xdg-open', LINK_A], QUERY],
      { reason: 'timeout', platform: 'linux', program: 'xdg-open', code: null, handler: 'claude-desktop.desktop' },
    ],
    [
      'Linux, the opener exits 3 and the handler question is not answered',
      { env: ENV.linux, opener: 3, handler: 'fails' },
      'xdg-open stopped with error code 3',
      [['xdg-open', LINK_A], QUERY],
      { reason: 'exit', code: 3, handler: null },
    ],
    [
      'Linux, xdg-open is not installed: no question after it',
      { env: ENV.linux, opener: 'missing' },
      'xdg-open is not installed on this computer',
      [['xdg-open', LINK_A]],
      { reason: 'no_opener', platform: 'linux', program: 'xdg-open', code: null },
    ],
    [
      'Linux, xdg-open cannot be started',
      { env: ENV.linux, opener: 'refused' },
      'xdg-open could not start: spawn xdg-open EACCES',
      [['xdg-open', LINK_A]],
      { reason: 'failed', detail: 'spawn xdg-open EACCES' },
    ],
    [
      'Mac, the opener exits 1: no Linux question',
      { env: ENV.mac, opener: 1 },
      'open stopped with error code 1',
      [['open', LINK_A]],
      { reason: 'exit', platform: 'mac', program: 'open', code: 1 },
    ],
    [
      'Windows, the opener exits 2',
      { env: ENV.windows, opener: 2 },
      'rundll32 stopped with error code 2',
      [['rundll32', 'url.dll,FileProtocolHandler', LINK_A]],
      { reason: 'exit', platform: 'windows', program: 'rundll32', code: 2 },
    ],
    [
      'the platform cannot be told: nothing is started',
      { env: { ...DESKTOP, HOME: '/srv/someone' }, opener: 'works' },
      'the bridge could not tell which system this computer runs',
      [],
      { reason: 'no_platform', platform: null, program: null },
    ],
  ]
  for (const [name, over, words, argvs, record] of CASES) {
    test(name, async ($, on) => {
      rowsAsBefore(on)
      const w = acmeLinked(on, { ...over, ...OK_PINS })
      await mm($, '')
      const ui = await pane($)
      await ui.press({ key: `update:${ACME}` })
      expect(await buttonsOf(ui, ACME)).toEqual(['Open thread', 'Drafts'])
      const ranBefore = w.argvs().length
      await ui.press({ key: `open:${ACME}` })
      // the toast and the line above the list say which thread, why, and where it is
      expect(w.toasts.at(-1)).toBe(WHERE_BECAUSE(words))
      expect(await lines(ui)).toContain(WHERE_BECAUSE(words))
      // the opener with the link, and on Linux after it ran and failed, the one question; nothing else
      expect(w.argvs().slice(ranBefore)).toEqual(argvs)
      // one line in the notice log for this press, with the facts
      const logged = openLog(w).at(-1) ?? ''
      expect(logged).toContain(`open thread failed: Acme Roofing, Open thread: ${words}`)
      expect(logged).toContain(`reason=${record.reason}`)
      if (record.code != null) expect(logged).toContain(`code=${record.code}`)
      expect(logged).not.toContain(LINK_A)
      // the record OW gets with the next pin report: why, and nothing of the client, the thread or the link
      expect(w.stored['mm.openFailed']).toMatchObject(record)
      // (the Update before it failed the same way at the same moment, so the report already sent carries it, or this press's)
      const sent = w.pinPosts.at(-1)?.body as PinReport | undefined
      expect(sent?.open_failure).toMatchObject(record)
      expect(JSON.stringify(sent?.open_failure)).not.toMatch(/Acme|Roof quote|local_a|claude:\/\/|someone/)
      await ui.unmount()
    })
  }

  test('the app gives no link of the thread\'s own: nothing is started, and it says so', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 'works', ...OK_PINS }, 'https://example.com/claude')
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.press({ key: `open:${ACME}` })
    expect(w.toasts.at(-1)).toBe(WHERE_BECAUSE('the Claude app gave no link for this thread'))
    expect(w.ran).toEqual([])
    expect(openLog(w).at(-1)).toContain('reason=no_link')
    expect(w.pinPosts.at(-1)?.body.open_failure).toMatchObject({ reason: 'no_link', program: null })
    await ui.unmount()
  })

  test('Update keeps its own words, and the failure is logged and kept for OW all the same', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 4, ...OK_PINS })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    expect(await lines(ui)).toContain(SENT_LINE)
    expect(w.toasts).toEqual([SHORT])
    expect(openLog(w).at(-1)).toContain('open thread failed: Acme Roofing, after Update: no app on this computer is set to open claude:// links')
    expect(w.stored['mm.openFailed']).toMatchObject({ reason: 'exit', code: 4, handler: '' })
    await ui.unmount()
  })

  test('an open that works takes the record back: the next report carries no failure', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, {
      env: ENV.mac,
      opener: 'works',
      ...OK_PINS,
      store: { 'mm.threads': PAIRS, 'mm.openFailed': { at: new Date(NOW - 60_000).toISOString(), reason: 'exit', platform: 'mac', program: 'open', code: 1, detail: null } },
    })
    await mm($, '')
    expect(w.pinPosts.at(-1)?.body.open_failure).toMatchObject({ reason: 'exit', code: 1 })
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    expect(w.stored['mm.openFailed']).toBeNull()
    expect(w.pinPosts.at(-1)?.body).not.toHaveProperty('open_failure')
    expect(openLog(w)).toEqual([])
    await ui.unmount()
  })

  test('a failure more than a day old is not reported', async ($, on) => {
    const w = acmeLinked(on, {
      env: ENV.mac,
      ...OK_PINS,
      store: { 'mm.threads': PAIRS, 'mm.openFailed': { at: new Date(NOW - OPEN_FAILURE_KEEP_MS - 1).toISOString(), reason: 'exit', platform: 'mac', program: 'open', code: 1, detail: null } },
    })
    await mm($, '')
    expect(w.pinPosts.length).toBeGreaterThan(0)
    expect(w.pinPosts.at(-1)?.body).not.toHaveProperty('open_failure')
  })
})

describe('0.7.80: a failed Open thread offers one press that gets the thread going with the client\'s context', () => {
  const OFFER = `again:${ACME}`
  const offerOn = async (ui: Awaited<ReturnType<typeof pane>>) => (await ui.findAll({ type: 'Button' })).some(b => String(b.key) === OFFER)

  test('the offer: Update, beside what it does; one press sends the update into that thread although it already had it', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 4 })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    expect(w.acted().map(c => [c.tool, c.args.session_id])).toEqual([['send_message', 'local_a']])
    const kickoff = String(w.acted()[0]?.args.message ?? '')
    // with no failed Open, no offer
    expect(await offerOn(ui)).toBe(false)
    await ui.press({ key: `open:${ACME}` })
    expect(await offerOn(ui)).toBe(true)
    expect(await lines(ui)).toContain(OPEN_FAILED_OFFER('Acme Roofing'))
    const offered = (await ui.findAll({ type: 'Button' })).find(b => String(b.key) === OFFER)
    expect(offered?.props.label).toBe('Update thread')
    // the row's own Update is not drawn (the thread has it); the offer sends it all the same, into the row's thread
    const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.key))
    expect(keys).toContain(`open:${ACME}`)
    expect(keys).not.toContain(`update:${ACME}`)
    await ui.press({ key: OFFER })
    expect(w.acted().map(c => [c.tool, c.args.session_id])).toEqual([['send_message', 'local_a'], ['send_message', 'local_a']])
    expect(w.acted()[1]?.args.message).toBe(kickoff)
    // it says it went and where the thread is, and the offer is gone: one press
    expect(w.toasts.at(-1)).toBe(SHORT)
    expect(await lines(ui)).toContain(SENT_LINE)
    expect(await offerOn(ui)).toBe(false)
    await ui.unmount()
  })

  test('without the offer, Update into a thread that has it still sends nothing', async ($, on) => {
    const w = acmeLinked(on, { env: ENV.linux, opener: 4 })
    expect(await mm($, 'update acme roofing')).toBe(SENT_LINE)
    expect(await mm($, 'update acme roofing')).toBe(`Acme Roofing's thread already has this. Open "${ACME_SHOWN}" under Pinned.`)
    expect(w.acted().length).toBe(1)
  })

  test('an Open that works offers nothing', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 'works' })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.press({ key: `open:${ACME}` })
    expect(await offerOn(ui)).toBe(false)
    expect(w.acted().length).toBe(1)
    await ui.unmount()
  })

  test('⛔ the offer goes with its line: a sync that clears the line clears it, and nothing is sent by itself', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 4 })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await w.clock.advance(4_000)
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.press({ key: `open:${ACME}` })
    expect(await offerOn(ui)).toBe(true)
    for (let i = 0; i < 12; i++) await w.clock.advance(60_000)
    expect(await offerOn(ui)).toBe(false)
    expect(w.acted().filter(c => c.tool === 'send_message').length).toBe(1)
    await ui.unmount()
  })

  test('⛔ the offer is drawn only while the row reads Open thread for that same thread', async ($, on) => {
    rowsAsBefore(on)
    const w = acmeLinked(on, { env: ENV.linux, opener: 4 })
    await mm($, '')
    const ui = await pane($)
    await ui.press({ key: `update:${ACME}` })
    await ui.press({ key: `open:${ACME}` })
    expect(await offerOn(ui)).toBe(true)
    // the client's link moves to another thread: the row no longer shows the thread the offer was for
    w.stored['mm.links'] = { [ACME]: 'local_x' }
    await mm($, '')
    expect(await offerOn(ui)).toBe(false)
    await ui.unmount()
  })
})
