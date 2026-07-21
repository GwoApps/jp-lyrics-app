import assert from 'node:assert/strict';
import test from 'node:test';
import { songMatchScore } from './match.ts';

test('Spotify Track ID is authoritative when both sides have one', () => {
  const song = { id: 'song', title: 'Same Song', artist: 'Artist', spotify_track_id: 'track-a' };
  assert.equal(songMatchScore(song, { id: 'track-a', name: 'Different Label', artist: 'Other' }), 1);
  assert.equal(songMatchScore(song, { id: 'track-b', name: 'Same Song', artist: 'Artist' }), 0);
});

test('legacy songs without a Track ID still use metadata matching', () => {
  assert.ok(songMatchScore(
    { id: 'song', title: 'Same Song', artist: 'Artist' },
    { id: 'track-a', name: 'Same Song', artist: 'Artist' },
  ) > 0);
});
