# Current Engine V3.1 integration

This report supersedes the Engine 1 release summary in PR #66. The earlier audit and raw evidence remain available for provenance. The new task explicitly authorizes publication, merge after passing repository requirements, and deployment of the merged main revision to Firebase. Publication and deployment must be reported separately from software verification.

## Sources preserved and reconciled

- Starting main: `e63fffe64e6cc7136cf5191bd3beb07058c24200`.
- Application repairs: PR #66, `9127ab45f62255a89918b3806ae736b077261ee8`.
- Engine 3/V3.1 research: PR #65, `ea4e5432df811fcfb91db926b741d21b12222098`. The complete `engine-v3/` research source and frozen model/policy files are retained. Engine 2 is a separate five-word experiment and is not the selected engine.
- Live production was the green interface headed “Every sign deserves to be understood.” Its source matches the pre-Figma interface at `ca7d8b6`. Main and the draft branches contained a different cyan interface. With no newer approval supplied, the deployed green interface is the visual reference. Local changes and untracked work in all discovered checkouts were inventoried and backed up before integration; the originating worktrees were preserved.
- V3.1 model SHA-256: `b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090`. Strict policy SHA-256: `751fd950bde3ab3166653bb1dd4884a155fd831bb92bc4a7a16a6691c5fb48e0`.

## Implemented application behavior

The normal ASL workspace uses V3.1 Strict, with matching 523-label metadata, exact preprocessing, model weights and rejection policy. A dedicated tracking worker runs pinned hand and pose detection and supplies the existing face/overlay/calibration cues. There is one camera owner and one ASL tracking loop. Non-ASL workspaces retain their language-specific pipelines. The historical Engine 1 synthetic rehearsal remains explicitly separate.

The recognition worker buffers and segments real observations, serializes model work, bounds queued work, discards stale session results and handles reset, cancellation and retry. Policy-accepted ASL model outputs are labeled tentative suggestions. The operator must choose “Add to transcript” before one becomes editable confirmed text or can be spoken. Personal-template matching retains its distinct source and existing controls. This is isolated-sign research recognition, not continuous sentence translation.

PR #66 camera cleanup, transcript isolation, persistence/error handling, speech queue, storage recovery and dependency/security fixes are retained. The live production landing page, navigation, fonts, CSS, artwork, responsive layout and workspace styling are restored. New review/error messaging uses existing controls and styles.

A verified startup defect was repaired: benchmarking GPU delegates through SwiftShader stalled camera startup for tens of seconds. Worker-side renderer detection now skips software GPU benchmarking and uses CPU; hardware GPU choices still use bounded comparative probing. On this host, cold fake-camera startup improved from 19,854 ms to 2,004 ms in the lifecycle check. This is software-startup evidence, not a physical-device benchmark.

## Recognition evidence

[ENGINE_COMPARISON.md](ENGINE_COMPARISON.md) records the frozen inputs, revisions, hashes, preset thresholds, results and limitations. On the same 17-interval shared-vocabulary camera reel, Engine 1 automatically confirmed 1 correct sign and abstained on 16; V3.1 Strict in the integrated app produced 10 correct suggestions and 7 abstentions. Neither path accepted a wrong word in this run. Balanced in the reference lab accepted a wrong HELLO as GIVE-ME-FIVE. No reserved final holdout was accessed.

The small replay and historical broader evidence support V3.1 Strict as the best-supported research default. Unknown-sign false acceptances remain a significant limitation; manual review is mandatory. These prerecorded, publisher-labeled browser trials are not independent live-signing accuracy claims. SORRY is absent from the frozen V3.1 vocabulary.

The additional 12-sign browser reel gave integrated Strict 2 correct, 2 wrong and 8 abstentions, with all four unsupported clips rejected. The wrong proposals were EAT → FOOD and GOOD → THANK-YOU. This confirms weak broader camera coverage and supports retaining manual review and a narrow physically accepted booth script.

## Verification ledger

All local measurements use Node 24.22.3 and Chromium 156.0.8078.79 on Linux. Fake cameras check software lifecycle; controlled tensors check real model execution. Neither supplies human accuracy evidence.

