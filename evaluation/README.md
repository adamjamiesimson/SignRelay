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
