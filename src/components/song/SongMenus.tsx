'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Bug, Clock3, Pencil, Trash2, ArrowLeft, ArrowDown, Minus, Plus, Music, Download, Loader2, ExternalLink, PictureInPicture, Repeat, Copy, Check, MoreVertical, Languages, ChevronDown, Share2, Info, X, CircleAlert, Eraser, Palette, SlidersHorizontal, Brain, FlaskConical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
import ConfirmDialog from '@/components/ConfirmDialog';

function btnTextCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl sm:rounded-md transition-colors disabled:opacity-50 text-xs font-medium px-3 py-2';
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20'
    : active
      ? 'song-accent-button song-accent-button--active'
      : 'song-accent-button';
  return `${base} ${colors}`;
}

export type ToolbarMenuItem = {
  icon?: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  /** Keep the menu open after clicking this item (for toggles / mode switching). */
  keepOpen?: boolean;
};

/** Shared Languages-menu items for the desktop toolbar and the mobile popover. */
export function buildReadingMenuItems(
  data: ReturnType<typeof useSongData>,
  song: NonNullable<ReturnType<typeof useSongData>['song']>,
  t: ReturnType<typeof useI18n>['t'],
  canEdit: boolean,
): ToolbarMenuItem[] {
  return [
    ...([
      ['original', 'song.readingOriginal'],
      ['furigana', song.reading_scheme === 'yue-jyutping' ? 'song.readingJyutping' : 'song.readingFurigana'],
    ] as const).map(([mode, label]) => ({
      icon: <Languages className="h-3.5 w-3.5" />,
      label: t(label),
      active: data.readingMode === mode,
      onClick: () => data.setReadingMode(mode),
      keepOpen: true,
    })),
    ...(song.reading_scheme === 'yue-jyutping' ? [] : [{
      icon: <Languages className="h-3.5 w-3.5" />,
      label: t('song.romanizeFurigana'),
      status: t(data.romanizeFurigana ? 'common.on' : 'common.off'),
      onClick: () => data.setRomanizeFurigana(!data.romanizeFurigana),
      keepOpen: true,
    }]),
    {
      icon: data.translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />,
      label: t('song.translation'),
      status: data.translating ? t('song.translating') : t(data.showTranslation ? 'common.on' : 'common.off'),
      onClick: () => {
        if (data.translations.length > 0) data.setShowTranslation(!data.showTranslation);
        else void data.handleTranslate();
      },
      disabled: data.translating || (!canEdit && data.translations.length === 0),
      keepOpen: true,
    },
  ];
}

