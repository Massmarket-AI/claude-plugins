# Massmarket Claude Code plugins

The plugins every Massmarket teammate runs in Claude Code. They update themselves: once installed,
each new release reaches your computer on its own (Claude Code checks for updates when a session
starts, and the new version loads the next time you open it).

| Plugin | What it does |
| --- | --- |
| `mm-hooks` | Keeps the Massmarket worklog hook on this computer current. It only updates a hook the installer already set up; it never installs one, and never touches your token, your tracked folders or your settings. |
| `mm-bridge` | It shows who needs you in a strip above the prompt in every thread and in a side pane (and says who holds a client's reply drafts once someone has picked them up), names and pins each client's thread, and never sends anything to a client. A client's thread is pinned while something of it is due within the next 24 business hours, and unpinned once it is clear. Each client has one chip: in its own thread when it has one (Do it here), otherwise in the thread you are working in; the strip in the other threads says where it is. When something new arrives for one of your clients, the bridge updates that client's thread for you, the same way Update thread does, except that it never picks up the reply drafts: it shows them, and a teammate can still take them. It waits until it has seen the same thing for 10 minutes, and until the reply drafts are ready or two hours have passed since it first saw the client's message. It never sends into a thread you used in the last 10 minutes, sends at most 3 such updates at a time and 12 an hour, and sends none on a computer whose time-tracking hook is older than 0.11.5. A client whose thread has been quiet for more than 7 business days gets its update in that same thread: no new thread is started for it. Right after Claude is asked to start a new thread for that client, its old thread is left alone while the new one starts. A client keeps its thread until you archive or delete that thread. If you use two Claude profiles on this computer, a client whose thread is in the other profile keeps it: in this profile its row offers Start thread, and nothing is started or sent for it by itself until you are back in that profile. A client with no linked thread first gets back the newest open thread that began with its own `[mm-link]` marker; a thread whose title only looks like the client never counts. Type `/mm auto off` to stop these updates. A client with no thread waits for you to press Start. A thread that gets long is compacted by Claude Code instead of being replaced. Starting a new thread always takes your own words: Start on a client's row and typing `/mm start <client>` put "Start <client>'s thread" in your prompt box, and Start missing threads (or `/mm start all`) puts "Start the missing client threads" there; press Enter to send it, or type those words yourself. Claude then starts each thread, and the app asks you to allow each one. A draft already in your prompt box is never written over: the button tells you what to send instead. No cards are put up, and nothing starts a thread by itself. Each request starts at most 8 threads, without picking up their reply drafts, and the new thread links to its client by the `[mm-link]` marker its first message opens with. The strip's button is Start missing threads; with none missing it reads All threads started. The pane has the same button when two or more clients need a thread. Type `/mm` to open the list. Open thread and Update thread take you to the thread by opening its link with your computer's own link opener. A client whose reply drafts a teammate holds is listed under "With a teammate" and is not pinned. A client whose only items were due before Wednesday, October 14, 2026 is listed under "Older", so nothing drops off the list without a trace; everything still open since then stays on the list until it is closed. A pin you take off by hand stays off until something new arrives for that client, or until what it is for goes overdue: then the thread is pinned again, once (take it off again after that and it stays off). After you send or discard a reply draft, the list updates within seconds. A press whose refresh meets a server error from the Onboarding Wizard, or no answer, asks once more before it says it couldn't refresh the list. A thread linked automatically stays linked once you send or close a reply through its pane or a route in that thread; anything else, type `/mm link <client>` in it. A thread the bridge linked by itself moves to the client's newest thread (one that opened for that client, or whose sessions worked on that client alone); a thread you linked yourself stays linked. Claude can relink a client when you ask, as long as the bridge (not you) made the old link. For the founder, a reply that waits for his OK is on his list whoever owns the client. Type `/mm rc on` to give each pinned thread Remote Control automatically, and take it off again when the thread is unpinned if the bridge turned it on; off unless you turn it on. |

## Install

Run the Massmarket installer from the time tracker extension. It adds this marketplace, installs
both plugins and turns on auto-update. By hand, in a terminal:

```
claude plugin marketplace add Massmarket-AI/claude-plugins
claude plugin install mm-hooks@massmarket
claude plugin install mm-bridge@massmarket
```

then set `"autoUpdate": true` on `extraKnownMarketplaces.massmarket` in `~/.claude/settings.json`.

## Releasing

Anyone on the `pms` or `web-builders` team can release. A release runs on every teammate's computer
at their next session, so treat it like a deploy: test it on your own machine first.

`node scripts/release.mjs` copies the worklog hook from the onboarding-wizard `origin/main`, bumps the
version of each plugin that changed, validates, runs the bridge's tests, scans for secrets, commits
and pushes. `--dry-run` does everything but the commit and push. A push that does not bump a version
reaches nobody: the version number is the release.

`main` keeps its full history: force pushes and deleting `main` are blocked (the org's "Keep history on
main" rule), so every release stays on record and any version can be restored with a normal commit.
