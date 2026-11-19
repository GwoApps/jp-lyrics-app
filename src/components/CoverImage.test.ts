import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./CoverImage.tsx', import.meta.url), 'utf8');
type Element = React.ReactElement<Record<string, unknown>>;

function component() {
  let state: { loaded: boolean; error: boolean } = { loaded: false, error: false };
  const exports: { default?: (props: Record<string, unknown>) => Element } = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports,
    require: (specifier: string) => {
      if (specifier === 'react') return {
        ...React,
        useState: (initial: unknown) => [
          typeof initial === 'function' ? initial() : initial,
          (value: unknown) => { if (typeof value === 'function') state = value(state); else state = value as typeof state; },
        ],
      };
      return require(specifier);
    },
  });
  const CoverImage = exports.default!;
  const render = (props: Record<string, unknown>): Element => {
    const tree = CoverImage(props);
    return typeof tree.type === 'function' ? (tree.type as (p: object) => Element)(tree.props) : tree;
  };
  return { render };
}

function img(tree: Element): Element {
  return React.Children.toArray(tree.props.children as React.ReactNode)
    .find((child) => React.isValidElement(child) && child.type === 'img') as Element;
}

test('cover images lazy-load, decode async and reserve size from the size prop', () => {
  const { render } = component();
  const expected: Record<string, [number, number]> = { sm: [36, 36], md: [64, 64], lg: [96, 96] };
  for (const [size, [width, height]] of Object.entries(expected)) {
    const image = img(render({ src: 'https://i.scdn.co/image/one', size }));
    assert.equal(image.props.loading, 'lazy');
    assert.equal(image.props.decoding, 'async');
    assert.equal(image.props.width, width);
    assert.equal(image.props.height, height);
  }
  const fallback = img(render({ src: 'https://i.scdn.co/image/one' }));
  assert.equal(fallback.props.width, 64);
  assert.equal(fallback.props.height, 64);
});

test('cover image keeps the fade placeholder and url-keyed remount', () => {
  const { render } = component();
  const tree = render({ src: 'https://i.scdn.co/image/one', size: 'sm' });
  const image = img(tree);
  assert.match(String(image.props.className), /transition-opacity duration-300 opacity-0/);
  assert.match(String((tree.props.children as React.ReactElement<{ className: string }>[])[0].props.className), /opacity-100/);
  assert.match(String(image.key), /i\.scdn\.co\/image\/one/);
  assert.equal((image.props.onLoad as () => void)(), undefined);
});
