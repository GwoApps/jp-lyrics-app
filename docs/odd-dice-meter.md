# Odd Dice 拍表与上传音频对齐

当前运行图为 `odd-dice-audio-aligned-v3`，由 **138 个编号小节、733 个逐帧观测拍点、63 个视频 BPM 读数事件**组成。所有小节拍数严格等于分子，推测拍点为 0；不再把整张图标为 estimated/partial。来源是社区视频转写，不是官方乐谱。

## 数字来源与坐标

- `src/lib/meter-maps/odd-dice.observed-source.json`：原始数字快照，SHA256 `ca653cb011ee49778cff02b5dc92e10a52ab3aa2efa75f6c1afad2e8828d4ae8`。
- `odd-dice.tempo-readouts.json`：原视频可读 BPM 变化，SHA256 `4c0bb0dfbe03f2441ed562e523463fa8152c2b7773625aaf567965c9bcaec0a9`。200ms 读数采样；数字变形时保持最后可靠读数，不用约 33ms 量化拍间距反算 BPM，不使用旧 170/188 阶梯估计或 139→124 线性 ramp。
- `odd-dice.full.sections.csv`：保留原 32 段粗尺度对照，SHA256 `6c61f6f4b9543d55a4f43e9569b105489352bb882f655ede483a69afa837ea23`。它不再生成拍点或 BPM；粗边界可能与观测首拍相差数百毫秒（例如 7500 与 7300），不能吸附为下拍锚点。
- `odd-dice.alignment-summary.json`：14,836 字节的数字证据摘要，含 9 高能窗、50 密集窗、拟合与验证结果、被剔除的尾音歧义和光点交叉检查。无私有路径、波形或音视频。

运行 bar/beat/BPM 数值原样保留源视频坐标，不积分、不插值、不强造播放零点首拍。统一 lookup 使用：

```text
sourceVideoMs = uploadedAudioMs + 2043.875
playbackToSourceOffsetMs = +2043.875
scale = 1
```

上传音频时长 248828.639ms，应用仍用 `durationMs = 248828`；不因 0.639ms 差值拉伸时间轴。歌曲身份和 ±1000ms 时长门控保持不变。这是运行时版本筛选，不意味着任意同长度录音均已验证。

| 源坐标 ms | 播放坐标 ms | 含义 |
| --- | --- | --- |
| 2933.333 | 889.458 | 首个观测 4/4 小节；此前未知 |
| 7300 | 5256.125 | 首个 5/4 |
| 96566.667 | 94522.792 | 4/4 重入 |
| 121366.667 | 119322.792 | 3/4 |
| 219200 | 217156.125 | 无拍区开始 |
| 230933.333 | 228889.458 | 3/4 重入 |
| 248800 | 246756.125 | 转写观测覆盖终点 |

源 219200–230933.333（含未收入拍表的 count-in）不造拍。源 248800 是原转写人工设定的观察边界，不是音频真实结束或官方小节终点；播放 246756.125 至 248828 始终未知/无拍。未补入未经确认的 intro/click 拍点。

## 实测范围与精度

源音频 SHA256：`c5821ed7f1e10e318911d7469c7d9650e7c7ae226603ca156ec2d07d8813e31d`；上传 OGG SHA256：`113cce1a5599ad4a48d31eb98c8ff684683ea5aed60fa8f50b68674a8c303dad`。

校准类型是 `waveform-multi-anchor`。16kHz 解码下偏移为 32702 个采样点。9 个前中后高能 8 秒窗，以及 50 个密集窗中的 49 个无歧义窗，均定位同一偏移；不是凭时长猜测同版本。密集窗从上传 0ms 覆盖至末个 240828.625ms 起始的 8 秒窗。240000ms 衰减尾音存在多峰，原峰保留并从拟合剔除，不能解读为漂移或剪辑。

接受窗常数偏移 RMS 残差为 0ms，线性拟合最大绝对残差约 8.73e-11ms、漂移约 −2.22e-10 ppm（数值浮点误差尺度），未测到变速漂移或内部剪辑。独立 verification 为 PASS，并校验输入哈希、直接相关与 FFT 结果；父进程另已复核 12/99/189.5 秒三个窗。这些是既有音频分析证据，本轮没有重新听完全曲或验证 Spotify 实机。

源视频混入额外节拍 click。独立残差交叉检查显示 733 个视觉拍点全部在残差峰 ±60ms 内，中位“残差峰减视觉拍点”为 −12.792ms。视觉观测来源为 30fps（约 33.333ms 帧网格），并非每拍音频拍号独立验证。0.0625ms 仅是解码波形匹配采样网格，不承诺视觉拍表、歌词或 Spotify 设备达到该精度。历史手动 +2909.091ms 已被共享波形证据推翻，不作 fallback。

## 可重复生成与更新

默认只读取仓库数字文件，无私有路径、音频、网络或新增依赖：

```sh
node scripts/import-odd-dice-map.mjs
```

显式输入/输出（五个参数必须全部提供）：

```sh
node scripts/import-odd-dice-map.mjs observed.json tempo.json alignment.json sections.csv output.json
```

同一输入生成 byte-identical JSON。生成器校验严格计数、有限数值、单调性、拍数、零推测拍、对齐符号与验证结果，并固定已审核输入 SHA256。独立路径可以放置相同快照；更新内容时必须独立复核新证据，再同步修改脚本中的哈希/计数/校准约束和测试，不能直接接受未经审核的新谱。所有输入先完成解析与验证，再用同目录 pending 文件原子替换输出；无效输入不会覆盖现有图。

