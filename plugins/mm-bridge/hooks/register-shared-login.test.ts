// The bridge on a computer whose ONE login two people share (0.7.55). Each person has a work folder of their own, marked by
// `.mm-root.json` (`root`: that folder, `email`: its owner), and both folders are in the hook's consent. The identity switch
// copies the token of whoever works now into `~/.claude/mm-hooks/token`, the one file the bridge reads, so the bridge serves
// one person at a time; the app's store is one per login. Until 0.7.54 Start, Start all, kickoffs and the cards took the
// folder from `mm.folder` (whoever's client threads were seen last) or the first tracked folder: the person holding the
// bridge started client threads in the other person's folder. These tests hold it to the current member's own folder.
//
// The world, the feed and the helpers are register-world.test-helper.ts's, as in register-links-starts.test.ts.

import { describe, expect, test } from 'claude-code/testing'
import { SHARED_NO_FOLDER, SHARED_NOT_HERE, SHARED_NOT_SYNCED } from './register'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, ACME, ME, thread, world, mm, tool, kicksIn, kickoffsOf, starts, sessionCalls, tickOnce, cedarAlone, START_ALL, FILLED_ALL, filledOne } from './register-world.test-helper'

const HOME = '/Users/shared'
const THEIRS = `${HOME}/Nayan`
const MINE = `${HOME}/Asif`
const OTHER = 'builder-b@example.com'
const env = { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME }
const file = (text: string) => ({ text, mtimeMs: NOW })
/** The hook's consent and each work root's marker: `roots` maps a folder to its owner's address. */
const disk = (allow: string[], roots: Record<string, string>): NonNullable<WorldOptions['files']> => ({
  [`${HOME}/.claude/mm-hooks/consent.json`]: file(JSON.stringify({ v: 2, allowlist: allow })),
  ...Object.fromEntries(Object.entries(roots).map(([dir, email]) => [`${dir}/.mm-root.json`, file(JSON.stringify({ root: dir, owner: 'Someone', email }))])),
})
/** Both folders tracked, the other person's first; mine marked for `mine` (the feed's member, ME, unless a test says not). */
const shared = (mine = ME) => disk([THEIRS, MINE], { [THEIRS]: OTHER, [MINE]: mine })
/** A sync the other person's token made (its `holder` is not this token's), fresh, with nobody on its list. */
const theirLast = { at: NOW, member: OTHER, holder: '0badc0de', items: [], recs: {}, pinned: 0 }

