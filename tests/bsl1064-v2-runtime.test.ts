import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import { describe, expect, it, vi } from "vitest";
import type { Point, VisionFrame } from "../lib/vision-types";

// Real installed BSL-1K weights in WASM. Execution/contract checks only — not accuracy.
const runs = vi.hoisted(() => ({ count: 0 }));
vi.mock("../lib/landmark-model-loader", () => {
  let loaded: Promise<{ session: ort.InferenceSession; labels: string[] }> | null = null;
  return {
    createLandmarkModelLoader: () => async () => {
      ort.env.wasm.numThreads = 1;
      loaded ??= ort.InferenceSession.create(readFileSync("public/models/bsl1064-pose2sign/model.onnx"), { executionProviders: ["wasm"] })
        .then(session => {
          const run = session.run.bind(session) as (feeds: ort.InferenceSession.OnnxValueMapType) => Promise<ort.InferenceSession.OnnxValueMapType>;
          Object.assign(session, { run: (feeds: ort.InferenceSession.OnnxValueMapType) => { runs.count++; return run(feeds); } });
          return { session, labels: JSON.parse(readFileSync("public/models/bsl1064-pose2sign/labels.json", "utf8")) as string[] };
        });
      return loaded;
    },
  };
});

const p = (x: number, y: number): Point => ({ x, y, z: 0, visibility: 0.99 });
function stream(): VisionFrame[] {
  return Array.from({ length: 60 }, (_, i) => {
    const moving = i >= 15 && i < 45;
    const wrist = p(0.62 - (moving ? (i - 15) * 0.006 : i >= 45 ? 0.18 : 0), 0.62 - (moving ? Math.sin((i - 15) / 5) * 0.05 : 0));
    const pose = Array.from({ length: 33 }, () => p(0.5, 0.5));
    pose[0] = p(0.5, 0.22); pose[11] = p(0.62, 0.42); pose[12] = p(0.38, 0.42); pose[13] = p(0.66, 0.55); pose[14] = p(0.34, 0.55);
    pose[15] = wrist; pose[16] = p(0.36, 0.7); pose[2] = p(0.53, 0.2); pose[5] = p(0.47, 0.2); pose[7] = p(0.56, 0.22); pose[8] = p(0.44, 0.22);
    return { timestamp: i * 50, face: [], pose,
      hands: [{ handedness: "Right" as const, gesture: "None", gestureScore: 0,
        landmarks: Array.from({ length: 21 }, (_, k) => ({ x: wrist.x + k * 0.003, y: wrist.y - k * 0.004, z: 0 })) }] };
  });
}

describe("BSL-1064 v2 runtime with the installed weights", () => {
  it("averages several 16-frame windows over the movement and reports a ranked decision", async () => {
    const { analyzeBsl1064 } = await import("../lib/bsl1064-runtime");
    runs.count = 0;
    const result = await analyzeBsl1064(stream(), { engine: "v2" });
    expect(result).not.toBeNull();
    const decision = result!.decision;
    expect(decision.windows).toBeGreaterThan(1);
    expect(runs.count).toBe(decision.windows);
    expect(decision.top5).toHaveLength(5);
    expect(new Set(decision.top5.map(entry => entry.label)).size).toBe(5);
    expect(decision.top5.every((entry, index) => index === 0 || entry.p <= decision.top5[index - 1].p)).toBe(true);
    expect(decision.pTop1).toBeGreaterThan(0);
    expect(decision.pTop1).toBeLessThanOrEqual(1);
    expect(decision.slotDisagreements).toBeGreaterThan(0); // the "Right"-labelled hand sits at the signer's left wrist
    if (result!.prediction) expect(result!.prediction.label).toBe(decision.best);
  }, 30000);

  it("keeps the legacy adapter available as a single-window comparison", async () => {
    const { analyzeBsl1064 } = await import("../lib/bsl1064-runtime");
    runs.count = 0;
    const result = await analyzeBsl1064(stream(), { engine: "legacy" });
    expect(result?.decision.windows).toBe(1);
    expect(runs.count).toBe(1);
  }, 30000);
});
