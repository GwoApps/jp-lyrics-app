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

The die is 48 px on mobile and 72 px at the existing desktop breakpoint (min-width: 640 px), with a 78 px desktop baseline layout slot; it sits at the right end of the song information header, with a **current BPM** caption below (not a redundant time-signature label). The original desktop toolbar controls individually fade from 0.5 to 1 opacity over 160 ms on fine-pointer hover, keyboard focus or menu-open state; menus and touch controls remain fully opaque, and reduced motion disables the new transition. The caption reads the source tempo timeline from the same playback clock and may change within a beat without rebuilding or rotating the face. Standard 1–6 die faces light cumulatively through a bar and reset on its next downbeat. A continuous signature change rotates the face for 200 ms with WAAPI `transform` only; seeks snap directly, and reduced-motion disables the rotation. No React per-frame state or whole-page render is added. A stable localized image label is supplied in zh-CN, zh-TW, ja and en; beat changes are not a screen-reader live region.


Each lamp retains its existing halo/filament/core geometry. Only a newly lit current beat during continuous playback starts a one-shot WAAPI opacity ignition: 0 → peak at 40 ms → steady at 140 ms. Outer/inner halo peaks are 0.32/0.48 (steady 0.08/0.16), filament/core peaks are 1 (steady 0.85/0.9). Existing lit lamps do not restart on ordinary frames or polls. Animation handles identify the new ignitions and are removed on completion; snap, pause, seek, visibility changes, preference changes and cleanup cancel them. Same-meter downbeats reuse the first pip with a committed dark baseline, allowing repeated ignition while old high pips retain the 110 ms fade. Snapshot positioning never replays historical beats. No timer, extra RAF, per-frame React state, or animated filter/shadow/geometry is added.

The face and glow share a static 48/72 px size variable. The visible glow border uses border-box inset 1%, outer radius 23% of the face size, and border width 2%: exactly the SVG rect's outer 1..99 contour and radius 23. Its 2.4 s breath changes opacity only; the independent ambient colors retain 3.2/4.4 s motion. Root slot and caption dimensions do not enter contour calculations. On first initialization, inline glow opacity 0 is committed by one computed-opacity read before the BPM target is set. The active selector no longer supplies opacity 1. Later targets retarget the existing 180 ms CSS transition without resetting to zero; reduced motion sets the static target immediately without that initial read.

本轮 fake DOM 测试覆盖首次 0 基线先于目标、仅新拍冲亮、同拍型首点复用与重触发、普通 RAF 不重写、poll/暂停恢复/seek/隐藏/减效切换不补播，以及完成和卸载清理。真实 Chrome 脚本位于 `/root/odd-dice-work/bulb-overdrive/verify.cjs`：比对 390/640/1440px、DPR 1/2 的 SVG 实际描边外框与外光边缘、圆角，并跨完整呼吸周期验证无漂移。冷挂载时捕获实际生成的 CSS opacity transition，用动画检查器暂停并在 0/18/45/90/140/180ms 定点采样真实 computed opacity；自然 RAF 则记录多次灯点峰值、回落和同节点跨小节重触发，按实际 Animation 结束状态识别常亮，而非把 JS 属性写入时间当作 compositor 开始时间。另覆盖外光重入、暂停/seek/恢复、动态 reduced-motion，原光强、230 平台及工具栏脚本继续回归。API 为合成 fixture，所有写请求均拦截；这些是实际构建的浏览器验证，不代表真实 Spotify 设备的听感或帧率验收。

### 快速升 BPM 及 230 BPM 平台专属外发光

仅在现有 `getOddDiceMap` 歌曲、艺术家及完整版本校验通过后，页面向
`MeterDice` 注入稳定的模块级 `ODD_DICE_GLOW_WINDOWS`。通用组件的可选
`glowWindows` 默认不启用任何外光，不识别歌曲 ID 或艺术家。

| 段落 | 源视频区间（ms） | 播放区间（ms） |
| --- | --- | --- |
| 第一次加速及 230 BPM 平台 | [57866.667, 96566.667) | [55822.792, 94522.792) |
| 第二次加速及 230 BPM 平台 | [138966.667, 230933.333) | [136922.792, 228889.458) |

