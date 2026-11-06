# SignRelay stability and tracking sprint

Base [PR #57](https://github.com/adamjamiesimson/SignRelay/pull/57), exact Git head `6f5592b2094e18ce598f519ad6bfd1b96deaf684`, tree `5b5c08c13f2e305a430a0ddc65cd12c76ae3d365`. The local checkout began clean. The sprint branch targets `codex/engineering-excellence-sprint`.

## 1. Executive summary

Camera capture now releases the tracker when a browser bitmap conversion hangs, including when decoded video continues to advance. Recognition keeps its one-frame mailbox bound across rapid resets and coalesces template transfers before acknowledging the latest frame. Personal-vocabulary deletion fences old results and delayed save readbacks. Canvas work skips repeated empty clears and reuses the connection map while preserving the overlay geometry and approved design.

## 2. Bug register

| ID and severity | Reproduction and root cause | Fix and regression |
| --- | --- | --- |
| CAM-01 High | Hold `createImageBitmap(video)` open while video time advances. The vision lane remains occupied indefinitely because the inference watchdog starts after conversion and the video clock still looks healthy. | Bound conversion to ten seconds and stop the session on expiry. Close any late bitmap. Stop settles immediately even when the browser conversion cannot be cancelled. `live-vision.test.ts` and the full-export `fault-injection-smoke.mjs` exercise the held conversion. |
| REC-01 High | Keep an old frame outstanding and alternate 100 resets and reconfigurations with frame offers. Each baseline reset drops the local in-flight marker while the worker still has the frame, creating a mailbox backlog and repacking templates. | Retain the acknowledgement slot by session and frame ID. Only the latest frame and effective control are retained. The test observes two sends before the acknowledgement, including the initial configuration and original frame, instead of the 202 sends implied by baseline dispatch. Old analyses remain hidden. |
| REC-02 High | An invalid observation clock can bypass comparison and age checks. A malformed word can arrive at the page with a non-finite confidence or timestamp. | Acknowledge and clear evidence on non-finite frame time or missing landmark arrays. Reject malformed words before arbitration, transcript insertion or speech. Regression tests include `NaN`, infinities, and out-of-range confidence. |
| STORE-01 High | Clear or delete examples while a saved-sign result is pending or a previous save is re-reading IndexedDB. The worker can confirm with deleted templates and a stale readback can restore the old in-memory list. | Fence old save readbacks by revision, invalidate recognition at deletion start, suppress personal output during deletion and publish the committed result to the worker before allowing it again. Preserve IndexedDB v1, legacy templates and `trajectory-v3`. The browser suggestion suite holds the database open callback and injects a personal confirmation during deletion. |
| DRAW-01 Medium | The Canvas hot path creates a connection array per hand, reads Canvas dimensions for each point and clears every empty frame. | Reuse the connection map and per-frame dimensions, skip already empty overlays, and omit non-finite coordinates. Preserve the original per-stroke composition, colours and geometry. The paired renderer benchmark compares the actual original drawing block with the current renderer. |

## 3. Architecture and tracking performance

`TranslatorExperience` owns permission, decoded `<video>`, sampling, bitmap pickup and Canvas painting on the main thread. `LiveVision` runs bounded capture, transfers a bitmap to the classic vision worker, and owns cancellation and fallback. `VisionEngine` runs the pinned MediaPipe WASM gesture, face and pose tasks on GPU when available, otherwise CPU. It posts the hands before auxiliary inference returns, but the next bitmap still waits for the worker's combined result. Main-thread CPU fallback finishes all parts before the browser can paint. In word mode the pickup timestamp is monotonic page time. The optional capture-time experiment uses decoded-frame metadata. Research fingerspelling has a separate one-hand tracker and CTC worker.

The recognition session forwards landmarks to a module worker with one outstanding and one replaceable observation. Starter logic and learned-model arbitration run there. Dedicated matching workers handle personal and PSL templates. Language-specific model adapters prepare ONNX inputs and maintain runtime sessions. RSL and Bangla use separate bounded RGB clip workspaces. A result passes provenance and session checks before the page offers it or inserts an eligible personal word. Speech follows the existing settings and acceptance rules.

### Matched overlay experiment

Headless Chrome on Windows, Intel Core i7-10510U, 1280×720 Canvas 2D, two synthetic moving hands plus face and pose. Six alternating pairs, 144 batches per version, twelve draws per batch. Values are per-draw averages within a batch, in milliseconds. This measures Canvas command submission and excludes camera, MediaPipe and compositor presentation.

| Renderer trial | Baseline median / p95 / p99 | Candidate median / p95 / p99 |
| --- | ---: | ---: |
| Batched paths, rejected | 0.058 / 0.092 / 0.217 | 0.083 / 0.150 / 0.242 |
| Retained renderer | 0.050 / 0.067 / 0.083 | 0.042 / 0.067 / 0.075 |

The retained renderer removes allocations and unnecessary empty draws. The timing difference is small and does not explain visible camera lag. The earlier [licensed-RGB tracking profile](https://github.com/adamjamiesimson/SignRelay/actions/runs/41595982233) measured 51.4 ms median for hand inference and 91.3 ms p95 for the combined CPU frame. Alternating face and pose improved total p95 to 75.7 ms but made body cues older and changed three of 346 starter outputs. This branch keeps the proven two-hand tracker and original auxiliary schedule. The built-in I LOVE YOU rule uses the gesture classifier, so removing it from word mode would remove a recognition signal. A parallel auxiliary worker remains unproven on low-core hardware and can increase memory and contention.

### Matched real-runtime control

The benchmark ran the pinned MediaPipe worker on the same 640×480 moving-rectangle RGB sequence, alternated PR #57 and the candidate, and recorded 24 steady-state frames per run. This input has no hands and measures browser-capture start to draw submission. Three forced-CPU pairs completed during other local test activity.

| Pair | Baseline startup, ms | Candidate startup, ms | Baseline capture-to-overlay median / p95, ms | Candidate median / p95, ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3,703 | 2,558 | 136 / 261 | 136 / 224 |
| 2 | 2,369 | 2,615 | 138 / 158 | 130 / 169 |
| 3 | 3,001 | 3,198 | 139 / 235 | 122 / 170 |

The initial baseline-only control had CPU p95 from 78 to 177 ms and one pair completed with GPU p95 from 38 to 45 ms. The candidate comparison's acceleration-requested trial first fell back to CPU (baseline/candidate p95 153/158 ms), then hit a Chrome evaluation timeout. There is insufficient candidate GPU evidence and no attributable camera-to-overlay p95 improvement. Per-run sample counts do not support p99 or a physical fast-hand tracking claim. Real tracking FPS, decoder delay, motion blur, visible freezes and auxiliary scheduling under sustained two-hand load require a matched camera or licensed RGB study.

## 4. Recognition and dynamic signs

The change prevents corrupted timing observations from linking segments across an invalid frame. No sign-rule threshold, model, label order, or signer dataset changed. The previous exposed WLASL results remain 16/27 starter positives and 30/149 negative clips triggering a starter word. Prior per-sign data, including the weak THANK YOU, SORRY and YES results, is documented in [starter reliability](../release-candidate/STARTER-RELIABILITY.md). The sprint does not reinterpret those results as independent validation. The [temporal experiment framework](../research/temporal-recognizer/DIRECTION.md) already supports signer-disjoint cohorts. A new model, improved per-sign recall, calibrated unknown-sign rejection, and two-person identity robustness require independent, permissioned samples. The new worker fingerprint explicitly invalidates historical evidence attached to the old bundle.

## 5. Multilingual, storage and reliability

The full build verifies installed assets, including the pinned Slovo model. Shared ASL, BSL, ISL, LSE and PSL pathways retain their existing adapters and matching formats. RSL and Bangla are separate RGB workers. See [PR #57's pathway audit](../engineering-sprint-2026-11-05/recognition.md) for the real model inference previously exercised. Build integrity and shared-workspace language switching are separate from rerunning each language's model on independent recordings. This sprint bounds an injected camera freeze and the recognition mailbox under rapid resets. Cross-tab vocabulary synchronization, GPU and worker heaps, multi-hour and physical-camera tests remain open.

## 6. Security and release

The existing locked dependency override and fail-closed audit remain in force. Firebase production-format builds prune private routes and research files, enforce suggestion-only output, and verify the worker fingerprint. Vercel Git deployment is disabled for this sprint branch. The research-only fingerspelling assets and test study flow remain isolated. No participant data was collected, and PopSign certificate rejection remains intact.

## 7. Reproduction

```powershell
npm ci
npm run build:worker
npm run build:firebase
node scripts/assert-public-export.mjs out
node tests/fault-injection-smoke.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tests/model-suggestion-browser-smoke.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/benchmarks/landmark-overlay.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe' 6f5592b2094e18ce598f519ad6bfd1b96deaf684 overlay.json
node scripts/benchmarks/alpha-tracking-paired.mjs 'C:\Program Files\Google\Chrome\Application\chrome.exe' 6f5592b2094e18ce598f519ad6bfd1b96deaf684 tracking.json
```

Local regression results on Node 24.22.1 and headless Chrome 156 on Windows:

- The full Firebase-format export built and verified its regenerated recognition worker. The public guard passed, both rendered HTML checks passed, and the production isolation smoke passed five assertions.
- Fault injection passed eight scenarios, including advancing video with hung bitmap conversion, frozen video, tracker and recognition crashes, missing/corrupt models, and storage errors. The suggestion suite passed 23 assertions after correcting the test's IndexedDB proxy and cache-version expectation. The workspace suite passed 12 checks, including rapid language changes and releasing old camera tracks.
- The first full Vitest run reported 1,214 passes, seven opt-in skips, a stale worker-cache-token assertion, and a Vitest fork startup timeout for the landmark lifecycle file. The assertion was updated for the new token and the isolated lifecycle retest passed 9/9. Hosted CI exercises the final tree on Linux.

## 8. Remaining validation and release recommendation

**Supervised alpha:** retain the prior protected-device and owner gates. The new regression fixes are suitable for an engineering dry run once the hosted checks pass. Record actual camera settings, GPU delegate, fast single- and two-handed movement, brief occlusion, and recovery from interruption on desktop and physical mobile. Measure camera presentation and hand overlay separately from sign-to-suggestion latency.

**Public release:** blocked pending independent signer and device evidence. Generated RGB and synthetic landmarks exercise runtime properties. They cannot establish performance on real fast hands, accuracy, false accepts in ordinary use, or readiness across browsers. No deployment was part of this sprint.
