# 歌詞ノート（歌词笔记）

日语歌词管理 Web 应用，支持振假名标注、AI 翻译、Spotify 实时同步、实验面板（歌词点阵上的麦克风频谱）和 PWA 安装。

[English](README.md) | [日本語](README-ja.md) | [部署指南](DEPLOYMENT.md)

## 功能

- **振假名歌词** — 粘贴日语歌词，kuroshiro 自动将汉字转换为平假名振假名，通过 `<ruby>` 标注显示
- **AI 歌词翻译** — SSE 流式翻译到目标语言，带实时思考面板、术语表提取、重试与配额处理，支持可插拔 Provider（OpenAI 兼容 / Anthropic Messages / Cloudflare Workers AI）
- **Spotify 实时同步** — OAuth 连接播放追踪，SSE 流式传输或客户端轮询，逐行自动滚动（Apple 风格缓动动画）
- **时间轴标注工作台** — 配合 Spotify 实时进度逐行标注未定时歌词，支持保存部分进度、回听、撤销和整曲偏移
- **歌词点阵背景** — Canvas 点阵背景 + 指针聚光灯；**实验面板**提供实时麦克风频谱，点亮点阵底部数行（Web Audio API，波峰最高为面板高度 1/3）
- **分享卡片** — 生成可分享的 Canvas 图片（横版/竖版、二维码、可选歌词行），下载为 PNG
- **管理控制台** — `/admin`：用户管理（晋升/降级、封禁/解封、删除）、歌曲可见性控制、公开待审批队列、翻译服务在线配置与连通性测试
- **读音显示模式** — 可切换原文、假名和赫本式罗马音，并在本机保存偏好
- **Spotify 规范化元数据** — 保存稳定 Track ID、URI、专辑、时长、封面及规范标题/歌手，用于精确匹配
- **歌词来源与可信度** — 记录最终歌词源、启发式匹配可信度及抓取时间
- **画中画（PiP）** — 在其他应用上方显示浮动歌词窗口（桌面 Chrome）
- **PWA** — 可安装到 Android/iOS，支持离线缓存和更新通知
- **深色 / 浅色主题** — 跟随系统设置，支持手动切换，localStorage 持久化
- **多语言 UI** — 日语、英语、简体中文、繁体中文（自动检测浏览器语言）
- **lrclib.net 同步** — 获取带时间戳的歌词，精确逐行同步
- **一键导入** — 正在播放的 Spotify 歌曲一键获取歌词
- **播放列表批量导入** — 一键导入 Spotify 播放列表中的所有歌曲
- **收藏与合集** — 星标收藏歌曲，创建合集整理，按收藏筛选
- **导出** — 下载为纯文本、LRC（带时间戳）或 HTML 格式
- **复制歌词** — 去除振假名，复制纯净文本到剪贴板
- **字体大小调整** — A−/A+ 控件，舒适阅读
- **响应式设计** — 移动端优化的底栏和三点溢出菜单

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
git clone https://github.com/GwoApps/jp-lyrics-app.git
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

## 实验面板

打开歌曲页 → 「更多」菜单（桌面工具栏或移动端溢出菜单）→ **实验**：

- **捕获录音展示频谱** — 用实时频率波形点亮点阵底部数行（波峰最高为面板高度 1/3）。关闭面板开关状态保持；关闭开关或离开页面自动释放麦克风。需要安全上下文（HTTPS 或 localhost）与麦克风权限。

## 许可证

[MIT](LICENSE)
