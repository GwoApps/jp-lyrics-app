# 歌詞ノート

ふりがな表示・Spotify リアルタイム同期・PWA 対応の日本語歌詞管理 Web アプリ。

[English](README.md) | [中文](README-zh.md)

## 機能

- **ふりがな歌詞** — 日本語歌詞を貼り付けると、くろしろが漢字をひらがなに自動変換し `<ruby>` で表示
- **Spotify リアルタイム同期** — OAuth 連携による再生トラッキング、SSE ストリーミング、行ごと自動スクロール
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
| フレームワーク | Next.js 14（App Router） |
| UI | React 19、Tailwind CSS v4、Lucide Icons |
| データベース | SQLite（better-sqlite3） |
| ふりがなエンジン | kuroshiro + kuromoji |
| 歌詞ソース | lrclib.net |
| 音楽連携 | Spotify Web API（OAuth 2.0）+ SSE ストリーミング |
| デプロイ | Docker、Traefik リバースプロキシ |

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

Spotify 連携はオプションです。設定しなくても歌詞の管理は可能です。

[Spotify Developer Dashboard](https://developer.spotify.com/dashboard) でアプリを作成し、リダイレクト URI を `http://localhost:3000/api/auth/callback` に設定してください。

## Docker デプロイ

```bash
docker compose up -d --build
```

## ライセンス

[MIT](LICENSE)
