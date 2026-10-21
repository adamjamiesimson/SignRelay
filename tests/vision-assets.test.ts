import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { installModels } from "../scripts/install-vision-assets.mjs";
import { VISION_ASSET_SOURCES, VISION_MODELS } from "../lib/vision-runtime.mjs";

describe("self-hosted MediaPipe assets", () => {
  it("pins every model by size and SHA-256 to its exact versioned public URL", () => {
    for (const model of Object.values(VISION_MODELS)) {
      expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(model.bytes).toBeGreaterThan(1_000_000);
      expect(model.url).toMatch(/^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.+\/float16\/1\//);
      expect(model.url.endsWith(`/${model.file}`)).toBe(true);
    }
  });
  it("tries the self-hosted copy before the CDN for WASM and every model", () => {
    expect(VISION_ASSET_SOURCES.map(source => source.id)).toEqual(["self-hosted", "cdn"]);
    expect(Object.values(VISION_ASSET_SOURCES[0].models).every(path => path.startsWith("/vision/models/"))).toBe(true);
  });
  it("refuses a download whose bytes differ from the pin and leaves nothing behind", async () => {
    const directory = mkdtempSync(join(tmpdir(), "signrelay-vision-"));
    const tampered = async () => new Response(new Uint8Array(1024));
    await expect(installModels(tampered, pathToFileURL(directory + "/"))).rejects.toThrow("differs from the pinned model");
    expect(readdirSync(directory)).toEqual([]);
  });
});
