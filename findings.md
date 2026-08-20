# Findings & Decisions

## 2026-08-03 pipeline integration
- The repository currently contains the Unity hardening postprocessor and tests, but no local AppLovin-to-Unity conversion entrypoint.
- The upstream conversion skill still describes Unity runtime patching as a manual post-report step, so future conversions can bypass the required fixes.
- Integration must keep the confirmed no-argument `mraid.open()` rule and must fail the overall conversion when hardening or validation fails.
- The upstream converter always writes Unity single-HTML output to `<output-dir>/index.html`, returns zero even when Unity runtime patching is only a warning, and does not apply the required wrapper.
- All six current AppLovin sources have exactly one direct `type="module"` script, one `.ready?.finally(...)` loader hook, one MRAID CTA, and a body/loading DOM after roughly 3.0-3.36 MB.
- The hardener can safely support fresh outputs by selecting the unique module containing the ready hook; ambiguous or changed templates must fail closed.
- The bundled Codex Python runtime is available at `C:/Users/15389/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`; the project command should also support explicit and PATH-based Python selection.
- The integrated command now runs mechanical conversion, scoped Unity hardening, and a second fail-closed validation pass; it refuses ambiguous output layouts.
- A real Heart conversion with the upstream Python script succeeded: final size 3,589,995 bytes, loader at byte 13,177, payload at byte 253,233, one mraid.js declaration, one no-argument CTA, and no ready.finally.
- The integrated report removes the stale manual viewable-patching warning and appends the verified hardening contract. The upstream scanner still emits 51 known Base64 false-positive external-reference warnings.
- Final regression passes: four Node syntax checks, six existing-output audits, MRAID lifecycle mock, integrated success, upstream converter failure, and incompatible-template hardening failure.
- Integrated output directories must contain exactly one final `index.html` outside `_work`; stale extra HTML causes a deliberate failure rather than ambiguous delivery.

## 2026-07-30 Unity hardening requirements
- All Unity outputs derived from the AppLovin template are in scope.
- Loading DOM must precede the large inline payload; activation waits for two animation frames after viewable=true.
- Loading UI remains through errors and fades only after a confirmed first rendered frame; progress must update in stages.
- Unity outputs must explicitly reference `mraid.js`; per the user's latest override, CTA stays as no-argument `mraid.open()` and remains click-only.
- MRAID ready/viewable listeners stay active; viewable=false pauses animation, WebAudio, long-press timers, and transient input, while viewable=true resumes them.
- No-MRAID local fallback remains supported without changing the Unity path.
- The user's latest instruction resolves the CTA conflict in favor of the conversion skill's legacy Unity `mraid.open()` rule.

## 2026-07-30 audit results
- Six final Unity HTML files are in scope; sizes range from 3,072,540 to 3,659,509 bytes.
- No local converter or test suite exists in this workspace; only final HTML, `_work` intermediates, and conversion reports are present.
- Every final HTML places `<body>` and `#loading-screen` after roughly 3.0-3.37 MB of inline code/data and lacks `<script src="mraid.js"></script>`.
- Four variants store payload as delayed text; two use a custom inert script type. Both forms are safe to normalize into one delayed-module format near the end of `<body>`.
- Every payload assigns an asset-loading Promise to a view object's `.ready`, then uses `.ready?.finally(...)` to force progress to 100 and remove the loading screen even on failure.
- Existing modules contain Android Google Play and iOS App Store URL selection. Four currently call `mraid.open(url)` and two already call `mraid.open()`; all will be normalized to no-argument calls per the user override while leaving the selection data intact.
- The game loop uses `requestAnimationFrame`; audio contexts and long-press/reset timers are created inside the module, so a pre-module runtime shim can pause/resume these resources without editing gameplay logic broadly.

## 2026-07-30 implementation and browser verification
- All six final HTML files now place `<body>` and the loader at about byte 13,161, before payload scripts that begin around byte 30,146 or 252,592-253,233.
- Final sizes are 3,014,970 to 3,600,919 bytes, below the 5 MiB Unity limit.
- Each output contains one explicit `mraid.js` reference, one no-argument `window.mraid.open()` call, a persistent viewable listener, ready.then error handling, staged progress, and first-frame fade logic.
- Node static audit and MRAID lifecycle mock pass across all six outputs.
- Desktop browser check rendered a nonblank 2560x1440 canvas after the loader faded; mobile 390x844 check also rendered without overlap.
- Browser console contains pre-existing Three.js texture/FBX compatibility warnings, but no playable startup error.
- Final-artifact-only scan reports no parameterized CTA, legacy ready.finally, or missing-mraid.js warning. Raw `_work` conversion caches remain intentionally unchanged and are not delivery files.

