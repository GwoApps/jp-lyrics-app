import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { writeAuditLog, isSameOriginRequest, parseStrictJson } from '@/lib/admin';
import { reorderProviders } from '@/lib/lyrics-provider/config';

// POST /api/admin/lyrics-providers/reorder — drag-to-sort global providers (admin only).
// Body: { ordered_ids: string[] } — the full ordered list of provider ids.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // CSRF defence-in-depth: reject cross-origin admin mutations before parsing.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = await parseStrictJson(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const orderedIds = Array.isArray(parsed.ordered_ids)
    ? parsed.ordered_ids.filter((x): x is string => typeof x === 'string')
    : [];
  if (orderedIds.length === 0 || orderedIds.some((x) => x.length > 128)) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }

  const db = getDB();
  await reorderProviders(db, orderedIds);

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: 'reorder_lyrics_providers',
    targetType: 'lyrics_provider',
    targetId: 'chain',
    beforeJson: null,
    afterJson: JSON.stringify({ ordered_ids: orderedIds }),
    reason: '',
  });

  return NextResponse.json({ ok: true });
}
