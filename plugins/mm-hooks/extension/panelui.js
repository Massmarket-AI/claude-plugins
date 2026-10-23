// panelui.js — the ONE renderer for EVERY surface.
//
// Three documents mount it: the side panel (sidepanel.js), the popped-out
// Document Picture-in-Picture window (built by content.js in the active tab), and
// — since v0.8.3 — the toolbar popup, which renders the same task packet into its
// idle view (popup.js renderIdleTasks). The popup took only the status row from
// here until v0.8.3; the rest of its idle view was its own, and it said different
// things about the same data (Rob, 2026-08-12: "the view of the tasks I'm getting
// when I first open the extension is very different from the view inside the side
// panel"). There is deliberately no second copy of any of this — a surface that
// drifts from the one beside it is worse than not having it.
//
// Everything is built with createElement + textContent. Block titles, client
// names and notes are third-party strings; none of them is ever assigned as HTML.
//
// ⛔ Every member-facing string in this file was authored by Opus for EXT #13 and
// placed on 2026-09-22 — the `OPUS_COPY —` note above each one is the brief it was
// written to, not an unfilled slot. A new string takes the same route, authored
// first and then placed, and is never written inline here.

import {
  fmtElapsed, manifestVersion, apiRequest, apiFetch, fetchHealth,
  // 0.11.4 — the ONE name a running timer is given, on every surface (see common.js).
  timerDisplayTitle, projectIdFromKey,
} from './common.js';
// v0.11.2 — "your hours", moved HERE from popup.js (2026-09-14, lane L4b) so the
// popup, the side panel and the pop-out mount ONE renderer, as every other surface
// in this file does. hours.js owns the copy, the calls and the decisions; this file
// owns only the DOM. hours.js touches no `chrome.*` at module scope.
import {
  COPY as HOURS_COPY,
  buildSubmission, dateInputValue, fmtDuration, loadMyHours, shapeLedger, submitPastHours,
  loadRecordedWindow, entriesOnDay, checkAgainstRecorded, describeRecorded, uncheckedNeedsConfirm,
  recordedLine,
} from './hours.js';
import { needsEta, urgencyPhrase } from './taskfeed.js';
// v0.11.0 — the feed lane READS THE CAPTURE GATE. Imported, never re-derived: the
// precedence between signed-out, not-acknowledged and paused belongs to
// captureGate() and to nothing else, for the same reason hookHealthIndicator
// borrows hooksIndicator rather than re-deciding whether the hook is alive.
// capture.js touches no `chrome.*` at module scope, so importing it here keeps
// this module loadable under plain node — which is what verify/health-strip.mjs
// and verify/feed-lane.test.mjs both depend on.
import { captureGate } from './capture.js';
// 0.11.3 — the Claude Code hook's line, the compact row word and the "Change
// folders" reveal are SETUP_COPY / HOOK_ROW_WORD, frozen next to the setup card
// that shares them. consentcard.js imports nothing from this file, so there is no
// cycle, and it touches no `chrome.*` at module scope, so this module still loads
// under plain node.
import { SETUP_COPY, HOOK_ROW_WORD, CARD_AFFORDANCE } from './consentcard.js';
// 0.11.3 — the Claude Code sessions and the "Change" picker on each; 0.11.4 — in
// their own block, below the controls. sessions.js owns their copy, calls and
// decisions; this file draws them. It imports nothing from here and touches no
// `chrome.*` at module scope.
import {
  SESSION_COPY, TASK_LABEL_MAX, claudeSessionsFrom, sessionTitleText, sessionLineText, recordingFromText,
  normalizeTaskLabel, normalizeFolderName, loadTaskCandidates, saveTaskOverride,
} from './sessions.js';

export const DOT = { ok: '🟢', warn: '🟡', bad: '🔴', unknown: '⚪' };

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ───────────────────────────────────────────────────────── the three indicators

/** Whole days since a reading (shared with the popup's health strip wording). */
function daysFromHours(hours) {
  if (hours == null || !Number.isFinite(Number(hours))) return null;
  return Math.max(1, Math.round(Number(hours) / 24));
}

export function fmtSince(hours) {
  const h = Number(hours);
  if (hours == null || !Number.isFinite(h)) return 'unknown';
  if (h < 1) return 'less than an hour ago';
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = daysFromHours(h);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
}

/**
 * ⛔ THE HONESTY CONSTRAINT ON "Chips" (Rob, 2026-08-11).
 *
 * ⛔ CORRECTION (2026-09-12) — THE NUMBER THAT WAS FROZEN INTO THIS FILE IS NO
 * LONGER TRUE, AND FREEZING IT WAS THE DEFECT.
 *
 * This block, and the member-facing sentence built from it, both asserted that
 * `delivered_chip` "has fired ONCE, EVER … last on 2026-07-30". Measured on prod
 * this morning (`task_surfacing_events`, project kfseyjwfpfobqlzytbvb):
 *
 *   minted 4,004 · disappeared 153 · completed 42 · claimed 41 · declined 6 ·
 *   delivered_chip 4 · dismissed 2
 *
 *   delivered_chip, by person and day:
 *     rob@massmarket.ai   2026-07-30
 *     asif@massmarket.ai  2026-09-04, 2026-09-08, 2026-09-10
 *
 * So the hook ack IS firing, three times in the last week, for a member whose
 * surface went on telling him it had happened once in July and pinned his Chips
 * lane amber for it. A hardcoded team-wide census in a per-member indicator ages
 * into a lie the moment the thing it describes starts working — which is the one
 * outcome everybody was hoping for.
 *
 * ⛔ SO THE CENSUS IS GONE FROM THE MEMBER-FACING TEXT, and the LEVEL is now read
 * from data instead of asserted. `deliveredAt` is an OPTIONAL per-member signal:
 * when the feed payload carries the caller's own most recent `delivered_chip`
 * (`data.delivered_chip_at`), the lane may go green, because that member's own
 * hook has provably reached their own session. When the payload does not carry it
 * — which is EVERY server build up to and including today's — the lane behaves
 * exactly as it did: amber, "being served, delivery unconfirmed". Nothing here
 * guesses, and nothing here is painted green off a 200.
 *
 * The producer is unchanged and is NOT server code: ackDeliveredChip() in OW's
 * worklog-hook-source.ts (on main since c26b179) runs inside each person's own
 * Claude Code hook and only fires when their session calls spawn_task carrying a
 * fingerprint they were actually served. It still needs the hook installed,
 * current, and that specific tool path taken — which is why absence of the signal
 * is not evidence of anything and must stay amber rather than red.
 *
 * ⛔ And it is derived from /api/ext/next-task, never /api/ext/chip-feed — that
 * route WRITES a `minted` event per candidate it serves (see taskfeed.js).
 */
export function chipsIndicator(feed, now = Date.now()) {
  const data = feed && feed.data;
  const count = data && Array.isArray(data.items) ? data.items.length : 0;
  // Optional, per-member, server-supplied. Absent on every build shipped so far.
  const deliveredAt = (data && data.delivered_chip_at) || null;
  // EXT#13: the green detail names how long ago that delivery was, so the lane
  // needs a clock. `now` is an argument, not a call inside the branch, so the
  // sentence a test reads is deterministic. A timestamp is parsed; a bare number
  // is already an hours-ago figure and goes straight to fmtSince. Anything else
  // leaves `sinceH` null, and the sentence drops its "most recently" clause
  // rather than printing fmtSince's "unknown".
  const deliveredMs = typeof deliveredAt === 'string' ? Date.parse(deliveredAt) : NaN;
  const sinceH = typeof deliveredAt === 'number'
    ? deliveredAt
    : (Number.isFinite(deliveredMs) ? (now - deliveredMs) / 3600000 : null);

  // ⛔ D3 (2026-09-14): red is reserved for a state the MEMBER must act on —
  // signed out, hook dark, capture refused. A feed that could not be read or is
  // empty is not one of those (a 401 reaches the member as the signed-out state),
  // so both read grey.
  if (!data) {
    return {
      level: 'unknown',
      short: 'Chips',
      msg: 'Not being served',
      detail:
        `Your task feed could not be reached${feed && feed.error ? ` (${feed.error})` : ''}, so nothing can be ` +
        'served to your Claude Code session either. Check your token in settings.',
    };
  }
  if (count === 0) {
    return {
      level: 'unknown',
      short: 'Chips',
      msg: 'Not being served',
      detail:
        'Your ranked feed is empty right now, so the chip bridge has nothing to serve. ' +
        'If that is wrong, your calendar blocks may not be syncing.',
    };
  }
  if (deliveredAt) {
    return {
      level: 'ok',
      short: 'Chips',
      msg: `Served (${count})`,
      // OPUS_COPY — renders as the Chips lane's expanded detail when the member's
      // OWN hook has acknowledged a delivered chip. Must convey: the feed is
      // serving N items AND this member's own Claude Code hook confirmed receiving
      // one, most recently at <fmtSince(...)>. Must NOT claim anything about anyone
      // else's hook, must NOT quote a team-wide count, and must NOT imply the task
      // was claimed or completed — only that a chip reached the session.
      detail: `${count === 1 ? 'Your feed is serving 1 task.' : `Your feed is serving ${count} tasks.`} `
        + (sinceH == null
          ? 'Your own Claude Code hook has confirmed a chip reached your session.'
          : `Your own Claude Code hook confirmed a chip reached your session, most recently ${fmtSince(sinceH)}.`),
    };
  }
  // The ordinary state (served, delivery unconfirmed) is NORMAL, so it is grey.
  return {
    level: 'unknown',
    short: 'Chips',
    msg: `Served (${count})`,
    // OPUS_COPY — renders as the Chips lane's expanded detail in the ordinary
    // amber state. Must convey: the serving half is working (N ranked items), and
    // the part that is NOT confirmed is whether a chip reached this member's own
    // Claude Code session, which only their own hook can prove. Must NOT state a
    // team-wide delivered count or any date (that census is what went stale), must
    // NOT say anything is waiting on a deploy, and must NOT read as a fault.
    detail: `${count === 1 ? 'Your feed is serving 1 task.' : `Your feed is serving ${count} tasks.`} `
      + 'Whether a chip reached your Claude Code session is not confirmed, because only your own hook can report that. This is normal.',
  };
}

// ─────────────────────────────────────────── the Claude Code hook (0.11.3)
//
// ⛔ ONE DECISION, THREE READERS. The compact "Hooks" word on the status row, the
// "Claude Code hook" line in the strip, and whether the setup card shows (and
// which step) are all hookSetupState()'s answer. Nothing else reads
// `hook_verdict`, and nothing reads the liveness block (`hook.state` /
// `hook.last_seen_at`) as an answer at all.
//
// ⛔ WHY NOT LIVENESS (Rob, 2026-09-28). The strip used to say "Reporting in —
// last seen 11h ago" while the hook was writing rows every few seconds: liveness
// is stamped on the AUTH path, by the SessionStart chip-feed fetch, so it says
// when a session last STARTED, not whether work is being recorded. And it reads
// ok for an install that writes nothing — the false green that folded 0.11.2's
// card for the two members whose installs predated the folder allowlist.
// `hook_verdict` (OW PR #255) is derived from the rows the hook actually wrote.
//
// ⛔ THE STATES, and the contract they honour (src/lib/ext/hook-verdict.ts). The
// sentences are SETUP_COPY's (consentcard.js) and are named here by key only, so
// that there is exactly one copy of each:
//
//   ok                                  → green  lineOk (+ lineOkRoots)      no card
//   duplicate | stale | dark            → amber  lineDuplicate / lineStale /
//                                                lineDark                     step card
//   unknown + never_authenticated       → amber  lineNotSetUp                 step card
//   unknown + no_hook_rows              → grey   lineNoEntries                no card
//   unknown + anything else, degraded,
//   no verdict (an older server), a
//   refresh that FAILED, no health      → grey   lineCantCheck                no card
//
// "Can't check" never shows a card: nagging a member on an unknown teaches them
// to ignore the card on the day it is right. And it never claims the hook is
// recording: silence is not health.
//
// ⛔ no_hook_rows IS NOT "NOT SET UP" (Opus, 2026-09-28 — a correction to the first
// 0.11.3 brief). The server returns it when the member's token HAS authenticated
// and the hook wrote nothing in the 24 h window — a weekend, a day off, a
// browser-only day. Showing a set-up card for that is the false alarm the
// server's own evaluator was written to avoid, so it is a grey statement of fact
// and no card. (A hook that writes nothing WHILE a timer runs is `dark`, amber,
// with the card.)

/**
 * How long after the installer's verification the card shows step 2 instead of
 * step 1. The installer's last act is an authenticated POST; once the server
 * reports it, the only thing left is the restart, and the card says so without
 * asking the member whether they ran anything.
 */
export const HOOK_STEP2_WINDOW_MS = 15 * 60 * 1000;

/**
 * ⛔ THE FIELD STEP 2 READS — `hook.installer_checked_in_at` — AND WHY IT IS NOT
 * `hook.last_seen_at`.
 *
 * The installer's verification POSTs to /api/ext/worklog with source
 * "hook-selfcheck" (content "hook install self-check…"). That route is
 * deliberately UNCLASSIFIED in OW's classifyExtClient() (taken off HOOK_ROUTES on
 * 2026-08-31), so it never stamps `hook_last_seen_at`. `hook.last_seen_at` is
 * stamped by the SessionStart chip-feed GET instead: it goes fresh when ANY
 * installed hook starts a session — including the stale or double-registered one
 * being fixed — so reading it here would tell a member who has done nothing to
 * restart, and would leave step 1 standing after they ran the installer.
 *
 * OW serves the installer's own check-in as `hook.installer_checked_in_at` (ISO or
 * null — the newest "hook install self-check" row in the 24 h window; added on OW
 * branch feat/hook-choose-folder-and-guide, bf0ed7e5, NOT yet on origin/main
 * 26b67a92). It sits on the `hook` block but is not liveness, and it is the ONLY
 * key this module reads from that block. On a server that does not send it the
 * card stays on step 1 until the verdict turns ok — it never jumps to step 2 on a
 * guess.
 */
export const HOOK_INSTALLER_CHECKIN_FIELD = 'installer_checked_in_at';

const HOOK_PROBLEM_STATES = Object.freeze(['duplicate', 'stale', 'dark']);
const HOOK_NOT_SET_UP_EVIDENCE = Object.freeze(['never_authenticated']);
const HOOK_NO_ENTRIES_EVIDENCE = 'no_hook_rows';

const HOOK_LINE = Object.freeze({
  duplicate: SETUP_COPY.lineDuplicate,
  stale: SETUP_COPY.lineStale,
  dark: SETUP_COPY.lineDark,
  not_set_up: SETUP_COPY.lineNotSetUp,
});

/** Parse an ISO stamp; NaN when it is absent or unreadable. */
function stampMs(v) {
  return typeof v === 'string' && v ? Date.parse(v) : NaN;
}

/**
 * Did the installer check in within HOOK_STEP2_WINDOW_MS of `now`? A stamp a
 * little in the future (clock skew between this machine and the server) still
 * counts; a stamp more than the window ahead is not evidence of anything.
 */
function installerCheckedInRecently(hookBlock, now) {
  if (!hookBlock || typeof hookBlock !== 'object') return false;
  const t = stampMs(hookBlock[HOOK_INSTALLER_CHECKIN_FIELD]);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age <= HOOK_STEP2_WINDOW_MS && age >= -HOOK_STEP2_WINDOW_MS;
}

/**
 * The folder names the verdict lists (`recent_roots`), in the server's order.
 * OPTIONAL, and newer than some servers: absent, not a list, or holding nothing
 * usable is [] — the folders are then left out, never guessed. Each passes through
 * sessions.js normalizeFolderName(), the one normaliser a folder name is shown
 * through: one line, trimmed, no bidirectional controls (fix round 1).
 */
function verdictRoots(v) {
  return Array.isArray(v.recent_roots)
    ? v.recent_roots.map(normalizeFolderName).filter(Boolean)
    : [];
}

/** SETUP_COPY.lineOk, plus lineOkRoots when the server names the roots. */
function hookOkLine(v, now) {
  // ⛔ From the ROW's timestamp against THIS clock, not the server's
  // `hours_since_hook_row`: the health payload is cached for up to 5 minutes, and
  // an age frozen at fetch time would drift. The server's figure is the fallback.
  const t = stampMs(v.last_hook_row_at);
  let hours = null;
  if (Number.isFinite(t)) hours = Math.max(0, now - t) / 3600000;
  else if (v.hours_since_hook_row != null && Number.isFinite(Number(v.hours_since_hook_row))) hours = Number(v.hours_since_hook_row);
  // Function replacers, never string ones: a folder can contain `$&`, and a string
  // replacement would expand it.
  let line = SETUP_COPY.lineOk.replace('{ago}', () => fmtSince(hours));
  const roots = verdictRoots(v);
  if (roots.length) line += SETUP_COPY.lineOkRoots.replace('{roots}', () => roots.join(', '));
  return line;
}

/**
 * The pure state function: the health envelope → what the member is told about
 * their Claude Code hook, and which setup step (if any) the card shows.
 *
 * @param {object|null|undefined} health the fetchHealth() envelope
 *   (`{ data, fetchedAt, error, cached }`), or null when there is none.
 * @param {{ now?: number }} [opts]
 * @returns {{ key: 'ok'|'duplicate'|'stale'|'dark'|'not_set_up'|'no_entries'|'cant_check',
 *             level: 'ok'|'warn'|'unknown', line: string, short: string,
 *             card: ({ step: 1|2 }|null), roots: string[] }}
 *   `roots` (0.11.4) are the folder names the verdict lists, whatever its state —
 *   [] when it lists none and on every "can't check". The sessions block's
 *   "Recording from:" line reads them here (sessionsBlockState), so the verdict
 *   is still read in this one function.
 */
