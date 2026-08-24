#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  RUNTIME_MARKER,
  walkFinalHtmlFiles,
  validateHardenedHtml
} = require("../scripts/harden-unity-playables.js");

const ROOT = path.resolve(__dirname, "..");
const UNITY_ROOT = path.resolve(process.env.UNITY_ROOT || path.join(ROOT, "unity"));
const APPLOVIN_ROOT = path.join(ROOT, "applovin");

function walkHtmlFiles(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walkHtmlFiles(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) results.push(fullPath);
  }
  return results;
}

function brandingRuntime(html) {
  const match = html.match(/<script id="branding-runtime">[\s\S]*?<\/script>/i);
  return match ? match[0].replace(/\r\n/g, "\n") : "";
}

function staticAudit() {
  const files = walkFinalHtmlFiles(UNITY_ROOT);
  const sourceFiles = walkHtmlFiles(APPLOVIN_ROOT);
  assert.equal(files.length, sourceFiles.length, "every AppLovin source must have one final Unity HTML");
  for (const filePath of files) {
    const html = fs.readFileSync(filePath, "utf8");
    const [platform] = path.relative(UNITY_ROOT, filePath).split(path.sep);
    const sourceName = path.basename(filePath).replace("_unity_", "_applovin_");
    const sourcePath = path.join(APPLOVIN_ROOT, platform, sourceName);
    const sourceHtml = fs.readFileSync(sourcePath, "utf8");
    const sourceHasBrandingRuntime = sourceHtml.includes('<script id="branding-runtime">');
    validateHardenedHtml(html, filePath);
    assert.match(html, /https:\/\/play\.google\.com\/store\/apps\/details\?id=gridplus\.busjam\.carpuzzle/);
    assert.match(html, /https:\/\/apps\.apple\.com\/app\/id6746743297/);
    assert.equal((html.match(/<script src="mraid\.js"><\/script>/g) || []).length, 1);
    assert.equal(
      (html.match(/<script id="branding-runtime">/g) || []).length,
      sourceHasBrandingRuntime ? 1 : 0,
      "branding runtime presence must match the AppLovin source"
    );
    if (sourceHasBrandingRuntime) {
      assert.match(html, /const CONFIG = \{/);
      assert.match(html, /const fitText =/);
      assert.equal(brandingRuntime(html), brandingRuntime(sourceHtml), "branding runtime must remain byte-equivalent apart from line endings");
    }
    assert.equal((html.match(/(?:src|href)=["']https?:\/\//gi) || []).length, 0, "no remote asset tags");
    const report = fs.readFileSync(path.join(path.dirname(filePath), "conversion-report.md"), "utf8");
    assert.match(report, /unity-runtime-hardening-v2/);
    assert.doesNotMatch(report, /mraid\.open\((?:url|t)\)/);
    assert.doesNotMatch(report, /mraid\.js is not referenced/i);
  }
}

function makeClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function runtimeLifecycleAudit() {
  const filePath = walkFinalHtmlFiles(UNITY_ROOT)[0];
  const html = fs.readFileSync(filePath, "utf8");
  const runtimeMatch = html.match(new RegExp(`<script ${RUNTIME_MARKER}>([\\s\\S]*?)<\\/script>`));
  assert.ok(runtimeMatch, "runtime bootstrap must be extractable");

  const nativeFrames = new Map();
  let nextFrame = 1;
  let replaceCount = 0;
  let audioSuspendCount = 0;
  let audioResumeCount = 0;
  const mraidListeners = new Map();
  const elements = new Map();

  function element() {
    return {
      classList: makeClassList(),
      style: {},
      textContent: "",
      parentNode: { removeChild() {} },
      setAttribute() {},
      addEventListener() {},
      dispatchEvent() {},
      querySelector(selector) { return elements.get(selector) || null; }
    };
  }

  const loader = element();
  const progressBar = element();
  const progressValue = element();
  const status = element();
  const progressElement = element();
  loader.querySelector = (selector) => selector === ".loading-progress" ? progressElement : null;
  elements.set("loading-screen", loader);
  elements.set("unity-loading-progress-bar", progressBar);
  elements.set("unity-loading-progress-value", progressValue);
  elements.set("unity-loading-status", status);

  const source = element();
  source.textContent = "window.__moduleExecuted = true;";
  source.replaceWith = () => { replaceCount += 1; };

  const document = {
    activeElement: { blur() {} },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) { return selector === "script[data-unity-delayed-module]" ? source : null; },
    querySelectorAll() { return []; },
    createElement() { return element(); }
  };

  function OriginalAudioContext() {
    this.state = "running";
    this.suspend = () => { audioSuspendCount += 1; this.state = "suspended"; return Promise.resolve(); };
    this.resume = () => { audioResumeCount += 1; this.state = "running"; return Promise.resolve(); };
  }

  const window = {
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      nativeFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { nativeFrames.delete(id); },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AudioContext: OriginalAudioContext,
    addEventListener() {},
    dispatchEvent() {},
    mraid: {
      getState() { return "loading"; },
      isViewable() { return false; },
      addEventListener(name, callback) { mraidListeners.set(name, callback); }
    }
  };

  const context = vm.createContext({
    window,
    document,
    performance,
    console,
    Promise,
    Map,
    Set,
    Event: class Event { constructor(type) { this.type = type; } },
    Error,
    Function,
    String,
    Math,
    Object,
    Array
  });
  vm.runInContext(runtimeMatch[1], context);

  function flushFrames() {
    const pending = Array.from(nativeFrames.entries());
    nativeFrames.clear();
    for (const [, callback] of pending) callback(performance.now());
  }

  window.__unityRuntime.markLoadingDomReady();
  window.__unityRuntime.payloadAvailable();
  flushFrames();
  flushFrames();
  assert.equal(replaceCount, 0, "payload must not start before MRAID ready/viewable");

  assert.ok(mraidListeners.has("ready"), "loading MRAID state must wait for ready");
  mraidListeners.get("ready")();
  assert.ok(mraidListeners.has("viewableChange"), "ready must install persistent viewable listener");
  mraidListeners.get("viewableChange")(true);
  flushFrames();
  flushFrames();
  window.__unityPlayableReady = { then(resolve) { resolve(); } };
  flushFrames();
  assert.equal(replaceCount, 1, "first viewable=true must initialize once");

  let frameCount = 0;
  window.requestAnimationFrame(() => { frameCount += 1; });
  const audio = new window.AudioContext();
  mraidListeners.get("viewableChange")(false);
  flushFrames();
  assert.equal(frameCount, 0, "viewable=false must pause animation frames");
  assert.equal(audioSuspendCount, 1, "viewable=false must suspend WebAudio");
  mraidListeners.get("viewableChange")(true);
  flushFrames();
  assert.equal(frameCount, 1, "viewable=true must resume animation frames");
  assert.equal(audioResumeCount, 1, "viewable=true must resume WebAudio");
  assert.equal(replaceCount, 1, "later viewable=true events must not reinitialize");
  assert.equal(mraidListeners.has("viewableChange"), true, "viewable listener must remain active");
  assert.equal(audio.state, "running");
}

function localFallbackAudit() {
  const html = fs.readFileSync(walkFinalHtmlFiles(UNITY_ROOT)[0], "utf8");
  const runtimeMatch = html.match(new RegExp(`<script ${RUNTIME_MARKER}>([\\s\\S]*?)<\\/script>`));
  assert.match(runtimeMatch[1], /if \(!bridge \|\| typeof bridge\.addEventListener !== "function"\) \{\s*handleViewableChange\(true\)/);
}

staticAudit();
runtimeLifecycleAudit();
localFallbackAudit();
console.log("PASS: all Unity outputs, branding runtime, and MRAID lifecycle validated");
