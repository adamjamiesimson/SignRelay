/// <reference lib="webworker" />
// Built only into the replay harness, never into public/ or a Next.js export.
import { loadVisionTasks, handObservations, faceCues, poseCues } from "../../lib/vision-engine";

let hands: Awaited<ReturnType<typeof loadVisionTasks>>["gesture"];
let face: Awaited<ReturnType<typeof loadVisionTasks>>["face"];
let pose: Awaited<ReturnType<typeof loadVisionTasks>>["pose"];

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const lane = data.lane === "hands" ? "hands" : "auxiliary";
      ({ gesture: hands, face, pose } = await loadVisionTasks(lane));
      self.postMessage({ type: "ready" });
      return;
    }
    if (data.type !== "frame") return;
    const { bitmap, timestamp } = data as { bitmap: ImageBitmap; timestamp: number };
    try {
      const started = performance.now();
      const frame = { timestamp, hands: hands ? handObservations(hands.recognizeForVideo(bitmap, timestamp)) : [],
        face: face ? faceCues(face.detectForVideo(bitmap, timestamp)) : [],
        pose: pose ? poseCues(pose.detectForVideo(bitmap, timestamp)) : [] };
      self.postMessage({ type: "result", frame, computeMs: performance.now() - started });
    } finally { bitmap.close(); }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
