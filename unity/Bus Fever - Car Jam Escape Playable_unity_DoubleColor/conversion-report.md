# Playable Ad Format Conversion Report

- Source platform: `applovin`
- Target platform: `unity`
- Input: `applovin/Bus Fever - Car Jam Escape Playable_applovin_DoubleColor.html`
- Output package: `unity/Bus Fever - Car Jam Escape Playable_unity_DoubleColor/Bus Fever - Car Jam Escape Playable_unity_DoubleColor.html`
- Package type: single HTML
- Package size after Unity hardening: `3769798` bytes
- File count: `1`
- CTA bridge detected: `mraid.open()`
- External asset/network tags: none; all gameplay assets remain inlined

## Unity Runtime Hardening

<!-- unity-runtime-hardening-v2 -->

- Explicit MRAID declaration: `<script src="mraid.js"></script>`
- CTA bridge: one click-only, no-argument `window.mraid.open()` call
- Startup: waits for MRAID ready and persistent `viewableChange=true`, then two painted animation frames
- Background lifecycle: pauses/resumes animation frames, WebAudio, timers, and transient input
- Loading: DOM precedes payload; staged progress; fade only after ready success and first rendered frame
- Failure behavior: loading UI remains visible as an error screen

## Warnings

- No blocking warnings from local conversion and static validation.
- Browser preview has no runtime errors. Existing Three.js FBX material and missing texture-image warnings remain non-blocking.
- Final acceptance still requires upload to the Unity Ads preview or validator.

## Browser Validation

- Desktop `1280x720`: canvas `1280x720`, no page overflow, rendered pixel entropy `3.788`.
- Mobile `390x844`: canvas `390x844`, no page overflow, rendered pixel entropy `6.408`.
- Animation check: `8.94%` of sampled screenshot color channels changed over one second.
- Loading overlay completed and was removed after the first rendered frame.

## Manual Validation

- Confirm CTA behavior in the real Unity Ads environment.
- Confirm audio starts only after user gesture and pauses on background/close.
- Confirm portrait/landscape behavior, loading, end state, replay, and close behavior.
