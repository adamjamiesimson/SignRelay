# Why THANK YOU and YES are still missed — 30 October 2026

**Status:** analysis of committed, coordinate-free evidence only. No code, threshold, gate, rule or expectation was changed.

The 11 development clips could not be replayed again: the clip host fails TLS verification on CI, and this container's proxy refuses it ([report §7](README.md#7-blocked-the-asl-video-pilot)). The sealed holdout was not touched.

**Sources:**

- PR #45's traced pilot aggregates, [development](../followup-2026-10-28/trace-report-development.json) and [historical](../followup-2026-10-28/trace-report-historical.json) (worker `b454deb00b6e`, [run 40656015750](https://github.com/adamjamiesimson/SignRelay/actions/runs/40656015750))
- the shipped tracker and worker code

## Evidence

All 11 clips are short (1.0–1.7 s at ~33 ms per frame). The worker's motion reasons replay identically offline (`replayed_motion_reasons_match_worker: true`).

| Trial | Outcome | Hand frames | Longest tracked run | Worker motion sequence (frames) |
| --- | --- | ---: | ---: | --- |
| THANK YOU `dev-thankyou-4a.7003` | miss | 6/30 | 233 ms | hands-lost 8 · idle 5 · **moving 1 · hands-lost 16** |
| THANK YOU `thankyou-…8031` | miss | 4/31 | 134 ms | hands-lost 11 · idle 4 · **hands-lost 16** |
| THANK YOU `thankyou-…8033` | miss | 15/37 | 704 ms | hands-lost 11 · idle 5 · **moving 10 · hands-lost 11**; starter proposed PLEASE once and THANK YOU once (ambiguity veto) |
| YES `dev-yes-4a.8006` | miss | 5/31 | **33 ms** | hands-lost 13 · idle 2 · lost 1 · idle 1 · lost 2 · idle 2 · lost 10 |
| HELLO `dev-hello-4a.8006` | miss | 12/35 | 568 ms | hands-lost 10 · idle 6 · **moving 6 · hands-lost 13** |
| HELLO `hello-…8031` | miss | 11/37 | 502 ms | hands-lost 16 · idle 5 · **moving 6 · hands-lost 10**; one HELLO proposal |
| HELLO `hello-…8033` | accepted | 9/35 | 168 ms | … idle 4 · lost 3 · idle 2 · lost 1 · idle 2 · lost 1 · idle 1 · lost 9 |
| NO `dev-no-4a.8030` | accepted | 11/51 | 334 ms | … idle 5 · moving 1 · **idle 2** · lost 1 · idle 3 · lost 26 |
| PLEASE `dev-please-4a.8017` | accepted | 15/47 | 234 ms | … moving 4 · **idle 2** · … moving 1 · lost 12 |
| PLEASE `please-…8031` | accepted | 17/34 | 802 ms | … idle 5 · moving 7 · **idle 5** · lost 9 |
| PLEASE `please-…8033` | accepted | 45/46 | 2,212 ms | … moving 9 · **idle 3** · moving 6 · **idle 21** · moving 1 |

### What is established

1. **The app discards no hand the tracker reports.** In all 11 trials, the frames where the tracker reported a hand equal the frames the app counts as valid hands. Every missing frame is one where MediaPipe returned no hand. That means either the hand was out of view, or the tracker failed to detect it.
2. **Every miss except YES ends with the hand lost while moving or before moving.** In the four missed THANK YOU and HELLO clips that reached `moving`, the hand disappeared before it was ever seen settled after the movement. Missed THANK YOU 8031 was lost before any movement registered.
   - **Accepted clips:** four of the five show an `idle` run *after* movement, with the hand settled in view.
   - **The exception, HELLO 8033:** it never registers `moving` at all, because its tracking was too fragmented (the longest run was 168 ms). The starter rules recognized HELLO from those fragments.
   - **Sparse tracking alone does not separate the groups:** HELLO 8033 had 9/35 hand frames, fewer than missed HELLO 8031's 11/37.

   The pattern is consistent but rests on 11 short clips. It is a lead, not a proof.
