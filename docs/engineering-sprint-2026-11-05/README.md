# SignRelay engineering sprint

## Executive report

The sprint concentrates on failures that can carry stale evidence into recognition, make a suggestion actionable after the user has moved on, keep a stopped camera open, or allow an unsafe artifact through a public build gate. The fixes address timing, attribution, and release integrity. Recognition thresholds, model weights, gloss mappings, template formats, and the visual identity are preserved. There is no new signer-accuracy estimate.

- [Recognition and personal signs](recognition.md) covers the worker, model and data evidence.
- [Tracking and performance](tracking.md) covers camera faults, instrumentation and paired timings.
- [Experience and accessibility](experience.md) covers suggestion interaction and browser validation.
- [Security and release](security-and-release.md) covers the npm advisory, the export boundary and the verification matrix.
- [Verification record](verification.md) lists the executed checks, outcomes and release recommendation.

## Verified starting point

The local tree was clean before changes. PR #56 and `claude/charming-thompson-2aql9w-alpha` both resolved to `900dca8e14ef0daa985c40729304628bde97024c`. The sprint branch is `codex/engineering-excellence-sprint` and its PR base is the alpha branch.

| Comparison | Merge base | Alpha ahead / behind | Integrated changes |
| --- | --- | ---: | ---: |
| `main` | `e63fffe64e6cc7136cf5191bd3beb07058c24200` | 241 / 0 | 680 files |
| `claude/festive-dirac-pbwx2j` | `996b0d2925e882e15ed303cd3f2b459e261be962` | 138 / 0 | 393 files |

The GitHub graph shows two early PRs targeting `main` (#43 and #44), then #45–46 stacked on #44. The alpha contains the #43 tracking head and the integration merge `79ab8c6`. The named festive-dirac branch adds ASL-2000 input/evaluation and dataset acquisition work after #46. PR #47 is based on that branch. PRs #48–52 add research fingerspelling, bounded capture, and personal matching and tracking work. PR #53 is the release branch, with the same commit as the RC branch used as #54's base. PRs #54–56 add confirmation gates, starter-rule evaluation, and the signer study. All were open at the time of inspection. The sprint used the integrated code and reports, including [Alpha readiness](../alpha/ALPHA-READINESS.md), [Signer testing](../alpha/SIGNER-TESTING-GUIDE.md), [RC qualification](../release-candidate/README.md), [Starter reliability](../release-candidate/STARTER-RELIABILITY.md), [Fingerspelling reliability](../fingerspelling/RELIABILITY-SPRINT.md), and [Temporal recognition](../research/temporal-recognizer/DIRECTION.md).

## Pipeline and ownership

| Boundary | Ownership and lifetime | Audit result |
| --- | --- | --- |
| Camera and frame pickup | The workspace owns the permission request, video tracks, visibility handling and animation loop. Camera and tracking generations fence late completion. `LiveVision` owns bitmap creation, watchdog and worker transfer. A single current bitmap can be retained for research capture. The worker closes its transferred bitmap. | Capture and recognition queues are separate. A stalled decoder could evade the camera watchdog while capture was busy. |
| MediaPipe and overlay | The vision worker warms GPU before advertising readiness and can restart on CPU, with a main-thread compatibility engine for words. Hand results reach the canvas before face/pose work finishes. | Overlay and recognition stay decoupled. Research snapshot failures and tracking interruption have separate recovery paths. |
| Observations and matching | `RecognitionSession` owns one sent frame and one replaceable queued frame. The worker owns the bounded temporal buffer and per-language inference state. The personal matcher has its own worker and compiled template representation. PSL compiles and caches reference sequences. | A session change rejects old worker messages. A gap within a session had to invalidate accumulated evidence as well. |
| Recognition to transcript | Starter and experimental model output pass through the workspace source policy and suggestion queue. The transcript accepts eligible personal output or explicit user acceptance. RSL and BdSL have separate clip-capture components. | The workspace now rejects missing or disallowed source attribution. Study measurements distinguish a wrong prediction from a wrong accepted word. |
| Research and release | Research fingerspelling has its own decoded-frame and CTC workers. Public builds compile out its workspace, prune assets and verify the static output. | Hosted preview must satisfy the public boundary because preview access is controlled outside the repo. Explicit local research builds remain available. |

## Owner testing checklist

1. Use a protected, reviewed candidate build and record its commit and runtime manifest. Run the [facilitator protocol](../evaluation/signer-study/PROTOCOL.md) before scheduling participants. Keep the dataset exposure record and seal signer-disjoint evaluation splits before reviewing data.
2. On one desktop and one physical phone, try permission denied, allow, pause, restart, tab hide and resume, device interruption, and rapid language changes. Verify that the device camera indicator turns off on pause and that an old language's suggestion never appears in the new workspace. Record browser, OS, camera resolution, orientation and whether the tracker uses CPU or GPU.
3. Run a short session with a Deaf ASL signer using the [signer guide](../alpha/SIGNER-TESTING-GUIDE.md). Include natural and varying speed, left- and right-dominant signing, occlusion, everyday gestures, and confusable signs. Record coverage, errors, abstentions, latency and corrections by prompt. Ask separately for feedback on the cards and transcript.
4. Teach an existing personal sign with several examples, reload, use it, delete one example and reload again. Check both old and new builds against a backed-up vocabulary. Verify pending cards and vocabulary disappear after local-data clearing. Check storage failure feedback separately.
5. Use keyboard-only controls, physical touch including a rapid double tap, a screen reader on desktop and phone, 200% zoom, reduced motion and landscape orientation. Confirm focus remains usable after Add and Dismiss. Listen for the distinction between possible and added words. Check intentional speech and camera permission messaging.
6. Collect local `?perf` timing samples with consent, using the same device, settings and workload for both builds. Keep samples free of video, landmarks and participant identifiers. Report each device and delegate separately. Compare the actual capture-to-overlay distribution, visible freezes and suggestion delay.

Rollback is a return to the reviewed alpha artifact for a supervised session. Keep its verified runtime manifest with the artifact. The sprint retains the IndexedDB schema and template feature versions. Re-run the owner storage and transcript checks after rollback. A public rollback would require the same public artifact gate and owner authorization.
