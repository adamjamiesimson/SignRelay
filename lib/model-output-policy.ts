import type { LanguageId } from "./model-adapters";

/**
 * How a research model's own words reach the transcript.
 *
 * "suggest": the worker never confirms a word whose only evidence is the
 * research model. It sends a `suggested` message instead, and the workspace
 * shows it as an experimental suggestion that a person must deliberately add
 * (or dismiss). Nothing is inserted, announced as confirmed, or spoken.
 *
 * ASL uses "suggest": on SignRelay's MediaPipe input only about 13% of the
 * ASL-2000 words accepted at the production gate are correct, and precision
 * does not improve with a stricter threshold, so confidence cannot be used to
 * decide (docs/evaluation/asl2000-sprint8). Starter rules and personal signs
 * are not research-model output and keep automatic confirmation.
 *
 * Other languages keep their existing behaviour in this change; extending the
 * safeguard to them is a one-line policy decision (docs/release-candidate).
 * There is deliberately no runtime override: no message, URL or storage value
 * can turn a suggestion back into an automatic confirmation.
 */
export const SUGGEST_ONLY_MODEL_LANGUAGES: ReadonlySet<LanguageId> = new Set<LanguageId>(["asl"]);

export function modelWordsNeedAcceptance(language: LanguageId): boolean {
  return SUGGEST_ONLY_MODEL_LANGUAGES.has(language);
}

/** How long an unanswered suggestion stays offered before it is withdrawn. */
export const SUGGESTION_LIFETIME_MS = 12000;
/** A suggestion's buttons ignore activation this soon after it appears, so a
 * tap or key press already in progress cannot accept a word the person has
 * not yet seen. */
export const SUGGESTION_ARMING_MS = 600;