## Requirements
- 2026-07-17 新任务：将 `applovin/Bus Fever - Car Jam Escape Playable_applovin_DoubleRainbow.html` 转换为独立 Unity Ads 单 HTML。
- 2026-07-16 更新任务：以 `applovin/Bus Fever - Car Jam Escape Playable_applovin_Rainbow.html` 重新生成 Unity Rainbow 包，替换上一版转换结果。
- 2026-07-16 新任务输入：`applovin/Bus Fever - Car Jam Escape Playable_applovin_RainBow.html`
- 新任务输出：独立的 Unity Ads 单 HTML RainBow 变体。
- 输入：`applovin/Bus Fever - Car Jam Escape Playable_applovin_Fish.html`
- 输出：Unity Ads 可玩广告，默认保持单 HTML 交付。
- 保持玩法逻辑不变，只调整平台桥接、启动门控和交付包装。

## Research Findings
- DoubleRainbow 最终 Unity 包大小 3,659,509 bytes，SHA-256 `376A114BB38B98094D849FCCCBF8A97A9831CE2A4FE1D8BF328806E6113AC6EA`。
- DoubleRainbow JS/MRAID mock 验证通过：ready 前和 viewable=false 不启动，viewable=true 后启动，无 MRAID 回退通过。
- DoubleRainbow 最终静态检查：`mraid.open()` 1 处、viewable 门控存在、远程资源属性 0、无 XHR/WebSocket/sendBeacon。
- DoubleRainbow WebAudio 未发现显式 `visibilitychange` 背景暂停逻辑，需 Unity 预览器验证切后台/关闭音频。
- DoubleRainbow 机械转换输出为 3,657,188 bytes、单 `index.html`，CTA 检测为 `mraid.open()`。
- 报告产生 51 条警告，仍以 Base64 `//...` 误报为主；实际需修补的 Unity 警告是 viewable 启动门控。
- DoubleRainbow 源文件大小 3,653,268 bytes、SHA-256 `041493FEB89FB3714FBF72CEFB2D4E6C7D2CED5006BF166C5412B720FCF83EE5`，低于 Unity 5MB 限制。
- DoubleRainbow 是单 `type="module"` HTML，含 1 处 `mraid.open()`，无 viewable 门控，远程资源属性为 0。
- `_DoubleRainbow` Unity 输出目录尚不存在，可安全新建。
- 更新版最终 Unity 包大小 3,645,828 bytes，SHA-256 `E53359BBB4963081650F372175CCB19B3415D7F0C78E076B12BBCDD226F65818`，与上一版 Unity 哈希不同。
- 更新版 JS/MRAID mock 验证通过：ready 前和 viewable=false 均不启动，viewable=true 后启动，无 MRAID 回退通过。
- 更新版最终静态检查：`mraid.open()` 1 处、viewable 门控存在、远程资源属性 0、无 XHR/WebSocket/sendBeacon。
- 仍未发现 WebAudio `visibilitychange` 背景暂停逻辑，需 Unity 预览器验证切后台/关闭音频。
- 更新版机械转换输出为 3,643,507 bytes、单 `index.html`，CTA 检测为 `mraid.open()`。
- 新报告仍有 51 条警告，Base64 `//...` 误报模式不变；实际需处理的 Unity 警告仍是 viewable 启动门控。
- 更新版 Rainbow 当前大小 3,639,587 bytes、SHA-256 `A02356D125E572954D6F9ECBB36218941C171206F713DBCAAFDC4E2F47716E1C`，与上一轮记录的 3,639,705 bytes 不同。
- Windows 大小写不敏感，`..._RainBow.html` 与 `..._Rainbow.html` 实际为同一路径；旧源内容已被更新版直接替换，无法再做逐字节旧源对比。
- 当前 Unity 目录只有普通、Fish、Hard 三个变体，上一轮 Rainbow 输出已不存在；本轮将干净新建 `_Rainbow` 输出。
- 更新版仍为单 `type="module"` HTML，含 1 处 `mraid.open()`，无 viewable 门控，远程资源属性为 0。
- RainBow 最终包大小 3,645,946 bytes，SHA-256 为 `2BB68303F5BBB1535B01C1647D322F0B36AA10921F106BEEFAF3747029E12C2A`。
- RainBow JS 验证通过：bootstrap 与 gameplay module 均能解析；MRAID ready 前和 viewable=false 时不启动，viewable=true 后启动；无 MRAID 回退通过。
- RainBow 最终静态检查：单个包文件、`mraid.open()` 1 处、远程资源属性 0、无 XHR/WebSocket/sendBeacon。
- RainBow WebAudio 未发现显式 `visibilitychange` 背景暂停逻辑，需在 Unity 预览器验证切后台/关闭音频。
- RainBow 转换输出初始大小 3,643,625 bytes，文件数 1，CTA 识别为 `mraid.open()`。
- 转换报告同样产生 51 条警告；多数为内联 Base64 中 `//...` 的误报，唯一需修补的实际 Unity 警告是缺少 `viewableChange=true` 启动门控。
- RainBow 源文件大小为 3,639,705 bytes，低于 Unity `<5MB` 限制。
- RainBow 为单内联 `type="module"` 脚本，含 1 处 `mraid.open()`，尚无 `viewableChange` 门控。
- RainBow 资源标签无远程加载属性；人类可读 URL 仅为 XHTML 命名空间与 Google Play / App Store CTA。
- `unity/Bus Fever - Car Jam Escape Playable_unity_RainBow` 尚不存在，可安全新建。
- `convert-playable-ad-formats` 规定 Unity CTA 使用 `mraid.open()`。
- Unity 目标应等待 MRAID `viewableChange=true` 后启动。
- 交付时必须报告包类型、路径、大小、CTA、外链和转换警告。
- 源文件大小为 3,630,878 bytes，低于 Unity 单 HTML `<5 MB` 限制。
- 源文件含 `mraid.open()`；Google Play / App Store URL 作为 CTA 目标存在。
- 现有 `unity` 目录包含普通版与 Hard 版旧输出，本次将使用独立的 `Bus Fever - Car Jam Escape Playable_unity_Fish` 目录，避免覆盖。
- 工作目录内存在 `.git` 目录但当前并非可识别的 Git 工作树，因此后续以逐文件清单验证改动。
- 转换脚本生成 `unity/Bus Fever - Car Jam Escape Playable_unity_Fish/index.html`，初始大小 3,634,798 bytes，文件数 1，CTA 识别为 `mraid.open()`。
- 报告产生 51 条警告：绝大多数来自内联 Base64 数据中的 `//...` 被外链正则误判；真正的人类可读 URL 是应用商店 CTA、`itms-apps` CTA 和 XHTML 命名空间。
- 输出只有一个内联 `type="module"` 脚本，位于 `<head>`，当前未包含 `viewableChange`、`mraid.addEventListener` 或 `mraid.getState`，必须手工添加 Unity 启动门控。
- 手工门控后文件大小为 3,637,119 bytes；所有 `script/link/img/audio/video/source` 资源属性均为内联 data URL 或无外部属性，没有远程资源加载标签。
- 代码含通用 `fetch` 加载器，但资产地址为 data URL；另有仅供编辑器同步关卡使用的相对路径 `POST /__playable-level` 分支，未发现远程 XHR/WebSocket/sendBeacon。
- WebAudio 仅在用户交互后 `resume()`，未发现显式的 `visibilitychange`/`document.hidden` 背景暂停逻辑，因此仍需在 Unity 预览器实测切后台与关闭场景音频。
- 最终包大小 3,637,119 bytes，SHA-256 为 `FA79CA42B4E4E2C93C33D89BCF1D9988A8CEF9EDE65D3084393E7A47A0EE52EB`。
- 最终静态检查：package file count 1、`mraid.open()` 1 处、`viewableChange` 门控存在、远程资源属性 0。
- Node 验证：bootstrap 与 module 语法均通过；模拟 MRAID 下 ready 前和 viewable=false 均不启动，viewable=true 后启动；无 MRAID 回退通过。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 输出到工程的 `unity` 目录 | 与现有目录布局一致，便于对照源文件和交付物 |
| 新建 `_Fish` 变体目录 | 避免覆盖已有普通版和 Hard 版输出 |
| 将玩法 module 暂存为非执行脚本，满足 DOM ready 与 MRAID viewable 后再动态注入执行 | 不改动 3.3 MB 的玩法代码主体，同时保证 Unity 生命周期要求 |
| 保留原有无参数 `mraid.open()` | 转换器已识别为合格 Unity CTA；避免用非规范方式重写 3 MB 单行压缩玩法代码 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 预期旧 `_RainBow/index.html` 不存在 | 先枚举当前 Unity 目录，不依赖旧输出，按更新源包重建 |
| 一次规划文件补丁包含空 hunk | 改用有明确上下文的目标补丁 |
| 一次组合扫描命令中的正则引号与 PowerShell 冲突 | 拆分命令并简化正则转义，不重复原命令 |
| 系统 PATH 未提供 Python | 使用 Codex 工作区内置依赖运行时 |
| 工具会话未能保持本地 HTTP 后台进程 | 改用应用内浏览器的本地文件加载能力测试 |
| 应用内浏览器策略禁止本地 `file://` URL | 不绕过浏览器策略；使用静态/语法/逻辑验证，并保留 Unity 官方预览器验证要求 |
| `apply_patch` 无法匹配压缩脚本行内 CTA 子串 | 停止该可选修改，保留转换器认可的 `mraid.open()` |
| PowerShell 原生参数解析破坏 Node `-e` 多行代码 | 使用 stdin 传递代码以保留引号和换行 |

## Resources
- `C:/Users/15389/.codex/skills/convert-playable-ad-formats/SKILL.md`
- `C:/Users/15389/.codex/skills/convert-playable-ad-formats/references/platform-format-matrix.md`
- `D:/WorkPlace/Playable/Convert-playable/applovin/Bus Fever - Car Jam Escape Playable_applovin_Fish.html`

## Visual/Browser Findings
- 暂无。
