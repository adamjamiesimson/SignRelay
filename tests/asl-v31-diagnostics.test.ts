import { describe, expect, it } from "vitest";
import { aslV31Hint, describeDecision, emptyAslV31Diagnostics, formatAslV31Diagnostics } from "../lib/asl-v31-diagnostics";

const policy = { max_unknown: 0.3, min_top1: 0.847, min_margin: null, min_proto: 0.812, min_hand_frames: 3 };
const top5 = [{ label: "PLEASE", p: 0.9 }, { label: "SORRY", p: 0.05 }, { label: "MINE", p: 0.02 }, { label: "A", p: 0.01 }, { label: "B", p: 0.01 }];
const scores = (p_top1: number, p_unknown: number, proto_cos: number | null) => ({ p_top1, margin: 0.8, p_unknown, proto_cos });
const ui = { received: 0, ignored: 0, shown: 0, added: 0, spoken: 0 };

describe("V3.1 developer diagnostics", () => {
  it("explains each Strict rejection with the threshold that failed", () => {
    expect(describeDecision({ status: "unknown", best: "PLEASE", top5, scores: scores(0.9, 0.45, 0.9) }, policy, 8).reason)
      .toBe("looks like an unsupported sign (unknown score 0.45 ≥ 0.30)");
    expect(describeDecision({ status: "uncertain", best: "PLEASE", top5, scores: scores(0.62, 0, 0.9) }, policy, 8).reason)
      .toBe("not confident (top score 0.62 < 0.85)");
    expect(describeDecision({ status: "unknown", best: "PLEASE", top5, scores: scores(0.95, 0, 0.74) }, policy, 8).reason)
      .toBe("unlike training examples of PLEASE (similarity 0.74 < 0.81)");
    const accepted = describeDecision({ status: "accepted", best: "PLEASE", top5, scores: scores(0.95, 0, 0.9) }, policy, 8);
    expect(accepted).toMatchObject({ status: "accepted", reason: "", top3: top5.slice(0, 3) });
    expect(describeDecision({ status: "accepted", best: "PLEASE", top5, scores: scores(0.95, 0, 0.9) }, policy, 2))
      .toMatchObject({ status: "too-few-hands", reason: "only 2 hand frames in the sign (needs 3)" });
  });

  it("names the first stage that is not working", () => {
    const d = emptyAslV31Diagnostics();
    expect(aslV31Hint(d, ui, 0)).toMatch(/No camera frames/);
    Object.assign(d, { observations: 50 });
    expect(aslV31Hint(d, ui, 50)).toMatch(/No hands detected/);
    Object.assign(d, { handFrames: 30, shoulderFrames: 50 });
    expect(aslV31Hint(d, ui, 50)).toMatch(/No sign started/);
    Object.assign(d, { segmentsOpened: 2, segmentsCapped: 2 });
    expect(aslV31Hint(d, ui, 50)).toMatch(/Signs run together/);
    Object.assign(d, { segmentsCompleted: 3, model: "ready", inferences: 3, decisions: { accepted: 0, uncertain: 3, unknown: 0, "too-few-hands": 0 },
      lastDecision: { status: "uncertain", best: "PLEASE", top3: [], pTop1: 0.6, pUnknown: 0, proto: 0.7, handFrames: 9, reason: "not confident (top score 0.60 < 0.85)", ageMs: 0 } });
    expect(aslV31Hint(d, ui, 50)).toBe("The model ran 3× but Strict rejected every sign. Last: not confident (top score 0.60 < 0.85).");
    Object.assign(d, { decisions: { ...d.decisions, accepted: 1 }, suggestionsPosted: 1 });
    expect(aslV31Hint(d, { ...ui, received: 1, shown: 1 }, 50)).toMatch(/Add to transcript/);
    expect(aslV31Hint({ ...d, model: "failed", modelError: "fingerprint mismatch" }, ui, 50)).toMatch(/fingerprint mismatch/);
  });

  it("formats readable lines without landmark data", () => {
    const lines = formatAslV31Diagnostics(emptyAslV31Diagnostics(), ui, 0, "CPU + pose helper");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toContain("CPU + pose helper");
    expect(lines.at(-1)).toMatch(/^Next step: /);
  });
});
