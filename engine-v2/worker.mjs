import { parseModel, predict, Stream, tensor } from "./core.mjs";
import { tracker } from "./vision.mjs";

let model;
let vision;
let stream;
let clip;
let bounded;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "start") {
      if (vision) throw new Error("Restart the session before loading another model");
      bounded = data.bounded;
      const response = await fetch("/model.json");
      if (!response.ok) throw new Error("Development weights are unavailable");
      model = parseModel(await response.json());
      vision = await tracker(model.mode);
      stream = new Stream(model);
      clip = [];
      self.postMessage({ type: "ready", version: model.version, vocabulary: model.labels.slice(0, -1) });
      return;
    }
    if (!vision) throw new Error("Model has not loaded");
    if (data.type === "finish") {
      const result = bounded ? predict(model, tensor(clip, model.mode)) : null;
      self.postMessage({ type: "done", result });
      return;
    }
    if (data.type !== "frame") throw new Error("Unknown worker request");
    try {
      const { sample, ms } = vision.run(data.image, data.timestamp);
      const start = performance.now();
      const result = stream.push(sample);
      if (bounded) {
        if (clip.length >= 450 || sample.t - (clip[0]?.t ?? sample.t) > 15000) {
          throw new Error("Clip mode accepts videos up to 15 seconds");
        }
        clip.push(sample);
      }
      self.postMessage({ type: "frame", result, hand: sample.h,
        ms: { ...ms, recognize: performance.now() - start } });
    } finally {
      data.image.close();
    }
  } catch (error) {
    vision?.close();
    vision = null;
    self.postMessage({ type: "error", message: error.message });
  }
};
