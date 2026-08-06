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
    ...(data.hasSavedReasoning || data.translationReasoning ? [{
      icon: <Brain className="h-3.5 w-3.5" />,
      label: t('song.translationReasoningView'),
      onClick: () => data.openSavedReasoning(),
      keepOpen: true,
    } as ToolbarMenuItem] : []),
  ];
}

/** Icon-only mobile controls reveal their localized action on a touch long-press. */
export function MobileIconButton({ label, className = '', children, onClick, ...props }: React.ComponentProps<'button'> & { label: string }) {
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

