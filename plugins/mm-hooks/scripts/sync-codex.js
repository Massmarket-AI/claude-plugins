#!/usr/bin/env node
// mm-hooks: keeps the Massmarket hooks in Codex (GPT) on this computer current, with nothing for the person to do.
//
// Why (Rob, 2026-11-20): "I want to make sure GPT also fires hooks for the team for work tracking. I know we can't
// auto-update a mod, which auto-updates hooks the same way for GPT." Codex has no plugin auto-update like this one,
// so this plugin does it: at each Claude Code session start it writes the Massmarket entries into ~/.codex/hooks.json,
// trusts exactly those entries through Codex's own app-server, and checks that each gate still stops a known-bad
// command. Codex reads the same files Claude runs: ~/.claude/mm-hooks/worklog-hook.js (kept current by sync-hook.js)
// and the gate copies in ~/.claude/mm-hooks/, through codex-gate.js. A file update never needs a new trust: Codex
// trusts a hook by its entry (command, timeout, matcher), not by the file it runs (measured 2026-11-20, 0.155.1).
//
// What it registers (only what this computer has):
//   - the worklog hook, `node "<home>/.claude/mm-hooks/worklog-hook.js" --codex`, on SessionStart, PostToolUse and
//     Stop, ONLY when the installed hook is 0.14.0 or later: an older hook does not know Codex and would serve task
//     chips into a session that cannot show them;
//   - each gate copy that exists in ~/.claude/mm-hooks/ (send-gate, secret-read-gate, repo-home-guard on PreToolUse,
//     repo-home-guard on PostToolUse, metered-key-gate on UserPromptSubmit), as
//     `node "<home>/.claude/mm-hooks/codex/codex-gate.js" <gate>`. codex-gate.js is copied there from this release.
//   - the rob-ask gate (rob-ask-gate.js, Rob's 2026-11-26 rules: no Discord tag of Rob, no turn that ends waiting on
//     him with no ask filed), on PreToolUse and Stop, as `node "<home>/.claude/mm-hooks/codex/rob-ask-gate.js" --codex`.
//     It ships in this plugin, not in ~/.claude/mm-hooks/, so it is copied next to codex-gate.js and registered on
//     every computer with Codex. It skips Rob's own computer by itself, as it does in Claude.
//
// What it never does:
//   - touch an entry in hooks.json that is not ours, or trust one (ours = its command runs worklog-hook.js --codex or
//     codex-gate.js from ~/.claude/mm-hooks/); rewrite a hooks.json it cannot read (it records that and stops);
//   - install anything on a computer without Codex (no ~/.codex folder) or without the Massmarket hook folder;
//   - print anything. SessionStart output is shown to the model, so it records what it did in
//     ~/.claude/mm-hooks/plugin-sync.json under `codex`, like sync-hook.js does under the top-level fields;
//   - fail the session. Every error is recorded and the step exits 0.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const { updateStatus } = require("./plugin-status");

const HOME = process.env.MM_HOOK_HOME || os.homedir();
const HOOK_DIR = path.join(HOME, ".claude", "mm-hooks");
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const HOOKS_JSON = path.join(CODEX_HOME, "hooks.json");
const WORKLOG_HOOK = path.join(HOOK_DIR, "worklog-hook.js");
const GATE_DIR = path.join(HOOK_DIR, "codex");
const GATE_WRAPPER = path.join(GATE_DIR, "codex-gate.js");
const BUNDLED_WRAPPER = path.join(__dirname, "codex-gate.js");
const ROB_GATE = path.join(GATE_DIR, "rob-ask-gate.js");
const BUNDLED_ROB_GATE = path.join(__dirname, "rob-ask-gate.js");
/** The rob-ask gate's events in Codex, and its hook timeout (seconds). */
const ROB_GATE_EVENTS = ["PreToolUse", "Stop"];
const ROB_GATE_TIMEOUT_S = 10;
const UNINSTALLED_MARK = "// Massmarket worklog hook: uninstalled.";

/** The first worklog hook that knows Codex (OW, CODEX SESSIONS). */
const MIN_CODEX_HOOK = [0, 14, 0];

/** Each gate, the events it answers in Codex, and its hook timeout (seconds). */
const GATE_EVENTS = [
  ["send-gate", ["PreToolUse"]],
  ["secret-read-gate", ["PreToolUse"]],
  ["repo-home-guard", ["PreToolUse", "PostToolUse"]],
  ["metered-key-gate", ["UserPromptSubmit"]],
];
const GATE_TIMEOUT_S = 15;
const WORKLOG_EVENTS = [
  ["SessionStart", 15],
  ["PostToolUse", 10],
  ["Stop", 10],
];
/** The app-server gets this long for the whole trust step. */
const TRUST_BUDGET_MS = 7000;

