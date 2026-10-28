/**
 * Blio admin: Google Apps Script behind the Blio web app (blio.in).
 * Lives in the Blio admin Google Sheet (Extensions > Apps Script), deployed as a web app.
 *
 * GET                     products with price, availability and kg left for the current order window
 * GET  ?action=deliveries orders to deliver (needs the delivery PIN)
 * GET  ?action=myorders   status of a customer's own orders (each order needs its secret token)
 * POST order              saves an order after checking stock; prices always come from the sheet
 * POST action=start       rider starts the round: orders become Out for delivery (needs the delivery PIN)
 * POST action=next        rider's next stop: that order becomes Arriving next (needs the delivery PIN)
 * POST action=delivered   marks an order Delivered (needs the delivery PIN)
 * POST action=admin       Blio Admin app (blio.in/admin): load, order, product, settings, bill (needs the admin password)
 * Sheet menu Blio > Make bill for selected order   PDF bill in Drive plus a WhatsApp link to send it
 */

var TZ = 'Asia/Kolkata';
var ORDER_DAYS = [1, 3, 6];   // Monday, Wednesday, Saturday (0 = Sunday)
var CLOSE_HOUR = 18;          // orders close at 6 PM
var GROUPS = ['Fish', 'Prawns', 'Crabs and clams', 'Dried'];
var PACKS = { '500 g': 0.5, '1 kg': 1 };
var MAX_QTY = 20;
var ORDER_COLS = ['Order ID', 'Placed at', 'Window', 'Name', 'Mobile', 'Address', 'Area', 'Items', 'Subtotal', 'Delivery',
  'Total', 'Status', 'Notes', 'Map', 'Final amount', 'Bill', 'Delivered at', 'Token', 'Payment', 'Out at', 'Next at'];
var STATUSES = ['New', 'Confirmed', 'Packed', 'Out for delivery', 'Arriving next', 'Delivered', 'Cancelled'];
var TO_DELIVER = ['Confirmed', 'Packed', 'Out for delivery', 'Arriving next', 'Paid'];   // 'Paid' kept for orders from before the Payment column
var SETTINGS = [
  ['Current window (filled in automatically)', ''],
  ['Delivery fee (₹)', 40],
  ['Delivery PIN (6 digits)', ''],
  ['UPI ID', ''],
  ['Payee name', 'Farmblue Agrotech Private Limited'],
  ['FSSAI number', ''],
  ['Delivery person mobile', ''],
  ['Admin password (8 or more characters)', '']
];
var COMPANY = {
  name: 'Farmblue Agrotech Private Limited',
  address: 'House No 1328, A/p Harkul, Khalachi Teliwadi, Kankavli, Sindhudurg 416602, Maharashtra',
  cin: 'U01611PN2024PTC235233',
  contact: 'WhatsApp +91 88568 88766 · connect@farmblue.in'
};

function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

