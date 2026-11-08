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
import { targetLangDisplay } from '@/lib/target-lang';
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
  // The translation entry names the language it will produce — never a fixed
  // 「中文翻译」: the target language is user/admin configurable (issue #281).
  const targetLabel = data.targetLang ? targetLangDisplay(data.targetLang) : '';
  const storedLabel = data.storedTranslationLang ? targetLangDisplay(data.storedTranslationLang) : '';
  // Only an editor/owner can request a translation, so a wrong-language cache
  // stays a plain display toggle for everyone else — no button that 403s.
  const mismatchActionable = data.translationLangMismatch && canEdit;
  // Clicking starts a translate request when there is nothing to show in the
  // current target language; otherwise it only toggles the display.
  const needsTranslate = !data.hasTranslation || mismatchActionable;
  const togglesDisplay = data.hasTranslation && !needsTranslate;

  const translationLabel = () => {
    if (data.translating) return t('song.translating');
    if (!data.hasTranslation) {
      return targetLabel ? t('song.translateTo', { lang: targetLabel }) : t('song.translation');
    }
    if (mismatchActionable) {
      // What the click produces, not what is stored.
      return targetLabel ? t('song.translateTo', { lang: targetLabel }) : t('song.translation');
    }
    // Readers can still show/hide the stored lines; the status line above says
    // which language they are in, so no "continue translating" here.
    if (data.translationLangMismatch) return t('song.translation');
    if (data.untranslatedCount > 0) {
      return t('song.translationContinueRemain', { count: String(data.untranslatedCount) });
    }
    return t('song.translation');
  };

  const translationStatus = () => {
    if (data.translating || !data.hasTranslation) return undefined;
    if (data.translationLangMismatch) {
      // Name the language the lines on screen are actually in.
      return storedLabel ? t('song.translationCurrentLang', { lang: storedLabel }) : undefined;
    }
    if (data.untranslatedCount > 0) {
      return t('song.translationPartial', {
        done: String(data.translatedCount),
        total: String(data.translatedCount + data.untranslatedCount),
      });
    }
    return t(data.showTranslation ? 'common.on' : 'common.off');
  };

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
      label: translationLabel(),
      status: translationStatus(),
      onClick: () => {
        // Fully translated into the current target language → toggle display.
        // Untranslated / partial → start (or resume) from the cached lines.
        // Wrong language → a forced re-translate: the stored cache is in a
        // language this user no longer wants, so it must not be reused.
        if (needsTranslate) {
          void data.handleTranslate(data.translationLangMismatch);
        } else {
          data.setShowTranslation(!data.showTranslation);
        }
      },
      disabled: data.translating || (!canEdit && !data.hasTranslation),
      // A translation request can outlive the menu; close the Radix modal so
      // the completion toast (and its review action) remains focusable/clickable.
      // A plain display-mode toggle may keep the menu open.
      keepOpen: togglesDisplay,
    },
    // Force re-translate entry — after the user changes their target language
    // (or wants fresh output) the cache is no longer trusted; `force: true`
    // bypasses the server cache short-circuit entirely (issue #93). Its status
    // names the language that run would produce, so the choice is not blind.
    ...(data.hasTranslation && !data.translating ? [{
      icon: <RefreshCw className="h-3.5 w-3.5" />,
      label: t('song.reTranslate'),
      status: targetLabel ? t('song.translationTarget', { lang: targetLabel }) : undefined,
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
