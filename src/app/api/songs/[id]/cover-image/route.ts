import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import path from 'path';

// GET /api/songs/[id]/cover-image?ext=jpeg — serve the uploaded custom cover.
// The URL is versioned (?v=...) on upload so it can be cached immutably.
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
  const db = getDB();
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const ext = searchParams.get('ext');

  const song = await db.select({ coverUrl: schema.songs.coverUrl }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!song?.coverUrl || !ext || !(ext in EXT_MIME)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  try {
    const buffer = await readFile(path.join(process.cwd(), 'data', 'covers', `${id}.${ext}`));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': EXT_MIME[ext],
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
