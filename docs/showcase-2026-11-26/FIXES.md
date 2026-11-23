# Showcase changes

> **Version scope:** the body below preserves PR #66's Engine 1 repair evidence. The current V3.1 integration, production UI reference, verification and publication status are recorded in [INTEGRATION_VERIFICATION.md](INTEGRATION_VERIFICATION.md). Recognition results from different engines must not be combined.

| Area | Defect and repair |
| --- | --- |
| ASL model input | MediaPipe reports zero for unset hand visibility. The ASL adapter now uses complete finite hand coordinates, associates hands with pose wrist cues when available, and supplies the model with the expected 25 fps framing and tail padding. Model checkpoints and label maps are preserved. |
| ASL motion and confirmation | The worker can examine a completed signing stroke when a hand leaves the frame, while expiring discontinuous evidence. THANK YOU requires the flat-hand shape supported by earlier development evidence. ASL-2000 candidates use the existing possible-match display. Automatic transcript confirmation depends on starter rules or the signer's personal examples. |
| Camera and worker lifetime | The shared camera loop discards stale face and pose cues, resets worker evidence after a processing failure, drops interrupted calibration, and releases the camera on page hide. The decoded-frame gate allows for the measured 60 Hz scheduling jitter. Bangla and RSL prevent concurrent capture loops and stop on a disconnected track or failed worker transfer. |
| Transcript, persistence and speech | Worker callbacks, edits and deletions use the current transcript. Clearing invalidates prior confirmations. Settings restore on refresh. Automatic words queue, and manual speech can replace the queue. Storage deletion reports partial failure, and personal examples use atomic per-language write limits in IndexedDB. |
| Build and assets | The build explicitly selects full, ASL or rehearsal, runs the installed Next binary, verifies the exported assets and workers, and rejects the wrong profile at deploy time. Offline checks include a cold restart with outbound requests blocked. |
| Security | Updated Next, Vitest and the associated lockfile dependencies using the verified lock from PR #65. The dependency gate fails on an incomplete audit response. No advisory exception was added. |
| Testing | Added targeted regression checks and a repeatable Chromium screenshot comparison for the same desktop and mobile states. See the test and recognition reports for evidence from executed runs. |

Stylesheets, assets, landing page and navigation templates are unchanged. Changes to operational and privacy feedback use existing messages and surfaces. The language registry and installed models are retained.
