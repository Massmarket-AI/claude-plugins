// authstatus.js — what the Options page is allowed to SAY about this profile's
// token, derived from the background worker's record of what the SERVER said.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHY THIS FILE EXISTS: THE OPTIONS PAGE WAS GREEN FOREVER.
//
// `options.js load()` rendered "Connected as …" whenever `config.name` or
// `config.email` was present in chrome.storage.local. Both fields are written in
// exactly one place — a successful Connect — and nothing ever clears them. So the
// banner was not a reading of anything; it was a receipt for a handshake that may
// have happened weeks ago and may have been revoked an hour later. A member whose
// token the server now refuses opened Settings and read GREEN.
//
// ⛔ AND THE FIX IS NOT "ASK THE SERVER FROM HERE." Every authenticated call this
// extension makes carries `X-Ext-Version` and `X-Ext-Capture-State` (see
// apiFetch in common.js), and the server stamps them onto `team_auth_tokens` —
// which is what /api/ext/health then reports as "extension last reported". A call
// fired merely because somebody OPENED the settings page would stamp this machine
// as alive-and-current at precisely the moment its owner suspects it is not, and
// routing downstream would read that stamp as a green it never earned. So this
// page provokes NO network call. It asks the worker (`{type:'captureState'}`)
// for the answer the worker already holds, and renders that.
//
// ⛔ FAIL TO NEUTRAL, NEVER TO GREEN AND NEVER TO RED. There are exactly two
// states this page may assert: a sign-in the server confirmed recently, and a
// token the server REFUSED (HTTP 401 — the one signed-out reason that means
// "rejected" rather than "not asked yet"). Everything else — a profile the worker
// has never validated, a worker that could not be reached, a machine that has
// been offline, a confirmation too old to still be a confirmation — is `unknown`.
// A member on a train is not signed out, and telling them so would be the same
// defect pointed the other way.
//
// No `chrome.*` anywhere in this file, at module scope or inside it — same rule
// capture.js follows, and for the same reason: the predicate that decides what a
// member is told has to be testable without a browser.
// ═════════════════════════════════════════════════════════════════════════════

import { CAPTURE } from './capture.js';

/** The closed list of things the Options page may say. */
export const AUTH_VIEWS = Object.freeze(['first_run', 'confirmed', 'rejected', 'unknown']);

/**
 * How old a successful validation may be and still be shown as GREEN.
 *
 * ⛔ Derived from the worker's own cadence, not picked. background.js validates
 * at every service-worker start and then every `CAPTURE.VALIDATE_HOURS`, and
 * `shouldValidate()` lets a start-up validation through as soon as the stored
 * answer is that old — so a machine whose browser is open, or which has been
 * opened at all, refreshes this well inside one window. Two full windows with no
 * refresh means the worker has not managed to ask (asleep, offline, never woken),
 * and an answer nobody has been able to re-ask for that long is not a confirmation
 * any more. It is `unknown`.
 */
export const AUTH_CONFIRM_MAX_AGE_MS = 2 * CAPTURE.VALIDATE_HOURS * 60 * 60 * 1000;

/**
 * The Options page's view of this profile's token.
 *
 * @param {object}   args
 * @param {object|null} args.cfg      the stored config ({ apiBase, token, email, name })
 * @param {object|null} args.capture  the worker's capture state, or null when it
 *                                    could not be read (worker asleep, message failed)
 * @param {number}   args.nowMs
 * @returns {{view:'first_run'|'confirmed'|'rejected'|'unknown', name:string, email:string, confirmedAt:number}}
 */
export function authStatusView({ cfg, capture, nowMs } = {}) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const name = typeof c.name === 'string' ? c.name : '';
  const email = typeof c.email === 'string' ? c.email : '';
  const out = (view, confirmedAt = 0) => ({ view, name, email, confirmedAt });

  // ⛔ NO TOKEN IS NOT A FAILURE. A fresh install, and a profile whose token was
  // cleared, are the same thing from here: nobody has been refused, because
  // nobody has asked. Saying "rejected" to someone who has never connected would
  // send them hunting for a problem with a token that does not exist.
  const token = typeof c.token === 'string' ? c.token.trim() : '';
  if (!token) return out('first_run');

  if (!capture || typeof capture !== 'object') return out('unknown');

  if (capture.signedIn === true) {
    const at = Number(capture.validatedAt) || 0;
    const age = (Number(nowMs) || 0) - at;
    // `age < 0` is a clock that moved backwards, which is not evidence of
    // anything. It lands in `unknown` with every other unreadable case.
    if (at > 0 && age >= 0 && age <= AUTH_CONFIRM_MAX_AGE_MS) return out('confirmed', at);
    return out('unknown');
  }

  // ⛔ ONLY a 401. `missing_token` and `cleared` describe this machine's own
  // storage, not the server's answer, and the worker also starts every fresh
  // profile signed-out-with-no-reason — none of those is a refusal.
  if (capture.signedOutReason === '401') return out('rejected');
  return out('unknown');
}
