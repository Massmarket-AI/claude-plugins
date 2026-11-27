// node --test plugins/mm-hooks/scripts/rob-ask-gate.test.js
//
// rob-ask-gate.js denies a Discord post that tags Rob, and blocks once a turn that ends waiting on Rob with no ask
// filed. It never runs on Rob's machine, in unattended runs or in sdk runs, and fails open on every error.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "rob-ask-gate.js");
const ROB = "1053744158763925514";

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-rob-ask-gate-"));
  fs.mkdirSync(path.join(dir, ".claude", "mm-hooks"), { recursive: true });
  return dir;
}

function run(h, payload, extraEnv, raw) {
  const env = { ...process.env, MM_HOOK_HOME: h };
  for (const k of ["MM_UNATTENDED", "LANE2_RUN_ID", "MM_RUN_SESSION", "CLAUDE_CODE_ENTRYPOINT", "MM_GPT_DELEGATED"]) delete env[k];
  return spawnSync(process.execPath, [SCRIPT], {
    input: raw !== undefined ? raw : JSON.stringify(payload),
    encoding: "utf8",
    env: { ...env, ...(extraEnv || {}) },
  });
}

const bash = (command, cwd) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });
const silent = (r) => {
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
};
const denied = (r) => {
  assert.strictEqual(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.strictEqual(o.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.strictEqual(o.hookSpecificOutput.permissionDecision, "deny");
  assert.match(o.hookSpecificOutput.permissionDecisionReason, /^Massmarket rule: a builder's Claude never tags Rob in Discord\./);
  return o;
};

const CURL = (body) => `curl -X POST https://discord.com/api/v10/channels/123/messages -H 'Authorization: Bot x' ${body}`;

test("curl Discord post with the mention in -d is denied", () => {
  const o = denied(run(home(), bash(CURL(`-d '{"content":"<@${ROB}> blocked"}'`))));
  console.log("SAMPLE DENY:", JSON.stringify(o));
});

test("curl Discord post with the body in an @file is denied", () => {
  const h = home();
  fs.writeFileSync(path.join(h, "body.json"), `{"content":"<@${ROB}> please"}`);
  denied(run(h, bash(CURL("-d @body.json"), h)));
  denied(run(h, bash(CURL("--data-binary @body.json"), h)));
});

test("curl Discord post without the mention is silent", () => {
  silent(run(home(), bash(CURL(`-d '{"content":"FYI team"}'`))));
});

test("body file without the mention is silent; missing file is ignored", () => {
  const h = home();
  fs.writeFileSync(path.join(h, "ok.json"), `{"content":"hello"}`);
  silent(run(h, bash(CURL("-d @ok.json"), h)));
  silent(run(h, bash(CURL("-d @nope.json"), h)));
});

test("MCP discord send with the mention is denied", () => {
  denied(run(home(), { hook_event_name: "PreToolUse", tool_name: "mcp__discord__send_message", tool_input: { content: `<@${ROB}> hi` } }));
});

test("a non-Discord command mentioning the id is silent", () => {
  silent(run(home(), bash(`echo ${ROB}`)));
});

test("a /team-ask/file command containing the id is silent", () => {
  silent(run(home(), bash(`node mm-api.mjs ext POST /team-ask/file --discord-post '{"who":"${ROB}"}'`)));
});

test("Rob's machine is skipped (bridge-state member, rob-email file, control tower link)", () => {
  const cmd = bash(CURL(`-d '{"content":"<@${ROB}>"}'`));
  let h = home();
  fs.writeFileSync(path.join(h, ".claude", "mm-hooks", "bridge-state.json"), JSON.stringify({ member: "Rob@Massmarket.ai" }));
  silent(run(h, cmd));
  h = home();
  fs.mkdirSync(path.join(h, ".config", "massmarket"), { recursive: true });
  fs.writeFileSync(path.join(h, ".config", "massmarket", "rob-email"), "x");
  silent(run(h, cmd));
  h = home();
  const repo = path.join(h, "massmarket-ops-control-tower", "global-config");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "x");
  fs.symlinkSync(path.join(repo, "CLAUDE.md"), path.join(h, ".claude", "CLAUDE.md"));
  silent(run(h, cmd));
});

test("another member's bridge state still gets the gate", () => {
  const h = home();
  fs.writeFileSync(path.join(h, ".claude", "mm-hooks", "bridge-state.json"), JSON.stringify({ member: "nayan@massmarket.ai" }));
  denied(run(h, bash(CURL(`-d '{"content":"<@${ROB}>"}'`))));
});

test("unattended and sdk runs are skipped", () => {
  const cmd = bash(CURL(`-d '{"content":"<@${ROB}>"}'`));
  silent(run(home(), cmd, { MM_UNATTENDED: "1" }));
  silent(run(home(), cmd, { LANE2_RUN_ID: "x" }));
  silent(run(home(), cmd, { MM_RUN_SESSION: "x" }));
  silent(run(home(), cmd, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }));
  denied(run(home(), cmd, { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" }));
});

// ---- Stop ----

const stopP = (text, extra) => ({ hook_event_name: "Stop", last_assistant_message: text, ...(extra || {}) });

test("Stop: waiting on Rob with no ask filed is blocked", () => {
  const r = run(home(), stopP("I'm waiting on Rob's OK before moving the date."));
  assert.strictEqual(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.strictEqual(o.decision, "block");
  assert.match(o.reason, /^Massmarket rule: this turn ends waiting on Rob, but no ask to him was filed/);
  console.log("SAMPLE BLOCK:", JSON.stringify(o));
});

function transcript(h, withAsk) {
  const file = path.join(h, "t.jsonl");
  const lines = [{ type: "user", message: { role: "user", content: "go" } }];
  if (withAsk) {
    lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "node mm-api.mjs ext POST /team-ask/file --body x" } }] } });
    lines.push({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: '{"ok":true,"ask_id":"abc"}' }] } });
  }
  lines.push({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Filed; now waiting on Rob." }, { type: "tool_use", id: "tu2", name: "Bash", input: {} }] } });
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

test("Stop: a filed ask in the transcript is silent; without it, text from the transcript is blocked", () => {
  const h = home();
  silent(run(h, { hook_event_name: "Stop", transcript_path: transcript(h, true) }));
  const r = run(h, { hook_event_name: "Stop", transcript_path: transcript(h, false) });
  assert.strictEqual(JSON.parse(r.stdout).decision, "block");
});

test("Stop: an ask whose result has no ask_id does not count", () => {
  const h = home();
  const file = transcript(h, true);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("ask_id", "error"));
  assert.strictEqual(JSON.parse(run(h, { hook_event_name: "Stop", transcript_path: file }).stdout).decision, "block");
});

test("Stop: stop_hook_active, 'robust', and no pattern are silent", () => {
  const h = home();
  silent(run(h, stopP("waiting on Rob", { stop_hook_active: true })));
  silent(run(h, stopP("the code is robust and ready")));
  silent(run(h, stopP("All done. Tests pass.")));
  silent(run(h, { hook_event_name: "Stop" }));
});

test("malformed stdin and odd payloads exit 0 with no output", () => {
  const h = home();
  silent(run(h, null, {}, "not json {"));
  silent(run(h, null, {}, ""));
  silent(run(h, null, {}, "[1,2]"));
  silent(run(h, { hook_event_name: "Nope" }));
});

test("a read-only Discord MCP tool naming Rob's id is never denied", () => {
  const h = home();
  silent(run(h, { hook_event_name: "PreToolUse", tool_name: "mcp__discord__read_messages", tool_input: { author_id: ROB } }));
  silent(run(h, { hook_event_name: "PreToolUse", tool_name: "mcp__discord__search_messages", tool_input: { query: `<@${ROB}>` } }));
  denied(run(h, { hook_event_name: "PreToolUse", tool_name: "mcp__discord__send_message", tool_input: { content: `<@${ROB}> hi` } }));
});

// ---------- Codex (GPT) ----------
// Shapes measured on Codex 0.155.1 (2026-11-20 and 2026-11-27): shell calls arrive as tool_name Bash; the rollout
// holds custom_tool_call "exec" items (code mode) or function_call items, each answered by an *_output with its call_id.

const rollout = (h, items) => {
  const file = path.join(h, "rollout.jsonl");
  fs.writeFileSync(file, items.map((p) => JSON.stringify({ timestamp: "2026-11-27T00:00:00Z", type: "response_item", payload: p })).join("\n") + "\n");
  return file;
};
const codexStop = (file, last, active) => ({
  hook_event_name: "Stop",
  session_id: "s",
  turn_id: "t",
  transcript_path: file,
  stop_hook_active: Boolean(active),
  last_assistant_message: last,
});

test("Codex: a Discord post tagging Rob from a code-mode shell call is denied", () => {
  denied(run(home(), bash(CURL(`-d '{"content":"<@${ROB}> blocked"}'`))));
});

test("Codex: Stop waiting on Rob with no ask in the rollout is blocked, once", () => {
  const h = home();
  const file = rollout(h, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Working on it." }] }]);
  const r = run(h, codexStop(file, "Paused: waiting on Rob's approval for the date move."));
  assert.strictEqual(JSON.parse(r.stdout).decision, "block");
  silent(run(h, codexStop(file, "Paused: waiting on Rob's approval for the date move.", true)));
});

test("Codex: Stop with a filed ask (custom_tool_call exec) is silent", () => {
  const h = home();
  const file = rollout(h, [
    { type: "custom_tool_call", call_id: "call_1", name: "exec", input: "text(await tools.exec_command({cmd:\"node mm-api.mjs ext POST /team-ask/file --body '{}'\"}))" },
    { type: "custom_tool_call_output", call_id: "call_1", output: [{ type: "input_text", text: '{"ok":true,"ask_id":"abc"}' }] },
  ]);
  silent(run(h, codexStop(file, "Filed; waiting on Rob's answer.")));
});

test("Codex: Stop with a filed ask (function_call) answered covered_by_ruling is silent", () => {
  const h = home();
  const file = rollout(h, [
    { type: "function_call", call_id: "call_2", name: "shell", arguments: JSON.stringify({ command: ["bash", "-lc", "node mm-api.mjs ext POST /team-ask/file"] }) },
    { type: "function_call_output", call_id: "call_2", output: '{"error":"covered_by_ruling"}' },
  ]);
  silent(run(h, codexStop(file, "Rob already ruled; waiting on Rob is not needed but noting it.")));
});

test("Codex: a filed-ask call whose output has no ask id still blocks", () => {
  const h = home();
  const file = rollout(h, [
    { type: "custom_tool_call", call_id: "call_3", name: "exec", input: "tools.exec_command({cmd:'node mm-api.mjs ext POST /team-ask/file'})" },
    { type: "custom_tool_call_output", call_id: "call_3", output: '{"error":"ask_incomplete"}' },
  ]);
  assert.strictEqual(JSON.parse(run(h, codexStop(file, "Blocked on Rob for the go.")).stdout).decision, "block");
});

test("Codex: with no last_assistant_message the rollout's last assistant text is read", () => {
  const h = home();
  const file = rollout(h, [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "This needs Rob's approval before I go on." }] }]);
  const p = codexStop(file, "");
  delete p.last_assistant_message;
  assert.strictEqual(JSON.parse(run(h, p).stdout).decision, "block");
});

