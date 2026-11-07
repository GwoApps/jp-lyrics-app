import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  centeredLyricScrollTop, isLyricsView, lyricsViewUrl,
  LYRIC_FOLLOW_RESUME_MS, shouldFollowImmersiveLyrics,
  IMMERSIVE_FONT_SIZES, parseImmersiveFontStep,
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

test('manual browsing resumes six seconds after the latest input, or immediately when cleared', () => {
  assert.equal(LYRIC_FOLLOW_RESUME_MS, 6000);
  const firstDeadline = 1000 + LYRIC_FOLLOW_RESUME_MS;
  const latestDeadline = 4000 + LYRIC_FOLLOW_RESUME_MS;
  assert.equal(shouldFollowImmersiveLyrics(firstDeadline, latestDeadline), false);
  assert.equal(shouldFollowImmersiveLyrics(latestDeadline - 1, latestDeadline), false);
  assert.equal(shouldFollowImmersiveLyrics(latestDeadline, latestDeadline), true);
  assert.equal(shouldFollowImmersiveLyrics(4000, 0), true);
});

test('stored fullscreen size is independent, bounded, and every step changes the rendered size', () => {
  for (const invalid of [null, '', ' ', '-1', '5', '20', 'NaN', '1.5', '1px']) {
    assert.equal(parseImmersiveFontStep(invalid), 2);
  }
  for (let step = 0; step < IMMERSIVE_FONT_SIZES.length; step++) {
    assert.equal(parseImmersiveFontStep(String(step)), step);
    if (step > 0) {
      assert.ok(IMMERSIVE_FONT_SIZES[step].mobile > IMMERSIVE_FONT_SIZES[step - 1].mobile);
      assert.ok(IMMERSIVE_FONT_SIZES[step].desktop > IMMERSIVE_FONT_SIZES[step - 1].desktop);
    }
  }
});
