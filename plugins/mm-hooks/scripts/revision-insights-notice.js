#!/usr/bin/env node
// mm-hooks: asks a session to set up the weekly revision-insights routine again when it has stopped reporting.
//
// Why it exists (Rob, 2026-11-05): "if the routine's gone, I don't know if our mod can detect that and reprompt them
// to add the routine." The routine (an app scheduled task running the revision-insights skill's
// extract_my_revisions.mjs) writes ~/.claude/mm-hooks/revision-insights.json each time it runs. A hook cannot see which
// routines the desktop app has registered, but it can see that stamp. When the stamp is missing or old, this step
// hands the session one instruction: check the scheduled tasks, and create the routine when it is not there. The first
// notice is also the setup step: there is no separate setup chip.
//
// How it runs: as a SessionStart step, local reads only (no network, no child process), well under 200 ms. It prints
// one JSON line (hookSpecificOutput.additionalContext) only when ALL of these hold:
//   1. MM_REVISION_INSIGHTS_NOTICE is not off (0, false, no, off).
//   2. MM_UNATTENDED is not 1: headless automation never gets it.
//   3. ~/.claude/mm-hooks exists (the tracker is installed).
//   4. <claude config dir>/skills/revision-insights/SKILL.md exists. The skill reaches the team only once Rob turns
//      the routine on, so until then this step stays dark.
//   5. ~/.massmarket-zero-revision does not exist: that folder is Rob's weekly-review host, and his Mac needs no routine.
//   6. The stamp is missing or unreadable, its last_run_at does not parse, or it is 9 days old or more, or more than a
//      day in the future.
//   7. No notice in the last 20 hours on this computer. The notice is claimed under plugin-sync.json's lock, under
//      `revision_insights_notice`, so two sessions starting together show it once.
//
// The session pass (Rob, 2026-11-05: "I wonder if they should do a deeper analysis like I just did"): once the skill on
// this computer carries scripts/session_insights.mjs, the routine's prompt runs three steps instead of one, so an
// existing routine has to be told. Gate 6 then also fires, with the UPDATE wording, while the routine's stamp is fresh
// but ~/.claude/mm-hooks/session-insights.json (written by the session pass on every run, switched on or off) is
// missing: the session updates the routine's prompt once, and the pass's first run writes the stamp that ends it.
// Without the script on disk the old wording shows, word for word.
//
// What it never does: write either stamp, create or change a scheduled task itself, or print anything else. Every
// error is swallowed and the session goes on.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { updateStatus } = require("./plugin-status");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const STALE_MS = 9 * DAY;
const FUTURE_SLACK_MS = DAY;
const NOTICE_EVERY_MS = 20 * HOUR;
const STAMP_MAX_BYTES = 64 * 1024;
const STATUS_MAX_BYTES = 1 << 20;
const OFF_RE = /^(0|false|no|off)$/i;
const NEVER_RAN = "has never run on this computer";

/** Every path this step reads or writes, under MM_HOOK_HOME when it is set (the same rule as update-plugins.js). */
function paths(env = process.env) {
  const home = env.MM_HOOK_HOME || os.homedir();
  // The tracker hook installs team skills under <home>/.claude/skills whatever CLAUDE_CONFIG_DIR says (worklog-hook.js
  // homeClaudeDir), so that is where the skill is looked for.
  const hookDir = path.join(home, ".claude", "mm-hooks");
  return {
    home,
    hookDir,
    statusFile: path.join(hookDir, "plugin-sync.json"),
    stampFile: path.join(hookDir, "revision-insights.json"),
    sessionStampFile: path.join(hookDir, "session-insights.json"),
    skillFile: path.join(home, ".claude", "skills", "revision-insights", "SKILL.md"),
    sessionScript: path.join(home, ".claude", "skills", "revision-insights", "scripts", "session_insights.mjs"),
    reviewHostDir: path.join(home, ".massmarket-zero-revision"),
  };
}

/** A JSON object from a small file, or null: missing, too large, unreadable, not JSON or not an object. */
function readJsonObject(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    let raw = fs.readFileSync(file, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch (_) {
    return false;
  }
}

/** The environment allows the notice: not turned off, not an unattended run. PURE. */
function envAllows(env) {
  if (OFF_RE.test(String((env && env.MM_REVISION_INSIGHTS_NOTICE) || "").trim())) return false;
  if (String((env && env.MM_UNATTENDED) || "").trim() === "1") return false;
  return true;
}

/** How long ago the stamp's last_run_at was, in ms (negative = in the future), or null when there is no readable stamp. PURE. */
function stampAge(stamp, now) {
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) return null;
  if (typeof stamp.last_run_at !== "string") return null;
  const t = Date.parse(stamp.last_run_at);
  return Number.isFinite(t) ? now - t : null;
}

/**
 * The words that replace <AGE>, or null when the routine reported recently enough. PURE.
 * A stamp more than a day in the future cannot be trusted, so it reads as no stamp at all.
 */
