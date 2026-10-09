# Massmarket Claude Code plugins

The plugins every Massmarket teammate runs in Claude Code. They update themselves: once installed,
each new release reaches your computer on its own (Claude Code checks for updates when a session
starts, and the new version loads the next time you open it). Releases come from Rob only.

| Plugin | What it does |
| --- | --- |
| `mm-hooks` | Keeps the Massmarket worklog hook on this computer current. It only updates a hook the installer already set up; it never installs one, and never touches your token, your tracked folders or your settings. |
| `mm-bridge` | In the desktop app's Code tab: pins each client thread that needs you (overdue up to 3 days, or due in the next 24 hours), names it with what is due, and shows the reply drafts in a side pane. `/mm` shows the list. It never sends anything and never starts Claude on its own. |

## Install

Run the Massmarket installer from the time tracker extension. It adds this marketplace, installs
both plugins and turns on auto-update. By hand, in a terminal:

```
claude plugin marketplace add Massmarket-AI/claude-plugins
claude plugin install mm-hooks@massmarket
claude plugin install mm-bridge@massmarket
```

then set `"autoUpdate": true` on `extraKnownMarketplaces.massmarket` in `~/.claude/settings.json`.

## Releasing (Rob)

`node scripts/release.mjs` copies the worklog hook from the onboarding-wizard `origin/main`, bumps the
version of each plugin that changed, validates, scans for secrets, commits and pushes. A push that
does not bump a version reaches nobody.
