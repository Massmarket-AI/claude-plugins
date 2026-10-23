// content.js — per-minute activity capture + the QA-capture click-shot trigger.
// Runs in the ISOLATED world on every page (document_start) and, since 0.11.2
// (F6), in EVERY FRAME of it — but only the TOP frame keeps a minute bucket. See
// "WHICH FRAME THIS IS" below.
//
// PRIVACY-CRITICAL: the meter below records COUNTS of interactions only. It never
// records which keys are pressed, any typed text, clipboard contents, or element
// contents. `event.key` is inspected only to classify a keystroke as printable /
// Enter / other, and is never stored or transmitted. The only free text that ever
// leaves this file is the TOP frame's `location.href` and `document.title` — the
// two things the v0.11.0 notice names. A sub-frame never reads either of its own.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ THE GATE CHANGED IN v0.11.0, AND IT IS NOT THE TIMER ANY MORE.
//
// This meter existed before, gated on `running` — chrome.storage.local's "a
// timer is open" flag — and was deleted wholesale in v0.6.0's phase-2 shrink. It
// is back, and it is back on a DIFFERENT gate: `captureOn`, which the service
// worker publishes from capture.js's captureGate(). That answers signed in AND
// acknowledged AND not paused, and it says nothing at all about timers.
//
// The practical difference, and the reason the old key must not be reused here:
// under the old gate a member who never pressed Start produced no rows, which is
// the 1.1%-attribution hole this release exists to close. Under the new one a
// member who signed in this morning produces rows all day, and the timer only
// decides which `time_entry` the server attaches a minute to — never whether the
// minute exists.
//
// ⛔ ONE GATE, READ IN ONE PLACE. This file does not consult the token, the
// pause flag, or the acknowledgement separately; it reads the single boolean the
// service worker computed. A second copy of that decision in a content script
// running on every page is a second place for it to be wrong, on the surface
// where being wrong is least visible.
// ═════════════════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ═════════════════════════════════════════════════════════════════════════════
  // ⛔ F6 (0.11.2) — WHICH FRAME THIS IS, AND WHAT EACH KIND OF FRAME MAY DO.
  //
  // Until 0.11.2 this file ran in the top frame only (`all_frames: false`), so
  // input inside an iframe never reached a listener. HighLevel's workflow builder
  // is a cross-origin iframe (client-app-automation-workflows.leadconnectorhq.com)
  // and 87.6% of its capture rows carried zero input. It now runs in every frame
  // (`all_frames: true`, `match_origin_as_fallback: true`), and the two kinds of
  // frame do different jobs:
  //
  //   TOP FRAME · exactly what it did before: the minute bucket, the tab's URL
  //               and title, focus, the idle clock and the rows. It also merges
  //               the counts its sub-frames forward (mm_merge_subframe_input)
  //               into the CURRENT bucket, and treats their last-input time as
  //               real input for the idle clock.
  //   SUB-FRAME · counts input with the SAME listeners and the SAME rules — plus
  //               one gate the top frame does not have: only trusted events
  //               count, and a scroll counts only just after a real wheel,
  //               touch, pointerdown or scrolling key in that frame ("input
  //               bookkeeping" below says why) — and forwards only the six
  //               counts and the time of its last input (mm_subframe_input) —
  //               at most one message per 2 s while input is happening,
  //               flushed on pagehide / hidden. The background worker relays
  //               them to the tab's top frame. A sub-frame keeps NO bucket,
  //               never reads or sends its own URL or title, never sends a
  //               row, and answers no message.
  //
  // So a minute's row still carries the TOP frame's URL and title only — "the
  // tab you are working in", which is the notice's own wording (NOTICE_VERSION
  // stays 2). An error reading window.top is treated as a sub-frame: the kind
  // that sends nothing but counts is the safe side to fail to.
  //
  // ⛔ A FENCED FRAME IS A SUB-FRAME. Inside a <fencedframe> (an ad slot)
  // window.top is the fenced frame itself, so `window === window.top` alone would
  // make it a second "top frame" of the tab: its own URL and title on rows, and a
  // second answer racing the real top frame's to the worker's flushNow. Only a
  // fenced frame has a non-null `window.fence`.
  // ═════════════════════════════════════════════════════════════════════════════
  let isTopFrame = false;
  try { isTopFrame = window === window.top && !window.fence; } catch (e) { isTopFrame = false; }

  // A TOP-LEVEL document on a scheme the declared entry never matched before
  // `match_origin_as_fallback` — an about:blank popup, a Document Picture-in-
  // Picture window, a blob: page — had no content script at all until 0.11.2.
  // It still records nothing, and it returns BEFORE the guard below so it leaves
  // no trace on the window: the top frame behaves exactly as it did.
  if (isTopFrame && !/^(https?|file):$/.test(location.protocol)) return;

  // Idempotent re-injection guard. Two things can inject this script into the same
  // frame: the declared content_scripts entry (on navigation) AND the service
  // worker's programmatic backfill (chrome.scripting.executeScript, for tabs that
  // were already open before the extension loaded/reloaded, or for a QA-capture
  // walkthrough starting in an already-open tab). Both run in the SAME isolated
  // world, so this window-scoped flag is shared between them: only the first
  // instance wires up listeners; any later injection returns immediately, so
  // clicks/keys are never double-counted.
  if (window.__mmTtContentLoaded) return;
  window.__mmTtContentLoaded = true;

  if (isTopFrame) console.log('[MM-TT] content.js active on', location.href);

  // These mirror capture.js's CAPTURE constants but are inlined — a content
  // script cannot import the ES module the service worker and popup share.
  // ⛔ IDLE_MS must stay equal to CAPTURE.IDLE_MS (5 minutes). The notice says
  // "how long it is active or idle"; two different thresholds would make the
  // word "idle" mean two things. IDLE_ROW_CAP, SUBFRAME_BATCH_MS and
  // SUBFRAME_SCROLL_INTENT_MS mirror their CAPTURE.* namesakes the same way.
  const CLICK_DELTA_CAP = 120;   // cap click offsets per bucket
  const SCROLL_THROTTLE_MS = 500; // one scroll "burst" per this window
  const CLICK_DEDUPE_MS = 1000;  // dedupe pointerdown -> click for one action
  const IDLE_MS = 5 * 60 * 1000; // no click/key/scroll/paste for this long => idle
  const IDLE_ROW_CAP = 60;       // F7: idle rows in a row before a tab stops sending them
  const SUBFRAME_BATCH_MS = 2000; // F6: at most one sub-frame forward per this window
  const SUBFRAME_SCROLL_INTENT_MS = 3000; // F6: a sub-frame scroll counts only this soon after real scroll input
  // The six counts, in bucket order. The ONLY thing a sub-frame ever forwards.
  const COUNT_FIELDS = ['clicks', 'keys', 'chars', 'enters', 'scrolls', 'pastes'];
  // F6: the keys that scroll a page. A real press of one opens a sub-frame's
  // scroll gate (see subframeScrollAllowed); which key it was is never kept.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

  // Wall-clock (ms) of the last real input in this session. Focus time accrued
  // more than IDLE_MS after this is treated as idle: it is NOT credited to
  // focus_seconds. Seeded to "now" so a fresh session is never instantly idle.
  // Top frame only; since 0.11.2 a sub-frame's forwarded last-input time moves
  // it exactly like local input.
  let lastActivityTs = Date.now();

  let capturing = false;
  // QA-capture mode is INDEPENDENT of `capturing`: it fires only during the
  // end-of-block QA walkthrough. When `qaRunning` is set, each click asks the
  // service worker to grab a screenshot for the QA bundle. It never touches the
  // activity meter, and the meter never triggers a screenshot.
  let qaRunning = false;
  let lastQaShotTs = 0;
  const QA_CLICK_GAP_MS = 400; // client-side de-dupe so one physical click = one shot request
  let bucket = null;             // current per-minute bucket (or null)
  let focusedSince = 0;          // ms when focus began within this bucket, 0 if blurred
  let lastScrollTs = 0;
  let lastPointerDownTs = 0;
  let rollTimer = null;          // self-scheduling minute-boundary timer
  const outbox = [];             // closed buckets awaiting delivery to the SW
  let sending = false;
  // F7, top frame: idle MINUTES this tab has sent rows for, in a row, since its
  // last real input (local, or merged from a sub-frame) or capture (re)start —
  // and the minute counted last, because one minute can close as several rows
  // (the worker's minute sweep, a tab switch). At IDLE_ROW_CAP it stops.
  let idleRun = 0;
  let idleRunMinute = -1;
  // F6, sub-frame only: the counts not yet forwarded, whether anything happened
  // since the last forward, when the last input was, and the forward throttle.
  let pending = null;
  let pendingDirty = false;
  let lastInputTs = 0;
  let lastForwardTs = 0;
  let forwardTimer = null;
  // F6, sub-frame only: when this frame last saw a REAL wheel, touch, pointerdown
  // or scrolling key — the only things that may make its scroll events count.
  let lastScrollIntentTs = -Infinity;

  const now = () => Date.now();
  const minuteStart = (ms) => Math.floor(ms / 60000) * 60000;
  const isoMinute = (ms) => new Date(minuteStart(ms)).toISOString();

  function freshBucket(ms) {
    return {
      ts_minute: isoMinute(ms),
      url: location.href,
      tab_title: document.title,
      clicks: 0,
      keys: 0,
      chars: 0,
      enters: 0,
      scrolls: 0,
      pastes: 0,
      focus_seconds: 0,
      click_deltas: [],
      _accumMs: 0,               // internal focus accumulator (stripped before send)
      _idleMs: 0,                // F7: focus past the idle cutoff, NOT credited (stripped before send)
      _minute: minuteStart(ms),  // internal minute epoch for click_deltas offsets
    };
  }

  function ensureBucket() {
    if (!bucket) {
      bucket = freshBucket(now());
      focusedSince = document.hasFocus() ? now() : 0;
    }
    return bucket;
  }

  /**
   * Is this bucket worth sending?
   *
   * ⛔ CHANGED IN v0.11.0, AND THIS IS THE CHANGE THAT MAKES focus_seconds
   * USABLE. The old rule was "any real input", so a minute of reading a client's
   * page with no click in it produced NOTHING — which is why the design doc
   * measured 41,743 focus-seconds across eleven members and forty-three days and
   * concluded the column was too thin to bill from. Under continuous capture the
   * question is "was this tab in front of the member", so a focused minute
   * counts even if they never touched the keyboard.
   *
   * A minute with neither input nor focus is still dropped: an unfocused
   * background tab accruing nothing is not evidence of anything.
   *
   * F7 (0.11.2): a minute this rejects is no longer always dropped. If the tab
   * was focused in it past the idle cutoff, finishBucket() sends it as an idle
   * row instead — see idleRow(). This predicate itself is unchanged.
   */
  function hasActivity(b) {
    if (!b) return false;
    if ((b.clicks + b.keys + b.scrolls + b.pastes) > 0) return true;
    return (b.focus_seconds || 0) > 0 || (b._accumMs || 0) > 0;
  }

  // Fold focused time up to `ms` into the current bucket's accumulator. Time more
  // than IDLE_MS after the last real input is idle: it is NOT credited to
  // focus_seconds. F7 (0.11.2): that uncredited stretch is still MEASURED, in
  // `_idleMs`, so a minute that was nothing but idle focus can be sent flagged
  // (idleRow below) instead of vanishing. It never reaches `_accumMs`.
  function settleFocus(ms) {
    if (focusedSince && bucket) {
      const idleAt = lastActivityTs + IDLE_MS;
      // Credit only the portion before the idle cutoff (never negative).
      bucket._accumMs += Math.max(0, Math.min(ms, idleAt) - focusedSince);
      // …and measure, uncredited, the portion after it (never negative).
      bucket._idleMs += Math.max(0, ms - Math.max(focusedSince, idleAt));
      focusedSince = ms; // keep counting forward from here
    }
  }

  function serialize(b) {
    return {
      ts_minute: b.ts_minute,
      url: b.url,
      tab_title: b.tab_title,
      clicks: b.clicks,
      keys: b.keys,
      chars: b.chars,
      enters: b.enters,
      scrolls: b.scrolls,
      pastes: b.pastes,
      focus_seconds: b.focus_seconds,
      // ⛔ F7 (0.11.2) — `idle` IS TRUE ONLY ON AN IDLE ROW (idleRow below).
      // Before 0.11.2 a minute that crossed the idle cutoff was sent idle:true
      // with the focus it CREDITED before the cutoff, and so was a return minute
      // whose bucket had crossed before the input. The server now leaves every
      // idle:true row out of tracked, active and focus time (OW #330), so a
      // credited second on such a row would be lost. A minute with any input or
      // any credited focus is an ACTIVE minute, and is sent as one.
      idle: false,
      click_deltas: b.click_deltas,
    };
  }

  /**
   * ⛔ F7 (0.11.2) — A QUIET MINUTE IS KEPT AND FLAGGED, NOT DELETED.
   *
   * hasActivity() drops a minute with no input and no CREDITED focus, and focus
   * stops being credited IDLE_MS after the last input — so a call, a video or
   * ten minutes of reading, the tab in front of the member and nobody touching
   * the keyboard, used to leave no row at all. Such a minute is now sent with
   * idle:true, zero input counts, and focus_seconds = the seconds the tab was
   * focused in it (focus the idle rule did not credit) — and it is the ONLY row
   * ever sent idle:true. A row that passes hasActivity() — any input, or any
   * credited focus, the cutoff minute and the return minute included — is sent
   * idle:false with its credited focus_seconds, as an active minute (serialize).
   *
   * A minute with no focus at all still sends nothing — an unfocused background
   * tab is not evidence of anything. And after IDLE_ROW_CAP idle MINUTES in a row
   * a tab stops sending them, so a browser left open over a weekend is not a
   * weekend of rows, until the next real input (local or from a sub-frame) or a
   * capture restart, which re-seeds the idle clock. The cap counts minutes, not
   * rows: a minute the worker's sweep or a tab switch closed as two rows is one.
   */
  function idleRow(b) {
    if (!(b._idleMs > 0)) return null;      // never focused this minute
    if (b._minute !== idleRunMinute) {      // a new idle minute
      if (idleRun >= IDLE_ROW_CAP) return null; // capped until real input or a capture restart
      idleRun++;
      idleRunMinute = b._minute;
    }
    const row = serialize(b);               // counts are all 0: hasActivity() said so
    row.focus_seconds = Math.min(60, Math.round(b._idleMs / 1000));
    row.idle = true;
    return row;
  }

  // Settle the live bucket and decide what it sends: the row, or null when the
  // minute sends nothing. Always clears the bucket. Every path that closes a
  // bucket — the minute roll, a URL change, the tab going hidden, pagehide and
  // the worker's flushNow — goes through here, so they cannot disagree.
  function finishBucket() {
    if (!bucket) return null;
    settleFocus(now());
    const b = bucket;
    bucket = null;
    // A minute bucket can hold at most 60s of focus; clamp against throttled timers.
    b.focus_seconds = Math.min(60, Math.round(b._accumMs / 1000));
    return hasActivity(b) ? serialize(b) : idleRow(b);
  }

  function closeBucket() {
    const row = finishBucket();
    if (row) {
      outbox.push(row);
      flushOutbox();
    }
  }

  // Close the current bucket and, if still capturing, open a fresh one — carrying
  // focus forward if the tab is still focused.
  function roll() {
    const wasFocused = !!focusedSince || document.hasFocus();
    closeBucket();
    if (capturing) {
      bucket = freshBucket(now());
      focusedSince = wasFocused ? now() : 0;
    }
  }

  function scheduleRoll() {
    clearTimeout(rollTimer);
    // Fire just after the next minute boundary.
    const ms = 60000 - (now() % 60000) + 25;
    rollTimer = setTimeout(() => {
      if (capturing) {
        // ⛔ ensureBucket() BEFORE roll(), because a focus-only minute has no
        // input event to have created a bucket. Without it a member who read a
        // page for ten minutes without clicking produced ten empty ticks and no
        // rows — the exact hole hasActivity() above was widened to close.
        ensureBucket();
        roll();
        flushOutbox(); // retry any buckets the SW couldn't accept earlier
        scheduleRoll();
      }
    }, ms);
  }

  // SPA navigation: start a new bucket per URL so activity is attributed to the
  // page it happened on. Top frame only — a sub-frame has no bucket and never
  // reads its own URL.
  function checkUrl() {
    if (!isTopFrame) return;
    if (capturing && bucket && bucket.url !== location.href) roll();
  }

  // ---------------------------------------------------------------- input bookkeeping
  // ⛔ ONE set of input listeners for both kinds of frame (below), with the same
  // counting rules. Three things differ, and all three live here:
  //   · where a count lands — the minute bucket (top) or the pending counts (sub);
  //   · what real input moves — the idle clock and the idle-row run (top), or the
  //     last-input time that is forwarded with the counts (sub);
  //   · in a SUB-FRAME only, what counts as input at all (the gate just below).
  //
  // ⛔ THE SUB-FRAME GATE, AND WHY IT IS SUB-FRAME ONLY. A sub-frame is very often
  // somebody else's widget — a chat embed, a carousel, an auto-scrolling feed —
  // and such a widget can scroll itself and dispatch its own events all day. Left
  // ungated, one of them would keep a focused tab "active" forever: its scrolls
  // reset the top frame's idle clock, so the minute is never idle and no idle
  // row is ever sent. So in a sub-frame:
  //   · an event that is not isTrusted (a script dispatched it) counts for
  //     NOTHING and moves NOTHING — no counter, no last-input time;
  //   · a scroll counts, and moves the last-input time, only if a REAL wheel,
  //     touch, pointerdown or scrolling key (arrows, PageUp/PageDown, Home/End,
  //     Space) happened in this same frame within SUBFRAME_SCROLL_INTENT_MS.
  //     Scroll events are trusted even when a script scrolled the element, so
  //     trust alone cannot tell the two apart.
  // The top frame's counting is untouched — byte-identical to the base build,
  // which verify/capture-frames-idle-rowkey.test.mjs's DIFF test holds it to.
  function realSubframeEvent(e) {
    return !!(e && e.isTrusted === true); // a missing flag is not trust: fail closed
  }

  function noteScrollIntent(e) {
    if (realSubframeEvent(e)) lastScrollIntentTs = now();
  }

  function subframeScrollAllowed(t) {
    return t - lastScrollIntentTs <= SUBFRAME_SCROLL_INTENT_MS;
  }

  function noteInput(t = now()) {
    if (isTopFrame) {
      lastActivityTs = t;
      idleRun = 0; // F7: real input ends an idle run; idle rows resume after the next quiet stretch
      idleRunMinute = -1;
    } else {
      lastInputTs = t;
      pendingDirty = true;
      scheduleForward();
    }
  }

  function zeroCounts() {
    const c = {};
    for (const f of COUNT_FIELDS) c[f] = 0;
    return c;
  }

  function counter() {
    if (isTopFrame) return ensureBucket();
    if (!pending) pending = zeroCounts();
    return pending;
  }

  // ---------------------------------------------------------------- sub-frame forwarding (F6)
  // Leading edge plus trailing edge: the first input after a quiet stretch goes at
  // once, anything after it within SUBFRAME_BATCH_MS rides the next message, so a
  // sub-frame sends at most one message per window while input is happening.
  function scheduleForward() {
    if (forwardTimer) return;
    const wait = Math.max(0, lastForwardTs + SUBFRAME_BATCH_MS - now());
    forwardTimer = setTimeout(forwardInput, wait);
  }

  // The whole message: the six counts and a timestamp. No URL, no title, no
  // minute, no click offsets — nothing from this frame's document at all.
  function forwardInput() {
    if (forwardTimer) {
      clearTimeout(forwardTimer);
      forwardTimer = null;
    }
    if (!pendingDirty) return;
    const counts = pending || zeroCounts();
    pending = null;
    pendingDirty = false;
    lastForwardTs = now();
    try {
      const p = chrome.runtime.sendMessage({ type: 'mm_subframe_input', counts, last_input_ts: lastInputTs });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* extension context gone (reload/update) — nothing left to deliver to */ }
  }

  // ---------------------------------------------------------------- merged sub-frame input (F6, top frame)
  // Counts relayed from a sub-frame of THIS tab. They land in the CURRENT bucket,
  // whatever minute the input happened in — a minute that already closed is
  // never edited after the fact — and the sub-frame's last-input time is real
  // input for the idle clock, exactly like a local event: never later than now,
  // and never earlier than what the clock already holds.
  function mergeSubframeInput(msg) {
    if (!capturing) return;
    const c = (msg && msg.counts) || {};
    const add = {};
    let total = 0;
    for (const f of COUNT_FIELDS) {
      const n = Number(c[f]);
      add[f] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      total += add[f];
    }
    const ts = Number(msg && msg.last_input_ts);
    const t = Number.isFinite(ts) && ts > 0 ? Math.min(ts, now()) : now();
    noteInput(Math.max(lastActivityTs, t));
    if (total > 0) {
      const b = ensureBucket();
      for (const f of COUNT_FIELDS) b[f] += add[f];
    }
    checkUrl();
  }

  // ---------------------------------------------------------------- QA-capture click shots
  // Listen to pointerdown only (not click) so a normal click = exactly one shot
  // request. Gated on qaRunning; inert otherwise. The SW does the actual
  // captureVisibleTab + its own throttle; we just signal "a click happened here".
  function onQaPointerDown() {
    if (!qaRunning) return;
    const t = now();
    if (t - lastQaShotTs < QA_CLICK_GAP_MS) return;
    lastQaShotTs = t;
    try { chrome.runtime.sendMessage({ type: 'qaClickShot' }); } catch (e) { /* SW asleep — next click retries */ }
  }

  // ---------------------------------------------------------------- listeners
  // Shared by both kinds of frame (see "input bookkeeping" above). Click offsets
  // are top-frame only: they belong to a bucket, and a sub-frame has none. Every
  // `!isTopFrame` line below is the sub-frame gate; the top frame skips them all.
  function onPointerDown(e) {
    if (!capturing) return;
    if (!isTopFrame) {
      if (!realSubframeEvent(e)) return; // a dispatched pointerdown is not input
      noteScrollIntent(e);               // a real one can start a scroll (scrollbar drag, touch)
    }
    noteInput();
    const b = counter();
    b.clicks++;
    if (isTopFrame && b.click_deltas.length < CLICK_DELTA_CAP) b.click_deltas.push(now() - b._minute);
    lastPointerDownTs = now();
    checkUrl();
  }

  function onClick(e) {
    if (!capturing) return;
    if (!isTopFrame && !realSubframeEvent(e)) return; // a dispatched click is not input
    noteInput();
    // A normal mouse click fires pointerdown THEN click — count it once (on
    // pointerdown). Only count `click` here when no pointerdown preceded it
    // (keyboard-activated / synthetic clicks).
    if (now() - lastPointerDownTs <= CLICK_DEDUPE_MS) { checkUrl(); return; }
    const b = counter();
    b.clicks++;
    if (isTopFrame && b.click_deltas.length < CLICK_DELTA_CAP) b.click_deltas.push(now() - b._minute);
    checkUrl();
  }

  function onKeyDown(e) {
    if (!capturing) return;
    if (!isTopFrame) {
      if (!realSubframeEvent(e)) return; // a dispatched keydown is not input
      if (SCROLL_KEYS.has(e.key)) noteScrollIntent(e); // classify only — the key is never kept
    }
    noteInput();
    const b = counter();
    b.keys++;
    // Classify ONLY — never store e.key.
    if (e.key === 'Enter') {
      b.enters++;
    } else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      b.chars++; // a printable character was typed (which one is never recorded)
    }
  }

  function onScroll(e) {
    if (!capturing) return;
    const t = now();
    // A sub-frame scroll nobody caused — a widget scrolling itself — is not input:
    // it counts, and moves the last-input time, only after real scroll input.
    if (!isTopFrame && !(realSubframeEvent(e) && subframeScrollAllowed(t))) return;
    noteInput(t); // scrolling is real activity even when throttled below
    if (t - lastScrollTs < SCROLL_THROTTLE_MS) return; // throttle to scroll bursts
    lastScrollTs = t;
    counter().scrolls++;
  }

  // Sub-frame only: a real wheel or touch is not counted, it only opens the gate.
  function onScrollIntent(e) {
    if (capturing) noteScrollIntent(e);
  }

  function onPaste(e) {
    if (!capturing) return;
    if (!isTopFrame && !realSubframeEvent(e)) return; // a dispatched paste is not input
    noteInput();
    counter().pastes++; // count only — clipboard contents are never read
  }

  function onFocus() {
    if (!capturing) return;
    ensureBucket();
    if (!focusedSince) focusedSince = now();
  }

  function onBlur() {
    if (!capturing) return;
    if (bucket) settleFocus(now());
    focusedSince = 0;
  }

  // ---------------------------------------------------------------- delivery
  async function flushOutbox() {
    if (sending || !outbox.length) return;
    sending = true;
    try {
      while (outbox.length) {
        const row = outbox[0];
        try {
          // sendMessage wakes the service worker if it's asleep.
          await chrome.runtime.sendMessage({ type: 'activity', bucket: row });
        } catch (e) {
          break; // SW unreachable — keep the row and retry on the next minute tick
        }
        outbox.shift();
      }
    } finally {
      sending = false;
    }
  }

  // ---------------------------------------------------------------- capture state
  function setCapturing(next) {
    next = !!next;
    if (next === capturing) return;
    capturing = next;
    if (!isTopFrame) {
      // A sub-frame has no bucket and no roll. Capture going off drops whatever
      // it has not forwarded: nothing is recorded while paused or signed out.
      if (!capturing) {
        clearTimeout(forwardTimer);
        forwardTimer = null;
        pending = null;
        pendingDirty = false;
      }
      return;
    }
    if (capturing) {
      lastActivityTs = now(); // fresh session — don't treat the start as idle
      idleRun = 0;            // F7: …and a fresh idle-row run, since the idle clock restarted
      idleRunMinute = -1;
      scheduleRoll();
    } else {
      clearTimeout(rollTimer);
      rollTimer = null;
      closeBucket(); // flush the partial minute (if it had activity), then go inert
      focusedSince = 0;
    }
  }

  async function readCaptureOn() {
    try {
      const { captureOn } = await chrome.storage.local.get('captureOn');
      return !!captureOn;
    } catch (e) {
      return false; // fail closed
    }
  }

  // ---------------------------------------------------------------- pop-out host
  // ⛔ WHY THE POP-OUT LIVES HERE AND NOT IN THE SIDE PANEL.
  //
  // Document Picture-in-Picture needs a TOP-LEVEL DOCUMENT WITH TRANSIENT USER
  // ACTIVATION. A side panel is neither: v0.7.0 called requestWindow() there, it
  // rejected every time, and because the button was feature-detected on the mere
  // PRESENCE of window.documentPictureInPicture (which does exist in a side
  // panel) the button rendered anyway and then vanished on click. That is the
  // dead button Rob clicked at 08:08 on 2026-08-11.
  //
  // Measured 2026-08-11 in Chromium 1228 (scratchpad/pipprobe):
  //   · the API object EXISTS in this isolated world                        ✓
  //   · requestWindow() driven by an extension message, no page click
  //     → "Document PiP requires user activation"                           ✗
  //   · requestWindow() inside a real click handler on the page             ✓ floats
  //   · an iframe to a web-accessible extension page loads INSIDE that
  //     window even on a `default-src 'none'; frame-src 'none'` page        ✓
  //
  // So: the side panel asks, we put a real button on the page, the user's click
  // supplies the activation, and the floating window hosts popout.html — the
  // same extension page the side panel is, so nothing is duplicated and a strict
  // page CSP cannot reach it.
  const PIP_W = 360;
  const PIP_H = 520;
  let pipWindow = null;
  let armPill = null;

  function pipUsable() {
    try {
      return !!(window.documentPictureInPicture &&
        typeof window.documentPictureInPicture.requestWindow === 'function' &&
        window.top === window.self);
    } catch (e) {
      return false;
    }
  }

  function clearPill() {
    if (armPill) {
      armPill.remove();
      armPill = null;
    }
  }

  function showPill() {
    clearPill();
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.id = 'mm-tt-popout-pill';
    pill.textContent = '⧉ Float the Massmarket tracker';
    // Inline styles, deliberately: the host page's stylesheet must not be able to
    // hide or restyle the one control that makes the pop-out possible.
    pill.style.cssText = [
      'all:initial',
      'position:fixed',
      'top:14px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      // v0.11.3 — the brand's ink button: square, ink, paper text.
      'background:#0a0a0a',
      'color:#f2efe8',
      'border-radius:0',
      'padding:9px 16px',
      'font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      'box-shadow:0 6px 20px rgba(10,10,10,.35)',
      'cursor:pointer',
    ].join(';');
    pill.addEventListener('click', openPip);
    (document.body || document.documentElement).appendChild(pill);
    armPill = pill;
    // The prompt is not a trap: if it is ignored it goes away by itself.
    setTimeout(() => { if (armPill === pill) clearPill(); }, 20000);
  }

  async function openPip() {
    if (pipWindow) {
      try { pipWindow.focus(); } catch (e) { /* already gone */ }
      clearPill();
      return;
    }
    let win;
    try {
      // Must run inside the click's transient user activation — no awaits first.
      win = await window.documentPictureInPicture.requestWindow({ width: PIP_W, height: PIP_H });
    } catch (e) {
      // Genuinely could not open. Say so on the page, where the click happened.
      if (armPill) {
        armPill.textContent = `Chrome refused the floating window (${String((e && e.message) || e).slice(0, 60)})`;
        setTimeout(clearPill, 6000);
      }
      return;
    }
    clearPill();
    pipWindow = win;
    // Chrome does not always honour the requested size (measured 2026-08-11: a
    // 360x520 request opened at the opener's inner size, and Chrome clamps a
    // Document PiP window to a maximum fraction of the screen). Ask again once
    // the window exists AND once more after it has settled; if the window
    // manager refuses, the user can still drag the edge and the ⤡ / ⤢ buttons
    // still reach it.
    const fitWindow = () => { try { win.resizeTo(PIP_W, PIP_H); } catch (e) { /* ignore */ } };
    fitWindow();
    setTimeout(fitWindow, 300);

    try {
      win.document.title = 'Massmarket timers';
      const d = win.document;
      d.documentElement.style.cssText = 'height:100%';
      d.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#f2efe8';
      const frame = d.createElement('iframe');
      frame.src = chrome.runtime.getURL('popout.html');
      frame.style.cssText = 'border:0;display:block;width:100%;height:100%';
      frame.setAttribute('title', 'Massmarket Time Tracker');
      d.body.appendChild(frame);
    } catch (e) {
      try { win.close(); } catch (e2) { /* ignore */ }
      pipWindow = null;
      chrome.storage.local.set({ popoutOpen: false }).catch(() => {});
      return;
    }

    chrome.storage.local.set({ popoutOpen: true }).catch(() => {});

    // The popped-out page cannot resize its own host (different origin), so it
    // asks and we do it. Only messages from OUR extension origin are honoured.
    const extOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
    win.addEventListener('message', (ev) => {
      if (ev.origin !== extOrigin) return;
      const m = ev.data;
      if (!m || m.__mmPopout !== true) return;
      try {
        if (typeof m.w === 'number' && typeof m.h === 'number') win.resizeTo(m.w, m.h);
        else if (typeof m.dw === 'number' && typeof m.dh === 'number') win.resizeBy(m.dw, m.dh);
      } catch (e) { /* the window manager said no — the user can still drag the edge */ }
    });

    win.addEventListener('pagehide', () => {
      pipWindow = null;
      chrome.storage.local.set({ popoutOpen: false }).catch(() => {});
    });
  }

  // ⛔ TOP FRAME ONLY. With the script in every frame, a tabs.sendMessage the
  // worker sends WITHOUT a frameId reaches every frame of the tab, and the first
  // frame to answer wins — a sub-frame answering the pop-out probe (always "no"
  // there) or flushNow (always no rows) would shadow the top frame's real answer.
  // So a sub-frame registers no runtime.onMessage listener at all.
  if (isTopFrame) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === 'mmPopoutProbe') {
        sendResponse({ ok: pipUsable() });
        return false;
      }
      if (msg.type === 'mmPopoutArm') {
        if (!pipUsable()) {
          sendResponse({ ok: false, reason: 'restricted' });
          return false;
        }
        if (pipWindow) {
          try { pipWindow.focus(); } catch (e) { /* ignore */ }
          sendResponse({ ok: true, already: true });
          return false;
        }
        showPill();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });

    // F6: counts a sub-frame of this tab forwarded, relayed by the worker to
    // frameId 0 only. See mergeSubframeInput().
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'mm_merge_subframe_input') return false;
      mergeSubframeInput(msg);
      sendResponse({ ok: true });
      return false;
    });
  }

  // ---------------------------------------------------------------- wiring
  if (isTopFrame) {
    // Patch history so same-world SPA navigations start a new per-URL bucket.
    // (Content scripts run isolated, so page-triggered pushState in the MAIN world
    // won't hit this — the on-event checkUrl() and the minute tick cover that case:
    // real navigations are almost always click-driven, and clicks run checkUrl.)
    try {
      const wrap = (orig) => function wrapped() {
        const r = orig.apply(this, arguments);
        queueMicrotask(checkUrl);
        return r;
      };
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
    } catch (e) { /* ignore */ }
    window.addEventListener('popstate', checkUrl, true);
  }

  // Listeners are attached once and stay attached; each early-returns unless
  // capture is on, so nothing accumulates while inert. The five input listeners
  // are the SAME functions in both kinds of frame; in a sub-frame each one runs
  // the gate first (see "input bookkeeping").
  addEventListener('pointerdown', onPointerDown, true);
  if (isTopFrame) addEventListener('pointerdown', onQaPointerDown, true); // QA-capture (independent of capture)
  addEventListener('click', onClick, true);
  addEventListener('keydown', onKeyDown, true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('paste', onPaste, true);

  if (isTopFrame) {
    window.addEventListener('focus', onFocus, true);
    window.addEventListener('blur', onBlur, true);

    // Best-effort: on unload, flush the current partial minute + any buffered rows.
    window.addEventListener('pagehide', () => {
      if (capturing && bucket) {
        const row = finishBucket();
        if (row) {
          try { chrome.runtime.sendMessage({ type: 'activity', bucket: row }); } catch (e) { /* ignore */ }
        }
      }
      for (const row of outbox.splice(0)) {
        try { chrome.runtime.sendMessage({ type: 'activity', bucket: row }); } catch (e) { /* ignore */ }
      }
    });

    // Tab hidden (user switched away, minimized, or navigated): deliver the current
    // partial bucket right away instead of waiting for the next minute roll, then reset
    // it so the same clicks aren't counted again when the tab returns. The pagehide
    // handler above still covers hard unloads.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      if (!capturing || !bucket) return;
      closeBucket();
    }, true);

    // Deterministic flush: the service worker asks every injected tab for its final
    // rows right before it flushes /track, so the last partial-minute bucket isn't
    // lost to the async storage.onChanged timing. Settle + serialize the live bucket
    // (if it sends anything), drain the outbox, hand it all back in one response, and
    // clear both so the captureOn=false onChanged path can't re-send the same rows.
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'flushNow') return false;
      const rows = outbox.splice(0);
      const row = finishBucket();
      if (row) rows.push(row);
      sendResponse({ rows });
      return true; // async response channel
    });
  } else {
    // F6 gate: the real input that may make this frame's scroll events count.
    // Passive — they never delay or block a scroll.
    addEventListener('wheel', onScrollIntent, { capture: true, passive: true });
    addEventListener('touchstart', onScrollIntent, { capture: true, passive: true });
    addEventListener('touchmove', onScrollIntent, { capture: true, passive: true });

    // F6: a sub-frame's unforwarded counts go now rather than on the throttle,
    // when its document unloads or the tab is hidden.
    window.addEventListener('pagehide', forwardInput);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') forwardInput();
    }, true);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.captureOn) setCapturing(!!changes.captureOn.newValue);
    if (isTopFrame && changes.qaRunning) qaRunning = !!changes.qaRunning.newValue;
  });

  // Initialize from whatever the SW last published (the page may have loaded
  // mid-session, or mid-QA-walkthrough).
  (async () => {
    setCapturing(await readCaptureOn());
    if (!isTopFrame) return; // QA click-shots are a top-frame job
    try {
      const { qaRunning: q } = await chrome.storage.local.get('qaRunning');
      qaRunning = !!q;
    } catch (e) { /* storage unavailable — stay inert */ }
  })();
})();
