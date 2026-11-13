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
 * POST action=partner     Blio Partner app (blio.in/partner): own work, open requests, take a shift (needs the partner's mobile and own PIN)
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
  'Total', 'Status', 'Notes', 'Map', 'Final amount', 'Bill', 'Delivered at', 'Token', 'Payment', 'Out at', 'Next at', 'Packed by', 'Coupon', 'Discount', 'Pay by', 'Collected', 'Bill date'];
var STATUSES = ['New', 'Confirmed', 'Packed', 'Collected', 'Out for delivery', 'Arriving next', 'Delivered', 'Cancelled'];
var TO_DELIVER = ['Confirmed', 'Packed', 'Collected', 'Out for delivery', 'Arriving next', 'Paid'];   // 'Paid' kept for orders from before the Payment column
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
  ['Packing PIN (4 to 8 digits)', ''],
  ['Partner delivery: per evening (₹)', 100],
  ['Partner delivery: per delivery (₹)', 15],
  ['Partner delivery: fuel per km (₹)', 2.1],
  ['Partner cleaning: per session (₹)', 100],
  ['Partner cleaning: per kg of fish (₹)', 10],
  ['Partner cleaning: per kg of prawns and crab (₹)', 25]
];
var PARTNER_COLS = ['Partner ID', 'Name', 'Mobile', 'Role', 'Area', 'UPI', 'PIN', 'Status', 'Joined', 'Verified', 'Consent', 'Note'];
var PREQ_COLS = ['Request ID', 'Role', 'Date', 'Time', 'Needed', 'Accepted', 'Status', 'Override rotation', 'Created at', 'By'];
var PLEDGER_COLS = ['Entry ID', 'Date', 'Partner ID', 'Role', 'Drops', 'Km', 'Fish kg', 'Prawn and crab kg', 'Pay', 'Rating', 'Status', 'Paid at', 'Request ID', 'Note', 'Added at'];
var PROLES = ['Delivery', 'Cleaning'];
var SETUP_VERSION = '2026-11-13a';   // change this when setup_ adds new tabs, columns or settings
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
  ensureHeaders_(sheet_('Order lines'), ['Order ID', 'Window', 'Item', 'Pack', 'Cut', 'Qty', 'Kg', 'Line total', 'Status', 'Lot', 'Size', 'List price', 'Off %']);
  ensureHeaders_(sheet_('Products'), ['Yield %', 'Show kg left', 'Show origin', 'Note for customers']);
  tab_('Stock', STOCK_COLS);
  tab_('Counts', COUNT_COLS);
  tab_('Categories', CAT_COLS, CAT_SEED);
  tab_('Coupons', COUPON_COLS);
  tab_('Partners', PARTNER_COLS);
  tab_('Partner requests', PREQ_COLS);
  tab_('Partner ledger', PLEDGER_COLS);
  try { tidyOrders_(); } catch (e) {}
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
      showLeft: !/^n/i.test(String(p['show kg left'] || '').trim()), showOrigin: !/^n/i.test(String(p['show origin'] || '').trim()),
      note: String(p['note for customers'] || '').trim() };
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
      origin: f.showOrigin ? (hbs.length ? hbs.join(' and ') : (f.from || '')) : '', showLeft: f.showLeft, showOrigin: f.showOrigin, note: f.note,
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
    want[id] = { id: id, status: st, window: String(get(v[i], 'Window')),
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
      status: st === 'Paid' ? 'Confirmed' : st, paid: isPaid_(st, get(r, 'Payment')), map: String(get(r, 'Map') || ''),
      payBy: String(get(r, 'Pay by') || 'On delivery')
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
      bill: String(get(v[i], 'Bill') || '') ? 'yes' : '', discount: Number(get(raw[i], 'Discount')) || 0, payBy: String(get(v[i], 'Pay by') || ''), deliveredAt: String(get(v[i], 'Delivered at') || ''),
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
  if (p.action === 'coupon') return json_(couponCheck_(p.code, p.phone, Number(p.sub) || 0, p.elig === undefined ? undefined : Number(p.elig) || 0));
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
    if (['delivered', 'start', 'next', 'packed', 'unpack', 'collect', 'uncollect'].indexOf(o.action) > -1) return json_(stage_(o));
    if (o.action === 'admin') return json_(admin_(o));
    if (o.action === 'partner') return json_(partner_(o));
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
    } else if (o.action === 'collect') {
      if (cur !== 'Packed') continue;
      sh.getRange(row, c['Status']).setValue('Collected');
    } else if (o.action === 'uncollect') {
      if (cur !== 'Collected') continue;
      sh.getRange(row, c['Status']).setValue('Packed');
    } else if (o.action === 'start') {
      if (cur !== 'Collected') continue;
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
      if (o.method === 'Cash' || o.method === 'UPI') {
        sh.getRange(row, c['Payment']).setValue('Paid');
        if (c['Collected']) sh.getRange(row, c['Collected']).setNumberFormat('@').setValue(o.method + ' ' + Math.round(Number(o.amount) || 0));
      }
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
    lines.push({ name: p.name, size: opt.size, pack: it.pack, cut: cut, qty: qty, kg: kgPer * qty, total: opt.price * kgPer * qty, price: opt.price, base: opt.base, off: opt.off || 0, opt: opt });
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
    var elig = lines.reduce(function (a, l) { return a + (l.off ? 0 : l.total); }, 0);
    cpn = couponCheck_(o.coupon, phone, sub, elig);
    if (!cpn.ok) return { ok: false, error: 'coupon', reason: cpn.error, min: cpn.min || 0 };
  }
  var disc = cpn ? cpn.discount : 0;
  var payBy = o.payBy === 'now' && String(setting_('UPI ID')).trim() ? 'Now (UPI)' : 'On delivery';
  var orders = sheet_('Orders'), c = colIndex_(orders), width = orders.getLastColumn();
  var id = nextBillNo_();
  var placed = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a');
  var token = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  var summary = lines.map(function (l) { return l.name + (l.size ? ' (' + l.size + ')' : '') + ' ' + l.pack + ' ' + l.cut + ' x' + l.qty; }).join('; ');

  var values = {
    'Order ID': id, 'Placed at': placed, 'Window': w, 'Name': name, 'Mobile': phone, 'Address': address, 'Area': area,
    'Items': summary, 'Subtotal': sub, 'Delivery': fee, 'Total': sub - disc + fee, 'Status': 'New', 'Coupon': cpn ? cpn.code : '', 'Discount': disc || '', 'Pay by': payBy, 'Notes': notes, 'Map': map, 'Token': token, 'Payment': 'Unpaid'
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
    put('Lot', pt.lot); put('Size', pt.line.size); if (pt.line.off) { put('List price', pt.line.base); put('Off %', pt.line.off); }
    return r;
  });
  ol.getRange(start, 1, rowsOut.length, 2).setNumberFormat('@');
  ol.getRange(start, 1, rowsOut.length, ow).setValues(rowsOut);

  return { ok: true, id: id, token: token, window: w, delivery: { date: shop.plan.date, sameDay: shop.plan.sameDay, today: shop.plan.today },
    schedule: { start: hhmm_(shop.sc.start), end: hhmm_(shop.sc.end) }, subtotal: sub, fee: fee, discount: disc, coupon: cpn ? cpn.code : '', payBy: payBy, total: sub - disc + fee, lines: lines };
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
      coupon: String(g(disp[i], 'Coupon') || ''), discount: Number(g(raw[i], 'Discount')) || 0, packedBy: String(g(disp[i], 'Packed by') || ''),
      payBy: String(g(disp[i], 'Pay by') || ''), collected: String(g(disp[i], 'Collected') || '')
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
    sellDays: sc.sellDays, discOn: sc.discOn, discPct: sc.discPct, showLanding: sc.showLanding, autoMin: sc.autoMin, autoOn: sc.autoOn, harbours: harbours_(),
    pEvening: partnerRates_().evening, pDrop: partnerRates_().drop, pFuel: partnerRates_().fuel, pSession: partnerRates_().session, pFish: partnerRates_().fish, pPrawn: partnerRates_().prawn };
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
    settings: adminSettings_(), coupons: adminCoupons_(), sizes: SIZES, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    partners: adminPartners_() };
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
  if (o.note !== undefined) set('Note for customers', String(o.note).trim().slice(0, 200));
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
/** sub is the whole subtotal (for the minimum order); elig is the part not already on offer, which is all the coupon takes off. */
function couponCheck_(code, phone, sub, elig) {
  if (elig === undefined || elig === null || isNaN(elig)) elig = sub;
  code = cleanCode_(code); phone = String(phone || '').replace(/[^0-9]/g, '').slice(-10);
  if (!code) return { ok: false, error: 'nocode' };
  var cp = coupons_().filter(function (x) { return x.code === code; })[0];
  if (!cp || !cp.active || !(cp.value > 0)) return { ok: false, error: 'nocode' };
  if (cp.till && ymd_() > cp.till) return { ok: false, error: 'expired' };
  if (sub < cp.min) return { ok: false, error: 'min', min: cp.min };
  var used = couponUses_(code, phone);
  if (cp.max && used.all >= cp.max) return { ok: false, error: 'limit' };
  if (cp.perPhone && phone.length === 10 && used.mine >= cp.perPhone) return { ok: false, error: 'used' };
  if (!(elig > 0)) return { ok: false, error: 'offeronly' };
  var off = cp.type === '%' ? Math.round(elig * Math.min(cp.value, 90) / 100) : Math.round(cp.value);
  off = Math.max(0, Math.min(off, elig));
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
  if (o.op === 'partner') return withData(savePartner_(o, by));
  if (o.op === 'rotcheck') return { ok: true, flagged: rotationFlagged_(String(o.role), String(o.date)) };
  if (o.op === 'prequest') return withData(saveRequest_(o, by));
  if (o.op === 'shift') return withData(addShift_(o, by));
  if (o.op === 'paypartner') return withData(payPartner_(o, by));
  if (o.op === 'voidshift') return withData(voidShift_(o, by));
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
      pEvening: 'Partner delivery: per evening', pDrop: 'Partner delivery: per delivery', pFuel: 'Partner delivery: fuel per km',
      pSession: 'Partner cleaning: per session', pFish: 'Partner cleaning: per kg of fish', pPrawn: 'Partner cleaning: per kg of prawns',
      discPct: 'Day-2 discount (%', showLanding: 'Show landing date', autoMin: 'Go live automatically', autoOn: 'Auto go-live on', harbours: 'Harbours' };
    var sd = [];
    Object.keys(map).forEach(function (k) {
      if (o[k] === undefined) return;
      var v = typeof o[k] === 'boolean' ? (o[k] ? 'Yes' : 'No') : String(o[k]).trim().slice(0, 80);
      if (k === 'fee') { v = Number(v); if (!(v >= 0 && v < 10000)) return; }
      if (/^p[A-Z]/.test(k)) { v = Number(v); if (isNaN(v) || !(v >= 0 && v < 10000)) return; }
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

// ---------- partner pool: delivery and cleaning partners, open requests, shifts and pay ----------
function digits10_(m) { return String(m || '').replace(/[^0-9]/g, '').slice(-10); }
function cap_(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
function partnerRates_() {
  var n = function (p, d) { var raw = String(setting_(p)).trim(), v = Number(raw); return raw === '' || isNaN(v) ? d : v; };
  return { evening: n('Partner delivery: per evening', 100), drop: n('Partner delivery: per delivery', 15), fuel: n('Partner delivery: fuel per km', 2.1),
    session: n('Partner cleaning: per session', 100), fish: n('Partner cleaning: per kg of fish', 10), prawn: n('Partner cleaning: per kg of prawns', 25) };
}
/** Pay for one evening or session from the rates in Settings. Delivery: base + per delivery + fuel for the route. Cleaning: base + per kg. */
function partnerPay_(role, e, r) {
  if (role === 'Cleaning') return Math.round(r.session + (Number(e.fishKg) || 0) * r.fish + (Number(e.prawnKg) || 0) * r.prawn);
  return Math.round(r.evening + (Number(e.drops) || 0) * r.drop + (Number(e.km) || 0) * r.fuel);
}
function partnerRows_() {
  var sh = sheet_('Partners'); if (!sh || sh.getLastRow() < 2) return [];
  return rows_('Partners').filter(function (r) { return String(r['partner id']).trim(); }).map(function (r, i) {
    return { row: i + 2, id: String(r['partner id']).trim(), name: String(r['name']), mobile: digits10_(r['mobile']), role: String(r['role']), area: String(r['area'] || ''),
      upi: String(r['upi'] || ''), pin: String(r['pin'] || '').trim(), status: String(r['status'] || 'Active').trim() || 'Active', joined: normDate_(r['joined']) || String(r['joined'] || ''),
      verified: String(r['verified'] || ''), consent: String(r['consent'] || ''), note: String(r['note'] || '') };
  });
}
function ledgerRows_() {
  var sh = sheet_('Partner ledger'); if (!sh || sh.getLastRow() < 2) return [];
  return rows_('Partner ledger').filter(function (r) { return String(r['entry id']).trim(); }).map(function (r) {
    return { id: String(r['entry id']).trim(), date: normDate_(r['date']) || String(r['date']), partner: String(r['partner id']).trim(), role: String(r['role']),
      drops: Number(r['drops']) || 0, km: Number(r['km']) || 0, fishKg: Number(r['fish kg']) || 0, prawnKg: Number(r['prawn and crab kg']) || 0, pay: Number(r['pay']) || 0,
      rating: Number(r['rating']) || 0, status: String(r['status'] || 'Due').trim() || 'Due', paidAt: String(r['paid at'] || ''), request: String(r['request id'] || ''), note: String(r['note'] || '') };
  });
}
function requestRows_() {
  var sh = sheet_('Partner requests'); if (!sh || sh.getLastRow() < 2) return [];
  return rows_('Partner requests').filter(function (r) { return String(r['request id']).trim(); }).map(function (r) {
    var acc = String(r['accepted'] || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    return { id: String(r['request id']).trim(), role: String(r['role']), date: normDate_(r['date']) || String(r['date']), time: String(r['time'] || ''), needed: Number(r['needed']) || 1,
      accepted: acc, status: String(r['status'] || 'Open').trim() || 'Open', override: /^y/i.test(String(r['override rotation'])), createdAt: String(r['created at'] || ''), by: String(r['by'] || '') };
  });
}
function nextId_(prefix, ids, width) {
  var max = 0; ids.forEach(function (x) { var m = String(x).match(/(\d+)$/); if (m && Number(m[1]) > max) max = Number(m[1]); });
  return prefix + ('0000' + (max + 1)).slice(-width);
}
/** Partners who worked each of the last two shift days before this date for this role: they rest this shift unless you override. */
function rotationFlagged_(role, date) {
  var led = ledgerRows_().filter(function (e) { return e.role === role && e.status !== 'Void' && e.date < date && dayDiff_(e.date, date) <= 14; });
  var days = []; led.forEach(function (e) { if (days.indexOf(e.date) === -1) days.push(e.date); });
  days.sort().reverse(); days = days.slice(0, 2);
  if (days.length < 2) return [];
  var names = {}; partnerRows_().forEach(function (p) { names[p.id] = p; });
  var out = [];
  Object.keys(names).forEach(function (id) {
    var p = names[id]; if (p.role !== role || p.status !== 'Active') return;
    var worked = days.filter(function (d) { return led.some(function (e) { return e.partner === id && e.date === d; }); });
    if (worked.length === 2) out.push({ id: id, name: p.name, days: days.slice().reverse() });
  });
  return out;
}
function ratingOf_(led, id) {
  var rs = led.filter(function (e) { return e.partner === id && e.rating > 0 && e.status !== 'Void'; });
  return { avg: rs.length ? Math.round(rs.reduce(function (a, e) { return a + e.rating; }, 0) / rs.length * 10) / 10 : 0, n: rs.length };
}
function adminPartners_() {
  var led = ledgerRows_(), month = ymd_().slice(0, 7);
  var list = partnerRows_().map(function (p) {
    var mine = led.filter(function (e) { return e.partner === p.id && e.status !== 'Void'; }), rt = ratingOf_(led, p.id);
    return { id: p.id, name: p.name, mobile: p.mobile, role: p.role, area: p.area, upi: p.upi, status: p.status, joined: p.joined, verified: p.verified, consent: p.consent, note: p.note,
      hasPin: !!p.pin, rating: rt.avg, ratings: rt.n, due: mine.filter(function (e) { return e.status === 'Due'; }).reduce(function (a, e) { return a + e.pay; }, 0),
      shifts: mine.filter(function (e) { return e.date.slice(0, 7) === month; }).length, drops: mine.filter(function (e) { return e.date.slice(0, 7) === month; }).reduce(function (a, e) { return a + e.drops; }, 0) };
  });
  var reqs = requestRows_().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1; }).slice(0, 30);
  var ledger = led.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1; }).slice(0, 200);
  return { list: list, requests: reqs, ledger: ledger, rates: partnerRates_(), roles: PROLES };
}
function savePartner_(o, by) {
  var sh = sheet_('Partners'), c = colIndex_(sh), all = partnerRows_(), cur = o.id ? all.filter(function (p) { return p.id === String(o.id); })[0] : null;
  if (o.id && !cur) return { ok: false, error: 'notfound' };
  var name = cap_(o.name !== undefined ? o.name : cur && cur.name, 60), mobile = digits10_(o.mobile !== undefined ? o.mobile : cur && cur.mobile);
  var role = String(o.role !== undefined ? o.role : cur && cur.role || ''), status = String(o.status !== undefined ? o.status : cur && cur.status || 'Active');
  if (!name) return { ok: false, error: 'name' };
  if (!/^[6-9][0-9]{9}$/.test(mobile)) return { ok: false, error: 'mobile' };
  if (PROLES.indexOf(role) === -1 || ['Active', 'Paused'].indexOf(status) === -1) return { ok: false, error: 'bad' };
  if (all.some(function (p) { return p.mobile === mobile && (!cur || p.id !== cur.id); })) return { ok: false, error: 'dup' };
  var pin = o.pin !== undefined && String(o.pin).trim() !== '' ? String(o.pin).trim() : (cur ? cur.pin : '');
  var gen = '';
  if (o.pin !== undefined && String(o.pin).trim() !== '' && !/^[0-9]{4,8}$/.test(pin)) return { ok: false, error: 'pin' };
  if (!pin || o.resetPin) { pin = String(1000 + Math.floor(Math.random() * 9000)); gen = pin; }
  var today = ymd_();
  var verified = o.verified === undefined ? (cur ? cur.verified : '') : (o.verified ? (cur && cur.verified ? cur.verified : 'Yes, ' + today + ', by ' + by) : '');
  var consent = o.consent === undefined ? (cur ? cur.consent : '') : (o.consent ? (cur && cur.consent ? cur.consent : 'Recorded ' + today) : '');
  var rec = { 'Name': name, 'Mobile': mobile, 'Role': role, 'Area': cap_(o.area !== undefined ? o.area : cur && cur.area, 40), 'UPI': cap_(o.upi !== undefined ? o.upi : cur && cur.upi, 60),
    'PIN': pin, 'Status': status, 'Verified': verified, 'Consent': consent, 'Note': cap_(o.note !== undefined ? o.note : cur && cur.note, 200) };
  var id, row;
  if (cur) { id = cur.id; row = findRow_(sh, c['Partner ID'], cur.id); }
  else { id = nextId_('P', all.map(function (p) { return p.id; }), 3); row = sh.getLastRow() + 1; sh.getRange(row, c['Partner ID']).setNumberFormat('@').setValue(id); sh.getRange(row, c['Joined']).setNumberFormat('@').setValue(today); }
  Object.keys(rec).forEach(function (k) { sh.getRange(row, c[k]).setNumberFormat('@').setValue(rec[k]); });
  bust_();
  adminLog_(by, 'partner ' + id + ' ' + name + (cur ? ': updated' : ': added') + (gen ? ', PIN set' : ''));
  return { ok: true, id: id, newPin: gen };
}
function saveRequest_(o, by) {
  var sh = sheet_('Partner requests'), c = colIndex_(sh), all = requestRows_();
  if (o.cancel) {
    var cur = all.filter(function (r) { return r.id === String(o.id); })[0]; if (!cur) return { ok: false, error: 'notfound' };
    var rw = findRow_(sh, c['Request ID'], cur.id); sh.getRange(rw, c['Status']).setValue('Cancelled'); bust_();
    adminLog_(by, 'request ' + cur.id + ': cancelled'); return { ok: true };
  }
  var role = String(o.role || ''), date = normDate_(o.date), needed = Math.round(Number(o.needed));
  if (PROLES.indexOf(role) === -1 || !date || date < ymd_() || !(needed >= 1 && needed <= 20)) return { ok: false, error: 'bad' };
  var id = nextId_('R', all.map(function (r) { return r.id; }), 3), row = sh.getLastRow() + 1;
  var vals = { 'Request ID': id, 'Role': role, 'Date': date, 'Time': cap_(o.time, 30), 'Needed': needed, 'Accepted': '', 'Status': 'Open', 'Override rotation': o.override ? 'Yes' : 'No', 'Created at': now_(), 'By': by };
  Object.keys(vals).forEach(function (k) { sh.getRange(row, c[k]).setNumberFormat('@').setValue(vals[k]); });
  bust_();
  var sent = partnerRows_().filter(function (p) { return p.role === role && p.status === 'Active'; });
  var flagged = o.override ? [] : rotationFlagged_(role, date);
  adminLog_(by, 'request ' + id + ': ' + role + ' ' + date + ' ' + cap_(o.time, 30) + ', ' + needed + ' needed');
  return { ok: true, id: id, sentTo: sent.length - flagged.length, rest: flagged };
}
function addShift_(o, by) {
  var p = partnerRows_().filter(function (x) { return x.id === String(o.partner); })[0]; if (!p) return { ok: false, error: 'notfound' };
  var date = normDate_(o.date); if (!date || date > ymd_()) return { ok: false, error: 'date' };
  var e = { drops: Math.round(Number(o.drops) || 0), km: Math.round((Number(o.km) || 0) * 10) / 10, fishKg: Math.round((Number(o.fishKg) || 0) * 10) / 10, prawnKg: Math.round((Number(o.prawnKg) || 0) * 10) / 10 };
  if (e.drops < 0 || e.drops > 100 || e.km < 0 || e.km > 300 || e.fishKg < 0 || e.fishKg > 500 || e.prawnKg < 0 || e.prawnKg > 500) return { ok: false, error: 'bad' };
  var rating = o.rating === undefined || o.rating === '' ? 0 : Number(o.rating); if (!(rating >= 0 && rating <= 5)) return { ok: false, error: 'bad' };
  var led = ledgerRows_();
  if (led.some(function (x) { return x.partner === p.id && x.date === date && x.status !== 'Void'; })) return { ok: false, error: 'dup' };
  var pay = o.pay === undefined || o.pay === '' || o.pay === null ? partnerPay_(p.role, e, partnerRates_()) : Math.round(Number(o.pay));
  if (!(pay >= 0 && pay < 100000)) return { ok: false, error: 'bad' };
  var sh = sheet_('Partner ledger'), c = colIndex_(sh), row = sh.getLastRow() + 1, id = nextId_('E', led.map(function (x) { return x.id; }), 4);
  var vals = { 'Entry ID': id, 'Date': date, 'Partner ID': p.id, 'Role': p.role, 'Drops': e.drops, 'Km': e.km, 'Fish kg': e.fishKg, 'Prawn and crab kg': e.prawnKg, 'Pay': pay,
    'Rating': rating || '', 'Status': 'Due', 'Paid at': '', 'Request ID': cap_(o.request, 12), 'Note': cap_(o.note, 120), 'Added at': now_() };
  Object.keys(vals).forEach(function (k) { sh.getRange(row, c[k]).setNumberFormat('@').setValue(vals[k]); });
  bust_();
  adminLog_(by, 'shift ' + id + ': ' + p.name + ' ' + date + ' Rs ' + pay);
  return { ok: true, id: id, pay: pay };
}
function payPartner_(o, by) {
  var p = partnerRows_().filter(function (x) { return x.id === String(o.partner); })[0]; if (!p) return { ok: false, error: 'notfound' };
  var sh = sheet_('Partner ledger'), c = colIndex_(sh), v = sh.getDataRange().getValues(), total = 0, n = 0, at = now_();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][c['Partner ID'] - 1]).trim() !== p.id || String(v[i][c['Status'] - 1]).trim() !== 'Due') continue;
    sh.getRange(i + 1, c['Status']).setValue('Paid'); sh.getRange(i + 1, c['Paid at']).setNumberFormat('@').setValue(at);
    total += Number(v[i][c['Pay'] - 1]) || 0; n++;
  }
  bust_();
  if (!n) return { ok: false, error: 'nothing' };
  adminLog_(by, 'paid ' + p.name + ': Rs ' + total + ' for ' + n + ' shifts');
  return { ok: true, paid: total, count: n };
}
function voidShift_(o, by) {
  var sh = sheet_('Partner ledger'), c = colIndex_(sh), row = findRow_(sh, c['Entry ID'], o.id); if (!row) return { ok: false, error: 'notfound' };
  if (String(sh.getRange(row, c['Status']).getValue()).trim() !== 'Due') return { ok: false, error: 'paid' };
  sh.getRange(row, c['Status']).setValue('Void'); bust_();
  adminLog_(by, 'shift ' + o.id + ': voided'); return { ok: true };
}

