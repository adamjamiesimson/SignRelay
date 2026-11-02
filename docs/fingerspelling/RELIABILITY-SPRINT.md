# Recognition reliability and controlled webcam testing

**Status: research-only.** This sprint implements capture/collection improvements and publishes negative results. It does not deliver a validated fingerspelling-intent detector, new recognition weights or qualifying calibration. Independent participants, physical devices and independently reviewed negative recordings remain unavailable in the remote engineering environment.

## Baseline preserved

PR #49 starts exactly at PR #48 commit `d89cff666fe7a4981fb01a8b460a65a9abd3065e`. PRs #48 and #47 remain unchanged and unmerged. The [original accuracy report](ACCURACY-SPRINT.md) and every prior evidence file are preserved.

The baseline remains 4,093 FSboard training clips / 94 signers, 11.76% native CER and 135/384 exact on 15 training-disjoint final signers; the preceding checkpoint scores 18.15% on that same cohort. Earlier RGB runs scored 3/8 then 2/8 exact. Native action-window evaluation produced 6/29 structural false candidates. Conditional confidence established no acceptance threshold. These results have not been replaced by the smaller experiments below.

## Implemented changes

- Fingerspelling snapshots are drawn synchronously while handling decoded-video metadata, removing the deliberate asynchronous snapshot gap. A media-time 15 Hz lattice replaces wall-clock throttling. One replaceable pending bitmap bounds memory; replaced/stale frames are observable rather than interpolated.
- Explicit start/finish boundaries exclude pre-click and post-finish snapshots. Finish seals the capture, drains in-flight/buffered work and checks ownership before submitting. Cancelled captures cannot later overwrite a restarted capture. Original word-profile scheduling and fallback remain in place.
- Capture diagnostics retain relative timestamps, actual observed rate/gaps, dominant returned-category visibility, missing observations and interruptions. Model metadata, input size/SHA verification, decoding and quality thresholds are unchanged.
- **Optional webcam testing** in the existing fingerspelling interface provides consent, positive/ordinary-action prompts, corrected ground truth, local failure reporting and a separate opt-in text-free download. Candidate text can be edited before deliberate confirmation.
- Future data imports require permission/consent review, independent temporal annotation review, source/person separation and an untouched final role. An empty collection is explicitly blocked. No rejection detector is trained from the exposed 29 windows.

Synchronous callback capture reduces an association ambiguity; it does not prove exact pixel/timestamp identity across physical browser implementations. CPU overload still skips slots. This is user-controlled capture bounding, not linguistic boundary or intent detection.

## Matched genuine RGB regression evidence

