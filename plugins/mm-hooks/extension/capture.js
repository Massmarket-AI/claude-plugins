// capture.js — the continuous-capture gate, its copy, and its state machine.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHAT THIS FILE IS, AND WHY IT IS PURE.
//
// v0.11.0 turns browser capture back on — but not the way v0.6.0 turned it off.
// The old always-on layer was gated on "a timer is running": press Start and it
// recorded, press Stop and it stopped. That gate is gone. The new gate is
// SIGNED IN + ACKNOWLEDGED + NOT PAUSED, and the timer has nothing to do with
// it. A member logs in once and their day is recorded; the timer only decides
// which `time_entry` a minute is attached to, never whether the minute exists.
//
// Every predicate that decides whether a byte is recorded lives HERE, in
// functions that take their inputs as arguments and touch no `chrome.*` at
// module scope. That is deliberate and it is the whole reason this file exists
// separately from background.js:
//
//   * the decision is testable under plain `node --test` (verify/*.test.mjs),
//     with no Chromium, no service worker and no stubbed storage bus;
//   * there is ONE implementation of it, so the popup, the side panel, the
//     content script and the service worker cannot disagree about whether
//     capture is on;
//   * and a reviewer can read the entire privacy-relevant surface in one file
//     instead of tracing it through 39 KB of service worker.
//
// ⛔ DO NOT ADD A `chrome.*` CALL AT MODULE SCOPE. Storage accessors below are
// async functions that reach for chrome INSIDE the call, so importing this
// module under node is safe. An import-time chrome reference would break the
// test surface, and the test surface is the only thing standing between this
// gate and a repeat of v0.10.0 — a privacy control that passed its own tests
// while telling members the opposite of the truth.
// ═════════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────── the notice
//
// ⛔ NOTICE_BODY IS VERBATIM AND IS NOT AN EXECUTOR'S TO EDIT. Not the wording,
// not the punctuation, not the sentence order. It is the entire statement a
// member is shown before anything is recorded, and it is the sentence they will
// be held to. Same rule as CONSENT_COPY in consentcard.js: if a string here has
// to change, that is a decision for the person who owns the copy.
export const CAPTURE_NOTICE = Object.freeze({
  body:
    'While you are signed in on this browser profile, Massmarket Time Tracker records the web address and page title of the tab you are working in, how long it is active or idle, and how many times you clicked, typed, scrolled or pasted in each minute, so your hours land on the right client without you clicking anything. It never records which keys you pressed, what you typed, or what you copied. It records nothing at all while you are signed out or paused. No screenshots, no other apps, and nothing outside this profile.',
  button: 'I understand, start capture',
});

// ⛔ BOTH NOTIFICATION STRINGS ARE VERBATIM. They are the only thing a member
// sees when their hours stop being recorded, so a "clearer" rewrite here is a
// silent change to the one message that has to land.
export const SIGNED_OUT_NOTIFICATION = Object.freeze({
  title: 'Massmarket Time Tracker — signed out',
  body: 'Your hours are not being recorded on this profile. Open the extension to sign back in.',
});

export const SIGNED_IN_NOTIFICATION = Object.freeze({
  message: 'Signed in — capture resumed.',
});

// ⛔ OPUS_TO_REVIEW (0.11.1) — NOT YET APPROVED COPY. The two objects below are
// the third thing a member is told without opening a surface: the toolbar badge
// and the one notification fired while the notice is still unacknowledged. They
// are the shortest neutral phrasing the executor could find, flagged for Rob's
// sign-off, and once signed off they carry exactly the rule the two objects above
// carry — verbatim, frozen, not an executor's to reword. They live here, beside
// the gate they describe, so the strings and the state can never be reviewed in
// two places. The test pins them character-for-character.
export const NOTICE_PENDING_NOTIFICATION = Object.freeze({
  title: 'Massmarket Time Tracker — capture not started',
  body: 'Open the extension to review what is recorded and start capture.',
});

