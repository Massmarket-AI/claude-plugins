// (0.7.71) The right-click rows in the desktop app's transcript, and (0.7.73) no Ship row in the band. The bridge against a pretend desktop
// app, feed and store (register-world.test-helper.ts), with `git` and `gh` answered by the test; every client and folder is made up.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MENU_LINK, MENU_LINK_DRAFT, MENU_LINK_SUB, MENU_LINK_TYPE, MENU_UPDATE, MENU_UPDATE_SUB, MENU_VIEW, MENU_VIEW_SUB } from './register'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, LONG, ACME, BOLT, SELF, SELF_CLI, ACME_KICKOFF, BAND_PROPS, bandOf, feed, world, mm, declared, buttons, lines, bandLines } from './register-world.test-helper'

// ======================================================================== the right-click rows

/** The menu as the desktop app asks for it, opened on a row of this thread's transcript. */
const menu = ($: Engine, props: Record<string, unknown> = {}, surface: 'desktop' | 'mobile' | 'terminal' = 'desktop') =>
  $.ui.mount({ plugin: 'mm-bridge', surface, component: 'ContextMenu', requestId: 'menu_1', props: { row: { component: 'AssistantMessage', requestId: 'msg_1' }, ...props } as never })
/** This thread is Acme's own: its session declared Acme, so the sync links it. */
const acmeHere: WorldOptions = { feed: feed({ threads: [declared(ACME, SELF_CLI, 1)] }), store: { 'mm.threads': { [SELF_CLI]: { app: SELF, at: NOW } } } }
const ours = async (ui: Parameters<typeof buttons>[0]) => (await buttons(ui)).filter(([k]) => k.startsWith('mm-menu'))

describe('0.7.71: the right-click rows in the desktop app', () => {
  test('in a client\'s own thread: Update this thread and Open in pane, each with the line under it', async ($, on) => {
    world(on, acmeHere)
    await mm($, '')
    const m = await menu($)
    expect(await ours(m)).toEqual([['mm-menu-update', MENU_UPDATE], ['mm-menu-view', MENU_VIEW]])
    const text = await lines(m)
    expect(text).toContain(MENU_UPDATE_SUB('Acme Roofing'))
    expect(text).toContain(MENU_VIEW_SUB('Acme Roofing'))
    await m.unmount()
  })

  test('Update this thread is the pane\'s Update on this thread\'s row: the kickoff goes in here as the person\'s prompt, nothing is sent elsewhere', async ($, on) => {
    const w = world(on, acmeHere)
    await mm($, '')
    const m = await menu($)
    await m.press({ key: 'mm-menu-update' })
    expect(w.acted()).toEqual([])
    expect(w.prompts).toEqual([{ text: `New since this thread last worked on this client: drafts ready.\n${ACME_KICKOFF}`, origin: { kind: 'plugin', name: 'mm-bridge', asUser: true } }])
    await m.unmount()
  })

  test('Open in pane is /mm view: the side pane opens', async ($, on) => {
    const w = world(on, acmeHere)
    await mm($, '')
    const before = w.opened.length
    const m = await menu($)
    await m.press({ key: 'mm-menu-view' })
    expect(w.opened.slice(before).map(o => o.id)).toContain('mm-queue')
    await m.unmount()
  })

  test('in a thread linked to no client: Link to client puts /mm link in an empty prompt box, never over a draft', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const m = await menu($)
    expect(await ours(m)).toEqual([['mm-menu-link', MENU_LINK], ['mm-menu-view', MENU_VIEW]])
    expect(await lines(m)).toContain(MENU_LINK_TYPE)
    await m.press({ key: 'mm-menu-link' })
    expect(w.fills).toEqual(['/mm link '])
    expect(w.prompts).toEqual([])
    await m.unmount()
  })

  test('a draft in the prompt box stays: a toast says what to type', async ($, on) => {
    const w = world(on, { box: 'half a thought' })
    await mm($, '')
    const m = await menu($)
    await m.press({ key: 'mm-menu-link' })
    expect(w.fills).toEqual([])
    expect(w.toasts).toContain(MENU_LINK_DRAFT)
    await m.unmount()
  })

  test('a selection that names one client: Link to that client, and a press links this thread as /mm link does', async ($, on) => {
    const w = world(on)
    await mm($, '')
    const m = await menu($, { selection: { text: 'Bolt Staffing' } })
    expect(await ours(m)).toEqual([[`mm-menu-link:${BOLT}`, 'Link to Bolt Staffing'], ['mm-menu-view', MENU_VIEW]])
    expect(await lines(m)).toContain(MENU_LINK_SUB)
    await m.press({ key: `mm-menu-link:${BOLT}` })
    expect(w.stored['mm.links']).toEqual({ [BOLT]: SELF })
    expect(w.acted()).toEqual([])
    await m.unmount()
  })

  test('on code or a link, while paused, and on the phone and the terminal: the engine\'s rows alone', async ($, on) => {
    world(on, acmeHere)
    await mm($, '')
    for (const props of [{ code: { text: 'ls', isBlock: true } }, { link: { href: 'https://example.com/' } }]) {
      const m = await menu($, props)
      expect(await ours(m)).toEqual([])
      await m.unmount()
    }
    for (const surface of ['mobile', 'terminal'] as const) {
      const m = await menu($, {}, surface)
      expect(await ours(m), surface).toEqual([])
      await m.unmount()
    }
    await mm($, 'pause')
    const m = await menu($)
    expect(await ours(m)).toEqual([])
    await m.unmount()
  })

  test('an unattended session draws no rows', async ($, on) => {
    world(on, { ...acmeHere, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: false })
    await mm($, '')
    const m = await menu($)
    expect(await ours(m)).toEqual([])
    await m.unmount()
  })
})

// ======================================================================== (0.7.73) no Ship row

/** A feature branch with commits not pushed and no pull request: where 0.7.71 drew its Ship row. */
const unpushed = (argv: string[]) => {
  const j = argv.slice(1).join(' ')
  if (argv[0] === 'gh') return { exitCode: 1, stderr: 'no pull requests found for branch "feat/menu"' }
  if (j === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: '/work/app\n' }
  if (j === 'symbolic-ref --quiet --short HEAD') return { exitCode: 0, stdout: 'feat/menu\n' }
  return { exitCode: 0, stdout: '2\n' }
}

describe('0.7.73: no Ship row (Rob 2026-11-24: "Why would we need a button for that? Shouldn\'t just automatically")', () => {
  test('a feature branch with commits not pushed: the band draws no Ship row, and the bridge runs neither git nor gh', LONG, async ($, on) => {
    const w = world(on, { git: unpushed })
    await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: false })
    await w.clock.advance(6 * 60_000)
    await mm($, '')
    const { lines: said, buttons: pressable } = await bandLines($)
    expect(said.some(l => l.startsWith('Ready to ship'))).toBe(false)
    expect(pressable.map(([k]) => k)).not.toContain('mm-ship-btn')
    expect(w.gitRuns).toEqual([])
    expect(w.fills).toEqual([])
  })
})
