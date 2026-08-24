#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateHardenedHtml } = require("../scripts/harden-unity-playables.js");

const ROOT = path.resolve(__dirname, "..");
const PIPELINE = path.join(ROOT, "scripts", "convert-applovin-to-unity.js");
const INPUT = path.join(ROOT, "applovin", "IOS", "Bus Fever - Car Jam Escape Playable_applovin_IOS.html");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "playable-unity-pipeline-"));

function brandingRuntime(html) {
  const match = html.match(/<script id="branding-runtime">[\s\S]*?<\/script>/i);
  return match ? match[0].replace(/\r\n/g, "\n") : "";
}

function writeScript(name, source) {
  const filePath = path.join(tempRoot, name);
  fs.writeFileSync(filePath, source, "utf8");
  return filePath;
}

function runPipeline(outputDir, converter) {
  return spawnSync(process.execPath, [
    PIPELINE,
    "--input", INPUT,
    "--output-dir", outputDir,
    "--python", process.execPath,
    "--converter", converter
  ], { encoding: "utf8" });
}

const successfulConverter = writeScript("fake-converter-success.js", String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
function value(name) { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; }
if (value("--source-platform") !== "applovin" || value("--target-platform") !== "unity") process.exit(2);
const input = value("--input");
const outputDir = value("--output-dir");
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(input, path.join(outputDir, "index.html"));
fs.writeFileSync(path.join(outputDir, "conversion-report.md"), [
  "# Fake conversion report",
  "",
  "- CTA bridge detected: \`mraid.open()\`",
  "",
  "## Warnings",
  "",
  "- Unity target should start content after MRAID viewableChange=true; patch startup manually.",
  ""
].join("\n"));
`);

const failingConverter = writeScript("fake-converter-failure.js", "process.exit(7);\n");

const incompatibleConverter = writeScript("fake-converter-incompatible.js", String.raw`
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const outputDir = args[args.indexOf("--output-dir") + 1];
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "index.html"), "<!doctype html><html><head><style>body{margin:0}</style></head><body><p>unsupported template</p></body></html>");
fs.writeFileSync(path.join(outputDir, "conversion-report.md"), "# Fake incompatible conversion\n");
`);

try {
  const successDir = path.join(tempRoot, "success-output");
  const success = runPipeline(successDir, successfulConverter);
  assert.equal(success.status, 0, success.stderr || success.stdout);
  assert.match(success.stdout, /Integrated AppLovin -> Unity pipeline complete/);
  const htmlPath = path.join(successDir, "index.html");
  const reportPath = path.join(successDir, "conversion-report.md");
  const html = fs.readFileSync(htmlPath, "utf8");
  const sourceHtml = fs.readFileSync(INPUT, "utf8");
  const report = fs.readFileSync(reportPath, "utf8");
  validateHardenedHtml(html, htmlPath);
  assert.ok(html.indexOf('id="loading-screen"') < html.indexOf('<script id="unity-playable-module"'));
  assert.match(html, /<script id="branding-runtime">/);
  assert.match(html, /const CONFIG = \{/);
  assert.match(html, /const fitText =/);
  assert.equal(brandingRuntime(html), brandingRuntime(sourceHtml));
  assert.ok(html.indexOf('<script id="branding-runtime">') < html.indexOf('<script id="unity-playable-module"'));
  assert.equal((html.match(/window\.mraid\.open\(\)/g) || []).length, 1);
  assert.match(report, /unity-runtime-hardening-v2/);
  assert.doesNotMatch(report, /patch startup manually/i);

  const converterFailure = runPipeline(path.join(tempRoot, "converter-failure-output"), failingConverter);
  assert.notEqual(converterFailure.status, 0);
  assert.match(converterFailure.stderr, /Upstream converter failed with exit code 7/);
  assert.doesNotMatch(converterFailure.stdout, /Integrated AppLovin -> Unity pipeline complete/);

  const hardeningFailure = runPipeline(path.join(tempRoot, "hardening-failure-output"), incompatibleConverter);
  assert.notEqual(hardeningFailure.status, 0);
  assert.match(hardeningFailure.stderr, /expected one supported gameplay payload/);
  assert.doesNotMatch(hardeningFailure.stdout, /Integrated AppLovin -> Unity pipeline complete/);

  console.log("PASS: integrated conversion pipeline success and fail-closed paths validated");
} finally {
  const resolvedTemp = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  if (resolvedTemp.startsWith(resolvedSystemTemp + path.sep)) {
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
}
