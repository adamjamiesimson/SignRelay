# Engine V3.1 model (frozen)

Same 523-class vocabulary and input contract as V3.0 (`../v3.0/`), retrained on more data:
ensemble of two Convformers (standard loss, and class-balanced loss with power 0.5) trained on
PopSign ASL v2.1 tranches A+B+D (19,587 clips) plus 600 FSBoard fingerspelling windows as UNKNOWN.
`FREEZE.json` fingerprints were committed before the holdout-2 evaluation.

Attribution: PopSign ASL v2.1 (Starner et al., Georgia Tech & DPAN) and FSBoard (Google), CC BY 4.0.
No ASL Citizen data were used for training.
