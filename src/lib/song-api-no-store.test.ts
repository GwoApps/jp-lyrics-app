/**
 * Issues #298 + #467 — personalized song API responses are private, but can
 * still be read offline from an identity-scoped service-worker cache.
 *
 * `/api/songs` and `/api/songs/:id` return ACL-gated data and keep
 * `Cache-Control: private, no-store` so shared/CDN and browser HTTP caches
 * never persist them. The service worker keeps a separate per-browser copy for
 * offline reading, keyed by the server-issued `X-Offline-Identity` (derived
 * from the signed session cookie), and discards the whole song cache when the
 * identity changes. A response without the identity header is never stored.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { NextResponse } = require('next/server') as typeof import('next/server');

const here = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(here, '..', '..', 'public', 'sw.js'), 'utf8');

const PRIVATE_NO_STORE = 'private, no-store';

/** Pull a route's `NO_STORE_HEADERS` value straight out of the `as const` literal. */
function declaredCacheControl(source: string): string | null {
  const match = source.match(
    /const\s+NO_STORE_HEADERS\s*=\s*\{\s*'Cache-Control'\s*:\s*'([^']+)'\s*\}/,
  );
  return match ? match[1] : null;
}

/**
 * Every *successful* `NextResponse.json(...)` in a GET handler must carry the
 * no-store headers — a bare one would silently reintroduce the leak for that
 * branch. Error responses (401/404/…) are deliberately out of scope: they carry
 * no song data, and the service worker already skips non-ok responses.
 */
function unheaderedSuccessResponses(body: string): string[] {
  const offenders: string[] = [];
  // Match every `NextResponse.json(...)` success payload, whether it is
  // returned directly or wrapped in `withOfflineIdentity(...)` (issue #467).
  // `[^;]*` (rather than a dotAll regex) keeps the scan within one statement
  // without needing the `s` flag, which the ES2017 target rejects.
  const statements = body.match(/NextResponse\.json\([^;]*;/g) || [];
  for (const statement of statements) {
    // `{ status: 4xx }` (or an error payload) marks a non-success branch.
    if (/status:\s*[45]\d\d/.test(statement)) continue;
    if (!statement.includes('NO_STORE_HEADERS')) offenders.push(statement.trim());
  }
  return offenders;
}

/**
 * Slice a single named export out of a route module. The parameter list may
 * itself contain braces (`{ params }`), so the body starts at the last `)` of
 * the signature and then balances braces from there.
 */
function exportBody(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}(`);
  assert.notEqual(start, -1, `route must export ${exportName}`);
  const braceStart = source.indexOf('{', source.lastIndexOf(')', source.indexOf(') {', start) + 1));
  assert.notEqual(braceStart, -1, `route ${exportName} must have a body`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${exportName}`);
}

/** Slice the API branch of the service worker's fetch handler. */
function swApiBranch(source: string): string {
  const start = source.indexOf("if (url.pathname.startsWith('/api/'))");
  assert.notEqual(start, -1, 'sw.js must special-case /api/ requests');
  return source.slice(start, source.indexOf("if (url.pathname.startsWith('/_next/static/'))", start));
}

const songsRoute = readFileSync(join(here, '..', 'app', 'api', 'songs', 'route.ts'), 'utf8');
const songDetailRoute = readFileSync(
  join(here, '..', 'app', 'api', 'songs', '[id]', 'route.ts'),
  'utf8',
);
const songsGet = exportBody(songsRoute, 'GET');
const songDetailGet = exportBody(songDetailRoute, 'GET');

test('song API routes declare no-store for personalized responses', () => {
  assert.equal(declaredCacheControl(songsRoute), PRIVATE_NO_STORE);
  assert.equal(declaredCacheControl(songDetailRoute), PRIVATE_NO_STORE);
});

test('every GET /api/songs branch returns the no-store headers', () => {
  // `songs`/`[]` results are the personalized payloads — every branch is covered.
  assert.deepEqual(unheaderedSuccessResponses(songsGet), []);
});

