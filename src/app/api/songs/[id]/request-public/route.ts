import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// POST /api/songs/[id]/request-public — request public visibility (song owner only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;

  const song = await db.get(
    sql`SELECT id, created_by, is_public, public_requested FROM songs WHERE id = ${id}`
  ) as { id: string; created_by: string; is_public: number; public_requested: number } | undefined;

  if (!song) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  // Only the song owner can request public
  if (song.created_by !== user.id) {
    return NextResponse.json({ error: 'Only the song owner can request public visibility' }, { status: 403 });
  }

  // Already public
  if (song.is_public === 1) {
    return NextResponse.json({ error: 'Song is already public' }, { status: 400 });
  }

  // Already requested
  if (song.public_requested === 1) {
    return NextResponse.json({ error: 'Public visibility already requested' }, { status: 400 });
  }

  await db.run(sql`UPDATE songs SET public_requested = 1, updated_at = datetime('now', 'localtime') WHERE id = ${id}`);
  return NextResponse.json({ success: true, public_requested: 1 });
}

// DELETE /api/songs/[id]/request-public — cancel public request (song owner only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;

  const song = await db.get(
    sql`SELECT id, created_by FROM songs WHERE id = ${id}`
  ) as { id: string; created_by: string } | undefined;

  if (!song) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  if (song.created_by !== user.id) {
    return NextResponse.json({ error: 'Only the song owner can cancel' }, { status: 403 });
  }

  await db.run(sql`UPDATE songs SET public_requested = 0, updated_at = datetime('now', 'localtime') WHERE id = ${id}`);
  return NextResponse.json({ success: true, public_requested: 0 });
}
