// mm-hooks: the carried worklog hook warns when a task is named on a client with no open line (hook 0.13.1).
//
//   node --test plugins/mm-hooks/scripts/worklog-hook-open-line.test.js
//
// When a thread runs `worklog-hook.js --task "<task>"` on a session tied to a client (the `<client>-project` skill its
// PostToolUse recorded), the CLI asks OW's GET /api/ext/open-line for that client. On `open_line: false` it prints one
// more line after `Task noted:`; on anything else, a slow or failed request included, it prints nothing more and exits
// 0. OW's onboarding-wizard tests/unit/worklog-hook-open-line.unit.test.ts covers every case on the source file; these
// pin the same behaviour on the copy this plugin carries to every machine.
//
// The hook runs as a child process, as a thread's shell runs it, with HOME at a temporary folder, the session's
// declarations record written there, and a `--require` shim in place of fetch that logs every request and answers what
// the case sets. Nothing reads or writes this computer's own ~/.claude, and nothing reaches the network.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "worklog-hook.js");
// The client header carries the copied hook's own version, read from the file so a release never breaks this test.
const HOOK_VERSION = /^const HOOK_VERSION = "([^"]+)";$/m.exec(fs.readFileSync(HOOK, "utf8"))[1];
const TOKEN = "test-tracker-token-open-line";
const API_BASE = "https://ow.test.invalid";
const SESSION = "0d6b2c1e-4a5f-4c3b-9e8d-7f6a5b4c3d2e";

// VERBATIM: the hook's NO_OPEN_LINE_NOTICE (Opus, 2026-11-18).
const NOTICE =
  "Heads up: this client has no open line right now (nothing paid, agreed, or hours left in a bank), so this work will show as unmatched until a quote or invoice covers it.";

const FETCH_SHIM = `
const fs = require("fs");
globalThis.fetch = async (url, init) => {
  fs.appendFileSync(process.env.MM_TEST_FETCH_LOG, JSON.stringify({ url: String(url), method: (init && init.method) || "GET", headers: (init && init.headers) || {} }) + "\\n");
  const delay = Number(process.env.MM_TEST_FETCH_DELAY_MS || 0);
  if (delay > 0) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      if (init && init.signal) init.signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    });
  }
  return new Response(process.env.MM_TEST_FETCH_BODY || JSON.stringify({ ok: true }), { status: Number(process.env.MM_TEST_FETCH_STATUS || 200) });
};
`;

const NO_LINE = JSON.stringify({ ok: true, project_id: "11111111-2222-4333-8444-555555555555", open_line: false, via: null, line_key: null, reason: "no_line" });
const HAS_LINE = JSON.stringify({ ok: true, project_id: "11111111-2222-4333-8444-555555555555", open_line: true, via: "bank", line_key: "L-0a1b2c3d", reason: null });

function makeRig(t, skill) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mm-hook-open-line-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, "home");
  // The tracked folder is a sibling of home: the consent gate refuses a root that contains home.
  const workRoot = path.join(base, "work");
  const workDir = path.join(workRoot, "project");
  fs.mkdirSync(path.join(home, ".claude", "mm-hooks", "state", "declarations"), { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "mm-hooks", "consent.json"), JSON.stringify({ v: 2, allowlist: [workRoot] }), "utf8");
  if (skill) {
    fs.writeFileSync(
      path.join(home, ".claude", "mm-hooks", "state", "declarations", `${SESSION}.json`),
      JSON.stringify({ declared_skill: skill, declared_skill_at: "2026-11-18T16:00:00.000Z", declared_task: null, declared_task_at: null }),
      "utf8",
    );
  }
  const shim = path.join(base, "fetch-shim.cjs");
  const log = path.join(base, "fetch.log");
  fs.writeFileSync(shim, FETCH_SHIM, "utf8");
  fs.writeFileSync(log, "", "utf8");

  const run = (label, extra = {}) => {
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NODE_OPTIONS: `--require ${shim}`,
      MM_TRACKER_TOKEN: TOKEN,
      MM_TRACKER_API_BASE: API_BASE,
      MM_TEST_FETCH_LOG: log,
      CLAUDE_CODE_SESSION_ID: SESSION,
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
      MM_UNATTENDED: undefined,
      ...extra,
    };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    return spawnSync(process.execPath, [HOOK, "--task", label], { cwd: workDir, encoding: "utf8", env });
  };
  const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { run, calls };
}

test("no open line: the notice follows `Task noted:`, from one GET for the session's client", (t) => {
  const rig = makeRig(t, "acme-project");
  const r = rig.run("Phase 1 nurture sequence copy", { MM_TEST_FETCH_BODY: NO_LINE });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `Task noted: Phase 1 nurture sequence copy\n${NOTICE}\n`);
  assert.equal(r.stderr, "");
  const calls = rig.calls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE}/api/ext/open-line?skill=acme-project`);
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].headers["X-MM-Client"], `mm-hook/${HOOK_VERSION}`);
});

for (const [name, extra] of [
  ["an open line", { MM_TEST_FETCH_BODY: HAS_LINE }],
  ["own work", { MM_TEST_FETCH_BODY: JSON.stringify({ ok: true, own_work: true, open_line: null }) }],
  ["a 503", { MM_TEST_FETCH_STATUS: "503", MM_TEST_FETCH_BODY: JSON.stringify({ ok: false, open_line: false }) }],
  ["a body that is not JSON", { MM_TEST_FETCH_BODY: "open_line: false" }],
]) {
  test(`silence on ${name}: \`Task noted:\` only, exit 0`, (t) => {
    const rig = makeRig(t, "acme-project");
    const r = rig.run("Booking page", extra);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "Task noted: Booking page\n");
    assert.equal(r.stderr, "");
  });
}

test("a slow OW: silence once the short timeout passes", (t) => {
  const rig = makeRig(t, "acme-project");
  const started = Date.now();
  const r = rig.run("Booking page", { MM_TEST_FETCH_DELAY_MS: "20000", MM_TEST_FETCH_BODY: NO_LINE });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "Task noted: Booking page\n");
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
});

for (const [name, skill, extra] of [
  ["no client declared in this session", null, {}],
  ["Massmarket's own work", "massmarket-internal-ops", {}],
  ["no session id in the environment", "acme-project", { CLAUDE_CODE_SESSION_ID: undefined }],
  ["an unattended run", "acme-project", { MM_UNATTENDED: "1" }],
  ["no person at the session", "acme-project", { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }],
]) {
  test(`no request at all: ${name}`, (t) => {
    const rig = makeRig(t, skill);
    const r = rig.run("Booking page", { MM_TEST_FETCH_BODY: NO_LINE, ...extra });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "Task noted: Booking page\n");
    assert.deepEqual(rig.calls(), []);
  });
}
