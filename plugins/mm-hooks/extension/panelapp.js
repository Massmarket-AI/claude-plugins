// panelapp.js — the persistent surface, as ONE mountable app.
//
// Mounted by BOTH the side panel and the popped-out (Document
// Picture-in-Picture) window, so the pop-out carries everything the panel has —
// status row, running timers, and the complete client inventory — instead of
// being a timer readout. `mode` only decides whether the pop-out control bar and
// the "pop out" button are drawn; every byte of content comes from here.
//
// Cost contract: ONE cached GET of /api/ext/next-task and ONE cached GET of
// /api/ext/health, both shared through chrome.storage.local across all three
// surfaces. The ONE exception (0.11.3): while the Claude Code setup card is
// showing a step, health is re-read every 30 s so the step advances by itself;
// the poll stops the moment the card is hidden, so a member whose hook is fine
// costs the server nothing extra.
//
// ⛔ Every member-facing string in this file was authored by Opus for EXT #13 and
// placed on 2026-09-22 — the `OPUS_COPY —` note above each one is the brief it was
// written to, not an unfilled slot. A new string takes the same route, authored
// first and then placed, and is never written inline here.

import {
  getConfig, getTimers, fetchHealth, projectIdFromKey,
  // ⛔ v0.8.6 — the DELIVERY-QA GATE, IMPORTED, never re-implemented. This surface
  // now has its own Stop; a Stop that does not arm the gate is a silent enforcement
  // loss, and the only durable defence against that is that there is exactly one
  // copy of the rules and both surfaces call it. See common.js.
  qaPhaseFor, shouldNudgeWorklog, durationHoursFrom, fmtHours,
  // v0.8.7 — the gate is a PER-BLOCK SET. armPendingQa adds one requirement without
  // disturbing the others; resolvePendingQa is scoped to a single block and is a
  // no-op for null, which is the whole of what a block-less stop is allowed to do.
  armPendingQa, resolvePendingQa, getPendingQaAll, PENDING_KEY,
  setStopConfirm, setWorklogNudge,
  // v0.9.1 — the version floor, derived from the SAME health payload the popup uses.
  // Imported, never re-derived: two copies of a gate is how the hole opened.
  healthVersionStatus,
  // 0.11.4 fix round 1 — the last reading on this profile, storage only, so the
  // sessions block is on the FIRST frame when that reading is at most 30 minutes old.
  readRecentCachedHealth,
} from './common.js';
import { fetchTaskFeed, buildCards, nextFingerprintOf, filterCards } from './taskfeed.js';
import {
  computeIndicators,
  renderStatusRow,
  renderTimers,
  updateClocks,
  renderTasks,
  buildSearchBox,
  tasksCountText,
  // v0.10.0 — the health strip. The panel used to get ONLY the three-dot row, so the
  // version state, the download link, the hook install link and the feed statement
  // existed on the toolbar popup and nowhere else. These are the popup's own
  // functions, moved into the shared renderer rather than copied: mirroring a status
  // surface by duplicating it is how one surface ends up green next to the other's red.
  computeHealthLanes,
  unavailableHealthLanes,
  healthFootText,
  renderHealthDetail,
  // v0.12.0 — M2/M7. The toast is the EXISTING one-per-document component; the
  // pinned next-up line is shared with the toolbar popup.
  showToast,
  renderNextUpLine,
  // v0.11.2 — "your hours", the SAME renderer the toolbar popup mounts (2026-09-14,
  // lane L4b). EXT #12 built it popup-only; the side panel is where the team lives.
  mountHoursPanel,
  // 0.11.3 — the ONE decision about the Claude Code hook (strip line, row word,
  // setup card step), shared with the toolbar popup.
  hookSetupState,
} from './panelui.js';
// 0.11.4 — the Claude Code sessions block (after the next-up line, below every
// control): what it draws from a health reading, and the ONE renderer the toolbar
// popup draws it with too.
import { sessionsBlockState, renderSessionsBlock } from './panelui.js';
import { COPY as HOURS_COPY } from './hours.js';
// v0.8.3: the popup renders these same cards, so the Start behaviour behind them
// moved OUT of this file into cardstart.js. One card, one Start, three surfaces.
import { startCard, copyCardChip } from './cardstart.js';
// v0.12.0 — M6. One close-out implementation, shared with the toolbar popup.
import { closeOutBlock } from './cardclose.js';
// 0.11.3 — the Claude Code setup card. Same card, same copy, same rules as the
// toolbar popup; there is one implementation and both surfaces mount it.
// ⛔ The card APPLIES NOTHING — a Chrome extension cannot write
// ~/.claude/mm-hooks/consent.json; the installer it points at does. What it
// shows is hookSetupState()'s answer from the SERVER's verdict, never a local act.
import { renderConsentCard, createSetupPoller } from './consentcard.js';
// The platform only (which Terminal command the card can reveal).
import { workFolderState } from './consent.js';
// v0.11.0 — the capture notice + the pause control. Same rule again: ONE builder
// (capturecard.js), ONE set of frozen strings (capture.js), mounted by this
// surface and by the toolbar popup. A member who pauses here sees it paused
// there, because both read the same state off the same bus.
import { renderCaptureCard, captureCardAbove } from './capturecard.js';
import { getCapture, CAPTURE_KEY } from './capture.js';

export const POPOUT_PREFS_KEY = 'popoutPrefs';
export const DEFAULT_PREFS = { zoom: 1, alwaysDetails: false };

const mk = (doc, tag, cls, text) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Build the surface into `root` and keep it live.
 *
 * @param {Document} doc      the document that owns `root`
 * @param {Element}  root     mount point
 * @param {object}   opts     { mode: 'panel'|'pip', onResize }
 * @returns {{destroy:Function, refresh:Function, setZoom:Function}}
 */