/** Partner app: each partner signs in with their mobile and their own PIN. 8 wrong tries on one mobile lock it for 10 minutes. */
function partnerAuth_(mobile, pin) {
  var m = digits10_(mobile), cache = CacheService.getScriptCache(), key = 'badp' + m;
  if (m.length !== 10) return { err: 'wrong' };
  if (Number(cache.get(key) || 0) >= 8) return { err: 'locked' };
  var p = partnerRows_().filter(function (x) { return x.mobile === m; })[0];
  if (!p || !p.pin || String(pin || '').trim() !== p.pin) { cache.put(key, String(Number(cache.get(key) || 0) + 1), 600); return { err: 'wrong' }; }
  if (p.status !== 'Active') return { err: 'paused' };
  return { p: p };
}
function partnerView_(p) {
  var led = ledgerRows_(), today = ymd_(), month = today.slice(0, 7), mine = led.filter(function (e) { return e.partner === p.id && e.status !== 'Void'; });
  var thisMonth = mine.filter(function (e) { return e.date.slice(0, 7) === month; }), rt = ratingOf_(led, p.id);
  var recent = mine.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).slice(0, 8)
    .map(function (e) { return { date: e.date, drops: e.drops, km: e.km, fishKg: e.fishKg, prawnKg: e.prawnKg, pay: e.pay, status: e.status, paidAt: e.paidAt, note: e.note }; });
  var reqs = requestRows_().filter(function (r) { return r.role === p.role && r.status !== 'Cancelled' && r.date >= today; });
  var open = [], taken = [];
  reqs.forEach(function (r) {
    var view = { id: r.id, role: r.role, date: r.date, day: dayName_(r.date), time: r.time, needed: r.needed, filled: r.accepted.length, status: r.status };
    if (r.accepted.indexOf(p.id) > -1) { taken.push(view); return; }
    if (r.status !== 'Open' || r.accepted.length >= r.needed) return;
    if (!r.override && rotationFlagged_(r.role, r.date).some(function (f) { return f.id === p.id; })) return;
    open.push(view);
  });
  var by = function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; };
  return { ok: true, me: { id: p.id, name: p.name, mobile: p.mobile, role: p.role, area: p.area, upi: p.upi, joined: p.joined, verified: !!p.verified, consent: !!p.consent },
    month: { label: month, shifts: thisMonth.length, drops: thisMonth.reduce(function (a, e) { return a + e.drops; }, 0), fishKg: Math.round(thisMonth.reduce(function (a, e) { return a + e.fishKg + e.prawnKg; }, 0) * 10) / 10 },
    rating: rt, due: mine.filter(function (e) { return e.status === 'Due'; }).reduce(function (a, e) { return a + e.pay; }, 0), recent: recent,
    open: open.sort(by), taken: taken.sort(by), rates: partnerRates_(), contact: String(setting_('Delivery person mobile')).trim() };
}
function partner_(o) {
  var a = partnerAuth_(o.mobile, o.pin);
  if (a.err) return { ok: false, error: a.err };
  var p = a.p;
  if (o.op === 'take') {
    var sh = sheet_('Partner requests'), c = colIndex_(sh), r = requestRows_().filter(function (x) { return x.id === String(o.id); })[0];
    if (!r || r.role !== p.role || r.status === 'Cancelled' || r.date < ymd_()) return { ok: false, error: 'gone' };
    if (r.accepted.indexOf(p.id) > -1) return partnerView_(p);
    if (r.status !== 'Open' || r.accepted.length >= r.needed) return { ok: false, error: 'filled' };
    if (!r.override && rotationFlagged_(r.role, r.date).some(function (f) { return f.id === p.id; })) return { ok: false, error: 'rest' };
    var row = findRow_(sh, c['Request ID'], r.id), acc = r.accepted.concat([p.id]);
    sh.getRange(row, c['Accepted']).setNumberFormat('@').setValue(acc.join(','));
    if (acc.length >= r.needed) sh.getRange(row, c['Status']).setValue('Filled');
    bust_(); adminLog_(p.name, 'took request ' + r.id + ' (' + acc.length + ' of ' + r.needed + ')');
    return partnerView_(p);
  }
  if (o.op === 'leave') {
    var sh2 = sheet_('Partner requests'), c2 = colIndex_(sh2), r2 = requestRows_().filter(function (x) { return x.id === String(o.id); })[0];
    if (!r2 || r2.accepted.indexOf(p.id) === -1 || r2.date <= ymd_()) return { ok: false, error: 'late' };
    var row2 = findRow_(sh2, c2['Request ID'], r2.id);
    sh2.getRange(row2, c2['Accepted']).setNumberFormat('@').setValue(r2.accepted.filter(function (x) { return x !== p.id; }).join(','));
    if (r2.status === 'Filled') sh2.getRange(row2, c2['Status']).setValue('Open');
    bust_(); adminLog_(p.name, 'left request ' + r2.id);
    return partnerView_(p);
  }
  if (o.op === 'upi') {
    var ps = sheet_('Partners'), pc = colIndex_(ps), prow = findRow_(ps, pc['Partner ID'], p.id), upi = cap_(o.upi, 60);
    if (upi && !/^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/.test(upi)) return { ok: false, error: 'upi' };
    ps.getRange(prow, pc['UPI']).setNumberFormat('@').setValue(upi); bust_(); p.upi = upi;
    return partnerView_(p);
  }
  return partnerView_(p);
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
/** Next bill/order number: BL-<yy>-<mm>-<count>, e.g. BL-26-11-0001. The count restarts at 0001 every month and is never reused. Call only while holding the script lock. */
function nextBillNo_() {
  var ym = Utilities.formatDate(new Date(), TZ, 'yy-MM');
  var p = PropertiesService.getScriptProperties(), key = 'billSeq' + ym;
  var n = (Number(p.getProperty(key)) || 0) + 1;
  p.setProperty(key, String(n));
  return 'BL-' + ym + '-' + ('000' + n).slice(-4);
}
/** '2026-10-29 Thu' -> '29 Oct 2026 (Thu)'. Anything else is shown as it is. */
function dayLabel_(w) {
  var m = String(w || '').match(/^(\d{4})-(\d{2})-(\d{2})\s*(\w{3})?/);
  if (!m) return String(w || '');
  var mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2]) - 1];
  return Number(m[3]) + ' ' + mon + ' ' + m[1] + (m[4] ? ' (' + m[4] + ')' : '');
}
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
  // The bill date is fixed the first time the bill is made; making the bill again keeps it.
  var today = String(get('Bill date') || '').trim();
  if (!today) {
    today = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy');
    if (c['Bill date']) { var bc = sh.getRange(row, c['Bill date']); bc.setNumberFormat('@'); bc.setValue(today); }
  }

  var disc = Number(get('Discount')) || 0, code = String(get('Coupon') || '');
  var rowsHtml = lines.map(function (l, i) {
    var lo = Number(l['off %']) || 0;
    return '<tr><td>' + (i + 1) + '</td><td>' + esc_(l['item']) + '<br><span class="s">' + (l['size'] ? esc_(l['size']) + ', ' : '') + esc_(l['pack']) + ', ' + esc_(l['cut']) +
      (lo ? '<br>' + lo + '% offer, list price ' + inr_(l['list price']) + '/kg' : '') + '</span></td>' +
      '<td class="n">' + esc_(l['qty']) + '</td><td class="n">' + esc_(l['kg']) + ' kg</td><td class="n">' + (Number(l['kg']) > 0 ? inr_(Number(l['line total']) / Number(l['kg'])) + '/kg' : '') + '</td><td class="n">' + inr_(l['line total']) + '</td></tr>';
  }).join('');

  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#12272C;font-size:12px;margin:28px}' +
    'h1{font-size:26px;margin:0;color:#12404A}.top{border-bottom:3px solid #12404A;padding-bottom:10px;margin-bottom:14px}' +
    '.s{color:#5A6B68;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:12px}' +
    'th{background:#12404A;color:#fff;text-align:left;padding:6px;font-size:11px}td{padding:6px;border-bottom:1px solid #DDD;vertical-align:top}' +
    '.n{text-align:right;white-space:nowrap}.tot td{border:0;padding:4px 6px}.big td{font-size:15px;font-weight:bold;border-top:2px solid #12404A}' +
    '.brand{width:100%;margin:0 0 8px}.brand td{border:0;padding:0}.two{width:100%;margin-top:6px}.two td{border:0;padding:0 0 4px 0;width:50%}</style></head><body>' +
    '<div class="top"><table class="brand"><tr><td><img src="data:image/png;base64,' + BLIO_LOGO_ + '" width="' + BLIO_LOGO_W_ + '" height="' + BLIO_LOGO_H_ + '"></td>' +
    '<td style="text-align:right"><img src="data:image/png;base64,' + FARMBLUE_LOGO_ + '" width="' + FARMBLUE_LOGO_W_ + '" height="' + FARMBLUE_LOGO_H_ + '"></td></tr></table><b>' + esc_(COMPANY.name) + '</b><br><span class="s">' + esc_(COMPANY.address) +
    '<br>CIN ' + COMPANY.cin + (fssai ? ' · FSSAI ' + esc_(fssai) : '') + '<br>' + esc_(COMPANY.contact) + '</span></div>' +
    '<table class="two"><tr><td><b>Bill</b><br>No. ' + esc_(id) + '<br>Bill date ' + esc_(today) + '<br>Delivery date ' + esc_(dayLabel_(get('Window'))) + '</td>' +
    '<td><b>Billed to</b><br>' + esc_(get('Name')) + '<br>' + esc_(mobile) + '<br>' + esc_(get('Address')) + (get('Area') ? ', ' + esc_(get('Area')) : '') + '</td></tr></table>' +
    '<table><tr><th>#</th><th>Item</th><th class="n">Qty</th><th class="n">Weight</th><th class="n">Rate</th><th class="n">Amount</th></tr>' + rowsHtml + '</table>' +
    '<table class="tot"><tr><td class="n" style="width:80%">Subtotal</td><td class="n">' + inr_(sub) + '</td></tr>' +
    (disc ? '<tr><td class="n">Coupon ' + esc_(code) + (lines.some(function (l) { return Number(l['off %']) > 0; }) ? ' (not on offer items)' : '') + '</td><td class="n">-' + inr_(disc) + '</td></tr>' : '') +
    '<tr><td class="n">Delivery</td><td class="n">' + inr_(fee) + '</td></tr>' +
    (adjust ? '<tr><td class="n">Adjustment for actual weight</td><td class="n">' + (adjust < 0 ? '-' : '') + inr_(Math.abs(adjust)) + '</td></tr>' : '') +
    '<tr class="big"><td class="n">Amount payable</td><td class="n">' + inr_(payable) + '</td></tr></table>' +
    '<p style="margin-top:18px">' + (isPaid_(get('Status'), get('Payment')) ? '<b>Paid' + (get('Collected') ? ' (' + esc_(String(get('Collected')).split(' ')[0]) + ' on delivery)' : '') + '.</b> Thank you.'
      : (String(get('Pay by')) === 'Now (UPI)' ? (upi ? 'Pay by UPI to <b>' + esc_(upi) + '</b>.' : 'Payment by UPI.') : 'Pay on delivery, by cash or UPI' + (upi ? ' to <b>' + esc_(upi) + '</b>' : '') + '.')) + '</p>' +
    '<p class="s">This is not a GST tax invoice. Prices are per kg of whole fish, weighed before cleaning. Coupons don’t apply to items already on offer.</p></body></html>';

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

// ---------- Logos printed on the bill (small PNGs, embedded so bills do not depend on any website) ----------
var BLIO_LOGO_W_ = 74, BLIO_LOGO_H_ = 40, FARMBLUE_LOGO_W_ = 149, FARMBLUE_LOGO_H_ = 34;
var BLIO_LOGO_ = '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';
var FARMBLUE_LOGO_ = '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';
