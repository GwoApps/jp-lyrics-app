'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCenter, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  CheckCircle2, CircleAlert, Loader2, Plus, Plug, X,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { ApiError } from '@/client/api/request';
import {
  createLyricsProvider,
  deleteLyricsProvider,
  listLyricsProviders,
  reorderLyricsProviders,
  testLyricsProvider,
  updateLyricsProvider,
} from '@/client/api/admin/lyrics-providers';
import BuiltinSourceConfigFields from './BuiltinSourceConfigFields';
import SortableProviderRow, { ProviderRowSummary } from './LyricsProviderRow';
import { EMPTY_PROVIDER_FORM, type ListResponse, type ProviderTestResult, type ProviderWire } from './lyrics-provider-types';

/** Capitalise a snake-case error code for the i18n key lookup. */
function capCode(code: string | undefined): string {
  if (!code) return '';
  return code.replace(/_/g, '').replace(/^\w/, (character) => character.toUpperCase());
}

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
  const [form, setForm] = useState(EMPTY_PROVIDER_FORM);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, ProviderTestResult>>({});
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
      setData(await listLyricsProviders());
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
    setForm(EMPTY_PROVIDER_FORM);
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
      source_config: { ...(p.source_config ?? {}) },
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
      const input = {
        name: form.name,
        // HTTP-only fields: skip for builtin providers (the API rejects them
        // with `builtin_readonly_field`).
        ...(editing?.kind !== 'builtin'
          ? {
              base_url: form.base_url,
              auth_type: form.auth_type,
              ...(form.auth_secret ? { auth_secret: form.auth_secret } : {}),
            }
          : {}),
        // Always send timeout_ms: empty string clears the stored override (null),
        // a number sets a new value.
        timeout_ms: form.timeout_ms === '' ? null : Number(form.timeout_ms),
        ...(editing?.kind === 'builtin'
          ? { source_config: form.source_config }
          : {}),
      };
      if (editing) await updateLyricsProvider(editing.id, input);
      else await createLyricsProvider(input);
      setNotice({ kind: 'ok', text: t(isEdit ? 'admin.lyricsProviderSaved' : 'admin.lyricsProviderCreated') });
      closeDialog();
      await load(true);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      setNotice({
        kind: 'err',
        text: code
          ? t(`admin.lyricsProviderError${capCode(code)}`)
          : t('admin.lyricsProviderSaveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (p: ProviderWire) => {
    try {
      await updateLyricsProvider(p.id, { enabled: !p.enabled });
      await load(true);
    } catch { /* keep the current row state when the request fails */ }
  };

  const remove = async (p: ProviderWire) => {
    if (p.kind === 'builtin') return; // UI guard; the API rejects it anyway
    if (!window.confirm(t('admin.lyricsProviderDeleteConfirm', { name: p.name }))) return;
    try {
      await deleteLyricsProvider(p.id);
      await load(true);
    } catch { /* keep the current row when deletion fails */ }
  };

  const testConnection = async (p: ProviderWire) => {
    if (p.kind === 'builtin') return; // no manifest to fetch for builtin rows
    setTestingId(p.id);
    setTestResult((prev) => ({ ...prev, [p.id]: { ok: false } }));
    try {
      const result = await testLyricsProvider(p.id);
      setTestResult((prev) => ({ ...prev, [p.id]: result }));
      await load(true);
    } catch (error) {
      setTestResult((prev) => ({
        ...prev,
        [p.id]: { ok: false, code: error instanceof ApiError ? error.code : undefined },
      }));
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
    try {
      await reorderLyricsProviders(items.map((p) => p.id));
    } catch {
      await load(true);
    }
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
    try {
      await reorderLyricsProviders(items.map((p) => p.id));
    } catch {
      await load(true);
    }
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
                  sourceSchema={data.source_schemas[p.id.replace(/^builtin[:-]/, '')]}
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
                <>
                  <p className="rounded-md bg-[var(--muted)]/50 px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
                    {t('admin.lyricsProviderBuiltinHint')}
                  </p>
                  <BuiltinSourceConfigFields
                    provider={editing}
                    form={form}
                    setForm={setForm}
                    schemas={data?.source_schemas}
                  />
                </>
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
              <label className="block">
                <span className="mb-1 block text-xs font-medium">{t('admin.lyricsProviderTimeout')}</span>
                <input value={form.timeout_ms} onChange={(e) => setForm({ ...form, timeout_ms: e.target.value })}
                  placeholder={String(data?.budgets.defaultTimeoutMs ?? 20000)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--primary)]" />
                <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">
                  {t('admin.lyricsProviderTimeoutHint', {
                    min: '5',
                    max: String((data?.budgets?.maxTimeoutMs ?? 60000) / 1000),
                  })}
                </span>
              </label>
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
              <button type="button" onClick={() => void save()} disabled={saving || !form.name || (editing?.kind !== 'builtin' && !form.base_url)}
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
