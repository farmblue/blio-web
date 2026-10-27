/* Blio web app: seafood pre-orders for Kolhapur, sent as a WhatsApp message. */
(function () {
  'use strict';

  // ---------- settings you may change ----------
  var CONFIG = {
    whatsapp: '918856888766',          // order number, country code first, no +
    deliveryFee: 40,                   // Rs, home delivery
    orderDays: [1, 3, 6],              // Monday, Wednesday, Saturday
    openHour: 8, closeHour: 18,        // 8 AM to 6 PM, India time
    // Published Google Sheet (File > Share > Publish to web > CSV). Leave empty to use products.js.
    sheetCsv: ''
  };

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var GROUPS = ['Fish', 'Prawns', 'Crabs and clams', 'Dried'];
  var GROUP_MR = { 'Fish': 'मासे', 'Prawns': 'कोळंबी', 'Crabs and clams': 'खेकडे, तिसऱ्या', 'Dried': 'सुकी मासळी' };
  var FIELD = { 'Fish': '#2456A6', 'Prawns': '#C2462A', 'Crabs and clams': '#2456A6', 'Dried': '#4E5C58' };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), sheetEl = $('#sheet'), scrim = $('#scrim'), bar = $('#slipbar'), back = $('#back');

  function store(k, v) { try { if (v === undefined) { return JSON.parse(localStorage.getItem('blio.' + k)); } localStorage.setItem('blio.' + k, JSON.stringify(v)); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function kgOf(p) { return p === '500 g' ? 0.5 : 1; }

  var S = {
    products: (window.BLIO_PRODUCTS || []).slice(),
    screen: 'home',
    openGroup: 'Fish',
    pick: null,                 // {id, pack, cut, qty}
    cart: store('cart') || [],
    form: Object.assign({ name: '', fulfil: 'delivery', address: '', area: '', notes: '' }, store('form') || {}),
    errors: {},
    last: null,
    installDismissed: !!store('installDismissed')
  };

  // ---------- order window, always in India time ----------
  function istNow() { var d = new Date(); return new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60000); }
  function windowInfo() {
    var now = istNow(), dow = now.getDay(), h = now.getHours();
    if (CONFIG.orderDays.indexOf(dow) > -1 && h >= CONFIG.openHour && h < CONFIG.closeHour) {
      var close = new Date(now); close.setHours(CONFIG.closeHour, 0, 0, 0);
      var mins = Math.max(1, Math.ceil((close - now) / 60000));
      return {
        open: true, day: DAYS[dow], delivery: DAYS[(dow + 1) % 7],
        left: (Math.floor(mins / 60) ? Math.floor(mins / 60) + 'h ' : '') + (mins % 60) + 'm',
        line: 'Orders close at 6 PM today. Everything is bought fresh against your order.',
        cta: 'Orders close at 6 PM today. Send your order on WhatsApp.'
      };
    }
    for (var i = 0; i < 8; i++) {
      var d = new Date(now); d.setDate(now.getDate() + i); d.setHours(CONFIG.openHour, 0, 0, 0);
      if (CONFIG.orderDays.indexOf(d.getDay()) > -1 && d > now) {
        var when = i === 0 ? 'today' : (i === 1 ? 'tomorrow' : DAYS[d.getDay()]);
        return {
          open: false, day: DAYS[d.getDay()], delivery: DAYS[(d.getDay() + 1) % 7], left: '',
          line: 'The next order window opens ' + when + ' at 8 AM. You can send your order now and it joins that window.',
          cta: 'Next window opens ' + when + ' at 8 AM. Send your order now to hold your place.'
        };
      }
    }
    return { open: false, day: 'Next', delivery: 'the next day', left: '', line: '', cta: '' };
  }

  // ---------- products from Google Sheet ----------
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; } } else { cell += c; } }
      else if (c === '"') { q = true; }
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') { i++; } row.push(cell); rows.push(row); row = []; cell = ''; }
      else { cell += c; }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }
  function loadSheet() {
    if (!CONFIG.sheetCsv) { return; }
    fetch(CONFIG.sheetCsv, { cache: 'no-store' }).then(function (r) { if (!r.ok) { throw new Error(r.status); } return r.text(); }).then(function (t) {
      var rows = parseCsv(t), head = rows.shift().map(function (h) { return h.trim().toLowerCase(); });
      var col = function (r, k) { var i = head.indexOf(k); return i > -1 ? (r[i] || '').trim() : ''; };
      var list = rows.map(function (r) {
        var name = col(r, 'name'); if (!name) { return null; }
        var avail = col(r, 'available').toLowerCase();
        return {
          id: (col(r, 'id') || name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          group: GROUPS.indexOf(col(r, 'group')) > -1 ? col(r, 'group') : 'Fish',
          name: name, en: col(r, 'english name'), mr: col(r, 'marathi name'),
          price: parseFloat(col(r, 'price per kg').replace(/[^0-9.]/g, '')) || 0,
          origin: col(r, 'from') || 'the Konkan coast',
          cuts: (col(r, 'cuts') || 'Whole').split('|').map(function (x) { return x.trim(); }).filter(Boolean),
          available: !(avail === 'no' || avail === 'n' || avail === 'sold out' || avail === 'false')
        };
      }).filter(function (p) { return p && p.price > 0; });
      if (list.length) { S.products = list; render(false); }
    }).catch(function () { /* keep built-in list */ });
  }

  // ---------- cart ----------
  function totals() {
    var sub = S.cart.reduce(function (a, l) { return a + l.price * kgOf(l.pack) * l.qty; }, 0);
    var fee = S.form.fulfil === 'delivery' && sub > 0 ? CONFIG.deliveryFee : 0;
    var count = S.cart.reduce(function (a, l) { return a + l.qty; }, 0);
    return { sub: sub, fee: fee, total: sub + fee, count: count };
  }
  function saveCart() { store('cart', S.cart); }
  function saveForm() { store('form', { name: S.form.name, fulfil: S.form.fulfil, address: S.form.address, area: S.form.area }); }

  // ---------- drawings ----------
  var ART = {
    'Fish': '<svg width="250" height="130" viewBox="0 0 220 120" aria-hidden="true"><path d="M14 60C56 14 140 14 176 60C140 106 56 106 14 60Z" fill="#ECE6D6"/><path d="M172 60l38-30v60z" fill="#ECE6D6"/><circle cx="46" cy="54" r="6" fill="#12272C"/><path d="M66 38c10 14 10 30 0 44" fill="none" stroke="#C2462A" stroke-width="5"/></svg>',
    'Prawns': '<svg width="220" height="140" viewBox="0 0 220 140" aria-hidden="true"><path d="M40 40C90 0 190 20 180 90C176 116 150 128 126 118L138 96C152 98 160 90 158 78C154 44 100 36 60 62z" fill="#ECE6D6"/><path d="M126 118l-30 16 8-30z" fill="#12404A"/><circle cx="58" cy="50" r="5" fill="#12272C"/><path d="M40 40C20 30 6 18 2 4M44 46C24 46 10 40 0 30" fill="none" stroke="#ECE6D6" stroke-width="3"/></svg>',
    'Crabs and clams': '<svg width="240" height="140" viewBox="0 0 240 140" aria-hidden="true"><ellipse cx="120" cy="82" rx="62" ry="40" fill="#ECE6D6"/><path d="M58 70C34 56 30 30 44 16l14 22-14 6z" fill="#C2462A"/><path d="M182 70c24-14 28-40 14-54l-14 22 14 6z" fill="#C2462A"/><circle cx="104" cy="58" r="5" fill="#12272C"/><circle cx="136" cy="58" r="5" fill="#12272C"/><path d="M66 100l-30 22M70 112l-24 24M174 100l30 22M170 112l24 24" fill="none" stroke="#ECE6D6" stroke-width="6"/></svg>',
    'Dried': '<svg width="240" height="130" viewBox="0 0 240 130" aria-hidden="true"><path d="M20 36C60 20 150 20 190 36l34-14v40l-34-12C150 64 60 64 20 50z" fill="#ECE6D6"/><path d="M20 86C60 70 150 70 190 86l34-14v40l-34-12C150 114 60 114 20 100z" fill="#ECE6D6"/><rect x="96" y="0" width="10" height="130" fill="#C2462A"/></svg>'
  };
  var PLUS = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#ECE6D6" stroke-width="2" aria-hidden="true"><path d="M9 2v14M2 9h14"/></svg>';

  // ---------- screens ----------
  function homeHtml(anim) {
    var w = windowInfo();
    var groups = GROUPS.map(function (g) {
      var items = S.products.filter(function (p) { return p.group === g; });
      if (!items.length) { return ''; }
      var open = S.openGroup === g;
      var rows = open ? '<div class="items">' + items.map(function (p, i) {
        return '<button class="row item enter' + (p.available ? '' : ' out') + '" data-act="item" data-id="' + esc(p.id) + '" style="animation-delay:' + (i * 40) + 'ms"' + (p.available ? '' : ' aria-disabled="true"') + '>' +
          '<span class="t"><b>' + esc(p.name) + '</b><span>' + esc(p.en) + (p.mr ? ' · <span class="mr">' + esc(p.mr) + '</span>' : '') + '</span></span>' +
          '<span class="p num">' + (p.available ? rs(p.price) + '/kg' : 'Sold out') + '</span></button>';
      }).join('') + '</div>' : '';
      return '<div class="group"><button class="row g-head" data-act="group" data-g="' + esc(g) + '" aria-expanded="' + open + '">' +
        '<span class="lbl">' + esc(g) + '</span><span class="mr">' + GROUP_MR[g] + '</span><span class="n num">' + items.length + '</span>' + PLUS + '</button>' + rows + '</div>';
    }).join('');

    return '<div class="wrap home' + (anim ? ' enter' : '') + '">' +
      '<div class="ticket"><div class="in">' +
        '<h1 class="anton">' + esc(w.day) + '’s<br>catch</h1>' +
        '<p>' + esc(w.line) + '</p>' +
        (w.open ? '<div class="count"><b class="num" id="left">' + w.left + '</b><span>left to order</span></div>' : '') +
        '<a class="btn press" href="#catch" data-act="tocatch">Choose from the catch</a>' +
      '</div><div class="perf"></div>' +
      '<span class="notch" style="left:-13px;bottom:82px"></span><span class="notch" style="right:-13px;bottom:82px"></span>' +
      '<div class="facts"><span><small>Delivered</small><strong>' + esc(w.delivery) + ', 5 to 9 PM</strong></span>' +
      '<span><small>Bought from</small><strong>Goa and Konkan boats</strong></span></div></div>' +
      installHtml() +
      '<section class="catch" id="catch"><h2 class="anton">Catch</h2>' +
      '<p class="lead">Priced per kg. Every fish is cleaned and cut in Kolhapur the morning it arrives.</p>' +
      '<div class="groups">' + groups + '</div></section>' +
      '<section class="how"><h2 class="anton">Boat to door</h2><div class="rail-bar"><span id="railbar"></span></div>' +
      '<div class="rail" id="rail">' +
        step('You order by 6 PM', 'Pick the fish, the pack size and the cut, then send the order on WhatsApp.', 32, '#2456A6', '<svg width="170" height="170" viewBox="0 0 170 170" aria-hidden="true"><circle cx="85" cy="85" r="72" fill="#ECE6D6"/><circle cx="85" cy="85" r="6" fill="#12272C"/><rect x="82" y="34" width="6" height="54" fill="#12272C"/><rect x="82" y="82" width="40" height="6" fill="#C2462A"/></svg>') +
        step('We buy from the boats', 'Only what was ordered, straight from fishermen in North Goa and on the Konkan coast.', 64, '#C2462A', '<svg width="200" height="150" viewBox="0 0 200 150" aria-hidden="true"><rect x="0" y="112" width="200" height="38" fill="#2456A6"/><path d="M14 84h172l-22 34H36z" fill="#ECE6D6"/><rect x="92" y="40" width="44" height="44" fill="#12272C"/><rect x="100" y="48" width="12" height="12" fill="#ECE6D6"/><rect x="62" y="22" width="5" height="62" fill="#12272C"/></svg>') +
        step('Cleaned to your cut', 'Whole, curry cut, steaks or fillet, done by hand in Kolhapur.', 40, '#ECE6D6', '<svg width="220" height="120" viewBox="0 0 220 120" aria-hidden="true"><path d="M14 60C56 14 140 14 176 60C140 106 56 106 14 60Z" fill="#2456A6"/><path d="M172 60l38-30v60z" fill="#2456A6"/><circle cx="46" cy="54" r="6" fill="#ECE6D6"/><rect x="84" y="20" width="6" height="80" fill="#ECE6D6"/><rect x="112" y="22" width="6" height="76" fill="#ECE6D6"/><rect x="140" y="30" width="6" height="60" fill="#ECE6D6"/></svg>') +
        step('At your door by 9 PM', 'Next evening, packed on ice. Or pick it up yourself.', 52, '#195360', '<svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true"><path d="M20 84L90 26l70 58v80H20z" fill="#ECE6D6"/><rect x="72" y="108" width="36" height="56" fill="#C2462A"/><rect x="38" y="98" width="24" height="24" fill="#2456A6"/><rect x="118" y="98" width="24" height="24" fill="#2456A6"/></svg>') +
      '</div></section>' +
      '<a class="cta press" href="#catch" data-act="tocatch"><span class="l">' + esc(w.cta) + '</span>' +
        '<svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M9 27L27 9M12 9h15v15"/></svg>' +
        '<span class="big anton">Order</span></a>' +
      '<footer class="foot"><img src="/icons/wordmark.svg" alt="Blio" width="180" height="90">' +
        '<p>Questions or a special order? WhatsApp <a href="https://wa.me/' + CONFIG.whatsapp + '">+91 88568 88766</a>.</p>' +
        '<p>Blio is a brand of Farmblue Agrotech Private Limited, House No 1328, A/p Harkul, Khalachi Teliwadi, Kankavli, Sindhudurg 416602, Maharashtra. <a href="https://farmblue.in">farmblue.in</a></p>' +
        '<small>Prices are per kg and change with the catch. The final bill is confirmed on WhatsApp before you pay.</small>' +
      '</footer></div>';
  }
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
    if (deferredPrompt) {
      return '<div class="install"><img src="/icons/icon-192.png" alt=""><p><b>Add Blio to your phone</b><br>Opens like an app, no download from a store.</p><button class="go press" data-act="install">Add</button><button class="x" data-act="noinstall" aria-label="Dismiss">×</button></div>';
    }
    if (isIos) {
      return '<div class="install"><img src="/icons/icon-192.png" alt=""><p><b>Add Blio to your home screen</b><br>Tap Share, then Add to Home Screen.</p><button class="x" data-act="noinstall" aria-label="Dismiss">×</button></div>';
    }
    return '';
  }

  function slipHtml(anim) {
    var w = windowInfo(), t = totals(), f = S.form, e = S.errors;
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
      return '<div class="line"><div class="a"><span class="t"><b>' + esc(l.name) + '</b><small>' + esc(l.pack) + ' · ' + esc(l.cut) + '</small></span>' +
        '<span class="tot num">' + rs(l.price * kgOf(l.pack) * l.qty) + '</span></div>' +
        '<div class="b"><div class="qty"><button class="press" data-act="ldec" data-i="' + idx + '" aria-label="One less">−</button><span class="num">' + l.qty + '</span>' +
        '<button class="press" data-act="linc" data-i="' + idx + '" aria-label="One more">+</button></div>' +
        '<button class="rm" data-act="lrm" data-i="' + idx + '">Remove</button></div></div>';
    }).join('');
    var del = f.fulfil === 'delivery';
    return '<div class="stack' + (anim ? ' enter' : '') + '">' +
      '<div class="slip" style="clip-path:polygon(' + pts.join(',') + ')">' +
        '<div class="hd"><h1 class="anton">Your slip</h1><span>For ' + esc(w.day) + '’s window · delivered ' + esc(w.delivery) + ', 5 to 9 PM</span></div>' +
        '<div class="lines">' + lines + '</div><div class="perf" style="margin:4px 22px 0"></div>' +
        '<div class="sums"><div><span>Subtotal</span><span class="num">' + rs(t.sub) + '</span></div>' +
        '<div class="m"><span>Delivery</span><span class="num">' + (t.fee ? rs(t.fee) : 'Free') + '</span></div>' +
        '<div class="t"><span>Estimated total</span><b class="num">' + rs(t.total) + '</b></div>' +
        '<span class="note">Fish is weighed after cleaning, so we confirm the final bill on WhatsApp before you pay.</span></div>' +
      '</div>' +
      '<div class="fld"><label for="f-name">Your name</label><input id="f-name" data-f="name" autocomplete="name" value="' + esc(f.name) + '" placeholder="Name for the order">' +
        (e.name ? '<span class="err">Please add your name.</span>' : '') + '</div>' +
      '<div class="fld"><span class="lab" style="font-size:16px">How you get it</span>' +
        '<div class="seg dark" data-on="' + (del ? 0 : 1) + '"><span class="ind"></span>' +
        '<button data-act="fulfil" data-v="delivery" aria-pressed="' + del + '">Home delivery</button>' +
        '<button data-act="fulfil" data-v="pickup" aria-pressed="' + !del + '">Self pickup</button></div></div>' +
      (del ?
        '<div class="fld"><label for="f-addr">Delivery address</label><textarea id="f-addr" data-f="address" autocomplete="street-address" placeholder="House, street, landmark">' + esc(f.address) + '</textarea>' +
          (e.address ? '<span class="err">Please add the address.</span>' : '') + '</div>' +
        '<div class="fld"><label for="f-area">Area in Kolhapur</label><input id="f-area" data-f="area" placeholder="For example Rajarampuri, Tarabai Park" value="' + esc(f.area) + '"></div>'
        : '<div class="box">Collect from the Blio cleaning point in Kolhapur, ' + esc(w.delivery) + ', 5 to 9 PM. We share the exact location on WhatsApp.</div>') +
      '<div class="fld"><label for="f-notes">Notes (optional)</label><input id="f-notes" data-f="notes" placeholder="Cleaning preferences, timing" value="' + esc(f.notes) + '"></div>' +
      '<button class="btn big press" data-act="send">Send order on WhatsApp</button>' +
      '<span class="muted-g">WhatsApp opens with your order typed in. Tap send there. You pay by UPI after we confirm the bill.</span>' +
      '</div>';
  }

  function doneHtml(anim) {
    var o = S.last || {};
    return '<div class="stack' + (anim ? ' enter' : '') + '"><div class="ticket">' +
      '<div class="in"><h1 class="anton" style="font-size:96px;line-height:.84">Sent</h1>' +
      '<p>Order ' + esc(o.id) + ' for ' + rs(o.total || 0) + ' is ready in WhatsApp. If you haven’t tapped send there yet, do it now. We reply with the final bill and a UPI request.</p></div>' +
      '<div class="perf"></div><div style="padding:18px 22px 24px;display:flex;flex-direction:column;gap:12px">' +
      '<span class="note">Delivered ' + esc(o.delivery) + ', 5 to 9 PM</span>' +
      '<div class="progress"><span class="on"></span><span></span><span></span><span></span></div>' +
      '<div class="plabels"><b>Sent</b><span>Confirmed</span><span>Cleaned</span><span>Delivered</span></div></div></div>' +
      '<a class="btn big press" href="' + esc(o.url) + '" target="_blank" rel="noopener">Open WhatsApp again</a>' +
      '<button class="btn dark press" data-act="home">Back to the catch</button></div>';
  }

  // ---------- sheet ----------
  function sheetHtml() {
    var p = findP(S.pick.id), k = S.pick;
    return '<div class="grab" id="grab"><span class="h"></span><div class="field" style="background:' + FIELD[p.group] + '">' + ART[p.group] + '</div></div>' +
      '<div class="body"><div style="display:flex;flex-direction:column;gap:4px">' +
        '<h3 class="anton" id="sheet-title">' + esc(p.name) + '</h3>' +
        '<span class="sub">' + esc(p.en) + (p.mr ? ' · <span class="mr">' + esc(p.mr) + '</span>' : '') + ' · from ' + esc(p.origin) + '</span>' +
        '<span class="pr num">' + rs(p.price) + ' per kg</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Pack</span>' +
        '<div class="seg" data-on="' + (k.pack === '1 kg' ? 1 : 0) + '"><span class="ind"></span>' +
        '<button data-act="pack" data-v="500 g" aria-pressed="' + (k.pack === '500 g') + '">500 g</button>' +
        '<button data-act="pack" data-v="1 kg" aria-pressed="' + (k.pack === '1 kg') + '">1 kg</button></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><span class="lab">Cut</span><div class="chips">' +
        p.cuts.map(function (c) { return '<button class="chip press" data-act="cut" data-v="' + esc(c) + '" aria-pressed="' + (c === k.cut) + '">' + esc(c) + '</button>'; }).join('') +
      '</div></div>' +
      '<div class="addrow"><div class="qty"><button class="press" data-act="qdec" aria-label="One less">−</button><span class="num">' + k.qty + '</span>' +
        '<button class="press" data-act="qinc" aria-label="One more">+</button></div>' +
        '<button class="btn press num" data-act="add">Add to slip · ' + rs(p.price * kgOf(k.pack) * k.qty) + '</button></div></div>';
  }
  function findP(id) { return S.products.filter(function (p) { return p.id === id; })[0] || S.products[0]; }
  function openSheet(id) {
    var p = findP(id); if (!p || !p.available) { return; }
    S.pick = { id: p.id, pack: '1 kg', cut: p.cuts[0], qty: 1 };
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
  function send() {
    var f = S.form, e = {};
    if (!f.name.trim()) { e.name = true; }
    if (f.fulfil === 'delivery' && !f.address.trim()) { e.address = true; }
    S.errors = e;
    if (e.name || e.address) { render(false); var el = $(e.name ? '#f-name' : '#f-addr'); if (el) { el.focus(); } return; }
    var w = windowInfo(), t = totals(), id = orderId();
    var msg = ['New Blio order ' + id, 'For ' + w.day + '’s window, delivery ' + w.delivery + ' 5 to 9 PM', ''];
    S.cart.forEach(function (l, i) { msg.push((i + 1) + '. ' + l.name + ', ' + l.pack + ', ' + l.cut + ' x' + l.qty + ' = ' + rs(l.price * kgOf(l.pack) * l.qty)); });
    msg.push('', 'Subtotal: ' + rs(t.sub), 'Delivery: ' + (t.fee ? rs(t.fee) : 'Free (pickup)'), 'Estimated total: ' + rs(t.total), '');
    msg.push('Name: ' + f.name.trim());
    if (f.fulfil === 'delivery') { msg.push('Home delivery: ' + f.address.trim().replace(/\s*\n\s*/g, ', ') + (f.area.trim() ? ', ' + f.area.trim() : '')); }
    else { msg.push('Self pickup'); }
    if (f.notes.trim()) { msg.push('Notes: ' + f.notes.trim()); }
    msg.push('Payment: UPI after confirmation');
    var url = 'https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(msg.join('\n'));
    S.last = { id: id, total: t.total, delivery: w.delivery, url: url, text: msg.join('\n') };
    S.cart = []; saveCart(); S.form.notes = ''; saveForm();
    window.open(url, '_blank', 'noopener');
    go('done');
  }

  // ---------- render ----------
  function render(anim) {
    if (S.screen === 'home') { main.innerHTML = homeHtml(anim); bindRail(); }
    else if (S.screen === 'slip') { main.innerHTML = slipHtml(anim); }
    else { main.innerHTML = doneHtml(anim); }
    back.hidden = S.screen === 'home';
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
  window.addEventListener('popstate', function () {
    if (sheetEl.classList.contains('show')) { closeSheet(); }
    S.screen = location.hash === '#slip' ? 'slip' : 'home'; render(true);
  });
  function bindRail() {
    var r = $('#rail'), b = $('#railbar'); if (!r) { return; }
    r.addEventListener('scroll', function () { var m = r.scrollWidth - r.clientWidth; b.style.transform = 'translateX(' + ((m > 0 ? r.scrollLeft / m : 0) * 300).toFixed(1) + '%)'; }, { passive: true });
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) { return; }
    var act = a.getAttribute('data-act'), v = a.getAttribute('data-v'), i = +a.getAttribute('data-i');
    switch (act) {
      case 'group': S.openGroup = S.openGroup === a.getAttribute('data-g') ? '' : a.getAttribute('data-g'); var st = main.scrollTop; render(false); main.scrollTop = st; break;
      case 'item': openSheet(a.getAttribute('data-id')); break;
      case 'tocatch': e.preventDefault(); var c = $('#catch'); if (c) { c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } break;
      case 'pack': S.pick.pack = v; rerenderSheet(); break;
      case 'cut': S.pick.cut = v; rerenderSheet(); break;
      case 'qinc': S.pick.qty++; rerenderSheet(); break;
      case 'qdec': S.pick.qty = Math.max(1, S.pick.qty - 1); rerenderSheet(); break;
      case 'add':
        var p = findP(S.pick.id), key = p.id + '|' + S.pick.pack + '|' + S.pick.cut, hit = S.cart.filter(function (l) { return l.key === key; })[0];
        if (hit) { hit.qty += S.pick.qty; } else { S.cart.push({ key: key, id: p.id, name: p.name, pack: S.pick.pack, cut: S.pick.cut, qty: S.pick.qty, price: p.price }); }
        saveCart(); try { if (navigator.vibrate) { navigator.vibrate(8); } } catch (err) {}
        closeSheet(); render(false);
        var cnt = $('#cnt'); if (cnt) { cnt.classList.add('bump'); setTimeout(function () { cnt.classList.remove('bump'); }, 180); }
        break;
      case 'linc': S.cart[i].qty++; saveCart(); render(false); break;
      case 'ldec': if (--S.cart[i].qty <= 0) { S.cart.splice(i, 1); } saveCart(); render(false); break;
      case 'lrm': S.cart.splice(i, 1); saveCart(); render(false); break;
      case 'fulfil': S.form.fulfil = v; saveForm(); render(false); break;
      case 'send': send(); break;
      case 'home': go('home'); break;
      case 'install': if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.finally(function () { deferredPrompt = null; render(false); }); } break;
      case 'noinstall': S.installDismissed = true; store('installDismissed', true); render(false); break;
    }
  });
  document.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-f'); if (!k) { return; }
    S.form[k] = e.target.value; if (S.errors[k] && e.target.value.trim()) { S.errors[k] = false; var er = e.target.parentNode.querySelector('.err'); if (er) { er.remove(); } } saveForm();
  });
  bar.addEventListener('click', function () { go('slip'); });
  back.addEventListener('click', function () { go('home'); });
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetEl.classList.contains('show')) { closeSheet(); } });

  // countdown
  setInterval(function () {
    if (S.screen !== 'home') { return; }
    var w = windowInfo(), el = $('#left');
    if (w.open && el) { el.textContent = w.left; } else if (!!w.open !== !!el) { var st = main.scrollTop; render(false); main.scrollTop = st; }
  }, 30000);

  if (location.hash === '#slip') { S.screen = 'slip'; }
  render(true);
  loadSheet();
  if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('/sw.js').catch(function () {}); }
})();
