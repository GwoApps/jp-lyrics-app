'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, GripVertical, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ProviderTestResult, ProviderWire, SourceSchema, SourceSchemaField } from './lyrics-provider-types';

export interface SortableRowProps {
  p: ProviderWire;
  /** Latest on-demand test outcome for this row, when present. */
  testResult?: ProviderTestResult;
  /** True while this row is the active drag source. */
  dragging: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onTest?: () => void;
  testing: boolean;
  onEdit: () => void;
  onDelete?: () => void;
  sourceSchema?: SourceSchema;
}

/**
 * One sortable provider card (dnd-kit `useSortable`).
 *
 * While another row is dragged past this one, dnd-kit's transform transition
 * animates this card smoothly out of the way; the drag source itself renders
 * as a dimmed placeholder and the floating preview lives in `DragOverlay`.
 */
export default function SortableProviderRow({ p, testResult, dragging, onMoveUp, onMoveDown, onToggle, onTest, testing, onEdit, onDelete, sourceSchema }: SortableRowProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id: p.id });

  return (
    <li
      data-provider-id={p.id}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-col gap-2 rounded-md border bg-[var(--muted)]/30 px-3 py-2 ${
        dragging ? 'border-[var(--primary)] opacity-30' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('admin.lyricsProviderMoveUp')}
          title={t('admin.lyricsProviderMoveUp')}
          className="cursor-grab touch-none text-[var(--muted-foreground)]/40 hover:text-[var(--muted-foreground)] active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <ProviderRowSummary p={p} />
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <button type="button" onClick={onMoveUp} aria-label={t('admin.lyricsProviderMoveUp')}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onMoveDown} aria-label={t('admin.lyricsProviderMoveDown')}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onToggle}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${p.enabled ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
            {p.enabled ? t('admin.lyricsProviderEnabled') : t('admin.lyricsProviderDisabled')}
          </button>
          <button type="button" onClick={onEdit} aria-label={t('common.edit')}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] p-1.5 text-[11px] font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)] sm:px-2 sm:py-1">
            <Pencil className="h-3 w-3" />
            <span className="hidden sm:inline">{t('common.edit')}</span>
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-[11px] text-[var(--muted-foreground)]">
        {/* Manifest health check is HTTP-plugin-only: builtin sources have no
            base_url to probe, so the status row would be stuck at "unchecked". */}
        {p.kind === 'http' && (
          <span className="inline-flex items-center gap-1">
            {p.last_check_status === 'ok'
              ? <CheckCircle2 className="h-3 w-3 text-[var(--success)]" />
              : p.last_check_status === 'failed'
                ? <CircleAlert className="h-3 w-3 text-[var(--destructive)]" />
                : <span className="h-3 w-3 rounded-full border border-[var(--border)]" />}
            {p.last_check_status === 'ok'
              ? t('admin.lyricsProviderCheckOk')
              : p.last_check_status === 'failed'
                ? (p.last_check_code || t('admin.lyricsProviderCheckFailed'))
                : t('admin.lyricsProviderCheckUnchecked')}
            {p.last_check_latency_ms != null && ` · ${p.last_check_latency_ms}ms`}
          </span>
        )}
        <TestResultBadge result={testResult} />
      </div>
      <ProviderConfigPreview p={p} sourceSchema={sourceSchema} />
      <div className="flex items-center gap-2 pl-6">
        {onTest && (
          <button type="button" onClick={onTest} disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--muted)] disabled:opacity-50">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('admin.lyricsProviderTest')}
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={onDelete}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--destructive)]/40 px-2 py-1 text-[11px] font-medium text-[var(--destructive)] hover:bg-[var(--destructive)]/10">
            <Trash2 className="h-3 w-3" /> {t('common.delete')}
          </button>
        )}
      </div>
    </li>
  );
}

