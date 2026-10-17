# Video-frame reliability follow-up, 17 October 2026

**Keep draft.** This changes the local evaluation harness, not production recognition. The last full eleven-clip development result remains **5 correct / 0 wrong / 6 abstentions**. New signer recordings, independent fluent ASL review, real negative examples and physical-phone validation remain outstanding. No reserved holdout was consumed.

## Observed ordering and repair

Two instrumented replays of the five already-used additional-development clips recorded **338 of 378 frame callbacks while `video.seeking` was still true**. Both passes completed; the earlier natural callback timeouts were not reproduced. This establishes an event-ordering race in the old sampler, not proof that it caused every earlier timeout. [Aggregate observations](video-frame-reliability-2026-10-17/previous-stepper-ordering.json) contain no imagery, coordinates or raw event streams. Repetitions of five recordings are not ten independent accuracy observations.

The lab now waits for both a completed seek and a presentation callback from the current wait interval before processing. It retains the actual callback's source timestamp, skips repeated timestamps at the existing 1 ms tolerance, keeps the 50 ms sampling schedule, and appends no held/end frames. Queued presentations predating the seek are ignored within the same deadline. Media-error, source-release and stop/cancellation paths dispose of listeners and pending callbacks. Loading is bounded to 10 seconds; each seek/presentation remains bounded to the original 3 seconds. Timeout messages report target/current time, seek completion, callback availability and ready state.

Presentation metadata is best-effort; HTML video seeking is not guaranteed frame-accurate. This remains a browser sampler. See the [Chrome team's explanation](https://web.dev/articles/requestvideoframecallback-rvfc) and [HTML seeking specification](https://html.spec.whatwg.org/multipage/media.html#seeking).

File rows identify `frame_stepper=seek-and-presentation-v1`. Worker comparisons, the historical pilot gate and runtime-only experiments reject mixed stepping implementations. The manual harness experiment below compares unchanged worker bytes explicitly; it does not weaken a worker-comparison gate.

## Verification

- **384 tests / 47 files** pass, including 17 focused stepping/loading cases and mixed-stepper rejection. TypeScript and ESLint pass.
- Generated 10 fps and 30 fps patterns pass the actual browser helper. Old/new timestamp sequences match, with 10 and 20 unique observations respectively. Duplicate low-rate frames are skipped. A seek without its presentation callback fails; cancellation releases the wait and a subsequent seek succeeds. These are technical controls, not sign/negative accuracy evidence. [Results](video-frame-reliability-2026-10-17/generated-browser-controls.json).
- The real NO failure control retains **30 frames / 11 hand-visible frames / 30 analyses / NO**, reports `error`, and earns zero successful-trial credit. Injection now begins after 30 processed frames and a NO confirmation; counting registrations could instead withhold an already-cancelled speculative request. [Results](video-frame-reliability-2026-10-17/forced-failure-browser.json).
- The final local five-clip development replay completes with **2 correct / 0 wrong / 3 abstentions**, unchanged accepted words, source-frame counts and hand-visible counts. [Rows](video-frame-reliability-2026-10-17/development.jsonl) and [explicit harness comparison](video-frame-reliability-2026-10-17/development-harness-comparison.json). The six historical development clips remain in the hosted paired workflow; see PR #30 for its exact-head outcome.
- Production worker SHA-256 remains `8a7d967e8c23ce76078cde1db5cb6672fcb5eef209ab207c7da539b829f860cd`. All **56** installed model fingerprints match. No recognition rule, threshold, mapping, weight or saved-user-data change is included.

One initial local failure-control invocation produced no usable result; the next exposed its obsolete callback counter by completing without the intended fault. Neither is a successful control. The revised injector subsequently passed. Exploratory passes are not pooled into independent accuracy statistics. Aborted local blob loads during teardown remain visible in the replay summary.

## Remaining work

The refreshed [full audit](video-frame-reliability-2026-10-17/audit-full.json) still reports **five high development-tool findings** in `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. The [production audit](video-frame-reliability-2026-10-17/audit-production.json) has zero findings. Registry checks still return `braces` 3.0.3 and Next lint plugin/config 16.4.2; the [active advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) lists no patched release. No downgrade, replacement alias, audit waiver or force-fix is applied. This blocker remains unresolved.

The [144-slot recording/review packet](reviewed-development-collection-2026-10-17.md) is ready; **zero new real recordings and zero fluent reviews** have been collected. Participants and an independent fluent reviewer must supply those observations before missed-sign repairs can be validated. The [physical-phone protocol](sprint-release-readiness-2026-10-16.md) still requires actual hardware.

Only the five frozen `development` recordings were downloaded locally. Automatic review initially rejected the older six-clip filename containing `holdout`; the cohort lock identifies it as `historical-development`, distinct from `sealed-holdout`. This local follow-up used the unambiguous development manifest after checking its role and fingerprint. All five actual reserved media paths remain absent. No merge or deployment was performed.

[Source/derived fingerprints and validation metadata](video-frame-reliability-2026-10-17/verification.json). Hosted CI is reported in [draft PR #30](https://github.com/adamjamiesimson/SignRelay/pull/30).
