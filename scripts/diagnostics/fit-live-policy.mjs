// Fit a decision policy to signers this model was not calibrated on, from saved live captures.
// Development triage: it reports what your own camera produces and what a given threshold rule
// would accept, and refuses to hand you a policy that its sample size cannot support.
//
//   node --experimental-strip-types scripts/diagnostics/fit-live-policy.mjs captures/*.json \
//     --labels labels.json [--max-false-accept 0.10] [--out policy-live.json] [--force]
//
// labels.json maps a capture file name to the gloss that was signed, or to "UNKNOWN" for a sign
// the model should reject. Captures without a label are ignored.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as ort from "onnxruntime-web";
import { decide } from "../../engine-v3/web/decision.mjs";
import { N_POINTS, prepareClip, TMAX } from "../../engine-v3/web/preprocess.mjs";

ort.env.wasm.numThreads = 1;

const args = process.argv.slice(2);
const files = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--labels"
  && args[index - 1] !== "--out" && args[index - 1] !== "--max-false-accept");
const value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
if (!files.length || !value("--labels")) {
  throw new Error("Usage: fit-live-policy.mjs <capture.json...> --labels labels.json [--max-false-accept 0.1] [--out policy.json] [--force]");
}
const labels = JSON.parse(readFileSync(value("--labels"), "utf8"));
const maxFalseAccept = Number(value("--max-false-accept") ?? 0.1);
const MIN_POSITIVES = 40, MIN_NEGATIVES = 15;

const dir = "public/models/asl-v31";
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8"));
const shipped = Object.fromEntries(["strict", "balanced"].map(name =>
  [name, JSON.parse(readFileSync(`${dir}/policy-${name}.json`, "utf8"))]));
