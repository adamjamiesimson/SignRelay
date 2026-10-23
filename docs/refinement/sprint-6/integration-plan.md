# Integration plan for PRs #39, #40 and the Sprint 6 PR (owner approval required)

Dry run only, 23 October 2026. Nothing was merged, rebased, force-pushed or deployed. Every step below is for the project owner to approve and carry out.

## State checked

| Ref | SHA | Base | State |
| --- | --- | --- | --- |
| `main` | `0637237` (Merge #38) | — | unchanged since Sprint 3 |
| PR #39 `sprint/refinement-reliability-2026-10-22` | `ed8f461` | `main` | draft, CI green (6/6 checks) |
| PR #40 `sprint/production-hardening-2026-10-22` | `c3b7fcf` | #39's branch | draft, CI green (7/7, pilot passed on its second attempt; see below) |
| Sprint 6 branch `claude/trusting-sagan-0uil0t` | see the PR | #40's branch | this sprint |

- **History is linear.** `main` is an ancestor of `ed8f461`, which is an ancestor of `c3b7fcf`, which is an ancestor of the Sprint 6 head. There are no merge commits inside the stack.
- **No conflicts.** `git merge-tree --write-tree` of `main` with `ed8f461` and with `c3b7fcf` both succeed. `main` + `c3b7fcf` produces tree `cf736f9`, identical to `c3b7fcf`'s own tree: the merge is a pure fast-forward of content.
- **Nothing from Sprint 4 was lost in Sprint 5.** Nine files changed in both sprints. Every Sprint 4 line that Sprint 5 removed was checked: the only ones are in `components/translator-experience.tsx` (the post-delete reload moved after the `try`, so a committed delete is reported as removed, E3) and refactors in two test files. All are deliberate.
- **Recognition bytes.** `main` ships recognition worker `ccce84c8…`. #39 changes it to `39a5f2c3…` (templates sent as one buffer; matcher started eagerly), which the paired CI pilot evaluated on #39 with all 11 established trials unchanged. #40 and Sprint 6 do not change worker bytes (`39a5f2c3…` still).
- **External CI failures, not code.** On #40 the pilot failed twice at `training/fetch_evaluation_clips.py` with `CERTIFICATE_VERIFY_FAILED` from `signdata.cc.gatech.edu`, before any trial ran. Attempt 2 on the same commit `c3b7fcf` passed with the gate reporting `ok: true`, no changes, worker `39a5f2c3…`. TLS verification was never weakened. The earlier RSL-host failures are handled by Sprint 5's retry, cache and exit-75 classification (E1); integrity failures still exit 65 and fail closed.

## What each PR changes (by area)

| Area | #39 | #40 | Sprint 6 |
| --- | --- | --- | --- |
| Recognition worker / matcher | `workers/*` (transport, eager matcher); bundle → `39a5f2c3` | none | none |
| App code | settings no longer overwritten on load; storage transactions; camera-start waits; About heading | storage/speech outcome messages; layout at 200 % text | ASL vocabulary search when more than 80 words are taught |
| Scripts / CI | readiness profile comparison | RSL retry/cache/classification; pilot triggers; branded-Chrome classification | `demo:serve` refuses an occupied port; `serve-export` fails cleanly |
| Dependencies | `vitest` 4.1.12 (advisories) | none | none |
| Tests | storage concurrency, template transport, first-frame stall | crash/backoff, rapid switching, low throughput, fault smoke | port tests, personal-vocabulary scale smoke |

## Risks to watch at integration

1. **Worker byte change in #39.** It is the only change that can move recognition outcomes. It is covered by the paired pilot; do not merge #39 without that check green on the merge commit.
2. **The pilot depends on an external host.** If its TLS chain breaks again, the pilot is red for a reason outside the code. Re-run once; do not cache participant clips or weaken TLS without a separate owner decision (see PR #40's comment).
3. **`main` is not protected** (issue #4 is open). Required checks are not enforced, so the owner must check CI by hand before each merge.
4. Old open PRs (#15, #17, #18, #19) predate #38 and target an older `main`. They are not part of this stack and should not be merged on top of it without their own review.

## Recommended sequence (reversible)

Record the rollback point first: `main` = `06372370ffc77ce0abf41bf259ae671f9697de51`.

1. **#39 into `main`.** Mark #39 ready, confirm all six checks are green on `ed8f461`, then merge with a **merge commit** (as #38 was), not squash or rebase, so the stacked branches above stay valid. After merging, confirm CI on `main` and that `npm run verify:runtime` reports worker `39a5f2c3…`.
2. **Retarget #40 to `main`.** GitHub does this automatically if #39's branch is deleted after merging; otherwise edit the base. Its diff against `main` is then exactly Sprint 5. Let CI re-run (all seven checks, including the pilot when its trigger paths apply), then merge with a merge commit.
3. **Retarget the Sprint 6 PR to `main`** the same way, wait for green CI, then merge with a merge commit.
4. After each merge: `git fetch && git log --oneline -3 origin/main`, and confirm the head's checks are green before the next step.

Alternative, one step: after reviewing all three, merge only the Sprint 6 PR retargeted to `main`; it carries every commit of #39 and #40. This is faster but gives one large merge commit and no green-CI checkpoint per sprint. The sequential route is recommended.

**Rollback.** Each step adds one merge commit. To undo step *n* without rewriting history: `git revert -m 1 <merge commit>` on a new branch, open a PR, and merge it after CI. Never reset or force-push `main`.

**Not part of this plan.** No deploy, Firebase/Vercel production change or release. Merging does not change the release decision, which stays **NO-GO** until the manual gates pass.
