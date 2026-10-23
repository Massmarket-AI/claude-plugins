#!/usr/bin/env node
// mm-hooks: keeps the Massmarket time tracker in Google Chrome the same as the published build this plugin
// release carries (extension/ and extension.json, which scripts/release.mjs fills from the published release).
//
// Why it exists (Rob, 2026-10-23): the tracker is an unpacked extension, so every update meant each person
// downloading a zip, extracting it over the folder Chrome loads it from and pressing reload. On each session
// start this writes the carried build into that folder, and the extension (0.11.5 and later) sees the newer
// manifest and reloads itself. The person does nothing.
//
// Where it writes:
//   - only into a folder that a Chrome profile's own settings name as the unpacked install of the tracker's
//     id, whose manifest.json carries the tracker's exact key and names a LOWER version than the carried one.
//     Never another extension, never a downgrade, never an equal version.
//   - never into a git working copy (a folder with .git in it: someone working on the extension itself).
//   - never into a folder a profile loads with Developer mode off: Chrome turns an unpacked extension off
//     when it reloads there (measured 2026-10-23, Chrome 153), and the tracker would stop.
//   - every carried file is checked against its sha256 in extension.json first; one mismatch and nothing is
//     written anywhere.
//   - new files first, manifest.json LAST, so the extension only sees the new version once every other file is
//     in place. A file that is not in the carried list is never deleted.
// What it never does: touch the token, the consent or any setting (they live in Chrome's storage, not in the
// folder), write any of Chrome's own files, send anything anywhere, or print anything but the notice below.
//
// What it tells Claude, in SessionStart additionalContext, for Claude to pass on. At most ONE notice a day, shared
// by both sentences:
//   - a WORK profile used in the last 7 days with no install of the tracker, named by its @massmarket.ai email.
//     ⛔ A work profile is one whose Preferences `account_info` holds an @massmarket.ai account. Any other
//     profile is never named or counted: personal browsing stays out (Rob's rule, 2026-10-23). Only each
//     account's `email` is read, and no email is written anywhere; plugin-sync.json keeps the count only.
//   - a tracker folder skipped because Developer mode is off, so the member turns it on.
//
// What it did is recorded under `extension` in ~/.claude/mm-hooks/plugin-sync.json, beside sync-hook.js's
// record (a folder is a short hash of its path, never the path). Any error: silent, and the session goes on.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { updateStatus } = require("./plugin-status");

const EXT_ID = "lcnfnlckdnnmgijlfmedfikafaogenga";
const PLUGIN_ROOT = path.join(__dirname, "..");
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const NOTICE_EVERY_MS = 24 * 60 * 60 * 1000;
const PREFS_MAX_BYTES = 64 * 1024 * 1024;
// Chrome's ManifestLocation numbers for an unpacked folder: kUnpacked ("Load unpacked") and kCommandLine.
const UNPACKED_LOCATIONS = [4, 8];
// What Chrome accepts as a version: one to four dot-separated integers.
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/;
// Writing stops this long after the step starts, well inside its 10-second hook timeout. A folder cut short
// keeps its old manifest.json, so the extension stays on the old build until the next session finishes it.
const WRITE_BUDGET_MS = 6000;
// A Massmarket Google account, as Chrome lists it in a profile's account_info. Plain address characters only, so
// nothing but an address can reach the sentence.
const WORK_EMAIL_RE = /^[a-z0-9._%+-]{1,64}@massmarket\.ai$/i;
const DEV_MODE_SENTENCE =
  "The Massmarket time tracker in Chrome cannot update itself because Developer mode is off on chrome://extensions. Ask the member to turn on Developer mode there (the switch at the top right); after that the tracker keeps itself up to date.";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** The id Chrome derives from a manifest key: the sha256 of the key's DER bytes, first 32 hex digits as a-p. */
function extensionIdFromKey(key) {
  return sha256(Buffer.from(String(key), "base64"))
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/** 1 / 0 / -1 for a > b / a == b / a < b, numerically, part by part. */
function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Google Chrome's user data folder on this platform, or null where Chrome has none we know. */
function chromeUserDataDir(platform, env, home) {
  if (platform === "win32") return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "Google", "Chrome", "User Data");
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Google", "Chrome");
  if (platform === "linux") return path.posix.join(home, ".config", "google-chrome");
  return null;
}