export function hookSetupState(health, { now = Date.now() } = {}) {
  const cantCheck = {
    key: 'cant_check', level: 'unknown', line: SETUP_COPY.lineCantCheck, short: HOOK_ROW_WORD.cant_check, card: null, roots: [],
  };
  // ⛔ ONLY A FRESH ANSWER COUNTS (lane L4b, 2026-09-14). fetchHealth() answers a
  // FAILED refresh with the last cached payload, flagged `error`, with no age
  // bound. Read as an answer it would show "Recording" — or a card — off a
  // reading from any point in the past while the server cannot be asked.
  if (!health || typeof health !== 'object' || health.error) return cantCheck;
  const v = health.data && health.data.hook_verdict;
  // Absent = an older server. Not an object = not a verdict.
  if (!v || typeof v !== 'object' || Array.isArray(v)) return cantCheck;
  // The server itself could not read the rows: say nothing either way.
  if (v.degraded === true) return cantCheck;

  let key = null;
  if (v.state === 'ok') key = 'ok';
  else if (HOOK_PROBLEM_STATES.includes(v.state)) key = v.state;
  else if (v.state === 'unknown' && HOOK_NOT_SET_UP_EVIDENCE.includes(v.evidence)) key = 'not_set_up';
  else if (v.state === 'unknown' && v.evidence === HOOK_NO_ENTRIES_EVIDENCE) key = 'no_entries';
  if (!key) return cantCheck;            // 'unknown' + 'unavailable', and any state added later

  const roots = verdictRoots(v);
  if (key === 'ok') {
    return { key, level: 'ok', line: hookOkLine(v, now), short: HOOK_ROW_WORD.ok, card: null, roots };
  }
  if (key === 'no_entries') {
    // Grey and no card: a quiet day is a fact, not a fault (see the header above).
    return { key, level: 'unknown', line: SETUP_COPY.lineNoEntries, short: HOOK_ROW_WORD.no_entries, card: null, roots };
  }
  return {
    key,
    level: 'warn',
    line: HOOK_LINE[key],
    short: HOOK_ROW_WORD[key],
    // The installer's check-in — the one key read from the `hook` block (see
    // HOOK_INSTALLER_CHECKIN_FIELD). Never its state or last_seen_at.
    card: { step: installerCheckedInRecently(health.data.hook, now) ? 2 : 1 },
    roots,
  };
}

/**
 * The compact "Hooks" entry on the status row. Its level and word come from
 * hookSetupState(), exactly as the strip's hook line does, so the two cannot
 * disagree. A hook problem is amber, never red: the fix is the card below, and it
 * never blocks tracking.
 */
export function hooksIndicator(health, now = Date.now()) {
  const s = hookSetupState(health, { now });
  return { level: s.level, short: 'Hooks', msg: s.short, detail: s.line };
}

/**
 * Timer.
 *
 * ⛔ D3 (Rob, 2026-09-14): grey for normal idle, and it must never read "not
 * tracking" above a running timer. Through 0.11.2's first cut this dot went RED
 * (its "not tracking" state) whenever no timer was running and an item was overdue — and on
 * the popup it was painted ONCE, from chrome.storage.local, when health landed, so
 * pressing Start (or opening on a machine whose worker had not adopted the server's
 * open entries yet) left that red state sitting above the live run list.
 * Idle is not a fault a member must act on, so it is grey whatever is waiting, and
 * every surface hands this the SAME running set it draws its timer cards from.
 */
export function timerIndicator({ timers, cards, now = Date.now() }) {
  const running = Array.isArray(timers) ? timers.length : 0;
  if (running > 0) {
    // v0.8.6: the panel got its own per-card Stop, so the status row no longer sends
    // people to the toolbar for it — saying so here would contradict the button
    // sitting two rows below this line.
    return { level: 'ok', short: 'Timer', msg: `Running (${running})`, detail: `${running} timer${running === 1 ? '' : 's'} running. Stop one on its card below, or in the toolbar popup.` };
  }
  const total = (cards || []).reduce((n, c) => n + c.items.length, 0);
  if (total > 0) {
    return { level: 'unknown', short: 'Timer', msg: 'Idle', detail: `No timer running. ${total} task${total === 1 ? '' : 's'} are waiting — pick one below.` };
  }
  return { level: 'unknown', short: 'Timer', msg: 'Idle', detail: 'No timer running and nothing queued.' };
}

/**
 * Capture, on the status line — present ONLY when capture is not running.
 *
 * ⛔ D3: the capture notice card leaves the surface once it is acknowledged, so the
 * status line is where a member still learns that nothing is being recorded. Red
 * for the two states the member must act on (signed out; the notice not yet
 * acknowledged, i.e. capture refused to start), grey for a pause the member chose.
 * Capturing normally, or state that could not be read, adds nothing to the line.
 */
export function captureIndicator(capture) {
  if (!capture || typeof capture !== 'object') return null;
  const reason = captureGate(capture).reason;
  if (reason === 'signed_out') {
    // OPUS_COPY — status-line label + word when this profile is signed out.
    return { level: 'bad', short: 'Capture', msg: 'Signed out', detail: 'Nothing is being recorded on this profile until you sign back in.' };
  }
  if (reason === 'not_acknowledged') {
    return { level: 'bad', short: 'Capture', msg: 'Waiting on you', detail: 'Capture has not started. Nothing is recorded until you read the notice below and accept it.' };
  }
  if (reason === 'paused') {
    return { level: 'unknown', short: 'Capture', msg: 'Paused', detail: 'You paused capture, so nothing is being recorded on this profile. Click this status line to find Resume capture.' };
  }
  return null;
}

export function computeIndicators({ health, feed, timers, cards, capture, now = Date.now() }) {
  const out = {
    chips: chipsIndicator(feed, now),
    hooks: hooksIndicator(health, now),
    timer: timerIndicator({ timers, cards, now }),
  };
  const cap = captureIndicator(capture);
  if (cap) out.capture = cap;
  return out;
}

/**
 * The running set BOTH halves of a surface draw from, so the status line and the
 * timer cards cannot disagree. `local` is chrome.storage.local's timers;
 * `server` is /api/ext/blocks' open_entries (the popup's run list). Deduped by
 * timer key, server entries mapped to the local shape.
 */
export function runningSet(local, server) {
  const byKey = new Map();
  for (const t of Array.isArray(local) ? local : []) if (t && t.key) byKey.set(String(t.key), t);
  for (const oe of Array.isArray(server) ? server : []) {
    if (!oe) continue;
    const blockId = oe.calendar_block_id ?? null;
    const projectId = blockId == null ? (oe.project_id ?? null) : null;
    const key = blockId != null ? String(blockId) : projectId != null ? `project:${projectId}` : '__internal__';
    if (!byKey.has(key)) byKey.set(key, { key, blockId, projectId, entryId: oe.id ?? null, startedAt: oe.started_at || null });
  }
  return [...byKey.values()];
}

/**
 * The always-visible status row. `host` gets the row; `detailHost` (optional)
 * gets the expanded explanation when an indicator is clicked. Both surfaces call
 * this with their own hosts — the markup and the wording come from here only.
 */
export function renderStatusRow(host, inds, detailHost) {
  if (!host) return;
  // Inside the popup the row lives in a <summary>, where a real <button> would
  // swallow the click that opens the details. There it renders as plain spans and
  // the surrounding <summary> owns the interaction.
  const interactive = !!detailHost;
  host.textContent = '';
  host.className = 'mm-status';
  const order = ['chips', 'hooks', 'timer', 'capture'];
  let drawn = 0;
  order.forEach((k) => {
    const ind = inds[k];
    if (!ind) return;
    if (drawn++ > 0) host.appendChild(el('span', 'mm-sep', '·'));
    const b = el(interactive ? 'button' : 'span', 'mm-ind');
    if (interactive) b.type = 'button';
    b.dataset.k = k;
    if (interactive) b.setAttribute('aria-expanded', 'false');
    b.title = `${ind.short}: ${ind.msg} — ${ind.detail}`;
    b.appendChild(el('span', 'mm-dot', DOT[ind.level] || DOT.unknown));
    b.appendChild(el('span', null, ind.short));
    b.appendChild(el('span', 'mm-muted', ind.msg));
    if (!interactive) {
      host.appendChild(b);
      return;
    }
    b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') === 'true';
      host.querySelectorAll('.mm-ind').forEach((x) => x.setAttribute('aria-expanded', 'false'));
      if (open) {
        detailHost.classList.add('hidden');
        detailHost.textContent = '';
        return;
      }
      b.setAttribute('aria-expanded', 'true');
      detailHost.textContent = '';
      detailHost.appendChild(el('strong', null, `${ind.short}: ${ind.msg}. `));
      detailHost.appendChild(document.createTextNode(ind.detail));
      detailHost.classList.remove('hidden');
    });
    host.appendChild(b);
  });
}

// ───────────────────────────────────────────────────── the health strip (lanes)
//
// ⛔ WHY THIS LIVES HERE AND NOT IN popup.js (v0.10.0).
//
// The strip was popup-private: its markup was hand-written into popup.html with a
// `#health-<lane>-dot|-msg|-link` id scheme, and its logic sat in popup.js as
// module-scoped functions. That put three byte-identical copies of DOT,
// daysFromHours and fmtSince in this repo at once, and it made "show the same
// thing in the side panel" mean "write the whole thing again". A surface that
// drifts from the one beside it is worse than not having it — this file's opening
// comment has said so since v0.8.3, and the strip was the last thing ignoring it.
//
// So the lanes are computed here, and renderHealthDetail builds its own DOM with
// createElement instead of looking up ids. That is the only shape a static
// popup.html and a panelapp-built tree can both call. Same precedent as the
// startCard extraction (cardstart.js).

/**
 * Only http(s) links survive. The download and hook-install URLs come from the
 * server, and an href is assigned — never interpolated as HTML — so this is the
 * one place a `javascript:`/`data:` URL is stopped.
 */
export function safeHttpUrl(u) {
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  } catch (e) {
    return null;
  }
}

/**
 * The extension lane: THIS build's manifest version against latest / min_supported —
 * the same three states the update banner uses.
 *
 * ⛔ Always manifestVersion(), never the server's `version.installed` echo: that
 * value can come from a different machine sharing the token, or lag this machine's
 * upgrade by up to the 5-minute stamp throttle. Telling a v0.7.0 user "you're on
 * v0.3.1" because their desktop last stamped is worse than saying nothing.
 */
export function extIndicator(status) {
  const installed = manifestVersion();
  const name = 'Time tracker extension';
  if (!status || status.level === 'none') {
    return { key: 'ext', name, level: 'ok', msg: `Running v${installed} — up to date.`, url: null, linkLabel: null };
  }
  if (status.level === 'red') {
    const floor = status.minSupported ? ` and this backend needs v${status.minSupported} or newer` : '';
    const get = status.latest ? ` Download v${status.latest} and reload the extension.` : ' Download the current build and reload the extension.';
    return {
      key: 'ext',
      name,
      level: 'bad',
      msg: `Update required — you're on v${installed}${floor}. Start stays blocked until you do.${get}`,
      url: safeHttpUrl(status.downloadUrl),
      linkLabel: 'Download the latest build',
    };
  }
  return {
    key: 'ext',
    name,
    level: 'warn',
    msg: `Update available — v${status.latest}. You're on v${installed}.`,
    url: safeHttpUrl(status.downloadUrl),
    linkLabel: 'Download the latest build',
  };
}

/**
 * The feed lane: DERIVED FROM THE CAPTURE GATE, not a fixed statement.
 *
 * ⛔ THIS LANE USED TO BE A FIXED SENTENCE, AND THE INSTRUCTION THAT MADE IT ONE
 * IS NOW THE OPPOSITE OF CORRECT. Through v0.10.x it read "off for everyone,
 * waiting on a release (not your setup)" at level `warn`, and this docblock
 * ended with "do not make either of them depend on state". That was right for
 * the world it was written in: always-on capture had been removed for EVERYONE
 * at v0.6.0, so the feed really was dark on every install in the field and a
 * fixed sentence was a true one. Capture SHIPS IN v0.11.0. On a v0.11.0 install
 * that same fixed sentence tells a member whose work IS being captured that
 * their feed is off — on the one surface whose entire job is to stop somebody
 * misreading their own install. A statement that cannot move is only honest
 * while the thing it describes cannot move, and this one now moves.
 *
 * ⛔ WHAT THE LANE IS STILL FOR IS UNCHANGED (plan: extension-self-heal-vs-
 * troubleshoot, 2026-08-26 §4). The failure it exists to stop was never a broken
 * feed — it is a member looking at their own feed, drawing a conclusion about
 * their install, and either burning an afternoon on it or quietly deciding the
 * extension does not work. "This one isn't yours" was the whole answer while
 * capture was off for everyone; now that capture can actually be on, off, paused
 * or waiting on them, the answer has to be WHICH of those it is — and, when the
 * cause is theirs, the one thing that would fix it.
 *
 * ⛔ DO NOT RE-DERIVE THE STATE HERE. The precedence — signed out beats
 * not-acknowledged beats paused — belongs to captureGate() and to nothing else.
 * This function maps the gate's `reason` onto a sentence and does not decide
 * anything. Same rule hookHealthIndicator states below, for the same reason: two
 * implementations of "is capture on" is exactly how a surface ends up showing
 * green next to red, and here the two surfaces would be this lane and the pause
 * control sitting a few pixels above it.
 *
 * ⛔ AN UNREADABLE STATE IS `unknown` — NOT off, and NOT on. captureGate() FAILS
 * CLOSED, which is the only correct posture for a control that decides whether a
 * byte is recorded: an unreadable state reaches it as "signed out". That is the
 * right answer for the recorder and the wrong one for this lane, which would be
 * telling a member their capture had stopped on the strength of a storage read
 * that did not come back. So the unreadable case is caught HERE, before the
 * gate, and the lane says it could not read rather than picking a side.
 *
 * ⛔ THE FIVE STRINGS ARE VERBATIM COPY. Do not reword them, do not "improve" the
 * lowercase to match the lanes around it, and do not merge two of them because
 * they look similar.
 *
 * ⛔ `url` IS NULL ON EVERY LANE, DELIBERATELY. The three actions named — resume,
 * sign back in, review — are all IN-PAGE controls: resume and review are buttons
 * on the capture card (capturecard.js) mounted a few rows above this strip on
 * both surfaces, and the token step is reached by chrome.runtime.openOptionsPage()
 * from a click handler in popup.js. None of the three is an addressable URL, so
 * none was invented. The labels are carried on the lane; renderHealthDetail draws
 * a link only when BOTH `url` and `linkLabel` are set, so with `url` null it draws
 * none — which is the correct outcome, because a link to a fabricated destination
 * is worse than no link at all. Giving any of these three a real affordance means
 * teaching renderHealthDetail an in-page action, not inventing an href here.
 *
 * ⛔ Still EXCLUDED from the popup strip's auto-expand rule, and the reason has
 * changed with the lane. It is no longer "permanently amber"; it is now a lane
 * that is amber or red for as long as a member chooses to stay paused, which
 * would hold the strip open on every open until they changed their mind. The
 * card that owns that decision is already on screen above it.
 *
 * @param {object|null|undefined} capture the per-profile capture state from
 *   capture.js (getCapture()), or null/undefined when it could not be read.
 */
export function feedIndicator(capture) {
  const lane = (level, msg, linkLabel) => ({
    key: 'feed',
    name: 'feed',
    level,
    msg,
    url: null,
    linkLabel: linkLabel || null,
  });
  const UNREADABLE = () => lane('unknown', 'capture state could not be read on this profile', null);
  if (!capture || typeof capture !== 'object') return UNREADABLE();
  switch (captureGate(capture).reason) {
    case 'capturing':
      return lane('ok', 'on — your work is being matched to clients automatically', null);
    case 'paused':
      return lane('warn', 'paused by you — nothing is being recorded on this profile', 'Resume capture');
    case 'signed_out':
      return lane('bad', 'signed out — nothing is being recorded on this profile', 'Sign back in');
    case 'not_acknowledged':
      return lane('warn', 'waiting on you — review what gets recorded, then capture starts', 'Review');
    // A reason this lane has no sentence for is a gate that grew a state without
    // this surface being told. Say so; never fall through to one of the four.
    default:
      return UNREADABLE();
  }
}

/**
 * The "Claude Code hook" line. LEVEL and the sub-line come from hookSetupState() —
 * the same decision behind the compact "Hooks" word and the setup card — so the
 * three can never disagree.
 *
 * ⛔ NO INSTALL LINK ANY MORE (0.11.3). The old link labels ("Finish the hook
 * install" / "Reinstall the hook") were keyed on LIVENESS and pointed at the
 * installer page; the setup card below now carries the one step that is due, and
 * a liveness-keyed link beside a verdict-keyed line is two answers on one row.
 *
 * ⛔ "Change folders" IS ALWAYS THERE — on ok, on a problem, and on "can't check"
 * alike — because changing folders is a thing a member chooses to do, not a
 * symptom. It is an in-page reveal, not an href: its instruction is "copy the
 * step 1 message again", and on a healthy hook the card that holds that message
 * is not on screen, so the reveal carries the message and its Copy control too.
 *
 * ⛔ 0.11.4 — THE SESSIONS ARE NOT ON THIS LANE ANY MORE. Through 0.11.3 the lane
 * carried `sessions` and renderHealthDetail() drew a line per session under the
 * hook's own line — inside a <details> that stays shut on a healthy install. They
 * are now their own block outside the strip, below the controls
 * (sessionsBlockState / renderSessionsBlock, below), drawn once and never here.
 */
