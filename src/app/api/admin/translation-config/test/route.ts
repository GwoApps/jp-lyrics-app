import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getTranslationConfig, testTranslationConnection } from '@/lib/translation';
import {
  getStoredTranslationConfig,
  resolveTranslationConfig,
  type StoredTranslationConfig,
} from '@/lib/translation-settings';

// POST /api/admin/translation-config/test — connectivity check (admin only).
// Body: optional config snapshot to test BEFORE saving; when omitted, tests the effective config.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const body = (await request.json().catch(() => ({}))) as Partial<StoredTranslationConfig>;

  // Test the form snapshot merged over the stored config: blank form fields
  // (e.g. an untouched api_key) keep their stored/env value, non-blank ones override.
  const stored = await getStoredTranslationConfig(db);
  const candidate: StoredTranslationConfig = { ...(stored ?? {}) };
  const fieldMap: Array<[keyof StoredTranslationConfig, string | undefined]> = [
    ['provider', body.provider],
    ['base_url', body.base_url],
    ['api_key', body.api_key],
    ['model', body.model],
    ['target_lang', body.target_lang],
  ];
  for (const [key, value] of fieldMap) {
    if (typeof value === 'string' && value.trim()) candidate[key] = value.trim();
  }
  const config = resolveTranslationConfig(candidate, getTranslationConfig());
  if (!config) {
    return NextResponse.json({ ok: false, latencyMs: 0, message: 'missing_api_key' }, { status: 200 });
  }
  return NextResponse.json(await testTranslationConnection(config));
}
