# Long-session stress (Objective 15) and bottleneck decision (Objective 16)

`node scripts/benchmarks/long-session.mjs` bundles the recognition worker from source and runs it on real Node worker threads, with the committed template-matching bundle. It speaks the browser Worker protocol; it is **not** a browser, camera or phone measurement.

Camera delivery follows the app's protocol: frames offered at 20 Hz, one in flight, one latest. A slow worker would therefore show up as dropped (coalesced) frames and queue age, never as a growing queue. The input repeats a six-sign session with rests.

Machine: Node v22.22.0 on Intel Xeon @ 2.10 GHz × 4. Results: [`long-session-benchmark.json`](long-session-benchmark.json), 120 s per scenario.

| Scenario | Frames offered | Acknowledged | Dropped | Faults | Ack p50 / p95 / max (ms) | p95 first 30 s → last 30 s | Queue wait p95 / max (ms) | Recognition-worker heap first → last (max) MB |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 30 personal examples | 2401 | 2401 | 0 | 0 | 0.56 / 0.82 / 45 | 0.95 → 0.78 | 0 / 0.19 | 10.3 → 15.7 (23.1) |
| 150 personal examples | 2401 | 2401 | 0 | 0 | 0.52 / 0.84 / 136 | 0.88 → 0.99 | 0 / 1.8 | 25.5 → 32.1 (32.1) |
| 300 personal examples | 2400 | 2399 | 1 | 0 | 0.52 / 0.78 / 455 | 0.89 → 0.73 | 0 / 22.9 | 45.3 → 47.5 (51.8) |
| 775 PSL references | 2401 | 2401 | 0 | 0 | 0.50 / 0.81 / 11 | 0.84 → 0.90 | 0 / 0.72 | 7.2 → 8.4 (13.9) |

**Latency does not drift.** The p95 in the last 30 s matches the first 30 s in every scenario. Across 9,603 offered frames, 1 was dropped.

**Memory reaches a plateau.** A separate 300-second run with 300 examples covered 6,000 frames: 5,999 acknowledged, 1 dropped, p95 0.92 ms.
- Process RSS (all threads) rose to 355 MB, fell to 254 MB at about 2 minutes, then stayed between 270 and 285 MB through minute 5.
- The recognition-worker heap stayed between 45 and 59 MB.

That is garbage-collection sawtooth followed by a plateau, not unbounded growth. The 120 s runs end on the rising part of the sawtooth, which is why their RSS samples climb.

No word was confirmed in any scenario. This is expected: the workload's personal examples are near-duplicate variants of one movement spread across 100 glosses, so the competing-gloss veto abstains. PSL has no matching reference for the input. The runs therefore measure matching workload and responsiveness, not recognition.

## Bottleneck decision

The only acknowledgement outliers are one-time template setup at session start.

In a separate 15 s run with 300 examples, the maximum (368 ms) came at t = 0.37 s, on the first frame after the templates were posted. The only other frame over 50 ms was a single 59 ms frame at t = 10 s (garbage collection). The maxima scale with template count: 45 ms, 136 ms and 455 ms for 30, 150 and 300 examples.

That one-time cost is smaller than the measured vision cold start (about 1.9 s in the offline smoke). It happens while the camera is starting, and steady-state p95 stays under 1 ms.

**No optimisation was made.** No bottleneck was measured on the steady-state frame path, and any change would have to prove decision equivalence for no measurable user benefit. If personal libraries grow far beyond 300 examples, the next step is to move template compilation off the recognition thread. Sprint 1's DTW kernel and isolation work already removed the earlier steady-state bottleneck (`docs/evaluation/matching-isolation-2026-10-14.md`).
