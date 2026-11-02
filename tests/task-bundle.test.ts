import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { storedZipEntry } from "../lib/task-bundle";
import { VISION_MODELS } from "../lib/vision-runtime.mjs";

/** Minimal zip writer for tests: entries are [name, bytes, method]. */
function zip(entries: [string, Uint8Array, number?][], prefix = 0) {
  const parts: number[] = Array(prefix).fill(0), central: number[] = [];
  const le = (value: number, size: number) => Array.from({ length: size }, (_, i) => (value >>> (8 * i)) & 255);
  for (const [name, data, method = 0] of entries) {
    const n = [...new TextEncoder().encode(name)], offset = parts.length - prefix;
    parts.push(...le(0x04034b50, 4), ...le(20, 2), 0, 0, ...le(method, 2), 0, 0, 0, 0, ...le(0, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(n.length, 2), 0, 0, ...n, ...data);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), 0, 0, ...le(method, 2), 0, 0, 0, 0, ...le(0, 4), ...le(data.length, 4), ...le(data.length, 4),
      ...le(n.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(offset, 4), ...n);
  }
  const cdOffset = parts.length - prefix;
  return Uint8Array.from([...parts, ...central, ...le(0x06054b50, 4), 0, 0, 0, 0, ...le(entries.length, 2), ...le(entries.length, 2), ...le(central.length, 4), ...le(cdOffset, 4), 0, 0]);
}
const bytes = (...v: number[]) => Uint8Array.from(v);

describe("stored task-bundle entries", () => {
  it("returns exactly the stored entry, following the central directory", () => {
    const bundle = zip([["a.task", bytes(1, 2, 3)], ["hand_landmarker.task", bytes(9, 8, 7, 6)]]);
    expect([...storedZipEntry(bundle, "hand_landmarker.task")]).toEqual([9, 8, 7, 6]);
    expect([...storedZipEntry(bundle, "a.task")]).toEqual([1, 2, 3]);
  });
  it("handles bytes prepended before the archive (as in the pinned MediaPipe bundle)", () => {
    expect([...storedZipEntry(zip([["x", bytes(5, 5)]], 2), "x")]).toEqual([5, 5]);
  });
  it("rejects missing, compressed, duplicate and truncated entries", () => {
    expect(() => storedZipEntry(zip([["x", bytes(1)]]), "y")).toThrow(/no y/);
    expect(() => storedZipEntry(zip([["x", bytes(1)], ["x", bytes(2)]]), "x")).toThrow(/duplicate/);
    expect(() => storedZipEntry(zip([["x", bytes(1)]]).map((v, i, a) => i === a.length - 22 ? 0 : v), "x")).toThrow(/no zip directory/);
    const compressed = zip([["x", bytes(1, 2)]]);
    // Central-directory method field of the only entry: deflate.
    const cd = compressed.length - 22 - (46 + 1);
    compressed[cd + 10] = 8;
    expect(() => storedZipEntry(compressed, "x")).toThrow(/stored uncompressed/);
    expect(() => storedZipEntry(zip([["x", bytes(1, 2, 3)]]).subarray(0, 0), "x")).toThrow();
  });
  const installed = "public/vision/models/gesture_recognizer.task";
  it.runIf(existsSync(installed))("extracts the pinned hand_landmarker.task from the installed, verified gesture bundle", () => {
    const bundle = readFileSync(installed);
    expect(createHash("sha256").update(bundle).digest("hex")).toBe(VISION_MODELS.gesture.sha256);
    const inner = storedZipEntry(bundle, "hand_landmarker.task");
    expect(inner.length).toBe(VISION_MODELS.gesture.handLandmarker.bytes);
    expect(createHash("sha256").update(inner).digest("hex")).toBe(VISION_MODELS.gesture.handLandmarker.sha256);
  });
});
