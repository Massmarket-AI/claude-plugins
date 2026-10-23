// mm-hooks: the one writer of ~/.claude/mm-hooks/plugin-sync.json.
//
// Two SessionStart steps record what they did there, and Claude Code runs them at the same time:
// sync-hook.js owns the top-level fields (the worklog hook reads `plugin` and `version` from them for its
// X-MM-Plugin header), sync-extension.js owns the `extension` field. Each step changes only its own part,
// under a short lock, and the file is replaced by a rename, so neither step's record wipes the other's and
// the worklog hook never reads half a file.
"use strict";
const fs = require("fs");
const path = require("path");

const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 2000;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lock(file) {
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(file, "wx"));
      return true;
    } catch (err) {
      if (!err || err.code !== "EEXIST") return false;
    }
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(file);
    } catch (_) {
      // gone already
    }
    if (Date.now() > until) return false;
    sleep(20);
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
    if (!lock(lockFile)) return false;
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
      try {
        fs.unlinkSync(lockFile);
      } catch (_) {
        // already released
      }
    }
  } catch (_) {
    return false;
  }
}

module.exports = { updateStatus };
