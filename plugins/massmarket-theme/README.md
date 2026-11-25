# massmarket-theme

The Massmarket look for the Claude desktop and mobile apps, in the paper-and-ink colors of the
massmarket.ai homepage hero.

- Light from sunrise to sunset where this computer is, dark at night. Sunrise and sunset come from
  the computer's own time zone, so they follow the seasons wherever a teammate works.
- By day: a slow cream and gray mesh over the hero's faint grid, black user boxes and cream replies.
- At night: the same in reverse, a cream mesh on black, cream user boxes and black replies.
- Plain square message boxes.
- As a thread nears compacting, the mesh grows and deepens (from half the way there). No extra color
  is added.

## /look

| Command | What it does |
| --- | --- |
| `/look` | Says what the look is doing now and how full this thread is. |
| `/look auto` | Light from sunrise to sunset, dark at night (the default). |
| `/look hours 7 19` | Fixed hours instead: light from 7, dark from 19 (any two hours from 0 to 23). |
| `/look light` | Always light. |
| `/look dark` | Always dark. |
| `/look app` | Follows the app's own light or dark setting. |
| `/look glow on` or `/look glow off` | Turns the mesh growing near compacting on or off. |

The choice is kept on this computer, across threads.

## Install

mm-hooks installs it once on each computer, in the background after a session starts; it shows from
the next session. By hand:

```
claude plugin install massmarket-theme@massmarket --scope user
```

To stop using it, turn it off in the app's plugin settings or run
`claude plugin uninstall massmarket-theme@massmarket --scope user`. mm-hooks never installs it again on
that computer, and never turns it back on.
