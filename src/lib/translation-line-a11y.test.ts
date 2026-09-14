import assert from 'node:assert/strict';
import test from 'node:test';
import {
  translationLineInputId,
  translationLineLabel,
  translationSourceLineId,
} from './translation-line-a11y.ts';

test('source line and input ids are unique per line index', () => {
  assert.equal(translationSourceLineId(0), 'tl-source-0');
  assert.equal(translationSourceLineId(12), 'tl-source-12');
  assert.equal(translationLineInputId(0), 'tl-input-0');
  assert.equal(translationLineInputId(12), 'tl-input-12');

  const ids = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    ids.add(translationSourceLineId(i));
    ids.add(translationLineInputId(i));
  }
  assert.equal(ids.size, 80, 'ids must not collide across lines');
});

test('translationLineLabel prefixes the 1-based line number', () => {
  assert.equal(translationLineLabel(0, 'Translation'), '1. Translation');
  assert.equal(translationLineLabel(29, '翻訳'), '30. 翻訳');
});

test('translationLineLabel keeps the translated-column text readable', () => {
  const label = translationLineLabel(4, 'Translation');
  assert.ok(label.includes('Translation'));
  assert.equal(label, '5. Translation');
});

test('labels stay distinct for long lists including empty lines', () => {
  const labels = new Set<string>();
  for (let i = 0; i < 60; i += 1) labels.add(translationLineLabel(i, 'Translation'));
  assert.equal(labels.size, 60);
});
