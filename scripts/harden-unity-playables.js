#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UNITY_ROOT = path.join(ROOT, "unity");
const RUNTIME_MARKER = "data-unity-runtime-v2";
const REPORT_MARKER = "<!-- unity-runtime-hardening-v2 -->";

const LOADER_STYLE = String.raw`<style data-unity-loader-v2>
html,body{width:100%;height:100%;margin:0;background:#dff5ff}#loading-screen{position:fixed;z-index:2147483647;inset:0;display:grid;place-content:center;justify-items:center;gap:16px;padding:28px;text-align:center;color:#143055;background:#dff5ff;transition:opacity .32s ease,visibility .32s ease}#loading-screen.is-hidden{opacity:0;visibility:hidden;pointer-events:none}#loading-screen.has-error{color:#7b1d1d;background:#fff2f2}#loading-screen h1{max-width:calc(100vw - 44px);margin:0;font:800 28px/1.1 system-ui,sans-serif;letter-spacing:0}.loading-progress{width:min(320px,calc(100vw - 80px));height:13px;overflow:hidden;border:1px solid rgba(20,48,85,.18);border-radius:7px;background:#fff}.loading-progress-bar{width:8%;height:100%;background:#2aa7ff;transition:width .18s ease}.loading-progress-value,.loading-status{margin:0;font:700 13px/1.2 system-ui,sans-serif;letter-spacing:0}.loading-status{font-weight:600}
</style>`;

function buildLoaderHtml(originalHtml) {
  const legacyLoaderStart = originalHtml.indexOf('<div id="loading-screen"');
  const legacyLoaderEnd = legacyLoaderStart < 0
    ? -1
    : originalHtml.indexOf('id="loading-progress-value"', legacyLoaderStart);
  const legacyLoader = legacyLoaderStart >= 0 && legacyLoaderEnd >= 0
    ? originalHtml.slice(legacyLoaderStart, legacyLoaderEnd)
    : "";
  const headingMatch = legacyLoader.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i);
  const titleMatch = originalHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const escapedTitle = (titleMatch?.[1] || "Playable")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const heading = headingMatch?.[0] || `<h1>${escapedTitle}</h1>`;

  return String.raw`<div id="loading-screen" class="loading-screen" role="status" aria-live="polite">
      ${heading}
      <div class="loading-progress" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="8">
        <div id="unity-loading-progress-bar" class="loading-progress-bar"></div>
      </div>
      <p id="unity-loading-progress-value" class="loading-progress-value">8%</p>
      <p id="unity-loading-status" class="loading-status">Loading...</p>
    </div>
    <script>window.__unityRuntime.markLoadingDomReady();</script>`;
}

