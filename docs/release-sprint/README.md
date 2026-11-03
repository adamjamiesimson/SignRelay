# Release isolation, two-hand robustness and integration readiness

Follow-up to PR #52 (`a213be7`). Branch `claude/charming-thompson-2aql9w-release`.
Every result below says how it was obtained. "Synthetic" means generated
inputs, "licensed RGB" means real FSboard frames processed only on a CI
runner, and "local" means this container's headless Chromium. Nothing here
is a physical-webcam or independent-signer measurement.

## 1. P0: production release switch for fingerspelling

**Mechanism.** `NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING` (`on` | `off`) is resolved
once by `lib/release-flags.mjs` and inlined at build time by `next.config.ts`.

| Build | Default |
|---|---|
| `npm run build:firebase` (profile `full`, production) | **off** |
| `npm run build:asl-demo` | **off** |
| `npm run build:rehearsal` (automated research build) | on |
| Vercel preview (`VERCEL_ENV=preview`) | on |
| `next dev` | on |
| Explicit `NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=on|off` | overrides all of the above |

Any other value fails the build (`prepare-export.mjs` validates it as well).
The client cannot switch the mode on, because the value is a compile-time
constant and the gated branches are dead code in an `off` build.

**What `off` does**
- **Workspace:** the mode selector and spelling panel are not rendered. `changeAslMode("fingerspelling")` is a no-op. The CTC session effect returns before it loads anything. The camera tracker profile can never become `fingerspelling`, so the one-hand worker is never constructed.
- **Deep links:** the mode was never persisted or URL-addressable. `/?mode=fingerspelling#fingerspelling` is checked in the smoke test and is ignored. Onboarding and navigation never mentioned the mode.
- **Export:** `scripts/prune-research.mjs` removes the three FSboard ONNX models and the two fingerspelling workers from `out/`, and keeps the licence and accuracy notices. `scripts/verify-runtime.mjs` records `fingerspelling` in `runtime-manifest.json` and **fails** if an `off` export still ships any research asset.
- **Unchanged:** ASL word recognition, personal signs, every other language, explicit speech, models, branding and stored-data formats.

**Stored data.** No storage module (`browser-storage`, `calibration-storage`, `analytics-consent`, `personalized-recognition`) reads the flag, and the mode is never persisted. A unit test pins both facts. Toggling a build therefore cannot change what is stored or how it loads.

**Verification**

| Check | off | on |
|---|---|---|
| Unit tests (`tests/release-flags.test.ts`: resolver, wiring, gating, pruning, storage invariance) | 9/9 pass | 9/9 pass |
| `tests/release-flag-smoke.mjs` (local Chromium, fake camera, synthetic word fixture) | 3/3: selector absent, deep link ignored; HELLO confirms and the personal-sign panel is present; **no fingerspelling worker, model or worker-script request**; no external request | 3/3: selector shown; word recognition works; mode reachable and reversible |
| Existing smokes on the same export | gitex rehearsal, lifecycle stress, fault injection: all pass | `fingerspelling-browser-smoke` 8/8 |
| `asl-demo` export (flag off) | prune removed 5 paths; `demo:check` (deny-all proxy) passed, workers observed are only `recognition` and `vision`; `offline-vision-smoke` passed; `verify-runtime --profile asl-demo` passed | n/a |
| CI (`asl-demo.yml`) | rebuilds rehearsal with the flag off and runs the off smoke plus the gitex rehearsal | runs the on smoke after `fingerspelling-browser-smoke` |
| CI `firebase-build-check` | production `full` export with the default (off) | n/a |

**Known residue.** The `off` bundle still contains inert strings: the CTC model contract constants (URLs and hashes) and `LiveVision`'s `trackingProfile === "fingerspelling"` branch. Neither can execute when the profile is never set, and the smoke test proves no request or worker is created. Removing them would require code-splitting `LiveVision`. That is not worth the risk now.

## 2. P1: two-hand behaviour of the one-hand tracker

