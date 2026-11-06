// node --test plugins/mm-hooks/scripts/skill-check.test.js
//
// skill-check.js hands PreToolUse to the installed worklog hook and never fails a tool call itself:
// no hook, the uninstall stub, or a hook that throws all exit 0 with nothing printed.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "skill-check.js");

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-skill-check-plugin-"));
  fs.mkdirSync(path.join(dir, ".claude", "mm-hooks"), { recursive: true });
  return dir;
}

function run(h, stdin) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: stdin || JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }),
    encoding: "utf8",
    env: { ...process.env, MM_HOOK_HOME: h },
  });
}

const hookFile = (h) => path.join(h, ".claude", "mm-hooks", "worklog-hook.js");

test("no installed hook: exit 0, nothing printed", () => {
  const h = home();
  const r = run(h);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
  assert.strictEqual(r.stderr, "");
});

test("the uninstall stub is never run", () => {
  const h = home();
  fs.writeFileSync(
    hookFile(h),
    "// Massmarket worklog hook: uninstalled.\nprocess.stdout.write('RAN'); // padding padding padding padding padding\n",
  );
  const r = run(h);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
});

test("an installed hook runs and its PreToolUse answer reaches Claude Code", () => {
  const h = home();
  fs.writeFileSync(
    hookFile(h),
    [
      "// a stand-in for the worklog hook, long enough to pass the size check ..........................",
      "let s = '';",
      "process.stdin.on('data', (d) => (s += d));",
      "process.stdin.on('end', () => {",
      "  const p = JSON.parse(s);",
      "  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: p.hook_event_name, permissionDecision: 'deny', permissionDecisionReason: 'load x' } }));",
      "});",
    ].join("\n"),
  );
  const r = run(h);
  assert.strictEqual(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, "deny");
});

test("a hook that throws on load is exit 0, nothing printed", () => {
  const h = home();
  fs.writeFileSync(hookFile(h), "// broken hook ......................................................................\nthrow new Error('boom');\n");
  const r = run(h);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, "");
});

test("hooks.json registers the check for PreToolUse with a timeout", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hooks", "hooks.json"), "utf8"));
  const pre = hooks.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1);
  const h = pre[0].hooks[0];
  assert.match(h.command, /skill-check\.js/);
  assert.ok(h.timeout > 0 && h.timeout <= 15);
  assert.match(pre[0].matcher, /Bash/);
  assert.match(pre[0].matcher, /mcp__/);
});
