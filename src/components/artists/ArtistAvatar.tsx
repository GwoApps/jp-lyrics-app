'use client';

import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import Image from 'next/image';
import { requestArtistProfile } from './profile-queue';

/** Artist portraits only. Never substitute a track/album cover for an artist. */
export function ArtistAvatar(props: { name: string; imageUrl?: string | null; large?: boolean }) {
  // URL identity owns loading/error state, including cached images and URL swaps.
  return <ArtistPortrait key={props.imageUrl || ''} {...props} />;
}

function ArtistPortrait({ name, imageUrl, large = false }: {
  name: string;
  imageUrl?: string | null;
  large?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  return (
    <span className={`artist-avatar${large ? ' artist-avatar--large' : ''}`} data-state={state} aria-hidden="true" title={name}>
      <UserRound className="artist-avatar-fallback" />
      {imageUrl && state !== 'error' && (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={large ? '(min-width: 640px) 128px, 96px' : '(min-width: 640px) 104px, 92px'}
          unoptimized
          loading="lazy"
          className="artist-avatar-portrait"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
    </span>
  );
}

export default function LazyArtistAvatar({ name }: { name: string }) {
  const target = useRef<HTMLSpanElement>(null);
  const [portrait, setPortrait] = useState<{ name: string; imageUrl: string | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void requestArtistProfile(name, controller.signal)
        .then((profile) => {
          if (!controller.signal.aborted) setPortrait({ name, imageUrl: profile.imageUrl });
        })
        .catch(() => { /* Optional portraits never block the local library. */ });
    };
    const element = target.current;
    let observer: IntersectionObserver | undefined;
    if (element && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      }, { rootMargin: '160px' });
      observer.observe(element);
    } else {
      load();
    }
    return () => {
      observer?.disconnect();
      controller.abort();
    };
  }, [name]);

  return <span ref={target} className="artist-avatar-target"><ArtistAvatar name={name} imageUrl={portrait?.name === name ? portrait.imageUrl : null} /></span>;
}
