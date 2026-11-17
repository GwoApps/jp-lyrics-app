import type { Metadata } from 'next';
import { readRequestLocaleForMetadata } from '@/app/layout';
import { getDB, schema } from '@/lib/db';
import { getAuthUserFromCookies } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';
import { eq } from 'drizzle-orm';
import { buildSongMetadata } from '@/lib/route-metadata';

/**
 * Metadata for `/songs/[id]` and its child routes (share, edit, translation…).
 * This layout is a Server Component, unlike the client pages it wraps, so
 * crawlers and link previews get a per-song title, description and cover.
 */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const [locale, user] = await Promise.all([readRequestLocaleForMetadata(), getAuthUserFromCookies()]);
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
    return buildSongMetadata({ id, title: '', visible: false, locale });
  }
  return buildSongMetadata({
    id,
    title: song.title,
    artist: song.artist,
    lyricsRaw: song.lyricsRaw,
    coverUrl: song.coverUrl,
    locale,
    visible: true,
  });
}

export default function SongsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