/**
 * The badge while the notice is unacknowledged. Amber, not red: red is
 * `signed_out`, which is a failure; this is a question the member has not yet
 * answered, and panel.css already gives that family of surfaces amber.
 */
export const NOTICE_PENDING_BADGE = Object.freeze({ text: '?', color: '#f79009' });

/**
 * Bumping this re-asks the notice on the next run.
 *
 * ⛔ THE ACKNOWLEDGEMENT IS PER PROFILE AND PER VERSION, and the version half is
 * what makes "on first run after this update AND on every fresh install" one
 * rule rather than two. A fresh install has no stored version (capture starts
 * gated); an upgrade from 0.10.x has no stored version either, because the key
 * did not exist — so both land in the same branch and both see the notice.
 */
export const NOTICE_VERSION = 2;

// ────────────────────────────────────────────────────────────────── constants
export const CAPTURE = Object.freeze({
  /** No click/key/scroll/paste for this long ⇒ the bucket is flagged idle. */
  IDLE_MS: 5 * 60 * 1000,
  /** Minutes between /track flushes of the buffered activity rows. */
  FLUSH_MIN: 1,
  /** Hours between proactive token validations while signed in. */
  VALIDATE_HOURS: 4,
  /** At most one signed-out notification per this window while still signed out. */
  RENOTIFY_MS: 24 * 60 * 60 * 1000,
  /** Buffered activity rows kept in storage before the oldest are dropped. */
  MAX_ROWS: 500,
  /** Rows per /track POST. Mirrors the server's own 300-row cap. */
  BATCH_ROWS: 300,
  /** Max click offsets recorded per bucket (counts, never positions of content). */
  CLICK_DELTA_CAP: 120,
  /**
   * F7 (0.11.2): idle MINUTES a tab sends rows for, in a row, before it stops
   * sending them until the next real input. content.js inlines this value.
   */
  IDLE_ROW_CAP: 60,
  /**
   * F6 (0.11.2): a sub-frame forwards its input counts at most once per this
   * window while input is happening. content.js inlines this value.
   */
  SUBFRAME_BATCH_MS: 2000,
  /**
   * F6 (0.11.2): in a sub-frame, a scroll counts only this soon after a real
   * wheel, touch, pointerdown or scrolling key in that frame, so a widget that
   * scrolls itself cannot keep a tab active. content.js inlines this value.
   */
  SUBFRAME_SCROLL_INTENT_MS: 3000,
});

/** chrome.storage.local key holding the whole capture state object. */
export const CAPTURE_KEY = 'capture';
/** chrome.storage.local key the content script watches. Boolean: record or not. */
export const CAPTURE_ON_KEY = 'captureOn';
/** chrome.storage.local key apiFetch() stamps when a stored-token call 401s. */
export const AUTH_FAILURE_KEY = 'authFailure';
/** chrome.storage.local key holding buffered per-minute rows awaiting /track. */
export const ACTIVITY_QUEUE_KEY = 'activityQueue';

/**
 * The reasons capture can stop for. A value outside this set is coerced to
 * `unknown` rather than stored raw — the server keeps this string, and an
 * unbounded client string in a column is how a reason field becomes prose.
 */
export const SIGNED_OUT_REASONS = Object.freeze(['401', 'missing_token', 'cleared']);

export function normalizeSignedOutReason(reason) {
  const r = String(reason == null ? '' : reason);
  return SIGNED_OUT_REASONS.includes(r) ? r : 'unknown';
}

