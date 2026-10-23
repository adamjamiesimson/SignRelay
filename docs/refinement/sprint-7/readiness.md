# Sprint 7 regression and build report, 23 October 2026

**Release: NO-GO, unchanged from Sprint 6.** This sprint changes the interface, copy, privacy controls and tests; it does not change recognition. Every software check below passes. MAN-1 to MAN-5, live-camera, new-signer, assistive-technology and device evidence are still pending, and only the project owner changes the decision.

**Candidate:** code commit `48b9160` plus the documentation, wording and test-coverage follow-up on this branch (re-verified below). Recognition worker `39a5f2c307242a5409bfabbf75a0ff18d4e5e6bd5365bd72966e9e8907b75ed5`, byte-identical to Sprint 6.

## Clean-worktree run

`node scripts/readiness.mjs --label sprint7-final --build rehearsal,asl-demo --browser <chromium 1194> --compare docs/refinement/sprint-6/sprint6-final-cd86b2c.json` in a fresh detached `git worktree` with its own `npm ci`: [sprint7-final-48b9160.md](sprint7-final-48b9160.md) ([json](sprint7-final-48b9160.json)).

| | Sprint 6 final `cd86b2c` | Sprint 7 `48b9160` |
| --- | --- | --- |
| Checks | 23/23 pass | **24/24 pass** (adds `onboarding-smoke`) |
| Unit tests | 911 passed, 2 skipped (913, 88 files) | **926 passed, 2 skipped (928, 89 files)** |
| Strict `audit:security` release gate | pass | **pass** |
| Comparison | — | +15 tests, one new check, **no regression** |
| Recognition worker built = committed | `39a5f2c3…` | `39a5f2c3…` |
| Worktree dirty after the run | no | no |

The 2 skips are the opt-in report writers, as before.

## Additional local runs (this container)

| Check | Build | Result |
| --- | --- | --- |
| `onboarding-smoke` with axe-core 4.13.0 | rehearsal | pass, 11 checks, 0 axe violations (tour, Cookie choices) |
| `transcript-a11y-smoke` incl. reflow at 320, 375, 390, 820 px and 200 % text | rehearsal | pass (re-run after the last wording and CSS change) |
| `consent-smoke` | export with placeholder `G-SMOKETEST1` | pass, 5 checks |
| `demo:check` (strict offline, deny-all proxy) | asl-demo | pass, 0 non-loopback requests on 4 pages |
| `workspace-browser-smoke`, `landmark-lifecycle-browser-smoke`, `bdsl-browser-smoke`, `lse-browser-smoke`, `offline-vision-smoke`, `a11y-axe-smoke` (axe 4.13.0: 0 violations on 5 pages + live workspace) | full profile without the RSL weights | pass |
| `rsl-browser-smoke` | same | UI, lazy loading and 390 px layout pass; stops at model loading because the RSL weights cannot be downloaded here (passes in CI) |
| `hero-animation.mjs` benchmark | full profile | [hero-animation-perf.json](hero-animation-perf.json): frame callback p50 0.3 ms / p95 0.4 ms (desktop), 1.1 / 2.1 ms (390 px, CPU ×4); 0 long tasks; < 1 caption re-render/s; illustration not mounted in the workspace |
| Typecheck, lint, full unit suite on the final source | — | pass; 926 passed, 2 skipped |

## CI on PR #42

| Workflow | Result on `48b9160` |
| --- | --- |
| Core CI (typecheck, test, lint, worker, repo guard) | pass |
| Firebase Static Build Check (full export with RSL weights; workspace, landmark, RSL, Bangla, Spanish, offline-vision and axe smokes) | pass |
| Strict dependency audit (release gate) | see the PR |
| Offline ASL Demo and Rehearsal (now including `onboarding-smoke`) | pass |
| Analytics Consent Check (new) | pass |
| Real-video pilot | not triggered: no recognition source, worker byte or lockfile changed |

## Screenshots

`screenshots/before/` was captured at `c5b4070` from `next dev` (no self-hosted tracking models, so the old workspace shows its model-load error). `screenshots/after/` comes from the static exports with the synthetic fake camera.

