import { afterEach, expect, it, vi } from "vitest";
import { deleteCalibrationGloss, loadCalibrationTemplates, saveCalibrationTemplate } from "../lib/calibration-storage";
import type { CalibrationTemplate } from "../lib/vision-types";

// Minimal in-memory IndexedDB. Transactions run strictly one after another,
// which is a schedule real IndexedDB may legally choose (overlapping readwrite
// scopes are always serialised; readonly ones may also run in order). Each
// request completes asynchronously, as in a browser.
function installFakeIndexedDB() {
  const rows = new Map<string, unknown>();
  let turn = Promise.resolve();
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction() {
      const ops: Array<() => void> = [];
      const transaction = {
        error: null, oncomplete: null as null | (() => void),
        onerror: null as null | (() => void), onabort: null as null | (() => void),
        objectStore: () => ({
          getAll: () => request(() => [...rows.values()].map(value => structuredClone(value))),
          put: (value: CalibrationTemplate) => request(() => { rows.set(value.id, structuredClone(value)); }),
          delete: (id: string) => request(() => { rows.delete(id); }),
          clear: () => request(() => rows.clear()),
        }),
      };
      const request = (operation: () => unknown) => {
        const handle = { result: undefined as unknown, onsuccess: null as null | (() => void), onerror: null };
        ops.push(() => { handle.result = operation(); handle.onsuccess?.(); });
        return handle;
      };
      const previous = turn;
      turn = previous.then(async () => {
        while (ops.length) {
          await new Promise(resolve => setTimeout(resolve, 0));
          ops.shift()!();
        }
        transaction.oncomplete?.();
      });
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", { open: () => {
    const handle = { result: database, onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null };
    queueMicrotask(() => handle.onsuccess?.());
    return handle;
  } });
  return rows;
}

const row = () => new Array(240).fill(0.1);
const example = (id: string, gloss: string, createdAt: number, language: CalibrationTemplate["language"] = "bsl"): CalibrationTemplate =>
  ({ id, gloss, text: gloss, language, createdAt, frames: Array.from({ length: 24 }, row) });

afterEach(() => vi.unstubAllGlobals());

it("keeps at most three examples per word when two saves of that word overlap", async () => {
  const rows = installFakeIndexedDB();
  await saveCalibrationTemplate(example("a", "PIZZA", 1));
  await saveCalibrationTemplate(example("b", "PIZZA", 2));
  // Two saves started together (a double click, or two tabs).
  await Promise.all([saveCalibrationTemplate(example("c", "PIZZA", 3)), saveCalibrationTemplate(example("d", "PIZZA", 4))]);
  expect([...rows.keys()].sort()).toEqual(["b", "c", "d"]);
  expect((await loadCalibrationTemplates()).map(item => item.id)).toEqual(["d", "c", "b"]);
});

it("prunes only the same word in the same language", async () => {
  const rows = installFakeIndexedDB();
  for (const [id, createdAt] of [["x1", 1], ["x2", 2], ["x3", 3]] as const) await saveCalibrationTemplate(example(id, "PIZZA", createdAt, "asl"));
  await Promise.all([
    saveCalibrationTemplate(example("b1", "PIZZA", 4)),
    saveCalibrationTemplate(example("o1", "OTHER", 5)),
    saveCalibrationTemplate(example("x4", "PIZZA", 6, "asl")),
  ]);
  expect([...rows.keys()].sort()).toEqual(["b1", "o1", "x2", "x3", "x4"]);
});

it("removing a word deletes every example stored for it, including one saved just before", async () => {
  const rows = installFakeIndexedDB();
  await saveCalibrationTemplate(example("a", "PIZZA", 1));
  const save = saveCalibrationTemplate(example("b", "PIZZA", 2));
  const remove = deleteCalibrationGloss("PIZZA", "bsl");
  await Promise.all([save, remove]);
  expect([...rows.keys()]).toEqual([]);
});
