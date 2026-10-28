# 歌詞ノート

日本語・広東語の歌詞を読むための Web アプリ。ふりがな／粤拼、AI 翻訳、Spotify の再生同期、PWA に対応しています。**アプリ内では公開曲をログインなしで閲覧できます（リバースプロキシ側で別途アクセス制限をかける場合があります）。曲の作成・編集・取り込み・翻訳には Spotify OAuth ログインが必要です。** 新しいデータベースには曲がなく、ログイン後に追加・取り込みます。

[English](README.md) | [中文](README-zh.md) | [機能一覧](FEATURES.md) | [デプロイガイド](DEPLOYMENT.md)

## 主な機能

- 読み方の切り替え、行ごとの操作、再生位置への追従スクロール、没入型の全画面歌詞表示（対応ブラウザではネイティブ全画面）。
- Spotify の再生同期、プレイリスト取り込み、行ごとのタイムスタンプ編集、シェアカード、ピクチャーインピクチャー歌詞（ブラウザによって利用可否が異なります）。
- OpenAI 互換・Anthropic・Cloudflare Workers AI による曲全体／行単位の翻訳。SSE で準備段階と進捗を通知し、最終的な `done` イベントで訳文を返します。推論内容はプロバイダが提供する場合のみ表示します。
- 設定可能な歌詞ソースチェーン：LRCLIB などの内蔵ソースと、管理者が設定する HTTP プロバイダ。[YouTube Music sidecar](yt-sidecar/README.md) は付属のプラグイン例です。
- 4言語 UI（ja、en、zh-CN、zh-TW）、お気に入りとコレクション、PWA、ダーク／ライトテーマ。

詳しくは [FEATURES.md](FEATURES.md)、独自の歌詞ソースについては[プラグイン仕様](examples/provider-plugin/README.md)をご覧ください。グローバルな歌詞ソースは**管理画面 → システム → 歌詞ソース Provider**で設定します。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| アプリ | Next.js 16（App Router）、React 19、Tailwind CSS v4 |
| データベース | Drizzle ORM + libSQL（ローカル SQLite／Turso）、または Cloudflare D1 |
| 歌詞 | 内蔵ソース + バージョン付き HTTP プラグイン、ブラウザ側の読み方エンジン |
| 音楽／AI | Spotify Web API（OAuth 2.0）、OpenAI 互換／Anthropic／Workers AI |
| ホスティング | Docker（Node.js）、Cloudflare Workers、Vercel（サーバーレスではクライアント側 Spotify ポーリング） |

## ローカルでの起動

**Node.js 22** と npm を使用します。依存関係はコミット済みのロックファイルに従い `npm ci` でインストールしてください。

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
npm ci
cp .env.example .env
npm run dev
# http://localhost:3000
```

起動と公開曲の閲覧には Spotify の認証情報は不要ですが、**アプリへのログイン方法は Spotify OAuth のみ**です。曲を作成・管理するには、`.env` に `SPOTIFY_CLIENT_ID` と `SPOTIFY_CLIENT_SECRET` を設定し、[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリを作成して `http://localhost:3000/api/auth/callback` をリダイレクト URI に登録してください。再生同期やプレイリスト取り込みにも Spotify 接続が必要です。AI 翻訳にはプロバイダの設定が別途必要ですが、閲覧や手動編集には不要です。

### 設定の概要

