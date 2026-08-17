import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { findBestMatch, type SongCandidate } from '@/lib/match';

/**
 * Lightweight "now playing" song matcher for the song detail page.
 *
 * Instead of transferring the entire public song list just to match a single
 * Spotify track client-side, this endpoint does the same `findBestMatch` on the
 * server and returns only the winning candidate's summary. The detail page
 * calls it only when there is actually a playing track to match against, so
 * entering a song page (not playing / not connected) never triggers a full
 * list query or download.
 *
 * Matching scope mirrors the old client-side behavior:
 *   - the current user's own songs (any visibility), or
 *   - public songs from any user.
 *   Non-public songs from other users are never returned.
 *
 * GET /api/spotify/match-song?track_id=&title=&artist=
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  const userEmail = user?.email || '';
  const isAdmin = user?.isAdmin === true;

  const trackId = request.nextUrl.searchParams.get('track_id')?.trim() || '';
  const title = request.nextUrl.searchParams.get('title')?.trim() || '';
  const artist = request.nextUrl.searchParams.get('artist')?.trim() || '';
  // Optional: skip a specific song (e.g. the one already rendered on this
  // page) so "查看这首歌"/follow-playing matches an *other* song.
  const excludeId = request.nextUrl.searchParams.get('exclude')?.trim() || '';

  // Without a title there is nothing to match against.
  if (!title) {
    return NextResponse.json({ match: null });
  }

  const db = getDB();

  // Only load the columns `findBestMatch` needs, restricted to songs that are
  // actually eligible for a match (own songs any visibility, or public songs).
  const rows = isAdmin
    ? await db.all(sql`
        SELECT id, title, artist, spotify_track_id, created_by, is_public
        FROM songs
      `)
    : await db.all(sql`
        SELECT id, title, artist, spotify_track_id, created_by, is_public
        FROM songs
        WHERE is_public = 1 OR created_by = ${userEmail}
      `);

  const candidates = (rows as SongCandidate[])
    .filter((row) => row.id !== excludeId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist ?? '',
      spotify_track_id: row.spotify_track_id ?? null,
      created_by: row.created_by ?? '',
      is_public: row.is_public ?? 0,
    }));

  const match = findBestMatch(
    candidates,
    { id: trackId || undefined, name: title, artist },
    userEmail,
  );

  if (!match) {
    return NextResponse.json({ match: null });
  }

  // Only the summary the detail page needs to offer "查看这首歌" / follow-playing.
  return NextResponse.json({
    match: {
      id: match.id,
      title: match.title,
      artist: match.artist,
      spotify_track_id: match.spotify_track_id ?? null,
    },
  });
}
