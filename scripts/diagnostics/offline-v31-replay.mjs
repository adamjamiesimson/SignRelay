// Replay recorded integrated-app observations through the V3.1 segmenter, model and
// policy offline, so pipeline variants can be compared on *identical* landmark inputs.
//
//   node --experimental-strip-types scripts/diagnostics/offline-v31-replay.mjs \
//     <observations.json> <truth.json> [--policy strict|balanced] [--variant name] [--json out.json]
//
// Observations come from run-engine-comparison.mjs with CAPTURE_OBSERVATIONS set. They are
// development measurements only: they never replace a browser run of the integrated app.
import { readFileSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { decide } from "../../engine-v3/web/decision.mjs";
import { hasHand, N_POINTS, prepareClip, TMAX } from "../../engine-v3/web/preprocess.mjs";
import { trackingGapLimit } from "../../lib/frame-timing.ts";
import { AslV31Segmenter } from "../../lib/asl-v31-segmenter.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [observationFile, truthFile] = args;
const policyName = option("--policy", "strict");
const variant = option("--variant", "baseline");
const gapReset = !args.includes("--no-gap-reset");
const segmenterOptions = JSON.parse(option("--segmenter", "{}"));

const modelDir = "public/models/asl-v31";
const meta = JSON.parse(readFileSync(`${modelDir}/meta.json`, "utf8"));
const policy = JSON.parse(readFileSync(`${modelDir}/policy-${policyName}.json`, "utf8"));
const prototypes = new Float32Array(Uint8Array.from(Buffer.from(meta.prototypes_b64, "base64")).buffer);
ort.env.wasm.numThreads = 1;
const session = await ort.InferenceSession.create(readFileSync(`${modelDir}/model.onnx`), { executionProviders: ["wasm"] });

async function classify(clip) {
  const prepared = prepareClip(clip);
  if (!prepared) return { status: "no-hand" };
  const handFrames = clip.filter(hasHand).length;
  const out = await session.run({
    x: new ort.Tensor("float32", prepared.x, [1, TMAX, N_POINTS, 3]),
    valid: new ort.Tensor("float32", prepared.valid, [1, TMAX, N_POINTS]),
    fmask: new ort.Tensor("float32", prepared.fmask, [1, TMAX]),
  });
  const d = decide(out.logits.data, out.embedding.data, { classes: meta.classes, policy, prototypes });
  const status = handFrames < policy.min_hand_frames ? "too-few-hands" : d.status;
  return { status, label: status === "accepted" ? d.label : null, best: d.best, top5: d.top5.map(t => t.label),
    scores: d.scores, handFrames, frames: clip.length, span: prepared.span };
}

const { observations } = JSON.parse(readFileSync(observationFile, "utf8"));
const capture = JSON.parse(readFileSync(observationFile, "utf8"));
const truth = JSON.parse(readFileSync(truthFile, "utf8"));
const segmenter = new AslV31Segmenter(segmenterOptions);
const recent = [];
const segments = [];
let resets = 0;
for (const { t, f } of observations) {
  const features = Float32Array.from(f, value => (value === null ? NaN : value));
  const previous = recent.at(-1);
  if (gapReset && previous && (t - previous.timestamp <= 0 || t - previous.timestamp > trackingGapLimit([...recent.slice(-12), { timestamp: t }]))) {
    segmenter.reset();
    resets++;
  }
  recent.push({ timestamp: t });
  if (recent.length > 120) recent.shift();
  const result = segmenter.observe(t, features);
  if (result.clip) segments.push({ closedAt: t, clip: result.clip });
}

const rows = truth.segments.map(row => ({ ...row, results: [] }));
const idle = [];
for (const segment of segments) {
  const result = await classify(segment.clip);
  const anchor = (segment.closedAt + 50 - capture.cameraStart) / 1000; // ~inference latency
  const row = rows.find(r => anchor >= r.start - 0.10 && anchor <= r.end + 0.85);
  (row?.results ?? idle).push({ anchor, ...result });
}
const norm = label => label?.replaceAll("-", " ").trim().toUpperCase();
const summary = { correct: 0, wrong: 0, abstained: 0, falseAccept: 0, rejected: 0, top1CorrectAbstained: 0, noSegment: 0, gapAccepts: 0 };
for (const row of rows) {
  const accepted = row.results.filter(r => r.status === "accepted");
  if (row.category === "out_of_vocabulary") row.outcome = accepted.length ? "false-accept" : "rejected";
  else row.outcome = !accepted.length ? "abstained" : accepted.some(r => norm(r.label) !== norm(row.label)) ? "wrong" : "correct";
  summary[{ "false-accept": "falseAccept" }[row.outcome] ?? row.outcome]++;
  if (row.outcome === "abstained" && row.results.some(r => norm(r.best) === norm(row.label))) summary.top1CorrectAbstained++;
  if (!row.results.length) summary.noSegment++;
}
summary.gapAccepts = idle.filter(r => r.status === "accepted").length;
const report = { variant, policy: policyName, gapReset, segmenterOptions, observations: observations.length, resets, segments: segments.length, summary,
  rows: rows.map(({ trial_id, label, category, outcome, results }) => ({ trial_id, label, category, outcome,
    results: results.map(r => ({ status: r.status, best: r.best, top5: r.top5, p: r.scores?.p_top1?.toFixed(3),
      unk: r.scores?.p_unknown?.toFixed(3), proto: r.scores?.proto_cos?.toFixed(3), hands: r.handFrames, frames: r.frames })) })),
  idle };
if (option("--json")) writeFileSync(option("--json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ variant, policy: policyName, resets, segments: segments.length, ...summary }));
if (args.includes("--rows")) for (const row of report.rows) console.log(row.trial_id.padEnd(30), row.outcome.padEnd(12), JSON.stringify(row.results));
