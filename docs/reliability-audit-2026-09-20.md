# Reliability audit — 20 September 2026

Follow-up to the 19 September work (PSL install, BSL/ISL/LSE/PSL shape-gate
and feedback-text fixes). This session verified those changes by actually
running the app in a browser (not just the test suite), which caught a real
gap the tests couldn't: `/languages` and `/models` are hand-authored pages
that silently omitted PSL's honesty caveats even though `lib/model-adapters.ts`,
`README.md` and `ATTRIBUTION.md` all had them correctly. Fixed both pages
and pushed. Also fixed a pluralisation bug ("1 languages") spotted in the
same screenshots, and a flaky ONNX WASM execution test (`tests/onnx-runtime.test.ts`)
that intermittently exceeded Vitest's default 5s timeout under full-suite
CPU contention — confirmed it passes reliably in isolation, so this is
slow real execution, not a hang; given it a 20s budget instead of masking it.

## Systematic check for more "special-cased to ASL only" gaps

Grepped every `activeLanguage === "asl"` branch in
`workers/recognition.worker.ts` to check whether more of BSL/ISL/LSE/PSL's
gaps were hiding the same way the feedback-text one was.

- The hardcoded common-sign "starter" vocabulary (`recognizeAslStarter`,
  the historical fist/YES fix) is legitimately ASL-only: it encodes actual
  motion knowledge of specific ASL signs. There is no equivalent curated
  vocabulary defined anywhere for BSL/ISL/LSE/PSL, and fabricating one
  without real linguistic reference would be worse than not having it.
- The buffer-length cap (120 frames for ASL vs. 80 for others) and the
  post-confirmation buffer-clear asymmetry (ASL clears fully, others keep
  the last 5 frames) both look like deliberate tuning for each language's
  own sequence-length contract, not accidental gaps.