export function mountPanel(doc, root, opts = {}) {
  const mode = opts.mode === 'pip' ? 'pip' : 'panel';
  const state = {
    timers: [],
    schedEndBlocks: {},
    feed: null,
    health: null,
    cards: [],
    memberEmail: '',
    apiBase: '',
    prefs: { ...DEFAULT_PREFS },
    // The post-Stop message. Held in STATE, not written straight into the DOM,
    // because stopping fires a chrome.storage `timers` change that re-renders this
    // whole surface a beat later — a banner appended to the timer list would be
    // wiped by the very update that proves the stop worked.
    stopNotice: null, // { text, tone: 'ok'|'qa'|'error' }
    // Every block that still owes delivery QA (common.js's per-block set). Read on
    // load and kept live off the storage bus, because the requirement can be armed
    // by the POPUP or the pop-out and this surface must still say so.
    pendingQa: [],
    // consent.js workFolderState() — read for its `platform` (0.11.3), which picks
    // the Terminal command the setup card can reveal. Whether the card shows at
    // all is hookSetupState(state.health), never this.
    consent: null,
    // 0.11.4 fix round 1 — the last health reading on this profile when it is at most
    // HEALTH_SEED_MAX_AGE_MS old (readRecentCachedHealth, storage only), or null. Paints the
    // sessions block on the first frame, and ONLY until any answer has arrived.
    sessionsSeed: null,
    // The capture gate's state: { signedIn, paused, noticeVersion, ... }. Held
    // here and re-read off the storage bus, because pause/resume and the sign-out
    // transition both happen in the SERVICE WORKER — this surface is a reader of
    // that state, never an owner of it.
    capture: null,
    // The search box's text. Held HERE rather than read off the input at render
    // time so a re-render driven by a timer tick cannot lose it, and so the
    // filtered count and the empty state always describe the same query.
    query: '',
  };

  // ── skeleton (identical in both documents) ────────────────────────────────
  root.textContent = '';
  const wrap = mk(doc, 'div', 'mm-wrap');

  let pipBar = null;
  if (mode === 'pip') {
    pipBar = mk(doc, 'div', 'mm-pip-bar');
    wrap.appendChild(pipBar);
  }

  const titleRow = mk(doc, 'div', 'mm-title');
  titleRow.appendChild(mk(doc, 'span', 'dot'));
  titleRow.appendChild(mk(doc, 'h1', null, 'Massmarket Time Tracker'));
  // The way into "your hours", in the title row so it is reachable whatever the
  // surface is showing. Label and tooltip are hours.js COPY.
  const hoursBtn = mk(doc, 'button', 'mm-btn mm-hours-open', HOURS_COPY.openButton);
  hoursBtn.type = 'button';
  hoursBtn.title = HOURS_COPY.openButtonTitle;
  hoursBtn.dataset.hours = 'open';
  titleRow.appendChild(hoursBtn);
  wrap.appendChild(titleRow);

  // ── ONE status line (D3, Rob 2026-09-14) ─────────────────────────────────
  // This surface drew the status row AND, under it, an always-open health block
  // with the same three facts again — two status blocks for one state. It now has
  // the popup's shape: a <details> whose summary IS the status row and whose body
  // holds the lanes, the footer and the capture pause control. One line, closed
  // unless a measured lane is not ok.
  const healthStrip = mk(doc, 'details', 'health mm-health');
  const healthSummary = mk(doc, 'summary', null);
  const statusHost = mk(doc, 'span', 'mm-status');
  healthSummary.appendChild(statusHost);
  healthStrip.appendChild(healthSummary);
  const healthBody = mk(doc, 'div', 'health-body');
  const healthRows = mk(doc, 'div', null);
  const healthFoot = mk(doc, 'p', 'health-foot');
  // Where the capture card lives once the notice is acknowledged (captureCardAbove).
  const captureInlineHost = mk(doc, 'div', 'mm-capture-inline hidden');
  healthBody.appendChild(healthRows);
  healthBody.appendChild(healthFoot);
  healthBody.appendChild(captureInlineHost);
  healthStrip.appendChild(healthBody);
  wrap.appendChild(healthStrip);

  // ── the setup cards, BELOW the one status line ────────────────────────────
  // The capture card stands here only while the member must act (notice not yet
  // acknowledged, or signed out). The Claude Code setup card stands here only
  // while a step is due (0.11.3) — the same card the popup mounts.
  const consentHost = mk(doc, 'div', 'mm-consent-host hidden');
  const captureHost = mk(doc, 'div', 'mm-capture-host hidden');
  wrap.appendChild(captureHost);
  wrap.appendChild(consentHost);
  let consentCard = null;
  // While the setup card is up, health is re-read every 30 s (forced — the cache
  // would hide the change) so step 2 and "done" arrive by themselves; the poll
  // stops the moment the card is hidden.
  let setupForcedAt = 0;
  const SETUP_FORCE_GAP_MS = 10 * 1000;
  const setupPoller = createSetupPoller({
    refresh: () => rereadHealth(true),
    isHidden: () => !!doc.hidden,
  });

  // ── your hours (v0.11.2) ──────────────────────────────────────────────────
  // ⛔ A STABLE NODE, OUTSIDE render(). This surface re-renders on every storage
  // timer tick; the hours form owns inputs a member may be typing into, so it must
  // never be inside anything render() clears. Opening it hides the task region
  // (timers, next-up, the list) and closing it brings that back untouched; the
  // status row, capture card, consent card and health strip stay above both.
  const hoursHost = mk(doc, 'div', 'mm-hours-host hidden');
  const taskRegion = mk(doc, 'div', 'mm-task-region');
  wrap.appendChild(hoursHost);
  wrap.appendChild(taskRegion);
  let hoursPanel = null;
  // ⛔ 0.11.3 — the title-row button is a TOGGLE that reads pressed while My hours
  // is open (it used to go DISABLED, which left the "← Back" link at the top of the
  // view — often below the fold — as the only way out). Escape leaves too.
  let hoursOpen = false;
  hoursBtn.setAttribute('aria-pressed', 'false');
  function closeHours() {
    hoursHost.classList.add('hidden');
    taskRegion.classList.remove('hidden');
    hoursOpen = false;
    hoursBtn.setAttribute('aria-pressed', 'false');
  }
  async function openHours() {
    if (!hoursPanel) hoursPanel = mountHoursPanel(doc, hoursHost, { onBack: closeHours });
    taskRegion.classList.add('hidden');
    hoursHost.classList.remove('hidden');
    hoursOpen = true;
    hoursBtn.setAttribute('aria-pressed', 'true');
    await hoursPanel.open();
  }
  hoursBtn.addEventListener('click', () => { if (hoursOpen) closeHours(); else openHours(); });
  // An Escape something inside the view already claimed (the client picker
  // closing its open list) is left alone: one Escape closes the list, the next leaves.
  const onHoursKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !hoursOpen) return;
    e.preventDefault();
    closeHours();
  };
  doc.addEventListener('keydown', onHoursKey);

  const live = mk(doc, 'div', 'mm-live');
  const head = mk(doc, 'div', 'mm-head');
  head.appendChild(mk(doc, 'span', 'rec-dot'));
  const count = mk(doc, 'span', null, 'Loading…');
  head.appendChild(count);
  live.appendChild(head);
  // Stop confirmation / QA hand-off banner. A stable node so re-renders keep it.
  const notice = mk(doc, 'div', 'mm-stop-notice hidden');
  notice.setAttribute('role', 'status');
  live.appendChild(notice);
  // ⛔ THE STANDING QA-OWED LINE (v0.8.7). Separate from the transient stop notice
  // ON PURPOSE. The notice is a one-shot receipt for the click that just happened and
  // is dismissible; this line is a statement about what the member still owes, and it
  // is driven straight from storage, so it comes back on every render and cannot be
  // dismissed into looking resolved. Before this existed, a block-less stop repainted
  // the banner to a bare "✓ 0.7h submitted." while a QA requirement was outstanding —
  // the surface told the person the opposite of the truth.
  const qaOwed = mk(doc, 'div', 'mm-qa-owed hidden');
  qaOwed.setAttribute('role', 'status');
  live.appendChild(qaOwed);
  const timerCards = mk(doc, 'div', 'mm-timer-list');
  timerCards.id = 'mm-cards';
  live.appendChild(timerCards);
  taskRegion.appendChild(live);

  // ⛔ M7 — the pinned "what is next" line, ABOVE the head and outside the list
  // host, for the same reason the search box is: renderTasks() clears that host on
  // every render and this surface re-renders on every storage timer tick. Same
  // renderer as the toolbar popup (panelui.js renderNextUpLine), reading the same
  // cached /api/ext/next-task payload, so the two surfaces cannot name a different
  // next client — which is exactly what the popup's old bespoke chip did.
  const nextUp = mk(doc, 'div', 'mm-nextup hidden');
  nextUp.setAttribute('role', 'status');
  taskRegion.appendChild(nextUp);

  // ── the Claude Code sessions block (0.11.4) ───────────────────────────────
  // OUTSIDE the status line's <details>, so the sessions are on screen without
  // opening anything — through 0.11.3 they were lines inside the strip, which stays
  // shut on a healthy install. ⛔ And BELOW every control (fix round 1, Opus
  // 2026-10-02): the running timers (or the "nothing running" box), then the next-up
  // line, then this block, then the task list; the capture, setup and QA cards stay
  // above it. Placed directly under the status line, six sessions left the pop-out
  // (360x520) with no clock on screen. A stable node: the block is repainted on
  // every render, and a "Change" picker a member is typing into must not be rebuilt
  // under them (panelui.js renderSessionsBlock keeps its controls). Hidden and empty
  // when there is nothing to draw. It goes away with the task region while My hours
  // is open, as the next-up line does.
  const sessionsHost = mk(doc, 'div', 'health-sessions-block hidden');
  taskRegion.appendChild(sessionsHost);

  const tasksHead = mk(doc, 'div', 'mm-head idle');
  tasksHead.appendChild(mk(doc, 'span', 'rec-dot'));
  const tasksCount = mk(doc, 'span', null, 'Your tasks');
  tasksHead.appendChild(tasksCount);

  // ⛔ ABOVE the list host and OUTSIDE it — renderTasks() clears that host on every
  // render, and this surface re-renders on each storage timer tick. See
  // buildSearchBox(). Only `tasks` is repainted when the query changes.
  const search = buildSearchBox(doc, {
    value: state.query,
    onChange: (v) => {
      state.query = v;
      renderTaskList();
    },
  });

  const tasks = mk(doc, 'div', 'mm-tasks');
  taskRegion.appendChild(tasksHead);
  taskRegion.appendChild(search.wrap);
  taskRegion.appendChild(tasks);

  const actions = mk(doc, 'div', 'mm-actions');
  taskRegion.appendChild(actions);

  const foot = mk(doc, 'p', 'mm-note');
  wrap.appendChild(foot);
  root.appendChild(wrap);

  // ── pop-out control bar (zoom, size, settings) ────────────────────────────
  // Top-right, because that is where window chrome lives everywhere else and it
  // is the only place in a 300px-wide floating window that is never covered by
  // content. The gear holds the settings that do NOT belong on a hot path.
  let zoomLabel = null;
  if (pipBar) {
    const spacer = mk(doc, 'span', 'mm-pip-spacer');
    pipBar.appendChild(spacer);

    const btn = (label, title, fn) => {
      const b = mk(doc, 'button', 'mm-btn', label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', fn);
      pipBar.appendChild(b);
      return b;
    };
    btn('−', 'Zoom out', () => setZoom(state.prefs.zoom - 0.1));
    zoomLabel = mk(doc, 'span', 'mm-pip-zoom', '100%');
    pipBar.appendChild(zoomLabel);
    btn('+', 'Zoom in', () => setZoom(state.prefs.zoom + 0.1));
    btn('⤡', 'Shrink the window', () => resizeWindow(-90, -80));
    btn('⤢', 'Expand the window', () => resizeWindow(90, 80));

    const menu = mk(doc, 'div', 'mm-status-detail hidden');
    const gear = btn('⚙', 'Settings', () => {
      menu.classList.toggle('hidden');
    });
    gear.setAttribute('aria-haspopup', 'true');

    const detailToggle = mk(doc, 'button', 'mm-btn', 'Always show full details: off');
    detailToggle.type = 'button';
    detailToggle.addEventListener('click', async () => {
      state.prefs.alwaysDetails = !state.prefs.alwaysDetails;
      detailToggle.textContent = `Always show full details: ${state.prefs.alwaysDetails ? 'on' : 'off'}`;
      applyPrefs();
      await savePrefs();
    });
    const resetBtn = mk(doc, 'button', 'mm-btn', 'Reset zoom and size');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', async () => {
      setZoom(1);
      resizeTo(340, 520);
      await savePrefs();
    });
    const refreshBtn = mk(doc, 'button', 'mm-btn', 'Refresh now');
    refreshBtn.type = 'button';
    refreshBtn.addEventListener('click', () => refresh(true));
    menu.appendChild(detailToggle);
    menu.appendChild(doc.createTextNode(' '));
    menu.appendChild(resetBtn);
    menu.appendChild(doc.createTextNode(' '));
    menu.appendChild(refreshBtn);
    wrap.insertBefore(menu, titleRow);
  }

  // The popped-out surface runs INSIDE the floating window as an extension page,
  // so it cannot resize its own host (different origin). It asks; content.js,
  // which owns the window handle, does it. Dragging the window edge always works
  // regardless — these buttons are the keyboard/one-hand path, not the only one.
  function resizeWindow(dw, dh) {
    if (typeof opts.onResize === 'function') opts.onResize({ dw, dh });
  }
  function resizeTo(w0, h0) {
    if (typeof opts.onResize === 'function') opts.onResize({ w: w0, h: h0 });
  }

  function setZoom(z) {
    const clamped = Math.min(2, Math.max(0.7, Math.round(z * 10) / 10));
    state.prefs.zoom = clamped;
    applyPrefs();
    savePrefs();
  }

  function applyPrefs() {
    try { doc.documentElement.style.setProperty('--z', String(state.prefs.zoom)); } catch (e) { /* ignore */ }
    if (zoomLabel) zoomLabel.textContent = `${Math.round(state.prefs.zoom * 100)}%`;
    tasks.querySelectorAll('.mm-card').forEach((c) => {
      c.classList.toggle('mm-pinned', !!state.prefs.alwaysDetails);
    });
  }

  async function savePrefs() {
    try { await chrome.storage.local.set({ [POPOUT_PREFS_KEY]: state.prefs }); } catch (e) { /* ignore */ }
  }

  // ── data ──────────────────────────────────────────────────────────────────
  async function loadLocal() {
    try { state.timers = await getTimers(); } catch (e) { state.timers = []; }
    try { state.consent = await workFolderState(); } catch (e) { state.consent = null; }
    try { state.capture = await getCapture(); } catch (e) { state.capture = null; }
    try { state.pendingQa = await getPendingQaAll(); } catch (e) { state.pendingQa = []; }
    try {
      const o = await chrome.storage.local.get(['schedEndBlocks', POPOUT_PREFS_KEY]);
      state.schedEndBlocks = o.schedEndBlocks || {};
      state.prefs = { ...DEFAULT_PREFS, ...(o[POPOUT_PREFS_KEY] || {}) };
    } catch (e) { /* keep defaults */ }
    try {
      const cfg = await getConfig();
      state.apiBase = String(cfg.apiBase || '').replace(/\/+$/, '');
    } catch (e) { state.apiBase = ''; }
    try {
      state.sessionsSeed = await readRecentCachedHealth();
    } catch (e) { state.sessionsSeed = null; }
  }

  async function loadRemote(force) {
    const [feed, health] = await Promise.all([
      fetchTaskFeed({ force: !!force }),
      fetchHealth({ force: !!force }),
    ]);
    state.feed = feed;
    state.health = health;
    state.memberEmail =
      (health && health.data && health.data.member_email) ||
      (feed && feed.data && feed.data.member && feed.data.member.email) ||
      '';
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render() {
    state.cards = buildCards(state.feed && state.feed.data, Date.now());

    renderStatusLine();

    renderCapture();
    renderConsent();
    renderHealthStrip();
    renderSessions();

    renderTimers(head, count, timerCards, state.timers, { onStop: onStopTimer });
    renderStopNotice();

    renderTaskList();

    const bits = [];
    // ⛔ Only claim a timestamp when there is actually a list to timestamp. On a
    // cold failure fetchedAt is "now" and data is null, so "Tasks as of 3:04 PM"
    // was dating a list that does not exist.
    if (state.feed && state.feed.fetchedAt && state.feed.data) {
      bits.push(`Tasks as of ${new Date(state.feed.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }
    // The failed-refresh line moved INTO the task region (panelui.js renderTasks →
    // feedStatusNote) so all three surfaces say it, in the same words, next to the
    // list it is about. Repeating it down here would be the second copy this
    // branch exists to delete.
    if (state.memberEmail) bits.push(state.memberEmail);
    // v0.8.6: no longer true, and it was the line telling people to go somewhere else
    // for the button that is now right here.
    bits.push('Start and stop timers here or in the toolbar popup.');
    foot.textContent = bits.join(' · ');

    applyPrefs();
    updateClocks(timerCards, state.timers, state.schedEndBlocks);
  }

  /**
   * The capture notice + pause control.
   *
   * ⛔ THIS ONE REPAINTS ON EVERY RENDER, and renderConsent() below deliberately
   * does not. The difference is input: the work-folder card owns a textarea a
   * member may be part-way through typing into, so repainting it would destroy
   * work. This card owns a button and a state line and nothing else, and it has
   * to track the truth — a pause taken on the toolbar popup must show as paused
   * here within the same storage tick, not on the next open.
   */
  function renderStatusLine() {
    renderStatusRow(
      statusHost,
      computeIndicators({
        health: state.health,
        feed: state.feed,
        // The same list renderTimers() draws the cards from, so the line and the
        // cards cannot disagree about whether a timer is running.
        timers: state.timers,
        cards: state.cards,
        capture: state.capture,
      }),
    );
  }

  function renderCapture() {
    const st = state.capture;
    if (!st) return;                       // storage unreadable — keep last paint
    // ⛔ D3 — above the surface only while the member must act; otherwise inside
    // the status line's detail, where Pause / Resume stays one click away.
    const above = captureCardAbove(st);
    const target = above ? captureHost : captureInlineHost;
    const other = above ? captureInlineHost : captureHost;
    other.textContent = '';
    other.classList.add('hidden');
    renderCaptureCard(doc, target, {
      state: st,
      // Through the service worker, never straight to storage: it owns arming
      // the flush alarm, republishing `captureOn` to every tab, and the badge.
      onAcknowledge: () => chrome.runtime.sendMessage({ type: 'captureAcknowledge' }),
      onTogglePause: (paused) => chrome.runtime.sendMessage({ type: 'capturePause', paused }),
    });
    target.classList.remove('hidden');
  }

  /**
   * The Claude Code setup card (0.11.3).
   *
   * ⛔ SHOWN ONLY WHILE A STEP IS DUE, and the only thing that decides that is
   * hookSetupState(state.health) — the server's verdict, the same reading the
   * status line and the strip's hook line are painted from. It is mounted ONCE and
   * then updated in place, so the "Copied" line a member just produced, and a
   * Terminal command they opened, survive every storage tick and every re-read.
   *
   * ⛔ NO LOCAL ACT HIDES IT. v0.10.0's card hid itself after writing a key the
   * hook never read, and members went dark believing they were covered. This one
   * leaves only when the server says the hook is recording (or while the server
   * cannot be asked, when the hook line says so in words).
   */
  function renderConsent() {
    const st = state.consent;
    if (!st) return;                       // storage unreadable — keep last paint
    if (!consentCard) {
      consentCard = renderConsentCard(doc, consentHost, {
        // ⛔ Resolved once by workFolderState() and passed in, never re-guessed
        // here. It picks the Terminal command the card can reveal.
        platform: st.platform,
      });
    }
    const visible = consentCard.update(hookSetupState(state.health));
    setupPoller.sync(visible);
    // ⛔ A step must never stand on a CACHED reading when a live one is one request
    // away — the member may have just run step 1.
    if (visible && state.health && state.health.cached) forceSetupRefresh();
  }

  function forceSetupRefresh() {
    const t = Date.now();
    if (t - setupForcedAt < SETUP_FORCE_GAP_MS) return;
    setupForcedAt = t;
    rereadHealth(true);
  }

  /**
   * Re-read health and repaint the three things painted from it. `force` goes to
   * the server; unforced answers from the 5-minute cache and costs nothing.
   */
  async function rereadHealth(force) {
    if (force) setupForcedAt = Date.now();
    let h = null;
    try { h = await fetchHealth({ force: !!force }); } catch (e) { h = null; }
    state.health = h;
    renderStatusLine();
    renderConsent();
    renderHealthStrip();
    renderSessions();
  }

  // "and on focus": a visible step asks the server again; otherwise a cached read
  // (free inside the 5-minute window) lets a long-lived panel recover from a
  // reading it could not get, without polling anyone whose hook is fine.
  const onSetupFocus = () => {
    if (doc.hidden) return;
    if (consentCard && consentCard.isVisible()) forceSetupRefresh();
    else rereadHealth(false);
  };
  const win = doc.defaultView || null;
  if (win) win.addEventListener('focus', onSetupFocus);
  doc.addEventListener('visibilitychange', onSetupFocus);

  /**
   * The health strip — the SAME three lanes, in the SAME words, as the toolbar popup.
   *
   * The lanes and the footer both come from panelui.js, so "the panel must say what
   * the popup says" is enforced by there being one implementation rather than by a
   * reviewer noticing. The version status is derived from the same health payload
   * that already gates Start on this surface (onStart → healthVersionStatus).
   */
  function renderHealthStrip() {
    const vs = healthVersionStatus(state.health);
    const usable = !!(state.health && state.health.data && vs);
    // v0.11.0 — the feed lane is now a READING of this profile's capture gate, so
    // it gets the same `state.capture` the pause control above it renders from.
    // Both paths pass it: capture state is local, and an unreachable /api/ext/health
    // is no reason to stop telling someone whether their own capture is running.
    const lanes = usable
      ? computeHealthLanes({ health: state.health, versionStatus: vs, capture: state.capture })
      : unavailableHealthLanes(state.capture);
    renderHealthDetail(doc, healthRows, lanes);
    healthFoot.textContent = usable ? healthFootText(state.health) : '';
    healthFoot.classList.toggle('hidden', !healthFoot.textContent);
    // Same auto-open rule as the popup: the MEASURED lanes (extension, hook) only —
    // and the hook only on a measured problem (0.11.3): the can't-check line is
    // grey and opens nothing.
    const byKey = Object.fromEntries(lanes.map((l) => [l.key, l]));
    if (usable && ((byKey.ext && byKey.ext.level !== 'ok') || (byKey.hook && (byKey.hook.level === 'warn' || byKey.hook.level === 'bad')))) healthStrip.open = true;
  }

  /**
   * The Claude Code sessions block (0.11.4) — the SAME block, in the same words, as
   * the toolbar popup: its heading, two lines per session (up to six) and the
   * folders being recorded, from the same health reading the strip is drawn from.
   *
   * A saved task in a session's "Change" picker re-reads health FORCED, past the
   * 5-minute cache, and repaints from it (as the popup does).
   */
  function renderSessions() {
    // ⛔ The same "is this a reading the strip can use" test renderHealthStrip()
    // applies, so the block and the hook line are never drawn from different
    // readings: where the strip says it can't check, no session is drawn.
    const usable = !!(state.health && state.health.data && healthVersionStatus(state.health));
    // ⛔ Fix round 1 §4 — until ANY answer has arrived (state.health is still null),
    // the block is painted from the last reading when it is at most 30 minutes old,
    // so it is on the first frame instead of landing a second later. Once an answer
    // is in — usable or not — the seed is never read again.
    const reading = usable ? state.health : (state.health == null ? state.sessionsSeed : null);
    renderSessionsBlock(doc, sessionsHost, sessionsBlockState(reading), { onTaskSaved: () => rereadHealth(true) });
  }

  /**
   * The task region ONLY — head line, then the filtered list. Split out of
   * render() so typing in the search box repaints this and nothing else: a full
   * render() would tear down the timer cards and re-run the status row on every
   * keystroke, and (before the box moved out of the list host) ate the caret.
   */
  function renderTaskList() {
    const shown = filterCards(state.cards, state.query);
    tasksCount.textContent = tasksCountText(shown, state.cards, state.query);
    // The pinned line reads the WHOLE envelope, never the filtered view: a search
    // query narrows the list, it does not change what is actually next.
    renderNextUpLine(nextUp, state.feed);
    renderTasks(tasks, shown, {
      onStart,
      onCopy,
      onCloseOut,
      nextFingerprint: nextFingerprintOf(state.feed && state.feed.data),
      feed: state.feed,
      query: state.query,
    });
    // Cards are rebuilt here, so the "always show full details" pref has to be
    // re-applied to the new nodes — render() does it too, but a keystroke no
    // longer goes through render().
    applyPrefs();
  }

  // ── Start: clock in, then copy the WHOLE chip, then say so ────────────────
  // The behaviour lives in cardstart.js — shared with the toolbar popup, which
  // draws the same cards. All this surface adds is what IT does afterwards.
  function onStart(card, btn, art) {
    // The floor gates the CLOCK only — cardstart.js still copies the chip, because
    // the chip is how a task is claimed and a stale build is the case where the
    // member can least afford to lose that.
    const vs = healthVersionStatus(state.health);
    return startCard({
      card, btn, art, doc,
      memberEmail: state.memberEmail,
      apiBase: state.apiBase,
      versionBlocked: !!(vs && vs.level === 'red'),
      // The feed has changed shape (this item now has logged time) — refresh once,
      // on an explicit user action only.
      onStarted: () => setTimeout(() => refresh(true), 1200),
    });
  }

  // ── M2 — the standalone copy control. No clock, just the chip ─────────────
  // Same chip, same toast, same denied-clipboard fallback as Start — literally the
  // same function (cardstart.js copyCardChip), which is what Start itself now calls
  // for its copy half.
  function onCopy(card, btn, art) {
    return copyCardChip({
      card, art, doc,
      memberEmail: state.memberEmail,
      apiBase: state.apiBase,
    });
  }

  // ── M6 — close a block out from the card ──────────────────────────────────
  // The behaviour is cardclose.js, shared with the popup. What this surface adds is
  // what IT does afterwards: re-read the feed, because the point of a close-out is
  // that the client stops being served and that has to be proven by the server, not
  // simulated by hiding a card.
  async function onCloseOut(card, target, note, ctx) {
    const res = await closeOutBlock({ target, note });
    if (!res.ok) {
      // ⛔ The two clock cases, said as themselves. This surface is the one where
      // they actually happen: it renders the task list whether or not a timer is
      // running, so the close-out button on a block the member is clocked into is
      // reachable here and nowhere else. Same two sentences as the popup's.
      if (res.error === 'clock_running') {
        // OPUS_COPY — the line shown when the clock is running on this very block.
        // Must convey: stop the timer first, then close it out; nothing was closed.
        ctx.fail('Your clock is running on this block. Stop the timer first, then close it out. Nothing was closed.');
        return;
      }
      if (res.error === 'never_timed') {
        // OPUS_COPY — shown if close-out is pressed on a block with no time recorded
        // against it. Must convey: only a block you have tracked time on can be closed
        // out here; nothing was closed; ask the PM to close a block nobody worked.
        // Must NOT imply the member did something wrong.
        ctx.fail('Only a block with time tracked on it can be closed out here. Nothing was closed. To close a block with no tracked time, ask your PM.');
        return;
      }
      if (res.error === 'clock_unknown') {
        // OPUS_COPY — the line shown when the timer list could not be read, so we
        // cannot tell whether the clock is running. Nothing was closed; try again.
        ctx.fail('We could not check whether your clock is running on this block, so nothing was closed. Try again.');
        return;
      }
      ctx.fail(res.status
        // OPUS_COPY — error line inside the close-out form when the server refused.
        // Must convey: nothing was closed, and it can be tried again. Must NOT guess
        // at a cause. (Same slot as the popup's — one sentence, used on both.)
        ? `${'The close-out did not go through, and nothing was closed. You can try again.'} (HTTP ${res.status})`
        // OPUS_COPY — error line when the tracker could not be reached at all.
        : 'The server could not be reached, so nothing was closed. Try again in a moment.');
      return;
    }
    if (ctx.form) ctx.form.classList.add('hidden');
    // OPUS_COPY — toast after a successful close-out. Must convey: the block is
    // closed and the note was recorded against it. Must NOT say the client was
    // removed, must NOT claim a QA was done, must NOT imply it is reversible.
    showToast(doc, 'Closed out. Your note is recorded against this block.');
    refresh(true);
  }

  // ── Stop: the same message the popup sends, and the SAME gate afterwards ───
  //
  // Asif, via Rob (2026-08-13): "The sidebar doesn't have a stop button on it. Only
  // the pop-up extension does. Both the pop-up and the sidebar need to have the stop
  // buttons on the tracking tasks as well."
  //
  // ⛔ THIS IS NOT A TEN-LINE CHANGE, AND HERE IS WHY. Stopping a BLOCK-LINKED timer
  // is what arms the delivery-QA gate: popup.js's onStopBlock() ends by writing
  // `pendingQaFinalize`, and the popup re-surfaces the early/QA prompt from that key
  // on its next open. A panel Stop that skipped the write would let someone end a
  // client block from the surface the team actually lives in and never be asked for
  // QA — the enforcement would be gone, silently, and the button would be worse than
  // its absence. So this handler does exactly what onStopBlock does, through the same
  // shared functions (common.js), and hands the prompt itself back to the popup.
  //
  // ⛔ There is ONE write path for a stop. This sends {type:'stop'} to the service
  // worker (background.js's `stop` case → stopTimer() → the single timer_stop
  // enqueue + immediate flush). It does NOT talk to the API. A second write path
  // would be a second way for the two surfaces to disagree about what got logged.
  async function onStopTimer(t, btn) {
    if (!t) return;
    if (btn) btn.disabled = true;

    const blockId = t.blockId ?? null;
    // A block-less timer is either PROJECT (client) time or genuinely internal time.
    // Recover the project id from the timer, falling back to its own key, so the
    // worker closes THIS entry: `{blockId:null, projectId:null}` keys to
    // `__internal__` server-side and would close the wrong row. See timerKey().
    const projectId = blockId == null ? (t.projectId ?? projectIdFromKey(t.key) ?? null) : null;
    const blockTitle = t.title || '';
    const scheduledEnd = t.scheduledEnd || null;
    const category = blockId == null ? (t.internalCategory || null) : null;

    // ⛔ READ THE DURATION BEFORE THE ROUND-TRIP. The service worker removes this
    // timer from storage during the stop flush, so anything computed from a
    // post-send read is null — the "✓ N.Nh submitted" line and the duration inside
    // pendingQaFinalize would both come back empty.
    const durationHours = durationHoursFrom(t.startedAt || null);

    let res = null;
    try {
      // D4 — THIS card's key and entry id: Stop stops only this timer.
      res = await chrome.runtime.sendMessage({ type: 'stop', blockId, projectId, key: t.key || null, entryId: t.entryId ?? null });
    } catch (e) {
      res = null;
    }
    if (!(res && res.ok)) {
      if (btn) btn.disabled = false;
      state.stopNotice = {
        tone: 'error',
        text: `Could not stop ${blockTitle || 'that timer'}${res && res.error ? ` — ${res.error}` : '.'} Try the toolbar popup.`,
      };
      renderStopNotice();
      return;
    }

    // Reflect the worker's authoritative list immediately; the storage change event
    // will land on the same value a beat later.
    if (Array.isArray(res.timers)) state.timers = res.timers;

    const savedAtIso = new Date().toISOString();
    await setStopConfirm({ durationHours, savedAtIso, blockId });

    if (blockId == null) {
      // Internal / project work has no QA deliverable — it arms NO gate of its own.
      //
      // ⛔ AND IT MUST NOT TOUCH ANYONE ELSE'S. Through v0.8.6 this branch called
      // clearPendingFinalize(), which wiped the ONE pending slot — so stopping a
      // client block and then stopping any project or internal timer one click later
      // destroyed the armed QA requirement, and the popup opened clean. That was
      // BYPASS A. resolvePendingQa(null) is a no-op by construction: a stop with no
      // deliverable resolves its own non-existent entry and nothing more.
      await resolvePendingQa(null);
      if (shouldNudgeWorklog(category, durationHours)) {
        await setWorklogNudge({ category, durationHours, savedAtIso });
      }
    } else {
      // Block-linked: arm THIS block's requirement, then say so. armPendingQa adds to
      // the set instead of overwriting it (v0.8.6's setPendingFinalize overwrote the
      // single key — stop block A, then block B, and A's QA was silently dropped:
      // BYPASS B). The prompt itself stays in the popup, which drains the set one
      // block at a time, so the panel still needs no QA UI of its own.
      const phase = qaPhaseFor(scheduledEnd);
      await armPendingQa({ blockId, blockTitle, phase, durationHours, savedAtIso });
    }

    // Re-read the whole set BEFORE composing the banner. What the member is told is
    // "what do you still owe", not "what did this one click do" — see composeStopNotice.
    try { state.pendingQa = await getPendingQaAll(); } catch (e) { /* keep last */ }
    state.stopNotice = composeStopNotice(blockId, blockTitle, durationHours);

    if (blockId != null) {
      // Convenience only. The hand-off above is the contract and works without this.
      // ⛔ MV3 openPopup() returns a PROMISE and the user gesture is already spent by
      // the awaits above, so the normal outcome is a REJECTION — which a bare
      // try/catch around a non-awaited call cannot catch, and which therefore escaped
      // as an unhandled rejection. Swallow it on the promise itself.
      try {
        const p = chrome.action.openPopup();
        if (p && typeof p.catch === 'function') p.catch(() => { /* the banner already said it */ });
      } catch (e) { /* synchronous throw (no such API) — the banner already said it */ }
    }

    render();
    // The feed has changed shape (this item now has logged time) — one refresh, on an
    // explicit user action only, exactly as Start does.
    setTimeout(() => refresh(true), 1200);
  }

  /**
   * The post-Stop receipt.
   *
   * ⛔ IT MAY NEVER CLAIM A CLEAN "submitted" WHILE QA IS OWED — not even when the
   * timer that was just stopped is the one with no deliverable. The old wording did
   * exactly that: after a client block was stopped (gate armed) a following internal
   * stop repainted the banner to "✓ 0.7h submitted." and the member was told the
   * opposite of what had happened. The count comes from the whole set, so parallel
   * blocks are reported as parallel blocks.
   */
  function composeStopNotice(blockId, blockTitle, durationHours) {
    const owed = state.pendingQa.length;
    const submitted = `✓ ${fmtHours(durationHours)} submitted${blockTitle ? ` for ${blockTitle}` : ''}`;
    if (!owed) return { tone: 'ok', text: `${submitted}.` };
    const which = blockId != null && owed === 1 ? '' : ` on ${owed} block${owed === 1 ? '' : 's'}`;
    return {
      tone: 'qa',
      text: `${submitted} — QA is still required${which}. Open the toolbar popup to finish it.`,
    };
  }

  /** The standing "you still owe QA" line. Storage-driven, so it cannot be dismissed away. */
  function renderQaOwed() {
    const owed = state.pendingQa;
    qaOwed.textContent = '';
    qaOwed.classList.toggle('hidden', owed.length === 0);
    if (!owed.length) return;
    const titles = owed.map((p) => p.blockTitle).filter(Boolean).join(', ');
    qaOwed.appendChild(mk(doc, 'span', null,
      `QA is still required on ${owed.length} block${owed.length === 1 ? '' : 's'}${titles ? `: ${titles}` : ''}. `
      + 'Open the toolbar popup to finish it.'));
  }

  function renderStopNotice() {
    renderQaOwed();
    const n = state.stopNotice;
    notice.textContent = '';
    notice.classList.toggle('hidden', !n);
    notice.classList.toggle('is-qa', !!(n && n.tone === 'qa'));
    notice.classList.toggle('is-error', !!(n && n.tone === 'error'));
    if (!n) return;
    notice.appendChild(mk(doc, 'span', 'mm-stop-notice-text', n.text));
    const dismiss = mk(doc, 'button', 'mm-stop-notice-x', '×');
    dismiss.type = 'button';
    dismiss.title = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.addEventListener('click', () => {
      state.stopNotice = null;
      renderStopNotice();
    });
    notice.appendChild(dismiss);
  }

  async function refresh(force) {
    await loadLocal();
    await loadRemote(force);
    render();
  }

  // ── live updates: storage is the bus, nothing polls the server ────────────
  const onChanged = (changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    if (changes.timers) {
      state.timers = Array.isArray(changes.timers.newValue) ? changes.timers.newValue : [];
      dirty = true;
    }
    if (changes.schedEndBlocks) {
      state.schedEndBlocks = changes.schedEndBlocks.newValue || {};
      dirty = true;
    }
    if (changes.taskFeedCache) {
      state.feed = changes.taskFeedCache.newValue || state.feed;
      dirty = true;
    }
    if (changes.healthCache) {
      state.health = changes.healthCache.newValue || state.health;
      dirty = true;
    }
    // The QA set is written by whichever surface stopped the block and RESOLVED by
    // the popup as the member works through it. This surface follows both directions
    // off the same bus, so the standing "QA is still required" line disappears when —
    // and only when — the requirement is actually gone.
    if (changes[PENDING_KEY]) {
      getPendingQaAll().then((items) => { state.pendingQa = items; render(); });
    }
    // (0.11.3: the work-folder draft no longer reaches any surface, so the old
    // recovery mount on its storage key is gone. The setup card follows
    // `healthCache` above, like the status line and the strip.)
    // ⛔ A REAL SYNC, not a recovery mount — see renderCapture(). The gate's state
    // changes in the service worker (a 401, a 4-hourly re-validation, a pause taken
    // on another surface) and this surface has to follow it.
    if (changes[CAPTURE_KEY]) {
      // ⛔ BOTH surfaces of the same fact repaint together. The card and the health
      // strip's feed lane are now two readings of one gate; repainting only the
      // card is how a member ends up looking at "Paused." six pixels above a lane
      // still saying capture is on.
      getCapture().then((st) => {
        state.capture = st;
        renderCapture();
        renderHealthStrip();
        renderStatusLine();
      }).catch(() => { /* keep last */ });
    }
    if (changes[POPOUT_PREFS_KEY]) {
      state.prefs = { ...DEFAULT_PREFS, ...(changes[POPOUT_PREFS_KEY].newValue || {}) };
      applyPrefs();
    }
    if (dirty) render();
  };
  chrome.storage.onChanged.addListener(onChanged);

  const tick = setInterval(() => updateClocks(timerCards, state.timers, state.schedEndBlocks), 1000);

  // ── boot ──────────────────────────────────────────────────────────────────
  (async () => {
    await loadLocal();
    render();            // paint from local state immediately — no blank panel
    await loadRemote(false);
    render();
  })();

  return {
    actionsHost: actions,
    refresh,
    setZoom,
    destroy() {
      clearInterval(tick);
      setupPoller.stop();
      try { chrome.storage.onChanged.removeListener(onChanged); } catch (e) { /* ignore */ }
      try { doc.removeEventListener('keydown', onHoursKey); } catch (e) { /* ignore */ }
      try { doc.removeEventListener('visibilitychange', onSetupFocus); } catch (e) { /* ignore */ }
      try { if (win) win.removeEventListener('focus', onSetupFocus); } catch (e) { /* ignore */ }
    },
  };
}
