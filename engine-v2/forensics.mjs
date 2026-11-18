import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { build } from "esbuild";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { aslVocabulary, fingerprint, signerKey, validateManifest } from "../scripts/evaluation-manifest.mjs";
import { loadFrozenCohorts } from "../scripts/evaluation-cohorts.mjs";
import { parseModel, predict, Stream, tensor } from "./core.mjs";
import { serve } from "./serve.mjs";

const [sourceArg, executable, handFile, output, modelFile, modelParityFile, developmentFile] = process.argv.slice(2);
if (!output) throw new Error("Supply Rebirth checkout, Chrome, Hand Landmarker, report path and optionally V2 weights and score parity file");
const source = resolve(sourceArg);
const dataset = join(source, "evaluation/derived/popsign-rebirth-v1");
const manifestBytes = await readFile(join(dataset, "val.json"));
const manifest = JSON.parse(manifestBytes);
const vocabulary = aslVocabulary();
const { cohorts } = await loadFrozenCohorts(undefined, vocabulary);
validateManifest(manifest, { vocabulary, related: cohorts.map(cohort => cohort.rows) });
const reserved = new Set(cohorts.filter(cohort => cohort.role === "sealed-holdout")
  .flatMap(cohort => cohort.rows.map(row => signerKey(row.participant_id))));
assert(manifest.every(row => row.evaluation_split === "development" && !reserved.has(signerKey(row.participant_id))));
const fixtures = JSON.parse(await readFile(join(dataset, "browser-probe.json"))).map(row => {
  const canonical = manifest.find(item => item.recording_sha256 === row.recording_sha256 && item.trial_id === row.trial_id);
  assert(canonical, "Browser probe must be a subset of frozen development inputs");
  return canonical;
});
const runtime = JSON.parse(await readFile(join(source, "evaluation/raw/rebirth-val20/runtime.json")));
assert.equal(runtime.manifest_sha256, fingerprint(manifestBytes));
const oldFeatures = JSON.parse(await readFile(join(dataset, "val-features.json")));
const oldPython = JSON.parse(await readFile(join(dataset, "models-augmented/ridge-trials.json")));
const legacy = await readFile(join(dataset, "models-augmented/ridge.json"));
const oldData = JSON.parse(legacy);
const v2 = modelFile ? parseModel(JSON.parse(await readFile(modelFile))) : null;
const parityOnly = process.env.SIGNRELAY_V2_PARITY_ONLY === "1";
const fixturesByRoute = new Map();
for (const item of parityOnly ? [] : fixtures) {
  const file = resolve(source, item.file);
  assert.equal(fingerprint(await readFile(file)), item.recording_sha256);
  fixturesByRoute.set("/clip-" + item.recording_sha256 + ".mp4", { file, type: "video/mp4" });
}
const buildResult = await build({ entryPoints: ["engine-v2/browser-lab.ts"], bundle: true, format: "iife", platform: "browser", write: false });
const server = await serve({ handFile, modelFile, port: 0, diagnostics: new Map([
  ...fixturesByRoute,
  ["/legacy.json", { data: legacy, type: "application/json" }],
  ["/lab", { data: "<!doctype html><title>Development lab</title><body><script src='/lab.js'></script>", type: "text/html" }],
  ["/lab.js", { data: buildResult.outputFiles[0].contents, type: "text/javascript" }],
]) });
let chrome;
const measurements = [];
const parities = { legacyTensorClips: 0, legacyTensorMax: 0, legacyScoreMax: 0, v2Clips: 0, v2TensorMax: 0,
  v2LogitsMax: 0, v2CalibrationMatches: 0, v2BrowserStreamMatches: 0 };
const inputErrors = [];
let browserVersion;
const save = () => writeFile(output, JSON.stringify({ parities, legacySha256: fingerprint(legacy), measurements, inputErrors,
  browserVersion, errors: chrome?.errors }, null, 2));
