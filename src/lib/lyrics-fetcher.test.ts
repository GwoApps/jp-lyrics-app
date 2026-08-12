import assert from 'node:assert/strict';
import test from 'node:test';
import {
  albumStatus,
  decodeBase64Utf8,
  decodePetitLyricsLsyToLrc,
  durationStatus,
  fetchFromLrclib,
  lrclibConfidence,
  parsePetitLyricsResponse,
  petitLyricsXmlToLrc,
  searchLrclib,
  stripTimestamps,
  unescapeLyrics,
  LYRICS_DURATION_CONFLICT_MS,
  LYRICS_DURATION_TOLERANCE_MS,
} from './lyrics-fetcher.ts';

test('decodeBase64Utf8 decodes PetitLyrics Japanese UTF-8 payloads without mojibake', () => {
  const lyrics = 'こんなだらけた暮らしで\r\n案外しあわせなの\r\nどうかしてると思わない?';
  const encoded = Buffer.from(lyrics, 'utf8').toString('base64');

  assert.equal(decodeBase64Utf8(encoded), lyrics);
});

test('decodeBase64Utf8 rejects malformed UTF-8 instead of storing replacement characters', () => {
  const invalidUtf8 = Buffer.from([0xe3, 0x28]).toString('base64');
  assert.throws(() => decodeBase64Utf8(invalidUtf8), TypeError);
});

test('unescapeLyrics decodes named, decimal, and hexadecimal HTML entities', () => {
  assert.equal(unescapeLyrics('Tom &amp; Jerry &#39;A&#39; &#x266A; &quot;歌&quot;'), "Tom & Jerry 'A' ♪ \"歌\"");
});

test('stripTimestamps removes every leading timestamp and metadata tags', () => {
  assert.equal(
    stripTimestamps('[offset:120]\n[00:10.00][00:50.000]chorus line\n[01:00.00]outro'),
    'chorus line\noutro',
  );
});

test('decodes PetitLyrics type-2 LSY timings while preserving blank lyric rows', () => {
  const payload = new Uint8Array(0xcc + 8);
  const view = new DataView(payload.buffer);
  const key = 0x1234;
  view.setUint16(0x1a, key, true);
  view.setUint32(0x38, 4, true);
  [20, 403, 776, 1177].forEach((timeCs, index) => view.setUint16(0xcc + index * 2, timeCs ^ key, true));

  assert.equal(
    decodePetitLyricsLsyToLrc(payload, '第一行\r\n\r\n第二行\r\n第三行\r\n'),
    '[00:00.20]第一行\n[00:04.03]\n[00:07.76]第二行\n[00:11.77]第三行',
  );
  assert.equal(decodePetitLyricsLsyToLrc(payload, '第一行\n第二行'), null);
});


test('parses PetitLyrics candidate metadata and converts its WYSIWYG timing to line LRC', () => {
  const timingXml = '<wsy><line><linestring>第一行</linestring><word><starttime>1470</starttime><wordstring>第一行</wordstring></word></line></wsy>';
  const response = `<response><song><title>テスト曲</title><artist>歌手 A</artist><lyricsType>3</lyricsType><lyricsData>${Buffer.from(timingXml, 'utf8').toString('base64')}</lyricsData></song></response>`;
  const candidate = parsePetitLyricsResponse(response, 3);
  assert.deepEqual(candidate, { type: 3, data: timingXml, title: 'テスト曲', artist: '歌手 A' });
  assert.equal(typeof candidate?.data, 'string');
  assert.equal(petitLyricsXmlToLrc(candidate!.data as string), '[00:01.47]第一行');
});

// ─── Duration / album evidence ───────────────────────────────

test('durationStatus classifies exact, near, conflict and unknown durations', () => {
  // 213.0s vs 213000ms — same recording.
  assert.equal(durationStatus(213, 213_000), 'match');
  // Within ±8s tolerance.
  assert.equal(durationStatus(213, 213_000 + LYRICS_DURATION_TOLERANCE_MS), 'match');
  assert.equal(durationStatus(213, 213_000 - LYRICS_DURATION_TOLERANCE_MS), 'match');
  // Between tolerance and conflict → close.
  assert.equal(durationStatus(213, 213_000 + LYRICS_DURATION_TOLERANCE_MS + 1), 'close');
  assert.equal(durationStatus(213, 213_000 + LYRICS_DURATION_CONFLICT_MS - 1), 'close');
  // Beyond the conflict window → a different recording (TV size / live / remaster).
  assert.equal(durationStatus(213, 213_000 + LYRICS_DURATION_CONFLICT_MS), 'conflict');
  assert.equal(durationStatus(213, 213_000 + LYRICS_DURATION_CONFLICT_MS + 30_000), 'conflict');
  // Missing evidence on either side → unknown (keep old fallback).
  assert.equal(durationStatus(null, 213_000), 'unknown');
  assert.equal(durationStatus(213, 0), 'unknown');
  assert.equal(durationStatus(undefined, undefined), 'unknown');
});

test('albumStatus treats album as soft evidence — never a hard reject', () => {
  assert.equal(albumStatus('Idol', 'Idol'), 'match');
  // Region / edition variants — substring still counts as partial, not a reject.
  assert.equal(albumStatus('Idol (Special Edition)', 'Idol'), 'partial');
  assert.equal(albumStatus('Idol', 'THE BOOK'), 'none');
  // Missing album on either side → unknown, no penalty.
  assert.equal(albumStatus(null, 'Idol'), 'unknown');
  assert.equal(albumStatus('Idol', undefined), 'unknown');
  // Normalization handles full/half-width and case differences.
  assert.equal(albumStatus('ＩＤＯＬ', 'idol'), 'match');
});

