// Regression coverage for a bug found while auditing the shared-model
// recognizers: loadTemplates cached the fetch promise in templatesPromise
// without ever resetting it on failure (unlike landmark-model-loader.ts and
// asl1000-runtime.ts's loadModel, which both explicitly reset on error to
// allow retries). A single transient network failure permanently broke PSL
// recognition for the rest of the page session.
import { afterEach, expect, it, vi } from "vitest";
import { makeSign } from "./fixtures/asl-motion";

afterEach(() => vi.unstubAllGlobals());

it("retries a PSL template bundle download after a transient rejection", async () => {
  vi.resetModules();
  const fetch = vi.fn().mockRejectedValue(new Error("Network unavailable"));
  vi.stubGlobal("fetch", fetch);
  const { recognizePsl776 } = await import("../lib/psl776-runtime");
  await expect(recognizePsl776(makeSign("NO"))).rejects.toThrow("Network unavailable");
  const firstAttempt = fetch.mock.calls.length;
  await expect(recognizePsl776(makeSign("NO"))).rejects.toThrow("Network unavailable");
  expect(fetch.mock.calls.length).toBe(firstAttempt * 2);
});
