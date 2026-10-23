# Changelog — Massmarket Time Tracker

Newest first. Versions match `manifest.json`; the published build is whatever
`tools/publish.mjs` last uploaded, which is not necessarily the top entry here.

Entries before 0.11.0 are reconstructed from the git history rather than written
at the time, so they are summaries of what a release did, not the release notes it
shipped with.

## 0.11.5

- The tracker updates itself. When a newer version is put in the folder Chrome loads it from, it switches to it within 5 minutes, with no reload button to press. What it has recorded is sent first (or kept and sent after, if you are offline), and you stay signed in.
- The Massmarket Claude Code plugin (mm-hooks) puts each new release in that folder when a Claude Code session starts, so after this version nobody has to download a zip.
- Keep Developer mode on in chrome://extensions. Chrome turns an unpacked extension off when it reloads while Developer mode is off.
- "Add time you did not clock" now refuses only times that cross time you already have on the same client. Time on another client in the same stretch is parallel work and is accepted, as the server now does. Time with no client counts as its own group: it crosses other time with no client, never a client's.
- Release zips list `manifest.json` last, so a folder extracted by hand only shows the new version once every other file is in place (`tools/publish.mjs`).

## 0.11.4

- Claude Code sessions are now always visible, up to six at once. Each shows the thread's name, its client and task, and the folder it is working in.
- The folders being recorded are listed under the sessions.
- A running timer keeps its name after you close and reopen the popup. Before, a client timer with no calendar block turned into "Client work".
- "Needs a reply — next 24 hours" is now "Due in the next 24 hours". It always held anything due within a day with no time logged, meetings included.

## 0.11.3 — which client and task each Claude Code session is on, Claude Code setup one step at a time, a hook line that reads rows, and the massmarket.ai look

Needs OW `feat/hook-choose-folder-and-guide` on production BEFORE it is published:
the card's message sends Claude Code to `/api/ext/hook-install?guide=1`, the
installer commands carry `--choose-folder` / `-ChooseFolder`, step 2 reads
`hook.installer_checked_in_at`, and the hook line names `hook_verdict.recent_roots`.
Against an older server the card stays on step 1 and the line leaves the folders
out; it never guesses. It also needs OW #349 (task announcing, server side) for the
session lines: an older server sends no `claude_sessions`, and the lines are not
drawn. What is recorded changed in one way: each Claude Code session's activity now
carries the client and task it declared, or the one the member picked with Change.
There are no new permissions.

