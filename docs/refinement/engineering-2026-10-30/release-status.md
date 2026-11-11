# Release status — 30 October 2026 (updated 11 November)

**Public release: NO-GO.** On 11 November the recognition worker on PR #46 (`afd4bf13f6e5`) **passed the real-video development pilot** ([run 43115145059](https://github.com/adamjamiesimson/SignRelay/actions/runs/43115145059)):

- 5 correct, **0 wrong accepted**, 6 abstained, 0 errors
- the exact-baseline gate `ok`, with zero changes on all 11 established trials

That closes B1. It is evidence on 11 previously inspected development clips only. It is not device, live-camera, false-acceptance or unseen-test evidence, so B2–B10 remain open.

## A. Release blockers

B1 is closed. The rest remain open, and each one names what closes it.

| # | Blocker | Why it blocks | What closes it | Who |
| --- | --- | --- | --- | --- |
| ~~B1~~ | ~~Real-video pilot not run for worker `afd4bf13f6e5`~~ **Closed 11 November** | — | Pilot passed on head `6eb9c64` once `signdata.cc.gatech.edu` verified again (workflow and TLS verification unchanged). Gate `ok`, 0 wrong accepted, 0 errors, outcomes identical to PR #45's worker. Recorded in `docs/evaluation/evaluated-runtimes.json` ([report §7](README.md#7-the-asl-video-pilot)). | Done |
| B2 | **No physical-device evidence** | Every timing so far comes from containers or headless browsers | Laptop, Android and iPhone sessions per the [manual-testing guide](manual-testing-guide.md): ≥ 10 analysed fps preflight, model latency, ten-minute browser session, memory | Owner |
| B3 | **Manual gates MAN-1 to MAN-5 not run** | No live six-word, false-accept, offline, permission or speech results exist | [Field-test protocols](../sprint-6/field-test-protocols.md) A–C | Owner |
| B4 | **Real false acceptance unmeasured** (no-sign movements, out-of-vocabulary signs) | Only synthetic adversarial evidence exists, and it includes known synthetic false-accept risks | MAN-2 plus the 48 no-sign and 24 OOV reviewed takes | Owner, with a reviewer |
| B5 | **Real-clip recall gaps:** THANK YOU 0/3, YES 0/1, HELLO 1/3 on development clips; **no real SORRY recording** | The demo words most likely to be missed in use | Causes analysed in [thank-you-yes-investigation.md](thank-you-yes-investigation.md). Closing them needs live stage-coded trials and new recordings with a natural hold. No recognition change is justified by the current evidence. | Owner, then engineering |
| B6 | **No independent fluent review; no new development signers** | Labels and failure explanations are unreviewed | Four signers (72 signed takes), one blinded fluent reviewer | Owner |
| B7 | **Sealed-holdout evaluation not authorized or run** | The only unseen test set | A separate, owner-authorized, one-time evaluation of a frozen candidate | Owner |
| B8 | **ASL-2000 too slow for model-only confirmation on the integration laptop** (2,116 ms median, measured in PR #44, against an envelope of about 1.1 s) | On that laptop only starter rules can confirm words; the model path never can | Measure on the device (guide §3). PR #46 saves about 0.1 s per inference, which is not enough on its own. | Owner (measure), then engineering |
| B9 | **Windows full suite not run** since the LF fix | The Codex Windows baseline had 12 failures | `npm test` on the laptop after the one-time working-tree refresh | Owner |
| B10 | **ASL-2000 model licence:** WLASL Pose-TGCN, "Academic and computational use only; no commercial use" (`public/models/asl2000-tgcn/model.json`) | Limits any commercial release | Owner decision. This is not an engineering defect. | Owner |

## B. Improvements verified on PR #46

These are verified **only to the level stated**. None of them is real-camera or device evidence.

| Improvement | Verified by | Not verified |
| --- | --- | --- |
| Tracking failure clears the overlay and recognition evidence immediately, then recovers | Unit tests (three of four fail on the old code); built-export Chromium fault-injection smoke (fails on the old build); CI; manual DevTools trigger checked on the built export (replacement worker in 0.19 s) | Live webcam on a real device (guide §5) |
| Personal-sign matching up to 4–5.7× faster at 300 examples (spread vocabularies) | Exact equivalence against an unpruned oracle (90 vocabularies plus margin edges; mutations fail it); CI benchmark decision check; browser scale smoke at 30/150/300 | Device timings (guide §6) |
| ASL-2000 26% and PSL 44% less wall time per inference (yield without the timer clamp) | Bit-identical golden logits; Chromium worker smoke for messages, timers and cancellation; matched A/B on one host; CI; **real-video development pilot: no outcome changed on the 11 clips, 0 wrong accepted** | Device timings (guide §3); live-camera outcomes |
| RSL worker releases a mismatched model and disposes tensors | Unit tests (fail on the old worker); CI Firebase build with the real Slovo model in Chrome | — |
| LF line endings on every platform | Reproduced (12 failures) and fixed in an autocrlf clone | Windows laptop (B9) |
| Golden-logit test has an explicit time budget | Full suite 961/0/2 locally and in CI | — |

CI on PR #46: core, Firebase build and strict audit, demo and rehearsal smokes, and consent are green. The pilot was red from 30 October to 10 November because of the external TLS failure. It turned green on re-dispatch on 11 November.

## C. Not changed, by design

Recognition thresholds, the motion gate, the two-evidence confirmation rule, the ambiguity veto, starter rules, experiments, expectations and test exclusions are unchanged on #44, #45 and #46. On the same 11 development clips, worker `afd4bf13f6e5` and PR #45's worker `b454deb00b6e` both score **5 correct, 0 wrong accepted, 6 abstained, 0 errors**. Each was measured in its own pilot run.
