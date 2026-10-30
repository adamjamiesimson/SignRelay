# Owner checklist — 30 October 2026

This adds to [PR #45's checklist](../followup-2026-10-28/owner-checklist.md), which still applies in full: devices, people, recordings and the "do not" list. Nothing below has been done.

## Before relying on worker `afd4bf13f6e5`

- [ ] **Re-run the ASL video pilot** once `signdata.cc.gatech.edu` verifies again: Actions → *ASL Video Pilot (non-release)* → Run workflow on `claude/nifty-davinci-fgv665`. It has failed on every runner since 30 October with `CERTIFICATE_VERIFY_FAILED`, including on PR #45's previously passing head ([report §7](README.md#7-blocked-the-asl-video-pilot)).
  - Required: exact-baseline gate `ok`, **0 wrong accepted**, no runtime errors.
  - Then record the worker in `docs/evaluation/evaluated-runtimes.json` and regenerate the dashboard.
  - If any trial changes, stop and report it. Do not edit expectations.
  - Do not disable TLS verification to get past the error.
  - If the host stays broken, the owner decides whether a verified mirror or cache of the 11 development clips is acceptable under their licence. Engineering has not done this.

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
