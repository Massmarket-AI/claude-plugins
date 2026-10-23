// consent.js — the member's WORK-FOLDER LIST, and the command that applies it.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ WHAT THIS FILE IS NOT, AS OF v0.10.1.
//
// It is NOT a consent grant, and nothing in this extension grants consent any
// more. v0.10.0 shipped a card that asked a DENYLIST question ("record from
// everywhere except these folders"), wrote `{scope, denylist}` into
// chrome.storage.local, and then went quiet — and the member read that silence
// as "I am covered".
//
// They were not covered. They were DARK. Three facts, each fatal on its own:
//
//   1. THE HOOK IS A FAIL-CLOSED ALLOWLIST, NOT A DENYLIST. Since OW #196 the
//      worklog hook records ONLY from roots listed in
//      <homedir>/.claude/mm-hooks/consent.json (`{"v":2,"allowlist":[...]}`).
//      Missing, empty, corrupt, v1, or denylist-shaped — every one of those
//      records NOTHING, silently and by design. The card was asking the
//      opposite question to the one the gate answers.
//   2. THE EXTENSION CANNOT WRITE THAT FILE. A Chrome extension has no
//      filesystem. There is no API, no permission and no workaround, so the
//      old `saveGrant()` could not have applied the setting even if the shape
//      had been right.
//   3. NOTHING EVER READ WHAT IT WROTE. `hookConsentGrant` had exactly one
//      consumer: the card that hid itself once it existed. The hook never saw
//      it. So the one visible effect of answering the card was that the card
//      stopped asking.
//
// The fix is to stop pretending. This module now does three small honest
// things and nothing else:
//
//   * hold the folder list the member typed, as a LOCAL DRAFT (a re-render
//     cache — see the storage section);
//   * render the exact terminal command that actually applies that list;
//   * refuse to imply, anywhere, that either of those turned recording on.
//
// ⛔ THE GATE ITSELF IS NOT OURS TO SOFTEN. Fail-closed is correct: a config we
// cannot read must never be treated as permission. This file was brought into
// agreement with that gate; the gate was not brought into agreement with this
// file, and must not be.
//
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ NOTHING HERE DECIDES WHETHER A SESSION IS RECORDED.
//
// v0.10.0's `isPathDenied` / `sessionRowFor` / `registrationPlan` are DELETED,
// not ported. They implemented denylist containment matching inside the
// browser, had zero production callers, and encoded the policy this release
// exists to remove. Path containment is decided in exactly one place — the
// hook's own matcher, on the machine, against the real filesystem — and a
// second implementation in a browser could only ever disagree with it.
//
// Do not re-add a matcher here. If this file ever grows one again it will be
// answering a question it cannot see the inputs to.

// ───────────────────────────────────────────────────────────── the hook's CLI

// ⛔ THE PATH IS PER-PLATFORM NOW, AND THAT IS A CORRECTION, NOT A REFINEMENT.
//
// One constant used to carry it — `~/.claude/mm-hooks/worklog-hook.js` — on the
// argument that a single spelling everywhere is the only way the commands on
// screen can be guaranteed to name one file. The argument was right. The
// constant was wrong, and it was wrong for the majority of this team:
//
//   POWERSHELL DOES NOT EXPAND `~` IN AN ARGUMENT TO A NATIVE COMMAND. It is a
//   path shortcut for PowerShell's own providers, not a shell expansion, so
//   `node ~/.claude/...` hands node a literal tilde and node dies with ENOENT.
//   Measured `platform` in production: antu, asif, has9, mahfuz and tanvir are
//   all win32. Five of the people who most need this card were handed a command
//   that cannot run, by a card whose entire job is to hand them a command.
//
// The agreement the old constant was protecting is kept, by construction rather
// than by having one string: allow, remove and status are ALL rendered through
// `hookScriptPath()` with the SAME platform value, so the three lines on screen
// cannot name two different files. Nothing may inline a path — if you find
// yourself typing `.claude/mm-hooks` anywhere but the two constants below, the
// two-spellings bug is being rebuilt.
//
// ⛔ THE WINDOWS FORM IS QUOTED AND THE POSIX FORM MUST NOT BE.
// `$env:USERPROFILE` expands inside a PowerShell DOUBLE-quoted string, and the
// profile directory routinely contains a space (`C:\Users\Md Antu`), so the
// quotes there are load-bearing and the backslashes have to survive verbatim —
// PowerShell does not treat `\` as an escape inside double quotes. `~`, by
// contrast, is expanded by a POSIX shell ONLY when it is unquoted: quoting the
// mac/linux form would break it in precisely the way the Windows form breaks
// without quotes.
export const PLATFORM_WINDOWS = 'win';
export const PLATFORM_POSIX = 'posix';

