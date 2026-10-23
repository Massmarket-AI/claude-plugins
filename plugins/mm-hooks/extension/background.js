// background.js — MV3 service worker (module).
// Owns: timer lifecycle (clock + calendar-block picker spine), the /track event
// queue (timer_start/timer_stop/set_category/activity), the CONTINUOUS-CAPTURE
// gate and its sign-in/sign-out lifecycle, the per-block scheduled-end alarm, and
// the QA-capture mode (click-triggered screenshots + Loom upload_token). All
// timer state is read from storage on every wake so a cold service-worker restart
// fully reconstructs itself.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ v0.11.0 — CAPTURE IS BACK, ON A NEW GATE.
//
// v0.6.0's phase-2 shrink removed the always-on proof layer wholesale: per-minute
// activity buckets, periodic screenshots, tab-switch/heartbeat posts, the
// IndexedDB screenshot upload queue, and the chrome.idle-driven events. Two of
// those come back here and the rest DO NOT:
//
//   BACK  · per-minute activity buckets (content.js), batched to /api/ext/track
//   BACK  · the 1-minute flush alarm that drains them
//   GONE, AND STAYING GONE · every screenshot path outside the explicit
//         QA-capture walkthrough, the periodic/burst/segment shot cadence, the
//         shots IndexedDB queue, and the /screenshot endpoint. Rob ruled
//         screenshots out of scope for this release, the URL is structured and
//         strictly better than OCR, and the notice this build shows says "No
//         screenshots" in as many words.
//
// And the gate is different in the way that matters: the old layer ran while a
// TIMER was open. This one runs while the member is SIGNED IN — signed in AND
// acknowledged AND not paused, per capture.js's captureGate(). A member who
// never presses Start still produces rows; the timer only decides which
// `time_entry` the server attaches a minute to.
//
// ⛔ ONE PLACE DECIDES. Every predicate lives in capture.js. This file arms
// alarms, moves bytes, paints the badge and fires notifications; it does not
// re-derive whether capture should be on. See the header on capture.js.
// ═════════════════════════════════════════════════════════════════════════════

import {
  SETTINGS,
  QA,
  INTERNAL_KEY,
  timerKey,
  getTimers,
  setTimers,
  anyTimerOpen,
  upsertTimer,
  removeTimer,
  getTimerByKey,
  clearTimers,
  storedTimerFor,
  apiFetch,
  getConfig,
  getQa,
  setQa,
  clearQa,
  deliverableTypeFromTitle,
  clientHintFromTitle,
  ensureInstallId,
} from './common.js';
import {
  CAPTURE,
  ACTIVITY_QUEUE_KEY,
  AUTH_FAILURE_KEY,
  SIGNED_OUT_NOTIFICATION,
  SIGNED_IN_NOTIFICATION,
  NOTICE_PENDING_NOTIFICATION,
  NOTICE_PENDING_BADGE,
  getCapture,
  setCapture,
  publishCaptureOn,
  captureGate,
  applySignedIn,
  applySignedOut,
  applyPaused,
  applyAcknowledged,
  applyNoticeNotified,
  hasEverSignedIn,
  shouldNotifySignedOut,
  shouldNotifyNoticePending,
  shouldValidate,
  appendRows,
  batchRows,
  toTrackEvents,
  SUBFRAME_INPUT_TYPE,
  subframeRelay,
  isContentSubframeSender,
  makeSerializer,
  removeSent,
} from './capture.js';
import { SELF_RELOAD, selfReloadDecision } from './selfreload.js';

const A_SCHED_END = 'sched_end';        // one-shot: fires when a block-linked timer passes its scheduled_end
const A_ACTIVITY = 'activity_flush';    // periodic: drain buffered per-minute rows to /track
const A_TOKEN_CHECK = 'token_check';    // periodic: re-validate the stored token (4h)

const SIGNED_OUT_NOTIFICATION_ID = 'mm_tt_signed_out';
const SIGNED_IN_NOTIFICATION_ID = 'mm_tt_signed_in';
const NOTICE_PENDING_NOTIFICATION_ID = 'mm_tt_notice_pending';

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- the queues' one writer
// ⛔ EVERY READ-MODIFY-WRITE OF A QUEUE RUNS ON THIS ONE CHAIN, ONE AT A TIME.
// Both storage-backed queues — the /track `queue` below and ACTIVITY_QUEUE_KEY —
// are changed ONLY inside withQueues(): every append, and every removal after a
// POST. chrome.storage.local has no transactions, so get → change → set is three
// steps, and two interleaved lose a change (makeSerializer() in capture.js has
// the measurement: 8 rows arriving together left 1). The chain waits its turn
// rather than skipping, a step that throws rejects only its own caller, and the
// POST itself stays OUTSIDE the chain — holding it across a request would stall
// every tab's rows for as long as the request takes. Only this worker writes
// either key, so one in-memory chain covers every writer.
const withQueues = makeSerializer();

// ---------------------------------------------------------------- event queue (/track)
async function enqueue(...events) {
  await withQueues(async () => {
    const { queue = [] } = await chrome.storage.local.get('queue');
    let next = queue.concat(events);
    if (next.length > SETTINGS.MAX_QUEUE) {
      next = next.slice(next.length - SETTINGS.MAX_QUEUE); // drop oldest
    }
    await chrome.storage.local.set({ queue: next });
  });
}

let flushing = false; // best-effort in-memory de-dupe; correctness still lives in storage
async function flushQueue() {
  if (flushing) return null;
  flushing = true;
  try {
    const queue = await withQueues(async () => {
      const { queue: q = [] } = await chrome.storage.local.get('queue');
      return q;
    });
    if (!queue.length) return { open_entry_id: null, accepted: 0 };
    let result;
    try {
      result = await apiFetch('/api/ext/track', { method: 'POST', body: { events: queue } });
    } catch (e) {
      return null; // keep the queue for the next retry
    }
    // Remove exactly the events we sent — by identity, on the chain — so anything
    // enqueued meanwhile survives and nothing sent comes back (removeSent()).
    await withQueues(async () => {
      const { queue: cur = [] } = await chrome.storage.local.get('queue');
      await chrome.storage.local.set({ queue: removeSent(cur, queue) });
    });
    // Reconcile per-block entry ids from the server's open_entries (parallel model).
    // Match by calendar_block_id so each local timer learns its server entry id.
    //
    // ⛔ D4 — REFRESH A STALE ID, DON'T ONLY FILL AN EMPTY ONE. When the server holds
    // exactly one open entry for a key, that entry IS this timer, so a different
    // stored id is stale (the key was stopped and restarted elsewhere) and is
    // replaced. Lane W2b closes strictly by entry id, so a stale id is a Stop that
    // closes nothing. A key with several open entries (a same-key duplicate) keeps
    // the id it already has and is only filled when empty. This is the path that
    // covers the side panel, which never adopts server entries itself.
    if (result && Array.isArray(result.open_entries)) {
      const list = await getTimers();
      const byKey = new Map(list.map((t) => [t.key, t]));
      const keyOf = (oe) => timerKey(oe.calendar_block_id, oe.project_id ?? null);
      const perKey = new Map();
      for (const oe of result.open_entries) {
        const k = keyOf(oe);
        perKey.set(k, (perKey.get(k) || 0) + 1);
      }
      for (const oe of result.open_entries) {
        // v0.8.4: `project_id` is on open_entries too, so a block-less CLIENT entry
        // reconciles to its own timer instead of colliding on `__internal__`.
        const key = keyOf(oe);
        const t = byKey.get(key);
        if (!t || oe.id == null) continue;
        if (perKey.get(key) === 1) {
          if (String(t.entryId) !== String(oe.id)) t.entryId = oe.id;
        } else if (!t.entryId) {
          t.entryId = oe.id;
        }
      }
      await setTimers(Array.from(byKey.values()));
    }
    return result;
  } finally {
    flushing = false;
  }
}

// ============================================================ CONTINUOUS CAPTURE
// The gate, the queue, and the sign-in lifecycle. Every decision is capture.js's;
// everything below is the plumbing that acts on it.

// ---------------------------------------------------------------- activity queue
// Its own storage-backed queue, separate from the /track `queue`, because the two
// are drained on different cadences and a partial send of one must not renumber
// the other. Both end up at the same endpoint.
async function enqueueActivity(bucket) {
  if (!bucket) return;
  // On the chain (withQueues): the minute sweep below enqueues every tab's rows at
  // once, and unserialized they overwrote one another.
  await withQueues(async () => {
    const { [ACTIVITY_QUEUE_KEY]: q = [] } = await chrome.storage.local.get(ACTIVITY_QUEUE_KEY);
    // appendRows() sanitizes: the wire allowlist in capture.js is the ONLY thing
    // that reaches storage, so a field added to a bucket by a future edit to
    // content.js cannot leak by simply existing.
    await chrome.storage.local.set({ [ACTIVITY_QUEUE_KEY]: appendRows(q, bucket) });
  });
}

