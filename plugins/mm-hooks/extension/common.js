// common.js — shared config / timer / API helpers.
// Imported by the service worker, popup, and options page (ES module).

// The capture-state report rides every authenticated request (v0.11.1). The
// predicate and the closed value list live in capture.js next to the gate; this
// file only puts the answer on the wire. capture.js touches no `chrome.*` at
// module scope, so importing it here keeps the pure-node probes loadable.
import { NOTICE_VERSION, reportableCaptureState, readCaptureForReport } from './capture.js';

/**
 * ⛔ MEMBER-FACING COPY THAT HAS NOT BEEN WRITTEN YET.
 *
 * An executor places strings; it does not author the ones a member reads. Every
 * new user-visible sentence in this release goes in as OPUS_COPY("<what it must
 * say>") and renders the placeholder verbatim, so an unfilled slot is impossible
 * to miss on the surface and trivial to find in the tree:
 *
 *     grep -rn 'OPUS_COPY(' --exclude-dir=.git .
 *
 * ⛔ DO NOT SHIP A BUILD THAT STILL MATCHES THAT GREP. The placeholder is loud on
 * purpose — a silent default would be an executor writing the copy by omission,
 * which is the exact boundary this helper exists to hold.
 */
export function OPUS_COPY(description) {
  return `OPUS_COPY(${description})`;
}

// Baked-in default backend (production). A fresh install is connected as soon as
// a token is entered — the API URL is pre-filled to this and stays editable in
// Options for anyone pointing at a different deployment.
export const DEFAULT_API_BASE = 'https://onboarding-wizard.massmarket.ai';

// v0.6.0's phase-2 shrink removed the always-on proof layer; v0.11.0 brought HALF
// of it back and left the rest deleted. What is live again is the per-minute
// activity bucket and the alarm that drains it — on the CAPTURE gate, not on a
// timer. What stays gone is every screenshot path outside the explicit QA-capture
// walkthrough: the burst/segment cadence, the IndexedDB shot queue, and the
// /screenshot endpoint.
//
// This object still holds only the /track event-queue cap. The capture-side
// constants live in capture.js (CAPTURE) next to the gate they belong to, and the
// QA-capture mode's JPEG quality/width live in the QA constant below.
export const SETTINGS = {
  MAX_QUEUE: 500,            // /track event buffer cap (drop oldest beyond this)
};

const EMPTY_TIMER = {
  entryOpen: false,
  startedAt: null,
  blockId: null,
  note: '',
  entryId: null,
  scheduledEnd: null, // ISO end of the linked calendar block (null = unscheduled work)
  internalCategory: null, // internal-work category (build|rework|client_meeting|planning|coordination); only set for no-block timers
};

// ---------------------------------------------------------------- QA-capture mode
// A SEPARATE, SILENT capture flow from the always-on activity/screenshot proof layer
// above. Triggered from the end-of-block "ready for QA?" gate: this captures a silent
// structured layer — a screenshot on every click, plus the click/URL sequence. The
// extension records NO audio. A Loom recording alongside this is OPTIONAL (2026-07-22):
// if the rep runs one, it supplies the video + narration; if not, the qa-doc-generator
// skill's completeness Q&A supplies the narration instead — the ZIP alone is sufficient
// to finalize. On finish the clicks + screenshots + urls + meta are bundled into a
// downloadable .zip IN-BROWSER (no server upload) that the qa-doc-generator skill
// consumes, optionally alongside a Loom video if one was recorded.
// Nothing here touches the /track, /activity, or /screenshot endpoints or the `shots`
// IndexedDB store.
export const QA = {
  SHOT_GAP_MS: 600,     // min gap between click-triggered QA screenshots (SW-side throttle)
  JPEG_QUALITY: 60,     // QA screenshots are human/Claude-reviewed — a touch higher than the proof layer
  MAX_WIDTH: 1400,      // downscale QA screenshots to this max width
};

// Empty QA-capture session. `hasSession` stays true after a Finish so the rep can
// "Resume / add to this capture" and re-export a superset bundle (Resume-Append).
const EMPTY_QA = {
  hasSession: false,          // a capture bundle exists (in-progress OR finished-but-resumable)
  active: false,              // currently capturing (click-shots on) — NO mic/audio
  block_id: null,
  block_title: '',
  deliverable_type: 'general',
  client_hint: '',
  captured_by_email: '',
  started_at: null,
  ended_at: null,
  shotCount: 0,               // monotonic screenshot sequence (continues across resume-append)
  urls: [],                   // [{ ts_ms, url, title }]
  lastShotTs: 0,              // throttle marker
  // Optional Loom pairing: minted at capture START via POST /api/ext/qa-upload-token so
  // the qa-doc-generator skill CAN upload a rep's full Loom video into the project IF
  // one gets recorded — most captures never use this token at all. Written into
  // meta.json in the exported bundle (and reused for the doc/worklog upload either way).
  // Null = mint failed (capture still proceeds; the skill degrades and notes the absent
  // token, and manual video attach — or none at all — remains fine).
  upload_token: null,
  upload_token_expires_at: null,
  upload_token_error: null,   // non-null string if the mint call failed
};

export async function getQa() {
  const { qaCapture } = await chrome.storage.local.get('qaCapture');
  return { ...EMPTY_QA, ...(qaCapture || {}) };
}

export async function setQa(patch) {
  const next = { ...(await getQa()), ...patch };
  await chrome.storage.local.set({ qaCapture: next });
  return next;
}

export async function clearQa() {
  await chrome.storage.local.set({ qaCapture: { ...EMPTY_QA } });
  return { ...EMPTY_QA };
}

// deliverable_type + client_hint are both derived from the calendar block title.
// ad|ads|meta|facebook -> 'ads' (matches the qa-doc-generator skill's 'ads' checklist
// — CAPI + end-to-end nurture); everything else -> 'general' (the default).
export function deliverableTypeFromTitle(title) {
  return /\b(ad|ads|meta|facebook)\b/i.test(String(title || '')) ? 'ads' : 'general';
}

// A rough client hint pulled from the block title: text before the first
// separator (— - : |), falling back to the whole title. The qa-doc-generator
// only uses this to seed the doc's client line, so an approximate hint is fine.
export function clientHintFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return '';
  const head = t.split(/\s*[—\-:|·]\s*/)[0].trim();
  return head || t;
}

// ---- config: { apiBase, token, email, name } ----
export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  const cfg = { ...(config || {}) };
  // Default the API base so a fresh install only needs a token. Remains
  // overridable — Options writes an explicit apiBase when the user connects.
  if (!cfg.apiBase) cfg.apiBase = DEFAULT_API_BASE;
  return cfg;
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

