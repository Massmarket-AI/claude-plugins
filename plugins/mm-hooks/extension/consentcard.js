// consentcard.js — the Claude Code setup card, built once, mounted by every surface.
//
// ⛔ WHY THIS IS ITS OWN FILE, AND WHY IT IS BUILT RATHER THAN WRITTEN IN HTML.
//
// This is the one piece of the extension that walks a member through choosing
// the folders their work is recorded from, and "right" here is not a rendering
// property — it is that the words a member reads are the words that were
// approved, on whichever surface they happen to be looking at. A second copy of
// this card in popup.html would be a second place for those sentences to be
// softened, wrapped, or quietly updated on one surface and not the other. So
// there is one implementation, built with createElement, and the strings live in
// a frozen object next to it.
//
// ⛔ SETUP_COPY IS VERBATIM AND IS NOT AN EXECUTOR'S TO EDIT. Not the wording,
// not the capitalisation, not the punctuation. If a string here needs to change,
// that is a decision for the person who owns the copy, not a refactor.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHAT 0.11.3 CHANGED, AND WHY (Rob, 2026-09-28, looking at 0.11.2's popup).
//
// 0.11.2's card showed a folder textarea, an allow command, a remove command and
// a verify command — to a member whose hook was healthy (server hook_verdict ok,
// thousands of clean rooted rows a day). Rob asked for ONE step at a time,
// nothing shown when setup is fine, the extension (the SERVER) detecting what is
// needed instead of asking "did you run it?", a real Choose Folder window instead
// of typing paths, and a status line that says what is actually captured.
//
// So the card now:
//
//   * renders ONLY when the server's per-member verdict says something is wrong
//     (duplicate / stale / dark) or the hook is not set up yet. Never on ok, and
//     never on "can't check" — no nagging on an unknown;
//   * shows exactly ONE step: step 1 (copy one message into Claude Code; the
//     installer opens a Choose Folder window) or step 2 (restart Claude Code);
//   * advances by ITSELF, from the server: step 2 replaces step 1 when the
//     installer's verification has been stamped within the last 15 minutes, and
//     the card goes away when the verdict turns ok. There is no "I've run this"
//     button, and no local action — copying, clicking, revealing the terminal
//     command — ever advances or hides it;
//   * takes no focus when it opens. The complaint that started this was a popup
//     opening with the cursor already inside the old card's folder field.
//
// The decision (verdict → line → which card) is panelui.js hookSetupState(), the
// ONE reader of `hook_verdict`. This file renders what it is handed.
//
// ⛔ WHAT IT DOES NOT BRING BACK. v0.10.0's card hid itself after writing a
// browser-local key the hook never read — a "done" state for a step that had not
// happened, which left members dark believing they were covered. That is still
// impossible here: the card is hidden only by a verdict the SERVER derived from
// rows the hook actually wrote (ok), or while the server cannot be asked at all,
// and in that case the status line says so in words ("Can't check right now.")
// rather than by silence.
// ═════════════════════════════════════════════════════════════════════════════

import { PLATFORM_WINDOWS, currentPlatform } from './consent.js';

/**
 * Every member-facing string of the 0.11.3 setup flow: the Claude Code hook line
 * in the health strip, the one-step card, and the "Change folders" reveal.
 * Authored by Opus (2026-09-28) and placed verbatim. `{ago}` and `{roots}` are
 * filled by panelui.js hookSetupState() and nowhere else.
 */
