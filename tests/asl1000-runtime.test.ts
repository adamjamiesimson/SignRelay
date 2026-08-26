import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { runPackedTgcn, type TgcnManifest } from "../lib/asl1000-runtime";

describe("ASL-1000 packed runtime", () => {
  it("ships an executable browser worker instead of raw TypeScript", () => {
    const component = readFileSync("components/translator-experience.tsx", "utf8");
    const worker = readFileSync("public/workers/recognition.worker.js", "utf8");

    expect(component).toContain('new Worker("/workers/recognition.worker.js"');
    expect(worker).toContain("binaryParts");
    expect(worker).not.toContain("import type");
    expect(worker).not.toContain('from "@/');
  });

  it("reproduces the Python exporter's deterministic top prediction", () => {
    const manifest = JSON.parse(readFileSync("public/models/asl1000-tgcn/model.json", "utf8")) as TgcnManifest;
    const labels = JSON.parse(readFileSync("public/models/asl1000-tgcn/labels.json", "utf8")) as string[];
    const compressed = Buffer.concat(manifest.binaryParts.map((name) =>
      readFileSync(`public/models/asl1000-tgcn/${name}`)
    ));
    expect(compressed).toHaveLength(manifest.compressedBytes);
    const decompressed = gunzipSync(compressed);
    expect(decompressed).toHaveLength(manifest.binaryBytes);
    const binary = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
    const input = Float32Array.from({ length: 55 * 100 }, (_, index) => ((index * 37) % 101 - 50) / 100);
    const logits = runPackedTgcn(manifest, binary, labels, input);
    const winner = logits.reduce((best, value, index) => value > logits[best] ? index : best, 0);

    expect(logits).toHaveLength(1000);
    expect(labels[winner]).toBe("BALD");
    expect(logits[winner]).toBeCloseTo(26.4165, 1);
  });
});