export function isConnected(cfg) {
  return !!(cfg && cfg.apiBase && cfg.token);
}

// ---- timer state (single source of truth lives in storage) ----
export async function getTimer() {
  const { timer } = await chrome.storage.local.get('timer');
  return { ...EMPTY_TIMER, ...(timer || {}) };
}

export async function setTimer(patch) {
  const next = { ...(await getTimer()), ...patch };
  await chrome.storage.local.set({ timer: next });
  return next;
}

export async function clearTimer() {
  await chrome.storage.local.set({ timer: { ...EMPTY_TIMER } });
  return { ...EMPTY_TIMER };
}

// ---- PARALLEL timers (v0.5.5) ----
// The pay meter is built on running 2–3 blocks at once. `timers` is the array of
// ALL currently-open blocks; each item mirrors the single-timer shape:
//   { key, blockId, projectId, startedAt, entryId, note, scheduledEnd,
//     internalCategory, title, projectName }
// (`title` is what Start was given; `projectName`, 0.11.4, is the server's
// `project_name` for the entry — see timerDisplayTitle() below.)
// `key` is the block id (or '__internal__' for no-block/unscheduled work — a member
// has at most one open internal timer, matching the server's single internal slot).
// ⛔ CORRECTED FOR v0.11.0: the capture stream is NOT gated on "any timer open".
// It is gated on capture.js's captureGate() — signed in, acknowledged, not paused —
// and knows nothing about timers. Only the entry lifecycle is per-block.
export const INTERNAL_KEY = '__internal__';
export const PROJECT_KEY_PREFIX = 'project:';

/**
 * ⛔ THREE SLOTS, NOT TWO — a byte-exact mirror of `entryKey()` in
 * /api/ext/track's route. A block keys on its block id; a PROJECT-scoped timer
 * (a client with open work but no schedulable block) keys on `project:<uuid>`;
 * only genuinely unscoped internal work lands on `__internal__`.
 *
 * Collapsing projects onto `__internal__` — which is exactly what the old
 * one-argument signature did with `blockId == null` — would mean starting Crucial
 * Hire and then Remver left ONE running clock, with the second client's time
 * silently swallowed by the first. The server changed its key for this reason on
 * 2026-08-12; this is the client half of the same change.
 *
 * ⛔ BACKWARD COMPATIBLE ON PURPOSE. `timerKey(id)` with one argument returns
 * exactly what it always did, so every key already persisted in
 * chrome.storage.local (`timers[].key`, `schedEndBlocks`) keeps resolving. Only
 * the new project path produces a new shape.
 */
export function timerKey(blockId, projectId = null) {
  if (blockId != null) return String(blockId);
  if (projectId != null) return `${PROJECT_KEY_PREFIX}${projectId}`;
  return INTERNAL_KEY;
}

/** The project id behind a `project:<uuid>` timer key, or null for any other key. */
export function projectIdFromKey(key) {
  const s = String(key || '');
  return s.startsWith(PROJECT_KEY_PREFIX) ? s.slice(PROJECT_KEY_PREFIX.length) : null;
}

export async function getTimers() {
  const { timers } = await chrome.storage.local.get('timers');
  return Array.isArray(timers) ? timers : [];
}

export async function setTimers(list) {
  const arr = Array.isArray(list) ? list : [];
  await chrome.storage.local.set({ timers: arr });
  return arr;
}

export async function anyTimerOpen() {
  return (await getTimers()).length > 0;
}

// Add or replace the timer for a block (idempotent by key). Returns the new list.
export async function upsertTimer(t) {
  const key = t.key || timerKey(t.blockId, t.projectId ?? null);
  const list = await getTimers();
  const next = list.filter((x) => x.key !== key);
  next.push({ ...t, key });
  return setTimers(next);
}

// Remove the timer for a key. Returns the new list.
export async function removeTimer(key) {
  const list = await getTimers();
  return setTimers(list.filter((x) => x.key !== key));
}

export async function getTimerByKey(key) {
  const list = await getTimers();
  return list.find((x) => x.key === key) || null;
}

export async function clearTimers() {
  await chrome.storage.local.set({ timers: [] });
  return [];
}

// ------------------------------ what a RUNNING TIMER is called (0.11.4)
//
// ⛔ ONE RESOLUTION, THREE SURFACES (SPEC-tracker-0.11.4 §2.4; Shezan, 2026-10-02).
// Reported: a timer's name is right when it starts; close the popup, open it again,
// and every client timer with no calendar block reads "Client work" — with several
// running, nobody can tell which one to stop. Cause: the reopened popup redraws from
// the server's open entries, which carry no title, and its `resume` then REPLACED
// the stored timers with `title: ''`, so the side panel and the pop-out fell to
// "Unscheduled work" for the same timers.
//
// The popup's run list, the side panel and the pop-out now all call
// timerDisplayTitle(), and the worker carries a stored title through `resume`
// (background.js resumeTimer). There is no second copy of this order or of the
// three fallback names anywhere else.

/**
 * The text of `s` without its BIDIRECTIONAL CONTROL characters — U+200E and U+200F
 * (the left-to-right and right-to-left marks), U+202A to U+202E (the embeddings,
 * overrides and their pop) and U+2066 to U+2069 (the isolates and their pop).
 *
 * ⛔ (Opus, fix round 1, 2026-10-02.) A name that came off a member's machine or out
 * of the server can carry them, and one U+202E turns every character after it
 * around on screen — "abc\u202Edef" reads "abcfed", and a folder or a project can be
 * made to read as another. Each displayed name passes through ONE normaliser, and
 * that normaliser calls this: a thread's name (sessions.js normalizeSessionTitle),
 * a folder's name (sessions.js normalizeFolderName, panelui.js verdictRoots) and a
 * running timer's name (shownName below). The name then reads in its logical order.
 * Display only: nothing a member typed is changed on its way to the server.
 */
export function stripBidiControls(s) {
  return typeof s === 'string' ? s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') : '';
}

/**
 * A name worth showing: trimmed, without bidirectional controls, and non-empty;
 * '' for anything else.
 */
function shownName(v) {
  return typeof v === 'string' ? stripBidiControls(v).trim() : '';
}

