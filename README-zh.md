# 歌詞ノート（歌词笔记）

日语歌词管理 Web 应用，支持振假名标注、AI 翻译、Spotify 实时同步、实验面板（歌词点阵上的麦克风频谱）和 PWA 安装。

[English](README.md) | [日本語](README-ja.md) | [功能说明](FEATURES.md) | [部署指南](DEPLOYMENT.md)

## 功能

日语歌词阅读器：振假名标注、AI 翻译、Spotify 同步自动滚动等：

- 振假名标注、读音模式（假名/罗马音）、字体大小调节
- AI 歌词翻译：SSE 流式 + 实时思考面板 + 可插拔 LLM Provider
- Spotify 实时同步（SSE 或轮询）+ 逐行缓动跟随滚动
- 时间轴工作台：配合实时播放逐行标注歌词
- 单行操作菜单：桌面端右键、移动端长按歌词行呼出
- 分享卡片生成（二维码 + 选行 → PNG）、管理控制台
- PWA、深浅主题、4 种界面语言、收藏与合集

完整功能说明见 **[FEATURES.md](FEATURES.md)**。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16（App Router） |
| UI | React 19、Tailwind CSS v4、Lucide Icons |
| 数据库 | Drizzle ORM + @libsql/client（Turso、本地 SQLite 或 Cloudflare D1） |
| 振假名引擎 | kuromoji-es（浏览器 CDN，懒加载） |
| 歌词来源 | lrclib.net |
| 音乐集成 | Spotify Web API（OAuth 2.0）+ SSE / 客户端轮询 |
| 翻译 | OpenAI 兼容 / Anthropic / Workers AI（SSE 流式） |
| 音频（实验） | Web Audio API（AnalyserNode、getUserMedia） |
| 部署 | Docker（自托管）、Cloudflare Workers、Vercel Edge |

## 快速开始

```bash
git clone https://cnb.cool/siubeng/jp-lyrics-app.git
cd jp-lyrics-app
npm install
cp .env.example .env
npm run dev
# → http://localhost:3000
```

### 环境变量

| 变量名 | 必填 | 说明 |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | 否 | Spotify 客户端 ID |
| `SPOTIFY_CLIENT_SECRET` | 否 | Spotify 客户端密钥 |
| `SPOTIFY_REDIRECT_URI` | 否 | 覆盖回调地址（默认：请求源 + `/api/auth/callback`） |
| `SPOTIFY_POLL_MODE` | 否 | `client`（默认）或 `server`，见 [DEPLOYMENT.md](DEPLOYMENT.md) |
| `TURSO_URL` | 否 | Turso 数据库地址（如 `libsql://xxx.turso.io`）。未设置时回退本地 SQLite 文件；CF D1 使用 binding |
| `TURSO_AUTH_TOKEN` | 否 | Turso 认证令牌（设置 `TURSO_URL` 时需要） |
| `TRANSLATION_PROVIDER` | 否 | `openai`（默认，OpenAI 兼容）或 `anthropic`（Anthropic Messages API） |
| `TRANSLATION_BASE_URL` | 否 | OpenAI 兼容 API 地址（默认 `https://api.deepseek.com/v1`） |
| `TRANSLATION_API_KEY` | 否 | LLM API 密钥（未设置时回退 `DEEPSEEK_API_KEY`） |
| `TRANSLATION_MODEL` | 否 | 模型名（默认 `deepseek-v4-flash`） |
| `TRANSLATION_TARGET_LANG` | 否 | 默认翻译目标语言（默认 `zh-CN`） |
| `AI_DAILY_NEURON_LIMIT` | 否 | 每日翻译配额（token）；超限请求返回 `429 / ai_quota_exceeded` |
| `JPLRC_LOGIN_PASSPHRASE_REQUIRED` | 否 | 开始 Spotify OAuth 前是否需要口令 |
| `JPLRC_LOGIN_PASSPHRASE` | 否 | 口令本身（仅在服务端校验） |
| `SESSION_SECRET` | 否 | 生产环境推荐：独立签名登录/会话 Cookie |
| `LYRICS_PROVIDER_ALLOW_HTTP` | 否 | 允许明文 `http://` HTTP 歌词源（默认 `false`，fail-closed） |
| `LYRICS_PROVIDER_ALLOW_PRIVATE_NETWORK` | 否 | 允许歌词源使用 loopback/私网/Docker-bridge 地址（默认 `false`） |
| `LYRICS_PROVIDER_SECRET_KEY` | 仅 Bearer 歌词源 | 用于加密歌词源 Bearer token 的 AES-GCM 密钥 |
| `LYRICS_PROVIDER_DEFAULT_TIMEOUT_MS` | 否 | 单歌词源搜索预算（默认 `20000`） |
| `LYRICS_PROVIDER_MAX_TIMEOUT_MS` | 否 | 管理员单配置超时上限（默认 `60000`） |
| `LYRICS_PROVIDER_MANIFEST_TIMEOUT_MS` | 否 | manifest/测试连接预算（默认 `15000`） |
| `LYRICS_PROVIDER_CHAIN_TIMEOUT_MS` | 否 | 整条歌词源链预算（默认 `180000`） |

