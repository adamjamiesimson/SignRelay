# Offline ASL booth runbook

## Prepare one verified bundle

Use a clean checkout of the reviewed showcase candidate and Node 22.13 or later. Preparation needs access to the package registry and pinned MediaPipe downloads. Use a separate checkout or save the exported `out/` directory before building the full Firebase profile, which also uses `out/`.

```sh
npm ci
npm run demo:prepare
npm run demo:check -- /path/to/chromium
npm run demo:check -- /path/to/chromium --self-test
```

Keep the checkout and prepared `out/` together, including the runtime manifest. The runtime check verifies the profile, workers, vision models, WASM and ASL model assets. Confirm the manifest and worker hash correspond to the tested candidate. The ASL demo is built without analytics and non-ASL models.

## Start at the booth

1. Disconnect Wi-Fi for the final rehearsal. From the prepared checkout start `npm run demo:serve`.
2. Open `http://127.0.0.1:3000/` in the tested desktop browser on the same computer. The loopback origin permits browser camera access. Keep the server terminal open.
3. Select American Sign Language and allow the camera. Position the signer so the whole upper body and hands stay in frame. If needed, use `?perf` for asset source, frame rate, dropped frames and hand observation.
4. V3.1 Strict suggestions require the existing “Add to transcript” action before they enter text or speech. Check the word first; do not approve a wrong suggestion. Introduce SignRelay as an isolated-sign research prototype. Show one sign at a time, with a short pause, and show only signs approved in the physical rehearsal. Explain abstentions as they occur.
5. Demonstrate editing or clearing the transcript and the manual speech control. Offline speech depends on the installed operating-system voice. The transcript remains available if speech is unavailable.
6. Press Pause camera, check the indicator clears, and clear the active transcript before the next participant. Restarting the local server and browser uses the prepared files on disk.

If a camera attempt fails, confirm browser and operating-system permissions and retry once. If tracking remains poor, stop live signing and demonstrate the transcript workflow or use a clearly identified, authorized development recording with its measured outcome. A browser fake camera is a software check. Keep any private evaluation material local and access-controlled.

See [TEST_RESULTS.md](TEST_RESULTS.md) for executed offline checks and [PHYSICAL_TEST_CHECKLIST.md](PHYSICAL_TEST_CHECKLIST.md) for the device rehearsal.

## Downloadable verified bundle

The Offline ASL Demo and Rehearsal workflow publishes `signrelay-v31-offline-<commit>` only after its checks pass. Download it from the matching [GitHub Actions run](https://github.com/adamjamiesimson/SignRelay/actions/workflows/asl-demo.yml), extract it, and from the extracted root run:

```sh
node scripts/serve-export.mjs --host 127.0.0.1 --port 3000
```

The artifact contains `out/`, the standalone server, its security-policy module and vision-runtime constants. It requires Node 22.13+ but no npm dependencies or network after extraction. The runtime manifest must identify `engine-v3.1`, `strict`, and model SHA-256 `b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090`. Do not substitute the old Engine 1 cloud archive from PR #66.

The website on Firebase is not automatically an offline installation. Use the prepared loopback bundle, grant camera permissions in that local context, and rehearse a browser/server restart with Wi-Fi off. Browser/OS speech may still need a preinstalled local voice; headless checks do not establish audible offline speech.
