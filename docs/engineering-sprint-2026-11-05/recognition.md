# Recognition, personal signs and multilingual runtime

## Correctness changes

| Severity and reproduction | Root cause | Correction and coverage |
|---|---|---|
| **High.** The worker confirmed a personal sign when the second template result came from before a camera pause or backward timestamp. The starter confirmation streak could also complete after a pause. | The frame buffer could reset independently of cached matching results, matcher generations and confirmation streaks. A negative frame age was accepted as fresh. A gap beyond the continuous-tracking limit could leave old generic-model input in the rolling buffer. | `workers/recognition.worker.ts` clears observation evidence at the existing 750 ms continuity ceiling and after duplicate timestamps. A backward timestamp also resets frame-clock deadlines and cooldown. After a forward pause, the matcher generation changes, classifier output from before the pause is discarded and an existing cold model load can finish. Regressions in `tests/recognition-worker.test.ts` exercise both directions and the starter streak. The frozen model-policy comparison retains candidate, confidence, source, feedback and emitted word equivalence. The new regressions assert the deliberate buffer and listening-state transitions. |
| **High.** A cached or malformed worker confirmation with no source could fall through the workspace's suggestion handling into the transcript and auto-speech. | The suggestion converter returned no card for an unknown source, and the consumer treated that as permission to confirm. | `lib/model-output-policy.ts` and `components/translator-experience.tsx` require explicit personal attribution or an ASL starter result under authorized research auto mode. `lib/model-suggestion.ts` rejects cross-language starter results. The policy unit test exercises every language and the browser smoke test injects an unattributed message. |

The worker emits source-tagged research-model suggestions. The existing worker protocol still carries raw ASL starter events in a `confirmed` envelope for compatibility with replay tools. The workspace requires the compiled and host-validated research policy for automatic handling. Public-build checks separately verify the compiled `suggest` policy. A worker protocol migration would let the production worker express starter events as suggestions directly.

The changes preserve template encoding, legacy ASL defaults, `trajectory-v3`, thresholds, mappings and normal-window matching. Saved templates are filtered by language before transfer to the matcher. Changing language or restarting a recognition session invalidates the previous worker generation. Template deletion still has a window between its IndexedDB commit and worker reconfiguration after the refreshed list loads. Concurrent tab writes and deletion during active inference require browser validation.

The same three discontinuity regressions failed against a source archive of `900dca8e14ef0daa985c40729304628bde97024c`. The baseline emitted one confirmation in each case. The candidate worker and timing suites passed 87 cases, including all three discontinuity regressions with zero confirmations. The controls use the real recognition worker's message handler and scheduler with deterministic recognition dependencies. They measure stale-result behavior under a known stimulus.

```powershell
node node_modules/vitest/vitest.mjs run tests/recognition-worker.test.ts -t 'camera discontinuity|camera pause'
node node_modules/vitest/vitest.mjs run tests/recognition-worker.test.ts tests/recognition-timing.test.ts
```

## Historical recorded-sign evidence

These are the frozen starter-rule results from PRs #54–56. Runs [41766216048](https://github.com/adamjamiesimson/SignRelay/actions/runs/41766216048) and [41767216986](https://github.com/adamjamiesimson/SignRelay/actions/runs/41767216986) processed 176 direct WLASL clips in headless Chrome through production vision. The C-UDA clips were confined to CI. There were 27 target clips and 149 other-sign clips. The original split included 16 development positives, 11 initially held-out positives, 119 previously exposed negatives and 30 initially held-out negatives. Every clip is now development-exposed. See [the starter reliability report](../release-candidate/STARTER-RELIABILITY.md).

| Starter | Correct / target clips | Wrong detections on other signs | Precision on this corpus | Recorded confusions |
|---|---:|---:|---:|---|
| NO | 6/6 | 1 | 6/7 | FEW |
| PLEASE | 5/5 | 9 | 5/14 | HAPPY, BENEFIT, COMPUTER and six others |
| SORRY | 3/3 | 8 | 3/11 | PLAY, PARTY, BASEBALL and five others |
| HELLO | 1/2 | 2 | 1/3 | FUTURE, NICKEL |
| THANK YOU | 1/4 | 12 | 1/13 | BAD, SAD, VOMIT and nine others |
| YES | 0/7 | 1 | 0/1 | PROBLEM |
| I LOVE YOU | 0 clips | — | — | Outside this corpus |

