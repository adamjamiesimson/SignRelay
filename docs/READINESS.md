# SignRelay GameShow exhibition readiness

Kiosk build **f7f9531a61d13c30** keeps the existing wheel, ten lessons, five-round format and host workflow. Changes are confined to the standalone GameShow source.

## Recognition changes

At 5 analyzed frames per second, a 205 ms polling interval used every second frame. The 510 ms minimum span also required four observed frames at that cadence. The sparse path now checks each fresh tracking frame and can use three observations over at least 320 ms. It retains palm-relative movement and continuity checks and requires two qualifying scores at least 125 ms apart. The standard camera cadence keeps its existing temporal requirements.

Live inference keeps one request in flight, then processes the newest available frame. Equivalent windows are scored once. The classifier stops after a window passes the active target cutoff. Adjusting sensitivity clears pending confirmation. The overlay uses resize notifications and paints on animation frames after recognition is scheduled. Turning it off also avoids transferring overlay coordinates. The upstream model weights and preprocessing remain pinned.

The global default remains **Relaxed 0.60**. Two trial sign cutoffs of 0.55 for DRINK and WHO were selected using calibration clips only. They added two calibration accepts and zero fresh 5 fps held-out accepts, so they remain out of the release.

## Replay evidence

The sprint collected 74 additional public PopSign recordings. The validation set combined 20 earlier calibration positives with 32 new recordings, yielding 40 positives and 12 other-sign clips. The new, frozen test set used 30 positives and 12 other-sign clips with publisher signer IDs disjoint from calibration. The original test clips were rerun separately for regression. Baseline and candidate received the same tracked frames in each comparison. [PopSign ASL v2.1 and licence](https://signdata.cc.gatech.edu/view/datasets/popsign_v2_1/index.html)

| Replay | Earlier schedule | Final schedule | False accepts, earlier → final |
|---|---:|---:|---:|
| Calibration at 5 fps | 14/40 | 20/40 | 0/480 → 0/480 |
| New held-out clips at 5 fps | 12/30 | 20/30 | 0/390 → 0/390 |
| Original test clips at 5 fps | 17/30 | 21/30 | 0/360 → 0/360 |
| New held-out clips at 15 fps | 24/30 | 24/30 | 0/390 → 0/390 |
| New frame-scrambled clips at 5 fps | — | — | 4/100 → 4/100 |

The median accept time on the new 5 fps set was **2.00 → 1.40 seconds** from clip start. Empty frames produced zero accepts. The scrambled clips retained frames from their matching sign. Both schedules falsely accepted the same four cases. The source includes the individual comparisons.

| Sign | New 5 fps, earlier → final | New 15 fps, final | Original 5 fps, final |
|---|---:|---:|---:|
| PLEASE | 3 → 3 | 3 | 2 |
| DRINK | 1 → 2 | 3 | 2 |
| DRAW | 1 → 2 | 2 | 3 |
| JUMP | 0 → 2 | 2 | 1 |
| GREEN | 1 → 2 | 2 | 2 |
| STOP | 1 → 1 | 2 | 1 |
| SLEEP | 1 → 3 | 3 | 3 |
| WHO | 1 → 1 | 2 | 2 |
| ROCK | 1 → 2 | 2 | 2 |
| PENCIL | 2 → 2 | 3 | 3 |

Each column contains accepted results out of three clips per sign.

The 5 fps comparison processed 177 baseline versus 456 candidate model windows. Median batch time was 76 versus 78 ms, p95 was 263 versus 244 ms, and total worker time was 6.63 versus 19.48 seconds. At 15 fps, identical coverage used **520 → 459 windows** and **17.05 → 14.80 seconds** of worker time. The replay checks all ten targets and every eligible window. Live inference verifies one target, uses a threshold-based early exit and bounds work to one in-flight batch. These measurements came from a single Windows Chrome host with other verification work running.

## Automated load and booth performance

- **13 logic tests passed**, including the deadline-switch race. Chrome verified discreet host controls, sensitivity changes, ranks, pause/resume, skipped rounds, camera recovery, JSON/CSV and fullscreen.
- **120 simulated players** completed 600 rounds through Chrome’s IndexedDB. The run verified 150 resumes, rejected 300 stale callbacks, and resolved 600 two-connection result races with one score per round. All 120 records and leaderboard entries survived restore and reload.
- **Storage cost.** 2,912 measured transactions had median 1.9 ms and p95 3.9 ms. First-quarter versus final-quarter p95 was 2.6 versus 4.6 ms as the session filled. Chrome used 14.71 CPU-seconds in 9.90 seconds of wall time. Page JS heap after collection was 1.14 MB before and 1.51 MB after.
- **Motion and sound.** The wheel spun at 60 animation callbacks per second with a 17 ms maximum gap in the main run. The sound probe saw 106 starts, 106 stops and 106 completion events.
- **Camera and workers.** On Windows with Chrome 158 and an Intel Core i7-10510U, the primary prerecorded run measured 3.85 analyzed fps with the overlay and 4.99 with it off. Tracking p95 was 393 and 272 ms. Classifier p95 was 184 and 161 ms. The approximately seven-second phases used 14.32 and 12.34 Chrome CPU-seconds. The phases were sequential and other test work was running.
- **Reverse-order camera repeat.** Overlay off and on measured 4.71 and 4.14 analyzed fps, respectively. A further 12 cycles measured a summed Chrome working set of 1,367 → 1,242 MB and renderer JavaScript heap of 2.99 → 3.17 MB after collection. Summed working set can count shared pages more than once. The short tests show resource reuse through repeated rounds.
- **Repeated camera use.** The primary run completed 24 start/pause cycles with 144 seconds of live capture. It recovered from one injected tracking-worker error and recreated both workers once. No page exceptions occurred. Across the 163-second cycle phase, Chrome used 266.39 CPU-seconds and the renderer JS heap after collection ranged from 2.98 to 3.14 MB.
- **Offline.** Chrome verified 32 cached assets, restarted the browser, and reloaded with Chrome offline and the local HTTP server stopped. Lesson playback, worker startup, camera, registration and saved state continued.
- **Upgrade.** The previous kiosk upgraded on the same localhost origin after every old tab closed. The active cache changed from 00a370b8357984cf to f7f9531a61d13c30, and a saved player remained available after the network and server were stopped.
- **Real-timer replay.** A prerecorded SLEEP earned exactly one automatic 10-point award. The same file presented for STOP timed out. The follow-up run persisted that timeout **7 ms after the stored deadline**. Chrome’s test runner observed the result 20.405 seconds after challenge visibility.

## Publication and release safety

The dedicated repository returned HTTP 404 and repository creation was unavailable through the connected tools. The authorized public fallback is a standalone-root branch at [exhibition/gameshow-2026](https://github.com/adamjamiesimson/SignRelay/tree/exhibition/gameshow-2026). Its ancestry contains GameShow only, the branch has no GitHub workflows, and its Vercel Git configuration disables automatic deployments. The original main ref stayed at 1b888fa73aaa6c0d0b0708081f9143fa10c272c9 during publication.

The first sprint’s automatic review blocked transferring generated source to a public destination because explicit permission for that destination was missing. The block identified no particular secret. This sprint used the subsequent authorization and ordinary authenticated Git. A Git-tree audit checked media hashes, public lesson sources, expected assets, release paths and common credential signatures. The published tree excludes local recordings, participant backups, browser profiles, Firebase target credentials and application data. The earlier display font was replaced with the SIL OFL Outfit font to resolve webfont redistribution uncertainty. Production and complete lockfile audits reported no known vulnerabilities.

The Firebase guard rejected the original project and site identifiers before CLI invocation. Firebase CLI had no authorized account. See [exact Firebase commands](DEPLOY.md) and [the kiosk start and rehearsal](BOOTH.md).

## Remaining physical checks

Live beginner accuracy, false awards from ordinary booth motion, and six-hour stability still require the physical rehearsal and soak. On a low-rate laptop, close heavy apps, improve framing and lighting, try the overlay toggle, and use host judging for genuinely correct missed signs.

## Reproduce

The source archive includes both pinned cohort manifests and per-target JSON evidence. The Windows Gyan.dev FFmpeg 7.1 essentials build produced the byte-pinned transcodes. Set **GAMESHOW_FFMPEG** to a compatible executable.

```sh
node scripts/prepare-replay.mjs docs/replay-sprint2-calibration-cohort.json test-output/calibration
node scripts/prepare-replay.mjs docs/replay-sprint2-holdout-cohort.json test-output/holdout
node scripts/build.mjs --evaluate
node scripts/benchmark-replay.mjs test-output/calibration/cohort.json test-output/calibration-5.json val 5
node scripts/benchmark-replay.mjs test-output/holdout/cohort.json test-output/holdout-5.json test 5 docs/replay-sprint2-exploratory-thresholds.json
node scripts/benchmark-replay.mjs test-output/holdout/cohort.json test-output/holdout-15.json test 15
node scripts/benchmark-replay.mjs test-output/holdout/cohort.json test-output/scrambled-5.json scramble 5
node scripts/build.mjs --stress
node scripts/stress-test.mjs 120
```

Generate the fake webcam file with the FFmpeg command in [the initial recognition report](RECOGNITION.md), then run the production browser probes.

```sh
node scripts/build.mjs
node scripts/browser-test.mjs
node scripts/fullscreen-test.mjs
node scripts/camera-replay.mjs test-output/sleep-slow.y4m SLEEP STOP 0.65
node scripts/booth-benchmark.mjs test-output/sleep-slow.y4m 24 6
node scripts/booth-benchmark.mjs test-output/sleep-slow.y4m 12 3 --reverse
```


