import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// PUT /api/songs/[id]/furigana — save client-computed furigana to server
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const body = await request.json();
  const { lyrics_furigana } = body;

  if (!lyrics_furigana) {
    return NextResponse.json({ error: 'missing_furigana' }, { status: 400 });
  }

  const existing = await db.get(sql`SELECT id, created_by FROM songs WHERE id = ${id}`) as { id: string; created_by: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const furiganaStr = typeof lyrics_furigana === 'string' ? lyrics_furigana : JSON.stringify(lyrics_furigana);

  await db.update(schema.songs).set({
    lyricsFurigana: furiganaStr,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(sql`id = ${id}`);

  return NextResponse.json({ ok: true });
}
