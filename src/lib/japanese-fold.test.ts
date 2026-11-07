import assert from 'node:assert/strict';
import test from 'node:test';
import { foldKatakanaToHiragana } from './japanese-fold.ts';

test('foldKatakanaToHiragana maps the fullwidth katakana block onto hiragana', () => {
  assert.equal(foldKatakanaToHiragana('サヨナラ'), 'さよなら');
  assert.equal(foldKatakanaToHiragana('ヒマワリ'), 'ひまわり');
  assert.equal(foldKatakanaToHiragana('アリガトウ'), 'ありがとう');
  assert.equal(foldKatakanaToHiragana('ドライフラワー'), 'どらいふらわー');
  assert.equal(foldKatakanaToHiragana('アイミョン'), 'あいみょん');
});

test('foldKatakanaToHiragana keeps the long vowel mark and non-kana characters', () => {
  // 「ー」 (U+30FC) lives in the Common block and is shared by both scripts.
  assert.equal(foldKatakanaToHiragana('スーパー'), 'すーぱー');
  assert.equal(foldKatakanaToHiragana('Super'), 'Super');
  assert.equal(foldKatakanaToHiragana('漢字とABC 123'), '漢字とABC 123');
  // Hiragana is already the target script → idempotent.
  assert.equal(foldKatakanaToHiragana('さよなら'), 'さよなら');
  assert.equal(foldKatakanaToHiragana(foldKatakanaToHiragana('サヨナラ')), 'さよなら');
});

test('foldKatakanaToHiragana handles the katakana letters outside the numeric range', () => {
  // ヵ/ヶ counters and the (rare) voiced ワ row have regular hiragana forms.
  assert.equal(foldKatakanaToHiragana('一ヵ月'), '一ゕ月');
  assert.equal(foldKatakanaToHiragana('三ヶ月'), '三ゖ月');
  assert.equal(foldKatakanaToHiragana('ヷヸヹヺ'), 'ゔゔゔゔ');
  // ヴ/ゔ is already inside U+30A1–U+30F6, so it folds without an exception.
  assert.equal(foldKatakanaToHiragana('ヴィーナス'), 'ゔぃーなす');
});

test('foldKatakanaToHiragana only sees fullwidth katakana after NFKC', () => {
  // Halfwidth katakana is NFKC's job, not ours — callers normalize first.
  assert.equal(foldKatakanaToHiragana('ｻﾖﾅﾗ'.normalize('NFKC')), 'さよなら');
  assert.equal(foldKatakanaToHiragana('ｻﾖﾅﾗ'), 'ｻﾖﾅﾗ');
});
