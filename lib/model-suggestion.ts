import type { TranscriptEntry } from "./browser-storage";
import type { LanguageId } from "./model-adapters";
import { MAX_PENDING_SUGGESTIONS, SUGGESTION_ARMING_MS, SUGGESTION_LIFETIME_MS, modelWordsNeedAcceptance,
  starterWordsNeedAcceptance } from "./model-output-policy";
import type { WorkerConfirmation, WorkerSuggestion } from "./vision-types";

/** A recognised word offered for a person to add. Provenance is kept: a
 * research model's word or an ASL starter rule's word. */
export type PendingSuggestion = {
  /** Session-qualified, so an id reused by a restarted worker never matches. */
  key: string;
  language: LanguageId;
  source: "model" | "starter";
  text: string;
  gloss: string;
  confidence: number;
  /** When it was shown (Date.now()); drives arming and expiry. */
  shownAt: number;
};

/** Turn a worker message into a suggestion for the language on screen, or null
 * when it is a word that enters the transcript directly. */
export function suggestionFromMessage(message: WorkerSuggestion | WorkerConfirmation, language: LanguageId, now: number,
  starterOutput: "auto" | "suggest" = "suggest"): PendingSuggestion | null {
  if (message.type === "suggested") {
    if (message.language !== language || message.source !== "model") return null;
    return { key: `${message.session ?? 0}:${message.id}`, language, source: "model", text: message.text, gloss: message.gloss, confidence: message.confidence, shownAt: now };
  }
  // Defence in depth: a research-model confirmation (for example from an older
  // cached worker) is demoted to a suggestion.
  if (message.source === "model" && modelWordsNeedAcceptance(language)) {
    return { key: `${message.session ?? 0}:c${message.timestamp}:${message.gloss}`, language, source: "model", text: message.text, gloss: message.gloss, confidence: message.confidence, shownAt: now };
  }
  if (message.source === "starter" && starterWordsNeedAcceptance(starterOutput)) {
    return { key: `${message.session ?? 0}:t${message.timestamp}:${message.gloss}`, language, source: "starter", text: message.text, gloss: message.gloss, confidence: message.confidence, shownAt: now };
  }
  return null;
}

/** Newest first; the same word from the same source replaces its older card. */
export function offerSuggestion(list: readonly PendingSuggestion[], next: PendingSuggestion, max = MAX_PENDING_SUGGESTIONS): PendingSuggestion[] {
  return [next, ...list.filter(item => item.key !== next.key && !(item.gloss === next.gloss && item.source === next.source))].slice(0, max);
}

export function withoutSuggestion(list: readonly PendingSuggestion[], key: string) {
  return list.filter(item => item.key !== key);
}

export function unexpired(list: readonly PendingSuggestion[], now: number) {
  return list.filter(item => now - item.shownAt <= SUGGESTION_LIFETIME_MS);
}

export type AcceptOutcome =
  | { accepted: true; entry: TranscriptEntry }
  | { accepted: false; reason: "none" | "stale" | "too-soon" | "expired" | "language" };

/** Accept only a suggestion that is on screen now, after it has been visible
 * long enough to be read, before it expires, for the language still selected. */
export function acceptSuggestion(pending: readonly PendingSuggestion[] | PendingSuggestion | null, key: string, language: LanguageId, now: number): AcceptOutcome {
  const list = pending === null ? [] : Array.isArray(pending) ? pending : [pending as PendingSuggestion];
  if (!list.length) return { accepted: false, reason: "none" };
  const current = list.find(item => item.key === key);
  if (!current) return { accepted: false, reason: "stale" };
  if (current.language !== language) return { accepted: false, reason: "language" };
  if (now - current.shownAt < SUGGESTION_ARMING_MS) return { accepted: false, reason: "too-soon" };
  if (now - current.shownAt > SUGGESTION_LIFETIME_MS) return { accepted: false, reason: "expired" };
  return { accepted: true, entry: {
    id: `${now}-${current.gloss}-accepted`.slice(0, 100),
    text: current.text, gloss: current.gloss, confidence: current.confidence, timestamp: now,
    source: current.source, acceptedBy: "user",
  } };
}

export function isExpired(current: PendingSuggestion | null, now: number) {
  return Boolean(current && now - current.shownAt > SUGGESTION_LIFETIME_MS);
}
