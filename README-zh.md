# 歌詞ノート (Kashi Note)

日语歌词管理 Web 应用，支持振假名显示和 Spotify 同步播放。

[English](README.md) | [日本語](README-ja.md)

## 功能

- **歌词录入** — 粘贴含汉字的日语歌词，保存时 kuroshiro 自动转换为平假名振假名
- **振假名显示** — 通过 `<ruby>` 标签在汉字上方显示平假名，支持字体大小调整（12–28px）
- **Spotify 同步** — OAuth 连接 Spotify，实时追踪播放进度，歌词行自动滚动
- **lrclib.net 同步** — 从 lrclib.net 获取带时间戳的歌词，实现逐行精确同步
- **一键导入** — 播放未录入的歌曲时，一键从 lrclib 拉取歌词并保存，直接跳转详情页
- **移动端适配** — 响应式 UI，移动端按钮仅显示图标，布局自动调整

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 14 (App Router) |
| UI | React 19, Tailwind CSS, Lucide Icons |
| 数据库 | SQLite (better-sqlite3) |
| 振假名引擎 | kuroshiro + kuromoji |
| 歌词数据源 | lrclib.net（优先）, Spotify 非官方 API |
| 音乐集成 | Spotify Web API (OAuth 2.0) |
| 部署 | Docker, Traefik 反向代理 |

## 项目结构

```
src/
├── app/
│   ├── page.tsx                    # 歌曲列表（含 Now Playing 栏）
│   ├── layout.tsx                  # 布局（导航栏）
│   ├── globals.css                 # 全局样式
│   ├── songs/
│   │   ├── new/page.tsx            # 新增歌曲
│   │   └── [id]/
│   │       ├── page.tsx            # 歌词详情（Spotify 同步、Debug 模式）
│   │       └── edit/page.tsx       # 编辑歌曲
│   └── api/
│       ├── songs/
│       │   ├── route.ts            # GET: 列表, POST: 创建
│       │   ├── import/route.ts     # POST: 从 lrclib 一键导入
│       │   └── [id]/
│       │       ├── route.ts        # GET/PUT/DELETE: 单曲操作
│       │       └── sync/route.ts   # POST: 获取同步歌词（lrclib → Spotify 回退）
│       ├── auth/
│       │   ├── login/route.ts      # Spotify OAuth 登录
│       │   └── callback/route.ts   # Spotify OAuth 回调
│       └── spotify/
│           ├── now-playing/route.ts # 当前播放曲目
│           └── status/route.ts     # Spotify 连接状态
└── lib/
    ├── db.ts                       # SQLite 连接与 Schema
    ├── kuroshiro.ts                # 振假名转换逻辑
    ├── spotify.ts                  # Spotify API 凭证
    └── types.ts                    # 共享类型定义
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
# → http://localhost:3000

# 生产构建
npm run build
```

### 环境变量

创建 `.env` 文件：

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_s...n
在 Spotify Developer Dashboard 创建应用，设置重定向 URI 为 `http://localhost:3000/api/auth/callback`。

## Docker 部署

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f
```

`docker-compose.yml` 假设通过 Traefik 反向代理部署，使用 `kazusa-auth` 中间件进行认证保护。

## API 接口

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/songs` | GET | 歌曲列表 |
| `/api/songs` | POST | 创建歌曲（自动振假名转换） |
| `/api/songs/import` | POST | 从 lrclib 一键导入 |
| `/api/songs/[id]` | GET | 歌曲详情 |
| `/api/songs/[id]` | PUT | 更新歌曲 |
| `/api/songs/[id]` | DELETE | 删除歌曲 |
| `/api/songs/[id]/sync` | POST | 获取同步歌词（lrclib → Spotify 回退） |
| `/api/auth/login` | GET | Spotify OAuth 登录 |
| `/api/spotify/now-playing` | GET | 当前播放曲目信息 |

## 许可证

私有项目
