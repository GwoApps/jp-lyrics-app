import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { ViewTransitions } from '@/components/navigation/ViewTransitions';
import AppShell from '@/components/AppShell';
import { APP_ICON_REVISION } from '@/lib/app-icon';
import { APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION } from '@/lib/app-identity';
import GoogleFontsStylesheet from '@/components/GoogleFontsStylesheet';
import { asLocale, LOCALE_COOKIE, localeFromLanguages, type Locale } from '@/lib/locale';

/**
 * Language-neutral shell metadata. `metadata` cannot await the request, so it
 * names the app in one language and `AppMetadataSync` swaps in
 * `common.appName` right after hydration (issue #273); `public/manifest.json`
 * carries the same neutral name for install surfaces. `metadataBase` comes
 * from the deployment env when set (issue #464); song routes additionally
 * absolute-ize their URLs from the request host so no page depends on it.
 */
// Deployment origin for statically-resolved relative metadata URLs (issue #464).
// Song pages additionally derive a per-request origin via `resolveSiteOrigin()`.
const configuredOrigin = (() => {
  const value = process.env.JPLRC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch { return null; }
})();

export const metadata: Metadata = {
  ...(configuredOrigin ? { metadataBase: configuredOrigin } : {}),
  title: { default: APP_NAME_NEUTRAL, template: `%s · ${APP_NAME_SHORT}` },
  description: APP_DESCRIPTION,
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: APP_NAME_SHORT,
  },
  icons: {
    icon: [
      { url: `/icon.svg?v=${APP_ICON_REVISION}`, sizes: 'any', type: 'image/svg+xml' },
      { url: `/icon-16x16.png?v=${APP_ICON_REVISION}`, sizes: '16x16', type: 'image/png' },
      { url: `/icon-32x32.png?v=${APP_ICON_REVISION}`, sizes: '32x32', type: 'image/png' },
    ],
    shortcut: `/favicon.ico?v=${APP_ICON_REVISION}`,
    apple: [{ url: `/apple-touch-icon.png?v=${APP_ICON_REVISION}`, sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

/**
 * Origin used to turn relative OG paths into absolute URLs (issue #464).
 *
 * Prefer the configured deployment URL so reverse proxies and multi-domain
 * setups agree on one canonical origin. Otherwise use the request's own host
 * header (the layout already reads `headers()` for the locale), so a container
 * never falls back to `http://localhost:3000`.
 */
export async function resolveSiteOrigin(): Promise<string | null> {
  if (configuredOrigin) return configuredOrigin.origin;
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  if (!host) return null;
  const proto = headerStore.get('x-forwarded-proto') === 'http' ? 'http:' : 'https:';
  try {
    return new URL(`${proto}//${host}`).origin;
  } catch { return null; }
}

/**
 * The reader's locale for this request (issue #419). Reading it on the server is
 * what lets the first byte carry real text; without it the tree had to stay
 * empty until hydration, so every cold start began with a blank page.
 *
 * - `jplrc-locale` cookie: the reader's own choice, mirrored there by
 *   `I18nProvider` so a *second* visit never has to guess.
 * - `Accept-Language`: the browser's preference, used for the first visit —
 *   it is exactly what `navigator.languages` would have reported client-side,
 *   so the server and `I18nProvider`'s reconciler agree and there is no flash.
 *
 * Reading cookies/headers opts the route into dynamic rendering. That is
 * already true for every song route (they read the session), the shell is cheap
 * to render, and the service worker keeps navigations network-first — so the
 * trade is a per-request HTML render for a first paint that has content in it.
 */
async function readRequestLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const chosen = cookieStore.get(LOCALE_COOKIE)?.value;
  if (chosen && asLocale(chosen) === chosen) return asLocale(chosen);
  return localeFromLanguages(parseAcceptLanguage(headerStore.get('accept-language')));
}

/**
 * `Accept-Language` → tags in preference order, dropping the `;q=` weights.
 * Good enough for picking among four languages; a full q-sort would not change
 * the answer for any real browser request.
 */
/** Shared by song layouts: same cookie/Accept-Language precedence as the shell. */
export async function readRequestLocaleForMetadata(): Promise<Locale> {
  return readRequestLocale();
}

function parseAcceptLanguage(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await readRequestLocale();
  return (
    <html lang={locale}>
      <head>
        <meta name="theme-color" content="#0a0a0a" id="theme-color-meta" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var t = localStorage.getItem('jplrc-theme');
            var dark = t === 'light' ? false : true;
            if (t !== 'light' && t !== 'dark') {
              dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
            var meta = document.getElementById('theme-color-meta');
            if (meta) meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
          })();
        `}} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <GoogleFontsStylesheet />
      </head>
      <body>
        <ViewTransitions>
          <AppShell initialLocale={locale}>{children}</AppShell>
        </ViewTransitions>
      </body>
    </html>
  );
}