const HOOK_PATH_WINDOWS = '"$env:USERPROFILE\\.claude\\mm-hooks\\worklog-hook.js"';
const HOOK_PATH_POSIX = '~/.claude/mm-hooks/worklog-hook.js';

export const ALLOW_FLAG = '--consent-allow';
export const REMOVE_FLAG = '--consent-remove';
export const STATUS_FLAG = '--consent-status';

// ─────────────────────────────────────────────────────────── which platform
//
// ⛔ THE PLATFORM IS AN ARGUMENT EVERYWHERE, NEVER AN AMBIENT READ.
//
// Every renderer below takes `platform` as a parameter that merely DEFAULTS to
// the detected one. That is the whole reason this defect is testable: a path
// that only the machine it runs on can produce is a path only that machine can
// check, and a Windows-only string proved by nobody is exactly how a literal
// `~` reached five people. The probe drives both forms on one mac.

/** `chrome.runtime.getPlatformInfo().os` → the only distinction that matters. */
export function platformFromOs(os) {
  return String(os == null ? '' : os).toLowerCase() === 'win' ? PLATFORM_WINDOWS : PLATFORM_POSIX;
}

/**
 * A userAgent → the same answer. This is the FALLBACK, used on surfaces where
 * `chrome.runtime` is not reachable. It is deliberately a widening match:
 * getting this wrong on a mac renders a PowerShell path a mac member cannot
 * run, and getting it wrong on Windows renders a tilde — so both directions
 * fail loudly at the terminal rather than silently recording the wrong thing.
 * Nothing here decides what is recorded; it only decides how a path is spelled.
 */
export function platformFromUserAgent(ua) {
  return /windows|win32|win64|wow64/i.test(String(ua == null ? '' : ua)) ? PLATFORM_WINDOWS : PLATFORM_POSIX;
}

// Filled in by resolvePlatform() so the synchronous render paths — the ones that
// repaint on every keystroke — do not have to await anything.
let detectedPlatform = null;

/** The best answer available WITHOUT awaiting. Never throws. */
export function currentPlatform() {
  if (detectedPlatform) return detectedPlatform;
  try {
    const nav = globalThis.navigator;
    if (nav && nav.userAgentData && nav.userAgentData.platform) {
      return /windows/i.test(String(nav.userAgentData.platform)) ? PLATFORM_WINDOWS : PLATFORM_POSIX;
    }
    return platformFromUserAgent(nav && nav.userAgent);
  } catch (e) {
    return PLATFORM_POSIX;
  }
}

/**
 * Ask Chrome, cache the answer, fall back to the userAgent. Never throws and
 * never hangs: a `getPlatformInfo` that neither calls back nor settles would
 * otherwise stall the mount and leave the member with NO card at all, which is
 * a worse failure than a mis-spelled path.
 */
