import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, eq, and, inArray, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { isSongVisibleToUser } from '@/lib/song-visibility';

async function contextFor(request: NextRequest, id: string) {
  const user = await getAuthUser(request);
  if (!user) return { error: NextResponse.json({ error: 'login_required' }, { status: 401 }) };
  const db = getDB();
  const song = (await db.get(sql`SELECT id, created_by, is_public FROM songs WHERE id = ${id}`)) as { id: string; created_by: string; is_public: number } | undefined;
  if (!song || !isSongVisibleToUser(song, user)) {
    return { error: NextResponse.json({ error: 'song_not_found' }, { status: 404 }) };
  }
  return { user, db };
}

type Params = { params: Promise<{ id: string }> };

// POST is intentionally idempotent: clicking an empty star always adds the song
// to the default category; removing a favorite is an explicit DELETE action.
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await contextFor(request, id);
  if ('error' in ctx) return ctx.error;
  const { db, user } = ctx;
  await db.insert(schema.favorites)
    .values({ userEmail: user.email, songId: id, inUnclassified: 1 })
    .onConflictDoNothing();
  return NextResponse.json({ favorited: true });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await contextFor(request, id);
  if ('error' in ctx) return ctx.error;
  const { db, user } = ctx;
  const favorite = await db.select({ inUnclassified: schema.favorites.inUnclassified })
    .from(schema.favorites)
    .where(and(eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id)))
    .get();
  const memberships = await db.select({ id: schema.collectionSongs.collectionId })
    .from(schema.collectionSongs)
    .innerJoin(schema.collections, eq(schema.collections.id, schema.collectionSongs.collectionId))
    .where(and(eq(schema.collections.userEmail, user.email), eq(schema.collectionSongs.songId, id)));
  return NextResponse.json({
    favorited: !!favorite,
    inUnclassified: favorite?.inUnclassified === 1,
    collectionIds: memberships.map((row: { id: string }) => row.id),
  });
}

// Replace all categories together. Validation happens *before* the atomic batch;
// both favorite and collection memberships must agree even on failed writes.
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await contextFor(request, id);
  if ('error' in ctx) return ctx.error;
  const { db, user } = ctx;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_selection' }, { status: 400 });
  }
  const value = body as { inUnclassified?: unknown; collectionIds?: unknown; newCollections?: unknown } | null;
  const requestedNew = value?.newCollections ?? [];
  if (!value || typeof value.inUnclassified !== 'boolean'
    || !Array.isArray(value.collectionIds) || value.collectionIds.length > 100
    || value.collectionIds.some((x: unknown) => typeof x !== 'string' || !x.length || x.length > 100)
    || !Array.isArray(requestedNew) || requestedNew.length > 100
    || requestedNew.some((x: unknown) => typeof x !== 'string' || !x.trim() || x.trim().length > 100)
    || value.collectionIds.length + requestedNew.length > 100) {
    return NextResponse.json({ error: 'invalid_selection' }, { status: 400 });
  }
  const ids = [...new Set(value.collectionIds as string[])];
  const newCollections = (requestedNew as string[]).map((name) => ({ id: uuidv4(), name: name.trim(), userEmail: user.email }));
  if (!value.inUnclassified && ids.length === 0 && newCollections.length === 0) {
    return NextResponse.json({ error: 'selection_required' }, { status: 400 });
  }
  if (ids.length) {
    const owned = await db.select({ id: schema.collections.id }).from(schema.collections)
      .where(and(eq(schema.collections.userEmail, user.email), inArray(schema.collections.id, ids)));
    if (owned.length !== ids.length) {
      return NextResponse.json({ error: 'collection_not_found' }, { status: 404 });
    }
  }

  const writes = [
    db.insert(schema.favorites)
      .values({ userEmail: user.email, songId: id, inUnclassified: value.inUnclassified ? 1 : 0 })
      .onConflictDoUpdate({
        target: [schema.favorites.userEmail, schema.favorites.songId],
        set: { inUnclassified: value.inUnclassified ? 1 : 0 },
      }),
    db.delete(schema.collectionSongs).where(and(
      eq(schema.collectionSongs.songId, id),
      inArray(schema.collectionSongs.collectionId,
        db.select({ id: schema.collections.id }).from(schema.collections)
          .where(eq(schema.collections.userEmail, user.email))),
    )),
    ...ids.map((collectionId) => db.insert(schema.collectionSongs)
      .values({ collectionId, songId: id, sortOrder: 0 })),
    ...newCollections.flatMap((collection) => [
      db.insert(schema.collections).values(collection),
      db.insert(schema.collectionSongs).values({ collectionId: collection.id, songId: id, sortOrder: 0 }),
    ]),
  ];
  await db.batch(writes);
  return NextResponse.json({
    favorited: true, inUnclassified: value.inUnclassified,
    collectionIds: [...ids, ...newCollections.map((collection) => collection.id)],
    createdCollections: newCollections.map(({ id, name }) => ({ id, name, songCount: 1 })),
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const ctx = await contextFor(request, id);
  if ('error' in ctx) return ctx.error;
  const { db, user } = ctx;
  await db.batch([
    db.delete(schema.collectionSongs).where(and(
      eq(schema.collectionSongs.songId, id),
      inArray(schema.collectionSongs.collectionId,
        db.select({ id: schema.collections.id }).from(schema.collections)
          .where(eq(schema.collections.userEmail, user.email))),
    )),
    db.delete(schema.favorites).where(and(
      eq(schema.favorites.userEmail, user.email), eq(schema.favorites.songId, id))),
  ]);
  return NextResponse.json({ favorited: false });
}
