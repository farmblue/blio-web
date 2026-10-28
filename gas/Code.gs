/**
 * Blio admin: Google Apps Script behind the Blio web app (blio.in).
 * Lives in the Blio admin Google Sheet (Extensions > Apps Script), deployed as a web app.
 *
 * GET                     the shop: what is in stock now (live catch lots), prices, sizes, delivery plan
 * GET  ?action=deliveries orders to deliver (needs the delivery PIN)
 * GET  ?action=myorders   status of a customer's own orders (each order needs its secret token)
 * POST order              saves an order after checking stock; prices and stock always come from the sheet
 * POST action=start       rider starts the round: orders become Out for delivery (needs the delivery PIN)
 * POST action=next        rider's next stop: that order becomes Arriving next (needs the delivery PIN)
 * POST action=delivered   marks an order Delivered (needs the delivery PIN)
 * POST action=admin       Blio Admin app (blio.in/admin): orders, catch lots, counts, fish list, settings, bills (needs the admin password)
 * Sheet menu Blio > Make bill for selected order   PDF bill in Drive plus a WhatsApp link to send it
 */

var TZ = 'Asia/Kolkata';
var ORDER_DAYS = [1, 3, 6];   // Monday, Wednesday, Saturday (0 = Sunday)
var CLOSE_HOUR = 18;          // orders close at 6 PM
var GROUPS = ['Fish', 'Prawns', 'Crabs and clams', 'Dried'];
var PACKS = { '500 g': 0.5, '1 kg': 1 };
var MAX_QTY = 20;
var ORDER_COLS = ['Order ID', 'Placed at', 'Window', 'Name', 'Mobile', 'Address', 'Area', 'Items', 'Subtotal', 'Delivery',
  'Total', 'Status', 'Notes', 'Map', 'Final amount', 'Bill', 'Delivered at', 'Token', 'Payment', 'Out at', 'Next at', 'Packed by', 'Coupon', 'Discount'];
var STATUSES = ['New', 'Confirmed', 'Packed', 'Out for delivery', 'Arriving next', 'Delivered', 'Cancelled'];
var TO_DELIVER = ['Confirmed', 'Packed', 'Out for delivery', 'Arriving next', 'Paid'];   // 'Paid' kept for orders from before the Payment column
var SIZES = ['', 'Small to medium', 'Medium to big'];
var STOCK_COLS = ['Lot', 'Landed', 'Fish', 'Size', 'Pieces', 'Kg bought', 'Cost per kg', 'Price per kg', 'Harbour', 'Status', 'Entered at', 'Entered by', 'Offer %'];
var COUPON_COLS = ['Code', 'Type (% or Rs)', 'Value', 'Min order (Rs)', 'Valid till', 'Uses per mobile', 'Max uses', 'Active', 'Note'];
var COUNT_COLS = ['Time', 'Lot', 'Fish', 'Size', 'Expected kg', 'Waste kg', 'Counted kg', 'Gap kg', 'Pieces counted', 'By', 'Note'];
var CAT_COLS = ['Category', 'Marathi name', 'Order', 'Show'];
var CAT_SEED = [['Fish', 'मासे', 1, 'Yes'], ['Prawns', 'कोळंबी', 2, 'Yes'], ['Crabs and clams', 'खेकडे, तिसऱ्या', 3, 'Yes'], ['Dried', 'सुकी मासळी', 4, 'Yes']];
var SETTINGS = [
  ['Current window (filled in automatically)', ''],
  ['Delivery fee (₹)', 40],
  ['Delivery PIN (6 digits)', ''],
  ['UPI ID', ''],
  ['Payee name', 'Farmblue Agrotech Private Limited'],
  ['FSSAI number', ''],
  ['Delivery person mobile', ''],
  ['Admin password (8 or more characters)', ''],
  ['Delivery starts (24-hour time)', '17:00'],
  ['Delivery ends (24-hour time)', '20:00'],
  ['Same-day order cut-off (24-hour time)', '15:00'],
  ['Sell each catch for (days)', 2],
  ['Day-2 discount on (Yes or No)', 'No'],
  ['Day-2 discount (%)', 10],
  ['Show landing date (Yes or No)', 'Yes'],
  ['Go live automatically after (minutes)', 30],
  ['Auto go-live on (Yes or No)', 'Yes'],
  ['Harbours (separated by commas)', 'Goa, Vengurla, Malvan, Devgad, Ratnagiri'],
  ['Packing PIN (4 to 8 digits)', '']
];
var SETUP_VERSION = '2026-10-28c';   // change this when setup_ adds new tabs, columns or settings
var COMPANY = {
  name: 'Farmblue Agrotech Private Limited',
  address: 'House No 1328, A/p Harkul, Khalachi Teliwadi, Kankavli, Sindhudurg 416602, Maharashtra',
  cin: 'U01611PN2024PTC235233',
  contact: 'WhatsApp +91 88568 88766 · connect@farmblue.in'
};

// Everything read from the sheet is remembered for the rest of one request, so each tab is read once.
var RC_ = {};
function bust_() { RC_ = {}; }
function ss_() { return RC_.ss || (RC_.ss = SpreadsheetApp.getActiveSpreadsheet()); }
function sheet_(name) { var k = 's:' + name; if (!RC_[k]) RC_[k] = ss_().getSheetByName(name); return RC_[k]; }
/** Runs setup only once per script version instead of on every request. */
function ensureSetup_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('setup') === SETUP_VERSION) return;
  setup_(); p.setProperty('setup', SETUP_VERSION); bust_();
}
function dropShop_() { try { CacheService.getScriptCache().remove('shop'); } catch (e) {} }

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
function tab_(name, cols, seed) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name); RC_['s:' + name] = sh;
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#12404A').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    if (seed && seed.length) sh.getRange(2, 1, seed.length, seed[0].length).setValues(seed);
  } else { ensureHeaders_(sh, cols); }
  return sh;
}
function setup_() {
  ensureHeaders_(sheet_('Orders'), ORDER_COLS);
  ensureHeaders_(sheet_('Order lines'), ['Order ID', 'Window', 'Item', 'Pack', 'Cut', 'Qty', 'Kg', 'Line total', 'Status', 'Lot', 'Size']);
  ensureHeaders_(sheet_('Products'), ['Yield %', 'Show kg left', 'Show origin']);
  tab_('Stock', STOCK_COLS);
  tab_('Counts', COUNT_COLS);
  tab_('Categories', CAT_COLS, CAT_SEED);
  tab_('Coupons', COUPON_COLS);
  var s = sheet_('Settings'), have = s.getRange(2, 1, SETTINGS.length, 1).getValues();
  SETTINGS.forEach(function (row, i) {
    var r = i + 2;
    if (!String(have[i][0]).trim()) { s.getRange(r, 2).setNumberFormat('@'); s.getRange(r, 1, 1, 2).setValues([[row[0], String(row[1])]]); }
  });
  bust_();
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
  var k = 'c:' + sh.getName(); if (RC_[k]) return RC_[k];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], m = {};
  head.forEach(function (h, i) { m[String(h).trim()] = i + 1; });
  return (RC_[k] = m);
}
function setting_(prefix) {
  var v = RC_.settings || (RC_.settings = sheet_('Settings').getDataRange().getValues());
  for (var i = 1; i < v.length; i++) { if (String(v[i][0]).indexOf(prefix) === 0) return v[i][1]; }
  return '';
}