const prototypes = new Float32Array(Uint8Array.from(Buffer.from(meta.prototypes_b64, "base64")).buffer);
const session = await ort.InferenceSession.create(readFileSync(`${dir}/model.onnx`),
  { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

async function scores(file) {
  const captured = JSON.parse(readFileSync(file, "utf8"));
  if (captured.tool !== "signrelay-live-clip-v1") throw new Error(`${basename(file)} is not a live-clip capture`);
  const frames = captured.clip.map(row => Float32Array.from(row, v => (v === null ? NaN : v)));
  const prepared = prepareClip(frames);
  if (!prepared) return { prepared: false };
  const inputs = {
    x: new ort.Tensor("float32", prepared.x, [1, TMAX, N_POINTS, 3]),
    valid: new ort.Tensor("float32", prepared.valid, [1, TMAX, N_POINTS]),
    fmask: new ort.Tensor("float32", prepared.fmask, [1, TMAX]),
  };
  try {
    const out = await session.run(inputs);
    const { scores: s, top5 } = decide(out.logits.data, out.embedding.data,
      { classes: meta.classes, policy: { ...shipped.strict, min_top1: 0, min_proto: null, max_unknown: 2 }, prototypes });
    return { prepared: true, scores: s, top5, best: top5[0].label, captured };
  } finally {
    Object.values(inputs).forEach(tensor => tensor.dispose());
  }
}

const rows = [];
for (const file of files) {
  const expected = labels[basename(file)];
  if (!expected) { console.warn(`skip ${basename(file)} - no label in ${value("--labels")}`); continue; }
  const result = await scores(file);
  if (!result.prepared) { console.warn(`skip ${basename(file)} - no usable hand frames`); continue; }
  rows.push({ file: basename(file), expected, positive: expected !== "UNKNOWN", ...result });
}

const positives = rows.filter(row => row.positive);
const negatives = rows.filter(row => !row.positive);
const correct = positives.filter(row => row.best === row.expected);
console.log(`\n${rows.length} labelled captures: ${positives.length} signed, ${negatives.length} not supported`);
console.log("\nfile                                     signed     top-1      p_top1 margin unknown proto  correct");
for (const row of rows) {
  const hit = row.positive ? (row.best === row.expected ? "yes" : "NO") : "-";
  console.log(`${row.file.padEnd(40)} ${row.expected.padEnd(10)} ${String(row.best).padEnd(10)} `
    + `${row.scores.p_top1.toFixed(3)}  ${row.scores.margin.toFixed(3)}  ${row.scores.p_unknown.toFixed(3)}  `
    + `${row.scores.proto_cos === null ? "  -  " : row.scores.proto_cos.toFixed(3)}  ${hit}`);
}
console.log(`\ntop-1 correct: ${correct.length}/${positives.length}`);

// The gate is replayed from the extracted scores, so a candidate policy costs nothing to evaluate.
function verdict(row, policy) {
  const { p_top1: p1, margin, p_unknown, proto_cos: proto } = row.scores;
  if (p_unknown >= policy.max_unknown) return "unknown";
  if (p1 < policy.min_top1) return "uncertain";
  if (policy.min_margin != null && margin < policy.min_margin) return "uncertain";
  if (policy.min_proto != null && proto !== null && proto < policy.min_proto) return "unknown";
  return "accepted";
}

for (const [name, policy] of Object.entries(shipped)) {
  const accepted = correct.filter(row => verdict(row, policy) === "accepted").length;
  const wrong = negatives.filter(row => verdict(row, policy) === "accepted").length;
  console.log(`  shipped ${name.padEnd(9)} accepts ${accepted}/${positives.length} correct, ${wrong}/${negatives.length} not supported`
    + ` (min_top1 ${policy.min_top1.toFixed(3)}, min_proto ${policy.min_proto.toFixed(3)})`);
}

/** Most correct accepts first, then the lowest false-accept rate, then the strictest gate, so a
 * tie never quietly picks the loosest rule. */
function better(a, b) {
  if (a.accepted !== b.accepted) return a.accepted > b.accepted;
  if (a.far !== b.far) return a.far < b.far;
  if (a.min_top1 !== b.min_top1) return a.min_top1 > b.min_top1;
  if (a.min_proto !== b.min_proto) return a.min_proto > b.min_proto;
  return a.min_margin > b.min_margin;
}

const steps = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => +(from + i * step).toFixed(3));
let best = null;
for (const min_top1 of steps(0.5, 0.9, 0.02)) {
  for (const min_proto of steps(0.45, 0.85, 0.02)) {
    for (const min_margin of [null, ...steps(0.1, 0.6, 0.1)]) {
      const policy = { ...shipped.strict, min_top1, min_proto, min_margin };
      const accepted = positives.filter(row => row.best === row.expected && verdict(row, policy) === "accepted").length;
      const falseAccepts = negatives.filter(row => verdict(row, policy) === "accepted").length;
      const far = negatives.length ? falseAccepts / negatives.length : 0;
      if (far > maxFalseAccept) continue;
      const candidate = { accepted, far, min_top1, min_proto, min_margin: min_margin ?? Infinity, policy, falseAccepts };
      if (!best || better(candidate, best)) best = candidate;
    }
  }
}

if (!best) { console.log("\nNo threshold rule met the false-accept budget. Nothing to fit."); process.exit(0); }
console.log(`\nBest rule within ${(maxFalseAccept * 100).toFixed(0)}% false accepts: min_top1 ${best.policy.min_top1.toFixed(2)}, `
  + `min_proto ${best.policy.min_proto.toFixed(2)}, min_margin ${best.policy.min_margin ?? "none"}`);
console.log(`  accepts ${best.accepted}/${positives.length} correct, ${best.falseAccepts}/${negatives.length} not-supported windows`
  + ` (${(best.far * 100).toFixed(1)}% false accept)`);

if (positives.length < MIN_POSITIVES || negatives.length < MIN_NEGATIVES) {
  console.log(`\nNOT ENOUGH DATA to ship this: ${positives.length}/${MIN_POSITIVES} signed captures and `
    + `${negatives.length}/${MIN_NEGATIVES} not-supported captures. With this few points the rule is fitted to `
    + `individual windows, so accept and false-accept rates here are not estimates of live behaviour.`);
  if (!args.includes("--force")) { console.log("Re-run with --force to write it anyway (development only)."); process.exit(1); }
}
if (value("--out")) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(value("--out"), `${JSON.stringify({ ...best.policy, fitted_on: { positives: positives.length, negatives: negatives.length, max_false_accept: maxFalseAccept }, note: "Development policy fitted on saved live captures; not a shipped calibration." }, null, 2)}\n`);
  console.log(`\nwrote ${value("--out")}`);
}
