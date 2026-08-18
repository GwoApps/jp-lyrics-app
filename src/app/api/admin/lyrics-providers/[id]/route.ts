import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { writeAuditLog, hasUnknownFields, isSameOriginRequest, parseStrictJson } from '@/lib/admin';
import {
  deleteProviderConfig,
  getProviderConfig,
  updateProviderConfig,
} from '@/lib/lyrics-provider/config';
import { getNetworkPolicy, isInsecureTransport, normalizeProviderBaseUrl, validateProviderBaseUrl } from '@/lib/lyrics-provider/policy';
import { getBudgetConfig, clampConfiguredTimeoutMs } from '@/lib/lyrics-provider/budget';
import { encryptProviderSecret, hasProviderSecretKey, maskSecret } from '@/lib/lyrics-provider/secret';

const UPDATE_FIELDS = new Set(['name', 'base_url', 'auth_type', 'auth_secret', 'auth_secret_clear', 'enabled', 'priority', 'timeout_ms']);

function toWire(row: { id: string; name: string; baseUrl: string; authType: string; authSecretCiphertext: string | null; enabled: number; priority: number; timeoutMs: number | null; protocolVersion: number; manifestJson: string | null; lastCheckStatus: string; lastCheckCode: string | null; lastCheckLatencyMs: number | null; checkedAt: string | null; createdAt: string; updatedAt: string }) {
  return {
    id: row.id,
    name: row.name,
    base_url: row.baseUrl,
    auth_type: row.authType,
    has_secret: !!row.authSecretCiphertext,
    secret_masked: maskSecret(row.authSecretCiphertext),
    enabled: !!row.enabled,
    priority: row.priority,
    timeout_ms: row.timeoutMs ?? null,
    protocol_version: row.protocolVersion,
    manifest: row.manifestJson ? JSON.parse(row.manifestJson) : null,
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
    const baseUrl = normalizeProviderBaseUrl(typeof parsed.base_url === 'string' ? parsed.base_url.trim() : '');
    if (!baseUrl) return NextResponse.json({ error: 'invalid_base_url' }, { status: 400 });
    const policyError = await validateProviderBaseUrl(baseUrl, getNetworkPolicy());
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    patch.baseUrl = baseUrl;
    // A base-url change invalidates any cached manifest.
    patch.manifestJson = null;
    patch.lastCheckStatus = 'unchecked';
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