function readJson(file, maxBytes = PREFS_MAX_BYTES) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function dig(obj, keys) {
  return keys.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), obj);
}

/** The first @massmarket.ai address in a profile's account_info, or null. Reads each entry's `email` and nothing else. */
function workEmail(prefs) {
  const accounts = prefs && prefs.account_info;
  if (!Array.isArray(accounts)) return null;
  for (const a of accounts) {
    const email = a && typeof a === "object" && typeof a.email === "string" ? a.email.trim() : "";
    if (WORK_EMAIL_RE.test(email)) return email;
  }
  return null;
}

/**
 * One profile folder: its tracker install (the settings entry for our id), Developer mode, when it was last used,
 * and its @massmarket.ai account (null for any other profile).
 */
function readProfile(userDataDir, dir) {
  const base = path.join(userDataDir, dir);
  let install = null;
  let developerMode = null;
  let email = null;
  for (const name of ["Secure Preferences", "Preferences"]) {
    const prefs = readJson(path.join(base, name));
    if (!prefs) continue;
    if (name === "Preferences") email = workEmail(prefs);
    const entry = dig(prefs, ["extensions", "settings", EXT_ID]);
    if (!install && entry && typeof entry === "object") install = entry;
    const dev = dig(prefs, ["extensions", "ui", "developer_mode"]);
    if (developerMode === null && typeof dev === "boolean") developerMode = dev;
  }
  let usedAt = 0;
  try {
    usedAt = fs.statSync(path.join(base, "Preferences")).mtimeMs;
  } catch (_) {
    // never used, as far as we can tell
  }
  return { dir, install, developerMode, usedAt, workEmail: email };
}

/** Every profile: the ones Local State lists, and any other folder with Preferences. Display names are not read. */
function listProfiles(userDataDir) {
  const listed = new Set();
  const cache = dig(readJson(path.join(userDataDir, "Local State")), ["profile", "info_cache"]);
  if (cache && typeof cache === "object") {
    for (const dir of Object.keys(cache)) {
      if (!dir || /[\\/]/.test(dir) || dir === "." || dir === "..") continue;
      listed.add(dir);
    }
  }
  const dirs = Array.from(listed);
  try {
    for (const d of fs.readdirSync(userDataDir, { withFileTypes: true })) {
      if (!d.isDirectory() || listed.has(d.name)) continue;
      const base = path.join(userDataDir, d.name);
      if (fs.existsSync(path.join(base, "Preferences")) || fs.existsSync(path.join(base, "Secure Preferences"))) dirs.push(d.name);
    }
  } catch (_) {
    // an unreadable user data folder lists only what Local State named
  }
  return dirs.map((dir) => readProfile(userDataDir, dir));
}

/** The folder an install entry loads from, when it is an unpacked install; otherwise null. */
function unpackedFolder(install) {
  if (!install || typeof install.path !== "string" || !path.isAbsolute(install.path)) return null;
  if (typeof install.location === "number" && UNPACKED_LOCATIONS.indexOf(install.location) === -1) return null;
  return install.path;
}

function safeRel(rel) {
  if (typeof rel !== "string" || !rel || /[\\\0:]/.test(rel) || rel.startsWith("/")) return false;
  return rel.split("/").every((seg) => seg && seg !== "." && seg !== "..");
}

/**
 * The build this release carries, every file checked against extension.json. Throws on anything wrong: a
 * missing or unsafe entry, a sha256 mismatch, no manifest, a manifest whose version is not extension.json's,
 * or a key that is not the tracker's id. Files come back in write order, manifest.json last.
 */
