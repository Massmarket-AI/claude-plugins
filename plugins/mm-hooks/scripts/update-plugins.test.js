// mm-hooks: tests for update-plugins.js (and sync-hook.js keeping its record).
//
//   node --test plugins/mm-hooks/scripts/update-plugins.test.js
//
// Every home here is a temporary directory (MM_HOOK_HOME), the "latest version" comes from a local http server
// (MM_PLUGIN_LATEST_BASE) and the Claude Code CLI is a fake (MM_CLAUDE_BIN) that records each argv to a file. Nothing
// reads or writes this computer's own ~/.claude, and nothing reaches GitHub.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const up = require("./update-plugins.js");

const SCRIPTS = __dirname;
const SCRIPT = path.join(SCRIPTS, "update-plugins.js");
const HOUR = 60 * 60 * 1000;
const HOOKS = "mm-hooks@massmarket";
const BRIDGE = "mm-bridge@massmarket";

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A temporary home. installed: { <id>: version } written as user-scope rows of installed_plugins.json (null = no
 * file); settings: the user settings.json (a string is written as is); tracker: whether ~/.claude/mm-hooks exists.
 */
function makeHome({ installed = { [HOOKS]: "1.0.10", [BRIDGE]: "0.6.0" }, settings = {}, tracker = true, status = null } = {}) {
  const home = tmp("mm-up-home-");
  const claude = path.join(home, ".claude");
  fs.mkdirSync(path.join(claude, "plugins"), { recursive: true });
  if (tracker) fs.mkdirSync(path.join(claude, "mm-hooks"));
  if (installed) {
    const plugins = {};
    for (const [id, version] of Object.entries(installed)) {
      plugins[id] = [{ scope: "user", installPath: path.join(claude, "plugins", "cache", "massmarket", id.split("@")[0], version), version, installedAt: "2026-10-09T19:11:08.440Z", lastUpdated: "2026-10-25T19:31:38.672Z", gitCommitSha: "69afb78fefdecf948aed7b1e752bb0e041734ffc" }];
    }
    fs.writeFileSync(path.join(claude, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins }, null, 2));
  }
  if (settings !== null) fs.writeFileSync(path.join(claude, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings, null, 2));
  if (status) fs.writeFileSync(path.join(claude, "mm-hooks", "plugin-sync.json"), JSON.stringify(status, null, 1));
  return home;
}

const hookDir = (home) => path.join(home, ".claude", "mm-hooks");
const statusOf = (home) => JSON.parse(fs.readFileSync(path.join(hookDir(home), "plugin-sync.json"), "utf8"));
const installedOf = (home) => JSON.parse(fs.readFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"));
const logLines = (home) => {
  try {
    return fs.readFileSync(path.join(hookDir(home), "plugin-update.log"), "utf8").split("\n").filter(Boolean);
  } catch (_) {
    return [];
  }
};
const settingsBytes = (home) => {
  try {
    return fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
  } catch (_) {
    return null;
  }
};

/** A local stand-in for raw.githubusercontent.com. versions: { <name>: "1.0.11" | { status, body } }. */
function latestServer(versions) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const m = /^\/plugins\/([^/]+)\/\.claude-plugin\/plugin\.json$/.exec(req.url);
    const v = m ? versions[m[1]] : undefined;
    if (v === undefined) {
      res.writeHead(404);
      return res.end("404: Not Found");
    }
    if (typeof v === "object") {
      res.writeHead(v.status || 200);
      return res.end(v.body || "");
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(JSON.stringify({ name: m[1], version: v, description: "x", author: { name: "Massmarket AI" } }, null, 2));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ base: `http://127.0.0.1:${server.address().port}/plugins`, hits, close: () => new Promise((r) => server.close(r)) }))
  );
}

/**
 * A fake `claude` that appends { args, cwd } to argv.log. cfg: failOn (an argv prefix that exits 1 with failMessage),
 * sleepMs, and bump ({ <id>: version } that `plugin update <id>` writes into installed_plugins.json, as the real CLI does).
 */