export const SETUP_COPY = Object.freeze({
  // ── the "Claude Code hook" line (the strip lane's sub-line) ──────────────
  lineOk: 'Recording — last entry {ago}.',
  lineOkRoots: ' From: {roots}.',
  lineDuplicate: 'Recording twice. Fix it below.',
  lineStale: 'Running an old version. Fix it below.',
  lineDark: 'Not recording while your timer runs. Fix it below.',
  lineNotSetUp: 'Not set up yet. Set it up below.',
  // unknown + no_hook_rows: the member's token HAS authenticated, and the hook
  // wrote nothing in the 24 h window — a weekend, a day off. Grey, no card.
  lineNoEntries: 'No entries in the last day.',
  lineCantCheck: "Can't check right now.",

  // ── step 1 ────────────────────────────────────────────────────────────────
  step1HeadingSetUp: 'Set up Claude Code tracking — step 1 of 2',
  step1HeadingFix: 'Fix Claude Code tracking — step 1 of 2',
  step1Body: 'Copy this message, paste it into Claude Code, and press Enter. A Choose Folder window will open: pick the folder where you do client work.',
  message: 'Set up my Massmarket worklog hook by following https://onboarding-wizard.massmarket.ai/api/ext/hook-install?guide=1 on this computer, then show me the last line it printed.',
  // The message step 1 shows and copies in its FIX state — the state headed
  // step1HeadingFix (duplicate / stale / dark). `message` above stays the Set up
  // state's. Authored by Opus (2026-09-29) and placed verbatim.
  messageFix: 'Repair my Massmarket worklog hook by following https://onboarding-wizard.massmarket.ai/api/ext/hook-install?guide=1 on this computer, then show me the last line it printed.',
  copyMessage: 'Copy message',
  copiedMessage: 'Copied — now paste it into Claude Code.',
  showTerminal: 'Prefer the Terminal? Show the command',
  // The label of the Copy button beside each terminal command ("each with its
  // own Copy button").
  copyCommand: 'Copy',

  // ── step 2 ────────────────────────────────────────────────────────────────
  step2Heading: 'Restart Claude Code — step 2 of 2',
  step2Body: 'Quit Claude Code completely, open it again, and start a new thread. This card goes away by itself once your first entry arrives.',

  // ── "Change folders" on the hook line (always available) ──────────────────
  changeFolders: 'Change folders',
  changeFoldersBody: 'To add a folder, copy the step 1 message again and pick the other folder. To stop recording a folder, ask Claude Code: "Stop my Massmarket worklog hook recording <folder>, following https://onboarding-wizard.massmarket.ai/api/ext/hook-install?guide=1."',
});

/**
 * ⛔ OPUS_TO_REVIEW (0.11.3) — the one-word state on the COMPACT status row
 * ("Hooks <word>"). The row needs a short word per state and the brief gave the
 * LINE, not the word, so each of these is the line's own lead clause, cut at its
 * first full stop or dash — no new wording. Kept out of SETUP_COPY so its status
 * is visible: SETUP_COPY is what Opus authored; this is where the executor cut it.
 */
export const HOOK_ROW_WORD = Object.freeze({
  ok: 'Recording',
  duplicate: 'Recording twice',
  stale: 'Running an old version',
  dark: 'Not recording',
  not_set_up: 'Not set up yet',
  no_entries: 'No entries in the last day',
  cant_check: "Can't check right now",
});

// ── the Terminal path ────────────────────────────────────────────────────────
//
// Verbatim from the brief. The Windows form is TWO lines, each its own copy:
// PowerShell cannot pipe a downloaded script into itself the way `sh` can, so the
// installer is fetched to %TEMP% first and run from there. The platform comes
// from consent.js resolvePlatform() — the same resolution workFolderState() has
// always done — passed in as an argument, never re-guessed here.
const TERMINAL_POSIX = Object.freeze([
  'curl -fsSL "https://onboarding-wizard.massmarket.ai/api/ext/hook-install?os=mac" | sh -s -- --upgrade --clean --allow-no-folder --choose-folder',
]);
const TERMINAL_WINDOWS = Object.freeze([
  '[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; iwr "https://onboarding-wizard.massmarket.ai/api/ext/hook-install?os=windows" -UseBasicParsing -OutFile "$env:TEMP\\mm-install.ps1"',
  'powershell -ExecutionPolicy Bypass -File "$env:TEMP\\mm-install.ps1" -Upgrade -Clean -AllowNoFolder -ChooseFolder',
]);

/** The command line(s) a member on `platform` runs instead of pasting the message. */
export function terminalCommands(platform = currentPlatform()) {
  return (platform === PLATFORM_WINDOWS ? TERMINAL_WINDOWS : TERMINAL_POSIX).slice();
}

// ── the re-poll ──────────────────────────────────────────────────────────────
//
// ⛔ WHILE THE CARD IS VISIBLE, AND ONLY THEN. The card advances from the SERVER:
// step 2 appears when the installer's verification lands, and the card goes away
// when the verdict turns ok. A surface that read health once at open would leave
// a member staring at step 1 after doing it, which is exactly the "did you run
// it?" loop this release removes. So a visible card re-reads health every 30 s
// (forced — the 5-minute cache would hide the change), and the poll stops the
// moment the card is hidden: a member whose hook is fine costs the server nothing.
export const SETUP_POLL_MS = 30 * 1000;

