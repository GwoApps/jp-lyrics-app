import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTranslated,
  mergeTranslatedSlice,
  shouldConfirmRetranslate,
} from './translation-draft.ts';

const FILL = { onlyFillBlank: true };
const RETRANSLATE = { onlyFillBlank: false };

test('isTranslated only accepts non-blank strings', () => {
  assert.equal(isTranslated('译文'), true);
  assert.equal(isTranslated(' 译文 '), true);
  assert.equal(isTranslated(''), false);
  assert.equal(isTranslated('   '), false);
  assert.equal(isTranslated(undefined), false);
  assert.equal(isTranslated(null), false);
});

test('mergeTranslatedSlice fills blank lines and reports the merged draft', () => {
  const draft = ['', '', '既有译文'];
  const merged = mergeTranslatedSlice(draft, 0, ['第一行', '第二行', 'AI 第三行'], FILL);
  assert.deepEqual(merged, ['第一行', '第二行', '既有译文']);
  // The caller's array is untouched.
  assert.deepEqual(draft, ['', '', '既有译文']);
});

test('mergeTranslatedSlice never overwrites existing content in fill mode', () => {
  const draft = ['用户手填', ''];
  assert.deepEqual(mergeTranslatedSlice(draft, 0, ['AI 结果', 'AI 补全'], FILL), ['用户手填', 'AI 补全']);
});

test('mergeTranslatedSlice keeps the existing translation when the model returns blank', () => {
  // 补全缺失行: a blank answer for a blank line is a no-op, not a write.
  assert.deepEqual(mergeTranslatedSlice(['既有译文', ''], 0, ['', ''], FILL), ['既有译文', '']);
  // 重新翻译此行: the #269 data-loss case — a blank answer must NOT clear the line.
  assert.deepEqual(
    mergeTranslatedSlice(['既有译文', '其他行'], 0, [''], RETRANSLATE),
    ['既有译文', '其他行'],
  );
  // Whitespace-only answers are treated as blank too.
  assert.deepEqual(mergeTranslatedSlice(['既有译文'], 0, ['   '], RETRANSLATE), ['既有译文']);
  // A slice that omits the requested line entirely also leaves the draft alone.
  assert.deepEqual(mergeTranslatedSlice(['既有译文'], 0, [], RETRANSLATE), ['既有译文']);
  // An undefined slot in a short/malformed response behaves the same way.
  assert.deepEqual(
    mergeTranslatedSlice(['既有译文'], 0, [undefined as unknown as string], RETRANSLATE),
    ['既有译文'],
  );
});

test('mergeTranslatedSlice replaces the target line with a non-blank result', () => {
  assert.deepEqual(
    mergeTranslatedSlice(['旧译文', '其他行'], 0, ['新译文'], RETRANSLATE),
    ['新译文', '其他行'],
  );
});

test('mergeTranslatedSlice skips indices outside the draft', () => {
  // Oversized response: extra items must not append phantom lines.
  assert.deepEqual(mergeTranslatedSlice(['甲'], 0, ['AI 甲', 'AI 乙'], RETRANSLATE), ['AI 甲']);
  // Items landing before index 0 are dropped, the remaining ones stay aligned.
  assert.deepEqual(mergeTranslatedSlice(['甲', '乙'], -1, ['AI 甲', 'AI 乙'], RETRANSLATE), ['AI 乙', '乙']);
  // Items landing past the end are dropped.
  assert.deepEqual(mergeTranslatedSlice(['甲', '乙'], 2, ['AI 丙'], RETRANSLATE), ['甲', '乙']);
});

test('mergeTranslatedSlice merges a slice that starts mid-song', () => {
  const draft = ['', '', '', ''];
  assert.deepEqual(mergeTranslatedSlice(draft, 2, ['第三行', '第四行'], FILL), ['', '', '第三行', '第四行']);
});

test('shouldConfirmRetranslate only asks when the line already holds a translation', () => {
  assert.equal(shouldConfirmRetranslate('既有译文'), true);
  assert.equal(shouldConfirmRetranslate('  既有译文  '), true);
  assert.equal(shouldConfirmRetranslate(''), false);
  assert.equal(shouldConfirmRetranslate('  '), false);
  assert.equal(shouldConfirmRetranslate(undefined), false);
});
