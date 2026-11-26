'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { sourceLyricsLang } from '@/lib/lyrics-reading';
import { resolveTranslationLang } from '@/lib/target-lang';
import {
  fontFamiliesForLocale,
  fontFamiliesForTags,
  googleFontsHref,
  type GoogleFontFamily,
} from '@/lib/font-families';

const LINK_ID = 'google-fonts-stylesheet';

/**
 * `media="print"` keeps the Google Fonts sheet off the render-blocking path:
 * it is still fetched, just without holding the first paint hostage. The host
 * is unreachable on many mainland networks (issue #409 measured 20 s of blank
 * page), and every family already declares a system fallback, so waiting for it
 * buys no correctness. Once the sheet settles the inline script promotes it to
 * `media="all"`, which is what makes reachable fonts lay out exactly as before.
 *
 * The promotion is a 6-line inline script rather than an effect so it runs on
 * parse, not after hydration — a sheet that finishes loading first still gets
 * promoted without waiting for React.
 *
 * Issue #466: the server starts with the locale-derived families; after the
 * song loads the client adds whatever languages are actually on screen (source,
 * translation, readings) so no reachable font is left on a system fallback.
 * Google Fonts CSS is cached per URL, so switching between songs reuses sheets.
 */
export default function GoogleFontsStylesheet({ locale }: { locale: string }) {
  const [extraFamilies, setExtraFamilies] = useState<readonly GoogleFontFamily[]>([]);
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();

  useEffect(() => {
    const match = pathname?.match(/^\/songs\/[^/]+(?:\/(?:share|edit|furigana\/edit|translation\/edit|timeline\/edit))?\/?$/);
    const id = typeof params?.id === 'string' ? params.id : '';
    if (!match || !id) return;

    let cancelled = false;
    fetch(`/api/songs/${id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((song: { reading_scheme?: unknown; lyrics_translation_lang?: string | null } | null) => {
        if (cancelled || !song) return;
        const tags = [sourceLyricsLang(song.reading_scheme), resolveTranslationLang(song.lyrics_translation_lang)];
        setExtraFamilies([...fontFamiliesForTags(tags)]);
      })
      .catch(() => { /* song fetch will fail on its own; keep locale-only fonts */ });
    return () => { cancelled = true; };
  }, [pathname, params?.id]);

  const families = new Set<GoogleFontFamily>([
    ...fontFamiliesForLocale(locale),
    ...extraFamilies,
  ]);
  const href = googleFontsHref(families);

  if (!href) return null;

  return (
    <>
      <link id={LINK_ID} rel="stylesheet" href={href} media="print" />
      {/* No JS: keep the blocking link, the old behaviour. */}
      <noscript>
        <link rel="stylesheet" href={href} />
      </noscript>
      <script
        dangerouslySetInnerHTML={{
          __html: `
          (function() {
            var link = document.getElementById('${LINK_ID}');
            if (!link) return;
            var promote = function() { link.media = 'all'; };
            if (link.sheet) promote();
            else link.addEventListener('load', promote);
          })();
        `,
        }}
      />
    </>
  );
}
