import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLibraryView, filterArtistSongs, groupMatchingAlbums, formatTranslationLanguage, formatSongDuration, formatSongDate, spotifyTrackHref, readFavoriteStatus, type ArtistLibrarySong } from './artist-library-model.ts';
import { groupArtistAlbums } from '@/lib/artists';

const makeSong = (id: string, extras: Partial<ArtistLibrarySong> = {}): ArtistLibrarySong => ({ id, title: id, artist: 'Aimer', spotify_album: 'Album', created_by: 'test', created_by_name: 'Test', is_public: 1, public_requested: 0, created_at: '2026-01-01', updated_at: '2026-01-02', ...extras });
const songs = [
  makeSong('b', { title: 'Blue Moon', artist: 'Aimer, Guest', spotify_album: 'Night', has_lyrics: true, has_synced_timeline: true, has_furigana: false, has_translation: null, lyrics_needs_review: 1, created_at: '2026-01-03' }),
  makeSong('a', { title: 'Amber', has_lyrics: false, has_synced_timeline: false, has_furigana: true, has_translation: true, updated_at: '2026-01-04' }),
  makeSong('c', { title: 'Cloud', has_lyrics: null, has_synced_timeline: null, has_furigana: null, has_translation: false, created_at: 'invalid', updated_at: 'invalid' }),
  makeSong('d', { title: 'Dawn', artist: 'Aimer, aimer', has_lyrics: undefined }),
];
const ids = (items: ArtistLibrarySong[]) => items.map((song) => song.id);

test('SQLite local wall-clock dates are not shifted into a fabricated next day', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try { assert.equal(formatSongDate('2026-11-02 16:25:33', 'en'), 'Nov 2, 2026'); }
  finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('mixed SQLite and ISO ordering is deterministic across browser time zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      const mixed = [makeSong('sqlite', { created_at: '2026-01-02 00:30:00' }), makeSong('iso', { created_at: '2026-01-01T20:00:00Z' })];
      assert.deepEqual(ids(filterArtistSongs(mixed, { ...defaultLibraryView(), sort: 'created' }, 'en')), ['sqlite', 'iso']);
      assert.equal(formatSongDate('2026-01-02', 'en'), 'Jan 2, 2026');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('translation language uses the stored tag, never the UI locale or an invented default', () => {
  assert.match(formatTranslationLanguage('en-US', 'en') ?? '', /English/);
  assert.equal(formatTranslationLanguage(null, 'ja'), null);
  assert.equal(formatTranslationLanguage('not_a_language', 'zh-CN'), null);
});

test('query searches title, album and full artist credits with normalized multiword terms', () => {
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), query: ' ＢＬＵＥ  guest ' }, 'en')), ['b']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), query: 'night' }, 'en')), ['b']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), query: 'not found' }, 'en')), []);
});

test('credit and review filters are independent and reuse canonical comma-separated credits', () => {
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), credit: 'solo' }, 'en')), ['a', 'c', 'd']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), credit: 'collab', review: 'needsReview' }, 'en')), ['b']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), credit: 'solo', review: 'needsReview' }, 'en')), []);
});

for (const [field, present, absent, unknown] of [
  ['lyrics', ['b'], ['a'], ['c', 'd']], ['timeline', ['b'], ['a'], ['c', 'd']],
  ['furigana', ['a'], ['b'], ['c', 'd']], ['translation', ['a'], ['c'], ['b', 'd']],
] as const) test(`${field} filters never treat missing/null flags as known absence`, () => {
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), [field]: 'available' }, 'en')), [...present]);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), [field]: 'missing' }, 'en')), [...absent]);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), [field]: 'unknown' }, 'en')), [...unknown]);
});

test('sort is locale-aware, deterministic, newest first for dates, invalid dates last, and non-mutating', () => {
  assert.deepEqual(ids(filterArtistSongs(songs, defaultLibraryView(), 'en')), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), sort: 'created' }, 'en')), ['b', 'a', 'd', 'c']);
  assert.deepEqual(ids(filterArtistSongs(songs, { ...defaultLibraryView(), sort: 'updated' }, 'en')), ['a', 'b', 'd', 'c']);
  assert.deepEqual(ids(songs), ['b', 'a', 'c', 'd']);
  const ties = [makeSong('z', { title: 'Same' }), makeSong('a', { title: 'Same' })];
  assert.deepEqual(ids(filterArtistSongs(ties, defaultLibraryView(), 'en')), ['a', 'z']);
});

