/* Blio web app: seafood pre-orders for Kolhapur, sent as a WhatsApp message. */
(function () {
  'use strict';

  // ---------- settings you may change ----------
  var CONFIG = {
    whatsapp: '918856888766',          // order number, country code first, no +
    deliveryFee: 40,                   // Rs, home delivery
    // Used until the sheet loads. The sheet's Settings tab decides the real times.
    schedule: { start: '17:00', end: '20:00', cutoff: '15:00' },
    // Web app URL of the Blio admin sheet's script. Leave empty to use the sample list in products.js.
    api: 'https://script.google.com/macros/s/AKfycbyYRFQbohQm2STP3hSZB6G3iq2kdop0Vw2XV3BN-cOfQev1-QHH16nxOgc57oWv1r8Y/exec'
  };

  var DELIVERY_APP = window.BLIO_MODE === 'delivery';
  if (!DELIVERY_APP && location.hash === '#delivery') { location.replace('/delivery/'); return; }

  var CATS = [{ name: 'Fish', mr: 'मासे' }, { name: 'Prawns', mr: 'कोळंबी' }, { name: 'Crabs and clams', mr: 'खेकडे, तिसऱ्या' }, { name: 'Dried', mr: 'सुकी मासळी' }];
  var FIELD = { 'Fish': '#2456A6', 'Prawns': '#C2462A', 'Crabs and clams': '#2456A6', 'Dried': '#4E5C58' };
  var DSHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MSHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), sheetEl = $('#sheet'), scrim = $('#scrim'), bar = $('#slipbar'), back = $('#back');

  function store(k, v) { try { if (v === undefined) { return JSON.parse(localStorage.getItem('blio.' + k)); } localStorage.setItem('blio.' + k, JSON.stringify(v)); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function kgOf(p) { return p === '500 g' ? 0.5 : 1; }

  var S = {
    products: CONFIG.api ? [] : normP(window.BLIO_PRODUCTS), apiState: CONFIG.api ? 'loading' : 'ok',
    screen: 'home',
    openGroup: 'Fish',
    pick: null,                 // {id, pack, cut, qty}
    cart: store('cart') || [],
    form: Object.assign({ name: '', phone: '', address: '', area: '', notes: '' }, store('form') || {}, { fulfil: 'delivery' }),
    sending: false,
    short: null,
    live: false,
    cats: CATS.slice(), plan: null, pending: false, apiAt: 0, coupon: null, cErr: '', cDraft: '', billFiles: {}, billBusy: '',
    roles: null, pack: null, dTab: '', packBy: store('packBy') || '', pConfirm: '',
    errors: {},
    last: null,
    upi: '', payee: '',
    myorders: store('myorders') || [], ordLoading: false, ordErr: '', ordNote: '',
    dpin: store('dpin') || '', deliv: null, dErr: '', dLoading: false, dConfirm: '',
    installDismissed: !!store(window.BLIO_MODE === 'delivery' ? 'installDismissedD' : 'installDismissed')
  };

  // ---------- delivery plan, always in India time ----------
  function istNow() { var d = new Date(); return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(ds, n) { var p = ds.split('-'); return ymd(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
  function minOf(hm) { var m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : 0; }
  function fmtT(hm) { var m = minOf(hm), h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + pad(mm) : '') + (h >= 12 ? ' PM' : ' AM'); }
  function sched() { return S.sched || CONFIG.schedule; }
  function range() {
    var a = fmtT(sched().start), b = fmtT(sched().end);
    if (a.slice(-2) === b.slice(-2)) { a = a.slice(0, -3); }
    return a + ' to ' + b;
  }
  function dayWord(ds) {
    var today = ymd(istNow());
    if (ds === today) { return 'today'; }
    if (ds === addDays(today, 1)) { return 'tomorrow'; }
    var p = String(ds).split('-'); if (p.length !== 3) { return String(ds || ''); }
    return DSHORT[new Date(+p[0], +p[1] - 1, +p[2]).getDay()] + ' ' + (+p[2]) + ' ' + MSHORT[+p[1] - 1];
  }
  function evening(ds) { var w = dayWord(ds); return w === 'today' ? 'this evening' : w === 'tomorrow' ? 'tomorrow evening' : w; }
  function plan() {
    var now = istNow(), today = ymd(now), mins = now.getHours() * 60 + now.getMinutes(), cut = minOf(sched().cutoff);
    var same = mins < cut;
    return { date: same ? today : addDays(today, 1), sameDay: same, minsLeft: cut - mins };
  }
  function info() {
    var p = plan(), cut = fmtT(sched().cutoff), ev = evening(p.date), has = S.products.length > 0;
    var left = has && p.sameDay ? (Math.floor(p.minsLeft / 60) ? Math.floor(p.minsLeft / 60) + 'h ' : '') + (p.minsLeft % 60) + 'm' : '';
    var base = { delivery: ev, date: p.date, left: left };
    if (!has && S.apiState !== 'ok') {
      return Object.assign(base, S.apiState === 'loading'
        ? { title: 'Loading<br>the catch', line: 'Getting today’s fish and prices…', cta: 'Getting today’s catch.' }
        : { title: 'No<br>connection', line: 'We couldn’t load the catch. Check your internet and open Blio again, or order on WhatsApp.', cta: 'Order on WhatsApp instead.' });
    }
    if (!has && S.pending) {
      return Object.assign(base, { title: 'Catch<br>coming in', line: 'Today’s fish is being weighed and sorted by size. The list opens here shortly.',
        cta: 'The catch is being weighed. Check back in a few minutes.' });
    }
    if (!has) {
      return Object.assign(base, { title: 'Next catch<br>soon', line: 'Nothing on sale right now. We buy at the morning auction on sourcing days and list the fish here once it reaches Kolhapur.',
        cta: 'Looking for a particular fish? Ask us and we’ll tell you when it comes in.' });
    }
    if (p.sameDay) {
      return Object.assign(base, { title: 'Today’s<br>catch', line: 'Order by ' + cut + ' and it reaches you this evening, ' + range() + '.',
        cta: 'Order by ' + cut + ' for delivery this evening, ' + range() + '.' });
    }
    return Object.assign(base, { title: 'Fresh<br>catch', line: 'Same-day orders closed at ' + cut + '. Order now and it reaches you ' + ev + ', ' + range() + '.',
      cta: 'Order now for delivery ' + ev + ', ' + range() + '.' });
  }

  // ---------- products from the admin sheet ----------
  function normP(list) {
    return (list || []).map(function (p) {
      if (p.options && p.options.length) { return p; }
      return Object.assign({}, p, { options: [{ key: '', size: '', price: p.price, base: p.price, off: 0, landed: '', left: p.left === undefined ? null : p.left }] });
    });
  }
  function applyApi(d) {
    if (!d || !d.products) { return false; }
    if (!d.mode && !d.products.length) { return false; }   // older script with an empty list: keep the built-in one
    S.products = normP(d.products); S.live = true; S.apiState = 'ok';
    S.pending = !!d.pending; S.plan = d.plan || null;
    if (d.schedule && d.schedule.cutoff) { S.sched = d.schedule; }
    if (d.categories && d.categories.length) { S.cats = d.categories; }
    if (typeof d.deliveryFee === 'number') { CONFIG.deliveryFee = d.deliveryFee; }
    if (d.upi !== undefined) { S.upi = d.upi || ''; S.payee = d.payee || ''; }
    syncCart();
    return true;
  }
  function loadApi() {
    if (!CONFIG.api) { return; }
    var cached = store('api');
    if (cached && cached._at && Date.now() - cached._at < 3 * 3600000 && applyApi(cached)) { render(false); }
    S.apiAt = Date.now();
    fetch(CONFIG.api, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var was = S.reloading; S.reloading = false;
      if (applyApi(d)) { d._at = Date.now(); store('api', d); S.checkedAt = Date.now(); }
      if (was || S.screen === 'home' || S.screen === 'pay' || S.screen === 'slip') { keepScroll(); }
    }).catch(function () {
      var was = S.reloading; S.reloading = false;
      if (S.apiState === 'loading') { S.apiState = 'error'; }
      if (was) { S.reloadErr = true; }
      if (S.screen === 'home') { keepScroll(); }
    });
  }
  function keepScroll() { var st = main.scrollTop; render(false); main.scrollTop = st; }
  function optOf(p, key) { return (p.options || []).filter(function (o) { return o.key === key; })[0]; }
  function kgLeft(p, key) {
    var o = optOf(p, key); if (!o || !p.available) { return 0; }
    if (o.left === null || o.left === undefined) { return Infinity; }
    var inCart = S.cart.filter(function (l) { return l.id === p.id && l.opt === key; }).reduce(function (a, l) { return a + kgOf(l.pack) * l.qty; }, 0);
    return Math.max(0, o.left - inCart);
  }
  function lineKey(p, o, pack, cut) { return p.id + '|' + o.key + '|' + pack + '|' + cut; }
  // Re-price the slip against the latest catch. Sizes that sold out or ended are taken off with a note.
  function syncCart() {
    var dropped = [], byKey = {};
    S.cart = S.cart.filter(function (l) {
      var p = S.products.filter(function (x) { return x.name === l.name; })[0];
      var o = p && (optOf(p, l.opt) || p.options.filter(function (x) { return x.size === (l.size || ''); })[0]);
      if (!o) { dropped.push(l.name + (l.size ? ' (' + l.size + ')' : '')); return false; }
      l.id = p.id; l.opt = o.key; l.size = o.size; l.price = o.price; l.key = lineKey(p, o, l.pack, l.cut);
      if (byKey[l.key]) { byKey[l.key].qty += l.qty; return false; }
      byKey[l.key] = l; return true;
    });
    if (dropped.length) { S.short = (S.short ? S.short + ' ' : '') + 'No longer available, so taken off your slip: ' + dropped.join(', ') + '.'; }
    saveCart();
  }
  function whereWhen(o) {
    if (o.landed && o.harbour) { return o.landed + ' at ' + o.harbour; }
    return o.landed || (o.harbour ? 'From ' + o.harbour : '');
  }
  function reloadBtn() {
    return '<button class="linkbtn" data-act="reload"' + (S.reloading ? ' disabled' : '') + '>' + (S.reloading ? 'Refreshing…' : 'Refresh') + '</button>';
  }
  function b64File(b64, name) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
    return new File([arr], name || 'Blio bill.pdf', { type: 'application/pdf' });
  }
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
  function getBill(id) {
    var o = S.myorders.filter(function (x) { return x.id === id; })[0]; if (!o || !o.token) { return; }
    S.billBusy = id; S.ordErr = ''; keepScroll();
    fetch(CONFIG.api + '?action=bill&id=' + encodeURIComponent(id) + '&t=' + encodeURIComponent(o.token), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { S.billBusy = ''; if (d.ok) { S.billFiles[id] = b64File(d.b64, d.name); } else { S.ordErr = 'The bill for ' + id + ' isn’t ready yet. Ask us on WhatsApp.'; } keepScroll(); })
      .catch(function () { S.billBusy = ''; S.ordErr = 'No connection. Couldn’t get the bill.'; keepScroll(); });
  }
  function lineLabel(l) { return (l.size ? l.size + ' · ' : '') + l.pack + ' · ' + l.cut; }
  function reqUrl(name) {
    return 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent('Hi Blio, I would like to request ' + (name || 'a fish') + '. Quantity: ');
  }
  function fmtKg(n) { return (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + ' kg'; }

  // ---------- cart ----------
  function totals() {
    var sub = S.cart.reduce(function (a, l) { return a + l.price * kgOf(l.pack) * l.qty; }, 0);
    var fee = S.form.fulfil === 'delivery' && sub > 0 ? CONFIG.deliveryFee : 0;
    var count = S.cart.reduce(function (a, l) { return a + l.qty; }, 0);
    var disc = S.coupon && S.coupon.sub === sub ? S.coupon.discount : 0;
    if (S.coupon && S.coupon.sub !== sub && sub > 0 && !S.cChecking) { setTimeout(function () { applyCoupon(S.coupon && S.coupon.code); }, 0); }
    return { sub: sub, fee: fee, disc: disc, total: sub - disc + fee, count: count };
  }
  var COUPON_ERR = { nocode: 'That code isn’t valid.', expired: 'That code has expired.', used: 'This code has already been used with this mobile number.',
    limit: 'This code has been fully used.' };
  function couponMsg(d) { return d.error === 'min' ? 'This code needs an order of at least ' + rs(d.min) + '.' : (COUPON_ERR[d.error] || 'Couldn’t check the code. Try again.'); }
  function applyCoupon(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || !CONFIG.api) { return; }
    var sub = S.cart.reduce(function (a, l) { return a + l.price * kgOf(l.pack) * l.qty; }, 0);
    S.cChecking = true; S.cErr = ''; if (S.screen === 'slip') { keepScroll(); }
    fetch(CONFIG.api + '?action=coupon&code=' + encodeURIComponent(code) + '&phone=' + encodeURIComponent(S.form.phone || '') + '&sub=' + Math.round(sub), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.cChecking = false;
        if (d.ok) { S.coupon = { code: d.code, discount: d.discount, label: d.label, sub: sub }; } else { S.coupon = null; S.cErr = code + ': ' + couponMsg(d); }
        if (S.screen === 'slip') { keepScroll(); }
      })
      .catch(function () { S.cChecking = false; S.cErr = 'No connection. The code wasn’t checked.'; if (S.screen === 'slip') { keepScroll(); } });
  }
  function saveCart() { store('cart', S.cart); }
  function saveForm() { store('form', { name: S.form.name, phone: S.form.phone, address: S.form.address, area: S.form.area, lat: S.form.lat || null, lng: S.form.lng || null }); }

  // ---------- drawings ----------
  var ART = {
    'Fish': '<svg width="250" height="130" viewBox="0 0 220 120" aria-hidden="true"><path d="M14 60C56 14 140 14 176 60C140 106 56 106 14 60Z" fill="#ECE6D6"/><path d="M172 60l38-30v60z" fill="#ECE6D6"/><circle cx="46" cy="54" r="6" fill="#12272C"/><path d="M66 38c10 14 10 30 0 44" fill="none" stroke="#C2462A" stroke-width="5"/></svg>',
    'Prawns': '<svg width="220" height="140" viewBox="0 0 220 140" aria-hidden="true"><path d="M40 40C90 0 190 20 180 90C176 116 150 128 126 118L138 96C152 98 160 90 158 78C154 44 100 36 60 62z" fill="#ECE6D6"/><path d="M126 118l-30 16 8-30z" fill="#12404A"/><circle cx="58" cy="50" r="5" fill="#12272C"/><path d="M40 40C20 30 6 18 2 4M44 46C24 46 10 40 0 30" fill="none" stroke="#ECE6D6" stroke-width="3"/></svg>',
    'Crabs and clams': '<svg width="240" height="140" viewBox="0 0 240 140" aria-hidden="true"><ellipse cx="120" cy="82" rx="62" ry="40" fill="#ECE6D6"/><path d="M58 70C34 56 30 30 44 16l14 22-14 6z" fill="#C2462A"/><path d="M182 70c24-14 28-40 14-54l-14 22 14 6z" fill="#C2462A"/><circle cx="104" cy="58" r="5" fill="#12272C"/><circle cx="136" cy="58" r="5" fill="#12272C"/><path d="M66 100l-30 22M70 112l-24 24M174 100l30 22M170 112l24 24" fill="none" stroke="#ECE6D6" stroke-width="6"/></svg>',
    'Dried': '<svg width="240" height="130" viewBox="0 0 240 130" aria-hidden="true"><path d="M20 36C60 20 150 20 190 36l34-14v40l-34-12C150 64 60 64 20 50z" fill="#ECE6D6"/><path d="M20 86C60 70 150 70 190 86l34-14v40l-34-12C150 114 60 114 20 100z" fill="#ECE6D6"/><rect x="96" y="0" width="10" height="130" fill="#C2462A"/></svg>'
  };
  var PLUS = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#ECE6D6" stroke-width="2" aria-hidden="true"><path d="M9 2v14M2 9h14"/></svg>';

  // ---------- screens ----------
  function catList() {
    var cats = S.cats.slice(), seen = {};
    cats.forEach(function (c) { seen[c.name] = 1; });
    S.products.forEach(function (p) { if (!seen[p.group]) { seen[p.group] = 1; cats.push({ name: p.group, mr: '' }); } });
    return cats;
  }
  function offersHtml() {
    var list = [];
    S.products.forEach(function (p) { p.options.forEach(function (o) { if (o.offer && p.available && kgLeft(p, o.key) > 0) { list.push({ p: p, o: o }); } }); });
    if (!list.length) { return ''; }
    return '<section class="offers"><h2 class="osec">Today’s offers</h2><div class="orail">' + list.map(function (x) {
      var l = kgLeft(x.p, x.o.key);
      return '<button class="offc press" data-act="offer" data-id="' + esc(x.p.id) + '" data-v="' + esc(x.o.key) + '"><span class="pct">' + x.o.off + '% off</span>' +
        '<b>' + esc(x.p.name) + '</b><small>' + esc(x.o.size || x.p.en || '') + '</small>' +
        '<span class="pp num"><s>' + rs(x.o.base) + '</s>' + rs(x.o.price) + '/kg</span>' +
        (x.p.showLeft !== false && l !== Infinity ? '<small>' + fmtKg(l) + ' left</small>' : '') + '</button>';
    }).join('') + '</div></section>';
  }
  function offOf(p) { return Math.max.apply(null, p.options.map(function (o) { return o.off || 0; })); }
  function homeHtml(anim) {
    var w = info(), cats = catList();
    if (S.products.length && !S.groupTouched && !S.products.some(function (p) { return p.group === S.openGroup; })) {
      var first = cats.filter(function (c) { return S.products.some(function (p) { return p.group === c.name; }); })[0];
      S.openGroup = first ? first.name : '';
    }
    var groups = cats.map(function (c) {
      var g = c.name, items = S.products.filter(function (p) { return p.group === g; });
      if (!items.length) { return ''; }
      var open = S.openGroup === g;
      var rows = open ? '<div class="items">' + items.map(function (p, i) {
        var left = p.options.reduce(function (a, o) { return a + (o.left === null || o.left === undefined ? Infinity : o.left); }, 0);
        var out = !p.available || left <= 0, low = !out && p.showLeft !== false && left !== Infinity && left <= 5, off = offOf(p);
        var minP = Math.min.apply(null, p.options.map(function (o) { return o.price; }));
        var sizes = p.options.map(function (o) { return o.size; }).filter(Boolean);
        return '<button class="row item enter' + (out ? ' out' : '') + '" data-act="item" data-id="' + esc(p.id) + '" style="animation-delay:' + (i * 40) + 'ms"' + (out ? ' aria-disabled="true"' : '') + '>' +
          '<span class="t"><b>' + esc(p.name) + '</b><span>' + esc(p.en) + (p.mr ? ' · <span class="mr">' + esc(p.mr) + '</span>' : '') + '</span>' +
          (sizes.length > 1 ? '<span>' + sizes.length + ' sizes</span>' : sizes.length ? '<span>' + esc(sizes[0]) + '</span>' : '') +
          (low || off ? '<span class="tags">' + (off ? '<span class="off">' + off + '% off</span>' : '') + (low ? '<span class="low">Only ' + fmtKg(left) + ' left</span>' : '') + '</span>' : '') + '</span>' +
          '<span class="p num">' + (out ? 'Sold out' : (p.options.length > 1 ? '<small>from</small> ' : '') + rs(minP) + '/kg') + '</span></button>';
      }).join('') + '</div>' : '';
      return '<div class="group"><button class="row g-head" data-act="group" data-g="' + esc(g) + '" aria-expanded="' + open + '">' +
        '<span class="lbl">' + esc(g) + '</span><span class="mr">' + esc(c.mr || '') + '</span><span class="n num">' + items.length + '</span>' + PLUS + '</button>' + rows + '</div>';
    }).join('');
    var has = S.products.length > 0, s = sched();

    return '<div class="wrap home' + (anim ? ' enter' : '') + '">' +
      '<div class="ticket"><div class="in">' +
        '<h1 class="anton">' + w.title + '</h1>' +
        '<p>' + esc(w.line) + '</p>' +
        (w.left ? '<div class="count"><b class="num" id="left">' + w.left + '</b><span>left for same-day delivery</span></div>' : '') +
        (has ? '<a class="btn press" href="#catch" data-act="tocatch">Choose from the catch</a>'
             : '<a class="btn press" href="' + esc(reqUrl('')) + '" target="_blank" rel="noopener">Request a fish on WhatsApp</a>') +
      '</div><div class="perf"></div>' +
      '<span class="notch" style="left:-13px;bottom:82px"></span><span class="notch" style="right:-13px;bottom:82px"></span>' +
      '<div class="facts"><span><small>Delivered</small><strong>' + (has ? esc(cap(w.delivery)) + ', ' + range() : 'Same evening if you order by ' + fmtT(s.cutoff)) + '</strong></span>' +
      '<span><small>Bought at</small><strong>The morning auction, Goa and Konkan</strong></span></div></div>' +
      offersHtml() +
      installHtml() +
      (S.reloadErr ? '<div class="box warn" role="alert" style="margin-top:16px">Couldn’t refresh. Check your internet connection.</div>' : '') +
      (has ? '<section class="catch" id="catch"><h2 class="anton">Catch</h2>' +
        '<p class="lead">Priced per kg, weighed whole before cleaning. Cleaned and cut by hand in Kolhapur.</p>' +
        '<div class="crow"><span>' + (S.checkedAt ? 'Updated ' + new Date(S.checkedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '') + '</span>' + reloadBtn() + '</div>' +
        '<div class="groups">' + groups + '</div>' +
        '<a class="reqlink" href="' + esc(reqUrl('')) + '" target="_blank" rel="noopener"><b>Don’t see your fish?</b><span>Request it on WhatsApp and we’ll look for it at the next auction.</span></a></section>'
        : '<div class="box chbox" style="margin-top:24px"><span>' + (S.pending ? 'This page checks for the catch every minute.' : 'Check again for new catch.') + '</span>' + reloadBtn() + '</div>') +
      '<section class="how"><h2 class="anton">Boat to door</h2><div class="rail-bar"><span id="railbar"></span></div>' +
      '<div class="rail" id="rail">' +
        step('Bought at the auction', 'Early morning at the harbour, from boats in North Goa and on the Konkan coast.', 32, '#C2462A', '<svg width="200" height="150" viewBox="0 0 200 150" aria-hidden="true"><rect x="0" y="112" width="200" height="38" fill="#2456A6"/><path d="M14 84h172l-22 34H36z" fill="#ECE6D6"/><rect x="92" y="40" width="44" height="44" fill="#12272C"/><rect x="100" y="48" width="12" height="12" fill="#ECE6D6"/><rect x="62" y="22" width="5" height="62" fill="#12272C"/></svg>') +
        step('You order by ' + fmtT(s.cutoff), 'Pick the fish, size, pack and cut. Orders after ' + fmtT(s.cutoff) + ' go out the next evening.', 64, '#2456A6', '<svg width="170" height="170" viewBox="0 0 170 170" aria-hidden="true"><circle cx="85" cy="85" r="72" fill="#ECE6D6"/><circle cx="85" cy="85" r="6" fill="#12272C"/><rect x="82" y="34" width="6" height="54" fill="#12272C"/><rect x="82" y="82" width="40" height="6" fill="#C2462A"/></svg>') +
        step('Cleaned to your cut', 'Whole, curry cut, steaks or fillet, done by hand in Kolhapur.', 40, '#ECE6D6', '<svg width="220" height="120" viewBox="0 0 220 120" aria-hidden="true"><path d="M14 60C56 14 140 14 176 60C140 106 56 106 14 60Z" fill="#2456A6"/><path d="M172 60l38-30v60z" fill="#2456A6"/><circle cx="46" cy="54" r="6" fill="#ECE6D6"/><rect x="84" y="20" width="6" height="80" fill="#ECE6D6"/><rect x="112" y="22" width="6" height="76" fill="#ECE6D6"/><rect x="140" y="30" width="6" height="60" fill="#ECE6D6"/></svg>') +
        step('At your door by ' + fmtT(s.end), 'Packed on ice and brought to your door, ' + range() + '.', 52, '#195360', '<svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true"><path d="M20 84L90 26l70 58v80H20z" fill="#ECE6D6"/><rect x="72" y="108" width="36" height="56" fill="#C2462A"/><rect x="38" y="98" width="24" height="24" fill="#2456A6"/><rect x="118" y="98" width="24" height="24" fill="#2456A6"/></svg>') +
      '</div></section>' +
      (has ? '<a class="cta press" href="#catch" data-act="tocatch">' : '<a class="cta press" href="' + esc(reqUrl('')) + '" target="_blank" rel="noopener">') +
        '<span class="l">' + esc(w.cta) + '</span>' +
        '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M9 27L27 9M12 9h15v15"/></svg>' +
        '<span class="big anton">' + (has ? 'Order' : 'Ask us') + '</span></a>' +
      '<footer class="foot"><img src="/icons/wordmark.svg" alt="Blio" width="180" height="90">' +
        '<p>Questions or a special order? WhatsApp <a href="https://wa.me/' + CONFIG.whatsapp + '">+91 88568 88766</a>.</p>' +
        '<p>Blio is a brand of Farmblue Agrotech Private Limited, House No 1328, A/p Harkul, Khalachi Teliwadi, Kankavli, Sindhudurg 416602, Maharashtra. <a href="https://farmblue.in">farmblue.in</a></p>' +
        '<small>Prices are per kg of whole fish and change with each catch. The final bill is confirmed on WhatsApp before you pay.</small>' +
      '</footer></div>';
  }
  function cap(t) { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); }
  function step(t, d, mt, bg, svg) {
    return '<div class="step"><b>' + t + '</b><span>' + d + '</span><div class="art" style="margin-top:' + mt + 'px;background:' + bg + '">' + svg + '</div></div>';
  }

  // ---------- install hint ----------
  var deferredPrompt = null;
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredPrompt = e; if (S.screen === 'home') { render(false); } });
  function installHtml() {
    if (standalone || S.installDismissed) { return ''; }
    var img = DELIVERY_APP ? '/icons/delivery-192.png' : '/icons/icon-192.png', nm = DELIVERY_APP ? 'Blio Delivery' : 'Blio';
    if (deferredPrompt) {
      return '<div class="install"><img src="' + img + '" alt=""><p><b>Add ' + nm + ' to your phone</b><br>Opens like an app, no download from a store.</p><button class="go press" data-act="install">Add</button><button class="x" data-act="noinstall" aria-label="Dismiss">×</button></div>';
    }
    if (isIos) {
      return '<div class="install"><img src="' + img + '" alt=""><p><b>Add ' + nm + ' to your home screen</b><br>Tap Share, then Add to Home Screen.</p><button class="x" data-act="noinstall" aria-label="Dismiss">×</button></div>';
    }
    return '';
  }

  function slipHtml(anim) {
    var w = info(), t = totals(), f = S.form, e = S.errors;
    if (!S.cart.length) {
      return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="ticket"><div class="in">' +
        '<h1 class="anton" style="font-size:52px;line-height:.9">Empty slip</h1>' +
        '<p>Nothing weighed yet. Pick something from the catch.</p>' +
        '<button class="btn press" data-act="home">Back to the catch</button></div></div></div>';
    }
    var teeth = 26, pts = [], i;
    for (i = 0; i <= teeth; i++) { pts.push((i / teeth * 100).toFixed(2) + '% ' + (i % 2 ? '0px' : '8px')); }
    for (i = teeth; i >= 0; i--) { pts.push((i / teeth * 100).toFixed(2) + '% ' + (i % 2 ? '100%' : 'calc(100% - 8px)')); }
    var lines = S.cart.map(function (l, idx) {
      return '<div class="line"><div class="a"><span class="t"><b>' + esc(l.name) + '</b><small>' + esc(lineLabel(l)) + '</small></span>' +
        '<span class="tot num">' + rs(l.price * kgOf(l.pack) * l.qty) + '</span></div>' +
        '<div class="b"><div class="qty"><button class="press" data-act="ldec" data-i="' + idx + '" aria-label="One less">−</button><span class="num">' + l.qty + '</span>' +
        '<button class="press" data-act="linc" data-i="' + idx + '" aria-label="One more">+</button></div>' +
        '<button class="rm" data-act="lrm" data-i="' + idx + '">Remove</button></div></div>';
    }).join('');
    var del = f.fulfil === 'delivery';
    return '<div class="stack' + (anim ? ' enter' : '') + '">' +
      '<div class="slip" style="clip-path:polygon(' + pts.join(',') + ')">' +
        '<div class="hd"><h1 class="anton">Your slip</h1><span>Delivered ' + esc(w.delivery) + ', ' + range() + '</span></div>' +
        '<div class="lines">' + lines + '</div><div class="perf" style="margin:4px 22px 0"></div>' +
        '<div class="sums"><div><span>Subtotal</span><span class="num">' + rs(t.sub) + '</span></div>' +
        (t.disc ? '<div class="m"><span>Coupon ' + esc(S.coupon.code) + '</span><span class="num">−' + rs(t.disc) + '</span></div>' : '') +
        '<div class="m"><span>Delivery</span><span class="num">' + (t.fee ? rs(t.fee) : 'Free') + '</span></div>' +
        '<div class="t"><span>Estimated total</span><b class="num">' + rs(t.total) + '</b></div>' +
        '<span class="note">Packs are weighed whole, before cleaning. Fish don’t come in exact weights, so we confirm the final bill on WhatsApp before you pay.</span></div>' +
      '</div>' +
      '<div class="fld"><label for="f-name">Your name</label><input id="f-name" data-f="name" autocomplete="name" value="' + esc(f.name) + '" placeholder="Name for the order">' +
        (e.name ? '<span class="err">Please add your name.</span>' : '') + '</div>' +
      '<div class="fld"><label for="f-phone">Mobile number</label><input id="f-phone" data-f="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="' + esc(f.phone) + '" placeholder="10-digit number">' +
        (e.phone ? '<span class="err">Please enter a 10-digit mobile number.</span>' : '') + '</div>' +
      '<div class="fld"><span class="lab" style="font-size:16px">How you get it</span>' +
        '<div class="seg dark" data-on="' + (del ? 0 : 1) + '"><span class="ind"></span>' +
        '<button data-act="fulfil" data-v="delivery" aria-pressed="' + del + '">Home delivery</button>' +
        '<button disabled aria-disabled="true" class="soon">Self pickup<small>Starting soon</small></button></div></div>' +
      (del ?
        '<div class="fld"><label for="f-addr">Delivery address</label><textarea id="f-addr" data-f="address" autocomplete="street-address" placeholder="House, street, landmark">' + esc(f.address) + '</textarea>' +
          (e.address ? '<span class="err">Please add the address.</span>' : '') + '</div>' +
        '<div class="fld"><label for="f-area">Area in Kolhapur</label><input id="f-area" data-f="area" placeholder="For example Rajarampuri, Tarabai Park" value="' + esc(f.area) + '"></div>' +
        '<div class="fld"><span class="lab" style="font-size:16px">Location on the map</span>' +
          (f.lat ? '<div class="pinned"><span><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2"/></svg> Pinned on the map</span><button class="linkbtn" data-act="map">Change</button></div>'
                 : '<button class="btn dark press" data-act="map">Pin your location on the map</button>') +
          '<span class="hint">Optional, but it helps our delivery person find your door.</span></div>'
        : '<div class="box">Collect from the Blio cleaning point in Kolhapur, ' + esc(w.delivery) + ', ' + range() + '. We share the exact location on WhatsApp.</div>') +
      '<div class="fld"><label for="f-notes">Notes (optional)</label><input id="f-notes" data-f="notes" placeholder="Cleaning preferences, timing" value="' + esc(f.notes) + '"></div>' +
      (S.coupon ? '<div class="cpon"><span><b>' + esc(S.coupon.code) + '</b> applied · ' + esc(S.coupon.label) + (S.cChecking ? ' · checking…' : '') + '</span><button class="linkbtn" data-act="cremove">Remove</button></div>'
        : '<div class="fld"><label for="f-coupon">Coupon code (optional)</label><div class="crow2"><input id="f-coupon" autocapitalize="characters" autocomplete="off" placeholder="Enter code" value="' + esc(S.cDraft || '') + '">' +
          '<button class="btn dark press" data-act="capply"' + (S.cChecking ? ' disabled' : '') + '>' + (S.cChecking ? 'Checking…' : 'Apply') + '</button></div>' +
          (S.cErr ? '<span class="err">' + esc(S.cErr) + '</span>' : '') + '</div>') +
      (S.short ? '<div class="box warn" role="alert">' + esc(S.short) + '</div>' : '') +
      (e.server ? '<div class="box warn" role="alert">We couldn’t place the order. Check your internet connection and try again.</div>' : '') +
      '<button class="btn big press" data-act="send"' + (S.sending ? ' disabled' : '') + '>' + (S.sending ? 'Placing your order…' : 'Place order') + '</button>' +
      '<span class="muted-g">Next you send the order to us on WhatsApp. You pay by UPI after we confirm the final bill.</span>' +
      '</div>';
  }

  function doneHtml(anim) {
    var o = S.last || {};
    return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="ticket">' +
      '<div class="in"><h1 class="anton" style="font-size:96px;line-height:.84">Placed</h1>' +
      '<p>Order ' + esc(o.id) + ' for ' + rs(o.total || 0) + '. One last step: send it to us on WhatsApp so we can confirm the bill and share the UPI request.</p>' +
      '<a class="btn big press" href="' + esc(o.url) + '" target="_blank" rel="noopener">Send on WhatsApp</a></div>' +
      '<div class="perf"></div><div style="padding:18px 22px 24px;display:flex;flex-direction:column;gap:12px">' +
      '<span class="note">Delivered ' + esc(o.delivery) + ', ' + range() + '</span>' +
      progressHtml(0) + '</div></div>' +
      '<button class="btn dark press" data-act="orders">Track this order</button>' +
      '<button class="btn dark press" data-act="home">Back to the catch</button></div>';
  }

  // ---------- my orders ----------
  var STEP_OF = { 'New': 0, 'Confirmed': 1, 'Paid': 1, 'Packed': 2, 'Out for delivery': 3, 'Arriving next': 3, 'Delivered': 4 };
  var STEP_LABELS = ['Placed', 'Accepted', 'Packed', 'On the way', 'Delivered'];
  function progressHtml(step) {
    return '<div class="progress p5">' + STEP_LABELS.map(function (l, i) { return '<span' + (i <= step ? ' class="on"' : '') + '></span>'; }).join('') + '</div>' +
      '<div class="plabels p5">' + STEP_LABELS.map(function (l, i) { return i === step ? '<b>' + l + '</b>' : '<span>' + l + '</span>'; }).join('') + '</div>';
  }
  function timeOf(t) { var p = String(t || '').split(', '); return p[1] || p[0] || ''; }
  function loadMyOrders() {
    var withTok = S.myorders.filter(function (o) { return o.token; });
    if (!CONFIG.api || !withTok.length) { return; }
    S.ordLoading = true; S.ordErr = ''; if (S.screen === 'orders') { keepScroll(); }
    var ids = withTok.slice(0, 50).map(function (o) { return o.id + ':' + o.token; }).join(',');
    fetch(CONFIG.api + '?action=myorders&ids=' + encodeURIComponent(ids), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.ordLoading = false;
        if (d.ok) {
          var by = {}; d.orders.forEach(function (x) { by[x.id] = x; });
          S.myorders.forEach(function (o) {
            var x = by[o.id]; if (!x) { return; }
            o.status = x.status; o.final = x.final; o.bill = x.bill; o.deliveredAt = x.deliveredAt; o.total = x.total || o.total;
            o.paid = !!x.paid; o.outAt = x.outAt || ''; o.nextAt = x.nextAt || ''; o.rider = x.rider || '';
          });
          store('myorders', S.myorders);
        } else { S.ordErr = 'Couldn’t check the latest status. Showing what was last seen.'; }
        if (S.screen === 'orders') { keepScroll(); }
      })
      .catch(function () { S.ordLoading = false; S.ordErr = 'No connection. Showing the status last seen on this phone.'; if (S.screen === 'orders') { keepScroll(); } });
  }
  function orderCard(o) {
    var st = o.status === 'Paid' ? 'Confirmed' : (o.status || 'New');
    var paid = o.paid || o.status === 'Paid';
    var amount = o.final !== '' && o.final !== null && o.final !== undefined ? o.final : o.total;
    var when = new Date(o.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    var text = {
      'New': 'Placed. We confirm it on WhatsApp with the final bill.',
      'Confirmed': 'Confirmed. Your fish is set aside and cleaned for delivery ' + (o.dDate ? evening(o.dDate) : (o.delivery || '') + ' evening') + '.',
      'Packed': 'Packed and ready. It leaves for delivery soon.',
      'Out for delivery': 'Out for delivery' + (o.outAt ? ' since ' + timeOf(o.outAt) : '') + '. Arriving ' + range() + '.',
      'Arriving next': 'You’re next. Arriving in about 15 minutes.',
      'Delivered': 'Delivered' + (o.deliveredAt ? ' at ' + timeOf(o.deliveredAt) : '') + '.',
      'Cancelled': 'This order was cancelled.'
    }[st] || st;
    var onWay = st === 'Out for delivery' || st === 'Arriving next';
    var payTag = st === 'New' || st === 'Cancelled' ? '' : (paid ? '<span class="ptag paid">Paid</span>' : '<span class="ptag">Not paid yet</span>');
    var items = (o.lines || []).map(function (l) { return esc(l.name) + (l.size ? ' (' + esc(l.size.toLowerCase()) + ')' : '') + ' ' + esc(l.pack) + (l.qty > 1 ? ' x' + l.qty : ''); }).join(', ');
    var canPay = !paid && S.upi && ['Confirmed', 'Packed', 'Out for delivery', 'Arriving next'].indexOf(st) > -1;
    return '<div class="ocard' + (st === 'Cancelled' ? ' cancelled' : '') + (st === 'Arriving next' ? ' next' : '') + '">' +
      '<div class="dtop"><b>' + esc(o.id) + '</b><span class="num">' + rs(amount) + '</span></div>' +
      '<span class="dsub">' + when + ' · for ' + esc(o.dDate ? dLabel(o.dDate) : (o.delivery || '')) + payTag + '</span>' +
      '<p class="ditems">' + items + '</p>' +
      '<p class="ostat">' + esc(text) + '</p>' + (st === 'Cancelled' ? '' : progressHtml(STEP_OF[st])) +
      '<div class="obtns">' +
        (onWay && o.rider ? '<a class="btn press wide" href="tel:+91' + esc(o.rider) + '">Call delivery person</a>' : '') +
        (canPay ? '<a class="btn press" href="#pay?o=' + encodeURIComponent(o.id) + '&a=' + Math.round(amount) + '">Pay ' + rs(amount) + '</a>' : '') +
        (o.bill ? (S.billFiles[o.id] ? '<button class="btn dark press" data-act="billopen" data-id="' + esc(o.id) + '">Open bill (PDF)</button>'
          : '<button class="btn dark press" data-act="billget" data-id="' + esc(o.id) + '"' + (S.billBusy === o.id ? ' disabled' : '') + '>' + (S.billBusy === o.id ? 'Getting bill…' : 'Get bill') + '</button>') : '') +
        '<button class="btn dark press" data-act="reorder" data-id="' + esc(o.id) + '">Order again</button>' +
      '</div></div>';
  }
  function ordersHtml(anim) {
    var active = S.myorders.filter(function (o) { return o.status !== 'Delivered' && o.status !== 'Cancelled'; });
    var past = S.myorders.filter(function (o) { return o.status === 'Delivered' || o.status === 'Cancelled'; });
    return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="dhead"><h1 class="anton">Your orders</h1>' +
        (S.myorders.some(function (o) { return o.token; }) ? '<button class="linkbtn" data-act="ordreload"' + (S.ordLoading ? ' disabled' : '') + '>' + (S.ordLoading ? 'Checking…' : 'Refresh') + '</button>' : '') + '</div>' +
      (S.ordNote ? '<div class="box" role="status">' + esc(S.ordNote) + '</div>' : '') +
      (S.ordErr ? '<div class="box warn" role="alert">' + esc(S.ordErr) + '</div>' : '') +
      (!S.myorders.length ? '<div class="box">No orders on this phone yet. Orders you place from this phone show up here, with their status.</div>' +
        '<button class="btn big press" data-act="home">Choose from the catch</button>' : '') +
      (active.length ? '<h2 class="osec">On the way</h2>' + active.map(orderCard).join('') : '') +
      (past.length ? '<h2 class="osec">Past orders</h2>' + past.map(orderCard).join('') : '') +
      (S.myorders.length ? '<span class="muted-g">Shows orders placed from this phone. Questions? WhatsApp <a href="https://wa.me/' + CONFIG.whatsapp + '">+91 88568 88766</a>.</span>' : '') +
      '</div>';
  }
  function reorder(id) {
    var o = S.myorders.filter(function (x) { return x.id === id; })[0]; if (!o) { return; }
    var added = 0, missed = [];
    (o.lines || []).forEach(function (l) {
      var p = S.products.filter(function (x) { return x.name === l.name; })[0];
      var need = kgOf(l.pack) * l.qty, opts = p && p.available ? p.options.filter(function (x) { return kgLeft(p, x.key) >= need; }) : [];
      var op = opts.filter(function (x) { return x.size === (l.size || ''); })[0] || opts[0];
      if (!op) { missed.push(l.name + (l.size ? ' (' + l.size.toLowerCase() + ')' : '')); return; }
      var cut = p.cuts.indexOf(l.cut) > -1 ? l.cut : p.cuts[0], key = lineKey(p, op, l.pack, cut);
      var hit = S.cart.filter(function (c) { return c.key === key; })[0];
      if (hit) { hit.qty += l.qty; } else { S.cart.push({ key: key, id: p.id, name: p.name, opt: op.key, size: op.size, pack: l.pack, cut: cut, qty: l.qty, price: op.price }); }
      added++;
    });
    saveCart();
    if (!added) { S.ordNote = 'None of these items are available right now.'; keepScroll(); return; }
    S.ordNote = '';
    go('slip');
    if (missed.length) { S.short = 'Not available right now, so left out: ' + missed.join(', ') + '. Prices and sizes are from today’s catch.'; keepScroll(); }
  }

  // ---------- sheet ----------
  function sheetHtml() {
    var p = findP(S.pick.id), k = S.pick, o = optOf(p, k.opt) || p.options[0], left = kgLeft(p, o.key);
    var showOpts = p.options.length > 1 || !!o.size;
    var opts = showOpts ? '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Size</span><div class="opts">' +
      p.options.map(function (x) {
        var l = kgLeft(p, x.key), out = l <= 0;
        return '<button class="opt press" data-act="opt" data-v="' + esc(x.key) + '" aria-pressed="' + (x.key === o.key) + '"' + (out ? ' disabled' : '') + '>' +
          '<span class="ol"><b>' + esc(x.size || 'One size') + '</b><small>' + [whereWhen(x), out ? 'Sold out' : l === Infinity || p.showLeft === false ? '' : fmtKg(l) + ' left'].filter(Boolean).map(esc).join(' · ') + '</small></span>' +
          '<span class="or num">' + (x.off ? '<s>' + rs(x.base) + '</s>' : '') + rs(x.price) + '<small>/kg</small></span></button>';
      }).join('') + '</div></div>' : '';
    var yieldTxt = p.yieldPct > 0 && p.yieldPct < 100 ? ' 1 kg gives about ' + Math.round(p.yieldPct * 10) + ' g after cleaning.' : '';
    return '<div class="grab" id="grab"><span class="h"></span><div class="field" style="background:' + (FIELD[p.group] || '#2456A6') + '">' + (ART[p.group] || ART.Fish) + '</div></div>' +
      '<div class="body"><div style="display:flex;flex-direction:column;gap:4px">' +
        '<h3 class="anton" id="sheet-title">' + esc(p.name) + '</h3>' +
        '<span class="sub">' + esc(p.en) + (p.mr ? ' · <span class="mr">' + esc(p.mr) + '</span>' : '') + (p.origin ? ' · from ' + esc(p.origin) : '') + '</span>' +
        '<span class="pr num">' + (o.off ? '<s>' + rs(o.base) + '</s> ' : '') + rs(o.price) + ' per kg' + (o.off ? ' · ' + o.off + '% off' : '') +
          (!showOpts && whereWhen(o) ? ' · ' + esc(whereWhen(o)) : '') + '</span>' +
        '<span class="sub" style="font-size:14px">Weighed whole, before cleaning.' + yieldTxt + '</span></div>' +
      opts +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Pack</span>' +
        '<div class="seg" data-on="' + (k.pack === '1 kg' ? 1 : 0) + '"><span class="ind"></span>' +
        '<button data-act="pack" data-v="500 g" aria-pressed="' + (k.pack === '500 g') + '">500 g</button>' +
        '<button data-act="pack" data-v="1 kg" aria-pressed="' + (k.pack === '1 kg') + '">1 kg</button></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Cut</span><div class="chips">' +
        p.cuts.map(function (c) { return '<button class="chip press" data-act="cut" data-v="' + esc(c) + '" aria-pressed="' + (c === k.cut) + '">' + esc(c) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="addrow"><div class="qty"><button class="press" data-act="qdec" aria-label="One less">−</button><span class="num">' + k.qty + '</span>' +
        '<button class="press" data-act="qinc" aria-label="One more">+</button></div>' +
        (kgOf(k.pack) * k.qty > left
          ? '<button class="btn num" disabled>' + (left > 0 ? (p.showLeft === false ? 'Not enough left' : 'Only ' + fmtKg(left) + ' left') : 'Sold out') + '</button></div></div>'
          : '<button class="btn press num" data-act="add">Add to slip · ' + rs(o.price * kgOf(k.pack) * k.qty) + '</button></div></div>');
  }
  function findP(id) { return S.products.filter(function (p) { return p.id === id; })[0] || S.products[0]; }
  function openSheet(id, key) {
    var p = S.products.filter(function (x) { return x.id === id; })[0]; if (!p || !p.available) { return; }
    var o = p.options.filter(function (x) { return x.key === key && kgLeft(p, x.key) > 0; })[0] || p.options.filter(function (x) { return kgLeft(p, x.key) > 0; })[0]; if (!o) { return; }
    S.pick = { id: p.id, opt: o.key, pack: kgLeft(p, o.key) >= 1 ? '1 kg' : '500 g', cut: p.cuts[0], qty: 1 };
    sheetEl.innerHTML = sheetHtml(); sheetEl.setAttribute('aria-label', p.name);
    sheetEl.scrollTop = 0; sheetEl.classList.add('show'); scrim.classList.add('show');
    bindDrag();
  }
  function closeSheet() { sheetEl.classList.remove('show'); scrim.classList.remove('show'); sheetEl.style.transform = ''; }
  function rerenderSheet() { var st = sheetEl.scrollTop; sheetEl.innerHTML = sheetHtml(); sheetEl.scrollTop = st; bindDrag(); }
  function bindDrag() {
    var g = $('#grab'), d = null;
    var rubber = function (o) { return (o * 300 * 0.55) / (300 + 0.55 * Math.abs(o)); };
    g.addEventListener('pointerdown', function (e) {
      if (d) { return; }
      try { g.setPointerCapture(e.pointerId); } catch (err) {}
      d = { id: e.pointerId, y0: e.clientY, ly: e.clientY, lt: e.timeStamp, v: 0, y: 0 };
      sheetEl.classList.add('dragging');
    });
    g.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) { return; }
      var dt = Math.max(1, e.timeStamp - d.lt); d.v = (e.clientY - d.ly) / dt; d.ly = e.clientY; d.lt = e.timeStamp;
      var raw = e.clientY - d.y0; d.y = raw >= 0 ? raw : -rubber(-raw);
      sheetEl.style.transform = 'translateY(' + d.y + 'px)';
      scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, d.y) / 500));
    });
    var end = function (e) {
      if (!d || e.pointerId !== d.id) { return; }
      var dismiss = d.y > 140 || d.v > 0.5; d = null;
      sheetEl.classList.remove('dragging'); sheetEl.style.transform = ''; scrim.style.opacity = '';
      if (dismiss) { closeSheet(); }
    };
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  }

  // ---------- order ----------
  function orderId() {
    var n = istNow();
    return 'BL' + String(n.getDate()).padStart(2, '0') + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(Math.floor(100 + Math.random() * 900));
  }
  function dLabel(ds) {
    var p = String(ds || '').split('-'); if (p.length !== 3) { return String(ds || ''); }
    return DSHORT[new Date(+p[0], +p[1] - 1, +p[2]).getDay()] + ' ' + (+p[2]) + ' ' + MSHORT[+p[1] - 1];
  }
  function waText(o, f) {
    var msg = ['Blio order ' + o.id, 'Delivery: ' + dLabel(o.dDate) + ', ' + range(), ''];
    o.lines.forEach(function (l, i) { msg.push((i + 1) + '. ' + l.name + (l.size ? ' (' + l.size + ')' : '') + ', ' + l.pack + ', ' + l.cut + ' x' + l.qty + ' = ' + rs(l.total)); });
    msg.push('', 'Subtotal: ' + rs(o.subtotal));
    if (o.discount) { msg.push('Coupon ' + o.coupon + ': -' + rs(o.discount)); }
    msg.push('Delivery: ' + rs(o.fee), 'Estimated total: ' + rs(o.total), '');
    msg.push('Name: ' + f.name.trim(), 'Mobile: ' + f.phone);
    msg.push('Address: ' + f.address.trim().replace(/\s*\n\s*/g, ', ') + (f.area.trim() ? ', ' + f.area.trim() : ''));
    if (f.lat) { msg.push('Location: https://maps.google.com/?q=' + f.lat + ',' + f.lng); }
    if (f.notes.trim()) { msg.push('Notes: ' + f.notes.trim()); }
    msg.push('Payment: UPI after confirmation');
    return msg.join('\n');
  }
  function finish(o) {
    var f = S.form;
    o.dDate = (o.delivery && o.delivery.date) || plan().date;
    o.url = 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(waText(o, f));
    o.delivery = evening(o.dDate);
    S.myorders.unshift({ id: o.id, token: o.token || '', placedAt: Date.now(), dDate: o.dDate,
      lines: o.lines, total: o.total, final: '', status: 'New', bill: '' });
    S.myorders = S.myorders.slice(0, 50); store('myorders', S.myorders);
    S.last = o; S.cart = []; saveCart(); S.form.notes = ''; saveForm(); S.sending = false; S.short = null; S.coupon = null; S.cErr = ''; S.cDraft = '';
    go('done');
  }
  function send() {
    if (S.sending) { return; }
    var f = S.form, e = {};
    f.phone = String(f.phone || '').replace(/[^0-9]/g, '').slice(-10);
    if (!f.name.trim()) { e.name = true; }
    if (f.phone.length !== 10) { e.phone = true; }
    if (!f.address.trim()) { e.address = true; }
    S.errors = e; S.short = null;
    if (e.name || e.phone || e.address) { keepScroll(); var el = $(e.name ? '#f-name' : e.phone ? '#f-phone' : '#f-addr'); if (el) { el.focus(); } return; }
    var lines = S.cart.map(function (l) { return { name: l.name, key: l.opt || '', size: l.size || '', pack: l.pack, cut: l.cut, qty: l.qty, total: l.price * kgOf(l.pack) * l.qty }; });
    if (!CONFIG.api) {
      var t = totals(), n = istNow();
      finish({ id: 'BL' + String(n.getDate()).padStart(2, '0') + String(n.getMonth() + 1).padStart(2, '0') + '-' + Math.floor(100 + Math.random() * 900), lines: lines, subtotal: t.sub, fee: t.fee, total: t.total });
      return;
    }
    S.sending = true; keepScroll();
    fetch(CONFIG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ name: f.name, phone: f.phone, address: f.address, area: f.area, notes: f.notes, lat: f.lat || null, lng: f.lng || null, items: lines, coupon: S.coupon ? S.coupon.code : '' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { finish({ id: d.id, token: d.token, lines: d.lines, subtotal: d.subtotal, fee: d.fee, discount: d.discount || 0, coupon: d.coupon || '', total: d.total, delivery: d.delivery }); return; }
        S.sending = false;
        if (d.error === 'coupon') {
          S.cErr = (S.coupon ? S.coupon.code + ': ' : '') + couponMsg({ error: d.reason, min: d.min }) + ' Remove it or try another code.';
          S.cDraft = S.coupon ? S.coupon.code : ''; S.coupon = null;
        } else if (d.error === 'stock') {
          var msg = 'Some items ran short while you were ordering: ' + d.short.map(function (x) { var hp = S.products.filter(function (q) { return q.name === x.name; })[0], hide = hp && hp.showLeft === false;
            return x.name + (x.size ? ' ' + x.size.toLowerCase() : '') + (x.left ? (hide ? ' (not enough left)' : ' (only ' + fmtKg(x.left) + ' left)') : ' (sold out)'); }).join(', ') + '. Please change your slip and place the order again.';
          loadApi();
          S.short = msg;
        } else { S.errors = { server: true }; }
        keepScroll();
      })
      .catch(function () { S.sending = false; S.errors = { server: true }; keepScroll(); });
  }

  // ---------- map pin ----------
  var mapov = $('#mapov'), lmap = null;
  function mapMsg(t) { var m = $('#mapmsg'); if (m) { m.textContent = t; } }
  function loadLeaflet(cb) {
    if (window.L) { cb(); return; }
    var css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    var js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = cb; js.onerror = function () { mapMsg('The map couldn’t load. Check your internet connection and try again.'); };
    document.head.appendChild(js);
  }
  function locate() {
    if (!navigator.geolocation || !lmap) { mapMsg('Move the map so the pin sits on your gate or building.'); return; }
    mapMsg('Finding where you are…');
    navigator.geolocation.getCurrentPosition(function (p) {
      lmap.setView([p.coords.latitude, p.coords.longitude], 18);
      mapMsg('Move the map so the pin sits exactly on your gate or building.');
    }, function () {
      mapMsg('Couldn’t get your location. Move the map so the pin sits on your gate or building.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  function openMap() {
    mapov.hidden = false; requestAnimationFrame(function () { mapov.classList.add('show'); });
    mapMsg('Loading the map…');
    loadLeaflet(function () {
      if (!lmap) {
        lmap = L.map('lmap', { zoomControl: true }).setView([16.705, 74.2433], 13);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(lmap);
      }
      setTimeout(function () {
        lmap.invalidateSize();
        if (S.form.lat) { lmap.setView([S.form.lat, S.form.lng], 18); mapMsg('Move the map so the pin sits exactly on your gate or building.'); }
        else { locate(); }
      }, 60);
    });
  }
  function closeMap() { mapov.classList.remove('show'); setTimeout(function () { mapov.hidden = true; }, 260); }
  function confirmMap() {
    if (!lmap) { return; }
    var c = lmap.getCenter();
    S.form.lat = +c.lat.toFixed(6); S.form.lng = +c.lng.toFixed(6); saveForm();
    closeMap(); keepScroll();
  }

  // ---------- delivery page ----------
  function loadDeliveries() {
    if (!CONFIG.api || !S.dpin) { return; }
    S.dLoading = true; S.dErr = ''; keepScroll();
    fetch(CONFIG.api + '?action=deliveries&pin=' + encodeURIComponent(S.dpin), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        S.dLoading = false;
        if (d.ok) {
          S.roles = d.roles || ['delivery']; S.deliv = d.orders || null; S.pack = d.pack || null;
          if (S.roles.indexOf(S.dTab) === -1) { S.dTab = S.roles[0]; }
        }
        else if (d.error === 'locked') { S.dErr = 'Too many wrong PINs. Wait 10 minutes and try again.'; S.dpin = ''; store('dpin', ''); }
        else { S.dErr = 'That PIN didn’t work. Ask for the Delivery or Packing PIN set in Blio Admin.'; S.dpin = ''; store('dpin', ''); S.deliv = null; S.pack = null; }
        keepScroll();
      })
      .catch(function () { S.dLoading = false; S.dErr = 'Couldn’t load deliveries. Check your internet connection.'; keepScroll(); });
  }
  function riderPost(body, onOk, failMsg) {
    fetch(CONFIG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ pin: S.dpin }, body)) })
      .then(function (r) { return r.json(); })
      .then(function (d) { S.dBusy = ''; if (d.ok) { S.dErr = ''; onOk(d); } else { S.dErr = failMsg; } keepScroll(); })
      .catch(function () { S.dBusy = ''; S.dErr = 'No connection. ' + failMsg; keepScroll(); });
  }
  function startDelivery() {
    var ids = (S.deliv || []).filter(function (o) { return o.status === 'Confirmed' || o.status === 'Packed'; }).map(function (o) { return o.id; });
    if (!ids.length) { return; }
    if (!S.dStartConfirm) { S.dStartConfirm = true; keepScroll(); return; }
    S.dStartConfirm = false; S.dBusy = 'start'; keepScroll();
    riderPost({ action: 'start', ids: ids }, function () {
      S.deliv.forEach(function (o) { if (ids.indexOf(o.id) > -1) { o.status = 'Out for delivery'; } });
    }, 'Couldn’t start the delivery. Try again.');
  }
  function nextStop(id) {
    var o = (S.deliv || []).filter(function (x) { return x.id === id; })[0]; if (!o) { return; }
    o.saving = true; keepScroll();
    riderPost({ action: 'next', id: id }, function () { o.saving = false; o.status = 'Arriving next'; }, 'Couldn’t update ' + id + '. Try again.');
    setTimeout(function () { if (o.saving) { o.saving = false; } }, 20000);
  }
  function markDelivered(id) {
    if (S.dConfirm !== id) { S.dConfirm = id; keepScroll(); return; }
    S.dConfirm = '';
    var o = (S.deliv || []).filter(function (x) { return x.id === id; })[0]; if (o) { o.saving = true; } keepScroll();
    fetch(CONFIG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'delivered', pin: S.dpin, id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { S.deliv = S.deliv.filter(function (x) { return x.id !== id; }); }
        else { if (o) { o.saving = false; } S.dErr = 'Couldn’t mark ' + id + ' as delivered. Try again.'; }
        keepScroll();
      })
      .catch(function () { if (o) { o.saving = false; } S.dErr = 'No connection. ' + id + ' is not marked yet.'; keepScroll(); });
  }
  function roleTabs() {
    if (!S.roles || S.roles.length < 2) { return ''; }
    return '<div class="chiprow" role="group" aria-label="Work">' + S.roles.map(function (r) {
      return '<button class="chip" data-act="dtab" data-v="' + r + '" aria-pressed="' + (S.dTab === r) + '">' + (r === 'packing' ? 'Packing' : 'Delivery') + '</button>';
    }).join('') + '</div>';
  }
  function packAct(action, id) {
    if (action === 'packed' && S.pConfirm !== id) { S.pConfirm = id; keepScroll(); return; }
    S.pConfirm = ''; S.pBusy = id; S.dErr = ''; keepScroll();
    fetch(CONFIG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: action, pin: S.dpin, by: S.packBy, id: id }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { S.pBusy = ''; if (d.ok) { loadDeliveries(); } else { S.dErr = d.error === 'role' ? 'This PIN can’t mark orders packed.' : 'Couldn’t update ' + id + '. Refresh and try again.'; keepScroll(); } })
      .catch(function () { S.pBusy = ''; S.dErr = 'No connection. ' + id + ' is not updated.'; keepScroll(); });
  }
  function dayFor(win) { var w = dayWord(String(win || '').slice(0, 10)); return w === 'today' || w === 'tomorrow' ? 'for ' + w : 'for ' + w; }
  function packingHtml(anim) {
    var P = S.pack || { orders: [], cutList: [] };
    var todo = P.orders.filter(function (o) { return o.status === 'Confirmed'; }), done = P.orders.filter(function (o) { return o.status === 'Packed'; });
    var head = '<div class="dhead"><h1 class="anton">Packing</h1><span class="dcount">' + (S.pack ? todo.length + ' to pack' : '') + '</span></div>' + roleTabs();
    if (!S.packBy) {
      return '<div class="stack' + (anim ? ' enter' : '') + '">' + head +
        '<div class="fld"><label for="p-by">Your name</label><input id="p-by" autocomplete="name" placeholder="Shown next to the orders you pack"></div>' +
        '<button class="btn big press" data-act="pbyok">Continue</button></div>';
    }
    var lineTxt = function (x) { return esc(x.item) + (x.size ? ' (' + esc(x.size.toLowerCase()) + ')' : '') + ', ' + esc(x.pack) + (x.qty > 1 ? ' x' + x.qty : '') + ', ' + esc(x.cut); };
    return '<div class="stack' + (anim ? ' enter' : '') + '">' + head +
      (S.dErr ? '<div class="box warn" role="alert">' + esc(S.dErr) + '</div>' : '') +
      (S.dLoading && !S.pack ? '<div class="box">Loading orders…</div>' : '') +
      (P.cutList.length ? '<h2 class="osec">To clean and cut</h2><div class="abuy">' + P.cutList.map(function (c) {
        return '<div><span>' + esc(c.item) + (c.size ? ' · ' + esc(c.size.toLowerCase()) : '') + '<small class="dsub" style="display:block">' + esc(c.cut) + '</small></span><b class="num">' + fmtKg(c.kg) + '</b></div>';
      }).join('') + '</div><span class="muted-g" style="text-align:left;margin-top:-6px">Whole weight before cleaning, for orders not packed yet.</span>' : '') +
      (S.pack && !P.orders.length ? '<div class="box">Nothing to pack right now. Orders show here once they are confirmed in Admin.</div>' : '') +
      (todo.length ? '<h2 class="osec">To pack</h2>' : '') + todo.map(function (o) {
        var busy = S.pBusy === o.id;
        return '<div class="dcard"><span class="stage conf">' + esc(dayFor(o.window)) + '</span>' +
          '<div class="dtop"><b>' + esc(o.id) + '</b><span class="dsub">' + esc(o.name) + (o.area ? ' · ' + esc(o.area) : '') + '</span></div>' +
          '<ul class="plines">' + o.lines.map(function (x) { return '<li>' + lineTxt(x) + '</li>'; }).join('') + '</ul>' +
          (o.notes ? '<p class="dnote">Note: ' + esc(o.notes) + '</p>' : '') +
          '<button class="btn press' + (S.pConfirm === o.id ? ' confirm' : '') + '" data-act="packed" data-id="' + esc(o.id) + '"' + (busy ? ' disabled' : '') + '>' +
            (busy ? 'Saving…' : S.pConfirm === o.id ? 'Tap again to confirm packed' : 'Mark packed') + '</button></div>';
      }).join('') +
      (done.length ? '<h2 class="osec">Packed</h2>' : '') + done.map(function (o) {
        return '<div class="dcard"><span class="stage packed">Packed</span><div class="dtop"><b>' + esc(o.id) + '</b><span class="dsub">' + esc(o.name) + (o.area ? ' · ' + esc(o.area) : '') + '</span></div>' +
          '<span class="dsub">' + esc(o.packedBy) + '</span>' +
          '<button class="btn dark press" data-act="unpack" data-id="' + esc(o.id) + '"' + (S.pBusy === o.id ? ' disabled' : '') + '>Not packed yet (undo)</button></div>';
      }).join('') +
      '<div class="dfoot"><button class="btn dark press" data-act="dreload">' + (S.dLoading ? 'Refreshing…' : 'Refresh') + '</button>' +
      '<button class="linkbtn light" data-act="pbychange">Not ' + esc(S.packBy) + '?</button>' +
      '<button class="linkbtn light" data-act="dlogout">Lock this page</button></div>' + installHtml() + '</div>';
  }
  function deliveryHtml(anim) {
    var head = '<div class="dhead"><h1 class="anton">Delivery</h1>';
    if (!S.dpin) {
      return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="dhead"><h1 class="anton">Blio team</h1></div>' +
        '<div class="fld"><label for="d-pin">Staff PIN</label><input id="d-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="Delivery or packing PIN"></div>' +
        (S.dErr ? '<div class="box warn" role="alert">' + esc(S.dErr) + '</div>' : '') +
        '<button class="btn big press" data-act="dlogin">Open</button>' +
        '<span class="muted-g">For the Blio team only.</span>' + installHtml() + '</div>';
    }
    if (S.dTab === 'packing') { return packingHtml(anim); }
    var RANK = { 'Arriving next': 0, 'Out for delivery': 1, 'Packed': 2, 'Confirmed': 3 };
    var list = (S.deliv || []).slice().sort(function (a, b) { return (RANK[a.status] || 0) - (RANK[b.status] || 0); });
    var toStart = list.filter(function (o) { return o.status === 'Confirmed' || o.status === 'Packed'; });
    var startBtn = toStart.length ? '<button class="btn big press' + (S.dStartConfirm ? ' confirmdark' : '') + '" data-act="dstart"' + (S.dBusy ? ' disabled' : '') + '>' +
        (S.dBusy === 'start' ? 'Starting…' : S.dStartConfirm ? 'Tap again to start ' + toStart.length + (toStart.length === 1 ? ' order' : ' orders') : 'Start delivery · ' + toStart.length + (toStart.length === 1 ? ' order' : ' orders')) + '</button>' +
        '<span class="muted-g" style="margin-top:-10px">Customers see that their order is on the way.</span>' : '';
    var cards = list.map(function (o) {
      var amount = o.final !== '' && o.final !== null && o.final !== undefined ? o.final : o.total;
      var nav = o.map || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address + ', ' + o.area + ', Kolhapur'));
      var paid = o.paid || o.status === 'Paid';
      var stageCls = { 'Arriving next': 'next', 'Out for delivery': 'out', 'Packed': 'packed', 'Confirmed': 'conf' }[o.status] || 'conf';
      var stageTxt = { 'Arriving next': 'Next stop', 'Out for delivery': 'On the way', 'Packed': 'Packed', 'Confirmed': 'Confirmed' }[o.status] || o.status;
      return '<div class="dcard' + (o.status === 'Arriving next' ? ' nextcard' : '') + '"><span class="stage ' + stageCls + '">' + stageTxt + '</span>' +
        '<div class="dtop"><b>' + esc(o.name) + '</b><span class="amt num' + (paid ? ' paid' : '') + '">' +
          (paid ? 'Paid' : 'Collect ' + rs(amount)) + '</span></div>' +
        '<span class="dsub">' + esc(o.id) + (o.area ? ' · ' + esc(o.area) : '') + (o.map ? ' · pinned' : '') + '</span>' +
        '<p>' + esc(o.address) + '</p>' +
        (o.notes ? '<p class="dnote">Note: ' + esc(o.notes) + '</p>' : '') +
        '<p class="ditems">' + esc(o.items) + '</p>' +
        '<div class="dbtns"><a class="btn dark" href="tel:+91' + esc(o.mobile) + '">Call</a>' +
        '<a class="btn dark" href="' + esc(nav) + '" target="_blank" rel="noopener">Navigate</a>' +
        '<a class="btn dark" href="https://wa.me/91' + esc(o.mobile) + '" target="_blank" rel="noopener">WhatsApp</a></div>' +
        (o.status === 'Out for delivery' ? '<button class="btn dark press" data-act="dnext" data-id="' + esc(o.id) + '"' + (o.saving ? ' disabled' : '') + '>Next stop: tell customer</button>' : '') +
        (o.status === 'Arriving next' ? '<span class="dnote2">Customer has been told you’re next.</span>' : '') +
        '<button class="btn press' + (S.dConfirm === o.id ? ' confirm' : '') + '" data-act="ddone" data-id="' + esc(o.id) + '"' + (o.saving ? ' disabled' : '') + '>' +
          (o.saving ? 'Saving…' : S.dConfirm === o.id ? 'Tap again to confirm' : 'Mark delivered') + '</button></div>';
    }).join('');
    return '<div class="stack' + (anim ? ' enter' : '') + '">' + head +
        '<span class="dcount">' + (S.deliv ? list.length + (list.length === 1 ? ' order to deliver' : ' orders to deliver') : '') + '</span></div>' + roleTabs() +
      (S.dErr ? '<div class="box warn" role="alert">' + esc(S.dErr) + '</div>' : '') +
      (S.dLoading && !S.deliv ? '<div class="box">Loading orders…</div>' : '') +
      (S.deliv && !list.length ? '<div class="box">Nothing to deliver right now. Orders appear here once they are marked Confirmed or Packed in the sheet.</div>' : '') +
      startBtn + cards +
      '<div class="dfoot"><button class="btn dark press" data-act="dreload">' + (S.dLoading ? 'Refreshing…' : 'Refresh') + '</button>' +
      '<button class="linkbtn light" data-act="dlogout">Lock this page</button></div>' + installHtml() + '</div>';
  }

  // ---------- payment page ----------
  function payParams() {
    var q = (location.hash.split('?')[1] || ''), o = {};
    q.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) { o[p[0]] = decodeURIComponent(p[1] || ''); } });
    return { id: (o.o || '').replace(/[^A-Za-z0-9-]/g, ''), amount: Math.max(0, Math.round(parseFloat(o.a) || 0)) };
  }
  function payHtml(anim) {
    var p = payParams();
    var upiLink = S.upi ? 'upi://pay?pa=' + S.upi.replace(/[^A-Za-z0-9.@_-]/g, '') + '&pn=' + encodeURIComponent(S.payee || 'Farmblue Agrotech') +
      (p.amount ? '&am=' + p.amount : '') + '&cu=INR&tn=' + encodeURIComponent('Blio ' + p.id) : '';
    return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="ticket"><div class="in">' +
      '<span class="note">Blio order ' + esc(p.id) + '</span>' +
      '<h1 class="anton" style="font-size:72px;line-height:.9">' + (p.amount ? rs(p.amount) : 'Pay') + '</h1>' +
      (S.upi
        ? '<a class="btn big press" href="' + esc(upiLink) + '">Pay with a UPI app</a>' +
          '<p style="font-size:15px">If the button doesn’t open your UPI app, pay to this UPI ID:</p>' +
          '<div class="upi"><span class="num" id="upi-id">' + esc(S.upi) + '</span><button class="chip press" data-act="copyupi">Copy</button></div>' +
          (S.payee ? '<span class="note">Paying ' + esc(S.payee) + '</span>' : '')
        : '<p>Payment details aren’t loaded yet. Check your connection, or ask us on WhatsApp.</p>') +
      '</div><div class="perf"></div><div style="padding:18px 22px 24px;display:flex;flex-direction:column;gap:12px">' +
      '<span class="note">After paying, send us the payment screenshot on WhatsApp so we can mark your order paid.</span>' +
      '<a class="btn dark press" href="https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent('Paid for Blio order ' + p.id) + '" target="_blank" rel="noopener">Send screenshot on WhatsApp</a></div></div></div>';
  }

  // ---------- render ----------
  function render(anim) {
    if (S.screen === 'home') { main.innerHTML = homeHtml(anim); bindRail(); }
    else if (S.screen === 'slip') { main.innerHTML = slipHtml(anim); }
    else if (S.screen === 'delivery') { main.innerHTML = deliveryHtml(anim); }
    else if (S.screen === 'pay') { main.innerHTML = payHtml(anim); }
    else if (S.screen === 'orders') { main.innerHTML = ordersHtml(anim); }
    else { main.innerHTML = doneHtml(anim); }
    back.hidden = S.screen === 'home' || DELIVERY_APP;
    var t = totals();
    bar.innerHTML = '<span class="l"><small>Your slip</small><span class="c" id="cnt">' + t.count + (t.count === 1 ? ' item' : ' items') + '</span></span>' +
      '<span class="s num">' + rs(t.sub) + '</span><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#12272C" stroke-width="2.25" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
    bar.classList.toggle('show', S.cart.length > 0 && S.screen === 'home');
    bar.tabIndex = bar.classList.contains('show') ? 0 : -1;
  }
  function go(screen) {
    S.screen = screen; S.errors = {};
    try { history.pushState({ s: screen }, '', screen === 'home' ? '/' : '#' + screen); } catch (e) {}
    render(true); main.scrollTop = 0;
  }
  function route() {
    if (DELIVERY_APP) { return 'delivery'; }
    var h = location.hash;
    if (h === '#slip') { return 'slip'; }
    if (h === '#delivery') { return 'delivery'; }
    if (h.indexOf('#pay') === 0) { return 'pay'; }
    if (h === '#orders') { return 'orders'; }
    return 'home';
  }
  function enterRoute() {
    S.screen = route();
    if (S.screen === 'delivery' && S.dpin && !S.deliv) { loadDeliveries(); }
    if (S.screen === 'orders') { S.ordNote = ''; loadMyOrders(); }
    render(true);
  }
  window.addEventListener('popstate', function () {
    if (sheetEl.classList.contains('show')) { closeSheet(); }
    if (!mapov.hidden) { closeMap(); }
    enterRoute();
  });
  window.addEventListener('hashchange', function () { if (route() !== S.screen) { enterRoute(); } });
  function bindRail() {
    var r = $('#rail'), b = $('#railbar'); if (!r) { return; }
    r.addEventListener('scroll', function () { var m = r.scrollWidth - r.clientWidth; b.style.transform = 'translateX(' + ((m > 0 ? r.scrollLeft / m : 0) * 300).toFixed(1) + '%)'; }, { passive: true });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) { return; }
    var act = a.getAttribute('data-act'), v = a.getAttribute('data-v'), i = +a.getAttribute('data-i');
    switch (act) {
      case 'group': S.groupTouched = true; S.openGroup = S.openGroup === a.getAttribute('data-g') ? '' : a.getAttribute('data-g'); var st = main.scrollTop; render(false); main.scrollTop = st; break;
      case 'item': openSheet(a.getAttribute('data-id')); break;
      case 'tocatch': e.preventDefault(); var c = $('#catch'); if (c) { c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } break;
      case 'pack': S.pick.pack = v; rerenderSheet(); break;
      case 'opt': S.pick.opt = v; rerenderSheet(); break;
      case 'cut': S.pick.cut = v; rerenderSheet(); break;
      case 'qinc': S.pick.qty++; rerenderSheet(); break;
      case 'qdec': S.pick.qty = Math.max(1, S.pick.qty - 1); rerenderSheet(); break;
      case 'add':
        var p = findP(S.pick.id), op = optOf(p, S.pick.opt) || p.options[0], key = lineKey(p, op, S.pick.pack, S.pick.cut), hit = S.cart.filter(function (l) { return l.key === key; })[0];
        if (hit) { hit.qty += S.pick.qty; } else { S.cart.push({ key: key, id: p.id, name: p.name, opt: op.key, size: op.size, pack: S.pick.pack, cut: S.pick.cut, qty: S.pick.qty, price: op.price }); }
        saveCart(); try { if (navigator.vibrate) { navigator.vibrate(8); } } catch (err) {}
        closeSheet(); render(false);
        var cnt = $('#cnt'); if (cnt) { cnt.classList.add('bump'); setTimeout(function () { cnt.classList.remove('bump'); }, 180); }
        break;
      case 'linc':
        var lp = S.products.filter(function (x) { return x.id === S.cart[i].id; })[0];
        if (lp && kgLeft(lp, S.cart[i].opt) < kgOf(S.cart[i].pack)) { S.short = 'That’s all we have of ' + S.cart[i].name + (S.cart[i].size ? ' (' + S.cart[i].size.toLowerCase() + ')' : '') + ' right now.'; keepScroll(); break; }
        S.cart[i].qty++; saveCart(); keepScroll(); break;
      case 'ldec': if (--S.cart[i].qty <= 0) { S.cart.splice(i, 1); } saveCart(); render(false); break;
      case 'lrm': S.cart.splice(i, 1); saveCart(); render(false); break;
      case 'fulfil': S.form.fulfil = v; saveForm(); render(false); break;
      case 'send': send(); break;
      case 'map': openMap(); break;
      case 'orders': e.preventDefault(); S.ordNote = ''; go('orders'); loadMyOrders(); break;
      case 'reload': S.reloading = true; S.reloadErr = false; keepScroll(); loadApi(); break;
      case 'ordreload': S.ordNote = ''; loadMyOrders(); break;
      case 'capply': S.cDraft = ($('#f-coupon') || {}).value || ''; if (S.cDraft.trim()) { applyCoupon(S.cDraft); } else { S.cErr = 'Enter a code first.'; keepScroll(); } break;
      case 'cremove': S.coupon = null; S.cErr = ''; S.cDraft = ''; keepScroll(); break;
      case 'offer': openSheet(a.getAttribute('data-id'), v); break;
      case 'billget': getBill(a.getAttribute('data-id')); break;
      case 'billopen': var bf = S.billFiles[a.getAttribute('data-id')]; if (bf) { shareOrSave(bf); } break;
      case 'dtab': S.dTab = v; S.dConfirm = ''; S.pConfirm = ''; render(true); break;
      case 'pbyok': var pb = (($('#p-by') || {}).value || '').trim(); if (pb) { S.packBy = pb; store('packBy', pb); keepScroll(); } break;
      case 'pbychange': S.packBy = ''; store('packBy', ''); keepScroll(); break;
      case 'packed': packAct('packed', a.getAttribute('data-id')); break;
      case 'unpack': packAct('unpack', a.getAttribute('data-id')); break;
      case 'reorder': reorder(a.getAttribute('data-id')); break;
      case 'mapclose': closeMap(); break;
      case 'locate': locate(); break;
      case 'mapok': confirmMap(); break;
      case 'dlogin': var pin = ($('#d-pin') || {}).value || ''; if (pin.trim()) { S.dpin = pin.trim(); store('dpin', S.dpin); S.deliv = null; loadDeliveries(); } break;
      case 'dlogout': S.dpin = ''; store('dpin', ''); S.deliv = null; S.dErr = ''; keepScroll(); break;
      case 'dreload': S.dConfirm = ''; loadDeliveries(); break;
      case 'ddone': S.dStartConfirm = false; markDelivered(a.getAttribute('data-id')); break;
      case 'dstart': startDelivery(); break;
      case 'dnext': S.dStartConfirm = false; nextStop(a.getAttribute('data-id')); break;
      case 'copyupi':
        try { navigator.clipboard.writeText(S.upi).then(function () { a.textContent = 'Copied'; }, function () {}); } catch (err) {}
        break;
      case 'home': go('home'); break;
      case 'install': if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.finally(function () { deferredPrompt = null; render(false); }); } break;
      case 'noinstall': S.installDismissed = true; store(DELIVERY_APP ? 'installDismissedD' : 'installDismissed', true); render(false); break;
    }
  });
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-f'); if (!k) { return; }
    S.form[k] = e.target.value; if (S.errors[k] && e.target.value.trim()) { S.errors[k] = false; var er = e.target.parentNode.querySelector('.err'); if (er) { er.remove(); } } saveForm();
  });
  bar.addEventListener('click', function () { go('slip'); });
  back.addEventListener('click', function () { go('home'); });
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheetEl.classList.contains('show')) { closeSheet(); }
    if (e.key === 'Escape' && !mapov.hidden) { closeMap(); }
    if (e.key === 'Enter' && e.target.id === 'f-coupon') { e.preventDefault(); var cb = $('[data-act=capply]'); if (cb) { cb.click(); } }
    if (e.key === 'Enter' && e.target.id === 'd-pin') { var b = $('[data-act=dlogin]'); if (b) { b.click(); } }
  });

  // keep My orders fresh while an order is out for delivery
  setInterval(function () {
    if (S.screen !== 'orders' || S.ordLoading || document.hidden) { return; }
    if (S.myorders.some(function (o) { return ['Confirmed', 'Packed', 'Out for delivery', 'Arriving next'].indexOf(o.status) > -1; })) { loadMyOrders(); }
  }, 60000);

  // countdown, and fresh stock when the cut-off passes or a catch is being weighed
  setInterval(function () {
    if (S.screen !== 'home' || document.hidden) { return; }
    var age = Date.now() - S.apiAt, moved = S.plan && S.plan.date !== plan().date;
    if (CONFIG.api && age > 55000 && (moved || S.pending || !S.products.length || age > 600000)) { loadApi(); }
    var w = info(), el = $('#left');
    if (w.left && el) { el.textContent = w.left; } else if (!!w.left !== !!el) { keepScroll(); }
  }, 30000);

  enterRoute();
  if (!DELIVERY_APP) { loadApi(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('/sw.js').catch(function () {}); }
})();
