import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLyricsHit,
  LYRICS_REJECT_THRESHOLD,
  LYRICS_REVIEW_THRESHOLD,
} from './lyrics-hit.ts';

test('classifyLyricsHit rejects candidates below the hard floor', () => {
  assert.equal(classifyLyricsHit({
    source: 'lrclib-search',
    confidence: LYRICS_REJECT_THRESHOLD - 1,
    synced: true,
    hasExistingTimeline: false,
  }), 'rejected');
  assert.equal(classifyLyricsHit({
    source: 'ytmusic',
    confidence: 50,
    synced: false,
    hasExistingTimeline: false,
  }), 'rejected');
});

test('classifyLyricsHit flags low-confidence timed hits for review regardless of source', () => {
  for (const source of ['lrclib-search', 'ytmusic', 'uta-net', 'petitlyrics']) {
    assert.equal(classifyLyricsHit({
      source,
      confidence: LYRICS_REVIEW_THRESHOLD - 1,
      synced: true,
      hasExistingTimeline: false,
    }), 'needs_review', `${source} below threshold must be needs_review`);
  }
});

test('classifyLyricsHit protects an existing timeline from plain-text overwrite', () => {
  // High confidence alone is not enough — a plain candidate must not silently
  // erase a timed timeline.
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 98,
    synced: false,
    hasExistingTimeline: true,
  }), 'needs_review');
});

test('classifyLyricsHit never accepts an exact hit whose duration conflicts with Spotify', () => {
  // Same title + artist, but the candidate is a TV-size / live / remaster
  // recording — even at 98 confidence it must not be silently accepted.
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 98,
    synced: true,
    hasExistingTimeline: false,
    durationMismatch: true,
  }), 'needs_review');
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 99,
    synced: true,
    hasExistingTimeline: false,
    durationMismatch: true,
  }), 'needs_review');
  // When the duration agrees there is no mismatch flag → accepted as before.
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 98,
    synced: true,
    hasExistingTimeline: false,
    durationMismatch: false,
  }), 'accepted');
});

test('classifyLyricsHit accepts high-confidence synced hits', () => {
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 98,
    synced: true,
    hasExistingTimeline: false,
  }), 'accepted');
  assert.equal(classifyLyricsHit({
    source: 'petitlyrics',
    confidence: 90,
    synced: true,
    hasExistingTimeline: true,
  }), 'accepted');
});

test('classifyLyricsHit accepts a plain hit when there is no timeline to lose', () => {
  assert.equal(classifyLyricsHit({
    source: 'lrclib',
    confidence: 98,
    synced: false,
    hasExistingTimeline: false,
  }), 'accepted');
});

test('classifyLyricsHit threshold matrix matches the documented source scores', () => {
  // fetchLyrics() current assignments — each must route to the documented verdict.
  const cases: Array<[string, number, boolean, string]> = [
    ['lrclib', 98, true, 'accepted'],
    ['lrclib', 96, true, 'accepted'],
    ['lrclib-search', 82, true, 'accepted'],
    ['lrclib-search', 78, true, 'needs_review'],
    ['petitlyrics', 90, true, 'accepted'],
    ['petitlyrics', 82, false, 'accepted'],
    ['uta-net', 76, false, 'needs_review'],
    ['ytmusic', 74, true, 'needs_review'],
    ['ytmusic', 68, false, 'needs_review'],
  ];
  for (const [source, confidence, synced, expected] of cases) {
    assert.equal(
      classifyLyricsHit({ source, confidence, synced, hasExistingTimeline: false }),
      expected,
      `${source}@${confidence} (synced=${synced}) should be ${expected}`,
    );
  }
});

test('classifyLyricsHit routes duration-conflict exact hits to review in the threshold matrix', () => {
  // 98/96 exact hits that conflict with the Spotify duration are downgraded by
  // lrclibConfidence to 78/76 — both must land on needs_review, never accepted.
  const cases: Array<[string, number, boolean]> = [
    ['lrclib', 78, true],
    ['lrclib', 76, true],
  ];
  for (const [source, confidence, synced] of cases) {
    assert.equal(
      classifyLyricsHit({ source, confidence, synced, hasExistingTimeline: false }),
      'needs_review',
      `${source}@${confidence} (duration conflict) should be needs_review`,
    );
  }
});
