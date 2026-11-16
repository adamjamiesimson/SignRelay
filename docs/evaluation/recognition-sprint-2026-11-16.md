# Recognition sprint, 16 November 2026

Branch `claude/gracious-curie-mv9zx5`, draft pull request #61 against `main`. Nothing is merged or deployed. Every number below says where it comes from: **code** (unit tests and synthetic fixtures), **video** (recorded clips replayed in CI) or **device** (a real camera). There are no device measurements in this sprint.

## 1. What the earlier draft pull requests already established

`main` is `e63fffe` (October). Pull requests #43–#60 are unmerged drafts; #44→#60 is one stack, 246 commits and about 312,000 added lines ahead of `main`. Recognition-related content, and what this branch does with it:

| PR | Recognition-related change | Evidence there | On this branch |
| --- | --- | --- | --- |
| #43 | Tracking in a dedicated worker; capture interval 50→33 ms; 4.5 s time-based buffer; `trajectory-v3` personal templates | No-hand benchmark only: capture-to-draw 121→74 ms median. No signing evidence | Not ported. Architecture change with no recognition evidence; the 33 ms interval is a candidate for the tracker-variant replay |
| #44–#46 | Tracking-failure invalidation, exact DTW pruning, cooperative inference yields | Real-video pilot on 11 Nov: 5 correct, 0 wrong, 6 abstained, identical to `main` | Not ported: no recognition outcome changes |
| #46 follow-up ("Sprint 8") | **ASL-2000 input repair** (`lib/tgcn-input.ts`): hands were erased before reaching the model; publisher time base; nearest-wrist hand slots; training framing; evidence guard | Video, publisher data in CI: shipped adapter 0.0% top-1 on publisher keypoints vs 22.4% for the publisher protocol; on the same videos through MediaPipe 0.7% → 9.9%. About 13% of accepted words right on MediaPipe input, at every threshold | **Ported** with its tests |
| #54 | Research-model words become suggestions a person must add | Follows from the 13% figure | **Ported in minimal form** for ASL (one suggestion card) |
| #55–#56 | Starter-rule refinements evaluated on 176 WLASL clips | Video: rules recalled 16/27 targets and produced wrong words on 30/149 other-sign clips. Refinements removed 8 of 12 false THANK YOU words but also the only correct one; none adopted | Not ported (nothing was adopted there) |
| #57–#58 | Discontinuity resets (pause, backward clock), malformed-frame rejection | Code: three regressions | Not ported in this sprint; compatible, worth a follow-up |
| #59 | Split hand/auxiliary tracking lanes; articulated temporal DTW | Video (FSboard, WLASL): more frames delivered, but unsupported starter output on 15/26 vs 14/26 clip-runs; kept experimental there | Not ported |
| #60 | Bounded recovery, CPU-first demo start | Video: 120 exposed WLASL clips, 25 automatic starter words on 22 clips, **none matching**; 3 model suggestions, none matching | Not ported |

## 2. Baseline (`main`), by stage

| Stage | Result | Kind |
| --- | --- | --- |
| Hand detection coverage | 150 of 414 frames on the 11 development clips; 4–17 hand frames per clip except one | video |
| Segmentation | 0 `ready` analyses on all 11 clips, including the 5 that are recognised | video |
| Research-model invocations | 0 on all 11 clips | video |
| Research-model input | Both hands erased on every frame (MediaPipe reports `visibility: 0` for hand points and the adapter read that as "missing") | code + video (Sprint 8) |
| Starter rules | 5 correct, 0 wrong, 6 abstained on the 11 clips; 16/27 recall and 30/149 wrong on WLASL clips | video |
| Everyday movements | 280 of 684 synthetic runs produce HELLO or THANK YOU | code |
| Live camera, new signers | not measured | — |

First observable failure per abstaining clip (unchanged from the October diagnosis): too few hand frames for any path (THANK YOU 8031: 4; YES 8006: 5; THANK YOU 7003: 6), tracking ends as the stroke completes so the second observation never arrives (HELLO 8031), no rule proposal with tracking present (HELLO 8006), and competing PLEASE/THANK YOU proposals (THANK YOU 8033).

## 3. Root causes: established and not