test("Codex: a run Claude delegated to GPT (MM_GPT_DELEGATED=1) is skipped", () => {
  silent(run(home(), bash(CURL(`-d '{"content":"<@${ROB}> blocked"}'`)), { MM_GPT_DELEGATED: "1" }));
});

test("test window: an open window runs the gate on Rob's machine; an expired or over-long one does not", () => {
  const h = home();
  fs.mkdirSync(path.join(h, ".config", "massmarket"), { recursive: true });
  fs.writeFileSync(path.join(h, ".config", "massmarket", "rob-email"), "x");
  const post = bash(CURL(`-d '{"content":"<@${ROB}> blocked"}'`));
  silent(run(h, post));
  const f = path.join(h, ".claude", "mm-hooks", "rob-ask-gate-test-until");
  fs.writeFileSync(f, new Date(Date.now() + 30 * 60 * 1000).toISOString());
  denied(run(h, post));
  fs.writeFileSync(f, new Date(Date.now() - 1000).toISOString());
  silent(run(h, post));
  fs.writeFileSync(f, new Date(Date.now() + 3 * 3600 * 1000).toISOString());
  silent(run(h, post));
  fs.writeFileSync(f, new Date(Date.now() + 30 * 60 * 1000).toISOString());
  silent(run(h, post, { MM_UNATTENDED: "1" }));
});
