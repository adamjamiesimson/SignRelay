# Personal-template stall (Sprint 4, objective 09)

**Status: fixed in software; real-device effect not measured.** Node worker threads on this container (Intel Xeon 2.80 GHz x4, Node 22.22.0). This is not a browser, camera or phone measurement.

## Root cause

Personal templates (24 x 240 numbers per example) were structured-cloned as about 7,000 nested arrays on every hop. With 300 examples that is about 28 MB of JavaScript arrays, and the clone cost about 270–340 ms here.

1. **App → recognition worker.** `RecognitionSession` posted the plain arrays. The page thread paid the serialisation and the recognition thread paid the deserialisation. This happens at workspace start, on every language change and after every saved example, which is mid-session while the camera runs.
2. **Recognition worker → matcher.** `TemplateMatchingClient` created the matcher worker only on the first hand frame and cloned every template into it, inside that frame's handler (the Sprint 3 P2 finding). On later template updates it cloned them again.

## Fix

- `lib/template-transport.ts` packs templates into one `Float64Array` plus per-example metadata, and the buffer is transferred, not copied. Float64 keeps every value bit-exact, including `-0`, `NaN` and legacy 208-feature rows, so DTW distances and decisions cannot change. Tests: round trip, identical `recognizePersonalTemplate` decisions for six signs, and a real-worker confirmation in 8 languages with both transports.
- `RecognitionSession` sends packed templates. The recognition worker still accepts plain arrays, so older callers and tests keep working.
- The personal matcher is created, and sent its packed templates, when templates arrive rather than on the first hand frame. The PSL matcher stays lazy, so its 775 references download only when PSL is used.

No threshold, window, distance cutoff, ambiguity margin, model or rule changed. The recognition worker bundle changed (`ccce84c8…` → see `public/workers/recognition.worker.js`), so the paired real-video pilot must reproduce the 11-trial established baseline before this build can carry real-video evidence (see the ledger).

## Before and after

`node scripts/benchmarks/first-frame-stall.mjs --repeat 7`: before on `ccbecfa` with `--transport arrays` (what the app sent then), after on this branch with `--transport packed` (what the app sends now). Medians of 7 runs. One frame in flight at 20 Hz, 80 synthetic frames. Raw data: [before](first-frame-stall-before-ccbecfa.json), [after](first-frame-stall-after.json).

| Scenario | Examples | Worst frame wait, before → after | Frames answered (of 80 / of ~35) | Posting-thread cost of one send |
| --- | --- | --- | --- | --- |
| Frames start straight after templates (Sprint 3 condition) | 30 | 39 → 19 ms | 80 → 80 | 13 → 2 ms |
| | 150 | 199 → 44 ms | 78 → 80 | 76 → 6 ms |
| | 300 | **415 → 60 ms** | 72 → 80 | 161 → 16 ms |
| Templates, then 0.5 s camera start, then frames | 30 | 6 → 3 ms | 80 → 80 | 2 → 2 ms |
| | 150 | 35 → 3 ms | 80 → 80 | 68 → 8 ms |
| | 300 | 109 → 4 ms | 79 → 80 | 145 → 19 ms |
| Templates re-sent mid-session (after saving an example) | 30 | 45 → 9 ms | 35 → 35 | 12 → 2 ms |
| | 150 | 268 → 40 ms | 32 → 35 | 61 → 8 ms |
| | 300 | **618 → 75 ms** | 28 → 35 | 151 → 25 ms |

The "before" first-hand-frame wait reproduces the Sprint 3 finding (13 / 170 / 407 ms there; 39 / 199 / 415 ms here). The posting-thread column is the recognition-worker side of the cost in this harness. In the app the same serialisation ran on the page's main thread.

`LONG_SESSION_SECONDS=30 node scripts/benchmarks/long-session.mjs` (now posting templates the way the app does): 300 examples, ack p95 1.3 ms, max 80 ms at t = 0.08 s, 0 dropped, 0 faults. The PSL 775-reference scenario is unchanged (p95 1.1 ms, max 11 ms).

## Remaining limits

- The remaining ~60–75 ms at 300 examples is unpacking (≈20–30 ms) and repacking on the recognition thread plus garbage collection. It could be removed by forwarding the packed subset without unpacking. That was not done, because this measurement does not show it is needed.
- Browser main-thread jank was not measured in a browser. Real phones are likely slower than this container.
