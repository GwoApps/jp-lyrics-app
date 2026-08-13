import assert from 'node:assert/strict';
import test from 'node:test';
import {
  albumStatus,
  decodeBase64Utf8,
  decodePetitLyricsLsyToLrc,
  durationStatus,
  fetchFromLrclib,
  fetchFromUtaNet,
  lrclibConfidence,
  parsePetitLyricsResponse,
  parseUtaNetCandidates,
  petitLyricsXmlToLrc,
  searchLrclib,
  stripTimestamps,
  unescapeLyrics,
  utaNetConfidence,
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

// ─── Uta-Net ────────────────────────────────────────────────

/** Build a minimal Uta-Net search results page from rows of [songId, title, artist]. */
function utanetSearchHtml(rows: [string, string, string][]): string {
  const body = rows.map(([id, title, artist]) => (
    `<tr><td class="td1"><a href="/song/${id}/">${title}</a></td>`
    + `<td class="td2"><a href="/artist/123/">${artist}</a></td></tr>`
  )).join('\n');
  return `<table class="result">${body}</table>`;
}

const utanetLyricsHtml = '<div id="kashi_area">ここは歌詞です<br/>二行目</div>';

/** Mock fetch so /search returns the given results and any /song/ page returns lyrics. */
function mockUtaNet(rows: [string, string, string][]): () => void {
  return mockFetch((url) => {
    if (url.includes('/search/')) {
      return new Response(utanetSearchHtml(rows), { status: 200 });
    }
    if (url.includes('/song/')) {
      return new Response(utanetLyricsHtml, { status: 200 });
    }
    return null;
  });
}

test('parseUtaNetCandidates extracts song id, title and artist per row', () => {
  const html = utanetSearchHtml([
    ['111', 'アイドル', 'YOASOBI'],
    ['222', 'アイドル (Live)', 'Someone Else'],
  ]);
  assert.deepEqual(parseUtaNetCandidates(html), [
    { songId: '111', title: 'アイドル', artist: 'YOASOBI' },
    { songId: '222', title: 'アイドル (Live)', artist: 'Someone Else' },
  ]);
});

test('utaNetConfidence maps a perfect match to accept, weak matches to review', () => {
  // title=1, artist=1 → score 1.0 → 90 (accepted, above the 80 review threshold).
  assert.equal(utaNetConfidence(1), 90);
  // title=0.6, artist=1 → score 0.72 → 76 (needs review).
  assert.equal(utaNetConfidence(0.72), 76);
  // Minimum pass (score 0.55) → 68 (needs review, still above the 60 reject floor).
  assert.equal(utaNetConfidence(0.55), 68);
});

test('fetchFromUtaNet picks the correctly-scored candidate when the first row is a wrong match', async () => {
  // First row is a same-name cover with a different artist; second row is the
  // intended song. Ranking must pick the second one, not blindly the first link.
  const restore = mockUtaNet([
    ['111', 'アイドル', 'Dummy Band'],
    ['222', 'アイドル', 'YOASOBI'],
  ]);
  try {
    const hit = await fetchFromUtaNet('アイドル', 'YOASOBI');
    assert.equal(hit?.matchedTitle, 'アイドル');
    assert.equal(hit?.matchedArtist, 'YOASOBI');
    assert.match(hit!.link, /\/song\/222\//);
    assert.equal(hit?.ambiguous, false);
    assert.equal(hit?.result.plain, 'ここは歌詞です\n二行目');
  } finally {
    restore();
  }
});

test('fetchFromUtaNet flags an ambiguous hit when the top two candidates are close', async () => {
  // Two same-name recordings (original + cover) rank closely → ambiguous review.
  const restore = mockUtaNet([
    ['111', 'アイドル', 'YOASOBI'],
    ['222', 'アイドル', 'YOASOBI feat. カバー'],
  ]);
  try {
    const hit = await fetchFromUtaNet('アイドル', 'YOASOBI');
    assert.ok(hit);
    assert.equal(hit.ambiguous, true);
  } finally {
    restore();
  }
});

test('fetchFromUtaNet rejects a same-name different-artist cover outright', async () => {
  // Only a cover with the same title but a clearly different artist is returned
  // — it must not be accepted as the original song.
  const restore = mockUtaNet([
    ['333', 'アイドル', 'Unknown Cover Band'],
  ]);
  try {
    const hit = await fetchFromUtaNet('アイドル', 'YOASOBI');
    assert.equal(hit, null);
  } finally {
    restore();
  }
});

test('fetchFromUtaNet accepts a version-suffix title when the base title still matches', async () => {
  // A version suffix (-LIVE) that keeps the requested title as a ≥70% substring
  // of the full title is the same song by the same artist — accept it.
  const restore = mockUtaNet([
    ['444', '世界が終わるまで君と踊っていた -LIVE', 'YOASOBI'],
  ]);
  try {
    const hit = await fetchFromUtaNet('世界が終わるまで君と踊っていた', 'YOASOBI');
    assert.ok(hit);
    assert.equal(hit?.matchedTitle, '世界が終わるまで君と踊っていた -LIVE');
  } finally {
    restore();
  }
});

test('fetchFromUtaNet returns null when no candidate clears the thresholds', async () => {
  // No row shares the requested title or artist → chain should fall through.
  const restore = mockUtaNet([
    ['555', '全く別の曲', '別のアーティスト'],
  ]);
  try {
    const hit = await fetchFromUtaNet('アイドル', 'YOASOBI');
    assert.equal(hit, null);
  } finally {
    restore();
  }
});

test('fetchFromUtaNet matches artist even when a feature artist is appended', async () => {
  const restore = mockUtaNet([
    ['666', 'アイドル', 'YOASOBI / コラボ相手'],
  ]);
  try {
    const hit = await fetchFromUtaNet('アイドル', 'YOASOBI');
    assert.ok(hit);
    assert.equal(hit?.ambiguous, false);
  } finally {
    restore();
  }
});