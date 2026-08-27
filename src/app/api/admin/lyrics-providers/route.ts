import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { writeAuditLog, hasUnknownFields, isSameOriginRequest, parseStrictJson } from '@/lib/admin';
import {
  getProviderConfig,
  insertProviderConfig,
  listProviderConfigs,
  type ProviderConfigRow,
} from '@/lib/lyrics-provider/config';
import { getNetworkPolicy, isInsecureTransport, normalizeProviderBaseUrl, validateProviderBaseUrl } from '@/lib/lyrics-provider/policy';
import { getBudgetConfig, clampConfiguredTimeoutMs } from '@/lib/lyrics-provider/budget';
import { encryptProviderSecret, hasProviderSecretKey, maskSecret } from '@/lib/lyrics-provider/secret';
import { BUILTIN_SOURCE_SCHEMAS } from '@/lib/lyrics-provider/api-schema';

// GET /api/admin/lyrics-providers — list global provider configs (admin only; secrets never returned).
// POST /api/admin/lyrics-providers — create a new global provider (admin only, CSRF-checked, audited).

const CREATE_FIELDS = new Set(['name', 'base_url', 'auth_type', 'auth_secret', 'enabled', 'priority', 'timeout_ms']);

/** Normalise + validate the shared create/update body. Returns error code or null. */
async function validateBody(body: Record<string, unknown>): Promise<
  | { error: string }
  | { name: string; baseUrl: string; authType: 'none' | 'bearer'; authSecretCiphertext: string | null; enabled: number; priority: number; timeoutMs: number | null }
> {
  // source_config is handled separately (validated against builtin schema)
  return validateCommonBody(body);
}

/** Shared create body validation (HTTP plugins). */
async function validateCommonBody(body: Record<string, unknown>): Promise<
  | { error: string }
  | { name: string; baseUrl: string; authType: 'none' | 'bearer'; authSecretCiphertext: string | null; enabled: number; priority: number; timeoutMs: number | null }
> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return { error: 'invalid_name' as const };

  const baseUrlRaw = typeof body.base_url === 'string' ? body.base_url.trim() : '';
  const baseUrl = normalizeProviderBaseUrl(baseUrlRaw);
  if (!baseUrl) return { error: 'invalid_base_url' as const };

  const authType = body.auth_type === 'bearer' ? 'bearer' : 'none';
  let authSecretCiphertext: string | null = null;
  if (authType === 'bearer') {
    const secret = typeof body.auth_secret === 'string' ? body.auth_secret : '';
    if (!secret || !hasProviderSecretKey()) {
      return { error: hasProviderSecretKey() ? 'auth_secret_required' as const : 'secret_key_not_configured' as const };
    }
    authSecretCiphertext = await encryptProviderSecret(secret);
  }

  const policyError = await validateProviderBaseUrl(baseUrl, getNetworkPolicy());
  if (policyError) return { error: policyError as 'invalid_base_url' };

  const budget = getBudgetConfig();
  const timeoutMs = clampConfiguredTimeoutMs(
    body.timeout_ms === undefined ? null : Number(body.timeout_ms),
    budget,
  );

  // New providers default to DISABLED: they only join the effective chain after
  // the admin has explicitly enabled them (ideally after a successful manifest
  // test). The UI does not send `enabled` on create, so a fresh provider is safe.
  const enabled = body.enabled === true ? 1 : 0;
  return {
    name,
    baseUrl,
    authType,
    authSecretCiphertext,
    enabled,
    priority: Number.isFinite(Number(body.priority)) ? Math.max(0, Math.floor(Number(body.priority))) : 0,
    timeoutMs,
  };
}

/** Tolerate a corrupt JSON string instead of 500ing (migration / manual DB edits). */
function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Tolerate a corrupt manifest JSON (migration / manual DB edits) instead of 500ing. */
function parseManifestJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // corrupt value → treat as no manifest, consistent with `manifest: null`
  }
}

/** Wire-safe representation of builtin source config schemas for the frontend. */
function getBuiltinSourceSchemas(): Record<string, {
  key: string;
  display_name: string;
  fields: {
    key: string;
    label_key: string;
    type: string;
    default: number | string | boolean | null;
    min?: number;
    max?: number;
    step?: number;
    placeholder_key?: string;
    help_key?: string;
    env_fallback?: string;
  }[];
}> {
  const out: Record<string, ReturnType<typeof getBuiltinSourceSchemas>[string]> = {};
  for (const [key, schema] of Object.entries(BUILTIN_SOURCE_SCHEMAS)) {
    out[key] = {
      key: schema.key,
      display_name: schema.displayName,
      fields: schema.fields.map((f) => ({
        key: f.key,
        label_key: f.labelKey,
        type: f.type,
        default: f.default,
        ...(f.min !== undefined ? { min: f.min } : {}),
        ...(f.max !== undefined ? { max: f.max } : {}),
        ...(f.step !== undefined ? { step: f.step } : {}),
        ...(f.placeholderKey ? { placeholder_key: f.placeholderKey } : {}),
        ...(f.helpKey ? { help_key: f.helpKey } : {}),
        ...(f.envFallback ? { env_fallback: f.envFallback } : {}),
      })),
    };
  }
  return out;
}

/** Non-secret wire representation of a config row. */
function toWire(row: ProviderConfigRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    base_url: row.baseUrl,
    auth_type: row.authType,
    has_secret: !!row.authSecretCiphertext,
    secret_masked: maskSecret(row.authSecretCiphertext),
    enabled: !!row.enabled,
    priority: row.priority,
    timeout_ms: row.timeoutMs ?? null,
    source_config: row.sourceConfig ? safeParseJson(row.sourceConfig) : null,
    protocol_version: row.protocolVersion,
    manifest: parseManifestJson(row.manifestJson),
    last_check_status: row.lastCheckStatus,
    last_check_code: row.lastCheckCode ?? null,
    last_check_latency_ms: row.lastCheckLatencyMs ?? null,
    checked_at: row.checkedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    insecure_transport: isInsecureTransport(row.baseUrl),
  };
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = getDB();
  const rows = await listProviderConfigs(db);
  // Include per-source schemas so the frontend can render dynamic forms for
  // builtin providers without hardcoding field knowledge (ISSUE #196).
  return NextResponse.json({
    providers: rows.map(toWire),
    policy: getNetworkPolicy(),
    budgets: getBudgetConfig(),
    secret_key_configured: hasProviderSecretKey(),
    source_schemas: getBuiltinSourceSchemas(),
  });
}

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
  if (hasUnknownFields(parsed, CREATE_FIELDS)) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }

  const validated = await validateBody(parsed);
  if ('error' in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const db = getDB();
  const id = uuidv4();
  await insertProviderConfig(db, {
    id,
    name: validated.name,
    baseUrl: validated.baseUrl,
    authType: validated.authType,
    authSecretCiphertext: validated.authSecretCiphertext,
    enabled: validated.enabled,
    priority: validated.priority,
    timeoutMs: validated.timeoutMs,
    sourceConfig: null,
    protocolVersion: 1,
  });

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: 'create_lyrics_provider',
    targetType: 'lyrics_provider',
    targetId: id,
    beforeJson: null,
    afterJson: JSON.stringify({
      name: validated.name,
      base_url: validated.baseUrl,
      auth_type: validated.authType,
      has_secret: !!validated.authSecretCiphertext,
      enabled: validated.enabled,
      priority: validated.priority,
    }),
    reason: '',
  });

  const row = await getProviderConfig(db, id);
  return NextResponse.json({ provider: row ? toWire(row) : null }, { status: 201 });
}
