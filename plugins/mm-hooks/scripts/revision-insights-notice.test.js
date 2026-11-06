// mm-hooks: tests for revision-insights-notice.js (and sync-hook.js keeping its record).
//
//   node --test plugins/mm-hooks/scripts/revision-insights-notice.test.js
//
// Every home here is a temporary directory (MM_HOOK_HOME). Nothing reads or writes this computer's own ~/.claude, and
// nothing reaches the network.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const rin = require("./revision-insights-notice.js");

const SCRIPTS = __dirname;
const SCRIPT = path.join(SCRIPTS, "revision-insights-notice.js");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The notice exactly as authored, with <AGE> where the age words go. Placed verbatim; a wording change fails here.
const AUTHORED = `Massmarket revision-insights routine: the weekly routine <AGE>. It sends OW only this person's own instructions on reply-package drafts (at most 300 characters each), so the skills that build reply packages need fewer revisions.
Do this once in this session, alongside the person's task, without stopping their work:
1. Call list_scheduled_tasks (load the scheduled-tasks tools with ToolSearch if they are deferred).
2. A task with taskId "revision-insights" that is enabled: do nothing more. One that is disabled: tell the person in one line that their weekly revision-insights routine is switched off, and ask whether to switch it back on.
3. No such task: call create_scheduled_task with taskId "revision-insights", title "Revision insights (weekly)", description "Sends my own instructions on reply-package drafts to OW, nothing else", cronExpression "0 16 * * 5", and prompt "Load the revision-insights skill and follow it: run its extract_my_revisions.mjs script once and reply with the one line it prints. Do nothing else." Then tell the person in one line: "I set up your weekly revision-insights routine (Fridays 4 PM). It sends OW only your own instructions on reply-package drafts, nothing else from your sessions."
If the scheduled-tasks tools are not in this session, say nothing about this; a later session will try again.`;
const expected = (age) => AUTHORED.replace("<AGE>", age);

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const iso = (ms) => new Date(ms).toISOString();

/**
 * A temporary home. tracker: ~/.claude/mm-hooks exists; skill: the revision-insights SKILL.md exists; reviewHost:
 * ~/.massmarket-zero-revision exists; stamp: revision-insights.json (an object is written as JSON, a string as is,
 * null = no file); status: plugin-sync.json (same rule).
 */
function makeHome({ tracker = true, skill = true, reviewHost = false, stamp = null, status = null } = {}) {
  const home = tmp("mm-rin-home-");
  const claude = path.join(home, ".claude");
  fs.mkdirSync(claude, { recursive: true });
  if (tracker) fs.mkdirSync(path.join(claude, "mm-hooks"));
  if (skill) {
    fs.mkdirSync(path.join(claude, "skills", "revision-insights"), { recursive: true });
    fs.writeFileSync(path.join(claude, "skills", "revision-insights", "SKILL.md"), "---\nname: revision-insights\n---\n");
  }
  if (reviewHost) fs.mkdirSync(path.join(home, ".massmarket-zero-revision"));
  const write = (name, v) => {
    if (v === null || v === undefined) return;
    fs.writeFileSync(path.join(claude, "mm-hooks", name), typeof v === "string" ? v : JSON.stringify(v, null, 1));
  };
  write("revision-insights.json", stamp);
  write("plugin-sync.json", status);
  return home;
}

const hookDir = (home) => path.join(home, ".claude", "mm-hooks");
const statusOf = (home) => JSON.parse(fs.readFileSync(path.join(hookDir(home), "plugin-sync.json"), "utf8"));
const hasStatus = (home) => fs.existsSync(path.join(hookDir(home), "plugin-sync.json"));
const leftovers = (home) => fs.readdirSync(hookDir(home)).filter((f) => f.includes(".lock") || f.includes(".new-"));

/** The environment a run gets: this process's, minus anything that would change the outcome, plus the sandbox. */
function envFor(home, extra = {}) {
  const env = Object.assign({}, process.env);
  for (const k of ["MM_REVISION_INSIGHTS_NOTICE", "MM_UNATTENDED", "CLAUDE_CONFIG_DIR"]) delete env[k];
  return Object.assign(env, { MM_HOOK_HOME: home }, extra);
}

function run(script, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/** Run the SessionStart step; it always exits 0 with nothing on stderr. */
async function runHook(env) {
  const r = await run(SCRIPT, env);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, "", "nothing on stderr");
  return r;
}

/** A run that printed nothing. */
async function expectSilent(env, why) {
  const r = await runHook(env);
  assert.equal(r.stdout, "", why + ": SessionStart stdout reaches the model, so nothing on it");
  return r;
}

