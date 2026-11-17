# SignRelay recognition sprint 2

**EXPERIMENTAL ONLY.** The candidate improved specific outcomes on exposed recordings and synthetic controls. Independent signer and webcam results are still needed for a release decision. The original local video gate still rejects a THANK YOU → PLEASE insertion that also occurs with the byte-identical PR #61 worker on this Windows setup.

## Starting point and recovered evidence

The sprint branches from draft #61 at `28a3a3bc9e872ff947f7238556b843a12f3ac25a`. The rebuilt baseline worker SHA-256 is `a5f6d0ef2eb27e469aa2d1069038c2184471e842e6f7f4bb2af242dc7814471a`. The final candidate worker SHA-256 is `485cc3c650ab78bbdeb9e80e471cc3cc9a86e4e62921764b182164c06cadca9f`. Five hosted workflows passed for the PR #61 head, including the exact-baseline video pilot and Firebase static build check. [Draft #61](https://github.com/adamjamiesimson/SignRelay/pull/61) · [Baseline video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/43916731802) · [Baseline static check](https://github.com/adamjamiesimson/SignRelay/actions/runs/43916731561)

| Development evidence | Correct | Wrong | Abstained | Detail |
| --- | ---: | ---: | ---: | --- |
| PR #61 hosted pilot, 11 clips | 5 | 0 | 6 | Exact gate passed |
| PR #61 cohort A, 79 clips | 15 | 11 | 53 | 40 targets, 39 other signs, 2 research suggestions with 0 matches |
| `main` worker on cohort B, 40 clips | 0 | 7 | 33 | 0 targets, 2 wrong THANK YOU insertions |
| PR #61 worker on cohort B, 40 clips | 0 | 6 | 34 | 0 targets, 0 THANK YOU insertions, 1 research suggestion with 0 matches |

