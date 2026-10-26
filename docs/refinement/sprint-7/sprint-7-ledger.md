# Sprint 7 ledger: UI/UX overhaul, hand illustration, first-run tour and privacy (23 October 2026)

Branch `claude/determined-goldberg-ena3i6`, fast-forwarded to the verified Sprint 6 head **`c5b4070`** (PR #41, which contains Sprints 4 and 5) and stacked on it as draft PR #42. Nothing was merged, deployed or force-pushed. The sealed holdout was not opened. Recognition thresholds, model weights, worker decisions, language mappings and evaluation data are unchanged: the built recognition worker is byte-identical to the committed **`39a5f2c3…`** in every build.

Statuses: **DONE**, **PARTIAL** (gap stated), **BLOCKED** (needs people, devices or an owner decision). Supporting documents: [design-system.md](design-system.md) (audit, system, illustration), [privacy-audit.md](privacy-audit.md), [accessibility.md](accessibility.md), [readiness.md](readiness.md), [hero-animation-perf.json](hero-animation-perf.json), [screenshots](screenshots/).

**Environment.** Cloud container: Node 22.22.0, npm 10.9.4, headless Chromium 1194, synthetic fake camera. The RSL model host is unreachable from it, so the full export was built locally without the RSL weights; CI builds the complete export.

## Defects found and fixed in this sprint

| # | Defect | Root cause | Fix and evidence |
| --- | --- | --- | --- |
| D1 | A large cookie banner covered workspace controls on every first visit although nothing optional was configured | The banner opened whenever no consent record existed, analytics or not | Banner only with a measurement ID; `onboarding-smoke` asserts none without, `consent-smoke` covers the configured case |
| D2 | With the redesign, the rehearsal hook stayed (disabled) in the ASL demo bundle; `verify:runtime` refused the build | `build-profile` became shared between two page chunks, so `"rehearsal" === BUILD_PROFILE` was no longer constant-folded | `lib/rehearsal.ts` compares the inlined variable itself; demo export verifies with the hook absent, rehearsal export still contains it |
| D3 | "Open source" claimed with no licence file in the repository | — | Copy changed to "public source code"; owner decision O2 |
| D4 | Teach-only languages labelled "BETA · Models in development", implying models that do not exist | Copy | "Teach your own signs · No automatic model"; Auslan "Model planned" (a dataset is mapped, no model) |
| D5 | Privacy policy said vision assets download from CDNs; they are self-hosted with a CDN fallback | Outdated copy | Rewritten from the audit |

## Phase 1: design system and visual foundation

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 01 | Audit the interface | DONE | 13 findings with resolutions: [design-system.md §1](design-system.md); before screenshots in `screenshots/before/` |
| 02 | Unified design system | DONE | Tokens for charcoal surfaces, three text levels, one teal-mint accent, radii, spacing, motion; system font stack (no web fonts, offline-safe): [design-system.md §2](design-system.md) |
| 03 | Clean up legacy CSS | DONE | `refinement.css` and `figma-ui.css` deleted; 2,213 lines of overrides replaced by 814 lines in `globals.css` + `site.css` + `workspace.css` with `!important` used only for the reduced-motion rule and the phone tour sheet |
| 04 | Reusable components | DONE | Buttons (4 variants, 3 sizes), icon buttons, tags, notices, empty states, cards, inputs, search field, switch, disclosures, native-dialog modal, tour, consent notice; one focus ring; disabled, hover and loading states |
| 05 | Homepage and hand animation | DONE | "Every sign deserves to be understood." with Start signing as the one primary action and How it works as secondary. Illustration kept and refined: hands only, thinner lines, fewer dots, smooth eased poses for the six demo words plus a no-match, confirmation pulse, transcript transitions, pause/play, off-screen pause, still under reduced motion, always "Illustration · Not live". Frame cost p50 0.3 ms desktop, 1.1 ms on a 4× throttled phone, 0 long tasks; unmounted in the workspace. [Filmstrip](screenshots/after/hero-filmstrip.jpg) |

## Phase 2: product experience

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 06 | Navigation | DONE | Header: Translator, Languages, How it works, Privacy; phone menu (Escape, outside click, focus return); skip link. Footer: Product, Project (About, Models & credits, Roadmap, GitHub), Privacy (policy, storage & cookies, terms, Cookie choices) |
| 07 | Language selection | DONE | Searchable picker with two radio groups (automatic · experimental vs teach your own · no automatic model), roving tabindex and arrow keys; searchable `/languages` directory with per-language "Open workspace" links. No availability exaggerated; ASL demo build disables the others with a note |
| 08 | Live workspace | DONE | Camera and transcript side by side on desktop (1.45 : 1), stacked on phones; one camera control; diagnostics, detection grid and source in "Camera options"; model evidence behind "What this means" |
| 09 | Recognition status | DONE | Camera off, Waiting for permission, Starting, Camera blocked/unavailable, Ready, Watching movement, Checking sign, No confident match, Recognition unavailable. Same keys and logic; candidates still "Possible match · not confirmed" and never announced; `?perf` readout and warning unchanged |
| 10 | Transcript and speech | DONE | Icon buttons for Edit/Remove per word, Speak/Stop, Copy, Save & clear, History; "Speak each word" (same Auto speak setting and policy); voice settings note about online voices. Speech behaviour unchanged (pinned by `transcript-a11y-smoke`) |
| 11 | Personal vocabulary | DONE | Two-step Teach a sign (choose a word → record, with a three-example meter), "Your signs" list with search when needed, empty states. Recording, saving, removal, search, the three-example limit and storage integrity untouched (`personal-vocabulary-scale-smoke`, `user-feedback-fault-smoke`) |
| 12 | Remaining screens | DONE | About, How it works (rewritten for the current flow, incl. RSL/Bangla clip mode), Languages, Models, Roadmap, Privacy, Terms and 404 on one document layout with an on-page contents list; RSL and Bangla capture screens restyled with steps, status, result card and links, behaviour unchanged |

## Phase 3: first-time tutorial

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 13 | Four-step tour | DONE | Choose your language → Start signing → Your words, your way → Teach SignRelay, each a heading, one or two sentences, an icon and a highlight of the real control; about 30 seconds to read |
| 14 | Interactive | DONE | Spotlight over the real element, kept aligned on scroll and resize; Back, Next, Skip tour, Finish, arrow keys, Escape; heading focus per step; native modal dialog (background inert). On a first visit it replaces the automatic camera start and never starts the camera (`onboarding-smoke`: 0 camera requests) |
| 15 | Persistence | DONE | `signrelay.onboarding.v1` (`completed` / `dismissed`); not shown to returning visitors; Take a tour in the workspace, footer and `/#tour`; Clear local data resets it; blocked storage does not force it on every visit (unit tests) |
| 16 | Contextual guidance | DONE | Empty states for the transcript (with Teach a sign), personal signs and language search; camera placeholder explains each state; status detail line; titles on icon buttons; the model-status warning stays visible as one line |

## Phase 4: privacy, cookies and trust

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 17 | Audit data processing | DONE | [privacy-audit.md](privacy-audit.md): camera, frames, buffer, IndexedDB, localStorage keys, models and CDN fallback, hosting, analytics, speech, diagnostics, private route |
| 18 | Privacy policy | DONE (draft for review) | Effective 23 October 2026; plain-language summary; each topic requested; build-specific analytics status; owner/legal items flagged (O1–O6); no certification or compliance claim |
| 19 | Cookie choices | DONE | No banner without optional analytics; otherwise a compact notice with identical Reject and Allow; Cookie choices dialog to allow or withdraw; GPC/DNT respected; withdrawal deletes `_ga*` and reloads. Verified in Chrome by `consent-smoke` (green in CI) |
| 20 | Storage and cookie information | DONE | Table of every item with type, provider, purpose, duration and deletion in the policy and the audit; necessary vs optional distinguished |
| 21 | Align privacy, terms and UI | DONE (draft for review) | Terms rewritten; tour, Cookie choices, policy, workspace notes and home copy use the same facts (on-device processing, what is stored, what Clear local data removes) |

## Phase 5: polish, performance and release preparation

| # | Objective | Status | Evidence |
| --- | --- | --- | --- |
| 22 | Accessibility | DONE (automated only) | axe-core 0 violations on public pages, the live workspace, the tour and the dialog; keyboard reach with visible focus; targets ≥ 24 px; reflow; reduced motion; live regions; focus management: [accessibility.md](accessibility.md). Not an assistive-technology user test |
| 23 | Responsive and performance | DONE (headless) | No horizontal scroll at 320, 375, 390 and 820 px and at 200 % text (8 pages); screenshots at 320, 390, 820 and 1440 px; hero frame cost recorded; illustration unmounted in the workspace, so it cannot affect camera throughput. Not measured on physical devices |
| 24 | Regression testing | DONE (with stated gaps) | See [readiness.md](readiness.md). New: `onboarding-smoke`, `consent-smoke` (+ workflow), `hand-illustration.test.ts`, onboarding storage tests, status-label test. Not run locally: RSL model inference (host unreachable; CI runs it) |
| 25 | Deliverables | DONE | Implemented redesign, screenshots, illustration, design system, tour, cookie controls, policy and terms drafts, accessibility results, readiness report, this ledger, draft PR #42 |

## Owner decisions and blocked items

| # | Item | Status |
| --- | --- | --- |
| O1–O6 | Controller and contact, code licence, Firebase log retention, analytics settings if enabled, legal review, Vercel previews | BLOCKED on the owner ([privacy-audit.md](privacy-audit.md)) |
| P1 | Screen-reader and assistive-technology user testing; Deaf signer feedback on the illustration and copy | BLOCKED on people |
| P2 | Real-device animation and workspace performance | BLOCKED on devices |
| R1 | Release remains **NO-GO** as in Sprint 6: MAN-1 to MAN-5 and live-camera evidence are still pending. This sprint changes presentation, not recognition | — |
