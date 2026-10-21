# SignRelay baseline readiness report

Commit `d9fcc3b3cdf99b6dfd0acea81a11c2a0d34e334d` on `HEAD`, generated 2026-10-21T07:50:17.392Z. Node v22.22.0, npm 10.9.4.

| Check | Category | Command | Exit | Result |
| --- | --- | --- | ---: | --- |
| typecheck | code | `npm run typecheck` | 0 | pass |
| lint | code | `npm run lint` | 0 | pass |
| unit-tests | code | `npm test` | 0 | pass (678/678 tests, 69 files) |
| worker-build | build | `npm run build:worker` | 0 | pass |
| repo-guard | privacy-integrity | `npm run repo:guard` | 0 | pass |
| secret-scan | privacy-integrity | `npm run audit:secrets` | 0 | pass |
| dependency-gate | security | `npm run audit:deps` | 0 | pass |
| production-audit | security | `npm audit --omit=dev` | 0 | pass |
| strict-audit | security-release-gate | `npm run audit:security` | 1 | **fail** |
| workspace-browser-smoke | browser | `node tests/workspace-browser-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| offline-vision-smoke | browser | `node tests/offline-vision-smoke.mjs /opt/pw-browsers/chromium-1194/chrome-linux/chrome` | 0 | pass |
| rendered-export | privacy-integrity | `npm run test:rendered` | 0 | pass |

Build/test/privacy checks: **PASS**. Strict dependency release gate: **FAIL (owner decision pending)**.

## Runtime fingerprint

```json
{
  "commit": "d9fcc3b3cdf99b6dfd0acea81a11c2a0d34e334d",
  "branch": "HEAD",
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
