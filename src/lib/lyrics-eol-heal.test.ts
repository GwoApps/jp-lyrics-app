import test from 'node:test';
import assert from 'node:assert/strict';
import { refoldFuriganaForLyrics } from './lyrics-eol-heal.ts';
import { normalizeLyricsEol } from './lyrics-content.ts';
import { furiganaLinesMatchSource, validateFuriganaPayload } from './furigana-validation.ts';

/**
 * Issue #421: rolling `lyrics_raw` from CRLF onto LF must move its furigana
 * cache with it. The cache was derived from the CRLF rows, so its segment texts
 * end with `\r`; folding only the lyrics leaves a cache that cannot reconstruct
 * the (now folded) text, i.e. exactly the `seaglass` song whose annotation save
 * answered 400 `furigana_source_mismatch` forever.
 */

const CRLF_RAW = '夜に駆ける\r\n\r\n沈むように\r\n';
const LF_RAW = normalizeLyricsEol(CRLF_RAW);

test('segment texts carrying CR are folded along with the lyrics', () => {
  // The stored payload mirrors the CRLF source line-for-line, blank rows included.
  const stored = JSON.stringify([
    { segments: [{ text: '夜に駆ける\r', reading: 'よるにかける' }] },
    { segments: [] },
    { segments: [{ text: '沈むように\r', reading: 'しずむように' }] },
    { segments: [] },
  ]);
  assert.equal(furiganaLinesMatchSource(JSON.parse(stored), LF_RAW), false, 'the raw cache no longer matches');

  const result = refoldFuriganaForLyrics(stored, LF_RAW);
  assert.equal(result.action, 'folded');
  const lines = JSON.parse(result.value);
  assert.equal(validateFuriganaPayload(lines, LF_RAW).ok, true);
  assert.deepEqual(lines[0].segments, [{ text: '夜に駆ける', reading: 'よるにかける' }]);
  assert.deepEqual(lines[1], { segments: [] }, 'blank rows stay blank');
});

test('a cache that cannot describe the folded text is cleared', () => {
  const stored = JSON.stringify([
    { segments: [{ text: 'まったく別の行', reading: 'a' }] },
    { segments: [] },
    { segments: [] },
    { segments: [] },
  ]);
  assert.deepEqual(refoldFuriganaForLyrics(stored, LF_RAW), { value: '[]', action: 'cleared' });
});

test('an LF-aligned cache is left untouched (the sweep is idempotent)', () => {
  const stored = JSON.stringify([
    { segments: [{ text: '夜に駆ける', reading: 'よるにかける' }] },
    { segments: [] },
    { segments: [{ text: '沈むように', reading: 'しずむように' }] },
    { segments: [] },
  ]);
  assert.equal(furiganaLinesMatchSource(JSON.parse(stored), LF_RAW), true, 'fixture matches');
  assert.deepEqual(refoldFuriganaForLyrics(stored, LF_RAW), { value: stored, action: 'unchanged' });
});

test('empty, absent and unparseable caches are not this sweep\'s business', () => {
  for (const value of ['', '[]', null, undefined, '{oops', '{"a":1}']) {
    const result = refoldFuriganaForLyrics(value as string | null | undefined, LF_RAW);
    assert.equal(result.action, 'unchanged', String(value));
    assert.equal(result.value, value ?? '');
  }
});
