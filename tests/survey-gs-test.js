/* Script-level tests for gas/survey.gs. node tests/survey-gs-test.js */
const { makeBackend } = require('./survey-server');
const assert = require('assert');
const HEAD = ["form_no","date","team","surveyor","q1","q2","q3","q4","q4_other","q5","q6","q6_other","q7","q7_other","q8","q9","q10","q11","q12","q12_other","q13","q13_other","q14","q15","q16","q17","q18","q19","q19_other","q20","q20_other","q21","q22","q22_other","q23","q23_other","q24","q25","q26","q27","q28","q29","q30","q31","q31_other","q32","q32_other","q33","q34","q35","q36","q37","q38","q39","q40","q41","q41_other","q42","q43","q44","q45","q46","q46_other","q47","q47_other","needs_check","notes"];
const form1 = HEAD.map(c => c === 'form_no' ? 1 : c === 'q1' ? 'Vishwakarma' : c === 'q3' ? 'Yes' : '');

// 1) a sheet that still has the old "Responses" tab: offline keeps using it, online goes to a new "Online" tab
let b = makeBackend({ rows: [HEAD, form1], maxCols: 68 });
const colOf = (t, n) => b.tab(t).d[0].indexOf(n);
assert.strictEqual(b.post({ action: 'list', pin: 'x' }).error, 'pin');
let l = b.post({ action: 'list', pin: '4321' });
assert.ok(l.ok); assert.deepStrictEqual(l.rows.map(r => r.no), [1]); assert.strictEqual(l.rows[0].a.q1, 'Vishwakarma');

let s = b.post({ action: 'submit', a: { q1: '=HYPERLINK("x")', q3: 'Yes', q12: ['Pomfret', 'Crab'], q8: 'not asked online', q43: 'no names' }, mobile: '+91 98765 43210', consent: true, src: 'share', seconds: 200, lang: 'mr' });
assert.ok(s.ok && /^BL[A-Z2-9]{6}$/.test(s.code), JSON.stringify(s));
const on = b.tab('Online'); assert.ok(on, 'Online tab created');
assert.strictEqual(on.d[0][0], 'submitted_at'); assert.ok(on.d[0].indexOf('form_no') < 0 && on.d[0].indexOf('q8') < 0 && on.d[0].indexOf('q43') < 0, 'online tab has only online columns');
const r = on.d[1];
assert.strictEqual(r[colOf('Online', 'q1')], 'HYPERLINK("x")'); assert.strictEqual(r[colOf('Online', 'q12')], 'Pomfret; Crab');
assert.strictEqual(r[colOf('Online', 'q44')], '9876543210'); assert.strictEqual(r[colOf('Online', 'src')], 'share'); assert.strictEqual(r[colOf('Online', 'reward_code')], s.code);
assert.strictEqual(b.tab('Responses').d.length, 2, 'online answer not written to the offline tab');
let d = b.post({ action: 'submit', a: { q1: 'x' }, mobile: '9876543210', consent: true });
assert.ok(d.ok && d.dup && d.code === s.code); assert.strictEqual(on.d.length, 2);
assert.strictEqual(b.post({ action: 'submit', a: {}, mobile: '9876543211' }).error, 'consent');
assert.strictEqual(b.post({ action: 'submit', a: {}, mobile: '12345' }).error, 'mobile');
let n = b.post({ action: 'submit', a: { q1: 'Shahupuri' }, seconds: 20 });
assert.ok(n.ok && n.code === ''); assert.strictEqual(on.d[2][colOf('Online', 'needs_check')], 'fast');
assert.ok(b.post({ action: 'submit', website: 'spam', a: { q1: 'bot' } }).ok); assert.strictEqual(on.d.length, 3);

// offline save / duplicate / edit / renumber / delete
assert.ok(b.post({ action: 'save', pin: '4321', rec: { no: 2, a: { q1: 'Rajarampuri', q8: ['Yes, always', 'Sometimes'] }, check: true } }).ok);
assert.strictEqual(b.tab('Responses').d[2][colOf('Responses', 'q8')], 'Yes, always; Sometimes');
assert.strictEqual(b.post({ action: 'save', pin: '4321', rec: { no: 2, a: {} } }).error, 'exists');
assert.ok(b.post({ action: 'save', pin: '4321', edit: 2, rec: { no: 2, a: { q1: 'Rajarampuri East' } } }).ok);
assert.ok(b.post({ action: 'save', pin: '4321', edit: 2, rec: { no: 5, a: { q1: 'Moved' } } }).ok);
l = b.post({ action: 'list', pin: '4321' }); assert.deepStrictEqual(l.rows.map(r => r.no).sort(), [1, 5]);
assert.ok(b.post({ action: 'delete', pin: '4321', no: 5 }).deleted);
l = b.post({ action: 'list', pin: '4321' }); assert.deepStrictEqual(l.rows.map(r => r.no), [1]);
assert.strictEqual(on.d.length, 3, 'online rows untouched');
for (let i = 0; i < 9; i++) b.post({ action: 'list', pin: 'bad' });
assert.strictEqual(b.post({ action: 'list', pin: '4321' }).error, 'locked');

// 2) a sheet whose tabs are already "Offline" and "Online": the old tab name is not needed
b = makeBackend({ rows: [HEAD, form1], tab: 'Offline', maxCols: 68 });
assert.ok(b.post({ action: 'save', pin: '4321', rec: { no: 3, a: { q1: 'Kasba' } } }).ok);
assert.strictEqual(b.tab('Offline').d.length, 3); assert.ok(!b.tab('Responses'));
assert.ok(b.post({ action: 'submit', a: { q1: 'Online one' } }).ok); assert.strictEqual(b.tab('Online').d.length, 2);
console.log('survey gs tests passed');
