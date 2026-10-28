# 歌詞ノート（歌词笔记）

日语／粤语歌词阅读 Web 应用，支持振假名／粤拼、AI 翻译、Spotify 播放同步和 PWA 安装。**在应用内，游客可以阅读公开歌曲（反向代理仍可能另设访问限制）；创建、编辑、导入和翻译歌曲需要通过 Spotify OAuth 登录。** 全新数据库没有歌曲，登录后才能添加或导入。

[English](README.md) | [日本語](README-ja.md) | [功能说明](FEATURES.md) | [部署指南](DEPLOYMENT.md)

## 功能亮点

- 歌词读音模式、逐行操作、播放跟随滚动，以及沉浸式全屏歌词（浏览器支持时进入原生全屏）。
- Spotify 播放同步、歌单导入、逐行时间轴标注、分享卡片，以及画中画歌词（视浏览器支持情况而定）。
- OpenAI 兼容、Anthropic 或 Cloudflare Workers AI 驱动的整曲／逐行翻译；SSE 报告准备阶段和完成进度，最终 `done` 事件返回译文；只有 Provider 提供推理内容时才显示思考过程。
- 可配置的歌词源链：内置 LRCLIB 等来源及管理员管理的 HTTP 歌词源；附带的 [YouTube Music sidecar](yt-sidecar/README.md) 是插件示例。
- 四种界面语言（ja、en、zh-CN、zh-TW）、收藏与合集、PWA、深浅主题。

完整功能见 [FEATURES.md](FEATURES.md)，自定义歌词源见[插件协议](examples/provider-plugin/README.md)。管理员可在**管理后台 → 系统 → 歌词源 Provider**配置全局来源。

## 技术栈

| 层 | 技术 |
|---|---|
| 应用 | Next.js 16（App Router）、React 19、Tailwind CSS v4 |
| 数据库 | Drizzle ORM + libSQL（本地 SQLite 或 Turso）；或 Cloudflare D1 |
| 歌词 | 内置来源 + 版本化 HTTP Provider 插件；浏览器端读音引擎 |
| 音乐／AI | Spotify Web API（OAuth 2.0）；OpenAI 兼容、Anthropic 或 Workers AI |
| 部署 | Docker（Node.js）、Cloudflare Workers 或 Vercel（无状态环境使用客户端 Spotify 轮询） |

## 本地快速开始

使用 **Node.js 22** 和 npm。项目已提交锁文件，用 `npm ci` 可重复安装依赖。

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
npm ci
cp .env.example .env
npm run dev
# http://localhost:3000
```

启动应用和浏览公开歌曲不需要 Spotify 凭据，但 **Spotify OAuth 是应用唯一的登录方式**。如需创建／管理歌曲，在 `.env` 中配置 `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET`，到 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用，并登记回调地址 `http://localhost:3000/api/auth/callback`。播放同步和歌单导入也需要 Spotify 连接。AI 翻译还需配置相应 Provider；阅读和手动编辑不依赖 AI。

### 配置速览

| 配置 | 作用 |
|---|---|
| `SPOTIFY_CLIENT_ID`、`SPOTIFY_CLIENT_SECRET` | OAuth 登录；使用登录功能必需，游客阅读公开内容不需要 |
| `SPOTIFY_REDIRECT_URI`、`SPOTIFY_POLL_MODE` | 覆盖回调地址；播放轮询可选 `client`（默认）或 `server`（需常驻 Node 服务） |
| `TURSO_URL`、`TURSO_AUTH_TOKEN` | 可选远程数据库；未设置 URL 时 Node 使用 `data/local.db`；Workers 使用 D1 binding |
| `TRANSLATION_PROVIDER` | `openai`（默认）、`anthropic` 或 `workers-ai`（需 Cloudflare AI binding） |
| `TRANSLATION_BASE_URL`、`TRANSLATION_API_KEY`、`TRANSLATION_MODEL`、`TRANSLATION_TARGET_LANG` | Provider 地址／密钥／模型／默认目标语；Workers AI 不需要 API 密钥。示例 `.env` 预设了 OpenAI 兼容模型，切换 Provider 时须更改或删除模型配置。 |
| `AI_DAILY_NEURON_LIMIT` | 可选的每日翻译配额 |
| `SESSION_SECRET`、`JPLRC_LOGIN_PASSPHRASE_REQUIRED`、`JPLRC_LOGIN_PASSPHRASE` | 生产环境设置独立的会话签名密钥；可选登录前口令校验 |
| `LYRICS_PROVIDER_*` | HTTP 歌词源的部署级网络策略、Bearer 密钥加密及超时预算；详见[部署指南第 4 节](DEPLOYMENT.md#4-http-lyrics-providers-deployment-configuration-issue-148) |

管理员还可以在应用内配置**全局翻译 Provider／模型**：数据库中非空的设置优先于环境变量，空值回退环境变量；登录用户可另行覆盖目标语言。详情见 [.env.example](.env.example) 和 [DEPLOYMENT.md](DEPLOYMENT.md)。不要提交真实凭据。

### Docker 是独立部署路径

随仓库提供的 `docker-compose.yml` **不是开箱即用的 localhost 配置**：它依赖已存在的 Traefik 外部网络和认证中间件，不发布宿主机端口，还会挂载 YouTube Music sidecar 的宿主机文件。先按 [Docker 部署指南](DEPLOYMENT.md#1-docker-self-hosted)检查前置条件并修改 `.env`，再执行 `docker compose up -d --build`。无需 Traefik 的本地试用请使用上面的 `npm run dev`。

## 开发与验证

```bash
npm run check       # TypeScript、ESLint、多语言校验、测试
npm run check:full  # 上述检查 + 生产构建
```

核心目录：[`src/app/`](src/app/)（页面/API）、[`src/components/`](src/components/)（组件）、[`src/hooks/`](src/hooks/)（客户端逻辑）、[`src/lib/`](src/lib/)（数据库、歌词与翻译）、[`src/i18n/`](src/i18n/)（四种语言）、[`drizzle/`](drizzle/)（SQL 迁移）、[`yt-sidecar/`](yt-sidecar/)（HTTP 歌词源）。功能流程见 [FEATURES.md](FEATURES.md)，部署及迁移规则见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## API 概览

- 歌曲列表／公开歌曲详情：[`src/app/api/songs/`](src/app/api/songs/) 的 `GET`；写入和导入操作需要 Spotify 登录会话。
- `POST /api/songs/[id]/translate`：请求设置 `stream: true` 时，SSE 发出 `stage` 和 `progress`，可选 `reasoning` 增量，最后用 `done` 返回译文，失败发送 `error`；翻译文本不以独立的 `translation` 增量事件发送。支持整曲或指定行翻译，详见[路由说明](src/app/api/songs/%5Bid%5D/translate/route.ts)。
- 管理员歌词源接口：[`src/app/api/admin/lyrics-providers/`](src/app/api/admin/lyrics-providers/)（仅管理员）。插件作者应遵循[版本化 HTTP 协议](examples/provider-plugin/README.md)，而非把管理接口当作搜索接口。

方法和请求体以 [API 路由源码](src/app/api/)为准，避免在 README 中维护易过期的完整接口清单。

## 许可证

[MIT](LICENSE)
