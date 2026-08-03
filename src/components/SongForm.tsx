'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageOff, ImagePlus, LinkIcon, Music, Upload } from 'lucide-react';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import type { ReadingScheme } from '@/lib/types';
import { detectCantoneseLyrics } from '@/lib/lyrics-reading';

export type LyricsMode = 'text' | 'lrc';

/**
 * Shared create/edit song form. The two pages are thin shells around this
 * component; `ns` selects the i18n namespace ('new' | 'edit') and `mode`
 * drives the semantic differences:
 *
 *  - create: no initial data (unless prefilled), lyrics/reading-scheme are
 *    always submitted, reading scheme shows an auto-detect hint until
 *    manually confirmed, Linkcore URL import is available, cantonese
 *    placeholders are offered, and saving POSTs a new song.
 *  - edit: initial data comes from the loaded song, only changed fields are
 *    submitted, custom cover management is available, and saving PUTs the
 *    updated song.
 */
interface SongFormProps {
  ns: 'new' | 'edit';
  mode: 'create' | 'edit';
  initialTitle: string;
  initialArtist: string;
  initialLyrics?: string;
  initialLyricsMode?: LyricsMode;
  initialReadingScheme?: ReadingScheme;
  /** create: whether the user has manually confirmed a scheme (auto-detect hint until then). */
  initialReadingSchemeConfirmed?: boolean;
  initialCoverUrl?: string | null;
  canManageCover?: boolean;
  /** Edit mode only: song id for the cover upload/remove endpoints. */
  songId?: string;
  showLinkcore?: boolean;
  showCantonesePlaceholders?: boolean;
  spotifyTrackId?: string | null;
  /** Saves via the page's endpoint (POST for create, PUT for edit); resolves to the new song id. */
  onSave: (body: Record<string, string | boolean>) => Promise<{ id: string }>;
  cancelHref: string;
  saveLabel?: string;
}