/** A run that printed the notice: exactly one JSON line, in the SessionStart shape, with the authored text. */
async function expectNotice(env, age) {
  const r = await runHook(env);
  assert.ok(r.stdout.endsWith("\n"), "one line, newline-terminated");
  const lines = r.stdout.split("\n");
  assert.equal(lines.length, 2, "exactly one line");
  assert.equal(lines[1], "");
  const out = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(out.hookSpecificOutput), ["hookEventName", "additionalContext"]);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.hookSpecificOutput.additionalContext, expected(age));
  return r;
}

// ───────────────────────────────────────────────────────────── what it prints

test("no stamp: one JSON line with the notice, 'has never run on this computer'; the claim is recorded", async () => {
  const home = makeHome();
  const before = Date.now();
  await expectNotice(envFor(home), "has never run on this computer");
  const rec = statusOf(home).revision_insights_notice;
  assert.equal(rec.count, 1);
  assert.ok(Date.parse(rec.last_notice_at) >= before - 1000 && Date.parse(rec.last_notice_at) <= Date.now());
  assert.equal(fs.existsSync(path.join(hookDir(home), "revision-insights.json")), false, "the stamp is never written here");
  assert.deepEqual(leftovers(home), []);
});

test("a stamp 10 days old: 'last ran 10 days ago'", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 10 * DAY - 5 * 60000) } });
  await expectNotice(envFor(home), "last ran 10 days ago");
});

test("a stamp 2 days old: nothing printed, nothing recorded", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 2 * DAY) } });
  await expectSilent(envFor(home), "fresh stamp");
  assert.equal(hasStatus(home), false);
});

test("a stamp more than a day in the future cannot be trusted: notice, 'has never run on this computer'", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() + 3 * DAY) } });
  await expectNotice(envFor(home), "has never run on this computer");
});

test("an unreadable stamp, or a last_run_at that does not parse: notice, 'has never run on this computer'", async () => {
  for (const stamp of ["{not json", "[]", '"2026-11-01"', { last_run_at: "last friday" }, { last_run_at: 1730000000000 }, {}]) {
    const home = makeHome({ stamp });
    await expectNotice(envFor(home), "has never run on this computer");
  }
});

// ───────────────────────────────────────────────────────────── the seven gates

test("gate 1: MM_REVISION_INSIGHTS_NOTICE off (0, false, no, off, any case) prints nothing", async () => {
  for (const off of ["0", "false", "no", "off", "OFF", " No "]) {
    const home = makeHome();
    await expectSilent(envFor(home, { MM_REVISION_INSIGHTS_NOTICE: off }), "turned off with " + JSON.stringify(off));
    assert.equal(hasStatus(home), false);
  }
  // Anything else leaves it on.
  await expectNotice(envFor(makeHome(), { MM_REVISION_INSIGHTS_NOTICE: "1" }), "has never run on this computer");
});

test("gate 2: MM_UNATTENDED=1 (headless automation) prints nothing", async () => {
  const home = makeHome();
  await expectSilent(envFor(home, { MM_UNATTENDED: "1" }), "unattended");
  assert.equal(hasStatus(home), false);
});

test("gate 3: no ~/.claude/mm-hooks (the tracker is not installed) prints nothing and creates nothing", async () => {
  const home = makeHome({ tracker: false });
  await expectSilent(envFor(home), "no tracker");
  assert.equal(fs.existsSync(hookDir(home)), false, "the folder is not created");
});

test("gate 4: no revision-insights skill installed prints nothing", async () => {
  const home = makeHome({ skill: false });
  await expectSilent(envFor(home), "no skill");
  assert.equal(hasStatus(home), false);
});

test("gate 5: ~/.massmarket-zero-revision (Rob's weekly-review computer) prints nothing", async () => {
  const home = makeHome({ reviewHost: true });
  await expectSilent(envFor(home), "review host");
  assert.equal(hasStatus(home), false);
});

test("gate 6: a stamp under 9 days old prints nothing (8 days 23 hours)", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 9 * DAY + HOUR) } });
  await expectSilent(envFor(home), "stamp under 9 days");
});

