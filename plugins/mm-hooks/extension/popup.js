// popup.js — renders the idle / running / not-connected states and drives the
// service worker via runtime messages. The server's open_entry is the source
// of truth: on open we reconcile local state to whatever the server reports.
//
// ⛔ Every member-facing string in this file was authored by Opus for EXT #13 and
// placed on 2026-09-22 — the `OPUS_COPY —` note above each one is the brief it was
// written to, not an unfilled slot. A new string takes the same route, authored
// first and then placed, and is never written inline here.

import {
  getConfig, getTimers, getQa, isConnected, apiFetch, apiRequest, checkVersion, timerKey, fmtElapsed,
  fetchHealth, healthVersionStatus,
  // v0.11.2 — the LAST reading already on this profile, storage only, no network.
  // 0.11.3: seeds the setup card so its first frame is the one it settles at.
  // 0.11.4 fix round 1: readRecentCachedHealth() is the same read narrowed to 30
  // minutes, and paints the strip and the sessions block on the first frame
  // (paintHealthSeed).
  readCachedHealth, readRecentCachedHealth,
  // ⛔ v0.8.6 — the DELIVERY-QA GATE now lives in common.js and is IMPORTED here, not
  // redefined. The side panel grew a Stop button in this release and calls the exact
  // same functions; a private copy in this file would be the thing that lets the two
  // surfaces drift, and the surface that drifts is the one where the gate quietly
  // stops firing. See the "DELIVERY-QA GATE" section of common.js.
  qaPhaseFor, shouldNudgeWorklog,
  // v0.8.7 — the gate is a PER-BLOCK SET (common.js). There is no "clear it all"
  // export any more, by design: the two bypasses this release closes were both a
  // caller that wiped the single slot for a reason that had nothing to do with the
  // block that owed the QA.
  armPendingQa, resolvePendingQa, setPendingQaPhase,
  getPendingQaAll, getPendingQaFor,
  setStopConfirm, getStopConfirm, clearStopConfirm,
  setWorklogNudge, getWorklogNudge, clearWorklogNudge,
  durationHoursFrom, fmtHours,
  // 0.11.4 — what a running timer is called, which stored timer is a given server
  // entry, and a server entry with the names this profile holds for it. ONE
  // resolution for this run list, the side panel and the pop-out.
  timerDisplayTitle, storedTimerFor, nameOpenEntry,
} from './common.js';
// v0.8.0: the status row and the ranked feed are SHARED with the side panel and
// the popped-out window. One renderer, one cached fetch — the popup used to make
// its own uncached /api/ext/next-task call on every open.
//
// v0.8.3: the TASK LIST is shared too. renderTasks is the panel's renderer, called
// here with the panel's cards, from the same cached payload — see #idle-tasks in
// popup.html for what this replaced and why. startCard is the panel's Start.
import {
  computeIndicators, renderStatusRow, renderTasks, runningSet,
  buildSearchBox, tasksCountText,
  // v0.10.0 — the health strip's lanes and its renderer. IMPORTED, never
  // re-implemented: this file used to hold byte-identical copies of DOT,
  // daysFromHours and fmtSince alongside the only implementation of the lane
  // wording, which is what made "show the same strip in the side panel" mean
  // "write it twice". See panelui.js.
  safeHttpUrl, computeHealthLanes, unavailableHealthLanes,
  healthFootText, renderHealthDetail,
  hookSetupState, // 0.11.3 — the ONE hook decision: strip line, row word, card step
  // v0.12.0 — M2/M5/M7. The toast is the EXISTING component (one .mm-toast per
  // document, panelui.js); the two pinned renderers are shared with the side panel
  // and the pop-out for the same reason everything else here is.
  showToast, renderNextUpLine, renderQaOwedCard,
} from './panelui.js';
import { fetchTaskFeed, buildCards, nextFingerprintOf, filterCards, chipTextFor } from './taskfeed.js';
import { startCard, copyCardChip } from './cardstart.js';
import { closeOutBlock } from './cardclose.js';
// 0.11.3 — the Claude Code setup card. Its markup and its copy live in ONE module
// (consentcard.js) that both this surface and the side panel mount. What it shows
// is decided by panelui.js hookSetupState() from the SERVER's verdict; this file
// only hands it the reading and keeps the reading fresh while a step is due.
// ⛔ THE CARD APPLIES NOTHING, AND NOTHING HERE MOVES IT. A Chrome extension
// cannot write ~/.claude/mm-hooks/consent.json; the installer the card points at
// does. Copying the message is not progress — only the server's verdict advances
// the step or removes the card.
import { renderConsentCard, createSetupPoller } from './consentcard.js';
// The platform, resolved through chrome.runtime — it decides which Terminal
// command the card reveals. consent.js is the one place that is asked.
import { workFolderState } from './consent.js';
// v0.11.0 — the capture notice + the pause control. Same rule as the work-folder
// card above: ONE builder (capturecard.js), ONE set of frozen strings
// (capture.js), mounted by this surface and by the side panel. The notice is the
// entire statement a member reads before anything is recorded, and it must be the
// same paragraph wherever they read it.
import { renderCaptureCard, captureCardAbove } from './capturecard.js';
import { getCapture, CAPTURE_KEY } from './capture.js';
// v0.11.2 — "Your hours". ⛔ MOUNTED, NOT BUILT HERE (2026-09-14, lane L4b): the
// renderer is panelui.js mountHoursPanel(), the same one the side panel and the
// pop-out mount, and the copy, calls and decisions are hours.js. This file only
// decides WHEN the view is shown.
import { COPY as HOURS_COPY } from './hours.js';
import { mountHoursPanel, projectLabel, filterProjects } from './panelui.js';
// 0.11.4 — the Claude Code sessions block (below the controls: placeSessions()):
// what it draws from a health reading (sessionsBlockState), and the ONE renderer
// every surface draws it with (renderSessionsBlock). The side panel and the
// pop-out call the same two.
import { sessionsBlockState, renderSessionsBlock } from './panelui.js';

const $ = (sel) => document.querySelector(sel);
const VIEWS = ['loading', 'notconnected', 'error', 'idle', 'running', 'early', 'qa', 'qacap', 'hours'];
let tick = null;
let qacapTick = null; // polls QA-capture status (shot count) while the capture view is open

// VERBATIM handoff prompt the rep pastes into Claude Code with the exported .zip.
// A Loom video is OPTIONAL — attach one too only if they recorded one; the ZIP alone
// (screenshots + the Q&A the skill runs afterward) is sufficient to finalize. Do NOT
// reword — the qa-doc-generator skill keys off this exact invocation text.
const QA_HANDOFF_PROMPT =
  "Run the qa-doc-generator skill on this QA capture.";

// The early-vs-QA boundary (QA_END_MARGIN_MIN) and the decision built on it
// (qaPhaseFor) moved to common.js in v0.8.6 — see the import block above.

// The block the running timer is attached to (null = unscheduled work). Captured
// whenever the running view renders so Stop knows whether to gate QA, and so the
// extension request can cite the current block.
let currentBlockId = null;
// The linked block's scheduled_end (ISO) for the running timer, so Stop can tell
// an early stop from an at/after-end stop. Null for unscheduled work.
let currentScheduledEnd = null;
// The most recent block list from /blocks, so onStart can resolve a block's
// scheduled_end without re-fetching.
let currentBlocks = [];
// True when the server reports our build is below min_supported — blocks Start.
let blockStartForVersion = false;
// The block the QA gate is showing (drives the capture Start + deliverables lookup).
let qaBlockId = null;
// The block being resolved in the "Ending early?" view.
let earlyBlockId = null;
// The block whose QA capture is in flight — resolved from the qaFinish response
// (i.e. the persisted qa session's block_id) on either entry path (fresh capture
// from the QA gate OR resume from the idle banner). Kept for status/deliverables
// context; the extension no longer POSTs anything block-scoped on Finish.
let qaCapBlockId = null;
// (There is no single "the running timer's start" — v0.5.5 made timers parallel, so
// every Stop reads ITS OWN timer's startedAt out of storage inside onStopBlock,
// BEFORE the stop message clears it. The last single-timer remnant of that, the
// unassigned `currentStartedAt` + stopDurationHours(), was removed in v0.8.6.)

// v0.5.5 PARALLEL: the member's currently-open blocks (server open_entries, each
// { id, started_at, calendar_block_id, note }). Drives the active-blocks list.
let currentOpenEntries = [];
// True when the idle picker was opened as "Start another task" (blocks still run) —
// so the picker shows a "← Back to active blocks" link and Start returns to the list.
let pickerIsAddMode = false;

// The most recent /api/ext/next-task item[0] (the ranked "what next"), or null. Kept
// so the chip's Start/claim button knows the item's type/id/action without re-fetching.
let currentNextItem = null;

// ---- stop / pending-QA persistence (P0-1) ----
// WORKLOG_NUDGE_*, PENDING_KEY/CONFIRM_KEY, the set/get/clear helpers for all three
// storage keys, durationHoursFrom() and fmtHours() all moved to common.js in v0.8.6
// and are imported at the top of this file. They are unchanged in behaviour — they
// are now simply the SAME code the side panel's Stop runs.

// The views that are a STEP the member has to finish. The two pinned strips are
// suppressed while one of these is up: a "what is next" line and a "you owe QA on
// these blocks" card both compete with the question on screen, and the QA card in
// particular would be pointing at the very block the view is already about.
const MODAL_VIEWS = new Set(['early', 'qa', 'qacap']);

/**
 * ⛔ D3/D4 — the running timers are the TOP of the running view. The pinned
 * next-up line sits above <main> on every other view (M7: it must be on screen
 * whichever view is up); while the running view is showing it is moved under the
 * "Start another task" button instead, so a healthy member opens the popup onto
 * their live timers rather than onto what is next.
 */
function placeNextUp(inRunning) {
  const pin = $('#nextup-pinned');
  if (!pin) return;
  if (inRunning) {
    const anchor = $('#run-startanother');
    if (anchor && anchor.nextElementSibling !== pin) anchor.after(pin);
    return;
  }
  const qa = $('#qa-owed-card');
  if (qa && qa.previousElementSibling !== pin) qa.before(pin);
}

/**
 * ⛔ 0.11.4 fix round 1 (Opus, 2026-10-02) — the Claude Code sessions block sits
 * BELOW the controls. Sessions are information; timers, Start, Stop and the action
 * cards are controls, and controls win. Placed directly under the status row, six
 * sessions (427px) pushed every control of a 600px popup below the fold.
 *
 *   every view but the running one   directly after #qa-owed-card: strip, capture
 *                                     card, setup card, next-up line, owed-QA card,
 *                                     sessions, <main>
 *   the running view                  directly after the extension-request form
 *                                     (#ext-form), which follows the next-up line
 *                                     that placeNextUp() moves under "Start
 *                                     another task": run list, Start another task,
 *                                     next-up, the form, sessions
 *
 * ⛔ Fix round 2 (Opus, 2026-10-03) — AFTER THE FORM, NOT BEFORE IT. The first fix
 * round anchored the block on the next-up line itself, which put it above the
 * extension-request form: a member who pressed "Request extension" got the form
 * under the sessions, its Send button off the bottom of the popup. The form is a
 * control and opens where it did on 0.11.3; while it is shut (it almost always is)
 * the block still reads as the thing right under the next-up line.
 *
 * The same idempotent style as placeNextUp(): it moves the host only when it is not
 * already in place. Moving a node drops focus from inside it, so a "Change" picker a
 * member is typing into gets its focus and caret back.
 */
function placeSessions(inRunning) {
  const host = $('#sessions-host');
  if (!host) return;
  const anchor = inRunning ? $('#ext-form') : $('#qa-owed-card');
  if (!anchor || anchor.nextElementSibling === host) return;
  const ae = document.activeElement;
  let kept = null;
  if (ae && ae !== document.body && host.contains(ae)) {
    kept = { el: ae, start: null, end: null };
    try { if (typeof ae.selectionStart === 'number') { kept.start = ae.selectionStart; kept.end = ae.selectionEnd; } } catch (e) { /* not a text field */ }
  }
  anchor.after(host);
  if (!kept) return;
  try {
    kept.el.focus({ preventScroll: true });
    if (kept.start != null) kept.el.setSelectionRange(kept.start, kept.end);
  } catch (e) { /* a move never fails over focus */ }
}

function showView(name) {
  for (const v of VIEWS) $(`#view-${v}`).classList.toggle('hidden', v !== name);
  // ⛔ 0.11.3 — the header's "◷ My hours" reads PRESSED while My hours is open, and
  // pressing it again goes back (see onOpenHours). Set here, where every view
  // change passes, so it cannot disagree with the view on screen.
  const hoursBtn = $('#open-hours');
  if (hoursBtn) hoursBtn.setAttribute('aria-pressed', name === 'hours' ? 'true' : 'false');
  placeNextUp(name === 'running');
  placeSessions(name === 'running');
  const modal = MODAL_VIEWS.has(name);
  const nextPin = $('#nextup-pinned');
  if (nextPin) nextPin.classList.toggle('is-suppressed', modal);
  const qaPin = $('#qa-owed-card');
  if (qaPin) qaPin.classList.toggle('is-suppressed', modal);
  // 0.11.4 fix round 1 — the sessions block steps aside exactly as the two pinned
  // strips do while a step the member must finish is on screen.
  // ⛔ Fix round 2 (Opus, 2026-10-03) — and in MY HOURS. A member who opens My hours
  // came for their hours: six sessions stood above them and pushed "← Back" 194px
  // down the popup. The side panel and the pop-out already put the block away with
  // their task region while My hours is open; the popup now does the same. (The
  // next-up line stays, as it did on 0.11.3.)
  const sessionsPin = $('#sessions-host');
  if (sessionsPin) sessionsPin.classList.toggle('is-suppressed', modal || name === 'hours');
  if (name !== 'running' && tick) {
    clearInterval(tick);
    tick = null;
  }
  if (name !== 'qacap' && qacapTick) {
    clearInterval(qacapTick);
    qacapTick = null;
  }
}

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ---- formatting ----
function fmtRange(a, b) {
  try {
    const opt = { hour: 'numeric', minute: '2-digit' };
    return `${new Date(a).toLocaleTimeString([], opt)} – ${new Date(b).toLocaleTimeString([], opt)}`;
  } catch (e) {
    return '';
  }
}

