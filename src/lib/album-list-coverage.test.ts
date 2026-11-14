/**
 * ISSUE #425 — `/albums` used to render only `groupSongsByAlbum().entries`.
 * Every song without a `spotify_album`, and every single-track album whose title
 * equals the track title, was demoted into `unclassified` and then never
 * rendered, so 15 of 25 public songs were unreachable and the header claimed
 * "9 albums · 10 songs". This guards the three places that dropped them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '..', 'components/home/SongLibraryPage.tsx'), 'utf8');

test('the album view consumes the shared view model, so loose songs cannot fall out again', () => {
  assert.match(page, /import \{ buildAlbumList, type AlbumList \} from '@\/lib\/song-albums'/);
  assert.doesNotMatch(page, /albumView\.entries/, 'raw entries would bypass the loose-song run');
  assert.match(page, /const albumGroups = albumView\.groups;/);
  assert.match(page, /const albumLooseSongs = albumView\.looseSongs;/);
});

test('loose songs render at the end of the album list with the active view mode', () => {
  assert.match(page, /\{albumLooseSongs\.map\(\(song\) => renderSongCard\(song, songViewMode\)\)\}/);
});

test('the header count and the empty state both include loose songs', () => {
  assert.match(page, /const albumTrackCount = albumView\.trackCount;/);
  assert.match(page, /albumGroups\.length === 0 && albumLooseSongs\.length === 0/);
});
