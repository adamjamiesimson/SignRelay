/// <reference lib="webworker" />
import * as ort from "onnxruntime-web";
import { bdslClipHasMotion, decodeBdslOutput, packBdslFrames, type BdslInput, type BdslOutput } from "../lib/bdsl-video";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = "/workers/";
let session: ort.InferenceSession | null = null;
let labels: string[] = [];
let busy = false;
const send = (message: BdslOutput) => self.postMessage(message);

self.onmessage = async ({ data }: MessageEvent<BdslInput>) => {
  if (busy) return;
  busy = true;
  try {
    if (data.type === "load") {
      if (!session) {
        const response = await fetch("/models/bdsl401-videomae/labels.json");
        if (!response.ok) throw new Error("Labels unavailable");
        const values: unknown = await response.json();
        if (!Array.isArray(values) || values.length !== 401 || values.some(label => typeof label !== "string" || !label.trim())) throw new Error("Invalid labels");
        labels = values;
        // Only the cross-runtime verified weight-only model, never dynamic activation int8.
        const loaded = await ort.InferenceSession.create("/models/bdsl401-videomae/model.onnx", { executionProviders: ["wasm"], logSeverityLevel: 3 });
        if (loaded.inputNames.join() !== "pixel_values" || loaded.outputNames.join() !== "logits") {
          await loaded.release(); throw new Error("Model contract mismatch");
        }
        session = loaded;
      }
      send({ type: "ready" });
    } else if (data.type === "recognize") {
      if (!session) throw new Error("Model is not ready");
      if (!bdslClipHasMotion(data.frames)) { send({ type: "result", prediction: null }); return; }
      const tensor = new ort.Tensor("float32", packBdslFrames(data.frames), [1, 16, 3, 224, 224]);
      data.frames.length = 0;
      try {
        const output = await session.run({ pixel_values: tensor });
        try {
          if (output.logits?.dims.join() !== "1,401" || !(output.logits.data instanceof Float32Array)) throw new Error("Invalid model output");
          send({ type: "result", prediction: decodeBdslOutput(output.logits.data, labels) });
        } finally { for (const value of Object.values(output)) value.dispose(); }
      } finally { tensor.dispose(); }
    } else throw new Error("Unknown request");
  } catch {
    send({ type: "error", message: "The Bangla model could not run. Stop and retry; check your connection and available memory." });
  } finally { busy = false; }
};
