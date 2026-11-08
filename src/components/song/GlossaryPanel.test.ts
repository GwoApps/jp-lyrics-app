/**
 * Terminology panel behaviour (issue #341).
 *
 * The panel is the only user-facing view of the constraint that is injected
 * into every later translation, so these assertions cover the three states the
 * issue asked to tell apart and the two actions that make the table correctable
 * (remove one entry / add one by hand).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import * as glossary from '@/lib/lyrics-glossary';

const require = createRequire(import.meta.url);
type Element = React.ReactElement<Record<string, unknown>>;

function nodes(root: React.ReactNode): Element[] {
  if (!React.isValidElement(root)) return [];
  const node = root as Element;
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}

interface Harness {
  texts: () => string;
  buttons: () => Element[];
  inputs: () => Element[];
  click: (node: Element) => void;
  rerender: () => void;
  requests: { url: string; body: unknown }[];
  saved: () => unknown;
  notice: () => { type: string; message: string } | null;
}

/**
 * Minimal hook harness: `useState` state persists across `rerender()` calls, so
 * a test drives the component the way a real click would.
 */
function render(
  props: { value: string | null; editable?: boolean },
  responses: { ok: boolean; body?: unknown }[] = [{ ok: true }],
): Harness {
  const exports: Record<string, unknown> = {};
  const requests: { url: string; body: unknown }[] = [];
  const states: unknown[] = [];
  let stateIndex = 0;
  let tree: React.ReactNode = null;
  let saved: unknown = null;
  let notice: { type: string; message: string } | null = null;

  const code = ts.transpileModule(readFileSync('src/components/song/GlossaryPanel.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  runInNewContext(code, {
    exports,
    console,
    process,
    fetch: async (url: string, init: { body?: string }) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      const response = responses[Math.min(requests.length - 1, responses.length - 1)];
      return { ok: response.ok, json: async () => response.body ?? {} };
    },
    require: (name: string) => {
      if (name === 'react') {
        return {
          ...React,
          useState: (initial: unknown) => {
            const index = stateIndex++;
            if (!(index in states)) states[index] = initial;
            return [states[index], (next: unknown) => {
              states[index] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(states[index]) : next;
              rerender();
            }];
          },
        };
      }
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'lucide-react') {
        return { BookMarked: () => null, Plus: () => null, RefreshCw: () => null, Trash2: () => null };
      }
      if (name === '@/lib/i18n') return { useI18n: () => ({ t: (key: string) => key }) };
      if (name === '@/lib/lyrics-glossary') return glossary;
      if (name === '@/components/ConfirmDialog') return { default: () => null };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  const Component = exports.default as (input: object) => React.ReactNode;
  const rerender = () => {
    stateIndex = 0;
    tree = Component({
      songId: 's1',
      value: props.value,
      editable: props.editable ?? true,
      onSaved: (entries: unknown) => { saved = entries; },
      onNotify: (type: string, message: string) => { notice = { type, message }; },
    });
  };
  rerender();

  const texts = () => {
    const collected: string[] = [];
    const visit = (node: React.ReactNode) => {
      if (typeof node === 'string' || typeof node === 'number') collected.push(String(node));
      else if (React.isValidElement(node)) {
        React.Children.toArray((node as Element).props.children as React.ReactNode).forEach(visit);
      }
    };
    visit(tree);
    return collected.join('|');
  };

  return {
    texts,
    requests,
    rerender,
    buttons: () => nodes(tree).filter((node) => node.type === 'button'),
    inputs: () => nodes(tree).filter((node) => node.type === 'input'),
    click: (target) => { (target.props.onClick as () => void)(); },
    saved: () => saved,
    notice: () => notice,
  };
}

const TERMS = JSON.stringify([{ original: '花火', translation: '烟花' }, { original: '君', translation: '你' }]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a stored table renders every term in source → translation order', () => {
  const h = render({ value: TERMS });
  assert.match(h.texts(), /花火/);
  assert.match(h.texts(), /烟花/);
  assert.match(h.texts(), /君/);
  assert.match(h.texts(), /song\.glossaryCount/);
});

test('"no terms", "extraction failed" and "never extracted" never look the same', () => {
  const empty = render({ value: '[]' }).texts();
  const failed = render({ value: 'null' }).texts();
  const absent = render({ value: null }).texts();
  assert.match(empty, /song\.glossaryEmpty/);
  assert.match(failed, /song\.glossaryFailed/);
  assert.match(absent, /song\.glossaryNotExtracted/);
  assert.notEqual(empty, failed);
  assert.notEqual(empty, absent);
});

test('a damaged table is reported as damaged, not as "no terms"', () => {
  assert.match(render({ value: '{oops' }).texts(), /song\.glossaryDamaged/);
});

test('read-only viewers see the terms but no editing affordances', () => {
  const h = render({ value: TERMS, editable: false });
  assert.match(h.texts(), /花火/);
  assert.equal(h.buttons().length, 0);
});

test('removing one entry writes the remaining table back', async () => {
  const h = render({ value: TERMS });
  const removeButton = h.buttons().find((node) => node.props['aria-label'] === 'song.glossaryRemove');
  assert.ok(removeButton);
  h.click(removeButton);
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/songs/s1');
  assert.deepEqual(h.requests[0].body, { lyrics_glossary: [{ original: '君', translation: '你' }] });
  assert.deepEqual(h.saved(), [{ original: '君', translation: '你' }]);
  assert.deepEqual(h.notice(), { type: 'success', message: 'song.glossarySaved' });
});

test('a hand-written entry is appended to the existing table', async () => {
  const h = render({ value: JSON.stringify([{ original: '君', translation: '你' }]) });
  const [original, translation] = h.inputs();
  (original.props.onChange as (e: unknown) => void)({ target: { value: ' 花火 ' } });
  (translation.props.onChange as (e: unknown) => void)({ target: { value: ' 烟花 ' } });
  const addButton = h.buttons().find((node) => String(node.props.children).includes('song.glossaryAdd'));
  assert.ok(addButton, 'add button');
  h.click(addButton);
  await flush();
  assert.deepEqual(h.requests[0].body, {
    lyrics_glossary: [{ original: '君', translation: '你' }, { original: '花火', translation: '烟花' }],
  });
});

test('an incomplete draft is refused locally instead of sending a bad request', async () => {
  const h = render({ value: '[]' });
  const [original] = h.inputs();
  (original.props.onChange as (e: unknown) => void)({ target: { value: '花火' } });
  const addButton = h.buttons().find((node) => String(node.props.children).includes('song.glossaryAdd'));
  assert.ok(addButton);
  h.click(addButton);
  await flush();
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.notice(), { type: 'error', message: 'song.glossaryEntryInvalid' });
});

test('a rejected save surfaces the server error instead of pretending success', async () => {
  const h = render({ value: TERMS }, [{ ok: false, body: { error: 'glossary_duplicate' } }]);
  const removeButton = h.buttons().find((node) => node.props['aria-label'] === 'song.glossaryRemove');
  assert.ok(removeButton);
  h.click(removeButton);
  await flush();
  assert.deepEqual(h.notice(), { type: 'error', message: 'song.glossaryDuplicate' });
  assert.equal(h.saved(), null);
});
