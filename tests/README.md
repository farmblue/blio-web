# Blio tests

Local mock of the Apps Script backend (runs the real gas/Code.gs in a Node vm) plus a static server.

Run the mock: `node tests/server.js` (serves the app on http://127.0.0.1:8800).
Browser tests (Playwright for Python): `python3 tests/test5.py`, `test7.py`, `test9.py`, `test10.py`, `test_anim.py`.
Script-level tests: `node tests/gs-test5.js`, `gs-test8.js`.

Test pages load fonts from `tests/fonts/node_modules/@fontsource` (run `npm i @fontsource/<font>` in tests/fonts if needed; the tests still run without them).