test('filtered album groups come from matching songs, preserve grouping, and never truncate the full scope', () => {
  const all = Array.from({ length: 307 }, (_, i) => makeSong(String(i), { spotify_album: i % 2 ? 'Album' : 'ALBUM', artist: i % 2 ? 'Aimer' : 'Aimer, Guest' }));
  assert.equal(filterArtistSongs(all, defaultLibraryView(), 'en').length, 307);
  const matched = filterArtistSongs(all, { ...defaultLibraryView(), credit: 'collab' }, 'en');
  const albums = groupArtistAlbums(matched);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].songs.length, 154);
  assert.equal(all.length, 307);
  assert.equal(defaultLibraryView().credit, 'all');
});

test('album sorting follows title or newest matching song dates while keeping canonical groups and their song order', () => {
  const all = [
    makeSong('first', { spotify_album: 'Album 2', created_at: '2026-01-03', updated_at: '2026-01-01' }),
    makeSong('second', { spotify_album: 'ALBUM 2', created_at: '2026-01-02', updated_at: '2026-01-02' }),
    makeSong('third', { spotify_album: 'Album 10', created_at: '2026-01-01', updated_at: '2026-01-05' }),
    makeSong('fourth', { spotify_album: 'Unknown', created_at: 'bad', updated_at: 'bad' }),
  ];
  assert.deepEqual(groupMatchingAlbums(all, 'name', 'en').map((album) => album.key), ['album 2', 'album 10', 'unknown']);
  assert.deepEqual(groupMatchingAlbums(all, 'created', 'en').map((album) => album.key), ['album 2', 'album 10', 'unknown']);
  assert.deepEqual(groupMatchingAlbums(all, 'updated', 'en').map((album) => album.key), ['album 10', 'album 2', 'unknown']);
  assert.deepEqual(ids(groupMatchingAlbums(all, 'updated', 'en')[1].songs), ['first', 'second']);
});

test('unknown duration/date stay unknown; valid metadata uses Intl localized numbers and dates', () => {
  for (const value of [null, undefined, 0, -10, Infinity, NaN, 1.5]) assert.equal(formatSongDuration(value, 'en'), null);
  assert.equal(formatSongDuration(185000, 'en'), '3:05');
  assert.equal(formatSongDuration(3601000, 'en'), '1:00:01');
  assert.match(formatSongDuration(185000, 'ar-u-nu-arab')!, /٣:٠٥/);
  assert.equal(formatSongDate('invalid', 'en'), null);
  assert.equal(formatSongDate(undefined, 'ja'), null);
  assert.match(formatSongDate('2026-01-02T12:00:00Z', 'en')!, /2026/);
});

test('Spotify links are derived only from an exact valid track id', () => {
  const id = '0123456789ABCDEFGHIJKL';
  assert.equal(spotifyTrackHref(id), `https://open.spotify.com/track/${id}`);
  for (const bad of ['', 'spotify:track:' + id, 'https://evil.test', id + '/', ' ' + id, 'a'.repeat(23), null, undefined]) assert.equal(spotifyTrackHref(bad), null);
});

test('favorite readback is on demand, no-store and validates current-user responses including 401', async () => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init]);
    return new Response(JSON.stringify({ favorited: true }), { status: 200 });
  }) as typeof fetch;
  assert.equal(await readFavoriteStatus('song/one', fetcher), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/songs/song%2Fone/favorite');
  assert.equal(calls[0][1]?.cache, 'no-store');
  for (const [status, body, error] of [[401, {}, 'login_required'], [500, {}, 'favorite_read_failed'], [200, { favorited: null }, 'favorite_read_failed']] as const) {
    await assert.rejects(readFavoriteStatus('x', (async () => new Response(JSON.stringify(body), { status })) as typeof fetch), new RegExp(error));
  }
});
