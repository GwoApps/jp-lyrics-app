'use client';

import { Music } from 'lucide-react';
import { useState } from 'react';

interface CoverImageProps {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  placeholderClassName?: string;
  viewTransitionName?: string;
}

interface LoadState {
  loaded: boolean;
  error: boolean;
}

const sizeMap = {
  sm: 'h-9 w-9 sm:h-10 sm:w-10 rounded-md',
  md: 'h-16 w-16 sm:h-20 sm:w-20 rounded-xl',
  lg: 'h-24 w-24 sm:h-32 sm:w-32 rounded-xl',
};

/**
 * Load state for a cover URL, derived from the URL itself rather than mutated
 * over the component's lifetime. A failed load must not outlive the URL that
 * failed: callers hand over a stale cached URL first and the server's fresh
 * URL afterwards (detail page, list refresh), so the new URL has to be retried
 * even though this component instance is reused. Tracking the URL the state
 * belongs to keeps that reset tied to render instead of an effect, and makes a
 * URL change equivalent to a clean remount — no flash of a stale "loaded" flag.
 */
export function coverImageState(
  state: LoadState,
  url: string | null | undefined,
  lastUrl: string | null | undefined,
): LoadState {
  if (url === lastUrl) return state;
  return { loaded: false, error: false };
}

export default function CoverImage({
  src,
  alt = '',
  size = 'md',
  className = '',
  placeholderClassName = '',
  viewTransitionName,
}: CoverImageProps) {
  const url = src || null;
  const [state, setState] = useState<LoadState>({ loaded: false, error: false });
  const [lastUrl, setLastUrl] = useState<string | null>(url);
  const { loaded, error } = coverImageState(state, url, lastUrl);
  if (url !== lastUrl) setLastUrl(url);

  const showImage = !!url && !error;
  const hidden = !loaded || !showImage;

  return (
    <div
      style={{ ['--vt-name' as string]: viewTransitionName }}
      className={`relative shrink-0 overflow-hidden bg-[var(--muted)] flex items-center justify-center cover-transition ${sizeMap[size]} ${className}`}
    >
      <Music
        className={`absolute h-5 w-5 text-[var(--muted-foreground)]/40 transition-opacity duration-300 ${hidden ? 'opacity-100' : 'opacity-0'} ${placeholderClassName}`}
      />
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt={alt}
          onLoad={() => setState({ loaded: true, error: false })}
          onError={() => setState({ loaded: false, error: true })}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
