/**
 * PUT /api/songs/[id] accepts a hand-edited terminology table (issue #341).
 *
 * The column is injected into the system prompt of every later translation, so
 * the write path must reject anything unbounded or contradictory, and must pass
 * an accepted table straight through to the UPDATE set (winning over the
 * lyrics-change invalidation in the same request).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { applyManualPins, validateGlossaryInput } from './lyrics-glossary.ts';

const ROUTE = 'src/app/api/songs/[id]/route.ts';
const EXISTING_ROW = {
  id: 'song-1',
  title: 'T',
  artist: 'A',
  lyrics_raw: 'line one',
  lyrics_furigana: '[]',
  reading_scheme: 'ja-kana',
  reading_scheme_confirmed: 1,
  lyrics_synced: '',
  lyrics_translation: '[]',
  lyrics_translation_lang: null,
  lyrics_translation_reasoning: null,
  lyrics_glossary: null,
  cover_url: null,
  cover_palette: null,
  spotify_track_id: null,
  spotify_uri: null,
  spotify_album: null,
  spotify_duration_ms: null,
  spotify_canonical_title: null,
  spotify_canonical_artist: null,
  lyrics_source: 'manual',
  lyrics_confidence: 100,
  lyrics_needs_review: 0,
  lyrics_fetched_at: null,
  created_by: 'user-1',
  created_by_name: 'U',
  is_public: 0,
  public_requested: 0,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
};

/** Load the PUT handler with a recording fake DB. */
function loadPut() {
  const exports: { PUT?: (request: unknown, ctx: unknown) => Promise<Response> } = {};
  const writes: Record<string, unknown>[] = [];
  const row = { ...EXISTING_ROW };

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    get: async () => row,
  };
  const db = {
    select: () => selectChain,
    update: () => ({
      set: (set: Record<string, unknown>) => {
        writes.push(set);
        return {
          where: () => ({
            returning: () => ({
              // A guarded UPDATE reports a matched row; a plain one does too.
              get: async () => ({ id: row.id }),
            }),
          }),
        };
      },
    }),
  };

  const column = (name: string) => ({ __column: name, name });
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
      if (name === '@/lib/db') return { getDB: () => db, schema: { songs: new Proxy({}, { get: (_t, key) => column(String(key)) }) } };
      if (name === 'drizzle-orm') return { and: () => ({}), eq: () => ({}) };
      if (name === '@/lib/auth') return { getAuthUser: async () => ({ id: 'user-1', isAdmin: false }) };
      if (name === '@/lib/song-visibility') return { isSongVisibleToUser: () => true };
      if (name === '@/lib/lrc') return { findLrcConflicts: () => [], resolveTimelineSave: () => ({ ok: true }) };
      if (name === '@/lib/song-update') return { buildSongUpdateSet: (existing: unknown, body: Record<string, unknown>) => ({ __body: body, existing }) };
      if (name === '@/lib/lyrics-glossary') return { validateGlossaryInput, applyManualPins };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  return {
    writes,
    put: (body: Record<string, unknown>) => exports.PUT!(
      { json: async () => body },
      { params: Promise.resolve({ id: EXISTING_ROW.id }) },
    ),
  };
}

test('a valid terminology table is validated and reaches the update set', async () => {
  const route = loadPut();
  const res = await route.put({ lyrics_glossary: [{ original: ' 花火 ', translation: ' 烟花 ' }] });
  assert.equal(res.status, 200);
  const set = route.writes[0] as { __body?: { lyrics_glossary?: unknown } };
  // Trimmed, and pinned because the stored table was empty (a new term is the
  // user's own entry and survives a later lyrics edit).
  assert.deepEqual(set.__body?.lyrics_glossary, [{ original: '花火', translation: '烟花', manual: true }]);
});

test('invalid terminology tables are rejected before any write', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ lyrics_glossary: '花火=烟花' }, 'invalid_glossary'],
    [{ lyrics_glossary: [{ original: '花火' }] }, 'glossary_entry_invalid'],
    [{ lyrics_glossary: [{ original: '', translation: 'x' }] }, 'glossary_entry_invalid'],
    [{ lyrics_glossary: [{ original: '花火', translation: '烟花' }, { original: '花火', translation: '焰火' }] }, 'glossary_duplicate'],
    [{ lyrics_glossary: [{ original: 'a'.repeat(201), translation: 'x' }] }, 'glossary_entry_too_long'],
    [{ lyrics_glossary: Array.from({ length: 21 }, (_, i) => ({ original: `t${i}`, translation: `x${i}` })) }, 'glossary_too_long'],
  ];
  for (const [body, error] of cases) {
    const route = loadPut();
    const res = await route.put(body);
    assert.equal(res.status, 400, error);
    assert.deepEqual(await res.json(), { error });
    assert.equal(route.writes.length, 0, `${error} must not write`);
  }
});

test('explicit null clears the table', async () => {
  const route = loadPut();
  const res = await route.put({ lyrics_glossary: null });
  assert.equal(res.status, 200);
  const set = route.writes[0] as { __body?: { lyrics_glossary?: unknown } };
  assert.equal(set.__body?.lyrics_glossary, null);
});
