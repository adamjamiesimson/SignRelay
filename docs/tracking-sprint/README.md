# Tracking throughput and temporal stability sprint

**Branch:** `claude/charming-thompson-2aql9w-tracking`, stacked on PR #51 (`7009705`). Nothing was merged into main and nothing was deployed to Firebase.

**Summary**
- The fingerspelling tracker spent most of each frame re-running MediaPipe palm detection, because it asked for two hands while signers use one.
- Tracking one hand with `HandLandmarker` (the same verified weights, sliced from the pinned bundle) halves tracking time: 71.6 → 35.0 ms median and 103.7 → 45.2 ms p95. That raises the share of frames inside the 15 Hz budget from 13.7 % to 95.4 %.
- On 13 licensed clips in lockstep, the tracked hand's landmarks and every decoded output are identical to production.
- The temporal-stability grid shows why this matters: two consecutive missed 15 Hz slots already trip the capture's 200 ms interruption gate (8 of 13 clips rejected).
- Word mode is unchanged: it keeps two hands, because word signs can be two-handed.

All evidence is headless Chromium on GitHub-hosted CPUs, using exposed regression recordings (FSboard, CC BY 4.0) or synthetic inputs. None of it is physical-webcam, GPU, mobile or independent-signer evidence.

## 1. Code changes

| File | Change |
|---|---|
| `workers/fingerspelling-vision.worker.ts` | The tracker is configurable at init (`engine`: `gesture` or `landmarker`; `numHands`: 1 or 2). It reports per-frame prep (draw and readback) and inference time, and echoes the applied configuration. **Default changed to `landmarker`, one hand.** Passing `{engine: "gesture", numHands: 2}` restores the previous behaviour. |
| `lib/task-bundle.ts` | A strict reader for stored zip entries. It follows the central directory, handles bytes prepended to the archive (the pinned bundle has two), and rejects compressed, duplicate, missing or truncated entries. |
| `lib/vision-runtime.mjs` | Pins the inner `hand_landmarker.task`: 7,819,105 bytes, SHA-256 `1c454b1f…ede1`. The worker checks the outer bundle's SHA-256 first, then the inner one. |
| tests | `task-bundle` (4 tests). `yes-window-experiment` (opt-in report). The schedule simulator moved to `tests/fixtures/capture-schedule.ts`; the clock report regenerates byte-identically. |
| diagnostics | `tracker-variants-rgb.ts`, `stability-grid-rgb.ts` and `heap-growth-browser.mjs`, plus CI workflows `tracking-sprint-{variants,stability,recorded}.yml`. Frames and landmarks never leave the runner. |

No model weight, threshold, decoder, vocabulary, feature extractor or stored-data format changed.

## 2. Where the tracking time went

