# Live-camera evaluation

This folder defines the signer-independent evaluation protocol for SignRelay. It exists to prevent live-camera quality from being inferred from training-set metrics, synthetic unit tests, or a single developer's webcam.

## Minimum protocol

For each automatic language model being evaluated:

1. Recruit multiple consenting signers who are not represented in the model training split when that identity information is available.
2. Use a fixed list of target signs plus explicit **no-sign** trials.
3. Record only the result metadata needed for evaluation. Do not commit raw participant video to this repository.
4. Test more than one device/camera condition and at least two lighting/background conditions.
5. Preserve rejected predictions as rejections. Do not silently retry until the expected answer appears.
6. Report signed-trial accuracy, accepted-sign coverage, precision when accepted, and no-sign false-accept rate separately.
7. Keep results language-specific. Do not turn one language's benchmark into a claim about another language.

## JSONL format

Store one JSON object per trial in a local file such as `evaluation/results/asl-2026-10.jsonl`:

```json
{"session_id":"S01","participant_id":"P01","language":"asl","trial_type":"sign","expected_gloss":"HELLO","predicted_gloss":"HELLO","accepted":true,"confidence":0.91,"device":"laptop-webcam","condition":"indoor-bright"}
{"session_id":"S01","participant_id":"P01","language":"asl","trial_type":"no_sign","expected_gloss":null,"predicted_gloss":null,"accepted":false,"confidence":0.12,"device":"laptop-webcam","condition":"indoor-bright"}
```

Use pseudonymous participant IDs. Do not put names, email addresses, biometric images, or raw videos in committed evaluation files.

## Logging a live demo session

`npm run eval:log` is a terminal operator log for the manual demo gates (MAN-1 to MAN-4 in `docs/gitex/demo-contract.json`). Run it beside the demo browser:

1. Start the demo (`npm run demo:serve`) and open `http://127.0.0.1:3000/?perf`.
2. In a terminal, run `npm run eval:log`. Enter a session id, a participant pseudonym (for example `P01`, never a name), the device and camera, the conditions, and the frames analysed per second shown by `?perf`.
3. For every attempt, choose what was attempted (one of the six signs, a no-sign movement or an unsupported sign) and what happened: **c** only that word appeared, **w** a different or extra word appeared (type the words), **m** nothing appeared, **f** the camera, tracking or recognition failed (describe it).

Each row is validated with the same rules as `eval:live` and written atomically to `evaluation/results/`, which is git-ignored. `npm run repo:guard` fails if anything under `evaluation/results/`, `evaluation/raw/` or `evaluation/videos/` is ever tracked. The log records no video, landmarks, names, e-mail addresses or camera labels. The recognition worker hash is taken from `out/runtime-manifest.json` when an export is present.

Rows are marked `source: "operator-live-log"` and `review.status: "unreviewed"`. `eval:live` summarises them in a separate `unreviewed_operator_observations` section. They are a record of what a demo operator saw. They are not reviewed results and must not be published as accuracy.

## Summarise results

```bash
npm run eval:live -- evaluation/results/asl-2026-10.jsonl
```

The summariser reports, per language:

- signed-trial accuracy;
- coverage, meaning how often a sign was accepted rather than rejected;
- precision among accepted sign predictions;
- wrong accepted signs and common confusions;
- no-sign false-accept rate.

A model should not be promoted from experimental status on vocabulary size alone. Promotion requires a documented live-camera evaluation and explicit thresholds chosen before looking at the final results.
