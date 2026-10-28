/* Blio Admin: day-to-day running of Blio from a phone. Works on the same Google Sheet as the shop. */
(function () {
  'use strict';

  // Same web app address as the shop (app.js).
  var API = 'https://script.google.com/macros/s/AKfycbyYRFQbohQm2STP3hSZB6G3iq2kdop0Vw2XV3BN-cOfQev1-QHH16nxOgc57oWv1r8Y/exec';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), tabs = $('#tabs');
  function store(k, v) { try { if (v === undefined) { return JSON.parse(localStorage.getItem('blio.' + k)); } localStorage.setItem('blio.' + k, JSON.stringify(v)); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function kg(n) { return (Math.round(Number(n) * 10) / 10).toString().replace(/\.0$/, '') + ' kg'; }
  function winLabel(w) {
    var m = String(w || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\w+)/); if (!m) { return w || 'No window'; }
    return m[4] + ' ' + Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  }
  function b64File(b64, name) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
    return new File([arr], name || 'Blio bill.pdf', { type: 'application/pdf' });
  }
  /** Phones: opens the share menu with the PDF (pick WhatsApp, then the chat). Computers: downloads it. */
  function shareOrSave(file, text) {
    var touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share(text ? { files: [file], text: text } : { files: [file] }).catch(function () {});
      return;
    }
    var u = URL.createObjectURL(file), a = document.createElement('a');
    a.href = u; a.download = file.name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  }
  function timeOf(t) { var p = String(t || '').split(', '); return p[1] || p[0] || ''; }

  var STAGES = ['New', 'Confirmed', 'Packed', 'Collected', 'Out for delivery', 'Arriving next', 'Delivered', 'Cancelled'];
  var STAGE_CLS = { 'New': 'newo', 'Confirmed': 'conf', 'Packed': 'packed', 'Collected': 'packed', 'Out for delivery': 'out', 'Arriving next': 'next', 'Delivered': 'done', 'Cancelled': 'cancel' };
  var FILTERS = [['open', 'Open'], ['New', 'New'], ['Confirmed', 'Confirmed'], ['Packed', 'Packed'], ['Collected', 'Collected'], ['way', 'On the way'], ['Delivered', 'Delivered'], ['unpaid', 'Delivered, unpaid'], ['Cancelled', 'Cancelled'], ['all', 'All']];

  var S = {
    auth: store('admin') || null,       // { pw, by }
    tab: 'orders', data: null, loading: false, err: '', note: '',
    filter: 'open', win: '*', open: '', busy: {}, bills: {}, warn: '', openLot: '', addOpen: false, editFish: ''
  };

  // ---------- server ----------
  function call(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: 'admin', pw: S.auth.pw, by: S.auth.by }, body)) })
      .then(function (r) { return r.json(); });
  }
  function authFail(err) {
    var msg = { wrong: 'That password didn’t work.', locked: 'Too many wrong tries. Wait 10 minutes and try again.',
      setup: 'Set an Admin password (8 or more characters) in the Settings tab of the Google Sheet first.' }[err];
    if (!msg) { return false; }
    S.auth = null; store('admin', null); S.data = null; S.err = msg; render();
    return true;
  }
  function keepView(d) { S.data = d; }
  function load(quiet) {
    if (!S.auth || (quiet && S.justGot)) { return; }
    S.loading = true; if (!quiet) { render(); }
    call({ op: 'load' }).then(function (d) {
      S.loading = false;
      if (!d.ok) { if (!authFail(d.error)) { S.err = 'Couldn’t load. Try again.'; } render(); return; }
      S.data = d; S.err = '';
      render();
    }).catch(function () { S.loading = false; S.err = 'No connection. Check your internet and tap Refresh.'; render(); });
  }
  function act(key, body, onOk, failMsg) {
    S.busy[key] = true; S.err = ''; render();
    return call(body).then(function (d) {
      delete S.busy[key];
      if (d.ok) { if (d.data) { keepView(d.data); S.justGot = true; } onOk(d); S.justGot = false; } else if (!authFail(d.error)) { S.err = failMsg; }
      render();
    }).catch(function () { delete S.busy[key]; S.err = 'No connection. ' + failMsg; render(); });
  }
  function order(id) { return (S.data && S.data.orders || []).filter(function (o) { return o.id === id; })[0]; }
  function setOrder(id, change, label) {
    var o = order(id); if (!o) { return; }
    act(id, Object.assign({ op: 'order', id: id }, change), function () {
      if (change.status !== undefined) { o.status = change.status; }
      if (change.payment !== undefined) { o.paid = change.payment === 'Paid'; }
      if (change.final !== undefined) { o.final = change.final === '' ? '' : Number(change.final); }
      S.note = id + ': ' + label;
    }, 'Couldn’t update ' + id + '. Try again.');
  }

  // ---------- screens ----------
  function loginHtml() {
    var by = (S.auth && S.auth.by) || store('adminBy') || '';
    return '<div class="stack enter"><div class="dhead"><h1 class="anton">Admin</h1></div>' +
      '<div class="fld"><label for="a-by">Your name</label><input id="a-by" autocomplete="name" value="' + esc(by) + '" placeholder="Shown in the change log"></div>' +
      '<div class="fld"><label for="a-pw">Admin password</label><input id="a-pw" type="password" autocomplete="current-password" placeholder="From the Settings tab of the sheet"></div>' +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      '<button class="btn big press" data-act="login">Open Blio Admin</button>' +
      '<span class="muted-g">For the Farmblue team only.</span></div>';
  }

  function filterOrders(list) {
    return list.filter(function (o) {
      if (S.win && S.win !== '*' && o.window !== S.win) { return false; }
      if (S.filter === 'open') { return o.status !== 'Delivered' && o.status !== 'Cancelled'; }
      if (S.filter === 'unpaid') { return o.status === 'Delivered' && !o.paid; }
      if (S.filter === 'way') { return o.status === 'Out for delivery' || o.status === 'Arriving next'; }
      if (S.filter === 'all') { return true; }
      return o.status === S.filter;
    });
  }
  function nextActions(o) {
    switch (o.status) {
      case 'New': return [['Confirmed', 'Confirm'], ['Cancelled', 'Cancel']];
      case 'Confirmed': return [['Packed', 'Mark packed'], ['Cancelled', 'Cancel']];
      case 'Packed': return [['Collected', 'Mark collected']];
      case 'Collected': return [['Out for delivery', 'Out for delivery']];
      case 'Out for delivery': case 'Arriving next': return [['Delivered', 'Mark delivered']];
      default: return [];
    }
  }
  function orderCard(o) {
    var amount = o.final !== '' && o.final !== null && o.final !== undefined ? o.final : o.total;
    var openC = S.open === o.id, busy = !!S.busy[o.id], bill = S.bills[o.id];
    var head = '<button class="aorder-head" data-act="toggle" data-id="' + esc(o.id) + '" aria-expanded="' + openC + '">' +
      '<span class="ah1"><b>' + esc(o.name) + '</b><span class="num">' + rs(amount) + '</span></span>' +
      '<span class="ah2">' + esc(o.id) + (o.area ? ' · ' + esc(o.area) : '') + ' · ' + esc(timeOf(o.placed)) + '</span>' +
      '<span class="ah3"><span class="stage ' + (STAGE_CLS[o.status] || 'conf') + '">' + esc(o.status === 'Arriving next' ? 'Next stop' : o.status) + '</span>' +
      (o.status === 'Cancelled' ? '' : '<span class="ptag' + (o.paid ? ' paid' : '') + '">' + (o.paid ? 'Paid' + (o.collected ? ' · ' + esc(o.collected.split(' ')[0]) : '') : o.payBy === 'Now (UPI)' ? 'Unpaid · chose UPI now' : o.payBy ? 'Unpaid · pay on delivery' : 'Unpaid') + '</span>') + '</span></button>';
    if (!openC) { return '<div class="aorder">' + head + '</div>'; }
    var acts = nextActions(o).map(function (a) {
      return '<button class="btn ' + (a[0] === 'Cancelled' ? 'dark' : '') + ' press" data-act="stage" data-id="' + esc(o.id) + '" data-v="' + esc(a[0]) + '"' + (busy ? ' disabled' : '') + '>' + esc(a[1]) + '</button>';
    }).join('');
    var nav = o.map || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ', ' + o.area + ', Kolhapur'));
    return '<div class="aorder open">' + head + '<div class="abody">' +
      '<p class="ditems">' + esc(o.items) + '</p>' +
      '<p>' + esc(o.address) + (o.area ? ', ' + esc(o.area) : '') + (o.map ? ' · <a href="' + esc(o.map) + '" target="_blank" rel="noopener">pinned on map</a>' : '') + '</p>' +
      (o.notes ? '<p class="dnote">Note: ' + esc(o.notes) + '</p>' : '') +
      '<p class="dsub">Delivery ' + esc(winLabel(o.window)) + ' · placed ' + esc(o.placed) + (o.outAt ? ' · out ' + esc(timeOf(o.outAt)) : '') + (o.deliveredAt ? ' · delivered ' + esc(timeOf(o.deliveredAt)) : '') +
        (o.coupon ? ' · coupon ' + esc(o.coupon) + ' −' + rs(o.discount) : '') + (o.packedBy ? ' · packed by ' + esc(o.packedBy) : '') +
        (o.collected ? ' · collected at the door: ' + esc(o.collected.split(' ')[0]) + ' ' + rs(o.collected.split(' ')[1]) : '') + '</p>' +
      '<div class="dbtns"><a class="btn dark" href="tel:+91' + esc(o.mobile) + '">Call</a>' +
      '<a class="btn dark" href="https://wa.me/91' + esc(o.mobile) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn dark" href="' + esc(nav) + '" target="_blank" rel="noopener">Map</a></div>' +
      (acts ? '<div class="arow">' + acts + '</div>' : '') +
      '<div class="arow"><button class="btn dark press" data-act="pay" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' + (o.paid ? 'Mark unpaid' : 'Mark paid') + '</button>' +
        '<label class="asel"><span>Change status</span><select data-act="setstage" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' +
        STAGES.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="fld"><label for="fin-' + esc(o.id) + '">Final amount, if different (₹)</label>' +
        '<div class="arow"><input id="fin-' + esc(o.id) + '" class="ainput num" type="number" inputmode="numeric" min="0" placeholder="' + rs(o.total) + '" value="' + (o.final === '' || o.final === null || o.final === undefined ? '' : esc(o.final)) + '">' +
        '<button class="btn press" data-act="final" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>Save</button></div></div>' +
      '<div class="arow">' +
        (bill && bill.file ? '<button class="btn press" data-act="billshare" data-id="' + esc(o.id) + '">Send bill PDF</button>' : '') +
        (bill && bill.wa ? '<a class="btn dark" href="' + esc(bill.wa) + '" target="_blank" rel="noopener">WhatsApp message only</a>' : '') +
        (!(bill && bill.file) && o.bill ? '<button class="btn dark press" data-act="billfetch" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' + (S.busy[o.id] === 'fetch' ? 'Getting PDF…' : 'Get bill PDF') + '</button>' : '') +
        '<button class="btn ' + (bill ? 'dark ' : '') + 'press" data-act="bill" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' + (S.busy[o.id] === 'bill' ? 'Making bill…' : (bill || o.bill ? 'Make a new bill' : 'Make bill')) + '</button>' +
      '</div>' +
      (busy ? '<span class="muted-g">Saving…</span>' : '') +
      '</div></div>';
  }
  /** Money taken at the door today, so the delivery person's cash can be checked. */
  function cashHtml(all) {
    var d = new Date(), n = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000);
    var tag = ('0' + n.getDate()).slice(-2) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][n.getMonth()] + ' ' + n.getFullYear();
    var cash = 0, upi = 0, nc = 0, nu = 0;
    all.forEach(function (o) {
      if (!o.collected || String(o.deliveredAt).indexOf(tag) !== 0) { return; }
      var p = o.collected.split(' '), amt = Number(p[1]) || 0;
      if (p[0] === 'Cash') { cash += amt; nc++; } else if (p[0] === 'UPI') { upi += amt; nu++; }
    });
    if (!nc && !nu) { return ''; }
    return '<div class="box">Collected at the door today: <b class="num">' + rs(cash) + ' cash</b> (' + nc + ')' + ' · <b class="num">' + rs(upi) + ' UPI</b> (' + nu + ')</div>';
  }
  function ordersHtml() {
    var all = S.data.orders || [];
    var wins = []; all.forEach(function (o) { if (o.window && wins.indexOf(o.window) === -1) { wins.push(o.window); } });
    if (S.data.window && wins.indexOf(S.data.window) === -1) { wins.unshift(S.data.window); }
    wins.sort().reverse();
    var count = function (f) { var keep = S.filter; S.filter = f; var n = filterOrders(all).length; S.filter = keep; return n; };
    var list = filterOrders(all);
    return '<div class="stack">' +
      '<div class="dhead"><h1 class="anton">Orders</h1><button class="linkbtn" data-act="refresh">' + (S.loading ? 'Refreshing…' : 'Refresh') + '</button></div>' +
      ('<div class="chiprow" role="group" aria-label="Delivery day">' + wins.map(function (w) {
        return '<button class="chip" data-act="win" data-v="' + esc(w) + '" aria-pressed="' + (S.win === w) + '">' + esc(winLabel(w)) + (w === S.data.window ? ' · next' : '') + '</button>';
      }).join('') + '<button class="chip" data-act="win" data-v="*" aria-pressed="' + (S.win === '*') + '">All days</button></div>') +
      '<div class="chiprow" role="group" aria-label="Stage">' + FILTERS.map(function (f) {
        return '<button class="chip" data-act="filter" data-v="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + ' <span class="cnt">' + count(f[0]) + '</span></button>';
      }).join('') + '</div>' + cashHtml(all) +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      (list.length ? list.map(orderCard).join('') : '<div class="box">No orders here.</div>') +
      '</div>';
  }

  // ---------- stock: catches bought at the auction ----------
  function today() { var d = new Date(); var n = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000); return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2); }
  function sizeName(s) { return s || 'One size'; }
  function msgBoxes() {
    return (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.warn ? '<div class="box warn" role="alert">' + esc(S.warn) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '');
  }
  function addCatchHtml() {
    var fish = (S.data.fish || []).slice().sort(function (a, b) { return a.group.localeCompare(b.group) || a.name.localeCompare(b.name); });
    var groups = {}; fish.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    var st = S.data.settings || {}, hbs = st.harbours || [], last = store('lastHarbour') || '', busy = !!S.busy.lot;
    var sizes = ['Small to medium', 'Medium to big', ''];
    return '<div class="aform" id="addcatch"><div class="ah1"><b>Add catch</b><button class="linkbtn dk" data-act="addclose">Close</button></div>' +
      '<label class="afl"><span>Fish</span><select class="ainput" id="c-fish"><option value="">Choose a fish</option>' +
        Object.keys(groups).map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (f) { return '<option value="' + esc(f.name) + '" data-price="' + esc(f.price || '') + '">' + esc(f.name) + (f.en ? ' (' + esc(f.en) + ')' : '') + '</option>'; }).join('') + '</optgroup>'; }).join('') +
      '</select></label>' +
      '<div class="agrid"><label><span>Harbour</span><select class="ainput" id="c-harbour"><option value="">Not set</option>' +
          hbs.map(function (h) { return '<option' + (h === last ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('') +
          (last && hbs.indexOf(last) === -1 ? '<option selected>' + esc(last) + '</option>' : '') + '<option value="*">Other…</option></select></label>' +
        '<label><span>Landed on</span><input class="ainput" id="c-landed" type="date" value="' + today() + '"></label></div>' +
      '<label class="afl" id="c-other-wrap" hidden><span>Other harbour</span><input class="ainput" id="c-other" placeholder="Harbour name"></label>' +
      sizes.map(function (sz, i) {
        return '<div class="asize" data-size="' + esc(sz) + '"><b>' + esc(sizeName(sz)) + '</b>' +
          '<div class="agrid g4"><label><span>Kg (whole)</span><input class="ainput num" data-f="kg" type="number" inputmode="decimal" min="0" step="0.1"></label>' +
          '<label><span>No. of fish</span><input class="ainput num" data-f="pieces" type="number" inputmode="numeric" min="0"></label>' +
          '<label><span>Cost/kg ₹</span><input class="ainput num" data-f="cost" type="number" inputmode="decimal" min="0"></label>' +
          '<label><span>Sell/kg ₹</span><input class="ainput num" data-f="price" type="number" inputmode="numeric" min="1"></label></div></div>';
      }).join('') +
      '<span class="dsub">Fill only the sizes you bought. Leave the others empty.</span>' +
      '<label class="acheck"><input type="checkbox" id="c-live"> Go live now' + (st.autoOn ? ' (skip the ' + esc(st.autoMin) + '-minute wait)' : '') + '</label>' +
      '<button class="btn press" data-act="savelot"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save catch') + '</button>' +
      '<span class="dsub">' + (st.autoOn ? (Number(st.autoMin) ? 'If not ticked, customers see it ' + esc(st.autoMin) + ' minutes after you save, or when you tap Go live.' : 'Customers see it right away.')
        : 'If not ticked, it waits until you tap Go live on the Stock tab.') + '</span></div>';
  }
  function lotCard(l) {
    var open = S.openLot === l.lot, busy = !!S.busy[l.lot];
    var tag = { Draft: 'newo', Live: 'conf', Ended: 'done', Closed: 'cancel' }[l.stage] || 'conf';
    var margin = l.cost !== '' && l.cost !== null && Number(l.cost) > 0 ? Math.round((l.price - l.cost) / l.price * 100) : null;
    var offPrice = l.offer ? Math.round(l.price * (1 - l.offer / 100)) : l.price;
    var st = S.data.settings || {}, plan = S.data.plan || {}, d2 = st.discOn && plan.date && plan.date > l.landed ? Number(st.discPct) || 0 : 0;
    var nowOff = Math.max(d2, l.offer || 0), nowPrice = nowOff ? Math.round(l.price * (1 - nowOff / 100)) : l.price;
    var offMargin = margin !== null && l.offer ? Math.round((offPrice - l.cost) / offPrice * 100) : null, offLoss = offMargin !== null && offPrice < Number(l.cost);
    var head = '<button class="aorder-head" data-act="lot" data-id="' + esc(l.lot) + '" aria-expanded="' + open + '">' +
      '<span class="ah1"><b>' + esc(l.fish) + (l.size ? ' · ' + esc(l.size.toLowerCase()) : '') + '</b><span class="num">' + (nowPrice < l.price ? '<s class="was">' + rs(l.price) + '</s>' + rs(nowPrice) : rs(l.price)) + '/kg</span></span>' +
      '<span class="ah2">' + esc(l.landedLabel) + (l.harbour ? ' · ' + esc(l.harbour) : '') + ' · ' + esc(l.lot) + '</span>' +
      '<span class="ah2 num">Bought ' + kg(l.kg) + (l.pieces !== '' && l.pieces !== null ? ' (' + l.pieces + ' fish)' : '') + ' · sold ' + kg(l.sold) + ' · <b>left ' + kg(l.left) + '</b></span>' +
      '<span class="ah3"><span class="stage ' + tag + '">' + esc(l.stage === 'Draft' ? 'Waiting to go live' : l.stage === 'Ended' ? 'Selling ended' : l.stage) + '</span>' +
        (margin !== null ? '<span class="ptag' + (offLoss ? ' loss' : '') + '">Cost ' + rs(l.cost) + ' · ' + margin + '% margin' +
          (l.offer ? ' · ' + (offLoss ? 'below cost at offer' : offMargin + '% at offer') : '') + '</span>' : '') +
        (l.offer ? '<span class="ptag offer">Offer ' + l.offer + '%</span>' : '') + '</span></button>';
    if (!open) { return '<div class="aorder">' + head + '</div>'; }
    var gapTol = Math.max(0.3, l.expected * 0.02);
    return '<div class="aorder open">' + head + '<div class="abody">' +
      '<span class="dsub">Sells until ' + esc(dayLabel(l.lastDay)) + '. Kg sold counts every order except cancelled ones.</span>' +
      '<div class="agrid" data-lot="' + esc(l.lot) + '"><label><span>Selling price per kg (₹)</span><input class="ainput num" data-f="price" type="number" inputmode="numeric" value="' + esc(l.price) + '"></label>' +
        '<label><span>Kg bought</span><input class="ainput num" data-f="kg" type="number" inputmode="decimal" step="0.1" value="' + esc(l.kg) + '"></label>' +
        '<label><span>Number of fish</span><input class="ainput num" data-f="pieces" type="number" inputmode="numeric" value="' + esc(l.pieces) + '"></label>' +
        '<label><span>Offer % (shown in Today’s offers)</span><input class="ainput num" data-f="offer" type="number" inputmode="numeric" min="0" max="90" placeholder="No offer" value="' + (l.offer ? esc(l.offer) : '') + '"></label>' +
        '<label class="span2"><button class="btn press" data-act="editlot" data-id="' + esc(l.lot) + '"' + (busy ? ' disabled' : '') + '>Save changes</button></label></div>' +
      '<div class="arow">' +
        (l.stage === 'Draft' ? '<button class="btn press" data-act="lotstatus" data-id="' + esc(l.lot) + '" data-v="Live"' + (busy ? ' disabled' : '') + '>Go live now</button>' : '') +
        (l.stage === 'Live' || l.stage === 'Draft' ? '<button class="btn dark press" data-act="lotstatus" data-id="' + esc(l.lot) + '" data-v="Closed"' + (busy ? ' disabled' : '') + '>Stop selling</button>' : '') +
        (l.stage === 'Closed' ? '<button class="btn dark press" data-act="lotstatus" data-id="' + esc(l.lot) + '" data-v="Live"' + (busy ? ' disabled' : '') + '>Sell again</button>' : '') +
      '</div>' +
      '<div class="acount" data-lot="' + esc(l.lot) + '"><b>End-of-day count</b>' +
        '<span class="dsub">Weigh what is left in the cold box. It should be about <b class="num">' + kg(l.expected) + '</b> (bought, minus orders for today and earlier, plus earlier count changes). A gap over ' + kg(gapTol) + ' is flagged.</span>' +
        '<div class="agrid"><label><span>Kg on hand now</span><input class="ainput num" data-f="counted" type="number" inputmode="decimal" step="0.1"></label>' +
          '<label><span>Kg thrown away</span><input class="ainput num" data-f="waste" type="number" inputmode="decimal" step="0.1" placeholder="0"></label>' +
          '<label><span>Fish counted</span><input class="ainput num" data-f="pieces" type="number" inputmode="numeric" placeholder="Optional"></label>' +
          '<label><span>Note</span><input class="ainput" data-f="note" placeholder="Optional"></label></div>' +
        '<label class="acheck"><input type="checkbox" data-f="close"> Nothing left to sell, close this catch</label>' +
        '<button class="btn press" data-act="count" data-id="' + esc(l.lot) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save count') + '</button></div>' +
      '</div></div>';
  }
  function dayLabel(ds) {
    var p = String(ds || '').split('-'); if (p.length !== 3) { return ds || ''; }
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + (+p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
  }
  function stockHtml() {
    var lots = S.data.lots || [], plan = S.data.plan || {};
    var drafts = lots.filter(function (l) { return l.stage === 'Draft'; });
    var sec = function (title, list) { return list.length ? '<h2 class="osec">' + title + '</h2>' + list.map(lotCard).join('') : ''; };
    var counts = (S.data.counts || []).slice(0, 12);
    return '<div class="stack"><div class="dhead"><h1 class="anton">Stock</h1><button class="linkbtn" data-act="refresh">' + (S.loading ? 'Refreshing…' : 'Refresh') + '</button></div>' +
      '<span class="muted-g" style="text-align:left">Orders now go out ' + (plan.sameDay ? 'this evening' : 'tomorrow evening') + ' (' + esc(dayLabel(plan.date)) + ').</span>' +
      msgBoxes() +
      (drafts.length ? '<div class="box">' + drafts.length + (drafts.length === 1 ? ' entry is' : ' entries are') + ' waiting to go live. ' + (S.data.settings.autoOn ? 'Check the prices, then go live, or they go live by themselves.' : 'Customers can’t see ' + (drafts.length === 1 ? 'it' : 'them') + ' until you tap Go live.') +
        '<button class="btn press" style="margin-top:12px;width:100%" data-act="golive"' + (S.busy.golive ? ' disabled' : '') + '>' + (S.busy.golive ? 'Going live…' : 'Go live now') + '</button></div>' : '') +
      (S.addOpen ? addCatchHtml() : '<button class="btn big press" data-act="addopen">Add catch</button>') +
      sec('Waiting to go live', drafts) +
      sec('On sale', lots.filter(function (l) { return l.stage === 'Live'; })) +
      sec('Ended or stopped', lots.filter(function (l) { return l.stage === 'Ended' || l.stage === 'Closed'; })) +
      (!lots.length ? '<div class="box">No catch entered in the last few days. Tap Add catch after the auction.</div>' : '') +
      (counts.length ? '<h2 class="osec">Recent counts</h2><div class="abuy">' + counts.map(function (c) {
        var tol = Math.max(0.3, c.expected * 0.02), bad = c.gap < -tol;
        return '<div><span>' + esc(c.fish) + (c.size ? ' · ' + esc(c.size.toLowerCase()) : '') + '<small class="dsub" style="display:block">' + esc(c.time) + ' · ' + esc(c.by) + '</small></span>' +
          '<b class="num' + (bad ? ' gapbad' : '') + '">' + (c.gap > 0 ? '+' : '') + kg(c.gap) + '</b></div>';
      }).join('') + '</div><span class="muted-g" style="text-align:left">Gap is counted minus expected, after what was thrown away. Red means fish is missing.</span>' : '') +
      '</div>';
  }

  // ---------- fish list and categories ----------
  function fishForm(f) {
    var cats = S.data.categories || [], isNew = !f.name, busy = !!S.busy.fish;
    return '<div class="aform" id="fishform"><div class="ah1"><b>' + (isNew ? 'Add a fish' : esc(f.name)) + '</b><button class="linkbtn dk" data-act="fishclose">Close</button></div>' +
      (isNew ? '<label class="afl"><span>Name customers see</span><input class="ainput" id="f-name" placeholder="For example Surmai"></label>' : '') +
      '<label class="afl"><span>Category</span><select class="ainput" id="f-group">' + cats.map(function (c) { return '<option' + (c.name === f.group ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<div class="agrid"><label><span>English name</span><input class="ainput" id="f-en" value="' + esc(f.en) + '" placeholder="King fish"></label>' +
        '<label><span>Marathi name</span><input class="ainput" id="f-mr" value="' + esc(f.mr) + '" placeholder="सुरमई"></label>' +
        '<label><span>Usual price per kg (₹)</span><input class="ainput num" id="f-price" type="number" inputmode="numeric" value="' + esc(f.price || '') + '"></label>' +
        '<label><span>Left after cleaning (%)</span><input class="ainput num" id="f-yield" type="number" inputmode="numeric" min="0" max="100" value="' + esc(f.yieldPct || '') + '" placeholder="Optional, like 70"></label></div>' +
      '<label class="afl"><span>Comes from</span><input class="ainput" id="f-from" value="' + esc(f.from) + '" placeholder="the Konkan coast"></label>' +
      '<label class="afl"><span>Cuts, separated by commas</span><input class="ainput" id="f-cuts" value="' + esc((f.cuts || ['Whole', 'Curry cut']).join(', ')) + '"></label>' +
      '<label class="acheck"><input type="checkbox" id="f-show"' + (f.show === false ? '' : ' checked') + '> Show in the shop when there is a catch</label>' +
      '<label class="acheck"><input type="checkbox" id="f-left"' + (f.showLeft === false ? '' : ' checked') + '> Show customers how many kg are left</label>' +
      '<label class="acheck"><input type="checkbox" id="f-origin"' + (f.showOrigin === false ? '' : ' checked') + '> Show customers where it was landed</label>' +
      '<button class="btn press" data-act="savefish" data-v="' + esc(f.name || '') + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save fish') + '</button></div>';
  }
  function fishHtml() {
    var fish = S.data.fish || [], cats = S.data.categories || [], busy = !!S.busy.cat;
    var groups = cats.map(function (c) { return { c: c, list: fish.filter(function (f) { return f.group === c.name; }) }; });
    var other = fish.filter(function (f) { return !cats.some(function (c) { return c.name === f.group; }); });
    if (other.length) { groups.push({ c: { name: 'Other', mr: '', show: true }, list: other }); }
    var editing = S.editFish === '+' ? {} : fish.filter(function (f) { return f.name === S.editFish; })[0];
    return '<div class="stack"><div class="dhead"><h1 class="anton">Fish</h1><button class="linkbtn" data-act="refresh">' + (S.loading ? 'Refreshing…' : 'Refresh') + '</button></div>' +
      '<span class="muted-g" style="text-align:left">The fish you can enter as a catch. Customers only see a fish when it has a live catch.</span>' +
      msgBoxes() +
      (editing ? fishForm(editing) : '<button class="btn big press" data-act="fishedit" data-v="+">Add a fish</button>') +
      groups.map(function (g) {
        return '<h2 class="osec">' + esc(g.c.name) + (g.c.show === false ? ' · hidden' : '') + '</h2>' +
          (g.list.length ? '<div class="abuy">' + g.list.map(function (f) {
            return '<div class="frow' + (f.show ? '' : ' off') + '"><span><b>' + esc(f.name) + '</b><small class="dsub" style="display:block">' + esc([f.en, f.mr].filter(Boolean).join(' · ')) + (f.show ? '' : ' · hidden') + '</small></span>' +
              '<button class="linkbtn dk" data-act="fishedit" data-v="' + esc(f.name) + '">Edit</button></div>';
          }).join('') + '</div>' : '<div class="box">No fish in this category yet.</div>');
      }).join('') +
      '<h2 class="osec">Categories</h2><div class="abuy">' + cats.map(function (c) {
        return '<div class="frow' + (c.show ? '' : ' off') + '"><span><b>' + esc(c.name) + '</b><small class="dsub" style="display:block">' + esc(c.mr || '') + (c.show ? '' : ' · hidden') + '</small></span>' +
          '<button class="toggle" role="switch" aria-checked="' + !!c.show + '" data-act="catshow" data-v="' + esc(c.name) + '"' + (busy ? ' disabled' : '') + '><span></span>' + (c.show ? 'Shown' : 'Hidden') + '</button></div>';
      }).join('') + '</div>' +
      '<div class="aform"><b>Add a category</b><div class="agrid"><label><span>Name</span><input class="ainput" id="k-name" placeholder="For example Shellfish"></label>' +
        '<label><span>Marathi name</span><input class="ainput" id="k-mr" placeholder="Optional"></label></div>' +
        '<button class="btn press" data-act="savecat"' + (busy ? ' disabled' : '') + '>Add category</button>' +
        '<span class="dsub">New categories show with a fish drawing in the shop.</span></div>' +
      '</div>';
  }

  function couponsHtml() {
    var list = S.data.coupons || [], busy = !!S.busy.coupon;
    return '<h2 class="osec">Coupon codes</h2>' +
      (list.length ? '<div class="abuy">' + list.map(function (c) {
        var bits = [c.type === '%' ? c.value + '% off' : rs(c.value) + ' off', c.min ? 'min ' + rs(c.min) : '', c.till ? (c.expired ? 'expired ' : 'till ') + dayLabel(c.till) : '',
          'used ' + c.used + (c.max ? ' of ' + c.max : ''), c.perPhone ? c.perPhone + ' per mobile' : ''].filter(Boolean).join(' · ');
        return '<div class="frow' + (c.active && !c.expired ? '' : ' off') + '"><span><b>' + esc(c.code) + '</b><small class="dsub" style="display:block">' + esc(bits) + '</small></span>' +
          '<button class="toggle" role="switch" aria-checked="' + !!c.active + '" data-act="cpactive" data-v="' + esc(c.code) + '"' + (busy ? ' disabled' : '') + '><span></span>' + (c.active ? 'On' : 'Off') + '</button></div>';
      }).join('') + '</div>' : '<div class="box">No coupon codes yet.</div>') +
      '<div class="aform"><b>Add a coupon</b>' +
        '<div class="agrid"><label><span>Code</span><input class="ainput" id="cp-code" autocapitalize="characters" placeholder="WELCOME50"></label>' +
        '<label><span>Type</span><select class="ainput" id="cp-type"><option value="%">% off</option><option value="Rs">₹ off</option></select></label>' +
        '<label><span>Value</span><input class="ainput num" id="cp-value" type="number" inputmode="numeric" min="1"></label>' +
        '<label><span>Min order (₹)</span><input class="ainput num" id="cp-min" type="number" inputmode="numeric" min="0" placeholder="None"></label>' +
        '<label><span>Valid till</span><input class="ainput" id="cp-till" type="date"></label>' +
        '<label><span>Uses per mobile</span><input class="ainput num" id="cp-per" type="number" inputmode="numeric" min="0" value="1"></label>' +
        '<label><span>Total uses</span><input class="ainput num" id="cp-max" type="number" inputmode="numeric" min="0" placeholder="No limit"></label></div>' +
        '<button class="btn press" data-act="cpsave"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Add coupon') + '</button>' +
        '<span class="dsub">Customers type the code on their slip. It is checked again when they place the order. Cancelled orders don’t count as uses. Coupons don’t apply to items already on offer.</span></div>';
  }
  function settingsHtml() {
    var st = S.data.settings || {}, busy = !!S.busy.settings;
    var f = function (id, label, val, extra) { return '<div class="fld"><label for="s-' + id + '">' + label + '</label><input id="s-' + id + '" class="ainput" data-s="' + id + '" value="' + esc(val) + '" ' + (extra || '') + '></div>'; };
    var g = function (id, label, val, extra) { return '<label><span>' + label + '</span><input id="s-' + id + '" class="ainput num" data-s="' + id + '" value="' + esc(val) + '" ' + (extra || '') + '></label>'; };
    var sw = function (id, label, on) { return '<div class="ah1 aswitch"><span>' + label + '</span><button class="toggle" role="switch" aria-checked="' + !!on + '" data-act="sw" data-v="' + id + '"><span></span>' + (on ? 'On' : 'Off') + '</button></div>'; };
    return '<div class="stack"><div class="dhead"><h1 class="anton">Settings</h1></div>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      f('fee', 'Delivery fee (₹)', st.fee, 'type="number" inputmode="numeric" min="0"') +
      f('upi', 'Company UPI ID', st.upi, 'placeholder="For example farmblue@okaxis" autocapitalize="off"') +
      f('payee', 'Payee name', st.payee) +
      f('rider', 'Delivery person mobile', st.rider, 'type="tel" inputmode="numeric" placeholder="10-digit number"') +
      f('pin', 'Delivery PIN (opens Delivery in the Blio Delivery app)', st.pin, 'inputmode="numeric" placeholder="4 to 8 digits"') +
      f('packPin', 'Packing PIN (opens Packing in the Blio Delivery app)', st.packPin, 'inputmode="numeric" placeholder="4 to 8 digits"') +
      '<span class="muted-g" style="text-align:left;margin-top:-6px">Give each person only the PIN for their job. Use the same PIN for both only if one person does both.</span>' +
      f('fssai', 'FSSAI number', st.fssai, 'placeholder="Printed on bills once added"') +
      '<h2 class="osec">Delivery and catch</h2><div class="aform">' +
      '<div class="agrid">' + g('start', 'Delivery starts', st.start, 'type="time"') + g('end', 'Delivery ends', st.end, 'type="time"') +
        g('cutoff', 'Same-day cut-off', st.cutoff, 'type="time"') + g('sellDays', 'Sell each catch for (days)', st.sellDays, 'type="number" inputmode="numeric" min="1" max="7"') + '</div>' +
      '<span class="dsub">Orders placed before the cut-off are delivered the same evening. Later orders go the next evening.</span>' +
      sw('discOn', 'Discount on the second day', st.discOn) +
      (st.discOn ? '<div class="agrid">' + g('discPct', 'Second-day discount (%)', st.discPct, 'type="number" inputmode="numeric" min="0" max="90"') + '</div>' : '') +
      sw('showLanding', 'Show customers the landing day', st.showLanding) +
      sw('autoOn', 'Go live by itself', st.autoOn) +
      (st.autoOn ? '<div class="agrid">' + g('autoMin', 'Go live after (minutes)', st.autoMin, 'type="number" inputmode="numeric" min="0" max="600"') + '</div>' +
        '<span class="dsub">A new catch waits this long so you can check it. Use 0 to go live as soon as it is saved.</span>'
        : '<span class="dsub">Off: a new catch stays hidden until you tap Go live on the Stock tab.</span>') +
      '<label class="afl"><span>Harbours, separated by commas</span><input id="s-harbours" class="ainput" data-s="harbours" value="' + esc((st.harbours || []).join(', ')) + '"></label></div>' +
      '<button class="btn big press" data-act="saves"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save settings') + '</button>' +
      couponsHtml() +
      '<div class="box">Signed in as <b>' + esc(S.auth.by) + '</b>. The admin password can only be changed in the Google Sheet.' +
      (S.data.sheetUrl ? ' <a href="' + esc(S.data.sheetUrl) + '" target="_blank" rel="noopener">Open the Google Sheet</a>' : '') + '</div>' +
      '<button class="btn dark press" data-act="lock">Lock Blio Admin on this phone</button></div>';
  }

  function render() {
    var keepY = main.scrollTop, focus = document.activeElement && document.activeElement.id;
    if (!S.auth) { tabs.hidden = true; main.innerHTML = loginHtml(); return; }
    tabs.hidden = false;
    tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-v') === S.tab ? 'page' : 'false'); });
    if (!S.data) {
      main.innerHTML = '<div class="stack"><div class="dhead"><h1 class="anton">Admin</h1></div>' +
        (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div><button class="btn press" data-act="refresh">Try again</button>' : '<div class="box">Loading orders and stock…</div>') + '</div>';
      return;
    }
    main.innerHTML = ({ orders: ordersHtml, stock: stockHtml, fish: fishHtml, settings: settingsHtml }[S.tab] || ordersHtml)();
    main.scrollTop = keepY;
    main.querySelectorAll('.chiprow').forEach(function (r) { var on = r.querySelector('[aria-pressed=true]'); if (on && (on.offsetLeft + on.offsetWidth > r.scrollLeft + r.clientWidth || on.offsetLeft < r.scrollLeft)) { r.scrollLeft = on.offsetLeft - 16; } });
    if (focus && document.getElementById(focus)) { document.getElementById(focus).focus(); }
  }
  function goTab(t) { S.tab = t; S.note = ''; S.warn = ''; S.err = ''; render(); main.scrollTop = 0; }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a || a.tagName === 'SELECT') { return; }
    var what = a.getAttribute('data-act'), id = a.getAttribute('data-id'), v = a.getAttribute('data-v'), name = a.getAttribute('data-name');
    switch (what) {
      case 'login':
        var by = ($('#a-by').value || '').trim(), pw = $('#a-pw').value || '';
        if (!by || !pw) { S.err = 'Add your name and the admin password.'; render(); return; }
        S.auth = { pw: pw, by: by }; store('admin', S.auth); store('adminBy', by); S.err = ''; load(); break;
      case 'lock': S.auth = null; store('admin', null); S.data = null; S.err = ''; render(); break;
      case 'tab': goTab(v); break;
      case 'refresh': S.note = ''; load(); break;
      case 'filter': S.filter = v; S.note = ''; render(); break;
      case 'win': S.win = v; render(); break;
      case 'toggle': S.open = S.open === id ? '' : id; S.note = ''; render(); break;
      case 'stage': setOrder(id, { status: v }, v === 'Cancelled' ? 'cancelled' : 'now ' + v); break;
      case 'pay': var o = order(id); if (o) { setOrder(id, { payment: o.paid ? 'Unpaid' : 'Paid' }, o.paid ? 'marked unpaid' : 'marked paid'); } break;
      case 'final':
        var inp = document.getElementById('fin-' + id), val = inp ? inp.value.trim() : '';
        if (val !== '' && !(Number(val) >= 0)) { S.err = 'Enter the final amount in rupees.'; render(); return; }
        setOrder(id, { final: val === '' ? '' : Math.round(Number(val)) }, val === '' ? 'final amount cleared' : 'final amount ' + rs(val)); break;
      case 'cpsave':
        var cp = { op: 'coupon', code: $('#cp-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''), type: $('#cp-type').value, value: Number($('#cp-value').value),
          min: Number($('#cp-min').value) || 0, till: $('#cp-till').value, perPhone: Number($('#cp-per').value) || 0, max: Number($('#cp-max').value) || 0, active: true };
        if (cp.code.length < 3) { S.err = 'The code needs at least 3 letters or numbers.'; render(); return; }
        if (!(cp.value > 0) || (cp.type === '%' && cp.value > 90)) { S.err = cp.type === '%' ? 'Enter a % between 1 and 90.' : 'Enter the ₹ amount off.'; render(); return; }
        if ((S.data.coupons || []).some(function (x) { return x.code === cp.code; })) { S.err = cp.code + ' already exists. Turn it on or off in the list.'; render(); return; }
        act('coupon', cp, function () { S.note = 'Coupon ' + cp.code + ' added.'; }, 'Couldn’t add the coupon.');
        break;
      case 'cpactive':
        var cx = (S.data.coupons || []).filter(function (x) { return x.code === v; })[0]; if (!cx) { return; }
        act('coupon', { op: 'coupon', code: v, active: !cx.active }, function () { S.note = v + (cx.active ? ' turned off.' : ' turned on.'); }, 'Couldn’t update ' + v + '.');
        break;
      case 'billshare': var sb = S.bills[id]; if (sb && sb.file) { shareOrSave(sb.file, sb.msg); } break;
      case 'billfetch':
        S.busy[id] = 'fetch'; S.err = ''; render();
        call({ op: 'billpdf', id: id }).then(function (d) {
          delete S.busy[id];
          if (d.ok) { var od = order(id) || {}; S.bills[id] = { file: b64File(d.b64, d.name), msg: 'Hello ' + (od.name || '') + ', here is your Blio bill for order ' + id + '.' }; }
          else if (!authFail(d.error)) { S.err = 'Couldn’t get the bill for ' + id + '. Make a new bill instead.'; }
          render();
        }).catch(function () { delete S.busy[id]; S.err = 'No connection.'; render(); });
        break;
      case 'bill':
        S.busy[id] = 'bill'; S.err = ''; render();
        call({ op: 'bill', id: id }).then(function (d) {
          delete S.busy[id];
          if (d.ok) { S.bills[id] = { url: d.url, wa: d.wa, msg: d.msg, file: d.b64 ? b64File(d.b64, d.name) : null }; var ob = order(id); if (ob) { ob.bill = d.url; } S.note = id + ': bill ready for ' + rs(d.payable) + '. Tap Send bill PDF, then choose WhatsApp and the customer’s chat.'; }
          else if (!authFail(d.error)) { S.err = 'Couldn’t make the bill for ' + id + '.'; }
          render();
        }).catch(function () { delete S.busy[id]; S.err = 'No connection. The bill wasn’t made.'; render(); });
        break;
      case 'addopen': S.addOpen = true; S.note = ''; S.warn = ''; render(); var cf = $('#c-fish'); if (cf) { cf.focus(); } break;
      case 'addclose': S.addOpen = false; render(); break;
      case 'savelot':
        var hsel = $('#c-harbour').value, harbour = hsel === '*' ? $('#c-other').value.trim() : hsel;
        var cfish = $('#c-fish').value, rows = [], bad = '';
        main.querySelectorAll('.asize').forEach(function (b) {
          var g = function (k) { return b.querySelector('[data-f=' + k + ']').value.trim(); }, sz = b.getAttribute('data-size');
          if (g('kg') === '' && g('pieces') === '' && g('cost') === '') { return; }
          if (!(Number(g('kg')) > 0)) { bad = 'Enter the kg for ' + sizeName(sz).toLowerCase() + '.'; return; }
          if (!(Number(g('price')) > 0)) { bad = 'Enter the selling price for ' + sizeName(sz).toLowerCase() + '.'; return; }
          rows.push({ size: sz, kg: Number(g('kg')), pieces: g('pieces') === '' ? '' : Number(g('pieces')), cost: g('cost') === '' ? '' : Number(g('cost')), price: Number(g('price')) });
        });
        S.warn = '';
        if (!cfish) { S.err = 'Choose the fish.'; render(); return; }
        if (bad) { S.err = bad; render(); return; }
        if (!rows.length) { S.err = 'Enter the kg and price for at least one size.'; render(); return; }
        var loss = rows.filter(function (r) { return r.cost !== '' && r.cost > r.price; }).map(function (r) { return sizeName(r.size).toLowerCase(); });
        if (loss.length) { S.warn = 'Note: cost is higher than the selling price for ' + loss.join(' and ') + '.'; }
        var clive = $('#c-live').checked;
        store('lastHarbour', harbour);
        act('lot', { op: 'lots', fish: cfish, harbour: harbour, landed: $('#c-landed').value, live: clive, rows: rows }, function (d) {
          var st = S.data.settings || {}, total = rows.reduce(function (a, r) { return a + r.kg; }, 0);
          S.note = cfish + ': ' + rows.length + (rows.length === 1 ? ' size, ' : ' sizes, ') + kg(total) + ' saved. ' +
            (clive || (st.autoOn && !Number(st.autoMin)) ? 'On sale now.' : st.autoOn ? 'On sale in ' + st.autoMin + ' minutes, or tap Go live now.' : 'Tap Go live now when you’re ready.');
          S.addOpen = false; load(true);
        }, 'Couldn’t save the catch. Nothing was saved, try again.');
        break;
      case 'lot': S.openLot = S.openLot === id ? '' : id; S.note = ''; S.warn = ''; render(); break;
      case 'golive': act('golive', { op: 'golive' }, function (d) { S.note = d.count + (d.count === 1 ? ' entry is' : ' entries are') + ' on sale now.'; load(true); }, 'Couldn’t go live.'); break;
      case 'lotstatus':
        act(id, { op: 'lotedit', lot: id, status: v }, function () { S.note = id + (v === 'Closed' ? ' stopped. Customers can’t order it now.' : ' is on sale.'); load(true); }, 'Couldn’t update ' + id + '.');
        break;
      case 'editlot':
        var eg = main.querySelector('.agrid[data-lot="' + id + '"]'), lp = eg.querySelector('[data-f=price]').value.trim(), lk = eg.querySelector('[data-f=kg]').value.trim(), lpc = eg.querySelector('[data-f=pieces]').value.trim(), lo = eg.querySelector('[data-f=offer]').value.trim();
        if (!(Number(lp) > 0) || !(Number(lk) > 0)) { S.err = 'Price and kg must be more than 0.'; render(); return; }
        if (lo !== '' && !(Number(lo) >= 0 && Number(lo) <= 90)) { S.err = 'The offer must be between 0 and 90%.'; render(); return; }
        var lcost = Number(((S.data.lots || []).filter(function (x) { return x.lot === id; })[0] || {}).cost) || 0, lop = Math.round(Number(lp) * (1 - (Number(lo) || 0) / 100));
        S.warn = lcost && lop < lcost ? 'Note: at this offer the price (' + rs(lop) + '/kg) is below the cost (' + rs(lcost) + '/kg).' : '';
        act(id, { op: 'lotedit', lot: id, price: Number(lp), kg: Number(lk), pieces: lpc === '' ? '' : Number(lpc), offer: lo === '' ? 0 : Math.round(Number(lo)) }, function () {
          S.note = id + ' saved.' + (Number(lo) > 0 ? ' It shows in Today’s offers at ' + Math.round(Number(lo)) + '% off.' : ''); load(true); }, 'Couldn’t save ' + id + '.');
        break;
      case 'count':
        var cg = main.querySelector('.acount[data-lot="' + id + '"]'), q = function (k) { return cg.querySelector('[data-f=' + k + ']'); };
        var counted = q('counted').value.trim(), waste = q('waste').value.trim();
        if (counted === '' || !(Number(counted) >= 0)) { S.err = 'Enter the kg on hand now.'; render(); return; }
        var lotx = (S.data.lots || []).filter(function (x) { return x.lot === id; })[0], lname = lotx ? lotx.fish + (lotx.size ? ' ' + lotx.size.toLowerCase() : '') : id;
        act(id, { op: 'count', lot: id, counted: Number(counted), waste: waste === '' ? 0 : Number(waste), pieces: q('pieces').value.trim(), note: q('note').value.trim(), close: q('close').checked }, function (d) {
          var tol = Math.max(0.3, d.expected * 0.02);
          S.note = ''; S.warn = '';
          if (d.gap < -tol) { S.warn = lname + ': ' + kg(-d.gap) + ' missing against the expected ' + kg(d.expected) + '. Check with the cleaner and the orders.'; }
          else { S.note = lname + ': count saved. ' + (Math.abs(d.gap) < 0.05 ? 'It matches the expected weight.' : (d.gap > 0 ? '+' : '') + kg(d.gap) + ' against expected, within normal.'); }
          load(true);
        }, 'Couldn’t save the count.');
        break;
      case 'fishedit': S.editFish = v; S.note = ''; render(); main.scrollTop = 0; break;
      case 'fishclose': S.editFish = ''; render(); break;
      case 'savefish':
        var fname = v || ($('#f-name') ? $('#f-name').value.trim() : '');
        if (!fname) { S.err = 'Add the fish name.'; render(); return; }
        if (!v && (S.data.fish || []).some(function (x) { return x.name.toLowerCase() === fname.toLowerCase(); })) { S.err = fname + ' is already in the list. Tap Edit on it instead.'; render(); return; }
        var yv = $('#f-yield').value.trim(), pv = Number($('#f-price').value);
        var fb = { op: 'fish', name: fname, group: $('#f-group').value, en: $('#f-en').value.trim(), mr: $('#f-mr').value.trim(), from: $('#f-from').value.trim(),
          cuts: $('#f-cuts').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), yieldPct: yv === '' ? '' : Number(yv), show: $('#f-show').checked, showLeft: $('#f-left').checked, showOrigin: $('#f-origin').checked };
        if (pv > 0) { fb.price = pv; }
        act('fish', fb, function () { S.note = fname + ' saved.'; S.editFish = ''; load(true); }, 'Couldn’t save ' + fname + '.');
        break;
      case 'savecat':
        var kn = $('#k-name').value.trim(); if (!kn) { S.err = 'Add the category name.'; render(); return; }
        if ((S.data.categories || []).some(function (x) { return x.name.toLowerCase() === kn.toLowerCase(); })) { S.err = kn + ' is already a category.'; render(); return; }
        act('cat', { op: 'category', name: kn, mr: $('#k-mr').value.trim() }, function () { S.note = 'Category ' + kn + ' added.'; load(true); }, 'Couldn’t add the category.');
        break;
      case 'catshow':
        var kc = (S.data.categories || []).filter(function (x) { return x.name === v; })[0]; if (!kc) { return; }
        act('cat', { op: 'category', name: v, show: !kc.show }, function () { kc.show = !kc.show; S.note = v + (kc.show ? ' is shown in the shop.' : ' is hidden from the shop.'); }, 'Couldn’t update ' + v + '.');
        break;
      case 'sw':
        main.querySelectorAll('[data-s]').forEach(function (i) { var k = i.getAttribute('data-s'); S.data.settings[k] = k === 'harbours' ? i.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : i.value.trim(); });
        S.data.settings[v] = !S.data.settings[v]; render();
        break;
      case 'saves':
        var body = { op: 'settings' };
        main.querySelectorAll('[data-s]').forEach(function (i) { body[i.getAttribute('data-s')] = i.value.trim(); });
        if (body.rider && body.rider.replace(/[^0-9]/g, '').length !== 10) { S.err = 'The delivery person’s mobile needs 10 digits.'; render(); return; }
        if (body.pin && !/^[0-9]{4,8}$/.test(body.pin)) { S.err = 'The delivery PIN must be 4 to 8 digits.'; render(); return; }
        if (body.packPin && !/^[0-9]{4,8}$/.test(body.packPin)) { S.err = 'The packing PIN must be 4 to 8 digits.'; render(); return; }
        body.discOn = !!S.data.settings.discOn; body.showLanding = !!S.data.settings.showLanding; body.autoOn = !!S.data.settings.autoOn;
        if (['start', 'end', 'cutoff'].some(function (k) { return body[k] !== undefined && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(body[k]); })) { S.err = 'Enter the delivery times as hours and minutes.'; render(); return; }
        if (body.start && body.end && body.start >= body.end) { S.err = 'Delivery must end after it starts.'; render(); return; }
        act('settings', body, function (d) { S.data.settings = d.settings; S.note = 'Settings saved. The shop uses them from now.'; }, 'Couldn’t save the settings.');
        break;
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('select[data-act=setstage]')) {
      var id = e.target.getAttribute('data-id'); setOrder(id, { status: e.target.value }, 'now ' + e.target.value);
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'c-fish') {
      var op = e.target.selectedOptions[0], price = op && op.getAttribute('data-price');
      if (price) { main.querySelectorAll('.asize [data-f=price]').forEach(function (i) { if (!i.value || i.getAttribute('data-auto')) { i.value = price; i.setAttribute('data-auto', '1'); } }); }
    }
    if (e.target.id === 'c-harbour') { var w = $('#c-other-wrap'); if (w) { w.hidden = e.target.value !== '*'; if (!w.hidden) { $('#c-other').focus(); } } }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.id === 'a-pw') { var b = $('[data-act=login]'); if (b) { b.click(); } } });

  // refresh every minute on the Orders tab, unless someone is typing or has unsaved changes
  setInterval(function () {
    if (!S.auth || !S.data || document.hidden || S.tab !== 'orders' || S.loading || Object.keys(S.busy).length) { return; }
    var ae = document.activeElement; if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) { return; }
    load(true);
  }, 60000);

  render();
  if (S.auth) { load(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('/sw.js').catch(function () {}); }
})();
