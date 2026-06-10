import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// DELETE /api/collections/[id] — delete a collection
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

  // Verify ownership
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Delete collection (cascade will handle collection_songs)
  await db.delete(schema.collections).where(sql`id = ${id}`);

  return NextResponse.json({ success: true });
}

// PUT /api/collections/[id] — rename a collection
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { name } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  // Verify ownership
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.update(schema.collections).set({ name: name.trim() }).where(sql`id = ${id}`);

  return NextResponse.json({ id, name: name.trim() });
}
