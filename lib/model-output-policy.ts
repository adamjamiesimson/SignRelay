import { LANGUAGE_IDS, type LanguageId } from "./model-adapters";
import type { WorkerConfirmation } from "./vision-types";

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

/** Worker payloads can come from a cached bundle. Require explicit provenance
 * before allowing an incoming word to reach the automatic transcript path. */
export function canConfirmAutomatically(source: WorkerConfirmation["source"], language: LanguageId,
  starterOutput: "auto" | "suggest"): boolean {
  return source === "personal" || (source === "starter" && language === "asl" && !starterWordsNeedAcceptance(starterOutput));
}

/** How long an unanswered suggestion stays offered before it is withdrawn. */
export const SUGGESTION_LIFETIME_MS = 12000;
/** A suggestion's buttons ignore activation this soon after it appears, so a
 * tap or key press already in progress cannot accept a word the person has
 * not yet seen. */
export const SUGGESTION_ARMING_MS = 600;
/** At most this many suggestion cards are shown at once, in signing order. */
export const MAX_PENDING_SUGGESTIONS = 3;
/** While the person is pointing at or focused in the suggestions, nothing
 * expires (WCAG 2.2.1). On leaving, each card keeps at least this long. */
export const SUGGESTION_RELEASE_GRACE_MS = 4000;
/** Suggestions that arrive while every slot is taken and the person is
 * interacting wait (not shown) up to this many; more are reported as not added. */
export const MAX_WAITING_SUGGESTIONS = 3;
/** "Not added" notes (expired or pushed out without a decision) are listed for
 * this long, at most MAX_MISSED_NOTES words. They cannot be added. */
export const MISSED_NOTE_LIFETIME_MS = 20000;
export const MAX_MISSED_NOTES = 3;
