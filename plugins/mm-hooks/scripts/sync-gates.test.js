// mm-hooks: tests for sync-gates.js (the team safety gates, through the plugin).
//
//   node --test plugins/mm-hooks/scripts/sync-gates.test.js
//
// Every home here is a temporary directory (MM_HOOK_HOME), and the team-safety-gates installer is a fake that records
// how it was run and writes the state file the real one writes. The real installer and its checks live in the control
// tower (skills/team-safety-gates/scripts/install.mjs) and are tested there. Nothing reads or writes this computer's
// own ~/.claude.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const sg = require("./sync-gates.js");

const SCRIPTS = __dirname;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const FAKE_INSTALLER = `#!/usr/bin/env node
// fake team-safety-gates installer; the real one accepts "--auto"
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
fs.appendFileSync(path.join(os.homedir(), "installer-calls.log"), JSON.stringify({ argv: process.argv.slice(2), home: os.homedir(), userprofile: process.env.USERPROFILE, cwd: process.cwd() }) + "\\n");
const dir = path.join(os.homedir(), ".claude", "mm-hooks", "state");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "team-safety-gates.json"), JSON.stringify({
  v: 1,
  gates: {
    "send-gate": { installed_sha: "a".repeat(64), main_sha: "b".repeat(64), at: "2026-11-28T16:00:00.000Z" },
    "metered-key-gate": { installed_sha: "d".repeat(64), main_sha: "e".repeat(64), at: "2026-11-28T16:00:01.000Z" },
  },
  rules: null,
  failed: { "secret-read-gate": "c".repeat(64) },
  not_done: { "secret-read-gate": "smoke", "send-gate": "/Users/x/path" },
}));
process.exit(Number(process.env.FAKE_EXIT || 0));
`;

/** A temporary home: the tracker folder, and the team-safety-gates skill with a fake installer (or none). */
function makeHome({ tracker = true, installer = FAKE_INSTALLER } = {}) {
  const home = tmp("mm-sg-home-");
  if (tracker) fs.mkdirSync(path.join(home, ".claude", "mm-hooks"), { recursive: true });
  if (installer !== null) {
    const dir = path.join(home, ".claude", "skills", "team-safety-gates", "scripts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "install.mjs"), installer);
  }
  return home;
}
const env = (home, extra = {}) => {
  const e = Object.assign({}, process.env, { MM_HOOK_HOME: home }, extra);
  for (const k of ["MM_UNATTENDED", "LANE2_RUN_ID", "MM_RUN_SESSION", "MM_TEAM_GATES"]) if (!(k in extra)) delete e[k];
  return e;
};
const calls = (home) => {
  try {
    return fs.readFileSync(path.join(home, "installer-calls.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) {
    return [];
  }
};
const status = (home) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, ".claude", "mm-hooks", "plugin-sync.json"), "utf8"));
  } catch (_) {
    return null;
  }
};

test("a team machine with the skill is ready", () => {
  assert.equal(sg.skipReason(env(makeHome())), null);
});

test("never on Rob's machine: a control-tower link, the rob-email file, or Rob's bridge state", () => {
  const linked = makeHome();
  const ct = path.join(linked, "massmarket-ops-control-tower", "global-config");
  fs.mkdirSync(ct, { recursive: true });
  fs.writeFileSync(path.join(ct, "CLAUDE.md"), "rules");
  fs.symlinkSync(path.join(ct, "CLAUDE.md"), path.join(linked, ".claude", "CLAUDE.md"));
  assert.equal(sg.skipReason(env(linked)), "control-tower");

  const robEmail = makeHome();
  fs.mkdirSync(path.join(robEmail, ".config", "massmarket"), { recursive: true });
  fs.writeFileSync(path.join(robEmail, ".config", "massmarket", "rob-email"), "x");
  assert.equal(sg.skipReason(env(robEmail)), "rob-machine");

  const robBridge = makeHome();
  fs.writeFileSync(path.join(robBridge, ".claude", "mm-hooks", "bridge-state.json"), JSON.stringify({ member: " Rob@Massmarket.ai " }));
  assert.equal(sg.skipReason(env(robBridge)), "rob-machine");

  // a teammate's own rules file (not a link) and bridge state are not Rob's
  const team = makeHome();
  fs.writeFileSync(path.join(team, ".claude", "CLAUDE.md"), "team rules");
  fs.writeFileSync(path.join(team, ".claude", "mm-hooks", "bridge-state.json"), JSON.stringify({ member: "antu@massmarket.ai" }));
  assert.equal(sg.skipReason(env(team)), null);
});

test("never in an unattended run, with MM_TEAM_GATES=0, without the tracker, or without an installer that knows --auto", () => {
  const h = makeHome();
  assert.equal(sg.skipReason(env(h, { MM_UNATTENDED: "1" })), "unattended");
  assert.equal(sg.skipReason(env(h, { LANE2_RUN_ID: "r1" })), "unattended");
  assert.equal(sg.skipReason(env(h, { MM_RUN_SESSION: "s" })), "unattended");
  for (const off of ["0", "false", "off", "NO"]) assert.equal(sg.skipReason(env(h, { MM_TEAM_GATES: off })), "off");
  assert.equal(sg.skipReason(env(h, { MM_TEAM_GATES: "1" })), null);
  assert.equal(sg.skipReason(env(makeHome({ tracker: false }))), "no-tracker");
  assert.equal(sg.skipReason(env(makeHome({ installer: null }))), "no-skill");
  assert.equal(sg.skipReason(env(makeHome({ installer: "// an installer from before --auto\n" }))), "skill-too-old");
});

