import assert from 'node:assert/strict';
import test from 'node:test';

import { isImeComposing } from './ime';

test('isImeComposing: native isComposing 为 true 时算组字期', () => {
  assert.equal(isImeComposing({ nativeEvent: { isComposing: true }, keyCode: 13 }), true);
});

test('isImeComposing: Safari 的 keyCode 229 算组字期', () => {
  assert.equal(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 229 }), true);
});

test('isImeComposing: 非组字期的 Enter / Escape 不算组字期', () => {
  assert.equal(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 }), false);
  assert.equal(isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 27 }), false);
});

test('isImeComposing: 缺少 nativeEvent 时按 keyCode 判断', () => {
  assert.equal(isImeComposing({ keyCode: 13 }), false);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
  assert.equal(isImeComposing({}), false);
});
