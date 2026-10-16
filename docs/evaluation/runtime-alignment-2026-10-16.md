# MediaPipe alignment and dependency investigation, 16 October 2026

**Decision: adopt the matching MediaPipe 0.10.35 JS/WASM pair in the draft branch. Release remains blocked.** The eleven existing development recordings retain exactly the same accepted words. This resolves runtime-version inconsistency, not the remaining ASL confusion or the missing accuracy evidence.

## Runtime change

The installed and locked JavaScript was already 0.10.35, while the WASM/glue URL was 0.10.22-rc.20250304. The dependency is now an exact `0.10.35` pin; no JavaScript package bytes changed. `lib/vision-runtime.mjs` provides one version and WASM URL to the production VisionEngine, CSP, diagnostic forwarding, evaluator and lab metadata. Production build and lab preparation reject any manifest, lockfile or installed-package mismatch. CSP still permits only the exact runtime path.

The video workflow now triggers for runtime, package, CSP and diagnostic changes. Its original same-runtime worker comparison and wrong-word gate remain strict. A separate, explicitly declared runtime experiment compares the old and new pairs, requires identical worker bytes, source recordings, frame counts, orientation, vocabulary and model mapping, and rejects incomplete trials, new wrong acceptances and loss of an existing correct recognition. Tests cover those rejection paths.

## Paired development recordings

One fresh pass per runtime and cohort, using the unchanged production recognition worker, Google Chrome for Testing 151.0.7922.34 headless shell, unmirrored unique decoded source frames at up to 20 Hz, fresh tracker/worker state per clip and no added end pause:

| Cohort | JS / WASM | Correct | Wrong accepted | Abstained | Runtime errors |
| --- | --- | ---: | ---: | ---: | ---: |
| Historical development, 6 clips / 2 source signers | 0.10.35 / 0.10.22-rc.20250304 | 2 | 1 | 3 | 0 |
| Same historical clips | 0.10.35 / 0.10.35 | 2 | 1 | 3 | 0 |
| Additional development, 5 clips / 4 source signers | 0.10.35 / 0.10.22-rc.20250304 | 2 | 0 | 3 | 0 |
| Same additional clips | 0.10.35 / 0.10.35 | 2 | 0 | 3 | 0 |

Both runtime comparison gates pass with **zero output changes**. Historical hand-visible frames change from 100 to 101 of 220; the extra observation is on the already-abstaining PLEASE `.8031` clip. Additional-development hand-visible frames stay 49 of 194. Increased tracking alone is not an accuracy result. Historical THANK YOU `.8033` still emits PLEASE; the version mismatch does not explain or repair that error in this replay.

These are the same publisher-labelled, already inspected recordings, not new independent observations or a release holdout. SORRY is missing. There are zero real no-sign/OOV trials; their false-acceptance rates remain null. Independent fluent-signer review and physical-phone/handedness measurements remain outstanding. The five reserved recordings were not fetched, viewed or predicted during this follow-up.

Source identity: mixed-runtime rows were captured from clean `07996957d5134129273f92863773ca50a3bd0715` source. Candidate rows record that evaluator parent and `harness_dirty=true` because the alignment was uncommitted during capture. [Verification metadata](runtime-alignment-2026-10-16/verification.json) fingerprints the exact candidate source files included with this report. Recognition worker SHA-256 remains `c016a365d0c73455aa6564affabee35d5d49d0ed824b7b59d8bdf5a986b7d7fe`. All 56 previous model fingerprints match. The captured JSONL files are unmodified. A truncated local Chrome extraction initially failed before any trial; it contributes no successful evidence. The successfully completed captures contain 22 trial rows with empty error arrays. Browser summaries also observed aborted blob loads during video teardown.

[Historical runtime comparison](runtime-alignment-2026-10-16/historical-runtime-comparison.json), [additional-development comparison](runtime-alignment-2026-10-16/development-runtime-comparison.json), and [captured rows and checks](runtime-alignment-2026-10-16/).

