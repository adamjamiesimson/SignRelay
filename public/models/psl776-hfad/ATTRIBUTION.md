# Pakistan Sign Language: HFAD dictionary reference templates

These 775 landmark sequences come from the Pakistan Sign Language dictionary
recorded at the **Hamza Foundation Academy for the Deaf (HFAD), Lahore,
Pakistan**, released as part of the
[sign-language-translator/sign-language-datasets](https://github.com/sign-language-translator/sign-language-datasets)
project (release `v0.0.4`, MediaPipe image-space landmark CSVs). The dataset
is declared under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Please retain this attribution when redistributing these derived templates.
The dataset creators and HFAD do not endorse SignRelay.

Changes: each official `pk-hfad-1_<sign>.landmarks-mediapipe-image.csv` file
(pose + left hand + right hand, verified against the source project's own
`connections.py` landmark-index layout: 0-32 pose, 33-53 left hand, 54-74
right hand) was converted into SignRelay's existing calibration-template
feature representation (`lib/personalized-recognition.ts`,
`prepareCalibrationSequence`) and rounded to 4 decimal places. 775 of 788
released dictionary entries had a usable English gloss mapping and at least
8 frames of tracked hand motion; 13 were skipped. See
`training/prepare_psl_hfad.ts` for the exact, reproducible conversion.

**This is not a trained classifier.** Each word has exactly one official
reference performance. Recognition is one-shot dynamic-time-warping distance
matching against that single reference, using the same distance function and
reject gate already used for a signer's own personal templates
(`lib/personalized-recognition.ts`). No accuracy evaluation exists: not
against held-out signers, not against live camera use, not at all. Treat it
as roughly as reliable as matching against one well-performed personal
recording, sensitive to signing speed, style, camera framing and hand
dominance. It is not comparable to the six neural-network-trained languages
already installed (ASL, BSL, RSL, Bangla, LSE, ISL), which at least have a
held-out or publisher-clip evaluation number attached.

No raw video, audio, or personally identifying imagery from the original
dataset is bundled — only normalised landmark coordinates.