export default function SongForm({
  ns,
  mode,
  initialTitle,
  initialArtist,
  initialLyrics = '',
  initialLyricsMode = 'text',
  initialReadingScheme = 'ja-kana',
  initialReadingSchemeConfirmed = mode === 'edit',
  initialCoverUrl = null,
  canManageCover = false,
  songId,
  showLinkcore = false,
  showCantonesePlaceholders = false,
  spotifyTrackId = null,
  onSave,
  cancelHref,
  saveLabel,
}: SongFormProps) {
  const { t } = useI18n();
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState(initialArtist);
  const [lyrics, setLyrics] = useState(initialLyrics);
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>(initialLyricsMode);
  const [readingScheme, setReadingScheme] = useState<ReadingScheme>(initialReadingScheme);
  const [readingSchemeConfirmed, setReadingSchemeConfirmed] = useState(initialReadingSchemeConfirmed);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Edit-mode change tracking (create mode always submits these fields).
  const [lyricsChanged, setLyricsChanged] = useState(false);
  const [readingSchemeChanged, setReadingSchemeChanged] = useState(false);

  // Linkcore import (create mode only).
  const [linkcoreUrl, setLinkcoreUrl] = useState('');
  const [importingLinkcore, setImportingLinkcore] = useState(false);

  // Custom cover management (edit mode only).
  const [coverUrl, setCoverUrl] = useState<string | null>(initialCoverUrl);
  const [coverUploading, setCoverUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLyricsChange = (value: string) => {
    setLyrics(value);
    if (mode === 'edit') setLyricsChanged(true);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = loadEvent.target?.result;
      if (typeof text === 'string') handleLyricsChange(text);
    };
    reader.readAsText(file);
    // Allow selecting the same file again.
    event.target.value = '';
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
      handleLyricsChange(data.lyrics);
      setLyricsMode('text');
      showToast('success', t('new.linkcoreImported'));
    } catch {
      showToast('error', t('new.linkcoreImportFailed'));
    } finally {
      setImportingLinkcore(false);
    }
  };

  const handleCoverUpload = async (file: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      showToast('error', t('song.coverUnsupported'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', t('song.coverTooLarge'));
      return;
    }
    setCoverUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/songs/${songId}`, { method: 'POST', body: form });
      const result = await res.json();
      if (!res.ok || !result?.cover_url) {
        showToast('error', t('song.coverUploadFailed'));
        return;
      }
      setCoverUrl(result.cover_url);
      showToast('success', t('song.coverUploaded'));
    } catch {
      showToast('error', t('song.coverUploadFailed'));
    } finally {
      setCoverUploading(false);
      if (coverFileRef.current) coverFileRef.current.value = '';
    }
  };

  const handleCoverRemove = async () => {
    setCoverUploading(true);
    try {
      const res = await fetch(`/api/songs/${songId}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok || result?.cover_url !== null) {
        showToast('error', t('song.coverUploadFailed'));
        return;
      }
      setCoverUrl(null);
      showToast('success', t('song.coverRemoved'));
    } catch {
      showToast('error', t('song.coverUploadFailed'));
    } finally {
      setCoverUploading(false);
    }
  };

  /** Cover endpoints need the song id; unavailable in create mode. */
  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', t(`${ns}.titleRequired`));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string | boolean> = {
        title: title.trim(),
        artist: artist.trim(),
      };
      if (mode === 'create') {
        if (lyrics.trim()) {
          if (lyricsMode === 'lrc') body.lyrics_synced = lyrics;
          else body.lyrics_raw = lyrics;
        }
        if (readingSchemeConfirmed) body.reading_scheme = readingScheme;
        if (spotifyTrackId) body.spotify_track_id = spotifyTrackId;
      } else {
        if (lyricsChanged) {
          if (lyricsMode === 'lrc') body.lyrics_synced = lyrics;
          else {
            body.lyrics_raw = lyrics;
            body.lyrics_synced = '';
          }
        }
        if (readingSchemeChanged) {
          body.reading_scheme = readingScheme;
          body.reading_scheme_confirmed = true;
        }
      }
      const song = await onSave(body);
      showToast('success', t(`${ns}.saved`));
      setTimeout(() => router.push(`/songs/${song.id}`), 800);
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : t(`${ns}.error`));
    } finally {
      setSaving(false);
    }
  };

  const radioCls = (modeName: LyricsMode) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
      lyricsMode === modeName
        ? 'song-editor-choice--active border'
        : 'bg-[var(--accent)] text-[var(--muted-foreground)] border border-transparent hover:text-[var(--foreground)]'
    }`;

  const isYue = readingSchemeConfirmed && readingScheme === 'yue-jyutping';
  const cantoneseSuggestion = mode === 'create' ? detectCantoneseLyrics(lyrics) : null;
  const isCustomCover = !!coverUrl?.startsWith('/api/songs/');

  const lyricsPlaceholder = showCantonesePlaceholders && isYue
    ? t(lyricsMode === 'lrc' ? 'new.cantoneseLrcPlaceholder' : 'new.cantoneseLyricsPlaceholder')
    : t(lyricsMode === 'lrc' ? 'new.lrcPlaceholder' : 'new.lyricsPlaceholder');
  const lyricsHint = showCantonesePlaceholders && isYue
    ? t('new.jyutpingHint')
    : t(lyricsMode === 'lrc' ? 'new.lyricsHint' : 'new.furiganaHint');

  return (
    <>
      <div className="space-y-5 sm:space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t(`${ns}.songTitle`)} <span className="text-[var(--destructive)]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t(`${ns}.titlePlaceholder`)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none song-editor-input transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">{t(`${ns}.artist`)}</label>
          <input
            type="text"
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            placeholder={t(`${ns}.artistPlaceholder`)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none song-editor-input transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Reading scheme */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">{t(`${ns}.readingScheme`)}</label>
          <div className="flex flex-wrap gap-2">
            {(['ja-kana', 'yue-jyutping'] as const).map((scheme) => (
              <button
                key={scheme}
                type="button"
                onClick={() => {
                  setReadingScheme(scheme);
                  setReadingSchemeConfirmed(true);
                  if (mode === 'edit') setReadingSchemeChanged(true);
                }}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                  readingSchemeConfirmed && readingScheme === scheme
                    ? 'song-editor-choice--active'
                    : 'border-[var(--border)] bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t(scheme === 'ja-kana' ? `${ns}.readingJapanese` : `${ns}.readingCantonese`)}
              </button>
            ))}
          </div>
          {mode === 'create' && !readingSchemeConfirmed && (
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{t('new.readingAutoHint')}</p>
          )}
          {mode === 'edit' && (
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{t('edit.readingSchemeHint')}</p>
          )}
          {mode === 'create' && !readingSchemeConfirmed && cantoneseSuggestion?.confidence === 'high' && (
            <button
              type="button"
              onClick={() => {
                setReadingScheme('yue-jyutping');
                setReadingSchemeConfirmed(true);
              }}
              className="mt-2 text-left text-xs font-medium text-[var(--song-accent)] hover:underline"
            >
              {t('new.cantoneseDetected')}
            </button>
          )}
        </div>

        {/* Cover (edit mode) */}
        {canManageCover && (
          <div>
            <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">{t('song.uploadCover')}</label>
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--accent)]">
                {coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverUrl} alt={title || ''} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[var(--muted-foreground)]">
                    <Music className="h-6 w-6 opacity-50" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleCoverUpload(file);
                  }} />
                  <button
                    type="button"
                    onClick={() => coverFileRef.current?.click()}
                    disabled={coverUploading}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-[var(--foreground)] hover:opacity-85 transition-opacity disabled:opacity-50"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {coverUploading ? t('song.coverUploading') : t('song.uploadCover')}
                  </button>
                  {isCustomCover && (
                    <button
                      type="button"
                      onClick={() => void handleCoverRemove()}
                      disabled={coverUploading}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors disabled:opacity-50"
                    >
                      <ImageOff className="h-3.5 w-3.5" />
                      {t('song.removeCover')}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)]">{t('song.coverHint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Lyrics */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t(`${ns}.lyrics`)}</label>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button type="button" onClick={() => setLyricsMode('text')} className={radioCls('text')}>
                {t('new.lyricsModePlain')}
              </button>
              <button type="button" onClick={() => setLyricsMode('lrc')} className={radioCls('lrc')}>
                {t('new.lyricsModeLrc')}
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.lrc,.text" onChange={handleFileUpload} className="hidden" />
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

          {showLinkcore && (
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
          )}

          <textarea
            value={lyrics}
            onChange={(event) => handleLyricsChange(event.target.value)}
            placeholder={lyricsPlaceholder}
            rows={12}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-3 text-sm outline-none song-editor-input transition-colors resize-y leading-relaxed font-mono placeholder:text-[var(--muted-foreground)]/50"
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">{lyricsHint}</p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="song-editor-primary-button rounded-md px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
          >
            {saving ? t(`${ns}.converting`) : (saveLabel ?? t(`${ns}.save`))}
          </button>
          <button onClick={() => router.push(cancelHref)} className="rounded-md px-5 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.msg} />}
    </>
  );
}
