import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../lib/browser-storage";
import { transcriptDocument, transcriptText, updateTranscript } from "../lib/transcript-session";

const hello: TranscriptEntry = { id: "hello", text: "Hello", gloss: "HELLO", confidence: 0.9, timestamp: 1700000000000 };
const hola: TranscriptEntry = { ...hello, id: "hola", text: "Hola", gloss: "HOLA" };

describe("language-specific transcript drafts", () => {
  it("keeps language switches, edits and clears isolated without losing earlier words", () => {
    let drafts = updateTranscript({}, "asl", () => [hello]);
    drafts = updateTranscript(drafts, "lse", () => [hola]);
    expect(drafts.asl?.entries).toEqual([hello]);
    expect(drafts.lse?.entries).toEqual([hola]);
    expect(drafts.asl?.id).not.toBe(drafts.lse?.id);
    const id = drafts.asl!.id;
    drafts = updateTranscript(drafts, "asl", entries => entries.map(entry => ({ ...entry, text: "Hello there" })));
    expect(drafts.asl?.id).toBe(id);
    expect(drafts.lse?.entries).toEqual([hola]);
    drafts = updateTranscript(drafts, "asl", () => []);
    expect(drafts.asl).toBeUndefined();
    expect(drafts.lse?.entries).toEqual([hola]);
  });

  it("exports corrected text, original language and wall-clock timestamps", () => {
    const session = updateTranscript({}, "lse", () => [hola]).lse!;
    expect(transcriptText(session)).toBe("Hola");
    expect(transcriptDocument(session)).toContain("Spanish Sign Language");
    expect(transcriptDocument(session)).toContain("[2023-11-14T22:13:20.000Z] Hola");
    expect(transcriptDocument(session)).toContain("Research preview");
  });
});
