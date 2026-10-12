# Stage 1: browser frame identity and replay repeatability — 9 October 2026

## Scope

The production translator previously inferred "new camera frame" from `video.currentTime` during a requestAnimationFrame loop. A video stream's playback clock can advance while the same underlying image is held (particularly the synthetic canvas stream used for regression tests), producing redundant MediaPipe and recognition-worker work.

Stage 1 changes the shared real-time translator to prefer **`HTMLVideoElement.requestVideoFrameCallback`**. The callback's `presentedFrames` counter is checked by a small stateful frame gate, with a 50 ms minimum processing interval. The existing animation loop remains responsible for the 8-second stall watchdog and a best-effort `currentTime` fallback where video-frame callbacks are unavailable.

The callback subscription is canceled when the camera stops or the component unmounts; frame identity is reset for every camera restart. This change does not alter model weights, recognition threshold, language adapters or Firebase deployment.

A browser-presented frame **is not proof of a unique pixel image**. Some camera and synthetic-stream sources emit several presented frames with identical image content. This prevents double-processing one callback identity; it does not guarantee pixel-level deduplication.

## Verification

- `npm run typecheck`, unit tests including `tests/video-frame-gate.test.ts` and `tests/video-run-comparison.test.ts`, lint, worker build, secrets and repo guard: **Core CI passed**. [Core CI run #37930947504](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930947504).
- [Benchmark run #37930947424](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930947424) completed two fresh browser replays of the same eight PopSign ASL v1.0 test videos and two Wikimedia non-sign-intent controls.
- The per-clip manifest preserves expected gloss, source/video IDs and SHA-256 provenance. Raw videos are ignored locally, removed from the CI workspace after evaluation, and omitted from uploaded reports.
- The workflow-generated `repeatability.md` compares matched fixture identifiers and source provenance, reported predictions, outcomes, and recognition-worker frame counts.

### Outcome of the paired run

| Metric | Replay A | Replay B |
| --- | ---: | ---: |
| Signed clips recognized correctly | 3/8 | 3/8 |
| Wrongly classified signs | 1/8 (HELLO → THANK YOU) | 1/8 (HELLO → THANK YOU) |
| Rejected signs | 4/8 | 4/8 |
| Non-sign-intent clips rejected | 2/2 | 2/2 |
| Total frames to worker (all ten clips) | 404 | 407 |

**All ten recorded prediction/outcome pairs matched between these two runs.** Worker frame counts were *not* identical. Earlier post-fix runs also differed (including one 0/8 correct run). Two matching runs establish limited repeatability in this configuration, not deterministic inference under all loads or independently validated accuracy.

The original strict-source-video diagnostic [#37921013789](https://github.com/adamjamiesimson/SignRelay/actions/runs/37921013789) delivered **507 recognition-worker frames for eight sign clips**, with only 143 source-image advances. In the initial callback-based test [#37930287912](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930287912), only **121 worker frames across eight signs** and 147 source-image advances were observed. Example HELLO `...8037`: 70 worker frames previously versus 16 after frame gating (source advances 22 in both). These are different independent CI runs and do **not** imply a controlled speed/accuracy improvement; they do show that repeated frame processing was substantially reduced in this test.

The paired replay did process more frames than the initial callback-based test (404 and 407 across ten clips), so frame scheduling is still affected by capture/runtime timing. No perfect one-source-image/one-worker-frame guarantee is claimed.

## Open problems and next stage

1. **Recall remains inadequate.** In the latest paired run, HELLO was never correctly confirmed, YES was rejected twice, and one NO was rejected.
2. **HELLO → THANK YOU confusion persists** even on the better-hand-tracked HELLO clip. Investigate geometry and classification with verified sign examples.
3. **Hand tracking is poor in multiple PopSign recordings**, particularly NO and HELLO; examine framing/detection rates before lowering confidence thresholds.
4. **Two negative controls are far too few to estimate a general false-positive rate.** Expand controls, signs, and independent signers.
5. Browser frame identity is not pixel identity, and fixed video outcomes should be rechecked over more than two runs/devices.
6. **Firebase Static Build Check is blocked by the separately detected dependency audit**, not by these unit tests. [Build workflow](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930947374) requires vulnerability triage before deployment.

**Decision:** Keep PR #17 draft and the production site untouched. The next engineering step is to improve the recognition pipeline's hand tracking and sign discrimination, with the regression dataset frozen for before/after comparison. No new accuracy claims or threshold reductions should be made from this small benchmark alone.