- Checked `components/rsl-recognizer.tsx` and `components/bdsl-recognizer.tsx`
  (the two "slow single-capture" languages, which don't route through
  `recognition.worker.ts` at all) end to end. Both already handle
  cleanup/cancellation, visibility-change auto-stop, camera-track-ended
  detection, frame-rate throttling and stall detection correctly, and both
  are already honest in their result copy ("Experimental suggestion - not
  a verified translation", "A score is not measured accuracy"). No gaps
  found here.

## One real gap found, deliberately not fixed yet

ASL's motion gate (`lib/sign-motion.ts`, `analyzeSignMotion`) is explicitly
frame-rate-independent - it walks backward through timestamps to compare
motion "over at least 100 ms... so the gate does not depend on capture
frame rate" (see the comment at `lib/sign-motion.ts:34`). The shared generic
gate used by BSL/ISL/LSE/PSL (`analyzeGenericSignMotion`,
`lib/asl100-runtime.ts`) has no equivalent: its "tail window" is the last 7
tracked-hand samples, not the last N milliseconds. On a slow device
processing frames at a much lower rate, "last 7 samples" could span
noticeably longer or shorter real time than intended, which is the same
class of camera-speed-dependent bug already fixed once for ASL.

This was not fixed today. Unlike the two changes already shipped this
week (both traced to a concrete, previously-reported bug pattern - the
fist/YES misfire), this is a theoretical edge case found by code reading,
not a reported failure, and reworking a function four languages now
depend on without a concrete trigger case risked exactly the kind of
rushed change this project's own standards warn against. Recorded here so
it isn't lost, not fixed blind.

**Recommended next step if this becomes a live issue**: change the "tail"
in `analyzeGenericSignMotion` from `hands.slice(-7)` (last 7 tracked
samples) to a timestamp-windowed selection (e.g. "samples within the last
~230ms"), mirroring `recentContinuousFrames`'s approach already used by
`analyzeSignMotion`. Needs new synthetic-timestamp test fixtures at varied
frame rates before shipping, the same rigor as the shape-gate fix.

## Update (21 September 2026): the frame-rate gap above is fixed

`analyzeGenericSignMotion` (`lib/asl100-runtime.ts`) now selects its tail
by real elapsed time (`TAIL_WINDOW_MS = 230`) instead of a fixed sample
count, with a floor of 4 samples so very slow capture doesn't shrink the
window to one or two points. `dominantTrackedHands` was changed to carry
each sample's originating frame timestamp alongside it (it previously
returned bare `HandObservation`s, discarding timing), which the new
`tailWindow` helper needs.

New coverage in `tests/generic-sign-motion.test.ts` builds synthetic
sequences at two capture rates (~67fps and 5fps) and checks: a fast-camera
shape that only just settled (120ms) is still correctly rejected as
"moving" (the old fixed-7-sample tail would have wrongly accepted it,
since 7 samples at that rate sat entirely inside the settled stretch); a
fast-camera shape genuinely stable across the window is accepted; a
slow-camera sign is accepted via the sample floor rather than being forced
to wait over a second; and a slow-camera shape change too recent for the
floor to have seen it settle is still correctly rejected.

This exposed a pre-existing test-fixture bug while fixing it:
`tests/personalized-recognition.test.ts`'s `completed`/`naturalCompleted`
fixtures derived each frame's timestamp from the same position offset used
to encode "settled", so every settled frame collapsed onto one identical
timestamp instead of representing real elapsed capture time. That was
invisible to the old count-based tail but broke the new time-based one.
Fixed by attaching an independent, realistic ~30fps timestamp per frame
(`frameAt`), matching the pattern the adjacent `shapeShifting` test in the
same file already used.

Verified: `npm test -- --run` (23 test files, 221 tests, all green),
`npm run lint` clean, `npx tsc --noEmit` clean, `npm run build:worker`
rebuilds `recognition.worker.js` cleanly (652.1 KB), and the app was run
in a browser (Playwright against the Next dev server) - home, `/languages`,
`/models`, and the PSL/BSL/ISL/LSE workspaces all load and switch with no
console errors.

## Update (21 September 2026): code-review pass over the tail-window fix, then the rest of the translators

A `/code-review` pass at high effort against the frame-rate-window fix above
(commit `18f5786`) found a real gap in it: `tailWindow`'s sample floor had
no bound on elapsed time, so across a genuine tracking gap (the hand
briefly leaving frame, or a stalled/backgrounded capture pipeline resuming
later - a real jump in `frame.timestamp`) it could walk backward past the
gap to make up its floor of 4 samples, comparing fresh post-gap hand data
against stale pre-gap data. It also didn't actually reuse
`recentContinuousFrames` despite the commit message's claim to mirror it.

Fixed: `tailWindow` now runs `recentContinuousFrames(samples, 3600)` first
- the same adaptive per-cadence gap-limit logic ASL's own gate already
relies on - and applies the window/floor logic only inside that already
gap-safe run. If a real gap leaves fewer than the floor's worth of
genuinely continuous evidence, `analyzeGenericSignMotion` now reports
still-settling (`reason: "moving"`) rather than declaring a sign ready off
too little fresh data. New tests in `tests/generic-sign-motion.test.ts`
construct a 1000ms mid-stream stall and check both directions: 3 fresh
samples since the stall is correctly rejected, 4 is correctly accepted.

A second `/code-review` pass, this time a full-file audit (not a diff)
across the other four per-language runtimes not yet reviewed this session
(`bsl1064-runtime.ts`, `isl263-runtime.ts`, `lse300-runtime.ts`,
`psl776-runtime.ts`, `asl1000-runtime.ts`), found three more confirmed,
live bugs and one false positive:

- **ISL263's visibility gate was defeated by its own interpolation step.**
  `prepareIncludeInput` counted "visible" frames from the landmark array
  *after* `interpolateCoordinate` had already back-filled every zero
  coordinate in place. With even one real tracked point anywhere in the
  200-frame window, that pass makes nearly every frame look visible, so a
  clip with only 1-2 truly tracked frames still passed the
  `MIN_VISIBLE_FRAMES` gate. Fixed by counting visibility from the raw
  frames before interpolation runs. New test:
  `tests/isl-visibility-gate.test.ts`.
- **PSL776 could brick itself on one transient network failure.**
  `loadTemplates` cached the fetch promise without ever resetting it on
  error, unlike `landmark-model-loader.ts` and `asl1000-runtime.ts`'s
  `loadModel`, which both explicitly reset on failure to allow retries. A
  single momentary network hiccup meant PSL recognition never worked again
  for the rest of the page session. Fixed to match the same reset-on-error
  pattern already used elsewhere. New test:
  `tests/psl-template-retry.test.ts`.
- **BSL1064 and ISL263 leaked ONNX tensors.** Both built an input tensor
  and read output tensors without ever disposing either, unlike
  `lse300-runtime.ts`'s existing try/finally pattern. Since
  `landmark-model-loader.ts` requests the WebGPU execution provider first,
  those tensors can be GPU-backed, so a long signing session leaked GPU
  memory without bound. Fixed both to dispose the input tensor and every
  output tensor in a `finally` block, matching LSE. New test:
  `tests/onnx-tensor-disposal.test.ts`.
- **False positive, verified and not changed**: the review also flagged
  `asl1000-runtime.ts`'s TGCN residual/skip-connection bookkeeping as
  broken for "2+ consecutive residual layers." Checked against the
  reference Python export script (`training/export_wlasl1000_tgcn.py`)
  and the actual shipped manifest (`public/models/asl1000-tgcn/model.json`,
  `asl2000-tgcn/model.json`): both alternate non-residual/residual layers
  strictly in pairs with a max consecutive-residual run of 1, and the JS
  forward pass's skip logic exactly reproduces the Python reference for
  that pattern. No code changed here.

Verified: `npm test -- --run` (26 test files, 229 tests, all green),
`npm run lint` clean, `npx tsc --noEmit` clean, `npm run build:worker`
rebuilds cleanly (652.6 KB), and the app was re-run in a browser - home,
`/languages`, `/models`, and the PSL/BSL/ISL/LSE workspaces all load and
switch with no console errors.