3. **That end-of-movement requirement is a deliberate safeguard.** The motion gate (`lib/sign-motion.ts`) releases a sequence only when the hand is visible and settled after moving. It is what keeps everyday movements from becoming words. PR #45's ungated probe of the missed clips' longest episodes produced the wrong top-1 every time (DAWN, EVERYDAY, GRAPES, STRUCTURE), and two of those would have passed the model's own confidence gate. **Relaxing completion would trade these misses for wrong acceptances.**
4. **YES is a different failure.** The hand is never tracked for more than two consecutive frames (33 ms), so no recognizer can see a wrist nod. This is a tracking failure on a closed-fist handshape, not a recognition decision.
5. **THANK YOU 8033 was stopped by the ambiguity veto.** The starter rules proposed PLEASE once and THANK YOU once, then the hand was lost while moving. Both outcomes are safeguards working as designed.
6. **Model latency and stale results are not the cause on these clips.** The motion gate never released a sequence in any missed clip, so ASL-2000 was never asked (PR #45). The faster scheduling in PR #46 therefore cannot help these clips. It could only change clips where the gate does release.

### Why THANK YOU is especially exposed (inference, not yet confirmed)

THANK YOU's stroke ends moving outward and downward from the chin, which flows directly into lowering the hand. If the signer lowers immediately, the end of the movement is never seen still in view. The same holds for HELLO's outward salute. PLEASE and SORRY circle on the chest and naturally end in place; NO ends in a closed hand held in view. This matches the table, but it is inferred from motion labels. It still needs fluent review of the footage, or live trials (below), to confirm.

## Hypotheses not yet tested

| Hypothesis | What would test it | Status |
| --- | --- | --- |
| The PopSign takes are trimmed at the end of the stroke, so the "hand lost" runs are the hand leaving the frame, not tracker failures | Fluent or visual review of the 6 missed clips | Needs footage review (owner) |
| Palm detection misses blurred, fast-moving hands, closed fists (YES) or hands near the face (THANK YOU starts at the chin) | Per-frame detection coverage on the dev clips at the shipped settings vs MediaPipe defaults, and IMAGE vs VIDEO mode | Needs clips (host blocked) and diagnostic-only tooling (owner decision, below) |
| The shipped tracker confidence (0.55 detection, presence and tracking) costs recall | Same sweep. 0.55 dates from the first commit (`7efebe0`, 25 Aug) with no recorded evaluation; MediaPipe's defaults are 0.5. `numHands: 2` means palm detection already runs on every frame while one hand is tracked. | As above. **Any change would alter tracking for every sign and could raise false accepts**, so it must pass the real-video pilot (0 wrong), the synthetic adversarial and tail-guard gates, and live MAN-2 false-accept trials before adoption. |
| A brief hold (about 0.3–0.5 s) before lowering is enough for THANK YOU and HELLO in live use | Live MAN-1 trials with the miss-stage codes from the [manual-testing guide §7](manual-testing-guide.md#7-recording-why-a-thank-you-or-yes-was-missed), noting whether the signer held | Ready to run; owner |

## What was deliberately not done

- No threshold, gate, completion rule, confirmation requirement or experiment was changed. Nothing was tuned to these 11 clip identities.
- No tracker setting was changed. That would be untestable while the pilot is blocked, and you asked that #44–#46 stay unchanged unless a verified fix is necessary.
- No clip was cached or redistributed, and TLS verification was not weakened.

## Proposed next steps (each needs the owner)

1. **Live, stage-coded trials** ([guide §7](manual-testing-guide.md#7-recording-why-a-thank-you-or-yes-was-missed)). This is the fastest real-world evidence and needs no code. If most THANK YOU misses are `stage=lost-moving` and the same signer succeeds after a natural hold, the issue is end-of-stroke visibility, not the recognizer.
2. **Footage review** of the six missed clips: was the hand in frame during the "hand lost" runs?
3. **Diagnostic detection sweep** once the clip host verifies again. Report per-clip hand coverage only (coordinate-free) under alternative tracker settings, with no production change. It would be new diagnostic tooling, so it needs your agreement to add, either to #46 or to a separate follow-up PR.
4. **New reviewed recordings with a natural hold and lowering**, as already planned in [PR #45's owner checklist](../followup-2026-10-28/owner-checklist.md). The four signers' 72 takes would separate "trimmed clip" from "tracker failure" directly.
