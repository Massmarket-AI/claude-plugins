#!/usr/bin/env node
// mm-hooks: keeps the Massmarket plugins on this computer (mm-hooks, mm-bridge and massmarket-theme) at the version on
// GitHub, even where Claude Code's own plugin auto-update is off, and installs massmarket-theme once.
//
// Why it exists (Rob, 2026-10-26): two team computers (Arch Linux, the terminal CLI) sat on old plugin versions for
// days. Their settings.json never got extraKnownMarketplaces.massmarket.autoUpdate or env.FORCE_AUTOUPDATE_PLUGINS
// (the installer leaves the user-level settings alone on a folder-scoped install), so Claude Code never updated them
// and someone had to do it by hand. This step makes that the last time: it runs the same CLI command a person would.
//
// How it runs:
//   - As a SessionStart step it reads two small local files and returns at once (well under 200 ms). Nothing happens
//     unless the worklog hook is installed (~/.claude/mm-hooks exists), MM_PLUGIN_SELF_UPDATE is not 0, the last check
//     started 6 hours ago or more, and no other check is running (plugin-update.lock). Then it claims the check in
//     plugin-sync.json, starts itself again detached (--child) and exits. The session never waits for it.
//   - The child takes plugin-update.lock (stale after 20 minutes), reads each plugin's latest version from the
//     repository on GitHub and the user-scope install Claude Code recorded in plugins/installed_plugins.json. A plugin
//     installed at user scope, not turned off, whose latest version is strictly higher, is due. For the due ones it
//     runs, from the home folder and each with a 300-second deadline: claude plugin marketplace update massmarket,
//     then claude plugin update <id> --scope user. It stops at the first command that fails. The child touches its
//     lock before each command, so a run of four commands never looks stale to the next session.
//   - Install once (Rob, 2026-11-24, his answer "Auto-install once"): where massmarket-theme has never been on this
//     computer, the same child runs claude plugin install massmarket-theme@massmarket --scope user, last, after the
//     marketplace update and any plugin update, under the same lock and deadline. "Never been on this computer" means:
//     no record of it under `self_update.install_once` in plugin-sync.json, no row for it in installed_plugins.json at
//     any scope, no folder for it in Claude Code's plugin cache, and no enabledPlugins entry for it, true or false.
//     Whatever it finds is recorded there for good, so it never installs again: not after the person removes it, and
//     never once they turned it off. A failed install is tried again at a later check, at most 3 times in all. The
//     first session with no record for it checks at once instead of waiting out the 6 hours; after that the record
//     is there and the 6 hours hold. A plugin-sync.json that does not parse installs nothing (its history is unknown).
//   - Where Claude Code's own auto-update is fully on (autoUpdate on the massmarket marketplace in the user settings
//     AND FORCE_AUTOUPDATE_PLUGINS on), the update is left to Claude Code: this step acts only once the same new
//     version has been waiting 2 hours, so the two never race.
//   - Which CLI: the one on PATH, then ~/.local/bin/claude (the native installer's, often not on a hook's PATH), then
//     the one the Claude desktop app ships, highest version (the installer's findClaudeCli, OW
//     src/lib/ext/hook-setup-source.ts). In a sandboxed home (MM_HOOK_HOME, the test seam) only MM_CLAUDE_BIN counts:
//     a real CLI would write to the REAL home.
//   - CLAUDE_CONFIG_DIR, when set, is where installed_plugins.json and settings.json are read: it is where the CLI,
//     which inherits it, makes its change.
//
// What it never does:
//   - install a plugin that is not installed: it only ever runs `plugin update`, for a plugin with a user-scope install.
//     The single exception is massmarket-theme, installed once per computer as above (Rob's go, 2026-11-24: "Auto-install
//     once"). No other plugin is ever installed, and the theme never twice.
//   - turn on a plugin the person turned off (enabledPlugins[<id>] === false in the user settings): it is left as it is,
//     and a turned-off massmarket-theme is never installed.
//   - downgrade, or act on a version that is not plain dot-separated numbers.
//   - write any settings.json, or run the CLI while the user settings.json does not parse (the CLI writes that file).
//   - touch the token or consent.json.
//   - pass -y, --yes or --accept-command. A marketplace-declared install command is never accepted on anyone's behalf:
//     without a terminal the CLI refuses it, and that failure is recorded.
//   - print anything, or fail or slow the session. Every error is swallowed. What it did goes to `self_update` in
//     ~/.claude/mm-hooks/plugin-sync.json (beside sync-hook.js's and sync-extension.js's records) and one line per check
//     to ~/.claude/mm-hooks/plugin-update.log (the last 200 kept), with no token or secret value in either.
"use strict";
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { updateStatus } = require("./plugin-status");

