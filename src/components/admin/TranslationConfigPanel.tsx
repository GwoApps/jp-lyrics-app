/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, Plug, PlugZap, RotateCcw, Trash2, Save, CheckCircle2, XCircle } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

interface StoredConfig {
  provider?: string;
  base_url?: string;
  model?: string;
  target_lang?: string;
  system_prompt?: string | null;
  has_api_key?: boolean;
  api_key_masked?: string | null;
}

/** Form state: includes the api_key input (never prefilled, never echoed by the API). */
interface FormConfig extends StoredConfig {
  api_key: string;
}

interface ConfigResponse {
  stored: StoredConfig | null;
  effective: StoredConfig | null;
  source: 'db' | 'env' | 'none';
  default_system_prompt?: string;
}

interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

const EMPTY_FORM: FormConfig = { provider: '', base_url: '', api_key: '', model: '', target_lang: '', system_prompt: null };

/** Common target-language presets offered in the combobox; admins may still type a custom code. */
const TARGET_LANG_PRESETS = [
  { value: 'zh-CN', label: '简体中文 (zh-CN)' },
  { value: 'zh-TW', label: '繁体中文（中国台湾）(zh-TW)' },
  { value: 'zh-HK', label: '繁体中文（中国香港）(zh-HK)' },
  { value: 'en-US', label: 'English (en-US)' },
] as const;

/** Sentinel option value for the "custom target language" branch of the select. */
const CUSTOM_LANG_OPTION = '__custom__';