| Screen | Before | After |
| --- | --- | --- |
| Home, desktop | [before](screenshots/before/home-desktop.jpg) | [after](screenshots/after/home-desktop.jpg) |
| Hero, desktop / phone | [before](screenshots/before/home-hero-desktop.jpg) · [phone](screenshots/before/home-hero-mobile.jpg) | [after](screenshots/after/home-hero-desktop.jpg) · [phone](screenshots/after/home-hero-m390.jpg) · [filmstrip](screenshots/after/hero-filmstrip.jpg) |
| Home, phone / 320 px / tablet | [before](screenshots/before/home-mobile.jpg) | [390](screenshots/after/home-m390.jpg) · [320](screenshots/after/home-m320.jpg) · [820](screenshots/after/home-tablet.jpg) |
| Workspace | [desktop](screenshots/before/workspace-desktop.jpg) · [phone](screenshots/before/workspace-mobile.jpg) | [desktop](screenshots/after/workspace-live-desktop.jpg) · [820](screenshots/after/workspace-live-tablet.jpg) · [390](screenshots/after/workspace-live-m390.jpg) · [320](screenshots/after/workspace-live-m320.jpg) · [personal signs open](screenshots/after/workspace-transcript-desktop.jpg) |
| Tour | — | [1](screenshots/after/tour-step1-desktop.jpg) · [2](screenshots/after/tour-step2-desktop.jpg) · [3](screenshots/after/tour-step3-desktop.jpg) · [4](screenshots/after/tour-step4-desktop.jpg) · phone [1](screenshots/after/tour-step1-m390.jpg) · [2](screenshots/after/tour-step2-m390.jpg) · [4](screenshots/after/tour-step4-m390.jpg) |
| Languages | [before](screenshots/before/languages-desktop.jpg) | [desktop](screenshots/after/languages-desktop.jpg) · [phone](screenshots/after/languages-m390.jpg) |
| Privacy | [before](screenshots/before/privacy-desktop.jpg) | [desktop](screenshots/after/privacy-desktop.jpg) · [phone](screenshots/after/privacy-m390.jpg) |
| Cookie choices | (banner in every before screenshot) | [dialog](screenshots/after/cookie-choices-desktop.jpg) · with analytics configured: [desktop](screenshots/after/consent-notice-desktop.jpg) · [phone](screenshots/after/consent-notice-m390.jpg) |
| RSL / Bangla | — | [RSL](screenshots/after/rsl-desktop.jpg) · [RSL phone](screenshots/after/rsl-m390.jpg) · [Bangla](screenshots/after/bangla-desktop.jpg) |
| Other pages | [about](screenshots/before/about-desktop.jpg) · [models](screenshots/before/models-desktop.jpg) | [about](screenshots/after/about-desktop.jpg) · [models](screenshots/after/models-desktop.jpg) · [how it works](screenshots/after/how-it-works-desktop.jpg) · [terms](screenshots/after/terms-desktop.jpg) · [404](screenshots/after/not-found-desktop.jpg) · [phone menu](screenshots/after/menu-m390.jpg) |

## Not run, and why

| Check | Reason |
| --- | --- |
| RSL model inference locally | Model host unreachable from this container; covered by CI's Firebase build |
| Real-video pilot | Trigger paths unchanged; worker byte-identical to the evaluated `39a5f2c3` |
| Screen reader, physical devices, camera, speakers, signers | Need people and hardware (Sprint 6 field-test protocols) |
| Sealed holdout | Deliberately not opened |

## Risks introduced or carried

1. **First visit no longer starts the camera automatically**; it opens the tour first. Returning visitors and everyone after the tour keep the previous behaviour. Operators preparing a demo laptop should finish or skip the tour once (operator kit §5), or use a browser profile that has.
2. **Status wording changed** (for example "waiting for hands" → "Ready"). Logic and keys are unchanged; operator notes that quote old labels need updating.
3. **Policy and terms are drafts** with six owner/legal items ([privacy-audit.md](privacy-audit.md)).
4. Carried from Sprint 6: MAN-1 to MAN-5, synthetic false accepts, throughput dependence, phone access to the demo server, external CI hosts, unprotected `main`, Node 20 action deprecation warnings.
