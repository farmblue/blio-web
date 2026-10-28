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
  function timeOf(t) { var p = String(t || '').split(', '); return p[1] || p[0] || ''; }

  var STAGES = ['New', 'Confirmed', 'Packed', 'Out for delivery', 'Arriving next', 'Delivered', 'Cancelled'];
  var STAGE_CLS = { 'New': 'newo', 'Confirmed': 'conf', 'Packed': 'packed', 'Out for delivery': 'out', 'Arriving next': 'next', 'Delivered': 'done', 'Cancelled': 'cancel' };
  var FILTERS = [['open', 'Open'], ['New', 'New'], ['Confirmed', 'Confirmed'], ['Packed', 'Packed'], ['way', 'On the way'], ['Delivered', 'Delivered'], ['Cancelled', 'Cancelled'], ['all', 'All']];

  var S = {
    auth: store('admin') || null,       // { pw, by }
    tab: 'orders', data: null, loading: false, err: '', note: '',
    filter: 'open', win: '', open: '', busy: {}, bills: {}, dirty: {}
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
  function load(quiet) {
    if (!S.auth) { return; }
    S.loading = true; if (!quiet) { render(); }
    call({ op: 'load' }).then(function (d) {
      S.loading = false;
      if (!d.ok) { if (!authFail(d.error)) { S.err = 'Couldn’t load. Try again.'; } render(); return; }
      S.data = d; S.err = ''; if (!S.win) { S.win = d.window; }
      render();
    }).catch(function () { S.loading = false; S.err = 'No connection. Check your internet and tap Refresh.'; render(); });
  }
  function act(key, body, onOk, failMsg) {
    S.busy[key] = true; S.err = ''; render();
    return call(body).then(function (d) {
      delete S.busy[key];
      if (d.ok) { onOk(d); } else if (!authFail(d.error)) { S.err = failMsg; }
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
      if (S.win && S.win !== '*' && S.filter !== 'open' && o.window !== S.win) { return false; }
      if (S.filter === 'open') { return o.status !== 'Delivered' && o.status !== 'Cancelled'; }
      if (S.filter === 'way') { return o.status === 'Out for delivery' || o.status === 'Arriving next'; }
      if (S.filter === 'all') { return true; }
      return o.status === S.filter;
    });
  }
  function nextActions(o) {
    switch (o.status) {
      case 'New': return [['Confirmed', 'Confirm'], ['Cancelled', 'Cancel']];
      case 'Confirmed': return [['Packed', 'Mark packed'], ['Cancelled', 'Cancel']];
      case 'Packed': return [['Out for delivery', 'Out for delivery']];
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
      (o.status === 'Cancelled' ? '' : '<span class="ptag' + (o.paid ? ' paid' : '') + '">' + (o.paid ? 'Paid' : 'Unpaid') + '</span>') + '</span></button>';
    if (!openC) { return '<div class="aorder">' + head + '</div>'; }
    var acts = nextActions(o).map(function (a) {
      return '<button class="btn ' + (a[0] === 'Cancelled' ? 'dark' : '') + ' press" data-act="stage" data-id="' + esc(o.id) + '" data-v="' + esc(a[0]) + '"' + (busy ? ' disabled' : '') + '>' + esc(a[1]) + '</button>';
    }).join('');
    var nav = o.map || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ', ' + o.area + ', Kolhapur'));
    return '<div class="aorder open">' + head + '<div class="abody">' +
      '<p class="ditems">' + esc(o.items) + '</p>' +
      '<p>' + esc(o.address) + (o.area ? ', ' + esc(o.area) : '') + (o.map ? ' · <a href="' + esc(o.map) + '" target="_blank" rel="noopener">pinned on map</a>' : '') + '</p>' +
      (o.notes ? '<p class="dnote">Note: ' + esc(o.notes) + '</p>' : '') +
      '<p class="dsub">Window ' + esc(winLabel(o.window)) + ' · placed ' + esc(o.placed) + (o.outAt ? ' · out ' + esc(timeOf(o.outAt)) : '') + (o.deliveredAt ? ' · delivered ' + esc(timeOf(o.deliveredAt)) : '') + '</p>' +
      '<div class="dbtns"><a class="btn dark" href="tel:+91' + esc(o.mobile) + '">Call</a>' +
      '<a class="btn dark" href="https://wa.me/91' + esc(o.mobile) + '" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn dark" href="' + esc(nav) + '" target="_blank" rel="noopener">Map</a></div>' +
      (acts ? '<div class="arow">' + acts + '</div>' : '') +
      '<div class="arow"><button class="btn dark press" data-act="pay" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' + (o.paid ? 'Mark unpaid' : 'Mark paid') + '</button>' +
        '<label class="asel"><span>Change status</span><select data-act="setstage" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' +
        STAGES.map(function (s) { return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="fld"><label for="fin-' + esc(o.id) + '">Final amount after cleaning (₹)</label>' +
        '<div class="arow"><input id="fin-' + esc(o.id) + '" class="ainput num" type="number" inputmode="numeric" min="0" placeholder="' + rs(o.total) + '" value="' + (o.final === '' || o.final === null || o.final === undefined ? '' : esc(o.final)) + '">' +
        '<button class="btn press" data-act="final" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>Save</button></div></div>' +
      '<div class="arow">' +
        (bill && bill.wa ? '<a class="btn press" href="' + esc(bill.wa) + '" target="_blank" rel="noopener">Send bill on WhatsApp</a>' : '') +
        (bill || o.bill ? '<a class="btn dark" href="' + esc((bill && bill.url) || o.bill) + '" target="_blank" rel="noopener">Open bill</a>' : '') +
        '<button class="btn ' + (bill ? 'dark ' : '') + 'press" data-act="bill" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' + (S.busy[o.id] === 'bill' ? 'Making bill…' : (bill || o.bill ? 'Make a new bill' : 'Make bill')) + '</button>' +
      '</div>' +
      (busy ? '<span class="muted-g">Saving…</span>' : '') +
      '</div></div>';
  }
  function ordersHtml() {
    var all = S.data.orders || [];
    var wins = []; all.forEach(function (o) { if (o.window && wins.indexOf(o.window) === -1) { wins.push(o.window); } });
    if (S.data.window && wins.indexOf(S.data.window) === -1) { wins.unshift(S.data.window); }
    wins.sort().reverse();
    var inWin = all.filter(function (o) { return S.win === '*' || o.window === S.win; });
    var count = function (f) { var keep = S.filter; S.filter = f; var n = filterOrders(f === 'open' ? all : inWin).length; S.filter = keep; return n; };
    var list = filterOrders(all);
    return '<div class="stack">' +
      '<div class="dhead"><h1 class="anton">Orders</h1><button class="linkbtn" data-act="refresh">' + (S.loading ? 'Refreshing…' : 'Refresh') + '</button></div>' +
      (S.filter !== 'open' ? '<div class="chiprow" role="group" aria-label="Window">' + wins.map(function (w) {
        return '<button class="chip" data-act="win" data-v="' + esc(w) + '" aria-pressed="' + (S.win === w) + '">' + esc(winLabel(w)) + (w === S.data.window ? ' · now' : '') + '</button>';
      }).join('') + '<button class="chip" data-act="win" data-v="*" aria-pressed="' + (S.win === '*') + '">All windows</button></div>' : '') +
      '<div class="chiprow" role="group" aria-label="Stage">' + FILTERS.map(function (f) {
        return '<button class="chip" data-act="filter" data-v="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + ' <span class="cnt">' + count(f[0]) + '</span></button>';
      }).join('') + '</div>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      (list.length ? list.map(orderCard).join('') : '<div class="box">No orders here.</div>') +
      '</div>';
  }

  function stockHtml() {
    var groups = {}; (S.data.products || []).forEach(function (p) { (groups[p.group || 'Other'] = groups[p.group || 'Other'] || []).push(p); });
    return '<div class="stack"><div class="dhead"><h1 class="anton">Stock</h1><span class="dcount">Window ' + esc(winLabel(S.data.window)) + '</span></div>' +
      '<span class="muted-g" style="text-align:left">Set the price and how many kg you can source for this window. Leave kg empty for no limit.</span>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      Object.keys(groups).map(function (g) {
        return '<h2 class="osec">' + esc(g) + '</h2>' + groups[g].map(function (p) {
          var k = 'p:' + p.name, busy = !!S.busy[k];
          return '<div class="astock' + (p.available ? '' : ' off') + '" data-name="' + esc(p.name) + '">' +
            '<div class="ah1"><b>' + esc(p.name) + '</b><button class="toggle" role="switch" aria-checked="' + p.available + '" data-act="avail" data-name="' + esc(p.name) + '"' + (busy ? ' disabled' : '') + '><span></span>' + (p.available ? 'Available' : 'Sold out') + '</button></div>' +
            '<div class="agrid"><label><span>Price per kg (₹)</span><input class="ainput num" type="number" inputmode="numeric" min="1" data-f="price" value="' + esc(p.price) + '"></label>' +
            '<label><span>Kg for this window</span><input class="ainput num" type="number" inputmode="decimal" min="0" step="0.5" data-f="cap" placeholder="No limit" value="' + esc(p.cap) + '"></label></div>' +
            '<div class="ah1"><span class="dsub">Ordered ' + kg(p.ordered) + (p.cap === '' ? '' : ' · left ' + kg(p.left)) + '</span>' +
            '<button class="btn press small" data-act="savep" data-name="' + esc(p.name) + '"' + (busy || !S.dirty[k] ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save') + '</button></div></div>';
        }).join('');
      }).join('') + '</div>';
  }

  function buyingHtml() {
    var items = (S.data.products || []).filter(function (p) { return p.ordered > 0; }).sort(function (a, b) { return b.ordered - a.ordered; });
    var total = items.reduce(function (a, p) { return a + p.ordered; }, 0);
    var text = 'Blio buying list, ' + winLabel(S.data.window) + '\n\n' + items.map(function (p) { return p.name + ': ' + kg(p.ordered); }).join('\n') + '\n\nTotal: ' + kg(total);
    return '<div class="stack"><div class="dhead"><h1 class="anton">Buying</h1><span class="dcount">Window ' + esc(winLabel(S.data.window)) + '</span></div>' +
      '<span class="muted-g" style="text-align:left">What to buy for this window: every order except cancelled ones, after cleaning weight.</span>' +
      (items.length ? '<div class="abuy">' + items.map(function (p) { return '<div><span>' + esc(p.name) + '</span><b class="num">' + kg(p.ordered) + '</b></div>'; }).join('') +
        '<div class="tot"><span>Total</span><b class="num">' + kg(total) + '</b></div></div>' +
        '<a class="btn big press" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener">Share list on WhatsApp</a>'
        : '<div class="box">No orders in this window yet.</div>') +
      '</div>';
  }

  function settingsHtml() {
    var st = S.data.settings || {}, busy = !!S.busy.settings;
    var f = function (id, label, val, extra) { return '<div class="fld"><label for="s-' + id + '">' + label + '</label><input id="s-' + id + '" class="ainput" data-s="' + id + '" value="' + esc(val) + '" ' + (extra || '') + '></div>'; };
    return '<div class="stack"><div class="dhead"><h1 class="anton">Settings</h1></div>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      f('fee', 'Delivery fee (₹)', st.fee, 'type="number" inputmode="numeric" min="0"') +
      f('upi', 'Company UPI ID', st.upi, 'placeholder="For example farmblue@okaxis" autocapitalize="off"') +
      f('payee', 'Payee name', st.payee) +
      f('rider', 'Delivery person mobile', st.rider, 'type="tel" inputmode="numeric" placeholder="10-digit number"') +
      f('pin', 'Delivery PIN (for Blio Delivery)', st.pin, 'inputmode="numeric" placeholder="4 to 8 digits"') +
      f('fssai', 'FSSAI number', st.fssai, 'placeholder="Printed on bills once added"') +
      '<button class="btn big press" data-act="saves"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save settings') + '</button>' +
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
    main.innerHTML = { orders: ordersHtml, stock: stockHtml, buying: buyingHtml, settings: settingsHtml }[S.tab]();
    main.scrollTop = keepY;
    if (focus && document.getElementById(focus)) { document.getElementById(focus).focus(); }
  }
  function goTab(t) { S.tab = t; S.note = ''; S.err = ''; render(); main.scrollTop = 0; }

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
      case 'filter': S.filter = v; S.note = ''; if (v !== 'open' && !S.win) { S.win = S.data.window; } render(); break;
      case 'win': S.win = v; render(); break;
      case 'toggle': S.open = S.open === id ? '' : id; S.note = ''; render(); break;
      case 'stage': setOrder(id, { status: v }, v === 'Cancelled' ? 'cancelled' : 'now ' + v); break;
      case 'pay': var o = order(id); if (o) { setOrder(id, { payment: o.paid ? 'Unpaid' : 'Paid' }, o.paid ? 'marked unpaid' : 'marked paid'); } break;
      case 'final':
        var inp = document.getElementById('fin-' + id), val = inp ? inp.value.trim() : '';
        if (val !== '' && !(Number(val) >= 0)) { S.err = 'Enter the final amount in rupees.'; render(); return; }
        setOrder(id, { final: val === '' ? '' : Math.round(Number(val)) }, val === '' ? 'final amount cleared' : 'final amount ' + rs(val)); break;
      case 'bill':
        S.busy[id] = 'bill'; S.err = ''; render();
        call({ op: 'bill', id: id }).then(function (d) {
          delete S.busy[id];
          if (d.ok) { S.bills[id] = { url: d.url, wa: d.wa }; var ob = order(id); if (ob) { ob.bill = d.url; } S.note = id + ': bill ready for ' + rs(d.payable) + '. Tap Send bill on WhatsApp.'; }
          else if (!authFail(d.error)) { S.err = 'Couldn’t make the bill for ' + id + '.'; }
          render();
        }).catch(function () { delete S.busy[id]; S.err = 'No connection. The bill wasn’t made.'; render(); });
        break;
      case 'avail':
        var p = (S.data.products || []).filter(function (x) { return x.name === name; })[0]; if (!p) { return; }
        act('p:' + name, { op: 'product', name: name, available: !p.available }, function (d) { Object.assign(p, d.product || { available: !p.available }); S.note = name + (p.available ? ' is available' : ' is marked sold out'); }, 'Couldn’t update ' + name + '.');
        break;
      case 'savep':
        var card = a.closest('.astock'), pp = (S.data.products || []).filter(function (x) { return x.name === name; })[0];
        var price = card.querySelector('[data-f=price]').value.trim(), cap = card.querySelector('[data-f=cap]').value.trim();
        if (!(Number(price) > 0)) { S.err = 'Enter a price for ' + name + '.'; render(); return; }
        if (cap !== '' && !(Number(cap) >= 0)) { S.err = 'Kg must be a number, or empty for no limit.'; render(); return; }
        act('p:' + name, { op: 'product', name: name, price: Number(price), cap: cap === '' ? '' : Number(cap) }, function (d) {
          if (d.product && pp) { Object.assign(pp, d.product); } delete S.dirty['p:' + name]; S.note = name + ' saved: ' + rs(price) + '/kg' + (cap === '' ? ', no kg limit' : ', ' + kg(cap));
        }, 'Couldn’t save ' + name + '.');
        break;
      case 'saves':
        var body = { op: 'settings' };
        main.querySelectorAll('[data-s]').forEach(function (i) { body[i.getAttribute('data-s')] = i.value.trim(); });
        if (body.rider && body.rider.replace(/[^0-9]/g, '').length !== 10) { S.err = 'The delivery person’s mobile needs 10 digits.'; render(); return; }
        if (body.pin && !/^[0-9]{4,8}$/.test(body.pin)) { S.err = 'The delivery PIN must be 4 to 8 digits.'; render(); return; }
        act('settings', body, function (d) { S.data.settings = d.settings; S.note = 'Settings saved.'; }, 'Couldn’t save the settings.');
        break;
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('select[data-act=setstage]')) {
      var id = e.target.getAttribute('data-id'); setOrder(id, { status: e.target.value }, 'now ' + e.target.value);
    }
  });
  document.addEventListener('input', function (e) {
    var card = e.target.closest && e.target.closest('.astock');
    if (card) { var k = 'p:' + card.getAttribute('data-name'); if (!S.dirty[k]) { S.dirty[k] = true; var b = card.querySelector('[data-act=savep]'); if (b) { b.disabled = false; } } }
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