let flushingActivity = false;
async function flushActivity() {
  if (flushingActivity) return;
  flushingActivity = true;
  try {
    const q = await withQueues(async () => {
      const { [ACTIVITY_QUEUE_KEY]: cur = [] } = await chrome.storage.local.get(ACTIVITY_QUEUE_KEY);
      return cur;
    });
    if (!q.length) return;
    const rows = batchRows(q);
    // ⛔ Sent as /track events, with `meta.capture_mode` stamped SERVER-SIDE. The
    // client does not get to label its own rows as continuous capture: a
    // QA-walkthrough build and this one would then be distinguishable only by a
    // string the client chose, and the distinction is what keeps the two data
    // sets apart in the attribution resolver.
    try {
      await apiFetch('/api/ext/track', { method: 'POST', body: { events: toTrackEvents(rows) } });
    } catch (e) {
      // 401 is handled by the storage-bus watcher below (apiFetch stamps it).
      return; // keep the queue for the next retry
    }
    // Remove exactly the rows that were SENT — by row_key, on the chain — so a row
    // queued during the POST survives and a sent row never comes back (removeSent()).
    await withQueues(async () => {
      const { [ACTIVITY_QUEUE_KEY]: cur = [] } = await chrome.storage.local.get(ACTIVITY_QUEUE_KEY);
      await chrome.storage.local.set({ [ACTIVITY_QUEUE_KEY]: removeSent(cur, rows) });
    });
  } finally {
    flushingActivity = false;
  }
}

// Ask every injected tab for its live partial-minute bucket + buffered rows, so a
// pause / sign-out / stop does not lose the minute in progress.
async function collectPendingRows() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  await Promise.all(tabs.map(async (t) => {
    if (typeof t.id !== 'number') return;
    try {
      const res = await chrome.tabs.sendMessage(t.id, { type: 'flushNow' });
      for (const row of (res && res.rows) || []) await enqueueActivity(row);
    } catch (e) { /* no content script in that tab — nothing to collect */ }
  }));
}

// ---------------------------------------------------------------- capture arming
// Publish the gate's answer, paint the badge, and arm or tear down the flush alarm.
// Called after EVERY state change so the three can never disagree.
async function applyCaptureState(state) {
  // ⛔ READ THE PREVIOUS ANSWER FIRST, so the backfill below runs on the EDGE and
  // not on every call. reconcile() calls this on every service-worker wake, and
  // the 1-minute flush alarm wakes it — so injecting unconditionally would mean a
  // chrome.tabs.query({}) plus an executeScript per tab, every minute, forever.
  // content.js self-guards, so those would all be harmless no-ops; they would just
  // be no-ops we paid for sixty times an hour.
  let was = false;
  try {
    const o = await chrome.storage.local.get('captureOn');
    was = !!o.captureOn;
  } catch (e) { /* unreadable — treat as off, so a turn-on still backfills */ }

  const on = await publishCaptureOn(state);
  if (on) {
    chrome.alarms.create(A_ACTIVITY, { periodInMinutes: CAPTURE.FLUSH_MIN });
    // Tabs that were already open when capture turned on have no content script:
    // MV3 auto-injects a DECLARED entry only into tabs that navigate AFTER the
    // extension loads. Without this, acknowledging the notice records nothing at
    // all until the member happens to navigate — which reads exactly like the
    // gate being broken. onStartup/onInstalled cover the cold-start case.
    if (!was) await injectExistingTabs();
  } else {
    await chrome.alarms.clear(A_ACTIVITY);
    await collectPendingRows();  // keep the partial minute we already recorded
    await flushActivity();       // …and deliver it if we still can
  }
  await refreshBadge();
  // ⛔ v0.11.1 — THE UNACKNOWLEDGED NOTICE IS ANNOUNCED FROM HERE, and here is not
  // arbitrary. A_ACTIVITY is armed only while the gate is ON, so it is guaranteed
  // absent for exactly the profile that needs telling; the only things that run
  // for that profile are this function — on every service-worker wake via
  // reconcile(), on every sign-in/sign-out edge, and on every acknowledge/pause
  // — and the 4-hourly token check, which lands here through onSignedIn(). The
  // 24h cap lives in storage, never in a module variable: the worker is torn
  // down after ~30s idle and a module counter would reset on every wake.
  await notifyNoticePending(state);
  return on;
}

/**
 * The notice-pending notification. ONE per profile per NOTICE_VERSION, then at
 * most one per 24h while still unacknowledged — shouldNotifyNoticePending() is
 * the whole predicate, derived from the gate, so `paused` and `signed_out` can
 * never land here. Cleared by the acknowledgement handler below.
 */
async function notifyNoticePending(state) {
  if (!shouldNotifyNoticePending(state, Date.now())) return state;
  try {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create(NOTICE_PENDING_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        // ⛔ OPUS_TO_REVIEW — both strings are frozen in capture.js, pending sign-off.
        title: NOTICE_PENDING_NOTIFICATION.title,
        message: NOTICE_PENDING_NOTIFICATION.body,
        priority: 2,
        requireInteraction: true,
      });
    }
  } catch (e) { /* notifications unavailable — the amber ? badge still stands */ }
  // A narrow patch of the two cap fields, not the whole state, so an
  // acknowledgement landing in the same instant is not overwritten by a stale
  // `noticeVersion: 0` — the same shape onSignedOut() uses for its own cap.
  const stamped = applyNoticeNotified(state, Date.now());
  return await setCapture({
    lastNoticeNotifyAt: stamped.lastNoticeNotifyAt,
    lastNoticeNotifyVersion: stamped.lastNoticeNotifyVersion,
  });
}

// ---------------------------------------------------------------- token validation
/**
 * "Signed in" = a token is stored for this profile AND the last validation
 * against the server succeeded. Run at service-worker start, every 4 hours, and
 * on any 401.
 *
 * ⛔ THERE IS NO DAILY LOGIN, and this is the function that keeps it that way. It
 * does not prompt, it does not expire anything on a clock of its own, and a
 * successful check simply refreshes `validatedAt`. The only thing that signs a
 * member out is the server refusing their token or the token going missing.
 */
let validating = false;
async function validateToken({ force = false } = {}) {
  // ⛔ RE-ENTRANCY GUARD, AND IT IS LOAD-BEARING, NOT DEFENSIVE PADDING.
  //
  // The failure it prevents is a real cycle, not a hypothetical: this function
  // calls apiFetch(), apiFetch() stamps AUTH_FAILURE_KEY on a 401, the storage
  // watcher below sees that stamp and calls this function. Without a guard a
  // single revoked token spins the service worker at network speed for as long
  // as the browser is open, hammering /api/ext/auth from every member whose
  // token was rotated — on a database with 44 crons and no connection headroom.
  //
  // Two things break the cycle and both are needed. This flag stops the
  // synchronous re-entry; the watcher's own floor (see it below) stops the
  // slower one, where a 401 from some OTHER route arrives after this returns.
  if (validating) return await getCapture();
  const state = await getCapture();
  if (!force && !shouldValidate(state, Date.now())) return state;
  validating = true;
  try {
    return await runValidation();
  } finally {
    validating = false;
  }
}

async function runValidation() {
  let cfg;
  try { cfg = await getConfig(); } catch (e) { cfg = null; }
  if (!cfg || !cfg.token) {
    await onSignedOut('missing_token');
    return await getCapture();
  }

  try {
    // /api/ext/auth is the handshake the options page already uses, and it is the
    // cheapest authenticated call in the API — it resolves the member and returns.
    await apiFetch('/api/ext/auth', { method: 'POST', body: {} });
  } catch (e) {
    if (e && e.status === 401) {
      await onSignedOut('401');
    }
    // Any other failure (offline, 500, DNS) is NOT a sign-out. A member on a
    // train is not signed out, and telling them they are — then stopping capture
    // and firing a notification — would be both wrong and unrecoverable-looking.
    return await getCapture();
  }

  await onSignedIn();
  return await getCapture();
}

/** Transition INTO signed-out: stop capture, badge, notify (24h-capped). */
async function onSignedOut(reason) {
  const before = await getCapture();
  const { next } = applySignedOut(before, reason, nowIso());
  let state = await setCapture(next);
  await applyCaptureState(state);

  // ⛔ TELL THE SERVER — AND ACCEPT THAT IT CANNOT HEAR US YET.
  //
  // This is the honest shape of the problem, written down rather than papered
  // over: all three sign-out reasons mean the extension has no credential the
  // server will accept. That IS what being signed out is.
  //
  // So the event is ENQUEUED AND NOT FLUSHED. Calling flushQueue() here would
  // post to /track with the same rejected token, take another 401, and — because
  // apiFetch() stamps AUTH_FAILURE_KEY on every 401 — wake the watcher below,
  // which calls validateToken(), which lands back here. That is a loop, and it
  // would run at network speed for as long as the browser stayed open.
  //
  // Not flushing costs nothing. The event sits in the same append-only /track
  // queue as the timer events, carrying its ORIGINAL timestamp, and goes out on
  // the next successful sign-in — before the signed_in event, because the queue
  // is ordered. team-health then reads an accurate "signed out 09:14 → back
  // 11:02" after the fact.
  //
  // Live server-side detection would have to come from the FAILED AUTH ATTEMPT
  // itself, which only the server can see and which is not in this release. Do
  // not "fix" this by having the extension retry harder; it has nothing to retry
  // with.
  await enqueue({ kind: 'signed_out', ts: state.signedOutAt || nowIso(), reason: state.signedOutReason });

  // ⛔ ONE cap predicate, not two. applySignedIn() zeroes `lastSignedOutNotifyAt`
  // on the way back in, so the first sign-out after any sign-in always passes this
  // and every repeat inside 24h is capped. Adding a separate `transitioned` check
  // on top would double-gate it and silence the day-two reminder, which is the one
  // that matters.
  if (!shouldNotifySignedOut(state, Date.now())) return state;
  // …and never say "sign BACK in" to a profile that has never signed in. See
  // hasEverSignedIn() — asked of the BEFORE state, on purpose.
  if (!hasEverSignedIn(before)) return state;

  try {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create(SIGNED_OUT_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        // ⛔ VERBATIM. Both strings are frozen in capture.js.
        title: SIGNED_OUT_NOTIFICATION.title,
        message: SIGNED_OUT_NOTIFICATION.body,
        priority: 2,
        requireInteraction: true,
      });
    }
  } catch (e) { /* notifications unavailable — the red ! badge still stands */ }

  state = await setCapture({ lastSignedOutNotifyAt: Date.now() });
  return state;
}

