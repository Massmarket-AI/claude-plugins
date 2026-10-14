# Massmarket Claude Code plugins

The plugins every Massmarket teammate runs in Claude Code. They update themselves: once installed,
each new release reaches your computer on its own (Claude Code checks for updates when a session
starts, and the new version loads the next time you open it).

| Plugin | What it does |
| --- | --- |
| `mm-hooks` | Keeps the Massmarket worklog hook on this computer current. It only updates a hook the installer already set up; it never installs one, and never touches your token, your tracked folders or your settings. |
| `mm-bridge` | It shows who needs you in a strip above the prompt in every thread and in a side pane (and says who holds a client's reply drafts once someone has picked them up), names and pins each client's thread, and never sends anything to a client. A client's thread is pinned while something of it is due within the next 24 business hours, and unpinned once it is clear. A client with no thread gets a chip in each open thread. It starts a Claude turn only when you press Update thread or Claim in this thread, or type /mm update; Start thread makes a chip you click. Open thread and Update thread take you to the thread by opening its link with your computer's own link opener. A client whose reply drafts a teammate holds is listed under "With a teammate" and is not pinned. A client whose only items are more than 3 business days overdue is listed under "Older", so nothing drops off the list without a trace. A pin you take off by hand stays off until something new arrives for that client. After you send or discard a reply draft, the list updates within seconds. For the founder, a reply that waits for his OK is on his list whoever owns the client. |

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
