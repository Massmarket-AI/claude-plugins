// taskfeed.js — the COMPLETE task inventory, grouped one card per client.
//
// ⛔ WHY THIS EXISTS, AND WHY IT IS NOT THE CHIP FEED.
//
// Three surfaces answer three different questions (Rob, 2026-08-11):
//   ambient hook line → "am I missing something?"
//   chips            → "this needs me NOW" (an EXCEPTION channel, not a queue)
//   THIS side panel  → the COMPLETE inventory, on demand
//
// So this module reads `GET /api/ext/next-task` — the full ranked member feed —
// and NEVER `GET /api/ext/chip-feed`.
//
// ⛔ /api/ext/chip-feed IS NOT READ-ONLY. Despite being a GET it calls
// recordSurfacing(event:'minted') for every candidate it serves (see
// buildChipFeed, "SERVE = MINTED", 2026-08-02). Calling it every time someone
// opens the side panel would inflate the mint ledger exactly the way that
// produced "2,598 minted events against ~31 real tasks" — the churn
// MAX_UNCLAIMED_RESURFACES was added to stop. It also only ever returns the
// DRIP head (1 group, plus urgent bypasses), which is by construction NOT the
// complete inventory this panel is for. Both reasons are independently
// disqualifying. next-task is documented read-only, un-dripped, and is the same
// ranked feed the chip bridge itself drips from.
//
// Cost: ONE cached GET, TTL below, shared through chrome.storage.local by the
// side panel, the popup and the popped-out window. OW's database has no load
// headroom, so there is no polling anywhere in here.

import { apiFetch } from './common.js';

export const TASK_FEED_CACHE_KEY = 'taskFeedCache';
export const TASK_FEED_TTL_MS = 5 * 60 * 1000; // matches HEALTH_TTL_MS

/** A client item whose response window closes inside this many ms is "reply due". */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Mirrors the server's NEAR_DEADLINE_MS (next-task-ranker). Do not fork. */
export const NEAR_DEADLINE_MS = 72 * 60 * 60 * 1000;

/** Server-side group key for an item with no project. Keep in sync with groupByClient. */
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * What the panel SHOWS for the server's "Unassigned" bucket (spec §4.1:
 * "Internal work uses massmarket.ai as the client label").
 *
 * ⛔ Display only. The group fingerprint and the copied chip text keep the
 * server's own label, because the fingerprint is the idempotency key the
 * chip-event ledger is written against — a chip claiming `client:massmarket-ai`
 * would never match the `client:unassigned` row the server minted. Relabelling
 * belongs in rankMemberFeed/groupByClient server-side, not here.
 */
export const UNASSIGNED_DISPLAY = 'massmarket.ai';

// ─────────────────────────────────────────────────────────────── fetch + cache

/**
 * Never throws. Returns { data, fetchedAt, error, cached } — the same contract
 * as fetchHealth(), including the "fall back to the last good cache" behaviour
 * so a failed refresh degrades to "as of <time>" instead of an empty panel.
 */
export async function fetchTaskFeed({ force = false } = {}) {
  let cached = null;
  try {
    const o = await chrome.storage.local.get(TASK_FEED_CACHE_KEY);
    cached = o[TASK_FEED_CACHE_KEY] || null;
  } catch (e) { /* storage unavailable — treat as a cold read */ }

  if (!force && cached && cached.data && Date.now() - (cached.fetchedAt || 0) < TASK_FEED_TTL_MS) {
    return { ...cached, cached: true, error: null };
  }

  let data = null;
  let error = null;
  try {
    data = await apiFetch('/api/ext/next-task');
  } catch (e) {
    error = e && e.status ? `http_${e.status}` : (e && e.code) || 'unreachable';
  }

  if (error) {
    if (cached && cached.data) return { ...cached, cached: true, error };
    return { data: null, fetchedAt: Date.now(), error, cached: false };
  }

  const fresh = { data, fetchedAt: Date.now() };
  try { await chrome.storage.local.set({ [TASK_FEED_CACHE_KEY]: fresh }); } catch (e) { /* ignore */ }
  return { ...fresh, error: null, cached: false };
}

