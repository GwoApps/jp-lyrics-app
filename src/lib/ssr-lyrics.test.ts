import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSsrLyrics, SSR_LYRICS_LIMIT, type SsrLyricsPayload } from './ssr-lyrics.ts';

test('SSR lyrics strip LRC tags but keep row alignment', () => {
  const payload = buildSsrLyrics({
    songId: 's1',
    lyricsRaw: '[ar:Artist]\n[00:01.23] 第一段\n\n[00:02.50][00:04.00] Second line',
    readingScheme: 'ja-kana',
  });
  assert.deepEqual(payload.lines, [
    { text: '' },
    { text: '第一段' },
    { text: '' },
    { text: 'Second line' },
  ]);
  assert.equal(payload.lang, 'ja');
  assert.equal(payload.truncated, false);
  assert.equal(payload.songId, 's1');
});

test('Cantonese scheme annotates the source language', () => {
  const payload = buildSsrLyrics({ songId: 's2', lyricsRaw: '歌词', readingScheme: 'yue-jyutping' });
  assert.equal(payload.lang, 'yue-Hant');
});

test('long lyrics are bounded and marked truncated', () => {
  const all = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const payload = buildSsrLyrics({ songId: 's3', lyricsRaw: all });
  assert.equal(payload.lines.length, SSR_LYRICS_LIMIT);
  assert.equal(payload.lines[0].text, 'line 0');
  assert.equal(payload.lines.at(-1)?.text, `line ${SSR_LYRICS_LIMIT - 1}`);
  assert.equal(payload.truncated, true);
});

test('empty lyrics produce no rows and no truncation flag', () => {
  for (const raw of [null, undefined, '']) {
    const payload = buildSsrLyrics({ songId: 's4', lyricsRaw: raw });
    assert.deepEqual(payload.lines, []);
    assert.equal(payload.truncated, false);
  }
});

test('payload is plain text only — no markup or callbacks', () => {
  const payload: SsrLyricsPayload = buildSsrLyrics({ songId: 's5', lyricsRaw: '<b>text</b>' });
  assert.equal(payload.lines[0].text, '<b>text</b>');
  assert.deepEqual(Object.keys(payload).sort(), ['lang', 'lines', 'songId', 'truncated']);
  assert.deepEqual(Object.keys(payload.lines[0]), ['text']);
});

test('the SSR payload is gated by song visibility and has no shared cache', () => {
  const layout = readFileSync(new URL('../app/songs/[id]/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /isSongVisibleToUser\(song, user\)/);
  assert.match(layout, /export const dynamic = 'force-dynamic'/);
  assert.match(layout, /buildSsrLyrics\(\{[^}]*lyricsRaw/);
  const component = readFileSync(new URL('../components/song/InitialLyrics.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /on[A-Z]\w*=/);
  // The provider is a client component so the payload reaches the page's
  // first hydration render; the payload itself has no client logic.
  assert.match(component, /'use client'/);
});
