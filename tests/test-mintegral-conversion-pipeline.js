"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  REPORT_MARKER,
  parseArgs,
  patchIndexHtml,
  replaceMintegralCtaGuards,
  patchMintegralEndCardGate,
  stripMintegralModuleSyntax,
  normalizeMintegralPackage,
  deferMintegralBootstrap,
  moveMintegralBootstrapAfterBody
} = require("../scripts/convert-applovin-to-mintegral.js");

test("Mintegral CLI parses the integrated conversion options", () => {
  assert.deepEqual(
    parseArgs([
      "--input", "source.html",
      "--output-dir", "out",
      "--orientation", "portrait"
    ]),
    { input: "source.html", outputDir: "out", orientation: "portrait" }
  );
});

test("Mintegral CTA removes the MRAID-only guard", () => {
  const source = "if(window.mraid?.open){window.mraid.open('store');return;}";
  const converted = replaceMintegralCtaGuards(source);
  assert.doesNotMatch(converted, /window\.mraid\.open/);
  assert.match(converted, /window\.install\s*&&\s*window\.install\(\);/);
  assert.doesNotMatch(converted, /(?<!&&\s)window\.install\s*\(\s*\)\s*;?/);
});

test("Mintegral CTA normalizes direct and bare install calls without double guards", () => {
  const source = "window.install(); install(); window.install && window.install();";
  const converted = replaceMintegralCtaGuards(source);
  assert.equal((converted.match(/window\.install\s*&&\s*window\.install\s*\(\s*\)\s*;/g) || []).length, 3);
  assert.doesNotMatch(converted, /(?<!&&\s)window\.install\s*\(\s*\)\s*;?/);
  assert.doesNotMatch(converted, /(?<![.\w])install\s*\(\s*\)\s*;?/);
});

test("Mintegral install threshold shows the built-in end card before CTA", () => {
  const source = '<div id="game-over-overlay"></div><button id="cta-button"></button>' +
    'function z(){return F?.ok&&h(N)&&Ga(),F;}if(e.shouldOpenStore()){N.stopImmediatePropagation(),Ga();return}';
  const converted = patchMintegralEndCardGate(source);
  assert.match(converted, /return F\?\.ok&&h\(N\)&&\(I\(""\),Rt\?\.classList\.add\("is-title-fading","is-cta-ready"\)\),F/);
  assert.match(converted, /if\(e\.shouldOpenStore\(\)\)\{N\.stopImmediatePropagation\(\),I\(""\),Rt\?\.classList\.add\("is-title-fading","is-cta-ready"\);return\}/);
  assert.doesNotMatch(converted, /shouldOpenStore\(\)\)\{N\.stopImmediatePropagation\(\),Ga\(\)/);
  assert.doesNotMatch(converted, /h\(N\)&&Ga\(\)/);
});

test("Mintegral HTML is adapted to classic script syntax", () => {
  const source = '<script type="module">const x = 1;</script>' +
    '(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll(\'link[rel="modulepreload"]\'))n(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function n(i){if(i.ep)return;i.ep=!0;fetch(i.href)}})();';
  const converted = stripMintegralModuleSyntax(source);
  assert.doesNotMatch(converted, /type=["']module["']/i);
  assert.doesNotMatch(converted, /modulepreload/i);
  assert.match(converted, /<script\s+defer>/i);
  assert.match(converted, /structuredClone\s*=\s*function/);
});

test("Mintegral package uses the validator's same-name HTML", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mintegral-package-"));
  try {
    const legacy = path.join(root, "index.html");
    fs.writeFileSync(legacy, "<!doctype html>", "utf8");
    const main = normalizeMintegralPackage(root);
    assert.equal(path.basename(main), "mintegral.html");
    assert.equal(fs.existsSync(path.join(root, "index.html")), false);
    assert.equal(fs.existsSync(path.join(root, "mintegral.html")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Mintegral bootstrap waits for the gameplay DOM", () => {
  const converted = deferMintegralBootstrap("RM(zM);");
  assert.doesNotMatch(converted, /^RM\(zM\);$/);
  assert.match(converted, /DOMContentLoaded/);
  assert.throws(() => deferMintegralBootstrap("RM(zM); RM(zM);"), /exactly one/);
});

test("Mintegral bootstrap script runs after the body DOM", () => {
  const source = "<head><script defer>const template = '</body>';const canvas = document.querySelector('canvas');RM(zM);</script></head><body><canvas></canvas></body>";
  const converted = moveMintegralBootstrapAfterBody(source);
  assert.ok(converted.indexOf("<canvas></canvas>") < converted.indexOf("<script defer>"));
  assert.ok(converted.lastIndexOf("<script defer>") < converted.toLowerCase().lastIndexOf("</body>"));
});

test("Mintegral package receives CTA and lifecycle hooks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mintegral-test-"));
  try {
    const indexPath = path.join(root, "index.html");
    fs.writeFileSync(
      indexPath,
      "<!doctype html><div id=\"loading-screen\"></div><div id=\"game-over-overlay\" hidden></div><button id=\"cta-button\"></button><button id=\"end-reset-button\"></button><script>if(window.mraid?.open){window.mraid.open('store');}function z(){return F?.ok&&h(N)&&Ga(),F;}if(e.shouldOpenStore()){N.stopImmediatePropagation(),Ga();return}</script></body>",
      "utf8"
    );
    patchIndexHtml(indexPath);
    const output = fs.readFileSync(indexPath, "utf8");
    assert.match(output, /window\.install\s*&&\s*window\.install\(\);/);
    assert.doesNotMatch(output, /(?<!&&\s)window\.install\s*\(\s*\)\s*;?/);
    assert.match(output, new RegExp(REPORT_MARKER));
    for (const hook of ["gameReady", "gameStart", "gameEnd", "gameClose", "gameRetry"]) {
      assert.match(output, new RegExp(hook));
    }
    assert.match(output, /window\.gameReady\s*&&\s*window\.gameReady\(\)/);
    assert.match(output, /window\.gameEnd\s*&&\s*window\.gameEnd\(\)/);
    assert.match(output, /window\.gameRetry\s*&&\s*window\.gameRetry\(\)/);
    assert.match(output, /function gameStart\(\)/);
    assert.match(output, /function gameClose\(\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
