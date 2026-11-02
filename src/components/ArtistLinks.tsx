'use client';

import { Fragment } from 'react';
import { Link } from '@/components/navigation/ViewTransitions';
import { artistHref, splitArtists } from '@/lib/artists';

interface ArtistLinksProps {
  artist?: string | null;
  fallback?: string;
  className?: string;
}

/** Shared artist credits: each comma-delimited name is its own real, keyboard-accessible link. */
export default function ArtistLinks({ artist, fallback = '', className = '' }: ArtistLinksProps) {
  const names = splitArtists(artist);
  return (
    <span className={className}>
      {names.length === 0 ? fallback : names.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ', '}
          <Link
            href={artistHref(name)}
            className="rounded-sm hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}
