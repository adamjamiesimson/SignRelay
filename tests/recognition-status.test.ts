import { describe, expect, it } from "vitest";
import { recognitionStatus, type CameraPhase } from "../lib/recognition-status";

const live = { camera: "active" as const, unavailable: false, handsVisible: true, motionReason: "idle", candidate: null, bufferSize: 40 };

describe("live workspace status", () => {
  it.each<[CameraPhase, string]>([["idle", "camera off"], ["requesting", "waiting for permission"], ["loading", "starting"],
    ["denied", "camera blocked"], ["error", "camera unavailable"]])("never claims recognition while the camera is %s", (camera, chip) => {
    const status = recognitionStatus({ ...live, camera, candidate: "HELLO" });
    expect(status.chip).toBe(chip);
    expect(status.tone).toBe("paused");
    expect(`${status.chip} ${status.detail}`).not.toMatch(/HELLO|listening|checking/i);
  });
  it("reports missing hands before any candidate or movement", () => {
    expect(recognitionStatus({ ...live, handsVisible: false, candidate: "HELLO", motionReason: "moving" }).key).toBe("waiting-for-hands");
  });
  it("describes a tentative candidate as a check, never as the translation", () => {
    const status = recognitionStatus({ ...live, candidate: "THANK YOU" });
    expect(status.key).toBe("checking-sign");
    expect(status.detail).not.toContain("THANK YOU");
  });
  it("distinguishes unfinished movement from a completed movement without a match", () => {
    expect(recognitionStatus({ ...live, motionReason: "moving" }).key).toBe("following-movement");
    expect(recognitionStatus(live).key).toBe("no-confident-match");
    expect(recognitionStatus({ ...live, bufferSize: 3 }).key).toBe("building-context");
  });
  it("shows a paused unavailable state when the recognition worker failed", () => {
    expect(recognitionStatus({ ...live, unavailable: true, candidate: "YES" })).toMatchObject({ key: "unavailable", tone: "paused" });
  });
});
