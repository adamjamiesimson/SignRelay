# Real-world test checklist

Every item here is **PENDING** until a person has done it on real hardware and recorded the result. No software check in this repository replaces any of them. Synthetic fixtures, headless Chromium and Node benchmarks are regression records, not real-world evidence.

Before you start, on the demo laptop:

```bash
git checkout main && git pull && npm ci
npm run demo:prepare
npm run demo:serve        # leave running; open http://127.0.0.1:3000/?perf
```

Record live outcomes with `npm run eval:log` in a second terminal (see `evaluation/README.md`). Results go to `evaluation/results/`, which is git-ignored. Use pseudonyms such as `P01`. Never record names, e-mail addresses, camera labels, video or landmarks in a results file.

| # | Task | Who | Pass condition | Record |
| --- | --- | --- | --- | --- |
| 1 | Physical webcam recognition | Operator plus one signer | Sign each of the six words twice (MAN-1). Note every outcome; no retries until the expected word appears | `eval:log` rows, `?perf` frames analysed/s |
| 2 | Everyday-movement false positives | Operator | Hands at rest for 30 s, then each movement in `docs/gitex/known-false-accept-risks.json` (MAN-2). Any word that appears is a false accept | `eval:log` with `n` (no-sign) per movement |
| 3 | Fully offline on the demo laptop | Operator | After the page loads, disconnect Wi-Fi and Ethernet, reload, repeat task 1 once (MAN-3). Also run `npm run demo:check -- "<chrome path>"` on that laptop | `demo:check` JSON, `eval:log` rows |
| 4 | Camera interruption and recovery | Operator | Deny camera permission once, then allow it. Unplug or disable the webcam mid-session; the page must say so and recover after **Retry camera** (MAN-4). Switch tabs away and back | `eval:log` `f` rows with what happened |
| 5 | Real speaker and text-to-speech | Operator | Turn on Auto speak. Only confirmed words are spoken, once each. **Stop**, **Pause camera**, **Save & clear** and changing language all silence speech immediately (MAN-5) | Note in `eval:log` or on paper |
| 6 | Consented recordings from new signers | Project owner | Written consent stored outside the repository first. Record with the private capture tool (`SIGNRELAY_INCLUDE_PRIVATE_CAPTURE=1 npm run build:firebase`, then `/field-test`); download each take and its metadata; run `scripts/capture-intake.mjs` | Private intake folder only, never this repository |
| 7 | Independent fluent ASL review | Fluent ASL reviewer, blinded to predictions | Review packets from `scripts/review-packet.mjs`; approve or reject each take's actual gloss | Reviewer decisions in the private intake |
| 8 | Real-device FPS, memory and latency | Operator | On the demo laptop and at least two phones: the `?perf` readout over 60 s of signing, with no throughput warning (at least 10 frames analysed/s). Chrome Task Manager memory before and after 10 minutes | Device, OS, browser, readout text, memory |

## Rules that keep the evidence honest

- Do not tune thresholds, rules or the tail guard on these observations and then re-measure on the same takes.
- Do not open, fetch or replay the sealed holdout (`docs/evaluation/popsign-reserved-holdout-2026-10-16.json`, role `sealed-holdout` in `cohort-lock-2026-10-16.json`) until a final candidate is frozen and the owner authorises a single measurement. Despite its name, `popsign-project-holdout-manifest.json` is the 6-clip historical-development cohort that the CI pilot replays.
- The 11 development clips (5 correct, 0 wrong, 6 no match) are not an accuracy percentage and must not be presented as one.
- `eval:live` reports operator-log rows separately, as `unreviewed_operator_observations`. Treat them as a demo record, not as results.
- A trial with a camera or tracking failure counts as a failure. It is not removed from the denominator.

## After the checks

1. Summarise: `npm run eval:live -- evaluation/results/<file>.jsonl`.
2. Update the gate states in `docs/gitex/demo-package-2026-10-21.md` with what was actually observed.
3. Only the project owner changes the release decision. `npm run readiness` reports NO-GO until the manual gates are recorded as passed.
