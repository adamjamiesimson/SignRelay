import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAsl2000, hasHandEvidence, runPackedTgcn, type TgcnManifest } from "../lib/asl1000-runtime";
import type { VisionFrame } from "../lib/vision-types";
import { makeSign } from "./fixtures/asl-motion";

afterEach(() => vi.unstubAllGlobals());

const window = (handFrames: number, distinct = true) => {
  const values = new Float32Array(55 * 100).fill(-1);
  for (let frame = 0; frame < handFrames; frame++) {
    for (let node = 34; node < 55; node++) values[node * 100 + frame * 2] = distinct ? 0.1 + frame * 0.01 : 0.1;
  }
  return values;
};

describe("ASL-2000 evidence guard", () => {
  it("shows why confidence cannot reject a window with no hands", () => {
    const root = "public/models/asl2000-tgcn";
    const manifest = JSON.parse(readFileSync(`${root}/model.json`, "utf8")) as TgcnManifest;
    const labels = JSON.parse(readFileSync(`${root}/labels.json`, "utf8")) as string[];
    const bytes = gunzipSync(Buffer.concat(manifest.binaryParts.map(name => readFileSync(`${root}/${name}`))));
    const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decision = decideAsl2000(runPackedTgcn(manifest, binary, labels, new Float32Array(55 * 100).fill(-1)), labels);
    // The production confidence/margin gate accepts pure absence of evidence.
    expect(decision).toMatchObject({ label: "WOLF", accepted: true });
    expect(hasHandEvidence(new Float32Array(55 * 100).fill(-1))).toBe(false);
  }, 30000);

  it("counts distinct observed hand frames, not padding repeats of the final frame", () => {
    expect(hasHandEvidence(window(5))).toBe(false);
    expect(hasHandEvidence(window(6))).toBe(true);
    expect(hasHandEvidence(window(40, false))).toBe(false);
  });

  it("never classifies a movement window in which no hand was observed", async () => {
    vi.resetModules();
    vi.stubGlobal("self", { DecompressionStream });
    vi.stubGlobal("fetch", async (url: string) => new Response(await readFile(`public${url}`)));
    const { recognizeAsl1000 } = await import("../lib/asl1000-runtime");
    const handless: VisionFrame[] = makeSign("HELLO").map(frame => ({ ...frame, hands: [] }));
    expect(await recognizeAsl1000(handless)).toBeNull();
  }, 30000);
});
