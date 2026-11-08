import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { findBestMatch } from './match.ts';

const nativeRequire = createRequire(import.meta.url);
const ME = 'owner@example.com';
const song = { id: 'existing-single', title: 'ゆーえふおー', artist: '稀羽すう', spotify_track_id: 'single', created_by: ME, is_public: 1 };

function load<T>(relativePath: string, requireModule: (id: string) => unknown, globals: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const holder = { exports: {} };
  vm.runInNewContext(code, { module: holder, exports: holder.exports, require: requireModule, Response, URL, URLSearchParams, console, ...globals });
  return holder.exports as T;
}

function route(rows = [song], user: { email: string } | null = { email: ME }) {
  return load<{ GET: (request: { nextUrl: URL }) => Promise<Response> }>('../app/api/spotify/match-song/route.ts', (id) => {
    if (id === 'next/server') return { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } };
    if (id === '@/lib/db') return { getDB: () => ({ all: async () => rows }), sql: () => '', and: () => '' };
    if (id === '@/lib/auth') return { getAuthUser: async () => user };
    if (id === '@/lib/song-visibility') return { songVisibilityWhere: () => '' };
    if (id === '@/lib/match') return { findBestMatch };
    return nativeRequire(id);
  });
}

function request(params: Record<string, string> = {}) {
  return { nextUrl: new URL('https://test/api/spotify/match-song?' + new URLSearchParams({ track_id: 'album', title: song.title, artist: song.artist, ...params })) };
}

test('match-song route: explicit lyric discovery returns existing release and is never cached', async () => {
  const response = await route().GET(request({ purpose: 'lyrics' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { match: { id: song.id, title: song.title, artist: song.artist, spotify_track_id: song.spotify_track_id } });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('match-song route: missing/unknown/playback purpose remains strict for automatic following', async () => {
  const cases: Record<string, string>[] = [{}, { purpose: 'unknown' }, { purpose: 'playback' }];
  for (const params of cases) {
    const response = await route().GET(request(params));
    assert.deepEqual(await response.json(), { match: null });
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('match-song route: exclusion and exact-ID ranking still work in lyrics mode', async () => {
  assert.deepEqual(await (await route().GET(request({ purpose: 'lyrics', exclude: song.id }))).json(), { match: null });
  const exact = { ...song, id: 'exact-album', spotify_track_id: 'album', created_by: 'other@example.com' };
  const response = await route([song, exact]).GET(request({ purpose: 'lyrics' }));
  assert.equal((await response.json()).match.id, exact.id);
});

test('match-song route: lyrics mode never returns another user’s private song', async () => {
  const privateSong = { ...song, is_public: 0, created_by: 'other@example.com' };
  for (const user of [{ email: ME }, null]) {
    const response = await route([privateSong], user).GET(request({ purpose: 'lyrics' }));
    assert.deepEqual(await response.json(), { match: null });
  }
});

test('match-song route: empty title returns an uncached no-match without a catalogue query', async () => {
  const response = await route().GET(request({ title: '' }));
  assert.deepEqual(await response.json(), { match: null });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

function client(onFetch: (url: string, init: RequestInit) => Promise<Response>) {
  return load<{ matchSong: (track: { id: string; name: string; artist: string }, excludeId?: string, purpose?: 'lyrics' | 'playback') => Promise<{ id: string } | null> }>('./match-song.ts', nativeRequire, { fetch: onFetch });
}

test('match-song client: explicit manual purpose is transported, with the existing exclusion contract', async () => {
  const api = client(async (url, init) => {
    const parsed = new URL(url, 'https://test');
    assert.equal(parsed.searchParams.get('purpose'), 'lyrics');
    assert.equal(parsed.searchParams.get('exclude'), 'current');
    assert.equal(parsed.searchParams.get('title'), song.title);
    assert.equal(init.cache, 'no-store');
    return new Response(JSON.stringify({ match: { id: song.id } }));
  });
  assert.equal((await api.matchSong({ id: 'album', name: song.title, artist: song.artist }, 'current', 'lyrics'))?.id, song.id);
});

test('match-song client: automatic-follow callers default to playback purpose', async () => {
  const api = client(async (url) => {
    assert.equal(new URL(url, 'https://test').searchParams.get('purpose'), 'playback');
    return new Response(JSON.stringify({ match: null }));
  });
  assert.equal(await api.matchSong({ id: 'album', name: song.title, artist: song.artist }, 'current'), null);
});
