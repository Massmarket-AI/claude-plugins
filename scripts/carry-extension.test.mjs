// Tests for carry-extension.mjs: the plugin carries the PUBLISHED time tracker build and nothing else.
//
//   node --test scripts/carry-extension.test.mjs
//
// A local server on 127.0.0.1 stands in for OW's GET /api/ext/version and the bucket's zip; the zips are
// built here with `zip`. Nothing reaches the network.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carryPublishedExtension, carriedVersion, extensionIdFromKey } from './carry-extension.mjs'

// The tracker's public manifest key (it pins the extension id; a public key, not a secret).
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjST3RY9+5+HmZ+cszeP2CJM0k350CSXHEYrnGkOUASUbxSaJsjjdugOxPoVzUdyjYiX3MuqtCA8idD+l5Jx+DhnPMOCI8Zr7eKcA1YD7auBTIP9qgBTp144DBjIy3LLkfiz5iGOPc2z9+uZOOiOWR8Yu8gSl9EPzZNgiCrx8d/w5fX9tdykbLMYR8dc1Obbs5YiSw0Ls72oytHYFMf3UuUyUzf/NHB+oF6UUA7KxOx3/mq4Q7SOaHrDYLMUNVS+4o2Em13ehlWiLvd0JvqHJA1FCw5aR9fKYqMDN1W3ismPUfSwkNq3N8Ckcp4wVHBJav9qOuXac+2nHcUE/uGpiTQIDAQAB'
const TOKEN = 'test-token-not-a-real-one'
const sha = (b) => createHash('sha256').update(b).digest('hex')
const tmp = (p) => mkdtempSync(join(tmpdir(), p))
const quiet = () => {}

/** A release zip built the way tools/publish.mjs builds one (flat), optionally bent by `bend(dir)`. */
function zipOf(version, { key = KEY, wrapper = false, bend = null } = {}) {
  const src = tmp('mm-zip-src-')
  const root = wrapper ? join(src, 'massmarket-time-tracker') : src
  mkdirSync(join(root, 'icons'), { recursive: true })
  writeFileSync(join(root, 'background.js'), `// ${version}\n`)
  writeFileSync(join(root, 'icons', 'icon16.png'), `png ${version}`)
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({ manifest_version: 3, version, key, background: { service_worker: 'background.js' } }))
  if (bend) bend(root)
  const zip = join(tmp('mm-zip-out-'), 'z.zip')
  execFileSync('zip', ['-q', '-r', '-y', zip, '.'], { cwd: src })
  return readFileSync(zip)
}

/** OW's version route and the bucket, on 127.0.0.1. `state` is changed by the tests between calls. */
async function server(state) {
  const seen = []
  const s = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || null })
    if (req.url.startsWith('/api/ext/version')) {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end('{"error":"Missing Authorization: Bearer <token>."}')
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ latest: state.latest, min_supported: '0.11.0', download_url: `http://127.0.0.1:${s.address().port}/zip/latest.zip` }))
    }
    if (req.url.startsWith('/zip/')) {
      if (!state.zip) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'content-type': 'application/zip' })
      return res.end(state.zip)
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  return { versionUrl: `http://127.0.0.1:${s.address().port}/api/ext/version`, seen, close: () => new Promise((r) => s.close(r)) }
}

function pluginDir() {
  return tmp('mm-plugin-')
}

test('the tracker key derives the tracker id', () => {
  assert.equal(extensionIdFromKey(KEY), 'lcnfnlckdnnmgijlfmedfikafaogenga')
})

test('the published build is carried: every file with its sha256, the zip hash, the token sent to the route only', async () => {
  const state = { latest: '0.11.5', zip: zipOf('0.11.5') }
  const srv = await server(state)
  try {
    const dir = pluginDir()
    const r = await carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet })
    assert.deepEqual(r, { action: 'updated', version: '0.11.5' })
    const meta = JSON.parse(readFileSync(join(dir, 'extension.json'), 'utf8'))
    assert.equal(meta.version, '0.11.5')
    assert.equal(meta.zip_sha256, sha(state.zip))
    assert.deepEqual(Object.keys(meta.files).sort(), ['background.js', 'icons/icon16.png', 'manifest.json'])
    for (const [rel, want] of Object.entries(meta.files)) assert.equal(sha(readFileSync(join(dir, 'extension', ...rel.split('/')))), want, rel)
    assert.equal(carriedVersion(dir), '0.11.5')
    assert.deepEqual(srv.seen.map((x) => [x.url.split('?')[0], x.auth]), [['/api/ext/version', `Bearer ${TOKEN}`], ['/zip/latest.zip', null]], 'the token goes to the version route and nowhere else')
    assert.match(srv.seen[1].url, /[?&]cb=\d+/, 'past the CDN cache')
    // The same release again: nothing changes.
    const again = await carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet })
    assert.deepEqual(again, { action: 'current', version: '0.11.5' })
  } finally {
    await srv.close()
  }
})

