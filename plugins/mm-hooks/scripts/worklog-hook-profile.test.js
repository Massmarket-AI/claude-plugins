// mm-hooks: the worklog hook names the Claude profile it runs under (hook 0.11.14, OW migration 332).
//
//   node --test plugins/mm-hooks/scripts/worklog-hook-profile.test.js
//
// Rob, 2026-10-30: "switching profiles all the time. It needs to be able to detect and adapt to that." Each Claude
// profile (account + organization) keeps its own session list, so OW holds a task only by rows from the profile that
// pulls the feed. The hook sends `X-MM-Profile: <first 12 hex of sha256("<account>:<org>")>` on the chip-feed GET and
// on every chip-event POST, never the raw ids, and nothing at all without both variables (Codex, cloud).
//
// The hook runs as a child process, as Claude Code runs it, with HOME at a temporary folder and a `--require` shim in
// place of fetch that logs every request and serves a feed signed with the test token. Nothing reads or writes this
// computer's own ~/.claude, and nothing reaches the network.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "worklog-hook.js");
const TOKEN = "test-tracker-token-profile";
const API_BASE = "https://ow.test.invalid";

// Two profiles: what Rob switches between.
const A = { account: "dcfd6931-8175-4461-83ba-ecfbbfd119ec", org: "b5cbd40d-0a91-40e6-b2c9-ca0e5832b7dc" };
const B = { account: "82e0f6f4-f3e7-474a-9236-08821d43b466", org: "243f8bf1-06ac-4040-85fc-4f34d895918a" };
const idOf = (p) => crypto.createHash("sha256").update(`${p.account}:${p.org}`).digest("hex").slice(0, 12);

const FETCH_SHIM = `
const fs = require("fs");
const fx = JSON.parse(fs.readFileSync(process.env.MM_TEST_FETCH_FIXTURES, "utf8"));
globalThis.fetch = async (url, init) => {
  const headers = {};
  const h = (init && init.headers) || {};
  for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k];
  const u = String(url);
  fs.appendFileSync(process.env.MM_TEST_FETCH_LOG, JSON.stringify({ url: u, method: (init && init.method) || "GET", headers, body: (init && init.body) || null }) + "\\n");
  if (u.endsWith("/api/ext/chip-feed")) {
    if (!fx.feed) return new Response(JSON.stringify({ serves: false }), { status: 200 });
    return new Response(JSON.stringify({ serves: true, payload: fx.feed, sig: fx.sig }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
`;

/** The hook's own canonical form: keys sorted at every level. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function makeRig() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mm-hook-profile-"));
  const home = path.join(base, "home");
  const work = path.join(base, "work");
  fs.mkdirSync(path.join(home, ".claude", "mm-hooks"), { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "mm-hooks", "consent.json"), JSON.stringify({ v: 2, allowlist: [work] }));
  const rig = {
    base,
    home,
    work,
    shim: path.join(base, "fetch-shim.cjs"),
    log: path.join(base, "fetch.log"),
    fixtures: path.join(base, "fixtures.json"),
  };
  fs.writeFileSync(rig.shim, FETCH_SHIM);
  fs.writeFileSync(rig.log, "");
  serve(rig, null);
  return rig;
}

function serve(rig, payload) {
  const sig = payload ? crypto.createHmac("sha256", TOKEN).update(canonicalJson(payload)).digest("hex") : "";
  fs.writeFileSync(rig.fixtures, JSON.stringify({ feed: payload, sig }));
}

/** Runs the hook once. `profile` sets both variables, one of them, or neither: never inherited from this machine. */
function runHook(rig, stdin, profile = {}) {
  const env = Object.assign({}, process.env, {
    HOME: rig.home,
    USERPROFILE: rig.home,
    NODE_OPTIONS: `--require ${rig.shim}`,
    MM_TRACKER_TOKEN: TOKEN,
    MM_TRACKER_API_BASE: API_BASE,
    MM_TEST_FETCH_LOG: rig.log,
    MM_TEST_FETCH_FIXTURES: rig.fixtures,
    CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
  });
  for (const k of ["CLAUDE_CONFIG_DIR", "NODE_TEST_CONTEXT", "CLAUDE_CODE_ACCOUNT_UUID", "CLAUDE_CODE_ORGANIZATION_UUID"]) delete env[k];
  if (profile.account) env.CLAUDE_CODE_ACCOUNT_UUID = profile.account;
  if (profile.org) env.CLAUDE_CODE_ORGANIZATION_UUID = profile.org;
  const run = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(stdin), cwd: rig.work, encoding: "utf8", env });
  assert.equal(run.status, 0, run.stderr);
  const out = String(run.stdout || "").trim();
  return out ? (JSON.parse(out).hookSpecificOutput || {}).additionalContext || "" : "";
}

