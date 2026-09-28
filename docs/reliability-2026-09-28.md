# SignRelay reliability and ASL experiment — 28 September 2026

Based on `75d97f2`, the reconciled main/feature branch with the current Figma UI,
seven automatic language choices, 40 workspaces, language menu and icon cleanup.
No layout, language vocabulary or existing trained model was replaced.

## App changes

- Fixed a concrete MediaPipe version mismatch: the locked JS package was 0.10.35
  while the browser loaded 0.10.22-rc.20250304 WASM. The wrapper is now explicitly
  pinned to 0.10.35 and the installer copies WASM from that exact npm package.
- Tracking models download during build, with fixed versions, byte counts and
  SHA-256 verification. The browser gets all recognition/tracking assets from
  SignRelay. The content policy no longer allows the old model CDNs. A cache hit
  is rechecked; incomplete, oversized or corrupt downloads cannot replace a
  verified file. Model binaries remain out of new Git history.
- Reused the verified downloader for Slovo with bounded retries. The first build
  attempt reproduced a real HTTP 502; the retrying installer completed the build.
- Landmark ONNX sessions use explicitly configured single-threaded WASM and the
  local runtime path, matching Firebase's non-isolated hosting environment and
  the existing clip recognizers.
- Camera sessions stop on tab hiding/page departure, discard captures, cancel
  speech and clear the landmark overlay. Returning never restarts the camera
  without a click. Pending startup is invalidated by the same generation guard.
- Recognition consensus and buffered landmarks are cleared after a real camera
  delivery gap, while slow continuous delivery remains supported.
- Held personal signs are suppressed until released in all language workspaces.
  Duplicate confirmation events no longer cause repeated automatic speech.

## ASL work completed

Downloaded and verified all four pinned parquet shards (832,121,245 bytes),
read all 11,980 rows and reproduced the user's 233-example, 20-class dataset.
The three duplicate sampled sequences are kept within their assigned partitions.
CPU training and evaluation completed with a 175,508-parameter temporal CNN.
Validation selected epoch 7. Splits: 142 train / 45 validation / 46 test.
Test top-1: 15/46 (32.6%); macro-F1: 0.3383.

This is an **exploratory random holdout**, not signer-independent or live camera
accuracy. Source-video/signer IDs, original split assignments and a precise joint
map are absent; there are no NO_SIGN examples. The candidate is not installed.
Preparation, complete predictions, confusion matrix, training history and all
limitations are retained in `docs/verification/asl-v01-*.json`.
The CPU-only manual GitHub workflow and scripts reproduce this experiment without
requiring Cloud Shell; they leave existing untracked `ml/` work untouched.

## Verification

- 235 Vitest checks passed, including the existing slow-camera, fist-versus-YES,
  personal recognition, model execution and recovery regressions.
- Two downloader integration checks passed using real HTTP responses, including
  transient failure, corrupted cache, truncation, oversize and digest mismatch.
- Five Python checks passed for duplicate separation, conflicting labels,
  missing-point normalization and invalid input rejection.
- TypeScript, lint, repository asset guard and production Firebase export passed.
- Three rendered-export checks passed, including model digests, matching local
  WASM, internal links, accessibility metadata and script policies.
- Dependency audit: zero reported vulnerabilities.
- Local Chrome could not launch because the execution environment prohibits its
  process socket. Browser tests are therefore run in GitHub Actions; their result
  is recorded below after that run finishes. No local browser pass is claimed.

## Delivery

GitHub Actions builds the ready-to-deploy `signrelay-firebase-out` artifact.
Firebase Hosting still needs an authenticated deployment; a source update alone
does not update `signrelay.web.app`.
