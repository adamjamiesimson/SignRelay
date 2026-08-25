import type { CalibrationTemplate } from "./vision-types";

const DATABASE_NAME = "signbridge-personal-vocabulary";
const STORE_NAME = "templates";
const DATABASE_VERSION = 1;
const MAX_EXAMPLES_PER_GLOSS = 3;

export async function loadCalibrationTemplates(): Promise<CalibrationTemplate[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as CalibrationTemplate[]).sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error);
  });
}

export async function saveCalibrationTemplate(template: CalibrationTemplate) {
  const existing = (await loadCalibrationTemplates())
    .filter((item) => item.gloss === template.gloss)
    .sort((a, b) => b.createdAt - a.createdAt);
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(template);
    existing.slice(MAX_EXAMPLES_PER_GLOSS - 1).forEach((item) => store.delete(item.id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteCalibrationGloss(gloss: string) {
  const matching = (await loadCalibrationTemplates()).filter((item) => item.gloss === gloss);
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    matching.forEach((item) => store.delete(item.id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearCalibrationTemplates() {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
