import test from 'node:test';
import assert from 'node:assert/strict';
import { findCachedSong } from './song-list-cache.ts';

test('findCachedSong returns list metadata for an exact song id', () => {
  const song = findCachedSong([
    { id: 'song-a', title: 'First Song', artist: 'First Artist', cover_url: 'https://example.test/a.jpg' },
    { id: 'song-b', title: 'Second Song', artist: 'Second Artist' },
  ], 'song-b');

  assert.deepEqual(song, { id: 'song-b', title: 'Second Song', artist: 'Second Artist' });
});

test('findCachedSong returns null for absent or unavailable list data', () => {
  assert.equal(findCachedSong(null, 'song-a'), null);
  assert.equal(findCachedSong([{ id: 'song-a', title: 'First Song', artist: 'First Artist' }], 'song-missing'), null);
});
