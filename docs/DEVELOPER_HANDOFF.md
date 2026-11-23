# SignRelay developer handoff

Use `main` for new work once the Engine V3.1 integration has merged. Record `git rev-parse HEAD` alongside any test results so they can be reproduced. [Engine V3 research history](https://github.com/adamjamiesimson/SignRelay/pull/65) · [Original application repairs](https://github.com/adamjamiesimson/SignRelay/pull/66)

## First checkout

Install Git, Node.js 22.13.0 or later with npm, and a current desktop Chrome or Chromium. CI uses Node.js 22.13.0. Python and ffmpeg are only required for research replay or training. A clean development setup needs an internet connection for npm and the pinned public MediaPipe and Slovo model assets. The application needs no credentials or personal sign templates for basic startup.

```bash
git clone https://github.com/adamjamiesimson/SignRelay.git
cd SignRelay
git switch main
git rev-parse HEAD
npm ci
npm run install:vision-assets
npm run install:rsl-model
npm run dev -- --hostname 127.0.0.1
```

Open `http://127.0.0.1:3000` in Chrome, select American Sign Language and start the camera. The loopback origin gives the browser a secure context for camera permissions. The Slovo install enables the Russian workspace and is optional while working only on ASL. The full Firebase build installs and verifies Slovo automatically. The media installer checks the exact task model sizes and hashes before reusing cached or newly downloaded files.

Leave the variables in [.env.example](../.env.example) unset for local development. Its analytics ID is optional and public. Firebase deployment credentials belong in the authorized operator session or configured release workflow.

## Models and verification

The V3.1 ONNX checkpoint, metadata, strict and balanced rejection presets, and attribution are checked into `public/models/asl-v31/`. The checkout supplies the exact frozen files directly. The expected ONNX SHA-256 is `b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090`. Build verification cross-checks the checkpoint and its companion files against the pins in `lib/asl-v31-assets.mjs`. [Attribution](../public/models/asl-v31/ATTRIBUTION.md) · [Model report](../engine-v3/REPORT-V3.1.md)

```bash
npm run typecheck
npm test
npm run lint
npm run repo:guard
npm run build:firebase
npm run audit:security
npm run verify:runtime -- --out out --profile full
npm start -- --host 127.0.0.1
```

The `out/runtime-manifest.json` records the application revision, source cleanliness, selected engine and policy, and SHA-256 fingerprints of the shipped assets. The full export contains all existing language workspaces. After checking that export, prepare the ASL-only offline package in the same checkout with the following commands. Both builds write to `out/`, so stop the first server before building the second profile.

```bash
npm run demo:prepare
npm run demo:check -- /path/to/chromium
npm run demo:serve
```

Use `npm run build:rehearsal` for the labeled Engine 1 software rehearsal with synthetic landmarks. Run the real V3.1 demo with `demo:prepare`. Neither an automated rehearsal nor prerecorded replay validates physical signing.

## Code and release workflow

- `components/translator-experience.tsx` owns the translation workspace, camera session, user confirmation, transcript, and speech controls.
- `workers/asl-v3-tracker.worker.ts` tracks hands and pose for V3.1. `workers/recognition.worker.ts` coordinates classification and language-specific prediction. The pinned MediaPipe runtime lives in `lib/vision-runtime.mjs`.
- `engine-v3/` retains the originating research implementation, model training, and evaluation reports. `scripts/build-profile.mjs` produces the full, ASL demo, or rehearsal export. `scripts/verify-runtime.mjs` checks what the export ships.
- Start feature branches from the current `main`, open a PR, and link test evidence for the exact commit. Use local static exports for previews. After required checks and review, build the merged `main` for the Firebase `signrelay` Hosting site in `signrelay-76f34`. An authorized operator deploys through `scripts/deploy-firebase.sh`, verifies the served manifest, and retains the prior Hosting release for rollback.

At rehearsal, prioritize camera denial and recovery, a cold start with Wi-Fi off, lighting and framing with the actual booth camera, and left- and right-handed trials with a fluent ASL reviewer. Record false accepts, abstentions, and duplicates alongside correct suggestions. V3.1 supports isolated ASL signs and still makes mistakes with unknown or neighboring signs. Keep its model suggestions under user control when adding text or speaking. [Physical testing checklist](showcase-2026-11-26/PHYSICAL_TEST_CHECKLIST.md)
