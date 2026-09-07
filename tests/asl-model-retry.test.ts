import { afterEach, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

afterEach(() => vi.unstubAllGlobals());
it("retries an ASL model download after a transient rejection", async () => {
  vi.resetModules();
  const fetch = vi.fn().mockRejectedValue(new Error("Network unavailable"));
  vi.stubGlobal("fetch", fetch);
  const { recognizeAsl1000 } = await import("../lib/asl1000-runtime");
  await expect(recognizeAsl1000(makeSign("NO"))).rejects.toThrow("Network unavailable");
  const firstAttempt = fetch.mock.calls.length;
  await expect(recognizeAsl1000(makeSign("NO"))).rejects.toThrow("Network unavailable");
  expect(fetch.mock.calls.length).toBe(firstAttempt * 2);
});
