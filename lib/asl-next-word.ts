/**
 * Next-word prediction for the transcript, in the spirit of a phone keyboard.
 *
 * Two jobs:
 *  1. Offer the words that usually follow what has already been signed, so a whole phrase can be
 *     assembled without spelling everything out.
 *  2. Break a tie inside the recogniser. When its top two candidates are within
 *     `AMBIGUITY_MARGIN` the detector is guessing, but the sentence around the sign often is not:
 *     "ME WANT ___" is far more likely to end in WATER than in HIGH.
 *
 * The model is a small interpolated trigram over ASL gloss sequences (subject/comment order, no
 * English function words). It is deliberately tiny, deterministic and dependency-free: it ships with
 * the app, runs on the main thread in microseconds, and cannot be wrong in a way that matters,
 * because a prediction is only ever a suggestion the signer accepts or ignores.
 */
export type LanguageModel = {
  unigram: Map<string, number>;
  bigram: Map<string, Map<string, number>>;
  trigram: Map<string, Map<string, number>>;
  total: number;
};

export type NextWordPrediction = {
  gloss: string;
  /** Interpolated probability within the candidate set, 0-1. */
  probability: number;
  /** Which context level carried the prediction, for transparency in the panel. */
  source: "trigram" | "bigram" | "unigram";
  text: string;
};

export type Alternative = { gloss: string; probability: number };
export type ResolvedAlternative = Alternative & { reason?: "context" };

/** How close two candidates must be before the sentence is allowed to decide between them. */
export const AMBIGUITY_MARGIN = 0.15;
/** The same margin, for the recogniser deciding whether a runner-up is worth carrying out of the worker. */
export const ASL_SUGGESTION_AMBIGUITY_MARGIN = AMBIGUITY_MARGIN;
/** How much more the sentence must like the runner-up before it overrules the detector's ranking. */
export const CONTEXT_PREFERENCE_RATIO = 1.5;

const BOS = "<s>";
const ADD_K = 0.05;
const TRIGRAM_WEIGHT = 0.6;
const BIGRAM_WEIGHT = 0.3;
const UNIGRAM_WEIGHT = 0.1;

export function normaliseGloss(word: string): string {
  return word.trim().toUpperCase().replace(/[^A-Z0-9'-]/g, "");
}

export function displayText(gloss: string): string {
  return gloss.replace(/-/g, " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function bumpNested(map: Map<string, Map<string, number>>, context: string, next: string): void {
  const row = map.get(context) ?? new Map<string, number>();
  bump(row, next);
  map.set(context, row);
}

export function buildLanguageModel(sentences: readonly (string | readonly string[])[]): LanguageModel {
  const model: LanguageModel = { unigram: new Map(), bigram: new Map(), trigram: new Map(), total: 0 };
  for (const sentence of sentences) {
    const tokens = (typeof sentence === "string" ? sentence.split(/\s+/) : [...sentence])
      .map(normaliseGloss).filter(Boolean);
    if (!tokens.length) continue;
    const padded = [BOS, BOS, ...tokens];
    for (let index = 2; index < padded.length; index++) {
      const word = padded[index];
      bump(model.unigram, word);
      model.total++;
      bumpNested(model.bigram, padded[index - 1], word);
      bumpNested(model.trigram, `${padded[index - 2]} ${padded[index - 1]}`, word);
    }
  }
  return model;
}

function sum(row: Map<string, number> | undefined): number {
  let total = 0;
  if (row) for (const value of row.values()) total += value;
  return total;
}

/** Interpolated probability of `word` in the position after `transcript`. */
export function probabilityOfNext(model: LanguageModel, transcript: readonly string[], word: string): number {
  const tokens = transcript.map(normaliseGloss).filter(Boolean);
  const target = normaliseGloss(word);
  const last = tokens.at(-1) ?? BOS;
  const previous = tokens.at(-2) ?? BOS;
  const trigramRow = model.trigram.get(`${previous} ${last}`);
  const bigramRow = model.bigram.get(last);
  const trigramTotal = sum(trigramRow);
  const bigramTotal = sum(bigramRow);
  const trigramValue = trigramTotal ? ((trigramRow?.get(target) ?? 0) + ADD_K) / (trigramTotal + ADD_K * model.unigram.size) : 0;
  const bigramValue = bigramTotal ? ((bigramRow?.get(target) ?? 0) + ADD_K) / (bigramTotal + ADD_K * model.unigram.size) : 0;
  const unigramValue = model.total ? ((model.unigram.get(target) ?? 0) + ADD_K) / (model.total + ADD_K * model.unigram.size) : 0;
  return TRIGRAM_WEIGHT * trigramValue + BIGRAM_WEIGHT * bigramValue + UNIGRAM_WEIGHT * unigramValue;
}

/**
 * The words most likely to come next. With a `vocabulary` only signable words are offered, so the
 * row never suggests something the signer cannot produce.
 */
export function predictNext(model: LanguageModel, transcript: readonly string[],
  options: { limit?: number; vocabulary?: ReadonlySet<string> } = {}): NextWordPrediction[] {
  const limit = options.limit ?? 3;
  const candidates = new Set<string>([...model.unigram.keys()]);
  const allowed = options.vocabulary ? new Set([...options.vocabulary].map(normaliseGloss)) : undefined;
  const tokens = transcript.map(normaliseGloss).filter(Boolean);
  const last = tokens.at(-1) ?? BOS;
  const previous = tokens.at(-2) ?? BOS;
  const trigramRow = model.trigram.get(`${previous} ${last}`);
  const bigramRow = model.bigram.get(last);
  const scored: NextWordPrediction[] = [];
  for (const gloss of candidates) {
    if (gloss === BOS || (allowed && !allowed.has(gloss))) continue;
    const probability = probabilityOfNext(model, transcript, gloss);
    if (probability <= 0) continue;
    const source = trigramRow?.has(gloss) ? "trigram" : bigramRow?.has(gloss) ? "bigram" : "unigram";
    scored.push({ gloss, probability, source, text: displayText(gloss) });
  }
  scored.sort((a, b) => b.probability - a.probability || a.gloss.localeCompare(b.gloss));
  const top = scored.slice(0, limit);
  // Report probabilities within the offered set, so "0.42" means "42% of the chips I would offer".
  const normaliser = top.reduce((total, item) => total + item.probability, 0) || 1;
  return top.map(item => ({ ...item, probability: item.probability / normaliser }));
}

/**
 * Reorder the recogniser's candidates when its top two are close and the sentence clearly prefers
 * one of them. Never invents a candidate: it only reorders what the detector already proposed.
 */
export function resolveAmbiguity(model: LanguageModel, transcript: readonly string[],
  alternatives: readonly Alternative[], margin = AMBIGUITY_MARGIN): ResolvedAlternative[] {
  const ranked = [...alternatives].map(item => ({ gloss: item.gloss, probability: item.probability }));
  if (ranked.length < 2) return ranked;
  if (ranked[0].probability - ranked[1].probability > margin) return ranked;
  const [first, second] = ranked;
  // Only overrule the detector when the model has actually seen the runner-up; otherwise it has no opinion.
  if (!model.unigram.has(normaliseGloss(second.gloss))) return ranked;
  const firstScore = probabilityOfNext(model, transcript, first.gloss);
  const secondScore = probabilityOfNext(model, transcript, second.gloss);
  if (!(secondScore >= CONTEXT_PREFERENCE_RATIO * firstScore) || secondScore <= 0) return ranked;
  return [{ ...second, reason: "context" }, first, ...ranked.slice(2)];
}
