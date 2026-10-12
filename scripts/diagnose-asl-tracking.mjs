#!/usr/bin/env node
// Metadata-only diagnostic triage. No raw media or landmark export.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzePair } from "./report-asl-confusions.mjs";

const LOW_HAND_COVERAGE = 0.35;
const PRESENT_HAND_COVERAGE = 0.60;
const pct = value => value === null ? "n/a" : (value * 100).toFixed(1) + "%";
const escapeCell = value => String(value ?? "—").replaceAll("|", "\\|").replace(/[\r\n]/g, " ");

export function coverage(row) {
  const workerFrames = row.pipeline?.workerFrames;
  const handFrames = row.pipeline?.workerHandFrames;
  const worker = Number.isInteger(workerFrames) && workerFrames > 0 &&
    Number.isInteger(handFrames) && handFrames >= 0 && handFrames <= workerFrames
    ? handFrames / workerFrames : null;
  const sampled = row.tracker?.hand_coverage;
  const ui = typeof sampled === "number" && Number.isFinite(sampled) &&
    sampled >= 0 && sampled <= 1 ? sampled : null;
  // UI polling and worker frame samples are different denominators; do not combine them.
  return { worker, ui, workerFrames: Number.isInteger(workerFrames) && workerFrames > 0 ? workerFrames : null };
}

function leadingCounts(values, limit = 3) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "—";
  const entries = Object.entries(values)
    .filter(([k, n]) => typeof k === "string" && Number.isInteger(n) && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.length ? entries.map(([k, n]) => escapeCell(k) + ": " + n).join("; ") : "—";
}

export function diagnosePairs(first, second) {
  // Reuse fingerprint, signer, fixture-ID and outcome-integrity checks.
  const result = analyzePair(first, second);
  const rows = result.paired.map(pair => {
    const sourceOfFirst = item => {
      const first = item.pipeline?.confirmedEvents?.[0];
      if (!first || first.gloss !== item.predicted_gloss) return "unknown";
      return ["starter", "model", "personal"].includes(first.source) ? first.source : "unknown";
    };
    const confirmedSources = { a: sourceOfFirst(pair.left), b: sourceOfFirst(pair.right) };
    const a = coverage(pair.left);
    const b = coverage(pair.right);
    const observations = [];
    const sign = pair.left.trial_type === "sign";
    const bad = row => !["correct", "correct_reject"].includes(row.outcome);
    const wrongPlease = sign && pair.left.expected_gloss !== "PLEASE" &&
      [pair.left, pair.right].some(row => row.predicted_gloss === "PLEASE" && row.accepted);
    if (wrongPlease) observations.push("wrong-PLEASE");
    if ([a.worker, b.worker].some(value => value !== null && value < LOW_HAND_COVERAGE)) {
      observations.push("low-worker-hand-coverage");
    } else if (a.worker === null || b.worker === null) {
      observations.push("worker-hand-coverage-unavailable");
    }
    if (!pair.stable) observations.push("prediction-varied");
    if (sign && [pair.left, pair.right].some(row => bad(row)) &&
        [a.worker, b.worker].every(value => value !== null && value >= PRESENT_HAND_COVERAGE)) {
      observations.push("failure-with-hands-observed");
    }
    if ([pair.left, pair.right].some(row => (row.pipeline?.faults ?? 0) > 0 ||
        (row.pipeline?.modelProblemAnalyses ?? 0) > 0)) {
      observations.push("worker-or-model-problem");
    }
    if (observations.length === 0 && [pair.left, pair.right].some(bad)) {
      observations.push("recognition-error-needs-review");
    }
    const priority = wrongPlease || observations.includes("worker-or-model-problem") ? 1 :
      observations.includes("low-worker-hand-coverage") || !pair.stable ? 2 : 3;
    return { pair, a, b, confirmedSources, observations, priority };
  }).sort((a, b) => a.priority - b.priority || a.pair.id.localeCompare(b.pair.id));
  return {
    rows, total: rows.length,
    wrongPlease: rows.filter(row => row.observations.includes("wrong-PLEASE")).length,
    lowHand: rows.filter(row => row.observations.includes("low-worker-hand-coverage")).length,
    missingHand: rows.filter(row => row.observations.includes("worker-hand-coverage-unavailable")).length,
    unstable: rows.filter(row => row.observations.includes("prediction-varied")).length,
  };
}

