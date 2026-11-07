import test from 'node:test';
import assert from 'node:assert/strict';
import { artistHref, artistKey, groupSongsByArtist, groupArtistAlbums, splitArtists } from './artists.ts';

test('artist credits split only ASCII commas; trim, deduplicate case-insensitively and preserve spelling', () => {
  assert.deepEqual(splitArtists(' A, ,a, B、C, D/E, F & G, Ａ '), ['A', 'B、C', 'D/E', 'F & G', 'Ａ']);
  assert.deepEqual(splitArtists(null), []);
  assert.deepEqual(splitArtists(undefined), []);
  assert.deepEqual(splitArtists(' , '), []);
  assert.equal(artistKey(' YoAsObI '), 'yoasobi');
  assert.notEqual(artistKey('Ａ'), artistKey('A'));
});

test('artist links encode a single segment, including slash, Unicode, percent and punctuation', () => {
  const name = ' 東京/事変 & 100%? # ';
  assert.equal(artistHref(name), `/artists/${encodeURIComponent(name.trim())}`);
});

test('counts deduplicate songs and credits, count known singles, and use consistent album identity', () => {
  const songs = [
    { id: '1', title: 'Single', artist: ' A, a, B ', spotify_album: 'Single' },
    { id: '2', title: 'Track', artist: 'A', spotify_album: ' Shared ' },
    { id: '3', title: 'Other', artist: 'a', spotify_album: 'shared' },
    { id: '4', title: 'Duet', artist: 'A, B', spotify_album: 'Shared' },
    { id: '5', title: 'Unknown', artist: 'A', spotify_album: ' ' },
  ];
  assert.deepEqual(groupSongsByArtist([...songs, songs[0]]), [
    { name: 'A', songCount: 5, albumCount: 2 },
    { name: 'B', songCount: 2, albumCount: 2 },
  ]);
  const albums = groupArtistAlbums(songs);
  assert.equal(albums.length, 2);
  assert.equal(albums.find((album) => artistKey(album.title) === 'shared')?.songs.length, 3);
  assert.ok(albums.some((album) => album.title === 'Single'));
  assert.equal(albums.flatMap((album) => album.songs).length, 4);
  assert.deepEqual(groupSongsByArtist([...songs].reverse()), groupSongsByArtist(songs));
});
