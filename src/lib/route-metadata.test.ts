import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_DESCRIPTION, SITE_NAME, buildSongMetadata, songDescription, songTitle,
} from './route-metadata.ts';

const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const songLayout = readFileSync(new URL('../app/songs/[id]/layout.tsx', import.meta.url), 'utf8');

/** Mimic the root layout template to catch duplicated site names. */
function templateTitle(title: unknown): string {
  const raw = typeof title === 'string' ? title : (title as { absolute?: string }).absolute;
  return raw!.includes(SITE_NAME) ? raw! : `${raw} · ${SITE_NAME}`;
}

interface TestMetadata {
  title: unknown;
  description: string;
  alternates: { canonical: string };
  openGraph: { type: string; locale: string; url: string; images?: string[] };
  twitter: { card: string; images?: string[] };
}


test('shell exposes a default title and per-route template', () => {
  assert.match(layout, /title:\s*\{ default: APP_NAME_NEUTRAL, template: `%s · \$\{APP_NAME_SHORT\}` \}/);
});

test('song title includes the artist when present', () => {
  assert.equal(songTitle('Parallax', 'BABYMETAL'), 'Parallax · BABYMETAL');
  assert.equal(songTitle(' Parallax ', '  '), 'Parallax');
  assert.equal(songTitle(''), '—');
});

test('description uses the first two real lyric lines (LRC tags stripped, bounded)', () => {
  const lyrics = '[00:00.00][ar:Artist]\n\n[00:01.00] 最初の行 \n[00:02.00] Second line\nThird line';
  assert.equal(songDescription(lyrics), '最初の行 Second line');
  assert.equal(songDescription('[00:01.00]\n[ti:X]'), '');
  const long = songDescription('a'.repeat(200));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('…'));
});

test('song metadata carries per-song title, description, canonical URL, OG and Twitter cards', () => {
  const meta = buildSongMetadata({
    id: 'abc123', title: 'Parallax', artist: 'BABYMETAL',
    lyricsRaw: 'line one\nline two', coverUrl: 'https://i.scdn.co/image/abc',
    locale: 'ja', visible: true, siteOrigin: 'https://lyrics.example',
  }) as TestMetadata;
  assert.equal(meta.title, 'Parallax · BABYMETAL');
  assert.equal(meta.description, 'line one line two');
  assert.equal(meta.alternates.canonical, 'https://lyrics.example/songs/abc123');
  assert.equal(meta.openGraph.type, 'music.song');
  assert.equal(meta.openGraph.locale, 'ja_JP');
  assert.equal(meta.openGraph.url, 'https://lyrics.example/songs/abc123');
  assert.deepEqual(meta.openGraph.images, ['https://i.scdn.co/image/abc']);
  assert.equal(meta.twitter.card, 'summary_large_image');
  assert.deepEqual(meta.twitter.images, ['https://i.scdn.co/image/abc']);
});

test('private or missing songs fall back to generic metadata without leaking the title', () => {
  for (const visible of [false]) {
    const meta = buildSongMetadata({
      id: 'secret', title: 'Secret Song', artist: 'Hidden',
      lyricsRaw: 'private lyrics', visible,
    }) as TestMetadata;
    assert.equal(JSON.stringify(meta).includes('Secret Song'), false);
    assert.equal(JSON.stringify(meta).includes('private lyrics'), false);
    assert.deepEqual(meta.title, { absolute: '歌詞ノート · Lyrics Note' });
    assert.equal(templateTitle(meta.title), '歌詞ノート · Lyrics Note');
    assert.equal(meta.openGraph, undefined);
    assert.equal(meta.twitter, undefined);
  }
});

test('description and OG locale follow all four dialects', () => {
  const expected = { ja: 'ja_JP', en: 'en_US', 'zh-CN': 'zh_CN', 'zh-TW': 'zh_TW' } as const;
  for (const [locale, ogLocale] of Object.entries(expected)) {
    const meta = buildSongMetadata({ id: 'x', title: 'T', visible: true, locale, lyricsRaw: '' }) as TestMetadata;
    assert.equal(meta.description, DEFAULT_DESCRIPTION[locale as keyof typeof DEFAULT_DESCRIPTION]);
    assert.equal(meta.openGraph.locale, ogLocale);
    // Empty lyrics fall back to the endpoint that serves the uploaded cover.
    assert.deepEqual(meta.openGraph.images, ['/api/songs/x/cover-image']);
  }
});

test('unsafe cover URLs cannot become OG image sources', () => {
  const meta = buildSongMetadata({
    id: 'x', title: 'T', visible: true, coverUrl: 'javascript:alert(1)',
  }) as TestMetadata;
  assert.deepEqual(meta.openGraph.images, ['/api/songs/x/cover-image']);
});

test('song layout is a server component that applies the ACL with one indexed query', () => {
  assert.doesNotMatch(songLayout, /^\s*'use client';/m);
  assert.match(songLayout, /getAuthUserFromCookies\(\)/);
  assert.match(songLayout, /eq\(schema\.songs\.id, id\)/);
  assert.match(songLayout, /isSongVisibleToUser\(song, user\)/);
  assert.match(songLayout, /readRequestLocaleForMetadata\(\)/);
  assert.match(songLayout, /buildSongMetadata\(\{/);
});

test('uploaded cover and page URLs are absolute when a site origin is supplied', () => {
  const meta = buildSongMetadata({
    id: 'cee60182-7cbc-426a-9d4b-63408ce04610',
    title: 'さよならのキス',
    visible: true,
    siteOrigin: 'https://lyrics.example',
  }) as TestMetadata;
  const cover = 'https://lyrics.example/api/songs/cee60182-7cbc-426a-9d4b-63408ce04610/cover-image';
  assert.equal(meta.openGraph.url, 'https://lyrics.example/songs/cee60182-7cbc-426a-9d4b-63408ce04610');
  assert.equal(meta.alternates.canonical, meta.openGraph.url);
  assert.deepEqual(meta.openGraph.images, [cover]);
  assert.deepEqual(meta.twitter.images, [cover]);
  for (const value of [meta.openGraph.url, meta.alternates.canonical, ...meta.openGraph.images!]) {
    assert.match(value, /^https?:\/\//);
    assert.equal(new URL(value).hostname, 'lyrics.example');
  }
});

test('root layout sets an env-derived metadataBase; song metadata is absolute from the request', () => {
  assert.match(layout, /metadataBase: configuredOrigin/);
  assert.match(layout, /process\.env\.JPLRC_SITE_URL/);
  assert.match(layout, /x-forwarded-host/);
  assert.match(layout, /host/);
  assert.match(songLayout, /resolveSiteOrigin/);
});