export default function TranslationConfigPanel() {
  const { t } = useI18n();
  const [form, setForm] = useState<FormConfig>(EMPTY_FORM);
  const [effective, setEffective] = useState<StoredConfig | null>(null);
  const [source, setSource] = useState<'db' | 'env' | 'none'>('none');
  const [defaultPrompt, setDefaultPrompt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [customLangSelected, setCustomLangSelected] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const applyResponse = useCallback((data: ConfigResponse) => {
    setEffective(data.effective);
    setSource(data.source);
    if (data.default_system_prompt !== undefined) setDefaultPrompt(data.default_system_prompt);
    // Never prefill the api_key field — the API does not return it; a blank
    // key keeps the current stored/env key (PUT only updates it when non-blank).
    setForm({
      provider: data.stored?.provider ?? '',
      base_url: data.stored?.base_url ?? '',
      api_key: '',
      model: data.stored?.model ?? '',
      target_lang: data.stored?.target_lang ?? '',
      system_prompt: data.stored?.system_prompt ?? null,
    });
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/translation-config');
      if (!res.ok) throw new Error();
      applyResponse(await res.json());
    } catch {
      showToast('error', t('admin.translationLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applyResponse, showToast, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Omit a blank api_key so the stored key is preserved (API never echoes it back).
      const payload: Record<string, string> = {
        provider: form.provider ?? '',
        base_url: form.base_url ?? '',
        api_key: form.api_key,
        model: form.model ?? '',
        target_lang: form.target_lang ?? '',
      };
      if (!payload.api_key?.trim()) delete payload.api_key;
      // A prompt identical to the built-in default is stored as empty so the
      // DB stays clean and future default improvements apply automatically.
      const prompt = form.system_prompt?.trim() ?? '';
      payload.system_prompt = prompt === defaultPrompt.trim() ? '' : prompt;
      const res = await fetch('/api/admin/translation-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error === 'invalid_provider' ? t('admin.translationInvalidProvider') : t('admin.translationSaveFailed'));
      }
      applyResponse(await res.json());
      showToast('success', t('admin.translationSaved'));
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : t('admin.translationSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, defaultPrompt, applyResponse, showToast, t]);

  const handleClear = useCallback(async () => {
    setShowClearConfirm(false);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/translation-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      applyResponse(await res.json());
      setTestResult(null);
      showToast('success', t('admin.translationCleared'));
    } catch {
      showToast('error', t('admin.translationSaveFailed'));
    } finally {
      setSaving(false);
    }
  }, [applyResponse, showToast, t]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/translation-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as TestResult;
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, latencyMs: 0, message: t('admin.translationTestFail') });
    } finally {
      setTesting(false);
    }
  }, [form, t]);

  const setField = <K extends keyof FormConfig>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const sourceLabel = source === 'db' ? t('admin.translationSourceDb')
    : source === 'env' ? t('admin.translationSourceEnv')
    : t('admin.translationSourceNone');

  const effectiveIsWorkersAi = effective?.provider === 'workers-ai';
  const providerLabel = effectiveIsWorkersAi
    ? t('admin.translationProviderWorkersAi')
    : effective?.provider === 'openai'
      ? t('admin.translationProviderOpenAi')
      : effective?.provider === 'anthropic'
        ? 'Anthropic'
        : effective?.provider || '—';

  const inputClass = 'w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)]';

  // Target language is a combobox: pick a common preset or select "Custom…" to type a free code.
  const selectedTargetLangPreset = TARGET_LANG_PRESETS.find((p) => p.value === (form.target_lang ?? ''));
  const hasCustomTargetLang = !selectedTargetLangPreset && (form.target_lang ?? '') !== '';
  const targetLangSelectValue = selectedTargetLangPreset
    ? selectedTargetLangPreset.value
    : (customLangSelected || hasCustomTargetLang ? CUSTOM_LANG_OPTION : '');

  return (
    <div className="space-y-6">
      {/* Effective config summary */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{t('admin.translationEffective')}</h2>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            source === 'db' ? 'bg-[var(--primary)]/10 text-[var(--primary)]'
            : source === 'env' ? 'bg-[var(--warning)]/10 text-[var(--warning)]'
            : 'bg-[var(--muted-foreground)]/10 text-[var(--muted-foreground)]'
          }`}>
            <Plug className="h-3 w-3" />
            {sourceLabel}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : effective ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationProvider')}</dt>
              <dd className="font-mono text-xs">{providerLabel}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationModel')}</dt>
              <dd className="font-mono text-xs">{effective.model || '—'}</dd>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <dt className="w-28 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationBaseUrl')}</dt>
              <dd className="truncate font-mono text-xs">
                {effectiveIsWorkersAi ? t('admin.translationWorkersAiBinding') : (effective.base_url || '—')}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationApiKey')}</dt>
              <dd className="font-mono text-xs">
                {effectiveIsWorkersAi
                  ? t('admin.translationWorkersAiNoKey')
                  : (effective.has_api_key ? effective.api_key_masked : '—')}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-xs text-[var(--muted-foreground)]">{t('admin.translationTargetLang')}</dt>
              <dd className="font-mono text-xs">{effective.target_lang || '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t('admin.translationSourceNone')}</p>
        )}
      </div>

      {/* Config form */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-1 text-sm font-semibold">{t('admin.translationManualConfig')}</h2>
        <p className="mb-4 text-xs text-[var(--muted-foreground)]">{t('admin.translationEnvFallback')}</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{t('admin.translationProvider')}</span>
            <select
              value={form.provider ?? ''}
              onChange={(e) => setField('provider', e.target.value)}
              className={inputClass}
            >
              <option value="">{t('admin.translationProviderDefault')}</option>
              <option value="openai">{t('admin.translationProviderOpenAi')}</option>
              <option value="anthropic">Anthropic</option>
              <option value="workers-ai">{t('admin.translationProviderWorkersAi')}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{t('admin.translationModel')}</span>
            <input
              value={form.model ?? ''}
              onChange={(e) => setField('model', e.target.value)}
              placeholder={effective?.model ?? '@cf/google/gemini-3.6-flash'}
              className={inputClass}
            />
          </label>
          {/* Target language is a common field — always visible regardless of provider, so
              Workers AI admins keep full control over the translation output language. */}
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{t('admin.translationTargetLang')}</span>
            <select
              value={targetLangSelectValue}
              onChange={(e) => {
                if (e.target.value === CUSTOM_LANG_OPTION) {
                  // Keep the current value and hand control to the custom input below.
                  setCustomLangSelected(true);
                  setTestResult(null);
                } else {
                  setCustomLangSelected(false);
                  setField('target_lang', e.target.value);
                }
              }}
              className={inputClass}
            >
              <option value="">{t('admin.translationTargetLangDefault')}</option>
              {TARGET_LANG_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
              <option value={CUSTOM_LANG_OPTION}>{t('admin.translationTargetLangCustom')}</option>
            </select>
            {targetLangSelectValue === CUSTOM_LANG_OPTION && (
              <input
                value={form.target_lang ?? ''}
                onChange={(e) => setField('target_lang', e.target.value)}
                placeholder={effective?.target_lang ?? 'ja'}
                className={`${inputClass} mt-1.5`}
              />
            )}
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]/70">{t('admin.translationTargetLangHint')}</span>
          </label>
          {form.provider === 'workers-ai' ? (
            <p className="flex items-center gap-2 self-end rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-xs text-[var(--muted-foreground)] sm:col-span-2">
              <PlugZap className="h-3.5 w-3.5 shrink-0" />
              {t('admin.translationWorkersAiBinding')}
            </p>
          ) : (
          <>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{t('admin.translationBaseUrl')}</span>
            <input
              value={form.base_url ?? ''}
              onChange={(e) => setField('base_url', e.target.value)}
              placeholder={effective?.base_url ?? 'https://api.deepseek.com/v1'}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--muted-foreground)]">{t('admin.translationApiKey')}</span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={form.api_key ?? ''}
                onChange={(e) => setField('api_key', e.target.value)}
                placeholder={effective?.has_api_key ? (effective.api_key_masked ?? '') : t('admin.translationApiKeyPlaceholder')}
                autoComplete="off"
                className={`${inputClass} pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label={showKey ? 'hide' : 'show'}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]/70">{t('admin.translationApiKeyHint')}</span>
          </label>
          </>
          )}
        </div>

        {/* System prompt override — defaults fill the textarea; reset re-fills it. */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="text-xs text-[var(--muted-foreground)]">{t('admin.translationSystemPrompt')}</label>
            <button
              type="button"
              onClick={() => {
                setForm((prev) => ({ ...prev, system_prompt: defaultPrompt }));
                setTestResult(null);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--accent)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              <RotateCcw className="h-3 w-3" />
              {t('admin.translationSystemPromptReset')}
            </button>
          </div>
          <textarea
            value={form.system_prompt ?? defaultPrompt}
            onChange={(e) => setField('system_prompt', e.target.value)}
            rows={14}
            spellCheck={false}
            className={`${inputClass} w-full resize-y font-mono text-xs leading-relaxed`}
          />
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]/70">{t('admin.translationSystemPromptHint')}</p>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
            testResult.ok
              ? 'border-[var(--success)]/30 bg-[var(--success)]/5 text-[var(--success)]'
              : 'border-red-500/30 bg-red-500/5 text-red-400'
          }`}>
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0">
              <p className="font-medium">
                {testResult.ok ? t('admin.translationTestOk') : t('admin.translationTestFail')}
                <span className="ml-2 font-normal opacity-70">{testResult.latencyMs > 0 ? `${testResult.latencyMs}ms` : ''}</span>
              </p>
              {testResult.message && (
                <p className="mt-0.5 break-words font-mono text-xs opacity-80">{testResult.message}</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--accent)] px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            {testing ? t('admin.translationTesting') : t('admin.translationTest')}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={saving || source === 'none'}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('admin.translationClear')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="song-editor-primary-button inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t('admin.translationSave')}
            </button>
          </div>
        </div>
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          open
          title={t('admin.translationClear')}
          body={t('admin.translationClearConfirm')}
          confirmLabel={t('admin.translationClear')}
          variant="danger"
          onConfirm={() => { void handleClear(); }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.msg} />}
    </div>
  );
}