The rules recalled 16/27 targets and abstained on the other 11. They produced 33 wrong detections across 30/149 other-sign clips and abstained on 119/149 other-sign clips. On the same exposed corpus, run [41785854658](https://github.com/adamjamiesimson/SignRelay/actions/runs/41785854658) used 30 signers and ten signer-disjoint folds. The temporal research baseline recalled 5/27, abstained on 22 targets and accepted 10/149 other signs. Each fold had zero to six training examples per sign. The feature and DTW research remain outside product recognition. See [the temporal recognizer report](../research/temporal-recognizer/DIRECTION.md).

Location and motion cues account for the documented chest-circle and outward-from-face confusions. The small wrist nod in recorded YES clips also exposes a recall limit. Synthetic controls historically missed many chest-level false accepts and cannot establish a language-correct fix. The ASL-2000 report documents weak precision on actual MediaPipe input from an OpenPose-trained model. This sprint changes which observation history may contribute to a decision. Independent recorded and signer-held-out measurements remain required to quantify any accuracy effect. The output-policy checks measure transcript safety separately. This sprint collected zero human signing sessions, so ordinary-action false accepts, user additions, correction burden and recognition latency under real signing remain unmeasured.

## Installed paths and evidence

| Language | Installed recognition coverage and provenance | Personal signs and output |
|---|---|---|
| ASL | WLASL2000 Pose-TGCN, 2,000 model labels and seven built-in rules. MediaPipe landmarks adapted to the OpenPose-trained input. | Saved signs supported. Experimental model and starter results require acceptance in public use. |
| BSL | Official BSL-1K Pose2Sign body and hands, 1,064 labels. | Saved signs supported. Experimental suggestions. |
| ISL | AI4Bharat INCLUDE-263 transformer, 263 labels. | Saved signs supported. Experimental suggestions. |
| LSE | SWL-LSE SignaMed temporal landmark model, 300 health-domain labels. | Saved signs supported. Experimental suggestions. |
| PSL | HFAD dictionary, 775 reference performances. Cached reference bundle and dedicated DTW matcher. | Saved signs supported. Experimental suggestions. |
| RSL | Slovo MViTv2, 967 word or phrase classes and 33 letters. Standalone 32-frame RGB capture. | Standalone component displays experimental suggestions. Personal-sign matching is outside this capture path. |
| BdSL | BdSLW401 VideoMAE, 401 classes and 398 distinct source glosses. Standalone 16-frame RGB capture. | Standalone component displays experimental suggestions. Personal-sign matching is outside this capture path. |
| Other registry entries | Personal vocabulary in the shared workspace. Auslan has a planned model and zero installed automatic classes. | User-taught signs only. |

The installed counts describe model classes or dictionary references. The registry and runtime preserve source-specific labels, including the RSL and BdSL class order. The landmark runtimes have separate download and ONNX initialization controls, an inference watchdog and tensor disposal in `finally`. ORT native inference can finish after a reset, so the loader serializes access to the cached session. The workspace uses one active frame and one replaceable pending frame. The personal and PSL matcher uses a separate bounded worker lane. The RSL and BdSL components invalidate old generations and stop pending camera tracks when the route changes. Cross-language regression coverage exercises stale results and wrong-language model dispatch with controlled worker dependencies. Physical-device switching, bad-network recovery under every installed model, and multilingual signer accuracy remain open.

## Paired CPU measurements

```powershell
node scripts/benchmarks/recognition-sprint.mjs 900dca8e14ef0daa985c40729304628bde97024c ../recognition-worker-bench
```

The benchmark uses Windows, Node 24.22.1 and an Intel Core i7-10510U with eight logical CPUs. It materializes source and JSON metadata from the pinned alpha commit with Git and builds both variants with the same toolchain. Each personal-sign workload sends 48 kinematic landmark frames in signing order through real Node worker threads, with one outstanding frame at a time. The fixture has 50 ms observation spacing and the harness waits 12 ms between acknowledgements and subsequent sends. Both variants use the same packed template data, and the harness alternates run order across three starts. The acknowledgement measures the scheduler and worker message round trip. It excludes the camera, rendering, browser transfer optimization and GPU.

The PSL scan and ASL-2000 inference use the same installed model bytes in both variants. The harness supplies those bytes from memory to isolate compute and model initialization from network and disk. The kinematic frames serve as an input workload for timing, and the harness checks matching decisions between variants. This workload yields no estimates of precision, recall or signing latency.

| Saved examples | Baseline frame acknowledgement median / p95 / p99, ms | Candidate median / p95 / p99, ms |
| ---: | ---: | ---: |
| 0 | 9.6 / 52.2 / 79.2 | 13.7 / 84.9 / 136.0 |
| 1 | 21.5 / 102.8 / 149.3 | 13.3 / 57.9 / 116.4 |
| 6 | 20.2 / 72.5 / 90.5 | 18.3 / 76.5 / 135.9 |
| 30 | 18.3 / 83.9 / 143.3 | 9.8 / 56.6 / 139.8 |
| 150 | 8.4 / 59.8 / 108.9 | 9.1 / 70.1 / 135.5 |
| 300 | 17.7 / 64.7 / 127.8 | 15.9 / 80.1 / 109.0 |
| 1,000 | 11.8 / 53.9 / 61.5 | 4.4 / 28.0 / 43.5 |

The 775-reference PSL scan abstained in both variants. Cold elapsed time was 17.45 s baseline and 19.65 s candidate. Warm median / p95 / max over 20 samples was 381 / 690 / 834 ms baseline and 452 / 683 / 750 ms candidate. The pinned ASL-2000 model returned the same label and score on both variants. Cold load / inference took 1,269 / 2,036 ms baseline and 1,170 / 1,630 ms candidate. Ten warm inferences gave median / p95 / max of 2,098 / 9,916 / 9,916 ms baseline and 2,845 / 6,834 / 6,834 ms candidate. These timing distributions varied while other local checks ran. The matcher and model algorithms were retained, so the observed differences do not establish an algorithmic speedup. The frame acknowledgement is separate from any asynchronous match finishing.