/**
 * The name of a running timer, in this order:
 *
 *   1. the calendar block's title, when the entry has a block (`blockTitle` — the
 *      popup looks it up in /api/ext/blocks' list; the side panel has no such list,
 *      and for a block its stored title IS the block's title);
 *   2. the title stored locally for that entry (`storedTitle` — what Start was
 *      given: the block's title, or the card's label for a client with no block);
 *   3. the server's `project_name` for that entry (`projectName` — new on
 *      /api/ext/blocks `open_entries` with 0.11.4; an older server sends none, and
 *      this step is then simply skipped);
 *   4. the three names a timer with none of those has always had: "Scheduled
 *      block", "Client work" (client time with no block), "Unscheduled work".
 *
 * @param {{ blockId?: *, projectId?: *, blockTitle?: string, storedTitle?: string, projectName?: string }} t
 */
export function timerDisplayTitle({ blockId = null, projectId = null, blockTitle = '', storedTitle = '', projectName = '' } = {}) {
  const hasBlock = blockId != null && blockId !== '';
  if (hasBlock && shownName(blockTitle)) return shownName(blockTitle);
  if (shownName(storedTitle)) return shownName(storedTitle);
  if (shownName(projectName)) return shownName(projectName);
  if (hasBlock) return 'Scheduled block';
  return projectId != null && projectId !== '' ? 'Client work' : 'Unscheduled work';
}

/**
 * The stored timer that IS this server entry, or null: the one carrying the same
 * entry id — or, when a stored timer on the same key has no id yet (its start has
 * not been reconciled with the server), that one. ⛔ A stored timer that carries a
 * DIFFERENT entry id is a different timer, even on the same key (the key was
 * stopped and started again on another machine), and is never returned.
 *
 * @param {Array} timers the stored timers (getTimers())
 * @param {{ entryId?: *, key?: string }} entry the server entry's id and timer key
 */
export function storedTimerFor(timers, { entryId = null, key = null } = {}) {
  const list = Array.isArray(timers) ? timers.filter((t) => t && typeof t === 'object') : [];
  if (entryId != null) {
    const byId = list.find((t) => t.entryId != null && String(t.entryId) === String(entryId));
    if (byId) return byId;
  }
  if (key != null) return list.find((t) => t.entryId == null && String(t.key) === String(key)) || null;
  return null;
}

/**
 * A SERVER open entry (/api/ext/blocks `open_entries`), with the names this profile
 * already holds for it laid on: `title` (the title stored for the same entry) and
 * `project_name` (the server's own, else the one stored).
 *
 * ⛔ WHY. The server's open entries carry no title, so a popup redrawn from them
 * called every client timer with no calendar block "Client work". The name Start
 * was given is still in storage, on the timer for the same entry (storedTimerFor),
 * and this is where the reopened popup picks it back up. The server's
 * `project_name` wins over a stored one; an older server sends none, and the
 * stored one, if any, stands.
 *
 * @param {object} oe     one open entry: { id, calendar_block_id, project_id, … }
 * @param {Array}  timers the stored timers (getTimers(), or the worker's answer)
 */
export function nameOpenEntry(oe, timers) {
  const blockId = oe.calendar_block_id ?? null;
  const key = timerKey(blockId, blockId == null ? (oe.project_id ?? null) : null);
  const stored = storedTimerFor(timers, { entryId: oe.id ?? null, key });
  return {
    ...oe,
    title: shownName(oe.title) || shownName(stored && stored.title),
    project_name: shownName(oe.project_name) || shownName(stored && stored.projectName) || null,
  };
}

// ------------------------------ the DELIVERY-QA GATE (v0.8.6 · a SET since v0.8.7)
//
// ⛔ ONE COPY, TWO SURFACES. Everything from here to the end of this section used to
// be private to popup.js. v0.8.6 gave the side panel (and therefore the popped-out
// window) its own Stop button, and a Stop that does not arm this gate is a SILENT
// ENFORCEMENT LOSS — someone stops a block-linked timer from the surface the team
// now lives in, and the delivery QA that Stop is supposed to demand simply never
// gets asked for. That is worse than having no button.
//
// The defence is not "remember to copy the rules into the panel too". It is that
// there is nothing to copy: both surfaces call THESE functions. Change
// QA_END_MARGIN_MIN or qaPhaseFor() here and both the popup and the panel change
// together, or neither does. A copy-paste into panelapp.js would let the two drift,
// and the gate would weaken on whichever copy someone forgot.

// Stopping this many minutes (or more) before a block's scheduled_end counts as
// "ending early": the rep is offered the continue-later / finished-early choice
// instead of going straight to the QA attestation. At/after (end - margin) → QA.
export const QA_END_MARGIN_MIN = 15;

// Internal categories for which a long (≥1h) block is worth attaching a Claude Code
// work log — build/rework/planning/coordination. client_meeting is intentionally
// excluded (a meeting has no build work log).
export const WORKLOG_NUDGE_CATEGORIES = new Set(['build', 'rework', 'planning', 'coordination']);
export const WORKLOG_NUDGE_MIN_HOURS = 1;

// Storage keys. After a Stop the entry is already committed server-side (background
// flushes the timer_stop before the stop message resolves), so these three keys are
// what makes the follow-up durable across a popup Chrome closes on any click-away —
// and, since v0.8.6, across a Stop that happened in a completely different document.
//   pendingQaFinalize — the SET of blocks that still owe QA (v0.8.7; it was a single
//     object through v0.8.6 — see the gate section below). The popup re-surfaces the
//     early/QA prompt from this on its next open (init() → renderQa /
//     renderEndingEarly with `reopened`) and drains the set ONE BLOCK AT A TIME,
//     which is exactly how a panel Stop hands the gate over WITHOUT the panel
//     needing any QA UI of its own.
//   lastStopConfirm   — written on EVERY stop; drives the one-time
//     "✓ time submitted" confirmation on the next picker render.
//   internalWorklogNudge — the optional long-internal-block work-log nudge.
export const PENDING_KEY = 'pendingQaFinalize';
export const CONFIRM_KEY = 'lastStopConfirm';
export const WORKLOG_NUDGE_KEY = 'internalWorklogNudge';

