#!/usr/bin/env node
// Release the Massmarket plugins (Rob only).
//
//   node scripts/release.mjs            copy the hook, bump changed plugins, validate, scan, commit, push
//   node scripts/release.mjs --dry-run  everything except commit and push
//
// 1. Copies .claude/scripts/worklog-hook.js from the onboarding-wizard origin/main (OW_REPO, default
//    ~/Projects/onboarding-wizard) into plugins/mm-hooks/scripts/. That is the same file GET
//    /api/ext/hook-install?file=hook serves, so the plugin never carries a hook OW has not shipped.
// 2. Bumps the patch version of every plugin whose files changed since the last commit and whose
//    version was not bumped by hand. An unbumped plugin reaches nobody: auto-update keys on version.
//    mm-bridge's VERSION constant is kept equal to its plugin.json.
// 3. Validates with `claude plugin validate`, runs the bridge's tests, scans with gitleaks.
// 4. Commits and pushes main.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OW = process.env.OW_REPO || join(homedir(), 'Projects', 'onboarding-wizard')
const DRY = process.argv.includes('--dry-run')
const PLUGINS = ['mm-hooks', 'mm-bridge']

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const git = (...args) => run('git', args)

function claudeBin() {
  const found = []
  try {
    found.push(run('which', ['claude']).trim())
  } catch {}
  const app = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')
  if (existsSync(app)) {
    for (const v of readdirSync(app).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const h of readdirSync(join(app, v))) {
        const p = join(app, v, h, 'claude.app', 'Contents', 'MacOS', 'claude')
        if (existsSync(p)) found.unshift(p)
      }
      if (found.length > 1) break
    }
  }
  if (!found[0]) throw new Error('no claude binary found')
  return found[0]
}

function bump(v) {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
}

if (git('status', '--porcelain', '--', 'scripts', '.claude-plugin').trim()) throw new Error('commit or discard changes outside plugins/ first')
git('pull', '--ff-only', '-q')

run('git', ['-C', OW, 'fetch', '-q', 'origin', 'main'])
const hook = run('git', ['-C', OW, 'show', 'origin/main:.claude/scripts/worklog-hook.js'], { maxBuffer: 64 << 20 })
writeFileSync(join(ROOT, 'plugins/mm-hooks/scripts/worklog-hook.js'), hook)

const released = []
for (const p of PLUGINS) {
  const dir = `plugins/${p}`
  const manifestPath = join(ROOT, dir, '.claude-plugin/plugin.json')
  const changed = git('status', '--porcelain', '--', dir).trim() !== ''
  if (!changed) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let headVersion = null
  try {
    headVersion = JSON.parse(git('show', `HEAD:${dir}/.claude-plugin/plugin.json`)).version
  } catch {}
  if (manifest.version === headVersion) {
    manifest.version = bump(manifest.version)
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  }
  if (p === 'mm-bridge') {
    const reg = join(ROOT, dir, 'hooks/register.tsx')
    const src = readFileSync(reg, 'utf8')
    const next = src.replace(/const VERSION = '[^']*'/, `const VERSION = '${manifest.version}'`)
    if (!next.includes(`const VERSION = '${manifest.version}'`)) throw new Error('mm-bridge: VERSION constant not found')
    writeFileSync(reg, next)
  }
  released.push(`${p} ${manifest.version}`)
}
if (!released.length) {
  console.log('Nothing changed; nothing to release.')
  process.exit(0)
}

const claude = claudeBin()
for (const target of ['.', ...PLUGINS.map(p => `plugins/${p}`)]) {
  const out = run(claude, ['plugin', 'validate', target])
  if (!/Validation passed/.test(out)) throw new Error(`validate ${target} failed:\n${out}`)
}
run(claude, ['plugin', 'test', '.'], { cwd: join(ROOT, 'plugins/mm-bridge') })
run('gitleaks', ['dir', ROOT, '--redact', '--no-banner'])

console.log(`Releasing: ${released.join(', ')}`)
if (DRY) {
  console.log('Dry run: not committed.')
  process.exit(0)
}
git('add', '--', 'plugins')
git('commit', '-q', '-m', `Release ${released.join(', ')}`)
git('push', '-q', 'origin', 'HEAD:main')
console.log('Pushed. Teammates get it at their next session start, loaded the session after.')