// ---------- setup (safe to run any number of times) ----------
function ensureHeaders_(sh, cols) {
  var last = Math.max(1, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, last).getValues()[0].map(function (h) { return String(h).trim(); });
  cols.forEach(function (c) {
    if (head.indexOf(c) === -1) {
      var at = head.filter(String).length + 1;
      sh.getRange(1, at).setValue(c).setFontWeight('bold').setBackground('#12404A').setFontColor('#FFFFFF');
      head[at - 1] = c;
    }
  });
}
function setup_() {
  ensureHeaders_(sheet_('Orders'), ORDER_COLS);
  var s = sheet_('Settings');
  SETTINGS.forEach(function (row, i) {
    var r = i + 2;
    if (!String(s.getRange(r, 1).getValue()).trim()) { s.getRange(r, 1, 1, 2).setValues([row]); }
  });
  s.getRange('B2').setNumberFormat('@');
  s.getRange('B4').setNumberFormat('@');
  s.getRange('B8').setNumberFormat('@');
  s.getRange('B9').setNumberFormat('@');
}
function isPaid_(status, payment) { return String(payment).trim() === 'Paid' || String(status).trim() === 'Paid'; }
function now_() { return Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a'); }

/** Dropdowns for Status and Payment, and moves old "Paid" statuses into the Payment column. Runs when the sheet opens. */
function tidyOrders_() {
  var sh = sheet_('Orders'), c = colIndex_(sh), last = sh.getLastRow();
  var rule = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build(); };
  sh.getRange(2, c['Status'], 3000, 1).setDataValidation(rule(STATUSES));
  sh.getRange(2, c['Payment'], 3000, 1).setDataValidation(rule(['Unpaid', 'Paid']));
  if (last < 2) return;
  var st = sh.getRange(2, c['Status'], last - 1, 1).getValues();
  var pay = sh.getRange(2, c['Payment'], last - 1, 1).getValues();
  var ids = sh.getRange(2, c['Order ID'], last - 1, 1).getValues();
  var changed = false;
  for (var i = 0; i < st.length; i++) {
    if (!String(ids[i][0]).trim()) continue;
    if (String(st[i][0]).trim() === 'Paid') { st[i][0] = 'Confirmed'; pay[i][0] = 'Paid'; changed = true; }
    if (!String(pay[i][0]).trim()) { pay[i][0] = 'Unpaid'; changed = true; }
  }
  if (changed) {
    sh.getRange(2, c['Status'], last - 1, 1).setValues(st);
    sh.getRange(2, c['Payment'], last - 1, 1).setValues(pay);
  }
}
function colIndex_(sh) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], m = {};
  head.forEach(function (h, i) { m[String(h).trim()] = i + 1; });
  return m;
}
function setting_(prefix) {
  var v = sheet_('Settings').getDataRange().getValues();
  for (var i = 1; i < v.length; i++) { if (String(v[i][0]).indexOf(prefix) === 0) return v[i][1]; }
  return '';
}

function onOpen() {
  syncWindow_();
  setup_();
  tidyOrders_();
  SpreadsheetApp.getUi().createMenu('Blio').addItem('Make bill for selected order', 'makeBill').addToUi();
}

// ---------- order window ----------
/** The order window an order placed now belongs to, as text like "2026-10-28 Wed". */
function currentWindow_() {
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, TZ, 'H'));
  for (var i = 0; i < 8; i++) {
    var d = new Date(now.getTime() + i * 86400000);
    var dow = Number(Utilities.formatDate(d, TZ, 'u')) % 7;
    if (ORDER_DAYS.indexOf(dow) === -1) continue;
    if (i === 0 && hour >= CLOSE_HOUR) continue;
    return Utilities.formatDate(d, TZ, 'yyyy-MM-dd EEE');
  }
  return '';
}
/** Keeps Settings!B2 showing the current window, so the sheet's formulas count the right orders. */
function syncWindow_() {
  var w = currentWindow_();
  var cell = sheet_('Settings').getRange('B2');
  if (cell.getDisplayValue() !== w) { cell.setNumberFormat('@').setValue(w); }
  return w;
}

// ---------- reading ----------
function rows_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var head = values.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  return values.map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}
function orderedKg_(windowId) {
  var used = {};
  rows_('Order lines').forEach(function (l) {
    if (String(l['window']) !== windowId) return;
    if (String(l['status']).toLowerCase() === 'cancelled') return;
    var k = String(l['item']).trim();
    used[k] = (used[k] || 0) + (Number(l['kg']) || 0);
  });
  return used;
}
function products_(windowId) {
  var used = orderedKg_(windowId);
  return rows_('Products').filter(function (p) { return String(p['name']).trim() && Number(p['price per kg']) > 0; }).map(function (p) {
    var name = String(p['name']).trim();
    var cap = p['kg for this window'];
    var left = (cap === '' || cap === null) ? null : Math.max(0, Number(cap) - (used[name] || 0));
    var avail = String(p['available']).trim().toLowerCase();
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      group: GROUPS.indexOf(String(p['group']).trim()) > -1 ? String(p['group']).trim() : 'Fish',
      name: name,
      en: String(p['english name'] || ''),
      mr: String(p['marathi name'] || ''),
      price: Number(p['price per kg']),
      origin: String(p['from'] || 'the Konkan coast'),
      cuts: String(p['cuts'] || 'Whole').split('|').map(function (c) { return c.trim(); }).filter(String),
      available: !(avail === 'no' || avail === 'sold out'),
      left: left
    };
  });
}
function deliveryFee_() { var f = Number(setting_('Delivery fee')); return isNaN(f) ? 40 : f; }

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- delivery PIN, with a lockout after 10 wrong tries in 10 minutes ----------
function pinCheck_(pin) {
  var real = String(setting_('Delivery PIN')).trim();
  if (!real) return 'off';
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badpin') || 0);
  if (bad >= 10) return 'locked';
  if (String(pin || '').trim() === real) return 'ok';
  cache.put('badpin', String(bad + 1), 600);
  return 'wrong';
}

