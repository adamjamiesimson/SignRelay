# Sprint 5 performance record

**No performance code changed in Sprint 5.** The recognition and matching workers are byte-identical to Sprint 4 (`39a5f2c3…`). These are characterisation runs. Environment: Node 22.22.0 worker threads on this cloud container. It reported an Intel Xeon @ **2.10 GHz** x4 during these runs, whereas Sprint 4's runs reported 2.80 GHz, so the hardware differs and cross-sprint comparisons are indicative only. These are not browser, camera or phone measurements.

## Extended sessions (objective 12)

`LONG_SESSION_SECONDS=600 LONG_SESSION_SAMPLE_MS=30000 node scripts/benchmarks/long-session.mjs --out docs/refinement/sprint-5/long-session-600s.json`. Frames are offered at 20 Hz, one in flight and one latest, in a six-sign cycle with rests. Templates are posted the way the app posts them. A new scenario switches language and back every 30 s, then pauses 10 s with no frames. The host now also reports how many matcher workers are alive.

| Scenario (10 min each) | Answered / sent | Dropped | Faults | Ack p50 / p95 / max | p95 first vs last 30 s | Recognition-thread heap first → last (max) | Live matcher workers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 30 personal examples | 12,001 / 12,001 | 0 | 0 | 0.76 / 2.10 / 94 ms | 2.49 / 2.20 ms | 8.8 → 18.5 MB (20.9) | 1 |
| 150 personal examples | 12,000 / 12,000 | 0 | 0 | 0.71 / 1.75 / 57 ms | 2.32 / 1.54 ms | 13.7 → 14.9 MB (25.8) | 1 |
| 300 personal examples | 12,001 / 12,001 | 0 | 0 | 0.74 / 2.00 / 58 ms (at t = 0.06 s) | 1.99 / 1.07 ms | 21.0 → 24.0 MB (32.5) | 1 |
| 775 PSL references | 11,997 / 11,997 | 3 | 0 | 0.74 / 2.22 / 406 ms (at t = 98 s) | 2.04 / 1.93 ms | 7.9 → 13.3 MB (15.2) | 1 |
| 300 examples, 19 language-switch and idle cycles | 8,182 / 8,182 | 0 | 0 | 0.77 / 2.12 / 62 ms | 2.00 / 2.20 ms | 21.0 → 18.7 MB (21.0) | 1 |

- **No drift.** p95 in the last 30 s is no worse than in the first 30 s in every scenario.
- **No leak signal.** Heap moves in a GC sawtooth within a band; it is not monotonic.
- **No orphaned workers.** Exactly one matcher worker is alive throughout, including across 19 language switches.
- **The PSL 406 ms outlier.** It is one sample at t = 98 s, with a second at t = 284 s (130 ms). Paired 300 s PSL runs on this same machine, back to back, then gave 0 samples over 50 ms for both `main` (`0637237`, max 34 ms) and this branch (max 11.5 ms). The spike did not reproduce and is not attributed to the code. It is recorded, not explained away.

## Template transport, remaining cost (objective 09)

Medians of 7, with 300 / 150 / 30 personal examples: pack 15.7 / 7.8 / 1.5 ms, structured transfer ≤ 2.2 ms, unpack 19.1 / 7.8 / 1.8 ms. Forwarding the packed subset would remove about 30 ms at 300 examples, once per template change. That is below one 50 ms frame interval, and it would require another worker-bundle change and pilot cycle, so it was not done (NOT NEEDED).

## Low-throughput behaviour (objective 08)

See [low-throughput.md](low-throughput.md). At 250 ms rests, all six words are confirmed at 20 analysed fps, YES starts dropping at 13 fps, and most words drop at 5 fps and below. The headless rehearsal here ran at about 8–9.5 analysed fps.
