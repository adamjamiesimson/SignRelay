import { describe, expect, it } from "vitest";
import { FingerspellingCapture } from "../lib/fingerspelling-capture";
import { exportResearchMetrics } from "../lib/fingerspelling-research";
import { Fingerprint, fingerprintFloat32, fingerprintObservations, fingerprintSchedule, firstDivergentStage } from "../lib/pipeline-fingerprint";
import { createSession, replay } from "../scripts/diagnostics/replay-fingerspelling-trace";
import { makeSign } from "./fixtures/asl-motion";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Synthetic kinematic landmarks only (no recording, no person).
function syntheticCapture(jitter = 0) {
  const capture = new FingerspellingCapture(16 / 9, "v3");
  makeSign("THANK YOU", { duration: 1400, count: 22, jitter }).forEach((frame, i) => capture.push({ ...frame, timestamp: 1000 + i * 1000 / 15, capturedAt: 1000 + i * 1000 / 15 } as typeof frame));
  return capture;
}

describe("stage fingerprints", () => {
  it("are stable identifiers that change with a single Float32 ULP", () => {
    const values = Float32Array.from([0.25, 0.5, 0.75]);
    expect(fingerprintFloat32(values)).toBe(fingerprintFloat32(Float32Array.from(values)));
    expect(fingerprintFloat32(values)).toMatch(/^[0-9a-f]{16}$/);
    const nudged = Float32Array.from(values); new Uint32Array(nudged.buffer)[1] += 1;
    expect(fingerprintFloat32(nudged)).not.toBe(fingerprintFloat32(values));
    // Views hash their own bytes, not the whole backing buffer.
    const backing = new Float32Array([9, 0.25, 0.5, 0.75, 9]);
    expect(fingerprintFloat32(backing.subarray(1, 4))).toBe(fingerprintFloat32(values));
    expect(new Fingerprint().text("A").digest()).not.toBe(new Fingerprint().text("B").digest());
    // Numeric identity: JSON turns -0 into 0, and NaN payloads are not meaningful.
    expect(fingerprintFloat32([0, -0, NaN])).toBe(fingerprintFloat32([-0, 0, Number.NaN]));
  });
  it("separate schedule changes from observation changes", () => {
    const frames = makeSign("SORRY");
    const shifted = frames.map(frame => ({ ...frame, timestamp: frame.timestamp + 500 }));
    // A constant clock offset is not a schedule change.
    expect(fingerprintSchedule(shifted.map(f => f.timestamp))).toBe(fingerprintSchedule(frames.map(f => f.timestamp)));
    const late = frames.map((f, i) => i === 5 ? f.timestamp + 1 : f.timestamp);
    expect(fingerprintSchedule(late)).not.toBe(fingerprintSchedule(frames.map(f => f.timestamp)));
    expect(fingerprintObservations(shifted)).toBe(fingerprintObservations(frames));
    const moved = frames.map((f, i) => i === 3 ? { ...f, hands: f.hands.map(h => ({ ...h, landmarks: h.landmarks.map((p, j) => j ? p : { ...p, x: p.x + 1e-6 }) })) } : f);
    expect(fingerprintObservations(moved)).not.toBe(fingerprintObservations(frames));
    const missing = frames.map((f, i) => i === 3 ? { ...f, hands: [] } : f);
    expect(fingerprintObservations(missing)).not.toBe(fingerprintObservations(frames));
  });
  it("report the first divergent stage in pipeline order", () => {
    expect(firstDivergentStage({ schedule: "a", observations: "b", features: "c" }, { schedule: "a", observations: "b", features: "c" })).toBeNull();
    expect(firstDivergentStage({ schedule: "a", observations: "x", features: "y" }, { schedule: "a", observations: "b", features: "c" })).toBe("observations");
    expect(firstDivergentStage({ features: "c", logits: "d", output: "e" }, { schedule: "z", features: "c", logits: "d", output: "f" })).toBe("output");
  });
});

describe("deterministic offline replay", () => {
  it("rebuilds an identical capture from a local trace", () => {
    const original = syntheticCapture(0.002), trace = original.trace();
    const restored = FingerspellingCapture.fromTrace(JSON.parse(JSON.stringify(trace)));
    expect(restored.diagnostics().fingerprints).toEqual(original.diagnostics().fingerprints);
    const a = original.finish(), b = restored.finish();
    expect(fingerprintFloat32(b.features)).toBe(fingerprintFloat32(a.features));
    expect(b.frames).toBe(a.frames);
  });
  it("keeps fingerprints and traces out of the privacy-reviewed metrics export", () => {
    const quality = syntheticCapture().diagnostics();
    expect(quality.fingerprints.observations).toMatch(/^[0-9a-f]{16}$/);
    const exported = JSON.stringify(exportResearchMetrics([{ promptId: "anna", startedAt: 0, context: { device: "Windows", hand: "Right", light: "front-lit", speed: "usual" },
      quality, outcome: "candidate", prediction: "AB", truth: "AB", issue: "none", candidateShown: true, characters: 2, exact: true, edits: 0, inferenceMs: 1, finishToResultMs: 2 } as never], true, "0".repeat(64)));
    expect(exported).not.toContain(quality.fingerprints.observations);
    expect(exported).not.toContain("fingerprints");
  });
  it("replays the same trace through the installed model with identical stage fingerprints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "signrelay-trace-"));
    const session = await createSession();
    try {
      const path = join(dir, "trace.json");
      writeFileSync(path, JSON.stringify(syntheticCapture(0.002).trace()));
      const first = await replay(session, path), second = await replay(session, path);
      expect(first.fingerprints.logits).toMatch(/^[0-9a-f]{16}$/);
      expect(firstDivergentStage(first.fingerprints, second.fingerprints)).toBeNull();
      expect(second.status).toBe(first.status);
      expect(first).not.toHaveProperty("text");
      // A one-frame perturbation of the observations is localised to that stage.
      const trace = JSON.parse(JSON.stringify(syntheticCapture(0.002).trace()));
      trace.samples[4].hands[0].landmarks[8].x += 0.01;
      const changed = join(dir, "changed.json"); writeFileSync(changed, JSON.stringify(trace));
      expect(firstDivergentStage(first.fingerprints, (await replay(session, changed)).fingerprints)).toBe("observations");
    } finally { await session.release(); rmSync(dir, { recursive: true, force: true }); }
  }, 30000);
});
