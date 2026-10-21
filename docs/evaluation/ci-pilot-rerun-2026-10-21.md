# Paired real-video pilot on the sprint candidate — 21 October 2026

GitHub Actions run https://github.com/adamjamiesimson/SignRelay/actions/runs/39557282103 (job `real-video-pilot`, conclusion success) on commit `9bd8594`. That commit's committed worker bundle is `ccce84c8…`, which includes the circle enclosed-area fix; a local `npm run build:worker` reproduces the same hash. The base is the frozen pre-PR28 worker. Clips are the same **11 previously inspected, publisher-labelled development recordings**; the sealed holdout was not used, and no no-sign or OOV trials exist.

| Trial | Expected | Hand frames | Candidate output | Same as worker `8a7d967e` (dashboard)? |
| --- | --- | ---: | --- | --- |
| hello-gtsignstudy4a.8031 | HELLO | 11/37 | no match | yes |
| hello-gtsignstudy4a.8033 | HELLO | 9/35 | HELLO | yes |
| please-gtsignstudy4a.8031 | PLEASE | 17/34 | PLEASE | yes |
| please-gtsignstudy4a.8033 | PLEASE | 45/46 | PLEASE | yes |
| thankyou-gtsignstudy4a.8033 | THANK YOU | 15/37 | no match (pre-PR28 base: wrong PLEASE) | yes |
| thankyou-gtsignstudy4a.8031 | THANK YOU | 4/31 | no match | yes |
| dev-thankyou-4a.7003 | THANK YOU | 6/30 | no match | yes |
| dev-please-4a.8017 | PLEASE | 15/47 | PLEASE | yes |
| dev-hello-4a.8006 | HELLO | 12/35 | no match | yes |
| dev-yes-4a.8006 | YES | 5/31 | no match | yes |
| dev-no-4a.8030 | NO | 11/51 | NO | yes |

**Candidate: 5 correct, 0 wrong accepted, 6 no-match, 0 errors of 11.** These are identical per-trial outcomes to the previous worker, so the circle-area fix (which removed a synthetic SORRY false accept) cost no real-video success. All 11 sessions were complete. This is not new or independent evidence, and it is not an accuracy figure.

An earlier run on this branch (https://github.com/adamjamiesimson/SignRelay/actions/runs/39556336628), with the single-hand label-continuity change, lost the correct HELLO on `hello-gtsignstudy4a.8033`. That change was reverted; see `handedness-audit-2026-10-14.md`.
