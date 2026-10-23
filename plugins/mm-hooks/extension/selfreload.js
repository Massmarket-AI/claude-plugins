// selfreload.js — 0.11.5: the extension picks up a newer build that is already on disk.
//
// An update used to be: download a zip, extract it into the folder Chrome loads
// from, then press reload on chrome://extensions. The mm-hooks Claude Code plugin
// now writes the published build into that folder by itself (manifest.json last),
// and this is the other half: every 5 minutes, and on every service-worker start,
// the worker reads manifest.json as Chrome serves it now and, when it names a newer
// version under OUR key, flushes what it holds and calls chrome.runtime.reload().
// For an unpacked extension Chrome serves the files from the folder, so the fetch
// sees the new manifest as soon as it is written, and the reload loads the folder.
//
// ⛔ ONE PLACE DECIDES, as capture.js does for capture: selfReloadDecision() below
// is the whole predicate and has no chrome.* in it, so verify/self-reload.test.mjs
// can drive it with plain node. background.js fetches, flushes and reloads.
//
// ⛔ AT MOST ONE RELOAD PER VERSION. The worker stores the version it reloaded for
// (GUARD_KEY) before it reloads. If Chrome comes back still running the old build —
// a manifest it could not load, a folder only half written by hand — the guard
// stops a reload every 5 minutes for ever. A later version is a new attempt.
//
// ⛔ AN UNREADABLE OR PARTIAL manifest.json IS "NOT YET", never "reload". A reload
// onto a manifest Chrome cannot load leaves the member with no tracker at all.

import { cmpSemver } from './common.js';

export const SELF_RELOAD = Object.freeze({
  ALARM: 'self_reload_check',
  PERIOD_MIN: 5,
  GUARD_KEY: 'selfReload',
});

// What Chrome accepts as a version: one to four dot-separated integers.
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/;

/**
 * Should the worker reload onto the build on disk?
 *
 *   running  — chrome.runtime.getManifest() (needs `version` and `key`)
 *   diskText — manifest.json's text, fetched from the extension's own URL
 *   guard    — what GUARD_KEY holds: { version } of the last self-reload, or null
 *
 * Returns { reload: true, version } only when the disk manifest parses, is a
 * complete MV3 manifest with a service worker, carries exactly the running key,
 * names a version numerically greater than the running one, and that version has
 * not been reloaded for already. Otherwise { reload: false, reason }.
 */
export function selfReloadDecision({ running, diskText, guard } = {}) {
  const no = (reason) => ({ reload: false, reason });
  let disk;
  try { disk = JSON.parse(String(diskText)); } catch (e) { return no('unparseable'); }
  if (!disk || typeof disk !== 'object' || Array.isArray(disk)) return no('unparseable');
  if (typeof disk.version !== 'string' || !VERSION_RE.test(disk.version)) return no('partial');
  if (disk.manifest_version !== 3) return no('partial');
  if (!disk.background || typeof disk.background.service_worker !== 'string' || !disk.background.service_worker) return no('partial');
  if (typeof disk.key !== 'string' || !disk.key) return no('partial');
  if (!running || typeof running.key !== 'string' || disk.key !== running.key) return no('other-key');
  if (cmpSemver(disk.version, running.version) <= 0) return no('not-newer');
  if (guard && guard.version === disk.version) return no('already-reloaded');
  return { reload: true, version: disk.version };
}
