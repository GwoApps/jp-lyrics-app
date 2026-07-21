import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { and, eq, or } from 'drizzle-orm';
import { getDB, schema } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { fetchLyrics } from '@/lib/lyrics-fetcher';
import { getSpotifyTrack, searchSpotifyTrack } from '@/lib/spotify';

// POST /api/songs/import — import the current/canonical Spotify track through the shared source chain
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const body = await request.json();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
  const spotifyTrackId = typeof body.spotify_track_id === 'string' ? body.spotify_track_id.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }

  const db = getDB();
  const visibleToUser = user.isAdmin
    ? undefined
    : or(eq(schema.songs.createdBy, user.email), eq(schema.songs.isPublic, 1));
  const spotifyTrack = (spotifyTrackId ? await getSpotifyTrack(user.email, spotifyTrackId) : null)
    || await searchSpotifyTrack(user.email, title, artist);
  const existingBySpotify = spotifyTrack
    ? await db.select({ id: schema.songs.id }).from(schema.songs)
      .where(visibleToUser
        ? and(eq(schema.songs.spotifyTrackId, spotifyTrack.id), visibleToUser)
        : eq(schema.songs.spotifyTrackId, spotifyTrack.id)).get()
    : null;
  const existing = existingBySpotify || await db.select({ id: schema.songs.id })
    .from(schema.songs)
    .where(visibleToUser
      ? and(eq(schema.songs.title, title), eq(schema.songs.artist, artist), visibleToUser)
      : and(eq(schema.songs.title, title), eq(schema.songs.artist, artist)))
    .get();

  if (existing) {
    return NextResponse.json({ id: existing.id, alreadyExists: true });
  }

  const { result, source, confidence } = await fetchLyrics(title, artist, {
    spotifyCanonical: spotifyTrack
      ? { name: spotifyTrack.title, artist: spotifyTrack.artist }
      : null,
  });
  if (!result) {
    return NextResponse.json({ error: 'lyrics_not_found', hasLyrics: false }, { status: 404 });
  }

  const nameRow = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(eq(schema.spotifyAuth.userEmail, user.email))
    .get();
  const id = uuidv4();
  await db.insert(schema.songs).values({
    id,
    title,
    artist,
    lyricsRaw: result.plain,
    lyricsFurigana: '[]',
    lyricsSynced: result.synced,
    coverUrl: spotifyTrack?.coverUrl ?? null,
    spotifyTrackId: spotifyTrack?.id ?? null,
    spotifyUri: spotifyTrack?.uri ?? null,
    spotifyAlbum: spotifyTrack?.album ?? null,
    spotifyDurationMs: spotifyTrack?.durationMs ?? null,
    spotifyCanonicalTitle: spotifyTrack?.title ?? null,
    spotifyCanonicalArtist: spotifyTrack?.artist ?? null,
    lyricsSource: source,
    lyricsConfidence: confidence,
    lyricsFetchedAt: new Date().toISOString(),
    createdBy: user.email,
    createdByName: nameRow?.displayName || '',
  });

  return NextResponse.json({
    id,
    alreadyExists: false,
    hasLyrics: true,
    source,
    confidence,
    spotify_track_id: spotifyTrack?.id ?? null,
  }, { status: 201 });
}
