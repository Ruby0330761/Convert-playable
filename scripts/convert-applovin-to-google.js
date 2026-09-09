#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const REPORT_MARKER = "<!-- google-package-validation-v1 -->";
const ANDROID_END_CARD_MARKER = "<!-- google-android-end-card-v1 -->";
const ANDROID_END_CARD_RUNTIME_MARKER = "google-android-end-card-runtime";
const MAX_PACKAGE_SIZE = 5_000_000;
const MAX_FILE_COUNT = 512;
const EXIT_API_URL = "https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js";
const GOOGLE_ROOT_FILES = Object.freeze(["index.html", "index.js", "style.css"]);
const GOOGLE_AD_SIZES = Object.freeze({
  portrait: Object.freeze({ width: 320, height: 480 }),
  landscape: Object.freeze({ width: 480, height: 320 }),
  both: Object.freeze({ width: 320, height: 480 })
});
const DEFAULT_PRODUCT_NAME = "Bus Fever - Car Jam Escape";
const DEFAULT_ANDROID_BADGE = path.resolve(__dirname, "..", "assets", "google", "google-play-badge.png");
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
    "  node scripts/convert-applovin-to-google.js --input <applovin.html|directory> --output-dir <directory> [options]",
    "",
    "Options:",
    "  --orientation <portrait|landscape|both>  Default: portrait",
    "  --platform <android|ios|all>             Batch filter. Default: all",
    `  --product-name <text>                    Android end-card title. Default: ${DEFAULT_PRODUCT_NAME}`,
    "  --android-badge <png>                    Override Google Play badge asset",
    "  --python <executable>                    Override Python runtime",
    "  --converter <path>                      Override upstream converter script",
    "  --help                                  Show this help",
    "",
    "Batch example:",
    "  node scripts/convert-applovin-to-google.js --input applovin --output-dir google"
  ].join("\n");
}

function parseArgs(argv) {
  const options = { orientation: "portrait", platform: "all", productName: DEFAULT_PRODUCT_NAME };
  const valueOptions = new Set([
    "--input",
    "--output-dir",
    "--orientation",
    "--platform",
    "--product-name",
    "--android-badge",
    "--python",
    "--converter"
  ]);
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
  options.orientation = options.orientation.toLowerCase();
  options.platform = options.platform.toLowerCase();
  if (!["portrait", "landscape", "both"].includes(options.orientation)) {
    throw new Error(`Unsupported orientation: ${options.orientation}`);
  }
  if (!["android", "ios", "all"].includes(options.platform)) {
    throw new Error(`Unsupported platform filter: ${options.platform}`);
  }
  options.productName = options.productName.trim();
  if (!options.productName) throw new Error("--product-name must not be empty");
  return options;
}

