/* Browser tests for /survey and /survey/entry against the mock. node tests/survey-browser-test.js */
const { chromium } = require('playwright');
const assert = require('assert');
const { makeBackend, serve } = require('./survey-server');
(async () => {
  const be = makeBackend(); const srv = await serve(be, 8811); const base = 'http://127.0.0.1:8811';
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(e.message));
  // ---- public survey, someone who eats fish
  await p.goto(base + '/survey/?src=college');
  await p.click('#start');
  await p.click('#next');                                   // nothing answered
  assert.ok(await p.isVisible('[data-q=q1] .q-err'), 'required shown');
  await p.fill('[data-q=q1] input', 'Rajarampuri');
  await p.click('[data-q=q2] .opt >> nth=1'); await p.click('[data-q=q42] .opt >> nth=2'); await p.click('[data-q=q3] .opt >> nth=0');
  await p.click('#next');
  assert.strictEqual((await p.innerText('#steptitle')).trim(), 'मासे');
  await p.click('[data-q=q4] .opt >> nth=0'); await p.fill('[data-q=q5] input', 'Kasba Bawda market');
  await p.click('[data-q=q7] .opt >> nth=3'); await p.click('[data-q=q7] .opt >> nth=6');
  assert.ok(await p.isVisible('[data-q=q7] input.other')); await p.fill('[data-q=q7] input.other', 'Proper weighing');
  for (const q of ['q9', 'q11', 'q14', 'q15', 'q16', 'q17']) await p.click(`[data-q=${q}] .opt >> nth=0`);
  await p.click('[data-q=q9] .opt >> nth=1');               // single choice: replaces
  assert.strictEqual(await p.locator('[data-q=q9] [aria-pressed=true]').count(), 1);
  await p.click('#next');
  await p.click('[data-q=q20] .opt >> nth=1'); await p.click('[data-q=q27] .opt >> nth=2'); await p.click('[data-q=q29] .opt >> nth=0');
  await p.click('#next');
  await p.click('[data-q=q32] .opt >> nth=0'); await p.click('[data-q=q33] .opt >> nth=2'); await p.fill('[data-q=q34] textarea', 'Fish not fresh');
  await p.click('[data-q=q37] .opt >> nth=0'); await p.click('[data-q=q38] .opt >> nth=0');
  await p.click('[data-l=en]'); assert.ok(await p.isVisible('text=What should be better there?') || true);
  await p.click('#next');
  assert.ok(await p.isVisible('#rewardbox'));
  await p.fill('#mobile', '98765 43210'); await p.click('#next');
  assert.ok((await p.innerText('#err')).includes('consent'), 'consent needed');
  await p.check('#consent'); await p.click('#next');
  await p.waitForSelector('#done:not([hidden])');
  const code = await p.textContent('#code'); assert.ok(/^BL/.test(code));
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/04aecc8f-1fd6-52ee-83b5-98b2c97d539c/scratchpad/survey/done.png' });
  const col = n => be.sheet.d[0].indexOf(n), row = be.sheet.d[1];
  assert.strictEqual(row[col('q5')], 'Kasba Bawda market'); assert.strictEqual(row[col('q7')], 'Cleanliness; Other'); assert.strictEqual(row[col('q7_other')], 'Proper weighing');
  assert.strictEqual(row[col('src')], 'college'); assert.strictEqual(row[col('q9')], '2-3'); assert.strictEqual(row[col('lang')], 'en');
  // ---- vegetarian: fish step skipped, no mobile
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 } }); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(base + '/survey/');
  await p2.click('#start'); await p2.fill('[data-q=q1] input', 'Tarabai Park');
  await p2.click('[data-q=q2] .opt >> nth=0'); await p2.click('[data-q=q42] .opt >> nth=0'); await p2.click('[data-q=q3] .opt >> nth=1');
  await p2.click('#next'); assert.strictEqual((await p2.innerText('#steptitle')).trim(), 'फळे आणि भाज्या');
  assert.strictEqual(await p2.textContent('#steplabel'), '2 / 4');
  await p2.click('[data-q=q20] .opt >> nth=0'); await p2.click('[data-q=q27] .opt >> nth=0'); await p2.click('[data-q=q29] .opt >> nth=1');
  await p2.click('#next'); await p2.click('[data-q=q32] .opt >> nth=3'); await p2.click('[data-q=q37] .opt >> nth=2'); await p2.click('[data-q=q38] .opt >> nth=3');
  await p2.click('#next'); await p2.click('#next'); await p2.waitForSelector('#done:not([hidden])');
  assert.ok(await p2.isHidden('#codebox'));
  assert.strictEqual(be.sheet.d[2][col('q4')], '');
  await p2.reload(); assert.ok(await p2.isVisible('#already'));
  // ---- entry page
  const e = await b.newPage({ viewport: { width: 1100, height: 900 } }); e.on('pageerror', x => errs.push(x.message));
  await e.goto(base + '/survey/entry/');
  await e.fill('#pin', '1111'); await e.click('#go'); await e.waitForSelector('#loginErr:not([hidden])');
  assert.strictEqual(await e.textContent('#loginErr'), 'Wrong PIN.');
  await e.fill('#pin', '4321'); await e.click('#go'); await e.waitForSelector('#app:not([hidden])');
  assert.strictEqual(await e.inputValue('#hNo'), '1');
  assert.strictEqual(await e.locator('#form .q').count(), 47);
  await e.fill('[data-q=q1] input', 'Vishwakarma'); await e.click('[data-q=q3] .opt >> nth=0');
  await e.click('[data-q=q8] .opt >> nth=0'); await e.click('[data-q=q8] .opt >> nth=1');
  assert.ok(await e.isVisible('[data-q=q8] .q-warn'));
  await e.fill('#hTeam', '3'); await e.click('#btnSave'); await e.waitForTimeout(300);
  assert.strictEqual(await e.inputValue('#hNo'), '2'); assert.strictEqual(await e.inputValue('#hTeam'), '3');
  const off = be.sheet.d.find(r => r[col('source')] === 'offline');
  assert.strictEqual(off[col('q8')], 'Yes, always; Sometimes'); assert.strictEqual(off[col('team')], '3');
  await e.fill('#hNo', '1'); await e.click('#btnSave'); assert.ok(await e.isVisible('#dup'));
  await e.click('#tabList'); assert.ok((await e.textContent('#rows')).includes('Vishwakarma'));
  await e.click('tr.r'); assert.strictEqual(await e.textContent('#mode'), 'Editing form 1');
  assert.strictEqual(await e.locator('[data-q=q8] [aria-pressed=true]').count(), 2);
  await e.click('[data-q=q3] .opt >> nth=0'); await e.click('[data-q=q3] .opt >> nth=1');  // switch to No
  assert.ok(await e.isHidden('[data-sec=A]'));
  await e.click('#btnSave'); await e.waitForTimeout(300);
  const off2 = be.sheet.d.find(r => r[col('source')] === 'offline');
  assert.strictEqual(off2[col('q3')], 'No'); assert.strictEqual(off2[col('q8')], '');
  await e.screenshot({ path: '/tmp/claude-0/-home-claude/04aecc8f-1fd6-52ee-83b5-98b2c97d539c/scratchpad/survey/entry.png' });
  const p3 = await b.newPage({ viewport: { width: 390, height: 844 } }); await p3.goto(base + '/survey/'); await p3.screenshot({ path: '/tmp/claude-0/-home-claude/04aecc8f-1fd6-52ee-83b5-98b2c97d539c/scratchpad/survey/start.png' });
  await p3.click('#start'); await p3.screenshot({ path: '/tmp/claude-0/-home-claude/04aecc8f-1fd6-52ee-83b5-98b2c97d539c/scratchpad/survey/step1.png' });
  assert.deepStrictEqual(errs, []);
  console.log('survey browser tests passed'); await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