function loadCarried(root) {
  const meta = readJson(path.join(root, "extension.json"), 1 << 20);
  if (!meta || typeof meta.version !== "string" || !VERSION_RE.test(meta.version) || !meta.files || typeof meta.files !== "object") {
    throw new Error("extension.json is missing or malformed");
  }
  const files = [];
  for (const [rel, want] of Object.entries(meta.files)) {
    if (!safeRel(rel)) throw new Error("unsafe path in extension.json");
    const bytes = fs.readFileSync(path.join(root, "extension", ...rel.split("/")));
    if (typeof want !== "string" || sha256(bytes) !== want) throw new Error("sha256 mismatch: " + rel);
    files.push({ rel, bytes });
  }
  const manifestFile = files.find((f) => f.rel === "manifest.json");
  if (!manifestFile) throw new Error("the carried build has no manifest.json");
  const manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  if (manifest.version !== meta.version) throw new Error("the carried manifest is not extension.json's version");
  if (typeof manifest.key !== "string" || extensionIdFromKey(manifest.key) !== EXT_ID) throw new Error("the carried manifest is not the tracker's key");
  return { version: meta.version, key: manifest.key, files: files.filter((f) => f !== manifestFile).concat(manifestFile) };
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Write one file by rename. A few retries for Windows, where a file Chrome is reading can refuse a rename. */
function writeFile(folder, rel, bytes) {
  const target = path.join(folder, ...rel.split("/"));
  const inside = path.relative(folder, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("path outside the folder");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + ".mm-new-" + process.pid;
  fs.writeFileSync(tmp, bytes);
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, target);
      return;
    } catch (err) {
      if (attempt >= 4 || !err || ["EPERM", "EBUSY", "EACCES"].indexOf(err.code) === -1) {
        try {
          fs.unlinkSync(tmp);
        } catch (_) {
          // nothing left behind to clean
        }
        throw err;
      }
      sleep(100 * attempt);
    }
  }
}

/** Bring one folder up to the carried build, or say why not. Never writes manifest.json until the rest is in place. */
function syncFolder(folder, carried, deadline = Infinity) {
  const out = { id: sha256(folder).slice(0, 12) };
  if (fs.existsSync(path.join(folder, ".git"))) return Object.assign(out, { action: "skipped-git-checkout" });
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
  } catch (_) {
    // handled below
  }
  if (!manifest || typeof manifest !== "object") return Object.assign(out, { action: "skipped-unreadable-manifest" });
  if (manifest.key !== carried.key) return Object.assign(out, { action: "skipped-other-key" });
  if (typeof manifest.version !== "string" || !VERSION_RE.test(manifest.version)) return Object.assign(out, { action: "skipped-unreadable-manifest" });
  out.before = manifest.version;
  const order = cmpVersion(manifest.version, carried.version);
  if (order === 0) return Object.assign(out, { action: "current" });
  if (order > 0) return Object.assign(out, { action: "skipped-newer" });
  const fresh = [];
  const changed = [];
  for (const f of carried.files) {
    if (f.rel === "manifest.json") continue;
    let have = null;
    try {
      have = fs.readFileSync(path.join(folder, ...f.rel.split("/")));
    } catch (_) {
      // not there yet
    }
    if (have === null) fresh.push(f);
    else if (!have.equals(f.bytes)) changed.push(f);
  }
  for (const f of fresh.concat(changed, carried.files.filter((x) => x.rel === "manifest.json"))) {
    if (Date.now() > deadline) throw new Error("out of time before " + f.rel);
    writeFile(folder, f.rel, f.bytes);
  }
  out.after = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")).version;
  out.files_written = fresh.length + changed.length + 1;
  return Object.assign(out, { action: "updated" });
}

/** The work-profile sentence for Claude, or null. Only @massmarket.ai addresses, each once, at most five. */
function noticeSentence(emails) {
  const list = [];
  for (const e of emails) if (typeof e === "string" && WORK_EMAIL_RE.test(e) && list.indexOf(e) === -1) list.push(e);
  if (!list.length) return null;
  const shown = list.slice(0, 5).join(", ");
  return list.length === 1
    ? `The Massmarket time tracker is not installed in the Chrome profile signed in as ${shown}, which was used recently. Ask the member to load the tracker in that profile so the work done there is tracked.`
    : `The Massmarket time tracker is not installed in the Chrome profiles signed in as ${shown}, which were used recently. Ask the member to load the tracker in those profiles so the work done there is tracked.`;
}

