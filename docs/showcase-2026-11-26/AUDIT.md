# SignRelay showcase audit

> **Version scope:** the body below preserves PR #66's Engine 1 repair evidence. The current V3.1 integration, production UI reference, verification and publication status are recorded in [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md). Recognition results from different engines must not be combined.

The starting revision was `e63fffe64e6cc7136cf5191bd3beb07058c24200` on `main`. The public Firebase URL returned HTTP 200 over HTTPS at kickoff. That check established reachability. Release evidence for the candidate is in [TEST_RESULTS.md](TEST_RESULTS.md).

## Application and runtime

- Next.js exports static React pages. The landing, language picker, and translator live in `app/page.tsx`, `components/figma-make-landing.tsx`, and `components/translator-experience.tsx`. The translator owns camera permissions, sessions, a thread of transcript entries, and browser speech. The two RGB clip-mode components own their capture and inference sessions independently.
- The shared frame loop uses decoded video frames where supported. The front camera preview is mirrored for display while the detector sees the source pixels. `lib/vision-engine.ts` runs pinned CPU MediaPipe gesture, face and pose tasks and compresses the landmarks. The worker maintains ordered frames, checks motion and quality, routes model and personal candidates, and applies consensus and repeat suppression. The template worker isolates heavier DTW work. RSL and Bangla have separate ONNX workers.
- ASL's six-sign starter is a set of landmark and motion rules. Its candidates still depend on real observations. ASL-2000 uses the installed WLASL Pose-TGCN checkpoint through a JavaScript runtime. Its MediaPipe hand adapter on baseline filters zero-valued visibility even when the hand task supplies valid coordinates and fills the temporal window differently from training. A low-precision research-model proposal can reach the original confirmation path.
- Camera ownership crosses asynchronous permission, task initialization, animation scheduling, and worker result boundaries. Delayed grants, script-ended tracks, navigation cache restores, hidden-page interruptions, and partial tracking failures need explicit lifecycle checks. These faults can leave stale capture data or pending results attached to a new observation period.
- Transcript preferences, confirmed words and personal examples rely on browser storage. The baseline has a preference hydration/write race, stale transcript state during worker callbacks and edits, and a speech cancellation path that cuts off rapid consecutive automatic words. Storage denial and cleanup must remain visible to the user.

## Language modes at the starting revision

| Workspace | Installed recognition | Evidence limits |
| --- | --- | --- |
| ASL | Six-sign starter, WLASL ASL-2000 research model, personal matching | Small development replay and separate research benchmarks |
| BSL | 1,064-class BSL-1K Pose2Sign ONNX, personal matching | Installed model and engineering tests |
| ISL | 263-class INCLUDE ONNX, personal matching | Installed model and engineering tests |
| LSE | 300-class SWL-LSE health-domain ONNX, personal matching | Released dataset split evaluation. Live adapter accuracy pending |
| RSL | 1,000-class Slovo RGB ONNX, explicit capture | Large first model load and slow CPU/WASM inference. Independent live validation pending |
| Bangla | 401-class BdSLW401 VideoMAE ONNX, explicit capture | Large first model load and slow CPU/WASM inference. Independent live validation pending |
| PSL | 775 HFAD single-reference DTW classes, personal matching | Reference coverage and engineering checks. Accuracy study pending |
| Auslan and 32 additional workspaces | Personal examples within the language, with vocabulary prompts | User teaching required |

The full profile retains the 40 language workspaces. The installed model assets, class maps, and attribution live under `public/models/`. RSL's checkpoint is fetched on build and verified before publication. Tests and public copy should describe isolated sign recognition. Fluent sentence translation has no validated implementation in this build.

## Evaluation and training

The October dashboard recorded five correct, zero wrong accepted and six abstentions on 11 previously inspected PopSign recordings. SORRY has zero trials. Both no-sign and unsupported-sign sets have zero trials in that report. Low hand visibility, lost tracking across the stroke, and short usable trajectories constrain the observations. The public repository includes locked manifest metadata, pinned model contracts, aggregate ledgers, and a real RGB replay harness. Its private capture paths and reserved final holdout remain out of iteration. [October dashboard](../evaluation/dashboard-2026-10-21.md) · [Observation triage](../evaluation/asl-observation-triage-2026-10-20.md)

The `training/` tree includes dataset acquisition and landmark extraction, WLASL and SWL-LSE training/evaluation, independent BSL and INCLUDE export scripts, and Bangla ONNX export, weight-only quantization and browser preprocessing verification. Benchmark results depend on each checkpoint's source representation, dataset split and label map. The immediate repair targets observable runtime faults and keeps the shipped checkpoint weights.

## Release and security

Firebase serves only `out/`. The static export adds script hashes to its CSP, excludes the private capture route, and verifies model and runtime assets. Firebase applies camera-origin scoping and blocks microphone, geolocation, embedding and object content. The offline profile adds a loopback-only server and a browser test that blocks outbound traffic and watches worker requests. The full profile can load optional analytics only through its consent and build configuration. [Security policy](../../SECURITY.md) · [October demo handoff](../gitex/sprint-3/integration-report.md)

GitHub has distinct Core CI, Firebase build, ASL demo, private field-test, replay and research/model workflows. At kickoff, issue [#32](https://github.com/adamjamiesimson/SignRelay/issues/32) captured the public-demo acceptance gates. Open PRs [#39–#61](https://github.com/adamjamiesimson/SignRelay/pulls) include stacked experimental fixes. [#61](https://github.com/adamjamiesimson/SignRelay/pull/61) contains directly relevant ASL adapter and motion evidence. [#62](https://github.com/adamjamiesimson/SignRelay/pull/62) and [#63](https://github.com/adamjamiesimson/SignRelay/pull/63) concern a separate V2 research engine, [#64](https://github.com/adamjamiesimson/SignRelay/pull/64) changes public navigation scope, and [#65](https://github.com/adamjamiesimson/SignRelay/pull/65) concerns the standalone V3 research lab. The candidate stays based on `main` and selectively integrates fixes it can evaluate in the approved product UI.

GitHub reports `main` as unprotected. Open issues also cover required checks, legacy large ONNX assets, a signer-independent camera benchmark, and the repository's public research description. At the starting SHA, hosted Core CI failed the dependency gate and Firebase Static Build Check failed the build. The offline ASL workflow passed on that SHA. Local `npm audit` independently returned 11 affected packages, one high and ten moderate. The first local baseline Next build blocked on its security gate. [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/40077773104) · [Firebase check](https://github.com/adamjamiesimson/SignRelay/actions/runs/40077773068) · [ASL workflow](https://github.com/adamjamiesimson/SignRelay/actions/runs/40077773198)

The installed ASL-2000 dataset card limits the checkpoint to academic and computational use. The showcase and its documentation keep it within the research scope and retain its attribution. [ASL-2000 dataset card](../../public/models/asl2000-tgcn/dataset-card.md)
