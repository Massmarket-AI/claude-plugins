// capturecard.js — the capture notice and the pause control, built once,
// mounted by every surface.
//
// ⛔ ONE IMPLEMENTATION, FOR THE SAME REASON consentcard.js IS ONE. This is the
// second privacy surface in the extension, and the first one that gates a
// capture stream. The words a member reads before anything is recorded have to
// be the words that were approved, on whichever surface they happen to be
// looking at. A copy of this card written into popup.html would be a second
// place for those sentences to be softened, wrapped, or updated on one surface
// and not the other — so there is one builder, using createElement, and the
// strings live frozen in capture.js next to the gate they describe.
//
// ⛔ THE COPY IS NOT AN EXECUTOR'S TO EDIT. CAPTURE_NOTICE.body and the two
// notification strings are verbatim. See the header on capture.js.
//
// ⛔ AND THE CARD DOES NOT HIDE ITSELF WHILE IT IS STILL ASKING. v0.10.0's
// consent card disappeared once it had written a key nothing read, and its
// disappearance is what taught nine members they were covered when they were
// dark. This card disappears only when the acknowledgement it is asking for
// actually exists — which is the same fact the gate reads. There is no second
// "dismissed" flag it could hide behind.

import {
  CAPTURE_NOTICE,
  captureGate,
  shouldShowNotice,
} from './capture.js';

/**
 * The pause control's labels and the one-line state sentence beside it.
 *
 * ⛔ FLAGGED AS THE EXECUTOR'S, deliberately, rather than folded into
 * CAPTURE_NOTICE where they would look approved. They name affordances and
 * report state; they make no promise about what is recorded, which is the only
 * thing CAPTURE_NOTICE is allowed to do.
 */
export const CAPTURE_AFFORDANCE = Object.freeze({
  pause: 'Pause capture',
  resume: 'Resume capture',
  heading: 'Automatic capture',
  stateCapturing: 'Capturing while you are signed in.',
  statePaused: 'Paused. Nothing is being recorded.',
  stateSignedOut: 'Signed out. Nothing is being recorded.',
  stateNotAcknowledged: 'Not started yet.',
});

const NOTICE_H_ID = 'mm-capture-h';

/** Map the gate's reason to the one sentence under the control. */
function stateText(gate) {
  if (gate.on) return CAPTURE_AFFORDANCE.stateCapturing;
  if (gate.reason === 'paused') return CAPTURE_AFFORDANCE.statePaused;
  if (gate.reason === 'signed_out') return CAPTURE_AFFORDANCE.stateSignedOut;
  return CAPTURE_AFFORDANCE.stateNotAcknowledged;
}

/**
 * Does the capture card stand ABOVE the surface, or live inside the status line's
 * detail?
 *
 * ⛔ D3 (Rob, 2026-09-14): "setup cards vanish once done — capture notice gone
 * after acknowledgment." Above the surface only while the member has something to
 * do: the notice is unacknowledged, or the profile is signed out. Acknowledged —
 * capturing or paused — the card leaves the top of the surface and its pause /
 * resume control is mounted inside the status line's expandable detail, so the
 * member's right to pause is still one click from every surface.
 */
export function captureCardAbove(state) {
  if (shouldShowNotice(state)) return true;
  return captureGate(state).reason === 'signed_out';
}

/**
 * Build the card into `host`.
 *
 * Two shapes, one card:
 *   * NOT acknowledged → the notice plus its single button. No pause control:
 *     there is nothing to pause, and offering one would imply capture had
 *     already started.
 *   * acknowledged → the pause/resume control and the state line.
 *
 * @param {Document} doc     the document that owns `host`
 * @param {Element}  host    mount point — emptied first
 * @param {object}   opts    { state, onAcknowledge(), onTogglePause(paused) }
 * @returns {{ destroy: Function }}
 */
export function renderCaptureCard(doc, host, { state, onAcknowledge, onTogglePause } = {}) {
  if (!host) return { destroy() {} };
  host.textContent = '';

  const card = doc.createElement('section');
  card.className = 'mm-capture';
  // A group, not a dialog. It does not trap focus and does not sit over the
  // surface: a member mid-timer must never be locked out of Stop by it.
  card.setAttribute('role', 'group');
  card.setAttribute('aria-labelledby', NOTICE_H_ID);

  const h = doc.createElement('h2');
  h.className = 'mm-capture-h';
  h.id = NOTICE_H_ID;
  h.textContent = CAPTURE_AFFORDANCE.heading;
  card.appendChild(h);

  if (shouldShowNotice(state)) {
    // ── the one-time notice ────────────────────────────────────────────────
    const p = doc.createElement('p');
    p.className = 'mm-capture-body';
    // ⛔ textContent, never innerHTML. This paragraph is the approved statement
    // and it renders as one paragraph exactly as written.
    p.textContent = CAPTURE_NOTICE.body;
    card.appendChild(p);

    const ack = doc.createElement('button');
    ack.type = 'button';
    ack.className = 'mm-capture-ack';
    ack.textContent = CAPTURE_NOTICE.button;
    ack.addEventListener('click', () => {
      ack.disabled = true;
      try {
        const r = onAcknowledge && onAcknowledge();
        if (r && typeof r.catch === 'function') r.catch(() => { ack.disabled = false; });
      } catch (e) {
        ack.disabled = false;
      }
    });
    card.appendChild(ack);
    host.appendChild(card);
    return { destroy() { host.textContent = ''; } };
  }

  // ── the pause control ────────────────────────────────────────────────────
  const gate = captureGate(state);
  const paused = !!(state && state.paused);

  const line = doc.createElement('p');
  line.className = 'mm-capture-state';
  line.setAttribute('role', 'status');
  line.textContent = stateText(gate);
  card.appendChild(line);

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'mm-capture-toggle';
  btn.textContent = paused ? CAPTURE_AFFORDANCE.resume : CAPTURE_AFFORDANCE.pause;
  // Two controls with the same job on two surfaces; the heading is the
  // accessible description so a screen reader announces which capture it means
  // using only words that were approved.
  btn.setAttribute('aria-describedby', NOTICE_H_ID);
  btn.addEventListener('click', () => {
    btn.disabled = true;
    try {
      const r = onTogglePause && onTogglePause(!paused);
      if (r && typeof r.catch === 'function') r.catch(() => { btn.disabled = false; });
    } catch (e) {
      btn.disabled = false;
    }
  });
  card.appendChild(btn);

  host.appendChild(card);
  return { destroy() { host.textContent = ''; } };
}
