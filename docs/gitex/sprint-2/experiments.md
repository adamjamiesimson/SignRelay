# ASL rule experiments (Objectives 8–10), 21 October 2026

**Every experiment is OFF.** `lib/asl-starter-experiments.ts` is imported by no app code and not by the recognition worker. A test proves the committed worker bundle contains none of the experiment IDs, and that with no experiment enabled the analyzer returns exactly what production returns. The production worker (`ccce84c8…`), thresholds, two-evidence confirmation, arbitration and abstention are unchanged.

All numbers below are **synthetic kinematic fixtures through the real recognition worker**: [`experiments.json`](experiments.json), regenerated with `RUN_EXPERIMENTS=1 npx vitest run tests/asl-experiments.test.ts`. They are not recordings and not real-video evidence. They are also **in-sample**: the vetoes were designed after looking at the adversarial inventory they are scored on. They show what each switch does to the fixtures. They do not show that it helps real signers.

| Configuration | Positives (6 signs × 15 conditions) | Sparse YES (11 loss patterns × 3 rates) | Adversarial runs with a word (of 684) | Open-palm edge cases |
| --- | ---: | ---: | ---: | --- |
| baseline (production) | 90/90 | 29/36 | 280 (HELLO 144, THANK YOU 136) | THANK YOU after a partial arc abstains 36/36 |
| `hello-sideways-stroke` | 90/90 | 29/36 | 172 | unchanged |
| `thank-you-not-from-eyes` | 90/90 | 29/36 | 180 | unchanged |
| `thank-you-over-incomplete-please` | 90/90 | 29/36 | 280 | THANK YOU after a partial arc → THANK YOU 36/36; incomplete PLEASE + outward still abstains 36/36; PLEASE unchanged |
| `yes-gap-fill` | 90/90 | 31/36 | 280 | unchanged |
| all four | 90/90 | 31/36 | 72 (only hair-aside → HELLO, lowering from the mouth → THANK YOU) | as above |

## Objective 8: HELLO

**Real-video findings** (`docs/evaluation/asl-miss-diagnosis-2026-10-17.md`, worker `8a7d967e`; unchanged at `ccce84c8`): HELLO is correct on 1 of 3 inspected development clips.
- `gtsignstudy4a.8031`: 11 of 37 frames have a hand. One HELLO candidate appears, then no second one, because tracking ends at about 1.27 s.
- `4a.8006`: 12 of 35 frames have a hand. No starter candidate appears at all.

Neither miss is a wrong word. Both are limited by tracking and by the two-evidence requirement. Loosening the HELLO geometry would not address them, and lowering confirmation is not allowed.

**False-accept findings** (synthetic inventory): HELLO fires on four movements:
- an open hand rising from the chin toward the forehead (36/36);
- waving (36/36);
- blowing a kiss (24/36);
- tucking hair (12/36).

The production rule checks a raised open hand with sideways travel, but not the stroke's direction or how often it reverses.

**Experiment `hello-sideways-stroke`:** veto HELLO when the net wrist movement is mostly vertical, or when the stroke reverses three or more times (a wave). It removes all four of those patterns (108 runs) with no loss on the positive fixtures.

**Limits:**
- The synthetic HELLO positive is itself a sideways oscillation with two reversals, so the three-reversal limit sits just above it.
- A real salute is a single outward stroke from the brow. Its effect on real HELLO recall is unknown.
- Pushing hair aside from the forehead is geometrically the same as the salute and stays accepted.

## Objective 9: THANK YOU vs PLEASE

**Real-video findings:** THANK YOU is 0/3, and every miss is an abstention.
- 8031: only 134 ms of hand evidence.
- 7003: hands tracked for 0.23 s, and no rule matched.
- 8033: one PLEASE and one THANK YOU candidate at separate observations, plus four ambiguity analyses. The safeguard did its job: neither word was confirmed, and the earlier wrong PLEASE stays withheld.

**Experiment `thank-you-not-from-eyes`:** veto THANK YOU when the fingertips were above the nose before the hand's last pass by the mouth. It removes adjusting glasses, pushing glasses up and shielding the eyes (100 runs), with no positive loss. It needs the whole continuous stroke (up to 4 s).

A first version used the closest point to the mouth as the stroke's origin. It missed jittered and dropout runs, because the hand also passes the mouth on the way up. That bug was found and fixed during this sprint.

Lowering a hand from the mouth stays indistinguishable from THANK YOU.

**Experiment `thank-you-over-incomplete-please`:** when the only competing open-palm evidence is an *incomplete* PLEASE circle, emit the completed THANK YOU instead of abstaining.

On the targeted fixtures:
- it recovers THANK YOU after a partial chest arc (36/36);
- an incomplete PLEASE circle followed by an outward sweep still abstains (36/36);
- a completed PLEASE is unchanged.

It does not address 8033, where PLEASE was a complete candidate.

This experiment removes an abstention safeguard for one case. It must not be enabled without reviewed THANK YOU and PLEASE recordings.

## Objective 10: YES and sparse tracking

**Real-video finding:** the YES miss (`4a.8006`) had 5 of 31 frames with a hand, and never more than two consecutive. That is far sparser than any simulation here.

**Production under simulated loss:** YES confirms in 29 of 36 sparse runs. The 7 misses are concentrated at:
- every second frame lost (1 of 3 frame rates confirms);
- every third frame lost (2 of 3);
- 35–50% random loss.

**Experiment `yes-gap-fill`:** when no rule matches, interpolate gaps of up to two frames (≤200 ms) and accept only YES. It recovers 2 more runs (31/36) and adds no false accept on the 684 adversarial runs or the 90 positives. It never invents a hand after the newest observation or across a longer gap (tested).

It would not rescue `4a.8006`, whose tracking gaps exceed what the experiment fills.

## Recommendation

Keep all four experiments OFF for GITEX.

Enabling any of them requires a real-video comparison of a worker bundle with that experiment against the established baseline, judged with the Objective 14 gate (new wrong accepts, lost correct outcomes, changed abstentions). That comparison was not run: the dataset host is blocked in this sandbox, and the CI pilot only evaluates the committed worker. No accuracy improvement is claimed.
