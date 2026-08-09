/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, CheckCircle2, CircleAlert, Clock, Loader2, Plug, ServerCrash, Settings2, XCircle,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { localeToBCP47 } from './admin-types';

interface SystemData {
  translation: {
    provider: string | null;
    model: string | null;
    base_url: string | null;
    source: 'db' | 'env' | 'none';
    has_api_key: boolean;
    api_key_masked: string | null;
  };
  ai_usage: {
    used: number;
    requests: number;
    limit: number;
  };
  import_jobs: Array<{
    id: string;
    user_email: string;
    status: string;
    total: number;
    processed: number;
    imported: number;
    skipped: number;
    failed: number;
    created_at: string;
    updated_at: string;
  }>;
  recent_activity: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    target_type: string;
    target_id: string;
    reason: string;
    result: string;
    occurred_at: string;
  }>;
}

const IMPORT_STATUS_LABEL: Record<string, string> = {
  pending: 'admin.importPending',
  running: 'admin.importRunning',
  completed: 'admin.importCompleted',
  failed: 'admin.importFailed',
  cancelled: 'admin.importCancelled',
};

/**
 * Admin "系统" view (ISSUE #82): translation-service health, today's AI
 * budget, running/failed/stuck playlist imports, and the most recent admin
 * activity (from the append-only audit log).
 */
export default function AdminSystemPanel() {
  const { t, locale } = useI18n();
  const bcp47 = localeToBCP47(locale);
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/admin/system');
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ServerCrash className="h-8 w-8 mb-3 text-[var(--muted-foreground)] opacity-20" />
        <p className="text-sm text-[var(--muted-foreground)]">{t('admin.systemLoadFailed')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
        >
          {t('admin.retry')}
        </button>
      </div>
    );
  }

  const tr = data.translation;
  const sourceLabel = tr.source === 'db'
    ? t('admin.translationSourceDb')
    : tr.source === 'env'
      ? t('admin.translationSourceEnv')
      : t('admin.translationSourceNone');

  const providerLabel = tr.provider === 'workers-ai'
    ? t('admin.translationProviderWorkersAi')
    : tr.provider === 'openai'
      ? t('admin.translationProviderOpenAi')
      : tr.provider === 'anthropic'
        ? 'Anthropic'
        : '—';

  const cardCls = 'rounded-lg border border-[var(--border)] bg-[var(--card)] p-5';

  return (
    <div className="space-y-4">
      {/* Translation service */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center gap-2">
          <Plug className="h-4 w-4 text-[var(--primary)]" />
          <h2 className="text-sm font-semibold">{t('admin.systemTranslation')}</h2>
          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            tr.source === 'none' ? 'bg-[var(--muted-foreground)]/10 text-[var(--muted-foreground)]' : 'bg-[var(--success)]/10 text-[var(--success)]'
          }`}>
            {tr.source === 'none' ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
            {sourceLabel}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationProvider')}</dt>
            <dd className="font-mono text-xs">{providerLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationModel')}</dt>
            <dd className="font-mono text-xs">{tr.model || '—'}</dd>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <dt className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationBaseUrl')}</dt>
            <dd className="truncate font-mono text-xs">{tr.provider === 'workers-ai' ? t('admin.translationWorkersAiBinding') : (tr.base_url || '—')}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationApiKey')}</dt>
            <dd className="font-mono text-xs">{tr.has_api_key ? (tr.api_key_masked || '••••') : '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] text-[var(--muted-foreground)]/70">{t('admin.systemTranslationHint')}</p>
      </section>

      {/* AI usage */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--primary)]" />
          <h2 className="text-sm font-semibold">{t('admin.systemAiUsage')}</h2>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.aiUsedToday')}</span>
            <span className="font-mono text-xs">{data.ai_usage.used} / {data.ai_usage.limit}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.aiRequestsToday')}</span>
            <span className="font-mono text-xs">{data.ai_usage.requests}</span>
          </div>
        </div>
      </section>

      {/* Import jobs */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--primary)]" />
          <h2 className="text-sm font-semibold">{t('admin.systemImports')}</h2>
        </div>
        {data.import_jobs.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">{t('admin.systemNoImports')}</p>
        ) : (
          <ul className="space-y-2">
            {data.import_jobs.map((job) => {
              const failed = job.status === 'failed';
              return (
                <li key={job.id} className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2">
                  <div className="flex items-center gap-2">
                    {failed
                      ? <CircleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--destructive)]" />
                      : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />}
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      failed ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
                    }`}>
                      {t(IMPORT_STATUS_LABEL[job.status] ?? 'admin.importPending')}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--muted-foreground)]">
                      {job.processed}/{job.total}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--muted-foreground)]/70">
                    {t('home.createdBy')}: {job.user_email} · {new Date(job.updated_at).toLocaleString(bcp47)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent admin activity */}
      <section className={cardCls}>
        <div className="mb-3 flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[var(--primary)]" />
          <h2 className="text-sm font-semibold">{t('admin.systemRecentActivity')}</h2>
        </div>
        {data.recent_activity.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">{t('admin.systemNoActivity')}</p>
        ) : (
          <ul className="space-y-2">
            {data.recent_activity.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                  {new Date(entry.occurred_at).toLocaleString(bcp47)}
                </span>
                <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--foreground)]">
                  {entry.action}
                </span>
                <span className="truncate text-[var(--muted-foreground)]">
                  {entry.actor_user_id} → {entry.target_type}:{entry.target_id}
                </span>
                {entry.reason && (
                  <span className="truncate text-[var(--muted-foreground)]/60">“{entry.reason}”</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
