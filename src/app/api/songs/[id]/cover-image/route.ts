import { NextRequest, NextResponse } from 'next/server';
import { getCover } from '@/lib/cover-store';
import { readFile } from 'fs/promises';
import path from 'path';

// GET /api/songs/[id]/cover-image — serve the uploaded custom cover.
// Primary source is cover-store: the R2 object on Cloudflare, the
// song_covers BLOB on local deployments. Legacy data/covers/ files are
// still served as a last-resort fallback. The URL is versioned (?v=...)
// on upload so it can be cached immutably.
const EXT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const ext = searchParams.get('ext');

  // 1. Active store (R2 on CF, BLOB locally — with R2→BLOB fallback inside).
  const cover = await getCover(id);
  if (cover) {
    return new NextResponse(cover.bytes, {
      headers: {
        'Content-Type': cover.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // 2. Legacy filesystem cover (pre-BLOB uploads).
  if (ext && ext in EXT_MIME) {
    try {
      const buffer = await readFile(path.join(process.cwd(), 'data', 'covers', `${id}.${ext}`));
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': EXT_MIME[ext],
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch { /* fall through */ }
  }

  return new NextResponse('Not Found', { status: 404 });
}
