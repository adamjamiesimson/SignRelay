# SignRelay release candidate: qualification and integration audit

| | |
|---|---|
| **Branch** | `claude/charming-thompson-2aql9w-rc` (also the head of draft PR #53, `claude/charming-thompson-2aql9w-release`) |
| **Commit** | see "Release-candidate commit" in PR #53; this document is part of that commit |
| **Base** | `main` at `e63fffe` (currently deployed main); the RC is 225 commits ahead and 0 behind |
| **Scope** | qualification only: no new recognition features, no model changes, no merge, no deployment |

Every result below says how it was obtained:
- **local**: this container's headless Chromium with a synthetic camera;
- **CI**: GitHub Actions on PR #53;
- **synthetic**: generated inputs.

Nothing here is a physical-device, real-webcam or independent-signer measurement.

---

## 1. P0: production build isolation for research fingerspelling

### Independent audit findings (fixed in `fead5bf`)

| # | Leak path found | Consequence before the fix | Fix |
|---|---|---|---|
| 1 | `vercel.json` ran `next build` directly, never `prune-research` | A Vercel **production** deployment resolved the flag off, but would still **publish the three research ONNX weights and both fingerspelling workers** from `public/` | The build command now ends with `node scripts/prune-research.mjs out` |
| 2 | "On in `next dev`" was keyed off `NODE_ENV === "development"` | A stray `NODE_ENV` could switch a production build on | `next.config.ts` is now a function of Next's config phase; only `PHASE_DEVELOPMENT_SERVER` defaults on |
| 3 | `.env*` files are loaded by Next but not by the export scripts | `.env.local` with the flag `on` would inline the UI while pruning saw `off`, giving a broken, mixed export | `prepare-export` refuses the flag in any `.env*` file |
| 4 | A leftover shell export of the flag | `npm run build` (production) would ship research fingerspelling | `assertReleaseSafe` refuses `on` for a `full`, non-preview export unless `SIGNRELAY_RESEARCH_EXPORT=1` is also set. It runs in `prepare-export` and in `prune-research`, so the Vercel build is covered too |
| 5 | Verification trusted the environment | A mismatch between the inlined flag and the expected value was invisible | `verify-runtime` now inspects the **compiled client** for the fingerspelling workspace markers, records `fingerspelling_ui_compiled`, and fails on any mismatch |

### Artifact matrix

`scripts/release-artifact-matrix.mjs` builds each configuration and inspects the artifact it produces: compiled UI markers, research models and workers, and the manifest. CI runs it in `release-artifact-matrix.yml`, including the real `full` build with the RSL model. Results were 12/12 as expected, both locally (RSL download skipped; the host is unreachable from the sandbox) and on CI run 41625422027, which ran all 12 configurations. That run then failed only while writing its JSON file, which is fixed in this commit.

| Configuration | Expected | Artifact | Research models / workers |
|---|---|---|---|
| `full` default (`npm run build`, the Firebase release) | off | off, UI not compiled, manifest off | 0 / 0 |
| `full` with `NODE_ENV=development` | refused | Next refuses to export | none produced |
| `full` with explicit off | off | off | 0 / 0 |
| `full` with explicit on, no acknowledgement | refused | stopped at `prepare-export` | none produced |
| `full` with on and `SIGNRELAY_RESEARCH_EXPORT=1` (deliberate research export) | on | on | 3 / 2 |
| `full` with the flag in `.env.local` | refused | stopped at `prepare-export` | none produced |
| Vercel production (exact `vercel.json` command, `VERCEL_ENV=production`) | off | off | 0 / 0 |
| Vercel production with explicit on | refused | stopped at `prune-research`; Vercel does not deploy a failed build | n/a |
| Vercel preview (`VERCEL_ENV=preview`) | on | on (research preview preserved) | 3 / 2 |
| `asl-demo` default | off | off | 0 / 0 |
| `rehearsal` default | on | on | 3 / 2 |
| `rehearsal` with explicit off | off | off | 0 / 0 |
| `next dev` server (local) | on | the served client contains the fingerspelling UI | n/a |

### Running page (`tests/production-release-smoke.mjs`)

This test runs on the real production export, locally and now in `firebase-build-check`. It passed 5/5:
1. The research models and workers are absent from `out/` and return 404 when requested.
2. `/?mode=fingerspelling&asl=fingerspelling#fingerspelling` with ASL selected and **real MediaPipe word-mode vision running** shows no mode selector, spelling panel or fingerspelling control. Onboarding never mentions it.
3. Only the `recognition` and `vision` workers are created. No fingerspelling worker, model or worker-script request is made.
4. Pausing the camera ends every track.
5. No external request is made.

**Research access is preserved.** Rehearsal builds, Vercel previews and `next dev` default on. The research CI workflows build the rehearsal profile. `release-flag-smoke on` and `fingerspelling-browser-smoke` (8/8) pass on the research export.

**Known residue.** The off client still contains the inert CTC model contract constants, `LiveVision`'s unreachable `trackingProfile === "fingerspelling"` branch, and CSS for `.asl-mode-selector`. None of it executes, and the running-page smoke test proves nothing is requested.

---

## 2. P1: release-candidate regression

Two kinds of evidence:
- **Local:** the RC's suites, run on this commit's production (`full`), rehearsal and `asl-demo` exports, in headless Chromium with a synthetic camera. **18/18 pass.**
- **CI:** Firebase Static Build Check run 41625421873 on `fead5bf`. It builds the real production export, including the RSL model, and every functional step passes. The only red step is the known dependency gate (§4).

Main's own UI predates the #44 redesign, so RC browser tests cannot run against it. The comparison with main is therefore artifact-level (§3) plus data-compatibility checks in both directions.

| Area | Evidence | Result |
|---|---|---|
| ASL word recognition | `gitex-rehearsal-smoke` (synthetic landmarks through the production pipeline) | Six signs confirmed in order (Hello, Thank you, Please, Sorry, Yes, No). Abstains on three non-sign movements. Recovers after a camera interruption |
| Real tracking runtime | `offline-vision-smoke` (CDNs blocked), `production-release-smoke` | Self-hosted MediaPipe starts; analysis pauses while the tab is hidden; the camera is released |
| Personal signs | `personal-vocabulary-scale-smoke`, `user-feedback-fault-smoke` | 30, 150 and 300 saved examples load and reach the worker. Search and remove survive a reload, with no duplication. Save and remove report storage faults accurately |
| Saved personal-sign compatibility | `rollback-template-compat.mjs`, re-run on this commit (synthetic) | Main ↔ RC in both directions: 6 correct, 0 wrong, 6 no match of 12 in every cell. IndexedDB stays at v1 |
| Language switching | `workspace-browser-smoke`, `landmark-lifecycle-browser-smoke`, BSL/ISL/LSE/RSL/Bangla smokes (RSL in CI) | Rapid switching leaves one live worker. Cancelled runs are discarded for ASL, BSL, ISL and LSE. Spanish ran three real model inferences, Bangla a real ONNX inference, Russian in CI |
| Transcript editing and speech | `transcript-a11y-smoke`, `workspace-browser-smoke` | Edit, remove (focus kept), save & clear, copy. Speech is explicit only. Duplicate confirmations are neither shown nor spoken |
| Onboarding | `onboarding-smoke` | The four-step tour appears on the first visit only. Skip and Escape are remembered. `/#tour` and `?lang` links do not start the camera |
| Camera controls and interruptions | `lifecycle-stress-smoke`, `workspace-browser-smoke` | 12 start/pause cycles (restart p50 7.2 s in headless CPU), 6 rapid toggles leave 0 live tracks, an externally ended track is recoverable, late and denied permission are handled; heap 5→6 MB |
| Worker failures | `fault-injection-smoke` | Recognition worker crash ×3 → 2 automatic restarts, then manual restart. Tracking worker crash recovers. Missing or corrupted model is reported and releases the camera. localStorage failure keeps the workspace running |
| Consent and privacy | CI `consent-check`, `production-release-smoke`, demo strict check | Analytics stays opt-in. No non-loopback requests. The deny-all-proxy demo check passes |
| Offline | `demo:check` (deny-all proxy), `offline-vision-smoke` | Pass |
| Accessibility | `a11y-axe-smoke` (/, /languages, /models, /privacy, /about, active workspace), onboarding axe, transcript checks | **0 WCAG A/AA violations.** Reduced motion stops all animations. No horizontal scroll on 8 pages at 320–820 px, 200% text, or with long words. *Note: 28 of 36 controls at phone width are under 44 px. That is the WCAG AAA target and exceeds the 24 px AA minimum, so it is not a failure; it is flagged for the device check* |
| Responsive layouts | `transcript-a11y-smoke`, BSL/Bangla/Spanish mobile-layout checks | Pass |
| Logo and dark-green UI | Byte comparison with main; owner-supplied green reference (`238c686`) | Logo, favicon, touch icon and social card are **identical to main**. The dark-green theme is the #44 design; owner review is still pending |

The browser runs are software behaviour on a synthetic camera. They are not accuracy, device or assistive-technology measurements.

---

## 3. P2: integration stack audit (main → #43 … #53)

### Ancestry (verified with `git merge-base --is-ancestor`; linear)

| Segment | Head | Commits | Files | App files¹ |
|---|---|---|---|---|
| #43 tracking refinement | `06316aa` | 1 | 28 | 14 |
| #44 integration RC, Sprints 4–7 redesign | `fc95a6f` | 68 | 232 | 43 |
| #45 performance follow-up | `e0b1f35` | 6 | 15 | 2 |
| #46 engineering refinement | `6eb9c64` | 10 | 29 | 7 |
| **`claude/festive-dirac-pbwx2j` (no PR, never reviewed)** | `996b0d2` | 18 | 55 | 10 |
| #47 stabilisation | `fa97370` | 2 | 19 | 2 |
| #48 fingerspelling | `d89cff6` | 59 | 111 | 14 |
| #49 fingerspelling reliability | `116fe68` | 18 | 46 | 7 |
| #50 capture ownership, DTW | `d8cfefc` | 13 | 97 | 4 |
| #51 capture timestamps, diagnostics | `7009705` | 16 | 38 | 6 |
| #52 one-hand tracker | `a213be7` | 6 | 18 | 3 |
| #53 release isolation and this qualification | head | 7+ | 29+ | 9+ |

¹ Files under `app`, `components`, `lib`, `workers`, and the deploy configuration files.

### Findings that affect public behaviour, privacy, storage or deployment

| # | Area | Finding | Source | Risk | Disposition |
|---|---|---|---|---|---|
| F1 | **Public recognition** | **The ASL-2000 model now actually receives hands.** On main, the adapter erased every hand landmark, because MediaPipe reports `visibility: 0`. The model saw body joints only, scoring 0.0% top-1 on publisher keypoints, and 29/29 accepted words were wrong on test videos. On the RC it reaches 22.4% on publisher keypoints and **7–10% top-1 on MediaPipe input, with only ≈13% of accepted words correct** (`docs/evaluation/asl2000-sprint8`). Accepted model words auto-confirm into the transcript after two agreeing results, as on main. | `290735e`, **on the unreviewed `festive-dirac` branch** | Model-sourced words will appear more often on the RC than on main, and most will be wrong. The workspace labels results "Research preview. Check every result." | **Owner decision before public release** (§7). No change was made here: this is a recognition-policy decision |
| F2 | Public recognition | Starter-rule caching (`325a2e1`), ASL-2000 graph speed-up (`ed90363`), exact DTW cutoff (`0bc16a5`) and repeated-cost reuse (`26807ff`). Personal-match thresholds stay at 0.5 accept / 0.06 rival margin. | #45, #46, #50 | Claimed exact; the PRs carry equivalence tests | Accept. Covered by unit tests and the personal-vocabulary scale smoke |
| F3 | Public recognition | Tracking moved to a worker with bounded queues (#43). Tracking-failure invalidation (#46). Word mode keeps GestureRecognizer with two hands (#53 profile: 51 ms median hands). | #43, #46 | Latency and lifecycle behaviour changed | Accept. Covered by lifecycle, fault and offline smokes; device check in the owner checklist |
| F4 | Privacy | No new network destinations. App `fetch` calls are same-origin model loads with pinned bytes and checksums and `redirect: "error"`. Analytics remains opt-in, GPC/DNT is honoured, and `analytics-consent.ts` is unchanged. Camera video never leaves the page. | whole stack | Low | Accept. `consent-check` passes |
| F5 | Storage | Personal signs: IndexedDB `signrelay-personal-vocabulary` stays at v1. Templates gain an optional `normalization: "trajectory-v3"`. Save, prune and delete are now single transactions. New localStorage key `signrelay.onboarding.v1`, documented on `/privacy`. History and settings formats are unchanged. | #43, #44 | Low. Both directions measured (§2) | Accept |
| F6 | Deployment | `firebase.json` and `.firebaserc` are unchanged. `vercel.json` gains the prune step (F-fix 1). `next.config.ts` became phase-aware. No deploy workflow exists, and none was added. The two `contents: write` workflows only commit diagnostics reports on `push` events of research branches. | #53 | Low | Accept |
| F7 | UI and brand | `#44` is a full redesign: the dark-green palette, the first-run tour, and new privacy and terms copy. Logo files (`signrelay-mark.webp`, favicon, apple-touch-icon, social card) are **byte-identical to main**. | #44 | Product change | **Owner review of #44** (unchanged requirement) |
| F8 | Research infrastructure | The PopSign certificate-chain tooling (`3de0d87`, `14e10ac`, …, `festive-dirac`) refuses the distrusted emSign G3 hierarchy. It fetches AIA issuers over HTTPS only and admits intermediates only after OpenSSL verifies them to OS roots. It is not part of the app. | festive-dirac | None found | Accept |
| F9 | Research | Fingerspelling (#48–#52) is research. It is now compiled out of production (§1). | #48–#53 | Mitigated | Keep off |

### Artifact-level release diff (production `full` export, main vs RC)

Both exports were built without the RSL weights:
- **Files:** 141 on main, 151 on RC. Only in RC: `workers/vision.worker.js` (#43); redesign fonts, their licence and `art/chrome-ribbon.webp`; the three fingerspelling licence and accuracy notices (text only); `models/asl2000-tgcn/vocabulary-status.json`. Nothing exists only on main.
- **Models:** no model weight file was added, removed or changed. `verify-vision-runtime`, `verify-bdsl-assets`, `verify-lse-assets` and `verify-psl-assets` pass.
- **Changed:** every page's HTML and RSC payload (redesign), and the `recognition`, `template-matching`, `rsl` and `bdsl` worker bundles (F2, F3).
- **Routes:** identical set: `/`, `/about`, `/how-it-works`, `/languages`, `/models`, `/privacy`, `/roadmap`, `/terms`, 404. `/field-test` is excluded from both.

### Integration checklist (owner)

- [ ] Review #44 (product and UI redesign, copy, tour). This is the largest change and gates everything else.
- [ ] Decide F1, ASL-2000 model words in the public transcript (§7).
- [ ] Read the `festive-dirac` summary above (F1, F8). It never had its own PR.
- [ ] Confirm the RC commit's CI: Firebase Static Build Check (all functional steps), Offline ASL Demo, Release artifact matrix, Analytics Consent. The dependency gate stays red: known, development-only, not suppressed (§4).
- [ ] Run the owner device checklist (§6) on a protected preview channel or a local `npm run demo:serve`.
- [ ] Merge to main with a merge commit only after the above. Deploy to Firebase only on a separate approval. Close #43–#53 as superseded.

---

## 4. P3: security and deployment readiness

| Check | Result |
|---|---|
| Dependency advisories | 16 moderate, **0 production**. All are `minimatch < 11.0.1` (GHSA-g3hv-75wg-m249) through `eslint`, `eslint-config-next` and `typescript-eslint`. **No safe fix exists.** The latest upstream releases still depend on `minimatch` 3.x and 10.x (eslint 10.14.0 → ^10.2.6; eslint-plugin-react/import/jsx-a11y → ^3.1.2). npm's suggested fixes are semver-major downgrades (eslint 4.0.0, eslint-config-next 0.2.4). No override was applied and the gate is not suppressed. **Not release-blocking for the shipped artifact** (development tooling only), but the CI gate stays red by design |
| Certificate verification | Unchanged and intact. PopSign stays blocked (exit 78, distrusted emSign G3); nothing was bypassed |
| Model checksums | All shipped language models verify (the four verify scripts). Fingerspelling ONNX files match their pinned bytes and sha256 (research builds only) |
| Secrets | `audit:secrets`: 0 findings. No new `NEXT_PUBLIC_` key besides the flag, and `prepare-export` allow-lists public keys |
| Production configuration | `firebase.json` is unchanged from main: CSP `frame-ancestors 'none'`, HSTS, `nosniff`, `Permissions-Policy camera=(self)`, and `max-age=0` for `/models` and `/workers`, so a rollback is never served stale. `secure-export` adds hash-based script CSP to every page |
| Export completeness | `firebase-build-check` "Verify export" plus `verify-runtime --profile full`. The recognition worker matches the committed bundle |
| Release-blocking vs research infrastructure | **Blocking for public release:** F1 decision, #44 owner review, owner device checklist. **Not blocking:** the dev-only advisories, PopSign (word-replay evaluation only), ASL Video Pilot (research, path-triggered), fingerspelling research workflows |

---

## 5. P4: experimental fingerspelling safeguards

- **Off in production.** It is compiled out and its assets are pruned and verified (§1).
- **One-hand tracking speed-up preserved in research builds.** `DEFAULT_TRACKER = {engine: "landmarker", numHands: 1}` is unchanged. The two-hand fallback is still selectable.
- **Silent hand-switching with two people visible (documented, unresolved).** Licensed-RGB composites, CI run 41596351806 (`docs/release-sprint/README.md` §2):
  - with a second signer in view, capture used the other person's hand in **254/903 frames**;
  - it switched mid-word in **6–7 of 13 clips** and **never rejected a capture**;
  - character edits rose from 29 to 47–53 of 166.
  - The cause is capture's selection rule, not the tracker. The two-hand fallback behaves the same way.
- **Wrist-jump detector stays disabled.** `HAND_CONTINUITY_GUARD_ENABLED = false`, and capture does not call it. Genuine motion (up to 12.7 palm lengths) overlaps switches (as small as 0.14). No identity policy is deployed.
- **Before fingerspelling could ever be enabled:** consented two-person recordings, a hand-identity rule, and independent-signer accuracy.

---

## 6. P5: release rehearsal, rollback and owner checklist

### Reproducible production-profile rehearsal (local, no deployment)

```bash
git checkout claude/charming-thompson-2aql9w-rc
npm ci
npm run build                          # = build:firebase; flag resolves off
node tests/production-release-smoke.mjs "$(command -v google-chrome)"
node scripts/serve-export.mjs --port 8080   # then open http://127.0.0.1:8080
```

For the offline ASL demo variant, use `npm run demo:prepare && npm run demo:serve`. `out/runtime-manifest.json` records exactly what the export contains, including `"fingerspelling": "off"` and `"fingerspelling_ui_compiled": false`.

**Protected preview.** Vercel built and deployed the RC commit's preview (status "Deployment has completed", behind the team's Vercel SSO). That preview is a **research** build with fingerspelling on, by design, so it is **not** a production rehearsal. A production-profile rehearsal on a protected Firebase preview channel would be:

```bash
firebase hosting:channel:deploy rc-qualification --expires 7d
```

**Owner action only.** It was not run: no deployment was authorised.

### Rollback plan

| Layer | Procedure | Notes |
|---|---|---|
| Firebase Hosting | Firebase console → Hosting → Release history → previous release → **Rollback**, or `firebase hosting:clone signrelay:<previous-version> signrelay:live` | Atomic. `max-age=0` on HTML, `/models` and `/workers` means clients pick up the restored release on the next load. `_next/static` files are content-hashed |
| Model assets | Restored with the release: models ship inside the same Hosting release | No language weights differ between main and RC. Research fingerspelling weights are not in the production release at all |
| Personal signs (IndexedDB v1) | **No action needed.** Synthetic, both directions (`scripts/diagnostics/rollback-template-compat.mjs`): RC-saved and main-saved templates give identical results under main's and the RC's matchers (6 correct, 0 wrong, 6 no match of 12 each). Main's validator accepts the `trajectory-v3` tag | If a user reports degraded matching after a rollback, re-recording the sign is the remedy. No data is lost or rejected |
| History, settings, consent | No action needed: formats unchanged. The new `signrelay.onboarding.v1` key is ignored by main | — |
| Git | Revert the merge commit on main, if merged. RC-only rollbacks: revert `fead5bf` (leak fixes) or `98d4675` (the flag) | Reverting the flag re-exposes fingerspelling. Do not revert it without also removing the mode |

### Owner device checklist (desktop and mobile; about 20 minutes)

Use the production-profile export (local serve or a protected preview channel). Use Chrome desktop, and Safari or Chrome on a phone.

1. **Landing:** the logo and dark-green theme look right; the hero animation plays, and stops with reduced motion.
2. **First visit:** the tour appears once and can be skipped. "Take a tour" reopens it.
3. **Consent:** with analytics configured, the banner asks; "Decline" keeps it off. With browser GPC on, it says analytics cannot be enabled.
4. **ASL workspace:** grant the camera; the status reaches *Active*; the hand overlay follows your hand.
5. Sign HELLO, THANK YOU and YES. Words appear.
   - Sign a few *other* words. If an amber "Experimental suggestion · not added" card appears, check all of the following: nothing is spoken; Dismiss removes the card; Add puts the word in with "· added from suggestion"; the card disappears after about 12 seconds, or when you pause the camera.
   - Note any starter word that appears on its own while you sign something else.
6. **No "Fingerspelling" option anywhere,** including at `/?mode=fingerspelling#fingerspelling`.
7. **Personal signs:** record a sign with 3 examples, sign it, and see it recognised. Reload: it is still listed. Delete it.
8. **Transcript:** edit a word, undo, copy, and *Speak* (explicit only). Save & clear, and see it under history.
9. **Camera controls:** pause, resume and switch tabs. The camera light goes off when paused. Deny permission, then retry.
10. **Language switching:** BSL, ISL, LSE and Russian load their models with progress; switch back to ASL.
11. **Offline:** after the first load, switch to airplane mode and reload. ASL still starts (self-hosted vision).
12. **Phone:** no horizontal scrolling; controls are reachable with a thumb; rotation keeps the camera working.
13. **Privacy page:** the storage table lists history, settings, onboarding and personal signs, and "Clear local data" works.

Record the device, browser, results and anything unexpected. These are software-behaviour checks, not accuracy measurements.

---

## 7. Recommendation

> **Update (F1, PR #54):** F1 is resolved by the research-model safeguard. ASL-2000 model words are now suggestions that a person must add, and are never inserted or spoken automatically. Evidence is in `docs/release-candidate/F1-SAFEGUARD.md`. Recorded RGB (120 WLASL clips) moved 3 of 3 automatic model words, all wrong, to suggestions. The same run found that **starter rules insert a wrong word automatically in 25 of 120 clips of other signs**. That is unchanged by F1 and is now the main public-release blocker alongside #44. Supervised testing stays **GO**, using the F1 branch. Public release stays **NO-GO**.

> **Update (starter reliability, PR #55, stacked on #54):** evidence is in `docs/release-candidate/STARTER-RELIABILITY.md`.
> - **Starter rules on recorded RGB:** 149 negative WLASL clips (119 exposed and 30 held out) produce 33 wrong automatic starter words in 30 clips. On 27 positive clips, 16 words are correct.
> - **Main causes:** the PLEASE/SORRY chest circle (17 wrong words) and THANK YOU's "leaving the face" (12).
> - **Rule refinements:** none adopted. The best one removes 12 of the 33 wrong words but loses the only correct THANK YOU and breaks 3.3 fps confirmation.
> - **Output policy:** production now makes starter-rule words suggestions (0 wrong words inserted automatically), as well as BSL-1064, ISL-263, LSE-300 and PSL model words, which were automatic and bypassed F1. Personal signs stay automatic.
> - This is a transcript-safety change, **not** a recognition improvement.
> - Supervised testing: **GO** with #54 + #55. Public release: **NO-GO**, because the starter rules stay low precision, and #44 and device evidence are outstanding.


**Supervised testing: GO.** Conditions:
- run on the production-profile build of the RC commit, with fingerspelling off;
- testers are told that ASL model-sourced words (F1) are research quality;
- the owner device checklist is completed first.

**Public release: NO-GO, for now.** The blockers are owner decisions and real-device evidence, not open defects:
1. **#44 product review** (redesign, copy, tour).
2. **F1:** decide whether ASL-2000 model words may enter the public transcript at ≈13% accepted-word precision on MediaPipe input. Alternatives such as showing them only as suggestions are a recognition-policy change and need approval.
3. **The owner device checklist** on desktop and mobile, and a supervised session.
4. A green dependency gate is **not** required for the artifact (dev-only), but the gate must stay as is. Re-check when `eslint` or `typescript-eslint` move to `minimatch` ≥ 11.0.1.