function fakeCli(cfg = {}) {
  const dir = tmp("mm-up-cli-");
  const script = path.join(dir, "fake-claude.js");
  fs.writeFileSync(path.join(dir, "fake-claude.json"), JSON.stringify(cfg));
  fs.writeFileSync(
    script,
    `"use strict";
const fs = require("fs"), path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "fake-claude.json"), "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, "argv.log"), JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (cfg.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, cfg.sleepMs);
if (cfg.failOn && args.join(" ").startsWith(cfg.failOn)) { process.stderr.write(cfg.failMessage || "Error: failed\\n"); process.exit(1); }
if (args[0] === "plugin" && args[1] === "update" && cfg.bump && cfg.bump[args[2]]) {
  const file = path.join(process.env.MM_HOOK_HOME, ".claude", "plugins", "installed_plugins.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const row of doc.plugins[args[2]]) if (row.scope === "user") row.version = cfg.bump[args[2]];
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
}
process.stdout.write("done\\n");
`
  );
  let bin;
  if (process.platform === "win32") {
    bin = path.join(dir, "claude.cmd");
    fs.writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    bin = path.join(dir, "claude");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  }
  const calls = () => {
    try {
      return fs.readFileSync(path.join(dir, "argv.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch (_) {
      return [];
    }
  };
  return { bin, calls };
}

/** The environment a run gets: this process's, minus anything that would change the outcome, plus the seams. */
function envFor(home, extra = {}) {
  const env = Object.assign({}, process.env);
  for (const k of ["FORCE_AUTOUPDATE_PLUGINS", "MM_CLAUDE_BIN", "CLAUDE_CONFIG_DIR", "MM_PLUGIN_SELF_UPDATE", "MM_HOOK_PLUGIN_TIMEOUT_MS", "MM_PLUGIN_LATEST_BASE"]) delete env[k];
  return Object.assign(env, { MM_HOOK_HOME: home }, extra);
}

function run(args, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [SCRIPT].concat(args), { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run the detached step's body directly (--child) and check it is silent. */
async function runChild(env) {
  const r = await run(["--child"], env);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "", "nothing on stdout");
  assert.equal(r.stderr, "", "nothing on stderr");
  return r;
}

/** Run the SessionStart step (the fast path) and check it is silent. */
async function runHook(env) {
  const r = await run([], env);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "", "SessionStart stdout reaches the model: nothing on it");
  assert.equal(r.stderr, "");
  return r;
}

/** Wait for the detached check to finish: n lines in plugin-update.log and no lock. */
async function waitForLog(home, n, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (logLines(home).length >= n && !fs.existsSync(path.join(hookDir(home), "plugin-update.lock"))) return true;
    await sleep(25);
  }
  return false;
}

const noYes = (calls) => {
  for (const c of calls) for (const a of c.args) assert.ok(["-y", "--yes", "--accept-command"].indexOf(a) === -1, "never -y: " + c.args.join(" "));
};

// ───────────────────────────────────────────────────────────── the check (the detached child)

test("current: no CLI call, result current, nothing printed", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const before = settingsBytes(home);
    const cli = fakeCli();
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls(), [], "the CLI is not run");
    const su = statusOf(home).self_update;
    assert.equal(su.result, "current");
    assert.deepEqual(su.plugins[HOOKS], { from: "1.0.10", latest: "1.0.10", action: "current" });
    assert.deepEqual(su.plugins[BRIDGE], { from: "0.6.0", latest: "0.6.0", action: "current" });
    assert.equal(su.behind_since, undefined);
    assert.equal(srv.hits.length, 2);
    assert.equal(logLines(home).length, 1);
    assert.match(logLines(home)[0], / current mm-hooks:current:1\.0\.10 mm-bridge:current:0\.6\.0$/);
    assert.equal(settingsBytes(home), before, "settings.json untouched");
    assert.equal(fs.existsSync(path.join(hookDir(home), "plugin-update.lock")), false, "the lock is released");
  } finally {
    await srv.close();
  }
});

test("behind with auto-update off: marketplace update, then plugin update for the behind plugin only, --scope user, never -y", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.1" });
  try {
    const home = makeHome({ settings: { extraKnownMarketplaces: { massmarket: { source: { source: "github", repo: "Massmarket-AI/claude-plugins" } } } } });
    const before = settingsBytes(home);
    const cli = fakeCli({ bump: { [BRIDGE]: "0.6.1" } });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    const calls = cli.calls();
    assert.deepEqual(
      calls.map((c) => c.args),
      [
        ["plugin", "marketplace", "update", "massmarket"],
        ["plugin", "update", BRIDGE, "--scope", "user"],
      ]
    );
    noYes(calls);
    for (const c of calls) assert.equal(c.cwd, fs.realpathSync(home), "every CLI call runs from the home folder");
    const su = statusOf(home).self_update;
    assert.equal(su.result, "updated");
    assert.equal(su.auto_update, false);
    assert.equal(su.cli, "MM_CLAUDE_BIN");
    assert.deepEqual(su.plugins[BRIDGE], { from: "0.6.0", latest: "0.6.1", to: "0.6.1", action: "updated" });
    assert.equal(su.plugins[HOOKS].action, "current");
    assert.equal(su.behind_since, undefined, "nothing is behind any more");
    assert.match(logLines(home)[0], / updated mm-hooks:current:1\.0\.10 mm-bridge:updated:0\.6\.0->0\.6\.1 cli=MM_CLAUDE_BIN$/);
    assert.equal(settingsBytes(home), before, "settings.json untouched");
  } finally {
    await srv.close();
  }
});

