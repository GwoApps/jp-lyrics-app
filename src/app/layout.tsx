import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '歌詞ノート — 歌詞管理',
  description: '日本語歌詞の录入・ふりがな付き表示',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Top nav */}
        <nav className="sticky top-0 z-50 border-b border-border bg-[var(--background)]/80 backdrop-blur-sm">
          <div className="mx-auto flex h-10 max-w-[960px] items-center px-4">
            <a href="/" className="whitespace-nowrap text-sm font-bold tracking-tight text-[var(--primary)]">
              歌詞ノート
            </a>
            <span className="ml-2 text-xs text-[var(--muted-foreground)] hidden sm:inline">
              歌詞管理ツール
            </span>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <a
                href="/"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                一覧
              </a>
              <a
                href="/songs/new"
                className="rounded-md px-2.5 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                新規追加
              </a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-[960px] px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
