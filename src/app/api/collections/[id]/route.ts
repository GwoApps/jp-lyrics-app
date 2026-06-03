import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// DELETE /api/collections/[id] — delete a collection
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const collection = db.prepare(
    'SELECT id FROM collections WHERE id = ? AND user_email = ?'
  ).get(id, user.email);

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Delete collection (cascade will handle collection_songs)
  db.prepare('DELETE FROM collections WHERE id = ?').run(id);

  return NextResponse.json({ success: true });
}

// PUT /api/collections/[id] — rename a collection
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const { name } = await request.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  // Verify ownership
  const collection = db.prepare(
    'SELECT id FROM collections WHERE id = ? AND user_email = ?'
  ).get(id, user.email);

  if (!collection) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(name.trim(), id);

  return NextResponse.json({ id, name: name.trim() });
}
