#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPORT_MARKER = "<!-- meta-playable-conversion-v1 -->";
const CTA_CALL = "FbPlayableAd.onCTAClick();";
const MAX_ZIP_BYTES = 5_000_000;
const MAX_HTML_BYTES = 2_000_000;
const MAX_FILES = 99;
const DEFAULT_CONVERTER = path.join(
  os.homedir(), ".codex", "skills", "convert-playable-ad-formats", "scripts", "convert_playable_ad_format.py"
);
const BUNDLED_PYTHON = path.join(
  os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python",
  process.platform === "win32" ? "python.exe" : "bin/python"
);

function usage() {
  return [
    "Usage:",
    "  node scripts/convert-applovin-to-meta.js --input <applovin.html> --output-dir <directory> [options]",
    "",
    "Options:",
    "  --orientation <portrait|landscape|both>  Default: portrait",
    "  --python <executable>                    Override Python runtime",
    "  --converter <path>                       Override upstream converter",
    "  --help                                   Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const options = { orientation: "portrait" };
  const valueOptions = new Set(["--input", "--output-dir", "--orientation", "--python", "--converter"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!valueOptions.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  if (!options.input) throw new Error("--input is required");
  if (!options.outputDir) throw new Error("--output-dir is required");
  if (!["portrait", "landscape", "both"].includes(options.orientation)) throw new Error(`Unsupported orientation: ${options.orientation}`);
  return options;
}

function canExecute(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function resolvePython(explicitPython) {
  for (const candidate of [explicitPython, process.env.PLAYABLE_PYTHON, BUNDLED_PYTHON, "python3", "python"].filter(Boolean)) {
    if (canExecute(candidate)) return candidate;
  }
  throw new Error("Python runtime not found. Pass --python or set PLAYABLE_PYTHON.");
}

function resolveConverter(explicitConverter) {
  const converter = path.resolve(explicitConverter || process.env.PLAYABLE_CONVERTER || DEFAULT_CONVERTER);
  if (!fs.existsSync(converter)) throw new Error(`Upstream converter not found: ${converter}`);
  return converter;
}

function replaceMetaCtaBridge(html) {
  let next = html;
  next = next.replace(/if\s*\(\s*window\.mraid\?\.open\s*\)\s*\{/g, "{");
  next = next.replace(/if\s*\(\s*window\.mraid\s*&&\s*window\.mraid\.open\s*\)\s*\{/g, "{");
  next = next.replace(/if\s*\(\s*mraid\s*&&\s*mraid\.open\s*\)\s*\{/g, "{");
  next = next.replace(/(?:window\.)?mraid\.open\s*\([^)]*\)\s*;?/g, CTA_CALL);
  next = next.replace(/(?:window\.)?install\s*\(\s*\)\s*;?/g, CTA_CALL);
  if (!next.includes(CTA_CALL)) throw new Error("Meta CTA bridge FbPlayableAd.onCTAClick() was not detected.");
  return next;
}

function assertNoJavaScriptRedirect(html) {
  const forbidden = [
    /(?:window\.)?location\s*\.(?:assign|replace|reload)\s*\(/i,
    /(?:^|[;{}\n])\s*(?:window\.)?location\s*=/i,
    /window\.open\s*\(/i,
    /<meta\b[^>]*http-equiv\s*=\s*["']refresh/i
  ];
  const match = forbidden.find((pattern) => pattern.test(html));
  if (match) throw new Error(`Meta forbids JavaScript redirects; matched ${match}.`);
}

function stripMetaRedirects(html) {
  return html
    .replace(/(?:window\.)?location\.(?:assign|replace|reload)\s*\([^)]*\)\s*;?/gi, "void 0;")
    .replace(/window\.open\s*\([^)]*\)\s*;?/gi, "void 0;");
}

function guardPlaceholderAudio(html) {
  // Older exports use AA== for unused mechanic assets. Some audio configs
  // still preload them; a one-sample silence keeps optional cues harmless.
  return html.replace(/\b([\w$]+)\.decodeAudioData\(\s*([\w$]+)\s*\)/g,
    (_, context, data) => `(${data}.byteLength<=1?${context}.createBuffer(1,1,${context}.sampleRate):${context}.decodeAudioData(${data}))`);
}

function patchMetaHtml(html, orientation) {
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) throw new Error("Meta package must contain a complete HTML document.");
  const next = guardPlaceholderAudio(stripMetaRedirects(replaceMetaCtaBridge(html)));
  assertNoJavaScriptRedirect(next);
  if (!next.includes("FbPlayableAd.onCTAClick()")) throw new Error("Meta CTA bridge is missing.");
  return next.replace(/<\/head>/i, `${REPORT_MARKER}\n<meta name="ad.orientation" content="${orientation}">\n</head>`);
}

function zipDirectory(python, packageDir, zipPath) {
  const script = [
    "import pathlib, sys, zipfile",
    "root = pathlib.Path(sys.argv[1]); target = pathlib.Path(sys.argv[2])",
    "with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:",
    "    for item in sorted(root.rglob('*')):",
    "        if item.is_file(): archive.write(item, item.relative_to(root).as_posix())"
  ].join("\n");
  const result = spawnSync(python, ["-c", script, packageDir, zipPath], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`Unable to build Meta ZIP: ${(result.stderr || result.error?.message || "unknown error").trim()}`);
}

// Move whole blocks without touching asset strings: loaders may decode data URLs
// synchronously, so blindly replacing those URLs with file paths breaks models/audio.
function distributeMetaResources(html, packageDir) {
  const resources = [];
  let scriptIndex = 0;
  let styleIndex = 0;
  let next = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs, body) => {
    if (/\bsrc\s*=/i.test(attrs) || !body.trim()) return tag;
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) return tag;
    if (/\bimport\.meta\b|\bdocument\.currentScript\b/.test(body)) {
      throw new Error("Script depends on inline script location; resource extraction requires manual review.");
    }
    const name = ++scriptIndex === 1 ? "index.js" : `runtime-${scriptIndex}.js`;
    fs.writeFileSync(path.join(packageDir, name), body, "utf8");
    resources.push({ name, kind: "script", bytes: Buffer.byteLength(body) });
    return `<script${attrs} src="./${name}"></script>`;
  });
  next = next.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (tag, attrs, body) => {
    // Keep unusual attributes inline rather than silently changing their semantics.
    if (attrs.trim() || !body.trim()) return tag;
    const name = ++styleIndex === 1 ? "style.css" : `style-${styleIndex}.css`;
    fs.writeFileSync(path.join(packageDir, name), body, "utf8");
    resources.push({ name, kind: "style", bytes: Buffer.byteLength(body) });
    return `<link rel="stylesheet" href="./${name}">`;
  });
  return { html: next, resources };
}

function readZipEntries(python, zipPath) {
  const script = "import json,sys,zipfile; print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))";
  const result = spawnSync(python, ["-c", script, zipPath], { encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("Unable to inspect Meta ZIP.");
  return JSON.parse(result.stdout.trim());
}

function validateMetaOutput({ packageDir, zipPath }) {
  const indexPath = path.join(packageDir, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error("Meta package is missing root index.html.");
  const files = [];
  for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
    if (entry.isFile()) files.push(entry.name);
    else throw new Error(`Meta package contains unsupported nested directory: ${entry.name}`);
  }
  for (const required of ["index.html", "index.js", "style.css"]) {
    if (!files.includes(required) || fs.statSync(path.join(packageDir, required)).size === 0) {
      throw new Error(`Meta package requires nonempty root ${required}.`);
    }
  }
  const html = fs.readFileSync(indexPath, "utf8");
  if (!/<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?index\.js["'][^>]*>/i.test(html) ||
      !/<link\b[^>]*\bhref\s*=\s*["'](?:\.\/)?style\.css["'][^>]*>/i.test(html)) {
    throw new Error("Meta index.html must reference root index.js and style.css.");
  }
  const htmlBytes = Buffer.byteLength(html);
  const zipBytes = fs.statSync(zipPath).size;
  if (htmlBytes >= MAX_HTML_BYTES) throw new Error(`Meta index.html is ${htmlBytes} bytes; must be < ${MAX_HTML_BYTES}.`);
  if (zipBytes > MAX_ZIP_BYTES) throw new Error(`Meta ZIP is ${zipBytes} bytes; must be <= ${MAX_ZIP_BYTES}.`);
  if (files.length > MAX_FILES) throw new Error(`Meta package has ${files.length} files; must be <= ${MAX_FILES}.`);
  const runtime = files.filter(name => /\.(?:m?js|css|html)$/.test(name)).map(name => fs.readFileSync(path.join(packageDir, name), "utf8")).join("\n");
  const networkReferences = [...new Set([
    ...runtime.matchAll(/\b(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi),
    ...runtime.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^\s)'";]+)["']?\s*\)/gi)
  ].map(match => match[1]))];
  if (networkReferences.length) throw new Error(`Remote resource references: ${networkReferences.join(", ")}`);
  if (!runtime.includes(CTA_CALL)) throw new Error("Meta CTA bridge is missing after validation.");
  if (/mraid\.open|window\.location|window\.open\s*\(|(?:^|[;{}\n])\s*location\s*=/i.test(runtime)) throw new Error("Meta package still contains a forbidden redirect bridge.");
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["'](\.\/[^"']+)["']/g)) {
    const local = match[1].slice(2);
    if (local.includes("..") || !files.includes(local)) throw new Error(`Missing or unsafe local resource: ${local}`);
  }
  const zipEntries = readZipEntries(resolvePython(), zipPath);
  if (JSON.stringify([...zipEntries].sort()) !== JSON.stringify([...files].sort())) {
    throw new Error("Meta ZIP entries must match the validated root package files.");
  }
  return { indexPath, files, htmlBytes, zipBytes, networkReferences, zipEntries };
}

function runPipeline(options) {
  const input = path.resolve(options.input);
  const outputDir = path.resolve(options.outputDir);
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  const python = resolvePython(options.python);
  const converter = resolveConverter(options.converter);
  fs.mkdirSync(outputDir, { recursive: true });
  const mechanicalDir = path.join(outputDir, "_mechanical");
  const converted = spawnSync(python, [converter, "--input", input, "--source-platform", "applovin", "--target-platform", "meta", "--output-dir", mechanicalDir, "--orientation", options.orientation], { stdio: "inherit" });
  if (converted.error || converted.status !== 0) throw new Error(`Upstream converter failed with exit code ${converted.status ?? "unknown"}.`);
  const sourceIndex = path.join(mechanicalDir, "package", "index.html");
  if (!fs.existsSync(sourceIndex)) throw new Error(`Mechanical Meta package is missing ${sourceIndex}.`);
  const packageDir = path.join(outputDir, "package");
  fs.mkdirSync(packageDir, { recursive: true });
  const patched = patchMetaHtml(fs.readFileSync(sourceIndex, "utf8"), options.orientation);
  const distributed = distributeMetaResources(patched, packageDir);
  fs.writeFileSync(path.join(packageDir, "index.html"), distributed.html, "utf8");
  const zipPath = path.join(outputDir, "meta.zip");
  zipDirectory(python, packageDir, zipPath);
  const result = validateMetaOutput({ packageDir, zipPath });
  const report = [
    "# AppLovin To Meta Conversion Report", "", `- Input: \`${input}\``, `- Output: \`${zipPath}\``,
    `- Orientation: \`${options.orientation}\``, `- ZIP size: \`${result.zipBytes}\` bytes`,
    `- index.html size: \`${result.htmlBytes}\` bytes`, `- File count: \`${result.files.length}\``,
    `- Remote resource tags/CSS URLs: ${result.networkReferences.length}; relative package files and data URLs only`,
    "- CTA bridge: `FbPlayableAd.onCTAClick()`", "- JavaScript redirect: none detected", "",
    "- Required root files: index.html / index.js / style.css; nonempty, referenced and verified inside ZIP",
    `- HTML before resource distribution: ${Buffer.byteLength(patched)} bytes`,
    "- Resource distribution: lossless local JS/CSS; embedded image/model/font/audio bytes unchanged",
    "- Optional empty audio placeholders: one-sample silence before native decoding; valid audio unchanged",
    ...distributed.resources.map(resource => `- ${resource.name}: ${resource.bytes} bytes (${resource.kind})`),
    REPORT_MARKER, "", "## Manual validation", "",
    "- Upload the ZIP to Meta Playable Preview: https://developers.facebook.com/tools/playable-preview/",
    "- Confirm App Installs objective, CTA behavior, BGM, sound effects, and real ad backend behavior.", ""
  ].join("\n");
  fs.writeFileSync(path.join(outputDir, "conversion-report.md"), report, "utf8");
  console.log(`[OK] Meta package: ${zipPath}`);
  console.log(`[OK] ZIP: ${result.zipBytes} bytes; index.html: ${result.htmlBytes} bytes; files: ${result.files.length}`);
  return { zipPath, reportPath: path.join(outputDir, "conversion-report.md"), ...result };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return console.log(usage());
  try { runPipeline(options); } catch (error) { console.error(`[FAIL] ${error.message}`); process.exitCode = 1; }
}

if (require.main === module) main();

module.exports = { CTA_CALL, MAX_HTML_BYTES, MAX_ZIP_BYTES, parseArgs, replaceMetaCtaBridge, stripMetaRedirects, assertNoJavaScriptRedirect, patchMetaHtml, distributeMetaResources, guardPlaceholderAudio, validateMetaOutput, runPipeline };
