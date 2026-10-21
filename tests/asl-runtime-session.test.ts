import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

afterEach(() => vi.unstubAllGlobals());
// Both tests run the real model (no arithmetic mocked): about 2 s alone, but
// 4–5 s while the rest of the suite runs in parallel, so the 5 s default is
// too tight. The assertions are unchanged.
const REAL_MODEL_TIMEOUT_MS = 30000;

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
}, REAL_MODEL_TIMEOUT_MS);

it("cancels real ASL arithmetic at a yield and reuses the exact cached weights", async () => {
  vi.resetModules();
  vi.stubGlobal("self", { DecompressionStream });
  vi.stubGlobal("fetch", async (url: string) => new Response(await readFile(`public${url}`)));
  const { recognizeAsl1000 } = await import("../lib/asl1000-runtime");
  const frames = makeSign("NO");
  const first = await recognizeAsl1000(frames);
  const controller = new AbortController();
  const pending = recognizeAsl1000(frames, { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 0);
  try { await expect(pending).rejects.toMatchObject({ name: "AbortError" }); }
  finally { clearTimeout(timer); }
  expect(await recognizeAsl1000(frames)).toEqual(first);
}, REAL_MODEL_TIMEOUT_MS);
