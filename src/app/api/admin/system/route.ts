import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getTranslationConfig } from '@/lib/translation';
import {
  getStoredTranslationConfig,
  resolveTranslationConfig,
} from '@/lib/translation-settings';
import { getAiUsage } from '@/lib/ai-usage';
import { dailyLimit } from '@/lib/ai-usage';
import { listRecentAudit } from '@/lib/admin';

// GET /api/admin/system — consolidated system status for the admin "System"
// view (admin only). Returns translation service health, today's AI usage,
// running/ailing playlist-import jobs and the most recent admin activity.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const db = getDB();

  // 1. Translation service summary (no secrets — only has_api_key + masked).
  const stored = await getStoredTranslationConfig(db);
  const envConfig = getTranslationConfig();
  const effective = resolveTranslationConfig(stored, envConfig);
  const hasStored = stored !== null && Object.keys(stored).length > 0;

  // 2. Today's AI usage (UTC day).
  const usage = await getAiUsage();

  // 3. Playlist-import jobs: running, failed, or stuck (long-unupdated).
  const staleCutoff = sql`datetime('now', 'localtime', '-30 minutes')`;
  const jobs = await db.all(
    sql`SELECT id, user_email, status, total, processed, imported, skipped, failed, created_at, updated_at
        FROM playlist_import_jobs
        WHERE status IN ('pending', 'running', 'failed')
           OR (status = 'completed' AND updated_at < ${staleCutoff})
        ORDER BY updated_at DESC
        LIMIT 20`
  );

  // 4. Recent admin activity.
  const audit = await listRecentAudit(20);

  return NextResponse.json({
    translation: {
      provider: effective?.provider ?? null,
      model: effective?.model ?? null,
      base_url: effective?.provider === 'workers-ai' ? null : (effective?.baseUrl ?? null),
      source: effective ? (hasStored ? 'db' : 'env') : 'none',
      has_api_key: !!effective?.apiKey,
      api_key_masked: effective?.apiKey
        ? (effective.apiKey.length <= 8
          ? '••••'
          : `${effective.apiKey.slice(0, 4)}...${effective.apiKey.slice(-4)}`)
        : null,
    },
    ai_usage: {
      used: usage.neurons,
      requests: usage.requests,
      limit: dailyLimit(),
    },
    import_jobs: jobs.map((row: Record<string, unknown>) => ({
      id: row.id,
      user_email: row.user_email,
      status: row.status,
      total: Number(row.total ?? 0),
      processed: Number(row.processed ?? 0),
      imported: Number(row.imported ?? 0),
      skipped: Number(row.skipped ?? 0),
      failed: Number(row.failed ?? 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    recent_activity: audit.map((row: Record<string, unknown>) => ({
      id: row.id,
      actor_user_id: row.actor_user_id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      reason: row.reason ?? '',
      result: row.result ?? 'success',
      occurred_at: row.occurred_at,
    })),
  });
}