/** Transition INTO signed-in: resume capture, clear the badge, notify once. */
async function onSignedIn() {
  const before = await getCapture();
  const { next, transitioned } = applySignedIn(before, Date.now());
  const state = await setCapture(next);
  await applyCaptureState(state);
  if (!transitioned) return state;   // a routine 4-hourly re-check is not news

  try { chrome.notifications.clear(SIGNED_OUT_NOTIFICATION_ID); } catch (e) { /* ignore */ }
  // ⛔ "Signed in — capture resumed." is only true when the gate is actually ON.
  // A member who signs in while unacknowledged (or paused) has NOT had capture
  // resumed; they get the notice-pending notification from applyCaptureState()
  // above, and this one would contradict it. The gate is the whole predicate.
  try {
    if (captureGate(state).on && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create(SIGNED_IN_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        // ⛔ VERBATIM, and it is the whole message. Chrome requires a title, so
        // the approved sentence is the title and the body is empty rather than
        // padded with a second sentence nobody wrote.
        title: SIGNED_IN_NOTIFICATION.message,
        message: '',
        priority: 1,
      });
    }
  } catch (e) { /* ignore */ }
  // ⛔ ENQUEUED, NOT POSTED DIRECTLY, so it lands AFTER whatever is already in the
  // queue — which on this path is the signed_out event that could not be
  // delivered while the token was refused. The order is the record: signed_out at
  // 09:14, signed_in at 11:02, both stamped when they happened.
  await enqueue({ kind: 'signed_in', ts: nowIso() });
  // Anything buffered while signed out can go now.
  await flushQueue();
  await flushActivity();
  return state;
}

// ---------------------------------------------------------------- shared IndexedDB
// v0.6.0 phase-2 shrink: the always-on `/activity` bucket queue and the always-on
// screenshot IndexedDB queue (the `shots` store + drainScreenshots) were removed
// entirely — a Claude Code session hook now covers agent-driven work tracking, so
// this extension no longer runs continuous browser-activity/screenshot capture.
// idb() survives because the QA-capture mode below still uses QA_SHOT_STORE (and
// the legacy, intentionally-empty QA_AUDIO_STORE) via the SAME database/version —
// offscreen.js opens the identical schema so the two contexts can't race a version
// mismatch.
const DB_NAME = 'mm_tt';
const QA_SHOT_STORE = 'qa_shots'; // QA-capture click screenshots (keyPath: seq)
const QA_AUDIO_STORE = 'qa_audio'; // LEGACY (v2 mic segments). Audio removed in v0.5.0 — kept empty so the DB schema/version is unchanged across installs (no migration bump).
const DB_VERSION = 2; // v1 = shots only (removed v0.6.0); v2 adds qa_shots + qa_audio. Offscreen opens the SAME version.
let dbPromise = null;

