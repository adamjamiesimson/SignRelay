# Recognition session recovery — 9 September 2026

## Reproduced failure

The deployed worker contained the previous timing repair. The remaining ASL
runtime performed its entire neural computation synchronously in the same
worker that handles camera frames, common signs, personal signs and resets.

Six executions of the actual packed model in the development environment took
852, 685, 678, 666, 633 and 626 ms. Eligible inference was scheduled at 250 ms
intervals and the camera could send frames every 50 ms. This creates a worker
responsiveness problem after the model loads, independently of sign accuracy.

A regression test warms the actual model, schedules ordinary timer events,
then runs inference again. Before the fix, zero events were handled before
inference completed. The repaired runtime handles multiple events during that
same computation and returns the same prediction. Model arithmetic and weights
are unchanged; computation yields between graph layers.

## Changes

- The ASL runtime yields to queued tasks while computing. Other frame messages
  and resets can run between graph layers.
- Recent completed movement remains eligible for up to 2.5 seconds so two
  independent CPU predictions can finish. Current hands, movement boundaries,
  prediction age, confidence thresholds and duplicate checks still apply.
- The browser sends at most one unacknowledged frame and retains only the
  newest waiting frame. It no longer builds an unbounded camera-message queue.
- Session and frame identifiers reject stale output after reset, restart or
  language changes.
- Worker crashes, message errors and eight seconds without a frame response
  trigger automatic recovery. A model request that remains pending for twenty
  seconds also requests recovery. The selected language and personal templates
  are restored; transcript entries remain in React state.
- Recovery allows two automatic restarts per minute, then exposes an explicit
  Restart recognition button rather than entering an endless reload loop.
- Camera disconnection and stalled video produce a visible reconnect action.
  Returning to the tab resets old recognition context and resumes paused video
  when possible.
- The worker URL is versioned for the new message protocol. Firebase builds
  regenerate the committed executable worker from its TypeScript source.

## Verification and limits

The automated suite has 133 tests, including real-model responsiveness,
two 700 ms simulated model results, sixty successive synthetic signs, bounded
queues, timeout/crash recovery, stale-message rejection, selected-language and
template restoration, and shutdown. Tests of synthetic signing are software
regressions, not a real-person accuracy benchmark or a physical-camera soak test.

The live app opened in the remote browser and correctly reported that the
remote environment has no camera. The user's mid-session camera state could
not be observed, so this repairs reproduced blocking/recovery defects without
claiming that every possible device or recognition failure has been eliminated.

Validation commands: npm test, npm run lint and npm run build:firebase.
Keep the existing Firebase Hosting project and deploy with upload concurrency 1.