export function renderTrackingTriage(report) {
  const lines = [
    "# SignRelay: ASL hand-tracking and confusion triage",
    "",
    "**Diagnostic observations only. NOT a diagnosis of root cause, measured accuracy improvement, or deployment approval.**",
    "The same recording is replayed twice. The figures below describe worker-frame hand presence and separately sampled UI detection. These sampling rates are not interchangeable.",
    "",
    "Flags: " + report.wrongPlease + " non-PLEASE fixtures accepted as PLEASE; " +
      report.lowHand + " fixtures with worker hand-frame coverage below 35% in a pass; " +
      report.missingHand + " lacking worker-frame coverage evidence; " +
      report.unstable + " changed predictions/outcomes.",
    "",
    "## Highest-priority clips",
    "",
    "| Fixture | Expected | A → B | Confirmed origin A/B | Worker hands A/B | UI hands A/B | Observations | Analysis candidate counts A/B |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- |",
  ];
  for (const row of report.rows) {
    const { left, right, id } = row.pair;
    const prediction = item => (item.predicted_gloss ?? "REJECT") + " (" + item.outcome + ")";
    lines.push("| " + [
      id, left.expected_gloss ?? "NO_SIGN",
      prediction(left) + " → " + prediction(right),
      row.confirmedSources.a + " / " + row.confirmedSources.b,
      pct(row.a.worker) + " / " + pct(row.b.worker),
      pct(row.a.ui) + " / " + pct(row.b.ui),
      row.observations.length ? row.observations.join("; ") : "none",
      leadingCounts(left.pipeline?.candidateSources) + " / " + leadingCounts(right.pipeline?.candidateSources),
    ].map(escapeCell).join(" | ") + " |");
  }
  lines.push("",
    "## What to investigate next",
    "",
    "1. For low-worker-hand-coverage clips, inspect source framing, visibility, clipping, MediaPipe hand availability and frame scheduling before modifying recognition thresholds.",
    "2. For wrong-PLEASE predictions, inspect the worker-confirmed origin (starter, model, personal, unknown), then examine that pipeline separately. Candidate-source counts are aggregate analysis observations, not proof of what was confirmed.",
    "3. For errors despite hands being observed, review temporal segmentation and asynchronous model decision timing; do not assume hand presence means high landmark quality.",
    "4. Repeat on previously unseen, signer-confirmed, licensed or consented recordings. These reused PopSign clips cannot demonstrate signer-independent accuracy.",
    "",
    "The 35% and 60% coverage thresholds are **diagnostic sorting conventions**, not confidence or recognition thresholds, and have no effect on live signing.",
    "Only derived counters, outcomes, source IDs and anonymized fixture provenance are used; no raw video or landmark coordinates are included.",
    "");
  return lines.join("\n");
}

async function main() {
  const [firstFile, secondFile, outputFile = "work/popsign/tracking-triage.md"] = process.argv.slice(2);
  if (!firstFile || !secondFile) {
    throw new Error("Usage: node scripts/diagnose-asl-tracking.mjs <results-a.jsonl> <results-b.jsonl> [report.md]");
  }
  const read = async filename => (await readFile(resolve(filename), "utf8"))
    .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const report = diagnosePairs(await read(firstFile), await read(secondFile));
  const output = resolve(outputFile);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderTrackingTriage(report));
  console.log("ASL triage: " + report.wrongPlease + " false PLEASE; " +
    report.lowHand + " low-worker-hand-coverage; " + report.unstable +
    " unstable fixtures. Report: " + output);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