test("auto-update fully on: waits until the same version has been behind 2 hours, then acts", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome({ settings: { extraKnownMarketplaces: { massmarket: { source: { source: "github", repo: "Massmarket-AI/claude-plugins" }, autoUpdate: true } } } });
    const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" } });
    const env = envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base, FORCE_AUTOUPDATE_PLUGINS: "1" });

    await runChild(env);
    assert.deepEqual(cli.calls(), [], "Claude Code's own updater gets its turn first");
    let su = statusOf(home).self_update;
    assert.equal(su.result, "skipped-auto-update-pending");
    assert.equal(su.auto_update, true);
    assert.equal(su.plugins[HOOKS].action, "pending");
    const since = Date.parse(su.behind_since[HOOKS + "@1.0.11"]);
    assert.ok(Math.abs(Date.now() - since) < 60000);
    assert.equal(Date.parse(su.retry_at), since + 2 * HOUR, "the next check may come as soon as the 2 hours are up");

    // An hour later: still waiting, and the first time it was seen is kept.
    const status = statusOf(home);
    status.self_update.behind_since[HOOKS + "@1.0.11"] = new Date(Date.now() - 1 * HOUR).toISOString();
    fs.writeFileSync(path.join(hookDir(home), "plugin-sync.json"), JSON.stringify(status));
    await runChild(env);
    assert.deepEqual(cli.calls(), []);
    assert.equal(statusOf(home).self_update.result, "skipped-auto-update-pending");
    assert.equal(statusOf(home).self_update.behind_since[HOOKS + "@1.0.11"], status.self_update.behind_since[HOOKS + "@1.0.11"]);

    // Two hours and a minute: it acts.
    const status2 = statusOf(home);
    status2.self_update.behind_since[HOOKS + "@1.0.11"] = new Date(Date.now() - 2 * HOUR - 60000).toISOString();
    fs.writeFileSync(path.join(hookDir(home), "plugin-sync.json"), JSON.stringify(status2));
    await runChild(env);
    assert.deepEqual(
      cli.calls().map((c) => c.args),
      [
        ["plugin", "marketplace", "update", "massmarket"],
        ["plugin", "update", HOOKS, "--scope", "user"],
      ]
    );
    su = statusOf(home).self_update;
    assert.equal(su.result, "updated");
    assert.deepEqual(su.plugins[HOOKS], { from: "1.0.10", latest: "1.0.11", to: "1.0.11", action: "updated" });
    assert.equal(su.retry_at, undefined);
  } finally {
    await srv.close();
  }
});

test("auto-update half on (autoUpdate without FORCE_AUTOUPDATE_PLUGINS, or the variable without autoUpdate): acts at once", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    for (const [settings, force] of [
      [{ extraKnownMarketplaces: { massmarket: { autoUpdate: true } } }, undefined],
      [{ extraKnownMarketplaces: { massmarket: { autoUpdate: true } } }, "0"],
      [{ extraKnownMarketplaces: { massmarket: {} } }, "1"],
    ]) {
      const home = makeHome({ settings });
      const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" } });
      await runChild(envFor(home, Object.assign({ MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }, force === undefined ? {} : { FORCE_AUTOUPDATE_PLUGINS: force })));
      assert.equal(cli.calls().length, 2, JSON.stringify(settings) + " FORCE=" + force);
      assert.equal(statusOf(home).self_update.result, "updated");
    }
  } finally {
    await srv.close();
  }
});

test("⛔ a plugin the person turned off is left alone, behind or not", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.1" });
  try {
    const home = makeHome({ settings: { enabledPlugins: { [BRIDGE]: false, [HOOKS]: true } } });
    const before = settingsBytes(home);
    const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" } });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    const calls = cli.calls();
    assert.equal(calls.some((c) => c.args.indexOf(BRIDGE) !== -1), false, "never named to the CLI");
    assert.deepEqual(calls.map((c) => c.args[1]), ["marketplace", "update"]);
    assert.deepEqual(statusOf(home).self_update.plugins[BRIDGE], { from: "0.6.0", action: "turned-off" });
    assert.equal(srv.hits.some((h) => h.includes("mm-bridge")), false, "not even looked up");
    assert.equal(settingsBytes(home), before, "still off: settings.json untouched");
  } finally {
    await srv.close();
  }
});

test("⛔ a plugin that is not installed (or only at project scope) is never installed", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.1" });
  try {
    const home = makeHome({ installed: { [HOOKS]: "1.0.10" } });
    // mm-bridge only at project scope: not this machine's install.
    const doc = installedOf(home);
    doc.plugins[BRIDGE] = [{ scope: "project", projectPath: "/somewhere", version: "0.5.0" }];
    fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify(doc));
    const cli = fakeCli();
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls(), [], "no install, no update");
    const su = statusOf(home).self_update;
    assert.equal(su.result, "current");
    assert.deepEqual(su.plugins[BRIDGE], { action: "not-installed" });

    // No installed_plugins.json at all: nothing to do.
    const bare = makeHome({ installed: null });
    await runChild(envFor(bare, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls(), []);
    assert.equal(statusOf(bare).self_update.result, "current");
  } finally {
    await srv.close();
  }
});

