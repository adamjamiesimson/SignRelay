// Native detector outputs in, derived development metrics out. Bundle with
// esbuild for Node. Neither raw traces nor per-frame features are exported.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { AslMotionSpotter } from "../../lib/asl-motion-spotter";
import { describeAslTemporal } from "../../lib/asl-temporal-features";
import { parseAslTemporalModel, predictAslTemporal } from "../../lib/asl-temporal-model";
import { analyzeSignMotion } from "../../lib/sign-motion";
import type { VisionFrame } from "../../lib/vision-types";

const [featuresPath, traceDir, modelPath, pythonPath, output] = process.argv.slice(2);
if (!output || !pythonPath) throw new Error("Supply features, raw extraction directory, model, Python per-trial predictions and output");
const inside = (parent: string, path: string) => {
  const subpath = relative(resolve(parent), resolve(path));
  return subpath && subpath !== ".." && !subpath.startsWith(`..${sep}`) && resolve(parent, subpath) === resolve(path);
};
if (!inside("evaluation/raw", traceDir) || !inside("evaluation/derived", output)) throw new Error("Use ignored evaluation paths");

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const modelBytes = await readFile(modelPath);
const model = parseAslTemporalModel(JSON.parse(modelBytes.toString("utf8")));
const python = JSON.parse(await readFile(pythonPath, "utf8")) as {
  trial_id: string; top: string | null; score: number | null; margin: number | null; accepted: string | null;
}[];
const pythonById = new Map(python.map(row => [row.trial_id, row]));
const data = JSON.parse(await readFile(featuresPath, "utf8")) as {
  runtime: { manifest_sha256: string; extractor_sha256: string; sample_fps: number };
  rows: { trial_id: string; recording_sha256: string; kind: string; expected: string | null }[];
};
if (data.runtime.manifest_sha256 === model.training_manifest_sha256) throw new Error("Use development features outside training");
const runtime = JSON.parse(await readFile(join(traceDir, "runtime.json"), "utf8"));
if (data.runtime.manifest_sha256 !== runtime.manifest_sha256 || data.runtime.extractor_sha256 !== runtime.extractor_sha256
  || data.runtime.sample_fps !== runtime.sample_fps) throw new Error("Extraction fingerprint differs");

const scoreTimes: number[] = [], featureTimes: number[] = [];
function prediction(frames: VisionFrame[]) {
  const start = performance.now();
  const desc = describeAslTemporal(frames);
  featureTimes.push(performance.now() - start);
  if (!desc) return null;
  const scoredAt = performance.now();
  const result = predictAslTemporal(model, desc.features);
  scoreTimes.push(performance.now() - scoredAt);
  return result;
}

type ReplayRow = {
  trial_id: string; kind: string; expected: string | null; status: "complete" | "error"; quality: unknown;
  analysis_frames: number; bounded: string[]; existing_gate: string[]; spotter: string[];
  existing_gate_ms: number[]; spotter_ms: number[]; existing_proposals: number; spotter_proposals: number;
};
const rows: ReplayRow[] = [];
let maxParityDifference = 0, parityCount = 0;
for (const trial of data.rows) {
  const expected = pythonById.get(trial.trial_id);
  const raw = JSON.parse(await readFile(join(traceDir, `${trial.recording_sha256}.json`), "utf8"));
  if (!expected || raw.trial_id !== trial.trial_id || raw.recording_sha256 !== trial.recording_sha256) throw new Error("Trial identity differs");
  const record: ReplayRow = { trial_id: trial.trial_id, kind: trial.kind, expected: trial.expected, status: raw.status,
    quality: raw.quality, analysis_frames: raw.frames?.length ?? 0,
    bounded: [], existing_gate: [], spotter: [],
    existing_gate_ms: [], spotter_ms: [], existing_proposals: 0, spotter_proposals: 0 };
  rows.push(record);
  if (raw.status !== "complete") continue;
  const frames = raw.frames as VisionFrame[];
  const bounded = prediction(frames);
  if (bounded) record.bounded = bounded.accepted ? [bounded.accepted] : [];
  const diff = bounded && expected.score !== null && expected.margin !== null
    ? Math.max(Math.abs(bounded.score - expected.score), Math.abs(bounded.margin - expected.margin)) : 0;
  if ((bounded?.top ?? null) !== expected.top || (bounded?.accepted ?? null) !== expected.accepted || diff > 1e-8) {
    throw new Error(`JavaScript/Python score mismatch: ${trial.trial_id}`);
  }
  maxParityDifference = Math.max(maxParityDifference, diff);
  if (bounded) parityCount++;

  const spotter = new AslMotionSpotter();
  let consumedUntil = -Infinity;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const sourceMs = frame.timestamp - frames[0].timestamp;
    const recent = frames.slice(Math.max(0, i - 109), i + 1).filter(point => point.timestamp > consumedUntil);
    const motion = analyzeSignMotion(recent);
    if (motion.ready) {
      record.existing_proposals++;
      consumedUntil = frame.timestamp;
      const guess = prediction(motion.sequence)?.accepted;
      if (guess) { record.existing_gate.push(guess); record.existing_gate_ms.push(sourceMs); }
    }
    const segment = spotter.push(frame);
    if (segment) {
      record.spotter_proposals++;
      const guess = prediction(segment.frames)?.accepted;
      if (guess) { record.spotter.push(guess); record.spotter_ms.push(sourceMs); }
    }
  }
}
if (rows.length !== pythonById.size) throw new Error("Python and JS results have different trial counts");
const timings = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.floor(sorted.length * 0.5)] ?? null, p95: sorted[Math.floor(sorted.length * 0.95)] ?? null };
};
const variants = ["bounded", "existing_gate", "spotter"] as const;
const results = Object.fromEntries(variants.map(variant => {
  const positives = rows.filter(row => row.kind === "target" && row.status === "complete");
  const negatives = rows.filter(row => row.kind !== "target" && row.status === "complete");
  const correct = positives.filter(row => row[variant].length === 1 && row[variant][0] === row.expected).length;
  const wrong = positives.filter(row => row[variant].length > 0).length - correct;
  return [variant, { correct, wrong, abstained: positives.length - correct - wrong, positives: positives.length,
    false_accepts: negatives.filter(row => row[variant].length > 0).length, negatives: negatives.length,
    errors: rows.filter(row => row.status !== "complete").length }];
}));
await writeFile(output, JSON.stringify({ model_sha256: sha256(modelBytes), architecture: model.architecture, runtime, results,
  parity: { clips_checked: parityCount, max_absolute_score_error: maxParityDifference },
  cpu_ms: { feature: timings(featureTimes), classifier: timings(scoreTimes) },
  source_time_ms: { existing_gate: timings(rows.flatMap(row => row.existing_gate_ms)), spotter: timings(rows.flatMap(row => row.spotter_ms)) },
  note: "The existing motion gate and the alternative spotter feed the same research weights. Source offsets are from video start, not annotated sign end.",
  trials: rows,
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(results));