export async function resolvePlatform() {
  try {
    const rt = typeof chrome !== 'undefined' && chrome && chrome.runtime;
    if (rt && typeof rt.getPlatformInfo === 'function') {
      const info = await new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        setTimeout(() => done(null), 300);
        try {
          const maybe = rt.getPlatformInfo(done);
          if (maybe && typeof maybe.then === 'function') maybe.then(done, () => done(null));
        } catch (e) { done(null); }
      });
      if (info && info.os) {
        detectedPlatform = platformFromOs(info.os);
        return detectedPlatform;
      }
    }
  } catch (e) { /* fall through to the userAgent */ }
  detectedPlatform = currentPlatform();
  return detectedPlatform;
}

/** The one place either spelling of the hook's path comes from. */
export function hookScriptPath(platform = currentPlatform()) {
  return platform === PLATFORM_WINDOWS ? HOOK_PATH_WINDOWS : HOOK_PATH_POSIX;
}

// ───────────────────────────────────────────────────────────── the folder list

/**
 * Clean the member's typed list WITHOUT interpreting it.
 *
 * ⛔ FIDELITY BEATS NORMALISATION HERE, and that is a reversal from v0.10.0.
 * The old normalizer rewrote `\` to `/` and lower-cased for comparison, because
 * it was feeding a matcher. This list is feeding a SHELL COMMAND the member
 * will run, so `F:\MMAI Project` has to come back out as `F:\MMAI Project`.
 * Rewriting separators would hand a Windows member a command containing a path
 * they never typed.
 *
 * What it does do, and why each one is load-bearing:
 *
 *   - trims surrounding whitespace, and drops blank lines;
 *   - strips a matched pair of surrounding double quotes. Windows Explorer's
 *     "Copy as path" yields `"F:\MMAI Project"` WITH the quotes, and this is
 *     the single most likely thing a member pastes. Left alone it would render
 *     as `""F:\MMAI Project""` and break the command;
 *   - strips trailing `/` and `\`. A trailing backslash immediately before the
 *     closing quote escapes that quote in every POSIX shell, so
 *     `"F:\MMAI Project\"` swallows the rest of the line. The hook strips
 *     trailing separators from roots anyway, so nothing is lost;
 *   - drops control characters, which cannot appear in a usable root and can
 *     smuggle a line break into a command;
 *   - de-duplicates on the EXACT string, not a case-folded one. The hook folds
 *     case everywhere except linux, where two spellings really are two folders
 *     — so folding here could silently drop a root a linux member meant.
 *
 * Order is the member's own and is preserved: this is their list and it should
 * read back the way they typed it.
 */
export function normalizeWorkFolders(raw) {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw == null ? '' : raw).split(/[\r\n]+/);
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    let s = String(part == null ? '' : part).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (s.length > 1 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).trim();
    // Strip trailing separators, but never chew a path down to a bare drive
    // letter (`F:`) or to nothing — those are refused by the hook by name, and
    // a member reading `refused: F:` should see what they typed.
    while (s.length > 2 && (s.endsWith('/') || s.endsWith('\\')) && !s.endsWith(':/') && !s.endsWith(':\\')) {
      s = s.slice(0, -1);
    }
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * The commands that act on the list, rendered for the member to copy.
 *
 * ⛔ THERE ARE TWO OF THEM, AND THAT IS THE SECOND CORRECTION IN THIS FILE.
 * `--consent-allow` is APPEND-ONLY in the hook: it does
 * `next = (current.allow || []).concat(args)`. So a member who deletes a folder
 * from the card's field, copies, and runs the command STILL HAS THAT FOLDER
 * ALLOWED. The card used to tell them that re-running this one command was how
 * they changed the list — a REPLACE the CLI has never performed. On a privacy
 * surface the direction of that error is OVER-COLLECTION: a folder the member
 * believed they had withdrawn stays recorded, and nothing on screen contradicts
 * them. `--consent-remove` is what withdraws one, it has been in the hook the
 * whole time, and the card now renders it.
 *
 * (The exact sentence that made that promise is deliberately not reproduced
 * anywhere in this repo, including in this comment: the probe scans every
 * surface file for it, on the same reasoning that retired the v0.10.0 denylist
 * strings — a dead sentence sitting in a comment is one copy-paste from being
 * on screen again.)
 *
 * ⛔ EVERY PATH IS QUOTED, WITHOUT EXCEPTION — including the ones that look
 * safe. `F:\MMAI Project` and `/Users/efaz/Efaz Work` are real work roots on
 * this team, and an unquoted space would reach the hook as two arguments, both
 * refused, for a reason nothing on screen would explain.
 *
 * Returns the bare `... --consent-allow` / `... --consent-remove` with no
 * arguments when the list is empty. That is a truthful preview of "you have
 * listed nothing" and it is why both copy controls are disabled in that state —
 * see consentcard.js.
 */
