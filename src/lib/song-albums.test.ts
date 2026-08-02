import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSongsByAlbum } from './song-albums.ts';

test('groups Spotify albums by album and artist while keeping unclassified songs together', () => {
  const groups = groupSongsByAlbum([
    { id: 'one', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'two', artist: 'Artist B', spotify_album: 'Shared Album' },
    { id: 'three', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'four', artist: 'Artist C', spotify_album: null },
    { id: 'five', artist: 'Artist D', spotify_album: '' },
  ]);

  assert.deepEqual(groups.map((group) => ({ album: group.album, artist: group.artist, ids: group.songs.map((song) => song.id) })), [
    { album: 'Shared Album', artist: 'Artist A', ids: ['one', 'three'] },
    { album: 'Shared Album', artist: 'Artist B', ids: ['two'] },
    { album: null, artist: null, ids: ['four', 'five'] },
  ]);
});
