'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Brain, CircleAlert, Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface TranslationStatusOverlayProps {
  translating: boolean;
  translationProgress: { done: number; total: number } | null;
  translationError: string | null;
  translationReasoning: string;
  showTranslationReasoning: boolean;
  onToggleReasoning: () => void;
  onDismissError: () => void;
  onContinue: () => void;
}

/**
 * Fixed viewport-level translation status: progress bubble, the
 * "view reasoning" toggle and the Apple-style reasoning panel with its
 * flowing color edge, blink cursor and follow-scroll ("back to bottom").
 * Deliberately rendered at the page root so the lyrics panel's
 * overflow/transform cannot clip or reposition it.
 */
export default function TranslationStatusOverlay({
  translating,
  translationProgress,
  translationError,
  translationReasoning,
  showTranslationReasoning,
  onToggleReasoning,
  onDismissError,
  onContinue,
}: TranslationStatusOverlayProps) {
  const { t } = useI18n();
  const reasoningScrollRef = useRef<HTMLDivElement>(null);
  const [reasoningFollow, setReasoningFollow] = useState(true);

  // Follow the latest streamed chunk unless the user scrolled up to read
  // earlier output (a "back to bottom" button appears in that case).
  useEffect(() => {
    if (!reasoningFollow) return;
    const el = reasoningScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [translationReasoning, reasoningFollow]);

  const handleReasoningScroll = () => {
    const el = reasoningScrollRef.current;
    if (!el) return;
    setReasoningFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const scrollReasoningToBottom = () => {
    const el = reasoningScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setReasoningFollow(true);
  };

  const visible = translating || translationError
    || (translationProgress && translationProgress.done < translationProgress.total);
  if (!visible) return null;

  return (
    <div className="fixed left-1/2 top-3 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
      {translating ? (
        <>
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)]/90 px-3 py-1.5 text-xs text-[var(--muted-foreground)] shadow-sm backdrop-blur-sm">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--primary)]" />
            {translationProgress
              ? t('song.translatingProgress', { done: translationProgress.done, total: translationProgress.total })
              : t('song.translating')}
          </span>
          {translationReasoning && (
            <button
              type="button"
              onClick={onToggleReasoning}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)]/90 px-2.5 py-1 text-[11px] font-medium text-[var(--primary)] shadow-sm backdrop-blur-sm hover:bg-[var(--primary)]/10"
            >
              <Brain className="h-3 w-3" />
              {showTranslationReasoning ? t('song.translationReasoningHide') : t('song.translationReasoningShow')}
            </button>
          )}
          {showTranslationReasoning && translationReasoning && (
            <div className="reasoning-glow-wrap w-[min(94vw,560px)]">
              <div aria-hidden="true" className="reasoning-glow-aura">
                <div className="reasoning-glow-ring">
                  <div className="reasoning-glow-spin" />
                </div>
              </div>
              <div className="reasoning-glow w-full overflow-hidden rounded-xl">
              <div className="relative rounded-[11px] bg-[var(--card)]/95 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 border-b border-[var(--border)]/60 px-3 py-2 text-[11px] font-medium text-[var(--muted-foreground)]">
                  <Brain className="h-3 w-3 text-[var(--primary)]" />
                  {t('song.translationReasoning')}
                </div>
                <div className="px-1.5">
                  <div
                    ref={reasoningScrollRef}
                    onScroll={handleReasoningScroll}
                    className="reasoning-scroll max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words p-3 pr-4 font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]"
                  >
                  {translationReasoning}
                  {translating && <span className="reasoning-cursor" />}
                  </div>
                </div>
                {!reasoningFollow && (
                  <button
                    type="button"
                    onClick={scrollReasoningToBottom}
                    className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--background)]/95 px-2 py-1 text-[10px] font-medium text-[var(--primary)] shadow-sm backdrop-blur-sm hover:bg-[var(--primary)]/10"
                  >
                    <ArrowDown className="h-3 w-3" />
                    {t('song.translationReasoningBottom')}
                  </button>
                )}
              </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--warning)]/40 bg-[var(--background)]/90 px-3 py-1.5 text-xs text-[var(--warning)] shadow-sm backdrop-blur-sm">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[200px] sm:max-w-[320px] truncate">
            {translationError
              ?? (translationProgress
                ? t('song.translatingProgress', { done: translationProgress.done, total: translationProgress.total })
                : '')}
          </span>
          {translationProgress && translationProgress.done < translationProgress.total && (
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full border border-[var(--warning)]/40 px-2 py-0.5 font-medium text-[var(--warning)] hover:bg-[var(--warning)]/10"
            >
              {t('song.translationContinue')}
            </button>
          )}
          <button
            type="button"
            onClick={onDismissError}
            aria-label={t('common.close')}
            className="rounded-full p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}
