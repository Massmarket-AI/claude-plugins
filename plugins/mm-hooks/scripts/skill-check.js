#!/usr/bin/env node
// mm-hooks: hands each PreToolUse call to the installed worklog hook, which runs the required-skill check.
//
// Why (Rob, 2026-11-05): "A lot of my teammates probably are also not loading the skills." In his own six weeks the
// skill that held the rule was not loaded in 434 of 1,002 corrections: quotes without build-hour-estimator, voice
// notes without elevenlabs-production, lead rooms without the sourcing skill, client replies without
// client-reply-prep. The worklog hook (0.12.0 and later) stops Claude, not the person, before those actions until the
// owning skill is loaded, and names it. It starts in observe mode: OW records what it would have stopped.
//
// The check lives in the worklog hook, which knows the session's loaded skills, its tracked-folder consent and its
// token. This file only makes Claude Code run it on PreToolUse, which the installer never registered: a plugin's
// hooks reach every machine with the next release, with nothing for the person to do.
//
// What it never does:
//   - run a hook that is not installed, or the two-line stub `setup.js --uninstall` leaves (exit 0, nothing printed);
//   - print anything itself. Only the worklog hook writes, and only its PreToolUse JSON;
//   - fail the tool call. Any error here is exit 0, which Claude Code reads as "no objection".
// A hook older than 0.12.0 ignores PreToolUse and exits 0, so this is safe before the hook updates.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const TARGET = path.join(process.env.MM_HOOK_HOME || os.homedir(), ".claude", "mm-hooks", "worklog-hook.js");
// The first line of the stub the installer's --uninstall writes (UNINSTALLED_HOOK_STUB in OW's
// src/lib/ext/hook-setup-source.ts), as sync-hook.js reads it.
const UNINSTALLED_MARK = "// Massmarket worklog hook: uninstalled.";

process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

function installedHook() {
  try {
    const st = fs.statSync(TARGET);
    if (!st.isFile() || st.size < 64) return null;
    const fd = fs.openSync(TARGET, "r");
    try {
      const head = Buffer.alloc(128);
      const n = fs.readSync(fd, head, 0, head.length, 0);
      if (head.slice(0, n).toString("utf8").replace(/^﻿/, "").startsWith(UNINSTALLED_MARK)) return null;
    } finally {
      fs.closeSync(fd);
    }
    return TARGET;
  } catch (_) {
    return null;
  }
}

const hook = installedHook();
if (!hook) process.exit(0);
try {
  // The hook reads the event from stdin and exits on its own; it is the same file Claude Code runs for the other events.
  require(hook);
} catch (_) {
  process.exit(0);
}