test("⛔ never a downgrade, and a version that is not plain numbers is skipped", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.7.0-beta" });
  try {
    const home = makeHome({ installed: { [HOOKS]: "1.0.12", [BRIDGE]: "0.6.0" } });
    const cli = fakeCli();
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls(), []);
    const su = statusOf(home).self_update;
    assert.deepEqual(su.plugins[HOOKS], { from: "1.0.12", latest: "1.0.11", action: "skipped-newer" });
    assert.equal(su.plugins[BRIDGE].action, "skipped-malformed");
    assert.equal(su.result, "current");
  } finally {
    await srv.close();
  }
});

test("versions compare as numbers: 1.0.10 is above 1.0.9", async () => {
  assert.equal(up.cmpVersion("1.0.10", "1.0.9"), 1);
  assert.equal(up.cmpVersion("1.0", "1.0.0"), 0);
  assert.equal(up.cmpVersion("0.9.99", "1.0.0"), -1);
  for (const bad of ["1.0.11-beta", "v1.0.11", "", "1..2", "69afb78", null, 1]) assert.equal(up.parseVersion(bad), null, String(bad));
});

test("a CLI failure is recorded and the commands after it are skipped", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.1" });
  try {
    // The marketplace refresh fails: no plugin update runs.
    const home = makeHome();
    const cli = fakeCli({ failOn: "plugin marketplace update", failMessage: "\nError: Failed to update marketplace 'massmarket': git pull failed\nmore detail\n" });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls().map((c) => c.args), [["plugin", "marketplace", "update", "massmarket"]]);
    let su = statusOf(home).self_update;
    assert.equal(su.result, "failed");
    assert.equal(su.error, "claude plugin marketplace update massmarket exited 1: Error: Failed to update marketplace 'massmarket': git pull failed");
    assert.equal(su.plugins[HOOKS].action, "skipped-after-failure");
    assert.equal(su.plugins[BRIDGE].action, "skipped-after-failure");
    assert.match(logLines(home)[0], / failed .*error="claude plugin marketplace update massmarket exited 1: /);

    // The first plugin update fails: the second is never run.
    const home2 = makeHome();
    const cli2 = fakeCli({ failOn: "plugin update " + HOOKS, failMessage: "This plugin declares an install command; pass -y to accept it\n" });
    await runChild(envFor(home2, { MM_CLAUDE_BIN: cli2.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli2.calls().map((c) => c.args.slice(0, 3)), [["plugin", "marketplace", "update"], ["plugin", "update", HOOKS]]);
    noYes(cli2.calls());
    su = statusOf(home2).self_update;
    assert.equal(su.result, "failed");
    assert.equal(su.plugins[HOOKS].action, "failed");
    assert.equal(su.plugins[BRIDGE].action, "skipped-after-failure");
  } finally {
    await srv.close();
  }
});

test("a CLI that exits 0 but leaves the plugin behind is a failure, not an update", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const cli = fakeCli(); // does not bump installed_plugins.json
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    const su = statusOf(home).self_update;
    assert.equal(su.result, "failed");
    assert.equal(su.error, "claude plugin update finished but mm-hooks is still 1.0.10");
    assert.equal(su.plugins[HOOKS].action, "still-behind");
    assert.ok(su.behind_since[HOOKS + "@1.0.11"], "still recorded as behind");
  } finally {
    await srv.close();
  }
});

test("a CLI command past its deadline is stopped and recorded", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const cli = fakeCli({ sleepMs: 3000 });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base, MM_HOOK_PLUGIN_TIMEOUT_MS: "1000" }));
    const su = statusOf(home).self_update;
    assert.equal(su.result, "failed");
    assert.equal(su.error, "claude plugin marketplace update massmarket timed out after 1 seconds");
    assert.equal(su.plugins[HOOKS].action, "skipped-after-failure");
    assert.equal(cli.calls().length, 1, "the plugin update never ran");
  } finally {
    await srv.close();
  }
});

test("no CLI: result no-cli, nothing run (in a sandboxed home only MM_CLAUDE_BIN counts)", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    await runChild(envFor(home, { MM_PLUGIN_LATEST_BASE: srv.base }));
    const su = statusOf(home).self_update;
    assert.equal(su.result, "no-cli");
    assert.equal(su.plugins[HOOKS].action, "due");
    assert.match(logLines(home)[0], / no-cli mm-hooks:due:1\.0\.10->1\.0\.11 /);
  } finally {
    await srv.close();
  }
});

