import { LANGUAGE_IDS, type LanguageId } from "./model-adapters";

/**
 * How recognised words reach the transcript.
 *
 * Research-model words, every language: the worker never confirms a word whose
 * only evidence is a research model (ASL-2000, BSL-1064, ISL-263, LSE-300, or
 * the PSL dictionary matcher). It sends `suggested`, and the workspace shows it
 * as a suggestion that a person must deliberately add or dismiss; nothing is
 * inserted, announced as confirmed, or spoken. None of these models has
 * independent live-camera accuracy evidence; ASL-2000's accepted words are about
 * 13% correct on MediaPipe input and confidence is uninformative
 * (docs/evaluation/asl2000-sprint8). There is no runtime override.
 *
 * ASL starter-rule words: governed by the build-time STARTER_OUTPUT policy
 * (lib/release.ts): suggestions by default, automatic only in research builds.
 * Personal signs (taught by the user on this device) stay automatic.
 * Russian and Bangla run in separate components that only display suggestions.
 */
export const SUGGEST_ONLY_MODEL_LANGUAGES: ReadonlySet<LanguageId> = new Set<LanguageId>(LANGUAGE_IDS);

export function modelWordsNeedAcceptance(language: LanguageId): boolean {
  return SUGGEST_ONLY_MODEL_LANGUAGES.has(language);
}

/** Starter rules exist only for ASL. */
export function starterWordsNeedAcceptance(policy: "auto" | "suggest"): boolean {
  return policy !== "auto";
}

/** How long an unanswered suggestion stays offered before it is withdrawn. */
export const SUGGESTION_LIFETIME_MS = 12000;
/** A suggestion's buttons ignore activation this soon after it appears, so a
 * tap or key press already in progress cannot accept a word the person has
 * not yet seen. */
export const SUGGESTION_ARMING_MS = 600;
/** At most this many suggestions are offered at once, newest first, so a word
 * signed a moment ago is not lost when the next one arrives. */
export const MAX_PENDING_SUGGESTIONS = 3;