// Weekday + date + time range, e.g. "Thu, Jul 9 · 2:00 PM – 3:00 PM". Includes the
// month/day so the picker is unambiguous (weekday alone isn't clear across weeks).
function fmtDayRange(a, b) {
  try {
    const day = new Date(a).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} · ${fmtRange(a, b)}`;
  } catch (e) {
    return fmtRange(a, b);
  }
}

// A calendar block whose scheduled DAY is before today (local). Such blocks are
// still selectable (so late QA can be recorded) but move to a collapsed "Past —
// needs QA" section so they don't intermix with today's / upcoming work.
function isPastDay(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return dDay < today;
}

// A block awaiting PM approval — either the PM tagged the event description with
// `[PA]` or the block was self-created (both surfaced by the backend as
// approval_status = 'pending_pm_approval').
function isPendingApproval(b) {
  return b && b.approval_status === 'pending_pm_approval';
}

// Build one selectable picker row (label + radio) as a DOM node. A block already
// being tracked in parallel renders disabled with a "tracking now" badge so it can't
// be double-started.
function buildBlockLabel(b, value, tracking) {
  const title = (b && b.title) || '(untitled block)';
  const metaText = b
    ? [
        b.scheduled_start && b.scheduled_end ? fmtDayRange(b.scheduled_start, b.scheduled_end) : '',
        b.deliverable_ref || '',
      ].filter(Boolean).join('  ·  ')
    : '';
  const estText = b && b.est_hours != null ? `est: ${b.est_hours}h` : '';

  const label = document.createElement('label');
  label.className = tracking ? 'block is-tracking' : 'block';
  const est = estText ? `<span class="est">${escapeHtml(estText)}</span>` : '';
  const badge = tracking
    ? `<span class="badge-tracking">tracking now</span>`
    : (isPendingApproval(b) ? `<span class="badge-pa">pending PM approval</span>` : '');
  const meta = metaText ? `<div class="meta">${escapeHtml(metaText)}</div>` : '';
  label.innerHTML =
    `<input type="radio" name="block" value="${escapeHtml(value)}"${tracking ? ' disabled' : ''} />` +
    `<span><span class="title">${escapeHtml(title)}</span>${est}${badge}${meta}</span>`;
  return label;
}

// The set of block ids currently tracked in parallel (so the picker disables them).
function trackingBlockIds() {
  const s = new Set();
  for (const oe of currentOpenEntries) {
    if (oe.calendar_block_id != null) s.add(String(oe.calendar_block_id));
  }
  return s;
}

// ---- idle view ----
async function renderIdle(blocks) {
  const wrap = $('#blocks');
  wrap.innerHTML = '';

  // Cache the raw list so onStart can look up the selected block's scheduled_end.
  currentBlocks = Array.isArray(blocks) ? blocks : [];

  // List ALL blocks the server returned (today's + upcoming — /blocks already
  // includes them), soonest-first, so a member can Start an upcoming block early.
  // Blocks without a start time sort to the bottom.
  const sorted = currentBlocks.slice().sort((a, b) => {
    const ta = a.scheduled_start ? Date.parse(a.scheduled_start) : Infinity;
    const tb = b.scheduled_start ? Date.parse(b.scheduled_start) : Infinity;
    return ta - tb;
  });

  // Split past-day blocks out from today's / upcoming (P1-5). Past blocks stay
  // selectable but live in a collapsed section so they don't confuse the picker.
  const current = sorted.filter((b) => !isPastDay(b.scheduled_start));
  const past = sorted.filter((b) => isPastDay(b.scheduled_start));

  const tracking = trackingBlockIds();
  for (const b of current) wrap.appendChild(buildBlockLabel(b, String(b.id), tracking.has(String(b.id))));

  // The always-present "Unscheduled work" option.
  const unsched = document.createElement('label');
  unsched.className = 'block';
  unsched.innerHTML =
    `<input type="radio" name="block" value="__unscheduled__" />` +
    `<span><span class="title">Unscheduled work</span>` +
    `<div class="meta">Not on your calendar — add a note</div></span>`;
  wrap.appendChild(unsched);

  if (past.length > 0) {
    const details = document.createElement('details');
    details.className = 'past-section';
    const summary = document.createElement('summary');
    summary.textContent = `Past — needs QA (${past.length})`;
    details.appendChild(summary);
    for (const b of past) details.appendChild(buildBlockLabel(b, String(b.id), tracking.has(String(b.id))));
    wrap.appendChild(details);
  }

  // "← Back to active blocks" when the picker was opened as "Start another task".
  $('#idle-backlist').classList.toggle('hidden', !(pickerIsAddMode && currentOpenEntries.length > 0));

  // Radios are recreated on each render, so bind them here (including any inside
  // the past-section, since it lives within #blocks). The static #start / #note /
  // #refresh listeners are bound once at load (see DOMContentLoaded).
  wrap.querySelectorAll('input[name="block"]').forEach((el) => {
    el.addEventListener('change', onSelectionChange);
  });
  onSelectionChange();
  showView('idle');

  // One-time "✓ time submitted" confirmation after a stop returned here.
  const confirm = await getStopConfirm();
  const cEl = $('#idle-confirm');
  if (confirm) {
    // ⛔ NEVER A CLEAN "submitted" WHILE QA IS OWED.
    //
    // ⛔ v0.12.0 — THIS SUFFIX IS NOW THE NORMAL CASE, not a defensive one. Until
    // this release init() rendered the QA prompt and returned before this view could
    // ever be reached with something owed, and the comment here said so. M5 removed
    // that early return: the requirement is pinned above the list instead of
    // replacing it, so the picker renders WITH work outstanding and this line is the
    // thing that stops it reading as "you are done".
    let owed = [];
    try { owed = await getPendingQaAll(); } catch (e) { /* say the plain thing */ }
    cEl.textContent = owed.length
      ? `✓ Time submitted — ${fmtHours(confirm.durationHours)} saved. QA is still required on ${owed.length} block${owed.length === 1 ? '' : 's'}.`
      : `✓ Time submitted — ${fmtHours(confirm.durationHours)} saved.`;
    cEl.classList.remove('hidden');
    await clearStopConfirm();
  } else {
    cEl.classList.add('hidden');
  }

  // One-time "attach a work log" nudge after a long internal-block stop (Feature 2).
  const nudge = await getWorklogNudge();
  const nEl = $('#idle-worklog-nudge');
  if (nudge) {
    $('#idle-worklog-nudge-text').textContent =
      "Big internal block? You can attach a work log — say 'export my work log' in Claude Code.";
    nEl.classList.remove('hidden');
    await clearWorklogNudge(); // one-time — clear so it doesn't persist across opens
  } else {
    nEl.classList.add('hidden');
  }

  refreshResumeBanner(); // reveal "Resume QA capture" if a bundle is in progress
  refreshNextUp();       // populate the "▶ Next up" chip (refresh on open + manual ↻)
}

// ---- self-serve "New task" creation (Build 3, 2026-07-20) ----
// True once /api/ext/my-projects has been fetched this popup session, so reopening
// the form (toggle off/on) doesn't re-fetch every time.
let newTaskProjectsLoaded = false;
let newTaskProjects = [];

function resetNewTaskForm() {
  $('#newtask-err').classList.add('hidden');
  $('#newtask-ok').classList.add('hidden');
  $('#newtask-title').value = '';
  $('#newtask-desc').value = '';
  $('#newtask-hours').value = '';
  $('#newtask-due').value = '';
  $('#newtask-project').value = '';
  $('#newtask-create').disabled = false;
}

async function onNewTaskToggle() {
  const form = $('#newtask-form');
  const opening = form.classList.contains('hidden');
  if (!opening) {
    form.classList.add('hidden');
    return;
  }
  resetNewTaskForm();
  form.classList.remove('hidden');
  if (!newTaskProjectsLoaded) await loadMyProjects();
  // ⛔ Rob, 2026-08-12: "it should automatically scroll down as well because
  // people are not thinking it's appearing." The form opens below the fold of a
  // 320px popup, so without this it reads as "nothing happened".
  try {
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const q = $('#newtask-project-search');
    if (q) { q.value = ''; renderProjectOptions(newTaskProjects); q.focus(); }
  } catch (_) { /* a scroll failure must never block task creation */ }
}

// Populate the project dropdown from GET /api/ext/my-projects — a constrained list
// of REAL, active projects. This is deliberately the only way to pick a project;
// there is no free-text client field (mirrors the server-side guard in self-task).
// ⛔ SPELLING-FORGIVING SEARCH. The team searched "Kool Kalk" for a project
// recorded as "Cool Calc" (William Fiore — Cool Calc); a plain substring match
// returns nothing, because those letters are not in the row. Folding k->c, ph->f,
// z->s and dropping non-alphanumerics collapses both sides to "coolcalc". It also
// makes "Fiore", "calc" and "cool" all hit, which kills the "do I search the
// client or the project?" question. ⛔ It does NOT solve nicknames (Bill ->
// William): nothing in the row contains "Bill". That needs an aliases field.

// projectLabel() and filterProjects() are imported from panelui.js — ONE label and
// ONE spelling-forgiving search for the New-task picker and the hours picker.

function renderProjectOptions(list) {
  const sel = $('#newtask-project');
  const count = $('#newtask-project-count');
  if (!sel) return;
  const chosen = sel.value;
  sel.innerHTML = '<option value="" disabled selected>Pick a project (required)…</option>';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = projectLabel(p);
    sel.appendChild(opt);
  }
  if (chosen && list.some((p) => p.id === chosen)) sel.value = chosen;
  if (!count) return;
  const total = newTaskProjects.length;
  if (list.length === 0) {
    count.textContent = 'No project matches that. Try part of the client name.';
    count.classList.remove('hidden'); count.classList.add('none');
  } else if (list.length < total) {
    count.textContent = list.length + ' of ' + total + ' projects';
    count.classList.remove('hidden'); count.classList.remove('none');
  } else {
    count.classList.add('hidden'); count.classList.remove('none');
  }
}

async function loadMyProjects() {
  const sel = $('#newtask-project');
  const err = $('#newtask-err');
  try {
    const data = await apiFetch('/api/ext/my-projects');
    const projects = Array.isArray(data.projects) ? data.projects : [];
    newTaskProjects = projects;
    renderProjectOptions(projects);
    const q = $('#newtask-project-search');
    if (q && !q.dataset.wired) {
      q.dataset.wired = '1';
      q.addEventListener('input', () => renderProjectOptions(filterProjects(newTaskProjects, q.value)));
    }
    newTaskProjectsLoaded = true;
    if (projects.length === 0) {
      err.textContent = 'No active projects found — ask a PM.';
      err.classList.remove('hidden');
    }
  } catch (e) {
    err.textContent = e.status ? `Couldn't load projects (HTTP ${e.status}).` : "Couldn't reach the server to load projects.";
    err.classList.remove('hidden');
  }
}

async function onNewTaskCreate() {
  const err = $('#newtask-err');
  err.classList.add('hidden');
  const projectId = $('#newtask-project').value;
  const title = $('#newtask-title').value.trim();
  const description = $('#newtask-desc').value.trim();
  const hoursRaw = $('#newtask-hours').value.trim();
  const dueRaw = $('#newtask-due').value; // yyyy-mm-dd or ''

  if (!projectId) {
    err.textContent = 'Pick a project.';
    err.classList.remove('hidden');
    return;
  }
  if (!title) {
    err.textContent = 'Task title is required.';
    err.classList.remove('hidden');
    $('#newtask-title').focus();
    return;
  }
  const body = { project_id: projectId, title };
  if (description) body.description = description;
  if (hoursRaw) {
    const h = Number(hoursRaw);
    if (Number.isFinite(h) && h > 0) body.est_hours = h;
  }
  if (dueRaw) {
    const d = new Date(`${dueRaw}T17:00:00`); // end-of-day local, simple + predictable
    if (!Number.isNaN(d.getTime())) body.due_at = d.toISOString();
  }

  $('#newtask-create').disabled = true;
  try {
    await apiFetch('/api/ext/self-task', { method: 'POST', body });
  } catch (e) {
    err.textContent = e.status ? `Couldn't create the task (HTTP ${e.status}).` : "Couldn't reach the server.";
    err.classList.remove('hidden');
    $('#newtask-create').disabled = false;
    return;
  }
  $('#newtask-ok').classList.remove('hidden');
  // Refresh the picker so the new block shows up immediately (same as the ↻ button),
  // then collapse the form back down.
  try {
    const data = await apiFetch('/api/ext/blocks?fresh=1');
    await renderIdle(data.blocks);
  } catch (e) { /* the task was created either way; a manual ↻ will pick it up */ }
  setTimeout(() => {
    $('#newtask-form').classList.add('hidden');
    resetNewTaskForm();
  }, 900);
}