function onOpen() {
  setup_();
  try { PropertiesService.getScriptProperties().setProperty('setup', SETUP_VERSION); } catch (e) {}
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

// ---------- buy-first stock: schedule, lots, shop ----------
function pad_(n) { return ('0' + n).slice(-2); }
function ymd_(d) { return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM-dd'); }
function normDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var m = String(v || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
}
function addDays_(ymd, n) {
  var p = ymd.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate());
}
function dayDiff_(a, b) { var x = a.split('-'), y = b.split('-'); return Math.round((Date.UTC(+y[0], +y[1] - 1, +y[2]) - Date.UTC(+x[0], +x[1] - 1, +x[2])) / 86400000); }
function dayName_(ymd) { var p = ymd.split('-'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()]; }
function nowMin_() { var d = new Date(); return Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')); }
function timeSetting_(prefix, def) {
  var v = setting_(prefix);
  if (v instanceof Date) v = Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'HH:mm');
  var m = String(v || '').match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) { m = String(def).match(/^(\d{1,2}):(\d{2})/); }
  return Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]));
}
function yes_(prefix, def) { var v = String(setting_(prefix)).trim(); return v ? /^y/i.test(v) : def; }
function hhmm_(min) { return pad_(Math.floor(min / 60)) + ':' + pad_(min % 60); }
function sched_() {
  var days = Math.round(Number(setting_('Sell each catch for'))); if (!(days >= 1 && days <= 7)) days = 2;
  var pct = Number(setting_('Day-2 discount (%')); if (!(pct >= 0 && pct <= 90)) pct = 10;
  var auto = Number(setting_('Go live automatically')); if (!(auto >= 0 && auto <= 600)) auto = 30;
  return { start: timeSetting_('Delivery starts', '17:00'), end: timeSetting_('Delivery ends', '20:00'), cutoff: timeSetting_('Same-day order cut-off', '15:00'),
    sellDays: days, discOn: yes_('Day-2 discount on', false), discPct: pct, showLanding: yes_('Show landing date', true), autoMin: auto, autoOn: yes_('Auto go-live on', true) };
}
/** Delivery day for an order placed now: today before the cut-off, otherwise tomorrow. */
function deliveryPlan_(sc) {
  var today = ymd_(), sameDay = nowMin_() < sc.cutoff, d = sameDay ? today : addDays_(today, 1);
  return { date: d, label: d + ' ' + dayName_(d), sameDay: sameDay, today: today };
}
function enteredMin_(text) {   // "yyyy-MM-dd HH:mm" in India time -> minutes since today's midnight (can be negative)
  var m = String(text || '').match(/(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/); if (!m) return -1e9;
  return dayDiff_(ymd_(), m[1]) * 1440 + Number(m[2]) * 60 + Number(m[3]);
}
function lots_() {
  var sh = sheet_('Stock'); if (!sh || sh.getLastRow() < 2) return [];
  return rows_('Stock').filter(function (r) { return String(r['lot']).trim() && String(r['fish']).trim(); }).map(function (r) {
    return { lot: String(r['lot']).trim(), landed: normDate_(r['landed']), fish: String(r['fish']).trim(), size: String(r['size'] || '').trim(),
      pieces: r['pieces'] === '' ? '' : Number(r['pieces']), kg: Number(r['kg bought']) || 0, cost: r['cost per kg'] === '' ? '' : Number(r['cost per kg']),
      price: Number(r['price per kg']) || 0, harbour: String(r['harbour'] || ''), status: String(r['status'] || 'Draft').trim(),
      offer: Math.max(0, Math.min(90, Number(r['offer %']) || 0)),
      enteredAt: String(r['entered at'] || ''), by: String(r['entered by'] || '') };
  });
}
function isLive_(l, sc) {
  if (l.status === 'Live') return true;
  if (l.status === 'Draft') return sc.autoOn && nowMin_() - enteredMin_(l.enteredAt) >= sc.autoMin;
  return false;
}
/** kg taken by orders per lot; upTo (yyyy-MM-dd) counts only orders delivered on or before that day. */
function soldByLot_(upTo) {
  var out = {}, sh = sheet_('Order lines'); if (!sh || sh.getLastRow() < 2) return out;
  rows_('Order lines').forEach(function (l) {
    var lot = String(l['lot'] || '').trim(); if (!lot) return;
    if (String(l['status']).toLowerCase() === 'cancelled') return;
    if (upTo && normDate_(l['window']) > upTo) return;
    out[lot] = (out[lot] || 0) + (Number(l['kg']) || 0);
  });
  return out;
}
function adjByLot_() {
  var out = {}, sh = sheet_('Counts'); if (!sh || sh.getLastRow() < 2) return out;
  rows_('Counts').forEach(function (c) {
    var lot = String(c['lot'] || '').trim(); if (!lot) return;
    out[lot] = (out[lot] || 0) + ((Number(c['counted kg']) || 0) - (Number(c['expected kg']) || 0));
  });
  return out;
}
function landedLabel_(landed) {
  var d = dayDiff_(landed, ymd_());
  if (d === 0) return 'Landed today';
  if (d === 1) return 'Landed yesterday';
  var p = landed.split('-');
  return 'Landed ' + dayName_(landed) + ' ' + Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1];
}
function categories_(all) {
  var sh = sheet_('Categories'); if (!sh || sh.getLastRow() < 2) return CAT_SEED.map(function (c) { return { name: c[0], mr: c[1], order: c[2], show: true }; });
  return rows_('Categories').filter(function (c) { return String(c['category']).trim(); }).map(function (c) {
    return { name: String(c['category']).trim(), mr: String(c['marathi name'] || ''), order: Number(c['order']) || 99, show: !/^n/i.test(String(c['show']).trim()) };
  }).filter(function (c) { return all || c.show; }).sort(function (a, b) { return a.order - b.order; });
}
function catalog_() {
  return rows_('Products').filter(function (p) { return String(p['name']).trim(); }).map(function (p) {
    var avail = String(p['available']).trim().toLowerCase();
    return { name: String(p['name']).trim(), en: String(p['english name'] || ''), mr: String(p['marathi name'] || ''), group: String(p['group'] || 'Fish').trim(),
      from: String(p['from'] || ''), cuts: String(p['cuts'] || 'Whole').split('|').map(function (c) { return c.trim(); }).filter(String),
      price: Number(p['price per kg']) || 0, yieldPct: Number(p['yield %']) || 0, show: !(avail === 'no' || avail === 'sold out'),
      showLeft: !/^n/i.test(String(p['show kg left'] || '').trim()), showOrigin: !/^n/i.test(String(p['show origin'] || '').trim()) };
  });
}
/** What customers can order right now: live lots that can still be delivered on the plan's day, grouped by fish and size. */
function shop_() {
  var sc = sched_(), plan = deliveryPlan_(sc), sold = soldByLot_(), adj = adjByLot_();
  var cat = {}; catalog_().forEach(function (f) { cat[f.name] = f; });
  var byFish = {}, pending = false;
  lots_().sort(function (a, b) { return a.landed < b.landed ? -1 : a.landed > b.landed ? 1 : 0; }).forEach(function (l) {
    var f = cat[l.fish]; if (!f || !f.show || l.status === 'Closed' || !l.landed) return;
    var lastDay = addDays_(l.landed, sc.sellDays - 1);
    if (plan.date < l.landed || plan.date > lastDay) return;
    if (!isLive_(l, sc)) { if (l.status === 'Draft') pending = true; return; }
    var left = Math.round((l.kg - (sold[l.lot] || 0) + (adj[l.lot] || 0)) * 100) / 100;
    if (left < 0.5) return;
    var day2 = dayDiff_(l.landed, plan.date) >= 1, off = Math.max(day2 && sc.discOn ? sc.discPct : 0, l.offer || 0);
    var price = off ? Math.round(l.price * (1 - off / 100)) : l.price;
    var hb = f.showOrigin ? l.harbour : '';
    var key = l.size + '|' + price + '|' + (sc.showLanding ? l.landed : '') + (hb ? '|' + hb : '');
    var g = byFish[l.fish] = byFish[l.fish] || {};
    var o = g[key] = g[key] || { key: key, size: l.size, price: price, base: l.price, off: off, offer: (l.offer || 0) > 0 && l.offer >= off,
      landed: sc.showLanding ? landedLabel_(l.landed) : '', harbour: hb, left: 0, lots: [] };
    o.left = Math.round((o.left + left) * 100) / 100;
    o.lots.push({ lot: l.lot, left: left });
  });
  var products = Object.keys(byFish).map(function (name) {
    var f = cat[name], opts = Object.keys(byFish[name]).map(function (k) { return byFish[name][k]; });
    opts.sort(function (a, b) { return SIZES.indexOf(a.size) - SIZES.indexOf(b.size) || a.price - b.price; });
    var hbs = []; opts.forEach(function (o) { if (o.harbour && hbs.indexOf(o.harbour) === -1) hbs.push(o.harbour); });
    return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: name, en: f.en, mr: f.mr, group: f.group,
      origin: f.showOrigin ? (hbs.length ? hbs.join(' and ') : (f.from || '')) : '', showLeft: f.showLeft, showOrigin: f.showOrigin,
      cuts: f.cuts.length ? f.cuts : ['Whole'], yieldPct: f.yieldPct, options: opts,
      price: Math.min.apply(null, opts.map(function (o) { return o.price; })), left: opts.reduce(function (a, o) { return a + o.left; }, 0), available: true };
  });
  return { sc: sc, plan: plan, products: products, pending: pending };
}