Measured on licensed frames on the CI CPU, in lockstep on the production 15 Hz schedule. Run: [41437393954](https://github.com/adamjamiesimson/SignRelay/actions/runs/41437393954), 2,006 timed frames per variant.

| Variant | Total median / p95 | Prep | Inference | Frames within 66.7 ms | Landmarks vs production | Decoded output vs production |
|---|---|---|---|---|---|---|
| gesture, 2 hands (previous default) | 71.6 / 103.7 ms | 0.9 ms | 70.6 ms | 13.7 % | — | — |
| landmarker, 2 hands | 71.3 / 103.2 ms | 0.9 ms | 70.3 ms | 13.7 % | 1,042/1,042 identical | 13/13 identical |
| gesture, 1 hand | 35.2 / 54.5 ms | 0.9 ms | 34.3 ms | 95.3 % | 1,032/1,042 identical | 13/13 identical |
| **landmarker, 1 hand (new default)** | **35.0 / 45.2 ms** | 0.9 ms | 34.0 ms | **95.4 %** | 1,032/1,042 identical | 13/13 identical |

**What the numbers show**
- **Pixel prep and transfer are negligible:** prep is under 1 ms, and wall time exceeds tracking time by only about 0.3 ms.
- **The gesture classifier is cheap:** gesture and landmarker cost the same with two hands.
- **Palm detection is the cost.** MediaPipe's VIDEO mode runs it again on every frame while fewer than `numHands` hands are tracked. On hand-free frames it alone takes about 50 ms locally.
- **The 10 non-identical frames:** those are frames where the two-hand tracker also found a second hand. The tracked hand's landmarks were bit-identical (maximum delta 0), and no clip's decoded text changed.
- **Repeatability:** each variant is bit-identical when repeated.

**Not investigated further:** GPU delegate (the earlier sprints isolated fingerspelling on CPU after an RGB delegate mismatch), lower input resolution (it would change landmarks), and word mode's face/pose auxiliary models.

## 3. Temporal stability

Run: [41438404543](https://github.com/adamjamiesimson/SignRelay/actions/runs/41438404543). Each schedule perturbation was decoded through the production path, 13 clips per configuration. The three configurations (gesture/2, landmarker/2, landmarker/1) gave identical results in every cell except a 2-edit difference on the shifted schedule (25 vs 23).

| Schedule versus the production 15 Hz lattice | Same decoded output | Exact | Edits / 166 chars | Quality-rejected |
|---|---:|---:|---:|---:|
| Production lattice | 13/13 | 4 | 28 | 0 |
| Shifted by one source frame | 5/13 | 7 | 23 | 0 |
| 1 sample dropped | 9/13 | 6 | 27 | 0 |
| 2 consecutive dropped | 3/13 | 1 | 122 | **8** |
| 3 consecutive dropped | 0/13 | 0 | 166 | **13** |
| 10 % random drops | 1/13 | 1 | 133 | **9** |
| 25 % random drops | 0/13 | 0 | 166 | **13** |
| 200 ms with the hand hidden | 7/13 | 4 | 33 | 1 |
| Movement 1.25× faster | 9/13 | 6 | 25 | 0 |
| Movement 0.8× slower | 6/13 | 5 | 27 | 0 |

**What the grid shows**
- **Decoded text is sensitive to which frames are tracked.** Even a one-frame offset changes it in 8 of 13 clips. "Same output" therefore means stable, not correct: the shifted lattice happened to decode more exact names (7 vs 4).
- **Missed slots cause rejections.** Two consecutive missed slots make an interval of about 200 ms or more, which the capture rejects as an interruption. Random drops of 10 % or more reject most captures.
- **No mitigation is evidenced besides fewer drops.** With these sensitivities no other data-side mitigation is supported. Interpolating landmarks is excluded by policy, and loosening the interruption gate would accept degraded sequences.
- **The lever is throughput.** Not missing slots at all is what matters, which is what the one-hand tracker achieves (95.4 % of frames within budget, versus 13.7 %).

## 4. Recorded RGB: PR #51 versus this branch

Run: [41486952367](https://github.com/adamjamiesimson/SignRelay/actions/runs/41486952367). The established same-runner driver alternated the PR #51 head (`7009705`) and this branch (`b8996a6`) per case, with byte-identical verified inputs. The only production difference is the fingerspelling tracker configuration. Every predetermined case completed in both builds, with 0 technical failures. The summary was produced in CI: identifier- and text-free, with the 18 ledger SHA-256s in the job log.

| Catalog | Metric | PR #51 | This branch |
|---|---|---:|---:|
| 10 positive × 3 | exact | 12/30 | 12/30 |
| | CER (edits / 384 chars) | 70 = 18.23 % | 72 = 18.75 % |
| | same text in all 3 repeats | 9/10 | **10/10** |
| | Finish → candidate, median / p95 | 38.6 / 132.2 ms | 37.3 / **80.8** ms |
| | tracking per frame, median / p95 of captures | 41.9 / 60.1 ms | **20.2 / 33.9** ms |
| | observed capture rate, 10th percentile | 13.3 Hz | **15.0 Hz** |
| 29 ordinary-action windows × 2 | false candidates | 5/58 | 4/58 |
| | abstentions (quality / model) | 53 (47 / 6) | 54 (48 / 6) |
| | same outcome in both repeats | 26/29 | **29/29** |
| | Finish → candidate, median / p95 | 145.2 / 197.2 ms | **57.6 / 61.1** ms |
| | tracking per frame, median / p95 of captures | 68.1 / 105 ms | **35.7 / 72.9** ms |
| | max frame gap, median | 133.4 ms | **66.7 ms** |
| Q/J/Z and returned-Left, original × 2 | exact / edits (132 chars) | 6/10 / 10 | 6/10 / 10 |
| Q/J/Z and returned-Left, mirrored × 2 | exact / edits | 6/10 / 5 | 4/10 / 6 |
| | tracking per frame, median | 72.5 ms | **35.7 ms** |

**Paired positive and rare captures, candidate versus PR #51 edits:** 1 fewer, 3 more and 46 the same. A sign test gives p ≈ 0.63, so this is not significant. The mirrored 6 → 4 exact sits within the run-to-run range recorded for that catalog in PR #51 (11–13 of 30 over six repeats). No accuracy improvement or regression is established.

**What did improve, measurably:**
- **Tracking time:** roughly halved.
- **Capture rate:** the 10th-percentile observed rate reaches the 15 Hz target in every catalog.
- **Frame gaps:** the median maximum gap halves.
- **Latency:** Finish-to-candidate p95 latency falls by 39–69 %.
- **Repeat consistency:** 9 → 10 of 10 positive, 26 → 29 of 29 ordinary-action and 4 → 5 of 5 mirrored rare cases now give the same outcome in every repeat.
- **Remaining divergence:** repeats still diverge at the `schedule` stage, because the fake camera's own frame timing varies. The tracker now keeps up with the camera instead of skipping its frames.

## 5. Dynamic word signs: YES, THANK YOU, SORRY

**Production unchanged.**
- `tests/yes-window-experiment.test.ts` (opt-in) builds the real recognition worker with only the YES stable-ending literal rewritten. It replays the same synthetic schedules under the pick-up clock and the capture-time clock (128 sequences each) and 132 synthetic everyday-movement cases.

| Stable-ending window | YES confirmations, pick-up / capture | All confirmations | Runs differing between clocks | Synthetic negatives triggered |
|---|---|---|---|---|
| 75 ms (production) | 51 / 43 | 603 / 594 | 10 | 43 / 43 |
| 67 ms | 54 / 43 | 606 / 594 | 13 | 43 / 43 |
| 60 ms | 60 / 59 | 612 / 610 | 3 | 43 / 43 |
| 50 ms | 60 / 59 | 612 / 610 | 3 | 43 / 43 |

**Scratch check of the 60 ms window.** With the window at 60 ms (scratch edit, restored), all 346 tests in the 23 ASL rule and arbitration suites still pass. These include adversarial inventory, negative controls and fist discrimination.

**Why the default stays at 75 ms**
- This is synthetic evidence only.
- Recorded word signs remain blocked: PopSign's publisher certificate fails, with exit 78 in CI.
- The 43 synthetic negative triggers are the pre-existing HELLO and THANK YOU rule false positives, unchanged by any window.

**THANK YOU and SORRY.** Nothing new can be established without recorded or real signers.

## 6. Memory and lifecycle

`heap-growth-browser.mjs` takes forced-GC heap snapshots of the main thread across 3 × 20 Start/Finish captures.

| Run | Main-thread heap | Growth by type |
|---|---|---|
| Captures | 8.03 → 8.30 MB | `(code)` +257 KB; no application object type grows |
| Control (identical CDP polling, no captures) | 7.94 → 8.15 MB | `(code)` +209 KB |

The earlier "slow growth during repeated captures" is therefore almost entirely **V8 compiled code created by the test harness's own `evaluate` calls**. The capture-specific remainder is about 48 KB of code over 60 cycles, from JIT tier-up, with no retained application objects.

Earlier soaks are unchanged: 10-minute and 5-minute capture soaks showed no unclosed `VideoFrame` or `ImageBitmap` handles, and baseline and candidate heaps were equivalent.

**Not measured:** worker heaps, MediaPipe/ONNX WASM memory, GPU memory, multi-hour sessions and mobile.

## 7. Tests and CI

**Local**
- **Unit (vitest):** 1,066 passed, 0 failed, 4 skipped (112+ files). The skips are opt-in report writers; both new ones were executed separately.
- **Static checks:** typecheck, lint and the rehearsal export build pass.
- **Browser smokes on the new default:** fingerspelling (mode isolation, confirmation, camera lifecycle, privacy), lifecycle stress, fault injection and the rehearsal smoke all pass.

**CI**
- **Studies (all succeeded):** [variants](https://github.com/adamjamiesimson/SignRelay/actions/runs/41437393954), [stability grid](https://github.com/adamjamiesimson/SignRelay/actions/runs/41438404543), [recorded RGB](https://github.com/adamjamiesimson/SignRelay/actions/runs/41486952367).
- **Repository CI:** runs on the draft PR. It is expected to fail only at the unchanged dependency-audit gate (§8).

## 8. Security

Unchanged. There are 16 moderate development-only advisories, all from `minimatch <11.0.1` (GHSA-g3hv-75wg-m249), with no compatible upstream line: eslint 10.x still requires `^10.2.6`, and the import/react/jsx-a11y plugins require `^3.1.2`. Production has 0 advisories.

PopSign still fails trust with exit 78; publisher reissuance is required.

Nothing was suppressed, overridden or bypassed. No new asset or network source was added: the landmarker comes from the already pinned bundle.

## 9. Integration plan for PRs #43–#51

**Verified ancestry (linear):**

main `e63fffe` ⊂ #43 `06316aa` ⊂ #44 `fc95a6f` (contains Sprints 4–7, PRs #39–#42) ⊂ #45 `e0b1f35` ⊂ #46 `6eb9c64` ⊂ `claude/festive-dirac-pbwx2j` `996b0d2` (no PR; #47's base) ⊂ #47 `fa97370` ⊂ #48 `d89cff6` ⊂ #49 `116fe68` ⊂ #50 `d8cfefc` ⊂ #51 `7009705` ⊂ this branch.

| Class | Contents |
|---|---|
| Stable engineering, measured, behaviour-preserving | #43 worker tracking, bounded queues and trajectory handling; #45 ASL-2000 and starter-rule speedups (exact outputs preserved); #46 tracking-failure invalidation, stale-overlay cleanup and cooperative scheduling; #47 safer acquisition and logo colour restoration; #50 capture ownership and watchdog races, DTW speedup and idle worker reuse; #51 diagnostics (fingerprints, replay) |
| Product/UI change needing owner sign-off | #44 (Sprints 4–7 redesign, tour, privacy update, CI repair) |
| Research-only; keep labelled as research | ASL-2000 and other language models (already "Research preview"); **the whole fingerspelling mode (#48, #49, the #51 capture fix and this sprint's tracker change)**; the word-mode capture clock (opt-in); the YES window (experiment only) |
| Security-blocked | PopSign word replay; the full CI dependency gate (development only) |
| Needs physical devices | tracking throughput on real webcams, mobile and GPU; fingerspelling end to end; multi-hour memory |
| Needs independent signers | every accuracy claim; fingerspelling; YES/THANK YOU/SORRY policy; OOV and intent rejection |

**Why not cherry-pick.** The stable fixes and the research features share files throughout #48–#51, especially `lib/live-vision.ts` and `components/translator-experience.tsx`. Cherry-picking only the engineering fixes would mean re-implementing them against main's older code, which would invalidate the evidence gathered on the stack.

**Recommended path**
1. **Owner review of #44 first.** It is the largest product change and defines the UI everything else builds on.
2. **Create a release branch from the reviewed stack head.** Add one build-time switch, for example `NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING`, that hides the fingerspelling mode selector. It should be **off for the production `full` profile** and on for research and rehearsal builds. Today the mode is always visible for ASL, so without this switch, merging would publish research fingerspelling.
3. **Verify before merging.** Run full CI, the Firebase build check (it builds and verifies every model asset) and the owner's physical-device smoke test on the release branch.
4. **Merge to main with a merge commit**, preserving the evidence history, only after the owner approves. Deploy to Firebase only on a separate owner approval. Then close the stacked PRs as superseded.
5. **Rollback:** revert the merge commit on main, and redeploy the previous Firebase release (Firebase Hosting keeps prior versions).
   - **Stored data:** PR #43 added a `trajectory-v3` tag to newly saved personal signs. Older code does not read that tag, so before any rollback that spans #43, review whether examples saved by the newer build would be misread. Users may need to re-record those signs.

## 10. Rollback for this sprint

- **Tracker default only:** in `workers/fingerspelling-vision.worker.ts`, set `DEFAULT_TRACKER` back to `{engine: "gesture", numHands: 2}`, or revert commit `b8996a6`. Then run `npm run build:worker`.
- **Whole sprint:** reset the branch to PR #51 (`7009705`).
- **Untouched:** stored data, models, branding and Firebase.

## 11. Next priorities

**Can be done autonomously**
- Add the fingerspelling release switch from §9.
- Add a word-mode throughput study. Word mode needs two hands, so the budget there comes from scheduling and the auxiliary face/pose models.
- Investigate GPU-delegate parity on licensed frames.
- Re-run the recorded-RGB matrix on more repeats.

**Needs people or devices**
- Physical webcams, mobile devices and GPUs, to confirm the throughput gain end to end.
- Independent signers for fingerspelling accuracy and for the YES window.
- Reviewed negative and OOV data.
- PopSign certificate reissuance, to unblock word-sign replay.