test("⛔ a user settings.json that does not parse: the CLI is not run (it writes that file), and the file is left as it is", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome({ settings: '{ "enabledPlugins": { ' });
    const cli = fakeCli();
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls(), []);
    assert.equal(statusOf(home).self_update.result, "failed");
    assert.match(statusOf(home).self_update.error, /settings\.json does not parse/);
    assert.equal(settingsBytes(home), '{ "enabledPlugins": { ');
  } finally {
    await srv.close();
  }
});

test("latest version unreadable: that plugin is skipped; when nothing else is due the check is a failure", async () => {
  const srv = await latestServer({ "mm-hooks": { status: 500, body: "oops" }, "mm-bridge": "0.6.1" });
  try {
    const home = makeHome();
    const cli = fakeCli({ bump: { [BRIDGE]: "0.6.1" } });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    assert.deepEqual(cli.calls().map((c) => c.args.slice(0, 3)), [["plugin", "marketplace", "update"], ["plugin", "update", BRIDGE]]);
    assert.equal(statusOf(home).self_update.plugins[HOOKS].action, "latest-unreadable");
    assert.equal(statusOf(home).self_update.result, "updated");
  } finally {
    await srv.close();
  }
  const dead = await latestServer({});
  await dead.close();
  const home = makeHome();
  const cli = fakeCli();
  await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: dead.base }));
  assert.deepEqual(cli.calls(), []);
  const su = statusOf(home).self_update;
  assert.equal(su.result, "failed");
  assert.match(su.error, /^could not read the latest version of mm-hooks \(.+\), mm-bridge \(.+\)$/);
});

test("other plugin-sync.json keys are kept: sync-hook.js's top-level record and sync-extension.js's `extension`", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const seeded = { plugin: "mm-hooks", version: "1.0.10", at: "2026-10-26T10:00:00.000Z", action: "current", hook_sha256: "ab".repeat(32), extension: { at: "2026-10-26T10:00:00.000Z", action: "checked", notice_at: "2026-10-26T09:00:00.000Z" } };
    const home = makeHome({ status: seeded });
    const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" } });
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    const s = statusOf(home);
    assert.equal(s.self_update.result, "updated");
    delete s.self_update;
    assert.deepEqual(s, seeded);
  } finally {
    await srv.close();
  }
});

test("sync-hook.js carries `self_update` over (it rewrites its own top-level record each session)", async () => {
  const su = { last_attempt_at: new Date().toISOString(), result: "current", plugins: {} };
  const home = makeHome({ status: { plugin: "mm-hooks", version: "1.0.9", action: "current", extension: { action: "checked" }, self_update: su } });
  await new Promise((resolve) => spawn(process.execPath, [path.join(SCRIPTS, "sync-hook.js")], { env: envFor(home), stdio: "ignore" }).on("exit", resolve));
  const s = statusOf(home);
  assert.equal(s.action, "not-installed", "sync-hook.js wrote its record");
  assert.deepEqual(s.self_update, su);
  assert.deepEqual(s.extension, { action: "checked" });
});

test("the log keeps the last 200 lines", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const old = Array.from({ length: 205 }, (_, i) => "2026-10-01T00:00:00.000Z current line-" + i).join("\n") + "\n";
    fs.writeFileSync(path.join(hookDir(home), "plugin-update.log"), old);
    await runChild(envFor(home, { MM_CLAUDE_BIN: fakeCli().bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    const lines = logLines(home);
    assert.equal(lines.length, 200);
    assert.equal(lines[0], "2026-10-01T00:00:00.000Z current line-6");
    assert.match(lines[199], / current mm-hooks:current/);
  } finally {
    await srv.close();
  }
});

test("⛔ a held lock: the check does nothing; a lock older than 20 minutes is taken over", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const lock = path.join(hookDir(home), "plugin-update.lock");
    fs.writeFileSync(lock, JSON.stringify({ pid: 1, at: new Date().toISOString() }));
    const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" } });
    const env = envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base });
    await runHook(env);
    await runChild(env);
    await sleep(300);
    assert.deepEqual(cli.calls(), []);
    assert.equal(fs.existsSync(path.join(hookDir(home), "plugin-sync.json")), false, "nothing claimed, nothing recorded");
    assert.equal(srv.hits.length, 0);
    assert.equal(fs.readFileSync(lock, "utf8").includes('"pid":1'), true, "someone else's lock is left alone");

    const stale = (Date.now() - 21 * 60 * 1000) / 1000;
    fs.utimesSync(lock, stale, stale);
    await runChild(env);
    assert.equal(statusOf(home).self_update.result, "updated");
    assert.equal(fs.existsSync(lock), false);
  } finally {
    await srv.close();
  }
});

// ───────────────────────────────────────────────────────────── the SessionStart step (the fast path)

