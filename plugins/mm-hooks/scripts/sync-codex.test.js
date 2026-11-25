// mm-hooks: tests for sync-codex.js and codex-gate.js.
//
//   node --test plugins/mm-hooks/scripts/sync-codex.test.js
//
// Every home, Codex folder, gate and Codex CLI here is fabricated in a temporary directory: MM_HOOK_HOME points the
// scripts at it, CODEX_HOME at its .codex, and MM_CODEX_BIN at a fake `codex app-server` that answers hooks/list and
// config/batchWrite the way Codex 0.155.1 does (keys `<hooks.json>:<event>:<group>:<handler>`, trust by hash).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const sc = require("./sync-codex.js");
const gate = require("./codex-gate.js");

const SCRIPTS = __dirname;
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

const FAKE_CODEX = `#!/usr/bin/env node
"use strict";
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const home = process.env.CODEX_HOME;
const file = path.join(home, "hooks.json");
const stateFile = path.join(home, "fake-trust.json");
const snake = (e) => e.replace(/[A-Z]/g, (c, i) => (i ? "_" : "") + c.toLowerCase());
const camel = (e) => e[0].toLowerCase() + e.slice(1);
const state = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (_) { return {}; } };
function list() {
  let doc = {};
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
  const st = state();
  const hooks = [];
  for (const [event, groups] of Object.entries(doc.hooks || {})) {
    groups.forEach((g, gi) => (g.hooks || []).forEach((h, hi) => {
      const key = file + ":" + snake(event) + ":" + gi + ":" + hi;
      const currentHash = "sha256:" + crypto.createHash("sha256").update(JSON.stringify([h.command, h.timeout, g.matcher || null])).digest("hex");
      const t = st[key] && st[key].trusted_hash;
      hooks.push({ key, eventName: camel(event), handlerType: "command", command: h.command, sourcePath: file, source: "user", enabled: true, isManaged: false, displayOrder: 0, timeoutSec: h.timeout, currentHash, trustStatus: t === currentHash ? "trusted" : t ? "modified" : "untrusted" });
    }));
  }
  return { data: [{ cwd: process.cwd(), hooks, errors: [], warnings: [] }] };
}
let buf = "";
process.stdin.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\\n")) !== -1) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id === undefined) continue;
    let result = {};
    if (m.method === "hooks/list") result = list();
    if (m.method === "config/batchWrite") {
      const st = state();
      for (const e of m.params.edits) if (e.keyPath === "hooks.state") Object.assign(st, e.value);
      fs.writeFileSync(stateFile, JSON.stringify(st));
      fs.appendFileSync(path.join(home, "fake-writes.log"), JSON.stringify(m.params) + "\\n");
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) + "\\n");
  }
});
`;

const ASK_GATE = `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const p=JSON.parse(s);const c=(p.tool_input&&p.tool_input.command)||"";
if(/discord\\.com/.test(c)){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:"Outbound send (discord-message)."+(p.agent_id?" agent":"")}}))}process.exit(0)})`;
const DENY_GATE = `let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const p=JSON.parse(s);const c=(p.tool_input&&p.tool_input.command)||"";
if(/mm-hooks\\/token/.test(c)){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"Blocked by the secret-read gate."}}))}process.exit(0)})`;
const BROKEN_GATE = `process.exit(0)`;

