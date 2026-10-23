// offscreen.js — classic script. The extension's single offscreen document.
// Two jobs, both things the MV3 service worker can't do itself:
//   1) Downscale a JPEG data URL via a DOM canvas (fallback when OffscreenCanvas is
//      unavailable in the worker).
//   2) QA-capture mode: bundle the captured screenshots + urls + meta into a store-only
//      .zip that is downloaded locally (no network). Consumed by the qa-doc-generator
//      skill on its own, or alongside an optional Loom video if the rep recorded one.
//      NO audio/mic — narration lives in Loom when one exists, or in the completeness
//      Q&A the skill runs otherwise.

// ---------------------------------------------------------------- shared IndexedDB
// SAME database + version the service worker opens (see background.js). The QA stores
// are created by whichever context opens v2 first; we open with the identical upgrade
// so opening here can't race the worker into a version mismatch.
const DB_NAME = 'mm_tt';
const DB_VERSION = 2;
const QA_SHOT_STORE = 'qa_shots';
// qa_audio is a LEGACY store (v2 shipped it for mic narration). Audio was removed in
// v0.5.0 — narration now lives in the paired Loom video. The empty store is still
// created so the DB schema/version stays identical across installs (no migration bump).
const QA_AUDIO_STORE = 'qa_audio';
let dbPromise = null;

function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('shots')) {
          db.createObjectStore('shots', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(QA_SHOT_STORE)) {
          db.createObjectStore(QA_SHOT_STORE, { keyPath: 'seq' });
        }
        if (!db.objectStoreNames.contains(QA_AUDIO_STORE)) {
          db.createObjectStore(QA_AUDIO_STORE, { keyPath: 'seg' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function getAll(storeName) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

// ---------------------------------------------------------------- store-only ZIP writer
// Minimal, dependency-free ZIP (compression method 0 = STORE). Enough for a bundle of
// JPEGs + webm + JSON. 32-bit sizes (a QA bundle is never near 4GB).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const year = Math.max(1980, d.getFullYear());
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

// files: [{ name: string, bytes: Uint8Array }] -> Blob(application/zip)
function buildZip(files) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.bytes;
    const crc = crc32(data);

    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); // local file header sig
    dv.setUint16(4, 20, true);         // version needed
    dv.setUint16(6, 0, true);          // flags
    dv.setUint16(8, 0, true);          // method = store
    dv.setUint16(10, time, true);
    dv.setUint16(12, date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); // compressed size
    dv.setUint32(22, data.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);           // extra len
    lh.set(nameBytes, 30);
    localParts.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); // central dir header sig
    cv.setUint16(4, 20, true);         // version made by
    cv.setUint16(6, 20, true);         // version needed
    cv.setUint16(8, 0, true);          // flags
    cv.setUint16(10, 0, true);         // method = store
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);         // extra len
    cv.setUint16(32, 0, true);         // comment len
    cv.setUint16(34, 0, true);         // disk number start
    cv.setUint16(36, 0, true);         // internal attrs
    cv.setUint32(38, 0, true);         // external attrs
    cv.setUint32(42, offset, true);    // local header offset
    ch.set(nameBytes, 46);
    centralParts.push(ch);

    offset += lh.length + data.length;
  }

  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD sig
  ev.setUint16(4, 0, true);          // disk number
  ev.setUint16(6, 0, true);          // central dir start disk
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);    // central dir offset
  ev.setUint16(20, 0, true);         // comment len

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

function b64ToBytes(b64) {
  const bin = atob(b64 || '');
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pad3(n) { return String(n).padStart(3, '0'); }

// Assemble + download the QA bundle. Reads the click screenshots from QA_SHOT_STORE and
// writes the exact ZIP contract the qa-doc-generator consumes: meta.json (carrying the
// Loom upload_token), urls.json, and screenshots/NNN_<ts_ms>.jpg. NO audio/transcript —
// narration comes from the paired Loom video the rep drops in alongside this .zip.
async function qaBuildZip({ meta, urls, filename }) {
  const enc = new TextEncoder();
  const files = [];

  files.push({ name: 'meta.json', bytes: enc.encode(JSON.stringify(meta || {}, null, 2)) });
  files.push({ name: 'urls.json', bytes: enc.encode(JSON.stringify(urls || [], null, 2)) });

  const shots = (await getAll(QA_SHOT_STORE)).sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const s of shots) {
    if (!s.jpeg_base64) continue;
    files.push({ name: `screenshots/${pad3(s.seq)}_${s.ts_ms}.jpg`, bytes: b64ToBytes(s.jpeg_base64) });
  }

  const zipBlob = buildZip(files);
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'qa-capture.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke lazily so the download has time to start.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 60000);

  return { ok: true, filename: a.download, fileCount: files.length, shots: shots.length };
}

// ---------------------------------------------------------------- who may drive this document
// ⛔ ONLY THIS EXTENSION'S OWN PAGES. chrome.runtime.sendMessage reaches every
// extension context, this document included, so any content script can address
// it — and since 0.11.2 content.js runs in every frame of every page, third-party
// iframes included. Measured 2026-09-28 in Chromium 145: a content script in a
// page's top frame and one in a cross-origin sub-frame both reached this listener
// and were answered. `qa-build-zip` writes a .zip — the member's QA screenshots
// plus whatever meta and file name the message carries — into their Downloads
// folder; no web page may trigger that, or a canvas job.
//
// The worker is the only sender in this build (its sender.url is
// chrome-extension://<id>/background.js, with no tab and no origin field —
// measured); any page of this extension is accepted, nothing else is.
// `sender.url` is filled in by the browser, not by the page, and a content
// script never runs inside an extension page, so no web frame can match. This is
// capture.js's isOwnPageSender(), inlined because this is a classic script;
// verify/offscreen-guard.test.mjs holds the two to the same answers.
const OWN_PAGES = chrome.runtime.getURL('');
function fromOwnPage(sender) {
  return !!sender && typeof OWN_PAGES === 'string' && OWN_PAGES.length > 0 &&
    typeof sender.url === 'string' && sender.url.startsWith(OWN_PAGES);
}

// ---------------------------------------------------------------- message router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (!fromOwnPage(sender)) return false; // a content script, any frame of any page: no answer, nothing done

  if (msg.type === 'downscale') {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = img.width > msg.maxWidth ? msg.maxWidth / img.width : 1;
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/jpeg', msg.quality / 100);
        sendResponse({ base64: out.split(',')[1] });
      } catch (e) {
        sendResponse({ base64: null });
      }
    };
    img.onerror = () => sendResponse({ base64: null });
    img.src = msg.dataUrl;
    return true; // async response
  }

  if (msg.type === 'qa-build-zip') {
    qaBuildZip(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }

  return false;
});
