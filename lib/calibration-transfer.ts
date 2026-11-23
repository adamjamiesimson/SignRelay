import type { CalibrationTemplate } from "./vision-types";
import { validCalibrationTemplate } from "./calibration-storage";

/** Portable form of the taught signs, so a large personal vocabulary survives a browser reset and can
 * move to a second machine (a booth laptop) without re-recording anything. */
export type CalibrationExport = { schema: 1; exportedAt: string; templates: CalibrationTemplate[] };

const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const EMBEDDING_LENGTH = 384;

/** A stored embedding is only useful if it is a finite vector of the engine's width; a corrupt one is
 * dropped rather than allowed to score nonsense in the matcher. */
function cleanTemplate(value: unknown): CalibrationTemplate | null {
  if (!validCalibrationTemplate(value)) return null;
  const template = value as CalibrationTemplate;
  const embedding = template.embedding;
  const usable = Array.isArray(embedding) && embedding.length === EMBEDDING_LENGTH && embedding.every(Number.isFinite);
  return usable ? template : { ...template, embedding: undefined };
}

export function serialiseCalibration(templates: CalibrationTemplate[]): string {
  const payload: CalibrationExport = {
    schema: 1,
    exportedAt: new Date().toISOString(),
    templates: templates.map(template => cleanTemplate(template)).filter((template): template is CalibrationTemplate => template !== null),
  };
  return JSON.stringify(payload);
}

/** Accepts the exported document, or a bare array of examples. Returns what it could use and how many
 * entries it skipped, so the page can say so instead of silently dropping signs. */
export function parseCalibrationExport(raw: string): { templates: CalibrationTemplate[]; skipped: number } {
  if (raw.length > MAX_IMPORT_BYTES) throw new Error("That file is too large to import");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("That file is not a SignRelay vocabulary export"); }
  const list = Array.isArray(parsed) ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as CalibrationExport).templates) ? (parsed as CalibrationExport).templates
      : null;
  if (!list) throw new Error("That file is not a SignRelay vocabulary export");
  const templates: CalibrationTemplate[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of list) {
    const template = cleanTemplate(entry);
    // Re-importing the same file must not duplicate examples of a word.
    if (!template || seen.has(template.id)) { skipped++; continue; }
    seen.add(template.id);
    templates.push(template);
  }
  return { templates, skipped };
}