Established:

1. **The research model never saw a hand** (`main`). Repaired here by the ported input builder.
2. **The research model is not reliable even with correct input**: about 13% of the words it accepts from MediaPipe landmarks are right. Its words are now suggestions and never enter the transcript by themselves.
3. **The movement gate could not finish a sign that ends by the hand leaving the view.** It required the hand to be still and visible for 140 ms after the movement. Repaired here (section 4).
4. **Region tracking drops frames under fast motion** in the pinned MediaPipe runtime (probe). Not the cause of low coverage on the development clips: the repair recovered 1 frame in 194 there and produced a new wrong word, so it is not adopted ([details](hand-reacquisition-2026-11-16.md)).

Not established:

- Why the tracker reports a hand in only about a third of development-clip frames.
- Whether any tracker setting improves that without adding wrong words (the pilot now measures variants on the same clips).
- Any effect of this sprint on real signers or real cameras.

## 4. Changes in this sprint

| Change | Files | Evidence |
| --- | --- | --- |
| ASL-2000 input repair (ported) | `lib/tgcn-input.ts`, `lib/asl1000-runtime.ts` | code: `tests/asl2000-input.test.ts`, `tests/asl2000-evidence-guard.test.ts`; video: Sprint 8 runs in the #46 stack |
| ASL research-model words are suggestions | `workers/recognition.worker.ts`, `lib/model-output-policy.ts`, `lib/recognition-session.ts`, `components/translator-experience.tsx` | code: worker tests assert `suggested`, never `confirmed` |
| Completion by leaving the view, with reason codes | `lib/sign-motion.ts`, worker | code: `tests/asl-departure-segmentation.test.ts` (13 cases) |
| Tracker options for evaluation only; production tracker unchanged | `lib/vision-engine.ts` | code: `tests/vision-engine.test.ts` |
| Real-video tracker-variant and segmentation diagnostics (not gated) | `scripts/diagnostics/recognition-lab.ts`, `scripts/run-recognition-video-evaluation.mjs`, `scripts/diagnostics/summarize-replays.mjs`, `.github/workflows/asl-video-pilot.yml` | runs on every pilot |
| Dev-only dependency advisories (vitest, zod, minimatch) | `package.json`, `package-lock.json` | `npm run audit:deps` ok, no exception added |

Segmentation rules for a movement that ends by leaving: the hand must be absent for at least 250 ms (one missed frame is not leaving) and at most 2.5 s; the frames before it must pass the same movement, length and continuity checks as a rested movement; only observed frames are returned; the model is asked once if it declines (the frames cannot change); and after any reported word, a departure-ended movement counts only if it began at least 600 ms after that word or after the hand left and came back. Sign-rule and personal-sign paths are unchanged.

## 5. Real-video results on the 11 development clips

