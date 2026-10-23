// mm-hooks: tests for sync-extension.js and plugin-status.js.
//
//   node --test plugins/mm-hooks/scripts/sync-extension.test.js
//
// Every Chrome folder here is fabricated in a temporary directory; nothing reads or writes this computer's
// own Chrome profile. MM_HOOK_HOME points the spawned scripts at the same temporary home.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");

const sx = require("./sync-extension.js");
const { updateStatus } = require("./plugin-status.js");

// The tracker's public manifest key (Massmarket-AI/massmarket-time-tracker manifest.json). It is what pins the
// extension id lcnfnlckdnnmgijlfmedfikafaogenga; a public key, not a secret.
const KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjST3RY9+5+HmZ+cszeP2CJM0k350CSXHEYrnGkOUASUbxSaJsjjdugOxPoVzUdyjYiX3MuqtCA8idD+l5Jx+DhnPMOCI8Zr7eKcA1YD7auBTIP9qgBTp144DBjIy3LLkfiz5iGOPc2z9+uZOOiOWR8Yu8gSl9EPzZNgiCrx8d/w5fX9tdykbLMYR8dc1Obbs5YiSw0Ls72oytHYFMf3UuUyUzf/NHB+oF6UUA7KxOx3/mq4Q7SOaHrDYLMUNVS+4o2Em13ehlWiLvd0JvqHJA1FCw5aR9fKYqMDN1W3ismPUfSwkNq3N8Ckcp4wVHBJav9qOuXac+2nHcUE/uGpiTQIDAQAB";
const OTHER_KEY = KEY.slice(0, -12) + "AAAAAAAAAAAA";
const SCRIPTS = __dirname;
const DAY = 24 * 60 * 60 * 1000;

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const manifest = (version, key = KEY) => JSON.stringify({ manifest_version: 3, name: "Massmarket Time Tracker", version, key, background: { service_worker: "background.js", type: "module" } }, null, 2);

