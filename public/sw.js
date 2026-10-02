/*
 * Service worker de Relais.
 *
 * - Ressources statiques (CSS, JS, icônes, vendor) : cache d'abord, puis
 *   mise à jour en arrière-plan (stale-while-revalidate).
 * - Pages HTML : réseau d'abord, le shell en cache sert hors ligne.
 * - API : jamais mise en cache. Les tickets contiennent des données
 *   personnelles ; un poste partagé ne doit pas les garder après déconnexion.
 *
 * Changer VERSION à chaque livraison qui modifie le shell.
 */
const VERSION = 'relais-v0.8.0';
const SHELL = [
  '/css/tokens.css',
  '/css/base.css',
  '/css/components.css',
  '/css/views.css',
  '/js/theme-boot.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Le shell (index ou login) est gardé au passage, jamais une redirection.
    const key = url.pathname === '/login' ? '/login' : '/';
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(key).then((r) => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
