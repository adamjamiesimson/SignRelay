// Reproducible, signer-disjoint experiment framework for replacing the ASL
// starter rules (docs/research/temporal-recognizer/). Every predictor sees the
// same folds; the test signer is never in training; exposed recordings (any
// clip already looked at in an earlier evaluation) are reported separately and
// never presented as untouched evaluation. Outputs aggregate counts only.
import type { VisionFrame } from "./vision-types";

export type Exposure = "exposed" | "untouched";
export type Example = {
  id: string;
  /** Expected target gloss; null for an everyday movement, unsupported or confusable sign (all "other"). */
  gloss: string | null;
  /** For reporting: target sign; confusable or other non-target sign; sign outside the vocabulary; everyday movement. */
  kind: "target" | "confusable" | "other-sign" | "unsupported" | "everyday";
  signer: string;
  source: string;
  exposure: Exposure;
  frames: VisionFrame[];
};
export type Prediction = { label: string | null; score?: number };
export type Predictor = {
  name: string;
  /** Called once per fold with that fold's training signers' examples only. */
  fit?: (train: Example[]) => void;
  predict: (frames: VisionFrame[]) => Prediction;
};

function fnv(text: string) {
  let h = 0x811c9dc5;
  for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export const fingerprint = (value: unknown) => fnv(JSON.stringify(value));

/** Leave-one-signer-out, or (more signers than maxFolds) a deterministic
 * grouping of signers into maxFolds folds by a hash of the signer id. */
export function signerFolds(examples: Example[], maxFolds = 10): string[][] {
  const signers = [...new Set(examples.map(e => e.signer))].sort();
  if (signers.length <= maxFolds) return signers.map(s => [s]);
  const folds: string[][] = Array.from({ length: maxFolds }, () => []);
  for (const s of signers) folds[parseInt(fnv(`fold:${s}`), 16) % maxFolds].push(s);
  return folds.filter(f => f.length);
}

type Counts = { support: number; correct: number; wrong: number; abstained: number };
export type PredictorReport = {
  targets: Counts & { byGloss: Record<string, Counts & { predicted: number; precision: number | null; recall: number | null }> };
  other: { support: number; falseAccept: number; byKind: Record<string, { support: number; falseAccept: number }>; falseAcceptAs: Record<string, number> };
  /** Precision among accepted outputs when only the most confident fraction is accepted. */
  riskCoverage: { coverage: number; accepted: number; precision: number | null }[] | null;
};

function evaluateRows(rows: { example: Example; prediction: Prediction }[]): PredictorReport {
  const targets = rows.filter(r => r.example.gloss !== null), other = rows.filter(r => r.example.gloss === null);
  const byGloss: PredictorReport["targets"]["byGloss"] = {};
  const glosses = new Set([...targets.map(r => r.example.gloss!), ...rows.map(r => r.prediction.label).filter((l): l is string => !!l)]);
  for (const g of glosses) {
    const support = targets.filter(r => r.example.gloss === g);
    const predicted = rows.filter(r => r.prediction.label === g).length;
    const correct = support.filter(r => r.prediction.label === g).length;
    byGloss[g] = { support: support.length, correct, wrong: support.filter(r => r.prediction.label && r.prediction.label !== g).length,
      abstained: support.filter(r => !r.prediction.label).length, predicted,
      precision: predicted ? correct / predicted : null, recall: support.length ? correct / support.length : null };
  }
  const byKind: Record<string, { support: number; falseAccept: number }> = {}, falseAcceptAs: Record<string, number> = {};
  for (const r of other) {
    const k = (byKind[r.example.kind] ??= { support: 0, falseAccept: 0 });
    k.support++;
    if (r.prediction.label) { k.falseAccept++; falseAcceptAs[r.prediction.label] = (falseAcceptAs[r.prediction.label] ?? 0) + 1; }
  }
  const scored = rows.every(r => r.prediction.score !== undefined);
  let riskCoverage: PredictorReport["riskCoverage"] = null;
  if (scored) {
    const accepted = rows.filter(r => r.prediction.label).sort((a, b) => (b.prediction.score ?? 0) - (a.prediction.score ?? 0));
    riskCoverage = [0.25, 0.5, 0.75, 1].map(coverage => {
      const top = accepted.slice(0, Math.ceil(accepted.length * coverage));
      const right = top.filter(r => r.prediction.label === r.example.gloss).length;
      return { coverage, accepted: top.length, precision: top.length ? right / top.length : null };
    });
  }
  return {
    targets: { support: targets.length, correct: targets.filter(r => r.prediction.label === r.example.gloss).length,
      wrong: targets.filter(r => r.prediction.label && r.prediction.label !== r.example.gloss).length,
      abstained: targets.filter(r => !r.prediction.label).length, byGloss },
    other: { support: other.length, falseAccept: other.filter(r => r.prediction.label).length, byKind, falseAcceptAs },
    riskCoverage,
  };
}

export type ExperimentReport = {
  framework: "signrelay-temporal-experiment/1";
  dataset: { examples: number; signers: number; manifest: string; byKind: Record<string, number>; byExposure: Record<Exposure, number>; targetGlosses: string[] };
  folds: { count: number; scheme: "leave-one-signer-out" | "grouped-signer-folds"; signersPerFold: number[] };
  predictors: Record<string, { all: PredictorReport; untouchedOnly: PredictorReport | null }>;
  caveats: string[];
};

/** Run every predictor on the same signer-disjoint folds. */
export function runExperiment(examples: Example[], predictors: Predictor[], { maxFolds = 10, note = [] as string[] } = {}): ExperimentReport {
  const folds = signerFolds(examples, maxFolds);
  const rows: Record<string, { example: Example; prediction: Prediction }[]> = Object.fromEntries(predictors.map(p => [p.name, []]));
  for (const fold of folds) {
    const test = examples.filter(e => fold.includes(e.signer)), train = examples.filter(e => !fold.includes(e.signer));
    if (train.some(e => fold.includes(e.signer))) throw new Error("signer leakage");
    for (const predictor of predictors) {
      predictor.fit?.(train);
      for (const example of test) rows[predictor.name].push({ example, prediction: predictor.predict(example.frames) });
    }
  }
  const untouched = examples.filter(e => e.exposure === "untouched").length;
  const caveats = [...note];
  if (!untouched) caveats.push("Every example was exposed by an earlier evaluation: development estimate only, not evidence of accuracy.");
  const signers = new Set(examples.map(e => e.signer)).size;
  if (signers < 5) caveats.push(`Only ${signers} signers: fold results are highly variable.`);
  const perGloss = examples.filter(e => e.gloss).reduce((m, e) => m.set(e.gloss!, (m.get(e.gloss!) ?? 0) + 1), new Map<string, number>());
  if ([...perGloss.values()].some(n => n < 10)) caveats.push("Fewer than 10 examples for some target signs: per-sign rates are not meaningful.");
  return {
    framework: "signrelay-temporal-experiment/1",
    dataset: {
      examples: examples.length, signers, manifest: fingerprint(examples.map(e => [e.id, e.gloss, e.kind, e.signer, e.exposure]).sort()),
      byKind: examples.reduce((m, e) => ({ ...m, [e.kind]: (m[e.kind] ?? 0) + 1 }), {} as Record<string, number>),
      byExposure: { exposed: examples.length - untouched, untouched }, targetGlosses: [...perGloss.keys()].sort(),
    },
    folds: { count: folds.length, scheme: folds.every(f => f.length === 1) ? "leave-one-signer-out" : "grouped-signer-folds", signersPerFold: folds.map(f => f.length) },
    predictors: Object.fromEntries(predictors.map(p => [p.name, {
      all: evaluateRows(rows[p.name]),
      untouchedOnly: untouched ? evaluateRows(rows[p.name].filter(r => r.example.exposure === "untouched")) : null,
    }])),
    caveats,
  };
}