function deliveries_() {
  var sh = sheet_('Orders'), c = colIndex_(sh), v = sh.getDataRange().getValues(), out = [];
  var get = function (r, k) { return c[k] ? r[c[k] - 1] : ''; };
  for (var i = 1; i < v.length; i++) {
    var r = v[i], st = String(get(r, 'Status')).trim();
    if (TO_DELIVER.indexOf(st) === -1) continue;
    out.push({
      id: String(get(r, 'Order ID')), window: String(get(r, 'Window')), name: String(get(r, 'Name')),
      mobile: String(get(r, 'Mobile')).replace(/[^0-9]/g, '').slice(-10), address: String(get(r, 'Address')),
      area: String(get(r, 'Area')), items: String(get(r, 'Items')), notes: String(get(r, 'Notes')),
      total: Number(get(r, 'Total')) || 0, final: get(r, 'Final amount') === '' ? '' : Number(get(r, 'Final amount')),
      status: st === 'Paid' ? 'Confirmed' : st, paid: isPaid_(st, get(r, 'Payment')), map: String(get(r, 'Map') || '')
    });
  }
  out.sort(function (a, b) { return (a.area || '').localeCompare(b.area || '') || a.name.localeCompare(b.name); });
  return out;
}

/** A customer's own orders. ids is "BL2810-001:token,BL2810-004:token"; an order is returned only if its token matches. */
function myOrders_(ids) {
  var want = {};
  ids.split(',').slice(0, 50).forEach(function (pair) {
    var p = pair.split(':');
    if (p[0] && p[1] && p[1].length >= 12) want[p[0].trim()] = p[1].trim();
  });
  if (!Object.keys(want).length) return [];
  var sh = sheet_('Orders'), c = colIndex_(sh);
  if (!c['Token']) return [];
  var v = sh.getDataRange().getDisplayValues(), raw = sh.getDataRange().getValues(), out = [], found = {};
  var rider = String(setting_('Delivery person mobile')).replace(/[^0-9]/g, '').slice(-10);
  var get = function (r, k) { return c[k] ? r[c[k] - 1] : ''; };
  for (var i = 1; i < v.length; i++) {
    var id = String(get(v[i], 'Order ID'));
    if (!want[id] || want[id] !== String(get(v[i], 'Token'))) continue;
    found[id] = true;
    out.push({
      id: id, status: String(get(v[i], 'Status')).trim() || 'New', window: String(get(v[i], 'Window')),
      total: Number(get(raw[i], 'Total')) || 0, final: get(raw[i], 'Final amount') === '' ? '' : Number(get(raw[i], 'Final amount')),
      bill: String(get(v[i], 'Bill') || ''), deliveredAt: String(get(v[i], 'Delivered at') || ''),
      paid: isPaid_(get(v[i], 'Status'), get(v[i], 'Payment')),
      outAt: String(get(v[i], 'Out at') || ''), nextAt: String(get(v[i], 'Next at') || ''),
      rider: ['Out for delivery', 'Arriving next'].indexOf(String(get(v[i], 'Status')).trim()) > -1 ? rider : ''
    });
    if (out[out.length - 1].status === 'Paid') out[out.length - 1].status = 'Confirmed';
  }
  return out;
}

