# Sprint 7 privacy and data-processing audit (23 October 2026)

Audit of what the shipped code actually does, made **before** the Privacy Policy and Terms were rewritten (objective 17). Every statement in [app/privacy/page.tsx](../../../app/privacy/page.tsx) traces to a row below. Method: reading the code paths listed, a `grep` of every storage API and external URL in `lib/`, `components/`, `workers/` and `app/`, and the browser checks named in the last column. Nothing here is legal advice or a compliance assessment.

## Processing inventory

| Area | What happens | Where in code | Verified by |
| --- | --- | --- | --- |
| Camera | `getUserMedia({ video, audio: false })` only after a user action (Start camera, Retry camera, Start camera & record, or Start signing for a returning visitor). Never on page load, never from the tour or a link. Microphone never requested | `components/translator-experience.tsx` (`openCamera`, `enterWorkspace`), `rsl-recognizer.tsx`, `bdsl-recognizer.tsx` | `onboarding-smoke` (0 camera requests through the tour and entry links), `workspace-browser-smoke`, `lifecycle-stress-smoke` |
| Frames | Analysed in the page (MediaPipe) and workers; landmarks posted to the recognition worker; not stored, not sent. RSL/Bangla clips held in memory per capture and dropped | `lib/vision-engine.ts`, `workers/*.ts`, recognizer components (`frames.current = []`) | `offline-demo-strict-smoke`: 0 non-loopback page or worker requests on the ASL demo |
| Movement buffer | Rolling buffer in the worker, reset on pause, language change, tab return and stop | `RecognitionSession` `reset` messages | existing recognition-session tests |
| Personal signs | IndexedDB `signrelay-personal-vocabulary` / store `templates`: id, language, gloss, text, `createdAt`, 24 frames × 208/240 numbers of normalised hand, selected face (20 points) and pose landmarks. Max 3 examples per word. Validated on read | `lib/calibration-storage.ts`, `lib/personalized-recognition.ts` (`frameToFeatures`) | `personal-vocabulary-scale-smoke`, storage tests |
| Transcripts | `localStorage["signrelay.history.v1"]`: up to 8 sessions (text, gloss, score, timestamp, source, language). Written on Save & clear and when changing language with words on screen | `lib/browser-storage.ts` (`saveSession`) | `workspace-browser-smoke` |
| Settings | `localStorage["signrelay.settings.v1"]`: autoSpeak, volume, rate, showOverlay. Written only when changed | `lib/browser-storage.ts` | `transcript-a11y-smoke` |
| Tour progress (new) | `localStorage["signrelay.onboarding.v1"]`: `{status: completed\|dismissed, at}` | `lib/browser-storage.ts` (`saveOnboarding`) | `onboarding-smoke`, `privacy-storage.test.ts` |
| Consent | `localStorage["signrelay.analytics-consent.v1"]`: `{choice, savedAt}`, expires after 180 days. Written only from the analytics choices, which exist only when a measurement ID is configured | `lib/analytics-consent.ts` | `consent-smoke`, `analytics-consent.test.ts` |
| Clear local data | Removes settings, history, tour progress and all personal signs. Keeps the consent record (changed under Cookie choices). Reports partial failures honestly | `clearAllLocalData`, `clearLocalSignRelayData` | `user-feedback-fault-smoke`, `onboarding-smoke` |
| Other storage | None. No sessionStorage, Cache Storage, service worker or cookies are written by SignRelay itself (`grep` of `lib`, `components`, `workers`, `app`) | — | — |
| Model downloads | ASL/BSL/ISL/LSE/PSL/Bangla models, labels, ONNX Runtime and MediaPipe WASM/models served from the site (`/models`, `/workers`, `/vision`). The RSL model is fetched **at build time** from its publisher and then served by the site. Browser fallback to jsDelivr (WASM) and Google Cloud Storage (MediaPipe `.task` files) only if the self-hosted copy fails | `lib/vision-runtime.mjs` (`VISION_ASSET_SOURCES`), `scripts/install-*.mjs` | `offline-vision-smoke` (CDNs blocked, self-hosted used) |
| Hosting | Firebase Hosting (Google) serves the static export; standard request logs on Google's side | `firebase.json` | — |
| Analytics | GA4 only when `NEXT_PUBLIC_GA_MEASUREMENT_ID` is set at build **and** the visitor chooses Allow **and** no GPC/DNT signal. Explicit `page_view` with a fixed origin and the path only (unknown paths reported as `/404`), empty referrer; Google signals and ad personalisation off; cookies `_ga*` with a 180-day lifetime, deleted on withdrawal (page reloads). The ASL demo and rehearsal profiles force the ID empty | `lib/analytics-consent.ts`, `scripts/build-profile.mjs` | `consent-smoke` (new), `analytics-consent.test.ts` |
| Speech | `speechSynthesis` with the workspace's locale; off by default (`autoSpeak: false`). Voices may be online services of the browser/OS vendor | `speak()` in the workspace | `transcript-a11y-smoke` |
| Diagnostics | `?perf` shows timings on screen only; nothing stored or sent | `lib/frame-perf.ts` | — |
| Private capture | `/field-test` is excluded from public exports | `scripts/exclude-private-routes.mjs` | `rendered-html.test.mjs` |

