# SignRelay GITEX YouthX demo package — research prototype

Prepared 21 October 2026 for the 30 October showcase. Branch `claude/funny-archimedes-rk1un6`, draft PR https://github.com/adamjamiesimson/SignRelay/pull/36 (stacked on #35). Machine-checkable contract: [`demo-contract.json`](demo-contract.json). Ledger: [`sprint-ledger-2026-10-21.md`](sprint-ledger-2026-10-21.md).

## Release decision

**Not yet ready (no-go). It can become a go for a clearly labelled research-prototype demo once the five manual checks pass. It is not ready for any accuracy claim.**

| Gate | State |
| --- | --- |
| Automated contract (19 criteria) | Passing locally and in CI (see the test outcomes below) |
| Manual pre-demo checks MAN-1…MAN-5 on the actual laptop, webcam and signer | **Not run.** No physical device or signer was available to this sprint |
| Independent fluent ASL review, consenting new signers | **Blocked:** none exist |
| Strict dependency audit (`npm run audit:security`) | Fails on 5 dev-only `braces` advisories with no upstream fix. Owner decision |
| Merge to `main` / production deploy | Not done; needs owner approval |

## What the demo shows, honestly

- Live, on-device ASL isolated-sign recognition for **HELLO, THANK YOU, PLEASE, SORRY, YES, NO** using explicit movement rules. A 2,000-sign WLASL research model runs alongside them.
- A clear **"No confident match"** when unsure. Confirmation needs two consistent observations from the same recognizer.
- Words appear in a transcript you can edit, copy, remove and optionally hear. Video never leaves the laptop.

Evidence (from [`dashboard-2026-10-21.md`](../evaluation/dashboard-2026-10-21.md)) covers 11 previously seen, publisher-labelled development clips: **5 correct, 0 wrong, 6 no-match**. Per word: PLEASE 3/3, NO 1/1, HELLO 1/3, THANK YOU 0/3, YES 0/1, and SORRY has **no trials**. No new signers, live-camera sessions or non-signing movements have been measured. Synthetic tests show the rules confirm all six words across 15 capture conditions. They also record four synthetic everyday movements that would be accepted ([`known-false-accept-risks.json`](known-false-accept-risks.json)). Do not present any percentage.

Other languages (BSL, ISL, LSE, PSL, RSL clip mode, Bangla clip mode) are research previews with unmeasured live accuracy. Present them as such, or not at all.

## 90-second demonstration sequence

| Time | Presenter says / does | Signer does | Expected screen |
| --- | --- | --- | --- |
| 0:00–0:10 | "SignRelay is a privacy-first research prototype. ASL is its own language; this recognizes six isolated signs, not sentences." Point at the banner. | Hands resting below the chest | Status "waiting for hands" or "no confident match" |
| 0:10–0:20 | "Video stays on this laptop. Nothing is uploaded." | Raise hands into frame | Status "watching" |
| 0:20–0:50 | "Each word needs two matching observations before it is added." | HELLO → rest → THANK YOU → rest → PLEASE (about 1 s rest between, hands lowered) | Words appear in order; "Possible match · not confirmed" may flash first |
| 0:50–1:05 | "When it is not sure, it says so rather than guessing." | One unsupported sign or a casual wave **at chest height** | "No confident match"; nothing is added |
| 1:05–1:20 | — | YES → rest → NO (→ SORRY if time allows) | Words appear |
| 1:20–1:30 | Turn on Auto speak and press **Speak**, or **Copy**. "Every word can be corrected or removed." | — | The transcript is voiced or copied |

Rules for the signer: rest the hands below the chest or out of frame between signs; don't touch the face, glasses or hair; keep face, shoulders and hands in view; plain background, front lighting. If a wrong word appears, say so and press **Remove**. That is part of the honest demo.

## Setup (do this at home, the day before, with internet)

```bash
git clone https://github.com/adamjamiesimson/SignRelay && cd SignRelay
git checkout claude/funny-archimedes-rk1un6        # or the merged commit once approved
npm ci
npm run build:firebase    # downloads and verifies the RSL model and the MediaPipe models into out/
npm start                 # serves out/ at http://localhost:3000 — no internet needed after this
```

