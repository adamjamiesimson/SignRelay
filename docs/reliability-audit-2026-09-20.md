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
