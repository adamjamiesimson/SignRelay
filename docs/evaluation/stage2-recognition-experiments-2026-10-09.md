# Stage 2 recognition experiments — evidence and rollback (9 October 2026)

**Status:** Experimental approaches did not clear the real-video quality bar and have been rolled back. No live deployment or main-branch merge.

## Baseline and method

The frozen smoke dataset has eight official PopSign ASL v1.0 `game/test` clips (two per HELLO, NO, YES, PLEASE), plus two Wikimedia Commons CC BY-SA 4.0 recordings of non-sign-intent hand activity. The web application and its recognition worker were replayed through headless Chrome via a local video-backed media stream, with metadata-only output. These ten clips are *not* a representative signer-independent accuracy sample. Two runs are not sufficient to establish an accuracy rate or stability under realistic live webcams.

Stage 1 adopted `requestVideoFrameCallback` for presented-frame identity; the diagnostic baseline [#37930947424](https://github.com/adamjamiesimson/SignRelay/actions/runs/37930947424) had 3/8 correct signed words in each of two repeats, 1/8 HELLO → THANK YOU wrong in both, and both non-sign clips rejected. Later repeats of the same source video show substantial variability, so 3/8 is **not** a stable calibrated reference.

## Experiments completed

| Workflow run | Changes investigated | Signed clips correct (pass A / B) | What we learned |
| --- | --- | ---: | --- |
| [#37932465373](https://github.com/adamjamiesimson/SignRelay/actions/runs/37932465373) | Hand detector confidence 0.55→0.45; hand presence/tracking 0.55→0.50; tighter THANK YOU chin+direction filter | Partial run 2/7, second pass not executed | First fixture failed React workspace startup; excluded from accuracy comparison. HELLO → THANK YOU still appeared |
| [#37933202500](https://github.com/adamjamiesimson/SignRelay/actions/runs/37933202500) | Same thresholds and THANK YOU filter; more detailed trajectory evidence; UI startup retry | 0/8, 1/8 | Outputs changed on 2/10 clips. The HELLO clip alternated between PLEASE and rejection. No supported recall gain |
| [#37933957472](https://github.com/adamjamiesimson/SignRelay/actions/runs/37933957472) | Restored original thresholds and geometric rule, retained offline evidence tracing | 0/8, 0/8 | Even baseline varies significantly by run. One HELLO → PLEASE occurred, showing broader starter-rule ambiguity |
| [#37934919304](https://github.com/adamjamiesimson/SignRelay/actions/runs/37934919304) | Chin origin and initial chest position checks in starter rules | 1/8, 0/8 | No wrong accepts in these two passes, but no demonstrated improvement in correct recognition; one outcome changed. Guards not accepted as production fix |
| [#37935741308](https://github.com/adamjamiesimson/SignRelay/actions/runs/37935741308) | Brief 450 ms tolerance for pending ASL model inference across tracked motion gaps | 1/8, 0/8 | One HELLO → PLEASE and two changed clip outcomes. Inference grace not validated; reverted |

All completed runs rejected both non-sign-intent clips, but a sample of two offers no reliable general false-positive-rate estimate. They passed as **software execution workflows**, not as accuracy acceptance tests.

### Grounded false THANK YOU motion evidence

Run [#37933957472](https://github.com/adamjamiesimson/SignRelay/actions/runs/37933957472) recorded the following derived, body-scale-normalized quantities at a THANK YOU **starter-rule candidate** on a known HELLO clip:

- First fingertips to mouth: approximately **0.341**; first fingertips to nose: approximately **0.279**.
- Fingertip displacement: Δx approximately **−0.206**, Δy approximately **+1.372**.
- Wrist displacement: Δx approximately **−0.155**, Δy approximately **+0.595**.
- Similar nose-vs-mouth relationship appeared in the second replay.

The existing THANK YOU fallback checks first-hand distance to mouth <0.4, so this nose-proximal greeting can mistakenly enter the THANK YOU rule. A stricter chin-origin requirement suppresses this candidate in that clip, but the same gesture can instead be assigned to another starter class or rejected. It is **not** enough to fix the full recognizer.

The logged numbers are relative motion summaries, not identifiable landmarks, video or a raw tracking trajectory. They are diagnostic only.

### Main unresolved technical issues

1. **Hand availability is low** in numerous short archived recordings: in several NO/YES/HELLO tests, only roughly 10–35% of processed worker frames contained detected hand landmarks. A slightly lower MediaPipe confidence threshold did not resolve this consistently. Check lighting, cropped hands, source resolution and position, and run hand-specific frame/landmark validity probes on a larger dataset.
2. **Starter-rule confusion:** HELLO clips sometimes produce THANK YOU or PLEASE. A short-window rule may see only the tail of a gesture, so location checks need to be evaluated on a complete gesture segment, not synthetic one-frame examples.
3. **Asynchronous model scheduling:** pending inference is regularly invalidated by motion state changes; a 450ms grace experiment did not establish improvement. Log model launch/completion/expiry and sequence identities before changing generation semantics or the two-confirmation gate.
4. **Timing variability persists** despite source-frame gating. Candidate appearance and correct outcomes change between headless-browser runs. Measure browser presented frames, MediaPipe valid-hand frames and worker/model wall times on repeat trials.
5. **Dataset size:** eight positive examples and two negatives are insufficient for research claims or large classifier changes. Expand with consented, licensed clips and freeze signer/video splits.

### Engineering decision

- **Retain:** Stage 1 frame-identity fix, offline stage tracing, fixture preflight, two-run comparison, startup retry, and optional metadata-only geometric evidence.
- **Revert:** lower hand detector thresholds, new chin/chest heuristic gates, and asynchronous model grace period. All were inconclusive or failed measured reliability checks.
- **Do not change:** production Firebase, `main`, model weights, global sign acceptance threshold, or public reliability claims.
- **Next:** construct a balanced held-out validation suite (at least several clips per sign across multiple independent signers plus realistic no-sign controls), inspect tracker misses and rule geometry with reviewed clips, and improve video evaluation determinism. Only accept a recognition change that improves correct recognition **without** increasing wrong accepted words across repeated runs.

**Separate blocker:** The Firebase Static Build Check reports dependency vulnerabilities on `npm audit`, including Next.js, and must be handled in a separate dependency-security change before any deployment.
