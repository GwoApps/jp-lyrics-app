import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';
import { resolveSiteOrigin } from '@/app/layout';
import { getDB } from '@/lib/db';
import { buildPublicPaths, isSeoEnabled, publicSongsQuery } from '@/lib/seo';

// Read the switch and the public-song list per request, never at build time.
export const dynamic = 'force-dynamic';

/** ISSUE #494: sitemap is opt-in and lists only public songs and their pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isSeoEnabled()) notFound();
  const siteOrigin = await resolveSiteOrigin();
  if (!siteOrigin) return [];
  const songs = await getDB().all(publicSongsQuery());
  return buildPublicPaths(songs).map((path) => ({ url: new URL(path, siteOrigin).href }));
}
