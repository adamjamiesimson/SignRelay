import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runPackedTgcn, type TgcnManifest } from "../lib/asl1000-runtime";

describe("ASL-1000 packed runtime", () => {
  it("reproduces the Python exporter's deterministic top prediction", () => {
    const manifest = JSON.parse(readFileSync("public/models/asl1000-tgcn/model.json", "utf8")) as TgcnManifest;
    const labels = JSON.parse(readFileSync("public/models/asl1000-tgcn/labels.json", "utf8")) as string[];
    const decompressed = gunzipSync(readFileSync("public/models/asl1000-tgcn/model.bin.gz"));
    const binary = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
    const input = Float32Array.from({ length: 55 * 100 }, (_, index) => ((index * 37) % 101 - 50) / 100);
    const logits = runPackedTgcn(manifest, binary, labels, input);
    const winner = logits.reduce((best, value, index) => value > logits[best] ? index : best, 0);

    expect(logits).toHaveLength(1000);
    expect(labels[winner]).toBe("BALD");
    expect(logits[winner]).toBeCloseTo(26.4165, 1);
  });
});
