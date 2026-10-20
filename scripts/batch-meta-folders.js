"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { runPipeline } = require("./convert-applovin-to-meta.js");

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function copyWithRetry(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { fs.copyFileSync(source, destination); return; }
    catch (error) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(error.code) || attempt >= 7) throw error;
      // Antivirus/preview file handles can briefly block Windows ZIP replacement.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1));
    }
  }
}

const inputs = [];
let output;
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!value) throw new Error(`Missing value: ${key}`);
  if (key === "--input") inputs.push(path.resolve(value));
  else if (key === "--output-dir") output = path.resolve(value);
  else throw new Error(`Unknown option: ${key}`);
}
if (!inputs.length || !output) throw new Error("Use --input <folder> (repeatable) --output-dir <destination>");
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "meta-batch-"));
const results = [];
fs.mkdirSync(output, { recursive: true });
try {
  for (const root of inputs) {
    const sources = walk(root).filter(file => /\.html$/i.test(file) && /[\\/]applovin[\\/]/i.test(file));
    for (const source of sources) {
      const platform = /[\\/]android[\\/]/i.test(source) ? "Android" : /[\\/]ios[\\/]/i.test(source) ? "iOS" : null;
      if (!platform) throw new Error(`Missing device classification: ${source}`);
      let name = path.basename(source, path.extname(source));
      name = /^BL-/i.test(name) ? name.replace(/-AL-/i, "-FB-").replace(/-all-/i, platform === "Android" ? "-android-" : "-ios-") : name.replace(/_applovin_/i, "_meta_");
      const destination = path.join(output, path.basename(root), "meta", platform, `${name}.zip`);
      try {
        const result = runPipeline({ input: source, outputDir: path.join(staging, String(results.length)), orientation: "portrait" });
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        copyWithRetry(result.zipPath, destination);
        // Keep validation artifacts outside delivery folders so each contains ZIPs only.
        results.push({ source, platform, output: destination, status: "PASS", htmlBytes: result.htmlBytes, zipBytes: result.zipBytes, files: result.files });
      } catch (error) {
        results.push({ source, platform, status: "FAIL", reason: error.message });
      }
    }
  }
  fs.writeFileSync(path.join(output, "meta-batch-manifest.json"), JSON.stringify(results, null, 2));
  const passed = results.filter(result => result.status === "PASS").length;
  fs.writeFileSync(path.join(output, "meta-batch-report.md"), [
    "# Meta batch conversion", "", `- Total: ${results.length}; passed: ${passed}; failed: ${results.length - passed}`,
    "- Lossless resource distribution: local JS/CSS, root index.html, embedded asset bytes preserved.",
    "- Required root files: index.html / index.js / style.css; actual resources, HTML references and ZIP entries validated.",
    "- Limits: index.html < 2,000,000 bytes; ZIP <= 5,000,000 bytes; fewer than 100 files.",
    "- CTA: FbPlayableAd.onCTAClick(); no JavaScript redirect.",
    "- Original source directories preserved; delivery directories contain Meta ZIPs only.",
    "- Official Meta preview/upload/audio acceptance remains required.", "",
    ...results.map(result => `- ${result.status}: ${result.output || result.source}${result.status === "PASS" ? ` | HTML ${result.htmlBytes} B | ZIP ${result.zipBytes} B | ${result.files.length} files` : ` | ${result.reason}`}`), ""
  ].join("\n"));
  console.log(`TOTAL ${results.length}; PASS ${passed}; FAIL ${results.length - passed}`);
  if (passed !== results.length) process.exitCode = 1;
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
