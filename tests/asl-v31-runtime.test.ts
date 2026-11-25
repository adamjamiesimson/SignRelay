import { afterEach, describe, expect, it, vi } from "vitest";
import { ASL_V31_ASSET_PATH, ASL_V31_POLICY } from "../lib/asl-v31-assets.mjs";
import { N_POINTS } from "../engine-v3/web/preprocess.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("V3.1 model input and asset checks", () => {
  it("rejects corrupt assets and allows the verified load to be retried", async () => {
    const fetch = vi.fn(async (url: string) => new Response(`corrupted asset at ${url}`));
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    const { warmAslV31Model } = await import("../lib/asl-v31-runtime");
    await expect(warmAslV31Model()).rejects.toThrow("failed integrity verification");
    await expect(warmAslV31Model()).rejects.toThrow("failed integrity verification");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${ASL_V31_ASSET_PATH}/model.onnx`, `${ASL_V31_ASSET_PATH}/meta.json`, `${ASL_V31_ASSET_PATH}/policy-${ASL_V31_POLICY}.json`,
      `${ASL_V31_ASSET_PATH}/model.onnx`, `${ASL_V31_ASSET_PATH}/meta.json`, `${ASL_V31_ASSET_PATH}/policy-${ASL_V31_POLICY}.json`,
    ]);
  });

  it("never calls the model for a segment with no observed hand", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    const { recognizeAslV31 } = await import("../lib/asl-v31-runtime");
    const blank = new Float32Array(N_POINTS * 3).fill(NaN);
    expect(await recognizeAslV31(Array.from({ length: 12 }, () => blank), {})).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
