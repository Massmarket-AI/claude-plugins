# Massmarket Time Tracker — Install (Chrome, ~2 min)

This replaces Clockify. It's an unpacked Chrome extension (no Web Store listing yet):
install it once, connect it with your token, then track time from the toolbar.

## 1. Install
1. Download `massmarket-time-tracker-latest.zip` and **unzip it somewhere permanent**
   (e.g. `Documents/`). Chrome loads the extension from wherever the folder lives — if you
   move or delete the folder later, the extension breaks.
   *Updating an existing install? Do not follow these steps. Use §1b below, and never remove the extension to update.*
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the unzipped `massmarket-time-tracker` folder.
5. The black Massmarket brain icon appears in your toolbar. Pin it for easy access:
   click the puzzle-piece icon → pin.

## 1b. Already have it installed? Update it — don't reinstall it
<!--
  ⛔ Every line below was authored by Opus for EXT #13 and placed on 2026-09-22.
  A new member-facing line here takes the same route — authored first, then
  placed — and is never written inline. This file ships inside the zip, and
  `verify/release-copy-gate.mjs` holds a publish while any slot is still unfilled.

  ⛔ The technical facts these sentences must rest on, all measured — do not
  soften or restate them:
   · The extension ID is derived from the `key` in manifest.json and has been
     lcnfnlckdnnmgijlfmedfikafaogenga since v0.4.4 (pinned by
     verify/manifest-identity.test.mjs). Chrome keys chrome.storage to that ID.
   · Unzip-over-the-folder + Reload keeps the ID, so it keeps everything in
     storage. Measured on Rob's own machine 2026-09-12 across an in-place
     0.11.1 update: capture_notice_version stayed 2 and capture_state went
     null → capturing. Nothing was re-entered.
   · "Remove" on chrome://extensions deletes that profile's storage. Re-adding
     the same folder gives the same ID back but NOT the data: the member is
     signed out, must paste their token again, and must press "I understand,
     start capture" again — and until they do, the gate answers
     `not_acknowledged` and NOTHING is recorded. That is the whole reason this
     section exists.
   · A running timer is held server-side, but the local half of it is not.
   · Scope is per Chrome PROFILE, structurally: an extension can only see the
     profile it is loaded in. Two profiles = two installs = two separate
     acknowledgements. Neither one covers the other.
   · Incognito is off for an extension until the member turns on "Allow in
     Incognito" on its Details page; with it on, capture runs in an Incognito
     window of the same profile (measured 2026-09-28, EXT #15 — the probe is
     verify/capture-frames-live.mjs --incognito). Step 6's last two sentences
     were authored by Opus for EXT #15 and placed 2026-09-28.

  ⛔ STEP 7 IS NOT OPTIONAL AND IT IS NOT A TROUBLESHOOTING NOTE. Without it, a
  member whose Reload appeared to change nothing has exactly one obvious next
  move, and it is Remove — the single action that destroys the token and the
  capture acknowledgement and leaves the gate answering `not_acknowledged` with
  nothing recorded. The benign cause is a CDN that is still serving the previous
  bytes: tools/publish.mjs fetches both the versioned and the -latest zip back
  through the public URL and compares sha256, retrying eight times, precisely
  because that lag is real. The version string under the extension's name is the
  only thing on the member's screen that distinguishes "the update did not land
  yet" from "the update did not work".