/** The zero state. A fresh profile is signed out, unacknowledged, not paused. */
export const EMPTY_CAPTURE = Object.freeze({
  /** True only after a validation against the server succeeded. */
  signedIn: false,
  /** ms of the last successful validation, 0 if never. */
  validatedAt: 0,
  /** Member-controlled pause. Persists per profile across restarts. */
  paused: false,
  /** NOTICE_VERSION the member acknowledged, 0 if never. */
  noticeVersion: 0,
  /** ISO of the acknowledgement, null if never. */
  noticeAckAt: null,
  /** ISO of the transition INTO signed-out, null while signed in. */
  signedOutAt: null,
  /** Why capture stopped. Null while signed in. */
  signedOutReason: null,
  /** ms of the last signed-out notification, for the 24h re-notify cap. */
  lastSignedOutNotifyAt: 0,
  /** ms of the last notice-pending notification, for its own 24h re-notify cap. */
  lastNoticeNotifyAt: 0,
  /** NOTICE_VERSION that notification was for, 0 if never. A bump re-asks once. */
  lastNoticeNotifyVersion: 0,
});

// ────────────────────────────────────────────────────────────────── the gate
/**
 * THE decision. Everything that records anything asks this and nothing else.
 *
 * ⛔ FAIL CLOSED. Every branch that is not an explicit yes returns `on:false`.
 * A missing field, an undefined argument and an unrecognised state all land in
 * the same place, which is off — the same posture the hook's allowlist takes,
 * and for the same reason: a control you cannot read must never be read as
 * permission.
 *
 * `reason` is for the surfaces (and the tests), never for the member: the words
 * a member reads live in CAPTURE_NOTICE and the two notification objects.
 *
 * @returns {{on: boolean, reason: 'capturing'|'signed_out'|'not_acknowledged'|'paused'}}
 */
export function captureGate(state) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  // Order matters and it is not arbitrary: signed-out is the state that has its
  // own notification and its own badge, so it must win over the two quieter
  // reasons. A member who is both paused and signed out needs to be told about
  // the sign-out — resuming would change nothing.
  if (!s.signedIn) return { on: false, reason: 'signed_out' };
  if (!isAcknowledged(s)) return { on: false, reason: 'not_acknowledged' };
  if (s.paused) return { on: false, reason: 'paused' };
  return { on: true, reason: 'capturing' };
}

/** Has this profile acknowledged the CURRENT notice? */
export function isAcknowledged(state) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  return Number(s.noticeVersion || 0) >= NOTICE_VERSION;
}

/**
 * Should the notice be shown? The inverse of isAcknowledged(), named separately
 * because that is the question both surfaces actually ask, and a `!` in front of
 * a predicate at two call sites is one `!` away from a privacy defect.
 */
export function shouldShowNotice(state) {
  return !isAcknowledged(state);
}

// ─────────────────────────────────────────────────────── state transitions
/**
 * Fold a successful validation into the state.
 *
 * Returns `{ next, transitioned }` — `transitioned` is true only on an actual
 * signed-out → signed-in edge, which is what gates the "Signed in — capture
 * resumed." notification. A routine 4-hourly re-validation of an already
 * signed-in profile must not fire a notification, or the member gets six a day.
 */
export function applySignedIn(state, nowMs) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  const transitioned = !s.signedIn;
  return {
    transitioned,
    next: {
      ...s,
      signedIn: true,
      validatedAt: Number(nowMs) || 0,
      signedOutAt: null,
      signedOutReason: null,
      // ⛔ Cleared on the way back in, so a member who signs out again tomorrow
      // is notified again. Keeping it would make the 24h cap a 24h cap on the
      // WRONG clock — the first sign-out's, not this one's.
      lastSignedOutNotifyAt: 0,
    },
  };
}

/**
 * Fold a sign-out into the state.
 *
 * `transitioned` is true only on the signed-in → signed-out edge. A second 401
 * inside an already signed-out session is not a new event: the badge is already
 * red and the notification is already governed by the 24h cap below.
 */
export function applySignedOut(state, reason, nowIso) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  const transitioned = s.signedIn || !s.signedOutAt;
  return {
    transitioned,
    next: {
      ...s,
      signedIn: false,
      // ⛔ The FIRST sign-out's timestamp survives. team-health renders this as
      // "signed out since <time>"; overwriting it on every subsequent failed
      // request would reset that clock to now on every poll and report a
      // three-day outage as thirty seconds old.
      signedOutAt: s.signedOutAt || nowIso,
      signedOutReason: s.signedOutReason || normalizeSignedOutReason(reason),
    },
  };
}