### Added
- **Which client and task each Claude Code session is on** (`sessions.js`, `panelui.js`):
  the Claude Code line lists up to 2 sessions from `health.claude_sessions` as
  "Claude Code: <client> — <task>" ("client not declared yet" / "no task declared
  yet" until the session says). **Change** opens a picker: this session's
  candidates from `/api/ext/task-candidates`, an "Or type it" field and Save, which
  posts `/api/ext/task-override` and then re-reads health. Nothing is drawn when the
  server sends no sessions.
- A session that has noted a task but no client shows "Claude Code: client not declared yet — <task>", so the task and a saved Change are visible (Opus, 2026-09-30).
- **A one-step Claude Code setup card** (`consentcard.js`, `panelui.js`), in place of
  0.11.2's work-folder card, which showed a folder textarea, an allow command and a
  remove command all at once. It appears only when `hook_verdict` needs the member
  to act (duplicate, stale, dark, or unknown + `never_authenticated`) and shows one
  step:
  - Step 1: copy one message into Claude Code. Claude Code follows the OW guide and
    runs the installer, which opens a Choose Folder window.
  - The "Fix Claude Code tracking" card now asks Claude Code to repair the hook, not just set it up.
  - Step 2 (restart Claude Code) replaces step 1 once `hook.installer_checked_in_at`
    is within 15 minutes (`HOOK_STEP2_WINDOW_MS`). The card leaves by itself when the
    verdict turns `ok`.
  - "Prefer the Terminal? Show the command" reveals the two installer commands, each
    with its own Copy button. On Windows it adds "On Windows, run these in
    PowerShell."
  - The message and command boxes are `<pre>`, not a textarea. The textarea that
    took focus when the card opened is what kept 0.11.2's card from folding.
- **"← Back" at the top of My hours** (accessible name "Back to the tracker").
- **The massmarket.ai brand layer** (`brand.css`) on the popup, side panel, pop-out
  and Options: paper/ink palette, square corners, and bundled Inter, Space Grotesk
  and JetBrains Mono (`fonts/*.woff2`, SIL OFL in `fonts/OFL.txt`). Nothing is
  fetched remotely. The homepage's headline faces, Array and Clash Display, are
  Indian Type Foundry fonts under Fontshare terms and are not bundled; the display
  stack falls back to Space Grotesk, as the homepage's own stack does. Badge colors
  are unchanged.
- **The brand mark as the extension icon**: a white brain on a black tile at 16, 32,
  48 and 128 px, hand-tuned at 16 and 32 (`gen_icons.py`). The manifest now lists
  the 32 px size.

### Changed
- **The Claude Code line reads the rows the hook wrote, not its check-ins.** It is
  derived from `hook_verdict` instead of `hook.state` (`hook_last_seen_at`, stamped
  on the auth path, which stayed green for installs that wrote nothing):
  - ok → green "Recording — last entry …", plus " From: <folders>." when the server
    names them
  - duplicate / stale / dark → amber, with the card
  - unknown + `never_authenticated` → amber "Not set up yet. Set it up below.", with
    the card
  - unknown + `no_hook_rows` → grey "No entries in the last day.", no card
  - anything unreadable, or a server that sends no verdict → grey "Can't check right
    now.", no card
- The popup's status strip opens itself when a reading changes, not on every
  30-second re-read.

## 0.11.2 — one install for every fix from the 2026-09-11 meeting

The publish procedure, the floor decision and the install instruction for this
release are in `rollout/RELEASE-PLAN-0.11.2.md`. It carries every member-facing fix
from the 2026-09-11 morning meeting in ONE download and ONE Reload.

- I1: each install sends a random install ID (X-MM-Install-Id) and the browser name (X-MM-Browser) with every OW API call, so the server can count a member's installs per browser profile. No new permissions; nothing about pages or activity is added.
- **F6: input inside embedded frames counts.** Content scripts run in every frame (`all_frames: true`, `match_origin_as_fallback: true`); a sub-frame never records its own URL or title, it only forwards its click, key, scroll and paste counts and its last-input time to the tab's top-frame minute through the background worker. HighLevel's workflow builder is a cross-origin iframe, and 87.6% of its captured minutes carried zero input before this. In a sub-frame only, an event a script dispatched (`isTrusted` false) counts for nothing, and a scroll counts only within 3 s of a real wheel, touch, pointerdown or scrolling key in that frame, so a widget that scrolls itself cannot keep a tab active.
- **F7: quiet minutes are kept and flagged, not deleted.** A minute where the tab had focus but no input past the 5-minute idle threshold is now sent with `idle: true` instead of being dropped, so calls, videos and reading leave a record; the server never counts an idle minute as active work. Idle rows stop after 60 idle minutes in a row and resume on the next input. `idle: true` goes on those rows only: a minute with any input or any credited focus, including the minute the idle cutoff falls in and the minute input resumes, is sent `idle: false` with its credited focus, because the server (OW #330) leaves every `idle: true` row that carries a `row_key` (every 0.11.2 row) out of tracked time.
- **F8: every activity row carries a `row_key`** minted once when it is queued, so a resend after a lost response can no longer insert a duplicate (the server ignores a repeated key).
- **F9: an embedded frame can only send its input counts.** The worker drops every other message from a content script in a sub-frame (`sender.tab` set, `frameId !== 0`, not one of this extension's own pages): no handler, no reply, no storage write; only `mm_subframe_input` is relayed. Measured before this: a cross-origin iframe could read the capture state, get a forged activity row posted for any URL, and pause capture for the whole profile. The Document Picture-in-Picture pop-out reports as a sub-frame, so the extension's own pages are exempt.
- **F10: no activity row is lost when several tabs report at once.** Every read-modify-write of the activity queue and the timer-event queue runs through one lock, and after a POST the worker removes exactly the rows it sent (by `row_key`) instead of slicing by count. Before this, rows arriving together overwrote each other: 8 at once left 1, and live, with every tab focused, 76 of 96 per-minute rows were lost (0.11.1 had the same bug). A failed write rejects only its own caller; the lock carries on.
- **F11: the offscreen document answers only this extension's own pages** (checked by `sender.url`). Before this, any content script in any frame could make it run a canvas job or download a QA .zip with a file name the message chose.
- The allFrames backfill was verified live for a fresh install, a Reload, and an in-place update from the published 0.11.1: it injects the top frame of every open tab and every scriptable sub-frame; frames no extension can script (Chrome's PDF viewer, error pages) never block the rest.

### The release itself (lane R1)
- **Version 0.11.2**, cut on top of the published 0.11.1 build rather than on
  `main` — `main` read 0.11.0 until 2026-09-12, which is the published floor, so
  a build cut from it would have shipped AT the floor and below every install in
  the fleet.
- **`verify/manifest-identity.test.mjs`** — the manifest `key` is frozen against
  the sha256 of the key inside the PUBLISHED v0.11.1 zip, the decoded DER is
  pinned at 294 bytes and must round-trip, and the derived extension ID is pinned
  to `lcnfnlckdnnmgijlfmedfikafaogenga`. That ID has been the same since v0.4.4
  and is the only reason unzip-over-the-folder preserves a member's token, their
  capture acknowledgement and a running timer. Without this test, dropping or
  reformatting the key would install cleanly, read as a successful update, and
  sign the entire team out with capture off until each of them pressed the notice
  button again.
- **`verify/release-copy-gate.mjs`** — no unwritten member-facing string reaches
  a member. It scans exactly the file set `tools/publish.mjs` zips and fails
  while a placeholder remains. `OPUS_TO_REVIEW` is reported, not blocked: that
  marker is on copy that already shipped.
- No change to `min_supported_version`. Raising the floor is a separate,
  deliberate database write and `tools/publish.mjs` hard-refuses to do it — see
  the release plan.

### Fixed — the Options page told you it was connected when it wasn't (lane M1)
- The Options page now shows what the server says about your sign-in, not what this browser last remembered, so a token the server turned down no longer reads as connected.
- **`authstatus.js` (new) is the banner's only source.** `authStatusView({ cfg,
  capture, nowMs })` is a pure predicate (no `chrome.*`) over a closed set,
  `first_run | confirmed | rejected | unknown`: green only on `signedIn === true`
  with a `validatedAt` inside `AUTH_CONFIRM_MAX_AGE_MS` (two
  `CAPTURE.VALIDATE_HOURS` windows), red only on `signedOutReason === '401'`,
  neutral for everything else (never validated, worker unreachable, stale, clock
  moved backwards), `first_run` with no token. Before this, `options.js load()`
  painted "Connected as …" from `config.name` / `config.email`, written on a
  successful Connect and cleared by nothing.
- **Opening Settings makes no authenticated call.** `options.js` reads the
  worker's own record with `{type:'captureState'}` (a storage read) instead of
  hitting `/api/ext/auth`, which would stamp `X-Ext-Version` /
  `X-Ext-Capture-State` onto `team_auth_tokens` and mark the machine alive at the
  moment its owner suspects it is not. Asserted against the source in
  `verify/auth-status.test.mjs` (13 at landing; 15 after lane F4's
  `authConfirmed` message, above).
- Landed in `bda059e` (EXT #9, absorbed into this branch through EXT #11).

### Fixed — Start said nothing on two of the three ways you start work (lane M2)
- Start now tells you what happened every time, whether you press it on a card or in the picker, and every card has a Copy chip button that copies the chip without starting a timer.
- **Both silent Starts now toast.** The sticky picker's Start (`popup.js onStart`)
  and "Start in parallel" (`onNextUpGo`) changed the view and said nothing; both
  now report every outcome (started, already on the clock, four-block cap, failed)
  through the EXISTING `.mm-toast` (`panelui.js showToast`), not a second
  component. Lane W2a (D4) later removed "Start in parallel" (every Start is now
  parallel); the picker's toasts remain.
- **The chip got its own control rather than riding on Start.** The picker Start
  deliberately does not copy: matching a picker block back to a feed card by
  `block_id` would copy for 17 of 24 client groups and not the other 7. Instead
  `cardstart.js copyCardChip()` sits behind a copy button on every card and a copy
  control on every running card, resolved through `card.startable` so project-kind
  clients work too. Lane W2a (D3) moved the running-card copy into the More menu.
- **`.mm-card-actions` gains `flex-wrap`** (`panel.css`). The buttons had been laid
  out past the card's right edge and clipped, so `verify/popup-width.mjs` passed
  throughout; it now measures each control against the box that clips it (wrap
  reverted: 12 controls outside their card).
- Landed in `e0588dc` (EXT #10, absorbed through EXT #11). Probe:
  `verify/start-feedback-and-closeout.mjs` (base `f60e07b` 12 red → PASS).

### Fixed — the work-folder card you could never put away (lane M4)
- The work-folder card now folds down to one line once your hook is working, and opens itself again only when the hook needs attention.
- **The card became a `<details class="mm-consent-fold">`** in
  `consentcard.js renderConsentCard()`, whose `<summary>` is the card's existing
  h2 node moved, not a new string. Toggling sets one boolean and never re-renders
  the children, so a half-typed folder list survives it. The open/closed decision
  is `consent.js consentFoldView()`'s and fails closed: anything but a positive
  hook reading forces the card open, so against a server that sends no verdict the
  behaviour is v0.10.1's. There is still no dismiss control. Measured in a real
  popup at landing: 845px → 60px.
- **First cut (`bda059e`, EXT #9) was popup-only, remembered per profile
  (`hookConsentFolded`) and read `health.data.hook.state`.** All three were
  replaced on this branch: lane F4 (`c8d7b7e`) moved the signal to `hook_verdict`
  via `hookVerdictFold()` and seeded the fold from cache so it paints once; lane
  L4b (`659575e`) refuses an envelope carrying `error`; lane W2a (`8e80d24`)
  dropped the remembered fold and mounts it on every surface.
- Coverage: `verify/consent-allowlist.mjs` fold parts, `verify/shoot-consent-fold.mjs`,
  and later `verify/consent-fold-paint.mjs`.

### Fixed — an unfinished QA prompt hid your whole task list (lane M5)
- An unfinished QA or finish-early prompt now sits above your tasks and names the block and the day it is waiting on, instead of replacing your whole task list.
- **The QA prompt no longer replaces the popup.** `popup.js init()` rendered the
  prompt and RETURNED whenever `pendingQaFinalize` held an entry, so one local key
  hid the running list, the task list and the picker. Now `mountQaOwed()` →
  `panelui.js renderQaOwedCard()` pins a card in `#qa-owed-card` above the list,
  naming every owed block and the day it was stopped (`fmtStoppedOn`), with no
  dismiss control; its button opens the same `renderQa` / `renderEndingEarly`
  views. `drainNextQa()` repaints it after each QA.
- **The gate itself is untouched.** The per-block set, and its only removal path
  (that block's own QA), are unchanged; `clearQa()` is not called (it wipes the
  resume-append bundle and a live upload token) and there is no server reconcile
  (`/api/ext/blocks` carries no `qa_posted_at`). Both bans are asserted by the probe.
- **`common.js PENDING_MAX_AGE_MS` (14 days) + `pendingQaExpired()`.** Nothing
  server-side can clear the key, so an entry older than that is dropped under the
  existing gate lock and the drop is PERSISTED.
- Landed in `e0588dc` (EXT #10). Probe: `verify/qa-pin-and-nextup.mjs` (base
  `f60e07b` 21 red, `view=view-qa`, 0 cards → PASS).

### Added — closing out a task for a client who has gone (lane M6)
- A block for a client who is no longer with us can now be closed out from its card with a short note, instead of being served to you forever.
- **`cardclose.js closeOutBlock()` (new), shared by the popup (`popup.js`) and the
  side panel / pop-out (`panelapp.js`).** It posts one block and one note to the
  EXISTING `POST /api/ext/block-complete-note` (live since 2026-08-06, already used
  by the stop flow's "No QA required"), which marks the block `completed`, stamps
  `qa_posted_at` (COALESCE, first close wins) and writes a `time_worklogs` row with
  `source='no_qa_note'`. No new endpoint, no migration.
- **The form is `panelui.js openCloseOutForm()`**, rendered only on block-kind
  cards (the route needs a `block_id`); the note is required client-side at
  `MIN_CLOSEOUT_NOTE = 4`, mirroring the route's `MIN_NOTE_LEN`. Still no Claim
  button (`cardstart.js`): a claim would acknowledge up to 40 ack-ladder rows.
- **Guards added later on this branch:** lane F4 (`262e6f9`) refuses a block that is
  on the clock at the press, fails closed on an unreadable timer list and forces
  the feed re-read (`verify/closeout-safety.test.mjs`); lane L4b (`659575e`) offers
  it only where `taskfeed.js blockWasTimed()` finds recorded time.
- Landed in `e0588dc` (EXT #10). Probe: `verify/start-feedback-and-closeout.mjs`.

### Added — what you should pick up next, always on screen (lane M7)
- The popup, the side panel and the pop-out now show the next client and how urgent it is without you opening anything, and the Chips light no longer sits on amber forever.
- **One renderer, three surfaces.** `panelui.js renderNextUpLine()` is mounted by
  the popup (`#nextup-pinned`) and by `panelapp.js` (side panel and pop-out) over
  the cached `taskfeed.js fetchTaskFeed()` read of `/api/ext/next-task`, picking
  `data.next` (else the first item), the same item `nextFingerprintOf()` tags.
  An empty feed and a failed fetch each render their own state, so the line never
  disappears. No count on the toolbar badge.
- **`panelui.js chipsIndicator()` stopped asserting a frozen census.** Its comment
  and member-facing sentence said `delivered_chip` had fired once ever (last
  2026-07-30); measured on prod 2026-09-12 it was 4 (rob@ 07-30, asif@ 09-04,
  09-08, 09-10). The level now reads an optional per-member
  `data.delivered_chip_at` and goes green on it. Absent (every server build so
  far), the lane landed as amber; lane W2a (D3) made that ordinary
  served-but-unconfirmed state grey, not a warning, so it no longer sits on amber.
- Landed in `e0588dc` (EXT #10). Probe: `verify/qa-pin-and-nextup.mjs`.

### Fixed — the release blockers found when 0.11.2 was assembled (lane F4)
- The work-folder card now folds only when your hook is really set up on this machine, not just because the server has heard from it; a new token takes effect as soon as you press Connect instead of still showing red; and a block you are timing cannot be closed out while its timer runs.
- **The fold read a false green.** The consent card's fold was wired to
  `health.data.hook.state` — liveness, derived from `hook_last_seen_at`, which is
  stamped on the AUTH path. Measured 2026-09-12: all seven members read `ok`,
  including the two whose installs predate the folder allowlist and have never
  written a hook row carrying `hook_root`. It now reads `hook_verdict`
  (`/api/ext/health`, OW PR #255), which is derived from the rows the hook wrote.
  `stale`/`duplicate`/`dark` force the card open; `unknown`, `degraded`, or the
  key absent entirely — which is every server build shipped so far — behaves
  exactly as v0.10.1 did. An older server can never cause a fold.
- **The card painted twice.** It mounted forced-open (~845px) and collapsed to
  ~60px when health landed, moving Start ~785px mid-reach. The fold is now seeded
  from the reading already in storage (age-bounded, no network) through the same
  mapping, so it paints once.
- **A fresh token after a 401 still read as refused.** `options.js connect()` wrote
  the config and nothing else, and the only thing that ever woke the worker about
  auth was the 401 watcher. A successful Connect now sends one message
  (`authConfirmed`) and the worker folds it in through the same transition its
  4-hourly check uses — no second round trip.
- **Close-out got two guards.** It posts to a route that stamps `qa_posted_at`
  with a COALESCE, so the first close wins and nothing here undoes it. A block
  that is on the clock is now refused at the press (not hidden at the render — a
  timer can start on another surface), an unreadable timer list fails closed, and
  a successful close FORCES the feed re-read instead of repainting the card it
  just closed from cache.
- **`verify/release-copy-gate.mjs` could never pass, and nothing called it.** It
  counted the four marker lines in the file that EXPORTS the placeholder helper,
  giving it a permanent floor. It now locates that file by its export, skips only
  the definition and comment lines, asserts the export exists and is singular, and
  is run by `tools/publish.mjs` before the zip is built — so a real publish stops
  on it, with no flag to skip.
- **`INSTALL.md` §1b step 7.** Confirm the version on `chrome://extensions` after
  Reload; if it still reads the old one, download again — do NOT press Remove.
  Without that step the natural response to "the update did nothing" is the one
  action that destroys the token and the acknowledgement.
- New suites: `verify/closeout-safety.test.mjs` (8),
  `verify/release-copy-gate.test.mjs` (6). `verify/consent-allowlist.mjs`
  49 → 54 assertions; `verify/auth-status.test.mjs` 13 → 15.

### One release branch, the hours panel on every surface, and the add form shows the day (lane L4b, 2026-09-14)
- **EXT #11 and EXT #12 on one branch** (`release/0.11.2-L4b-2026-09-14`), so 0.11.2
  is ONE install carrying the release blockers and the hours panel together.
- **The hours view is `panelui.js mountHoursPanel()`**, mounted by the toolbar
  popup (`popup.js`) and by `panelapp.js`, which is what the side panel and the
  pop-out mount. EXT #12 built it popup-only as static `popup.html` markup. Styles
  moved to `panel.css` (`mm-hours-*`); `projectLabel`/`filterProjects` moved to
  `panelui.js` so both client pickers share one search.
- **R4.2 — the add form shows what is already recorded for the chosen day before
  submit.** `GET /api/ext/my-hours/window` (lane L4a) is read as soon as a day is
  chosen, one day either side for the timezone seam, filtered to the member's own
  day. Timer, auto-attributed and hand entries are listed; an entry the typed times
  would cross is flagged inline and submit refuses it before any request, using
  guard 4b's own rule (no status filter, so an entry that does not count still
  blocks). A same-client entry that day is a note, not a refusal. Both 409s stay
  answerable through `apiRequest`.
- ⛔ **The add-hours form is new in 0.11.2, first introduced by EXT #12.** No
  earlier build (0.11.0 on main, 0.11.1, the release base, EXT #11) calls
  `/api/ext/worklog-time`, so there is no older form to fall back to. Lane L4a's
  window route is therefore a hard precondition: RELEASE-PLAN-0.11.2.md §2 gate 4
  (`verify/window-route-gate.mjs`) requires it merged and deployed to OW
  production before this merges or publishes.
- ⛔ **The form fails closed when the day's record cannot be read.** A 404, any
  other 4xx, a 5xx, a network error, an 8-second timeout or an unknown shape all
  show a "could not be checked" warning in the form with a way to
  check again, and submit sends nothing until the member confirms "add it anyway"
  for that day (`hours.js uncheckedNeedsConfirm`). A confirm for one day covers no
  other day; a read still pending for the day is finished before submit decides.
- **Every `hours.js` COPY string was re-authored.** EXT #12's sentences were
  executor-written; Opus rewrote the whole object for EXT #13 and it was placed on
  2026-09-22, taking the copy gate from 160 on this branch to 0.
- **The consent fold reads only a fresh verdict.** `hookVerdictFold()` returns no
  answer for an envelope carrying `error` — `fetchHealth()`'s cache fallback, which
  has no age bound — so an offline or refused member's card resets open.
  **Member-visible, and intended:** a member whose server is unreachable now sees
  the consent card open at full height (measured 151px → 902px) on every open
  until the server answers again. Someone who is often offline will read this as
  a regression; it is the fold refusing to trust a cached verdict.
- **Close-out is offered only on a block with recorded time** (`taskfeed.js
  blockWasTimed`, from the server's `logged_hours` on that block). The route's own
  zero-tracked-time backstop treats a failed read as not a disqualifier.
- **`chip-text-parity.mjs` is regenerated, not baselined red**: `build-server-ref.mjs`
  against OW `origin/main` 8f866409, 4 groups byte-identical.
- Suites: `verify/hours-window.test.mjs` (9, new), `verify/window-route-gate.mjs` (new, gate 4), `hours-panel.test.mjs` 21 → 23,
  `closeout-safety.test.mjs` 8 → 11, `consent-allowlist.mjs` 54 → 55. Probes:
  `verify/hours-window-live.mjs` (new), `verify/consent-fold-paint.mjs` (new).

### The hours panel (lane F5, EXT #12)

⛔ **The finding: two routes shipped server-side and this extension called
NEITHER.** Measured on the 0.11.1 tree — zero references to `/api/ext/my-hours`
and zero to `/api/ext/worklog-time`, anywhere in the source.

What that cost is measurable. `worklog-time` has **7 rows in its entire life**,
all written by one person on one day. Somebody who knew they had under-clocked
had no button anywhere in the product, so the only repair path was an operator
typing rows in with the service-role key — which is how production ended up with
28 rows and 70.57 h of provenance-ambiguous time, and three different meanings
for the word "manual". The discrepancy travelled through a morning meeting
instead of through the tool.

**New: a Hours view in the popup**, reachable from the header on every screen —
because the moment somebody notices a number is wrong is not a moment they are
standing in the idle picker.

- what the tracker recorded, with **every provenance bucket including the
  zeros**, in the server's own words. Quoting one bucket alone is the 2026-09-09
  post that told Shezan he had logged nothing when he had 55.2 hours.
- which hours a timer measured and which were typed in
- ⛔ **the days another feed recorded work on and no timer ran** — the reason to
  be on this screen. Six of seven members have at least one in the last 14 days.
- a form to add hours that were worked and not clocked

⛔ **Both refusals are answerable.** The server returns two 409s that no member
had ever seen, because nothing called the route. An overlap now says which fix
applies — change the times, or stop the timer that is still running. A possible
duplicate shows the server's own sentences about what looks the same, plus the
confirm button that sends the token back. A refusal a member cannot answer is
indistinguishable from "it didn't save", and both are now scrolled into view
rather than left above the fold of a 320px popup.

⛔ **No number is pre-filled.** The untracked-day prompt carries a DATE into the
form and nothing else. The browser-capture bucket rolls on every URL change and
overstates real time by 1.83x–2.76x — a factor that is different for every
member — so there is no divisor, and the panel states minutes, never hours.

⛔ **Every string is in one frozen `COPY` object in `hours.js`**, and the
per-entry provenance labels come from the server, which owns that vocabulary in
exactly one place. Nothing on this surface prints a column name, a column value
or a row id.

`common.js` gains `apiRequest`, which returns the status and the parsed body;
`apiFetch` is now a thin throwing wrapper over it. One implementation of the
headers, the version/capture self-report and the 401 stamp — `apiFetch` threw the
response body away, and the two most important answers this path can get are
both 409s carrying a body the member has to act on.

Tests: `node --test verify/hours-panel.test.mjs` (21) and
`node verify/hours-panel-live.mjs` (30, headed Chromium).


### Layout and parallel timers — Rob's decisions D3 and D4 (lane W2a, 2026-09-14)
- **Parallel starts (D4).** "Start in parallel" is gone; every Start starts a new
  timer beside the ones already running and never stops one. Each running timer
  keeps its own card and its own Stop, and Stop now sends the worker that timer's
  key and entry id; `timer_stop` carries `entry_id` beside `block_id` /
  `project_id`, and a timer whose id is not reconciled yet is flushed once first.
  The popup adopts the server's open entries when the key → entry id pairs differ,
  not the count and not the keys alone. Starting the exact block or client that is
  already running is still a no-op that reports "already running".
- **A stale entry id never reaches `timer_stop` (D4, repair).** Lane W2b's server
  closes strictly by entry id — an id naming no open entry closes nothing — so a
  key stopped and restarted on another machine left this worker holding the old
  id: Stop dropped the local timer, reported success, and the real entry kept
  billing. Three fixes: `stopTimer` writes the pressed card's entry id onto the
  timer before queueing and sends it; the `/track` reconcile in `flushQueue`
  replaces a stale id whenever the server holds exactly one open entry for that key
  (a same-key duplicate keeps its id), which also covers the side panel, which never
  adopts; the popup re-adopts when the same key comes back under a new id. A stop
  carrying `block_id` / `project_id` closes by key on both servers; only a stop with
  no handle at all closes the newest open entry. Probes C2 / C3 / C4 in
  `verify/layout-and-parallel-live.mjs` fail on 1d9360b and pass after.
- **One status line (D3).** The side panel's second, always-open health block is
  folded into the same `<details>` the popup uses: the status row is the summary,
  the lanes and the capture pause control are behind it. The line never wraps.
  Idle is grey whatever is waiting; red is reserved for signed out, a dark hook
  verdict and capture not started. The popup repaints the line whenever the timer
  list changes and after it draws the run list, from the same running set — the
  line had been painted once from local storage and read "Not tracking" above a
  running timer.
- **Setup cards leave once done (D3).** The capture card stands above the surface
  only while the notice is unacknowledged or the profile is signed out; after that
  its pause / resume control lives behind the status line. The work-folder card
  collapses to one line on a fresh `ok` hook verdict and reopens itself on stale,
  duplicate, dark or no fresh verdict, on every surface; the remembered fold
  (`hookConsentFolded`) is no longer read or written, and the restart warning is
  inside the fold.
- **Timer card (D3).** Stop is the prominent control; Request extension and the
  copy control are in a small More menu. In the running view the next-up line
  sits under "Start another task", so the timers are the top of the popup.
- **Add-hours form (D3).** One line per existing entry (time range · client · a
  Timer / Typed / Auto tag), an explanation only on an entry the typed times cross
  or that does not count; ONE searchable client picker instead of a search box and
  a dropdown; refusals render directly above the button row (Submit first) and
  scroll into view; the possible-duplicate prompt shows only the server's own
  sentence naming the existing entry.
- The new member-facing strings were authored by Opus for EXT #13 and placed on
  2026-09-22, so the copy gate reads 0. New checks:
  `verify/layout-and-parallel-live.mjs` (headed) and `verify/status-line.test.mjs`.

## 0.11.1 — the unacknowledged notice is loud, and the server is told

**PUBLISHED 2026-09-09 13:40:39Z.** `time_ext_release` carries the row
(`download_path` `ext-downloads/massmarket-time-tracker-v0.11.1.zip`), and this
release raised `min_supported_version` to **0.11.0** — the first floor since
0.3.3 that is not the oldest build we ever shipped. As of 2026-09-12 20:10Z
**all seven** active tracker tokens report `ext_version` 0.11.1 — the six-of-seven
figure this entry carried earlier that day was true when it was written and the
seventh has since reported in. (The four remaining `team_auth_tokens` rows with a
null `ext_version` are inactive tokens, last seen 2026-08-14 or never.)

⛔ **That floor is why this entry matters to anyone building from `main`.** The
0.11.1 work sat only on `feat/0.11.1-capture-off-signal-2026-09-07` until
2026-09-12, while `manifest.json` on `main` still read 0.11.0 — so a build cut
from `main` would have shipped a version AT the published floor, below every
install in the fleet. The branch is landed here for that reason, not to publish
anything new.

The member-facing copy in this release (the amber `?` badge marker, the
notification title and body, the INSTALL.md badge line) went out with that
published build, and the release notes on the `time_ext_release` row describe
both the badge and the notification. The `OPUS_TO_REVIEW` markers on those
strings in `capture.js`, `background.js` and `verify/capture-gate.test.mjs` are
still in the source and have not been cleared — clearing them is Rob's call, not
an executor's, and this entry does not claim it for him.

Measured before this build: a member on 0.11.0 for three days, active every day,
zero capture rows. The notice card renders only inside the popup and the side
panel; the badge painted BLANK for a signed-in, unacknowledged profile — the one
state in which it had nothing true to say — and no notification existed for it.
A member who updated and never pressed the button was never told.

### Added
- **An amber `?` badge while the notice is unacknowledged.** `refreshBadge()`
  now reads `captureGate()` instead of three raw fields, and has a branch for
  every reason the gate can return. Precedence: red `!` (signed out) beats amber
  `?` (notice pending) beats green/amber `REC` (a timer is running) beats grey
  `II` (paused, no timer) beats blank (capturing). `?` sits above `REC` because
  the members it has to reach are the ones pressing Start.
- **One notification per profile per `NOTICE_VERSION`** (`mm_tt_notice_pending`)
  while the gate answers `not_acknowledged` — fired from `applyCaptureState()`, so
  it runs on every service-worker wake, every sign-in edge and the 4-hourly token
  check, none of which depend on the flush alarm (which is armed only while the
  gate is ON). Re-fired at most once per 24 hours while still unacknowledged,
  on the same cap discipline as the signed-out notification, with the cap in
  storage rather than a module variable. Cleared the moment the notice is
  acknowledged. Clicking it opens the popup (falling back to the options page).
- **The capture STATE is reported to the server** on every authenticated request,
  beside `X-Ext-Version`: `X-Ext-Capture-State` (one of `capturing` /
  `not_acknowledged` / `paused` / `signed_out` / `unknown` — the gate's own
  reason, or `unknown` when the store cannot be read) and `X-Ext-Notice-Version`
  (the `NOTICE_VERSION` this build asks for). State, never content: no URL, no
  title, no count, no acknowledgement timestamp. The server does not yet read
  either header; that is a separate OW change (two columns on
  `team_auth_tokens`, written by `stampLastSeen()`). Measured in a real Chromium
  with this extension loaded: the headers reach production from the service
  worker and from an extension page, because an extension origin with
  `host_permissions` is exempt from the CORS preflight that would drop them from
  a web page.
- `verify/capture-gate.test.mjs` — the notice-pending cap (once per version,
  then daily; never for `paused`, never for `signed_out`, ends on
  acknowledgement), the reported state (the gate's reason, `unknown` for an
  unreadable store, a closed list of five), and the two new copy objects frozen.

### Fixed
- `verify/capture-gate.test.mjs` pinned the PRE-ee048f3 notice body ("no
  keystrokes") and failed against the copy that shipped. The expected string is
  now the shipped copy verbatim. `INSTALL.md` quoted the same stale sentence in
  two places ("in full") and now quotes the shipped one.

### Unchanged
`paused` gets nothing louder: its grey `II`, the state line on the card and the
amber health lane are the complete treatment of a decision the member made.
`signed_out` keeps its red `!`, its notification and its 24h cap. No permission
was added or changed. `captureGate()`, `CAPTURE_NOTICE`, `NOTICE_VERSION`, the
wire allowlist, and the Start button are untouched — the Start interception the
2026-09-04 design floated was not built.

## 0.11.0 — continuous capture while signed in

**Published 2026-09-04T13:03Z.** Rob decides the version floor.

### Added
- **Automatic capture, gated on being signed in.** While a token is stored AND the
  last validation against the server succeeded AND the profile has acknowledged
  the notice AND capture is not paused, the extension records one bucket per
  minute for the active tab: `url`, `tab_title`, `focus_seconds`, `idle` (no
  input for 5 minutes), and counts of clicks / keys / chars / enters / scrolls /
  pastes. Counts only — never which keys, never what was typed, never the
  clipboard, never a screenshot.
- **The gate is no longer the timer.** Pressing Start is not what turns capture
  on and pressing Stop is not what turns it off. The timer only decides which
  `time_entry` the server attaches a minute to; a minute recorded with no timer
  running lands with `time_entry_id = NULL`. This is the change that closes the
  1.1%-attribution hole (`docs/worklog-attribution-design-2026-09-02.md` §6,
  phase 3) — a member who never presses Start now produces a day of evidence.
- **Rows go to `POST /api/ext/track`** as a new `activity` event kind, batched by
  a 1-minute alarm, 300 rows per POST, oldest-dropped beyond a 500-row buffer.
  The server stamps `meta.capture_mode = 'continuous'` so these rows are
  distinguishable from QA-walkthrough rows.
- **Pause / Resume**, on the toolbar popup and the side panel. Persists per
  profile across browser restarts. Paused records nothing at all.
- **A one-time notice per profile**, shown on first run after this update and on
  every fresh install, with an "I understand, start capture" button. Nothing is
  recorded until it is pressed. Recorded locally; the extension has no
  `terms_acceptances` path today, so nothing is posted.
- **Signed-out detection.** On a 401, a missing token, or cleared storage:
  capture stops, the icon shows a persistent red `!`, and Chrome fires one
  notification — re-fired at most once per 24 hours while still signed out.
  Clicking it opens the popup at the token step (falling back to the options
  page). Signing back in clears the badge and fires one "Signed in — capture
  resumed." notification.
- **The server is told.** `signed_out` (with reason `401` / `missing_token` /
  `cleared`) and `signed_in` events post through `/api/ext/track`, so team-health
  and presence can say "signed out since <time>" instead of waiting 72 hours for
  "stale". Best-effort by construction: see the limitation below.
- **Token validation** at service-worker start, every 4 hours, and on any 401.
  There is no daily login. A network failure, a 500 or a DNS error is NOT a
  sign-out — only the server refusing the token, or the token being gone.
- `verify/capture-gate.test.mjs` — 34 assertions over the gate, the state
  machine, the 24-hour cap, and the wire allowlist. Runs under plain
  `node --test`; no package.json, no browser.

### Changed
- The badge has four states: red `!` (signed out) beats green/amber `REC` (a
  timer is running) beats grey `II` (paused, no timer) beats blank.
- `INSTALL.md`'s "What it records" section rewritten for this build, and the
  sentence promising capture never starts on its own removed.
- `apiFetch()` raises a storage flag on a 401 from a call made with the STORED
  token, which the service worker watches and re-validates. A call carrying an
  explicit `auth` (the options page testing a freshly typed token) does not raise
  it.

### Unchanged
Starting and stopping timers, parallel blocks, client selection, unscheduled
work, internal categories, the chip feed, the task list, the search box, the side
panel, the pop-out, the delivery-QA gate, the QA-capture walkthrough and its
`upload_token`, the health strip, and the work-folder consent card. None of their
behaviour was touched.

### Known limitation, stated rather than hidden
A sign-out caused by an invalid token cannot be reported to the server at the
moment it happens — the extension has no credential the server will accept, which
is the definition of being signed out. The event is buffered and delivered on the
next successful sign-in, carrying its ORIGINAL timestamp, so the record is
accurate after the fact but not live. Real-time server-side detection would have
to come from the failed auth attempt itself, which is a server-side change and is
not in this release.

### Still out of scope
Screenshots outside the explicit QA-capture walkthrough. Removed in v0.6.0's
phase-2 shrink and staying removed: the URL is structured and strictly better
than OCR, and the notice this build shows says "No screenshots" in as many words.

## 0.10.1 — the work-folder card asks the hook's own allowlist question
The v0.10.0 card asked a denylist question, wrote a grant nothing read, and then
hid itself — so filling it in looked exactly like being covered while the
fail-closed hook recorded nothing. The card now collects the folder list, renders
the `--consent-allow` / `--consent-remove` / `--consent-status` commands spelled
for the member's own platform (PowerShell does not expand `~`), and claims to
apply nothing. Also: the publish path sends `apikey` to Storage after the
legacy-key rotation.

## 0.10.0 — the health strip, and one renderer for it
Three lanes (this build, the Claude Code hook, the feed) rendered by one function
and mirrored into the side panel, so the two surfaces cannot show green next to
red. Shipped the first version of the work-folder card, corrected in 0.10.1.

## 0.9.0 — the assigned-ticket clients land on the panel
29 clients that were assigned to members but carried nothing schedulable became
startable. Closed the card-Start version-gate hole.

## 0.8.x — the side panel becomes the surface
One compact card per client on both surfaces; Stop on the panel with the
delivery-QA gate behind it; click-to-expand rather than hover; a search box that
survives a repaint with its caret; the pop-out floating window; and the
project-scoped timer (`project:<uuid>`) so a client with no calendar block is
clockable.

## 0.7.0 — pop-out attempt, superseded
Document Picture-in-Picture called from the side panel, which cannot supply the
user activation it needs. Reworked in 0.8.x to put the button on the page.

## 0.6.0 — phase-2 shrink
Removed the always-on activity and screenshot proof layer: per-minute buckets,
periodic screenshots, tab-switch/heartbeat posts, the IndexedDB screenshot upload
queue, and the idle-driven events. Left the clock, the calendar-block picker and
the QA-capture walkthrough. v0.11.0 brings back the per-minute buckets on a
different gate; the screenshot layer stays gone.

## 0.5.5 — parallel timers
Up to four blocks clocked at once, each with its own entry lifecycle.

## 0.3.2 — first committed full source
