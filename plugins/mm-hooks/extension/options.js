// options.js — Connect flow. Validates the API URL + token against /api/ext/auth
// and stores { apiBase, token, email, name } in chrome.storage.local on success.
//
// ⛔ THE BANNER IS A READING, NOT A RECEIPT (v0.11.2). Until this release `load()`
// painted the green "Connected as …" line off `config.name` / `config.email` —
// fields written once, on a successful Connect, and cleared by nothing. Once the
// server started refusing a token the banner stayed green for as long as the
// profile existed. It now renders `authStatusView()` over the state the BACKGROUND
// WORKER holds: green only on a sign-in the server confirmed and confirmed
// recently, red only on a 401, neutral otherwise, and the first-run line when
// there is no token at all.
//
// ⛔ AND IT ASKS THE WORKER RATHER THAN THE SERVER. `{type:'captureState'}` is a
// storage read — no fetch. The worker keeps that state current on its own schedule
// (service-worker start, every 4h, and on any 401 raised by any surface), so the
// answer is already there. Calling /api/ext/auth from here instead would stamp
// `X-Ext-Version` and `X-Ext-Capture-State` onto team_auth_tokens every time
// somebody opened Settings — telling the server this machine is alive and current
// at exactly the moment its owner has come here because they suspect it is not.
// See the header of authstatus.js.

import { getConfig, setConfig, apiFetch, DEFAULT_API_BASE } from './common.js';
import { authStatusView } from './authstatus.js';

const $ = (sel) => document.querySelector(sel);

// ⛔ EVERY STRING HERE WAS AUTHORED BY OPUS FOR EXT #13 AND PLACED ON 2026-09-22 —
// the `OPUS_COPY —` note above each one is the brief it was written to, not an
// unfilled slot. A new string takes the same route, authored first and then placed,
// and is never written inline. `confirmed` is the ONE exception and is marked as
// such: it is the shipped v0.10 sentence, reused verbatim, because the sentence was
// never the bug — the condition it was drawn under was.
const AUTH_COPY = Object.freeze({
  // OPUS_COPY — the neutral line when the extension cannot currently confirm the
  // token either way (worker never validated this profile, machine offline, or
  // the last confirmation is older than two validation windows).
  unknown: 'Your token has not been checked recently, so we cannot confirm it right now. This is not a sign-out, and nothing is known to be wrong with it.',
  // OPUS_COPY — the red line when the SERVER refused the stored token (HTTP 401).
  rejected: 'The server turned down the token saved here, so this extension is signed out. Paste a current token into Member token and click Connect.',
  // OPUS_COPY — the plain first-run line when no token is stored at all.
  firstRun: 'Nothing is connected yet, which is expected on a new install. Paste the token you were given into Member token and click Connect.',
});

/** The shipped green sentence, unchanged. Only the condition around it changed. */
function connectedLine(name, email) {
  return `Connected as ${name || 'member'}${email ? ` (${email})` : ''}`;
}

function setStatus(message, kind /* 'ok' | 'err' | 'info' | 'plain' */) {
  const el = $('#status');
  el.textContent = message;
  el.className = `status ${kind || 'info'}`;
}

/** Paint one of the four views. The ONLY place the banner's colour is chosen. */
function paintAuthView(v) {
  if (v.view === 'confirmed') return setStatus(connectedLine(v.name, v.email), 'ok');
  if (v.view === 'rejected') return setStatus(AUTH_COPY.rejected, 'err');
  if (v.view === 'first_run') return setStatus(AUTH_COPY.firstRun, 'plain');
  return setStatus(AUTH_COPY.unknown, 'info');
}

/**
 * The worker's capture state, or null when it cannot be had.
 *
 * ⛔ NULL IS NOT SIGNED OUT. A worker that does not answer (torn down mid-update,
 * an older build, a message that threw) tells us nothing about the token, and
 * authStatusView() turns null into `unknown`. Reading silence as a sign-out would
 * put a red banner in front of every member during a routine reload.
 */
async function readCaptureState() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'captureState' });
    return r && r.ok && r.capture && typeof r.capture === 'object' ? r.capture : null;
  } catch (e) {
    return null;
  }
}

async function load() {
  const cfg = await getConfig();
  $('#apiBase').value = cfg.apiBase || DEFAULT_API_BASE;
  if (cfg.token) $('#token').value = cfg.token;
  paintAuthView(authStatusView({ cfg, capture: await readCaptureState(), nowMs: Date.now() }));
}

async function connect() {
  const apiBase = $('#apiBase').value.trim().replace(/\/+$/, '');
  const token = $('#token').value.trim();
  if (!apiBase || !token) {
    setStatus('Enter both the API URL and your member token.', 'err');
    return;
  }
  if (!/^https?:\/\//i.test(apiBase)) {
    setStatus('The API URL should start with https://', 'err');
    return;
  }

  $('#connect').disabled = true;
  setStatus('Connecting…', 'info');
  try {
    const who = await apiFetch('/api/ext/auth', { method: 'POST', body: {}, auth: { apiBase, token } });
    await setConfig({ apiBase, token, email: who.email || '', name: who.name || '' });
    // ⛔ THE ONE PLACE THIS PAGE MAY ASSERT GREEN ON ITS OWN. The 200 that just
    // came back IS a confirmed sign-in — the freshest one obtainable, a moment
    // old, from a call the member deliberately asked for. Re-reading the worker
    // here would show `unknown` until its next scheduled validation and tell
    // somebody who just connected successfully that we could not confirm them.
    setStatus(connectedLine(who.name || '', who.email || ''), 'ok');
    // ⛔ AND TELL THE WORKER, OR THIS PAGE IS THE ONLY THING THAT KNOWS.
    //
    // The worker holds the capture state every other surface reads — the badge,
    // the health strip, the feed lane, and this page's own banner on the NEXT
    // open. Nothing here used to update it: connect() wrote the config and
    // stopped, and the only thing that ever woke the worker about auth was the
    // 401 watcher. So a member who took a 401, pasted a current token and
    // connected successfully still had `signedOutReason: '401'` in storage — a
    // red badge, capture stopped, and a red "the server refused this token"
    // banner the next time they opened this page, for up to four hours.
    //
    // One message, and no second network call: the 200 above IS the proof, and
    // the worker folds it in through the same transition its own 4-hourly check
    // uses. Fire-and-forget — a worker that cannot be reached is not a reason to
    // take back a sign-in the server just confirmed, and its next scheduled
    // validation reaches the same answer anyway.
    chrome.runtime.sendMessage({ type: 'authConfirmed' }).catch(() => {});
  } catch (e) {
    if (e.status === 401) setStatus('That token was rejected (HTTP 401). Double-check it.', 'err');
    else if (e.status) setStatus(`Connection failed (HTTP ${e.status}).`, 'err');
    else setStatus('Could not reach that API URL. Check it and try again.', 'err');
  } finally {
    $('#connect').disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#connect').addEventListener('click', connect);
  $('#token').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  load();
});
