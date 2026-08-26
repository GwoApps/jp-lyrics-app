/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CheckCircle2, ChevronDown, ChevronUp, CircleAlert, GripVertical, Loader2, Plus, Plug, RefreshCw, Trash2, X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ProviderWire {
  id: string;
  name: string;
  kind: 'builtin' | 'http';
  base_url: string | null;
  auth_type: 'none' | 'bearer';
  has_secret: boolean;
  secret_masked: string | null;
  enabled: boolean;
  priority: number;
  timeout_ms: number | null;
  protocol_version: number;
  manifest: { id?: string; name?: string; version?: string; capabilities?: string[] } | null;
  last_check_status: 'ok' | 'failed' | 'unchecked';
  last_check_code: string | null;
  last_check_latency_ms: number | null;
  checked_at: string | null;
  insecure_transport: boolean;
}

interface PolicyWire {
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
}
interface BudgetWire {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  manifestTimeoutMs: number;
  chainTimeoutMs: number;
}

interface ListResponse {
  providers: ProviderWire[];
  policy: PolicyWire;
  budgets: BudgetWire;
  secret_key_configured: boolean;
}

const EMPTY_FORM = {
  name: '',
  base_url: '',
  auth_type: 'none' as 'none' | 'bearer',
  auth_secret: '',
  timeout_ms: '',
};

/**
 * Admin "歌词源" panel (ISSUE #148 Phase 2): CRUD / test / reorder / enable &
 * disable global HTTP lyrics providers. Only renders for admins (the parent
 * admin route already enforces server-side 403 for non-admins).
 */
