// cardclose.js — the ONE implementation of "close this block out" on a client card.
//
// ⛔ WHY THIS FILE EXISTS, AND WHY IT IS NOT A NEW ENDPOINT.
//
// A churned client's task keeps being served — it sits in the ranked feed, it keeps
// being minted, and the extension had no action that ends it. The member's only
// exits were to clock in on work that no longer exists, or to ignore a card forever.
//
// The route this calls has been live since 2026-08-06: POST
// /api/ext/block-complete-note, the same one the stop-flow's "No QA required" step
// already posts to (popup.js onNoQaSubmit). It marks the block `completed`, stamps
// `qa_posted_at` (COALESCE — first close wins) and `qa_attested_by`, and records the
// note as a `public.time_worklogs` row with `source='no_qa_note'`, so the closure is
// auditable and lands in the owner-report coverage rollup. Nothing new is written,
// no migration, no second write path.
//
// ⛔ WHAT IT DELIBERATELY IS NOT.
//
//  · NOT a claim. cardstart.js:85 — "there is no Claim button anywhere and there is
//    not meant to be one"; the chip IS the claim mechanism. Firing a claim from a
//    card would acknowledge up to 40 ack-ladder rows for the group and silence the
//    alarm that tells Rob work is going unattended. This route touches ONE block.
//  · NOT a bulk close. One block, one note, one press.
//  · NOT silent. The route classifies the close (no-qa-reason.ts): a meaningful
//    reason plus tracked time is SANCTIONED and passes quietly; no reason, garbage,
//    or zero tracked time still DMs the PM and lands in the ⚠️ Board section. So a
//    member cannot use this to make real work disappear, and this file must never
//    pretend otherwise in what it shows them.

import { apiFetch, getTimers, timerKey } from './common.js';

//  · NOT AVAILABLE ON A BLOCK THAT IS ON THE CLOCK. ⛔ Added 2026-09-13, and it is
//    the one guard this file cannot leave to a surface. The side panel renders the
//    task list whether or not a timer is running (panelapp.js renderTaskList), so a
//    member who is clocked into a block can reach its close-out button while the
//    clock is still going. The route marks the block `completed` and stamps
//    `qa_posted_at` with a COALESCE — FIRST CLOSE WINS — so the close would land
//    mid-session, and the delivery-QA that arms when they finally press Stop would
//    then be recorded against a block already closed with "no QA required". There
//    is no undo for that: the stamp cannot be taken back from here. Stop first.
//
//    It is checked HERE rather than by hiding the button, because a timer can start
//    on another surface after the card was drawn. A control that was safe when it
//    was rendered is not the same as a control that is safe when it is pressed.

/**
 * @param {object}   o
 * @param {object}   o.target   card.startable — MUST be kind:'block'
 * @param {string}   o.note     the member's line, already trimmed and length-checked
 * @param {Function} [o.fetcher] injectable for tests; defaults to common.js apiFetch
 * @param {Function} [o.timers]  injectable for tests; defaults to common.js getTimers
 * @returns {Promise<{ok:boolean, status:number|null, error:string}>}
 */
export async function closeOutBlock({ target, note, fetcher, timers }) {
  const call = fetcher || apiFetch;
  const readTimers = timers || getTimers;
  if (!target || target.kind !== 'block' || !target.block_id) {
    // Structural, not a server error: the button is only rendered for a block-kind
    // card (panelui.js), so reaching here means the card shape changed under us.
    return { ok: false, status: null, error: 'no_block' };
  }
  // ⛔ NEVER TIMED → NOT CLOSED FROM HERE (2026-09-14, lane L4b). The button is not
  // drawn for such a block (panelui.js), and this is the same rule at the press, for
  // a card built by anything that did not go through that render. Nothing is sent.
  // See taskfeed.js blockWasTimed() for why the route's check is not enough.
  if (target.timed !== true) {
    return { ok: false, status: null, error: 'never_timed' };
  }
  // ⛔ THE CLOCK IS CHECKED AT THE PRESS, NOT AT THE RENDER. See the block above.
  // A storage read that throws is NOT a licence to proceed: an irreversible write
  // whose one precondition could not be checked does not get to assume the
  // precondition held. Fails closed, like every other gate in this extension.
  let running;
  try {
    running = await readTimers();
  } catch (e) {
    return { ok: false, status: null, error: 'clock_unknown' };
  }
  const key = timerKey(target.block_id, null);
  if (Array.isArray(running) && running.some((t) => t && String(t.key) === key)) {
    return { ok: false, status: null, error: 'clock_running' };
  }
  try {
    await call('/api/ext/block-complete-note', {
      method: 'POST',
      body: { block_id: String(target.block_id), note },
    });
    return { ok: true, status: 200, error: '' };
  } catch (e) {
    return { ok: false, status: e && e.status ? e.status : null, error: 'request_failed' };
  }
}
