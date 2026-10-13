/**
 * Carol & Ranel — RSVP backend (free, runs inside your Google Sheet).
 *
 * Sheet tab "Guests", row 1 headers (any order):
 *   ID | Invitation Name | Members | Seats | Status | Attending | Message | Responded At
 *
 * - Fill in Invitation Name, Members (comma-separated) and Seats.
 * - Leave ID blank: it is filled in automatically.
 * - Status / Attending / Message / Responded At are written by the website.
 *   To let a guest change their answer, clear their Status cell.
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 */

const SHEET_NAME = 'Guests';
const DEADLINE = new Date('2026-10-30T23:59:59+08:00');
const MIN_CHARS = 3;
const MAX_RESULTS = 5;
const MAX_MESSAGE = 300;

const COL = {
  id: 'ID', name: 'Invitation Name', members: 'Members', seats: 'Seats',
  status: 'Status', attending: 'Attending', message: 'Message', at: 'Responded At'
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'search') return json_(search_(p.q || ''));
    return json_({ ok: true, closed: isClosed_() });
  } catch (err) {
    return json_({ ok: false, code: 'error', error: String(err) });
  }
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    return json_(rsvp_(p));
  } catch (err) {
    return json_({ ok: false, code: 'error', error: String(err) });
  }
}

// ---------- search ----------
function search_(q) {
  const tokens = norm_(q).split(' ').filter(String);
  if (tokens.join('').length < MIN_CHARS) return { ok: true, closed: isClosed_(), results: [] };

  let table = read_();
  if (table.rows.some(r => r.name && !r.id)) table = assignIds_();
  const results = [];
  for (const row of table.rows) {
    if (!row.name) continue;
    const members = splitMembers_(row.members);
    const words = norm_([row.name].concat(members).join(' ')).split(' ');
    const ok = tokens.every(t => words.some(w => w.indexOf(t) === 0));
    if (!ok) continue;
    const hit = members.find(m => tokens.every(t => norm_(m).split(' ').some(w => w.indexOf(t) === 0)));
    results.push(publicRow_(row, hit));
    if (results.length >= MAX_RESULTS) break;
  }
  return { ok: true, closed: isClosed_(), results: results };
}

// ---------- rsvp ----------
function rsvp_(p) {
  if (isClosed_()) return { ok: false, code: 'closed' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = read_();
    const row = table.rows.find(r => String(r.id) === String(p.id));
    if (!row) return { ok: false, code: 'notfound' };
    if (row.status) return { ok: false, code: 'already', guest: publicRow_(row) };

    const seats = Number(row.seats) || 1;
    const attending = p.attending === true || p.attending === 'yes';
    const count = attending ? Math.max(1, Math.min(seats, parseInt(p.count, 10) || 1)) : 0;
    const message = safeText_(String(p.message || '').slice(0, MAX_MESSAGE));

    const sh = table.sheet, r = row._row, c = table.cols;
    sh.getRange(r, c.status + 1).setValue(attending ? 'Attending' : 'Not attending');
    sh.getRange(r, c.attending + 1).setValue(count);
    sh.getRange(r, c.message + 1).setValue(message);
    sh.getRange(r, c.at + 1).setValue(new Date());
    SpreadsheetApp.flush();

    return { ok: true, status: attending ? 'Attending' : 'Not attending', count: count, seats: seats };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------
function read_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Missing sheet tab "' + SHEET_NAME + '"');
  const values = sheet.getDataRange().getValues();
  const header = values[0].map(h => String(h).trim().toLowerCase());
  const cols = {};
  Object.keys(COL).forEach(k => {
    const i = header.indexOf(COL[k].toLowerCase());
    if (i < 0) throw new Error('Missing column "' + COL[k] + '"');
    cols[k] = i;
  });

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const row = { _row: i + 1 };
    Object.keys(cols).forEach(k => row[k] = v[cols[k]]);
    row.name = String(row.name || '').trim();
    row.status = String(row.status || '').trim();
    rows.push(row);
  }
  return { sheet: sheet, cols: cols, rows: rows };
}

// Give every guest row a stable ID (runs once, under a lock).
function assignIds_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = read_();
    table.rows.forEach(row => {
      if (row.name && !row.id) {
        row.id = 'G' + Utilities.getUuid().slice(0, 8).toUpperCase();
        table.sheet.getRange(row._row, table.cols.id + 1).setValue(row.id);
      }
    });
    SpreadsheetApp.flush();
    return table;
  } finally {
    lock.releaseLock();
  }
}

function publicRow_(row, hit) {
  return {
    id: String(row.id),
    name: row.name,
    members: splitMembers_(row.members),
    seats: Number(row.seats) || 1,
    status: row.status,
    count: Number(row.attending) || 0,
    hit: hit || null
  };
}

function splitMembers_(s) {
  return String(s || '').split(/[,;\n]/).map(x => x.trim()).filter(String);
}

function norm_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// stop guest messages being treated as spreadsheet formulas
function safeText_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isClosed_() {
  return new Date() > DEADLINE;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
