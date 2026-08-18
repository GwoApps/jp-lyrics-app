import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { writeAuditLog, isSameOriginRequest } from '@/lib/admin';
import { getProviderConfig, updateProviderConfig } from '@/lib/lyrics-provider/config';
import { getBudgetConfig } from '@/lib/lyrics-provider/budget';
import { fetchManifest } from '@/lib/lyrics-provider/http-client';
import { decryptProviderSecret } from '@/lib/lyrics-provider/secret';
import { getNetworkPolicy, isInsecureTransport, normalizeProviderBaseUrl, validateProviderBaseUrl } from '@/lib/lyrics-provider/policy';

// POST /api/admin/lyrics-providers/[id]/test — validate manifest + protocol for an
// existing provider. Admin only; never auto-saves. Optionally tests a form
// snapshot (base_url / auth_type / auth_secret) without saving first.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // CSRF defence-in-depth: reject cross-origin admin mutations before parsing
  // or touching any external provider.
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const db = getDB();
  const existing = await getProviderConfig(db, id);
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as {
    base_url?: string;
    auth_type?: string;
    auth_secret?: string;
  };

  // Build the candidate config from the stored row + optional form snapshot.
  const baseUrl = normalizeProviderBaseUrl(body.base_url?.trim() || existing.baseUrl) ?? existing.baseUrl;
  const authType = body.auth_type === 'bearer' ? 'bearer' : existing.authType;
  let authSecret = existing.authType === 'bearer' && existing.authSecretCiphertext
    ? await decryptProviderSecret(existing.authSecretCiphertext)
    : null;
  if (typeof body.auth_secret === 'string' && body.auth_secret.trim()) {
    authSecret = body.auth_secret.trim();
  }

  const policyError = await validateProviderBaseUrl(baseUrl, getNetworkPolicy());
  if (policyError) {
    return NextResponse.json({ ok: false, code: policyError, insecure: false }, { status: 200 });
  }

  const budget = getBudgetConfig();
  const timeoutMs = Math.min(budget.manifestTimeoutMs, budget.maxTimeoutMs);
  const result = await fetchManifest({ baseUrl, authType, authSecret }, timeoutMs);

  // Only persist the diagnostic health state when the tested config matches the
  // provider's persisted config exactly. A temporary form-snapshot test (unsaved
  // base_url / auth) must NOT overwrite the stored row's manifest/health — the
  // list would otherwise show a manifest for a service the row isn't actually
  // using. Snapshot tests return the result without touching the DB.
  const testedMatchesStored =
    baseUrl === existing.baseUrl &&
    authType === existing.authType &&
    authSecret === (existing.authType === 'bearer' && existing.authSecretCiphertext
      ? await decryptProviderSecret(existing.authSecretCiphertext)
      : null);
  if (testedMatchesStored) {
    if (result.ok) {
      await updateProviderConfig(db, id, {
        lastCheckStatus: 'ok',
        lastCheckCode: null,
        lastCheckLatencyMs: result.latencyMs,
        checkedAt: new Date().toISOString(),
        manifestJson: JSON.stringify(result.manifest),
      });
    } else {
      await updateProviderConfig(db, id, {
        lastCheckStatus: 'failed',
        lastCheckCode: result.code,
        lastCheckLatencyMs: result.latencyMs,
        checkedAt: new Date().toISOString(),
        manifestJson: null,
      });
    }
  }

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: 'test_lyrics_provider',
    targetType: 'lyrics_provider',
    targetId: id,
    beforeJson: null,
    afterJson: JSON.stringify({
      base_url: baseUrl,
      auth_type: authType,
      has_secret: !!authSecret,
      ok: result.ok,
      code: result.ok ? null : result.code,
      latency_ms: result.latencyMs,
    }),
    reason: '',
  });

  return NextResponse.json({
    ok: result.ok,
    ...(result.ok
      ? { manifest: result.manifest, latencyMs: result.latencyMs, insecure: isInsecureTransport(baseUrl) }
      : { code: result.code, latencyMs: result.latencyMs, insecure: isInsecureTransport(baseUrl) }),
  }, { status: 200 });
}
