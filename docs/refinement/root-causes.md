# Sprint 4 root-cause report, 22 October 2026

Each defect below was reproduced before it was fixed, and each has a regression test that failed before the fix and passes after. "Headless Chromium" means `/opt/pw-browsers/chromium-1194` on this container, on the rehearsal or demo export with a synthetic fake camera. That is software behaviour, not a device or user test.

## D1. Strict dependency audit red on `main` (objective 02)

- **Symptom.** `npm run audit:deps` and `npm audit --audit-level=moderate`, and therefore the strict `audit:security` release gate, failed on `0637237` with two moderate advisories.
- **Root cause.** GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp against `@vitest/mocker` ≤ 4.1.11 were published after #38 merged. They are dev-only, through `vitest`.
- **Fix.** `vitest` 4.1.12, the patched release in the same minor (MIT). The lockfile changes only the vitest family plus the `chai` 6.3.0 and `tinyrainbow` 3.2.0 bumps that vitest requires (both MIT). npm 10.9.4 crashed in arborist's peer-set loader, so the update was resolved with `--legacy-peer-deps`, which left every other entry unchanged. An npm 11 attempt was discarded: it also bumped vite and dropped optional `@emnapi/*` entries.
- **Evidence.** `npm audit`: 2 moderate → 0. `audit:deps` ok. 871/871 tests unchanged on 4.1.12. Commit `ae6f269`.

## D2. Saved settings never survived a reload (objectives 17, 19)

- **Symptom.** Turn on Auto speak (or change volume, rate or overlay), reload: the defaults come back. Reproduced in headless Chromium. Storage read `autoSpeak:true` after the toggle and `autoSpeak:false` after the reload.
- **Root cause.** `components/translator-experience.tsx` persisted `settings` from an effect. That effect also ran on mount with `DEFAULT_SETTINGS` and wrote them to `localStorage` before the deferred `loadSettings()` read the stored record. The same effect re-created the record immediately after **Clear local data**.
- **Fix.** Settings are written only by `updateSettings`, the path for a change the person makes. Load and clear set the state and the ref without writing.
- **Test.** `tests/transcript-a11y-smoke.mjs`, the "settings persist across reloads and stay cleared after Clear local data" check: failed 3/3 before the fix, passes after. Commit `ccbecfa`.

## D3. Personal-sign storage lost its three-example limit under concurrent saves (objective 16)

- **Symptom.** Two saves of the same word that overlap (a double click, two tabs) kept 4 examples instead of 3. An example saved just before **Remove** survived the removal.
- **Root cause.** `saveCalibrationTemplate` and `deleteCalibrationGloss` read existing examples in one IndexedDB transaction and wrote or deleted in a second. Both overlapping saves read the same two old examples, so neither pruned.
- **Fix.** Read, prune and write run in one readwrite transaction, which IndexedDB serialises. The schema, the limit and the newest-first order are unchanged.
- **Test.** `tests/calibration-storage-concurrency.test.ts` uses an in-memory IndexedDB that runs transactions one at a time, a schedule real IndexedDB may legally choose. 2 of 3 tests failed before the fix (`a,b,c,d` kept, and `b` survived Remove); all pass after. Commit `64ed44d`.
- **Related UI fixes (`ccbecfa`).** Remove reported nothing and left an unhandled rejection when storage failed; it now says so and reloads what is stored. **Clear local data** cancels an example being recorded, which could otherwise be saved right after the clear, and re-reads storage instead of assuming it is empty.

## D4. Personal templates stalled recognition for up to ~0.6 s (objectives 09, 11, 20)

- **Symptom.** With 300 personal examples, the first hand frame after templates arrived waited ~415 ms. Re-sending templates mid-session, as after saving an example, held frames for ~618 ms, and 7 of 35 frames went unanswered. Sprint 3 measured 407 ms.
- **Root cause.** Templates were structured-cloned as ~7,000 nested arrays on both hops (page → recognition worker → matcher). The matcher worker was created, and sent every template, inside the first hand frame's handler.
- **Fix.** `lib/template-transport.ts`: one transferred `Float64Array` plus metadata, bit-exact, so decisions cannot change. The personal matcher starts when templates arrive (PSL stays lazy). See [first-frame-stall.md](first-frame-stall.md) for before/after under identical conditions.
- **Tests.** Exact round trip (including `-0`, `NaN` and 208-feature rows), identical personal decisions, the buffer is transferred, eager personal and lazy PSL start, a real-worker personal confirmation in 8 languages with both transports, and a session restart re-sending the packed templates. Commit `df41ac3`.
- **Consequence.** The recognition worker bundle changed (`ccce84c8…` → `39a5f2c3…`). It must reproduce the 11-trial established baseline in the paired real-video pilot before it carries real-video evidence. See the ledger, objective 25.

## D5. Record during camera start-up never recorded (objectives 13, 14)

- **Symptom.** **Start camera & record** is shown until the camera is active. Pressing it while the camera was still starting showed "Start the camera before recording a personal sign example." and did not record. Reproduced in headless Chromium.
- **Root cause.** `requestCamera` returned immediately when a request was already pending, so `recordCalibration` saw no engine.
- **Fix.** A second caller receives the in-progress request's promise and waits for it.
- **Test.** transcript-a11y-smoke, "record pressed during camera start-up waits for the camera". Commit `43ae740`.

## D6. Keyboard focus lost after saving a transcript edit (objective 19)

- **Symptom.** Pressing Enter to save an edit removed the focused input, and focus fell to `<body>`.
- **Fix.** Focus returns to that entry's Edit button, or to the transcript heading when the edit emptied and removed the entry.
- **Test.** transcript-a11y-smoke, the keyboard edit checks. They failed on the old build ("dropped keyboard focus") and pass after. Commit `43ae740`.

## D7. About page scrolled sideways on a 320 px phone (objective 19)

- **Symptom.** At 320 px, `/about` was 381 px wide, so the page and the cookie banner scrolled horizontally. The other 7 info pages and the workspace fit at 320 and 390 px.
- **Root cause.** The info-page title has a 3.2rem minimum. "communication." at 51.2 px is 359 px in a 276 px box, and mobile Chrome widened the layout viewport to fit it. Element rectangles did not show it, because text overflow does not change the box.
- **Fix.** Below 560 px the title scales with the viewport (`clamp(2.25rem, 12vw, 3.2rem)`) and may break a word that still cannot fit.
- **Test.** transcript-a11y-smoke checks 8 pages at 320 and 390 px. It failed on `/about` with the old CSS and passes after. Commit `80a4395`.