test("as a SessionStart hook: starts the check detached, prints nothing, exits 0; a second session within 6 hours does nothing", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    const home = makeHome();
    const before = settingsBytes(home);
    // Each CLI call takes 1.5 s, so the check takes 3 s or more; the hook must not wait for it.
    const cli = fakeCli({ bump: { [HOOKS]: "1.0.11" }, sleepMs: 1500 });
    const env = envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base });
    const t0 = Date.now();
    await runHook(env);
    assert.ok(Date.now() - t0 < 1500, "the hook returns without waiting for the check");
    assert.equal(logLines(home).length, 0, "the check is still running when the hook has returned");
    assert.ok(statusOf(home).self_update.last_attempt_at, "the check was claimed before it started");
    assert.ok(await waitForLog(home, 1), "the detached check ran");
    assert.equal(cli.calls().length, 2);
    assert.equal(statusOf(home).self_update.result, "updated");

    // mm-hooks put back behind the same release: within 6 hours nothing runs.
    const doc = installedOf(home);
    doc.plugins[HOOKS][0].version = "1.0.10";
    fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify(doc));
    const hitsBefore = srv.hits.length;
    await runHook(env);
    await sleep(500);
    assert.equal(cli.calls().length, 2);
    assert.equal(srv.hits.length, hitsBefore, "not even a version lookup");
    assert.equal(logLines(home).length, 1);
    assert.equal(settingsBytes(home), before);
  } finally {
    await srv.close();
  }
});

test("the throttle: a check 1 hour ago holds the next one back, 7 hours ago lets it run", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.0" });
  try {
    for (const [agoHours, runs] of [
      [1, false],
      [5.9, false],
      [7, true],
    ]) {
      const home = makeHome({ status: { plugin: "mm-hooks", self_update: { last_attempt_at: new Date(Date.now() - agoHours * HOUR).toISOString(), result: "current" } } });
      await runHook(envFor(home, { MM_CLAUDE_BIN: fakeCli().bin, MM_PLUGIN_LATEST_BASE: srv.base }));
      if (runs) assert.ok(await waitForLog(home, 1), agoHours + " h ago: runs");
      else {
        await sleep(300);
        assert.equal(logLines(home).length, 0, agoHours + " h ago: held back");
      }
    }
  } finally {
    await srv.close();
  }
  assert.equal(up.throttleAllows(undefined, Date.now()), true);
  assert.equal(up.throttleAllows({ last_attempt_at: "garbage" }, Date.now()), true);
  assert.equal(up.throttleAllows({ last_attempt_at: new Date(Date.now() + HOUR).toISOString() }, Date.now()), true, "a clock that went back never blocks forever");
  const now = Date.now();
  assert.equal(up.throttleAllows({ last_attempt_at: new Date(now - HOUR).toISOString(), retry_at: new Date(now - 1000).toISOString() }, now), true, "a waiting version's 2 hours are up");
  assert.equal(up.throttleAllows({ last_attempt_at: new Date(now - HOUR).toISOString(), retry_at: new Date(now + 1000).toISOString() }, now), false);
});

test("⛔ no tracker folder: the hook spawns nothing, writes nothing, prints nothing", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.1" });
  try {
    const home = makeHome({ tracker: false });
    const cli = fakeCli();
    await runHook(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    await runChild(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base }));
    await sleep(500);
    assert.deepEqual(cli.calls(), []);
    assert.equal(srv.hits.length, 0);
    assert.equal(fs.existsSync(hookDir(home)), false, "the folder is not created");
  } finally {
    await srv.close();
  }
});

test("MM_PLUGIN_SELF_UPDATE=0 turns the step off", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.11", "mm-bridge": "0.6.0" });
  try {
    for (const off of ["0", "false", "OFF"]) {
      const home = makeHome();
      const cli = fakeCli();
      await runHook(envFor(home, { MM_CLAUDE_BIN: cli.bin, MM_PLUGIN_LATEST_BASE: srv.base, MM_PLUGIN_SELF_UPDATE: off }));
      await sleep(300);
      assert.deepEqual(cli.calls(), [], off);
      assert.equal(fs.existsSync(path.join(hookDir(home), "plugin-sync.json")), false);
    }
  } finally {
    await srv.close();
  }
});

