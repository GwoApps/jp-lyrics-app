import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongsTable, createTestDb } from './test-db.ts';
import * as schema from './schema.ts';
import { summarizeSongLibraryContent, type SongLibrarySummary } from './song-library-summary.ts';

test('SQLite summary content handles legacy empty, malformed shapes, partial timelines and unknown language', async (t) => {
  const { db, client } = createTestDb(t, 'song-library-summary', schema);
  await createSongsTable(client);
  const cases: Array<{
    id: string;
    values: Partial<typeof schema.songs.$inferInsert>;
    expected: Partial<SongLibrarySummary>;
  }> = [
    { id: 'defaults', values: {}, expected: {} },
    { id: 'empty-strings', values: { lyricsFurigana: '', lyricsTranslation: '', lyricsRaw: '\u200b\n ' }, expected: {} },
    { id: 'wrong-json-type', values: { lyricsFurigana: '{}', lyricsTranslation: 'null' }, expected: { has_furigana: null, has_translation: null } },
    { id: 'bad-line', values: { lyricsFurigana: '[{"noSegments":true}]', lyricsTranslation: '[null]' }, expected: { has_furigana: null, has_translation: null } },
    { id: 'bad-segment', values: { lyricsFurigana: '[{"segments":[{"text":"漢字"}]}]' }, expected: { has_furigana: null } },
    { id: 'metadata-only', values: { lyricsSynced: '[ti:Title]\n[ar:Artist]\n[offset:100]' }, expected: {} },
    { id: 'zero-time', values: { lyricsSynced: '  [00:00.000]歌\nnot marked yet' }, expected: { has_synced_timeline: true } },
    { id: 'no-text', values: { lyricsSynced: '[00:01.000]' }, expected: {} },
    { id: 'invalid-tag', values: { lyricsSynced: '[broken]lyrics' }, expected: { has_synced_timeline: null } },
    { id: 'mixed-broken', values: { lyricsSynced: '[00:00]valid\n[00:99]broken' }, expected: { has_synced_timeline: null } },
    { id: 'translated-unknown', values: { lyricsTranslation: '["Translation"]' }, expected: { has_translation: true } },
    { id: 'translated-bad-lang', values: { lyricsTranslation: '["Translation"]', lyricsTranslationLang: '<script>' }, expected: { has_translation: true } },
    { id: 'translated-script', values: { lyricsTranslation: '["Translation"]', lyricsTranslationLang: 'ZH-hant-tw' }, expected: { has_translation: true, lyrics_translation_lang: 'zh-Hant-TW' } },
  ];
  await db.insert(schema.songs).values(cases.map(({ id, values }) => ({ id, title: id, ...values })));
  const rows = await db.select({
    id: schema.songs.id,
    spotify_duration_ms: schema.songs.spotifyDurationMs,
    lyrics_raw: schema.songs.lyricsRaw,
    lyrics_synced: schema.songs.lyricsSynced,
    lyrics_furigana: schema.songs.lyricsFurigana,
    lyrics_translation: schema.songs.lyricsTranslation,
    lyrics_translation_lang: schema.songs.lyricsTranslationLang,
  }).from(schema.songs);
  const empty: SongLibrarySummary = {
    spotify_duration_ms: null, has_lyrics: false, has_synced_timeline: false,
    has_furigana: false, has_translation: false, lyrics_translation_lang: null,
  };
  for (const row of rows) {
    const expected = cases.find((entry) => entry.id === row.id)?.expected;
    assert.ok(expected, `case ${row.id}`);
    assert.deepEqual(summarizeSongLibraryContent(row), { ...empty, ...expected }, row.id);
  }
});