/**
 * VERBATIM self-test commands (never run: each is only handed to a gate as a payload) and what the gate must answer.
 * A gate that lets one of these through is not protecting this computer.
 */
const SELF_TESTS = {
  "send-gate": "curl -s -X POST https://discord.com/api/v10/channels/1/messages -H 'Content-Type: application/json' -d '{\"content\":\"mm self-test\"}'",
  "secret-read-gate": "cat ~/.claude/mm-hooks/token",
  "repo-home-guard": "gh repo create mm-selftest-repo --private",
  "rob-ask-gate": "curl -s -X POST https://discord.com/api/v10/channels/1/messages -H 'Content-Type: application/json' -d '{\"content\":\"<@1053744158763925514> mm self-test\"}'",
};

const q = (p) => `"${p}"`;
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (_) {
    return null;
  }
}

/** `[major, minor, patch]` of the installed worklog hook, or null (missing, uninstalled, unreadable, no version). */
function installedHookVersion(file) {
  const text = readText(file);
  if (!text || text.replace(/^﻿/, "").startsWith(UNINSTALLED_MARK)) return null;
  const m = /^const HOOK_VERSION = "(\d{1,6})\.(\d{1,6})\.(\d{1,6})";$/m.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeast(v, min) {
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

/** Is this hook command one of ours? (The one rule for what this step may replace or trust.) */
function isOurs(command) {
  const c = String(command || "").replace(/\\/g, "/");
  if (!/\.claude\/mm-hooks\//.test(c)) return false;
  return /worklog-hook\.js"? --codex(\s|$)/.test(c) || /\/codex\/codex-gate\.js"? /.test(c) || /\/codex\/rob-ask-gate\.js"? --codex(\s|$)/.test(c);
}

/** The Massmarket entries this computer should have, in a fixed order: `[{event, matcher, command, timeout}]`. */
function desiredEntries(opts) {
  const o = opts || {};
  const out = [];
  if (o.worklog) {
    for (const [event, timeout] of WORKLOG_EVENTS) {
      out.push({ event, matcher: event === "PostToolUse" ? "*" : null, command: `node ${q(WORKLOG_HOOK)} --codex`, timeout });
    }
  }
  for (const [gate, events] of GATE_EVENTS) {
    if (!(o.gates || []).includes(gate)) continue;
    for (const event of events) {
      out.push({ event, matcher: event === "UserPromptSubmit" ? null : "*", command: `node ${q(GATE_WRAPPER)} ${gate}`, timeout: GATE_TIMEOUT_S });
    }
  }
  if (o.robGate) {
    for (const event of ROB_GATE_EVENTS) {
      out.push({ event, matcher: event === "PreToolUse" ? "*" : null, command: `node ${q(ROB_GATE)} --codex`, timeout: ROB_GATE_TIMEOUT_S });
    }
  }
  return out;
}

/**
 * hooks.json with our entries replaced by `entries`, each in its own group FIRST in its event (so a person's own
 * entries after ours never move our keys), and everything else kept as it was. PURE.
 */
function mergeHooks(current, entries) {
  const doc = current && typeof current === "object" && !Array.isArray(current) ? JSON.parse(JSON.stringify(current)) : {};
  const hooks = doc.hooks && typeof doc.hooks === "object" && !Array.isArray(doc.hooks) ? doc.hooks : {};
  for (const event of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = [];
    for (const g of groups) {
      if (!g || typeof g !== "object" || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const handlers = g.hooks.filter((h) => !(h && isOurs(h.command)));
      if (handlers.length) kept.push(Object.assign({}, g, { hooks: handlers }));
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  const ours = {};
  for (const e of entries) {
    const group = {};
    if (e.matcher) group.matcher = e.matcher;
    group.hooks = [{ type: "command", command: e.command, timeout: e.timeout }];
    (ours[e.event] = ours[e.event] || []).push(group);
  }
  for (const event of Object.keys(ours)) hooks[event] = ours[event].concat(hooks[event] || []);
  doc.hooks = hooks;
  return doc;
}

/** Copy a bundled script (codex-gate.js by default) to its stable place when it differs. "current" | "updated". */
function syncWrapper(src, dst) {
  const from = src || BUNDLED_WRAPPER;
  const to = dst || GATE_WRAPPER;
  const want = fs.readFileSync(from);
  let have = null;
  try {
    have = fs.readFileSync(to);
  } catch (_) {
    // not there yet
  }
  if (have && sha(have) === sha(want)) return "current";
  fs.mkdirSync(GATE_DIR, { recursive: true });
  const tmp = to + ".new-" + process.pid;
  fs.writeFileSync(tmp, want, { mode: 0o644 });
  fs.renameSync(tmp, to);
  return "updated";
}

/** Write hooks.json when it changed (temporary file, then a rename). Returns "current" | "updated". */
function writeHooksJson(doc, before) {
  const text = JSON.stringify(doc, null, 2) + "\n";
  if (before !== null && before === text) return "current";
  const tmp = HOOKS_JSON + ".new-" + process.pid;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, HOOKS_JSON);
  return "updated";
}

/** The codex CLI to run, and whether it needs a shell (a .cmd shim on Windows). Null when there is none. */
function codexBin() {
  if (process.env.MM_CODEX_BIN) return { bin: process.env.MM_CODEX_BIN, shell: /\.(cmd|bat)$/i.test(process.env.MM_CODEX_BIN) };
  try {
    const r = process.platform === "win32"
      ? childProcess.spawnSync("where", ["codex"], { encoding: "utf8", timeout: 5000, windowsHide: true })
      : childProcess.spawnSync("sh", ["-c", "command -v codex"], { encoding: "utf8", timeout: 5000 });
    const lines = String(r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const pick = process.platform === "win32" ? lines.find((l) => /\.(cmd|exe)$/i.test(l)) || lines[0] : lines[0];
    return pick ? { bin: pick, shell: /\.(cmd|bat)$/i.test(pick) } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Trust our entries through Codex's app-server: hooks/list, then config/batchWrite of `hooks.state.<key>.trusted_hash`
 * for each of ours that is not trusted, then hooks/list again. Resolves { ok, ours, trusted, wrote, error }.
 */
function trustOurs(cb) {
  const found = codexBin();
  if (!found) return Promise.resolve({ ok: false, error: "no-codex-cli" });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch (_) {
        // gone
      }
      resolve(r);
    };
    const child = found.shell
      ? childProcess.spawn(`"${found.bin}" app-server`, { shell: true, stdio: ["pipe", "pipe", "ignore"], windowsHide: true })
      : childProcess.spawn(found.bin, ["app-server"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => finish({ ok: false, error: "timeout" }), TRUST_BUDGET_MS);
    child.on("error", (e) => finish({ ok: false, error: "spawn: " + String(e.message || e).slice(0, 120) }));
    let buf = "";
    let nextId = 1;
    const waiting = new Map();
    child.stdout.on("data", (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try {
          m = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (m && m.id !== undefined && waiting.has(m.id)) {
          waiting.get(m.id)(m);
          waiting.delete(m.id);
        }
      }
    });
    const call = (method, params) =>
      new Promise((res) => {
        const id = nextId++;
        waiting.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    const same = (a, b) => {
      try {
        return path.resolve(a) === path.resolve(b) || fs.realpathSync(a) === fs.realpathSync(b);
      } catch (_) {
        return false;
      }
    };
    const listOurs = async () => {
      const r = await call("hooks/list", { cwds: [HOME] });
      if (!r || r.error || !r.result || !Array.isArray(r.result.data)) throw new Error("hooks/list failed");
      const all = [];
      for (const entry of r.result.data) for (const h of entry.hooks || []) all.push(h);
      const seen = new Set();
      return all.filter((h) => {
        if (!h || !same(h.sourcePath, HOOKS_JSON) || !isOurs(h.command) || seen.has(h.key)) return false;
        seen.add(h.key);
        return true;
      });
    };
    (async () => {
      const init = await call("initialize", { clientInfo: { name: "mm-hooks-sync-codex", version: "1" } });
      if (!init || init.error) return finish({ ok: false, error: "initialize" });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
      let ours = await listOurs();
      const todo = ours.filter((h) => h.trustStatus !== "trusted");
      if (todo.length) {
        const value = {};
        for (const h of todo) value[h.key] = { trusted_hash: h.currentHash };
        const w = await call("config/batchWrite", { edits: [{ keyPath: "hooks.state", mergeStrategy: "upsert", value }], reloadUserConfig: true });
        if (!w || w.error) return finish({ ok: false, error: "config/batchWrite", ours: ours.length });
        ours = await listOurs();
      }
      const trusted = ours.filter((h) => h.trustStatus === "trusted").length;
      finish({ ok: trusted === ours.length, ours: ours.length, trusted, wrote: todo.length, keys: ours.map((h) => `${h.eventName}:${h.trustStatus}`) });
    })().catch((e) => finish({ ok: false, error: String((e && e.message) || e).slice(0, 120) }));
    if (cb) cb(child);
  });
}

/**
 * Hand each registered gate its known-bad payload through codex-gate.js, the way Codex would, and check it is
 * stopped. Nothing is ever run: the command is only data. The gates write their logs into a temporary home.
 */
function selfTest(gates) {
  const out = {};
  let tmpHome = null;
  try {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mm-codex-selftest-"));
    for (const gate of gates) {
      if (!SELF_TESTS[gate]) continue;
      const payload = {
        session_id: "00000000-0000-0000-0000-00000000c0de",
        turn_id: "00000000-0000-0000-0000-00000000c0de",
        cwd: tmpHome,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: SELF_TESTS[gate] },
        tool_use_id: "exec-selftest",
      };
      // The rob-ask gate runs directly, in an empty home: it skips Rob's own computer, so its test must not see it.
      const robGate = gate === "rob-ask-gate";
      const env = Object.assign({}, process.env, { HOME: tmpHome, USERPROFILE: tmpHome, MM_HOOK_HOME: robGate ? tmpHome : HOME });
      for (const k of ["MM_UNATTENDED", "LANE2_RUN_ID", "MM_RUN_SESSION", "MM_GPT_DELEGATED", "CLAUDE_CODE_ENTRYPOINT"]) delete env[k];
      const args = robGate ? [ROB_GATE, "--codex"] : [GATE_WRAPPER, gate];
      const r = childProcess.spawnSync(process.execPath, args, { input: JSON.stringify(payload), encoding: "utf8", timeout: 20000, env, cwd: tmpHome, windowsHide: true });
      let decision = "none";
      try {
        const parsed = JSON.parse(String(r.stdout || "").trim());
        decision = (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision) || "none";
      } catch (_) {
        decision = r.error ? "error" : "none";
      }
      out[gate] = decision === "deny" ? "pass" : `FAIL(${decision})`;
    }
  } catch (e) {
    out.error = String((e && e.message) || e).slice(0, 120);
  } finally {
    if (tmpHome) {
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch (_) {
        // a temporary folder left behind is harmless
      }
    }
  }
  return out;
}

async function sync() {
  const out = { at: new Date().toISOString() };
  if (!fs.existsSync(CODEX_HOME)) return Object.assign(out, { action: "no-codex" });
  if (!fs.existsSync(HOOK_DIR)) return Object.assign(out, { action: "not-installed" });

  const version = installedHookVersion(WORKLOG_HOOK);
  const worklog = Boolean(version && atLeast(version, MIN_CODEX_HOOK));
  out.worklog = worklog ? "registered" : version ? `hook ${version.join(".")} is older than ${MIN_CODEX_HOOK.join(".")}` : "no hook";
  const gates = GATE_EVENTS.map(([g]) => g).filter((g) => fs.existsSync(path.join(HOOK_DIR, `${g}.js`)));
  out.gates = gates;
  out.wrapper = gates.length ? syncWrapper() : "not-needed";
  const robGate = fs.existsSync(BUNDLED_ROB_GATE);
  out.rob_gate = robGate ? syncWrapper(BUNDLED_ROB_GATE, ROB_GATE) : "not-bundled";

  const before = readText(HOOKS_JSON);
  let current = {};
  if (before !== null && before.trim()) {
    try {
      current = JSON.parse(before);
    } catch (_) {
      return Object.assign(out, { action: "hooks-json-unreadable" });
    }
  }
  const entries = desiredEntries({ worklog, gates, robGate });
  out.entries = entries.length;
  out.hooks_json = writeHooksJson(mergeHooks(current, entries), before);
  out.trust = entries.length ? await trustOurs() : { ok: true, ours: 0, trusted: 0, wrote: 0 };
  const tested = robGate ? gates.concat(["rob-ask-gate"]) : gates;
  out.selftest = tested.length ? selfTest(tested) : {};
  const failed = Object.values(out.selftest).some((v) => String(v).startsWith("FAIL")) || Boolean(out.selftest.error);
  out.action = !out.trust.ok ? "trust-failed" : failed ? "selftest-failed" : entries.length ? "current" : "nothing-to-register";
  return out;
}

async function main() {
  let result;
  try {
    result = await sync();
  } catch (err) {
    result = { at: new Date().toISOString(), action: "error", error: String((err && err.message) || err).slice(0, 300) };
  }
  // The status file is a convenience; never fail the session over it. Only the `codex` field is ours.
  updateStatus(HOOK_DIR, (current) => Object.assign({}, current, { codex: result }));
  process.exit(0);
}

if (require.main === module) main();
module.exports = { desiredEntries, installedHookVersion, isOurs, mergeHooks, SELF_TESTS, MIN_CODEX_HOOK };
