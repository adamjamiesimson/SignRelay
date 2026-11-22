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
4. Introduce SignRelay as an isolated-sign research prototype. Show one sign at a time, with a short pause, and show only signs approved in the physical rehearsal. Explain abstentions as they occur.
5. Demonstrate editing or clearing the transcript and the manual speech control. Offline speech depends on the installed operating-system voice. The transcript remains available if speech is unavailable.
6. Press Stop camera, check the indicator clears, and clear the active transcript before the next participant. Restarting the local server and browser uses the prepared files on disk.

If a camera attempt fails, confirm browser and operating-system permissions and retry once. If tracking remains poor, stop live signing and demonstrate the transcript workflow or use a clearly identified, authorized development recording with its measured outcome. A browser fake camera is a software check. Keep any private evaluation material local and access-controlled.

See [TEST_RESULTS.md](TEST_RESULTS.md) for executed offline checks and [PHYSICAL_TEST_CHECKLIST.md](PHYSICAL_TEST_CHECKLIST.md) for the device rehearsal.

## Prepared cloud artifact

The prepared archive is `/workspace/shared/signrelay-asl-demo.tar.gz`, with SHA-256 `50a48d6e24b2de0c6d1e7e8458a932f6a69244ea93dfe58f9a0b5ee4150067b5`. It includes the verified ASL export and a standalone loopback server. After extraction on a prepared Node 22.13+ host, the operator can run `node scripts/serve-export.mjs --host 127.0.0.1 --port 3000` from the extracted directory. Its START.txt supplies these instructions. The archive contains the tested worker and no participant footage. Camera hardware and offline operating-system speech still require the physical checklist.
