import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { repairLyricsHtmlEntities } from '@/lib/lyrics-entity';
import { nowUtcSql } from '@/lib/db-time-sql';

/**
 * POST /api/songs/[id]/repair-lyrics-entities — decode provider HTML entities in
 * stored lyrics (ISSUE #428).
 *
 * PetitLyrics answers with encoded text, and rows written before the extractor
 * decoded it hold `&#039;` / `&quot;` verbatim: the owner reads garbage, the
 * reading cache was tokenized on the entity characters, and copy / export /
 * share carry it forward. The extractor now decodes at the source, but the rows
 * already stored still need a fix.
 *
 * Deliberately NOT a startup sweep and not a migration script: rewriting the
 * lyrics a reader sees is an edit, so the detail page asks the song's owner and
 * this route only runs when they say yes (a declined prompt is remembered per
 * song, so the same question is never asked twice).
 *
 * The rewrite is a compare-and-set on both text columns, so a lyrics write that
 * landed meanwhile wins and the caller simply reports nothing changed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    lyricsRaw: schema.songs.lyricsRaw,
    lyricsSynced: schema.songs.lyricsSynced,
    lyricsFurigana: schema.songs.lyricsFurigana,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Decoding preserves the line count, so the translation cache (indexed by row)
  // stays aligned and is deliberately left alone.
  const repair = repairLyricsHtmlEntities({
    raw: existing.lyricsRaw,
    synced: existing.lyricsSynced,
    furigana: existing.lyricsFurigana,
  });
  if (!repair.changed) {
    return NextResponse.json({ ok: true, changed: false, furigana_action: repair.furiganaAction });
  }

  const updated = await db.update(schema.songs).set({
    lyricsRaw: repair.raw,
    lyricsSynced: repair.synced,
    ...(repair.furiganaAction === 'unchanged' ? {} : { lyricsFurigana: repair.furigana }),
    updatedAt: nowUtcSql(),
  }).where(and(
    eq(schema.songs.id, id),
    eq(schema.songs.lyricsRaw, existing.lyricsRaw),
    eq(schema.songs.lyricsSynced, existing.lyricsSynced),
  )).returning({ id: schema.songs.id }).get();

  if (!updated) {
    return NextResponse.json({ error: 'stale_lyrics' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, changed: true, furigana_action: repair.furiganaAction });
}
