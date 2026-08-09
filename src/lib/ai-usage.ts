import { sql, eq, and, lt } from 'drizzle-orm';
import * as schema from './schema.ts';

/**
 * Hard daily cap for Workers AI usage (server-side, D1/SQLite-backed).
 *
 * Workers AI free tier is 10,000 Neurons/day; on paid plans usage above
 * that is billed. This guard uses an atomic *reservation* model so the free
 * allocation can never be exceeded, even under concurrent requests:
 *
 *   1. `reserveAiBudget()` atomically books an estimated budget BEFORE the
 *      model runs. The INSERT ... SELECT ... WHERE used+reserved+estimate
 *      <= limit is a single SQL statement, so concurrent requests serialise
 *      on the write lock and the cap holds exactly.
 *   2. After the call, `settleAiBudget()` books the ACTUAL consumption
 *      (多退少补) with a single conditional UPDATE — only a reservation still
 *      in 'reserved' state is settled, so double-settle can never
 *      double-count.
 *   3. On failure / cancellation `releaseAiBudget()` frees the estimate.
 *   4. If a Worker crashes mid-request, the reservation outlives its TTL and
 *      `reclaimExpiredReservations()` folds it into used budget
 *      (fail-closed), so budget is never silently freed after a crash.
 *
 * Accounting is DERIVED from reservation rows: the daily "used" is the sum
 * of settled (and reclaimed) reservations, "in flight" is the sum of still
 * 'reserved' rows. Every mutation is a single statement (or one atomic
 * batch), so no multi-statement transaction is ever held open — which keeps
 * the guard deadlock-free on every backend (Cloudflare D1, Turso, local
 * SQLite, and the shared local libsql connection).
 *
 * Env:
 *   AI_DAILY_NEURON_LIMIT   neurons per UTC day   (default: 9000)
 *   AI_NEURON_RATE_IN       neurons per 1M input tokens   (default: 5000, conservative mid-size estimate)
 *   AI_NEURON_RATE_OUT      neurons per 1M output tokens  (default: 40000)
 *   AI_RESERVATION_TTL_MS   stale-reservation reclaim TTL (default: 600000 = 10 min)
 *
 * Token counts come from the model's usage payload when available,
 * otherwise they are estimated (2 chars ≈ 1 token — conservative for CJK).
 */

export const DEFAULT_DAILY_NEURON_LIMIT = 9000;
export const DEFAULT_RATE_IN = 5000;
export const DEFAULT_RATE_OUT = 40000;
export const DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1000;
/** Old settled/released rows older than this many days are purged. */
export const RESERVATION_RETENTION_DAYS = 7;

/** UTC calendar day — matches Cloudflare's free-allocation reset (00:00 UTC). */
export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AI_DAILY_NEURON_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_NEURON_LIMIT;
}

export function rateIn(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AI_NEURON_RATE_IN);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_IN;
}

export function rateOut(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AI_NEURON_RATE_OUT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_OUT;
}

export function reservationTTL(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.AI_RESERVATION_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RESERVATION_TTL_MS;
}

/** Result of an atomic budget reservation. */
export interface AiBudgetReservation {
  /** True when the estimated budget was atomically reserved. */
  ok: boolean;
  /** Opaque id used to settle/release this reservation later. */
  requestId: string;
  /** UTC day the reservation was booked for. */
  date: string;
  /** Reserved estimate in neurons. */
  estimatedNeurons: number;
  /** Committed usage at check time (only meaningful when !ok). */
  used: number;
  /** In-flight reserved budget at check time (only meaningful when !ok). */
  reserved: number;
  /** Daily limit the guard enforced. */
  limit: number;
}

export interface AiReservationOptions {
  /** Injected DB (tests); defaults to the app-wide getDB(). */
  db?: unknown;
  env?: Record<string, string | undefined>;
  now?: number;
  requestId?: string;
  date?: string;
}

// Lazy import keeps this module importable under the node test runner
// (no `@/` alias / no eager DB init) while still using getDB() in the app.
async function defaultDB(): Promise<unknown> {
  const { getDB } = await import('./db.ts');
  return getDB();
}

/** Backend-agnostic affected-row count for libsql (rowsAffected) and D1 (meta.changes). */
function changesOf(result: unknown): number {
  const r = result as { rowsAffected?: number; meta?: { changes?: number } } | undefined;
  if (typeof r?.rowsAffected === 'number') return r.rowsAffected;
  const changes = r?.meta?.changes;
  return typeof changes === 'number' ? changes : 0;
}

function generateRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Daily committed usage, derived from reservation rows plus the legacy ledger. */
export async function getAiUsage(date = todayKey(), opts: AiReservationOptions = {}): Promise<{ neurons: number; requests: number }> {
  try {
    const db = opts.db ?? (await defaultDB());
    const row = await (db as { get: (q: unknown) => Promise<{ used?: number | null; requests?: number | null }> }).get(sql`
      SELECT
        COALESCE((SELECT neurons FROM ai_usage WHERE usage_date = ${date}), 0)
        + COALESCE((SELECT SUM(estimated_neurons) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'settled'), 0) AS used,
        COALESCE((SELECT requests FROM ai_usage WHERE usage_date = ${date}), 0)
        + COALESCE((SELECT COUNT(*) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'settled'), 0) AS requests
    `);
    return { neurons: Number(row?.used ?? 0), requests: Number(row?.requests ?? 0) };
  } catch (error) {
    // Table may not exist yet on a fresh deploy; treat as zero usage.
    console.warn(`[ai-usage] usage lookup failed — ${error instanceof Error ? error.message : String(error)}`);
    return { neurons: 0, requests: 0 };
  }
}

async function readBudgetSnapshot(db: unknown, date: string): Promise<{ used: number; reserved: number }> {
  try {
    const row = await (db as { get: (q: unknown) => Promise<{ used?: number | null; reserved?: number | null }> }).get(sql`
      SELECT
        COALESCE((SELECT neurons FROM ai_usage WHERE usage_date = ${date}), 0)
        + COALESCE((SELECT SUM(estimated_neurons) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'settled'), 0) AS used,
        COALESCE((SELECT SUM(estimated_neurons) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'reserved'), 0) AS reserved
    `);
    return { used: Number(row?.used ?? 0), reserved: Number(row?.reserved ?? 0) };
  } catch (error) {
    console.warn(`[ai-usage] budget snapshot failed — ${error instanceof Error ? error.message : String(error)}`);
    return { used: 0, reserved: 0 };
  }
}

/**
 * Atomically reserve `estimatedNeurons` of today's budget.
 *
 * The INSERT ... SELECT ... WHERE is a single SQL statement: SQLite takes
 * the write lock for the whole statement, so concurrent reservations are
 * serialised and the invariant
 *     used(settled) + SUM(reserved) + estimate <= limit
 * is checked against a consistent view. Fails (ok=false) when the budget
 * has no room — the caller MUST NOT call the billing model.
 */
