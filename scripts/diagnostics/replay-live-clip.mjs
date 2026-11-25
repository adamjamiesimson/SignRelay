// Replay one saved live sign (`?perf` → "Save last sign") through V3.1 offline, with the
// preprocessing variants that a live camera could plausibly shift: handedness slots, time
// direction, window trim and both policies. Development triage only - it measures a saved
// landmark window, not accuracy.
//
//   node --experimental-strip-types scripts/diagnostics/replay-live-clip.mjs sign.json [--label HIGH]
import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { decide } from "../../engine-v3/web/decision.mjs";
import { N_POINTS, prepareClip, TMAX } from "../../engine-v3/web/preprocess.mjs";

ort.env.wasm.numThreads = 1;

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith("--"));
if (!file) throw new Error("Usage: node --experimental-strip-types scripts/diagnostics/replay-live-clip.mjs <sign.json> [--label GLOSS]");
const expected = args.includes("--label") ? args[args.indexOf("--label") + 1].toUpperCase() : null;

const captured = JSON.parse(readFileSync(file, "utf8"));
if (captured.tool !== "signrelay-live-clip-v1") throw new Error(`Not a live-clip capture: ${captured.tool}`);
const HAND_POINTS = 42;

/** Captured JSON holds nulls where a point was missing; the pipeline uses NaN. */
function toFrames(clip, transform = frame => frame) {
  return clip.map(row => transform(Float32Array.from(row, value => (value === null ? NaN : value))));
}

/** Swap which hand occupies slots 0-20 and 21-41 (MediaPipe left/right, post aspect correction). */
function swapHands(frame) {
  const out = frame.slice();
  for (let point = 0; point < 21; point++) {
    for (let axis = 0; axis < 3; axis++) {
      const a = point * 3 + axis, b = (21 + point) * 3 + axis;
      out[a] = frame[b]; out[b] = frame[a];
    }
  }
  return out;
}

const modelDir = "public/models/asl-v31";
const meta = JSON.parse(readFileSync(`${modelDir}/meta.json`, "utf8"));
const prototypes = new Float32Array(Uint8Array.from(Buffer.from(meta.prototypes_b64, "base64")).buffer);
const policies = Object.fromEntries(["strict", "balanced"].map(name =>
  [name, JSON.parse(readFileSync(`${modelDir}/policy-${name}.json`, "utf8"))]));
const session = await ort.InferenceSession.create(readFileSync(`${modelDir}/model.onnx`),
  { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

async function classify(frames, policy) {
  const prepared = prepareClip(frames);
  if (!prepared) return { status: "no-hand", best: null, top5: [], pTop1: 0, pUnknown: 0, proto: null };
  const inputs = {
    x: new ort.Tensor("float32", prepared.x, [1, TMAX, N_POINTS, 3]),
    valid: new ort.Tensor("float32", prepared.valid, [1, TMAX, N_POINTS]),
    fmask: new ort.Tensor("float32", prepared.fmask, [1, TMAX]),
  };
  try {
    const out = await session.run(inputs);
    const decision = decide(out.logits.data, out.embedding.data, { classes: meta.classes, policy, prototypes });
    const { scores } = decision;
    return { status: decision.status, best: decision.label ?? decision.best, top5: decision.top5,
      pTop1: scores.p_top1, pUnknown: scores.p_unknown, proto: scores.proto_cos };
  } finally {
    Object.values(inputs).forEach(tensor => tensor.dispose());
  }
}

const trim = (frames, from, to) => frames.slice(Math.floor(frames.length * from), Math.ceil(frames.length * to));
const variants = [
  ["as captured", toFrames(captured.clip)],
  ["hand slots swapped", toFrames(captured.clip, swapHands)],
  ["time reversed", toFrames(captured.clip).reverse()],
  ["middle 60% of the window", trim(toFrames(captured.clip), 0.2, 0.8)],
  ["without the last 20%", trim(toFrames(captured.clip), 0, 0.8)],
];

const rank = entry => expected && entry.top5.some(item => item.label === expected)
  ? `rank ${entry.top5.findIndex(item => item.label === expected) + 1}` : expected ? "not in top 5" : "";
const line = (entry) => `${entry.status.padEnd(9)} ${String(entry.best).padEnd(12)} p ${entry.pTop1.toFixed(2)}`
  + ` unk ${entry.pUnknown.toFixed(2)} proto ${entry.proto === null ? "—" : entry.proto.toFixed(2)}`
  + ` · ${entry.top5.slice(0, 5).map(item => `${item.label} ${item.p.toFixed(2)}`).join(", ")}`;

console.log(`${file} · ${captured.frames} frames · model ${captured.model.sha256.slice(0, 12)} · policy ${captured.model.policy}`);
if (expected) console.log(`expected gloss: ${expected}${meta.classes.includes(expected) ? ` (class ${meta.classes.indexOf(expected)})` : " (NOT IN VOCABULARY)"}`);
if (captured.decision) console.log(`captured decision: ${captured.decision.status} — ${captured.decision.reason || "accepted"}`
  + ` · top ${captured.decision.top3.map(item => `${item.label} ${item.p.toFixed(2)}`).join(", ")}`);
if (captured.diagnostics) {
  const d = captured.diagnostics;
  console.log(`captured stages: hands ${d.handFrames}/${d.observations} frames · shoulders ${d.shoulderFrames}`
    + ` · started ${d.segmentsOpened} · completed ${d.segmentsCompleted} · capped ${d.segmentsCapped} · inference ${d.lastInferenceMs?.toFixed(0)} ms`);
}
console.log("");
for (const [name, frames] of variants) {
  const handPoints = frames.reduce((total, frame) =>
    total + Array.from({ length: HAND_POINTS }, (_, point) => point).filter(point => Number.isFinite(frame[point * 3])).length, 0);
  const results = await Promise.all(["strict", "balanced"].map(policy => classify(frames, policies[policy])));
  console.log(`${name} (${frames.length} frames, ${handPoints} hand points)`);
  ["strict", "balanced"].forEach((policy, index) => console.log(`  ${policy.padEnd(8)} ${line(results[index])} ${rank(results[index], policy)}`));
}
