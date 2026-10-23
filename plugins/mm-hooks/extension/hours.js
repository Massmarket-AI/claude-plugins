// hours.js — "what has the system got for me, and let me fix what it missed."
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ WHY THIS FILE EXISTS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Two server routes shipped and nothing in this extension called either one:
//
//   GET  /api/ext/my-hours     — your own recorded hours, with how each one got
//                                there in the team's words
//   POST /api/ext/worklog-time — log hours you worked and did not clock
//
// Measured on the 0.11.1 tree before this file: ZERO references to either path
// anywhere in the extension. So the only way to repair a wrong number was for an
// operator to type rows in with the service-role key — which is how prod ended
// up with 28 rows and 70.57 h of provenance-ambiguous time, and three different
// meanings for the word "manual". A member who KNOWS they under-clocked had no
// button anywhere in the product, and the discrepancy travelled through a
// morning meeting instead of through the tool.
//
// ⛔ THE HOURS IN THE DATABASE ARE NOT THE SOURCE OF TRUTH TODAY. H9 still keeps
// the real hours by hand. Nothing a member does here pays or bills anybody — it
// is a ledger being cleaned before cutover, and every word on these surfaces is
// written to say that rather than to imply money is moving.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ NO NUMBER IS EVER PRE-FILLED
// ═══════════════════════════════════════════════════════════════════════════════
//
// The "days with work and no timer" list comes from the browser capture stream,
// whose bucket rolls on every URL change — it overstates real time by a factor
// that is DIFFERENT FOR EVERY MEMBER (1.83x-2.76x, measured), so there is no
// divisor that turns it into hours and this file must never invent one. It says
// which DAY to look at. The member says how long they worked.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ COPY LIVES HERE, VERBATIM, IN ONE OBJECT
// ═══════════════════════════════════════════════════════════════════════════════
//
// Every sentence a member reads on this surface is in `COPY` below. Two reasons,
// and the second one is the expensive one:
//
//   · one file to review, and `verify/hours-panel.test.mjs` can assert on the
//     exact strings rather than on whatever the DOM happened to contain;
//   · ⛔ A RAW DATABASE WORD IN FRONT OF A HUMAN IS HOW THIS WHOLE MESS STARTED.
//     "manual" means "I started the task myself" to the team and "hand-typed
//     backfill" in the schema. A Discord post used the schema meaning and told
//     Shezan he had logged zero hours when he had 55.2. Nothing here prints a
//     column name, a column value, or a row id. The provenance labels shown
//     beside each entry come from the SERVER, which owns that vocabulary in one
//     place (entry-provenance.ts) — this file renders them and never rewrites
//     them.
//
// No `chrome.*` at module scope, on purpose: `node --test verify/hours-panel.test.mjs`
// imports this file directly. common.js is safe to import for the same reason —
// verify/health-strip.mjs already loads it under plain node through panelui.js.

// ─────────────────────────────────────────────────────────────────────────────
// COPY
// ─────────────────────────────────────────────────────────────────────────────

