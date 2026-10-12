#!/usr/bin/env node
/**
 * Private-only pilot fixture preparation. This does not upload videos or
 * certify model accuracy, participant consent or training-set separation.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_GLOSSES = ["HELLO", "THANK YOU", "PLEASE"];
const DEFAULT_OUTPUT = "evaluation/video-manifest.local.jsonl";
const GLOSSES = new Set(REQUIRED_GLOSSES);
const root = resolve(".");
const ignoredInsideRepo = [
  resolve("evaluation/raw"),
  resolve("evaluation/videos"),
  resolve("work"),
];
const exactIgnoredFile = resolve(DEFAULT_OUTPUT);

function inside(candidate, parent) {
  return candidate === parent || candidate.startsWith(parent + sep);
}

function assertPrivatePath(path, label, isOutput = false) {
  const abs = resolve(path);
  if (inside(abs, root) && !ignoredInsideRepo.some(prefix => inside(abs, prefix))
    && abs !== exactIgnoredFile) {
    throw new Error(label + " must be under ignored evaluation/raw/, evaluation/videos/, work/ or evaluation/video-manifest.local.jsonl (or outside the repository)");
  }
  if (isOutput && !abs.endsWith(".local.jsonl")) {
    throw new Error("Output must use a .local.jsonl filename, never a tracked report");
  }
  return abs;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

function normalizeGloss(value) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, " ") : value;
}

export function pilotCoverage(rows) {
  const byGloss = REQUIRED_GLOSSES.map(gloss => {
    const clips = rows.filter(row => row.trial_type === "sign" && row.expected_gloss === gloss);
    const signers = [...new Set(clips.map(row => row.signer_id))];
    const twoPerSigner = signers.filter(id => clips.filter(row => row.signer_id === id).length >= 2);
    return { gloss, clips: clips.length, distinctSigners: signers.length, signersWithTwoClips: twoPerSigner.length };
  });
  const negatives = rows.filter(row => row.trial_type === "no_sign").length;
  return {
    signs: byGloss,
    negatives,
    // Collection planning minimum, NOT a recognition performance threshold.
    pilotMinimum: byGloss.every(item => item.clips >= 6 && item.signersWithTwoClips >= 3) && negatives >= 10,
  };
}

export async function preparePilot(inputFile, outputFile = DEFAULT_OUTPUT, { strict = false } = {}) {
  const input = assertPrivatePath(inputFile, "Intake");
  const output = assertPrivatePath(outputFile, "Output", true);
  if (input === output) throw new Error("Intake and manifest output must be separate files");
  const source = await readFile(input, "utf8");
  const entries = [];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    let row;
    try { row = JSON.parse(rawLine); }
    catch { throw new Error("Intake line " + (index + 1) + " is not valid JSON"); }
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Intake line " + (index + 1) + " must be a JSON object");
    }
    const trialType = row.trial_type;
    const gloss = normalizeGloss(row.expected_gloss);
    const signerId = row.signer_id;
    const id = row.id;
    if (!["sign", "no_sign"].includes(trialType) ||
      (trialType === "sign" && !GLOSSES.has(gloss)) ||
      (trialType === "no_sign" && gloss !== null)) {
      throw new Error("Intake line " + (index + 1) + ": invalid sign/no-sign or gloss");
    }
    if (typeof signerId !== "string" || !/^S\d{2,}$/.test(signerId) ||
      typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{2,60}$/.test(id)) {
      throw new Error("Intake line " + (index + 1) + ": use anonymous signer IDs (S01) and slug fixture IDs");
    }
    if (row.permission_confirmed !== true || row.label_reviewed_by_fluent !== true) {
      throw new Error("Intake line " + (index + 1) + ": explicit permission and fluent label review are required");
    }
    if (typeof row.video !== "string" || !row.video || row.video.includes("://") || row.video.startsWith("//")) {
      throw new Error("Intake line " + (index + 1) + ": video must be a local path");
    }
    const videoPath = isAbsolute(row.video) ? resolve(row.video) : resolve(dirname(input), row.video);
    const suffix = trialType === "sign" ? gloss.toLowerCase().replaceAll(" ", "") : "nosign";
    const name = basename(videoPath);
    const expectedFilePattern = new RegExp("^" + signerId.toLowerCase() + "-" + suffix + "-\\d{2,3}\\.(mp4|mov|webm)$", "i");
    if (!expectedFilePattern.test(name)) {
      throw new Error("Intake line " + (index + 1) + ": rename video to " + signerId.toLowerCase() + "-" + suffix + "-01.mp4 (no participant names)");
    }
    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new Error("Intake line " + (index + 1) + ": missing or empty local video");
    }
    entries.push({
      id, language: "asl", trial_type: trialType,
      expected_gloss: trialType === "sign" ? gloss : null,
      signer_id: signerId,
      video: relative(dirname(output), videoPath).replaceAll("\\", "/"),
      device: ["phone", "webcam", "tablet"].includes(row.device) ? row.device : "other",
      condition: ["bright-front", "dim-front", "side-view", "other"].includes(row.condition)
        ? row.condition : "other",
      split: "pilot-review-unverified",
      notes: "sha256=" + await sha256File(videoPath),
    });
  }
  if (!entries.length) throw new Error("No records found in local intake");
  const ids = new Set(), hashes = new Set();
  for (const row of entries) {
    if (ids.has(row.id)) throw new Error("Duplicate fixture ID: " + row.id);
    const hash = row.notes.slice(7);
    if (hashes.has(hash)) throw new Error("Duplicate video SHA-256 (reused clip): " + row.id);
    ids.add(row.id); hashes.add(hash);
  }
  const coverage = pilotCoverage(entries);
  if (strict && !coverage.pilotMinimum) {
    throw new Error("Pilot intake is incomplete: need two clips per target from three signers and at least ten non-sign-intent controls");
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, entries.map(row => JSON.stringify(row)).join("\n") + "\n");
  return { output, count: entries.length, coverage };
}

async function main() {
  const [input, ...args] = process.argv.slice(2);
  if (!input || args.some(a => a !== "--strict" && a.startsWith("--")) || args.filter(a => a !== "--strict").length > 1) {
    throw new Error("Usage: node scripts/prepare-asl-pilot.mjs <private-intake.jsonl> [private-manifest.local.jsonl] [--strict]");
  }
  const result = await preparePilot(input, args.find(a => a !== "--strict") ?? DEFAULT_OUTPUT,
    { strict: args.includes("--strict") });
  console.log(JSON.stringify({
    output: result.output,
    records: result.count,
    collectionMinimumMet: result.coverage.pilotMinimum,
    byGloss: result.coverage.signs,
    nonSigningControls: result.coverage.negatives,
    warning: "Collection checks only: not proof of training separation, correct labels, consent, or recognition accuracy.",
  }, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