test("gate 7, the throttle: a second session within 20 hours prints nothing; after 20 hours it prints again", async () => {
  const home = makeHome();
  const env = envFor(home);
  await expectNotice(env, "has never run on this computer");
  const first = statusOf(home).revision_insights_notice;
  assert.equal(first.count, 1);

  await expectSilent(env, "within 20 hours");
  assert.deepEqual(statusOf(home).revision_insights_notice, first, "a held-back run changes nothing");

  const s = statusOf(home);
  s.revision_insights_notice.last_notice_at = iso(Date.now() - 19 * HOUR);
  fs.writeFileSync(path.join(hookDir(home), "plugin-sync.json"), JSON.stringify(s));
  await expectSilent(env, "19 hours after");

  s.revision_insights_notice.last_notice_at = iso(Date.now() - 20 * HOUR - 60000);
  fs.writeFileSync(path.join(hookDir(home), "plugin-sync.json"), JSON.stringify(s));
  await expectNotice(env, "has never run on this computer");
  assert.equal(statusOf(home).revision_insights_notice.count, 2);
});

test("⛔ two sessions starting together show the notice once", async () => {
  for (let i = 0; i < 6; i++) {
    const home = makeHome();
    const env = envFor(home);
    const runs = await Promise.all([run(SCRIPT, env), run(SCRIPT, env), run(SCRIPT, env)]);
    for (const r of runs) {
      assert.equal(r.code, 0);
      assert.equal(r.stderr, "");
    }
    assert.equal(runs.filter((r) => r.stdout !== "").length, 1, `round ${i}: exactly one session got it`);
    assert.equal(statusOf(home).revision_insights_notice.count, 1);
    assert.deepEqual(leftovers(home), []);
  }
});

// ───────────────────────────────────────────────────────────── plugin-sync.json

test("a malformed plugin-sync.json does not crash it: the notice shows and the file is rewritten as an object", async () => {
  for (const bad of ["{not json", "[1,2]", "null", ""]) {
    const home = makeHome({ status: bad });
    await expectNotice(envFor(home), "has never run on this computer");
    assert.equal(statusOf(home).revision_insights_notice.count, 1);
  }
  // A record of the wrong shape is replaced, not trusted.
  const home = makeHome({ status: { revision_insights_notice: "yesterday" } });
  await expectNotice(envFor(home), "has never run on this computer");
  assert.equal(statusOf(home).revision_insights_notice.count, 1);
});

test("other plugin-sync.json keys are kept: sync-hook.js's top-level record, `extension` and `self_update`", async () => {
  const seeded = { plugin: "mm-hooks", version: "1.0.14", action: "current", extension: { action: "checked" }, self_update: { result: "current", last_attempt_at: iso(Date.now()) } };
  const home = makeHome({ status: seeded });
  await expectNotice(envFor(home), "has never run on this computer");
  const s = statusOf(home);
  assert.equal(s.revision_insights_notice.count, 1);
  delete s.revision_insights_notice;
  assert.deepEqual(s, seeded);
});

test("sync-hook.js carries `revision_insights_notice` over (it rewrites its own top-level record each session)", async () => {
  const rec = { last_notice_at: iso(Date.now() - HOUR), count: 3 };
  const home = makeHome({ status: { plugin: "mm-hooks", version: "1.0.14", action: "current", revision_insights_notice: rec } });
  await new Promise((resolve) => spawn(process.execPath, [path.join(SCRIPTS, "sync-hook.js")], { env: envFor(home), stdio: "ignore" }).on("exit", resolve));
  const s = statusOf(home);
  assert.equal(s.action, "not-installed", "sync-hook.js wrote its record");
  assert.deepEqual(s.revision_insights_notice, rec);
});

test("⛔ run beside the other SessionStart steps at the same time, no record is lost and the notice shows once", async () => {
  for (let i = 0; i < 6; i++) {
    const home = makeHome();
    const env = envFor(home, { MM_PLUGIN_SELF_UPDATE: "0", LOCALAPPDATA: path.join(home, "AppData", "Local") });
    const [, , notice] = await Promise.all([run(path.join(SCRIPTS, "sync-hook.js"), env), run(path.join(SCRIPTS, "sync-extension.js"), env), run(SCRIPT, env)]);
    assert.equal(notice.code, 0);
    assert.notEqual(notice.stdout, "", `round ${i}: the notice printed`);
    const s = statusOf(home);
    assert.equal(s.plugin, "mm-hooks", `round ${i}: the hook step's record`);
    assert.ok(s.extension && s.extension.action, `round ${i}: the extension step's record`);
    assert.equal(s.revision_insights_notice && s.revision_insights_notice.count, 1, `round ${i}: the notice record`);
    assert.deepEqual(leftovers(home), []);
  }
});

// ───────────────────────────────────────────────────────────── pure parts

