import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './test-db.ts';
import {
  ensureSongTranslations,
  readSongTranslation,
  listSongTranslationLangs,
  writeSongTranslation,
  clearSongTranslations,
} from './song-translations.ts';

const LEGACY = {
  lyrics_translation: '["一","二"]',
  lyrics_translation_lang: 'zh-CN',
  lyrics_translation_reasoning: '思考',
};

test('ISSUE #485 — backfill keeps legacy cache and per-language rows coexist', async (t) => {
  const db = await createTestDb(t, 'song-translations', {});
  await db.client.execute(`CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    lyrics_translation TEXT NOT NULL DEFAULT '[]',
    lyrics_translation_lang TEXT,
    lyrics_translation_reasoning TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  await db.client.execute({
    sql: `INSERT INTO songs (id, lyrics_translation, lyrics_translation_lang, lyrics_translation_reasoning)
          VALUES ('s1', ?, ?, ?)`,
    args: [LEGACY.lyrics_translation, LEGACY.lyrics_translation_lang, LEGACY.lyrics_translation_reasoning],
  });

  await ensureSongTranslations(db.db);
  // A second call is a no-op and must not duplicate rows.
  await ensureSongTranslations(db.db);

  const zh = await readSongTranslation(db.db, 's1', 'zh-CN', LEGACY);
  assert.deepEqual(zh, { lines: '["一","二"]', reasoning: '思考' });

  await writeSongTranslation(db.db, {
    songId: 's1', lang: 'en-US', lines: '["one","two"]', reasoning: 'reasoning',
  });

  const en = await readSongTranslation(db.db, 's1', 'en-US', LEGACY);
  assert.deepEqual(en, { lines: '["one","two"]', reasoning: 'reasoning' });
  // The original language survived the switch.
  assert.deepEqual(await readSongTranslation(db.db, 's1', 'zh-CN', LEGACY), zh);
  assert.deepEqual((await listSongTranslationLangs(db.db, 's1', LEGACY)).sort(), ['en-US', 'zh-CN']);

  await clearSongTranslations(db.db, 's1');
  assert.deepEqual(await listSongTranslationLangs(db.db, 's1', LEGACY), ['zh-CN']);
});

test('ISSUE #485 — unrecorded legacy cache is readable under the default tag', async (t) => {
  const db = await createTestDb(t, 'song-translations-legacy', {});
  await db.client.execute(`CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    lyrics_translation TEXT NOT NULL DEFAULT '[]',
    lyrics_translation_lang TEXT,
    lyrics_translation_reasoning TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  await db.client.execute({
    sql: `INSERT INTO songs (id, lyrics_translation) VALUES ('s2', ?)`,
    args: ['["默认"]'],
  });
  await ensureSongTranslations(db.db);
  assert.deepEqual(
    await readSongTranslation(db.db, 's2', 'zh-CN', {
      lyrics_translation: '["默认"]',
      lyrics_translation_lang: null,
    }),
    { lines: '["默认"]', reasoning: null },
  );
  assert.equal(await readSongTranslation(db.db, 's2', 'en-US', {}), null);
});
