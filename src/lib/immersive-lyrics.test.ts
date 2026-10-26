import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  centeredLyricScrollTop, isLyricsView, lyricsViewUrl,
  LYRIC_FOLLOW_RESUME_MS, shouldFollowImmersiveLyrics,
} from './immersive-lyrics.ts';

test('lyrics view URLs retain other query parameters and hashes', () => {
  const source = 'https://example.test/songs/abc?source=list#lyrics';
  assert.equal(lyricsViewUrl(source, true), '/songs/abc?source=list&view=lyrics#lyrics');
  assert.equal(lyricsViewUrl('https://example.test/songs/abc?view=lyrics&source=list#lyrics', false), '/songs/abc?source=list#lyrics');
  assert.equal(isLyricsView('https://example.test/songs/abc?view=lyrics'), true);
  assert.equal(isLyricsView('https://example.test/songs/abc?view=other'), false);
});

test('centering uses the line and container viewport geometry', () => {
  assert.equal(centeredLyricScrollTop(250, 800, 410, 100), 310);
  assert.equal(centeredLyricScrollTop(0, 700, 350, 80), 40);
});

test('manual browsing delays following until two seconds after the last input', () => {
  assert.equal(LYRIC_FOLLOW_RESUME_MS, 2000);
  assert.equal(shouldFollowImmersiveLyrics(2999, 3000), false);
  assert.equal(shouldFollowImmersiveLyrics(3000, 3000), true);
});
