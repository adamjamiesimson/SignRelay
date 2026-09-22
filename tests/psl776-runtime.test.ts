import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import type { VisionFrame } from "../lib/vision-types";

function frame(timestamp: number, x: number, y: number): VisionFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  pose[11] = { x: 0.4, y: 0.3, z: 0 };
  pose[12] = { x: 0.6, y: 0.3, z: 0 };
  const landmarks = Array.from({ length: 21 }, (_, index) => ({ x: x + index * 0.002, y: y - index * 0.001, z: 0 }));
  return { timestamp, hands: [{ landmarks, handedness: "Right", gesture: "None", gestureScore: 0 }], face: [], pose };
}

function makeSequence(x: number, y: number, count = 24): VisionFrame[] {
  return Array.from({ length: count }, (_, index) => frame(index * 33, x, y));
}

function fakeResponse(body: unknown) {
  const gzipped = gzipSync(Buffer.from(JSON.stringify(body)));
  return { ok: true, arrayBuffer: async () => gzipped.buffer.slice(gzipped.byteOffset, gzipped.byteOffset + gzipped.byteLength) };
}

describe("recognizePsl776 (built-in official-reference DTW matching)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const templates = [
    { gloss: "ALPHA", text: "Alpha", frames: prepareCalibrationSequence(makeSequence(0.3, 0.4)) },
    { gloss: "BETA", text: "Beta", frames: prepareCalibrationSequence(makeSequence(0.8, 0.7)) },
  ];

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn().mockResolvedValue(fakeResponse(templates));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("matches a live sequence to the closer official reference template", async () => {
    const { recognizePsl776 } = await import("../lib/psl776-runtime");
    const result = await recognizePsl776(makeSequence(0.31, 0.41));
    expect(result?.label).toBe("ALPHA");
    expect(result?.confidence).toBeGreaterThan(0);
  });

  it("rejects a sequence that matches no official reference closely", async () => {
    const { recognizePsl776 } = await import("../lib/psl776-runtime");
    const result = await recognizePsl776(makeSequence(0.55, 0.55));
    expect(result).toBeNull();
  });

  it("fetches the template bundle only once across repeated calls", async () => {
    const { recognizePsl776 } = await import("../lib/psl776-runtime");
    await recognizePsl776(makeSequence(0.31, 0.41));
    await recognizePsl776(makeSequence(0.79, 0.69));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null for a sequence too short to resolve a sign", async () => {
    const { recognizePsl776 } = await import("../lib/psl776-runtime");
    expect(await recognizePsl776(makeSequence(0.31, 0.41, 3))).toBeNull();
  });

  it("propagates a network failure instead of returning a false result", async () => {
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    const { recognizePsl776 } = await import("../lib/psl776-runtime");
    await expect(recognizePsl776(makeSequence(0.31, 0.41))).rejects.toThrow("Network unavailable");
  });
});