/** A fabricated home: ~/.claude/mm-hooks with a hook of `hookVersion` and the named gates, and ~/.codex. */
function machine({ hookVersion = "0.14.0", gates = { "send-gate": ASK_GATE, "secret-read-gate": DENY_GATE }, codex = true, hooksJson } = {}) {
  const home = tmp("mm-codex-home-");
  const hookDir = path.join(home, ".claude", "mm-hooks");
  fs.mkdirSync(hookDir, { recursive: true });
  if (hookVersion) fs.writeFileSync(path.join(hookDir, "worklog-hook.js"), `#!/usr/bin/env node\nconst HOOK_VERSION = "${hookVersion}";\n`);
  for (const [name, src] of Object.entries(gates)) fs.writeFileSync(path.join(hookDir, `${name}.js`), src);
  const codexHome = path.join(home, ".codex");
  if (codex) fs.mkdirSync(codexHome, { recursive: true });
  if (codex && hooksJson !== undefined) fs.writeFileSync(path.join(codexHome, "hooks.json"), typeof hooksJson === "string" ? hooksJson : JSON.stringify(hooksJson));
  const fake = path.join(home, "fake-codex");
  fs.writeFileSync(fake, FAKE_CODEX, { mode: 0o755 });
  return { home, hookDir, codexHome, fake };
}

function runSync(m) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, "sync-codex.js")], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { MM_HOOK_HOME: m.home, CODEX_HOME: m.codexHome, MM_CODEX_BIN: m.fake, HOME: m.home }),
    timeout: 30000,
  });
  const status = JSON.parse(fs.readFileSync(path.join(m.hookDir, "plugin-sync.json"), "utf8"));
  return { r, codex: status.codex, status };
}

const hooksOf = (m) => JSON.parse(fs.readFileSync(path.join(m.codexHome, "hooks.json"), "utf8")).hooks;
const commands = (hooks, event) => (hooks[event] || []).flatMap((g) => g.hooks.map((h) => h.command));

test("isOurs knows our two commands, on any platform, and nothing else", () => {
  assert.equal(sc.isOurs('node "/Users/a/.claude/mm-hooks/worklog-hook.js" --codex'), true);
  assert.equal(sc.isOurs('node "C:\\Users\\a\\.claude\\mm-hooks\\worklog-hook.js" --codex'), true);
  assert.equal(sc.isOurs('node "/Users/a/.claude/mm-hooks/codex/codex-gate.js" send-gate'), true);
  assert.equal(sc.isOurs('node "C:\\Users\\a\\.claude\\mm-hooks\\codex\\codex-gate.js" metered-key-gate'), true);
  assert.equal(sc.isOurs('node "/Users/a/.claude/mm-hooks/worklog-hook.js"'), false, "the Claude registration is not ours to touch");
  assert.equal(sc.isOurs("node /tmp/probe-hook.js PreToolUse"), false);
  assert.equal(sc.isOurs('node "/Users/a/tools/worklog-hook.js" --codex'), false);
});

test("installedHookVersion reads the version line, and an uninstalled stub or a missing file is none", () => {
  const d = tmp("mm-hookver-");
  const f = path.join(d, "worklog-hook.js");
  fs.writeFileSync(f, '#!/usr/bin/env node\n/** x */\nconst HOOK_VERSION = "0.14.0";\n');
  assert.deepEqual(sc.installedHookVersion(f), [0, 14, 0]);
  fs.writeFileSync(f, "// Massmarket worklog hook: uninstalled.\nprocess.exit(0);\n");
  assert.equal(sc.installedHookVersion(f), null);
  assert.equal(sc.installedHookVersion(path.join(d, "none.js")), null);
});

test("mergeHooks keeps every entry that is not ours, replaces ours, puts ours first, and is stable", () => {
  const mine = { matcher: "*", hooks: [{ type: "command", command: "node /x/my-own-hook.js", timeout: 5 }] };
  const oldOurs = { hooks: [{ type: "command", command: 'node "/h/.claude/mm-hooks/worklog-hook.js" --codex', timeout: 99 }] };
  const current = { description: "mine", hooks: { PostToolUse: [mine, oldOurs], Stop: [oldOurs] } };
  const entries = sc.desiredEntries({ worklog: true, gates: ["send-gate"] });
  const merged = sc.mergeHooks(current, entries);
  assert.equal(merged.description, "mine");
  assert.deepEqual(merged.hooks.PostToolUse[merged.hooks.PostToolUse.length - 1], mine);
  assert.ok(merged.hooks.PostToolUse[0].hooks[0].command.endsWith("--codex"));
  assert.equal(merged.hooks.Stop.length, 1);
  assert.equal(merged.hooks.Stop[0].hooks[0].timeout, 10);
  assert.deepEqual(sc.mergeHooks(merged, entries), merged, "a second merge changes nothing");
  const none = sc.mergeHooks(merged, []);
  assert.deepEqual(none.hooks, { PostToolUse: [mine] }, "with nothing to register only the person's own entries are left");
});

