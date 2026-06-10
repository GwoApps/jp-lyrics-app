import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const format = request.nextUrl.searchParams.get('format') || 'text';

  const song = await db.get(sql`SELECT title, artist, lyrics_raw, lyrics_synced, lyrics_furigana FROM songs WHERE id = ${id}`) as {
    title: string;
    artist: string;
    lyrics_raw: string;
    lyrics_synced: string;
    lyrics_furigana: string;
  } | undefined;

  if (!song) {
    return NextResponse.json({ error: 'Song not found' }, { status: 404 });
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
            if (!seg.reading) return seg.text;
            return `<ruby>${seg.text}<rp>(</rp><rt>${seg.reading}</rt><rp>)</rp></ruby>`;
          }).join('');
          return `<p>${inner}</p>`;
        }).join('\n')
      : (song.lyrics_raw || '').split('\n').map(l => `<p>${l || '&nbsp;'}</p>`).join('\n');

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${song.title}</title>
<style>
  body { max-width: 600px; margin: 2rem auto; padding: 0 1rem; font-family: 'Noto Sans JP', sans-serif; line-height: 2.2; color: #1a1a1a; }
  h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
  .artist { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
  p { margin: 0; }
  .empty { height: 1.2em; }
  rt { font-size: 0.5em; color: #888; }
</style>
</head>
<body>
<h1>${song.title}</h1>
${song.artist ? `<p class="artist">${song.artist}</p>` : ''}
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
