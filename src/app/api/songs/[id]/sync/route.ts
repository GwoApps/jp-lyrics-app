import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { fetchLyrics } from '@/lib/lyrics-fetcher';
import { parseLrc } from '@/lib/lrc';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const song = await db.select({
    id: schema.songs.id,
    title: schema.songs.title,
    artist: schema.songs.artist,
    spotifyTrackId: schema.songs.spotifyTrackId,
    createdBy: schema.songs.createdBy,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();

  if (!song) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && song.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const spotifyTrack = (song.spotifyTrackId ? await getSpotifyTrack(user.email, song.spotifyTrackId) : null)
    || await searchSpotifyTrack(user.email, song.title, song.artist);
  const spotifyCanonical = spotifyTrack
    ? { name: spotifyTrack.title, artist: spotifyTrack.artist }
    : null;
  const { result, source, confidence } = await fetchLyrics(song.title, song.artist, { spotifyCanonical });

  if (!result) {
    return NextResponse.json({ synced: false, error: 'lyrics_not_found' }, { status: 404 });
  }

  await db.update(schema.songs).set({
    lyricsRaw: result.plain,
    lyricsFurigana: '[]',
    lyricsSynced: result.synced,
    lyricsSource: source,
    lyricsConfidence: confidence,
    lyricsFetchedAt: new Date().toISOString(),
    ...(spotifyTrack ? {
      spotifyTrackId: spotifyTrack.id,
      spotifyUri: spotifyTrack.uri,
      spotifyAlbum: spotifyTrack.album,
      spotifyDurationMs: spotifyTrack.durationMs,
      spotifyCanonicalTitle: spotifyTrack.title,
      spotifyCanonicalArtist: spotifyTrack.artist,
      coverUrl: spotifyTrack.coverUrl,
    } : {}),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id));

  const parsed = result.synced ? parseLrc(result.synced) : [];
  return NextResponse.json({
    synced: parsed.length > 0,
    source,
    confidence,
    lines: parsed.length,
    lrc: result.synced,
    spotify_track_id: spotifyTrack?.id ?? null,
  });
}
