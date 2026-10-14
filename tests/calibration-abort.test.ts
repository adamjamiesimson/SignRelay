import { afterEach, expect, it, vi } from "vitest";
import { clearCalibrationTemplates } from "../lib/calibration-storage";
afterEach(() => vi.unstubAllGlobals());
it("closes IndexedDB and rejects an aborted transaction instead of leaving deletion pending", async () => {
  const close = vi.fn();
  const transaction = { error: null, oncomplete: null as null | (() => void), onerror: null as null | (() => void),
    onabort: null as null | (() => void), objectStore: () => ({ clear() {} }) };
  const database = { close, transaction: () => {
    queueMicrotask(() => transaction.onabort?.()); return transaction;
  } };
  const request = { result: database, onsuccess: null as null | (() => void), onerror: null };
  vi.stubGlobal("indexedDB", { open: () => { queueMicrotask(() => request.onsuccess?.()); return request; } });
  await expect(clearCalibrationTemplates()).rejects.toThrow("interrupted");
  expect(close).toHaveBeenCalledOnce();
});
