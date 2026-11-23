import * as ort from "onnxruntime-web";
import { decide } from "../engine-v3/web/decision.mjs";
import { hasHand, N_POINTS, prepareClip, TMAX } from "../engine-v3/web/preprocess.mjs";
import { ASL_V31_ASSET_PATH, ASL_V31_ASSET_PINS, ASL_V31_POLICY } from "./asl-v31-assets.mjs";
import { withLandmarkInference } from "./landmark-inference";
import { abortable, type InferenceOptions } from "./landmark-model-loader";
import { downloadModelBytes } from "./model-download";

const CLASSES = 523;
const EMBEDDING_SIZE = 384;
const POLICY_FILE = `policy-${ASL_V31_POLICY}.json` as const;

type DecisionMeta = {
  classes: string[];
  policy: { temperature: number; max_unknown: number; min_top1: number; min_margin: number | null; min_proto: number; min_hand_frames: number };
  prototypes: Float32Array;
};
type Model = { session: ort.InferenceSession; meta: DecisionMeta };
export type AslV31Suggestion = { label: string; text: string; confidence: number };

let modelPromise: Promise<Model> | undefined;
async function fetchPinned(file: keyof typeof ASL_V31_ASSET_PINS, signal: AbortSignal) {
  const pin = ASL_V31_ASSET_PINS[file];
  const bytes = await downloadModelBytes(`${ASL_V31_ASSET_PATH}/${file}`, { maxBytes: pin.bytes, signal });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (bytes.byteLength !== pin.bytes || sha !== pin.sha256) throw new Error(`ASL V3.1 ${file} failed integrity verification`);
  return bytes;
}

async function loadModel(): Promise<Model> {
  const downloads = new AbortController();
  const [modelBytes, metaBytes, policyBytes] = await Promise.all([
    fetchPinned("model.onnx", downloads.signal), fetchPinned("meta.json", downloads.signal), fetchPinned(POLICY_FILE, downloads.signal),
  ]).catch(error => { downloads.abort(error); throw error; });
  const decoder = new TextDecoder();
  const meta = JSON.parse(decoder.decode(metaBytes));
  const policy: DecisionMeta["policy"] = JSON.parse(decoder.decode(policyBytes));
  const prototypes = new Float32Array(Uint8Array.from(atob(meta.prototypes_b64), byte => byte.charCodeAt(0)).buffer);
  if (meta.version !== "v3.1" || meta.model_sha256 !== ASL_V31_ASSET_PINS["model.onnx"].sha256
    || meta.classes.length !== CLASSES || new Set(meta.classes).size !== CLASSES || meta.unknown_index !== CLASSES
    || meta.input.tmax !== TMAX || meta.input.points !== N_POINTS || prototypes.length !== CLASSES * EMBEDDING_SIZE) {
    throw new Error("ASL V3.1 metadata does not match the model contract");
  }
  const compile = new AbortController();
  const timeout = setTimeout(() => compile.abort(new Error("ASL V3.1 initialization timed out")), 90000);
  try {
    const session = await abortable(
      ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }),
      compile.signal, value => { void value.release().catch(() => {}); },
    );
    return { session, meta: { classes: meta.classes, policy, prototypes } };
  } finally {
    clearTimeout(timeout);
  }
}

function model() {
  modelPromise ??= loadModel().catch(error => { modelPromise = undefined; throw error; });
  return modelPromise;
}

/** Retain verified weights for the lifetime of the worker. Session resets still
 * cancel queued inference and invalidate all results from prior video. */
export async function warmAslV31Model() {
  await model();
}

export async function recognizeAslV31(frames: Float32Array[], options: InferenceOptions): Promise<AslV31Suggestion | null> {
  const prepared = prepareClip(frames);
  if (!prepared) return null;
  options.signal?.throwIfAborted();
  const { session, meta } = await model();
  if (frames.filter(hasHand).length < meta.policy.min_hand_frames) return null;
  return withLandmarkInference(session, options, async () => {
    const inputs = {
      x: new ort.Tensor("float32", prepared.x, [1, TMAX, N_POINTS, 3]),
      valid: new ort.Tensor("float32", prepared.valid, [1, TMAX, N_POINTS]),
      fmask: new ort.Tensor("float32", prepared.fmask, [1, TMAX]),
    };
    let results: Record<string, ort.Tensor> | undefined;
    try {
      results = await session.run(inputs);
      const logits = results.logits?.data, embedding = results.embedding?.data;
      if (!(logits instanceof Float32Array) || logits.length !== CLASSES + 1 || !logits.every(Number.isFinite)
        || !(embedding instanceof Float32Array) || embedding.length !== EMBEDDING_SIZE || !embedding.every(Number.isFinite)) {
        throw new Error("ASL V3.1 returned invalid inference outputs");
      }
      const decision = decide(logits, embedding, meta);
      if (decision.status !== "accepted" || !decision.label) return null;
      const text = decision.label.replace(/-/g, " ").toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
      return { label: decision.label, text, confidence: decision.scores.p_top1 };
    } finally {
      Object.values(inputs).forEach(tensor => tensor.dispose());
      Object.values(results ?? {}).forEach(tensor => tensor.dispose());
    }
  });
}
