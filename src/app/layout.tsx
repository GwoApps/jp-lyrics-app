import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ViewTransitions } from '@/components/navigation/ViewTransitions';
import AppShell from '@/components/AppShell';
import { APP_ICON_REVISION } from '@/lib/app-icon';
import { APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION } from '@/lib/app-identity';
import GoogleFontsStylesheet from '@/components/GoogleFontsStylesheet';

/**
 * Language-neutral shell metadata. The active locale lives in `localStorage`,
 * which the server never sees, so naming the app in one language here would
 * show that language to everyone. `AppMetadataSync` swaps in `common.appName`
 * right after hydration (issue #273); `public/manifest.json` carries the same
 * neutral name for install surfaces.
 */
export const metadata: Metadata = {
  title: APP_NAME_NEUTRAL,
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
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
          <AppShell>{children}</AppShell>
        </ViewTransitions>
      </body>
    </html>
  );
}
