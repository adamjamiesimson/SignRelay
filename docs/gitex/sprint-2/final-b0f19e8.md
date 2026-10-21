# SignRelay final readiness report

Commit `b0f19e8560f12d31509e19c48581290f37e2ab61` on `sprint/gitex-coding-hardening-2026-10-21`, generated 2026-10-21T09:38:11.082Z. Node v22.22.0, npm 10.9.4.

| Check | Category | Command | Exit | Result |
| --- | --- | --- | ---: | --- |
| typecheck | code | `npm run typecheck` | 0 | pass |
| lint | code | `npm run lint` | 0 | pass |
| unit-tests | code | `npm test` | 0 | pass (842/843 passed, 1 skipped, 81 files) |
| worker-build | build | `npm run build:worker` | 0 | pass |
| repo-guard | privacy-integrity | `npm run repo:guard` | 0 | pass |
| secret-scan | privacy-integrity | `npm run audit:secrets` | 0 | pass |
| dependency-gate | security | `npm run audit:deps` | 0 | pass |
| production-audit | security | `npm audit --omit=dev` | 0 | pass |
| strict-audit | security-release-gate | `npm run audit:security` | 1 | **fail** |
| build-rehearsal | build | `npm run build:rehearsal` | 0 | pass |
| gitex-rehearsal-smoke:rehearsal | browser | `node tests/gitex-rehearsal-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| transcript-a11y-smoke:rehearsal | browser | `node tests/transcript-a11y-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| rendered-export:rehearsal | privacy-integrity | `npm run test:rendered` | 0 | pass |
| runtime-verifier:rehearsal | build | `node scripts/verify-runtime.mjs --out out --profile rehearsal` | 0 | pass |
| build-asl-demo | build | `npm run build:asl-demo` | 0 | pass |
| offline-vision-smoke:asl-demo | browser | `node tests/offline-vision-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| offline-demo-strict-smoke:asl-demo | browser | `node tests/offline-demo-strict-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 1 | **fail** |
| lifecycle-stress-smoke:asl-demo | browser | `node tests/lifecycle-stress-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| fault-injection-smoke:asl-demo | browser | `node tests/fault-injection-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| rendered-export:asl-demo | privacy-integrity | `npm run test:rendered` | 0 | pass |
| runtime-verifier:asl-demo | build | `node scripts/verify-runtime.mjs --out out --profile asl-demo` | 0 | pass |

Build/test/privacy checks: **FAIL**. Strict dependency release gate: **FAIL (owner decision pending)**.

## Release: NO-GO

- Strict dependency release gate fails (dev-only braces advisories; owner decision pending).
- Manual gate MAN-1 pending: On the demo laptop's real webcam, open the workspace with ?perf and confirm at least 10 frames analysed/s (YES is lost at 5–8 fps in synthetic tests); then start the camera, sign each of the six words twice, and record per-word outcomes (correct / wrong / no match) on paper. Do not publish them as accuracy.
- Manual gate MAN-2 pending: Hold hands at rest for 30 s and perform the everyday controls in docs/gitex/known-false-accept-risks.json; record any word that appears.
- Manual gate MAN-3 pending: Serve the ASL demo build with `npm run demo:serve`, unplug the network after the page has loaded, and repeat MAN-1 once.
- Manual gate MAN-4 pending: Deny camera permission once, then allow it; pull the webcam (or disable it) mid-session and confirm the recovery message.
- Manual gate MAN-5 pending: Confirm auto speak voices only confirmed words on the demo laptop speakers.
- No unseen, live-camera or new-signer evaluation exists; real no-sign false acceptance is not measured.

## Compared with docs/gitex/sprint-2/baseline-d9fcc3b.json

- workspace-browser-smoke: not-run
- unit-tests: more-tests (678 → 843)
- build-rehearsal: new-check
- gitex-rehearsal-smoke:rehearsal: new-check
- transcript-a11y-smoke:rehearsal: new-check
- runtime-verifier:rehearsal: new-check
- build-asl-demo: new-check
- offline-demo-strict-smoke:asl-demo: new-check
- lifecycle-stress-smoke:asl-demo: new-check
- fault-injection-smoke:asl-demo: new-check
- runtime-verifier:asl-demo: new-check

## Runtime fingerprint

```json
{
  "commit": "b0f19e8560f12d31509e19c48581290f37e2ab61",
  "branch": "sprint/gitex-coding-hardening-2026-10-21",
  "worktree_dirty": false,
  "node": "v22.22.0",
  "npm": "10.9.4",
  "dependencies": {
    "next": "16.4.2",
    "react": "19.2.6",
    "@mediapipe/tasks-vision": "0.10.35",
    "onnxruntime-web": "1.23.2",
    "vitest": "4.1.11",
    "vite": "8.3.4",
    "eslint-config-next": "16.4.2",
    "braces": "3.0.3"
  },
  "committed_recognition_worker_sha256": "ccce84c876f95caf9cade9a93fad1b686d5009a77ada203049044ee17ceb5632",
  "built_recognition_worker_sha256": "ccce84c876f95caf9cade9a93fad1b686d5009a77ada203049044ee17ceb5632",
  "asl_model_sha256": "ebac604f1c4ee86a7b3b20cfaa9c3a8f157cc814ad0c94e6a87be7902b3ac466",
  "asl_labels_sha256": "4a4e1e6c024c19320557d0febdd7f3956960d77a691848a2101cbca72ce69380"
}
```

Software checks only. Nothing here measures real-signer, live-camera or device accuracy.