**How a hand is chosen today (code, not measurement).** The fingerspelling worker runs HandLandmarker with `numHands: 1`. `FingerspellingCapture` then takes the handedness label (Left or Right) that appears in more frames. In each frame it uses the **first hand carrying that label**. Nothing ties consecutive frames to the same person.

**Consequences**
- If a second person's same-label hand becomes that first match, the sequence switches hands silently.
- Mirrored and left-handed signing are handled only through the majority label.
- A handedness-label flip of the signer's own hand drops those frames from the dominant side.

**Study (licensed RGB, CI).** `scripts/diagnostics/two-hand-rgb.ts`, workflow `tracking-sprint-two-hand.yml`.
- **Scenes:** the 13 regression clips, each composited beside a **different real catalog signer**. Layouts:
  - `solo`: signer next to an empty half;
  - `distractor`: the second signer throughout;
  - `enters`: the second signer appears at the midpoint of the annotation;
  - `swapped`: the sides are exchanged.
- **Trackers:** the production one-hand landmarker (`landmarker:1`) and the two-hand fallback (`gesture:2`).
- **Measured:**
  - frames on the signer versus the distractor;
  - frames where capture's own rule selects the distractor;
  - selected-hand switches and signer label flips;
  - wrist jump in palm lengths, genuine versus at a switch;
  - the disabled detector's true and false flags;
  - the decoded outcome through production capture and CTC, compared with `solo`.

_CI results pending (run `tracking-sprint-two-hand`)._

**Policy.** `lib/hand-continuity.ts` detects discontinuities using capture's selection rule. A discontinuity is a wrist jump of more than 3 palm lengths or a palm-size ratio above 1.6 within 200 ms. The detector is unit-tested on synthetic hands. **It is OFF** (`HAND_CONTINUITY_GUARD_ENABLED = false`) and capture does not call it. Enabling it would change recognition policy: captures would be rejected. The composites measure behaviour on one dataset's signers, not on real two-person webcam scenes, so they are not adequate evidence for that change. The two-hand gesture tracker remains selectable through the worker's `init` message (`engine`, `numHands`) as the fallback.

## 3. P2: word-mode performance

Word mode keeps GestureRecognizer with `numHands: 2`. The `ILoveYou` canned gesture is consumed by the starter rules, and two-handed signs need both hands, so the one-hand shortcut was **not** applied.

**Instrumentation**
- `VisionEngine` now reports `face` and `pose` cost separately. These are additive timing fields.
- A **research-only** `alternate` auxiliary schedule runs face and pose on alternating turns, each part still refreshing about every 150 ms. Diagnostics can request it through the worker `init`. The app never sends it, so production behaviour is unchanged.

**Study (licensed RGB, CI).**
- **Script and workflow:** `scripts/diagnostics/word-mode-rgb.ts`, workflow `tracking-sprint-word-mode.yml`.
- **Input:** the production word-mode worker on CPU, lockstep at 30 Hz, 13 clips, 2 rounds in rotating order.

_CI results pending (run `tracking-sprint-word-mode`)._

**Local context (synthetic fake camera, no hands, local Chromium).** `demo:check` and `offline-vision-smoke` readouts on the `asl-demo` export:
- hands p50/p95 46–48 / 51–64 ms;
- auxiliary p95 61–65 ms;
- 11.0–11.7 frames analysed per second.

With no hands in view, palm detection runs every frame.

## 4. P3: integration readiness

**Ancestry, verified with `git merge-base --is-ancestor`, linear:**
- main ⊂ #43 ⊂ #44 ⊂ #45 ⊂ #46;
- then `claude/festive-dirac-pbwx2j`, which has 18 commits and **no PR of its own** but is #47's base;
- then #47 ⊂ #48 ⊂ #49 ⊂ #50 ⊂ #51 ⊂ #52 ⊂ this branch.

This branch is 221 commits ahead of main and 0 behind. The classification and the reasons not to cherry-pick are unchanged from `docs/tracking-sprint/README.md` §9. The release switch that plan required (step 2) now exists.

