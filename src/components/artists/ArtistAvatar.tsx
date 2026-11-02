'use client';

import { useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { requestArtistProfile } from './profile-queue';

/** Artist portraits only. Never substitute a track/album cover for an artist. */
export function ArtistAvatar({ name, imageUrl, large = false }: {
  name: string;
  imageUrl?: string | null;
  large?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const source = imageUrl && failedUrl !== imageUrl ? imageUrl : null;
  return (
    <span className={`artist-avatar${large ? ' artist-avatar--large' : ''}`} aria-hidden="true" title={name}>
      <UserRound className="artist-avatar-fallback" />
      {source && (
        // Profile URLs are optional remote images; Next's optimizer cannot assume a host.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(source)} />
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
