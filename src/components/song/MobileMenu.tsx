'use client';

import { useState } from 'react';
import { RefreshCw, Bug, Clock3, Pencil, Trash2, Download, PictureInPicture, Copy, Check, MoreVertical, Languages, ChevronRight, Info, Palette, SlidersHorizontal, FlaskConical, Share2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MobileIconButton, buildReadingMenuItems, type ToolbarMenuItem } from './ToolbarMenu';

/** Shared visual class for the song-page mobile menu popovers. */
function mobileContentCls() {
  return 'rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-xl min-w-[200px]';
}

/** Shared visual class for a normal (non-danger, non-active) mobile menu item. */
const mobileItemBase =
  'song-menu-item flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-sm text-[var(--foreground)] data-[highlighted]:bg-[var(--accent)] data-[disabled]:opacity-50';

export function MobileMenu({ data, sync, song, id, router, furiganaLines, pipSupported, onOpenPiP, onShowSongInfo, onRecolorCover, onToggleDotParams, onOpenExperiments, onOpenDownload, canEdit }: {
  data: ReturnType<typeof useSongData>;
  sync: ReturnType<typeof useSpotifySync>;
  song: NonNullable<ReturnType<typeof useSongData>['song']>;
  id: string;
  router: ReturnType<typeof useRouter>;
  furiganaLines: ReturnType<typeof useSongData>['furiganaLines'];
  pipSupported: boolean;
  onOpenPiP: () => void;
  onShowSongInfo: () => void;
  onOpenExperiments: () => void;
  onRecolorCover: () => void;
  onToggleDotParams: () => void;
  onOpenDownload: () => void;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);

  // The <DropdownMenuItem> items in the top-level 3-dot menu (kept open when
  // the "edit" submenu is toggled / toggles without closing).
  const mainMenuItems: ToolbarMenuItem[] = [
    { icon: <Info className="h-4 w-4" />, label: t('song.info'), onClick: onShowSongInfo },
    ...(pipSupported && furiganaLines.length > 0 ? [{ icon: <PictureInPicture className="h-4 w-4" />, label: t('song.pipBtn'), onClick: onOpenPiP }] : []),
    { icon: <Bug className="h-4 w-4" />, label: t('song.debug'), status: t(data.debug ? 'common.on' : 'common.off'), onClick: () => data.setDebug(!data.debug), keepOpen: true },
    { icon: <FlaskConical className="h-4 w-4" />, label: t('song.experimentsTitle'), onClick: () => onOpenExperiments() },
    { icon: <Download className="h-4 w-4" />, label: t('song.downloadWithEllipsis'), onClick: onOpenDownload },
  ];

  const renderItemBody = (item: ToolbarMenuItem) => (
    <>
      {item.icon}
      <span className="min-w-0 flex-1">{item.label}</span>
      {item.status && <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{item.status}</span>}
    </>
  );

  const renderMainMenuItem = (item: ToolbarMenuItem, key: number | string) => (
    <DropdownMenuItem
      key={key}
      disabled={'disabled' in item ? item.disabled : false}
      className={
        'danger' in item && item.danger
          ? `${mobileItemBase} text-[var(--destructive)] data-[highlighted]:bg-[var(--destructive)]/15 data-[highlighted]:text-[var(--destructive)]`
          : mobileItemBase
      }
      onSelect={(e) => {
        if ('keepOpen' in item && item.keepOpen) e.preventDefault();
        item.onClick?.();
      }}
    >
      {renderItemBody(item)}
    </DropdownMenuItem>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 sm:hidden z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]">
      <div className="mx-auto max-w-[860px] flex items-center justify-between px-2" style={{ paddingTop: 8, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        {/* A-/A+ */}
        <div className="song-mobile-surface flex items-stretch rounded-lg overflow-hidden">
          <button onClick={() => data.setFontSize(s => Math.max(14, s - 2))} className="song-mobile-text-button flex items-center justify-center px-2 py-1 text-sm font-medium">A-</button>
          <div className="w-px bg-[var(--border)]" />
          <button onClick={() => data.setFontSize(s => Math.min(32, s + 2))} className="song-mobile-text-button flex items-center justify-center px-2 py-1 text-base font-medium">A+</button>
        </div>

        {/* Copy — original / translation */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MobileIconButton
              label={data.copied ? t('share.copied') : t('song.copy')}
              className={data.copied ? 'text-[var(--success)]' : ''}
            >
              {data.copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            </MobileIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className={mobileContentCls()}>
            <DropdownMenuItem
              className={mobileItemBase}
              onSelect={() => void data.handleCopy('original')}
            >
              <Copy className="h-4 w-4" />
              <span>{t('song.copyOriginal')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={mobileItemBase}
              disabled={!data.hasTranslation}
              onSelect={() => void data.handleCopy('translation')}
            >
              <Languages className="h-4 w-4" />
              <span>{t('song.copyTranslation')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Original / Furigana — expands a menu like the desktop Languages menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MobileIconButton
              label={t(data.readingMode === 'original'
                ? 'song.readingOriginal'
                : song.reading_scheme === 'yue-jyutping'
                  ? 'song.readingJyutping'
                  : 'song.readingFurigana')}
              className={data.readingMode !== 'furigana' ? 'song-mobile-button--active' : ''}
            >
              <Languages className="h-5 w-5" />
            </MobileIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className={mobileContentCls()}>
            {buildReadingMenuItems(data, song, t, canEdit).map((item, i) => {
              const activeCls = item.active
                ? 'text-[var(--song-accent)] bg-[var(--song-accent)]/10 data-[highlighted]:bg-[var(--song-accent)]/10'
                : '';
              return (
                <DropdownMenuItem
                  key={i}
                  disabled={item.disabled}
                  className={`${mobileItemBase} ${activeCls}`}
                  onSelect={(e) => {
                    if (item.keepOpen) e.preventDefault();
                    item.onClick?.();
                  }}
                >
                  {renderItemBody(item)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Share */}
        <MobileIconButton
          label={t('song.share')}
          onClick={() => router.push(sync.activeLine >= 0 ? `/songs/${id}/share?line=${sync.activeLine}` : `/songs/${id}/share`)}
        >
          <Share2 className="h-5 w-5" />
        </MobileIconButton>

        {/* 3-dot menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MobileIconButton
              label={t('song.more')}
              className="song-mobile-menu-trigger"
            >
              <MoreVertical className="h-5 w-5" />
            </MobileIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className={mobileContentCls()}>
            {mainMenuItems.map((item, i) => renderMainMenuItem(item, i))}
            {canEdit && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={`${mobileItemBase} gap-3 data-[state=open]:bg-[var(--accent)]`}>
                  <Pencil className="h-4 w-4" />
                  <span className="min-w-0 flex-1">{t('common.edit')}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4} className={mobileContentCls()}>
                  <DropdownMenuItem
                    className={mobileItemBase}
                    onSelect={() => router.push(`/songs/${id}/edit`)}
                  >
                    <Pencil className="h-4 w-4" />
                    <span>{t('common.edit')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={mobileItemBase}
                    onSelect={() => router.push(`/songs/${id}/furigana/edit`)}
                  >
                    <Languages className="h-4 w-4" />
                    <span>{t('furigana.title')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className={mobileItemBase}
                    onSelect={() => router.push(`/songs/${id}/translation/edit`)}
                  >
                    <Languages className="h-4 w-4" />
                    <span>{t('song.translationEdit')}</span>
                  </DropdownMenuItem>
                  {song.lyrics_raw && (
                    <DropdownMenuItem
                      className={mobileItemBase}
                      onSelect={() => router.push(`/songs/${id}/timeline/edit`)}
                    >
                      <Clock3 className="h-4 w-4" />
                      <span>{t('song.timelineEdit')}</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className={mobileItemBase}
                    disabled={data.syncing}
                    onSelect={() => setShowSyncConfirm(true)}
                  >
                    <RefreshCw className={`h-4 w-4 ${data.syncing ? 'animate-spin' : ''}`} />
                    <span>{data.syncing ? t('song.syncing') : t('song.sync')}</span>
                  </DropdownMenuItem>
                  {data.debug && (
                    <>
                      <DropdownMenuItem
                        className={mobileItemBase}
                        onSelect={() => onRecolorCover()}
                      >
                        <Palette className="h-4 w-4" />
                        <span>{t('song.recolorCover')}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className={mobileItemBase}
                        onSelect={() => onToggleDotParams()}
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        <span>{t('song.dotParams')}</span>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem
                    className={`${mobileItemBase} text-[var(--destructive)] data-[highlighted]:bg-[var(--destructive)]/15 data-[highlighted]:text-[var(--destructive)]`}
                    onSelect={() => data.handleDelete()}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{t('common.delete')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={showSyncConfirm}
        title={t('song.syncConfirmTitle')}
        body={t('song.syncConfirmBody')}
        confirmLabel={t('song.sync')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setShowSyncConfirm(false);
          void data.handleSync();
        }}
        onCancel={() => setShowSyncConfirm(false)}
      />
    </div>
  );
}
