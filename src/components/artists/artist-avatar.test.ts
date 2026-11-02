import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./ArtistAvatar.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./artists.css', import.meta.url), 'utf8');
type AvatarProps = { name: string; imageUrl?: string | null; large?: boolean };
type Element = React.ReactElement<Record<string, unknown>>;
function component() {
  let state = 'loading';
  const exports: { ArtistAvatar?: (props: AvatarProps) => Element } = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, {
    exports,
    require: (specifier: string) => {
      if (specifier === 'react') return { ...React, useState: () => [state, (value: string) => { state = value; }] };
      if (specifier === 'next/image') return { __esModule: true, default: 'next-image' };
      if (specifier === './profile-queue') return {};
      if (specifier === './artist-profile-cache') return {
        isArtistPortraitLoaded: () => false, markArtistPortraitLoaded: () => {}, getCachedArtistProfile: () => null,
        artistTransitionName: () => 'artist-avatar-test',
      };
      return require(specifier);
    },
  });
  const avatar = (props: AvatarProps) => exports.ArtistAvatar!(props);
  const render = (props: AvatarProps): Element => {
    const tree = avatar(props);
    return typeof tree.type === 'function' ? (tree.type as (props: object) => Element)(tree.props) : tree;
  };
  return { avatar, render };
}
function image(tree: Element): Element | undefined {
  return React.Children.toArray(tree.props.children as React.ReactNode).find((child) => React.isValidElement(child) && child.type === 'next-image') as Element | undefined;
}

test('portrait uses next/image rather than a raw img and remains hidden until loaded', () => {
  const { render } = component();
  const tree = render({ name: 'Artist', imageUrl: 'https://i.scdn.co/image/one' });
  assert.equal(tree.props['data-state'], 'loading');
  const portrait = image(tree);
  assert.ok(portrait);
  assert.equal(portrait.props.unoptimized, true);
  assert.equal(portrait.props.fill, true);
  assert.equal(portrait.props.loading, 'lazy');
  assert.match(String(portrait.props.className), /artist-avatar-portrait/);
  const ast = ts.createSourceFile('avatar.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rawImages: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'img') rawImages.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  assert.equal(rawImages.length, 0);
});

test('loaded portrait triggers the fade state; failed images restore the placeholder', () => {
  const { render } = component();
  const props = { name: 'Artist', imageUrl: 'https://i.scdn.co/image/one' };
  (image(render(props))!.props.onLoad as () => void)();
  assert.equal(render(props).props['data-state'], 'loaded');
  (image(render(props))!.props.onError as () => void)();
  const failed = render(props);
  assert.equal(failed.props['data-state'], 'error');
  assert.equal(image(failed), undefined);
  assert.equal(React.Children.toArray(failed.props.children as React.ReactNode).length, 1);
});

test('changing the portrait URL remounts its load lifecycle instead of reusing loaded state', () => {
  const { avatar } = component();
  assert.notEqual(avatar({ name: 'Artist', imageUrl: 'first' }).key, avatar({ name: 'Artist', imageUrl: 'second' }).key);
});

test('portrait and fallback crossfade with opacity only and support reduced motion', () => {
  assert.match(css, /\.artist-avatar-portrait\s*\{[^}]*opacity:\s*0[^}]*transition:\s*opacity\s+360ms/);
  assert.match(css, /\.artist-avatar\[data-state=['"]loaded['"]\]\s+\.artist-avatar-portrait\s*\{\s*opacity:\s*1/);
  assert.match(css, /\.artist-avatar\[data-state=['"]loaded['"]\]\s+\.artist-avatar-fallback\s*\{\s*opacity:\s*0/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[^]*artist-avatar-portrait[^}]*transition:\s*none/);
});
