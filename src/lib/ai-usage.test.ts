import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import {
  reserveAiBudget,
  settleAiBudget,
  releaseAiBudget,
  reclaimExpiredReservations,
  getAiUsage,
  neuronsForTokens,
  estimateTokens,
  DEFAULT_RESERVATION_TTL_MS,
} from './ai-usage.ts';
import { aiUsage, aiUsageReservations } from './schema.ts';

/**
 * Concurrency test for the atomic Workers AI budget guard.
 *
 * Uses a real local libsql DB (same driver family as D1) and fires
 * concurrent reservations. The hard invariant is:
 *
 *     used(neurons) + SUM(reserved) + in-flight estimates <= limit
 *
 * i.e. after settling everything, the total committed usage can never
 * exceed the daily limit — even when far more requests are attempted than
 * the budget can fit.
 */

const LIMIT = 9000;
const DAY = '2026-08-09';

type TestDb = ReturnType<typeof makeTestDb>;

function makeTestDb(path: string, opts: { fresh?: boolean } = {}) {
  if (opts.fresh !== false) {
    try { unlinkSync(path); } catch { /* fresh */ }
  }
  // timeout = SQLite busy timeout (ms). Concurrent writers must wait for the
  // write lock instead of failing immediately with SQLITE_BUSY — the app's
  // db.ts uses the same 15s timeout for local SQLite.
  const client = createClient({ url: `file:${path}`, timeout: 15_000 });
  const db = drizzle(client, { schema: { aiUsage, aiUsageReservations } });
  return { db, client, path };
}

async function createTables(t: TestDb) {
  // WAL + a per-connection busy timeout let concurrent writers serialise on
  // the write lock instead of failing with SQLITE_BUSY — the same behaviour
  // Cloudflare D1 gives every Worker request its own binding.
  await t.client.execute('PRAGMA journal_mode=WAL');
  await t.client.execute('PRAGMA busy_timeout=15000');
  await t.db.run(sql`CREATE TABLE ai_usage (
    usage_date TEXT PRIMARY KEY,
    neurons INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0
  )`);
  await t.db.run(sql`CREATE TABLE ai_usage_reservations (
    request_id TEXT PRIMARY KEY,
    usage_date TEXT NOT NULL,
    estimated_neurons INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

async function reservedTotal(t: TestDb, date = DAY): Promise<number> {
  const row = await t.db.get(sql`
    SELECT COALESCE(SUM(estimated_neurons), 0) AS total
    FROM ai_usage_reservations WHERE usage_date = ${date} AND status = 'reserved'
  `) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

function nowRef() {
  return Date.now();
}

test('reserve + settle keeps total under the hard limit under concurrency', async () => {
  const t = makeTestDb(`/tmp/ai-quota-conc-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  const env = { AI_DAILY_NEURON_LIMIT: String(LIMIT) };
  const now = nowRef();

  // 20 concurrent requests each estimating 3000 neurons against a 9000 cap.
  // Only the first ~3 may reserve; the rest must be rejected. After settling,
  // the committed total must stay <= 9000 — this is the invariant that the
  // old check-then-run implementation broke.
  //
  // Each concurrent request gets its OWN db connection, mirroring Cloudflare
  // D1 where every Worker request has its own binding; concurrent writers
  // serialise on the database's write lock (SQLite busy-timeout), which is
  // exactly where the atomic guard's WHERE check is enforced.
  const attempts = 20;
  const estimate = 3000;
  const jobs = Array.from({ length: attempts }, async (_, i) => {
    const own = makeTestDb(t.path, { fresh: false });
    try {
      await own.client.execute('PRAGMA busy_timeout=15000');
      const r = await reserveAiBudget(estimate, { db: own.db, env, now, date: DAY, requestId: `c-${i}` });
      own.client.close();
      return r;
    } catch (e) {
      own.client.close();
      throw e;
    }
  });

  const results = await Promise.all(jobs);
  const accepted = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  assert.ok(accepted.length >= 1, 'at least one reservation should succeed');
  assert.equal(accepted.length + rejected.length, attempts);
  // With 20 × 3000 vs 9000 cap, at most 3 can be in-flight.
  assert.ok(accepted.length <= 3, `expected <=3 accepted, got ${accepted.length}`);
  assert.equal(await reservedTotal(t), accepted.length * estimate);

  // Settle every accepted reservation with a slightly different actual amount
  // (multi-退少补) — some settle below, some above their estimate.
  const actuals = accepted.map((r, i) => estimate + (i % 2 === 0 ? 100 : -500));
  await Promise.all(accepted.map((r, i) => settleAiBudget(r.requestId, actuals[i], { db: t.db, env, now, date: DAY })));

  // No reservation may remain in flight after settling.
  assert.equal(await reservedTotal(t), 0);

  const { neurons, requests } = await getAiUsage(DAY, { db: t.db });
  assert.equal(requests, accepted.length);
  assert.equal(neurons, actuals.reduce((a, b) => a + b, 0));
  assert.ok(neurons <= LIMIT, `settled usage ${neurons} must not exceed limit ${LIMIT}`);
});

