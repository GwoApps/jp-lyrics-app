import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { discoverTranslationModels, getTranslationConfig } from '@/lib/translation';
import {
  getStoredTranslationConfig,
  resolveTranslationConfig,
  type StoredTranslationConfig,
} from '@/lib/translation-settings';
import { rateLimitTest, validateTranslationBaseUrl } from '@/lib/ssrf-guard';

// POST /api/admin/translation-config/models — list models exposed by the
// configured provider (admin only). Used to auto-populate the model combobox
// after a successful connection test.
//
// Body: optional config snapshot (same merge semantics as /test) to discover
// models for BEFORE saving; when omitted/blank, discovers for the effective
// config. Same safety posture as the test endpoint: HTTPS-only, known-provider
// allowlist, public-address-only custom hosts, short timeout + low-frequency
// rate limit. The API key is never echoed back.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (rateLimitTest(user.id)) {
    return NextResponse.json({ models: null, message: 'rate_limited' }, { status: 429 });
  }

  const db = getDB();
  const body = (await request.json().catch(() => ({}))) as Partial<StoredTranslationConfig>;

  // Merge the form snapshot over the stored config, mirroring the test route:
  // blank form fields keep their stored/env value, non-blank ones override.
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
    return NextResponse.json({ models: null, message: 'missing_api_key' }, { status: 200 });
  }

  // SSRF guard before any network call (same as the test endpoint).
  const urlError = await validateTranslationBaseUrl(config.baseUrl, config.provider);
  if (urlError) {
    return NextResponse.json({ models: null, message: urlError }, { status: 200 });
  }

  const models = await discoverTranslationModels(config);
  return NextResponse.json({ models });
}
