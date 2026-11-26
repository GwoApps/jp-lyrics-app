/**
 * First-paint lyrics for the song detail page (issue #465).
 *
 * The server layout reads the song row and passes a read-only payload through
 * this context. The client page renders it during SSR and on the first
 * hydration render, then swaps in the interactive lyrics once its fetch
 * settles. Because both renders see the same serialized value, there is no
 * hydration mismatch and no DOM surgery is needed.
 */
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SsrLyricsPayload } from '@/lib/ssr-lyrics';

const InitialLyricsContext = createContext<SsrLyricsPayload | null>(null);

export function InitialLyricsProvider({
  value,
  children,
}: {
  value: SsrLyricsPayload | null;
  children: ReactNode;
}) {
  return <InitialLyricsContext.Provider value={value}>{children}</InitialLyricsContext.Provider>;
}

export function useInitialLyrics(): SsrLyricsPayload | null {
  return useContext(InitialLyricsContext);
}

export default function InitialLyrics({ payload }: { payload: SsrLyricsPayload }) {
  if (payload.lines.length === 0) return null;
  return (
    <div className="lyrics-scroll relative z-10 p-4 sm:p-6 h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto overflow-x-hidden">
      {payload.lines.map((line, index) => (
        <div key={index} className="lyric-line leading-[2.2] sm:leading-[2.8]" lang={payload.lang}>
          {line.text}
        </div>
      ))}
      {payload.truncated && <div className="text-center text-sm text-[var(--muted-foreground)]">…</div>}
    </div>
  );
}