export async function reserveAiBudget(
  estimatedNeurons: number,
  opts: AiReservationOptions = {},
): Promise<AiBudgetReservation> {
  const db = opts.db ?? (await defaultDB());
  const env = opts.env ?? process.env;
  const limit = dailyLimit(env);
  const now = opts.now ?? Date.now();
  const date = opts.date ?? todayKey(new Date(now));
  const estimated = Math.max(0, Math.ceil(estimatedNeurons));
  const requestId = opts.requestId ?? generateRequestId();

  // Convert crashed/stale reservations into used budget (fail-closed) so
  // the cap stays tight; throttled + de-duped per isolate.
  await maybeReclaim(db, env, now);

  let result: unknown;
  try {
    result = await (db as { run: (q: unknown) => Promise<unknown> }).run(sql`
      INSERT INTO ai_usage_reservations (request_id, usage_date, estimated_neurons, status, created_at, updated_at)
      SELECT ${requestId}, ${date}, ${estimated}, 'reserved', ${now}, ${now}
      WHERE (
        COALESCE((SELECT neurons FROM ai_usage WHERE usage_date = ${date}), 0)
        + COALESCE((SELECT SUM(estimated_neurons) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'settled'), 0)
        + COALESCE((SELECT SUM(estimated_neurons) FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'reserved'), 0)
        + ${estimated}
      ) <= ${limit}
    `);
  } catch (error) {
    // Fail CLOSED: if accounting cannot be written (missing table on an
    // unmigrated deploy, transient DB failure, ...) we MUST NOT let the
    // caller run the billing model. The old check-then-record guard silently
    // swallowed these and kept spending; that is exactly the bug this
    // reservation model replaces.
    console.error(`[ai-usage] reservation failed for ${requestId} — ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  const ok = changesOf(result) === 1;

  if (!ok) {
    // Best-effort snapshot for the caller's quota-exceeded message.
    const snapshot = await readBudgetSnapshot(db, date);
    return { ok: false, requestId, date, estimatedNeurons: estimated, used: snapshot.used, reserved: snapshot.reserved, limit };
  }
  return { ok: true, requestId, date, estimatedNeurons: estimated, used: 0, reserved: estimated, limit };
}

/**
 * Book the ACTUAL consumption (多退少补) and free the reservation with a
 * single conditional UPDATE. Only a reservation still in 'reserved' state is
 * settled (the estimate is replaced by the actual figure, so the derived
 * daily "used" reflects reality); double-settle — e.g. after a stale reclaim
 * already folded it in — is a no-op and can never double-count.
 */
export async function settleAiBudget(requestId: string, actualNeurons: number, opts: AiReservationOptions = {}): Promise<void> {
  const db = opts.db ?? (await defaultDB());
  const now = opts.now ?? Date.now();
  const spent = Math.max(0, Math.ceil(actualNeurons));
  await (db as { update: (t: unknown) => { set: (v: Record<string, unknown>) => { where: (w: unknown) => { run: () => Promise<unknown> } } } })
    .update(schema.aiUsageReservations)
    .set({ status: 'settled', estimatedNeurons: spent, updatedAt: now })
    .where(and(eq(schema.aiUsageReservations.requestId, requestId), eq(schema.aiUsageReservations.status, 'reserved')))
    .run();
}

/** Free a reservation without recording usage (failed/cancelled request). */
export async function releaseAiBudget(requestId: string, opts: AiReservationOptions = {}): Promise<void> {
  const db = opts.db ?? (await defaultDB());
  const now = opts.now ?? Date.now();
  await (db as { update: (t: unknown) => { set: (v: Record<string, unknown>) => { where: (w: unknown) => { run: () => Promise<unknown> } } } })
    .update(schema.aiUsageReservations)
    .set({ status: 'released', updatedAt: now })
    .where(and(eq(schema.aiUsageReservations.requestId, requestId), eq(schema.aiUsageReservations.status, 'reserved')))
    .run();
}

/**
 * Reclaim reservations that outlived their TTL (crash/timeout/cancel without
 * release). The stale estimate is folded into the daily `used` counter (the
 * status flips to 'settled' with the estimate intact) so the budget is never
 * silently freed after a Worker died mid-request (fail-closed).
 *
 * A single UPDATE (plus one atomic cleanup batch for old rows) — no open
 * transaction, so it can never deadlock with concurrent reservations.
 */
export async function reclaimExpiredReservations(opts: AiReservationOptions = {}): Promise<void> {
  const db = opts.db ?? (await defaultDB());
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now();
  const cutoff = now - reservationTTL(env);

  const d = db as {
    update: (t: unknown) => {
      set: (v: Record<string, unknown>) => {
        where: (w: unknown) => {
          run: () => Promise<unknown>;
        };
      };
    };
    batch: (items: unknown[]) => Promise<unknown>;
    delete: (t: unknown) => { where: (w: unknown) => unknown };
  };

  // Fold stale reservations into used (fail-closed) — single statement.
  await d.update(schema.aiUsageReservations)
    .set({ status: 'settled', updatedAt: now })
    .where(and(eq(schema.aiUsageReservations.status, 'reserved'), lt(schema.aiUsageReservations.createdAt, cutoff)))
    .run();

  // Best-effort purge of settled/released rows from previous days so the
  // table stays tiny. Runs atomically but failures are non-fatal.
  try {
    const retentionMs = RESERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    await d.batch([
      d.delete(schema.aiUsageReservations).where(
        and(
          eq(schema.aiUsageReservations.status, 'settled'),
          lt(schema.aiUsageReservations.createdAt, now - retentionMs),
        ),
      ),
      d.delete(schema.aiUsageReservations).where(
        and(
          eq(schema.aiUsageReservations.status, 'released'),
          lt(schema.aiUsageReservations.createdAt, now - retentionMs),
        ),
      ),
    ]);
  } catch (error) {
    console.warn(`[ai-usage] reservation cleanup failed — ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Throttle + de-dupe the reclaim pass so the hot reservation path stays a
// single write. Concurrent callers (even across connections) share one
// in-flight reclaim instead of each running its own pass.
let lastReclaimAt = 0;
let inFlightReclaim: Promise<void> | null = null;
async function maybeReclaim(db: unknown, env: Record<string, string | undefined>, now: number): Promise<void> {
  if (now - lastReclaimAt < 60_000) return;
  if (inFlightReclaim) return inFlightReclaim;
  lastReclaimAt = now;
  inFlightReclaim = (async () => {
    try {
      await reclaimExpiredReservations({ db, env, now });
    } catch (error) {
      // Reclaim is best-effort cleanup; never block reservations on it.
      console.warn(`[ai-usage] reservation reclaim failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      inFlightReclaim = null;
    }
  })();
  return inFlightReclaim;
}

/** Rough token estimate (2 chars ≈ 1 token; conservative for CJK-heavy lyrics). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 2));
}

export function neuronsForTokens(inputTokens: number, outputTokens: number, env: Record<string, string | undefined> = process.env): number {
  const input = (inputTokens / 1_000_000) * rateIn(env);
  const output = (outputTokens / 1_000_000) * rateOut(env);
  return Math.ceil(input + output);
}
