import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql, and } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isSongVisibleToUser, songVisibilityWhere, SONGS_S_COLUMNS } from '@/lib/song-visibility';

// GET /api/collections/[id]/songs — list songs in a collection
//
// Read-only by design: membership is written exclusively through
// `PUT /api/songs/[id]/favorite`, which replaces the whole category set in one
// atomic batch. The old incremental `POST`/`DELETE` handlers wrote the same
// table with the opposite semantics and had no caller, so a later change to one
// path would silently drift from the other (#392).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json([]);
  }

  const { id } = await params;

  // Verify ownership
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );

  if (!collection) {
    return NextResponse.json([]);
  }

  // Only expose songs the current user is allowed to read. A collection may
  // have been populated before the ACL existed, so the visibility check must be
  // applied here at read time — never rely on the write-time check alone.
  const songs = await db.all(sql`
    SELECT s.id, s.title, s.artist, s.created_by, s.created_by_name, s.is_public, s.created_at, s.updated_at
    FROM songs s
    JOIN collection_songs cs ON s.id = cs.song_id
    WHERE cs.collection_id = ${id} AND ${and(songVisibilityWhere(user, SONGS_S_COLUMNS))}
    ORDER BY s.title, s.id
  `) as Array<{ id: string; title: string; artist: string; created_by: string; created_by_name: string; is_public: number; created_at: string; updated_at: string }>;

  // Filter through the ACL, then strip the internal ACL columns so the response
  // shape stays identical to before (no created_by / is_public leakage).
  const visible = songs
    .filter((song) => isSongVisibleToUser(song, user))
    .map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      created_by_name: song.created_by_name,
      created_at: song.created_at,
      updated_at: song.updated_at,
    }));

  return NextResponse.json(visible);
}
