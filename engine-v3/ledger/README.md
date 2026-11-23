# Experiment ledger

`experiments.jsonl` — one JSON object per run or evaluation, appended in order: what ran, on which data
(tranche manifests and cache digests), hardware, wall time, outputs and headline metrics. Full
machine-readable reports sit next to it (`*.json`). Reports that include ASL Citizen contain only
aggregate numbers (no media, landmarks or per-clip identifiers from that dataset).
