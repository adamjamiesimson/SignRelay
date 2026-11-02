# SignRelay engineering sprint — 2 November 2026

The validated gains are faster personal-sign matching, fewer unnecessary CTC model initializations, and stronger capture/request ownership. **Dependable recognition and public readiness are not established.** No model, confidence threshold, decoder, language vocabulary or saved-example format was changed. Recognition regressions and unsuccessful experiments are retained below.

Draft review: [PR #50](https://github.com/adamjamiesimson/SignRelay/pull/50), branch `codex/engineering-sprint-2026-11-02`. Exact parent: `116fe686f7b31ecd00ac57ee4724287affafda0f` (#49). Ancestry is #49 → #48 → #47 → #46 → #45 → #44, with #43 integrated in #44's history and additional research adapter work before #47. Nothing was merged into main or deployed to Firebase. Review the ancestors separately.

**What changed and why**

- CTC results must match the active request ID as well as the worker generation and epoch. Duplicate completions cannot answer a subsequent capture. An older capture cannot publish while a newer capture is queued. Duplicate readiness messages cannot clear an inference watchdog. Regression tests reproduced these defects before the fixes.
- Cancelling capture or editing a candidate reuses an initialized, idle CTC worker. Running WASM inference still requires worker termination for cancellation. Failed/loading workers can still be restarted. The real-browser benchmark creates one worker across twenty idle resets, versus twenty-one before.
- Tracking recovery closes the queued pre-failure bitmap before restarting its worker. The interrupted stream cannot resume from those old pixels. Tests cover the in-flight failure, replacement/stop ownership of 100 bitmaps, and drained Finish boundaries.
- Personal DTW reuses feature costs only for exactly identical adjacent observation rows. It retains all 24 DTW rows and every warping path; it does not shorten a sign or change the distance metric. Accumulation order, missing-group masks, cutoffs, rival margins, legacy 208-feature padding and trajectory-v3 storage stay intact. An independent full-matrix oracle checks exact floating-point equality; existing tests also check every installed PSL reference.
- The ASL capability text now identifies the historical 5/11 word result as an **earlier-runtime** result. The current word pipeline's verified video-source gate is blocked. Existing layout, typography, animations, green identity and original logo bytes are preserved.
- The laboratory adds paired CPU/browser benchmarks, sequence-quality tests, real RGB catalogs with complete failure ledgers, same-machine alternating replay, and retained-memory probes. Existing opt-in diagnostic writers can write a new sprint file without replacing historical evidence.

Initial priorities were reproducible lifecycle defects and personal matching, followed by a complete test/evidence pipeline, security/source blockers and truthful language reporting. No speculative ML change was retained to make a test count or confidence score look better.

**Architecture and recognition findings**

Word mode captures a current bitmap only when the tracking lane is free. MediaPipe runs in a persistent worker, publishes hands before auxiliary face/pose completion, and has CPU recovery plus a main-thread compatibility fallback. Recognition has one in-flight frame and one latest replacement. Its bounded history feeds ASL starter motion rules, the ASL-2000 graph, language-specific landmark models and a separate personal/PSL matcher worker. Matching has one active scan and one latest snapshot, cancellation and stale-result guards.

Fingerspelling uses a separate CPU hand tracker, decoded-video sampling at a 15 Hz lattice, one latest bitmap, explicit Start/Finish boundaries and a drained final observation. The 132-feature motion contract preserves orientation, trajectory and observed-time velocity; missing hands remain missing observations. Dominant returned handedness, aspect and timing guards are unchanged. A separate ONNX worker runs the existing motion GRU and language-free CTC beam decoder. Its policy still has **no validated acceptance threshold**: every displayed candidate is uncertain and requires deliberate confirmation. The tests exercise repeated letters, reflection/category swapping, missing hands, interruptions, long captures and cancellation; they do not establish physical-left, J/Z or independent signer accuracy.

The word worker remains SHA-256 `ec7b6d01b89467339b1a957c1f8714d8a4044a23b24a751ad4fe2a403a7aa557`. The CTC model remains 523,322 bytes, SHA-256 `34c823aef5eaa3e4b74c564138a1a224f8c9a8426e0f69a331d5c01fbf53008b`. The previous checkpoint is retained. The [preservation audit](evidence/preservation.json) checks 526 original files across historical reports, models, UI/branding, worker sources/bundles, lockfile, deployment configuration and stored-data/CTC contracts; all are unchanged within that protected scope.

**Measured performance**

These are headless execution-host measurements, not physical webcam, phone or sensor-to-screen latency. Warm paired matching uses synthetic kinematic fixtures, 20 measured samples per implementation, and alternating request order. Values are median / p95 milliseconds, nearest-rank quantiles.

| Saved examples, near-rival workload | Windows i7-10510U before | Windows after | Linux EPYC 7763 before | Linux after |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 15.5 / 18.4 | 12.1 / 16.8 | 8.0 / 13.4 | 7.6 / 11.2 |
| 10 | 18.1 / 26.0 | 12.4 / 18.0 | 10.9 / 13.7 | 8.2 / 9.6 |
| 25 | 31.8 / 40.3 | 22.1 / 28.8 | 20.2 / 29.8 | 14.2 / 17.0 |
| 50 | 50.1 / 61.8 | 33.4 / 46.8 | 36.1 / 43.4 | 24.1 / 26.8 |
| 100 | 87.5 / 113.0 | 58.2 / 77.2 | 69.1 / 77.7 | 45.2 / 49.9 |

Decisions were identical in these comparisons. The 100-example median gain is about 33% on Windows and 35% on Linux. These gains apply when nearest-observation resampling or held poses repeat rows. The separate Node benchmark includes easy, near-rival, spread and matching-last vocabularies at all five sizes; easy/spread gains are small and some p95 values regress. This is not a universal speedup claim.

Twenty idle CTC resets went from 605.8 / 732.9 ms to below the browser's timing resolution on Windows, and 588.7 / 645.7 ms to below resolution on Linux. Both candidates used one initialized worker rather than twenty-one. This removes reinitialization, not neural computation; cold first-load measurements vary and do not demonstrate a cold-load improvement.

Generated 640×480 **no-hand** CPU tracking showed no material improvement: Windows capture-to-hands 59.2 / 67.9 → 59.1 / 74.3 ms; Linux 38.8 / 39.0 → 38.8 / 39.4 ms. Animation intervals remained about 16.7 / 16.8 ms. Worker transport and main-thread responsiveness are recorded separately in the raw reports. Hands-only timing is not face/pose completion or actual display presentation.

The first non-interleaved browser run regressed at 100 examples (96.1 / 147.0 → 114.9 / 290.4 ms) during concurrent browser-test load. It is retained as [the initial result](evidence/local-browser-first.json), alongside the interleaved rerun and independent Linux result. A cell-level DTW pruning experiment showed no reliable benefit and was removed; its [raw measurements](evidence/rejected-cell-pruning.json) remain available.

Ten-minute Node worker stress with 300 examples, 19 language-switch/idle cycles and 20 Hz offered input completed 8,182/8,182 acknowledgements, no faults, no queue drops and at most one matcher. Frame acknowledgement was 0.22 / 0.32 ms and queue age 0 / 0 ms; **these are not matcher-to-candidate latency**. Root worker heap was 20.8 MB initially, 27.0 MB at the last sample and 30.3 MB maximum. Total process RSS rose 188.4 → 350.6 MB (359.4 MB maximum), so the run does not prove flat total memory.

The separate [retention probe](evidence/matcher-memory.json) performs forty complete vocabulary replacements with actual matching workers and explicit GC. At 300 examples, candidate live heap settles around 20.5 MB and falls to 5.9 MB after clearing references, versus about 20.4 / 5.8 MB before. There is no accumulating retained vocabulary in that controlled probe. RSS high-water allocation, browser/WASM/GPU memory, longer sessions and mobile thermal behavior still need qualification.

**Recognition results and unsuccessful experiments**

The [first complete RGB experiment](https://github.com/adamjamiesimson/SignRelay/actions/runs/41386218093) ran actual recorded pixels through virtual getUserMedia, production CPU tracking, capture, CTC and deliberate confirmation. No landmark injection was used. All ten exposed positive recordings ran three times per implementation; all 29 exposed ordinary-action windows ran once per implementation. The model identity was identical and all 60 positive captured tensors matched native ONNX text.

| Initial experiment | Exact #49 parent | Candidate |
| --- | ---: | ---: |
| All-ten exact, three correlated repetitions | 11/30 | 10/30 |
| All-ten CER | 73/384, 19.01% | 72/384, 18.75% |
| Exposed eight-clip subset exact | 8/24 | 7/24 |
| Exposed eight-clip subset CER | 70/333, 21.02% | 69/333, 20.72% |
| Same text in all three runs | 9/10 clips | 4/10 clips |
| Positive candidate coverage / abstentions | 30/30 / 0 | 30/30 / 0 |
| Ordinary-action false candidates / abstentions | 2/29 / 27 | 4/29 / 25 |
| Technical failures | 0 | 0 |
| Finish → DOM candidate, median / p95 | 45.6 / 101.8 ms | 103.8 / 144.3 ms |
| Median observed capture rate | 15.00 Hz | 13.40 Hz |

**Exactness, consistency, false candidates and response time regress in this experiment.** The one-character CER reduction is not a defensible recognition improvement. Each variant ran on a separate runner, and measured neural inference also differed despite identical weights/code. Hardware/load effects therefore confound attribution.

The [same-machine follow-up](https://github.com/adamjamiesimson/SignRelay/actions/runs/41388326398) alternates both implementations on every predetermined input and reverses order on even repetitions. It completed the entire catalog and preserves the first experiment rather than replacing it. Both versions received byte-identical local Y4M source files; actual tracking remained uninjected. [Complete aggregate comparison](evidence/same-host/rgb-summary.json).

| Same-machine follow-up | #49 parent | Candidate |
| --- | ---: | ---: |
| All-ten exact, three correlated repetitions | 10/30 | 10/30 |
| All-ten CER | 72/384, 18.75% | 76/384, 19.79% |
| Eight-clip subset exact / CER | 7/24 / 20.72% | 7/24 / 21.92% |
| Same text in all three runs | 7/10 clips | 5/10 clips |
| Positive candidate coverage / abstentions | 30/30 / 0 | 30/30 / 0 |
| Ordinary-action false candidates / abstentions | 4/29 / 25 | 2/29 / 27 |
| Technical failures / positive native parity | 0 / 30/30 | 0 / 30/30 |
| Finish → DOM candidate, median / p95 | 53.3 / 131.9 ms | 49.6 / 154.7 ms |
| Median observed capture rate | 14.71 Hz | 14.73 Hz |

This controls the large capture-rate discrepancy in the first run, but **does not demonstrate improved recognition**: exactness is unchanged, CER and consistency are worse, and the latency tail is worse. The ordinary-action direction reverses between experiments, so its small counts do not establish improved rejection. All model/feature/decoder/quality rules remain unchanged; differing captured observations still produce differing text. The retained changes address independently reproduced lifecycle defects and measured exact-matching/model-reuse costs, not a claimed ML accuracy gain.

The [rare-letter/mirror follow-up](https://github.com/adamjamiesimson/SignRelay/actions/runs/41390641553) also alternated implementations on the same machine, using the exact five already-exposed #49 Q/J/Z and returned-Left recordings. Every case ran in both its original and horizontally mirrored RGB form. All twenty captures completed, displayed uncertain candidates and matched native ONNX on the actual captured tensors. [Aggregate results](evidence/rare-rgb/summary.json).

| Rare-letter / returned-category RGB | #49 parent | Candidate |
| --- | ---: | ---: |
| Original exact / CER | 2/5 / 6/66 (9.09%) | 2/5 / 6/66 (9.09%) |
| Mirrored exact / CER | 3/5 / 3/66 (4.55%) | 3/5 / 3/66 (4.55%) |

Aggregate exactness and CER are unchanged, while some incorrect strings differ. Derived RGB mirrors are not additional independent signers or physical-left validation. the tiny Q/J/Z and returned-category sample still does not qualify alphabet-wide recognition.

All repeats are correlated exposed regressions, not a fresh final cohort or new signer-generalization evidence. The ordinary-action windows have unverified identities, only two conservative source groups and no independent expert temporal review. They cannot train or qualify an intent detector. False *candidates* are still shown as uncertain; the RGB checks assert no automatic composition or speech before confirmation. Aggregate errors, failures and timing denominators are in [the initial ledgers](evidence/rgb-summary.json) and the linked same-machine ledgers.

The existing synthetic word experiments were rerun into new files, with every switch still off in production: seven configurations × 90 positive, 36 sparse-YES and 684 adversarial sequences, plus the full open-palm edge catalog. Baseline gave 90/90 synthetic positives and 280/684 adversarial sequences with a trigger. All switches together gave 90/90 and 72/684, while gap filling changed sparse YES 29/36 → 31/36. These artificial distributions do not establish ordinary-movement safety or working-vocabulary preservation on real signers. None was enabled. The [full outcomes](evidence/synthetic-experiments.json), including remaining false triggers, are retained.

The [throughput diagnostic](evidence/synthetic-throughput.json) reproduces lost completed strokes as observations become sparse: all six words at 20 Hz in five seeded rapid sequences; at slower rates YES, THANK YOU and SORRY coverage deteriorates. The existing two-evidence rule was not weakened. Actual word RGB replay remains blocked at acquisition, so THANK YOU/SORRY live reliability is unresolved.

Evidence files are indexed with SHA-256 in [the manifest](evidence-manifest.json). Downloaded Actions ZIP digests were verified before extraction; provenance lists each artifact and source run. Published RGB evidence contains aggregates only: no recording identifiers, text, per-recording results, device identities or biometric observations. Full case ledgers remain local; reproducible scripts and verified Actions artifact checksums are included. Raw synthetic performance benchmarks are included. Automatic approval review required aggregate publication and removal of browser-internal URL query values. CER is total Levenshtein edits divided by total reference characters, including internal spaces; only boundary whitespace is trimmed from predictions. Repeated recordings are not independent samples.

**Tests, builds and security**

- Baseline: 1,013 passed, zero failed, two default skips, 104 files. Final default local suite: **1,036 passed, zero failed, two default skips, 108 files**. Both skipped report writers were executed separately: nine focused cases passed, including those two opt-in cases. [Counts and skip identities](evidence/unit-summary.json).
- Full TypeScript, ESLint, worker builds, asset guard, full multilingual Next export and two rendered-export checks passed. The full build is only a build, not Firebase deployment.
- Fingerspelling composition/mode isolation, 12 start/pause and six rapid cancel cycles, tracking/model/worker/storage fault recovery, real IndexedDB with 30/150/300 saved examples, offline/CDN denial, keyboard/transcript/reduced-motion/mobile layout and consent checks passed on final local reruns or the linked CI build. Synthetic/fake-camera/browser execution is distinguished from signing evidence.
- Retained failures: the first rapid-word browser run missed THANK YOU with dropped frames under concurrent load; its isolated rerun passed. One offline check used the wrong profile, and another incorrectly treated rehearsal as multilingual; correct-profile reruns passed and the rehearsal handling was fixed. Initial Python tests hit Windows sandbox temporary-file permissions; all 14 acquisition and five artifact tests passed with a workspace temp directory. Three independent-review gate tests passed. No assertion, timeout, baseline expectation or security gate was relaxed.
- CI's CA-chain regression preserved distrust and passed hostname, unrelated-root, stale-output and omitted-intermediate controls. Secret scan on source commit `7528959`: **794 commits, 2,354 historical text blobs, zero known-pattern findings**. The normal PR workflows now retain the fingerspelling browser check and the matcher-memory probe; neither requires source recordings or a physical camera.
- Full npm audit still reports **16 moderate development-package findings**; production reports **zero**. Compatible resolution/upstream metadata inspection did not eliminate minimatch [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Even the inspected newer ESLint dependency line still requests an affected minimatch range; legacy plugins also use the old callable API. No forced downgrade, blanket major override, exception or audit suppression was introduced. Core CI and the build workflow therefore remain red at the unchanged audit gate; the strict release audit is skipped, not passed.
- PopSign acquisition still rejects its distrusted emSign G3 hierarchy with exit 78 before any word replay. Publisher reissuance under a currently trusted hierarchy is required. TLS verification was not disabled, old roots/cross-signs were not restored and no unverified mirror was substituted. Existing licensed local recovery via `--clip-cache` retains the frozen hashes and cohort guards.

The last fully checked source is `7528959c595b8466f8c82de0c9bf4207c5dccedd`. Its [offline/rehearsal CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41390645303) passed all application checks, including the newly retained fingerspelling check. Its [core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41390645337) passed typecheck, 1,036 tests, Python regressions, lint, workers, benchmarks, retention and secret scanning, then failed dependency audit. The subsequent asset-policy step was skipped there; the local asset guard passed. Its [multilingual export CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41390645257) built and verified the export and passed all model, camera, workspace and accessibility checks, then failed the dependency gate. Consent CI also passed. The report commit adds evidence and a recomputation helper only; it does not change runtime code. [Recorded CI steps and artifact provenance](evidence/ci-provenance.json).

**Language matrix**

The full checkout/build has six neural research paths and PSL reference DTW; none has independently established SignRelay live accuracy. Installed label counts are not validated recognition coverage. Actual browser execution/recovery completed for the ASL/BSL/ISL/LSE landmark paths and Russian/Bangla RGB paths; PSL's 775 references and distances were checked. CSL and the other personal paths have no automatic trained model. Their shared matcher/storage machinery was tested with synthetic examples; that is not separate accuracy evidence for each language. [Every registry row and installed asset hash](evidence/language-matrix.json).

| Language | Installed automatic labels | Operational path / limit |
| --- | ---: | --- |
| asl — American Sign Language | 2000 | Research model, isolated signs |
| bsl — British Sign Language | 1064 | Research model, isolated signs |
| isl — Indian Sign Language | 263 | Research model, isolated signs |
| lse — Spanish Sign Language | 300 | Research model, isolated signs |
| auslan — Australian Sign Language | 0 | Personal only; automatic model in preparation |
| csl — Chinese Sign Language | 0 | Personal only; no automatic model |
| lsf — French Sign Language | 0 | Personal only; no automatic model |
| dgs — German Sign Language | 0 | Personal only; no automatic model |
| libras — Brazilian Sign Language | 0 | Personal only; no automatic model |
| lsa — Argentine Sign Language | 0 | Personal only; no automatic model |
| nzsl — New Zealand Sign Language | 0 | Personal only; no automatic model |
| jsl — Japanese Sign Language | 0 | Personal only; no automatic model |
| ksl — Korean Sign Language | 0 | Personal only; no automatic model |
| tid — Turkish Sign Language | 0 | Personal only; no automatic model |
| uaesl — Emirati Sign Language | 0 | Personal only; no automatic model |
| ssl — Saudi Sign Language | 0 | Personal only; no automatic model |
| egysl — Egyptian Sign Language | 0 | Personal only; no automatic model |
| lis — Italian Sign Language | 0 | Personal only; no automatic model |
| lgp — Portuguese Sign Language | 0 | Personal only; no automatic model |
| ngt — Sign Language of the Netherlands | 0 | Personal only; no automatic model |
| vgt — Flemish Sign Language | 0 | Personal only; no automatic model |
| dsgs — Swiss German Sign Language | 0 | Personal only; no automatic model |
| irsl — Irish Sign Language | 0 | Personal only; no automatic model |
| pjm — Polish Sign Language | 0 | Personal only; no automatic model |
| usl — Ukrainian Sign Language | 0 | Personal only; no automatic model |
| rsl — Russian Sign Language | 1000 | Research model, isolated signs |
| lsm — Mexican Sign Language | 0 | Personal only; no automatic model |
| lsc — Colombian Sign Language | 0 | Personal only; no automatic model |
| lsch — Chilean Sign Language | 0 | Personal only; no automatic model |
| lsp — Peruvian Sign Language | 0 | Personal only; no automatic model |
| sasl — South African Sign Language | 0 | Personal only; no automatic model |
| ksl_ke — Kenyan Sign Language | 0 | Personal only; no automatic model |
| bisindo — Indonesian Sign Language | 0 | Personal only; no automatic model |
| bim — Malaysian Sign Language | 0 | Personal only; no automatic model |
| sgsl — Singapore Sign Language | 0 | Personal only; no automatic model |
| tsl — Thai Sign Language | 0 | Personal only; no automatic model |
| fsl — Filipino Sign Language | 0 | Personal only; no automatic model |
| psl — Pakistan Sign Language | 775 | Reference DTW, one example per label |
| bdsl — Bangla Sign Language | 401 | Research model, isolated signs |
| vsl — Vietnamese Sign Language | 0 | Personal only; no automatic model |


RSL's 1,000 classes comprise 967 words and 33 letters; Bangla's 401 classes map to 398 unique glosses. ASL fingerspelling is a separate research mode with the unchanged conditional confidence/uncertain-candidate policy. The full build loads/checks RSL through its verified installer/cache. The existing Vercel Git build command does not invoke that installer; preview model completeness cannot be certified without access to the deployed runtime.

**Preview, reproduction, rollback and remaining blockers**

Vercel's GitHub check confirms a successful preview deployment for source commit `7528959c595b8466f8c82de0c9bf4207c5dccedd`: [deployment status](https://vercel.com/adam-s-team4/signrelay/EpLMQcZzWFhdB2v5235SuZ9eQupo), [branch preview](https://signrelay-git-codex-engineering-sprint-2026-11-02-adam-s-team4.vercel.app). The connected Vercel API/protected-fetch path cannot resolve/access this team's deployment. There is **no successful deployed-preview browser smoke**; no protection setting was changed. Local export/browser results must not be called preview validation.

Use Node 22.13+ and the unchanged lockfile. The paired laboratory workflows pin the exact parent and frozen Python dependencies. Commands below are builds/tests only:

```sh
npm ci
npm run typecheck
npm test
npm run lint
npm run build:worker
npm run build:firebase
npm run test:rendered
npm run repo:guard
npm run audit:deps                 # expected failure until the advisory is resolved
node --expose-gc scripts/benchmarks/personal-sprint.mjs --out work/personal.json
node scripts/benchmarks/sprint-browser.mjs /path/to/chrome work/browser.json
node --expose-gc scripts/benchmarks/matcher-memory.mjs work/retention.json
node scripts/diagnostics/summarize-sprint-evidence.mjs
node scripts/diagnostics/summarize-sprint-evidence.mjs docs/engineering-sprint-2026-11-02/evidence/same-host
```

For new synthetic reports, set `RUN_EXPERIMENTS=1`, `RUN_LOW_THROUGHPUT_REPORT=1`, `SIGNRELAY_EXPERIMENT_REPORT` and `SIGNRELAY_THROUGHPUT_REPORT` to new output files, then run the two corresponding test files. Do not overwrite historical evidence. CPU tracking, real RGB, native inference and synthetic inputs remain separate in each report.

To roll back the whole unmerged sprint without touching existing data or branches:

```sh
git worktree add ../SignRelay-before-engineering-sprint 116fe686f7b31ecd00ac57ee4724287affafda0f
cd ../SignRelay-before-engineering-sprint
npm ci
npm run build:rehearsal
```

For the DTW optimization alone, revert commit `26807ff7f3459f16c6cea3e982f49a902820c0ab` on a new review branch, rebuild workers and rerun the tests. Stored examples require no rollback or migration. No Firebase rollback is needed because Firebase was untouched. The parent remains research-only.

Remaining blockers are the development dependency advisory, PopSign publisher trust repair or licensed frozen local recovery, deployed-preview access/model completeness, independent signer and negative-data review, representative SORRY/no-sign/OOV recordings, physical-left/mirror/J/Z/repeated-letter qualification, webcam sensor-to-overlay latency, successful GPU execution, mobile browser/thermal/memory tests and the existing throughput preflight. No collection, physical-device validation or production-readiness result is fabricated to close them.
