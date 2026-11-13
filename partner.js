/* Blio Partner: a partner's own screen. Sign in with your mobile and your own PIN, see your work and pay, and take open shifts. */
(function () {
  'use strict';
  var API = 'https://script.google.com/macros/s/AKfycbyYRFQbohQm2STP3hSZB6G3iq2kdop0Vw2XV3BN-cOfQev1-QHH16nxOgc57oWv1r8Y/exec';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var main = $('#main'), tabs = $('#tabs');
  function store(k, v) { try { if (v === undefined) { return JSON.parse(localStorage.getItem('blio.partner.' + k)); } if (v === null) { localStorage.removeItem('blio.partner.' + k); } else { localStorage.setItem('blio.partner.' + k, JSON.stringify(v)); } } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rs(n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  function kg(n) { return (Math.round(Number(n) * 10) / 10).toString().replace(/\.0$/, '') + ' kg'; }
  function dlab(ds) {
    var p = String(ds || '').split('-'); if (p.length !== 3) { return ds || ''; }
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + (+p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
  }
  function monthName(m) { var p = String(m || '').split('-'); return p.length === 2 ? ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+p[1] - 1] : ''; }

  var S = { auth: store('auth') || null, tab: 'work', d: null, err: '', note: '', busy: '', loading: false };

  function call(body) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: 'partner', mobile: S.auth.mobile, pin: S.auth.pin }, body)) }).then(function (r) { return r.json(); });
  }
  function signOut(msg) { S.auth = null; S.d = null; store('auth', null); S.err = msg || ''; render(); }
  function failed(d) {
    var m = { wrong: 'That mobile or PIN didn’t work. Ask Blio for your PIN.', locked: 'Too many wrong tries. Wait 10 minutes and try again.', paused: 'Your partner account is paused. Please contact Blio.' }[d.error];
    if (m) { signOut(m); return true; } return false;
  }
  function load(quiet) {
    if (!S.auth) { return; }
    S.loading = !quiet; if (!quiet) { render(); }
    call({ op: 'me' }).then(function (d) {
      S.loading = false;
      if (!d.ok) { if (!failed(d)) { S.err = 'Couldn’t load. Try again.'; render(); } return; }
      S.d = d; S.err = ''; render();
    }).catch(function () { S.loading = false; S.err = 'No connection. Check your internet and try again.'; render(); });
  }
  function act(key, body, onOk, failMsg) {
    S.busy = key; S.err = ''; S.note = ''; render();
    call(body).then(function (d) {
      S.busy = '';
      if (d.ok) { S.d = d; onOk(d); }
      else if (!failed(d)) { S.err = ({ filled: 'That shift is already full.', rest: 'This shift is for partners who haven’t worked the last two days.', gone: 'That request is no longer open.', late: 'It is too late to leave this shift. Please message Blio.', upi: 'That doesn’t look like a UPI ID, for example name@okaxis.' })[d.error] || failMsg; call({ op: 'me' }).then(function (x) { if (x.ok) { S.d = x; } render(); }).catch(function () {}); }
      render();
    }).catch(function () { S.busy = ''; S.err = 'No connection. ' + failMsg; render(); });
  }

  function loginHtml() {
    return '<div class="stack enter"><div class="dhead"><h1 class="anton">Partner</h1></div>' +
      '<p class="muted-g" style="text-align:left;font-size:16px">Sign in to see your work, open shifts and what you are owed.</p>' +
      '<div class="fld"><label for="p-mob">Mobile number</label><input id="p-mob" type="tel" inputmode="numeric" autocomplete="tel" value="' + esc((S.auth && S.auth.mobile) || store('mobile') || '') + '" placeholder="10 digits"></div>' +
      '<div class="fld"><label for="p-pin">Your PIN</label><input id="p-pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="The PIN Blio gave you"></div>' +
      (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      '<button class="btn big press" data-act="login">Open my work</button>' +
      '<span class="muted-g">Not a partner yet? <a href="/careers" style="color:var(--paper)">See open roles</a>. Delivery orders are in the <a href="/delivery/" style="color:var(--paper)">Blio Delivery app</a>.</span></div>';
  }
  function shiftRow(e) {
    var what = e.fishKg || e.prawnKg ? kg(e.fishKg) + ' fish' + (e.prawnKg ? ' + ' + kg(e.prawnKg) + ' prawns and crab' : '') : e.drops + ' deliveries' + (e.km ? ', ' + (Math.round(e.km * 10) / 10) + ' km' : '');
    return '<div class="astock"><div class="ah1"><b>' + esc(dlab(e.date)) + '</b><span><b class="num">' + rs(e.pay) + '</b> <span class="ptag' + (e.status === 'Paid' ? ' paid' : '') + '">' + esc(e.status) + '</span></span></div>' +
      '<p class="ah2">' + esc(what) + (e.status === 'Paid' && e.paidAt ? ' · paid ' + esc(e.paidAt.split(',')[0]) : '') + '</p></div>';
  }
  function reqCard(r, mine) {
    var left = r.needed - r.filled;
    return '<div class="astock"><div class="ah1"><b>' + esc(r.day + ' ' + dlab(r.date).split(' ').slice(1).join(' ')) + ' · ' + esc(r.time) + '</b><span class="ptag' + (mine ? ' paid' : '') + '">' + (mine ? 'You’re in' : left + (left === 1 ? ' place' : ' places')) + '</span></div>' +
      '<p class="ah2">' + (r.role === 'Cleaning' ? 'Fish cleaning and packing helper' : 'Evening delivery partner') + ' · ' + r.filled + ' of ' + r.needed + ' filled</p>' +
      (mine ? '<div class="arow"><button class="btn small dark press" data-act="leave" data-id="' + esc(r.id) + '"' + (S.busy === 'l' + r.id ? ' disabled' : '') + '>I can’t make it</button></div>'
            : '<button class="btn big press" data-act="take" data-id="' + esc(r.id) + '"' + (S.busy === 't' + r.id ? ' disabled' : '') + '>' + (S.busy === 't' + r.id ? 'Booking…' : 'I’ll take it') + '</button>') + '</div>';
  }
  function workHtml() {
    var d = S.d, m = d.me, cl = m.role === 'Cleaning';
    return '<div class="stack"><div class="dhead"><h1 class="anton">My work</h1></div>' +
      '<p class="muted-g" style="text-align:left;font-size:16px;margin-top:-8px">Namaskar, ' + esc(m.name.split(' ')[0]) + ' · ' + (cl ? 'Cleaning partner' : 'Delivery partner') + ' · ' + esc(monthName(d.month.label)) + '</p>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') + (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      '<div class="agrid" style="gap:8px"><div class="box"><span class="ah2" style="color:var(--muted-g)">' + (cl ? 'Sessions' : 'Evenings worked') + '</span><br><b class="num" style="font-size:26px">' + d.month.shifts + '</b></div>' +
      '<div class="box"><span class="ah2" style="color:var(--muted-g)">' + (cl ? 'Kg cleaned' : 'Deliveries') + '</span><br><b class="num" style="font-size:26px">' + (cl ? kg(d.month.fishKg) : d.month.drops) + '</b></div>' +
      '<div class="box"><span class="ah2" style="color:var(--muted-g)">Rating' + (d.rating.n ? ' (' + d.rating.n + (d.rating.n === 1 ? ' rating)' : ' ratings)') : '') + '</span><br><b style="font-size:26px">' + (d.rating.n ? '★ ' + d.rating.avg.toFixed(1) : 'New') + '</b></div>' +
      '<div class="box" style="background:var(--paper);color:var(--ink)"><span class="ah2">Due to you</span><br><b class="num" style="font-size:26px">' + rs(d.due) + '</b></div></div>' +
      (d.taken.length ? '<h2 class="osec">Your coming shifts</h2>' + d.taken.map(function (r) { return reqCard(r, true); }).join('') : '') +
      '<h2 class="osec">Open requests</h2>' + (d.open.length ? d.open.map(function (r) { return reqCard(r, false); }).join('') : '<div class="box">No open shifts right now. We will post new ones in the partner group.</div>') +
      '<h2 class="osec">Recent ' + (cl ? 'sessions' : 'evenings') + '</h2>' + (d.recent.length ? d.recent.map(shiftRow).join('') : '<div class="box">Nothing recorded yet. Your first ' + (cl ? 'session' : 'evening') + ' will show here with the pay.</div>') +
      '<span class="muted-g">Pay is recorded by Blio after each ' + (cl ? 'session' : 'evening') + '. Questions? <a href="https://wa.me/918856888766" style="color:var(--paper)">WhatsApp us</a>.</span></div>';
  }
  function requestsHtml() {
    var d = S.d;
    return '<div class="stack"><div class="dhead"><h1 class="anton">Requests</h1></div>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') + (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      (d.taken.length ? '<h2 class="osec">Yours</h2>' + d.taken.map(function (r) { return reqCard(r, true); }).join('') : '') +
      '<h2 class="osec">Open</h2>' + (d.open.length ? d.open.map(function (r) { return reqCard(r, false); }).join('') : '<div class="box">No open shifts right now.</div>') +
      '<span class="dsub">First to tap gets the place. To keep shifts fair, someone who has worked the last two shift days may not be offered the next one.</span></div>';
  }
  function profileHtml() {
    var d = S.d, m = d.me, rt = d.rates || {}, cl = m.role === 'Cleaning';
    return '<div class="stack"><div class="dhead"><h1 class="anton">Profile</h1></div>' +
      (S.note ? '<div class="box ok" role="status">' + esc(S.note) + '</div>' : '') + (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div>' : '') +
      '<div class="box"><b>' + esc(m.name) + '</b><br>' + esc(m.mobile) + (m.area ? ' · ' + esc(m.area) : '') + '<br><span class="ah2" style="color:var(--muted-g)">Documents checked: ' + (m.verified ? 'yes' : 'not yet') + ' · Terms agreed: ' + (m.consent ? 'yes' : 'not yet') + '</span></div>' +
      '<div class="fld"><label for="p-upi">Your UPI ID for pay</label><input id="p-upi" value="' + esc(m.upi) + '" autocapitalize="off" placeholder="name@okaxis"></div>' +
      '<button class="btn press" data-act="upi"' + (S.busy === 'upi' ? ' disabled' : '') + '>' + (S.busy === 'upi' ? 'Saving…' : 'Save UPI ID') + '</button>' +
      '<h2 class="osec">Pay rates</h2><div class="box">' + (cl ? rs(rt.session) + ' per session, plus ' + rs(rt.fish) + ' per kg of fish and ' + rs(rt.prawn) + ' per kg of prawns and crab.' :
        rs(rt.evening) + ' per evening, plus ' + rs(rt.drop) + ' per delivery, plus fuel for the full route at ₹' + rt.fuel + ' per km.') + '<br><span class="ah2" style="color:var(--muted-g)">Rates are tentative and may change. We tell you before they do.</span></div>' +
      '<p class="muted-g" style="text-align:left"><a href="/partner-terms" style="color:var(--paper)">Partner terms</a> · <a href="/partner-privacy" style="color:var(--paper)">Partner privacy notice</a></p>' +
      '<button class="btn dark press" data-act="out">Sign out on this phone</button></div>';
  }
  function render() {
    if (!S.auth) { tabs.hidden = true; main.innerHTML = loginHtml(); return; }
    tabs.hidden = false;
    tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-current', b.getAttribute('data-v') === S.tab ? 'page' : 'false'); });
    if (!S.d) {
      main.innerHTML = '<div class="stack"><div class="dhead"><h1 class="anton">Partner</h1></div>' + (S.err ? '<div class="box warn" role="alert">' + esc(S.err) + '</div><button class="btn press" data-act="refresh">Try again</button>' : '<div class="box">Loading your work…</div>') + '</div>';
      return;
    }
    var keep = main.scrollTop;
    main.innerHTML = ({ work: workHtml, requests: requestsHtml, profile: profileHtml }[S.tab] || workHtml)();
    main.scrollTop = keep;
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]'); if (!a) { return; }
    var what = a.getAttribute('data-act'), id = a.getAttribute('data-id'), v = a.getAttribute('data-v');
    switch (what) {
      case 'login':
        var mob = ($('#p-mob').value || '').replace(/[^0-9]/g, '').slice(-10), pin = ($('#p-pin').value || '').trim();
        if (mob.length !== 10 || !pin) { S.err = 'Enter your 10-digit mobile and your PIN.'; render(); return; }
        S.auth = { mobile: mob, pin: pin }; store('auth', S.auth); store('mobile', mob); S.err = ''; load(); break;
      case 'out': signOut(''); break;
      case 'tab': S.tab = v; S.note = ''; S.err = ''; render(); main.scrollTop = 0; break;
      case 'refresh': load(); break;
      case 'take': act('t' + id, { op: 'take', id: id }, function () { S.note = 'Booked. It shows under Your coming shifts.'; }, 'Couldn’t book it. Try again.'); break;
      case 'leave': act('l' + id, { op: 'leave', id: id }, function () { S.note = 'Done. We have opened that place for someone else.'; }, 'Couldn’t update it. Try again.'); break;
      case 'upi': act('upi', { op: 'upi', upi: ($('#p-upi').value || '').trim() }, function () { S.note = 'UPI ID saved.'; }, 'Couldn’t save it. Try again.'); break;
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.target.id === 'p-pin' || e.target.id === 'p-mob')) { var b = $('[data-act=login]'); if (b) { b.click(); } } });
  setInterval(function () { if (S.auth && S.d && !document.hidden && !S.busy && S.tab !== 'profile') { load(true); } }, 90000);
  render(); if (S.auth) { load(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') { navigator.serviceWorker.register('/sw.js').catch(function () {}); }
})();
