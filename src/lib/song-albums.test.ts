import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSongsByAlbum } from './song-albums.ts';

test('groups Spotify albums by album and artist while keeping unclassified songs together', () => {
  const groups = groupSongsByAlbum([
    { id: 'one', title: 'Song One', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'two', title: 'Song Two', artist: 'Artist B', spotify_album: 'Shared Album' },
    { id: 'three', title: 'Song Three', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'four', title: 'Song Four', artist: 'Artist C', spotify_album: null },
    { id: 'five', title: 'Song Five', artist: 'Artist D', spotify_album: '' },
  ]);

  assert.deepEqual(groups.map((group) => ({ album: group.album, artist: group.artist, ids: group.songs.map((song) => song.id) })), [
    { album: 'Shared Album', artist: 'Artist A', ids: ['one', 'three'] },
    { album: 'Shared Album', artist: 'Artist B', ids: ['two'] },
    { album: null, artist: null, ids: ['four', 'five'] },
  ]);
});

test('skips albums whose only track title matches the album title', () => {
  const groups = groupSongsByAlbum([
    { id: 'single', title: 'Same Title', artist: 'Artist A', spotify_album: 'Same Title' },
    { id: 'one', title: 'Song One', artist: 'Artist B', spotify_album: 'Real Album' },
    { id: 'two', title: 'Song Two', artist: 'Artist B', spotify_album: 'Real Album' },
  ]);

  assert.deepEqual(groups.map((group) => ({ album: group.album, ids: group.songs.map((song) => song.id) })), [
    { album: 'Real Album', ids: ['one', 'two'] },
    { album: null, ids: ['single'] },
  ]);
});

test('keeps a group when the album title matches only one of several track titles', () => {
  const groups = groupSongsByAlbum([
    { id: 'one', title: 'Same Title', artist: 'Artist A', spotify_album: 'Same Title' },
    { id: 'two', title: 'Different Song', artist: 'Artist A', spotify_album: 'Same Title' },
  ]);

  assert.deepEqual(groups.map((group) => ({ album: group.album, ids: group.songs.map((song) => song.id) })), [
    { album: 'Same Title', ids: ['one', 'two'] },
  ]);
});
