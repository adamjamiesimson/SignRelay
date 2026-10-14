# Recognition matching benchmark — 14 October 2026

## Execution

GitHub Actions Core CI, Ubuntu runner, Node.js 22.13.0, PR #21. Source run: https://github.com/adamjamiesimson/SignRelay/actions/runs/38535866019

Reproduction:
- npm ci
- npx esbuild scripts/benchmarks/personal-dtw.ts --bundle --platform=node --format=esm --outfile=/tmp/signrelay-personal-benchmark.mjs
- node /tmp/signrelay-personal-benchmark.mjs

Harness reconstructs original (main-branch) full-matrix DTW/multi-window personal matcher and directly invokes the optimized matcher with **the same synthetic frames and saved templates**. Each pair is checked for identical recognition decisions. For each personal set, we measured one original call, one new cold call and one warm new call. These are rough, **single-run CPU observations**, not statistically robust medians, phone measurements or signer-independent accuracy estimates.

## Personal matcher timings (milliseconds per evaluated synthetic frame)

| Examples | Scenario | Original | New cold | New warm | Original / warm |
| ---: | --- | ---: | ---: | ---: | ---: |
| 30 | Mostly distant alternatives | 215.07 | 39.23 | 12.10 | 17.77x |
| 150 | Mostly distant alternatives | 637.15 | 53.68 | 36.58 | 17.42x |
| 300 | Mostly distant alternatives | 1247.09 | 74.04 | 58.08 | 21.47x |
| 30 | Closely matching alternatives | 124.03 | 88.63 | 83.08 | 1.49x |
| 150 | Closely matching alternatives | 613.34 | 406.48 | 402.35 | 1.52x |
| 300 | Closely matching alternatives | 1229.29 | 809.46 | 809.92 | 1.52x |

All matched recognition decisions in this synthetic harness. The template arrays are deliberately generated: 'distant' examples share a shifted normalized feature space; 'hard' examples sit close to the candidate. Neither distribution represents measured real-user vocabularies.

## PSL compute-only timing (775 references)

| Scenario | Original full DTW | Bounded DTW compute | Ratio |
| --- | ---: | ---: | ---: |
| Mostly distant references | 792.17 ms | 47.28 ms | 16.75x |
| Closely matching references | 798.40 ms | 528.59 ms | 1.51x |

PSL figures **exclude** bundle fetch/decompression, asynchronous scheduling/yield time, camera tracking, UI latency and device limitations. They are not end-to-end PSL latency measurements.

## Result and release decision

- Synthetic old/new prediction parity and Core CI pass.
- **Not ready to merge as a scalable 'unlimited custom signs' fix**. A 300-example, all-close matching pass still takes about 810ms on this desktop-class runner. At an intended 50ms frame sampling interval, the design remains CPU-bound and phones may be worse.
- A 10x or better improvement is demonstrated only for this artificial mostly-dissimilar benchmark, not hard cases.
- Release requires real-device measurements and performance work that removes personal matching from the camera-frame acknowledgement critical path (e.g. a bounded, coalescing dedicated matcher worker), with correct resets/segmentation and confusion regressions.
- No held-out sign evaluation was collected here; all public accuracy claims remain experimental.
- Firebase builds remain blocked by the separate dependency audit, handled through draft security PRs #18/#19; never disable the audit for this performance change.
