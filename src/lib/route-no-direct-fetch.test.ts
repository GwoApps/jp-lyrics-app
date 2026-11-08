/**
 * Route handlers must not talk HTTP themselves.
 *
 * `src/app/api/**` is the request/response boundary: it authenticates, parses
 * and shapes JSON, then delegates to a service in `src/lib` that owns the
 * upstream request. A raw `fetch()` (or `http`/`https`/`axios` request) inside a
 * route duplicates endpoint and header knowledge, and makes the transport
 * untestable — this guard keeps that boundary honest.
 *
 * Service-layer modules are free to call `fetch` — they take their parameters
 * from the caller and expose plain functions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const apiRoot = join(repoRoot, 'src', 'app', 'api');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return entry === 'route.ts' ? [full] : [];
  });
}

/** Strip comments and string/template literals so only real code is matched. */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
    } else if (char === '\'' || char === '"' || char === '`') {
      const quote = char;
      out += quote;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      out += quote;
      i += 1;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

const HTTP_CALLS = [
  [/\bfetch\s*\(/, 'fetch(...)'],
  [/\bhttps?\.(?:request|get)\s*\(/, 'http(s).request(...)'],
  [/\baxios\b/, 'axios'],
  [/\bundici\b/, 'undici'],
] as const;

test('api route handlers never request upstream HTTP directly', () => {
  const files = routeFiles(apiRoot);
  assert.ok(files.length > 40, `expected the api tree to be scanned, got ${files.length} files`);

  const offenders: string[] = [];
  for (const file of files) {
    const code = codeOnly(readFileSync(file, 'utf8'));
    for (const [pattern, label] of HTTP_CALLS) {
      if (pattern.test(code)) offenders.push(`${relative(repoRoot, file)} → ${label}`);
    }
  }
  assert.deepEqual(offenders, [], `route handlers must delegate HTTP to a service:\n${offenders.join('\n')}`);
});

test('the scan actually recognises a direct call, so the guard cannot pass vacuously', () => {
  const sample = codeOnly(`
    export async function GET() {
      const res = await fetch('https://api.spotify.com/v1/me');
      // fetch('/commented-out') must not count
      const label = 'fetch("/in a string")';
      return res;
    }
  `);
  assert.equal(HTTP_CALLS.filter(([pattern]) => pattern.test(sample)).length, 1);
});
