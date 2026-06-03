const CACHE_NAME = 'jplrc-v2';

// Install: cache static assets individually (one failure won't block others)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const urls = [
        '/icon-16x16.png',
        '/icon-32x32.png',
        '/icon-192x192.png',
        '/icon-512x512.png',
        '/apple-touch-icon.png',
        '/manifest.json',
      ];
      // Add each URL individually — skip failures silently
      return Promise.allSettled(urls.map((u) => cache.add(u)));
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // API calls: network-only (no caching)
  if (url.pathname.startsWith('/api/')) return;

  // Spotify external: network-only
  if (url.hostname.includes('spotify.com') || url.hostname.includes('spotifycdn.com')) return;

  // Google Fonts: cache-first
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Static assets & pages: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