function renderCommand(flag, folders, platform) {
  const list = normalizeWorkFolders(folders);
  const args = list.map((p) => `"${p}"`).join(' ');
  return `node ${hookScriptPath(platform)} ${flag}${args ? ` ${args}` : ''}`;
}

/** ADDS the listed folders to the allowlist. Never replaces it. */
export function renderAllowCommand(folders, platform = currentPlatform()) {
  return renderCommand(ALLOW_FLAG, folders, platform);
}

/** DROPS the listed folders from the allowlist. The only way to withdraw one. */
export function renderRemoveCommand(folders, platform = currentPlatform()) {
  return renderCommand(REMOVE_FLAG, folders, platform);
}

/** The command the card's verify line names. Same path, same spelling. */
export function renderStatusCommand(platform = currentPlatform()) {
  return `node ${hookScriptPath(platform)} ${STATUS_FLAG}`;
}

// ───────────────────────────────────────────────────────────────────── storage

// ⛔ THIS IS A DRAFT, AND THE NAME SAYS SO.
//
// `hookWorkFoldersDraft` holds what the member TYPED, so the card can paint
// their list back and rebuild the command on the next open. It is not consent,
// it does not authorize anything, and nothing outside this extension can even
// see it. The key was renamed from `hookConsentGrant` precisely so that no
// future reader — human or otherwise — can mistake a cache for a permission.
//
// If you are tempted to give this file a `hasConsent()` or an `ask` flag: it
// cannot answer either question. The only thing that knows whether recording is
// on is the hook, and the only way to ask it is to run the `--consent-status`
// command — rendered by renderStatusCommand() for the member's own platform —
// on the machine.
export const WORK_FOLDERS_KEY = 'hookWorkFoldersDraft';
export const DRAFT_VERSION = 2;

// v0.10.0's keys. Read once, to DELETE — never to migrate. See purgeLegacyGrant.
const LEGACY_GRANT_KEY = 'hookConsentGrant';
const LEGACY_MACHINE_KEY = 'hookConsentMachineId';

