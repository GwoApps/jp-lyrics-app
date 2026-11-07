import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import { getJapaneseReadingContext } from '@/lib/japanese-reading-context';
import type { FuriganaLine } from '@/lib/types';

const require = createRequire(import.meta.url);
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(root: React.ReactNode): Element[] {
  if (!React.isValidElement(root)) return [];
  const node = root as Element;
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function editor(lines: FuriganaLine[], segIndex: number, candidates: string[] = []) {
  const exports: Record<string, unknown> = {};
  let index = 0;
  let changed: FuriganaLine[] | null = null;
  const values: unknown[] = [{ lineIndex: 0, segIndex }, '', candidates, false, false, 0, false];
  const hooks = {
    useState: () => [values[index++], () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
  };
  const code = ts.transpileModule(readFileSync('src/components/FuriganaEditor.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react') return hooks;
    if (name === '@/lib/i18n') return { useI18n: () => ({ t: (key: string) => key }) };
    if (name === '@/lib/japanese-reading-context') return { getJapaneseReadingContext };
    if (name === '@/lib/lyrics-reading') return { getCantoneseReadingCandidates: async () => [] };
    if (name === '@/components/ConfirmDialog') return { default: () => null };
    return require(name);
  } });
  const component = exports.default as (props: object) => React.ReactNode;
  const tree = component({ lines, onChange: (next: FuriganaLine[]) => { changed = next; } });
  return { tree, changed: () => changed, click: (key: string) => {
    const button = nodes(tree).find(node => node.type === 'button' && node.props.children === key);
    assert.ok(button, key);
    (button.props.onClick as () => void)();
  } };
}

test('a dictionary reading remains visible even when it matches the saved reading', () => {
  const h = editor([{ segments: [{ text: '呼吸', reading: 'こきゅう' }] }], 0, ['こきゅう']);
  assert.ok(nodes(h.tree).some(node => node.type === 'button' && node.props.children === 'こきゅう'));
  assert.ok(nodes(h.tree).some(node => node.props.children === 'furigana.suggestions'));
  assert.ok(!nodes(h.tree).some(node => node.props.children === 'furigana.suggestionsEmpty'));
});

test('successful no-match has an explicit empty message rather than hiding the whole row', () => {
  const h = editor([{ segments: [{ text: '謎', reading: '' }] }], 0, []);
  assert.ok(nodes(h.tree).some(node => node.props.children === 'furigana.suggestionsEmpty'));
});

test('reconvert/reset with a shorter annotation array never crashes an old selection', () => {
  assert.doesNotThrow(() => editor([{ segments: [{ text: '世界', reading: 'せかい' }] }], 1));
});

test('splitting retains the original word boundary and supplementary characters', () => {
  const h = editor([{ segments: [{ text: 'お', reading: '' }, { text: '世界', reading: 'せかい', joinPrev: true }] }], 1);
  h.click('furigana.split');
  const segments = h.changed()![0].segments;
  assert.equal(segments[1].joinPrev, true);
  assert.equal(segments[2].joinPrev, true);
  assert.deepEqual(getJapaneseReadingContext(segments, 2), { word: 'お世界', start: 2 });
  const rare = editor([{ segments: [{ text: '𠮷田', reading: 'よしだ' }] }], 0);
  rare.click('furigana.split');
  assert.equal(JSON.stringify(rare.changed()![0].segments.map(s => s.text)), JSON.stringify(['𠮷', '田']));
});

test('merging inherits joinPrev instead of silently dropping a kana prefix from lookup context', () => {
  const h = editor([{ segments: [
    { text: 'お', reading: '' }, { text: '取', reading: 'と', joinPrev: true },
    { text: 'り', reading: '', joinPrev: true }, { text: '扱', reading: 'あつか', joinPrev: true },
    { text: 'い', reading: '', joinPrev: true },
  ] }], 1);
  h.click('furigana.merge');
  assert.deepEqual(getJapaneseReadingContext(h.changed()![0].segments, 1), { word: 'お取り扱い', start: 1 });
});
