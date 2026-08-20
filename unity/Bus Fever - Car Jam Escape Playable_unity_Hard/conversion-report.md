# Playable Ad Format Conversion Report

- Source platform: `applovin`
- Target platform: `unity`
- Input: `applovin\Bus Fever - Car Jam Escape Playable_applovin_Hard.html`
- Output package: `D:\WorkPlace\Playable\Convert-playable\unity\Bus Fever - Car Jam Escape Playable_unity_Hard\index.html`
- Package type: single HTML
- Package size: `3298594` bytes
- File count: `1`
- CTA bridge detected: `mraid.open()`
- Unity startup gate: waits for `mraid.ready` and `viewableChange=true`

## Runtime Patch

- Unity CTA uses the required no-argument call: `window.mraid.open()`.
- Kept the CTA code otherwise aligned with the original AppLovin playable to minimize runtime risk.

## External References

- No external asset references detected.
- Store URLs remain only inside the CTA configuration:
  - `https://play.google.com/store/apps/details?id=gridplus.busjam.carpuzzle`
  - `https://apps.apple.com/app/id6746743297`
- `http://www.w3.org/1999/xhtml` appears as a namespace string, not a network request.

## Warnings

- Validate the patched output in Unity Ads preview or the official backend before production approval.

<!-- unity-runtime-hardening-v2 -->
## Unity Runtime Hardening (2026-07-30)

- Explicit MRAID declaration: `<script src="mraid.js"></script>`
- CTA bridge: one click-only, no-argument `mraid.open()` call (per project requirement)
- Startup: waits for MRAID ready and persistent `viewableChange=true`, then two painted animation frames
- Background lifecycle: pauses/resumes animation frames, WebAudio, timers, and transient input
- Loading: DOM precedes payload; staged progress; fade only after ready success and first rendered frame
- Failure behavior: loading UI remains visible as an error screen
- Package size: 3,241,024 bytes
