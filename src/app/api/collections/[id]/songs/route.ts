import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';
import { parseJsonBody } from '@/lib/admin';

// GET /api/collections/[id]/songs — list songs in a collection
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
    WHERE cs.collection_id = ${id}
    ORDER BY cs.sort_order, s.title
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

// POST /api/collections/[id]/songs — add a song to a collection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { songId } = parsed as { songId?: unknown };

  if (!songId) {
    return NextResponse.json({ error: 'songId is required' }, { status: 400 });
  }

  // Verify ownership
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // ACL gate: the song must be visible to the current user (public, own, or
  // admin). This closes the IDOR where a logged-in user could add someone
  // else's private song to their own collection and then read its metadata
  // through the collection GET. Invisible → 404 (do not reveal existence).
  const song = await db.get(
    sql`SELECT id, created_by, is_public FROM songs WHERE id = ${songId}`
  ) as { id: string; created_by: string; is_public: number } | undefined;
  if (!song || !isSongVisibleToUser(song, user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Get max sort order
  const maxOrder = await db.get(
    sql`SELECT MAX(sort_order) as max FROM collection_songs WHERE collection_id = ${id}`
  ) as { max: number | null };

  const sortOrder = (maxOrder.max ?? -1) + 1;

  // Add song. Only swallow the unique-constraint violation (already in the
  // collection); any other database error must surface as a 5xx instead of
  // being disguised as a successful duplicate insert.
  try {
    await db.insert(schema.collectionSongs).values({
      collectionId: id,
      songId,
      sortOrder,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Already in collection
    } else {
      throw error;
    }
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/collections/[id]/songs — remove a song from a collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const songId = request.nextUrl.searchParams.get('songId');

  if (!songId) {
    return NextResponse.json({ error: 'songId is required' }, { status: 400 });
  }

  // Verify ownership
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Only allow removing songs the current user can read — otherwise a user
  // could delete another user's private song out of a (shared or leaked)
  // collection. Invisible → 404.
  const song = await db.get(
    sql`SELECT id, created_by, is_public FROM songs WHERE id = ${songId}`
  ) as { id: string; created_by: string; is_public: number } | undefined;
  if (!song || !isSongVisibleToUser(song, user)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.delete(schema.collectionSongs)
    .where(sql`collection_id = ${id} AND song_id = ${songId}`);

  return NextResponse.json({ success: true });
}

/**
 * Best-effort detection of a primary-key / unique-constraint violation, so
 * duplicate inserts are treated as no-ops while real database errors still
 * propagate. Works across D1 / Turso / libsql, whose drivers report slightly
 * different error shapes.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { message?: unknown; code?: unknown };
  const message = typeof e.message === 'string' ? e.message : '';
  const code = typeof e.code === 'string' ? e.code : '';
  return /UNIQUE constraint failed/i.test(message)
    || /PRIMARY KEY constraint failed/i.test(message)
    || /constraint failed/i.test(message)
    || /SQLITE_CONSTRAINT/i.test(code);
}
