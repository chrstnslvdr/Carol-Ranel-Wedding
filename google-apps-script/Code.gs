/**
 * Carol & Ranel — RSVP backend (free, runs inside your Google Sheet).
 *
 * Sheet tab "Guests": ONE ROW PER PERSON. Row 1 headers (any order):
 *   ID | Invitation | Guest Name | Status | Answered By | Message | Responded At | Table
 *
 * - Invitation: same text for everyone on one invitation. Guests see it as the
 *   card title, e.g. "The Aquino Family" or "Cristina, RB & Winnie".
 * - Guest Name: the person's full name (one seat each).
 * - Table: fill in later when you arrange seating; guests will see it.
 * - Leave ID blank (filled automatically). Status / Answered By / Message /
 *   Responded At are written by the website.
 * - To let someone answer again, clear their Status cell.
 *
 * Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 */

const SHEET_NAME = 'Guests';
const DEADLINE = new Date('2026-10-30T23:59:59+08:00');
const MIN_CHARS = 3;
const MAX_RESULTS = 5;
const MAX_MESSAGE = 300;
const ATTENDING = 'Attending';
const NOT_ATTENDING = 'Not attending';

const COL = {
  id: 'ID', invitation: 'Invitation', name: 'Guest Name', status: 'Status',
  answeredBy: 'Answered By', message: 'Message', at: 'Responded At', table: 'Table'
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
    return json_(rsvp_(JSON.parse(e.postData.contents)));
  } catch (err) {
    return json_({ ok: false, code: 'error', error: String(err) });
  }
}

// ---------- search: returns matching invitations (max 5) ----------
function search_(q) {
  const tokens = norm_(q).split(' ').filter(String);
  if (tokens.join('').length < MIN_CHARS) return { ok: true, closed: isClosed_(), results: [] };

  let table = read_();
  if (table.rows.some(r => r.name && !r.id)) table = assignIds_();

  const matches = (text) => {
    const words = norm_(text).split(' ');
    return tokens.every(t => words.some(w => w.indexOf(t) === 0));
  };

  const groups = groupRows_(table.rows);
  const results = [];
  for (const key of Object.keys(groups)) {
    const rows = groups[key];
    const hitRow = rows.find(r => matches(r.name));
    if (!hitRow && !matches(key)) continue;
    results.push(publicGroup_(key, rows, hitRow ? hitRow.name : null));
    if (results.length >= MAX_RESULTS) break;
  }
  return { ok: true, closed: isClosed_(), results: results };
}

// ---------- rsvp: answer some or all names on one invitation ----------
// payload: { invitation, answeredBy, message, answers: [{ id, attending }] }
function rsvp_(p) {
  if (isClosed_()) return { ok: false, code: 'closed' };
  const answers = Array.isArray(p.answers) ? p.answers : [];
  if (!answers.length) return { ok: false, code: 'empty' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = read_();
    const key = String(p.invitation || '').trim();
    const rows = table.rows.filter(r => r.invitation === key && r.name);
    if (!rows.length) return { ok: false, code: 'notfound' };

    const answeredBy = rows.some(r => r.name === p.answeredBy) ? p.answeredBy : '';
    const message = safeText_(String(p.message || '').trim().slice(0, MAX_MESSAGE));
    const now = new Date();
    const saved = [], skipped = [];

    answers.forEach(a => {
      const row = rows.find(r => String(r.id) === String(a.id));
      if (!row || saved.indexOf(row) >= 0) return;
      if (row.status) { skipped.push(row.name); return; } // someone already answered for them
      row.status = a.attending ? ATTENDING : NOT_ATTENDING;
      row.answeredBy = answeredBy;
      saved.push(row);
    });

    // keep the message once: on the answerer's row if they answered now, else the first saved row
    const msgRow = saved.find(r => r.name === answeredBy) || saved[0];
    const c = table.cols, sh = table.sheet;
    saved.forEach(row => {
      sh.getRange(row._row, c.status + 1).setValue(row.status);
      sh.getRange(row._row, c.answeredBy + 1).setValue(answeredBy);
      sh.getRange(row._row, c.at + 1).setValue(now);
      if (row === msgRow && message) sh.getRange(row._row, c.message + 1).setValue(message);
    });
    SpreadsheetApp.flush();

    return { ok: true, saved: saved.map(r => r.name), skipped: skipped, group: publicGroup_(key, rows, null) };
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
    ['invitation', 'name', 'status', 'answeredBy', 'table'].forEach(k => row[k] = String(row[k] || '').trim());
    if (!row.invitation) row.invitation = row.name; // a guest alone on their invitation
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

function groupRows_(rows) {
  const groups = {};
  rows.forEach(r => {
    if (!r.name) return;
    (groups[r.invitation] = groups[r.invitation] || []).push(r);
  });
  return groups;
}

function publicGroup_(key, rows, hit) {
  return {
    invitation: key,
    hit: hit,
    guests: rows.map(r => ({
      id: String(r.id), name: r.name, status: r.status, answeredBy: r.answeredBy, table: r.table
    }))
  };
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
