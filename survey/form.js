/* Renders survey questions as tap-to-choose cards. Shared by the online survey and the paper-form entry page.
   SurveyForm(container, questions, { two: allow two ticks on a one-answer question, onChange }) */
(function () {
  function h(tag, props) {
    var e = document.createElement(tag), kids = [].slice.call(arguments, 2);
    for (var k in (props || {})) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    kids.forEach(function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      e.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  function vals(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }
  function both(mr, en) { return [h('span', { class: 'l-mr', lang: 'mr' }, mr), h('span', { class: 'l-en', lang: 'en' }, en)]; }

  function SurveyForm(container, qs, opts) {
    opts = opts || {};
    var a = {}, cards = {}, btns = {}, inputs = {}, others = {}, warns = {};
    qs.forEach(function (q) {
      var body = h('div', { class: 'q-body' });
      if (q.t === 'text') {
        var inp = h(q.ml ? 'textarea' : 'input', { type: q.ml ? null : 'text', rows: q.ml ? 2 : null, maxlength: 400, placeholder: q.ph || null, 'aria-label': q.en,
          oninput: function (e) { a[q.id] = e.target.value; changed(q); } });
        inputs[q.id] = inp; body.appendChild(inp);
      } else {
        var wrap = h('div', { class: 'opts', role: q.t === 'one' && !opts.two ? 'radiogroup' : 'group', 'aria-label': q.en });
        btns[q.id] = q.o.map(function (o) {
          var b = h('button', { type: 'button', class: 'opt' + (q.t === 'multi' ? ' multi' : ''), 'aria-pressed': 'false', 'data-v': o.v,
            onclick: function () { pick(q, o.v); } }, both(o.mr, o.v));
          wrap.appendChild(b); return { v: o.v, el: b };
        });
        body.appendChild(wrap);
        if (opts.two && q.t === 'one') { warns[q.id] = h('div', { class: 'q-warn', hidden: true }, '⚠ More than one box is ticked on the paper. Both are saved.'); body.appendChild(warns[q.id]); }
        if (q.o.some(function (o) { return o.v === 'Other'; })) {
          others[q.id] = h('input', { type: 'text', class: 'other', hidden: true, maxlength: 200, placeholder: 'इतर: लिहा / Other: please write',
            oninput: function (e) { a[q.id + '_other'] = e.target.value; changed(q); } });
          body.appendChild(others[q.id]);
        }
      }
      var hint = q.t === 'multi' ? both('(लागू असतील ते सर्व निवडा)', '(choose all that apply)') : null;
      var card = h('div', { class: 'q', 'data-q': q.id },
        h('div', { class: 'q-head' }, h('span', { class: 'q-no' }, opts.code ? 'Q' + q.id.slice(1) : ''),
          h('div', { class: 'q-text' }, h('div', { class: 'q-title' }, both(q.mr, q.en)), hint ? h('div', { class: 'q-hint' }, hint) : null)),
        body, h('div', { class: 'q-err', hidden: true }, both('कृपया या प्रश्नाचे उत्तर द्या', 'Please answer this question')));
      cards[q.id] = card; container.appendChild(card);
    });

    function pick(q, v) {
      var s = vals(a[q.id]).slice(), i = s.indexOf(v);
      if (q.t === 'one' && !opts.two) s = i > -1 ? [] : [v];
      else if (i > -1) s.splice(i, 1); else s.push(v);
      a[q.id] = q.t === 'one' ? (s.length === 0 ? undefined : s.length === 1 ? s[0] : s) : s;
      sync(); changed(q);
    }
    function changed(q) { cards[q.id].querySelector('.q-err').hidden = true; cards[q.id].classList.remove('bad'); if (opts.onChange) opts.onChange(q.id, a); }
    function sync() {
      qs.forEach(function (q) {
        if (q.t === 'text') { var t = a[q.id] || ''; if (inputs[q.id].value !== t) inputs[q.id].value = t; return; }
        var cur = vals(a[q.id]);
        btns[q.id].forEach(function (b) { b.el.setAttribute('aria-pressed', cur.indexOf(b.v) > -1 ? 'true' : 'false'); });
        if (warns[q.id]) warns[q.id].hidden = !(cur.length > 1);
        if (others[q.id]) {
          others[q.id].hidden = cur.indexOf('Other') < 0;
          var ot = a[q.id + '_other'] || ''; if (others[q.id].value !== ot) others[q.id].value = ot;
        }
      });
    }
    function answered(q) {
      var v = a[q.id];
      return q.t === 'text' ? !!(v && String(v).trim()) : vals(v).length > 0;
    }
    return {
      el: cards,
      get: function () {
        var out = {};
        qs.forEach(function (q) {
          var v = a[q.id];
          if (q.t === 'text') { v = (v || '').trim(); if (v) out[q.id] = v; return; }
          if (!vals(v).length) return;
          out[q.id] = v;
          var ot = (a[q.id + '_other'] || '').trim();
          if (vals(v).indexOf('Other') > -1 && ot) out[q.id + '_other'] = ot;
        });
        return out;
      },
      value: function (id) { return a[id]; },
      set: function (obj) { a = JSON.parse(JSON.stringify(obj || {})); sync(); qs.forEach(function (q) { cards[q.id].classList.remove('bad'); cards[q.id].querySelector('.q-err').hidden = true; }); },
      missing: function (list) {
        var miss = null;
        qs.forEach(function (q) {
          if (list.indexOf(q.id) < 0 || answered(q)) return;
          cards[q.id].classList.add('bad'); cards[q.id].querySelector('.q-err').hidden = false;
          if (!miss) miss = q.id;
        });
        return miss;
      }
    };
  }
  SurveyForm.h = h;
  SurveyForm.vals = vals;
  SurveyForm.both = both;
  window.SurveyForm = SurveyForm;
})();
