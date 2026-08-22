'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Eraser, Info, RefreshCw, ArrowLeft } from 'lucide-react';
import SongForm from '@/components/SongForm';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { extractLrcMetadata } from '@/lib/lrc';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import type { ReadingScheme } from '@/lib/types';
import { LYRICS_SOURCE_KEYS } from '@/lib/lyrics-source';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_synced: string;
  lyrics_furigana: string;
  lyrics_translation: string;
  lyrics_translation_reasoning?: string | null;
  lyrics_glossary?: string | null;
  cover_url?: string | null;
  reading_scheme: ReadingScheme;
  lyrics_source: string;
  lyrics_confidence: number;
  lyrics_needs_review: number;
  created_at: string;
  updated_at: string;
  spotify_track_id?: string | null;
  spotify_album?: string | null;
}

type SubDataKey = 'furigana' | 'translation' | 'reasoning' | 'glossary';

const SUB_DATA_FLAG: Record<SubDataKey, string> = {
  furigana: 'clear_furigana',
  translation: 'clear_translation',
  reasoning: 'clear_reasoning',
  glossary: 'clear_glossary',
};

export default function EditSongPage() {
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;
  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [clearingKey, setClearingKey] = useState<SubDataKey | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form dirty state, reported by <SongForm>; drives the unsaved-changes guard
  // for breadcrumbs, cancel, browser back/forward and unload. The dialog is
  // rendered at the bottom of this page.
  const [formDirty, setFormDirty] = useState(false);
  const { dialog: unsavedDialog, guard: guardNavigate } = useUnsavedChangesGuard({
    confirmHref: `/songs/${id}`,
    dirty: formDirty,
  });

  const coverTheme = useCoverTheme(song?.cover_url);
  const coverColor = coverTheme.palette;
  const songThemeStyle = coverTheme.style;

  const showToast = (type: 'success' | 'error', msg: string) => {
    // Clear any pending timer from a previous toast so it cannot dismiss the new one early.
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, msg });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3000);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then(async (response) => {
        if (response.status === 404) {
          setLoadError(false);
          throw new Error('song_load_failed');
        }
        if (!response.ok) {
          setLoadError(true);
          throw new Error('song_load_failed');
        }
        return response.json() as Promise<SongData>;
      })
      .then((data) => {
        setLoadError(false);
        setSong(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [id]);

  const retryLoad = () => {
    setLoadError(false);
    setSong(null);
    setLoading(true);
    fetch(`/api/songs/${id}`)
      .then(async (response) => {
        if (response.status === 404) {
          setLoadError(false);
          throw new Error('song_load_failed');
        }
        if (!response.ok) {
          setLoadError(true);
          throw new Error('song_load_failed');
        }
        return response.json() as Promise<SongData>;
      })
      .then((data) => {
        setLoadError(false);
        setSong(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  };

  const handleSave = async (body: Record<string, string | boolean>) => {
    const res = await fetch(`/api/songs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      if (data?.error === 'timestamps_not_ordered') throw new Error('timestamps_not_ordered');
      throw new Error(t('edit.saveFailed'));
    }
    return res.json() as Promise<{ id: string }>;
  };

  /** Clear a lyrics-derived sub-data (furigana / translation / reasoning / glossary) server-side. */
  const clearSubData = async (key: SubDataKey) => {
    if (!song || clearingKey) return;
    setClearingKey(key);
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [SUB_DATA_FLAG[key]]: true }),
      });
      const updated = await res.json();
      if (!res.ok) {
        showToast('error', t('song.clearFailed'));
        return;
      }
      setSong(updated);
      showToast('success', t(`song.${key}Cleared`));
    } catch {
      showToast('error', t('song.clearFailed'));
    } finally {
      setClearingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!song) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <RefreshCw className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('song.loadFailed')}</p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={retryLoad}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t('song.retry')}
            </button>
            <Link href="/" className="inline-flex items-center gap-1 text-xs text-[var(--song-accent)] hover:underline">
              <ArrowLeft className="h-3 w-3" /> {t('song.backToList')}
            </Link>
          </div>
        </div>
      );
    }
    return null;
  }

  // LRC metadata (incl. `[offset:±ms]`) embedded in the synced timeline.
  const lrcMetadata = extractLrcMetadata(song.lyrics_synced || '');
  const lyricsSourceKey = song.lyrics_source ? LYRICS_SOURCE_KEYS[song.lyrics_source] : undefined;
  const lyricsSourceLabel = lyricsSourceKey ? t(lyricsSourceKey) : song.lyrics_source || t('lyricsSources.none');

  const hasFurigana = !!song.lyrics_furigana && song.lyrics_furigana !== '[]';
  const hasTranslation = !!song.lyrics_translation && song.lyrics_translation !== '[]';
  const hasReasoning = !!song.lyrics_translation_reasoning;
  const hasGlossary = !!song.lyrics_glossary;

  const subDataItems: { key: SubDataKey; present: boolean; label: string }[] = [
    { key: 'furigana', present: hasFurigana, label: t('song.clearFurigana') },
    { key: 'translation', present: hasTranslation, label: t('song.clearTranslation') },
    { key: 'reasoning', present: hasReasoning, label: t('song.clearReasoning') },
    { key: 'glossary', present: hasGlossary, label: t('song.clearGlossary') },
  ];

  return (
    <div className={`song-view song-editor-page fade-in max-w-2xl${coverColor ? ' song-view--accented' : ''}`} style={songThemeStyle}>
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
        <span className="opacity-40">/</span>
        <Link href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[140px] sm:max-w-[180px]">
          {song.title || t('edit.songDetail')}
        </Link>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('edit.editBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('edit.title')}</h1>

      <SongForm
        ns="edit"
        mode="edit"
        songId={id}
        initialTitle={song.title}
        initialArtist={song.artist}
        initialLyrics={song.lyrics_synced || song.lyrics_raw}
        initialLyricsMode={song.lyrics_synced ? 'lrc' : 'text'}
        initialReadingScheme={song.reading_scheme === 'yue-jyutping' ? 'yue-jyutping' : 'ja-kana'}
        initialReadingSchemeConfirmed
        initialCoverUrl={song.cover_url ?? null}
        canManageCover
        onSave={handleSave}
        onDirtyChange={setFormDirty}
        guardNavigate={guardNavigate}
        cancelHref={`/songs/${id}`}
      />

      {/* 歌曲 metadata — 含歌词来源、置信度、同步状态与 LRC offset 等 */}
      <section className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 p-4 sm:p-5">
        <div className="mb-1.5 flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--muted-foreground)]" />
          <h2 className="text-sm font-semibold tracking-tight">{t('edit.metadataTitle')}</h2>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('edit.metadataHint')}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataSource')}</dt>
            <dd className="capitalize">{lyricsSourceLabel}</dd>
          </div>
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataConfidence')}</dt>
            <dd className={`${(song.lyrics_confidence ?? 100) >= 90 ? 'text-[var(--success)]' : (song.lyrics_confidence ?? 100) >= 75 ? 'text-[var(--warning)]' : 'text-[var(--destructive)]'}`}>
              {t('song.lyricsConfidence', { confidence: String(song.lyrics_confidence ?? 100) })}
            </dd>
          </div>
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataSyncedCount')}</dt>
            <dd className="text-[var(--success)]">{String((song.lyrics_synced || '').split('\n').filter((l) => l.trim().startsWith('[') && l.includes(']')).length)}</dd>
          </div>
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataOffset')}</dt>
            <dd className={lrcMetadata.offsetMs == null ? '' : lrcMetadata.offsetMs !== 0 ? 'text-[var(--warning)]' : 'text-[var(--muted-foreground)]'}>
              {lrcMetadata.offsetMs == null ? t('edit.metadataNone') : `${lrcMetadata.offsetMs > 0 ? '+' : ''}${lrcMetadata.offsetMs} ms`}
            </dd>
          </div>
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('common.created')}</dt>
            <dd>{new Date(song.created_at).toLocaleString()}</dd>
          </div>
          <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
            <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('common.updated')}</dt>
            <dd>{new Date(song.updated_at).toLocaleString()}</dd>
          </div>
          {song.lyrics_needs_review === 1 && (
            <div className="rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--warning)]">
              <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataNeedsReview')}</dt>
              <dd>{t('song.lyricsNeedsReview')}</dd>
            </div>
          )}
          {song.spotify_track_id && (
            <div className="break-all rounded-md bg-[var(--accent)] px-3 py-2.5 text-xs text-[var(--muted-foreground)]">
              <dt className="mb-0.5 font-medium text-[var(--foreground)]">{t('edit.metadataSpotify')}</dt>
              <dd>{t('song.spotifyTrackId', { id: song.spotify_track_id })}{song.spotify_album ? ` · ${song.spotify_album}` : ''}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* 歌词相关子数据清除区 — 不需要调试模式，编辑页默认展示 */}
      <section className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 p-4 sm:p-5">
        <div className="mb-1.5 flex items-center gap-2">
          <Eraser className="h-4 w-4 text-[var(--muted-foreground)]" />
          <h2 className="text-sm font-semibold tracking-tight">{t('edit.subDataTitle')}</h2>
        </div>
        <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('edit.subDataHint')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {subDataItems.map(({ key, present, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => void clearSubData(key)}
              disabled={!present || clearingKey !== null}
              className="inline-flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2.5 text-left text-xs font-medium transition-colors hover:border-[var(--destructive)]/40 hover:text-[var(--destructive)] disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--foreground)]"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {clearingKey === key ? (
                  <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Eraser className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{label}</span>
              </span>
              <span className={`shrink-0 text-[10px] ${present ? 'text-[var(--muted-foreground)]' : 'text-[var(--muted-foreground)]/60'}`}>
                {present ? t('edit.subDataPresent') : t('edit.subDataEmpty')}
              </span>
            </button>
          ))}
        </div>
      </section>

      {toast && <Toast type={toast.type} message={toast.msg} />}
      {unsavedDialog}
    </div>
  );
}
