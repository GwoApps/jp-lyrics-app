import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ViewTransitions } from 'next-view-transitions';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: '歌詞ノート — Lyrics Note',
  description: 'Japanese lyrics management with furigana annotation and Spotify sync',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '歌詞ノート',
  },
  icons: {
    icon: [
      { url: '/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
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
    <html lang="ja">
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ViewTransitions>
          <AppShell>{children}</AppShell>
        </ViewTransitions>
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js', { scope: '/' })
                .then((reg) => {
                  console.log('[SW] registered, scope:', reg.scope);
                  // Check for updates periodically
                  reg.update();
                  setInterval(() => reg.update(), 60 * 60 * 1000); // hourly
                  // Listen for new SW installing
                  reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                      if (newWorker.state === 'activated') {
                        // Show update toast
                        const toast = document.createElement('div');
                        toast.className = 'toast toast-success';
                        toast.setAttribute('role', 'alert');
                        toast.setAttribute('aria-live', 'polite');
                        const icon = document.createElement('span');
                        icon.className = 'toast-icon';
                        icon.setAttribute('aria-hidden', 'true');
                        icon.textContent = '↻';
                        const description = document.createElement('div');
                        description.className = 'toast-description';
                        const locale = localStorage.getItem('jplrc-locale') || 'ja';
                        const updateMessages = {
                          ja: '新しいバージョンがあります — タップして更新',
                          en: 'New version available — tap to refresh',
                          'zh-CN': '有新版本可用 — 点击刷新',
                          'zh-TW': '有新版本可用 — 點擊重新整理',
                        };
                        description.textContent = updateMessages[locale] || updateMessages.ja;
                        toast.append(icon, description);
                        toast.style.cursor = 'pointer';
                        toast.style.bottom = '5.5rem';
                        toast.onclick = () => { toast.remove(); window.location.reload(); };
                        document.body.appendChild(toast);
                        setTimeout(() => toast.remove(), 15000);
                      }
                    });
                  });
                })
                .catch((err) => { console.warn('[SW] registration failed:', err); });
            });
          }
        `}} />
      </body>
    </html>
  );
}
