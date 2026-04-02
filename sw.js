const CACHE_NAME = 'tastingnote-v2';
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
  // Let API calls pass through to network
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com')) {
    return;
  }
  // Network-first for HTML and JS so code updates are picked up immediately
  if (e.request.destination === 'document' || e.request.destination === 'script') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Cache-first for other assets (CSS, images, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