export function hookHealthIndicator(health, now = Date.now()) {
  const s = hookSetupState(health, { now });
  return {
    key: 'hook',
    name: 'Claude Code hook',
    level: s.level,
    msg: s.line,
    url: null,
    linkLabel: null,
    reveal: {
      key: 'hook-folders',
      label: SETUP_COPY.changeFolders,
      text: SETUP_COPY.changeFoldersBody,
      copy: {
        text: SETUP_COPY.message,
        label: SETUP_COPY.copyMessage,
        done: SETUP_COPY.copiedMessage,
        failed: CARD_AFFORDANCE.copyFailed,
      },
    },
  };
}

/**
 * The three lanes, in the order they are drawn. ext → feed → hook, matching the
 * plan's ordering (§4) and keeping the lane with an action on it — the hook's
 * "Change folders" — nearest the footer.
 *
 * `capture` is the per-profile capture state (capture.js getCapture()). It is the
 * feed lane's ONLY input; pass null/undefined and that lane reads `unknown`, which
 * is the honest answer for a surface that has not managed to read it yet.
 */
export function computeHealthLanes({ health, versionStatus, capture, now = Date.now() }) {
  return [
    extIndicator(versionStatus),
    feedIndicator(capture),
    hookHealthIndicator(health, now),
  ];
}

/**
 * The lanes when /api/ext/health could not be reached at all (older backend,
 * offline, bad token). Say so quietly: this must never look like a hook failure and
 * it must never gate anything.
 *
 * ⛔ The feed lane goes through the SAME feedIndicator() here — it is not
 * downgraded, blanked or re-worded on this path. Capture state is LOCAL: it lives
 * in chrome.storage.local on this profile and is decided by captureGate(), so an
 * unreachable server tells us nothing new about it and must not be allowed to
 * change what this lane says. An unreachable server is also precisely when someone
 * is most likely to start blaming their own install, which is when a truthful
 * reading of their own capture state is worth the most.
 */
export function unavailableHealthLanes(capture) {
  return [
    { key: 'ext', name: 'Time tracker extension', level: 'unknown', msg: `Running v${manifestVersion()}.`, url: null, linkLabel: null },
    feedIndicator(capture),
    // No health at all is the can't-check line — the same lane, the same
    // sentence and the same "Change folders" reveal as every other no-answer.
    hookHealthIndicator(null),
  ];
}

/** The strip's footer line: who this reading is for, and how much to trust it. */
export function healthFootText(health) {
  const d = health && health.data;
  const bits = [];
  if (d && d.member_email) bits.push(d.member_email);
  if (health && health.error) bits.push('last check failed — showing the cached reading');
  if (d && d.ext && d.ext.last_seen_at) bits.push(`extension last reported ${fmtSince(d.ext.hours_since)}`);
  // The server's echoed version is display-only and NEVER gates anything (see
  // healthVersionStatus). Show it only when it disagrees with this build — that
  // disagreement is the useful signal: another machine on this token is on an older
  // build, or this machine upgraded within the last stamp-throttle window.
  const serverSaw = d && d.version && d.version.installed;
  if (serverSaw && serverSaw !== manifestVersion()) {
    bits.push(`server last saw v${serverSaw} on this login`);
  }
  return bits.join(' · ');
}

/**
 * Draw the lanes into `host`. Built with createElement and textContent, using the
 * same class names popup.html used to hard-code, so health.css is the only styling
 * either surface needs.
 *
 * ⛔ `a.href = url` by ASSIGNMENT, never innerHTML — safeHttpUrl has already gated
 * the scheme and there is no second place for a URL to get in.
 */
// Which in-page reveals are open, per host. The lanes are REBUILT on every repaint
// (a capture change, a health read — every 30 s while the setup card is up), and
// a "Change folders" the member just opened must not snap shut under them.
const REVEALS_OPEN = new WeakMap();

/**
 * An in-page reveal under a lane: a link-styled toggle, the text it reveals and,
 * optionally, a copyable box. ⛔ A <button>, never an <a>: there is no destination,
 * and this renderer only ever draws a real http(s) href (see safeHttpUrl).
 */
function drawReveal(doc, host, body, reveal) {
  const open = REVEALS_OPEN.get(host) || new Set();
  REVEALS_OPEN.set(host, open);
  const rkey = reveal.key || reveal.label;
  const isOpen = open.has(rkey);

  const wrap = doc.createElement('div');
  wrap.className = 'health-link-wrap';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'health-reveal';
  btn.textContent = reveal.label;
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  wrap.appendChild(btn);
  body.appendChild(wrap);

  const panel = doc.createElement('div');
  panel.className = isOpen ? 'health-reveal-body' : 'health-reveal-body hidden';
  const text = doc.createElement('p');
  text.className = 'health-reveal-text';
  text.textContent = reveal.text;
  panel.appendChild(text);
  if (reveal.copy && reveal.copy.text) {
    const pre = doc.createElement('pre');
    pre.className = 'mm-consent-cmd health-reveal-msg';
    const code = doc.createElement('code');
    code.textContent = reveal.copy.text;
    pre.appendChild(code);
    panel.appendChild(pre);
    const copyBtn = doc.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'mm-consent-copy health-reveal-copy';
    copyBtn.textContent = reveal.copy.label;
    panel.appendChild(copyBtn);
    const status = doc.createElement('p');
    status.className = 'mm-consent-copystatus health-reveal-status';
    status.setAttribute('role', 'status');
    panel.appendChild(status);
    copyBtn.addEventListener('click', async () => {
      copyBtn.disabled = true;
      try {
        const how = await copyText(reveal.copy.text, doc);
        status.textContent = how ? reveal.copy.done : reveal.copy.failed;
      } finally {
        copyBtn.disabled = false;
      }
    });
  }
  body.appendChild(panel);

  btn.addEventListener('click', () => {
    const nowOpen = !open.has(rkey);
    if (nowOpen) open.add(rkey); else open.delete(rkey);
    btn.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    panel.className = nowOpen ? 'health-reveal-body' : 'health-reveal-body hidden';
  });
}

// ─────────────────── the Claude Code sessions block (0.11.3 · its own block in 0.11.4)
//
// ⛔ ITS OWN BLOCK, ON SCREEN WITHOUT OPENING ANYTHING, ON EVERY SURFACE
// (SPEC-tracker-0.11.4 §2.1–2.2). Through 0.11.3 the session lines were drawn by
// renderHealthDetail() inside the Claude Code hook lane — i.e. inside the strip's
// <details>, which stays shut on a healthy install — and at most two of them. They
// are now drawn into a host of their own, and drawn ONCE: renderHealthDetail() no
// longer knows about sessions at all.
//
// ⛔ BELOW THE CONTROLS (fix round 1 §2, Opus 2026-10-02). The sessions are
// information; timers, Start, Stop and the action cards are controls, and controls
// win. The block sits AFTER the next-up line and never above a running timer, a
// Stop, "Start another task" or an action card (the capture notice, the setup card,
// the owed-QA card). Where each surface puts the host: popup.js placeSessions()
// (after #qa-owed-card, or — in the running view — under "Start another task", the
// next-up line and the extension-request form), and panelapp.js (timers, next-up,
// sessions, task list). Its first placement — directly under the status row — put
// six sessions (427px) above every control in a 600px popup. Fix round 2: it is not
// drawn in the popup's My hours view either (the side panel already put it away
// there with its task region).
//
//   Claude Code sessions                        ← SESSION_COPY.blockHeading
//   <thread name>                               ← line 1: sessionTitleText()
//   <client> — <task> · in <folder>   Change    ← line 2: sessionLineText()
//   … up to MAX_SESSION_LINES sessions …
//   Recording from: <folders>                   ← recordingFromText(), muted
//
// ⛔ THE CONTROLS OUTLIVE A REPAINT. The block is repainted on every health read,
// on every storage tick on the side panel, and every 30 s while the setup card is
// up. A picker a member is typing into cannot be rebuilt under them, so each host
// keeps one controller per session across repaints: the same nodes carry the open
// state, the typed text, the picked candidate and the saved / error line through.
// A repaint that changes nothing moves no node; one that has to re-order them puts
// focus and the caret back where they were.
//
// ⛔ NOTHING TO DRAW IS NOTHING DRAWN. No session and no folders to name: the host
// stays hidden and EMPTY — no heading, no empty block. Until a host has something
// to draw it has no entry in this map and no node is created, so every member with
// no Claude Code session in the last 30 minutes and no folders line, and every
// surface that could not read health, renders exactly as it did before the block.
const SESSION_UI = new WeakMap();
let sessionUid = 0;
/** The class the block's host carries, and the one this renderer hides it with. */
const SESSIONS_BLOCK_CLASS = 'health-sessions-block';

/**
 * The picker's list, filtered the way every other picker here filters: the SAME
 * token-AND, sound-alike match as filterProjects(), over the candidate's label.
 */
export function filterTaskCandidates(candidates, query) {
  const list = Array.isArray(candidates) ? candidates : [];
  return filterProjects(list.map((c) => ({ name: c.label, client_name: '', candidate: c })), query)
    .map((p) => p.candidate);
}

/** Whatever has focus inside `box` (and its caret), so a rebuild can put it back. */
function focusWithin(doc, box) {
  try {
    const ae = doc.activeElement;
    if (!ae || typeof box.contains !== 'function' || !box.contains(ae)) return null;
    let sel = null;
    try {
      if (typeof ae.selectionStart === 'number') {
        sel = { start: ae.selectionStart, end: ae.selectionEnd, dir: ae.selectionDirection || 'none' };
      }
    } catch (e) { sel = null; }
    return { el: ae, sel };
  } catch (e) {
    return null;
  }
}

function refocus(kept) {
  try {
    if (!kept || kept.el.isConnected === false) return;
    kept.el.focus({ preventScroll: true });
    if (kept.sel && typeof kept.el.setSelectionRange === 'function') {
      kept.el.setSelectionRange(kept.sel.start, kept.sel.end, kept.sel.dir);
    }
  } catch (e) { /* a repaint never fails over focus */ }
}

/**
 * One session: its two lines (the thread's name; its client, task and folder),
 * its Change control, its picker and its saved / error line. Built once per
 * session_ref and then only updated.
 *
 * ⛔ Nothing here takes focus on its own. Opening the picker leaves focus on
 * Change (the next Tab reaches the first candidate); only after the member's own
 * Save does focus move — back to Change once the picker closes, or to Save after a
 * failure — and only when it would otherwise be lost.
 */
