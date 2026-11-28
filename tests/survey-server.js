/* Local mock for the survey: runs the real gas/survey.gs in a Node vm over an in-memory sheet,
   serves the site, and points /survey/config.js at the mock. node tests/survey-server.js [port] */
const fs = require('fs'), vm = require('vm'), http = require('http'), path = require('path');
const ROOT = path.join(__dirname, '..');

function makeBackend(opts) {
  opts = opts || {};
  const sheet = { d: (opts.rows || []).map(r => r.slice()), maxCols: opts.maxCols || 68 };
  const S = {
    getLastRow: () => sheet.d.length,
    getLastColumn: () => Math.max(0, ...sheet.d.map(r => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return n; })),
    getMaxColumns: () => sheet.maxCols,
    insertColumnsAfter: (c, n) => { sheet.maxCols += n; },
    setFrozenRows() {},
    deleteRow: r => { sheet.d.splice(r - 1, 1); },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (c + nc - 1 > sheet.maxCols) throw new Error('out of columns');
      const ensure = () => { while (sheet.d.length < r + nr - 1) sheet.d.push([]); for (let i = 0; i < nr; i++) while (sheet.d[r - 1 + i].length < c + nc - 1) sheet.d[r - 1 + i].push(''); };
      const rg = {
        getValues() { ensure(); return sheet.d.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)); },
        setValues(v) { ensure(); v.forEach((row, i) => row.forEach((x, j) => { sheet.d[r - 1 + i][c - 1 + j] = x; })); return rg; },
        setNumberFormat() { return rg; }, setFontWeight() { return rg; }
      };
      return rg;
    }
  };
  const cache = {}, props = { ENTRY_PIN: opts.pin || '4321' };
  const ctx = {
    console, Math, JSON, String, Number, Array, Object, Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => n === 'Responses' ? S : null, insertSheet: () => S }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { formatDate: () => '2026-11-28 10:30' },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'gas/survey.gs'), 'utf8'), ctx);
  return {
    sheet, cache,
    post: body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).s),
    get: () => JSON.parse(ctx.doGet().s)
  };
}

function serve(backend, port) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api') {
      if (req.method === 'POST') { let b = ''; req.on('data', c => b += c); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(backend.post(b))); }); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(backend.get())); return;
    }
    if (u.pathname === '/survey/config.js') { res.writeHead(200, { 'Content-Type': types['.js'] }); res.end("window.SURVEY_API = '/api';"); return; }
    let p = path.join(ROOT, decodeURIComponent(u.pathname));
    if (p.endsWith('/')) p += 'index.html';
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}

module.exports = { makeBackend, serve };
if (require.main === module) serve(makeBackend(), Number(process.argv[2] || 8810)).then(() => console.log('survey mock on http://127.0.0.1:' + (process.argv[2] || 8810)));
