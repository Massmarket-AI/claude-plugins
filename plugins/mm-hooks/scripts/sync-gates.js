#!/usr/bin/env node
// mm-hooks: puts Massmarket's three safety gates on a team machine, with no step for the member.
//
// Why (Rob, 2026-11-28: "yes ship gpt gates through plugin"): only Rob's Mac ran the send gate, the secret-read gate and
// the metered-key gate. On a teammate's computer they were a member step on the setup repair card
// (`team-safety-gates`, Rob 2026-11-25: "All three + rules"), and on 2026-11-28 no team machine had all three: no
// computer but Shezan's Linux one had any of them. A teammate's GPT (Codex) is only as gated as their Claude, because
// sync-codex.js wraps the gates it finds in ~/.claude/mm-hooks/. So this step installs them, and the next session's
// Codex step wraps them for GPT too.
//
// How it runs:
//   - As a SessionStart step it makes local reads only and returns at once. It starts itself again detached (--child)
//     and exits, so the session never waits.
//   - The child runs the team-safety-gates skill's own installer, `install.mjs --auto`. The tracker installs that skill
//     from the registry with main's gate bytes in its payload/. The installer does all of the work, with its own checks:
//     the parts must hash to main's sha, the copy must pass `node --check` and answer known inputs the way the gate
//     must, and only then is it renamed over the installed copy in ~/.claude/mm-hooks/. A copy that fails keeps the old
//     one live. settings.json is backed up before the first change. --auto never writes the rules file.
//   - What the child saw goes to `team_gates` in ~/.claude/mm-hooks/plugin-sync.json (names, short shas, states). The
//     installer's own log is ~/.claude/mm-hooks/team-safety-gates.log.
//
// It never runs (exit 0, nothing started):
//   - on Rob's machine, or any machine whose ~/.claude/CLAUDE.md links into a control-tower checkout. Those keep their
//     own installers (the control tower's scripts/install-*.sh), so no gate is ever registered twice there. The
//     installer refuses such a machine too;
//   - in an unattended run (MM_UNATTENDED=1, a Lane-2 or runner session), or with MM_TEAM_GATES=0;
//   - without the worklog hook (~/.claude/mm-hooks missing), or without an installer that knows --auto (the skill
//     arrives at the tracker's next hourly top-up; until then this step waits).
//
// It never prints, never changes a gate's decisions, and never fails or slows the session: every error is swallowed.
"use strict";
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { updateStatus } = require("./plugin-status");

/** The installer gets this long. Its every write is a rename, so a stop at the deadline leaves no half file. */
const CHILD_DEADLINE_MS = 120000;
/** The three gates, by the names the installer's state file uses. */
const GATES = ["send-gate", "metered-key-gate", "secret-read-gate"];
const OFF_RE = /^(0|false|no|off)$/i;

