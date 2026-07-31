import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNewSongUrl, readSongPrefill } from './song-prefill.ts';

test('buildNewSongUrl preserves Spotify metadata for manual creation', () => {
  const url = buildNewSongUrl({
    title: 'アイドル / Live',
    artist: 'YOASOBI & Guest',
    spotifyTrackId: 'track-123',
    spotifyUri: 'spotify:track:track-123',
    spotifyAlbum: 'Album Name',
    spotifyDurationMs: 212345.4,
    coverUrl: 'https://i.scdn.co/image/example?size=large',
  });
  const query = new URL(url, 'https://example.test').searchParams;
  assert.deepEqual(readSongPrefill(query), {
    title: 'アイドル / Live',
    artist: 'YOASOBI & Guest',
    spotifyTrackId: 'track-123',
    spotifyUri: 'spotify:track:track-123',
    spotifyAlbum: 'Album Name',
    spotifyDurationMs: 212345,
    coverUrl: 'https://i.scdn.co/image/example?size=large',
  });
});

test('readSongPrefill ignores empty metadata and invalid duration', () => {
  const params = new URLSearchParams('title=Song&artist=&spotify_duration_ms=invalid');
  assert.deepEqual(readSongPrefill(params), {
    title: 'Song',
    artist: '',
    spotifyTrackId: undefined,
    spotifyUri: undefined,
    spotifyAlbum: undefined,
    spotifyDurationMs: undefined,
    coverUrl: undefined,
  });
});
