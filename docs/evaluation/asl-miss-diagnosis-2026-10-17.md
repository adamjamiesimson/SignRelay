# Remaining ASL misses, 17 October 2026

The remaining misses do not share one cause. Fresh production-worker traces reproduce the previous outputs: **five correct and six abstaining recordings out of the same eleven inspected development clips**. This follow-up adds diagnostics and a reviewed collection/import workflow; recognition behavior, thresholds, model mappings, model assets and production worker bytes are unchanged. It claims no new accuracy gain.

The path inspected is original decoded video frames → production MediaPipe VisionEngine → recognition session → production starter/motion/model arbitration → two-evidence confirmation. All successful source frames receive worker analyses. These are publisher-labelled isolated signs; a new fluent reviewer has not verified their variants or the temporal extent of each articulation.

| Abstaining development recording | Hand frames / decoded frames | Earliest observable failure or limit |
| --- | ---: | --- |
| HELLO `gtsignstudy4a.8031` | 11 / 37 | One HELLO starter candidate, then no second candidate; tracking ends around 1.272 s. The confirmation requirement remains intact. |
| THANK YOU `gtsignstudy4a.8031` | 4 / 31 | Only about 134 ms of hand evidence. No window meets the starter's sample/time requirements; the model's six-observation minimum is also unreachable. |
| THANK YOU `gtsignstudy4a.8033` | 15 / 37 | Four ambiguity analyses; one PLEASE and one THANK YOU candidate at separate observations. Neither gets a confirming streak. The prior wrong emitted PLEASE remains withheld. |
| THANK YOU `4a.7003` | 6 / 30 | Hands tracked only about 0.400–0.633 s; two endpoints meet basic starter tracking prerequisites, but no starter rule matches and no completed model segment appears. |
| HELLO `4a.8006` | 12 / 35 | Seven endpoints meet basic tracking prerequisites, but no starter candidate appears. The generic motion gate reports moving, then tracking disappears; the model never receives a ready segment. |
| YES `4a.8006` | 5 / 31 | At most two consecutive hand frames and one basic eligible starter endpoint. No completed YES proposal; fewer than six hand observations prevent the research-model path. |

All six abstaining clips have zero worker `motionReason=ready` analyses. Thus their current traces do not support attributing these misses to a wrong closed-set neural-model classification. Basic tracking eligibility is necessary, not sufficient: it does not prove correct open-palm/fist shape, head location, departure, circle or nod completion. The other five recordings still confirm their prior words. Individual unconfirmed wrong candidates remain visible in the aggregate diagnostics rather than being described as zero possible confusion.

Practical next repairs need reviewed evidence: establish exactly which frames contain the intended stroke; test hand acquisition and recovery across real fist/open-hand motion; review the HELLO location/variant before altering geometric rules; and preserve the mouth/circle ambiguity and two-evidence safeguards while investigating THANK YOU. Do not lower confidence, tracking or confirmation requirements to make these six known recordings pass. Three original frames were inspected locally to check framing/motion visibility; that inspection is not fluent ASL annotation and no frames are included in this report.

## Reproduction and evidence limits

Local runtime: Node 24.19.0, Chrome for Testing headless shell 151.0.7922.34, exact Tasks JS/WASM 0.10.35. Source videos, unique decoded unmirrored frames at at most 20 Hz, fresh tracker/worker state per clip and no added ending pause match the previous protocol. Worker SHA-256 remains `8a7d967e8c23ce76078cde1db5cb6672fcb5eef209ab207c7da539b829f860cd`. Rows retain parent source commit `9c579fa4ac408c0b6b284e97bb23584f702b464b`; harness changes in progress are represented by their actual dirty flag. The report fingerprints the diagnostic source used for analysis separately from recognition-worker identity.

The first additional-development attempt had two real frame-delivery timeouts, on PLEASE and HELLO. Its failed rows and summary are retained and counted as errors, not abstentions. A fresh complete five-recording retry returned the prior 2 correct / 0 wrong / 3 abstentions. This does not establish that the intermittent browser decoding issue is repaired. Historical replay completed with 3 correct / 0 wrong / 3 abstentions. Completed runs each have one analysis per decoded frame; their frame/hand counts remain 220/101 and 194/49. Browser logs also include aborted blob loads during teardown.

Explicit local trace mode was used only on development recordings. Raw footage, face frames and landmark traces remain in ignored local directories and are not in Git or workflow artifacts. The new report tool rejects held-out, incomplete, identity-mismatched and counter-mismatched traces; outputs only aggregate counts; and does not simulate unconsumed histories after successful confirmations.

```sh
npx esbuild scripts/diagnostics/asl-trace-report.ts --bundle --platform=node --format=esm --outfile=work/asl-trace-report.mjs
node work/asl-trace-report.mjs evaluation/raw/recognition-traces/LOCAL_RUN_ID \
  evaluation/derived/run.jsonl evaluation/derived/new-trace-report.json
```

[Aggregate reports and unchanged-output comparisons](asl-miss-diagnosis-2026-10-17/). [The prepared 144-slot review/collection packet](reviewed-development-collection-2026-10-17.md) is ready for actual recording and independent review. Zero new real no-sign/OOV recordings exist; their false-acceptance rates remain null. All five reserved holdout clips remain unfetched, unviewed and unevaluated. Physical-phone measurements and the full dependency audit remain release blockers. No merge or deployment was performed.
