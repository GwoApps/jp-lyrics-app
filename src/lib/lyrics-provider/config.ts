/**
 * DB access for the global `lyrics_provider_configs` table (ISSUE #148).
 *
 * Only the admin API layer calls the mutation functions. The orchestrator calls
 * `listEffectiveProviders` to build the read-only global chain used by every
 * sync / import path. Secrets are never returned plaintext — callers must use
 * `decryptProviderSecret` against the stored ciphertext when they need the
 * token for an actual request.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getDB, schema } from '../db.ts';
import { assertFullOrderedSet } from './reorder.ts';

export interface ProviderConfigRow {
  id: string;
  name: string;
  kind: 'builtin' | 'http';
  baseUrl: string | null;
  authType: 'none' | 'bearer';
  authSecretCiphertext: string | null;
  enabled: number;
  priority: number;
  timeoutMs: number | null;
  sourceConfig: string | null;
  protocolVersion: number;
  manifestJson: string | null;
  lastCheckStatus: 'ok' | 'failed' | 'unchecked';
  lastCheckCode: string | null;
  lastCheckLatencyMs: number | null;
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type DB = ReturnType<typeof getDB>;

export async function getProviderConfig(db: DB, id: string): Promise<ProviderConfigRow | null> {
  const row = await db.select().from(schema.lyricsProviderConfigs)
    .where(eq(schema.lyricsProviderConfigs.id, id)).get();
  return row ?? null;
}

export async function listProviderConfigs(db: DB): Promise<ProviderConfigRow[]> {
  return db.select().from(schema.lyricsProviderConfigs)
    .orderBy(asc(schema.lyricsProviderConfigs.priority), asc(schema.lyricsProviderConfigs.createdAt))
    .all();
}

/** The read-only global chain actually consumed by sync/import (enabled only, by priority). */
export async function listEffectiveProviders(db: DB): Promise<ProviderConfigRow[]> {
  return db.select().from(schema.lyricsProviderConfigs)
    .where(eq(schema.lyricsProviderConfigs.enabled, 1))
    .orderBy(asc(schema.lyricsProviderConfigs.priority), asc(schema.lyricsProviderConfigs.createdAt))
    .all();
}

export async function insertProviderConfig(db: DB, row: {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'none' | 'bearer';
  authSecretCiphertext: string | null;
  enabled: number;
  priority: number;
  timeoutMs: number | null;
  sourceConfig: string | null;
  protocolVersion: number;
}): Promise<void> {
  await db.insert(schema.lyricsProviderConfigs).values(row).run();
}

export async function updateProviderConfig(
  db: DB,
  id: string,
  patch: Partial<{
    name: string;
    baseUrl: string;
    authType: 'none' | 'bearer';
    authSecretCiphertext: string | null;
    enabled: number;
    priority: number;
    timeoutMs: number | null;
    sourceConfig: string | null;
    manifestJson: string | null;
    lastCheckStatus: 'ok' | 'failed' | 'unchecked';
    lastCheckCode: string | null;
    lastCheckLatencyMs: number | null;
    checkedAt: string | null;
  }>,
): Promise<void> {
  const values: Record<string, unknown> = {
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await db.update(schema.lyricsProviderConfigs)
    .set(values)
    .where(eq(schema.lyricsProviderConfigs.id, id))
    .run();
}

export async function deleteProviderConfig(db: DB, id: string): Promise<void> {
  await db.delete(schema.lyricsProviderConfigs).where(eq(schema.lyricsProviderConfigs.id, id)).run();
}

/**
 * Reorder provider priorities in one pass (admin drag-to-sort).
 *
 * Runs atomically through the Drizzle public `db.batch()` (which internally
 * prepares+binds each statement, so it works on both libsql/Turso and D1 —
 * unlike `db.$client.batch()` which takes driver-specific statement types).
 *
 * The caller must pass the FULL ordered set of provider ids; the set is
 * validated against every stored provider so a partial list can never leave
 * duplicated priorities behind.
 */
export async function reorderProviders(db: DB, orderedIds: string[]): Promise<void> {
  const stored = await listProviderConfigs(db);
  assertFullOrderedSet(stored.map((row) => row.id), orderedIds);

  const now = new Date().toISOString();
  await db.batch(
    orderedIds.map((id, index) =>
      db.update(schema.lyricsProviderConfigs)
        .set({ priority: index, updatedAt: now })
        .where(eq(schema.lyricsProviderConfigs.id, id)),
    ),
  );
}

/** Non-secret diagnostic state used by the admin UI list. */
export function providerHealthSnapshot(row: ProviderConfigRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    base_url: row.baseUrl,
    auth_type: row.authType,
    has_secret: !!row.authSecretCiphertext,
    enabled: !!row.enabled,
    priority: row.priority,
    timeout_ms: row.timeoutMs ?? null,
    source_config: row.sourceConfig ?? null,
    protocol_version: row.protocolVersion,
    last_check_status: row.lastCheckStatus,
    last_check_code: row.lastCheckCode ?? null,
    last_check_latency_ms: row.lastCheckLatencyMs ?? null,
    checked_at: row.checkedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

// Suppress unused import warning if and/eq become unused in future edits.
void and;
