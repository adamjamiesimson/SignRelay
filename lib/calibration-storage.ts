import type { CalibrationTemplate } from "./vision-types";

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
    && (t.language === undefined || ["asl", "auslan", "bsl", "csl", "isl", "lse"].includes(t.language))
    && Array.isArray(t.frames) && t.frames.length === 24
    && t.frames.every(row => Array.isArray(row) && [208, 240].includes(row.length) && row.every(Number.isFinite));
}

export async function loadCalibrationTemplates(): Promise<CalibrationTemplate[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result.filter(validCalibrationTemplate).sort((a: CalibrationTemplate, b: CalibrationTemplate) => b.createdAt - a.createdAt)); };
    request.onerror = () => reject(request.error);
  });
}

export async function saveCalibrationTemplate(template: CalibrationTemplate) {
  if (!validCalibrationTemplate(template)) throw new Error("Invalid personal sign example");
  const existing = (await loadCalibrationTemplates())
    .filter((item) => item.gloss === template.gloss && (item.language ?? "asl") === (template.language ?? "asl"))
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

export async function deleteCalibrationGloss(gloss: string, language: NonNullable<CalibrationTemplate["language"]>) {
  const matching = (await loadCalibrationTemplates()).filter((item) => item.gloss === gloss && (item.language ?? "asl") === language);
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
