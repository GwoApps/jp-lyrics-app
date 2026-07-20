'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { Upload } from 'lucide-react';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useCoverTheme } from '@/hooks/useCoverPalette';

type LyricsMode = 'text' | 'lrc';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_synced: string;
  cover_url?: string | null;
}

export default function EditSongPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [plainLyrics, setPlainLyrics] = useState('');
  const [syncedLyrics, setSyncedLyrics] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [lyricsMode, setLyricsMode] = useState<LyricsMode>('text');
  const [lyricsChanged, setLyricsChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverTheme = useCoverTheme(coverUrl);
  const coverColor = coverTheme.palette;
  const songThemeStyle = coverTheme.style;

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('song_load_failed');
        return response.json() as Promise<SongData>;
      })
      .then((data) => {
        setTitle(data.title);
        setArtist(data.artist);
        setPlainLyrics(data.lyrics_raw || '');
        setSyncedLyrics(data.lyrics_synced || '');
        setCoverUrl(data.cover_url ?? null);
        if (!data.cover_url) {
          fetch(`/api/songs/${id}/cover`)
            .then(async (coverResponse) => {
              if (!coverResponse.ok) return null;
              const coverData = await coverResponse.json() as { cover_url?: string | null };
              return coverData.cover_url ?? null;
            })
            .then((url) => { if (url) setCoverUrl(url); })
            .catch(() => {});
        }
        setLyricsMode(data.lyrics_synced ? 'lrc' : 'text');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [id]);

  const handleLyricsChange = (value: string) => {
    setLyricsChanged(true);
    if (lyricsMode === 'lrc') {
      setSyncedLyrics(value);
    } else {
      setPlainLyrics(value);
      // A manually edited plain-text version supersedes old timing data.
      setSyncedLyrics('');
    }
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

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', t('edit.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = {
        title: title.trim(),
        artist: artist.trim(),
      };
      if (lyricsChanged) {
        if (lyricsMode === 'lrc') {
          body.lyrics_synced = syncedLyrics;
        } else {
          body.lyrics_raw = plainLyrics;
          body.lyrics_synced = '';
        }
      }
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(t('edit.saveFailed'));
      showToast('success', t('edit.saved'));
      setTimeout(() => router.push(`/songs/${id}`), 800);
    } catch (error: unknown) {
      showToast('error', error instanceof Error ? error.message : t('edit.error'));
    } finally {
      setSaving(false);
    }
  };

  const radioCls = (mode: LyricsMode) =>
    `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
      lyricsMode === mode
        ? 'song-editor-choice--active border'
        : 'bg-[var(--accent)] text-[var(--muted-foreground)] border border-transparent hover:text-[var(--foreground)]'
    }`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  const lyrics = lyricsMode === 'lrc' ? syncedLyrics : plainLyrics;

  return (
    <div className={`song-view song-editor-page fade-in max-w-2xl${coverColor ? ' song-view--accented' : ''}`} style={songThemeStyle}>
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
        <span className="opacity-40">/</span>
        <Link href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[140px] sm:max-w-[180px]">
          {title || t('edit.songDetail')}
        </Link>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('edit.editBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('edit.title')}</h1>

      <div className="space-y-5 sm:space-y-6">
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('edit.songTitle')} <span className="text-[var(--destructive)]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none song-editor-input transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">{t('edit.artist')}</label>
          <input
            type="text"
            value={artist}
            onChange={(event) => setArtist(event.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none song-editor-input transition-colors"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">{t('edit.lyrics')}</label>
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
          <textarea
            value={lyrics}
            onChange={(event) => handleLyricsChange(event.target.value)}
            placeholder={lyricsMode === 'lrc' ? t('new.lrcPlaceholder') : t('new.lyricsPlaceholder')}
            rows={12}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-3 text-sm outline-none song-editor-input transition-colors resize-y leading-relaxed font-mono placeholder:text-[var(--muted-foreground)]/50"
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {lyricsMode === 'lrc' ? t('new.lyricsHint') : t('edit.furiganaHint')}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="song-editor-primary-button rounded-md px-5 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
          >
            {saving ? t('edit.converting') : t('common.save')}
          </button>
          <button onClick={() => router.push(`/songs/${id}`)} className="rounded-md px-5 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.msg} />}
    </div>
  );
}
