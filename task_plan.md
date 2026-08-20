# Task Plan: AppLovin playable 转 Unity Ads playable

## Goal

## Session 2026-08-03: Integrate hardening into AppLovin-to-Unity conversion

### Phase 26: Conversion entrypoint audit
- [x] Inspect the upstream converter CLI and local runtime availability.
- [x] Define a fail-closed orchestration contract for one conversion output.
- **Status:** complete

### Phase 27: Pipeline integration
- [x] Add a single AppLovin-to-Unity command that runs conversion then hardening.
- [x] Scope hardening and report updates to the current output directory.
- [x] Document the integrated command as the required project workflow.
- **Status:** complete

### Phase 28: Pipeline regression coverage
- [x] Add tests for success, converter failure, and hardening failure.
- [x] Re-run existing six-output audits.
- **Status:** complete

### Phase 29: Delivery
- [x] Report the new command, guarantees, and runtime prerequisites.
- **Status:** complete

## Session 2026-07-30: Unity runtime hardening

### Phase 21: Generator and output audit
- [x] Locate Unity conversion, validation, and test code.
- [x] Measure loading DOM/payload order and audit CTA/lifecycle behavior.
- **Status:** complete

### Phase 22: Implement shared Unity wrapper
- [x] Put loading DOM before payload and defer activation until painted/viewable.
- [x] Add explicit mraid.js bootstrap, no-argument CTA, and persistent lifecycle.
- [x] Preserve errors and staged progress until first rendered frame.
- **Status:** complete

### Phase 23: Regression coverage and existing outputs
- [x] Add focused tests for all P0/P1 requirements.
- [x] Regenerate or migrate every current Unity output through the shared logic.
- **Status:** complete

### Phase 24: Verification
- [x] Run automated tests and static audits across every Unity index.html.
- [x] Record package size, CTA, external references, and remaining warnings.
- **Status:** complete

### Phase 25: Delivery
- [x] Summarize changes and residual Unity preview validation requirement.
- **Status:** complete

### New errors encountered
- 2026-08-03: A PowerShell `foreach` pipeline was parsed as an empty pipe element; collect rows before piping to JSON.
- 2026-08-03: A Markdown backtick in the report template was not escaped and broke Node parsing; escape both inline-code delimiters.
- 2026-08-03: The pipeline test fixture repeated the same unescaped-backtick issue; escape Markdown in nested template literals before executing tests.
- Parallel repository inspection aborted when one child command returned exit code 1; rerun with per-command error capture.
- `git status` reports this directory is not a valid Git worktree despite a `.git` directory; use file-level verification.
- Four planning patches could not match mojibake/position context; switched to isolated ASCII-only hunks.
- This PowerShell version does not support `Format-Hex -Count`; used byte-limited `Get-Content` instead.
- A whole-file regex audit timed out on minified 3 MB lines; use fixed markers and bounded scans in the migration script.
- First migration dry-run produced a validator false positive because it matched a bootstrap selector string as the payload tag; validate the concrete payload script element instead.
- PowerShell Start-Process hit a Path/PATH environment collision; launched the hidden Node preview server through System.Diagnostics.Process instead.
将指定的 AppLovin 单 HTML 可玩广告转换为可上传验证的 Unity Ads 单 HTML 版本，保持玩法不变并完成本地静态与运行时检查。

## Current Phase
Complete

## Phases

### Phase 1: 输入检查与需求确认
- [x] 检查源 HTML、工程状态与现有输出目录
- [x] 识别源包资源、CTA 桥接、启动流程和外链
- [x] 将发现记录到 findings.md
- **Status:** complete

### Phase 2: 机械转换与报告审阅
- [x] 运行格式转换脚本
- [x] 审阅 conversion-report.md
- [x] 确认生成物路径和初步大小
- **Status:** complete

### Phase 3: Unity 适配修补
- [x] 修补 Unity/MRAID CTA 与 viewable 启动门控
- [x] 清理不兼容的 AppLovin 包装或外链
- **Status:** complete

### Phase 4: 验证
- [x] 执行静态扫描、JavaScript 语法解析和 MRAID 门控逻辑测试
- [x] 记录包大小、文件数、CTA、外链和平台警告
- **Status:** complete

### Phase 5: 交付
- [x] 复核输出文件与报告
- [x] 向用户说明交付路径和 Unity 后台验证要求
- **Status:** complete

### Phase 6: RainBow 输入检查
- [x] 检查 RainBow 源文件大小、CTA、资源和现有输出目录
- [x] 记录 RainBow 特有发现
- **Status:** complete

