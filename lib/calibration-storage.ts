import type { CalibrationTemplate } from "./vision-types";
import { isLanguageId } from "./model-adapters";
import { cosineSimilarity } from "./asl-v31-personal";

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

/**
 * Which examples to keep once a word has more than `limit` takes. The newest take always stays, and
 * the remaining slots go to the takes that agree with the others, so a single sloppy recording is
 * dropped instead of the example that actually teaches the sign. Without embeddings (other
 * languages, older records) the newest examples are kept, as before.
 */
export function selectTakes(takes: CalibrationTemplate[], limit = MAX_EXAMPLES_PER_GLOSS): CalibrationTemplate[] {
  if (takes.length <= limit) return takes;
  const newest = [...takes].sort((a, b) => b.createdAt - a.createdAt)[0];
  const embedded = takes.every(take => Array.isArray(take.embedding) && take.embedding!.length > 0);
  const rest = takes.filter(take => take.id !== newest.id).sort((a, b) => b.createdAt - a.createdAt);
  if (!embedded) return [newest, ...rest].slice(0, limit);
  const agreement = (take: CalibrationTemplate) => {
    const others = takes.filter(other => other.id !== take.id);
    return others.reduce((total, other) => total + cosineSimilarity(take.embedding!, other.embedding!), 0) / Math.max(1, others.length);
  };
  return [newest, ...rest.sort((a, b) => agreement(b) - agreement(a))].slice(0, limit);
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
  const database = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const existing = request.result.filter(validCalibrationTemplate)
        .filter((item: CalibrationTemplate) => item.id !== template.id && item.gloss === template.gloss
          && (item.language ?? "asl") === (template.language ?? "asl"))
        .sort((a: CalibrationTemplate, b: CalibrationTemplate) => b.createdAt - a.createdAt);
      store.put(template);
      const keep = new Set(selectTakes([template, ...existing]).map(item => item.id));
      existing.filter(item => !keep.has(item.id)).forEach((item: CalibrationTemplate) => store.delete(item.id));
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Personal vocabulary storage was interrupted")); };
  });
}

export async function deleteCalibrationGloss(gloss: string, language: NonNullable<CalibrationTemplate["language"]>) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      request.result.filter(validCalibrationTemplate)
        .filter((item: CalibrationTemplate) => item.gloss === gloss && (item.language ?? "asl") === language)
        .forEach((item: CalibrationTemplate) => store.delete(item.id));
    };
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Personal vocabulary storage was interrupted")); };
  });
}

export async function clearCalibrationTemplates() {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
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