-->
1. Download `massmarket-time-tracker-latest.zip` again. It is the same file you installed from the first time, not a separate updater.
2. Unzip it **over** the folder Chrome already loads the extension from, so the new files replace the old ones in place. Never unzip it to a new location.
3. Go to `chrome://extensions` and press **Reload** (↻) on the **Massmarket Time Tracker** card. That is the whole update.
4. ⛔ **Do not press Remove and add it again.** Remove wipes everything the extension has stored in this Chrome profile: you are signed out, you have to paste your token again, and you have to press **"I understand, start capture"** again. Nothing at all is recorded until you do.
5. An in-place update keeps your token, your capture acknowledgement, your pause choice, your work folders and any running timer. We checked this on a real in-place update on 12 September 2026; it is not an assumption.
6. The extension only ever sees the Chrome profile it is installed in. If you work in more than one profile, install it and press **"I understand, start capture"** in each one. Doing it in one profile does nothing for the other. Using Incognito windows for client work? On `chrome://extensions`, open the tracker's **Details** and turn on **Allow in Incognito**, or nothing you do in an Incognito window is recorded. With it on, the tracker records Incognito windows in that profile the same way it records any other window.
7. **Check the update landed.** After Reload, look at the version number shown with the extension's name on `chrome://extensions`. If it still shows the old version, the update did not land: the download gave you the previous build, which can happen for a short while after a release. Download the zip again and unzip it over the same folder again. Do **not** press Remove. Remove is the one action that signs you out and wipes your capture acknowledgement, and it fixes nothing here.

## 2. Connect
1. Right-click the extension icon → **Options** (or click the icon → **Open settings**).
2. The **API URL** is already filled in — just paste your personal **member token** (sent to you separately).
3. Click **Connect**. You should see **"Connected as <your name>"**.

## 3. Use it
- **The first time you open it after installing, read the capture notice and press
  "I understand, start capture."** Nothing is recorded until you do. You are asked once
  per browser profile, not once a day.
- After that it tracks on its own for as long as you stay signed in. There is no daily
  clock-in.
- **You can still start a timer by hand, and nothing about that changed.** Click the icon,
  pick the calendar block you're working on — or choose **Unscheduled work** and add a short
  note, or pick a client — then hit **Start**. Click the icon → **Stop** when you're done.
- **Pause whenever you want.** "Pause capture" is on the popup and the side panel. While
  paused, nothing is recorded. "Resume capture" turns it back on. The choice sticks across
  browser restarts.
