# Accuracy sprint 2026-11-23: evaluation protocol

Written and committed **before** any candidate change was run. Baseline revision:
`c5c802df4728a5bff848d2cb47a423c8b06df241` (main after PR #67; no newer remote work existed when the
sprint started).

## What is measured

Integrated application only (the ASL-demo static export, which ships the same ASL code path as the
full export with the other language workspaces pruned), V3.1 Strict, manual confirmation unchanged.
Every trial streams a checksum-pinned 640×480 15 fps Y4M through Chromium's fake camera, using
`scripts/diagnostics/run-engine-comparison.mjs … integrated-v3`. This is **file replay through the
real camera path**, not physical signing.

| Reel | Contents | Role |
| --- | --- | --- |
| `shared` | 17 intervals, HELLO/THANK-YOU/PLEASE/YES/NO ([plan](../showcase-2026-11-26/engine-comparison-development.json)) | regression control |
| `broad` | 12 supported + 4 calibration unknowns | regression control |
| `A` | 30 supported signs + 10 calibration-unknown clips ([plan](development-cohort.json)) | diagnosis and tuning |
| `B` | 30 different supported signs + 10 calibration-unknown clips | confirmation only: baseline and final candidate |

`A` and `B` come from PopSign ASL v2.1 publisher **validation** signers, already used for V3.1 model
selection. They are development data. After this sprint the shared, broad and `A` reels are also
tuning-contaminated. No PopSign test round, `test_only_never_seen` sign or sealed SignRelay holdout is
listed, fetched or decoded. Selection is a salted SHA-256 order fixed in
`scripts/diagnostics/select-sprint-cohort.py`.

## Scoring (unchanged from the showcase comparison)

An accepted suggestion belongs to the interval whose `[start − 0.10 s, end + 0.85 s]` window contains
its emission time. Per interval: **correct** (every accepted label equals the frozen label),
**wrong** (any accepted label differs), **abstained** (none). Unknown intervals: **false accept** or
rejected. Also reported: accepts in grey gaps, duplicate accepts, runtime errors, transcript entries
and speech calls before review, forwarded fps, hand-observation rate, and per-sign outcomes.
Strict label equality is kept. Near-synonyms (for example EAT/FOOD) are listed separately for
linguistic review and are never rescored as correct.

## Adoption rule (fixed before candidate runs)

A recognition change is adopted only if, summed over `shared + broad + A`:

1. wrong suggestions + unknown false accepts + grey-gap accepts do **not increase**, or increase by at
   most one while correct suggestions increase by at least three;
2. correct suggestions increase by at least two (single-run noise was about ±1 sign in V3.1 replays);
3. no runtime error, leaked camera track, unreviewed transcript entry or speech call appears;
4. forwarded frame rate does not fall by more than 10 %.

The final candidate is then run once on `B` with the baseline. `B` is reported whatever it shows and
is not used to choose between variants. Pure throughput, startup or reliability fixes that do not
change classifier decisions on identical observations may be adopted on lifecycle evidence alone.

Offline comparisons on **identical recorded observations** (landmark streams captured from the
integrated tracker) are used to separate segmentation, sampling and policy effects from tracker
effects. They guide changes but do not replace the browser runs above.

Hosts and versions are recorded in each JSON result. Partial, timed-out or erroring runs count as
failures, not as results.
