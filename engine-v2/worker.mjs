import { parseModel, predict, Stream, tensor, usableHand, wellFormedHand } from "./core.mjs";
import { tracker } from "./vision.mjs";

let model;
let vision;
let stream;
let clip;
let bounded;
let firstFrame;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "start") {
      if (vision) throw new Error("Restart the session before loading another model");
      bounded = data.bounded;
      const loadStarted = performance.now();
      const [response, runtime] = await Promise.all([fetch("/model.json"), fetch("/profile.json")]);
      if (!response.ok) throw new Error("Development weights are unavailable");
      model = parseModel(await response.json());
      if (!runtime.ok) throw new Error("Tracker profile is unavailable");
      const loaded = await runtime.json();
      const modelAndProfileMs = performance.now() - loadStarted;
      let profile = bounded ? { ...loaded, poseMode: "inline", handDelegate: "CPU", onDemandPose: false,
        framewiseHands: false, warmHand: false } : loaded;
      if (data.forceCpu && profile.auto) profile = { ...profile, handDelegate: "CPU", warmHand: false };
      if (profile.warmHand && profile.handDelegate === "GPU") {
        self.postMessage({ type: "warming", automatic: profile.auto });
      }
      try {
        vision = await tracker(model.mode, profile);
      } catch (error) {
        if (!profile.auto || profile.handDelegate !== "GPU") throw error;
        profile = { ...profile, handDelegate: "CPU", warmHand: false };
        vision = await tracker(model.mode, profile);
      }
      stream = new Stream(model, { calibrationReplay: profile.calibrationReplay, rejection: bounded ? null : profile.rejection });
      clip = [];
      firstFrame = true;
      self.postMessage({ type: "ready", version: model.version, vocabulary: model.labels.slice(0, -1), capture: profile.capture,
        handDelegate: profile.handDelegate, poseMode: profile.poseMode, auto: profile.auto,
        startup: { modelAndProfileMs, ...vision.startup } });
      return;
    }
    if (!vision) throw new Error("Model has not loaded");
    if (data.type === "finish") {
      const input = { ids: [] };
      const started = performance.now();
      const result = bounded ? predict(model, tensor(clip, model.mode, input)) : null;
      self.postMessage({ type: "done", result, input: { ...input, recognizeMs: performance.now() - started } });
      return;
    }
    if (data.type !== "frame") throw new Error("Unknown worker request");
    try {
      const workerReceivedAt = performance.timeOrigin + performance.now();
      const traceStage = firstFrame ? stage => self.postMessage({ type: "progress", id: data.id, stage,
        at: performance.timeOrigin + performance.now() }) : undefined;
      firstFrame = false;
      const { frame, sample, ms, pose } = vision.run(data.image, data.timestamp, traceStage);
      const start = performance.now();
      sample.id = data.id;
      const segmentation = { reset: false, resetSamples: 0, capacityEvicted: 0, windows: [], rejected: 0 };
      const result = stream.push(sample, segmentation);
      if (bounded) {
        if (clip.length >= 450 || sample.t - (clip[0]?.t ?? sample.t) > 15000) {
          throw new Error("Clip mode accepts videos up to 15 seconds");
        }
        clip.push(sample);
      }
      const malformed = frame.hands.filter(hand => !wellFormedHand(hand)).length;
      const offscreen = frame.hands.length - malformed - frame.hands.filter(usableHand).length;
      self.postMessage({ type: "frame", id: data.id, result, hand: sample.h, detected: frame.hands.length > 0,
        detection: { malformed, offscreen }, pose, segmentation, workerReceivedAt,
        workerFinishedAt: performance.timeOrigin + performance.now(),
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