// ---------- web app ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'myorders') return json_({ ok: true, orders: myOrders_(String(p.ids || '')) });
  if (p.action === 'deliveries') {
    var chk = pinCheck_(p.pin);
    if (chk !== 'ok') return json_({ ok: false, error: chk === 'locked' ? 'locked' : 'pin' });
    return json_({ ok: true, orders: deliveries_() });
  }
  var w = syncWindow_();
  return json_({ ok: true, window: w, deliveryFee: deliveryFee_(), upi: String(setting_('UPI ID')).trim(),
    payee: String(setting_('Payee name')).trim(), products: products_(w) });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    var o = JSON.parse(e.postData.contents);
    if (o.action === 'delivered' || o.action === 'start' || o.action === 'next') return json_(stage_(o));
    if (o.action === 'admin') return json_(admin_(o));
    return json_(placeOrder_(o));
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/** Rider actions from Blio Delivery: start the round, next stop, delivered. */
function stage_(o) {
  var chk = pinCheck_(o.pin);
  if (chk !== 'ok') return { ok: false, error: chk === 'locked' ? 'locked' : 'pin' };
  setup_();
  var sh = sheet_('Orders'), c = colIndex_(sh), n = Math.max(1, sh.getLastRow() - 1);
  var ids = sh.getRange(2, c['Order ID'], n, 1).getDisplayValues();
  var st = sh.getRange(2, c['Status'], n, 1).getValues();
  var want = o.action === 'start' ? (o.ids || []).slice(0, 60).map(String) : [String(o.id)];
  var time = now_(), done = 0;
  for (var i = 0; i < ids.length; i++) {
    if (want.indexOf(ids[i][0]) === -1) continue;
    var row = i + 2, cur = String(st[i][0]).trim();
    if (cur === 'Paid') { sh.getRange(row, c['Payment']).setValue('Paid'); cur = 'Confirmed'; }
    if (o.action === 'start') {
      if (['Confirmed', 'Packed'].indexOf(cur) === -1) continue;
      sh.getRange(row, c['Status']).setValue('Out for delivery');
      sh.getRange(row, c['Out at']).setNumberFormat('@').setValue(time);
    } else if (o.action === 'next') {
      if (TO_DELIVER.indexOf(cur) === -1) continue;
      sh.getRange(row, c['Status']).setValue('Arriving next');
      sh.getRange(row, c['Next at']).setNumberFormat('@').setValue(time);
      if (!String(sh.getRange(row, c['Out at']).getValue()).trim()) sh.getRange(row, c['Out at']).setNumberFormat('@').setValue(time);
    } else {
      sh.getRange(row, c['Status']).setValue('Delivered');
      sh.getRange(row, c['Delivered at']).setNumberFormat('@').setValue(time);
    }
    done++;
  }
  return done ? { ok: true, time: time, count: done } : { ok: false, error: 'notfound' };
}

