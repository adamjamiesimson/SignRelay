import { describe, expect, it } from "vitest";
import { InterSignGate } from "../lib/inter-sign-gate";

describe("inter-sign rearm gate", () => {
  it("starts armed and locks after a confirmed sign", () => {
    const gate = new InterSignGate(260);
    expect(gate.armed).toBe(true);
    gate.lock();
    expect(gate.armed).toBe(false);
    expect(gate.update(1000, "ready")).toBe(false);
  });

  it("requires a continuous quiet period before another sign can be accepted", () => {
    const gate = new InterSignGate(260);
    gate.lock();

    expect(gate.update(1000, "idle")).toBe(false);
    expect(gate.update(1180, "idle")).toBe(false);
    expect(gate.update(1260, "idle")).toBe(true);
    expect(gate.armed).toBe(true);
  });

  it("resets the quiet timer when movement resumes", () => {
    const gate = new InterSignGate(260);
    gate.lock();

    expect(gate.update(1000, "idle")).toBe(false);
    expect(gate.update(1200, "moving")).toBe(false);
    expect(gate.update(1400, "idle")).toBe(false);
    expect(gate.update(1659, "idle")).toBe(false);
    expect(gate.update(1660, "idle")).toBe(true);
  });

  it("allows hands leaving frame to provide the separator without accepting stale output", () => {
    const gate = new InterSignGate(260);
    gate.lock();

    expect(gate.update(2000, "hands")).toBe(false);
    expect(gate.update(2260, "hands")).toBe(true);
  });

  it("reset immediately arms a new recognition session", () => {
    const gate = new InterSignGate(260);
    gate.lock();
    gate.update(1000, "idle");
    gate.reset();
    expect(gate.armed).toBe(true);
    expect(gate.update(1001, "ready")).toBe(true);
  });
});
