# SignRelay engineering follow-up

The initial draft head was `c0828de835906dd21419dc23a4973699c916ddd7`, with tree `3d8d0404999f5b586c95a99cb0375b1fbca0cf70`. It matches the reviewed local tree at `2ddbea54f907625771dda6690f8905a26a92de6a` and has PR #59's `2142d22ba150fdfd12de3997550ad846ed7af616` as its parent. Use the draft's Checks tab for the current head and hosted results. [Draft PR #60](https://github.com/adamjamiesimson/SignRelay/pull/60/checks)

## Offline ASL startup

Three fresh Chrome profiles per configuration on the same Windows host. Each profile also ran one restart. The timer runs from the Start click to camera Active. Loopback serves pinned assets and the camera is synthetic.

| Configuration | Cold starts (ms) | Median cold | Restarts (ms) | Median restart |
| --- | --- | --- | --- | --- |
| Original GPU-first with CPU retry | 8,659 / 8,479 / 8,236 | 8,479 ms | 7,653 / 8,310 / 6,914 | 7,653 ms |
| Offline demo CPU-first | 1,830 / 1,541 / 1,627 | 1,627 ms | 1,664 / 1,529 / 1,517 | 1,529 ms |

In the original runs, the GPU worker initialized the models and then hit the four-second inference warmup watchdog. The recovery path repeated initialization on CPU. A WebGL capability probe reported hardware acceleration and still admitted the failing path. The offline demo now selects CPU on the first attempt. The production and rehearsal profiles retain their existing delegate policy.

One separately instrumented candidate pair measured 1,422 ms cold and 1,582 ms on restart. Start to worker initialization took 302/71 ms, the runtime import 6/3 ms, and resolving the WASM fileset about 0.7/0.4 ms. The three overlapping WASM instantiations took 200–356/222–360 ms. Parallel face, pose and gesture task creation took 543–672/602–804 ms, including retrieval and graph/model setup. Warmup took 399/674 ms and the UI showed Active 2–4 ms after readiness. In an uninstrumented run the three WASM responses took approximately 218–262 ms and model responses 54–224 ms. The loopback server revalidated the assets on restart. These timings overlap, and MediaPipe does not expose a separate native model-compilation or cache-initialization span.

The CDN-blocked smoke previously recorded candidate starts of 1,829, 1,310 and 1,616 ms, with camera release after pause. The 15,000 ms cap remains in place. The synthetic stream forwarded 7–10 frames per second in those runs. This measures the offline asset path, not tracking throughput on a phone or accuracy on a signer.

## Rehearsal and recognition scheduling

The first four-of-six run missed THANK YOU and SORRY. A repeat missed THANK YOU and PLEASE. In three traced baseline runs at page CPU throttle 1×, 4× and 1×, the first and last runs recognized all six. The 4× run missed THANK YOU. Near the end of HELLO, an in-flight acknowledgement took 312–530 ms. The one-in-flight/one-latest mailbox resumed as late as slot 9 of THANK YOU. The failed replay yielded zero starter candidates for that word, versus two in successful replays. Received frames had normal classifier p95 of 1–2 ms. This evidence identifies a delivery gap around THANK YOU's onset. The changing second miss could not be attributed to a stable per-word model, landmark or arbitration fault. The synthetic rehearsal bypasses camera landmark extraction.

The ASL-2000 graph had yield checkpoints only after whole layers. It now checks the existing 12 ms cooperative budget between node rows. Arithmetic order, motion segmentation, handshape criteria, confidence and margin, bounded queues and transcript policies are unchanged. The rebuilt worker returned all six at 1×, 4× and 1× in the same trace procedure. In the 4× run, the longest acknowledgement fell from 530 to 394 ms, the first observed THANK YOU hand frame advanced from slot 9 to slot 6, and starter evidence rose from zero to two. The long acknowledgement remains and these six runs do not establish its full cause or a recognition rate. A real-worker cancellation probe passed page and timer cancellation with the change.

## Tracking experiments

FSboard v13 test metadata and all 13 pinned RGB clips were retrieved and verified against the existing manifest. The decoder needed FFmpeg's supported `-fps_mode passthrough` flag. This retains frame timestamps and lets the same preparation work with FFmpeg 9. The clips and decoded frames remain local. [FSboard](https://www.kaggle.com/datasets/googleai/fsboard)

The latest 13 paired runs replayed real RGB through the combined CPU worker with and without a 480 px cap on the transferred bitmap. Both modes used the same timestamps and motion reference. Draw age is from the scheduled replay capture to the overlay draw, with a separate next-animation-frame proxy.

| Metric | Combined | Combined with resize |
| --- | ---: | ---: |
| Median per-clip overlay p95 | 143.9 ms | 152.1 ms |
| Median fast-motion overlay p95 | 143.9 ms | 155.3 ms |
| Median next-animation-frame p95 | 147.3 ms | 153.5 ms |
| Median p95 gap between results | 189.6 ms | 198.6 ms |
| Delivered / dropped frames | 570 / 1,506 | 559 / 1,517 |
| Fast slots delivered | 61 / 228 | 58 / 228 |
| Unsupported starter candidates | 4 | 5 |

The resized path cost more overlay time and skipped more fast slots. The earlier 26-pair split-worker run delivered 1,937 vs 1,527 frames, with fast-motion overlay p95 of 121.0 vs 123.0 ms, but had 126 frames without fresh auxiliary cues and raised overall draw p95 from 119.9 to 124.0 ms. The combined capture and inference schedule stays in use. These exposed fingerspelling clips evaluate scheduling and tracking. They provide no accuracy estimate for target signs, sensor-to-screen latency or physical-device performance. [Earlier paired run](https://github.com/adamjamiesimson/SignRelay/actions/runs/42199749969)

## Storage and release review

- A tab could receive its own post-commit invalidation through its separate BroadcastChannel listener. When a list read failed, that refresh could supersede the successful-save feedback. The notification now carries an opaque page origin, and the tab ignores its own broadcast. Legacy invalidation and storage-event fallback remain available. A browser fault test verifies the committed record and one direct refresh. The two-tab deletion check verifies invalidation still crosses tabs.
- A synchronous IndexedDB list error could leave its opened database handle behind. The read now closes the handle through a `finally` block, with a regression test that injects the synchronous failure.
- The follow-up retains the existing template format and uses the same pinned assets and recognition weights. The scope review checked the caller paths, generated bundle, cancellation, preview and private export boundaries. See the [original audit](README.md) for language, camera recovery, consent, mobile-width layout and release safeguards exercised during the first pass.

The full local Vitest run passed 1,242 tests with 7 skipped. TypeScript passed, and lint reported one existing unused-import warning. The updated Chromium transcript and accessibility suite passed all 12 checks. The rehearsal fault and cross-tab suites passed with the storage fix.

Initial hosted Core CI, Analytics Consent, Release artifact matrix and Firebase Static Build Check passed. Offline ASL Demo and Rehearsal exposed the same-tab feedback fault. The ASL Video Pilot could not retrieve the publisher asset because its certificate chain terminated at a distrusted emSign root. Its downloader stopped before replay. [Initial checks](https://github.com/adamjamiesimson/SignRelay/commit/c0828de835906dd21419dc23a4973699c916ddd7/checks)

Use the protected loopback export with synthetic inputs for the engineering dry run after its applicable checks pass. A phone on the LAN requires the documented trusted TLS procedure. Measure cold and sustained tracking on actual target devices before scheduling a supervised alpha. Independent consented signers, sustained memory and thermal evidence, and measured camera/display delay are still needed. [Protected test protocol](../evaluation/signer-study/PROTOCOL.md)
