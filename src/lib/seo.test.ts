import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicPaths, buildRobots, isSeoEnabled, SEO_ENABLED_ENV, type PublicSongRow } from './seo.ts';

const sample: PublicSongRow[] = [
  { id: 'a1', title: 'Song A', artist: 'Artist One, Artist Two' },
  { id: 'b2', title: 'Song B', artist: 'Artist One' },
];

test('SEO is opt-in: only an explicit true enables it', () => {
  const previous = process.env[SEO_ENABLED_ENV];
  try {
    for (const value of [undefined, '', 'false', '0', 'yes']) {
      if (value === undefined) delete process.env[SEO_ENABLED_ENV];
      else process.env[SEO_ENABLED_ENV] = value;
      assert.equal(isSeoEnabled(), false);
    }
    process.env[SEO_ENABLED_ENV] = ' TRUE ';
    assert.equal(isSeoEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env[SEO_ENABLED_ENV];
    else process.env[SEO_ENABLED_ENV] = previous;
  }
});

test('sitemap paths contain only public song, artist and library destinations', () => {
  assert.deepEqual(buildPublicPaths(sample), [
    '/',
    '/albums',
    '/artists',
    '/artists/Artist%20One',
    '/artists/Artist%20Two',
    '/songs/a1',
    '/songs/b2',
  ]);
  assert.deepEqual(buildPublicPaths([]), ['/', '/albums', '/artists']);
});

test('sitemap paths are safe when song data contains crafted values', () => {
  assert.doesNotMatch(buildPublicPaths([{ id: 'a&b', title: 'T', artist: 'X?Y' }]).join(' '), /\/admin|\/api|\/settings/);
});

test('robots allows public pages, blocks private/API paths and advertises sitemap only with an origin', () => {
  const robots = buildRobots('https://lyrics.example');
  const rule = Array.isArray(robots.rules) ? robots.rules[0] : robots.rules;
  assert.equal(rule.userAgent, '*');
  assert.equal(rule.allow, '/');
  assert.deepEqual(rule.disallow, ['/admin', '/settings', '/api']);
  assert.equal(robots.sitemap, 'https://lyrics.example/sitemap.xml');
  assert.deepEqual(robots.rules, buildRobots(null).rules);
  assert.equal(buildRobots(null).sitemap, undefined);
});