// Re-fetch the block list from the server, forcing an on-demand calendar sync
// (?fresh=1) so a just-created event shows without the ~10-min cron lag (P0-2).
async function onRefreshBlocks() {
  const btn = $('#refresh-blocks');
  btn.disabled = true;
  btn.classList.add('spinning');
  $('#idle-err').classList.add('hidden');
  try {
    const data = await apiFetch('/api/ext/blocks?fresh=1');
    await renderIdle(data.blocks);
  } catch (e) {
    const err = $('#idle-err');
    err.textContent = e.status ? `Couldn't refresh (HTTP ${e.status}).` : "Couldn't reach the server to refresh.";
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

function readSelection() {
  const r = document.querySelector('input[name="block"]:checked');
  if (!r) return null;
  // Unscheduled = internal (no client block) time → carries a REQUIRED category.
  if (r.value === '__unscheduled__') {
    return { blockId: null, note: $('#note').value.trim(), category: $('#cat-select').value || '' };
  }
  return { blockId: r.value, note: '', category: '' };
}

function onSelectionChange() {
  const sel = readSelection();
  const unscheduled = sel && sel.blockId === null;
  $('#note-wrap').classList.toggle('hidden', !unscheduled);
  refreshStartDisabled();
  $('#idle-err').classList.add('hidden');
}

// Start is enabled only with a valid selection AND when the version gate allows
// it. A red (below-min_supported) banner forces Start off regardless of selection.
// Internal (unscheduled) work additionally REQUIRES a note AND a category.
function refreshStartDisabled() {
  const sel = readSelection();
  const valid = sel && (
    sel.blockId !== null
      ? true
      : sel.note.length > 0 && !!sel.category
  );
  $('#start').disabled = !valid || blockStartForVersion;
}

async function onStart() {
  // Starting new work supersedes the one-time stop confirmation.
  //
  // ⛔ IT DOES NOT SUPERSEDE AN OUTSTANDING QA REQUIREMENT (changed in v0.8.7). This
  // used to clear the pending gate outright, which made "start anything" a third way
  // to lose a QA that was owed on a completely different block. If the block being
  // started is the one that owed QA, it is running again and init()'s still-open
  // filter already declines to prompt for it — no deletion needed, and stopping it
  // re-arms the same entry.
  await clearStopConfirm();
  const sel = readSelection();
  if (!sel) return;
  if (sel.blockId === null && !sel.note) {
    const err = $('#idle-err');
    err.textContent = 'A note is required for unscheduled work.';
    err.classList.remove('hidden');
    return;
  }
  if (sel.blockId === null && !sel.category) {
    const err = $('#idle-err');
    err.textContent = 'Pick a category for internal work.';
    err.classList.remove('hidden');
    return;
  }
  $('#start').disabled = true;
  // Persist the selected block's scheduled_end so the running timer can gate QA at
  // the block's end and the background can badge/notify when that end passes.
  let scheduledEnd = null;
  if (sel.blockId != null) {
    const b = currentBlocks.find((x) => String(x.id) === String(sel.blockId));
    scheduledEnd = (b && b.scheduled_end) || null;
  }
  const title = sel.blockId != null ? (blockTitle(currentBlocks, sel.blockId) || '') : '';
  const res = await send({
    type: 'start',
    blockId: sel.blockId,
    note: sel.note,
    scheduledEnd,
    title,
    internalCategory: sel.blockId === null ? sel.category : null,
  });
  // ⛔ M2 — EVERY OUTCOME OF THIS PRESS NOW SAYS SOMETHING. Before v0.12.0 the
  // sticky picker's Start was silent on success: the view changed to the running
  // list and that was the entire acknowledgement, so a press that had in fact
  // worked read as a press that did nothing. The card Start has toasted since
  // 2026-08-11 (cardstart.js) — this is the same component, `showToast` from
  // panelui.js, not a second one.
  //
  // ⛔ NO CHIP HERE, AND THAT IS ON PURPOSE. Matching a picker block back to a feed
  // card by block_id would give this press a chip too — for the 17 of 24 client
  // groups that HAVE a block. The other 7 carry none, so the copy would fire
  // sometimes and not others, turning a consistent complaint ("Start says nothing")
  // into an intermittent one ("Start sometimes copies"). The chip has its own
  // always-present control on the card.
  if (res && res.ok && res.started !== false) {
    pickerIsAddMode = false;
    // OPUS_COPY — toast when the picker's Start clocks in successfully. Must
    // convey: the clock is now running on <the block just started>. Short. Must
    // NOT mention the clipboard (nothing was copied on this path) and must NOT
    // claim the task was claimed.
    showToast(document, 'Timer started. The clock is running.');
    renderRunListFromTimers(res.timers);
  } else if (res && res.started === false && res.reason === 'cap') {
    $('#start').disabled = false;
    const err = $('#idle-err');
    err.textContent = 'You already have 4 blocks running — stop one before starting another.';
    err.classList.remove('hidden');
    // OPUS_COPY — toast when Start is refused because four blocks are already
    // running. Must convey: nothing started, you are at the four-block limit, stop
    // one first. Must NOT imply time was lost.
    showToast(document, 'Nothing started. You already have 4 blocks running, which is the limit. Stop one first.');
  } else if (res && res.started === false) {
    // already_open — a SUCCESS, and it must never read as a failure. See the long
    // note in cardstart.js: painting an error over a live, correctly-running timer
    // teaches people to distrust the surface that is telling them the truth.
    // OPUS_COPY — toast when Start is pressed on a block whose clock was already
    // running. Must convey: that clock was already going and is still going.
    // Must NOT read as an error and must NOT say a new timer began.
    showToast(document, 'Already on the clock. That timer is still running.');
    renderRunListFromTimers(res.timers);
  } else {
    $('#start').disabled = false;
    // OPUS_COPY — toast when the picker's Start genuinely failed. Must convey: no
    // timer started, try again. Must NOT invent a cause — the error view below
    // carries the server's own message.
    showToast(document, 'The timer did not start. Try again.');
    showError((res && res.error) || 'Could not start the timer.');
  }
}

// The worker's timers, in the open-entry shape the run list is drawn from. Each
// keeps the two names it is stored with — `title` (what Start was given) and the
// server's `project_name` — because entryView() names the card from them.
function entriesFromTimers(timers) {
  return (Array.isArray(timers) ? timers : []).map((t) => ({
    id: t.entryId,
    started_at: t.startedAt,
    calendar_block_id: t.blockId,
    project_id: t.projectId ?? null,
    title: t.title || '',
    project_name: t.projectName ?? null,
    note: t.note,
  }));
}

// Map the background's timers array → open-entry shape and render the list.
function renderRunListFromTimers(timers) {
  renderRunList(entriesFromTimers(timers));
}

// ---- running view (PARALLEL active-blocks list, v0.5.5) ----
// Resolve display fields for one open entry against the cached block list.
function entryView(oe) {
  const blockId = oe.calendar_block_id != null ? oe.calendar_block_id : null;
  // v0.8.4: a block-less entry carrying a project is CLIENT time, not "Unscheduled
  // work" — it has its own slot, its own Stop handle, and no category selector.
  const projectId = blockId == null ? (oe.project_id ?? null) : null;
  // ⛔ 0.11.4 — the ONE name resolution (common.js timerDisplayTitle), shared with
  // the side panel and the pop-out: the block's title, then the title stored for
  // this entry, then the server's project_name, then the three fallback names.
  const title = timerDisplayTitle({
    blockId,
    projectId,
    blockTitle: blockTitle(currentBlocks, blockId),
    storedTitle: oe.title,
    projectName: oe.project_name,
  });
  const scheduledEnd = blockScheduledEnd(currentBlocks, blockId);
  return {
    blockId,
    projectId,
    key: timerKey(blockId, projectId),
    title,
    scheduledEnd,
    note: oe.note || '',
    startedAt: oe.started_at,
    // D4 — the handle Stop closes. Each card stops ITS entry and nothing else.
    entryId: oe.id ?? null,
  };
}

// Build one active-block card DOM node.
function buildRunCard(ev) {
  const card = document.createElement('div');
  card.className = 'run-card';
  card.dataset.key = ev.key;
  card.dataset.blockId = ev.blockId == null ? '' : String(ev.blockId);
  card.dataset.started = ev.startedAt || '';
  card.dataset.title = ev.title;

  const top = document.createElement('div');
  top.className = 'run-card-top';
  const titleEl = document.createElement('span');
  titleEl.className = 'run-card-title';
  // ⛔ textContent, never markup: since 0.11.4 this can be the server's
  // `project_name`, and a name is text whatever it contains.
  titleEl.textContent = ev.title;
  const clockEl = document.createElement('span');
  clockEl.className = 'run-card-clock';
  clockEl.textContent = ev.startedAt ? fmtElapsed(ev.startedAt) : '00:00:00';
  top.appendChild(titleEl);
  top.appendChild(clockEl);
  card.appendChild(top);

  if (ev.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'run-card-note';
    noteEl.textContent = ev.note;
    card.appendChild(noteEl);
  }

  // Internal (no-block, no-project) work: the category stays changeable while
  // running (v0.5.3). ⛔ A PROJECT timer is client time and never carries a
  // category — the server refuses one on that path, so offering the control here
  // would be a dead input that looks live.
  if (ev.blockId == null && ev.projectId == null) {
    const catSel = document.createElement('select');
    catSel.className = 'cat-select run-card-cat';
    for (const [val, lbl] of [
      ['build', 'Build'], ['rework', 'Rework'], ['client_meeting', 'Client meeting'],
      ['planning', 'Planning'], ['coordination', 'Coordination'],
    ]) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      catSel.appendChild(opt);
    }
    catSel.addEventListener('change', () => {
      const cat = catSel.value || null;
      if (cat) send({ type: 'setCategory', category: cat });
    });
    card.appendChild(catSel);
  }

  // Scheduled-time-up + over-estimate banners (per card; toggled by the tick).
  const sched = document.createElement('div');
  sched.className = 'run-card-sched hidden';
  sched.textContent = "Scheduled time is up — post QA, request an extension, or keep going.";
  card.appendChild(sched);
  const over = document.createElement('div');
  over.className = 'run-card-over hidden';
  card.appendChild(over);

  const actions = document.createElement('div');
  actions.className = 'run-card-actions';
  const stopBtn = document.createElement('button');
  stopBtn.className = 'stop run-card-stop';
  stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', () => onStopBlock(ev.blockId, ev.key, stopBtn, ev.projectId, ev.entryId));
  actions.appendChild(stopBtn);

  // ⛔ D3 (Rob, 2026-09-14) — Stop is the prominent control on the card, and the
  // list's "Start another task" beneath the cards is the other. Request extension
  // and copy-the-client-again move into ONE small More menu: they were two links
  // beside Stop on every card, which made four running timers read as twelve
  // buttons.
  const more = document.createElement('details');
  more.className = 'run-card-more';
  const moreSummary = document.createElement('summary');
  moreSummary.textContent = '⋯';
  // OPUS_COPY — accessible name + tooltip of the small More menu on a running
  // timer's card. One or two words. Must NOT suggest it stops anything.
  moreSummary.title = 'More actions';
  moreSummary.setAttribute('aria-label', moreSummary.title);
  more.appendChild(moreSummary);
  const menu = document.createElement('div');
  menu.className = 'run-card-more-menu';
  more.appendChild(menu);
  const extBtn = document.createElement('button');
  extBtn.className = 'link run-card-ext';
  extBtn.textContent = 'Request extension';
  extBtn.addEventListener('click', () => { more.open = false; onToggleExtForm(ev.blockId, ev.title); });
  menu.appendChild(extBtn);
  actions.appendChild(more);

  // ── M2 — THE RUNNING VIEW HAD NO COPY CONTROL AT ALL ──────────────────────
  //
  // Once a timer is running the popup shows this list and nothing else, so a member
  // who started the clock and then needed the chip again — a new Claude Code
  // session, a closed terminal, a paste that went to the wrong window — had no way
  // to get it without stopping and re-starting the block. There was no copy button
  // on any surface, so there was nowhere else to go either.
  //
  // ⛔ IT RESOLVES THE CHIP THE WAY START ATTACHED THE CLOCK, not by block_id alone.
  // `card.startable` is the exact key the Start that opened this timer used, and it
  // has TWO kinds: 17 of 24 client groups on prod resolve through `block`, 6 through
  // `project`, 1 through neither. Matching on block_id only would find nothing for
  // the 6 project-kind clients — the same "works sometimes" trap that keeps the
  // picker's Start out of the chip business.
  const copyBtn = document.createElement('button');
  copyBtn.className = 'link run-card-copy';
  // OPUS_COPY — the copy control on a RUNNING block's card. Must convey: put this
  // client's chip on the clipboard again. Two or three words, sits beside "Stop"
  // and "Request extension". Must NOT imply it restarts or stops anything.
  copyBtn.textContent = 'Copy chip again';
  copyBtn.addEventListener('click', () => { more.open = false; onRunCardCopy(ev, copyBtn, card); });
  menu.appendChild(copyBtn);

  card.appendChild(actions);

  return card;
}

/**
 * Copy the chip for a RUNNING timer. Finds the feed card whose `startable` names the
 * same block or project this timer is attached to — see the note in buildRunCard.
 */
async function onRunCardCopy(ev, btn, cardEl) {
  const match = idleCards.find((c) => {
    const s = c.startable;
    if (!s) return false;
    if (ev.blockId != null && s.kind === 'block') return String(s.block_id) === String(ev.blockId);
    if (ev.projectId != null && s.kind === 'project') return String(s.project_id) === String(ev.projectId);
    return false;
  });
  if (!match) {
    // ⛔ SAID, NOT SWALLOWED. A timer on unscheduled internal work has no client and
    // therefore no chip, and a client whose card has dropped out of the ranked feed
    // has none to compose from either. Both are real states; a button that appears
    // to do nothing is the failure this whole lane is about.
    // OPUS_COPY — toast when a running block has no chip to copy. Must convey:
    // there is no chip for this timer because it is not attached to a client task in
    // the current feed. Must NOT read as an error or a bug, and must NOT tell them
    // to stop the timer.
    showToast(document, 'There is no chip for this timer. It is not attached to a client task in your current feed.');
    return;
  }
  if (btn) btn.disabled = true;
  const { apiBase, memberEmail } = await chipContext();
  await copyCardChip({ card: match, art: cardEl, doc: document, memberEmail, apiBase });
  if (btn) btn.disabled = false;
}

// Render the full active-blocks list from open entries (server order = newest first;
// show oldest-started first so the list is stable as blocks are added).
function renderRunList(openEntries) {
  currentOpenEntries = Array.isArray(openEntries) ? openEntries.slice() : [];
  const views = currentOpenEntries
    .map(entryView)
    .sort((a, b) => (a.startedAt || '').localeCompare(b.startedAt || ''));

  const wrap = $('#runlist');
  wrap.innerHTML = '';
  for (const ev of views) wrap.appendChild(buildRunCard(ev));

  const n = views.length;
  $('#run-count').textContent = n > 1 ? `· ${n} active` : '';
  resetExtForm();

  const updateAll = () => updateRunCards();
  updateAll();
  if (tick) clearInterval(tick);
  tick = setInterval(updateAll, 1000);

  showView('running');
  // ⛔ THE STATUS LINE FOLLOWS THE RUN LIST. It was painted once, when health
  // landed, from chrome.storage.local — so the line read "Timer: Not tracking"
  // above a list this function had just drawn from the server's open entries.
  paintStatusRow(currentHealth);
  refreshNextUp();
}

// Per-second update of every card's clock + its over-estimate / scheduled-end banners.
async function updateRunCards() {
  let schedEndBlocks = {};
  try {
    const o = await chrome.storage.local.get('schedEndBlocks');
    schedEndBlocks = o.schedEndBlocks || {};
  } catch (e) { /* leave empty */ }
  document.querySelectorAll('#runlist .run-card').forEach((card) => {
    const started = card.dataset.started;
    if (started) card.querySelector('.run-card-clock').textContent = fmtElapsed(started);
    const blockId = card.dataset.blockId || null;
    // Over-estimate.
    const overEl = card.querySelector('.run-card-over');
    const planned = blockId ? plannedHoursForBlock(blockId) : null;
    const tracked = durationHoursFrom(started);
    if (planned != null && tracked != null && tracked > planned) {
      overEl.textContent = `Over block estimate (${tracked.toFixed(1)}h / ${planned.toFixed(1)}h planned) — request an extension or wrap up.`;
      overEl.classList.remove('hidden');
    } else {
      overEl.classList.add('hidden');
    }
    // Scheduled-time-up (per-block flag set by the background alarm).
    const schedEl = card.querySelector('.run-card-sched');
    const overdue = !!(blockId && schedEndBlocks[card.dataset.key]);
    schedEl.classList.toggle('hidden', !overdue);
  });
}

// Planned hours for a block: its est_hours, else its scheduled duration, else null.
function plannedHoursForBlock(blockId) {
  const b = currentBlocks.find((x) => String(x.id) === String(blockId));
  if (!b) return null;
  if (b.est_hours != null && Number.isFinite(Number(b.est_hours))) return Number(b.est_hours);
  if (b.scheduled_start && b.scheduled_end) {
    const ms = Date.parse(b.scheduled_end) - Date.parse(b.scheduled_start);
    if (Number.isFinite(ms) && ms > 0) return ms / 3600000;
  }
  return null;
}

// Stop ONE block. Other parallel blocks keep running. The per-block QA / ending-early
// flow fires exactly as before, then returns to the list (or the picker if this was
// the last block).
async function onStopBlock(blockId, key, btn, projectId = null, entryId = null) {
  if (btn) btn.disabled = true;
  const stoppedBlockId = blockId != null ? blockId : null;
  const stoppedProjectId = stoppedBlockId == null ? (projectId || null) : null;
  const stoppedTitle = blockTitle(currentBlocks, stoppedBlockId) || '';
  const stoppedSchedEnd = blockScheduledEnd(currentBlocks, stoppedBlockId);
  // Compute committed duration + read the internal category BEFORE the stop clears
  // the local timer (background flushes the timer_stop before this resolves).
  let startedAt = null;
  let stoppedCategory = null;
  try {
    const t = (await getTimers()).find((x) => x.key === (key || timerKey(stoppedBlockId, stoppedProjectId)));
    startedAt = t ? t.startedAt : null;
    stoppedCategory = t && t.blockId == null ? (t.internalCategory || null) : null;
  } catch (e) { /* storage unavailable */ }
  const durationHours = durationHoursFrom(startedAt);

  // D4 — the key and entry id of THIS card, so the worker stops this timer and no
  // other. The block/project pair stays for a worker that predates the handle.
  const res = await send({ type: 'stop', blockId: stoppedBlockId, projectId: stoppedProjectId, key: key || null, entryId: entryId ?? null });
  if (!(res && res.ok)) {
    if (btn) btn.disabled = false;
    showError((res && res.error) || 'Could not stop the timer.');
    return;
  }
  currentOpenEntries = entriesFromTimers(res.timers);
  const savedAtIso = new Date().toISOString();
  await setStopConfirm({ durationHours, savedAtIso, blockId: stoppedBlockId });

  if (stoppedBlockId == null) {
    // Internal / unscheduled work has no QA deliverable — it arms no gate.
    //
    // ⛔ AND IT MUST NOT RESOLVE ANYONE ELSE'S. This line was clearPendingFinalize()
    // through v0.8.6 — stop a client block, then stop any internal or project timer,
    // and the armed requirement was gone (BYPASS A; the panel had the identical
    // line). resolvePendingQa(null) is a no-op: this stop may only resolve its own
    // non-existent entry.
    await resolvePendingQa(null);
    if (shouldNudgeWorklog(stoppedCategory, durationHours)) {
      await setWorklogNudge({ category: stoppedCategory, durationHours, savedAtIso });
    }
    // Other blocks still running → back to the list. Otherwise re-enter init(), which
    // drains any QA still owed from an EARLIER stop before it ever shows the picker.
    if (currentOpenEntries.length > 0) renderRunList(currentOpenEntries);
    else init();
    return;
  }

  // Block-linked: the QA gate fires at the block's END, not on every Stop.
  // ⛔ qaPhaseFor() is the SHARED decision (common.js) — the panel's Stop resolves the
  // phase through this same function, so the two surfaces cannot disagree about when
  // QA is owed. A missing/unparseable scheduled_end returns 'qa' and ARMS the gate.
  //
  // v0.8.7: armPendingQa ADDS this block to the pending set. It used to overwrite the
  // one key, so stopping block A and then block B dropped A's requirement without a
  // trace (BYPASS B) — realistic at end of day, since the server lets a member run
  // four blocks in parallel.
  const phase = qaPhaseFor(stoppedSchedEnd);
  await armPendingQa({ blockId: stoppedBlockId, blockTitle: stoppedTitle, phase, durationHours, savedAtIso });
  if (phase === 'early') renderEndingEarly(stoppedBlockId, durationHours);
  else renderQa(stoppedBlockId, durationHours);
}

/**
 * The next QA the member owes, oldest first — skipping any block that is somehow
 * running again (starting a block does not delete its requirement; a running block
 * simply is not something to prompt about yet).
 */
async function nextOutstandingQa() {
  let all = [];
  try { all = await getPendingQaAll(); } catch (e) { return null; }
  const open = new Set(currentOpenEntries.map((oe) => String(oe.calendar_block_id)));
  return all.find((p) => p.blockId != null && !open.has(String(p.blockId))) || null;
}

/**
 * ⛔ THE DRAIN. Called after ONE requirement is resolved.
 *
 * A member who stopped three blocks owes three QAs. Finishing one used to fall
 * straight back to the running list / picker on the assumption that the single
 * pending slot was now empty; with a per-block set that assumption is simply wrong,
 * so the next outstanding block is surfaced instead, with the "saved — QA still
 * needed" banner rather than a fresh-stop one.
 */
async function drainNextQa() {
  // The pinned card is a reading of the same set, so it repaints whenever the set
  // changes — otherwise a QA the member just finished stays listed above the tasks.
  await mountQaOwed();
  const next = await nextOutstandingQa();
  if (!next) { renderRunListFromState(); return; }
  if (next.phase === 'early') renderEndingEarly(next.blockId, next.durationHours, true);
  else renderQa(next.blockId, next.durationHours, true);
}

/**
 * M5 — paint the pinned QA-owed card from the per-block set in storage.
 *
 * ⛔ IT LISTS THE WHOLE SET, not just the next one. The old prompt showed one block
 * at a time because it WAS the view and had to be; a pinned card has no such
 * constraint, and "QA is owed on three blocks" is the fact a member needs in order
 * to plan the rest of their day.
 *
 * ⛔ A BLOCK THAT IS RUNNING AGAIN IS STILL LISTED. nextOutstandingQa() filters
 * those out because it decides which prompt to SHOW, and prompting for a block
 * whose clock is live would be asking about work in progress. The card is a
 * statement of what is owed, not a prompt, and a re-started block still owes its
 * QA the moment it is stopped again.
 */
async function mountQaOwed() {
  const host = $('#qa-owed-card');
  if (!host) return;
  let owed = [];
  try { owed = await getPendingQaAll(); } catch (e) { owed = []; }
  renderQaOwedCard(host, owed, {
    onResume: (entry) => {
      if (entry.phase === 'early') renderEndingEarly(entry.blockId, entry.durationHours, true);
      else renderQa(entry.blockId, entry.durationHours, true);
    },
  });
}

// Render the active-blocks list from the last-known open entries (used by the modal
// views' "← Back to active blocks" link). No re-fetch — cheap and instant.
function renderRunListFromState() {
  if (currentOpenEntries.length > 0) renderRunList(currentOpenEntries);
  else init();
}

// Fill a "your N.Nh were saved" banner. `reopened` = the popup was re-opened onto
// a prompt that was showing at click-away time (emphasise QA is still needed).
function populateSavedBanner(sel, durationHours, reopened) {
  const el = $(sel);
  if (!el) return;
  if (durationHours == null && !reopened) {
    el.classList.add('hidden');
    return;
  }
  el.textContent = reopened
    ? `✓ ${fmtHours(durationHours)} saved — QA still needed.`
    : `✓ ${fmtHours(durationHours)} submitted — finish QA below.`;
  el.classList.remove('hidden');
}

// ---- ending-early prompt (block-linked stop well before scheduled_end) ----
function renderEndingEarly(blockId, durationHours, reopened) {
  earlyBlockId = blockId;
  populateSavedBanner('#early-saved', durationHours, reopened);
  // Other blocks still tracking → offer a way back to the active-blocks list.
  $('#early-backlist').classList.toggle('hidden', currentOpenEntries.length === 0);
  showView('early');
}

// "Not done yet — I'll continue later": the session is already stopped; no QA,
// no PM notification — just return to the picker (which confirms the hours saved).
async function onEarlyContinueLater() {
  // Resolves THIS block only — "I'll continue later" is an answer about this block,
  // not about any other block whose QA is still owed. Then drain the rest.
  await resolvePendingQa(earlyBlockId);
  await drainNextQa();
}

// "Finished early → post QA": route into the normal QA attestation.
async function onEarlyFinishedEarly() {
  // ⛔ Read and update THIS block's entry, not "the" pending one. With parallel
  // blocks the oldest outstanding requirement is often a different block entirely,
  // and moving its phase to 'qa' would answer a question nobody was asked.
  const pending = await getPendingQaFor(earlyBlockId);
  const dur = pending ? pending.durationHours : null;
  await setPendingQaPhase(earlyBlockId, 'qa');
  renderQa(earlyBlockId, dur);
}

// ---- request-extension form (running view, per-block) ----
function resetExtForm() {
  $('#ext-form').classList.add('hidden');
  $('#ext-reason').value = '';
  $('#ext-overage').value = '';
  // Restore any fields the success state collapsed.
  for (const sel of ['#ext-reason', '#ext-overage', '#ext-send']) $(sel).classList.remove('hidden');
  $('#ext-err').classList.add('hidden');
  $('#ext-ok').classList.add('hidden');
  $('#ext-send').disabled = false;
}

// Open the shared extension-request form targeting a specific block (the card whose
// "Request extension" link was clicked). currentBlockId drives onSendExtRequest.
function onToggleExtForm(blockId, title) {
  currentBlockId = blockId != null ? blockId : null;
  $('#ext-for').textContent = title ? `For: ${title}` : '';
  $('#ext-form').classList.remove('hidden');
  $('#ext-ok').classList.add('hidden');
  $('#ext-reason').focus();
}

async function onSendExtRequest() {
  const errEl = $('#ext-err');
  // Reason is OPTIONAL (P1-4). When blank, send a sensible default so the PM ping
  // still carries context — the backend requires a non-empty reason.
  const typed = $('#ext-reason').value.trim();
  const reason = typed || 'More time needed on this block.';
  const overageRaw = $('#ext-overage').value.trim();
  const projected = overageRaw === '' ? null : Number(overageRaw);
  const body = { block_id: currentBlockId, reason };
  if (projected != null && !Number.isNaN(projected)) body.projected_overage = projected;

  $('#ext-send').disabled = true;
  errEl.classList.add('hidden');
  try {
    await apiFetch('/api/ext/extension-request', { method: 'POST', body });
    $('#ext-ok').classList.remove('hidden');
    // Collapse the inputs + Send; keep Cancel so they can close the form.
    $('#ext-reason').classList.add('hidden');
    $('#ext-overage').classList.add('hidden');
    $('#ext-send').classList.add('hidden');
  } catch (e) {
    errEl.textContent = e.status ? `Couldn't send (HTTP ${e.status}). Try again.` : 'Couldn’t reach the server. Try again.';
    errEl.classList.remove('hidden');
    $('#ext-send').disabled = false;
  }
}

// ---- end-of-block QA gate ----
// Just the QA-walkthrough capture start. The legacy pre-capture email attestation
// (checkbox + Done) was removed. The extension no longer submits any attestation or
// uploads a finalize.zip — Claude Code now saves the doc + work-log + Q&A directly to
// Supabase and calls /api/ext/qa-finalize itself. Finish just closes the capture UI.
function renderQa(blockId, durationHours, reopened) {
  qaBlockId = blockId;
  populateSavedBanner('#qa-saved', durationHours, reopened);
  // Other blocks still tracking → offer a way back to the active-blocks list.
  $('#qa-backlist').classList.toggle('hidden', currentOpenEntries.length === 0);
  // Decision step (v0.5.6): reset to the two-choice prompt. Start QA reveals the
  // capture launch; No QA required reveals the short-note form. Hide the capture
  // launch + the note form + any prior confirmation/error until a choice is made.
  $('#qa-decision').classList.remove('hidden');
  document.querySelector('.qacap-launch').classList.add('hidden');
  $('#qa-noqa-form').classList.add('hidden');
  $('#qa-noqa-done').classList.add('hidden');
  $('#qa-noqa-err').classList.add('hidden');
  $('#qa-noqa-note').value = '';
  $('#qa-noqa-submit').disabled = false;
  // Show the block's deliverables above the "Record QA walkthrough" (Start QA)
  // button so the rep reads them before recording.
  fillDeliverables('#qa-deliv-list', '#qa-deliv-empty', blockId);
  showView('qa');
}

// Decision step → "Start QA": reveal the existing Loom/QA capture launch. The QA
// path itself (Record QA walkthrough → capture → Claude Code finalize) is unchanged.
function onQaStartQa() {
  $('#qa-decision').classList.add('hidden');
  document.querySelector('.qacap-launch').classList.remove('hidden');
}

// Decision step → "No QA required": reveal the short-note form and focus it.
function onQaNoQaToggle() {
  $('#qa-noqa-done').classList.add('hidden');
  $('#qa-noqa-err').classList.add('hidden');
  $('#qa-noqa-form').classList.remove('hidden');
  $('#qa-noqa-note').focus();
}

// Minimum trimmed length for a no-QA note (mirrors the server's guard).
const NOQA_MIN_LEN = 4;

// Submit the no-QA note: record it server-side (closes the block with the note on
// file — no video, no doc), confirm "✓ logged: <note>", then return to active blocks.
async function onNoQaSubmit() {
  const err = $('#qa-noqa-err');
  const note = $('#qa-noqa-note').value.trim();
  if (note.length < NOQA_MIN_LEN) {
    err.textContent = 'Add a short line about what this was (a few words).';
    err.classList.remove('hidden');
    $('#qa-noqa-note').focus();
    return;
  }
  err.classList.add('hidden');
  $('#qa-noqa-submit').disabled = true;
  try {
    await apiFetch('/api/ext/block-complete-note', {
      method: 'POST',
      body: { block_id: qaBlockId, note },
    });
  } catch (e) {
    err.textContent = e.status
      ? `Couldn't log it (HTTP ${e.status}). Try again.`
      : 'Couldn’t reach the server. Try again.';
    err.classList.remove('hidden');
    $('#qa-noqa-submit').disabled = false;
    return;
  }
  // Recorded — THIS block's pending-QA prompt is resolved (and only this one).
  // Confirm, then move to the next block that still owes QA; the active-blocks list
  // or the picker is where drainNextQa lands when nothing is left.
  await resolvePendingQa(qaBlockId);
  $('#qa-noqa-form').classList.add('hidden');
  const done = $('#qa-noqa-done');
  done.textContent = `✓ Logged: ${note}`;
  done.classList.remove('hidden');
  setTimeout(drainNextQa, 1200);
}

// ---- QA-capture walkthrough (mic + click screenshots -> downloadable .zip) ----
// Distinct from the attestation above and from the always-on activity proof. Started
// from the end-of-block QA gate (or Resumed from the idle banner). The service worker
// owns the session; the popup just drives start/finish + shows live status.
async function onQaCaptureStart() {
  const cfg = await getConfig();
  const title = blockTitle(currentBlocks, qaBlockId) || '';
  $('#qa-capture-start').disabled = true;
  const res = await send({ type: 'qaStart', blockId: qaBlockId, blockTitle: title, email: cfg.email || '', resume: false });
  $('#qa-capture-start').disabled = false;
  if (res && res.ok) renderQaCap(res.qa);
  else showError((res && res.error) || 'Could not start QA capture.');
}

async function onQaCaptureResume() {
  $('#qa-resume').disabled = true;
  const res = await send({ type: 'qaStart', resume: true });
  $('#qa-resume').disabled = false;
  if (res && res.ok) renderQaCap(res.qa);
  else showError((res && res.error) || 'Could not resume QA capture.');
}

// (a) Recording sub-view. Entered on start, resume, and every "Keep going" loop.
function renderQaCap(qa) {
  $('#qacap-recording').classList.remove('hidden');
  // Keep the deliverables pinned + collapsible while filming. Resolve the block id
  // from the QA-gate context first, then the capture session (covers the resume
  // path where qaBlockId was never set this popup open).
  const capBlockId = qaBlockId != null ? qaBlockId
    : (qaCapBlockId != null ? qaCapBlockId
    : (qa && (qa.block_id != null ? qa.block_id : qa.blockId)));
  fillDeliverables('#qacap-deliv-list', '#qacap-deliv-empty', capBlockId);
  $('#qacap-guidance').classList.add('hidden');
  $('#qacap-final').classList.add('hidden');
  $('#qacap-err').classList.add('hidden');
  $('#qacap-finish').classList.remove('hidden');
  $('#qacap-finish').disabled = false;
  updateQaCapStatus(qa);
  showView('qacap');
  if (qacapTick) clearInterval(qacapTick);
  qacapTick = setInterval(pollQaCap, 1000);
}

async function pollQaCap() {
  const r = await send({ type: 'qaStatus' });
  if (r && r.ok) updateQaCapStatus(r.qa);
}

function updateQaCapStatus(qa) {
  if (!qa) return;
  const n = qa.shotCount || 0;
  $('#qacap-count').textContent = `${n} ${n === 1 ? 'shot' : 'shots'}`;
}

// Stop capture: end the session (mic off, click-shots off), export + auto-download
// the .zip, then surface the guidance card. The session data is KEPT so "Keep going"
// can resume-append and re-export a superset.
async function onQaCapFinish() {
  $('#qacap-finish').disabled = true;
  $('#qacap-err').classList.add('hidden');
  if (qacapTick) { clearInterval(qacapTick); qacapTick = null; } // stop polling; recording is ending
  const res = await send({ type: 'qaFinish' });
  if (res && res.ok) {
    qaCapBlockId = res.block_id != null ? res.block_id : (qaBlockId != null ? qaBlockId : null);
    showQaGuidance(res);
  } else {
    // Session is already inactive; a repeat Stop re-exports. Keep the rep on the
    // recording view with the error visible.
    $('#qacap-err').textContent = `Couldn't build the capture: ${(res && res.error) || 'unknown error'}.`;
    $('#qacap-err').classList.remove('hidden');
    $('#qacap-finish').disabled = false;
  }
}

// (b) Guidance card. The .zip already auto-downloaded on Stop — echo that here, show
// the verbatim handoff prompt + Copy button, and offer a re-download.
function showQaGuidance(res) {
  $('#qacap-recording').classList.add('hidden');
  $('#qacap-final').classList.add('hidden');
  $('#qacap-guidance').classList.remove('hidden');
  $('#qacap-prompt').textContent = QA_HANDOFF_PROMPT;
  $('#qacap-copy-status').classList.add('hidden');
  $('#qacap-err2').classList.add('hidden');
  // Non-blocking note when the Loom upload token couldn't be minted at start — the
  // capture still succeeded; the doc skill just can't auto-upload the Loom video.
  const tokenNote = res && res.upload_token_error
    ? ' (Loom upload token unavailable — you may need to attach the Loom link manually.)'
    : '';
  const ds = $('#qacap-download-status');
  ds.textContent = `✓ Downloaded ${(res && res.filename) || 'the .zip'} (${(res && res.shots) || 0} shots).${tokenNote}`;
  ds.classList.remove('hidden', 'err');
  ds.classList.add('ok');
  $('#qacap-copy').disabled = false;
  $('#qacap-download').disabled = false;
  $('#qacap-keepgoing').disabled = false;
  $('#qacap-finishdone').disabled = false;
  showView('qacap');
}

// Copy the verbatim handoff prompt to the clipboard.
async function onQaCopyPrompt() {
  const ok = await copyText(QA_HANDOFF_PROMPT);
  const s = $('#qacap-copy-status');
  s.textContent = ok ? '✓ Prompt copied' : 'Copy failed — select the text above and copy manually.';
  s.classList.remove('hidden');
  s.classList.toggle('ok', ok);
  s.classList.toggle('err', !ok);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the execCommand path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

// Re-export + re-download the .zip (no state change — the session stays finished).
async function onQaDownloadAgain() {
  $('#qacap-download').disabled = true;
  const res = await send({ type: 'qaExport' });
  $('#qacap-download').disabled = false;
  const s = $('#qacap-download-status');
  if (res && res.ok) {
    s.textContent = `✓ Downloaded ${res.filename || 'the .zip'} (${res.shots || 0} shots).`;
    s.classList.remove('hidden', 'err');
    s.classList.add('ok');
  } else {
    s.textContent = `Couldn't build the .zip: ${(res && res.error) || 'unknown error'}.`;
    s.classList.remove('hidden', 'ok');
    s.classList.add('err');
  }
}

// "Keep going" — resume the SAME session (resume-append) and drop back into the
// recording sub-view. Stopping again re-exports the superset + reshows the guidance.
async function onQaKeepGoing() {
  $('#qacap-keepgoing').disabled = true;
  const res = await send({ type: 'qaStart', resume: true });
  $('#qacap-keepgoing').disabled = false;
  if (res && res.ok) renderQaCap(res.qa);
  else showError((res && res.error) || 'Could not resume QA capture.');
}

// "Finish" — close the QA-capture UI and show the final confirmation card.
// Claude Code now saves the doc + work-log + Q&A directly to Supabase and calls
// /api/ext/qa-finalize itself, so there is nothing for the rep to upload here.
function onQaFinishDone() {
  showQaFinal();
}

// (c) Final confirmation card. No upload, no attestation — Claude Code already
// persisted everything and notified the PM. THIS block's pending-QA prompt is now
// resolved; any other block that still owes QA keeps owing it, and the card's "Back"
// re-enters init(), which surfaces the next one instead of the picker.
async function showQaFinal() {
  await resolvePendingQa(qaBlockId);
  $('#qacap-recording').classList.add('hidden');
  $('#qacap-guidance').classList.add('hidden');
  $('#qacap-final').classList.remove('hidden');
  showView('qacap');
}

// Reveal the idle-view Resume affordance when a QA-capture bundle exists.
async function refreshResumeBanner() {
  try {
    const qa = await getQa();
    const show = !!qa.hasSession;
    $('#qa-resume-wrap').classList.toggle('hidden', !show);
    if (show) $('#qa-resume-count').textContent = String(qa.shotCount || 0);
  } catch (e) { /* storage unavailable — leave the banner hidden */ }
}

// ---- helpers ----
function blockTitle(blocks, blockId) {
  if (!blockId || !blocks) return null;
  const b = blocks.find((x) => String(x.id) === String(blockId));
  return b ? b.title : null;
}

function blockScheduledEnd(blocks, blockId) {
  if (!blockId || !blocks) return null;
  const b = blocks.find((x) => String(x.id) === String(blockId));
  return (b && b.scheduled_end) || null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- deliverables (block description) ----
// Calendar event descriptions arrive as free text — one deliverable per line, or a
// single line flattened with bullet glyphs. Split on both, strip leading list
// markers (-, *, –, —, 1., 2)), and drop blanks. If nothing splits out but the
// text is non-empty, keep the whole thing as one item so we never silently swallow it.
function parseDeliverables(text) {
  if (!text) return [];
  const parts = String(text).split(/\r?\n|•|●|‣|▪|◦/);
  const items = [];
  for (let p of parts) {
    p = p.replace(/^\s*(?:[-*–—]|\d+[.)])\s+/, '').trim();
    if (p) items.push(p);
  }
  if (items.length === 0) {
    const whole = String(text).trim();
    if (whole) items.push(whole);
  }
  return items;
}

// Resolve a block's deliverables to display items. Falls back to the block title
// when there's no description, and to a null result when there's neither a
// description nor a usable title (e.g. unscheduled / untitled) so callers can show
// the "no deliverables" empty state. Never throws — QA flow must not be blocked.
function deliverableItems(blockId) {
  const b = currentBlocks.find((x) => String(x.id) === String(blockId));
  const raw = b && typeof b.deliverables === 'string' ? b.deliverables.trim() : '';
  let items = parseDeliverables(raw);
  if (items.length === 0) {
    const title = b && b.title ? String(b.title).trim() : '';
    if (title && title !== '(untitled block)') items = [title];
  }
  return items;
}

// Populate a <ul> + empty-state <p> pair with the block's deliverables.
function fillDeliverables(listSel, emptySel, blockId) {
  const listEl = $(listSel);
  const emptyEl = $(emptySel);
  if (!listEl || !emptyEl) return;
  const items = deliverableItems(blockId);
  listEl.innerHTML = '';
  if (items.length === 0) {
    emptyEl.textContent = 'No deliverables listed for this block';
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.textContent = it; // textContent — never inject block text as HTML
    listEl.appendChild(li);
  }
  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');
}

// ---- version banner ----
function applyVersionBanner(status) {
  status = status || { level: 'none' };
  blockStartForVersion = status.level === 'red';
  const banner = $('#banner');

  if (status.level === 'none') {
    banner.className = 'banner hidden';
    banner.textContent = '';
  } else {
    const v = status.latest ? `v${status.latest}` : 'a new version';
    const label = status.level === 'red' ? `Update required (${v})` : `Update available (${v})`;
    const link = safeHttpUrl(status.downloadUrl);
    banner.className = `banner ${status.level}`;
    if (link) {
      banner.innerHTML = `${escapeHtml(label)} — <a href="${escapeHtml(link)}" target="_blank" rel="noopener">download &amp; reload</a>`;
    } else {
      banner.textContent = `${label} — download & reload`;
    }
  }
  // Reflect the Start gate right away if the picker is already on screen.
  if (!$('#view-idle').classList.contains('hidden')) refreshStartDisabled();
}

// ---- health panel (GET /api/ext/health) ----
// TWO INDEPENDENT indicators — the Claude Code hook and this extension are separate
// tools that fail separately. A dead hook must NEVER stop someone logging time; only
// the min_supported version floor blocks Start, exactly as it did before this panel.
// ⛔ THE LANES MOVED TO panelui.js IN v0.10.0 — HEALTH_DOT, daysFromHours, fmtSince,
// extIndicator, feedIndicator and hookIndicator all used to live here, the first three
// of them byte-identical to exports that already existed next door. Delete-and-import,
// not copy-and-adapt: the side panel now draws the SAME three lanes from the SAME
// functions, and there is no second place for the wording to drift.

// v0.8.0 — the SHARED three-indicator status row (Chips · Hooks · Timer) in the
// health strip's summary. Same renderer and same wording as the side panel and
// the popped-out window; the popup just has nowhere to expand a per-indicator
// explanation, so each dot carries it as a tooltip and the <details> body below
// holds the actionable version.
let currentHealth = null;
let currentFeed = null;
// v0.11.0 — the feed lane stopped being a fixed sentence and became a READING of
// this profile's capture gate, so the strip needs the same state the capture card
// renders from. Held here — with the version status and which of the two health
// paths was taken — so a pause taken on the side panel, or a 401 signing this
// profile out, can repaint the lane without re-fetching /api/ext/health.
let currentCapture = null;
let currentVersionStatus = null;
let healthReachable = false;
// The idle view's task list, its search box and its query. Module state because
// the box is mounted ONCE (mountIdleSearch) while renderIdleTasks re-runs on every
// feed refresh — holding the query on the input alone would lose it to a refresh.
let idleCards = [];
let idleFeed = null;
let idleSearch = null;
let idleQuery = '';
// 0.11.3 — each Claude Code session's "Change" picker. After a save it re-reads
// health FORCED (past the 5-minute cache, as Re-check does) so the session's line
// shows the task that was just saved.
const SESSION_DEPS = Object.freeze({ onTaskSaved: () => refreshHealth(true) });

/**
 * 0.11.4 — the Claude Code sessions block, in #sessions-host: visible without
 * opening the strip, below every control (placeSessions), up to six sessions, and
 * the folders being recorded. Painted from the SAME health envelope as the strip,
 * by the same renderer the side panel and the pop-out use; `null` (the server could
 * not be reached) draws nothing and forgets nothing.
 */
function paintSessions(health) {
  renderSessionsBlock(document, $('#sessions-host'), sessionsBlockState(health), SESSION_DEPS);
}

function paintStatusRow(health) {
  currentHealth = health;
  const host = $('#health-status');
  if (!host) return;
  getTimers()
    .catch(() => [])
    .then((timers) => {
      const cards = buildCards(currentFeed && currentFeed.data, Date.now());
      renderStatusRow(
        host,
        computeIndicators({
          health: currentHealth,
          feed: currentFeed,
          // ⛔ The SAME running set the run list is drawn from: local timers plus the
          // server's open entries this popup is showing. See renderRunList().
          timers: runningSet(timers, currentOpenEntries),
          cards,
          capture: currentCapture,
        }),
      );
    });
}

// Render the strip from a health payload. Auto-expands when ANYTHING is not green so
// a broken hook is impossible to miss; stays collapsed (two green dots) when fine.
//
// `{ seed: true }` (0.11.4 fix round 1) paints the FIRST frame from the last reading
// on this profile (paintHealthSeed) — the strip, its auto-open state and the
// sessions block, so that nothing lands under the cursor a second later — and
// decides nothing: the setup card keeps its own seed and its live hand-off
// (applySetupState), and the banner and the Start gate wait for the live read.
function renderHealth(health, versionStatus, { seed = false } = {}) {
  const panel = $('#health');
  currentVersionStatus = versionStatus;
  healthReachable = true;
  const lanes = computeHealthLanes({ health, versionStatus, capture: currentCapture });
  const byKey = Object.fromEntries(lanes.map((l) => [l.key, l]));

  paintStatusRow(health);
  renderHealthDetail(document, $('#health-rows'), lanes);
  paintSessions(health);
  $('#health-foot').textContent = healthFootText(health);
  // ⛔ 0.11.3 — the strip's hook line and the setup card are two readings of ONE
  // decision (panelui.js hookSetupState), handed the same envelope here. A seed is
  // not a live answer: the card is not told one arrived.
  if (!seed) applySetupState(health);

  panel.classList.remove('hidden');
  // ⛔ ext and hook ONLY, and v0.11.0 does NOT change that — only the reason.
  // The feed lane used to be permanently amber by construction; it now sits amber
  // or red for as long as a member chooses to stay paused, or for as long as a
  // signed-out profile stays signed out. Including it would pin the strip open on
  // every popup open until they changed their mind, which is the same slide from
  // standing notice into wallpaper. The capture card that owns those two decisions
  // is already on screen above this strip, unmissable and un-collapsible.
  // ⛔ 0.11.3 — the hook opens it only on a MEASURED problem (amber): its line ends
  // "…below." and has to be readable above the card it points at. The can't-check
  // line is grey and opens nothing — no nagging on an unknown.
  // ⛔ AND ONLY WHEN THE READING CHANGES. While a step is showing, health is re-read
  // every 30 s; re-applying this rule on each read would snap the strip open again
  // under a member who had just closed it. Before the re-read existed this ran about
  // once per open, which is what "on a change of reading" preserves.
  const hookProblem = byKey.hook.level === 'warn' || byKey.hook.level === 'bad';
  const readingChanged = `${byKey.ext.level}|${byKey.hook.level}` !== stripAutoKey;
  stripAutoKey = `${byKey.ext.level}|${byKey.hook.level}`;
  if (readingChanged && byKey.ext.level !== 'ok' || readingChanged && hookProblem) panel.open = true;
}
// The ext|hook levels the strip last auto-opened on (see renderHealth()).
let stripAutoKey = null;
// 0.11.4 fix round 1 — whether a LIVE (or 5-minute-cached) reading has been painted
// yet; once one has, the first-frame seed below steps aside.
let healthPaintedLive = false;

/**
 * ⛔ 0.11.4 fix round 1 §4 (Opus, 2026-10-02) — NOTHING LANDS UNDER THE CURSOR.
 *
 * The strip and the sessions block used to be painted only when the live health
 * read returned. On a cold open the run list and its Stop buttons were on screen
 * first, and about a second later the strip (36px) and then six sessions (427px)
 * landed above them: the first Stop moved from y=164 to y=627 under the cursor.
 *
 * So the first frame is painted from the last reading on this profile — storage
 * only, never a request — when it is at most HEALTH_SEED_MAX_AGE_MS (30 minutes,
 * the server's own session window) old. The live read then replaces it, in place.
 * An older reading paints nothing: the strip and the block wait for the live read,
 * as before (and the block, now below every control, can only move the list under
 * it when it lands). Never awaited — a storage read must not sit between the member
 * and the Start button — and it steps aside if a live reading is painted first.
 */
async function paintHealthSeed() {
  let seed = null;
  try {
    seed = await readRecentCachedHealth();
  } catch (e) {
    seed = null;
  }
  if (!seed || healthPaintedLive) return;
  const status = healthVersionStatus(seed);
  if (!status) return;
  renderHealth(seed, status, { seed: true });
}

// The health endpoint could not be reached at all (older backend, offline, bad token).
// Say so quietly — this must never look like a hook failure, and it must never gate
// anything. The legacy /api/ext/version banner still runs in this path.
function renderHealthUnavailable() {
  healthReachable = false;
  paintStatusRow(null);
  // Capture state is LOCAL, so it is still readable when the server is not — this
  // path keeps telling the member the truth about their own capture.
  renderHealthDetail(document, $('#health-rows'), unavailableHealthLanes(currentCapture));
  // No reading at all: the sessions block draws nothing (and forgets nothing).
  paintSessions(null);
  $('#health-foot').textContent = '';
  $('#health').classList.remove('hidden');
  // ⛔ An unreachable server is NOT a hook that is ok, and it is not a problem
  // either: the hook line reads the can't-check sentence and no card is shown.
  applySetupState(null);
}

// Repaint the LANES only, from what is already cached. Called when the capture
// state changes under us — a pause taken on the side panel, a 401 signing this
// profile out — so the feed lane follows the capture card instead of showing the
// reading it had when the popup opened. Deliberately does not touch the status
// row, the footer or the open/closed state: nothing about capture is a reason to
// re-run getTimers() or to pop the strip open.
function repaintHealthLanes() {
  const panel = $('#health');
  const rows = $('#health-rows');
  // Not painted yet — refreshHealth() is still in flight and will pick the state
  // up on its own. Drawing here would put the unreachable lanes into a hidden
  // strip for the split second before it lands.
  if (!panel || !rows || panel.classList.contains('hidden')) return;
  const lanes = (healthReachable && currentHealth)
    ? computeHealthLanes({ health: currentHealth, versionStatus: currentVersionStatus, capture: currentCapture })
    : unavailableHealthLanes(currentCapture);
  renderHealthDetail(document, rows, lanes);
}

// Fetch (or re-fetch) health and paint BOTH the strip and the update banner from it.
// Never awaited by init() — the picker must not wait on this, and a failure degrades
// to the pre-existing /api/ext/version path.
async function refreshHealth(force) {
  let health = null;
  try {
    health = await fetchHealth({ force: !!force });
  } catch (e) {
    health = null; // fetchHealth is no-throw, but never let this bubble into init()
  }
  const status = healthVersionStatus(health);
  healthPaintedLive = true;
  if (health && health.data && status) {
    applyVersionBanner(status);
    renderHealth(health, status);
    return;
  }
  renderHealthUnavailable();
  checkVersion().then(applyVersionBanner);
}

async function onHealthRefresh() {
  const btn = $('#health-refresh');
  btn.disabled = true;
  btn.textContent = 'Re-checking…';
  await refreshHealth(true);
  btn.disabled = false;
  btn.textContent = 'Re-check';
}

// ---- the Claude Code setup card (0.11.3) ----
//
// ⛔ ONE STEP AT A TIME, AND NOTHING WHEN SETUP IS FINE (Rob, 2026-09-28). The card
// is shown only while panelui.js hookSetupState() says a step is due — the
// server's verdict is duplicate / stale / dark, or the hook is not set up yet —
// and it shows exactly one step. It is absent on a healthy hook and absent when
// the server cannot be asked (the strip's hook line says "Can't check right
// now." instead). Nothing here decides any of that; it hands the card the
// reading and keeps the reading fresh while a step is on screen.
//
// ⛔ THE SERVER MOVES IT, NEVER THE MEMBER. There is no "I've run this" button.
// Step 2 appears when the installer's verification lands on the server, and the
// card goes away when the verdict turns ok — so while it is up, health is re-read
// every 30 s (and when the popup gets focus), and the re-read stops the moment the
// card is hidden.
//
// ⛔ AND IT TAKES NO FOCUS. 0.11.2's popup opened with the cursor already inside
// the old card's folder field; this card has no field, and nothing focuses it.
let consentCard = null;
// The reading the card is painted from, and whether a LIVE read has answered yet.
// Until one has, the card paints from the cached reading (readCachedHealth, age-
// bounded, storage only) so its first frame is the frame it settles at.
let setupHealth = null;
let setupHealthLive = false;
// The last forced health read, so a visible card, the poll and a focus event
// together never put more than one request on the wire in a short gap.
let setupForcedAt = 0;
const SETUP_FORCE_GAP_MS = 10 * 1000;
const setupPoller = createSetupPoller({
  refresh: () => forceSetupRefresh(0),
  isHidden: () => document.hidden,
});

async function mountConsent() {
  const host = $('#consent-host');
  if (!host) return;
  let st;
  let seed = null;
  try {
    // The platform decides which Terminal command the card can reveal.
    st = await workFolderState();
    if (!setupHealthLive) seed = await readCachedHealth();
  } catch (e) {
    return;                     // never let this path break the picker
  }
  if (!consentCard) {
    consentCard = renderConsentCard(document, host, {
      // ⛔ The platform workFolderState() resolved through chrome.runtime, passed
      // in rather than re-guessed here. PowerShell does not expand `~` or pipe a
      // script into itself the way sh does; the Windows member gets the Windows
      // command because this says Windows, not because the card guessed.
      platform: st.platform,
    });
  }
  // ⛔ A cached seed never overwrites a live reading that landed while we waited.
  if (!setupHealthLive) setupHealth = seed;
  paintSetup();
}

/**
 * Hand the card (and the poll) the latest health envelope — or null when the
 * server could not be reached at all. Order-independent: health is fetched
 * without being awaited by init(), so it can land before or after the mount.
 */
function applySetupState(health) {
  setupHealth = health;
  setupHealthLive = true;
  paintSetup();
}

function paintSetup() {
  if (!consentCard) return;
  const visible = consentCard.update(hookSetupState(setupHealth));
  setupPoller.sync(visible);
  // ⛔ A step must never stand on a CACHED reading when a live one is one request
  // away: the member may have just run step 1 and reopened the popup to see.
  if (visible && setupHealth && setupHealth.cached) forceSetupRefresh(SETUP_FORCE_GAP_MS);
}

function forceSetupRefresh(minGapMs) {
  const t = Date.now();
  if (t - setupForcedAt < minGapMs) return;
  setupForcedAt = t;
  refreshHealth(true);
}

// "and on popup focus" — only while a step is showing; a healthy member's popup
// asks the server nothing extra.
window.addEventListener('focus', () => {
  if (consentCard && consentCard.isVisible()) forceSetupRefresh(SETUP_FORCE_GAP_MS);
});

// ---- the capture notice + pause control ----
//
// ⛔ THIS ONE IS A FULL SYNC, unlike mountConsent() above, and the difference is
// the point. The work-folder card holds a half-typed textarea, so repainting it
// from another surface would destroy input. This card holds no input at all — a
// button and a state line — and it MUST track the truth: a member who pauses on
// the side panel and then opens the popup has to see "Paused", not a stale
// "Capturing". Repainting is free here and being stale is not.
async function mountCapture() {
  const host = document.querySelector('#capture-host');
  if (!host) return;
  let state;
  try {
    state = await getCapture();
  } catch (e) {
    return;                     // never let this path break the picker
  }
  currentCapture = state;
  // ⛔ D3 — above the surface only while the member has something to do; once
  // acknowledged, the pause / resume control lives behind the status line.
  const inline = document.querySelector('#capture-inline-host');
  const above = captureCardAbove(state) || !inline;
  const target = above ? host : inline;
  const other = above ? inline : host;
  if (other) { other.textContent = ''; other.classList.add('hidden'); }
  renderCaptureCard(document, target, {
    state,
    // Both handlers go through the service worker rather than writing storage
    // here: it owns arming the flush alarm, republishing `captureOn` to every
    // tab, and repainting the badge. A surface writing the state directly would
    // change the answer without changing what acts on it.
    onAcknowledge: () => chrome.runtime.sendMessage({ type: 'captureAcknowledge' }),
    onTogglePause: (paused) => chrome.runtime.sendMessage({ type: 'capturePause', paused }),
  });
  target.classList.remove('hidden');
  paintStatusRow(currentHealth);
  // ⛔ THE CARD AND THE FEED LANE ARE TWO READINGS OF ONE GATE, so they repaint
  // together. Painting only the card is how a member ends up looking at "Paused."
  // a few rows above a lane still saying capture is on — the exact green-next-to-red
  // failure the one-implementation rule exists to prevent.
  repaintHealthLanes();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[CAPTURE_KEY]) return;
  mountCapture();
});

