# 歌詞ノート (Kashi Note)

日本語歌詞の录入・ふりがな付き表示・Spotify 同期再生対応の歌詞管理 Web アプリ。

[English](README.md) | [中文](README-zh.md)

## 機能

- **歌詞录入** — 漢字を含む日本語歌詞を貼り付けると、保存時に kuroshiro で自動的にひらがな（ふりがな）に変換
- **ふりがな表示** — `<ruby>` タグで漢字の上にふりがなを表示。フォントサイズ調整対応（12〜28px）
- **Spotify 同期** — Spotify OAuth 連携で再生中の曲をリアルタイム追跡。歌詞行が自動スクロール
- **lrclib.net 同期** — lrclib.net からタイムスタンプ付き歌詞を取得し、行ごとに精确同期
- **ワンクリック取込** — 再生中の曲が未登録の場合、lrclib から歌詞を取得して DB に保存し、即座に詳細ページへ遷移
- **モバイル対応** — レスポンシブ UI。モバイルでボタンがアイコンのみ表示、レイアウト自動調整

## 技術スタック

| 層 | 技術 |
|---|---|
| フレームワーク | Next.js 14 (App Router) |
| UI | React 19, Tailwind CSS, Lucide Icons |
| DB | SQLite (better-sqlite3) |
| ふりがな変換 | kuroshiro + kuromoji |
| 歌詞データソース | lrclib.net (優先), Spotify unofficial API |
| 音楽連携 | Spotify Web API (OAuth 2.0) |
| デプロイ | Docker, Traefik リバースプロキシ |

## プロジェクト構成

```
src/
├── app/
│   ├── page.tsx                    # 一覧ページ（Now Playing バー付き）
│   ├── layout.tsx                  # レイアウト（ナビゲーションバー）
│   ├── globals.css                 # グローバルスタイル
│   ├── songs/
│   │   ├── new/page.tsx            # 新規追加ページ
│   │   └── [id]/
│   │       ├── page.tsx            # 歌詞詳細ページ（Spotify 同期・Debug モード）
│   │       └── edit/page.tsx       # 編集ページ
│   └── api/
│       ├── songs/
│       │   ├── route.ts            # GET: 一覧, POST: 新規作成
│       │   ├── import/route.ts     # POST: lrclib からワンクリック取込
│       │   └── [id]/
│       │       ├── route.ts        # GET/PUT/DELETE: 個別曲操作
│       │       └── sync/route.ts   # POST: lrclib 同期歌詞取得
│       ├── auth/
│       │   ├── login/route.ts      # Spotify OAuth ログイン
│       │   └── callback/route.ts   # Spotify OAuth コールバック
│       └── spotify/
│           ├── now-playing/route.ts # 現在再生中の曲情報
│           └── status/route.ts     # Spotify 連携状態
└── lib/
    ├── db.ts                       # SQLite DB 接続・スキーマ定義
    ├── kuroshiro.ts                # ふりがな変換ロジック
    ├── spotify.ts                  # Spotify API クライアント ID/Secret
    └── types.ts                    # 共通型定義
```

## ローカル開発

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev
# → http://localhost:3000

# ビルド
npm run build
```

### 環境変数

`.env` ファイルに以下を設定:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=*** Developer Dashboard でアプリを作成し、リダイレクト URI を `http://localhost:3000/api/auth/callback` に設定。

## Docker デプロイ

```bash
# ビルド＆起動
docker compose up -d --build

# ログ確認
docker compose logs -f
```

`docker-compose.yml` で Traefik リバースプロキシ経由での公開を想定。`kazusa-auth` ミドルウェアで認証保護。

## 主な API

| エンドポイント | メソッド | 説明 |
|---|---|---|
| `/api/songs` | GET | 全曲一覧 |
| `/api/songs` | POST | 新規作成（歌詞 → ふりがな自動変換） |
| `/api/songs/import` | POST | lrclib からワンクリック取込 |
| `/api/songs/[id]` | GET | 曲詳細 |
| `/api/songs/[id]` | PUT | 曲更新 |
| `/api/songs/[id]` | DELETE | 曲削除 |
| `/api/songs/[id]/sync` | POST | 同期歌詞取得（lrclib → Spotify fallback） |
| `/api/auth/login` | GET | Spotify OAuth ログイン |
| `/api/spotify/now-playing` | GET | 現在再生中の曲情報 |

## ライセンス

Private
