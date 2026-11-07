import { afterEach, expect, it, vi } from "vitest";
import { loadCalibrationTemplates } from "../lib/calibration-storage";

afterEach(() => vi.unstubAllGlobals());

it("closes IndexedDB when a readonly list operation throws synchronously", async () => {
  const problem = new DOMException("Read unavailable", "UnknownError");
  const close = vi.fn();
  const request = {
    onsuccess: () => {},
    result: {
      close,
      transaction: () => ({
        objectStore: () => ({ getAll: () => { throw problem; } }),
      }),
    },
  };
  vi.stubGlobal("indexedDB", { open: () => { queueMicrotask(() => request.onsuccess()); return request; } });

  await expect(loadCalibrationTemplates()).rejects.toBe(problem);
  expect(close).toHaveBeenCalledOnce();
});