/** Pause / resume. Kept as functions so the two surfaces cannot diverge. */
export function applyPaused(state, paused) {
  return { ...EMPTY_CAPTURE, ...(state || {}), paused: !!paused };
}

/** Record the acknowledgement. Nothing records until this has happened. */
export function applyAcknowledged(state, nowIso) {
  return {
    ...EMPTY_CAPTURE,
    ...(state || {}),
    noticeVersion: NOTICE_VERSION,
    noticeAckAt: nowIso,
  };
}

/**
 * Has this profile ever been signed in?
 *
 * ⛔ THE GUARD ON THE NOTIFICATION, AND IT IS NOT COSMETIC. The signed-out
 * notification says "Open the extension to sign BACK in", which is a sentence
 * about a session that existed. A fresh install has no token, so the first
 * validation legitimately lands on `missing_token` — and without this predicate
 * every new member's very first act with the extension would be a red alert
 * telling them their hours stopped being recorded, before they had ever recorded
 * one. The BADGE still goes red (nothing IS being recorded, which is true and
 * worth showing); only the notification is held back.
 *
 * Ask this of the state BEFORE the transition, never after — applySignedOut()
 * preserves `validatedAt`, but reading it afterwards invites the next edit to
 * clear it and silence the notification for everybody.
 *
 * Storage having been wiped is genuinely indistinguishable from a fresh install
 * here, and that is the correct answer rather than a gap: with the token gone
 * too, "sign in" and "sign back in" describe the same next action, and the popup
 * says so on open.
 */
export function hasEverSignedIn(state) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  return !!s.signedIn || Number(s.validatedAt || 0) > 0;
}

/**
 * The 24-hour re-notify cap.
 *
 * ⛔ ONE notification per transition, then at most one per 24h while still out.
 * Without the cap a member whose token was revoked gets a notification on every
 * poll for as long as they leave the browser open, and the notification that
 * matters — tomorrow morning's — is the one they have learned to dismiss.
 */
export function shouldNotifySignedOut(state, nowMs) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  const last = Number(s.lastSignedOutNotifyAt || 0);
  if (!last) return true;
  return (Number(nowMs) || 0) - last >= CAPTURE.RENOTIFY_MS;
}

/**
 * The notice-pending notification's cap: ONE per profile per NOTICE_VERSION, then
 * at most one per 24h while still unacknowledged — the signed-out cap's twin, on
 * its own clock.
 *
 * ⛔ DERIVED FROM THE GATE'S REASON, NOT FROM isAcknowledged() ALONE. The gate
 * ranks signed-out above the unacknowledged notice, and that order is what makes
 * this correct: a signed-out profile is told about the sign-out (which has its
 * own notification) and never about a notice it cannot act on; and `paused` — a
 * decision the member made with a control we shipped — is never nagged, because
 * the gate never answers `not_acknowledged` for a paused, acknowledged profile.
 * There is no second implementation of "is the notice pending" here.
 */
export function shouldNotifyNoticePending(state, nowMs) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  if (captureGate(s).reason !== 'not_acknowledged') return false;
  if (Number(s.lastNoticeNotifyVersion || 0) !== NOTICE_VERSION) return true;
  const last = Number(s.lastNoticeNotifyAt || 0);
  if (!last) return true;
  return (Number(nowMs) || 0) - last >= CAPTURE.RENOTIFY_MS;
}

/** Record that the notice-pending notification fired, for the cap above. */
export function applyNoticeNotified(state, nowMs) {
  return {
    ...EMPTY_CAPTURE,
    ...(state || {}),
    lastNoticeNotifyAt: Number(nowMs) || 0,
    lastNoticeNotifyVersion: NOTICE_VERSION,
  };
}

