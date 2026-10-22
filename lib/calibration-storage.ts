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

export async function loadCalibrationTemplates(): Promise<CalibrationTemplate[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { database.close(); resolve(request.result.filter(validCalibrationTemplate).sort((a: CalibrationTemplate, b: CalibrationTemplate) => b.createdAt - a.createdAt)); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

export async function saveCalibrationTemplate(template: CalibrationTemplate) {
  if (!validCalibrationTemplate(template)) throw new Error("Invalid personal sign example");
  const sameWord = (item: CalibrationTemplate) =>
    item.gloss === template.gloss && (item.language ?? "asl") === (template.language ?? "asl");
  // Read, prune and write in one readwrite transaction. IndexedDB serialises
  // overlapping readwrite transactions, so two saves started together (a
  // double click, two tabs) cannot each keep the other's older examples.
  await readwrite(store => {
    const request = store.getAll();
    request.onsuccess = () => {
      store.put(template);
      (request.result as unknown[]).filter(validCalibrationTemplate)
        .filter(item => sameWord(item) && item.id !== template.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(MAX_EXAMPLES_PER_GLOSS - 1)
        .forEach(item => store.delete(item.id));
    };
  });
}

/** Save, then re-read the list. `templates` is null when the save committed but
 * the re-read failed: the example is stored, only the list could not refresh. */
export async function saveCalibrationTemplateAndReload(template: CalibrationTemplate) {
  await saveCalibrationTemplate(template);
  try {
    return { templates: await loadCalibrationTemplates() };
  } catch {
    return { templates: null };
  }
}

export async function deleteCalibrationGloss(gloss: string, language: NonNullable<CalibrationTemplate["language"]>) {
  // One transaction, so an example of this word saved just before is removed too.
  await readwrite(store => {
    const request = store.getAll();
    request.onsuccess = () => (request.result as unknown[]).filter(validCalibrationTemplate)
      .filter(item => item.gloss === gloss && (item.language ?? "asl") === language)
      .forEach(item => store.delete(item.id));
  });
}

export async function clearCalibrationTemplates() {
  await readwrite(store => { store.clear(); });
}

async function readwrite(work: (store: IDBObjectStore) => void) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    work(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Personal vocabulary storage was interrupted")); };
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
