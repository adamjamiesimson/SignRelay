import * as ort from "onnxruntime-web";
import { createLandmarkModelLoader, type InferenceOptions } from "./landmark-model-loader";
import { withLandmarkInference } from "./landmark-inference";
import { downloadModelBytes } from "./model-download";
import { FEATURES, landmarkSignFeatures, SEQUENCE } from "./landmark-sign-features";
import type { VisionFrame } from "./vision-types";

/**
 * Sprint 8 replacement candidate: a signer-independent classifier trained on
 * PopSign ASL v1.0 (CC BY 4.0) landmarks produced by SignRelay's own MediaPipe
 * models (training/train_landmark_classifier.py). It has a trained rejection
 * class ("__other__"); its acceptance threshold was chosen on validation
 * signers, never on the test signers its report quotes.
 */
export const ASL_LANDMARK_MODEL_DIRECTORY = "/models/asl-popsign-v1";

type Metadata = { classes: number; threshold: number; rejectLabel: string; sequence: number; features: number };
export type AslLandmarkPrediction = { label: string; text: string; confidence: number; margin: number };

let metadata: Promise<Metadata> | null = null;
let loader: ReturnType<typeof createLandmarkModelLoader> | null = null;

async function loadMetadata(signal?: AbortSignal) {
  metadata ??= downloadModelBytes(`${ASL_LANDMARK_MODEL_DIRECTORY}/metadata.json`, { signal, maxBytes: 64 * 1024 })
    .then(bytes => {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as Metadata;
      if (value.sequence !== SEQUENCE || value.features !== FEATURES || !(value.threshold > 0 && value.threshold < 1)) {
        throw new Error("ASL landmark model does not match this feature version");
      }
      return value;
    })
    .catch(error => { metadata = null; throw error; });
  return metadata;
}

/** Display text for PopSign sign names (e.g. "callonphone" -> "Call On Phone"). */
const DISPLAY: Record<string, string> = {
  callonphone: "Call on phone", frenchfries: "French fries", glasswindow: "Glass window", haveto: "Have to",
  hesheit: "He / she / it", icecream: "Ice cream", minemy: "Mine / my", thankyou: "Thank you", weus: "We / us",
};
export const landmarkSignText = (label: string) => DISPLAY[label] ?? label.charAt(0).toUpperCase() + label.slice(1);

export async function recognizeAslLandmarks(sequence: VisionFrame[], options: InferenceOptions = {}): Promise<AslLandmarkPrediction | null> {
  options.signal?.throwIfAborted();
  const features = landmarkSignFeatures(sequence);
  if (!features) return null;
  options.onPhase?.("loading");
  const meta = await loadMetadata(options.signal);
  loader ??= createLandmarkModelLoader(ASL_LANDMARK_MODEL_DIRECTORY, meta.classes);
  const { session, labels } = await loader(options.signal);
  return withLandmarkInference(session, options, async () => {
    const input = new ort.Tensor("float32", features, [1, SEQUENCE, FEATURES]);
    let output: Record<string, ort.Tensor> = {};
    try {
      output = await session.run({ features: input });
      const logits = output.logits?.data;
      if (!(logits instanceof Float32Array) || logits.length !== labels.length || !logits.every(Number.isFinite)) return null;
      const maximum = Math.max(...logits);
      const exp = Array.from(logits, value => Math.exp(value - maximum));
      const total = exp.reduce((sum, value) => sum + value, 0);
      const order = exp.map((_, index) => index).sort((a, b) => exp[b] - exp[a]);
      const confidence = exp[order[0]] / total, margin = confidence - exp[order[1]] / total;
      const label = labels[order[0]];
      if (!label || label === meta.rejectLabel || confidence < meta.threshold) return null;
      return { label, text: landmarkSignText(label), confidence, margin };
    } finally {
      input.dispose();
      Object.values(output).forEach(tensor => tensor.dispose());
    }
  });
}
