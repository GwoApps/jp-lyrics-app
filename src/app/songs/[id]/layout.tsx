import type { Metadata } from 'next';
import { readRequestLocaleForMetadata, resolveSiteOrigin } from '@/app/layout';
import { getDB, schema } from '@/lib/db';
import { getAuthUserFromCookies } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';
import { eq } from 'drizzle-orm';
import { buildSongMetadata } from '@/lib/route-metadata';
import { buildSsrLyrics } from '@/lib/ssr-lyrics';
import { InitialLyricsProvider } from '@/components/song/InitialLyrics';
import { hasLyricsContent } from '@/lib/empty-lyrics';

/** Private song HTML is viewer-specific; never store it in a shared cache. */
export const dynamic = 'force-dynamic';

/**
 * Metadata for `/songs/[id]` and its child routes (share, edit, translation…).
 * This layout is a Server Component, unlike the client pages it wraps, so
 * crawlers and link previews get a per-song title, description and cover.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const [locale, user, siteOrigin] = await Promise.all([readRequestLocaleForMetadata(), getAuthUserFromCookies(), resolveSiteOrigin()]);
  const song = await getDB()
    .select({
      id: schema.songs.id,
      title: schema.songs.title,
      artist: schema.songs.artist,
      lyricsRaw: schema.songs.lyricsRaw,
      coverUrl: schema.songs.coverUrl,
      createdBy: schema.songs.createdBy,
      isPublic: schema.songs.isPublic,
    })
    .from(schema.songs)
    .where(eq(schema.songs.id, id))
    .get();
  const visible = isSongVisibleToUser(song, user);
  if (!song || !visible) {
    return buildSongMetadata({ id, title: '', visible: false, locale, siteOrigin });
  }
  return buildSongMetadata({
    id,
    title: song.title,
    artist: song.artist,
    lyricsRaw: song.lyricsRaw,
    coverUrl: song.coverUrl,
    locale,
    visible: true,
    siteOrigin,
  });
}

/**
 * The detail page is a client component that fetches `/api/songs/[id]` after
 * hydration, so its first HTML had no lyric text (issue #465). This layout is
 * a Server Component and already reads the row for metadata, so it supplies
 * the same lyrics as a read-only first-paint block through context. The client
 * page swaps in its interactive list once the fetch settles.
 *
 * ACL is checked before embedding, and the segment is `force-dynamic` so a
 * private song's individualized HTML is never stored in a shared cache.
 */
export default async function SongsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [user, song] = await Promise.all([
    getAuthUserFromCookies(),
    getDB()
      .select({
        id: schema.songs.id,
        lyricsRaw: schema.songs.lyricsRaw,
        readingScheme: schema.songs.readingScheme,
        createdBy: schema.songs.createdBy,
        isPublic: schema.songs.isPublic,
      })
      .from(schema.songs)
      .where(eq(schema.songs.id, id))
      .get(),
  ]);
  const visible = isSongVisibleToUser(song, user);
  const payload = visible && song && hasLyricsContent(song.lyricsRaw)
    ? buildSsrLyrics({ songId: id, lyricsRaw: song.lyricsRaw, readingScheme: song.readingScheme })
    : null;
  return <InitialLyricsProvider value={payload}>{children}</InitialLyricsProvider>;
}
