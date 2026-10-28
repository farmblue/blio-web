/* Blio service worker: keeps the app shell available offline, always tries the network first. */
var CACHE = 'blio-v8';
var SHELL = ['/', '/index.html', '/app.css?v=8', '/app.js?v=8', '/products.js?v=8', '/manifest.webmanifest',
  '/icons/wordmark.svg', '/icons/wordmark-dark.svg', '/icons/icon-192.png', '/favicon.ico'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) { return; }
  e.respondWith(fetch(req).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copy); });
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('/'); });
  }));
});