/** Everything the step does, as data: `status` for plugin-sync.json and `notice` for additionalContext. */
function run({ platform = process.platform, env = process.env, home = os.homedir(), pluginRoot = PLUGIN_ROOT, now = Date.now(), lastNoticeAt = 0, deadline = Date.now() + WRITE_BUDGET_MS } = {}) {
  const status = { at: new Date(now).toISOString() };
  const userDataDir = chromeUserDataDir(platform, env, home);
  if (!userDataDir || !fs.existsSync(userDataDir)) return { status: Object.assign(status, { action: "no-chrome" }), notice: null };
  const profiles = listProfiles(userDataDir);

  // Work profiles only: a profile with no @massmarket.ai account is never named or counted.
  const recentWithout = profiles.filter((p) => p.workEmail && !p.install && p.usedAt > 0 && now - p.usedAt <= RECENT_MS);
  status.profiles_recent_without_tracker = recentWithout.length;
  const profileSentence = noticeSentence(recentWithout.map((p) => p.workEmail));
  // One notice a day at most, both sentences in it.
  const done = (developerModeOff = false) => {
    const sentences = [profileSentence, developerModeOff ? DEV_MODE_SENTENCE : null].filter(Boolean);
    let notice = null;
    if (sentences.length && !(now - lastNoticeAt < NOTICE_EVERY_MS)) {
      notice = sentences.join(" ");
      status.notice_at = status.at;
    } else if (lastNoticeAt) {
      status.notice_at = new Date(lastNoticeAt).toISOString();
    }
    return { status, notice };
  };

  // Each folder once, however many profiles load it; Developer mode must be on in every one of them.
  const folders = new Map();
  for (const p of profiles) {
    const folder = unpackedFolder(p.install);
    if (!folder) continue;
    const seen = folders.get(folder) || { developerModeOff: false };
    if (p.developerMode !== true) seen.developerModeOff = true;
    folders.set(folder, seen);
  }
  if (!folders.size) {
    status.action = "not-installed";
    return done();
  }

  if (!fs.existsSync(path.join(pluginRoot, "extension.json"))) {
    status.action = "nothing-carried";
    return done();
  }
  let carried;
  try {
    carried = loadCarried(pluginRoot);
  } catch (err) {
    Object.assign(status, { action: "carried-invalid", error: String((err && err.message) || err).slice(0, 200) });
    return done();
  }
  status.carried = carried.version;
  status.folders = Array.from(folders, ([folder, seen]) => {
    if (seen.developerModeOff) return { id: sha256(folder).slice(0, 12), action: "skipped-developer-mode-off" };
    try {
      return syncFolder(folder, carried, deadline);
    } catch (err) {
      return { id: sha256(folder).slice(0, 12), action: "error", error: String((err && err.message) || err).slice(0, 200) };
    }
  });
  status.action = status.folders.some((f) => f.action === "updated") ? "updated" : "checked";
  return done(status.folders.some((f) => f.action === "skipped-developer-mode-off"));
}

function main() {
  const hookDir = path.join(process.env.MM_HOOK_HOME || os.homedir(), ".claude", "mm-hooks");
  let lastNoticeAt = 0;
  const previous = readJson(path.join(hookDir, "plugin-sync.json"), 1 << 20);
  const at = Date.parse(dig(previous, ["extension", "notice_at"]) || "");
  if (Number.isFinite(at)) lastNoticeAt = at;
  let result;
  try {
    result = run({ home: process.env.MM_HOOK_HOME || os.homedir(), lastNoticeAt });
  } catch (err) {
    result = { status: { at: new Date().toISOString(), action: "error", error: String((err && err.message) || err).slice(0, 200) }, notice: null };
  }
  updateStatus(hookDir, (current) => Object.assign({}, current, { extension: result.status }));
  if (result.notice) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: result.notice } }) + "\n");
  }
}

if (require.main === module) {
  try {
    main();
  } catch (_) {
    // fail open and silent
  }
  process.exit(0);
}

module.exports = { EXT_ID, chromeUserDataDir, cmpVersion, extensionIdFromKey, listProfiles, loadCarried, noticeSentence, run, syncFolder, unpackedFolder };