| 設定 | 用途 |
|---|---|
| `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET` | OAuth ログイン。ログイン機能に必要、匿名での公開曲閲覧には不要 |
| `SPOTIFY_REDIRECT_URI`、`SPOTIFY_POLL_MODE` | コールバック URI の上書き。再生モードは `client`（既定）または `server`（常駐 Node サーバーのみ） |
| `TURSO_URL`、`TURSO_AUTH_TOKEN` | 任意のリモート DB。URL がなければ Node は `data/local.db` を使用。Workers は D1 binding を使用 |
| `TRANSLATION_PROVIDER` | `openai`（既定）、`anthropic`、`workers-ai`（Cloudflare AI binding が必要） |
| `TRANSLATION_BASE_URL`、`TRANSLATION_API_KEY`、`TRANSLATION_MODEL`、`TRANSLATION_TARGET_LANG` | 接続先／キー／モデル／既定の翻訳先言語。Workers AI に API キーは不要です。サンプル `.env` には OpenAI 互換モデルが設定されているため、プロバイダを変える場合はモデル設定も変更または削除してください。 |
| `AI_DAILY_NEURON_LIMIT` | 任意の1日あたり翻訳上限 |
| `SESSION_SECRET`、`JPLRC_LOGIN_PASSPHRASE_REQUIRED`、`JPLRC_LOGIN_PASSPHRASE` | 本番では独立したセッション署名用シークレットを設定。OAuth 前のパスフレーズ確認は任意 |
| `LYRICS_PROVIDER_*` | HTTP 歌詞ソースのデプロイレベルのネットワーク制限、Bearer キー暗号化、タイムアウト。詳細は[デプロイガイド第4節](DEPLOYMENT.md#4-http-lyrics-providers-deployment-configuration-issue-148) |

管理者はアプリ内でも**グローバルな翻訳プロバイダ／モデル**を設定できます。DB に保存された空でない値が環境変数に優先し、空欄は環境変数へフォールバックします。ログインユーザーは翻訳先言語を個別に上書きできます。詳細は [.env.example](.env.example) と [DEPLOYMENT.md](DEPLOYMENT.md) を参照。実際の認証情報はコミットしないでください。

### Docker は別のデプロイ手順です

付属の `docker-compose.yml` は **localhost ですぐ動く構成ではありません**。既存の Traefik 外部ネットワークと認証ミドルウェアが必要で、ホストにポートを公開せず、YouTube Music sidecar 用のホストファイルもマウントします。[Docker デプロイガイド](DEPLOYMENT.md#1-docker-self-hosted)で前提条件を確認し、`.env` を調整してから `docker compose up -d --build` を実行してください。Traefik を使わないローカル試用には、上記の `npm run dev` を使用してください。

## 開発と検証

```bash
npm run check       # TypeScript、ESLint、i18n、テスト
npm run check:full  # 上記 + 本番ビルド
```

主要ディレクトリ：[`src/app/`](src/app/)（画面／API）、[`src/components/`](src/components/)（UI）、[`src/hooks/`](src/hooks/)（クライアント側処理）、[`src/lib/`](src/lib/)（DB・歌詞・翻訳）、[`src/i18n/`](src/i18n/)（4言語）、[`drizzle/`](drizzle/)（SQL マイグレーション）、[`yt-sidecar/`](yt-sidecar/)（HTTP プロバイダ）。機能の説明は [FEATURES.md](FEATURES.md)、デプロイ／マイグレーションは [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。

## API の概要

- 曲一覧・公開曲の詳細：[`src/app/api/songs/`](src/app/api/songs/) の `GET`。書き込みと取り込みには Spotify ログインセッションが必要です。
- `POST /api/songs/[id]/translate`：`stream: true` なら SSE で `stage` と `progress`、任意の `reasoning` 増分、最後に訳文を含む `done`、失敗時に `error` を送ります。訳文のチャンクを個別の `translation` イベントとしては送信しません。曲全体と一部の行の翻訳に対応。詳しくは[ルートの説明](src/app/api/songs/%5Bid%5D/translate/route.ts)を参照してください。
- 管理者向け歌詞ソース API：[`src/app/api/admin/lyrics-providers/`](src/app/api/admin/lyrics-providers/)（管理者のみ）。プラグイン実装者は管理 API を検索に流用せず、[バージョン付き HTTP 仕様](examples/provider-plugin/README.md)を使用してください。

メソッドとリクエスト形式は [API ルートのソースコード](src/app/api/)を正とし、README に古くなりやすい全エンドポイント一覧は重複掲載しません。

## ライセンス

[MIT](LICENSE)
