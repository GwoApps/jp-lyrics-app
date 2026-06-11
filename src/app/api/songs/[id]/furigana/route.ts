import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import type { Song } from '@/lib/types';

// PUT /api/songs/[id]/furigana — save client-computed furigana to server
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const body = await request.json();
  const { lyrics_furigana } = body;

  if (!lyrics_furigana) {
    return NextResponse.json({ error: 'Missing lyrics_furigana' }, { status: 400 });
  }

  const existing = await db.get(sql`SELECT id FROM songs WHERE id = ${id}`) as unknown as Song | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
  }

  const furiganaStr = typeof lyrics_furigana === 'string' ? lyrics_furigana : JSON.stringify(lyrics_furigana);

  await db.update(schema.songs).set({
    lyricsFurigana: furiganaStr,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(sql`id = ${id}`);

  return NextResponse.json({ ok: true });
}