function placeOrder_(o) {
  setup_();
  var name = String(o.name || '').trim().slice(0, 80);
  var phone = String(o.phone || '').replace(/[^0-9]/g, '').slice(-10);
  var address = String(o.address || '').trim().slice(0, 300);
  var area = String(o.area || '').trim().slice(0, 80);
  var notes = String(o.notes || '').trim().slice(0, 300);
  if (!name || phone.length !== 10 || !address) return { ok: false, error: 'details' };
  if (!o.items || !o.items.length || o.items.length > 30) return { ok: false, error: 'items' };
  var lat = Number(o.lat), lng = Number(o.lng);
  var map = (lat > 6 && lat < 37 && lng > 68 && lng < 98) ? 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) : '';

  var w = syncWindow_();
  var list = products_(w), byName = {};
  list.forEach(function (p) { byName[p.name] = p; });

  var need = {}, lines = [], short = [];
  o.items.forEach(function (it) {
    var p = byName[String(it.name)];
    var kgPer = PACKS[it.pack];
    var qty = Math.floor(Number(it.qty));
    if (!p || !kgPer || !(qty >= 1 && qty <= MAX_QTY)) { short.push({ name: String(it.name), left: 0 }); return; }
    var cut = p.cuts.indexOf(String(it.cut)) > -1 ? String(it.cut) : p.cuts[0];
    need[p.name] = (need[p.name] || 0) + kgPer * qty;
    lines.push({ name: p.name, pack: it.pack, cut: cut, qty: qty, kg: kgPer * qty, total: p.price * kgPer * qty });
  });
  Object.keys(need).forEach(function (n) {
    var p = byName[n];
    if (!p.available || (p.left !== null && need[n] > p.left)) short.push({ name: n, left: p.available ? p.left : 0 });
  });
  if (short.length) return { ok: false, error: 'stock', short: short, products: list };

  var sub = lines.reduce(function (a, l) { return a + l.total; }, 0);
  var fee = deliveryFee_();
  var orders = sheet_('Orders'), c = colIndex_(orders), width = orders.getLastColumn();
  var id = 'BL' + Utilities.formatDate(new Date(), TZ, 'ddMM') + '-' + ('00' + orders.getLastRow()).slice(-3);
  var placed = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a');
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var summary = lines.map(function (l) { return l.name + ' ' + l.pack + ' ' + l.cut + ' x' + l.qty; }).join('; ');

  var values = {
    'Order ID': id, 'Placed at': placed, 'Window': w, 'Name': name, 'Mobile': phone, 'Address': address, 'Area': area,
    'Items': summary, 'Subtotal': sub, 'Delivery': fee, 'Total': sub + fee, 'Status': 'New', 'Notes': notes, 'Map': map, 'Token': token, 'Payment': 'Unpaid'
  };
  var row = orders.getLastRow() + 1, out = [];
  for (var i = 1; i <= width; i++) out.push('');
  Object.keys(values).forEach(function (k) { if (c[k]) out[c[k] - 1] = values[k]; });
  ['Order ID', 'Placed at', 'Window', 'Mobile'].forEach(function (k) { if (c[k]) orders.getRange(row, c[k]).setNumberFormat('@'); });
  ['Subtotal', 'Delivery', 'Total', 'Final amount'].forEach(function (k) { if (c[k]) orders.getRange(row, c[k]).setNumberFormat('"₹"#,##0'); });
  orders.getRange(row, 1, 1, width).setValues([out]);

  var ol = sheet_('Order lines'), start = ol.getLastRow() + 1;
  var rowsOut = lines.map(function (l, i) {
    return [id, w, l.name, l.pack, l.cut, l.qty, l.kg, l.total,
      '=IFERROR(INDEX(Orders!$L:$L,MATCH($A' + (start + i) + ',Orders!$A:$A,0)),"")'];
  });
  ol.getRange(start, 1, rowsOut.length, 2).setNumberFormat('@');
  ol.getRange(start, 1, rowsOut.length, 9).setValues(rowsOut);

  return { ok: true, id: id, token: token, window: w, subtotal: sub, fee: fee, total: sub + fee, lines: lines };
}

