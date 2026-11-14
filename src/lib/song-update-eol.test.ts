import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSongUpdateSet } from './song-update.ts';

/**
 * Issue #421: both hand-write routes (POST /api/songs, PUT /api/songs/[id]) used
 * to store whatever CRLF text was pasted into the editor. The fold now lives in
 * the one place that decides what the lyrics columns receive, so a timeline
 * save whose plain text comes from a legacy CRLF row cannot write it back either.
 */

const EXISTING = { lyrics_raw: 'a\nb', lyrics_synced: '' };

test('lyrics_raw is folded to LF on the way in', () => {
  const set = buildSongUpdateSet(EXISTING, { lyrics_raw: 'a\r\nb\r\nc' });
  assert.equal(set.lyricsRaw, 'a\nb\nc');
});

test('lyrics_synced is folded too, timestamps intact', () => {
  const set = buildSongUpdateSet(EXISTING, { lyrics_synced: '[00:01.00] a\r\n[00:02.00] b\r\n' });
  assert.equal(set.lyricsSynced, '[00:01.00] a\n[00:02.00] b\n');
});

test('a CRLF payload that only re-shapes line endings is compared folded', () => {
  // Stored LF + submitted CRLF → after folding, the written bytes equal the
  // stored ones, so the derived caches are NOT invalidated by a transport quirk.
  const set = buildSongUpdateSet(EXISTING, { lyrics_raw: 'a\r\nb' });
  assert.equal(set.lyricsRaw, 'a\nb');
});

test('absent lyrics fields stay absent (minimal-set update preserved)', () => {
  const set = buildSongUpdateSet(EXISTING, { title: 'T' });
  assert.equal('lyricsRaw' in set, false);
  assert.equal('lyricsSynced' in set, false);
});
