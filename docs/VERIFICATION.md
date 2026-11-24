# SignRelay GameShow initial release verification

## Browser and game logic

The release ran in desktop Chrome 158 on Windows. The automated suite covered the following scenarios.

- Eleven Node tests passed for scoring, streaks, deadlines, duplicate results, stale run IDs, same-name IDs, backup validation, leaderboard ties, sparse and empty tracking windows, and target-conditioned evidence.
- Chrome completed perfect and zero-point five-round games. It verified the three-sign streak, paused-round resume, recovery after refresh, finished-game retention, rank ties, backup and restore, and rapid switching. The leaderboard aggregation test handled 5,000 records.
- Chrome exercised actual fullscreen for the game and the leaderboard in a standalone test. The browser suite rendered 1280 × 720, 1366 × 768, 1920 × 1080, and 390 × 844. It simulated camera permission denial and stopped a fake camera track to verify recovery.
- A rapid lifecycle check ran 18 pause/resume cycles and three restarts in 7.6 seconds. It observed one live stream per round, no live stream while paused, and exactly two reused recognition workers. Chrome’s approximate UI JavaScript heap moved from 3.39 MB to 3.48 MB over this short run.
- A licensed, slowed SLEEP recording replayed through Chrome’s fake camera earned exactly one automatic 10-point award through the regular gameplay controls. The same file timed out against STOP. This test exercises the live browser scheduling and score path with prerecorded input.
- The deployment wrapper rejected the existing SignRelay site identifier before invoking Firebase.

## Offline

Chrome verified **33 cache assets** against the release manifest. The test reopened the same browser profile, turned Chrome’s network off, then stopped the local HTTP server. The game reloaded, opened its saved records, loaded both recognition workers, played a lesson, started fake-camera tracking, registered a new player, and switched participants. The suite observed zero third-party runtime requests and zero page exceptions. The prebuilt release can also start from its own disk files on a laptop that is already offline.

**Production runtime:** 00a370b8357984cf. See the booth steps for physical Wi-Fi disconnection, human signer checks, and the multi-hour soak on the intended laptop.

The final exhibition sprint has its own recognition and readiness evidence in **docs/READINESS.md**. The initial release metrics above serve as historical baselines.

