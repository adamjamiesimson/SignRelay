# Owner checklist — inputs engineering cannot supply (28 October 2026)

Nothing below has been done. Each item names the exact input still missing. The protocols, recorder, intake tools and gates are unchanged: [manual-testing handoff](../integration-2026-10-26/manual-testing.md), [operator kit](../sprint-6/operator-kit.md), [field protocols](../sprint-6/field-test-protocols.md), [independent review guide](../../gitex/independent-review-guide.md), [collection plan](../../evaluation/development-collection-plan-2026-10-17.json).

## Devices (supervised, per device)

- [ ] **Laptop, one Android phone, one iPhone**, each on a secure origin (HTTPS or `localhost`), with a current local build of this branch. Record the recognition worker hash: it must read `b454deb00b6e…` unless the branch moves.
- [ ] **≥10 analyzed fps preflight** with `?perf`, run at 60 s and again at ten minutes. Stop on failure and record it.
- [ ] **New for this follow-up:** record the ASL-2000 `model` time shown by `?perf` (worker `modelMs`) during signing, as median and p95 over the session. The worker can confirm a model-only word only when one inference is shorter than about 1.1 s with a ≥2 s still hold; see the [latency envelope](README.md#2-asl-2000-model-path-latency-not-staleness). A device above that runs the six demo words on starter rules only. This is an observation to record, not a new gate.
- [ ] Ten-minute session per device, with memory at one and ten minutes.
- [ ] MAN-1 through MAN-5 exactly as written, recording pass, fail or not run against device, build and worker hash.
- [ ] On the Windows laptop used for the integration run: `npm test` (the full suite, not one file). Report the full-suite result separately from any isolated rerun. The everyday-movement case should now take about 55% of its former time. Engineering could not run Windows here.

## People

- [ ] Four new development signers, pseudonyms `dev-20261017-p01`–`p04`, with both dominant hands represented across the cohort. Recruit separately from reserved-holdout participants. Consent records stay private and are never committed.
- [ ] One independent fluent ASL reviewer, blinded to predictions. Before seeing any output, they choose **three OOV glosses absent from the installed automatic vocabulary**: ASL-2000 labels (`public/models/asl2000-tgcn/labels.json`) *and* starter words, not merely absent from the six demo words.

## Recordings (collection targets, not a power claim)

- [ ] **72 signed takes:** 4 signers × HELLO, THANK YOU, PLEASE, SORRY, YES, NO × 3 comfortable speeds.
  - Include a **natural ending: hands held briefly, then lowered**. Do not trim at the end of the stroke.
  - Every one of the 11 existing clips ends during or immediately after the stroke. See [what the replay can and cannot show](README.md#3-why-the-real-clip-misses-happen).
- [ ] **48 no-sign takes:** the six listed activities × 2 takes × 4 signers.
- [ ] **24 OOV takes:** the reviewer's 3 glosses × 2 takes × 4 signers.
- [ ] **SORRY:** no real recording exists yet. It is part of the 72.
- [ ] Each take is one continuous original: ≤30 s, ≤100 MB, natural dominant hand, with no cropping, mirroring or frame duplication. Keep failed takes and dropouts, with reasons.
- [ ] Raw video, `.capture.json`, landmarks, consent and review records go only under ignored `evaluation/videos/` and `evaluation/raw/`. Verify no-upload behaviour and download completeness before ending each session.

## Do not

- Open the five reserved sealed holdouts.
- Tune to the 11 existing development clips, or lower any threshold or confirmation requirement to make them pass.
- Enable an OFF experiment without the reviewed evidence its protocol requires.
- Edit expectations or add gate waivers.
- Treat synthetic fixtures, CI fake-camera runs or cross-machine timings as human or device evidence.

Public release remains **NO-GO** until the reviewed collection, the device gates and an authorized sealed-holdout evaluation are complete.
