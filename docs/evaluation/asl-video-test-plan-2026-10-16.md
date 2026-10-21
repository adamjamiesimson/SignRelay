# ASL real-video evaluation — 16 October 2026

## Why this exists

PR #28 adds a geometric completion guard for PLEASE/SORRY. Core CI synthetic motion tests pass, but this does not demonstrate natural-sign accuracy. The six recorded PopSign clips from 14 October remain useful **only as an already-inspected development regression pilot**: the project saw the THANK YOU → PLEASE mistake before PR #28 was written. Do not relabel those clips as fresh held-out evidence or claim an accuracy improvement from them.

PopSign ASL v1.0 (Georgia Tech / DPAN, CC BY 4.0) provides isolated mobile-recorded signs, not continuous interpreting; its publisher recommends isolated-sign recognition only. Existing source clips retain their frozen SHA-256 fingerprints. No media, face imagery or raw landmarks belong in the Git repository or derived artifact uploads. The published source labels are not independently verified by a new fluent ASL signer.

## The reproducible historical pilot

- `.github/workflows/asl-video-pilot.yml` runs on PRs that change ASL matching or evaluation. It fetches only the six fingerprint-checked source clips into an ignored temporary directory, builds the actual production recognition worker and pinned MediaPipe Tasks browser runtime, compiles the frozen **pre-PR28** worker (`6e099f94294942953138498666c561c562c8b50d`) independently, and replays identical source frames in separate sessions.
- The command includes `--reviewed-pilot`, explicitly recording `evaluation_split=development` and `reviewed_pilot=true`. The original 14 October frozen manifest is retained as historical provenance, not silently rewritten.
- `scripts/verify-video-pilot.mjs` rejects missing or extra clips, fingerprint/signer mismatches, unexpected capture modes, incomplete browser sessions, missing frame acknowledgement evidence and incorrectly declared held-out results. The paired comparator also verifies camera orientation, signer, language, split and runtime version. It now also **fails the video-evaluation check on a newly accepted wrong word** in any paired development recording. This conservative gate identifies a regression requiring review; it does not prove a population-level accuracy change.
- Derived reports include every confirmed word, per-gloss correct/wrong/abstained/error counts and tracked-hand frame denominators; tracking dropouts are **not** excluded from signed accuracy. The workflow uploads derived JSON/JSONL only, not videos.
- This pilot contains **zero no-sign** and **zero unknown-sign** negative trials. Both false-accept rates must remain **unmeasured/null**. A clean run is not a safety or release approval.

For local replication, with installed dependencies, a local Chrome executable and permitted official public model/download access:

```sh
python3 training/fetch_evaluation_clips.py
npm run build:firebase
node scripts/prepare-recognition-lab.mjs
# Compile pre-PR28 commit 6e099f9 to out/workers/baseline-recognition.worker.js.
node scripts/run-recognition-video-evaluation.mjs /path/to/chrome docs/evaluation/popsign-project-holdout-manifest.json evaluation/derived/base.jsonl --baseline --reviewed-pilot
node scripts/run-recognition-video-evaluation.mjs /path/to/chrome docs/evaluation/popsign-project-holdout-manifest.json evaluation/derived/candidate.jsonl --reviewed-pilot
node scripts/compare-recognition-evaluation.mjs evaluation/derived/base.jsonl evaluation/derived/candidate.jsonl
node scripts/verify-video-pilot.mjs evaluation/derived/base.jsonl evaluation/derived/candidate.jsonl
```

Use `--fetch-assets-via-node` only when the browser's network proxy cannot fetch the fixed public Tasks WASM/model URLs with normal TLS verification. No network-bypass or TLS-disable options are appropriate.

## Fresh evidence required before a recognition release

Use *new*, consented recordings from multiple participants not present in the development data. Seek fluent-signer review of glosses and sign variants before freezing expected labels. Keep signer IDs pseudonymous and keep raw footage locally or in a consented private review system, never in PR artifacts. Avoid using clips selected after seeing model predictions as fresh holdout.

A practical first collection for the six starter signs is:
1. **Signed positives:** HELLO, PLEASE, THANK YOU, SORRY, YES and NO. Collect at least three distinct takes per word per signer, including contrasting hand preference, camera distance and signing speed. Don't fabricate repetitions by duplicating video frames.
2. **No-sign controls:** Record idle hands, ordinary speaking/gestures, moving the camera, hand resting at chest, and non-sign movements that may resemble circular motion. Label these `no_sign` before testing; model mistakes count as false accepts.
3. **Unknown or out-of-vocabulary controls:** Have a qualified reviewer identify signs that the tested recognizer **does not support**. If the research model supports the sign, it cannot honestly be an unknown-sign negative; record supported alternatives instead. Label `unknown_sign` only after that check.
4. **Separation and reporting:** Reserve participants not used for threshold/rule decisions for a once-only holdout; test all takes once with the final frozen candidate. Report counts by sign and signer, exact denominator, wrong accepted signs, abstentions, no-sign false accepts, unknown-sign false accepts, hand-visible-frame coverage, and test failures. Do not hide failure cases to improve metrics.
5. **Physical-device truth:** Validate real right/left hands on two devices with the actual MediaPipe Tasks API, mirrored preview both ways, without automatically changing model slot mapping. Then assess mobile latency, device heat, interruptions and network recovery.

The QA runner already accepts local, licensed/consented `file` paths with `trial_type` values `sign`, `no_sign` and `unknown_sign`. Use separate new manifests with unique fingerprints, signer IDs, review records and declared splits. A real-data review must precede any accuracy threshold or model-tuning claim.

## Non-release decision

As of the workflow's introduction, there is **no new natural-signer accuracy result** and no new negative-trial result. PR #28 and its evaluation follow-up remain drafts; main, Firebase production, dependencies, models and saved personal signs are unchanged. The pre-existing security audit findings still block release.
