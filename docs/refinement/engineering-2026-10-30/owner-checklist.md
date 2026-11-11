# Owner checklist — 30 October 2026

This adds to [PR #45's checklist](../followup-2026-10-28/owner-checklist.md), which still applies in full: devices, people, recordings and the "do not" list. Nothing below has been done.

## Before relying on worker `afd4bf13f6e5`

- [x] **Re-run the ASL video pilot.** Done on 11 November, once `signdata.cc.gatech.edu` verified again ([run 43115145059](https://github.com/adamjamiesimson/SignRelay/actions/runs/43115145059)). Exact-baseline gate `ok`, **0 wrong accepted**, 0 errors; 5 correct, 6 abstained, with no trial changed. The worker is recorded in `docs/evaluation/evaluated-runtimes.json`, and the dashboard was regenerated ([report §7](README.md#7-the-asl-video-pilot)). TLS verification was never disabled, and no clip was cached or mirrored. This is development-clip evidence only. The device sessions below are still needed.

## Windows integration laptop

- [ ] Pull this branch, then refresh the working tree once so existing CRLF files become LF. On a clean tree:

  ```bash
  git rm -r --cached -q . && git reset --hard
  ```

  Confirm with `git ls-files --eol`: no `w/crlf`.
- [ ] Run `npm test` (the full suite). Report the full-suite result. The 11 CRLF failures and the golden-logit timeout from the Codex Windows baseline should be gone.
- [ ] With `?perf`, record the ASL-2000 `model` time (median and p95) during signing, and compare it with PR #44's 2,116 ms median. The yield change should save about 0.1 s per inference. Record what is measured; it is not a gate.

## Supervised device sessions (in addition to PR #45's list)

Step-by-step procedures for each device, the `?perf` fields, model latency, the tracking-recovery trigger, personal signs, miss-stage codes and the results template are in the [manual-testing guide](manual-testing-guide.md).


- [ ] **Tracking failure:** if tracking recovers mid-session (the `?perf` panel shows a recovery), confirm the hand overlay disappears immediately and no word is added from before the interruption. Record the device, build and worker hash.
- [ ] **Personal signs:** with at least 100 saved examples, record the `?perf` `personal` time while signing a saved word, and confirm saved words are still recognized and near-identical words still abstain.
- [ ] **RSL and Bangla:** one recognition each on a laptop, then Stop. Confirm no error appears and the camera light goes off.