function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(QA_SHOT_STORE)) {
          db.createObjectStore(QA_SHOT_STORE, { keyPath: 'seq' });
        }
        if (!db.objectStoreNames.contains(QA_AUDIO_STORE)) {
          db.createObjectStore(QA_AUDIO_STORE, { keyPath: 'seg' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------- QA Loom upload token
// At QA-capture START we mint a short-lived upload token so the qa-doc-generator skill
// can later upload the rep's FULL Loom video into the project (POST /api/ext/qa-video-upload).
// The token is written into the bundle's meta.json. Best-effort: a failed mint DEGRADES
// (capture still records clicks/screenshots) — the skill just notes the token is absent.
// Returns { upload_token, expires_at } on success, or { error } on failure. Never throws.
async function mintQaUploadToken(blockId) {
  try {
    const res = await apiFetch('/api/ext/qa-upload-token', {
      method: 'POST',
      body: { block_id: blockId ?? null },
    });
    if (res && res.upload_token) {
      return { upload_token: res.upload_token, expires_at: res.expires_at || null };
    }
    return { error: 'no_token_in_response' };
  } catch (e) {
    return { error: String((e && (e.code || e.message)) || e) };
  }
}

// ---------------------------------------------------------------- alarms
// Three alarms now, and only ONE of them is tied to a timer:
//   · `sched_end:<key>` — per-block scheduled-end gate. Armed on start, torn down
//     by disarmTracking() on the last block's stop.
//   · A_ACTIVITY        — the 1-minute activity flush. Armed and torn down by
//     applyCaptureState(), i.e. by the CAPTURE gate, NOT by the timer.
//   · A_TOKEN_CHECK     — the 4-hourly token re-validation. Always armed while the
//     extension is installed; it is what notices a revoked token on a machine
//     nobody has touched since yesterday.
//
// ⛔ disarmTracking() MUST NOT CLEAR A_ACTIVITY. It runs when the last timer
// stops, and under v0.11.0 stopping a timer does not stop capture — that is the
// whole point of the release. Clearing the flush alarm here would leave a signed-in
// member recording minutes into a queue nothing drains until the next Start.
async function disarmTracking() {
  await clearAllSchedEndAlarms();
}

/** Arm the alarms that are not tied to a timer. Idempotent; safe on every wake. */
async function armCaptureAlarms() {
  chrome.alarms.create(A_TOKEN_CHECK, { periodInMinutes: CAPTURE.VALIDATE_HOURS * 60 });
  const state = await getCapture();
  if (captureGate(state).on) {
    chrome.alarms.create(A_ACTIVITY, { periodInMinutes: CAPTURE.FLUSH_MIN });
  }
}

// Per-block scheduled-end alarms are named `sched_end:<key>` (v0.5.5 parallel).
// Clear every one of them (used on full stop / reset).
async function clearAllSchedEndAlarms() {
  await chrome.alarms.clear(A_SCHED_END); // legacy single alarm, if present
  let all = [];
  try { all = await chrome.alarms.getAll(); } catch (e) { return; }
  await Promise.all(
    all
      .filter((a) => a.name && a.name.indexOf(A_SCHED_END + ':') === 0)
      .map((a) => chrome.alarms.clear(a.name)),
  );
}

// ---------------------------------------------------------------- self-reload (0.11.5)
// A newer build written into this folder (by the mm-hooks plugin, or by hand) is
// picked up without the member pressing reload. selfreload.js decides; this flushes
// and reloads.
//
// ⛔ CREATED ONLY WHEN MISSING. chrome.alarms.create() replaces an alarm of the same
// name and restarts its clock, and this runs on every worker start — which the
// 1-minute activity alarm causes — so re-creating it each time would mean it never
// fired. reconcile() checks on every worker start anyway.
async function armSelfReloadAlarm() {
  let existing = null;
  try { existing = await chrome.alarms.get(SELF_RELOAD.ALARM); } catch (e) { /* treat as missing */ }
  if (!existing) chrome.alarms.create(SELF_RELOAD.ALARM, { periodInMinutes: SELF_RELOAD.PERIOD_MIN });
}

let checkingDisk = false;
async function checkDiskForUpdate() {
  if (checkingDisk) return;
  checkingDisk = true;
  try {
    let diskText;
    try {
      const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      if (!res.ok) return;
      diskText = await res.text();
    } catch (e) {
      return; // not readable this round
    }
    const running = chrome.runtime.getManifest();
    const { [SELF_RELOAD.GUARD_KEY]: guard = null } = await chrome.storage.local.get(SELF_RELOAD.GUARD_KEY);
    const decision = selfReloadDecision({ running, diskText, guard });
    if (!decision.reload) return;
    // ⛔ THE SAME FLUSH THE ACTIVITY ALARM DOES, not a new upload: the tabs' partial
    // minutes into the queue, then both queues out. Whatever does not go out stays in
    // chrome.storage.local, which a reload keeps, and the next worker sends it.
    await collectPendingRows();
    await flushActivity();
    await flushQueue();
    // A flush already in flight elsewhere (each returns early while one runs) has
    // sent its POST but not yet removed what it sent; reloading now would send those
    // events twice. Try again next round.
    if (flushing || flushingActivity) return;
    await chrome.storage.local.set({ [SELF_RELOAD.GUARD_KEY]: { version: decision.version, from: running.version, at: nowIso() } });
    chrome.runtime.reload();
  } catch (e) {
    /* an update check never breaks the worker */
  } finally {
    checkingDisk = false;
  }
}

// ---------------------------------------------------------------- badge
// Red ! while signed out; amber ? while the notice is unacknowledged; green REC
// while any timer runs (amber if ANY open block has passed its scheduled end);
// grey II while capture is paused. Derived from captureGate() + timers + the
// per-block overdue map, so a cold restart repaints correctly.
//
// ⛔ THE PRECEDENCE IS DELIBERATE, AND SIGNED-OUT BEATS REC.
//
// A badge shows one thing. While signed out NOTHING reaches the server — not the
// activity rows and not the timer's own start/stop events, which sit in the queue
// unsent — so a green REC in that state is a claim that the member's hours are
// being recorded when they are not. That is the single worst thing this badge can
// say, so `!` wins.
//
// ⛔ v0.11.1 — THE UNACKNOWLEDGED NOTICE SITS ABOVE REC TOO, and it reads the
// GATE rather than the raw fields. Until this build the badge was the one surface
// in the extension that decided capture state without captureGate(): it read
// `signedIn`, the timer list and `paused`, and had no branch at all for a
// signed-in, un-paused profile that had never acknowledged the notice — so that
// profile got a BLANK badge, which everywhere else means "nothing to tell you",
// while recording nothing. Measured 2026-09-04: two members on 0.11.0 opened the
// popup, pressed Start under a blank badge, and produced zero capture rows over a
// working day. `?` outranks REC because the members it has to reach are the ones
// pressing Start; below REC they would see green all day and learn nothing.
//
// Paused ranks BELOW REC for the mirror-image reason: a paused member's timer
// still posts, so REC is true, and hiding it would understate what IS being
// recorded. Pause is visible with its own state line on both surfaces, which is
// where somebody looks when they want to know about capture rather than the clock.
// It keeps its grey II and gets nothing louder — a deliberate pause is not a fault.
async function refreshBadge() {
  const capture = await getCapture();
  const gate = captureGate(capture);
  if (gate.reason === 'signed_out') {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
    return;
  }
  if (gate.reason === 'not_acknowledged') {
    // ⛔ OPUS_TO_REVIEW — the marker and its colour are frozen in capture.js.
    await chrome.action.setBadgeText({ text: NOTICE_PENDING_BADGE.text });
    await chrome.action.setBadgeBackgroundColor({ color: NOTICE_PENDING_BADGE.color });
    return;
  }
  const timers = await getTimers();
  if (timers.length > 0) {
    const { schedEndBlocks = {} } = await chrome.storage.local.get('schedEndBlocks');
    const overdue = timers.some((t) => schedEndBlocks[t.key]);
    await chrome.action.setBadgeText({ text: 'REC' });
    await chrome.action.setBadgeBackgroundColor({ color: overdue ? '#f79009' : '#12b76a' });
    return;
  }
  if (gate.reason === 'paused') {
    await chrome.action.setBadgeText({ text: 'II' });
    await chrome.action.setBadgeBackgroundColor({ color: '#667085' });
    return;
  }
  await chrome.action.setBadgeText({ text: '' });
}

// ---------------------------------------------------------------- scheduled-end gate
// A block-linked timer is expected to end at its calendar block's scheduled_end.
// We DON'T auto-stop — instead, when that moment passes we set an amber "overdue"
// badge, fire a one-off notification, and raise a per-block flag the popup reads to
// show its "scheduled time is up" banner on next open. Each parallel block gates
// independently (v0.5.5).
async function markSchedEndReached(key, blockTitle) {
  const { schedEndBlocks = {} } = await chrome.storage.local.get('schedEndBlocks');
  const already = !!schedEndBlocks[key];
  schedEndBlocks[key] = true;
  await chrome.storage.local.set({ schedEndBlocks });
  await refreshBadge(); // repaint amber (idempotent; survives cold restart)
  if (already) return; // already flagged/notified once for this block — don't re-notify
  try {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create('mm_tt_sched_end:' + key, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Scheduled time is up',
        message: (blockTitle ? `"${blockTitle}" — ` : '') +
          "this block's scheduled time is up — post QA, request an extension, or keep going.",
        priority: 2,
      });
    }
  } catch (e) {
    /* notifications unavailable — the amber badge + popup banner still cover it */
  }
}

// (Re)arm the scheduled-end alarm for ONE block-linked timer. No-op for unscheduled
// work. If the end is already in the past (e.g. resumed after the block ended), flag
// it immediately instead of scheduling.
async function armSchedEnd(scheduledEnd, blockId, blockTitle) {
  if (!blockId || !scheduledEnd) return; // only block-linked timers gate on scheduled end
  const key = timerKey(blockId);
  await chrome.alarms.clear(A_SCHED_END + ':' + key);
  const endMs = Date.parse(scheduledEnd);
  if (Number.isNaN(endMs)) return;
  if (endMs <= Date.now()) {
    await markSchedEndReached(key, blockTitle);
    return;
  }
  chrome.alarms.create(A_SCHED_END + ':' + key, { when: endMs });
}

// Re-arm scheduled-end alarms for every currently-open block-linked timer (used on
// cold-restart reconcile).
async function rearmAllSchedEnds() {
  const timers = await getTimers();
  for (const t of timers) {
    if (t.blockId && t.scheduledEnd) await armSchedEnd(t.scheduledEnd, t.blockId, t.title);
  }
}

// Clear the overdue flag + alarm for one block key (on that block's stop).
async function clearSchedEndForKey(key) {
  await chrome.alarms.clear(A_SCHED_END + ':' + key);
  const { schedEndBlocks = {} } = await chrome.storage.local.get('schedEndBlocks');
  if (schedEndBlocks[key]) {
    delete schedEndBlocks[key];
    await chrome.storage.local.set({ schedEndBlocks });
  }
}

// ---------------------------------------------------------------- helpers
async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab || null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- content-script injection
// MV3 auto-injects a DECLARED content_scripts entry only into tabs that NAVIGATE
// after the extension loads. Tabs already open when the unpacked extension was
// (re)loaded have no content script. content.js's only remaining job (v0.6.0) is the
// QA-capture click-shot trigger (onQaPointerDown, gated on qaRunning), so this backfill
// now exists purely so a QA-capture walkthrough can screenshot clicks in tabs that were
// already open before the extension loaded/reloaded. qaStart() calls this directly when
// a capture begins; content.js self-guards (window.__mmTtContentLoaded), so re-injecting
// a tab that already has the script is a harmless no-op.
const NON_INJECTABLE_HOSTS = new Set(['chrome.google.com', 'chromewebstore.google.com']);

function isInjectableUrl(url) {
  if (!/^https?:\/\//i.test(url || '')) return false; // http/https only — chrome://, file://, etc. reject scripting
  try {
    return !NON_INJECTABLE_HOSTS.has(new URL(url).hostname); // Chrome blocks content scripts on the Web Store
  } catch (e) {
    return false;
  }
}

async function injectContentScript(tabId, url) {
  if (typeof tabId !== 'number' || !isInjectableUrl(url)) return;
  if (!chrome.scripting) return; // requires the "scripting" permission (manifest >= 0.2.2)
  try {
    // ⛔ F6 (0.11.2): EVERY FRAME, like the declared entry (`all_frames: true`).
    // A tab that was open before the extension loaded would otherwise count
    // input in its top frame only until it navigated — the embedded-editor hole
    // this release closes, reopened for exactly the tabs a member already had
    // open. content.js decides per frame what it may do; see its header.
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch (e) {
    /* discarded/frozen tab, restricted page, or missing host permission — skip it */
  }
}

// Inject into every currently-open http/https tab so already-open tabs begin
// counting immediately when a timer starts (the declared entry misses them).
async function injectExistingTabs() {
  if (!chrome.scripting) return;
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) { return; }
  await Promise.all(tabs.map((t) => injectContentScript(t.id, t.url || '')));
}

// ---------------------------------------------------------------- timer lifecycle
// v0.5.5 PARALLEL model: a member can run multiple blocks at once. Each block is one
// item in the `timers` array (its own entry lifecycle + elapsed clock + Stop).
//
// ⛔ CORRECTED FOR v0.11.0. This used to say the capture stream was "a SINGLE
// stream gated on any timer open". It is not gated on a timer at all any more —
// capture.js's captureGate() answers signed-in + acknowledged + not-paused, and
// starting or stopping a block does not touch it. What a block still decides is
// the ENTRY: which time_entry a minute attaches to, and whose clock is running.
// Only the per-block scheduled-end alarm is armed and disarmed by the timer.
// `projectId` (v0.8.4) clocks a CLIENT that has open work but nothing schedulable
// to attach to — see /api/ext/track's header and taskfeed.js resolveStartable().
// It is mutually exclusive with blockId: when there IS a block, the block decides
// the project (the server looks it up and ignores any project_id sent alongside).
async function startTimer({ blockId = null, projectId = null, note = '', scheduledEnd = null, internalCategory = null, title = '' }) {
  const pid = blockId == null ? (projectId || null) : null;
  const key = timerKey(blockId, pid);
  // Already tracking this exact block (or this exact client)? No-op — don't
  // double-start / duplicate the entry. Mirrors the server's own dedup on `key`.
  if (await getTimerByKey(key)) return { timers: await getTimers(), started: false, reason: 'already_open' };
  // Client-side guard mirroring the server MAX_OPEN cap (4). Beyond it, refuse.
  const existing = await getTimers();
  if (existing.length >= 4) return { timers: existing, started: false, reason: 'cap' };

  const ts = nowIso();
  // internalCategory is only meaningful for genuinely unscoped internal time.
  // Client time never carries one — and a PROJECT-scoped timer is client time, so
  // the guard is "no block AND no project", not "no block".
  const category = blockId == null && pid == null ? (internalCategory || null) : null;
  const wasIdle = existing.length === 0;
  // The stored name goes through the same 200-character cap as `resume` (nameOf).
  await upsertTimer({ key, blockId, projectId: pid, startedAt: ts, note, entryId: null, scheduledEnd, internalCategory: category, title: nameOf(title) });
  if (wasIdle) {
    // First timer of a fresh session: reset the per-session scheduled-end flag map.
    await chrome.storage.local.set({ schedEndBlocks: {} });
  }
  await enqueue({
    kind: 'timer_start',
    ts,
    block_id: blockId,
    // ⛔ Only ever SENT on the project path. The server treats the mere PRESENCE of
    // the key as "this is targeted" on stop, and on start a project_id next to a
    // block_id is discarded in favour of the block's own row — sending it anyway
    // would be noise that reads like an instruction.
    ...(pid ? { project_id: pid } : {}),
    ...(note ? { note } : {}),
    ...(category ? { internal_category: category } : {}),
  });
  await refreshBadge();
  await armSchedEnd(scheduledEnd, blockId, title); // gate at this block's scheduled end (no-op if unscheduled)
  await flushQueue();              // immediate flush on start (reconciles entry ids)
  return { timers: await getTimers(), started: true };
}

// Stop ONE block. Other parallel blocks keep running.
//
// ⛔ AND CAPTURE IS NOT DISARMED BY THIS, at any block count. Stopping the last
// timer used to end the capture stream; under v0.11.0 the member is still signed
// in, so minutes keep being recorded — they simply stop carrying an entry id.
// Only the per-block scheduled-end alarms are torn down when the last block stops.
async function stopTimer(blockId, projectId = null, { entryId = null, key: askedKey = null } = {}) {
  const pid = blockId == null ? (projectId || null) : null;
  // ⛔ D4 (Rob, 2026-09-14): "Stopping a task stops only that task." A surface that
  // knows WHICH timer it drew passes that timer's key or entry id, and nothing else
  // is looked up. The block/project pair is kept only as the fallback for a message
  // from a surface that does not send either.
  const list = await getTimers();
  let t = null;
  if (entryId != null) t = list.find((x) => x.entryId != null && String(x.entryId) === String(entryId)) || null;
  if (!t && askedKey) t = list.find((x) => x.key === askedKey) || null;
  if (!t && entryId == null && !askedKey) t = list.find((x) => x.key === timerKey(blockId, pid)) || null;
  if (!t) return { timers: list, stopped: false };
  const key = t.key;
  // ⛔ THE CARD'S ID WINS OVER THE STORED ONE. The card was drawn from the server's
  // open entries a moment ago; the stored id can be stale — the same key stopped and
  // started again on another machine or profile leaves this worker holding the OLD
  // entry id, and nothing refreshed it. Lane W2b's server closes by entry id strictly:
  // an id that names no open entry closes NOTHING (reported `not_open`, no fallback
  // to the key). Sending the stale id would drop the local timer, report the stop as
  // done, and leave the real entry billing the client. So the id of the card the
  // member pressed is written onto the timer before the stop is queued.
  if (entryId != null && String(t.entryId) !== String(entryId)) {
    t = { ...t, entryId: String(entryId) };
    await upsertTimer(t);
  }
  // A stop that carries block_id / project_id closes BY KEY on both the current
  // server and lane W2b's; only a stop with no handle at all closes the member's
  // newest open entry. The entry id is what makes the stop exact under W2b, so a
  // timer whose id has not been reconciled yet (started a moment ago, or offline)
  // and was not handed one by its card gets one flush first to learn it.
  if (t.entryId == null) {
    await flushQueue();
    t = (await getTimers()).find((x) => x.key === key) || t;
  }
  const ts = nowIso();
  // Always send block_id (even null for internal) so the server closes THIS entry,
  // not an arbitrary open one.
  //
  // ⛔ AND SEND project_id ON THE PROJECT PATH. A project timer must be stoppable
  // by the same handle it was started with: `{block_id:null}` alone keys to
  // `__internal__` server-side, so without this a Stop on a client card would have
  // closed the member's INTERNAL entry — wrong duration, wrong client, silently.
  // The block/project handle is still sent beside the id so an older server that
  // closes by key keeps closing the right entry during the rollout.
  const tBlock = t.blockId ?? null;
  const tProject = tBlock == null ? (t.projectId ?? null) : null;
  await enqueue({
    kind: 'timer_stop',
    ts,
    block_id: tBlock,
    ...(tProject ? { project_id: tProject } : {}),
    ...((entryId ?? t.entryId) != null ? { entry_id: String(entryId ?? t.entryId) } : {}),
  });
  await clearSchedEndForKey(key);  // drop this block's overdue flag + alarm
  const remaining = await removeTimer(key);

  if (remaining.length === 0) {
    // Last block stopped — clear any remaining per-block scheduled-end alarms/flags.
    await disarmTracking();
    // ⛔ REPAINT ONLY. Stopping the last timer no longer makes the content
    // scripts inert — that was the v0.6.0-and-earlier meaning of this line, when
    // the capture gate WAS the timer. Under v0.11.0 capture keeps running because
    // the member is still signed in, and `captureOn` is not touched here.
    await refreshBadge();
    await chrome.storage.local.set({ schedEndBlocks: {} });
  } else {
    await refreshBadge();          // still running other blocks — repaint (green/amber)
  }
  await flushQueue();              // immediate flush (sends the timer_stop)
  return { timers: remaining, stopped: true };
}

// Change the internal-work category on the running (no-block) internal timer.
// Persists locally and enqueues a `set_category` event so the backend updates the
// open internal entry's internal_category.
async function setTimerCategory(category) {
  const t = await getTimerByKey(INTERNAL_KEY);
  if (!t) return { timers: await getTimers() }; // only the internal timer carries a category
  const cat = category || null;
  await upsertTimer({ ...t, internalCategory: cat });
  await enqueue({ kind: 'set_category', ts: nowIso(), internal_category: cat });
  await flushQueue();
  return { timers: await getTimers() };
}

/**
 * The longest name a stored timer keeps, in characters (code points). 0.11.4 fix
 * round 1 (Opus, 2026-10-02): a 2,000,000-character project name was stored whole.
 */
const STORED_NAME_MAX = 200;

/**
 * A name worth storing: a trimmed, non-empty string of at most STORED_NAME_MAX
 * characters, cut by code point so no surrogate pair is split; '' for anything else.
 */
function nameOf(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  // A string this short cannot hold more code points than the cap.
  if (s.length <= STORED_NAME_MAX) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    if (n === STORED_NAME_MAX) break;
    out += ch;
    n += 1;
  }
  return out.trim();
}

// Server reports open entries we aren't locally tracking (fresh install / new
// machine / SW evicted). Adopt the FULL set WITHOUT emitting timer_start events.
// `openEntries` is the server's open_entries array; the popup attaches a resolved
// `scheduledEnd`/`title` to each from its block list before sending.
//
// ⛔ 0.11.4 — A RUNNING TIMER KEEPS ITS NAME (SPEC-tracker-0.11.4 §2.4; Shezan,
// 2026-10-02). The server's open entries carry no title, and the popup can only
// resolve one for an entry that has a calendar block. So for a client timer with
// no block this used to store `title: ''` over the name Start had given it, and
// the side panel and the pop-out — which read these stored timers and nothing
// else — showed "Unscheduled work" for every one of them.
//
//   title        what the popup resolved (the block's title), else the title
//                ALREADY STORED for the same entry, else ''. A stored non-empty
//                title is never replaced by an empty one.
//   projectName  the server's `project_name` for the entry (new with 0.11.4 on
//                /api/ext/blocks open_entries), else the one already stored for
//                the same entry, else null. An older server sends none.
//
// "The same entry" is common.js storedTimerFor(): the same entry id, or the same
// key while the stored timer has no id yet. A stored timer under a DIFFERENT id is
// a different timer and lends its name to nothing.
async function resumeTimer(openEntries) {
  const list = Array.isArray(openEntries) ? openEntries : [openEntries].filter(Boolean);
  const stored = await getTimers();
  const timers = list.map((oe) => {
    const blockId = oe.calendar_block_id ?? null;
    // A block-less entry that carries a project is CLIENT time, not internal time:
    // it gets its own `project:<uuid>` slot and never an internal category.
    const projectId = blockId == null ? (oe.project_id ?? null) : null;
    const key = timerKey(blockId, projectId);
    const prev = storedTimerFor(stored, { entryId: oe.id ?? null, key });
    return {
      key,
      blockId,
      projectId,
      startedAt: oe.started_at,
      note: oe.note || '',
      entryId: oe.id ?? null,
      scheduledEnd: oe.scheduledEnd ?? oe.scheduled_end ?? null,
      internalCategory: blockId == null && projectId == null ? (oe.internal_category ?? null) : null,
      title: nameOf(oe.title) || nameOf(prev && prev.title),
      projectName: nameOf(oe.project_name) || nameOf(prev && prev.projectName) || null,
    };
  });
  await setTimers(timers);
  await refreshBadge();
  await rearmAllSchedEnds();        // re-gate every block on its scheduled end
  return { timers: await getTimers() };
}

// 0.11.4 — record the server's `project_name` on timers this worker is ALREADY
// tracking, and touch nothing else.
//
// The popup is the only surface that reads /api/ext/blocks; the side panel and the
// pop-out read the stored timers. When the popup's view of the open entries already
// matches the worker's (no `resume`), a timer whose stored title is empty — one
// adopted by a build before 0.11.4, which wiped it — would show its project's name
// in the popup and a bare fallback in the panel. This is how the name reaches the
// panel: the popup hands over the server's open entries, and each stored timer for
// the same entry (storedTimerFor) takes that entry's name. Entry ids, keys, clocks,
// notes, categories and titles are not written, and when no name changes nothing
// is written at all, so a repeat call costs no storage event.
async function recordTimerNames(openEntries) {
  const list = Array.isArray(openEntries) ? openEntries.filter((oe) => oe && typeof oe === 'object') : [];
  const stored = await getTimers();
  let changed = false;
  const next = stored.slice();
  for (const oe of list) {
    const name = nameOf(oe.project_name);
    if (!name) continue;
    const blockId = oe.calendar_block_id ?? null;
    const projectId = blockId == null ? (oe.project_id ?? null) : null;
    const t = storedTimerFor(next, { entryId: oe.id ?? null, key: timerKey(blockId, projectId) });
    if (!t || t.projectName === name) continue;
    next[next.indexOf(t)] = { ...t, projectName: name };
    changed = true;
  }
  if (changed) await setTimers(next);
  return { timers: changed ? next : stored };
}

// Server says nothing is open but we think we're running (stopped elsewhere).
// Tear down locally without emitting a timer_stop (the entries are already closed).
async function resetTimer() {
  await disarmTracking();
  await clearTimers();
  await refreshBadge();
  await chrome.storage.local.set({ schedEndBlocks: {} }); // clear the overdue flags
  return { timers: [] };
}

// ---------------------------------------------------------------- screenshots
// v0.6.0 phase-2 shrink: the always-on captureScreenshot() (start/stop/domain/
// tab_switch/segment_shot/burst reasons) and its IndexedDB upload queue were
// removed. downscaleJpeg/downscaleViaOffscreen/blobToBase64/ensureOffscreen survive
// because the QA-capture mode's qaCaptureShot() (below) still uses them for its own
// click-triggered screenshots.
async function downscaleJpeg(dataUrl, maxWidth, quality) {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    return downscaleViaOffscreen(dataUrl, maxWidth, quality);
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });
  return blobToBase64(out);
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// The single offscreen document builds/downloads the QA .zip (URL.createObjectURL) and
// is the canvas-downscale fallback when OffscreenCanvas is unavailable in this worker.
let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    // BLOBS covers the zip download (URL.createObjectURL). The QA-capture mic recorder
    // was removed in v0.5.0 (narration lives in the paired Loom video), so USER_MEDIA is
    // no longer needed. `reasons` MUST be valid chrome.offscreen.Reason enum values — a
    // bogus reason aborts createDocument, which previously broke the zip build.
    creatingOffscreen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Bundle QA-walkthrough screenshots into a downloadable .zip and downscale screenshots outside the service worker.',
    });
  }
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function downscaleViaOffscreen(dataUrl, maxWidth, quality) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'downscale',
    dataUrl,
    maxWidth,
    quality,
  });
  return r && r.base64;
}

