// popout.js — the popped-out surface.
//
// It mounts the EXACT SAME app as the side panel (panelapp.js), so the floating
// window carries everything the panel has: the three-indicator status row, the
// running timers, and one card per client with the full enumeration and the
// Start-copies-the-chip behaviour. `mode: 'pip'` only adds the zoom / size /
// settings bar.
//
// Resizing is asked for, not done: this page is same-origin with the extension
// and cross-origin with the floating window that hosts it, so it posts the
// request up to content.js, which owns the window handle.

import { mountPanel } from './panelapp.js';

function onResize(req) {
  try {
    window.parent.postMessage({ __mmPopout: true, ...req }, '*');
  } catch (e) {
    /* no parent (opened directly for testing) — dragging the edge still works */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  mountPanel(document, document.getElementById('mm-root'), { mode: 'pip', onResize });
});
