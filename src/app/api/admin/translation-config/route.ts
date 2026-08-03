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
// PUT /api/admin/translation-config — save overrides; empty body/blank fields clears back to env defaults.

function toWireConfig(config: { provider: string; baseUrl: string; apiKey: string; model: string; targetLang: string }) {
  return {
    provider: config.provider,
    base_url: config.baseUrl,
    api_key: config.apiKey,
    model: config.model,
    target_lang: config.targetLang,
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
    stored,
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

  // Only accept known fields; blank strings are treated as "use env default".
  const stored: StoredTranslationConfig = {};
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

  if (Object.keys(stored).length === 0) {
    await clearStoredTranslationConfig(db);
  } else {
    await setStoredTranslationConfig(db, stored);
  }

  const reloaded = await getStoredTranslationConfig(db);
  const envConfig = getTranslationConfig();
  const effective = resolveTranslationConfig(reloaded, envConfig);
  const hasStored = reloaded !== null && Object.keys(reloaded).length > 0;
  return NextResponse.json({
    stored: reloaded,
    effective: effective ? toWireConfig(effective) : null,
    source: effective ? (hasStored ? 'db' : 'env') : 'none',
  });
}