// ---------- reading ----------
function rows_(name) {
  if (RC_['r:' + name]) return RC_['r:' + name];
  var values = sheet_(name).getDataRange().getValues();
  var head = values.shift().map(function (h) { return String(h).trim().toLowerCase(); });
  return (RC_['r:' + name] = values.map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  }));
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
function pinCheck_(pin) { return staff_(pin).chk; }
/** Which staff roles a PIN opens: the Delivery PIN opens deliveries, the Packing PIN opens packing. */
function staff_(pin) {
  var rider = String(setting_('Delivery PIN')).trim(), packer = String(setting_('Packing PIN')).trim();
  if (!rider && !packer) return { chk: 'off', roles: [] };
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badpin') || 0);
  if (bad >= 10) return { chk: 'locked', roles: [] };
  var p = String(pin || '').trim(), roles = [];
  if (p && p === rider) roles.push('delivery');
  if (p && p === packer) roles.push('packing');
  if (roles.length) return { chk: 'ok', roles: roles };
  cache.put('badpin', String(bad + 1), 600);
  return { chk: 'wrong', roles: [] };
}
/** Orders to clean, cut and pack, with their lines, plus a cutting list totalled by fish, size and cut. */
function packList_() {
  var sh = sheet_('Orders'), c = colIndex_(sh), v = sh.getDataRange().getDisplayValues(), want = {}, out = [];
  var get = function (r, k) { return c[k] ? r[c[k] - 1] : ''; };
  for (var i = 1; i < v.length; i++) {
    var st = String(get(v[i], 'Status')).trim(); if (st === 'Paid') st = 'Confirmed';
    if (st !== 'Confirmed' && st !== 'Packed') continue;
    var id = String(get(v[i], 'Order ID'));
    want[id] = { id: id, status: st, window: String(get(v[i], 'Window')), name: String(get(v[i], 'Name')).split(' ')[0], area: String(get(v[i], 'Area')),
      notes: String(get(v[i], 'Notes')), packedBy: String(get(v[i], 'Packed by') || ''), lines: [] };
    out.push(want[id]);
  }
  var cut = {};
  rows_('Order lines').forEach(function (l) {
    var o = want[String(l['order id'])]; if (!o) return;
    var item = String(l['item']), size = String(l['size'] || ''), pack = String(l['pack']), ct = String(l['cut']), kg = Number(l['kg']) || 0;
    var hit = o.lines.filter(function (x) { return x.item === item && x.size === size && x.pack === pack && x.cut === ct; })[0];
    if (hit) hit.kg += kg; else o.lines.push({ item: item, size: size, pack: pack, cut: ct, kg: kg });
    if (o.status === 'Confirmed') { var k = item + '|' + size + '|' + ct; cut[k] = cut[k] || { item: item, size: size, cut: ct, kg: 0 }; cut[k].kg += kg; }
  });
  out.forEach(function (o) { o.lines.forEach(function (x) { x.kg = Math.round(x.kg * 100) / 100; x.qty = Math.round(x.kg / (PACKS[x.pack] || 1)); }); });
  out.sort(function (a, b) { return a.window < b.window ? -1 : a.window > b.window ? 1 : a.id < b.id ? -1 : 1; });
  var cutList = Object.keys(cut).map(function (k) { cut[k].kg = Math.round(cut[k].kg * 100) / 100; return cut[k]; })
    .sort(function (a, b) { return a.item.localeCompare(b.item) || a.size.localeCompare(b.size); });
  return { orders: out, cutList: cutList };
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
      bill: String(get(v[i], 'Bill') || '') ? 'yes' : '', discount: Number(get(raw[i], 'Discount')) || 0, deliveredAt: String(get(v[i], 'Delivered at') || ''),
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
  bust_();
  var p = (e && e.parameter) || {};
  if (p.action === 'myorders') return json_({ ok: true, orders: myOrders_(String(p.ids || '')) });
  if (p.action === 'deliveries') {
    var st = staff_(p.pin);
    if (st.chk !== 'ok') return json_({ ok: false, error: st.chk === 'locked' ? 'locked' : 'pin' });
    var res = { ok: true, roles: st.roles };
    if (st.roles.indexOf('delivery') > -1) res.orders = deliveries_();
    if (st.roles.indexOf('packing') > -1) res.pack = packList_();
    return json_(res);
  }
  if (p.action === 'coupon') return json_(couponCheck_(p.code, p.phone, Number(p.sub) || 0));
  if (p.action === 'bill') return json_(customerBill_(String(p.id || ''), String(p.t || '')));
  var cache = CacheService.getScriptCache(), hit = cache.get('shop');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var out = JSON.stringify(shopOut_());
  try { cache.put('shop', out, 20); } catch (err) {}
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
function shopOut_() {
  var sh = shop_();
  return ({ ok: true, mode: 'catch', plan: { date: sh.plan.date, label: sh.plan.label, sameDay: sh.plan.sameDay, today: sh.plan.today },
    schedule: { start: hhmm_(sh.sc.start), end: hhmm_(sh.sc.end), cutoff: hhmm_(sh.sc.cutoff) }, pending: sh.pending,
    categories: categories_(false).map(function (c) { return { name: c.name, mr: c.mr }; }),
    deliveryFee: deliveryFee_(), upi: String(setting_('UPI ID')).trim(), payee: String(setting_('Payee name')).trim(),
    products: sh.products.map(function (p) { var q = JSON.parse(JSON.stringify(p)); q.options.forEach(function (o) { delete o.lots; }); return q; }) });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    bust_();
    var o = JSON.parse(e.postData.contents);
    if (['delivered', 'start', 'next', 'packed', 'unpack'].indexOf(o.action) > -1) return json_(stage_(o));
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
  var stf = staff_(o.pin), packing = o.action === 'packed' || o.action === 'unpack';
  if (stf.chk !== 'ok') return { ok: false, error: stf.chk === 'locked' ? 'locked' : 'pin' };
  if (stf.roles.indexOf(packing ? 'packing' : 'delivery') === -1) return { ok: false, error: 'role' };
  ensureSetup_();
  var sh = sheet_('Orders'), c = colIndex_(sh), n = Math.max(1, sh.getLastRow() - 1);
  var ids = sh.getRange(2, c['Order ID'], n, 1).getDisplayValues();
  var st = sh.getRange(2, c['Status'], n, 1).getValues();
  var want = o.action === 'start' ? (o.ids || []).slice(0, 60).map(String) : [String(o.id)];
  var time = now_(), done = 0;
  for (var i = 0; i < ids.length; i++) {
    if (want.indexOf(ids[i][0]) === -1) continue;
    var row = i + 2, cur = String(st[i][0]).trim();
    if (cur === 'Paid') { sh.getRange(row, c['Payment']).setValue('Paid'); cur = 'Confirmed'; }
    if (o.action === 'packed') {
      if (cur !== 'Confirmed') continue;
      sh.getRange(row, c['Status']).setValue('Packed');
      if (c['Packed by']) sh.getRange(row, c['Packed by']).setNumberFormat('@').setValue(String(o.by || 'Packing').slice(0, 30) + ', ' + time);
    } else if (o.action === 'unpack') {
      if (cur !== 'Packed') continue;
      sh.getRange(row, c['Status']).setValue('Confirmed');
      if (c['Packed by']) sh.getRange(row, c['Packed by']).setValue('');
    } else if (o.action === 'start') {
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
  if (done && packing) adminLog_(String(o.by || 'Packing'), o.id + ': ' + (o.action === 'packed' ? 'packed' : 'back to confirmed'));
  return done ? { ok: true, time: time, count: done } : { ok: false, error: 'notfound' };
}

function placeOrder_(o) {
  ensureSetup_();
  var name = String(o.name || '').trim().slice(0, 80);
  var phone = String(o.phone || '').replace(/[^0-9]/g, '').slice(-10);
  var address = String(o.address || '').trim().slice(0, 300);
  var area = String(o.area || '').trim().slice(0, 80);
  var notes = String(o.notes || '').trim().slice(0, 300);
  if (!name || phone.length !== 10 || !address) return { ok: false, error: 'details' };
  if (!o.items || !o.items.length || o.items.length > 30) return { ok: false, error: 'items' };
  var lat = Number(o.lat), lng = Number(o.lng);
  var map = (lat > 6 && lat < 37 && lng > 68 && lng < 98) ? 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lng.toFixed(6) : '';

  var shop = shop_(), w = shop.plan.label, byName = {};
  shop.products.forEach(function (p) { byName[p.name] = p; });
  var fresh = function () { return shop.products.map(function (p) { var q = JSON.parse(JSON.stringify(p)); q.options.forEach(function (x) { delete x.lots; }); return q; }); };

  // total kg wanted per option, then check against stock
  var want = {}, lines = [], short = [], parts = [];
  o.items.forEach(function (it) {
    var p = byName[String(it.name)], kgPer = PACKS[it.pack], qty = Math.floor(Number(it.qty));
    var opt = p && p.options.filter(function (x) { return x.key === String(it.key || ''); })[0];
    if (!p || !opt || !kgPer || !(qty >= 1 && qty <= MAX_QTY)) { short.push({ name: String(it.name), size: String(it.size || ''), left: opt ? opt.left : 0 }); return; }
    var k = p.name + '#' + opt.key;
    want[k] = (want[k] || 0) + kgPer * qty;
    var cut = p.cuts.indexOf(String(it.cut)) > -1 ? String(it.cut) : p.cuts[0];
    lines.push({ name: p.name, size: opt.size, pack: it.pack, cut: cut, qty: qty, kg: kgPer * qty, total: opt.price * kgPer * qty, opt: opt });
  });
  Object.keys(want).forEach(function (k) {
    var name = k.split('#')[0], key = k.slice(name.length + 1), opt = byName[name].options.filter(function (x) { return x.key === key; })[0];
    if (want[k] > opt.left + 1e-9) short.push({ name: name, size: opt.size, left: opt.left });
  });
  if (short.length) return { ok: false, error: 'stock', short: short, products: fresh() };
  dropShop_();
  // take stock from the oldest lot first
  lines.forEach(function (l) {
    var need = l.kg;
    l.opt.lots.forEach(function (lt) {
      if (need <= 1e-9 || lt.left <= 1e-9) return;
      var take = Math.min(need, lt.left); lt.left -= take; need -= take;
      parts.push({ line: l, lot: lt.lot, kg: Math.round(take * 100) / 100 });
    });
  });
  lines.forEach(function (l) { delete l.opt; });
  var sub = lines.reduce(function (a, l) { return a + l.total; }, 0);
  var fee = deliveryFee_(), cpn = null;
  if (cleanCode_(o.coupon)) {
    cpn = couponCheck_(o.coupon, phone, sub);
    if (!cpn.ok) return { ok: false, error: 'coupon', reason: cpn.error, min: cpn.min || 0 };
  }
  var disc = cpn ? cpn.discount : 0;
  var orders = sheet_('Orders'), c = colIndex_(orders), width = orders.getLastColumn();
  var id = 'BL' + Utilities.formatDate(new Date(), TZ, 'ddMM') + '-' + ('00' + orders.getLastRow()).slice(-3);
  var placed = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a');
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var summary = lines.map(function (l) { return l.name + (l.size ? ' (' + l.size + ')' : '') + ' ' + l.pack + ' ' + l.cut + ' x' + l.qty; }).join('; ');

  var values = {
    'Order ID': id, 'Placed at': placed, 'Window': w, 'Name': name, 'Mobile': phone, 'Address': address, 'Area': area,
    'Items': summary, 'Subtotal': sub, 'Delivery': fee, 'Total': sub - disc + fee, 'Status': 'New', 'Coupon': cpn ? cpn.code : '', 'Discount': disc || '', 'Notes': notes, 'Map': map, 'Token': token, 'Payment': 'Unpaid'
  };
  var row = orders.getLastRow() + 1, out = [];
  for (var i = 1; i <= width; i++) out.push('');
  Object.keys(values).forEach(function (k) { if (c[k]) out[c[k] - 1] = values[k]; });
  ['Order ID', 'Placed at', 'Window', 'Mobile'].forEach(function (k) { if (c[k]) orders.getRange(row, c[k]).setNumberFormat('@'); });
  ['Subtotal', 'Delivery', 'Total', 'Final amount'].forEach(function (k) { if (c[k]) orders.getRange(row, c[k]).setNumberFormat('"₹"#,##0'); });
  orders.getRange(row, 1, 1, width).setValues([out]);

  var ol = sheet_('Order lines'), oc = colIndex_(ol), start = ol.getLastRow() + 1, ow = ol.getLastColumn();
  var rowsOut = parts.map(function (pt, i) {
    var r = []; for (var j = 0; j < ow; j++) r.push('');
    var put = function (k, v) { if (oc[k]) r[oc[k] - 1] = v; };
    var whole = pt.kg === pt.line.kg;
    put('Order ID', id); put('Window', w); put('Item', pt.line.name); put('Pack', pt.line.pack); put('Cut', pt.line.cut);
    put('Qty', whole ? pt.line.qty : ''); put('Kg', pt.kg); put('Line total', Math.round(pt.line.total * pt.kg / pt.line.kg));
    put('Status', '=IFERROR(INDEX(Orders!$L:$L,MATCH($A' + (start + i) + ',Orders!$A:$A,0)),"")');
    put('Lot', pt.lot); put('Size', pt.line.size);
    return r;
  });
  ol.getRange(start, 1, rowsOut.length, 2).setNumberFormat('@');
  ol.getRange(start, 1, rowsOut.length, ow).setValues(rowsOut);

  return { ok: true, id: id, token: token, window: w, delivery: { date: shop.plan.date, sameDay: shop.plan.sameDay, today: shop.plan.today },
    schedule: { start: hhmm_(shop.sc.start), end: hhmm_(shop.sc.end) }, subtotal: sub, fee: fee, discount: disc, coupon: cpn ? cpn.code : '', total: sub - disc + fee, lines: lines };
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
      bill: String(g(disp[i], 'Bill') || ''), outAt: String(g(disp[i], 'Out at') || ''), deliveredAt: String(g(disp[i], 'Delivered at') || ''),
      coupon: String(g(disp[i], 'Coupon') || ''), discount: Number(g(raw[i], 'Discount')) || 0, packedBy: String(g(disp[i], 'Packed by') || '')
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
  var sc = sched_();
  return { fee: deliveryFee_(), upi: String(setting_('UPI ID')).trim(), payee: String(setting_('Payee name')).trim(),
    rider: String(setting_('Delivery person mobile')).trim(), fssai: String(setting_('FSSAI number')).trim(),
    pin: String(setting_('Delivery PIN')).trim(), packPin: String(setting_('Packing PIN')).trim(), start: hhmm_(sc.start), end: hhmm_(sc.end), cutoff: hhmm_(sc.cutoff),
    sellDays: sc.sellDays, discOn: sc.discOn, discPct: sc.discPct, showLanding: sc.showLanding, autoMin: sc.autoMin, autoOn: sc.autoOn, harbours: harbours_() };
}
function adminLoad_() {
  var sc = sched_(), plan = deliveryPlan_(sc), today = ymd_(), sold = soldByLot_(), soldToday = soldByLot_(today), adj = adjByLot_();
  var lots = lots_().filter(function (l) { return l.landed && dayDiff_(l.landed, today) <= Math.max(sc.sellDays + 2, 4); }).map(function (l) {
    var left = Math.round((l.kg - (sold[l.lot] || 0) + (adj[l.lot] || 0)) * 100) / 100;
    var expected = Math.round((l.kg - (soldToday[l.lot] || 0) + (adj[l.lot] || 0)) * 100) / 100;
    var lastDay = addDays_(l.landed, sc.sellDays - 1);
    var stage = l.status === 'Closed' ? 'Closed' : today > lastDay ? 'Ended' : isLive_(l, sc) ? 'Live' : 'Draft';
    return { lot: l.lot, landed: l.landed, landedLabel: landedLabel_(l.landed), fish: l.fish, size: l.size, pieces: l.pieces, kg: l.kg, cost: l.cost,
      price: l.price, offer: l.offer || 0, harbour: l.harbour, status: l.status, stage: stage, sold: Math.round((sold[l.lot] || 0) * 100) / 100, left: left, expected: expected,
      lastDay: lastDay, autoAt: l.status === 'Draft' ? l.enteredAt : '' };
  }).sort(function (a, b) { return a.landed < b.landed ? 1 : a.landed > b.landed ? -1 : a.fish.localeCompare(b.fish); });
  var cs = sheet_('Counts'), counts = [];
  if (cs && cs.getLastRow() > 1) counts = rows_('Counts').slice(-40).reverse().map(function (c) {
    return { time: String(c['time']), lot: String(c['lot']), fish: String(c['fish']), size: String(c['size'] || ''), expected: Number(c['expected kg']) || 0,
      waste: Number(c['waste kg']) || 0, counted: Number(c['counted kg']) || 0, gap: Number(c['gap kg']) || 0, pieces: c['pieces counted'], by: String(c['by']) };
  });
  return { ok: true, window: plan.label, plan: plan, orders: adminOrders_(), lots: lots, counts: counts, fish: catalog_(), categories: categories_(true),
    settings: adminSettings_(), coupons: adminCoupons_(), sizes: SIZES, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() };
}
function addLot_(o, by) {
  var cat = {}; catalog_().forEach(function (f) { cat[f.name] = f; });
  var fish = String(o.fish || '').trim(), size = String(o.size || '').trim();
  if (!cat[fish]) return { ok: false, error: 'nofish' };
  if (SIZES.indexOf(size) === -1) return { ok: false, error: 'bad' };
  var kgv = Number(o.kg), price = Number(o.price), pieces = o.pieces === '' || o.pieces == null ? '' : Math.round(Number(o.pieces));
  var cost = o.cost === '' || o.cost == null ? '' : Number(o.cost);
  if (!(kgv > 0 && kgv < 5000) || !(price > 0 && price < 100000)) return { ok: false, error: 'bad' };
  if (pieces !== '' && !(pieces >= 0 && pieces < 10000)) return { ok: false, error: 'bad' };
  if (cost !== '' && !(cost >= 0 && cost < 100000)) return { ok: false, error: 'bad' };
  var landed = normDate_(o.landed) || ymd_();
  var sh = sheet_('Stock'), c = colIndex_(sh), row = sh.getLastRow() + 1;
  var lot = 'L' + landed.replace(/-/g, '').slice(2) + '-' + ('00' + (row - 1)).slice(-3);
  var vals = { 'Lot': lot, 'Landed': landed, 'Fish': fish, 'Size': size, 'Pieces': pieces, 'Kg bought': kgv, 'Cost per kg': cost, 'Price per kg': price,
    'Harbour': String(o.harbour || '').slice(0, 40), 'Status': o.live ? 'Live' : 'Draft', 'Entered at': Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), 'Entered by': by };
  var out = []; for (var i = 1; i <= sh.getLastColumn(); i++) out.push('');
  Object.keys(vals).forEach(function (k) { if (c[k]) out[c[k] - 1] = vals[k]; });
  sh.getRange(row, c['Landed']).setNumberFormat('@'); sh.getRange(row, c['Entered at']).setNumberFormat('@'); sh.getRange(row, c['Lot']).setNumberFormat('@');
  sh.getRange(row, 1, 1, out.length).setValues([out]);
  if (o.updatePrice && cat[fish].price !== price && !size) { var ps = sheet_('Products'), pc = colIndex_(ps), pr = findRow_(ps, pc['Name'], fish); if (pr) ps.getRange(pr, pc['Price per kg']).setValue(price); }
  adminLog_(by, 'catch ' + lot + ': ' + fish + (size ? ' ' + size : '') + ', ' + kgv + ' kg' + (pieces !== '' ? ', ' + pieces + ' pcs' : '') + ', ' + price + '/kg');
  return { ok: true, lot: lot };
}
/** One fish, several sizes in one go. Nothing is saved unless every row is valid. */
function addLots_(o, by) {
  var rows = (o.rows || []).filter(function (r) { return r && String(r.kg || '').trim() !== ''; }).slice(0, 6);
  if (!rows.length) return { ok: false, error: 'bad' };
  var seen = {}, bad = false;
  rows.forEach(function (r) {
    var sz = String(r.size || '').trim(), kgv = Number(r.kg), pr = Number(r.price);
    if (seen[sz] || SIZES.indexOf(sz) === -1 || !(kgv > 0 && kgv < 5000) || !(pr > 0 && pr < 100000)) bad = true;
    if (r.pieces !== '' && r.pieces != null && !(Number(r.pieces) >= 0 && Number(r.pieces) < 10000)) bad = true;
    if (r.cost !== '' && r.cost != null && !(Number(r.cost) >= 0 && Number(r.cost) < 100000)) bad = true;
    seen[sz] = 1;
  });
  if (bad) return { ok: false, error: 'bad' };
  var ids = [];
  for (var i = 0; i < rows.length; i++) {
    var r = addLot_({ fish: o.fish, harbour: o.harbour, landed: o.landed, live: o.live, size: rows[i].size, kg: rows[i].kg, pieces: rows[i].pieces, cost: rows[i].cost, price: rows[i].price }, by);
    if (!r.ok) return ids.length ? { ok: true, lots: ids, partial: true } : r;
    ids.push(r.lot);
  }
  return { ok: true, lots: ids };
}
function editLot_(o, by) {
  var sh = sheet_('Stock'), c = colIndex_(sh), row = findRow_(sh, c['Lot'], o.lot);
  if (!row) return { ok: false, error: 'notfound' };
  var d = [];
  if (o.price !== undefined) { var p = Number(o.price); if (!(p > 0 && p < 100000)) return { ok: false, error: 'bad' }; sh.getRange(row, c['Price per kg']).setValue(p); d.push('price ' + p); }
  if (o.kg !== undefined) { var k = Number(o.kg); if (!(k > 0 && k < 5000)) return { ok: false, error: 'bad' }; sh.getRange(row, c['Kg bought']).setValue(k); d.push('kg bought ' + k); }
  if (o.pieces !== undefined) { var pc = o.pieces === '' ? '' : Math.round(Number(o.pieces)); sh.getRange(row, c['Pieces']).setValue(pc); d.push('pieces ' + pc); }
  if (o.offer !== undefined) { var of = Math.round(Number(o.offer) || 0); if (!(of >= 0 && of <= 90)) return { ok: false, error: 'bad' }; if (c['Offer %']) sh.getRange(row, c['Offer %']).setValue(of || ''); d.push(of ? 'offer ' + of + '%' : 'offer removed'); }
  if (o.status !== undefined) { if (['Draft', 'Live', 'Closed'].indexOf(o.status) === -1) return { ok: false, error: 'bad' }; sh.getRange(row, c['Status']).setValue(o.status); d.push(o.status); }
  adminLog_(by, 'catch ' + o.lot + ': ' + d.join(', '));
  return { ok: true };
}
function goLive_(by) {
  var sh = sheet_('Stock'), c = colIndex_(sh), n = sh.getLastRow() - 1, k = 0;
  if (n < 1) return { ok: true, count: 0 };
  var st = sh.getRange(2, c['Status'], n, 1).getValues();
  st.forEach(function (r) { if (String(r[0]).trim() === 'Draft') { r[0] = 'Live'; k++; } });
  sh.getRange(2, c['Status'], n, 1).setValues(st);
  adminLog_(by, 'go live: ' + k + ' catch entries');
  return { ok: true, count: k };
}
function count_(o, by) {
  var l = lots_().filter(function (x) { return x.lot === String(o.lot); })[0];
  if (!l) return { ok: false, error: 'notfound' };
  var counted = Number(o.counted), waste = o.waste === '' || o.waste == null ? 0 : Number(o.waste);
  if (!(counted >= 0 && counted < 5000) || !(waste >= 0 && waste < 5000)) return { ok: false, error: 'bad' };
  var today = ymd_(), soldToday = soldByLot_(today), adj = adjByLot_();
  var expected = Math.round((l.kg - (soldToday[l.lot] || 0) + (adj[l.lot] || 0)) * 100) / 100;
  var gap = Math.round((counted - (expected - waste)) * 100) / 100;
  var pcs = o.pieces === '' || o.pieces == null ? '' : Math.round(Number(o.pieces));
  var cs = sheet_('Counts');
  cs.appendRow([now_(), l.lot, l.fish, l.size, expected, waste, counted, gap, pcs, by, String(o.note || '').slice(0, 120)]);
  if (o.close) { var sh = sheet_('Stock'), c = colIndex_(sh), row = findRow_(sh, c['Lot'], l.lot); if (row) sh.getRange(row, c['Status']).setValue('Closed'); }
  adminLog_(by, 'count ' + l.lot + ': expected ' + expected + ' kg, waste ' + waste + ', counted ' + counted + ', gap ' + gap + (o.close ? ', closed' : ''));
  return { ok: true, expected: expected, gap: gap };
}
function saveFish_(o, by) {
  var name = String(o.name || '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'bad' };
  var ps = sheet_('Products'), c = colIndex_(ps), row = findRow_(ps, c['Name'], name), isNew = !row;
  if (isNew) row = ps.getLastRow() + 1;
  var set = function (k, v) { if (c[k] && v !== undefined) ps.getRange(row, c[k]).setValue(v); };
  set('Name', name);
  if (o.group !== undefined) set('Group', String(o.group).trim().slice(0, 40));
  if (o.en !== undefined) set('English name', String(o.en).trim().slice(0, 60));
  if (o.mr !== undefined) set('Marathi name', String(o.mr).trim().slice(0, 60));
  if (o.from !== undefined) set('From', String(o.from).trim().slice(0, 60));
  if (o.cuts !== undefined) set('Cuts', (o.cuts || []).map(function (x) { return String(x).trim(); }).filter(String).slice(0, 8).join(' | ') || 'Whole');
  if (o.price !== undefined && Number(o.price) > 0) set('Price per kg', Number(o.price));
  if (o.yieldPct !== undefined) set('Yield %', o.yieldPct === '' ? '' : Math.max(0, Math.min(100, Number(o.yieldPct))));
  if (o.showLeft !== undefined) set('Show kg left', o.showLeft ? 'Yes' : 'No');
  if (o.showOrigin !== undefined) set('Show origin', o.showOrigin ? 'Yes' : 'No');
  if (o.show !== undefined) set('Available', o.show ? 'Yes' : 'No');
  else if (isNew) set('Available', 'Yes');
  adminLog_(by, (isNew ? 'added fish ' : 'edited fish ') + name);
  return { ok: true };
}
function saveCategory_(o, by) {
  var name = String(o.name || '').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'bad' };
  var sh = tab_('Categories', CAT_COLS, CAT_SEED), c = colIndex_(sh), row = findRow_(sh, c['Category'], name), isNew = !row;
  if (isNew) row = sh.getLastRow() + 1;
  sh.getRange(row, c['Category']).setValue(name);
  if (o.mr !== undefined) sh.getRange(row, c['Marathi name']).setValue(String(o.mr).trim().slice(0, 40));
  if (o.order !== undefined) sh.getRange(row, c['Order']).setValue(Number(o.order) || 99);
  else if (isNew) sh.getRange(row, c['Order']).setValue(row);
  if (o.show !== undefined) sh.getRange(row, c['Show']).setValue(o.show ? 'Yes' : 'No');
  else if (isNew) sh.getRange(row, c['Show']).setValue('Yes');
  adminLog_(by, (isNew ? 'added category ' : 'edited category ') + name);
  return { ok: true };
}
// ---------- coupons ----------
function cleanCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20); }
function coupons_() {
  var sh = sheet_('Coupons'); if (!sh || sh.getLastRow() < 2) return [];
  return rows_('Coupons').filter(function (r) { return cleanCode_(r['code']); }).map(function (r) {
    var t = String(r['type (% or rs)'] || '%').trim();
    return { code: cleanCode_(r['code']), type: /^%/.test(t) ? '%' : 'Rs', value: Number(r['value']) || 0, min: Number(r['min order (rs)']) || 0,
      till: normDate_(r['valid till']) || '', perPhone: Number(r['uses per mobile']) || 0, max: Number(r['max uses']) || 0,
      active: !/^n/i.test(String(r['active']).trim()), note: String(r['note'] || '') };
  });
}
function couponUses_(code, phone) {
  var sh = sheet_('Orders'), c = colIndex_(sh), all = 0, mine = 0; if (!c['Coupon']) return { all: 0, mine: 0 };
  var v = sh.getDataRange().getDisplayValues();
  for (var i = 1; i < v.length; i++) {
    if (cleanCode_(v[i][c['Coupon'] - 1]) !== code || String(v[i][c['Status'] - 1]).trim() === 'Cancelled') continue;
    all++; if (phone && String(v[i][c['Mobile'] - 1]).replace(/[^0-9]/g, '').slice(-10) === phone) mine++;
  }
  return { all: all, mine: mine };
}
/** Checks a code for this mobile and subtotal. The discount never goes above the subtotal. */
function couponCheck_(code, phone, sub) {
  code = cleanCode_(code); phone = String(phone || '').replace(/[^0-9]/g, '').slice(-10);
  if (!code) return { ok: false, error: 'nocode' };
  var cp = coupons_().filter(function (x) { return x.code === code; })[0];
  if (!cp || !cp.active || !(cp.value > 0)) return { ok: false, error: 'nocode' };
  if (cp.till && ymd_() > cp.till) return { ok: false, error: 'expired' };
  if (sub < cp.min) return { ok: false, error: 'min', min: cp.min };
  var used = couponUses_(code, phone);
  if (cp.max && used.all >= cp.max) return { ok: false, error: 'limit' };
  if (cp.perPhone && phone.length === 10 && used.mine >= cp.perPhone) return { ok: false, error: 'used' };
  var off = cp.type === '%' ? Math.round(sub * Math.min(cp.value, 90) / 100) : Math.round(cp.value);
  off = Math.max(0, Math.min(off, sub));
  return { ok: true, code: code, discount: off, label: cp.type === '%' ? cp.value + '% off' : rupee_(cp.value) + ' off', min: cp.min };
}
function saveCoupon_(o, by) {
  var code = cleanCode_(o.code); if (code.length < 3) return { ok: false, error: 'bad' };
  var sh = tab_('Coupons', COUPON_COLS), c = colIndex_(sh), row = findRow_(sh, c['Code'], code), isNew = !row;
  if (isNew) { row = sh.getLastRow() + 1; sh.getRange(row, c['Code']).setNumberFormat('@').setValue(code); }
  var set = function (k, v) { if (c[k] && v !== undefined) sh.getRange(row, c[k]).setValue(v); };
  if (o.type !== undefined) set('Type (% or Rs)', o.type === 'Rs' ? 'Rs' : '%');
  if (o.value !== undefined) { var val = Number(o.value); if (!(val > 0 && val < 100000) || (o.type !== 'Rs' && val > 90)) return { ok: false, error: 'bad' }; set('Value', val); }
  if (o.min !== undefined) set('Min order (Rs)', Number(o.min) || 0);
  if (o.till !== undefined) { if (c['Valid till']) sh.getRange(row, c['Valid till']).setNumberFormat('@').setValue(normDate_(o.till) || ''); }
  if (o.perPhone !== undefined) set('Uses per mobile', Math.max(0, Math.round(Number(o.perPhone) || 0)) || '');
  if (o.max !== undefined) set('Max uses', Math.max(0, Math.round(Number(o.max) || 0)) || '');
  if (o.active !== undefined) set('Active', o.active ? 'Yes' : 'No'); else if (isNew) set('Active', 'Yes');
  if (o.note !== undefined) set('Note', String(o.note).slice(0, 80));
  adminLog_(by, (isNew ? 'added coupon ' : 'edited coupon ') + code);
  return { ok: true };
}
function adminCoupons_() {
  var sh = sheet_('Orders'), c = colIndex_(sh), used = {};
  if (c['Coupon']) sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    var k = cleanCode_(r[c['Coupon'] - 1]); if (k && String(r[c['Status'] - 1]).trim() !== 'Cancelled') used[k] = (used[k] || 0) + 1;
  });
  return coupons_().map(function (x) { x.used = used[x.code] || 0; x.expired = !!(x.till && ymd_() > x.till); return x; });
}

