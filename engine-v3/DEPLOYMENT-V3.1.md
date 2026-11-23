# Engine V3.1 lab — deployment record

**Live URL:** https://signrelay-v3-lab.vercel.app

This is an experimental research lab, and nothing in it is a guaranteed translator.

## Deployment

- **Vercel project:** `signrelay-v3-lab` in team `adam-s-team4`, created new for this lab. This is the project's own first production deployment.
- **Deployment ID:** `dpl_5fWWfthPosUenVhDT4SzYSa8UsM2`.
- **Hosting:** static files only, with no server-side inference.
- **Not touched:** the `signrelay` and `signrelay-v2-lab` Vercel projects, `signrelay.web.app`, Firebase, production domains, and the main SignRelay UI.
- **PR #65:** stays a draft and is not merged.

**Build:**

```bash
V3_OUT=<dir>/signrelay-v3-lab node engine-v3/web/build.mjs engine-v3/models/v3.1
cd <dir>/signrelay-v3-lab && vercel deploy --prod --yes
```

The build writes `vercel.json` with these headers:
- COOP and COEP (cross-origin isolation)
- a CSP with `connect-src 'self'`, so the page cannot send data to any other site
- `Permissions-Policy: camera=(self)`

## Identity of what is served

| Item | Value |
| --- | --- |
| Model | Engine V3.1 ensemble, `model.onnx` SHA-256 `b3e05424f4674d8235ac8bc51970cef6822e12ac629c4a02bca596bc7f5d3090` (checked in the browser and re-hashed from the live URL) |
| Classes | 523 trained signs plus UNKNOWN (index 523) |
| Decision presets | balanced (default) and strict, both from `models/v3.1/` |
| Lab source commit | `1fee28f` (shown on the page) |
| MediaPipe tasks | hand_landmarker and pose_landmarker_lite (SHA-256 pinned). The face model is not used. |

## Verification against the live HTTPS site

Run with `parity/verify-deployment.mjs` (headless Chromium). Full results: `ledger/deploy-v3.1/verify-live.json`.

**Result: 24 of 24 checks passed.**

| Area | What was checked |
| --- | --- |
| Page and identity | page returns 200; page shows V3.1 and the commit; 523 classes with UNKNOWN; model fingerprint correct |
| Files | `model.onnx` and both MediaPipe task files re-hashed from the live URL and matched |
| Security setup | secure context and cross-origin isolation; COOP/COEP/CSP headers present |
| Vocabulary | browser lists all 523 signs, and search works |
| Video recognition | 24 holdout clips, each identical to the validated V3.1 Chrome run (status and top-1) |
| Strict mode | applied: same top-1, 2 of 8 acceptances withdrawn |
| Unsupported signs | the UNKNOWN/abstain path works; 2 of 4 unsupported clips were rejected under balanced (STAR and GARAGE were falsely accepted, the known weakness) |
| Camera | start through `getUserMedia` (Chrome fake camera); live recognition events; Stop releases the camera; restart works; a second Start is ignored |
| Network and errors | no 4xx/5xx responses; no requests to other sites; no page errors; no console errors apart from MediaPipe/ORT info lines |
| Permission denial | denying the camera shows a clear message (tested in full headless Chrome) |
| Layout | no horizontal scroll at a 390 px mobile width |

**Full camera reels through the live site.** These are holdout-2 reels: 12 supported signs each, including repeats, plus 2 unsupported intervals.

| Reel | Correct | Wrong | Abstained | Unsupported accepted | Duplicate accepts | Spurious events | Analysed fps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 9 | 0 | 3 | 0 / 2 | 0 | 0 | 12.3 |
| 1 | 6 | 0 | 6 | 1 / 2 | 0 | 0 | 13.0 |

The validated V3.1 runs scored 7/12 on each reel. The difference is within run-to-run variance.

## Performance

These numbers come from a 4-vCPU cloud container running headless Chromium with software-only graphics (no GPU), through an egress proxy. They are **not** from a physical device.

| Measure | Value |
| --- | --- |
| Time until the page is ready | 15.3 s, mostly MediaPipe setup; the GPU/CPU probe chose CPU |
| Classification per sign | 15.7 ms median, 67 ms max |
| Hand tracking per frame | 46–95 ms |
| Pose tracking per frame | 13–15 ms |
| Analysed rate | 8.3–13.0 fps, against a 15 fps target |
| Processing a ~3 s uploaded clip | ~5.1 s |

A real laptop with GPU graphics is expected to start faster and track faster, but this has not been measured.

## Not yet verified

- A physical webcam and real-device performance (Windows, macOS, phones).
- Recognition accuracy on the owner's own signing.
