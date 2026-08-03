'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import SongForm from '@/components/SongForm';
import { useI18n } from '@/lib/i18n';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import type { ReadingScheme } from '@/lib/types';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_synced: string;
  cover_url?: string | null;
  reading_scheme: ReadingScheme;
}

export default function EditSongPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;
  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);

  const coverTheme = useCoverTheme(song?.cover_url);
  const coverColor = coverTheme.palette;
  const songThemeStyle = coverTheme.style;

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('song_load_failed');
        return response.json() as Promise<SongData>;
      })
      .then((data) => {
        setSong(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [id]);

  const handleSave = async (body: Record<string, string | boolean>) => {
    const res = await fetch(`/api/songs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(t('edit.saveFailed'));
    return res.json() as Promise<{ id: string }>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  if (!song) return null;

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
        cancelHref={`/songs/${id}`}
      />
    </div>
  );
}