const MARKETPLACE = "massmarket";
const THEME_ID = "massmarket-theme@massmarket";
const PLUGIN_IDS = ["mm-hooks@massmarket", "mm-bridge@massmarket", THEME_ID];
// The only plugins this step may install, each once per computer (Rob, 2026-11-24: "Auto-install once").
const INSTALL_ONCE_IDS = [THEME_ID];
const INSTALL_MAX_ATTEMPTS = 3;
// install_once states that end it for good: installed by this step, found (it is or was on this computer), turned off
// by the person, or given up after INSTALL_MAX_ATTEMPTS failures. "pending", "waiting" and "failed" may still install.
const INSTALL_FINAL = ["installed", "found", "turned-off", "gave-up"];
const LATEST_BASE = "https://raw.githubusercontent.com/Massmarket-AI/claude-plugins/main/plugins";
const HOUR = 60 * 60 * 1000;
const CHECK_EVERY_MS = 6 * HOUR;
const AUTO_UPDATE_GRACE_MS = 2 * HOUR;
const LOCK_STALE_MS = 20 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const FETCH_MAX_BYTES = 64 * 1024;
const CLI_TIMEOUT_MS = 300000;
const LOG_KEEP_LINES = 200;
const ERROR_MAX = 300;
// A version this step compares: one to four dot-separated integers. Anything else ("1.0.11-beta", a sha) is skipped.
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/;
// How Claude Code reads FORCE_AUTOUPDATE_PLUGINS as on.
const ON_RE = /^(1|true|yes|on)$/i;
const OFF_RE = /^(0|false|no|off)$/i;

/** Every path this step reads or writes, under MM_HOOK_HOME when it is set. */
function paths(env = process.env) {
  const home = env.MM_HOOK_HOME || os.homedir();
  const claudeDir = env.MM_HOOK_HOME ? path.join(env.MM_HOOK_HOME, ".claude") : env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const hookDir = path.join(home, ".claude", "mm-hooks");
  return {
    home,
    hookDir,
    statusFile: path.join(hookDir, "plugin-sync.json"),
    lockFile: path.join(hookDir, "plugin-update.lock"),
    logFile: path.join(hookDir, "plugin-update.log"),
    installedFile: path.join(claudeDir, "plugins", "installed_plugins.json"),
    settingsFile: path.join(claudeDir, "settings.json"),
    cacheDir: path.join(claudeDir, "plugins", "cache", MARKETPLACE),
  };
}

/** { ok, value }: a missing file is ok with value null; unreadable, unparseable or not an object is not ok. */
function readJsonFile(file, maxBytes = 4 << 20) {
  let raw;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return { ok: false, value: null };
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { ok: !!err && err.code === "ENOENT", value: null };
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (!raw.trim()) return { ok: true, value: null };
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: false, value: null };
  } catch (_) {
    return { ok: false, value: null };
  }
}

function parseVersion(v) {
  return typeof v === "string" && VERSION_RE.test(v) ? v.split(".").map(Number) : null;
}

/** 1 / 0 / -1 for a > b / a == b / a < b, numerically, part by part. Both must pass parseVersion. */
function cmpVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** Claude Code's own plugin auto-update is fully on: the marketplace's autoUpdate AND FORCE_AUTOUPDATE_PLUGINS. */
function autoUpdateOn(settings, env) {
  const m = settings && settings.extraKnownMarketplaces && settings.extraKnownMarketplaces[MARKETPLACE];
  return !!(m && typeof m === "object" && m.autoUpdate === true) && ON_RE.test(String(env.FORCE_AUTOUPDATE_PLUGINS || "").trim());
}

function turnedOff(settings, id) {
  const e = settings && settings.enabledPlugins;
  return !!(e && typeof e === "object" && e[id] === false);
}

/**
 * { ok, versions, any }: versions[<id>] is the version of the plugin's scope "user" entry, for our ids that have one;
 * any[<id>] is true when the plugin has an entry at any scope (user, project or local).
 */
function readInstalled(file) {
  const r = readJsonFile(file);
  const versions = {};
  const any = {};
  if (!r.ok) return { ok: false, versions, any };
  const plugins = r.value && r.value.plugins;
  if (plugins === undefined || plugins === null) return { ok: true, versions, any };
  if (typeof plugins !== "object" || Array.isArray(plugins)) return { ok: false, versions, any };
  for (const id of PLUGIN_IDS) {
    const rows = (Array.isArray(plugins[id]) ? plugins[id] : []).filter((x) => x && typeof x === "object");
    if (rows.length) any[id] = true;
    const row = rows.filter((x) => x.scope === "user")[0];
    if (row) versions[id] = typeof row.version === "string" ? row.version : "";
  }
  return { ok: true, versions, any };
}

