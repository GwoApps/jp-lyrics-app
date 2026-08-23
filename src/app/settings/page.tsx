'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogIn, Save, Check } from 'lucide-react';
import { useI18n, LOCALE_META, type Locale } from '@/lib/i18n';
import { useAuthSession } from '@/lib/auth-session';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { normalizeTheme, normalizeReadingMode, normalizeBoolean, normalizeFontSize, normalizeLocale } from '@/lib/settings-utils';
import {
  isSyncEnabled,
  syncSettingsToLocalStorage,
  setSyncEnabled,
  SYNCABLE_KEYS,
  type SettingsPayload,
} from '@/lib/sync-settings';
import { useTheme } from '@/lib/theme';

type ToastState = { type: 'success' | 'error'; msg: string } | null;

interface SettingsMap {
  theme?: string;
  locale?: string;
  font_size?: string;
  reading_mode?: string;
  romanize_furigana?: string;
  show_translation?: string;
  follow_playing?: string;
  translation_target_lang?: string;
  sync_settings?: string;
}

/** Common target-language presets, aligned with the admin config combobox. */
const TARGET_LANG_PRESETS = [
  { value: 'zh-CN', label: '简体中文 (zh-CN)' },
  { value: 'zh-TW', label: '繁體中文（中國臺灣）(zh-TW)' },
  { value: 'zh-HK', label: '繁體中文（中國香港）(zh-HK)' },
  { value: 'en-US', label: 'English (en-US)' },
] as const;

const inputClass = 'w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--primary)]';