区间从首个上升读数起，覆盖随后的 230 BPM 恒速平台，直到首个非 230 的
authored tempoChanges 事件（终点不包含）：分别为 source 96566.667 / 145 BPM
和 230933.333 / 141 BPM。旧加速终点 68000、143833.333 不再熄灭，
有效 230 BPM frame 保持满强度；source [219200, 230933.333) 无拍区仍由
既有 frame 门控保持 off，不补拍。测试将固定终点与真实 tempo 事件核对，
覆盖平台前中后及全部有效拍点。真实 Chrome 平台专项脚本位于
`/root/odd-dice-work/glow-plateau/verify.cjs`，覆盖抵达 230 不闪断、平台满强度及流动、
首次非 230 淡出、无拍区、暂停/跨平台 seek 和移动/浅色/reduced-motion；
使用合成 API 状态，不代表 Spotify 真机听感验收。源区间固定，播放区间统一减去当前 map 的
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

外光强度与 caption 共用当前 source-authored BPM（同一次读取，强度使用未四舍五入值），
不按窗口经过时间计算。Odd Dice 使用
`0.2 + 0.8 * clamp((bpm - 165) / (230 - 165), 0, 1)`：
165 BPM 附近为 20%，230 BPM 附近为 100%；缺失、非有限或非正 BPM 为 0。
两个窗口内相同 BPM 对应相同强度，230 平台有效拍点保持 100%；窗口外仍为 0。
首个非 230 事件即时设置 off 目标，连续播放的视觉淡出仍使用原 180ms 过渡。
通用组件未传 resolver 时保留原 100% 强度。只写独立 glow span 的内联 opacity，
保留四位小数并规范化字符串，值未变不重复写入；不改变骰面、光点或 caption 亮度。
原 180ms opacity transition 平滑 BPM 阶梯，reduced-motion 禁过渡但仍采用当前 BPM 强度。
暂停保持当前强度，确认 seek 与可见性恢复直接读取目标 BPM，不补播旧阶梯；
轨道和呼吸周期保持不变。真实 Chrome 的强度专项脚本为
`/root/public-files/jplrc/odd-dice-glow-intensity/verify.cjs`：覆盖两段低/中/高 BPM、
跨窗口同 BPM 同强度、连续播放单调增强、实际 opacity 中间帧、反向 seek、
暂停和移动/浅色/reduced-motion。使用合成播放 API，加载真实构建产物；
不等同真实 Spotify 设备的同步或听感验收。
旧外光边界回归等待 computed opacity 到达当前 inline target 后再判断可见性，
而不是把 `data-glow` 已更新或固定 250ms 等待误当作 CSS 过渡已结束。

### 本地节拍器与交互放大

默认关闭，未交互不创建 AudioContext。fine mouse hover 开启、离开立即停音；
触屏/笔点击切换，不响应合成 hover，leave 不撤销触屏开关。原生 button 支持
Enter/Space，键盘模式 blur/Escape 关闭；内层 role=img 的稳定本地化 label 保留。
按钮启停、点击解锁与音频不可用提示覆盖 zh-CN/zh-TW/ja/en。
hover 不保证浏览器授权：suspended 时提示点击启用，桌面点击仅解锁 hover 模式；
触屏 click 同步创建/resume。失败 promise 已捕获，不保存设置。

声音只由既有 paint、playbackMsRef 和 authored getMeterFrame 驱动，没有新时钟、
RAF、BPM 推算或历史补播。连续采样的相邻新拍最多发声一次；减效仅禁视觉动画，
不禁声音。首次启用、快进/seek、轮询、暂停/恢复、隐藏恢复、无 frame 与错曲不补拍。
强拍 beatIndex=0 使用 1320Hz / 0.24，其他拍 880Hz / 0.14（峰值 amplitude 翻倍，非响度翻倍）；2ms 起音、35ms
衰减、40ms 停止。MeterMetronome 持有 oscillator/gain/context，停用立即 stop 和
断开声源，卸载 close；过期 resume 不能在关闭后重新发声。无网络资源或新增依赖。