/** The install_once record of each plugin, from a self_update record; {} when there is none. */
function installOnceOf(su) {
  const o = su && typeof su === "object" ? su.install_once : null;
  return o && typeof o === "object" && !Array.isArray(o) ? o : {};
}

/** The install-once plugins this computer has no record of at all: the first session checks for them at once. */
function installOnceUnseen(su) {
  const once = installOnceOf(su);
  return INSTALL_ONCE_IDS.filter((id) => !once[id] || typeof once[id] !== "object");
}

/**
 * Whether an install-once plugin may be installed at this check. PURE.
 *   record      its install_once record from the last check, or undefined
 *   installedAny it has an entry in installed_plugins.json at any scope
 *   inCache     Claude Code's plugin cache has a folder for it (it was installed here once)
 *   statusOk    plugin-sync.json parsed (or is missing): its history is known
 * Returns { candidate: true } to install (once its latest version is read), or { record } to keep, or {} for nothing.
 */
function installOnceState({ id, record, installedAny, inCache, settings, statusOk }) {
  if (!statusOk) return {};
  if (record && typeof record === "object" && INSTALL_FINAL.indexOf(record.state) !== -1) return {};
  if (turnedOff(settings, id)) return { record: { state: "turned-off" } };
  const e = settings && settings.enabledPlugins;
  const inSettings = !!(e && typeof e === "object" && Object.prototype.hasOwnProperty.call(e, id));
  if (installedAny || inCache || inSettings) return { record: { state: "found", via: installedAny ? "installed_plugins.json" : inCache ? "plugin cache" : "settings.json" } };
  const attempts = record && Number.isInteger(record.attempts) && record.attempts > 0 ? record.attempts : 0;
  if (attempts >= INSTALL_MAX_ATTEMPTS) return { record: Object.assign({}, record, { state: "gave-up" }) };
  return { candidate: true };
}

function cacheHas(p, id) {
  try {
    return fs.statSync(path.join(p.cacheDir, id.split("@")[0])).isDirectory();
  } catch (_) {
    return false;
  }
}

/** The last check is far enough back (6 hours), or a waiting version's 2 hours are up (retry_at). */
function throttleAllows(su, now) {
  if (!su || typeof su !== "object") return true;
  const last = Date.parse(su.last_attempt_at || "");
  if (!Number.isFinite(last)) return true;
  const age = now - last;
  if (age < 0 || age >= CHECK_EVERY_MS) return true;
  const retry = Date.parse(su.retry_at || "");
  return Number.isFinite(retry) && now >= retry;
}

function lockIsLive(file, now) {
  try {
    return now - fs.statSync(file).mtimeMs < LOCK_STALE_MS;
  } catch (_) {
    return false;
  }
}

/** Take plugin-update.lock, replacing one older than 20 minutes. False when another check holds it. */
function takeLock(file) {
  const mine = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, mine, { flag: "wx" });
      return mine;
    } catch (err) {
      if (!err || err.code !== "EEXIST") return null;
    }
    if (lockIsLive(file, Date.now())) return null;
    try {
      fs.unlinkSync(file);
    } catch (_) {
      // someone else cleared it first
    }
  }
  return null;
}

/** Mark the lock as fresh, if it is still this run's: a run of several 5-minute commands never looks stale. */
function touchLock(file, mine) {
  try {
    if (fs.readFileSync(file, "utf8") === mine) {
      const t = new Date();
      fs.utimesSync(file, t, t);
    }
  } catch (_) {
    // gone; the run goes on
  }
}

function releaseLock(file, mine) {
  try {
    if (fs.readFileSync(file, "utf8") === mine) fs.unlinkSync(file);
  } catch (_) {
    // already gone
  }
}

/**
 * Which plugins are due, which wait for Claude Code's own updater, and what each one's record says. PURE.
 *   installed    { <id>: version } user-scope installs
 *   latest       { <id>: { version } | { error } } for the ids that were looked up
 *   behindSince  { "<id>@<version>": ISO } from the last check; the result keeps only what is behind now
 */