test("desiredEntries: the worklog hook on three events, each present gate on its own events", () => {
  const e = sc.desiredEntries({ worklog: true, gates: ["send-gate", "secret-read-gate", "repo-home-guard", "metered-key-gate"] });
  const by = (ev) => e.filter((x) => x.event === ev).map((x) => x.command.split(" ").pop());
  assert.deepEqual(by("SessionStart"), ["--codex"]);
  assert.deepEqual(by("Stop"), ["--codex"]);
  assert.deepEqual(by("PreToolUse"), ["send-gate", "secret-read-gate", "repo-home-guard"]);
  assert.deepEqual(by("PostToolUse"), ["--codex", "repo-home-guard"]);
  assert.deepEqual(by("UserPromptSubmit"), ["metered-key-gate"]);
  assert.ok(e.filter((x) => x.event === "PreToolUse").every((x) => x.matcher === "*"));
  assert.equal(sc.desiredEntries({ worklog: false, gates: [] }).length, 0);
});

test("sync: registers the hook and the gates, trusts exactly ours, and the self-test proves both gates stop", () => {
  const m = machine({ hooksJson: { hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "node /x/mine.js", timeout: 5 }] }] } } });
  const { r, codex } = runSync(m);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "a SessionStart step prints nothing");
  assert.equal(codex.action, "current", JSON.stringify(codex));
  assert.equal(codex.worklog, "registered");
  assert.deepEqual(codex.gates, ["send-gate", "secret-read-gate"]);
  assert.deepEqual(codex.selftest, { "send-gate": "pass", "secret-read-gate": "pass" });
  assert.equal(codex.trust.ok, true);
  assert.equal(codex.trust.ours, 5);
  const hooks = hooksOf(m);
  assert.deepEqual(commands(hooks, "PreToolUse").slice(-1), ["node /x/mine.js"]);
  assert.ok(fs.existsSync(path.join(m.hookDir, "codex", "codex-gate.js")));
  const writes = fs.readFileSync(path.join(m.codexHome, "fake-writes.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const trustedKeys = Object.keys(writes[0].edits[0].value);
  assert.equal(trustedKeys.length, 5);
  assert.ok(trustedKeys.every((k) => !k.includes(":pre_tool_use:3:")), "the person's own hook is never trusted by us");
  // Second run: nothing to write, nothing to trust.
  const again = runSync(m).codex;
  assert.equal(again.hooks_json, "current");
  assert.equal(again.trust.wrote, 0);
});

test("sync: an older worklog hook is not registered in Codex, the gates still are", () => {
  const m = machine({ hookVersion: "0.13.2" });
  const { codex } = runSync(m);
  assert.match(codex.worklog, /older than 0\.14\.0/);
  const hooks = hooksOf(m);
  assert.equal(hooks.SessionStart, undefined);
  assert.equal(commands(hooks, "PreToolUse").length, 2);
});

test("sync: a gate that lets the known-bad command through fails the self-test", () => {
  const m = machine({ gates: { "send-gate": BROKEN_GATE } });
  const { codex } = runSync(m);
  assert.equal(codex.action, "selftest-failed");
  assert.equal(codex.selftest["send-gate"], "FAIL(none)");
});

test("sync: a hooks.json it cannot read is left exactly as it is", () => {
  const m = machine({ hooksJson: "{ not json" });
  const { codex } = runSync(m);
  assert.equal(codex.action, "hooks-json-unreadable");
  assert.equal(fs.readFileSync(path.join(m.codexHome, "hooks.json"), "utf8"), "{ not json");
});