专项检查：

```sh
node --experimental-strip-types --experimental-loader ./scripts/test-loader.mjs --test scripts/import-odd-dice-map.test.mjs src/lib/odd-dice.test.ts src/lib/meter-dice.test.ts
npx tsc --noEmit
npx eslint scripts/import-odd-dice-map.mjs scripts/import-odd-dice-map.test.mjs src/lib/odd-dice.ts src/lib/odd-dice.test.ts --max-warnings 0
git diff --check
```

测试覆盖原始 138/733/63 全值、全部边界的源/播放 lookup 等价、未知区、输入异常不覆盖、可重复生成、哈希与 offset 符号；保留默认零偏移、无穷偏移和 partial 合同回归。宿主父进程负责完整 check/build、独立审查与发布。

## Presentation

The die is 48 px on mobile and 72 px at the existing desktop breakpoint (min-width: 640 px), with a 78 px desktop layout slot; it sits at the right end of the song information header, with a **current BPM** caption below (not a redundant time-signature label). The original desktop toolbar controls individually fade from 0.5 to 1 opacity over 160 ms on fine-pointer hover, keyboard focus or menu-open state; menus and touch controls remain fully opaque, and reduced motion disables the new transition. The caption reads the source tempo timeline from the same playback clock and may change within a beat without rebuilding or rotating the face. Standard 1–6 die faces light cumulatively through a bar and reset on its next downbeat. A continuous signature change rotates the face for 200 ms with WAAPI `transform` only; seeks snap directly, and reduced-motion disables the rotation. No React per-frame state or whole-page render is added. A stable localized image label is supplied in zh-CN, zh-TW, ja and en; beat changes are not a screen-reader live region.


Each lamp has a warm filament and pale hot core, surrounded by two subtle static halo layers. Only opacity transitions: 140 ms to light and 110 ms of afterglow to fade, both using `cubic-bezier(0.23, 1, 0.32, 1)`. Transitions run only during continuous playback. On a same-meter downbeat the existing first pip commits a dark baseline, then warms again; the remaining old pips fade out without rebuilding the face. New faces also commit a dark baseline before lighting. Pause, seek, visibility restoration and other discontinuities snap directly to the current position; reduced motion also disables lamp transitions. There is no pulse or additional timer. DOM regressions observe the committed dark baseline and retained old lights. Real Chrome acceptance covers responsive sizing, toolbar opacity intermediate frames, keyboard focus, portaled menus, reduced motion and touch controls; audio-synchronized lamp feel has not been verified on a real Spotify device.

### 快速升 BPM 专属外发光

仅在现有 `getOddDiceMap` 歌曲、艺术家及完整版本校验通过后，页面向
`MeterDice` 注入稳定的模块级 `ODD_DICE_GLOW_WINDOWS`。通用组件的可选
`glowWindows` 默认不启用任何外光，不识别歌曲 ID 或艺术家。

| 段落 | 源视频区间（ms） | 播放区间（ms） |
| --- | --- | --- |
| 第一次 165 → 230 BPM | [57866.667, 68000) | [55822.792, 65956.125) |
| 第二次 165 → 230 BPM | [138966.667, 143833.333) | [136922.792, 141789.458) |

区间从首个上升读数起，到首次 230 BPM 读数止（不包含终点），230 BPM
恒速平台不继续发光。源区间固定，播放区间统一减去当前 map 的
`playbackToSourceOffsetMs` 一次；当前仍为 2043.875 ms。

装饰层仅围绕骰面，位于骰面背后，与 BPM 文字及骰面 WAAPI 旋转分离。
使用 header 已有封面 primary/secondary/tertiary 配色及低透明度柔光；
两层轨道分别为 3.2 秒和反向 4.4 秒，边缘呼吸为 2.4 秒，进出透明度
过渡为 180 ms。仅动画 transform/opacity，渐变、模糊、阴影均为静态。
独立外层控制显隐，避免呼吸关键帧覆盖 off 的透明度。无布局或命中区域变化。

SSR 输出 `data-glow="off"`、`data-glow-motion="paused"`。
客户端在既有 `paint()` 中使用同一个 `meterPlaybackMs`，仅有效 map、匹配歌曲、
有效 meter frame 且处于窗口内时标记 `active`，其他情况为 `off`；
状态不变时不重复写 glow dataset。播放时为 `running`，暂停按确认的 seek ref
或暂停快照判断窗口并标为 `paused`；隐藏时暂停循环、停止既有 rAF，恢复时
直接按当前时钟重算，不补播跳过的区间。减少动态偏好（包括运行时切换）为
`static`，CSS 禁用循环并保留静态柔光。卸载取消 rAF、清理监听并暂停外光。

本变更不修改音频、拍点 JSON、生成器、2043.875 ms 校准、138 小节、733 观测拍、
63 个 BPM 读数、桌面 72/移动 48 骰面尺寸或工具栏透明度规则。
纯区间测试及实际组件 effect 的 fake DOM harness 验证时钟和生命周期合同，但不执行 CSS。
真实 Chrome 专项脚本为 `/root/public-files/jplrc/odd-dice-accelerando-glow/verify.cjs`，
覆盖全部边界、播放自动进出、循环进度、暂停冻结、双向 seek、动态减效、桌面/移动/亮色及错曲/版本拒绝；
原桌面工具栏回归脚本继续运行。浏览器使用合成 API 状态并拦截所有写请求，visibility 事件为显式测试注入，
不等同真实 Spotify 设备或操作系统后台切换的听音验收。