function sessionControl(doc, ui) {
  const uid = ++sessionUid;
  const ids = {
    title: `mm-session-${uid}-title`,
    line: `mm-session-${uid}-line`,
    picker: `mm-session-${uid}-picker`,
    head: `mm-session-${uid}-head`,
    input: `mm-session-${uid}-task`,
  };
  const st = { session: null, open: false, candidates: [], loadSeq: 0, chosen: null, saving: false, msg: '' };
  const mkEl = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const request = () => (ui.deps && typeof ui.deps.request === 'function' ? ui.deps.request : apiRequest);

  const root = mkEl('div', 'health-session');
  // Line 1 — the thread's name. ONE line: health.css cuts a long one with an
  // ellipsis, and update() keeps the whole name in the element's `title`.
  const title = mkEl('div', 'health-session-title');
  title.id = ids.title;
  root.appendChild(title);
  // Line 2 — the client and task (and the folder), with Change beside it.
  const line = mkEl('div', 'health-session-line');
  const text = mkEl('span', 'health-session-text');
  text.id = ids.line;
  line.appendChild(text);
  // A link-styled <button>, like "Change folders": it opens something in place and
  // has no destination.
  const change = mkEl('button', 'health-session-change', SESSION_COPY.change);
  change.type = 'button';
  change.setAttribute('aria-expanded', 'false');
  change.setAttribute('aria-controls', ids.picker);
  // Six sessions means six "Change" buttons; each is described by its own two
  // lines — the thread's name, then its client and task — so two sessions on the
  // same client and task are still told apart.
  change.setAttribute('aria-describedby', `${ids.title} ${ids.line}`);
  line.appendChild(change);
  root.appendChild(line);

  const picker = mkEl('div', 'health-task-picker hidden');
  picker.id = ids.picker;
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-labelledby', ids.head);
  const head = mkEl('p', 'health-task-h', SESSION_COPY.pickerHeading);
  head.id = ids.head;
  picker.appendChild(head);
  const list = mkEl('div', 'health-task-list hidden');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', ids.head);
  picker.appendChild(list);
  const lab = mkEl('label', 'health-task-lab', SESSION_COPY.typeLabel);
  lab.htmlFor = ids.input;
  picker.appendChild(lab);
  // ⛔ The SAME search control every list here uses (buildSearchBox): typing filters
  // the candidates above it, Escape clears it, and a pick fills it — one field for
  // one choice, the hours picker's rule (D3). Named by the visible label, so no
  // aria-label; and there is no placeholder copy for it, so none.
  const search = buildSearchBox(doc, { value: '', placeholder: '', ariaLabel: null, onChange: () => onType() });
  search.wrap.className = 'mm-search health-task-search';
  const input = search.input;
  input.id = ids.input;
  input.maxLength = TASK_LABEL_MAX;
  picker.appendChild(search.wrap);
  const save = mkEl('button', 'mm-btn primary health-task-save', SESSION_COPY.save);
  save.type = 'button';
  save.disabled = true;
  picker.appendChild(save);
  root.appendChild(picker);

  const msg = mkEl('p', 'health-task-msg hidden');
  msg.setAttribute('role', 'status');
  root.appendChild(msg);

  function syncSave() {
    save.disabled = st.saving || !normalizeTaskLabel(input.value);
  }

  function paint() {
    change.setAttribute('aria-expanded', st.open ? 'true' : 'false');
    picker.className = st.open ? 'health-task-picker' : 'health-task-picker hidden';
    if (st.msg === 'saved') {
      msg.textContent = SESSION_COPY.saved;
      msg.className = 'health-task-msg is-ok';
    } else if (st.msg === 'error') {
      msg.textContent = SESSION_COPY.saveFailed;
      msg.className = 'health-task-msg is-err';
    } else {
      msg.textContent = '';
      msg.className = 'health-task-msg hidden';
    }
    syncSave();
  }

  // A picked candidate shows the whole list with it marked; typing shows the
  // candidates that match what is typed.
  function renderOptions() {
    const shown = st.chosen ? st.candidates : filterTaskCandidates(st.candidates, input.value);
    // The list is rebuilt by a pick (Enter / Space / click on an option) and by a
    // fresh candidates answer; a member whose focus is ON an option keeps it on the
    // option with the same label, instead of dropping to <body> with the old button.
    let focusedLabel = null;
    try {
      const ae = doc.activeElement;
      if (ae && typeof list.contains === 'function' && list.contains(ae)) focusedLabel = ae.textContent;
    } catch (e) { focusedLabel = null; }
    list.textContent = '';
    let refocusOn = null;
    for (const c of shown) {
      const o = mkEl('button', 'health-task-opt', c.label);
      o.type = 'button';
      o.setAttribute('role', 'option');
      o.setAttribute('aria-selected', st.chosen === c ? 'true' : 'false');
      o.addEventListener('click', () => choose(c));
      list.appendChild(o);
      if (focusedLabel !== null && !refocusOn && c.label === focusedLabel) refocusOn = o;
    }
    list.className = shown.length ? 'health-task-list' : 'health-task-list hidden';
    if (refocusOn) { try { refocusOn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function choose(c) {
    st.chosen = c;
    input.value = c.label;
    renderOptions();
    syncSave();
  }

  // Typing away from a picked label un-picks it: an edited label is the member's
  // own, and must not be saved against the ticket it started from.
  function onType() {
    if (st.chosen && input.value !== st.chosen.label) st.chosen = null;
    renderOptions();
    syncSave();
  }

  async function loadCandidates() {
    const seq = ++st.loadSeq;
    const ref = st.session.ref;
    const r = await loadTaskCandidates(request(), ref);
    if (seq !== st.loadSeq) return;
    st.candidates = r.candidates;
    if (st.chosen) {
      const same = st.candidates.find((c) => c.label === st.chosen.label && c.ticketId === st.chosen.ticketId);
      if (same) st.chosen = same;
    }
    renderOptions();
  }

  // Opening or closing starts over on the message line: a "Couldn't save" the
  // member walked away from is not left standing under the line.
  function setOpen(open) {
    st.open = open;
    st.msg = '';
    if (open) {
      // Never offer last time's list: a ticket closed since then must not be
      // pickable while the fresh answer is on its way.
      st.candidates = [];
      renderOptions();
      loadCandidates();
    }
    paint();
  }

  // Has focus already fallen to <body> (a control it was on went away or was
  // disabled)? Only then does a save move it — never out of a field the member is in.
  const focusOnBody = () => {
    try {
      const ae = doc.activeElement;
      return !ae || ae === doc.body;
    } catch (e) {
      return false;
    }
  };
  // …and after a successful save the picker closes, so focus anywhere inside it is
  // about to be lost as well.
  const focusLost = () => {
    try {
      return focusOnBody() || (typeof picker.contains === 'function' && picker.contains(doc.activeElement));
    } catch (e) {
      return false;
    }
  };

  async function onSave() {
    const label = normalizeTaskLabel(input.value);
    if (!label || st.saving) return;
    const session = st.session;
    const ticketId = st.chosen && st.chosen.label === label ? st.chosen.ticketId : null;
    st.saving = true;
    st.msg = '';
    paint();
    const r = await saveTaskOverride(request(), { sessionRef: session.ref, label, projectId: session.projectId, ticketId });
    st.saving = false;
    if (!r.ok) {
      // The picker stays open with what was typed or picked, so trying again is
      // one press — and opens again if the member closed it while the save was
      // on its way, so the failure is never reported under a closed picker.
      st.open = true;
      st.msg = 'error';
      paint();
      if (focusOnBody()) { try { save.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      return;
    }
    const refocusChange = focusLost();
    st.chosen = null;
    input.value = '';
    st.open = false;
    st.msg = 'saved';
    renderOptions();
    paint();
    if (refocusChange) { try { change.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    // ⛔ THEN RE-READ HEALTH, BYPASSING THE 5-MINUTE CACHE (spec §4). The surface
    // hands in its own forced refresh so the block (and the strip) repaint from the
    // new reading; with none, the forced read still refreshes the shared cache.
    const refresh = ui.deps && typeof ui.deps.onTaskSaved === 'function'
      ? ui.deps.onTaskSaved
      : () => fetchHealth({ force: true });
    try { await refresh(); } catch (e) { /* the save stands; a failed re-read says so on the hook line */ }
  }

  change.addEventListener('click', () => setOpen(!st.open));
  save.addEventListener('click', () => { onSave(); });

  function update(session) {
    st.session = session;
    root.dataset.sessionRef = session.ref;
    // ⛔ TEXT, NEVER MARKUP (Opus, 2026-10-02). The thread's name and the folder
    // are free text off a member's machine and are treated as untrusted: they are
    // assigned to `textContent` (and the name to the `title` attribute, which is
    // never parsed either) and reach no HTML-string sink anywhere in this file.
    const name = sessionTitleText(session);
    title.textContent = name;
    // The whole name, for the one the ellipsis cut short.
    title.title = name;
    // A name with nothing in it draws NO line 1 — never an empty line: the
    // session is then its client-and-task line alone.
    title.className = name ? 'health-session-title' : 'health-session-title hidden';
    // Line 2 is clamped (fix round 1 §3: one line in the popup and the pop-out, two
    // on the side panel), so its whole text is in its `title` too.
    const lineText = sessionLineText(session);
    text.textContent = lineText;
    text.title = lineText;
  }

  return { root, update };
}

/**
 * What the sessions block draws, from ONE fetchHealth() envelope (0.11.4).
 *
 *   sessions  sessions.js claudeSessionsFrom(): null when there is no fresh answer
 *             (draw nothing, forget nothing), [] when there are none, otherwise up
 *             to MAX_SESSION_LINES in the server's order.
 *   roots     the folders the "Recording from:" line names — [] when the line is
 *             not drawn.
 *
 * ⛔ WHEN THE FOLDERS LINE IS DRAWN (fix round 1 §5, narrowing SPEC-tracker-0.11.4
 * §2.2): ONLY while the hook's verdict is ok, with sessions or without. Through the
 * first build it was also drawn under a session while the strip said the hook was
 * NOT recording (dark, stale, duplicate, not set up, no entries) — "Recording from"
 * beside a status that says not recording is false. It is never drawn from a
 * reading that could not be refreshed (the sessions are not either), and never when
 * the server names no folder: nothing is guessed.
 *
 * ⛔ The verdict is read by hookSetupState() and by nothing else — its `roots` and
 * its `key` are what this reads. (The strip's own " From: <folders>." on the ok
 * line is unchanged and is the same list.)
 */
export function sessionsBlockState(health, now = Date.now()) {
  const sessions = claudeSessionsFrom(health);
  if (!Array.isArray(sessions)) return { sessions: null, roots: [] };
  const hook = hookSetupState(health, { now });
  const roots = hook.key === 'ok' ? hook.roots : [];
  return { sessions, roots };
}

/** Add or drop one class. className, not classList: the probes' DOM stand-ins have no classList. */
function toggleClass(node, cls, on) {
  const list = String(node.className || '').split(/\s+/).filter((c) => c && c !== cls);
  if (on) list.push(cls);
  node.className = list.join(' ');
}

/**
 * Make `parent` hold exactly `nodes`, in that order.
 *
 * ⛔ A parent that already does is left ALONE — the block is repainted on every
 * health read and every storage tick, and re-appending the node a member is typing
 * in would take their focus and caret each time. When the nodes do have to move (a
 * session arrived, left, or the server's order changed), whatever had focus inside
 * `parent` gets it back, with its caret.
 */
function placeChildren(doc, parent, nodes) {
  const now = parent.children;
  if (now && now.length === nodes.length && nodes.every((n, i) => now[i] === n)) return;
  const kept = focusWithin(doc, parent);
  parent.textContent = '';
  for (const n of nodes) parent.appendChild(n);
  if (kept) refocus(kept);
}

/**
 * Draw the Claude Code sessions block into `host` — its heading, two lines per
 * session, and the folders line — or hide the host when there is nothing to draw.
 *
 * `host` is the surface's own node for the block, placed after the next-up line and
 * below every control (see the note above SESSION_UI): popup.html's #sessions-host,
 * and the node panelapp.js builds for the side panel and the pop-out. This owns the
 * host's `hidden` class and its children; it is the ONLY thing that draws a session.
 *
 * @param {{sessions: (Array|null), roots: string[]}} block sessionsBlockState()'s answer
 * @param {object} [deps] for each session's "Change" picker: `onTaskSaved()` is the
 *   surface's own FORCED health refresh, run after a save (the popup's
 *   refreshHealth(true), the panel's rereadHealth(true)); `request` replaces
 *   common.js apiRequest (probes and tests only).
 */
export function renderSessionsBlock(doc, host, block, deps = {}) {
  if (!host) return;
  const sessions = block && Array.isArray(block.sessions) ? block.sessions : null;
  const roots = sessions && Array.isArray(block.roots) ? block.roots : [];
  const rootsLine = recordingFromText(roots);
  let ui = SESSION_UI.get(host);
  if (!ui) {
    // Nothing to draw on a host that has drawn nothing: no node is created.
    if (!sessions || (sessions.length === 0 && !rootsLine)) return;
    ui = { head: null, box: null, roots: null, ctls: new Map(), deps: {} };
    SESSION_UI.set(host, ui);
  }
  ui.deps = deps || {};
  // No fresh answer: draw nothing and forget nothing — a picker the member is
  // using survives a re-read that failed, and comes back with the next answer.
  if (!sessions) {
    toggleClass(host, 'hidden', true);
    return;
  }
  // A fresh answer: a session it no longer lists is gone, and so is its picker.
  const live = new Set(sessions.map((s) => s.ref));
  for (const ref of [...ui.ctls.keys()]) if (!live.has(ref)) ui.ctls.delete(ref);

  const parts = [];
  if (sessions.length > 0) {
    if (!ui.head) {
      ui.head = doc.createElement('h2');
      ui.head.className = 'health-sessions-h';
      ui.head.textContent = SESSION_COPY.blockHeading;
      ui.box = doc.createElement('div');
      ui.box.className = 'health-sessions';
    }
    placeChildren(doc, ui.box, sessions.map((s) => {
      let ctl = ui.ctls.get(s.ref);
      if (!ctl) {
        ctl = sessionControl(doc, ui);
        ui.ctls.set(s.ref, ctl);
      }
      ctl.update(s);
      return ctl.root;
    }));
    parts.push(ui.head, ui.box);
  }
  if (rootsLine) {
    if (!ui.roots) {
      ui.roots = doc.createElement('p');
      ui.roots.className = 'health-sessions-roots';
    }
    // The folder names are the server's and are drawn as TEXT (textContent), like
    // every other value in this block — never as markup. The line is clamped to two
    // lines in the popup and the pop-out (fix round 1 §3), so its whole text is in
    // its `title` too.
    if (ui.roots.textContent !== rootsLine) ui.roots.textContent = rootsLine;
    ui.roots.title = rootsLine;
    parts.push(ui.roots);
  }
  placeChildren(doc, host, parts);
  toggleClass(host, SESSIONS_BLOCK_CLASS, true);
  toggleClass(host, 'hidden', parts.length === 0);
}

/**
 * Draw the lanes into `host` (see the note above REVEALS_OPEN for what survives a
 * repaint). ⛔ 0.11.4 — no sessions here: they are renderSessionsBlock()'s.
 */
export function renderHealthDetail(doc, host, lanes) {
  if (!host) return;
  host.textContent = '';
  for (const lane of lanes || []) {
    const row = doc.createElement('div');
    row.className = 'health-row';
    const dot = doc.createElement('span');
    dot.className = 'health-dot';
    dot.dataset.lane = lane.key || '';
    dot.textContent = DOT[lane.level] || DOT.unknown;
    row.appendChild(dot);

    const body = doc.createElement('div');
    const name = doc.createElement('div');
    name.className = 'health-name';
    name.textContent = lane.name || '';
    body.appendChild(name);
    const msg = doc.createElement('div');
    msg.className = 'health-msg';
    msg.textContent = lane.msg || '';
    body.appendChild(msg);
    if (lane.url && lane.linkLabel) {
      const wrap = doc.createElement('div');
      wrap.className = 'health-link-wrap';
      const a = doc.createElement('a');
      a.href = lane.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = lane.linkLabel;
      wrap.appendChild(a);
      body.appendChild(wrap);
    }
    if (lane.reveal && lane.reveal.label && lane.reveal.text) drawReveal(doc, host, body, lane.reveal);
    row.appendChild(body);
    host.appendChild(row);
  }
}

// ────────────────────────────────────────────────────────────── running timers

/**
 * The name on a running timer's card, from the STORED timer — the side panel and
 * the pop-out read `chrome.storage.local` and never ask /api/ext/blocks.
 *
 * ⛔ 0.11.4 — ONE RESOLUTION, THREE SURFACES: common.js timerDisplayTitle(), the
 * same function the popup's run list calls. A stored timer carries the title it
 * was started or adopted with (for a block, the block's own title) and, since
 * 0.11.4, the server's `project_name` (`projectName`), so this is steps 2 → 3 → 4
 * of that function. Before it, a client timer with no stored title read
 * "Unscheduled work" here while the popup said "Client work".
 *
 * ⛔ The result is drawn as TEXT: renderTimers() hands it to el(), which assigns
 * `textContent`, and to two `title` attributes. A project's name is the server's
 * and is never parsed as markup.
 */
function timerTitle(t) {
  const blockId = t.blockId ?? null;
  return timerDisplayTitle({
    blockId,
    projectId: blockId == null ? (t.projectId ?? projectIdFromKey(t.key)) : null,
    storedTitle: t.title,
    projectName: t.projectName,
  });
}

export function isOverdueTimer(t, schedEndBlocks) {
  if (!t) return false;
  if (schedEndBlocks && schedEndBlocks[t.key]) return true;
  if (!t.scheduledEnd) return false;
  const end = Date.parse(t.scheduledEnd);
  return Number.isFinite(end) && Date.now() > end;
}

/**
 * The running-timer list.
 *
 * v0.8.6 — every card now carries its own Stop. Asif, via Rob (2026-08-13): "The
 * sidebar doesn't have a stop button on it. Only the pop-up extension does. Both the
 * pop-up and the sidebar need to have the stop buttons on the tracking tasks."
 *
 * ⛔ The button is only DRAWN when a handler is supplied. A Stop that does not run
 * the delivery-QA gate is worse than no Stop at all (see common.js → DELIVERY-QA
 * GATE), so this renderer refuses to paint an affordance nobody is wired to serve.
 *
 * @param {object} handlers { onStop(timer, btn, card) }
 */
export function renderTimers(headEl, countEl, cardsEl, timers, handlers = {}) {
  if (!cardsEl) return;
  const open = timers
    .slice()
    .sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));

  if (countEl) {
    countEl.textContent = open.length
      ? `${open.length} ${open.length === 1 ? 'timer' : 'timers'} running`
      : 'Nothing running';
  }
  if (headEl) headEl.classList.toggle('idle', open.length === 0);

  cardsEl.textContent = '';
  if (open.length === 0) {
    cardsEl.appendChild(el('div', 'mm-empty', 'No timer is running. Start one from a task below, or from the toolbar popup.'));
    return;
  }
  // The server caps a member at 4 parallel blocks, so this list is short by
  // construction — every open timer is shown, never a truncated subset.
  for (const t of open) {
    const card = el('div', 'mm-timer-card');
    card.dataset.key = t.key || '';
    card.dataset.started = t.startedAt || '';
    const top = el('div', 'mm-timer-top');
    const title = el('span', 'mm-timer-title', timerTitle(t));
    title.title = timerTitle(t);
    top.appendChild(title);
    top.appendChild(el('span', 'mm-timer-clock', t.startedAt ? fmtElapsed(t.startedAt) : '00:00:00'));
    card.appendChild(top);
    if (t.note) card.appendChild(el('div', 'mm-timer-note', t.note));
    const over = el('div', 'mm-timer-over hidden', 'Scheduled time is up.');
    card.appendChild(over);

    if (typeof handlers.onStop === 'function') {
      const actions = el('div', 'mm-timer-actions');
      const stop = el('button', 'mm-btn mm-timer-stop', 'Stop');
      stop.type = 'button';
      stop.dataset.key = t.key || '';
      stop.title = `Stop ${timerTitle(t)}`;
      stop.addEventListener('click', (ev) => {
        // The surrounding surfaces treat a card click as "expand"; Stop is not that.
        ev.stopPropagation();
        ev.preventDefault();
        handlers.onStop(t, stop, card);
      });
      actions.appendChild(stop);
      card.appendChild(actions);
    }

    cardsEl.appendChild(card);
  }
}

/** Per-second clock repaint. Cheap, local, no I/O. */
export function updateClocks(cardsEl, timers, schedEndBlocks) {
  if (!cardsEl) return;
  const byKey = new Map((timers || []).map((t) => [String(t.key), t]));
  cardsEl.querySelectorAll('.mm-timer-card').forEach((card) => {
    const started = card.dataset.started;
    if (started) {
      const clock = card.querySelector('.mm-timer-clock');
      if (clock) clock.textContent = fmtElapsed(started);
    }
    const t = byKey.get(String(card.dataset.key));
    const over = card.querySelector('.mm-timer-over');
    if (over) over.classList.toggle('hidden', !isOverdueTimer(t, schedEndBlocks));
  });
}

// ─────────────────────────────────────────────────────────── the task inventory

// ⛔ 0.11.4 — THE FIRST BAND IS NAMED FOR WHAT IT HOLDS (SPEC-tracker-0.11.4 §2.3,
// Opus's words, verbatim). It was "Needs a reply — next 24 hours", but the rule
// behind it (taskfeed.js classifyItem) is "due within 24 hours with no time
// logged", meetings included — there is no inbound-message signal in it, so
// nothing here can know a reply is owed. The band's title, its sub-line, the item
// and card chips ("DUE < 24H") and the summary's "due <when>" changed; the
// internal key `reply_24h` and the rule did not.
const BANDS = [
  {
    key: 'reply_24h',
    title: 'Due in the next 24 hours',
    sub: 'due inside 24 hours, with no time logged yet',
  },
  { key: 'overdue', title: 'Overdue', sub: 'the date has already passed' },
  { key: 'open', title: 'Everything else open', sub: 'the rest of your inventory' },
];

/**
 * ⛔ SILENCE AND EMPTINESS MUST NOT LOOK THE SAME.
 *
 * One true sentence about the last refresh, or null when it succeeded. Called by
 * renderTasks() for EVERY surface, so the popup, the side panel and the pop-out
 * cannot disagree about whether the list in front of you is real.
 *
 * Before this existed, a failed `GET /api/ext/next-task` with no cache produced a
 * popup that was BYTE-IDENTICAL to a healthy, genuinely empty one — measured
 * 2026-08-12, same md5 across a 500, an unreachable network and an empty feed —
 * and it read "Nothing open for you right now." A person whose feed is broken was
 * being told, in a reassuring voice, that they were done for the day.
 *
 * The wording is the side panel's own, kept deliberately: it already said
 * "last refresh failed (…) — showing the cached list" in its footer. The only
 * thing added is the honest tail for the case where there is NO cache, because
 * that footer was claiming to show a cached list when there was nothing to show.
 *
 * `feed` is the envelope from fetchTaskFeed(): { data, fetchedAt, error, cached }.
 * `data` is non-null only when a list is actually being displayed — fetchTaskFeed
 * returns the warm cache on failure and `data: null` when there is none.
 */
export function feedStatusNote(feed) {
  if (!feed || !feed.error) return null;
  if (feed.data) return `Last refresh failed (${feed.error}) — showing the cached list.`;
  return `Last refresh failed (${feed.error}) — and there is no cached list to fall back on, so this is a broken feed, not an empty one.`;
}

// ───────────────────────────────── the server's packet, rendered for a HUMAN
//
// ⛔ EDIT 3 of the four named in /api/ext/next-task's route header: render
// `card.view.collapsed` on the row and `card.view.expanded` on hover, instead of
// the ad-hoc line assembly below.
//
// ONE DATA SHAPE, THREE RENDERINGS (Rob's approved shape): collapsed (the Discord
// post and the card's default), expanded (hover, full detail), and the CHIP. The
// first two are prose for a person. The third is an ARTIFACT FOR AN AGENT and
// deliberately carries scaffolding — a curl claim call, a TodoWrite instruction,
// per-item fingerprints — because that scaffolding is precisely what lets a Claude
// Code session claim the work and report back. That is its job.
//
// ⛔ AND IT MUST NEVER REACH A HUMAN-FACING RENDERING. The chip goes to the
// clipboard on Start and nowhere else.

/**
 * The markers that identify agent scaffolding, taken from the strings
 * `buildClientGroupBrief` actually emits.
 *
 * ⛔ THIS IS A STRUCTURAL GUARD, NOT A COMMENT. The isolation could have been
 * "call the right field" and left to care — but the failure mode is silent and
 * ugly (a member's task card growing a bash block containing a bearer-token
 * incantation), and this file's whole premise is that a second copy of a rule
 * drifts from the first. So the human renderers CHECK, and a string that fails the
 * check is refused and falls back to the locally-assembled card rather than being
 * displayed. If the server ever regresses and puts the chip in `collapsed`, this
 * surface degrades to the old rendering instead of leaking.
 */
const AGENT_SCAFFOLDING = [
  /\/api\/ext\/chip-event/i,
  /TodoWrite/,
  /Authorization:\s*Bearer/i,
  /task_fingerprint/,
  /mm-hooks\/token/,
];

/** True when `text` carries agent scaffolding and must not be shown to a person. */
export function hasAgentScaffolding(text) {
  const s = String(text || '');
  return AGENT_SCAFFOLDING.some((re) => re.test(s));
}

/**
 * A human view from the server, or null if there isn't a usable one.
 *
 * `which` is 'collapsed' | 'expanded'. Returns null when the packet is absent, the
 * field is empty, or — the guard above — the string carries agent scaffolding. A
 * null answer means "render the card the way you always did", which is why the
 * legacy assembly below is still here and still correct.
 */
export function humanView(card, which) {
  const v = card && card.view;
  const s = v && typeof v[which] === 'string' ? v[which].trim() : '';
  if (!s) return null;
  if (hasAgentScaffolding(s)) return null;
  return s;
}

/**
 * Render OW's Discord-flavoured markdown into a fragment, with textContent only.
 *
 * The server composes `collapsed`/`expanded` for a Discord message, so it is plain
 * text with `**bold**`, backtick code spans, `·` separators and `   ↳ Source: <url>`
 * continuation lines. Showing it raw would put literal asterisks on the card;
 * assigning it as HTML would hand third-party client names and ticket titles an
 * injection point. So: parse the three inline forms, build real nodes, and let
 * everything else through as text.
 *
 * ⛔ Only http/https are linkified, and the href is the same string that is
 * displayed — no shortening, no title text that could disagree with the target.
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>()]+)/g;

export function renderMarkdownish(text, doc = document) {
  const frag = doc.createDocumentFragment();
  const lines = String(text || '').split('\n');
  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      frag.appendChild(Object.assign(doc.createElement('div'), { className: 'mm-pk-gap' }));
      return;
    }
    const div = doc.createElement('div');
    div.className = /^\s/.test(raw) ? 'mm-pk-line mm-pk-indent' : 'mm-pk-line';
    const body = line.trim();
    let last = 0;
    body.replace(INLINE, (tok, _g, at) => {
      if (at > last) div.appendChild(doc.createTextNode(body.slice(last, at)));
      if (tok.startsWith('**')) {
        div.appendChild(Object.assign(doc.createElement('strong'), { textContent: tok.slice(2, -2) }));
      } else if (tok.startsWith('`')) {
        div.appendChild(Object.assign(doc.createElement('code'), { textContent: tok.slice(1, -1) }));
      } else {
        const a = doc.createElement('a');
        a.href = tok;
        a.textContent = tok;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        div.appendChild(a);
      }
      last = at + tok.length;
      return tok;
    });
    if (last < body.length) div.appendChild(doc.createTextNode(body.slice(last)));
    frag.appendChild(div);
  });
  return frag;
}

export function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (dateOnly) return day;
  return `${day} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * The same date, short enough to survive one line on a 300px side panel.
 *
 * `fmtDue` renders "Mon, Aug 17 2:02 PM" — right for an item's own detail row, and
 * roughly half the summary line's budget on its own, which is how a one-line card
 * becomes an ellipsis. Today and tomorrow are named rather than dated, because
 * that is what someone triaging actually needs to know, and everything else drops
 * the weekday and the minutes.
 */
export function fmtDueShort(iso, now = Date.now()) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const startOfDay = (t) => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((startOfDay(d.getTime()) - startOfDay(now)) / 86400000);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  const time = dateOnly
    ? ''
    : ` ${d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, '').toLowerCase()}`;

  if (days === 0) return `today${time}`;
  if (days === 1) return `tomorrow${time}`;
  if (days === -1) return `yesterday${time}`;
  if (days < 0) return `${Math.abs(days)}d overdue`;
  // Inside the working fortnight a weekday reads faster than a date.
  if (days <= 6) return `${d.toLocaleDateString([], { weekday: 'short' })}${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function itemLine(m, nextFingerprint) {
  const li = document.createElement('li');
  const t = el('div', 'mm-item-title', m.title);
  li.appendChild(t);

  const bits = [];
  const due = fmtDue(m.due);
  if (due) bits.push(`due ${due}`);
  bits.push(m.urgency_phrase);
  if (m.est_hours != null) bits.push(`est ${m.est_hours}h`);
  if (m._logged_hours > 0) bits.push(`${m._logged_hours}h logged`);
  bits.push(m.rank_reason);
  li.appendChild(el('div', 'mm-item-meta', bits.join(' · ')));

  const tags = el('div', 'mm-tags');
  if (nextFingerprint && m.fingerprint === nextFingerprint) {
    tags.appendChild(el('span', 'mm-tag next', '▶ NEXT UP'));
  }
  if (m._state === 'reply_24h') tags.appendChild(el('span', 'mm-tag red', 'DUE < 24H'));
  if (m._state === 'overdue') tags.appendChild(el('span', 'mm-tag amber', 'OVERDUE'));
  if (needsEta(m)) tags.appendChild(el('span', 'mm-tag eta', 'ETA NEEDED'));
  if (m._type === 'job_card') tags.appendChild(el('span', 'mm-tag', 'UNCLAIMED'));
  // ⛔ SAY WHY THIS CLIENT IS HERE. A `ticket_queue` row is the ONLY kind that
  // reached the panel without a calendar block behind it (server lane added
  // 2026-08-20), and for most people it is now most of their list — rob@ went
  // from 3 clients to 32 on the day it shipped. Without a tag, 29 unfamiliar
  // clients appear overnight with no explanation and the honest reaction is
  // "the tracker is broken", not "that is my ticket backlog".
  if (m._type === 'ticket_queue') tags.appendChild(el('span', 'mm-tag', 'TICKETS'));
  if (m._logged_hours > 0) tags.appendChild(el('span', 'mm-tag', 'IN PROGRESS'));
  if (tags.childNodes.length) li.appendChild(tags);

  li.appendChild(el('div', 'mm-item-fp', m.fingerprint));
  return li;
}

/**
 * One card per client, carrying EVERY open item that person has for that client.
 *
 * ⛔ The full enumeration is ALWAYS in the DOM — hover/focus only changes whether
 * it is displayed. Truncation is a rendering concern and never a data one (spec
 * §4.2); building the list lazily would make the a11y text lie about what the
 * card holds, which is the exact class of defect this surface exists to end.
 *
 * `handlers.nextFingerprint` (optional) is the fingerprint of the feed's #1 ranked
 * item — `data.next || data.items[0]`. The item and the card that hold it get a
 * "▶ NEXT UP" tag IN PLACE, inside whatever band they belong to.
 *
 * ⛔ It is a MARKER, never a reordering. Rob, 2026-08-12: "it said it was overdue.
 * It was in the overdue section instead of the next up." Until v0.8.3 the popup
 * labelled the #1 item by RANK ("▶ Next up") while the panel labelled the same row
 * by DATE BAND ("Overdue") — one endpoint, one cached payload, one item, two
 * classifiers, and they contradicted each other on screen. Both statements are
 * true, so both are now shown on the one row: the band says when it is due, the
 * tag says it is the top of the queue. Promoting the item out of its band to make
 * them agree would be the dishonest fix.
 *
 * `handlers.feed` (optional) is the fetchTaskFeed() envelope behind `cards`. Pass
 * it and a failed refresh is stated HERE, in the region the person is reading —
 * not only in a status dot above it or a footer below it. See feedStatusNote().
 *
 * `handlers.query` (optional) is the search string the caller ALREADY filtered
 * `cards` by. This renderer does not filter — it only needs the text so an empty
 * result can say "nothing matches X" instead of "you have no work".
 */
/**
 * The search box itself — ONE control, built the same way for the side panel, the
 * popped-out window and the toolbar popup, for the same reason renderTasks is
 * shared (Rob, 2026-08-12: "It should basically be the same packet of information…
 * whether it's on the side panel, the main, or what pops up when you first open
 * it"). A second, hand-rolled input in popup.html is how the three surfaces start
 * disagreeing about what "search" means.
 *
 * ⛔ IT MOUNTS OUTSIDE THE LIST HOST, and that is load-bearing rather than
 * stylistic. renderTasks() begins with `host.textContent = ''`, and this panel
 * re-renders on every chrome.storage timer change — an input living inside that
 * host would be destroyed mid-keystroke, taking focus and the caret with it. The
 * caller keeps the query in ITS state and re-renders only the list.
 *
 * Escape clears, because a filtered list that hides a client's urgent work is a
 * state someone must be able to leave without aiming at a 12px native ✕.
 *
 * 0.11.3 — the session picker's typed-label field is this same control. It is
 * named by a visible <label>, so it passes `ariaLabel: null` (an aria-label would
 * override the label), and it has no placeholder copy, so it passes
 * `placeholder: ''`. Left out, both keep the task search's own strings, so every
 * earlier caller is unchanged.
 */
export function buildSearchBox(doc, { value = '', onChange, placeholder, ariaLabel } = {}) {
  const wrap = el('div', 'mm-search');
  const input = doc.createElement('input');
  input.type = 'search';
  input.className = 'mm-search-input';
  input.value = value;
  input.placeholder = placeholder == null ? 'Search clients and tasks' : String(placeholder);
  const name = ariaLabel === undefined ? 'Search your clients and tasks' : ariaLabel;
  if (name) input.setAttribute('aria-label', name);
  input.autocomplete = 'off';
  input.spellcheck = false;
  const fire = () => { if (typeof onChange === 'function') onChange(input.value); };
  input.addEventListener('input', fire);
  input.addEventListener('search', fire); // native ✕ in Chrome fires this, not `input`
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      e.stopPropagation();
      input.value = '';
      fire();
    }
  });
  wrap.appendChild(input);
  return { wrap, input };
}

/**
 * The head line above the list. Filtering must be VISIBLE in the count — a person
 * looking at 2 cards needs to know whether that is their whole queue or the 2 that
 * matched, or the box has quietly hidden a client with overdue work.
 */
export function tasksCountText(shown, all, query) {
  const total = shown.reduce((n, c) => n + (c.openCount ?? c.items.length), 0);
  const q = (query || '').trim();
  if (q) {
    return shown.length
      ? `${total} task${total === 1 ? '' : 's'} · ${shown.length} of ${all.length} client${all.length === 1 ? '' : 's'} match “${q}”`
      : `No match for “${q}” · ${all.length} client${all.length === 1 ? '' : 's'} in your list`;
  }
  return shown.length
    ? `${total} task${total === 1 ? '' : 's'} across ${shown.length} client${shown.length === 1 ? '' : 's'}`
    : 'Your tasks';
}

/**
 * Rob's one-line card summary (2026-08-14): "It doesn't need to be such a wide block
 * for each client... a more narrow one for each client, pretty much with one line,
 * maybe two, just covering: total number of open items, if there's a new message from
 * the client, estimated hours of work remaining before next due date." His phrasing
 * for the last part: "You probably have this many hours of work to do on this client
 * by the due date."
 *
 * ⛔ EVERY FIGURE HERE ALREADY EXISTS ON THE CARD — nothing new is fetched or derived.
 * `openCount` is the server packet's reconciled count when it sent one, `new_count`
 * comes from the per-(person, client) seen watermark, and `est_hours` / `due` are the
 * group's summed estimate and earliest date from groupByClient(). Re-deriving any of
 * them here would be a second answer to a question the server already answered.
 *
 * ⛔ THE HOURS FIGURE IS A FLOOR, NOT A TOTAL, and it must not be dressed up as one.
 * `est_hours` sums only the items that HAVE an estimate; client-raised tickets carry
 * none, because project_tickets has no hours column. So a client with 30 tickets and
 * one estimated block reads "~2h" while genuinely holding far more. The "+" suffix is
 * doing real work — it is the difference between an honest floor and a false promise.
 */
export function cardSummaryLine(card) {
  if (!card) return '';
  const bits = [];

  // ⛔ THE OPEN COUNT IS DELIBERATELY NOT REPEATED HERE. It already has a home in the
  // header chip on the line above, and duplicating it was not free: the summary is a
  // single ellipsised line sharing its row with the buttons, so "2 open · " was
  // pushing the DUE DATE off the end. Of the two, the date is the one someone
  // triaging cannot reconstruct from anywhere else on the card.
  // "if there's a new message from the client" — the watermark's answer, not a guess.
  const isNew = Number(card.view?.new_count);
  if (Number.isFinite(isNew) && isNew > 0) {
    bits.push(isNew === 1 ? '1 new' : `${isNew} new`);
  }

  if (card.est_hours) {
    // Any unestimated item ahead means this understates. Say so with a "+".
    const partial = card.items.some((m) => m.est_hours == null);
    bits.push(`~${card.est_hours}h${partial ? '+' : ''}`);
  }

  // The date that put this card in its band, so the headline never contradicts it —
  // the same rule the long meta line already followed.
  const dateFor = card.state === 'reply_24h' && card.replyDue ? card.replyDue : card.due;
  const due = fmtDueShort(dateFor);
  if (due) bits.push(card.state === 'reply_24h' ? `due ${due}` : `by ${due}`);

  return bits.join(' · ');
}

/**
 * M7 — the pinned "what is next" line. ONE renderer, mounted by the toolbar popup,
 * the side panel and the pop-out, so the three surfaces cannot name a different
 * next client.
 *
 * ⛔ IT READS THE SAME ITEM THE LIST ALREADY MARKS, and it does not re-rank. The
 * item is `data.next`, falling back to `items[0]` — byte-for-byte the pick
 * nextFingerprintOf() makes for the "▶ NEXT UP" tag on the card. The two were
 * allowed to answer separately once before (the popup's old bespoke "Next up" chip
 * called a row "Next up" while the panel called the same row "Overdue"); this
 * function exists so that cannot recur.
 *
 * ⛔ IT IS ALWAYS RENDERED — that is the defect it closes. "There is no
 * always-visible what-is-next" is not fixed by a line that disappears whenever the
 * feed is empty or broken, so an empty feed and a failed fetch each get their own
 * sentence instead of an absence the member has to interpret.
 *
 * ⛔ NOT ON THE TOOLBAR BADGE. A count there would be blank for the people this
 * targets (it only paints after a successful fetch) or up to four hours stale, and
 * it would dull the "!" and "?" warnings the badge already carries.
 */
export function renderNextUpLine(host, feed, now = Date.now()) {
  if (!host) return;
  const doc = host.ownerDocument || document;
  host.textContent = '';
  host.classList.remove('hidden');

  const data = feed && feed.data;
  const item = (data && (data.next || (Array.isArray(data.items) ? data.items[0] : null))) || null;

  const label = el('span', 'mm-nextup-label');
  // OPUS_COPY — the fixed lead-in on the pinned next-up line, on all three
  // surfaces. Must convey: this is the one thing to pick up next. One word or two,
  // followed by the client name and urgency this function supplies. Must NOT imply
  // it is assigned, claimed, or started.
  label.textContent = 'Next up:';
  host.appendChild(label);

  if (!data) {
    host.classList.add('is-bad');
    host.classList.remove('is-empty');
    // OPUS_COPY — the pinned next-up line when the feed could NOT be fetched. Must
    // convey: we cannot say what is next right now because the feed did not load —
    // not that there is nothing to do. Must NOT read as "you are all caught up".
    host.appendChild(el('span', 'mm-nextup-value', 'not known right now, because your task feed did not load.'));
    return;
  }
  if (!item) {
    host.classList.add('is-empty');
    host.classList.remove('is-bad');
    // OPUS_COPY — the pinned next-up line when the feed loaded and is genuinely
    // empty. Must convey: nothing is ranked for you right now. Must NOT claim all
    // work is finished, and must NOT suggest something is broken.
    host.appendChild(el('span', 'mm-nextup-value', 'nothing is ranked for you right now.'));
    return;
  }

  host.classList.remove('is-bad', 'is-empty');
  // Third-party strings — textContent only, exactly like every other client name
  // on this surface.
  host.appendChild(el('span', 'mm-nextup-client', item.project || item.title || ''));
  host.appendChild(el('span', 'mm-nextup-sep', ' — '));
  host.appendChild(el('span', 'mm-nextup-urgency', urgencyPhrase(item, now)));
}

/**
 * M5 — the pinned, UNDISMISSABLE "you still owe QA" card.
 *
 * ⛔ WHAT THIS REPLACES, AND WHY IT IS A CARD RATHER THAN A VIEW. In the popup an
 * outstanding QA flag made init() render the QA prompt and RETURN — the whole task
 * list vanished, and the prompt never said which block it was waiting on. A member
 * with a stale flag therefore lost every other surface in the extension to a
 * question they could not identify. The requirement is real and stays enforced;
 * what changes is that it is now stated ABOVE the list instead of instead of it.
 *
 * ⛔ IT NAMES THE BLOCK AND THE DATE. That was the other half of the defect: "QA is
 * still needed" with no subject is unactionable when the block was three days and
 * four clients ago.
 *
 * ⛔ NO DISMISS CONTROL, DELIBERATELY. It is driven straight from storage on every
 * render, like the panel's standing QA line — a standing obligation, not a receipt
 * for a click. The only thing that removes an entry is that block's own QA being
 * finished (resolvePendingQa), or the age cap in common.js.
 *
 * @param {Element}  host
 * @param {Array}    pending  getPendingQaAll() — oldest first
 * @param {object}   handlers { onResume(entry) } — opens the real QA prompt
 */
export function renderQaOwedCard(host, pending, handlers = {}) {
  if (!host) return;
  const doc = host.ownerDocument || document;
  const items = Array.isArray(pending) ? pending : [];
  host.textContent = '';
  host.classList.toggle('hidden', items.length === 0);
  if (!items.length) return;

  const head = el('div', 'mm-qa-card-head');
  // OPUS_COPY — the heading of the pinned QA card in the popup, above the task
  // list. Must convey: delivery QA is still owed on the block(s) listed below, and
  // the member has to finish it. Must NOT say their time was not saved (it was),
  // must NOT threaten, and must NOT imply the extension is blocked.
  head.textContent = 'Delivery QA is still needed on each block below. Your time is already saved.';
  host.appendChild(head);

  const list = doc.createElement('ul');
  list.className = 'mm-qa-card-list';
  for (const p of items) {
    const li = doc.createElement('li');
    // The BLOCK, by name, and the day it was stopped — the two facts the old
    // prompt withheld. Both are third-party/derived strings: textContent only.
    li.appendChild(el('span', 'mm-qa-card-block', p.blockTitle || String(p.blockId)));
    const when = fmtStoppedOn(p.savedAtIso);
    if (when) li.appendChild(el('span', 'mm-qa-card-when', ` · ${when}`));
    const go = doc.createElement('button');
    go.type = 'button';
    go.className = 'mm-btn mm-qa-card-go';
    // OPUS_COPY — the per-block button on the pinned QA card. Must convey: open
    // the QA step for THIS block now. Two or three words. Must NOT read as
    // "dismiss" or "mark done".
    go.textContent = 'Open QA';
    go.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (handlers.onResume) handlers.onResume(p);
    });
    li.appendChild(go);
    list.appendChild(li);
  }
  host.appendChild(list);
}

/** "stopped on <date>" for the pinned QA card. Locale short date, never a raw ISO. */
export function fmtStoppedOn(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return new Date(t).toISOString().slice(0, 10);
  }
}

export function renderTasks(host, cards, handlers = {}) {
  if (!host) return;
  host.textContent = '';
  const note = feedStatusNote(handlers.feed);

  if (!cards.length) {
    if (note) {
      // ⛔ NOT the reassuring empty card. Nothing here is known to be empty — the
      // fetch failed, so the only honest statement is that we do not know.
      const box = el('div', 'mm-empty mm-feed-failed');
      box.setAttribute('role', 'status');
      box.appendChild(el('strong', null, 'Your task list did not load. '));
      box.appendChild(document.createTextNode(note));
      host.appendChild(box);
      return;
    }
    // ⛔ A SEARCH THAT FOUND NOTHING IS NOT AN EMPTY QUEUE, and saying "nothing
    // open for you" over a filtered list would be the surface telling someone
    // their client has no work when it simply is not in this feed. Name the
    // query, and name the reason it can legitimately miss — the ranker only
    // reaches clients you hold a calendar block or logged time on, so a client
    // whose only tie to you is an assigned ticket is genuinely absent, not
    // mistyped. See taskfeed.js filterCards().
    const q = (handlers.query || '').trim();
    if (q) {
      const box = el('div', 'mm-empty mm-empty-search');
      box.setAttribute('role', 'status');
      box.appendChild(el('strong', null, `No client here matches “${q}”. `));
      box.appendChild(document.createTextNode(
        'This box searches the tasks the server sent you — a client you only hold open tickets for is not in that list yet.',
      ));
      host.appendChild(box);
      return;
    }
    host.appendChild(
      el('div', 'mm-empty', 'Nothing open for you right now. When work lands you will see it here, one card per client.'),
    );
    return;
  }

  // A list IS being shown, but it is the warm cache and the refresh behind it
  // failed. Show it — hiding work someone still owes a client would be the other
  // dishonest fix — and label it, above the bands rather than under them.
  if (note) {
    const stale = el('div', 'mm-stale', note);
    stale.setAttribute('role', 'status');
    host.appendChild(stale);
  }

  for (const band of BANDS) {
    const inBand = cards.filter((c) => c.state === band.key);
    if (!inBand.length) continue;
    const sec = el('section', 'mm-band');
    sec.dataset.band = band.key;
    const h = el('h2', 'mm-band-head');
    h.appendChild(el('span', null, band.title));
    h.appendChild(el('span', 'mm-band-sub', band.sub));
    sec.appendChild(h);
    const list = el('div', 'mm-band-list');
    for (const c of inBand) list.appendChild(buildCard(c, handlers));
    sec.appendChild(list);
    host.appendChild(sec);
  }
}

function buildCard(card, handlers) {
  const art = el('article', 'mm-card');
  art.dataset.state = card.state;
  art.dataset.key = card.key;
  art.tabIndex = 0;

  const top = el('div', 'mm-card-top');
  const name = el('span', 'mm-client', card.label);
  name.title = card.isUnassigned
    ? `${card.label} — internal / no project link. The copied chip groups it under the server's own key "${card.client}".`
    : card.label;
  top.appendChild(name);
  top.appendChild(el('span', 'mm-count', `${card.openCount ?? card.items.length} open`));
  art.appendChild(top);

  // ── the COLLAPSED rendering ───────────────────────────────────────────────
  // The server's own words when it sent them, so the card, the Discord post and
  // the day-sheet DM say ONE thing about this client. The date/estimate line the
  // panel used to assemble here stays as the fallback for a server that sends no
  // packet — which is every deployment before 2026-08-12.
  // ── the COMPACT summary (v0.8.9) ──────────────────────────────────────────
  // Rob, 2026-08-14: "It doesn't need to be such a wide block for each client...
  // a more narrow one for each client, pretty much with one line, maybe two."
  //
  // ⛔ THE SERVER PACKET IS NOT DELETED — it moves into the expanded region below.
  // It was the single biggest consumer of vertical space (a multi-line markdown
  // block per card, so four or five clients filled the panel), and it is detail
  // rather than triage: what a person scanning the list needs is which client, how
  // much, and by when. Everything the packet said is one click away and still comes
  // from the server's own words, so the card, the Discord post and the day-sheet DM
  // continue to agree.
  // ⛔ THE SUMMARY AND THE ACTIONS SHARE ONE ROW. Giving the buttons their own row
  // cost ~34px on EVERY card — more than the summary and the title together — for a
  // control that is two words wide. Inlining them is most of the density win, and it
  // keeps Start one click away rather than hiding it behind the expansion, which
  // would have made the commonest action the slowest one.
  const summaryRow = el('div', 'mm-summary-row');
  summaryRow.appendChild(el('div', 'mm-summary', cardSummaryLine(card)));
  art.appendChild(summaryRow);


  // Say the quiet part out loud rather than letting the copied chip contradict
  // the card. The label here is Rob's ("internal work uses massmarket.ai"); the
  // chip has to keep the server's own group key or the claim it contains would
  // never match the row OW minted. See UNASSIGNED_DISPLAY in taskfeed.js.
  if (card.isUnassigned) {
    art.appendChild(
      el('div', 'mm-meta', 'No project link in OW — the copied chip groups these under "Unassigned".'),
    );
  }

  const tags = el('div', 'mm-tags');
  // FIRST, so "this client holds your #1" reads before the band's own signals.
  const nextFp = handlers.nextFingerprint;
  if (nextFp && card.items.some((m) => m.fingerprint === nextFp)) {
    tags.appendChild(el('span', 'mm-tag next', '▶ NEXT UP'));
  }
  // Both signals, always. A card sits in ONE band, so a client that has an item
  // inside the 24h window AND overdue items must still carry the overdue count
  // here — otherwise the overdue work becomes invisible the moment something
  // more urgent lands for the same client.
  if (card.reply24Count) {
    tags.appendChild(el('span', 'mm-tag red', card.reply24Count === 1 ? 'DUE < 24H' : `DUE < 24H (${card.reply24Count})`));
  }
  if (card.overdueCount) {
    tags.appendChild(el('span', 'mm-tag amber', card.overdueCount === 1 ? 'OVERDUE' : `OVERDUE (${card.overdueCount})`));
  }
  if (card.etaNeeded) {
    tags.appendChild(
      el('span', 'mm-tag eta', card.etaNeeded === card.items.length ? 'ETA NEEDED' : `ETA NEEDED (${card.etaNeeded})`),
    );
  }
  // ⛔ LAST, and deliberately NOT coloured. It is not an alarm — it is the answer
  // to "why is this client on my list?" for a client the member has never had a
  // calendar block on. See card.ticketOnly in taskfeed.js.
  if (card.ticketOnly) tags.appendChild(el('span', 'mm-tag', 'TICKETS'));
  if (tags.childNodes.length) art.appendChild(tags);

  // ── the EXPANDED rendering (§4.2). Always built, shown on hover/focus.
  //
  // ⛔ ALWAYS IN THE DOM, never built lazily — hover/focus only changes whether it
  // is DISPLAYED. Truncation is a rendering concern and never a data one; building
  // this on demand would make the accessibility text lie about what the card holds.
  const detail = el('div', 'mm-detail');

  // ⛔ THE COLLAPSED PACKET MOVED HERE (v0.8.9), it was not dropped. It is the
  // server's own words about this client, and it still leads the expansion so the
  // card, the Discord post and the day-sheet DM keep saying one thing. It simply is
  // not what someone scanning twenty clients needs on screen at once.
  const collapsed = humanView(card, 'collapsed');
  if (collapsed) {
    const lede = el('div', 'mm-packet mm-packet-collapsed');
    // The header line already carries the client name (emitted exactly once — that
    // is assertable server-side), and our own header sits right above, so drop the
    // packet's first line rather than printing the label twice.
    const body = collapsed.split('\n').slice(1).join('\n').replace(/^\n+/, '');
    lede.appendChild(renderMarkdownish(body || collapsed, art.ownerDocument || document));
    detail.appendChild(lede);
  }

  const expanded = humanView(card, 'expanded');
  if (expanded) {
    const box = el('div', 'mm-packet mm-packet-expanded');
    box.appendChild(renderMarkdownish(expanded, art.ownerDocument || document));
    detail.appendChild(box);
  } else {
    detail.appendChild(
      el('div', 'mm-item-meta', `Everything you owe ${card.label} — all ${card.items.length}:`),
    );
    const ol = document.createElement('ol');
    for (const m of card.items) ol.appendChild(itemLine(m, handlers.nextFingerprint));
    detail.appendChild(ol);
  }
  art.appendChild(detail);

  // ── EDIT 4b — the button reads `card.startable`, not `card.startableBlock` ──
  //
  // Three cases, and all three are live on prod right now: 'block' (17 groups),
  // 'project' (6), and null (1 — the members disagree about their project id, so
  // the server refuses to guess). Only the third gets no timer.
  const actions = el('div', 'mm-card-actions');
  const target = card.startable || null;
  const startable = !!target;
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'mm-btn primary mm-start';
  if (target) startBtn.dataset.startKind = target.kind;
  startBtn.textContent = startable ? 'Start' : 'Copy chip';
  startBtn.title = !startable
    ? 'There is nothing here a clock can attach to — no schedulable block, and no single project this work provably belongs to. This copies the whole chip.'
    : target.kind === 'project'
      // Rob, 2026-08-12: "Anytime we're working on a client, we should be able to
      // start and clock the work for them." Crucial Hire is 46 open tickets and a
      // phase with no schedulable block — before this it offered "Copy chip" alone
      // and had 0 hours logged, ever.
      ? 'Start the clock on this CLIENT — there is no scheduled block, so the time is logged against the project — and copy the whole chip to your clipboard.'
      : 'Start the timer on this client’s next block and copy the whole chip to your clipboard.';
  startBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (handlers.onStart) handlers.onStart(card, startBtn, art);
  });
  actions.appendChild(startBtn);

  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'mm-btn mm-pin';
  pin.textContent = 'Details';
  pin.setAttribute('aria-expanded', 'false');
  pin.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const on = art.classList.toggle('mm-pinned');
    pin.setAttribute('aria-expanded', String(on));
  });
  actions.appendChild(pin);

  // ── M2 — THE STANDALONE COPY CONTROL ──────────────────────────────────────
  //
  // Until now the ONLY way to get the chip onto the clipboard was to press Start,
  // which also clocks you in. There was no copy control anywhere on any surface —
  // so "I want the prompt but I am not starting the clock right now" had no button,
  // and a member who wanted the chip a second time had to start a timer to get it.
  //
  // ⛔ It is ALWAYS rendered, including on the one card with no `startable` (where
  // the primary button already reads "Copy chip"). Two controls that both copy is
  // the correct outcome there: the primary says what that card can do, this one is
  // the control that is in the same place on every card.
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'mm-btn mm-copy';
  // OPUS_COPY — the button label in the card action row, on all three surfaces.
  // Must convey: put this client's whole chip on the clipboard, WITHOUT starting a
  // timer. Two or three words; it sits beside "Start" and "Details" in a 320px
  // popup. Must NOT imply it claims, starts, or completes anything.
  copyBtn.textContent = 'Copy chip';
  copyBtn.title = 'Copies the whole chip for this client to your clipboard. No timer starts or stops.';
  copyBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (handlers.onCopy) handlers.onCopy(card, copyBtn, art);
  });
  actions.appendChild(copyBtn);

  // ── M6 — CLOSE OUT ────────────────────────────────────────────────────────
  //
  // A churned client's task keeps being served and there is no way to end it from
  // here. This calls the EXISTING POST /api/ext/block-complete-note — the same
  // route the stop-flow's "No QA required" already uses — which marks the block
  // `completed`, stamps qa_posted_at/qa_attested_by, and records the note in
  // `time_worklogs` (source='no_qa_note') so the closure is auditable.
  //
  // ⛔ IT IS NOT A CLAIM, AND THERE IS STILL NO CLAIM BUTTON. See cardstart.js:85 —
  // the chip IS the claim mechanism. A claim fired from a card would acknowledge
  // every item in the group's ack ladder and silence the unattended-work alarm.
  // This route touches one block and writes a note; it acknowledges nothing.
  //
  // ⛔ IT NEEDS A BLOCK, so it is rendered only for a `startable.kind === 'block'`
  // card. The route's body is `{ block_id, note }` and block_id is REQUIRED — a
  // project-kind card (6 of 24 groups on prod) has no block to close, and a button
  // that 400s is worse than one that is not there. Closing out a client that has
  // no schedulable block needs a server route that does not exist yet.
  // ⛔ AND ONLY A BLOCK WITH TIME ON IT (2026-09-14, lane L4b). `target.timed` is
  // taskfeed.js blockWasTimed(): the server's recorded time on this block. A block
  // nobody ever clocked into is not something a member closes out from here — see
  // that function for why the route's own check does not cover it. cardclose.js
  // refuses it again at the press.
  if (handlers.onCloseOut && target && target.kind === 'block' && target.timed === true) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mm-btn mm-closeout';
    // OPUS_COPY — the button label in the card action row. Must convey: mark this
    // client's block finished and take it off the feed, with a short note saying
    // what happened. Two or three words. Must NOT read as "delete", must NOT imply
    // a QA video was recorded, and must NOT suggest it closes the whole client.
    closeBtn.textContent = 'Close out';
    closeBtn.title = 'Marks this block done with a short note saying what happened, and takes it off your feed. No QA video is needed, and only this block closes, not the client.';
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openCloseOutForm(art, card, target, handlers);
    });
    actions.appendChild(closeBtn);
  }

  summaryRow.appendChild(actions);

  art.appendChild(el('p', 'mm-card-err hidden'));

  // ── CLICK THE CARD TO EXPAND (v0.8.5) ───────────────────────────────────────
  //
  // Rob, 2026-08-13: "the client cards should expand when clicked, but not if they
  // click the start — if they click the card itself. Right now the hover makes it
  // hard to scroll without having to expand every card you're scrolling over."
  //
  // ⛔ The three exclusions below are the whole point; without them this reopens
  // the bug it fixes:
  //  1. BUTTONS/LINKS — Start and Details already call stopPropagation(), but a
  //     future control that forgets to would silently start toggling the card. The
  //     closest() check makes that structural instead of per-handler.
  //  2. TEXT SELECTION — the expanded panel is 34 lines of copyable detail. Without
  //     this, finishing a drag-select collapses the thing you were selecting from.
  //  3. KEYBOARD — the card already carries tabIndex=0 (set above), so it is a real
  //     tab stop. Removing :focus-within would otherwise have left keyboard users
  //     with no way to open it from the card itself, so Enter/Space toggle too.
  const toggleDetail = () => {
    const on = art.classList.toggle('mm-pinned');
    art.setAttribute('aria-expanded', String(on));
    const p = art.querySelector('.mm-pin');
    if (p) p.setAttribute('aria-expanded', String(on));
    return on;
  };
  art.setAttribute('aria-expanded', 'false');
  art.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a, input, textarea, select, [role="button"]')) return;
    const sel = (art.ownerDocument || document).defaultView.getSelection();
    if (sel && String(sel).length > 0) return;
    toggleDetail();
  });
  art.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    if (ev.target !== art) return;              // let Start/Details handle their own keys
    ev.preventDefault();                        // Space must not scroll the panel
    toggleDetail();
  });

  return art;
}

