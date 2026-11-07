'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import CoverImage from '@/components/CoverImage';
import { useI18n } from '@/lib/i18n';
import { createArtistAlbumMotion } from './album-motion';

export default function ArtistAlbumPanel({ title, coverUrl, count, expanded, onExpandedChange, children }: {
  title: string; coverUrl: string | null; count: number; expanded: boolean;
  onExpandedChange: (expanded: boolean) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null), body = useRef<HTMLDivElement>(null);
  const keyboardToggle = useRef(false);
  const [motion] = useState(createArtistAlbumMotion);
  // Logical disclosure state changes immediately; native content remains present
  // only for its closing animation. History continues to store the logical state.
  const [present, setPresent] = useState(expanded);
  if (expanded && !present) setPresent(true);
  useLayoutEffect(() => {
    const element = details.current, content = body.current;
    if (!element || !content) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const keyboard = keyboardToggle.current; keyboardToggle.current = false;
    const apply = () => motion.transition(element, content, expanded, preference.matches || keyboard, open => { if (!open) setPresent(false); });
    apply(); preference.addEventListener('change', apply);
    return () => preference.removeEventListener('change', apply);
  }, [motion, expanded, present, children]);
  useLayoutEffect(() => () => motion.cancel(), [motion]);
  return <details className="artist-album" ref={details} open={present} data-expanded={expanded}>
    <summary aria-expanded={expanded} aria-controls={id} onClick={event => { event.preventDefault(); keyboardToggle.current = event.detail === 0; onExpandedChange(!expanded); }}>
      <CoverImage src={coverUrl} size="md" /><span className="artist-album-copy"><span className="artist-album-title">{title}</span><span className="artists-meta">{t('home.songCount', { count })}</span></span><ChevronRight className="artist-album-chevron" size={17} aria-hidden="true" />
    </summary>
    <div className="artist-album-content" id={id} ref={body} inert={!expanded} aria-hidden={!expanded || undefined}>{children}</div>
  </details>;
}
