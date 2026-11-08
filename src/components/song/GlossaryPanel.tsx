'use client';

import { useState } from 'react';
import { BookMarked, Plus, RefreshCw, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import {
  GLOSSARY_MAX_ENTRIES,
  GLOSSARY_MAX_LENGTH,
  parseLyricsGlossary,
  type GlossaryEntry,
} from '@/lib/lyrics-glossary';

interface GlossaryPanelProps {
  songId: string;
  /** Raw `songs.lyrics_glossary` value (JSON text, 'null' marker, or NULL). */
  value: string | null | undefined;
  /** Owners/admins may edit; everyone else sees the same list read-only. */
  editable: boolean;
  /** Called with the term list after a successful save. */
  onSaved: (entries: GlossaryEntry[]) => void;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

/**
 * Terminology table for one song (issue #341).
 *
 * The table is not inert metadata: `{{glossary}}` is injected into the system
 * prompt of every later translation as a hard constraint ("use exactly these
 * translations"). It used to be invisible and uneditable, so one wrong
 * auto-extracted rendering poisoned every subsequent translation with no way
 * out. Here the user can see the live constraint, drop a bad entry and pin the
 * correct rendering for a term the model keeps getting wrong.
 *
 * Empty and failed-extraction are rendered differently on purpose: "no terms"
 * is a fact about the song, "extraction failed" means the last translation ran
 * WITHOUT any terminology constraint.
 */
export default function GlossaryPanel({ songId, value, editable, onSaved, onNotify }: GlossaryPanelProps) {
  const { t } = useI18n();
  const parsed = parseLyricsGlossary(value);
  const [draft, setDraft] = useState<{ original: string; translation: string }>({ original: '', translation: '' });
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [confirmReExtract, setConfirmReExtract] = useState(false);

  /**
   * Ask the server to re-run the extraction: the escape hatch for "the terms
   * the model produced are wrong". Auto-extracted entries are replaced, the
   * user's pinned terms are merged around them (the server owns that rule, see
   * `mergeGlossaryEntries`), so nothing the user typed is lost.
   */
  const reExtract = async () => {
    setConfirmReExtract(false);
    setExtracting(true);
    try {
      const res = await fetch(`/api/songs/${songId}/glossary`, { method: 'POST' });
      const data = await res.json().catch(() => null) as { glossary?: GlossaryEntry[]; failed?: boolean; error?: string } | null;
      if (!res.ok) {
        onNotify('error', t(data?.error === 'translation_not_configured' ? 'song.translationUnavailable' : 'song.glossaryExtractFailed'));
        return;
      }
      const entries = data?.glossary ?? [];
      onSaved(entries);
      onNotify(data?.failed ? 'error' : 'success', t(data?.failed ? 'song.glossaryExtractFailed' : 'song.glossaryExtracted'));
    } catch {
      onNotify('error', t('song.glossaryExtractFailed'));
    } finally {
      setExtracting(false);
    }
  };

  const save = async (entries: GlossaryEntry[]): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`/api/songs/${songId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics_glossary: entries }),
      });
      const data = await res.json().catch(() => null) as { error?: string; lyrics_glossary?: string | null } | null;
      if (!res.ok) {
        const key = data?.error === 'glossary_duplicate' ? 'song.glossaryDuplicate'
          : data?.error === 'glossary_too_long' ? 'song.glossaryTooMany'
            : data?.error === 'glossary_entry_too_long' ? 'song.glossaryEntryTooLong'
              : data?.error === 'glossary_entry_invalid' ? 'song.glossaryEntryInvalid'
                : 'song.glossarySaveFailed';
        onNotify('error', t(key));
        return false;
      }
      // The server decides which entries are pinned (`applyManualPins`), so the
      // refreshed column — not the submitted draft — is what gets displayed.
      onSaved(parseLyricsGlossary(data?.lyrics_glossary ?? JSON.stringify(entries)).entries);
      onNotify('success', t('song.glossarySaved'));
      return true;
    } catch {
      onNotify('error', t('song.glossarySaveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = (index: number) => {
    void save(parsed.entries.filter((_, i) => i !== index));
  };

  const addEntry = async () => {
    const original = draft.original.trim();
    const translation = draft.translation.trim();
    if (!original || !translation) {
      onNotify('error', t('song.glossaryEntryInvalid'));
      return;
    }
    if (await save([...parsed.entries, { original, translation }])) {
      setDraft({ original: '', translation: '' });
    }
  };

  const status = parsed.state === 'failed'
    ? t('song.glossaryFailed')
    : parsed.state === 'damaged'
      ? t('song.glossaryDamaged')
      : parsed.state === 'absent'
        ? t('song.glossaryNotExtracted')
        : parsed.entries.length === 0
          ? t('song.glossaryEmpty')
          : t('song.glossaryCount', { count: String(parsed.entries.length) });

  const canAdd = editable && parsed.entries.length < GLOSSARY_MAX_ENTRIES;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]/50 p-4 sm:p-5">
      <div className="mb-1.5 flex items-center gap-2">
        <BookMarked className="h-4 w-4 text-[var(--muted-foreground)]" />
        <h2 className="text-sm font-semibold tracking-tight">{t('song.glossaryTitle')}</h2>
        {editable && (
          <button
            type="button"
            onClick={() => {
              // Re-extraction spends an AI call and replaces the auto half of
              // the table, so confirm before running it (a dialog, not
              // window.confirm — see issue #305). Pinned terms survive either
              // way, and an empty table has nothing to replace.
              if (parsed.entries.some((entry) => entry.manual !== true)) setConfirmReExtract(true);
              else void reExtract();
            }}
            disabled={extracting || saving}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${extracting ? 'animate-spin' : ''}`} />
            {extracting ? t('song.glossaryExtracting') : t('song.glossaryReExtract')}
          </button>
        )}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('song.glossaryHint')}</p>

      <p className={`mb-2 text-[11px] ${parsed.state === 'failed' || parsed.state === 'damaged' ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)]'}`}>
        {status}
      </p>
      {parsed.entries.some((entry) => entry.manual) && (
        <p className="mb-2 text-[11px] text-[var(--muted-foreground)]/80">{t('song.glossaryManualHint')}</p>
      )}

      {parsed.entries.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1.5">
          {parsed.entries.map((entry, index) => (
            <li
              key={`${entry.original}-${index}`}
              className="flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 break-words">
                <span className="text-[var(--foreground)]">{entry.original}</span>
                <span className="mx-1.5 text-[var(--muted-foreground)]/60">→</span>
                <span className="text-[var(--muted-foreground)]">{entry.translation}</span>
                {entry.manual && (
                  <span className="ml-1.5 rounded bg-[var(--primary)]/10 px-1 py-0.5 text-[10px] text-[var(--primary)]">
                    {t('song.glossaryManualTag')}
                  </span>
                )}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  disabled={saving}
                  aria-label={t('song.glossaryRemove')}
                  title={t('song.glossaryRemove')}
                  className="shrink-0 rounded p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--destructive)] disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <input
            type="text"
            value={draft.original}
            onChange={(event) => setDraft((prev) => ({ ...prev, original: event.target.value }))}
            placeholder={t('song.glossaryOriginalPlaceholder')}
            maxLength={GLOSSARY_MAX_LENGTH}
            disabled={!canAdd || saving}
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--primary)] disabled:opacity-50"
          />
          <input
            type="text"
            value={draft.translation}
            onChange={(event) => setDraft((prev) => ({ ...prev, translation: event.target.value }))}
            placeholder={t('song.glossaryTranslationPlaceholder')}
            maxLength={GLOSSARY_MAX_LENGTH}
            disabled={!canAdd || saving}
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--primary)] disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void addEntry()}
            disabled={!canAdd || saving}
            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/50 hover:text-[var(--primary)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {saving ? t('song.glossarySaving') : t('song.glossaryAdd')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmReExtract}
        title={t('song.glossaryReExtract')}
        body={t('song.glossaryReExtractConfirm')}
        confirmLabel={t('song.glossaryReExtract')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void reExtract()}
        onCancel={() => setConfirmReExtract(false)}
      />
    </div>
  );
}