describe('0.7.55: on a login two people share, a new client thread starts only in the current member\'s own work folder', () => {
  test('kickoffs: in my marked folder, never the other person\'s, though theirs is tracked first and mm.folder names it', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      env,
      files: shared(),
      // the other person's client thread, linked, in their folder: what noted mm.folder for them
      threads: [thread('local_a', 'Acme Roofing work', 2, { cwd: THEIRS })],
      store: { 'mm.links': { [ACME]: 'local_a' }, 'mm.folder': { dir: THEIRS, at: NOW - 1000, member: OTHER } },
    })
    await mm($, '')
    const kicks = await kickoffsOf($)
    expect(kicks.map(k => k.client)).toEqual(['Cedar Dental', 'Bolt Staffing'])
    for (const k of kicks) expect(k.arguments.cwd).toBe(MINE)
    // the sync never notes the other person's folder for me: their record stays theirs, and is not used
    expect(w.stored['mm.folder']).toEqual({ dir: THEIRS, at: NOW - 1000, member: OTHER })
    expect(starts(w)).toEqual([])
  })

  test('mm.folder is kept with its member: my client threads\' folder inside my root, and theirs never counts', async ($, on) => {
    const w = world(on, {
      tools: 'start',
      env,
      files: shared(),
      threads: [thread('local_a', 'Acme Roofing work', 2, { cwd: `${MINE}/clients` })],
      store: { 'mm.links': { [ACME]: 'local_a' } },
    })
    await mm($, '')
    expect(w.stored['mm.folder']).toMatchObject({ dir: `${MINE}/clients`, member: ME })
    for (const k of await kickoffsOf($)) expect(k.arguments.cwd).toBe(`${MINE}/clients`)
  })

  test('mm.folder noted for the other person is never reused after a handover, even inside a folder of mine', async ($, on) => {
    world(on, {
      tools: 'start',
      env,
      files: shared(),
      threads: [],
      store: { 'mm.folder': { dir: `${MINE}/old`, at: NOW - 1000, member: OTHER } },
    })
    await mm($, '')
    for (const k of await kickoffsOf($)) expect(k.arguments.cwd).toBe(MINE)
  })

  test('⛔ no tracked folder is marked for me: kickoffs refuses in plain words, and nothing is claimed, handed out or started', async ($, on) => {
    const w = world(on, { tools: 'start', env, files: shared('somebody-else@example.com'), threads: [] })
    await mm($, '')
    const said = await tool($, 'kickoffs')
    expect(said).toBe(SHARED_NO_FOLDER)
    expect(kicksIn(said)).toEqual([])
    expect(w.stored['mm.starting']).toBeUndefined()
    expect(w.stored['mm.kickoffs']).toBeUndefined()
    expect(starts(w)).toEqual([])
  })

  test('⛔ Start all and a row\'s Start put nothing in the prompt box there', async ($, on) => {
    const w = world(on, { tools: 'start', env, files: shared('somebody-else@example.com'), threads: [] })
    await mm($, '')
    expect(await mm($, 'start all')).toBe(SHARED_NO_FOLDER)
    expect(await mm($, 'start cedar')).toBe(SHARED_NO_FOLDER)
    expect(w.fills).toEqual([])
  })

  test('with a folder of mine, Start all and Start fill the box as before', async ($, on) => {
    const w = world(on, { tools: 'start', env, files: shared(), threads: [] })
    await mm($, '')
    expect(await mm($, 'start all')).toBe(FILLED_ALL)
    expect(w.fills).toEqual([START_ALL])
    w.box.text = ''
    expect(await mm($, 'start cedar')).toBe(filledOne('Cedar Dental'))
  })

  test('⛔ right after a handover the stored list is the other person\'s: kickoffs reads mine first, then hands out in my folder', async ($, on) => {
    world(on, { tools: 'start', env, files: shared(), threads: [], store: { 'mm.last': theirLast } })
    // the other person's list, used as it was, would say nobody needs a thread
    const kicks = await kickoffsOf($)
    expect(kicks.map(k => k.client)).toEqual(['Cedar Dental', 'Acme Roofing', 'Bolt Staffing'])
    for (const k of kicks) expect(k.arguments.cwd).toBe(MINE)
  })

  test('⛔ and when my list cannot be read then, nothing is handed out from theirs', async ($, on) => {
    const w = world(on, { tools: 'start', env, files: shared(), threads: [], store: { 'mm.last': theirLast }, feedStatus: () => 503 })
    const said = await tool($, 'kickoffs')
    expect(said).toContain('closeout HTTP 503')
    expect(kicksIn(said)).toEqual([])
    expect(w.stored['mm.starting']).toBeUndefined()
  })

  test('the other person\'s list on record and no list of mine yet: a Start says to wait, never their folder', async ($, on) => {
    const w = world(on, { tools: 'start', env, files: shared(), threads: [], store: { 'mm.last': theirLast }, feedStatus: () => 503 })
    expect(await mm($, 'start all')).toContain('closeout HTTP 503')
    expect(w.fills).toEqual([])
    expect(SHARED_NOT_SYNCED).toContain('Try again in a minute')
  })

  test('⛔ a card opens where the thread holding it runs: never held by a thread in the other person\'s folder', async ($, on) => {
    on('session.root', () => ({ value: THEIRS }))
    const w = world(on, { tools: 'start', env, files: shared(), feed: cedarAlone(), threads: [] })
    await tickOnce($, w)
    for (let i = 0; i < 3; i++) await w.clock.advance(60_000)
    expect(sessionCalls(w)).toEqual([])
  })

  test('a thread in my own folder holds it, as before', async ($, on) => {
    on('session.root', () => ({ value: MINE }))
    const w = world(on, { tools: 'start', env, files: shared(), feed: cedarAlone(), threads: [] })
    await tickOnce($, w)
    await w.clock.advance(60_000)
    expect(sessionCalls(w).length).toBe(1)
  })

  test('where the app gives only cards, a row\'s Start in a thread in the other person\'s folder makes none', async ($, on) => {
    on('session.root', () => ({ value: THEIRS }))
    const w = world(on, { tools: 'spawn', env, files: shared(), threads: [] })
    await mm($, '')
    expect(await mm($, 'start cedar')).toBe(SHARED_NOT_HERE)
    expect(w.minted()).toEqual([])
  })

  test('no marker anywhere: as before 0.7.55 (mm.folder from any member, else the first tracked folder)', async ($, on) => {
    world(on, {
      tools: 'start',
      env,
      files: disk([THEIRS, MINE], {}),
      threads: [],
      store: { 'mm.folder': { dir: `${MINE}/old`, at: NOW - 1000, member: OTHER } },
    })
    await mm($, '')
    for (const k of await kickoffsOf($)) expect(k.arguments.cwd).toBe(`${MINE}/old`)
  })

  test('a marker whose root is another folder (a copied marker) does not make a work root', async ($, on) => {
    const files = disk([THEIRS, MINE], {})
    files[`${THEIRS}/.mm-root.json`] = file(JSON.stringify({ root: `${HOME}/Elsewhere`, email: ME }))
    world(on, { tools: 'start', env, files, threads: [] })
    await mm($, '')
    for (const k of await kickoffsOf($)) expect(k.arguments.cwd).toBe(THEIRS)
  })
})
