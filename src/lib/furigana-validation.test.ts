import test from 'node:test';
import assert from 'node:assert/strict';
import { furiganaLinesMatchSource, validateFuriganaPayload } from './furigana-validation.ts';

const valid = [
  { segments: [{ text: '香', reading: 'hoeng1' }, { text: '港', reading: 'gong2' }] },
  { segments: [] },
  { segments: [{ text: '好', reading: 'hou2' }, { text: '呀', reading: 'aa3' }] },
];

test('accepts annotations that exactly reconstruct the source lyrics', () => {
  const result = validateFuriganaPayload(valid, '香港\n\n好呀');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.lines, valid);
});

test('rejects malformed annotation shapes', () => {
  assert.deepEqual(validateFuriganaPayload([null], 'x'), { ok: false, error: 'invalid_furigana' });
  assert.deepEqual(validateFuriganaPayload([{ segments: [{ text: 1, reading: '' }] }], '1'), { ok: false, error: 'invalid_furigana' });
  assert.deepEqual(validateFuriganaPayload('[]', ''), { ok: false, error: 'invalid_furigana' });
});

test('rejects annotations that do not reconstruct current source lyrics', () => {
  assert.deepEqual(validateFuriganaPayload(valid, '香港\n\n再見'), { ok: false, error: 'furigana_source_mismatch' });
  assert.deepEqual(validateFuriganaPayload(valid.slice(0, 2), '香港\n\n好呀'), { ok: false, error: 'furigana_source_mismatch' });
});

test('recognizes stored annotations that still match the current lyrics', () => {
  assert.equal(furiganaLinesMatchSource(valid, '香港\n\n好呀'), true);
  assert.equal(furiganaLinesMatchSource(valid, '香港\n\n再見'), false);
  assert.equal(furiganaLinesMatchSource([{ segments: [{ text: '香港', reading: 1 }] }], '香港'), false);
});

test('rejects oversized readings', () => {
  const payload = [{ segments: [{ text: '香', reading: 'a'.repeat(257) }] }];
  assert.deepEqual(validateFuriganaPayload(payload, '香'), { ok: false, error: 'invalid_furigana' });
});
