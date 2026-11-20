#!/usr/bin/env node
// mm-hooks: runs one Massmarket gate for Codex (GPT) and turns its answer into one Codex acts on.
//
// Why (Rob, 2026-11-20): "There may be other things besides work tracking that we do with our hooks in Claude, and I
// want to make sure when the team uses the GPT CLI... everything reports properly." The gates in ~/.claude/mm-hooks/
// (send gate, secret-read gate, repo home guard, metered-key gate) only ever ran for Claude Code. sync-codex.js
// registers this file in ~/.codex/hooks.json, once per gate the computer has, as `node "<this file>" <gate>`.
//
// What it does: hands Codex's payload, unchanged in shape, to ~/.claude/mm-hooks/<gate>.js, and reads the answer.
//   - `deny` stays `deny` (with a reason: Codex 0.155 refuses a deny that has none).
//   - ⛔ `ask` becomes `deny`. Codex ignores `ask`: the command runs, with no prompt and no warning (measured on
//     Codex 0.144.6 on 2026-09-17 and again on 0.155.1 on 2026-11-20). So a step the gate would ask the person about
//     is stopped, and the reason tells the model to show the person the exact command and leave the running of it to
//     them. The model can never clear a gate on its own.
//   - a UserPromptSubmit `block` and any additionalContext pass through as they are; a bare `allow` is dropped (Codex
//     0.155 does not accept one).
//   - for the send gate, an `agent_id` is taken off the payload first. The send gate passes a Claude sub-agent's
//     "would have asked" commands, because nobody could answer a prompt there; in Codex every ask is a deny, so a
//     worker is judged like the main thread.
//   - for the repo home guard's PostToolUse, Codex's output string is handed over as `{ stdout }`, the shape the
//     guard reads, so it can give the teams write on a repo GPT created in the org.
//   - the metered-key gate's check runs as it does for Claude, and one more for Codex itself: a Codex signed in with
//     an OpenAI API key (or given CODEX_API_KEY) bills metered dollars, which the team never uses (Rob, 2026-11-11:
//     "never an OpenAI API key"). That prompt is blocked, with the fix.
//
// What it never does:
//   - fail a tool call or a prompt over its own error: any error is exit 0, no output (the gates fail open the same
//     way; sync-codex.js's self-test is what proves each gate still stops a known-bad command);
//   - run a gate that is not installed, or anything but `<home>/.claude/mm-hooks/<gate>.js`.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

const HOME = process.env.MM_HOOK_HOME || os.homedir();
const HOOK_DIR = path.join(HOME, ".claude", "mm-hooks");
const LOG = path.join(HOOK_DIR, "codex-gate.log");

/** The gates this wrapper runs, by the name sync-codex.js passes, with the words a reason uses for each. */
const GATES = {
  "send-gate": "send gate",
  "secret-read-gate": "secret-read gate",
  "repo-home-guard": "repo home guard",
  "metered-key-gate": "metered-key gate",
};

/** A gate gets this long; sync-codex.js gives the hook 15 s in hooks.json. */
const GATE_TIMEOUT_MS = 12000;

/**
 * VERBATIM (Opus, 2026-11-20). What the model reads when a step the gate would ask about is stopped. `{gate}` is the
 * gate's name and `{reason}` the gate's own words.
 */
const ASK_AS_DENY =
  "Massmarket {gate} (Codex): this step needs the person's yes, and Codex cannot ask for it, so it was stopped. " +
  "{reason}\n" +
  "To go ahead: show the person the exact command, and for a message its full text, recipients and mentions, in chat. " +
  "After their go, the person runs it themselves in their own terminal. Do not run it again yourself.";

/** VERBATIM (Opus, 2026-11-20). The Codex-only metered check's reason. */
const CODEX_METERED_REASON =
  "Massmarket metered-key gate (Codex): this Codex session would bill a metered OpenAI API key, and the team never " +
  "uses one. Nothing was sent.\n" +
  "Fix: run `codex logout`, then `codex login --device-auth` and sign in with the team ChatGPT plan " +
  "(support@massmarket.ai). Start Codex without CODEX_API_KEY in its environment.";