/** Should this state be re-validated against the server? */
export function shouldValidate(state, nowMs) {
  const s = { ...EMPTY_CAPTURE, ...(state || {}) };
  if (!s.signedIn) return true;                 // unknown ⇒ ask
  const at = Number(s.validatedAt || 0);
  if (!at) return true;
  return (Number(nowMs) || 0) - at >= CAPTURE.VALIDATE_HOURS * 3600 * 1000;
}

// ───────────────────────────────────────────────────────────────── the rows
/**
 * The ONLY fields that leave this machine, enumerated as an allowlist.
 *
 * ⛔ AN ALLOWLIST, NOT A DENYLIST, and the whole privacy claim rests on that
 * choice. The notice promises "the web address and page title of the tab you
 * are working in, and how long it is active or idle" plus counts. A denylist
 * would send any field a future edit to content.js happened to add to a bucket;
 * this sends the twelve named below and drops everything else on the floor,
 * including the bucket's own internal accumulators.
 *
 * `click_deltas` is a list of millisecond OFFSETS WITHIN THE MINUTE — when a
 * click happened, never where, never on what.
 *
 * F8 (0.11.2): the queued row also carries `row_key`, which is NOT one of these
 * twelve and is never taken from a bucket — appendRows() below mints it when the
 * row is queued. It is a random UUID and says nothing about the member, the
 * page or the minute.
 */
const ROW_FIELDS = Object.freeze([
  'ts_minute', 'url', 'tab_title',
  'clicks', 'keys', 'chars', 'enters', 'scrolls', 'pastes',
  'focus_seconds', 'idle', 'click_deltas',
]);

const COUNT_FIELDS = Object.freeze(['clicks', 'keys', 'chars', 'enters', 'scrolls', 'pastes']);

function asCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Reduce a raw content-script bucket to the wire row.
 * Returns null when the bucket carries no usable minute stamp.
 */
export function sanitizeBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const ts = typeof bucket.ts_minute === 'string' ? bucket.ts_minute : '';
  if (!ts) return null;
  const row = { ts_minute: ts };
  row.url = typeof bucket.url === 'string' ? bucket.url : null;
  row.tab_title = typeof bucket.tab_title === 'string' ? bucket.tab_title : null;
  for (const f of COUNT_FIELDS) row[f] = asCount(bucket[f]);
  const fs = Number(bucket.focus_seconds);
  // A minute holds at most 60 seconds of focus. A throttled timer in a
  // background tab can overshoot; clamping here means the server never has to
  // decide whether 4,000 seconds in one minute is a bug or a bill.
  row.focus_seconds = Number.isFinite(fs) ? Math.max(0, Math.min(60, Math.round(fs))) : 0;
  row.idle = bucket.idle === true;
  row.click_deltas = Array.isArray(bucket.click_deltas)
    ? bucket.click_deltas
      .slice(0, CAPTURE.CLICK_DELTA_CAP)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
    : [];
  return row;
}

/** The wire allowlist, exported so a test can assert nothing else ever ships. */
export function rowFields() {
  return ROW_FIELDS.slice();
}

/**
 * A fresh row key: crypto.randomUUID(), or null when it cannot be minted.
 * `randomUUID` is injectable for the tests. Never throws — a row that cannot get
 * a key is queued and sent without one, exactly as a pre-0.11.2 row is.
 */
