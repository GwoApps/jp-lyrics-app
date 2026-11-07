import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getJapaneseReadingCandidates } from '@/lib/japanese-reading-candidates';

/** Local KANJIDIC2/JMdict readings; no per-click third-party dependency. */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const text = params.get('text') ?? '';
  const word = params.get('word') ?? text;
  const startParam = params.get('start');
  const start = startParam === null ? 0 : /^\d+$/.test(startParam) ? Number(startParam) : NaN;
  if (!text || text.length > 32 || word.length > 64 || !Number.isInteger(start)
    || word.slice(start, start + text.length) !== text) {
    return NextResponse.json({ error: 'invalid_reading_query' }, { status: 400 });
  }

  try {
    return NextResponse.json({ candidates: getJapaneseReadingCandidates(text, { word, start }) });
  } catch (error) {
    console.error(`[readings] local dictionary lookup failed — ${error instanceof Error ? error.message : String(error)}`);
    // A failed lookup must reach the editor's error/retry path, not pretend
    // that a successful dictionary query found no alternatives.
    return NextResponse.json({ error: 'reading_lookup_failed' }, { status: 503 });
  }
}