// ---------------------------------------------------------------- reconcile on wake
// v0.6.0 phase-2 shrink: onTabSwitch() (posted `tab_switch` events to /track and
// triggered domain/burst screenshots) was removed along with the always-on capture
// stream. reconcile() no longer re-arms alarms or flushes activity/screenshots —
// only the scheduled-end gate and the /track queue (timer_start/stop/set_category)
// survive.
async function reconcile() {
  // ⛔ CAPTURE IS RECONSTRUCTED FIRST, AND UNCONDITIONALLY. It does not depend on
  // a timer being open, so it cannot live inside the branch below — that was the
  // shape of the old always-on layer and it is exactly what this release changes.
  await armCaptureAlarms();
  await applyCaptureState(await getCapture()); // republish `captureOn` + repaint
  if (await anyTimerOpen()) {
    await rearmAllSchedEnds(); // re-arm/flag every open block after a cold restart
    await flushQueue();    // drain anything buffered while the worker was asleep
  }
  await refreshBadge();
  // Validate at service-worker start (throttled to the 4h window by shouldValidate).
  validateToken().catch(() => {});
  // 0.11.5: a newer build on disk? Last, so a reload never cuts across this wake's
  // flush above. Every worker start runs this; the alarm covers a worker that stays up.
  await armSelfReloadAlarm();
  await checkDiskForUpdate();
}