test('rejects reservations that would exceed the daily cap', async () => {
  const t = makeTestDb(`/tmp/ai-quota-over-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  const env = { AI_DAILY_NEURON_LIMIT: String(LIMIT) };
  const now = nowRef();

  // Two sequential reservations of 6000 each against a 9000 cap: only one fits.
  const first = await reserveAiBudget(6000, { db: t.db, env, now, date: DAY, requestId: 'a1' });
  assert.equal(first.ok, true);
  const second = await reserveAiBudget(6000, { db: t.db, env, now, date: DAY, requestId: 'a2' });
  assert.equal(second.ok, false);
  assert.equal(second.used + second.reserved + second.estimatedNeurons > second.limit, true);

  // Settle the first to a smaller actual amount; now a 6000 reservation fits again.
  await settleAiBudget('a1', 1000, { db: t.db, env, now, date: DAY });
  const third = await reserveAiBudget(6000, { db: t.db, env, now, date: DAY, requestId: 'a3' });
  assert.equal(third.ok, true);
  await settleAiBudget('a3', 6000, { db: t.db, env, now, date: DAY });
});

test('release frees budget without recording usage', async () => {
  const t = makeTestDb(`/tmp/ai-quota-rel-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  const env = { AI_DAILY_NEURON_LIMIT: String(LIMIT) };
  const now = nowRef();

  const r = await reserveAiBudget(4000, { db: t.db, env, now, date: DAY, requestId: 'r1' });
  assert.equal(r.ok, true);
  await releaseAiBudget('r1', { db: t.db, env, now, date: DAY });
  assert.equal(await reservedTotal(t), 0);

  // Released budget can be reserved again.
  const r2 = await reserveAiBudget(4000, { db: t.db, env, now, date: DAY, requestId: 'r2' });
  assert.equal(r2.ok, true);
  await settleAiBudget('r2', 4000, { db: t.db, env, now, date: DAY });
  const { neurons, requests } = await getAiUsage(DAY, { db: t.db });
  assert.equal(neurons, 4000);
  assert.equal(requests, 1);
});

test('stale reservations are reclaimed into used budget (fail-closed)', async () => {
  const t = makeTestDb(`/tmp/ai-quota-reclaim-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  const env = { AI_DAILY_NEURON_LIMIT: String(LIMIT) };
  const now = nowRef();
  const old = now - DEFAULT_RESERVATION_TTL_MS - 1000; // definitely stale

  const r1 = await reserveAiBudget(5000, { db: t.db, env, now: old, date: DAY, requestId: 'stale-1' });
  assert.equal(r1.ok, true);
  // A fresh reservation sees the stale one; combined 5000 + 5000 > 9000? No,
  // so use 5000 twice — instead make the second clearly over budget:
  const r2 = await reserveAiBudget(5000, { db: t.db, env, now, date: DAY, requestId: 'stale-2' });
  // 5000 (stale) + 5000 = 10000 > 9000 → must be rejected while the stale one is live.
  assert.equal(r2.ok, false);

  // Reclaim: the stale reservation becomes used budget (fail-closed).
  await reclaimExpiredReservations({ db: t.db, env, now, date: DAY });
  const { neurons } = await getAiUsage(DAY, { db: t.db });
  assert.equal(neurons, 5000);
  assert.equal(await reservedTotal(t), 0);

  // After reclaim, 4000 fits again (5000 used + 4000 = 9000 <= 9000); the
  // fail-closed reclaim correctly leaves only 4000 of headroom, not 9000.
  const r3 = await reserveAiBudget(4000, { db: t.db, env, now, date: DAY, requestId: 'stale-3' });
  assert.equal(r3.ok, true);
  const r4 = await reserveAiBudget(4000, { db: t.db, env, now, date: DAY, requestId: 'stale-4' });
  assert.equal(r4.ok, false);
  await settleAiBudget('stale-3', 4000, { db: t.db, env, now, date: DAY });
});

test('token/neuron estimation helpers stay conservative', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('こんにちは世界') >= 1);
  const n = neuronsForTokens(1_000_000, 0);
  assert.equal(n, 5000); // default rate in
  const n2 = neuronsForTokens(0, 1_000_000);
  assert.equal(n2, 40000); // default rate out
});
