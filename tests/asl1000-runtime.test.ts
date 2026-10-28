import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prepareTgcnInput, runPackedTgcn, type TgcnManifest } from "../lib/asl1000-runtime";
import { makeSign } from "./fixtures/asl-motion";

describe("ASL-2000 packed runtime", () => {
  it("ships an executable browser worker instead of raw TypeScript", () => {
    const component = readFileSync("components/translator-experience.tsx", "utf8");
    const worker = readFileSync("public/workers/recognition.worker.js", "utf8");

    expect(component).toMatch(/new Worker\("\/workers\/recognition\.worker\.js\?v=[a-z0-9-]+"/);
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

  it("keeps every float32 logit bit-identical to the pre-optimisation graph computation", () => {
    // SHA-256 of the raw float32 logits produced by the straightforward
    // per-element accumulation at fc95a6f, before the blocked loops. Any
    // change to rounding order, weights or tensor mapping changes these.
    const expected: Record<string, string> = {
      synthetic: "11f68ca4f9881b276b0968acf45c02ab3677cc42db1fb82ff6363093ecbaaf61",
      HELLO: "d6d46b79444ebb9d85e2445e184e5e51d5206ff1c2f7a820f378e319b78c1fca",
      "THANK YOU": "80c1ca14d6fcd8a39e87aa27d457bd2f2b49d7905445386e3af9652690b01fd5",
      PLEASE: "7ffcf06bf32a0e84710a3a1e04c0195e56e3ab67b1d06d2bb19951167c1af866",
      SORRY: "610901e8ee7303d2213c5643d2f632bda39c76bc3a466a384440cf800dd96252",
      YES: "d51af654d4944bad1625dcc6bc9d028586ac3b8a3e3dc348d45d8804adbd3dcf",
      NO: "207a86a28093541c755284324392a10440d22cf5cf8fb506f9be52d687a9695f",
    };
    const manifest = JSON.parse(readFileSync("public/models/asl2000-tgcn/model.json", "utf8")) as TgcnManifest;
    const labels = JSON.parse(readFileSync("public/models/asl2000-tgcn/labels.json", "utf8")) as string[];
    const decompressed = gunzipSync(Buffer.concat(manifest.binaryParts.map((name) =>
      readFileSync(`public/models/asl2000-tgcn/${name}`))));
    const binary = decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength);
    const inputs: Record<string, Float32Array> = {
      synthetic: Float32Array.from({ length: 55 * 100 }, (_, index) => ((index * 37) % 101 - 50) / 100),
    };
    for (const gloss of ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"] as const) {
      inputs[gloss] = prepareTgcnInput(makeSign(gloss), manifest.sequenceLength);
    }
    const actual = Object.fromEntries(Object.entries(inputs).map(([name, input]) => {
      const logits = runPackedTgcn(manifest, binary, labels, input);
      return [name, createHash("sha256").update(new Uint8Array(logits.buffer)).digest("hex")];
    }));

    expect(actual).toEqual(expected);
  });
});
