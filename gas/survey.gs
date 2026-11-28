/**
 * Kolhapur Food Survey backend (separate from the Blio shop script in Code.gs).
 * Paste this into Extensions > Apps Script of the "Kolhapur Food Survey" Google Sheet,
 * set the Script property ENTRY_PIN, and deploy as a web app (Execute as: me, Who has access: Anyone).
 *
 * Two callers, two tabs in the same sheet:
 *  - blio.in/survey        the short public survey (action "submit")              -> tab "Online"
 *  - blio.in/survey/entry  typing in the paper forms behind a PIN ("list", "save", "delete") -> tab "Offline"
 * Columns are matched by their header name, so they can be reordered in the sheet; missing ones are added at the end.
 */
var ONLINE_TAB = 'Online', OFFLINE_TAB = 'Offline', OLD_TAB = 'Responses';
var QCOLS = ['q1', 'q2', 'q3', 'q4', 'q4_other', 'q5', 'q6', 'q6_other', 'q7', 'q7_other', 'q8', 'q9', 'q10', 'q11', 'q12', 'q12_other',
  'q13', 'q13_other', 'q14', 'q15', 'q16', 'q17', 'q18', 'q19', 'q19_other', 'q20', 'q20_other', 'q21', 'q22', 'q22_other', 'q23', 'q23_other',
  'q24', 'q25', 'q26', 'q27', 'q28', 'q29', 'q30', 'q31', 'q31_other', 'q32', 'q32_other', 'q33', 'q34', 'q35', 'q36', 'q37', 'q38', 'q39',
  'q40', 'q41', 'q41_other', 'q42', 'q43', 'q44', 'q45', 'q46', 'q46_other', 'q47', 'q47_other'];
var OFFLINE_COLS = ['form_no', 'date', 'team', 'surveyor'].concat(QCOLS, ['needs_check', 'notes', 'submitted_at']);
/* the questions the online survey asks, in the order it asks them */
var ONLINE_Q = ['q1', 'q2', 'q42', 'q3', 'q4', 'q4_other', 'q5', 'q6', 'q6_other', 'q7', 'q7_other', 'q9', 'q11', 'q12', 'q12_other', 'q13', 'q13_other',
  'q14', 'q15', 'q16', 'q17', 'q20', 'q20_other', 'q21', 'q23', 'q23_other', 'q27', 'q29', 'q32', 'q32_other', 'q33', 'q34', 'q37', 'q38', 'q45'];
var ONLINE_COLS = ['submitted_at', 'src', 'lang', 'seconds', 'needs_check'].concat(ONLINE_Q, ['q44', 'consent', 'reward_code']);
var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() { return json_({ ok: true, service: 'kolhapur-survey' }); }

function doPost(e) {
  var o;
  try { o = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad' }); }
  if (o.action === 'submit') {
    if (o.website) return json_({ ok: true });          // hidden field only bots fill in
    return json_(locked_(function () { return submit_(o); }));
  }
  if (['list', 'save', 'delete'].indexOf(o.action) > -1) {
    var bad = pin_(o.pin);
    if (bad) return json_(bad);
    return json_(locked_(function () { return o.action === 'list' ? list_() : o.action === 'save' ? save_(o) : delete_(o); }));
  }
  return json_({ ok: false, error: 'action' });
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { return fn(); } catch (err) { return { ok: false, error: 'server', detail: String(err && err.message || err) }; }
  finally { lock.releaseLock(); }
}

/** Entry PIN from Script properties, with a lockout after 10 wrong tries in 10 minutes. */
function pin_(pin) {
  var want = String(PropertiesService.getScriptProperties().getProperty('ENTRY_PIN') || '').trim();
  if (!want) return { ok: false, error: 'nopin' };
  var cache = CacheService.getScriptCache(), fails = Number(cache.get('pinfail') || 0);
  if (fails >= 10) return { ok: false, error: 'locked' };
  if (String(pin || '').trim() !== want) { cache.put('pinfail', String(fails + 1), 600); return { ok: false, error: 'pin' }; }
  return null;
}

/** A tab with every column in cols present (missing ones are added at the end). Offline falls back to the old "Responses" tab. */
function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || (name === OFFLINE_TAB && ss.getSheetByName(OLD_TAB)) || ss.insertSheet(name);
  var COLS = cols;
  var lastCol = sh.getLastColumn(), head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var missing = COLS.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    var need = head.length + missing.length;
    if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
    sh.setFrozenRows(1);
  }
  var col = {}; head.forEach(function (c, i) { col[c] = i; });
  return { sh: sh, col: col, width: head.length };
}
function rows_(t) {
  var n = t.sh.getLastRow() - 1;
  return n > 0 ? t.sh.getRange(2, 1, n, t.width).getValues() : [];
}
/** Text that cannot turn into a formula, trimmed and capped. */
function cap_(v, max) { return String(v == null ? '' : v).replace(/^[\s=+\-@]+/, '').slice(0, max || 500); }
function cell_(v) { return Array.isArray(v) ? v.map(function (x) { return cap_(x, 120); }).join('; ') : cap_(v); }

