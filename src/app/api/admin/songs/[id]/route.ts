import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// PUT /api/admin/songs/[id] — update song visibility (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDB();
  const { id } = await params;
  const body = await request.json();
  const { is_public } = body;

  const existing = await db.get(sql`SELECT id FROM songs WHERE id = ${id}`);
  if (!existing) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  if (is_public !== undefined) {
    await db.run(sql`UPDATE songs SET is_public = ${is_public}, updated_at = datetime('now', 'localtime') WHERE id = ${id}`);
  }

  const updated = await db.get(
    sql`SELECT id, title, artist, created_by, created_by_name, is_public, created_at, updated_at FROM songs WHERE id = ${id}`
  );
  return NextResponse.json(updated);
}

// DELETE /api/admin/songs/[id] — delete song (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDB();
  const { id } = await params;

  const existing = await db.get(sql`SELECT id FROM songs WHERE id = ${id}`);
  if (!existing) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  await db.run(sql`DELETE FROM songs WHERE id = ${id}`);
  return NextResponse.json({ success: true });
}
