/**
 * Admin-managed translation service settings, stored in the `settings` table.
 *
 * Precedence: DB-stored fields override environment variables; empty/missing
 * DB fields fall back to the environment (`TRANSLATION_*` / `DEEPSEEK_API_KEY`).
 * A fully empty stored config behaves exactly like no stored config at all.
 */
import { eq } from 'drizzle-orm';
import { getDB, schema } from './db';
import { getTranslationConfig, type TranslationConfig, type TranslationProvider } from './translation';

export const TRANSLATION_SETTINGS_KEY = 'translation_config';

export interface StoredTranslationConfig {
  provider?: string;
  base_url?: string;
  api_key?: string;
  model?: string;
  target_lang?: string;
}

type DB = ReturnType<typeof getDB>;

export async function getStoredTranslationConfig(db: DB): Promise<StoredTranslationConfig | null> {
  const row = await db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, TRANSLATION_SETTINGS_KEY))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as StoredTranslationConfig;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function setStoredTranslationConfig(db: DB, config: StoredTranslationConfig): Promise<void> {
  await db.insert(schema.settings).values({ key: TRANSLATION_SETTINGS_KEY, value: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: JSON.stringify(config) },
    });
}

export async function clearStoredTranslationConfig(db: DB): Promise<void> {
  await db.delete(schema.settings).where(eq(schema.settings.key, TRANSLATION_SETTINGS_KEY));
}

/**
 * Merge a stored (DB) config with the environment-derived config.
 * Stored non-empty fields win; everything else falls back to the env values.
 * Returns null when no usable config exists — workers-ai needs no API key
 * (it authenticates via the Worker's AI binding), so it never trips the
 * key check.
 */
export function resolveTranslationConfig(
  stored: StoredTranslationConfig | null,
  envConfig: TranslationConfig | null,
): TranslationConfig | null {
  if (!stored && !envConfig) return null;
  const base = envConfig ?? {
    provider: 'openai' as TranslationProvider,
    baseUrl: '',
    apiKey: '',
    model: '',
    targetLang: 'zh-CN',
  };
  const provider: TranslationProvider =
    stored?.provider === 'openai' || stored?.provider === 'anthropic' || stored?.provider === 'workers-ai'
      ? stored.provider
      : base.provider;
  const apiKey = stored?.api_key?.trim() || base.apiKey;
  if (!apiKey && provider !== 'workers-ai') return null;
  return {
    provider,
    baseUrl: stored?.base_url?.trim() || base.baseUrl,
    apiKey,
    model: stored?.model?.trim() || base.model,
    targetLang: stored?.target_lang?.trim() || base.targetLang,
  };
}

/** Effective config for the translate pipeline — stored settings override env. */
export async function getEffectiveTranslationConfig(): Promise<TranslationConfig | null> {
  const db = getDB();
  const stored = await getStoredTranslationConfig(db);
  return resolveTranslationConfig(stored, getTranslationConfig());
}