test("sync: no Codex on this computer means nothing is written there", () => {
  const m = machine({ codex: false });
  const { codex } = runSync(m);
  assert.equal(codex.action, "no-codex");
  assert.equal(fs.existsSync(m.codexHome), false);
});

test("codex-gate: ask becomes deny with the reason, deny stays deny, block passes, a bare allow is dropped", () => {
  const ask = gate.translate("send-gate", "PreToolUse", JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "Outbound send." } }));
  assert.equal(ask.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(ask.hookSpecificOutput.permissionDecisionReason.startsWith("Massmarket send gate (Codex): this step needs the person's yes"));
  assert.ok(ask.hookSpecificOutput.permissionDecisionReason.includes("Outbound send."));
  const deny = gate.translate("secret-read-gate", "PreToolUse", JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "" } }));
  assert.equal(deny.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(deny.hookSpecificOutput.permissionDecisionReason.length > 0, "Codex refuses a deny without a reason");
  assert.deepEqual(gate.translate("metered-key-gate", "UserPromptSubmit", JSON.stringify({ decision: "block", reason: "Metered." })), { decision: "block", reason: "Metered." });
  assert.equal(gate.translate("send-gate", "PreToolUse", JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } })), null);
  assert.equal(gate.translate("send-gate", "PreToolUse", ""), null);
  assert.equal(gate.translate("send-gate", "PreToolUse", "not json"), null);
});

test("codex-gate: the send gate judges a Codex worker like the main thread; the repo guard gets Codex output as stdout", () => {
  assert.equal(gate.payloadFor("send-gate", { agent_id: "w1", tool_input: {} }).agent_id, undefined);
  assert.equal(gate.payloadFor("secret-read-gate", { agent_id: "w1" }).agent_id, "w1");
  assert.deepEqual(gate.payloadFor("repo-home-guard", { hook_event_name: "PostToolUse", tool_response: "https://github.com/Massmarket-AI/x\n" }).tool_response, { stdout: "https://github.com/Massmarket-AI/x\n" });
});

test("codex-gate: a Codex signed in with an API key, or given CODEX_API_KEY, is a metered sign-in", () => {
  const d = tmp("mm-codex-auth-");
  const auth = (o) => fs.writeFileSync(path.join(d, "auth.json"), JSON.stringify(o));
  auth({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {} });
  assert.equal(gate.codexMetered({ CODEX_HOME: d }), false);
  auth({ auth_mode: "apikey", OPENAI_API_KEY: "x" });
  assert.equal(gate.codexMetered({ CODEX_HOME: d }), true);
  auth({ auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {} });
  assert.equal(gate.codexMetered({ CODEX_HOME: d, CODEX_API_KEY: "x" }), true);
  assert.equal(gate.codexMetered({ CODEX_HOME: path.join(d, "none") }), false);
});

test("codex-gate end to end: a real spawn of the wrapper against a fabricated ask gate denies, a harmless command prints nothing", () => {
  const m = machine();
  const run = (command, extra = {}) =>
    spawnSync(process.execPath, [path.join(SCRIPTS, "codex-gate.js"), "send-gate"], {
      input: JSON.stringify(Object.assign({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, session_id: "s", turn_id: "t" }, extra)),
      encoding: "utf8",
      env: Object.assign({}, process.env, { MM_HOOK_HOME: m.home }),
    });
  const bad = run("curl -X POST https://discord.com/api/v10/channels/1/messages", { agent_id: "worker-1" });
  const out = JSON.parse(bad.stdout);
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.ok(!out.hookSpecificOutput.permissionDecisionReason.includes(" agent"), "the gate saw no agent_id");
  assert.equal(run("git status").stdout, "");
  assert.equal(spawnSync(process.execPath, [path.join(SCRIPTS, "codex-gate.js"), "not-a-gate"], { input: "{}", encoding: "utf8" }).stdout, "");
});