const requests = (rig) => fs.readFileSync(rig.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const feedRequest = (rig) => requests(rig).find((r) => r.url.endsWith("/api/ext/chip-feed"));
const chipEvents = (rig) => requests(rig).filter((r) => r.url.endsWith("/api/ext/chip-event"));
const clearLog = (rig) => fs.writeFileSync(rig.log, "");

function feed(over = {}) {
  return Object.assign(
    {
      v: 1,
      member: { email: "rob@massmarket.ai", name: "Rob" },
      generated_at: new Date().toISOString(),
      ttl_seconds: 600,
      nonce: "n",
      mode: "pilot",
      candidates: [],
      held: [],
      top_ups: [],
      top_ups_stalled: [],
      claim_unverified: [],
      api_base_hint: API_BASE,
    },
    over,
  );
}

const START = { hook_event_name: "SessionStart", session_id: "P1" };
const HELD = [{ fingerprint: "client:x", last_event: "claimed", title: "X" }];
const GROUP = "client:acme-co";
const BRIEF = ["Acme Co — 1 open item", "", "- Wire the intake form", "", `Group fingerprint: \`${GROUP}\``].join("\n");
const CANDIDATE = { fingerprint: GROUP, chip_title: "Acme Co — 1 open item", mint_reason: "drip_head", brief: BRIEF, warm_thread_title: null };
const SPAWN = {
  hook_event_name: "PostToolUse",
  session_id: "P1",
  tool_name: "mcp__ccd_session__spawn_task",
  tool_input: { title: "Acme Co — 1 open item", prompt: BRIEF, tldr: "Work Acme" },
  tool_response: { task_id: "task_abcd1234", content: [{ type: "text", text: "created" }] },
};
const TOP_UP = {
  group_fingerprint: GROUP,
  client: "Acme Co",
  warm_thread_title: "Acme Co — working thread",
  claimed_at: "2026-10-29T15:00:00Z",
  new_members: [{ fingerprint: "ticket:1", title: "New item" }],
  attempt: 1,
  max_attempts: 3,
  urgency: "normal",
  note: "One new item for Acme Co.",
  fallback_chip_title: "Acme Co — 1 new item",
};

test("same profile: the feed pull names it, as the 12-hex hash", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  runHook(rig, START, A);
  assert.equal(feedRequest(rig).headers["x-mm-profile"], idOf(A));
  assert.match(idOf(A), /^[0-9a-f]{12}$/);
});

test("other profile: a switch sends the other profile's id, and the two never match", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  runHook(rig, START, A);
  clearLog(rig);
  runHook(rig, START, B);
  assert.equal(feedRequest(rig).headers["x-mm-profile"], idOf(B));
  assert.notEqual(idOf(A), idOf(B));
});

test("the raw account and organization ids never leave the computer", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  serve(rig, feed({ candidates: [CANDIDATE] }));
  runHook(rig, START, A);
  runHook(rig, SPAWN, A);
  const all = fs.readFileSync(rig.log, "utf8");
  assert.ok(all.length > 0);
  for (const raw of [A.account, A.org]) assert.equal(all.includes(raw), false, raw);
});

test("no profile id sent: neither variable, or only one, leaves the request as before", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  for (const profile of [{}, { account: A.account }, { org: A.org }]) {
    clearLog(rig);
    runHook(rig, START, profile);
    const req = feedRequest(rig);
    assert.ok(req, JSON.stringify(profile));
    assert.equal(req.headers["x-mm-profile"], undefined, JSON.stringify(profile));
  }
});

test("the delivered_chip ack carries the profile, and goes out as before without one", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  for (const [profile, expected] of [
    [A, idOf(A)],
    [{}, undefined],
  ]) {
    serve(rig, feed({ candidates: [CANDIDATE] }));
    fs.rmSync(path.join(rig.home, ".claude", "mm-hooks"), { recursive: true, force: true });
    fs.mkdirSync(path.join(rig.home, ".claude", "mm-hooks"), { recursive: true });
    fs.writeFileSync(path.join(rig.home, ".claude", "mm-hooks", "consent.json"), JSON.stringify({ v: 2, allowlist: [rig.work] }));
    runHook(rig, START, profile);
    clearLog(rig);
    runHook(rig, SPAWN, profile);
    const posts = chipEvents(rig);
    assert.equal(posts.length, 1);
    const body = JSON.parse(posts[0].body);
    assert.equal(body.event, "delivered_chip");
    assert.equal(body.task_fingerprint, GROUP);
    assert.equal(posts[0].headers["x-mm-profile"], expected);
  }
});

test("'already in flight' counts this profile's holds only when OW folded the pull for this profile", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  serve(rig, feed({ held: HELD, profile_scope: idOf(A) }));
  assert.ok(runHook(rig, START, A).includes("(1 task(s) already in flight in this Claude profile)."));
  const OLD = "(1 task(s) already in flight).";
  serve(rig, feed({ held: HELD, profile_scope: idOf(B) }));
  assert.ok(runHook(rig, START, A).includes(OLD), "a payload folded for another profile");
  serve(rig, feed({ held: HELD }));
  assert.ok(runHook(rig, START, A).includes(OLD), "a payload from an OW without migration 332");
  serve(rig, feed({ held: HELD, profile_scope: idOf(A) }));
  assert.ok(runHook(rig, START, {}).includes(OLD), "a session with no profile");
});

test("the warm-thread confirmation curl carries the profile only when the pull was folded for it", (t) => {
  const rig = makeRig();
  t.after(() => fs.rmSync(rig.base, { recursive: true, force: true }));
  const AUTH = '  -H "Authorization: Bearer $(cat ~/.claude/mm-hooks/token)" \\';
  serve(rig, feed({ top_ups: [TOP_UP], profile_scope: idOf(A) }));
  const ctx = runHook(rig, START, A);
  assert.ok(ctx.includes(`${AUTH}\n  -H "X-MM-Profile: ${idOf(A)}" \\\n`));
  for (const [payload, profile] of [
    [feed({ top_ups: [TOP_UP], profile_scope: idOf(A) }), {}],
    [feed({ top_ups: [TOP_UP] }), A],
    [feed({ top_ups: [TOP_UP], profile_scope: idOf(B) }), A],
  ]) {
    serve(rig, payload);
    const out = runHook(rig, START, profile);
    assert.ok(out.includes("delivered_warm_thread"));
    assert.equal(out.includes("X-MM-Profile"), false);
  }
});
