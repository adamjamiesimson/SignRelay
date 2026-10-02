import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { resampleTgcnTimeline, runPackedTgcn, tgcnTemporalFrameIndices, type TgcnManifest } from "../lib/asl1000-runtime";

describe("ASL-2000 packed runtime", () => {

  it("matches the official WLASL short-sequence padding convention", () => {
    const views = tgcnTemporalFrameIndices(3, 5);
    expect(views).toEqual([[0, 1, 2, 2, 2]]);
  });

  it("matches the official WLASL four-view temporal crops", () => {
    const views = tgcnTemporalFrameIndices(80, 50);
    expect(views).toHaveLength(4);
    expect(views.map(view => view[0])).toEqual([0, 10, 20, 30]);
    expect(views.map(view => view.at(-1))).toEqual([49, 59, 69, 79]);

    const long = tgcnTemporalFrameIndices(220, 50);
    expect(long.map(view => view[0])).toEqual([9, 59, 109, 159]);
    expect(long.map(view => view.at(-1))).toEqual([58, 108, 158, 208]);
  });

  it("reconstructs sparse live frames using elapsed time instead of fixed sample count", () => {
    const frame = (timestamp: number) => ({ timestamp, hands: [], face: [], pose: [] });
    const sampled = resampleTgcnTimeline([frame(0), frame(500), frame(1000)], 25);
    expect(sampled).toHaveLength(26);
    expect(sampled[0].timestamp).toBe(0);
    expect(sampled.at(-1)?.timestamp).toBe(1000);
    expect(sampled.filter(item => item.timestamp === 500).length).toBeGreaterThan(1);
  });
  it("ships an executable browser worker instead of raw TypeScript", () => {
    const component = readFileSync("components/translator-experience.tsx", "utf8");
    const worker = readFileSync("public/workers/recognition.worker.js", "utf8");

    expect(component).toContain('new Worker("/workers/recognition.worker.js?v=fist-motion-2"');
    expect(worker).toContain("binaryParts");
    expect(worker).toContain("frameId");
    expect(worker).not.toContain("import type");
    expect(worker).not.toContain('from "@/');
  });

  it("executes the packed model on synthetic input with a finite output (not sign accuracy)", () => {
    const manifest = JSON.parse(readFileSync("public/models/asl2000-tgcn/model.json", "utf8")) as TgcnManifest;
    const labels = JSON.parse(readFileSync("public/models/asl2000-tgcn/labels.json", "utf8")) as string[];
    const compressed = Buffer.concat(manifest.binaryParts.map((name) =>
      readFileSync(`public/models/asl2000-tgcn/${name}`)
    ));
    expect(compressed).toHaveLength(manifest.compressedBytes);
    const decompressed = gunzipSync(compressed);
    expect(decompressed).toHaveLength(manifest.binaryBytes);
    const binary = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
    const input = Float32Array.from({ length: 55 * 100 }, (_, index) => ((index * 37) % 101 - 50) / 100);
    const logits = runPackedTgcn(manifest, binary, labels, input);
    const winner = logits.reduce((best, value, index) => value > logits[best] ? index : best, 0);

    expect(manifest.classes).toBe(2000);
    expect(logits).toHaveLength(2000);
    expect(labels[winner]).toMatch(/^[A-Z0-9' -]+$/);
    expect(Number.isFinite(logits[winner])).toBe(true);
  });
});
