// Fill plugins/mm-hooks/extension/ and extension.json from the PUBLISHED time tracker release, for release.mjs.
//
// Same rule as the worklog hook: the plugin never carries a build the server has not published. The published
// release is what GET /api/ext/version answers ({ latest, download_url }, from the newest time_ext_release row).
// The zip at download_url is downloaded, extracted with the system tar (it reads zip on macOS and Windows 10+;
// unzip is the fallback), and carried only if it is flat, has no links, and its manifest names exactly `latest`
// under the tracker's key. A CDN that still serves the previous zip fails that check and stops the release.
//
// The route is Bearer-authed like every /api/ext route, so MM_EXT_TOKEN is the releaser's own time tracker
// token. It is sent to that route only, and never printed or written. Without it the carried build is kept as
// it is (and still checked), and release.mjs says so.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const EXT_ID = 'lcnfnlckdnnmgijlfmedfikafaogenga'
export const VERSION_URL = 'https://onboarding-wizard.massmarket.ai/api/ext/version'
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/
const MAX_FILES = 500
const MAX_BYTES = 20 * 1024 * 1024

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** The id Chrome derives from a manifest key: sha256 of the key's DER bytes, first 32 hex digits as a-p. */
export function extensionIdFromKey(key) {
  return sha256(Buffer.from(String(key), 'base64')).slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)))
}

/** Every file under `dir`, as forward-slash paths. Refuses links and anything that is not a file or a folder. */
function listFiles(dir) {
  const out = []
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name
      const st = lstatSync(join(dir, r))
      if (st.isSymbolicLink()) throw new Error(`the release zip holds a link: ${r}`)
      if (st.isDirectory()) walk(r)
      else if (st.isFile()) out.push(r)
      else throw new Error(`the release zip holds something that is not a file: ${r}`)
    }
  }
  walk('')
  return out
}

/** The version the plugin carries now, after checking every file against extension.json; null when it carries none. */
export function carriedVersion(pluginDir) {
  const metaPath = join(pluginDir, 'extension.json')
  if (!existsSync(metaPath)) return null
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  for (const [rel, want] of Object.entries(meta.files || {})) {
    if (sha256(readFileSync(join(pluginDir, 'extension', ...rel.split('/')))) !== want) throw new Error(`carried ${rel} does not match extension.json`)
  }
  const files = listFiles(join(pluginDir, 'extension'))
  if (files.length !== Object.keys(meta.files || {}).length) throw new Error('plugins/mm-hooks/extension/ holds files extension.json does not list')
  return meta.version
}

/** Extract `zip` into `out`: tar first (bsdtar reads zip), unzip if tar cannot. */
function extract(zip, out) {
  try {
    execFileSync('tar', ['-xf', zip, '-C', out], { stdio: ['ignore', 'ignore', 'pipe'] })
    return
  } catch {
    rmSync(out, { recursive: true, force: true })
    mkdirSync(out)
  }
  execFileSync('unzip', ['-q', zip, '-d', out], { stdio: ['ignore', 'ignore', 'pipe'] })
}

/**
 * Replace the carried build with the published one. Returns { action, version } where action is 'kept' (no
 * token), 'current' (the published build is already carried, byte for byte) or 'updated'. Throws on anything
 * else, before touching the carried build.
 */
export async function carryPublishedExtension({ pluginDir, token, versionUrl = VERSION_URL, fetchImpl = fetch, log = console.log }) {
  if (!token) {
    const v = carriedVersion(pluginDir)
    log(`Extension: MM_EXT_TOKEN is not set, so the carried build (${v ? `v${v}` : 'none'}) is kept. Set it to your time tracker token to carry the published release.`)
    return { action: 'kept', version: v }
  }
  const res = await fetchImpl(versionUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`GET ${versionUrl} answered HTTP ${res.status}`)
  const { latest, download_url: downloadUrl } = await res.json()
  if (typeof latest !== 'string' || !VERSION_RE.test(latest)) throw new Error('the server names no published version')
  const url = new URL(String(downloadUrl || ''))
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('the download URL is not https')
  url.searchParams.set('cb', String(Date.now()))

  const work = mkdtempSync(join(tmpdir(), 'mm-carry-ext-'))
  try {
    const dl = await fetchImpl(url.href, { cache: 'no-store' })
    if (!dl.ok) throw new Error(`the release zip answered HTTP ${dl.status}`)
    const zipBytes = Buffer.from(await dl.arrayBuffer())
    if (!zipBytes.length || zipBytes.length > MAX_BYTES) throw new Error('the release zip is empty or too large')
    const zipPath = join(work, 'release.zip')
    writeFileSync(zipPath, zipBytes)
    const out = join(work, 'extension')
    mkdirSync(out)
    extract(zipPath, out)
    const files = listFiles(out)
    if (!files.length || files.length > MAX_FILES) throw new Error('the release zip holds no files, or too many')
    if (!files.includes('manifest.json')) throw new Error('the release zip has no manifest.json at its top (a wrapper folder?)')
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    if (manifest.version !== latest) throw new Error(`the downloaded zip says v${manifest.version}, but the published release is v${latest} (a CDN still serving the old zip? try again in a few minutes)`)
    if (typeof manifest.key !== 'string' || extensionIdFromKey(manifest.key) !== EXT_ID) throw new Error('the downloaded zip is not the time tracker (its key does not derive the tracker id)')

    const meta = { version: latest, zip_sha256: sha256(zipBytes), files: {} }
    for (const f of files) meta.files[f] = sha256(readFileSync(join(out, ...f.split('/'))))
    const metaText = JSON.stringify(meta, null, 1) + '\n'
    const metaPath = join(pluginDir, 'extension.json')
    const same = existsSync(metaPath) && JSON.stringify(JSON.parse(readFileSync(metaPath, 'utf8')).files) === JSON.stringify(meta.files)
    if (same) {
      log(`Extension: v${latest} is already carried.`)
      return { action: 'current', version: latest }
    }
    const dest = join(pluginDir, 'extension')
    rmSync(dest, { recursive: true, force: true })
    cpSync(out, dest, { recursive: true })
    writeFileSync(metaPath, metaText)
    log(`Extension: now carrying v${latest} (${files.length} files).`)
    return { action: 'updated', version: latest }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
