/**
 * Server-rendered page metadata shared by the root shell and song routes.
 *
 * Kept free of Next.js and DB imports so the pure parts (title/description/
 * OG tag assembly) can be unit-tested with plain `node --test`.
 */
import type { Metadata } from 'next';
import { APP_DESCRIPTION, APP_NAME_NEUTRAL, APP_NAME_SHORT } from './app-identity';
import { asLocale, type Locale } from './locale';

export const SITE_NAME = APP_NAME_SHORT;
export const DEFAULT_DESCRIPTION: Record<Locale, string> = {
  ja: '歌詞ノート — ふりがな付きの日本語歌詞を管理し、Spotify と同期します。',
  en: 'Lyrics Note — Japanese lyrics with furigana, synced with Spotify.',
  'zh-CN': '歌词笔记 — 带注音的日语歌词，支持与 Spotify 同步。',
  'zh-TW': '歌詞筆記 — 附注音的日語歌詞，支援與 Spotify 同步。',
};

/**
 * Build a song page's title/description from the row we already read for the
 * ACL check. Lyrics are turned into a short caption without revealing any
 * more of a private song than its (already gated) title would.
 */
export function songTitle(title: string, artist?: string | null): string {
  const name = title.trim() || '—';
  const by = artist?.trim();
  return by ? `${name} · ${by}` : name;
}

/** First two non-empty lyric lines, with LRC timestamps and tag lines removed. */
export function songDescription(lyricsRaw: string | null | undefined, maxLength = 120): string {
  const lines = (lyricsRaw ?? '')
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*/g, '')
      .replace(/^\[[a-zA-Z]+:[^\]]*\]\s*/gi, '')
      .trim())
    .filter((line) => line && !/^\[[a-zA-Z]+:[^\]]*\]$/i.test(line));
  const text = lines.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

/**
 * Build the metadata object exported by `generateMetadata`.
 *
 * `visible` must come from `isSongVisibleToUser`: private songs fall back to
 * the generic shell metadata so a shared link can't leak their title through
 * `<title>` or OG tags.
 */
export function buildSongMetadata({
  id, title, artist, lyricsRaw, coverUrl, locale, visible, siteOrigin,
}: {
  id: string;
  title: string;
  artist?: string | null;
  lyricsRaw?: string | null;
  coverUrl?: string | null;
  locale?: string | null;
  visible: boolean;
  /** Request-derived origin used to absolute-ize internal paths (issue #464). */
  siteOrigin?: string | null;
}): Metadata {
  // The root layout appends ` · ${APP_NAME_SHORT}` to plain titles, so a plain
  // neutral name here would render the product name twice. `absolute` opts this
  // fallback out of the template while keeping the same neutral default title.
  if (!visible) return { title: { absolute: APP_NAME_NEUTRAL }, description: APP_DESCRIPTION };
  const lang = asLocale(locale);
  const name = songTitle(title, artist);
  const description = songDescription(lyricsRaw) || DEFAULT_DESCRIPTION[lang];
  const path = `/songs/${encodeURIComponent(id)}`;
  // Internal paths become absolute against the request origin; external
  // covers keep the strict http(s)-only check from safeHttpUrl.
  const absolutePath = (value: string) => siteOrigin ? new URL(value, siteOrigin).href : value;
  const pageUrl = absolutePath(path);
  const cover = safeHttpUrl(coverUrl);
  const images = [cover ?? absolutePath(`/api/songs/${encodeURIComponent(id)}/cover-image`)];
  return {
    title: name,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      type: 'music.song',
      siteName: SITE_NAME,
      locale: lang === 'ja' ? 'ja_JP' : lang === 'en' ? 'en_US' : lang === 'zh-TW' ? 'zh_TW' : 'zh_CN',
      title: name,
      description,
      url: pageUrl,
      ...(images ? { images } : {}),
    },
    twitter: { card: 'summary_large_image', title: name, description, ...(images ? { images } : {}) },
  };
}
