import { validateTrials } from "./evaluation-metrics.mjs";
const label = value => typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase() : null;

/** Preserve observed words even when a clip fails later. An unrelated or
 * unavailable page result cannot supply counters or establish a rejection. */
export function failedEvaluationTrial(fixture, split, partial, error) {
  const matches = partial && partial.recording_sha256 === fixture.recording_sha256
    && partial.participant_id === fixture.participant_id && partial.language === fixture.language
    && partial.evaluation_split === split
    && partial.trial_type === fixture.trial_type && label(partial.expected_gloss) === label(fixture.expected_gloss)
    && partial.capture_mode === "unique-decoded-source-frames";
  const observed = matches ? validateTrials([partial])[0] : null;
  if (observed && (![observed.frames, observed.hand_frames, observed.analyses].every(n => Number.isInteger(n) && n >= 0)
    || observed.hand_frames > observed.frames || observed.analyses > observed.frames)) throw new Error("Invalid partial trial counters");
  const accepted = observed?.accepted_glosses ?? [];
  return { ...fixture, ...(observed ?? {}), trial_id: fixture.trial_id,
    participant_id: fixture.participant_id, language: fixture.language, trial_type: fixture.trial_type,
    expected_gloss: fixture.expected_gloss, evaluation_split: split,
    session_id: observed?.session_id ?? `failed-${fixture.trial_id}`,
    recording_sha256: fixture.recording_sha256, capture_mode: "unique-decoded-source-frames",
    accepted: accepted.length > 0, predicted_gloss: accepted[0] ?? null, accepted_glosses: accepted,
    frames: observed?.frames ?? null, hand_frames: observed?.hand_frames ?? null, analyses: observed?.analyses ?? null,
    status: "error", errors: [...new Set([...(observed?.errors ?? []), String(error)])] };
}
