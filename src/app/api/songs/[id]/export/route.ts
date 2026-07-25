import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const user = await getAuthUser(request);
  const format = request.nextUrl.searchParams.get('format') || 'text';

  const song = await db.select({
    title: schema.songs.title,
    artist: schema.songs.artist,
    lyrics_raw: schema.songs.lyricsRaw,
    lyrics_synced: schema.songs.lyricsSynced,
    lyrics_furigana: schema.songs.lyricsFurigana,
    reading_scheme: schema.songs.readingScheme,
    created_by: schema.songs.createdBy,
    is_public: schema.songs.isPublic,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();

  if (!song || (song.is_public !== 1 && !user?.isAdmin && song.created_by !== user?.id)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  const filename = `${song.title}${song.artist ? ` - ${song.artist}` : ''}`;

  if (format === 'lrc' && song.lyrics_synced) {
    return new NextResponse(song.lyrics_synced, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.lrc"`,
      },
    });
  }

  if (format === 'html') {
    let furiganaLines: { segments: { text: string; reading?: string }[] }[] = [];
    try {
      if (song.lyrics_furigana) furiganaLines = JSON.parse(song.lyrics_furigana);
    } catch { /* */ }

    const htmlLines = furiganaLines.length > 0
      ? furiganaLines.map(line => {
          if (line.segments.length === 0) return '<p class="empty">&nbsp;</p>';
          const inner = line.segments.map(seg => {
            const text = escapeHtml(seg.text);
            if (!seg.reading) return text;
            const language = song.reading_scheme === 'yue-jyutping' ? ' lang="yue-Latn"' : '';
            return `<ruby>${text}<rp>(</rp><rt${language}>${escapeHtml(seg.reading)}</rt><rp>)</rp></ruby>`;
          }).join('');
          return `<p>${inner}</p>`;
        }).join('\n')
      : (song.lyrics_raw || '').split('\n').map((l: string) => `<p>${l ? escapeHtml(l) : '&nbsp;'}</p>`).join('\n');

    const documentLanguage = song.reading_scheme === 'yue-jyutping' ? 'yue-Hant' : 'ja';

    const html = `<!DOCTYPE html>
<html lang="${documentLanguage}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(song.title)}</title>
<style>
  body { max-width: 600px; margin: 2rem auto; padding: 0 1rem; font-family: 'Noto Sans JP', sans-serif; line-height: 2.2; color: #1a1a1a; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .artist { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  p { margin: 0; }
  .empty { height: 1.2em; }
  rt { font-size: 0.5em; color: #888; }
  ruby:has(rt[lang="yue-Latn"]) { ruby-overhang: none; white-space: nowrap; }
  rt[lang="yue-Latn"] { padding-inline: 0.08em; }
</style>
</head>
<body>
<h1>${escapeHtml(song.title)}</h1>
${song.artist ? `<p class="artist">${escapeHtml(song.artist)}</p>` : ''}
${htmlLines}
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.html"`,
      },
    });
  }

  // Default: plain text
  const text = song.lyrics_raw || '';
  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.txt"`,
    },
  });
}