test('⛔ a zip whose manifest is not the published version (a lagging CDN) is refused, and the carried build is untouched', async () => {
  const state = { latest: '0.11.5', zip: zipOf('0.11.5') }
  const srv = await server(state)
  try {
    const dir = pluginDir()
    await carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet })
    const before = readFileSync(join(dir, 'extension.json'), 'utf8')
    state.latest = '0.11.6' // the row says 0.11.6, the CDN still serves 0.11.5
    await assert.rejects(carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet }), /says v0\.11\.5, but the published release is v0\.11\.6/)
    assert.equal(readFileSync(join(dir, 'extension.json'), 'utf8'), before)
    assert.equal(carriedVersion(dir), '0.11.5')
  } finally {
    await srv.close()
  }
})

test('⛔ not the tracker, a wrapper folder, a link, no manifest, a refusal or a missing zip: refused, nothing carried', async () => {
  const cases = [
    ['another key', { latest: '0.11.5', zip: zipOf('0.11.5', { key: KEY.slice(0, -12) + 'AAAAAAAAAAAA' }) }, /not the time tracker/],
    ['a wrapper folder', { latest: '0.11.5', zip: zipOf('0.11.5', { wrapper: true }) }, /no manifest\.json at its top/],
    ['a link inside', { latest: '0.11.5', zip: zipOf('0.11.5', { bend: (d) => symlinkSync('/etc/hosts', join(d, 'hosts')) }) }, /holds a link/],
    ['no zip', { latest: '0.11.5', zip: null }, /HTTP 404/],
    ['no published version', { latest: null, zip: zipOf('0.11.5') }, /no published version/],
  ]
  for (const [label, state, error] of cases) {
    const srv = await server(state)
    try {
      const dir = pluginDir()
      await assert.rejects(carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet }), error, label)
      assert.equal(existsSync(join(dir, 'extension.json')), false, label)
      assert.equal(existsSync(join(dir, 'extension')), false, label)
    } finally {
      await srv.close()
    }
  }
  const srv = await server({ latest: '0.11.5', zip: zipOf('0.11.5') })
  try {
    await assert.rejects(carryPublishedExtension({ pluginDir: pluginDir(), token: 'wrong', versionUrl: srv.versionUrl, log: quiet }), /HTTP 401/)
  } finally {
    await srv.close()
  }
})

test('no token: nothing is fetched, and the carried build is kept and still checked', async () => {
  const state = { latest: '0.11.5', zip: zipOf('0.11.5') }
  const srv = await server(state)
  try {
    const dir = pluginDir()
    await carryPublishedExtension({ pluginDir: dir, token: TOKEN, versionUrl: srv.versionUrl, log: quiet })
    srv.seen.length = 0
    const lines = []
    const r = await carryPublishedExtension({ pluginDir: dir, token: '', versionUrl: srv.versionUrl, log: (l) => lines.push(l) })
    assert.deepEqual(r, { action: 'kept', version: '0.11.5' })
    assert.deepEqual(srv.seen, [])
    assert.match(lines[0], /MM_EXT_TOKEN is not set, so the carried build \(v0\.11\.5\) is kept/)
    // A carried file edited by hand is caught even without a token.
    writeFileSync(join(dir, 'extension', 'background.js'), '// edited\n')
    await assert.rejects(carryPublishedExtension({ pluginDir: dir, token: '', versionUrl: srv.versionUrl, log: quiet }), /does not match extension\.json/)
    assert.deepEqual(await carryPublishedExtension({ pluginDir: pluginDir(), token: undefined, log: quiet }), { action: 'kept', version: null })
  } finally {
    await srv.close()
  }
})

test('release.mjs carries the extension right after the hook copy, and runs these tests', () => {
  const rel = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
  const hookAt = rel.indexOf("writeFileSync(join(ROOT, 'plugins/mm-hooks/scripts/worklog-hook.js'), hook)")
  const carryAt = rel.indexOf("await carryPublishedExtension({ pluginDir: join(ROOT, 'plugins/mm-hooks'), token: process.env.MM_EXT_TOKEN })")
  const bumpAt = rel.indexOf('const released = []')
  assert.ok(hookAt > 0 && carryAt > hookAt && bumpAt > carryAt, 'the carry step runs before the version bump, so a new build bumps mm-hooks')
  assert.match(rel, /'--test', 'plugins\/mm-hooks\/scripts\/sync-extension\.test\.js', 'scripts\/carry-extension\.test\.mjs'/)
})
