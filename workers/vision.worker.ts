/// <reference lib="webworker" />
import { VisionEngine } from "../lib/vision-engine";

let engine: VisionEngine | null = null;
self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === "init") {
      engine = await VisionEngine.create(message => self.postMessage({ type: "progress", message }), data.accelerated !== false);
      // Some browsers create a GPU context but hang on its first inference.
      // Probe before declaring readiness; the client can replace this worker
      // with CPU tracking without freezing the camera/UI.
      self.postMessage({ type: "warming" });
      const surface = new OffscreenCanvas(256, 256);
      const context = surface.getContext("2d");
      if (!context) throw new Error("Tracking probe canvas unavailable");
      context.fillStyle = "#20242c"; context.fillRect(0, 0, 256, 256);
      const probe = await createImageBitmap(surface);
      try { engine.process(probe, 1); } finally { probe.close(); }
      self.postMessage({ type: "ready", assetSource: engine.assetSource, delegate: engine.delegate });
    } else if (data.type === "frame" && engine) {
      const bitmap = data.bitmap as ImageBitmap;
      try {
        const frame = engine.process(bitmap, data.timestamp, hands => {
          self.postMessage({ type: "hands", frame: hands, handsMs: engine!.timings.hands });
        });
        self.postMessage({ type: "result", frame, timings: engine.timings });
      } finally { bitmap.close(); }
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