function canExecute(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function resolvePython(explicitPython) {
  const candidates = [
    explicitPython,
    process.env.PLAYABLE_PYTHON,
    BUNDLED_PYTHON,
    "python3",
    "python"
  ].filter(Boolean);
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

function resolveAndroidBadge(explicitBadge) {
  const badgePath = path.resolve(explicitBadge || DEFAULT_ANDROID_BADGE);
  if (!fs.existsSync(badgePath) || !fs.statSync(badgePath).isFile()) {
    throw new Error(`Google Play badge asset not found: ${badgePath}`);
  }
  const buffer = fs.readFileSync(badgePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`Google Play badge must be a PNG: ${badgePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const ratio = width / height;
  if (width < 1 || height < 1 || ratio < 3 || ratio > 4) {
    throw new Error(`Unexpected Google Play badge dimensions: ${width}x${height}`);
  }
  return { path: badgePath, buffer, width, height };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function applyAndroidEndCardCompliance(html, { productName, badge }) {
  if (html.includes(ANDROID_END_CARD_MARKER)) return html;
  if (!/id=["']game-over-overlay["']/i.test(html)) {
    throw new Error("Android Google compliance requires the current #game-over-overlay template.");
  }
  const logoPattern = /<img\b(?=[^>]*\bid=["']game-over-logo["'])[^>]*>/i;
  if (!logoPattern.test(html)) {
    throw new Error("Android Google compliance requires #game-over-logo as an insertion anchor.");
  }
  const ctaPattern = /<button\b(?=[^>]*\bid=["']cta-button["'])[^>]*>[\s\S]*?<\/button>/i;
  if (!ctaPattern.test(html)) {
    throw new Error("Android Google compliance requires the current #cta-button template.");
  }

  const safeProductName = escapeHtml(productName);
  const badgeDataUri = `data:image/png;base64,${badge.buffer.toString("base64")}`;
  html = html.replace(
    logoPattern,
    (logoTag) => `${logoTag}\n          <div id="google-play-product-name" class="google-play-product-name">${safeProductName}</div>`
  );
  html = html.replace(
    ctaPattern,
    `<button id="cta-button" class="cta-button google-play-badge-button" type="button" aria-label="Get it on Google Play" hidden><img class="google-play-badge-image" src="${badgeDataUri}" alt="Get it on Google Play" draggable="false" /></button>`
  );

  if (!/<\/head>/i.test(html)) throw new Error("Android Google compliance could not find </head>.");
  return html.replace(/<\/head>/i, `${ANDROID_END_CARD_MARKER}\n</head>`);
}

function googleAdSize(orientation) {
  const size = GOOGLE_AD_SIZES[orientation];
  if (!size) throw new Error(`Unsupported Google orientation: ${orientation}`);
  return size;
}

function renderGoogleStyle({ orientation, androidEndCard, badge }) {
  const size = googleAdSize(orientation);
  const blocks = [
    `/* Google Ads root stylesheet. Gameplay styling remains inline in index.html. */\n:root {\n  --google-ad-width: ${size.width};\n  --google-ad-height: ${size.height};\n}`
  ];
  if (androidEndCard) {
    blocks.push(`/* google-android-end-card-style */
.google-play-product-name {
  position: absolute;
  z-index: 13;
  left: 50%;
  top: 66%;
  width: min(84%, 900px);
  color: #fff;
  font-family: "Poppins Branding", Poppins, Arial, sans-serif;
  font-size: clamp(20px, calc(var(--game-over-title-font-size, 92px) * .55), 54px);
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
  text-shadow: 0 3px 5px rgba(0, 0, 0, .72), 0 1px 1px rgba(0, 0, 0, .95);
  opacity: 0;
  transform: translate(-50%, -50%) scale(.94);
  transition: opacity var(--game-over-cta-appear-duration, .65s) ease, transform var(--game-over-cta-appear-duration, .65s) ease;
  pointer-events: none;
}
.game-over-overlay.is-cta-ready .google-play-product-name {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.stage.google-android-end-card-active > .branding-overlay {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
#cta-button.google-play-badge-button {
  left: 50% !important;
  top: 81% !important;
  width: min(62%, 620px);
  height: auto;
  aspect-ratio: ${badge.width} / ${badge.height};
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none !important;
  color: transparent;
  text-shadow: none;
  box-shadow: none;
  animation: none;
  transform: translate(-50%, -50%);
  overflow: visible;
}
#cta-button.google-play-badge-button:hover {
  background: none !important;
  transform: translate(-50%, -50%);
}
.google-play-badge-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border: 0;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}
@media (orientation: landscape) {
  .game-over-overlay.is-cta-ready .game-over-logo {
    opacity: 0;
    visibility: hidden;
  }
  .google-play-product-name {
    top: 38%;
    width: 76%;
    font-size: clamp(20px, calc(var(--game-over-title-font-size, 92px) * .45), 40px);
  }
  #cta-button.google-play-badge-button {
    top: 68% !important;
    width: min(52%, 500px);
  }
}`);
  }
  return `${blocks.join("\n\n")}\n`;
}

function renderGoogleRuntime({ orientation, androidEndCard }) {
  const blocks = [
    `"use strict";\n\n/* Google Ads root runtime. Gameplay remains inline in index.html. */\ndocument.documentElement.dataset.googleAdOrientation = ${JSON.stringify(orientation)};`
  ];
  if (androidEndCard) {
    blocks.push(`/* ${ANDROID_END_CARD_RUNTIME_MARKER} */
(() => {
  const init = () => {
    const stage = document.querySelector("#stage");
    const overlay = document.querySelector("#game-over-overlay");
    if (!stage || !overlay) return;
    const sync = () => stage.classList.toggle("google-android-end-card-active", !overlay.hidden);
    sync();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();`);
  }
  return `${blocks.join("\n\n")}\n`;
}

function walkHtmlFiles(directory, outputDir) {
  const files = [];
  const resolvedOutput = path.resolve(outputDir);
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "_work") continue;
        if (path.resolve(fullPath) === resolvedOutput) continue;
        visit(fullPath);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  visit(directory);
  return files;
}

function detectPlatform(filePath) {
  const segments = path.resolve(filePath).split(path.sep);
  const exact = segments
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment === "android" || segment === "ios");
  const name = path.basename(filePath).toLowerCase();
  const fromName = [];
  if (/(?:^|[_\s-])android(?:[_\s.-]|$)/.test(name)) fromName.push("android");
  if (/(?:^|[_\s-])ios(?:[_\s.-]|$)/.test(name)) fromName.push("ios");
  const matches = [...new Set([...exact, ...fromName])];
  if (matches.length !== 1) {
    throw new Error(`Unable to determine exactly one Android/IOS platform for: ${filePath}`);
  }
  return matches[0] === "android" ? "Android" : "IOS";
}

function toGoogleBaseName(filePath) {
  const sourceName = path.parse(filePath).name;
  const replaced = sourceName.replace(/_applovin_/i, "_google_").replace(/_applovin$/i, "_google");
  return replaced === sourceName ? `${sourceName}_google` : replaced;
}

function collectInputs(inputPath, outputDir, platformFilter) {
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) throw new Error(`Input does not exist: ${resolvedInput}`);
  const inputStat = fs.statSync(resolvedInput);
  let files;
  if (inputStat.isFile()) {
    if (!/\.html?$/i.test(resolvedInput)) throw new Error("Input file must be .html or .htm.");
    files = [resolvedInput];
  } else if (inputStat.isDirectory()) {
    files = walkHtmlFiles(resolvedInput, outputDir).filter((filePath) => /_applovin(?:_|$)/i.test(path.basename(filePath)));
  } else {
    throw new Error(`Unsupported input type: ${resolvedInput}`);
  }

  const items = files.map((filePath) => ({
    input: filePath,
    platform: detectPlatform(filePath),
    baseName: toGoogleBaseName(filePath)
  })).filter((item) => platformFilter === "all" || item.platform.toLowerCase() === platformFilter);

  items.sort((left, right) => left.input.localeCompare(right.input, "en", { sensitivity: "base" }));
  if (items.length === 0) throw new Error("No matching AppLovin HTML inputs were found.");

  const targets = new Set();
  for (const item of items) {
    const key = `${item.platform.toLowerCase()}/${item.baseName.toLowerCase()}`;
    if (targets.has(key)) throw new Error(`Duplicate Google output name detected: ${item.platform}/${item.baseName}`);
    targets.add(key);
  }
  return { items, isBatch: inputStat.isDirectory() || items.length > 1 };
}

function runConverter({ python, converter, input, outputDir, orientation }) {
  const result = spawnSync(python, [
    converter,
    "--input", input,
    "--source-platform", "applovin",
    "--target-platform", "google",
    "--output-dir", outputDir,
    "--orientation", orientation
  ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw new Error(`Unable to start upstream converter: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Upstream converter failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
  }
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

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let checksum = value;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0);
    }
    table[value] = checksum >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let checksum = 0xffffffff;
  for (const byte of buffer) checksum = (checksum >>> 8) ^ CRC32_TABLE[(checksum ^ byte) & 0xff];
  return (checksum ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = Math.max(1, date.getDate());
  const encodedDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | day;
  return { date: encodedDate, time };
}

function writeZipFromDirectory(sourceDir, zipPath) {
  const files = walkFiles(sourceDir).sort((left, right) => left.localeCompare(right, "en"));
  if (files.length > 0xffff) throw new Error(`ZIP has too many entries: ${files.length}`);

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const filePath of files) {
    const name = path.relative(sourceDir, filePath).split(path.sep).join("/");
    if (!name || name.startsWith("/") || name.split("/").includes("..")) {
      throw new Error(`Unsafe ZIP entry path: ${filePath}`);
    }
    const nameBytes = Buffer.from(name, "utf8");
    const data = fs.readFileSync(filePath);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const compressed = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const checksum = crc32(data);
    const modified = dosDateTime(fs.statSync(filePath).mtime);
    const flags = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(modified.time, 10);
    localHeader.writeUInt16LE(modified.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localParts.push(localHeader, nameBytes, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(modified.time, 12);
    centralHeader.writeUInt16LE(modified.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);

  const temporaryZip = `${zipPath}.tmp`;
  try {
    fs.writeFileSync(temporaryZip, Buffer.concat([...localParts, centralDirectory, end]));
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    fs.renameSync(temporaryZip, zipPath);
  } catch (error) {
    if (fs.existsSync(temporaryZip)) fs.unlinkSync(temporaryZip);
    throw error;
  }
}

function replaceGoogleCtaGuards(html) {
  return html
    .replace(/window\.mraid\?\.open/g, "window.ExitApi?.exit")
    .replace(/window\.mraid\s*&&\s*window\.mraid\.open/g, "window.ExitApi && window.ExitApi.exit")
    .replace(/\bmraid\s*&&\s*mraid\.open/g, "window.ExitApi && window.ExitApi.exit");
}

function replaceGoogleMetadata(html, orientation) {
  const size = googleAdSize(orientation);
  const withoutPreviousMetadata = html.replace(
    /<meta\b(?=[^>]*\bname\s*=\s*["']ad\.(?:orientation|size)["'])[^>]*>\s*/gi,
    ""
  );
  if (!/<\/head>/i.test(withoutPreviousMetadata)) throw new Error("Google index.html is missing </head>.");
  const metadata = [
    `<meta name="ad.orientation" content="${orientation}">`,
    `<meta name="ad.size" content="width=${size.width},height=${size.height}">`
  ].join("\n");
  return withoutPreviousMetadata.replace(/<\/head>/i, `${metadata}\n</head>`);
}

function replaceGoogleRootReferences(html) {
  const withoutPreviousReferences = html
    .replace(/<link\b(?=[^>]*\bhref\s*=\s*["'](?:\.\/)?style\.css["'])[^>]*>\s*/gi, "")
    .replace(/<script\b(?=[^>]*\bsrc\s*=\s*["'](?:\.\/)?index\.js["'])[^>]*>\s*<\/script>\s*/gi, "");
  if (!/<\/head>/i.test(withoutPreviousReferences)) throw new Error("Google index.html is missing </head>.");
  const references = [
    '<link rel="stylesheet" href="./style.css">',
    '<script src="./index.js" defer></script>'
  ].join("\n");
  return withoutPreviousReferences.replace(/<\/head>/i, `${references}\n</head>`);
}

function prepareStrictGooglePackage(stagingDir, { orientation, androidEndCard, badge }) {
  const packageDir = path.join(stagingDir, "package");
  const indexPath = path.join(packageDir, "index.html");
  const packagePath = path.join(stagingDir, "google.zip");
  if (!fs.existsSync(indexPath)) throw new Error(`Mechanical Google index.html is missing: ${indexPath}`);

  let html = fs.readFileSync(indexPath, "utf8");
  html = replaceGoogleCtaGuards(html);
  html = replaceGoogleMetadata(html, orientation);
  html = replaceGoogleRootReferences(html);
  fs.writeFileSync(indexPath, html, "utf8");
  fs.writeFileSync(
    path.join(packageDir, "style.css"),
    renderGoogleStyle({ orientation, androidEndCard, badge }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(packageDir, "index.js"),
    renderGoogleRuntime({ orientation, androidEndCard }),
    "utf8"
  );
  writeZipFromDirectory(packageDir, packagePath);
}

function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error(`Invalid ZIP: end-of-central-directory record is missing: ${zipPath}`);

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory: ${zipPath}`);
    }
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) throw new Error(`Invalid ZIP entry name: ${zipPath}`);
    entries.push(buffer.toString("utf8", nameStart, nameEnd));
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

function findRemoteAssetUrls(html) {
  const urls = [];
  const pattern = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) urls.push(match[1]);
  return [...new Set(urls)];
}

function metaContent(headHtml, metaName) {
  const tags = headHtml.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== metaName.toLowerCase()) continue;
    return tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
  }
  return null;
}

function validateGoogleOutput(stagingDir, requirements = {}) {
  const packagePath = path.join(stagingDir, "google.zip");
  const packageDir = path.join(stagingDir, "package");
  const indexPath = path.join(packageDir, "index.html");
  const scriptPath = path.join(packageDir, "index.js");
  const stylePath = path.join(packageDir, "style.css");
  const reportPath = path.join(stagingDir, "conversion-report.md");
  for (const requiredPath of [packagePath, indexPath, scriptPath, stylePath, reportPath]) {
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(`Mechanical Google output is missing: ${requiredPath}`);
    }
  }

  const packageSize = fs.statSync(packagePath).size;
  if (packageSize > MAX_PACKAGE_SIZE) {
    throw new Error(`Google ZIP exceeds 5,000,000 bytes: ${packageSize} bytes`);
  }
  const entries = readZipEntries(packagePath);
  const fileEntries = entries.filter((entry) => !entry.endsWith("/"));
  if (fileEntries.length > MAX_FILE_COUNT) {
    throw new Error(`Google ZIP exceeds ${MAX_FILE_COUNT} files: ${fileEntries.length}`);
  }
  for (const requiredEntry of GOOGLE_ROOT_FILES) {
    if (!fileEntries.includes(requiredEntry)) throw new Error(`Google ZIP must contain root ${requiredEntry}.`);
  }
  if (fileEntries.some((entry) => entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes(".."))) {
    throw new Error("Google ZIP contains an unsafe or non-portable entry path.");
  }
  if (new Set(fileEntries).size !== fileEntries.length) throw new Error("Google ZIP contains duplicate file entries.");

  const packageFiles = walkFiles(packageDir);
  if (packageFiles.length !== fileEntries.length) {
    throw new Error(`ZIP/package file count mismatch: ZIP ${fileEntries.length}, package ${packageFiles.length}`);
  }
  const html = fs.readFileSync(indexPath, "utf8");
  const runtime = fs.readFileSync(scriptPath, "utf8");
  const styles = fs.readFileSync(stylePath, "utf8");
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i);
  if (!head) throw new Error("Google index.html is missing a complete <head>.");
  const expectedOrientation = requirements.orientation || "portrait";
  const expectedSize = googleAdSize(expectedOrientation);
  const orientation = metaContent(head[0], "ad.orientation");
  const adSize = metaContent(head[0], "ad.size");
  if (orientation !== expectedOrientation) {
    throw new Error(`Google ad.orientation must be ${expectedOrientation}; found ${orientation || "missing"}.`);
  }
  const expectedSizeContent = `width=${expectedSize.width},height=${expectedSize.height}`;
  if (adSize !== expectedSizeContent) {
    throw new Error(`Google ad.size must be ${expectedSizeContent}; found ${adSize || "missing"}.`);
  }
  if (!/<link\b(?=[^>]*\bhref\s*=\s*["']\.\/style\.css["'])[^>]*>/i.test(head[0])) {
    throw new Error("Google index.html must reference root style.css.");
  }
  if (!/<script\b(?=[^>]*\bsrc\s*=\s*["']\.\/index\.js["'])[^>]*>\s*<\/script>/i.test(head[0])) {
    throw new Error("Google index.html must reference root index.js.");
  }
  const ctaSource = `${html}\n${runtime}`;
  if ((ctaSource.match(/ExitApi\.exit\s*\(/g) || []).length < 1) {
    throw new Error("Google CTA bridge ExitApi.exit() was not detected.");
  }
  if (/mraid\.open\s*\(/i.test(ctaSource)) throw new Error("Google output still contains mraid.open().");
  if (/window\.mraid\?\.open|window\.mraid\s*&&\s*window\.mraid\.open|\bmraid\s*&&\s*mraid\.open/i.test(ctaSource)) {
    throw new Error("Google CTA remains conditional on an MRAID open bridge.");
  }
  const exitApiReferences = html.match(/https:\/\/tpc\.googlesyndication\.com\/pagead\/gadgets\/html5\/api\/exitapi\.js/gi) || [];
  if (exitApiReferences.length !== 1) {
    throw new Error(`Expected exactly one Google exitapi.js reference; found ${exitApiReferences.length}.`);
  }
  const externalAssets = findRemoteAssetUrls(html);
  const unsupportedExternalAssets = externalAssets.filter((url) => url !== EXIT_API_URL);
  if (unsupportedExternalAssets.length > 0) {
    throw new Error(`Unsupported external asset reference(s): ${unsupportedExternalAssets.join(", ")}`);
  }

  let androidEndCard = null;
  if (requirements.androidEndCard) {
    if (!html.includes(ANDROID_END_CARD_MARKER)) {
      throw new Error("Android Google end-card compliance marker is missing.");
    }
    if (!runtime.includes(ANDROID_END_CARD_RUNTIME_MARKER)) {
      throw new Error("Android Google end-card branding suppression runtime is missing.");
    }
    if (!styles.includes("google-android-end-card-style")) {
      throw new Error("Android Google end-card stylesheet is missing.");
    }
    const productNameMatch = html.match(/<div\b(?=[^>]*\bid=["']google-play-product-name["'])[^>]*>([\s\S]*?)<\/div>/i);
    if (!productNameMatch || productNameMatch[1].trim() !== escapeHtml(requirements.productName)) {
      throw new Error("Android Google end card does not contain the required complete product name.");
    }
    const badgeButton = html.match(/<button\b(?=[^>]*\bid=["']cta-button["'])(?=[^>]*\bclass=["'][^"']*google-play-badge-button)[^>]*>([\s\S]*?)<\/button>/i);
    if (!badgeButton) throw new Error("Android Google end card is missing the official badge button.");
    if (/\b(?:Play Now|Download)\b/i.test(badgeButton[1])) {
      throw new Error("Android Google badge button still contains a custom CTA label.");
    }
    if (!/<img\b[^>]*\bsrc=["']data:image\/png;base64,/i.test(badgeButton[1])) {
      throw new Error("Android Google Play badge is not embedded as a local PNG.");
    }
    androidEndCard = {
      productName: requirements.productName,
      badgeEmbedded: true
    };
  }

  return {
    packagePath,
    reportPath,
    packageSize,
    fileCount: fileEntries.length,
    ctaCount: (ctaSource.match(/ExitApi\.exit\s*\(/g) || []).length,
    orientation,
    adSize,
    externalAssets,
    androidEndCard
  };
}

function appendValidationReport(reportText, result, finalPackage, sourceInput) {
  const normalized = compactMechanicalReport(reportText).replace(
    /^- Output package: `.*`$/m,
    `- Output package: \`${finalPackage}\``
  ).replace(
    /^- Input: `.*`$/m,
    `- Input: \`${sourceInput}\``
  ).replace(
    /^- Package size: `\d+` bytes$/m,
    `- Package size: \`${result.packageSize}\` bytes`
  ).replace(
    /^- File count: `\d+`$/m,
    `- File count: \`${result.fileCount}\``
  );
  const lines = [
    `- Final ZIP: \`${finalPackage}\``,
    `- Package size: \`${result.packageSize}\` bytes (limit: \`${MAX_PACKAGE_SIZE}\`)`,
    `- ZIP file count: \`${result.fileCount}\` (limit: \`${MAX_FILE_COUNT}\`)`,
    "- Root `index.html`, `index.js`, and `style.css`: verified",
    `- CTA bridge: \`ExitApi.exit()\` (${result.ctaCount} occurrence(s))`,
    "- CTA bridge is independent of MRAID open availability",
    "- Google `exitapi.js`: exactly one reference",
    `- Google metadata: \`ad.orientation=${result.orientation}\`, \`ad.size=${result.adSize}\``,
    `- External HTTP(S) asset references: ${result.externalAssets.length === 1 ? "Google Exit API only" : "none"}`,
    "- Platform upload validation: still required"
  ];
  if (result.androidEndCard) {
    lines.splice(lines.length - 1, 0,
      `- Android end-card product name: \`${result.androidEndCard.productName}\``,
      "- Android CTA visual: embedded official Google Play badge",
      "- Custom `Play Now` / `Download` CTA label: absent from badge button"
    );
  }
  return `${normalized.trimEnd()}\n\n${REPORT_MARKER}\n## Integrated Google Validation\n\n${lines.join("\n")}\n`;
}

function compactMechanicalReport(reportText) {
  const lines = reportText.split(/\r?\n/);
  const compacted = [];
  let omittedInlineDataWarnings = 0;
  for (const line of lines) {
    if (!line.startsWith("- External reference remains:")) {
      compacted.push(line);
      continue;
    }
    const reference = line.slice("- External reference remains:".length).trim();
    const probableInlineData = reference.length > 300 || /^\/\/[A-Za-z0-9+/=_-]{120,}/.test(reference);
    if (probableInlineData) omittedInlineDataWarnings += 1;
    else compacted.push(line);
  }
  if (omittedInlineDataWarnings > 0) {
    const warningsHeading = compacted.findIndex((line) => line === "## Warnings");
    const insertAt = warningsHeading >= 0 ? warningsHeading + 2 : compacted.length;
    compacted.splice(
      insertAt,
      0,
      `- Omitted ${omittedInlineDataWarnings} probable inline Base64 external-reference false positive(s); integrated resource-attribute validation passed.`
    );
  }
  return compacted.join("\n");
}

function assertOutputDirectory(outputDir, expectedZipName) {
  if (!fs.existsSync(outputDir)) return;
  const unexpectedZips = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.zip$/i.test(entry.name) && entry.name !== expectedZipName)
    .map((entry) => entry.name);
  if (unexpectedZips.length > 0) {
    throw new Error(`Output directory contains stale ZIP files: ${unexpectedZips.join(", ")}`);
  }
}

function publishOutput(item, outputRoot, result) {
  const outputDir = path.join(outputRoot, item.platform, item.baseName);
  const zipName = `${item.baseName}.zip`;
  assertOutputDirectory(outputDir, zipName);
  fs.mkdirSync(outputDir, { recursive: true });
  const finalPackage = path.join(outputDir, zipName);
  const finalReport = path.join(outputDir, "conversion-report.md");
  fs.copyFileSync(result.packagePath, finalPackage);
  const reportText = fs.readFileSync(result.reportPath, "utf8");
  fs.writeFileSync(finalReport, appendValidationReport(reportText, result, finalPackage, item.input), "utf8");
  return { ...result, outputDir, packagePath: finalPackage, reportPath: finalReport };
}

function safelyRemoveStaging(stagingDir) {
  if (!stagingDir) return;
  const resolved = path.resolve(stagingDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith("playable-google-")) {
    throw new Error(`Refusing to remove unexpected staging directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function convertOne(item, options, dependencies) {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "playable-google-"));
  try {
    const mechanicalDir = path.join(stagingDir, "output");
    let converterInput = item.input;
    if (item.platform === "Android") {
      const sourceDir = path.join(stagingDir, "source");
      fs.mkdirSync(sourceDir, { recursive: true });
      converterInput = path.join(sourceDir, path.basename(item.input));
      const sourceHtml = fs.readFileSync(item.input, "utf8");
      const compliantHtml = applyAndroidEndCardCompliance(sourceHtml, {
        productName: options.productName,
        badge: dependencies.androidBadge
      });
      fs.writeFileSync(converterInput, compliantHtml, "utf8");
    }
    runConverter({
      python: dependencies.python,
      converter: dependencies.converter,
      input: converterInput,
      outputDir: mechanicalDir,
      orientation: options.orientation
    });
    prepareStrictGooglePackage(mechanicalDir, {
      orientation: options.orientation,
      androidEndCard: item.platform === "Android",
      badge: dependencies.androidBadge
    });
    const result = validateGoogleOutput(mechanicalDir, {
      androidEndCard: item.platform === "Android",
      productName: options.productName,
      orientation: options.orientation
    });
    return publishOutput(item, dependencies.outputRoot, result);
  } finally {
    safelyRemoveStaging(stagingDir);
  }
}

function renderBatchReport(results, failures) {
  const lines = [
    "# AppLovin To Google Batch Conversion",
    "",
    `- Successful: \`${results.length}\``,
    `- Failed: \`${failures.length}\``,
    "",
    "| Platform | Source | Status | Output / Error |",
    "| --- | --- | --- | --- |"
  ];
  for (const result of results) {
    lines.push(`| ${result.item.platform} | ${path.basename(result.item.input)} | PASS | ${result.output.packagePath} |`);
  }
  for (const failure of failures) {
    lines.push(`| ${failure.item.platform} | ${path.basename(failure.item.input)} | FAIL | ${failure.error.message.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "Google Ads preview/backend upload validation is still required.", "");
  return lines.join("\n");
}

function runPipeline(options) {
  const outputRoot = path.resolve(options.outputDir);
  const { items, isBatch } = collectInputs(options.input, outputRoot, options.platform);
  const dependencies = {
    python: resolvePython(options.python),
    converter: resolveConverter(options.converter),
    androidBadge: items.some((item) => item.platform === "Android")
      ? resolveAndroidBadge(options.androidBadge)
      : null,
    outputRoot
  };
  const results = [];
  const failures = [];

  console.log(`[INFO] AppLovin -> Google: ${items.length} input(s)`);
  items.forEach((item, index) => {
    console.log(`[${index + 1}/${items.length}] ${item.platform}: ${path.basename(item.input)}`);
    try {
      const output = convertOne(item, options, dependencies);
      results.push({ item, output });
      console.log(`[OK] ${output.packagePath}`);
    } catch (error) {
      failures.push({ item, error });
      console.error(`[FAIL] ${path.basename(item.input)}: ${error.message}`);
    }
  });

  if (isBatch) {
    fs.mkdirSync(outputRoot, { recursive: true });
    const batchReport = path.join(outputRoot, "batch-conversion-report.md");
    fs.writeFileSync(batchReport, renderBatchReport(results, failures), "utf8");
    console.log(`[INFO] Batch report: ${batchReport}`);
  }
  if (failures.length > 0) {
    throw new Error(`Google conversion completed with ${failures.length} failure(s) and ${results.length} success(es).`);
  }
  console.log(`[OK] AppLovin -> Google conversion complete: ${results.length} package(s)`);
  return { results, failures };
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
  ANDROID_END_CARD_MARKER,
  REPORT_MARKER,
  applyAndroidEndCardCompliance,
  collectInputs,
  compactMechanicalReport,
  detectPlatform,
  parseArgs,
  readZipEntries,
  resolveAndroidBadge,
  resolvePython,
  runPipeline,
  toGoogleBaseName,
  validateGoogleOutput
};