/** Read the cache without touching the network (used by the popped-out window). */
export async function readCachedTaskFeed() {
  try {
    const o = await chrome.storage.local.get(TASK_FEED_CACHE_KEY);
    return o[TASK_FEED_CACHE_KEY] || null;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────── ports of the server's grouping/brief
// Everything below this line is a DELIBERATE, byte-exact port of
// src/lib/ext/chip-feed.ts on the OW side. It exists so the panel can hand
// someone the same artifact the chip bridge would have handed them, for a
// client the drip has not reached yet.
//
// ⛔ If you change any string here, you have changed what gets pasted into a
// Claude Code session. The parity test in verify/chip-text-parity.mjs compiles
// the REAL server function and asserts byte-identical output — run it.

const SKILL_NAME = 'task-chip-flow';
export const CLIENT_GROUP_PREFIX = 'client:';

/**
 * Port of chip-feed.ts shellJsonBody(): JSON with control characters flattened to
 * spaces and every `'` escaped for single-quoted shell.
 *
 * ⛔ The curl bodies below are pasted into a terminal. A raw newline or an
 * unescaped apostrophe inside a client label does not produce a bad request — it
 * ENDS THE QUOTE and hands the rest of the line to the shell.
 */
function shellJsonBody(value) {
  return JSON.stringify(value, (_key, v) =>
    (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ') : v),
  ).replace(/'/g, `'"'"'`);
}

/** Port of chip-feed.ts truncate(). */
function truncate(s, max) {
  const t = (s || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Port of chip-feed.ts clientGroupFingerprint(). */
export function clientGroupFingerprint(label) {
  const slug = (label || 'unassigned')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${CLIENT_GROUP_PREFIX}${slug || 'unassigned'}`;
}

/**
 * Port of chip-feed.ts fingerprintFor().
 *
 * ⛔ A TABLE, NOT A TERNARY CHAIN — and the difference is not style. The chain
 * that used to be here ended in a `: 'block'` default, so ANY type the server
 * added mapped to `block:<id>` here while the server mapped it correctly. That is
 * the worst shape a parity bug can take: the extension writes chip-event rows
 * under a key the server never minted, and nothing errors. The server grew
 * `ticket_queue` on 2026-08-20; both sides are tables now.
 */
const FINGERPRINT_PREFIX = {
  block: 'block',
  phase_due: 'phase',
  job_card: 'job_card',
  // ⛔ `id` on this one is a PROJECT id, not a row id — the item summarises N
  // tickets rather than standing for one. That is what keeps the fingerprint
  // stable across refreshes. Keep in sync with chip-feed.ts.
  ticket_queue: 'tickets',
};

export function fingerprintFor(item) {
  return `${FINGERPRINT_PREFIX[item.type] || 'block'}:${item.id}`;
}

/** Port of chip-feed.ts isUrgent(). */
export function isUrgent(item, now) {
  if (item.rank_bucket === 0) return true;
  if (!item.due) return false;
  const due = Date.parse(item.due);
  return Number.isFinite(due) && due <= now;
}

/** Port of chip-feed.ts urgencyPhrase(). */
export function urgencyPhrase(item, now) {
  if (!item.due) return 'no date set';
  const due = Date.parse(item.due);
  if (!Number.isFinite(due)) return 'no date set';
  const deltaMs = due - now;
  if (deltaMs < 0) {
    const days = Math.floor(-deltaMs / 86400000);
    if (days >= 1) return `OVERDUE by ${days} day${days === 1 ? '' : 's'}`;
    return 'OVERDUE (today)';
  }
  if (deltaMs <= NEAR_DEADLINE_MS) {
    const hours = Math.round(deltaMs / 3600000);
    return `due in ${hours}h`;
  }
  const days = Math.round(deltaMs / 86400000);
  return `due in ${days} day${days === 1 ? '' : 's'}`;
}

/** Port of chip-feed.ts: a ranked FeedItem → a ClientGroupMember. */
export function memberFromItem(item, now) {
  return {
    fingerprint: fingerprintFor(item),
    title: item.title,
    // ⛔ CARRIED, not dropped. `groupByClient` proves a group's single project id
    // from this, and that id is what puts `project_id` in the claim curl — the
    // difference between a claim filed under `project:<uuid>` and one filed under
    // a coarse `label:<slug>`. The server's `clientWorkMemberFromFeedItem` has
    // always carried it; this port did not, so every locally-composed chip claimed
    // against a label.
    project_id: item.project_id ?? null,
    urgency: isUrgent(item, now) ? 'urgent' : 'normal',
    urgency_phrase: urgencyPhrase(item, now),
    due: item.due,
    est_hours: item.est_hours,
    rank_reason: item.rank_reason,
    kind: 'client_work',
    // Panel-only extras. They are NOT part of the ported brief and never reach
    // the clipboard text — keep it that way or parity breaks.
    _type: item.type,
    _id: item.id,
    _action: item.action,
    _logged_hours: item.logged_hours,
    _rank_bucket: item.rank_bucket,
  };
}

/**
 * Port of chip-feed.ts groupByClient(): one group per client, in the order
 * their best-ranked member appeared. `due` uses the server's STRING comparison
 * (`due < g.due`) on purpose — replicating it is what keeps the brief identical.
 */
export function groupByClient(rows) {
  const byClient = new Map();
  // ⛔ PROVEN, NOT GUESSED — the server's rule, ported exactly: a label with ONE
  // distinct project id across every member yields that id; a label shared by two
  // projects yields null. It is not a convenience field. It is what puts
  // `project_id` in the claim curl below, which is what lets a claim land as
  // `project:<uuid>` in the seen watermark instead of a coarse `label:<slug>`.
  const projectIds = new Map();
  for (const row of rows) {
    const label = (row.client || '').trim() || UNASSIGNED_LABEL;
    let g = byClient.get(label);
    if (!g) {
      g = {
        fingerprint: clientGroupFingerprint(label),
        client: label,
        members: [],
        urgency: 'normal',
        due: null,
        rank_bucket: row.rank_bucket,
        est_hours: null,
        project_id: null,
      };
      byClient.set(label, g);
      projectIds.set(label, new Set());
    }
    const pid = String((row.project_id ?? (row.member && row.member.project_id)) || '').trim();
    if (pid) projectIds.get(label).add(pid);
    g.members.push(row.member);
    if (row.member.urgency === 'urgent') g.urgency = 'urgent';
    if (row.rank_bucket < g.rank_bucket) g.rank_bucket = row.rank_bucket;
    const due = row.member.due;
    if (due && (!g.due || due < g.due)) g.due = due;
    if (row.member.est_hours != null) {
      g.est_hours = (g.est_hours ?? 0) + row.member.est_hours;
    }
  }
  byClient.forEach((g, label) => {
    const ids = Array.from(projectIds.get(label) || []);
    g.project_id = ids.length === 1 ? ids[0] : null;
  });
  return Array.from(byClient.values());
}

/** Port of chip-feed.ts buildClientGroupChipTitle(). */
export function buildClientGroupChipTitle(g) {
  const flag = g.urgency === 'urgent' ? '🔴 ' : '';
  const n = g.members.length;
  return `${flag}${truncate(g.client, 44)} — ${n} open item${n === 1 ? '' : 's'}`;
}

/**
 * Port of chip-feed.ts buildClientGroupBrief() — the COMPLETE chip text.
 *
 * ⛔ EVERY member, ALWAYS. No cap, no truncation, no "…and N more". Rob,
 * 2026-08-05: it must "enumerate every single mentioned detail of anything
 * that's a deliverable or a ticket without leaving out anything". Truncation is
 * a RENDERING concern (the card's collapsed state) and must never reach here.
 */
export function buildClientGroupBrief({ group, memberEmail, apiBase }) {
  const g = group;
  const urgent = g.members.filter((m) => m.urgency === 'urgent');
  const lines = [
    `# ${g.client} — everything open (${g.members.length} item${g.members.length === 1 ? '' : 's'})`,
    '',
    `**${g.urgency === 'urgent' ? '🔴 URGENT' : '🟢 Queued'}**${
      g.due ? ` · earliest due ${g.due.slice(0, 10)}` : ''
    }${g.est_hours ? ` · ~${g.est_hours}h total est` : ''}`,
    '',
    `This is EVERY pending item for this client, merged into one chip on purpose.`,
    `Orient once, then work the list — don't ask for them one at a time.`,
    '',
    '---',
    '',
    '## Step 1 — claim the client (do this FIRST)',
    '',
    // ⛔ `project_id` and `client_label` are in this body ON PURPOSE, and dropping
    // them silently degrades two things at once. They are what lets the claim land
    // as `project:<uuid>` in `member_client_looks` (the per-client seen watermark)
    // instead of a coarse `label:<slug>`, and they are the reason
    // `task_surfacing_events.project_id` stops being NULL — it was NULL on 4,146 of
    // 4,146 rows because no caller ever had a project id to send.
    //
    // ⛔ THIS PORT WAS SILENTLY 3 FIELDS BEHIND UNTIL 2026-08-20. The server grew
    // task_type / client_label / seen_items; this file kept emitting a bare
    // fingerprint. `verify/chip-text-parity.mjs` is supposed to catch exactly that
    // and could not: `build-server-ref.mjs` had stopped compiling months earlier
    // (unstubbed `@/` imports), so every run died with ERR_MODULE_NOT_FOUND, which
    // reads like a broken harness rather than a broken port. A parity test that
    // crashes is a parity test nobody runs.
    '```bash',
    `curl -fsS -X POST "${apiBase}/api/ext/chip-event" \\`,
    `  -H "Authorization: Bearer $(cat ~/.claude/mm-hooks/token)" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${shellJsonBody({
      event: 'claimed',
      task_fingerprint: g.fingerprint,
      task_type: 'client_group',
      ...(g.project_id ? { project_id: g.project_id } : {}),
      client_label: g.client,
      seen_items: g.members.map((m) => m.fingerprint),
    })}'`,
    '```',
    '',
    '## Step 2 — orient ONCE',
    '',
    `Run the **\`${SKILL_NAME}\`** skill for this client and set this session's`,
    `title to "${g.client} — working thread". You pay the orientation cost a`,
    `single time for every item below. That is the whole reason these are merged.`,
    '',
    '## Step 3 — put the list on screen as a CHECKLIST, then work it',
    '',
    `⛔ FIRST, call \`TodoWrite\` with one todo per item below, in this order.`,
    `That puts a live checklist above the command bar so progress is visible as`,
    `you move through them — mark each one \`completed\` the moment it lands, and`,
    `keep exactly one \`in_progress\`. Rob, 2026-08-04: this is how a merged chip`,
    `stays legible instead of turning into an opaque blob of work.`,
    '',
    `${g.members.length} item${g.members.length === 1 ? '' : 's'} total. They are`,
    `independent unless the scope says otherwise, so dispatch sub-agents in`,
    `parallel for the ones that don't interact, and do the rest inline. Each item`,
    `keeps its OWN fingerprint — claim and complete them individually as you go:`,
    '',
  ];

  g.members.forEach((m, i) => {
    const flag = m.urgency === 'urgent' ? '🔴' : '·';
    lines.push(
      `${i + 1}. ${flag} **${m.title}**${m.due ? ` — due ${m.due.slice(0, 10)}` : ''}${
        m.est_hours ? ` (est ${m.est_hours}h)` : ''
      }`,
    );
    lines.push(`   ${m.urgency_phrase} — ${m.rank_reason}`);
    lines.push(`   \`${m.fingerprint}\``);
  });

  lines.push(
    '',
    'Per item, when it\'s done:',
    '',
    '```bash',
    `curl -fsS -X POST "${apiBase}/api/ext/chip-event" \\`,
    `  -H "Authorization: Bearer $(cat ~/.claude/mm-hooks/token)" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${shellJsonBody({
      event: 'completed',
      task_fingerprint: "<THAT ITEM'S FINGERPRINT>",
      ...(g.project_id ? { project_id: g.project_id } : {}),
      client_label: g.client,
    })}'`,
    '```',
    '',
    '## Step 4 — close out the client',
    '',
    `When every item above is either completed or declined (with a reason), record`,
    `\`completed\` on the GROUP fingerprint \`${g.fingerprint}\`. That clears this`,
    `client from the queue in one move.`,
    '',
    `Anything you can't do: record \`declined\` on that ITEM with one line of why.`,
    `A decline is a real answer and it re-ranks or escalates — it never vanishes.`,
    '',
  );

  if (urgent.length) {
    lines.push(
      `⚠️ ${urgent.length} of these ${urgent.length === 1 ? 'is' : 'are'} urgent — do those first.`,
      '',
    );
  }
  lines.push(`_Group fingerprint: \`${g.fingerprint}\` · you: ${memberEmail}_`);
  return lines.join('\n');
}

// ────────────────────────────────────────────────── the panel's own vocabulary

/**
 * ⛔ ROB'S TOP PRIORITY, 2026-08-11, verbatim: "this is the right place for them
 * to see when there's something NEW from a client they need to respond to in the
 * next 24 hours. That's separate from overdue, which is important as well, but
 * MOST important is if there's something new that is within the 24-hour response
 * window."
 *
 * So there are two DIFFERENT signals and they are rendered differently:
 *
 *   reply_24h  the response window closes within 24h and it has NEVER been
 *              worked (logged_hours === 0). New, owed a reply, clock running.
 *   overdue    the date has already passed. Still important, still shown, but
 *              it is a different failure and must not be mixed in.
 *   open       everything else.
 *
 * ⛔ WHAT THIS IS DERIVED FROM, honestly. `/api/ext/next-task` carries no
 * "inbound client message" lane and no `created_at`, so "NEW" cannot mean
 * "arrived recently" without inventing data. It means what the feed can actually
 * prove: this person has never logged a minute against it. `due` is the
 * client-facing date (a block's scheduled_end, a phase's due_at, a job card's
 * delivery_date), so "due inside 24h and never touched" IS the 24-hour response
 * window in the only terms OW currently exposes. If OW ever adds an inbound-SLA
 * lane to the ranker, this function is the one place to change.
 */
export function classifyItem(item, now) {
  const due = item.due ? Date.parse(item.due) : NaN;
  if (Number.isFinite(due) && due < now) return 'overdue';
  if (item.rank_bucket === 0 && !Number.isFinite(due)) return 'overdue';
  if (Number.isFinite(due) && due - now <= REPLY_WINDOW_MS && !(item.logged_hours > 0)) {
    return 'reply_24h';
  }
  return 'open';
}

/** A card takes its most urgent item's state. reply_24h outranks overdue. */
export function classifyCard(card) {
  if (card.items.some((m) => m._state === 'reply_24h')) return 'reply_24h';
  if (card.items.some((m) => m._state === 'overdue')) return 'overdue';
  return 'open';
}

/**
 * ⛔ "ETA needed" (Rob explicitly asked for a "no ETA / ETA needed" flag).
 *
 * An item has an ETA when OW holds a committed date for it. It does NOT when
 * `due` is null — nothing has been promised to the client. The chip lifecycle's
 * richer ETA (dev_hours + delivery_date, written by /api/ext/eta-commit) is not
 * readable from any /api/ext GET, so the panel deliberately reports only what it
 * can see rather than guessing. That gap is a server-side follow-up.
 */
export function needsEta(item) {
  // ⛔ A TICKET PILE IS NOT AN ESTIMABLE UNIT. `ticket_queue` is one row standing
  // for N open tickets on a client, and `project_tickets` has no hours column at
  // all — so "ETA NEEDED" on it asks a person to date a pile, which is the
  // re-quoting churn Rob named on 2026-08-14 ("we don't need to be re-quoting
  // things before we get to actually doing that work"). The server excludes the
  // same lane from `needs_estimate`; if these two disagree the panel shows a tag
  // for an ask the server is not making.
  // `_type` on a grouped member, `type` on a raw ranked item — this is exported
  // and both shapes reach it.
  if (item && (item._type === 'ticket_queue' || item.type === 'ticket_queue')) return false;
  return !item.due;
}

// ────────────────────────────────────────────────────────────────────── search

/**
 * FIND A CLIENT WITHOUT STARTING ANYTHING.
 *
 * Asif, in the 2026-08-14 morning meeting: "I cannot find other clients… Gina is
 * not showing to me right now as I was going planning to work on her lots of
 * tickets, and Under It All I've been also working on but I had to put it in a
 * manual on a schedule task and stuff — so can you make a search option?" Rob:
 * "Yeah, a search option for the tickets. Of course. That is a big flaw" and,
 * later, "with a search bar at the top there, so you can find a client's ticket
 * without starting something new."
 *
 * ⛔ THIS FILTERS THE LIST. IT DOES NOT FETCH. The panel holds ONE cached GET of
 * /api/ext/next-task (TASK_FEED_TTL_MS) because OW's database has no load
 * headroom — a search box that queried per keystroke would be the polling this
 * whole module was written to avoid. So the searchable universe is exactly the
 * ranked feed, no more.
 *
 * ⛔ THAT UNIVERSE USED TO BE NARROWER THAN "YOUR CLIENTS", AND IT WAS A SERVER
 * BUG, NOT A SEARCH BUG — FIXED 2026-08-20, SERVER-SIDE. rankMemberFeed derived
 * `memberProjectIds` only from time_calendar_blocks and time_entries rows
 * carrying the member's email, so a client whose only link to you was an ASSIGNED
 * OPEN TICKET never entered the feed and could not be found here by any query.
 * Measured on prod 2026-08-14 for asif@: 92 open assigned tickets across 11
 * projects, 88 of them across 8 projects outside his feed scope. Measured again
 * 2026-08-20 for rob@: 218 across 31 projects, of which he reached 3 through
 * blocks — a 3-client panel over 32 clients of his own assigned work.
 *
 * `/api/ext/next-task` now opts into the ranker's assigned-ticket lane
 * (`includeAssignedTickets`) and sends one `ticket_queue` item per client whose
 * only link is a ticket. So this box now searches the member's REAL client
 * roster. What it still is NOT is "every client at the agency" — that list lives
 * in the New-task picker (`/api/ext/my-projects`), which is deliberately a
 * different question: "who could I work on" rather than "what is on me".
 *
 * ⛔ IT STILL FILTERS ONE CACHED PAYLOAD. Everything above is about what the
 * server puts IN that payload; none of it makes this box fetch.
 *
 * Matching: case-insensitive, whitespace-split, AND across tokens. Each token
 * may land anywhere in the card — the client label, the server packet's own
 * words, or any item's title/reason — because "under it" should find the client
 * and "shopify" should find the ticket, from the same box.
 */
export function cardHaystack(card) {
  if (!card) return '';
  const bits = [card.label, card.client];
  const v = card.view;
  if (v) bits.push(v.collapsed, v.expanded, v.chip, v.whats_new);
  for (const m of (card.items || [])) bits.push(m.title, m.rank_reason, m.urgency_phrase);
  return bits.filter(Boolean).join('\n').toLowerCase();
}

/** Split a raw query into the tokens every card must match. `''` → no tokens. */
export function searchTokens(query) {
  return String(query == null ? '' : query).toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Cards matching `query`, in their existing order. An empty/blank query returns
 * the SAME array reference — callers use that to tell "not filtering" from
 * "filtered to everything", and it keeps the common path allocation-free.
 */
export function filterCards(cards, query) {
  const list = Array.isArray(cards) ? cards : [];
  const tokens = searchTokens(query);
  if (!tokens.length) return list;
  return list.filter((c) => {
    const hay = cardHaystack(c);
    return tokens.every((t) => hay.includes(t));
  });
}

/**
 * The whole inventory, one card per client.
 *
 * Cards are ordered: reply-due-in-24h first (Rob's top priority), then overdue,
 * then everything else; within a band, real clients before the no-project
 * bucket, then by earliest due date (nulls last), then by the ranked order the
 * server already decided.
 *
 * ⛔ KNOWN GAP — CALENDAR APPOINTMENTS ARE IN THIS LIST, and cannot be removed
 * from the client side. `/api/ext/chip-feed` calls rankMemberFeed with
 * `excludeAppointmentBlocks: true`, which drops Google-Calendar-sourced rows
 * ("Home", "Morning Meeting", "Rob 1v1 with …") on the PROVENANCE rule Rob set
 * on 2026-07-30: gcal_event_id is set only by the two calendar-ingest paths, so
 * it is a fact rather than a guess. `/api/ext/next-task` does NOT pass that
 * option, and FeedItem carries no gcal_event_id — and `/api/ext/blocks` returns
 * only `self_created` / `approval_status`, both of which OW measured and
 * REJECTED as discriminators. So the extension has no honest signal here.
 *
 * The fix belongs server-side and is one line: have next-task expose the flag
 * (or accept the option) so this panel and the chip surface agree. Guessing from
 * titles is explicitly the thing OW refused to do, and this file will not do it
 * either. Until then, the no-project card sorts last within its band.
 */
export function buildCards(feedData, now = Date.now()) {
  const items = (feedData && Array.isArray(feedData.items) ? feedData.items : []);
  const rows = items.map((item) => ({
    client: item.project,
    rank_bucket: item.rank_bucket,
    // Mirrors the server's row shape — groupByClient reads it to PROVE the
    // group's project id (see the note there).
    project_id: item.project_id ?? null,
    member: { ...memberFromItem(item, now), _state: classifyItem(item, now) },
  }));
  const groups = groupByClient(rows);
  const views = indexClientViews(feedData);

  const cards = groups.map((g, order) => {
    const card = {
      key: g.fingerprint,
      fingerprint: g.fingerprint,
      client: g.client,
      // Display label only — see UNASSIGNED_DISPLAY.
      label: g.client === UNASSIGNED_LABEL ? UNASSIGNED_DISPLAY : g.client,
      isUnassigned: g.client === UNASSIGNED_LABEL,
      items: g.members,
      due: g.due,
      est_hours: g.est_hours,
      urgency: g.urgency,
      rank_bucket: g.rank_bucket,
      order,
      group: g,
    };
    card.state = classifyCard(card);
    card.etaNeeded = card.items.filter(needsEta).length;
    card.inProgress = card.items.filter((m) => m._logged_hours > 0).length;
    card.unclaimed = card.items.filter((m) => m._type === 'job_card').length;
    // ⛔ WHY THIS CLIENT IS ON YOUR LIST AT ALL. True when the member's ONLY link
    // to this client is `ticket_queue` — the lane /api/ext/next-task opted into on
    // 2026-08-20, which took rob@ from 3 client cards to 32. Without a visible
    // reason, 29 unfamiliar clients appear overnight and the honest reaction is
    // "the tracker is broken", not "that is my ticket backlog". Card-level, not
    // item-level, because the item tags live inside the hover detail and this has
    // to be legible while scanning the collapsed list.
    card.ticketOnly = card.items.length > 0 && card.items.every((m) => m._type === 'ticket_queue');
    card.reply24Count = card.items.filter((m) => m._state === 'reply_24h').length;
    card.overdueCount = card.items.filter((m) => m._state === 'overdue').length;
    // The date that actually put this card in the 24-hour band. `card.due` is the
    // earliest date across ALL items, which on a mixed card is an overdue one —
    // showing that as the headline of a 24-hour card reads as a contradiction.
    card.replyDue = card.items
      .filter((m) => m._state === 'reply_24h' && m.due)
      .map((m) => m.due)
      .sort()[0] || null;
    // The first ranked item that is an actual calendar block — the only kind of
    // item this extension can put a clock on BY ITSELF. Kept because it is the
    // fallback target when the server sends no `clients` (see resolveStartable).
    card.startableBlock = card.items.find((m) => m._type === 'block') || null;
    // ── the SERVER's packet for this client, if this build's server sends one ──
    card.view = views.lookup(card) || null;
    card.startable = resolveStartable(card);
    // ⛔ ONE NUMBER PER CARD. The packet RECONCILES the client's open tickets into
    // the same unit as its ranked work (`reconcileOpenWork`), so `open_count` is
    // routinely larger than `items.length` — Crucial Hire is 1 ranked phase and 34
    // open items. Showing the ranked count next to a body that enumerates 34 is the
    // "a card says '1 open item' over a 47-item list" defect, on the client side
    // this time. When there is a packet, its count is the count.
    card.openCount = (card.view && Number.isFinite(card.view.open_count))
      ? card.view.open_count
      : card.items.length;
    return card;
  });

  const bandOf = (c) => (c.state === 'reply_24h' ? 0 : c.state === 'overdue' ? 1 : 2);
  cards.sort((a, b) => {
    if (bandOf(a) !== bandOf(b)) return bandOf(a) - bandOf(b);
    // A real client outranks the no-project bucket inside a band. Work with no
    // client link is, by definition, not the client relationship this panel
    // exists to protect — and on a calendar-synced roster that bucket is where
    // meetings and personal markers land (see the appointment note below).
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    const da = a.due ? Date.parse(a.due) : NaN;
    const db = b.due ? Date.parse(b.due) : NaN;
    const va = Number.isFinite(da);
    const vb = Number.isFinite(db);
    if (va !== vb) return va ? -1 : 1;
    if (va && vb && da !== db) return da - db;
    return a.order - b.order;
  });
  return cards;
}

// ──────────────────────────────────────────── the server's packet (`data.clients`)

/**
 * ⛔ EDIT 1 of the four named in /api/ext/next-task's own route header: key
 * `data.clients` by fingerprint and hang it on the card, instead of re-deriving.
 *
 * `clients[]` was added to /api/ext/next-task on 2026-08-12 and is ADDITIVE:
 * `items` is byte-for-byte what it was. Each entry carries
 *
 *   collapsed / expanded / chip   three projections of ONE packet
 *   whats_new + basis + new_count from the per-(person, client) seen watermark
 *   startable                     {kind:'block'|'project', block_id, project_id, label}
 *
 * ⛔ MATCHING IS THREE-KEYED, AND A BARE FINGERPRINT MATCH IS NOT ENOUGH.
 * `ClientView.fingerprint` is `packetFingerprints().fingerprint`, which is
 * `client:<projects.id>` WHENEVER the project is proven and only falls back to
 * `client:<label-slug>`. This panel's `card.fingerprint` is always the label slug
 * (`clientGroupFingerprint`), because that is the key the chip-event ledger is
 * still written under (`CLIENT_GROUP_LEDGER_KEY = "label_slug"`). So on every
 * client that HAS a project id — i.e. every real client — the two strings differ
 * and a fingerprint-only join silently matches nothing, leaving every card on the
 * legacy path while the server dutifully sends the packet. That failure is
 * invisible: no error, no empty state, just the old rendering forever.
 *
 * The label is the reliable join because BOTH sides group the same way:
 * `buildFeedClientViews` builds its rows with `client: item.project` and calls the
 * same `groupByClient`, from the same `feed.items` this function is reading. One
 * group per distinct label string on both sides. So we index by the canonical
 * fingerprint, the label-slug fingerprint AND the raw label, and try them in that
 * order.
 *
 * ⛔ NO POSITIONAL FALLBACK. Index-matching `clients[i]` to `groups[i]` would look
 * like it worked right up until the server filters a group (the noise gate already
 * returns null for an empty packet), and then it would attach one client's packet
 * to another client's card — the worst possible failure on a surface whose whole
 * job is client separation.
 */
export function indexClientViews(feedData) {
  const list = (feedData && Array.isArray(feedData.clients)) ? feedData.clients : [];
  const byFingerprint = new Map();
  const byLabel = new Map();
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    if (v.fingerprint) byFingerprint.set(String(v.fingerprint), v);
    const label = String(v.client || '').trim();
    if (label) {
      byLabel.set(label, v);
      const slugFp = clientGroupFingerprint(label);
      if (!byFingerprint.has(slugFp)) byFingerprint.set(slugFp, v);
    }
  }
  return {
    size: list.length,
    lookup(card) {
      if (!card) return null;
      return (
        byFingerprint.get(String(card.fingerprint)) ||
        byLabel.get(String(card.client || '').trim()) ||
        null
      );
    },
  };
}

/**
 * ⛔ EDIT 4a — what this card can put a clock on. `{kind, block_id, project_id, label}`,
 * or null for "genuinely nothing to clock".
 *
 * THE SERVER'S ANSWER WINS when it sent one, because it is strictly better
 * informed: `resolveStartable` in chip-feed-views.ts can fall back to
 * `kind:'project'` using a project id this feed's `items` do not expose to the
 * panel, and it only does so when `groupByClient` PROVED a single project id
 * across every member. That is the whole reason Crucial Hire — 46 open tickets,
 * one phase, one dead 15-minute calendar appointment, and 0 time entries ever —
 * could never be started from here.
 *
 * ⛔ AND THE OLD PATH IS PRESERVED, NOT REPLACED. When the server sends no
 * `clients` (every deployment before 2026-08-12, which includes production as of
 * this build), this returns exactly the block the panel has always picked:
 * `card.items.find(m => m._type === 'block')`. Same block, same timer, same
 * behaviour. Deleting the local derivation — which the route header suggests —
 * would have made this build show an empty panel against today's production.
 *
 * ⛔ AND `null` IS A REAL ANSWER, NOT A DEGRADED ONE. A client whose members
 * disagree about their project id yields no proven identity, so the server refuses
 * to guess and returns null. Clocking work onto a guessed client is worse than not
 * clocking it, so this must NOT fall back to the block scan in that case — a
 * server that answered "nothing" is not a server that failed to answer.
 */
export function resolveStartable(card) {
  const view = card && card.view;
  if (view && Object.prototype.hasOwnProperty.call(view, 'startable')) {
    const s = view.startable;
    if (!s || !s.kind) return null;                      // a real "no", honoured
    if (s.kind === 'block' && !s.block_id) return null;   // malformed — do not guess
    if (s.kind === 'project' && !s.project_id) return null;
    return {
      kind: s.kind,
      block_id: s.block_id || null,
      project_id: s.project_id || null,
      label: s.label || (card.startableBlock && card.startableBlock.title) || '',
      // The block path keeps its schedule: `armSchedEnd` gates the "scheduled time
      // is up" alarm on it, and a project timer has no schedule to gate on.
      due: s.kind === 'block' && card.startableBlock ? card.startableBlock.due || null : null,
      timed: s.kind === 'block' ? blockWasTimed(card, s.block_id) : false,
      source: 'server',
    };
  }
  const b = card && card.startableBlock;
  if (!b) return null;
  return {
    kind: 'block',
    block_id: String(b._id),
    project_id: null,
    label: b.title || '',
    due: b.due || null,
    timed: Number(b._logged_hours) > 0,
    source: 'legacy',
  };
}

/**
 * ⛔ Has any time been recorded against THIS block? (2026-09-14, lane L4b.)
 *
 * `logged_hours` on a feed block item is the server's sum over the time entries
 * whose calendar_block_id is that block (next-task-ranker.ts, loggedHours over
 * entriesByBlock). It gates the card's close-out: that press writes a no-QA note
 * and closes the block for good, and the route's own backstop against closing work
 * nobody did — "zero tracked time → unsanctioned, the PM is told" — treats a failed
 * read of that time as NOT a disqualifier (block-complete-note/route.ts
 * sumTrackedMinutes returns null). So an untimed block closed during a bad read
 * passes silently. The extension does not offer the press on a block with no
 * recorded time at all. A block without a matching item is `false`: no evidence is
 * not permission.
 */
export function blockWasTimed(card, blockId) {
  if (!card || !Array.isArray(card.items) || !blockId) return false;
  const item = card.items.find((m) => m && m._type === 'block' && String(m._id) === String(blockId));
  return !!item && Number(item._logged_hours) > 0;
}

/**
 * ⛔ EDIT 2 — the complete chip text for a card. What Start puts on the clipboard.
 *
 * The SERVER's `view.chip` when there is one. It is the same composer this file
 * ports (`buildClientGroupBrief`, reached through `packetToGroup`), but it
 * additionally carries the LEDGER fingerprint — the key the claim curl must write
 * under — and each item's real resolved `source_link`. Both were unreachable from
 * the extension before, so the claim in a locally-built chip could be written
 * against a key the server never minted.
 *
 * The local build stays as the fallback for a server that sends no packet.
 * `verify/chip-text-parity.mjs` asserts the two are byte-identical for the shape
 * they both cover; keeping it is what keeps that test meaningful.
 */
export function chipTextFor(card, { memberEmail, apiBase }) {
  if (card && card.view && typeof card.view.chip === 'string' && card.view.chip.trim()) {
    return card.view.chip;
  }
  return buildClientGroupBrief({ group: card.group, memberEmail, apiBase });
}

/**
 * The fingerprint of the feed's #1 ranked item, or null.
 *
 * ⛔ The ONE place "which item is next" is decided, for every surface. The popup
 * used to answer this question itself, in its own words, next to a panel that
 * answered a DIFFERENT question (which band is it in) about the very same row —
 * so the two surfaces contradicted each other over one cached payload. The item
 * is picked exactly as the server offers it (`data.next`, falling back to
 * `items[0]`, which is what the server sets `next` from); the surfaces render it
 * through renderTasks(..., { nextFingerprint }) and nothing re-ranks locally.
 */
export function nextFingerprintOf(feedData) {
  const d = feedData || null;
  const item = (d && (d.next || (Array.isArray(d.items) ? d.items[0] : null))) || null;
  return item ? fingerprintFor(item) : null;
}