function harbours_() { return String(setting_('Harbours')).split(',').map(function (x) { return x.trim(); }).filter(String); }
function setSetting_(prefix, value) {
  var sh = sheet_('Settings'), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).indexOf(prefix) === 0) { sh.getRange(i + 1, 2).setNumberFormat('@').setValue(value); return true; }
  return false;
}
function admin_(o) {
  var chk = adminCheck_(o.pw);
  if (chk !== 'ok') return { ok: false, error: chk };
  ensureSetup_();
  var by = String(o.by || 'Admin').trim() || 'Admin';
  var withData = function (r) { if (r.ok) { dropShop_(); bust_(); r.data = adminLoad_(); } return r; };
  if (o.op === 'load') return adminLoad_();
  if (o.op === 'lot') return withData(addLot_(o, by));
  if (o.op === 'lots') return withData(addLots_(o, by));
  if (o.op === 'lotedit') return withData(editLot_(o, by));
  if (o.op === 'golive') return withData(goLive_(by));
  if (o.op === 'count') return withData(count_(o, by));
  if (o.op === 'fish') return withData(saveFish_(o, by));
  if (o.op === 'category') return withData(saveCategory_(o, by));
  if (o.op === 'coupon') return withData(saveCoupon_(o, by));
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
    if (o.status !== undefined) dropShop_();
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
    return { ok: true, product: adminProducts_(currentWindow_()).filter(function (p) { return p.name === String(o.name); })[0] };
  }
  if (o.op === 'settings') {
    var map = { fee: 'Delivery fee', upi: 'UPI ID', payee: 'Payee name', rider: 'Delivery person mobile', fssai: 'FSSAI number', pin: 'Delivery PIN', packPin: 'Packing PIN',
      start: 'Delivery starts', end: 'Delivery ends', cutoff: 'Same-day order cut-off', sellDays: 'Sell each catch for', discOn: 'Day-2 discount on',
      discPct: 'Day-2 discount (%', showLanding: 'Show landing date', autoMin: 'Go live automatically', autoOn: 'Auto go-live on', harbours: 'Harbours' };
    var sd = [];
    Object.keys(map).forEach(function (k) {
      if (o[k] === undefined) return;
      var v = typeof o[k] === 'boolean' ? (o[k] ? 'Yes' : 'No') : String(o[k]).trim().slice(0, 80);
      if (k === 'fee') { v = Number(v); if (!(v >= 0 && v < 10000)) return; }
      if ((k === 'pin' || k === 'packPin') && v && !/^[0-9]{4,8}$/.test(v)) return;
      if ((k === 'start' || k === 'end' || k === 'cutoff') && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v)) return;
      if (k === 'sellDays' && !(Number(v) >= 1 && Number(v) <= 7)) return;
      if (k === 'discPct' && !(Number(v) >= 0 && Number(v) <= 90)) return;
      if (k === 'autoMin' && !(Number(v) >= 0 && Number(v) <= 600)) return;
      if (k === 'harbours') v = String(o[k]).split(',').map(function (x) { return x.trim(); }).filter(String).slice(0, 20).join(', ').slice(0, 300);
      setSetting_(map[k], String(v)); sd.push(k);
    });
    adminLog_(by, 'settings: ' + sd.join(', '));
    dropShop_(); bust_();
    return { ok: true, settings: adminSettings_() };
  }
  if (o.op === 'bill') {
    var bs = sheet_('Orders'), bc = colIndex_(bs), brow = findRow_(bs, bc['Order ID'], o.id);
    if (!brow) return { ok: false, error: 'notfound' };
    var b = billFor_(bs, brow);
    adminLog_(by, o.id + ': bill made');
    return { ok: true, url: b.url, wa: b.wa, payable: b.payable, msg: b.msg, mobile: b.mobile, name: b.name, b64: b.b64 };
  }
  if (o.op === 'billpdf') {
    var bs2 = sheet_('Orders'), bc2 = colIndex_(bs2), brow2 = findRow_(bs2, bc2['Order ID'], o.id);
    if (!brow2) return { ok: false, error: 'notfound' };
    var pf = billFile_(String(bs2.getRange(brow2, bc2['Bill']).getValue()));
    if (!pf) return { ok: false, error: 'nobill' };
    return { ok: true, name: pf.getName(), b64: Utilities.base64Encode(pf.getBlob().getBytes()) };
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

  var disc = Number(get('Discount')) || 0, code = String(get('Coupon') || '');
  var rowsHtml = lines.map(function (l, i) {
    return '<tr><td>' + (i + 1) + '</td><td>' + esc_(l['item']) + '<br><span class="s">' + (l['size'] ? esc_(l['size']) + ', ' : '') + esc_(l['pack']) + ', ' + esc_(l['cut']) + '</span></td>' +
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
    '<table class="two"><tr><td><b>Bill</b><br>No. ' + esc_(id) + '<br>Date ' + today + '<br>Delivery ' + esc_(get('Window')) + '</td>' +
    '<td><b>Billed to</b><br>' + esc_(get('Name')) + '<br>' + esc_(mobile) + '<br>' + esc_(get('Address')) + (get('Area') ? ', ' + esc_(get('Area')) : '') + '</td></tr></table>' +
    '<table><tr><th>#</th><th>Item</th><th class="n">Qty</th><th class="n">Weight</th><th class="n">Amount</th></tr>' + rowsHtml + '</table>' +
    '<table class="tot"><tr><td class="n" style="width:80%">Subtotal</td><td class="n">' + inr_(sub) + '</td></tr>' +
    (disc ? '<tr><td class="n">Coupon ' + esc_(code) + '</td><td class="n">-' + inr_(disc) + '</td></tr>' : '') +
    '<tr><td class="n">Delivery</td><td class="n">' + inr_(fee) + '</td></tr>' +
    (adjust ? '<tr><td class="n">Adjustment for actual weight</td><td class="n">' + (adjust < 0 ? '-' : '') + inr_(Math.abs(adjust)) + '</td></tr>' : '') +
    '<tr class="big"><td class="n">Amount payable</td><td class="n">' + inr_(payable) + '</td></tr></table>' +
    '<p style="margin-top:18px">' + (isPaid_(get('Status'), get('Payment')) ? '<b>Paid.</b> Thank you.' : (upi ? 'Pay by UPI to <b>' + esc_(upi) + '</b>.' : 'Payment by UPI.')) + '</p>' +
    '<p class="s">This is not a GST tax invoice. Prices are per kg of whole fish, weighed before cleaning.</p></body></html>';

  var pdf = Utilities.newBlob(html, 'text/html', id + '.html').getAs('application/pdf').setName('Blio bill ' + id + '.pdf');
  var file = billsFolder_().createFile(pdf);   // stays private in the company Drive
  if (c['Bill']) sh.getRange(row, c['Bill']).setValue(file.getUrl());

  var payLink = 'https://blio.in/#pay?o=' + encodeURIComponent(id) + '&a=' + Math.round(payable);
  var msg = 'Hello ' + get('Name') + ', thank you for ordering from Blio.\n\nYour bill for order ' + id + ' is attached: ' + rupee_(payable) +
    (isPaid_(get('Status'), get('Payment')) ? '\n\nPayment received. Thank you!' : (upi ? '\n\nPay by UPI here: ' + payLink : ''));
  var wa = 'https://wa.me/91' + mobile + '?text=' + encodeURIComponent(msg);

  return { id: id, url: file.getUrl(), payable: payable, wa: mobile.length === 10 ? wa : '', upi: upi, msg: msg, mobile: mobile,
    name: 'Blio bill ' + id + '.pdf', b64: Utilities.base64Encode(pdf.getBytes()) };
}

function billFile_(url) {
  var m = String(url || '').match(/[-\w]{25,}/); if (!m) return null;
  try { return DriveApp.getFileById(m[0]); } catch (e) { return null; }
}
/** The customer's own bill as a PDF, only with the order's private token. */
function customerBill_(id, token) {
  var sh = sheet_('Orders'), c = colIndex_(sh), row = findRow_(sh, c['Order ID'], id);
  if (!row || !token || token.length < 12 || String(sh.getRange(row, c['Token']).getDisplayValue()) !== token) return { ok: false, error: 'notfound' };
  var f = billFile_(String(sh.getRange(row, c['Bill']).getValue()));
  if (!f) return { ok: false, error: 'nobill' };
  return { ok: true, name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) };
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
