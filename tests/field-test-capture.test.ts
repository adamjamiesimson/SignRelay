import { describe, expect, it } from "vitest";
import { capturePlan, captureMetadata, captureTrial, rejectRecording, sha256Hex, slotLabels, takeCount, videoExtension } from "../lib/field-test-capture";

describe("private development recording slot IDs", () => {
  it("matches the frozen 144-slot collection plan without making observed recordings", () => {
    let count = 0;
    for (let p = 0; p < capturePlan.participant_ids.length; p++) {
      for (const type of ["sign", "no_sign", "unknown_sign"] as const) {
        for (let slot = 1; slot <= slotLabels(type).length; slot++) {
          for (let take = 1; take <= takeCount(type); take++) {
            const trial = captureTrial(p, type, slot, take);
            expect(trial.trial_id).toBe(capturePlan.participant_ids[p] + "-" + type + "-" + slot + "-" + take);
            expect(trial.evaluation_split).toBe("development");
            if (type !== "sign") expect(trial.expected_gloss).toBeNull();
            count++;
          }
        }
      }
    }
    expect(count).toBe(capturePlan.planned_counts.total);
    expect(count).toBe(144);
  });
  it("refuses non-plan participants, slots and takes", () => {
    expect(() => captureTrial(-1, "sign", 1, 1)).toThrow("participant");
    expect(() => captureTrial(4, "sign", 1, 1)).toThrow("participant");
    expect(() => captureTrial(0, "sign", 7, 1)).toThrow("slot");
    expect(() => captureTrial(0, "no_sign", 1, 3)).toThrow("take");
    expect(() => captureTrial(0, "unknown_sign", 4, 1)).toThrow("slot");
  });
  it("never mislabels browser WebM as MP4", () => {
    expect(videoExtension("video/webm;codecs=vp8")).toBe("webm");
    expect(videoExtension("video/mp4")).toBe("mp4");
  });
});

describe("take acceptance and pending-review sidecar", () => {
  const ok = { durationMs: 2400, bytes: 120_000, mimeType: "video/webm;codecs=vp8", interruption: null };
  it("accepts a complete original take without approving it", () => {
    expect(rejectRecording(ok)).toBeNull();
  });
  it.each([
    [{ ...ok, durationMs: 400 }, "shorter than 1 second"],
    [{ ...ok, bytes: 0 }, "empty"],
    [{ ...ok, bytes: 101 * 1024 * 1024 }, "100 MB"],
    [{ ...ok, mimeType: "video/x-matroska" }, "Unsupported"],
    [{ ...ok, interruption: "camera ended" }, "interrupted"],
    [{ ...ok, durationMs: 40_000 }, "30 seconds"],
  ])("rejects an incomplete or unusable take %#", (check, reason) => {
    expect(rejectRecording(check)).toContain(reason);
  });
  it("pairs the sidecar to one file by name, size and checksum and keeps review pending", async () => {
    const blob = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])], { type: "video/webm" });
    const sha256 = await sha256Hex(blob);
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    const metadata = captureMetadata({ trial: captureTrial(1, "sign", 5, 2), mime: blob.type, bytes: blob.size, sha256,
      recordedAt: "2026-10-21T10:00:00.000Z", durationMs: 2400.4, stopReason: "manual", dominantHand: "Left",
      physicalHands: ["Left"], device: "Laptop / Chrome", oovGloss: null,
      camera: { width: 1280, height: 720, frameRate: 30, facingMode: "user" } });
    expect(metadata).toMatchObject({ schema: 2, trial_id: "dev-20261017-p02-sign-5-2", expected_gloss: "YES",
      original_recording_file: "dev-20261017-p02-sign-5-2.webm", bytes: 7, recording_sha256: sha256, duration_ms: 2400,
      status: "pending-independent-fluent-review", review: { status: "pending", fluent_asl: false } });
    expect(Object.keys(metadata.camera_settings)).toEqual(["width", "height", "frameRate", "facingMode"]);
  });
});
