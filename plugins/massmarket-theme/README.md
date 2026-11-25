# massmarket-theme

The Massmarket look for the Claude desktop and mobile apps, in the paper-and-ink colors of the
massmarket.ai homepage hero.

- Light from sunrise to sunset where this computer is, dark at night. Sunrise and sunset come from
  the computer's own time zone, so they follow the seasons wherever a teammate works.
- By day: a slow cream and gray mesh over the hero's faint grid.
- At night: the same in reverse, a cream mesh on black.
- Your messages sit in a plain square box: white by day and black at night, with a hairline edge
  (`/look boxes flip` turns it around: black by day, cream at night). Claude's replies and tool rows
  have no box; their words sit on the page.
- The mesh grows and deepens when a fresh thread would be much cheaper than this one: each step re-reads the
  whole thread, and once a thread has sat past its cache's life (an hour) the next message re-reads all of it
  at full price. A large thread being worked on stays calm, since its warm cache is worth keeping; a large
  thread gone cold glows. No extra color is added.

## /look

| Command | What it does |
| --- | --- |
| `/look` | Says what the look is doing now, and what a fresh thread would save over this one. |
| `/look auto` | Light from sunrise to sunset, dark at night (the default). |
| `/look hours 7 19` | Fixed hours instead: light from 7, dark from 19 (any two hours from 0 to 23). |
| `/look light` | Always light. |
| `/look dark` | Always dark. |
| `/look app` | Follows the app's own light or dark setting. |
| `/look glow on` or `/look glow off` | Turns the mesh's growing with that saving on or off. |
| `/look boxes match` or `/look boxes flip` | Your messages' box in the page's own color (white by day, black at night; the default) or the reverse (black by day, cream at night). |

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