| Integrated check | Actual observed result |
| --- | --- |
| Full Firebase export | Passed Next compile, TypeScript, static export and runtime integrity; model and strict policy fingerprints verified; private capture and rehearsal hook absent |
| Shared real-video replay | 10 correct suggestions, 0 wrong, 7 abstentions / 17 intervals; 0 gray-gap accepts, 0 duplicate accepts, no runtime errors, tracks stopped; no unreviewed transcript or speech |
| Workspace regression | Passed controlled-worker transcript/session isolation, storage failures, persistence, speech queuing, manual-review gate, duplicate review click and stale-suggestion rejection |
| Camera lifecycle | Passed 12 start/pause cycles, 6 rapid toggles, hidden-tab/calibration recovery, processing failure, tracking-worker crash/retry, ended track, 3 leave/re-enter cycles, pagehide and 60-second continuous fake-camera session |
| Lifecycle measurements | 2,004 ms cold start; CPU; restart median 1,455 ms; 608 forwarded frames during the 60-second sustained portion; heap samples 5 to 6 MB after collection; no uncaught errors |
| Fault injection | Passed recognition-worker crash budget/manual recovery, failed worker construction, actual missing/corrupt hand task network responses, camera release/retry and disabled storage |
| UI comparison | All four full-page PNGs matched live production bytes exactly: desktop 1280×900 and mobile 390×844, landing and camera-permission workspace. The initial status-string mismatch was repaired by restoring approved copy |

Unit/regression suite: **937 passed, 1 optional experiment skipped across 93 files**. Typecheck, lint, asset guard and dependency audit passed with zero vulnerabilities. The full fetched-history and working-tree secret scan covered 1,011 commits and 3,474 historical text blobs with zero findings.

Additional checks passed: real V3.1 browser ONNX execution through a deny-all proxy; shared model cancellation/cached reuse; Russian, Bangla and Spanish fake-camera/model smokes; two rendered-page tests; axe WCAG checks on five public pages and the workspace (zero violations); the six-sign **Engine 1 synthetic** rehearsal; transcript keyboard, screen-reader announcement, touch target and reduced-motion regressions; strict V3.1 offline startup and uncached restart with 149 observed page/worker requests and zero non-loopback requests; and planted page/worker leak detection. Speech checks observe queue calls, not audible device speech.

A separate GitHub clone at `779fdfb` passed npm install from the lockfile, both pinned asset installers, typecheck, full production build and ordinary development startup. Its actual V3.1 tracking worker initialized in Chromium with browser-provided fake media and no uncaught errors. The cloud proxy required the environment-specific `NODE_USE_ENV_PROXY=1` setting for asset downloads; no private files were copied into that checkout. [Executed evidence](evidence/integration/).

Hosted checks initially caught stale assertions from the cyan UI and one misplaced test-only status assertion after page navigation. The production UI was kept intact and those assertions repaired; all affected checks must pass on the final source before merge. A ten-minute continuous cloud lifecycle trial is running separately. An unexecuted or failed check is not a pass.

## Publication and deployment status

Published integration: [PR #67](https://github.com/adamjamiesimson/SignRelay/pull/67), branch `integrate/asl-v31-event-2026-11-25`, initial source commit `779fdfb`. Main and Firebase production have not yet been updated at this report checkpoint. Firebase CLI has no authorized account in the cloud environment; the no-localhost phone authentication flow was offered while independent engineering continued. No credential, token or browser profile is committed. Production deployment requires that missing authorization or a verified existing deployment credential path. A local build is not a production deployment.

## Human acceptance still required

Use [PHYSICAL_TEST_CHECKLIST.md](PHYSICAL_TEST_CHECKLIST.md) on the booth laptop/camera and real iOS/Android devices. Adam and Ankush must verify fresh signing, left/right hands, variants, normal movement/unknown rejection, deliberate repeats, lighting, at least ten minutes of sustained use, physical permission recovery, actual speaker/voice behavior and a cold offline restart. Select a small booth vocabulary only after independent fluent review. The software is a supervised research candidate; physical/public live-signing acceptance is pending.

Developer setup and normal workflows: [DEVELOPER_HANDOFF.md](../DEVELOPER_HANDOFF.md).