Cohort A targets were HELLO 2/8, THANK YOU 3/8, PLEASE 5/8, YES 0/8 and NO 5/8. SORRY had no trial. Cohort B's target skip exhausted the eight eligible test signers for each target. The artifacts contain the same eight signer IDs in A and B. B therefore offers two relevant negative observations for THANK YOU and no positive or new-signer confirmation. Its comparison against `main` includes PR #61's other worker changes. Sprint 2 used the recovered B metadata and results only to assess the earlier experiment. [Hosted A and B replay artifacts](https://github.com/adamjamiesimson/SignRelay/actions/runs/43916731488)

## What failed

The [per-trial trace summary](recognition-sprint-2-trace-summary.json) covers all 11 pilot clips and 31 of 79 cohort A clips, for 42 unique clips and 1,730 analyzed frames. The full A archive provided baseline outcomes. The local frame extraction stalled before completing the full cohort. The trace summary includes valid hand observations and continuity, worker motion decisions, candidate counts and sources, ambiguity, candidate streaks, suggestions, and transcript words. All 42 clips had tracked hands at some point. Nineteen reached the model movement gate at least once. The compiled worker and the controlled baseline with the model returning null produced identical transcript words on all 42 traces. These traces cannot distinguish ordinary off-frame hand rests from tracker losses without reviewed stroke annotations.

Among the 25 baseline abstentions, four had fewer than six valid hand observations, four had competing proposals, one had a matching proposal that failed confirmation, and 16 had an eligible tracking window without a starter proposal. Hand visibility was interrupted on 20 of the 25, and eight never reached a ready movement. These latter signals can overlap. Internal rejected TGCN labels and scores were unavailable in the saved trace, so an abstention contributes no model misclassification count.

- **YES.** None of the eight A clips produced a confirmed YES with PR #61. One produced SORRY. The pilot YES clip had five observed hand frames and failed the orientation or travel check. In A, track continuity, fist formation and duration excluded some windows before the angular test. On the 45-hand-frame YES clip, the old detector tried to measure the bend in the camera's fixed vertical/depth plane. Measuring flexion about the knuckle axis recovered the expected word. Another clip produced rapid orientation jumps and another reached the final stability check. Preserving evidence for a finished stroke without enough observations remains unresolved. [ASL University demonstration of YES](https://www.lifeprint.com/asl101/pages-signs/y/yes.htm)
- **THANK YOU.** The fallback used a broad shoulder-normalized circle around the mouth. In one HELLO recording, the initial fingertip was above the nose and then dropped through a large vertical arc. In a FISH recording, the candidate began far below the mouth and moved across the frame. Both passed the broad rule despite lacking the intended origin. Two correctly recognized recordings had compact, flat-hand origins close to the lips and passed the narrow departure rule. The historical THANK YOU error on Windows followed competing chest-circle and lip-departure evidence. The candidate still inserted PLEASE locally. [ASL University demonstration of THANK YOU](https://www.lifeprint.com/asl101/pages-signs/t/thankyou.htm)
- **HELLO, PLEASE, NO and SORRY.** Ordinary side-to-side waving still meets the HELLO geometry. A HELLO veto removed a correct publisher-labelled HELLO along with a CAT false insertion. Two THANK YOU takes yielded PLEASE on the local sample. One HORSE reproduced the NO confusion, and one YES yielded SORRY. SORRY had no genuine positive in these cohorts. Clip labels follow the publisher and some apparent confusions could involve an unreviewed variant. [PopSign dataset provenance and license](https://signdata.cc.gatech.edu/view/datasets/popsign_v1_0/)

## Candidate and comparisons

- YES projects wrist-to-knuckle motion around a stable index-to-pinky axis. It still requires a sustained fist, substantial flexion and return, a settled end, and the worker's two matching observations. Tests cover oblique views on both hands, rigid fist translation, opening and closing, one-way tilt, lateral roll, spikes and chest circles.
- THANK YOU constrains the fallback to a face-scaled lip-to-chin origin. Incomplete open-palm evidence can still veto a competing HELLO or PLEASE. The narrow observed mouth-departure path and flat-hand evidence remain part of the rule.
- Identical continuous observation windows are evaluated once per hand. Chrome replay now reads traces in bounded batches and reports tracking time, worker round trip, queue wait and replaced frames. Synthetic confusion reports assert that research-model messages cannot reach the transcript and count suggestions separately.

| Paired comparison | Correct | Wrong | Abstained |
| --- | ---: | ---: | ---: |
| Frozen PR #61, 42 identical captured inputs | 8 | 9 | 25 |
| Combined candidate, same 42 inputs | 9 | 6 | 27 |
| Frozen PR #61, Windows browser pilot, 11 videos | 5 | 1 | 5 |
| Combined candidate, same 11 videos | 5 | 1 | 5 |
| Frozen PR #61, targeted cohort A browser replay, 9 videos | 2 | 5 | 2 |
| Combined candidate, same 9 videos | 3 | 2 | 4 |

On the controlled replay, the candidate gained one YES and removed three wrong clips. It also removed the THANK YOU insertion on a HOT clip where HELLO still appeared. Twelve selected non-starter clips went from five with wrong transcript words to three. The nine-clip replay through the actual worker reproduced each of the five changed transcript outcomes. The selection includes those five clips and four THANK YOU controls. Eight of the nine videos overlap the controlled replay. Both workers made the same transcript decisions on the direct Windows pilot. The synthetic 684-run adversarial inventory went from 280 runs with a wrong transcript word to 260. All 20 removed words were THANK YOU on eye-shielding conditions. Eight eye-shielding variants and 144 HELLO false insertions remain. The starter-only matrix preserves 51/51 scripted outcomes for each of the six starter signs. A slow synthetic THANK YOU acquired an extra suggestion when an intentionally wrong model was injected. The transcript still contained exactly THANK YOU. The pilot had zero duplicate words under either worker. These checks exercise regressions and cannot estimate real-world false acceptance.

## Experiments set aside

- The camera-plane and loose face origin variants exposed the two failure mechanisms. An intermediate mouth veto exposed a HELLO insertion on AFTER. Keeping weak THANK YOU evidence in cross-window ambiguity prevented that substitution.
- The explicit HELLO movement veto traded one correct HELLO for one fewer wrong clip. Eye-origin lookback offered no additional transcript benefit on the final set. Prioritizing THANK YOU over an incomplete PLEASE arc made no transcript changes. Interpolating short hand gaps did not recover YES on the captured inputs and increased worker work.
- The existing 15/20/30 fps and same-frame reacquisition measurements led to retaining the 45 ms gate. The larger exposed cadence trial found 15 correct and 20 wrong at 30 fps, compared with 15 correct and 14 wrong at 20 fps before PR #61's flat-hand rule. The previous same-frame recovery also added a wrong insertion. [PR #61 evaluation](recognition-sprint-2026-11-16.md)
- A learned temporal or hybrid recognizer needs more independently reviewed positive and negative recordings than this targeted cohort provides. A temporal matcher would need signer-disjoint development and evaluation, observed-landmark masks, time and body normalization, and no-sign rejection before it can compete with the deterministic rule. This sprint did not train on the exposed clips or use ASL Citizen's research-only data to build a product classifier. [ASL Citizen terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/)

## Research model and timing

The WLASL publisher pipeline uses OpenPose joint coordinates, 50 consecutive frames, repeat-last padding and multiple test windows. SignRelay maps MediaPipe to 55 nodes, assigns hands to pose wrists when supported, uses training framing statistics and samples one 25 fps window from detected movement onset. It still has missing joints, a different estimator and framing, and live rather than publisher-aligned segmentation. The previous publisher comparison reported 22.4% top-1 under its protocol and 9.9% after the adapter repair on MediaPipe input. Those figures come from the earlier comparison, and this sprint did not repeat checkpoint evaluation. Existing evidence cannot isolate model limitations from input and segmentation shift. The packed model can confidently label an all-missing tensor, and its score is a ranking signal. [Publisher data loader](https://github.com/dxli94/WLASL/blob/master/code/TGCN/sign_dataset.py) · [PR #61 model comparison](recognition-sprint-2026-11-16.md)

Sprint 2 corrected the evidence guard's X-only comparison. A vertical stroke at fixed X now counts as observed movement, including at the image edge. Identical padding still fails to provide new evidence. The 42 baseline traces and both paired pilot passes produced zero displayed suggestions. The worker continues to require manual acceptance of research suggestions.

| Windows browser pilot, 11 clips | PR #61 | Candidate |
| --- | ---: | ---: |
| Analyzed frames / tracked hand frames | 414 / 152 | 414 / 152 |
| Median analyzed source fps | 20.2 | 20.2 |
| Clips with any ready movement | 3 | 3 |
| Worker answers / replaced frames | 413 / 1 | 413 / 1 |
| Worker round trip, median clip p50 / p95 | 2 / 10 ms | 3 / 8 ms |
| Queue wait, median clip p50 / p95 | 0 / 0 ms | 0 / 0 ms |
| MediaPipe time, median clip p50 / p95 | 330 / 582 ms | 302 / 609 ms |

These are source-stepped desktop replays, with both workers tested on the same device. Medians summarize the per-clip percentiles. The starter-only Node replay used the same 1,730 frames and had median process CPU times of 375 ms and 249 ms over five repeats. Concurrent workload and ordered runs make these rough diagnostics. Webcam end-to-end latency, sustained CPU utilization and actual live analyzed FPS require the device protocol.

## Verification status

The worker build reproduced the candidate hash. The ASL static export passed runtime integrity and both rendered HTML tests. The browser frame-step and forced-failure controls passed. The dependency audit reported zero advisories for both the full tree and production tree, using the repository's existing failure policy. The 11-clip exact baseline gate rejected the same wrong PLEASE insertion from both Windows workers. The evaluation registry still reserves release evidence for separately evaluated runtimes.

## Reproduce and validate

1. Use the existing frozen manifest and the exact-commit worker build. The two development manifests are `docs/evaluation/popsign-project-holdout-manifest.json` (historical development) and `docs/evaluation/popsign-development-2026-10-16.json`. Fetch only those manifests with `training/fetch_evaluation_clips.py`. The cohort A manifest is in the derived A artifact. Freeze it with the existing cohort validator and verify fingerprints before replay.
2. Build the ASL profile and the ephemeral recognition lab. Put the rebuilt PR #61 worker at `out/workers/baseline-recognition.worker.js`. Run `scripts/run-recognition-video-evaluation.mjs` using Chrome, the same manifests and unique JSONL outputs. Use `--baseline` on the PR #61 pass and `--reviewed-pilot` on the historical development manifest. Explicitly add `--capture-frames` only for local development diagnosis.
3. Compare JSONL with `scripts/compare-recognition-evaluation.mjs`. Run `scripts/baseline-gate.mjs` on the candidate pilot outputs. For local raw traces, bundle `scripts/diagnostics/asl-trace-report.ts` and point it at the ignored trace directory and its matching result JSONL. Share only the aggregate report.
4. Run the [paired webcam protocol](webcam-validation-protocol-2026-11-16.md) on frozen builds with consenting new signers and independently reviewed prompts. Include everyday actions, unsupported signs, repetitive movement and camera or language resets. The publisher-labelled excerpts, synthetic control set and local CPU measurements establish development behavior only.