test("noticeText places the authored wording verbatim", () => {
  assert.equal(rin.noticeText("has never run on this computer"), expected("has never run on this computer"));
  assert.equal(rin.noticeText("last ran 12 days ago"), expected("last ran 12 days ago"));
  assert.equal(rin.noticeText("x").split("\n").length, 6);
});

test("outputLine is one JSON line in the SessionStart shape", () => {
  const line = rin.outputLine("hello\nworld");
  assert.equal(line.indexOf("\n"), line.length - 1);
  assert.deepEqual(JSON.parse(line), { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "hello\nworld" } });
});

test("stampAge and ageWords: the 9-day and 1-day-ahead boundaries, whole days rounded down", () => {
  const now = Date.parse("2026-11-05T17:00:00.000Z");
  assert.equal(rin.stampAge(null, now), null);
  assert.equal(rin.stampAge([], now), null);
  assert.equal(rin.stampAge({ last_run_at: "nope" }, now), null);
  assert.equal(rin.stampAge({ last_run_at: 5 }, now), null);
  assert.equal(rin.stampAge({ last_run_at: iso(now - DAY) }, now), DAY);

  assert.equal(rin.ageWords(null), "has never run on this computer");
  assert.equal(rin.ageWords(0), null);
  assert.equal(rin.ageWords(9 * DAY - 1), null, "just under 9 days is fresh");
  assert.equal(rin.ageWords(9 * DAY), "last ran 9 days ago", "9 days exactly is stale");
  assert.equal(rin.ageWords(10 * DAY + 23 * HOUR), "last ran 10 days ago");
  assert.equal(rin.ageWords(400 * DAY), "last ran 400 days ago");
  assert.equal(rin.ageWords(-DAY), null, "a day ahead is clock drift, still fresh");
  assert.equal(rin.ageWords(-DAY - 1), "has never run on this computer", "more than a day ahead reads as no stamp");
});

test("throttleAllows: 20 hours, unreadable or ahead-of-clock records let it through", () => {
  const now = Date.parse("2026-11-05T17:00:00.000Z");
  assert.equal(rin.throttleAllows(undefined, now), true);
  assert.equal(rin.throttleAllows("x", now), true);
  assert.equal(rin.throttleAllows({}, now), true);
  assert.equal(rin.throttleAllows({ last_notice_at: "garbage" }, now), true);
  assert.equal(rin.throttleAllows({ last_notice_at: iso(now - 20 * HOUR + 1) }, now), false);
  assert.equal(rin.throttleAllows({ last_notice_at: iso(now - 20 * HOUR) }, now), true);
  assert.equal(rin.throttleAllows({ last_notice_at: iso(now + HOUR) }, now), true, "a clock moved back never holds it forever");
});

test("decideNotice: each gate, in order, with its reason", () => {
  const now = Date.parse("2026-11-05T17:00:00.000Z");
  const ok = { hookDir: true, skill: true, reviewHost: false };
  const d = (over) => rin.decideNotice(Object.assign({ env: {}, now, facts: ok, stamp: null }, over));
  assert.deepEqual(d({}), { show: true, reason: "due", age: "has never run on this computer", mode: "setup" });
  assert.equal(d({ env: { MM_REVISION_INSIGHTS_NOTICE: "off" } }).reason, "turned-off");
  assert.equal(d({ env: { MM_UNATTENDED: "1" } }).reason, "unattended");
  assert.equal(d({ env: { MM_UNATTENDED: "0" } }).show, true);
  assert.equal(d({ facts: Object.assign({}, ok, { hookDir: false }) }).reason, "no-tracker");
  assert.equal(d({ facts: Object.assign({}, ok, { skill: false }) }).reason, "no-skill");
  assert.equal(d({ facts: Object.assign({}, ok, { reviewHost: true }) }).reason, "review-host");
  assert.equal(d({ stamp: { last_run_at: iso(now - 2 * DAY) } }).reason, "fresh");
  assert.deepEqual(d({ stamp: { last_run_at: iso(now - 10 * DAY) } }), { show: true, reason: "due", age: "last ran 10 days ago", mode: "setup" });
  assert.equal(d({ record: { last_notice_at: iso(now - HOUR), count: 1 } }).reason, "throttled");
  assert.equal(d({ record: { last_notice_at: iso(now - 21 * HOUR), count: 1 } }).show, true);
});

