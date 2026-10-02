# ASL live-domain evaluation — 2026-10-02

This note records the evidence behind SignRelay's decision to disable shared
automatic ASL transcript output. It is intentionally conservative: vocabulary
size, training-dataset accuracy and a successful browser build are not treated
as evidence that a model is safe on a live camera domain.

## Frozen cross-dataset regression set

SignRelay's public ASLLVD regression set contains 36 isolated ASL clips:

- 30 broad WLASL-overlap signs;
- four HELLO clips;
- two THANK YOU clips.

The source list is pinned in `evaluation/asllvd-v1.sources.jsonl`; clips are
downloaded only at evaluation time and SHA-256 verified.

Frozen fixture-set SHA-256:

`6189c92da2be104d40fefd6326c6f5703c2ee42fb021bd97264a83269743c65e`

This is a cross-dataset regression check, not a representative estimate of all
ASL, continuous signing, or all 2,000 WLASL classes.

## WLASL2000 Pose-TGCN browser path

The installed WLASL checkpoint was trained in the OpenPose/WLASL domain and
adapted at runtime from SignRelay's MediaPipe observations.

### Normal production gates

On the frozen 36-clip ASLLVD set:

- signed-trial accuracy: **0%**;
- accepted coverage: **11.1%** in the first frozen run;
- precision when accepted: **0%**;
- the expected gloss was never observed as the accepted candidate.

The failures were not explained by missing hand tracking alone: many incorrect
or rejected trials had good hand coverage.

### Orientation matrix

The same fixture set was replayed after independently testing:

1. baseline mapping;
2. swapped left/right hand channels;
3. mirrored X coordinates;
4. swapped hands plus mirrored X.

All four variants remained at **0% accuracy / 0% accepted precision**. This
rules out a simple mirror/hand-label mismatch as the main failure.

### Candidate-history diagnostic

The evaluator was extended to record every visible candidate and its peak
confidence. On the frozen set, the correct expected gloss did not surface even
briefly at the production model gate. The transcript decoder therefore was not
merely discarding otherwise-correct answers.

### Rejection gates removed

A research-only run set the WLASL confidence threshold to zero and disabled the
competing-class margin so the raw closed-set winner could pass through.

Result:

- coverage: **66.7%** (24/36 accepted);
- accuracy: **0%**;
- precision when accepted: **0%**;
- correct expected candidate: **0/36**.

Lowering thresholds therefore increases confident wrong output rather than
recovering correct recognition. The existing WLASL live adapter must not be
re-enabled by threshold tuning alone.

## Handcrafted common-sign rules

The previous automatic fallback rules for HELLO, NO, YES, PLEASE, SORRY,
THANK YOU and I LOVE YOU were also isolated from the neural model and replayed
against the same external clips.

The rules produced confident false accepts on unrelated signs, including:

- CAUSE -> THANK YOU;
- DISAPPEAR -> HELLO;
- KING -> SORRY;
- GET -> HELLO.

They also confused the held-out common-sign clips, including HELLO -> SORRY and
THANK YOU -> HELLO. The rules remain useful as synthetic geometry regression
tests, but they are no longer permitted to insert live transcript words.

## Production decision

As of 2026-10-02:

- shared automatic ASL transcript recognition is **disabled**;
- the 2,000-label WLASL research assets remain in the repository only for
  reproducibility and future research;
- handcrafted starter rules do **not** act as a transcript fallback;
- explicitly recorded personal ASL templates remain available on-device;
- no shared ASL model may be promoted again solely on training/dataset metrics.

This deliberately chooses visible lack of automatic coverage over silent
meaning-changing mistranslation.

## ASL Citizen replacement research

Microsoft's official ASL Citizen ST-GCN was investigated because its baseline
uses MediaPipe Holistic landmarks and a signer-independent webcam-oriented
dataset.

A research-only reproduction on a deterministic 60-clip sample from the
official ASL Citizen test split produced:

- top-1: **58.3%**;
- top-5: **81.7%**;
- top-20: **91.7%**;
- median expected rank: **1**.

Those results closely reproduce the published ST-GCN baseline and validate the
checkpoint reconstruction/preprocessing.

The model also converts to a ~15.2 MB float32 ONNX file with 100% top-1
agreement in the numerical parity spot checks used by the exporter.

However, the same model scored 0% top-1/top-5/top-20 on the 28 overlapping
labels in the frozen ASLLVD sample, reinforcing that cross-dataset/live-domain
generalisation is a separate problem from source-dataset accuracy.

The ASL Citizen materials are retained on a separate research branch and are
not bundled in the public SignRelay application. Their licence/terms must be
resolved before any redistribution.

## Required gate for a future shared ASL model

A replacement shared model must pass all of the following before activation:

1. Browser/runtime numerical parity against its reference implementation.
2. Signer-independent source-dataset validation where available.
3. A frozen external-video regression set that was not used to tune the
   adapter, thresholds or model.
4. Explicit no-sign/background trials from consented non-sign recordings;
   sign clips must never be chopped or relabelled as NO_SIGN.
5. Separate reporting of accuracy, accepted coverage, precision when accepted,
   no-sign false-accept rate and common confusions.
6. Multiple signers and more than one camera/background/lighting condition.
7. No activation based merely on vocabulary size or top-k source-dataset
   results.

The current automated evaluator and dataset-integrity tooling are ready for
that process. The remaining missing evidence is a consented, frozen no-sign /
real interaction set and a shared model whose licence and cross-domain quality
are both acceptable.
