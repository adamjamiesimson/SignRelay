# Replacing the ASL starter rules: technical direction

**Status: research infrastructure, no product change.** Nothing here is used by the app. No accuracy is claimed: the only real-signing data available, the WLASL clips captured in CI, was already exposed by the PR #55 evaluation.

## 1. What the evidence says the rules lack

From `docs/release-candidate/STARTER-RELIABILITY.md` (176 WLASL clips; 16 correct and 33 wrong starter words):

| Failure | Mechanism | What a recognizer must model |
|---|---|---|
| **PLEASE / SORRY (17 wrong):** HAPPY, PLAY, PARTY, BASEBALL… | Any repeated movement in front of the chest qualifies. | **Handshape** (flat B, fist A or S, Y, 5), **repetition** structure (one circle vs. repeated brushing), and **two-handed coordination**, since PLAY and PARTY are two-handed. |
| **THANK YOU (12 wrong):** BAD, SAD, VOMIT… | A hand that starts near the mouth and moves away qualifies, and the rule fires before the movement ends. | **Location over time** (start, path, end relative to the body), **movement direction** (toward the addressee vs. down), **palm orientation**, and **segmentation**: decide at the end of the stroke, not mid-stroke. |
| **HELLO / NO / YES (4 wrong; YES 0/7 recalled)** | Location-only or one-cue rules. | Fine **finger articulation** (NO's index–middle–thumb closure, YES's wrist nod) and tolerance of signer variation. |
| **No rejection** | A rule fires whenever its pattern matches; there is no notion of "some other sign". | **Unknown-sign rejection** trained against real non-target signing and everyday movement. |

## 2. Architecture options

| Option | Handshape | Trajectory & location | Repetition | Segmentation | Two hands | Rejection | Data need | Verdict |
|---|---|---|---|---|---|---|---|---|
| **A. More rules** | hand-coded | hand-coded | hand-coded | heuristic | hand-coded | none | none | **Rejected.** PR #55 showed rule tightening trades one error for another, and every change was tuned on exposed clips. |
| **B. DTW nearest-neighbour on body-relative features** (this baseline) | yes (angles/ratios) | yes | yes (global descriptors) | motion-energy span | partial | distance tests plus "other" prototypes | tens per sign | **Build now as the yardstick.** It is transparent, trains in seconds, works with few examples, and shares the personal-sign DTW pipeline's strengths. |
| **C. Small temporal network** (1-D CNN / GRU / transformer over the same features) | learned | learned | learned | learned or windowed | learned | "other" class plus calibrated threshold | hundreds per sign plus many negatives | **Next step, once data exists.** Train offline, export to ONNX like the other models, and evaluate only on held-out signers. |
| **D. Large pretrained skeleton model** (the ASL-2000 TGCN, or similar) fine-tuned | learned | learned | learned | windowed | learned | open-set head | moderate (fine-tuning) | **Candidate for C's backbone.** The installed ASL-2000 model is uncalibrated (precision flat at 35–37% across thresholds) and showed ≈13% accepted precision on MediaPipe input, so it is a starting point, not a solution. |
| **E. RGB video model** | implicit | implicit | implicit | windowed | implicit | open-set head | large | **Not now.** It needs heavy compute and video training data. Keeping only landmarks is also better for privacy. |

**Recommendation.** Use B to build the evaluation discipline: signer-disjoint folds, exposure tracking, raw-recognition vs. transcript metrics, and rejection on real negatives. Collect consented data through the signer study and `/field-test`. Move to C (or D-as-backbone) only when held-out signers can be evaluated. Ship nothing that is not better than the rules on **untouched** held-out signers, including on false accepts for confusable signs and everyday movement.

## 3. What is implemented (this branch)