// ⛔ The status line's Timer dot follows every change to the running set — a Start
// or Stop from this popup, the side panel, or the worker adopting server entries.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.timers) return;
  paintStatusRow(currentHealth);
});

// ---- side panel opener ----
// The popup vanishes on any click-away, which is how timers ran away unnoticed. The
// side panel is the persistent surface; this just opens it.
// chrome.sidePanel.open() needs a window id AND transient user activation, so the id
// is captured at load — awaiting a lookup inside the click handler can spend the
// activation before open() is reached.
let sidePanelWindowId = null;

function sidePanelSupported() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.open === 'function');
}

async function onOpenSidePanel() {
  if (!sidePanelSupported()) return;
  try {
    const windowId = sidePanelWindowId != null
      ? sidePanelWindowId
      : (await chrome.windows.getCurrent()).id;
    await chrome.sidePanel.open({ windowId });
    window.close(); // the panel is now the live surface — don't leave two of them up
  } catch (e) {
    /* older Chrome, no activation, or panel disabled — degrade silently */
  }
}

// ---- the ranked feed (GET /api/ext/next-task) ----
// One cached read drives the idle view's task packet, the compact running-view
// one-liner, and the Chips/Timer dots. Never throws — a 401 / unreachable server
// degrades to the cached list or an empty-state card, with no error spam; same
// resilience contract as checkVersion().
async function refreshNextUp({ force = false } = {}) {
  // v0.8.0: one CACHED read, shared with the side panel and the popped-out
  // window (see taskfeed.js). This used to be an uncached apiFetch on every
  // popup open, which on a popup people open dozens of times a day was the
  // extension's single chattiest caller against a database with no headroom.
  const feed = await fetchTaskFeed({ force: !!force });
  currentFeed = feed;
  const data = feed && feed.data;
  const item = (data && (data.next || (Array.isArray(data.items) ? data.items[0] : null))) || null;
  currentNextItem = item;
  // ⛔ The ENVELOPE, not just `data`. `feed.error` is the only thing that can tell
  // a broken feed from an empty one, and the idle view has to say which it is.
  renderIdleTasks(feed);
  // M7 — the pinned line, from the SAME envelope, so "the feed failed" and "the
  // feed is empty" stay two different sentences here as well as in the list.
  renderNextUpLine($('#nextup-pinned'), feed);
  // The Chips and Timer dots read from this feed — repaint now that it is in.
  paintStatusRow(currentHealth);
}