/** One labelled setting row: a label/hint on the left, the control on the right. */
function Row({ label, hint, control }: { label: string; hint?: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { t, setLocale } = useI18n();
  const { setTheme } = useTheme();
  const { session } = useAuthSession();
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [dirty, setDirty] = useState(false);
  const [syncEnabled, setSyncEnabledState] = useState<boolean>(() => isSyncEnabled());

  // Unified unsaved-changes guard covering in-app <Link> clicks (top navigation),
  // browser back/forward, `router.push` and tab close/refresh, matching the
  // translation and timeline editors. The dialog is rendered at the bottom.
  const { dialog: unsavedDialog, guard: guardNavigate } = useUnsavedChangesGuard({
    confirmHref: '/',
    dirty,
  });

  const user = session?.user ?? null;

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Load server-persisted settings once authenticated. When cross-device sync
  // is turned off, skip the fetch entirely so a local-only user is never
  // overwritten by stale server values from another device.
  useEffect(() => {
    if (!user) return;
    if (!syncEnabled) {
      // Preserve whatever is already in localStorage as the current truth and
      // seed the form from it so the page reflects the local-only preferences.
      setSettings({
        theme: localStorage.getItem('jplrc-theme') ?? undefined,
        locale: localStorage.getItem('jplrc-locale') ?? undefined,
        font_size: localStorage.getItem('jplrc-font-size') ?? undefined,
        reading_mode: localStorage.getItem('jplrc-reading-mode') ?? undefined,
        romanize_furigana: localStorage.getItem('jplrc-romanize-furigana') ?? undefined,
        show_translation: localStorage.getItem('jplrc-show-translation') ?? undefined,
        follow_playing: localStorage.getItem('jplrc-follow-playing') ?? undefined,
        sync_settings: 'false',
      });
      setLoading(false);
      return;
    }
    fetch('/api/me/settings', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('load_failed');
        return r.json();
      })
      .then((data) => {
        const server = data.settings ?? {};
        setSettings(server);
        // Fast-path: sync server settings into localStorage so first-screen
        // behaviour matches the persisted values on the next load.
        syncSettingsToLocalStorage(server);
      })
      .catch(() => {
        // Falls back to existing localStorage behaviour on transient failure.
      })
      .finally(() => setLoading(false));
  }, [user, syncEnabled]);

  const setField = useCallback((key: keyof SettingsMap, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  // Live-apply immediate preferences (theme / locale) so the page reacts instantly.
  const applyLive = useCallback((key: keyof SettingsMap, value: string) => {
    if (key === 'theme') {
      setTheme(normalizeTheme(value));
    } else if (key === 'locale') {
      const l = normalizeLocale(value) as Locale;
      setLocale(l);
    }
  }, [setTheme, setLocale]);

  const handleFieldChange = useCallback((key: keyof SettingsMap, value: string) => {
    setField(key, value);
    applyLive(key, value);
  }, [setField, applyLive]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // The sync switch always rides along so it survives a device change. When
      // sync is off, only the switch itself is sent; everything else stays local.
      const syncOn = settings.sync_settings === 'true';
      const payload: SettingsPayload = { sync_settings: String(syncOn) };
      if (syncOn) {
        for (const key of SYNCABLE_KEYS) {
          const value = settings[key as keyof SettingsMap];
          if (value !== undefined) payload[key] = value;
        }
      }
      const res = await fetch('/api/me/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showToast('error', t('settings.saveFailed'));
        return;
      }
      const data = await res.json();
      // Mirror the chosen value into localStorage regardless of server state,
      // so the switch and preferences take effect even on a transient failure.
      setSyncEnabledState(syncOn);
      setSyncEnabled(syncOn);
      syncSettingsToLocalStorage(syncOn ? payload : { ...payload, ...settings });
      // When sync is on, the server's persisted map is the source of truth for
      // the form. When off, keep the local values the user just chose.
      if (syncOn) {
        setSettings(data.settings ?? {});
      } else {
        setSettings((prev) => ({ ...prev, sync_settings: 'false' }));
      }
      setDirty(false);
      showToast('success', t('settings.saved'));
    } catch {
      showToast('error', t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToggle = (value: boolean) => {
    setSettings((prev) => ({ ...prev, sync_settings: String(value) }));
    setDirty(true);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <LogIn className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
        <h1 className="text-lg font-semibold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-2 max-w-xs text-sm text-[var(--muted-foreground)]">{t('settings.loginRequired')}</p>
        <button
          onClick={() => guardNavigate('/')}
          className="mt-5 rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          {t('settings.backToHome')}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />
        <div className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />
        <div className="h-16 rounded-lg bg-[var(--muted)] animate-pulse" />
      </div>
    );
  }

  const theme = normalizeTheme(settings.theme);
  const locale = normalizeLocale(settings.locale);
  const readingMode = normalizeReadingMode(settings.reading_mode);
  const romanizeFurigana = normalizeBoolean(settings.romanize_furigana);
  const showTranslation = normalizeBoolean(settings.show_translation);
  const followPlaying = normalizeBoolean(settings.follow_playing);
  const fontSize = normalizeFontSize(settings.font_size);
  const targetLang = settings.translation_target_lang ?? '';
  const syncOn = normalizeBoolean(settings.sync_settings);

  const renderToggle = (key: keyof SettingsMap, checked: boolean, onChange: (v: boolean) => void) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="fade-in mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('settings.title')}</h1>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('settings.subtitle')}</p>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{t('settings.save')}</span>
        </button>
      </div>

      {/* 同步与账户 */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.sectionSync')}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row
            label={t('settings.syncSettings')}
            hint={syncOn ? t('settings.syncSettingsOn') : t('settings.syncSettingsOff')}
            control={renderToggle('sync_settings', syncOn, handleSyncToggle)}
          />
        </div>
      </section>

      {/* 外观 */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.sectionAppearance')}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row
            label={t('settings.theme')}
            hint={theme === 'dark' ? t('settings.themeDark') : t('settings.themeLight')}
            control={
              <select
                value={theme}
                onChange={(e) => handleFieldChange('theme', e.target.value)}
                className={inputClass}
                aria-label={t('settings.theme')}
              >
                <option value="dark">{t('settings.themeDark')}</option>
                <option value="light">{t('settings.themeLight')}</option>
              </select>
            }
          />
          <Row
            label={t('settings.locale')}
            hint={t('settings.localeHint')}
            control={
              <select
                value={locale}
                onChange={(e) => handleFieldChange('locale', e.target.value)}
                className={inputClass}
                aria-label={t('settings.locale')}
              >
                {(Object.keys(LOCALE_META) as Locale[]).map((l) => (
                  <option key={l} value={l}>{LOCALE_META[l].label}</option>
                ))}
              </select>
            }
          />
        </div>
      </section>

      {/* 歌词阅读 */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.sectionLyrics')}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row
            label={t('settings.fontSize')}
            hint={t('settings.fontSizeHint', { size: String(fontSize) })}
            control={
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted-foreground)]">14</span>
                <input
                  type="range"
                  min={14}
                  max={32}
                  value={fontSize}
                  onChange={(e) => { setField('font_size', e.target.value); }}
                  className="w-28 accent-[var(--primary)]"
                  aria-label={t('settings.fontSize')}
                />
                <span className="text-xs text-[var(--muted-foreground)]">32</span>
              </div>
            }
          />
          <Row
            label={t('settings.readingMode')}
            hint={t('settings.readingModeHint')}
            control={
              <select
                value={readingMode}
                onChange={(e) => handleFieldChange('reading_mode', e.target.value)}
                className={inputClass}
                aria-label={t('settings.readingMode')}
              >
                <option value="furigana">{t('settings.readingModeFurigana')}</option>
                <option value="original">{t('settings.readingModeOriginal')}</option>
              </select>
            }
          />
          <Row
            label={t('settings.romanizeFurigana')}
            hint={t('settings.romanizeFuriganaHint')}
            control={renderToggle('romanize_furigana', romanizeFurigana, (v) => handleFieldChange('romanize_furigana', String(v)))}
          />
          <Row
            label={t('settings.showTranslation')}
            hint={t('settings.showTranslationHint')}
            control={renderToggle('show_translation', showTranslation, (v) => handleFieldChange('show_translation', String(v)))}
          />
        </div>
      </section>

      {/* 播放 */}
      <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.sectionPlayback')}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row
            label={t('settings.followPlaying')}
            hint={t('settings.followPlayingHint')}
            control={renderToggle('follow_playing', followPlaying, (v) => handleFieldChange('follow_playing', String(v)))}
          />
        </div>
      </section>

      {/* 翻译 */}
      <section className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="mb-2 text-sm font-semibold">{t('settings.sectionTranslation')}</h2>
        <div className="divide-y divide-[var(--border)]">
          <Row
            label={t('settings.translationTargetLang')}
            hint={t('settings.translationTargetLangHint')}
            control={
              <select
                value={targetLang}
                onChange={(e) => handleFieldChange('translation_target_lang', e.target.value)}
                className={inputClass}
                aria-label={t('settings.translationTargetLang')}
              >
                <option value="">{t('settings.translationTargetLangDefault')}</option>
                {TARGET_LANG_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            }
          />
        </div>
      </section>

      {dirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 shadow-lg flex items-center gap-3">
          <span className="text-xs text-[var(--muted-foreground)]">{t('settings.unsaved')}</span>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t('settings.save')}
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2.5 shadow-lg text-xs">
          <span className={toast.type === 'success' ? 'text-[var(--success)]' : 'text-[var(--destructive)]'}>{toast.msg}</span>
        </div>
      )}

      {unsavedDialog}
    </div>
  );
}
