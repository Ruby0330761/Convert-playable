# Meta 可玩广告转包流程

## 输入与依赖

- 输入为已经完成的 AppLovin 单 HTML，不从旧的 Meta 包再次转换。
- 保持关卡、背景、布局、图标、字体和调优参数；Android/iOS 使用各自的源包。
- 需要 Node.js、Python，以及 `convert-playable-ad-formats` 技能内的 `scripts/convert_playable_ad_format.py`。上游工具属于外部依赖，不包含在本仓库中。
- 默认上游工具位置为用户目录下 `.codex/skills/convert-playable-ad-formats/scripts/convert_playable_ad_format.py`；可通过 `--converter` 或 `PLAYABLE_CONVERTER` 指定。Python 可通过 `--python` 或 `PLAYABLE_PYTHON` 指定。

## 转包与命名

单包转换（横屏使用 landscape，双方向使用 both）：

```powershell
node scripts/convert-applovin-to-meta.js --input "applovin/Android/源包.html" --output-dir "meta/Android/目标包" --orientation portrait
```

产出 `meta.zip`、`package/` 和 `conversion-report.md`；交付 ZIP，报告和展开目录用于检查。

批量转换分类目录：

```powershell
node scripts/batch-meta-folders.js --input "D:/源素材/组一" --input "D:/源素材/组二" --output-dir "D:/交付/Meta素材"
```

- 每个输入组内应有 `applovin/Android/` 和/或 `applovin/IOS/`，只扫描 AppLovin HTML，原目录不变。批量工具当前固定竖屏；其他方向使用单包入口。
- 新命名保留其他字段，渠道 `AL` 改为 `FB`，设备字段为 `android` 或 `ios`；旧命名将 `_applovin_` 改为 `_meta_`。
- 交付位置为 `<输出目录>/<源组名>/meta/Android|iOS/<包名>.zip`，输出根目录同时生成清单和报告。重跑前核对目标同名文件确实属于本次交付。

## 包体规则

- ZIP 根目录必须有非空的 `index.html`、`index.js`、`style.css`，HTML 必须实际引用脚本和样式。
- 首个可执行内联脚本拆为 `index.js`，其余为 `runtime-N.js`；首个样式拆为 `style.css`，其余为 `style-N.css`。保留脚本位置、顺序、模块类型和 JSON 数据。
- 不对图片、模型、字体或真实音频做有损压缩；内嵌资源字节保留，仅将完整代码/样式块拆到包内文件。ZIP 变小是无损压缩，不代表删减资源。
- 可选的一字节空音频占位符在解码前改用一帧静音，真实音频不变。
- 当前门禁为 `index.html < 2,000,000` 字节、ZIP `<= 5,000,000` 字节、文件数少于 100；检查 ZIP 实际条目、包内引用和远程资源引用。
- 商店按钮调用 `FbPlayableAd.onCTAClick()`，移除继承的 JavaScript 跳转；实际商店目标由平台配置与宿主处理。

## 检查与验收

```powershell
node --test tests/test-meta-conversion-pipeline.js
node tests/smoke-meta-batch.cjs "D:/交付/Meta素材/meta-batch-manifest.json" "D:/交付/Meta素材/validation"
```

浏览器批测当前使用 Windows Edge、Codex 缓存中的 Playwright 和 Python；运行前需具备这些依赖，且清单里的源文件及 ZIP 路径仍然可用。批测核对资源 data URL、运行启动、字体状态、真实音频解码、车辆操作以及模拟宿主 CTA 调用；它记录页面异常与请求失败，不等于完整的控制台错误审计，也不等于官方验收。

解压后不能用双击 `index.html` 作为加载验收：外部模块脚本在 `file://` 下会被浏览器跨域策略拦截。应通过 HTTP 本地服务器打开完整解压目录，例如进入 `package` 目录运行 `python -m http.server 8000 --bind 127.0.0.1`，再访问 `http://127.0.0.1:8000/`。普通浏览器没有 Meta 宿主 API，不能用它确认真实商店跳转。

2026-10-16 对当时 32 个交付包的内嵌资源逐字节核对一致；五个代表包在 HTTP 下可启动，在 file:// 下受模块跨域限制。源 AppLovin 包也存在部分二进制 data URL 控制台报错，不能把这些信息说成转换后新增，也不能宣称零控制台错误。

最终必须上传完整 ZIP 到 Meta 官方 Playable Preview 或实际广告后台，检查加载、双方向布局、操作、音频与 CTA。官方环境未验收前，只能标记本地检查结果，不能承诺平台通过。
