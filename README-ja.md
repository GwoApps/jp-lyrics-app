# 歌詞ノート

ふりがな表示・AI 翻訳・Spotify リアルタイム同期・実験パネル（歌詞ドットグリッド上のマイクスペクトラム）・PWA 対応の日本語歌詞管理 Web アプリ。

[English](README.md) | [中文](README-zh.md) | [Deploy Guide](DEPLOYMENT.md)

## 機能

- **ふりがな歌詞** — 日本語歌詞を貼り付けると、くろしろが漢字をひらがなに自動変換し `<ruby>` で表示
- **AI 歌詞翻訳** — SSE ストリーミングで対象言語に翻訳。ライブ思考パネル、用語集の自動抽出、リトライ・クォータ処理、プラグイン可能なプロバイダ（OpenAI 互換 / Anthropic Messages / Cloudflare Workers AI）
- **Spotify リアルタイム同期** — OAuth 連携による再生トラッキング、SSE ストリーミングまたはクライアントポーリング、行ごと自動スクロール（Apple 風イージング）
- **タイムライン注釈ワークスペース** — Spotify の現在位置に合わせて未設定の歌詞を行ごとに注釈し、途中保存・再生確認・取り消し・全体オフセットに対応
- **歌詞ドットグリッド** — Canvas ドットマトリクス背景＋ポインタースポットライト。**実験パネル**でリアルタイムマイクスペクトラムを追加でき、グリッド最下段の点が発光（Web Audio API、波の頂点はパネル高さの 1/3 以下）
- **シェアカード** — 横/縦・QR コード・歌詞行選択に対応した Canvas 画像を生成し PNG でダウンロード
- **管理コンソール** — `/admin`：ユーザー管理（昇格/降格、ブロック/解除、削除）、歌詞の公開制御、公開承認待ちキュー、翻訳サービスのライブ設定と接続テスト
- **読み方表示モード** — 原文・ふりがな・ヘボン式ローマ字を切り替え、設定を端末に保存
- **Spotify 正規化メタデータ** — Track ID、URI、アルバム、再生時間、カバー、正規タイトル・アーティストを保存して厳密に照合
- **歌詞の出典と信頼度** — 採用した歌詞ソース、ヒューリスティックな一致信頼度、取得日時を記録
- **PiP（ピクチャーインピクチャー）** — 他のアプリの上に浮動歌詞ウィンドウを表示（デスクトップ Chrome）
- **PWA** — Android/iOS でインストール可能、オフラインキャッシュ・更新通知対応
- **ダーク / ライトテーマ** — システム設定連動、手動切替可、localStorage に保存
- **多言語 UI** — 日本語・英語・簡体字・繁体字（ブラウザから自動検出）
- **lrclib.net 同期** — タイムスタンプ付き歌詞を取得し行ごとに同期
- **ワンクリックインポート** — Spotify で再生中の曲の歌詞を即座に取得
- **プレイリスト一括インポート** — Spotify プレイリストの全曲を一括インポート
- **お気に入り＆コレクション** — 星マークで收藏、コレクションに整理、お気に入りフィルター
- **エクスポート** — テキスト / LRC（タイムスタンプ付き）/ HTML でダウンロード
- **歌詞コピー** — ふりがなを除去してクリーンテキストをクリップボードにコピー
- **フォントサイズ調整** — A−/A+ で読みやすいサイズに調整
- **レスポンシブ** — モバイル最適化されたボトムバーと3点ドットメニュー

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

## 実験パネル

曲ページを開く → 「その他」メニュー（デスクトップツールバーまたはモバイルのオーバーフローメニュー）→ **実験**：

- **マイクスペクトラム表示** — リアルタイムの周波数波形でグリッド最下段の点を発光（波の頂点はパネル高さの 1/3 以下）。パネルを閉じてもトグル状態は保持され、トグル OFF またはページ離脱でマイクを解放します。セキュアコンテキスト（HTTPS または localhost）とマイク権限が必要です。

## ライセンス

[MIT](LICENSE)