test('GET /api/songs/[id] returns the no-store headers on its song payload', () => {
  assert.ok(songDetailGet.includes('NO_STORE_HEADERS'), 'detail response must be covered');
  assert.deepEqual(unheaderedSuccessResponses(songDetailGet), []);
});

test('the declared header forbids shared caching and persistence', () => {
  const value = declaredCacheControl(songsRoute) ?? '';
  assert.match(value, /(^|,\s*)private(,|$)/);
  assert.match(value, /(^|,\s*)no-store(,|$)/);
});

test('NextResponse conveys Cache-Control: private, no-store verbatim', () => {
  const response = NextResponse.json(
    { id: 'song-1' },
    { headers: { 'Cache-Control': PRIVATE_NO_STORE } },
  );
  assert.equal(response.headers.get('Cache-Control'), PRIVATE_NO_STORE);
  assert.equal(response.status, 200);
});

test('sw.js persists song responses only in the identity-scoped song cache', () => {
  const branch = swApiBranch(swSource);
  assert.match(branch, /caches\.open\(SONG_CACHE\)/);
  assert.match(branch, /serverIdentity = response\.headers\.get\(['"]X-Offline-Identity['"]\)/);
  assert.match(branch, /response\.ok\s*&&\s*serverIdentity/);
  assert.doesNotMatch(branch, /caches\.open\(CACHE_NAME\)[\s\S]*?c\.put\(key, clone\)/);
  // A song copy is never keyed by the raw URL alone.
  assert.match(branch, /songCacheKey\(request, serverIdentity\)/);
  assert.match(
    branch,
    /if\s*\(\s*identity === serverIdentity\s*\)/,
    'a mismatched worker identity must not store a foreign payload',
  );
});

test('sw.js clears the song cache when the signed-in identity changes', () => {
  assert.match(swSource, /addEventListener\(['"]message['"]/);
  assert.match(swSource, /OFFLINE_IDENTITY/);
  assert.match(swSource, /async function syncIdentity\(identity\)[\s\S]*?clearSongCache\(\)/);
  assert.match(swSource, /const SONG_CACHE = 'jplrc-songs-v1'/);
});

/**
 * Execute the real `isCacheable` guard out of `sw.js` so its semantics (rather
 * than just its presence) are pinned. A helper that always returned `true`
 * would defeat the whole fix, and a source-pattern assertion alone cannot see
 * that.
 */
function loadIsCacheable(): (response: Response) => boolean {
  const match = swSource.match(/function isCacheable\(response\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'sw.js must define isCacheable(response)');
  const factory = new Function(`${match[0]}\nreturn isCacheable;`);
  return factory() as (response: Response) => boolean;
}

test('sw.js only cache-stores responses that are not marked no-store', () => {
  const isCacheable = loadIsCacheable();
  const json = (cacheControl?: string) =>
    new Response('{}', {
      headers: cacheControl ? { 'Cache-Control': cacheControl } : undefined,
    });

  // Responses without the offline identity header are never stored by the
  // generic path; the song branch additionally checks the header itself.
  assert.equal(isCacheable(json(PRIVATE_NO_STORE)), false);
  assert.equal(isCacheable(json('no-store')), false);
  assert.equal(isCacheable(json('private, NO-STORE')), false);

  // Public/offline-able payloads keep their caching ability.
  assert.equal(isCacheable(json()), true);
  assert.equal(isCacheable(json('public, max-age=31536000, immutable')), true);
  assert.equal(isCacheable(json('no-cache')), true);

  // Non-ok responses are never stored, whatever their headers say.
  assert.equal(isCacheable(new Response('', { status: 404 })), false);
  assert.equal(isCacheable(new Response('', { status: 500 })), false);
});

test('sw.js keeps the offline fallback for song requests, keyed by identity', () => {
  const branch = swApiBranch(swSource);
  assert.match(branch, /url\.pathname === '\/api\/songs'/);
  assert.match(branch, /\/\^\\\/api\\\/songs\\\/\[\^\/\]\+\$\/\.test\(url\.pathname\)/);
  assert.match(branch, /caches\.match\(songCacheKey\(request, identity\)\)/);
});
