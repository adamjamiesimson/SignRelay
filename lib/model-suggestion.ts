import type { TranscriptEntry } from "./browser-storage";
import type { LanguageId } from "./model-adapters";
import { MAX_MISSED_NOTES, MAX_PENDING_SUGGESTIONS, MAX_WAITING_SUGGESTIONS, MISSED_NOTE_LIFETIME_MS, SUGGESTION_ARMING_MS,
  SUGGESTION_LIFETIME_MS, SUGGESTION_RELEASE_GRACE_MS, modelWordsNeedAcceptance, starterWordsNeedAcceptance } from "./model-output-policy";
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
  /** The worker's recognition timestamp: the same clock as every confirmed
   * transcript entry, so an accepted word can be placed where it was signed. */
  signedAt: number;
  /** Wall-clock times (Date.now()) that drive the interface. */
  receivedAt: number;
  shownAt: number;
  /** Add ignores activation before this: on first showing, and again whenever
   * the card moves, so a tap meant for another card cannot land on it. */
  armedAt: number;
  expiresAt: number;
  /** How many times the same word from the same source was recognised while
   * this card was pending (1 = once). */
  repeats: number;
};

export type MissedNote = { gloss: string; text: string; source: PendingSuggestion["source"]; reason: "expired" | "replaced"; at: number };

export type SuggestionState = {
  /** Shown cards, oldest first (signing order). New cards are added below, so
   * cards never shift under a finger when a suggestion arrives. */
  visible: PendingSuggestion[];
  /** Arrived while every slot was taken and the person was interacting. */
  waiting: PendingSuggestion[];
  /** Words that left without a decision, so nothing disappears silently. */
  missed: MissedNote[];
  /** Pointer or keyboard focus is in the suggestions: nothing expires. */
  held: boolean;
};

export const EMPTY_SUGGESTIONS: SuggestionState = Object.freeze({ visible: [], waiting: [], missed: [], held: false }) as SuggestionState;

/** What changed, for the screen-reader announcement. */
export type SuggestionEvent =
  | { kind: "offered"; item: PendingSuggestion; replaced?: PendingSuggestion }
  | { kind: "repeated"; item: PendingSuggestion }
  | { kind: "waiting"; item: PendingSuggestion; waiting: number }
  | { kind: "expired"; items: PendingSuggestion[] };

/** Turn a worker message into a suggestion for the language on screen, or null
 * when it is a word that enters the transcript directly. */
export function suggestionFromMessage(message: WorkerSuggestion | WorkerConfirmation, language: LanguageId, now: number,
  starterOutput: "auto" | "suggest" = "suggest"): PendingSuggestion | null {
  const make = (key: string, source: PendingSuggestion["source"]): PendingSuggestion => ({ key, language, source, text: message.text, gloss: message.gloss,
    confidence: message.confidence, signedAt: message.timestamp, receivedAt: now, shownAt: now, armedAt: now + SUGGESTION_ARMING_MS,
    expiresAt: now + SUGGESTION_LIFETIME_MS, repeats: 1 });
  if (message.type === "suggested") {
    if (message.language !== language || message.source !== "model") return null;
    return make(`${message.session ?? 0}:${message.id}`, "model");
  }
  // Defence in depth: a research-model confirmation (for example from an older
  // cached worker) is demoted to a suggestion.
  if (message.source === "model" && modelWordsNeedAcceptance(language)) return make(`${message.session ?? 0}:c${message.timestamp}:${message.gloss}`, "model");
  if (message.source === "starter" && starterWordsNeedAcceptance(starterOutput)) return make(`${message.session ?? 0}:t${message.timestamp}:${message.gloss}`, "starter");
  return null;
}

const sameWord = (a: PendingSuggestion, b: PendingSuggestion) => a.gloss === b.gloss && a.source === b.source;
const note = (item: PendingSuggestion, reason: MissedNote["reason"], at: number): MissedNote => ({ gloss: item.gloss, text: item.text, source: item.source, reason, at });
const addMissed = (missed: MissedNote[], notes: MissedNote[]) => [...missed, ...notes].slice(-MAX_MISSED_NOTES);