/**
 * The idle view's task packet — one card per client, EVERY open item enumerated.
 *
 * ⛔ Rendered by panelui.js renderTasks() from taskfeed.js buildCards(), which is
 * the side panel's exact code path over the same cached payload. There is no popup
 * variant of the card, the band, the wording or the counts. If this ever needs to
 * differ from the panel, the difference belongs in panelui.js behind a flag both
 * surfaces can see — not in a second renderer here (Rob, 2026-08-12: "It should
 * basically be the same packet of information… whether it's on the side panel, the
 * main, or what pops up when you first open it").
 *
 * The picker below is untouched on purpose: /api/ext/blocks admits rows this feed
 * does not (a meeting stays clock-in-able until the end of its own day, while the
 * ranker drops it at scheduled_end — appointment-lifecycle.ts measured that a cut
 * at scheduled_end here would break 75.3% of real logging), and the radio picker is
 * the ONLY surface that can attach a timer to an arbitrary block.
 */
function renderIdleTasks(feed) {
  const host = $('#idle-tasks');
  if (!host) return;
  const data = feed && feed.data;
  const cards = buildCards(data, Date.now());
  idleCards = cards;
  idleFeed = feed;
  mountIdleSearch();
  paintIdleTasks();
}

/**
 * The popup's search box — the SAME control the panel builds (panelui.js
 * buildSearchBox), mounted once above #idle-tasks and left alone afterwards.
 *
 * ⛔ MOUNTED ONCE, NOT PER RENDER. renderIdleTasks() runs again on every feed
 * refresh; rebuilding the input there would drop the caret and the query the
 * moment a background refresh landed. Same rule as the panel — the box lives
 * outside the host renderTasks() clears.
 */