- Open `http://localhost:3000` in **desktop Chrome** (localhost counts as a secure origin, so the camera works). Choose American Sign Language, then Start translating, and allow the camera.
- Open **Camera options**. It should say *"Hand tracking loaded from this site, so it does not depend on an external CDN."*
- For timings, open `http://localhost:3000/?perf` and read the readout under Camera options (tracking p50/p95, recognition round trip, frames analysed/s).
- Then unplug the network and repeat a few signs (MAN-3).
- If `build:firebase` cannot reach the RSL model host, the build stops. Build on a network that can reach it. The ASL demo itself does not use RSL.

## Failure and fallback behaviour

| Situation | What SignRelay does | Presenter recovery |
| --- | --- | --- |
| Camera permission denied | "Camera permission was denied…" with **Retry camera** | Allow the camera in Chrome's site settings → Retry |
| No camera, or camera busy | A specific message (not found / busy) | Close other apps using the camera, reconnect it, Retry |
| Webcam unplugged mid-demo | Stops, releases the camera, explains how to reconnect | Replug → **Start camera** |
| Tracking models fail to load | "The camera opened, but the tracking models could not load…" | Self-hosted copy first, CDN second; with `npm start` this needs no network. Reload the page |
| Recognition worker crashes | Restarts automatically twice per minute, then **Restart recognition** | Press Restart recognition |
| Tab hidden or laptop sleeps | Analysis pauses and the evidence buffer resets | Return to the tab; sign again |
| Wrong word appears | Labelled as a rule/model match with a score, never a measured probability | Press **Remove**; explain abstention vs errors |
| Venue Wi-Fi down | Nothing needed when served locally with `npm start` | — |

**Pre-recorded fallback:** the product has no hidden playback mode, and none was added. If a fallback video is used, it must be a screen recording of a **consenting team member**, visibly captioned "PRE-RECORDED" for its whole duration. Never use PopSign or other publisher clips without checking their licence and attribution.

## Device and browser compatibility

| Environment | Status |
| --- | --- |
| Headless Chromium 141 (Playwright build 1194), synthetic camera, sandbox CPU | Verified by automated smokes: workspace, capture studio, CDN-blocked start |
| Google Chrome stable, GitHub Actions ubuntu-latest, synthetic camera | Verified in CI: workspace, lifecycle, RSL, Bangla, Spanish, CDN-blocked start (cold start 1.0–1.3 s, ~13 frames/s forwarded) |
| Desktop Chrome on the demo laptop with a real webcam | **Not tested.** MAN-1…MAN-5 required |
| Edge, Firefox, Safari (macOS) | Not tested |
| Android Chrome, iOS Safari, tablets | Not tested; no phone measurements exist |

## Privacy explanation (for visitors and judges)

- Camera frames are analysed in the browser and are never uploaded or stored. Transcripts and settings stay in this browser's local storage, and **Clear local data** removes them.
- Taught personal signs are stored as normalized landmark numbers in IndexedDB, never as video.
- Analytics load only after opt-in, and only if a measurement ID was configured at build time.
- The private recording studio used to collect consenting development data is **not** part of the public site.

## Automated test outcomes

See the PR description for the final CI state of the head commit. Locally on this branch: typecheck clean, lint clean, Vitest unit suite all passing (counts in the PR), worker build and repo guard passing. Browser smokes pass in Chromium: workspace (11 checks), capture studio, CDN-blocked vision.

## Known defects and open findings

1. **Recognition evidence is thin**: 11 reused clips, and THANK YOU, YES and SORRY have no real-video success. Mitigation: present it as a research preview; use PLEASE, NO and HELLO first.
2. **Synthetic false-accept risks**: glasses → THANK YOU; hair aside, or a hand rising to the forehead → HELLO; lowering a hand from the mouth → THANK YOU. Mitigation: the signer rules above.
3. Sparse real hand tracking (16–30% of frames on development clips) is the leading observable cause of misses; it needs reviewed recordings, not threshold tuning.
4. MediaPipe runs on the CPU delegate on the main thread: about 150 ms per frame on the sandbox CPU. Real laptops are expected to be faster but are **unmeasured**.
5. The dev-only `braces` advisory (no fix available; strict audit fails).
6. A repeated word within 2.6 s is suppressed by design.
