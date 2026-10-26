import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gesture: vi.fn(), face: vi.fn(), pose: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  GestureRecognizer: { createFromOptions: mocks.gesture },
  FaceLandmarker: { createFromOptions: mocks.face },
  PoseLandmarker: { createFromOptions: mocks.pose },
}));
beforeEach(() => vi.resetAllMocks());
describe("vision resources and capture cadence", () => {
  it("falls back from GPU to CPU and releases partially loaded GPU models", async () => {
    const part = () => ({ close: vi.fn() });
    const face = part(), pose = part();
    mocks.gesture.mockImplementation(async (_files, options) => {
      if (options.baseOptions.delegate === "GPU") throw new Error("GPU unavailable");
      return part();
    });
    mocks.face.mockResolvedValue(face); mocks.pose.mockResolvedValue(pose);
    const { VisionEngine } = await import("../lib/vision-engine");
    const engine = await VisionEngine.create(undefined, true);
    expect(engine.delegate).toBe("CPU"); expect(engine.assetSource).toBe("self-hosted");
    expect(face.close).toHaveBeenCalledOnce(); expect(pose.close).toHaveBeenCalledOnce(); engine.close();
  });
  it("releases models that loaded when another model fails to start", async () => {
    const gesture = { close: vi.fn() }, pose = { close: vi.fn() };
    mocks.gesture.mockResolvedValue(gesture);
    mocks.face.mockRejectedValue(new Error("Face model download failed"));
    mocks.pose.mockResolvedValue(pose);
    const { VisionEngine } = await import("../lib/vision-engine");
    await expect(VisionEngine.create()).rejects.toThrow("Face model download failed");
    // Self-hosted and CDN attempts each release what they loaded.
    expect(gesture.close).toHaveBeenCalledTimes(2);
    expect(pose.close).toHaveBeenCalledTimes(2);
  });
  it("loads self-hosted assets first and falls back to the pinned CDN copy", async () => {
    const part = () => ({ close: vi.fn() });
    mocks.gesture.mockImplementation(async (_files, options) => {
      if (options.baseOptions.modelAssetPath.startsWith("/vision/")) throw new Error("404");
      return part();
    });
    mocks.face.mockResolvedValue(part()); mocks.pose.mockResolvedValue(part());
    const { VisionEngine } = await import("../lib/vision-engine");
    const { FilesetResolver } = await import("@mediapipe/tasks-vision");
    const engine = await VisionEngine.create();
    expect(engine.assetSource).toBe("cdn");
    expect(vi.mocked(FilesetResolver.forVisionTasks).mock.calls.map(([path]) => path)).toEqual([
      "/vision/wasm", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"]);
    mocks.gesture.mockResolvedValue(part());
    expect((await VisionEngine.create()).assetSource).toBe("self-hosted");
  });
  it.each([[0, 50, 100, 150], [0, 300, 600, 900]])("leaves capacity for hands at fast and slow camera cadence: %j", async (...times) => {
    const gesture = { close: vi.fn(), recognizeForVideo: vi.fn().mockReturnValue({ landmarks: [], handedness: [], gestures: [] }) };
    const face = { close: vi.fn(), detectForVideo: vi.fn().mockReturnValue({ faceLandmarks: [] }) };
    const pose = { close: vi.fn(), detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }) };
    mocks.gesture.mockResolvedValue(gesture); mocks.face.mockResolvedValue(face); mocks.pose.mockResolvedValue(pose);
    const { VisionEngine } = await import("../lib/vision-engine");
    const engine = await VisionEngine.create();
    for (const time of times) engine.process({} as HTMLVideoElement, time);
    expect(gesture.recognizeForVideo).toHaveBeenCalledTimes(4);
    expect(face.detectForVideo).toHaveBeenCalledTimes(2);
    expect(pose.detectForVideo).toHaveBeenCalledTimes(2);
    engine.close();
    expect(gesture.close).toHaveBeenCalledOnce();
  });
});

it("preserves Tasks handedness and forwards the exact unmirrored source", async () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.4, z: 0 }));
  const recognizeForVideo = vi.fn().mockReturnValue({ landmarks: [points, points],
    handedness: [[{ categoryName: "Left" }], [{ categoryName: "Right" }]], gestures: [[], []] });
  mocks.gesture.mockResolvedValue({ recognizeForVideo, close: vi.fn() });
  mocks.face.mockResolvedValue({ detectForVideo: () => ({ faceLandmarks: [] }), close: vi.fn() });
  mocks.pose.mockResolvedValue({ detectForVideo: () => ({ landmarks: [] }), close: vi.fn() });
  const { VisionEngine, taskHandedness } = await import("../lib/vision-engine");
  const engine = await VisionEngine.create(); const source = {} as HTMLVideoElement;
  expect(engine.process(source, 100).hands.map(hand => hand.handedness)).toEqual(["Left", "Right"]);
  expect(recognizeForVideo).toHaveBeenCalledWith(source, 100);
  expect(taskHandedness("unexpected")).toBe("Unknown"); engine.close();
});