function log(line) {
  try {
    if (!fs.existsSync(HOOK_DIR)) return;
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch (_) {
    // logging never blocks
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

function emit(obj) {
  const text = JSON.stringify(obj);
  setTimeout(() => process.exit(0), 2000).unref();
  process.stdout.write(text, () => process.exit(0));
}

/** Codex's own metered sign-in: CODEX_API_KEY in the environment, or an API-key login in auth.json. Never throws. */
function codexMetered(env) {
  try {
    if (env.CODEX_API_KEY) return true;
    const codexHome = env.CODEX_HOME || path.join(HOME, ".codex");
    const auth = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8"));
    if (!auth || typeof auth !== "object") return false;
    if (typeof auth.auth_mode === "string") return auth.auth_mode.toLowerCase() === "apikey";
    return typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY !== "" && !auth.tokens;
  } catch (_) {
    return false;
  }
}

/** The payload this gate is handed. Never throws. */
function payloadFor(gate, payload) {
  const p = Object.assign({}, payload);
  if (gate === "send-gate") delete p.agent_id;
  if (gate === "repo-home-guard" && p.hook_event_name === "PostToolUse" && typeof p.tool_response === "string") {
    p.tool_response = { stdout: p.tool_response };
  }
  return p;
}

/** Codex's answer for what the gate printed, or null for none. */
function translate(gate, event, out) {
  let parsed = null;
  try {
    parsed = out && out.trim() ? JSON.parse(out.trim()) : null;
  } catch (_) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.decision === "block") {
    return { decision: "block", reason: String(parsed.reason || `Massmarket ${GATES[gate]} stopped this prompt.`) };
  }
  const h = parsed.hookSpecificOutput;
  if (!h || typeof h !== "object") return null;
  const decision = h.permissionDecision;
  const reason = typeof h.permissionDecisionReason === "string" && h.permissionDecisionReason.trim()
    ? h.permissionDecisionReason.trim()
    : `Massmarket ${GATES[gate]} stopped this step.`;
  if (decision === "deny") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  }
  if (decision === "ask") {
    const words = ASK_AS_DENY.replace("{gate}", GATES[gate]).replace("{reason}", reason);
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: words } };
  }
  if (typeof h.additionalContext === "string" && h.additionalContext) {
    return { hookSpecificOutput: { hookEventName: h.hookEventName || event, additionalContext: h.additionalContext } };
  }
  return null;
}

function main() {
  const gate = process.argv[2];
  if (!Object.prototype.hasOwnProperty.call(GATES, gate)) process.exit(0);
  const raw = readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw) || {};
  } catch (_) {
    process.exit(0);
  }
  const event = payload.hook_event_name || "";

  if (gate === "metered-key-gate" && event === "UserPromptSubmit" && codexMetered(process.env)) {
    log("BLOCK codex-metered-sign-in");
    return emit({ decision: "block", reason: CODEX_METERED_REASON });
  }

  const file = path.join(HOOK_DIR, `${gate}.js`);
  if (!fs.existsSync(file)) process.exit(0);
  const r = spawnSync(process.execPath, [file], {
    input: JSON.stringify(payloadFor(gate, payload)),
    encoding: "utf8",
    timeout: GATE_TIMEOUT_MS,
    env: process.env,
    windowsHide: true,
  });
  if (r.error) {
    log(`ERROR fail-open ${gate} ${event}: ${String(r.error.message || r.error).slice(0, 200)}`);
    process.exit(0);
  }
  const answer = translate(gate, event, r.stdout || "");
  if (!answer) process.exit(0);
  if (answer.hookSpecificOutput && answer.hookSpecificOutput.permissionDecision === "deny") {
    log(`DENY ${gate} ${event}`);
  }
  emit(answer);
}

if (require.main === module) main();
module.exports = { ASK_AS_DENY, CODEX_METERED_REASON, GATES, codexMetered, payloadFor, translate };