/** Cards whose position changed are re-armed: the card now under the pointer
 * is not the one the person was about to press. */
function rearmMoved(before: readonly PendingSuggestion[], after: PendingSuggestion[], now: number) {
  return after.map((item, index) => before.findIndex(other => other.key === item.key) === index ? item
    : { ...item, armedAt: Math.max(item.armedAt, now + SUGGESTION_ARMING_MS) });
}

/** Fill free slots from the waiting list, oldest first, at the bottom. */
function promote(state: SuggestionState, now: number): SuggestionState {
  if (!state.waiting.length || state.visible.length >= MAX_PENDING_SUGGESTIONS) return state;
  const free = MAX_PENDING_SUGGESTIONS - state.visible.length;
  const shown = state.waiting.slice(0, free).map(item => ({ ...item, shownAt: now, armedAt: now + SUGGESTION_ARMING_MS,
    expiresAt: now + SUGGESTION_LIFETIME_MS }));
  return { ...state, visible: [...state.visible, ...shown], waiting: state.waiting.slice(free) };
}

export function offerSuggestion(state: SuggestionState, next: PendingSuggestion, now = next.receivedAt): { state: SuggestionState; event: SuggestionEvent } {
  // The same word again while its card is pending: count it on that card, in
  // place. The card keeps its position, key and arming, and its first
  // recognition time for ordering; it stays offered for a full lifetime again.
  const index = state.visible.findIndex(item => sameWord(item, next));
  if (index >= 0) {
    const item = { ...state.visible[index], repeats: state.visible[index].repeats + 1, expiresAt: Math.max(state.visible[index].expiresAt, now + SUGGESTION_LIFETIME_MS) };
    const visible = state.visible.map((other, i) => i === index ? item : other);
    return { state: { ...state, visible }, event: { kind: "repeated", item } };
  }
  const waitingIndex = state.waiting.findIndex(item => sameWord(item, next));
  if (waitingIndex >= 0) {
    const item = { ...state.waiting[waitingIndex], repeats: state.waiting[waitingIndex].repeats + 1 };
    return { state: { ...state, waiting: state.waiting.map((other, i) => i === waitingIndex ? item : other) }, event: { kind: "repeated", item } };
  }
  if (state.visible.length < MAX_PENDING_SUGGESTIONS) return { state: { ...state, visible: [...state.visible, next] }, event: { kind: "offered", item: next } };
  if (state.held) {
    // Never pull a card away while the person is reading or pressing it.
    const waiting = [...state.waiting, next];
    const overflow = waiting.length > MAX_WAITING_SUGGESTIONS ? waiting.slice(0, waiting.length - MAX_WAITING_SUGGESTIONS) : [];
    return { state: { ...state, waiting: waiting.slice(overflow.length), missed: addMissed(state.missed, overflow.map(item => note(item, "replaced", now))) },
      event: { kind: "waiting", item: next, waiting: waiting.length - overflow.length } };
  }
  // Every slot taken and nobody interacting: the oldest card is replaced, and
  // listed as not added, so the person knows a word went past.
  const [replaced, ...rest] = state.visible;
  const visible = rearmMoved(state.visible, [...rest, next], now);
  return { state: { ...state, visible, missed: addMissed(state.missed, [note(replaced, "replaced", now)]) }, event: { kind: "offered", item: next, replaced } };
}

/** A card answered (added or dismissed): remove it; later cards that move up are re-armed. */
export function removeSuggestion(state: SuggestionState, key: string, now: number): SuggestionState {
  if (!state.visible.some(item => item.key === key)) return state;
  return promote({ ...state, visible: rearmMoved(state.visible, state.visible.filter(item => item.key !== key), now) }, now);
}

/** Advance time: expire unanswered cards (unless held), stale waiting
 * suggestions and old notes; promote waiting suggestions into free slots. */
