# ASL tracking / motion-observation triage — 20 October 2026

**Status: diagnostics only.** This sprint adds local development evidence classification and leaves the production recognizer, model weights, confidence/confirmation thresholds, handedness mapping and user data unchanged. The five reserved final holdout recordings are not fetched, inspected or scored. This document uses the **same eleven already-inspected publisher-labelled development recordings**, not new participants or an independent fluent ASL review.

## Retrospective priorities for HELLO, THANK YOU and YES

The existing aggregate reports already show 5 correct, 0 incorrectly accepted, 6 abstentions. The new `report-known-asl-abstentions.mjs` utility groups the **six previous abstentions** without decoding footage or fabricating additional observations:

| Previous development take | Existing hand frames | Existing basic tracking-eligible endpoints | Observed diagnostic lead |
| --- | ---: | ---: | --- |
| HELLO `gtsignstudy4a.8031` | 11/37 | 7 | One HELLO candidate, not enough confirming candidate evidence |
| HELLO `4a.8006` | 12/35 | 7 | Tracking window eligible, but no HELLO proposal |
| THANK YOU `gtsignstudy4a.8031` | 4/31 | 0 | Fewer than six hand observations; no basic eligible window |
| THANK YOU `gtsignstudy4a.8033` | 15/37 | 11 | Separate THANK YOU and PLEASE candidates, ambiguity feedback and incomplete-prefix geometric probes |
| THANK YOU `4a.7003` | 6/30 | 2 | Tracking window eligible, but no THANK YOU proposal |
| YES `4a.8006` | 5/31 | 1 | Fewer than six hand observations; no finished motion segment |

All six have **zero motion-ready worker analyses** in the existing reports. This does *not* establish that their human signing was unfinished, or that the neural classifier misclassified a completed segment. A missing frame may be ordinary rest, occlusion, camera framing or a tracker failure; an independent fluent ASL reviewer must annotate the intended stroke before causal investigation.

## New counters in future opt-in local traces

`scripts/diagnostics/asl-trace-report.ts` now includes:
- `hand_continuity`: number of visible-hand episodes, interior gaps between them, longest visible episode (frames/ms), first acquisition delay, leading/trailing missing-hand frames, and final disappearance-to-end delay. These are **camera-frame observations** rather than signed-stroke boundaries.
- `candidate_continuity`: count of candidate proposals matching the expected gloss, number of competing candidate analyses and maximum run of adjacent expected-word **analysis proposals** (not a semantic confidence score).
- `abstention_triage`: for incomplete/absent accepted words only, a prioritized observable lead, independent flags (including ambiguity / partial-prefix geometry / no motion-ready analysis) and a review recommendation. Confirmed outputs get `null`, not simulated unconsumed history.

No raw face, pose, wrist coordinates, video or frame-by-frame timeline goes into the aggregate. Trace collection remains explicitly **opt-in**, under Git-ignored `evaluation/raw/recognition-traces/`; hosted CI never enables `--capture-frames`. The existing trace guard accepts complete **development-only** trials with matching recording IDs, monotonic frame timestamps and worker/frame counts. Runtime errors do not become abstentions. Prior frozen aggregate files remain unchanged; continuity episodes are **unavailable** for them and never invented.

## How to run (local checkout)

Inspect existing publisher-labelled development aggregates without any media:

```bash
node scripts/diagnostics/report-known-asl-abstentions.mjs
```

For **new consenting, independently reviewed development recordings**, follow [private recording workflow](private-browser-capture-2026-10-20.md) and [reviewed collection/import procedure](reviewed-development-collection-2026-10-17.md). Only when a reviewed development manifest has been properly frozen, replay locally with the non-release evaluator's explicit `--capture-frames` option **and never** `--final-holdout`:

```bash
node scripts/run-recognition-video-evaluation.mjs /path/to/chrome \
  docs/evaluation/asl-reviewed-development-2026-10-17.json \
  evaluation/derived/new-reviewed-trials.jsonl \
  --cohort-lock=docs/evaluation/cohort-lock-reviewed-2026-10-17.json \
  --capture-frames
```

Then use the printed ignored trace-directory path to build a new aggregate:

```bash
npx esbuild scripts/diagnostics/asl-trace-report.ts --bundle --platform=node --format=esm --outfile=work/asl-trace-report.mjs
node work/asl-trace-report.mjs evaluation/raw/recognition-traces/LOCAL_RUN_ID \
  evaluation/derived/new-reviewed-trials.jsonl evaluation/derived/new-triage.json
```

New recording capture, independent human review, mobile hand-tracking validation, no-sign/OOV false-accept measurement, full dependency audit and final holdout all remain open release gates. Do not lower the two-evidence requirement merely to make reused recordings pass.
