import type { CalibrationTemplate } from "./vision-types";

/** Minimum cosine between a live sign and a taught example before it is treated as that sign.
 * Measured on one live signer's captures: same-sign repeats 0.93, every different sign <= 0.27. */
export const PERSONAL_EMBEDDING_MIN_SIMILARITY = 0.75;
/** The best taught sign must beat the runner-up by this much, so two similar taught signs cannot
 * both claim a gesture. */
export const PERSONAL_EMBEDDING_MIN_MARGIN = 0.15;

export type PersonalEmbeddingMatch = { template: CalibrationTemplate; similarity: number };

/** How a newly recorded example compares with what is already taught. A dictionary of forty words is
 * only as good as its worst take, and two signs that overlap in embedding space can never be told
 * apart at match time, so both problems are reported while the signer is still in front of the camera. */
export type EnrolmentVerdict = "first" | "consistent" | "differs" | "collides";
export type EnrolmentReport = {
  verdict: EnrolmentVerdict;
  /** Best similarity to another take of the same word, null when this is the first one. */
  sameBest: number | null;
  /** Strongest similarity to a different taught word, and which one, when it is a collision risk. */
  conflict: { gloss: string; similarity: number } | null;
};

export const ENROLMENT_MIN_SELF_SIMILARITY = 0.6;

export function enrolmentReport(
  embedding: ArrayLike<number> | null | undefined,
  gloss: string,
  templates: CalibrationTemplate[],
): EnrolmentReport {
  if (!embedding?.length) return { verdict: "first", sameBest: null, conflict: null };
  const taught = templates.filter(template => usable(template.embedding));
  let sameBest: number | null = null;
  let conflict: { gloss: string; similarity: number } | null = null;
  for (const template of taught) {
    const similarity = cosineSimilarity(embedding, template.embedding!);
    if (template.gloss === gloss) sameBest = Math.max(sameBest ?? -1, similarity);
    else if (!conflict || similarity > conflict.similarity) conflict = { gloss: template.gloss, similarity };
  }
  // A different word that would pass the matcher's own bar is unseparable: the margin rule refuses it,
  // so the sign would silently never fire.
  if (conflict && conflict.similarity >= PERSONAL_EMBEDDING_MIN_SIMILARITY) return { verdict: "collides", sameBest, conflict };
  if (sameBest !== null && sameBest < ENROLMENT_MIN_SELF_SIMILARITY) return { verdict: "differs", sameBest, conflict };
  return { verdict: sameBest === null ? "first" : "consistent", sameBest, conflict };
}

/** Unit-length check, so a corrupt or missing stored embedding cannot score nonsense. */
function usable(values: number[] | undefined) {
  return Array.isArray(values) && values.length > 0 && values.every(Number.isFinite);
}

/** Mean embedding per taught word, unit length, so several takes of one sign pool together. */
function glossCentroids(templates: CalibrationTemplate[]) {
  const sums = new Map<string, number[]>();
  for (const template of templates) {
    const sum = sums.get(template.gloss) ?? new Array(template.embedding!.length).fill(0);
    for (let i = 0; i < sum.length; i++) sum[i] += template.embedding![i];
    sums.set(template.gloss, sum);
  }
  const centroids = new Map<string, number[]>();
  for (const [gloss, sum] of sums) {
    const length = Math.hypot(...sum);
    centroids.set(gloss, length ? sum.map(value => value / length) : sum);
  }
  return centroids;
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
  const taught = templates.filter(template => usable(template.embedding));
  const centroid = glossCentroids(taught);
  const scored = taught
    .map(template => {
      const individual = cosineSimilarity(embedding, template.embedding!);
      const pooled = centroid.get(template.gloss);
      // Several takes of one word are averaged, so a single loose take cannot outvote a good one, and
      // the better of the individual take and the pooled average is used.
      return { template, similarity: Math.max(individual, pooled ? cosineSimilarity(embedding, pooled) : -Infinity) };
    })
    .sort((a, b) => b.similarity - a.similarity);
  const [best, runnerUp] = scored;
  if (!best || best.similarity < PERSONAL_EMBEDDING_MIN_SIMILARITY) return null;
  // A second take of the same word is a confirmation, not an ambiguity.
  if (runnerUp && runnerUp.template.gloss !== best.template.gloss
    && best.similarity - runnerUp.similarity < PERSONAL_EMBEDDING_MIN_MARGIN) return null;
  return best;
}
