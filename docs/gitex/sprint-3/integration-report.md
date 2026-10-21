# Sprint 3 integration report, 21 October 2026

Integration branch `claude/peaceful-allen-21u61u`, pull request [#38](https://github.com/adamjamiesimson/SignRelay/pull/38) to `main`. The final readiness record for the merge candidate is `docs/gitex/sprint-3/final-<commit>.{json,md}`, written by `npm run readiness`.

## 1. Starting state (verified, not assumed)

- `origin/main` was `75d97f2` (25 Sept). It is a strict ancestor of the Sprint 2 tip `c99aebe` (`sprint/gitex-coding-hardening-2026-10-21`, PR #37), which was 154 commits ahead.
- Every PR from #21 to #37 was an open draft, stacked on the one before. None was merged.
- On #37 every check passed except **Strict dependency audit (release gate)**, which failed on the dev-only `braces` chain.

## 2. Dependency graph and dispositions

`main` → #21 → #23 → #24 → #25 → #26 → #27 → #28 → #29 → #30 → #31 → #33 → #34 → #35 → #36 → #37. (#22, #26 and #30 also target `main` directly. Each of their heads is an ancestor of the next PR in the chain.)

| Branch / PR | Relationship to the integration branch | Disposition |
| --- | --- | --- |
| #21–#37 and their branches, `feat/*` Figma branches, `fix/consolidate-reliability-ci`, `claude/eager-fermi-mbevgh`, `claude/funny-archimedes-rk1un6`, `firebase-hosting` | Ancestors of `c99aebe` (`git merge-base --is-ancestor`) | **Integrated with full ancestry** by fast-forwarding from `main` |
| #34 `feat/private-review-capture-2026-10-20` (3 commits not in the stack) | `git cherry`: all three patch-identical to stack commits | Included |
| #31 `fix/evaluation-signer-alias-2026-10-20` (1 commit not in the stack) | `git cherry`: patch-identical | Included |
| #18 `fix/security-audit-2026-10-11` | Next.js refresh | Superseded: Sprint 1 applied newer compatible versions (Next 16.4.2) |
| #19 `fix/audit-policy-dev-only-2026-10-12` | Proposed dev-advisory exception | Superseded: not imported; the advisory is now removed from the tree (section 3) |
| #20 `feature/asl-paired-confusion-report-2026-10-12` | Closed | Superseded by the #29 framework |
| #15 `improve/recognition-reliability-2026-09-28` | 2 commits, not ancestors | Superseded: per-language transcript preservation, transactional vocabulary writes and pinned, checksum-verified vision assets exist in reworked form (#22, #26, #27, Sprint 1) |
| #16 (closed), #17 `feature/video-eval-quality-gates-2026-10-09`, `feature/video-regression-evaluation`, `feature/recognition-hardening-2026-10-02`, `feature/pretrained-language-expansion` | Early-October video-evaluation line, not ancestors | Superseded by the frozen real-video pilot (#29 onward: `run-recognition-video-evaluation.mjs`, `verify-video-pilot.mjs`, baseline gate). Not merged: it would reintroduce a second evaluator and unreviewed gates |
| `research/*`, `feature/asl-*-benchmark*`, `feature/real-video-evaluation-2026-10-02` | One-off research workflows | Not integrated. Research records stay on their branches |
| `firebase-ci-base` | 1 commit (`firebase-pr-build.yml`) | Superseded by `firebase-build-check.yml` |

No branch was deleted. No history was rewritten.

## 3. Engineering completed this sprint

| Commit | Change |
| --- | --- |
| `85297b6` | **Strict dependency audit fixed.** The only `braces` route was `@next/eslint-plugin-next`'s single `fast-glob` `globSync` call. It now resolves to the reviewed in-repo `tooling/fast-glob-shim` (Node `fs.globSync`; throws on unimplemented options). Full `npm audit`: 5 high → 0. The gate is unchanged and no exception remains |
| `bf61b06` | **Objective 10.** Off-by-default `ConfirmedSignTailGuard` evaluated through the real worker. Reproduced the THANK YOU tail word (9/51) and found that a rule word can repeat from its own tail after an in-view pause. Both go to 0 in synthetic tests, with no sign lost ([tail-guard.md](tail-guard.md)) |
| `e91f1bb` | Speech stops on language change, Save & clear and Clear local data. Emptied edits remove the entry. Remove keeps focus and announces itself. Clear-data failures are reported. `?perf` gains recognition state, recovery count, hand-tracking share and a sustained under-10-fps warning |
| `d6bc618`, `f6d92b2` | **New CI workflow** for the offline ASL demo and rehearsal profiles: strict offline check plus leak self-test, rehearsal, transcript/a11y, lifecycle stress, fault injection |
| `949ee21` | `npm run eval:log`: operator log for live webcam trials. Validated rows are written atomically, results are git-ignored and guarded, and the summary keeps them apart from reviewed results |
| `c92cd6f` | PSL described as one-shot reference matching. Workspace heading says "Live sign recognition" |
| `add0ea5` | `demo:serve` banner printed `undefined` evidence counts; fixed and tested |

The production recognition worker is **unchanged** (`ccce84c8…`, the bundle the real-video evidence is recorded against). No thresholds, rules, confirmation or arbitration logic changed. No experiment is enabled.

## 4. Measurements (this container, not a demo device)

- Personal DTW, close-rival synthetic set, warm: 47 / 174 / 309 ms for 30 / 150 / 300 examples (old matcher 118 / 725 / 1492 ms). Decisions equal.
- Frame acknowledgement through real threads, isolated design: 80/80, 78/80 and 75/80 frames acknowledged at 30 / 150 / 300 examples, p95 2.4 / 2.2 / 1.5 ms. PSL with 775 references: 80/80, p95 1.9 ms.
- **Finding (P2, not fixed):** the first hand frame after templates are configured stalls the recognition thread for 13 / 170 / 407 ms at 30 / 150 / 300 examples. 300 templates are about 28 MB, and `structuredClone` of them takes about 330 ms here; the matching worker is created and sent the full set lazily on the first hand frame. Proposed fix: configure the matcher eagerly when templates arrive, and send compact typed arrays. This changes the worker bundle, so it needs the paired real-video pilot and a new `evaluated-runtimes.json` entry.

Node and headless-Chromium timings are not real-device performance.

## 5. Remaining work that needs people or hardware

See [real-world-test-checklist.md](real-world-test-checklist.md). All eight items are pending. The real-video evidence is still 11 previously inspected development clips (5 correct, 0 wrong, 6 no match), which is not an accuracy figure. The sealed holdout was not accessed.