test('lrclibConfidence downgrades an exact hit whose duration conflicts', () => {
  const hit = {
    result: { synced: '[00:00.10]テスト', plain: 'テスト' },
    duration: 'conflict' as const,
    album: 'none' as const,
  };
  // 98 → 78, below the 80 review threshold — the wrong recording must not be accepted.
  assert.equal(lrclibConfidence(hit, 98, true), 78);
  assert.equal(lrclibConfidence(hit, 96, true), 76);
});

test('lrclibConfidence keeps (or boosts) the top score when evidence matches', () => {
  const matchingHit = {
    result: { synced: '[00:00.10]テスト', plain: 'テスト' },
    duration: 'match' as const,
    album: 'match' as const,
  };
  assert.equal(lrclibConfidence(matchingHit, 98, true), 99);
  const closeHit = {
    result: { synced: '[00:00.10]テスト', plain: 'テスト' },
    duration: 'close' as const,
    album: 'unknown' as const,
  };
  assert.equal(lrclibConfidence(closeHit, 98, true), 95);
  // No Spotify duration at all → old score, no penalty.
  const unknownHit = {
    result: { synced: '[00:00.10]テスト', plain: 'テスト' },
    duration: 'unknown' as const,
    album: 'unknown' as const,
  };
  assert.equal(lrclibConfidence(unknownHit, 98, true), 98);
});

// ─── LRCLIB fetch / search behaviour ─────────────────────────

/** Replace globalThis.fetch with a responder keyed by URL. */
function mockFetch(handler: (url: string) => Response | null): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const res = handler(url);
    return Promise.resolve(res ?? new Response(null, { status: 404 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const lrclibTrack = (overrides: Record<string, unknown>) => ({
  id: 1,
  trackName: 'Idol',
  artistName: 'YOASOBI',
  albumName: 'Idol',
  duration: 213,
  syncedLyrics: '[00:00.10]テスト',
  plainLyrics: 'テスト',
  ...overrides,
});

test('fetchFromLrclib returns a plain hit unchanged when duration agrees with Spotify', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/get/);
    assert.doesNotMatch(url, /album_name/); // bare query first
    return new Response(JSON.stringify(lrclibTrack({})), { status: 200 });
  });
  try {
    const hit = await fetchFromLrclib('Idol', 'YOASOBI', { durationMs: 213_000, album: 'Idol' });
    assert.equal(hit?.duration, 'match');
    assert.equal(hit?.album, 'match');
    assert.equal(hit?.result.synced, '[00:00.10]テスト');
  } finally {
    restore();
  }
});

test('fetchFromLrclib prefers an album-scoped hit when the bare exact duration conflicts', async () => {
  let albumScopedCalled = false;
  const restore = mockFetch((url) => {
    if (url.includes('album_name')) {
      albumScopedCalled = true;
      // Album-scoped entry is the correct 213s studio recording.
      return new Response(JSON.stringify(lrclibTrack({ duration: 213 })), { status: 200 });
    }
    // Bare entry is the 90s TV-size version of the same title + artist.
    return new Response(JSON.stringify(lrclibTrack({ duration: 90 })), { status: 200 });
  });
  try {
    const hit = await fetchFromLrclib('Idol', 'YOASOBI', { durationMs: 213_000, album: 'Idol' });
    assert.equal(albumScopedCalled, true);
    assert.equal(hit?.duration, 'match');
  } finally {
    restore();
  }
});

test('fetchFromLrclib falls back to the album-scoped query when the bare exact 404s', async () => {
  let albumScopedCalled = false;
  const restore = mockFetch((url) => {
    if (url.includes('album_name')) {
      albumScopedCalled = true;
      return new Response(JSON.stringify(lrclibTrack({ duration: 213 })), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'Not found', name: 'TrackNotFound' }), { status: 404 });
  });
  try {
    const hit = await fetchFromLrclib('Idol', 'YOASOBI', { durationMs: 213_000, album: 'Idol' });
    assert.equal(albumScopedCalled, true);
    assert.equal(hit?.duration, 'match');
  } finally {
    restore();
  }
});

test('searchLrclib drops candidates whose duration clearly conflicts with Spotify', async () => {
  const tvSize = lrclibTrack({ id: 1, duration: 90, albumName: 'TVアニメ「Idol」挿入歌' });
  const studio = lrclibTrack({ id: 2, duration: 213, albumName: 'Idol' });
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/search/);
    return new Response(JSON.stringify([tvSize, studio]), { status: 200 });
  });
  try {
    // Spotify duration 213s — the 90s TV-size candidate must be dropped.
    const hit = await searchLrclib('Idol YOASOBI', 'Idol', 'YOASOBI', { durationMs: 213_000, album: 'Idol' });
    assert.equal(hit?.duration, 'match');
    assert.equal(hit?.album, 'match');
  } finally {
    restore();
  }
});

test('searchLrclib keeps title+artist-only scoring when Spotify duration is unknown', async () => {
  const tvSize = lrclibTrack({ id: 1, duration: 90 });
  const studio = lrclibTrack({ id: 2, duration: 213 });
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/search/);
    return new Response(JSON.stringify([tvSize, studio]), { status: 200 });
  });
  try {
    // No duration evidence → first candidate wins as before (old fallback).
    const hit = await searchLrclib('Idol YOASOBI', 'Idol', 'YOASOBI');
    assert.equal(hit?.duration, 'unknown');
    assert.equal(hit?.result.synced, '[00:00.10]テスト');
  } finally {
    restore();
  }
});