import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

const KANJI_RE = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
const MAX_TEXT_LENGTH = 32;
const MAX_CANDIDATES = 8;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const readingCache = new Map<string, { candidates: string[]; expiresAt: number }>();

type JishoEntry = {
  japanese?: Array<{ word?: string; reading?: string }>;
};

/**
 * Returns dictionary readings for an exact kanji word. The editor keeps the
 * tokenizer's contextual reading first; these are alternatives for users to
 * choose when a word is ambiguous in lyric context.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const text = request.nextUrl.searchParams.get('text')?.trim() ?? '';
  if (!text || text.length > MAX_TEXT_LENGTH || !KANJI_RE.test(text)) {
    return NextResponse.json({ candidates: [] });
  }

  const cached = readingCache.get(text);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ candidates: cached.candidates });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(text)}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return NextResponse.json({ candidates: [] });
    }

    const payload = await response.json() as { data?: JishoEntry[] };
    const candidates = [...new Set(
      (payload.data ?? [])
        .flatMap((entry) => entry.japanese ?? [])
        .filter((form) => form.word === text && form.reading)
        .map((form) => form.reading!)
    )].slice(0, MAX_CANDIDATES);

    readingCache.set(text, { candidates, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json({ candidates });
  } catch {
    // Suggestions are an enhancement. Manual editing remains available offline.
    return NextResponse.json({ candidates: [] });
  } finally {
    clearTimeout(timeout);
  }
}
