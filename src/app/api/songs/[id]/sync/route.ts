import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { getAuthUser } from '@/lib/auth';
import { fetchLyrics, type LyricsResult } from '@/lib/lyrics-fetcher';
import { normalize } from '@/lib/match';

interface LrcLine {
  timeMs: number;
  text: string;
}

function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of lrc.split('\n')) {
    const match = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (match) {
      const ms = parseInt(match[1]) * 60000 + parseInt(match[2]) * 1000 + parseInt(match[3].padEnd(3, '0'));
      const text = match[4].trim();
      if (text) lines.push({ timeMs: ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const bg = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2)); return set; };
  const aSet = bg(na), bSet = bg(nb);
  let common = 0; for (const g of aSet) { if (bSet.has(g)) common++; }
  return (2 * common) / (aSet.size + bSet.size) >= 0.4;
}

async function getSpotifyCanonicalName(userEmail: string, title: string, artist: string): Promise<{ name: string; artist: string } | null> {
  const token = await getSpotifyTokenForUser(userEmail);
  if (!token) return null;
  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${title} ${artist}`)}&type=track&limit=3`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const tracks = data.tracks?.items || [];
  for (const t of tracks) {
    if (fuzzyMatch(t.name, title)) {
      return { name: t.name, artist: t.artists?.[0]?.name || artist };
    }
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const user = await getAuthUser(request);

  const song = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as Record<string, unknown> | undefined;
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  const title = song.title as string;
  const artist = song.artist as string;

  // Get Spotify canonical name if user is connected
  let spotifyCanonical: { name: string; artist: string } | null = null;
  if (user) {
    spotifyCanonical = await getSpotifyCanonicalName(user.email, title, artist);
  }

  const { result, source } = await fetchLyrics(title, artist, { spotifyCanonical });

  if (!result) {
    return NextResponse.json({
      synced: false,
      error: '歌詞が見つかりません。手動でLRC歌詞を貼り付けてください。',
    });
  }

  // Store lyrics — furigana will be computed client-side via kuromoji-es
  await db.update(schema.songs).set({
    lyricsRaw: result.plain,
    lyricsFurigana: '[]',
    lyricsSynced: result.synced,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(sql`id = ${id}`);

  const parsed = result.synced ? parseLrc(result.synced) : [];
  return NextResponse.json({ synced: parsed.length > 0, source, lines: parsed.length, lrc: result.synced });
}
