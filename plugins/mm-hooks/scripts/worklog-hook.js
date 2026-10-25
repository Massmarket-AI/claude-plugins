#!/usr/bin/env node
// KEEP IN SYNC with src/lib/ext/worklog-hook-source.ts (WORKLOG_HOOK_SOURCE).
// That file is a verbatim embedded copy served by GET /api/ext/hook-install
// ?file=hook — Vercel's serverless runtime can't fs-read .claude/ at request
// time, so the installer route serves the embedded copy instead of this file.
// tests/unit/worklog-hook-source-sync.unit.test.ts reads both and asserts
// byte-for-byte equality; that test IS the sync guard. If you edit this file,
// regenerate worklog-hook-source.ts from it (verbatim copy, not hand-edited).
/**
 * Session work-log hook — streams a Claude Code session's activity to the
 * server-side, tamper-proof worklog spine (`/api/ext/worklog`, migration 088)
 * as it happens. Replaces the Chrome extension's browser-activity capture for
 * agent-driven work (the extension only sees the rep's real Chrome; this hook
 * captures the agent side regardless of which browser/VM is in play).
 *
 * Wired for SessionStart + PostToolUse + Stop in `.claude/settings.json`. One
 * script, dispatched on `hook_event_name` from stdin — see the branches at the
 * end of main(). (It also answers SubagentStart, where that event is registered
 * for it: see handleSubagentStart. The installer does not register it.)
 *
 * Task announcing (SPEC-task-announcing-v2, 2026-09-30): SessionStart injects the
 * tracking instruction first; the thread declares its client by loading a
 * `<client>-project` skill and its task with `node worklog-hook.js --task "<task>"`
 * (a CLI branch that only prints); PostToolUse captures both declarations into
 * session state and every worklog POST carries them; Stop tops up the member's
 * registry skills at most once an hour.
 *
 * Session title (SPEC-tracker-0.11.4 §1C, 2026-10-02): every worklog POST also
 * carries the thread's name, read from the tail of the session's transcript at
 * most once every 10 minutes, so the extension can tell a member's sessions
 * apart. Display text only.
 *
 * Turn origin (0.11.5, 2026-10-12): every worklog POST also says who started the
 * work it belongs to, `person` or `auto`, read from the stamp Claude Code writes
 * on the turn's opening entry in the session's transcript. A turn the system
 * started (another session's message, a scheduled trigger, a bridge kickoff) is
 * `auto`; a background task reporting back takes the origin of the turn that
 * dispatched it; when the hook cannot tell, it sends nothing. See the TURN
 * ORIGIN block.
 *
 * Turn origin, follow-ups (0.11.6, 2026-10-13): who started each agent is kept
 * in a small file of its own, so hooks that save side by side cannot lose one;
 * the cap on those is cut by last use; a report written inside a running turn
 * does not change whose turn it is; a scheduled task's prompt is recognised by
 * its whole text; and an agent can be fixed at its own start (SubagentStart).
 *
 * Task cards from `start_session` (0.11.7, 2026-10-14): the desktop app update
 * of 2026-10-14 took `spawn_task` out of NEW sessions and added `start_session`
 * (`initiation: "own_initiative"` leaves a proposal card the person starts).
 * The mint instruction names `start_session` first and `spawn_task` as the
 * fallback for a session that still has it; the `delivered_chip` producer acks
 * either one (a `start_session` only when it left a proposal card); a session a
 * card opened is read past the app's "Background … Task:" wrapper for the
 * bridge's marker; and the chip-feed and worklog requests say which hook build,
 * which mm-hooks plugin build and which auto-update setting sent them
 * (`X-MM-Client`, `X-MM-Plugin`, `X-MM-Autoupdate`).
 *
 * A mod's tool calls are not work (0.11.8, 2026-10-16): a tool call the
 * mm-bridge mod made by itself (`toolu_plugin_` on its `tool_use_id`) writes no
 * worklog row and is not counted in the Stop line; see PLUGIN TOOL CALLS.
 *
 * An undeclared session is reminded (0.11.11, 2026-10-25): a session a person
 * is at that has made 5 tool calls with no client declared is told, once, in
 * that call's additionalContext, to load the client's skill; once more 40
 * counted calls later; never a third time. Nothing is sent for it. See
 * UNDECLARED-SESSION REMINDER.
 *
 * Identity: reuses the SAME per-member `team_auth_tokens` UUID already handed
 * out for the Chrome extension (rollout/slips/), via env var MM_TRACKER_TOKEN.
 * No new credential to mint or distribute.
 *
 * Tamper-proof by construction: this script only ever POSTs new lines. It
 * never reads back, edits, or deletes a server row, and the server assigns
 * the timestamp (see /api/ext/worklog) — editing the local transcript/session
 * file after the fact cannot change what was already streamed.
 *
 * Non-negotiable: NEVER block or fail the session. Every path below is
 * wrapped so a missing token, a network error, or a malformed hook payload
 * degrades to a silent (or SessionStart: warned) no-op, exit 0. The real
 * enforcement is server-side (the presence watchdog cron) — see
 * src/app/api/cron/presence-watchdog/route.ts.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const childProcess = require("child_process");

// ⛔ FAIL-OPEN BACKSTOPS (2026-09-29) — registered before anything else in this
// file runs, so they also cover a throw during module load.
//
// A crashed hook exits non-zero, and Claude Code reports a failing hook on the
// event it ran for. Nothing this script does is worth that: an exception or a
// rejected promise that escapes every handler below ends the process with 0,
// the same clean exit main() ends with. They sit beside the hard exit armed in
// main() and the `.catch` on main() at the bottom of the file; each covers a
// failure the others cannot.
process.on("uncaughtException", () => process.exit(0));
process.on("unhandledRejection", () => process.exit(0));

// ⛔ The base URL and the token (MM_TRACKER_API_BASE / MM_TRACKER_TOKEN below)
// are the overrides the unit tests use to point this hook at a local server
// with a fake token. They predate the tests; no test-only switch was added.
const API_BASE =
  (process.env.MM_TRACKER_API_BASE || "https://onboarding-wizard.massmarket.ai").replace(
    /\/+$/,
    "",
  );

// Token resolution — env var first (works today, repo-scoped installs), then
// a machine-global token file (the cross-platform, one-command install path;
// see /api/ext/hook-install and docs/claude-code-worklog-hook.md). The file
// lives at <homedir>/.claude/mm-hooks/token so it works identically on macOS,
// Linux, and Windows without touching a shell profile. Resolution is
// best-effort and silent — a missing/unreadable file just falls through to
// the existing fail-silent no-op behavior below.
function resolveToken() {
  if (process.env.MM_TRACKER_TOKEN) return process.env.MM_TRACKER_TOKEN;
  try {
    const tokenPath = path.join(os.homedir(), ".claude", "mm-hooks", "token");
    const raw = fs.readFileSync(tokenPath, "utf8").trim();
    return raw || "";
  } catch {
    return "";
  }
}

const TOKEN = resolveToken();
const WORKLOG_URL = `${API_BASE}/api/ext/worklog`;

// ───────────────────────────────────────────────────────────────────────────
// ⛔ WHICH BUILD IS SPEAKING (0.11.7, 2026-10-14). The team health check of
// 2026-10-14 could only INFER that 4 of 7 members ran an old hook: OW recorded
// no hook version, no mm-hooks plugin version and no auto-update setting. So
// the chip-feed GET and every worklog POST carry three headers, which the ext
// auth path (src/lib/ext/auth.ts, stampHookVersion) writes to the member's
// team_auth_tokens row (migration 280):
//
//   X-MM-Client      `mm-hook/<HOOK_VERSION>`, always
//   X-MM-Plugin      `mm-hooks/<semver>`, only when ~/.claude/mm-hooks/
//                    plugin-sync.json (written by the mm-hooks plugin's
//                    sync-hook.js) names a version; absent otherwise
//   X-MM-Autoupdate  `1` when FORCE_AUTOUPDATE_PLUGINS is set in this
//                    process's environment, `0` when it is not
//
// ⛔ BUMP HOOK_VERSION WITH EVERY RELEASE OF THIS FILE. It is the only place
// the number lives; the comments above (0.11.4, 0.11.5, 0.11.6) are history.
// It must stay `<major>.<minor>.<patch>`: the server stores nothing else.
//
// ⛔ NOTHING HERE CAN FAIL A REQUEST. The file read is bounded, parsed in a
// try, validated, and read at most once per run; any problem drops the one
// header it would have produced and nothing else.
// ───────────────────────────────────────────────────────────────────────────

/** This file's release. See the block above: bump it with every release. */
const HOOK_VERSION = "0.11.11";

/** What a plugin-sync.json may say as its version: digits and dots, three parts. */
const PLUGIN_SYNC_VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** A plugin-sync.json bigger than this is not read (the real one is ~200 bytes). */
const PLUGIN_SYNC_MAX_BYTES = 16384;

/** undefined = not read yet this run; null = read, and it names no version. */
let PLUGIN_SYNC_VERSION;

/**
 * The mm-hooks plugin build that last synced this hook, from
 * `<home>/.claude/mm-hooks/plugin-sync.json`, or null. Read at most once per
 * run; a missing, oversized, unreadable or malformed file, a file naming
 * another plugin, or a version that is not `<major>.<minor>.<patch>` is null.
 * Never throws.
 */
function mmHooksPluginVersion() {
  if (PLUGIN_SYNC_VERSION !== undefined) return PLUGIN_SYNC_VERSION;
  PLUGIN_SYNC_VERSION = null;
  try {
    const file = path.join(os.homedir(), ".claude", "mm-hooks", "plugin-sync.json");
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > PLUGIN_SYNC_MAX_BYTES) return PLUGIN_SYNC_VERSION;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return PLUGIN_SYNC_VERSION;
    if (parsed.plugin !== undefined && parsed.plugin !== "mm-hooks") return PLUGIN_SYNC_VERSION;
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (PLUGIN_SYNC_VERSION_RE.test(version)) PLUGIN_SYNC_VERSION = version;
  } catch {
    /* no file, or not ours to read: no header */
  }
  return PLUGIN_SYNC_VERSION;
}

/**
 * True when FORCE_AUTOUPDATE_PLUGINS is set: present and not empty, and not
 * one of the words that mean off ("0", "false", "no", "off", any case).
 */
function forceAutoupdateSet(env) {
  const raw = (env || process.env).FORCE_AUTOUPDATE_PLUGINS;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value !== "" && ["0", "false", "no", "off"].indexOf(value) === -1;
}

/** The three build headers for a chip-feed or worklog request. Never throws. */
function hookClientHeaders() {
  const out = { "X-MM-Client": `mm-hook/${HOOK_VERSION}` };
  try {
    const plugin = mmHooksPluginVersion();
    if (plugin) out["X-MM-Plugin"] = `mm-hooks/${plugin}`;
    out["X-MM-Autoupdate"] = forceAutoupdateSet() ? "1" : "0";
  } catch {
    /* the headers are telemetry; the request goes out without them */
  }
  return out;
}
// Matches CHIP_FETCH_TIMEOUT_MS (2026-09-23). Both calls cross the same
// iad1 -> us-west-2 path to the same database, and a 4s budget here was the
// one bound left inside the range a slow minute produces. An aborted POST is
// a lost worklog line, so this errs on the side of waiting.
const FETCH_TIMEOUT_MS = 10000;

// ⛔ HARD-EXIT BUDGETS (2026-09-29) — main() arms one of these before anything
// else on the event path runs; see the block there. SessionStart gets the long
// one because its chip-feed request alone may use CHIP_FETCH_TIMEOUT_MS (10 s).
const HARD_EXIT_SESSION_START_MS = 12000;
const HARD_EXIT_DEFAULT_MS = 6000;
/** When the armed hard exit fires (epoch ms). 0 until main() arms it. */
let HARD_EXIT_AT = 0;
/**
 * PostToolUse ends its network phase this long before the hard exit, so that
 * saveSessionState() always runs. See handlePostToolUse.
 */
const POST_TOOL_USE_SAVE_MARGIN_MS = 1000;

// ⛔ The directory Claude Code started this hook in, read ONCE and guarded.
// `process.cwd()` throws when that directory has been deleted out from under the
// session, and at module load that used to be an uncaught crash before main()
// ever ran. The home-directory fallback is only ever used to derive the state
// key below: the consent gate reads process.cwd() for itself and refuses a
// session whose cwd is gone, so nothing is recorded on the strength of it.
function readHookCwd() {
  try {
    return process.cwd();
  } catch {
    try {
      return os.homedir();
    } catch {
      return "";
    }
  }
}
const HOOK_CWD = readHookCwd();

/**
 * Local, best-effort state — the dedupe set of already-reported TodoWrite
 * completions, the tool-call count the Stop line reports, the chips SessionStart
 * served (read back by the PostToolUse `delivered_chip` ack), and a debug log for
 * failed posts. Never authoritative (the server row is), so it may be lossy.
 *
 * ⛔ IT LIVES IN THE MEMBER'S HOME, NEVER IN THE WORK FOLDER (2026-09-29). It used
 * to be `<cwd>/.claude/.worklog-state/`, which put a folder and a debug log into
 * whatever directory Claude was running in — including the Claude desktop app's
 * own scratch workspaces and cloud-synced work folders. It is now
 * `<homedir>/.claude/mm-hooks/state/`, beside the token and consent.json this
 * hook already reads: per session under `sessions/` (see M1 below), and per
 * folder under `<key>/`, where <key> is the first 16 hex chars of sha256(absolute
 * cwd). Nothing in this file creates or writes anything under the cwd.
 *
 * Null when there is no usable home directory. Every writer then does nothing,
 * rather than fall back to a relative path — which would resolve INSIDE the cwd.
 *
 * ⛔ A SESSION'S STATE FOLLOWS THE SESSION, NOT THE FOLDER (2026-09-30, HOOK fix
 * round 1, Opus decision M1). Claude Code runs every hook in the session's
 * CURRENT cwd, so a thread that ran `cd site && …` landed in a second state
 * folder: its client and task declarations vanished from every row, the older
 * task came back once it returned to the root, the todo dedupe and the tool-call
 * count split in two, and the chip records that make a delivery "once per
 * session" were forgotten. None of that is per-folder. So when the payload names
 * its session, the whole state lives in ONE file per session,
 * `<homedir>/.claude/mm-hooks/state/sessions/<session id>.json`, whatever the
 * cwd. The per-folder directory keeps only what is genuinely per folder (the
 * debug log) and the state of a payload that names no session.
 */
function stateRootDir() {
  try {
    const home = os.homedir();
    if (typeof home !== "string" || !home || !path.isAbsolute(home)) return null;
    return path.join(home, ".claude", "mm-hooks", "state");
  } catch {
    return null;
  }
}

function stateDirFor(cwd) {
  try {
    const root = stateRootDir();
    if (!root) return null;
    const key = require("crypto")
      .createHash("sha256")
      .update(path.resolve(cwd || os.homedir()))
      .digest("hex")
      .slice(0, 16);
    return path.join(root, key);
  } catch {
    return null;
  }
}
const STATE_DIR = stateDirFor(HOOK_CWD);
const DEBUG_LOG = STATE_DIR ? path.join(STATE_DIR, "debug.log") : null;
/** One state file per Claude Code session, whatever its cwd — see above. */
const SESSION_STATE_DIR = (() => {
  const root = stateRootDir();
  return root ? path.join(root, "sessions") : null;
})();

/**
 * ⛔ A SESSION'S CLIENT AND TASK OUTLIVE THE 48-HOUR PRUNE (0.11.9, 2026-10-19).
 * A state file goes once it has been unused for 48 hours (pruneStateFiles), and
 * the declarations went with it: a thread resumed after a weekend sent every row
 * with no client until someone loaded the client's skill again, and those rows
 * were billed to nobody. Seen on Rob's own client thread, idle from 2026-10-16
 * 20:49Z and resumed on 10-19 with `declared_skill: null` until he re-declared.
 *
 * So the declarations alone are also kept in a small record of their own,
 * `<homedir>/.claude/mm-hooks/state/declarations/<session id>.json`: the client,
 * the task, when each was declared, and where the session's transcript is. Every
 * save writes it beside the state file, and every load takes the newer of the
 * two for each declaration (adoptNewerDeclarations). A session whose state file
 * was pruned starts again from its last declarations, with their original times,
 * not from none.
 *
 * The 48-hour prune never looks in this folder. A record goes at SessionStart
 * (pruneDeclarationRecords) once it has been unused for 48 hours AND its
 * transcript is gone, which is when Claude Code can no longer resume the
 * session; or once it has been unused for DECLARATION_KEEP_MAX_MS, transcript or
 * not. A record that names no transcript keeps the old 48 hours.
 *
 * ⛔ WHY ON THIS MACHINE, NOT FROM THE SERVER. The other way would ask OW for the
 * session's last declaration on the first row after a gap. That puts a request
 * on the tool-call path, inside its 6 s budget; needs a new read route for a
 * member's token; and fails exactly when OW is slow or down. This needs none of
 * it and ships with the hook alone.
 *
 * Only a session the payload names has a record. Nothing in it is ever sent.
 */
const DECLARATION_STATE_DIR = (() => {
  const root = stateRootDir();
  return root ? path.join(root, "declarations") : null;
})();
/** A state file unused for longer than this goes (pruneStateFiles). */
const STATE_UNUSED_MS = 48 * 3600 * 1000;
/** A declarations record unused for longer than this goes, transcript or not. */
const DECLARATION_KEEP_MAX_MS = 90 * 24 * 3600 * 1000;
/** A temporary file writeDeclarationRecord leaves when its rename is refused. */
const DECLARATION_TEMP_RE = /^\.tmp-\d+-[0-9a-f]{8}$/;
/** This run's transcript, from the payload (see transcriptPathKept). Null until main() reads it. */
let HOOK_TRANSCRIPT_PATH = null;

/**
 * ⛔ READ-ONLY. The pre-2026-09-29 location, `<cwd>/.claude/.worklog-state/`.
 *
 * A session that was already running when the hook was upgraded keeps its
 * dedupe set, tool-call count and served chips here. Starting it from empty
 * would re-post every todo it had already completed (a TodoWrite call carries
 * the whole list) and drop the `delivered_chip` ack for chips served before the
 * upgrade. So this is the fallback when the home location has no file for the
 * session yet, and it is read AT MOST ONCE per session:
 *
 *   - within one hook run, readLegacySessionState() memoizes the read, so a run
 *     that loads the state twice (a spawn_task PostToolUse loads it again for
 *     the chip ack) still reads this file once;
 *   - across runs, the first run that falls back to it leaves a home file
 *     behind. PostToolUse always saves. Stop saves what it loaded when it fell
 *     back and the home file does not exist yet, so a session that only ever
 *     stops again never comes back here. SessionStart saves when it records
 *     served chips. Once the home file exists this is never consulted again.
 *
 * The same holds, by the same rules, for the home location a NAMED session used
 * between 2026-09-29 and the per-session file (M1 above): `state/<folder key>/
 * <session id>.json`. It is consulted first, then this one.
 *
 * Nothing in this file writes, moves or deletes anything under it. The
 * installer's --repair (PR fix/installer-repair-uninstall) removes the old
 * folders.
 */
const LEGACY_STATE_DIR = HOOK_CWD ? path.join(HOOK_CWD, ".claude", ".worklog-state") : null;

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ensureStateDir() {
  if (!STATE_DIR) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch {
    /* best-effort */
  }
}

function debugLog(line) {
  if (!DEBUG_LOG) return;
  try {
    ensureStateDir();
    fs.appendFileSync(
      DEBUG_LOG,
      `[${new Date().toISOString()}] ${line}\n`,
      "utf8",
    );
  } catch {
    /* never let logging itself throw */
  }
}

function sessionStateFileName(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safe}.json`;
}

/** Does the payload name its Claude Code session? Then its state is keyed by it (M1). */
function isSessionKey(sessionId) {
  return typeof sessionId === "string" && sessionId !== "";
}

/**
 * This session's state file: `state/sessions/<session id>.json` when the payload
 * names its session, whatever the cwd; this folder's `state/<key>/unknown.json`
 * when it names none.
 */
function stateFilePath(sessionId) {
  const dir = isSessionKey(sessionId) ? SESSION_STATE_DIR : STATE_DIR;
  return dir ? path.join(dir, sessionStateFileName(sessionId)) : null;
}

/**
 * What this process read from an OLDER location, per session file name: the raw
 * text, or null when there was nothing readable. The memo is what makes it one
 * read per run — see LEGACY_STATE_DIR. The TEXT is kept, not the parsed object,
 * so each caller gets its own copy and a mutation made by one load (the chip ack
 * pushes onto ackedChips) cannot leak into another.
 */
const LEGACY_STATE_READS = new Map();
const FOLDER_STATE_READS = new Map();

function readOlderSessionState(memo, dir, sessionId) {
  if (!dir) return null;
  const name = sessionStateFileName(sessionId);
  if (!memo.has(name)) {
    let raw = null;
    try {
      raw = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      raw = null;
    }
    memo.set(name, raw);
  }
  const raw = memo.get(name);
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** The pre-upgrade state for this session, or null. Reads only; see LEGACY_STATE_DIR. */
function readLegacySessionState(sessionId) {
  return readOlderSessionState(LEGACY_STATE_READS, LEGACY_STATE_DIR, sessionId);
}

/**
 * A named session's state where the hook kept it before M1: this folder's
 * `state/<key>/<session id>.json`. Reads only; see LEGACY_STATE_DIR.
 */
function readFolderSessionState(sessionId) {
  return readOlderSessionState(FOLDER_STATE_READS, STATE_DIR, sessionId);
}

/**
 * Did this run load this session's state from an older location? Answers from
 * the memos only — never reads a file itself.
 */
function usedOlderSessionState(sessionId) {
  const name = sessionStateFileName(sessionId);
  return (
    (FOLDER_STATE_READS.has(name) && readFolderSessionState(sessionId) !== null) ||
    (LEGACY_STATE_READS.has(name) && readLegacySessionState(sessionId) !== null)
  );
}

/** Does this session already have a state file in the home location? Never throws. */
function homeSessionStateExists(sessionId) {
  const file = stateFilePath(sessionId);
  if (!file) return false;
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

/**
 * This session's state file: the home location first; an older one only when
 * the home location has NO file for this session (ENOENT) — for a named session
 * the pre-M1 folder file, then the legacy one. A home file that exists but
 * cannot be parsed is not a reason to go back to an old one — it degrades to
 * empty state exactly as it always has.
 */
function readSessionStateFile(sessionId) {
  const file = stateFilePath(sessionId);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (!err || err.code !== "ENOENT") return null;
    if (isSessionKey(sessionId)) {
      const folder = readFolderSessionState(sessionId);
      if (folder) return folder;
    }
    return readLegacySessionState(sessionId);
  }
}

/** A string state value, or null. Declarations are only ever strings. */
function stateString(value) {
  return typeof value === "string" && value ? value : null;
}

/**
 * This session's state. ⛔ Each declaration is the newer of the state file's and
 * the declarations record's: once the state file has been pruned, that is the
 * record's (see DECLARATION_STATE_DIR).
 */
function loadSessionState(sessionId) {
  const state = loadSessionStateFromFile(sessionId);
  adoptNewerDeclarations(readDeclarationRecord(sessionId), state);
  return state;
}

function loadSessionStateFromFile(sessionId) {
  try {
    const parsed = readSessionStateFile(sessionId);
    const state = {
      seenTodos: Array.isArray(parsed.seenTodos) ? parsed.seenTodos : [],
      toolCallCount: parsed.toolCallCount || 0,
      // ⛔ Chips bridge — every key here MUST round-trip. SessionStart writes
      // `servedChips` and PostToolUse loads/mutates/saves this same object, so
      // a key dropped from this reader is silently erased on the next tool
      // call, and the delivered_chip ack below stops firing without a trace.
      servedChips: Array.isArray(parsed.servedChips) ? parsed.servedChips : [],
      ackedChips: Array.isArray(parsed.ackedChips) ? parsed.ackedChips : [],
      chipAckFailures: parsed.chipAckFailures || 0,
      // ⛔ Task announcing (SPEC v2 §2.3) — the session-sticky declarations. The
      // same round-trip rule applies: a key missing here is erased by the next
      // save, and every later worklog row of the session loses its client/task.
      declared_skill: stateString(parsed.declared_skill),
      declared_skill_at: stateString(parsed.declared_skill_at),
      declared_task: stateString(parsed.declared_task),
      declared_task_at: stateString(parsed.declared_task_at),
      // ⛔ Session title (0.11.4) — the thread's name as last read from its
      // transcript, and when that read happened. The same round-trip rule
      // applies: a key missing here is erased by the next save, and the
      // transcript would then be read again on every tool call instead of at
      // most once every 10 minutes. See sessionTitleFor.
      session_title: stateString(parsed.session_title),
      session_title_read_at: stateString(parsed.session_title_read_at),
      // ⛔ Turn origin (0.11.5) — who started the turn this session is in, the
      // id of that turn's prompt, and who started the chain of work it belongs
      // to. The same round-trip rule applies: a key missing here is erased by
      // the next save, and every later row of a long turn, whose opening entry
      // is by then further back than the tail that is read, would be sent with
      // no origin. See turnOriginFor.
      //
      // ⛔ WHO STARTED EACH AGENT AND BACKGROUND TASK IS NOT IN THIS OBJECT
      // (0.11.6). It is one small file per task beside this one (see TASK
      // ORIGINS): agents make tool calls side by side, each in a hook process
      // that saves this whole object, and no merge on save kept all of them.
      turn_origin: turnOriginKept(parsed.turn_origin),
      turn_origin_prompt_id: stateString(parsed.turn_origin_prompt_id),
      turn_chain_origin: turnOriginKept(parsed.turn_chain_origin),
      // ⛔ Undeclared-session reminder (0.11.11) — the tool calls counted while
      // the session had no client, and how many reminders it has had. The same
      // round-trip rule applies: a key missing here is erased by the next save,
      // and the count would start again from nothing. See UNDECLARED-SESSION
      // REMINDER.
      undeclared_tool_calls: reminderCount(parsed.undeclared_tool_calls),
      undeclared_reminders: reminderCount(parsed.undeclared_reminders),
    };
    // A state file 0.11.5 wrote still holds its tasks in a `turn_task_origins`
    // key. They are moved to their own files, once; the key is not carried on.
    migrateTaskOrigins(sessionId, parsed.turn_task_origins);
    return state;
  } catch {
    return {
      seenTodos: [],
      toolCallCount: 0,
      servedChips: [],
      ackedChips: [],
      chipAckFailures: 0,
      declared_skill: null,
      declared_skill_at: null,
      declared_task: null,
      declared_task_at: null,
      session_title: null,
      session_title_read_at: null,
      turn_origin: null,
      turn_origin_prompt_id: null,
      turn_chain_origin: null,
      undeclared_tool_calls: 0,
      undeclared_reminders: 0,
    };
  }
}

/** Each declaration and its timestamp: on save, the newer of the two copies wins (L2). */
const DECLARATION_KEYS = [
  ["declared_skill", "declared_skill_at"],
  ["declared_task", "declared_task_at"],
];

/** An ISO timestamp as epoch ms, or NaN. */
function declarationMs(value) {
  const s = stateString(value);
  return s ? Date.parse(s) : NaN;
}

/**
 * ⛔ A DECLARATION IS NEVER ERASED BY A PROCESS THAT MADE NONE (2026-09-30, HOOK
 * fix round 1, Opus decision L2). Claude Code runs the PostToolUse hooks of
 * parallel tool calls at the same time, one process each, and each saves the
 * whole state object it loaded. A process that loaded the state BEFORE a
 * parallel `--task` call declared, and saved AFTER it, wrote its stale copy over
 * the declaration, and the task dropped off every later row of the session.
 *
 * So right before a save the file is read again, and for each declaration the
 * copy with the newer `*_at` is kept — the one another process just wrote
 * survives, and a newer one made here still replaces an older one on disk. The
 * caller's object is updated too, so what it sends next agrees with what was
 * saved. Everything else in the state keeps its old rule: the last save wins.
 */
function keepNewerDeclarations(file, state) {
  let disk = null;
  try {
    disk = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return;
  }
  adoptNewerDeclarations(disk, state);
}

/**
 * For each declaration, take `source`'s copy into `state` when it is the newer
 * one, or when `state` has none. A copy without a readable `*_at` is never taken.
 */
function adoptNewerDeclarations(source, state) {
  if (!source || typeof source !== "object") return;
  DECLARATION_KEYS.forEach(([key, atKey]) => {
    const value = stateString(source[key]);
    const sourceMs = declarationMs(source[atKey]);
    if (!value || !Number.isFinite(sourceMs)) return;
    const ownMs = declarationMs(state[atKey]);
    if (!stateString(state[key]) || !Number.isFinite(ownMs) || sourceMs > ownMs) {
      state[key] = value;
      state[atKey] = stateString(source[atKey]);
    }
  });
}

function saveSessionState(sessionId, state) {
  const file = stateFilePath(sessionId);
  if (!file) return;
  // Read once, before the state file is written: the newer of each declaration
  // in the two survives the save, and the record keeps the transcript it names.
  const record = readDeclarationRecord(sessionId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    keepNewerDeclarations(file, state);
    adoptNewerDeclarations(record, state);
    fs.writeFileSync(file, JSON.stringify(state), "utf8");
  } catch {
    /* best-effort */
  }
  writeDeclarationRecord(sessionId, state, record);
}

/** This session's declarations record, or null for a payload that names no session. */
function declarationRecordFile(sessionId) {
  return DECLARATION_STATE_DIR && isSessionKey(sessionId)
    ? path.join(DECLARATION_STATE_DIR, sessionStateFileName(sessionId))
    : null;
}

/** A JSON object read from `file`, or null when there is none that reads. Never throws. */
function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** What this session's declarations record holds, or null. */
function readDeclarationRecord(sessionId) {
  const file = declarationRecordFile(sessionId);
  return file ? readJsonObject(file) : null;
}

/** A transcript path as a record keeps it: an absolute path of sane length, or null. */
function transcriptPathKept(value) {
  return typeof value === "string" && value.length <= 4096 && path.isAbsolute(value) ? value : null;
}

/**
 * Write this session's declarations record whole: to a temporary name in the
 * same folder, then renamed into place, as a task file is (taskOriginWrite), so
 * a parallel load reads the old record or the new one, never half of either.
 * Written only once the session has declared something. The transcript is this
 * run's, or the one `previous` named when this payload carries none. Every save
 * writes it, so its modification time is when the session was last used.
 * Never throws.
 */
function writeDeclarationRecord(sessionId, state, previous) {
  const file = declarationRecordFile(sessionId);
  if (!file) return;
  const record = {
    declared_skill: stateString(state.declared_skill),
    declared_skill_at: stateString(state.declared_skill_at),
    declared_task: stateString(state.declared_task),
    declared_task_at: stateString(state.declared_task_at),
    transcript_path:
      HOOK_TRANSCRIPT_PATH || transcriptPathKept(previous && previous.transcript_path),
  };
  if (!record.declared_skill && !record.declared_task) return;
  const body = JSON.stringify(record);
  let temp = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    temp = path.join(
      path.dirname(file),
      `.tmp-${process.pid}-${require("crypto").randomBytes(4).toString("hex")}`,
    );
    fs.writeFileSync(temp, body, "utf8");
    fs.renameSync(temp, file);
    temp = null;
  } catch {
    try {
      fs.writeFileSync(file, body, "utf8");
    } catch {
      /* best-effort */
    }
  } finally {
    if (temp) {
      try {
        fs.unlinkSync(temp);
      } catch {
        /* never written */
      }
    }
  }
}

// Opportunistic cleanup — drop state files older than 48h so neither this
// folder's state directory nor the per-session one grows unbounded. It only
// ever looks inside those two; the legacy <cwd>/.claude/.worklog-state/ is
// never touched, and neither is anything that is not a plain file.
//
// ⛔ The declarations records are pruned by their own rule, and at SessionStart
// only: that rule looks for each old record's transcript, which is more than a
// tool call should wait on, and sessions start often enough to keep the folder
// small. See DECLARATION_STATE_DIR.
function pruneOldState(event) {
  pruneStateFiles(STATE_DIR);
  pruneStateFiles(SESSION_STATE_DIR);
  if (event === "SessionStart") pruneDeclarationRecords();
}

/**
 * Drop the declarations records no session can use any more: one unused for 48
 * hours whose transcript is gone or was never named, and any unused for
 * DECLARATION_KEEP_MAX_MS. Only this hook's own files go — a record, or a
 * temporary file a refused rename left — never anything else in the folder.
 * A reminder marker (`<session id>.reminder-<n>.json`, 0.11.11: see
 * UNDECLARED-SESSION REMINDER) is a `.json` file naming its transcript too, so
 * it goes by the same rule as its session's record. Never throws.
 */
function pruneDeclarationRecords() {
  const dir = DECLARATION_STATE_DIR;
  if (!dir) return;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  names.forEach((name) => {
    try {
      const temp = DECLARATION_TEMP_RE.test(name);
      if (!temp && !/\.json$/.test(name)) return;
      const p = path.join(dir, name);
      const stat = fs.lstatSync(p);
      if (!stat.isFile() || stat.mtimeMs >= now - STATE_UNUSED_MS) return;
      if (!temp && stat.mtimeMs >= now - DECLARATION_KEEP_MAX_MS && transcriptStillThere(p)) return;
      fs.unlinkSync(p);
    } catch {
      /* this entry only */
    }
  });
}

/** Does the record at `file` name a transcript that is still on disk? Never throws. */
function transcriptStillThere(file) {
  const record = readJsonObject(file);
  const transcript = transcriptPathKept(record && record.transcript_path);
  if (!transcript) return false;
  try {
    return fs.statSync(transcript).isFile();
  } catch {
    return false;
  }
}

function pruneStateFiles(dir) {
  if (!dir) return;
  try {
    const cutoff = Date.now() - STATE_UNUSED_MS;
    for (const name of fs.readdirSync(dir)) {
      if (name === "debug.log") continue;
      try {
        const p = path.join(dir, name);
        const stat = fs.lstatSync(p);
        if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(p);
        else if (stat.isDirectory() && stat.mtimeMs < cutoff) pruneTaskOriginsDir(dir, name);
      } catch {
        /* this entry only */
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * A second abort for `controller`, at `deadlineAt` (epoch ms) — or null when the
 * caller has no shared deadline. PostToolUse passes one so that every request it
 * makes, however many, ends inside one budget; see handlePostToolUse.
 */
function abortAtDeadline(controller, deadlineAt) {
  if (!deadlineAt) return null;
  return setTimeout(() => controller.abort(), Math.max(0, deadlineAt - Date.now()));
}

/** True when a shared deadline was given and has already passed. */
function deadlinePassed(deadlineAt) {
  return Boolean(deadlineAt) && Date.now() >= deadlineAt;
}

async function postWorklog({ contentMd, title, source, declarations }, deadlineAt) {
  // ⛔ Consent first, before the token, before the timer, before anything. This
  // is the second of the two senders the gate in main() covers; the check is
  // repeated here so a future call site cannot route around it.
  if (!CONSENT_OK) return { ok: false, reason: "consent_gate" };
  if (!TOKEN) return { ok: false, reason: "no_token" };
  if (deadlinePassed(deadlineAt)) return { ok: false, reason: "deadline" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const deadlineTimer = abortAtDeadline(controller, deadlineAt);
  // SPEC v2 §2.4 — every POST carries the session's declarations; a call site
  // that passes none still sends the keys, as null.
  const decl = declarations || declarationFields(null, null, null);
  try {
    const res = await fetch(WORKLOG_URL, {
      method: "POST",
      headers: Object.assign(
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
        // Which hook, plugin and auto-update setting sent this (0.11.7).
        hookClientHeaders(),
      ),
      // ⛔ Belt and braces: every worklog line is scrubbed here too, so a
      // future call site that forgets scrubAndTruncate still cannot put a
      // credential on the wire. Cheap (~14us on a 160-byte line) and it runs
      // once per POST.
      //
      // ⛔ THIS IS THE ONE PLACE content_md IS COMPOSED. All three emit sites —
      // the per-tool-call activity line, the TodoWrite completion line and its
      // title, and the Stop session line — funnel through here, so the homedir
      // replacer covers every stored line, and covers a future call site with
      // it. Scrub first, normalize second — see homedirReplacer.
      body: JSON.stringify(
        {
          content_md: scrubText(String(contentMd == null ? "" : contentMd)).text,
          title: title ? scrubText(String(title)).text : undefined,
          source: source || "claude-code",
          // ⛔ ATTRIBUTION PHASE 1 — docs/worklog-attribution-design-2026-09-02.md
          // §3.1 (Signal A) and §6 phase 1. The consent gate already answered
          // "which project is this?" when it answered "may I record this?":
          // `root` is the allowlist entry the cwd matched, in the canonical form
          // the gate computed, and `cwd_rel` is the cwd expressed INSIDE it (see
          // cwdRelativeToRoot). Both go through homedirReplacer with everything
          // else here, so a root under the member's home lands as `~/…` and the
          // OS account name never leaves the machine. `platform` says which
          // separator rules `root` obeys. Nothing resolves these yet — the
          // server stores them raw (migration 179) for a later phase to read.
          root: CONSENT_ROOT,
          cwd_rel: CONSENT_CWD_REL,
          platform: process.platform,
          // ⛔ TASK ANNOUNCING — SPEC-task-announcing-v2 §2.4. Raw declarations
          // only; the server validates, resolves and stores them in columns that
          // nothing reads yet. Null when unset. `declaration_event` is set only
          // on the row of the tool call that made the declaration.
          session_id: decl.session_id,
          declared_skill: decl.declared_skill,
          declared_skill_at: decl.declared_skill_at,
          declared_task: decl.declared_task,
          declared_task_at: decl.declared_task_at,
          declaration_event: decl.declaration_event,
          // ⛔ SESSION TITLE (0.11.4) — the thread's name, for display in the
          // extension's session list and nothing else. It is this run's title as
          // sessionTitleFor() cleaned and scrubbed it; with no title the key is
          // left out of the body altogether. The server stores it in its own
          // column and derives no client and no task from it.
          session_title: SESSION_TITLE || undefined,
          // ⛔ TURN ORIGIN (0.11.5) — who started the turn this row belongs to:
          // "person" or "auto", as turnOriginFor() read it from the stamp on the
          // turn's opening entry. One of those two words and nothing else: no
          // prompt text is sent for it. When the hook cannot tell, the key is
          // left out of the body altogether; the server then stores NULL, which
          // every reader counts as the person's.
          turn_origin: TURN_ORIGIN || undefined,
        },
        homedirReplacer,
      ),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      debugLog(`worklog POST ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    debugLog(`worklog POST failed: ${err && err.message}`);
    return { ok: false, reason: "network_error" };
  } finally {
    // ⛔ ONLY NOW (2026-09-29). The timers used to be cleared the moment the
    // headers arrived, so a server that sent headers and then stalled the body
    // held `res.text()` open with nothing left to end it. They stay armed until
    // every read above has finished.
    clearTimeout(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/**
 * The SPEC v2 §2.4 fields for one worklog POST: the Claude Code session id and
 * this session's sticky declarations, read from its loaded state.
 *
 * `declarationEvent` is "client" or "task" ONLY on the row of the tool call that
 * made the declaration, and null on every other row. Unset values are null,
 * never omitted, so the body shape is the same on every event.
 */
function declarationFields(sessionId, state, declarationEvent) {
  const s = state && typeof state === "object" ? state : {};
  return {
    session_id: stateString(sessionId),
    declared_skill: stateString(s.declared_skill),
    declared_skill_at: stateString(s.declared_skill_at),
    declared_task: stateString(s.declared_task),
    declared_task_at: stateString(s.declared_task_at),
    declaration_event:
      declarationEvent === "client" || declarationEvent === "task" ? declarationEvent : null,
  };
}

function truncate(str, n) {
  const s = String(str || "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * The session cwd expressed INSIDE the consent root the gate matched — the
 * `cwd_rel` field of every worklog POST (attribution phase 1, design §3.1).
 *
 * Returns the remainder with POSIX separators (`src/lib` for a cwd two levels
 * under the root), "" when the cwd IS the root, and null when the cwd is not
 * inside the root at all. Null is an answer, not an error: a git worktree of
 * an allowlisted repo passes the gate as `worktree_of_allowlisted_repo` with
 * the MAIN repo's root, while its own directory lives elsewhere — typically a
 * scratch path whose segments spell the member's account (`-Users-<name>-…`)
 * in a shape normalizeHomedir does not cover. The design's privacy boundary is
 * "the root and the relative remainder, never a path from outside it", and a
 * `../../…` remainder IS a path from outside it. So it is not sent.
 *
 * ⛔ REALPATH BOTH SIDES, best-effort, before comparing. `process.cwd()` is the
 * PHYSICAL path (macOS hands `/var/…` back as `/private/var/…`) while the root
 * is the LEXICAL form the member wrote in consent.json — the same mismatch
 * mm-path-scope's physical pass exists for, and the reason a bare
 * path.relative() would have produced a `../../private/…` remainder for a cwd
 * the gate had just accepted. It uses the matcher's own realpathBestEffort so
 * the two agree on what a symlink means. When realpath is unavailable both
 * sides fall back to their lexical forms; a case-only mismatch then yields
 * null, never a wrong value. win32 compares case-insensitively because
 * path.win32.relative does, which matches the filesystem.
 *
 * Never throws — this runs on a hook that must never break a session.
 * platform / fs / path are injectable for tests, like normalizeHomedir.
 *
 * @param {string} root   canonical root, exactly as evaluateConsent() returned it
 * @param {string} cwd    process.cwd()
 * @param {{platform?: string, fs?: (object|null), path?: object}} [opts]
 * @returns {string|null}
 */
function cwdRelativeToRoot(root, cwd, opts) {
  try {
    const o = opts || {};
    const platform = o.platform || process.platform;
    const isWin = platform === "win32";
    const fsImpl = o.fs === undefined ? fs : o.fs;
    const P = o.path || (isWin ? path.win32 : path.posix);
    if (typeof root !== "string" || !root || typeof cwd !== "string" || !cwd) return null;
    const physical = (p) => {
      const real = fsImpl ? realpathBestEffort(fsImpl, p) : null;
      return typeof real === "string" && real ? real : p;
    };
    const rel = P.relative(physical(root), physical(cwd));
    if (rel === "") return "";
    if (P.isAbsolute(rel)) return null;
    // A backslash is a legal filename character on POSIX; only win32 splits on it.
    const first = rel.split(isWin ? /[\\/]/ : "/")[0];
    if (first === "..") return null;
    return isWin ? rel.split("\\").join("/") : rel;
  } catch {
    return null;
  }
}

/**
 * Replace the member's own home-directory prefix with "~" so stored lines
 * never carry the account name. Pure; homedir injectable for tests.
 *
 * ⛔ WHY THIS EXISTS. Every projection in TOOL_PROJECTIONS emits a real path —
 * `Read: /Users/<name>/Projects/x/y.ts`, `Edit: C:\Users\<name>\MMAI\y.ts` —
 * and the home segment of that path is the member's OS account name. It is not
 * work content, nobody reading the worklog needs it, and it was going into a
 * database row on every single tool call. `~` is the same information minus
 * the name.
 *
 * ⛔ SEGMENT BOUNDARY, NOT STRING PREFIX. With a homedir of `/home/x`, the path
 * `/home/xy/a` belongs to a DIFFERENT person and is left exactly as it was —
 * hence the lookahead rather than a `startsWith`/`split` rewrite. The lookahead
 * also means the separator (or quote, or comma) that follows the prefix
 * survives untouched, so `KEY="/home/x/a"` keeps its quotes and its shape.
 *
 * ⛔ PLATFORM RULES ARE PARAMETERS, not ambient reads — same reasoning as
 * mm-path-scope below. Case is folded on win32 only, where the filesystem folds
 * it too; on linux `/home/Rob` and `/home/rob` really are two folders. win32
 * also accepts either slash, because a path arrives as `C:\Users\<name>` from a
 * shell and as `C:/Users/<name>` from anything that normalised it first.
 *
 * Never throws — this runs on a hook that must never break a session.
 *
 * @param {string} text
 * @param {string} [homedir]   default os.homedir()
 * @param {string} [platform]  default process.platform
 * @returns {string}
 */
function normalizeHomedir(text, homedir, platform) {
  if (typeof text !== "string" || text.length === 0) return text;
  try {
    const isWin = (platform || process.platform) === "win32";
    let home = homedir;
    if (home === undefined || home === null) {
      try {
        home = os.homedir();
      } catch {
        return text;
      }
    }
    if (typeof home !== "string") return text;
    // Trailing separators are noise. A homedir that is ONLY separators, or a
    // bare drive root, would rewrite every absolute path on the machine — bail
    // rather than mangle the whole line.
    home = home.replace(/[\\/]+$/, "");
    if (!home || /^[A-Za-z]:$/.test(home)) return text;

    const parts = isWin ? home.split(/[\\/]/) : home.split("/");
    const body = parts
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(isWin ? "[\\\\/]" : "/");
    const re = new RegExp(body + "(?=[\\\\/\\s\"'`)\\],:]|$)", isWin ? "gi" : "g");
    return text.replace(re, "~");
  } catch {
    return text;
  }
}

/**
 * JSON.stringify replacer that runs every STRING VALUE of an outbound body
 * through normalizeHomedir. Both senders use it, so a field added to either
 * payload later is covered without anyone remembering to be careful.
 *
 * ⛔ IT HAS TO BE A REPLACER, NOT A PASS OVER THE SERIALISED TEXT. In JSON,
 * `C:\Users\name` is written `"C:\\Users\\name"` — a text-level pass over the
 * finished string sees doubled backslashes and matches nothing, which would
 * fail silently and only on win32, where six of nine members are.
 *
 * ⛔ ORDER: scrub, THEN normalize. Each value reaching this point has already
 * been through scrubText/scrubValue; the scrubber's path-exclusion logic reads
 * real paths, so normalizing first would change what it sees.
 */
function homedirReplacer(key, value) {
  return typeof value === "string" ? normalizeHomedir(value) : value;
}

// ===== BEGIN GENERATED — secret scrubber (source: src/lib/ext/secret-scrubber.js) =====
//
// ⛔ DO NOT EDIT THIS BLOCK BY HAND. Edit src/lib/ext/secret-scrubber.js,
// then run `node scripts/generate-scrubber-snippet.mjs --write`.
// tests/unit/secret-scrubber-hook-sync.unit.test.ts is the guard.
// ⛔ CANONICAL SOURCE — do not fork this logic.
//
// This file is the ONE authored copy of the worklog secret scrubber. Two
// consumers share it:
//
//   1. src/app/api/ext/worklog/route.ts imports it directly and scrubs every
//      POST body BEFORE the time_worklogs insert. This is the load-bearing
//      copy: it protects every member immediately, including the ones running
//      an old hook, because the server is the only thing both of them touch.
//   2. .claude/scripts/worklog-hook.js carries a MECHANICALLY GENERATED inline
//      copy of everything below, between the BEGIN/END GENERATED markers.
//      The hook is delivered to members as ONE downloaded file
//      (GET /api/ext/hook-install?file=hook), so it cannot `import` or
//      `require` anything — the code has to be inlined. It is regenerated by
//      `node scripts/generate-scrubber-snippet.mjs --write` and guarded
//      byte-for-byte by tests/unit/secret-scrubber-hook-sync.unit.test.ts.
//
// ⛔ CONSTRAINTS THIS FILE MUST KEEP (the generator is a two-rule text
//    transform — `export function` → `function`, `export const` → `const` —
//    and nothing else):
//      * plain JavaScript, no TypeScript syntax (types live in JSDoc)
//      * zero imports, zero requires, zero Node built-ins
//      * every top-level declaration is `export function` or `export const`
//      * ES2019 syntax only — the hook runs on whatever node the member has
//      * no named capture groups, no lookbehind (older V8 on some installs)
//
// ⛔ WHY THIS EXISTS (2026-08-31)
//
// POST /api/ext/worklog called its own payload "the redacted markdown work
// log" in its docstring and then inserted it verbatim. Nothing redacted
// anything, anywhere, ever. The hook's PostToolUse branch reports each tool
// call as `Bash: ${truncate(input.command, 200)}` — the raw command line — so
// every `export SUPABASE_SERVICE_ROLE_KEY="sb_secret_…" && …` a member or an
// agent ran went into a database table as plain text. A survey of the live
// table on 2026-08-31 found live-shaped values for the Supabase service-role
// key, the Anthropic API key, a Supabase personal access token and a 32-char
// bearer secret sitting in `content_md`.
//
// ⛔ A PREFIX LIST IS A DENYLIST AND FAILS OPEN ON THE NEXT VENDOR. That is why
// layer 3 below exists: any high-entropy token that sits next to a
// credential-ish NAME (an assignment, an auth header, a credential query
// param, an object field) is redacted on shape alone, whoever issued it.
// Tuned against the real corpus — see the measurement in the PR.

/** Marker written in place of every redacted value. Greppable on purpose. */
const REDACTION_PREFIX = "[REDACTED:";

/** Characters a credential body is allowed to be made of. */
const CREDENTIAL_BODY = "A-Za-z0-9_\\-.~+/=";

/**
 * Charset for the layer-3 shape backstop. Deliberately NARROWER than
 * CREDENTIAL_BODY: "/" is excluded so that a filesystem path or a
 * `repo/path/file.sql` argument can never satisfy it. Known vendor keys that
 * do contain "/" (JWTs do not; standard-base64 secrets can) are caught by
 * their own layer-1 pattern, which is where vendor-specific knowledge belongs.
 */
const BACKSTOP_BODY = "A-Za-z0-9_\\-.~+=";

/**
 * Minimum length before the shape-only backstop (layer 3) will consider a
 * token secret. 16 is below a UUID (36) and below every vendor key we have
 * seen, and above the short flag values (`--limit=50`, `KEY=AAA=Aaaa`) that
 * dominate the false-positive side of the real corpus.
 */
const MIN_ENTROPY_LEN = 16;

/**
 * Minimum Shannon entropy, in bits per character, for the layer-3 backstop.
 * 3.0 is deliberately below lowercase hex (4.0) and below a UUID (~3.7) so
 * that the tracker token — which IS a bare UUID and IS a credential — is
 * caught, while English words (~2.5 and falling with length) are not.
 */
const MIN_ENTROPY_BITS = 3.0;

/**
 * Identifier segments that make a name credential-ish. Matched as WHOLE
 * segments after splitting on non-alphanumerics and camelCase boundaries, so
 * `MONKEY` is not a `KEY` and `KEYBOARD` is not a `KEY`.
 */
const CREDENTIAL_WORDS = [
  "KEY",
  "APIKEY",
  "TOKEN",
  "SECRET",
  "SECRETS",
  "PASSWORD",
  "PASSWD",
  "PWD",
  "CREDENTIAL",
  "CREDENTIALS",
  "AUTH",
  "AUTHORIZATION",
  "BEARER",
  "PAT",
  "SESSIONID",
  "COOKIE",
];

/**
 * Layer 1 — known vendor key shapes.
 *
 * Every pattern requires a real body after the prefix, which is what keeps the
 * scrubber off the huge number of rows where these prefixes appear only inside
 * a grep pattern (`grep -E 'sb_secret_[A-Za-z0-9]{10,}'`) or a shape-gate test
 * (`sb_secret_ABCDEF`). `[` and `|` are not credential-body characters, so a
 * regex literal never satisfies the minimum body length.
 */
const VENDOR_PATTERNS = [
  // PEM private keys — whole block, and an unterminated header on its own.
  {
    label: "private-key",
    re: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?-----END [A-Z ]{0,40}PRIVATE KEY-----/g,
  },
  { label: "private-key", re: /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----/g },

  // JSON Web Tokens. Three-segment first, then a two-segment form — the hook
  // truncated tool calls at 200 characters, so the corpus is full of JWTs
  // whose signature was sliced off. A header+payload with no signature still
  // carries the role claim and is still not something to keep.
  {
    label: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g },

  // ⛔ TRUNCATION-AWARE TIER. The hook stores `truncate(command, 200)`, so a key
  // that starts near character 190 reaches the database as a STUB —
  // `sk-ant-api03-7C6` and nothing more. Measured on the live table: exactly
  // that row exists, and a 16-character-body rule walked straight past it.
  // These prefixes are unambiguous enough to redact on a body of 3, because
  // nothing writes them except the vendor. A grep pattern is still safe: the
  // next character there is `[` or `|`, which is not a body character.
  { label: "anthropic-key", re: /\bsk-ant-(?:api|admin)[0-9]{0,3}-[A-Za-z0-9_-]{3,}/g },
  { label: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{6,}/g },
  { label: "supabase-publishable-key", re: /\bsb_publishable_[A-Za-z0-9_-]{6,}/g },
  { label: "supabase-access-token", re: /\bsbp_(?:v[0-9]_)?[A-Za-z0-9]{8,}/g },
  // A JWT whose first `.` was sliced off by truncation. The header alone is
  // ~36 characters, so a 30-character body means real token material, while
  // `eyJ[A-Za-z0-9_-]{20,}` inside a grep pattern stops at the `[`.
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{30,}/g },

  // Supabase
  { label: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  {
    label: "supabase-publishable-key",
    re: /\bsb_publishable_[A-Za-z0-9_-]{16,}/g,
  },
  { label: "supabase-access-token", re: /\bsbp_v0_[A-Za-z0-9]{32,}/g },
  { label: "supabase-access-token", re: /\bsbp_[A-Za-z0-9]{32,}/g },

  // Anthropic / OpenAI
  { label: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { label: "openai-key", re: /\bsk-proj-[A-Za-z0-9_-]{16,}/g },
  { label: "openai-key", re: /\bsk-svcacct-[A-Za-z0-9_-]{16,}/g },
  { label: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}/g },

  // Stripe
  { label: "stripe-key", re: /\b[srp]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { label: "stripe-key", re: /\bwhsec_[A-Za-z0-9]{16,}/g },

  // GitHub / GitLab
  { label: "github-token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { label: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { label: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{16,}/g },

  // Slack / Discord
  { label: "slack-token", re: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g },
  { label: "slack-webhook", re: /\bhooks\.slack\.com\/services\/[A-Za-z0-9/_+-]{20,}/g },
  {
    label: "discord-bot-token",
    re: /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g,
  },

  // AWS / Google
  { label: "aws-access-key-id", re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g },
  // {20,} rather than the exact {35}: a truncated tail is still a key.
  { label: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{20,}/g },
  { label: "google-oauth-token", re: /\bya29\.[A-Za-z0-9_-]{20,}/g },

  // Assorted vendors seen in Massmarket runbooks.
  { label: "sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { label: "huggingface-token", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { label: "npm-token", re: /\bnpm_[A-Za-z0-9]{32,}/g },
  { label: "digitalocean-token", re: /\bdop_v1_[a-f0-9]{60,}/g },
  { label: "shopify-token", re: /\bshpat_[a-f0-9]{32}\b/g },
  { label: "apify-token", re: /\bapify_api_[A-Za-z0-9]{20,}/g },
  { label: "twilio-sid", re: /\bAC[a-f0-9]{32}\b/g },
  { label: "highlevel-pit", re: /\bpit-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g },
];

/** Shannon entropy of a string, in bits per character. */
function shannonEntropy(value) {
  if (!value) return 0;
  var counts = Object.create(null);
  var i;
  for (i = 0; i < value.length; i++) {
    var ch = value.charAt(i);
    counts[ch] = (counts[ch] || 0) + 1;
  }
  var bits = 0;
  var keys = Object.keys(counts);
  for (i = 0; i < keys.length; i++) {
    var p = counts[keys[i]] / value.length;
    bits -= p * (Math.log(p) / Math.LN2);
  }
  return bits;
}

/** Strip one layer of matching surrounding quotes. */
function stripQuotes(value) {
  if (value.length >= 2) {
    var first = value.charAt(0);
    var last = value.charAt(value.length - 1);
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      return value.slice(1, -1);
    }
    if (first === '"' || first === "'" || first === "`") return value.slice(1);
  }
  return value;
}

/**
 * Layer 3 — the shape-only backstop.
 *
 * Answers one question: given that this token already sits next to a
 * credential-ish NAME, does it look like credential MATERIAL rather than a
 * path, a shell variable, a regex fragment, a URL, a flag, or a timestamp?
 *
 * Every `false` branch here is a false positive that was measured on the live
 * corpus, not a hypothetical. The big ones: `KEY="/Users/robeason/Projects/…"`
 * (a file path assigned to a variable literally named KEY, ~100 occurrences),
 * `TOKEN=$(…)` command substitutions (~280), `KEY=$SOMETHING` variable
 * references (~115), and sed/grep fragments like
 * `SUPABASE_SERVICE_ROLE_KEY="?[^"]+'`.
 *
 * @param {string} raw candidate token, quotes optional
 * @returns {boolean}
 */
function looksLikeSecret(raw) {
  if (typeof raw !== "string") return false;
  var value = stripQuotes(raw.trim());
  if (value.length < MIN_ENTROPY_LEN) return false;
  // A value longer than any real credential is a blob, not a key.
  if (value.length > 4096) return false;

  // Shell variable reference / command substitution / Windows %VAR%.
  if (/[$`%]/.test(value)) return false;

  // A UUID is low-entropy by symbol count but IS the shape of a Massmarket
  // tracker token, and on this spine a tracker token is identity. Checked
  // before the word/identifier heuristics because a hex UUID can otherwise
  // read as `deadbeef-cafe-…` wordy.
  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      value,
    )
  ) {
    return true;
  }

  // Filesystem paths and URLs. Paths are excluded twice over: by the leading
  // form, and by dropping "/" from the body charset below — measured against
  // the live corpus, `KEY="/Users/robeason/Projects/…"` (a file path in a
  // variable literally named KEY) is the single largest false-positive class
  // there is, and `git cat-file -e $SHA:supabase/migrations/x.sql` is the
  // second.
  if (/^[/~]/.test(value)) return false;
  if (/^\.{1,2}[/\\]/.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return false;

  // Anything that is not pure credential body is punctuation-bearing text: a
  // regex, a JSON fragment, a sed script, a colon-joined composite id, a path.
  if (!new RegExp("^[" + BACKSTOP_BODY + "]+$").test(value)) return false;

  // A dotted identifier path is CODE, not a credential:
  // `process.env.SUPABASE_SERVICE_ROLE_KEY`, `os.path.getmtime`,
  // and PostgREST filter values like `eq.knowledge_base`.
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(value)) {
    return false;
  }

  // Separator-joined lowercase WORDS are identifiers, not key material:
  // `payout_gate`, `knowledge_base`, `contact-routing`. Every segment has to
  // read like a word (has a vowel, short enough) for this to fire, so a
  // lowercase hex digest — one segment, no separator — is untouched.
  if (isWordyIdentifier(value)) return false;

  // Structured, low-secret shapes: ISO timestamps, and values that are almost
  // entirely digits and separators (composite ids like
  // `BURST_KEY=1756312345:1756399999:2026-08-27T09:00:00.000Z`).
  if (/\d{4}-\d{2}-\d{2}/.test(value)) return false;
  var nonAlpha = value.replace(/[A-Za-z]/g, "").length;
  if (nonAlpha / value.length >= 0.7) return false;

  // Real key material mixes character classes. A single-class string of any
  // length is a word, a constant, or a placeholder — never a modern API key.
  // (Lowercase hex passes: lowercase + digits is two classes.)
  var classes = 0;
  if (/[a-z]/.test(value)) classes++;
  if (/[A-Z]/.test(value)) classes++;
  if (/[0-9]/.test(value)) classes++;
  if (classes < 2) return false;

  // A single repeated character is a placeholder (`AAAAAAAAAAAAAAAA`).
  if (/^(.)\1*$/.test(value)) return false;

  return shannonEntropy(value) >= MIN_ENTROPY_BITS;
}

/**
 * Is this value a separator-joined run of lowercase words — an identifier,
 * a slug, a column value — rather than key material?
 *
 * @param {string} value
 * @returns {boolean}
 */
function isWordyIdentifier(value) {
  if (!/^[a-z0-9]+([._-][a-z0-9]+)+$/.test(value)) return false;
  var segments = value.split(/[._-]/);
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (seg.length > 20) return false;
    if (/^[0-9]+$/.test(seg)) continue;
    // `v2`, `id`, `x1` — a short qualifier segment, not entropy.
    if (seg.length <= 3) continue;
    if (!/[aeiouy]/.test(seg)) return false;
  }
  return true;
}

/**
 * Does an identifier NAME say "the thing after me is a credential"?
 * Splits on non-alphanumerics and camelCase boundaries and requires a WHOLE
 * segment match, so `monkey`, `keyboard`, `turkey` and `KEY_LEN`'s sibling
 * `KEYBOARD_LAYOUT` are not credential names.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isCredentialName(name) {
  if (typeof name !== "string" || !name) return false;
  var spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  var segments = spaced.toUpperCase().split(/[^A-Z0-9]+/);
  for (var i = 0; i < segments.length; i++) {
    if (!segments[i]) continue;
    for (var j = 0; j < CREDENTIAL_WORDS.length; j++) {
      if (segments[i] === CREDENTIAL_WORDS[j]) return true;
    }
  }
  return false;
}

/** Build the replacement marker for a label. */
function redactionFor(label) {
  return REDACTION_PREFIX + label + "]";
}

/**
 * Scrub one string. Total: it never throws for a string input, and every
 * pattern below is linear (no nested unbounded quantifiers), so it cannot
 * backtrack catastrophically on hostile input.
 *
 * @param {string} text
 * @returns {{ text: string, redactions: string[] }}
 */
function scrubText(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { text: typeof text === "string" ? text : "", redactions: [] };
  }
  var out = text;
  var hits = [];
  var i;

  // ── Layer 1 — known vendor shapes ──────────────────────────────────────
  for (i = 0; i < VENDOR_PATTERNS.length; i++) {
    var pattern = VENDOR_PATTERNS[i];
    pattern.re.lastIndex = 0;
    var label = pattern.label;
    out = out.replace(pattern.re, function () {
      hits.push(label);
      return redactionFor(label);
    });
  }

  // ── Layer 2 — structural positions ─────────────────────────────────────

  // Credentials embedded in a URL: scheme://user:password@host
  out = out.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/:@"']{1,128}):([^\s/@"']{1,256})@/g,
    function (whole, scheme, user) {
      hits.push("url-credentials");
      return scheme + user + ":" + redactionFor("url-password") + "@";
    },
  );

  // Authorization / Proxy-Authorization headers, in any of the forms a curl
  // line writes them: -H "Authorization: Bearer X", 'Authorization:Basic X'.
  out = out.replace(
    /((?:proxy-)?authorization\s*:\s*)(bearer|basic|token|apikey)(\s+)([^\s"'`,;]{6,})/gi,
    function (whole, head, scheme, gap, value) {
      if (/^[$`%]/.test(value)) return whole;
      if (value.indexOf(REDACTION_PREFIX) === 0) return whole;
      hits.push("auth-header");
      return head + scheme + gap + redactionFor("auth-header");
    },
  );

  // A bare `Bearer <token>` with no header name in front of it.
  out = out.replace(
    /\b(Bearer\s+)([^\s"'`,;]{12,})/g,
    function (whole, head, value) {
      if (value.indexOf(REDACTION_PREFIX) === 0) return whole;
      if (!looksLikeSecret(value)) return whole;
      hits.push("bearer-token");
      return head + redactionFor("bearer-token");
    },
  );

  // Credential-carrying request headers: x-api-key, apikey, x-auth-token, …
  out = out.replace(
    /((?:x-)?(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?token|csrf[-_]?token)\s*:\s*)(["']?)([^\s"'`,;]{8,})/gi,
    function (whole, head, quote, value) {
      if (/^[$`%]/.test(value)) return whole;
      if (value.indexOf(REDACTION_PREFIX) === 0) return whole;
      if (!looksLikeSecret(value)) return whole;
      hits.push("api-key-header");
      return head + quote + redactionFor("api-key-header");
    },
  );

  // Credential-carrying query parameters.
  out = out.replace(
    /([?&](?:access_token|refresh_token|api_key|apikey|auth_token|token|secret|password|signature)=)([^&\s"'`#]{8,})/gi,
    function (whole, head, value) {
      if (/^[$`%]/.test(value)) return whole;
      if (value.indexOf(REDACTION_PREFIX) === 0) return whole;
      if (!looksLikeSecret(value)) return whole;
      hits.push("query-credential");
      return head + redactionFor("query-credential");
    },
  );

  // ── Layer 3 — NAME = high-entropy VALUE, whoever the vendor is ─────────
  //
  // This is the part that does not fail open on the next vendor. The name
  // gate (isCredentialName) plus looksLikeSecret is what keeps it off the
  // ~500 legitimate `KEY=`/`TOKEN=` rows in the live corpus that hold paths,
  // `$(…)` substitutions, `$VARS` and sed fragments.
  out = out.replace(
    /([A-Za-z_][A-Za-z0-9_.-]{0,60})(\s*[:=]\s*)(["'`]?)([^\s"'`,;&]{8,})/g,
    function (whole, name, sep, quote, value) {
      if (value.indexOf(REDACTION_PREFIX) === 0) return whole;
      if (!isCredentialName(name)) return whole;
      if (!looksLikeSecret(value)) return whole;
      hits.push("credential-assignment");
      return name + sep + quote + redactionFor("credential-assignment");
    },
  );

  return { text: out, redactions: hits };
}

/**
 * Strict re-scan used for the FAIL-CLOSED check. Runs only the
 * high-confidence vendor patterns — a residual hit here means the scrubber
 * did not do its job and the content must not be stored.
 *
 * @param {string} text
 * @returns {string[]} labels of surviving matches
 */
function findResidualSecrets(text) {
  if (typeof text !== "string" || !text) return [];
  var found = [];
  for (var i = 0; i < VENDOR_PATTERNS.length; i++) {
    var pattern = VENDOR_PATTERNS[i];
    pattern.re.lastIndex = 0;
    if (pattern.re.test(text)) found.push(pattern.label);
    pattern.re.lastIndex = 0;
  }
  return found;
}

/**
 * Redact FIRST, then truncate.
 *
 * Order is the whole point. `truncate(cmd, 200)` followed by redaction leaves
 * the first 200 characters of a key on the wire and in the row; redaction
 * followed by truncation leaves a marker. If the cut would land inside a
 * `[REDACTED:…]` marker, the cut moves back to before the marker so a partial
 * marker never reaches storage.
 *
 * @param {*} value
 * @param {number} max
 * @returns {string}
 */
function scrubAndTruncate(value, max) {
  var s = scrubText(String(value === undefined || value === null ? "" : value)).text;
  if (s.length <= max) return s;
  var cut = max;
  var openAt = s.lastIndexOf(REDACTION_PREFIX, cut);
  if (openAt !== -1) {
    var closeAt = s.indexOf("]", openAt);
    if (closeAt === -1 || closeAt >= cut) cut = openAt;
  }
  return s.slice(0, cut) + "…";
}

/**
 * Walk a tool-input object and scrub it STRUCTURALLY, before anything
 * stringifies it.
 *
 * `JSON.stringify(input)` then redact misses structure: a field named
 * `apiKey` whose value is an unremarkable-looking 20-character string is
 * invisible to a text scan but obvious here. Depth- and size-bounded, and
 * cycle-safe.
 *
 * @param {*} value
 * @param {number} [depth]
 * @param {*[]} [seen]
 * @returns {*}
 */
function scrubValue(value, depth, seen) {
  var d = depth || 0;
  var stack = seen || [];
  if (d > 8) return "[REDACTED:depth-limit]";
  if (value === null || value === undefined) return value;

  var type = typeof value;
  if (type === "string") return scrubText(value).text;
  if (type === "number" || type === "boolean") return value;
  if (type !== "object") return "[REDACTED:unsupported]";

  if (stack.indexOf(value) !== -1) return "[REDACTED:cycle]";
  stack.push(value);

  var result;
  var i;
  if (Array.isArray(value)) {
    result = [];
    for (i = 0; i < value.length && i < 500; i++) {
      result.push(scrubValue(value[i], d + 1, stack));
    }
  } else {
    result = {};
    var keys = Object.keys(value);
    for (i = 0; i < keys.length && i < 500; i++) {
      var key = keys[i];
      var child = value[key];
      if (isCredentialName(key) && typeof child === "string" && child.length >= 8) {
        // A credential-NAMED field is redacted whole, entropy or not. The
        // field name is a stronger signal than the value's shape.
        result[key] = redactionFor("credential-field");
      } else {
        result[key] = scrubValue(child, d + 1, stack);
      }
    }
  }
  stack.pop();
  return result;
}

/**
 * The one entry point a caller should reach for.
 *
 * FAIL-CLOSED: `ok` is false when the input could not be scanned at all (not a
 * string, over the byte budget, the scrubber threw) or when a credential
 * survived the scrub. A false `ok` means REJECT the write — never store
 * `text`, and never fall back to the original.
 *
 * @param {*} input
 * @param {{ maxBytes?: number }} [options]
 * @returns {{ ok: boolean, text: string, redactions: string[], reason: string|null }}
 */
function scrubForStorage(input, options) {
  var opts = options || {};
  var maxBytes = typeof opts.maxBytes === "number" ? opts.maxBytes : 512 * 1024;

  if (typeof input !== "string") {
    return { ok: false, text: "", redactions: [], reason: "not_a_string" };
  }
  // Budget the scan. A string this size cannot be a work log, and an
  // unbounded scan is the other way this route falls over.
  if (input.length > maxBytes) {
    return { ok: false, text: "", redactions: [], reason: "over_scan_budget" };
  }

  var scrubbed;
  try {
    scrubbed = scrubText(input);
  } catch (err) {
    return {
      ok: false,
      text: "",
      redactions: [],
      reason: "scrub_threw:" + (err && err.message ? String(err.message).slice(0, 120) : "unknown"),
    };
  }

  var residual;
  try {
    residual = findResidualSecrets(scrubbed.text);
  } catch (err) {
    return { ok: false, text: "", redactions: [], reason: "verify_threw" };
  }
  if (residual.length > 0) {
    return {
      ok: false,
      text: "",
      redactions: scrubbed.redactions,
      reason: "residual_secret:" + residual.join(","),
    };
  }

  return {
    ok: true,
    text: scrubbed.text,
    redactions: scrubbed.redactions,
    reason: null,
  };
}
// ===== END GENERATED — secret scrubber =====

// ===== BEGIN GENERATED — consent gate (source: src/lib/ext/mm-path-scope.js + src/lib/ext/hook-consent.js) =====
//
// ⛔ DO NOT EDIT THIS BLOCK BY HAND. Edit the files under src/lib/ext/ named
// in scripts/generate-consent-snippet.mjs SOURCES, then run
// `node scripts/generate-consent-snippet.mjs --write`.
// tests/unit/hook-consent-sync.unit.test.ts is the guard.
// ── mm-path-scope.js ────────────────────────────────────────────────────────
// ⛔ CANONICAL SOURCE — do not fork this logic.
//
// This file is the ONE authored copy of the worklog hook's PATH ENGINE: "is
// this session's working directory at or below a folder the member named?",
// and "may this folder be named at all?". Three consumers share it:
//
//   1. src/lib/ext/hook-consent.js builds its gate on top of it. It has no
//      path logic of its own and must never grow any.
//   2. .claude/scripts/worklog-hook.js carries a MECHANICALLY GENERATED inline
//      copy of everything below. The hook reaches members as ONE downloaded
//      file (GET /api/ext/hook-install?file=hook) embedded verbatim into a TS
//      template string, so it cannot `import` or `require` anything — the code
//      has to be inlined. It is regenerated by
//      `node scripts/generate-consent-snippet.mjs --write` and guarded
//      byte-for-byte by tests/unit/hook-consent-sync.unit.test.ts.
//   3. tests/unit/mm-path-scope.unit.test.ts and
//      tests/unit/mm-path-scope-decision-table.unit.test.ts import it directly
//      and drive it with `platform: "win32"` / `"linux"` / `"darwin"`. That is
//      why every platform-dependent decision is a PARAMETER rather than an
//      ambient read: SIX OF NINE members are on win32 and one is on linux, so
//      a darwin-only bench ships the majority of the team untested code.
//
// ⛔ CONSTRAINTS THIS FILE MUST KEEP (see scripts/generate-consent-snippet.mjs):
//      * plain JavaScript, no TypeScript syntax (types live in JSDoc)
//      * zero imports, zero requires — Node built-ins arrive through
//        MM_PATH_SCOPE_DEPS or per-call options
//      * every top-level declaration is `export function` or `export const`
//      * ES2019 syntax only — the hook runs on whatever node the member has
//      * no named capture groups, no lookbehind (older V8 on some installs)
//
// ⛔ PROVENANCE. This is the consolidated cross-platform matcher built and
// adversarially tested out-of-tree on 2026-08-31 (101 path assertions with
// 13/13 mutants killed, plus a 50-row decision table executed against all
// three platforms). It was brought in WHOLESALE rather than re-derived; the
// only deliberate behavioural change on import is the symlinkPolicy default,
// marked ⛔ OPUS DECISION at its site below. Its predecessor — a hand-rolled
// matcher living inside hook-consent.js — is deleted, not kept alongside.

/**
 * mm-path-scope — "is this cwd at or below an allowed root?", correct on
 * Windows, Linux and macOS.
 *
 * Written for the Massmarket worklog hook's folder-scoped mode. The hook runs on
 * every PostToolUse in every member's session, so this module obeys the hook's
 * two non-negotiables: it NEVER throws, and it never needs the filesystem to
 * produce an answer (filesystem access is a strictly optional refinement).
 *
 * ── WHY THIS IS NOT `cwd.startsWith(root)` ──────────────────────────────────
 * The measured team roots contain a live counterexample:
 *
 *     H9 / Mahfuz : F:\MMAI          (and F:\MMAI\MMAI)
 *     Antu / Asif : F:\MMAI Project
 *
 *   "F:\\MMAI Project".startsWith("F:\\MMAI")  === true
 *
 * A prefix matcher silently files Antu's and Asif's sessions under H9's root.
 * Every comparison in this module is therefore done on a normalized SEGMENT
 * ARRAY, never on a raw string.
 *
 * ── WHY THIS DOES NOT CALL path.win32.resolve() ─────────────────────────────
 * `path.win32.resolve(p)` falls back to `process.cwd()` for a non-absolute `p`.
 * On a macOS or Linux host that grafts a POSIX cwd onto a Windows path and
 * invents an absolute path that never existed. This module parses paths itself,
 * so its Windows behaviour is identical on every host and is fully testable
 * from a Mac. It uses `path` only for `sep` cosmetics.
 *
 * ── PLATFORM POLICY SUMMARY ─────────────────────────────────────────────────
 *
 *  Case folding — EVIDENCE BEATS DEFAULT, on every platform (see caseFoldPolicy):
 *    The per-volume answer is PROBED once per root, read-only: two stat()s
 *    comparing dev+ino of the root against the root with one letter's case
 *    flipped. Nothing is created, written or unlinked — a hook has no business
 *    writing into a member's directory to answer a question, and a write probe
 *    fails on a read-only mount and litters if the process dies mid-probe.
 *    The platform default below applies only when the probe is inconclusive
 *    (root missing, EACCES, no letter to flip):
 *      win32   fold. NTFS/ReFS and the whole Win32 API are case-insensitive. Not
 *              folding breaks the common real case: a root recorded as `F:\MMAI`
 *              and a cwd arriving as `f:\mmai` from a shell or a tab-completion.
 *      darwin  fold. APFS ships case-insensitive.
 *      linux   do NOT fold. ext4/xfs/btrfs are case-sensitive; `~/Work` and
 *              `~/work` are two different real directories, and folding merges the
 *              personal one into the sanctioned one — the exact privacy failure
 *              folder-scoped mode exists to prevent.
 *    All three defaults are wrong for a real minority of volumes, which is why the
 *    probe is not darwin-only: macOS can be formatted case-sensitive APFS (proven
 *    in case-sensitive-volume.test.js against a real hdiutil volume, where a
 *    hardcoded fold demonstrably leaks a sibling private directory), Windows has
 *    had per-directory case sensitivity since 1803 plus WSL-backed shares, and
 *    Linux ext4 has had the casefold feature since 5.2.
 *
 *  Unicode normalization:
 *    darwin  NFC-normalize both sides. HFS+ stored NFD and APFS compares
 *            normalization-insensitively, so the same directory can reach us as
 *            NFC from one source and NFD from another.
 *    linux   never. ext4 compares bytes; NFC and NFD are different filenames.
 *    win32   never. NTFS compares UTF-16 code units.
 *
 * ── ROOT SAFETY POLICY ──────────────────────────────────────────────────────
 * The rule is SET MEMBERSHIP, not segment depth. A depth heuristic ("must be at
 * least two segments deep") is POSIX-shaped and refuses `F:\MMAI` — a drive plus
 * ONE segment — which is the real work root of four of the six Windows members.
 * A root is refused when it IS:
 *    (a) a filesystem root or a bare drive root        `/`      `C:\`  `F:\`  `F:`
 *    (b) a container whose children are separate user
 *        or volume namespaces                          `/home` `/Users` `/Volumes`
 *                                                      `/mnt` `/media` `C:\Users`
 *    (c) a user's home directory itself                `/home/shezan` `C:\Users\Antu`
 *    (d) an OS-owned system directory                   `/usr` `C:\Windows`
 * Anything deeper is the member's own organization and is not our business.
 * Consequence: `F:\MMAI` ALLOWED, `F:\` REFUSED, `/home/shinzuu/Documents/massmarket`
 * ALLOWED, `/home/shinzuu` REFUSED, `/Users/efaz/Efaz Work` ALLOWED.
 *
 * Deliberate documented asymmetry: a POSIX volume mounted one level below a
 * container (`/Volumes/Work`, `/media/shezan/USB`, `/mnt/data`) is ALLOWED while a
 * Windows bare drive root (`F:\`) is REFUSED. On POSIX the mount point is a named
 * directory a human chose; on Windows the volume IS the namespace root, it carries
 * no name, and `C:\` — an observed real cwd for a departed member — is the whole
 * operating system. Set `allowVolumeRoot: true` to lift the Windows refusal.
 */

/**
 * Node built-ins, injected rather than required.
 *
 * The hook assigns these once at startup (`MM_PATH_SCOPE_DEPS.fs = require("fs")`);
 * the repo-side tests assign them the same way or pass `fs` / `homedir` per call.
 * Leaving them null is not a crash: every filesystem refinement below degrades
 * to "no evidence", which lands on the lexical answer — the fail-closed one.
 *
 * @type {{ fs: (object|null), os: (object|null), platform: (string|undefined) }}
 */
const MM_PATH_SCOPE_DEPS = {
  fs: null,
  os: null,
};

const REASON = Object.freeze({
  OK: "ok",
  NOT_A_STRING: "path_not_a_string",
  EMPTY: "path_empty",
  RELATIVE: "path_not_absolute",
  DRIVE_RELATIVE: "path_drive_relative",
  ROOT_RELATIVE: "path_rooted_without_drive",
  DEVICE_NAMESPACE: "path_device_namespace",
  UNC_INCOMPLETE: "path_unc_incomplete",
  NO_ROOTS: "no_roots_configured",
  NOT_UNDER_ROOT: "not_under_any_root",
  DIFFERENT_VOLUME: "different_volume",
  ROOT_FILESYSTEM_ROOT: "root_is_filesystem_root",
  ROOT_VOLUME_ROOT: "root_is_volume_root",
  ROOT_USER_CONTAINER: "root_is_user_container",
  ROOT_HOME_DIRECTORY: "root_is_home_directory",
  ROOT_SYSTEM_DIRECTORY: "root_is_system_directory",
  ROOT_SHARE_ROOT: "root_is_share_root",
  ROOT_SYNC_ROOT: "root_is_sync_root",
  // Added on repo integration (2026-08-31): three predicates the gate this
  // module replaced already had, folded in here so there is still exactly ONE
  // root-safety implementation rather than a matcher plus a leftover.
  NUL_BYTE: "path_contains_nul",
  ROOT_CONFIG_DIRECTORY: "root_is_config_directory",
  ROOT_CONTAINS_HOME: "root_contains_home_directory",
});

// ── refusal tables ──────────────────────────────────────────────────────────
// Compared against FOLDED segments, so every entry here is lowercase.

const WIN32_SYSTEM_TOP = new Set([
  "windows",
  "winnt",
  "program files",
  "program files (x86)",
  "programdata",
  "$recycle.bin",
  "system volume information",
  "recovery",
  "perflogs",
]);
const WIN32_USER_CONTAINERS = new Set(["users", "documents and settings"]);

const DARWIN_SYSTEM_TOP = new Set([
  "system",
  "library",
  "applications",
  "private",
  "tmp",
  "var",
  "usr",
  "bin",
  "sbin",
  "etc",
  "dev",
  "opt",
  "cores",
  "net",
  "home",
]);
const DARWIN_CONTAINERS = new Set(["users", "volumes"]);

const LINUX_SYSTEM_TOP = new Set([
  "usr",
  "etc",
  "var",
  "opt",
  "srv",
  "proc",
  "sys",
  "dev",
  "boot",
  "bin",
  "sbin",
  "lib",
  "lib64",
  "tmp",
  "root",
  "snap",
  "lost+found",
]);
// Containers whose immediate children are separate namespaces.
// `/media/<user>` is a second-level container on modern udisks2 desktops.
const LINUX_CONTAINERS = new Set(["home", "mnt", "media", "run"]);

// ── small helpers ───────────────────────────────────────────────────────────

function familyOf(platform) {
  return platform === "win32" ? "win32" : "posix";
}

/**
 * Flip the case of the last ASCII letter. Returns null when there is none.
 *
 * C5 (consolidation): callers on win32 MUST pass `floor` = the index at which
 * the device ends, so the probe never flips the DRIVE LETTER. Windows drive
 * letters are case-insensitive unconditionally — even under
 * `fsutil file setCaseSensitiveInfo <dir> enable` — so flipping one produces
 * an "insensitive" answer from evidence that says nothing about the directory.
 */
function flipLastAlpha(s, floor = 0) {
  const stop = typeof floor === "number" ? floor : 0;
  for (let i = s.length - 1; i >= stop; i--) {
    const c = s[i];
    if (c >= "a" && c <= "z") return s.slice(0, i) + c.toUpperCase() + s.slice(i + 1);
    if (c >= "A" && c <= "Z") return s.slice(0, i) + c.toLowerCase() + s.slice(i + 1);
  }
  return null;
}

/**
 * Read-only case-sensitivity probe. true = insensitive, false = sensitive,
 * null = unknown. Never creates, writes or unlinks anything.
 */
function probeCaseInsensitive(fsImpl, absPath, deviceLen) {
  const flipped = flipLastAlpha(absPath, deviceLen);
  if (!flipped || flipped === absPath) return null;
  let a;
  try {
    a = fsImpl.statSync(absPath);
  } catch (_) {
    return null; // the root itself is not there — no evidence either way
  }
  let b;
  try {
    b = fsImpl.statSync(flipped);
  } catch (e) {
    const code = e && e.code;
    // The case-flipped twin genuinely does not exist => case-SENSITIVE.
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    return null; // EACCES, EPERM, EIO, ELOOP … prove nothing
  }
  if (a && b && a.dev === b.dev && a.ino === b.ino) return true;
  return false;
}

/** Best-effort realpath. Returns null instead of throwing, ever. */
function realpathBestEffort(fsImpl, p) {
  if (!fsImpl || typeof fsImpl.realpathSync !== "function") return null;
  // `.native` gives the canonical ON-DISK CASE on Windows and macOS, which is
  // strictly better input for a case comparison. It is also the more brittle of
  // the two (it can reject long paths that the JS implementation tolerates), so
  // it is tried first and never trusted to succeed.
  try {
    if (typeof fsImpl.realpathSync.native === "function") {
      const r = fsImpl.realpathSync.native(p);
      if (typeof r === "string" && r) return r;
    }
  } catch (_) {
    /* fall through */
  }
  try {
    const r = fsImpl.realpathSync(p);
    if (typeof r === "string" && r) return r;
  } catch (_) {
    /* fall through */
  }
  return null;
}

/**
 * POSIX-only, advisory: is `p` itself a mount point? (dev differs from parent.)
 * Not used by the default policy — offered so the INSTALLER can add a refusal
 * the deterministic table cannot express. Returns null when undecidable.
 */
function isMountPointPosix(fsImpl, p) {
  try {
    const here = fsImpl.statSync(p);
    const idx = p.lastIndexOf("/");
    if (idx <= 0) return true; // "/" is a mount point
    const parent = p.slice(0, idx);
    const up = fsImpl.statSync(parent);
    return here.dev !== up.dev;
  } catch (_) {
    return null;
  }
}

// ── canonicalization ────────────────────────────────────────────────────────

function bad(reason) {
  return { ok: false, reason, device: null, segments: null };
}

/**
 * Windows. Returns { ok, reason, device, segments, form }.
 *   device: "C:"  |  "\\\\server\\share"
 *   segments: path components below the device, with "." / ".." resolved.
 */
function canonicalizeWin32(raw) {
  if (typeof raw !== "string") return bad(REASON.NOT_A_STRING);
  let s = raw.trim();
  if (!s) return bad(REASON.EMPTY);
  // A NUL terminates the string at the syscall boundary, so "/work\0/../etc"
  // reaches the kernel as "/work". Anything carrying one is refused outright
  // rather than silently compared as a longer path than the OS will ever see.
  if (s.indexOf("\u0000") !== -1) return bad(REASON.NUL_BYTE);

  // Node on Windows accepts forward slashes everywhere; so does the Win32 API
  // outside the \\?\ namespace. Normalize before any prefix detection so that
  // "//?/C:/x" and "\\?\C:\x" are the same input.
  s = s.replace(/\//g, "\\");

  let form = "drive";

  // Extended-length / device namespaces.
  if (/^\\\\\?\\UNC\\/i.test(s)) {
    s = "\\\\" + s.slice(8); // \\?\UNC\server\share\x  ->  \\server\share\x
    form = "unc-extended";
  } else if (/^\\\\\?\\/.test(s)) {
    const rest = s.slice(4);
    // \\?\Volume{GUID}\... is a volume-GUID path. It names a volume with no
    // drive letter, so it cannot be compared against a drive-lettered root
    // without consulting the mount manager. Refuse rather than guess.
    if (!/^[A-Za-z]:/.test(rest)) return bad(REASON.DEVICE_NAMESPACE);
    s = rest;
    form = "drive-extended";
  } else if (/^\\\\[.?]\\/.test(s)) {
    return bad(REASON.DEVICE_NAMESPACE); // \\.\PhysicalDrive0 etc.
  }

  if (!s) return bad(REASON.EMPTY);

  let device = null;
  let rest = null;

  if (s.startsWith("\\\\")) {
    // UNC: \\server\share[\...]
    const parts = s.slice(2).split("\\").filter(Boolean);
    if (parts.length < 2) return bad(REASON.UNC_INCOMPLETE);
    device = "\\\\" + parts[0] + "\\" + parts[1];
    rest = parts.slice(2);
    if (form === "drive") form = "unc";
  } else if (/^[A-Za-z]:\\/.test(s)) {
    device = s.slice(0, 2);
    rest = s.slice(3).split("\\").filter(Boolean);
  } else if (/^[A-Za-z]:/.test(s)) {
    // "F:" or "F:work" — drive-RELATIVE. Its meaning depends on the per-drive
    // current directory, a per-process Win32 concept Node does not expose.
    // Never guessable, so never matchable.
    return bad(REASON.DRIVE_RELATIVE);
  } else if (s.startsWith("\\")) {
    return bad(REASON.ROOT_RELATIVE); // "\foo" = root of the CURRENT drive
  } else {
    return bad(REASON.RELATIVE);
  }

  // Windows strips trailing dots and spaces from each component:
  // "F:\MMAI Project " and "F:\MMAI Project" are the same directory.
  const segments = [];
  for (const raw2 of rest) {
    let seg = raw2;
    if (seg !== "." && seg !== "..") seg = seg.replace(/[ .]+$/, "");
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (segments.length) segments.pop(); // ".." at the device root stays put
      continue;
    }
    segments.push(seg);
  }

  return { ok: true, reason: REASON.OK, device, segments, form };
}

/** POSIX (linux + darwin). device is always "" — one namespace, one root. */
function canonicalizePosix(raw) {
  if (typeof raw !== "string") return bad(REASON.NOT_A_STRING);
  const s = raw.trim();
  if (!s) return bad(REASON.EMPTY);
  // See canonicalizeWin32: a NUL truncates the path at the syscall boundary.
  if (s.indexOf("\u0000") !== -1) return bad(REASON.NUL_BYTE);
  if (s[0] !== "/") return bad(REASON.RELATIVE);

  const segments = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (segments.length) segments.pop();
      continue;
    }
    segments.push(seg);
  }
  // NOTE: a leading "//" is implementation-defined in POSIX; Linux and macOS
  // both treat it as "/", which is what filtering empties produces.
  return { ok: true, reason: REASON.OK, device: "", segments, form: "posix" };
}

function canonicalize(raw, platform) {
  return familyOf(platform) === "win32" ? canonicalizeWin32(raw) : canonicalizePosix(raw);
}

function renderCanonical(c, platform) {
  if (!c || !c.ok) return null;
  if (familyOf(platform) === "win32") {
    // The DISPLAY form upper-cases a drive letter so a root recorded from
    // `f:\mmai` and one recorded from `F:\MMAI` are one string in consent.json
    // rather than two entries a member cannot tell apart. Windows drive letters
    // are case-insensitive unconditionally, so this loses nothing; comparison
    // never depends on it (the device is folded before every compare).
    const device = /^[A-Za-z]:$/.test(c.device) ? c.device.toUpperCase() : c.device;
    return device + "\\" + c.segments.join("\\");
  }
  return "/" + c.segments.join("/");
}

// ── folding ─────────────────────────────────────────────────────────────────

function foldOne(s, fold, nfc) {
  let t = s;
  if (nfc) {
    try {
      t = t.normalize("NFC");
    } catch (_) {
      /* keep t */
    }
  }
  // toLowerCase() is locale-INdependent (unlike toLocaleLowerCase), so the
  // Turkish dotless-i hazard does not apply. It is still Unicode default case
  // folding rather than the NTFS upcase table, which can differ for exotic
  // scripts; ASCII and Latin-1 paths — every observed member root — are exact.
  return fold ? t.toLowerCase() : t;
}

function foldCanonical(c, policy, platform) {
  const device =
    familyOf(platform) === "win32" ? String(c.device).toLowerCase() : "";
  return {
    device,
    segments: c.segments.map((s) => foldOne(s, policy.fold, policy.nfc)),
  };
}

// ── root safety policy ──────────────────────────────────────────────────────

function classifySafety(c, platform, opts) {
  const fam = familyOf(platform);
  const segs = c.segments.map((s) => foldOne(s, true, platform === "darwin"));

  if (fam === "win32") {
    const isUnc = String(c.device).startsWith("\\\\");
    if (segs.length === 0) {
      // C1 (consolidation): a bare UNC share root is refused exactly like a
      // bare drive root. `net use F: \\nas\mmai` makes F:\ and \\nas\mmai the
      // SAME directory; allowing one spelling and refusing the other would make
      // the verdict depend on how the member happened to type it. It also
      // removes the need for a \$-share table: \\nas\c$ and \\host\admin$ are
      // share roots and are refused by the same line.
      if (opts.allowVolumeRoot) return { ok: true, reason: REASON.OK };
      return { ok: false, reason: isUnc ? REASON.ROOT_SHARE_ROOT : REASON.ROOT_VOLUME_ROOT };
    }
    if (!isUnc) {
      if (WIN32_USER_CONTAINERS.has(segs[0])) {
        if (segs.length === 1) return { ok: false, reason: REASON.ROOT_USER_CONTAINER };
        if (segs.length === 2) return { ok: false, reason: REASON.ROOT_HOME_DIRECTORY };
      }
      if (segs.length === 1 && WIN32_SYSTEM_TOP.has(segs[0])) {
        return { ok: false, reason: REASON.ROOT_SYSTEM_DIRECTORY };
      }
    }
    return { ok: true, reason: REASON.OK };
  }

  if (segs.length === 0) return { ok: false, reason: REASON.ROOT_FILESYSTEM_ROOT };

  if (platform === "darwin") {
    if (DARWIN_CONTAINERS.has(segs[0])) {
      if (segs.length === 1) return { ok: false, reason: REASON.ROOT_USER_CONTAINER };
      // /Users/<name> is a home directory. /Volumes/<name> is a mounted volume
      // a human named, and is allowed — see the documented asymmetry up top.
      if (segs[0] === "users" && segs.length === 2) {
        return { ok: false, reason: REASON.ROOT_HOME_DIRECTORY };
      }
      // C2 (consolidation): /Volumes/<name> IS a mounted volume root — the
      // darwin analogue of F:\ — and is refused for the same reason, removing
      // the previously documented POSIX/Windows asymmetry.
      if (segs[0] === "volumes" && segs.length === 2 && !opts.allowVolumeRoot) {
        return { ok: false, reason: REASON.ROOT_VOLUME_ROOT };
      }
      return { ok: true, reason: REASON.OK };
    }
    if (segs.length === 1 && DARWIN_SYSTEM_TOP.has(segs[0])) {
      return { ok: false, reason: REASON.ROOT_SYSTEM_DIRECTORY };
    }
    return { ok: true, reason: REASON.OK };
  }

  // linux (and any other POSIX)
  if (LINUX_CONTAINERS.has(segs[0])) {
    if (segs.length === 1) return { ok: false, reason: REASON.ROOT_USER_CONTAINER };
    if (segs[0] === "home" && segs.length === 2) {
      return { ok: false, reason: REASON.ROOT_HOME_DIRECTORY };
    }
    // /media/<user> is a per-user container on udisks2 desktops; the volume
    // lands one level further down.
    if (segs[0] === "media" && segs.length === 2) {
      return { ok: false, reason: REASON.ROOT_USER_CONTAINER };
    }
    // C2 (consolidation): mount points are volume roots on linux too.
    if (!opts.allowVolumeRoot) {
      if (segs[0] === "mnt" && segs.length === 2) {
        return { ok: false, reason: REASON.ROOT_VOLUME_ROOT };
      }
      if (segs[0] === "media" && segs.length === 3) {
        return { ok: false, reason: REASON.ROOT_VOLUME_ROOT };
      }
      if (segs[0] === "run" && segs.length === 4 && segs[1] === "media") {
        return { ok: false, reason: REASON.ROOT_VOLUME_ROOT }; // /run/media/<user>/<vol>
      }
    }
    return { ok: true, reason: REASON.OK };
  }
  if (segs.length === 1 && LINUX_SYSTEM_TOP.has(segs[0])) {
    return { ok: false, reason: REASON.ROOT_SYSTEM_DIRECTORY };
  }
  return { ok: true, reason: REASON.OK };
}

// ── the scope ───────────────────────────────────────────────────────────────

/**
 * @param {object} [options]
 * @param {string} [options.platform]          default process.platform
 * @param {object} [options.fs]                default node:fs (inject to model)
 * @param {object} [options.env]               default process.env (SystemDrive, OneDrive, …)
 * @param {boolean} [options.resolveRootOnClassify]  realpath each root at classify time
 * @param {string} [options.homedir]           default os.homedir()
 * @param {boolean|null} [options.caseInsensitive]  force the fold, skip the probe
 * @param {boolean} [options.probe]            darwin case probe (default true)
 * @param {boolean} [options.enableRealpath]   default: platform === process.platform
 * @param {'either'|'lexical'|'physical'} [options.symlinkPolicy]  default 'physical'
 * @param {boolean} [options.allowVolumeRoot]  permit a bare Windows drive root
 * @param {'deny'|'allow'} [options.emptyRootsMeans]  default 'deny'
 */
function createScope(options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  const fam = familyOf(platform);
  const fsImpl = opts.fs || MM_PATH_SCOPE_DEPS.fs;
  const envImpl = opts.env || (typeof process !== "undefined" ? process.env : {}) || {};
  const resolveRootOnClassify = opts.resolveRootOnClassify !== false;
  const usingInjectedFs = Boolean(opts.fs);
  const homedirRaw =
    opts.homedir !== undefined
      ? opts.homedir
      : (function () {
          try {
            return MM_PATH_SCOPE_DEPS.os ? MM_PATH_SCOPE_DEPS.os.homedir() : null;
          } catch (_) {
            return null;
          }
        })();
  // ⛔ OPUS DECISION (2026-08-31): 'physical', not 'either'.
  //
  // 'either' allows a cwd that matches an allowed root LEXICALLY even when the
  // directory it actually resolves to is somewhere else entirely. A symlink
  // planted inside a sanctioned root that escapes it is precisely the hole an
  // allowlist exists to close, and this whole design is fail-closed everywhere
  // else. The cost is one realpath syscall per distinct cwd per session —
  // bounded by the memo below, and paid on a path that already tolerates a
  // missing filesystem (realpathBestEffort returns null rather than throwing,
  // and a null resolution falls back to the lexical form, which then still has
  // to survive containment).
  //
  // The knob is kept: 'lexical' is the zero-syscall mode for a caller that has
  // already resolved both sides, and 'either' is still reachable for a caller
  // that genuinely wants the union.
  const symlinkPolicy = opts.symlinkPolicy || "physical";
  const allowVolumeRoot = Boolean(opts.allowVolumeRoot);
  const emptyRootsMeans = opts.emptyRootsMeans === "allow" ? "allow" : "deny";
  const probeEnabled = opts.probe !== false;
  // Only touch the real filesystem when the modelled platform IS this host, or
  // when the caller injected an fs to model one. Otherwise a Windows path would
  // be stat()ed against a POSIX kernel and the answer would be noise.
  const enableRealpath =
    opts.enableRealpath !== undefined
      ? Boolean(opts.enableRealpath)
      : usingInjectedFs || platform === process.platform;

  const roots = []; // { input, canonical, display, folded, policy, safety }
  const probeCache = new Map();

  /**
   * Bounded memo of match() results, keyed on the RAW cwd string.
   *
   * The hook calls this on every PostToolUse and a session's cwd is effectively
   * constant, so without a memo a member working outside the roots pays realpath
   * syscalls on every single tool call for an answer that cannot change. It also
   * makes the verdict STABLE for the life of the session, which is the point: a
   * matcher that flips mid-session because a symlink appeared would produce a
   * half-logged session, which is worse for payroll than either answer. The cost
   * is staleness if a member creates a symlink into an allowed root mid-session
   * and does not restart Claude Code.
   */
  const MEMO_MAX = 32;
  const memo = new Map();

  // Unicode normalization is a property of the OS's comparison rules, not of the
  // individual volume, so it is decided by platform alone and is never probed.
  const NFC = platform === "darwin";

  // The platform default, used when there is no evidence.
  //   win32  true   NTFS/ReFS and the whole Win32 API are case-insensitive.
  //   darwin true   APFS ships case-insensitive.
  //   linux  false  ext4/xfs/btrfs are case-sensitive.
  const DEFAULT_FOLD = fam === "win32" ? true : platform === "darwin";

  /**
   * EVIDENCE BEATS DEFAULT, on every platform.
   *
   * The default above is right for the overwhelming majority of volumes and
   * wrong for a real minority on ALL THREE: macOS can be formatted
   * case-sensitive APFS (verified here against a real hdiutil volume), Windows
   * has per-directory case sensitivity since 1803 and WSL-backed shares, and
   * Linux ext4 has had the casefold feature since 5.2. A two-stat read-only
   * probe of the ROOT settles it per volume, so the platform default only
   * decides the cases where there is no evidence at all.
   *
   * The probe is deliberately NOT a create/unlink of a temp file: a hook has no
   * business writing into a member's directory to answer a question, and a
   * write probe fails on a read-only mount, costs a round trip on a network
   * drive, and leaves litter if the process dies mid-probe.
   */
  function caseFoldPolicy(canonicalDisplay) {
    if (opts.caseInsensitive !== undefined && opts.caseInsensitive !== null) {
      return { fold: Boolean(opts.caseInsensitive), nfc: NFC, source: "caller-override" };
    }
    if (probeEnabled && enableRealpath && canonicalDisplay) {
      if (probeCache.has(canonicalDisplay)) return probeCache.get(canonicalDisplay);
      // C5: on win32 the device ("F:" or "\\\\nas\\share") is case-insensitive
      // unconditionally, so the probe must only flip a letter inside a SEGMENT.
      const deviceLen =
        fam === "win32" ? canonicalDisplay.length - canonicalDisplay.replace(/^[^\\]*\\?|^\\\\[^\\]+\\[^\\]+/, "").length : 0;
      const probed = probeCaseInsensitive(fsImpl, canonicalDisplay, deviceLen);
      const p =
        probed === null
          ? { fold: DEFAULT_FOLD, nfc: NFC, source: "platform-default:" + platform + "(probe-unknown)" }
          : { fold: probed, nfc: NFC, source: "probe:" + platform };
      probeCache.set(canonicalDisplay, p);
      return p;
    }
    return { fold: DEFAULT_FOLD, nfc: NFC, source: "platform-default:" + platform };
  }

  // C3 (consolidation): a cloud-sync root is a container of the member's whole
  // synced life, not a work folder, and everything logged under it is also
  // sitting on someone else's server. Refused as a ROOT; work inside one is fine.
  const SYNC_REL = {
    win32: ["onedrive", "dropbox", "google drive", "icloud drive", "icclouddrive", "iclouddrive"],
    darwin: ["dropbox", "google drive", "onedrive", "library/cloudstorage", "library/mobile documents"],
    linux: ["dropbox", "google drive", "onedrive", "nextcloud"],
  };

  function isSyncRoot(c) {
    const pol = { fold: fam === "win32" || platform === "darwin", nfc: platform === "darwin", source: "sync-check" };
    const folded = foldCanonical(c, pol, platform);
    // Absolute sync roots the OS advertises (OneDrive relocates for Business).
    const envRoots = [envImpl.OneDrive, envImpl.OneDriveConsumer, envImpl.OneDriveCommercial].filter(Boolean);
    for (const raw of envRoots) {
      const ec = canonicalize(raw, platform);
      if (!ec.ok) continue;
      const ef = foldCanonical(ec, pol, platform);
      if (ef.device === folded.device && ef.segments.length === folded.segments.length &&
          ef.segments.every((x, i) => x === folded.segments[i])) return true;
    }
    if (!homedirRaw) return false;
    const hc = canonicalize(homedirRaw, platform);
    if (!hc.ok) return false;
    const hf = foldCanonical(hc, pol, platform);
    if (hf.device !== folded.device) return false;
    const rel = folded.segments.slice(hf.segments.length);
    if (folded.segments.length <= hf.segments.length) return false;
    for (let i = 0; i < hf.segments.length; i++) if (hf.segments[i] !== folded.segments[i]) return false;
    // The sync-root NAME check folds case on every platform INCLUDING linux, a
    // deliberate deviation from the platform case rule: these are fixed brand
    // directory names, and a refusal costs the member one re-type while a miss
    // costs a synced personal tree. The containment comparisons above still
    // follow the platform.
    const relStr = rel.join("/").toLowerCase();
    for (const entry of SYNC_REL[platform] || SYNC_REL.linux) {
      if (relStr === entry.toLowerCase()) return true;
    }
    return false;
  }

  /** Is `outer` an ancestor of (or equal to) `inner`? Both already canonical. */
  function containsOrEquals(outer, inner, pol) {
    const a = foldCanonical(outer, pol, platform);
    const b = foldCanonical(inner, pol, platform);
    if (a.device !== b.device) return false;
    if (b.segments.length < a.segments.length) return false;
    for (let i = 0; i < a.segments.length; i++) {
      if (a.segments[i] !== b.segments[i]) return false;
    }
    return true;
  }

  /**
   * Our own configuration directory, and Claude Code's.
   *
   * `<home>/.claude` holds the tracker token, the hook script and consent.json
   * itself. A root there records the machinery rather than any work, and a root
   * ABOVE the config dir is caught by the home rules. CLAUDE_CONFIG_DIR is
   * honoured because Claude Code honours it and a member who has moved it has
   * moved the thing we are protecting.
   */
  function isConfigDir(c) {
    const pol = { fold: fam === "win32" || platform === "darwin", nfc: platform === "darwin", source: "config-check" };
    const candidates = [];
    const configured = typeof envImpl.CLAUDE_CONFIG_DIR === "string" ? envImpl.CLAUDE_CONFIG_DIR.trim() : "";
    if (configured) candidates.push(configured);
    if (homedirRaw) {
      const hc = canonicalize(homedirRaw, platform);
      if (hc.ok) {
        candidates.push(renderCanonical(hc, platform) + (fam === "win32" ? "\\" : "/") + ".claude");
      }
    }
    for (const raw of candidates) {
      const cc = canonicalize(raw, platform);
      if (!cc.ok) continue;
      // The config dir ITSELF and everything under it.
      if (containsOrEquals(cc, c, pol)) return true;
    }
    return false;
  }

  function classifyRoot(rawRoot) {
    const c = canonicalize(rawRoot, platform);
    if (!c.ok) {
      return { ok: false, reason: c.reason, canonical: null, input: rawRoot };
    }
    const display = renderCanonical(c, platform);

    // C4 (consolidation): judge the PHYSICAL root too. realpath also expands a
    // Windows 8.3 alias (C:\PROGRA~1 -> C:\Program Files), which is how the
    // system-directory table was previously bypassed, and stops a symlink from
    // laundering a refused root past a clean-looking argument.
    // ⛔ The root realpath is an INSTALLER-time cost, never a hook-time one.
    // resolveRootOnClassify defaults true (the installer wants the 8.3 and
    // symlink expansion); the HOOK constructs its scope with it FALSE, because
    // its roots were already classified at install time and a realpath on a
    // disconnected mapped drive can block a session-start hook. The lexical
    // safety check still runs on the hook path, so a tampered consent.json
    // naming "/" is still refused without touching the filesystem.
    const candidates = [c];
    const real = enableRealpath && resolveRootOnClassify ? realpathBestEffort(fsImpl, display) : null;
    if (real && real !== display) {
      const rc = canonicalize(real, platform);
      if (rc.ok) candidates.push(rc);
    }

    for (const cand of candidates) {
      const safety = classifySafety(cand, platform, { allowVolumeRoot });
      if (!safety.ok) {
        return { ok: false, reason: safety.reason, canonical: display, input: rawRoot };
      }
      if (isSyncRoot(cand)) {
        return { ok: false, reason: REASON.ROOT_SYNC_ROOT, canonical: display, input: rawRoot };
      }
      if (isConfigDir(cand)) {
        return { ok: false, reason: REASON.ROOT_CONFIG_DIRECTORY, canonical: display, input: rawRoot };
      }
    }

    // A root that IS the member's home directory, however it is spelled
    // (redirected profile, D:\Users\Name, /var/home/…), is refused too.
    if (homedirRaw) {
      const hc = canonicalize(homedirRaw, platform);
      if (hc.ok) {
        const pol = caseFoldPolicy(display);
        const a = foldCanonical(c, pol, platform);
        const b = foldCanonical(hc, pol, platform);
        if (
          a.device === b.device &&
          a.segments.length === b.segments.length &&
          a.segments.every((s, i) => s === b.segments[i])
        ) {
          return { ok: false, reason: REASON.ROOT_HOME_DIRECTORY, canonical: display, input: rawRoot };
        }
        // ⛔ AND ANY ANCESTOR OF IT. The named-container tables catch the
        // ancestors that have standard names (`C:\Users`, `/home`, `/Users`);
        // they cannot catch a redirected or unusual profile location, and a
        // root ABOVE home captures every project the member owns just as
        // completely as home itself does. `/Volumes/Data` with home at
        // `/Volumes/Data/rob`, or `F:\profiles` with home at
        // `F:\profiles\antu`, are the shapes that reach this line.
        if (containsOrEquals(c, hc, pol)) {
          return { ok: false, reason: REASON.ROOT_CONTAINS_HOME, canonical: display, input: rawRoot };
        }
      }
    }

    return { ok: true, reason: REASON.OK, canonical: display, input: rawRoot };
  }

  function addRoot(rawRoot) {
    const verdict = classifyRoot(rawRoot);
    if (!verdict.ok) return verdict;
    const c = canonicalize(rawRoot, platform);
    const display = renderCanonical(c, platform);
    const policy = caseFoldPolicy(display);
    const folded = foldCanonical(c, policy, platform);
    const key = folded.device + "\u0000" + folded.segments.join("\u0000");
    if (!roots.some((r) => r.key === key)) {
      roots.push({ input: rawRoot, canonical: c, display, folded, policy, key });
      memo.clear(); // a new root can turn a previous deny into an allow
    }
    return verdict;
  }

  function under(rootFolded, cwdFolded) {
    if (rootFolded.device !== cwdFolded.device) return null;
    if (cwdFolded.segments.length < rootFolded.segments.length) return null;
    for (let i = 0; i < rootFolded.segments.length; i++) {
      if (rootFolded.segments[i] !== cwdFolded.segments[i]) return null;
    }
    return cwdFolded.segments.length === rootFolded.segments.length ? "root_itself" : "descendant";
  }

  function testCanonical(c) {
    for (const r of roots) {
      const cwdFolded = foldCanonical(c, r.policy, platform);
      const rel = under(r.folded, cwdFolded);
      if (rel) return { root: r, rel };
    }
    return null;
  }

  /**
   * @returns {{allowed:boolean, reason:string, root:(string|null),
   *            via:(string|null), cwd:(string|null), relation:(string|null)}}
   */
  function match(rawCwd) {
    if (typeof rawCwd === "string" && memo.has(rawCwd)) return memo.get(rawCwd);
    // Frozen: the memo hands the SAME object to every later caller, so a caller
    // that mutated it would poison every subsequent answer in the session.
    const result = Object.freeze(matchUncached(rawCwd));
    if (typeof rawCwd === "string") {
      if (memo.size >= MEMO_MAX) memo.clear();
      memo.set(rawCwd, result);
    }
    return result;
  }

  function matchUncached(rawCwd) {
    try {
      if (roots.length === 0) {
        return {
          allowed: emptyRootsMeans === "allow",
          reason: REASON.NO_ROOTS,
          root: null,
          via: null,
          cwd: null,
          relation: null,
        };
      }

      const c = canonicalize(rawCwd, platform);
      const display = c.ok ? renderCanonical(c, platform) : null;

      let lexical = null;
      if (c.ok && symlinkPolicy !== "physical") {
        lexical = testCanonical(c);
      }
      if (lexical && symlinkPolicy === "lexical") {
        return {
          allowed: true,
          reason: REASON.OK,
          root: lexical.root.display,
          via: "lexical",
          cwd: display,
          relation: lexical.rel,
        };
      }

      // Physical pass. Resolves BOTH directions of the symlink problem:
      //   (a) cwd is a link from outside pointing INTO an allowed root, and
      //   (b) the allowed root is itself a link and the cwd arrives resolved.
      // Realpath the RAW string, not the canonical one: resolving ".." lexically
      // before following links gives the wrong parent when a link is in the way.
      // On Windows this also follows junctions — Node reports reparse points as
      // symlinks and realpathSync resolves them — which matters because a
      // junction needs no admin rights and a symlink does, so junctions are what
      // Windows members actually have.
      let physical = null;
      // Hot path: this runs on every PostToolUse. When the lexical pass already
      // matched under the 'either' policy, the answer is settled — do not spend
      // syscalls confirming it.
      //
      // ⛔ THE PASS RUNS EVEN WHEN enableRealpath IS FALSE, and that is not an
      // oversight. Under the 'physical' default a skipped pass would mean
      // `physical` stays null and EVERY cwd is refused — so a hook whose fs was
      // never injected, or any modelled-platform caller, would deny the whole
      // team rather than answer the question. Instead the pass runs and the two
      // realpath calls below are gated: with no filesystem both sides fall back
      // to their canonical lexical forms, which is exactly the lexical answer.
      // The security property is unchanged where it can be enforced — when the
      // filesystem IS available, a cwd that matches only lexically because a
      // symlink escapes the root still loses.
      const needPhysical =
        symlinkPolicy !== "lexical" && !(lexical && symlinkPolicy === "either");
      if (needPhysical) {
        const realCwdRaw =
          enableRealpath && typeof rawCwd === "string" ? realpathBestEffort(fsImpl, rawCwd) : null;
        const realCwd = realCwdRaw ? canonicalize(realCwdRaw, platform) : null;

        for (const r of roots) {
          // Roots do not move mid-session; resolve each at most once.
          if (!("realRootRaw" in r)) {
            r.realRootRaw = enableRealpath ? realpathBestEffort(fsImpl, r.display) : null;
          }
          const realRootRaw = r.realRootRaw;
          const realRoot = realRootRaw ? canonicalize(realRootRaw, platform) : null;
          const rootSide = realRoot && realRoot.ok ? foldCanonical(realRoot, r.policy, platform) : r.folded;
          const cwdSide =
            realCwd && realCwd.ok
              ? foldCanonical(realCwd, r.policy, platform)
              : c.ok
              ? foldCanonical(c, r.policy, platform)
              : null;
          if (!cwdSide) continue;
          const rel = under(rootSide, cwdSide);
          if (rel) {
            physical = { root: r, rel };
            break;
          }
        }
      }

      if (symlinkPolicy === "physical") {
        if (physical) {
          return {
            allowed: true,
            reason: REASON.OK,
            root: physical.root.display,
            via: "realpath",
            cwd: display,
            relation: physical.rel,
          };
        }
      } else if (lexical || physical) {
        const hit = lexical || physical;
        return {
          allowed: true,
          reason: REASON.OK,
          root: hit.root.display,
          via: lexical ? "lexical" : "realpath",
          cwd: display,
          relation: hit.rel,
        };
      }

      return {
        allowed: false,
        reason: c.ok ? REASON.NOT_UNDER_ROOT : c.reason,
        root: null,
        via: null,
        cwd: display,
        relation: null,
      };
    } catch (_) {
      // The hook must never fail a member's session. An unexpected throw here
      // denies (do not log what we cannot classify) and stays silent.
      return {
        allowed: false,
        reason: REASON.NOT_UNDER_ROOT,
        root: null,
        via: null,
        cwd: null,
        relation: null,
      };
    }
  }

  return {
    platform,
    addRoot,
    classifyRoot,
    match,
    clearCache: () => {
      memo.clear();
      probeCache.clear();
      for (const r of roots) delete r.realRootRaw;
    },
    isAllowed: (cwd) => match(cwd).allowed,
    roots: () => roots.map((r) => ({ display: r.display, foldSource: r.policy.source })),
    describe: () => ({
      platform,
      family: fam,
      enableRealpath,
      symlinkPolicy,
      emptyRootsMeans,
      allowVolumeRoot,
      roots: roots.map((r) => ({ display: r.display, policy: r.policy })),
    }),
  };
}


// ── member input normalization (installer / CLI side) ───────────────────────

/**
 * Normalize what the MEMBER TYPED before the policy engine ever sees it.
 *
 * CLI/installer side only — the hook never calls this, because a cwd arrives
 * already OS-normalized. Order matters and every step is here because a real
 * shell produces it:
 *
 *   1. trim
 *   2. strip one surviving pair of double quotes (cmd.exe passes "..." through
 *      to argv intact; so does a member pasting a pre-quoted path into a form)
 *   3. win32 only: expand %VAR%. cmd.exe expands it, PowerShell does NOT — a
 *      member who copies `%USERPROFILE%\MMAI` out of a doc into PowerShell
 *      hands us the literal string, and a resolver would happily accept a
 *      folder actually named `%USERPROFILE%`.
 *   4. expand a leading `~`. No Windows shell expands it, so on win32 it
 *      arrives literal and would otherwise name a directory called "~".
 *   5. strip trailing separators — but NEVER turn `F:\` into `F:`. Those mean
 *      different things (drive-absolute vs drive-RELATIVE) and must keep
 *      producing different refusal codes.
 *
 * Returns { value, applied: [step, ...] }. Never throws.
 */
function normalizeMemberInput(raw, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const env = o.env || {};
  const home = o.homedir || "";
  const applied = [];
  if (typeof raw !== "string") return { value: raw, applied };
  let s = raw.trim();
  if (s !== raw) applied.push("trim");

  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1).trim();
    applied.push("unquote");
  }

  if (platform === "win32" && s.indexOf("%") !== -1) {
    const before = s;
    s = s.replace(/%([^%]+)%/g, function (whole, name) {
      const key = Object.keys(env).find(function (k) {
        return k.toLowerCase() === name.toLowerCase();
      });
      return key ? env[key] : whole;
    });
    if (s !== before) applied.push("expand_env");
  }

  if (home && (s === "~" || s.slice(0, 2) === "~/" || (platform === "win32" && s.slice(0, 2) === "~\\"))) {
    s =
      s === "~"
        ? home
        : home.replace(/[\\/]+$/, "") + (platform === "win32" ? "\\" : "/") + s.slice(2);
    applied.push("expand_tilde");
  }

  const trimmed = s.replace(/[\\/]+$/, "");
  if (trimmed !== s) {
    if (platform === "win32" && /^[A-Za-z]:$/.test(trimmed)) {
      s = trimmed + "\\"; // "F:\" stays a drive ROOT
    } else if (trimmed === "") {
      s = s.slice(0, 1); // "/" or "\" stays itself
    } else {
      s = trimmed;
    }
    applied.push("strip_trailing_separator");
  }
  return { value: s, applied: applied };
}

// ── hook-consent.js ─────────────────────────────────────────────────────────


// ⛔ CANONICAL SOURCE — do not fork this logic.
//
// This file is the ONE authored copy of the worklog hook's CONSENT GATE: the
// folder allowlist that decides whether a Claude Code session is recorded at
// all. Two consumers share it:
//
//   1. .claude/scripts/worklog-hook.js carries a MECHANICALLY GENERATED inline
//      copy of everything below, together with src/lib/ext/mm-path-scope.js,
//      between the BEGIN/END GENERATED markers. The hook is delivered to
//      members as ONE downloaded file (GET /api/ext/hook-install?file=hook),
//      so it cannot `import` or `require` anything — the code has to be
//      inlined. It is regenerated by
//      `node scripts/generate-consent-snippet.mjs --write` and guarded
//      byte-for-byte by tests/unit/hook-consent-sync.unit.test.ts.
//   2. tests/unit/hook-consent.unit.test.ts imports it directly and drives it
//      with `platform: "win32"` / `"linux"` / `"darwin"`. That is the whole
//      reason every platform-dependent decision is a PARAMETER rather than an
//      ambient read: SIX OF NINE members are on win32 and one is on linux, and
//      a darwin-only test bench would ship the majority of the team untested
//      code.
//
// ⛔ THIS FILE OWNS NO PATH LOGIC AND MUST NEVER GROW ANY.
//
// Every question of the form "is this path inside that one?", "is this string
// even an absolute path?", "is this root too broad to allow?" is answered by
// src/lib/ext/mm-path-scope.js — the consolidated cross-platform matcher that
// was built and adversarially tested out-of-tree (101 path assertions with
// 13/13 mutants killed, plus a 50-row decision table executed on all three
// platforms). An earlier draft of this file carried its own matcher. It was
// DELETED on integration rather than kept alongside: two implementations of
// one predicate is how the copy that decides whether a member's folder is
// recorded drifts from the copy that gets reviewed.
//
// What remains here is glue and policy that is genuinely this gate's own:
// where consent.json lives, how its bytes decode, what a valid config is, how
// it is written without a torn file, and the two extra questions the matcher
// deliberately does not answer — "is this cwd a worktree of an allowlisted
// repository?" and "may this session be recorded at all?".
//
// ⛔ CONSTRAINTS THIS FILE MUST KEEP (see scripts/generate-consent-snippet.mjs
//    for the exact transform):
//      * plain JavaScript, no TypeScript syntax (types live in JSDoc)
//      * the ONLY imports permitted are relative imports of a sibling source
//        that appears EARLIER in the generator's SOURCES list; the generator
//        strips them and verifies every imported name is declared there
//      * zero requires, zero Node built-ins at module scope
//        (fs / path / os / child_process arrive through CONSENT_DEPS)
//      * every other top-level declaration is `export function` or `export const`
//      * ES2019 syntax only — the hook runs on whatever node the member has
//      * no named capture groups, no lookbehind (older V8 on some installs)
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHAT THIS PROMISES
//
// NOTHING IS RECORDED UNLESS THE SESSION'S WORKING DIRECTORY IS AT OR BELOW A
// FOLDER THE MEMBER EXPLICITLY NAMED. Not a redacted row, not a count, not a
// "N sessions skipped" beacon. Nothing.
//
// That is why there is deliberately NO export here that reports what was
// denied, and why the hook does not log a denial anywhere — not even to its own
// debug file. A denial counter would be the first thing to quietly break the
// promise, and an append-per-tool-call denial log IS a count of a folder the
// member excluded.
//
// ⛔ FAIL CLOSED, ABSOLUTELY. Missing, empty, zero-byte, corrupt, wrong-version,
// unreadable, not-an-array, or an allowlist whose every entry is refused all
// produce the same answer: record nothing. There is no default allowlist and no
// fallback to prior behaviour. Consent we cannot read is not consent.
//
// ⛔ THE SAFE DIRECTION IS THE OPPOSITE OF A DENYLIST'S. A denylist that matches
// too much loses evidence; an allowlist that matches too much records work
// somebody excluded. Every ambiguous branch below therefore resolves to "not
// allowed" — an unresolvable cwd, an unreadable config, a path we cannot prove
// is absolute.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHY THE UNSAFE-ROOT RULE IS SET MEMBERSHIP AND NOT A DEPTH LIMIT
//
// (The rule itself now lives in mm-path-scope.js `classifySafety`; this is the
// evidence that put it there, kept next to the gate it protects.)
//
// The rule it replaces was "refuse any root shallower than two path segments".
// Measured against the real corpus (61,000 time_worklogs rows, 2026-08-31, path
// prefixes extracted from content_md) it is wrong in BOTH directions on this
// exact team:
//
//   REFUSES WHAT IT MUST ALLOW — `F:\MMAI` is a drive plus one segment and is
//   the actual work root of the win32 members (has9: 326 path hits under
//   F:\MMAI; asif: 191 hits on F:\MMAI plus 12 on D:\Massmarket). A depth rule
//   refuses the majority of the team's real work root. Re-inserting it during
//   this integration broke 47 of 94 tests, which is how the rule is pinned.
//
//   ALLOWS WHAT IT MUST REFUSE — `/home/shinzuu` and `/Users/efaz` are two
//   segments and pass. Those are entire home directories. `C:\Users\Has9`,
//   `C:\Users\asd`, `C:\Users\chowd` and `C:\Users\Tanvir` are all two segments
//   after the drive and all appear in the corpus — 336, 306, 49 and 16 hits.
//   A depth rule fails OPEN on the single most over-broad root a member can
//   pick.
//
// Depth is not the property that matters. What matters is whether the root is a
// WELL-KNOWN CONTAINER whose contents are by construction not all work: a
// filesystem or drive root, a UNC share root, an OS tree, a user-profile
// container, somebody's whole profile, a cloud-sync root, or our own config
// dir. That is a named set per platform and it is checkable. Everything else is
// accepted at any depth.

/** Schema version. A config that does not say exactly this is not read. */
const CONSENT_VERSION = 2;

/** Basename inside <homedir>/.claude/mm-hooks/. */
const CONSENT_BASENAME = "consent.json";

/** Hard ceiling on allowlist entries, so a hostile config cannot burn the hook's budget. */
const CONSENT_MAX_ENTRIES = 100;

/**
 * Node built-ins, injected rather than required.
 *
 * The hook assigns these once at startup (`CONSENT_DEPS.fs = require("fs")`,
 * …). Tests either assign them the same way or pass per-call overrides. Leaving
 * them null is not a crash: every accessor below degrades to "not allowed",
 * which is the fail-closed direction.
 */
const CONSENT_DEPS = {
  fs: null,
  path: null,
  os: null,
  childProcess: null,
  env: null,
};

/** Resolve the injected runtime for one call. Never throws. */
function consentRuntime(opts) {
  var o = opts || {};
  var platform = o.platform || CONSENT_DEPS.platform || process.platform;
  return {
    fs: o.fs || CONSENT_DEPS.fs,
    path: o.path || CONSENT_DEPS.path,
    os: o.os || CONSENT_DEPS.os,
    childProcess: o.childProcess || CONSENT_DEPS.childProcess,
    env: o.env || CONSENT_DEPS.env || {},
    platform: platform,
  };
}

/** `path.win32` on Windows, `path.posix` everywhere else. Null when path was never injected. */
function consentPathModule(opts) {
  var rt = consentRuntime(opts);
  if (!rt.path) return null;
  return rt.platform === "win32" ? rt.path.win32 : rt.path.posix;
}

/** The member's home directory, or "" — never a throw. */
function consentHomedir(opts) {
  var o = opts || {};
  if (typeof o.homedir === "string" && o.homedir) return o.homedir;
  var rt = consentRuntime(opts);
  if (!rt.os) return "";
  try {
    var h = rt.os.homedir();
    return typeof h === "string" ? h : "";
  } catch (err) {
    return "";
  }
}

/**
 * Where consent.json lives: <homedir>/.claude/mm-hooks/consent.json.
 *
 * Deliberately NOT CLAUDE_CONFIG_DIR-relative. The token, the hook script and
 * this file are OUR data, not Claude Code configuration; a member who sets
 * CLAUDE_CONFIG_DIR after installing would otherwise find their consent file
 * had vanished and recording had stopped with nothing to point at.
 */
function consentConfigPath(opts) {
  var P = consentPathModule(opts);
  var home = consentHomedir(opts);
  if (!P || !home) return null;
  return P.join(home, ".claude", "mm-hooks", CONSENT_BASENAME);
}

/**
 * ⛔ THE ONE PLACE A PATH SCOPE IS CONSTRUCTED. Every caller in this file goes
 * through here, so there is exactly one policy and no call site can quietly
 * pick a laxer one.
 *
 * `resolveRootOnClassify: false` — the ROOTS were already classified when the
 * member named them (installer / `--consent-allow`), and a realpath on a
 * disconnected mapped drive must never be able to block SessionStart. The
 * lexical safety check still runs on the hook path, so a hand-tampered
 * consent.json naming "/" is refused without touching the filesystem.
 *
 * `symlinkPolicy` is deliberately NOT set here: it takes the module's default,
 * which is 'physical' (see the ⛔ OPUS DECISION at its site in mm-path-scope.js).
 */
function consentScope(opts) {
  var o = opts || {};
  var rt = consentRuntime(opts);
  return createScope({
    platform: rt.platform,
    fs: rt.fs || undefined,
    env: rt.env,
    homedir: consentHomedir(opts),
    resolveRootOnClassify: false,
    enableRealpath: o.enableRealpath,
    caseInsensitive: o.caseInsensitive,
    probe: o.probe,
  });
}

/**
 * Lexical normalisation of ONE path to the canonical display form, or null.
 *
 * Null is always the fail-closed answer: a candidate root that normalises to
 * null is refused, and a cwd that normalises to null is not recorded. `~`,
 * `%VAR%`, surrounding quotes and trailing separators are expanded first,
 * because this is also what the member typed at the `--consent-allow` CLI.
 */
function normalizeRoot(input, opts) {
  var rt = consentRuntime(opts);
  if (typeof input !== "string") return null;
  var prepared = normalizeMemberInput(input, {
    platform: rt.platform,
    env: rt.env,
    homedir: consentHomedir(opts),
  });
  var c = canonicalize(prepared.value, rt.platform);
  if (!c.ok) return null;
  return renderCanonical(c, rt.platform);
}

/**
 * May this candidate be an allowlist root?
 *
 * Returns { ok: true, root } or { ok: false, rule, root, detail }.
 *
 * `rule` is a MACHINE-READABLE reason code from mm-path-scope's REASON table.
 * It is not member-facing copy — the sentence a member reads is authored
 * elsewhere and is not this file's business.
 */
function classifyRoot(candidate, opts) {
  var rt = consentRuntime(opts);
  if (typeof candidate !== "string") {
    return { ok: false, rule: REASON.NOT_A_STRING, root: null, detail: "not a string" };
  }
  var prepared = normalizeMemberInput(candidate, {
    platform: rt.platform,
    env: rt.env,
    homedir: consentHomedir(opts),
  });
  var verdict = consentScope(opts).classifyRoot(prepared.value);
  if (verdict.ok) return { ok: true, rule: REASON.OK, root: verdict.canonical, detail: null };
  return {
    ok: false,
    rule: verdict.reason,
    root: verdict.canonical,
    detail: verdict.reason,
  };
}

/**
 * Is `child` at or below `root`?
 *
 * ⛔ SEGMENT BOUNDARIES, NOT STRING PREFIXES. Without them,
 * `/home/x/Documents/massmarket-private` is "inside"
 * `/home/x/Documents/massmarket`, and `F:\MMAI Project` is "inside" `F:\MMAI`.
 * Both are real directory names on this team's machines. The comparison is done
 * on a normalized segment array by mm-path-scope; this is only the two-argument
 * convenience wrapper.
 */
function isPathInsideRoot(child, root, opts) {
  var scope = consentScope(opts);
  var added = scope.addRoot(root);
  if (!added.ok) {
    // A root the safety policy refuses is not a root. Fall back to a
    // safety-free scope so that CONTAINMENT can still be asked about it —
    // callers that care about safety ask classifyRoot, which is the gate.
    var rt = consentRuntime(opts);
    var rc = canonicalize(root, rt.platform);
    var cc = canonicalize(child, rt.platform);
    if (!rc.ok || !cc.ok) return false;
    if (rc.device !== cc.device) return false;
    if (cc.segments.length < rc.segments.length) return false;
    var fold = rt.platform !== "linux";
    for (var k = 0; k < rc.segments.length; k++) {
      var a = fold ? String(rc.segments[k]).toLowerCase() : rc.segments[k];
      var b = fold ? String(cc.segments[k]).toLowerCase() : cc.segments[k];
      if (a !== b) return false;
    }
    return true;
  }
  return scope.match(child).allowed;
}

/**
 * Classify every candidate, drop case-variant duplicates, then drop entries
 * already covered by another.
 *
 * ⛔ Case-variant duplicates are collapsed BEFORE the coverage pass. On win32
 * `F:\MMAI` and `F:/mmai` are the same directory, each is "inside" the other,
 * and a coverage pass run first drops BOTH — leaving a member who listed their
 * root twice with it allowlisted zero times.
 */
function normalizeAllowlist(list, opts) {
  var rt = consentRuntime(opts);
  var accepted = [];
  var refused = [];
  var source = Array.isArray(list) ? list : [];
  var i;
  for (i = 0; i < source.length && i < CONSENT_MAX_ENTRIES; i++) {
    var verdict = classifyRoot(source[i], opts);
    if (verdict.ok) accepted.push(verdict.root);
    else refused.push({ input: source[i], rule: verdict.rule, detail: verdict.detail });
  }

  var fold = rt.platform !== "linux";
  var foldKey = function (value) {
    return fold ? String(value).toLowerCase() : String(value);
  };

  var seen = {};
  var unique = [];
  for (i = 0; i < accepted.length; i++) {
    var key = foldKey(accepted[i]);
    if (Object.prototype.hasOwnProperty.call(seen, key)) continue;
    seen[key] = true;
    unique.push(accepted[i]);
  }

  // Coverage is asked LEXICALLY and with no filesystem: this runs at write time
  // over strings the member just typed, several of which may not exist yet.
  var coverageOpts = Object.assign({}, opts || {}, { enableRealpath: false });
  var kept = [];
  for (i = 0; i < unique.length; i++) {
    var covered = false;
    for (var j = 0; j < unique.length; j++) {
      if (j === i) continue;
      if (isPathInsideRoot(unique[i], unique[j], coverageOpts)) {
        covered = true;
        break;
      }
    }
    if (!covered) kept.push(unique[i]);
  }
  kept.sort(function (a, b) {
    var x = foldKey(a);
    var y = foldKey(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return { allow: kept, refused: refused };
}

/**
 * Decode config bytes, tolerating what Windows editors and shells produce.
 *
 * A member who opens consent.json to check what it says and saves it, or who
 * writes it from PowerShell 5.1 (UTF-16LE with a BOM, not UTF-8), has done
 * nothing wrong. Every case here is a deterministic, lossless decode. CRLF
 * needs no handling: `\r` is legal JSON whitespace.
 */
function decodeConfigBytes(buf) {
  var b = buf;
  if (typeof Buffer === "undefined") return String(b);
  if (!Buffer.isBuffer(b)) b = Buffer.from(String(b), "utf8");
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.slice(2).toString("utf16le");
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    var body = b.slice(2);
    var swapped = Buffer.alloc(body.length - (body.length % 2));
    for (var i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1];
      swapped[i + 1] = body[i];
    }
    return swapped.toString("utf16le");
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.slice(3).toString("utf8");
  // BOM-less UTF-16LE: JSON starts with '{' (0x7B), so the bytes read 7B 00.
  if (b.length >= 4 && b[0] !== 0x00 && b[1] === 0x00 && b[3] === 0x00) return b.toString("utf16le");
  return b.toString("utf8");
}

/**
 * Read + validate consent.json.
 *
 * Returns { allow: string[], reason: string }. `allow` is EMPTY for every
 * failure mode there is, and an empty allow means record nothing. The `reason`
 * exists for the `--consent-status` diagnostic and for tests; the hook never
 * writes it anywhere.
 */
function readConsentConfig(opts) {
  var o = opts || {};
  var rt = consentRuntime(opts);
  if (!rt.fs) return { allow: [], reason: "no_fs" };

  var file = o.file || consentConfigPath(opts);
  if (!file) return { allow: [], reason: "no_config_path" };

  var buf;
  try {
    buf = rt.fs.readFileSync(file);
  } catch (err) {
    var code = (err && err.code) || "error";
    return { allow: [], reason: code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable_" + code, file: file };
  }

  if (!buf || buf.length === 0) return { allow: [], reason: "empty_file", file: file };

  var text;
  try {
    text = decodeConfigBytes(buf);
  } catch (err) {
    return { allow: [], reason: "decode_failed", file: file };
  }
  if (!String(text).trim()) return { allow: [], reason: "blank_file", file: file };

  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { allow: [], reason: "invalid_json", file: file };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { allow: [], reason: "not_an_object", file: file };
  }
  // Strict. A string "2", a missing v, or a v:1 file from a different schema is
  // a config we cannot claim to understand, and a config we cannot understand
  // is not consent.
  if (parsed.v !== CONSENT_VERSION) return { allow: [], reason: "wrong_version", file: file };
  if (!Array.isArray(parsed.allowlist)) return { allow: [], reason: "not_an_array", file: file };

  // ⛔ THE TWO-MACHINES-ONE-ACCOUNT NET. One member runs win32 and darwin under
  // one identity. consent.json is per-machine by construction, which is
  // correct — but if a home directory is ever synced or copied between the two,
  // a Windows allowlist (F:\MMAI Project) lands on the Mac, canonicalises to
  // nothing that can ever match, and the gate silently records nothing while
  // looking healthy. Recording the platform at write time turns that into a
  // named refusal instead of a silent one.
  if (parsed.platform_at_write && parsed.platform_at_write !== rt.platform) {
    return { allow: [], reason: "wrong_platform", file: file };
  }

  var folded = normalizeAllowlist(parsed.allowlist, opts);
  if (folded.allow.length === 0) {
    return { allow: [], reason: parsed.allowlist.length === 0 ? "empty_allowlist" : "no_usable_roots", file: file, refused: folded.refused };
  }
  return { allow: folded.allow, reason: "ok", file: file, refused: folded.refused };
}

/**
 * The MAIN repository directory backing `cwd`, or null.
 *
 * `git rev-parse --git-common-dir` resolves a linked worktree to its main
 * repository's .git directory, which is what makes a worktree of an allowlisted
 * repo allowed no matter where on disk the worktree itself was created — a
 * scratchpad, ~/.claude/worktrees, the Desktop.
 *
 * Bounded, silent, and fail-closed: no git, no repo, a timeout, or a non-zero
 * exit all return null and the session is not recorded on that basis.
 */
function gitMainRepoDir(cwd, opts) {
  var rt = consentRuntime(opts);
  if (!rt.childProcess || !rt.path) return null;
  if (typeof rt.childProcess.execFileSync !== "function") return null;
  var P = rt.platform === "win32" ? rt.path.win32 : rt.path.posix;

  function run(args) {
    return rt.childProcess.execFileSync("git", args, {
      cwd: cwd,
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  var raw = "";
  try {
    // --path-format=absolute needs git >= 2.31; the bare form is the fallback
    // and can return a path relative to cwd.
    raw = run(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch (err) {
    try {
      raw = run(["rev-parse", "--git-common-dir"]);
    } catch (err2) {
      return null;
    }
  }

  var common = String(raw || "").trim();
  if (!common) return null;
  if (!P.isAbsolute(common)) {
    try {
      common = P.resolve(cwd, common);
    } catch (err) {
      return null;
    }
  }
  common = common.replace(/[\\/]+$/, "");
  var base = P.basename(common);
  // A normal repo's common dir is `<repo>/.git`; a bare repo's IS the repo.
  return base === ".git" ? P.dirname(common) : common;
}

/**
 * ⛔ THE GATE. The one question: may this session be recorded at all?
 *
 * Returns { allowed, reason } and NEVER throws. `reason` is a machine-readable
 * code for `--consent-status` and for tests. The hook does not log it, does not
 * count it, and does not send it: a denied folder produces nothing, anywhere.
 *
 * The containment answer comes from ONE mm-path-scope scope holding every
 * allowlisted root, so a cwd is compared against all of them under one policy,
 * one case-fold decision per root volume, and one memo.
 */
function evaluateConsent(opts) {
  var o = opts || {};

  var state = readConsentConfig(opts);
  if (!state.allow || state.allow.length === 0) {
    return { allowed: false, reason: state.reason };
  }

  var cwd = o.cwd;
  if (typeof cwd !== "string" || !cwd) {
    try {
      cwd = process.cwd();
    } catch (err) {
      // The working directory was deleted out from under the session. We cannot
      // prove containment, so we do not record.
      return { allowed: false, reason: "cwd_unavailable" };
    }
  }
  if (typeof cwd !== "string" || !cwd) return { allowed: false, reason: "cwd_unavailable" };

  // ⛔ A cwd THAT IS NOT THERE IS NOT A SESSION DIRECTORY.
  //
  // This is the gate's policy, not the matcher's, and the split is deliberate:
  // mm-path-scope tolerates a failed realpath and degrades to the lexical
  // answer, because on Windows realpath fails for entirely benign reasons
  // (long paths, EACCES on a parent, a filesystem with no realpath at all) and
  // denying those would stop recording for members who did nothing wrong.
  // ENOENT is the one failure that means something different: the directory
  // was deleted out from under the session, so containment cannot be proved
  // and nothing is recorded on the strength of a string that names nothing.
  var rt = consentRuntime(opts);
  if (rt.fs && typeof rt.fs.statSync === "function") {
    try {
      rt.fs.statSync(cwd);
    } catch (err) {
      var code = err && err.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return { allowed: false, reason: "cwd_unresolvable" };
      }
      // EACCES / EPERM / anything else proves nothing about existence; fall
      // through and let containment decide.
    }
  }

  var scope = consentScope(opts);
  var i;
  var usable = 0;
  for (i = 0; i < state.allow.length; i++) {
    if (scope.addRoot(state.allow[i]).ok) usable++;
  }
  if (usable === 0) return { allowed: false, reason: "no_usable_roots" };

  var direct = scope.match(cwd);
  if (direct.allowed) {
    return { allowed: true, reason: "in_allowlist", root: direct.root };
  }

  // Only now — after direct containment has failed — pay for a git process.
  // A member with no allowlist never reaches this line at all.
  var main = o.gitMainRepoDir ? o.gitMainRepoDir(cwd, opts) : gitMainRepoDir(cwd, opts);
  if (main) {
    var viaWorktree = scope.match(main);
    if (viaWorktree.allowed) {
      return { allowed: true, reason: "worktree_of_allowlisted_repo", root: viaWorktree.root };
    }
  }

  return { allowed: false, reason: "outside_allowlist" };
}

/**
 * Always UTF-8, no BOM, LF only, trailing newline. Tolerant on read, exactly
 * one shape on write.
 *
 * `platform_at_write` is recorded so a consent.json that travels between a
 * member's two machines is refused by name rather than matching nothing in
 * silence — see the check in readConsentConfig.
 */
function serializeConsentConfig(allow, platform) {
  return (
    JSON.stringify(
      { v: CONSENT_VERSION, allowlist: allow, platform_at_write: platform || process.platform },
      null,
      2,
    ).replace(/\r\n/g, "\n") + "\n"
  );
}

/**
 * ⛔ THE HONEST PERMISSIONS STORY.
 *
 * POSIX: chmod 0600 on the file and 0700 on the directory are real and enforced
 * by the kernel. Other non-root users cannot read it; root can.
 *
 * win32: fs.chmodSync is very nearly a no-op on NTFS — Node maps only the owner
 * write bit onto FILE_ATTRIBUTE_READONLY, no group, no other, no ACL touched.
 * chmod(0600) changes NOTHING about who can read the file, and marking it
 * read-only would break the atomic replace below. So it is not called, and
 * "mode 0600" must never appear in anything a Windows member reads. What
 * actually protects the file there is the inherited ACL on C:\Users\<name>.
 */
function applyOwnerOnlyMode(target, mode, opts) {
  var rt = consentRuntime(opts);
  if (rt.platform === "win32") return { applied: false, why: "chmod does not map onto NTFS ACLs" };
  if (!rt.fs || typeof rt.fs.chmodSync !== "function") return { applied: false, why: "no_chmod" };
  try {
    rt.fs.chmodSync(target, mode);
    return { applied: true, mode: mode };
  } catch (err) {
    return { applied: false, why: (err && err.code) || "chmod_failed" };
  }
}

/**
 * Write consent.json without ever leaving a truncated file behind:
 * temp-in-the-same-directory → fsync → rename.
 *
 * Same directory matters — rename is atomic only within one filesystem, and
 * os.tmpdir() is routinely a different volume. On Windows the rename can fail
 * transiently (EPERM/EACCES/EBUSY) when a scanner or another hook process holds
 * the destination open, so it retries with backoff; it does NOT fall back to a
 * non-atomic copy, because a half-written consent.json is exactly the
 * zero-byte case the reader has to fail closed on.
 *
 * ⛔ REFUSES UNSAFE ROOTS AT WRITE TIME, through the same classifyRoot — and
 * therefore the same mm-path-scope policy — the reader uses. Both ends of the
 * pipe apply one policy: a member cannot write a root the gate would refuse to
 * read, and cannot be refused a root the writer accepted.
 */
function writeConsentConfig(candidates, opts) {
  var o = opts || {};
  var rt = consentRuntime(opts);
  if (!rt.fs || !rt.path) throw new Error("consent write needs fs and path");
  var P = consentPathModule(opts);
  var file = o.file || consentConfigPath(opts);
  if (!file) throw new Error("could not resolve the consent config path");

  var folded = normalizeAllowlist(candidates, opts);
  var dir = P.dirname(file);

  rt.fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  applyOwnerOnlyMode(dir, 0o700, opts);

  var body = serializeConsentConfig(folded.allow, rt.platform);
  var suffix = String(process.pid) + "." + Math.random().toString(36).slice(2, 10);
  var tmp = P.join(dir, "." + CONSENT_BASENAME + "." + suffix + ".tmp");

  var lastErr = null;
  try {
    var fd = rt.fs.openSync(tmp, "wx", 0o600);
    try {
      rt.fs.writeFileSync(fd, body, "utf8");
      // fsync the DATA before the rename: without it a crash between the two can
      // publish a correctly-named file whose blocks were never flushed.
      try {
        rt.fs.fsyncSync(fd);
      } catch (err) {
        /* not every filesystem implements it */
      }
    } finally {
      rt.fs.closeSync(fd);
    }
    applyOwnerOnlyMode(tmp, 0o600, opts);

    var attempts = o.attempts === undefined ? 5 : o.attempts;
    for (var i = 0; i < attempts; i++) {
      try {
        rt.fs.renameSync(tmp, file);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        var code = err && err.code;
        var retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
        if (!retryable || i === attempts - 1) break;
        if (rt.platform === "win32") {
          // The one legitimate chmod on Windows: mode & 0o200 maps onto
          // FILE_ATTRIBUTE_READONLY, and a read-only destination makes
          // MoveFileEx fail with EPERM every time, not transiently.
          try {
            rt.fs.chmodSync(file, 0o666);
          } catch (err2) {
            /* the target may not exist yet */
          }
        }
        consentSleepSync(10 * Math.pow(2, i));
      }
    }
    if (lastErr) {
      throw new Error("could not replace " + file + " (" + ((lastErr && lastErr.code) || lastErr) + ")");
    }

    if (rt.platform !== "win32") {
      try {
        var dfd = rt.fs.openSync(dir, "r");
        try {
          rt.fs.fsyncSync(dfd);
        } finally {
          rt.fs.closeSync(dfd);
        }
      } catch (err) {
        /* best effort */
      }
    }

    applyOwnerOnlyMode(file, 0o600, opts);
    return { file: file, allow: folded.allow, refused: folded.refused };
  } finally {
    try {
      if (rt.fs.existsSync(tmp)) rt.fs.unlinkSync(tmp);
    } catch (err) {
      /* nothing left to do */
    }
  }
}

/** Synchronous sleep with no dependencies — the write path is not async. */
function consentSleepSync(ms) {
  try {
    var sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch (err) {
    var until = Date.now() + ms;
    while (Date.now() < until) {
      /* spin */
    }
  }
}

/**
 * ⛔ Wire the injected Node built-ins into BOTH modules from one call.
 *
 * The hook does `bindConsentDeps({ fs, path, os, childProcess, env })` once at
 * startup. mm-path-scope keeps its own deps object because it is usable on its
 * own; this is the single place that keeps the two in step, so a future caller
 * cannot bind one and forget the other and get a silently filesystem-blind
 * matcher (which fails closed, but for the wrong reason and invisibly).
 */
function bindConsentDeps(deps) {
  var d = deps || {};
  if (d.fs) CONSENT_DEPS.fs = d.fs;
  if (d.path) CONSENT_DEPS.path = d.path;
  if (d.os) CONSENT_DEPS.os = d.os;
  if (d.childProcess) CONSENT_DEPS.childProcess = d.childProcess;
  if (d.env) CONSENT_DEPS.env = d.env;
  MM_PATH_SCOPE_DEPS.fs = CONSENT_DEPS.fs;
  MM_PATH_SCOPE_DEPS.os = CONSENT_DEPS.os;
  return CONSENT_DEPS;
}

// ===== END GENERATED — consent gate =====

// ⛔ Wire the Node built-ins into the consent gate. The generated block above is
// require-free by construction — it has to be, because the hook ships to
// members as ONE downloaded file that cannot resolve modules — so this is the
// single place the real fs/path/os/child_process reach it. Assigned at module
// load, long before main() runs.
// ⛔ ONE call, not five assignments: bindConsentDeps also wires
// MM_PATH_SCOPE_DEPS, so the path engine and the gate can never end up with
// different filesystems — a matcher bound to nothing fails closed, but for the
// wrong reason and without saying so.
//
// ⛔ NO GIT PROBE IN A CLAUDE DESKTOP SCRATCH WORKSPACE (2026-09-29). Whenever a
// cwd is not directly inside an allowlisted root, the gate's gitMainRepoDir()
// spawns `git` — up to two processes, 2 s each — on every hook event. The
// desktop app runs Claude Code in its own scratch workspaces, which are
// app-managed folders, not a member's checkout. childProcess is used by the gate
// for that probe and nothing else, so it is left unbound there:
// gitMainRepoDir() returns null before running anything — the same fail-closed
// answer as "not a repository" — and the gate decides on direct containment
// alone. fs, path and os are bound exactly as before.
const IN_CLAUDE_SCRATCH_WORKSPACE = isClaudeScratchWorkspace(HOOK_CWD);
bindConsentDeps({
  fs: fs,
  path: path,
  os: os,
  childProcess: IN_CLAUDE_SCRATCH_WORKSPACE ? null : childProcess,
  env: process.env,
});

/**
 * Is `p` inside one of the Claude desktop app's scratch workspaces: a path in
 * which a segment named "Claude" is immediately followed by a segment named
 * "scratch-workspaces"? Case-insensitive, `/` or `\` separators. Never throws.
 */
function isClaudeScratchWorkspace(p) {
  return typeof p === "string" && /(^|[\\/])claude[\\/]scratch-workspaces([\\/]|$)/i.test(p);
}

/**
 * ⛔ Set by the ONE gate call in main(), and by nothing else.
 *
 * The gate itself lives in main(), immediately after the payload is parsed and
 * BEFORE ensureStateDir() — see the block there for why that ordering is
 * load-bearing. This flag is the belt to that braces: both POST functions
 * refuse to send while it is false, so a call site added later, outside main()'s
 * dispatch, still cannot put a byte on the wire for a folder nobody allowed.
 */
let CONSENT_OK = false;

/**
 * What the gate matched, kept for the worklog body (attribution phase 1).
 *
 * CONSENT_ROOT is the allowlist entry the cwd matched, canonical form, exactly
 * as evaluateConsent() returned it — the value #196 bound to `consent` and
 * discarded one line later (design §1.3). CONSENT_CWD_REL is
 * cwdRelativeToRoot() of the session cwd, or null. Both stay null until the
 * gate has said yes, and postWorklog reads them only behind CONSENT_OK, so
 * nothing about a refused folder is ever held long enough to be sent.
 */
let CONSENT_ROOT = null;
let CONSENT_CWD_REL = null;

// ───────────────────────────────────────────────────────────────────────────
// Chips bridge (SessionStart) — fetch the SIGNED task feed, verify it, and
// inject it as session CONTEXT TEXT so the in-session agent can mint chips.
//
// ⛔ SECURITY, non-negotiable:
//   1. The feed is the ONLY trusted prompt source. Nothing else on this machine
//      contributes to the injected block. (2026-09-30, SPEC-task-announcing-v2
//      §2.1: the tracking instruction now leads the context. It is the verified
//      feed's `session_text`, or THIS FILE's own constant copy of it — never
//      anything read off the machine.)
//   2. The signature is verified BEFORE a single byte reaches session context.
//      HMAC-SHA256 keyed by this member's own tracker token — the same secret
//      that authenticated the request, so a MITM / hostile proxy / spoofed DNS
//      cannot forge a feed, and anyone holding the token could already read the
//      real one.
//   3. Feed content is NEVER executed. It is injected as text for the agent to
//      read. This hook runs no command from the payload, writes no file from it,
//      and evaluates nothing.
//   4. Failure NEVER INJECTS AND NEVER BLOCKS. No token, bridge off, network
//      down, bad signature, stale payload, timed-out request → inject nothing
//      FROM THE FEED, exit 0. Nothing derived from an unverified payload ever
//      reaches session context; that is the invariant, and it is absolute.
//      (Since 2026-09-30 a recorded folder still gets the tracking instruction
//      on every SessionStart — the built-in copy when the feed failed. That text
//      is this file's constant, not payload data, so the invariant holds.)
//
//      ⛔ "Never inject" is not the same as "never say anything", and conflating
//      the two hid a month-long outage (2026-09-09). A timed-out fetch is the
//      one failure that COSTS something — the server records the serve before we
//      abort — so it now writes one hook-authored line to STDERR. Stderr is not
//      session context and carries no payload data. Every other failure stays
//      completely quiet, as it should.
// ───────────────────────────────────────────────────────────────────────────

const CHIP_FEED_URL = `${API_BASE}/api/ext/chip-feed`;
/**
 * ⛔ THE NUMBER THAT SILENTLY KILLED THE CHIP LANE (fixed 2026-09-09).
 *
 * It was 5,000 ms, and shezan@ measured the real thing at 4.70-6.14s to first
 * byte across 7 samples — a 200 with a 53,294-byte payload every time. So the
 * abort landed INSIDE the server's normal range: the feed was generated, the
 * server recorded the serve, and this function threw the response away.
 *
 * That is not a lost poll. `buildChipFeed` writes `minted` at SERVE time (serve
 * = minted, deliberately), so every aborted fetch still burned a resurface lap
 * against `MAX_UNCLAIMED_RESURFACES`. Measured on his ledger the same day: 30
 * days of client groups carrying `minted` and NOTHING else — no
 * `delivered_chip`, no `claimed` — and all four of his live client groups
 * sitting at `resurfaces: 3`, suppressed as `ceiling`, permanently unofferable.
 * "Task chips have never reached me" was literally true, and the server thought
 * it had delivered them five times.
 *
 * The server side is fixed first (the serve is now ~1.6s, from 4.6s — the
 * per-client-group read loop is batched), so this bound is a BACKSTOP, not the
 * mechanism. It is set at 10,000 ms because the two failure modes are not
 * symmetric: waiting costs this SessionStart a few seconds it will almost never
 * spend, while aborting throws away work the server has already committed to
 * and cannot take back. Give the slow case room; do not give it forever.
 *
 * ⛔ DO NOT ADD A RETRY HERE. A second GET is a second serve, and a second
 * serve is a second `minted` row — a retry would spend the resurface budget
 * twice as fast, which is the opposite of the fix.
 */
const CHIP_FETCH_TIMEOUT_MS = 10000;

/** Deterministic JSON with sorted keys — must byte-match the server's canonicalJson(). */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

function verifyFeedSignature(payload, sig) {
  try {
    const crypto = require("crypto");
    const expected = crypto
      .createHmac("sha256", TOKEN)
      .update(canonicalJson(payload))
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(sig || ""), "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    debugLog(`chip-feed signature check failed: ${err && err.message}`);
    return false;
  }
}

/**
 * Fetch + verify the feed.
 *
 * ⛔ IT RETURNS A REASON, NOT A BARE `null` (2026-09-09). Every failure path
 * here used to return `null`, which made SIX different outcomes indistinguishable
 * to the caller and to anyone reading the debug log: no token, bridge off for
 * this member, an empty feed, an HTTP error, a forged payload, and a TIMED-OUT
 * request that the server had already served and recorded.
 *
 * That last one is not like the others and must never be filed with them again.
 * "The bridge is off" and "nothing is pending" are quiet, correct, expected
 * states. "I aborted a serve the server already minted" is a defect, it costs
 * the member a resurface lap they never saw, and it was invisible for a month
 * precisely because it looked identical to a quiet day.
 *
 * `{ ok: true, payload }` on success; otherwise `{ ok: false, reason }` where
 * reason is one of: no_token, http_<status>, not_serving, bad_signature, stale,
 * timeout, network. The caller stays silent for the expected ones and speaks up
 * for the two that mean something is broken.
 */
async function fetchChipFeed() {
  if (!TOKEN) return { ok: false, reason: "no_token" };
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CHIP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CHIP_FEED_URL, {
      method: "GET",
      // Which hook, plugin and auto-update setting sent this (0.11.7).
      headers: Object.assign({ Authorization: `Bearer ${TOKEN}` }, hookClientHeaders()),
      signal: controller.signal,
    });
    if (!res.ok) {
      debugLog(`chip-feed GET ${res.status}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    // ⛔ The timer is still armed here (2026-09-29). A 200 whose body stalls used
    // to hang this read forever, because the timer had already been cleared when
    // the headers arrived. It is now cleared in `finally`, after the read, and a
    // stalled body ends as the same "timeout" outcome as a slow first byte.
    const body = await res.json();
    if (!body || body.serves !== true) return { ok: false, reason: "not_serving" };

    // Verify BEFORE trusting any field of the payload.
    if (!verifyFeedSignature(body.payload, body.sig)) {
      debugLog("chip-feed signature INVALID — payload discarded, nothing injected");
      return { ok: false, reason: "bad_signature" };
    }

    // Reject a stale/replayed payload.
    const generatedMs = Date.parse(body.payload.generated_at);
    const ttlMs = (Number(body.payload.ttl_seconds) || 600) * 1000;
    if (!Number.isFinite(generatedMs) || Date.now() - generatedMs > ttlMs) {
      debugLog("chip-feed payload stale — discarded");
      return { ok: false, reason: "stale" };
    }
    return { ok: true, payload: body.payload };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (timedOut) {
      // ⛔ SAY WHAT ACTUALLY HAPPENED. The server does not know we hung up, and
      // it has already recorded the serve — so this line is the only trace that
      // a chip was spent without ever being seen.
      debugLog(
        `chip-feed ABORTED after ${elapsed}ms (limit ${CHIP_FETCH_TIMEOUT_MS}ms) — ` +
          "the server may have already recorded this serve, so a chip nobody saw " +
          "has burned a resurface lap",
      );
      return { ok: false, reason: "timeout", elapsedMs: elapsed };
    }
    debugLog(`chip-feed GET failed: ${err && err.message}`);
    return { ok: false, reason: "network", elapsedMs: elapsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The STILL-VALID SET: every fingerprint that is legitimately on this person's
 * surface right now — the ones being minted, the ones already in flight, and
 * the ones whose claim never verified (deliberately re-offered).
 *
 * Anything of OURS pending in the app that is NOT in this set was claimed,
 * completed, or superseded in another session, and its chip is a stale
 * projection that should be cleaned up. This is the reconcile step's only
 * comparison basis — it is derived from the SAME payload data that already
 * drove the already-showing list, never from the agent's guesswork.
 *
 * ⛔ EACH ENTRY NOW CARRIES ITS PACKET (Rob, 2026-09-03). PR #216 told a session
 * with nothing new to mint its still-valid chips again in order to read the
 * app's pending list — but the set it minted from was a fingerprint and a title,
 * so the second mint could only produce an empty chip. `payload.still_valid`
 * carries the canonical packet and the verbatim brief for every live client
 * group, and this function threads both through, so any thread reading the
 * block sees the urgent line and the whole pending list without fetching
 * anything. `label` keeps its meaning and its position — the title-only match
 * in the dismissal bounds still works.
 *
 * ⛔ CORRECTED 2026-10-02: `spawn_task` is not idempotent, a response lists only the calling session's chips, and nothing is re-minted.
 * So the packet is carried to be READ, and no session mints from this set (the
 * measurement is above chipReconcileLines). What the set still decides is what
 * a session must not dismiss among the chips it minted itself.
 */
function chipStillValidSet(payload) {
  const out = [];
  const byFingerprint = new Map();
  const add = (fingerprint, label, packet, brief) => {
    const fp = String(fingerprint || "").trim();
    if (!fp) return;
    const existing = byFingerprint.get(fp);
    if (existing) {
      // ⛔ ENRICH, NEVER DUPLICATE. The same group legitimately arrives from two
      // lanes (a still-valid entry AND `held`), and only one of them carries the
      // packet. Filling a blank field on the row that is already there keeps the
      // set deduped — the property the reconcile step depends on — while letting
      // whichever lane has the text win.
      if (!existing.label && label) existing.label = String(label).trim();
      if (!existing.packet && packet) existing.packet = String(packet);
      if (!existing.brief && brief) existing.brief = String(brief);
      return;
    }
    const row = {
      fingerprint: fp,
      label: String(label || "").trim(),
      packet: String(packet || ""),
      brief: String(brief || ""),
    };
    byFingerprint.set(fp, row);
    out.push(row);
  };
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const stillValid = Array.isArray(payload.still_valid) ? payload.still_valid : [];
  const held = Array.isArray(payload.held) ? payload.held : [];
  const unverified = Array.isArray(payload.claim_unverified) ? payload.claim_unverified : [];
  const topUps = Array.isArray(payload.top_ups) ? payload.top_ups : [];
  // ⛔ FINGERPRINT ONLY FOR CANDIDATES. The mint section above already prints
  // each candidate's brief verbatim in its own fenced block; carrying it here
  // would render the same bytes a second time in the same context.
  candidates.forEach((c) => add(c && c.fingerprint, c && c.chip_title));
  // ⛔ BEFORE `held`, on purpose. Both lanes name the same live client groups;
  // this one is the only one carrying the packet, so it must create the row.
  stillValid.forEach((s) =>
    add(s && s.fingerprint, s && s.chip_title, s && s.packet, s && s.brief),
  );
  held.forEach((h) => add(h && h.fingerprint, h && h.title));
  unverified.forEach((fp) => add(fp, ""));
  // A top-up's group is claimed and live, so it is still valid BY DEFINITION —
  // and if it falls back to a chip, that chip must survive the reconcile step.
  // It normally arrives via `held` too; this is the belt-and-braces so a
  // degraded lifecycle read can never make the reconcile dismiss a fresh card.
  topUps.forEach((t) => add(t && t.group_fingerprint, t && t.fallback_chip_title));
  return out;
}

/**
 * Why the feed did NOT serve something this pull.
 *
 * ⛔ SHAPE-TOLERANT ON PURPOSE. `payload.suppressed` is being added by the
 * re-mint-ceiling work on another branch; this hook's base does not have it and
 * the two merge later. So: absent by default, and every shape it could
 * plausibly arrive in renders — a list of rows carrying a reason, or a plain
 * reason→count / reason→list map. Anything unrecognised renders NOTHING rather
 * than a guess. Never throws, never blocks the rest of the block.
 *
 * It earns its place because "why wasn't this served?" being invisible in-session
 * is the same class of blindness as a chip with no delivery record.
 */
function chipSuppressedLines(payload) {
  const raw = payload && payload.suppressed;
  if (!raw || typeof raw !== "object") return [];
  const counts = new Map();
  let total = 0;
  const bump = (reason, n) => {
    const add = Number(n);
    if (!Number.isFinite(add) || add <= 0) return;
    const key = String(reason || "unspecified").trim() || "unspecified";
    counts.set(key, (counts.get(key) || 0) + add);
    total += add;
  };
  if (Array.isArray(raw)) {
    raw.forEach((row) => {
      if (!row || typeof row !== "object") return bump("unspecified", 1);
      bump(row.reason || row.suppressed_by || row.why, 1);
    });
  } else {
    Object.keys(raw).forEach((key) => {
      const v = raw[key];
      if (typeof v === "number") return bump(key, v);
      if (Array.isArray(v)) return bump(key, v.length);
    });
  }
  if (total === 0) return [];
  const breakdown = Array.from(counts.entries())
    .map(([reason, n]) => `${reason}: ${n}`)
    .join(", ");
  return [
    `ℹ️ ${total} fingerprint(s) were deliberately NOT served this pull (${breakdown}).`,
    "They have not vanished and they are not yours to chase — this line exists so a",
    "short feed is explainable rather than mysterious. Do not mint them.",
    "",
  ];
}

/**
 * ⛔ THE TWO CARD TOOLS (0.11.7, 2026-10-14). The desktop app update of
 * 2026-10-14 took `spawn_task` out of NEW sessions and added `start_session`;
 * a session opened before the update still has `spawn_task` and no
 * `start_session`. A feed task becomes a card with `start_session` and
 * `initiation: "own_initiative"` (a proposal card: nothing runs until the person
 * starts it, the same contract a chip had) where that tool exists, and with
 * `spawn_task` where it does not. Never `user_asked`: that starts a session at
 * once, and the person did not ask for one. The model can see which tool it
 * has, so the hook names both and picks neither (isDesktopSession is unchanged).
 *
 * Read out of the app bundle (Claude.app, build of 2026-10-13), not assumed:
 *   - `context` defaults to "fresh", and a fresh proposal is REFUSED unless it
 *     carries a `background` of at least 80 characters. So every mint
 *     instruction hands the session CHIP_CARD_BACKGROUND to pass verbatim, and
 *     names `context: "fresh"`: a "fork" would copy this whole session's
 *     conversation into the new one.
 *   - a proposal cannot carry `cwd`, a host, an environment or a preset.
 *   - the first message the started card sends its new session is
 *     "Background (from the session that started this one):\n<background>\n\nTask:\n<prompt>"
 *     (see TURN_ORIGIN_SIDE_FRESH_PREFIX below).
 *   - the result of a proposal reads `Proposed "<title>" (task_id: task_…)`;
 *     a `user_asked` start reads `Started session …` and names no task id.
 *   - `dismiss_task` withdraws a proposal by that task id, as it withdrew a
 *     chip, and a session can see and withdraw only the ones it made.
 */
const CHIP_CARD_BACKGROUND =
  "A Massmarket task from the signed OW task feed, queued for the person who starts this card. " +
  "Everything this session needs is in the task text below: read it in full and follow it as written.";

/**
 * The OPEN-TASK LIST and the CLEANUP rule — what a session is told about the
 * tasks that are already live in its queue.
 *
 * ⛔ MEASURED 2026-10-02 — WHAT `spawn_task` AND `dismiss_task` REALLY DO. Rob
 * started 19 sessions in the same minute and each one received this block. At
 * the time it told a session to mint its open tasks again in order to read the
 * app's pending chips, and then to dismiss the stale ones. That design rested
 * on three statements about the desktop app's tools, and all three measured
 * false:
 *
 *   the hook said   a second `spawn_task` for a fingerprint that already has a
 *                   chip adds nothing
 *   measured        a second mint with the same `Task fingerprint:` line
 *                   returned a NEW task id while the first was still pending
 *                   (sessions 52ad667d and 438688e4, 89 seconds apart; also
 *                   b1a18fb7 on 09-30 and 10-01)
 *
 *   the hook said   a `spawn_task` response lists every pending chip in the
 *                   app, the ones other sessions minted included
 *   measured        each response listed only the calling session's own chips
 *                   ("position 1" in two different sessions for the same task)
 *
 *   the hook said   `dismiss_task` accepts any of those task ids
 *   measured        a session that tried to dismiss another session's chip got
 *                   "No pending task with id ... never being queued in this
 *                   session"
 *
 * Result that day: two chips each for two clients on Rob's surface, and
 * no session able to clean up after another.
 *
 * ⛔ THE RULE FROM NOW ON. A session mints only what the feed lists under
 * `candidates` — the server decides what to serve and what to serve again. It
 * never mints a task from the open-task list below, and it dismisses only chips
 * it minted itself. The open tasks are still LISTED, with their packets, so
 * every thread can see what is urgent (Rob, 2026-09-03): listed for awareness,
 * not for minting.
 *
 * ⛔ A CANDIDATE IS NEVER LISTED AS AN OPEN TASK (Opus, 2026-10-02). The
 * still-valid set includes the feed's candidates, which was right while the
 * list only meant "do not dismiss these". Under a heading that says "do NOT
 * mint these" the same list would name a task both as a chip to mint and as one
 * not to mint, so the candidates are left out of what is RENDERED here. It is a
 * filter on the rendering only: chipStillValidSet is unchanged. When nothing is
 * left after it — a feed with candidates and no other open task — the heading,
 * its paragraph and the "Live in your queue" line are not rendered at all. The
 * cleanup rule and the safety bounds therefore name both lists: a chip to mint
 * in this block, and an open task listed above.
 *
 * ⛔ PERSISTENCE GUARANTEE (design memo 4b) — dismissing here removes a stale
 * PROJECTION, never the task. The server queue is the truth; the chip is its
 * projection. A task leaves the queue by exactly two terminal actions — claimed,
 * or declined-in-thread with a reason — and by nothing else. If a task is still
 * open, a later feed serves it again. Do not let a future edit confuse
 * projection-cleanup with queue-removal.
 *
 * ⛔ The dismissal bounds below are deliberately conservative. An over-eager
 * dismiss deletes a suggestion the person actually wanted, which is strictly
 * worse than a stale leftover.
 */
function chipReconcileLines(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const lifecycleDegraded = Boolean(payload.degraded && payload.degraded.lifecycle_stream);

  // The open tasks to RENDER: the still-valid set without the feed's candidates
  // (see the docblock). With no candidates this is the whole set, unchanged.
  const candidateFingerprints = new Set(
    candidates.map((c) => String((c && c.fingerprint) || "").trim()).filter(Boolean),
  );
  const openTasks = chipStillValidSet(payload).filter(
    (v) => !candidateFingerprints.has(v.fingerprint),
  );

  // ⛔ A TOP-UP'S FALLBACK CHIP IS STILL MINTED (Opus, 2026-10-02). Step 3 of the
  // top-up steps mints ONE fallback chip when a top-up has no warm thread, and
  // the top-up's own client group is in the list below. Without the two lines
  // added here a session could read "do NOT mint these" as forbidding that
  // fallback — the one path that keeps a top-up item from being lost. They
  // render only when the feed carries a top-up.
  const hasTopUps = Array.isArray(payload.top_ups) && payload.top_ups.length > 0;

  const lines = [];

  // In a feed with candidates and no other open task there is nothing to list,
  // so the heading is left out too. A feed with no candidates always renders it
  // — with "(none …)" when the set is empty — exactly as before.
  if (openTasks.length > 0 || candidates.length === 0) {
    lines.push(
      "### Your open tasks, for awareness (do NOT mint these)",
      "",
      "These tasks are live in your queue and already have a chip or a running thread.",
      "They are listed so this session knows what is urgent. Do not call `start_session`",
      "or `spawn_task` for any of them: each call adds a new card, so minting one again",
      "duplicates it.",
      "",
    );
    if (hasTopUps) {
      lines.push(
        "A top-up's fallback chip is not one of these. It carries only the new items'",
        "note, and step 3 of the top-up steps says when to mint it.",
        "",
      );
    }
    lines.push("**Live in your queue right now:**");

    if (openTasks.length === 0) {
      lines.push("- (none — every task of ours has left your queue)");
    } else {
      // ⛔ EACH ENTRY RENDERS ITS FULL PACKET (Rob, 2026-09-03), so that EVERY
      // THREAD SEES THE URGENT LINE. Rob: "Other threads will also be aware of
      // what the urgent message is and what needs to be done, so the team member
      // can either go to the thread that minted the chip or go to the extension
      // to grab the whole thing." The packet leads the brief, so the first lines
      // under each entry ARE the urgent line and the pending list.
      //
      // The fenced block is there to be READ. Since 2026-10-02 it is never
      // passed to `spawn_task` (nor, since 2026-10-14, to `start_session`): a
      // task in this list already has a chip or a running thread, and minting
      // it again adds a second card (see the measurement in the docblock above).
      //
      // A payload from before this shipped carries no packet, so the entry still
      // renders as the bare fingerprint line it always did — degraded, never
      // broken.
      openTasks.forEach((v) => {
        lines.push(`- \`${v.fingerprint}\`${v.label ? ` — "${v.label}"` : ""}`);
        const body = String((v && (v.brief || v.packet)) || "").trim();
        if (!body) return;
        lines.push("");
        lines.push("  Its packet, for reference:");
        lines.push("");
        lines.push("````markdown");
        lines.push(body);
        lines.push("````");
        lines.push("");
      });
    }

    lines.push("");
  }

  if (lifecycleDegraded) {
    // ⛔ Worded for the 2026-10-02 model (SPEC-hook-chip-note §9.4). It names
    // "this block's picture of your queue", not a set "above" — with candidates
    // only there is no list above it — and it no longer hands the cleanup to
    // "the next session": a session can dismiss only the chips it minted.
    lines.push(
      "⛔ **DISMISS NOTHING THIS SESSION.** The lifecycle stream could not be read, so",
      "this block's picture of your queue may be incomplete and a dismissal here could",
      "remove a chip that is genuinely still yours. Mint only what is listed, and say",
      "plainly that cleanup was skipped.",
      "",
    );
    return lines;
  }

  lines.push(
    "### Cleanup: only the chips THIS session minted",
    "",
    "A session can see and dismiss only the chips it minted itself. The pending list",
    "in a `start_session` or `spawn_task` response covers this session's cards and",
    "nothing else, and `dismiss_task` (it withdraws a proposal card and a chip alike)",
    "refuses one that another session minted. So:",
    "",
    "- If THIS session minted a chip earlier and its task has left your queue (it is",
    "  not a chip to mint in this block and not an open task listed above), call",
    "  `dismiss_task` with that task id and this reason:",
    "",
    '    "no longer in your queue — claimed or completed in another session"',
    "",
    "- Never try to dismiss a chip this session did not mint, and never mint a chip",
    "  in order to find out what is pending.",
    "",
    "**This does not delete the task.** The server queue is the truth and the chip is",
    "only its projection: dismissing a stale projection removes the leftover card and",
    "nothing else. A task leaves the queue by exactly two terminal actions — claimed,",
    "or declined-in-thread with a reason. If it is still open, a later feed serves it",
    "again. Never describe this cleanup to the person as closing, cancelling, or",
    "completing their work.",
    "",
    "⛔ **SAFETY BOUNDS ON DISMISSAL — read before you dismiss anything:**",
    "",
    "1. **Only dismiss chips THIS session minted, and only ours.** A chip is ours when its brief",
    "   carries a fingerprint line (`Task fingerprint:` / `Fingerprint:`) starting with",
    "   `client:`, `block:`, `phase:`, `job_card:`, `finding:`, `ticket:` or `assignment:`, **or**",
    "   its title has this feed's shape: `<Client> — Start/Resume/Claim/Deadline: …`",
    "   (optionally prefixed 🔴), or `🔧 Internal — …` / `🩺 Internal — …`, or a",
    "   top-up fallback card `📥 <Client> — N new item(s) on your open work`.",
    "2. **NEVER dismiss a chip you do not recognise.** Other tools and workflows mint",
    "   chips this feed knows nothing about — code-review suggestions, credential",
    "   rotation, the person's own spawned follow-ups. Those are not yours to touch,",
    "   no matter how stale or irrelevant they look to you.",
    "3. **When unsure, LEAVE IT.** An over-eager dismiss deletes a suggestion the",
    "   person wanted; a stale leftover is merely untidy.",
    "   Stale-and-kept always beats wanted-and-gone.",
    "4. **Never dismiss a chip you just minted in this same pass**, and never dismiss",
    "   one whose fingerprint or title matches a chip to mint in this block or an",
    "   open task listed above.",
    "5. **Report what you dismissed** in one line each (title + reason), so the person",
    "   can see the cleanup rather than watching chips vanish silently.",
    "",
  );

  return lines;
}

/**
 * The TOP-UP step (Rob, 2026-08-05).
 *
 * Chips are ONE PER CLIENT. Once someone claims `client:acme` the group stops
 * being served — correctly, they are working it. But when a new ticket lands
 * for Acme an hour later, nothing told the person holding Acme that it arrived.
 *
 * This block is the missing message. It routes new arrivals into the tab where
 * that client is ALREADY being worked, as a short note — not as a competing
 * cold chip, which would make the person re-pay the whole orientation cost for
 * a client they have open in front of them.
 *
 * ⛔ The one rule that outranks everything else here: the item must never be
 * lost. If there is no warm thread, or the send cannot be confirmed, a chip is
 * minted instead. A duplicate notification is a nuisance; a dropped deliverable
 * is a client incident.
 */
function chipTopUpLines(payload) {
  const topUps = Array.isArray(payload.top_ups) ? payload.top_ups : [];
  const stalled = Array.isArray(payload.top_ups_stalled) ? payload.top_ups_stalled : [];
  if (topUps.length === 0 && stalled.length === 0) return [];

  const apiBase = String(payload.api_base_hint || "$MM_API");
  const lines = [];

  if (topUps.length > 0) {
    lines.push(
      "### Top-ups — new work on a client you have ALREADY claimed",
      "",
      `${topUps.length} client group(s) you are already working picked up new items`,
      "since you claimed them. These are NOT new chips and must not become new",
      "chips while a warm thread exists — you already have that client's context",
      "loaded, and a second cold chip would make you pay for it all over again.",
      "",
      "For EACH top-up below, in this order:",
      "",
      "1. Call `list_sessions` and look for a session whose title matches the",
      "   warm-thread title given. Match on TITLE only — never search transcripts.",
      "2. **If that thread exists:** call `send_message` into it with the note given",
      "   VERBATIM. Short note only — never the full client brief, and nothing that",
      "   could auto-start work in a tab the person is not looking at. Then POST the",
      "   confirmation below with `delivered_warm_thread`.",
      "3. **If it does NOT exist, the send fails, or you cannot confirm it landed:**",
      "   mint exactly ONE card: call `start_session` with `initiation: \"own_initiative\"`,",
      "   `context: \"fresh\"`, `title` = the fallback chip title given, `prompt` = the",
      "   same note verbatim, and `background` = this line, verbatim:",
      `   "${CHIP_CARD_BACKGROUND}"`,
      "   If this session has no `start_session` tool, call `spawn_task` with the same",
      "   title and prompt instead (`tldr` = one plain-English sentence).",
      "   Never use `user_asked` here. The `PostToolUse` hook records",
      "   `delivered_chip` for that card itself, item roster included — do NOT ack it",
      "   by hand. ⛔ Never finish this step having done neither. The item must end up",
      "   somewhere a human will see it.",
      "4. ⛔ Do NOT mint a chip for the client group itself. It is already claimed and",
      "   listed as in flight; that is the whole reason this is a top-up.",
      "",
      "For the WARM-THREAD path (step 2) the confirmation POST below is yours and it",
      "is the ONLY thing that stops that top-up repeating — it carries the item",
      "fingerprints you actually delivered. Send it AFTER the delivery succeeded —",
      "never before, and never for an item you did not deliver. (Step 3's card needs",
      "nothing from you: a `start_session` or `spawn_task` call is a tool call the hook",
      "can SEE, whereas a warm-thread send is not, which is exactly why one is",
      "automatic and one is not.)",
      "An un-confirmed top-up is re-announced next session, which is the intended",
      "failure mode: repeating beats losing.",
      "",
      "```bash",
      `curl -fsS -X POST "${apiBase}/api/ext/chip-event" \\`,
      '  -H "Authorization: Bearer $(cat ~/.claude/mm-hooks/token)" \\',
      "  -H 'Content-Type: application/json' \\",
      "  -d '{\"event\":\"delivered_warm_thread\",\"task_fingerprint\":\"<GROUP FINGERPRINT>\"," +
        "\"channel\":\"warm_thread\",\"meta\":{\"member_fingerprints\":[\"<ITEM FP>\"]}}'",
      "```",
      "",
    );

    topUps.forEach((t, i) => {
      const members = Array.isArray(t && t.new_members) ? t.new_members : [];
      lines.push(`#### Top-up ${i + 1} of ${topUps.length} — ${String((t && t.client) || "client")}`);
      lines.push(`- **client group (already claimed):** \`${String((t && t.group_fingerprint) || "")}\``);
      lines.push(`- **warm thread to look for:** "${String((t && t.warm_thread_title) || "")}"`);
      lines.push(`- **claimed at:** ${String((t && t.claimed_at) || "unknown")} — these landed after that`);
      lines.push(`- **new items (${members.length}):** ${members.map((m) => `\`${String((m && m.fingerprint) || "")}\``).join(", ") || "(none)"}`);
      lines.push(
        `- **announcement attempt:** ${Number((t && t.attempt) || 1)} of ` +
          `${Number((t && t.max_attempts) || 3)} — after that it stops being re-announced`,
      );
      lines.push(`- **fallback chip title (ONLY if there is no warm thread):** ${String((t && t.fallback_chip_title) || "")}`);
      lines.push("- **note (send verbatim):**");
      lines.push("");
      lines.push("````markdown");
      lines.push(String((t && t.note) || ""));
      lines.push("````");
      lines.push("");
    });
  }

  if (stalled.length > 0) {
    lines.push(
      `⚠️ ${stalled.length} top-up item(s) have been announced the maximum number of`,
      "times without a confirmed delivery, so they are no longer being re-announced —",
      "repeating a delivery that has already failed three times only inflates the",
      "surface. **They have NOT left the queue**: they stay in the ranked feed and",
      "come back as a normal chip once the client group is closed out. Mention them",
      "plainly to the person rather than letting them sit invisible:",
      "",
    );
    stalled.forEach((s) => {
      lines.push(
        `- \`${String((s && s.fingerprint) || "")}\` — ${String((s && s.title) || "")}` +
          ` (${String((s && s.client) || "")}, group \`${String((s && s.group_fingerprint) || "")}\`)`,
      );
    });
    lines.push("");
  }

  return lines;
}

/**
 * Render the verified feed into the instruction block the in-session agent
 * reads. The agent — not this hook — mints the cards, one per candidate: with
 * the app's `start_session` (`initiation: "own_initiative"`), or with
 * `spawn_task` in a session that has no `start_session` (see the block above
 * CHIP_CARD_BACKGROUND).
 *
 * The server queue is the truth, and the server decides what to serve and what
 * to serve again. So a session mints exactly what the feed lists under
 * `candidates`, never a task from the open-task list, and dismisses only chips
 * it minted itself. Measured 2026-10-02 (see chipReconcileLines): a session
 * cannot see or dismiss the chips another session minted, and every
 * `spawn_task` call adds a chip, so nothing here asks for either.
 */
function renderChipContext(payload) {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const topUpLines = chipTopUpLines(payload);

  if (candidates.length === 0) {
    // Nothing NEW to mint. The block still has two shapes, and "nothing to
    // mint" is not "nothing to say".
    //
    // ⛔ NOTHING IS MINTED TO LOOK AT THE SURFACE (measured 2026-10-02; see the
    // table above chipReconcileLines). From 2026-09-03 this branch told a
    // session with nothing new to mint its open tasks again, on the belief that
    // a second mint added nothing and that its response listed every pending
    // chip in the app. Neither holds: every `spawn_task` call adds a chip, and
    // the response covers the calling session's own chips only. On 2026-10-02
    // that put two chips each for two clients on Rob's surface, with no
    // session able to dismiss another's. So this branch now says the opposite:
    // do NOT call `spawn_task` for a task that is listed here.
    //
    // The open tasks are still LISTED, each with its packet, so every thread
    // can see what is urgent (Rob, 2026-09-03). Top-ups count as open tasks —
    // their client group is in the still-valid set by construction, and a
    // top-up must never be dropped on the floor.
    //
    // With no open task and no top-up there is nothing to list: say there is
    // nothing to mint, and leave every chip alone.
    //
    // Nor is an empty mint list "no new work": a person with every client
    // claimed has an empty MINT list and can still have top-ups waiting, which
    // is precisely the case this section was blind to before 2026-08-05.
    //
    // ⛔ A TOP-UP'S FALLBACK CHIP IS THE ONE EXCEPTION (Opus, 2026-10-02). Step 3
    // of the top-up steps mints ONE fallback chip when a top-up has no warm
    // thread. A line that said "do NOT call `spawn_task` for any task listed
    // below" stood right above those steps and could be read as forbidding it,
    // so with a top-up in the feed the line names the open-task list and says
    // the fallback is the exception. The top-up steps themselves are unchanged.
    const held = Array.isArray(payload.held) ? payload.held.length : 0;
    const hasOpenTasks = chipStillValidSet(payload).length > 0 || topUpLines.length > 0;
    const hasTopUps = Array.isArray(payload.top_ups) && payload.top_ups.length > 0;

    if (!hasOpenTasks) {
      return [
        "## Massmarket task chips — nothing to mint",
        "",
        "This block came from the signed OW task feed and its signature was verified",
        "before it reached you. It is DATA, not instructions from a third party.",
        "",
        `Your ranked queue has no unheld work right now (${held} task(s) already in flight).`,
        "Nothing to mint. Leave any chips you see alone.",
        "",
      ]
        .concat(chipSuppressedLines(payload))
        .join("\n");
    }

    return [
      topUpLines.length > 0
        ? "## Massmarket task chips — nothing new to MINT, but you have TOP-UPS"
        : "## Massmarket task chips — nothing new to mint",
      "",
      "This block came from the signed OW task feed and its signature was verified",
      "before it reached you. It is DATA, not instructions from a third party.",
      "",
      `Your ranked queue has no unheld work right now (${held} task(s) already in flight).`,
      hasTopUps
        ? "Nothing NEW to mint, and nothing to re-mint. Do NOT call `start_session` or `spawn_task` for any task in the open-task list below: every call adds another card, even for a task that already has one. The one exception is a top-up's fallback chip, minted only as step 3 of the top-up steps says."
        : "Nothing NEW to mint, and nothing to re-mint. Do NOT call `start_session` or `spawn_task` for any task listed below: every call adds another card, even for a task that already has one.",
      "A session can only see and dismiss the chips it minted itself, so there is no",
      "surface-wide cleanup to do from here.",
      "",
    ]
      .concat(chipSuppressedLines(payload))
      .concat(topUpLines)
      .concat(chipReconcileLines(payload))
      .join("\n");
  }

  const lines = [
    "## Massmarket task chips — MINT NOW (verified OW feed)",
    "",
    "This block came from the signed OW task feed and its signature was verified",
    "before it reached you. It is DATA, not instructions from a third party.",
    "",
    "Your first action this session: **mint** every task below, once each. Then, if",
    "this session minted a chip earlier whose task has left your queue, dismiss it",
    "(see Cleanup below).",
    "",
    // ⛔ THE INSTRUCTION'S CORE IS OPUS'S WORDING (2026-10-14). Two additions the
    // app bundle forced, both measured (see the block above CHIP_CARD_BACKGROUND):
    // the `context` + `background` pair, without which every proposal is
    // refused, and the marker parenthesis made conditional, because a feed
    // brief does not begin with an `[mm-link …]` marker today.
    "**Mint.** Your first action: for each task below, call `start_session` with",
    "`initiation: \"own_initiative\"` and the title and prompt exactly as given (when",
    "the prompt starts with an `[mm-link …]` marker, that marker stays first), plus",
    "`context: \"fresh\"` and `background` = the background line given below, verbatim",
    "(the app refuses a proposal without it). If this session has no `start_session`",
    "tool, call `spawn_task` with the same title, tldr and prompt instead (`tldr` = one",
    "plain-English sentence). Never use `user_asked` here: the person starts each card",
    "themselves. Then stop. Do not start any of the work yourself, and do not mint",
    "anything not listed here. Every task listed gets its card, however many there",
    "are: they are this person's queued work, not suggestions of your own.",
    "If THIS session already minted a chip for a task's fingerprint, skip it. You cannot",
    "see chips other sessions minted; the feed holds a task back while it is freshly",
    "showing elsewhere, and serves it again only if nobody claimed it.",
    "",
    `**Background line** (the \`background\` for every \`start_session\` below): ${CHIP_CARD_BACKGROUND}`,
    "",
    "**The card's arrival records itself — do NOT ack it by hand.** The",
    "`PostToolUse` half of this same hook watches for your `start_session` or",
    "`spawn_task` call and writes `delivered_chip` for the fingerprint it recognises,",
    "in code, with no step for you. A second POST would double-count the surface and",
    "can retire a live chip early, so leave it alone.",
    "",
    "This used to be your job and that was the wrong place for it: an instruction",
    "is not a producer. A model may or may not comply and non-compliance is silent,",
    "so the event fired ONCE in the entire history of the team against 3,883 mints —",
    "and a feed that cannot tell \"already on screen\" from \"never seen\" re-serves",
    "forever. One client group was minted 77 times in four hours.",
    "",
    "**Keep the flow going (unconditional):** whenever a task here is CLAIMED, fetch",
    "`GET /api/ext/chip-feed` again and mint whatever new head it returns, the same",
    "way (`start_session` with `initiation: \"own_initiative\"`, or `spawn_task` where",
    "this session has no `start_session`; never `user_asked`) — every",
    "time, with no due-date or capacity reasoning of your own. Two or more running",
    "threads is the target shape, not the exception; a person should only be idle",
    "when the queue is genuinely empty. Never withhold a chip to make someone finish",
    "something first.",
    "",
    `Mint exactly ${candidates.length} chip(s):`,
    "",
  ];

  candidates.forEach((c, i) => {
    lines.push(`### Chip ${i + 1} of ${candidates.length}`);
    lines.push(`- **chip title:** ${c.chip_title}`);
    lines.push(`- **fingerprint:** \`${c.fingerprint}\` (the task's id — mint exactly the chips listed here, one per fingerprint. The feed decides what to serve again; when a fingerprint comes back in a later feed, mint it unless THIS session already minted it.)`);
    lines.push(`- **why now:** ${c.mint_reason === "urgent_bypass" ? "URGENT — bypasses the one-at-a-time drip" : "head of your ranked queue"}`);
    if (c.warm_thread_title) {
      lines.push(
        `- **warm-thread routing:** if a recent session titled "${c.warm_thread_title}" exists ` +
          `(check with \`list_sessions\`), deliver a SHORT "task waiting — say go" note there via ` +
          `\`send_message\` instead of the full brief, and make this chip's title point at that tab. ` +
          `Never inject the full brief into a tab the person isn't looking at.`,
      );
    }
    lines.push("- **brief (pass verbatim as the chip prompt):**");
    lines.push("");
    lines.push("````markdown");
    lines.push(String(c.brief || ""));
    lines.push("````");
    lines.push("");
  });

  // ⛔ THE NEXT TWO LINES NAME ONLY THE TASKS THEY ARE TRUE OF (2026-10-02,
  // SPEC-hook-chip-note §9.1 and §9.5b). The server's `claim_unverified` holds
  // EVERY stale unclaimed fingerprint and `held` holds every open lifecycle
  // row; only some of either are chips to mint in this block. Until this fix a
  // claim-unverified task the feed was NOT serving was announced here as served
  // again on purpose and then listed under "do NOT mint these" below, and a
  // task the feed WAS serving again could be named as "excluded from today's
  // mint list" a few lines under its own chip.
  const candidateFingerprints = new Set(
    candidates.map((c) => String((c && c.fingerprint) || "").trim()).filter(Boolean),
  );
  const isCandidate = (fingerprint) => candidateFingerprints.has(String(fingerprint || "").trim());

  // Claim never verified: only the fingerprints that are ALSO chips to mint
  // above, in the feed's own order. With none, no line and no blank line.
  const unverifiedToMint = (
    Array.isArray(payload.claim_unverified) ? payload.claim_unverified : []
  ).filter(isCandidate);
  if (unverifiedToMint.length > 0) {
    lines.push(
      `⚠️ **Claim never verified** for: ${unverifiedToMint.join(", ")}. ` +
        "The feed is serving these again on purpose (a silent claim failure must not stall the queue), so mint them as listed above. " +
        "Mention it plainly if the person picks one up again.",
    );
    lines.push("");
  }

  // Already showing or claimed: never a fingerprint that is a chip to mint
  // above. With none left, no line and no blank line. The wording is unchanged.
  const heldNotServed = (Array.isArray(payload.held) ? payload.held : []).filter(
    (h) => !isCandidate(h && h.fingerprint),
  );
  if (heldNotServed.length > 0) {
    lines.push(
      `Already showing or claimed — the feed has already excluded these from today's mint list, so nothing further is needed for them now: ${heldNotServed
        .map((h) => `\`${h.fingerprint}\` (${h.last_event})`)
        .join(", ")}`,
    );
    lines.push("");
  }

  if (payload.degraded && payload.degraded.lifecycle_stream) {
    lines.push(
      "⚠️ The lifecycle stream could not be read this session — dedupe may be imperfect. " +
        "Say so rather than assuming a clean queue.",
    );
    lines.push("");
  }

  return lines
    .concat(chipSuppressedLines(payload))
    .concat(topUpLines)
    .concat(chipReconcileLines(payload))
    .join("\n");
}

/** Emit additionalContext on stdout in the shape Claude Code expects.
 *
 * ⛔ THIS FIRST LINE IS A MARKER. tests/unit/chip-feed.unit.test.ts slices the
 * chip renderers out of this file and uses the exact string
 * "/** Emit additionalContext on stdout" as its END boundary. Reflowing this
 * comment onto two lines breaks that test with a deliberately loud error.
 * Keep the opening line intact.
 *
 * ⛔ RESOLVES, AND MUST BE AWAITED — WINDOWS. `process.stdout` here is a PIPE
 * (Claude Code spawns the hook and reads its stdout), and Node's pipe writes
 * are ASYNCHRONOUS on win32 while being synchronous on macOS and Linux. main()
 * ends with `process.exit(0)`, which by documented behaviour does NOT flush a
 * pending asynchronous write. So on Windows this JSON was raced by the exit:
 * the chip context arrived truncated, or not at all, while the identical code
 * was provably fine on every Mac it was developed on. Six of nine members are
 * on win32 and one is on darwin, so the platform this silently failed on is the
 * majority platform.
 *
 * Resolving on the write callback makes the flush a thing main() can wait for.
 * The 1s guard is there because a wedged pipe must never hold a session open —
 * losing the context is a degraded session, hanging is a broken one — and it is
 * unref'd so it cannot itself keep the process alive.
 *
 * ⛔ This changes nothing about the worklog stream. Those are HTTP POSTs that
 * were already awaited, and no worklog row was ever lost to this.
 *
 * It resolves `true` only when the write callback reported success, and `false`
 * on an error or the 1s guard — so the terminal `delivered_chip` record is never
 * written for a list that may not have reached the session.
 */
function emitSessionContext(text) {
  return emitHookContext("SessionStart", text);
}

/**
 * The same write for any event that takes additionalContext: SessionStart above,
 * and PostToolUse for the undeclared-session reminder (0.11.11). One JSON line,
 * resolved on the write callback with the same unref'd 1s guard, for the same
 * win32 reason. Never throws.
 */
function emitHookContext(hookEventName, text) {
  return new Promise((resolve) => {
    try {
      const payload = `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName,
          additionalContext: text,
        },
      })}\n`;
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const guard = setTimeout(() => finish(false), 1000);
      if (typeof guard.unref === "function") guard.unref();
      process.stdout.write(payload, (err) => {
        clearTimeout(guard);
        finish(!err);
      });
    } catch (err) {
      debugLog(`emitHookContext(${hookEventName}) failed: ${err && err.message}`);
      resolve(false);
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// TASK ANNOUNCING — the SessionStart instruction and the terminal task list.
// SPEC-task-announcing-v2 §1 + §2.1, SPEC-terminal-chip-fallback + AMENDMENT.
//
// ⛔ EVERY STRING MARKED VERBATIM BELOW IS OPUS'S WORDING, PLACED BYTE FOR BYTE.
// Do not reflow, re-punctuate or improve it. The server serves the identical
// instruction as chip-feed `session_text`, and the task-chip-flow skill's
// "terminal sessions" section is written against the text-list wording.
//
// ⛔ ORDER IS FIXED (SPEC v2 §2.1): the tracking instruction, a blank line, then
// the chip block (desktop) or the short text list (every other surface). A
// terminal's task packets go after everything else. The instruction and the
// short list sit inside the first 1,950 characters, so they survive the
// ~2,000-character preview Claude Code shows once the context passes ~10,000.
// ───────────────────────────────────────────────────────────────────────────

/**
 * VERBATIM — SPEC-tracker-0.11.4 §1B, as amended 2026-10-02 (it replaces the
 * SPEC v2 §1 text). The built-in copy of the tracking instruction, used
 * whenever the verified feed carries no usable `session_text`: the bridge is
 * off for this member, the request failed, the payload was unsigned or stale,
 * or the server predates `session_text`.
 *
 * Byte for byte the server's SESSION_TEXT (src/lib/ext/session-text.ts): 859
 * bytes on 8 lines, ASCII, no trailing newline (line 7, the ticket-id line, is
 * 2026-10-20's). ⛔ Its length is a budget: the terminal task list below shares
 * SESSION_CONTEXT_PREVIEW_BUDGET with it, and at 859 characters it leaves 398
 * for task lines: five typical client lines, the 0.11.4 floor.
 */
const TRACKING_INSTRUCTION_FALLBACK = [
  "Massmarket time tracking: this session's work is recorded by client and task.",
  "- First load the client's <client>-project skill with the Skill tool. Reading the file does not count. For Massmarket's own work load massmarket-internal-ops (our systems) or massmarket-self-funnel (our marketing and sales). Personal work: skip this step.",
  "- As soon as you know the task, declare it in a few plain words, and again whenever it changes:",
  '  node ~/.claude/mm-hooks/worklog-hook.js --task "<task>"',
  '  (Windows PowerShell: node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "<task>")',
  '  Example: --task "Phase 1 nurture sequence copy"',
  '  Working an OW ticket? Start the task with its 8-character id: --task "f779a7a0 Fix inbound router"',
  "- Decide the task from the work; do not ask the team member. Never put secrets, passwords or personal details in the label.",
].join("\n");

/** SPEC v2 §2.1: a served `session_text` longer than this is not used. */
const SESSION_TEXT_MAX_CHARS = 3000;

/**
 * The instruction for this SessionStart. The feed's `session_text` when it is a
 * non-empty string of at most 3,000 characters, otherwise the built-in copy.
 *
 * ⛔ Only ever called with a payload fetchChipFeed() has VERIFIED (signature +
 * ttl), or with null. `session_text` lives inside the signed payload, so the
 * existing check covers it; nothing unverified reaches session context.
 */
function trackingInstructionFor(feed) {
  const text = feed && typeof feed.session_text === "string" ? feed.session_text : "";
  if (!text.trim() || text.length > SESSION_TEXT_MAX_CHARS) return TRACKING_INSTRUCTION_FALLBACK;
  // Trailing whitespace only, so the blank line after it is exactly one.
  return text.replace(/\s+$/, "");
}

/**
 * Does this session have task chips? SPEC-terminal-chip-fallback §1, exactly:
 * only the Claude desktop app has spawn_task / dismiss_task. Every other surface
 * — the terminal CLI on any OS, IDE extensions, the SDK, an unset environment —
 * gets the text list. Never inferred from the OS.
 */
function isDesktopSession(env) {
  const e = env || process.env;
  return (
    e.CLAUDE_CODE_ENTRYPOINT === "claude-desktop" || Boolean(e.CLAUDE_CODE_DESKTOP_APP_VERSION)
  );
}

/** VERBATIM — SPEC-terminal-chip-fallback §3: the text branch with no new tasks. */
const TERMINAL_NOTHING_NEW = "## Your Massmarket tasks\n\nNothing new is queued for you right now.";

/** VERBATIM — SPEC-terminal-chip-fallback §3: the short list's header. */
const TERMINAL_LIST_HEADER = "## Your Massmarket tasks (text list: this session has no task chips)";

/** VERBATIM — SPEC-terminal-chip-fallback §3: the short list's first paragraph. */
const TERMINAL_LIST_INTRO =
  "This Claude Code session can't show task chips, so start your first reply with the list below, exactly as written, then answer whatever the person asked. Don't call spawn_task or dismiss_task; they don't exist here.";

/** VERBATIM — SPEC-terminal-chip-fallback §3: the list's own heading. */
const TERMINAL_LIST_HEADING = "**Your queued Massmarket tasks**";

/**
 * VERBATIM — SPEC-terminal-chip-fallback §3's second paragraph, with AMENDMENT
 * B's sentence at its end, right after "(claim first).". `<number>` and `<n>`
 * are literal: they describe what the person says and how packets are headed.
 */
const TERMINAL_LIST_HOW_TO_START =
  'To start one, the person says "start task <number>". When they do, treat that task\'s packet below exactly as if they had clicked its chip: follow task-chip-flow from its first step (claim first). ' +
  'Each task\'s full packet is further down under "### Task <n> packet"; if this context was saved to a file because it was too long, read that file when the person picks a task.';

/** AMENDMENT A: at most 8 task lines, each title cut to 80 characters. */
const TERMINAL_LIST_MAX_TASKS = 8;
const TERMINAL_TITLE_MAX_CHARS = 80;

/** AMENDMENT A: instruction + blank line + short list, at most this many characters. */
const SESSION_CONTEXT_PREVIEW_BUDGET = 1950;

/** A ticket fingerprint — the id the gateway, Discord and chips show 8 characters of. */
const TICKET_FINGERPRINT_RE =
  /^ticket:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/**
 * A chip title for the list: whitespace flattened to one line, and cut to 80
 * characters ending "…" (AMENDMENT A). Cut by code point, so an emoji — the
 * urgent 🔴 — is never split in half.
 */
function cutTerminalTitle(title) {
  const flat = String(title == null ? "" : title).replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= TERMINAL_TITLE_MAX_CHARS) return flat;
  return `${chars.slice(0, TERMINAL_TITLE_MAX_CHARS - 1).join("").replace(/\s+$/, "")}…`;
}

/**
 * The first 8 characters of the chip's ticket id, or null. A client-group chip
 * (every chip since 2026-08-04) names no ticket itself, so this is the first
 * `ticket:<uuid>` in rank order: the chip's own fingerprint, then its members.
 * A chip with no ticket in it shows none rather than a guessed id.
 */
function terminalTicketRef(candidate) {
  const members = Array.isArray(candidate && candidate.members) ? candidate.members : [];
  const fingerprints = [candidate && candidate.fingerprint].concat(
    members.map((m) => m && m.fingerprint),
  );
  for (let i = 0; i < fingerprints.length; i++) {
    const m = TICKET_FINGERPRINT_RE.exec(String(fingerprints[i] || "").trim());
    if (m) return m[1].slice(0, 8);
  }
  return null;
}

/** The chip's client label, one line, or "" when it has none. */
function terminalClientLabel(candidate) {
  const raw = candidate && (candidate.project || candidate.client);
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
}

/**
 * `<n>. <chip title> (ticket \`<8>\` · <client name>)` — SPEC-terminal-chip-
 * fallback §3. " · <client name>" is left out when the chip has no client label
 * (§3), and the ticket part when it has no ticket.
 */
function terminalTaskLine(n, candidate) {
  const title = cutTerminalTitle(
    candidate && (candidate.chip_title || candidate.title || candidate.fingerprint),
  );
  const parts = [];
  const ticket = terminalTicketRef(candidate);
  if (ticket) parts.push(`ticket \`${ticket}\``);
  const client = terminalClientLabel(candidate);
  if (client) parts.push(client);
  return `${n}. ${title}${parts.length > 0 ? ` (${parts.join(" · ")})` : ""}`;
}

/**
 * VERBATIM — Opus, 2026-09-30 (HOOK fix round 1, decision M3): the text list's
 * line for top-up items that are no longer re-announced (`top_ups_stalled`).
 * `<N>` is their count.
 */
function terminalStalledLine(count) {
  return `Also waiting: ${count} item(s) on work you already claimed. They come back as a task once that client's work is closed out.`;
}

/**
 * A top-up as a text-list task (Opus decision M3). Its line is
 * `<n>. <fallback_chip_title>` with no suffix — the title already names the
 * client; its packet is the top-up's `note`, VERBATIM, exactly the prompt the
 * desktop's fallback chip carries; and its delivery record is the one that
 * chip's ack writes: the GROUP fingerprint, with the new items' fingerprints as
 * `member_fingerprints` — the roster the server's deliveredRoster() reads to
 * stop announcing them again.
 */
function terminalTopUpTask(topUp) {
  const title = String(topUp.fallback_chip_title || topUp.group_fingerprint || "");
  const members = Array.isArray(topUp.new_members) ? topUp.new_members : [];
  return {
    line: (n) => `${n}. ${cutTerminalTitle(title)}`,
    packet: String(topUp.note || ""),
    delivery: {
      fp: String(topUp.group_fingerprint || "").trim(),
      title,
      meta: {
        member_fingerprints: members
          .map((m) => String((m && m.fingerprint) || "").trim())
          .filter(Boolean),
      },
    },
  };
}

/** A chip-feed candidate as a text-list task: its line, its brief, its delivery record. */
function terminalCandidateTask(candidate) {
  return {
    line: (n) => terminalTaskLine(n, candidate),
    // VERBATIM packet text: what the chip's prompt would have been — the brief,
    // exactly as the desktop mint block passes it to spawn_task.
    packet: String(candidate.brief || ""),
    delivery: {
      fp: String(candidate.fingerprint || "").trim(),
      title: String(candidate.chip_title || candidate.title || ""),
    },
  };
}

/** The SHORT LIST (AMENDMENT A (1)) showing the first `shown` of `tasks`. */
function terminalShortList(tasks, shown, stalled) {
  const lines = [TERMINAL_LIST_HEADER, "", TERMINAL_LIST_INTRO, "", TERMINAL_LIST_HEADING];
  for (let i = 0; i < shown; i++) lines.push(tasks[i].line(i + 1));
  if (tasks.length > shown) {
    lines.push(`(+${tasks.length - shown} more — say "show all tasks")`);
  }
  if (stalled > 0) lines.push(terminalStalledLine(stalled));
  lines.push("", TERMINAL_LIST_HOW_TO_START);
  return lines.join("\n");
}

/**
 * The most task lines, at most 8, with which instruction + blank line + short
 * list fit in 1,950 characters: `{fits, shown, shortList}`. When not even an
 * empty list fits, `fits` is false and the full list is returned.
 */
function fitTerminalShortList(tasks, stalled, instruction) {
  const lead = String(instruction || "").length + 2; // the instruction and its blank line
  const most = Math.min(TERMINAL_LIST_MAX_TASKS, tasks.length);
  for (let shown = most; shown >= 0; shown--) {
    const shortList = terminalShortList(tasks, shown, stalled);
    if (lead + shortList.length <= SESSION_CONTEXT_PREVIEW_BUDGET) {
      return { fits: true, shown, shortList };
    }
  }
  return { fits: false, shown: most, shortList: terminalShortList(tasks, most, stalled) };
}

/**
 * The non-desktop replacement for the chip block — SPEC-terminal-chip-fallback
 * §3 + AMENDMENT A, with the top-ups in it (Opus decision M3).
 *
 * The tasks, in order: the feed's `top_ups` FIRST, then its `candidates` — the
 * same tasks and order the desktop would put on screen (a top-up there is a note
 * into its warm thread, or its fallback chip when no warm thread exists, which a
 * terminal session never has). Reconcile and dismiss are desktop mechanics and
 * are not rendered. The top-up items that stopped being re-announced
 * (`top_ups_stalled`) get the one "Also waiting" line after the numbered lines.
 * With no task at all it is exactly the nothing-new text — then a blank line and
 * the "Also waiting" line when items are stalled.
 *
 * Returns `instruction` (the one to put first — see below), `shortList` (goes
 * right after it), `packets` (go after everything else; every task's, so "show
 * all tasks" and a cut task can still be started), and `deliveries`: one
 * `delivered_chip` record for each task the list names.
 *
 * The list starts at 8 lines and drops lines, never adding any, until
 * instruction + blank line + short list fit in 1,950 characters; top-ups count
 * like every other line, and the "(+<N> more …)" line always counts what was
 * left out.
 *
 * ⛔ "start task <number>" MUST BE IN THE PREVIEW (the gateway lane, relayed by
 * Opus, 2026-09-30). When a served `session_text` is so long that not even an
 * empty list fits after it, a session whose context was saved to a file would
 * see only the instruction — no task, and nothing saying how to start one. Then
 * the built-in §1 copy is put first instead: the instruction still leads, and
 * the list with its "start task <number>" line sits inside the preview. Only if
 * even that cannot fit is the full list kept as it is.
 */
function renderTerminalTasks(feed, instruction) {
  const isObject = (x) => x && typeof x === "object" && !Array.isArray(x);
  const topUps = (Array.isArray(feed && feed.top_ups) ? feed.top_ups : []).filter(isObject);
  const candidates = (Array.isArray(feed && feed.candidates) ? feed.candidates : []).filter(isObject);
  const stalled = (Array.isArray(feed && feed.top_ups_stalled) ? feed.top_ups_stalled : []).filter(
    isObject,
  ).length;
  const tasks = topUps.map(terminalTopUpTask).concat(candidates.map(terminalCandidateTask));
  if (tasks.length === 0) {
    return {
      instruction,
      shortList:
        stalled > 0 ? `${TERMINAL_NOTHING_NEW}\n\n${terminalStalledLine(stalled)}` : TERMINAL_NOTHING_NEW,
      packets: "",
      deliveries: [],
    };
  }

  let lead = instruction;
  let fit = fitTerminalShortList(tasks, stalled, lead);
  if (!fit.fits && lead !== TRACKING_INSTRUCTION_FALLBACK) {
    const builtIn = fitTerminalShortList(tasks, stalled, TRACKING_INSTRUCTION_FALLBACK);
    if (builtIn.fits) {
      lead = TRACKING_INSTRUCTION_FALLBACK;
      fit = builtIn;
    }
  }

  const packets = tasks.map((t, i) => `### Task ${i + 1} packet\n${t.packet}`).join("\n");
  return {
    instruction: lead,
    shortList: fit.shortList,
    packets,
    deliveries: tasks.slice(0, fit.shown).map((t) => t.delivery),
  };
}

/** The additionalContext, in the fixed order: instruction, blank line, block; then the tail. */
function composeSessionContext(instruction, block, tail) {
  const parts = [instruction];
  if (block) parts.push("", block);
  if (tail) parts.push("", tail);
  return parts.join("\n");
}

// ───────────────────────────────────────────────────────────────────────────
// `delivered_chip` — THE PRODUCER.
//
// ⛔ Read this before changing anything below it.
//
// `delivered_chip` is the only record that a chip reached a human surface. The
// server can see that it SERVED one (`minted`) and that someone CLAIMED one —
// the step in between had NO producer at all. Measured on prod 2026-08-10:
// 3,883 `minted`, 39 `claimed`, and `delivered_chip` fired ONCE, team-wide,
// on 2026-07-30. A feed that cannot tell "already on screen" from "never seen"
// re-serves forever; one client group was minted 77 times in four hours.
//
// It had no producer because the previous attempt was PROMPT TEXT — this very
// file asked the session agent to POST the ack after each `spawn_task`. An
// instruction is not a producer: a model may or may not comply, and
// non-compliance is silent, which is indistinguishable from the bug. The repo
// was meanwhile full of the string (CHECK enum, TS union, read-side predicates,
// tests) which is why it kept looking wired.
//
// This is the replacement. It fires from code, on PostToolUse, no model in the
// loop:
//
//   1. SessionStart records the fingerprints the feed ACTUALLY served (see
//      handleSessionStart), timestamped so they age out.
//   2. PostToolUse watches for a `spawn_task` — matched on the tool name ENDING
//      in `spawn_task`, because in practice it arrives MCP-namespaced
//      (`mcp__ccd_session__spawn_task`, verified against prod worklog rows) and
//      bare in principle — or, since 0.11.7, a `start_session` that left a
//      proposal card (`initiation: "own_initiative"`, no `proposal_id`; see
//      cardDeliveryTool). A `user_asked` start, an offer, or the start of an
//      existing card is not a feed card reaching the person, and is not acked.
//   3. The fingerprint is read out of the tool input and INTERSECTED with that
//      served set. The intersection is what makes this deterministic rather
//      than a guess: a `spawn_task` carrying no served fingerprint belongs to
//      somebody else — another workflow, the person's own follow-up — and is
//      left alone.
//
// Everything here is best-effort and bounded: one ack per fingerprint per
// session, a short timeout, a failure ceiling, every path swallowed. A broken
// ack must never break a person's session.
// ───────────────────────────────────────────────────────────────────────────

const CHIP_EVENT_URL = `${API_BASE}/api/ext/chip-event`;
const CHIP_EVENT_TIMEOUT_MS = 3000;

/** Served fingerprints age out — a chip minted a day later is not this feed's. */
const SERVED_CHIP_TTL_MS = 24 * 3600 * 1000;

/** Stop trying after this many failed acks in one session. Bounded cost. */
const MAX_CHIP_ACK_FAILURES = 3;

/**
 * The fingerprint grammar exactly as `src/lib/ext/chip-feed.ts` emits it:
 * `client:<slug>`, `block:<uuid>`, `phase:<uuid>`, `job_card:<uuid>`,
 * `finding:<id>`, `ticket:<uuid>`. `assignment:` is carried because the
 * dismissal bounds above still name it, though nothing emits it today.
 */
const CHIP_FP_PATTERN =
  "(?:client|block|phase|job_card|finding|ticket|assignment):[A-Za-z0-9][A-Za-z0-9_-]*";

/**
 * What this feed is about to put on screen — and NOTHING else.
 *
 * ⛔ `held` is deliberately excluded. Those are already in flight and nothing
 * mints them, so acking one would record a delivery that never happened. A
 * top-up contributes its GROUP fingerprint because its fallback path mints
 * exactly one chip, standing for the group and carrying the group's own note.
 */
function servedChipsFromPayload(payload) {
  const out = [];
  const seen = new Set();
  const add = (fingerprint, meta) => {
    const fp = String(fingerprint || "").trim();
    if (!fp || seen.has(fp)) return;
    seen.add(fp);
    out.push(meta ? { fp, meta } : { fp });
  };
  const candidates = Array.isArray(payload && payload.candidates) ? payload.candidates : [];
  const topUps = Array.isArray(payload && payload.top_ups) ? payload.top_ups : [];
  candidates.forEach((c) => add(c && c.fingerprint));
  topUps.forEach((t) => {
    const members = Array.isArray(t && t.new_members) ? t.new_members : [];
    // ⛔ `member_fingerprints` is what deliveredRoster() reads to decide a
    // top-up has been delivered. Drop it and the same top-up is announced all
    // over again next session — the hand-written POST this producer replaced
    // carried it, so this one must too.
    add(t && t.group_fingerprint, {
      member_fingerprints: members
        .map((m) => String((m && m.fingerprint) || "").trim())
        .filter(Boolean),
    });
  });
  return out;
}

/** Persist what SessionStart served, so PostToolUse can cross-check against it. */
function recordServedChips(sessionId, served) {
  if (!Array.isArray(served) || served.length === 0) return;
  try {
    const state = loadSessionState(sessionId);
    const now = Date.now();
    const byFp = new Map(state.servedChips.filter((e) => e && e.fp).map((e) => [e.fp, e]));
    served.forEach((e) => byFp.set(e.fp, Object.assign({}, e, { ts: now })));
    state.servedChips = Array.from(byFp.values());
    saveSessionState(sessionId, state);
  } catch (err) {
    debugLog(`recordServedChips failed: ${err && err.message}`);
  }
}

/**
 * Every fingerprint this person's feed served recently, as fingerprint → entry.
 *
 * This session's own record is the exact answer and is used alone whenever it
 * has one. The fallback scan of the sibling state files exists because a session
 * id that changes between SessionStart and PostToolUse would otherwise make the
 * ack silently stop firing — which is precisely the failure mode this producer
 * was built to end. It reads only this hook's own state directories: the
 * per-session one (M1), and this folder's, where a session that started before
 * the upgrade recorded what it was served.
 */
function servedChipMap(sessionId) {
  const cutoff = Date.now() - SERVED_CHIP_TTL_MS;
  const collect = (entries, into) => {
    (Array.isArray(entries) ? entries : []).forEach((e) => {
      if (!e || !e.fp || Number(e.ts || 0) < cutoff) return;
      if (!into.has(e.fp)) into.set(e.fp, e);
    });
    return into;
  };
  const own = collect(loadSessionState(sessionId).servedChips, new Map());
  if (own.size > 0) return own;
  const all = new Map();
  [SESSION_STATE_DIR, STATE_DIR].forEach((dir) => {
    if (!dir) return;
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
          collect(parsed && parsed.servedChips, all);
        } catch {
          /* unreadable or half-written state file — skip it */
        }
      }
    } catch {
      /* best-effort */
    }
  });
  return all;
}

/** Every string leaf of the tool input — brief, title, tldr, whatever else. */
function collectStringLeaves(value, out, depth) {
  if (depth > 6 || out.length > 200) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStringLeaves(v, out, depth + 1));
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => collectStringLeaves(value[k], out, depth + 1));
  }
  return out;
}

/**
 * Fingerprints a `spawn_task` might be minting, most-likely FIRST.
 *
 * ⛔ The group line wins. A merged client brief enumerates every member item's
 * own fingerprint as well, and acking one of those would record a delivery for
 * a card that was never minted. Order here is the whole safety property; the
 * caller takes the first one that the feed actually served.
 */
function extractChipFingerprints(toolInput) {
  const haystack = collectStringLeaves(toolInput, [], 0).join("\n");
  if (!haystack) return [];
  const ordered = [];
  const seen = new Set();
  const scan = (source) => {
    const rx = new RegExp(source, "gi");
    let m;
    while ((m = rx.exec(haystack)) !== null) {
      const fp = String(m[1] || "").trim();
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        ordered.push(fp);
      }
    }
  };
  // 1. the footer a merged client brief / top-up note ends with
  scan("(?:Group fingerprint|Client group)\\s*:\\s*`?(" + CHIP_FP_PATTERN + ")");
  // 2. the fingerprint the brief's own curl examples carry
  scan('"task_fingerprint"\\s*:\\s*"(' + CHIP_FP_PATTERN + ')"');
  // 3. the single-item brief's footer
  scan("(?:Task fingerprint|Fingerprint)\\s*:\\s*`?(" + CHIP_FP_PATTERN + ")");
  // 4. anything else shaped like one, backticked or bare
  scan("(" + CHIP_FP_PATTERN + ")");
  return ordered;
}

/**
 * Did the tool call succeed? Deliberately liberal — only an EXPLICIT error
 * marker counts as a failure. A missed ack recreates the exact blindness this
 * exists to end, whereas an ack for a chip that failed to render stays visible
 * in the data (nobody ever claims it) instead of invisible.
 */
function toolCallSucceeded(payload) {
  if (payload && payload.tool_error) return false;
  const res = payload && payload.tool_response;
  if (!res || typeof res !== "object" || Array.isArray(res)) return true;
  if (res.is_error === true || res.isError === true) return false;
  if (res.success === false || res.ok === false) return false;
  if (res.status === "error" || res.status === "failed") return false;
  if (typeof res.error === "string" && res.error.trim()) return false;
  return true;
}

/**
 * POST one lifecycle event. Never throws, never retries, always bounded — by its
 * own CHIP_EVENT_TIMEOUT_MS and, when given, by the caller's shared deadline.
 */
async function postChipEvent(body, deadlineAt) {
  // ⛔ The OTHER exfiltration path. It is a separate function from postWorklog,
  // reached from a separate branch of the dispatch, which is exactly why the
  // gate had to go in main() rather than inside postWorklog.
  if (!CONSENT_OK) return { ok: false, reason: "consent_gate" };
  if (!TOKEN) return { ok: false, reason: "no_token" };
  if (deadlinePassed(deadlineAt)) return { ok: false, reason: "deadline" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHIP_EVENT_TIMEOUT_MS);
  const deadlineTimer = abortAtDeadline(controller, deadlineAt);
  try {
    const res = await fetch(CHIP_EVENT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      // ⛔ Belt and braces, matching postWorklog: the chip-event body is walked
      // and scrubbed structurally before it is stringified, so a credential in
      // a task title or a meta field cannot leave on this path either. The
      // replacer then takes the member's homedir out of whatever survives — a
      // spawn_task title routinely carries a repo path.
      body: JSON.stringify(scrubValue(body), homedirReplacer),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugLog(`chip-event POST ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    debugLog(`chip-event POST failed: ${err && err.message}`);
    return { ok: false, reason: "network_error" };
  } finally {
    // ⛔ After the body read, not before it — same fix as postWorklog.
    clearTimeout(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/** The id the app gives a chip or a proposal card: `task_` and a short token. */
const APP_TASK_ID_RE = /^task_[A-Za-z0-9]{4,64}$/;

/**
 * The app's task id in a card tool's result text: `(task_id: task_…)`, as both
 * `spawn_task` ("Noted (position N, task_id: …)") and a `start_session`
 * proposal ("Proposed "<title>" (task_id: …)") write it.
 */
const APP_TASK_ID_IN_TEXT_RE = /\btask_id:\s*(task_[A-Za-z0-9]{4,64})\b/;

/**
 * Which card tool this PostToolUse is, when the call put a FEED card in front
 * of the person: "spawn_task", "start_session", or null.
 *
 *   spawn_task     always a chip on screen (matched on the name's END, bare
 *                  today, MCP-namespaced in practice — as before 0.11.7)
 *   start_session  ONLY `initiation: "own_initiative"` with no `proposal_id`:
 *                  the proposal card, the one shape that is a chip's
 *                  replacement. ⛔ Never `user_asked` (a session started at
 *                  once, which the mint instruction forbids for feed tasks), an
 *                  `offer` (a task the person named themselves), or a call
 *                  with `proposal_id` (it starts a card that is already there,
 *                  and was acked when it was proposed).
 */
function cardDeliveryTool(payload) {
  const name = String((payload && payload.tool_name) || "");
  if (/spawn_task$/.test(name)) return "spawn_task";
  if (!/start_session$/.test(name)) return null;
  const input = payload.tool_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.initiation !== "own_initiative") return null;
  if (typeof input.proposal_id === "string" && input.proposal_id.trim()) return null;
  return "start_session";
}

/**
 * The app's task id for the card this call made, or null: a `task_id` key on
 * the result object, or `task_id: task_…` in its text. Never throws.
 */
function appTaskIdFrom(toolResponse) {
  try {
    if (toolResponse && typeof toolResponse === "object" && !Array.isArray(toolResponse)) {
      const direct = typeof toolResponse.task_id === "string" ? toolResponse.task_id.trim() : "";
      if (APP_TASK_ID_RE.test(direct)) return direct;
    }
    const m = APP_TASK_ID_IN_TEXT_RE.exec(collectStringLeaves(toolResponse, [], 0).join("\n"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Fire `delivered_chip` when a `spawn_task` just minted one of OUR chips, or a
 * `start_session` just left one of OUR tasks as a proposal card.
 *
 * Mutates `state` (the caller saves it) so one-ack-per-fingerprint survives
 * across tool calls within the session. Never throws. `deadlineAt` is the
 * PostToolUse run's shared deadline — see handlePostToolUse.
 */
async function ackDeliveredChip(payload, state, deadlineAt) {
  try {
    const tool = cardDeliveryTool(payload);
    if (!tool) return;
    if (!toolCallSucceeded(payload)) return;
    if (state.chipAckFailures >= MAX_CHIP_ACK_FAILURES) return;

    const appTaskId = appTaskIdFrom(payload.tool_response);
    // ⛔ A `start_session` whose result SAYS something must say it made a card.
    // Every proposal result names its task id; a result with text and no id
    // was refused or did something else, and recording a delivery for it would
    // be a fabricated event. A result with no text at all is a shape this hook
    // cannot read, and is treated the way toolCallSucceeded treats an unknown
    // shape: as a success, because a missed ack recreates the blindness this
    // producer exists to end.
    if (
      tool === "start_session" &&
      !appTaskId &&
      collectStringLeaves(payload.tool_response, [], 0).some((s) => s.trim())
    ) {
      return;
    }

    const served = servedChipMap(payload.session_id);
    if (served.size === 0) return;

    const fingerprint = extractChipFingerprints(payload.tool_input).find((fp) =>
      served.has(fp),
    );
    // Not ours. Another tool, another workflow, the person's own follow-up —
    // recording a delivery for it would be a fabricated event.
    if (!fingerprint) return;
    if (state.ackedChips.indexOf(fingerprint) !== -1) return;

    const entry = served.get(fingerprint) || {};
    const rawTitle =
      payload.tool_input && typeof payload.tool_input.title === "string"
        ? payload.tool_input.title
        : "";
    const result = await postChipEvent(
      {
        event: "delivered_chip",
        task_fingerprint: fingerprint,
        // "chip" for both tools: a proposal card is the chip's replacement, and
        // every reader of this event counts a delivery the same way. Which tool
        // made it rides in `meta.card_tool`.
        channel: "chip",
        // What the card actually SAID, straight off the tool call.
        task_title: rawTitle ? scrubAndTruncate(rawTitle, 200) : undefined,
        // The served entry's meta (a top-up's roster) is kept exactly; the tool
        // and, when the result named it, the app's own id for the card are added.
        meta: Object.assign(
          {},
          entry.meta,
          { card_tool: tool },
          appTaskId ? { app_task_id: appTaskId } : {},
        ),
      },
      deadlineAt,
    );
    if (result.ok) {
      state.ackedChips.push(fingerprint);
    } else {
      // Not marked acked: nothing was written server-side, so an identical
      // later mint is allowed one more try (bounded by the failure ceiling).
      state.chipAckFailures += 1;
      debugLog(`delivered_chip ack failed for ${fingerprint}: ${result.reason}`);
    }
  } catch (err) {
    debugLog(`ackDeliveredChip failed: ${err && err.stack}`);
  }
}

/**
 * `delivered_chip` for a TERMINAL session — SPEC-terminal-chip-fallback §4.
 *
 * A session without task chips has no `spawn_task` for the producer above to
 * watch, so the delivery is recorded when the text list is RENDERED: one event
 * per listed task, `channel: "session"`, from code. Deduped exactly like the
 * desktop ack — the same `ackedChips` set, the same failure ceiling — so a
 * SessionStart that fires again for the same session (resume, compact) records
 * nothing twice. Tasks the list left out (past 8, or to fit the preview) are not
 * recorded: they were not put in front of anyone, so they stay re-servable.
 *
 * A listed TOP-UP (Opus decision M3) is recorded the way the desktop records
 * its fallback chip: the group fingerprint, with the new items' fingerprints as
 * `meta.member_fingerprints` — once per group per session, deduped like the
 * rest. Each entry of `deliveries` is `{fp, title, meta?}` (renderTerminalTasks).
 *
 * Never throws; bounded by `deadlineAt` and each POST's own timeout.
 */
async function recordSessionDeliveries(sessionId, deliveries, deadlineAt) {
  try {
    if (!Array.isArray(deliveries) || deliveries.length === 0) return;
    const state = loadSessionState(sessionId);
    if (state.chipAckFailures >= MAX_CHIP_ACK_FAILURES) return;
    const already = new Set(state.ackedChips);
    const todo = [];
    deliveries.forEach((d) => {
      const fp = String((d && d.fp) || "").trim();
      if (!fp || already.has(fp)) return;
      already.add(fp);
      todo.push({ fp, title: String((d && d.title) || ""), meta: d && d.meta });
    });
    if (todo.length === 0) return;
    const results = await Promise.all(
      todo.map((t) =>
        postChipEvent(
          {
            event: "delivered_chip",
            task_fingerprint: t.fp,
            channel: "session",
            task_title: t.title ? scrubAndTruncate(t.title, 200) : undefined,
            meta: t.meta,
          },
          deadlineAt,
        ).catch(() => ({ ok: false, reason: "threw" })),
      ),
    );
    results.forEach((result, i) => {
      if (result && result.ok) {
        state.ackedChips.push(todo[i].fp);
      } else {
        state.chipAckFailures += 1;
        debugLog(
          `delivered_chip (session) failed for ${todo[i].fp}: ${result && result.reason}`,
        );
      }
    });
    saveSessionState(sessionId, state);
  } catch (err) {
    debugLog(`recordSessionDeliveries failed: ${err && err.stack}`);
  }
}

/**
 * ⛔ THE PROJECTION ALLOWLIST. What a tool call is allowed to say about itself.
 *
 * Each recognised tool declares WHICH of its input fields may be emitted and
 * how. A tool that is not in this table emits its NAME and nothing else — never
 * its input, not even scrubbed.
 *
 * ⛔ WHY IT IS AN ALLOWLIST NOW (2026-08-31). The previous switch had a default
 * branch that did `JSON.stringify(scrubValue(input))` for ANY tool it had no
 * case for. Measured on the live table, that default is how 916 sub-agent
 * prompts and 25,243 MCP tool inputs were captured — the entire argument object
 * of every tool nobody had thought about yet, including whatever a member typed
 * into a third-party MCP server. A denylist of tools-not-to-log would have had
 * the same shape and the same failure: it fails open on the next tool anybody
 * installs. This one fails closed on it.
 *
 * ⛔ ADDING A ROW HERE WIDENS WHAT IS RECORDED. That is a product decision about
 * what members agreed to, not a formatting change. It does not belong in a
 * refactor.
 *
 * Two ordering rules inside the projections are load-bearing (2026-08-31):
 *
 *   1. SCRUB BEFORE TRUNCATE. `scrubAndTruncate` redacts and then cuts. The old
 *      code was `truncate(input.command, 200)` with no redaction at all; adding
 *      redaction *after* the cut would be barely better, because a key starting
 *      at character 190 reaches storage as a stub the redactor no longer
 *      recognises. That exact row is in the live table:
 *      `export ANTHROPIC_API_KEY="sk-ant-api03-7C6…`.
 *   2. NEVER STRINGIFY A WHOLE INPUT. There is no projection below that emits an
 *      object. The nearest thing, TodoWrite, emits COUNTS and never the todo
 *      text.
 */
const TOOL_PROJECTIONS = {
  Bash: function (input) {
    return "Bash: " + scrubAndTruncate(input.command || input.cmd, 200);
  },
  Edit: function (input, name) {
    return name + ": " + scrubAndTruncate(input.file_path, 200);
  },
  Write: function (input, name) {
    return name + ": " + scrubAndTruncate(input.file_path, 200);
  },
  NotebookEdit: function (input, name) {
    return name + ": " + scrubAndTruncate(input.notebook_path || input.file_path, 200);
  },
  Read: function (input) {
    return "Read: " + scrubAndTruncate(input.file_path, 200);
  },
  WebFetch: function (input) {
    return "WebFetch: " + scrubAndTruncate(input.url, 200);
  },
  WebSearch: function (input) {
    return "WebSearch: " + scrubAndTruncate(input.query, 200);
  },
  TodoWrite: function (input) {
    const todos = Array.isArray(input.todos) ? input.todos : [];
    let done = 0;
    for (let i = 0; i < todos.length; i++) {
      if (todos[i] && todos[i].status === "completed") done += 1;
    }
    return `TodoWrite: updated todo list (${todos.length} items, ${done} completed)`;
  },
  // ⛔ SPEC-task-announcing-v2 §2.3 — the skill NAME and nothing else. Never
  // `args` or any other input: rule 7, store the label, never the prompt. A
  // loaded `<client>-project` skill is how a thread declares its client.
  Skill: function (input) {
    const name = skillNameFrom(input);
    return name ? "Skill: " + scrubAndTruncate(name, 120) : "Skill";
  },
};

// ───────────────────────────────────────────────────────────────────────────
// DECLARATIONS — SPEC-task-announcing-v2 §2.2 / §2.3.
//
// ⛔ A session declares exactly two things, in exactly two ways: its CLIENT, by
// loading a `<client>-project` skill (the Skill tool) — or, for Massmarket's own
// work, one of the two skills in MASSMARKET_OWN_WORK_SKILLS — and its TASK, by
// running `worklog-hook.js --task "<label>"` in its shell (Bash, or the
// PowerShell tool Claude Code offers on Windows). Nothing else sets a
// declaration — not a prompt, a path, a todo, a file name or a skill mentioned
// in passing. The hook stores the raw declaration; the server does all
// interpretation.
// ───────────────────────────────────────────────────────────────────────────

/** The shell tools whose commands can carry a `--task` declaration. */
const TASK_DECLARATION_TOOLS = ["Bash", "PowerShell"];

/** SPEC v2 §2.3: a declared task label is cut to 120 characters. */
const TASK_LABEL_MAX_CHARS = 120;

/**
 * The leading skill name of a Skill tool call: `input.skill` (Claude Code 2.1),
 * or `input.command` (the older Skill tool's name-only field). Only a leading
 * name-shaped token is ever taken — whatever follows the first space is never
 * read — so no argument can ride along into a row.
 */
function skillNameFrom(input) {
  const i = input && typeof input === "object" ? input : {};
  const raw =
    typeof i.skill === "string" ? i.skill : typeof i.command === "string" ? i.command : "";
  const m = /^\s*\/?([A-Za-z0-9][A-Za-z0-9:._-]{0,127})(?=\s|$)/.exec(raw);
  return m ? m[1] : "";
}

/**
 * Massmarket's own two work skills (SPEC-tracker-0.11.4 §1F, Opus, 2026-10-02):
 * internal systems, and our own marketing and sales. Loading either one is a
 * client declaration, exactly as loading a `<client>-project` skill is.
 *
 * They carry no `-project` suffix on purpose. A `*-project` skill is treated as
 * a CLIENT everywhere else (the reconcile workers read it as that client's
 * scope baseline, and the client-skill checks audit it), and Massmarket's own
 * projects must never be picked as a client project. So the hook knows these
 * two names instead. Exact names only: `massmarket-time-tracker` and
 * `massmarket-daily-run` are ordinary skills and declare nothing.
 */
const MASSMARKET_OWN_WORK_SKILLS = ["massmarket-internal-ops", "massmarket-self-funnel"];

/**
 * Is loading this skill a client declaration? SPEC v2 §2.3: the name's last
 * segment, after any `plugin:` prefix, ends in `-project`; or (0.11.4 §1F) that
 * segment is exactly one of MASSMARKET_OWN_WORK_SKILLS.
 */
function isClientProjectSkill(name) {
  const segments = String(name || "").split(":");
  const last = segments[segments.length - 1];
  return /-project$/.test(last) || MASSMARKET_OWN_WORK_SKILLS.indexOf(last) !== -1;
}

/**
 * A `--task` label, normalised the one way both the CLI and PostToolUse use:
 * whitespace collapsed to single spaces, trimmed, scrubbed, cut to 120.
 *
 * ⛔ Scrubbed BEFORE the cut — the hook's standing rule (see TOOL_PROJECTIONS):
 * a key cut in half is a stub the scrubber may no longer recognise. The cut then
 * never lands inside a `[REDACTED:…]` marker or between the halves of a
 * surrogate pair.
 */
function normalizeTaskLabel(raw) {
  let s = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = scrubText(s).text;
  if (s.length > TASK_LABEL_MAX_CHARS) {
    let cut = TASK_LABEL_MAX_CHARS;
    const openAt = s.lastIndexOf(REDACTION_PREFIX, cut);
    if (openAt !== -1) {
      const closeAt = s.indexOf("]", openAt);
      if (closeAt === -1 || closeAt >= cut) cut = openAt;
    }
    s = s.slice(0, cut);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s;
}

/**
 * A shell command that RUNS `worklog-hook.js --task` — the `~/.claude/mm-hooks/…`
 * and `$env:USERPROFILE\.claude\mm-hooks\…` spellings, the path quoted or not,
 * `--task <label>` or `--task=<label>`.
 */
const TASK_INVOCATION_RE = /worklog-hook\.js["']?\s+--task(?:[=\s]|$)/;

/** The CLI's own confirmation line (SPEC v2 §2.2): `Task noted: <label>`. */
const TASK_NOTED_PREFIX = "Task noted: ";

/** The standard output a shell tool call reported: `tool_response.stdout`. */
function shellStdout(toolResponse) {
  if (typeof toolResponse === "string") return toolResponse;
  if (
    toolResponse &&
    typeof toolResponse === "object" &&
    !Array.isArray(toolResponse) &&
    typeof toolResponse.stdout === "string"
  ) {
    return toolResponse.stdout;
  }
  return "";
}

/**
 * The label a shell tool call declared, or "" when it declared none.
 *
 * ⛔ THE LABEL IS WHAT THE CLI PRINTED, NOT WHAT THE COMMAND SAID (2026-09-30,
 * HOOK fix round 1, Opus decision L3). Reading it out of the command text
 * matched text, not an execution: a commit message that merely mentioned
 * `worklog-hook.js --task usage` declared "usage", and a label with escaped
 * quotes was recorded cut short while the CLI printed it whole. So a call
 * declares only when BOTH hold:
 *   1. its command runs `worklog-hook.js` with `--task`, and
 *   2. its output — Claude Code's `tool_response.stdout` for the Bash and
 *      PowerShell tools, verified in the 2.1.280 binary — carries the CLI's own
 *      line `Task noted: <label>`.
 * The label is what follows `Task noted: ` on that line (the last such line
 * when one command declared twice). It goes through normalizeTaskLabel once
 * more, which leaves anything the CLI printed unchanged: the CLI already
 * trimmed, collapsed, scrubbed and cut it that same way.
 */
function taskLabelFromShellCall(command, toolResponse) {
  if (typeof command !== "string" || !TASK_INVOCATION_RE.test(command)) return "";
  const stdout = shellStdout(toolResponse);
  if (stdout.indexOf(TASK_NOTED_PREFIX) === -1) return "";
  let label = null;
  stdout.split(/\r?\n/).forEach((line) => {
    if (line.indexOf(TASK_NOTED_PREFIX) === 0) label = line.slice(TASK_NOTED_PREFIX.length);
  });
  return label === null ? "" : normalizeTaskLabel(label);
}

/**
 * Record a declaration made by THIS tool call in the session state (the caller
 * saves it) and say which kind: "client", "task", or null. Last writer wins.
 */
function captureDeclaration(toolName, toolInput, toolResponse, state) {
  try {
    const input =
      toolInput && typeof toolInput === "object" && !Array.isArray(toolInput) ? toolInput : {};
    const now = new Date().toISOString();
    if (toolName === "Skill") {
      const name = skillNameFrom(input);
      if (!name || !isClientProjectSkill(name)) return null;
      state.declared_skill = scrubText(name).text;
      state.declared_skill_at = now;
      return "client";
    }
    if (TASK_DECLARATION_TOOLS.indexOf(toolName) !== -1) {
      const label = taskLabelFromShellCall(input.command || input.cmd, toolResponse);
      if (!label) return null;
      state.declared_task = label;
      state.declared_task_at = now;
      return "task";
    }
    return null;
  } catch (err) {
    debugLog(`captureDeclaration failed: ${err && err.message}`);
    return null;
  }
}

/**
 * One compact line describing a tool call, for the generic activity stream.
 *
 * The default is the tool NAME alone. `hasOwnProperty` rather than a bare
 * property read, so a tool literally named `constructor` or `toString` cannot
 * reach a function off Object.prototype; a throwing projection degrades to the
 * name too, because this runs on a hook that must never break a session.
 */
function describeToolCall(toolName, toolInput) {
  const input =
    toolInput && typeof toolInput === "object" && !Array.isArray(toolInput) ? toolInput : {};
  const rawName = typeof toolName === "string" && toolName ? toolName : "tool";
  const label = scrubAndTruncate(rawName, 120);
  if (!Object.prototype.hasOwnProperty.call(TOOL_PROJECTIONS, rawName)) return label;
  try {
    const line = TOOL_PROJECTIONS[rawName](input, label);
    return typeof line === "string" && line ? line : label;
  } catch (err) {
    return label;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// SESSION TITLE — the thread's name (SPEC-tracker-0.11.4 §1C).
//
// The extension lists a member's Claude Code sessions, and a session is only
// recognisable by its thread name. Claude Code passes `transcript_path` in
// every hook payload, and the name is in that file: the LAST line whose JSON is
// `{"type":"custom-title","customTitle":…}`, or, when the transcript has none,
// the last `{"type":"agent-name","agentName":…}`. With neither there is no
// title and none is sent. Every worklog POST carries it as `session_title`.
//
// ⛔ BOUNDED AND FAIL-OPEN, like every other read in this hook:
//   - at most the last 262,144 bytes of the transcript are read;
//   - at most once every 10 minutes per session: the title and the time of the
//     read are cached in the session's state file (loadSessionState keeps both
//     keys, so they survive a save);
//   - a missing path, a path outside `<home>/.claude/`, a file that cannot be
//     read, or any other error yields no title, and never delays or fails the
//     hook;
//   - control characters are stripped, whitespace is collapsed, and the title
//     is cut to 120 characters. It is scrubbed first, like every other text
//     this hook sends. A cleaned title longer than 2,048 characters is no
//     title at all, and neither is one in which the scrubber finds private-key
//     material (see cleanSessionTitle);
//   - a title that was read once is kept when a later read cannot find it (see
//     sessionTitleFor).
//
// ⛔ DISPLAY TEXT ONLY. The server stores it in a column of its own and derives
// no client and no task from it.
//
// ⛔ THE TITLE IS NEVER LOGGED. Nothing below writes it to the debug log or to
// stderr, and no failure here writes a line at all.
// ───────────────────────────────────────────────────────────────────────────

/** At most this many bytes, from the END of the transcript, are ever read. */
const SESSION_TITLE_READ_BYTES = 262144;

/** The transcript is read for the title at most once in this long, per session. */
const SESSION_TITLE_REFRESH_MS = 10 * 60 * 1000;

/** A title is cut to this many characters. */
const SESSION_TITLE_MAX_CHARS = 120;

/**
 * A cleaned title longer than this many characters (code points) is no title:
 * it is refused before the scrubber sees it. See cleanSessionTitle.
 */
const SESSION_TITLE_INPUT_MAX_CHARS = 2048;

/**
 * The scrubber's OWN label for a PEM private key — a whole block, or a header
 * with no END line (see VENDOR_PATTERNS). A title whose scrub reports this kind
 * of redaction is no title. See cleanSessionTitle.
 */
const SESSION_TITLE_REFUSED_REDACTION = "private-key";

/**
 * This run's session title for the worklog body, or null. The event handlers
 * set it (sessionTitleFor) before they post; postWorklog is its only reader.
 */
let SESSION_TITLE = null;

/**
 * A title as it is sent: control characters stripped, whitespace collapsed,
 * scrubbed, cut to 120 characters. "" when nothing usable is left.
 *
 * Tabs and line breaks count as whitespace, so they become one space instead of
 * gluing two words together. Every other control character (C0, DEL, C1) is
 * removed, and so is half of a broken surrogate pair, which is not a character.
 *
 * ⛔ A CLEANED TITLE LONGER THAN 2,048 CHARACTERS IS NO TITLE (2026-10-02,
 * SPEC-hook-chip-note §9.3). The scrubber's url-credentials pattern is quadratic
 * on a long unbroken run — 80,000 characters took 3.7 s, 250,000 took 35.7 s —
 * so the length has to be bounded before scrubText runs. It is bounded by
 * REFUSING the title, never by cutting it and scrubbing the piece: a pasted
 * 4096-bit PEM key is 3,376 characters, and cut at 2,048 it loses its END line,
 * so only its header is redacted and 97 characters of key body would be sent.
 * A title of up to 2,048 characters is scrubbed WHOLE, exactly as before. The
 * count is in characters (code points), after the cleaning above.
 *
 * ⛔ A TITLE HOLDING PRIVATE-KEY MATERIAL IS NO TITLE (2026-10-02,
 * SPEC-hook-chip-note §10). A key that arrives WITHOUT its END line, in a title
 * of 2,048 characters or fewer, passes the bound above; the scrubber then
 * redacts only the BEGIN header, and the cut to 120 would keep up to 97
 * characters of key body. That is how the scrubber treats every field, but a
 * thread title is free text a person can paste into. So when the scrub's
 * redactions include the scrubber's own private-key kind — a whole block or a
 * bare header alike — nothing of the title is sent, not even the marker. Every
 * other kind of redaction is unchanged: the marker replaces the whole token and
 * the rest of the title is kept.
 *
 * ⛔ Scrubbed BEFORE the cut — the hook's standing rule (see normalizeTaskLabel):
 * a thread title is free text, and a key cut in half is a stub the scrubber may
 * no longer recognise. The member's home directory becomes "~" before the cut
 * too (scrub first, normalize second — see homedirReplacer), so the cut can
 * never leave half of a home path that the replacer would then not recognise at
 * send time. The cut counts characters (code points), so it never splits a
 * surrogate pair, and it never lands inside a `[REDACTED:…]` marker.
 */
function cleanSessionTitle(raw) {
  if (typeof raw !== "string" || !raw) return "";
  let s = Array.from(raw)
    .filter((ch) => !(ch.length === 1 && ch >= "\ud800" && ch <= "\udfff"))
    .join("")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  // Fail closed, BEFORE the scrubber: too long is no title. (A string no longer
  // than the limit in UTF-16 units cannot be over it in characters.)
  if (
    s.length > SESSION_TITLE_INPUT_MAX_CHARS &&
    Array.from(s).length > SESSION_TITLE_INPUT_MAX_CHARS
  ) {
    return "";
  }
  const scrubbed = scrubText(s);
  // Fail closed again, AFTER the scrubber: private-key material is no title.
  if (scrubbed.redactions.indexOf(SESSION_TITLE_REFUSED_REDACTION) !== -1) return "";
  s = normalizeHomedir(scrubbed.text);
  const chars = Array.from(s);
  if (chars.length > SESSION_TITLE_MAX_CHARS) {
    let cut = chars.slice(0, SESSION_TITLE_MAX_CHARS).join("").length;
    const openAt = s.lastIndexOf(REDACTION_PREFIX, cut);
    if (openAt !== -1) {
      const closeAt = s.indexOf("]", openAt);
      if (closeAt === -1 || closeAt >= cut) cut = openAt;
    }
    s = s.slice(0, cut).trim();
  }
  return s;
}

/** True when `file` is inside `root`: below it, by path segment, and not the folder itself. */
function pathInside(root, file) {
  const rel = path.relative(root, file);
  return Boolean(rel) && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
}

/**
 * The folders a transcript may be read from: `<home>/.claude`, and the folder
 * CLAUDE_CONFIG_DIR names when that is an absolute path (Claude Code keeps a
 * profile's transcripts under it). A relative or empty value names nothing.
 */
function transcriptRoots() {
  const roots = [];
  const claude = homeClaudeDir();
  if (claude) roots.push(claude);
  const configured =
    typeof process.env.CLAUDE_CONFIG_DIR === "string" ? process.env.CLAUDE_CONFIG_DIR.trim() : "";
  if (configured && path.isAbsolute(configured)) roots.push(path.resolve(configured));
  return roots;
}

/**
 * `transcriptPath` as a file this hook may read, or null. The one path rule of
 * both transcript reads (the title and the turn's origin).
 *
 * Read: a non-empty absolute path to a regular file that is inside one of the
 * transcriptRoots() — as the path is WRITTEN (after any `..` is resolved), or,
 * failing that, by REAL path: the file's real path inside the real path of one
 * of them. Refused: everything else, and that is the point of the rule — the
 * hook reads a transcript, never whatever file a payload names.
 *
 * ⛔ LINKS. The LAST path component is never followed: when the transcript's
 * own name is a link, it is not read (lstat, not stat). A linked PARENT
 * directory IS followed, both ways round:
 *   - the path as written is under a root and a folder on the way is a link
 *     to somewhere else (a member whose `projects` folder lives on another
 *     disk): read, as it always was;
 *   - the path as written is under NEITHER root, and its real path is under one
 *     (0.11.5: a second profile folder whose `projects` is a link into
 *     `<home>/.claude/projects`, with CLAUDE_CONFIG_DIR not in the hook's
 *     environment): read. Until 0.11.5 such a profile got no title and no
 *     origin on any row.
 *
 * May throw (a missing file): both callers catch, and answer null.
 */
function transcriptFileAllowed(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return null;
  if (!path.isAbsolute(transcriptPath)) return null;
  const roots = transcriptRoots();
  if (roots.length === 0) return null;
  const file = path.resolve(transcriptPath);
  let allowed = roots.some((root) => pathInside(root, file));
  if (!allowed) {
    const real = fs.realpathSync(file);
    allowed = roots.some((root) => {
      try {
        return pathInside(fs.realpathSync(root), real);
      } catch {
        return false; // a root that does not exist holds nothing
      }
    });
  }
  if (!allowed) return null;
  if (!fs.lstatSync(file).isFile()) return null;
  return file;
}

/**
 * The thread's title from its transcript, or null. Reads at most the last
 * SESSION_TITLE_READ_BYTES of the file, and nothing else. Never throws.
 *
 * null — no title — for: a path transcriptFileAllowed() refuses (not a
 * non-empty absolute string; outside `<home>/.claude/` and the folder
 * CLAUDE_CONFIG_DIR names; not a regular file — opening a pipe would wait; its
 * own name a link); a file that cannot be read; and a tail that holds no usable
 * title line.
 *
 * A line counts only when it parses as JSON and its title field is a string
 * with something left after cleanSessionTitle. The lines are read from the end,
 * so the first custom title found is the LAST one in the file; the last agent
 * name is kept beside it and used only when the tail holds no custom title.
 */
function readTranscriptTitle(transcriptPath) {
  let fd = null;
  try {
    const file = transcriptFileAllowed(transcriptPath);
    if (!file) return null;

    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, SESSION_TITLE_READ_BYTES);
    if (length <= 0) return null;
    const start = size - length;
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, start + got);
      if (n <= 0) break;
      got += n;
    }
    let text = buf.toString("utf8", 0, got);
    // A window that begins inside the file begins inside a line. That first
    // piece is not a line, so it is dropped.
    if (start > 0) {
      const lineBreak = text.indexOf("\n");
      text = lineBreak === -1 ? "" : text.slice(lineBreak + 1);
    }

    const lines = text.split("\n");
    let agentName = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const maybeCustom = line.indexOf('"custom-title"') !== -1;
      const maybeAgent = !agentName && line.indexOf('"agent-name"') !== -1;
      if (!maybeCustom && !maybeAgent) continue;
      let row = null;
      try {
        row = JSON.parse(line);
      } catch {
        continue; // a half-written last line, or not JSON at all
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      if (row.type === "custom-title") {
        const title = cleanSessionTitle(row.customTitle);
        if (title) return title;
      } else if (row.type === "agent-name" && !agentName) {
        agentName = cleanSessionTitle(row.agentName);
      }
    }
    return agentName || null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing to close */
      }
    }
  }
}

/**
 * The title for this run's worklog POSTs, or null — and the 10-minute cache.
 *
 * A payload that names no transcript has no title: nothing is read and the
 * state is left exactly as it was. Otherwise the cached title is used while
 * the last read is less than SESSION_TITLE_REFRESH_MS old; past that the
 * transcript is read again and the time of the read is written to `state`.
 * The caller saves the state. (Parallel tool calls that find the cache expired
 * at the same moment each read once; their saves agree.)
 *
 * ⛔ A TITLE ALREADY READ SURVIVES A LATER READ THAT MISSES IT (2026-10-02,
 * SPEC-hook-chip-note §9.2). A thread is named early and its transcript keeps
 * growing, so the title line can sit further back than the 262,144 bytes that
 * are read (measured on Rob's Mac over 7 days: 3.8% of events, and 31 of 123
 * titled sessions at least once). What a read does to the cache:
 *
 *   it found a title               that title, and the time of the read
 *   it found none, one is cached   the cached title is KEPT and returned; only
 *                                  the time of the read moves
 *   it found none, none is cached  null, and the time of the read
 *
 * "Found none" is every way readTranscriptTitle answers null: no title line in
 * the tail, a title that is not usable (over 2,048 characters, holding
 * private-key material, or with nothing left after cleaning), or a file that
 * could not be read.
 *
 * Never throws: any failure is no title.
 */
function sessionTitleFor(payload, state) {
  try {
    const transcriptPath = payload && payload.transcript_path;
    if (typeof transcriptPath !== "string" || !transcriptPath) return null;
    const now = Date.now();
    const readAt = declarationMs(state.session_title_read_at);
    if (Number.isFinite(readAt) && readAt <= now && now - readAt < SESSION_TITLE_REFRESH_MS) {
      return stateString(state.session_title);
    }
    const found = readTranscriptTitle(transcriptPath);
    const title = found || stateString(state.session_title);
    state.session_title = title;
    state.session_title_read_at = new Date(now).toISOString();
    return title;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// TURN ORIGIN — who started the turn a row belongs to (0.11.5).
//
// Rob, 2026-10-12: "It's also important that the time tracking doesn't start
// whenever you update or open or create a session for a client. It needs to be
// when the team member picks it up and starts working in the thread."
//
// A thread can be started or continued with nobody in it: another Claude
// session sends it a message (the bridge's kickoff arrives that way), a chip
// starts it with a kickoff, a scheduled trigger fires. Each starts a turn that
// makes tool calls, and each tool call is a worklog row under the member. So
// every row says who started the work it belongs to — `turn_origin`, "person"
// or "auto" — and the server keeps the two apart.
//
// ⛔ THE RULE IS ABOUT WHO STARTED THE WORK (Opus, 2026-10-12). A turn the
// SYSTEM started is not the person's active time. A background task the
// person's own turn dispatched, reporting back into that thread, is still the
// person's work: on Rob's Mac that day half of all rows were written in such
// turns. So a turn has one of three roles:
//
//   it STARTS a chain    a prompt somebody or something sent: the person, or
//                        the system
//   it CONTINUES one     a background task reporting back, or the app resuming
//                        the turn by itself: it takes the origin of the chain
//                        it belongs to, which is the nearest earlier turn of
//                        the session that started one
//   cannot tell          no origin declared
//
// ⛔ WHERE IT COMES FROM. Claude Code 2.1.280 and later stamp the user entry
// that opens a turn, in the session's transcript, with `turnOrigin`: its own
// answer to "who started this turn". Read from 2.1.293's code and from the
// transcripts on Rob's Mac (2026-10-12):
//
//   human               typed by the person, here or on their phone   starts: person
//   peer                another Claude session, a channel, a
//                       coordinator, an observer                      starts: auto
//   scheduled           a scheduled trigger or a wake-up              starts: auto
//   host_synthetic      the app wrote the prompt                      starts: auto
//   system              a plugin's prompt, or a system one            starts: auto
//   task_notification   a background task reporting back              continues
//   auto_continuation   the app resumed the turn by itself            continues
//   sdk, unknown        Claude Code itself does not know who          starts: (nothing)
//
// `sdk` is a prompt that arrived with no origin declared: a headless `-p` run,
// and also a person typing into a host that does not say so. `unknown` is what
// Claude Code writes when it has no origin and no source it recognises. Neither
// is "auto": calling a person's turn automatic would lose real time, so both are
// "cannot tell" — and so is a background task that reports back into a chain
// one of them started.
//
// So: the person types, their turn dispatches three background agents, and each
// one reporting back is "person". The bridge kicks a thread off, its turn
// dispatches agents, and each one reporting back is "auto". Another session's
// message, then a task reporting back, then the person typing: "auto", "auto",
// "person". A task reporting back takes the NEAREST earlier start, so once the
// person types again the chain is theirs, and once the system sends a prompt it
// is the system's.
//
// ⛔ AN AGENT KEEPS THE ORIGIN IT STARTED WITH, and so does every background
// task (review R2). The prompt id in a hook payload is the session's, so an
// agent still working when a newer prompt arrives would take that prompt's
// origin for the rest of its rows, and so would its report. Each agent's
// origin is therefore fixed once — by the row that started it, by its own
// start where the hook is told of it, or by its own first row — and kept by the
// agent's id (`agent_id` in the hook's input), in a small file of its own (TASK
// ORIGINS); a task notification that OPENS a prompt is read as the origin of
// the task it reports. One written inside a running turn changes nothing: the
// turn is whoever opened it. See rowOriginFor and turnOriginFor.
//
// ⛔ THE BRIDGE'S MARKER. A prompt that begins `[mm-link <project id>]` is a
// kickoff the mm-bridge plugin wrote (a chip's first prompt, or its Update), and
// the app can stamp a chip's first prompt as the person's. So a stamped entry
// whose text begins with that marker is "auto" whatever its stamp says. The
// pattern is the plugin's own (hooks/register.tsx MARKER): the very start of the
// text, a lower-case uuid. Since 0.11.7 the start of the text includes the start
// of the task inside the wrapper the desktop app puts around the first message
// of a session `start_session` opened (TURN_ORIGIN_SIDE_FRESH_PREFIX). Since
// 0.11.10 it is read after any `<system-reminder>` notes the app puts in front
// of that message (TURN_ORIGIN_NOTE_OPEN).
//
// ⛔ THE SCHEDULED-TASK WRAPPER (review R4). `human` does not always mean typed:
// the app starts a scheduled task's session with the task's prompt wrapped in
// `<scheduled-task name="…" file="…">`, and stamps it `human` more often than
// `scheduled` (7 of 10 on Rob's Mac over 14 days; every one the first entry of
// its session, the opening tag at the very start and the closing tag at the
// very end). So a stamped entry whose text is, whole, that wrapper is "auto"
// whatever its stamp says. A prompt that only BEGINS by quoting the tag is not
// (isScheduledTaskPrompt).
//
// ⛔ PER TURN. Every hook payload carries `prompt_id`, and Claude Code writes the
// same id (`promptId`) on every user entry of that prompt, so "this row's turn"
// is exact: the newest stamped entry in the tail whose `promptId` is the
// payload's. A stamped entry of another prompt is not this row's turn (it may be
// the start of its chain). The first row after the person types is "person"
// again: their message is the newest stamped entry of its prompt. (A payload
// with no `prompt_id` takes the newest stamped entry in the tail, whatever its
// prompt.)
//
// ⛔ BOUNDED AND FAIL-OPEN, like the session title:
//   - at most the last 2,097,152 bytes of the transcript are read, once per run
//     (measured on Rob's Mac over 7 days: a turn's opening entry was inside that
//     many bytes at its first tool call in 1,514 of 1,514 turns; inside 262,144
//     in 87%);
//   - a long turn outgrows any tail (over 3 days there, the opening entry was
//     further back than that for 520 of 6,457 tool calls), so the answer is kept
//     in the session's state file with the id of its prompt, and used for as
//     long as the payload names that same prompt;
//   - a chain outlives its first turn by hours, so the origin of the chain is
//     kept in the state file too, set each time a turn that starts one is read.
//     A background task reporting back takes the start the tail shows; when the
//     tail shows none, the one that was kept; with neither, "cannot tell";
//   - a new prompt whose opening entry the tail does not hold is a turn
//     nothing is known of: what was kept for the turn AND for the chain is
//     cleared, so an older chain's answer is not handed to this turn's tasks
//     (review R3);
//   - the state holds those words ("person", "auto", or "none" for a start that
//     was read and says nothing) and the prompt's id; beside it, one small file
//     per agent or background task holds one word under Claude Code's own id
//     for it (the 400 used last). Nothing else: no prompt text is kept and none
//     is sent;
//   - a missing path, a path outside both `<home>/.claude/` and the folder
//     CLAUDE_CONFIG_DIR names (review R6: by the path as written, or by real
//     path), a file that cannot be read, a tail with no stamped entry for this
//     prompt and nothing kept for it, an older Claude Code that writes no
//     stamp, or any other error is "cannot tell": nothing is sent, and the hook
//     is never delayed or failed.
//
// ⛔ NEVER LOGGED. Nothing below writes a line of the transcript, or the answer,
// to the debug log or to stderr.
// ───────────────────────────────────────────────────────────────────────────

/** At most this many bytes, from the END of the transcript, are read for the turn's origin. */
const TURN_ORIGIN_READ_BYTES = 2097152;

/** The `turnOrigin` stamp that means the person typed the prompt: it starts a person's chain. */
const TURN_ORIGIN_PERSON_KINDS = ["human"];

/**
 * The `turnOrigin` stamps of a turn the SYSTEM started: each starts an automatic
 * chain. `sdk`, `unknown` and any value in none of these three lists start a
 * chain too, of which nothing can be said: "cannot tell".
 */
const TURN_ORIGIN_AUTO_KINDS = ["peer", "scheduled", "host_synthetic", "system"];

/**
 * The `turnOrigin` stamps of a turn that starts nothing: a background task
 * reporting back, and the app resuming the turn by itself. Each takes the
 * origin of the chain it belongs to — the nearest earlier turn of the session
 * that started one.
 */
const TURN_ORIGIN_CONTINUES_KINDS = ["task_notification", "auto_continuation"];

/** The key as Claude Code writes it on a transcript line. Only a line holding it is parsed. */
const TURN_ORIGIN_STAMP_KEY = '"turnOrigin"';

/** The mm-bridge kickoff marker, at the very start of a prompt (the plugin's own pattern). */
const TURN_ORIGIN_MARKER_RE =
  /^\[mm-link [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]/;

/**
 * ⛔ A SESSION THAT `start_session` OPENED (0.11.7, 2026-10-14). The desktop app
 * does not hand such a session its prompt as written: it wraps it. Read out of
 * the app bundle, and seen on Rob's Mac the same day (first entry stamped
 * `sdk`):
 *
 *   context "fresh"  "Background (from the session that started this one):\n"
 *                    + <background> + "\n\nTask:\n" + <prompt>
 *   context "fork"   "Task (from the session that started this one):\n" + <prompt>
 *
 * (A fresh start with an empty background, and a `spawn_task` chip, pass the
 * prompt through bare.) So a card whose prompt begins with the bridge's marker
 * opens a session whose first entry does NOT begin with it, and the marker rule
 * above would miss every one of them. turnEntryStartsWithMarker() reads the
 * marker at the start of the TASK part: right after the fork wrapper, or right
 * after a "\n\nTask:\n" that follows the fresh wrapper. Only those two exact
 * openings are read through; anything else is tested as it always was.
 */
const TURN_ORIGIN_SIDE_FRESH_PREFIX = "Background (from the session that started this one):\n";
const TURN_ORIGIN_SIDE_FORK_PREFIX = "Task (from the session that started this one):\n";
const TURN_ORIGIN_SIDE_TASK_SEPARATOR = "\n\nTask:\n";

/**
 * ⛔ THE APP'S NOTES IN FRONT OF THE PROMPT (0.11.10, 2026-10-23). The desktop
 * app now puts one or more `<system-reminder>…</system-reminder>` notes IN FRONT
 * of a session's first message, each followed by white space. Seen on Rob's
 * transcripts that morning: a kickoff's text opens
 * `<system-reminder>\nLinked sessions now…</system-reminder>\n\nBackground (from
 * the session that started this one):\n…`, and in a worktree there are two
 * notes, the second about the worktree, then "\n\n", then the wrapper. So the
 * marker is no longer at the start, and those kickoffs read as "cannot tell",
 * which counts as the person's work: 47 threads on one member's machine on
 * 2026-10-22, and 9 of Rob's 13 on 2026-10-23 (the 4 marked "auto" had no note
 * in front).
 *
 * The rule: only whole notes at the very start of the text are passed over, at
 * most TURN_ORIGIN_LEADING_NOTES_MAX of them, with the white space after each.
 * A note that never closes leaves the text as it was. A text that does not
 * begin with a note is tested exactly as before. See turnEntryAfterLeadingNotes().
 */
const TURN_ORIGIN_NOTE_OPEN = "<system-reminder>";
const TURN_ORIGIN_NOTE_CLOSE = "</system-reminder>";
const TURN_ORIGIN_LEADING_NOTES_MAX = 8;

/**
 * The wrapper the app puts around a scheduled task's prompt:
 * `<scheduled-task name="…" file="…">…</scheduled-task>`. This is how it OPENS,
 * at the very start of the text: the tag's name and what follows it (a space or
 * `>`), so `<scheduled-tasks>` is not it.
 */
const TURN_ORIGIN_SCHEDULED_TASK_RE = /^<scheduled-task[\s>]/;

/** …and how the wrapper CLOSES: the last thing in the text, but for white space. */
const TURN_ORIGIN_SCHEDULED_TASK_END = "</scheduled-task>";

/**
 * The id of an agent or of a background task, as Claude Code writes one: a
 * short token of letters, digits, dot, dash and underscore that begins with a
 * letter or a digit. Anything else is not an id and names no task.
 */
const TURN_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/**
 * How a task notification opens, as Claude Code writes it: the tag, then the
 * id of the task it reports — which for an agent is the agent's id (the
 * build's own words: "The <task-id> value is the agent ID").
 */
const TURN_TASK_NOTIFICATION_RE =
  /^\s*<task-notification>\s*<task-id>([A-Za-z0-9][A-Za-z0-9._-]{0,79})<\/task-id>/;

/** At most this many tasks' origins are kept for a session: the ones USED last. */
const TURN_TASK_ORIGINS_MAX = 400;

/** A task's own file inside the session's task folder: `t-<task id>.json`. */
const TURN_TASK_FILE_RE = /^t-([A-Za-z0-9][A-Za-z0-9._-]{0,79})\.json$/;

/** A file this hook was still writing when it stopped: `.tmp-<pid>-<random>`. */
const TURN_TASK_TEMP_RE = /^\.tmp-\d+-[0-9a-f]{8}$/;

/**
 * This run's turn origin for the worklog body: "person", "auto", or null when
 * the hook cannot tell. The event handlers set it (turnOriginFor) before they
 * post; postWorklog is its only reader.
 */
let TURN_ORIGIN = null;

/** "person" or "auto" as given, or null for anything else. What is SENT. */
function turnOriginValue(value) {
  return value === "person" || value === "auto" ? value : null;
}

/**
 * An origin as it is KEPT in the session state: "person", "auto", "none", or
 * null for anything else.
 *
 *   "none"  it was read, and it says nothing either way (a prompt with no
 *           origin declared started this). Sent as nothing, like null.
 *   null    it could not be read at all.
 *
 * The two are kept apart because an agent's origin is fixed by its first row:
 * "none" fixes it (its rows then send nothing, whatever prompt comes later),
 * and null fixes nothing (its next row is asked again).
 */
function turnOriginKept(value) {
  return value === "person" || value === "auto" || value === "none" ? value : null;
}

/** A value as the id of an agent or a background task, or null. */
function taskIdOf(value) {
  return typeof value === "string" && TURN_TASK_ID_RE.test(value) ? value : null;
}

// ───────────────────────────────────────────────────────────────────────────
// TASK ORIGINS — who started each agent and background task of a session
// (0.11.6: one small file per task).
//
// ⛔ WHY NOT A LIST IN THE SESSION'S STATE FILE (delta review F2). 0.11.5 kept
// `{ <task id>: [origin, fixed at] }` in the state object and joined it with the
// file's copy right before every save. That narrowed the race and did not close
// it: read, join and write are three steps, and a turn that sends 16 agents out
// has 16 hook processes saving in the same few milliseconds. The reviewer saw
// between 3 and 16 of 16 agents kept. A lost agent is fixed AGAIN, by its next
// row, from whatever prompt is current by then — the very thing a kept origin
// exists to prevent.
//
// So each task has a file of its own, `t-<task id>.json`, in a folder beside
// the session's state file (`<session>.tasks/`). A process that fixes agent A
// writes A's file and nobody else's: there is nothing shared to read back and
// write over. One file is written whole to a temporary name and renamed into
// place, so a reader sees the old answer or the new one, never half of either.
//
// ⛔ TWO TIMES, NOT ONE (delta review F3). The file holds the origin and when it
// was FIXED. When it was last USED is the file's own modification time, set
// again each time a row or a report reads the origin. The cap is cut by last
// use: 0.11.5 cut by when a task was fixed, so a long-lived agent — fixed
// first, still working — was the first one dropped, and its next row was fixed
// again from the prompt current by then.
//
// The ids are Claude Code's own random ones, already checked against
// TURN_TASK_ID_RE: a short token with no path separator. The `t-` in front keeps
// every name clear of the ones Windows reserves.
//
// ⛔ BEST-EFFORT AND SILENT, like the rest of the state: nothing here throws,
// and a failure is "nothing kept for this task" — its next row is asked again.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The session's kept task origins as 0.11.5 held them in the state file,
 * cleaned: `{ <task id>: [<origin>, <fixed at, epoch ms>] }` with nothing in it
 * but well-formed entries. An object with no prototype, so no task id can be
 * mistaken for something every object has. Read only by migrateTaskOrigins.
 */
function taskOriginsKept(value) {
  const out = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  Object.keys(value).forEach((id) => {
    if (!TURN_TASK_ID_RE.test(id)) return;
    const entry = value[id];
    if (!Array.isArray(entry)) return;
    const origin = turnOriginKept(entry[0]);
    const at = Number(entry[1]);
    if (!origin || !Number.isFinite(at)) return;
    out[id] = [origin, at];
  });
  return out;
}

/**
 * The folder that holds this session's task files, or null: the session's state
 * file with `.tasks` where its `.json` is. (A payload that names no session
 * shares its folder's `unknown.tasks`, as it shares `unknown.json`.)
 */
function taskOriginsDirFor(sessionId) {
  const file = stateFilePath(sessionId);
  return file ? file.replace(/\.json$/, ".tasks") : null;
}

/** A task's file in `dir`, or null when either is missing or the id is not an id. */
function taskOriginFile(dir, id) {
  return dir && taskIdOf(id) ? path.join(dir, `t-${id}.json`) : null;
}

/** What a task's file holds — `[origin, fixed at]` — or null when there is none that reads. */
function taskOriginRead(dir, id) {
  const file = taskOriginFile(dir, id);
  if (!file) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(entry)) return null;
    const origin = turnOriginKept(entry[0]);
    const at = Number(entry[1]);
    return origin && Number.isFinite(at) ? [origin, at] : null;
  } catch {
    return null;
  }
}

/**
 * Write a task's file whole: to a temporary name in the same folder, then
 * renamed into place. Where the rename is refused (Windows, while another
 * process holds the old file open) the file is written directly: a file this
 * small goes out in one write. Never throws; false when nothing was written,
 * which includes an origin that is not one of the three words and a time that
 * is not a number.
 */
function taskOriginWrite(dir, id, origin, fixedAtMs) {
  const file = taskOriginFile(dir, id);
  const word = turnOriginKept(origin);
  const at = Number(fixedAtMs);
  if (!file || !word || !Number.isFinite(at)) return false;
  // One of three fixed words and one number, written out by hand: nothing a
  // tool call carried is ever serialised between describeToolCall and the
  // event handlers, and two guard tests read this stretch of the file for that.
  const body = `["${word}",${at}]`;
  let temp = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    temp = path.join(dir, `.tmp-${process.pid}-${require("crypto").randomBytes(4).toString("hex")}`);
    fs.writeFileSync(temp, body, "utf8");
    fs.renameSync(temp, file);
    return true;
  } catch {
    try {
      fs.writeFileSync(file, body, "utf8");
      return true;
    } catch {
      return false;
    } finally {
      if (temp) {
        try {
          fs.unlinkSync(temp);
        } catch {
          /* it was renamed, or never written */
        }
      }
    }
  }
}

/**
 * The cap, cut by LAST USE: when the folder holds more than
 * TURN_TASK_ORIGINS_MAX task files, the ones read longest ago go. Run only when
 * a task is fixed, never per row. Two processes cutting at once take the same
 * files; whichever comes second finds them gone.
 */
function trimTaskOrigins(dir) {
  try {
    const names = fs.readdirSync(dir).filter((name) => TURN_TASK_FILE_RE.test(name));
    if (names.length <= TURN_TASK_ORIGINS_MAX) return;
    const used = [];
    names.forEach((name) => {
      try {
        used.push([name, fs.statSync(path.join(dir, name)).mtimeMs]);
      } catch {
        /* gone already */
      }
    });
    used.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (let i = TURN_TASK_ORIGINS_MAX; i < used.length; i++) {
      try {
        fs.unlinkSync(path.join(dir, used[i][0]));
      } catch {
        /* another process took it */
      }
    }
  } catch {
    /* no folder, nothing to cut */
  }
}

/**
 * The kept origin of a task ("person", "auto" or "none"), or null when none is
 * kept for it. Reading it is USING it: the file's time is set to now, which is
 * what keeps a task that is still at work clear of the cap.
 */
function taskOriginGet(dir, id) {
  const entry = taskOriginRead(dir, id);
  if (!entry) return null;
  try {
    const now = new Date();
    fs.utimesSync(taskOriginFile(dir, id), now, now);
  } catch {
    /* still kept; only its place in the queue for the cap is older */
  }
  return entry[0];
}

/** Fix a task's origin, as of now. A value that is not a kept origin fixes nothing. */
function taskOriginSet(dir, id, origin) {
  const kept = turnOriginKept(origin);
  if (!dir || !taskIdOf(id) || !kept) return;
  if (taskOriginWrite(dir, id, kept, Date.now())) trimTaskOrigins(dir);
}

/**
 * Move the tasks a 0.11.5 state file held into their own files, once. A task
 * that already has a file keeps it (it was fixed since). Each moved task keeps
 * the time it was fixed; its "last used" starts now. Never throws.
 */
function migrateTaskOrigins(sessionId, legacy) {
  try {
    const map = taskOriginsKept(legacy);
    const ids = Object.keys(map);
    if (ids.length === 0) return;
    const dir = taskOriginsDirFor(sessionId);
    if (!dir) return;
    let moved = false;
    ids.forEach((id) => {
      if (taskOriginRead(dir, id)) return;
      if (taskOriginWrite(dir, id, map[id][0], map[id][1])) moved = true;
    });
    if (moved) trimTaskOrigins(dir);
  } catch {
    /* the tasks are fixed again by their next rows */
  }
}

/**
 * Remove a session's task folder, `<dir>/<name>`, when the session's state file
 * is gone (pruneStateFiles removed it after 48 hours unused, and calls this for
 * a folder that old). Only this hook's own files are deleted, and the folder
 * itself only when that leaves it empty. Never throws.
 */
function pruneTaskOriginsDir(dir, name) {
  try {
    if (!/\.tasks$/.test(name)) return;
    if (fs.existsSync(path.join(dir, name.replace(/\.tasks$/, ".json")))) return;
    const folder = path.join(dir, name);
    fs.readdirSync(folder).forEach((entry) => {
      if (!TURN_TASK_FILE_RE.test(entry) && !TURN_TASK_TEMP_RE.test(entry)) return;
      try {
        const p = path.join(folder, entry);
        if (fs.lstatSync(p).isFile()) fs.unlinkSync(p);
      } catch {
        /* this entry only */
      }
    });
    fs.rmdirSync(folder);
  } catch {
    /* best-effort: something else is in there, or it is already gone */
  }
}

/**
 * The tasks THIS tool call started or resumed, by id, read from the tool's own
 * result (`tool_response`, the object Claude Code also writes to the transcript
 * as `toolUseResult`). Measured on Rob's Mac over 3 days, the task a later
 * notification reports was named by one of these in 315 of 317 cases:
 *
 *   Agent, Task      `agentId`, when `status` is "async_launched": an agent sent
 *                    to work in the background. (A foreground agent's result
 *                    arrives when it has finished, and starts nothing.)
 *   SendMessage      `resumedAgentId`: an agent set to work again
 *   Bash, PowerShell `backgroundTaskId`: a command left running
 *   Monitor          `taskId`: a watch left running
 *
 * Ids only. A result of another shape names nothing: never throws.
 */
function dispatchedTaskIds(payload) {
  const out = [];
  try {
    const res = payload && payload.tool_response;
    if (!res || typeof res !== "object" || Array.isArray(res)) return out;
    const tool = payload.tool_name;
    const push = (value) => {
      const id = taskIdOf(value);
      if (id && out.indexOf(id) === -1) out.push(id);
    };
    if ((tool === "Agent" || tool === "Task") && res.status === "async_launched") push(res.agentId);
    if (tool === "SendMessage") push(res.resumedAgentId);
    if (tool === "Bash" || tool === "PowerShell") push(res.backgroundTaskId);
    if (tool === "Monitor") push(res.taskId);
  } catch {
    /* nothing started */
  }
  return out;
}

/**
 * The text a transcript user entry opens with: its content when that is a
 * string, else its first text block. "" when it has none. Used for the marker
 * test and nothing else; it is never kept, sent or logged.
 */
function turnEntryText(row) {
  const message = row && row.message;
  const content = message && typeof message === "object" ? message.content : null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
  }
  return "";
}

/**
 * True when the text IS a scheduled task's prompt as the app writes it: the
 * wrapper opens at the very start and closes at the very end (white space after
 * it aside), so the wrapper is the whole of the text.
 *
 * ⛔ THE WHOLE TEXT, NOT ITS FIRST WORDS (0.11.6, delta review F6). A person can
 * begin a prompt by quoting the tag — pasting a task's file to ask why it ran
 * twice — and what they type after it makes it theirs. The app writes nothing
 * outside the wrapper: on Rob's Mac over 45 days, 10 of 10 such prompts were a
 * plain string that began with the opening tag and ended with the closing one.
 */
function isScheduledTaskPrompt(text) {
  if (!TURN_ORIGIN_SCHEDULED_TASK_RE.test(text)) return false;
  return text.trimEnd().endsWith(TURN_ORIGIN_SCHEDULED_TASK_END);
}

/**
 * True when the text begins with the bridge's marker — at the very start, or at
 * the start of the task inside the wrapper the app puts around the first
 * message of a session `start_session` opened (see TURN_ORIGIN_SIDE_FRESH_PREFIX).
 * The background of a fresh start is free text and may hold the separator
 * itself, so every "\n\nTask:\n" after the wrapper is tried in turn. Never throws.
 */
function turnEntryStartsWithMarker(text) {
  if (typeof text !== "string" || !text) return false;
  if (TURN_ORIGIN_MARKER_RE.test(text)) return true;
  if (text.startsWith(TURN_ORIGIN_SIDE_FORK_PREFIX)) {
    return TURN_ORIGIN_MARKER_RE.test(text.slice(TURN_ORIGIN_SIDE_FORK_PREFIX.length));
  }
  if (!text.startsWith(TURN_ORIGIN_SIDE_FRESH_PREFIX)) return false;
  const sep = TURN_ORIGIN_SIDE_TASK_SEPARATOR;
  let at = text.indexOf(sep, TURN_ORIGIN_SIDE_FRESH_PREFIX.length);
  while (at !== -1) {
    if (TURN_ORIGIN_MARKER_RE.test(text.slice(at + sep.length, at + sep.length + 64))) return true;
    at = text.indexOf(sep, at + 1);
  }
  return false;
}

/**
 * The text with the app's notes at its very start passed over, and the white
 * space after them (see TURN_ORIGIN_NOTE_OPEN). The text as it is when it does
 * not begin with a note, or when a note never closes. Never throws.
 */
function turnEntryAfterLeadingNotes(text) {
  if (typeof text !== "string" || !text.startsWith(TURN_ORIGIN_NOTE_OPEN)) return text;
  let rest = text;
  for (let i = 0; i < TURN_ORIGIN_LEADING_NOTES_MAX && rest.startsWith(TURN_ORIGIN_NOTE_OPEN); i++) {
    const close = rest.indexOf(TURN_ORIGIN_NOTE_CLOSE, TURN_ORIGIN_NOTE_OPEN.length);
    if (close === -1) return text;
    rest = rest.slice(close + TURN_ORIGIN_NOTE_CLOSE.length).replace(/^\s+/, "");
  }
  return rest;
}

/**
 * True when a prompt's own words say the SYSTEM wrote it, whatever its stamp
 * says: the bridge's kickoff marker at the very start of the text (or of the
 * task the app's start_session wrapper carries), or a text that is, whole, the
 * app's scheduled-task wrapper. Both tests are read after the app's notes in
 * front of the text (turnEntryAfterLeadingNotes).
 */
function turnEntryAutoByText(row) {
  const text = turnEntryAfterLeadingNotes(turnEntryText(row));
  return turnEntryStartsWithMarker(text) || isScheduledTaskPrompt(text);
}

/**
 * True when a stamped transcript entry STARTS nothing: a background task
 * reporting back, or the app resuming the turn. ⛔ A prompt that opens with the
 * bridge's marker or the scheduled-task wrapper always starts a chain, whatever
 * its stamp says.
 */
function turnEntryContinues(row) {
  if (turnEntryAutoByText(row)) return false;
  return TURN_ORIGIN_CONTINUES_KINDS.indexOf(row.turnOrigin) !== -1;
}

/**
 * A stamped transcript entry that starts a chain, as "person", "auto" or null
 * (cannot tell). The opening words are tested first: a bridge kickoff and a
 * scheduled task are "auto" whatever their stamp says. (Asked only of an entry
 * turnEntryContinues() answered false for.)
 */
function classifyTurnEntry(row) {
  if (turnEntryAutoByText(row)) return "auto";
  const kind = row.turnOrigin;
  if (TURN_ORIGIN_PERSON_KINDS.indexOf(kind) !== -1) return "person";
  if (TURN_ORIGIN_AUTO_KINDS.indexOf(kind) !== -1) return "auto";
  return null;
}

/**
 * The id of the task a task notification reports, or null: the `<task-id>` its
 * text opens with. The id only; nothing else of the text is read, kept or sent.
 */
function turnEntryTaskId(row) {
  const m = TURN_TASK_NOTIFICATION_RE.exec(turnEntryText(row));
  return m ? m[1] : null;
}

/**
 * The origin of the turn `promptId` names, from the tail of the transcript, or
 * null when the tail holds no stamped user entry of that prompt (of any prompt
 * when `promptId` is null). Reads at most the last TURN_ORIGIN_READ_BYTES of the
 * file, and nothing else. Never throws.
 *
 * The newest stamped entry of the prompt is THE TURN. What comes back:
 *
 *   it starts a chain             { promptId, continues: false, value }
 *   it continues one, and the     { promptId, taskId, continues: true,
 *   tail shows where it started     chainInTail: true, startPromptId, value }:
 *                                   `value` is that start's, `startPromptId`
 *                                   the id of the prompt it opened
 *   it continues one, and the     { promptId, taskId, continues: true,
 *   tail does not show the start    chainInTail: false }: the caller has what
 *                                   was kept
 *
 * `value` is "person", "auto" or null (a start that says nothing either way).
 * The start of a chain is the nearest EARLIER stamped entry, of any prompt, that
 * is not itself a continuation. `taskId` is the task a notification reports, or
 * null (the app resuming a turn reports none).
 *
 * The path rule is transcriptFileAllowed(), the title read's: a non-empty
 * absolute path to a regular file, inside `<home>/.claude/` or the folder
 * CLAUDE_CONFIG_DIR names (as written, or by real path), whose own name is not
 * a link.
 *
 * ⛔ ONLY A LINE THAT HOLDS THE STAMP IS PARSED. The tail is searched from the
 * end, as bytes, for the key as Claude Code writes it; the one line around each
 * hit is decoded and parsed, and nothing else is. A tool result that quotes a
 * transcript holds the key with its quotes escaped, which is not a hit. A hit
 * counts only when its line is a whole line of the file (the piece a window
 * begins inside is not), parses as JSON, is a main-thread `user` entry and
 * carries `turnOrigin` as a string at its top level.
 *
 * ⛔ A COMPACT SUMMARY IS NOT A PROMPT. When Claude Code compacts a long turn it
 * writes a summary entry that repeats the running turn's stamp and prompt id
 * (35 of 35 on Rob's Mac). Its text is the summary, not what opened the turn, so
 * a kickoff that was "auto" by its marker would read as the person's from there
 * on. It is passed over: the turn's own opening entry, or what was kept for the
 * prompt, still answers.
 */
function readTurnOrigin(transcriptPath, promptId) {
  let fd = null;
  try {
    const file = transcriptFileAllowed(transcriptPath);
    if (!file) return null;

    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, TURN_ORIGIN_READ_BYTES);
    if (length <= 0) return null;
    const start = size - length;
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, start + got);
      if (n <= 0) break;
      got += n;
    }

    /** The newest stamped entry of this prompt, once found to continue a chain. */
    let turn = null;
    let from = got;
    while (from > 0) {
      const hit = buf.lastIndexOf(TURN_ORIGIN_STAMP_KEY, from - 1, "utf8");
      if (hit === -1) break;
      const lineBreakBefore = hit === 0 ? -1 : buf.lastIndexOf(10, hit - 1);
      const lineStart = lineBreakBefore + 1;
      // Everything before this line is searched next, whatever this line is.
      from = lineStart;
      // A window that begins inside the file begins inside a line. That first
      // piece is not a line, so a hit in it is not read.
      if (lineBreakBefore === -1 && start > 0) break;
      let lineEnd = buf.indexOf(10, hit);
      if (lineEnd === -1 || lineEnd > got) lineEnd = got;
      let row = null;
      try {
        row = JSON.parse(buf.toString("utf8", lineStart, lineEnd));
      } catch {
        continue; // a half-written last line, or not JSON at all
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      if (row.type !== "user" || row.isSidechain === true) continue;
      if (row.isCompactSummary === true) continue;
      if (typeof row.turnOrigin !== "string") continue;
      const rowPromptId = stateString(row.promptId);
      if (turn === null) {
        // Another prompt's opening entry is not this row's turn.
        if (promptId && rowPromptId && rowPromptId !== promptId) continue;
        if (!turnEntryContinues(row)) {
          return { promptId: rowPromptId, continues: false, value: classifyTurnEntry(row) };
        }
        // A background task reporting back, or the app resuming: it takes the
        // origin of its chain. Keep looking, further back, for where that began.
        turn = { promptId: rowPromptId, taskId: turnEntryTaskId(row) };
        continue;
      }
      // Looking for the chain's start: the nearest earlier entry, of any prompt,
      // that is not itself a continuation.
      if (turnEntryContinues(row)) continue;
      return {
        promptId: turn.promptId,
        taskId: turn.taskId,
        continues: true,
        chainInTail: true,
        startPromptId: rowPromptId,
        value: classifyTurnEntry(row),
      };
    }
    // The turn continues a chain whose start is further back than the tail.
    if (turn !== null) {
      return { promptId: turn.promptId, taskId: turn.taskId, continues: true, chainInTail: false };
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* nothing to close */
      }
    }
  }
}

/**
 * Who started the turn this payload's prompt belongs to, as it is KEPT —
 * "person", "auto", "none" (read, and it says nothing) or null (could not be
 * read) — and what is kept of it in `state`. The caller saves the state.
 *
 *   the tail holds a stamped entry of this prompt…
 *     …that starts a chain                          its answer; kept as the
 *                                                   turn's AND as the chain's
 *     …that is a task reporting back INSIDE the     the turn's own answer: the
 *       turn (the start the tail shows is this      start's, or what is kept
 *       prompt's, or an answer is kept for it)      for this prompt
 *     …that is a task reporting back and OPENS      that task's origin; kept
 *       the prompt, the task's origin being kept    as the turn's
 *     …that continues a chain whose start the       that start's answer; kept
 *       tail shows                                  as the turn's and the chain's
 *     …that continues one whose start the tail      the chain's answer that was
 *       does not show                               kept; kept as the turn's
 *   it holds none, and `state` holds an answer      that answer
 *   for this same prompt id
 *   it holds none, and the prompt is not the one    null, and what was kept for
 *   `state` holds an answer for                     the turn AND for the chain
 *                                                   is cleared; the new prompt's
 *                                                   id is kept
 *   anything else (no prompt id, no transcript)     null: `state` is left as it
 *                                                   was
 *
 * ⛔ ONE PROMPT DOES NOT MARK THE NEXT. The turn's answer is used only while the
 * payload's `prompt_id` is the id it was kept under. A new prompt has a new id,
 * so its rows are read from its own opening entry or are "cannot tell".
 *
 * ⛔ NOR DOES AN OLDER CHAIN (0.11.5, review R3). A new prompt whose opening
 * entry cannot be read — it has already left the tail: 3 MiB of pasted images,
 * or 2.2 MB of output before the first tool call — is a turn nothing is known
 * of. Leaving the kept chain in force would hand an OLDER chain's answer to the
 * background tasks this turn dispatches: a person's own task sent as "auto"
 * because the bridge had the thread before them. So the kept chain is cleared
 * with the kept turn: those tasks are "cannot tell" until a turn that can be
 * read starts a chain again.
 *
 * ⛔ THE CHAIN'S ANSWER IS REPLACED BY EVERY TURN THAT STARTS ONE, a "cannot
 * tell" start included: a task that reports back into a chain nothing can be
 * said of is "cannot tell" too, never the answer of an older chain.
 *
 * Never throws: any failure is null.
 */
function turnOriginFor(payload, state) {
  try {
    const transcriptPath = payload && payload.transcript_path;
    if (typeof transcriptPath !== "string" || !transcriptPath) return null;
    const promptId = stateString(payload.prompt_id);
    const found = readTurnOrigin(transcriptPath, promptId);
    if (found) {
      if (!found.continues || found.chainInTail) {
        state.turn_chain_origin = turnOriginValue(found.value) || "none";
      }
      const foundPromptId = found.promptId || promptId;
      if (!found.continues) {
        state.turn_origin = turnOriginKept(state.turn_chain_origin);
      } else if (found.chainInTail && foundPromptId && found.startPromptId === foundPromptId) {
        // ⛔ A REPORT WRITTEN INSIDE A RUNNING TURN DOES NOT OPEN IT (delta
        // review F1). The start the tail shows is this same prompt's own
        // opening entry: the turn is whoever opened it, and the task that
        // happened to report while it ran changes nothing.
        state.turn_origin = turnOriginKept(state.turn_chain_origin);
      } else if (
        !found.chainInTail &&
        foundPromptId &&
        stateString(state.turn_origin_prompt_id) === foundPromptId &&
        turnOriginKept(state.turn_origin)
      ) {
        // The same, when this prompt's opening entry has left the tail: an
        // answer is already kept for the prompt, from when it could be read,
        // and a report written since does not replace it.
      } else {
        // The report OPENS the prompt. It takes the origin of the task itself
        // when that was fixed (the row that started it, or the agent's first
        // row): the prompt before it may be somebody else's. With none kept
        // for it, and for the app resuming a turn, the chain answers — what
        // the tail shows, or what was kept when its start was read.
        const reported = taskOriginGet(taskOriginsDirFor(payload.session_id), found.taskId);
        state.turn_origin = reported || turnOriginKept(state.turn_chain_origin);
      }
      state.turn_origin_prompt_id = foundPromptId;
      return turnOriginKept(state.turn_origin);
    }
    if (!promptId) return null;
    if (stateString(state.turn_origin_prompt_id) === promptId) {
      return turnOriginKept(state.turn_origin);
    }
    // A prompt nothing is kept for, whose opening entry the tail does not hold.
    state.turn_chain_origin = null;
    state.turn_origin = null;
    state.turn_origin_prompt_id = promptId;
    return null;
  } catch {
    return null;
  }
}

/**
 * The origin THIS ROW is sent with — "person", "auto" or null — and what is
 * kept of it in `state`. The caller saves the state.
 *
 * ⛔ AN AGENT'S ROWS KEEP THE ORIGIN THE AGENT STARTED WITH (0.11.5, review R2).
 * `prompt_id` is the SESSION's current prompt, not the agent's: when a newer
 * prompt arrives while a background agent is still working, every later row of
 * that agent names the new prompt. Read by prompt, an agent a person's turn
 * dispatched turned "auto" the moment the bridge sent the thread a message, and
 * the other way round (measured over 14 days on one machine: 3,435 of 74,510
 * tool calls by agents a person's chain dispatched were sent "auto", and 1,201
 * of 7,530 the other way).
 *
 * What identifies the agent: `agent_id` in the hook's input. Claude Code's own
 * description of the field (2.1.280 to 2.1.295): "Subagent identifier. Present
 * only when the hook fires from within a subagent [...] Absent for the main
 * thread". So:
 *
 *   a row with an `agent_id`   the origin kept for that agent. With none kept,
 *                              this is the agent's FIRST row: the origin of the
 *                              turn current now (turnOriginFor) is its origin
 *                              from here on — "none" included, so an agent a
 *                              chain nothing is known of dispatched does not
 *                              pick up whichever prompt comes next. A turn that
 *                              could not be read fixes nothing: the agent's
 *                              next row is asked again.
 *   a row with none            the origin of its turn (turnOriginFor), which
 *                              for a task reporting back is the origin of the
 *                              task it reports
 *
 * ⛔ A TASK IS ALSO FIXED BY THE ROW THAT STARTS IT (dispatchedTaskIds): the
 * agent sent to the background, the agent set to work again, the command or
 * watch left running. Each takes the origin of the row whose tool call started
 * it — and that is what its notification is then read as, hours later, under
 * whatever prompt. A task started again is fixed again: an agent the bridge
 * started and the person later resumes is the person's from the resume on. When
 * the starting row's own origin could not be read, a task that had an origin
 * loses it ("none") rather than keep an answer from before.
 *
 * ⛔ AND BY ITS OWN START, WHEN THE HOOK IS TOLD OF IT (0.11.6, delta review
 * F4): see handleSubagentStart. An agent no tool result named — one that runs in
 * the foreground — was otherwise fixed by its first ROW, and a prompt that
 * arrived between its start and its first tool call fixed it wrongly (57 of
 * 81,540 agent rows over 14 days on one machine).
 *
 * The ids are Claude Code's own random ones. They are kept in a folder beside
 * the session's state file, one small file and one word each (TASK ORIGINS),
 * are never sent, and name nothing outside this machine.
 *
 * Never throws: any failure is null.
 */
function rowOriginFor(payload, state) {
  try {
    const tasks = taskOriginsDirFor(payload && payload.session_id);
    const agent = taskIdOf(payload && payload.agent_id);
    let kept = agent ? taskOriginGet(tasks, agent) : null;
    if (!kept) {
      kept = turnOriginFor(payload, state);
      if (agent && kept) taskOriginSet(tasks, agent, kept);
    }
    const started = dispatchedTaskIds(payload);
    for (let i = 0; i < started.length; i++) {
      if (kept) taskOriginSet(tasks, started[i], kept);
      else if (taskOriginRead(tasks, started[i])) taskOriginSet(tasks, started[i], "none");
    }
    return turnOriginValue(kept);
  } catch {
    return null;
  }
}

/**
 * SubagentStart: an agent is starting. Fix who started it, now, from the turn
 * that is current — before a newer prompt can arrive between this and the
 * agent's first tool call.
 *
 * ⛔ ONLY WHEN NOTHING IS KEPT FOR THE AGENT. The row that started it (an agent
 * sent to the background, or set to work again) knows more than this event
 * does: it carries the origin of the very row whose tool call started the
 * agent, which for an agent started BY an agent is that agent's own origin and
 * not the session's current prompt. Either can arrive first. So this fixes an
 * agent nothing has fixed, and never replaces an answer.
 *
 * ⛔ NO REQUEST, NO ROW, NOTHING PRINTED. A SubagentStart hook's output is
 * shown to the agent as context; this one has nothing to tell it. A turn that
 * cannot be read fixes nothing, and the agent's first row asks again, as
 * before. The session's state is saved only when this read changed what is
 * kept for the turn.
 *
 * ⛔ THIS RUNS ONLY WHERE SubagentStart IS REGISTERED FOR THE HOOK, which the
 * installer does not do (it registers PostToolUse, Stop and SessionStart).
 * Where it is not registered nothing changes: the first-row rule stands.
 */
function handleSubagentStart(payload) {
  const sessionId = payload.session_id;
  const tasks = taskOriginsDirFor(sessionId);
  const agent = taskIdOf(payload.agent_id);
  if (!tasks || !agent) return;
  if (taskOriginRead(tasks, agent)) return;
  const state = loadSessionState(sessionId);
  const turnBefore = state.turn_origin;
  const promptBefore = state.turn_origin_prompt_id;
  const chainBefore = state.turn_chain_origin;
  const kept = turnOriginFor(payload, state);
  if (kept) taskOriginSet(tasks, agent, kept);
  if (
    state.turn_origin !== turnBefore ||
    state.turn_origin_prompt_id !== promptBefore ||
    state.turn_chain_origin !== chainBefore
  ) {
    saveSessionState(sessionId, state);
  }
}

/**
 * The PostToolUse run's shared network deadline (epoch ms):
 * POST_TOOL_USE_SAVE_MARGIN_MS before the hard exit main() armed. SessionStart
 * uses it too, for the terminal `delivered_chip` records, which save state
 * after their POSTs settle exactly as PostToolUse does.
 */
function postToolUseDeadline() {
  const hardExitAt = HARD_EXIT_AT || Date.now() + HARD_EXIT_DEFAULT_MS;
  return hardExitAt - POST_TOOL_USE_SAVE_MARGIN_MS;
}

// ───────────────────────────────────────────────────────────────────────────
// PLUGIN TOOL CALLS (0.11.8, 2026-10-16) — a mod's call is not work.
//
// The mm-bridge mod calls the desktop app's tools by itself, on its timer, in
// every open thread: `get_usage` every 5 minutes (bridge up to 0.5.10), and
// `list_sessions`, `get_session`, `set_session_title`, `set_pinned`,
// `send_message`, `start_session`, `spawn_task` and `dismiss_task` from its
// sync and chip passes. Claude Code runs a mod's `$.mcp.call` through the same
// tool pipeline as a model's call, so PostToolUse fires for each one, in the
// thread's session, with the prompt id of the thread's last prompt. Every one
// became a worklog row, 12 an hour around the clock, and held the thread's
// window open all day: on 2026-10-15 Rob's Homestretch thread had 169 such rows
// of 228, and his day read 296 client hours.
//
// ⛔ HOW ONE IS KNOWN. Claude Code gives a mod's call a `tool_use_id` that
// begins `toolu_plugin_` (read from Claude Code 2.1.296 and the desktop app's
// 2.1.299: `{ type: "tool_use", id: "toolu_plugin_" + uuid, caller: { type:
// "direct" } }`). The hook input carries no other mark: no caller, no plugin
// name, and the same session, cwd and prompt id as the model's own calls. A
// model's call has an API id (`toolu_01…`), which never holds that prefix.
//
// ⛔ WHAT IS SKIPPED: the worklog row, the Stop line's count, the title read,
// the turn-origin read and the declaration capture. Nothing is sent for it.
// ⛔ WHAT STAYS: the `delivered_chip` ack. A card a mod put on screen for one
// of the chips this session was served is still a delivered chip; the ack
// matches only served fingerprints, as before, and saves the session state
// only when it changed it.
// ───────────────────────────────────────────────────────────────────────────

/** The `tool_use_id` prefix Claude Code gives a call a mod made (`$.mcp.call` / `$.tool.call`). */
const PLUGIN_TOOL_USE_ID_PREFIX = "toolu_plugin_";

/** True when this PostToolUse is for a call a mod made, not the model. */
function isPluginToolCall(payload) {
  const id = payload && payload.tool_use_id;
  return typeof id === "string" && id.indexOf(PLUGIN_TOOL_USE_ID_PREFIX) === 0;
}

/** A mod's call: the chip ack only, and no worklog row. See PLUGIN TOOL CALLS. */
async function handlePluginToolCall(payload) {
  if (!cardDeliveryTool(payload)) return;
  const sessionId = payload.session_id;
  const state = loadSessionState(sessionId);
  const ackedBefore = state.ackedChips.length;
  const failuresBefore = state.chipAckFailures;
  await ackDeliveredChip(payload, state, postToolUseDeadline());
  if (state.ackedChips.length !== ackedBefore || state.chipAckFailures !== failuresBefore) {
    saveSessionState(sessionId, state);
  }
}

async function handlePostToolUse(payload) {
  // ⛔ A mod's own call is not work: no row (PLUGIN TOOL CALLS, 0.11.8).
  if (isPluginToolCall(payload)) {
    await handlePluginToolCall(payload);
    return;
  }

  const sessionId = payload.session_id;
  const toolName = payload.tool_name || "unknown_tool";
  const toolInput = payload.tool_input || {};

  // ⛔ ONE DEADLINE FOR THE WHOLE RUN (2026-09-29). Besides the activity line,
  // this run makes one request per newly completed todo, and it used to make
  // them one after another with 10 s each: five completions against a slow
  // server could hold the hook for most of a minute. /api/ext/worklog stores ONE
  // row per request and has no batch form, so they stay separate requests. They
  // now go out together, and every request this run makes — the chip ack too —
  // is aborted at the same deadline. That deadline sits
  // POST_TOOL_USE_SAVE_MARGIN_MS before the hard exit so the state save below
  // always runs: a run the hard exit cut short would lose this call's dedupe set
  // and post the same todos again on the next TodoWrite.
  const deadlineAt = postToolUseDeadline();

  const state = loadSessionState(sessionId);
  state.toolCallCount += 1;

  // ⛔ SESSION TITLE (0.11.4). Every POST this run makes carries the thread's
  // name. It comes from the cache in `state`, or from one bounded read of the
  // transcript when the cache is older than 10 minutes; the save at the end of
  // this run keeps whatever that read found.
  SESSION_TITLE = sessionTitleFor(payload, state);

  // ⛔ TURN ORIGIN (0.11.5). Every POST this run makes says who started the work
  // this tool call belongs to: its turn, or, for an agent's call, the agent.
  // At most one bounded read of the transcript's tail per run (none for an
  // agent whose origin is already kept); the save at the end of this run keeps
  // the answer for the rest of the turn, and for the agent.
  TURN_ORIGIN = rowOriginFor(payload, state);

  // ⛔ TASK ANNOUNCING (SPEC v2 §2.3). A declaration made by THIS call is taken
  // into the state before anything is posted, so this call's own row already
  // carries it — and is the one row marked with `declaration_event`.
  const declarationEvent = captureDeclaration(toolName, toolInput, payload.tool_response, state);

  // ⛔ UNDECLARED-SESSION REMINDER (0.11.11). Decided after the declaration
  // capture, so the call that loads a client skill is never counted. The write
  // starts now, before the network phase, and is awaited with the POSTs: a slow
  // server cannot hold it back, and the hard exit cannot cut it off.
  const reminder = undeclaredReminderFor(payload, state, TURN_ORIGIN, process.env, process.platform);
  const reminderWrite = reminder ? emitHookContext("PostToolUse", reminder) : null;

  // ⛔ The chip ack goes FIRST. It is the time-sensitive record and must not
  // queue behind the generic worklog POST. See the `delivered_chip` block above
  // for why this lives in code rather than in the session prompt.
  await ackDeliveredChip(payload, state, deadlineAt);

  // Generic per-tool-call activity line — "each tool call ... as it happens."
  const posts = [
    postWorklog(
      {
        contentMd: `- ${describeToolCall(toolName, toolInput)}`,
        source: "claude-code",
        declarations: declarationFields(sessionId, state, declarationEvent),
      },
      deadlineAt,
    ),
  ];

  // Build 5 — TodoWrite completions feed the PM real-time progress view.
  // Dedupe on content text within this session (todos have no stable id).
  if (toolName === "TodoWrite") {
    const todos = Array.isArray(toolInput.todos) ? toolInput.todos : [];
    const seen = new Set(state.seenTodos);
    const newlyCompleted = todos.filter(
      (t) => t && t.status === "completed" && t.content && !seen.has(t.content),
    );
    for (const t of newlyCompleted) {
      posts.push(
        postWorklog(
          {
            contentMd: `✅ ${scrubText(String(t.content)).text}`,
            title: scrubAndTruncate(t.content, 120),
            source: "claude-code-todo",
            declarations: declarationFields(sessionId, state, null),
          },
          deadlineAt,
        ),
      );
      seen.add(t.content);
    }
    state.seenTodos = Array.from(seen);
  }

  if (reminderWrite) posts.push(reminderWrite);
  await Promise.allSettled(posts);
  saveSessionState(sessionId, state);
}

// ───────────────────────────────────────────────────────────────────────────
// UNDECLARED-SESSION REMINDER (0.11.11, 2026-10-25).
//
// A session's time is counted to a client only once it loads that client's
// skill (captureDeclaration), and the SessionStart instruction already says so.
// Short utility threads (access resets, setup checks, cross-client reviews)
// still never did: 614 team minutes in two business days went to nobody. So a
// session that keeps working with no client declared is told again, mid-session,
// in the additionalContext of the tool call that crosses the line.
//
// ⛔ WHAT IS COUNTED. A PostToolUse of the MAIN session (no `agent_id`: an
// agent's own calls are not counted) in a turn that is not "auto" ("person" and
// "cannot tell" both count), while the session has no declared client
// (`declared_skill`; a task alone is not a client). A mod's call never gets here
// (PLUGIN TOOL CALLS), and a call that loads a client skill has declared before
// it could be counted.
//
// ⛔ WHEN. On the 5th counted call, once. If the session is still undeclared 40
// counted calls later (the 45th), once more. Never a third time. A declaration
// at any point ends it for good: nothing is counted once `declared_skill` is
// set, and nothing ever clears it.
//
// ⛔ NEVER IN: a machine with no tracker token (a declaration records nothing
// there); a run with MM_UNATTENDED=1 (the launchd runners); a session no
// person is at (isInteractiveSession, the untracked-folder nudge's own test:
// CLAUDE_CODE_ENTRYPOINT starting "sdk"); a Codex run (isCodexHookPayload).
//
// ⛔ AT MOST TWO, EVEN SIDE BY SIDE. Claude Code runs the hooks of parallel tool
// calls at the same time, each loading and saving the whole state, so two can
// reach the 5th call together. Each reminder is therefore claimed by creating a
// marker file exclusively (`wx`), and only the process that creates it prints.
// The marker sits beside the session's declarations record, names its
// transcript, and is pruned by that record's rule (pruneDeclarationRecords): it
// outlives the 48-hour state prune for as long as Claude Code could resume the
// session, so a resumed session whose count starts again from nothing is still
// never told a third time.
//
// ⛔ FAIL-OPEN. Any error is no reminder: nothing thrown, nothing on stderr. No
// request is made for it and nothing about it is sent to OW; the count lives in
// the session's state file.
// ───────────────────────────────────────────────────────────────────────────

/**
 * VERBATIM — Opus, 2026-10-25 (the 0.11.11 dispatch). Placed byte for byte: do
 * not reflow, re-punctuate or improve it. One paragraph. On Windows the task
 * command is followed by the PowerShell form in brackets, as the SessionStart
 * instruction prints both (undeclaredReminderText): the Bash tool there is Git
 * Bash, where the first form works and `$env:` does not, while a PowerShell tool
 * needs the second. Nothing else changes.
 */
const UNDECLARED_SESSION_REMINDER = `Massmarket time tracking: this session has done work with no client declared, so its time is not counted to anyone. If the work is for a client, load that client's <client>-project skill now with the Skill tool. For Massmarket's own systems load massmarket-internal-ops; for our own marketing and sales, massmarket-self-funnel. Personal work: ignore this. Then declare the task with node ~/.claude/mm-hooks/worklog-hook.js --task "<task>". Decide from the work; do not ask the person.`;

/** The task command as the reminder prints it: TRACKING_INSTRUCTION_FALLBACK's own. */
const UNDECLARED_REMINDER_TASK_COMMAND = 'node ~/.claude/mm-hooks/worklog-hook.js --task "<task>"';

/** The same command as TRACKING_INSTRUCTION_FALLBACK prints it for Windows PowerShell. */
const UNDECLARED_REMINDER_TASK_COMMAND_WINDOWS =
  'node "$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js" --task "<task>"';

/** The counted call that brings the first reminder. */
const UNDECLARED_REMINDER_FIRST_AT = 5;
/** Counted calls after the first reminder that bring the second. */
const UNDECLARED_REMINDER_AGAIN_AFTER = 40;
/** Reminders a session gets, at most. */
const UNDECLARED_REMINDER_MAX = 2;

/** A count kept in the state: a positive integer, or 0 for anything else. */
function reminderCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e9 ? value : 0;
}

/** The reminder for this platform: on win32 both task commands, as SessionStart prints them; otherwise the text as written. */
function undeclaredReminderText(platform) {
  if (platform !== "win32") return UNDECLARED_SESSION_REMINDER;
  return UNDECLARED_SESSION_REMINDER.replace(
    UNDECLARED_REMINDER_TASK_COMMAND,
    () => `${UNDECLARED_REMINDER_TASK_COMMAND} (Windows PowerShell: ${UNDECLARED_REMINDER_TASK_COMMAND_WINDOWS})`,
  );
}

/**
 * Is this hook run Codex's, not Claude Code's? From the payload, as measured in
 * the control tower's docs/codex-hooks-probe-2026-09-17.md: Codex's tool events
 * carry a `turn_id`, which Claude Code's do not, and Codex's `tool_use_id` is
 * `call_…` where Claude Code's is `toolu_…`. Never throws.
 */
function isCodexHookPayload(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (typeof p.turn_id === "string" && p.turn_id) return true;
  return typeof p.tool_use_id === "string" && p.tool_use_id.indexOf("call_") === 0;
}

/**
 * May this run count toward, or print, the reminder? Not unattended, a person
 * at the session, not Codex, and the main session's own call (an agent's call
 * carries `agent_id`; Claude Code: "Absent for the main thread").
 */
function undeclaredReminderApplies(payload, env) {
  const e = env || process.env;
  // No token, nothing a declaration could record: no reminder.
  if (!TOKEN) return false;
  if (e.MM_UNATTENDED === "1") return false;
  if (!isInteractiveSession(e)) return false;
  if (isCodexHookPayload(payload)) return false;
  return !(typeof payload.agent_id === "string" && payload.agent_id);
}

/** `declarations/<session id>.reminder-<slot>.json`, or null for a payload that names no session. */
function undeclaredReminderMarkerFile(sessionId, slot) {
  if (!DECLARATION_STATE_DIR || !isSessionKey(sessionId)) return null;
  const base = sessionStateFileName(sessionId).replace(/\.json$/, "");
  return path.join(DECLARATION_STATE_DIR, `${base}.reminder-${slot}.json`);
}

/**
 * Claim reminder `slot` for this session: "claimed" when this process created
 * its marker, "taken" when the marker was already there (a parallel hook, or
 * this session before its state was pruned), "error" otherwise. The body names
 * the transcript so the prune keeps the marker as long as the session's record.
 * Never throws.
 */
function claimUndeclaredReminder(sessionId, slot) {
  const file = undeclaredReminderMarkerFile(sessionId, slot);
  if (!file) return "error";
  let fd;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    return "error";
  }
  try {
    fd = fs.openSync(file, "wx");
  } catch (err) {
    return err && err.code === "EEXIST" ? "taken" : "error";
  }
  try {
    fs.writeSync(fd, JSON.stringify({ reminder: slot, transcript_path: HOOK_TRANSCRIPT_PATH }));
  } catch {
    /* the file is the claim; its body only keeps it from an early prune */
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  return "claimed";
}

/**
 * The reminder this tool call prints, or null. Counts the call in `state` when
 * it counts (the caller saves the state). `turnOrigin` is this row's origin:
 * "person", "auto" or null. Never throws: any failure is null.
 */
function undeclaredReminderFor(payload, state, turnOrigin, env, platform) {
  try {
    const p = payload && typeof payload === "object" ? payload : {};
    if (!isSessionKey(p.session_id)) return null;
    if (stateString(state.declared_skill)) return null;
    if (!undeclaredReminderApplies(p, env)) return null;
    if (turnOrigin === "auto") return null;
    const given = reminderCount(state.undeclared_reminders);
    if (given >= UNDECLARED_REMINDER_MAX) return null;
    const count = reminderCount(state.undeclared_tool_calls) + 1;
    state.undeclared_tool_calls = count;
    if (count < UNDECLARED_REMINDER_FIRST_AT + given * UNDECLARED_REMINDER_AGAIN_AFTER) return null;
    const slot = given + 1;
    state.undeclared_reminders = slot;
    return claimUndeclaredReminder(p.session_id, slot) === "claimed"
      ? undeclaredReminderText(platform)
      : null;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// REGISTRY SKILL SYNC (Stop) — SPEC-task-announcing-v2 §2.5, write rules §5.3.
//
// Rob, 2026-09-30: "when we run them locally, it checks the registry and checks
// the version to see if it has the most current one". The installer does the
// full sync; this is the incremental top-up that keeps an installed machine
// current with no reinstall: list the registry (with each skill's `sha`),
// compare with the local markers, fetch at most 10 missing or changed skills in
// one bundle, and write them.
//
// ⛔ WHAT IT MAY WRITE: `~/.claude/skills/<key>/` for a key the registry lists
// (and the `~/.claude/skills` container itself when a machine has none), plus
// its timestamp file under `~/.claude/mm-hooks/state/`. Nothing else, anywhere.
// That is the #342 invariant, widened deliberately and only for this — see
// tests/unit/worklog-hook-state-home.unit.test.ts.
//
// ⛔ THE WRITE RULES, shared with the installer (§5.3): every file is written to
// a temp file and renamed into place; nothing is ever written through a symlink,
// so a repo-linked folder or SKILL.md (Rob's Mac) is left alone; a folder is
// ours when it carries our `.mm-skill.json` marker, and a real folder without
// one is adopted only when its SKILL.md frontmatter `name` equals the key; any
// other folder is not ours and is skipped; the only files removed are ones our
// marker listed and the registry dropped; a folder is never deleted.
//
// ⛔ WHEN: on Stop only, never SessionStart; at most once an hour per machine;
// inside Stop's 6 s hard exit with its own 4 s budget. Every failure is silent
// and costs the session nothing. It tries again on a Stop an hour later.
// ───────────────────────────────────────────────────────────────────────────

const SKILLS_LIST_URL = `${API_BASE}/api/ext/skills`;
const SKILLS_BUNDLE_URL = `${API_BASE}/api/ext/skills/bundle`;
const SKILLS_SYNC_INTERVAL_MS = 3600 * 1000;
const SKILLS_SYNC_BUDGET_MS = 4000;
const SKILLS_SYNC_MAX_PER_RUN = 10;
const SKILL_MARKER_NAME = ".mm-skill.json";
const SKILL_MARKER_SOURCE = "massmarket-registry";
/**
 * ⛔ ONE RULE FOR BOTH LANES (2026-09-30, HOOK fix round 1, Opus decision M2).
 * The SKILLS lane serves, and the control-tower sync now builds, exactly what
 * this accepts, so a served skill always passes; these checks stay here as
 * defence in depth:
 *   - each file, SKILL.md and every helper alike, at most 262,144 bytes;
 *   - the whole skill, SKILL.md plus its helpers, at most 2,097,152 bytes;
 *   - every path: each segment non-empty, none starting with ".", no "..", no
 *     backslash, not absolute, and nothing Windows cannot name (see
 *     safeSkillPathParts).
 * A skill that breaks one is refused whole, and remembered at its sha so it is
 * never asked for again until the registry changes it (L1, below).
 */
const SKILL_FILE_MAX_BYTES = 262144;
const SKILL_TOTAL_MAX_BYTES = 2097152;
/**
 * ⛔ A SKILL THAT CANNOT BE WRITTEN DOES NOT HOLD THE SLOTS (2026-09-30, HOOK fix
 * round 1, Opus decision L1). A run asks for at most 10 skills in list order, so
 * ten keys that could never be written kept every later skill from syncing, and
 * each run downloaded them all again. A key whose write failed PERMANENTLY is
 * recorded in skills-sync.json as `permanent_failures[key] = {sha, outcome,
 * at}` and is never asked for again at that sha; a new sha is asked for at once.
 *
 * Permanent means the same bundle would fail the same way on every run: the
 * bundle itself breaks the rules above ("invalid", "too_large"), or a link sits
 * where the skill would be written ("linked" — found only when writing, since
 * the listing pass sees no deeper than the folder and its SKILL.md). Anything
 * else — a write error, a timeout, a 5xx, a skill the bundle left out — is
 * transient and is asked for again on the next hourly run.
 */
const SKILL_PERMANENT_OUTCOMES = ["invalid", "too_large", "linked"];
/** At most this many remembered failures, newest kept: skills-sync.json stays small. */
const SKILL_FAILED_MAX = 100;
/** One response carries at most 10 skills of 2 MB each, plus JSON. */
const SKILLS_RESPONSE_MAX_CHARS = 24 * 1024 * 1024;
/**
 * A registry key is one plain folder name — never a path, never hidden, never
 * ending in a dot (which Windows would silently drop).
 */
const SKILL_KEY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/;
/** This hook's own temp files. A crash can leave one; only these are ever cleaned. */
const SKILL_SYNC_TEMP_RE = /^\.mm-sync-\d+-[0-9a-f]{12}\.tmp$/;
const SKILL_SYNC_TEMP_STALE_MS = 10 * 60 * 1000;

/** `<home>/.claude`, or null without a usable absolute home directory. */
function homeClaudeDir() {
  try {
    const home = os.homedir();
    if (typeof home !== "string" || !home || !path.isAbsolute(home)) return null;
    return path.join(home, ".claude");
  } catch {
    return null;
  }
}

/** "missing" | "symlink" | "dir" | "file" | "other" | "error" — from lstat, never following a link. */
function pathKind(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    return err && err.code === "ENOENT" ? "missing" : "error";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isDirectory()) return "dir";
  if (st.isFile()) return "file";
  return "other";
}

/** A regular file's text, refusing anything larger than `maxBytes`. Throws on failure. */
function readTextBounded(file, maxBytes) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.size > maxBytes) throw new Error("not a small regular file");
  return fs.readFileSync(file, "utf8");
}

/**
 * Write `content` to `target` atomically: a new temp file in `tempDir` (created
 * exclusively, so it can never be an existing file or link), then one rename.
 * A rename replaces a directory entry and never follows a link at the target.
 */
function writeFileAtomic(target, content, tempDir) {
  const tmp = path.join(
    tempDir,
    `.mm-sync-${process.pid}-${require("crypto").randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    debugLog(`skill sync write failed (${path.basename(target)}): ${err && err.code}`);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* it was never created */
    }
    return false;
  }
}

/** Remove this hook's own temp files older than 10 minutes from `dir`. Nothing else. */
function removeStaleSyncTemps(dir) {
  try {
    const cutoff = Date.now() - SKILL_SYNC_TEMP_STALE_MS;
    for (const name of fs.readdirSync(dir)) {
      if (!SKILL_SYNC_TEMP_RE.test(name)) continue;
      const p = path.join(dir, name);
      try {
        const st = fs.lstatSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {
        /* gone already, or not ours to fight over */
      }
    }
  } catch {
    /* best-effort */
  }
}

/**
 * A registry file path, as safe path segments — or null. Relative, forward
 * slashes, no empty / "." / ".." segment, nothing hidden (so never our marker,
 * `.git` or another dotfile), no `node_modules`, and nothing Windows would
 * refuse or silently rename (reserved characters, a trailing dot or space,
 * device names).
 */
function safeSkillPathParts(rel) {
  if (typeof rel !== "string" || !rel || rel.length > 512) return null;
  if (rel.charAt(0) === "/" || rel.indexOf("\\") !== -1 || rel.indexOf("\0") !== -1) return null;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p === "." || p === ".." || p.charAt(0) === ".") return null;
    if (p === "node_modules" || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p)) return null;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(p)) return null;
  }
  return parts;
}

/** The `name:` of a SKILL.md's leading frontmatter block, unquoted — or null. */
function frontmatterName(text) {
  if (typeof text !== "string") return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.replace(/^﻿/, ""));
  if (!m) return null;
  const line = /^name:[ \t]*(.*)$/m.exec(m[1]);
  if (!line) return null;
  let value = line[1].trim();
  if (
    value.length >= 2 &&
    ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
      (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

/** Our marker in `dir`, as `{sha, files}` — only a real file with our `source`. */
function readSkillMarker(dir) {
  const file = path.join(dir, SKILL_MARKER_NAME);
  if (pathKind(file) !== "file") return null;
  try {
    const parsed = JSON.parse(readTextBounded(file, SKILL_FILE_MAX_BYTES));
    if (!parsed || parsed.source !== SKILL_MARKER_SOURCE || typeof parsed.sha !== "string") {
      return null;
    }
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((f) => typeof f === "string")
      : [];
    return { sha: parsed.sha, files };
  } catch {
    return null;
  }
}

/**
 * What `<root>/<key>` is to us:
 *   missing   — nothing there; ours to install
 *   ours      — a real folder with our marker
 *   adoptable — a real folder, no marker, SKILL.md frontmatter name === key
 *   linked    — the folder or its SKILL.md is a symlink (a repo link): never touched
 *   foreign   — anything else: not ours, never touched
 */
function inspectSkillFolder(root, key) {
  const dir = path.join(root, key);
  const kind = pathKind(dir);
  if (kind === "missing") return { kind: "missing", dir };
  if (kind === "symlink") return { kind: "linked", dir };
  if (kind !== "dir") return { kind: "foreign", dir };
  const skillMd = path.join(dir, "SKILL.md");
  const mdKind = pathKind(skillMd);
  // ⛔ A linked SKILL.md means a repo-linked skill, marker or not: replacing the
  // link with a file would silently cut the folder off its repo.
  if (mdKind === "symlink") return { kind: "linked", dir };
  const marker = readSkillMarker(dir);
  if (marker) return { kind: "ours", dir, marker };
  if (mdKind !== "file") return { kind: "foreign", dir };
  let name = null;
  try {
    name = frontmatterName(readTextBounded(skillMd, SKILL_FILE_MAX_BYTES));
  } catch {
    name = null;
  }
  return name === key ? { kind: "adoptable", dir } : { kind: "foreign", dir };
}

/** Is every directory between `dir` and the file at `parts` a real directory? */
function realDirsAlong(dir, parts) {
  let cur = dir;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = path.join(cur, parts[i]);
    if (pathKind(cur) !== "dir") return false;
  }
  return true;
}

/**
 * Write one registry skill under `<root>/<key>/` by the §5.3 rules. Returns
 * "installed" | "updated", or why it did not: "invalid", "too_large", "linked",
 * "foreign", "conflict", "error". Never throws out of the caller's try.
 */
function writeRegistrySkill(root, key, sha, files, nowIso) {
  if (!files || typeof files !== "object" || Array.isArray(files)) return "invalid";
  const names = Object.keys(files);
  if (names.length === 0 || names.length > 500) return "invalid";
  const entries = [];
  let total = 0;
  for (let i = 0; i < names.length; i++) {
    const content = files[names[i]];
    const parts = safeSkillPathParts(names[i]);
    if (typeof content !== "string" || !parts) return "invalid";
    const bytes = Buffer.byteLength(content, "utf8");
    total += bytes;
    if (bytes > SKILL_FILE_MAX_BYTES || total > SKILL_TOTAL_MAX_BYTES) return "too_large";
    entries.push({ rel: parts.join("/"), parts, content });
  }
  if (!entries.some((e) => e.rel === "SKILL.md")) return "invalid";

  // The container: a real directory. Created (one level, never recursively) on
  // a machine that has none; a linked one is written through by nothing.
  const rootKind = pathKind(root);
  if (rootKind === "missing") {
    try {
      fs.mkdirSync(root);
    } catch {
      return "error";
    }
  } else if (rootKind !== "dir") {
    return "linked";
  }

  // Inspected again right before writing: the answer from the listing pass may
  // be stale by now.
  const info = inspectSkillFolder(root, key);
  if (info.kind !== "missing" && info.kind !== "ours" && info.kind !== "adoptable") return info.kind;
  const dir = info.dir;
  if (info.kind === "missing") {
    try {
      fs.mkdirSync(dir);
    } catch {
      return "error";
    }
    if (pathKind(dir) !== "dir") return "error";
  } else {
    removeStaleSyncTemps(dir);
  }

  // Plan before writing anything: no symlink and nothing unexpected on any path.
  for (let i = 0; i < entries.length; i++) {
    let cur = dir;
    for (let j = 0; j < entries[i].parts.length - 1; j++) {
      cur = path.join(cur, entries[i].parts[j]);
      const k = pathKind(cur);
      if (k === "symlink") return "linked";
      if (k !== "missing" && k !== "dir") return "conflict";
    }
    const k = pathKind(path.join(dir, ...entries[i].parts));
    if (k === "symlink") return "linked";
    if (k !== "missing" && k !== "file") return "conflict";
  }
  const markerPath = path.join(dir, SKILL_MARKER_NAME);
  const markerKind = pathKind(markerPath);
  if (markerKind === "symlink") return "linked";
  if (markerKind !== "missing" && markerKind !== "file") return "conflict";

  // A new or adopted folder is claimed first with a provisional marker (no sha),
  // so a run cut short leaves a folder the next run still recognises as ours
  // and finishes, instead of one it can no longer tell from a stranger's.
  const markerFor = (markerSha, markerFiles) =>
    `${JSON.stringify(
      { sha: markerSha, synced_at: nowIso, source: SKILL_MARKER_SOURCE, files: markerFiles },
      null,
      2,
    )}\n`;
  if (info.kind !== "ours" && !writeFileAtomic(markerPath, markerFor("", []), dir)) return "error";

  for (let i = 0; i < entries.length; i++) {
    let cur = dir;
    for (let j = 0; j < entries[i].parts.length - 1; j++) {
      cur = path.join(cur, entries[i].parts[j]);
      const k = pathKind(cur);
      if (k === "missing") {
        try {
          fs.mkdirSync(cur);
        } catch {
          return "error";
        }
      } else if (k !== "dir") {
        return "linked";
      }
    }
    if (!writeFileAtomic(path.join(dir, ...entries[i].parts), entries[i].content, dir)) {
      return "error";
    }
  }

  // Remove ONLY files our previous marker listed that the registry dropped —
  // never a file we did not write, never a folder.
  if (info.kind === "ours") {
    const keep = new Set(entries.map((e) => e.rel));
    info.marker.files.forEach((old) => {
      const parts = safeSkillPathParts(old);
      if (!parts || keep.has(parts.join("/")) || !realDirsAlong(dir, parts)) return;
      const target = path.join(dir, ...parts);
      if (pathKind(target) !== "file") return;
      try {
        fs.unlinkSync(target);
      } catch {
        /* best-effort */
      }
    });
  }

  // The marker LAST, so an interrupted update keeps the old sha and is retried.
  const written = entries.map((e) => e.rel).sort();
  if (!writeFileAtomic(markerPath, markerFor(sha, written), dir)) return "error";
  return info.kind === "missing" ? "installed" : "updated";
}

/** `<home>/.claude/mm-hooks/state/skills-sync.json` — the per-machine timestamp. */
function skillsSyncStateFile() {
  const claude = homeClaudeDir();
  return claude ? path.join(claude, "mm-hooks", "state", "skills-sync.json") : null;
}

/**
 * The remembered permanent failures (L1) from a skills-sync.json record's
 * `permanent_failures`, with anything malformed dropped: `{key: {sha, outcome,
 * at}}`, at most SKILL_FAILED_MAX entries, the newest kept.
 */
function rememberedSkillFailures(record) {
  const raw = record && record.permanent_failures;
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw)
    .filter((key) => {
      const f = raw[key];
      return (
        SKILL_KEY_RE.test(key) &&
        f &&
        typeof f === "object" &&
        typeof f.sha === "string" &&
        f.sha &&
        f.sha.length <= 200 &&
        SKILL_PERMANENT_OUTCOMES.indexOf(f.outcome) !== -1
      );
    })
    .sort((a, b) => String(raw[b].at || "").localeCompare(String(raw[a].at || "")))
    .slice(0, SKILL_FAILED_MAX)
    .forEach((key) => {
      out[key] = { sha: raw[key].sha, outcome: raw[key].outcome, at: String(raw[key].at || "") };
    });
  return out;
}

/**
 * Take this hour's sync slot, or return null when a sync already ran within
 * the hour (or the timestamp cannot be written). The slot is taken BEFORE any
 * request, so a failing or slow registry is asked at most once an hour too.
 * The re-read nonce keeps two Stops that raced for the slot from both running.
 * The remembered failures (L1) are carried over into the new record.
 */
function claimSkillSyncSlot(nowMs) {
  const file = skillsSyncStateFile();
  if (!file) return null;
  let prev = null;
  try {
    prev = JSON.parse(readTextBounded(file, 64 * 1024));
  } catch {
    prev = null;
  }
  const last = prev && typeof prev.last_attempt_at === "string" ? Date.parse(prev.last_attempt_at) : NaN;
  if (Number.isFinite(last) && last <= nowMs && nowMs - last < SKILLS_SYNC_INTERVAL_MS) return null;
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  if (pathKind(dir) !== "dir") return null;
  removeStaleSyncTemps(dir);
  const record = {
    v: 1,
    last_attempt_at: new Date(nowMs).toISOString(),
    nonce: require("crypto").randomBytes(8).toString("hex"),
    permanent_failures: rememberedSkillFailures(prev),
  };
  if (!writeFileAtomic(file, `${JSON.stringify(record)}\n`, dir)) return null;
  try {
    const back = JSON.parse(readTextBounded(file, 64 * 1024));
    return back && back.nonce === record.nonce ? { file, dir, record } : null;
  } catch {
    return null;
  }
}

/**
 * One bounded request to the skills API. The abort stays armed until the body
 * has been read (the #342 bounded-read rule), and a body larger than any real
 * answer is refused.
 */
async function skillsApiRequest(url, init, deadlineAt) {
  if (!CONSENT_OK) return { ok: false, reason: "consent_gate" };
  if (!TOKEN) return { ok: false, reason: "no_token" };
  if (deadlinePassed(deadlineAt)) return { ok: false, reason: "deadline" };
  const controller = new AbortController();
  const deadlineTimer = abortAtDeadline(controller, deadlineAt);
  try {
    const res = await fetch(url, Object.assign({}, init, { signal: controller.signal }));
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const declared = Number(res.headers && res.headers.get && res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > SKILLS_RESPONSE_MAX_CHARS) {
      return { ok: false, reason: "too_large" };
    }
    const text = await res.text();
    if (text.length > SKILLS_RESPONSE_MAX_CHARS) return { ok: false, reason: "too_large" };
    const body = JSON.parse(text);
    return body && typeof body === "object" ? { ok: true, body } : { ok: false, reason: "bad_body" };
  } catch (err) {
    return { ok: false, reason: controller.signal.aborted ? "deadline" : "network" };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/**
 * The list → compare → bundle → write pass. Fills `result`, and keeps `failures`
 * — the remembered permanent failures (L1), `{key: {sha, outcome, at}}` — up to
 * date. Never throws.
 */
async function runSkillSync(root, deadlineAt, result, failures) {
  if (pathKind(root) === "symlink") {
    result.reason = "skills_dir_linked";
    return;
  }
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const list = await skillsApiRequest(SKILLS_LIST_URL, { method: "GET", headers: auth }, deadlineAt);
  if (!list.ok) {
    result.reason = `list_${list.reason}`;
    return;
  }
  const rows = Array.isArray(list.body.skills) ? list.body.skills : [];
  const wanted = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
    const key = typeof row.skill_key === "string" ? row.skill_key : typeof row.key === "string" ? row.key : "";
    const sha = typeof row.sha === "string" ? row.sha : "";
    // A key must be one safe folder name by BOTH rules (so never a Windows
    // device name either). No sha — a registry that predates it — means there
    // is nothing to compare: skip.
    if (!SKILL_KEY_RE.test(key) || !safeSkillPathParts(key)) continue;
    if (seen.has(key) || !sha || sha.length > 200) continue;
    seen.add(key);
    result.listed += 1;
    // L1: a failure remembered at another sha is forgotten — the new sha is
    // asked for at once.
    if (failures[key] && failures[key].sha !== sha) delete failures[key];
    const info = inspectSkillFolder(root, key);
    if (info.kind === "ours" && info.marker.sha === sha) {
      result.current += 1;
      delete failures[key];
    } else if (info.kind === "missing" || info.kind === "ours" || info.kind === "adoptable") {
      // L1: never asked for again at the sha it failed at for good. It takes
      // no slot, so the skills after it get their turn.
      if (failures[key]) {
        result.skipped_failed += 1;
        continue;
      }
      if (wanted.length < SKILLS_SYNC_MAX_PER_RUN) wanted.push({ key, sha });
    } else {
      result.left_alone += 1;
    }
  }
  // A skill the registry no longer lists is forgotten with its failure.
  Object.keys(failures).forEach((key) => {
    if (!seen.has(key)) delete failures[key];
  });
  if (wanted.length === 0) return;

  const bundle = await skillsApiRequest(
    SKILLS_BUNDLE_URL,
    {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, auth),
      body: JSON.stringify({ keys: wanted.map((w) => w.key) }),
    },
    deadlineAt,
  );
  if (!bundle.ok) {
    result.reason = `bundle_${bundle.reason}`;
    result.failed += wanted.length;
    return;
  }
  const pending = new Map(wanted.map((w) => [w.key, w]));
  const skills = Array.isArray(bundle.body.skills) ? bundle.body.skills : [];
  const nowIso = new Date().toISOString();
  for (let i = 0; i < skills.length; i++) {
    // Nothing new starts once the budget is spent; a skill is a few local writes.
    if (deadlinePassed(deadlineAt)) {
      result.reason = "budget";
      break;
    }
    const s = skills[i] && typeof skills[i] === "object" ? skills[i] : {};
    const key = typeof s.key === "string" ? s.key : typeof s.skill_key === "string" ? s.skill_key : "";
    const want = pending.get(key);
    if (!want) continue; // only what was asked for, once each
    pending.delete(key);
    const sha = typeof s.sha === "string" && s.sha && s.sha.length <= 200 ? s.sha : want.sha;
    const outcome = writeRegistrySkill(root, key, sha, s.files, nowIso);
    if (outcome === "installed") result.installed += 1;
    else if (outcome === "updated") result.updated += 1;
    else if (outcome === "linked" || outcome === "foreign") result.left_alone += 1;
    else result.failed += 1;
    // L1: remember a permanent failure at the sha it failed at; a success
    // clears it. Anything else is transient and is simply asked for again.
    if (outcome === "installed" || outcome === "updated") delete failures[key];
    else if (SKILL_PERMANENT_OUTCOMES.indexOf(outcome) !== -1) {
      failures[key] = { sha, outcome, at: nowIso };
    }
  }
}

/**
 * ⛔ A MACHINE WHOSE SKILLS COME FROM A CONTROL-TOWER CHECKOUT IS NEVER SYNCED
 * (Opus rule, 2026-09-30). When any skill in `~/.claude/skills` is a symlink
 * whose target contains `/massmarket-ops-control-tower/skills/`, that checkout
 * is where this machine's skills come from (Rob's Mac, dobby), kept current by
 * the control tower's own sync. The Stop-time sync then does nothing at all —
 * no request, no write, no adoption — and records the skip in skills-sync.json.
 * Both forms the control tower's install makes count: the skill's folder as a
 * link, and a real folder whose SKILL.md is a link.
 */
const CONTROL_TOWER_SKILLS_MARK = "/massmarket-ops-control-tower/skills/";
/** The scan looks at no more than this many entries of `~/.claude/skills`. */
const CONTROL_TOWER_SCAN_MAX_ENTRIES = 5000;

/** Is `p` a symlink whose target names a control-tower checkout's skills folder? */
function linksIntoControlTower(p) {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return false;
    return String(fs.readlinkSync(p)).replace(/\\/g, "/").indexOf(CONTROL_TOWER_SKILLS_MARK) !== -1;
  } catch {
    return false;
  }
}

/** Does any skill under `root` link into a control-tower checkout? Never throws. */
function skillsComeFromControlTower(root) {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return false;
  }
  for (let i = 0; i < names.length && i < CONTROL_TOWER_SCAN_MAX_ENTRIES; i++) {
    const entry = path.join(root, names[i]);
    if (linksIntoControlTower(entry)) return true;
    if (pathKind(entry) === "dir" && linksIntoControlTower(path.join(entry, "SKILL.md"))) return true;
  }
  return false;
}

/**
 * The Stop-time top-up. Never throws, never blocks: at most once an hour, 4 s
 * at most, and silent on every outcome (the counts land in skills-sync.json).
 */
async function syncRegistrySkills() {
  try {
    if (!CONSENT_OK || !TOKEN) return;
    const startedAt = Date.now();
    const claude = homeClaudeDir();
    if (!claude) return;
    const claim = claimSkillSyncSlot(startedAt);
    if (!claim) return;
    const hardExitAt = HARD_EXIT_AT || startedAt + HARD_EXIT_DEFAULT_MS;
    const deadlineAt = Math.min(
      startedAt + SKILLS_SYNC_BUDGET_MS,
      hardExitAt - POST_TOOL_USE_SAVE_MARGIN_MS,
    );
    const result = {
      finished_at: null,
      listed: 0,
      installed: 0,
      updated: 0,
      current: 0,
      left_alone: 0,
      failed: 0,
      skipped_failed: 0,
      reason: null,
    };
    const failures = claim.record.permanent_failures;
    try {
      const root = path.join(claude, "skills");
      if (skillsComeFromControlTower(root)) {
        // The control-tower rule: nothing at all, and the skip on record.
        result.reason = "control_tower_checkout";
      } else {
        await runSkillSync(root, deadlineAt, result, failures);
      }
    } finally {
      result.finished_at = new Date().toISOString();
      writeFileAtomic(
        claim.file,
        `${JSON.stringify(
          Object.assign({}, claim.record, {
            permanent_failures: rememberedSkillFailures({ permanent_failures: failures }),
            last_result: result,
          }),
        )}\n`,
        claim.dir,
      );
    }
  } catch (err) {
    debugLog(`skill sync failed: ${err && err.message}`);
  }
}

async function handleStop(payload) {
  const sessionId = payload.session_id;
  const state = loadSessionState(sessionId);
  // ⛔ SESSION TITLE (0.11.4). The Stop line carries the thread's name too. When
  // the cache was older than 10 minutes this read the transcript, and the state
  // then holds a new title and read time that must be saved (below), or the next
  // event would read the file again.
  const titleReadAtBefore = state.session_title_read_at;
  SESSION_TITLE = sessionTitleFor(payload, state);
  const titleWasRead = state.session_title_read_at !== titleReadAtBefore;
  // ⛔ TURN ORIGIN (0.11.5). The Stop line says who started the turn that just
  // ended. A turn with no tool call reaches Stop with nothing kept for it, so
  // what this read finds is saved (below) like a newly read title.
  const turnOriginBefore = state.turn_origin;
  const turnPromptBefore = state.turn_origin_prompt_id;
  const turnChainBefore = state.turn_chain_origin;
  TURN_ORIGIN = rowOriginFor(payload, state);
  const turnOriginChanged =
    state.turn_origin !== turnOriginBefore ||
    state.turn_origin_prompt_id !== turnPromptBefore ||
    state.turn_chain_origin !== turnChainBefore;
  // ⛔ Move a pre-upgrade session's state home the first time Stop falls back
  // to it. Stop changes nothing else, so it used never to save — and a session
  // that only stopped went back to the old file on every run. Saved BEFORE the
  // POST: the hard exit can end this run while the POST is still waiting.
  if (
    titleWasRead ||
    turnOriginChanged ||
    (usedOlderSessionState(sessionId) && !homeSessionStateExists(sessionId))
  ) {
    saveSessionState(sessionId, state);
  }
  // ⛔ The skill top-up runs BESIDE the Stop line, not after it: the Stop POST
  // keeps its own 10 s timeout and may use all of the 6 s hard exit, while the
  // sync has its own 4 s budget inside it (SPEC v2 §2.5).
  await Promise.allSettled([
    postWorklog({
      contentMd: `🛑 Session ended. ${state.toolCallCount} tool call(s) streamed.`,
      source: "claude-code",
      declarations: declarationFields(sessionId, state, null),
    }),
    syncRegistrySkills(),
  ]);
}

async function handleSessionStart(payload) {
  // Warn-only verification (per spec: "warns/blocks if not" — we warn, since
  // the real enforcement is the server-side presence watchdog, not a local
  // block that a stripped-down settings.json could trivially bypass anyway).
  if (!TOKEN) {
    // ⛔ Member-facing copy, placed verbatim (2026-09-29). The warning points
    // members at the install guide (hook-install?guide=1).
    process.stderr.write(
      "[worklog-hook] No tracker token on this machine, so this session is not being recorded.\n" +
        "To fix it, open Claude Code in your client-work folder, start a new thread, and paste:\n" +
        "  Set up my Massmarket worklog hook. Follow https://onboarding-wizard.massmarket.ai/api/ext/hook-install?guide=1\n" +
        "First time on this computer? Ask Rob for a one-time install code before you paste it.\n",
    );
    return;
  }
  // Cheap self-check: confirm the hooks this script relies on are actually
  // present in a resolved settings.json, not just SessionStart. A member
  // could strip Stop/PostToolUse while leaving SessionStart to look clean.
  // Global installs run this hook from the USER-level settings.json
  // (<homedir>/.claude/settings.json) in an arbitrary cwd, so check the
  // repo-scoped file first (legacy) and fall back to the user-level file
  // (global install) — either one satisfying the check is a pass.
  try {
    const candidatePaths = [
      path.join(process.cwd(), ".claude", "settings.json"),
      path.join(os.homedir(), ".claude", "settings.json"),
    ];
    let checked = null;
    for (const settingsPath of candidatePaths) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        const hooks = settings.hooks || {};
        const hasPostToolUse = Array.isArray(hooks.PostToolUse) && hooks.PostToolUse.length > 0;
        const hasStop = Array.isArray(hooks.Stop) && hooks.Stop.length > 0;
        checked = { settingsPath, hasPostToolUse, hasStop };
        if (hasPostToolUse && hasStop) {
          checked = null; // found a fully-wired settings.json — nothing to warn about
          break;
        }
      } catch {
        /* this candidate doesn't exist or isn't valid JSON — try the next */
      }
    }
    if (checked) {
      process.stderr.write(
        `[worklog-hook] Tracking hooks look incomplete in ${checked.settingsPath} ` +
          `(PostToolUse=${checked.hasPostToolUse}, Stop=${checked.hasStop}). This session's ` +
          "activity may not be fully tracked. If this wasn't intentional, re-run the " +
          "global installer or restore the file from git.\n",
      );
    }
  } catch (err) {
    process.stderr.write(
      `[worklog-hook] Could not verify tracking hook installation: ${err && err.message}\n`,
    );
  }

  // ── Chips bridge: fetch + verify + inject. Entirely fail-open. ──────────
  let feed = null;
  try {
    const result = await fetchChipFeed();
    feed = result && result.ok ? result.payload : null;
    // ⛔ THE ONE FAILURE THE MEMBER MUST HEAR ABOUT. Silence is right for
    // "bridge off", "nothing pending", "no token" (already warned above) and a
    // transient HTTP error — none of those cost anything. A TIMEOUT does: the
    // server has already recorded the serve, so a chip has been spent on a
    // session that never saw it, and only the person at this keyboard can
    // report that the feed is slow. This is a constant string this hook wrote;
    // NOTHING from the payload is emitted, and nothing is injected into session
    // context — invariant 4 above still holds in full.
    if (result && !result.ok && result.reason === "timeout") {
      process.stderr.write(
        `[worklog-hook] Task chips: the feed request timed out after ${result.elapsedMs}ms. ` +
          "The server had probably already built and recorded it, so a chip you never saw " +
          "may stop being offered. Nothing is broken on your machine — please report this " +
          "in #mmai-it-support so the serve time gets looked at.\n",
      );
    }
  } catch (err) {
    feed = null;
    debugLog(`chip bridge SessionStart failed: ${err && err.stack}`);
  }

  // ── Task announcing (SPEC-task-announcing-v2 §2.1) ─────────────────────
  // ⛔ The tracking instruction goes FIRST, on EVERY SessionStart the consent
  // gate lets through — the feed off, failed or empty included. It is the
  // verified feed's `session_text`, or this file's own copy; the chip text
  // below comes from the verified feed and from nothing else. (A terminal
  // list may put the built-in copy first instead, so that "start task
  // <number>" stays inside the preview — see renderTerminalTasks.)
  let instruction = trackingInstructionFor(feed);
  let block = "";
  let tail = "";
  let deliveries = [];
  if (feed) {
    try {
      if (isDesktopSession()) {
        // Desktop: the chip block, byte-identical to before, below the instruction.
        block = renderChipContext(feed);
      } else {
        // Every other surface: the text list (SPEC-terminal-chip-fallback).
        const text = renderTerminalTasks(feed, instruction);
        instruction = text.instruction;
        block = text.shortList;
        tail = text.packets;
        deliveries = text.deliveries;
      }
    } catch (err) {
      // A render that fails injects no chip text at all — never half a block.
      block = "";
      tail = "";
      deliveries = [];
      debugLog(`chip render failed: ${err && err.stack}`);
    }
  }
  const emitted = await emitSessionContext(composeSessionContext(instruction, block, tail));

  if (feed && block) {
    // ⛔ Record what was ACTUALLY served, from the same verified payload that
    // drove the render. This set is the cross-check that makes the PostToolUse
    // `delivered_chip` ack deterministic instead of a guess — see the
    // producer block above. Written AFTER the render so a render failure can
    // never leave us acking chips nobody was shown.
    recordServedChips(payload && payload.session_id, servedChipsFromPayload(feed));
  }
  if (deliveries.length > 0 && emitted) {
    // Terminal: the list is the surface, so its delivery to the session IS the
    // delivery — recorded only once the context write is confirmed.
    await recordSessionDeliveries(payload && payload.session_id, deliveries, postToolUseDeadline());
  }
}

// ───────────────────────────────────────────────────────────────────────────
// UNTRACKED-FOLDER NUDGE (2026-09-30; Opus spec, approved by Rob).
//
// Claude Desktop suggests the member's HOME folder for a new session, and the
// installer refuses the home folder, its ancestors, system roots and the bare
// user-library folders (Desktop, Documents, Downloads, …) as tracked folders.
// So a session started in the default folder is refused by the consent gate,
// and a refused session is silent by design: nobody found out.
//
// This is the one thing a refusal may produce, and it never leaves the machine.
// At SessionStart ONLY, when ALL of these hold:
//   1. the hook has a token, and consent.json allows at least one folder;
//   2. the consent gate does not record the session's folder (the payload cwd,
//      else process.cwd());
//   3. that folder is a place the tracker can NEVER record under the
//      installer's rules: the home directory itself, an ancestor of it, one of
//      REFUSED_ROOTS, or a bare REFUSED_HOME_CHILDREN folder directly under home;
//   4. the session is interactive: CLAUDE_CODE_ENTRYPOINT does not start with
//      "sdk" (the scheduled runners are sdk-cli);
// the session's additionalContext is UNTRACKED_FOLDER_NUDGE, filled, and nothing
// else. Every other refused folder, and every other event, is exactly as silent
// as it was.
//
// ⛔ PRIVACY. This path makes NO network request, writes NO file, posts NO
// worklog row, and prints nothing but the SessionStart JSON. No debug log
// either: debugLog writes into the refused folder's STATE_DIR, which is the very
// record the gate exists to prevent. It reads consent.json, and asks the gate
// about the payload's folder only when that is not the folder the gate just
// checked.
//
// ⛔ NOT A RECORDING PREDICATE. isNeverTrackedFolder() decides whether to SHOW a
// line, never whether to RECORD one. The generated consent gate above stays the
// single answer to "may this be recorded"; this block runs only after it has
// said no, and condition 2 is the gate's own answer.
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⛔ VERBATIM COPY of the installer's REFUSED_ROOTS (src/lib/ext/hook-setup-source.ts,
 * beside refuseAllowReason), in its compare form. The hook ships as one
 * downloaded file and cannot import it, so
 * tests/unit/worklog-hook-untracked-nudge.unit.test.ts fails if the copies drift.
 */
const REFUSED_ROOTS = [
  "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/media",
  "/mnt", "/net", "/network", "/opt", "/private", "/proc", "/root", "/run",
  "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var",
  "/users", "/volumes", "/applications", "/library", "/system",
  "c:/", "c:/users", "c:/windows", "c:/programdata", "c:/system32",
  "c:/program files", "c:/program files (x86)",
];

/** ⛔ VERBATIM COPY of the installer's REFUSED_HOME_CHILDREN: bare user-library folders. */
const REFUSED_HOME_CHILDREN = [
  "desktop", "documents", "downloads", "library", "movies", "music",
  "pictures", "public", "videos", "onedrive", "applications",
];

/** ⛔ VERBATIM COPY of the installer's compare form: forward slashes, lower case, no trailing separator. */
function normForCompare(p) {
  let s = String(p == null ? "" : p).replace(/\\/g, "/").toLowerCase();
  while (s.length > 1 && s.slice(-1) === "/") s = s.slice(0, -1);
  return s;
}

/**
 * Condition 3: is `folder` a place the tracker can never record, under the
 * installer's rules? The home directory itself, an ancestor of it, one of
 * REFUSED_ROOTS, or a bare REFUSED_HOME_CHILDREN folder directly under home:
 * the same four comparisons refuseAllowReason() makes, in the same compare
 * form, and nothing more.
 *
 * Pure: homedir and platform are parameters, so the win32 cases are testable on
 * any machine. Never throws; anything it cannot read is "no".
 */
function isNeverTrackedFolder(folder, homedir, platform) {
  try {
    if (typeof folder !== "string" || !folder || typeof homedir !== "string" || !homedir) {
      return false;
    }
    const P = platform === "win32" ? path.win32 : path.posix;
    if (!P.isAbsolute(folder)) return false;
    const p = normForCompare(P.resolve(folder));
    const home = normForCompare(homedir);
    if (p === home) return true;
    if (home.indexOf(p + "/") === 0) return true;
    if (REFUSED_ROOTS.indexOf(p) !== -1) return true;
    for (let i = 0; i < REFUSED_HOME_CHILDREN.length; i++) {
      if (p === home + "/" + REFUSED_HOME_CHILDREN[i]) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * A folder in the tracker's display form. macOS and Linux: normalizeHomedir,
 * the helper every stored line goes through, so the home folder is "~" and its
 * Desktop "~/Desktop". Windows: the plain path, e.g. C:\Users\nayan.
 *
 * normalizeHomedir rewrites the home path wherever it appears in a line of text,
 * so its answer is used only when it rewrote the START of the path: "~" or
 * "~/…". Anything else ("/Volumes/Backup~/x") falls back to the plain path.
 * Never throws.
 */
function trackerFolderDisplay(folder, homedir, platform) {
  try {
    const P = platform === "win32" ? path.win32 : path.posix;
    const plain = P.resolve(String(folder));
    if (platform === "win32") return plain;
    const shown = normalizeHomedir(plain, homedir, platform);
    return shown === "~" || String(shown).indexOf("~/") === 0 ? shown : plain;
  } catch {
    return String(folder == null ? "" : folder);
  }
}

/**
 * <work folder>: one folder as itself; two as "A or B"; more than two as the
 * first two, then " or another folder you chose".
 */
function joinWorkFolders(folders) {
  const list = (Array.isArray(folders) ? folders : []).filter((f) => typeof f === "string" && f);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} or ${list[1]}`;
  return `${list[0]} or ${list[1]} or another folder you chose`;
}

/**
 * VERBATIM — Opus, 2026-09-30. Placed byte for byte: do not reflow, re-punctuate
 * or improve it. <folder> and <work folder> are filled by untrackedFolderNudgeText.
 */
const UNTRACKED_FOLDER_NUDGE = `Massmarket time tracking: this session started in <folder>, which the tracker never records, so nothing in this session is counted. If this is Massmarket client work, tell the person once, in one sentence: "This session isn't being tracked. For client work, start the session in <work folder> instead." Then carry on with what they asked.`;

/**
 * The nudge with both placeholders filled in ONE pass, through a replacer
 * function: a folder name is never read as a placeholder or as a `$` pattern.
 */
function untrackedFolderNudgeText(folder, workFolder) {
  return UNTRACKED_FOLDER_NUDGE.replace(/<folder>|<work folder>/g, (m) =>
    m === "<folder>" ? String(folder) : String(workFolder),
  );
}

/**
 * Condition 4: a person is at this session. CLAUDE_CODE_ENTRYPOINT values that
 * start with "sdk" (sdk-cli, the scheduled runners; sdk-ts; sdk-py) are
 * automated. claude-desktop, cli and an unset variable are interactive.
 */
function isInteractiveSession(env) {
  const e = env || process.env;
  const entry = typeof e.CLAUDE_CODE_ENTRYPOINT === "string" ? e.CLAUDE_CODE_ENTRYPOINT : "";
  return entry.indexOf("sdk") !== 0;
}

/**
 * The Claude app's own folders: the scratch workspaces its "no folder" sessions
 * run in. They can sit on the tracked list (so those sessions are recorded), but
 * no person ever picks one to start work in, so the nudge never names them
 * (Opus, 2026-09-30). Compared in normForCompare form, so `~/…`, `\\` and case
 * all match.
 */
function isClaudeAppFolder(p) {
  const s = normForCompare(p);
  return /\/library\/application support\/claude(\/|$)/.test(s) ||
    /\/appdata\/(roaming|local)\/(anthropicclaude|claude)(\/|$)/.test(s) ||
    /\/\.config\/claude(\/|$)/.test(s);
}

/**
 * The filled nudge for one refused SessionStart, or null. Pure: every input is
 * a parameter, so the whole decision and the exact text are testable per
 * platform. The caller establishes the token and the gate's refusal.
 *
 * @param {{folder: string, homedir: string, platform: string, allow: string[], env: object}} input
 *   `allow` is the consent gate's own list (readConsentConfig().allow), so the
 *   folders named are the ones the gate records, in the gate's order.
 * @returns {string|null}
 */
function untrackedFolderNudgeFor(input) {
  try {
    const i = input || {};
    const platform = i.platform || process.platform;
    if (!isInteractiveSession(i.env)) return null;
    const allow = (Array.isArray(i.allow) ? i.allow : []).filter((a) => typeof a === "string" && a);
    if (allow.length === 0) return null;
    // Only folders a person would start work in are named; with none left, say nothing.
    const workFolders = allow.filter((a) => !isClaudeAppFolder(a));
    if (workFolders.length === 0) return null;
    if (!isNeverTrackedFolder(i.folder, i.homedir, platform)) return null;
    const folder = trackerFolderDisplay(i.folder, i.homedir, platform);
    const work = joinWorkFolders(workFolders.map((a) => trackerFolderDisplay(a, i.homedir, platform)));
    if (!folder || !work) return null;
    return untrackedFolderNudgeText(folder, work);
  } catch {
    return null;
  }
}

/**
 * Write the nudge as SessionStart additionalContext: emitSessionContext's JSON
 * shape and its flush discipline. It resolves on the write callback, because
 * stdout is an asynchronous pipe on win32 and process.exit() does not flush it;
 * a 1 s unref'd guard keeps a wedged pipe from holding the session.
 *
 * Deliberately NOT emitSessionContext itself: its catch writes a debugLog line,
 * and debugLog writes into the refused folder's STATE_DIR.
 */
function emitUntrackedFolderNudge(text) {
  return new Promise((resolve) => {
    try {
      const line = `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: text,
        },
      })}\n`;
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const guard = setTimeout(() => finish(false), 1000);
      if (typeof guard.unref === "function") guard.unref();
      process.stdout.write(line, (err) => {
        clearTimeout(guard);
        finish(!err);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Called from the consent gate's refusal branch in main(), on EVERY event; it
 * returns at once for anything but SessionStart. Never throws, never logs, and
 * the only output it can produce is the one JSON line on stdout.
 */
async function nudgeUntrackedSession(payload) {
  try {
    const p = payload && typeof payload === "object" ? payload : {};
    if (p.hook_event_name !== "SessionStart") return;
    if (!TOKEN) return;
    let gateCwd = "";
    try {
      gateCwd = process.cwd();
    } catch {
      gateCwd = "";
    }
    const folder = typeof p.cwd === "string" && p.cwd ? p.cwd : gateCwd;
    if (!folder) return;
    const homedir = os.homedir();
    // The two checks that need no file, before the one that reads consent.json.
    if (!isInteractiveSession(process.env)) return;
    if (!isNeverTrackedFolder(folder, homedir, process.platform)) return;
    const text = untrackedFolderNudgeFor({
      folder,
      homedir,
      platform: process.platform,
      allow: readConsentConfig().allow,
      env: process.env,
    });
    if (!text) return;
    // Condition 2 for a folder the gate has not been asked about: the payload
    // named a different folder from the process.cwd() the gate just refused.
    if (folder !== gateCwd && evaluateConsent({ cwd: folder }).allowed) return;
    await emitUntrackedFolderNudge(text);
  } catch {
    /* No nudge, and never a line saying why. */
  }
}

/**
 * `node worklog-hook.js --consent-*` — the member-owned WRITE path.
 *
 * ⛔ Reached only when argv carries a `--consent` flag. Claude Code invokes this
 * script with no arguments at all, so the hook path and the management path can
 * never be mistaken for one another.
 *
 * ⛔ THE SAME POLICY AT BOTH ENDS. This writes through classifyRoot, the exact
 * function the gate reads through, so a member cannot record a root the gate
 * would refuse and cannot be refused a root the writer accepted. `F:\MMAI` and
 * `D:\Massmarket` are real work roots on this team and are accepted; `C:\`,
 * `C:\Users\<name>`, `/Users`, `/home/<name>`, `~`, `/`, `/tmp`, `/var` and
 * anything containing the home directory are not.
 *
 * Output is deliberately mechanical: paths and reason codes. The sentences a
 * member reads about what recording means are authored elsewhere.
 */
function consentCli(argv) {
  const cmd = String(argv[0] || "");
  const args = argv.slice(1);
  const emit = (line) => process.stdout.write(line + "\n");
  const usage =
    "usage: node worklog-hook.js [--consent-status | --consent-allow <path>... | --consent-remove <path>...]";

  if (cmd === "--consent-status") {
    const state = readConsentConfig();
    emit("config: " + (consentConfigPath() || "(no home directory)"));
    emit("state: " + state.reason);
    (state.allow || []).forEach((root) => emit("allow: " + root));
    (state.refused || []).forEach((r) => emit("refused: " + String(r.input) + " (" + r.rule + ")"));
    let cwd = "";
    try {
      cwd = process.cwd();
    } catch {
      cwd = "";
    }
    emit("cwd: " + (cwd || "(unavailable)"));
    const verdict = evaluateConsent();
    emit("recording: " + (verdict.allowed ? "yes" : "no") + " (" + verdict.reason + ")");
    return verdict.allowed ? 0 : 1;
  }

  if (cmd === "--consent-allow" || cmd === "--consent-remove") {
    if (args.length === 0) {
      emit(usage);
      return 2;
    }
    const current = readConsentConfig();
    let next;
    if (cmd === "--consent-allow") {
      next = (current.allow || []).concat(args);
    } else {
      // Removal compares under the SAME case rule the matcher uses: folded
      // everywhere except linux, where two spellings really are two folders.
      const fold = (v) =>
        process.platform === "linux" ? String(v) : String(v).toLowerCase();
      const drop = [];
      args.forEach((a) => {
        const n = normalizeRoot(a);
        if (n) drop.push(fold(n));
      });
      next = (current.allow || []).filter((r) => drop.indexOf(fold(r)) === -1);
    }
    let result;
    try {
      result = writeConsentConfig(next);
    } catch (err) {
      emit("error: " + (err && err.message ? err.message : String(err)));
      return 1;
    }
    emit("config: " + result.file);
    result.allow.forEach((root) => emit("allow: " + root));
    result.refused.forEach((r) => emit("refused: " + String(r.input) + " (" + r.rule + ")"));
    return result.refused.length > 0 ? 1 : 0;
  }

  emit(usage);
  return 2;
}

/** VERBATIM — SPEC v2 §2.2: what `--task` prints for an empty or whitespace label. */
const TASK_NOT_NOTED_LINE =
  'Task not noted: give a few words, for example --task "Phase 1 nurture sequence copy".';

/** `--task` or `--task=<label>` as the first argument. */
function isTaskCliArg(arg) {
  const a = String(arg == null ? "" : arg);
  return a === "--task" || a.indexOf("--task=") === 0;
}

/**
 * `node worklog-hook.js --task "<label>"` — SPEC v2 §2.2. The line it prints,
 * and nothing more: no network, no file writes. The declaration itself is
 * recorded by the PostToolUse run for the shell tool call that ran this, from
 * the same normalised label printed here.
 */
function taskCliLine(argv) {
  const first = String(argv[0] == null ? "" : argv[0]);
  const raw = first === "--task" ? argv[1] : first.slice("--task=".length);
  const label = normalizeTaskLabel(raw);
  return label ? `Task noted: ${label}` : TASK_NOT_NOTED_LINE;
}

/**
 * The hard-exit budget for the event in this payload: HARD_EXIT_SESSION_START_MS
 * for SessionStart, whose chip-feed request alone may use 10 s, and
 * HARD_EXIT_DEFAULT_MS for every other event — including a payload whose event
 * cannot be read at all.
 */
function hardExitMsFor(raw) {
  try {
    const parsed = safeJsonParse(raw);
    return parsed && parsed.hook_event_name === "SessionStart"
      ? HARD_EXIT_SESSION_START_MS
      : HARD_EXIT_DEFAULT_MS;
  } catch {
    return HARD_EXIT_DEFAULT_MS;
  }
}

async function main() {
  // ⛔ Management path first. Only a `--consent*` argv reaches it, and the hook
  // itself is always invoked with no arguments.
  const argv = process.argv.slice(2);
  if (argv.length > 0 && String(argv[0]).indexOf("--consent") === 0) {
    // ⛔ `process.exitCode` + return, NOT process.exit(). stdout to a PIPE is
    // asynchronous in node, and process.exit() truncates whatever has not
    // flushed — which is exactly how a member piping `--consent-status` into
    // anything would lose the `refused:` line that told them why.
    //
    // ⛔ The try keeps this path's non-zero exit on an internal error. It is not
    // a Claude Code event, so the exit-0 backstops at the top and bottom of this
    // file are not meant for it: a thrown error here would otherwise reach the
    // `.catch` on main() and exit 0, as if the command had worked.
    try {
      process.exitCode = consentCli(argv);
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  // ⛔ `--task` (SPEC v2 §2.2) — run by the THREAD, in its own shell, to declare
  // its task. It prints one line and exits 0, always: no stdin, no network, no
  // file. The PostToolUse run for that shell call does the recording.
  // `process.exitCode` + return for the same flush reason as above.
  if (argv.length > 0 && isTaskCliArg(argv[0])) {
    try {
      process.stdout.write(`${taskCliLine(argv)}\n`);
    } catch {
      /* a closed stdout is not a reason to fail */
    }
    process.exitCode = 0;
    return;
  }

  const raw = readStdin();

  // ═════════════════════════════════════════════════════════════════════════
  // ⛔ THE HARD EXIT (2026-09-29). Armed before anything else on the event
  // path can wait on the network, a child process or a pipe: whatever happens
  // below, this process is gone HARD_EXIT_MS from now, with exit code 0. It is
  // unref'd, so it never keeps an otherwise finished process alive.
  //
  // The budget depends on the event, so it is read from the payload first.
  // hardExitMsFor() parses its own copy because nothing may run between the
  // `payload` parse below and the consent gate — see the gate's own comment.
  // ═════════════════════════════════════════════════════════════════════════
  const HARD_EXIT_MS = hardExitMsFor(raw);
  HARD_EXIT_AT = Date.now() + HARD_EXIT_MS;
  setTimeout(() => process.exit(0), HARD_EXIT_MS).unref();

  const payload = safeJsonParse(raw) || {};

  // ═════════════════════════════════════════════════════════════════════════
  // ⛔ THE CONSENT GATE. FIRST STATEMENT AFTER THE PARSE, AND NOT ONE LINE
  //    LATER.
  //
  // ⛔ WHY THE POSITION IS LOAD-BEARING. STATE_DIR is
  // `<homedir>/.claude/mm-hooks/state/<key>/`, with <key> derived from this
  // cwd. Gating AFTER ensureStateDir() would create a state directory and a
  // debug log for the very folder the member told us never to record — a
  // record that they worked there, even though nothing was ever uploaded.
  // Parse, gate, and only then touch a disk.
  //
  // ⛔ WHY IT IS HERE AND NOT INSIDE postWorklog. There are TWO exfiltration
  // paths, not one: postWorklog (which carries content_md AND a sibling
  // `title`) and postChipEvent, a separate function reached from a separate
  // branch of the dispatch below. A gate inside postWorklog would leave
  // postChipEvent wide open. This line is the one place both cross; CONSENT_OK
  // re-asserts it at each sender.
  //
  // ⛔ DENIAL IS SILENT AND TOTAL. Not a redacted row, not a count, not a
  // "skipped" beacon, not a debug line — debugLog writes into STATE_DIR, so
  // logging the denial would itself be the breach, and an append-per-tool-call
  // denial log IS a count of a folder the member excluded.
  // `node worklog-hook.js --consent-status` is how a member finds out why.
  // The one exception stays on this machine: the SessionStart nudge for a
  // folder the tracker can never record (nudgeUntrackedSession, below).
  //
  // ⛔ FAIL CLOSED, ABSOLUTELY. Missing, empty, zero-byte, corrupt,
  // wrong-version, unreadable, not-an-array, every-root-refused, unresolvable
  // cwd — all of them land here with allowed=false. There is no default
  // allowlist and no fallback to prior behaviour.
  // ═════════════════════════════════════════════════════════════════════════
  const consent = evaluateConsent();
  if (!consent.allowed) {
    // ⛔ UNTRACKED-FOLDER NUDGE (2026-09-30). At SessionStart only, a session
    // started where the tracker can never record (the home folder Claude
    // Desktop suggests, Desktop, Downloads, a system root, …) gets one line of
    // its own session context saying so. No request, no file, no row, nothing
    // on stderr; every other event and every other refused folder exits
    // exactly as before. See the UNTRACKED-FOLDER NUDGE block.
    await nudgeUntrackedSession(payload);
    process.exit(0);
  }
  CONSENT_OK = true;
  // ⛔ Keep what the gate computed instead of collapsing it to a boolean —
  // design §1.3: "#196 shipped a labelled project signal and discarded it one
  // line later." The gate's position, order and fail-closed semantics above
  // are untouched: this reads its answer, it does not change it. Still before
  // ensureStateDir() — nothing here touches the disk.
  CONSENT_ROOT = typeof consent.root === "string" && consent.root ? consent.root : null;
  let sessionCwd = "";
  try {
    sessionCwd = process.cwd();
  } catch {
    sessionCwd = "";
  }
  CONSENT_CWD_REL = CONSENT_ROOT ? cwdRelativeToRoot(CONSENT_ROOT, sessionCwd) : null;

  const event = payload.hook_event_name || "";
  // Kept in this session's declarations record so the prune can tell whether
  // Claude Code could still resume it (see DECLARATION_STATE_DIR). Never sent.
  HOOK_TRANSCRIPT_PATH = transcriptPathKept(payload.transcript_path);

  ensureStateDir();
  pruneOldState(event);

  try {
    if (event === "PostToolUse") {
      await handlePostToolUse(payload);
    } else if (event === "Stop") {
      await handleStop(payload);
    } else if (event === "SessionStart") {
      await handleSessionStart(payload);
    } else if (event === "SubagentStart") {
      handleSubagentStart(payload);
    }
  } catch (err) {
    debugLog(`unhandled error for event=${event}: ${err && err.stack}`);
  }

  // Never block or fail the session — always exit clean.
  process.exit(0);
}

// ⛔ A rejection out of main() exits 0 like every other path. See the
// backstops at the top of this file.
main().catch(() => process.exit(0));