test("paths: MM_HOOK_HOME sandboxes everything; the skill is looked for where the tracker hook installs it", () => {
  const sandbox = rin.paths({ MM_HOOK_HOME: "/sb", CLAUDE_CONFIG_DIR: "/elsewhere" });
  assert.equal(sandbox.skillFile, path.join("/sb", ".claude", "skills", "revision-insights", "SKILL.md"));
  assert.equal(sandbox.stampFile, path.join("/sb", ".claude", "mm-hooks", "revision-insights.json"));
  assert.equal(sandbox.reviewHostDir, path.join("/sb", ".massmarket-zero-revision"));
  const cfg = rin.paths({ CLAUDE_CONFIG_DIR: "/cfg" });
  assert.equal(cfg.skillFile, path.join(os.homedir(), ".claude", "skills", "revision-insights", "SKILL.md"), "worklog-hook.js installs team skills under the home folder, whatever CLAUDE_CONFIG_DIR says");
  assert.equal(cfg.hookDir, path.join(os.homedir(), ".claude", "mm-hooks"), "the tracker folder stays under the home folder");
});

test("the step itself is fast: well under 200 ms in process", () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 12 * DAY) } });
  const t0 = process.hrtime.bigint();
  const text = rin.fastPath(envFor(home), Date.now());
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(text, expected("last ran 12 days ago"));
  assert.ok(ms < 200, `took ${ms.toFixed(1)} ms`);
});

// ── the session pass (mm-hooks 1.0.16) ──
function addSessionPass(home, sessionStamp = null) {
  const dir = path.join(home, ".claude", "skills", "revision-insights", "scripts");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session_insights.mjs"), "// stand-in\n");
  if (sessionStamp) fs.writeFileSync(path.join(hookDir(home), "session-insights.json"), JSON.stringify(sessionStamp));
}

test("session pass on disk, routine fresh, no session stamp: the UPDATE notice, once", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 2 * DAY) } });
  addSessionPass(home);
  const r = await runHook(envFor(home));
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.equal(ctx, rin.sessionPassText("update"));
  assert.match(ctx, /update_scheduled_task with that taskId/);
  assert.ok(ctx.includes(rin.ROUTINE_PROMPT) && ctx.includes(rin.UPDATE_TELL) && ctx.includes(rin.SETUP_TELL));
  assert.equal((await runHook(envFor(home))).stdout, "", "throttled for 20 hours");
});

test("session pass on disk and its stamp written (on or off): nothing", async () => {
  const home = makeHome({ stamp: { last_run_at: iso(Date.now() - 2 * DAY) } });
  addSessionPass(home, { last_run_at: iso(Date.now()), result: "not_enabled" });
  assert.equal((await runHook(envFor(home))).stdout, "");
});

test("session pass on disk, routine missing: the setup notice creates the routine with the three-step prompt", async () => {
  const home = makeHome();
  addSessionPass(home);
  const ctx = JSON.parse((await runHook(envFor(home))).stdout).hookSpecificOutput.additionalContext;
  assert.equal(ctx, rin.sessionPassText("setup", "has never run on this computer"));
  assert.match(ctx, /create_scheduled_task with taskId "revision-insights"/);
  assert.ok(ctx.includes(rin.ROUTINE_PROMPT));
  assert.doesNotMatch(ctx, /run its extract_my_revisions\.mjs script once/);
});

test("decideNotice: update mode only with the session pass and no session stamp; Rob's Mac and headless still silent", () => {
  const now = Date.parse("2026-11-05T17:00:00.000Z");
  const fresh = { last_run_at: iso(now - 2 * DAY) };
  const ok = { hookDir: true, skill: true, reviewHost: false, sessionPass: true };
  const d = (over) => rin.decideNotice(Object.assign({ env: {}, now, facts: ok, stamp: fresh, sessionStamp: null }, over));
  assert.deepEqual(d({}), { show: true, reason: "update", age: null, mode: "update" });
  assert.equal(d({ sessionStamp: { last_run_at: iso(now) } }).reason, "fresh");
  assert.equal(d({ facts: Object.assign({}, ok, { sessionPass: false }) }).reason, "fresh");
  assert.equal(d({ facts: Object.assign({}, ok, { reviewHost: true }) }).reason, "review-host");
  assert.equal(d({ env: { MM_UNATTENDED: "1" } }).reason, "unattended");
  assert.equal(d({ stamp: null }).mode, "setup");
});

test("the authored routine prompt and the person-facing lines carry no double quotes inside the quoted text", () => {
  for (const s of [rin.ROUTINE_PROMPT, rin.SETUP_TELL, rin.UPDATE_TELL]) assert.doesNotMatch(s, /"/);
});
