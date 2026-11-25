/**
 * Which languages have a next-word model, and the corpus behind each.
 *
 * A next-word model predicts *words*, so it is only honest where the transcript's words are the ones
 * the corpus was written in. The shipped corpus is ASL gloss — English words in ASL order — so it is
 * offered for ASL and withheld everywhere else: suggesting English glosses after a Russian, Bangla or
 * Spanish transcript would be a fluent answer to the wrong question. The predictor code itself is
 * language-agnostic, so adding a language is a matter of writing its gloss sequences here.
 */
import type { LanguageId } from "./model-adapters";
import { buildLanguageModel, type LanguageModel } from "./asl-next-word";
import { ASL_SENTENCE_PATTERNS } from "./asl-sentence-patterns";

const CORPORA: Partial<Record<LanguageId, readonly string[]>> = {
  asl: ASL_SENTENCE_PATTERNS,
};

const models = new Map<LanguageId, LanguageModel>();

export function nextWordModel(language: LanguageId): LanguageModel | null {
  const corpus = CORPORA[language];
  if (!corpus) return null;
  const existing = models.get(language);
  if (existing) return existing;
  const model = buildLanguageModel(corpus);
  models.set(language, model);
  return model;
}

/** Languages that can offer predictions today, for the interface to describe itself accurately. */
export const NEXT_WORD_LANGUAGES = Object.keys(CORPORA) as LanguageId[];