function decide({ ids = PLUGIN_IDS, installed, settings, latest, autoOn, behindSince = {}, now }) {
  const plugins = {};
  const act = [];
  const pending = [];
  const unreadable = [];
  const since = {};
  let retryAt = null;
  for (const id of ids) {
    const from = installed[id];
    if (from === undefined) {
      plugins[id] = { action: "not-installed" };
      continue;
    }
    if (turnedOff(settings, id)) {
      plugins[id] = { from, action: "turned-off" };
      continue;
    }
    if (!parseVersion(from)) {
      plugins[id] = { from, action: "skipped-malformed" };
      continue;
    }
    const l = latest[id];
    if (!l || l.error || l.version === undefined) {
      plugins[id] = { from, action: "latest-unreadable" };
      unreadable.push(id);
      continue;
    }
    if (!parseVersion(l.version)) {
      plugins[id] = { from, latest: String(l.version).slice(0, 40), action: "skipped-malformed" };
      continue;
    }
    const order = cmpVersion(l.version, from);
    if (order <= 0) {
      plugins[id] = { from, latest: l.version, action: order === 0 ? "current" : "skipped-newer" };
      continue;
    }
    const key = id + "@" + l.version;
    const first = Date.parse((behindSince && behindSince[key]) || "");
    const seen = Number.isFinite(first) && first <= now ? first : now;
    since[key] = new Date(seen).toISOString();
    if (autoOn && now - seen < AUTO_UPDATE_GRACE_MS) {
      plugins[id] = { from, latest: l.version, action: "pending" };
      pending.push(id);
      retryAt = retryAt === null ? seen + AUTO_UPDATE_GRACE_MS : Math.min(retryAt, seen + AUTO_UPDATE_GRACE_MS);
      continue;
    }
    plugins[id] = { from, latest: l.version, action: "due" };
    act.push(id);
  }
  return { plugins, act, pending, unreadable, behindSince: since, retryAt };
}

/** GET a small JSON document over http(s). Resolves { value } or { error }, never rejects, gives up after timeoutMs. */
function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let req = null;
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (req) req.destroy();
      } catch (_) {
        // closed already
      }
      resolve(out);
    };
    const timer = setTimeout(() => finish({ error: "timed out after " + Math.round(timeoutMs / 1000) + " s" }), timeoutMs);
    try {
      const mod = /^https:/i.test(url) ? require("https") : /^http:/i.test(url) ? require("http") : null;
      if (!mod) return finish({ error: "not an http(s) URL" });
      req = mod.get(url, { headers: { "user-agent": "mm-hooks-update-plugins", accept: "application/json" } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return finish({ error: "HTTP " + res.statusCode });
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > FETCH_MAX_BYTES) finish({ error: "response too large" });
          else chunks.push(c);
        });
        res.on("end", () => {
          try {
            finish({ value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch (_) {
            finish({ error: "not JSON" });
          }
        });
        res.on("error", (err) => finish({ error: String((err && (err.code || err.message)) || err) }));
      });
      req.on("error", (err) => finish({ error: String((err && (err.code || err.message)) || err) }));
    } catch (err) {
      finish({ error: String((err && (err.code || err.message)) || err) });
    }
  });
}

/** { <id>: { version } | { error } } for each id, read from <base>/<name>/.claude-plugin/plugin.json in parallel. */
async function fetchLatest(ids, base) {
  const root = String(base || LATEST_BASE).replace(/\/+$/, "");
  const out = {};
  await Promise.all(
    ids.map(async (id) => {
      const name = id.split("@")[0];
      const r = await fetchJson(root + "/" + name + "/.claude-plugin/plugin.json");
      if (r.error) out[id] = { error: r.error };
      else if (!r.value || typeof r.value !== "object" || (r.value.name !== undefined && r.value.name !== name)) out[id] = { error: "not " + name + "'s plugin.json" };
      else out[id] = { version: r.value.version };
    })
  );
  return out;
}

/** The folders the Claude desktop app keeps its own Claude Code CLI under, one per <version>. */
function desktopCliRoots(env, platform, home, P) {
  if (platform === "darwin") return [P.join(home, "Library", "Application Support", "Claude", "claude-code")];
  if (platform === "win32") {
    return [
      P.join(env.APPDATA || P.join(home, "AppData", "Roaming"), "Claude", "claude-code"),
      P.join(env.LOCALAPPDATA || P.join(home, "AppData", "Local"), "Claude", "claude-code"),
    ];
  }
  return [P.join(home, ".config", "Claude", "claude-code")];
}

/** Where the binary may sit inside one <version>/<hash> folder of the desktop app. */
function desktopCliCandidates(dir, platform, P, io) {
  if (platform === "darwin") return [P.join(dir, "claude.app", "Contents", "MacOS", "claude")];
  if (platform === "win32") return [P.join(dir, "claude.exe")].concat(io.listDir(dir).map((sub) => P.join(dir, sub, "claude.exe")));
  return [P.join(dir, "claude")];
}