// ================================================================ QA-CAPTURE MODE
// A distinct capture flow from the proof layer above. State lives in storage under
// `qaCapture` (see common.js getQa/setQa). Screenshots go to the QA_SHOT_STORE
// IndexedDB store; the mic + zip build/download run in the offscreen document. None
// of this hits the server — the finished bundle is downloaded as a local .zip.

async function qaShotPut(rec) {
  const db = await idb();
  const tx = db.transaction(QA_SHOT_STORE, 'readwrite');
  tx.objectStore(QA_SHOT_STORE).put(rec);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Wipe both QA IndexedDB stores — used when starting a brand-new capture (Resume
// re-uses the existing data instead of clearing).
async function qaClearStores() {
  const db = await idb();
  const tx = db.transaction([QA_SHOT_STORE, QA_AUDIO_STORE], 'readwrite');
  tx.objectStore(QA_SHOT_STORE).clear();
  tx.objectStore(QA_AUDIO_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Start (or resume) a QA-capture session. `resume:true` re-activates the persisted
// session (Resume-Append); otherwise a fresh session is created, discarding any prior
// bundle. Sets `qaRunning` (content.js watches it to send per-click shots). SILENT — the
// extension records no audio. A paired Loom recording is OPTIONAL (2026-07-22): if the
// rep records one, it supplies the video + narration; if not, the screenshots + the
// completeness Q&A in Claude Code are sufficient on their own to finalize.
// On a fresh start we mint an upload_token (written into the bundle's meta.json) that
// authorizes an optional Loom/self-demo re-host later, IF one ever gets attached.
async function qaStart({ blockId = null, blockTitle = '', email = '', resume = false } = {}) {
  const existing = await getQa();
  if (resume && existing.hasSession) {
    await setQa({ active: true, ended_at: null });
  } else {
    await qaClearStores();
    await setQa({
      hasSession: true,
      active: true,
      block_id: blockId ?? null,
      block_title: blockTitle || '',
      deliverable_type: deliverableTypeFromTitle(blockTitle),
      client_hint: clientHintFromTitle(blockTitle),
      captured_by_email: email || '',
      started_at: nowIso(),
      ended_at: null,
      shotCount: 0,
      urls: [],
      lastShotTs: 0,
      upload_token: null,
      upload_token_expires_at: null,
      upload_token_error: null,
    });

    // Mint the Loom video upload token (for the qa-doc-generator skill). Best-effort:
    // a failed mint degrades — clicks/screenshots still capture, meta.json just carries
    // no token and the skill notes it as absent.
    const t = await mintQaUploadToken(blockId);
    await setQa({
      upload_token: t.upload_token || null,
      upload_token_expires_at: t.expires_at || null,
      upload_token_error: t.error || null,
    });
  }
  await chrome.storage.local.set({ qaRunning: true });
  await injectExistingTabs(); // ensure content.js is live in already-open tabs to send click-shots
  return getQa();
}

// One click-triggered QA screenshot. Throttled SW-side so a burst of clicks (and the
// captureVisibleTab rate limit) can't stack. Appends to QA_SHOT_STORE + urls.json.
async function qaCaptureShot() {
  const cap = await getQa();
  if (!cap.active) return;
  const now = Date.now();
  if (now - (cap.lastShotTs || 0) < QA.SHOT_GAP_MS) return;
  // Reserve the throttle slot immediately so concurrent clicks don't double-fire.
  await setQa({ lastShotTs: now });

  const tab = await activeTab();
  if (!tab) return;
  const url = tab.url || '';
  if (!/^https?:\/\//i.test(url)) return; // chrome://, file://, etc. are not capturable

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: QA.JPEG_QUALITY });
  } catch (e) {
    return; // restricted page / no focused window / rate-limited — skip this click
  }
  if (!dataUrl) return;

  let image_base64;
  try {
    image_base64 = await downscaleJpeg(dataUrl, QA.MAX_WIDTH, QA.JPEG_QUALITY);
  } catch (e) {
    image_base64 = dataUrl.split(',')[1];
  }
  if (!image_base64) return;

  // Re-read to get the freshest shotCount/urls, then append atomically-ish.
  const fresh = await getQa();
  if (!fresh.active) return;
  const seq = (fresh.shotCount || 0) + 1;
  try {
    await qaShotPut({ seq, ts_ms: now, url, title: tab.title || '', jpeg_base64: image_base64 });
  } catch (e) {
    return; // IndexedDB unavailable — drop this shot rather than desync the counter
  }
  const urls = Array.isArray(fresh.urls) ? fresh.urls.slice() : [];
  urls.push({ ts_ms: now, url, title: tab.title || '' });
  await setQa({ shotCount: seq, urls });
}

// Build + download the .zip for the current (finished) session WITHOUT touching the
// active/ended state. Used by both qaFinish and the standalone `qaExport` message (the
// guidance card's "Download .zip again"). meta.json carries the Loom upload_token so the
// qa-doc-generator skill can upload the paired Loom video into the project.
async function qaExportZip() {
  const c2 = await getQa();
  if (!c2.hasSession) return { ok: false, error: 'no_session' };
  const meta = {
    deliverable_type: c2.deliverable_type,
    client_hint: c2.client_hint,
    block_id: c2.block_id,
    captured_by_email: c2.captured_by_email,
    started_at: c2.started_at,
    ended_at: c2.ended_at,
    // Loom pairing — the skill uploads the full Loom video with this token. Null when
    // the mint failed at start (upload_token_error carries the reason so the skill can
    // degrade and tell the rep to re-mint / upload manually).
    upload_token: c2.upload_token || null,
    upload_token_expires_at: c2.upload_token_expires_at || null,
    upload_token_error: c2.upload_token_error || null,
  };
  const filename = `qa-capture-${c2.block_id || 'unscheduled'}-${Date.now()}.zip`;

  // The zip is assembled INSIDE the offscreen document (it holds the ZIP writer, reads
  // the screenshots straight from QA_SHOT_STORE in IndexedDB, and triggers the download).
  // Make sure that document exists before messaging it — MV3 can tear it down between
  // qaStart and qaFinish, and a missing offscreen is exactly the "Receiving end does not
  // exist" failure the rep hit on Stop. ensureOffscreen() (re)creates it if needed; the
  // build then sources shots from the persisted store, so a dead tab context can't
  // strand the shots + URLs already recorded.
  let build;
  try {
    await ensureOffscreen();
    build = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'qa-build-zip',
      meta,
      urls: c2.urls || [],
      filename,
    });
  } catch (e) {
    build = { ok: false, error: String((e && e.message) || e) };
  }
  return {
    ok: !!(build && build.ok),
    filename: (build && build.filename) || filename,
    shots: c2.shotCount || 0,
    block_id: c2.block_id ?? null,
    upload_token_error: c2.upload_token_error || null,
    error: build && build.error,
  };
}