// ⛔ Serialized read-modify-write, for the reason common.js's gate is: three
// surfaces share this key and chrome.storage.local has no atomic update.
let draftQueue = Promise.resolve();
function withDraftLock(fn) {
  const run = draftQueue.then(fn, fn);
  draftQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Coerce whatever is in storage into the v2 draft shape. Never throws. */
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { v: DRAFT_VERSION, folders: [], updatedAt: null };
  return {
    v: DRAFT_VERSION,
    folders: normalizeWorkFolders(raw.folders),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

/**
 * ⛔ THE v0.10.0 DENYLIST IS DELETED, NEVER CONVERTED.
 *
 * A stored `{denylist: ['/Users/x/taxes']}` means "NEVER record this folder".
 * The field it would land in here means "record ONLY these folders". Reading
 * one as the other would take the member's most private directory and put it on
 * the allowlist — the worst possible outcome of this whole release, produced by
 * a migration that looked like housekeeping.
 *
 * So the old keys are removed and nothing is carried across. Removal authorizes
 * nothing: the hook never read them, and it cannot start recording because a
 * browser-local key went away.
 */
async function purgeLegacyGrant() {
  try {
    if (chrome.storage.local.remove) await chrome.storage.local.remove([LEGACY_GRANT_KEY, LEGACY_MACHINE_KEY]);
  } catch (e) { /* a key we could not delete is inert; it has no readers left */ }
}

/** The member's list as last typed. `[]` when there is nothing stored. */
export async function getWorkFolders() {
  try {
    const o = await chrome.storage.local.get(WORK_FOLDERS_KEY);
    purgeLegacyGrant();
    return normalizeDraft(o[WORK_FOLDERS_KEY]).folders;
  } catch (e) {
    return [];              // storage unreadable — the card just starts empty
  }
}

/**
 * Remember what the member typed. The ONLY write this module makes.
 *
 * ⛔ THIS DOES NOT APPLY ANYTHING, and no caller may report it as if it did.
 * It returns the normalized list and the commands that WOULD act on it; whether
 * either was ever run is unknowable from here. Both are handed back, because a
 * caller that merged only the ADD command into its state would be holding a
 * half-updated pair and could repaint one line stale.
 */
export function saveWorkFolders(raw) {
  return withDraftLock(async () => {
    const folders = normalizeWorkFolders(raw);
    const draft = { v: DRAFT_VERSION, folders, updatedAt: new Date().toISOString() };
    try {
      await chrome.storage.local.set({ [WORK_FOLDERS_KEY]: draft });
      purgeLegacyGrant();
    } catch (e) { /* storage unavailable — the card keeps what is on screen */ }
    const platform = currentPlatform();
    return {
      folders,
      platform,
      command: renderAllowCommand(folders, platform),
      removeCommand: renderRemoveCommand(folders, platform),
    };
  });
}

// ─────────────────────────────────────── the fold is gone (0.11.3)
//
// v0.11.2's consentFoldView() / hookVerdictFold() / HOOK_VERDICT_BAD_STATES lived
// here: the work-folder card FOLDED to one line on a fresh `ok` verdict and was
// forced open on everything else. 0.11.3 replaces the fold with a card that is
// shown only while a step is due and absent otherwise, so there is nothing left
// to fold. The verdict is now read in exactly ONE place — panelui.js
// hookSetupState() — which keeps every rule the fold had: only a FRESH answer
// counts (a refresh that failed is no answer), a `degraded` verdict is no answer,
// an absent verdict (an older server) is no answer, and the liveness lane
// (`hook.state`, stamped on the auth path) is never read as one.

/**
 * Everything a surface needs to paint the card, in one read.
 *
 * ⛔ 0.11.3: the surfaces read `platform` from this and nothing else. The setup
 * card no longer renders the folder list or the three hook commands (the
 * installer's Choose Folder window replaced them); `folders` and the three
 * command strings are still returned because verify/consent-allowlist.mjs pins
 * their shape, and nothing may start treating them as a verdict.
 *
 * ⛔ THERE IS NO `ask` FIELD, AND THAT IS THE POINT. v0.10.0 returned one, and
 * it flipped to false the moment a grant was written — which is how a card that
 * had applied nothing came to look like a completed step. Nothing in a browser
 * can observe whether consent.json exists; whether the hook records is the
 * SERVER's verdict (panelui.js hookSetupState()), derived from rows it wrote.
 *
 * ⛔ `platform` IS PART OF THE STATE, and this is the ONE place it is resolved
 * from chrome.runtime. Both surfaces already await this call before mounting, so
 * resolving it here means the card is built with the real answer rather than
 * with a userAgent guess — and it means the platform arrives at the card as an
 * argument, which is what makes both spellings testable off a single machine.
 */
export async function workFolderState() {
  const folders = await getWorkFolders();
  const platform = await resolvePlatform();
  return {
    folders,
    platform,
    command: renderAllowCommand(folders, platform),
    removeCommand: renderRemoveCommand(folders, platform),
    statusCommand: renderStatusCommand(platform),
  };
}
