// cardstart.js — the ONE implementation of "Start" on a client card.
//
// ⛔ WHY THIS FILE EXISTS.
//
// Three surfaces now draw the SAME client card (panelui.js buildCard): the side
// panel, the popped-out window, and — since v0.8.3 — the toolbar popup's idle
// view. Pressing Start on that card has to mean the same thing in all three:
//
//   1. clock in on the card's next real calendar block (the only kind of item
//      this extension can attach a timer to), then
//   2. put the COMPLETE chip on the clipboard, and
//   3. say which of those two actually happened — including "the timer failed but
//      you still have the chip", because that is the true state and silence about
//      it is how people lose an hour, and including "that clock was already
//      running", which is a success and must never be reported as a failure.
//
// This was a private function inside panelapp.js until v0.8.3. The popup could not
// call it, so making the popup render the same cards would have meant a second
// copy — and a second copy of exactly this kind of logic is how the popup and the
// panel came to disagree about the same task in the first place (Rob, 2026-08-12:
// "the view of the tasks I'm getting when I first open the extension is very
// different from the view inside the side panel"). panelui.js:1-8 already states
// the rule for the renderer; this is the same rule for the behaviour behind it.
//
// The surface keeps only what is genuinely its own: `onStarted` (the panel
// refreshes its feed, the popup switches to the running view).
//
// ⛔ Every member-facing string in this file was authored by Opus for EXT #13 and
// placed on 2026-09-22 — the `OPUS_COPY —` note above each one is the brief it was
// written to, not an unfilled slot. A new string takes the same route, authored
// first and then placed, and is never written inline here.

import { chipTextFor } from './taskfeed.js';
import { cardError, copyText, showCopyFallback, showToast } from './panelui.js';

/**
 * Put a card's chip on the clipboard and SAY SO. The one implementation, shared by
 * card Start (below) and by the standalone copy control the action row grew in
 * v0.12.0 — same chip text, same toast, same denied-clipboard fallback, whether or
 * not a clock was involved.
 *
 * ⛔ A DENIED CLIPBOARD IS NOT A SILENT FAILURE. copyText() returns null when both
 * paths are refused; the caller must show the text in a selectable field, which is
 * what showCopyFallback does. Losing the chip quietly is the whole reason this
 * function reports rather than returns a boolean nobody reads.
 *
 * @returns {Promise<'clipboard'|'exec'|null>} how the copy landed, or null
 */
export async function copyCardChip({ card, art, doc, memberEmail, apiBase, chip, alreadyRunning = false }) {
  const text = chip != null ? chip : chipTextFor(card, { memberEmail, apiBase });
  const how = await copyText(text, doc);
  if (how) {
    showToast(doc, alreadyRunning
      // OPUS_COPY — toast after pressing Start on a card whose clock was ALREADY
      // running. Must convey: this is not an error, the clock was already going,
      // and the chip is on your clipboard again. Must NOT read as a failure and
      // must NOT say a new timer started.
      ? 'Already on the clock. The chip is on your clipboard again; paste it into Claude Code.'
      // OPUS_COPY — toast after the chip lands on the clipboard. Must convey: the
      // chip is copied, paste it into Claude Code. Short. Must NOT claim the task
      // is claimed — pasting is what claims it.
      : 'Chip copied. Paste it into Claude Code.');
  } else {
    showCopyFallback(art, text);
    // OPUS_COPY — toast when the browser refused BOTH clipboard paths. Must
    // convey: the copy was blocked, and the chip text is now shown below for the
    // member to select and copy by hand. Must NOT blame the member.
    showToast(doc, 'Your browser blocked the copy. The chip text is below: select it and copy it by hand.');
  }
  return how;
}

/**
 * @param {object}   o
 * @param {object}   o.card         a card from buildCards()
 * @param {Element}  o.btn          the Start button (disabled for the duration)
 * @param {Element}  o.art          the card element (hosts the error line / copy fallback)
 * @param {Document} o.doc          the document that owns `art` — the pop-out is a DIFFERENT document
 * @param {string}   o.memberEmail  stamped into the chip footer
 * @param {string}   o.apiBase      OW origin, for the chip's curl lines
 * @param {Function} [o.send]       message transport; defaults to chrome.runtime.sendMessage
 * @param {boolean}  [o.versionBlocked] this build is below the server's min_supported_version.
 *                                  Gates the CLOCK ONLY — the chip is still copied. See below.
 * @param {Function} [o.onStarted]  called with the start response when a timer is live
 *                                  because of this press — a fresh start OR a block
 *                                  that was already running
 * @returns {Promise<{started:boolean, alreadyRunning:boolean, copied:boolean, error:string}>}
 */