function ageWords(age) {
  if (age === null || age === undefined || !Number.isFinite(age) || age < -FUTURE_SLACK_MS) return NEVER_RAN;
  if (age < STALE_MS) return null;
  return "last ran " + Math.floor(age / DAY) + " days ago";
}

/** The last notice is 20 hours back or more (or never was, or its time is unreadable or ahead of the clock). PURE. */
function throttleAllows(rec, now) {
  if (!rec || typeof rec !== "object") return true;
  const last = Date.parse(rec.last_notice_at || "");
  if (!Number.isFinite(last)) return true;
  const since = now - last;
  return since < 0 || since >= NOTICE_EVERY_MS;
}

/**
 * Whether to show the notice, and with which age words. PURE.
 *   facts  { hookDir, skill, reviewHost, sessionPass }: whether ~/.claude/mm-hooks, the skill file, Rob's review
 *          folder and the skill's session_insights.mjs exist
 *   stamp  the parsed revision-insights.json, or null
 *   sessionStamp the parsed session-insights.json, or null
 *   record plugin-sync.json's revision_insights_notice, or undefined
 * Returns { show, reason, age, mode }: age is the <AGE> words when show is true; mode is "setup" (create or check the
 * routine) or "update" (the routine runs, but its prompt predates the session pass).
 */
function decideNotice({ env = {}, now, facts = {}, stamp = null, sessionStamp = null, record } = {}) {
  if (OFF_RE.test(String(env.MM_REVISION_INSIGHTS_NOTICE || "").trim())) return { show: false, reason: "turned-off" };
  if (String(env.MM_UNATTENDED || "").trim() === "1") return { show: false, reason: "unattended" };
  if (!facts.hookDir) return { show: false, reason: "no-tracker" };
  if (!facts.skill) return { show: false, reason: "no-skill" };
  if (facts.reviewHost) return { show: false, reason: "review-host" };
  const age = ageWords(stampAge(stamp, now));
  const mode = age !== null ? "setup" : facts.sessionPass && !sessionStamp ? "update" : null;
  if (mode === null) return { show: false, reason: "fresh" };
  if (!throttleAllows(record, now)) return { show: false, reason: "throttled" };
  return mode === "setup" ? { show: true, reason: "due", age, mode } : { show: true, reason: "update", age: null, mode };
}

// The routine with the session pass (Opus-authored; the person-facing lines approved by Rob). Place, never edit.
const ROUTINE_PROMPT =
  "Load the revision-insights skill and follow its 'Run it' section: run its steps in order and reply with the lines they print. Do nothing else.";
const ROUTINE_DESCRIPTION = "Sends OW my own instructions on reply-package drafts and short sorted lines from my own messages to Claude, nothing else";
const SETUP_TELL =
  "I set up your weekly revision-insights routine (Fridays 4 PM). It sends OW your own instructions on reply-package drafts, and has your Claude sort your own messages to Claude (six weeks the first time, then each week) into one short line for each correction, ask, decision, rule or status question: what it was about, the client, the skill, and your own words, 300 characters at most. Your sessions, Claude's replies and personal threads stay on your computer. Put 'private' in a thread's title to keep that thread out.";
const UPDATE_TELL =
  "I updated your weekly revision-insights routine (still Fridays 4 PM). It now also has your Claude sort your own messages to Claude (six weeks the first time, then each week) and sends OW one short line for each correction, ask, decision, rule or status question: what it was about, the client, the skill, and your own words, 300 characters at most. Your sessions, Claude's replies and personal threads stay on your computer. Put 'private' in a thread's title to keep that thread out.";

function createStep(tell) {
  return '3. No such task: call create_scheduled_task with taskId "revision-insights", title "Revision insights (weekly)", description "' +
    ROUTINE_DESCRIPTION + '", cronExpression "0 16 * * 5", and prompt "' + ROUTINE_PROMPT + '" Then tell the person in one line: "' + tell + '"';
}

/** The instruction once the session pass is on this computer: setup (with <AGE>) or update. Opus-authored. */
function sessionPassText(mode, age) {
  if (mode === "update") {
    return [
      "Massmarket revision-insights routine: the weekly routine now has a second step, the session pass, and its prompt on this computer is older than that.",
      "Do this once in this session, alongside the person's task, without stopping their work:",
      "1. Call list_scheduled_tasks (load the scheduled-tasks tools with ToolSearch if they are deferred).",
      '2. A task with taskId "revision-insights": call update_scheduled_task with that taskId, description "' + ROUTINE_DESCRIPTION + '" and prompt "' + ROUTINE_PROMPT + '" Change nothing else (keep its schedule and whether it is enabled). Then tell the person in one line: "' + UPDATE_TELL + '"',
      createStep(SETUP_TELL),
      "If the scheduled-tasks tools are not in this session, say nothing about this; a later session will try again.",
    ].join("\n");
  }
  return [
    "Massmarket revision-insights routine: the weekly routine " + age + ". It sends OW only this person's own instructions on reply-package drafts and short sorted lines from their own messages to Claude, so the skills need fewer revisions and fewer corrections.",
    "Do this once in this session, alongside the person's task, without stopping their work:",
    "1. Call list_scheduled_tasks (load the scheduled-tasks tools with ToolSearch if they are deferred).",
    '2. A task with taskId "revision-insights" that is enabled: if its prompt is not exactly "' + ROUTINE_PROMPT + '", call update_scheduled_task with that taskId, description "' + ROUTINE_DESCRIPTION + '" and that prompt, change nothing else, and tell the person in one line: "' + UPDATE_TELL + '" One that is disabled: tell the person in one line that their weekly revision-insights routine is switched off, and ask whether to switch it back on.',
    createStep(SETUP_TELL),
    "If the scheduled-tasks tools are not in this session, say nothing about this; a later session will try again.",
  ].join("\n");
}