## Storage and cookie table (objective 20)

Necessary means needed for a feature the person uses; nothing in this list is sent off the device. Only the last row is optional tracking.

| Item | Type | Provider | Purpose | Duration | Deletion |
| --- | --- | --- | --- | --- | --- |
| `signrelay-personal-vocabulary` | IndexedDB | SignRelay (this browser) | Personal sign examples | Until removed | Remove a word; Clear local data; browser site data |
| `signrelay.history.v1` | localStorage | SignRelay | Saved transcripts (max 8) | Until cleared | Clear local data; browser |
| `signrelay.settings.v1` | localStorage | SignRelay | Speech/display settings | Until cleared | Clear local data; browser |
| `signrelay.onboarding.v1` | localStorage | SignRelay | Tour finished/skipped | Until cleared | Clear local data; browser |
| `signrelay.analytics-consent.v1` | localStorage | SignRelay | Analytics choice | 180 days | Browser site data; overwritten by a new choice |
| `_ga`, `_ga_<id>` | Cookies | Google | Optional analytics | Up to 180 days | Cookie choices → Turn off analytics; browser |

## Findings and changes

1. **Consent banner without anything optional.** With no measurement ID (the default, and always in the demo builds) the old site still opened a large "Your privacy, your choice" banner over the workspace on every first visit. Removed: the footer's Cookie choices explains that nothing optional exists. With an ID, a compact notice offers Reject and Allow with identical styling.
2. **CDN wording.** The old policy said vision assets "also download from jsDelivr and Google Cloud Storage". The build self-hosts them and the CDNs are only a fallback (`VISION_ASSET_SOURCES`). Corrected.
3. **Face data in personal signs.** The old policy described templates as landmark sequences without saying they include selected face and upper-body points. Now stated.
4. **"Open source".** The site and README described SignRelay as open source, but the repository has **no licence file**. Without a licence the code is public but not licensed for reuse. The UI now says the source is public; the owner should choose a licence (owner decision O2).
5. **Tour progress** is a new necessary item and is included in Clear local data and in the policy.

## Owner and legal review items

| # | Item |
| --- | --- |
| O1 | Name the controller (legal person or entity) and a contact address for privacy requests. The policy currently says "the project owner" and marks this as pending |
| O2 | Choose and add a licence for SignRelay's own code before calling it open source |
| O3 | Confirm Firebase Hosting log retention and the Google Cloud project's data location |
| O4 | If analytics is ever enabled: Enhanced Measurement off, data retention set, a data-processing agreement accepted, and whether a 180-day consent lifetime suits the target jurisdictions |
| O5 | Have a lawyer review both pages for the jurisdictions where SignRelay will be offered, including consumer-law wording in the Terms' responsibility clause and whether a minimum age or parental notice is needed |
| O6 | The Vercel integration posts preview checks on pull requests. If it deploys previews, confirm that is intended and covered by the policy's hosting section |

No regulatory certification or compliance is claimed anywhere on the site.
