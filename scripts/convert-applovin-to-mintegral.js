#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPORT_MARKER = "<!-- mintegral-runtime-adaptation-v1 -->";
const STRUCTURED_CLONE_MARKER = "mintegral-structured-clone-compat-v1";
const MINTEGRAL_ZIP_ROOT = "mintegral";
const MINTEGRAL_MAIN_HTML = "mintegral.html";
const DEFAULT_CONVERTER = path.join(
  os.homedir(),
  ".codex",
  "skills",
  "convert-playable-ad-formats",
  "scripts",
  "convert_playable_ad_format.py"
);
const BUNDLED_PYTHON = path.join(
  os.homedir(),
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "python",
  process.platform === "win32" ? "python.exe" : "bin/python"
);

function usage() {
  return [
    "Usage:",
    "  node scripts/convert-applovin-to-mintegral.js --input <applovin.html> --output-dir <directory> [options]",
    "",
    "Options:",
    "  --orientation <portrait|landscape|both>  Default: both",
    "  --python <executable>                    Override Python runtime",
    "  --converter <path>                      Override upstream converter"
  ].join("\n");
}

function parseArgs(argv) {
  const options = { orientation: "both" };
  const valueOptions = new Set(["--input", "--output-dir", "--orientation", "--python", "--converter"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (options.help) return options;
  if (!options.input) throw new Error("--input is required");
  if (!options.outputDir) throw new Error("--output-dir is required");
  if (!["portrait", "landscape", "both"].includes(options.orientation)) {
    throw new Error(`Unsupported orientation: ${options.orientation}`);
  }
  return options;
}

function canExecute(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function resolvePython(explicitPython) {
  const candidates = [explicitPython, process.env.PLAYABLE_PYTHON, BUNDLED_PYTHON, "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    if (canExecute(candidate)) return candidate;
  }
  throw new Error("Python runtime not found. Pass --python or set PLAYABLE_PYTHON.");
}

function resolveConverter(explicitConverter) {
  const converter = path.resolve(explicitConverter || process.env.PLAYABLE_CONVERTER || DEFAULT_CONVERTER);
  if (!fs.existsSync(converter) || !fs.statSync(converter).isFile()) {
    throw new Error(`Upstream converter not found: ${converter}`);
  }
  return converter;
}

function runConverter({ python, converter, input, outputDir, orientation }) {
  const result = spawnSync(python, [
    converter,
    "--input", input,
    "--source-platform", "applovin",
    "--target-platform", "mintegral",
    "--output-dir", outputDir,
    "--orientation", orientation
  ], { stdio: "inherit" });
  if (result.error) throw new Error(`Unable to start upstream converter: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Upstream converter failed with exit code ${result.status}`);
}

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function replaceMintegralCtaGuards(html) {
  let next = html;
  const guardPatterns = [
    /if\s*\(\s*window\.mraid\?\.\s*open\s*\)\s*\{/g,
    /if\s*\(\s*window\.mraid\s*&&\s*window\.mraid\.open\s*\)\s*\{/g,
    /if\s*\(\s*mraid\s*&&\s*mraid\.open\s*\)\s*\{/g
  ];
  for (const pattern of guardPatterns) next = next.replace(pattern, "{");
  next = next.replace(/window\.mraid\.open\s*\([^)]*\)/g, "window.install();");
  next = next.replace(/\bmraid\.open\s*\([^)]*\)/g, "window.install();");

  // Mintegral requires the guarded CTA expression so local previews remain
  // safe when the platform bridge is absent. Normalize direct and bare calls,
  // while leaving an existing guarded expression untouched.
  next = next.replace(/window\.install\s*\(\s*\)\s*;?/g, (match, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 32), offset);
    if (/window\.install\s*&&\s*$/.test(prefix)) return match;
    return "window.install && window.install();";
  });
  next = next.replace(/(?<![\w.$])install\s*\(\s*\)\s*;?/g, (match, offset, source) => {
    const prefix = source.slice(Math.max(0, offset - 32), offset);
    if (/window\.install\s*&&\s*$/.test(prefix)) return match;
    return "window.install && window.install();";
  });
  return next;
}

function patchMintegralEndCardGate(html) {
  if (!html.includes('id="game-over-overlay"') || !html.includes('id="cta-button"')) {
    throw new Error("Mintegral source is missing the built-in game-over end card or CTA.");
  }

  // The playable's install gate is useful for other channels, but Mintegral
  // requires a visible result screen before any store bridge is invoked.
  const clickGate = /return\s+F\?\.ok&&h\(N\)&&Ga\(\),F/;
  const pointerGate = /if\(e\.shouldOpenStore\(\)\)\{N\.stopImmediatePropagation\(\),Ga\(\);return\}/;
  if (!clickGate.test(html)) {
    throw new Error("Mintegral install gate click path was not found.");
  }
  if (!pointerGate.test(html)) {
    throw new Error("Mintegral install gate pointer path was not found.");
  }

  // Pass an empty title for the mid-game gate and promote the ready classes in
  // the same turn. This keeps the overlay/logo/CTA/gameEnd behavior without a
  // black-only interval or a misleading "Game Over" failure message.
  const showMidgameCard = 'I(""),Rt?.classList.add("is-title-fading","is-cta-ready")';
  let next = html.replace(clickGate, `return F?.ok&&h(N)&&(${showMidgameCard}),F`);
  next = next.replace(pointerGate, `if(e.shouldOpenStore()){N.stopImmediatePropagation(),${showMidgameCard};return}`);
  return next;
}

function stripMintegralModuleSyntax(html) {
  let next = html;
  // The upstream Vite bundle is module-free after conversion, so expose it as
  // a classic script for PlayTurbo/Mindworks validators.
  // Module scripts in <head> are deferred by definition. Keep that timing
  // when converting the bundle to a classic script so the gameplay DOM exists.
  next = next.replace(/<script([^>]*?)\s+type=["']module["']([^>]*)>/gi, (match, before, after) => {
    const attributes = `${before}${after}`;
    return /\bdefer(?:\s*=|\s|>)/i.test(attributes)
      ? `<script${attributes}>`
      : `<script defer${attributes}>`;
  });
  next = next.replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi, "");
  next = next.replace(
    /\(function\(\)\{const e=document\.createElement\(["']link["']\)\.relList;[\s\S]*?\}\)\(\);/g,
    ""
  );
  if (!next.includes(STRUCTURED_CLONE_MARKER)) {
    const cloneCompat = `/* ${STRUCTURED_CLONE_MARKER} */
if (typeof window.structuredClone !== 'function') {
  window.structuredClone = function structuredClone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  };
}`;
    next = next.replace(/<script\s+defer>/i, (match) => `${match}\n${cloneCompat}\n`);
  }
  if (/type=["']module["']|modulepreload/i.test(next)) {
    throw new Error("Mintegral HTML still contains forbidden module syntax.");
  }
  return next;
}

function normalizeMintegralPackage(packageDir) {
  const legacyIndexPath = path.join(packageDir, "index.html");
  const mainPath = path.join(packageDir, MINTEGRAL_MAIN_HTML);
  if (!fs.existsSync(legacyIndexPath)) {
    if (!fs.existsSync(mainPath)) throw new Error(`Mintegral package HTML is missing: ${legacyIndexPath}`);
    return mainPath;
  }
  if (fs.existsSync(mainPath)) fs.rmSync(mainPath);
  fs.renameSync(legacyIndexPath, mainPath);
  return mainPath;
}

function deferMintegralBootstrap(html) {
  const marker = "RM(zM);";
  const occurrences = (html.match(/RM\(zM\);/g) || []).length;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one Mintegral bootstrap call; found ${occurrences}.`);
  }
  const deferredStart = "(() => { const start = () => RM(zM); if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start(); })();";
  return html.replace(marker, deferredStart);
}

function moveMintegralBootstrapAfterBody(html) {
  const match = html.match(/<script\s+defer>([\s\S]*?)<\/script>/i);
  const bodyEnd = html.toLowerCase().lastIndexOf("</body>");
  if (!match || bodyEnd < 0) return html;
  const scriptTag = match[0];
  const withoutHeadScript = html.replace(scriptTag, "");
  const finalBodyEnd = withoutHeadScript.toLowerCase().lastIndexOf("</body>");
  if (finalBodyEnd < 0) return withoutHeadScript;
  return `${withoutHeadScript.slice(0, finalBodyEnd)}${scriptTag}\n${withoutHeadScript.slice(finalBodyEnd)}`;
}

function mintegralLifecycleScript() {
  return `<script>${REPORT_MARKER}
(() => {
  if (typeof window.gameStart !== 'function') window.gameStart = function gameStart() {};
  if (typeof window.gameClose !== 'function') window.gameClose = function gameClose() {};
  let readySent = false;
  let startSent = false;
  let endSent = false;
  let closeSent = false;
  const emitReadyAndStart = () => {
    if (!readySent) { readySent = true; window.gameReady && window.gameReady(); }
    if (!startSent) { startSent = true; window.gameStart && window.gameStart(); }
  };
  const syncLoading = () => {
    const loading = document.querySelector('#loading-screen');
    if (!loading || loading.hidden || loading.classList.contains('is-hidden')) emitReadyAndStart();
  };
  const emitEnd = () => {
    if (!endSent) { endSent = true; window.gameEnd && window.gameEnd(); }
  };
  const emitClose = () => {
    if (!closeSent) { closeSent = true; window.gameClose && window.gameClose(); }
  };
  const init = () => {
    syncLoading();
    const loading = document.querySelector('#loading-screen');
    if (loading) new MutationObserver(syncLoading).observe(loading, { attributes: true, attributeFilter: ['class', 'hidden'] });
    const resultOverlay = document.querySelector('#game-over-overlay');
    if (resultOverlay) new MutationObserver(() => { if (!resultOverlay.hidden) emitEnd(); }).observe(resultOverlay, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('click', (event) => {
      if (event.target.closest('#end-reset-button, #reset-button')) window.gameRetry && window.gameRetry();
    }, { capture: true });
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') emitClose(); });
  window.addEventListener('pagehide', emitClose, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
</script>`;
}

function patchIndexHtml(indexPath) {
  let html = fs.readFileSync(indexPath, "utf8");
  html = stripMintegralModuleSyntax(html);
  html = moveMintegralBootstrapAfterBody(html);
  if (/RM\(zM\);/.test(html)) html = deferMintegralBootstrap(html);
  html = replaceMintegralCtaGuards(html);
  html = patchMintegralEndCardGate(html);
  if (!/\binstall\s*\(/.test(html)) {
    throw new Error("Mintegral CTA bridge install() was not detected after conversion.");
  }
  if (!html.includes('id="game-over-overlay"') || !html.includes('id="cta-button"')) {
    throw new Error("Mintegral end card or CTA is missing after conversion.");
  }
  if (!/<\/body>/i.test(html)) throw new Error("Mintegral package is missing </body>.");
  if (!html.includes(REPORT_MARKER)) {
    html = html.replace(/<\/body>/i, `${mintegralLifecycleScript()}\n</body>`);
  }
  fs.writeFileSync(indexPath, html, "utf8");
}

function rewriteZip(python, packageDir, zipPath) {
  const script = [
    "import pathlib, sys, zipfile",
    "root = pathlib.Path(sys.argv[1])",
    "target = pathlib.Path(sys.argv[2])",
    "with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:",
    "    archive_root = target.stem",
    "    for path in sorted(root.rglob('*')):",
    "        if path.is_file(): archive.write(path, f'{archive_root}/{path.relative_to(root).as_posix()}')"
  ].join("\n");
  const result = spawnSync(python, ["-c", script, packageDir, zipPath], { encoding: "utf8" });
  if (result.error) throw new Error(`Unable to rebuild Mintegral ZIP: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to rebuild Mintegral ZIP: ${(result.stderr || result.stdout || "").trim()}`);
}

function assertZipShape(python, zipPath) {
  const zipStem = path.basename(zipPath, path.extname(zipPath));
  if (zipStem !== MINTEGRAL_ZIP_ROOT) {
    throw new Error(`Mintegral ZIP must be named ${MINTEGRAL_ZIP_ROOT}.zip; found ${path.basename(zipPath)}.`);
  }
  const script = [
    "import json, pathlib, sys, zipfile",
    "with zipfile.ZipFile(pathlib.Path(sys.argv[1]), 'r') as archive:",
    "    print(json.dumps(sorted(info.filename for info in archive.infolist() if not info.is_dir())))"
  ].join("\n");
  const result = spawnSync(python, ["-c", script, zipPath], { encoding: "utf8" });
  if (result.error) throw new Error(`Unable to inspect Mintegral ZIP: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Unable to inspect Mintegral ZIP: ${(result.stderr || result.stdout || "").trim()}`);
  let entries;
  try {
    entries = JSON.parse((result.stdout || "").trim());
  } catch (error) {
    throw new Error(`Unable to parse Mintegral ZIP entries: ${error.message}`);
  }
  const expected = [`${MINTEGRAL_ZIP_ROOT}/${MINTEGRAL_MAIN_HTML}`];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw new Error(`Mintegral ZIP must contain exactly ${expected[0]}; found ${entries.join(", ") || "no files"}.`);
  }
}

function detectExternalRefs(html) {
  const refs = (html.match(/(?:https?:)?\/\/[^"'\s)<>]+/gi) || [])
    .filter((ref) => {
      if (!ref.startsWith("//")) return true;
      return /^\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/|$)/.test(ref) && ref.length <= 300;
    });
  return [...new Set(refs)];
}

function assertOutput(outputDir) {
  const packageDir = path.join(outputDir, "package");
  const indexPath = path.join(packageDir, MINTEGRAL_MAIN_HTML);
  const zipPath = path.join(outputDir, "mintegral.zip");
  if (!fs.existsSync(indexPath)) throw new Error(`Mintegral package HTML is missing: ${indexPath}`);
  if (!fs.existsSync(zipPath)) throw new Error(`Mintegral ZIP is missing: ${zipPath}`);
  const files = walkFiles(packageDir);
  const relativeFiles = files.map((file) => path.relative(packageDir, file).replaceAll(path.sep, "/"));
  if (!relativeFiles.includes(MINTEGRAL_MAIN_HTML)) {
    throw new Error(`Mintegral package must contain ${MINTEGRAL_MAIN_HTML}.`);
  }
  if (relativeFiles.length !== 1 || relativeFiles[0] !== MINTEGRAL_MAIN_HTML) {
    throw new Error(`Mintegral package must contain only ${MINTEGRAL_MAIN_HTML}; found ${relativeFiles.join(", ")}.`);
  }
  return { packageDir, indexPath, zipPath, files };
}

function writeReport({ input, output, orientation, packageSize, fileCount, externalRefs }) {
  const warnings = [];
  for (const ref of externalRefs) warnings.push(`External reference remains: ${ref}`);
  const lifecycle = ["gameReady", "gameStart", "gameEnd", "gameClose", "gameRetry"];
  const html = fs.readFileSync(output.indexPath, "utf8");
  for (const name of lifecycle) {
    if (!html.includes(name)) warnings.push(`Mintegral lifecycle hook not detected: ${name}`);
  }
  const lines = [
    "# AppLovin To Mintegral Conversion Report",
    "",
    `- Source platform: \`applovin\``,
    `- Target platform: \`mintegral\``,
    `- Input: \`${input}\``,
    `- Output package: \`${output.zipPath}\``,
    `- Orientation: \`${orientation}\``,
    `- Package size: \`${packageSize}\` bytes`,
    `- ZIP file count: \`${fileCount}\``,
    `- ZIP root: \`${MINTEGRAL_ZIP_ROOT}/${MINTEGRAL_MAIN_HTML}\` (verified)`,
    "- CTA bridge: `window.install && window.install()`",
    "- Lifecycle bridge: `gameReady`, `gameStart`, `gameEnd`, `gameClose`, `gameRetry`",
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- None from integrated conversion."]),
    "",
    REPORT_MARKER,
    "",
    "## Manual Validation",
    "",
    "- Upload the ZIP to Mintegral's playable preview or validator.",
    "- Confirm the built-in result screen appears without a failure title before its `window.install && window.install()` CTA opens the store in the real Mintegral runtime.",
    "- Confirm lifecycle callbacks and audio behavior on start, end, retry, and close."
  ];
  fs.writeFileSync(path.join(output.outputDir, "conversion-report.md"), `${lines.join("\n")}\n`, "utf8");
  return warnings;
}

function runPipeline(options) {
  const input = path.resolve(options.input);
  const outputDir = path.resolve(options.outputDir);
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  const python = resolvePython(options.python);
  const converter = resolveConverter(options.converter);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log("[1/3] Mechanical AppLovin -> Mintegral conversion");
  runConverter({ python, converter, input, outputDir, orientation: options.orientation });
  const packageDir = path.join(outputDir, "package");
  const mechanicalIndexPath = path.join(packageDir, "index.html");
  if (!fs.existsSync(mechanicalIndexPath)) throw new Error(`Mechanical Mintegral HTML is missing: ${mechanicalIndexPath}`);
  const indexPath = normalizeMintegralPackage(packageDir);
  let output = { ...assertOutput(outputDir), indexPath };
  console.log("[2/3] Mintegral CTA and lifecycle adaptation");
  patchIndexHtml(output.indexPath);
  rewriteZip(python, output.packageDir, output.zipPath);
  assertZipShape(python, output.zipPath);
  output = assertOutput(outputDir);

  const html = fs.readFileSync(output.indexPath, "utf8");
  if (!html.includes(REPORT_MARKER)) throw new Error("Mintegral lifecycle adaptation marker is missing.");
  if (!/\binstall\s*\(/.test(html)) throw new Error("Mintegral install() bridge is missing.");
  const packageSize = fs.statSync(output.zipPath).size;
  const externalRefs = detectExternalRefs(html);
  const warnings = writeReport({
    input,
    output: { ...output, outputDir },
    orientation: options.orientation,
    packageSize,
    fileCount: output.files.length,
    externalRefs
  });
  console.log("[3/3] Mintegral package validation");
  console.log(`[OK] Package: ${output.zipPath}`);
  console.log(`[OK] Report: ${path.join(outputDir, "conversion-report.md")}`);
  console.log(`[OK] Size: ${packageSize} bytes; files: ${output.files.length}; CTA: window.install && window.install()`);
  if (warnings.length) console.log(`[WARN] ${warnings.length} warning(s). Read conversion-report.md before delivery.`);
  return { ...output, outputDir, packageSize, fileCount: output.files.length, warnings };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  runPipeline(options);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[FAIL] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  REPORT_MARKER,
  MINTEGRAL_ZIP_ROOT,
  MINTEGRAL_MAIN_HTML,
  parseArgs,
  replaceMintegralCtaGuards,
  patchMintegralEndCardGate,
  stripMintegralModuleSyntax,
  normalizeMintegralPackage,
  deferMintegralBootstrap,
  moveMintegralBootstrapAfterBody,
  mintegralLifecycleScript,
  patchIndexHtml,
  runPipeline
};