// ⛔ v0.8.7 — THE GATE IS A SET, KEYED BY BLOCK. NOT ONE SLOT.
//
// Until v0.8.6 `pendingQaFinalize` held a SINGLE object, and that shape was itself
// two live bypasses of the delivery-QA gate. Both were confirmed in the panel AND,
// identically, in the popup — they predate the panel's Stop button, which only made
// the first one cheaper to trigger:
//
//   BYPASS A — a block-less stop (project or internal time) called
//     clearPendingFinalize(). Stop a client block, then stop ANY project/internal
//     timer one click later, and the armed requirement was DESTROYED. A stop with no
//     deliverable has no business resolving another block's QA requirement.
//
//   BYPASS B — arming a second block overwrote the one key. Stop block A, then block
//     B, and A's requirement was silently dropped. The server caps a member at 4
//     parallel blocks, so "stop everything at the end of the day" hit this routinely.
//
// The fix is structural, not a patch at each call site: N stopped blocks hold N
// independent requirements, and the ONLY thing that may remove one is that block's
// own QA being completed (resolvePendingQa). There is deliberately NO "clear them
// all" export — a function like that is how both bypasses got written in the first
// place, and an accidental caller could not be caught by review.
//
// Stored shape (v2):
//   { v: 2, items: [ { blockId, blockTitle, phase, durationHours, savedAtIso }, … ] }
// Insertion-ordered; getPendingQaAll() returns oldest-first so the popup drains in
// the order the work actually finished.
export const PENDING_VERSION = 2;

// ⛔ THE AGE CAP (v0.12.0). An entry older than this is dropped on the next read.
//
// This key is LOCAL-ONLY and there is exactly ONE thing in the world that can
// remove an entry: that same member, on that same machine, walking the popup's QA
// flow to the end (resolvePendingQa). No server route writes it, nothing reconciles
// it, and — measured on prod 2026-09-12 — the blocks API cannot even be asked
// whether the QA landed: it returns no `qa_posted_at`, it does not carry `qa_final`
// (which is what the Claude Code route actually writes), and `completed` is not a
// QA (17 of 230 completed blocks have no QA of any kind). So a requirement that
// goes unanswered is not "outstanding" — it is STUCK, and before this cap it stayed
// on the surface forever, on a block whose day is long gone.
//
// 14 days is deliberately far past any real QA turnaround. The cap exists to bound
// a local flag nobody can clear, not to let anyone off a QA they owe this week.
//
// ⛔ It drops the ENTRY, never the obligation. There is still no "clear them all"
// path (that is what BYPASS A was), the expiry is per-entry and time-based only,
// and the server-side qa-watchdog is unaffected — it reads blocks, not this key.
export const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** True when this entry is older than the cap. Undated entries never expire. */
export function pendingQaExpired(item, now = Date.now()) {
  if (!item || !item.savedAtIso) return false;
  const t = Date.parse(item.savedAtIso);
  if (!Number.isFinite(t)) return false;
  return now - t > PENDING_MAX_AGE_MS;
}

/**
 * Coerce whatever is in storage into the v2 shape.
 *
 * ⛔ THIS IS THE MIGRATION, AND IT IS THE WHOLE POINT OF HAVING ONE FUNCTION.
 * A member upgrading mid-flight can be holding an OLD single-object
 * pendingQaFinalize right now — they stopped a client block on v0.8.6 and have not
 * opened the popup yet. Reading that as "not the new shape, therefore nothing
 * pending" would silently discard a real outstanding QA requirement, which is this
 * exact bug again wearing a migration costume. So the old object is converted into
 * a one-item set and survives.
 */
export function normalizePendingQa(raw) {
  const empty = { v: PENDING_VERSION, items: [] };
  if (!raw) return empty;
  // Defensive: a bare array (never written by us, but cheap to accept).
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.items)
      ? raw.items
      // ⛔ THE MIGRATION: the v0.8.6 single-object shape. It has no `items`, and it
      // carries the requirement directly.
      : (raw.blockId != null ? [raw] : []);
  const items = [];
  const seen = new Set();
  for (const it of list) {
    if (!it || it.blockId == null) continue;      // no block = no deliverable = no gate
    const id = String(it.blockId);
    if (seen.has(id)) continue;                    // one requirement per block
    seen.add(id);
    items.push({
      blockId: it.blockId,
      blockTitle: it.blockTitle || '',
      phase: it.phase === 'early' ? 'early' : (it.phase || 'qa'),
      durationHours: it.durationHours != null ? it.durationHours : null,
      savedAtIso: it.savedAtIso || null,
    });
  }
  return { v: PENDING_VERSION, items };
}

async function readPendingQa() {
  try {
    const o = await chrome.storage.local.get(PENDING_KEY);
    return normalizePendingQa(o[PENDING_KEY]);
  } catch (e) {
    return { v: PENDING_VERSION, items: [] };
  }
}

