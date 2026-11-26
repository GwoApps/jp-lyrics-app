import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLibraryExport,
  libraryExportFilename,
  LIBRARY_EXPORT_VERSION,
  toLibraryExportSong,
} from './library-export.ts';

const FIXED_NOW = new Date('2026-11-27T01:23:45.000Z');

const ROW = {
  id: 'song-1',
  title: '残酷な天使のテーゼ',
  artist: '高橋洋子',
  lyrics_raw: '線1\n線2',
  lyrics_furigana: JSON.stringify([
    { segments: [{ text: '残酷', reading: 'ざんこく', pos: '名詞' }, { text: 'な' }] },
    { segments: [] },
  ]),
  reading_scheme: 'ja-kana',
  lyrics_synced: '[00:01.00]line1\n[00:03.00]line2',
  lyrics_translation: JSON.stringify(['残忍的天使', '']),
  lyrics_translation_lang: 'zh-CN',
  lyrics_glossary: JSON.stringify([{ original: 'テーゼ', translation: '命题', manual: true }]),
  lyrics_source: 'manual',
  lyrics_confidence: 100,
  lyrics_fetched_at: '2026-01-01T00:00:00.000Z',
  spotify_track_id: 'spotify-1',
  spotify_album: 'album',
  spotify_duration_ms: 300000,
  created_by: 'private@example.com',
  created_by_name: 'Private',
  is_public: 0,
  public_requested: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
};

test('the backup has a version tag, timestamp, song count and stable format name', () => {
  const payload = buildLibraryExport([ROW], FIXED_NOW);
  assert.equal(payload.format, 'jp-lyrics-library');
  assert.equal(payload.version, LIBRARY_EXPORT_VERSION);
  assert.equal(payload.exported_at, '2026-11-27T01:23:45.000Z');
  assert.equal(payload.song_count, 1);
  assert.equal(payload.songs.length, 1);
});

test('every song keeps furigana, translation, timeline and glossary', () => {
  const song = buildLibraryExport([ROW], FIXED_NOW).songs[0]!;
  assert.equal(song.id, 'song-1');
  assert.equal(song.lyrics, '線1\n線2');
  assert.equal(song.furigana.length, 2);
  assert.deepEqual(song.furigana[0]!.segments[0], { text: '残酷', reading: 'ざんこく', pos: '名詞' });
  assert.deepEqual(song.translation, ['残忍的天使', '']);
  assert.equal(song.synced_lyrics, ROW.lyrics_synced);
  assert.equal(song.translation_lang, 'zh-CN');
  assert.deepEqual(song.glossary, [{ original: 'テーゼ', translation: '命题', manual: true }]);
  assert.equal(song.metadata.lyrics_source, 'manual');
  assert.equal(song.metadata.spotify_duration_ms, 300000);
});

test('ownership and private/public fields are never exported', () => {
  const json = JSON.stringify(buildLibraryExport([ROW], FIXED_NOW));
  for (const field of ['created_by', 'created_by_name', 'is_public', 'public_requested', 'private@example.com']) {
    assert.equal(json.includes(field), false, `${field} must not leak into a backup`);
  }
});

test('corrupt or empty JSON columns degrade to empty arrays without throwing', () => {
  const damaged = toLibraryExportSong({
    ...ROW,
    lyrics_furigana: '{not json',
    lyrics_translation: '"not-an-array"',
    lyrics_glossary: 'null',
    lyrics_confidence: 'NaN-ish',
    spotify_duration_ms: null,
  });
  assert.deepEqual(damaged.furigana, []);
  assert.deepEqual(damaged.translation, []);
  assert.deepEqual(damaged.glossary, []);
  assert.equal(damaged.metadata.lyrics_confidence, 100);
  assert.equal(damaged.metadata.spotify_duration_ms, null);
});

test('translation entries stay index-aligned to the lyrics (non-strings become empty)', () => {
  const song = toLibraryExportSong({
    ...ROW,
    lyrics_translation: JSON.stringify(['one', 42, null, 'four']),
  });
  assert.deepEqual(song.translation, ['one', '', '', 'four']);
});

test('backup filename is dated and downloadable', () => {
  assert.equal(libraryExportFilename(FIXED_NOW), 'lyrics-backup-2026-11-27.json');
});
