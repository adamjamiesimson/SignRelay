import { afterEach, expect, it, vi } from "vitest";
import { clearCalibrationTemplates, deleteCalibrationGloss, loadCalibrationTemplates, saveCalibrationTemplate, saveCalibrationTemplateAndReload } from "../lib/calibration-storage";
import type { CalibrationTemplate } from "../lib/vision-types";

// Minimal in-memory IndexedDB. Transactions run strictly one after another,
// which is a schedule real IndexedDB may legally choose (overlapping readwrite
// scopes are always serialised; readonly ones may also run in order). Each
// request completes asynchronously, as in a browser.
function installFakeIndexedDB({ failListReads = (): boolean => false } = {}) {
  const rows = new Map<string, unknown>();
  let turn = Promise.resolve();
  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(_store: string, mode: "readonly" | "readwrite" = "readonly") {
      const ops: Array<() => void> = [];
      const transaction = {
        error: null, oncomplete: null as null | (() => void),
        onerror: null as null | (() => void), onabort: null as null | (() => void),
        objectStore: () => ({
          getAll: () => {
            if (mode === "readonly" && failListReads()) throw new DOMException("Injected read failure", "UnknownError");
            return request(() => [...rows.values()].map(value => structuredClone(value)));
          },
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

it("reports a committed save whose list reload failed as saved, not as lost", async () => {
  let failReads = false;
  const rows = installFakeIndexedDB({ failListReads: () => failReads });
  await expect(saveCalibrationTemplateAndReload(example("a", "PIZZA", 1))).resolves.toMatchObject({ templates: [{ id: "a" }] });
  failReads = true;
  await expect(saveCalibrationTemplateAndReload(example("b", "PIZZA", 2))).resolves.toEqual({ templates: null });
  expect([...rows.keys()].sort()).toEqual(["a", "b"]);
  // A save that itself fails still rejects, so the UI can say it was not saved.
  await expect(saveCalibrationTemplateAndReload({ ...example("c", "PIZZA", 3), frames: [] })).rejects.toThrow("Invalid personal sign example");
});

it("overwrites an example saved again under the same id instead of duplicating or pruning it", async () => {
  const rows = installFakeIndexedDB();
  for (const [id, createdAt] of [["a", 1], ["b", 2], ["c", 3]] as const) await saveCalibrationTemplate(example(id, "PIZZA", createdAt));
  await saveCalibrationTemplate({ ...example("c", "PIZZA", 4), text: "Pizza!" });
  expect([...rows.keys()].sort()).toEqual(["a", "b", "c"]);
  expect((await loadCalibrationTemplates()).find(item => item.id === "c")?.text).toBe("Pizza!");
});

it("orders Clear local data and a save by when they started, never resurrecting cleared examples", async () => {
  const rows = installFakeIndexedDB();
  await saveCalibrationTemplate(example("a", "PIZZA", 1));
  // Save started first, then Clear: the clear wins.
  await Promise.all([saveCalibrationTemplate(example("b", "PIZZA", 2)), clearCalibrationTemplates()]);
  expect([...rows.keys()]).toEqual([]);
  // Clear started first, then a save: the new example (a deliberate new recording) remains, nothing older returns.
  await saveCalibrationTemplate(example("c", "PIZZA", 3));
  await Promise.all([clearCalibrationTemplates(), saveCalibrationTemplate(example("d", "PIZZA", 4))]);
  expect([...rows.keys()]).toEqual(["d"]);
});
