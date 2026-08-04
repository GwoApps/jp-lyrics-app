import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Hard daily cap for Workers AI usage (server-side, D1/SQLite-backed).
 *
 * Workers AI free tier is 10,000 Neurons/day; on paid plans usage above
 * that is billed. This guard records every workers-ai translation and
 * refuses requests once the day's budget is spent, so the free allocation
 * can never be exceeded. Defaults keep a safety margin below 10,000.
 *
 * Env:
 *   AI_DAILY_NEURON_LIMIT   neurons per UTC day   (default: 9000)
 *   AI_NEURON_RATE_IN       neurons per 1M input tokens   (default: 5000, conservative mid-size estimate)
 *   AI_NEURON_RATE_OUT      neurons per 1M output tokens  (default: 40000)
 *
 * Token counts come from the model's usage payload when available,
 * otherwise they are estimated (2 chars ≈ 1 token — conservative for CJK).
 */

export const DEFAULT_DAILY_NEURON_LIMIT = 9000;
export const DEFAULT_RATE_IN = 5000;
export const DEFAULT_RATE_OUT = 40000;

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

export interface AiUsageSnapshot {
  used: number;
  requests: number;
  limit: number;
  ok: boolean;
}

export async function getAiUsage(date = todayKey()): Promise<{ neurons: number; requests: number }> {
  try {
    const row = await getDB().select({
      neurons: schema.aiUsage.neurons,
      requests: schema.aiUsage.requests,
    }).from(schema.aiUsage).where(eq(schema.aiUsage.usageDate, date)).get();
    return { neurons: row?.neurons ?? 0, requests: row?.requests ?? 0 };
  } catch (error) {
    // Table may not exist yet on a fresh deploy; treat as zero usage.
    console.warn(`[ai-usage] usage lookup failed — ${error instanceof Error ? error.message : String(error)}`);
    return { neurons: 0, requests: 0 };
  }
}

/** True if the daily budget still has room for at least `estimatedNeurons`. */
export async function checkAiQuota(
  estimatedNeurons: number,
  env: Record<string, string | undefined> = process.env,
): Promise<AiUsageSnapshot> {
  const { neurons: used } = await getAiUsage();
  const limit = dailyLimit(env);
  return { used, requests: 0, limit, ok: used + estimatedNeurons <= limit };
}

/** Record consumed neurons (and one request) for today. */
export async function recordAiUsage(neurons: number): Promise<void> {
  const spent = Math.max(0, Math.ceil(neurons));
  if (spent === 0) return;
  const date = todayKey();
  try {
    await getDB().insert(schema.aiUsage).values({
      usageDate: date,
      neurons: spent,
      requests: 1,
    }).onConflictDoUpdate({
      target: schema.aiUsage.usageDate,
      set: {
        neurons: sql`${schema.aiUsage.neurons} + ${spent}`,
        requests: sql`${schema.aiUsage.requests} + 1`,
      },
    }).run();
  } catch (error) {
    // Never let accounting break a translation.
    console.warn(`[ai-usage] usage recording failed — ${error instanceof Error ? error.message : String(error)}`);
  }
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
