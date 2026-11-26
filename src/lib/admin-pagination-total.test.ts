/**
 * Cursor paging must not shrink the "filtered total" reported by admin list
 * endpoints (issue #444). Both routes build a page WHERE (filters + cursor)
 * and a COUNT WHERE (filters only); this suite executes the real route modules
 * against a fake DB so the two queries are observed exactly as they are sent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const drizzle = require('drizzle-orm') as { sql: (strings: TemplateStringsArray, ...params: unknown[]) => unknown };

type SqlObject = { toQuery: (options: Record<string, (value: string) => string>) => { sql: string; params: unknown[] } };

function renderSql(value: unknown): string {
  assert.ok(value && typeof value === 'object' && 'toQuery' in value, 'expected a drizzle SQL object');
  const { sql } = (value as SqlObject).toQuery({
    escapeName: (name) => name,
    escapeParam: () => '?',
    escapeString: (str) => `'${str.replaceAll("'", "''")}'`,
  });
  return sql;
}

function loadRoute(routePath: string) {
  const calls: { all: string[]; get: string[] } = { all: [], get: [] };
  let count = 93;
  const db = {
    all: async (query: unknown) => {
      calls.all.push(renderSql(query));
      // First page: limit+1 rows (one extra to signal hasMore). Later pages:
      // just one row, enough to obtain a continuation cursor.
      return Array.from({ length: calls.all.length === 1 ? 26 : 1 }, () => ({ id: 'row-1', updated_at: '2026-01-01', is_admin: 0, is_blocked: 0 }));
    },
    get: async (query: unknown) => {
      calls.get.push(renderSql(query));
      return { n: count-- };
    },
  };

  const exports: Record<string, (request: unknown) => Promise<Response>> = {};
  const code = ts.transpileModule(readFileSync(routePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  runInNewContext(code, {
    exports,
    console,
    process,
    btoa: (value: string) => Buffer.from(value).toString('base64'),
    atob: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    require: (name: string) => {
      if (name === 'next/server') {
        return {
          NextRequest: class {},
          NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
        };
      }
      if (name === 'drizzle-orm') return drizzle;
      if (name === '@/lib/db') return { getDB: () => db, sql: drizzle.sql };
      if (name === '@/lib/auth') return { getAuthUser: async () => ({ isAdmin: true }) };
      if (name === '@/lib/offline-identity') return { withOfflineIdentity: async (r: Response) => r };
      // Small helpers used by the songs route; the assertions below only care
      // about the SQL shape, so stable stubs are sufficient here.
      if (name === '@/lib/lyrics-export') return { parseFuriganaLines: () => [], parseTranslations: () => [] };
      if (name === '@/lib/lrc') return { getLrcTextLines: () => [] };
      if (name === '@/lib/admin') return { clampLimit: (v: string | null, fallback: number) => v ? Math.min(Math.max(Number(v) || fallback, 1), 50) : fallback };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  return { exports, calls };
}

function requestFor(path: string, cursor: string | null): unknown {
  const url = new URL(`http://localhost${path}`);
  url.searchParams.set('total', '1');
  url.searchParams.set('limit', '25');
  if (cursor) url.searchParams.set('cursor', cursor);
  return {
    nextUrl: url,
    cookies: { get: () => undefined },
  };
}

test('admin/songs total stays the filtered count on cursor pages (issue #444)', async () => {
  const route = loadRoute('src/app/api/admin/songs/route.ts');
  const first = await route.exports.GET(requestFor('/api/admin/songs?mode=content&sort=updated&order=desc', null));
  const firstData = await first.json() as { total: number; next_cursor: string | null };
  assert.equal(firstData.total, 93);
  assert.ok(firstData.next_cursor);

  const second = await route.exports.GET(requestFor('/api/admin/songs?mode=content&sort=updated&order=desc', firstData.next_cursor));
  const secondData = await second.json() as { total: number };
  assert.equal(secondData.total, 92, 'total must remain the filtered count, not the remaining rows after cursor');
  assert.equal(route.calls.get.length, 2);
  // Cursor changed the page query, but not the COUNT query.
  assert.notEqual(route.calls.all[0], route.calls.all[1]);
  assert.equal(route.calls.get[0], route.calls.get[1]);
  assert.ok(!route.calls.get[0].includes('id >'), 'COUNT must not include the cursor predicate');
});

test('admin/users total stays the filtered count on cursor pages (issue #444)', async () => {
  const route = loadRoute('src/app/api/admin/users/route.ts');
  const first = await route.exports.GET(requestFor('/api/admin/users', null));
  const firstData = await first.json() as { total: number; next_cursor: string | null };
  assert.equal(firstData.total, 93);
  assert.ok(firstData.next_cursor);

  const second = await route.exports.GET(requestFor('/api/admin/users', firstData.next_cursor));
  const secondData = await second.json() as { total: number };
  assert.equal(secondData.total, 92);
  assert.notEqual(route.calls.all[0], route.calls.all[1]);
  assert.equal(route.calls.get[0], route.calls.get[1]);
  assert.ok(!route.calls.get[0].includes('u.updated_at <'), 'COUNT must not include the cursor predicate');
});
