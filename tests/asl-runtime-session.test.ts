import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

afterEach(() => vi.unstubAllGlobals());

it("continues handling events while the real ASL model computes a prediction", async () => {
  vi.resetModules();
  vi.stubGlobal("self", { DecompressionStream });
  vi.stubGlobal("fetch", async (url: string) => new Response(await readFile(`public${url}`)));
  const { recognizeAsl1000 } = await import("../lib/asl1000-runtime");
  const frames = makeSign("NO");
  // Warm the real model first, so download/decompression cannot satisfy the
  // responsiveness check. No classifier or neural arithmetic is mocked.
  const first = await recognizeAsl1000(frames);
  let handledEvents = 0;
  const timer = setInterval(() => handledEvents++, 0);
  try {
    expect(await recognizeAsl1000(frames)).toEqual(first);
    expect(handledEvents).toBeGreaterThan(1);
  } finally {
    clearInterval(timer);
  }
});
