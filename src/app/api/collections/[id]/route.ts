import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// Error codes here match /api/songs/[id]/favorite and the client-side
// `writeErrorMsg` map (SongLibraryPage), so a rename/delete failure renders the
// same localized copy as the create path instead of falling back silently (#392).
const loginRequired = () => NextResponse.json({ error: 'login_required' }, { status: 401 });

// DELETE /api/collections/[id] — delete a collection
//
// Only the grouping row goes away; `collection_songs` cascades and `favorites`
// is untouched — deleting a category never un-favorites a song.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const user = await getAuthUser(request);
  if (!user) return loginRequired();

  const { id } = await params;

  // Ownership check doubles as the existence check: another user's collection
  // must be indistinguishable from a missing one.
  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );
  if (!collection) {
    return NextResponse.json({ error: 'collection_not_found' }, { status: 404 });
  }

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
  if (!user) return loginRequired();

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  const collection = await db.get(
    sql`SELECT id FROM collections WHERE id = ${id} AND user_email = ${user.email}`
  );
  if (!collection) {
    return NextResponse.json({ error: 'collection_not_found' }, { status: 404 });
  }

  await db.update(schema.collections).set({ name }).where(sql`id = ${id}`);

  return NextResponse.json({ id, name });
}
