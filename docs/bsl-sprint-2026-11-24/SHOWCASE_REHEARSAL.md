# BSL showcase: candidate signs and physical-camera rehearsal protocol

**Status: no BSL sign below has measured live-camera or recorded-video accuracy in SignRelay yet.**
The list is a *candidate* set drawn from the installed 1,064-class BSL-1K vocabulary. It becomes a showcase
set only after the per-sign rehearsal below, performed by a fluent BSL signer.

## Why these signs

Every label is an exact entry of `public/models/bsl1064-pose2sign/labels.json` (checked by
`tests/bsl-showcase.test.ts`). They were chosen as everyday conversation words that a demo audience
understands, mixing one-handed and two-handed signs and different locations. BSL-1K labels are
English **mouthing keywords** from BBC interpreted broadcasts, so a label can cover regional variants or a
different sign than a signer expects for that English word. The rehearsing signer must use the form they would
naturally use and record which variant it was. Never transfer an ASL form because the English word matches.

| # | Label | Why included |
| --- | --- | --- |
| 1 | HELLO | greeting, opens every demo |
| 2 | PLEASE | politeness |
| 3 | SORRY | politeness |
| 4 | YES | answer |
| 5 | HELP | two-handed, high utility |
| 6 | NAME | introductions |
| 7 | DEAF | identity, audience relevance |
| 8 | HEARING | contrast with DEAF (similar location — confusion check) |
| 9 | FRIEND | two-handed |
| 10 | FAMILY | two-handed |
| 11 | WORK | two-handed |
| 12 | WATER | everyday noun |
| 13 | DRINK | similar region to WATER (confusion check) |
| 14 | HAPPY | emotion |
| 15 | WHERE | question |
| 16 | WHAT | question, similar to WHERE (confusion check) |
| 17 | AGAIN | conversation repair |
| 18 | FINISH | two-handed |

Not in the vocabulary (do **not** demo with this model): THANK YOU, NO, GOOD, TEA, EAT, TODAY, GOODBYE, OK.
These can be taught as personal signs in the workspace, which uses a separate on-device matcher.

## Setup (record it in the log for every session)

- Device, browser, camera resolution, `?perf` delegate line; lighting (front/side), background, distance.
- Framing: head, both shoulders, elbows and both hands within the frame at rest; signer roughly centred.
  BSL-1K was trained on broadcast crops of an interpreter's upper body — closer framing is expected to match
  the model better than a distant full-room view (unverified; measure both distances once).
- Open `/?perf` (developer-only). Choose BSL. Confirm `Model ready` in the BSL stage lines before starting.
- For the A/B, run every block twice: once with the default engine, once with the v2 input selected through the QA lab
  (`/__qa/recognition-lab.html?diagnostics=1&bslEngine=v2`, local QA build only).

## Per-sign procedure

For each candidate sign, 10 attempts, each: hands at rest ≥ 1 s → one sign at natural speed → hands still
≥ 0.5 s (the motion gate needs a short hold to close the sign). Record per attempt:

- the suggestion shown (or none), and whether it was correct;
- the `?perf` "Last BSL decision" line (top-3, windows, hand frames, hand-label corrections, reason);
- whether any word reached the transcript or speech without pressing "Add to transcript" (must be zero).

Negative blocks (10 each): ordinary movement (scratch face, adjust hair/glasses, reach for a cup, wave at someone
off-camera), unsupported BSL signs (e.g. THANK YOU, GOOD), and resting hands. Any suggestion is a false accept.

## Pass criteria for putting a sign on stage

- ≥ 7/10 correct suggestions and ≤ 1/10 wrong suggestions for that sign, on two separate sessions
  (ideally two signers and two lighting conditions);
- confusion partners (HEARING/DEAF, WATER/DRINK, WHAT/WHERE) do not take each other;
- the negative blocks produce ≤ 1 false suggestion in 30 trials overall.

Signs that fail stay available in the full vocabulary but are not used in the scripted demo.

## Per-sign report template

Copy to `docs/bsl-sprint-2026-11-24/rehearsal-YYYY-MM-DD.md` (derived counts only — no video, no landmarks,
pseudonymous signer IDs):

| Label | Variant used | Engine | Correct | Wrong (what) | Abstained | Median suggestion delay | Notes |
| --- | --- | --- | ---: | --- | ---: | ---: | --- |
| HELLO | | legacy | /10 | | /10 | | |
| HELLO | | v2 | /10 | | /10 | | |