/**
 * Where the Claude Code CLI is, or null. PURE, so a test can run the Windows layout on a Mac.
 *   io  { onPath(): string[] (what where / command -v printed), listDir(dir): string[], isFile(p): boolean }
 * Returns { path, source }: source is "MM_CLAUDE_BIN", "PATH", "~/.local/bin" or "desktop app".
 */
function findClaudeCli(env, platform, home, io) {
  const P = platform === "win32" ? path.win32 : path.posix;
  if (env.MM_CLAUDE_BIN) return { path: env.MM_CLAUDE_BIN, source: "MM_CLAUDE_BIN" };
  if (env.MM_HOOK_HOME) return null;

  const hits = (io.onPath() || []).map((h) => String(h).trim()).filter(Boolean);
  if (platform === "win32") {
    // where also lists npm's extensionless sh shim and claude.ps1; neither runs here. claude.exe first, then the
    // .cmd / .bat shims, and only a hit that is a file on disk (where prints in the console's OEM code page, which
    // can mangle a non-ASCII profile path).
    const real = hits.filter((h) => io.isFile(h));
    const withExt = (ext) => real.filter((h) => P.extname(h).toLowerCase() === ext)[0];
    const best = withExt(".exe") || withExt(".cmd") || withExt(".bat");
    if (best) return { path: best, source: "PATH" };
  } else {
    const abs = hits.filter((h) => h.charAt(0) === "/" && io.isFile(h))[0];
    if (abs) return { path: abs, source: "PATH" };
  }

  const local = P.join(home, ".local", "bin", platform === "win32" ? "claude.exe" : "claude");
  if (io.isFile(local)) return { path: local, source: "~/.local/bin" };

  let best = null;
  for (const root of desktopCliRoots(env, platform, home, P)) {
    for (const version of io.listDir(root)) {
      const parts = parseVersion(version);
      if (!parts || (best && cmpVersion(version, best.version) <= 0)) continue;
      const versionDir = P.join(root, version);
      for (const hash of io.listDir(versionDir)) {
        const found = desktopCliCandidates(P.join(versionDir, hash), platform, P, io).filter((c) => io.isFile(c))[0];
        if (found) {
          best = { path: found, version };
          break;
        }
      }
    }
  }
  return best ? { path: best.path, source: "desktop app" } : null;
}

/** What where (Windows) or command -v (elsewhere) prints for claude, one entry per line. */
function claudeOnPath(platform, env) {
  let r;
  try {
    r =
      platform === "win32"
        ? childProcess.spawnSync("where", ["claude"], { encoding: "utf8", timeout: 15000, windowsHide: true, env })
        : childProcess.spawnSync("sh", ["-c", "command -v claude"], { encoding: "utf8", timeout: 15000, env });
  } catch (_) {
    return [];
  }
  if (!r || r.error || r.status !== 0) return [];
  return String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function discoverClaudeCli(env) {
  const platform = process.platform;
  return findClaudeCli(env, platform, os.homedir(), {
    onPath: () => claudeOnPath(platform, env),
    listDir: (d) => {
      try {
        return fs.readdirSync(d).sort();
      } catch (_) {
        return [];
      }
    },
    isFile: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch (_) {
        return false;
      }
    },
  });
}

/** Running this CLI needs a shell only for a .cmd or .bat on Windows: Node refuses to run one without (EINVAL). */
function cliNeedsShell(bin, platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(String(bin == null ? "" : bin));
}

/**
 * Run the CLI once, from the home folder (the CLI reads, and may write, the project settings of the folder it runs
 * in), stdin empty so it can never wait on a prompt. Never throws. Through a shell only for a .cmd / .bat on Windows:
 * the arguments are this file's own constants, checked to hold nothing cmd.exe reads, and only the path is quoted.
 */
function runClaudeCli(bin, args, { cwd, env, timeoutMs }) {
  const opts = { cwd, env, encoding: "utf8", input: "", timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
  let r;
  try {
    if (cliNeedsShell(bin, process.platform)) {
      for (const a of args) if (!/^[A-Za-z0-9@./_-]+$/.test(a)) throw new Error("unexpected argument");
      r = childProcess.spawnSync('"' + bin + '" ' + args.join(" "), Object.assign({ shell: true }, opts));
    } else {
      r = childProcess.spawnSync(bin, args, opts);
    }
  } catch (err) {
    return { ok: false, status: null, timedOut: false, stdout: "", stderr: "", error: err };
  }
  const err = r.error || null;
  return { ok: !err && r.status === 0, status: r.status, timedOut: !!err && err.code === "ETIMEDOUT", stdout: String(r.stdout || ""), stderr: String(r.stderr || ""), error: err };
}

function firstLine(text) {
  return (
    String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0] || ""
  );
}

