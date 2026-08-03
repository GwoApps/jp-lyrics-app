import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSongsByAlbum, type SongAlbumEntry, type SongAlbumGroup } from './song-albums.ts';

function extractGroups<T extends { id: string; artist: string; title: string }>(
  entries: SongAlbumEntry<T>[],
): SongAlbumGroup<T>[] {
  return entries.map((entry) => {
    if (entry.type !== 'group') throw new Error(`expected group entry, got ${entry.type}`);
    return entry.group;
  });
}

test('groups Spotify albums by album and artist while returning unclassified songs separately', () => {
  const { entries, unclassified } = groupSongsByAlbum([
    { id: 'one', title: 'Song One', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'two', title: 'Song Two', artist: 'Artist B', spotify_album: 'Shared Album' },
    { id: 'three', title: 'Song Three', artist: 'Artist A', spotify_album: 'Shared Album' },
    { id: 'four', title: 'Song Four', artist: 'Artist C', spotify_album: null },
    { id: 'five', title: 'Song Five', artist: 'Artist D', spotify_album: '' },
  ]);

  assert.deepEqual(extractGroups(entries).map((group) => ({ album: group.album, artist: group.artist, ids: group.songs.map((song) => song.id) })), [
    { album: 'Shared Album', artist: 'Artist A', ids: ['one', 'three'] },
    { album: 'Shared Album', artist: 'Artist B', ids: ['two'] },
  ]);
  assert.deepEqual(unclassified.map((song) => song.id), ['four', 'five']);
});

test('skips albums whose only track title matches the album title', () => {
  const { entries, unclassified } = groupSongsByAlbum([
    { id: 'single', title: 'Same Title', artist: 'Artist A', spotify_album: 'Same Title' },
    { id: 'one', title: 'Song One', artist: 'Artist B', spotify_album: 'Real Album' },
    { id: 'two', title: 'Song Two', artist: 'Artist B', spotify_album: 'Real Album' },
  ]);

  assert.deepEqual(extractGroups(entries).map((group) => ({ album: group.album, ids: group.songs.map((song) => song.id) })), [
    { album: 'Real Album', ids: ['one', 'two'] },
  ]);
  assert.deepEqual(unclassified.map((song) => song.id), ['single']);
});

test('keeps a group when the album title matches only one of several track titles', () => {
  const { entries, unclassified } = groupSongsByAlbum([
    { id: 'one', title: 'Same Title', artist: 'Artist A', spotify_album: 'Same Title' },
    { id: 'two', title: 'Different Song', artist: 'Artist A', spotify_album: 'Same Title' },
  ]);

  assert.deepEqual(extractGroups(entries).map((group) => ({ album: group.album, ids: group.songs.map((song) => song.id) })), [
    { album: 'Same Title', ids: ['one', 'two'] },
  ]);
  assert.deepEqual(unclassified, []);
});
