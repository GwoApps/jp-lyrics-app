'use client';

import type { FuriganaLine } from '@/lib/types';
import { fmtMs } from '@/lib/lrc';

export default function FuriganaLineView({ line, isActive, debugTs }: {
  line: FuriganaLine;
  isActive: boolean;
  debugTs?: number | null;
}) {
  if (line.segments.length === 0) return <div className="h-5 sm:h-6" />;
  return (
    <div className="flex items-baseline gap-2 sm:gap-3">
      {debugTs != null && (
        <span className="shrink-0 w-[60px] sm:w-[72px] text-right font-mono text-[10px] text-[var(--primary)] opacity-70 tabular-nums">
          {fmtMs(debugTs)}
        </span>
      )}
      <div className={`leading-[2.2] sm:leading-[2.8] transition-all duration-300 ${isActive ? 'text-white scale-[1.02] origin-left' : 'text-[var(--muted-foreground)] opacity-60'}`}>
        {line.segments.map((seg, i) => {
          if (!seg.reading) return <span key={i}>{seg.text}</span>;
          return (
            <ruby key={i}>{seg.text}<rp>(</rp><rt>{seg.reading}</rt><rp>)</rp></ruby>
          );
        })}
      </div>
    </div>
  );
}
