import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';

// POST /api/songs/[id]/cover — upload a custom album cover (multipart form-data, field "file").
// The image is stored as a BLOB in the song_covers table — this works on both
// the local SQLite deployment and Cloudflare D1 (Workers have no persistent
// filesystem, so data/covers/ files would not survive there).
// cover_url points at the local cover-image route (versioned to bust caches)
// and the cached palette is reset.
// DELETE /api/songs/[id]/cover — remove a custom cover and restore cover_url to null.
const MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const existing = await db.select({
    createdBy: schema.songs.createdBy,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (!(file.type in MIME_TYPES)) {
    return NextResponse.json({ error: 'unsupported_image_type' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'cover_too_large' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  await db.insert(schema.songCovers).values({
    songId: id,
    mime: file.type,
    data: bytes,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).onConflictDoUpdate({
    target: schema.songCovers.songId,
    set: {
      mime: file.type,
      data: bytes,
      updatedAt: sql`(datetime('now', 'localtime'))`,
    },
  }).run();

  await db.update(schema.songs).set({
    coverUrl: `/api/songs/${id}/cover-image?v=${Date.now()}`,
    coverPalette: null,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id)).run();

  const updated = await db.select({ coverUrl: schema.songs.coverUrl }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  return NextResponse.json({ cover_url: updated?.coverUrl ?? null });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const existing = await db.select({
    createdBy: schema.songs.createdBy,
    coverUrl: schema.songs.coverUrl,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Only remove local covers; external (Spotify) URLs are untouched.
  if (existing.coverUrl?.startsWith('/api/songs/')) {
    await db.delete(schema.songCovers).where(eq(schema.songCovers.songId, id)).run();
  }
  await db.update(schema.songs).set({
    coverUrl: null,
    coverPalette: null,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id)).run();

  return NextResponse.json({ cover_url: null });
}
