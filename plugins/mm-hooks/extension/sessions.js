// sessions.js — the Claude Code sessions block and the "Change" task picker
// (0.11.3; its own always-visible block, up to six sessions, since 0.11.4).
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ WHAT THIS IS
// ═══════════════════════════════════════════════════════════════════════════════
//
// GET /api/ext/health carries `claude_sessions`: the member's Claude Code sessions
// that wrote a worklog row in the last 30 minutes, newest first — at most 6 from a
// 0.11.4 server, at most 3 from an older one. Each names the client its thread
// declared (the <client>-project skill it loaded), the task it declared
// (`worklog-hook.js --task "<label>"`) or the one the member picked here, the
// folder it is working in (`root_name`) and, from a 0.11.4 server, the thread's
// own name (`session_title`). Each session's Change opens a small picker that
// records a member override with POST /api/ext/task-override. (Build spec v2
// §3.3–3.5 and §4, Opus 2026-09-30; SPEC-tracker-0.11.4 §2.1–2.2, Opus 2026-10-02.)
//
// ⛔ 0.11.4 — THE SESSIONS ARE THEIR OWN BLOCK, VISIBLE WITHOUT OPENING ANYTHING.
// Through 0.11.3 the lines sat inside the health strip's <details>, which stays
// shut on a healthy install, and at most two were drawn. The block is: one heading,
// then two lines per session (the thread's name; its client and task, and the
// folder), then one muted line naming the folders being recorded — that last line
// only while the hook is recording. With no session and no folders to name, nothing
// is drawn at all. Since fix round 1 (Opus, 2026-10-02) the block sits BELOW the
// controls, after the next-up line: where is each surface's business (popup.js
// placeSessions(), panelapp.js), not this file's.
//
// ⛔ WHO OWNS WHAT. This file owns the copy, the calls and the decisions; panelui.js
// owns only the DOM — the same split hours.js and panelui.js already use. No
// `chrome.*` at module scope (nor in the one helper it takes from common.js), so
// `node --test verify/claude-sessions.test.mjs` imports it directly.
//
// ⛔ CAPTURE ONLY. Nothing here edits a past row or moves recorded time. The server
// applies an override to NEW rows from that session (spec §3.2), and the saved
// sentence says exactly that and nothing more.

// 0.11.4 fix round 1 — the bidirectional controls a displayed name is cleaned of
// (one copy, in common.js, shared with the running timers' names).
import { stripBidiControls } from './common.js';

// ─────────────────────────────────────────────────────────────────────────────
// COPY
// ─────────────────────────────────────────────────────────────────────────────