### Phase 7: RainBow 机械转换
- [x] 运行 AppLovin -> Unity 转换脚本
- [x] 审阅转换报告
- **Status:** complete

### Phase 8: RainBow Unity 适配
- [x] 添加 MRAID ready/viewable 启动门控
- [x] 保持玩法与 CTA 逻辑不变
- **Status:** complete

### Phase 9: RainBow 验证
- [x] 验证 JS 语法、MRAID 门控、包大小与外链
- [x] 更新转换报告
- **Status:** complete

### Phase 10: RainBow 交付
- [x] 复核输出路径与平台警告
- [x] 向用户交付 Unity 单 HTML
- **Status:** complete

### Phase 11: 更新版 Rainbow 输入检查
- [x] 检查新源文件大小、时间、CTA 与资源结构
- [x] 对比上一版来源与输出摘要
- **Status:** complete

### Phase 12: 更新版 Rainbow 重转换
- [x] 重新运行 AppLovin -> Unity 转换脚本覆盖旧输出
- [x] 审阅新转换报告
- **Status:** complete

### Phase 13: 更新版 Rainbow Unity 适配
- [x] 重新添加 MRAID ready/viewable 启动门控
- [x] 保持更新后的玩法代码不变
- **Status:** complete

### Phase 14: 更新版 Rainbow 验证
- [x] 验证 JS、MRAID 门控、大小、CTA 与外链
- [x] 更新转换报告
- **Status:** complete

### Phase 15: 更新版 Rainbow 交付
- [x] 复核最终输出与平台警告
- [x] 向用户交付更新后的 Unity 单 HTML
- **Status:** complete

### Phase 16: DoubleRainbow 输入检查
- [x] 检查源文件大小、CTA、资源和输出目录
- [x] 记录 DoubleRainbow 发现
- **Status:** complete

### Phase 17: DoubleRainbow 机械转换
- [x] 运行 AppLovin -> Unity 转换脚本
- [x] 审阅转换报告
- **Status:** complete

### Phase 18: DoubleRainbow Unity 适配
- [x] 添加 MRAID ready/viewable 启动门控
- [x] 保持玩法代码与 CTA 不变
- **Status:** complete

### Phase 19: DoubleRainbow 验证
- [x] 验证 JS、MRAID 门控、大小、CTA 与外链
- [x] 更新转换报告
- **Status:** complete

### Phase 20: DoubleRainbow 交付
- [x] 复核最终输出与平台警告
- [x] 向用户交付 Unity 单 HTML
- **Status:** complete

## Key Questions
1. 源 playable 是否已完全内联，是否仍有外部网络请求？
2. 转换后 CTA 是否使用 `mraid.open()`，启动是否等待 `viewableChange=true`？
3. Unity 输出是否保持单 HTML 且能在本地 MRAID 模拟环境中启动？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 以单 HTML 形式输出 Unity 版本 | Unity 与 AppLovin 均适合单 HTML，能避免资源路径和打包问题 |
| 先运行技能转换脚本，再针对报告手工修补 | 保留玩法代码，最小化平台包装层变更 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| PowerShell 解析 `rg` 正则时因引号嵌套报错 | 1 | 拆分目录/规范读取和正则扫描；改用 PowerShell 单引号正则并避免内嵌双引号 |
| 系统 PATH 中没有 `python` 命令 | 1 | 改用 Codex 工作区内置 Python 运行时 |
| 启动本地 HTTP 服务的后台进程未保持运行 | 1 | 不重复后台服务方案，改由应用内浏览器直接加载本地 `file://` 页面 |
| 应用内浏览器安全策略禁止访问本地 `file://` 页面 | 1 | 遵守策略，不改用其他浏览器规避；改做静态结构、JS 语法与门控逻辑验证 |
| `apply_patch` 无法在 3 MB 单行压缩脚本内匹配 CTA 子串 | 1 | 不采用非规范写入方式；保留已被转换器认可的 `mraid.open()` CTA，不重复修改 |
| PowerShell 将 Node `-e` 多行脚本中的引号拆坏 | 1 | 改为通过标准输入将同一验证脚本传给 Node，不重复 `-e` 方式 |

## Notes
- 2026-07-16 error: expected `_RainBow/index.html` was absent during inspection; enumerate the actual Unity directory before rebuilding.
- 2026-07-16 error: one planning-file patch was malformed by an empty hunk; corrected with a targeted patch.
- 不承诺仅凭本地转换即可通过 Unity Ads 审核；最终仍需上传 Unity 预览器/验证器。