// ⛔ EVERY read-modify-write on this key MUST go through withGateLock(). Do not call
// readPendingQa()/writePendingQa() as a pair outside it.
//
// chrome.storage.local has no atomic update, and the popup, the panel and the pop-out
// all share this key. An earlier comment here claimed a lost interleave could only show
// a QA prompt twice, "never one skipped, the arm path only ever ADDS". THAT WAS FALSE
// and adversarial QA disproved it: writePendingQa rewrites the WHOLE set, so two arms
// that begin in the same tick read the same snapshot and the later write erases the
// earlier requirement. Driven through the real panel, four Stop buttons clicked in one
// tick left ONE of four requirements — three block-linked stops with nothing durable.
//
// The measured window is same-tick only (>=1ms separation survived at every storage-IPC
// and network-latency model tested), so it was never human-reachable. It is serialized
// anyway, because "a person cannot click that fast" is a single-writer assumption about
// a shared key — which is precisely the assumption that produced the single-slot gate
// this file exists to replace. The wrong comment was the more dangerous half: it told
// the next engineer the invariant held.
let gateQueue = Promise.resolve();
function withGateLock(fn) {
  const run = gateQueue.then(fn, fn);        // a rejected predecessor must not stall the chain
  gateQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function writePendingQa(state) {
  try {
    if (!state.items.length) await chrome.storage.local.remove(PENDING_KEY);
    else await chrome.storage.local.set({ [PENDING_KEY]: state });
  } catch (e) { /* storage unavailable */ }
}

/**
 * Every outstanding QA requirement, OLDEST FIRST. The popup drains this one at a
 * time; a member who stopped three blocks owes three QAs and gets asked three times.
 */
export function getPendingQaAll() { return withGateLock(() => _getPendingQaAll()); }
async function _getPendingQaAll() {
  const state = await readPendingQa();
  // ⛔ The age cap is applied HERE, on the read every surface goes through, and the
  // drop is PERSISTED — under the gate lock, like every other write to this key. An
  // expiry that only filtered the return value would re-drop the same rows on every
  // popup open forever and leave the key growing; one that wrote outside the lock
  // would be the same lost-interleave the lock exists to stop.
  const now = Date.now();
  const live = state.items.filter((it) => !pendingQaExpired(it, now));
  if (live.length !== state.items.length) {
    await writePendingQa({ ...state, items: live });
  }
  const items = live;
  return items
    .map((it, i) => ({ it, i, t: it.savedAtIso ? Date.parse(it.savedAtIso) : NaN }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? Infinity : a.t;   // undated = treat as newest,
      const bt = Number.isNaN(b.t) ? Infinity : b.t;   // but never lose it
      return at === bt ? a.i - b.i : at - bt;
    })
    .map((w) => w.it);
}

/** The one requirement for a given block, or null. */
export async function getPendingQaFor(blockId) {
  if (blockId == null) return null;
  const { items } = await readPendingQa();
  return items.find((it) => String(it.blockId) === String(blockId)) || null;
}

/**
 * Back-compat read: the OLDEST outstanding requirement, in the old single-object
 * shape. Kept because "is anything owed, and what do I show first" is still a real
 * question — it just no longer implies there is only one.
 */
export async function getPendingFinalize() {
  const all = await getPendingQaAll();
  return all[0] || null;
}

/**
 * ARM the gate for one block. Re-arming the same block replaces that block's entry
 * IN PLACE and touches no other — this is the write that used to be BYPASS B.
 */
export function armPendingQa(entry) { return withGateLock(() => _armPendingQa(entry)); }
async function _armPendingQa(entry) {
  if (!entry || entry.blockId == null) return;
  const state = await readPendingQa();
  const id = String(entry.blockId);
  const next = {
    blockId: entry.blockId,
    blockTitle: entry.blockTitle || '',
    phase: entry.phase || 'qa',
    durationHours: entry.durationHours != null ? entry.durationHours : null,
    savedAtIso: entry.savedAtIso || new Date().toISOString(),
  };
  const at = state.items.findIndex((it) => String(it.blockId) === id);
  if (at >= 0) state.items[at] = next;
  else state.items.push(next);
  await writePendingQa(state);
}

/** Move ONE block's requirement between phases (the "finished early → QA" step). */
export function setPendingQaPhase(blockId, phase) { return withGateLock(() => _setPendingQaPhase(blockId,phase)); }
async function _setPendingQaPhase(blockId, phase) {
  if (blockId == null) return;
  const state = await readPendingQa();
  const it = state.items.find((x) => String(x.blockId) === String(blockId));
  if (!it) return;
  it.phase = phase;
  await writePendingQa(state);
}

/**
 * ⛔ THE ONLY REMOVAL PATH, AND IT IS SCOPED TO ONE BLOCK.
 *
 * `resolvePendingQa(null)` is a deliberate NO-OP, and that is what a block-less stop
 * calls: project and internal time have no deliverable, so such a stop may resolve
 * its own (non-existent) entry and NOTHING else. That call being harmless is BYPASS
 * A closed at the root rather than at each of the two call sites that had it.
 */
export function resolvePendingQa(blockId) { return withGateLock(() => _resolvePendingQa(blockId)); }
async function _resolvePendingQa(blockId) {
  if (blockId == null) return;
  const state = await readPendingQa();
  const items = state.items.filter((it) => String(it.blockId) !== String(blockId));
  if (items.length === state.items.length) return;
  await writePendingQa({ ...state, items });
}
export async function setStopConfirm(c) {
  try { await chrome.storage.local.set({ [CONFIRM_KEY]: c }); } catch (e) { /* ignore */ }
}
export async function getStopConfirm() {
  try { const o = await chrome.storage.local.get(CONFIRM_KEY); return o[CONFIRM_KEY] || null; } catch (e) { return null; }
}
export async function clearStopConfirm() {
  try { await chrome.storage.local.remove(CONFIRM_KEY); } catch (e) { /* ignore */ }
}
export async function setWorklogNudge(n) {
  try { await chrome.storage.local.set({ [WORKLOG_NUDGE_KEY]: n }); } catch (e) { /* ignore */ }
}
export async function getWorklogNudge() {
  try { const o = await chrome.storage.local.get(WORKLOG_NUDGE_KEY); return o[WORKLOG_NUDGE_KEY] || null; } catch (e) { return null; }
}
export async function clearWorklogNudge() {
  try { await chrome.storage.local.remove(WORKLOG_NUDGE_KEY); } catch (e) { /* ignore */ }
}

/**
 * Hours (1-decimal) elapsed since a given start ISO, or null.
 *
 * ⛔ CALL THIS BEFORE SENDING {type:'stop'}. The service worker removes the timer
 * from chrome.storage.local during the stop flush, so a caller that reads the
 * timer AFTER the round-trip gets `undefined` → null hours → a "your time was
 * saved" banner with no number in it and a pendingQaFinalize with a null duration.
 */
export function durationHoursFrom(startedAt) {
  if (!startedAt) return null;
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 3600000) * 10) / 10;
}

export function fmtHours(h) {
  return h != null && Number.isFinite(h) ? `${h.toFixed(1)}h` : 'your time';
}

/**
 * The early-vs-QA decision for a block-linked stop. THE single definition — the
 * popup's onStopBlock() and the panel's onStopTimer() both resolve the phase
 * through this exact function.
 *
 * ⛔ THE `Number.isNaN` GUARD IS LOAD-BEARING. An absent or unparseable
 * scheduled_end yields NaN, which must fall through to 'qa' so the gate is ARMED.
 * A caller that instead returned early, or skipped the setPendingFinalize write
 * when the date was missing, would silently drop the QA requirement for exactly
 * the blocks whose scheduling data is worst — which is the population most likely
 * to need the check. Missing end date = QA required, never = no gate.
 *
 * @param {string|null} scheduledEnd ISO end of the linked calendar block
 * @param {number}      now          epoch ms (injectable for tests)
 * @returns {'early'|'qa'}
 */
export function qaPhaseFor(scheduledEnd, now = Date.now()) {
  const endMs = scheduledEnd ? Date.parse(scheduledEnd) : NaN;
  const marginMs = QA_END_MARGIN_MIN * 60 * 1000;
  return !Number.isNaN(endMs) && now < endMs - marginMs ? 'early' : 'qa';
}

/** Whether a stopped INTERNAL timer earns the Claude Code work-log nudge. */
export function shouldNudgeWorklog(category, durationHours) {
  return !!(
    category &&
    WORKLOG_NUDGE_CATEGORIES.has(category) &&
    durationHours != null &&
    durationHours >= WORKLOG_NUDGE_MIN_HOURS
  );
}

