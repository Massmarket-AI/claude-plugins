// sidepanel.js — THE surface.
//
// v0.7.0 this was a timer readout. It is now the complete inventory: the
// three-indicator status row, the running timers, and one card per client
// carrying everything that person owes that client — always populated, whether
// or not a timer is running. All of that is built by panelapp.js, which the
// popped-out window mounts too, so the two can never drift.
//
// v0.8.6 — Stop lives HERE too (Asif, via Rob, 2026-08-13: "the sidebar doesn't
// have a stop button on it ... both the pop-up and the sidebar need to have the
// stop buttons"). The reason it did not, up to v0.8.5, was real and still holds:
// Stop runs the early/QA gate, and a second copy of that flow would be a way
// around it. So there is no second copy. The gate's rules live in common.js and
// BOTH surfaces call them; the panel arms `pendingQaFinalize` exactly as the popup
// does and then points at the popup, which already renders that prompt on open.
// Start and Stop both go through the SAME service-worker messages the popup uses.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⛔ POP-OUT — what was actually wrong, and what the fix is.
//
// v0.7.0 feature-detected the PRESENCE of window.documentPictureInPicture
// (sidepanel.js:146-152). That object EXISTS in a side panel, so the button
// always rendered; requestWindow() then rejected and the catch hid the button.
// Rob saw exactly that: a button at 08:08, a click, nothing, gone by 08:13.
//
// The lesson worth keeping: feature-detect an API's USABILITY IN THIS CONTEXT,
// never its mere presence. A button that cannot work must never be drawn.
//
// Measured 2026-08-11 (scratchpad/pipprobe, Chromium 1228):
//   · documentPictureInPicture EXISTS in a content script's isolated world  ✓
//   · requestWindow() from a content script driven by an extension message
//     → "Document PiP requires user activation"                            ✗
//   · requestWindow() inside a real click handler ON THE PAGE               ✓ floats
//   · chrome.sidePanel.open() itself needs a gesture; the panel is not even a
//     debuggable target
//
// So the call is routed to a context that CAN serve it — a content script in the
// active tab — and the one click that grants activation happens there, on an
// affordance we put in front of the user. The button in this panel is only drawn
// when the service worker confirms there is an eligible http(s) tab to host it.
// ─────────────────────────────────────────────────────────────────────────────

import { mountPanel } from './panelapp.js';

const $ = (sel) => document.querySelector(sel);

let app = null;
let popoutBtn = null;
let popoutNote = null;

// ── pop-out ──────────────────────────────────────────────────────────────────

/**
 * Is a pop-out possible RIGHT NOW? Not "does the API exist" — that question is
 * what shipped the dead button. The service worker answers with the tab that
 * would host it, or the reason there isn't one.
 */
async function popoutProbe() {
  try {
    return await chrome.runtime.sendMessage({ type: 'popoutProbe' });
  } catch (e) {
    return { ok: false, reason: 'no_worker' };
  }
}

const REASON_TEXT = {
  no_tab: 'Pop-out needs a normal web page open in this window. Switch to a tab and reopen this panel.',
  restricted:
    'The tab in front of you is a Chrome page (chrome://, the Web Store, or a PDF viewer), and extensions cannot run there. Switch to a normal site and reopen this panel.',
  no_worker: 'The tracker’s background worker is not responding — reload the extension.',
};

async function refreshPopoutAffordance() {
  const probe = await popoutProbe();
  if (probe && probe.ok) {
    popoutBtn.classList.remove('hidden');
    popoutNote.textContent =
      'Opens a small window that floats above your other apps. Chrome requires one click on the page itself to allow it — we put a button there for you.';
    popoutNote.classList.remove('hidden');
    return;
  }
  popoutBtn.classList.add('hidden');
  popoutNote.textContent = REASON_TEXT[(probe && probe.reason) || 'no_tab'] || REASON_TEXT.no_tab;
  popoutNote.classList.remove('hidden');
}

async function onPopOut() {
  popoutBtn.disabled = true;
  popoutBtn.textContent = 'Waiting for your click on the page…';
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'popoutArm' });
  } catch (e) {
    res = { ok: false, reason: 'no_worker' };
  }
  if (res && res.ok) {
    popoutNote.textContent =
      'Click the “Float the Massmarket tracker” button now showing on the page. Chrome only allows a floating window from a click on the page itself.';
    popoutNote.classList.remove('hidden');
    setTimeout(() => {
      popoutBtn.disabled = false;
      popoutBtn.textContent = '⧉ Pop out (floats above other apps)';
    }, 1500);
    return;
  }
  popoutBtn.disabled = false;
  popoutBtn.textContent = '⧉ Pop out (floats above other apps)';
  popoutNote.textContent = REASON_TEXT[(res && res.reason) || 'no_tab'] || REASON_TEXT.no_tab;
  popoutNote.classList.remove('hidden');
  await refreshPopoutAffordance();
}

// ── open the toolbar popup (Chrome 127+) ─────────────────────────────────────
function openPopupSupported() {
  return !!(chrome.action && typeof chrome.action.openPopup === 'function');
}

// ── boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  app = mountPanel(document, $('#mm-root'), { mode: 'panel' });

  const actions = app.actionsHost;
  const mkBtn = (label, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mm-btn ${cls || ''}`.trim();
    b.textContent = label;
    actions.appendChild(b);
    return b;
  };

  const refreshBtn = mkBtn('↻ Refresh tasks');
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
    await app.refresh(true);
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ Refresh tasks';
  });

  popoutBtn = mkBtn('⧉ Pop out (floats above other apps)');
  popoutBtn.classList.add('hidden');
  popoutBtn.addEventListener('click', onPopOut);

  if (openPopupSupported()) {
    const openPopup = mkBtn('Open the tracker to start or stop');
    openPopup.addEventListener('click', async () => {
      try {
        await chrome.action.openPopup();
      } catch (e) {
        openPopup.classList.add('hidden');
      }
    });
  }

  popoutNote = document.createElement('p');
  popoutNote.className = 'mm-note hidden';
  actions.appendChild(popoutNote);

  await refreshPopoutAffordance();
  // The eligible-tab answer changes as the user moves around; re-ask when the
  // panel regains focus rather than polling.
  window.addEventListener('focus', refreshPopoutAffordance);
});
