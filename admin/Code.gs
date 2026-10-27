/**
 * Blio admin: Google Apps Script behind the Blio web app.
 * Paste this into the admin sheet (Extensions > Apps Script) and deploy it as a web app.
 *
 * GET  -> products with price, availability and kg left for the current order window
 * POST -> saves an order after checking stock; prices always come from the sheet
 */

var TZ = 'Asia/Kolkata';
var ORDER_DAYS = [1, 3, 6];   // Monday, Wednesday, Saturday (0 = Sunday)
var CLOSE_HOUR = 18;          // orders close at 6 PM
var GROUPS = ['Fish', 'Prawns', 'Crabs and clams', 'Dried'];
var PACKS = { '500 g': 0.5, '1 kg': 1 };
var MAX_QTY = 20;

function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

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
function onOpen() { syncWindow_(); }

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

function settings_() {
  var fee = Number(sheet_('Settings').getRange('B3').getValue());
  return { deliveryFee: isNaN(fee) ? 40 : fee };
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet() {
  var w = syncWindow_();
  return json_({ ok: true, window: w, deliveryFee: settings_().deliveryFee, products: products_(w) });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    var o = JSON.parse(e.postData.contents);
    var name = String(o.name || '').trim().slice(0, 80);
    var phone = String(o.phone || '').replace(/[^0-9]/g, '').slice(-10);
    var address = String(o.address || '').trim().slice(0, 300);
    var area = String(o.area || '').trim().slice(0, 80);
    var notes = String(o.notes || '').trim().slice(0, 300);
    if (!name || phone.length !== 10 || !address) return json_({ ok: false, error: 'details' });
    if (!o.items || !o.items.length || o.items.length > 30) return json_({ ok: false, error: 'items' });

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
    if (short.length) return json_({ ok: false, error: 'stock', short: short, products: list });

    var sub = lines.reduce(function (a, l) { return a + l.total; }, 0);
    var fee = settings_().deliveryFee;
    var orders = sheet_('Orders');
    var id = 'BL' + Utilities.formatDate(new Date(), TZ, 'ddMM') + '-' + ('00' + orders.getLastRow()).slice(-3);
    var placed = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, h:mm a');
    var summary = lines.map(function (l) { return l.name + ' ' + l.pack + ' ' + l.cut + ' x' + l.qty; }).join('; ');

    var r = orders.getLastRow() + 1;
    orders.getRange(r, 1, 1, 13).setNumberFormats([['@', '@', '@', '@', '@', '@', '@', '@', '"₹"#,##0', '"₹"#,##0', '"₹"#,##0', '@', '@']])
      .setValues([[id, placed, w, name, phone, address, area, summary, sub, fee, sub + fee, 'New', notes]]);

    var ol = sheet_('Order lines'), start = ol.getLastRow() + 1;
    var rowsOut = lines.map(function (l, i) {
      var row = start + i;
      return [id, w, l.name, l.pack, l.cut, l.qty, l.kg, l.total,
        '=IFERROR(INDEX(Orders!$L:$L,MATCH($A' + row + ',Orders!$A:$A,0)),"")'];
    });
    ol.getRange(start, 1, rowsOut.length, 2).setNumberFormat('@');
    ol.getRange(start, 1, rowsOut.length, 9).setValues(rowsOut);

    return json_({ ok: true, id: id, window: w, subtotal: sub, fee: fee, total: sub + fee, lines: lines });
  } catch (err) {
    return json_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}
