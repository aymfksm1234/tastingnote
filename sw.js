const CACHE_NAME = 'tastingnote-v1';
const ASSETS = [
  './',
  './index.html',
  './src/app.js',
  './src/utils.js',
  './src/style.css',
  './src/gemini.js',
  './src/google-auth.js',
  './src/google-sheets.js',
  './src/google-drive.js',
  './src/stats.js',
  './src/map.js',
  './manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com')) {
    return; // Let API calls pass through
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
