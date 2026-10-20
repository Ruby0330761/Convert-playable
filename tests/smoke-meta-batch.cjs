"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const runtimeRequire = createRequire(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/", "package.json"));
const { chromium } = runtimeRequire("playwright");
const python = path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.ok(manifest.length && manifest.every(item => item.status === "PASS" && item.output), "Batch manifest contains failed or incomplete deliveries; finish conversion before browser QA.");
const evidence = path.resolve(process.argv[3]);
fs.mkdirSync(evidence, { recursive: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "meta-smoke-"));
const results = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(staging, `.${decodeURIComponent(url.pathname)}`);
  if (!file.startsWith(staging + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream");
  res.end(fs.readFileSync(file));
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    for (let i = 0; i < manifest.length; i++) {
      if (process.env.META_SMOKE_INDICES && !process.env.META_SMOKE_INDICES.split(",").map(Number).includes(i)) continue;
      const item = manifest[i];
      const dir = path.join(staging, String(i));
      const unzip = spawnSync(python, ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", item.output, dir]);
      if (unzip.status !== 0) throw new Error("ZIP extraction failed");
      for (const required of ["index.html", "index.js", "style.css"]) {
        assert.ok(fs.existsSync(path.join(dir, required)), `Missing root ${required}: ${item.output}`);
        assert.ok(fs.statSync(path.join(dir, required)).size > 0, `Empty root ${required}`);
      }
      // The full asset data-URL multiset must survive byte for byte, including duplicates.
      const assets = text => [...text.matchAll(/data:[a-z0-9.+/-]+;base64,[a-z0-9+/=]+/gi)].map(m => m[0]).sort();
      const source = fs.readFileSync(item.source, "utf8");
      const packaged = fs.readdirSync(dir).map(name => fs.readFileSync(path.join(dir, name), "utf8")).join("\n");
      assert.deepEqual(assets(packaged), assets(source), `Asset data changed: ${item.output}`);
      for (const name of fs.readdirSync(dir).filter(n => /\.m?js$/.test(n))) {
        const check = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: fs.readFileSync(path.join(dir, name)), encoding: "utf8" });
        assert.equal(check.status, 0, check.stderr);
      }
      const context = await browser.newContext({ viewport: i % 2 ? { width: 1280, height: 720 } : { width: 390, height: 844 } });
      await context.addInitScript(() => {
        window.__metaClicks = 0;
        window.FbPlayableAd = { onCTAClick() { window.__metaClicks++; } };
        window.__decodeFailures = [];
        const native = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = function (data, ...args) {
          const summary = { bytes: data.byteLength, prefix: Array.from(new Uint8Array(data).slice(0, 16)) };
          return native.call(this, data, ...args).catch(error => { window.__decodeFailures.push(summary); throw error; });
        };
      });
      const page = await context.newPage();
      const errors = [], failed = [], external = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("requestfailed", request => failed.push(request.url().slice(0, 200)));
      page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.route("**/*", route => {
        const url = route.request().url();
        if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${port}/`)) { external.push(url); return route.abort(); }
        return route.continue();
      });
      try {
        await page.goto(`http://127.0.0.1:${port}/${i}/index.html`);
        await page.waitForFunction(() => Boolean(window.__busLoop?.snapshot), { timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        const state = await page.evaluate(() => ({ title: document.title, snapshot: window.__busLoop.snapshot(), fontStatus: document.fonts.status, canvases: document.querySelectorAll("canvas").length, buttons: [...document.querySelectorAll("button")].map(b => ({id:b.id,text:b.textContent})) }));
        assert.ok(state.canvases > 0);
        assert.ok(state.title.includes("Bus"));
        const audioUrls = [...new Set(assets(source).filter(url => url.startsWith("data:audio/")))];
        const audio = await page.evaluate(async urls => {
          const context = new OfflineAudioContext(1, 1, 44100);
          return await Promise.all(urls.map(async url => {
            const response = await fetch(url);
            const decoded = await context.decodeAudioData(await response.arrayBuffer());
            return { duration: decoded.duration, channels: decoded.numberOfChannels };
          }));
        }, audioUrls);
        assert.equal(audio.length, audioUrls.length);
        // Let the authored entrance finish before exercising gameplay.
        await page.waitForTimeout(2500);
        const interaction = await page.evaluate(() => {
          const api = window.__busLoop;
          const before = api.snapshot();
          for (const vehicle of before.vehicles) {
            const result = api.game.clickVehicle(vehicle.id);
            if (result?.ok || result?.reason === "blocked") return { vehicleId: vehicle.id, result, event: api.snapshot().lastEvent };
          }
          return null;
        });
        assert.ok(interaction, "No vehicle operation responded");
        const cta = page.locator("#cta-button");
        if (await cta.isVisible()) await cta.click();
        else await page.evaluate(() => window.__busLoop.openStore());
        assert.ok(await page.evaluate(() => window.__metaClicks > 0), "CTA failed");
        await page.locator("canvas").first().click({ position: { x: 40, y: 40 }, force: true });
        await page.waitForTimeout(500);
        assert.equal(external.length, 0, "Unexpected remote fetch");
        assert.equal(failed.length, 0, "Failed resource requests");
        assert.equal(errors.length, 0, errors.join("; "));
        if ([0,2,6,10,30].includes(i)) await page.screenshot({ path: path.join(evidence, `meta-${i}.png`) });
        results.push({ file: item.output, status: "PASS", title: state.title, fontStatus: state.fontStatus, assetCount: assets(source).length, decodedAudio: audio, interaction, ctaClicks: await page.evaluate(() => window.__metaClicks), external, errors });
      } catch (error) { results.push({ file: item.output, status: "FAIL", reason: error.message, errors, failed, external, decodeFailures: await page.evaluate(() => window.__decodeFailures) }); }
      await context.close();
      console.log(`${i + 1}/${manifest.length} ${results.at(-1).status} ${path.basename(item.output)}`);
      if (results.at(-1).status === "FAIL") console.log(JSON.stringify(results.at(-1)));
    }
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.rmSync(staging, { recursive: true, force: true });
    fs.writeFileSync(path.join(evidence, "browser-results.json"), JSON.stringify(results, null, 2));
  }
  if (results.some(r => r.status !== "PASS")) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
