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

describe("same-frame hand reacquisition", () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.4, z: 0 }));
  const seen = { landmarks: [points], handedness: [[{ categoryName: "Right" }]], gestures: [[]] };
  const empty = { landmarks: [], handedness: [], gestures: [] };
  async function engineWith(results: Array<typeof seen | typeof empty>) {
    const recognizeForVideo = vi.fn();
    for (const result of results) recognizeForVideo.mockReturnValueOnce(result);
    recognizeForVideo.mockReturnValue(empty);
    mocks.gesture.mockResolvedValue({ recognizeForVideo, close: vi.fn() });
    mocks.face.mockResolvedValue({ detectForVideo: () => ({ faceLandmarks: [] }), close: vi.fn() });
    mocks.pose.mockResolvedValue({ detectForVideo: () => ({ landmarks: [] }), close: vi.fn() });
    const { VisionEngine } = await import("../lib/vision-engine");
    return { engine: await VisionEngine.create(), recognizeForVideo };
  }
  const source = {} as HTMLVideoElement;

  it("asks again for the same image when tracking loses a hand it had on the previous frame", async () => {
    // frame 1 tracked; frame 2 tracking misses, the retry detects the hand afresh.
    const { engine, recognizeForVideo } = await engineWith([seen, empty, seen]);
    expect(engine.process(source, 100).hands).toHaveLength(1);
    const frame = engine.process(source, 150);
    expect(frame.hands).toHaveLength(1);
    expect(frame.timestamp).toBe(150); // the frame keeps the camera timestamp
    expect(recognizeForVideo.mock.calls.map(([image, time]) => [image, time])).toEqual([[source, 100], [source, 150], [source, 151]]);
    expect(engine.reacquisition).toEqual({ attempts: 1, recovered: 1 });
  });

  it("retries once when the hand really left, then stops retrying while no hand is visible", async () => {
    const { engine, recognizeForVideo } = await engineWith([seen]);
    engine.process(source, 100);
    for (const time of [150, 200, 250, 300]) expect(engine.process(source, time).hands).toEqual([]);
    // 1 tracked frame + 4 empty frames + exactly one retry at the moment of loss.
    expect(recognizeForVideo).toHaveBeenCalledTimes(6);
    expect(engine.reacquisition).toEqual({ attempts: 1, recovered: 0 });
  });

  it("never retries when no hand has been seen, so an empty scene costs nothing extra", async () => {
    const { engine, recognizeForVideo } = await engineWith([]);
    for (const time of [100, 150, 200]) engine.process(source, time);
    expect(recognizeForVideo).toHaveBeenCalledTimes(3);
    expect(engine.reacquisition.attempts).toBe(0);
  });

  it("keeps retry timestamps strictly increasing and below the next camera frame", async () => {
    const { engine, recognizeForVideo } = await engineWith([seen, empty, seen, empty, seen]);
    for (const time of [0, 33, 66]) engine.process(source, time);
    const times = recognizeForVideo.mock.calls.map(([, time]) => time as number);
    expect(times).toEqual([0, 33, 34, 66, 67]);
    expect(times.every((time, index) => !index || time > times[index - 1])).toBe(true);
  });
});