| Module | What it does |
|---|---|
| **`lib/sign-features.ts`** | Per frame, 26 body-relative channels: handshape (finger extension ×5, thumb–index aperture, spread, palm normal), location (wrist and fingertip relative to the shoulders; distances to forehead, eyes, mouth and chest), motion (velocity, speed) and two-hand relation (presence, distance, offset, mirror symmetry). Left-dominant signing is mirrored onto one layout. Sequence-level functions: the active span from motion energy (`segmentActive`), repetition as direction reversals plus autocorrelation (`repetitionOf`), and resampling. |
| **`lib/temporal-baseline.ts`** | Option B. The configuration (`BASELINE_CONFIG`) was fixed before any data was seen. Matching uses banded DTW and k-NN, with per-channel normalisation fitted on training data only. Rejection has two parts: an absolute distance test, and closeness to "other" prototypes. Both thresholds are calibrated by leave-one-signer-out inside the training signers, to a 5% false-accept target on "other". |
| **`lib/temporal-experiment.ts`** | Signer-disjoint folds (leave-one-signer-out, or deterministic signer groups); the test signer is never in training, and this is asserted. Metrics: per-sign precision and recall, abstention, false accepts on "other" by kind (everyday / confusable / other sign / unsupported) and by predicted label, and risk–coverage. Exposed examples are reported separately, an "untouched only" view is shown when untouched data exists, and automatic caveats cover all-exposed data, few signers and few examples. The report carries a digest of the dataset manifest. |
| **`lib/temporal-predictors.ts`** | Two predictors on the same folds: the production starter rules, run frame by frame with a two-agreement confirmation like the worker, and the baseline. |
| **`scripts/research/temporal-experiment.mjs`** | `synthetic` (runs anywhere), `wlasl` (CI runner only) and `jsonl` (consented exports kept under `evaluation/raw/`). It writes aggregate JSON only. |
| **CI** | The `starter-reliability` workflow now records WLASL's own `signer_id` on the runner and runs the experiment on the captured landmarks. Only aggregates are uploaded. |
| **Tests** | `tests/temporal-baseline.test.ts` (11) covers scale, position and mirror invariance; handshape and location separation; segmentation; repetition; DTW; that no fold trains on its test signer; exposure reporting; exact metric arithmetic; and calibration on training signers only. |

## 4. Results so far

| Data | Status | What it can say |
|---|---|---|
| **Synthetic signers** (5 signers × 6 signs × 2 takes, plus 11 everyday controls each) | Rules: 60/60 recognised, 20/55 everyday movements accepted as a sign. Baseline: 53/60, 7 abstained, 0/55 accepted. | Only that the pipeline works end to end. The rules were written for these fixtures, and the fixtures resemble the false-trigger gestures (§1 of STARTER-RELIABILITY.md). **Not evidence.** |
| **WLASL** (CI, signer-disjoint, **every clip exposed**) | See the CI run linked in the PR. | At best a development estimate on very few positives (27 across 6 signs). It mainly shows whether representation B separates the confusions in §1. **Not evidence of accuracy**, and not a basis for adopting anything. |
| **Signer study, held-out signers** | Not run. Needs participants. | The first legitimate test. |

## 5. Data: what may be used

| Source | Licence / status | Use |
|---|---|---|
| WLASL (direct clips) | C-UDA: computational use. Clips are processed on the CI runner only and never redistributed. | Development only. Every clip in the current sets is **exposed**; new clips must be selected and recorded as untouched before being looked at. |
| PopSign | Blocked by a TLS certificate restriction in CI. Not bypassed. | None until the owner obtains it properly. |
| Signer study (`/study`) | Consented logs of outputs and corrections; no landmarks. | Transcript-safety and usability evaluation; correction labels. |
| `/field-test` recordings | Separate consent and the Research Recording Licence (`docs/evaluation/signer-study/CONSENT-AND-PRIVACY.md` §4). | Training and development examples (landmarks via `scripts/extract-evaluation-landmarks.py`), kept under `evaluation/raw/`. |
| Other public ASL datasets (for example ASL Citizen) | **The owner must check the licence terms** before any use. Not assumed here. | Possible pre-training for option C/D. |

**Rules:**
- Splits are by signer.
- Held-out signers are sealed until a candidate and its configuration are frozen.
- An exposure registry decides what counts as untouched: any clip or signer that has been looked at is marked exposed.
- No model is trained to improve numbers on exposed recordings, and nothing is deployed from an experiment without the untouched held-out comparison.

## 6. Next steps (in order)

1. **Run the signer study's development sessions.** Measure real false-accept and acceptance behaviour with the suggestion workflow.
2. **With consent, record `/field-test` takes from development signers.** Cover the six signs, the confusable signs and everyday movement, then extract landmarks.
3. **Run the baseline and the rules** on those development signers (`jsonl` mode), using leave-one-signer-out. Use the results to decide whether representation B separates PLEASE from HAPPY and THANK YOU from BAD/SAD.
4. **If there is enough data**, train option C on the same features, offline, with the same folds and report.
5. **Freeze one candidate**, then run the sealed held-out signers once. A candidate replaces the rules only if it beats them there on both recognition and false accepts. Even then, words stay suggestions until an owner decision based on that evidence.