function mountIdleSearch() {
  if (idleSearch) return;
  const host = $('#idle-tasks');
  const head = $('#idle-tasks-head');
  if (!host || !host.parentNode) return;
  idleSearch = buildSearchBox(document, {
    value: idleQuery,
    onChange: (v) => { idleQuery = v; paintIdleTasks(); },
  });
  host.parentNode.insertBefore(idleSearch.wrap, head && head.nextSibling ? head.nextSibling : host);
}

/** Head line + list, for the current cards and the current query. */
function paintIdleTasks() {
  const host = $('#idle-tasks');
  if (!host) return;
  const shown = filterCards(idleCards, idleQuery);
  const countEl = $('#idle-tasks-count');
  // Same sentence the panel's head shows, so the two never report different totals.
  if (countEl) countEl.textContent = tasksCountText(shown, idleCards, idleQuery);
  renderTasks(host, shown, {
    onStart: onCardStart,
    onCopy: onCardCopy,
    onCloseOut: onCardCloseOut,
    nextFingerprint: nextFingerprintOf(idleFeed && idleFeed.data),
    // The refresh's own state travels WITH the cards, so "the feed failed" is said
    // where the list would have been — see panelui.js feedStatusNote().
    feed: idleFeed,
    query: idleQuery,
  });
}

