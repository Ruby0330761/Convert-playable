"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CTA_CALL,
  MAX_HTML_BYTES,
  parseArgs,
  replaceMetaCtaBridge,
  stripMetaRedirects,
  assertNoJavaScriptRedirect,
  patchMetaHtml,
  distributeMetaResources,
  guardPlaceholderAudio,
  validateMetaOutput
} = require("../scripts/convert-applovin-to-meta.js");

test("Meta CLI parses orientation and required paths", () => {
  assert.deepEqual(parseArgs(["--input", "a.html", "--output-dir", "out", "--orientation", "landscape"]), {
    input: "a.html", outputDir: "out", orientation: "landscape"
  });
});

test("Meta CTA replaces MRAID and install bridges", () => {
  const html = '<html><head></head><body><button id="cta-button" onclick="mraid.open(\'x\')">Play</button></body></html>';
  const patched = replaceMetaCtaBridge(html);
  assert.equal((patched.match(/FbPlayableAd\.onCTAClick\(\)/g) || []).length, 1);
  assert.doesNotMatch(patched, /mraid\.open/);
});

test("Meta rejects JavaScript redirects", () => {
  assert.throws(() => assertNoJavaScriptRedirect('<script>window.location.assign("https://example.com")</script>'), /forbids JavaScript redirects/);
  assert.throws(() => assertNoJavaScriptRedirect('<meta http-equiv="refresh" content="0;url=x">'), /forbids JavaScript redirects/);
});

test("Meta strips non-CTA reload/open helpers from inherited runtime", () => {
  const patched = stripMetaRedirects('window.location.reload(); window.open("x");');
  assert.doesNotMatch(patched, /window\.location|window\.open/);
});

test("Meta patch adds orientation and CTA bridge", () => {
  const html = '<html><head></head><body><button id="cta-button">Play</button><script>mraid.open("x")</script></body></html>';
  const patched = patchMetaHtml(html, "portrait");
  assert.match(patched, /ad\.orientation/);
  assert.match(patched, new RegExp(CTA_CALL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Meta HTML limit remains fail-closed", () => {
  assert.equal(MAX_HTML_BYTES, 2_000_000);
});

test("empty optional audio becomes silence and real audio still uses native decoding", () => {
  const vm = require("node:vm");
  let decodes = 0;
  const context = { a: { sampleRate: 44100, createBuffer: () => "silence", decodeAudioData: () => { decodes++; return "decoded"; } }, b: new ArrayBuffer(1) };
  const code = guardPlaceholderAudio("a.decodeAudioData(b)");
  assert.equal(vm.runInNewContext(code, context), "silence");
  context.b = new ArrayBuffer(100);
  assert.equal(vm.runInNewContext(code, context), "decoded");
  assert.equal(decodes, 1);
});

test("resource distribution is byte-exact and preserves script order, module type, JSON and embedded assets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-resource-test-"));
  try {
    const css = '@font-face{src:url(data:font/ttf;base64,AA==)}';
    const script = '\nconst model="data:application/octet-stream;base64,AA==";\n';
    const html = `<html><head><style>${css}</style></head><body><script>window.order=[1]</script><script type="module">${script}</script><script type="application/json">{"level":5}</script><script>window.order.push(2)</script></body></html>`;
    const result = distributeMetaResources(html, dir);
    assert.equal(fs.readFileSync(path.join(dir, "runtime-2.js"), "utf8"), script);
    assert.equal(fs.readFileSync(path.join(dir, "style.css"), "utf8"), css);
    assert.match(result.html, /href="\.\/style.css"/);
    assert.match(result.html, /src="\.\/index.js"/);
    assert.match(result.html, /type="module" src="\.\/runtime-2.js"/);
    assert.match(result.html, /type="application\/json">\{"level":5\}/);
    assert.ok(result.html.indexOf("index.js") < result.html.indexOf("runtime-2.js"));
    assert.ok(result.html.indexOf("runtime-2.js") < result.html.indexOf("runtime-3.js"));
    const vm = require("node:vm");
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, "index.js"), "utf8"), context);
    vm.runInNewContext(fs.readFileSync(path.join(dir, "runtime-3.js"), "utf8"), context);
    assert.deepEqual(Array.from(context.window.order), [1, 2]);
    assert.throws(() => distributeMetaResources('<script>document.currentScript.src</script>', dir), /manual review/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("split-package validation checks redirects in JS and missing local resources", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-validation-test-"));
  try {
    const packageDir = path.join(dir, "package");
    fs.mkdirSync(packageDir);
    const zipPath = path.join(dir, "meta.zip");
    fs.writeFileSync(zipPath, "placeholder");
    const shell = '<html><link rel="stylesheet" href="./style.css"><script src="./index.js"></script></html>';
    fs.writeFileSync(path.join(packageDir, "index.html"), shell);
    fs.writeFileSync(path.join(packageDir, "index.js"), `${CTA_CALL}\nwindow.location.assign("x");`);
    fs.writeFileSync(path.join(packageDir, "style.css"), 'body{margin:0}');
    assert.throws(() => validateMetaOutput({ packageDir, zipPath }), /forbidden redirect/);
    fs.writeFileSync(path.join(packageDir, "index.js"), CTA_CALL);
    fs.writeFileSync(path.join(packageDir, "index.html"), shell + '<script src="./missing.js"></script>');
    assert.throws(() => validateMetaOutput({ packageDir, zipPath }), /Missing or unsafe local resource/);
    fs.unlinkSync(path.join(packageDir, "style.css"));
    assert.throws(() => validateMetaOutput({ packageDir, zipPath }), /requires nonempty root style.css/);
    fs.writeFileSync(path.join(packageDir, "style.css"), 'body{margin:0}');
    fs.unlinkSync(path.join(packageDir, "index.js"));
    assert.throws(() => validateMetaOutput({ packageDir, zipPath }), /requires nonempty root index.js/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
