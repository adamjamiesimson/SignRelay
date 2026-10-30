/// <reference lib="webworker" />
import * as ort from "onnxruntime-web";
import { decodeRslOutput, packRslFrames, rslClipHasMotion, type RslInput, type RslOutput } from "../lib/rsl-video";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = "/workers/";
let session: ort.InferenceSession | null = null;
let busy = false;
const send = (message: RslOutput) => self.postMessage(message);

self.onmessage = async ({ data }: MessageEvent<RslInput>) => {
  if (busy) return;
  busy = true;
  try {
    if (data.type === "load") {
      if (!session) {
        const loaded = await ort.InferenceSession.create("/models/rsl1000-slovo/model.onnx", {
          executionProviders: ["wasm"], logSeverityLevel: 3,
        });
        // A mismatched model must not stay cached: it holds WASM heap memory
        // that garbage collection never frees, and would be run later.
        if (loaded.inputNames[0] !== "input" || loaded.outputNames[0] !== "output") {
          await loaded.release(); throw new Error("Model contract mismatch");
        }
        session = loaded;
      }
      send({ type: "ready" });
    } else if (data.type === "recognize") {
      if (!session) throw new Error("Model is not ready");
      if (!rslClipHasMotion(data.frames)) { send({ type: "result", prediction: null }); return; }
      const tensor = new ort.Tensor("float32", packRslFrames(data.frames), [1, 1, 3, 32, 224, 224]);
      data.frames.length = 0;
      try {
        const output = await session.run({ input: tensor });
        try {
          // decodeRslOutput checks the 1,001-value length and probabilities.
          if (!(output.output?.data instanceof Float32Array)) throw new Error("Invalid model output");
          send({ type: "result", prediction: decodeRslOutput(output.output.data) });
        } finally { for (const value of Object.values(output)) value.dispose(); }
      } finally { tensor.dispose(); }
    } else throw new Error("Unknown request");
  } catch {
    send({ type: "error", message: "The RSL model could not run. Stop and try again; check the connection and available memory." });
  } finally { busy = false; }
};