/** Why one CLI command failed, in a few words. */
function cliFailureWords(args, r, timeoutMs) {
  const command = "claude " + args.join(" ");
  if (r.timedOut) return command + " timed out after " + Math.round(timeoutMs / 1000) + " seconds";
  if (r.error) return command + " could not run (" + (r.error.code || r.error.message || String(r.error)) + ")";
  const detail = firstLine(r.stderr) || firstLine(r.stdout);
  return command + " exited " + String(r.status) + (detail ? ": " + detail : "");
}

/**
 * A short, safe error for the record and the log: values of secret-looking environment variables, URL credentials and
 * token-shaped strings become [redacted], the home folder becomes ~, one line, at most 300 characters.
 */
function scrub(text, env = process.env) {
  let s = String(text == null ? "" : text);
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === "string" && v.length >= 8 && /TOKEN|KEY|SECRET|PASS|AUTH|COOKIE|CREDENTIAL|SESSION/i.test(k)) s = s.split(v).join("[redacted]");
  }
  s = s.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@");
  s = s.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g, "[redacted]");
  s = s.replace(/[A-Za-z0-9_-]{32,}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? "[redacted]" : m));
  for (const home of [env && env.MM_HOOK_HOME, os.homedir()]) if (home && home.length > 1) s = s.split(home).join("~");
  return s.replace(/\s+/g, " ").trim().slice(0, ERROR_MAX);
}

/** One line for plugin-update.log. */
function logLine(rec) {
  const parts = [rec.finished_at || rec.last_attempt_at, rec.result];
  for (const [id, p] of Object.entries(rec.plugins || {})) {
    const target = p.to || (p.latest && p.latest !== p.from ? p.latest : "");
    const versions = target ? (p.from ? p.from + "->" + target : target) : p.from || "";
    parts.push(id.split("@")[0] + ":" + p.action + (versions ? ":" + versions : ""));
  }
  if (rec.cli) parts.push("cli=" + rec.cli);
  if (rec.error) parts.push("error=" + JSON.stringify(rec.error));
  return parts.join(" ");
}

function appendLog(file, line) {
  try {
    let lines = [];
    try {
      if (fs.statSync(file).size <= 1 << 20) lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    } catch (_) {
      // first line
    }
    lines.push(line.replace(/[\r\n]+/g, " "));
    const tmp = file + ".new-" + process.pid;
    fs.writeFileSync(tmp, lines.slice(-LOG_KEEP_LINES).join("\n") + "\n");
    fs.renameSync(tmp, file);
  } catch (_) {
    // the log is a convenience
  }
}

/**
 * One check, as data: the record for `self_update`. Runs the CLI only for what is due, and for an install-once plugin
 * this computer has never had. onStep runs before each CLI command (the child keeps its lock fresh with it).
 */
