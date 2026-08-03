import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getTranslationConfig } from '@/lib/translation';
import {
  getStoredTranslationConfig,
  setStoredTranslationConfig,
  clearStoredTranslationConfig,
  resolveTranslationConfig,
  type StoredTranslationConfig,
} from '@/lib/translation-settings';

// GET /api/admin/translation-config — current stored + effective translation service config (admin only).
// PUT /api/admin/translation-config — save overrides; a fully blank payload clears the stored config
// (falling back to env defaults). Blank individual fields keep their stored value; api_key is only
// ever updated when a non-blank value is submitted — never echoed back.

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/** Wire representation of a config — api_key is never exposed in plaintext. */
function toWireConfig(config: { provider: string; baseUrl: string; apiKey: string; model: string; targetLang: string }) {
  return {
    provider: config.provider,
    base_url: config.baseUrl,
    model: config.model,
    target_lang: config.targetLang,
    has_api_key: config.apiKey.length > 0,
    api_key_masked: config.apiKey ? maskApiKey(config.apiKey) : null,
  };
}

/** Wire representation of the stored (DB) config — api_key masked. */
function toWireStored(stored: StoredTranslationConfig | null) {
  if (!stored) return null;
  return {
    provider: stored.provider ?? null,
    base_url: stored.base_url ?? null,
    model: stored.model ?? null,
    target_lang: stored.target_lang ?? null,
    has_api_key: typeof stored.api_key === 'string' && stored.api_key.length > 0,
    api_key_masked: stored.api_key ? maskApiKey(stored.api_key) : null,
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const stored = await getStoredTranslationConfig(db);
  const envConfig = getTranslationConfig();
  const effective = resolveTranslationConfig(stored, envConfig);
  const hasStored = stored !== null && Object.keys(stored).length > 0;

  return NextResponse.json({
    stored: toWireStored(stored),
    effective: effective ? toWireConfig(effective) : null,
    source: effective ? (hasStored ? 'db' : 'env') : 'none',
  });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();
  const body = (await request.json().catch(() => ({}))) as Partial<StoredTranslationConfig>;

  // A fully blank payload means "clear the stored config" (env defaults take over).
  const hasAnyField = Object.values(body).some((v) => typeof v === 'string' && v.trim() !== '');
  if (!hasAnyField) {
    await clearStoredTranslationConfig(db);
  } else {
    // Partial update: start from the current stored values so untouched fields
    // (notably api_key, which the API never echoes back) are preserved.
    const current = (await getStoredTranslationConfig(db)) ?? {};
    const stored: StoredTranslationConfig = { ...current };
    const fieldMap: Array<[keyof StoredTranslationConfig, string | undefined]> = [
      ['provider', body.provider],
      ['base_url', body.base_url],
      ['api_key', body.api_key],
      ['model', body.model],
      ['target_lang', body.target_lang],
    ];
    for (const [key, value] of fieldMap) {
      if (typeof value === 'string' && value.trim()) {
        if (key === 'provider' && value !== 'openai' && value !== 'anthropic') {
          return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
        }
        stored[key] = value.trim();
      }
    }
    await setStoredTranslationConfig(db, stored);
  }

  const reloaded = await getStoredTranslationConfig(db);
  const envConfig = getTranslationConfig();
  const effective = resolveTranslationConfig(reloaded, envConfig);
  const hasStored = reloaded !== null && Object.keys(reloaded).length > 0;
  return NextResponse.json({
    stored: toWireStored(reloaded),
    effective: effective ? toWireConfig(effective) : null,
    source: effective ? (hasStored ? 'db' : 'env') : 'none',
  });
}
