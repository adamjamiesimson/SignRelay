# SignRelay GITEX YouthX demo package — Sprint 2 update (research prototype)

Updated 21 October 2026. Branch `sprint/gitex-coding-hardening-2026-10-21`, draft PR https://github.com/adamjamiesimson/SignRelay/pull/37, stacked on #36. This update supersedes the setup and test sections of [`demo-package-2026-10-21.md`](demo-package-2026-10-21.md). The demonstration sequence, signer rules and privacy explanation there still apply.

Related files: contract [`demo-contract.json`](demo-contract.json) (27 automated + 5 manual criteria); ledger [`sprint-2-ledger.md`](sprint-2-ledger.md); triage [`sprint-2/evaluation-report.md`](sprint-2/evaluation-report.md).

## Release decision: NO-GO

| Gate | State |
| --- | --- |
| Automated contract (27 criteria) | Passing locally; CI on the PR head (see the PR) |
| Manual gates MAN-1…MAN-5 on the demo laptop, real webcam and a signer | **Pending.** No physical device or signer was available |
| Independent fluent ASL review, consenting new signers, sealed holdout | **Blocked / unopened** |
| Strict dependency audit (`npm run audit:security`) | Fails: 5 dev-only `braces` advisories. Owner decision |
| Merge / deploy | Not done; needs owner approval |

Software verification is not proof of real-world signing accuracy.

## Setup (once, with internet)

```bash
git checkout sprint/gitex-coding-hardening-2026-10-21   # or the approved merge
npm ci
npm run demo:prepare          # ASL-only build (no RSL download) and runtime verification
npm run demo:check -- "$(command -v google-chrome)"   # optional: strict no-outbound browser check
```

At the venue (no internet needed):

```bash
npm run demo:serve            # http://127.0.0.1:3000, loopback only
```

`demo:serve` refuses to start in three cases:
- `out/` is missing;
- `out/` is the full multilingual build or the rehearsal build;
- the runtime in `out/` no longer verifies. That covers a tampered, missing or stale model, WASM file or worker.

On start it prints the worker hash and its recorded development evidence: 5/11 correct, 0 wrong, on previously inspected clips. In this build only ASL is selectable; the other languages are shown disabled with their attribution notices. Analytics is never configured.

## Pre-flight on the demo laptop (part of MAN-1)

- **Frame rate:** open `http://127.0.0.1:3000/?perf` and start the camera. The readout should show **at least 10 frames analysed/s**. It also shows tracking p50/p95, round trip, queue wait, forwarded/s and dropped frames. In synthetic tests, YES is lost at 5–8 fps. In headless Chromium on a 4-core Xeon, tracking ran at about 4–6 frames/s, and the rehearsal lost PLEASE, SORRY and YES until the tracker cost was removed. If the laptop is below 10 frames/s, close other apps, plug in power, and do not demonstrate YES.
- **Assets:** the readout must end with "assets self-hosted".

## Automated software rehearsal (engineering only, never shown as signing)

```bash
npm run build:rehearsal && node tests/gitex-rehearsal-smoke.mjs <chrome>
npm run demo:prepare          # rebuild the demo export afterwards
```

The rehearsal build puts an **AUTOMATED SOFTWARE REHEARSAL** banner on every page. While a script plays, it replaces the tracker's output with synthetic landmarks; the real camera stream, frame loop, worker, transcript, Copy and speech controls still run.

Last local run:
- abstained on three non-sign movements;
- confirmed the six-word script in order;
- auto-spoke each word once;
- Speak and Stop worked;
- Copy showed its fallback message (headless clipboard was denied);
- recovered from a camera interruption.

This is **not** a person signing and **not** a pre-recorded fallback. `demo:serve` refuses this build, and every other build is verified not to contain the hook.

## What Sprint 2 verified (software only)

| Area | Result |
| --- | --- |
| Offline ASL demo | 0 non-loopback requests from page and workers behind a deny-all proxy. The self-test catches planted page and worker leaks |
| Runtime | WASM, pinned models, ASL-2000 checksums, ORT and worker match. Worker `ccce84c8` equals the committed bundle |
| Regression gate | CI real-video pilot vs the established baseline: 0 changes on 11 trials (run 39573034510) |
| Lifecycle | 12 start/pause cycles (median restart 1.6 s), rapid cancels, hidden tab, external track end, 3 workspace re-entries. No leaked tracks or workers |
| Faults | Worker crashes: 2 automatic restarts, then a manual restart. Failed construction, missing or corrupted model, throwing storage: all reported and recovered |
| Accessibility | Keyboard reaches all 35 workspace controls with visible focus. Targets are ≥ 24×24 px at 390 px (two switches and two sliders were fixed). Reduced motion takes running animations from 39 to 0. axe: 0 violations |
| Long session (Node threads) | 120 s at 20 Hz with 30–300 personal examples or 775 PSL references: ack p95 < 1 ms with no drift; 1 dropped of 9,603; memory reaches a plateau |

## Known findings (updated)

1. **Evidence is thin.** The real-video record is the 11 reused clips: PLEASE 3/3, NO 1/1, HELLO 1/3, THANK YOU 0/3, YES 0/1, SORRY 0 trials.
2. **Synthetic false accepts:** 280 of 684 adversarial runs produce HELLO (144) or THANK YOU (136). Triggers include glasses, eye-shielding, hair, waving, blowing a kiss, a hand rising toward the forehead and lowering a hand from the mouth. Mitigation: the signer rules, plus no waving or kisses. Four default-OFF experiments reduce this to 72 on synthetic fixtures, but they are unevaluated on real video and stay off.
3. **Model tail after a rule confirmation:** with an always-wrong confident model, THANK YOU was followed by a model word in 9 of 51 synthetic runs. A guard is proposed for owner decision; production is unchanged.
4. **Frame rate:** see the pre-flight section above.
5. **Very short pauses (0–100 ms) can drop YES.** Keep about 0.5–1 s rests with the hands lowered.
6. The strict audit `braces` advisory is unresolved.
