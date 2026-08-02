'use client';

import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LinkIcon, Upload } from 'lucide-react';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import type { ReadingScheme } from '@/lib/types';
import { detectCantoneseLyrics } from '@/lib/lyrics-reading';
import { readSongPrefill } from '@/lib/song-prefill';

type LyricsMode = 'text' | 'lrc';

export default function NewSongPage() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prefill] = useState(() => readSongPrefill(searchParams));
  const [title, setTitle] = useState(prefill.title);
  const [artist, setArtist] = useState(prefill.artist);
  const [lyrics, setLyrics] = useState('');
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>('text');
  const [readingScheme, setReadingScheme] = useState<ReadingScheme>('ja-kana');
  const [readingSchemeConfirmed, setReadingSchemeConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkcoreUrl, setLinkcoreUrl] = useState('');
  const [importingLinkcore, setImportingLinkcore] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (text) setLyrics(text);
    };
    reader.readAsText(file);
    // reset so same file can be re-selected
    e.target.value = '';
  };

  const handleLinkcoreImport = async () => {
    if (!linkcoreUrl.trim()) {
      showToast('error', t('new.linkcoreUrlRequired'));
      return;
    }
    setImportingLinkcore(true);
    try {
      const response = await fetch('/api/lyrics/linkcore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkcoreUrl.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const key = typeof data.error === 'string' ? `new.${data.error}` : 'new.linkcoreImportFailed';
        showToast('error', t(key));
        return;
      }
      setLyrics(data.lyrics);
      setLyricsMode('text');
      showToast('success', t('new.linkcoreImported'));
    } catch {
      showToast('error', t('new.linkcoreImportFailed'));
    } finally {
      setImportingLinkcore(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', t('new.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = {
        title: title.trim(),
        artist: artist.trim(),
      };
      if (lyrics.trim()) {
        if (lyricsMode === 'lrc') {
          body.lyrics_synced = lyrics;
        } else {
          body.lyrics_raw = lyrics;
        }
      }
      if (readingSchemeConfirmed) body.reading_scheme = readingScheme;
      if (prefill.spotifyTrackId) body.spotify_track_id = prefill.spotifyTrackId;
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(t('new.saveFailed'));
      const song = await res.json();
      showToast('success', t('new.saved'));
      setTimeout(() => router.push(`/songs/${song.id}`), 800);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('new.error'));
    } finally {
      setSaving(false);
    }
  };

  const radioCls = (mode: LyricsMode) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
      lyricsMode === mode
        ? 'bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30'
        : 'bg-[var(--accent)] text-[var(--muted-foreground)] border border-transparent hover:text-[var(--foreground)]'
    }`;

  const cantoneseSuggestion = detectCantoneseLyrics(lyrics);

  return (
    <div className="fade-in max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('new.newBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('new.title')}</h1>

      <div className="space-y-5 sm:space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('new.songTitle')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('new.titlePlaceholder')}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('new.artist')}
          </label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('new.artistPlaceholder')}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">{t('new.readingScheme')}</label>
          <div className="flex flex-wrap gap-2">
            {(['ja-kana', 'yue-jyutping'] as const).map((scheme) => (
              <button
                key={scheme}
                type="button"
                onClick={() => {
                  setReadingScheme(scheme);
                  setReadingSchemeConfirmed(true);
                }}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  readingSchemeConfirmed && readingScheme === scheme
                    ? 'song-editor-choice--active'
                    : 'border-[var(--border)] bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t(scheme === 'ja-kana' ? 'new.readingJapanese' : 'new.readingCantonese')}
              </button>
            ))}
          </div>
          {!readingSchemeConfirmed && <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{t('new.readingAutoHint')}</p>}
          {!readingSchemeConfirmed && cantoneseSuggestion.confidence === 'high' && (
            <button
              type="button"
              onClick={() => {
                setReadingScheme('yue-jyutping');
                setReadingSchemeConfirmed(true);
              }}
              className="mt-2 text-left text-xs font-medium text-[var(--primary)] hover:underline"
            >
              {t('new.cantoneseDetected')}
            </button>
          )}
        </div>

        {/* Lyrics */}
        <div>
          {/* Mode selector + upload */}
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('new.lyrics')}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLyricsMode('text')}
                className={radioCls('text')}
              >
                {t('new.lyricsModePlain')}
              </button>
              <button
                type="button"
                onClick={() => setLyricsMode('lrc')}
                className={radioCls('lrc')}
              >
                {t('new.lyricsModeLrc')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.lrc,.text"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
                title={t('new.uploadFile')}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{t('new.uploadFile')}</span>
              </button>
            </div>
          </div>

          <div className="mb-3 rounded-md border border-[var(--border)] bg-[var(--accent)]/45 p-2.5 sm:p-3">
            <label htmlFor="linkcore-url" className="mb-2 block text-xs font-medium text-[var(--muted-foreground)]">
              {t('new.linkcoreImport')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <input
                  id="linkcore-url"
                  type="url"
                  value={linkcoreUrl}
                  onChange={(event) => setLinkcoreUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleLinkcoreImport();
                    }
                  }}
                  placeholder={t('new.linkcoreUrlPlaceholder')}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] py-2 pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--primary)]"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleLinkcoreImport()}
                disabled={importingLinkcore}
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]/50 hover:text-[var(--primary)] disabled:opacity-50"
              >
                {importingLinkcore ? t('new.linkcoreImporting') : t('new.linkcoreImportButton')}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('new.linkcoreHint')}</p>
          </div>

          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={readingSchemeConfirmed && readingScheme === 'yue-jyutping'
              ? t(lyricsMode === 'lrc' ? 'new.cantoneseLrcPlaceholder' : 'new.cantoneseLyricsPlaceholder')
              : t(lyricsMode === 'lrc' ? 'new.lrcPlaceholder' : 'new.lyricsPlaceholder')}
            rows={12}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-3 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50 resize-y leading-relaxed font-mono"
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {readingSchemeConfirmed && readingScheme === 'yue-jyutping'
              ? t('new.jyutpingHint')
              : t(lyricsMode === 'lrc' ? 'new.lyricsHint' : 'new.furiganaHint')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('new.converting') : t('new.saveAndView')}
          </button>
          <button
            onClick={() => router.push('/')}
            className="rounded-md px-5 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast type={toast.type} message={toast.msg} />}
    </div>
  );
}
