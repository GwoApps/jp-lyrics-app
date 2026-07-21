'use client';

import { useRef, useEffect, useState } from 'react';
import { Copy, Languages, Share2 } from 'lucide-react';
import type { FuriganaLine, ReadingMode } from '@/lib/types';
import { fmtMs } from '@/lib/lrc';
import { romanizeJapanese } from '@/lib/romaji';
import { useI18n } from '@/lib/i18n';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export default function FuriganaLineView({
  line,
  isActive,
  debugTs,
  timestamp,
  onSeek,
  onCopyLine,
  onShareLine,
  onCorrectFurigana,
  canCorrectFurigana = true,
  readingMode = 'furigana',
}: {
  line: FuriganaLine;
  isActive: boolean;
  debugTs?: number | null;
  timestamp?: number | null;
  onSeek?: (positionMs: number) => void;
  onCopyLine?: () => void;
  onShareLine?: () => void;
  onCorrectFurigana?: () => void;
  canCorrectFurigana?: boolean;
  readingMode?: ReadingMode;
}) {
  const { t } = useI18n();
  const [animKey, setAnimKey] = useState(0);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      setAnimKey(k => k + 1);
    }
    wasActiveRef.current = isActive;
  }, [isActive]);

  if (line.segments.length === 0) return <div className="h-5 sm:h-6" />;

  const lineContent = (
    <div
      className={`lyric-line-context-trigger flex items-baseline gap-2 sm:gap-3 ${onSeek && timestamp != null ? 'cursor-pointer' : ''}`}
      onClick={onSeek && timestamp != null ? () => onSeek(timestamp) : undefined}
    >
      {debugTs != null && (
        <span className="shrink-0 w-[60px] sm:w-[72px] text-right font-mono text-[10px] text-[var(--primary)] opacity-70 tabular-nums">
          {fmtMs(debugTs)}
        </span>
      )}
      <div
        key={animKey}
        className={`lyric-line leading-[2.2] sm:leading-[2.8] transition-all duration-300 ${
          isActive
            ? 'lyric-line--active scale-[1.03] origin-left lyric-active'
            : ''
        } ${onSeek && timestamp != null ? 'hover:!opacity-100' : ''}`}
        style={{ fontWeight: isActive ? 700 : 400 }}
      >
        {line.segments.map((seg, i) => {
          if (readingMode === 'original') return <span key={i}>{seg.text}</span>;
          if (readingMode === 'furigana' && !seg.reading) return <span key={i}>{seg.text}</span>;
          const reading = readingMode === 'romaji'
            ? romanizeJapanese(seg.reading || seg.text)
            : seg.reading;
          if (!reading || reading === seg.text) return <span key={i}>{seg.text}</span>;
          return (
            <ruby key={i}>{seg.text}<rp>(</rp><rt lang={readingMode === 'romaji' ? 'en' : 'ja'}>{reading}</rt><rp>)</rp></ruby>
          );
        })}
      </div>
    </div>
  );

  if (!onCopyLine || !onShareLine || !onCorrectFurigana) return lineContent;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{lineContent}</ContextMenuTrigger>
      <ContextMenuContent aria-label={t('song.more')}>
        <ContextMenuItem onSelect={onCopyLine}>
          <Copy className="h-3.5 w-3.5" />
          {t('song.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onShareLine}>
          <Share2 className="h-3.5 w-3.5" />
          {t('song.share')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCorrectFurigana} disabled={!canCorrectFurigana}>
          <Languages className="h-3.5 w-3.5" />
          {t('furigana.title')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
