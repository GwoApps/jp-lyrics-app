# 歌詞ノート（歌词笔记）

日语歌词管理 Web 应用，支持振假名标注、Spotify 实时同步和 PWA 安装。

[English](README.md) | [日本語](README-ja.md) | [部署指南](DEPLOYMENT.md)

## 功能

- **振假名歌词** — 粘贴日语歌词，kuroshiro 自动将汉字转换为平假名振假名，通过 `<ruby>` 标注显示
- **Spotify 实时同步** — OAuth 连接播放追踪，SSE 流式传输，逐行自动滚动
- **时间轴标注工作台** — 配合 Spotify 实时进度逐行标注未定时歌词，支持保存部分进度、回听、撤销和整曲偏移
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
| 框架 | Next.js 14（App Router） |
| UI | React 19、Tailwind CSS v4、Lucide Icons |
| 数据库 | SQLite（better-sqlite3） |
| 振假名引擎 | kuroshiro + kuromoji |
| 歌词来源 | lrclib.net |
| 音乐集成 | Spotify Web API（OAuth 2.0）+ SSE 流式传输 |
| 部署 | Docker、Traefik 反向代理 |

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

Spotify 集成是可选的。不配置也可以正常管理歌词。

在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建应用，将重定向 URI 设置为 `http://localhost:3000/api/auth/callback`。

## Docker 部署

```bash
docker compose up -d --build
```

## 许可证

[MIT](LICENSE)
