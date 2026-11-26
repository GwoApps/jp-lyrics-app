/**
 * GET /api/admin/export (ISSUE #471) — full-library JSON backup.
 *
 * Admin-only, no-store, no ownership fields, and the whole song table is
 * serialized (not just one page). The route's imports are faked so this stays
 * a unit test of the HTTP boundary.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as libraryExport from './library-export.ts';

const ROUTE = 'src/app/api/admin/export/route.ts';

const ROWS = Array.from({ length: 3 }, (_, i) => ({
  id: `song-${i}`,
  title: `Song ${i}`,
  artist: 'Artist',
  lyrics_raw: `line ${i}`,
  lyrics_furigana: '[]',
  reading_scheme: 'ja-kana',
  lyrics_synced: '',
  lyrics_translation: '[]',
  lyrics_translation_lang: null,
  lyrics_glossary: null,
  lyrics_source: 'manual',
  lyrics_confidence: 100,
  lyrics_fetched_at: null,
  spotify_track_id: null,
  spotify_album: null,
  spotify_duration_ms: null,
  created_by: 'owner@example.com',
  created_by_name: 'Owner',
  is_public: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}));

function loadGet(options: { isAdmin?: boolean } = {}) {
  const exports: { GET?: (request: unknown) => Promise<Response> } = {};
  const code = ts.transpileModule(readFileSync(ROUTE, 'utf8'), {
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
          NextResponse: {
            json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
          },
        };
      }
      if (name === '@/lib/db') {
        return {
          getDB: () => ({ all: async () => ROWS }),
          sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        };
      }
      if (name === '@/lib/auth') {
        return { getAuthUser: async () => (options.isAdmin === false ? null : { isAdmin: true }) };
      }
      if (name === '@/lib/library-export') {
        // Exercise the real builder by loading it as a sibling module.
        return libraryExport;
      }
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { get: () => exports.GET!({ headers: { get: () => null } }) };
}

test('only admins can download the full-library backup', async () => {
  const res = await loadGet({ isAdmin: false }).get();
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'forbidden' });
});

test('the backup contains every song and is marked private / no-store', async () => {
  const res = await loadGet().get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.match(res.headers.get('Content-Disposition') ?? '', /filename\*=UTF-8''lyrics-backup-\d{4}-\d{2}-\d{2}\.json/);

  const body = await res.json() as { format: string; version: number; song_count: number; songs: unknown[] };
  assert.equal(body.format, 'jp-lyrics-library');
  assert.equal(body.song_count, 3);
  assert.equal(body.songs.length, 3);
  assert.equal(JSON.stringify(body).includes('owner@example.com'), false);
});
