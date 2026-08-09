import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getTranslationConfig, testTranslationConnection } from '@/lib/translation';
import {
  getStoredTranslationConfig,
  resolveTranslationConfig,
  type StoredTranslationConfig,
} from '@/lib/translation-settings';
import { rateLimitTest, validateTranslationBaseUrl } from '@/lib/ssrf-guard';

// POST /api/admin/translation-config/test — connectivity check (admin only).
// Body: optional config snapshot to test BEFORE saving; when omitted, tests the effective config.
//
// Safety (ISSUE #82): HTTPS-only, known-provider host allowlist, custom hosts
// must resolve to public addresses only (loopback / RFC1918 / link-local /
// metadata / DNS-rebinding refused), short timeout + low-frequency rate limit.
// GET responses never echo the API key, and the test body's api_key is only
// used transiently for the connection attempt.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (rateLimitTest(user.id)) {
    return NextResponse.json({ ok: false, latencyMs: 0, message: 'rate_limited' }, { status: 429 });
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

  // SSRF guard before any network call.
  const urlError = await validateTranslationBaseUrl(config.baseUrl, config.provider);
  if (urlError) {
    return NextResponse.json({ ok: false, latencyMs: 0, message: urlError }, { status: 200 });
  }

  return NextResponse.json(await testTranslationConnection(config));
}
