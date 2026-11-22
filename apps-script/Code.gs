/**
 * Notification Mirror — Google Apps Script backend
 *
 * Bind this script to a Google Sheet (Extensions → Apps Script).
 *   doPost  ← MacroDroid sends each phone notification here; it is appended to the sheet.
 *   doGet   → the Mac web app reads notifications back as JSON.
 *
 * Every request must carry ?token=<secret>. Run setup() once to create the token.
 */

const SHEET_NAME = 'Notifications';
const HEADERS = ['id', 'received_at', 'app', 'package', 'title', 'text'];
const MAX_TEXT = 5000;        // a Sheets cell holds 50k chars; notifications never need that
const DEDUPE_SECONDS = 90;    // identical app+title+text within this window is stored once

// Packages that are never stored. Add banking / OTP apps here if you don't want them in the sheet.
const BLOCKLIST = [
  'android',
  'com.android.systemui',
  'com.arlosoft.macrodroid',                 // MacroDroid's own notifications (avoids loops)
  'com.samsung.android.app.smartcapture',    // screenshot toasts
];

/** Run once from the editor: creates the sheet + header row and prints your secret token. */
function setup() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(6, 500);
  }
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('TOKEN', token);
  }
  Logger.log('Your secret token: ' + token);
}

/** Receives a notification from the phone. */
function doPost(e) {
  try {
    if (!authorized_(e)) return json_({ ok: false, error: 'unauthorized' });

    const n = parseBody_(e);
    if (!n) return json_({ ok: false, error: 'unreadable body' });
    if (!n.title && !n.text) return json_({ ok: true, skipped: 'empty' });
    if (BLOCKLIST.indexOf(n.package) !== -1) return json_({ ok: true, skipped: 'blocked' });
    if (isDuplicate_(n)) return json_({ ok: true, skipped: 'duplicate' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sheet = getSheet_();
      const row = sheet.getLastRow() + 1;
      if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
      const range = sheet.getRange(row, 1, 1, HEADERS.length);
      // Plain-text format so messages like "=SUM(..." or "+91 98…" are stored verbatim.
      range.setNumberFormats([['@', 'yyyy-mm-dd hh:mm:ss', '@', '@', '@', '@']]);
      range.setValues([[
        Utilities.getUuid().slice(0, 13),
        new Date(),
        n.app, n.package, n.title, n.text,
      ]]);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Returns notifications as JSON.
 *   limit  newest N rows to look at (default 2000, max 20000)
 *   since  only rows received after this epoch-ms timestamp
 */
function doGet(e) {
  try {
    if (!authorized_(e)) return json_({ ok: false, error: 'unauthorized' });
    const p = e.parameter || {};
    const limit = Math.min(Math.max(parseInt(p.limit, 10) || 2000, 1), 20000);
    const since = Number(p.since) || 0;

    const sheet = getSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return json_({ ok: true, rows: [], total: 0, serverTime: Date.now() });

    const start = Math.max(2, last - limit + 1);
    const values = sheet.getRange(start, 1, last - start + 1, HEADERS.length).getValues();
    const rows = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const ts = v[1] instanceof Date ? v[1].getTime() : (Date.parse(v[1]) || 0);
      if (!v[0] || ts <= since) continue;
      rows.push({ id: String(v[0]), ts: ts, app: String(v[2]), pkg: String(v[3]), title: String(v[4]), text: String(v[5]) });
    }
    return json_({ ok: true, rows: rows, total: last - 1, serverTime: Date.now() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ───────────────────────── helpers ─────────────────────────

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function authorized_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  const given = e && e.parameter && e.parameter.token;
  return !!expected && given === expected;
}

/**
 * Accepts JSON, form-encoded, or query-string bodies. MacroDroid pastes notification text
 * into the JSON body without escaping it, so a message containing a quote or line break
 * produces invalid JSON — lenientParse_ recovers those by relying on the fixed key order.
 */
function parseBody_(e) {
  const p = (e && e.parameter) || {};
  const raw = (e && e.postData && e.postData.contents) || '';
  let obj = null;
  if (raw) {
    try { obj = JSON.parse(raw); } catch (_) { obj = lenientParse_(raw); }
  }
  if ((!obj || typeof obj !== 'object') && (p.app || p.title || p.text)) obj = p;
  if (!obj || typeof obj !== 'object') return null;
  const pkg = clean_(obj.package);
  // Group chats (WhatsApp etc.) leave "text" empty and put the messages in big text / text lines,
  // so keep whichever field carries the most content.
  const text = ['text', 'big', 'lines']
    .map(function (k) { return clean_(obj[k]); })
    .reduce(function (best, s) { return s.length > best.length ? s : best; }, '');
  return {
    app: clean_(obj.app) || pkg || 'Unknown',
    package: pkg,
    title: clean_(obj.title),
    text: text.slice(0, MAX_TEXT),
  };
}

const BODY_KEYS = ['app', 'package', 'title', 'text', 'big', 'lines'];

/**
 * Recovers {"key":"value",...} bodies whose values contain raw quotes or line breaks.
 * Each value runs from its "key":" marker to the next known key's marker (or the closing brace).
 */
function lenientParse_(raw) {
  const re = new RegExp('"(' + BODY_KEYS.join('|') + ')"\\s*:\\s*"', 'g');
  const marks = [];
  let m;
  while ((m = re.exec(raw))) marks.push({ key: m[1], start: m.index, valueStart: re.lastIndex });
  // keep only markers that start a field: first one, or preceded by `",` (end of the previous value)
  const fields = marks.filter(function (mk, i) {
    return i === 0 || /"\s*,\s*$/.test(raw.slice(0, mk.start));
  });
  if (!fields.length) return null;
  const out = {};
  fields.forEach(function (f, i) {
    const end = i + 1 < fields.length ? fields[i + 1].start : raw.length;
    let v = raw.slice(f.valueStart, end);
    v = i + 1 < fields.length ? v.replace(/"\s*,\s*$/, '') : v.replace(/"\s*\}\s*$/, '');
    out[f.key] = v;
  });
  return out;
}

/** Trims, and blanks out magic-text placeholders MacroDroid couldn't fill (e.g. "{not_title}"). */
function clean_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^(\[[a-z_]+\]|\{[a-z_]+\})$/i.test(s) ? '' : s;
}

function isDuplicate_(n) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    n.app + '\u0000' + n.title + '\u0000' + n.text,
    Utilities.Charset.UTF_8
  );
  const key = 'd:' + Utilities.base64EncodeWebSafe(digest);
  const cache = CacheService.getScriptCache();
  if (cache.get(key)) return true;
  cache.put(key, '1', DEDUPE_SECONDS);
  return false;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