async function check(env, p, now, onStep = () => {}) {
  const statusRead = readJsonFile(p.statusFile, 1 << 20);
  const previous = statusRead.value || {};
  const prev = previous.self_update && typeof previous.self_update === "object" ? previous.self_update : {};
  const rec = { last_attempt_at: new Date(now).toISOString() };
  const nowIso = rec.last_attempt_at;

  const settingsRead = readJsonFile(p.settingsFile);
  const settings = settingsRead.value || {};
  const installed = readInstalled(p.installedFile);
  if (!installed.ok) return Object.assign(rec, { result: "failed", error: "installed_plugins.json could not be read" });
  rec.auto_update = autoUpdateOn(settings, env);

  // Install once: what this computer's history says about each install-once plugin, kept in rec.install_once.
  const once = Object.assign({}, installOnceOf(prev));
  let toInstall = [];
  for (const id of INSTALL_ONCE_IDS) {
    const s = installOnceState({ id, record: once[id], installedAny: !!installed.any[id], inCache: cacheHas(p, id), settings, statusOk: statusRead.ok });
    if (s.record) once[id] = Object.assign({}, s.record, { at: nowIso });
    if (s.candidate) {
      // Always on record from here on, so later sessions keep to the 6-hour throttle.
      if (!once[id] || typeof once[id] !== "object") once[id] = { state: "pending", at: nowIso };
      toInstall.push(id);
    }
  }

  const lookup = PLUGIN_IDS.filter((id) => (installed.versions[id] !== undefined && !turnedOff(settings, id) && parseVersion(installed.versions[id])) || toInstall.indexOf(id) !== -1);
  const latest = lookup.length ? await fetchLatest(lookup, env.MM_PLUGIN_LATEST_BASE) : {};
  const d = decide({ installed: installed.versions, settings, latest, autoOn: rec.auto_update, behindSince: prev.behind_since, now });
  rec.plugins = d.plugins;
  if (Object.keys(d.behindSince).length) rec.behind_since = d.behindSince;
  if (d.retryAt !== null) rec.retry_at = new Date(d.retryAt).toISOString();
  const unreadableWords = () => scrub("could not read the latest version of " + d.unreadable.map((id) => id.split("@")[0] + " (" + latest[id].error + ")").join(", "), env);

  // An install-once plugin is installed only once its latest version is read from GitHub: it is published, and the
  // network is up. Until then it waits for a later check (the record makes that the 6-hour throttle, not every session).
  toInstall = toInstall.filter((id) => {
    const l = latest[id];
    if (l && !l.error && parseVersion(l.version)) {
      rec.plugins[id] = { latest: l.version, action: "install-due" };
      return true;
    }
    rec.plugins[id] = { action: "install-waiting" };
    once[id] = Object.assign({}, once[id], { state: "waiting", at: nowIso });
    return false;
  });
  if (Object.keys(once).length) rec.install_once = once;

  if (!d.act.length && !toInstall.length) {
    if (d.pending.length) rec.result = "skipped-auto-update-pending";
    else if (d.unreadable.length) Object.assign(rec, { result: "failed", error: unreadableWords() });
    else rec.result = "current";
    return rec;
  }
  if (!settingsRead.ok) return Object.assign(rec, { result: "failed", error: "settings.json does not parse, so the CLI was not run (it writes that file)" });
  const cli = discoverClaudeCli(env);
  if (!cli) return Object.assign(rec, { result: "no-cli" });
  rec.cli = cli.source;

  const timeoutMs = Number(env.MM_HOOK_PLUGIN_TIMEOUT_MS) > 0 ? Number(env.MM_HOOK_PLUGIN_TIMEOUT_MS) : CLI_TIMEOUT_MS;
  // The installs go last: an update that fails stops them too, and they are tried again at the next check.
  const steps = [{ args: ["plugin", "marketplace", "update", MARKETPLACE] }]
    .concat(d.act.map((id) => ({ id, args: ["plugin", "update", id, "--scope", "user"] })))
    .concat(toInstall.map((id) => ({ id, install: true, args: ["plugin", "install", id, "--scope", "user"] })));
  const errors = [];
  const ran = [];
  for (let i = 0; i < steps.length; i++) {
    onStep();
    const r = runClaudeCli(cli.path, steps[i].args, { cwd: p.home, env, timeoutMs });
    if (steps[i].install) {
      const attempts = (Number.isInteger(once[steps[i].id] && once[steps[i].id].attempts) ? once[steps[i].id].attempts : 0) + 1;
      once[steps[i].id] = { state: "failed", at: nowIso, attempts };
    }
    if (r.ok) {
      if (steps[i].id) ran.push(steps[i]);
      continue;
    }
    const words = scrub(cliFailureWords(steps[i].args, r, timeoutMs), env);
    errors.push(words);
    if (steps[i].id) rec.plugins[steps[i].id].action = steps[i].install ? "install-failed" : "failed";
    if (steps[i].install) once[steps[i].id].error = words;
    for (const later of steps.slice(i + 1)) rec.plugins[later.id].action = "skipped-after-failure";
    break;
  }

  // What Claude Code recorded after the command is the truth, not the exit code.
  const afterRead = readInstalled(p.installedFile);
  const after = afterRead.versions;
  const behind = [];
  let updated = 0;
  let installedNow = 0;
  for (const step of ran) {
    const id = step.id;
    const v = after[id];
    if (step.install) {
      if (parseVersion(v)) {
        Object.assign(rec.plugins[id], { to: v, action: "installed" });
        once[id] = { state: "installed", at: nowIso, attempts: once[id].attempts, version: v };
        installedNow++;
      } else {
        rec.plugins[id].action = "install-failed";
        once[id].error = "claude plugin install finished but " + id.split("@")[0] + " is not installed at user scope";
        behind.push(id.split("@")[0] + " is not installed");
      }
      continue;
    }
    if (parseVersion(v) && cmpVersion(v, d.plugins[id].latest) >= 0) {
      Object.assign(rec.plugins[id], { to: v, action: "updated" });
      if (rec.behind_since) delete rec.behind_since[id + "@" + d.plugins[id].latest];
      updated++;
    } else {
      Object.assign(rec.plugins[id], { action: "still-behind" });
      behind.push(id.split("@")[0] + " is still " + (v || "not installed"));
    }
  }
  for (const id of toInstall) {
    if (once[id] && once[id].state === "failed" && once[id].attempts >= INSTALL_MAX_ATTEMPTS) once[id].state = "gave-up";
  }
  if (Object.keys(once).length) rec.install_once = once;
  if (rec.behind_since && !Object.keys(rec.behind_since).length) delete rec.behind_since;
  if (behind.length) errors.push(scrub((ran.some((s) => !s.install) ? "claude plugin update" : "claude plugin install") + " finished but " + behind.join(", "), env));
  if (errors.length) Object.assign(rec, { result: "failed", error: scrub(errors.join("; "), env) });
  else rec.result = updated ? "updated" : installedNow ? "installed" : "updated";
  return rec;
}

