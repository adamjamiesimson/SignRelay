import { prepareCalibrationSequence, sequenceDistance } from "./personalized-recognition";
import type { VisionFrame } from "./vision-types";

export type Psl776Prediction = { label: string; text: string; confidence: number; margin: number };
export type Psl776Template = { gloss: string; text: string; frames: number[][] };

// A closer match than this is not trustworthy; two candidates this close are
// too ambiguous to pick between. Mirrors the reject gate already proven for
// personal DTW templates (lib/personalized-recognition.ts).
const REJECT_DISTANCE = 0.5;
const REJECT_MARGIN = 0.06;

let templatesPromise: Promise<Psl776Template[]> | null = null;

function loadTemplates() {
  templatesPromise ??= fetch("/models/psl776-hfad/templates.json.gz").then(async (response) => {
    if (!response.ok) throw new Error("PSL template bundle could not load");
    if (!("DecompressionStream" in globalThis)) throw new Error("This browser cannot unpack the PSL template bundle");
    const stream = new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json() as Promise<Psl776Template[]>;
  });
  return templatesPromise;
}

/**
 * Pakistan Sign Language, matched against 775 official HFAD dictionary
 * signs (CC BY 4.0, see public/models/psl776-hfad/ATTRIBUTION.md). Each
 * word has exactly one official reference performance, so this is
 * one-shot DTW template matching, not a trained closed-set classifier -
 * the same distance metric already used for a signer's own personal
 * templates, applied to a built-in library instead of self-recorded ones.
 * No accuracy evaluation exists yet: treat it as roughly as reliable as
 * matching against a single well-performed personal recording, which
 * means real sensitivity to signing speed, style and camera framing.
 */
export async function recognizePsl776(sequence: VisionFrame[]): Promise<Psl776Prediction | null> {
  if (sequence.length < 8) return null;
  const templates = await loadTemplates();
  const candidate = prepareCalibrationSequence(sequence);
  let best: { template: Psl776Template; distance: number } | null = null;
  let rival: { template: Psl776Template; distance: number } | null = null;
  for (const template of templates) {
    const distance = sequenceDistance(candidate, template.frames);
    if (!best || distance < best.distance) { rival = best; best = { template, distance }; }
    else if (!rival || distance < rival.distance) rival = { template, distance };
  }
  if (!best || best.distance > REJECT_DISTANCE || (rival && rival.distance - best.distance < REJECT_MARGIN)) return null;
  const confidence = clamp(0.9 - best.distance * 0.24, 0, 0.88);
  const margin = rival ? rival.distance - best.distance : 1;
  return { label: best.template.gloss, text: best.template.text, confidence, margin };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