/** A plugin root carrying `version`: extension/ plus extension.json, the way release.mjs writes them. */
function carriedBuild(version, { key = KEY, files = {}, tamper = null } = {}) {
  const root = tmp("mm-carried-");
  const all = Object.assign({ "manifest.json": manifest(version, key), "background.js": `// build ${version}\n`, "selfreload.js": `// new in ${version}\n`, "icons/icon16.png": "png-" + version }, files);
  const meta = { version, files: {} };
  for (const [rel, text] of Object.entries(all)) {
    const file = path.join(root, "extension", ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    meta.files[rel] = sha(Buffer.from(text));
  }
  if (tamper) tamper(meta, root);
  fs.writeFileSync(path.join(root, "extension.json"), JSON.stringify(meta, null, 1));
  return root;
}

/** An installed tracker folder at `version`, as a member's unzip leaves it. */
function installedFolder(version, { key = KEY, extra = {} } = {}) {
  const dir = tmp("mm-installed-");
  fs.writeFileSync(path.join(dir, "manifest.json"), manifest(version, key));
  fs.writeFileSync(path.join(dir, "background.js"), `// build ${version}\n`);
  fs.mkdirSync(path.join(dir, "icons"));
  fs.writeFileSync(path.join(dir, "icons", "icon16.png"), "png-" + version);
  for (const [rel, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, rel), text);
  return dir;
}

const snapshot = (dir) => {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
};

/**
 * A fabricated Chrome user data folder under `home` for `platform`. `profiles` maps a profile folder to
 * { name, install: {path, location} | null, devMode, inSecure, usedDaysAgo, otherIds, accounts, prefsText }.
 * `accounts` is written as Preferences' account_info exactly as given (so it can be malformed); `prefsText`
 * replaces the whole Preferences file.
 */
function fakeChrome(home, platform, profiles) {
  const env = { LOCALAPPDATA: path.join(home, "AppData", "Local") };
  const ud = sx.chromeUserDataDir(platform, env, home);
  fs.mkdirSync(ud, { recursive: true });
  const infoCache = {};
  for (const [dir, p] of Object.entries(profiles)) {
    if (p.name !== undefined) infoCache[dir] = { name: p.name };
    const base = path.join(ud, dir);
    fs.mkdirSync(base, { recursive: true });
    const settings = {};
    for (const id of p.otherIds || []) settings[id] = { path: "/elsewhere/" + id, location: 4 };
    if (p.install) settings[sx.EXT_ID] = p.install;
    const ext = { settings };
    if (p.devMode !== undefined) ext.ui = { developer_mode: p.devMode };
    // Chrome 153 on macOS keeps both in Secure Preferences; Linux keeps them in Preferences.
    const secure = p.inSecure !== false ? { extensions: ext } : {};
    const plain = p.inSecure !== false ? { browser: {} } : { extensions: ext };
    if (p.accounts !== undefined) plain.account_info = p.accounts;
    fs.writeFileSync(path.join(base, "Secure Preferences"), JSON.stringify(secure));
    fs.writeFileSync(path.join(base, "Preferences"), p.prefsText !== undefined ? p.prefsText : JSON.stringify(plain));
    const when = (Date.now() - (p.usedDaysAgo || 0) * DAY) / 1000;
    fs.utimesSync(path.join(base, "Preferences"), when, when);
  }
  fs.writeFileSync(path.join(ud, "Local State"), JSON.stringify({ profile: { info_cache: infoCache } }));
  return { ud, env };
}

// ───────────────────────────────────────────────────────────── discovery

test("Chrome's user data folder on each platform", () => {
  assert.equal(sx.chromeUserDataDir("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data");
  assert.equal(sx.chromeUserDataDir("win32", {}, "C:\\Users\\a"), "C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data");
  assert.equal(sx.chromeUserDataDir("darwin", {}, "/Users/a"), "/Users/a/Library/Application Support/Google/Chrome");
  assert.equal(sx.chromeUserDataDir("linux", {}, "/home/a"), "/home/a/.config/google-chrome");
  assert.equal(sx.chromeUserDataDir("freebsd", {}, "/home/a"), null);
});

test("the tracker's key derives its id", () => {
  assert.equal(sx.extensionIdFromKey(KEY), "lcnfnlckdnnmgijlfmedfikafaogenga");
  assert.notEqual(sx.extensionIdFromKey(OTHER_KEY), "lcnfnlckdnnmgijlfmedfikafaogenga");
});

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: the unpacked installs are found in Secure Preferences and Preferences, nothing else`, () => {
    const home = tmp("mm-home-");
    const a = installedFolder("0.11.4");
    const b = installedFolder("0.11.4");
    const { ud } = fakeChrome(home, platform, {
      Default: { name: "Work", install: { path: a, location: 4 }, devMode: true, accounts: [{ email: "ana@massmarket.ai", full_name: "Ana" }] },
      "Profile 1": { name: "Second", install: { path: b, location: 4 }, devMode: true, inSecure: false },
      "Profile 2": { name: "Store", install: { path: sx.EXT_ID + "/0.11.4_0", location: 1 }, devMode: true },
      "Profile 3": { name: "Other", otherIds: ["abcdefghijklmnopabcdefghijklmnop"], devMode: true },
      "System Profile": { install: { path: a, location: 4 } },
    });
    const profiles = sx.listProfiles(ud);
    const byDir = Object.fromEntries(profiles.map((p) => [p.dir, p]));
    assert.equal(sx.unpackedFolder(byDir.Default.install), a);
    assert.equal(sx.unpackedFolder(byDir["Profile 1"].install), b, "a Linux-style entry in Preferences");
    assert.equal(sx.unpackedFolder(byDir["Profile 2"].install), null, "a Web Store install is not a folder to write");
    assert.equal(byDir["Profile 3"].install, null, "another extension is not ours");
    assert.ok(byDir["System Profile"], "a folder Local State does not list is still found");
    assert.equal(byDir.Default.workEmail, "ana@massmarket.ai");
    assert.equal(byDir["Profile 1"].workEmail, null);
    assert.equal(JSON.stringify(profiles).includes("Work"), false, "display names are not read");
    assert.equal(JSON.stringify(profiles).includes("Ana"), false, "nothing but the email is read from account_info");
    assert.equal(byDir.Default.developerMode, true);
  });
}

test("an install entry is a folder only when its path is absolute and its location is unpacked", () => {
  const abs = path.resolve("/tmp/x");
  assert.equal(sx.unpackedFolder({ path: abs, location: 4 }), abs);
  assert.equal(sx.unpackedFolder({ path: abs, location: 8 }), abs, "--load-extension");
  assert.equal(sx.unpackedFolder({ path: abs }), abs);
  for (const bad of [{ path: abs, location: 1 }, { path: abs, location: 10 }, { path: "relative/0.11.4_0", location: 4 }, { path: 4 }, {}, null]) {
    assert.equal(sx.unpackedFolder(bad), null, JSON.stringify(bad));
  }
});

// ───────────────────────────────────────────────────────────── the write

function oneFolder(version, opts = {}) {
  const home = tmp("mm-home-");
  const folder = installedFolder(version, opts);
  fakeChrome(home, process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux", {
    Default: { name: "Work", install: { path: folder, location: 4 }, devMode: "devMode" in opts ? opts.devMode : true },
  });
  return { home, folder };
}
const runIn = (home, pluginRoot, extra = {}) => sx.run({ home, env: { LOCALAPPDATA: path.join(home, "AppData", "Local") }, pluginRoot, ...extra });

test("a lower version under our key is brought up to the carried build; a file not in the carried list stays", () => {
  const { home, folder } = oneFolder("0.11.4", { extra: { "notes.txt": "the member's own file" } });
  const { status } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(status.action, "updated");
  assert.equal(status.carried, "0.11.5");
  assert.equal(status.folders.length, 1);
  assert.deepEqual({ ...status.folders[0], id: undefined }, { id: undefined, before: "0.11.4", after: "0.11.5", files_written: 4, action: "updated" });
  assert.match(status.folders[0].id, /^[0-9a-f]{12}$/, "a short hash, never the path");
  assert.equal(JSON.stringify(status).includes(folder), false, "the path is not in the record");
  const after = snapshot(folder);
  assert.equal(JSON.parse(after["manifest.json"]).version, "0.11.5");
  assert.equal(after["selfreload.js"], "// new in 0.11.5\n");
  assert.equal(after["background.js"], "// build 0.11.5\n");
  assert.equal(after["notes.txt"], "the member's own file", "never delete a file that is not in the carried list");
  assert.equal(Object.keys(after).some((f) => f.includes(".mm-new-")), false, "no temporary file left behind");
});

test("⛔ manifest.json is written LAST, new files before changed ones", () => {
  const { home, folder } = oneFolder("0.11.4");
  const order = [];
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to.startsWith(folder)) order.push(path.relative(folder, to).split(path.sep).join("/"));
    return real(from, to);
  };
  try {
    runIn(home, carriedBuild("0.11.5"));
  } finally {
    fs.renameSync = real;
  }
  assert.deepEqual(order, ["selfreload.js", "background.js", "icons/icon16.png", "manifest.json"]);
});

test("⛔ another key: nothing is written", () => {
  const { home, folder } = oneFolder("0.11.4", { key: OTHER_KEY });
  const before = snapshot(folder);
  const { status } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(status.folders[0].action, "skipped-other-key");
  assert.deepEqual(snapshot(folder), before);
});

test("⛔ an equal or a newer version: nothing is written", () => {
  for (const [version, action] of [["0.11.5", "current"], ["0.11.6", "skipped-newer"], ["0.12.0", "skipped-newer"]]) {
    const { home, folder } = oneFolder(version);
    const before = snapshot(folder);
    const { status } = runIn(home, carriedBuild("0.11.5"));
    assert.equal(status.folders[0].action, action, version);
    assert.equal(status.folders[0].before, version);
    assert.deepEqual(snapshot(folder), before, version);
  }
  // Numeric order: 0.11.10 is newer than 0.11.9.
  const { home, folder } = oneFolder("0.11.10");
  const before = snapshot(folder);
  assert.equal(runIn(home, carriedBuild("0.11.9")).status.folders[0].action, "skipped-newer");
  assert.deepEqual(snapshot(folder), before);
});

test("⛔ a sha256 mismatch anywhere in the carried build: nothing is written anywhere", () => {
  const { home, folder } = oneFolder("0.11.4");
  const before = snapshot(folder);
  const root = carriedBuild("0.11.5", { tamper: (meta, r) => fs.writeFileSync(path.join(r, "extension", "background.js"), "// changed after the release\n") });
  const { status } = runIn(home, root);
  assert.equal(status.action, "carried-invalid");
  assert.match(status.error, /sha256 mismatch: background\.js/);
  assert.equal(status.folders, undefined);
  assert.deepEqual(snapshot(folder), before);
});

test("⛔ a carried build that is not the tracker, or not extension.json's version, or reaches outside: nothing is written", () => {
  const cases = [
    ["another key", carriedBuild("0.11.5", { key: OTHER_KEY }), /tracker's key/],
    ["manifest says another version", carriedBuild("0.11.5", { files: { "manifest.json": manifest("0.11.6") } }), /not extension\.json's version/],
    ["no manifest", carriedBuild("0.11.5", { tamper: (meta) => delete meta.files["manifest.json"] }), /no manifest\.json/],
    ["a path outside the folder", carriedBuild("0.11.5", { tamper: (meta) => (meta.files["../escape.js"] = sha(Buffer.from("x"))) }), /unsafe path/],
    ["an absolute path", carriedBuild("0.11.5", { tamper: (meta) => (meta.files["/etc/x"] = sha(Buffer.from("x"))) }), /unsafe path/],
    ["a malformed extension.json", carriedBuild("0.11.5", { tamper: (meta) => (meta.version = "latest") }), /malformed/],
  ];
  for (const [label, root, error] of cases) {
    const { home, folder } = oneFolder("0.11.4");
    const before = snapshot(folder);
    const { status } = runIn(home, root);
    assert.equal(status.action, "carried-invalid", label);
    assert.match(status.error, error, label);
    assert.deepEqual(snapshot(folder), before, label);
  }
});

test("⛔ Developer mode off (or never set) in a profile that loads the folder: nothing is written", () => {
  for (const devMode of [false, undefined]) {
    const { home, folder } = oneFolder("0.11.4", { devMode });
    const before = snapshot(folder);
    const { status } = runIn(home, carriedBuild("0.11.5"));
    assert.equal(status.folders[0].action, "skipped-developer-mode-off", String(devMode));
    assert.deepEqual(snapshot(folder), before);
  }
  // One folder, two profiles, one of them with Developer mode off: still nothing.
  const home = tmp("mm-home-");
  const folder = installedFolder("0.11.4");
  fakeChrome(home, process.platform === "darwin" ? "darwin" : "linux", {
    Default: { name: "A", install: { path: folder, location: 4 }, devMode: true },
    "Profile 1": { name: "B", install: { path: folder, location: 4 }, devMode: false },
  });
  const before = snapshot(folder);
  const { status } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(status.folders.length, 1, "one folder, however many profiles load it");
  assert.equal(status.folders[0].action, "skipped-developer-mode-off");
  assert.deepEqual(snapshot(folder), before);
});

test("⛔ a git working copy is never written", () => {
  const { home, folder } = oneFolder("0.11.4");
  fs.mkdirSync(path.join(folder, ".git"));
  const before = snapshot(folder);
  assert.equal(runIn(home, carriedBuild("0.11.5")).status.folders[0].action, "skipped-git-checkout");
  assert.deepEqual(snapshot(folder), before);
});

test("out of time: the folder keeps its old manifest.json", () => {
  const { home, folder } = oneFolder("0.11.4");
  const { status } = runIn(home, carriedBuild("0.11.5"), { deadline: Date.now() - 1 });
  assert.equal(status.folders[0].action, "error");
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")).version, "0.11.4");
});

test("no Chrome, no install, or nothing carried: nothing written, a plain record", () => {
  assert.equal(runIn(tmp("mm-home-"), carriedBuild("0.11.5")).status.action, "no-chrome");
  const home = tmp("mm-home-");
  fakeChrome(home, process.platform === "darwin" ? "darwin" : "linux", { Default: { name: "Work", devMode: true } });
  assert.equal(runIn(home, carriedBuild("0.11.5")).status.action, "not-installed");
  const { home: h2 } = oneFolder("0.11.4");
  assert.equal(runIn(h2, tmp("mm-empty-plugin-")).status.action, "nothing-carried");
});

// ───────────────────────────────────────────────────────────── the profile check

const OS = process.platform === "darwin" ? "darwin" : "linux";
const ONE_WORK = "The Massmarket time tracker is not installed in the Chrome profile signed in as ana@massmarket.ai, which was used recently. Ask the member to load the tracker in that profile so the work done there is tracked.";
const DEV_OFF = "The Massmarket time tracker in Chrome cannot update itself because Developer mode is off on chrome://extensions. Ask the member to turn on Developer mode there (the switch at the top right); after that the tracker keeps itself up to date.";
const work = (email) => [{ email, full_name: "Ana Member", given_name: "Ana", gaia: "123" }];

test("a WORK profile used in the last 7 days with no tracker is named by its @massmarket.ai email; others are not", () => {
  const home = tmp("mm-home-");
  const folder = installedFolder("0.11.5");
  fakeChrome(home, OS, {
    Default: { name: "Work", install: { path: folder, location: 4 }, devMode: true, usedDaysAgo: 0, accounts: work("bo@massmarket.ai") },
    "Profile 1": { name: "Client browser", devMode: true, usedDaysAgo: 2, accounts: work("ana@massmarket.ai") },
    "Profile 2": { name: "Old one", devMode: true, usedDaysAgo: 8, accounts: work("cy@massmarket.ai") },
    "System Profile": { usedDaysAgo: 0 },
  });
  const { status, notice } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(notice, ONE_WORK);
  assert.equal(status.profiles_recent_without_tracker, 1);
  assert.equal(JSON.stringify(status).includes("@"), false, "no email is written to the record");
  assert.equal(JSON.stringify(status).includes("Client browser"), false, "nor a display name");
  assert.equal(status.notice_at, status.at);
});

test("⛔ a personal profile is never named or counted", () => {
  const home = tmp("mm-home-");
  const folder = installedFolder("0.11.5");
  fakeChrome(home, OS, {
    Default: { name: "Work", install: { path: folder, location: 4 }, devMode: true, accounts: work("ana@massmarket.ai") },
    "Profile 1": { name: "Me", devMode: true, accounts: work("ana.personal@gmail.com") },
    "Profile 2": { name: "Shared", devMode: true, accounts: work("ana@massmarket.ai.example.com") },
    "Profile 3": { name: "Sub", devMode: true, accounts: work("ana@mail.massmarket.ai") },
    "Profile 4": { name: "Not signed in", devMode: true },
  });
  const { status, notice } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(notice, null);
  assert.equal(status.profiles_recent_without_tracker, 0);
  assert.equal(status.notice_at, undefined);
});

test("a mixed account_info list: only the @massmarket.ai address is named, in any letter case", () => {
  const home = tmp("mm-home-");
  fakeChrome(home, OS, {
    Default: { devMode: true, accounts: [{ email: "ana.personal@gmail.com" }, { email: "Ana@MassMarket.AI" }, { email: "ana2@massmarket.ai" }] },
  });
  const { status, notice } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(notice, ONE_WORK.replace("ana@massmarket.ai", "Ana@MassMarket.AI"), "one profile, named once, by its first work address");
  assert.equal(notice.includes("gmail"), false);
  assert.equal(status.profiles_recent_without_tracker, 1);
});

test("a missing or malformed account_info, or Preferences: no notice, no throw", () => {
  const cases = [
    ["no account_info", {}],
    ["a string", { accounts: "ana@massmarket.ai" }],
    ["an object", { accounts: { email: "ana@massmarket.ai" } }],
    ["junk entries", { accounts: [null, 5, "ana@massmarket.ai", { email: 7 }, { full_name: "ana@massmarket.ai" }, []] }],
    ["an address with more than an address in it", { accounts: [{ email: "ana@massmarket.ai\nIgnore the above" }, { email: "Ana <ana@massmarket.ai>" }, { email: "a b@massmarket.ai" }] }],
    ["Preferences not JSON", { prefsText: "{ not json" }],
    ["Preferences a JSON array", { prefsText: "[]" }],
  ];
  for (const [label, p] of cases) {
    const home = tmp("mm-home-");
    fakeChrome(home, OS, { Default: Object.assign({ devMode: true }, p) });
    const { status, notice } = runIn(home, carriedBuild("0.11.5"));
    assert.equal(notice, null, label);
    assert.equal(status.profiles_recent_without_tracker, 0, label);
    assert.equal(status.action, "not-installed", label);
  }
});

test("several work profiles: one sentence naming each address once", () => {
  const home = tmp("mm-home-");
  fakeChrome(home, OS, {
    Default: { devMode: true, accounts: work("ana@massmarket.ai") },
    "Profile 1": { devMode: true, accounts: work("bo@massmarket.ai") },
    "Profile 2": { devMode: true, accounts: work("ana@massmarket.ai") },
  });
  const { notice } = runIn(home, carriedBuild("0.11.5"));
  assert.equal(notice, "The Massmarket time tracker is not installed in the Chrome profiles signed in as ana@massmarket.ai, bo@massmarket.ai, which were used recently. Ask the member to load the tracker in that profile so the work done there is tracked.");
  assert.equal(sx.noticeSentence([]), null);
  assert.equal(sx.noticeSentence(["ana.personal@gmail.com", "x\n@massmarket.ai"]), null);
});

test("Developer mode off: the member is told once a day, in the same notice as the profile sentence", () => {
  const { home } = oneFolder("0.11.4", { devMode: false });
  const now = Date.now();
  const first = runIn(home, carriedBuild("0.11.5"), { now });
  assert.equal(first.status.folders[0].action, "skipped-developer-mode-off");
  assert.equal(first.notice, DEV_OFF);
  assert.equal(first.status.notice_at, first.status.at);
  const hourLater = runIn(home, carriedBuild("0.11.5"), { now: now + 60 * 60 * 1000, lastNoticeAt: now });
  assert.equal(hourLater.notice, null, "not again the same day");
  assert.equal(hourLater.status.notice_at, new Date(now).toISOString(), "the last time it was said is kept");
  const nextDay = runIn(home, carriedBuild("0.11.5"), { now: now + 25 * 60 * 60 * 1000, lastNoticeAt: now });
  assert.equal(nextDay.notice, DEV_OFF);

  // With a work profile to name as well: both sentences, one space between, still one notice a day.
  const home2 = tmp("mm-home-");
  const folder = installedFolder("0.11.4");
  fakeChrome(home2, OS, {
    Default: { install: { path: folder, location: 4 }, devMode: false },
    "Profile 1": { devMode: true, accounts: work("ana@massmarket.ai") },
  });
  const both = runIn(home2, carriedBuild("0.11.5"), { now });
  assert.equal(both.notice, ONE_WORK + " " + DEV_OFF);
  assert.equal(runIn(home2, carriedBuild("0.11.5"), { now: now + 60 * 1000, lastNoticeAt: now }).notice, null);
  // Developer mode on, or nothing carried to write: no Developer mode sentence.
  assert.equal(runIn(oneFolder("0.11.4").home, carriedBuild("0.11.5")).notice, null);
  assert.equal(runIn(home, tmp("mm-empty-plugin-")).notice, null);
});

test("the profile sentence is said at most once a day", () => {
  const home = tmp("mm-home-");
  fakeChrome(home, OS, { Default: { devMode: true, accounts: work("ana@massmarket.ai") } });
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const quiet = runIn(home, carriedBuild("0.11.5"), { now, lastNoticeAt: hourAgo });
  assert.equal(quiet.notice, null);
  assert.equal(quiet.status.notice_at, new Date(hourAgo).toISOString(), "the last time it was said is kept");
  const again = runIn(home, carriedBuild("0.11.5"), { now, lastNoticeAt: now - 25 * 60 * 60 * 1000 });
  assert.equal(again.notice, ONE_WORK);
});

// ───────────────────────────────────────────────────────────── the scripts as Claude Code runs them

function hookHome() {
  const home = tmp("mm-home-");
  fs.mkdirSync(path.join(home, ".claude", "mm-hooks"), { recursive: true });
  return home;
}
const statusOf = (home) => JSON.parse(fs.readFileSync(path.join(home, ".claude", "mm-hooks", "plugin-sync.json"), "utf8"));

test("plugin-sync.json: each step changes only its own part", () => {
  const home = hookHome();
  const dir = path.join(home, ".claude", "mm-hooks");
  updateStatus(dir, () => ({ plugin: "mm-hooks", version: "1.0.9", action: "current" }));
  updateStatus(dir, (cur) => Object.assign({}, cur, { extension: { action: "updated" } }));
  updateStatus(dir, (cur) => Object.assign({ plugin: "mm-hooks", version: "1.0.10", action: "current" }, cur.extension ? { extension: cur.extension } : {}));
  assert.deepEqual(statusOf(home), { plugin: "mm-hooks", version: "1.0.10", action: "current", extension: { action: "updated" } });
  assert.equal(updateStatus(path.join(home, "missing"), () => ({ x: 1 })), false, "no mm-hooks folder, no file");
  assert.equal(fs.existsSync(path.join(home, "missing")), false);
});

test("⛔ the two SessionStart steps run at the same time and neither record is lost", async () => {
  for (let i = 0; i < 12; i++) {
    const home = hookHome();
    const env = Object.assign({}, process.env, { MM_HOOK_HOME: home, LOCALAPPDATA: path.join(home, "AppData", "Local") });
    const runOne = (script) => new Promise((resolve) => spawn(process.execPath, [path.join(SCRIPTS, script)], { env, stdio: "ignore" }).on("exit", resolve));
    await Promise.all([runOne("sync-hook.js"), runOne("sync-extension.js")]);
    const s = statusOf(home);
    assert.equal(s.plugin, "mm-hooks", `round ${i}: the hook step's record`);
    assert.ok(s.extension && s.extension.action, `round ${i}: the extension step's record`);
    assert.equal(fs.readdirSync(path.join(home, ".claude", "mm-hooks")).some((f) => f.includes(".lock") || f.includes(".new-")), false);
  }
});