/**
 * Start on a client card, in the popup. The behaviour is cardstart.js — shared with
 * the side panel and the pop-out. What the POPUP adds is the part only it can do:
 * it owns Start/Stop, so a successful clock-in switches it to the running view.
 */
async function onCardStart(card, btn, art) {
  // Supersedes the one-time stop confirmation only — starting work never resolves a
  // QA requirement, exactly as the picker's own Start no longer does. See onStart().
  await clearStopConfirm();
  const { apiBase, memberEmail } = await chipContext();
  await startCard({
    card, btn, art,
    doc: document,
    memberEmail,
    apiBase,
    send,
    // Same floor the legacy picker has always enforced at refreshStartDisabled(),
    // now applied to the card Start too — the surface people actually use.
    versionBlocked: blockStartForVersion,
    onStarted: (res) => {
      pickerIsAddMode = false;
      renderRunListFromTimers(res && res.timers);
    },
  });
}

/**
 * The chip context this document needs to compose a chip — the member's email and
 * the OW origin. Resolved the same way onCardStart already resolves it; factored out
 * because the standalone copy control and the running view's copy control need the
 * identical pair and must not each invent their own fallbacks.
 */
async function chipContext() {
  let apiBase = '';
  try {
    const cfg = await getConfig();
    apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
  } catch (e) { /* the chip degrades to a bare origin — never block the copy */ }
  const memberEmail =
    (currentHealth && currentHealth.data && currentHealth.data.member_email) ||
    (currentFeed && currentFeed.data && currentFeed.data.member && currentFeed.data.member.email) ||
    '';
  return { apiBase, memberEmail };
}

/** M2 — the standalone copy control on a card. No clock, no start, just the chip. */
async function onCardCopy(card, btn, art) {
  if (btn) btn.disabled = true;
  const { apiBase, memberEmail } = await chipContext();
  await copyCardChip({ card, art, doc: document, memberEmail, apiBase });
  if (btn) btn.disabled = false;
}

/**
 * M6 — close-out, from a card, through the EXISTING /api/ext/block-complete-note.
 *
 * ⛔ THE FEED IS REFRESHED AFTERWARDS, not patched locally. The whole point is that
 * the client stops being served; proving that means asking the server again rather
 * than hiding the card and hoping. A closed block drops out of the ranker, so the
 * card disappears on the next payload — and if it does NOT, the member sees that
 * truthfully instead of looking at a card we deleted client-side.
 */
async function onCardCloseOut(card, target, note, ctx) {
  const res = await closeOutBlock({ target, note });
  if (!res.ok) {
    // ⛔ THE CLOCK CASES ARE NOT A FAILURE AND MUST NOT READ LIKE ONE. Nothing was
    // sent; there is a specific thing to do about it. Falling through to
    // "nothing was closed, try again" would send somebody into a retry loop that
    // cannot succeed until they stop the timer.
    if (res.error === 'clock_running') {
      // OPUS_COPY — the line shown when the member is still clocked into this very
      // block. Must convey: the clock is running on this block, so stop it first
      // and then close it out; nothing has been closed. Must NOT read as an error
      // with the block, and must NOT tell them the close-out is unavailable.
      ctx.fail('Your clock is running on this block. Stop the timer first, then close it out. Nothing was closed.');
      return;
    }
    if (res.error === 'never_timed') {
      // OPUS_COPY — shown if close-out is pressed on a block with no time recorded
      // against it. Must convey: only a block you have tracked time on can be closed
      // out here; nothing was closed; ask the PM to close a block nobody worked.
      // Must NOT imply the member did something wrong.
      ctx.fail('Only a block with time tracked on it can be closed out here. Nothing was closed. To close a block with no tracked time, ask your PM.');
      return;
    }
    if (res.error === 'clock_unknown') {
      // OPUS_COPY — the line shown when this profile's timer list could not be
      // read at all, so we cannot tell whether the clock is running. Must convey:
      // nothing was closed because we could not check, try again. Must NOT blame
      // the server and must NOT suggest the block is in a bad state.
      ctx.fail('We could not check whether your clock is running on this block, so nothing was closed. Try again.');
      return;
    }
    ctx.fail(res.status
      // OPUS_COPY — error line inside the close-out form when the server refused.
      // Must convey: nothing was closed, and it can be tried again. The HTTP status
      // is appended by the caller for support. Must NOT guess at a cause.
      ? `${'The close-out did not go through, and nothing was closed. You can try again.'} (HTTP ${res.status})`
      // OPUS_COPY — error line inside the close-out form when the server could not
      // be reached at all. Must convey: nothing was closed because the tracker was
      // unreachable; try again.
      : 'The server could not be reached, so nothing was closed. Try again in a moment.');
    return;
  }
  if (ctx.form) ctx.form.classList.add('hidden');
  // OPUS_COPY — toast after a successful close-out. Must convey: the block is
  // closed and the note was recorded against it. Must NOT say the client was
  // removed, must NOT claim a QA was done, and must NOT imply it is reversible.
  showToast(document, 'Closed out. Your note is recorded against this block.');
  // ⛔ FORCED. The comment above this function has always claimed the feed is
  // re-read from the server rather than patched locally — and it was not:
  // refreshNextUp() calls fetchTaskFeed() unforced, which returns the CACHE
  // inside its TTL. So the card the member just closed stayed on screen looking
  // exactly as it did before, and the natural response to that is to press
  // close-out again on a block that is already closed. The side panel has always
  // forced (panelapp.js onCloseOut → refresh(true)); this is the popup catching
  // up with its own documentation.
  await refreshNextUp({ force: true });
}

// ---- internal-block work-log nudge (Feature 2) persistence ----
// Set on a long (≥1h) internal-block Stop; read+cleared once on the next idle render
// so the picker shows a single dismissible line. One-time, non-blocking.
// setWorklogNudge / getWorklogNudge / clearWorklogNudge moved to common.js (v0.8.6).

function showError(message) {
  $('#error-msg').textContent = message;
  showView('error');
}

