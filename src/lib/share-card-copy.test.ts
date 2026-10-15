import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareCopyText } from './share-card-copy.ts';
import type { LyricLine } from './share-card.ts';

function line(text: string, translation: string | null): LyricLine {
  return { text, translation, index: 0, lang: 'ja', translationLang: translation ? 'zh' : null };
}

test('buildShareCopyText: lyrics only omits translations', () => {
  const lines = [line('First source line', '第一句译文'), line('Second source line', '第二句译文'), line('Third source line', '第三句译文')];
  assert.equal(
    buildShareCopyText(lines, false),
    'First source line\nSecond source line\nThird source line',
  );
});

test('buildShareCopyText: with translation interleaves each pair', () => {
  const lines = [line('First source line', '第一句译文'), line('Second source line', '第二句译文'), line('Third source line', '第三句译文')];
  assert.equal(
    buildShareCopyText(lines, true),
    'First source line\n第一句译文\nSecond source line\n第二句译文\nThird source line\n第三句译文',
  );
});

test('buildShareCopyText: blank translation is skipped, not emitted as empty line', () => {
  const lines = [line('First source line', null), line('Second source line', '第二句译文')];
  assert.equal(
    buildShareCopyText(lines, true),
    'First source line\nSecond source line\n第二句译文',
  );
});

test('buildShareCopyText: empty selection returns empty string', () => {
  assert.equal(buildShareCopyText([], true), '');
  assert.equal(buildShareCopyText([], false), '');
});