// Finish (Stop) the current capture: stop click-shots, then export + download the .zip.
// Data is KEPT (hasSession stays true) so the rep can "Keep going" (Resume-Append) and
// re-export a superset later. No audio — if a Loom was recorded alongside this, it
// supplies narration; if not, the completeness Q&A supplies it instead.
async function qaFinish() {
  const cap = await getQa();
  if (!cap.hasSession) return { ok: false, error: 'no_session' };
  await setQa({ active: false, ended_at: nowIso() });
  await chrome.storage.local.set({ qaRunning: false });
  return qaExportZip();
}

// ---------------------------------------------------------------- pop-out relay
// ⛔ The side panel CANNOT open a floating window — Document Picture-in-Picture
// needs a top-level document with transient user activation, and a side panel is
// neither. (v0.7.0's button feature-detected the API's PRESENCE, which is true in
// a side panel, so it rendered a control that could never work.) The call is
// therefore routed to a content script in the active tab, where a real click on
// the page supplies the activation. This worker's only job is to find an
// eligible tab, make sure the content script is actually in it, and forward.

/** Pages where no extension content script can run, so no pop-out can be hosted. */
function isRestrictedUrl(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return true;              // chrome://, file://, about:, devtools://
  if (/^https:\/\/chromewebstore\.google\.com\//i.test(u)) return true;
  if (/^https:\/\/chrome\.google\.com\/webstore/i.test(u)) return true;
  return false;
}

async function activeHostTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return { ok: false, reason: 'no_tab' };
  if (isRestrictedUrl(tab.url)) return { ok: false, reason: 'restricted' };
  return { ok: true, tab };
}

