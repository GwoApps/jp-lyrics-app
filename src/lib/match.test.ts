import assert from 'node:assert/strict';
import test from 'node:test';
import {
  artistScore,
  findBestMatch,
  isSameSpotifyTrack,
  lineFuzzyMatch,
  normalize,
  songMatchScore,
  titleScore,
  isSongPlaying,
  type SongCandidate,
} from './match.ts';

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

// ─── Kana script folding (ISSUE #317) ─────────────────────────────────

test('normalize folds katakana onto hiragana for comparison', () => {
  assert.equal(normalize('サヨナラ'), 'さよなら');
  assert.equal(normalize('ドライフラワー'), 'どらいふらわー');
  // NFKC still runs first: halfwidth katakana + fullwidth latin collapse too.
  assert.equal(normalize('ｻﾖﾅﾗ'), 'さよなら');
  assert.equal(normalize('ＡＢＣ'), 'abc');
});

test('same reading in different kana scripts is a full title match', () => {
  assert.equal(titleScore('さよなら', 'サヨナラ'), 1);
  assert.equal(titleScore('ひまわり', 'ヒマワリ'), 1);
  assert.equal(titleScore('ありがとう', 'アリガトウ'), 1);
  assert.equal(titleScore('ドライフラワー', 'どらいふらわー'), 1);
});

test('same reading in different kana scripts is a full artist match', () => {
  assert.equal(artistScore('あいみょん', 'アイミョン'), 1);
  assert.equal(artistScore('ヨルシカ', 'よるしか'), 1);
});

test('songMatchScore accepts a kana-heterogeneous title + artist pair', () => {
  assert.equal(songMatchScore(
    { id: 'song', title: 'さよなら', artist: 'あいみょん' },
    { id: 'track-x', name: 'サヨナラ', artist: 'アイミョン' },
  ), 1);
});

test('lineFuzzyMatch treats kana-heterogeneous lyric lines as equal', () => {
  assert.equal(lineFuzzyMatch('サヨナラ', 'さよなら'), true);
  assert.equal(lineFuzzyMatch('君をのせて', 'キミヲノセテ'), true);
});

test('kana folding does not loosen the version-suffix guard', () => {
  // The substring length guard must survive the extra folding step.
  assert.equal(titleScore('GAME', 'さよならアンドロメダ - GAME VERSION'), 0);
  assert.equal(titleScore('世界が終わるまで君と踊っていた', '世界が終わるまで君と踊っていた -LIVE'), 0.85);
  // Kanji stays untouched → still no match between different readings.
  assert.equal(titleScore('さよなら', '別れ'), 0);
});

// Lyrics discovery is not proof that two Spotify releases share a recording.
const singleRelease = song({
  id: '29168e2c-bc3a-4dd9-9c5b-43bc2a1feb36',
  title: 'ゆーえふおー',
  artist: '稀羽すう',
  spotify_track_id: '6OTrur84YEvnlgy3y0KSlQ',
  created_by: ME,
});
const albumRelease = { id: '3r92b4KGVgW1TXmLYkoFdr', name: 'ゆーえふおー', artist: '稀羽すう' };

test('lyrics discovery: the real single/album pair offers the existing lyrics without identifying the recordings', () => {
  assert.equal(findBestMatch([singleRelease], albumRelease, ME, 'lyrics')?.id, singleRelease.id);
  assert.equal(findBestMatch([singleRelease], albumRelease, ME), null);
  assert.equal(songMatchScore(singleRelease, albumRelease), 0);
  assert.equal(isSameSpotifyTrack(singleRelease, albumRelease), false);
  assert.equal(isSongPlaying(singleRelease, albumRelease, ME), false);
});

test('lyrics discovery: an exact Spotify ID still wins over the owner’s other release', () => {
  const exact = song({ ...singleRelease, id: 'public-album', created_by: OTHER, spotify_track_id: albumRelease.id });
  assert.equal(findBestMatch([singleRelease, exact], albumRelease, ME, 'lyrics')?.id, exact.id);
});

test('lyrics discovery: different IDs require exact normalized titles and full artist credits', () => {
  for (const variation of [
    { name: albumRelease.name + ' - Live', artist: albumRelease.artist },
    { name: albumRelease.name + ' (Instrumental)', artist: albumRelease.artist },
    { name: albumRelease.name, artist: '別の歌手' },
    { name: albumRelease.name, artist: '' },
    { name: albumRelease.name, artist: albumRelease.artist + ', Guest' },
  ]) {
    assert.equal(findBestMatch([singleRelease], { ...albumRelease, ...variation }, ME, 'lyrics'), null);
  }
});

test('lyrics discovery: comparison normalization and owner/public visibility are preserved', () => {
  const stored = song({ id: 'kana', title: 'サヨナラ', artist: 'ヨルシカ', spotify_track_id: 'single' });
  const playing = { id: 'album', name: 'さよなら', artist: 'よるしか' };
  assert.equal(findBestMatch([stored], playing, ME, 'lyrics')?.id, stored.id);
  assert.equal(findBestMatch([{ ...stored, is_public: 0 }], playing, ME, 'lyrics'), null);
  assert.equal(findBestMatch([{ ...stored, is_public: 0, created_by: ME }], playing, ME, 'lyrics')?.id, stored.id);
});