/** The instruction the session gets, with <AGE> replaced. The wording is Opus-authored: place it, never edit it. */
function noticeText(age) {
  return [
    "Massmarket revision-insights routine: the weekly routine " + age + ". It sends OW only this person's own instructions on reply-package drafts (at most 300 characters each), so the skills that build reply packages need fewer revisions.",
    "Do this once in this session, alongside the person's task, without stopping their work:",
    "1. Call list_scheduled_tasks (load the scheduled-tasks tools with ToolSearch if they are deferred).",
    '2. A task with taskId "revision-insights" that is enabled: do nothing more. One that is disabled: tell the person in one line that their weekly revision-insights routine is switched off, and ask whether to switch it back on.',
    '3. No such task: call create_scheduled_task with taskId "revision-insights", title "Revision insights (weekly)", description "Sends my own instructions on reply-package drafts to OW, nothing else", cronExpression "0 16 * * 5", and prompt "Load the revision-insights skill and follow it: run its extract_my_revisions.mjs script once and reply with the one line it prints. Do nothing else." Then tell the person in one line: "I set up your weekly revision-insights routine (Fridays 4 PM). It sends OW only your own instructions on reply-package drafts, nothing else from your sessions."',
    "If the scheduled-tasks tools are not in this session, say nothing about this; a later session will try again.",
  ].join("\n");
}

/** The one stdout line for SessionStart (the shape worklog-hook.js's emitHookContext writes). */
function outputLine(text) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }) + "\n";
}

/** The SessionStart step: local reads, then claim the notice. Returns the notice text, or null for nothing to print. */
function fastPath(env = process.env, now = Date.now()) {
  if (!envAllows(env)) return null;
  const p = paths(env);
  const facts = { hookDir: isDir(p.hookDir) };
  if (!facts.hookDir) return null;
  facts.skill = isFile(p.skillFile);
  if (!facts.skill) return null;
  facts.reviewHost = exists(p.reviewHostDir);
  facts.sessionPass = isFile(p.sessionScript);
  const stamp = readJsonObject(p.stampFile, STAMP_MAX_BYTES);
  const sessionStamp = facts.sessionPass ? readJsonObject(p.sessionStampFile, STAMP_MAX_BYTES) : null;
  const status = readJsonObject(p.statusFile, STATUS_MAX_BYTES) || {};
  const d = decideNotice({ env, now, facts, stamp, sessionStamp, record: status.revision_insights_notice });
  if (!d.show) return null;
  // Claimed under plugin-sync.json's lock and checked again there, so two sessions starting together show it once.
  let claimed = false;
  updateStatus(p.hookDir, (current) => {
    const rec = current.revision_insights_notice && typeof current.revision_insights_notice === "object" ? current.revision_insights_notice : {};
    if (!throttleAllows(rec, now)) return current;
    claimed = true;
    const count = Number.isInteger(rec.count) && rec.count >= 0 ? rec.count + 1 : 1;
    return Object.assign({}, current, { revision_insights_notice: { last_notice_at: new Date(now).toISOString(), count } });
  });
  if (!claimed) return null;
  return facts.sessionPass ? sessionPassText(d.mode, d.age) : noticeText(d.age);
}

if (require.main === module) {
  let text = null;
  try {
    text = fastPath();
  } catch (_) {
    // fail open and silent
  }
  if (!text) process.exit(0);
  // stdout is a pipe, and on Windows a pipe write is asynchronous: exit only once it is written (or after 1 s).
  const guard = setTimeout(() => process.exit(0), 1000);
  if (typeof guard.unref === "function") guard.unref();
  try {
    process.stdout.write(outputLine(text), () => process.exit(0));
  } catch (_) {
    process.exit(0);
  }
}

module.exports = {
  NEVER_RAN, ROUTINE_PROMPT, SETUP_TELL, UPDATE_TELL, ageWords, decideNotice, envAllows, fastPath, noticeText, outputLine, paths,
  sessionPassText, stampAge, throttleAllows,
};
