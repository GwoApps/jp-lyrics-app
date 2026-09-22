const CACHE_NAME = 'jplrc-v5';
const IMMUTABLE_CACHE = 'jplrc-immutable-v1';
const KUROMOJI_CACHE = 'jplrc-kuromoji-v1';

/**
 * Whether `response` may be persisted in the Cache Storage.
 *
 * Issue #298: song endpoints answer with personalized, ACL-gated data
 * (`/api/songs` + `/api/songs/:id`) and mark those responses
 * `Cache-Control: private, no-store`. A URL-keyed persistent copy would
 * otherwise be replayed to whoever uses this browser next — after logout,
 * session expiry or an account switch — while offline, where the server ACL is
 * never consulted. When the server says `no-store`, the response is passed
 * through untouched and never written to a cache.
 */
function isCacheable(response) {
  if (!response || !response.ok) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/\bno-store\b/i.test(cacheControl);
}

// Install: precache icons only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled([
        cache.add('/icon-16x16.png'),
        cache.add('/icon-32x32.png'),
        cache.add('/icon-192x192.png'),
        cache.add('/icon-512x512.png'),
        cache.add('/icon-maskable-512x512.png'),
        cache.add('/apple-touch-icon.png'),
        cache.add('/manifest.json'),
      ]);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches, notify clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== IMMUTABLE_CACHE && k !== KUROMOJI_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin: kuromoji-es + zlib.js CDN → cache-first (persistent)
  if (url.hostname.includes('code4fukui.github.io') || url.hostname.includes('taisukef.github.io')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(KUROMOJI_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Skip other cross-origin (Spotify, Google Fonts handled separately)
  if (url.origin !== self.location.origin) {
    // Google Fonts: cache-first
    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
      event.respondWith(
        caches.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
            return response;
          });
        })
      );
    }
    return;
  }

  // API: song data → network-first (cache for offline); other API → network-only
  if (url.pathname.startsWith('/api/')) {
    // Cache song list and song detail for offline
    if (url.pathname === '/api/songs' || /^\/api\/songs\/[^/]+$/.test(url.pathname)) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (isCacheable(response)) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(request))
      );
    }
    return;
  }

  // Next.js immutable static assets (/_next/static/*): cache-first
  // These have content hashes in filenames — safe to cache forever
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(IMMUTABLE_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // HTML pages (navigation): network-first
  // Always fetch fresh HTML so new JS/CSS hashes are picked up
  if (request.mode === 'navigate' || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Other same-origin static (icons, manifest, etc.): stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
