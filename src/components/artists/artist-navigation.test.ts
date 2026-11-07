import assert from 'node:assert/strict';
import test from 'node:test';
import { artistTransitionName, createArtistProfileCache } from './artist-profile-cache.ts';
import { canNavigateBack, navigateArtistBack } from './artist-back-navigation.ts';

const profile = (name: string) => ({ name, imageUrl: `https://i.scdn.co/image/${name}`, description: null, genres: [], source: 'Spotify', sourceUrl: null });
test('portrait cache primes public profile and decoded image state across routes, bounded and expiring', () => {
  let now = 0;
  const cache = createArtistProfileCache(() => now, 2, 100);
  cache.set(profile('A')); cache.markLoaded('url-a');
  assert.equal(cache.get(' a ')?.name, 'A');
  assert.equal(cache.isLoaded('url-a'), true);
  cache.set(profile('B')); cache.set(profile('C'));
  assert.equal(cache.get('A'), null);
  now = 101;
  assert.equal(cache.get('B'), null);
  assert.equal(cache.isLoaded('url-a'), false);
});
test('shared artist names are deterministic, case-insensitive, CSS-safe and collision-free for encoded punctuation', () => {
  assert.equal(artistTransitionName(' 明透 '), artistTransitionName('明透'));
  assert.equal(artistTransitionName('Aimer'), artistTransitionName('aimer'));
  assert.notEqual(artistTransitionName('A B'), artistTransitionName('A%20B'));
  for (const name of ['明透', 'AC/DC', '100%?', 'A & B']) assert.match(artistTransitionName(name), /^artist-avatar-[a-f0-9-]+$/);
});
test('a hidden cross-origin history entry is not ruled out by Navigation API', () => {
  assert.equal(canNavigateBack(1), false);
  assert.equal(canNavigateBack(3), true);
  assert.equal(canNavigateBack(3, false), true);
  assert.equal(canNavigateBack(1, true), true);
});
test('Back invokes actual history.back without adding an artist-list entry; direct-entry fallback replaces', () => {
  let backs = 0; const replaced: string[] = [];
  const history = { back: () => { backs++; } };
  const replace = (path: string) => { replaced.push(path); };
  navigateArtistBack(true, history, replace);
  assert.equal(backs, 1); assert.deepEqual(replaced, []);
  navigateArtistBack(false, history, replace);
  assert.equal(backs, 1); assert.deepEqual(replaced, ['/artists']);
});
