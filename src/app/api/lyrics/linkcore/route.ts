import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { extractLinkcoreLyrics, LinkcoreLyricsErrorResponse } from '@/lib/linkcore-lyrics';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 });

  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_linkcore_url' }, { status: 400 });
  }
  if (typeof url !== 'string') return NextResponse.json({ error: 'invalid_linkcore_url' }, { status: 400 });

  try {
    return NextResponse.json({ lyrics: await extractLinkcoreLyrics(url), source: 'linkcore' });
  } catch (error) {
    const code = error instanceof LinkcoreLyricsErrorResponse ? error.code : 'linkcore_fetch_failed';
    const status = code === 'invalid_linkcore_url' ? 400 : 422;
    return NextResponse.json({ error: code }, { status });
  }
}
