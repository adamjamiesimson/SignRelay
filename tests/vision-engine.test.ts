import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gesture: vi.fn(), face: vi.fn(), pose: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn().mockResolvedValue({}) },
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
    expect(gesture.close).toHaveBeenCalledOnce();
    expect(pose.close).toHaveBeenCalledOnce();
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
