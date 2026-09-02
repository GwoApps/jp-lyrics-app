'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RefreshCw, Loader2, Languages, Brain } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useSongData } from '@/hooks/useSongData';


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
      label: data.translating
        ? t('song.translating')
        : !data.hasTranslation
          ? t('song.translation')
          : data.untranslatedCount > 0
            ? t('song.translationContinueRemain', { count: String(data.untranslatedCount) })
            : t('song.translation'),
      status: data.translating
        ? undefined
        : !data.hasTranslation
          ? undefined
          : data.untranslatedCount > 0
            ? t('song.translationPartial', { done: String(data.translatedCount), total: String(data.translatedCount + data.untranslatedCount) })
            : t(data.showTranslation ? 'common.on' : 'common.off'),
      onClick: () => {
        // Fully translated → toggle display. Untranslated / partial → start
        // (or resume) the translation, which the server continues from the
        // already-cached lines.
        if (data.hasTranslation && data.untranslatedCount === 0) {
          data.setShowTranslation(!data.showTranslation);
        } else {
          void data.handleTranslate();
        }
      },
      disabled: data.translating || (!canEdit && !data.hasTranslation),
      keepOpen: true,
    },
    // Force re-translate entry — after the user changes their target language
    // (or wants fresh output) the cache is no longer trusted; `force: true`
    // bypasses the server cache short-circuit entirely (issue #93).
    ...(data.hasTranslation && !data.translating ? [{
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      label: t('song.reTranslate'),
      onClick: () => void data.handleTranslate(true),
      keepOpen: false,
    } as ToolbarMenuItem] : []),
    ...(data.hasSavedReasoning || data.translationReasoning ? [{
      icon: <Brain className="h-3.5 w-3.5" />,
      label: t('song.translationReasoningView'),
      onClick: () => data.openSavedReasoning(),
      keepOpen: true,
    } as ToolbarMenuItem] : []),
  ];
}

/** Icon-only mobile controls reveal their localized action on a touch long-press. */
export const MobileIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<'button'> & { label: string }
>(function MobileIconButton({ label, className = '', children, onClick, ...props }, ref) {
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
      ref={ref}
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
});

export function ToolbarMenu({ label, items, triggerClassName }: { label: ReactNode; items: ToolbarMenuItem[]; triggerClassName?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={triggerClassName ?? `${btnTextCls(false)} song-menu-trigger`}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px] p-1">
        {items.map((item, i) => {
          const base = "song-menu-item w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-left";
          const cls = item.danger
            ? `${base} text-[var(--destructive)] data-[highlighted]:bg-[var(--destructive)]/15`
            : item.active
              ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10 data-[highlighted]:bg-[var(--song-accent)]/15`
              : `${base} text-[var(--foreground)] data-[highlighted]:bg-[var(--accent)]`;
          if (item.href) {
            return (
              <DropdownMenuItem key={i} asChild className={cls}>
                <a href={item.href}>
                  {item.icon}
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
                </a>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem
              key={i}
              disabled={item.disabled}
              className={cls}
              onSelect={(e) => {
                if (item.keepOpen) e.preventDefault();
                item.onClick?.();
              }}
            >
              {item.icon}
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
