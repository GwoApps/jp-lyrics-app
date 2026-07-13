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

const sizeMap = {
  sm: 'h-9 w-9 sm:h-10 sm:w-10 rounded-md',
  md: 'h-16 w-16 sm:h-20 sm:w-20 rounded-xl',
  lg: 'h-24 w-24 sm:h-32 sm:w-32 rounded-xl',
};

export default function CoverImage({
  src,
  alt = '',
  size = 'md',
  className = '',
  placeholderClassName = '',
  viewTransitionName,
}: CoverImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const showImage = src && !error;
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
          key={src}
          src={src}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
