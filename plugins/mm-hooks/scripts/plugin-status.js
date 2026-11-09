// mm-hooks: the one writer of ~/.claude/mm-hooks/plugin-sync.json.
//
// Three SessionStart steps record what they did there, and Claude Code runs them at the same time:
// sync-hook.js owns the top-level fields (the worklog hook reads `plugin` and `version` from them for its
// X-MM-Plugin header), sync-extension.js owns the `extension` field, and revision-insights-notice.js claims its
// notice under `revision_insights_notice`. Each step changes only its own part, under a short lock, and the file
// is replaced by a rename, so neither step's record wipes the other's and the worklog hook never reads half a file.
//
// The lock (mm-hooks 1.0.24): a lock left by a session that died is broken after 5 seconds. Before 1.0.24 any
// session that had once seen it stale deleted whatever lock file had that name, so two sessions could break the
// same stale lock, one of them deleting the fresh lock a third session had just taken, and two sessions then held
// it at once (measured: a second revision-insights notice in 1 round in 150, 8 sessions starting beside a stale
// lock). Now a stale lock is removed only under a second short lock (`<lock>.break`), and only when it is still
// stale at that moment, and a session releases only the lock it took (its own token in the file).
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 2000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ageMs(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch (_) {
    return null;
  }
}

/**
 * Remove the lock at `file` when it is stale, under `<file>.break` so only one session at a time can. The age is read
 * again under that second lock: a lock another session broke and a third took in the meantime is fresh, and stays.
 * Returns true when this session removed it. A `.break` left by a session that died mid-break goes after 5 seconds.
 */
function breakStale(file) {
  const breaker = file + ".break";
  let fd;
  try {
    fd = fs.openSync(breaker, "wx");
  } catch (err) {
    if (err && err.code === "EEXIST") {
      const age = ageMs(breaker);
      if (age !== null && age > LOCK_STALE_MS) {
        try {
          fs.unlinkSync(breaker);
        } catch (_) {
          // gone already
        }
      }
    }
    return false;
  }
  try {
    const age = ageMs(file);
    if (age === null || age <= LOCK_STALE_MS) return false;
    fs.unlinkSync(file);
    return true;
  } catch (_) {
    return false;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (_) {
      // closed
    }
    try {
      fs.unlinkSync(breaker);
    } catch (_) {
      // gone already
    }
  }
}

/** Take the lock at `file`, waiting up to 2 seconds. Returns this session's token, or null when it could not. */
function lock(file) {
  const token = process.pid + "-" + crypto.randomBytes(8).toString("hex");
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let fd = null;
    try {
      fd = fs.openSync(file, "wx");
    } catch (err) {
      if (!err || err.code !== "EEXIST") return null;
    }
    if (fd !== null) {
      let wrote = false;
      try {
        fs.writeSync(fd, token);
        wrote = true;
      } catch (_) {
        // not written: handled below
      }
      try {
        fs.closeSync(fd);
      } catch (_) {
        // closed
      }
      if (wrote) return token;
      // A lock without its token could never be released by its owner: give it back (closed first, for Windows).
      try {
        fs.unlinkSync(file);
      } catch (_) {
        // gone already
      }
      return null;
    }
    const age = ageMs(file);
    if (age !== null && age > LOCK_STALE_MS) breakStale(file);
    if (Date.now() > until) return null;
    sleep(20);
  }
}

/** Release the lock at `file` only while it is still this session's: never one another session has since taken. */
function unlock(file, token) {
  try {
    if (fs.readFileSync(file, "utf8") === token) fs.unlinkSync(file);
  } catch (_) {
    // already released
  }
}

/**
 * Replace plugin-sync.json with `change(current)`, where `current` is what the file holds now ({} when it is
 * missing or unreadable). Writes nothing when the mm-hooks folder does not exist. Never throws: the status
 * file is a convenience, and a session never fails over it.
 */
function updateStatus(hookDir, change) {
  try {
    if (!fs.existsSync(hookDir)) return false;
    const file = path.join(hookDir, "plugin-sync.json");
    const lockFile = file + ".lock";
    const token = lock(lockFile);
    if (!token) return false;
    try {
      let current = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
      } catch (_) {
        // missing or unreadable: start from nothing
      }
      const tmp = file + ".new-" + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(change(current), null, 1) + "\n");
      fs.renameSync(tmp, file);
      return true;
    } finally {
      unlock(lockFile, token);
    }
  } catch (_) {
    return false;
  }
}

module.exports = { LOCK_STALE_MS, breakStale, lock, unlock, updateStatus };
