'use client';

import { Maximize2, Minus, Plus, Settings2, X } from 'lucide-react';
import CoverImage from '@/components/CoverImage';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n';
import type { useSongData } from '@/hooks/useSongData';

type SongData = ReturnType<typeof useSongData>;

export default function ImmersiveLyricsControls({
  data, song, coverUrl, browserFullscreen, canRequestFullscreen, onRequestFullscreen, onClose,
}: {
  data: SongData;
  song: NonNullable<SongData['song']>;
  coverUrl: string | null;
  browserFullscreen: boolean;
  canRequestFullscreen: boolean;
  onRequestFullscreen: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const itemCls = 'gap-2 rounded-md px-3 py-2.5 text-sm data-[highlighted]:bg-[var(--accent)]';
  const keepOpen = (event: Event) => event.preventDefault();

  return (
    <>
      <div className="immersive-actions">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="immersive-action" aria-label={t('song.immersiveSettings')} title={t('song.immersiveSettings')}>
              <Settings2 className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" style={{ zIndex: 130 }} className="w-60 p-1.5">
            <DropdownMenuItem className={itemCls} disabled={data.fontSize <= 14} onSelect={(event) => {
              keepOpen(event); data.setFontSize((size) => Math.max(14, size - 2));
            }}>
              <Minus className="h-4 w-4" />{t('song.immersiveSmaller')}
            </DropdownMenuItem>
            <DropdownMenuItem className={itemCls} disabled={data.fontSize >= 32} onSelect={(event) => {
              keepOpen(event); data.setFontSize((size) => Math.min(32, size + 2));
            }}>
              <Plus className="h-4 w-4" />{t('song.immersiveLarger')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={itemCls} onSelect={(event) => {
              keepOpen(event); data.setReadingMode('original');
            }} aria-checked={data.readingMode === 'original'} role="menuitemradio">
              {t('song.readingOriginal')}{data.readingMode === 'original' ? ' ✓' : ''}
            </DropdownMenuItem>
            <DropdownMenuItem className={itemCls} onSelect={(event) => {
              keepOpen(event); data.setReadingMode('furigana');
            }} aria-checked={data.readingMode === 'furigana'} role="menuitemradio">
              {t(song.reading_scheme === 'yue-jyutping' ? 'song.readingJyutping' : 'song.readingFurigana')}{data.readingMode === 'furigana' ? ' ✓' : ''}
            </DropdownMenuItem>
            {song.reading_scheme !== 'yue-jyutping' && (
              <DropdownMenuItem className={itemCls} onSelect={(event) => {
                keepOpen(event); data.setRomanizeFurigana((value) => !value);
              }} aria-checked={data.romanizeFurigana} role="menuitemcheckbox">
                {t('song.romanizeFurigana')}{data.romanizeFurigana ? ' ✓' : ''}
              </DropdownMenuItem>
            )}
            {data.hasTranslation && (
              <DropdownMenuItem className={itemCls} onSelect={(event) => {
                keepOpen(event); data.setShowTranslation((value) => !value);
              }} aria-checked={data.showTranslation} role="menuitemcheckbox">
                {t('song.translation')}{data.showTranslation ? ' ✓' : ''}
              </DropdownMenuItem>
            )}
            {!browserFullscreen && canRequestFullscreen && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={itemCls} onSelect={onRequestFullscreen}>
                  <Maximize2 className="h-4 w-4" />{t('song.immersiveBrowserFullscreen')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" className="immersive-action" onClick={onClose} aria-label={t('song.immersiveClose')} title={t('song.immersiveClose')}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="immersive-song-info">
        <CoverImage src={coverUrl} alt="" size="sm" className="immersive-song-cover" />
        <div className="immersive-song-text min-w-0">
          <div className="immersive-song-title truncate text-base sm:text-lg font-semibold text-[var(--foreground)]">{song.title}</div>
          <div className="immersive-song-artist truncate text-sm">{song.artist || t('common.unknownArtist')}</div>
        </div>
      </div>
    </>
  );
}
