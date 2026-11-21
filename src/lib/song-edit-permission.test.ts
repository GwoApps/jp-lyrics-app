/**
 * Issue #462 — GET /api/songs must send a per-row boolean edit permission so
 * the home list never shows a delete button the DELETE ACL would reject.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const drizzle = require('drizzle-orm') as typeof import('drizzle-orm');
const source = readFileSync(new URL('../app/api/songs/route.ts', import.meta.url), 'utf8');

function loadRoute(rows: Record<string, unknown>[]) {
  let query = '';
  const db = {
    all: (sqlObject: unknown) => {
      const rendered = (sqlObject as { toQuery: (options: Record<string, (value: string) => string>) => { sql: string } }).toQuery({
        escapeName: (name) => name,
        escapeParam: () => '?',
        escapeString: (value) => `'${value.replaceAll("'", "''")}'`,
      });
      query = rendered.sql;
      return Promise.resolve(rows);
    },
  };
  return { db, getQuery: () => query };
}

async function getSongs(
  rows: Record<string, unknown>[],
  user: { email: string; isAdmin: boolean } | null,
  path = '/api/songs',
) {
  const fake = loadRoute(rows);
  const exports: { GET?: (request: unknown) => Promise<Response> } = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports,
    console,
    process,
    require: (name: string) => {
      if (name === 'next/server') {
        return {
          NextRequest: class {},
          NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
        };
      }
      if (name === 'drizzle-orm') return drizzle;
      if (name === '@/lib/db') return { getDB: () => fake.db, schema: { songs: {}, spotifyAuth: {} }, sql: drizzle.sql, and: drizzle.and };
      if (name === '@/lib/auth') return { getAuthUser: async () => user };
      if (name === '@/lib/song-visibility') return { songVisibilityWhere: () => drizzle.sql`1 = 1`, SONGS_S_COLUMNS: {} };
      if (name === '@/lib/lrc') return { parseLrc: () => [], findLrcConflicts: () => [] };
      if (name === '@/lib/admin') return { parseJsonBody: () => ({}) };
      if (name === '@/lib/spotify') return { getSpotifyTrack: async () => null };
      if (name === '@/lib/lyrics-content') return { normalizeLyricsEol: (value: string) => value };
      return require(name);
    },
  });
  const url = new URL(`http://localhost${path}`);
  const response = await exports.GET!({ nextUrl: url });
  return { response, body: await response.json() as Record<string, unknown>[], query: fake.getQuery() };
}

const row = { id: 'song-1', title: 'Song', artist: 'Artist', created_by: 'owner@example.test' };

test('GET /api/songs returns a boolean can_edit per row', async () => {
  const { body, response, query } = await getSongs(
    [{ ...row, can_edit: 1 }, { ...row, id: 'song-2', can_edit: 0 }],
    { email: 'owner@example.test', isAdmin: false },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body.map((song) => song.can_edit), [true, false]);
  assert.match(query, /CASE WHEN/);
  assert.match(query, /s\.created_by = \?/);
});

test('admin is allowed to edit every list row', async () => {
  const { query } = await getSongs([{ ...row, can_edit: 1 }], { email: 'admin@example.test', isAdmin: true });
  assert.match(query, /1 = 1 OR s\.created_by = \?/);
});

test('anonymous viewers never edit any row', async () => {
  const { body, query } = await getSongs([{ ...row, can_edit: 0 }], null, '/api/songs?q=public');
  assert.deepEqual(body.map((song) => song.can_edit), [false]);
  assert.doesNotMatch(query, /s\.created_by = \?/);
});

test('the favorites branch applies the same permission to each row', async () => {
  const { body } = await getSongs(
    [{ ...row, can_edit: 1 }],
    { email: 'owner@example.test', isAdmin: false },
    '/api/songs?favorites=1',
  );
  assert.deepEqual(body.map((song) => song.can_edit), [true]);
});
