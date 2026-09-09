#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ANDROID_END_CARD_MARKER,
  REPORT_MARKER,
  applyAndroidEndCardCompliance,
  parseArgs,
  readZipEntries,
  resolveAndroidBadge,
  toGoogleBaseName
} = require("../scripts/convert-applovin-to-google.js");

const ROOT = path.resolve(__dirname, "..");
const PIPELINE = path.join(ROOT, "scripts", "convert-applovin-to-google.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "playable-google-pipeline-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function playableHtml(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><div id="game-over-overlay" class="game-over-overlay" hidden><div id="game-over-title">Game Over</div><img id="game-over-logo" src="data:image/png;base64,AA==" alt="logo"><button id="cta-button" class="cta-button" type="button" aria-label="Play Now" hidden>Play Now</button></div><button onclick="if(window.mraid?.open){mraid.open('store')}">Install</button></body></html>`;
}

function runPipeline(args) {
  return spawnSync(process.execPath, [PIPELINE, ...args], { encoding: "utf8" });
}

const fakeConverter = path.join(tempRoot, "fake-google-converter.js");
writeFile(fakeConverter, String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
function value(name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
if (value("--source-platform") !== "applovin" || value("--target-platform") !== "google") process.exit(2);
const input = value("--input");
if (path.basename(input).includes("Fail")) process.exit(7);
const outputDir = value("--output-dir");
const packageDir = path.join(outputDir, "package");
fs.mkdirSync(packageDir, { recursive: true });
let html = fs.readFileSync(input, "utf8");
html = html.replace(/mraid\.open\s*\([^)]*\)/g, "ExitApi.exit()");
html = html.replace("</head>", '<meta name="ad.orientation" content="both">\n<script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>\n</head>');
const indexPath = path.join(packageDir, "index.html");
fs.writeFileSync(indexPath, html, "utf8");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function storedZip(name, content) {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(content);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const centralOffset = local.length + nameBytes.length + data.length;
  const centralSize = central.length + nameBytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]);
}
fs.writeFileSync(path.join(outputDir, "google.zip"), storedZip("index.html", html));
fs.writeFileSync(path.join(outputDir, "conversion-report.md"), [
  "# Fake Google report",
  "",
  "- Output package: \`staging/google.zip\`",
  "- CTA bridge detected: \`ExitApi.exit()\`",
  "",
  "## Warnings",
  "",
  "- External reference remains: //" + "A".repeat(500),
  "- None from mechanical conversion.",
  ""
].join("\n"));
`);

try {
  assert.equal(parseArgs(["--input", "input", "--output-dir", "output"]).orientation, "portrait");
  assert.equal(
    toGoogleBaseName("Bus Fever_applovin_Android_Beach.html"),
    "Bus Fever_google_Android_Beach"
  );
  const badge = resolveAndroidBadge();
  const compliantFixture = applyAndroidEndCardCompliance(playableHtml("Fixture"), {
    productName: "Bus Fever - Car Jam Escape",
    badge
  });
  assert.match(compliantFixture, new RegExp(ANDROID_END_CARD_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(compliantFixture, /id="google-play-product-name"[^>]*>Bus Fever - Car Jam Escape<\/div>/);
  assert.match(compliantFixture, /class="cta-button google-play-badge-button"/);
  assert.match(compliantFixture, /src="data:image\/png;base64,/);
  assert.doesNotMatch(compliantFixture, /<style\b/i);
  assert.doesNotMatch(compliantFixture, /<script\b[^>]*google-android-end-card-runtime/i);
  assert.doesNotMatch(compliantFixture, />Play Now<\/button>/);
  assert.throws(
    () => applyAndroidEndCardCompliance("<!doctype html><html><head></head><body></body></html>", {
      productName: "Bus Fever - Car Jam Escape",
      badge
    }),
    /requires the current #game-over-overlay template/
  );

  const batchInput = path.join(tempRoot, "batch", "applovin");
  const androidInput = path.join(batchInput, "Android", "Game_applovin_Android_Beach.html");
  const iosInput = path.join(batchInput, "IOS", "Game_applovin_IOS_Beach.html");
  writeFile(androidInput, playableHtml("Android"));
  writeFile(iosInput, playableHtml("IOS"));
  const batchOutput = path.join(tempRoot, "batch", "google");
  const batch = runPipeline([
    "--input", batchInput,
    "--output-dir", batchOutput,
    "--python", process.execPath,
    "--converter", fakeConverter
  ]);
  assert.equal(batch.status, 0, batch.stderr || batch.stdout);
  assert.match(batch.stdout, /conversion complete: 2 package\(s\)/);

  const androidZip = path.join(batchOutput, "Android", "Game_google_Android_Beach", "Game_google_Android_Beach.zip");
  const iosZip = path.join(batchOutput, "IOS", "Game_google_IOS_Beach", "Game_google_IOS_Beach.zip");
  for (const zipPath of [androidZip, iosZip]) {
    assert.ok(fs.existsSync(zipPath), `missing ${zipPath}`);
    assert.deepEqual(readZipEntries(zipPath), ["index.html", "index.js", "style.css"]);
    const report = fs.readFileSync(path.join(path.dirname(zipPath), "conversion-report.md"), "utf8");
    assert.match(report, new RegExp(REPORT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(report, /CTA bridge: `ExitApi\.exit\(\)`/);
    assert.match(report, /CTA bridge is independent of MRAID open availability/);
    assert.match(report, /ad\.orientation=portrait/);
    assert.match(report, /ad\.size=width=320,height=480/);
    assert.match(report, /ZIP file count: `3`/);
    assert.match(report, /External HTTP\(S\) asset references: Google Exit API only/);
    assert.match(report, /Omitted 1 probable inline Base64 external-reference false positive/);
    assert.doesNotMatch(report, /A{500}/);
    assert.doesNotMatch(report, /staging\/google\.zip/);
  }
  const androidReport = fs.readFileSync(path.join(path.dirname(androidZip), "conversion-report.md"), "utf8");
  assert.match(androidReport, /Android end-card product name: `Bus Fever - Car Jam Escape`/);
  assert.match(androidReport, /Android CTA visual: embedded official Google Play badge/);
  const iosReport = fs.readFileSync(path.join(path.dirname(iosZip), "conversion-report.md"), "utf8");
  assert.doesNotMatch(iosReport, /Android end-card product name/);
  const batchReport = fs.readFileSync(path.join(batchOutput, "batch-conversion-report.md"), "utf8");
  assert.match(batchReport, /Successful: `2`/);
  assert.match(batchReport, /Failed: `0`/);

  const iosOnlyOutput = path.join(tempRoot, "ios-only", "google");
  const iosOnly = runPipeline([
    "--input", batchInput,
    "--output-dir", iosOnlyOutput,
    "--platform", "ios",
    "--python", process.execPath,
    "--converter", fakeConverter
  ]);
  assert.equal(iosOnly.status, 0, iosOnly.stderr || iosOnly.stdout);
  assert.ok(fs.existsSync(path.join(iosOnlyOutput, "IOS", "Game_google_IOS_Beach", "Game_google_IOS_Beach.zip")));
  assert.equal(fs.existsSync(path.join(iosOnlyOutput, "Android")), false);

  const failureInput = path.join(tempRoot, "failure", "applovin");
  writeFile(path.join(failureInput, "Android", "Game_applovin_Android_OK.html"), playableHtml("OK"));
  writeFile(path.join(failureInput, "IOS", "Game_applovin_IOS_Fail.html"), playableHtml("Fail"));
  const failureOutput = path.join(tempRoot, "failure", "google");
  const partialFailure = runPipeline([
    "--input", failureInput,
    "--output-dir", failureOutput,
    "--python", process.execPath,
    "--converter", fakeConverter
  ]);
  assert.notEqual(partialFailure.status, 0);
  assert.match(partialFailure.stderr, /1 failure\(s\) and 1 success\(es\)/);
  assert.ok(fs.existsSync(path.join(failureOutput, "Android", "Game_google_Android_OK", "Game_google_Android_OK.zip")));
  const failureReport = fs.readFileSync(path.join(failureOutput, "batch-conversion-report.md"), "utf8");
  assert.match(failureReport, /Successful: `1`/);
  assert.match(failureReport, /Failed: `1`/);
  assert.match(failureReport, /Upstream converter failed with exit code 7/);

  console.log("PASS: Google single-target naming, batch conversion, filtering, validation, and failure reporting verified");
} finally {
  const resolvedTemp = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  if (resolvedTemp.startsWith(resolvedSystemTemp + path.sep)) {
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}