HTTP 歌词源的完整部署指南见 [DEPLOYMENT.md](DEPLOYMENT.md) 第 4 节。

Spotify 集成是可选的。不配置也可以正常管理歌词。

在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用，将重定向 URI 设置为 `http://localhost:3000/api/auth/callback`。

## Docker 部署

```bash
docker compose up -d --build
```

详细部署（Docker / Cloudflare Workers / Vercel）见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 项目结构

```
src/
├── app/
│   ├── page.tsx                          # 歌曲列表：搜索、筛选、正在播放
│   ├── admin/page.tsx                    # 管理控制台（用户/歌曲/待审批/翻译）
│   ├── songs/
│   │   ├── new/page.tsx                  # 创建歌曲
│   │   └── [id]/
│   │       ├── page.tsx                  # 歌词详情（Spotify 同步、点阵、菜单、PiP）
│   │       ├── edit/page.tsx             # 编辑歌曲
│   │       ├── translation/page.tsx      # 整曲翻译工作区
│   │       ├── share/page.tsx            # 分享卡片生成（绘制在 lib/share-card.ts）
│   │       └── timeline/edit/page.tsx    # 时间轴标注工作台
│   └── api/                              # songs / collections / admin / auth / spotify / me
├── components/
│   ├── home/                             # SongFilterBar、CollectionsPanel、PlaylistImportDialog
│   ├── song/                             # ToolbarMenu、MobileMenu（菜单项与类型）
│   ├── admin/                            # AdminTabs、AdminUserList、AdminSongList、AdminPendingList、BlockUserDialog、TranslationConfigPanel、admin-types
│   ├── timeline/                         # SpotifyStatusCard、OffsetControls、MarkCurrentLineCard、TimelineLineRow
│   ├── LyricsDotGrid.tsx                 # 点阵 Canvas（聚光灯 + 麦克风频谱）
│   ├── ExperimentsPanel.tsx              # 实验：麦克风频谱开关
│   ├── TranslationStatusOverlay.tsx      # 翻译进度气泡 + 思考面板
│   └── ui/                               # 小组件
├── hooks/                                # useSongData / useSpotifySync / useNowPlaying / useSpectrumCapture / useCoverPalette
├── lib/
│   ├── translation/                      # config / prompts / parse / index（Provider + 流式）
│   ├── translation-stream.ts             # /translate 的客户端 SSE 读取器
│   ├── translation-errors.ts             # 错误码 → i18n key 映射
│   ├── share-card.ts                     # 分享卡片的纯 Canvas 绘制
│   ├── scroll-ease.ts                    # Apple 风格缓动滚动动画
│   ├── lrc.ts / match.ts / romaji.ts / lyrics-fetcher.ts
│   ├── cover-color.ts / cover-store.ts   # 封面取色 + R2/blob 存储
│   ├── ai-usage.ts                       # 每日翻译配额
│   └── theme.tsx / i18n.tsx / types.ts
└── i18n/                                 # ja / en / zh-CN / zh-TW
```

## 许可证

[MIT](LICENSE)
