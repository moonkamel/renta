// Service worker : l'appli fonctionne hors connexion (cuisine, cave, réserve…).
const CACHE = 'renta-v7';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/calc.js',
  'js/store.js',
  'js/scanner.js',
  'js/icons.js',
  'js/help.js',
  'js/sync.js',
  'js/config.js',
  'fonts/dm-serif-display.woff2',
  'img/sticker.webp',
  'vendor/zxing.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Réponse immédiate depuis le cache, mise à jour en arrière-plan pour la prochaine ouverture.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached || cache.match('index.html'));
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
