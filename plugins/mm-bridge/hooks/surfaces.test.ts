// (0.7.71) The right-click rows in the desktop app's transcript, and the band's Ship row. The bridge against a pretend desktop app, feed
// and store (register-world.test-helper.ts), with `git` and `gh` answered by the test; every client and folder is made up.

import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MENU_LINK, MENU_LINK_DRAFT, MENU_LINK_SUB, MENU_LINK_TYPE, MENU_UPDATE, MENU_UPDATE_SUB, MENU_VIEW, MENU_VIEW_SUB } from './register'
import { CONTROL_TOWER, SHIP_DRAFT, SHIP_WORDS, isControlTower, prOf, shipText } from './ship'
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

// ======================================================================== the Ship row

type Git = { exitCode: number; stdout?: string; stderr?: string }
/** A checkout as `git` and `gh` answer for it. Left out: a feature branch with two commits on origin/main, none pushed, no upstream. */
function repo(o: { top?: string; branch?: string | null; remote?: string; common?: string; originHead?: string | null; ahead?: number; upstream?: string | null; unpushed?: number; pr?: Git | 'throws' } = {}) {
  const top = o.top ?? '/work/app'
  const ok = (stdout: string): Git => ({ exitCode: 0, stdout: `${stdout}\n` })
  const no: Git = { exitCode: 1, stderr: '' }
  return (argv: string[]): Git | 'throws' => {
    const [cmd, ...a] = argv
    if (cmd === 'gh') return o.pr ?? { exitCode: 1, stderr: 'no pull requests found for branch "feat/menu"' }
    const j = a.join(' ')
    if (j === 'rev-parse --show-toplevel') return ok(top)
    if (j === 'symbolic-ref --quiet --short HEAD') return o.branch === null ? no : ok(o.branch ?? 'feat/menu')
    if (j === 'config --get remote.origin.url') return ok(o.remote ?? 'git@github.com:Massmarket-AI/app.git')
    if (j === 'rev-parse --path-format=absolute --git-common-dir') return ok(o.common ?? `${top}/.git`)
    if (j === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return o.originHead === null ? no : ok(o.originHead ?? 'origin/main')
    if (j === 'rev-parse --verify --quiet refs/remotes/origin/main') return ok('abc')
    if (j === 'rev-list --count origin/main..HEAD') return ok(String(o.ahead ?? 2))
    if (j === 'rev-parse HEAD') return ok('1111111111111111111111111111111111111111')
    if (j === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return o.upstream ? ok(o.upstream) : { exitCode: 128, stderr: 'fatal: no upstream configured' }
    if (j === 'rev-list --count @{u}..HEAD') return ok(String(o.unpushed ?? 0))
    return { exitCode: 128, stderr: `unexpected git ${j}` }
  }
}
/** The session starts and looks at its folder (5 s after its start). */
const started = async ($: Engine, w: { clock: { advance: (ms: number) => Promise<void> } }) => {
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: false })
  await w.clock.advance(6_000)
}
const shipLine = async ($: Engine) => (await bandLines($)).lines.find(l => l.startsWith('Ready to ship'))
const shipButton = async ($: Engine) => (await bandLines($)).buttons.find(([k]) => k === 'mm-ship-btn')
const ghAsked = (w: { gitRuns: Array<{ argv: string[] }> }) => w.gitRuns.filter(r => r.argv[0] === 'gh').length