/**
 * M6 — the close-out note form, opened inline on the card.
 *
 * ⛔ THE NOTE IS REQUIRED AND IT IS REQUIRED HERE, not only on the server. The
 * route rejects anything under 4 characters, and a member who types nothing should
 * find that out from the field in front of them rather than from an HTTP 400.
 * MIN_CLOSEOUT_NOTE mirrors the route's MIN_NOTE_LEN exactly (block-complete-note
 * route.ts: `const MIN_NOTE_LEN = 4`).
 *
 * ⛔ Built once per card and reused. Rebuilding it on each press would drop
 * whatever had been typed, and this is the one control on the card that holds
 * text the member wrote.
 */
export const MIN_CLOSEOUT_NOTE = 4;

export function openCloseOutForm(art, card, target, handlers) {
  const doc = art.ownerDocument || document;
  let form = art.querySelector('.mm-closeout-form');
  if (form) {
    form.classList.remove('hidden');
    const existing = form.querySelector('.mm-closeout-note');
    if (existing) existing.focus();
    return form;
  }
  form = el('div', 'mm-closeout-form');
  const note = doc.createElement('textarea');
  note.className = 'mm-closeout-note';
  note.rows = 2;
  // OPUS_COPY — placeholder text inside the close-out note field. Must convey:
  // say in one line what actually happened to this work (e.g. the client left,
  // it was handled elsewhere, it is no longer needed). Must NOT promise the note
  // is private, and must NOT suggest a long write-up is wanted.
  note.placeholder = 'In one line, what happened to this work? For example: the client left, or it was handled elsewhere.';
  form.appendChild(note);

  const row = el('div', 'mm-closeout-row');
  const submit = doc.createElement('button');
  submit.type = 'button';
  submit.className = 'mm-btn primary mm-closeout-send';
  // OPUS_COPY — the confirm button inside the close-out form. Must convey:
  // record this note and close the block. Must NOT say "submit QA" — this path
  // explicitly is not a QA.
  submit.textContent = 'Save note and close';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mm-btn mm-closeout-cancel';
  // OPUS_COPY — the cancel button inside the close-out form. One word.
  cancel.textContent = 'Cancel';
  row.appendChild(submit);
  row.appendChild(cancel);
  form.appendChild(row);

  const err = el('p', 'mm-closeout-err hidden');
  form.appendChild(err);

  const fail = (msg) => {
    err.textContent = msg || '';
    err.classList.toggle('hidden', !msg);
    submit.disabled = false;
  };

  cancel.addEventListener('click', (ev) => {
    ev.stopPropagation();
    form.classList.add('hidden');
    fail('');
  });
  submit.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const text = String(note.value || '').trim();
    if (text.length < MIN_CLOSEOUT_NOTE) {
      // OPUS_COPY — validation line under the close-out note field when the note
      // is too short. Must convey: a few words are needed before this can close.
      // Must NOT state a character count as a rule the member has to count to.
      fail('Add a few words about what happened before you close this.');
      note.focus();
      return;
    }
    fail('');
    submit.disabled = true;
    await handlers.onCloseOut(card, target, text, { art, form, fail });
  });

  art.appendChild(form);
  note.focus();
  return form;
}