/**
 * A timer that runs `refresh` every `intervalMs` while `sync(true)` is in force.
 *
 * `timers` and `isHidden` are injectable so the "stops when the card is hidden"
 * rule is a unit test instead of a 30-second wait. A tick while the document is
 * hidden (a minimised window) does nothing: nobody is looking, and the focus /
 * visibility handler on each surface re-reads the moment somebody is.
 */
export function createSetupPoller({ refresh, intervalMs = SETUP_POLL_MS, isHidden = () => false, timers = globalThis } = {}) {
  let id = null;
  const tick = () => {
    try {
      if (isHidden()) return;
      const p = refresh && refresh();
      if (p && typeof p.catch === 'function') p.catch(() => { /* the next tick tries again */ });
    } catch (e) { /* never let a failed read stop the poll */ }
  };
  return {
    /** Start on a visible card, stop on a hidden one. Idempotent in both directions. */
    sync(visible) {
      if (visible && id == null) id = timers.setInterval(tick, intervalMs);
      else if (!visible && id != null) { timers.clearInterval(id); id = null; }
      return id != null;
    },
    stop() { if (id != null) { timers.clearInterval(id); id = null; } },
    running() { return id != null; },
  };
}

// ── the clipboard ────────────────────────────────────────────────────────────

/**
 * Put `text` on the clipboard. Same two-step the rest of the extension uses:
 * the async API first, then a hidden-textarea execCommand for the surfaces and
 * permission states where it is unavailable.
 */
async function copyText(doc, text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through to the legacy path */ }
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand && doc.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

// className, not classList, so the card stays buildable by the probes' minimal DOM.
function setClass(node, cls, on) {
  const list = String(node.className || '').split(/\s+/).filter((c) => c && c !== cls);
  if (on) list.push(cls);
  node.className = list.join(' ');
}

let uid = 0;

/**
 * Step 1's heading and message, for the Set up state (`setUp`) or the Fix state.
 *
 * ⛔ ONE PLACE PAIRS THEM, so the heading a member reads and the message they
 * copy cannot come from different states. The first build and the in-place
 * set-up ↔ fix re-label both ask this function.
 */
function step1Words(setUp) {
  return setUp
    ? { heading: SETUP_COPY.step1HeadingSetUp, message: SETUP_COPY.message }
    : { heading: SETUP_COPY.step1HeadingFix, message: SETUP_COPY.messageFix };
}

/**
 * Build the card into `host` and hand back a controller. Nothing is shown until
 * `update(state)` is called with a hookSetupState() result that carries a card.
 *
 * @param {Document} doc    the document that owns `host`
 * @param {Element}  host   mount point — emptied first, and hidden until a step is due
 * @param {object}   opts   { platform?, onCopy?(what) }
 * @returns {{ update(state): boolean, isVisible(): boolean, step(): (1|2|null), destroy(): void }}
 */