**Release-candidate branch.** `claude/charming-thompson-2aql9w-rc` points at this branch's reviewed head.
- Fingerspelling is **off** in its production (`full`) and `asl-demo` exports and on only in research builds.
- No PR into main is opened and nothing is merged or deployed.
- The owner's review of #44 (UI/product) remains the first gate.

**trajectory-v3 rollback compatibility (synthetic).** `scripts/diagnostics/rollback-template-compat.mjs` does the following:
1. Takes main's `lib/` via `git archive origin/main`.
2. Bundles main's `recognizePersonalTemplate` and the current matcher.
3. Saves templates exactly as the current workspace saves them (`normalization: "trajectory-v3"`), plus untagged legacy templates.
4. Matches synthetic query trajectories with both matchers.

| Templates | Matcher | Trials | Correct | Wrong | No match |
|---|---|---|---|---|---|
| trajectory-v3 (current save path) | main | 12 | 6 | 0 | 6 |
| trajectory-v3 | current | 12 | 6 | 0 | 6 |
| legacy (untagged) | main | 12 | 6 | 0 | 6 |
| legacy | current | 12 | 6 | 0 | 6 |

- `DB_VERSION` is 1 on both sides, and main's validator accepts v3 rows, so a rollback neither loses nor rejects saved signs.
- Main ignores the tag and matched these synthetic v3 templates identically.
- This is synthetic evidence only. Real users' saved signs were not available, so re-recording remains the safe advice if matching degrades after a rollback.

## 5. P4: verification

| Check | Result |
|---|---|
| `tsc --noEmit` | pass |
| `npm run lint` | pass. One existing warning: an unused import in `tests/capture-clock-rules.test.ts` |
| `vitest run` | 116 files; 1081 passed, 4 skipped |
| `repo:guard` | pass |
| `test:rendered` | pass |
| `audit:secrets` | pass, 0 findings |
| `audit:deps` | **fails, known external blocker, unchanged:** 16 moderate development-only `minimatch <11.0.1` (GHSA-g3hv-75wg-m249); 0 production. Not suppressed |
| PopSign word replay | still blocked by the certificate (exit 78); not bypassed |
| Release flag, both profiles | §1 |
| Two-hand and word-mode licensed RGB | §2, §3 (CI) |
| Worker lifecycle and cancellation | `lifecycle-stress-smoke` and `fault-injection-smoke` pass on the off export; `fingerspelling-browser-smoke` (camera lifecycle, mode isolation) passes on the on export |

**Security and privacy review of this change**
- **Flag cannot be forced on:** it is compile-time, so a URL or storage value cannot enable research code in production.
- **Pruning is narrow:** it deletes only an explicit allow-list of paths, keeps notices, and `verify-runtime` makes a stale research asset a build failure.
- **New workflows:** they have `contents: read`, `persist-credentials: false`, and run on licensed frames prepared with MD5/SHA verification. They upload only counts, timings and pipeline fingerprints. No frames, landmarks or decoded text leave the runner; decoded text is reduced to exact-match and edit counts.
- **Diagnostic servers:** they bind to 127.0.0.1 only.
- **No new dependencies, network calls, telemetry or recording uploads.** Firebase configuration was not touched and nothing was deployed.

## 6. Rollback

- **Release flag only:** revert `98d4675`. Fingerspelling is then visible in every build again, as in #52. Alternatively, keep the code and build with `NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=on`.
- **Word-mode instrumentation:** revert `f256bff`. The production schedule is unaffected either way.
- **Continuity detector and CI checks:** revert `2749941`. It is not wired into capture.
- **Whole sprint:** `git reset --hard a213be7` on this branch (PR #52's head), or close this PR.
- **After a future merge to main:** revert the merge commit, then redeploy the previous Firebase Hosting release (owner action). Stored data needs no migration in either direction (§4).

## 7. Next steps

- **Owner:** review #44, then decide whether the RC branch goes to a main PR.
- **Physical devices:** webcam and mobile smoke tests on the RC export with the flag off.
- **Real two-person recordings (consented):** needed before enabling the continuity guard. Its threshold should then be re-measured on them.
- **Independent signers:** still required for any fingerspelling or word accuracy claim.
