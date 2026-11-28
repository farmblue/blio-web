/* Script-level tests for gas/survey.gs. node tests/survey-gs-test.js */
const { makeBackend } = require('./survey-server');
const assert = require('assert');
const HEAD = ["form_no","date","team","surveyor","q1","q2","q3","q4","q4_other","q5","q6","q6_other","q7","q7_other","q8","q9","q10","q11","q12","q12_other","q13","q13_other","q14","q15","q16","q17","q18","q19","q19_other","q20","q20_other","q21","q22","q22_other","q23","q23_other","q24","q25","q26","q27","q28","q29","q30","q31","q31_other","q32","q32_other","q33","q34","q35","q36","q37","q38","q39","q40","q41","q41_other","q42","q43","q44","q45","q46","q46_other","q47","q47_other","needs_check","notes"];
const form1 = HEAD.map(c => c === 'form_no' ? 1 : c === 'q1' ? 'Vishwakarma' : c === 'q3' ? 'Yes' : '');
const b = makeBackend({ rows: [HEAD, form1], maxCols: 68 });
const col = n => b.sheet.d[0].indexOf(n);

// PIN
assert.deepStrictEqual(b.post({ action: 'list', pin: 'x' }).error, 'pin');
let l = b.post({ action: 'list', pin: '4321' });
assert.ok(l.ok); assert.strictEqual(l.rows.length, 1); assert.strictEqual(l.rows[0].no, 1); assert.strictEqual(l.rows[0].a.q1, 'Vishwakarma');
assert.ok(col('source') > 66 && col('lang') > 66, 'extra columns added');

// online submit, formula text neutralised, mobile dedupe
let s = b.post({ action: 'submit', a: { q1: '=HYPERLINK("x")', q3: 'Yes', q12: ['Pomfret', 'Crab'], q43: 'Should not save' }, mobile: '+91 98765 43210', consent: true, src: 'rotary', seconds: 200, lang: 'mr' });
assert.ok(s.ok && /^BL[A-Z2-9]{6}$/.test(s.code), JSON.stringify(s));
const r2 = b.sheet.d[2];
assert.strictEqual(r2[col('q1')], 'HYPERLINK("x")'); assert.strictEqual(r2[col('q12')], 'Pomfret; Crab');
assert.strictEqual(r2[col('q44')], '9876543210'); assert.strictEqual(r2[col('q43')], ''); assert.strictEqual(r2[col('source')], 'online'); assert.strictEqual(r2[col('src')], 'rotary');
let d = b.post({ action: 'submit', a: { q1: 'x' }, mobile: '9876543210', consent: true });
assert.ok(d.ok && d.dup && d.code === s.code); assert.strictEqual(b.sheet.d.length, 3);
assert.strictEqual(b.post({ action: 'submit', a: {}, mobile: '9876543211' }).error, 'consent');
assert.strictEqual(b.post({ action: 'submit', a: {}, mobile: '12345' }).error, 'mobile');
let n = b.post({ action: 'submit', a: { q1: 'Shahupuri' }, seconds: 20 });
assert.ok(n.ok && n.code === ''); assert.strictEqual(b.sheet.d[3][col('needs_check')], 'fast');
assert.ok(b.post({ action: 'submit', website: 'spam', a: { q1: 'bot' } }).ok); assert.strictEqual(b.sheet.d.length, 4);

// offline save / duplicate / edit / renumber / delete; online rows untouched
assert.ok(b.post({ action: 'save', pin: '4321', rec: { no: 2, a: { q1: 'Rajarampuri', q8: ['Yes, always', 'Sometimes'] }, check: true } }).ok);
assert.strictEqual(b.post({ action: 'save', pin: '4321', rec: { no: 2, a: {} } }).error, 'exists');
assert.ok(b.post({ action: 'save', pin: '4321', edit: 2, rec: { no: 2, a: { q1: 'Rajarampuri East' } } }).ok);
l = b.post({ action: 'list', pin: '4321' });
assert.strictEqual(l.rows.length, 2); assert.strictEqual(l.rows.find(r => r.no === 2).a.q1, 'Rajarampuri East');
assert.ok(b.post({ action: 'save', pin: '4321', edit: 2, rec: { no: 5, a: { q1: 'Moved' } } }).ok);
l = b.post({ action: 'list', pin: '4321' });
assert.deepStrictEqual(l.rows.map(r => r.no).sort(), [1, 5]);
assert.ok(b.post({ action: 'delete', pin: '4321', no: 5 }).deleted);
l = b.post({ action: 'list', pin: '4321' }); assert.deepStrictEqual(l.rows.map(r => r.no), [1]);
assert.strictEqual(b.sheet.d.filter(r => r[col('source')] === 'online').length, 2);

// lockout
for (let i = 0; i < 9; i++) b.post({ action: 'list', pin: 'bad' });
assert.strictEqual(b.post({ action: 'list', pin: '4321' }).error, 'locked');
console.log('survey gs tests passed');
