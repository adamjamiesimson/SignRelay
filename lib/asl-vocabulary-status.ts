import STATUS from "../public/models/asl2000-tgcn/vocabulary-status.json";

/**
 * Per-sign ASL availability, generated from committed evaluation reports by
 * training/asl2000_vocabulary_status.py. An installed label is not a claim
 * that the sign is recognised.
 */
export type AslSignTier = "validated" | "experimental" | "installed";

type ExperimentalEvidence = {
  gloss: string;
  endToEnd: { clips: number; correct: number; wrong: number; signers: number } | null;
  isolated: { clips: number; acceptedCorrect: number; signers: number } | null;
  falseLabelRate: number | null;
};

const status = STATUS as {
  source: string;
  counts: { installed: number; evaluatedWords: number; experimental: number; validated: number; endToEndClips: number; medianModelMs: number | null };
  validated: string[];
  experimental: ExperimentalEvidence[];
};

const validated = new Set(status.validated);
const experimental = new Map(status.experimental.map(entry => [entry.gloss, entry]));

export const ASL_VOCABULARY_COUNTS = {
  installed: status.counts.installed,
  evaluated: status.counts.evaluatedWords,
  experimental: status.counts.experimental,
  validated: status.counts.validated,
};

export const ASL_VOCABULARY_SOURCE = status.source;

export function aslSignTier(gloss: string): AslSignTier {
  const key = gloss.trim().toUpperCase();
  return validated.has(key) ? "validated" : experimental.has(key) ? "experimental" : "installed";
}

export function aslSignEvidence(gloss: string) {
  return experimental.get(gloss.trim().toUpperCase()) ?? null;
}

/** Experimentally observed words, most end-to-end evidence first. */
export function experimentalAslSigns() {
  return [...experimental.values()].sort((a, b) =>
    (b.endToEnd?.correct ?? 0) - (a.endToEnd?.correct ?? 0)
    || (b.isolated?.acceptedCorrect ?? 0) - (a.isolated?.acceptedCorrect ?? 0)
    || a.gloss.localeCompare(b.gloss));
}

export const ASL_TIER_DESCRIPTIONS: Record<AslSignTier | "starter" | "personal", string> = {
  validated: "Passed SignRelay's multi-signer end-to-end check: correct on most clips from at least three unseen signers, rarely produced for other signs, usable latency.",
  experimental: "Recognised correctly at least once on a clip from an unseen signer. Not reliable: wrong words and misses are still common.",
  installed: "A label the research model can output. Not yet observed working in SignRelay; treat any result as a guess.",
  starter: "One of six demo words handled by simple movement rules, separate from the research model.",
  personal: "A sign you taught on this device; matched only against your own examples.",
};
