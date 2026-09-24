/**
 * Issue #298 — personalized song API responses must not be persisted.
 *
 * `/api/songs` and `/api/songs/:id` return session-scoped data (private songs,
 * `?mine=1` / `?favorites=1`). The service worker used to key its persistent
 * cache by URL alone, so after logout / session expiry / an account switch a
 * failed request replayed the previous user's lyrics and translations — even
 * while offline, where the server ACL (`getAuthUser`, `isSongVisibleToUser`)
 * never runs.
 *
 * Fix (option 1): the routes answer with `Cache-Control: private, no-store`,
 * and `sw.js` skips its cache write for any response carrying `no-store`. The
 * offline fallback itself is intentionally kept, together with the public
 * static-asset caching.
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
  // `[^;]*` (rather than a dotAll regex) keeps the scan within one statement
  // without needing the `s` flag, which the ES2017 target rejects.
  const statements = body.match(/return NextResponse\.json\([^;]*;/g) || [];
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

test('sw.js skips the cache write when the server says no-store', () => {
  const branch = swApiBranch(swSource);
  // The cache write must be gated by the response header, not by `response.ok`.
  assert.match(branch, /caches\.open\(CACHE_NAME\)\.then\(\(c\) => c\.put\(request, clone\)\)/);
  assert.match(
    branch,
    /if\s*\(\s*isCacheable\(response\)\s*\)\s*\{[\s\S]*?caches\.open\(CACHE_NAME\)[\s\S]*?\}/,
    'the cache write must be guarded by isCacheable(response)',
  );
  assert.doesNotMatch(
    branch,
    /if\s*\(\s*response\.ok\s*\)\s*\{[\s\S]*?c\.put\(request, clone\)/,
    'the raw response.ok guard would re-cache no-store responses',
  );
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

  // Personalized responses (the #298 case) must be passed through, never stored.
  assert.equal(isCacheable(json(PRIVATE_NO_STORE)), false);
  assert.equal(isCacheable(json('no-store')), false);
  assert.equal(isCacheable(json('private, NO-STORE')), false);
  assert.equal(isCacheable(json('no-cache, no-store, must-revalidate')), false);

  // Public/offline-able payloads keep their caching ability.
  assert.equal(isCacheable(json()), true);
  assert.equal(isCacheable(json('public, max-age=31536000, immutable')), true);
  assert.equal(isCacheable(json('no-cache')), true);

  // Non-ok responses are never stored, whatever their headers say.
  assert.equal(isCacheable(new Response('', { status: 404 })), false);
  assert.equal(isCacheable(new Response('', { status: 500 })), false);
});

test('sw.js keeps the offline fallback for song requests', () => {
  const branch = swApiBranch(swSource);
  assert.match(branch, /url\.pathname === '\/api\/songs'/);
  assert.match(branch, /\/\^\\\/api\\\/songs\\\/\[\^\/\]\+\$\/\.test\(url\.pathname\)/);
  assert.match(branch, /\.catch\(\(\) => caches\.match\(request\)\)/);
});