/** The detached run: lock, check, record, log. */
async function runChild(env = process.env) {
  const p = paths(env);
  if (!fs.existsSync(p.hookDir)) return null;
  const mine = takeLock(p.lockFile);
  if (!mine) return null;
  let rec;
  try {
    const now = Date.now();
    try {
      rec = await check(env, p, now, () => touchLock(p.lockFile, mine));
    } catch (err) {
      rec = { last_attempt_at: new Date(now).toISOString(), result: "failed", error: scrub((err && err.message) || err, env) };
    }
    rec.finished_at = new Date().toISOString();
    updateStatus(p.hookDir, (current) => {
      // A check that failed before it got to the install-once records keeps the ones on file: losing them would let a
      // removed theme be installed again.
      const kept = installOnceOf(current.self_update);
      const self = !rec.install_once && Object.keys(kept).length ? Object.assign({}, rec, { install_once: kept }) : rec;
      return Object.assign({}, current, { self_update: self });
    });
    appendLog(p.logFile, logLine(rec));
  } finally {
    releaseLock(p.lockFile, mine);
  }
  return rec;
}

/** The SessionStart step: local reads only, then claim the check and start the detached run. True when it started one. */
function fastPath(env = process.env, now = Date.now()) {
  if (OFF_RE.test(String(env.MM_PLUGIN_SELF_UPDATE || "").trim())) return false;
  const p = paths(env);
  if (!fs.existsSync(p.hookDir)) return false;
  if (lockIsLive(p.lockFile, now)) return false;
  const statusRead = readJsonFile(p.statusFile, 1 << 20);
  const status = statusRead.value || {};
  // A plugin-sync.json that does not parse never counts as "no record": its history is unknown.
  const firstInstallCheck = (su) => statusRead.ok && installOnceUnseen(su).length > 0;
  if (!throttleAllows(status.self_update, now) && !firstInstallCheck(status.self_update)) return false;
  // Claimed under plugin-sync.json's lock, so two sessions starting together start one check. An install-once plugin
  // with no record gets one ("pending") in the claim, so only this session checks before the 6 hours are up.
  let claimed = false;
  updateStatus(p.hookDir, (current) => {
    const su = current.self_update && typeof current.self_update === "object" ? current.self_update : {};
    const unseen = statusRead.ok ? installOnceUnseen(su) : [];
    if (!throttleAllows(su, now) && !unseen.length) return current;
    claimed = true;
    const next = Object.assign({}, su, { last_attempt_at: new Date(now).toISOString() });
    delete next.retry_at;
    if (unseen.length) {
      next.install_once = Object.assign({}, installOnceOf(su));
      for (const id of unseen) next.install_once[id] = { state: "pending", at: new Date(now).toISOString() };
    }
    return Object.assign({}, current, { self_update: next });
  });
  if (!claimed) return false;
  // cwd = home, so the run never holds the plugin's own folder open while `plugin update` replaces it.
  const child = childProcess.spawn(process.execPath, [__filename, "--child"], { cwd: p.home, env, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return true;
}

if (require.main === module) {
  if (process.argv.indexOf("--child") !== -1) {
    runChild()
      .catch(() => {})
      .then(() => process.exit(0));
  } else {
    try {
      fastPath();
    } catch (_) {
      // fail open and silent
    }
    process.exit(0);
  }
}

module.exports = { INSTALL_ONCE_IDS, PLUGIN_IDS, autoUpdateOn, cliNeedsShell, cmpVersion, decide, findClaudeCli, installOnceState, installOnceUnseen, logLine, parseVersion, paths, scrub, throttleAllows };