// ---------- Blio Admin app ----------
function adminCheck_(pw) {
  var real = String(setting_('Admin password')).trim();
  if (real.length < 8) return 'setup';
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badadmin') || 0);
  if (bad >= 10) return 'locked';
  if (String(pw || '') === real) return 'ok';
  cache.put('badadmin', String(bad + 1), 600);
  return 'wrong';
}
function adminLog_(by, what) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), lg = ss.getSheetByName('Admin log');
  if (!lg) { lg = ss.insertSheet('Admin log'); lg.appendRow(['Time', 'By', 'What']); }
  lg.appendRow([now_(), String(by || '').slice(0, 40), String(what).slice(0, 300)]);
}
function findRow_(sh, col, value) {
  var n = sh.getLastRow() - 1; if (n < 1) return 0;
  var v = sh.getRange(2, col, n, 1).getDisplayValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === String(value)) return i + 2;
  return 0;
}
function adminOrders_() {
  var sh = sheet_('Orders'), c = colIndex_(sh), last = sh.getLastRow();
  if (last < 2) return [];
  var start = Math.max(2, last - 299), n = last - start + 1, w = sh.getLastColumn();
  var raw = sh.getRange(start, 1, n, w).getValues(), disp = sh.getRange(start, 1, n, w).getDisplayValues(), out = [];
  var g = function (r, k) { return c[k] ? r[c[k] - 1] : ''; };
  for (var i = n - 1; i >= 0; i--) {
    var id = String(g(disp[i], 'Order ID')).trim(); if (!id) continue;
    var st = String(g(disp[i], 'Status')).trim() || 'New';
    out.push({
      id: id, placed: String(g(disp[i], 'Placed at')), window: String(g(disp[i], 'Window')), name: String(g(disp[i], 'Name')),
      mobile: String(g(disp[i], 'Mobile')).replace(/[^0-9]/g, '').slice(-10), address: String(g(disp[i], 'Address')),
      area: String(g(disp[i], 'Area')), items: String(g(disp[i], 'Items')), notes: String(g(disp[i], 'Notes')),
      total: Number(g(raw[i], 'Total')) || 0, final: g(raw[i], 'Final amount') === '' ? '' : Number(g(raw[i], 'Final amount')),
      status: st === 'Paid' ? 'Confirmed' : st, paid: isPaid_(st, g(disp[i], 'Payment')), map: String(g(disp[i], 'Map') || ''),
      bill: String(g(disp[i], 'Bill') || ''), outAt: String(g(disp[i], 'Out at') || ''), deliveredAt: String(g(disp[i], 'Delivered at') || '')
    });
  }
  return out;
}
function adminProducts_(w) {
  var used = orderedKg_(w);
  return rows_('Products').filter(function (p) { return String(p['name']).trim(); }).map(function (p) {
    var name = String(p['name']).trim(), cap = p['kg for this window'], avail = String(p['available']).trim().toLowerCase();
    var cp = (cap === '' || cap === null) ? '' : Number(cap);
    return { name: name, group: String(p['group'] || ''), price: Number(p['price per kg']) || 0, cap: cp,
      ordered: used[name] || 0, left: cp === '' ? '' : Math.max(0, cp - (used[name] || 0)),
      available: !(avail === 'no' || avail === 'sold out') };
  });
}
function adminSettings_() {
  return { fee: deliveryFee_(), upi: String(setting_('UPI ID')).trim(), payee: String(setting_('Payee name')).trim(),
    rider: String(setting_('Delivery person mobile')).trim(), fssai: String(setting_('FSSAI number')).trim(),
    pin: String(setting_('Delivery PIN')).trim() };
}
function setSetting_(prefix, value) {
  var sh = sheet_('Settings'), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf(prefix) === 0) { sh.getRange(i + 1, 2).setNumberFormat('@').setValue(value); return true; }
  return false;
}
function admin_(o) {
  var chk = adminCheck_(o.pw);
  if (chk !== 'ok') return { ok: false, error: chk };
  setup_();
  var by = String(o.by || 'Admin').trim() || 'Admin';
  var w = syncWindow_();
  if (o.op === 'load') {
    return { ok: true, window: w, orders: adminOrders_(), products: adminProducts_(w), settings: adminSettings_(),
      sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
  }
  if (o.op === 'order') {
    var sh = sheet_('Orders'), c = colIndex_(sh), row = findRow_(sh, c['Order ID'], o.id);
    if (!row) return { ok: false, error: 'notfound' };
    var did = [];
    if (o.status !== undefined) {
      if (STATUSES.indexOf(o.status) === -1) return { ok: false, error: 'bad' };
      sh.getRange(row, c['Status']).setValue(o.status); did.push('status ' + o.status);
      if (o.status === 'Delivered' && !String(sh.getRange(row, c['Delivered at']).getValue()).trim()) sh.getRange(row, c['Delivered at']).setNumberFormat('@').setValue(now_());
      if (o.status === 'Out for delivery' && !String(sh.getRange(row, c['Out at']).getValue()).trim()) sh.getRange(row, c['Out at']).setNumberFormat('@').setValue(now_());
    }
    if (o.payment !== undefined) {
      if (['Paid', 'Unpaid'].indexOf(o.payment) === -1) return { ok: false, error: 'bad' };
      sh.getRange(row, c['Payment']).setValue(o.payment); did.push('payment ' + o.payment);
    }
    if (o.final !== undefined) {
      var f = o.final === '' || o.final === null ? '' : Math.round(Number(o.final));
      if (f !== '' && !(f >= 0 && f < 1000000)) return { ok: false, error: 'bad' };
      sh.getRange(row, c['Final amount']).setNumberFormat('"₹"#,##0').setValue(f); did.push('final amount ' + (f === '' ? 'cleared' : f));
    }
    adminLog_(by, o.id + ': ' + did.join(', '));
    return { ok: true };
  }
  if (o.op === 'product') {
    var ps = sheet_('Products'), pc = colIndex_(ps), prow = findRow_(ps, pc['Name'], o.name);
    if (!prow) return { ok: false, error: 'notfound' };
    var pd = [];
    if (o.price !== undefined) { var pr = Number(o.price); if (!(pr > 0 && pr < 100000)) return { ok: false, error: 'bad' }; ps.getRange(prow, pc['Price per kg']).setValue(pr); pd.push('price ' + pr); }
    if (o.cap !== undefined) { var cp = o.cap === '' || o.cap === null ? '' : Number(o.cap); if (cp !== '' && !(cp >= 0 && cp < 10000)) return { ok: false, error: 'bad' }; ps.getRange(prow, pc['Kg for this window']).setValue(cp); pd.push('kg ' + (cp === '' ? 'no limit' : cp)); }
    if (o.available !== undefined) { ps.getRange(prow, pc['Available']).setValue(o.available ? 'Yes' : 'No'); pd.push(o.available ? 'available' : 'sold out'); }
    adminLog_(by, o.name + ': ' + pd.join(', '));
    return { ok: true, product: adminProducts_(w).filter(function (p) { return p.name === String(o.name); })[0] };
  }
  if (o.op === 'settings') {
    var map = { fee: 'Delivery fee', upi: 'UPI ID', payee: 'Payee name', rider: 'Delivery person mobile', fssai: 'FSSAI number', pin: 'Delivery PIN' };
    var sd = [];
    Object.keys(map).forEach(function (k) {
      if (o[k] === undefined) return;
      var v = String(o[k]).trim().slice(0, 80);
      if (k === 'fee') { v = Number(v); if (!(v >= 0 && v < 10000)) return; }
      if (k === 'pin' && v && !/^[0-9]{4,8}$/.test(v)) return;
      setSetting_(map[k], v); sd.push(k);
    });
    adminLog_(by, 'settings: ' + sd.join(', '));
    return { ok: true, settings: adminSettings_() };
  }
  if (o.op === 'bill') {
    var bs = sheet_('Orders'), bc = colIndex_(bs), brow = findRow_(bs, bc['Order ID'], o.id);
    if (!brow) return { ok: false, error: 'notfound' };
    var b = billFor_(bs, brow);
    adminLog_(by, o.id + ': bill made');
    return { ok: true, url: b.url, wa: b.wa, payable: b.payable };
  }
  return { ok: false, error: 'bad' };
}

// ---------- bills ----------
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function inr_(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }   // PDF fonts may lack the rupee sign
function rupee_(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
function billsFolder_() {
  var it = DriveApp.getFoldersByName('Blio bills');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Blio bills');
}

/** Makes the PDF bill for the order on this row of Orders. Returns what the menu and the admin app need. */
function billFor_(sh, row) {
  var c = colIndex_(sh), r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var get = function (k) { return c[k] ? r[c[k] - 1] : ''; };
  var id = String(sh.getRange(row, c['Order ID']).getDisplayValue());
  if (!id) return null;
  var lines = rows_('Order lines').filter(function (l) { return String(l['order id']) === id; });
  var sub = Number(get('Subtotal')) || 0, fee = Number(get('Delivery')) || 0, total = Number(get('Total')) || sub + fee;
  var fin = get('Final amount'), payable = fin === '' ? total : Number(fin);
  var adjust = payable - total;
  var fssai = String(setting_('FSSAI number')).trim();
  var upi = String(setting_('UPI ID')).trim();
  var mobile = String(get('Mobile')).replace(/[^0-9]/g, '').slice(-10);
  var today = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');

  var rowsHtml = lines.map(function (l, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + esc_(l['item']) + '<br><span class="s">' + esc_(l['pack']) + ', ' + esc_(l['cut']) + '</span></td>' +
      '<td class="n">' + esc_(l['qty']) + '</td><td class="n">' + esc_(l['kg']) + ' kg</td><td class="n">' + inr_(l['line total']) + '</td></tr>';
  }).join('');

  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#12272C;font-size:12px;margin:28px}' +
    'h1{font-size:26px;margin:0;color:#12404A}.top{border-bottom:3px solid #12404A;padding-bottom:10px;margin-bottom:14px}' +
    '.s{color:#5A6B68;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:12px}' +
    'th{background:#12404A;color:#fff;text-align:left;padding:6px;font-size:11px}td{padding:6px;border-bottom:1px solid #DDD;vertical-align:top}' +
    '.n{text-align:right;white-space:nowrap}.tot td{border:0;padding:4px 6px}.big td{font-size:15px;font-weight:bold;border-top:2px solid #12404A}' +
    '.two{width:100%;margin-top:6px}.two td{border:0;padding:0 0 4px 0;width:50%}</style></head><body>' +
    '<div class="top"><h1>blio</h1><b>' + esc_(COMPANY.name) + '</b><br><span class="s">' + esc_(COMPANY.address) +
    '<br>CIN ' + COMPANY.cin + (fssai ? ' · FSSAI ' + esc_(fssai) : '') + '<br>' + esc_(COMPANY.contact) + '</span></div>' +
    '<table class="two"><tr><td><b>Bill</b><br>No. ' + esc_(id) + '<br>Date ' + today + '<br>Window ' + esc_(get('Window')) + '</td>' +
    '<td><b>Billed to</b><br>' + esc_(get('Name')) + '<br>' + esc_(mobile) + '<br>' + esc_(get('Address')) + (get('Area') ? ', ' + esc_(get('Area')) : '') + '</td></tr></table>' +
    '<table><tr><th>#</th><th>Item</th><th class="n">Qty</th><th class="n">Weight</th><th class="n">Amount</th></tr>' + rowsHtml + '</table>' +
    '<table class="tot"><tr><td class="n" style="width:80%">Subtotal</td><td class="n">' + inr_(sub) + '</td></tr>' +
    '<tr><td class="n">Delivery</td><td class="n">' + inr_(fee) + '</td></tr>' +
    (adjust ? '<tr><td class="n">Adjustment for final cleaned weight</td><td class="n">' + (adjust < 0 ? '-' : '') + inr_(Math.abs(adjust)) + '</td></tr>' : '') +
    '<tr class="big"><td class="n">Amount payable</td><td class="n">' + inr_(payable) + '</td></tr></table>' +
    '<p style="margin-top:18px">' + (isPaid_(get('Status'), get('Payment')) ? '<b>Paid.</b> Thank you.' : (upi ? 'Pay by UPI to <b>' + esc_(upi) + '</b>.' : 'Payment by UPI.')) + '</p>' +
    '<p class="s">This is not a GST tax invoice. Prices are per kg; fish is weighed after cleaning.</p></body></html>';

  var pdf = Utilities.newBlob(html, 'text/html', id + '.html').getAs('application/pdf').setName('Blio bill ' + id + '.pdf');
  var file = billsFolder_().createFile(pdf);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
  if (c['Bill']) sh.getRange(row, c['Bill']).setValue(file.getUrl());

  var payLink = 'https://blio.in/#pay?o=' + encodeURIComponent(id) + '&a=' + Math.round(payable);
  var msg = 'Hello ' + get('Name') + ', thank you for ordering from Blio.\n\nBill for order ' + id + ': ' + rupee_(payable) + '\n' + file.getUrl() +
    (isPaid_(get('Status'), get('Payment')) ? '\n\nPayment received. Thank you!' : (upi ? '\n\nPay by UPI here: ' + payLink : ''));
  var wa = 'https://wa.me/91' + mobile + '?text=' + encodeURIComponent(msg);

  return { id: id, url: file.getUrl(), payable: payable, wa: mobile.length === 10 ? wa : '', upi: upi };
}

function makeBill() {
  var ui = SpreadsheetApp.getUi();
  setup_();
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Orders') { ui.alert('Open the Orders tab, click any cell in the order\'s row, then choose Blio > Make bill again.'); return; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('Click a cell in an order\'s row first, not the heading row.'); return; }
  var b = billFor_(sh, row);
  if (!b) { ui.alert('This row has no Order ID.'); return; }
  var out = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    '<p>Bill for <b>' + esc_(b.id) + '</b> saved: ' + rupee_(b.payable) + '.</p>' +
    (b.wa ? '<p><a href="' + esc_(b.wa) + '" target="_blank" style="display:inline-block;background:#C2462A;color:#fff;padding:10px 16px;text-decoration:none;font-weight:bold">Send on WhatsApp</a></p>' : '<p>No valid mobile number on this order.</p>') +
    '<p><a href="' + esc_(b.url) + '" target="_blank">Open the bill</a></p>' +
    (b.upi ? '' : '<p style="color:#8C3418">Add the UPI ID in Settings to include a payment link.</p>') + '</div>'
  ).setWidth(380).setHeight(230);
  ui.showModalDialog(out, 'Bill ' + b.id);
}