export function cardError(art, msg) {
  const p = art && art.querySelector('.mm-card-err');
  if (!p) return;
  p.textContent = msg || '';
  p.classList.toggle('hidden', !msg);
}

// ───────────────────────────────────────────────────────────── clipboard/toast

/**
 * Clipboard write inside a click handler. Denied writes NEVER fail silently —
 * the caller shows the text in a selectable field instead (spec §6).
 * Returns 'clipboard' | 'exec' | null.
 */
export async function copyText(text, doc) {
  const d = doc || document;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return 'clipboard';
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = d.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    d.body.appendChild(ta);
    ta.select();
    const ok = d.execCommand('copy');
    ta.remove();
    return ok ? 'exec' : null;
  } catch (e) {
    return null;
  }
}

/** Show the copied text in a selectable field when the clipboard is denied. */
export function showCopyFallback(art, text) {
  if (!art) return;
  let ta = art.querySelector('.mm-copy-fallback');
  if (!ta) {
    ta = (art.ownerDocument || document).createElement('textarea');
    ta.className = 'mm-copy-fallback';
    ta.readOnly = true;
    art.appendChild(ta);
  }
  ta.value = text;
  ta.focus();
  ta.select();
}

let toastTimer = null;
export function showToast(doc, text) {
  const d = doc || document;
  let t = d.querySelector('.mm-toast');
  if (!t) {
    t = d.createElement('div');
    t.className = 'mm-toast';
    t.setAttribute('role', 'status');
    d.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}


// ═══════════════════════════════════════════════════════════════════════════════
// YOUR HOURS — one renderer, three surfaces (v0.11.2; moved here 2026-09-14)
// ═══════════════════════════════════════════════════════════════════════════════
//
// EXT #12 built this popup-only, as static markup in popup.html driven by ~450 lines
// of popup.js. The side panel is where the team actually lives, and a member who
// notices a wrong number there had no way in. So it is built here, from createElement
// + textContent like the rest of this file, and mounted by popup.js and panelapp.js.

// Projects are named after the contact, so "Goldberg Centre — Yehuda Goldberg" with
// client "Goldberg Centre" rendered the client TWICE. Moved from popup.js so the
// New-task picker and the hours picker share ONE label and ONE search: a member who
// can find "Cool Calc" by typing "Kool Kalk" in one form and not the other will
// conclude the client is missing.
function normalizeForSearch(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
    .replace(/ph/g, 'f').replace(/ck/g, 'c').replace(/k/g, 'c').replace(/z/g, 's');
}

export function projectLabel(p) {
  const name = String(p.name || '').trim();
  const client = String(p.client_name || '').trim();
  if (!client) return name;
  if (normalizeForSearch(name).includes(normalizeForSearch(client))) return name;
  return name + ' — ' + client;
}

// ⛔ TOKEN-AND, not one contiguous substring — "life operating" must find "Life's
// Operating System", and "Kool Kalk" must still find "William Fiore — Cool Calc".
export function filterProjects(list, query) {
  const tokens = String(query || '').split(/\s+/).map(normalizeForSearch).filter(Boolean);
  if (!tokens.length) return list;
  return list.filter((p) => {
    const hay = normalizeForSearch((p.name || '') + ' ' + (p.client_name || ''));
    return tokens.every((t) => hay.includes(t));
  });
}

async function defaultLoadProjects() {
  const data = await apiFetch('/api/ext/my-projects');
  return Array.isArray(data && data.projects) ? data.projects : [];
}

/**
 * Mount the hours view into `host`.
 *
 * @param {Document} doc
 * @param {Element}  host
 * @param {object}   [deps]
 * @param {Function} [deps.request]      common.js apiRequest (injectable for probes)
 * @param {Function} [deps.loadProjects] async () => projects[]
 * @param {Function} [deps.onBack]       draws the "← Back" button when given
 * @param {Function} [deps.now]          () => ms
 * @returns {{ el, back, open(), refresh(), openForm(date?), destroy() }}
 */
export function mountHoursPanel(doc, host, deps = {}) {
  const request = deps.request || apiRequest;
  const loadProjects = deps.loadProjects || defaultLoadProjects;
  const now = deps.now || (() => Date.now());
  const mkEl = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const scrollTo = (node, block = 'nearest') => {
    try { node.scrollIntoView({ block, behavior: 'smooth' }); } catch (e) { /* never blocks logging time */ }
  };
  let uid = 0;
  const field = (labelText, input) => {
    const id = `mm-hours-f${++uid}-${Math.random().toString(36).slice(2, 7)}`;
    input.id = id;
    const lab = mkEl('label', 'mm-hours-lab', labelText);
    lab.htmlFor = id;
    return lab;
  };

  host.textContent = '';
  const root = mkEl('div', 'mm-hours');
  root.dataset.hours = 'root';

  // ── head ─────────────────────────────────────────────────────────────────
  // ⛔ 0.11.3 (Rob, 2026-09-28: "I can open ◷ My hours, but I don't see a way to
  // get back to the main screen"). The control existed and was unfindable: bare
  // link-text 13px "← Back", at the top of a view that both surfaces mount BELOW
  // the setup cards and the pinned lines — under 0.11.2's forced-open work-folder
  // card (~900px) that put it well below a 600px popup's fold — while the header
  // button that opened the view went dead (disabled on the panel, a no-op on the
  // popup). It is now a real button (.mm-btn), pinned to the top of the view as it
  // scrolls, brought into view when the view opens, and named for a screen reader.
  // Escape and a second press of the header button also leave; both are wired by
  // the surfaces, which own the header and the key handling.
  let back = null;
  if (typeof deps.onBack === 'function') {
    back = mkEl('button', 'mm-btn mm-hours-back', `← ${HOURS_COPY.back}`);
    back.type = 'button';
    back.dataset.hours = 'back';
    back.setAttribute('aria-label', HOURS_COPY.backLabel);
    back.addEventListener('click', () => deps.onBack());
    root.appendChild(back);
  }
  // Bring the back control on screen when the view opens, if it is not already —
  // only then, so a view that opens in full sight does not jump.
  const revealBack = () => {
    if (!back) return;
    try {
      const r = back.getBoundingClientRect();
      const vh = (doc.defaultView && doc.defaultView.innerHeight) || 0;
      if (r.top < 0 || (vh && r.bottom > vh)) back.scrollIntoView({ block: 'start' });
    } catch (e) { /* never blocks the view */ }
  };
  root.appendChild(mkEl('div', 'mm-hours-title', HOURS_COPY.title));
  root.appendChild(mkEl('p', 'mm-hours-intro', HOURS_COPY.intro));

  const controls = mkEl('div', 'mm-hours-controls');
  const windowSel = mkEl('select', 'mm-hours-input');
  windowSel.setAttribute('aria-label', HOURS_COPY.windowLabel);
  windowSel.dataset.hours = 'window';
  for (const opt of HOURS_COPY.windowOptions) {
    const o = mkEl('option', null, opt.label);
    o.value = String(opt.days);
    windowSel.appendChild(o);
  }
  const refreshBtn = mkEl('button', 'mm-btn mm-hours-refresh', '↻');
  refreshBtn.type = 'button';
  refreshBtn.title = HOURS_COPY.refreshTitle;
  controls.appendChild(windowSel);
  controls.appendChild(refreshBtn);
  root.appendChild(controls);

  const loadErr = mkEl('p', 'mm-hours-err hidden');
  const loading = mkEl('div', 'mm-hours-loading hidden', HOURS_COPY.loading);
  // ⛔ THE PROMPT, above the ledger: days another feed recorded work on and no timer ran.
  const untracked = mkEl('div', 'mm-hours-untracked hidden');
  untracked.dataset.hours = 'untracked';
  const body = mkEl('div', 'mm-hours-body hidden');
  body.dataset.hours = 'ledger';
  root.appendChild(loadErr);
  root.appendChild(loading);
  root.appendChild(untracked);
  root.appendChild(body);

  // ── the form ─────────────────────────────────────────────────────────────
  const addToggle = mkEl('button', 'mm-btn mm-hours-add', HOURS_COPY.formTitle);
  addToggle.type = 'button';
  addToggle.dataset.hours = 'add';
  root.appendChild(addToggle);

  const form = mkEl('div', 'mm-hours-form hidden');
  form.dataset.hours = 'form';
  form.appendChild(mkEl('p', 'mm-hours-intro', HOURS_COPY.formIntro));
  // A refusal the member can ACT on — both 409s live here. ⛔ D3: it is placed
  // BESIDE THE SUBMIT BUTTON (appended just above the button row, below), not at the
  // top of the form, where a 320px popup put it a screen away from the press.
  const refusal = mkEl('div', 'mm-hours-refusal hidden');
  refusal.setAttribute('role', 'alert');
  refusal.dataset.hours = 'refusal';

  // ⛔ D3 — ONE searchable client picker. It was a search box AND a <select> under
  // it, two controls for one choice, and the select's first option read as the
  // answer. Now one text field filters the list as the member types and a pick
  // fills it; the chosen id lives in a hidden input so the rest of the form (and
  // every probe) still reads `[data-hours="project"]`.
  const pickWrap = mkEl('div', 'mm-hours-pick');
  const projSearch = mkEl('input', 'mm-hours-input');
  projSearch.type = 'text';
  projSearch.autocomplete = 'off';
  projSearch.placeholder = HOURS_COPY.fieldProjectSearch;
  projSearch.dataset.hours = 'project-search';
  projSearch.setAttribute('role', 'combobox');
  projSearch.setAttribute('aria-autocomplete', 'list');
  projSearch.setAttribute('aria-expanded', 'false');
  form.appendChild(field(HOURS_COPY.fieldProject, projSearch));
  pickWrap.appendChild(projSearch);
  const projList = mkEl('div', 'mm-hours-picklist hidden');
  projList.setAttribute('role', 'listbox');
  projList.dataset.hours = 'project-options';
  pickWrap.appendChild(projList);
  form.appendChild(pickWrap);
  const projSel = mkEl('input', null);
  projSel.type = 'hidden';
  projSel.dataset.hours = 'project';
  form.appendChild(projSel);
  const projCount = mkEl('p', 'mm-hours-count hidden');
  form.appendChild(projCount);

  const dateIn = mkEl('input', 'mm-hours-input');
  dateIn.type = 'date';
  dateIn.dataset.hours = 'date';
  form.appendChild(field(HOURS_COPY.fieldDate, dateIn));
  form.appendChild(dateIn);

  const times = mkEl('div', 'mm-hours-times');
  const startIn = mkEl('input', 'mm-hours-input');
  startIn.type = 'time';
  startIn.dataset.hours = 'start';
  const endIn = mkEl('input', 'mm-hours-input');
  endIn.type = 'time';
  endIn.dataset.hours = 'end';
  for (const [lab, input] of [[HOURS_COPY.fieldStart, startIn], [HOURS_COPY.fieldEnd, endIn]]) {
    const cell = mkEl('div', null);
    cell.appendChild(field(lab, input));
    cell.appendChild(input);
    times.appendChild(cell);
  }
  form.appendChild(times);

  // ⛔ R4.2 — what is already recorded for the chosen day, BEFORE submit. When the
  // route cannot be read (a 404 included — the route is a hard precondition of
  // 0.11.2) this section shows a "could not be checked" warning instead, and submit
  // needs an explicit confirm for that day. The add form is new in 0.11.2 (EXT #12):
  // there is no older form to fall back to.
  const recorded = mkEl('div', 'mm-hours-recorded hidden');
  recorded.dataset.hours = 'recorded';
  form.appendChild(recorded);
  const clashNote = mkEl('p', 'mm-hours-clash hidden');
  clashNote.setAttribute('role', 'status');
  clashNote.dataset.hours = 'clash';
  form.appendChild(clashNote);

  const whatIn = mkEl('textarea', 'mm-hours-input mm-hours-what');
  whatIn.placeholder = HOURS_COPY.fieldWhatPlaceholder;
  whatIn.dataset.hours = 'what';
  form.appendChild(field(HOURS_COPY.fieldWhat, whatIn));
  form.appendChild(whatIn);

  const formErr = mkEl('p', 'mm-hours-err hidden');
  form.appendChild(formErr);
  form.appendChild(refusal);
  const row = mkEl('div', 'mm-hours-row');
  const cancelBtn = mkEl('button', 'mm-btn', HOURS_COPY.cancel);
  cancelBtn.type = 'button';
  const submitBtn = mkEl('button', 'mm-btn primary', HOURS_COPY.submit);
  submitBtn.type = 'button';
  submitBtn.dataset.hours = 'submit';
  // ⛔ D3 — Submit FIRST in the row (drawn right-to-left by .mm-hours-row), so when
  // the two buttons wrap on a 320px popup it is Submit, not Cancel, that sits
  // directly under the refusal it answers.
  row.appendChild(submitBtn);
  row.appendChild(cancelBtn);
  form.appendChild(row);
  const saved = mkEl('p', 'mm-hours-saved hidden');
  saved.setAttribute('role', 'status');
  saved.dataset.hours = 'saved';
  form.appendChild(saved);
  root.appendChild(form);
  host.appendChild(root);

  // ── state ────────────────────────────────────────────────────────────────
  let projects = [];
  let projectsLoaded = false;
  let duplicateCheckId = null;
  // { date, available, dayEntries, truncated } — the last window read, for the day
  // currently in the date field. `seq` discards a slow answer for a day since changed.
  let window_ = { date: null, available: false, dayEntries: [], truncated: false };
  let seq = 0;
  // The day the member confirmed "add it anyway" for, after its record could not be
  // read. Keyed by day, so confirming one day never waves another through.
  let uncheckedAckDate = null;

  const formValues = () => ({
    projectId: projSel.value,
    date: dateIn.value,
    start: startIn.value,
    end: endIn.value,
    description: whatIn.value,
  });

  // ── ledger ───────────────────────────────────────────────────────────────
  const head = (text) => mkEl('div', 'mm-hours-grouphead', text);
  const line = (label, amount) => {
    const r = mkEl('div', 'mm-hours-line');
    r.appendChild(mkEl('span', null, label));
    r.appendChild(mkEl('span', 'mm-hours-amt', amount));
    return r;
  };

  function renderLedger(view) {
    untracked.textContent = '';
    untracked.classList.add('hidden');
    if (view.untracked.length > 0) {
      untracked.appendChild(head(HOURS_COPY.untrackedTitle));
      untracked.appendChild(mkEl('p', 'mm-hours-why', HOURS_COPY.untrackedBody));
      for (const day of view.untracked) {
        untracked.appendChild(mkEl('div', 'mm-hours-uday', day.label));
        untracked.appendChild(mkEl('div', 'mm-hours-why', day.why));
        const cta = mkEl('button', 'mm-hours-link', HOURS_COPY.untrackedAddCta);
        cta.type = 'button';
        // ⛔ Carries the DATE and nothing else. The only number this feed has is a
        // browser-activity count that overstates by a per-member factor.
        cta.addEventListener('click', () => openForm(day.date));
        untracked.appendChild(cta);
      }
      untracked.classList.remove('hidden');
    }

    body.textContent = '';
    const sum = mkEl('div', 'mm-hours-sum');
    sum.appendChild(mkEl('div', 'mm-hours-total', view.totalText));
    sum.appendChild(mkEl('div', 'mm-hours-sub', `${HOURS_COPY.totalLabel} · ${view.windowLabel}`));
    body.appendChild(sum);
    if (view.empty) {
      body.appendChild(head(HOURS_COPY.emptyTitle));
      body.appendChild(mkEl('p', 'mm-hours-why', HOURS_COPY.emptyBody));
      body.classList.remove('hidden');
      return;
    }
    // ⛔ EVERY BUCKET, ZEROS INCLUDED — one number quoted without its siblings is the
    // 2026-09-09 incident.
    body.appendChild(head(HOURS_COPY.howLabel));
    for (const b of view.buckets) body.appendChild(line(b.label, b.hoursText));
    if (view.clients.length > 0) {
      body.appendChild(head(HOURS_COPY.clientsLabel));
      for (const c of view.clients) body.appendChild(line(c.client, c.hoursText));
    }
    if (view.days.length > 0) {
      body.appendChild(head(HOURS_COPY.daysLabel));
      for (const day of view.days) {
        const wrap = mkEl('div', 'mm-hours-day');
        const dh = mkEl('div', 'mm-hours-dayhead');
        dh.appendChild(mkEl('span', null, day.label));
        dh.appendChild(mkEl('span', null, day.hoursText));
        wrap.appendChild(dh);
        for (const l of day.lines) {
          const e = mkEl('div', 'mm-hours-entry');
          e.appendChild(mkEl('div', null, `${l.when ? l.when + '  ' : ''}${l.amountText} · ${l.client}`));
          e.appendChild(mkEl('div', null, l.task));
          e.appendChild(mkEl('div', 'mm-hours-how', l.how));
          if (l.notCounted) e.appendChild(mkEl('div', 'mm-hours-hold', l.notCounted));
          wrap.appendChild(e);
        }
        body.appendChild(wrap);
      }
    }
    body.classList.remove('hidden');
  }

  async function refresh() {
    loadErr.classList.add('hidden');
    body.classList.add('hidden');
    untracked.classList.add('hidden');
    loading.classList.remove('hidden');
    const res = await loadMyHours(request, { days: Number(windowSel.value) || 7 });
    loading.classList.add('hidden');
    if (!res.ok) {
      loadErr.textContent = res.message;
      loadErr.classList.remove('hidden');
      return;
    }
    // No member parameter: the token scopes the read to its own member server-side.
    renderLedger(shapeLedger(res.ledger));
  }

  // ── projects ─────────────────────────────────────────────────────────────
  let chosenLabel = '';
  function labelFor(id) {
    const p = projects.find((x) => x.id === id);
    return p ? projectLabel(p) : '';
  }
  function showPicklist(open) {
    projList.classList.toggle('hidden', !open);
    projSearch.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function choose(p) {
    projSel.value = p.id;
    chosenLabel = projectLabel(p);
    projSearch.value = chosenLabel;
    showPicklist(false);
    projCount.classList.add('hidden');
    formErr.classList.add('hidden');
    renderRecorded();
  }
  function renderProjectOptions(list) {
    projList.textContent = '';
    for (const p of list) {
      const o = mkEl('button', 'mm-hours-pickopt', projectLabel(p));
      o.type = 'button';
      o.setAttribute('role', 'option');
      o.dataset.hours = 'project-option';
      o.dataset.id = p.id;
      if (p.id === projSel.value) o.setAttribute('aria-selected', 'true');
      // mousedown, not click: the field's blur would close the list first.
      o.addEventListener('mousedown', (e) => { e.preventDefault(); choose(p); });
      o.addEventListener('click', () => choose(p));
      projList.appendChild(o);
    }
    projCount.classList.remove('is-none');
    if (list.length === 0 && projects.length > 0) {
      projCount.textContent = HOURS_COPY.projectsNoMatch;
      projCount.classList.add('is-none');
      projCount.classList.remove('hidden');
    } else if (list.length < projects.length) {
      projCount.textContent = HOURS_COPY.projectsCount(list.length, projects.length);
      projCount.classList.remove('hidden');
    } else {
      projCount.classList.add('hidden');
    }
  }

  async function ensureProjects() {
    if (projectsLoaded) return;
    try {
      projects = await loadProjects();
      projectsLoaded = true;
      renderProjectOptions(projects);
      if (projects.length === 0) showFormErr(HOURS_COPY.projectsNone);
    } catch (e) {
      renderProjectOptions([]);
      showFormErr(HOURS_COPY.projectsLoadFailed);
    }
  }

  function showFormErr(text) {
    formErr.textContent = text;
    formErr.classList.remove('hidden');
  }

  // ── R4.2: the record for the chosen day ──────────────────────────────────
  async function loadRecordedFor(date) {
    const mine = ++seq;
    if (!date) {
      window_ = { date: null, available: false, dayEntries: [], truncated: false };
      renderRecorded();
      return;
    }
    recorded.textContent = '';
    recorded.appendChild(mkEl('div', 'mm-hours-why', HOURS_COPY.recordedLoading));
    // Stays hidden until the route has answered — with the day, or with the warning.
    const res = await loadRecordedWindow(request, date);
    if (mine !== seq) return;
    window_ = res.available
      ? { date, available: true, dayEntries: entriesOnDay(res.entries, date, now()), truncated: res.truncated }
      : { date, available: false, dayEntries: [], truncated: false };
    renderRecorded();
  }

  function currentCheck() {
    if (!window_.available || window_.date !== dateIn.value) {
      return { clashes: [], running: false, clashIds: new Set(), sameClient: [] };
    }
    return checkAgainstRecorded({ dayEntries: window_.dayEntries, form: formValues(), nowMs: now() });
  }

  function renderRecorded() {
    recorded.textContent = '';
    clashNote.classList.add('hidden');
    clashNote.classList.remove('is-soft');
    if (window_.date !== dateIn.value) {
      // A read for this day is still on its way; loadRecordedFor repaints on arrival.
      recorded.classList.add('hidden');
      return;
    }
    if (!window_.available) {
      // ⛔ FAIL CLOSED — never an empty day, never a silently hidden section.
      const warn = mkEl('p', 'mm-hours-clash is-soft', HOURS_COPY.recordedUnchecked);
      warn.setAttribute('role', 'status');
      warn.dataset.hours = 'unchecked';
      recorded.appendChild(warn);
      const again = mkEl('button', 'mm-hours-link', HOURS_COPY.recordedRecheck);
      again.type = 'button';
      again.dataset.hours = 'recheck';
      again.addEventListener('click', () => loadRecordedFor(dateIn.value));
      recorded.appendChild(again);
      recorded.classList.remove('hidden');
      return;
    }
    const check = currentCheck();
    recorded.appendChild(head(HOURS_COPY.recordedTitle));
    if (window_.dayEntries.length === 0) {
      recorded.appendChild(mkEl('div', 'mm-hours-why', HOURS_COPY.recordedNone));
    }
    // ⛔ D3 — ONE LINE PER ENTRY: time range · client, and a small Timer / Typed /
    // Auto tag. The explanation line is drawn ONLY on an entry that is flagged —
    // one the typed times cross, or one that does not count. Every other entry is
    // the single line and nothing else.
    for (const entry of window_.dayEntries) {
      const clash = check.clashIds.has(entry.id);
      const ln = recordedLine(entry, { clash, nowMs: now() });
      const item = mkEl('div', `mm-hours-rec${clash ? ' is-clash' : ''}${ln.flagged ? ' is-flagged' : ''}`);
      item.dataset.hours = clash ? 'recorded-clash' : 'recorded-entry';
      const top = mkEl('div', 'mm-hours-rec-top');
      const txt = mkEl('span', 'mm-hours-rec-text', ln.text);
      txt.title = ln.text;
      top.appendChild(txt);
      if (ln.tagText) {
        const tag = mkEl('span', `mm-hours-tag is-${ln.tag}`, ln.tagText);
        tag.dataset.hours = 'recorded-tag';
        tag.dataset.tag = ln.tag;
        top.appendChild(tag);
      }
      item.appendChild(top);
      if (ln.flagged) {
        const why = mkEl('div', 'mm-hours-hold', ln.explain);
        why.dataset.hours = 'recorded-explain';
        item.appendChild(why);
      }
      recorded.appendChild(item);
    }
    if (window_.truncated) recorded.appendChild(mkEl('div', 'mm-hours-why', HOURS_COPY.recordedTruncated));
    recorded.classList.remove('hidden');

    if (check.clashes.length > 0) {
      clashNote.textContent = check.running ? HOURS_COPY.clashRunningInline : HOURS_COPY.clashInline;
      clashNote.classList.remove('hidden');
    } else if (check.sameClient.length > 0) {
      clashNote.textContent = HOURS_COPY.sameClientInline;
      clashNote.classList.add('is-soft');
      clashNote.classList.remove('hidden');
    }
  }

  // ── refusals ─────────────────────────────────────────────────────────────
  function renderRefusal(result) {
    refusal.textContent = '';
    // An unchecked-day prompt sits in front of a pending duplicate confirm; it must
    // not throw that confirm's token away.
    if (result.kind !== 'unchecked') duplicateCheckId = null;
    const rHead = mkEl('div', 'mm-hours-refusal-head');
    const rBody = mkEl('div', 'mm-hours-refusal-body');
    if (result.kind === 'unchecked') {
      rHead.textContent = HOURS_COPY.uncheckedTitle;
      rBody.textContent = HOURS_COPY.uncheckedBody;
      refusal.appendChild(rHead);
      refusal.appendChild(rBody);
      const acts = mkEl('div', 'mm-hours-refusal-acts');
      const retry = mkEl('button', 'mm-btn primary', HOURS_COPY.uncheckedRetry);
      retry.type = 'button';
      retry.dataset.hours = 'unchecked-retry';
      retry.addEventListener('click', () => {
        refusal.classList.add('hidden');
        loadRecordedFor(dateIn.value);
      });
      const anyway = mkEl('button', 'mm-btn', HOURS_COPY.uncheckedConfirm);
      anyway.type = 'button';
      anyway.dataset.hours = 'unchecked-confirm';
      // ⛔ The confirm is for THIS day only, and it is the member's explicit act.
      anyway.addEventListener('click', () => { uncheckedAckDate = dateIn.value; onSubmit(); });
      acts.appendChild(retry);
      acts.appendChild(anyway);
      refusal.appendChild(acts);
    } else if (result.kind === 'overlap') {
      rHead.textContent = HOURS_COPY.overlapTitle;
      rBody.textContent = result.running ? HOURS_COPY.overlapRunningBody : HOURS_COPY.overlapBody;
      refusal.appendChild(rHead);
      refusal.appendChild(rBody);
    } else if (result.kind === 'duplicate') {
      duplicateCheckId = result.checkId;
      // ⛔ D3 — ONLY the server's specific explanation, which names the existing
      // entry. The generic heading and body sat above it and were what a member
      // read; the one sentence that said WHICH entry looked the same came third.
      // The generic body stays only as the fallback for a server that sent none.
      const specific = (result.findings || []).filter((f) => f && f.message);
      for (const f of specific) refusal.appendChild(mkEl('p', 'mm-hours-find', f.message));
      if (specific.length === 0) {
        rBody.textContent = HOURS_COPY.duplicateBody;
        refusal.appendChild(rBody);
      }
      const acts = mkEl('div', 'mm-hours-refusal-acts');
      const yes = mkEl('button', 'mm-btn primary', HOURS_COPY.duplicateConfirm);
      yes.type = 'button';
      yes.dataset.hours = 'confirm-duplicate';
      // ⛔ Resubmits the SAME body plus the token, which the server binds to that exact
      // proposal, this member, one use and 30 minutes.
      yes.addEventListener('click', () => onSubmit());
      const no = mkEl('button', 'mm-btn', HOURS_COPY.duplicateCancel);
      no.type = 'button';
      no.dataset.hours = 'leave-duplicate';
      no.addEventListener('click', () => closeForm());
      acts.appendChild(yes);
      acts.appendChild(no);
      refusal.appendChild(acts);
    } else {
      rBody.textContent = result.message;
      refusal.appendChild(rBody);
    }
    refusal.classList.remove('hidden');
    // ⛔ IN VIEW — a refusal scrolled off above a 320px popup reads as "it didn't save".
    scrollTo(refusal, 'center');
  }

  function resetForm() {
    formErr.classList.add('hidden');
    saved.classList.add('hidden');
    refusal.classList.add('hidden');
    refusal.textContent = '';
    submitBtn.disabled = false;
    submitBtn.textContent = HOURS_COPY.submit;
    duplicateCheckId = null;
  }

  function closeForm() {
    form.classList.add('hidden');
    resetForm();
  }

  async function openForm(prefillDate) {
    resetForm();
    uncheckedAckDate = null;
    whatIn.value = '';
    startIn.value = '';
    endIn.value = '';
    // A pre-set hidden id (a probe, or a re-open) keeps its name in the one field.
    projSearch.value = projSel.value ? (labelFor(projSel.value) || projSearch.value) : '';
    dateIn.value = prefillDate || dateInputValue(new Date(now()));
    form.classList.remove('hidden');
    // Both at once: the day's record does not wait on the client list.
    await Promise.all([ensureProjects(), loadRecordedFor(dateIn.value)]);
    scrollTo(form);
  }

  async function onSubmit() {
    formErr.classList.add('hidden');
    saved.classList.add('hidden');
    const built = buildSubmission({ ...formValues(), duplicateCheckId });
    if (!built.ok) {
      showFormErr(built.message);
      const focus = { project: projSel, date: dateIn, start: startIn, end: endIn, what: whatIn }[built.field];
      if (focus) { try { focus.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    // ⛔ FAIL CLOSED (R4.2). A read still pending for another day is finished first;
    // a day whose record could not be read needs the member's explicit confirm for
    // that day. Nothing is sent until one of the two is true.
    if (window_.date !== dateIn.value) await loadRecordedFor(dateIn.value);
    if (uncheckedNeedsConfirm({ recordWindow: window_, date: dateIn.value, acknowledgedDate: uncheckedAckDate })) {
      renderRecorded();
      renderRefusal({ kind: 'unchecked' });
      return;
    }
    // ⛔ A clash the record already shows is said BEFORE the round trip, as the same
    // refusal the server would return — guard 4b refuses exactly this. Nothing is sent.
    const check = currentCheck();
    if (check.clashes.length > 0) {
      renderRecorded();
      renderRefusal({ kind: 'overlap', running: check.running });
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = HOURS_COPY.submitting;
    const result = await submitPastHours(request, built.body);
    submitBtn.disabled = false;
    submitBtn.textContent = HOURS_COPY.submit;
    if (!result.ok) {
      if (result.kind === 'ack_stale') duplicateCheckId = null;
      renderRefusal(result);
      // The server knew something the last read did not — re-read the day.
      if (result.kind === 'overlap') loadRecordedFor(dateIn.value);
      return;
    }
    refusal.classList.add('hidden');
    duplicateCheckId = null;
    const client = labelFor(projSel.value) || chosenLabel;
    saved.textContent = `${HOURS_COPY.savedTitle} ${HOURS_COPY.savedBody(fmtDuration(built.minutes), client)}`;
    saved.classList.remove('hidden');
    scrollTo(saved, 'center');
    const day = dateIn.value;
    whatIn.value = '';
    startIn.value = '';
    endIn.value = '';
    // Re-read both, so the member SEES the time land in the ledger and in the day.
    await Promise.all([refresh(), loadRecordedFor(day)]);
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  refreshBtn.addEventListener('click', () => refresh());
  windowSel.addEventListener('change', () => refresh());
  addToggle.addEventListener('click', () => {
    if (form.classList.contains('hidden')) openForm();
    else closeForm();
  });
  cancelBtn.addEventListener('click', closeForm);
  submitBtn.addEventListener('click', () => onSubmit());
  projSearch.addEventListener('input', () => {
    // Typing away from the chosen name un-chooses it: a half-edited name must not
    // submit against the client that was picked before the edit.
    if (projSel.value && projSearch.value !== chosenLabel) { projSel.value = ''; chosenLabel = ''; renderRecorded(); }
    renderProjectOptions(filterProjects(projects, projSearch.value));
    showPicklist(true);
  });
  projSearch.addEventListener('focus', () => { renderProjectOptions(filterProjects(projects, projSel.value ? '' : projSearch.value)); showPicklist(true); });
  projSearch.addEventListener('blur', () => { setTimeout(() => showPicklist(false), 150); });
  projSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = projList.querySelector('[data-hours="project-option"]');
      if (first) { e.preventDefault(); first.click(); }
    } else if (e.key === 'Escape') {
      // An OPEN list owns this Escape: it closes the list and goes no further
      // (preventDefault is what the surfaces' "Escape leaves My hours" checks).
      // With the list closed, Escape leaves the view as it does anywhere else.
      if (!projList.classList.contains('hidden')) e.preventDefault();
      showPicklist(false);
    }
  });
  // ⛔ R4.2 — the day's record is read as soon as a day is chosen.
  dateIn.addEventListener('change', () => { formErr.classList.add('hidden'); loadRecordedFor(dateIn.value); });
  for (const input of [startIn, endIn, projSel]) {
    const recheck = () => { formErr.classList.add('hidden'); renderRecorded(); };
    input.addEventListener('input', recheck);
    input.addEventListener('change', recheck);
  }
  whatIn.addEventListener('input', () => formErr.classList.add('hidden'));

  return {
    el: root,
    back,
    open: () => { closeForm(); revealBack(); return refresh(); },
    refresh,
    openForm,
    destroy: () => { host.textContent = ''; },
  };
}