function paths(env = process.env) {
  const home = env.MM_HOOK_HOME || os.homedir();
  const claude = path.join(home, ".claude");
  const hookDir = path.join(claude, "mm-hooks");
  return {
    home,
    claude,
    hookDir,
    installer: path.join(claude, "skills", "team-safety-gates", "scripts", "install.mjs"),
    stateFile: path.join(hookDir, "state", "team-safety-gates.json"),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

/** Why this step does nothing on this run, or null when it should start the installer. Never throws. */
function skipReason(env = process.env) {
  try {
    if (OFF_RE.test(String(env.MM_TEAM_GATES || "").trim())) return "off";
    if (env.MM_UNATTENDED === "1" || env.LANE2_RUN_ID || env.MM_RUN_SESSION) return "unattended";
    const p = paths(env);
    if (!fs.existsSync(p.hookDir)) return "no-tracker";
    // Rob's machine: the same three signs rob-ask-gate.js reads.
    try {
      if (/[\\/]global-config[\\/]CLAUDE\.md$/.test(fs.realpathSync(path.join(p.claude, "CLAUDE.md")))) return "control-tower";
    } catch (_) {
      // no rules file, or not a link: not a sign either way
    }
    if (fs.existsSync(path.join(p.home, ".config", "massmarket", "rob-email"))) return "rob-machine";
    const bridge = readJson(path.join(p.hookDir, "bridge-state.json"));
    if (bridge && typeof bridge.member === "string" && bridge.member.trim().toLowerCase() === "rob@massmarket.ai") return "rob-machine";
    let text = "";
    try {
      text = fs.readFileSync(p.installer, "utf8");
    } catch (_) {
      return "no-skill";
    }
    if (!text.includes('"--auto"')) return "skill-too-old";
    return null;
  } catch (_) {
    return "error";
  }
}

/**
 * The `team_gates` record from the installer's state file: names, short shas and when; `failed`, the gates whose
 * current version failed a check here (the installer waits for main to change it); `not_done`, what the last run could
 * not do, by reason code. Pure on its input.
 */
function summarize(state, run) {
  const rec = Object.assign({}, run);
  const gates = {};
  const failed = [];
  const s = state && typeof state === "object" && state.v === 1 ? state : null;
  for (const g of GATES) {
    const x = s && s.gates && s.gates[g];
    if (x && typeof x === "object") {
      gates[g] = {
        main: /^[0-9a-f]{64}$/.test(String(x.main_sha)) ? x.main_sha.slice(0, 12) : null,
        at: typeof x.at === "string" ? x.at.slice(0, 30) : null,
      };
    }
    if (s && s.failed && typeof s.failed[g] === "string") failed.push(g);
  }
  rec.installed = gates;
  if (failed.length) rec.failed = failed;
  // What the last run could not do, by gate, as the installer's reason codes (install.mjs `not_done`).
  const nd = s && s.not_done && typeof s.not_done === "object" && !Array.isArray(s.not_done) ? s.not_done : null;
  if (nd) {
    const notDone = {};
    for (const g of GATES) if (typeof nd[g] === "string" && /^[a-z-]{1,30}$/.test(nd[g])) notDone[g] = nd[g];
    if (Object.keys(notDone).length) rec.not_done = notDone;
  }
  return rec;
}

/** The detached run: the installer, then the record. Returns the record. */
function runChild(env = process.env) {
  const p = paths(env);
  if (skipReason(env)) return null;
  const started = new Date().toISOString();
  let run;
  try {
    const childEnv = Object.assign({}, env, { HOME: p.home, USERPROFILE: p.home });
    // cwd = home, so the run never holds the plugin's own folder open while an update replaces it.
    const r = childProcess.spawnSync(process.execPath, [p.installer, "--auto"], {
      cwd: p.home,
      env: childEnv,
      encoding: "utf8",
      timeout: CHILD_DEADLINE_MS,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    run = { at: started, finished_at: new Date().toISOString(), result: r.error ? (r.error.code === "ETIMEDOUT" ? "timeout" : "error") : r.status === 0 ? "ran" : `exit-${r.status}` };
  } catch (_) {
    run = { at: started, finished_at: new Date().toISOString(), result: "error" };
  }
  const rec = summarize(readJson(p.stateFile), run);
  try {
    updateStatus(p.hookDir, (current) => Object.assign({}, current, { team_gates: rec }));
  } catch (_) {
    // the record is a convenience
  }
  return rec;
}

/** The SessionStart step: local reads, then the detached child. True when it started one. */
function fastPath(env = process.env) {
  const why = skipReason(env);
  const p = paths(env);
  if (why) {
    // A skip worth seeing later is recorded; Rob's machine and a machine without the tracker leave the file alone.
    if (["no-skill", "skill-too-old"].includes(why) && fs.existsSync(p.hookDir)) {
      try {
        updateStatus(p.hookDir, (current) => Object.assign({}, current, { team_gates: { at: new Date().toISOString(), result: why } }));
      } catch (_) {
        // the record is a convenience
      }
    }
    return false;
  }
  const child = childProcess.spawn(process.execPath, [__filename, "--child"], { cwd: p.home, env, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return true;
}

if (require.main === module) {
  if (process.argv.indexOf("--child") !== -1) {
    try {
      runChild();
    } catch (_) {
      // fail open and silent
    }
    process.exit(0);
  } else {
    try {
      fastPath();
    } catch (_) {
      // fail open and silent
    }
    process.exit(0);
  }
}

module.exports = { GATES, fastPath, paths, runChild, skipReason, summarize };
