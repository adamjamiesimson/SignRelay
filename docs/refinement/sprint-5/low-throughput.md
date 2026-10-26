# Low-throughput word loss (Sprint 5, objective 08)

**Status: diagnosed. No recognition change.** Synthetic kinematics through the real recognition worker, rules only (the model abstains). These are not recordings, not an accuracy figure, and not a device measurement.

## Question

In Sprint 4, the rehearsal smoke's rapid six-word sequence (250 ms rests, hands lowered) lost THANK YOU in 1 of the first 4 runs on this container. Is the cause frame scheduling, segmentation, worker starvation or insufficient evidence?

## Method

`tests/asl-low-throughput.test.ts` replays the rehearsal harness's own sequence through `RehearsalScript`, exactly as the rehearsal build does: the latest due scripted frame is shown and held until the next is due. Frames are delivered at a fixed frame-loop interval with ±30 % jitter. Each run uses one seed; there are 5 seeds per rate. Every delivered frame is answered by the worker; there is no queue in this harness. Raw record: [low-throughput.json](low-throughput.json) (`RUN_LOW_THROUGHPUT_REPORT=1`).

## Result (250 ms rests; runs out of 5 in which each word was confirmed)

| Frame interval | Analysed fps | HELLO | THANK YOU | PLEASE | SORRY | YES | NO |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50 ms | 20 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| 75 ms | 13.3 | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 5/5 |
| 100 ms | 10 | 5/5 | 5/5 | 5/5 | 5/5 | 3/5 | 5/5 |
| 125 ms | 8 | 5/5 | 5/5 | 5/5 | 5/5 | 1/5 | 5/5 |
| 150 ms | 6.7 | 5/5 | 5/5 | 3/5 | 4/5 | 0/5 | 5/5 |
| 200 ms | 5 | 1/5 | 1/5 | 3/5 | 0/5 | 0/5 | 4/5 |
| 250 ms | 4 | 0/5 | 1/5 | 2/5 | 0/5 | 0/5 | 5/5 |
| 300 ms | 3.3 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 |

With 700 ms rests the picture is the same: at 8 fps and above every word is confirmed except YES; at 5 fps and below almost nothing is confirmed.

## Root cause

- **Not starvation.** Every frame delivered is analysed and answered.
- **Not segmentation and not ordering.** At every rate and seed the invariant holds: only intended words, in order, with no duplicate.
- **Insufficient sampled evidence.** In all 144 cases (8 rates × 3 seeds × 6 words) a word was lost **exactly** when no two consecutive analyses saw its completed stroke. The rules recognise a word only once its stroke completes, and with a 250 ms rest the hand leaves view soon after. At about 5 fps or less, the completion is often sampled once, so two-evidence confirmation never gets a second matching analysis. Whether that happens depends on where the samples fall, which is why it looked flaky.
- **The headless rehearsal on this container** analysed about 9.5 frames/s idle and 8.0 frames/s with four busy cores (`?perf`, averaged over the whole session). Its round-trip p95 rose from 26 ms to 275 ms under load. One stall of that size at a stroke's completion is enough to lose that word.

## Decision

- Thresholds, rules and two-evidence confirmation are unchanged; lowering the evidence requirement is not justified by synthetic data.
- The existing MAN-1 pre-flight (at least 10 frames analysed/s on the demo laptop) is the right mitigation. YES is the first word to go, at 8–13 fps.
- `transcript-a11y-smoke` now opens with `?perf` and quotes the throughput readout when the rapid sequence fails, so a slow environment can be told apart from a regression. The assertion itself is unchanged.
- The new test file keeps the invariant and the mechanism as regression checks.
