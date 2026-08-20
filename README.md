# Playable format conversion

## AppLovin to Unity

Use the integrated command for every AppLovin-to-Unity conversion:

```powershell
node scripts\convert-applovin-to-unity.js `
  --input "applovin\example.html" `
  --output-dir "unity\example_unity"
```

The command is fail-closed and runs three required stages:

1. Mechanical AppLovin-to-Unity conversion with the upstream format converter.
2. Unity runtime hardening for loading order, MRAID declaration/lifecycle, staged progress, first-frame loading fade, and no-argument `mraid.open()` CTA.
3. Static and lifecycle contract validation of the final single HTML.

Do not run the upstream Python converter alone for Unity delivery. Its mechanical output still contains the inherited AppLovin loading and lifecycle issues.

Use a dedicated output directory. The pipeline requires exactly one final `index.html` outside `_work` and stops if stale or additional HTML files are present.

The command automatically checks the bundled Codex Python runtime, then `python3` and `python`. Use `--python <path>` or `PLAYABLE_PYTHON` when another runtime is required. Use `--converter <path>` or `PLAYABLE_CONVERTER` when the conversion skill is installed elsewhere.

Standalone hardening remains available for existing Unity output directories:

```powershell
node scripts\harden-unity-playables.js --root "unity\example_unity"
node scripts\harden-unity-playables.js --root "unity\example_unity" --check
```

Run the regression suites after changing either conversion stage:

```powershell
node tests\test-unity-playables.js
node tests\test-conversion-pipeline.js
```