export function renderConsentCard(doc, host, {
  // ⛔ AN ARGUMENT, NOT AN AMBIENT READ. Both surfaces pass the platform they got
  // from workFolderState() (which resolved it through chrome.runtime), and the
  // tests pass both values in turn. A command spelling only the machine it runs
  // on can produce is a spelling only that machine can check — which is how a
  // literal `~` once reached five Windows members.
  platform = currentPlatform(),
  onCopy,
} = {}) {
  const none = { update() { return false; }, isVisible() { return false; }, step() { return null; }, destroy() {} };
  if (!host) return none;
  host.textContent = '';
  setClass(host, 'hidden', true);

  let shownStep = null;       // the step currently built into the host, or null
  let headingEl = null;       // step 1's heading, so set-up ↔ fix re-labels in place
  let messageBlock = null;    // step 1's message box + Copy, re-worded in place with it
  const idBase = `mm-consent-${++uid}`;

  const mk = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /**
   * A read-only box holding `text`, its copy control, and the status line the
   * control reports into. The box is a <pre>: selectable as-is, so a member whose
   * clipboard is denied can still copy by hand ("select the text above").
   */
  function copyBlock(parent, { kind, text, label, done, id }) {
    const pre = mk('pre', `mm-consent-cmd mm-consent-${kind}`);
    pre.id = id;
    const code = mk('code', null, text);
    pre.appendChild(code);
    parent.appendChild(pre);

    const btn = mk('button', `mm-consent-copy mm-consent-copy-${kind}`, label);
    btn.type = 'button';
    // Two identically labelled "Copy" controls on the Windows card are ambiguous
    // to a screen reader, so each is described by the box it copies.
    btn.setAttribute('aria-describedby', id);
    parent.appendChild(btn);

    const status = mk('p', `mm-consent-copystatus mm-consent-copystatus-${kind}`);
    status.setAttribute('role', 'status');
    parent.appendChild(status);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        // ⛔ WHAT THE BOX HOLDS NOW, not the text it was built with: step 1's
        // message is re-worded in place on a set-up ↔ fix change, and the button
        // must copy the message on screen.
        const ok = await copyText(doc, code.textContent);
        status.textContent = ok ? done : CARD_AFFORDANCE.copyFailed;
        // ⛔ Copying is NOT progress. It says nothing about whether the message
        // was pasted or the command was run, so it never advances the step and
        // never hides the card — only the server's reading does that.
        if (ok && typeof onCopy === 'function') onCopy(kind);
      } finally {
        btn.disabled = false;
      }
    });

    /**
     * Re-word the box in place. A repeat of the same text touches nothing; new
     * text also clears this box's "Copied" line, which described the text that
     * was on the clipboard before, not the text now on screen.
     */
    function setText(next) {
      if (code.textContent === next) return;
      code.textContent = next;
      status.textContent = '';
    }
    return { pre, btn, status, setText };
  }

  function buildStep1(card, setUp) {
    const words = step1Words(setUp);
    headingEl = mk('h2', 'mm-consent-h', words.heading);
    headingEl.id = `${idBase}-h`;
    card.setAttribute('aria-labelledby', headingEl.id);
    card.appendChild(headingEl);
    card.appendChild(mk('p', 'mm-consent-body', SETUP_COPY.step1Body));

    messageBlock = copyBlock(card, {
      kind: 'msg', text: words.message, label: SETUP_COPY.copyMessage,
      done: SETUP_COPY.copiedMessage, id: `${idBase}-msg`,
    });

    // ⛔ The Terminal path is OPT-IN and stays behind this link. The default is
    // the one message; a member who wants the raw command asks for it.
    const toggle = mk('button', 'mm-consent-link mm-consent-terminal-toggle', SETUP_COPY.showTerminal);
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const terminal = mk('div', 'mm-consent-terminal hidden');
    terminal.id = `${idBase}-terminal`;
    toggle.setAttribute('aria-controls', terminal.id);
    // ⛔ WINDOWS ONLY, above the two commands: they are PowerShell, and pasted into
    // cmd.exe `$env:TEMP` is a literal. The existing approved line, reused verbatim
    // from CONSENT_COPY; a mac member has no PowerShell and is not sent looking.
    if (platform === PLATFORM_WINDOWS) terminal.appendChild(mk('p', 'mm-consent-winnote', CONSENT_COPY.windowsNote));
    terminalCommands(platform).forEach((cmd, i) => {
      copyBlock(terminal, {
        kind: 'cmd', text: cmd, label: SETUP_COPY.copyCommand,
        done: CARD_AFFORDANCE.copied, id: `${idBase}-cmd${i + 1}`,
      });
    });
    let terminalOpen = false;
    toggle.addEventListener('click', () => {
      terminalOpen = !terminalOpen;
      toggle.setAttribute('aria-expanded', terminalOpen ? 'true' : 'false');
      setClass(terminal, 'hidden', !terminalOpen);
    });
    card.appendChild(toggle);
    card.appendChild(terminal);
  }

  function buildStep2(card) {
    headingEl = null;
    messageBlock = null;
    const h = mk('h2', 'mm-consent-h', SETUP_COPY.step2Heading);
    h.id = `${idBase}-h`;
    card.setAttribute('aria-labelledby', h.id);
    card.appendChild(h);
    card.appendChild(mk('p', 'mm-consent-body', SETUP_COPY.step2Body));
  }

  function build(step, setUp) {
    host.textContent = '';
    const card = mk('section', `mm-consent mm-consent-step${step}`);
    // A group, not a dialog: it does not trap focus and it does not sit over the
    // surface. Someone who is mid-timer must never be locked out of Stop by it.
    card.setAttribute('role', 'group');
    if (step === 2) buildStep2(card);
    else buildStep1(card, setUp);
    host.appendChild(card);
    shownStep = step;
  }

  return {
    /**
     * Show the step `state` asks for, or nothing.
     *
     * ⛔ A REPEAT OF THE SAME STEP TOUCHES NOTHING. Health is re-read every 30 s
     * while the card is up; rebuilding on each read would wipe the "Copied" line
     * the member just produced and re-collapse the terminal command they opened.
     * Only a CHANGE of step rebuilds, and a set-up ↔ fix change within step 1
     * re-labels the heading and re-words the message in place (Set up shows
     * SETUP_COPY.message, Fix shows SETUP_COPY.messageFix), so an opened
     * Terminal command stays open.
     *
     * @param {{ key: string, card: ({ step: 1|2 }|null) }} state hookSetupState()'s result
     * @returns {boolean} whether the card is visible after this call
     */
    update(state) {
      const c = state && state.card;
      const step = c && (c.step === 2 ? 2 : c.step === 1 ? 1 : null);
      if (!step) {
        if (shownStep != null) host.textContent = '';
        shownStep = null;
        headingEl = null;
        messageBlock = null;
        setClass(host, 'hidden', true);
        return false;
      }
      const setUp = !!(state && state.key === 'not_set_up');
      if (step !== shownStep) build(step, setUp);
      else if (step === 1 && headingEl) {
        const want = step1Words(setUp);
        if (headingEl.textContent !== want.heading) headingEl.textContent = want.heading;
        if (messageBlock) messageBlock.setText(want.message);
      }
      setClass(host, 'hidden', false);
      return true;
    },
    isVisible() { return shownStep != null; },
    step() { return shownStep; },
    destroy() { host.textContent = ''; shownStep = null; headingEl = null; messageBlock = null; },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ⛔ RETIRED FROM RENDERING IN 0.11.3 — kept frozen, rendered nowhere (with
// three named exceptions, below).
//
// The work-folder card these belonged to (v0.10.1 – v0.11.2: a folder textarea,
// the --consent-allow / --consent-remove commands and the --consent-status verify
// line) is no longer drawn by any surface; choosing folders now happens in the
// installer's own Choose Folder window. The objects stay because
// verify/consent-allowlist.mjs pins them verbatim and verify/hook-setup.test.mjs
// asserts that no surface renders any of them — deleting them would delete the
// only record of what those sentences were. The three EXCEPTIONS, each rendered
// by name: CONSENT_COPY.windowsNote (above the Windows commands in the Terminal
// reveal), CARD_AFFORDANCE.copied and CARD_AFFORDANCE.copyFailed (the Copy
// controls above).
// ═════════════════════════════════════════════════════════════════════════════

export const CONSENT_COPY = Object.freeze({
  heading: 'Choose the folders your work is recorded from',
  body: 'The worklog records what you are working on so your hours land on the right client. It records ONLY from the folders you list here. Anything outside them is not recorded at all, so if you list nothing, nothing is recorded.',
  listLabel: 'Work folders (recorded)',
  applyHeading: 'One more step, and it has to be in a terminal',
  applyBody: 'This extension cannot write the setting for you, so copy the command below and run it once on this machine. It ADDS the folders you have listed. It does not remove anything.',
  windowsNote: 'On Windows, run these in PowerShell.',
  removeHeading: 'To stop recording from a folder',
  removeBody: 'Adding is not the same as replacing. If you have already allowed a folder and you want it to stop being recorded, run this one instead.',
  verifyBody: 'To check it worked, run:',
  verifyNote: 'It prints "recording: yes" and the folders it will record from. If it says "recording: no (missing)", the setting did not take and nothing is being recorded.',
});

// The clipboard control's labels. `copy` and `copied` came back from the copy
// owner with the v0.10.1 block. `copyFailed` is the executor's, lifted VERBATIM
// from the shipped QA-capture path in popup.js. 0.11.3's Copy controls reuse
// `copied` (a terminal command) and `copyFailed` (any failed copy).
export const CARD_AFFORDANCE = Object.freeze({
  copy: 'Copy command',
  copied: '✓ Copied',
  copyFailed: 'Copy failed — select the text above and copy manually.',
});

// ⛔ OPUS_TO_REVIEW (2026-09-09) — signed off by Rob on 2026-09-09 with the leading
// "Then" removed, but never moved into the approved object. RETIRED from rendering
// in 0.11.3: step 2 of the setup card now carries the restart instruction in
// Opus's 2026-09-28 words (SETUP_COPY.step2Body).
export const RESTART_NOTE = Object.freeze({
  body: 'Quit Claude Code completely, reopen it, and start a NEW thread — not a resumed one. Claude Code wires in the hook when a session starts, so a session that was already open never runs it at all: it records nothing all day and looks exactly like a broken install.',
});
