# SignRelay architecture and risk inventory — 21 October 2026

Verified by reading the code on `claude/funny-archimedes-rk1un6`, which starts from PR #35's head `5c1b3f7`. Before this sprint, typecheck, lint, 402/402 unit tests, the worker build, the repo guard and the secret scan all passed. The static export also built once the blocked RSL model download was skipped.

## Real-time pipeline (shared landmark languages: ASL, BSL, ISL, LSE, PSL and personal-only workspaces)

```text
getUserMedia (components/translator-experience.tsx, requestCamera)
  → <video> (CSS-mirrored preview only; inference input is unmirrored)
  → requestAnimationFrame loop, ≤20 fps, skipped while document.hidden
  → VisionEngine.process (lib/vision-engine.ts)
      GestureRecognizer every frame (2 hands, handedness + canned gesture)
      Face + Pose on alternate frames, at most every 150 ms (last result reused)
  → RecognitionSession (lib/recognition-session.ts)
      one in-flight + one replaceable latest frame, session counter, 8 s watchdog,
      restart budget of two per minute, stale-session messages dropped
  → workers/recognition.worker.ts
      rolling buffer (120 frames for ASL, 80 otherwise)
      ASL: analyzeAslStarter (lib/asl-starter-recognition.ts; 7 rule signs:
           HELLO, THANK YOU, PLEASE, SORRY, YES, NO, I LOVE YOU) with
           open-palm ambiguity veto
           analyzeSignMotion (lib/sign-motion.ts) gates the model on a completed,
           settled movement segment
           recognizeAsl1000 (WLASL2000 Pose-TGCN ONNX) every ≥250 ms when ready
      personal DTW templates via TemplateMatchingClient (separate worker)
      arbitration: personal > starter > model; blocked-starter suppression
      confirmation: same label + same source twice (streak ≥ 2), confidence ≥ 0.62,
           same-label cooldown 2.6 s; ASL clears the buffer after confirmation
  → "confirmed" message → transcript (duplicate within 2.5 s suppressed)
  → optional speechSynthesis (auto speak)
```

RSL (Slovo) and Bangla (BdSLW401) use separate explicit clip-capture components and workers. They don't feed the live transcript.

## Evaluation and data infrastructure

- `scripts/run-recognition-video-evaluation.mjs` replays decoded video frames through the real worker in headless Chrome. `scripts/compare-recognition-evaluation.mjs` and `verify-video-pilot.mjs` compare base and candidate.
- Cohort lock (`docs/evaluation/cohort-lock-2026-10-16.json`): 6 historical-development + 5 development PopSign clips, plus 5 sealed holdout clips that are never fetched.
- Private collection: `/field-test` recorder → `capture-intake.mjs` (new) → `review-packet.mjs` (new) → `prepare-reviewed-development.mjs freeze`.
- Diagnostics: `scripts/diagnostics/*` (trace report, abstention triage).

## Capability facts (from code and committed evidence)

- ASL real-video evidence: 11 previously inspected publisher-labelled development clips. Results: 5 correct, 0 wrong accepted, 6 abstained. PLEASE 3/3, NO 1/1, HELLO 1/3, THANK YOU 0/3, YES 0/1, SORRY **0 trials**. No no-sign or out-of-vocabulary trials exist.
- `public/workers/recognition.worker.js` at the sprint start is byte-identical (`8a7d967e…`) to the evaluated worker.
- Other languages: shared models are installed and contract-tested. Live-camera accuracy has never been measured for any of them.

## Prioritized risk inventory

| # | Risk | Severity | Status after sprint |
| --- | --- | --- | --- |
| R1 | No independently reviewed, new-signer, live-camera or negative evidence; n=11 reused clips | Critical for claims | Blocked on people (signers, fluent reviewer). Tooling ready. |
| R2 | Stacked PRs into `feat/**`/`sprint/**` skipped Core CI, export and pilot | High | Fixed (workflow triggers + regression test) |
| R3 | Private `/field-test` recorder shipped in public exports; `noindex` ≠ access control | High | Fixed (excluded from public export; deploy refuses dev export) |
| R4 | Runtime dependency on jsDelivr (WASM) and googleapis (models): venue network failure = no demo | High for GITEX | See Agenda 21 |
| R5 | Auto speak voiced confirmations the transcript dropped as duplicates | Medium | See Agenda 23 |
| R6 | Candidate bar was an `aria-live` region announcing tentative candidates | Medium (a11y + honesty) | See Agenda 24 |
| R7 | A sustained MediaPipe handedness label switch on one physical hand split its track (synthetic YES/PLEASE/SORRY abstain) | Medium | See Agenda 12 |
| R8 | Intake template paths assumed `.mp4` while the recorder produced WebM; no checksum pairing | Medium | Fixed (Agenda 7) |
| R9 | Dev-only `braces` advisory chain, no upstream fix; strict `audit:security` fails | Low exploitability | Documented; owner decision |
| R10 | RSL model host (`sbercloud.ru`) is unreachable from some networks; `build:firebase` then fails | Medium for builds | Documented |
| R11 | Six-language selector could imply validated multilingual accuracy | Medium (honesty) | See Agenda 24 |