export function newRowKey(randomUUID) {
  try {
    const mint = randomUUID || (() => globalThis.crypto.randomUUID());
    const key = mint();
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch (e) {
    return null;
  }
}

/**
 * Append rows to the buffer, dropping the OLDEST beyond the cap.
 *
 * ⛔ OLDEST, NOT NEWEST. A member who works offline all afternoon should keep
 * the afternoon they can still deliver, not the morning they cannot. Same rule
 * the /track event queue already uses.
 *
 * ⛔ F8 (0.11.2) — THE ROW KEY IS MINTED HERE, ONCE, AND NOWHERE ELSE. Each NEW
 * row gets `row_key` as it enters the queue, before its first send, and is
 * stored with it — so a resend after a lost response carries the SAME key and
 * the server can ignore it as one it already has. Rows already in `queue` are
 * never re-keyed: that includes rows queued by an older build, which have no key
 * and are sent without one. A key a bucket arrives carrying is dropped by
 * sanitizeBucket() first — the content script never chooses its own key.
 */
export function appendRows(queue, rows, cap = CAPTURE.MAX_ROWS, mintKey = newRowKey) {
  const base = Array.isArray(queue) ? queue : [];
  const add = (Array.isArray(rows) ? rows : [rows])
    .map(sanitizeBucket)
    .filter(Boolean)
    .map((row) => {
      const key = mintKey();
      return typeof key === 'string' && key.length > 0 ? { ...row, row_key: key } : row;
    });
  const next = base.concat(add);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * A one-at-a-time runner: `run(step)` starts `step` only after every step handed
 * to the same runner before it has settled, and resolves or rejects with
 * `step`'s own result.
 *
 * ⛔ WHY THE WORKER NEEDS ONE. chrome.storage.local has no transactions, so
 * "read the queue, append, write it back" is three steps, and two of them
 * interleaved lose one change: both read the same queue, both write it back with
 * only their own row. Measured 2026-09-28 in Chromium 145: eight `activity` rows
 * arriving together left ONE row queued, in 0.11.1 and 0.11.2 alike. They do
 * arrive together — the minute alarm's sweep enqueues every tab's rows at once,
 * and two visible windows roll their minute on the same boundary.
 *
 * ⛔ A STEP THAT FAILS REJECTS ITS OWN CALLER AND NOBODY ELSE'S. The chain waits
 * on each step's settlement, never on its success, so one throw cannot wedge
 * every write after it.
 */
export function makeSerializer() {
  let tail = Promise.resolve();
  return (step) => {
    const run = tail.then(() => step());
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

/**
 * `current` with ONE occurrence of each item in `sent` taken out, whatever
 * position it has moved to — the queue after a POST that delivered `sent`.
 * An item is matched by its `row_key` when it has one (every row queued since
 * F8), otherwise by its exact JSON (a row queued by an older build, a /track
 * event). Anything not in `sent` stays, in order.
 *
 * ⛔ NOT `current.slice(sent.length)`. A POST takes time, and the queue can move
 * under it: at the cap, a row appended meanwhile pushes the OLDEST rows out — the
 * very rows being sent — and slicing by count would then cut rows that were never
 * sent. Removing what was sent, by identity, cannot.
 */
export function removeSent(current, sent) {
  const idOf = (x) => (x && typeof x.row_key === 'string' && x.row_key.length > 0 ? `k:${x.row_key}` : `j:${JSON.stringify(x)}`);
  const owed = new Map();
  for (const s of Array.isArray(sent) ? sent : []) owed.set(idOf(s), (owed.get(idOf(s)) || 0) + 1);
  return (Array.isArray(current) ? current : []).filter((x) => {
    const id = idOf(x);
    const n = owed.get(id) || 0;
    if (n === 0) return true;
    if (n === 1) owed.delete(id); else owed.set(id, n - 1);
    return false;
  });
}

/** The rows to send in one POST. */
export function batchRows(queue, size = CAPTURE.BATCH_ROWS) {
  return (Array.isArray(queue) ? queue : []).slice(0, size);
}

/**
 * Wrap rows as /track events.
 *
 * ⛔ THEY GO TO /track, NOT /activity, and the entry id is DELIBERATELY ABSENT.
 * The server owns the "which time_entry is open right now" question — it is
 * already holding that map to process timer_start/timer_stop in the same batch —
 * and a client-asserted entry id would be a second, laggier answer to it. Under
 * continuous capture most minutes have NO open entry at all, which is exactly
 * the case the server records as `time_entry_id = NULL`.
 *
 * F8 (0.11.2): a row's stored `row_key` rides along on its event, unchanged, on
 * every attempt; a row queued without one goes without one.
 */
export function toTrackEvents(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({ kind: 'activity', ts: r.ts_minute, ...r }));
}

// ───────────────────────────────────────── the sub-frame input relay (F6, 0.11.2)
/** content.js (sub-frame) → worker. content.js inlines this string. */
export const SUBFRAME_INPUT_TYPE = 'mm_subframe_input';
/** worker → content.js (top frame, frameId 0). content.js inlines this string. */
export const MERGE_SUBFRAME_INPUT_TYPE = 'mm_merge_subframe_input';

/** The six counts a sub-frame may forward, coerced like a bucket's; nothing else. */
export function sanitizeSubframeCounts(counts) {
  const c = counts && typeof counts === 'object' ? counts : {};
  const out = {};
  for (const f of COUNT_FIELDS) out[f] = asCount(c[f]);
  return out;
}

/**
 * What the worker does with a sub-frame's `mm_subframe_input`: relay it to the
 * TOP frame of the tab it came from — `{ tabId, message, options: { frameId: 0 } }`
 * for chrome.tabs.sendMessage — or null to ignore it.
 *
 * ⛔ THE RELAYED MESSAGE IS REBUILT, NEVER FORWARDED. It carries the six counts
 * and the last-input time and nothing else, so no URL, title or other field a
 * sub-frame might put on its message can reach the top frame's row.
 *
 * Ignored: anything that is not this message type, a sender with no tab (an
 * extension page), and a message from frameId 0 — the top frame is not a
 * sub-frame, and relaying its own message back to it would double-count.
 */
export function subframeRelay(msg, sender) {
  if (!msg || msg.type !== SUBFRAME_INPUT_TYPE) return null;
  const tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  const frameId = sender ? sender.frameId : undefined;
  if (!Number.isInteger(frameId) || frameId <= 0) return null;
  const ts = Number(msg.last_input_ts);
  return {
    tabId,
    message: {
      type: MERGE_SUBFRAME_INPUT_TYPE,
      counts: sanitizeSubframeCounts(msg.counts),
      last_input_ts: Number.isFinite(ts) && ts > 0 ? ts : null,
    },
    options: { frameId: 0 },
  };
}

/**
 * Is this message from content.js running in a SUB-FRAME of a tab? The worker
 * answers a message like that ONLY if it is `mm_subframe_input`, and ignores
 * every other type: no handling, no response, no storage write.
 *
 * ⛔ WHY. Since F6, content.js runs in every frame of every page — third-party
 * iframes included (ad slots, chat embeds, a customer's widget) — and a sub-frame's
 * only legitimate message is its input counts. Every other type the worker handles
 * (activity rows, captureAcknowledge, capturePause, start, stop, …) comes from the
 * top frame or from one of the extension's own pages. Refusing those types from a
 * sub-frame means a hostile frame can at most add input counts to its own tab's
 * current minute, which the relay already sanitizes.
 *
 * The test: `sender.tab` is set (a document in a tab) AND `sender.frameId !== 0`
 * (not the top frame) AND the sender is not one of THIS extension's own pages.
 * A missing or odd frameId counts as a sub-frame, the safe side to fail to.
 *
 * ⛔ THE THIRD CONDITION IS THE POP-OUT, AND IT IS MEASURED, NOT ASSUMED.
 * popout.html runs as an iframe inside the Document Picture-in-Picture window,
 * and that window is a tab of its own: in Chromium 145 (2026-09-28) its messages
 * arrive with `sender.tab` set (url about:blank) and `frameId: 5`, from
 * `chrome-extension://<id>/popout.html`. Without the third condition the pop-out's
 * Start, Stop, Pause and "I understand, start capture" would all go unanswered.
 * `sender.url` comes from the browser, not from the page, and a content script
 * never runs in an extension page, so a frame on a web page cannot match `ownBase`.
 * Refusing our own pages would protect nothing anyway: they can call every
 * chrome.* API the worker can. The popup and the side panel have no `sender.tab`;
 * the options page is a tab's top frame (frameId 0); a prerendered page that was
 * then shown sends with frameId 0 (measured 2026-09-28).
 *
 * `ownBase` is chrome.runtime.getURL('') — `chrome-extension://<id>/`.
 */
export function isContentSubframeSender(sender, ownBase) {
  if (!sender || !sender.tab) return false;   // no tab: the popup, the side panel
  if (sender.frameId === 0) return false;     // a top frame
  return !isOwnPageSender(sender, ownBase);   // our own page in a frame: the pop-out
}

/**
 * Is this message from one of THIS extension's own pages — the service worker,
 * the popup, the side panel, the options page, the pop-out, the offscreen
 * document — rather than from a content script in some web page?
 *
 * `sender.url` is filled in by the browser, not by the page, and a content script
 * never runs inside an extension page, so a content script — top frame or
 * sub-frame, any site — can never match. offscreen.js is a classic script and
 * cannot import this; it inlines the same test, and
 * verify/offscreen-guard.test.mjs holds the two to the same answers.
 *
 * `ownBase` is chrome.runtime.getURL('') — `chrome-extension://<id>/`.
 */
export function isOwnPageSender(sender, ownBase) {
  return !!sender && typeof ownBase === 'string' && ownBase.length > 0 &&
    typeof sender.url === 'string' && sender.url.startsWith(ownBase);
}

// ─────────────────────────────────────────────────────────── the state report
/**
 * The closed list of values the capture-state header may carry. Four are the
 * gate's own reasons; `unknown` is the one case the gate cannot produce — a store
 * that could not be read at all — which is reported as such rather than guessed.
 */
export const CAPTURE_STATES = Object.freeze(['capturing', 'not_acknowledged', 'paused', 'signed_out', 'unknown']);

/**
 * The state string that leaves this machine on every authenticated request
 * (v0.11.1), beside the build version. STATE, NEVER CONTENT: it is the gate's
 * reason and nothing else — no URL, no title, no count, no timestamp, no
 * acknowledgement date. Nothing here is a fact the member cannot already read
 * about themselves on their own health strip.
 *
 * ⛔ `null` IS `unknown`, NOT `signed_out`. The recorder fails closed on an
 * unreadable store, and that is right for the recorder. A REPORT that asserts a
 * state it could not read is the same lie pointed the other way, so the reader
 * below hands back null and this function says so.
 */
export function reportableCaptureState(state) {
  if (state == null) return 'unknown';
  const reason = captureGate(state).reason;
  return CAPTURE_STATES.includes(reason) ? reason : 'unknown';
}

// ──────────────────────────────────────────────────────────── storage access
// Async, and every chrome reference is INSIDE a function — see the header.

/** The store as read for the report; `null` when it cannot be read. */
export async function readCaptureForReport() {
  try {
    const o = await chrome.storage.local.get(CAPTURE_KEY);
    return { ...EMPTY_CAPTURE, ...(o[CAPTURE_KEY] || {}) };
  } catch (e) {
    return null;
  }
}

export async function getCapture() {
  try {
    const o = await chrome.storage.local.get(CAPTURE_KEY);
    return { ...EMPTY_CAPTURE, ...(o[CAPTURE_KEY] || {}) };
  } catch (e) {
    // Storage unreadable ⇒ we cannot prove the member acknowledged anything.
    // Fail closed: the zero state records nothing.
    return { ...EMPTY_CAPTURE };
  }
}

export async function setCapture(patch) {
  const next = { ...(await getCapture()), ...(patch || {}) };
  try { await chrome.storage.local.set({ [CAPTURE_KEY]: next }); } catch (e) { /* keep in memory */ }
  return next;
}

/**
 * Publish the gate's answer on the storage bus for the content scripts.
 * Written on EVERY state change, so a tab that loaded while capture was off
 * flips the moment it comes on without waiting for a navigation.
 */
export async function publishCaptureOn(state) {
  const on = captureGate(state).on;
  try { await chrome.storage.local.set({ [CAPTURE_ON_KEY]: on }); } catch (e) { /* ignore */ }
  return on;
}
