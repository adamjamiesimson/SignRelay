# ASL fist motion discrimination

## Problem

The previous YES fallback accepted a mostly closed hand whenever its middle
knuckle moved vertically and reversed direction. Whole-arm travel, fist
preparation, and the beginning of an uneven SORRY circle could satisfy this.
The worker could confirm after two adjacent frames and clear the history before
the intended movement was complete. A shorter recognition window could also
win before a longer window revealed the circle.

## Change

- YES now requires a closed hand followed by a completed wrist bend and return.
  Palm orientation is measured relative to the wrist using hand landmarks,
  including wrist-relative depth. Moving the whole fist vertically is no longer
  sufficient evidence.
- Finger extension, sideways rotation, large tracking flips, isolated depth
  spikes, and an unfinished bend are rejected. A short stable ending is required.
  Existing tracking-gap handling and slow-camera support remain in use.
- Chest-circle recognition permits narrower ellipses and normalizes the two
  axes. A completed SORRY match takes precedence over a YES match in a shorter
  window. This also retains the open-hand PLEASE circle rule.
- Research-model YES results require the same motion evidence. Rejected results
  are cleared so further inference can proceed. User-saved personal templates
  retain priority, including an explicitly personalized YES gesture.
- The built worker and its URL version are updated together so the next page
  load requests the patched worker.

The motion distinction follows ASL University's descriptions of
[YES](https://www.lifeprint.com/asl101/pages-signs/y/yes.htm) and
[SORRY](https://www.lifeprint.com/asl101/pages-signs/s/sorry.htm). YES uses wrist
flexion; SORRY uses circular movement at or just in front of the chest. The
implementation accepts a closed hand without requiring an exact thumb placement.

## Validation and limits

The new regression suite initially reproduced 12 failures. It now contains 20
cases covering fist preparation, rigid fist travel, an extended index finger,
one-way tilting, sideways movement, incomplete nods, depth spikes, uneven chest
circles, mirrored and smaller hands, jitter, fast and slow capture, model-result
rejection and recovery, and personalized gestures. Tests feed every prefix as
well as the full sequence through the temporal rules and the real worker
confirmation code. Neural predictions are mocked in these discrimination tests.

The earlier positive YES fixture only translated a rigid fist. It now includes
wrist flexion; the rigid translation is retained as a negative example in the
new suite. This corrects the fixture's gesture assumption instead of treating
every vertically moving fist as a valid positive.

Validation commands: `npm test`, `npm run lint`, and `npm run build:firebase`.
All 153 tests and the Firebase build pass. Lint has no errors and two existing
Next.js image-element warnings.

These are constructed kinematic regressions, not a measured sign-language
accuracy benchmark. Reference descriptions were checked; the attempted reference
animation replay did not complete and is not counted as validation. No natural
webcam recordings or held-out signer dataset were evaluated for this patch.
The rules remain heuristic and may miss shallow or poorly tracked nods. They
deliberately abstain when YES movement is ambiguous. This patch does not retrain
models or establish recognition accuracy for all six languages.
