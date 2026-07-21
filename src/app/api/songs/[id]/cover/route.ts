import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser, searchSpotifyTrack } from '@/lib/spotify';

// GET /api/songs/[id]/cover — return cached cover URL or search Spotify
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    title: schema.songs.title,
    artist: schema.songs.artist,
    coverUrl: schema.songs.coverUrl,
    spotifyTrackId: schema.songs.spotifyTrackId,
    createdBy: schema.songs.createdBy,
    isPublic: schema.songs.isPublic,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get() as {
    id: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    spotifyTrackId: string | null;
    createdBy: string;
    isPublic: number;
  } | undefined;

  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  if (!existing.isPublic && !user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Return cached URL if available
  if (existing.coverUrl && existing.spotifyTrackId) {
    return NextResponse.json({ cover_url: existing.coverUrl, spotify_track_id: existing.spotifyTrackId });
  }

  // Require a valid Spotify token to search
  const token = await getSpotifyTokenForUser(user.id);
  if (!token) {
    return NextResponse.json({ error: 'spotify_not_connected' }, { status: 400 });
  }

  const track = await searchSpotifyTrack(user.id, existing.title, existing.artist);
  if (!track) {
    return NextResponse.json({ error: 'cover_not_found' }, { status: 404 });
  }

  // Public readers may resolve a cover for display, but only owner/admin can mutate metadata.
  if (user.isAdmin || existing.createdBy === user.id) {
    await db.update(schema.songs).set({
      coverUrl: track.coverUrl || existing.coverUrl,
      spotifyTrackId: track.id,
      spotifyUri: track.uri,
      spotifyAlbum: track.album,
      spotifyDurationMs: track.durationMs,
      spotifyCanonicalTitle: track.title,
      spotifyCanonicalArtist: track.artist,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.songs.id, id));
  }

  return NextResponse.json({ cover_url: track.coverUrl || existing.coverUrl, spotify_track_id: track.id });
}