[Six jobs / 60 completed captures](https://github.com/adamjamiesimson/SignRelay/actions/runs/41333039942), same ten licensed recordings, three repetitions per implementation. Actual getUserMedia pixels pass through the CPU tracker and production CTC worker; landmark substitution is asserted inactive. The two implementations use the same model hash. The eight exposed final/returned-Left clips and two known regressions are **regressions, not a new untouched final set**.

| Measurement | PR #48 baseline | Decoded-frame candidate |
|---|---:|---:|
| Eight-clip CER, repetitions 1 / 2 / 3 | 23.42 / 23.42 / 21.62% | 20.72 / 18.92 / 19.82% |
| Eight-clip exact, repetitions 1 / 2 / 3 | 2 / 2 / 2 of 8 | 3 / 3 / 2 of 8 |
| Descriptive pooled eight-clip CER | 76/333 edits, 22.82% | 66/333 edits, 19.82% |
| Exact including known regressions | 11/30 | 11/30 |
| Same output across all three runs | 5/10 clips | 7/10 clips |
| Positive captures displaying candidates | 30/30 | 30/30 |
| Finish → DOM candidate median / p95 | 34.45 / 43.9 ms | 55.2 / 160.8 ms |
| Observed-rate median | 13.79 Hz | 13.58 Hz |

Repeats of the same clips are correlated. No population interval or new signer-generalisation claim follows from pooling them. The all-case exact count did not improve. **ESTEVAN WONG became consistently STEVAN WONG**, a known regression; improved consistency includes stable errors. PLUSS was exact in all three candidate runs versus two baseline runs. The original native-landmark result is not comparable directly with this small RGB cohort.

Candidate observed rates span 12.31–15.00 Hz; the buffer cannot guarantee 15 Hz under load. Drain adds latency, with a 173.9 ms maximum observed Finish-to-DOM delay. These measurements exclude the gesture duration and are remote Linux/Chrome observations. The previous 1.1 ms warm neural-inference measurement remains a separate model-only benchmark.

Native ONNX text matches the exact app-captured tensors in **60/60** positive cases. This establishes neural/runtime parity on those captured inputs, not bit-identical native/browser tracking.

Every hypothesis and timing is retained in [six raw reports](reliability/evidence/), including incorrect strings and source/video hashes. [Recompute the summaries](../../training/fingerspelling/reliability/summarize_rgb.py).

## Ordinary-action rejection did not improve

[Matched full RGB action runs](https://github.com/adamjamiesimson/SignRelay/actions/runs/41335043759) completed all 29 predetermined windows in each implementation:

| Result | Baseline | Candidate |
|---|---:|---:|
| Displayed false candidates | **3/29** | **4/29** |
| Empty results / quality or model-policy abstention | 26/29 | 25/29 |

Baseline strings were AOA, PGA and ASEE. Candidate strings were AOH, HBGA PAGA, THE and A C. These remain uncertain and require confirmation. No automatic-acceptance improvement is claimed. Positive candidate coverage was 30/30 for both paths in the separate positive regression experiment; neither path obtains apparent safety by rejecting every positive.

This full RGB result has a different input path and text-length eligibility definition from the archived 6/29 native structural-candidate result. It must not silently replace that baseline. Five source videos form only two conservative source groups; identities are unverified and previous annotation review was source metadata/captions plus sampled AI contact sheets. These counts are not a production false-accept rate or independently expert-labelled safety benchmark. Waving still needs participant collection.

The likely mechanism is the closed-set letter/blank CTC objective trained on fingerspelling: ordinary hand trajectories can resemble legal letter paths, while conditional exact-text confidence does not estimate fingerspelling intent. Visibility and motion heuristics alone cannot establish intent and could reject valid holds, repeated letters or J/Z. This diagnosis motivates data collection; it is not proof that an untrained detector works.

The native parity helper initially compared raw decoding with post-policy empty results; it now checks the unchanged frame/presence/text-length policy too. Commons VFR sources also required a separate decoded-PTS preflight rather than the FSboard-specific source-rate bound. Publisher bytes/SHA-1 and independent SHA-256 checks remain enforced; TLS remains verified. Earlier incomplete jobs are retained in Actions and are not assigned a 29-case denominator.

## Declared derived-input stress

[Forty native neural probes](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336052415) use eight genuine frozen landmark streams and declared perturbations. They are **not forty new recordings, real negative actions or physical hand-exit tests**. Weights remain unchanged.

| Input variant | Candidate coverage | Raw CER / exact | CER after existing quality guards |
|---|---:|---:|---:|
| Original eight streams | 8/8 | 20.72%, 3/8 | 20.72% |
| Remove every fifth observation | 8/8 | 22.52%, 2/8 | 22.52% |
| Five missing landmark observations | 8/8 | 23.42%, 2/8 | 23.42% |
| Remove a three-observation block | 0/8 | 24.32%, 2/8 | **100%** |
| Mirror coordinates and swap returned category | 8/8 | 20.72%, 3/8 | 20.72% |

The gap variant exceeds the existing 200 ms maximum gap and abstains on every positive. This is appropriate reporting of unsupported input, **not a successful recognition/rejection result**. Mirror-coordinate equality checks feature canonicalisation, not MediaPipe extraction from mirrored pixels or physical-left generalisation.

RARE_MIRROR_PENDING

## Working local testing interface

Open the existing ASL workspace, select Fingerspelling and expand **Optional webcam testing**. Metrics collection starts only after its explicit checkbox. Camera permission and Start/Finish remain user-controlled.

Prompts include ANNA, QUINN, JAZZ and LILY, plus rest/no hands, waving, mimed handwashing, clothing adjustment and unrelated signing. Raw predictions and the user's corrected transcription remain separate from editable composition. Saving a local result never confirms or speaks text. Cancellation/technical failures are separate from accuracy and negative-rejection denominators.

At most 100 results stay in tab memory. Closing the panel, ending testing or withdrawing consent clears local study state. No video or landmark files are collected by this workflow. A separate download checkbox permits only an allowlisted JSON file: prompt IDs, coarse self-reported device/hand/light/speed, counts/edit metrics and relative timing. It excludes prediction/ground-truth strings, absolute timestamps, device identifiers, user agent, video and landmarks. Model assets may be downloaded normally; study data has no upload endpoint or analytics event.

[Participant-flow job](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336052066): eight software/privacy groups pass on one genuine recorded source, including corrected truth, separate export choice, cleared state, preserved deliberately confirmed draft, zero external page requests and 390-pixel no-overflow. A quality abstention is also a valid saved test outcome; this job does not certify physical-camera recognition.

[Nontechnical tester guide](TESTER-GUIDE.md) covers Windows/Chrome/Edge, Mac/Safari/Chrome, Android/Chrome and iPhone/Safari, lighting, angle, speed, hand, interruptions, cancellation and sharing controls. These devices were not physically tested.

The text-free file is a participant-reported diagnostic, not independently re-auditable signing data or proof of signer independence. Independently reviewed, separately consented raw recordings and a private acquisition process remain required for detector training/calibration. The [manifest template](../../training/fingerspelling/reliability/manifest-template.json) intentionally has no recordings.

## Validation and preservation

- [Isolated verification](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336052091): **1,013 passed, two existing skips**, 104 test files; typecheck, lint, worker builds, repository/asset guard and eight browser lifecycle/composition checks pass. These software checks are separate from recognition accuracy.
- [Three review-gate Python tests](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336052009) pass, including rejection of empty data, cross-role identity/source leakage, AI-only review and exposed final data. A green validator means it enforces the block; no reviewed training collection exists.
- [Offline/fault-injection suite](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336056525) and [analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336056640) pass. Core CI's secret scan reports zero findings.
- [Preservation audit](reliability/evidence/preservation.json): 904 protected baseline files unchanged, all model assets unchanged, lockfile unchanged, baseline accuracy report unchanged and original CSS preserved as an exact prefix. New styling only scopes the testing controls.
- Compiled word worker remains SHA-256 `ec7b6d01b89467339b1a957c1f8714d8a4044a23b24a751ad4fe2a403a7aa557`. Word languages, personal examples/formats, branding/logo, security audits and Firebase configuration remain preserved.

The active independently trained ONNX remains **523,322 bytes**, SHA-256 `34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b`, 130,108 parameters. Google/Deaf Professional Arts Network FSboard v13 is CC BY 4.0; MediaPipe task/version/provenance remain as documented in the baseline report. No OpenFS code or weights were adopted. Commons public-domain/CC BY-SA material is evaluation-only, with per-source licences and hashes in the raw reports.

## Release blockers and stack

**Global CI remains blocked.** [Dependency inspection](https://github.com/adamjamiesimson/SignRelay/actions/runs/41332586469) reproduces 16 moderate development findings and zero production findings. A compatible, non-forced npm audit-fix attempt leaves all 16. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) lists minimatch <11.0.1 as affected; consumers include ESLint/config-array/eslintrc/typescript-estree/import/react/a11y plugins. npm's suggested ESLint 4.0.0 major downgrade is unsuitable for this Next/ESLint stack. No forced downgrade, blanket major override, review exception, audit suppression or dependency change was adopted.

[Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336056582) and [Firebase static-build gate](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336056534) retain that audit failure. The [separate trust check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41336052066) still rejects PopSign's distrusted emSign G3 hierarchy with exit 78. Publisher reissuance under an unaffected hierarchy is required; existing frozen licensed local-cache recovery remains available. No root restoration, certificate bypass, source mirror or integrity downgrade was introduced.

The unmerged dependency chain remains #49 → #48 → #47 → #46 → #45 → #44, with #43 integrated in the research parent history. #43/#44 target main; other draft bases are stacked feature branches. #47's parent also contains separately reviewable ASL adapter work. Before main integration, review the ancestor changes independently, resolve the dependency gate safely, keep unavailable source conditions visibly blocked, qualify actual devices and run representative word/personal-sign and fingerspelling studies. Do not merge this entire unvalidated stack as a side effect of accepting the testing UI.

## Reproduce and rollback

Use a separately authorised Linux runner; engineering was performed through repository APIs and GitHub Actions, without controlling the user's laptop.

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build:worker
npm run repo:guard
python -m unittest discover -s training/fingerspelling/reliability -p 'test_*.py' -v
python training/fingerspelling/reliability/summarize_rgb.py docs/fingerspelling/reliability/evidence/rgb-*.json --output work/rgb-summary.json
python training/fingerspelling/reliability/evaluate.py --exports /path/to/consented-test-metrics.json --output work/participant-summary.json
# Expected failure until real reviewed data exists:
python training/fingerspelling/reliability/evaluate.py --check-manifest training/fingerspelling/reliability/manifest-template.json
```

Actual RGB reproduction: [matched-positive workflow](../../.github/workflows/fingerspelling-reliability-rgb.yml), [ordinary-action workflow](../../.github/workflows/fingerspelling-reliability-negative-rgb.yml), [study/trust workflow](../../.github/workflows/fingerspelling-reliability-study.yml) and [derived-stress workflow](../../.github/workflows/fingerspelling-reliability-stress.yml). Each contains checkout refs, frozen requirements, verified source acquisition, conversion and browser commands. Keep every predetermined case and every abstention. Do not tune on the exposed regression recordings or relabel anonymous metrics as independent signers.

Benchmark source: `24f7a90adc7c4d7762c8d7c985769fc72aa04d71`; completed negative source: `099f8f05c2a7c9ae8ae1804ff50dde3ba0a4da39`; validated study/stress implementation: `2cc99c22c292816e035d1ac995467d843ef1fab5`. Later changes add diagnostics/reports only. Model features, decoder, thresholds and weights are unchanged.

To roll back this **whole unmerged sprint**, return to parent `d89cff666fe7a4981fb01a8b460a65a9abd3065e` in a separate checkout and rebuild with `npm ci && npm run build:rehearsal`. This restores PR #48's previous capture/controls and unchanged checkpoint; it does not make that prototype validated. The baseline report's model rollback remains available separately.

## Readiness and owner actions

The local collection workflow is implemented and remotely exercised. **Owner-led physical-device qualification is the next step; controlled external collection is conditional on that smoke and an agreed consent/review process.** It does not require pretending an intent detector is already calibrated. No physical-webcam, independent Deaf-signer or broad external pilot has been completed. Dependable public recognition remains unsupported.

On your first real device: open the preview, select ASL/Fingerspelling, opt into testing, grant camera permission, perform three repeats each of ANNA/QUINN/JAZZ/LILY and each ordinary action, save corrected truth and every failure, test hand exits/Cancel/mode switch/restart, inspect and optionally download the text-free file. Then qualify the other device/browser combinations using the guide. Provide physical observations before extending deployment or calibration claims.

No main merge or Firebase deployment was performed. PR #49 remains draft.