// ⛔ EVERY STRING BELOW WAS AUTHORED BY OPUS FOR EXT #13 AND PLACED ON 2026-09-22.
// A new member-facing string takes the same route — authored first, then placed —
// and is never written inline here.
// Constraints every sentence here inherits: no database word, no row id, never the
// bare word "manual" (it means two different things to this team), and nothing
// that implies these hours pay or bill anyone today — H9 still keeps the real hours.
export const COPY = Object.freeze({
  openButton: '◷ My hours',
  openButtonTitle: 'See what the tracker recorded for you, and add time it missed',
  back: 'Back',
  // 0.11.3 (Opus, 2026-09-28) — the accessible name of the "← Back" button at the
  // top of My hours. The visible text stays `← ${back}`.
  backLabel: 'Back to the tracker',
  refreshTitle: 'Check again',
  loading: 'Loading your hours…',
  title: 'Your hours',
  intro: 'This is what the tracker has recorded for you, exactly as the system holds it; it is not a reviewed or approved total.',
  windowLabel: 'Days to show',
  windowOptions: Object.freeze([
    { days: 7, label: 'Last 7 days' },
    { days: 14, label: 'Last 14 days' },
    { days: 30, label: 'Last 30 days' },
  ]),
  totalLabel: 'Recorded in this period',
  howLabel: 'How it was recorded',
  clientsLabel: 'By client',
  daysLabel: 'By day',
  noClient: 'No client',
  noTask: 'No task named',
  stillRunning: 'Still running',
  emptyTitle: 'Nothing recorded for these days',
  emptyBody: 'If you worked on these days, that time is not on your record yet. Add it below to put it there.',
  loadError: 'Your recorded time could not be loaded. It will try again the next time you open this.',

  // The whole point of the surface.
  untrackedTitle: 'Days with work and no timer',
  untrackedBody: 'Something else on your machine recorded work on these days, and no time was tracked. These are not hours; they only say the day is worth a look. If you worked, add it.',
  untrackedBrowser: 'Active in the browser',
  untrackedClaude: 'Claude Code recorded work',
  untrackedMinutes: (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`,
  untrackedAtLeast: 'at least',
  untrackedAddCta: 'Add time for this day',

  // The form.
  formTitle: 'Add time you did not clock',
  formIntro: 'Use this for work you did while no timer was running; it goes on your record as time you entered by hand, in your own words.',
  fieldProject: 'Client',
  fieldProjectSearch: 'Search your clients',
  projectsNoMatch: 'No client matches that. Try part of their name.',
  projectsCount: (shown, total) => `${shown} / ${total} ${total === 1 ? 'client shown' : 'clients shown'}`,
  projectsNone: 'You have no active clients to pick. Ask your PM.',
  projectsLoadFailed: 'Your client list could not be loaded, and nothing was saved. Try again.',
  fieldDate: 'Day worked',
  fieldStart: 'Start time',
  fieldEnd: 'Finish time',
  fieldWhat: 'What you did',
  fieldWhatPlaceholder: 'What was this time for? A sentence is enough.',
  submit: 'Add time',
  submitting: 'Adding…',
  cancel: 'Cancel',
  savedTitle: '✓ Added.',
  savedBody: (lengthText, client) => `On your record as time you entered by hand: ${lengthText} · ${client}`,

  // ⛔ R4.2 — what is ALREADY on the record for the chosen day, shown in the form
  // before submit. Read from GET /api/ext/my-hours/window.
  recordedTitle: 'Already on your record for this day',
  recordedLoading: 'Checking what is already recorded for this day…',
  recordedNone: 'Nothing is recorded for this day yet.',
  recordedTruncated: 'There is more on your record for this day than is listed here.',
  recorded: Object.freeze({
    self_started_timer: 'A timer you started',
    hand_entered: 'Time you typed in by hand',
  }),
  attribution: Object.freeze({
    picked: 'You picked this client',
    auto: 'The tracker worked out the client',
    none: 'No client on it yet',
  }),
  notCounted: Object.freeze({
    not_approved: 'Not counted: this entry has not been approved',
    still_running: 'Not counted yet: the timer is still running, and its hours count once it is stopped',
    legacy: 'Not counted: an old entry from before the tracker began its own records, kept for history only',
    runaway_auto_close: 'Not counted: this timer was left running and was stopped automatically, so it is held for a person to review',
    over_ceiling: 'Not counted: at 16 hours or longer this is too long to be one sitting, so it is held for a person to review',
  }),
  notCountedFallback: 'Not counted: held for a person to review',
  clashMark: 'Crosses the times you typed',
  // ⛔ D3 — one line per existing entry carries ONE small tag saying how it got there.
  tags: Object.freeze({
    timer: 'Timer',
    typed: 'Typed',
    auto: 'Auto',
  }),
  clashInline: 'These times cross time already on your record for this day. Change the times, or leave it: that time is already recorded.',
  clashRunningInline: 'A timer of yours is still running across these times. Stop it first, then add this.',
  sameClientInline: 'You already have time for this client on this day. Check it is not the same work before you add this.',
  // ⛔ Fail closed: the day's record could not be read, so nothing above can warn.
  recordedUnchecked: 'Your record for this day could not be checked, so your existing time may already cover this. Check before you add it.',
  recordedRecheck: 'Check the day again',
  uncheckedTitle: 'We could not check this day first',
  uncheckedBody: 'The tracker could not see what is already on your record for this day, so it cannot warn you about time you already have. Check again, or add it only if you are sure it is not already there.',
  uncheckedConfirm: 'Add it anyway',
  uncheckedRetry: 'Check the day again',

  // Client-side validation. Each one names the field it is about.
  needProject: 'Pick the client this time was for.',
  needDate: 'Pick the day you worked.',
  needStart: 'Enter the time you started.',
  needEnd: 'Enter the time you finished.',
  needWhat: 'Say what you did. A sentence is enough.',
  endBeforeStart: 'The finish time is before the start time. Check both. Work that ran past midnight goes in as two entries.',
  inFuture: 'That finishes in the future. This is for work you have already done.',

  // The two refusals a member had never seen, because nothing ever called the
  // route. Both are answerable, and the copy says how.
  overlapTitle: 'Those times cross time you already have',
  overlapBody: 'Nothing was saved. Part of that stretch is already on your record for this day. Check the day, then change the times, or leave it: that time is already recorded.',
  overlapRunningBody: 'Nothing was saved. A timer of yours is still running across that stretch. Stop it first, then add the time.',
  duplicateTitle: 'This may already be on your record',
  duplicateBody: 'This may already be on your record. Look at what is there. If this really is separate work, confirm it and it goes on your record as you entered it.',
  duplicateConfirm: 'Separate work, add it',
  duplicateCancel: 'Already on my record',
  duplicateExpired: 'Nothing was saved. That check is out of date, so press Add time again to run it once more, then confirm.',
  duplicateAnswered: 'Nothing new was saved. That question was already answered. Press Add time again to re-check.',

  // Every other refusal, by the server's machine-readable reason.
  refusals: Object.freeze({
    missing_description: 'Nothing was saved. Say what you did. A sentence is enough.',
    description_too_long: 'Nothing was saved. That description is too long for this box. A sentence about the work is enough.',
    missing_project_id: 'Nothing was saved. Pick the client this time was for.',
    invalid_project_id: 'Nothing was saved. The client did not come through. Pick it again.',
    unknown_project_id: 'Nothing was saved. That client is no longer on your list. Pick another one.',
    unknown_ticket_id: 'Nothing was saved. That task is no longer there. Add the time against the client instead.',
    ticket_project_mismatch: 'Nothing was saved. That task belongs to a different client. Pick the client it belongs to.',
    ticket_attribution_unavailable: 'Nothing was saved. Time cannot be added to a single task yet. Add it against the client.',
    future_entry: 'Nothing was saved. That finishes in the future. This is for work you have already done.',
    invalid_window: 'Nothing was saved. The finish time is before the start time. Check both.',
    entry_too_long: 'Nothing was saved. That is longer than one entry can be. Split it into the separate sittings you actually worked.',
    too_old: 'Nothing was saved. That day is further back than this form takes. Tell Rob about time from that far back.',
    missing_started_at: 'Nothing was saved. Enter the time you started.',
    missing_ended_at: 'Nothing was saved. Enter the time you finished.',
    invalid_started_at: 'Nothing was saved. The start time did not come through. Pick it again.',
    invalid_ended_at: 'Nothing was saved. The finish time did not come through. Pick it again.',
  }),
  refusalFallback: 'Nothing was saved. Try again, and tell Rob if it keeps happening.',
  unreachable: 'The server could not be reached, so nothing was saved. Try again in a moment.',
  notConnected: 'This extension is not connected yet. Open settings and add your token.',
});

/** The longest window this surface will ask for. Matches the route's own cap. */
export const MAX_WINDOW_DAYS = 90;

// ─────────────────────────────────────────────────────────────────────────────
// Time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `<input type="date">` value + two `<input type="time">` values, as instants.
 *
 * ⛔ Built through the Date constructor's LOCAL-time arguments, never by string
 * concatenation into `new Date("2026-09-11T14:00")`. Six of seven members work
 * in Dhaka and the server thinks in New York: an hour that silently lands on the
 * wrong side of a day boundary is the same class of error as the vocabulary bug
 * this whole surface exists to fix. The member's own machine decides what
 * "14:00 on the 11th" means, which is the only definition they can check.
 *
 * Returns null when any part is missing or unparseable — the caller turns that
 * into the named field message, never into a guess.
 */
export function toInstants(dateStr, startStr, endStr) {
  const d = parseDateParts(dateStr);
  const s = parseTimeParts(startStr);
  const e = parseTimeParts(endStr);
  if (!d || !s || !e) return null;
  const started = new Date(d.y, d.m - 1, d.d, s.h, s.min, 0, 0);
  let ended = new Date(d.y, d.m - 1, d.d, e.h, e.min, 0, 0);
  // ⛔ NO MIDNIGHT ROLLOVER. A finish time before the start time is rejected as a
  // typo, not silently read as "you worked past midnight". Guessing would turn a
  // fat-fingered 09:00/08:00 into 23 hours on a client's bank, and the member
  // asked for neither. Somebody who genuinely worked past midnight adds two
  // entries, which is also what the day-by-day report will show them.
  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) return null;
  return { startedAt: started.toISOString(), endedAt: ended.toISOString(), startedMs: started.getTime(), endedMs: ended.getTime() };
}

function parseDateParts(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function parseTimeParts(v) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(v || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

/** "2h 30m" — the way a person says it. Never a decimal, never "1.5 h". */
export function fmtDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** Hours as they come back from the ledger (a float) — same phrasing. */
export function fmtLedgerHours(hours) {
  return fmtDuration(Math.round((Number(hours) || 0) * 60));
}

/** `<input type="date">` value for a Date, in the member's own timezone. */
export function dateInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — everything the member can be told BEFORE a request is spent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check the form and build the request body.
 *
 * ⛔ This is a COURTESY, NOT A GUARD. Every one of these rules is enforced again
 * server-side, and the server's version is the one that counts: the client is
 * not a trust boundary, the token is. What this buys is a member who is told
 * "the finish time is before the start time" instantly and by the field, instead
 * of after a round trip that returns a sentence about a window.
 *
 * Returns { ok: true, body } or { ok: false, field, message }.
 */
export function buildSubmission(form, nowMs = Date.now()) {
  const projectId = String(form.projectId || '').trim();
  if (!projectId) return { ok: false, field: 'project', message: COPY.needProject };
  if (!String(form.date || '').trim()) return { ok: false, field: 'date', message: COPY.needDate };
  if (!String(form.start || '').trim()) return { ok: false, field: 'start', message: COPY.needStart };
  if (!String(form.end || '').trim()) return { ok: false, field: 'end', message: COPY.needEnd };

  const description = String(form.description || '').trim();
  // Mirrors the server's guard 1: a description of invisible characters is an
  // hour with no account of itself. `\p{Cf}` is where U+200B and friends live —
  // `.trim()` alone does not remove them, which is how a 201 once shipped with a
  // description that rendered as nothing.
  if (!description || description.replace(/[\p{Cf}\s]/gu, '') === '') {
    return { ok: false, field: 'what', message: COPY.needWhat };
  }

  const t = toInstants(form.date, form.start, form.end);
  if (!t) return { ok: false, field: 'date', message: COPY.needDate };
  if (t.endedMs <= t.startedMs) return { ok: false, field: 'end', message: COPY.endBeforeStart };
  // The server allows 60s of clock skew; match it rather than being stricter,
  // so a member who finishes and immediately logs is not refused locally for a
  // request the server would have taken.
  if (t.endedMs > nowMs + 60000) return { ok: false, field: 'end', message: COPY.inFuture };

  const body = {
    project_id: projectId,
    started_at: t.startedAt,
    ended_at: t.endedAt,
    description,
  };
  if (form.ticketId) body.ticket_id = String(form.ticketId);
  if (form.duplicateCheckId) body.duplicate_check_id = String(form.duplicateCheckId);
  return { ok: true, body, minutes: Math.round((t.endedMs - t.startedMs) / 60000) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The two calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ext/my-hours.
 *
 * `request` is common.js `apiRequest` — injected so the unit test can drive
 * every branch without a browser or a token.
 *
 * Returns { ok: true, ledger } or { ok: false, message }.
 */
export async function loadMyHours(request, { days = 7 } = {}) {
  const n = Number(days);
  const span = Number.isInteger(n) && n >= 1 && n <= MAX_WINDOW_DAYS ? n : 7;
  let res;
  try {
    res = await request(`/api/ext/my-hours?days=${span}`);
  } catch (e) {
    return { ok: false, message: e && e.code === 'not_configured' ? COPY.notConnected : COPY.loadError };
  }
  if (!res.ok) return { ok: false, message: COPY.loadError, status: res.status };
  return { ok: true, ledger: res.data || {} };
}

/**
 * POST /api/ext/worklog-time.
 *
 * ⛔ THE REFUSALS ARE THE FEATURE. Both 409s below are live on the server and
 * neither had ever been seen by a member, because nothing called the route. A
 * refusal a member cannot answer is indistinguishable from "it didn't save", so
 * each one comes back as a named outcome the caller can render an action for:
 *
 *   { ok: true,  entry }                           → it is on the record
 *   { ok: false, kind: 'overlap',   running }      → change the times, or stop
 *                                                    the timer that is running
 *   { ok: false, kind: 'duplicate', checkId,
 *                findings }                        → confirm and resubmit
 *   { ok: false, kind: 'ack_stale' }               → the token aged out; re-check
 *   { ok: false, kind: 'refused',   message }      → a named guard, in our words
 *   { ok: false, kind: 'unreachable' }             → nothing was saved
 *
 * ⛔ `kind` is never rendered. The caller picks copy from COPY by it.
 */
export async function submitPastHours(request, body) {
  let res;
  try {
    res = await request('/api/ext/worklog-time', { method: 'POST', body });
  } catch (e) {
    return {
      ok: false,
      kind: e && e.code === 'not_configured' ? 'not_connected' : 'unreachable',
      message: e && e.code === 'not_configured' ? COPY.notConnected : COPY.unreachable,
    };
  }

  const data = res.data || {};
  if (res.ok) return { ok: true, entry: data };

  const reason = String(data.reason || '');

  if (reason === 'possible_duplicate') {
    return {
      ok: false,
      kind: 'duplicate',
      checkId: data.duplicate_check_id || null,
      // Server-authored sentences (duplicate-detection.ts). Rendered verbatim:
      // they are the only place the member is told WHICH entry looks the same,
      // and rewording them here would put two versions of that sentence in the
      // product.
      findings: Array.isArray(data.findings) ? data.findings : [],
    };
  }

  if (reason === 'overlaps_existing_entry') {
    // The server's message names the clashing row's id and window. The id is a
    // uuid and means nothing to a member, so it is NOT shown — but the one bit
    // of it that is actionable is whether the clash is a timer still running,
    // because that has a different fix (stop it) from a window that overlaps
    // history (change the times).
    const running = /still running/i.test(String(data.error || ''));
    return { ok: false, kind: 'overlap', running };
  }

  if (reason === 'ack_expired' || reason === 'ack_mismatch') {
    return { ok: false, kind: 'ack_stale', message: COPY.duplicateExpired };
  }
  if (reason === 'ack_spent' || reason === 'ack_unknown') {
    return { ok: false, kind: 'ack_stale', message: COPY.duplicateAnswered };
  }

  const named = COPY.refusals[reason];
  return {
    ok: false,
    kind: 'refused',
    reason,
    // ⛔ NEVER `data.error` as a fallback. The server's own sentences are written
    // for an operator reading a log — they name columns, migrations and row ids.
    // An unmapped reason gets our sentence, which says the one thing that is
    // always true and always useful: nothing was saved.
    message: named || COPY.refusalFallback,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shaping the ledger for the panel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One member's slice of the ledger, in the shape the panel renders.
 *
 * ⛔ The provenance buckets come back from the server with their labels already
 * in the team's words, and ALL of them come back, zeros included. Both of those
 * are deliberate server-side (entry-provenance.ts) and this function preserves
 * them: it does not filter empty buckets and it does not relabel. Quoting one
 * bucket on its own — "your manual hours are zero" — is the exact post that told
 * Shezan he had logged nothing when he had 55.2 hours.
 */
export function shapeLedger(ledger, memberEmail) {
  const members = Array.isArray(ledger && ledger.members) ? ledger.members : [];
  const wanted = String(memberEmail || '').toLowerCase();
  const me = members.find((m) => String(m.memberEmail || '').toLowerCase() === wanted) || members[0] || null;
  const window = (ledger && ledger.window) || {};
  if (!me) {
    return { windowLabel: window.label || '', empty: true, totalText: fmtLedgerHours(0), buckets: [], clients: [], days: [], untracked: [] };
  }
  const summary = me.summary || {};
  return {
    windowLabel: window.label || '',
    empty: (summary.totalEntries || 0) === 0,
    totalText: fmtLedgerHours(summary.totalHours || 0),
    totalEntries: summary.totalEntries || 0,
    buckets: (Array.isArray(summary.buckets) ? summary.buckets : []).map((b) => ({
      label: b.label,
      hoursText: fmtLedgerHours(b.hours || 0),
      entries: b.entries || 0,
    })),
    clients: (Array.isArray(me.clients) ? me.clients : []).map((c) => ({
      client: c.client || COPY.noClient,
      hoursText: fmtLedgerHours(c.hours || 0),
    })),
    days: (Array.isArray(me.days) ? me.days : []).map((d) => ({
      label: d.label,
      hoursText: fmtLedgerHours(d.hours || 0),
      lines: (Array.isArray(d.lines) ? d.lines : []).map((l) => ({
        when: l.startLocal && l.endLocal ? `${l.startLocal}–${l.endLocal}` : (l.startLocal || ''),
        amountText: l.stillRunning ? COPY.stillRunning : fmtLedgerHours(l.hours || 0),
        client: l.client || COPY.noClient,
        task: l.task || COPY.noTask,
        // ⛔ Straight from the server. `provenance.label` is the ONE place a
        // stored value becomes a word the team uses; a local mapping here would
        // be a second vocabulary, which is the bug.
        how: (l.provenance && l.provenance.label) || '',
        notCounted: l.notCountedReason || null,
      })),
    })),
    // Undefined means the server did not look. Empty means it looked and found
    // none. Both render as no section — but only the second is a fact, so the
    // distinction is preserved rather than collapsed to `|| []` here.
    untracked: Array.isArray(me.untrackedDays) ? me.untrackedDays.map(shapeUntrackedDay) : [],
  };
}

function shapeUntrackedDay(d) {
  const bits = [];
  if (d.activeMinutes > 0) {
    bits.push(
      `${COPY.untrackedBrowser} — ${d.truncated ? `${COPY.untrackedAtLeast} ` : ''}${COPY.untrackedMinutes(d.activeMinutes)}`,
    );
  }
  if (d.worklogEntries > 0) bits.push(COPY.untrackedClaude);
  return { date: d.date, label: d.label, why: bits.join(' · ') };
}


// ═══════════════════════════════════════════════════════════════════════════════
// ⛔ R4.2 — WHAT IS ALREADY ON THE RECORD FOR THE DAY BEING ADDED
// ═══════════════════════════════════════════════════════════════════════════════
//
// Rob, 2026-09-14: hand-entered time stays auto-approved at insert (R4.1), so a typed
// hour draws a client balance the moment it is saved. The primary control on that is
// the member SEEING what is already recorded for the window before they submit —
// timer entries, entries the tracker attributed, and earlier hand entries — and being
// warned before a duplicate. So the form asks, as soon as a day is chosen:
//
//   GET /api/ext/my-hours/window?from=YYYY-MM-DD&to=YYYY-MM-DD   (lane L4a, server)
//   → { entries: [ { id, project_id, project_label, started_at, ended_at,
//                    duration_minutes, recorded: 'self_started_timer'|'hand_entered',
//                    project_attribution: 'picked'|'auto'|'none',
//                    counts, excluded_reason } ], truncated }
//
// ⛔ ABSENT ENDPOINT = TODAY'S FORM. A server without the route (every build before
// lane L4a ships), a refusal, or an unreachable server returns `available: false`,
// and the form renders exactly as it did with no section at all. It never blocks a
// submit on a check that could not be made — the server's own guard 4b still stands.
//
// ⛔ THE OVERLAP RULE IS THE SERVER'S, NOT A STRICTER ONE. worklog-time/route.ts guard
// 4b refuses when an existing row of this member ON THE SAME CLIENT has started_at <
// new end AND (ended_at > new start, or ended_at IS NULL) — with no filter on status,
// source or whether the row counts. So an entry that does not count still blocks, and
// this mirrors that: a clash flagged here is a 409 the server would return anyway,
// said before the round trip and with the clashing entries in view.
//
// ⛔ 0.11.5 — SAME CLIENT ONLY (Rob, 2026-10-23: "they can work on clients in
// parallel"; OW #571, migration 310). Time on ANOTHER client in the same stretch is
// parallel work, never a clash. A row with no client is its own group, never a
// wildcard: two rows with no client still clash, and a row with no client never
// clashes with a named one. Until 0.11.5 this refused any overlap, which the server
// no longer does.

export const WINDOW_PATH = '/api/ext/my-hours/window';

/** A YYYY-MM-DD shifted by whole days, on the member's own calendar. */
export function shiftDate(dateStr, days) {
  const d = parseDateParts(dateStr);
  if (!d) return null;
  return dateInputValue(new Date(d.y, d.m - 1, d.d + Number(days || 0), 12, 0, 0, 0));
}

/** How long the day's record may take before it counts as "could not be checked". */
export const WINDOW_TIMEOUT_MS = 8000;

/**
 * Load what is recorded around `dateStr`.
 *
 * ⛔ One day either side is asked for, then filtered locally to the member's own day.
 * The server buckets `from`/`to` in whatever timezone lane L4a chose; the member's day
 * is their machine's. Asking for the three days around it means an entry near midnight
 * is never missed because the two clocks disagree about which date it is on.
 *
 * Returns { available: true, entries, truncated } or
 *         { available: false, reason, status } — reason is one of
 *         'no_date' | 'network' | 'timeout' | 'http' | 'shape'.
 *
 * ⛔ `available: false` is NOT "nothing recorded" and NOT "an old server, carry on".
 * The route is a hard precondition of 0.11.2 (RELEASE-PLAN-0.11.2.md §2 gate 4), so
 * every failure — a 404 included — is "the record could not be checked", and the
 * form fails closed on it (see uncheckedNeedsConfirm).
 */
export async function loadRecordedWindow(request, dateStr, { timeoutMs = WINDOW_TIMEOUT_MS } = {}) {
  const from = shiftDate(dateStr, -1);
  const to = shiftDate(dateStr, 1);
  if (!from || !to) return { available: false, reason: 'no_date', status: null };
  let res;
  let timer = null;
  try {
    // apiRequest has no timeout of its own; a read that never answers must not leave
    // the form waiting on a check that is never going to arrive.
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); });
    res = await Promise.race([request(`${WINDOW_PATH}?from=${from}&to=${to}`), timedOut]);
  } catch (e) {
    return { available: false, reason: 'network', status: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res === TIMED_OUT) return { available: false, reason: 'timeout', status: null };
  const data = res && res.data;
  if (!res || !res.ok) return { available: false, reason: 'http', status: res ? res.status : null };
  if (!data || !Array.isArray(data.entries)) return { available: false, reason: 'shape', status: res.status };
  const entries = data.entries.filter((e) => e && typeof e.started_at === 'string' && Number.isFinite(Date.parse(e.started_at)));
  return { available: true, entries, truncated: data.truncated === true };
}
const TIMED_OUT = Symbol('timed_out');

/**
 * ⛔ FAIL CLOSED (R4.2). Must the member explicitly confirm before this submit goes out?
 *
 * Under R4.1 a typed hour is approved when saved and draws down a client balance, and
 * R4.2 — showing what is already recorded — is the primary control on that. So a day
 * whose record was not read (a 404, a 4xx, a 5xx, a network error, a timeout, a shape
 * we do not know, or a read still pending for a different day) never submits silently:
 * the member is told the day could not be checked and must confirm for THAT day.
 *
 *   recordWindow      the form's last read: { date, available }
 *   date              the day in the date field now
 *   acknowledgedDate  the day the member last confirmed "add it anyway" for, or null
 */
export function uncheckedNeedsConfirm({ recordWindow, date, acknowledgedDate }) {
  if (!date) return false; // buildSubmission refuses a missing day before this runs
  if (!recordWindow || recordWindow.date !== date) return true;
  if (recordWindow.available) return false;
  return acknowledgedDate !== date;
}

/** [startMs, endMs] of a recorded entry. A running one runs to now. */
export function recordedSpan(entry, nowMs = Date.now()) {
  const start = Date.parse(entry.started_at);
  const endParsed = entry.ended_at ? Date.parse(entry.ended_at) : NaN;
  const running = !entry.ended_at;
  const end = running ? Math.max(start, nowMs) : endParsed;
  return { start, end, running };
}

/** The entries that touch the member's own calendar day, earliest first. */
export function entriesOnDay(entries, dateStr, nowMs = Date.now()) {
  const d = parseDateParts(dateStr);
  if (!d || !Array.isArray(entries)) return [];
  const dayStart = new Date(d.y, d.m - 1, d.d, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(d.y, d.m - 1, d.d + 1, 0, 0, 0, 0).getTime();
  return entries
    .filter((e) => {
      const { start, end } = recordedSpan(e, nowMs);
      return Number.isFinite(start) && Number.isFinite(end) && start < dayEnd && (end > dayStart || (end === start && start >= dayStart));
    })
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

/** The client an entry or the form is on, as a group: no client is its own group (''). */
const clientGroup = (projectId) => (projectId == null ? '' : String(projectId).trim());

/**
 * The recorded entries ON THE SAME CLIENT (`projectId`) that the proposed
 * [startedMs, endedMs) crosses — guard 4b's rule. Entries on another client are
 * parallel work and never clash; no client is its own group (see the header above).
 * `running` is true when any of them is a timer still going, which has a different fix.
 */
export function clashesWith(entries, startedMs, endedMs, nowMs = Date.now(), projectId = null) {
  if (!Array.isArray(entries) || !Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs <= startedMs) {
    return { clashes: [], running: false };
  }
  const group = clientGroup(projectId);
  const clashes = entries.filter((e) => {
    if (clientGroup(e.project_id) !== group) return false;
    const start = Date.parse(e.started_at);
    if (!Number.isFinite(start) || !(start < endedMs)) return false;
    if (!e.ended_at) return true;
    const end = Date.parse(e.ended_at);
    return Number.isFinite(end) && end > startedMs;
  });
  return { clashes, running: clashes.some((e) => !e.ended_at) };
}

/** Entries for the same client on the day — a note, never a refusal. */
export function sameClientOnDay(dayEntries, projectId) {
  const id = String(projectId || '');
  if (!id || !Array.isArray(dayEntries)) return [];
  return dayEntries.filter((e) => String(e.project_id || '') === id);
}

/**
 * Everything the form checks against the record, in one call, so both surfaces
 * decide it the same way. `dayEntries` is entriesOnDay() output.
 */
export function checkAgainstRecorded({ dayEntries, form, nowMs = Date.now() }) {
  const t = form ? toInstants(form.date, form.start, form.end) : null;
  const { clashes, running } = t ? clashesWith(dayEntries, t.startedMs, t.endedMs, nowMs, form.projectId) : { clashes: [], running: false };
  const clashIds = new Set(clashes.map((e) => e.id));
  const sameClient = form ? sameClientOnDay(dayEntries, form.projectId).filter((e) => !clashIds.has(e.id)) : [];
  return { clashes, running, clashIds, sameClient };
}

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * One recorded entry, in the words the form shows. ⛔ No id, no column value: the
 * two enums are mapped through COPY, and an unknown value renders as nothing rather
 * than as itself.
 */
export function describeRecorded(entry, nowMs = Date.now()) {
  const { start, end, running } = recordedSpan(entry, nowMs);
  const minutes = Number.isFinite(Number(entry.duration_minutes)) && entry.duration_minutes !== null && !running
    ? Number(entry.duration_minutes)
    : Math.max(0, Math.round((end - start) / 60000));
  let notCounted = null;
  if (entry.counts === false) {
    notCounted = Object.prototype.hasOwnProperty.call(COPY.notCounted, entry.excluded_reason)
      ? COPY.notCounted[entry.excluded_reason]
      : COPY.notCountedFallback;
  }
  return {
    when: running ? `${hhmm(start)}–` : `${hhmm(start)}–${hhmm(end)}`,
    lengthText: running ? COPY.stillRunning : fmtDuration(minutes),
    client: (entry.project_label && String(entry.project_label).trim()) || COPY.noClient,
    how: Object.prototype.hasOwnProperty.call(COPY.recorded, entry.recorded) ? COPY.recorded[entry.recorded] : '',
    attribution: Object.prototype.hasOwnProperty.call(COPY.attribution, entry.project_attribution) ? COPY.attribution[entry.project_attribution] : '',
    notCounted,
    running,
    // ⛔ D3 — the one small tag on the entry's line. A timer entry whose client the
    // tracker worked out is `auto`; any other timer entry is `timer`; a hand entry is
    // `typed`. An unknown `recorded` value gets no tag rather than a guessed one.
    tag: entry.recorded === 'hand_entered'
      ? 'typed'
      : entry.recorded === 'self_started_timer'
        ? (entry.project_attribution === 'auto' ? 'auto' : 'timer')
        : '',
  };
}

/**
 * One existing entry as the add form draws it: a single line (time range · client ·
 * tag) and an explanation ONLY when the entry is flagged — it crosses the typed
 * times, or it does not count. `clash` is whether the proposed times cross it.
 */
export function recordedLine(entry, { clash = false, nowMs = Date.now() } = {}) {
  const d = describeRecorded(entry, nowMs);
  const explain = [clash ? COPY.clashMark : null, d.notCounted].filter(Boolean).join(' · ');
  return {
    text: `${d.when} · ${d.client}`,
    tag: d.tag,
    tagText: d.tag ? COPY.tags[d.tag] : '',
    flagged: !!explain,
    explain,
  };
}
