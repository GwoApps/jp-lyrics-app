const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+TC:wght@400;500;700&display=swap';

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
 */
export default function GoogleFontsStylesheet() {
  return (
    <>
      <link id={LINK_ID} rel="stylesheet" href={GOOGLE_FONTS_HREF} media="print" />
      {/* No JS: keep the blocking link, the old behaviour. */}
      <noscript>
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
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
