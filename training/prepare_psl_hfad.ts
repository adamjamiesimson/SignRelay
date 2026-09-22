// One-time data-prep script: converts the official Pakistan Sign Language
// (HFAD dictionary) MediaPipe-landmark CSV release into a compact bundle of
// built-in DTW templates using SignRelay's own tested calibration pipeline.
//
// Source: https://github.com/sign-language-translator/sign-language-datasets
// (CC BY 4.0). Run with local copies of the extracted
// pk-hfad-1.landmarks-mediapipe-image-csv.zip contents and
// parallel_texts/pk-dictionary-mapping.json (both fetched separately; raw
// assets are not committed to this repository).
//
// Usage: npx tsx training/prepare_psl_hfad.ts <csvDir> <mappingJsonPath>

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareCalibrationSequence } from "../lib/personalized-recognition";
import type { HandObservation, Point, VisionFrame } from "../lib/vision-types";

const csvDir = process.argv[2] ?? "/tmp/psl-full";
const mappingPath = process.argv[3] ?? "/tmp/pk-dictionary-mapping.json";
const outDir = "public/models/psl776-hfad";

type MappingEntry = { label: string; token: { en?: string[] } };
type MappingRoot = Array<{ country: string; mapping: MappingEntry[] }>;

const mappingRoot = JSON.parse(readFileSync(mappingPath, "utf8")) as MappingRoot;
const pk = mappingRoot.find((entry) => entry.country === "pk");
if (!pk) throw new Error("No 'pk' entry in the dictionary mapping file");
const labelToEnglish = new Map(pk.mapping.map((entry) => [entry.label, entry.token.en?.[0] ?? null]));

// Verified against the source library's own connection definitions
// (sign_language_translator/vision/landmarks/connections.py): 75 landmarks
// per frame = pose(0-32) + left hand(33-53) + right hand(54-74).
function parseCsv(path: string): VisionFrame[] {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const rows = lines.slice(1).map((line) => line.split(",").map(Number));
  return rows.map((row, frameIndex): VisionFrame => {
    const point = (index: number): Point => {
      const base = index * 5;
      return { x: row[base], y: row[base + 1], z: row[base + 2], visibility: row[base + 3] };
    };
    const pose = Array.from({ length: 33 }, (_, index) => point(index));
    const makeHand = (startIndex: number, handedness: "Left" | "Right"): HandObservation | null => {
      const landmarks = Array.from({ length: 21 }, (_, index) => point(startIndex + index));
      if (!landmarks.some((landmark) => landmark.x !== 0 || landmark.y !== 0)) return null;
      return { landmarks, handedness, gesture: "None", gestureScore: 0 };
    };
    const hands = [makeHand(33, "Left"), makeHand(54, "Right")]
      .filter((hand): hand is HandObservation => hand !== null);
    return { timestamp: frameIndex * 33, hands, face: [], pose };
  });
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(csvDir).filter((file) => file.endsWith(".landmarks-mediapipe-image.csv"));

type Template = { gloss: string; text: string; frames: number[][] };
const templates: Template[] = [];
const usedGlosses = new Set<string>();
let skippedNoLabel = 0;
let skippedNoHands = 0;

for (const file of files) {
  const label = file.replace(".landmarks-mediapipe-image.csv", "");
  const english = labelToEnglish.get(label);
  if (!english) { skippedNoLabel += 1; continue; }
  const frames = parseCsv(join(csvDir, file)).filter((frame) => frame.hands.length > 0);
  if (frames.length < 8) { skippedNoHands += 1; continue; }
  let gloss = english.trim().toUpperCase().replace(/\s+/g, " ");
  if (usedGlosses.has(gloss)) gloss = `${gloss} (${label.replace("pk-hfad-1_", "").toUpperCase()})`;
  usedGlosses.add(gloss);
  const rounded = prepareCalibrationSequence(frames).map((row) => row.map((value) => Math.round(value * 10000) / 10000));
  templates.push({ gloss, text: english.trim(), frames: rounded });
}

templates.sort((a, b) => a.gloss.localeCompare(b.gloss));
writeFileSync(join(outDir, "templates.json"), JSON.stringify(templates));
// A separate lightweight labels file for the app's main bundle (vocabulary
// lists, search), so the multi-megabyte template frames never ship outside
// the worker that actually needs them.
writeFileSync(join(outDir, "labels.json"), JSON.stringify(templates.map((template) => template.gloss)));
console.log(`Wrote ${templates.length} templates (skipped ${skippedNoLabel} unlabeled, ${skippedNoHands} with insufficient hand tracking) to ${outDir}/templates.json and labels.json`);
