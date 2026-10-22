# Sprint 5 root-cause report, 22 October 2026

Every fix was reproduced before it was made and has a regression check that failed before and passes after. "Headless Chromium" means `/opt/pw-browsers/chromium-1194` on this container, on the rehearsal export with synthetic landmarks and injected faults. That is software behaviour, not a device or user test.

## E1. One external host reset made the Firebase build and the pilot fail like a code failure (objectives 02, 03)

- **Symptom.** On PR #39, the Firebase build and the real-video pilot failed three pushes in a row (`6555f92`, `5511972`, `ed8f461`). `install-rsl-model.mjs` got `fetch failed … ECONNRESET` about 2 s into the 141 MB download and exited 1.
- **Root cause.** One request, no retry, no cache, and a generic exit code. A transient outage of one host blocked two required workflows and read like a code regression.
- **Fix.**
  - The installer now retries only transient failures: request errors, interrupted or short transfers, and HTTP 5xx/429. It makes at most 4 attempts, with 5/15/45 s backoff.
  - Integrity failures are never retried and never installed (exit 65). An unreachable host exits 75 with a "not a code failure" message and a GitHub `::error` annotation.
  - The three workflows that build the full export restore the model from the Actions cache (key: the manifest's hash). They always run the same size and SHA-256 verification, and save the model only after it has verified.
- **Tests.** `tests/install-rsl-model.test.ts` (5 tests: retry then install; bounded give-up; short body and 503 retried, 404 not; tampered and oversized bytes refused; cached copy reused, corrupted one replaced) and `tests/ci-triggers.test.ts` (step order and an unconditional verify step).
- **Evidence.**
  - Locally the host is unreachable: 4 attempts, then exit 75 with nothing installed.
  - CI on PR #40, first run: cache miss, one download, verified. The save lost a race with a parallel job writing the same key, which gave only a warning.
- **Commit.** `d651537`.

## E2. A saved personal example was reported as "could not save" (objective 13)

- **Symptom.** With IndexedDB list reads failing after the save committed, recording an example showed "This browser could not save the example". The example was in IndexedDB. The message invites re-recording, and so duplicates.
- **Root cause.** `recordCalibration` wrapped the save and the list reload in one `try`, so any reload failure was reported as a save failure.
- **Fix.** `saveCalibrationTemplateAndReload` returns `{ templates: null }` when the save committed but the re-read failed. The message then says the example was saved and that reloading the page starts using it.
- **Tests.** `user-feedback-fault-smoke` case 1 (failed on the old build with the exact false message) and a unit test with an in-memory IndexedDB. Commit `f3a7ed3`.

## E3. A committed removal was reported as "could not be removed" (objectives 13, 18)

- **Symptom.** The same pattern for Remove: the examples were deleted, but a failed re-read showed "could not be removed" and the word stayed marked as taught.
- **Fix.** Only a failed delete reports failure. After a committed delete, the list is re-read, or else the deleted examples are dropped from it.
- **Test.** `user-feedback-fault-smoke` case 2 (failed on the old build). Commit `f3a7ed3`.

## E4. Clear local data claimed success when browser storage refused (objectives 15, 18)

- **Symptom.** With `localStorage` throwing, Clear local data said "Local transcripts, settings and personal signs were cleared from this browser."
- **Root cause.** `clearLocalSignRelayData` swallowed the exception and returned nothing, so the caller could not tell.
- **Fix.** It returns whether it worked. The message names exactly what could not be removed and points to the browser's site-data setting.
- **Tests.** A unit test in `privacy-storage.test.ts` (fails on the old code) and `user-feedback-fault-smoke` case 4. Commit `f3a7ed3`.

## E5. Speak did nothing at all without the Web Speech API (objective 18)

- **Symptom.** In a browser without `speechSynthesis`, pressing Speak gave no sound and no message.
- **Fix.** The page says speech output is unavailable and that the transcript can still be read or copied. Auto speak stays silent, without repeated messages.
- **Test.** `user-feedback-fault-smoke` case 3 (failed on the old build). Commit `f3a7ed3`.

## E6. The real-video pilot could be skipped by a worker-byte change (objective 05)

- **Symptom.** The pilot's path filter listed `workers/recognition.worker.ts` and some of its libraries, but not every bundled source. A change to, for example, `lib/template-transport.ts` alone would change the evaluated worker's bytes without running the pilot.
- **Fix.** `public/workers/recognition.worker.js` (the committed bundle, which `verify:runtime` requires to match the source) is now a pilot trigger.
- **Related.** The Firebase build and the private-capture smoke had no concurrency group. Superseded pull-request runs are now cancelled; main is never cancelled.
- **Test.** `tests/ci-triggers.test.ts`. Commit `926dce6`.

## E7. Footgun script removed (objective 23)

`scripts/browser-qa-fixtures.mjs` was unreferenced, and it rewrote `out/index.html` to inject a timing script. Run by hand before a deploy, the export would have shipped with it. Removed in `4df0d48`.

## E8. Horizontal overflow at 200 % text and with long words (objective 20)

- **Symptom.** At 390 px with 200 % text, `/models` was 405 px wide and scrolled sideways (WCAG 1.4.4). A 48-character custom word spilled out of the selected-word card and the calibration message at 320 and 390 px.
- **Root cause.**
  - Unbreakable tokens (for example "academic/computational") set the min-content width of the info grid's `1fr` track, which has a minimum of `auto` by default.
  - The header's brand and nav could not wrap.
  - The word containers had no word breaking.
- **Fix.** Grid children may shrink; those text containers break a word only when it cannot fit; the header wraps only when its row overflows. Layouts that already fitted are unchanged.
- **Test.** `transcript-a11y-smoke`: 8 pages at 200 % text and the long-word card. Both checks failed on the old build. A 35-configuration matrix went from 4 issues to 0. Commit `eb17163`.

## Investigated, no defect (details in the ledger)

- **Low-throughput word loss (08).** Two-evidence confirmation under sparse sampling; see [low-throughput.md](low-throughput.md).
- **Remaining template transport cost (09).** About 35 ms at 300 examples, once per template change; below one frame interval.
- **Matcher crash recovery (10)**, **rapid language switching (07)**, **settings migration (15)** and **auto-speak queueing (17).** For 17 the policy is documented in [speech-policy.md](speech-policy.md) and left unchanged.