## Browser and build verification

| Boundary | Evidence |
| --- | --- |
| Static export and protected pages | Secured export and both rendered/security checks pass; ephemeral lab files removed afterward |
| Runtime startup → camera tracking | Spanish workspace starts the actual matching Tasks pair with a synthetic camera |
| Local checkpoint → worker inference | Three actual Spanish model inferences complete; this is execution coverage, not signing accuracy |
| Pause/navigation → cleanup | Camera released, navigation succeeds, no POST uploads or uncaught page errors in the Spanish check |
| Workspace lifecycle | Transcript isolation, both storage-failure paths, four late camera-grant track releases, denied permission/retry and dedicated Russian/Bangla views pass |

Local checks: **330 tests / 41 files**, TypeScript, ESLint, worker bundles, secured static export, two rendered tests, asset policy and secret/history scan pass. Runtime and CSP guards pass. The browser check's 390px viewport is emulation, not physical-device testing. The strict full dependency audit exits 1; production audit reports zero findings. Hosted exact-head CI status is linked in PR #30 after the commit is available.

## Remaining dependency findings

The full audit still reports five high package findings in one chain:

`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`

The current [GitHub advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched release for `braces <=3.0.3`. Registry checks confirm latest `braces` 3.0.3 and latest Next lint plugin/config 16.4.2. The plugin pins fast-glob 3.3.1; even fast-glob 3.3.3 still depends on micromatch and affected braces. The [upstream patch request](https://github.com/micromatch/braces/issues/84) is closed, with no supported fix published. The advisory remains active despite the maintainer disputing it. These are development-tooling findings; the production audit is clear. This does not waive the full audit.

A direct alias to the already installed tinyglobby 0.2.17 was investigated and rejected. In the actual API shape used by Next's `getRootDirs` (`globSync(pattern, {onlyDirectories:true})`), a literal `app` produces only `app` with fast-glob but also its `app/nested/` descendant with tinyglobby. Wildcard and trailing-slash behavior differ too. The [six-case result](runtime-alignment-2026-10-16/rejected-glob-replacement.json) demonstrates why a package-name substitution is not a verified fix. No alias, lint downgrade, audit exception, force-fix or disabled rule was committed.

Clearing this chain requires an upstream supported fix or a separately reviewed replacement/adapter with directory-discovery compatibility coverage. A clean audit cannot be claimed from the currently published supported packages. [Full audit](runtime-alignment-2026-10-16/audit-full.json), [production audit](runtime-alignment-2026-10-16/audit-production.json) and registry snapshots are preserved alongside the evidence.

## Reproduction and next work

Use the frozen historical and additional-development manifests and `training/fetch_evaluation_clips.py`; never replay the sealed manifest while tuning. Build the secured export, then prepare the ephemeral lab. Capture mixed-runtime results from an isolated `0799695` checkout before rebuilding the aligned export. Supply each resulting pair to:

```sh
node scripts/verify-vision-runtime-change.mjs manifest.json mixed.jsonl aligned.jsonl 0.10.35 0.10.22-rc.20250304
```

The ordinary `compare-recognition-evaluation.mjs` and `verify-video-pilot.mjs` still reject cross-runtime worker comparisons. Use the new runtime-specific command only for this declared runtime experiment. Rebuild before deployment to remove diagnostics; this follow-up performed no merge or deployment.

The next recognition work needs independently reviewed development footage for the six starter signs, particularly THANK YOU and PLEASE boundaries, SORRY, ordinary gestures, incomplete movements and verified unsupported signs. The existing [collection requirements](collection-requirements-2026-10-16.json) and [physical-phone/handedness protocol](sprint-release-readiness-2026-10-16.md) remain applicable; use the now-matching 0.10.35 pair. Do not tune a semantic workaround to the one historical error or consume the reserved holdout to guide changes.
