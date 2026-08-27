import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { writeAuditLog, hasUnknownFields, isSameOriginRequest, parseStrictJson } from '@/lib/admin';
import {
  deleteProviderConfig,
  getProviderConfig,
  updateProviderConfig,
  type ProviderConfigRow,
} from '@/lib/lyrics-provider/config';
import { getNetworkPolicy, isInsecureTransport, normalizeProviderBaseUrl, validateProviderBaseUrl } from '@/lib/lyrics-provider/policy';
import { getBudgetConfig, clampConfiguredTimeoutMs } from '@/lib/lyrics-provider/budget';
import { encryptProviderSecret, hasProviderSecretKey, maskSecret } from '@/lib/lyrics-provider/secret';
import { validateSourceConfig } from '@/lib/lyrics-provider/api-schema';

const UPDATE_FIELDS = new Set(['name', 'base_url', 'auth_type', 'auth_secret', 'auth_secret_clear', 'enabled', 'priority', 'timeout_ms', 'source_config']);

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

async function getTargetId(params: Promise<{ id: string }>): Promise<string> {
  const p = await params;
  return p.id;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const id = await getTargetId(params);
  const db = getDB();
  const row = await getProviderConfig(db, id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ provider: toWire(row) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // CSRF defence-in-depth: reject cross-origin admin mutations before parsing.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const id = await getTargetId(params);
  const db = getDB();
  const existing = await getProviderConfig(db, id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Builtin rows are managed (rename / enable / reorder) but their transport
  // identity is code-defined: base_url/auth/secret fields are HTTP-only.
  const isBuiltin = existing.kind === 'builtin';

  const parsed = await parseStrictJson(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (hasUnknownFields(parsed, UPDATE_FIELDS)) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ('name' in parsed) {
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!name || name.length > 200) return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    patch.name = name;
  }

  if ('base_url' in parsed) {
    if (isBuiltin) return NextResponse.json({ error: 'builtin_readonly_field' }, { status: 400 });
    const baseUrl = normalizeProviderBaseUrl(typeof parsed.base_url === 'string' ? parsed.base_url.trim() : '');
    if (!baseUrl) return NextResponse.json({ error: 'invalid_base_url' }, { status: 400 });
    const policyError = await validateProviderBaseUrl(baseUrl, getNetworkPolicy());
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    patch.baseUrl = baseUrl;
    // A base-url change invalidates any cached manifest.
    patch.manifestJson = null;
    patch.lastCheckStatus = 'unchecked';
  }

  if (('auth_type' in parsed || 'auth_secret' in parsed || 'auth_secret_clear' in parsed) && isBuiltin) {
    return NextResponse.json({ error: 'builtin_readonly_field' }, { status: 400 });
  }

  if ('auth_type' in parsed) {
    const authType = parsed.auth_type === 'bearer' ? 'bearer' : 'none';
    if (authType === 'bearer' && !hasProviderSecretKey()) {
      return NextResponse.json({ error: 'secret_key_not_configured' }, { status: 400 });
    }
    patch.authType = authType;
    if (authType === 'none') patch.authSecretCiphertext = null;
  }

  // A non-blank auth_secret replaces the token; blank keeps the stored value.
  if ('auth_secret' in parsed && typeof parsed.auth_secret === 'string' && parsed.auth_secret.trim()) {
    if (!hasProviderSecretKey()) {
      return NextResponse.json({ error: 'secret_key_not_configured' }, { status: 400 });
    }
    patch.authSecretCiphertext = await encryptProviderSecret(parsed.auth_secret.trim());
  }
  // Explicit clear flag removes the stored token (avoids accidental empty-string delete).
  if (parsed.auth_secret_clear === true) {
    patch.authSecretCiphertext = null;
  }

  if ('enabled' in parsed) patch.enabled = parsed.enabled === false ? 0 : 1;
  if ('priority' in parsed && Number.isFinite(Number(parsed.priority))) {
    patch.priority = Math.max(0, Math.floor(Number(parsed.priority)));
  }
  if ('timeout_ms' in parsed) {
    const budget = getBudgetConfig();
    patch.timeoutMs = clampConfiguredTimeoutMs(Number(parsed.timeout_ms), budget);
  }

  // Builtin-only: per-source behaviour overrides validated against the schema.
  if ('source_config' in parsed) {
    if (!isBuiltin) {
      return NextResponse.json({ error: 'http_provider_readonly_field' }, { status: 400 });
    }
    const result = await validateSourceConfig(id, parsed.source_config);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const keys = Object.keys(result.config);
    patch.sourceConfig = keys.length > 0 ? JSON.stringify(result.config) : null;
  }

  await updateProviderConfig(db, id, patch);

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: 'update_lyrics_provider',
    targetType: 'lyrics_provider',
    targetId: id,
    beforeJson: null,
    afterJson: JSON.stringify({
      name: patch.name ?? existing.name,
      base_url: patch.baseUrl ?? existing.baseUrl,
      auth_type: patch.authType ?? existing.authType,
      has_secret: 'authSecretCiphertext' in patch ? !!patch.authSecretCiphertext : !!existing.authSecretCiphertext,
      enabled: patch.enabled ?? existing.enabled,
      priority: patch.priority ?? existing.priority,
      // source_config may carry admin-set upstream endpoints for builtin
      // sources — include it so auditors can trace where traffic is routed.
      source_config: 'sourceConfig' in patch ? safeParseJson(patch.sourceConfig as string | null) : safeParseJson(existing.sourceConfig),
    }),
    reason: '',
  });

  const row = await getProviderConfig(db, id);
  return NextResponse.json({ provider: row ? toWire(row) : null });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // CSRF defence-in-depth: reject cross-origin admin mutations before parsing.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const id = await getTargetId(params);
  const db = getDB();
  const existing = await getProviderConfig(db, id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Builtin sources are code-defined; disabling (enabled=0) is the supported
  // off-switch, deletion is reserved for HTTP plugin configs.
  if (existing.kind === 'builtin') {
    return NextResponse.json({ error: 'builtin_undeletable' }, { status: 400 });
  }

  await deleteProviderConfig(db, id);
  await writeAuditLog(db, {
    actorUserId: user.id,
    action: 'delete_lyrics_provider',
    targetType: 'lyrics_provider',
    targetId: id,
    beforeJson: null,
    afterJson: null,
    reason: '',
  });
  return NextResponse.json({ ok: true });
}