const RUNTIME_SCRIPT = String.raw`<script ${RUNTIME_MARKER}>
(function unityRuntimeBootstrap() {
  "use strict";

  var nativeRaf = window.requestAnimationFrame.bind(window);
  var nativeCancelRaf = window.cancelAnimationFrame.bind(window);
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var nativeSetInterval = window.setInterval.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);
  var rafRecords = new Map();
  var timerRecords = new Map();
  var audioContexts = new Set();
  var suspendedAudioContexts = new Set();
  var nextRafId = 1;
  var nextTimerId = 1;
  var rafTimeOffset = 0;
  var pauseStartedAt = 0;
  var progress = 8;
  var loadingPainted = false;
  var payloadAvailable = false;
  var started = false;
  var startScheduled = false;
  var viewable = false;
  var paused = true;
  var moduleReady = false;
  var firstFrameRendered = false;
  var failed = false;
  var viewableListenerInstalled = false;

  function loadingElement() {
    return document.getElementById("loading-screen");
  }

  function setProgress(value, status) {
    if (failed) return;
    progress = Math.max(progress, Math.min(100, Math.round(value)));
    var screen = loadingElement();
    var bar = document.getElementById("unity-loading-progress-bar");
    var label = document.getElementById("unity-loading-progress-value");
    var progressElement = screen && screen.querySelector(".loading-progress");
    var statusElement = document.getElementById("unity-loading-status");
    if (bar) bar.style.width = progress + "%";
    if (label) label.textContent = progress + "%";
    if (progressElement) progressElement.setAttribute("aria-valuenow", String(progress));
    if (status && statusElement) statusElement.textContent = status;
  }

  function showError(error) {
    if (failed) return;
    failed = true;
    var screen = loadingElement();
    var statusElement = document.getElementById("unity-loading-status");
    if (screen) {
      screen.classList.remove("is-hidden");
      screen.classList.add("has-error");
      screen.setAttribute("role", "alert");
    }
    if (statusElement) statusElement.textContent = "Unable to start. Please try again.";
    console.error("Unity playable failed to start.", error);
  }

  function completeLoading() {
    if (failed || firstFrameRendered === false) return;
    setProgress(100, "Ready");
    var screen = loadingElement();
    if (!screen) return;
    screen.classList.add("is-hidden");
    nativeSetTimeout(function removeLoadingScreen() {
      if (screen.parentNode) screen.parentNode.removeChild(screen);
    }, 360);
  }

  function noteRenderedFrame() {
    if (!moduleReady || firstFrameRendered || failed) return;
    firstFrameRendered = true;
    nativeRaf(completeLoading);
  }

  function scheduleRaf(record) {
    record.nativeId = nativeRaf(function runManagedAnimationFrame(timestamp) {
      rafRecords.delete(record.id);
      try {
        record.callback(timestamp - rafTimeOffset);
      } finally {
        noteRenderedFrame();
      }
    });
  }

  window.requestAnimationFrame = function managedRequestAnimationFrame(callback) {
    var record = { id: nextRafId++, callback: callback, nativeId: 0 };
    rafRecords.set(record.id, record);
    if (!paused) scheduleRaf(record);
    return record.id;
  };

  window.cancelAnimationFrame = function managedCancelAnimationFrame(id) {
    var record = rafRecords.get(id);
    if (!record) {
      nativeCancelRaf(id);
      return;
    }
    if (record.nativeId) nativeCancelRaf(record.nativeId);
    rafRecords.delete(id);
  };

  function scheduleTimer(record, delay) {
    record.remaining = Math.max(0, Number(delay) || 0);
    record.startedAt = performance.now();
    record.nativeId = nativeSetTimeout(function runManagedTimer() {
      record.nativeId = 0;
      if (record.kind === "timeout") timerRecords.delete(record.id);
      try {
        if (typeof record.handler === "function") {
          record.handler.apply(window, record.args);
        } else {
          Function(String(record.handler))();
        }
      } finally {
        if (record.kind === "interval" && timerRecords.has(record.id) && !paused) {
          scheduleTimer(record, record.delay);
        }
      }
    }, record.remaining);
  }

  function createTimer(kind, handler, delay, args) {
    var record = {
      id: nextTimerId++,
      kind: kind,
      handler: handler,
      args: args,
      delay: Math.max(0, Number(delay) || 0),
      remaining: Math.max(0, Number(delay) || 0),
      startedAt: performance.now(),
      nativeId: 0
    };
    timerRecords.set(record.id, record);
    if (!paused) scheduleTimer(record, record.remaining);
    return record.id;
  }

  function clearManagedTimer(id) {
    var record = timerRecords.get(id);
    if (!record) {
      nativeClearTimeout(id);
      nativeClearInterval(id);
      return;
    }
    if (record.nativeId) nativeClearTimeout(record.nativeId);
    timerRecords.delete(id);
  }

  window.setTimeout = function managedSetTimeout(handler, delay) {
    return createTimer("timeout", handler, delay, Array.prototype.slice.call(arguments, 2));
  };
  window.clearTimeout = clearManagedTimer;
  window.setInterval = function managedSetInterval(handler, delay) {
    return createTimer("interval", handler, delay, Array.prototype.slice.call(arguments, 2));
  };
  window.clearInterval = clearManagedTimer;

  function wrapAudioContext(name) {
    var Original = window[name];
    if (typeof Original !== "function") return;
    function ManagedAudioContext() {
      var args = [null].concat(Array.prototype.slice.call(arguments));
      var Bound = Function.prototype.bind.apply(Original, args);
      var context = new Bound();
      audioContexts.add(context);
      return context;
    }
    ManagedAudioContext.prototype = Original.prototype;
    try { Object.setPrototypeOf(ManagedAudioContext, Original); } catch (error) {}
    window[name] = ManagedAudioContext;
  }

  wrapAudioContext("AudioContext");
  wrapAudioContext("webkitAudioContext");

  function pauseTimers() {
    var now = performance.now();
    timerRecords.forEach(function pauseTimer(record) {
      if (!record.nativeId) return;
      nativeClearTimeout(record.nativeId);
      record.nativeId = 0;
      record.remaining = Math.max(0, record.remaining - (now - record.startedAt));
    });
  }

  function resumeTimers() {
    timerRecords.forEach(function resumeTimer(record) {
      if (!record.nativeId) scheduleTimer(record, record.remaining);
    });
  }

  function pauseAnimationFrames() {
    rafRecords.forEach(function pauseFrame(record) {
      if (!record.nativeId) return;
      nativeCancelRaf(record.nativeId);
      record.nativeId = 0;
    });
  }

  function resumeAnimationFrames() {
    rafRecords.forEach(function resumeFrame(record) {
      if (!record.nativeId) scheduleRaf(record);
    });
  }

  function pauseAudio() {
    audioContexts.forEach(function suspendContext(context) {
      if (context.state !== "running" || typeof context.suspend !== "function") return;
      suspendedAudioContexts.add(context);
      Promise.resolve(context.suspend()).catch(function ignoreSuspendError() {});
    });
  }

  function resumeAudio() {
    suspendedAudioContexts.forEach(function resumeContext(context) {
      if (typeof context.resume === "function") {
        Promise.resolve(context.resume()).catch(function ignoreResumeError() {});
      }
    });
    suspendedAudioContexts.clear();
  }

  function cancelTransientInteraction() {
    ["pointercancel", "touchcancel", "mouseup", "blur"].forEach(function dispatchCancel(type) {
      try { window.dispatchEvent(new Event(type)); } catch (error) {}
    });
    document.querySelectorAll("canvas").forEach(function cancelCanvasInput(canvas) {
      try { canvas.dispatchEvent(new Event("pointercancel", { bubbles: true })); } catch (error) {}
    });
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }

  function pausePlayable() {
    if (paused) return;
    paused = true;
    if (started) pauseStartedAt = performance.now();
    pauseAnimationFrames();
    pauseTimers();
    pauseAudio();
    cancelTransientInteraction();
  }

  function resumePlayable() {
    if (!paused) return;
    if (started && pauseStartedAt) rafTimeOffset += performance.now() - pauseStartedAt;
    pauseStartedAt = 0;
    paused = false;
    resumeTimers();
    resumeAudio();
    resumeAnimationFrames();
  }

  function onModuleReady() {
    moduleReady = true;
    setProgress(90, "Starting scene...");
  }

  function waitForReadyPromise(attempt) {
    var ready = window.__unityPlayableReady;
    if (ready && typeof ready.then === "function") {
      ready.then(onModuleReady, showError);
      return;
    }
    if (attempt >= 1200) {
      showError(new Error("Playable ready promise was not exposed."));
      return;
    }
    nativeSetTimeout(function pollReadyPromise() {
      waitForReadyPromise(attempt + 1);
    }, 16);
  }

  function startPlayable() {
    startScheduled = false;
    if (started || failed || !viewable || !loadingPainted || !payloadAvailable) return;
    started = true;
    rafTimeOffset = 0;
    pauseStartedAt = 0;
    setProgress(60, "Preparing game...");
    var source = document.querySelector("script[data-unity-delayed-module]");
    if (!source) {
      showError(new Error("Delayed playable payload is missing."));
      return;
    }
    var module = document.createElement("script");
    module.type = "module";
    module.textContent = source.textContent;
    module.addEventListener("error", showError, { once: true });
    source.replaceWith(module);
    setProgress(72, "Loading assets...");
    waitForReadyPromise(0);
  }

  function maybeStartPlayable() {
    if (started || startScheduled || failed || !viewable || !loadingPainted || !payloadAvailable) return;
    startScheduled = true;
    setProgress(48, "Initializing...");
    nativeRaf(function waitOnePaint() {
      nativeRaf(startPlayable);
    });
  }

  function handleViewableChange(isViewable) {
    viewable = isViewable === true;
    if (viewable) {
      resumePlayable();
      maybeStartPlayable();
    } else {
      pausePlayable();
    }
  }

  function bindViewableListener() {
    if (viewableListenerInstalled) return;
    viewableListenerInstalled = true;
    var bridge = window.mraid;
    bridge.addEventListener("viewableChange", handleViewableChange);
    handleViewableChange(typeof bridge.isViewable === "function" ? bridge.isViewable() : false);
  }

  function initializeMraid() {
    var bridge = window.mraid;
    if (!bridge || typeof bridge.addEventListener !== "function") {
      handleViewableChange(true);
      return;
    }
    if (typeof bridge.getState === "function" && bridge.getState() === "loading") {
      bridge.addEventListener("ready", bindViewableListener);
    } else {
      bindViewableListener();
    }
  }

  window.__unityRuntime = {
    markLoadingDomReady: function markLoadingDomReady() {
      setProgress(16, "Loading...");
      nativeRaf(function waitForLoaderPaintOne() {
        nativeRaf(function waitForLoaderPaintTwo() {
          loadingPainted = true;
          setProgress(24, "Loading package...");
          maybeStartPlayable();
        });
      });
    },
    payloadAvailable: function markPayloadAvailable() {
      payloadAvailable = true;
      setProgress(36, "Package ready...");
      maybeStartPlayable();
    },
    state: function runtimeState() {
      return {
        started: started,
        viewable: viewable,
        paused: paused,
        moduleReady: moduleReady,
        firstFrameRendered: firstFrameRendered,
        failed: failed,
        progress: progress
      };
    }
  };

  initializeMraid();
}());
</script>`;

