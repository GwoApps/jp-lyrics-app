import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getTranslationConfig } from '@/lib/translation';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/translation/prompts';
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
    system_prompt: stored.system_prompt ?? null,
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
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
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
  // Note: an explicitly present system_prompt key (even blank) is a partial
  // update — a blank prompt clears just that override, not the whole config.
  const hasAnyField = Object.values(body).some((v) => typeof v === 'string' && v.trim() !== '')
    || 'system_prompt' in body;
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
      ['system_prompt', body.system_prompt],
    ];
    for (const [key, value] of fieldMap) {
      if (typeof value !== 'string') continue;
      if (key === 'provider' && value !== 'openai' && value !== 'anthropic' && value !== 'workers-ai') {
        return NextResponse.json({ error: 'invalid_provider' }, { status: 400 });
      }
      if (key === 'system_prompt') {
        // Empty prompt = use the built-in default (explicitly cleared).
        if (value.trim()) {
          stored.system_prompt = value;
        } else {
          delete stored.system_prompt;
        }
        continue;
      }
      if (value.trim()) {
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
    default_system_prompt: DEFAULT_SYSTEM_PROMPT,
  });
}
