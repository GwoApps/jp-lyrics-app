import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import path from 'path';

// GET /api/songs/[id]/cover-image — serve the uploaded custom cover.
// Primary source is the song_covers BLOB (works on local SQLite and D1);
// legacy data/covers/ files are still served as a fallback. The URL is
// versioned (?v=...) on upload so it can be cached immutably.
const EXT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

function toBytes(value: unknown): ArrayBuffer {
  let u8: Uint8Array;
  if (value instanceof Uint8Array) u8 = value;
  else if (value instanceof ArrayBuffer) u8 = new Uint8Array(value);
  else if (Array.isArray(value)) u8 = new Uint8Array(value);
  else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) u8 = new Uint8Array(value);
  else throw new Error('unexpected blob type');
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const ext = searchParams.get('ext');

  // 1. BLOB store (primary — works on Cloudflare D1).
  const row = await db.select({
    mime: schema.songCovers.mime,
    data: schema.songCovers.data,
  }).from(schema.songCovers).where(eq(schema.songCovers.songId, id)).get();
  if (row) {
    return new NextResponse(toBytes(row.data), {
      headers: {
        'Content-Type': row.mime,
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
