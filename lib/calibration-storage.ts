import type { CalibrationTemplate } from "./vision-types";
import { isLanguageId } from "./model-adapters";

const DATABASE_NAME = "signrelay-personal-vocabulary";
const STORE_NAME = "templates";
const DATABASE_VERSION = 1;
const MAX_EXAMPLES_PER_GLOSS = 3;

export function validCalibrationTemplate(value: unknown): value is CalibrationTemplate {
  if (!value || typeof value !== "object") return false;
  const t = value as CalibrationTemplate;
  return typeof t.id === "string" && t.id.length <= 200
    && typeof t.gloss === "string" && t.gloss.length > 0 && t.gloss.length <= 100
    && typeof t.text === "string" && t.text.length <= 100 && Number.isFinite(t.createdAt)
    && (t.language === undefined || isLanguageId(t.language))
    && Array.isArray(t.frames) && t.frames.length === 24
    && t.frames.every(row => Array.isArray(row) && [208, 240].includes(row.length) && row.every(Number.isFinite));
}

// Serialize writes requested in this tab so Clear cannot be overtaken by a
// recording that is still opening its database. IndexedDB transactions provide
// the cross-tab isolation; the queue also survives rejected operations.
let pendingWrite: Promise<unknown> = Promise.resolve();
function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(operation);
  pendingWrite = result.catch(() => undefined);
  return result;
}

export async function loadCalibrationTemplates(): Promise<CalibrationTemplate[]> {
  await pendingWrite;
  return transaction<CalibrationTemplate[]>("readonly", (store, complete) => {
    const request = store.getAll();
    request.onsuccess = () => complete(request.result.filter(validCalibrationTemplate)
      .sort((a: CalibrationTemplate, b: CalibrationTemplate) => b.createdAt - a.createdAt));
  });
}

export function saveCalibrationTemplate(template: CalibrationTemplate) {
  if (!validCalibrationTemplate(template)) return Promise.reject(new Error("Invalid personal sign example"));
  return enqueueWrite(() => transaction<void>("readwrite", store => {
    store.put(template);
    const request = store.getAll();
    request.onsuccess = () => {
      const examples: CalibrationTemplate[] = request.result.filter(validCalibrationTemplate)
        .filter((item: CalibrationTemplate) => item.gloss === template.gloss
          && (item.language ?? "asl") === (template.language ?? "asl"))
        .sort((a: CalibrationTemplate, b: CalibrationTemplate) => b.createdAt - a.createdAt);
      examples.slice(MAX_EXAMPLES_PER_GLOSS).forEach(item => store.delete(item.id));
    };
  }));
}

export function deleteCalibrationGloss(gloss: string, language: NonNullable<CalibrationTemplate["language"]>) {
  return enqueueWrite(() => transaction<void>("readwrite", store => {
    const request = store.getAll();
    request.onsuccess = () => {
      const matching: CalibrationTemplate[] = request.result.filter(validCalibrationTemplate)
        .filter((item: CalibrationTemplate) => item.gloss === gloss && (item.language ?? "asl") === language);
      matching.forEach(item => store.delete(item.id));
    };
  }));
}

export function clearCalibrationTemplates() {
  return enqueueWrite(() => transaction<void>("readwrite", store => { store.clear(); }));
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      let result: T;
      // A request's success is not a commit: a later abort must still reject.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error("Personal vocabulary transaction was aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Personal vocabulary storage failed"));
      try {
        operation(tx.objectStore(STORE_NAME), value => { result = value; });
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Personal vocabulary storage is blocked. Close other SignRelay tabs and retry."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error);
  });
}