[Pilot run 43882596879](https://github.com/adamjamiesimson/SignRelay/actions/runs/43882596879), commit `0aaf6ae`, worker `4d716f2a…`. These clips were inspected before; none of this is an accuracy estimate. "Accepted" means a word reached the transcript. Suggestions are listed apart and never count as correct.

**Gated comparison (shipped tracker, 20 analysed frames per second).** Exact-baseline gate: ok, 0 changes.

| Worker | Correct | Wrong | Abstained | Hand frames | Clips with a `ready` segment | Model suggestions (matching) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `main` (`ccce84c8`, established baseline) | 5 | 0 | 6 | 150/414 | 0 | none possible |
| This branch (`4d716f2a`) | 5 | 0 | 6 | 150/414 | 5, all by departure | 1 (0): `HIS` on a HELLO clip |

So the segmentation repair does what it was built for (segments now exist on 5 of 11 clips, including three that abstain), no transcript outcome changed, and the one word the research model offered was wrong, which is why it is a suggestion.

**Diagnostics, not gated: same worker, one tracker or cadence setting changed.**

| Variant | Correct | Wrong | Abstained | Hand frames | Note |
| --- | ---: | ---: | ---: | ---: | --- |
| Same-frame reacquisition | 4 | 1 | 6 | 155/414 | PLEASE 8017 becomes THANK YOU + PLEASE. Not adopted |
| Palm detection 0.3 | 6 | 0 | 5 | 154/414 | THANK YOU 8031 recognised (4→7 hand frames); nothing lost |
| Detection, presence and tracking 0.3 | 5 | 0 | 6 | 159/414 | Gains THANK YOU 8031, loses HELLO 8033 |
| All 0.3 plus reacquisition | 5 | 0 | 6 | 166/414 | Same trade |
| 15 analysed frames per second (what the app gives a 30 fps camera today) | 3 | 0 | 8 | 109/314 | Loses HELLO 8033, PLEASE 8017 and NO; gains THANK YOU 8033 |
| Every source frame (30 per second) | 5 | 1 | 5 | 231/611 | THANK YOU 8033 becomes PLEASE |

Reading this honestly: single clips flip in every variant, so eleven clips cannot choose a setting. Two things are worth a larger sample: the app's real cadence looks worse than the protocol every recorded result used, and a lower palm-detection threshold is the only variant that gained without losing. Both go through the larger PopSign replay (`.github/workflows/asl-popsign-exploration.yml`) before anything changes in the app. YES stays unrecognised in every variant (5–11 hand frames).

## 6. Larger development replay: 79 PopSign game/test clips

[Run 43890510743](https://github.com/adamjamiesimson/SignRelay/actions/runs/43890510743), commit `588a754`. A predetermined sample (`training/build_popsign_exploration.py`): eight signers for each of HELLO, THANK YOU, PLEASE, YES and NO (40 clips; PopSign has no SORRY) and 39 clips of twenty other signs, replayed through the production browser pipeline. Publisher labels, no fluent review, phone recordings; now exposed development clips. Sealed-holdout signers and clips were never requested. This is the first sample large enough to describe the rules, and it is still not a live-camera result.

| Replay | Correct of 40 target clips | Clips with a wrong word (of 79) | On the 39 other-sign clips | Clips with a ready segment | Model suggestions (matching) |
| --- | ---: | ---: | --- | ---: | ---: |
| `main` worker, 20 frames/s | 15 | 15 | 9 wrong: THANK YOU 7, HELLO 2, NO 1 | 10 | none possible |
| This branch (`588a754`), 20 frames/s | 15 | 14 | 9 wrong, same words | 39 | 2 (0) |
| This branch at 15 frames/s (the old live cadence) | 11 | 16 | 11 wrong | 39 | 2 (0) |
| This branch at 30 frames/s | 15 | 20 | 12 wrong, PLEASE and SORRY appear | 40 | 4 (0) |
| This branch, palm detection 0.3 | 15 | 13 | 9 wrong | 39 | 4 (1) |

Per sign, this branch at 20 frames/s: HELLO 2/8, THANK YOU 3/8, PLEASE 5/8, YES 0/8, NO 5/8. THANK YOU was also produced on 10 clips of other signs.

What this decides:

- **Frame cadence.** 20 analysed frames per second beats the 15 the app was really delivering (15 vs 11 correct, 14 vs 16 wrong) and beats every frame (same correct, 6 more wrong). The 45 ms gate stays.
- **Palm-detection threshold.** 13 more hand frames in 3,346 and no change in correct clips. Not adopted.
- **The research model** made 2–4 suggestions and at most one matched its clip. It stays a suggestion.
- **The rules are the problem.** About half of the words they put in the transcript are wrong on this sample (15 right, 14–15 wrong). THANK YOU is the worst (3 right, 11 wrong) and YES is never recognised.

## 7. THANK YOU handshape requirement (in progress)

Hypothesis, stated before measuring: the wrong THANK YOU words come from other signs made at the face with other handshapes, and THANK YOU itself is a flat hand (four extended fingers held together). The rule now requires a flat hand on at least 60% of observations (`flatHand` in `lib/asl-starter-recognition.ts`). Synthetic regressions are unchanged because their open hand is flat. It is measured first on the 79 clips above and, if it holds, confirmed on a second, disjoint sample fetched only after the rule is frozen.

## 8. What still needs a person

See [the webcam protocol](webcam-validation-protocol-2026-11-16.md). All earlier manual gates in `docs/gitex/sprint-3/real-world-test-checklist.md` remain pending.
