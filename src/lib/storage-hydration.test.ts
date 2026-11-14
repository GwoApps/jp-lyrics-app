import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LOCALE_COOKIE, LOCALE_STORAGE_KEY } from './locale.ts';

/**
 * Issue #419 made the server actually render the tree. That turned every
 * render-phase read of a browser-only store into a hydration mismatch — the
 * server cannot see `localStorage` / `sessionStorage`, so the two trees disagree
 * and React throws the server markup away. The fix routes those reads through
 * the hydration-safe hooks, which return the server-side default until
 * hydration finishes.
 *
 * The tests below pin the pieces that make that possible, and the invariants
 * the previous implementation broke.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

test('the hydration-safe primitives default to the server-side value', () => {
  const storage = read('lib/browser-storage.ts');
  for (const name of ['useHydrated', 'useStoredString', 'useStoredPreference', 'readStoredString', 'writeStoredString']) {
    assert.match(storage, new RegExp(`export (?:function|const) ${name}\\b`), `${name} should be exported`);
  }
  // `useStoredString` must return `null` on the server / during hydration.
  assert.match(storage, /useSyncExternalStore\(subscribe, \(\) => readStoredString\(key\), \(\) => null\)/);
  // `useHydrated` is `false` until after hydration.
  assert.match(storage, /subscribe, \(\) => true, \(\) => false/);
});

test('the cached song list and cover are read through hydration-safe hooks', () => {
  const list = read('lib/song-list-cache.ts');
  const cover = read('lib/song-cover-cache.ts');
  // Both expose a hook whose server snapshot is `null`, not the stored value.
  for (const [name, source] of [['useCachedSongs', list], ['useCachedSongCover', cover]] as const) {
    assert.match(source, new RegExp(`export function ${name}`), `${name} should be exported`);
    assert.match(source, /\(\) => null/, `${name} must default to null for SSR`);
  }
  // The consumers no longer seed state from the cache during render.
  const libraryPage = read('components/home/SongLibraryPage.tsx');
  assert.doesNotMatch(libraryPage, /useState\(\(\) => getCachedSongs/);
  const songPage = read('app/songs/[id]/page.tsx');
  assert.doesNotMatch(songPage, /useState<string \| null>\(\(\) => getCachedSongCover/);
});

test('the auth session cache is not read during the hydration render', () => {
  const session = read('lib/auth-session.ts');
  // The nav renders differently when signed in (admin link, settings, avatar), so
  // reading the cache mid-hydration produced server HTML the client could not
  // match — the actual remaining mismatch once #419's null gate was gone.
  assert.match(session, /const hydrated = useSyncExternalStore\(subscribeHydrated, \(\) => true, \(\) => false\)/);
  assert.match(session, /const cached = hydrated \? getCachedAuthSession\(\) : null/);
  assert.doesNotMatch(session, /useState<AuthSession \| null>\(\(\) => getCachedAuthSession\(\)\)/);
});

test('I18nProvider renders on the server instead of waiting for hydration', () => {
  const i18n = read('lib/i18n.tsx');
  // The exact regression: a hydration gate that returned `null` for the whole tree.
  assert.doesNotMatch(i18n, /if \(!ready\) return null/);
  // It starts from the locale the server resolved, so the first client render
  // reproduces the server markup byte for byte.
  assert.match(i18n, /initialLocale/);
  assert.match(i18n, /useState<Locale \| null>\(null\)/);
});

test('the locale in the cookie is the same key the client writes', () => {
  // One write has to keep both stores in step, or the next request renders in
  // a different language than the one the reader just chose.
  assert.equal(LOCALE_COOKIE, LOCALE_STORAGE_KEY);
  const i18n = read('lib/i18n.tsx');
  assert.match(i18n, /localStorage\.setItem\(LOCALE_STORAGE_KEY/);
  assert.match(i18n, /document\.cookie = `\$\{LOCALE_COOKIE\}/);
});

test('reading preferences and follow-playing go through useStoredPreference', () => {
  // These rendered into visible controls, so a pre-hydration read flipped the
  // UI (font size, reading mode, follow button) the moment React hydrated.
  for (const file of ['hooks/useReadingPreferences.ts', 'hooks/useSpotifySync.ts', 'hooks/useImmersiveLyrics.ts']) {
    const source = read(file);
    assert.match(source, /useStoredPreference/, `${file} should use the hydration-safe preference hook`);
  }
  const libraryPage = read('components/home/SongLibraryPage.tsx');
  assert.match(libraryPage, /useStoredPreference\(viewModeKey\(listKind\)/, 'the song/album view mode');
});