未激活 trigger 基线为 52/78px，基础骰面仍为 48/72px。data-meter-visual 包住 face 与 glow，
以 `99% top`（可见描边右缘）为原点 scale(1.5) 放大至 72/108px；trigger 的 padding-inline-start
同步从 0 增至半个骰面（24/36px），实际外宽增至 76/114px，为向左扩展预留空间，
参与父级 flex 布局并推动左邻居，窄屏沿用现有换行。内部 52/78px 内容宽度不变。
两项均使用 200ms cubic-bezier(0.23, 1, 0.32, 1)，缩回和快速反向交由 CSS transition
从当前进度续接；减效同时禁用两项 transition，仍即时应用缩放及预留槽。
描边外缘是 viewBox 的 99%，故以该点而非透明 SVG 盒子的 100% 锚定，
使骰面可见右缘在放大、缩小及反向进度中保持不动；1% 透明留白不当作可见边缘。
描边与外光的归一化几何不变。
caption 保持字号并沿用原下移逻辑。放大后的 visual 保留 pointer hit test，
因此鼠标移到扩大的可见边缘仍保持 hover，真正离开才关闭。
提示放在放大后的 caption 下方。两个独立静态 blur wrapper 使用 1% inset，内部固定
圆角 viewport 以 overflow: clip 截住 full-size 光场旋转的几何溢出，外层再以静态
7px/6px blur 将边缘光投到不透明骰面外。光场中心在 50% 2%，分别以 3.2s 正向、
4.4s 反向旋转；禁止再内收光源至 15%（这会把可见光源藏进骰面）。固定轮廓仍为
1% inset / radius 23%，呼吸仅改变 opacity。每个 wrapper 有稳定的
`data-meter-light="primary"/"secondary"`，可逐层隔离进行实际像素运动验收。
局部 viewport 负责旋转几何裁切，不对整页裁切，也不改变 SVG card 透明度。
真实像素验收脚本在 `/root/odd-dice-work/light-orbits-volume/`：`capture_lights.cjs`
以实际 CSS 动画相位分别隔离主/次光源，`analyze_light_pixels.py` 只统计不透明 SVG
描边外框以外的截图像素。比较修复前后，并覆盖基础、桌面放大和手机放大，断言
外侧光斑有足够可见对比度和显著重心位移；不能再把 CSSAnimation 时间推进当作
可见光源运动。隔离时只隐藏无关光源/呼吸/文字，不生成或增强光晕像素。
同目录 `compare_volume.py` 将 NativeAudio 录音与修复前的实际录音比对，检查强/弱
拍峰值增益约两倍且无削波；不声称主观响度翻倍，也不等同 Spotify 真机延迟验收。
Chrome 脚本应使用 data-meter-trigger / visual / face / glow / caption 标记，
不再依赖 root.firstElementChild 或直系 SVG。地图字节、校准、平台窗口、灯泡和
外光周期及 toolbar 规则均未修改。

本轮增加 fake audio 的强弱拍、去重、非连续事件、清理、resume race 与错误测试，
以及实际组件事件/paint 的触屏、键盘、mouseleave 和 reduced-motion 发声测试。
真实 Chrome 脚本位于 `/root/odd-dice-work/interactive-metronome/verify.cjs`，覆盖原生
鼠标/触屏/键盘启停、放大中间帧与 hit test、320/390/640/768px 无溢出及相邻控件不遮挡、
暂停/恢复和 reduced-motion。autoplay 用全新 document 的 CDP `Runtime.evaluate`
显式 `userGesture:false` 与 mouseMoved 测试；不能用默认 Playwright evaluate，后者会
授予用户激活从而把“hover 被阻止”测成假通过。真实 AudioContext 的输出通过原生
MediaRecorder 录制到私有 `native-metronome.webm`，同目录 `analyze_audio.py` 解码并实测
FFT 与强弱拍幅度；解码保留 Opus 的时间戳空洞（aresample async），不把稀疏包当作
连续 PCM。不是 mock AudioContext，也不是生成的假录音。API 播放状态为合成 fixture，
不代表真实 Spotify 设备的端到端音频延迟或真机扬声器听感验收。

本次右上锚点回归为 CSS/源码合同测试：检查真实 padding 预留、flex 可增长、
两项过渡时长和缓动一致、减效同步禁动画，以及原 caption 位移与字号。
按用户要求，本次改动不运行浏览器/E2E。单元测试用现有 48/72px 骰面和 52/78px
基线槽建立增长/回退几何模型，并核对可见描边锚点、预留槽、相邻空间和相同过渡合同；
类型检查、完整构建及发布后 HTTP/产物检查另行执行。以上不等于真实渲染坐标验收，
历史浏览器结果也不作为这次布局改动的浏览器验证证据。
