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
2. Unity runtime hardening for loading order, MRAID declaration/lifecycle, staged progress, first-frame loading fade, no-argument `mraid.open()` CTA, scene-ready EntryBanner hooks, and preservation of non-payload body scripts such as branding layout/runtime code.
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

## AppLovin to Meta

Use the integrated Meta entrypoint for a strict ZIP package:

```powershell
node scripts\\convert-applovin-to-meta.js `
  --input "applovin\\Android\\Example_applovin_Android.html" `
  --output-dir "meta\\Android\\Example_meta_Android" `
  --orientation portrait
```

The pipeline replaces the AppLovin/MRAID CTA with `FbPlayableAd.onCTAClick()`, rejects JavaScript redirects, writes a root `index.html`, and fails closed when Meta's limits are exceeded: `index.html < 2MB`, ZIP `<= 5MB`, and no more than 100 files. Validate the resulting ZIP in Meta's official Playable Preview (`https://developers.facebook.com/tools/playable-preview/`) and in the actual Ads Manager upload flow. Meta playable ads require the App Installs objective; local conversion does not confirm audio or backend approval.

Meta export automatically distributes the first inline executable script into root `index.js` and the first inline stylesheet into root `style.css`; both are loaded by root `index.html`. Additional scripts/styles use `runtime-N.js` / `style-N.css` to preserve their original order and behavior. These three required root files must be nonempty, referenced in HTML, and present at the ZIP root; missing/misnamed files fail validation. Script order, `type="module"`, JSON metadata, and embedded asset bytes are preserved. All references are relative inside the ZIP; no CDN or runtime download is introduced. This avoids the 2 MB entry HTML limit without lossy image/audio compression or changing synchronous data-URL loaders. Optional one-byte placeholder audio uses one sample of silence instead of throwing a native decode error. Validation scans the external scripts too, not just the HTML. The file limit is strictly fewer than 100.

Convert several organized source folders into Meta-only Android/iOS delivery folders:

```powershell
node scripts/batch-meta-folders.js --input "D:/source/group-a" --input "D:/source/group-b" --output-dir "D:/delivery/meta"
```

This scans only each source folder's AppLovin HTML files, preserves the group/device layout, uses `FB` for new-style channel names and `meta` for legacy platform names, and writes a manifest/report. Source folders remain untouched. The command fails if any conversion fails.

Run the Meta regression suite after changing this pipeline:

```powershell
node tests\\test-meta-conversion-pipeline.js
```

## AppLovin to Google Ads

Convert all Android and iOS AppLovin HTML files in one batch:

```powershell
node scripts\convert-applovin-to-google.js `
  --input "applovin" `
  --output-dir "google"
```

The batch command preserves the Android/IOS split and replaces the platform marker in every name:

```text
google/
  Android/
    Example_google_Android/
      Example_google_Android.zip
      conversion-report.md
  IOS/
    Example_google_IOS/
      Example_google_IOS.zip
      conversion-report.md
  batch-conversion-report.md
```

Convert only one platform with `--platform android` or `--platform ios`. A single source HTML is also supported:

```powershell
node scripts\convert-applovin-to-google.js `
  --input "applovin\Android\Example_applovin_Android.html" `
  --output-dir "google"
```

The integrated Google command performs the upstream mechanical conversion, applies the strict Google delivery wrapper, renames `google.zip` to the source-derived delivery name, and validates these requirements before publishing it:

- root-level `index.html`, `index.js`, and `style.css`, all referenced through local relative paths
- Google `ExitApi.exit()` CTA with exactly one `exitapi.js` reference and no MRAID open guard
- exact `ad.orientation` and matching `ad.size` metadata in `<head>`
- ZIP size at or below 5,000,000 bytes and no more than 512 files
- no unsupported remote asset tags or unsafe ZIP paths

Google output defaults to portrait delivery with `ad.orientation=portrait` and `ad.size=width=320,height=480`. Use `--orientation landscape` only for a separate landscape delivery; it writes the matching `480x320` size. The `both` option remains available for an explicitly requested dual-orientation package, but the strict portrait validator will reject it.

Android Google packages also receive a Google-specific compliant result page before ZIP conversion:

- the complete product name remains visible as text on the final result page
- the custom `Play Now` button is replaced by the embedded official Google Play badge
- the persistent Icon/Logo/text branding layer is hidden while the result page is visible
- portrait keeps the existing result Logo above the product name and badge
- landscape hides the oversized result Logo and separates the product name and badge vertically

The default product name is `Bus Fever - Car Jam Escape`, and the default badge is `assets/google/google-play-badge.png`. Override them when needed:

```powershell
node scripts\convert-applovin-to-google.js `
  --input "applovin\Android\Example_applovin_Android_shape.html" `
  --output-dir "google" `
  --product-name "Bus Fever - Car Jam Escape" `
  --android-badge "assets\google\google-play-badge.png"
```

The Android compliance patch intentionally requires the current `#game-over-overlay` template and fails older packages instead of publishing an incomplete result page. iOS output currently keeps the previous Google conversion behavior and does not receive an Android store badge.

Batch conversion processes every input and writes a summary, but exits with failure when any package fails so partial output cannot be mistaken for a complete delivery. Each ZIP still requires upload validation in the Google Ads preview/backend.

Run the Google pipeline regression suite after changing its conversion or validation behavior:

```powershell
node tests\test-google-conversion-pipeline.js
```

## AppLovin to Mintegral

Use the integrated Mintegral entrypoint for a validator-shaped ZIP package:

```powershell
node scripts\convert-applovin-to-mintegral.js `
  --input "..\BusLoopPlayable_2.0\artifacts\applovin\index.html" `
  --output-dir "mintegral\Bus Fever - Car Jam Escape Playable_mintegral" `
  --orientation portrait
```

The command runs the upstream mechanical conversion, replaces the MRAID-only CTA with the official guarded expression `window.install && window.install();`, removes forbidden module syntax, adds a `structuredClone` compatibility shim, moves the inline gameplay script after the DOM, and injects the official guarded lifecycle calls (`gameReady`, `gameEnd`, `gameRetry`) plus exposed `gameStart`/`gameClose` methods. Direct or bare `install()` calls are normalized without double-wrapping an existing guard. Mintegral's successful-operation install gate is adapted to show the built-in result card first and promote its ready state immediately; its mid-game card has no failure title, while actual loss still keeps the source failure title. It then rebuilds `mintegral.zip`. The ZIP contains exactly `mintegral/mintegral.html` so the root directory and main HTML match the ZIP name; remaining external references are reported for manual Mintegral preview validation.

Run the Mintegral regression checks after changing this pipeline:

```powershell
node tests\test-mintegral-conversion-pipeline.js
```
