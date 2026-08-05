# 歌詞ノート

ふりがな表示・AI 翻訳・Spotify リアルタイム同期・実験パネル（歌詞ドットグリッド上のマイクスペクトラム）・PWA 対応の日本語歌詞管理 Web アプリ。

[English](README.md) | [中文](README-zh.md) | [機能一覧](FEATURES.md) | [Deploy Guide](DEPLOYMENT.md)

## 機能

ふりがな・AI 翻訳・Spotify 連動の自動スクロールを備えた日本語歌詞リーダー：

- ふりがな表示、読み方モード（ふりがな / ローマ字）、フォントサイズ調整
- AI 歌詞翻訳：SSE ストリーミング + ライブ思考パネル + プラグイン可能な LLM プロバイダ
- Spotify リアルタイム同期（SSE またはポーリング）+ 行ごとのイージング自動スクロール
- タイムライン注釈ワークスペース：再生位置に合わせて行ごとにマーク
- シェアカード生成（QR + 選択行 → PNG）、管理コンソール
- PWA、ダーク/ライトテーマ、4言語 UI、お気に入り＆コレクション

詳細は **[FEATURES.md](FEATURES.md)** を参照してください。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フレームワーク | Next.js 16（App Router） |
| UI | React 19、Tailwind CSS v4、Lucide Icons |
| データベース | Drizzle ORM + @libsql/client（Turso、ローカル SQLite、Cloudflare D1） |
| ふりがなエンジン | kuromoji-es（ブラウザ CDN、遅延読み込み） |
| 歌詞ソース | lrclib.net |
| 音楽連携 | Spotify Web API（OAuth 2.0）+ SSE / クライアントポーリング |
| 翻訳 | OpenAI 互換 / Anthropic / Workers AI（SSE ストリーミング） |
| 音声（実験） | Web Audio API（AnalyserNode、getUserMedia） |
| デプロイ | Docker（セルフホスト）、Cloudflare Workers、Vercel Edge |

## クイックスタート

```bash
git clone https://github.com/GwoApps/jp-lyrics-app.git
cd jp-lyrics-app
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000
```

### 環境変数

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | いいえ | Spotify クライアント ID |
| `SPOTIFY_CLIENT_SECRET` | いいえ | Spotify クライアントシークレット |
| `SPOTIFY_REDIRECT_URI` | いいえ | コールバック URL を上書き（デフォルト：リクエスト元 + `/api/auth/callback`） |
| `SPOTIFY_POLL_MODE` | いいえ | `client`（デフォルト）または `server`。[DEPLOYMENT.md](DEPLOYMENT.md) 参照 |
| `TURSO_URL` | いいえ | Turso データベース URL（例 `libsql://xxx.turso.io`）。未設定ならローカル SQLite にフォールバック。CF D1 は binding を使用 |
| `TURSO_AUTH_TOKEN` | いいえ | Turso 認証トークン（`TURSO_URL` 設定時に必須） |
| `TRANSLATION_PROVIDER` | いいえ | `openai`（デフォルト、OpenAI 互換）または `anthropic`（Anthropic Messages API） |
| `TRANSLATION_BASE_URL` | いいえ | OpenAI 互換 API のベース URL（デフォルト `https://api.deepseek.com/v1`） |
| `TRANSLATION_API_KEY` | いいえ | LLM API キー（未設定なら `DEEPSEEK_API_KEY` にフォールバック） |
| `TRANSLATION_MODEL` | いいえ | モデル名（デフォルト `deepseek-v4-flash`） |
| `TRANSLATION_TARGET_LANG` | いいえ | デフォルトの翻訳先言語（デフォルト `zh-CN`） |
| `AI_DAILY_NEURON_LIMIT` | いいえ | 1日の翻訳クォータ（トークン）。超過時は `429 / ai_quota_exceeded` |
| `JPLRC_LOGIN_PASSPHRASE_REQUIRED` | いいえ | Spotify OAuth 開始前にパスフレーズを要求するか |
| `JPLRC_LOGIN_PASSPHRASE` | いいえ | パスフレーズ本体（サーバー側でのみ検証） |
| `SESSION_SECRET` | いいえ | 本番推奨：ログイン/セッション Cookie を独立に署名 |

Spotify 連携はオプションです。設定しなくても歌詞の管理は可能です。

[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリを作成し、リダイレクト URI を `http://localhost:3000/api/auth/callback` に設定してください。

## Docker デプロイ

```bash
docker compose up -d --build
```

詳細（Docker / Cloudflare Workers / Vercel）は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。

## プロジェクト構造

```
src/
├── app/
│   ├── page.tsx                          # 曲一覧：検索、フィルター、再生中
│   ├── admin/page.tsx                    # 管理コンソール（ユーザー/曲/承認待ち/翻訳）
│   ├── songs/
│   │   ├── new/page.tsx                  # 曲作成
│   │   └── [id]/
│   │       ├── page.tsx                  # 歌詞詳細（Spotify 同期、ドットグリッド、メニュー、PiP）
│   │       ├── edit/page.tsx             # 曲編集
│   │       ├── translation/page.tsx      # 全曲翻訳ワークスペース
│   │       ├── share/page.tsx            # シェアカード生成（描画は lib/share-card.ts）
│   │       └── timeline/edit/page.tsx    # タイムライン注釈ワークスペース
│   └── api/                              # songs / collections / admin / auth / spotify / me
├── components/
│   ├── home/                             # SongFilterBar、CollectionsPanel、PlaylistImportDialog
│   ├── song/                             # ToolbarMenu、MobileMenu（メニュー項目と型）
│   ├── admin/                            # AdminTabs、AdminUserList、AdminSongList、AdminPendingList、BlockUserDialog、TranslationConfigPanel、admin-types
│   ├── timeline/                         # SpotifyStatusCard、OffsetControls、MarkCurrentLineCard、TimelineLineRow
│   ├── LyricsDotGrid.tsx                 # ドットマトリクス Canvas（スポットライト + マイクスペクトラム）
│   ├── ExperimentsPanel.tsx              # 実験：マイクスペクトラムのトグル
│   ├── TranslationStatusOverlay.tsx      # 翻訳進捗バブル + 思考パネル
│   └── ui/                               # 小さなプリミティブ
├── hooks/                                # useSongData / useSpotifySync / useNowPlaying / useSpectrumCapture / useCoverPalette
├── lib/
│   ├── translation/                      # config / prompts / parse / index（プロバイダ + ストリーミング）
│   ├── translation-stream.ts             # /translate 用クライアント SSE リーダー
│   ├── translation-errors.ts             # エラーコード → i18n キー
│   ├── share-card.ts                     # シェアカード用純粋 Canvas 描画
│   ├── scroll-ease.ts                    # Apple 風イージングスクロール
│   ├── lrc.ts / match.ts / romaji.ts / lyrics-fetcher.ts
│   ├── cover-color.ts / cover-store.ts   # カバー配色 + R2/blob ストレージ
│   ├── ai-usage.ts                       # 1日の翻訳クォータ
│   └── theme.tsx / i18n.tsx / types.ts
└── i18n/                                 # ja / en / zh-CN / zh-TW
```

## ライセンス

[MIT](LICENSE)