/** Icon-only mobile controls reveal their localized action on a touch long-press. */
function MobileIconButton({ label, className = '', children, onClick, ...props }: React.ComponentProps<'button'> & { label: string }) {
  const [showLabel, setShowLabel] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const clearLongPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearLongPress, []);

  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`song-mobile-button relative flex items-center justify-center rounded-lg p-2 ${className}`}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (event.pointerType === 'mouse') return;
        longPressedRef.current = false;
        timerRef.current = setTimeout(() => {
          longPressedRef.current = true;
          setShowLabel(true);
        }, 450);
      }}
      onPointerUp={(event) => {
        props.onPointerUp?.(event);
        clearLongPress();
      }}
      onPointerCancel={(event) => {
        props.onPointerCancel?.(event);
        clearLongPress();
        setShowLabel(false);
      }}
      onContextMenu={(event) => {
        props.onContextMenu?.(event);
        event.preventDefault();
      }}
      onClick={(event) => {
        if (longPressedRef.current) {
          event.preventDefault();
          longPressedRef.current = false;
          setShowLabel(false);
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
      {showLabel && <span role="status" className="song-mobile-tooltip">{label}</span>}
    </button>
  );
}

export function ToolbarMenu({ label, items, triggerClassName }: { label: ReactNode; items: ToolbarMenuItem[]; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={triggerClassName ?? `${btnTextCls(open)} song-menu-trigger`}
        data-open={open}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      <div
        role="menu"
        aria-hidden={!open}
        data-open={open}
        className="song-menu-popover song-menu-popover--desktop absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
      >
        {items.map((item, i) => {
          const base = "song-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left disabled:opacity-50";
          const cls = item.danger
            ? `${base} text-[var(--destructive)] hover:bg-[var(--destructive)]/10`
            : item.active
              ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10`
              : `${base} text-[var(--foreground)] hover:bg-[var(--accent)]`;
          if (item.href) {
            return (
              <a key={i} role="menuitem" data-menu-item href={item.href} onClick={() => setOpen(false)} className={cls}>
                {item.icon}
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
              </a>
            );
          }
          return (
            <button
              type="button"
              role="menuitem"
              data-menu-item
              key={i}
              onClick={() => { item.onClick?.(); if (!item.keepOpen) setOpen(false); }}
              disabled={item.disabled}
              className={cls}
            >
              {item.icon}
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mobile bottom toolbar — A-/A+, Sync, Copy visible; rest in 3-dot menu */
export function MobileMenu({ data, sync, song, id, router, furiganaLines, pipSupported, onOpenPiP, onShowSongInfo, onRecolorCover, onToggleDotParams, onOpenExperiments, canEdit }: {
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
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside tap
  useEffect(() => {
    if (!showMenu && !showLangMenu && !showCopyMenu) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    document.addEventListener('touchstart', handler);
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('touchstart', handler); document.removeEventListener('mousedown', handler); };
  }, [showMenu, showLangMenu, showCopyMenu]);

  const menuItems: ToolbarMenuItem[] = [
    { icon: <Info className="h-4 w-4" />, label: t('song.info'), onClick: onShowSongInfo },
    ...(pipSupported && furiganaLines.length > 0 ? [{ icon: <PictureInPicture className="h-4 w-4" />, label: t('song.pipBtn'), onClick: onOpenPiP }] : []),
    { icon: <Bug className="h-4 w-4" />, label: t('song.debug'), status: t(data.debug ? 'common.on' : 'common.off'), onClick: () => data.setDebug(!data.debug), keepOpen: true },
    { icon: <FlaskConical className="h-4 w-4" />, label: t('song.experimentsTitle'), onClick: () => onOpenExperiments() },
    { icon: <Download className="h-4 w-4" />, label: t('song.download'), status: <ChevronDown className="h-3.5 w-3.5 -rotate-90" />, onClick: () => { setShowEditMenu(false); setShowDownloadMenu(true); }, keepOpen: true },
    ...(canEdit ? [{
      icon: <Pencil className="h-4 w-4" />,
      label: t('common.edit'),
      status: <ChevronDown className="h-3.5 w-3.5 -rotate-90" />,
      onClick: () => { setShowDownloadMenu(false); setShowEditMenu(true); },
      keepOpen: true,
    }] : []),
  ];

  const downloadItems = [
    { label: '.txt', format: 'text' },
    { label: '.lrc', format: 'lrc' },
    { label: `.html ${t('song.exportFurigana')}`, format: 'html' },
  ];

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
        <div className="relative" ref={copyMenuRef}>
          <MobileIconButton
            label={data.copied ? t('share.copied') : t('song.copy')}
            onClick={() => {
              setShowMenu(false);
              setShowLangMenu(false);
              setShowCopyMenu((v) => !v);
            }}
            className={`${data.copied ? 'text-[var(--success)]' : ''} ${showCopyMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showCopyMenu}
            aria-haspopup="menu"
            aria-expanded={showCopyMenu}
          >
            {data.copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showCopyMenu}
            data-open={showCopyMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              data-menu-item
              onClick={() => {
                setShowCopyMenu(false);
                void data.handleCopy('original');
              }}
              className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
            >
              <Copy className="h-4 w-4" />
              <span>{t('song.copyOriginal')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-menu-item
              onClick={() => {
                setShowCopyMenu(false);
                void data.handleCopy('translation');
              }}
              disabled={data.translations.length === 0}
              className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              <Languages className="h-4 w-4" />
              <span>{t('song.copyTranslation')}</span>
            </button>
          </div>
        </div>

        {/* Original / Furigana — expands a menu like the desktop Languages menu */}
        <div className="relative" ref={langMenuRef}>
          <MobileIconButton
            label={t(data.readingMode === 'original' ? 'song.readingOriginal' : 'song.readingFurigana')}
            onClick={() => {
              setShowMenu(false);
              setShowCopyMenu(false);
              setShowLangMenu((v) => !v);
            }}
            className={`${data.readingMode !== 'furigana' ? 'song-mobile-button--active' : ''} ${showLangMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showLangMenu}
            aria-haspopup="menu"
            aria-expanded={showLangMenu}
          >
            <Languages className="h-5 w-5" />
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showLangMenu}
            data-open={showLangMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            {buildReadingMenuItems(data, song, t, canEdit).map((item, i) => {
              const base = "song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm";
              const cls = item.active
                ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10`
                : `${base} text-[var(--foreground)] hover:bg-[var(--accent)]`;
              return (
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  key={i}
                  onClick={() => {
                    item.onClick?.();
                    if (!item.keepOpen) setShowLangMenu(false);
                  }}
                  disabled={item.disabled}
                  className={`${cls} disabled:opacity-50`}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.status && <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{item.status}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Share */}
        <MobileIconButton
          label={t('song.share')}
          onClick={() => router.push(sync.activeLine >= 0 ? `/songs/${id}/share?line=${sync.activeLine}` : `/songs/${id}/share`)}
        >
          <Share2 className="h-5 w-5" />
        </MobileIconButton>

        {/* 3-dot menu */}
        <div className="relative" ref={menuRef}>
          <MobileIconButton
            label={t('song.more')}
            onClick={() => {
              if (showMenu) {
                setShowMenu(false);
              } else {
                setShowDownloadMenu(false);
                setShowEditMenu(false);
                setShowLangMenu(false);
                setShowCopyMenu(false);
                setShowMenu(true);
              }
            }}
            className={`song-mobile-menu-trigger ${showMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showMenu}
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            <MoreVertical className="h-5 w-5" />
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showMenu}
            data-open={showMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            {showDownloadMenu ? (
              <div key="download" className="song-menu-page song-menu-page--forward">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => setShowDownloadMenu(false)}
                  className="song-menu-item flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('song.download')}</span>
                </button>
                {downloadItems.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    key={item.format}
                    onClick={() => {
                      setShowMenu(false);
                      window.location.href = `/api/songs/${id}/export?format=${item.format}`;
                    }}
                    className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Download className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : showEditMenu ? (
              <div key="edit" className="song-menu-page song-menu-page--forward">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => setShowEditMenu(false)}
                  className="song-menu-item flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('common.edit')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Pencil className="h-4 w-4" />
                  <span>{t('common.edit')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/furigana/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Languages className="h-4 w-4" />
                  <span>{t('furigana.title')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/translation/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Languages className="h-4 w-4" />
                  <span>{t('song.translationEdit')}</span>
                </button>
                {song.lyrics_raw && (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    onClick={() => router.push(`/songs/${id}/timeline/edit`)}
                    className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Clock3 className="h-4 w-4" />
                    <span>{t('song.timelineEdit')}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => {
                    setShowEditMenu(false);
                    setShowSyncConfirm(true);
                  }}
                  disabled={data.syncing}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${data.syncing ? 'animate-spin' : ''}`} />
                  <span>{data.syncing ? t('song.syncing') : t('song.sync')}</span>
                </button>
                {data.debug && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        void data.clearFurigana();
                      }}
                      disabled={!canEdit}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      <Eraser className="h-4 w-4" />
                      <span>{t('song.clearFurigana')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        void data.clearTranslation();
                      }}
                      disabled={!canEdit}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      <Eraser className="h-4 w-4" />
                      <span>{t('song.clearTranslation')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        onRecolorCover();
                      }}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                    >
                      <Palette className="h-4 w-4" />
                      <span>{t('song.recolorCover')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        onToggleDotParams();
                      }}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>{t('song.dotParams')}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => {
                    setShowMenu(false);
                    data.handleDelete();
                  }}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{t('common.delete')}</span>
                </button>
              </div>
            ) : (
              <div key="main" className="song-menu-page song-menu-page--back">
                {menuItems.map((item, i) => (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    key={i}
                    onClick={() => {
                      item.onClick?.();
                      if (!('keepOpen' in item && item.keepOpen)) {
                        setShowMenu(false);
                      }
                    }}
                    disabled={'disabled' in item ? item.disabled : false}
                    className={`song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm disabled:opacity-50 ${
                      'danger' in item && item.danger
                        ? 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
                        : 'text-[var(--foreground)] hover:bg-[var(--accent)]'
                    }`}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {'status' in item && item.status && (
                      <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{item.status}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
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