const maxAbs = (a, b) => {
  assert.equal(a.length, b.length);
  return a.reduce((difference, item, i) => Math.max(difference, Math.abs(item - b[i])), 0);
};
const port = server.address().port;
try {
  chrome = await startChrome(executable);
  browserVersion = (await chrome.send("Browser.getVersion")).product;
  await chrome.send("Runtime.enable");
  await chrome.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/lab" });
  for (let i = 0; i < 60 && !await chrome.evaluate("typeof scoreNative === 'function'"); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Identical recorded landmarks for offline preprocessing, Python and the browser.
  for (const item of manifest) {
    const native = JSON.parse(await readFile(join(source, "evaluation/raw/rebirth-val20", item.recording_sha256 + ".json")));
    const feature = oldFeatures.rows.find(row => row.trial_id === item.trial_id);
    const python = oldPython.find(row => row.trial_id === item.trial_id);
    const result = await chrome.evaluate(`scoreNative(${JSON.stringify(native.frames)}, ${JSON.stringify(oldData)})`);
    assert.equal(Boolean(result.descriptor), Boolean(feature.features));
    assert.equal(result.score?.accepted ?? null, python.accepted);
    assert.equal(result.score?.top ?? null, python.top);
    if (result.descriptor) {
      parities.legacyTensorClips++;
      parities.legacyTensorMax = Math.max(parities.legacyTensorMax, maxAbs(result.descriptor.features, feature.features));
      parities.legacyScoreMax = Math.max(parities.legacyScoreMax,
        Math.abs(result.score.score - python.score), Math.abs(result.score.margin - python.margin));
    }
  }
  assert(parities.legacyTensorMax <= 1e-9);
  assert(parities.legacyScoreMax <= 1e-8);
  console.log(JSON.stringify({ sameTrackParity: parities }));
  const v2Data = v2 ? JSON.parse(await readFile(developmentFile ?? "evaluation/derived/v2/val.json")) : null;
  const developmentByHash = new Map(v2Data?.rows.map(row => [row.sha256, row]));
  if (v2 && modelParityFile) {
    const python = JSON.parse(await readFile(modelParityFile));
    for (const [i, row] of v2Data.rows.entries()) {
      const result = await chrome.evaluate(`scoreV2(${JSON.stringify(row.samples)}, ${JSON.stringify(v2)})`);
      const values = row.inputs[v2.mode];
      assert.equal(Boolean(result.input), Boolean(values));
      const nodeInput = tensor(row.samples, v2.mode);
      const nodeScore = predict(v2, nodeInput);
      assert.equal(nodeScore.label, result.score.label);
      assert.equal(result.score.label, python.accepted[i]);
      if (python.stream_accepted) {
        assert.equal(result.calibrationEvents.join(", ") || null, python.stream_accepted[i]);
        parities.v2CalibrationMatches++;
      }
      const stream = new Stream(v2);
      assert.deepEqual(result.events, row.samples.flatMap(sample => stream.push(sample)?.event ?? []));
      parities.v2BrowserStreamMatches++;
      if (values) {
        parities.v2Clips++;
        parities.v2TensorMax = Math.max(parities.v2TensorMax, maxAbs(result.input, values));
        parities.v2LogitsMax = Math.max(parities.v2LogitsMax, maxAbs(result.score.scores, python.scores[i]));
      }
    }
    assert(parities.v2TensorMax <= 1e-7);
    assert(parities.v2LogitsMax <= 3e-5);
  }
  await save();
  for (const item of parityOnly ? [] : fixtures) {
    const native = JSON.parse(await readFile(join(source, "evaluation/raw/rebirth-val20", item.recording_sha256 + ".json")));
    const url = "/clip-" + item.recording_sha256 + ".mp4";
    let report;
    try {
      report = await chrome.evaluate(`replayDevelopmentClip(${JSON.stringify(url)}, ${JSON.stringify(native.frames.map(frame => frame.timestamp))}, ${JSON.stringify(v2 ? "/model.json" : "")})`);
    } catch (error) {
      inputErrors.push({ gloss: item.expected_gloss, message: error.message });
      console.log(JSON.stringify(inputErrors.at(-1)));
      await save();
      continue;
    }
    const stable = report.sourceTimes.map(({ actual, requested }, i) => ({ actual, requested, i }))
      .filter(time => Math.abs(time.actual - time.requested) <= 2);
    let presenceDisagreements = 0, comparedPoints = 0, handCountDisagreements = 0, handednessDisagreements = 0, posePairs = 0, facePairs = 0;
    const differences = [], faceDelta = [], poseDelta = [];
    const delta = (p, q) => Math.hypot((p.x - q.x) * report.aspect, p.y - q.y);
    for (const { requested, i } of stable) {
      const before = native.frames.find(frame => frame.timestamp === requested);
      const after = report.old[i];
      presenceDisagreements += Number(Boolean(before.hands.length) !== Boolean(after.hands.length));
      handCountDisagreements += Number(before.hands.length !== after.hands.length);
      if (before.pose[0] && after.pose[0]) { posePairs++; poseDelta.push(delta(before.pose[0], after.pose[0])); }
      if (before.face[3] && after.face[3]) { facePairs++; faceDelta.push(delta(before.face[3], after.face[3])); }
      if (before.hands.length === 1 && after.hands.length === 1) {
        handednessDisagreements += Number(before.hands[0].handedness !== after.hands[0].handedness);
        before.hands[0].landmarks.forEach((point, j) => {
          comparedPoints++;
          differences.push(delta(point, after.hands[0].landmarks[j]));
        });
      }
    }
    const nativeFeatures = oldFeatures.rows.find(row => row.trial_id === item.trial_id);
    const nativePrediction = oldPython.find(row => row.trial_id === item.trial_id);
    const reference = developmentByHash.get(item.recording_sha256);
    const refSamples = new Map(reference?.samples.map(sample => [sample.t, sample]));
    let v2HandDisagreements = 0;
    const v2FeatureDifferences = [];
    for (const { requested, i } of stable) {
      const ref = refSamples.get(requested);
      const web = report.independent[i];
      if (!ref || !web) continue;
      v2HandDisagreements += Number(ref.h !== web.h);
      if (ref.h && web.h) v2FeatureDifferences.push(maxAbs(ref.x, web.x));
    }
    const summarize = values => {
      values.sort((a, b) => a - b);
      return { median: values[Math.floor(values.length / 2)] ?? null, p95: values[Math.floor(values.length * 0.95)] ?? null };
    };
    measurements.push({
      gloss: item.expected_gloss, kind: item.role_in_candidate, dimensions: report.dimensions, aspect: report.aspect,
      requested: native.frames.length, delivered: report.old.length, alignedWithin2ms: stable.length,
      presenceDisagreements, handCountDisagreements, handednessDisagreements, comparedPoints,
      coordinateErrorImageHeights: summarize(differences), facePairs, faceError: summarize(faceDelta), posePairs, poseError: summarize(poseDelta),
      timestampsAbsMs: summarize(report.sourceTimes.map(time => Math.abs(time.actual - time.requested))),
      nativeHands: native.frames.filter(frame => frame.hands.length).length, browserHands: report.old.filter(frame => frame.hands.length).length,
      nativeAccepted: nativePrediction.accepted, browserAccepted: report.oldScore?.accepted ?? null,
      tensorMax: nativeFeatures.features && report.description ? maxAbs(nativeFeatures.features, report.description.features) : null,
      v2Hands: report.independent.filter(sample => sample.h).length,
      v2NativeHands: reference?.samples.filter(sample => sample.h).length ?? null,
      v2HandDisagreements, v2FeatureDiffPerMatchedFrame: summarize(v2FeatureDifferences),
      v2NativeBounded: reference ? predict(v2, tensor(reference.samples, v2.mode)).label : null,
      v2Bounded: report.result?.label ?? null, v2Events: report.events,
      v2TimingMs: Object.fromEntries(Object.keys(report.v2Timings[0] ?? {}).map(key =>
        [key, summarize(report.v2Timings.map(row => row[key]))])),
    });
    console.log(JSON.stringify({ gloss: item.expected_gloss, aligned: stable.length, native: nativePrediction.accepted,
      legacyBrowser: report.oldScore?.accepted ?? null, v2Browser: report.result?.label ?? null }));
    await save();
  }
  if (v2) {
    const { rows } = v2Data;
    const variants = [
      ["slidingThreeWindows", model => new Stream(model, { windows: [600, 1000, 1600] })],
      ["slidingOneWindow", model => new Stream(model, { windows: [1000] })],
      ["cadenceAdaptive", model => new Stream(model)],
    ];
    parities.stream = Object.fromEntries(variants.map(([name, factory]) => {
      const predictions = rows.map(row => {
        const stream = factory(v2);
        const events = row.samples.flatMap(sample => stream.push(sample)?.event ?? []);
        return { kind: row.kind, expected: row.expected, events };
      });
      return [name, predictions];
    }));
  }
  await save();
} finally {
  await chrome?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server.close();
}
