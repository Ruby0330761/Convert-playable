#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  hardenDirectory,
  walkFinalHtmlFiles
} = require("./harden-unity-playables.js");

const REPORT_MARKER = "<!-- unity-runtime-hardening-v2 -->";
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
    "  node scripts/convert-applovin-to-unity.js --input <applovin.html> --output-dir <directory> [options]",
    "",
    "Options:",
    "  --orientation <portrait|landscape|both>  Default: both",
    "  --python <executable>                    Override Python runtime",
    "  --converter <path>                      Override upstream converter script",
    "  --help                                  Show this help"
  ].join("\n");
}

function parseArgs(argv) {
  const options = { orientation: "both" };
  const valueOptions = new Set(["--input", "--output-dir", "--orientation", "--python", "--converter"]);
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
  if (!["portrait", "landscape", "both"].includes(options.orientation)) {
    throw new Error(`Unsupported orientation: ${options.orientation}`);
  }
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

function runConverter({ python, converter, input, outputDir, orientation }) {
  const result = spawnSync(python, [
    converter,
    "--input", input,
    "--source-platform", "applovin",
    "--target-platform", "unity",
    "--output-dir", outputDir,
    "--orientation", orientation
  ], { stdio: "inherit" });
  if (result.error) throw new Error(`Unable to start upstream converter: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Upstream converter failed with exit code ${result.status}`);
}

function assertMechanicalOutput(outputDir) {
  const expectedHtml = path.join(outputDir, "index.html");
  const files = walkFinalHtmlFiles(outputDir);
  if (files.length !== 1 || path.resolve(files[0]) !== path.resolve(expectedHtml)) {
    throw new Error(`Expected exactly one Unity package at ${expectedHtml}; found ${files.length}`);
  }
  const report = path.join(outputDir, "conversion-report.md");
  if (!fs.existsSync(report)) throw new Error(`Conversion report is missing: ${report}`);
  return { html: expectedHtml, report };
}

function runPipeline(options) {
  const input = path.resolve(options.input);
  const outputDir = path.resolve(options.outputDir);
  if (!fs.existsSync(input)) throw new Error(`Input does not exist: ${input}`);
  const python = resolvePython(options.python);
  const converter = resolveConverter(options.converter);

  console.log(`[1/3] Mechanical AppLovin -> Unity conversion`);
  runConverter({ python, converter, input, outputDir, orientation: options.orientation });
  const output = assertMechanicalOutput(outputDir);

  console.log(`[2/3] Unity runtime hardening`);
  hardenDirectory(outputDir);

  console.log(`[3/3] Fail-closed Unity validation`);
  hardenDirectory(outputDir, { checkOnly: true });
  const reportText = fs.readFileSync(output.report, "utf8");
  if (!reportText.includes(REPORT_MARKER)) {
    throw new Error("Conversion report does not contain the Unity hardening result.");
  }
  if (/patch startup manually/i.test(reportText)) {
    throw new Error("Conversion report still requests manual Unity startup patching.");
  }

  console.log(`[OK] Integrated AppLovin -> Unity pipeline complete`);
  console.log(`[OK] Package: ${output.html}`);
  console.log(`[OK] Report: ${output.report}`);
  return output;
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
  parseArgs,
  resolvePython,
  runPipeline
};
