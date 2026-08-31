import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, eq, and, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';

// POST /api/songs/[id]/favorite — toggle favorite
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const { id } = await params;

  // Only songs the user can actually read may be favorited. This prevents a
  // user from probing private song UUIDs (or bookmarking songs they cannot
  // see) through the favorites path.
  const song = await db.get(
    sql`SELECT id, created_by, is_public FROM songs WHERE id = ${id}`
  ) as { id: string; created_by: string; is_public: number } | undefined;
  if (!song || !isSongVisibleToUser(song, user)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  // Check if already favorited
  const existing = await db.select({ songId: schema.favorites.songId })
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)))
    .get();

  if (existing) {
    // Remove favorite
    await db.delete(schema.favorites)
      .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)));
    return NextResponse.json({ favorited: false });
  } else {
    // Add favorite
    await db.insert(schema.favorites).values({ userEmail: user.email, songId: id });
    return NextResponse.json({ favorited: true });
  }
}

// GET /api/songs/[id]/favorite — check if favorited
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ favorited: false });
  }

  const { id } = await params;

  // Don't leak private-song existence through the favorite lookup: a song the
  // user cannot read must look identical to a song that does not exist.
  const song = await db.get(
    sql`SELECT id, created_by, is_public FROM songs WHERE id = ${id}`
  ) as { id: string; created_by: string; is_public: number } | undefined;
  if (!song || !isSongVisibleToUser(song, user)) {
    return NextResponse.json({ favorited: false });
  }

  const existing = await db.select({ songId: schema.favorites.songId })
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)))
    .get();

  return NextResponse.json({ favorited: !!existing });
}
