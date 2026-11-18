import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseModel, predict, Stream, tensor } from "./core.mjs";

const [dataFile, weightsFile, output] = process.argv.slice(2);
if (!output) throw new Error("Supply development tensors, trained model and output file");
const { rows, upstream } = JSON.parse(await readFile(dataFile));
const model = parseModel(JSON.parse(await readFile(weightsFile)));
if (upstream.manifest_sha256 === model.trainingManifest) throw new Error("Use data outside training");
const intervals = [50, 67, 100, 167];
const policies = [
  { name: "cadence-adaptive", frames: null, confirmations: 2 },
  { name: "overlap", frames: [600, 1000, 1600], confirmations: 2 },
  { name: "single-1000ms", frames: [1000], confirmations: 2 },
  { name: "overlap-single-decision", frames: [600, 1000, 1600], confirmations: 1 },
];

function timedSamples(samples, interval) {
  if (!samples.length || interval === 50) return samples;
  let next = samples[0].t;
  return samples.filter(sample => {
    if (sample.t + 0.1 < next) return false;
    while (next <= sample.t + 0.1) next += interval;
    return true;
  });
}

function summarize(records) {
  const summary = { targets: 0, negatives: 0, correct: 0, wrong: 0, abstained: 0, falseAccepts: 0, duplicates: 0 };
  const confusion = {};
  const bySigner = {};
  for (const { row, labels } of records) {
    const expected = row.expected;
    const signer = bySigner[row.signer] ??= { targets: 0, correct: 0, unsupported: 0, falseAccepts: 0 };
    const predictions = confusion[expected] ??= {};
    const key = labels.join(", ") || "ABSTAIN";
    predictions[key] = (predictions[key] ?? 0) + 1;
    if (row.kind !== "target") {
      summary.negatives++;
      signer.unsupported++;
      summary.falseAccepts += Number(labels.length > 0);
      signer.falseAccepts += Number(labels.length > 0);
      continue;
    }
    summary.targets++;
    signer.targets++;
    if (!labels.length) summary.abstained++;
    else if (labels.length === 1 && labels[0] === expected) {
      summary.correct++;
      signer.correct++;
    } else {
      summary.wrong++;
      if (labels.length > 1) summary.duplicates++;
    }
  }
  const accepted = summary.correct + summary.wrong + summary.falseAccepts;
  return { ...summary, precision: accepted ? summary.correct / accepted : null,
    recall: summary.correct / summary.targets, confusion, signerCounts: Object.values(bySigner) };
}

const profile = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? null,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? null };
};
const results = intervals.map(interval => {
  const data = rows.map(row => ({ row, samples: timedSamples(row.samples, interval) }));
  const timing = [];
  const bounded = summarize(data.map(({ row, samples }) => {
    const started = performance.now();
    const label = predict(model, tensor(samples, model.mode)).label;
    timing.push(performance.now() - started);
    return { row, labels: label ? [label] : [] };
  }));
  return { interval, bounded, boundedCpuMs: profile(timing), frames: data.reduce((n, record) => n + record.samples.length, 0),
    withHands: data.reduce((n, record) => n + record.samples.filter(sample => sample.h).length, 0),
    automatic: Object.fromEntries(policies.map(policy => {
      const latency = [];
      const trials = data.map(({ row, samples }) => {
        const engine = new Stream(model, { windows: policy.frames, confirmations: policy.confirmations });
        const labels = [];
        for (const sample of samples) {
          const result = engine.push(sample);
          if (result?.event) {
            labels.push(result.event);
            latency.push(sample.t - samples[0].t);
          }
        }
        return { row, labels };
      });
      return [policy.name, { ...summarize(trials), sourceOffsetMs: profile(latency) }];
    })),
  };
});
await writeFile(output, JSON.stringify({ version: model.version, source: upstream, results }, null, 2));
console.log(JSON.stringify(results.map(({ interval, bounded, automatic }) => ({ interval,
  bounded: [bounded.correct, bounded.wrong, bounded.falseAccepts],
  automatic: Object.fromEntries(Object.entries(automatic).map(([key, value]) =>
    [key, [value.correct, value.wrong, value.falseAccepts]])) }))));
