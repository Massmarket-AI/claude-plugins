#!/usr/bin/env node
// mm-hooks: keeps ~/.claude/mm-hooks/worklog-hook.js the same as the copy this plugin release carries.
//
// Why it exists (Rob, 2026-10-09): every hook change used to mean asking each person to re-run the
// installer. This plugin auto-updates from the Massmarket marketplace, and on each session start it
// replaces the installed hook file when it differs from the one it carries. The person does nothing.
//
// What it never does:
//   - install the hook where it was never installed. The installer is the only path that writes the
//     token, the tracked-folder list and the settings entries; no installed hook, no write here.
//   - touch the token, consent.json or any settings.json.
//   - replace a symlink (someone pointing the hook at a working copy keeps their link).
//   - print anything. SessionStart output is shown to the model, so this hook stays silent and records
//     what it did in ~/.claude/mm-hooks/plugin-sync.json instead.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOOK_DIR = path.join(process.env.MM_HOOK_HOME || os.homedir(), ".claude", "mm-hooks");
const TARGET = path.join(HOOK_DIR, "worklog-hook.js");
const STATUS = path.join(HOOK_DIR, "plugin-sync.json");
const BUNDLED = path.join(__dirname, "worklog-hook.js");

function sha(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".claude-plugin", "plugin.json"), "utf8")).version || null;
  } catch (_) {
    return null;
  }
}

function sync() {
  const out = { plugin: "mm-hooks", version: version(), at: new Date().toISOString() };
  let st;
  try {
    st = fs.lstatSync(TARGET);
  } catch (_) {
    return Object.assign(out, { action: "not-installed" });
  }
  if (st.isSymbolicLink()) return Object.assign(out, { action: "skipped-symlink" });
  const want = fs.readFileSync(BUNDLED);
  const have = fs.readFileSync(TARGET);
  out.hook_sha256 = sha(want);
  if (sha(have) === out.hook_sha256) return Object.assign(out, { action: "current" });
  const tmp = TARGET + ".new-" + process.pid;
  fs.writeFileSync(tmp, want, { mode: 0o644 });
  try {
    fs.copyFileSync(TARGET, TARGET + ".prev");
  } catch (_) {
    // a missing backup never blocks the update
  }
  fs.renameSync(tmp, TARGET);
  return Object.assign(out, { action: "updated", replaced_sha256: sha(have) });
}

let result;
try {
  result = sync();
} catch (err) {
  result = { plugin: "mm-hooks", version: version(), at: new Date().toISOString(), action: "error", error: String((err && err.message) || err).slice(0, 300) };
}
try {
  if (fs.existsSync(HOOK_DIR)) fs.writeFileSync(STATUS, JSON.stringify(result, null, 1) + "\n");
} catch (_) {
  // the status file is a convenience; never fail the session over it
}
process.exit(0);