// ⛔ EVERY STRING BELOW IS OPUS'S, placed VERBATIM. The picker's six (`change` to
// `saveFailed`) are build spec v2 §4 (2026-09-30), unchanged. The other eight are
// SPEC-tracker-0.11.4 §2.1–2.2 (2026-10-02): the block's heading, the name a
// session with no thread name is given, the four client-and-task sentences (the
// 0.11.3 four without their "Claude Code: " lead, which the heading now carries),
// the folder suffix and the folders line. Each em dash is U+2014 with one space
// either side, the dot in the folder suffix is U+00B7 with one space either side,
// and the apostrophe in "Couldn't" is ASCII. A new member-facing string takes the
// same route — authored first, then placed — and is never written inline here or
// in panelui.js.
//
// The line templates take `{client}` and `{task}` (`lineNoClientWithTask` takes
// only `{task}`, `lineNoClient` neither), filled in ONE pass by sessionLineText()
// so a client name or a task that happens to contain "{task}", "{client}" or a
// `$&` is never substituted a second time. `folderSuffix` takes `{folder}` and
// `recordingFrom` takes `{roots}`, each filled once with a function replacer.
export const SESSION_COPY = Object.freeze({
  blockHeading: 'Claude Code sessions',
  titleFallback: 'Claude Code session',
  lineWithTask: '{client} — {task}',
  lineNoTask: '{client} — no task declared yet',
  lineNoClientWithTask: 'client not declared yet — {task}',
  lineNoClient: 'client not declared yet',
  folderSuffix: ' · in {folder}',
  recordingFrom: 'Recording from: {roots}',
  change: 'Change',
  pickerHeading: 'Pick the task this session is working on',
  typeLabel: 'Or type it',
  save: 'Save',
  saved: 'Saved. New activity from this session is recorded under this task.',
  saveFailed: "Couldn't save. Try again in a minute.",
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMITS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How many sessions the block draws. 0.11.4 §2.1: six, which is also the most a
 * 0.11.4 server sends (an older one sends at most three, and all three are drawn).
 */
export const MAX_SESSION_LINES = 6;
/** Spec §3.4: a label is at most 120 characters on the server. */
export const TASK_LABEL_MAX = 120;
/** Spec §3.5: the server returns at most 12 candidates. */
export const MAX_CANDIDATES = 12;
/**
 * How long Save waits before saying it could not save. apiRequest() has no abort
 * signal, so a hung request would otherwise hold the button disabled for as long
 * as the socket stays open. A save that lands after this is still recorded; the
 * worst case is a second, identical override row, and the newest row wins.
 */
export const SAVE_TIMEOUT_MS = 10000;

/** The server's session_id alphabet (spec §3.2); the ref is its first 8 chars. */
const SESSION_REF_RE = /^[A-Za-z0-9_-]{1,100}$/;

export const TASK_OVERRIDE_PATH = '/api/ext/task-override';
export const TASK_CANDIDATES_PATH = '/api/ext/task-candidates';

// ─────────────────────────────────────────────────────────────────────────────
// DECISIONS
// ─────────────────────────────────────────────────────────────────────────────

/** A single line of text with its runs of whitespace collapsed; '' otherwise. */
function oneLine(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

export function isSessionRef(v) {
  return typeof v === 'string' && SESSION_REF_RE.test(v);
}

/** `s` cut to at most `max` UTF-16 units on a code point boundary, then trimmed. */
function capUnits(s, max) {
  if (s.length <= max) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trim();
}

/**
 * A task label as it is shown and sent: one line, trimmed, and at most
 * TASK_LABEL_MAX UTF-16 units (what the input's maxlength counts), cut on a code
 * point boundary so an emoji is never split in half. '' when nothing is left.
 */
export function normalizeTaskLabel(v) {
  return capUnits(oneLine(v), TASK_LABEL_MAX);
}

/**
 * A thread name as it is shown: control characters and bidirectional controls
 * dropped, one line, trimmed. '' for anything that is not a string, and for a name
 * with nothing in it.
 *
 * ⛔ UNTRUSTED FREE TEXT, AND DISPLAY TEXT ONLY (Opus, 2026-10-02). A thread name
 * came off a member's machine. The server scrubs it, and this still treats it as
 * something that can hold anything: it is only ever handed to `textContent` and
 * the `title` attribute (panelui.js sessionControl), never to markup; nothing
 * reads a client or a task out of it; and it is never sent anywhere.
 *
 * ⛔ NOT CUT HERE. However long it is, the block shows it on ONE line and the CSS
 * cuts it with an ellipsis — the same rule for a 40-character name and a
 * 400-character one — while the element's `title` keeps the whole name.
 */
export function normalizeSessionTitle(v) {
  if (typeof v !== 'string') return '';
  // C0 and C1 controls become a space, so words either side of one stay apart. A
  // bidirectional control is removed outright (fix round 1): one U+202E would turn
  // the rest of the name around on screen.
  return oneLine(stripBidiControls(v).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '));
}

/**
 * A folder name as it is shown — a session's `root_name`, and each of the hook
 * verdict's `recent_roots`: one line, trimmed, without bidirectional controls (a
 * U+202E could make one folder read as another). '' for anything that is not a
 * string, and for a name with nothing in it. The ONE normaliser a folder name passes
 * through, wherever it is read (claudeSessionsFrom, sessionLineText,
 * recordingFromText, and panelui.js verdictRoots for the strip's own sentence).
 */
export function normalizeFolderName(v) {
  return typeof v === 'string' ? oneLine(stripBidiControls(v)) : '';
}

/**
 * The sessions to draw, from a fetchHealth() envelope.
 *
 * ⛔ ONLY A FRESH ANSWER COUNTS — the rule hookSetupState() already applies to the
 * hook line. fetchHealth() answers a FAILED refresh with the last cached payload,
 * flagged `error`, with no age bound; drawing sessions from it would name a task
 * from any point in the past under a hook line that says "Can't check right now."
 *
 * @returns {null|Array<{ref, title, client, projectId, task, taskSource, lastActivityAt, rootName}>}
 *   null  — no fresh answer: draw nothing, and FORGET nothing (a picker a member
 *           is using survives a failed re-read);
 *   []    — a fresh answer with no sessions (or an older server that does not send
 *           the key): draw nothing;
 *   [..]  — at most MAX_SESSION_LINES sessions, in the server's order (newest
 *           first), without duplicates or refs the server could not have sent.
 *           `title` is the thread's name; `null` when the server sent none (every
 *           server before 0.11.4, and a thread with no name), which the block
 *           names SESSION_COPY.titleFallback; and '' when it sent a name with
 *           nothing in it — see sessionTitleText().
 */
export function claudeSessionsFrom(health) {
  if (!health || typeof health !== 'object' || health.error) return null;
  const data = health.data;
  if (!data || typeof data !== 'object') return null;
  const list = data.claude_sessions;
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (out.length >= MAX_SESSION_LINES) break;
    if (!s || typeof s !== 'object') continue;
    const ref = typeof s.session_ref === 'string' ? s.session_ref.trim() : '';
    if (!isSessionRef(ref) || seen.has(ref)) continue;
    seen.add(ref);
    out.push({
      ref,
      title: typeof s.session_title === 'string' ? normalizeSessionTitle(s.session_title) : null,
      client: oneLine(s.client_name),
      projectId: typeof s.project_id === 'string' && s.project_id.trim() ? s.project_id.trim() : null,
      task: normalizeTaskLabel(s.task_label),
      taskSource: typeof s.task_source === 'string' ? s.task_source : null,
      lastActivityAt: typeof s.last_activity_at === 'string' ? s.last_activity_at : null,
      rootName: normalizeFolderName(s.root_name),
    });
  }
  return out;
}

/**
 * Line 1 of a session — the thread's name:
 *
 *   the server sent a name          that name (one clean line; never cut here)
 *   the server sent none            exactly SESSION_COPY.titleFallback
 *   it sent a name with nothing in  '' — NO line 1: the session is drawn as its
 *   it (only whitespace / controls) client-and-task line alone (Opus, 2026-10-02)
 *
 * ⛔ The third row is not the second. "No name" is every older server and every
 * thread that has not been named, and the block says so with the fallback. A
 * name that is present and blank is not something a server that follows the
 * contract sends (it stores no name instead), so nothing is invented for it and
 * no empty line is drawn — the row is whole either way.
 */
export function sessionTitleText(session) {
  const title = session ? session.title : null;
  if (typeof title !== 'string') return SESSION_COPY.titleFallback;
  return normalizeSessionTitle(title);
}

/**
 * Line 2 of a session — its client and task, one of four sentences and nothing
 * else, then the folder it is working in when the server names one:
 *
 *   client + task        "<client> — <task>"
 *   client, no task      "<client> — no task declared yet"
 *   no client + task     "client not declared yet — <task>"
 *   no client, no task   "client not declared yet"
 *   …with a root_name    the sentence + " · in <folder>"
 *
 * ⛔ No client + a task is the fourth shape. §4 gave three; Opus added this one on
 * 2026-09-30. Before it, a session that noted its task before loading a client
 * skill hid that task, and a member's Change → Save on such a session left the
 * line as it was, so the save looked like it had failed. With no client AND no
 * task the line is still "client not declared yet".
 *
 * ⛔ Fix round 2 (Opus, 2026-10-03) — THE CLIENT'S NAME AND THE TASK ARE CLEANED OF
 * BIDIRECTIONAL CONTROLS HERE, AT DISPLAY, as the thread's name and the folder
 * already are. A task is free text off a member's machine, and one U+202E in it
 * turned the rest of the line around on screen — the folder after it included, so
 * a folder could be made to read as another. Display only: the task a member TYPES
 * is still sent as typed (normalizeTaskLabel is unchanged). A client name or a task
 * made of nothing but such controls is no name and no task.
 */
export function sessionLineText(session) {
  const client = session ? oneLine(stripBidiControls(session.client)) : '';
  const task = session ? oneLine(stripBidiControls(session.task)) : '';
  const folder = session ? normalizeFolderName(session.rootName) : '';
  let template;
  if (client) template = task ? SESSION_COPY.lineWithTask : SESSION_COPY.lineNoTask;
  else if (task) template = SESSION_COPY.lineNoClientWithTask;
  else template = SESSION_COPY.lineNoClient;
  // ONE pass, function replacer: the values are never re-scanned for a token, and
  // a `$&` in a client name or a task is never expanded.
  const line = template.replace(/\{(client|task)\}/g, (_, k) => (k === 'client' ? client : task));
  if (!folder) return line;
  // The suffix is filled on its own and appended, so a "{folder}" in a client name
  // or a task is never filled, and a `$&` in a folder name is never expanded.
  return line + SESSION_COPY.folderSuffix.replace('{folder}', () => folder);
}

/**
 * The folders line under the sessions: SESSION_COPY.recordingFrom with the
 * server's `recent_roots` joined with ", ", in the server's order. '' when there
 * is no folder to name — the caller then draws nothing. Which envelopes name
 * folders, and when the line is drawn, is panelui.js sessionsBlockState().
 */
export function recordingFromText(roots) {
  const list = (Array.isArray(roots) ? roots : [])
    .map(normalizeFolderName)
    .filter(Boolean);
  if (!list.length) return '';
  // A function replacer: a folder can contain `$&`, and a string one would expand it.
  return SESSION_COPY.recordingFrom.replace('{roots}', () => list.join(', '));
}

// ─────────────────────────────────────────────────────────────────────────────
// CALLS — `request` is common.js apiRequest (injectable for tests and probes)
// ─────────────────────────────────────────────────────────────────────────────

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET /api/ext/task-candidates?session_ref= — never throws.
 *
 * The server orders them (recent labels, then assigned tickets, then touched
 * tickets) and this keeps that order. Anything that is not a usable label is
 * dropped rather than drawn.
 *
 * @returns {Promise<{ ok: boolean, candidates: Array<{label, ticketId, source}> }>}
 */
export async function loadTaskCandidates(request, sessionRef) {
  if (!isSessionRef(sessionRef)) return { ok: false, candidates: [] };
  let res;
  try {
    res = await request(`${TASK_CANDIDATES_PATH}?session_ref=${encodeURIComponent(sessionRef)}`);
  } catch (e) {
    return { ok: false, candidates: [] };
  }
  if (!res || !res.ok) return { ok: false, candidates: [] };
  const list = res.data && Array.isArray(res.data.candidates) ? res.data.candidates : [];
  const candidates = [];
  for (const c of list) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (!c || typeof c !== 'object') continue;
    const label = normalizeTaskLabel(c.label);
    if (!label) continue;
    candidates.push({
      label,
      ticketId: typeof c.ticket_id === 'string' && c.ticket_id.trim() ? c.ticket_id.trim() : null,
      source: typeof c.source === 'string' ? c.source : null,
    });
  }
  return { ok: true, candidates };
}

/**
 * POST /api/ext/task-override — never throws.
 *
 * Body (spec §3.4): `{ session_ref, task_label, project_id?, ticket_id? }`.
 * `project_id` is the session's declared project, when it has one — the picker
 * changes the task, never the client. `ticket_id` rides only when the label being
 * saved is a candidate the member picked, unedited.
 *
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function saveTaskOverride(request, { sessionRef, label, projectId = null, ticketId = null } = {}, { timeoutMs = SAVE_TIMEOUT_MS } = {}) {
  const taskLabel = normalizeTaskLabel(label);
  if (!isSessionRef(sessionRef) || !taskLabel) return { ok: false };
  const body = { session_ref: sessionRef, task_label: taskLabel };
  if (typeof projectId === 'string' && projectId) body.project_id = projectId;
  if (typeof ticketId === 'string' && ticketId) body.ticket_id = ticketId;
  let res;
  try {
    res = await withTimeout(Promise.resolve(request(TASK_OVERRIDE_PATH, { method: 'POST', body })), timeoutMs);
  } catch (e) {
    return { ok: false };
  }
  if (!res || !res.ok) return { ok: false, status: res ? res.status : undefined };
  // The route answers {ok:true}; a 2xx that says otherwise is not a save.
  if (res.data && res.data.ok === false) return { ok: false, status: res.status };
  return { ok: true, status: res.status };
}
