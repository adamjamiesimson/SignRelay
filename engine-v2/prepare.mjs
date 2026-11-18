import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { aslVocabulary, validateManifest, fingerprint, signerKey } from "../scripts/evaluation-manifest.mjs";
import { loadFrozenCohorts } from "../scripts/evaluation-cohorts.mjs";
import { CONTRACT, LABELS, observation, tensor } from "./core.mjs";

const [sourceArgument, outputArgument, pixelsArgument] = process.argv.slice(2);
if (!sourceArgument || !outputArgument) throw new Error("Supply the Rebirth checkout and V2 output directory");
const source = resolve(sourceArgument);
const output = resolve(outputArgument);
if (!output.startsWith(resolve("evaluation/derived") + (process.platform === "win32" ? "\\" : "/"))) {
  throw new Error("Write internal model inputs under evaluation/derived");
}
const dataset = join(source, "evaluation/derived/popsign-rebirth-v1");
const vocabulary = aslVocabulary();
const { cohorts } = await loadFrozenCohorts(undefined, vocabulary);
const sealedSigners = new Set(cohorts.filter(cohort => cohort.role === "sealed-holdout")
  .flatMap(cohort => cohort.rows.map(row => signerKey(row.participant_id))));
const folds = await Promise.all(["train", "val"].map(async split => {
  const bytes = await readFile(join(dataset, split + ".json"));
  const rows = JSON.parse(bytes);
  const traceDir = join(source, "evaluation/raw/rebirth-" + split + "20");
  const runtime = JSON.parse(await readFile(join(traceDir, "runtime.json")));
  if (runtime.manifest_sha256 !== fingerprint(bytes) || rows.some(row =>
    row.evaluation_split !== "development" || sealedSigners.has(signerKey(row.participant_id)))) {
    throw new Error("Manifest fingerprint or holdout restriction failed");
  }
  return { split, rows, traceDir, runtime };
}));
validateManifest(folds[0].rows, { vocabulary, related: [folds[1].rows, ...cohorts.map(cohort => cohort.rows)] });
validateManifest(folds[1].rows, { vocabulary, related: [folds[0].rows, ...cohorts.map(cohort => cohort.rows)] });
for (const key of [row => signerKey(row.participant_id), row => row.recording_group, row => row.recording_sha256]) {
  const training = new Set(folds[0].rows.map(key));
  if (folds[1].rows.some(row => training.has(key(row)))) throw new Error("Training and validation overlap");
}
await mkdir(output, { recursive: true });
const intake = [];
for (const fold of folds) {
  const rows = [];
  let tracker;
  for (const item of fold.rows) {
    const sha = item.recording_sha256;
    const trace = JSON.parse(await readFile(join(fold.traceDir, sha + ".json")));
    if (trace.trial_id !== item.trial_id || trace.recording_sha256 !== sha || trace.status !== "complete") {
      throw new Error("Missing complete development trace");
    }
    const pixelPath = pixelsArgument && join(resolve(pixelsArgument), sha + ".json");
    const data = pixelPath ? JSON.parse(await readFile(pixelPath)) : null;
    if (data && (data.sha256 !== sha || data.frames.length !== trace.frames.length)) throw new Error("RGB trace mismatch");
    const file = resolve(source, item.file);
    if (!file.startsWith(resolve(source, "evaluation/videos") + (process.platform === "win32" ? "\\" : "/"))) {
      throw new Error("Unexpected video path");
    }
    // The metadata reader verifies the original media hashes before decoding.
    intake.push({ file, trace: join(fold.traceDir, sha + ".json"), sha256: sha });
    if (!data) continue;
    const signature = JSON.stringify(data.tracker ?? null);
    tracker ??= signature;
    if (signature !== tracker) throw new Error("Mixed detector versions in the same split");
    const samples = trace.frames.map((frame, i) => {
      const { rgb, t, frame: tracked } = data.frames[i];
      if (t !== frame.timestamp || (data.tracker && tracked?.timestamp !== frame.timestamp)
        || (rgb && (rgb.length !== 432 || !rgb.every(Number.isFinite)))) {
        throw new Error("RGB samples do not align with landmark timestamps");
      }
      return observation({ ...(tracked ?? frame), rgb }, data.width / data.height);
    });
    rows.push({ sha256: sha, signer: signerKey(item.participant_id), kind: item.role_in_candidate,
      expected: item.expected_gloss, label: LABELS.includes(item.expected_gloss) ? item.expected_gloss : "OTHER", samples,
      inputs: Object.fromEntries(["landmark", "rgb", "hybrid"].map(mode => {
        const value = tensor(samples, mode);
        return [mode, value && Array.from(value)];
      })),
    });
  }
  if (pixelsArgument) await writeFile(join(output, fold.split + ".json"), JSON.stringify({ contract: CONTRACT,
    upstream: { ...fold.runtime, independentDetector: JSON.parse(tracker) }, rows }));
}
await writeFile(join(output, "intake.json"), JSON.stringify(intake));
console.log(JSON.stringify({ recordings: intake.length, exportedTensors: Boolean(pixelsArgument) }));
