import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// PUT /api/admin/users/[id] — update user (admin only)
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
  const { is_admin, is_blocked, blocked_reason } = body;

  const existing = await db.get(sql`SELECT id FROM users WHERE id = ${id}`);
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (is_admin !== undefined) {
    await db.run(sql`UPDATE users SET is_admin = ${is_admin}, updated_at = datetime('now', 'localtime') WHERE id = ${id}`);
  }
  if (is_blocked !== undefined) {
    await db.run(sql`UPDATE users SET is_blocked = ${is_blocked}, blocked_reason = ${blocked_reason || ''}, updated_at = datetime('now', 'localtime') WHERE id = ${id}`);
  }

  const updated = await db.get(
    sql`SELECT id, display_name, is_admin, is_blocked, blocked_reason, created_at, updated_at FROM users WHERE id = ${id}`
  );
  return NextResponse.json(updated);
}

// DELETE /api/admin/users/[id] — delete user and their data (admin only)
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

  const existing = await db.get(sql`SELECT id FROM users WHERE id = ${id}`);
  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Delete user's related data
  await db.run(sql`DELETE FROM spotify_auth WHERE user_email = ${id}`);
  await db.run(sql`DELETE FROM favorites WHERE user_email = ${id}`);
  // Delete collection songs for user's collections
  await db.run(sql`DELETE FROM collection_songs WHERE collection_id IN (SELECT id FROM collections WHERE user_email = ${id})`);
  await db.run(sql`DELETE FROM collections WHERE user_email = ${id}`);
  // Delete songs created by this user
  await db.run(sql`DELETE FROM songs WHERE created_by = ${id}`);
  // Delete the user
  await db.run(sql`DELETE FROM users WHERE id = ${id}`);

  return NextResponse.json({ success: true });
}
