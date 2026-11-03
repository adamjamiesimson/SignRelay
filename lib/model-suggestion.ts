import type { TranscriptEntry } from "./browser-storage";
import type { LanguageId } from "./model-adapters";
import { SUGGESTION_ARMING_MS, SUGGESTION_LIFETIME_MS, modelWordsNeedAcceptance } from "./model-output-policy";
import type { WorkerConfirmation, WorkerSuggestion } from "./vision-types";

/** The single research-model suggestion on screen. A newer one replaces it. */
export type PendingSuggestion = {
  /** Session-qualified, so an id reused by a restarted worker never matches. */
  key: string;
  language: LanguageId;
  text: string;
  gloss: string;
  confidence: number;
  /** When it was shown (Date.now()); drives arming and expiry. */
  shownAt: number;
};

/** Turn a worker message into a suggestion for the language on screen, or null. */
export function suggestionFromMessage(message: WorkerSuggestion | WorkerConfirmation, language: LanguageId, now: number): PendingSuggestion | null {
  if (message.type === "suggested") {
    if (message.language !== language || message.source !== "model") return null;
    return { key: `${message.session ?? 0}:${message.id}`, language, text: message.text, gloss: message.gloss, confidence: message.confidence, shownAt: now };
  }
  // Defence in depth: a model-only confirmation for a suggest-only language
  // (for example from an older cached worker) is demoted to a suggestion.
  if (message.source === "model" && modelWordsNeedAcceptance(language)) {
    return { key: `${message.session ?? 0}:c${message.timestamp}:${message.gloss}`, language, text: message.text, gloss: message.gloss, confidence: message.confidence, shownAt: now };
  }
  return null;
}

export type AcceptOutcome =
  | { accepted: true; entry: TranscriptEntry }
  | { accepted: false; reason: "none" | "stale" | "too-soon" | "expired" | "language" };

/** Accept only the suggestion that is on screen now, after it has been visible
 * long enough to be read, before it expires, for the language still selected. */
export function acceptSuggestion(current: PendingSuggestion | null, key: string, language: LanguageId, now: number): AcceptOutcome {
  if (!current) return { accepted: false, reason: "none" };
  if (current.key !== key) return { accepted: false, reason: "stale" };
  if (current.language !== language) return { accepted: false, reason: "language" };
  if (now - current.shownAt < SUGGESTION_ARMING_MS) return { accepted: false, reason: "too-soon" };
  if (now - current.shownAt > SUGGESTION_LIFETIME_MS) return { accepted: false, reason: "expired" };
  return { accepted: true, entry: {
    id: `${now}-${current.gloss}-accepted`.slice(0, 100),
    text: current.text, gloss: current.gloss, confidence: current.confidence, timestamp: now,
    source: "model", acceptedBy: "user",
  } };
}

export function isExpired(current: PendingSuggestion | null, now: number) {
  return Boolean(current && now - current.shownAt > SUGGESTION_LIFETIME_MS);
}