export async function startCard({ card, btn, art, doc, memberEmail, apiBase, send, onStarted, versionBlocked }) {
  const post = send || ((msg) => chrome.runtime.sendMessage(msg));
  if (btn) btn.disabled = true;
  cardError(art, '');
  const chip = chipTextFor(card, { memberEmail, apiBase });

  let startErr = '';
  let started = false;
  let alreadyRunning = false;
  let res = null;
  // ⛔ EDIT 4c — `card.startable`, not `card.startableBlock`, and it has TWO kinds.
  //
  //   kind:'block'   → {blockId} — unchanged, still preferred. A block carries a
  //                    schedule, an estimate and a deliverable ref a bare project
  //                    does not, so the server picks it whenever one exists.
  //   kind:'project' → {projectId} — the client itself. /api/ext/track has accepted
  //                    this since 2026-08-12 (`time_entries.project_id` is a
  //                    nullable FK that existed all along; no migration).
  //   null           → no clock. NOT an error, and not a fallback to guessing:
  //                    the members disagree about which project they belong to, and
  //                    clocking work onto a guessed client is worse than not
  //                    clocking it. The button already says "Copy chip".
  //
  // ⛔ THE VERSION FLOOR GATES THE CLOCK, NOT THE CHIP.
  //
  // Until now `blockStartForVersion` was applied in exactly one place —
  // popup.js:508, `$('#start').disabled` — the legacy block-picker button. Card
  // Start, which is the surface all three views actually use, had no version
  // check at all, so raising `min_supported_version` disabled a button almost
  // nobody presses and left every real Start working. The floor was decorative.
  //
  // Closing that hole has to respect what this function actually does. It does
  // TWO things, and only one of them is a clock:
  //
  //   the timer  → writes a time_entry. An out-of-date build can write one the
  //                server cannot trust, which is exactly what the floor is for.
  //   the chip   → goes on the clipboard, gets pasted into Claude Code, and the
  //                pasted prompt is what CLAIMS the task. That is the whole claim
  //                mechanism; there is no Claim button anywhere and there is not
  //                meant to be one.
  //
  // So a blanket `disabled` on the card Start would have blocked claiming to
  // enforce a timer rule — taking away the one path that still works from the
  // person least able to fix it, since a blocked build is by definition one the
  // member has not been able to update. The floor stops the clock and says so;
  // the chip is copied either way.
  const target = versionBlocked ? null : (card.startable || null);
  if (versionBlocked) {
    startErr = 'This version is too old to clock in — update the extension. The chip was still copied, so you can still claim the task.';
  }
  if (target) {
    try {
      res = await post({
        type: 'start',
        blockId: target.kind === 'block' ? String(target.block_id) : null,
        projectId: target.kind === 'project' ? String(target.project_id) : null,
        note: '',
        // A project has no scheduled end to gate the "scheduled time is up" alarm
        // on, so it sends none rather than inventing one.
        scheduledEnd: target.kind === 'block' ? (target.due || null) : null,
        title: target.label || '',
        internalCategory: null,
      });
      if (res && res.started === false && res.reason === 'cap') {
        startErr = 'You already have 4 blocks running — stop one before starting another. The chip was still copied.';
      } else if (res && res.started === false && res.reason === 'already_open') {
        // ⛔ NOT A FAILURE — the clock this card would start is ALREADY running.
        //
        // background.js startTimer() no-ops rather than double-starting a block
        // (`{ started:false, reason:'already_open' }`), and the onMessage handler
        // flattens that to `ok: r.started !== false` — ok:false with no `error`
        // string. Without this branch it fell through to the generic `!res.ok`
        // case below and painted "Could not start the timer." over a live,
        // correctly-running timer. An error that describes a success is worse
        // than no message: it teaches people to distrust the surface that is
        // telling them the truth (fresh-eyes QA, 2026-08-12).
        //
        // Every other Start path already knew this — popup.js onStart
        // ("already_open — just show the list") and onNextUpGo both branch on
        // `started === false` BEFORE looking at ok. This file was extracted from
        // panelapp.js in v0.8.3 and never got that branch. Now it has it, once,
        // for all three surfaces.
        alreadyRunning = true;
      } else if (res && !res.ok) {
        startErr = `${(res && res.error) || 'Could not start the timer.'} The chip was still copied.`;
      } else {
        started = true;
      }
    } catch (e) {
      startErr = 'Could not reach the tracker to start a timer. The chip was still copied.';
    }
  }

  const how = await copyCardChip({ card, art, doc, memberEmail, apiBase, chip, alreadyRunning });
  if (startErr) cardError(art, startErr);
  if (btn) btn.disabled = false;

  // A timer is live because of this press either way, so the surface should do
  // what it does after a start: the popup shows the running clock, the panel
  // re-reads the feed. `started` stays false — it means "a NEW timer began" and
  // the return contract should not blur that.
  if ((started || alreadyRunning) && typeof onStarted === 'function') onStarted(res);
  return { started, alreadyRunning, copied: !!how, error: startErr, versionBlocked: !!versionBlocked };
}
