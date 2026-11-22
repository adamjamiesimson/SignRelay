# Recognition evaluation

The candidate preserves checkpoint weights and confidence thresholds. ASL-2000 input preprocessing was repaired, and its predictions remain tentative in the existing candidate display. Starter geometry and personal templates can confirm isolated signs. The ASL checkpoint runs through packed JavaScript Pose-TGCN. BSL, ISL, LSE, RSL and Bangla use ONNX inference. PSL uses reference-template DTW.

## Recorded evidence

The October ledger reports 5 correct accepted, 0 incorrect accepted, 6 abstentions and 0 runtime errors across 11 previously inspected publisher-labelled recordings. HELLO was 1/3 correct, PLEASE 3/3, NO 1/1, THANK YOU 0/3 and YES 0/1. SORRY had zero trials. These results apply to worker `ccce84c876f95caf9cade9a93fad1b686d5009a77ada203049044ee17ceb5632`. [October dashboard](../evaluation/dashboard-2026-10-21.md)

The candidate worker is `3510843cc821cbbdb9dc227d1f68dff8ded10dce77620bde0198bf4e7e2456c1`. A new replay attempted all 11 development recordings in Chromium 156 with real MediaPipe and the production worker. Ten trials failed before completing with decoded-video seek timeouts. One THANK YOU trial completed and abstained, with 4 tracked-hand frames out of 31. The resulting totals are 0 correct accepted, 0 incorrect accepted, 1 abstention and 10 runtime errors across the 11 attempts. Partial predictions and tracking counts remain in the evidence, and the harness correctly returned failure. These runs cannot establish candidate accuracy or a comparison with October. An earlier six-recording baseline replay also encountered decode failures. Integer sample indices removed cumulative floating-point timestamp drift, while the decode problem persisted. [Five development trials](evidence/november-candidate-development.jsonl) · [Six historical development trials](evidence/november-candidate-historical.jsonl)

Only the eleven SHA-pinned PopSign CC BY 4.0 development recordings were downloaded. The legacy filename `popsign-project-holdout-manifest.json` identifies the six historical-development clips in the frozen cohort lock. The separate five-clip reserved final holdout remained sealed. Automatic approval initially rejected the legacy filename. Reading the cohort lock established the historical-development role, and the subsequent authorized replay was accepted. [Cohort lock](../evaluation/cohort-lock-2026-10-16.json)

## Engineering evidence and remaining limitations

Real model execution, preprocessing contracts, cancellation, temporal sequencing and synthetic movement regression checks exercise software behavior. Generated video controls confirmed that processed frames had unique increasing source timestamps and completed seeks. These checks do not measure signed-language accuracy. [Frame controls](evidence/frame-step.json) · [Model lifecycle](evidence/model-lifecycle-browser.log)

The earlier PR #61 research evidence supported the hand-coordinate repair and training-compatible sequence window. It also showed weak accepted-word precision on MediaPipe inputs. The candidate therefore keeps neural ASL outputs outside automatic transcript confirmation. No retraining or vocabulary expansion was justified by the available camera evidence. [Research PR](https://github.com/adamjamiesimson/SignRelay/pull/61)

A synthetic THANK YOU followed by a held-hand pause and an unrelated reach can still produce an extra THANK YOU through the production starter. The disabled experimental tail filter suppresses that constructed case, but independent real-video evidence is needed before enabling it. The regression suite records that starter behavior while requiring that a subsequent research-model word never enters the transcript.

No new real no-sign or unsupported-sign recordings were available. Their false-acceptance rates remain unmeasured. Tracking continuity through occlusion and the full signing stroke, real-time throughput on booth hardware, fresh signer performance, left-handed variants, and fluent independent review remain physical acceptance gates. Speech and fake webcam checks carry no recognition-accuracy claim. [Physical checklist](PHYSICAL_TEST_CHECKLIST.md)