test("the child runs the installer with --auto in the home folder and records names, short shas and failures", () => {
  const h = makeHome();
  const rec = sg.runChild(env(h));
  const c = calls(h);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].argv, ["--auto"]);
  assert.equal(fs.realpathSync(c[0].home), fs.realpathSync(h));
  assert.equal(fs.realpathSync(c[0].userprofile), fs.realpathSync(h));
  assert.equal(fs.realpathSync(c[0].cwd), fs.realpathSync(h));
  assert.equal(rec.result, "ran");
  assert.deepEqual(rec.installed, {
    "send-gate": { main: "b".repeat(12), at: "2026-11-28T16:00:00.000Z" },
    "metered-key-gate": { main: "e".repeat(12), at: "2026-11-28T16:00:01.000Z" },
  });
  assert.deepEqual(rec.failed, ["secret-read-gate"]);
  // reason codes only: a value that is not one is dropped
  assert.deepEqual(rec.not_done, { "secret-read-gate": "smoke" });
  assert.deepEqual(status(h).team_gates, rec);
  // never a full sha or a path in the record
  assert.doesNotMatch(JSON.stringify(rec), /[0-9a-f]{40}|[\\/]/);
});

test("the child keeps the other steps' records and says how the installer ended", () => {
  const h = makeHome();
  fs.writeFileSync(path.join(h, ".claude", "mm-hooks", "plugin-sync.json"), JSON.stringify({ plugin: "mm-hooks", version: "1.0.40", codex: { action: "current" } }));
  const rec = sg.runChild(env(h, { FAKE_EXIT: "1" }));
  assert.equal(rec.result, "exit-1");
  const s = status(h);
  assert.equal(s.version, "1.0.40");
  assert.deepEqual(s.codex, { action: "current" });
  assert.equal(s.team_gates.result, "exit-1");
});

test("the child does nothing on Rob's machine even when started directly", () => {
  const h = makeHome();
  fs.mkdirSync(path.join(h, ".config", "massmarket"), { recursive: true });
  fs.writeFileSync(path.join(h, ".config", "massmarket", "rob-email"), "x");
  assert.equal(sg.runChild(env(h)), null);
  assert.equal(calls(h).length, 0);
  assert.equal(status(h), null);
});

test("summarize ignores a state file it does not know", () => {
  assert.deepEqual(sg.summarize(null, { result: "ran" }), { result: "ran", installed: {} });
  assert.deepEqual(sg.summarize({ v: 2, gates: { "send-gate": {} } }, { result: "ran" }), { result: "ran", installed: {} });
  assert.deepEqual(sg.summarize({ v: 1, gates: { "send-gate": { main_sha: "/Users/x", at: 5 }, other: { main_sha: "b".repeat(64) } } }, {}), {
    installed: { "send-gate": { main: null, at: null } },
  });
});

test("the SessionStart step prints nothing, exits 0 and leaves the install to a detached child", async () => {
  const h = makeHome();
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, "sync-gates.js")], { env: env(h), encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
  const until = Date.now() + 15000;
  while (Date.now() < until && !(status(h) && status(h).team_gates)) await new Promise((res) => setTimeout(res, 50));
  assert.equal(calls(h).length, 1);
  assert.equal(status(h).team_gates.result, "ran");
});

test("the SessionStart step records a missing or old skill, and nothing on Rob's machine or without the tracker", () => {
  const run = (h, extra) => spawnSync(process.execPath, [path.join(SCRIPTS, "sync-gates.js")], { env: env(h, extra), encoding: "utf8", timeout: 20000 });
  const missing = makeHome({ installer: null });
  assert.equal(run(missing).status, 0);
  assert.equal(status(missing).team_gates.result, "no-skill");
  const old = makeHome({ installer: "// old\n" });
  run(old);
  assert.equal(status(old).team_gates.result, "skill-too-old");
  const rob = makeHome();
  fs.mkdirSync(path.join(rob, ".config", "massmarket"), { recursive: true });
  fs.writeFileSync(path.join(rob, ".config", "massmarket", "rob-email"), "x");
  run(rob);
  assert.equal(status(rob), null);
  assert.equal(calls(rob).length, 0);
  const none = makeHome({ tracker: false });
  run(none);
  assert.equal(fs.existsSync(path.join(none, ".claude", "mm-hooks")), false);
});

test("sync-hook.js keeps the team_gates record when it rewrites plugin-sync.json", () => {
  const h = makeHome();
  const rec = { at: "2026-11-28T16:00:00.000Z", result: "ran", installed: {} };
  fs.writeFileSync(path.join(h, ".claude", "mm-hooks", "plugin-sync.json"), JSON.stringify({ plugin: "mm-hooks", version: "0.0.1", team_gates: rec }));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, "sync-hook.js")], { env: env(h), encoding: "utf8", timeout: 20000 });
  assert.equal(r.status, 0);
  assert.deepEqual(status(h).team_gates, rec);
});