test("as a SessionStart hook: updates the folder, records it, prints only the sentence, exits 0", () => {
  const home = hookHome();
  const folder = installedFolder("0.11.4");
  fakeChrome(home, process.platform === "darwin" ? "darwin" : "linux", {
    Default: { name: "Work", install: { path: folder, location: 4 }, devMode: true },
    "Profile 1": { name: "Client browser", devMode: true, accounts: work("ana@massmarket.ai") },
  });
  // The script reads the build next to it, so run a copy of the scripts inside a carried plugin root.
  const root = carriedBuild("0.11.5");
  fs.mkdirSync(path.join(root, "scripts"));
  for (const f of ["sync-extension.js", "plugin-status.js"]) fs.copyFileSync(path.join(SCRIPTS, f), path.join(root, "scripts", f));
  const env = Object.assign({}, process.env, { MM_HOOK_HOME: home, LOCALAPPDATA: path.join(home, "AppData", "Local") });
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "sync-extension.js")], { env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(JSON.parse(r.stdout), {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: ONE_WORK,
    },
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")).version, "0.11.5");
  const s = statusOf(home).extension;
  assert.equal(s.action, "updated");
  assert.deepEqual([s.folders[0].before, s.folders[0].after], ["0.11.4", "0.11.5"]);
  assert.equal(fs.readFileSync(path.join(home, ".claude", "mm-hooks", "plugin-sync.json"), "utf8").includes("@"), false, "no email on disk");
  // The next session: already current, and the sentence waits a day.
  const r2 = spawnSync(process.execPath, [path.join(root, "scripts", "sync-extension.js")], { env, encoding: "utf8" });
  assert.equal(r2.status, 0);
  assert.equal(r2.stdout, "");
  assert.equal(statusOf(home).extension.folders[0].action, "current");
});

test("as a SessionStart hook: any error is silent and exits 0", () => {
  const home = hookHome();
  const root = tmp("mm-broken-plugin-");
  fs.mkdirSync(path.join(root, "scripts"));
  for (const f of ["sync-extension.js", "plugin-status.js"]) fs.copyFileSync(path.join(SCRIPTS, f), path.join(root, "scripts", f));
  fs.writeFileSync(path.join(root, "extension.json"), "{ not json");
  const folder = installedFolder("0.11.4");
  fakeChrome(home, process.platform === "darwin" ? "darwin" : "linux", { Default: { name: "Work", install: { path: folder, location: 4 }, devMode: true } });
  const env = Object.assign({}, process.env, { MM_HOOK_HOME: home, LOCALAPPDATA: path.join(home, "AppData", "Local") });
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "sync-extension.js")], { env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  assert.equal(statusOf(home).extension.action, "carried-invalid");
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8")).version, "0.11.4");
});