test("⛔ the three SessionStart steps run at the same time and no record is lost", async () => {
  const srv = await latestServer({ "mm-hooks": "1.0.10", "mm-bridge": "0.6.0" });
  try {
    for (let i = 0; i < 6; i++) {
      const home = makeHome();
      const env = envFor(home, { MM_CLAUDE_BIN: fakeCli().bin, MM_PLUGIN_LATEST_BASE: srv.base, LOCALAPPDATA: path.join(home, "AppData", "Local") });
      const runOne = (script) => new Promise((resolve) => spawn(process.execPath, [path.join(SCRIPTS, script)], { env, stdio: "ignore" }).on("exit", resolve));
      await Promise.all([runOne("sync-hook.js"), runOne("sync-extension.js"), runOne("update-plugins.js")]);
      assert.ok(await waitForLog(home, 1), `round ${i}: the check finished`);
      const s = statusOf(home);
      assert.equal(s.plugin, "mm-hooks", `round ${i}: the hook step's record`);
      assert.ok(s.extension && s.extension.action, `round ${i}: the extension step's record`);
      assert.equal(s.self_update && s.self_update.result, "current", `round ${i}: the self-update record`);
      assert.equal(fs.readdirSync(hookDir(home)).some((f) => f.includes(".lock") || f.includes(".new-")), false);
    }
  } finally {
    await srv.close();
  }
});

// ───────────────────────────────────────────────────────────── pure parts

test("auto-update is fully on only with autoUpdate on the marketplace AND FORCE_AUTOUPDATE_PLUGINS on", () => {
  const on = { extraKnownMarketplaces: { massmarket: { autoUpdate: true } } };
  for (const v of ["1", "true", "TRUE", "yes", "On", " 1 "]) assert.equal(up.autoUpdateOn(on, { FORCE_AUTOUPDATE_PLUGINS: v }), true, v);
  for (const v of [undefined, "", "0", "false", "off", "2"]) assert.equal(up.autoUpdateOn(on, { FORCE_AUTOUPDATE_PLUGINS: v }), false, String(v));
  assert.equal(up.autoUpdateOn({ extraKnownMarketplaces: { massmarket: { autoUpdate: "true" } } }, { FORCE_AUTOUPDATE_PLUGINS: "1" }), false);
  assert.equal(up.autoUpdateOn({}, { FORCE_AUTOUPDATE_PLUGINS: "1" }), false);
  assert.equal(up.autoUpdateOn(null, { FORCE_AUTOUPDATE_PLUGINS: "1" }), false);
});

test("decide: a new version seen again keeps its first-seen time; an older entry is dropped", () => {
  const now = Date.parse("2026-10-26T12:00:00.000Z");
  const d = up.decide({
    installed: { [HOOKS]: "1.0.10", [BRIDGE]: "0.6.0" },
    settings: {},
    latest: { [HOOKS]: { version: "1.0.12" }, [BRIDGE]: { version: "0.6.0" } },
    autoOn: true,
    behindSince: { [HOOKS + "@1.0.11"]: "2026-10-25T00:00:00.000Z", [HOOKS + "@1.0.12"]: "2026-10-26T11:00:00.000Z" },
    now,
  });
  assert.deepEqual(d.behindSince, { [HOOKS + "@1.0.12"]: "2026-10-26T11:00:00.000Z" }, "a newer release restarts the 2 hours");
  assert.deepEqual(d.pending, [HOOKS]);
  assert.equal(d.retryAt, Date.parse("2026-10-26T13:00:00.000Z"));
  assert.deepEqual(d.act, []);
});

test("which CLI: MM_CLAUDE_BIN, then PATH, then ~/.local/bin, then the desktop app's highest version; a sandbox sees only MM_CLAUDE_BIN", () => {
  const files = new Set();
  const dirs = {};
  const io = { onPath: () => [], listDir: (d) => dirs[d] || [], isFile: (p) => files.has(p) };
  const mac = "/Users/a";
  assert.deepEqual(up.findClaudeCli({ MM_CLAUDE_BIN: "/x/claude" }, "darwin", mac, io), { path: "/x/claude", source: "MM_CLAUDE_BIN" });
  assert.equal(up.findClaudeCli({ MM_HOOK_HOME: "/tmp/h" }, "darwin", mac, Object.assign({}, io, { onPath: () => ["/usr/local/bin/claude"] })), null, "a sandbox never runs a real CLI");
  assert.equal(up.findClaudeCli({}, "darwin", mac, io), null);

  const root = "/Users/a/Library/Application Support/Claude/claude-code";
  dirs[root] = ["2.1.304", "2.1.308", "not-a-version", "2.1.99"];
  dirs[root + "/2.1.304"] = ["6bbba6adc37f"];
  dirs[root + "/2.1.308"] = ["a93ded4b1b47"];
  dirs[root + "/2.1.99"] = ["ffff"];
  for (const v of ["2.1.304/6bbba6adc37f", "2.1.308/a93ded4b1b47", "2.1.99/ffff"]) files.add(root + "/" + v + "/claude.app/Contents/MacOS/claude");
  assert.deepEqual(up.findClaudeCli({}, "darwin", mac, io), { path: root + "/2.1.308/a93ded4b1b47/claude.app/Contents/MacOS/claude", source: "desktop app" });

  files.add("/Users/a/.local/bin/claude");
  assert.deepEqual(up.findClaudeCli({}, "darwin", mac, io), { path: "/Users/a/.local/bin/claude", source: "~/.local/bin" }, "the native installer's CLI before the desktop app's");

  files.add("/opt/homebrew/bin/claude");
  assert.deepEqual(up.findClaudeCli({}, "darwin", mac, Object.assign({}, io, { onPath: () => ["claude: aliased", "/opt/homebrew/bin/claude"] })), { path: "/opt/homebrew/bin/claude", source: "PATH" });
  assert.deepEqual(up.findClaudeCli({}, "linux", "/home/a", Object.assign({}, io, { onPath: () => ["/gone/claude"] })), null, "a PATH hit that is not a file does not count");
});

