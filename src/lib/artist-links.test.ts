import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../components/ArtistLinks.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports: { default?: (props: { artist?: string | null; fallback?: string; className?: string }) => React.ReactElement } = {};
runInNewContext(compiled, {
  exports,
  require: (specifier: string) => {
    if (specifier === 'next-view-transitions') return { Link: 'a' };
    if (specifier === '@/lib/artists') return {
      // Parsing itself is covered by artists.test.ts. This test isolates rendering/navigation.
      splitArtists: (value?: string | null) => [...new Set((value ?? '').split(',').map((name) => name.trim()).filter(Boolean))],
      artistHref: (name: string) => `/artists/${encodeURIComponent(name.trim())}`,
    };
    return require(specifier);
  },
});
const ArtistLinks = exports.default!;

test('artist links render individually encoded artist destinations and comma-space separators', () => {
  const html = renderToStaticMarkup(React.createElement(ArtistLinks, { artist: ' Aimer , 宇多田ヒカル, AC/DC ', className: 'artist-test' }));
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.match(html, /href="\/artists\/Aimer"/);
  assert.match(html, /href="\/artists\/%E5%AE%87%E5%A4%9A%E7%94%B0%E3%83%92%E3%82%AB%E3%83%AB"/);
  assert.match(html, /href="\/artists\/AC%2FDC"/);
  assert.match(html, /<\/a>, /);
  assert.match(html, /artist-test/);
});

test('empty credits render localized fallback as text, never an unknown-artist destination', () => {
  const html = renderToStaticMarkup(React.createElement(ArtistLinks, { artist: ' , ', fallback: 'Unknown artist' }));
  assert.match(html, /Unknown artist/);
  assert.doesNotMatch(html, /<a /);
});

test('artist navigation stops parent click/keyboard handlers but keeps default link navigation', () => {
  const tree = ArtistLinks({ artist: 'Aimer' });
  const links: React.ReactElement<Record<string, unknown>>[] = [];
  const visit = (node: React.ReactNode) => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<Record<string, unknown>>(child)) return;
      if (child.props.href) links.push(child);
      visit(child.props.children as React.ReactNode);
    });
  };
  visit(tree);
  assert.equal(links.length, 1);
  let stops = 0;
  let prevented = 0;
  const event = { stopPropagation: () => { stops++; }, preventDefault: () => { prevented++; } };
  (links[0].props.onClick as (event: unknown) => void)(event);
  assert.equal(stops, 1);
  assert.equal(prevented, 0);
});