/** Read-only snapshot of editable values; changes remain Dialog-only. */
function ProviderConfigPreview({ p, sourceSchema }: { p: ProviderWire; sourceSchema?: SourceSchema }) {
  const { t } = useI18n();
  const items: Array<{ key: string; label: string; value: string; mono?: boolean; wide?: boolean }> = [];
  const formatValue = (value: unknown, type: SourceSchemaField['type']) => {
    if (type === 'boolean') return value ? t('admin.lyricsProviderOn') : t('admin.lyricsProviderOff');
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
  };

  if (p.kind === 'http') {
    items.push({
      key: 'base_url',
      label: t('admin.lyricsProviderBaseUrl'),
      value: p.base_url ?? t('admin.lyricsProviderPreviewDefault'),
      mono: true,
      wide: true,
    });
    items.push({
      key: 'auth_type',
      label: t('admin.lyricsProviderAuthType'),
      value: p.auth_type === 'bearer'
        ? `${t('admin.lyricsProviderAuthBearer')}${p.secret_masked ? ` (${p.secret_masked})` : ''}`
        : t('admin.lyricsProviderAuthNone'),
      mono: p.auth_type === 'bearer',
    });
  }

  items.push({
    key: 'timeout_ms',
    label: t('admin.lyricsProviderTimeout'),
    value: p.timeout_ms == null
      ? t('admin.lyricsProviderPreviewDefault')
      : `${p.timeout_ms.toLocaleString()} ms`,
    mono: true,
  });

  if (p.kind === 'builtin' && sourceSchema) {
    for (const field of sourceSchema.fields) {
      const stored = p.source_config?.[field.key];
      let value: string;
      if (stored === undefined || stored === null || stored === '') {
        if (field.env_fallback) {
          value = t('admin.lyricsProviderPreviewEnvFallback', { name: field.env_fallback });
        } else if (field.default !== null) {
          value = `${formatValue(field.default, field.type)} (${t('admin.lyricsProviderPreviewDefault')})`;
        } else if (field.placeholder_key) {
          value = `${t(`admin.${field.placeholder_key}`)} (${t('admin.lyricsProviderPreviewDefault')})`;
        } else {
          value = t('admin.lyricsProviderPreviewDefault');
        }
      } else {
        value = formatValue(stored, field.type);
      }
      items.push({
        key: field.key,
        label: t(`admin.${field.label_key}`),
        value,
        mono: field.type !== 'boolean',
        wide: field.type === 'string',
      });
    }
  }

  return (
    <dl data-provider-config-preview className="grid gap-x-4 gap-y-2 rounded-md border border-[var(--border)]/70 bg-[var(--card)]/60 px-3 py-2.5 sm:ml-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.key} className={`min-w-0 ${item.wide ? 'sm:col-span-2' : ''}`}>
          <dt className="text-[10px] font-medium text-[var(--muted-foreground)]">{item.label}</dt>
          <dd className={`mt-0.5 truncate text-xs text-[var(--foreground)] ${item.mono ? 'font-mono' : ''}`} title={item.value}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Compact name + kind summary used by both the sortable row and the overlay. */
export function ProviderRowSummary({ p }: { p: ProviderWire }) {
  const { t } = useI18n();
  return (
    <>
      <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center`}>
        <span className={`h-2 w-2 rounded-full ${p.enabled ? 'bg-[var(--success)]' : 'bg-[var(--muted-foreground)]/40'}`} />
      </span>
      <span className="truncate text-sm font-medium">{p.name}</span>
      <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
        p.kind === 'builtin'
          ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
          : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
      }`}>
        {p.kind === 'builtin' ? t('admin.lyricsProviderKindBuiltin') : t('admin.lyricsProviderKindHttp')}
      </span>
      {p.insecure_transport && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--warning)]/15 px-2 py-0.5 text-[10px] font-medium text-[var(--warning)]">
          {t('admin.lyricsProviderInsecureTransport')}
        </span>
      )}
      {p.manifest?.version && (
        <span className="hidden font-mono text-[10px] text-[var(--muted-foreground)] sm:inline">v{p.manifest.version}</span>
      )}
    </>
  );
}

/** Live on-demand test-result badge for a row. */
function TestResultBadge({ result }: { result?: ProviderTestResult }) {
  const { t } = useI18n();
  if (!result) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${result.ok ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}`}>
      {result.ok
        ? t('admin.lyricsProviderTestOk')
        : `${t('admin.lyricsProviderTestFail')} (${result.code})`}
      {result.latencyMs != null && ` · ${result.latencyMs}ms`}
    </span>
  );
}
