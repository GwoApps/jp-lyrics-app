import assert from 'node:assert/strict';
import test from 'node:test';
import { songMatchScore, isSameSpotifyTrack, findBestMatch, type SongCandidate } from './match.ts';

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

// ─── findBestMatch: evidence priority & owner/public interplay ────────

const ME = 'me@example.com';
const OTHER = 'other@example.com';

function song(partial: Partial<SongCandidate> & { id: string }): SongCandidate {
  return {
    title: '',
    artist: '',
    created_by: OTHER,
    is_public: 1,
    ...partial,
  };
}

test('findBestMatch: own fuzzy match loses to public exact Track ID', () => {
  const ownLegacy = song({
    id: 'own-legacy',
    title: 'Same Song Live',
    artist: 'Artist',
    created_by: ME,
    is_public: 0,
  });
  const publicExact = song({
    id: 'public-exact',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'track-exact',
  });
  const track = { id: 'track-exact', name: 'Same Song', artist: 'Artist' };
  const winner = findBestMatch([ownLegacy, publicExact], track, ME);
  assert.equal(winner?.id, 'public-exact');
});

test('findBestMatch: own exact Track ID wins over public fuzzy', () => {
  const ownExact = song({
    id: 'own-exact',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'track-exact',
    created_by: ME,
    is_public: 0,
  });
  const publicFuzzy = song({
    id: 'public-fuzzy',
    title: 'Same Song Live',
    artist: 'Artist',
  });
  const track = { id: 'track-exact', name: 'Same Song', artist: 'Artist' };
  const winner = findBestMatch([ownExact, publicFuzzy], track, ME);
  assert.equal(winner?.id, 'own-exact');
});

test('findBestMatch: both legacy without IDs — own song wins', () => {
  const ownLegacy = song({
    id: 'own-legacy',
    title: 'Same Song',
    artist: 'Artist',
    created_by: ME,
    is_public: 0,
  });
  const publicLegacy = song({
    id: 'public-legacy',
    title: 'Same Song',
    artist: 'Artist',
  });
  const track = { id: 'track-x', name: 'Same Song', artist: 'Artist' };
  const winner = findBestMatch([ownLegacy, publicLegacy], track, ME);
  assert.equal(winner?.id, 'own-legacy');
});

test('findBestMatch: public exact Track ID beats own exact when only public has the ID', () => {
  // Both have spotify_track_id but only public matches the track's ID.
  const ownMismatchedId = song({
    id: 'own-wrong-id',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'other-track',
    created_by: ME,
    is_public: 0,
  });
  const publicExact = song({
    id: 'public-exact',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'track-exact',
  });
  const track = { id: 'track-exact', name: 'Same Song', artist: 'Artist' };
  const winner = findBestMatch([ownMismatchedId, publicExact], track, ME);
  assert.equal(winner?.id, 'public-exact');
});

test('findBestMatch: non-public songs from other users are never matched', () => {
  const otherPrivate = song({
    id: 'other-private',
    title: 'Same Song',
    artist: 'Artist',
    created_by: OTHER,
    is_public: 0,
  });
  const track = { id: 'track-x', name: 'Same Song', artist: 'Artist' };
  assert.equal(findBestMatch([otherPrivate], track, ME), null);
});

test('findBestMatch: own exact Track ID beats public exact Track ID (own priority within same evidence tier)', () => {
  const ownExact = song({
    id: 'own-exact',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'track-exact',
    created_by: ME,
    is_public: 0,
  });
  const publicExact = song({
    id: 'public-exact',
    title: 'Same Song',
    artist: 'Artist',
    spotify_track_id: 'track-exact',
  });
  const track = { id: 'track-exact', name: 'Same Song', artist: 'Artist' };
  const winner = findBestMatch([ownExact, publicExact], track, ME);
  assert.equal(winner?.id, 'own-exact');
});

test('findBestMatch: returns null for no track', () => {
  const s = song({ id: 's1', title: 'X', artist: 'Y' });
  assert.equal(findBestMatch([s], null, ME), null);
});

test('findBestMatch: returns null when no song matches', () => {
  const s = song({ id: 's1', title: 'Completely Different', artist: 'Someone' });
  const track = { id: 'track-x', name: 'Same Song', artist: 'Artist' };
  assert.equal(findBestMatch([s], track, ME), null);
});
