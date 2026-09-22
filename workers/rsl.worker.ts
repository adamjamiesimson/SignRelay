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
      session ??= await ort.InferenceSession.create("/models/rsl1000-slovo/model.onnx", {
        executionProviders: ["wasm"], logSeverityLevel: 3,
      });
      if (session.inputNames[0] !== "input" || session.outputNames[0] !== "output") throw new Error("Model contract mismatch");
      send({ type: "ready" });
    } else {
      if (!session) throw new Error("Model is not ready");
      if (!rslClipHasMotion(data.frames)) { send({ type: "result", prediction: null }); return; }
      const tensor = new ort.Tensor("float32", packRslFrames(data.frames), [1, 1, 3, 32, 224, 224]);
      data.frames.length = 0;
      const output = await session.run({ input: tensor });
      if (!(output.output?.data instanceof Float32Array)) throw new Error("Invalid model output");
      send({ type: "result", prediction: decodeRslOutput(output.output.data) });
    }
  } catch {
    send({ type: "error", message: "The RSL model could not run. Stop and try again; check the connection and available memory." });
  } finally { busy = false; }
};