describe('0.7.71: the band\'s Ship row', () => {
  test('a feature branch with commits not pushed: the row says so, and its Ship button', async ($, on) => {
    const w = world(on, { git: repo() })
    await started($, w)
    expect(await shipLine($)).toBe('Ready to ship: feat/menu · 2 commits not pushed')
    expect(await shipButton($)).toEqual(['mm-ship-btn', 'Ship'])
    // git ran in the thread's folder, and gh was not asked while work is not pushed
    expect(w.gitRuns[0]?.cwd).toBe('/work')
    expect(ghAsked(w)).toBe(0)
  })

  test('a press puts exactly /ship in the prompt box, no Enter: no prompt is sent and no command is run', async ($, on) => {
    const w = world(on, { git: repo() })
    const commands: string[] = []
    on('command.run', (_$, e, next) => {
      commands.push(String(e.command))
      return next(e)
    })
    await started($, w)
    const band = await bandOf($)
    await band.press({ key: 'mm-ship-btn' })
    expect(w.fills).toEqual([SHIP_WORDS])
    expect(SHIP_WORDS).toBe('/ship')
    expect(w.prompts).toEqual([])
    expect(commands).toEqual([])
    await band.unmount()
  })

  test('a draft in the prompt box stays: the toast says to type /ship', async ($, on) => {
    const w = world(on, { git: repo(), box: 'not done yet' })
    await started($, w)
    const band = await bandOf($)
    await band.press({ key: 'mm-ship-btn' })
    expect(w.fills).toEqual([])
    expect(w.toasts).toContain(SHIP_DRAFT)
    await band.unmount()
  })

  test('everything pushed and no pull request yet: the row says so; gh is asked once per commit, not on every look', async ($, on) => {
    const w = world(on, { git: repo({ upstream: 'origin/feat/menu', unpushed: 0 }) })
    await started($, w)
    expect(await shipLine($)).toBe('Ready to ship: feat/menu · no pull request yet')
    expect(ghAsked(w)).toBe(1)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await w.clock.advance(1_000)
    expect(ghAsked(w)).toBe(1)
    expect(w.gitRuns.find(r => r.argv[0] === 'gh')?.argv).toEqual(['gh', 'pr', 'view', 'feat/menu', '--json', 'state', '--jq', '.state'])
  })

  test('hidden: pushed with a pull request, on the default branch, a detached HEAD, nothing past main, no git repository, gh missing once pushed', LONG, async ($, on) => {
    let now = repo({ upstream: 'origin/feat/menu', unpushed: 0, pr: { exitCode: 0, stdout: 'OPEN\n' } })
    const w = world(on, { git: argv => now(argv) })
    await started($, w)
    expect(await shipLine($)).toBeUndefined()
    const cases: Array<ReturnType<typeof repo>> = [
      repo({ upstream: 'origin/feat/menu', unpushed: 0, pr: { exitCode: 0, stdout: 'MERGED\n' } }),
      repo({ branch: 'main' }),
      repo({ branch: 'master', originHead: 'origin/master' }),
      repo({ branch: null }),
      repo({ ahead: 0 }),
      repo({ upstream: 'origin/feat/menu', unpushed: 0, pr: 'throws' }),
      () => ({ exitCode: 128, stderr: 'fatal: not a git repository' }),
    ]
    for (const [n, c] of cases.entries()) {
      now = c
      await w.clock.advance(5 * 60_000)
      expect(await shipLine($), String(n)).toBeUndefined()
    }
    // and back on a branch with work not pushed, the row is there again
    now = repo()
    await w.clock.advance(5 * 60_000)
    expect(await shipLine($)).toBe('Ready to ship: feat/menu · 2 commits not pushed')
  })

  test('hidden in the control tower, its worktrees, and any clone of it, whose edits go straight to main', LONG, async ($, on) => {
    let now = repo({ top: `/Users/someone/Projects/${CONTROL_TOWER}` })
    const w = world(on, { git: argv => now(argv) })
    await started($, w)
    expect(await shipLine($)).toBeUndefined()
    now = repo({ top: '/Users/someone/wt/skill-fix', common: `/Users/someone/Projects/${CONTROL_TOWER}/.git` })
    await w.clock.advance(5 * 60_000)
    expect(await shipLine($)).toBeUndefined()
    now = repo({ top: '/tmp/tower', remote: `git@github.com:Massmarket-AI/${CONTROL_TOWER}.git` })
    await w.clock.advance(5 * 60_000)
    expect(await shipLine($)).toBeUndefined()
    now = repo()
    await w.clock.advance(5 * 60_000)
    expect(await shipLine($)).toBe('Ready to ship: feat/menu · 2 commits not pushed')
  })

  test('an unattended session never looks at its folder', async ($, on) => {
    const w = world(on, { git: repo(), env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
    await started($, w)
    expect(w.gitRuns).toEqual([])
    expect(await shipLine($)).toBeUndefined()
  })

  test('the row\'s words, the control tower\'s names, and what gh said', () => {
    expect(shipText({ branch: 'feat/x', unpushed: 1, pr: 'unknown' })).toBe('Ready to ship: feat/x · 1 commit not pushed')
    expect(shipText({ branch: 'feat/x', unpushed: 0, pr: 'none' })).toBe('Ready to ship: feat/x · no pull request yet')
    expect(isControlTower(`/a/${CONTROL_TOWER}`, '/a/x/.git', '')).toBe(true)
    expect(isControlTower('/a/wt', `/a/${CONTROL_TOWER}/.git`, '')).toBe(true)
    expect(isControlTower('/a/wt', '/a/wt/.git', `https://github.com/Massmarket-AI/${CONTROL_TOWER}`)).toBe(true)
    expect(isControlTower('/a/app', '/a/app/.git', `https://github.com/Massmarket-AI/${CONTROL_TOWER}-notes.git`)).toBe(false)
    expect(prOf({ exitCode: 0, stdout: 'OPEN\n', stderr: '' })).toBe('open')
    expect(prOf({ exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "x"' })).toBe('none')
    expect(prOf({ exitCode: 1, stdout: '', stderr: 'gh auth login' })).toBe('unknown')
    expect(prOf(null)).toBe('unknown')
  })
})
