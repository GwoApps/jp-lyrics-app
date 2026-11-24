/**
 * Search-engine discovery policy (ISSUE #494).
 *
 * robots.txt and sitemap.xml are opt-in: `JPLRC_SEO_ENABLED=true` turns them on,
 * everything else (missing / empty / any other value, case-insensitive) keeps
 * the old behavior — both routes respond 404, so an upgrade never silently
 * enrolls an existing deployment in a search index.
 *
 * Values are read per request (not cached at module scope) so tests and the
 * Workers runtime can change them without a restart.
 */
import type { MetadataRoute } from 'next';
import { sql, type SQL } from 'drizzle-orm';
import { artistHref, splitArtists } from './artists';
import { escapeHtml } from './escape-html';

export const SEO_ENABLED_ENV = 'JPLRC_SEO_ENABLED';
const DENIED_PATH_PREFIXES = ['/admin', '/settings', '/api'] as const;

export function isSeoEnabled(): boolean {
  return process.env[SEO_ENABLED_ENV]?.trim().toLowerCase() === 'true';
}

export interface PublicSongRow {
  id: string;
  title: string;
  artist: string;
}

/** Public sitemap paths derived from public songs. Caller supplies the origin. */
export function buildPublicPaths(songs: readonly PublicSongRow[]): string[] {
  const paths = new Set<string>(['/', '/albums', '/artists']);
  for (const song of songs) {
    if (!song.id) continue;
    paths.add(`/songs/${encodeURIComponent(song.id)}`);
    for (const artist of splitArtists(song.artist)) paths.add(artistHref(artist));
  }
  return [...paths].sort();
}

/**
 * Query for every `is_public = 1` song; private rows and legacy no-owner rows
 * never match. Kept as SQL text so this module stays pure and unit-testable.
 */
export function publicSongsQuery(): SQL<PublicSongRow> {
  return sql<PublicSongRow>`SELECT s.id, s.title, s.artist FROM songs s WHERE s.is_public = 1`;
}

/**
 * App router's robots object. `/api`, `/admin` and `/settings` are disallowed;
 * a sitemap reference is emitted only when an origin is known, so no broken
 * absolute URL is advertised.
 */
export function buildRobots(siteOrigin: string | null): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...DENIED_PATH_PREFIXES],
    },
    ...(siteOrigin ? { sitemap: `${siteOrigin}/sitemap.xml` } : {}),
  };
}

/** XML sitemap with absolute URLs, HTML-escaped and restricted to public pages. */
export function buildSitemap(siteOrigin: string, songs: readonly PublicSongRow[]): string {
  const entries = buildPublicPaths(songs)
    .map((path) => `  <url><loc>${escapeHtml(new URL(path, siteOrigin).href)}</loc></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
