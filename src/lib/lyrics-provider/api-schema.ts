/**
 * Provider API schema (ISSUE #196).
 *
 * Exposes the configuration surface of each builtin lyrics source through a
 * declarative schema so the admin API and the edit dialog can render the
 * right form fields for each provider without hardcoding per-source UI logic.
 *
 * Each schema entry describes one configurable field:
 *   key       — JSON key stored in `source_config` (snake_case on the wire)
 *   labelKey  — i18n key suffix for the field label
 *   type      — 'number' | 'string' | 'boolean'
 *   default   — fallback value when the field is absent
 *   min/max   — numeric bounds (number fields only)
 *   step      — HTML input step (number fields, optional)
 *   placeholderKey — optional i18n key suffix for the input placeholder
 *   helpKey   — optional i18n key suffix for a help hint under the field
 */

import type { BuiltinSourceKey } from './builtin-provider.ts';
import { validateProviderBaseUrl, getNetworkPolicy } from './policy.ts';

export interface ProviderSchemaField {
  key: string;
  labelKey: string;
  type: 'number' | 'string' | 'boolean';
  /** Fallback used when the JSON field is absent. */
  default: number | string | boolean | null;
  /** Numeric bounds for `number` fields. */
  min?: number;
  max?: number;
  step?: number;
  placeholderKey?: string;
  helpKey?: string;
  /** Env var fallback name shown in the help text when relevant. */
  envFallback?: string;
  /** Mark string fields that contain an absolute URL needing SSRF policy validation. */
  url?: boolean;
}

export interface ProviderSourceSchema {
  /** The source key (matches `builtin:<key>` row id). */
  key: BuiltinSourceKey;
  /** Human-facing display name (from builtin-provider). */
  displayName: string;
  /** Ordered list of configurable fields. */
  fields: ProviderSchemaField[];
}

/**
 * Per-source config field schemas. Order matters — the edit dialog renders
 * fields in the order listed here.
 */
export const BUILTIN_SOURCE_SCHEMAS: Record<BuiltinSourceKey, ProviderSourceSchema> = {
  lrclib: {
    key: 'lrclib',
    displayName: 'LRCLIB',
    fields: [
      {
        key: 'rate_limit_ms',
        labelKey: 'sourceConfigRateLimitMs',
        type: 'number',
        default: 1500,
        min: 0,
        max: 30000,
        step: 100,
        helpKey: 'sourceConfigRateLimitMsHint',
      },
      {
        key: 'api_base',
        labelKey: 'sourceConfigApiBase',
        type: 'string',
        default: null,
        placeholderKey: 'sourceConfigApiBasePlaceholder',
        helpKey: 'sourceConfigApiBaseHint',
        url: true,
      },
      {
        key: 'fuzzy_enabled',
        labelKey: 'sourceConfigFuzzyEnabled',
        type: 'boolean',
        default: true,
        helpKey: 'sourceConfigFuzzyEnabledHint',
      },
    ],
  },
  petitlyrics: {
    key: 'petitlyrics',
    displayName: 'PetitLyrics',
    fields: [
      {
        key: 'sync_candidate_limit',
        labelKey: 'sourceConfigSyncCandidateLimit',
        type: 'number',
        default: 4,
        min: 1,
        max: 16,
        step: 1,
        helpKey: 'sourceConfigSyncCandidateLimitHint',
      },
    ],
  },
  'uta-net': {
    key: 'uta-net',
    displayName: 'Uta-Net',
    fields: [],
  },
  ytmusic: {
    key: 'ytmusic',
    displayName: 'YouTube Music',
    fields: [
      {
        key: 'sidecar_url',
        labelKey: 'sourceConfigSidecarUrl',
        type: 'string',
        default: null,
        placeholderKey: 'sourceConfigSidecarUrlPlaceholder',
        helpKey: 'sourceConfigSidecarUrlHint',
        envFallback: 'YT_MUSIC_SIDECAR_URL',
        url: true,
      },
    ],
  },
};

/** Return the schema for a builtin provider row id (e.g. `builtin:lrclib`). */
export function sourceSchemaForRowId(rowId: string): ProviderSourceSchema | null {
  const key = rowId.replace(/^builtin[:-]/, '');
  if (!(key in BUILTIN_SOURCE_SCHEMAS)) return null;
  return BUILTIN_SOURCE_SCHEMAS[key as BuiltinSourceKey];
}

/**
 * Validate a `source_config` object against the schema for a builtin source.
 * Returns the normalized config (unknown keys stripped, defaults applied) or
 * an error code when validation fails.
 */
export async function validateSourceConfig(
  rowId: string,
  raw: unknown,
): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> {
  const schema = sourceSchemaForRowId(rowId);
  if (!schema) return { ok: false, error: 'invalid_source_schema' };
  if (raw === null || raw === undefined) return { ok: true, config: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_source_config' };
  }

  const input = raw as Record<string, unknown>;
  const allowedKeys = new Set(schema.fields.map((f) => f.key));
  const unknownKeys = Object.keys(input).filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) return { ok: false, error: 'invalid_source_config' };

  const policy = getNetworkPolicy();
  const result: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const value = input[field.key];
    if (value === undefined) continue;

    switch (field.type) {
      case 'number': {
        if (typeof value !== 'number' && typeof value !== 'string') {
          return { ok: false, error: 'invalid_source_config' };
        }
        const n = Number(value);
        if (!Number.isFinite(n)) return { ok: false, error: 'invalid_source_config' };
        const min = field.min ?? -Infinity;
        const max = field.max ?? Infinity;
        if (n < min || n > max) return { ok: false, error: 'invalid_source_config' };
        result[field.key] = field.step === 1 ? Math.floor(n) : Math.round(n * 100) / 100;
        break;
      }
      case 'string': {
        if (typeof value !== 'string') return { ok: false, error: 'invalid_source_config' };
        const trimmed = value.trim();
        // URL fields go through the same SSRF policy as HTTP provider base_urls.
        // An empty URL clears the override; non-empty values are validated
        // against the deployment policy (fail-closed by default).
        if (field.url) {
          if (trimmed) {
            const policyError = await validateProviderBaseUrl(trimmed, policy);
            if (policyError) return { ok: false, error: policyError };
          }
        }
        result[field.key] = trimmed;
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') return { ok: false, error: 'invalid_source_config' };
        result[field.key] = value;
        break;
      }
    }
  }
  return { ok: true, config: result };
}
