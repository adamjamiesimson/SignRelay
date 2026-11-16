import type { LanguageId } from "./model-adapters";

/**
 * Which languages' research-model words must be added by a person instead of
 * entering the transcript automatically.
 *
 * ASL: the WLASL2000 Pose-TGCN was trained on OpenPose keypoints. On the
 * publisher's own test keypoints it reaches 22% top-1 and about 36% of the words
 * it accepts are right; on the same videos through MediaPipe about 13% are
 * right, and precision does not improve at any confidence threshold
 * (docs/evaluation/recognition-sprint-2026-11-16.md). Its words are therefore
 * suggestions.
 *
 * The other research models are unchanged here: no measurement exists for them
 * in either direction. ASL sign-rule words and personal signs stay automatic.
 */
export const SUGGEST_ONLY_MODEL_LANGUAGES: ReadonlySet<LanguageId> = new Set<LanguageId>(["asl"]);

export function modelWordsNeedAcceptance(language: LanguageId): boolean {
  return SUGGEST_ONLY_MODEL_LANGUAGES.has(language);
}

/** How long an unanswered suggestion stays offered before it is withdrawn. */
export const SUGGESTION_LIFETIME_MS = 12000;