export function tickSuggestions(state: SuggestionState, now: number): { state: SuggestionState; expired: PendingSuggestion[] } {
  const expiredVisible = state.held ? [] : state.visible.filter(item => now > item.expiresAt);
  // A waiting suggestion that was never shown in time is reported, not shown late.
  const expiredWaiting = state.waiting.filter(item => now > item.receivedAt + SUGGESTION_LIFETIME_MS);
  const expired = [...expiredVisible, ...expiredWaiting];
  const keep = (item: PendingSuggestion) => !expired.includes(item);
  const missed = addMissed(state.missed.filter(item => now - item.at <= MISSED_NOTE_LIFETIME_MS), expired.map(item => note(item, "expired", now)));
  const visible = rearmMoved(state.visible, state.visible.filter(keep), now);
  const next = promote({ ...state, visible, waiting: state.waiting.filter(keep), missed }, now);
  const changed = expired.length || missed.length !== state.missed.length || next.visible.length !== state.visible.length;
  return { state: changed ? next : state, expired };
}

export function holdSuggestions(state: SuggestionState, held: boolean, now: number): SuggestionState {
  if (state.held === held) return state;
  if (held) return { ...state, held };
  // Leaving the suggestions: every card keeps at least a short grace period.
  const visible = state.visible.map(item => ({ ...item, expiresAt: Math.max(item.expiresAt, now + SUGGESTION_RELEASE_GRACE_MS) }));
  return promote({ ...state, held, visible }, now);
}

/** The next time the interface must re-render (arming, expiry, waiting expiry, notes). */
export function nextSuggestionDeadline(state: SuggestionState, now: number): number | null {
  const times = [
    ...state.visible.filter(item => item.armedAt > now).map(item => item.armedAt),
    ...(state.held ? [] : state.visible.map(item => item.expiresAt + 1)),
    ...state.waiting.map(item => item.receivedAt + SUGGESTION_LIFETIME_MS + 1),
    ...state.missed.map(item => item.at + MISSED_NOTE_LIFETIME_MS + 1),
  ];
  return times.length ? Math.max(now, Math.min(...times)) : null;
}

export const isArmed = (item: PendingSuggestion, now: number) => now >= item.armedAt;

export type AcceptOutcome =
  | { accepted: true; entry: TranscriptEntry }
  | { accepted: false; reason: "none" | "stale" | "too-soon" | "expired" | "language" };

/** Accept only a card that is on screen now, armed, unexpired (a held card
 * cannot expire), for the language still selected. The entry is timed by when
 * the word was signed, on the transcript's own clock. */
export function acceptSuggestion(state: SuggestionState, key: string, language: LanguageId, now: number): AcceptOutcome {
  if (!state.visible.length) return { accepted: false, reason: "none" };
  const current = state.visible.find(item => item.key === key);
  if (!current) return { accepted: false, reason: "stale" };
  if (current.language !== language) return { accepted: false, reason: "language" };
  if (!isArmed(current, now)) return { accepted: false, reason: "too-soon" };
  if (!state.held && now > current.expiresAt) return { accepted: false, reason: "expired" };
  return { accepted: true, entry: {
    id: `${current.signedAt}-${current.gloss}-accepted`.slice(0, 100),
    text: current.text, gloss: current.gloss, confidence: current.confidence, timestamp: current.signedAt,
    source: current.source, acceptedBy: "user",
  } };
}

/** Insert by recognition time among entries on the same clock. */
export function insertBySigningTime(entries: readonly TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const at = entries.findIndex(item => item.timestamp > entry.timestamp);
  return at < 0 ? [...entries, entry] : [...entries.slice(0, at), entry, ...entries.slice(at)];
}

/** One polite announcement per change, never a word presented as added. */
export function announceSuggestion(event: SuggestionEvent): string {
  const kind = (item: PendingSuggestion) => item.source === "model" ? "Experimental suggestion" : "Possible sign";
  switch (event.kind) {
    case "offered": return `${kind(event.item)}: ${event.item.text}. Not added.${event.replaced ? ` ${event.replaced.text} was not added and has been replaced.` : ""}`;
    case "repeated": return `${kind(event.item)} again: ${event.item.text}. Still not added.`;
    case "waiting": return `${kind(event.item)} waiting: ${event.waiting} more after the current suggestions.`;
    case "expired": return `Not added, timed out: ${event.items.map(item => item.text).join(", ")}.`;
  }
}