/**
 * Make sure content.js is live in this tab. It is declared at document_start,
 * but a tab that was already open when the extension loaded/reloaded has none —
 * that tab is exactly where someone will click "pop out". The script guards
 * itself with `__mmTtContentLoaded`, so a double injection is a no-op.
 */
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'mmPopoutProbe' });
    if (r && typeof r.ok === 'boolean') return r.ok;
  } catch (e) { /* not injected yet — fall through */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const r = await chrome.tabs.sendMessage(tabId, { type: 'mmPopoutProbe' });
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

/** Can a pop-out be opened RIGHT NOW? Never "does the API exist". */
async function popoutProbe() {
  const found = await activeHostTab();
  if (!found.ok) return found;
  const ok = await ensureContentScript(found.tab.id);
  return ok ? { ok: true, tabId: found.tab.id } : { ok: false, reason: 'restricted' };
}

/** Put the click target on the page. The user's click there does the rest. */
async function popoutArm() {
  const found = await activeHostTab();
  if (!found.ok) return found;
  const ready = await ensureContentScript(found.tab.id);
  if (!ready) return { ok: false, reason: 'restricted' };
  try {
    const r = await chrome.tabs.sendMessage(found.tab.id, { type: 'mmPopoutArm' });
    return r || { ok: false, reason: 'no_tab' };
  } catch (e) {
    return { ok: false, reason: 'no_tab' };
  }
}

// ---------------------------------------------------------------- listeners
// `chrome-extension://<id>/` — the prefix of every page this extension serves.
const OWN_PAGES = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return false; // not addressed to the worker
  // ⛔ F6 HARDENING (0.11.2): A SUB-FRAME MAY SEND ONLY ITS INPUT COUNTS. content.js
  // now runs in every frame of every page, third-party iframes included, and a
  // sub-frame's one legitimate message is mm_subframe_input. Anything else from a
  // content script in a sub-frame is dropped right here: nothing handled, no
  // response, nothing stored. Top frames and the extension's own pages (popup,
  // side panel, options, and the pop-out, which is an iframe in its own tab) are
  // not sub-frame content scripts and go through exactly as before. The whole
  // decision is isContentSubframeSender() in capture.js.
  if (isContentSubframeSender(sender, OWN_PAGES) && msg.type !== SUBFRAME_INPUT_TYPE) return false;
  (async () => {
    try {
      switch (msg.type) {
        case 'start': {
          // Thread scheduledEnd + title through so the block's end-of-block gate and
          // the early-vs-QA Stop branch work on the SAME popup session as the start.
          const r = await startTimer({ blockId: msg.blockId ?? null, projectId: msg.projectId ?? null, note: msg.note || '', scheduledEnd: msg.scheduledEnd ?? null, internalCategory: msg.internalCategory ?? null, title: msg.title || '' });
          sendResponse({ ok: r.started !== false, ...r });
          break;
        }
        case 'stop':
          sendResponse({ ok: true, ...(await stopTimer(msg.blockId ?? null, msg.projectId ?? null, { entryId: msg.entryId ?? null, key: msg.key ?? null })) });
          break;
        case 'setCategory':
          sendResponse({ ok: true, ...(await setTimerCategory(msg.category ?? null)) });
          break;
        case 'resume':
          sendResponse({ ok: true, ...(await resumeTimer(msg.openEntries ?? msg.openEntry)) });
          break;
        case 'timerNames':
          sendResponse({ ok: true, ...(await recordTimerNames(msg.openEntries)) });
          break;
        case 'reset':
          sendResponse({ ok: true, ...(await resetTimer()) });
          break;
        case 'flush':
          await flushQueue();
          sendResponse({ ok: true });
          break;
        case 'getState':
          sendResponse({ ok: true, timers: await getTimers() });
          break;
        case 'qaStart':
          sendResponse({
            ok: true,
            qa: await qaStart({ blockId: msg.blockId ?? null, blockTitle: msg.blockTitle || '', email: msg.email || '', resume: !!msg.resume }),
          });
          break;
        case 'qaClickShot':
          // Fire-and-forget: the content script doesn't wait on the capture.
          qaCaptureShot().catch(() => {});
          sendResponse({ ok: true });
          break;
        case 'qaStatus':
          sendResponse({ ok: true, qa: await getQa() });
          break;
        case 'qaFinish':
          sendResponse(await qaFinish());
          break;
        case 'qaExport':
          // Re-export the current (finished) session's .zip — no state change.
          sendResponse(await qaExportZip());
          break;
        case 'popoutProbe':
          sendResponse(await popoutProbe());
          break;
        case 'popoutArm':
          sendResponse(await popoutArm());
          break;
        // ── continuous capture ──────────────────────────────────────────────
        case 'activity':
          // A closed per-minute bucket from a content script. Buffered, never
          // posted inline: the SW is woken by this message and a network call
          // here would put a fetch on the hot path of every minute of every tab.
          await enqueueActivity(msg.bucket);
          sendResponse({ ok: true });
          break;
        case SUBFRAME_INPUT_TYPE: {
          // ⛔ F6 (0.11.2) — A SUB-FRAME'S INPUT, RELAYED TO ITS TAB'S TOP FRAME.
          // A sub-frame keeps no minute of its own; its counts belong to the top
          // frame's current bucket, and only the worker can address that frame.
          // subframeRelay() (capture.js) rebuilds the message from the six counts
          // and the timestamp alone, so nothing else a sub-frame put on it can
          // travel on, and returns null for a message with no tab or one from
          // frameId 0. Nothing here is stored or posted.
          const relay = subframeRelay(msg, sender);
          if (relay) {
            try {
              await chrome.tabs.sendMessage(relay.tabId, relay.message, relay.options);
            } catch (e) { /* the tab closed, or its top frame has no content script yet */ }
          }
          sendResponse({ ok: !!relay });
          break;
        }
        case 'captureState':
          sendResponse({ ok: true, capture: await getCapture(), gate: captureGate(await getCapture()) });
          break;
        case 'captureAcknowledge': {
          // ⛔ THE ONLY THING THAT STARTS CAPTURE. Until this lands, captureGate()
          // returns not_acknowledged and `captureOn` is false in every tab.
          const state = await setCapture(applyAcknowledged(await getCapture(), nowIso()));
          // The acknowledgement is the answer the notification was asking for, so
          // the notification goes with it — before the repaint, so a member never
          // sees a blank badge next to a notification still saying "not started".
          try { chrome.notifications.clear(NOTICE_PENDING_NOTIFICATION_ID); } catch (e) { /* ignore */ }
          await applyCaptureState(state);
          sendResponse({ ok: true, capture: state });
          break;
        }
        case 'capturePause': {
          const state = await setCapture(applyPaused(await getCapture(), !!msg.paused));
          await applyCaptureState(state);
          sendResponse({ ok: true, capture: state });
          break;
        }
        case 'captureValidate':
          sendResponse({ ok: true, capture: await validateToken({ force: true }) });
          break;
        case 'authConfirmed':
          // ⛔ A SIGN-IN THE OPTIONS PAGE ALREADY PROVED — NOT A REQUEST TO PROVE ONE.
          //
          // The defect: options.js connect() called setConfig and nothing else,
          // and the only thing that ever woke this worker about auth was the
          // AUTH_FAILURE_KEY watcher, which fires on a 401 and on nothing else.
          // So a member who took a 401, pasted a fresh token and connected
          // successfully left `signedIn: false, signedOutReason: '401'` sitting in
          // storage — the red badge stayed red, capture stayed stopped, and the
          // next Settings open told them in red that the server had refused the
          // token they had just been told worked. Up to four hours, until the
          // scheduled re-validation happened to run.
          //
          // ⛔ AND IT IS NOT `captureValidate`. That forces a fresh POST to
          // /api/ext/auth — a second identical round trip, moments after the one
          // whose 200 is the entire reason we are here. This message carries that
          // result instead. onSignedIn() is the same transition the 4-hourly check
          // takes, with the same edge guard: a routine re-connect by somebody who
          // was already signed in returns early and fires no notification.
          //
          // It is still the WORKER that records the sign-in. The options page
          // never writes capture state — one writer, as everywhere else.
          sendResponse({ ok: true, capture: await onSignedIn() });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown_type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // async response
});

// v0.6.0's A_HEARTBEAT/A_SEGMENT/A_SEGMENT_SHOT/A_BURST/A_SHOT_RETRY are still
// gone with the screenshot layer. v0.11.0 adds back exactly two: the activity
// flush and the token re-validation, both on the CAPTURE gate rather than a timer.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Per-block scheduled-end alarm (`sched_end:<key>`). The block's scheduled window
  // just closed — badge/notify for THAT block; never auto-stop.
  if (alarm.name && alarm.name.indexOf(A_SCHED_END + ':') === 0) {
    const key = alarm.name.slice((A_SCHED_END + ':').length);
    const t = await getTimerByKey(key);
    if (t && t.blockId) await markSchedEndReached(key, t.title);
    return;
  }
  if (alarm.name === A_ACTIVITY) {
    // Sweep the tabs first so a minute that closed while the worker was asleep is
    // in the queue before it is drained, then send.
    await collectPendingRows();
    await flushActivity();
    await flushQueue();
    return;
  }
  if (alarm.name === A_TOKEN_CHECK) {
    await validateToken();
    return;
  }
  if (alarm.name === SELF_RELOAD.ALARM) {
    await checkDiskForUpdate();
  }
});

// ---------------------------------------------------------------- the 401 watcher
// apiFetch() stamps AUTH_FAILURE_KEY whenever a call made with the STORED token
// comes back 401 — from any surface, including the popup and the side panel.
//
// ⛔ WHY A STORAGE FLAG RATHER THAN A THROW HANDLER AT EVERY CALL SITE. There are
// ~30 authenticated calls across four documents plus this worker. A per-call-site
// handler is ~30 places to forget, and the one that gets forgotten is the one that
// runs on the machine of the member whose token was revoked. One stamp inside
// apiFetch(), one listener here, and the sign-out is noticed no matter which
// surface hit the wall first.
//
// ⛔ AND IT IS FLOORED AT 60 SECONDS. validateToken() has its own re-entrancy
// flag, which stops the synchronous cycle; this floor stops the slower one. A
// revoked token makes EVERY authenticated call 401 — the blocks poll, the health
// fetch, a queue flush — and each of those raises the flag again after the
// previous validation has already returned and cleared its flag. Without the
// floor, one rotated token turns into a steady stream of /api/ext/auth calls from
// that machine for as long as Chrome is open.
//
// A minute is far tighter than anything downstream needs: the states this
// notices are measured in hours (the 4-hourly re-validation) and days (the 72h
// stale threshold).
const FLAG_VALIDATE_FLOOR_MS = 60 * 1000;
let lastFlagValidateAt = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[AUTH_FAILURE_KEY]) return;
  const raised = changes[AUTH_FAILURE_KEY].newValue;
  if (!raised) return; // cleared, not raised
  // ⛔ A 401 ON /api/ext/auth IS THE VALIDATION ITSELF ANSWERING. Acting on it
  // would be this listener reacting to the request it just caused.
  if (raised.path === '/api/ext/auth') return;
  const now = Date.now();
  if (now - lastFlagValidateAt < FLAG_VALIDATE_FLOOR_MS) return;
  lastFlagValidateAt = now;
  // Re-validate rather than trusting the flag: a single 401 from a route with its
  // own authorization rules (the PM routes 401/403 for a non-PM) is not proof the
  // identity token is dead. validateToken() asks /api/ext/auth, which is.
  validateToken({ force: true }).catch(() => {});
});

// ---------------------------------------------------------------- notification click
// "Open the extension to sign back in." — so the click opens the extension, at the
// step where the token is entered. chrome.action.openPopup() is Chrome 127+ and
// can refuse (no focused window, a policy, an older build), so the options page —
// which IS the token form — is the fallback rather than a dead click.
//
// v0.11.1: the notice-pending notification says "Open the extension" too, and the
// popup is where the notice card is mounted, so it takes the same path. The
// options-page fallback is less useful for it (the card is not there) but is
// still the extension rather than a dead click.
chrome.notifications.onClicked.addListener(async (id) => {
  if (id !== SIGNED_OUT_NOTIFICATION_ID && id !== NOTICE_PENDING_NOTIFICATION_ID) return;
  try {
    if (chrome.action && chrome.action.openPopup) {
      await chrome.action.openPopup();
      return;
    }
  } catch (e) { /* fall through */ }
  try { await chrome.runtime.openOptionsPage(); } catch (e) { /* nothing left to try */ }
});

// Backfill content.js into tabs that finish loading mid-session (extension reload,
// restored tabs, etc). content.js's only remaining job is the QA-capture click-shot
// trigger, gated on qaRunning — this just makes sure it's present so a QA-capture
// walkthrough can screenshot clicks in a freshly-loaded tab. Not gated on
// anyTimerOpen(): QA capture starts AFTER a timer stops, so that gate would skip
// exactly the tabs a capture session needs.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  await injectContentScript(tabId, tab.url || '');
});

// Inject content.js into every already-open http/https tab the moment the extension
// loads (install/update + browser startup) — the declared content_scripts entry only
// auto-injects on navigation-after-load, so tabs open before the extension loaded
// would otherwise have no content script. This matters if a QA-capture session was
// still active across the restart (qaRunning persists in storage): content.js
// self-guards and stays inert until qaRunning flips true, so this is a safe no-op
// the rest of the time.
chrome.runtime.onStartup.addListener(() => { reconcile(); injectExistingTabs(); });
chrome.runtime.onInstalled.addListener(() => { reconcile(); injectExistingTabs(); });

// I1 (v0.11.2): make sure this install has its random id on every worker start,
// before the reconcile below makes its first API call. Reads the stored id and
// never regenerates it; writes one only when none is stored. Never throws and is
// not awaited — apiRequest() ensures the id itself, and a failure here only means
// the next request goes out without the install headers (common.js, "install id").
ensureInstallId().catch(() => {});

// Re-establish state on every cold worker spin-up.
reconcile();
