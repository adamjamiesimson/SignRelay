import { describe, expect, it } from "vitest";
import { RehearsalScript, REHEARSAL, REHEARSAL_BANNER } from "../lib/rehearsal";
import { makeSign } from "./fixtures/asl-motion";

describe("automated rehearsal script", () => {
  it("is off outside the rehearsal profile and always labels itself", () => {
    expect(REHEARSAL).toBe(false);
    expect(REHEARSAL_BANNER).toMatch(/^AUTOMATED SOFTWARE REHEARSAL: synthetic hand landmarks, not a person signing/);
    expect(REHEARSAL_BANNER).toContain("not a recognition accuracy test");
  });
  it("replays each scripted frame once with source cadence through a browser stall", () => {
    const frames = makeSign("HELLO", { duration: 1000, count: 21 });
    const script = new RehearsalScript();
    expect(script.takeDue(5000)).toEqual([]);
    script.play(frames);
    const first = script.takeDue(5000);
    expect(first).toEqual([{ ...frames[0], timestamp: 5000 }]);
    expect(script.takeDue(5020)).toEqual([]);
    const stalled = script.takeDue(5250);
    expect(stalled.map(frame => frame.timestamp)).toEqual([5050, 5100, 5150, 5200, 5250]);
    const delayed = script.takeDue(6000);
    expect(delayed).toHaveLength(8);
    const remaining = script.takeDue(6050);
    expect([...first, ...stalled, ...delayed, ...remaining]).toEqual(
      frames.map(frame => ({ ...frame, timestamp: frame.timestamp + 4000 })));
    expect(script.playing).toBe(false);
    expect(script.takeDue(6050)).toEqual([]);
  });
});
