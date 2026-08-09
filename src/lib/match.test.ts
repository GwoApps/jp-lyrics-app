import assert from 'node:assert/strict';
import test from 'node:test';
import { songMatchScore, isSameSpotifyTrack } from './match.ts';

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

test('same title but different Track ID is not the same song', () => {
  const song = { id: 'song', title: 'Same Song', artist: 'Artist', spotify_track_id: 'track-a' };
  const track = { id: 'track-b', name: 'Same Song', artist: 'Artist' };
  assert.equal(songMatchScore(song, track), 0);
  assert.equal(isSameSpotifyTrack(song, track), false);
});

test('same title but clearly different artist is not the same song (cover / remix / homonym)', () => {
  const song = { id: 'song', title: 'Same Song', artist: 'Artist A' };
  const track = { id: 'track-x', name: 'Same Song', artist: 'Artist B' };
  assert.equal(songMatchScore(song, track), 0);
  assert.equal(isSameSpotifyTrack(song, track), false);
});

test('same title and matching artist without Track IDs is the same song', () => {
  const song = { id: 'song', title: 'Same Song', artist: 'Artist' };
  const track = { id: 'track-x', name: 'Same Song', artist: 'Artist' };
  assert.ok(songMatchScore(song, track) >= 0.5);
  assert.equal(isSameSpotifyTrack(song, track), true);
});

test('isSameSpotifyTrack returns false for null/undefined track', () => {
  const song = { id: 'song', title: 'Same Song', artist: 'Artist' };
  assert.equal(isSameSpotifyTrack(song, null), false);
  assert.equal(isSameSpotifyTrack(song, undefined), false);
});
