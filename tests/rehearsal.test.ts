import { describe, expect, it } from "vitest";
import { RehearsalScript, REHEARSAL, REHEARSAL_BANNER } from "../lib/rehearsal";
import { makeSign } from "./fixtures/asl-motion";

describe("automated rehearsal script", () => {
  it("is off outside the rehearsal profile and always labels itself", () => {
    expect(REHEARSAL).toBe(false);
    expect(REHEARSAL_BANNER).toMatch(/^AUTOMATED SOFTWARE REHEARSAL: synthetic hand landmarks, not a person signing/);
    expect(REHEARSAL_BANNER).toContain("not a recognition accuracy test");
  });
  it("replays scripted frames against the live clock, holding a frame until the next is due", () => {
    const frames = makeSign("HELLO", { duration: 1000, count: 21 });
    const script = new RehearsalScript();
    expect(script.next(5000)).toBeNull();
    script.play(frames);
    const first = script.next(5000)!;
    expect(first.timestamp).toBe(5000);
    expect(first.hands).toEqual(frames[0].hands);
    expect(script.next(5020)!.hands).toEqual(frames[0].hands);
    expect(script.next(5100)!.hands).toEqual(frames[2].hands);
    expect(script.next(6000)!.hands).toEqual(frames.at(-1)!.hands);
    expect(script.playing).toBe(false);
    expect(script.next(6050)).toBeNull();
  });
});