// ---- boot / reconcile ----
async function init() {
  showView('loading');
  const cfg = await getConfig();
  if (!isConnected(cfg)) {
    showView('notconnected');
    // The capture card still mounts on this view — it is where the notice lives
    // for a member who installed the extension and has not connected yet, and
    // where the pause control has to stay visible for one who was signed out.
    mountCapture();
    return;
  }
  // ⛔ A STORED TOKEN THE SERVER HAS REJECTED IS NOT A CONNECTION, and this is
  // the branch the signed-out notification lands on. isConnected() is a shape
  // check — apiBase and token are non-empty — so a revoked token passes it and
  // the member would land on the picker, watch every call fail, and read a
  // generic "Server error (HTTP 401)". Routing to the token step instead is what
  // makes "Open the extension to sign back in" a true sentence.
  const capture = await getCapture();
  if (!capture.signedIn && capture.signedOutAt) {
    showView('notconnected');
    mountCapture();
    return;
  }

  // Health + version check runs in parallel with the block fetch — it must never
  // delay the picker, and a failure simply yields no banner. Applies the banner +
  // Start gate + the two-indicator health strip on resolve. This covers "on popup
  // open" and, because init() re-runs after every Stop and Retry, "on each /blocks
  // poll" from the popup's side. The response is cached for HEALTH_TTL_MS, so those
  // repeat init()s cost the server nothing.
  // 0.11.4 fix round 1 — the first frame, from the last reading when it is at most
  // 30 minutes old (storage only); the live read below replaces it.
  paintHealthSeed();
  refreshHealth();
  // Same contract as refreshHealth: fire-and-forget, never awaited. A storage read
  // must not sit between the member and the Start button.
  mountConsent();
  mountCapture();

  let data;
  try {
    data = await apiFetch('/api/ext/blocks');
  } catch (e) {
    showError(e.status ? `Server error (HTTP ${e.status}). Check your token in settings.` : 'Cannot reach the server. Check the API URL in settings.');
    return;
  }

  // v0.5.5 PARALLEL: the server returns ALL open entries. Fall back to the single
  // open_entry (older backend) so the extension still works before this deploy.
  const openEntries = Array.isArray(data.open_entries)
    ? data.open_entries
    : (data.open_entry ? [data.open_entry] : []);
  currentOpenEntries = openEntries;
  const localTimers = await getTimers();
  // Keep the block list available for lookups even when we render a running view.
  currentBlocks = Array.isArray(data.blocks) ? data.blocks : [];

  // A QA-capture session that is still ACTIVE keeps running in the background after the
  // popup closes (Chrome closes the popup on any page click, but the service worker keeps
  // taking click-shots — the shot count rises across reopens). On reopen, drop straight
  // back into the LIVE recording view. The idle "Resume QA capture" prompt is reserved
  // for a session the rep actually Stopped (hasSession && !active) — never for one that
  // is still capturing. Checked before the timer reconcile: QA capture only starts after
  // Stop, so there is no open timer to compete with.
  try {
    const qa = await getQa();
    if (qa && qa.active) {
      qaCapBlockId = qa.block_id != null ? qa.block_id : (qa.blockId != null ? qa.blockId : null);
      renderQaCap(qa);
      return;
    }
  } catch (e) { /* storage unavailable — fall through to the normal reconcile */ }

  // If the server reports open entries the local worker isn't tracking (fresh
  // install / new machine / SW evicted), adopt the FULL set (resume without emitting
  // timer_start). Resolve each entry's scheduled_end + title from the block list.
  // ⛔ D4 — compared by KEY SET, not by count. With parallel timers the same count
  // can be a different set (one stopped on another machine, another started there),
  // and a count check left this worker holding timers the server had already closed.
  //
  // ⛔ AND BY KEY→ENTRY ID, not by key alone. The same key under a NEW entry id (the
  // key stopped and started again on another machine or profile) is a different
  // timer: lane W2b closes strictly by entry id, so keeping the old id means a Stop
  // that closes nothing while the real entry keeps billing. A local timer with no id
  // yet still matches — its start may simply not have flushed. A same-key duplicate
  // on the server matches when the local id is any one of that key's ids.
  const serverMap = new Map();
  for (const oe of openEntries) {
    const b = oe.calendar_block_id ?? null;
    const k = timerKey(b, b == null ? (oe.project_id ?? null) : null);
    if (!serverMap.has(k)) serverMap.set(k, new Set());
    if (oe.id != null) serverMap.get(k).add(String(oe.id));
  }
  const localMap = new Map(localTimers.map((t) => [String(t.key), t.entryId ?? null]));
  const sameSet = serverMap.size === localMap.size && [...serverMap].every(([k, ids]) =>
    localMap.has(k) && (localMap.get(k) == null || ids.has(String(localMap.get(k)))));
  // ⛔ 0.11.4 — the timers as they are STORED once the worker has answered, because
  // the run list below takes each entry's stored title from them (nameOpenEntry).
  let storedTimers = localTimers;
  if (openEntries.length > 0 && !sameSet) {
    const resumeList = openEntries.map((oe) => {
      const blockId = oe.calendar_block_id ?? null;
      return {
        ...oe,
        scheduledEnd: blockScheduledEnd(currentBlocks, blockId),
        // The block's title when there is one. For an entry with no block this is
        // '' and the worker keeps the title it already stores for that entry —
        // resumeTimer() never replaces a stored name with an empty one.
        title: blockTitle(currentBlocks, blockId) || '',
      };
    });
    const res = await send({ type: 'resume', openEntries: resumeList });
    if (res && Array.isArray(res.timers)) storedTimers = res.timers;
  } else if (openEntries.some((oe) => {
    // The server names this entry's project and the stored timer does not carry
    // that name yet. The side panel and the pop-out read the stored timers and
    // never ask /blocks, so hand the worker the names — and nothing else.
    const name = typeof oe.project_name === 'string' ? oe.project_name.trim() : '';
    if (!name) return false;
    const b = oe.calendar_block_id ?? null;
    const t = storedTimerFor(localTimers, { entryId: oe.id ?? null, key: timerKey(b, b == null ? (oe.project_id ?? null) : null) });
    return !!t && t.projectName !== name;
  })) {
    try {
      const res = await send({ type: 'timerNames', openEntries });
      if (res && Array.isArray(res.timers)) storedTimers = res.timers;
    } catch (e) { /* a name is never a reason to hold the popup */ }
  }
  // From here on the open entries carry the names this profile holds for them.
  currentOpenEntries = openEntries.map((oe) => nameOpenEntry(oe, storedTimers));

  // P0-1: a Stop's QA/early prompt was on screen when the popup was closed (Chrome
  // closes the popup on any click-away). Re-surface that prompt with a "your N.Nh
  // were saved ✓ — QA still needed" banner. With parallel blocks the prompt shows a
  // "← Back to active blocks" link (renderQa/renderEndingEarly toggle it) so the rep
  // can still reach the running list. Skip when a capture bundle already exists.
  //
  // v0.8.7: there can be SEVERAL. nextOutstandingQa() returns the oldest block that
  // is not running again, and each completed QA drains to the next one — so a member
  // who stopped three blocks is asked three times instead of once.
  //
  // ⛔ v0.12.0 — M5. THIS NO LONGER RETURNS, AND THAT IS THE FIX.
  //
  // What it used to do: render the QA prompt and `return`. init() ends here, so the
  // running list and the whole task list never rendered at all — one local storage
  // key, which nothing on the server can clear and nothing expired, replaced every
  // other surface in the extension. And the prompt it put there did not name the
  // block: "✓ 1.2h saved — QA still needed" about which of the four things stopped
  // this week is not a question anyone can answer.
  //
  // What it does now: mount a PINNED, undismissable card above the list naming every
  // outstanding block and the day it was stopped, and carry on rendering. The gate is
  // not weakened — the set is untouched, the only removal path is still that block's
  // own QA (or the age cap in common.js), the server-side watchdog is unaffected, and
  // pressing the card's button lands on the exact same renderQa/renderEndingEarly
  // views with the same `reopened` banner.
  //
  // ⛔ clearQa() IS NOT CALLED, HERE OR ANYWHERE IN THIS CHANGE. It wipes the QA
  // resume-append bundle and a live upload token; "the prompt is stale" is not a
  // reason to destroy a capture the member may be mid-way through.
  //
  // ⛔ AND THERE IS NO SERVER RECONCILE. It was the obvious fix and it does not
  // work: /api/ext/blocks returns no `qa_posted_at`, it does not carry `qa_final`
  // (which is what the Claude Code finalize route actually writes), and `completed`
  // is not a QA — 17 of 230 completed blocks on prod have no QA of any kind. A
  // reconcile against that data would silently clear real requirements.
  await mountQaOwed();

  if (openEntries.length > 0) {
    // One or more blocks are running — show the parallel active-blocks list, each
    // entry under the name this profile holds for it (0.11.4, nameOpenEntry).
    renderRunList(currentOpenEntries);
    return;
  }

  // Server says nothing is open. Guard just-started local timers the server may not
  // have surfaced yet (a start within the last 15s).
  if (localTimers.length > 0) {
    const newest = localTimers
      .map((t) => (t.startedAt ? Date.parse(t.startedAt) : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const startedMsAgo = newest ? Date.now() - newest : Infinity;
    if (startedMsAgo > 15000) {
      await send({ type: 'reset' });
    } else {
      renderRunListFromTimers(localTimers);
      return;
    }
  }

  renderIdle(data.blocks);
}

// ═══════════════════════════════════════════════════════════════════════════
// YOUR HOURS (v0.11.2) — see what was recorded, and add what was missed
// ═══════════════════════════════════════════════════════════════════════════
//
// ⛔ The view itself is panelui.js mountHoursPanel(), shared with the side panel and
// the pop-out. What stays here is the popup's own navigation: which view to come
// back to. Every string is hours.js COPY.

/** The view to return to when Hours is closed. */
let hoursReturnView = 'idle';
let hoursPanel = null;

function ensureHoursPanel() {
  if (!hoursPanel) hoursPanel = mountHoursPanel(document, $('#hours-host'), { onBack: onCloseHours });
  return hoursPanel;
}

// Open the surface. A member who notices a wrong number mid-timer lands back on
// their running blocks, not the picker.
// ⛔ 0.11.3 — the header button is a TOGGLE: pressed again while My hours is open,
// it goes back (Rob, 2026-09-28: "I don't see a way to get back to the main
// screen" — the button that opened the view used to do nothing a second time).
async function onOpenHours() {
  if (!$('#view-hours').classList.contains('hidden')) {
    onCloseHours();
    return;
  }
  hoursReturnView = VIEWS.find((v) => !$(`#view-${v}`).classList.contains('hidden')) || 'idle';
  if (hoursReturnView === 'hours') hoursReturnView = 'idle';
  const panel = ensureHoursPanel();
  showView('hours');
  await panel.open();
}

// ⛔ 0.11.3 — Escape leaves My hours too. An Escape something inside the view has
// already claimed (the client picker closing its open list calls preventDefault)
// is left alone, so one Escape closes the list and the next one leaves.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if ($('#view-hours').classList.contains('hidden')) return;
  e.preventDefault();
  onCloseHours();
});

function onCloseHours() {
  // Re-running init() would refetch /blocks and could drop somebody back into a
  // QA prompt they already answered. Return to the view they came from.
  showView(hoursReturnView);
}

// "Start another task" — open the picker WITHOUT stopping the running blocks.
function onStartAnother() {
  pickerIsAddMode = true;
  renderIdle(currentBlocks);
}

document.addEventListener('DOMContentLoaded', () => {
  // Health strip: two independent indicators + a manual re-check.
  $('#health-refresh').addEventListener('click', onHealthRefresh);
  // Side panel: hide the entry points entirely on a Chrome without chrome.sidePanel.
  if (sidePanelSupported()) {
    // Capture the window id BEFORE any click so open() runs inside the activation.
    chrome.windows.getCurrent().then((w) => { sidePanelWindowId = w && w.id != null ? w.id : null; }).catch(() => {});
    $('#open-sidepanel').addEventListener('click', onOpenSidePanel);
    $('#run-sidepanel').addEventListener('click', onOpenSidePanel);
  } else {
    $('#open-sidepanel').classList.add('hidden');
    $('#run-sidepanel').classList.add('hidden');
  }
  // v0.11.2 — "Your hours". Reachable from every view, because the moment
  // somebody notices a number is wrong is not a moment they are standing in the
  // idle picker.
  $('#open-hours').textContent = HOURS_COPY.openButton;
  $('#open-hours').title = HOURS_COPY.openButtonTitle;
  $('#open-hours').addEventListener('click', onOpenHours);
  $('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#open-options-2').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#retry').addEventListener('click', init);
  // Static elements — bind once, never inside renderIdle().
  $('#note').addEventListener('input', onSelectionChange);
  $('#cat-select').addEventListener('change', onSelectionChange); // internal-category gate
  $('#start').addEventListener('click', onStart);
  $('#refresh-blocks').addEventListener('click', onRefreshBlocks); // P0-2 fresh sync
  // Self-serve "New task" creation (Build 3, 2026-07-20).
  $('#newtask-toggle').addEventListener('click', onNewTaskToggle);
  $('#newtask-cancel').addEventListener('click', () => { $('#newtask-form').classList.add('hidden'); resetNewTaskForm(); });
  $('#newtask-create').addEventListener('click', onNewTaskCreate);
  // The idle view's Start buttons are on the cards themselves and are bound by
  // panelui.js on every render (renderIdleTasks) — there is no static idle
  // "next up" button to bind since v0.8.3.
  // Dismiss the one-time internal-block work-log nudge.
  $('#idle-worklog-nudge-x').addEventListener('click', () => $('#idle-worklog-nudge').classList.add('hidden'));
  // Parallel tracking (v0.5.5): start another block, and the back-to-list links.
  $('#run-startanother').addEventListener('click', onStartAnother);
  $('#idle-backlist').addEventListener('click', renderRunListFromState);
  $('#early-backlist').addEventListener('click', renderRunListFromState);
  $('#qa-backlist').addEventListener('click', renderRunListFromState);
  // Request-extension (running view, per-block form).
  $('#ext-cancel').addEventListener('click', resetExtForm);
  $('#ext-send').addEventListener('click', onSendExtRequest);
  $('#ext-reason').addEventListener('input', () => $('#ext-err').classList.add('hidden'));
  // Ending-early prompt (block-linked stop before scheduled_end).
  $('#early-continue').addEventListener('click', onEarlyContinueLater);
  $('#early-finished').addEventListener('click', onEarlyFinishedEarly);
  // QA-capture walkthrough (mic + click screenshots -> .zip).
  $('#qa-start-qa').addEventListener('click', onQaStartQa);           // decision → Start QA
  $('#qa-noqa-toggle').addEventListener('click', onQaNoQaToggle);     // decision → No QA required
  $('#qa-noqa-submit').addEventListener('click', onNoQaSubmit);       // submit the no-QA note
  $('#qa-noqa-note').addEventListener('input', () => $('#qa-noqa-err').classList.add('hidden'));
  $('#qa-capture-start').addEventListener('click', onQaCaptureStart);
  $('#qa-resume').addEventListener('click', onQaCaptureResume);
  $('#qacap-finish').addEventListener('click', onQaCapFinish);        // Stop -> guidance card
  $('#qacap-copy').addEventListener('click', onQaCopyPrompt);         // copy the verbatim handoff prompt
  $('#qacap-download').addEventListener('click', onQaDownloadAgain);  // re-export the .zip
  $('#qacap-keepgoing').addEventListener('click', onQaKeepGoing);     // resume-append loop
  $('#qacap-finishdone').addEventListener('click', onQaFinishDone);   // close capture UI -> final confirmation card
  $('#qacap-final-done').addEventListener('click', init);            // back to the idle picker
  init();
});