test("which CLI on Windows: claude.exe over claude.cmd, files only, then .local\\bin\\claude.exe, then the desktop app", () => {
  const files = new Set();
  const dirs = {};
  const io = { onPath: () => [], listDir: (d) => dirs[d] || [], isFile: (p) => files.has(p) };
  const home = "C:\\Users\\a";
  const env = { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" };
  const npm = "C:\\Users\\a\\AppData\\Roaming\\npm";
  files.add(npm + "\\claude.cmd");
  files.add("C:\\Program Files\\Claude\\claude.exe");
  const onPath = () => [npm + "\\claude", npm + "\\claude.cmd", "C:\\Users\\Ã¡\\gone\\claude.exe", "C:\\Program Files\\Claude\\claude.exe"];
  assert.deepEqual(up.findClaudeCli(env, "win32", home, Object.assign({}, io, { onPath })), { path: "C:\\Program Files\\Claude\\claude.exe", source: "PATH" });
  files.delete("C:\\Program Files\\Claude\\claude.exe");
  assert.deepEqual(up.findClaudeCli(env, "win32", home, Object.assign({}, io, { onPath })), { path: npm + "\\claude.cmd", source: "PATH" });
  files.delete(npm + "\\claude.cmd");
  assert.equal(up.findClaudeCli(env, "win32", home, Object.assign({}, io, { onPath })), null);

  const root = "C:\\Users\\a\\AppData\\Local\\Claude\\claude-code";
  dirs[root] = ["2.1.308"];
  dirs[root + "\\2.1.308"] = ["abc"];
  dirs[root + "\\2.1.308\\abc"] = ["bin"];
  files.add(root + "\\2.1.308\\abc\\bin\\claude.exe");
  assert.deepEqual(up.findClaudeCli(env, "win32", home, io), { path: root + "\\2.1.308\\abc\\bin\\claude.exe", source: "desktop app" });
  files.add("C:\\Users\\a\\.local\\bin\\claude.exe");
  assert.deepEqual(up.findClaudeCli(env, "win32", home, io), { path: "C:\\Users\\a\\.local\\bin\\claude.exe", source: "~/.local/bin" });

  assert.equal(up.cliNeedsShell("C:\\x\\claude.cmd", "win32"), true);
  assert.equal(up.cliNeedsShell("C:\\x\\claude.exe", "win32"), false);
  assert.equal(up.cliNeedsShell("/x/claude.cmd", "darwin"), false);
});

test("⛔ errors never carry a secret: env values, URL credentials and tokens are redacted, at most 300 characters", () => {
  // Every fake secret is built here, at run time, so the repository's secret scan has nothing to flag.
  const env = { HOME: "/Users/a", MM_HOOK_HOME: "/tmp/sandbox-home" };
  env["MM_EXT_" + "TOKEN"] = "mmx_" + "x1".repeat(8);
  env["GITHUB_" + "TOKEN"] = "v" + "x2".repeat(6);
  const password = "pw".repeat(4);
  const ghToken = "gh" + "p_" + "Ab1".repeat(8);
  const skToken = "sk-" + "ant-" + "Ab1".repeat(8);
  const out = up.scrub(
    `fatal: could not read https://robs:${password}@github.com/x.git with ${env["MM_EXT_" + "TOKEN"]} and ${env["GITHUB_" + "TOKEN"]} ${ghToken} ${skToken} in /tmp/sandbox-home/.claude\nsecond line`,
    env
  );
  assert.equal(out.includes(password), false);
  assert.equal(out.includes(env["MM_EXT_" + "TOKEN"]), false);
  assert.equal(out.includes(env["GITHUB_" + "TOKEN"]), false);
  assert.equal(out.includes(ghToken), false);
  assert.equal(out.includes(skToken), false);
  assert.equal(out.includes("/tmp/sandbox-home"), false, "the home folder is ~");
  assert.equal(out.includes("\n"), false);
  assert.match(out, /^fatal: could not read https:\/\/\[redacted\]@github\.com\/x\.git with \[redacted\] and \[redacted\] \[redacted\] \[redacted\] in ~\/\.claude second line$/);
  assert.equal(up.scrub("x".repeat(1000)).length, 300);
});
