/**
 * (0.7.71) The band's Ship row (Rob, 2026-11-24, his "yes" to Phase 2b): when this thread's folder is a git checkout on a branch other
 * than its default branch, with work past the default branch that is not pushed yet, or no pull request for it yet, the band shows one
 * row with a Ship button. A press puts exactly `/ship` in the person's prompt box, with no Enter, as the card puts `Send package <12>`
 * there when it cannot send it: the person presses Enter. ⛔ The bridge never runs `/ship` itself, through `$.command.run`, a submit or
 * any other route: only a line the person sends may start it.
 *
 * Hidden: on the default branch, on a detached HEAD, in a folder that is not a git checkout, with nothing past the default branch, once
 * everything is pushed and the branch has a pull request (open, merged or closed), and in the control tower
 * (`massmarket-ops-control-tower`), whose skill and rule edits go straight to main with no pull request.
 *
 * What it reads, all on this computer: `git` in the thread's folder, and `gh pr view <branch>` (the person's own GitHub login, a read)
 * only once everything is pushed, at most once per commit and SHIP_PR_MS. A `git` or `gh` that is missing, fails or runs past its time
 * hides the row (git) or leaves the pull request unknown (gh), which shows the row only for work not pushed.
 */

import type { MmShip } from '../types'

/** How often a thread looks at its folder again, besides at its start and at the end of each turn. */
export const SHIP_EVERY_MS = 5 * 60_000
/** How long one git command may take. */
export const GIT_MS = 5_000
/** How long `gh pr view` may take. */
export const GH_MS = 8_000
/** `gh pr view` is asked again for the same commit after this long. */
export const SHIP_PR_MS = 10 * 60_000
/** The repository that never gets the row: its edits go to main with no pull request. */
export const CONTROL_TOWER = 'massmarket-ops-control-tower'
/** What a press puts in the prompt box, exactly. */
export const SHIP_WORDS = '/ship'
export const SHIP_BUTTON = 'Ship'
/** Said when the prompt box holds a draft, or cannot be filled. */
export const SHIP_DRAFT = 'Your prompt box holds a draft, so type: /ship'
export const SHIP_TYPE = 'Type this in the thread: /ship'

/** One command's answer: its exit code and what it printed. */
export type Ran = { exitCode: number; stdout: string; stderr: string }
/** Runs one command in a folder within a time; throws when it cannot start. */
export type Run = (argv: string[], cwd: string, timeoutMs: number) => Promise<Ran>

/** The row when it is hidden. */
export const NO_SHIP = (at: number): MmShip => ({ show: false, branch: '', unpushed: 0, pr: 'unknown', head: '', at })

/** The band's words for the row. */
export function shipText(s: Pick<MmShip, 'branch' | 'unpushed' | 'pr'>): string {
  const branch = s.branch.length > 60 ? `${s.branch.slice(0, 59)}…` : s.branch
  const why = s.unpushed > 0 ? `${s.unpushed} ${s.unpushed === 1 ? 'commit' : 'commits'} not pushed` : 'no pull request yet'
  return `Ready to ship: ${branch} · ${why}`
}

/** Whether a checkout is the control tower: its folder, the folder its worktrees share, or its remote names it. */
export function isControlTower(top: string, commonDir: string, remote: string): boolean {
  const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const shared = commonDir.replace(/[\\/]+\.git[\\/]*$/, '')
  return base(top) === CONTROL_TOWER || base(shared) === CONTROL_TOWER || new RegExp(`[/:]${CONTROL_TOWER}(?:\\.git)?/?$`).test(remote.trim())
}

/** What `gh pr view <branch> --json state --jq .state` said. */
export function prOf(r: Ran | null): MmShip['pr'] {
  if (!r) return 'unknown'
  if (r.exitCode === 0) {
    const state = r.stdout.trim().toUpperCase()
    return state === 'OPEN' ? 'open' : state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'unknown'
  }
  return /no pull requests? found/i.test(r.stderr) ? 'none' : 'unknown'
}

/**
 * Looks at the folder: the row as it stands now. `had` is the row last worked out in this thread: its pull request is asked again only
 * for another branch or commit, or once SHIP_PR_MS has gone by.
 */
export async function shipState(run: Run, cwd: string, now: number, had: MmShip | null): Promise<MmShip> {
  const git = async (...args: string[]): Promise<string | null> => {
    try {
      const r = await run(['git', ...args], cwd, GIT_MS)
      return r.exitCode === 0 ? r.stdout.trim() : null
    } catch {
      return null
    }
  }
  const hidden = NO_SHIP(now)
  const top = await git('rev-parse', '--show-toplevel')
  if (!top) return hidden
  const branch = await git('symbolic-ref', '--quiet', '--short', 'HEAD')
  if (!branch) return hidden
  const remote = (await git('config', '--get', 'remote.origin.url')) ?? ''
  const common = (await git('rev-parse', '--path-format=absolute', '--git-common-dir')) ?? ''
  if (isControlTower(top, common, remote)) return hidden
  const origin = (await git('symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')) ?? ''
  let main = origin.startsWith('origin/') ? origin.slice('origin/'.length) : ''
  if (!main) main = (await git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main')) !== null ? 'main' : (await git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/master')) !== null ? 'master' : 'main'
  if (branch === main) return hidden
  const base = (await git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${main}`)) !== null ? `origin/${main}` : main
  const ahead = Number(await git('rev-list', '--count', `${base}..HEAD`)) || 0
  if (ahead <= 0) return hidden
  const head = (await git('rev-parse', 'HEAD')) ?? ''
  const upstream = await git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  const unpushed = upstream ? Number(await git('rev-list', '--count', '@{u}..HEAD')) || 0 : ahead
  let pr: MmShip['pr'] = 'unknown'
  if (unpushed === 0) {
    const asked = had && had.branch === branch && had.head === head && had.pr !== 'unknown' && now - had.at < SHIP_PR_MS
    if (asked) pr = had.pr
    else {
      try {
        pr = prOf(await run(['gh', 'pr', 'view', branch, '--json', 'state', '--jq', '.state'], top, GH_MS))
      } catch {
        pr = 'unknown'
      }
    }
  }
  const at = unpushed === 0 && had && had.branch === branch && had.head === head && had.pr === pr && now - had.at < SHIP_PR_MS ? had.at : now
  return { show: unpushed > 0 || pr === 'none', branch, unpushed, pr, head, at }
}
