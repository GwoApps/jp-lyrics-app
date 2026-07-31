import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManualCreateUrl, buildNewSongUrl, readSongPrefill } from './song-prefill.ts';

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

test('buildManualCreateUrl only accepts server-provided lyrics-not-found metadata', () => {
  assert.equal(buildManualCreateUrl({ error: 'network_error' }), undefined);
  assert.equal(buildManualCreateUrl({ error: 'lyrics_not_found' }), undefined);
  const url = buildManualCreateUrl({
    error: 'lyrics_not_found',
    manual_create: {
      title: 'Server Canonical Title',
      artist: 'Server Artist',
      spotify_track_id: '4uLU6hMCjMI75M1A2tKUQC',
      spotify_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
      spotify_album: 'Server Album',
      spotify_duration_ms: 213573,
      cover_url: 'https://i.scdn.co/image/server',
    },
  });
  assert.ok(url);
  const params = new URL(url, 'https://example.test').searchParams;
  assert.equal(params.get('title'), 'Server Canonical Title');
  assert.equal(params.get('artist'), 'Server Artist');
  assert.equal(params.get('spotify_track_id'), '4uLU6hMCjMI75M1A2tKUQC');
});