function blank_(t) { var r = []; for (var i = 0; i < t.width; i++) r.push(''); return r; }
function put_(t, row, k, v) { if (k in t.col) row[t.col[k]] = v; }
function answers_(t, row, a) {
  a = a && typeof a === 'object' ? a : {};
  QCOLS.forEach(function (k) { if (a[k] != null && a[k] !== '') put_(t, row, k, cell_(a[k])); });
}
function write_(t, rowNo, vals) {
  var rg = t.sh.getRange(rowNo, 1, 1, t.width);
  rg.setNumberFormat('@');
  rg.setValues([vals]);
}
function now_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'); }
function isOffline_(t, r) { var s = t.col.source === undefined ? '' : String(r[t.col.source] || ''); return s === '' || s === 'offline'; }
function online_() { return sheet_(ONLINE_TAB, ONLINE_COLS); }
function offline_() { return sheet_(OFFLINE_TAB, OFFLINE_COLS); }

/* ---------- public online survey ---------- */
function submit_(o) {
  var cache = CacheService.getScriptCache(), n = Number(cache.get('subs') || 0);
  if (n > 60) return { ok: false, error: 'busy' };
  cache.put('subs', String(n + 1), 60);

  var mobile = String(o.mobile || '').replace(/\D/g, '');
  if (mobile.length === 12 && mobile.slice(0, 2) === '91') mobile = mobile.slice(2);
  if (mobile && !/^[6-9]\d{9}$/.test(mobile)) return { ok: false, error: 'mobile' };
  if (mobile && !o.consent) return { ok: false, error: 'consent' };

  var t = online_(), all = rows_(t), codes = {};
  for (var i = 0; i < all.length; i++) {
    var r = all[i], code = String(r[t.col.reward_code] || '');
    if (code) codes[code] = 1;
    if (mobile && String(r[t.col.q44]) === mobile) return { ok: true, code: code, dup: true };
  }
  var newCode = '';
  if (mobile) {
    do { newCode = 'BL'; for (var j = 0; j < 6; j++) newCode += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length)); } while (codes[newCode]);
  }
  var secs = Math.max(0, Math.min(86400, Math.round(Number(o.seconds) || 0)));
  var row = blank_(t);
  var a = o.a && typeof o.a === 'object' ? o.a : {};
  ONLINE_Q.forEach(function (k) { if (a[k] != null && a[k] !== '') put_(t, row, k, cell_(a[k])); });
  put_(t, row, 'q44', mobile);
  put_(t, row, 'src', cap_(o.src || 'direct', 40).replace(/[^A-Za-z0-9_-]/g, ''));
  put_(t, row, 'submitted_at', now_());
  put_(t, row, 'reward_code', newCode);
  put_(t, row, 'consent', mobile ? 'yes' : '');
  put_(t, row, 'seconds', String(secs));
  put_(t, row, 'lang', o.lang === 'en' ? 'en' : 'mr');
  put_(t, row, 'needs_check', secs && secs < 60 ? 'fast' : '');
  write_(t, all.length + 2, row);
  return { ok: true, code: newCode };
}

/* ---------- paper-form entry ---------- */
function list_() {
  var t = offline_(), out = [];
  rows_(t).forEach(function (r) {
    if (!isOffline_(t, r)) return;
    var no = parseInt(r[t.col.form_no], 10);
    if (!no) return;
    var a = {};
    QCOLS.forEach(function (k) { var v = String(r[t.col[k]] == null ? '' : r[t.col[k]]); if (v !== '') a[k] = v; });
    out.push({ no: no, date: String(r[t.col.date] || ''), team: String(r[t.col.team] || ''), surveyor: String(r[t.col.surveyor] || ''),
      check: String(r[t.col.needs_check] || '') !== '', notes: String(r[t.col.notes] || ''), a: a });
  });
  return { ok: true, rows: out };
}
function findForm_(t, all, no) {
  for (var i = 0; i < all.length; i++) if (isOffline_(t, all[i]) && parseInt(all[i][t.col.form_no], 10) === no) return i + 2;
  return 0;
}
function save_(o) {
  var rec = o.rec || {}, no = parseInt(rec.no, 10), edit = parseInt(o.edit, 10) || 0;
  if (!no || no < 1 || no > 99999) return { ok: false, error: 'no' };
  var t = offline_(), all = rows_(t), at = findForm_(t, all, no);
  if (at && edit !== no) return { ok: false, error: 'exists' };
  var row = blank_(t);
  put_(t, row, 'form_no', String(no));
  put_(t, row, 'date', cap_(rec.date, 20));
  put_(t, row, 'team', cap_(rec.team, 40));
  put_(t, row, 'surveyor', cap_(rec.surveyor, 80));
  answers_(t, row, rec.a);
  if (rec.a && rec.a.q44) put_(t, row, 'q44', String(rec.a.q44).replace(/\D/g, '').slice(0, 12));
  put_(t, row, 'needs_check', rec.check ? 'yes' : '');
  put_(t, row, 'notes', cap_(rec.notes, 400));
  put_(t, row, 'submitted_at', now_());
  write_(t, at || all.length + 2, row);
  if (edit && edit !== no) {                                 // the form number was changed: remove the old row
    var old = findForm_(t, rows_(t), edit);
    if (old) t.sh.deleteRow(old);
  }
  return { ok: true };
}
function delete_(o) {
  var no = parseInt(o.no, 10), t = offline_(), at = no ? findForm_(t, rows_(t), no) : 0;
  if (at) t.sh.deleteRow(at);
  return { ok: true, deleted: !!at };
}
