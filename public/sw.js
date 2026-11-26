// v8: song data is now cached per anonymous identity so offline reading works
// without ever mixing accounts (issue #467). v7 held no song copies.
const CACHE_NAME = 'jplrc-v8';
const SONG_CACHE = 'jplrc-songs-v1';
const IMMUTABLE_CACHE = 'jplrc-immutable-v1';
const KUROMOJI_CACHE = 'jplrc-kuromoji-v1';
// Keep in sync with src/lib/app-icon.ts and public/manifest.json.
const APP_ICON_REVISION = 'lyrics-v1';
const ICON_URLS = [
  '/icon.svg',
  '/favicon.ico',
  '/icon-16x16.png',
  '/icon-32x32.png',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-maskable-512x512.png',
  '/apple-touch-icon.png',
];

/**
 * Whether `response` may be persisted in the Cache Storage.
 *
 * Issue #298: song endpoints answer with personalized, ACL-gated data
 * (`/api/songs` + `/api/songs/:id`) and mark those responses
 * `Cache-Control: private, no-store` so shared/CDN and browser HTTP caches
 * never persist them. The service worker is a separate, per-browser store: it
 * may keep a local copy for offline reading only in the identity-scoped
 * SONG_CACHE, keyed by the server-issued `X-Offline-Identity`. A response with
 * no identity header is never stored, and this generic helper still refuses
 * any `no-store` response for the non-song caches below.
 */
function isCacheable(response) {
  if (!response || !response.ok) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/\bno-store\b/i.test(cacheControl);
}

/** Identity-scoped cache key: same URL never collides across accounts. */
function songCacheKey(request, identity) {
  return new Request(`${request.url}${request.url.includes('?') ? '&' : '?'}__offline=${encodeURIComponent(identity)}`, request);
}

/** Drop every previously cached song payload — used on identity change. */
async function clearSongCache() {
  await caches.delete(SONG_CACHE);
}

/** Current identity, mirrored from the app after each /api/me refresh. */
async function currentIdentity() {
  const cache = await caches.open(SONG_CACHE);
  const marker = await cache.match('/__identity__');
  return marker ? await marker.text() : null;
}

async function setCurrentIdentity(identity) {
  const cache = await caches.open(SONG_CACHE);
  await cache.put('/__identity__', new Response(identity));
}

/**
 * Reconcile the worker's cached identity with the signed-in account.
 * The app calls this through postMessage after resolving `/api/me`; a mismatch
 * means logout / login / account switch, so every song copy is discarded rather
 * than risk serving the previous account's lyrics while offline.
 */
async function syncIdentity(identity) {
  const next = identity || 'anon';
  const previous = await currentIdentity();
  if (previous === next) return;
  await clearSongCache();
  await setCurrentIdentity(next);
}

// Install: precache icons only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const urls = [
        ...ICON_URLS,
        ...ICON_URLS.map((url) => `${url}?v=${APP_ICON_REVISION}`),
        '/manifest.json',
      ];
      return Promise.allSettled(urls.map((url) => cache.add(url)));
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
          .filter((k) => k !== CACHE_NAME && k !== IMMUTABLE_CACHE && k !== KUROMOJI_CACHE && k !== SONG_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Identity reconciliation from the page (issue #467).
self.addEventListener('message', (event) => {
  const identity = event.data && event.data.type === 'OFFLINE_IDENTITY' ? event.data.identity : null;
  if (event.waitUntil) event.waitUntil(syncIdentity(identity));
  else syncIdentity(identity);
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

  // API: song data → network-first, persisted per identity for offline reading.
  // Other API endpoints stay network-only (issue #298).
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/songs' || /^\/api\/songs\/[^/]+$/.test(url.pathname)) {
      event.respondWith(
        (async () => {
          const identity = await currentIdentity();
          try {
            const response = await fetch(request);
            // The server attaches X-Offline-Identity only to song payloads the
            // current caller is allowed to read. No header → never persisted.
            const serverIdentity = response.headers.get('X-Offline-Identity');
            // Song payloads are deliberately `private, no-store` so shared
            // caches never persist them. The identity header is the server's
            // explicit opt-in for this per-browser offline copy; `response.ok`
            // still guards against caching error bodies.
            if (response.ok && serverIdentity) {
              // Only write when the page has already told us which account is
              // active. Without that, the server response belongs to whoever
              // holds the cookie right now, and the next user could read it
              // offline — exactly the leak #298 guarded against.
              if (identity === serverIdentity) {
                const key = songCacheKey(request, serverIdentity);
                const clone = response.clone();
                caches.open(SONG_CACHE).then((c) => c.put(key, clone));
              }
            }
            return response;
          } catch (error) {
            if (!identity) throw error;
            const cached = await caches.match(songCacheKey(request, identity));
            if (cached) return cached;
            throw error;
          }
        })()
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