export default function LyricsProvidersPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<ProviderWire | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; code?: string; latencyMs?: number }>>({});
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Dialog visibility is a dedicated flag so create (editing=null) and edit
  // (editing!=null) both work through the same dialog.
  const [dialogOpen, setDialogOpen] = useState(false);
  // dnd-kit sortable: id of the row currently being dragged (drives the
  // DragOverlay preview + the placeholder styling on the source row).
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dialogTitleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const formNameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(false);
    }
    try {
      const res = await fetch('/api/admin/lyrics-providers');
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      if (!silent) setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editing) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setTestResult({});
    setEditing(null); // null editing + open dialog → create mode
    setDialogOpen(true);
    requestAnimationFrame(() => formNameRef.current?.focus());
  };

  const openEdit = (p: ProviderWire) => {
    setEditing(p);
    setForm({
      name: p.name,
      base_url: p.base_url ?? '',
      auth_type: p.auth_type,
      auth_secret: '',
      timeout_ms: p.timeout_ms != null ? String(p.timeout_ms) : '',
    });
    setTestResult({});
    setDialogOpen(true);
    requestAnimationFrame(() => formNameRef.current?.focus());
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setTestResult({});
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const isEdit = !!editing;
    try {
      const url = isEdit ? `/api/admin/lyrics-providers/${editing!.id}` : '/api/admin/lyrics-providers';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          base_url: form.base_url,
          auth_type: form.auth_type,
          ...(form.auth_secret ? { auth_secret: form.auth_secret } : {}),
          ...(form.timeout_ms ? { timeout_ms: Number(form.timeout_ms) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: 'err', text: t(`admin.lyricsProviderError${capCode(body.error)}`) });
        return;
      }
      setNotice({ kind: 'ok', text: t(isEdit ? 'admin.lyricsProviderSaved' : 'admin.lyricsProviderCreated') });
      closeDialog();
      await load(true);
    } catch {
      setNotice({ kind: 'err', text: t('admin.lyricsProviderSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (p: ProviderWire) => {
    const res = await fetch(`/api/admin/lyrics-providers/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    if (res.ok) await load(true);
  };

  const remove = async (p: ProviderWire) => {
    if (p.kind === 'builtin') return; // UI guard; the API rejects it anyway
    if (!window.confirm(t('admin.lyricsProviderDeleteConfirm', { name: p.name }))) return;
    const res = await fetch(`/api/admin/lyrics-providers/${p.id}`, { method: 'DELETE' });
    if (res.ok) await load(true);
  };

  const testConnection = async (p: ProviderWire) => {
    if (p.kind === 'builtin') return; // no manifest to fetch for builtin rows
    setTestingId(p.id);
    setTestResult((prev) => ({ ...prev, [p.id]: { ok: false } }));
    try {
      const res = await fetch(`/api/admin/lyrics-providers/${p.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: body.ok, code: body.code, latencyMs: body.latencyMs } }));
      await load(true);
    } finally {
      setTestingId(null);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    if (!data) return;
    const items = [...data.providers];
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setData({ ...data, providers: items });
    await fetch('/api/admin/lyrics-providers/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: items.map((p) => p.id) }),
    });
  };

  /**
   * Reorder by dropping the dragged row onto `targetIndex` (dnd-kit sortable).
   * Shared by drag-drop and the up/down arrow buttons.
   */
  const moveTo = async (fromId: string, targetIndex: number) => {
    if (!data) return;
    const fromIndex = data.providers.findIndex((p) => p.id === fromId);
    if (fromIndex < 0 || fromIndex === targetIndex) return;
    const items = [...data.providers];
    const [moved] = items.splice(fromIndex, 1);
    items.splice(targetIndex, 0, moved);
    setData({ ...data, providers: items });
    await fetch('/api/admin/lyrics-providers/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_ids: items.map((p) => p.id) }),
    });
  };

  // dnd-kit sensors: pointer for mouse/touch (8px activation so clicks on row
  // buttons never turn into drags), keyboard for accessible reordering.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (!data) return;
    const fromIndex = data.providers.findIndex((p) => p.id === active.id);
    const toIndex = data.providers.findIndex((p) => p.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    await moveTo(String(active.id), toIndex);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CircleAlert className="h-7 w-7 text-[var(--muted-foreground)] opacity-20" />
        <p className="text-sm text-[var(--muted-foreground)]">{t('admin.lyricsProviderLoadFailed')}</p>
        <button type="button" onClick={() => void load()} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--muted)]">
          {t('admin.retry')}
        </button>
      </div>
    );
  }

  const cardCls = 'rounded-lg border border-[var(--border)] bg-[var(--card)] p-5';

  return (
    <section className={cardCls}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-[var(--primary)]" />
        <h2 className="text-sm font-semibold">{t('admin.lyricsProvidersTitle')}</h2>
        <button
          type="button"
          onClick={openCreate}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('admin.lyricsProviderAdd')}
        </button>
      </div>

      {/* Deployment policy summary */}
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
          data.policy.allowHttp ? 'bg-[var(--warning)]/15 text-[var(--warning)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}>
          HTTP: {data.policy.allowHttp ? t('admin.lyricsProviderOn') : t('admin.lyricsProviderOff')}
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
          data.policy.allowPrivateNetwork ? 'bg-[var(--warning)]/15 text-[var(--warning)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'
        }`}>
          {t('admin.lyricsProviderPrivateNet')}: {data.policy.allowPrivateNetwork ? t('admin.lyricsProviderOn') : t('admin.lyricsProviderOff')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 font-medium text-[var(--muted-foreground)]">
          {t('admin.lyricsProviderTimeoutRange')}: {data.budgets.defaultTimeoutMs / 1000}s–{data.budgets.maxTimeoutMs / 1000}s
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 font-medium text-[var(--muted-foreground)]">
          {t('admin.lyricsProviderChainBudget')}: {data.budgets.chainTimeoutMs / 1000}s
        </span>
      </div>

      {data.providers.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">{t('admin.lyricsProviderEmpty')}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <SortableContext items={data.providers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {data.providers.map((p, index) => (
                <SortableProviderRow
                  key={p.id}
                  p={p}
                  testResult={testResult[p.id]}
                  dragging={activeDragId === p.id}
                  onMoveUp={() => void move(index, -1)}
                  onMoveDown={() => void move(index, 1)}
                  onToggle={() => void toggleEnabled(p)}
                  onTest={p.kind === 'http' ? () => void testConnection(p) : undefined}
                  testing={testingId === p.id}
                  onEdit={() => openEdit(p)}
                  onDelete={p.kind === 'http' ? () => void remove(p) : undefined}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay modifiers={[restrictToVerticalAxis]} dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeDragId ? (
              (() => {
                const p = data.providers.find((x) => x.id === activeDragId);
                if (!p) return null;
                return (
                  <div className="w-full rounded-md border border-[var(--primary)] bg-[var(--card)] px-3 py-2 shadow-lg">
                    <ProviderRowSummary p={p} />
                  </div>
                );
              })()
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {!data.secret_key_configured && (
        <p className="mt-3 flex items-center gap-1 text-[11px] text-[var(--warning)]">
          <CircleAlert className="h-3.5 w-3.5" /> {t('admin.lyricsProviderNoSecretKey')}
        </p>
      )}

      {dialogOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center overscroll-contain bg-black/45 p-4 backdrop-blur-sm"
          onMouseDown={closeDialog}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 id={dialogTitleId} className="text-sm font-semibold">
                  {editing ? t('admin.lyricsProviderEdit') : t('admin.lyricsProviderNew')}
                </h2>
                {editing?.insecure_transport && (
                  <p className="mt-0.5 text-[11px] text-[var(--warning)]">{t('admin.lyricsProviderHttpWarning')}</p>
                )}
              </div>
              <button ref={closeRef} type="button" onClick={closeDialog} className="ml-auto rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)]" aria-label={t('common.close')}>
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5">
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t('admin.lyricsProviderName')}</span>
                <input ref={formNameRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--primary)]" />
              </label>
              {editing?.kind === 'builtin' ? (
                <p className="rounded-md bg-[var(--muted)]/50 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                  {t('admin.lyricsProviderBuiltinHint')}
                </p>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">{t('admin.lyricsProviderBaseUrl')}</span>
                    <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                      placeholder="https://lyrics.example.com/providers/lrclib-proxy"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--primary)]" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium">{t('admin.lyricsProviderAuthType')}</span>
                    <select value={form.auth_type} onChange={(e) => setForm({ ...form, auth_type: e.target.value as 'none' | 'bearer' })}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--primary)]">
                      <option value="none">{t('admin.lyricsProviderAuthNone')}</option>
                      <option value="bearer">{t('admin.lyricsProviderAuthBearer')}</option>
                    </select>
                  </label>
                  {form.auth_type === 'bearer' && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium">{t('admin.lyricsProviderAuthSecret')}</span>
                      <input type="password" value={form.auth_secret} onChange={(e) => setForm({ ...form, auth_secret: e.target.value })}
                        placeholder={editing?.has_secret ? t('admin.lyricsProviderAuthSecretKeep') : ''}
                        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--primary)]" />
                      <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{t('admin.lyricsProviderAuthSecretHint')}</span>
                    </label>
                  )}
                </>
              )}
              {notice && (
                <p className={`flex items-center gap-1 text-xs ${notice.kind === 'ok' ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}`}>
                  {notice.kind === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  {notice.text}
                </p>
              )}
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
              <button type="button" onClick={closeDialog} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)]">
                {t('common.cancel')}
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || !form.name || !form.base_url}
                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('common.save')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

/** Capitalise a snake-case error code for the i18n key lookup. */
function capCode(code: string | undefined): string {
  if (!code) return '';
  return code.replace(/_/g, '').replace(/^\w/, (c) => c.toUpperCase());
}

interface SortableRowProps {
  p: ProviderWire;
  /** Latest on-demand test outcome for this row, when present. */
  testResult?: { ok: boolean; code?: string; latencyMs?: number };
  /** True while this row is the active drag source. */
  dragging: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
  onTest?: () => void;
  testing: boolean;
  onEdit: () => void;
  onDelete?: () => void;
}

/**
 * One sortable provider card (dnd-kit `useSortable`).
 *
 * While another row is dragged past this one, dnd-kit's transform transition
 * animates this card smoothly out of the way; the drag source itself renders
 * as a dimmed placeholder and the floating preview lives in `DragOverlay`.
 */
function SortableProviderRow({ p, testResult, dragging, onMoveUp, onMoveDown, onToggle, onTest, testing, onEdit, onDelete }: SortableRowProps) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id: p.id });

  return (
    <li
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
        <span className="ml-auto inline-flex items-center gap-1">
          <button type="button" onClick={onMoveUp} aria-label={t('admin.lyricsProviderMoveUp')}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onMoveDown} aria-label={t('admin.lyricsProviderMoveDown')}
            className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onToggle}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${p.enabled ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
            {p.enabled ? t('admin.lyricsProviderEnabled') : t('admin.lyricsProviderDisabled')}
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-[11px] text-[var(--muted-foreground)]">
        {p.kind === 'http' && <span className="truncate font-mono">{p.base_url}</span>}
        {p.kind === 'http' && <span>auth: {p.auth_type}</span>}
        {p.has_secret && <span className="font-mono">{p.secret_masked}</span>}
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
      <div className="flex items-center gap-2 pl-6">
        {onTest && (
          <button type="button" onClick={onTest} disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--muted)] disabled:opacity-50">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('admin.lyricsProviderTest')}
          </button>
        )}
        <button type="button" onClick={onEdit}
          className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--muted)]">
          {t('common.edit')}
        </button>
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

/** Compact name + kind summary used by both the sortable row and the overlay. */
function ProviderRowSummary({ p }: { p: ProviderWire }) {
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
function TestResultBadge({ result }: { result?: { ok: boolean; code?: string; latencyMs?: number } }) {
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
