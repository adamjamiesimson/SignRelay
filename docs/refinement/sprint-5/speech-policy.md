# Auto speak when words arrive quickly (Sprint 5, objective 17)

**Status: documented. Policy unchanged; it needs an owner decision.**

## Current behaviour

`speak()` in `components/translator-experience.tsx` calls `speechSynthesis.cancel()` and then `speak(utterance)` for every confirmed word when Auto speak is on, and for the manual **Speak** button. The Web Speech API's `cancel()` empties the queue *and* stops the utterance being spoken. So:

- each confirmed word is passed to the speech engine exactly once (pinned by `transcript-a11y-smoke`: the call order is `cancel, speak:Hello, cancel, speak:Thank you, …`);
- if a word is confirmed while the previous one is still being spoken, the previous one is cut off and the newest word is heard.

How often this matters, in principle: two-evidence confirmation, the stroke itself and the rest the demo asks for put at least about 0.5–1 s between confirmations in the synthetic sequences. A single English word at rate 0.95 takes about 0.4–0.7 s to speak, so short words rarely overlap. Long custom phrases (up to 48 characters) can. This was not measured with real speech: headless Chromium has no voices, and no speaker test has been done (MAN-5).

## Options

| Option | Behaviour | Risk |
| --- | --- | --- |
| A. Cancel, then speak (current) | The newest word is always heard; speech never lags behind the transcript | A word still being spoken is cut off |
| B. Queue (no cancel for auto speak) | Every word is spoken in full, in order | Speech can lag behind signing. Chrome has a long-standing bug where long queues stall. Stop and Pause still need to cancel the whole queue |
| C. Queue with a bound (e.g. cancel only when 2+ are waiting) | Words are spoken in full unless the backlog grows | More state. Still needs the speaker test to choose the bound |

Stop, Pause camera, Save & clear, changing language and Clear local data must cancel under every option. They already do, and they are tested.

## Recommendation

Keep A until MAN-5 (a real speaker on the demo laptop) shows that words are actually cut off in practice. If they are, B with the existing cancel points is the smallest change: a one-line difference in `speak()` for auto speak only. It would need the call-order assertion in `transcript-a11y-smoke` updated deliberately.