// HH:MM:SS elapsed since an ISO start. Shared by the popup's running cards and the
// side panel / pop-out window so both clocks read identically.
export function fmtElapsed(startIso) {
  const total = Math.max(0, Math.floor((Date.now() - Date.parse(startIso)) / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// ---- install id (I1, v0.11.2) ----
//
// ⛔ WHY. One member token covers every browser and profile that member signs in
// on, so the server's per-token columns (`team_auth_tokens.ext_version`,
// `platform`, `capture_state`) hold whichever install wrote last, and nothing
// server-side can count a member's installs. Each install now keeps ONE random id
// in chrome.storage.local and apiRequest() sends it, with the browser's brand, on
// every call to the OW API. OW's shared ext auth (src/lib/ext/auth.ts) records one
// row per (member, install) in `time_ext_installs`.
//
// ⛔ WHAT LEAVES THE MACHINE, AND NOTHING ELSE:
//   X-MM-Install-Id  crypto.randomUUID(), made once per install. Random — derived
//                    from nothing on the machine and from nothing the member did.
//   X-MM-Browser     the first navigator.userAgentData brand that is not
//                    "Chromium" and does not contain "Not" ("Google Chrome",
//                    "Microsoft Edge", "Brave", …), else "unknown".
// Nothing about pages, tabs or activity. No new permission.
//
// ⛔ FAIL-SAFE. Nothing in this section throws. Storage unreadable, randomUUID
// missing, a malformed apiBase, a URL on any other origin: the request goes out
// WITHOUT the two headers, byte-for-byte as a 0.11.1 build's would. A defect here
// must never cost a request — tracking is the thing this rides on.
//
// ⛔ STABLE. Written once, never regenerated. chrome.storage.local survives browser
// restarts, extension reloads and in-place updates because the manifest `key`
// pins the extension ID (verify/manifest-identity.test.mjs). Removing the
// extension wipes storage, so a clean reinstall gets a new id — which is right,
// because it is a new install.
//
// ⛔ THE OW API ORIGIN ONLY. The headers ride only a request whose origin is the
// configured apiBase's origin. apiRequest() is the only caller, and it is the one
// place every OW call is built (verify/install-id.test.mjs pins both).
export const INSTALL_ID_KEY = 'mm_install_id';
export const INSTALL_ID_HEADER = 'X-MM-Install-Id';
export const BROWSER_HEADER = 'X-MM-Browser';
// The server keeps at most 64 characters of the brand (src/lib/ext/auth.ts).
const BROWSER_MAX_LEN = 64;
// RFC 4122, case-insensitive — the same test the server applies before it stores
// anything. A value that fails it is never sent (the server would ignore it).
const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isInstallId(v) {
  return typeof v === 'string' && INSTALL_ID_RE.test(v);
}

// The stored value, or null when the key is ABSENT. Anything else stored there —
// even a value that fails isInstallId — counts as existing and is never replaced.
async function readInstallId(store) {
  const got = await store.get(INSTALL_ID_KEY);
  const v = got ? got[INSTALL_ID_KEY] : undefined;
  return v === undefined || v === null || v === '' ? null : v;
}

// One creation in flight per document/worker, so the worker's startup call and
// its first API call cannot mint two ids between them.
let installIdCreating = null;

/**
 * This install's id: the stored one, or — only when none is stored — a fresh
 * crypto.randomUUID() written to chrome.storage.local and read back. Returns null
 * on ANY failure, and a null means "send no install headers", never "block".
 * `storage` and `randomUUID` are injectable for verify/install-id.test.mjs.
 */
export async function ensureInstallId({ storage, randomUUID } = {}) {
  try {
    const store = storage || (globalThis.chrome && chrome.storage && chrome.storage.local);
    if (!store) return null;
    const existing = await readInstallId(store);
    if (existing !== null) return existing; // ⛔ never regenerate an existing value
    if (!installIdCreating) {
      const mint = randomUUID || (() => globalThis.crypto.randomUUID());
      installIdCreating = (async () => {
        // Another document (the worker vs. an open popup) may have written one
        // since the read above; keep theirs rather than overwrite it.
        const again = await readInstallId(store);
        if (again !== null) return again;
        const id = mint();
        if (!isInstallId(id)) return null;
        await store.set({ [INSTALL_ID_KEY]: id });
        // Converge on whatever actually landed, in case another document's write
        // raced this one.
        const landed = await readInstallId(store);
        return landed !== null ? landed : id;
      })().finally(() => { installIdCreating = null; });
    }
    return await installIdCreating;
  } catch (e) {
    return null;
  }
}

/** The browser's brand for X-MM-Browser, or 'unknown'. Never throws. */
export function browserBrand(nav) {
  try {
    const n = nav === undefined ? globalThis.navigator : nav;
    const brands = n && n.userAgentData && n.userAgentData.brands;
    if (Array.isArray(brands)) {
      const hit = brands.find((b) => b && typeof b.brand === 'string'
        && b.brand !== 'Chromium' && !b.brand.includes('Not'));
      // Printable ASCII only: fetch() THROWS on a header value outside ISO-8859-1,
      // and a throw there would be a lost request, not a lost header.
      const clean = hit ? hit.brand.replace(/[^\x20-\x7E]/g, '').trim().slice(0, BROWSER_MAX_LEN).trim() : '';
      if (clean) return clean;
    }
  } catch (e) { /* fall through */ }
  return 'unknown';
}

/** True only when `url` is on the same http(s) origin as `apiBase`. Never throws. */
export function isOwApiUrl(url, apiBase) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return u.origin === new URL(String(apiBase)).origin;
  } catch (e) {
    return false;
  }
}

/**
 * The two I1 headers for a request to `url`, or {} — for any other origin, and on
 * any failure at all. `deps` ({ storage, randomUUID, nav }) is for the test file.
 */
export async function installHeadersFor(url, apiBase, deps = {}) {
  try {
    if (!isOwApiUrl(url, apiBase)) return {};
    const id = await ensureInstallId(deps);
    if (!isInstallId(id)) return {};
    return { [INSTALL_ID_HEADER]: id, [BROWSER_HEADER]: browserBrand(deps.nav) };
  } catch (e) {
    return {};
  }
}

// ---- API ----
export function joinUrl(base, path) {
  return String(base || '').replace(/\/+$/, '') + path;
}

// GET/POST helper. Reads the stored config unless an explicit { apiBase, token }
// is passed via `auth` (used by the options page before anything is stored).
//
// ⛔ apiFetch THROWS on any non-2xx and discards the response body with it. That
// is right for every call site that predates v0.11.2 — a failed /blocks is a
// failed /blocks — and WRONG for the manual-hours path, where the two most
// important answers the server can give are both 409s carrying a body the member
// has to read and act on:
//
//   · overlaps_existing_entry — "these hours cross something already recorded"
//   · possible_duplicate      — carries `duplicate_check_id` + `findings`, and a
//                               member who cannot see it cannot confirm and
//                               resubmit, which leaves the entry unsavable
//
// A refusal the member cannot answer is indistinguishable from "it didn't save",
// so `apiRequest` returns the status AND the parsed body instead of throwing,
// and `apiFetch` is now a thin throwing wrapper over it. ONE implementation of
// the headers, the version/capture self-report and the 401 stamp — the reason
// this is a refactor and not a second fetch helper.
export async function apiRequest(path, { method = 'GET', body, auth } = {}) {
  const cfg = auth || (await getConfig());
  if (!cfg.apiBase || !cfg.token) {
    const e = new Error('not_configured');
    e.code = 'not_configured';
    throw e;
  }
  // v0.11.1: the capture STATE rides beside the version, on the same rule — ONE
  // place, every call. Exactly two fields, both state and neither content: the
  // gate's reason (`unknown` when the store cannot be read) and the NOTICE_VERSION
  // this build is asking a member to acknowledge. No URL, no title, no count, no
  // timestamp. This is the only reporting path that fires for a profile that has
  // never acknowledged the notice: the health GET fires only when a surface is
  // opened, and the activity flush alarm is armed only while the gate is ON — but
  // the 4-hourly token check calls /api/ext/auth through here regardless.
  //
  // ⛔ ON THE CORS HAZARD auth.ts DOCUMENTS FOR X-Ext-Version. Measured 2026-09-07
  // in a real Chromium with THIS extension loaded, against production with a bogus
  // bearer: a request carrying these two headers from the service worker AND from
  // an extension page reaches the server (HTTP 401 on the bogus token), because an
  // extension origin with host_permissions is exempt from CORS. The control — the
  // same fetch from https://example.com — was dropped ("Failed to fetch"). The
  // hazard is real for web origins and does not apply to any context that calls
  // this function (content.js never calls it). Listing the two headers in
  // Access-Control-Allow-Headers server-side still costs nothing and is proposed.
  const captureState = reportableCaptureState(await readCaptureForReport());
  const url = joinUrl(cfg.apiBase, path);
  // I1 (v0.11.2): this install's random id and the browser's brand, for the OW
  // API origin only — see "install id" above. {} on any failure, so the request
  // below is then exactly what a 0.11.1 build sends. The .catch is belt and
  // braces: installHeadersFor() already never rejects.
  const installHeaders = await installHeadersFor(url, cfg.apiBase).catch(() => ({}));
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      // Every extension call self-reports its build. The server stamps this onto
      // team_auth_tokens so /api/ext/health can answer "what version is installed?"
      // without the member telling anyone. ONE place — never per call site.
      'X-Ext-Version': manifestVersion(),
      'X-Ext-Capture-State': captureState,
      'X-Ext-Notice-Version': String(NOTICE_VERSION),
      ...installHeaders,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // ⛔ THE 401 STAMP (v0.11.0). One line, here, is how a revoked token is
    // noticed no matter which of the four documents hit the wall first.
    //
    // Under continuous capture "signed out" is a state with consequences — the
    // badge, a notification, and the whole capture stream stopping — so it cannot
    // be left to whichever call site happens to have a catch block. This raises a
    // flag on the storage bus; background.js watches it and RE-VALIDATES against
    // /api/ext/auth rather than trusting the flag, so a 401 from a route with its
    // own authorization rules (the PM routes refuse a non-PM) cannot sign anybody
    // out on its own.
    //
    // ⛔ ONLY when the STORED config was used. A call carrying an explicit `auth`
    // is the options page testing a token somebody just typed; a rejected typo
    // must not sign out the working token already in storage.
    if (res.status === 401 && !auth) {
      try { await chrome.storage.local.set({ authFailure: { at: Date.now(), path } }); } catch (e) { /* ignore */ }
    }
  }
  // Parse whatever came back, on BOTH paths. A 4xx from /api/ext/* carries
  // { error, reason, … } and that body is the whole point of apiRequest; a body
  // that is not JSON must not become a parse crash on top of the real failure.
  let data = {};
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

// The throwing wrapper every pre-v0.11.2 call site already expects. Unchanged in
// behaviour: it raises `http_<status>` with `.status`, and now also carries the
// parsed body on `.data` for anything that wants it.
export async function apiFetch(path, opts = {}) {
  const res = await apiRequest(path, opts);
  if (!res.ok) {
    const e = new Error(`http_${res.status}`);
    e.status = res.status;
    e.data = res.data;
    throw e;
  }
  return res.data;
}

// ---- version check ----
// Numeric major.minor.patch compare. Returns 1 / 0 / -1 (a>b / a==b / a<b).
// Missing/short parts count as 0, so "0.3" == "0.3.0".
export function cmpSemver(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function manifestVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (e) {
    return '0.0.0';
  }
}

// The banner/gate decision, factored out of checkVersion() so BOTH the legacy
// /api/ext/version response and the richer /api/ext/health `version` block feed the
// exact same rules.
//
// ⛔ `installed` MUST be THIS build's manifest version. Neither caller passes it —
// both let it default to manifestVersion(). The server's `version.installed` echo is
// NOT a substitute: `team_auth_tokens.ext_version` records whichever machine on that
// token last won the 5-minute stamp throttle. One token is legitimately held by two
// machines (laptop + desktop), and the stamp also lags this machine's own upgrade by
// up to 5 minutes. Feeding that echo in here breaks the gate BOTH ways: a genuinely
// below-min build gets Start ENABLED because a sibling machine stamped a current
// version (the exact thing min_supported exists to prevent), and a freshly-upgraded
// machine gets Start FALSELY BLOCKED for up to 5 minutes. The echo is display-only —
// it belongs in the health footer as "what the server last saw", never in the gate.
// Returns { level: 'none' | 'amber' | 'red', latest, minSupported, downloadUrl, installed }.
//   red   = installed version is below min_supported (hard: block Start)
//   amber = installed version is below latest AND a download_url exists (soft nudge)
//   none  = up to date, ahead, OR behind-latest but no download_url to act on
// `latest` is the version to GO GET; `minSupported` is the floor that failed. The
// health panel needs both — conflating them tells people the wrong minimum.
export function versionStatusFrom({ installed, latest, minSupported, downloadUrl } = {}) {
  const current = installed || manifestVersion();
  const url = downloadUrl || null;
  const min = minSupported || null;

  // Hard floor: below the minimum supported version. Block Start even if there's
  // no download link — the server has declared this build unusable.
  if (min && cmpSemver(current, min) < 0) {
    return { level: 'red', latest: latest || min, minSupported: min, downloadUrl: url, installed: current };
  }
  // Soft nudge: a newer version exists. With no download_url there's nothing to
  // click, so stay silent (handle null gracefully = no banner).
  if (latest && cmpSemver(current, latest) < 0 && url) {
    return { level: 'amber', latest, minSupported: min, downloadUrl: url, installed: current };
  }
  return { level: 'none', latest: latest || null, minSupported: min, downloadUrl: url, installed: current };
}

// GET /api/ext/version -> { latest, min_supported, download_url }.
// Never throws — a failed/unreachable check simply yields no banner. Kept as the
// FALLBACK path for a backend that predates /api/ext/health.
export async function checkVersion() {
  let data;
  try {
    data = await apiFetch('/api/ext/version');
  } catch (e) {
    return { level: 'none' };
  }
  return versionStatusFrom({
    latest: (data && data.latest) || null,
    minSupported: (data && data.min_supported) || null,
    downloadUrl: (data && data.download_url) || null,
  });
}

// ---- health ----
// GET /api/ext/health -> {
//   member_email,
//   hook: { last_seen_at, hours_since, state: 'ok'|'stale'|'never' },
//   ext:  { last_seen_at, hours_since, state },
//   version: { installed, latest, min_supported, download_url },
//   hook_install_url,
// }
// Cached in storage with a short TTL: the popup opens dozens of times a day and OW's
// database has no load headroom, so repeat opens inside the window cost ZERO requests.
export const HEALTH_CACHE_KEY = 'healthCache';
export const HEALTH_TTL_MS = 5 * 60 * 1000; // 5 min — a health signal measured in days
export const HEALTH_STALE_HOURS = 72;       // matches the server's M31 went_silent threshold

// Never throws. Returns { data, fetchedAt, error, cached }.
//   data  = the parsed health payload, or null when it could not be fetched at all
//   error = 'http_<status>' | 'not_configured' | 'unreachable' | null
// A failed refresh falls back to the last good cache (flagged `cached` + `error`) so
// the panel degrades to "as of <time>" instead of going blank.
export async function fetchHealth({ force = false } = {}) {
  let cached = null;
  try {
    const o = await chrome.storage.local.get(HEALTH_CACHE_KEY);
    cached = o[HEALTH_CACHE_KEY] || null;
  } catch (e) { /* storage unavailable — treat as a cold read */ }

  if (!force && cached && cached.data && Date.now() - (cached.fetchedAt || 0) < HEALTH_TTL_MS) {
    return { ...cached, cached: true, error: null };
  }

  let data = null;
  let error = null;
  try {
    data = await apiFetch('/api/ext/health');
  } catch (e) {
    error = e && e.status ? `http_${e.status}` : (e && e.code) || 'unreachable';
  }

  if (error) {
    if (cached && cached.data) return { ...cached, cached: true, error };
    return { data: null, fetchedAt: Date.now(), error, cached: false };
  }

  const fresh = { data, fetchedAt: Date.now() };
  try { await chrome.storage.local.set({ [HEALTH_CACHE_KEY]: fresh }); } catch (e) { /* ignore */ }
  return { ...fresh, error: null, cached: false };
}

/**
 * The last health reading already on this profile — storage only, NEVER a fetch.
 *
 * ⛔ THIS IS FOR PAINTING, NOT FOR DECIDING. It exists so a surface can render its
 * first frame at the height it is about to settle at, instead of painting one
 * state and jumping to another when the live read lands a second later. The
 * consent card measured ~845px → 60px on that jump, which moves the Start button
 * ~785px mid-reach.
 *
 * It is age-bounded at HEALTH_STALE_HOURS — the same window the server calls a
 * reading stale — because the cache itself has no expiry and an unbounded one
 * would let a reading from any point in the past decide the first frame. Past the
 * window this returns null and the surface paints its unknown state, which is the
 * honest one.
 */
export async function readCachedHealth() {
  let cached = null;
  try {
    const o = await chrome.storage.local.get(HEALTH_CACHE_KEY);
    cached = o[HEALTH_CACHE_KEY] || null;
  } catch (e) { return null; }
  if (!cached || !cached.data) return null;
  const age = Date.now() - (cached.fetchedAt || 0);
  if (!(age >= 0) || age > HEALTH_STALE_HOURS * 60 * 60 * 1000) return null;
  return { ...cached, cached: true, error: null };
}

/**
 * 0.11.4 fix round 1 §4 — how old a cached health reading may be and still paint a
 * surface's FIRST frame: 30 minutes, the server's own window for a Claude Code
 * session. Inside it the popup paints its status strip and the sessions block from
 * the last reading the moment it opens, and the side panel and the pop-out paint
 * the sessions block from it, so nothing lands a second later under the cursor; the
 * live read then replaces it. Older than this, nothing is painted from the cache
 * until the live read lands.
 */
export const HEALTH_SEED_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * readCachedHealth(), narrowed to a reading at most `maxAgeMs` old — by default
 * HEALTH_SEED_MAX_AGE_MS, the window a surface's first frame may be painted from.
 * Storage only, never a request; null past the window.
 */
export async function readRecentCachedHealth(maxAgeMs = HEALTH_SEED_MAX_AGE_MS) {
  const seed = await readCachedHealth();
  if (!seed) return null;
  const age = Date.now() - (seed.fetchedAt || 0);
  return age >= 0 && age <= maxAgeMs ? seed : null;
}

// Derive the SAME banner/gate status the legacy checkVersion() returns, from a health
// payload. Returns null when the payload carries no version block (nothing to say).
//
// ⛔ Deliberately does NOT pass `installed` — see versionStatusFrom() above. The gate
// runs on THIS install's manifest version; `v.installed` (the server's echo, possibly
// stamped by a different machine sharing the token) is display-only and is surfaced in
// the health footer instead.
export function healthVersionStatus(health) {
  const v = health && health.data && health.data.version;
  if (!v) return null;
  return versionStatusFrom({
    latest: v.latest || null,
    minSupported: v.min_supported || null,
    downloadUrl: v.download_url || null,
  });
}
