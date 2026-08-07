import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { normalizeReadingScheme } from '@/lib/lyrics-reading';
import { buildExport, type ExportFormat, type ExportReadingMode } from '@/lib/lyrics-export';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const user = await getAuthUser(request);

  const formatParam = request.nextUrl.searchParams.get('format') || 'text';
  const format: ExportFormat = formatParam === 'lrc' || formatParam === 'html' ? formatParam : 'text';
  const readingParam = request.nextUrl.searchParams.get('reading') || 'none';
  const reading: ExportReadingMode = readingParam === 'furigana' || readingParam === 'romaji' ? readingParam : 'none';
  const includeTranslation = request.nextUrl.searchParams.get('include_translation') === '1';

  const song = await db.select({
    title: schema.songs.title,
    artist: schema.songs.artist,
    lyrics_raw: schema.songs.lyricsRaw,
    lyrics_synced: schema.songs.lyricsSynced,
    lyrics_furigana: schema.songs.lyricsFurigana,
    lyrics_translation: schema.songs.lyricsTranslation,
    reading_scheme: schema.songs.readingScheme,
    created_by: schema.songs.createdBy,
    is_public: schema.songs.isPublic,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();

  if (!song || (song.is_public !== 1 && !user?.isAdmin && song.created_by !== user?.id)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  const filename = `${song.title}${song.artist ? ` - ${song.artist}` : ''}`;
  const { body, contentType, extension } = buildExport(
    {
      title: song.title,
      artist: song.artist,
      lyrics_raw: song.lyrics_raw,
      lyrics_synced: song.lyrics_synced,
      lyrics_furigana: song.lyrics_furigana,
      lyrics_translation: song.lyrics_translation,
      reading_scheme: normalizeReadingScheme(song.reading_scheme),
    },
    { format, includeTranslation, reading },
  );

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.${extension}"`,
    },
  });
}
