import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { getDB, schema, eq } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser, searchSpotifyCover } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;

interface SongRow {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  createdBy: string;
  isPublic: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    lines.push(text.slice(i, i + maxChars));
  }
  return lines;
}

async function fetchImageBase64(url: string): Promise<{ dataUrl: string; mime: string } | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return { dataUrl: `data:${contentType};base64,${buf.toString('base64')}`, mime: contentType };
  } catch {
    return null;
  }
}

async function ensureCover(row: SongRow, userId: string): Promise<string | null> {
  if (row.coverUrl) return row.coverUrl;
  const token = await getSpotifyTokenForUser(userId);
  if (!token) return null;
  const cover = await searchSpotifyCover(userId, row.title, row.artist);
  if (cover) {
    const db = getDB();
    await db.update(schema.songs).set({
      coverUrl: cover,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.songs.id, row.id));
  }
  return cover;
}

function buildShareSvg(
  title: string,
  artist: string,
  pageUrl: string,
  coverDataUrl: string | null,
  qrDataUrl: string
): string {
  const titleLines = wrapText(title, 14).slice(0, 2);
  const artistLines = wrapText(artist || 'アーティスト未設定', 24).slice(0, 2);

  const titleY = 180;
  const titleEls = titleLines
    .map((line, i) => `<text x="620" y="${titleY + i * 92}" font-size="72" font-weight="bold" fill="#f8fafc" font-family="'Noto Sans CJK JP', 'Noto Sans CJK SC', sans-serif">${escapeXml(line)}</text>`)
    .join('\n');

  const artistStartY = titleY + titleLines.length * 92 + 32;
  const artistEls = artistLines
    .map((line, i) => `<text x="620" y="${artistStartY + i * 60}" font-size="44" fill="#94a3b8" font-family="'Noto Sans CJK JP', 'Noto Sans CJK SC', sans-serif">${escapeXml(line)}</text>`)
    .join('\n');

  const coverEl = coverDataUrl
    ? `<g transform="translate(80,75)">
        <defs>
          <clipPath id="coverClip"><rect width="480" height="480" rx="24" /></clipPath>
        </defs>
        <rect width="480" height="480" rx="24" fill="#334155" />
        <image href="${coverDataUrl}" width="480" height="480" clip-path="url(#coverClip)" preserveAspectRatio="xMidYMid slice" />
      </g>`
    : `<g transform="translate(80,75)">
        <rect width="480" height="480" rx="24" fill="url(#coverFallback)" />
        <text x="240" y="270" text-anchor="middle" font-size="160" fill="#e2e8f0" font-family="sans-serif">♪</text>
      </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#1e293b" />
      </linearGradient>
      <linearGradient id="coverFallback" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#334155" />
        <stop offset="100%" stop-color="#475569" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.35" />
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)" />
    ${coverEl}
    <g filter="url(#shadow)">
      ${titleEls}
      ${artistEls}
    </g>
    <rect x="880" y="310" width="240" height="240" rx="16" fill="#ffffff" />
    <image href="${qrDataUrl}" x="892" y="322" width="216" height="216" />
    <text x="620" y="580" font-size="24" fill="#64748b" font-family="sans-serif">${escapeXml(pageUrl)}</text>
  </svg>`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);

  const row = await db.select({
    id: schema.songs.id,
    title: schema.songs.title,
    artist: schema.songs.artist,
    coverUrl: schema.songs.coverUrl,
    createdBy: schema.songs.createdBy,
    isPublic: schema.songs.isPublic,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get() as SongRow | undefined;
  if (!row) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  if (!user) {
    if (!row.isPublic) {
      return NextResponse.json({ error: 'login_required' }, { status: 401 });
    }
  } else if (!row.isPublic && !user.isAdmin && row.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const pageUrl = `${request.nextUrl.origin}/songs/${id}`;
  const [qrDataUrl, coverUrl] = await Promise.all([
    QRCode.toDataURL(pageUrl, { width: 216, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } }),
    user ? ensureCover(row, user.id) : Promise.resolve(row.coverUrl),
  ]);

  let coverDataUrl: string | null = null;
  if (coverUrl) {
    const fetched = await fetchImageBase64(coverUrl);
    coverDataUrl = fetched?.dataUrl ?? null;
  }

  const svg = buildShareSvg(row.title, row.artist, pageUrl, coverDataUrl, qrDataUrl);

  const png = await sharp(Buffer.from(svg, 'utf-8')).resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'fill' }).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
