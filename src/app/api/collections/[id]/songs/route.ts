import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// GET /api/collections/[id]/songs — list songs in a collection
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = getAuthUser(request);
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

  const songs = await db.all(sql`
    SELECT s.id, s.title, s.artist, s.created_by_name, s.created_at, s.updated_at
    FROM songs s
    JOIN collection_songs cs ON s.id = cs.song_id
    WHERE cs.collection_id = ${id}
    ORDER BY cs.sort_order, s.title
  `);

  return NextResponse.json(songs);
}

// POST /api/collections/[id]/songs — add a song to a collection
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { songId } = await request.json();

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

  // Get max sort order
  const maxOrder = await db.get(
    sql`SELECT MAX(sort_order) as max FROM collection_songs WHERE collection_id = ${id}`
  ) as { max: number | null };

  const sortOrder = (maxOrder.max ?? -1) + 1;

  // Add song (ignore if already exists)
  try {
    await db.insert(schema.collectionSongs).values({
      collectionId: id,
      songId,
      sortOrder,
    });
  } catch {
    // Already in collection
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/collections/[id]/songs — remove a song from a collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = getAuthUser(request);
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

  await db.delete(schema.collectionSongs)
    .where(sql`collection_id = ${id} AND song_id = ${songId}`);

  return NextResponse.json({ success: true });
}
