# Engineering stabilisation, 31 October 2026

## Scope and branch dependencies

This change is stacked on research branch `claude/festive-dirac-pbwx2j`, exact parent `996b0d2925e882e15ed303cd3f2b459e261be962`. That branch already contains PR #46 (`6eb9c64`), #45 (`e0b1f35`), #44 (`fc95a6f`) and #43 (`06316aa`). Main remains `e63fffe`. No source PR was merged, retargeted or otherwise changed. The research parent includes ASL input-adapter changes which require separate review; this PR does not introduce recognition behavior or replace model weights.

Review in dependency order: #44 incorporates #43 and earlier integration; #45 targets #44; #46 targets #45. Do not independently merge duplicate #43 changes after integrating #44. Do not merge this research stack into main while the real-clip and device gates remain blocked.

## Root causes

- [Video pilot 41171793012](https://github.com/adamjamiesimson/SignRelay/actions/runs/41171793012): Python's verified HTTPS request to the official PopSign archive failed with `unable to get local issuer certificate`, before any replay. The frozen clip downloader had no CA-completion step and no transport retry. The unchanged #45 control had failed at the same acquisition step. This is not evidence of a recognition regression.
- [Diagnostics 41064295875](https://github.com/adamjamiesimson/SignRelay/actions/runs/41064295875): publisher WLASL download and conditions A/B succeeded. Condition P failed retrieving the PopSign directory with the same issuer-chain error. Retrying the same trust failure cannot repair a missing chain. The newer parent had already made P non-blocking for independent WLASL evaluation, but this could conceal overall incompleteness. P failure now explicitly fails the final run after the independent reports are retained.
- [Landmark candidate 41070918141](https://github.com/adamjamiesimson/SignRelay/actions/runs/41070918141): CA-issuer retrieval repeatedly reset/returned empty responses. Eight outer retries multiplied curl's own retries. Extraction was skipped. `train: if: always()` nevertheless ran; wildcard artifact download accepted zero artifacts and the next `ls landmarks` failed. This was orchestration failure, not a model-training failure.

The prior research report identifies an omitted intermediate chain ending at emSign Root TLS CA - G3, which was not anchored by that runner's roots. The provided logs establish missing-issuer and issuer-host transport failures; they do not establish that installing an arbitrary root is safe. A fresh normal-verification request from this Windows environment also fails (`certificate rejected`). The new CI source checks recovered the issuer and failing root, confirming the root-program incident described below.

## Implemented

- Shared PopSign HTTPS reader: official-host allowlist including redirects, hostname/system trust verification, no downgrade, exact status/Content-Range/size validation, bounded memory, three transport attempts, 20s socket timeout and 60s attempt budget checked between single socket reads. Certificate and integrity failures fail without retries. A blocked socket can extend the attempt by at most its 20s timeout. Frozen SHA-256 requirements remain mandatory.
- Frozen clip recovery from existing licensed local files named `<frozen-sha256>.mp4`, with size/hash revalidation, atomic output and the same sealed-holdout guard. No media is uploaded or newly mirrored. Acquisition failures include a specific recovery message.
- One CA-chain utility replaces the two diverging implementations. One 240s overall budget, bounded HTTPS-only AIA retrieval, root/hostname/server-purpose/expiry verification before publishing a bundle, cleanup and stale-output removal. Only intermediate CA candidates independently anchored to existing OS roots enter the bundle. No Certificate Transparency shotgun queries, new trust roots or ignored certificate errors.
- Landmark training requires successful CA and extraction jobs. Every expected train/test shard, SHA-256 sidecar, nonempty array, frame span and recording provenance is checked before importing torch. Empty or incomplete extraction is not a valid artifact. Candidates remain research artifacts and are never installed in production.
- Short source checks on relevant PRs; full landmark training stays manual-only. No schedules were added. There were no local Codex automation definitions to amend; the external source of repeated dispatches could not be identified. Stop redundant external dispatches until trust/source state changes, and retain the failed gate as visible evidence.
- Remove the CSS green recolouring filter from the original `public/signrelay-mark.webp`. The asset itself is unchanged from its original repository commit `3e12997`. Fix the existing Models-page JSX apostrophe lint error without changing the text shown.

## Secure recovery

Prefer repair by the dataset publisher. Do not restore the distrusted emSign G3 hierarchy. For unrelated missing-intermediate cases only, supply reviewed intermediates in `SIGNRELAY_CA_INTERMEDIATES`; these still require anchoring to current OS roots. Update OS roots only through the runner's supported `ca-certificates` distribution. Never trust a leaf or an unverified self-signed root.

For frozen clips already held under CC BY 4.0, run `python training/fetch_evaluation_clips.py --clip-cache /private/licensed-clips`, where each filename is the original frozen SHA-256 plus `.mp4`. Use the same flag with the existing development manifest. Keep source/licensing records, local media and sealed holdout separation unchanged. This path was tested using disposable byte fixtures, not substituted evaluation recordings. A fresh CI runner still needs a verifying upstream or an owner-provisioned licensed local recovery source.

## Validation so far

Executed successfully: TypeScript, full ESLint, local `build:firebase`, runtime-manifest verification, repository asset guard, rendered-export checks (2), full Vitest (976 passed, 2 skipped; 99 files), 14 Python acquisition tests, 5 artifact tests, actionlint 1.7.7 on all four changed workflows, whitespace/diff checks. Worker SHA-256 is `ec7b6d01b89467339b1a957c1f8714d8a4044a23b24a751ad4fe2a403a7aa557`, unchanged from the research parent.

The first sandboxed suite loaded no tests because Windows denied temporary file renames. A later run encountered checkout CRLF byte mismatches and one 5s timeout under concurrent load. After restoring clean files to exact committed LF bytes, the complete suite passed at unchanged test timeouts with two workers. The first build attempt had a local npm-wrapper error; another encountered CRLF asset hashes. Final full build passed after those environment corrections. No expected hashes or gates were weakened.

The existing workspace browser smoke failed: local navigations reported `net::ERR_ABORTED`; cleanup then encountered a locked Chrome Crashpad file. That is not a successful application smoke. Later checks and CI outcomes will be appended; webcam/phone signing, natural THANK YOU/SORRY and no-sign/OOV accuracy remain unverified.

The paired existing synthetic DTW benchmark completed with equal decisions in every comparison. At 300 personal examples, full-matrix baseline / current warm matching was 4761/178 ms (easy), 3968/662 ms (near ties), 4094/108 ms (spread), 4106/143 ms (matching example last). These single-run measurements were taken under load, compare existing algorithms, and are not new gains attributable to this PR, neural recognition latency, tracking latency or accuracy. Raw output is in `personal-benchmark.txt`. The historical 121/232 to 74/151 ms tracking evidence was not rerun, and this change leaves tracking/recognition source and bundles unchanged.

## Production and previews

Firebase was inspected read-only and was not deployed. Its public runtime manifest reports worker `b454deb00b6e6aa4cba099e23bf96ed0a7ffd73058a2c725a6a16c610e3fa523`, matching #45, rather than main/#46/the research candidate. It contains no source commit field, so worker identity does not prove the exact deployed Git SHA. Firebase release metadata is still required for that confirmation.

Vercel lists project `signrelay` / `prj_iex47ijk2AxB7IhZtSfvTv9CmYdW` / team `team_sVaGCKWS0jMCBYqm4MFCjxvE`, but listing deployments returns 403. GitHub's Vercel-bot comments report ready previews for #43, #44, #45 and #46; those comments are historical, not a fresh smoke pass. Exact new-PR preview and CI evidence will be added when available. No Vercel CLI with independent authenticated credentials was available.

## Release blockers

P0: external PopSign trust/availability prevents the real-clip gate; latest research worker has no real-video validation. Do not release it or weaken thresholds.

P1: review the research parent and PR stack; independently confirm Firebase release SHA; resolve Vercel access; complete successful preview/browser smoke and physical device/signing checks. Missing representative no-sign/OOV and SORRY data cannot be supplied by synthetic tests.

P2: stop externally scheduled retry spam at its actual source; preserve the failed gate and re-run only after a relevant source/trust change. The known BSL hand-confidence issue in the parent report requires a licensed BSL evaluation before behavioral changes.

Firebase production requires the owner's explicit approval after all release gates are satisfied. This PR is for engineering review, not release approval.

## Current root-program incident (confirmed by new CI)

The PR's new [diagnostic source check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485473) and [landmark source check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485476) independently recovered the current certificate chain metadata. Leaf: `signdata.cc.gatech.edu`, issuer `InCommon Intermediate CA - OVG3C`, valid 9 October–8 November 2026. Verification stops at depth 2, `emSign Root TLS CA - G3`, error 20. Landmark extraction AND training correctly remain skipped; no missing-directory training failure is produced.

This is consistent with a documented root-program distrust event, not merely a missing CA file. [Google's 20 October security notice](https://blog.google/security/protecting-chrome-and-android-users-from-compromised-emudhra-intermediate-ca-certificates/) reports compromised subordinate CA keys and removal of emSign ECC Root CA - G3. [InCommon's current guidance](https://incommon.org/certificates) says affected ECC certificates need renewal and documents restored issuance via G1. [Mozilla's incident record](https://bugzilla.mozilla.org/show_bug.cgi?id=2083449) identifies InCommon OVG3C subscribers among those needing transition. This does not establish that the host's particular leaf or the InCommon intermediate key was compromised; it establishes that its hierarchy is no longer an acceptable trust path.

**Recovery correction:** do not restore the emSign G3 hierarchy through a cross-sign, custom root bundle or an older trust store. The publisher must reissue under an unaffected trusted hierarchy. The generic intermediate-candidate option is only for unrelated missing-intermediate cases and now explicitly rejects emSign G3 issuer/subject chains even with an older system bundle. Frozen, previously acquired licensed clip copies remain a recovery option under the unchanged size/hash/cohort controls. The earlier generic cross-sign guidance above does not apply to this incident.

## First review-commit CI and browser evidence

Review commit: `62ba5eb701076dd86b0776bc96b3a8ba93592c4e`, [draft PR #47](https://github.com/adamjamiesimson/SignRelay/pull/47).

- [Core CI](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485433): Python tests, offline CA-chain tests, all 976 unit tests, lint, workers, both matching benchmarks and full-history secret scan passed. The run fails the unchanged dependency audit because a new development-only minimatch advisory was published on 30 October: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), currently reported against 16 packages. Production audit reports zero advisories. No exception was added. The patched line is 11.0.1+, while installed callers include both callable minimatch 3 and object-export minimatch 10. A blanket major override breaks legacy lint-plugin APIs, so it is not an acceptable untested fix. A compatible upstream migration/backport or explicitly reviewed development exception is still needed; the strict release audit remains blocked regardless of an exception.
- [Video pilot](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485543): acquisition blocked by the same emSign hierarchy; no real video replay.
- [Diagnostic source check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485473): source check failed on the trust boundary; full research evaluation was intentionally not run in PR mode.
- [Landmark source check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485476): source check failed; both extraction and training skipped. This verifies removal of the original misleading training failure.
- [Analytics consent](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485500): passed.
- [Firebase build check](https://github.com/adamjamiesimson/SignRelay/actions/runs/41203485522): build/export/runtime, unit tests/lint, workspace switching, model lifecycle, RSL/Bangla/Spanish browser flows, self-hosted vision and axe checks passed before its final audit stage. Overall result must still be read separately from successful steps. This workflow builds only; it does not deploy.

The local workspace browser failure was traced to inherited proxy configuration. Clearing HTTP(S)/ALL_PROXY for this localhost-only check produced a successful rerun covering footer navigation, language/transcript isolation, storage failures, late/denied/cancelled permission, stopped stale tracks, duplicate speech suppression, confirmed-only announcements, clipboard and rapid switching. Local offline-vision smoke also passed after the same correction. Later stress/fault results are recorded separately.

GitHub's Vercel bot reports this review commit READY at [the exact branch preview](https://signrelay-git-codex-stabilisation-2026-10-31-adam-s-team4.vercel.app). A direct smoke request redirects to Vercel login; connected Vercel access cannot fetch it. This is a protected-preview access blocker, not a successful smoke or an application HTTP 200. Deployment Protection was not disabled.
