# SignRelay developer handoff

The integration is published in [PR #67](https://github.com/adamjamiesimson/SignRelay/pull/67) on `integrate/asl-v31-event-2026-11-25`. The 2026-11-23 accuracy sprint ([PR #68](https://github.com/adamjamiesimson/SignRelay/pull/68), [report](sprint-2026-11-23/SPRINT_REPORT.md)) raised V3.1 analysis cadence and made sign ends rest-aware. Use `main` for new work after that PR is merged. Record `git rev-parse HEAD` alongside any test results so they can be reproduced. [Engine V3 research history](https://github.com/adamjamiesimson/SignRelay/pull/65) · [Original application repairs](https://github.com/adamjamiesimson/SignRelay/pull/66)

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

Open `http://127.0.0.1:3000` in Chrome, select American Sign Language and start the camera. The loopback origin gives the browser a secure context for camera permissions. The Slovo install enables the Russian workspace and is optional while working only on ASL. The full Firebase build installs and verifies Slovo automatically. The cloud fresh-clone verification used Node 24.22.3; its outbound proxy required `NODE_USE_ENV_PROXY=1` for Node asset downloads. Ordinary developer networks and GitHub-hosted CI do not require that environment-specific proxy setting. The media installer checks the exact task model sizes and hashes before reusing cached or newly downloaded files.

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
- `workers/asl-v3-tracker.worker.ts` tracks hands and pose for V3.1. On machines with four or more logical cores, `lib/asl-v3-tracker.ts` starts a second instance in its `pose` role, which tracks pose in parallel on every second frame. The client merges that pose into each hand frame, and any failure falls back to in-worker pose. Face cues run at most every 400 ms and are used only for the overlay, framing and personal templates. `lib/asl-v31-segmenter.ts` ends a sign when hands are absent or rest below signing space for 500 ms. `workers/recognition.worker.ts` coordinates classification and language-specific prediction. The pinned MediaPipe runtime lives in `lib/vision-runtime.mjs`.
- `engine-v3/` retains the originating research implementation, model training, and evaluation reports. `scripts/build-profile.mjs` produces the full, ASL demo, or rehearsal export. `scripts/verify-runtime.mjs` checks what the export ships.
- Start feature branches from the current `main`, open a PR, and link test evidence for the exact commit. Use local static exports for previews. After required checks and review, build the merged `main` for the Firebase `signrelay` Hosting site in `signrelay-76f34`. An authorized operator deploys through `scripts/deploy-firebase.sh`, verifies the served manifest, and retains the prior Hosting release for rollback.

## Recognition diagnostics

V3.1 accuracy depends on analysed frames per second while hands are visible. On the booth machine, open the workspace with `?perf` and read the "Tracking p50/p95 · forwarded/s" line while signing.

- Fake-camera replay: `scripts/diagnostics/run-engine-comparison.mjs … integrated-v3`.
- Optional observation capture: set `CAPTURE_OBSERVATIONS`.
- Identical-observation comparison of segmenter, model and policy variants: `node --experimental-strip-types scripts/diagnostics/offline-v31-replay.mjs`.
- Native MediaPipe reference: `scripts/diagnostics/native-reel-observations.py` (needs `mediapipe==0.10.35`).
- Results summary: `scripts/diagnostics/summarize-replays.py`.
- Development cohort and adoption rule: [protocol](sprint-2026-11-23/PROTOCOL.md).
- Commands: [sprint report](sprint-2026-11-23/SPRINT_REPORT.md#reproduce).

The sprint's A, shared and broad reels are tuning-contaminated. Do not quote them as validation.

At rehearsal, prioritize camera denial and recovery, a cold start with Wi-Fi off, lighting and framing with the actual booth camera, and left- and right-handed trials with a fluent ASL reviewer. Record false accepts, abstentions, and duplicates alongside correct suggestions. V3.1 supports isolated ASL signs and still makes mistakes with unknown or neighboring signs. Keep its model suggestions under user control when adding text or speaking. [Physical testing checklist](showcase-2026-11-26/PHYSICAL_TEST_CHECKLIST.md)

## Verified setup checkpoint

A separate clone fetched from GitHub at `779fdfb` passed `npm ci`, both documented asset installers, typecheck, the full Firebase build and the normal `npm run dev -- --hostname 127.0.0.1 --port 18321` path. Headless Chromium initialized the real V3.1 tracking worker with its synthetic camera and reported no uncaught exceptions. No files were copied from the original checkout. The verification environment's proxy setting is described above. Later test/report-only changes do not add runtime dependencies.

Deployment uses the existing project and site, with an authorized Firebase session. A global CLI is optional:

```sh
npm exec --yes --package=firebase-tools@15.37.0 -- firebase login --no-localhost
npm exec --yes --package=firebase-tools@15.37.0 -- bash scripts/deploy-firebase.sh --deploy-only
```

The no-localhost login can be completed from a phone. Do not store its authorization code or credentials in repository files. Build from merged `main` before deploying. Record the previous Firebase release ID, deploy, then verify the live runtime manifest revision/model hash and asset caching. Missing Firebase credentials are a deployment blocker, not a reason to request access to Adam's laptop.