function walkFinalHtmlFiles(directory) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith("_")) results.push(...walkFinalHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function extractSingle(text, regex, label, filePath) {
  const matches = Array.from(text.matchAll(regex));
  if (matches.length !== 1) {
    throw new Error(`${filePath}: expected one ${label}, found ${matches.length}`);
  }
  return matches[0];
}

function removeLegacyLoadingScreen(body, filePath) {
  const start = body.indexOf('<div id="loading-screen"');
  if (start < 0) throw new Error(`${filePath}: loading screen start not found`);
  const label = body.indexOf('id="loading-progress-value"', start);
  const paragraphEnd = label < 0 ? -1 : body.indexOf("</p>", label);
  const end = paragraphEnd < 0 ? -1 : body.indexOf("</div>", paragraphEnd);
  if (end < 0) throw new Error(`${filePath}: loading screen end not found`);
  return body.slice(0, start) + body.slice(end + "</div>".length);
}

function patchPayload(payload, filePath) {
  const readyMarker = ".ready?.finally(()=>{";
  const readyIndex = payload.indexOf(readyMarker);
  if (readyIndex < 0 || payload.indexOf(readyMarker, readyIndex + readyMarker.length) >= 0) {
    throw new Error(`${filePath}: expected exactly one ready.finally loader hook`);
  }
  const ownerMatch = payload.slice(Math.max(0, readyIndex - 80), readyIndex).match(/([A-Za-z_$][\w$]*)$/);
  const readyEndMarker = ",360)})";
  const readyEnd = payload.indexOf(readyEndMarker, readyIndex);
  if (!ownerMatch || readyEnd < 0 || readyEnd - readyIndex > 400) {
    throw new Error(`${filePath}: unsupported ready.finally loader hook`);
  }
  const ownerStart = readyIndex - ownerMatch[1].length;
  payload = payload.slice(0, ownerStart)
    + `window.__unityPlayableReady=${ownerMatch[1]}.ready`
    + payload.slice(readyEnd + readyEndMarker.length);

  let ctaCount = 0;
  payload = payload.replace(/window\.mraid\.open\([^()]*\)/g, () => {
    ctaCount += 1;
    return "window.mraid.open()";
  });
  if (ctaCount !== 1) {
    throw new Error(`${filePath}: expected one MRAID CTA call, found ${ctaCount}`);
  }
  return payload;
}

function transformLegacyHtml(text, filePath) {
  if (text.includes(RUNTIME_MARKER)) return text;

  const headMatch = extractSingle(text, /<head\b[^>]*>([\s\S]*?)<\/head>/gi, "head", filePath);
  const bodyMatch = extractSingle(text, /<body\b[^>]*>([\s\S]*?)<\/body>/gi, "body", filePath);
  const scripts = Array.from(text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  let payloadScripts = scripts.filter((match) =>
    /data-unity-delayed-module/i.test(match[1])
    || /type=["']application\/x-unity-playable-module["']/i.test(match[1]));
  if (payloadScripts.length === 0) {
    payloadScripts = scripts.filter((match) =>
      /type=["']module["']/i.test(match[1])
      && match[2].includes(".ready?.finally("));
  }
  if (payloadScripts.length !== 1) {
    throw new Error(`${filePath}: expected one supported gameplay payload, found ${payloadScripts.length}`);
  }

  const payloadScript = payloadScripts[0];
  const payload = patchPayload(payloadScript[2], filePath);
  const styles = Array.from(headMatch[1].matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi), (match) => match[0]);
  if (styles.length === 0) throw new Error(`${filePath}: no gameplay style found`);
  const headMetadata = headMatch[1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .trim();
  const bodyStart = bodyMatch.index;
  const bodyEnd = bodyStart + bodyMatch[0].length;
  const supportingBodyScripts = scripts
    .filter((match) => match.index > bodyStart && match.index < bodyEnd && match.index !== payloadScript.index)
    .map((match) => match[0]);
  const bodyWithoutScripts = bodyMatch[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const gameplayBody = removeLegacyLoadingScreen(bodyWithoutScripts, filePath).trim();
  const doctype = (text.match(/<!doctype[^>]*>/i) || ["<!doctype html>"])[0];
  const htmlOpen = (text.match(/<html\b[^>]*>/i) || ["<html>"])[0];

  return `${doctype}\n${htmlOpen}\n<head>\n${headMetadata}\n${LOADER_STYLE}\n<script src="mraid.js"></script>\n${RUNTIME_SCRIPT}\n</head>\n<body>\n    ${buildLoaderHtml(text)}\n    ${styles.join("\n")}\n    ${gameplayBody}\n    ${supportingBodyScripts.join("\n")}\n    <script id="unity-playable-module" type="text/plain" data-unity-delayed-module>${payload}</script>\n    <script>window.__unityRuntime.payloadAvailable();</script>\n</body>\n</html>\n`;
}

function validateHardenedHtml(text, filePath) {
  const bodyIndex = text.indexOf("<body>");
  const loaderIndex = text.indexOf('id="loading-screen"');
  const payloadIndex = text.indexOf('<script id="unity-playable-module"');
  const checks = [
    [text.includes(RUNTIME_MARKER), "runtime marker missing"],
    [text.includes('<script src="mraid.js"></script>'), "mraid.js reference missing"],
    [bodyIndex >= 0 && loaderIndex > bodyIndex && loaderIndex < payloadIndex, "loader must precede payload"],
    [loaderIndex < text.length * 0.05, "loader appears too late in the file"],
    [payloadIndex > loaderIndex, "payload must follow loader"],
    [!text.includes(".ready?.finally("), "legacy ready.finally remains"],
    [text.includes("ready.then(onModuleReady, showError)"), "ready.then success/error handling missing"],
    [(text.match(/window\.mraid\.open\(\)/g) || []).length === 1, "expected one no-argument CTA"],
    [!(/window\.mraid\.open\([^)]{1,}\)/.test(text)), "parameterized MRAID CTA remains"],
    [text.includes('bridge.addEventListener("viewableChange", handleViewableChange)'), "persistent viewable listener missing"],
    [!text.includes('removeEventListener("viewableChange"'), "viewable listener is removed"],
    [text.includes("pauseAnimationFrames();") && text.includes("pauseAudio();") && text.includes("cancelTransientInteraction();"), "pause controls incomplete"],
    [text.includes("resumeAnimationFrames();") && text.includes("resumeAudio();"), "resume controls incomplete"],
    [text.includes("nativeRaf(function waitOnePaint()") && text.includes("nativeRaf(startPlayable);"), "double-paint startup gate missing"],
    [text.includes("noteRenderedFrame();") && text.includes("nativeRaf(completeLoading);"), "first-frame completion gate missing"],
    [text.includes("showError") && text.includes('screen.classList.add("has-error")'), "persistent error UI missing"],
    [[8, 16, 24, 36, 48, 60, 72, 90, 100].every((value) => text.includes(`setProgress(${value}`) || text.includes(`>${value}%<`)), "staged progress values missing"],
    [Buffer.byteLength(text, "utf8") < 5 * 1024 * 1024, "Unity single HTML exceeds 5 MiB"]
  ];
  const failures = checks.filter((check) => !check[0]).map((check) => check[1]);
  if (failures.length) throw new Error(`${filePath}: ${failures.join("; ")}`);
}

function updateReport(htmlPath, htmlText, checkOnly) {
  const reportPath = path.join(path.dirname(htmlPath), "conversion-report.md");
  if (!fs.existsSync(reportPath)) return;
  const current = fs.readFileSync(reportPath, "utf8")
    .replace(/`mraid\.open\(url\)`/g, "`mraid.open()`")
    .replace(/- Restored the store URL argument in the CTA call: `window\.mraid\.open\(t\)`\./g,
      "- Unity CTA uses the required no-argument call: `window.mraid.open()`.")
    .replace(/^- Unity target should start content after MRAID viewableChange=true; patch startup manually\.\r?\n/gm, "");
  const compliance = `${REPORT_MARKER}\n## Unity Runtime Hardening (integrated)\n\n- Explicit MRAID declaration: \`<script src="mraid.js"></script>\`\n- CTA bridge: one click-only, no-argument \`mraid.open()\` call (per project requirement)\n- Startup: waits for MRAID ready and persistent \`viewableChange=true\`, then two painted animation frames\n- Background lifecycle: pauses/resumes animation frames, WebAudio, timers, and transient input\n- Loading: DOM precedes payload; staged progress; fade only after ready success and first rendered frame\n- Failure behavior: loading UI remains visible as an error screen\n- Package size: ${Buffer.byteLength(htmlText, "utf8").toLocaleString("en-US")} bytes\n`;
  const next = current.includes(REPORT_MARKER)
    ? current.slice(0, current.indexOf(REPORT_MARKER)).trimEnd() + "\n\n" + compliance
    : current.trimEnd() + "\n\n" + compliance;
  if (!checkOnly) fs.writeFileSync(reportPath, next, "utf8");
}

function hardenDirectory(directory, { checkOnly = false } = {}) {
  const resolvedDirectory = path.resolve(directory);
  if (!fs.existsSync(resolvedDirectory) || !fs.statSync(resolvedDirectory).isDirectory()) {
    throw new Error(`Unity output directory does not exist: ${resolvedDirectory}`);
  }
  const files = walkFinalHtmlFiles(resolvedDirectory);
  if (files.length === 0) throw new Error("No final Unity HTML files found.");
  for (const filePath of files) {
    const original = fs.readFileSync(filePath, "utf8");
    const transformed = transformLegacyHtml(original, filePath);
    validateHardenedHtml(transformed, filePath);
    if (!checkOnly && transformed !== original) fs.writeFileSync(filePath, transformed, "utf8");
    updateReport(filePath, transformed, checkOnly);
    const relative = path.relative(ROOT, filePath);
    console.log(`${checkOnly ? "checked" : "hardened"}: ${relative} (${Buffer.byteLength(transformed, "utf8")} bytes)`);
  }
  console.log(`${checkOnly ? "validated" : "updated"} ${files.length} Unity playable(s)`);
  return files;
}

function parseCliOptions(argv) {
  let root = UNITY_ROOT;
  let checkOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      checkOnly = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory path");
      root = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { root, checkOnly };
}

function main(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  return hardenDirectory(options.root, { checkOnly: options.checkOnly });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  RUNTIME_MARKER,
  hardenDirectory,
  walkFinalHtmlFiles,
  transformLegacyHtml,
  validateHardenedHtml
};
