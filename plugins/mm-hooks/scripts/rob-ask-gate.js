#!/usr/bin/env node
// mm-hooks: steers a builder's Claude onto the one gated path to Rob, `mm-api.mjs ext POST /team-ask/file`.
//
// Why: Rob's rules of 2026-11-25/26 (a client blocker gets a ticket and one ask to him; a client date never moves
// without him; never re-ask what he already ruled on). OW gates the one path. This hook sends the model there.
// The design is Claude's recommendation, which Rob approved on 2026-11-26 ("I agree with all recommendations").
//
// Two events, one script (dispatch on payload.hook_event_name):
//   - PreToolUse: a Discord post or reply that tags Rob is denied, with the path to use instead.
//   - Stop: a turn that ends waiting on Rob with no ask filed this session is blocked once.
//
// Never runs (exit 0, no output): unattended runs, sdk entrypoints, Rob's own machine, a payload it cannot read.
// Never: `ask`, a bare `allow`, a network call, a write, or any touch of ~/.claude/mm-hooks/ beyond reading
// bridge-state.json. Any error is exit 0 with no output (fail open).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

const HOME = process.env.MM_HOOK_HOME || os.homedir();
const ROB_DISCORD_ID = "1053744158763925514";

/** VERBATIM (Opus, 2026-11-26). */
const REASON_DISCORD =
  "Massmarket rule: a builder's Claude never tags Rob in Discord. A question, blocker or date move for him goes through one gated path, so he is asked once and never about something he already ruled on. First check his rulings: `node mm-api.mjs ext GET '/rulings?project_id=<client>'`. If one covers it, act on it and name it (date and quote) in your update. If none does, file it: `node mm-api.mjs ext POST /team-ask/file` with project_id, kind (blocker, date_move, only-you, risk or money), question, blocked, client_date (YYYY-MM-DD or \"none\"), rulings_checked, not_undoable, recommendation, and ticket_id for a blocker (ticket_id or phase_id plus new_date for a date move). That pins Rob's thread; if he has not answered by the next 9 AM morning meeting, it goes on that meeting's Questions for Rob ticket. A change that can be undone, on a system nobody is using, needs no OK from him: copy first, do it, then retest. Post to the team without tagging Rob if you only need to tell them something.";

/** VERBATIM (Opus, 2026-11-26). */
const REASON_STOP =
  "Massmarket rule: this turn ends waiting on Rob, but no ask to him was filed, so he will never see it. Before you stop: check his rulings (`node mm-api.mjs ext GET '/rulings?project_id=<client>'`) and act on one that covers it. If none does and the step cannot be undone or the system is in use, file it once with `node mm-api.mjs ext POST /team-ask/file` (project_id, kind, question, blocked, client_date, rulings_checked, not_undoable, recommendation, and ticket_id for a blocker or ticket_id/phase_id plus new_date for a date move), then tell the person it is filed and pinned on Rob's thread. If nothing here actually needs Rob, say so and carry on.";

const WAITING_ON_ROB = [
  /\b(waiting|blocked|on hold|holding|pending)\s+(on|for)\s+Rob\b/i,
  /\b(needs?|requires?|awaiting|pending)\s+Rob'?s\s+(ok|okay|go|approval|answer|decision|sign-?off|input|yes|call)\b/i,
  /\b(ask|asking|escalat\w*(\s+(this|it))?\s+to|check\w*\s+with|flag\w*(\s+(this|it))?\s+(for|to))\s+Rob\b/i,
  /\bRob\s+(needs to|has to|must|should|to)\s+(approve|confirm|decide|answer|sign off|ok|okay|weigh in|review)\b/i,
];

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

/** Rob's machine, unattended runs and sdk runs never get this hook. Never throws. */
function skipRun(env) {
  try {
    if (env.MM_UNATTENDED === "1" || env.LANE2_RUN_ID || env.MM_RUN_SESSION) return true;
    if (String(env.CLAUDE_CODE_ENTRYPOINT || "").startsWith("sdk")) return true;
    try {
      const st = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", "mm-hooks", "bridge-state.json"), "utf8"));
      if (st && typeof st.member === "string" && st.member.trim().toLowerCase() === "rob@massmarket.ai") return true;
    } catch (_) {
      // no bridge state: not a sign either way
    }
    if (fs.existsSync(path.join(HOME, ".config", "massmarket", "rob-email"))) return true;
    try {
      if (fs.realpathSync(path.join(HOME, ".claude", "CLAUDE.md")).includes("/massmarket-ops-control-tower/")) return true;
    } catch (_) {
      // no CLAUDE.md link
    }
    return false;
  } catch (_) {
    return true;
  }
}

function emit(obj) {
  const text = JSON.stringify(obj);
  setTimeout(() => process.exit(0), 2000).unref();
  process.stdout.write(text, () => process.exit(0));
}

/** Last `max` bytes of a file as text, or "" on any error. */
function readTail(file, max) {
  try {
    const st = fs.statSync(file);
    const len = Math.min(st.size, max);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return "";
  }
}

