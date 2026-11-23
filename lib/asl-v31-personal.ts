import type { CalibrationTemplate } from "./vision-types";

/** Minimum cosine between a live sign and a taught example before it is treated as that sign.
 * Measured on one live signer's captures: same-sign repeats 0.93, every different sign <= 0.27. */
export const PERSONAL_EMBEDDING_MIN_SIMILARITY = 0.75;
/** The best taught sign must beat the runner-up by this much, so two similar taught signs cannot
 * both claim a gesture. */
export const PERSONAL_EMBEDDING_MIN_MARGIN = 0.15;

export type PersonalEmbeddingMatch = { template: CalibrationTemplate; similarity: number };

/** Unit-length check, so a corrupt or missing stored embedding cannot score nonsense. */
function usable(values: number[] | undefined) {
  return Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/**
 * Match a live V3.1 embedding against the signs this signer taught. Returns null when nothing is
 * close enough or two taught signs are too similar to separate; the caller then keeps the model's
 * own answer.
 */
export function matchPersonalEmbedding(
  embedding: ArrayLike<number> | null | undefined,
  templates: CalibrationTemplate[],
): PersonalEmbeddingMatch | null {
  if (!embedding?.length) return null;
  const scored = templates
    .filter(template => usable(template.embedding))
    .map(template => ({ template, similarity: cosineSimilarity(embedding, template.embedding!) }))
    .sort((a, b) => b.similarity - a.similarity);
  const [best, runnerUp] = scored;
  if (!best || best.similarity < PERSONAL_EMBEDDING_MIN_SIMILARITY) return null;
  // A second take of the same word is a confirmation, not an ambiguity.
  if (runnerUp && runnerUp.template.gloss !== best.template.gloss
    && best.similarity - runnerUp.similarity < PERSONAL_EMBEDDING_MIN_MARGIN) return null;
  return best;
}
