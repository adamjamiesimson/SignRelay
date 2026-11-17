import { ASL_TEMPORAL_FEATURES, ASL_TEMPORAL_WIDTH } from "./asl-temporal-features";

const UNKNOWN = "[UNKNOWN]";
const LABELS = new Set(["HELLO", "THANK YOU", "PLEASE", "YES", "NO", UNKNOWN]);

export type AslTemporalModel = {
  schema: typeof ASL_TEMPORAL_FEATURES;
  architecture: "centroid" | "ridge";
  labels: string[];
  mean: number[];
  scale: number[];
  weights: number[][];
  bias: number[];
  threshold: { score: number; margin: number };
  training_manifest_sha256: string;
};

function numbers(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(item => typeof item === "number" && Number.isFinite(item));
}

export function parseAslTemporalModel(value: unknown): AslTemporalModel {
  if (!value || typeof value !== "object") throw new Error("Invalid ASL temporal model");
  const model = value as Partial<AslTemporalModel>;
  const size = LABELS.size;
  if (model.schema !== ASL_TEMPORAL_FEATURES || (model.architecture !== "centroid" && model.architecture !== "ridge")
    || !Array.isArray(model.labels) || model.labels.length !== size || new Set(model.labels).size !== size
    || model.labels.some(label => !LABELS.has(label))
    || !numbers(model.mean, ASL_TEMPORAL_WIDTH) || !numbers(model.scale, ASL_TEMPORAL_WIDTH)
    || model.scale.some(scale => scale < 0.20)
    || !Array.isArray(model.weights) || model.weights.length !== size
    || !model.weights.every(row => numbers(row, ASL_TEMPORAL_WIDTH)) || !numbers(model.bias, size)
    || !model.threshold || !Number.isFinite(model.threshold.score) || !Number.isFinite(model.threshold.margin)
    || model.threshold.margin < 0 || !/^[a-f0-9]{64}$/.test(model.training_manifest_sha256 ?? "")) {
    throw new Error("Incompatible ASL temporal model schema, labels or dimensions");
  }
  return model as AslTemporalModel;
}

/** Scores are uncalibrated discriminant values. The caller can show accepted
 * research labels for review. This API never issues a transcript entry. */
export function predictAslTemporal(model: AslTemporalModel, features: number[]) {
  if (!numbers(features, ASL_TEMPORAL_WIDTH)) throw new Error("Invalid ASL temporal features");
  const x = features.map((value, i) => (value - model.mean[i]) / model.scale[i]);
  const lengthSquared = model.architecture === "centroid" ? x.reduce((sum, value) => sum + value ** 2, 0) : 0;
  const ranked = model.weights.map((weights, i) => {
    const linear = weights.reduce((sum, weight, j) => sum + weight * x[j], model.bias[i]);
    return { label: model.labels[i], score: model.architecture === "centroid" ? (linear - lengthSquared) / x.length : linear };
  }).sort((a, b) => b.score - a.score);
  const [first, second] = ranked;
  const margin = first.score - second.score;
  const accepted = first.label !== UNKNOWN && first.score >= model.threshold.score && margin >= model.threshold.margin;
  return { top: first.label, score: first.score, margin, accepted: accepted ? first.label : null };
}
