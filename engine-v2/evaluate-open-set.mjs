import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { LABELS, parseModel, Stream } from "./core.mjs";

const [weights, trainingFile, developmentFile, calibrationFile, output] = process.argv.slice(2);
assert(output, "Supply weights, training tracks, development tracks, calibration output and evaluation output");
const modelBytes = await readFile(weights);
const model = parseModel(JSON.parse(modelBytes));
const train = JSON.parse(await readFile(trainingFile));
const dev = JSON.parse(await readFile(developmentFile));
assert.equal(train.upstream.manifest_sha256, model.trainingManifest, "Calibration must use the original training split");
const trainedSigners = new Set(train.rows.map(row => row.signer));
assert(dev.rows.every(row => !trainedSigners.has(row.signer)), "Evaluate on signer-disjoint development tracks");

// Estimate the lower tail of correct two-window margins on training signers.
// These are class-relative score floors, not estimated probabilities.
const margins = Object.fromEntries(LABELS.slice(0, -1).map(label => [label, []]));
for (const row of train.rows.filter(row => row.kind === "target")) {
  const stream = new Stream(model);
  let previous;
  for (const sample of row.samples) {
    const result = stream.push(sample);
    if (!result) continue;
    if (result.event === row.expected && previous?.label === row.expected) {
      margins[row.expected].push(Math.min(result.otherMargin, previous.otherMargin));
      break;
    }
    previous = result;
  }
}
const calibration = {
  schema: "signrelay-v2-other-margin-1",
  modelSha256: createHash("sha256").update(modelBytes).digest("hex"),
  fits: Object.fromEntries(Object.entries(margins).map(([word, values]) => [word, values.length])),
  floors: Object.fromEntries(Object.entries(margins).map(([word, values]) => {
    assert(values.length >= 5, `Insufficient training examples for ${word}`);
    values.sort((a, b) => a - b);
    return [word, values[Math.floor((values.length - 1) * 0.10)]];
  })),
};
await writeFile(calibrationFile, JSON.stringify(calibration, null, 2) + "\n");

const policies = { baseline: null, fresh: { recentEvidence: true }, calibrated: { otherMargin: calibration.floors },
  combined: { recentEvidence: true, otherMargin: calibration.floors } };
const results = [];
for (const interval of [0, 67, 100, 167]) {
  for (const [name, rejection] of Object.entries(policies)) {
    const totals = { correct: 0, incorrect: 0, abstained: 0, duplicateWords: 0, rejected: 0, falseAccepts: 0 };
    const falseByLabel = {};
    for (const row of dev.rows) {
      const stream = new Stream(model, { rejection });
      const events = [];
      let next = row.samples[0]?.t;
      for (const sample of row.samples) {
        if (interval && sample.t + 0.1 < next) continue;
        if (interval) while (next <= sample.t + 0.1) next += interval;
        const result = stream.push(sample);
        if (result?.event) events.push(result.event);
      }
      totals.duplicateWords += events.length - new Set(events).size;
      if (row.kind === "target") {
        totals[!events.length ? "abstained" : events.length === 1 && events[0] === row.expected ? "correct" : "incorrect"]++;
      } else if (events.length) {
        totals.falseAccepts++;
        (falseByLabel[row.expected] ??= []).push(events);
      } else totals.rejected++;
    }
    results.push({ interval, name, ...totals, falseByLabel });
  }
}
await writeFile(output, JSON.stringify({ calibration, results }, null, 2) + "\n");
console.log(JSON.stringify({ calibration, results }));