- The badge on the icon tells you where you stand:
  - red **!** — you are signed out, and nothing is reaching us. Open the extension and
    sign back in.
  - amber **?** — signed in, but you have not yet pressed "I understand, start capture",
    so nothing is being recorded. Open the extension and read the notice.
  - green **REC** — a timer is running (amber if the block's scheduled time is up).
  - grey **II** — capture is paused and no timer is running.
  - blank — signed in, capturing, no timer running.
- **Keep your timers on screen**: click **◨ Side panel** in the popup header (or **◨ Keep
  visible** while a timer runs). The popup closes the moment you click anywhere else — the
  side panel doesn't.

### New in 0.11.0
- **It tracks the whole time you're signed in.** Sign in once and the extension records
  which page you're working in and for how long, so your hours land on the right client
  without you clicking anything. You do not have to remember to press Start.
- **Everything you already used still works.** Starting and stopping timers, picking a
  client, unscheduled work with a note, the chips, the side panel, the QA-capture
  walkthrough and the work-folder card are all unchanged. Automatic capture is added
  alongside them, not instead of them.
- **A pause button that means it.** Paused = nothing recorded, on this profile, until you
  resume.
- **You get told when you're signed out.** If your token is revoked or your browser data is
  cleared, the icon goes red and Chrome shows you a notification instead of your hours
  quietly going missing for three days. Click it to get back to the token screen.

### New in 0.8.0
- **The side panel is now the surface.** It shows everything you have open, all the time —
  not just when a timer is running. One card per client, carrying *every* item you owe that
  client. Open it from **◨ Side panel** in the popup header.
  - Due in the next 24 hours: anything due within a day that has no time logged yet, meetings included.
    **Overdue** is a separate, quieter section below it: also important, but a different
    problem.
  - **Hover a card** (or Tab to it, or hit **Details**) and it expands in place to the full
    list — every item, its date, its estimate and why it's on your plate. Nothing is
    summarised away.
  - **ETA needed** on a card means at least one item has no committed date in OW yet.
  - **Start** starts the clock on that client's next block *and* copies the whole chip — the
    complete Claude Code prompt for everything open for that client — to your clipboard. Paste
    it into a Claude Code session and you have the same thing a chip would have given you.
    You'll see **"Chip copied to clipboard"**.
- **Status row — Chips · Hooks · Timer** — always visible, in the panel and in the popup.
  - **Chips** says whether your task feed is being served: *Served (n)* when it has work in
    it, *Not being served* when it is empty or can't be reached. It turns green only once your
    own Claude Code hook confirms a chip reached your session; until then it stays grey, and
    grey is normal.
  - **Hooks** is your Claude Code hook. **A red hook never stops you tracking time.**
  - **Timer** is green while a timer is running and grey when none is. It never turns red: red is
    kept for things you have to act on.
- **Pop out** — **⧉ Pop out** in the side panel floats the whole panel (status row, timers and
  every client card) in a small window that stays above Slack, your editor, anything.
  Chrome only allows a floating window to be opened from a click **on the page itself**, so
  after you press Pop out a **"⧉ Float the Massmarket tracker"** button appears at the top of
  the tab in front of you — click that and the window opens. Resize it by dragging the edge or
  with **⤡ / ⤢**, and change the text size with **− / +**. The button is only shown when there
  is a normal web page in front of you to host it; on a `chrome://` page or the Web Store it
  tells you why instead of failing when you click it.
- **Start button doesn't hide any more** — in the picker, **Start** is pinned to the bottom of
  the popup, so it's visible the moment you choose something however long your block list is.

### New in 0.7.0
- **Side panel** — a persistent panel that lists every timer you have running, with live
  clocks, and flags any block that has passed its scheduled end. (0.8.0 turned this into the
  full task surface — see above.)
- **Health check** — a strip under the header with two dots that are checked independently
  (0.8.0 replaced the summary with the three-indicator status row above; the detail below it
  is unchanged):
  - **Extension** — whether your installed build is current. Red means you're below the
    minimum supported version and **Start** is blocked until you update — unzip the new build
    over your existing folder and hit ↻, exactly as in §1b; never remove the card and re-add it
    (this is the same gate as before, just explained now). Amber means there's a newer build
    worth grabbing.
  - **Claude Code hook** — whether your Claude Code hook has been reporting in. If it never
    reported, your hook install didn't finish; if it's gone quiet, it says how many days.
    Either way there's a direct link to fix it.

  Both dots green = the strip stays collapsed and out of your way. **A broken hook never stops
  you tracking time** — they're separate tools, and only the version floor above can block Start.

### New in 0.3.2
- **QA check fires at the block's end, not on every Stop** — stop *well before* your block's
  scheduled end and you're asked whether you're **continuing later** (no QA) or **finished early**
  (post QA). At or near the scheduled end, you get the QA step as before.
- **Scheduled-time-up reminder** — when a running block passes its scheduled end, the toolbar
  badge turns amber and you get a notification. Open the popup and a banner reminds you to post QA,
  request an extension, or keep going. It never stops your timer for you.
- **Upcoming blocks in the picker** — the block list now also shows your upcoming blocks, labeled
  with day + time (e.g. "Mon 2:00 PM – 3:00 PM") and sorted soonest-first, so you can start one early.

### New in 0.3.0
- **Request extension** — while a timer is running, the popup has a *Request extension* link.
  Open it, write why you need more time (and optionally how many hours over you expect), and
  send — your PM is notified. You get a **✓ PM notified** confirmation.
- **End-of-block QA check** — when you Stop a timer that was on a calendar block, you're asked
  to confirm you emailed the QA update to the client and CC'd agent@massmarket.ai. Checking
  the box records it. It's a reminder, not a lock — you can still leave without checking.
- **Update banner** — if your copy of the extension falls behind, a banner appears at the top of
  the popup with a download link so you can grab the newer build and reload.

## What it records (and what it doesn't)

**This section describes v0.11.0.** It changed in this release — automatic capture is back,
on a different gate from the one that was removed in v0.6.0. Your installed copy is what
decides, not this page: check the version on `chrome://extensions` if you are unsure.

**The notice you are shown before anything is recorded, in full:**

> While you are signed in on this browser profile, Massmarket Time Tracker records the web address and page title of the tab you are working in, how long it is active or idle, and how many times you clicked, typed, scrolled or pasted in each minute, so your hours land on the right client without you clicking anything. It never records which keys you pressed, what you typed, or what you copied. It records nothing at all while you are signed out or paused. No screenshots, no other apps, and nothing outside this profile.

**What that means in practice.**

| | Recorded | Not recorded |
|---|---|---|
| **While you are signed in and not paused** | The address and page title of the tab you are working in, per minute. How many seconds of that minute the tab was active, and whether the minute was idle (no input for 5 minutes). Counts of clicks, keystrokes, scrolls and pastes. The calendar block or client you are clocked into, if any, plus your start/stop times and your note. The network location (IP address and city) you connect from. | Which keys you press. Anything you type. Anything you copy or paste. Anything you select on a page. Screenshots. Any other browser profile, any other browser, and anything outside Chrome. |
| **While you are signed out** | Nothing. | Everything. |
| **While you are paused** | Nothing. | Everything. |

**"Counts, never content" is the whole rule for input.** The extension classifies a
keystroke as printable / Enter / other so it can count them, and the key itself is never
stored and never sent. The same goes for pastes: it counts that one happened and never
reads the clipboard.

**Scope is your browser profile, and that is structural.** A Chrome extension can only see
the profile it is installed in. If you keep personal browsing in a different profile — or a
different browser — this extension cannot see it, and no setting we could ship would change
that.

**Where it stops on its own.** Sign out, or press Pause, and capture stops immediately —
the minute in progress is delivered and no new one starts. It restarts only when you sign
back in, or press Resume.

**QA capture is still separate, and still yours to start.** When you deliberately run a
QA-capture walkthrough at the end of a block, the extension takes a screenshot **on each
click** for the length of that walkthrough, so the QA doc has evidence behind it. That is
the only screenshot path in the extension, it never starts by itself, and it stops when the
walkthrough does. Automatic capture takes no screenshots at all.

**The Claude Code card is about something else.** That card sets up the Claude Code worklog
hook, which records work from the folders you choose on your machine. It is a separate system
with its own folder list, and nothing you choose on one changes the other.

## Troubleshooting
- **"Cannot reach the server"** — the API URL is wrong or has a typo. It should start with `https://`.
- **"That token was rejected (HTTP 401)"** — the token is wrong; DM for a fresh one.
- **The activity feed is empty** — check three things, in order: the icon (a red **!** means you
  are signed out), the capture card on the popup (it says "Paused" if you paused it), and whether
  you ever pressed "I understand, start capture" — nothing is recorded until you do.
- **A red `!` badge that will not clear** — your token was rejected. Right-click the icon →
  Options → paste a fresh token → Connect. The badge clears and you get a "Signed in — capture
  resumed." notification.
- **Timer looks stuck after a Chrome restart** — open the popup once; it re-syncs with the server,
  which is always the source of truth for whether a timer is open.
- **"Start" is greyed out and the health strip is red** — your build is below the minimum the
  backend supports. Download the zip again, unzip it over your existing folder, and hit ↻ on
  `chrome://extensions`.
- **Health strip says the Claude Code hook never reported in** — that's the hook, not this
  extension. Follow the install link in the strip. Your timers keep working either way.
- **No "◨ Side panel" button** — your Chrome is too old for side panels. Update Chrome; the rest
  of the extension is unaffected.

---

## Discord-ready install message (copy/paste)

<!--
  ⛔ The last line of this block was authored by Opus for EXT #13 and placed on
  2026-09-22. It is the 0.11.2 update line and it does two jobs the rest of the
  block does not: it says Reload and NOT Remove in the same breath, and it tells
  them how to CHECK the update landed — the version under the card — so that "it
  did nothing" does not send somebody to Remove. See the measured facts in §1b and
  step 7 there.
  Nothing in this repo sends this message — it is copy for a human to paste.
-->

```
📋 New time tracker (replaces Clockify) — ~2 min to set up. Grab massmarket-time-tracker-latest.zip and unzip it somewhere you won't delete. (Already installed? Unzip it OVER your existing folder, then hit ↻ on chrome://extensions.)
1) chrome://extensions → turn on Developer mode (top-right) → Load unpacked → pick the unzipped folder.
2) Right-click the new toolbar icon → Options → the API URL is already filled in, just paste your token (DM me for yours) → Connect. You should see "Connected as <you>".
3) Click the icon, pick your calendar block (or "Unscheduled work" + a note), hit Start. Green "REC" badge = it's tracking; hit Stop when done.
4) New in 0.8.0: hit "◨ Side panel" — it's now your whole list, one card per client with everything you owe them, and the top section is anything due in the next 24 hours with no time logged yet. Hover a card for the full detail. "Start" clocks in AND copies the whole chip to your clipboard to paste into Claude Code. "⧉ Pop out" floats the panel above everything else (Chrome makes you click one button on the page to allow it — we put it there for you). The status row reads Chips · Hooks · Timer; red means you need to act. A red hook never blocks you from tracking time.
5) New in 0.11.0: the first time you open it, read the notice and press "I understand, start capture" — nothing is recorded until you do, and you're only asked once. After that it tracks on its own the whole time you're signed in, so your hours land on the right client without you pressing Start. You can still start timers and pick clients by hand exactly as before, and "Pause capture" (popup or side panel) stops it whenever you want. Badge: red ! = signed out and nothing is being recorded, amber ? = signed in but you have not yet pressed "I understand, start capture" so nothing is being recorded, green REC = a timer is running, grey II = paused.
6) New in 0.11.2. Already on 0.11.1? Download the same zip, unzip it OVER your existing folder, and hit ↻ Reload on chrome://extensions. Do NOT press Remove and re-add it: Remove signs you out and switches capture back off until you press "I understand, start capture" again. Then check the card on chrome://extensions reads 0.11.2; if it still shows the old version, download and unzip over the same folder again. You get: "◷ My hours" (what the tracker recorded for you, plus a form to add time you did not clock), timers side by side (up to 4; a new Start never stops another, and each counts in full for its own client, so run two only when you are working for both), one status line where red means you need to act, a "Next up" line with the next client, and Close out for a block whose client has gone. Two Chrome profiles? Install and press "I understand, start capture" in each one.
7) New in 0.11.3. Update the same way: download the zip, unzip it OVER your existing folder, hit ↻ Reload on chrome://extensions (never Remove), and check the card reads 0.11.3. The tracker now matches massmarket.ai, and its toolbar icon is the black Massmarket brain. If your Claude Code tracking needs setting up or fixing, the tracker shows you one step at a time: copy the message it shows into Claude Code, pick your client-work folder in the Choose Folder window, then quit and reopen Claude Code. No card means you are done. "← Back" now takes you out of My hours.
Heads-up, verbatim from the notice you'll see: While you are signed in on this browser profile, Massmarket Time Tracker records the web address and page title of the tab you are working in, how long it is active or idle, and how many times you clicked, typed, scrolled or pasted in each minute, so your hours land on the right client without you clicking anything. It never records which keys you pressed, what you typed, or what you copied. It records nothing at all while you are signed out or paused. No screenshots, no other apps, and nothing outside this profile.
```