// ---------- PreToolUse ----------

function isDiscordSend(payload) {
  const name = String(payload.tool_name || "");
  const input = payload.tool_input;
  if (name.startsWith("mcp__") || /discord/i.test(name)) {
    // A read (read_messages, get_message, list_threads, search...) never posts, whatever ids its input names.
    if (/discord/i.test(name) && /^(read|get|list|search|fetch|history)/i.test(name.split("__").pop())) return false;
    if (/discord/i.test(name) && /(send|reply|post|message|create|edit|webhook|thread)/i.test(name)) return true;
  }
  if (name === "Bash" || name === "PowerShell") {
    const cmd = input && typeof input.command === "string" ? input.command : "";
    if (/(discord\.com\/api|discordapp\.com\/api|\/api\/webhooks\/|mm-api\.mjs\s+discord|\/team-post|discord-post|send-discord)/i.test(cmd)) return true;
    if (/mm-api\.mjs\s+ext\s+POST\s+\S*(discord|team-post)/i.test(cmd)) return true;
  }
  return false;
}

/** Local files a command names as a message body (at most 5). */
function bodyFiles(cmd, cwd) {
  const found = [];
  const add = (p) => {
    if (!p || found.length >= 5) return;
    found.push(path.resolve(cwd || process.cwd(), p));
  };
  const res = [
    /(?:^|\s)(?:-d|--data(?:-[a-z]+)?|-F|--form(?:-string)?)(?:\s+|=)['"]?(?:[^'"\s@]*=)?@([^'"\s]+)/g,
    /--(?:body|message|json)-file(?:\s+|=)['"]?([^'"\s]+)/g,
    /--file(?:\s+|=)['"]?([^'"\s]+)/g,
    /(?:^|\s)<\s*['"]?([^'"\s<>|&;]+)/g,
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(cmd)) !== null) add(m[1]);
  }
  return found;
}

function tagsRob(payload) {
  const input = payload.tool_input;
  let text = "";
  try {
    text = JSON.stringify(input) || "";
  } catch (_) {
    text = "";
  }
  if (text.includes(ROB_DISCORD_ID)) return true;
  const cmd = input && typeof input.command === "string" ? input.command : "";
  if (!cmd) return false;
  for (const file of bodyFiles(cmd, payload.cwd)) {
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      const len = Math.min(st.size, 256 * 1024);
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, 0);
        if (buf.toString("utf8").includes(ROB_DISCORD_ID)) return true;
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) {
      // unreadable: ignore
    }
  }
  return false;
}

function preToolUse(payload) {
  if (!isDiscordSend(payload)) return;
  let text = "";
  try {
    text = JSON.stringify(payload.tool_input) || "";
  } catch (_) {
    text = "";
  }
  if (text.includes("/team-ask/")) return;
  if (!tagsRob(payload)) return;
  emit({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON_DISCORD } });
}

// ---------- Stop ----------

function textOf(entry) {
  const msg = entry && entry.message;
  const content = msg && msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

function lastAssistantText(payload) {
  if (typeof payload.last_assistant_message === "string" && payload.last_assistant_message.trim()) {
    return payload.last_assistant_message;
  }
  if (typeof payload.transcript_path !== "string" || !payload.transcript_path) return "";
  const lines = readTail(payload.transcript_path, 2 * 1024 * 1024).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch (_) {
      continue;
    }
    if (!e || e.type !== "assistant") continue;
    const t = textOf(e);
    if (t.trim()) return t;
  }
  return "";
}

/** True when the transcript holds a team-ask/file call whose result carries an ask id or a covering ruling. */
function askFiled(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return false;
  const raw = readTail(transcriptPath, 20 * 1024 * 1024);
  if (!raw.includes("team-ask/file")) return false;
  const ids = new Set();
  const results = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const content = e && e.message && e.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_use" && b.id && JSON.stringify(b.input || "").includes("team-ask/file")) ids.add(b.id);
      if (b.type === "tool_result" && b.tool_use_id) results.push(b);
    }
  }
  for (const r of results) {
    if (!ids.has(r.tool_use_id)) continue;
    let s = "";
    try {
      s = JSON.stringify(r.content) || "";
    } catch (_) {
      s = "";
    }
    if (/ask_id|covered_by_ruling/.test(s)) return true;
  }
  return false;
}

function stop(payload) {
  if (payload.stop_hook_active === true) return;
  const text = lastAssistantText(payload);
  if (!text) return;
  if (!WAITING_ON_ROB.some((re) => re.test(text))) return;
  if (askFiled(payload.transcript_path)) return;
  emit({ decision: "block", reason: REASON_STOP });
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch (_) {
    process.exit(0);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) process.exit(0);
  if (skipRun(process.env)) process.exit(0);
  const event = payload.hook_event_name;
  if (event === "PreToolUse") preToolUse(payload);
  else if (event === "Stop") stop(payload);
}

main();
