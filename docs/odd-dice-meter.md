# Odd Dice 分段估算节拍

仅为 Odd Dice / millsage 的 248828 ms 录音启用，时长门控仍为 ±1000 ms；未知时长、错误歌曲、121 秒游戏版及 253 秒视频时长都不能启用。运行时已替换为最新 CSV 确定性生成的估算拍点，不再使用旧逐帧拍点或旧 BPM 读数。

## 来源与精度

来源为鹤翔万里的同人视频 [BV1YhJq6LE4Q](https://www.bilibili.com/video/BV1YhJq6LE4Q/)。作者说明完整版新增部分为耳听转录，不是官方乐谱。输入来自公开交付物 `odd_dice_full_sections.csv`，边界依据该交付物 README、index.html 第 3/4 节及 `full_version_metre_map.md`；导出器把 bpm_min/bpm_max 写入 bpmFrom/bpmTo，不能把它们当成有向端点。

原 CSV（包括 UTF-8 BOM）快照位于 `src/lib/meter-maps/odd-dice.full.sections.csv`。JSON 保存原字节 SHA-256、全部 32 行的字段、每行运行时裁剪区间、`sourceResolutionMs=500`、`estimated=true` 和生成假设。2 fps 的源段边界精度为 ±0.5 秒，源小节积分推算约 ±10%；生成时间的小数位只是数值序列化精度，不代表测量精度。所有运行时拍点都是估算，接受精度下降；旧 138 小节/733 个观测拍点不再是运行数据。

## 确定性算法与假设

- 相等 BPM 按常速处理，170、188 也是阶梯近似。第 18/28 段的 228–230 近似为 230 平台，不在整个 29/75.5 秒缓慢爬升。
- 第 31 段依据来源的 ritardando，按 232000–249500 ms 内 139→124 做线性时间渐慢；保持完整源端点，不因播放坐标映射缩短或重定时。
- 常速积分为 BPM × dt / 60000；线性速度积分为 (BPM × dt + slope × dt² / 2) / 60000。整数累计相位对应拍点，解二次式使用有理化正根，避免相消。仅离线生成，播放时二分查表；BPM 可在同一拍内线性读取。
- 同拍号跨速度段连续累计拍/小节相位。拍号变化和自由段后才以 CSV 边界重置，使用 7.5、9、11.5、96.5、121.5、125、229.5 秒等源边界，不吸附旧实测时间。
- 源视频 0–0.5 秒未知，500ms 起点不是实测下拍；保留播放零点之前的源拍点和小节。源 219–229.5 秒自由段映射为 Spotify 216090.909091–226590.909091ms，随后重入 3/4。
- 用户明确校准“Spotify 到 0:00 时，视频已到约 0:02.91”：两个 4/4 小节、8 个四分音符、开头 165 BPM。固定 `playbackToSourceOffsetMs = 8 * 60000 / 165 = 2909.090909090909ms`，`sourceVideoMs = spotifyPlaybackMs + offset`，不伸缩。此为手动锚点，不是全曲音频指纹验证。
- lookup 先校验 Spotify [0,248828)，再映射源时间；节拍与 BPM 共用映射，播放器、歌词、单时钟和 DOM 不变。源表保留从 500ms 开始的相位，生成上限为 251737.090909ms；源 249500ms 开始的自由尾段映射为 Spotify 246590.909091ms，此后直到录音末尾无拍/BPM。源推算小节数不参与凑整或压缩速度。
- JSON v2 的 `runtimeStartMs/runtimeEndMs` 为 Spotify 裁剪坐标；`sourceGenerationStartMs/sourceGenerationEndMs` 为源积分区间。`clipping` 分别记录播放窗口、源查询窗口、源生成窗口和原始源终点。校准依据与原 CSV hash、500ms 精度、estimated 标记一并保存。
- 每个同拍号连续区间尾部保留不足整小节的部分：`partial=true` 且小节和 map 都标记 `estimated=true`。保留真实分子，拍数组只有边界前实际生成的 1..N 拍；最后一拍被截短时即使拍数齐全也标记 partial。普通 map 仍必须拍数等于分子。尾部不留空白、不越界补拍。粗边界重置可能截短上一拍，因此跨拍号边界的间距不代表 BPM；同一连续相位内不会为凑拍制造密集点。

源 7500/9000/96500/121500ms 分别映射到 Spotify 4590.909091/6090.909091/93590.909091/118590.909091ms。源 240750ms（播放 237840.909091ms）仍为 131.5 BPM。Spotify 零点继承已有小节第 3 个亮点，不补假首拍。固定校准不消除粗分段估算误差，也未验证两音频全曲一致。

当前结果：**157 小节、766 个估算拍点、30 个速度段、24 个 partial 小节**。这些数量不是源视频的小节编号。

## 重建与验证

仅需仓库现有 Node 环境，无需私人素材、新依赖或网络：

```sh
node scripts/import-odd-dice-map.mjs
# 可选：显式 CSV 输入及输出路径
node scripts/import-odd-dice-map.mjs path/to/sections.csv path/to/map.json
node --experimental-strip-types --experimental-loader ./scripts/test-loader.mjs --test scripts/import-odd-dice-map.test.mjs src/lib/odd-dice.test.ts src/lib/meter-dice.test.ts
npx tsc --noEmit
```

脚本严格逐行检查列、数字、时间标签、编号、连续顺序、拍号、速度范围及源边界；全部生成成功才原子替换输出。相同输入生成 byte-identical JSON。专项测试核对全部源行、全部拍点积分及查询边界、裁剪、版本门控、partial 限定和无效合成 CSV 不覆盖有效输出。合成异常 fixture 不是实测谱。组件回归继续覆盖暂停、seek、visibility、reduced-motion 和灯泡行为。

本轮不启动浏览器/服务，不进行真实 Spotify 设备听感验证；宿主父进程负责串行 `npm run check`、`npm run build` 和最终发布。未复制音视频、notes 或游戏版数据。

## Presentation

The 48 px die sits at the right end of the song information header, with a **current BPM** caption below (not a redundant time-signature label). The caption reads the source tempo timeline from the same playback clock and may change within a beat without rebuilding or rotating the face. Standard 1–6 die faces light cumulatively through a bar and reset on its next downbeat. A continuous signature change rotates the face for 200 ms with WAAPI `transform` only; seeks snap directly, and reduced-motion disables the rotation. No React per-frame state or whole-page render is added. A stable localized image label is supplied in zh-CN, zh-TW, ja and en; beat changes are not a screen-reader live region.


Each lamp has a warm filament and pale hot core, surrounded by two subtle static halo layers. Only opacity transitions: 140 ms to light and 110 ms of afterglow to fade, both using `cubic-bezier(0.23, 1, 0.32, 1)`. Transitions run only during continuous playback. On a same-meter downbeat the existing first pip commits a dark baseline, then warms again; the remaining old pips fade out without rebuilding the face. New faces also commit a dark baseline before lighting. Pause, seek, visibility restoration and other discontinuities snap directly to the current position; reduced motion also disables lamp transitions. There is no pulse or additional timer. DOM regressions observe the committed dark baseline and retained old lights, but no browser or real-device feel validation has been performed.
