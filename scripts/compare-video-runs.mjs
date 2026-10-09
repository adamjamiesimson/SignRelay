#!/usr/bin/env node
/** Compare two runs of identical labelled video fixtures without exporting media. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const label = value => value == null ? "REJECT" : String(value).replaceAll("|", "\\|");
const count = (rows, predicate) => rows.filter(predicate).length;

export function compareVideoRuns(first, second) {
  const toMap = (rows, name) => {
    const map = new Map();
    for (const row of rows) {
      if (!row.fixture_id || map.has(row.fixture_id)) throw new Error(name + " contains a missing or duplicate fixture id");
      map.set(row.fixture_id, row);
    }
    return map;
  };
  const a = toMap(first, "Run A");
  const b = toMap(second, "Run B");
  if (a.size !== b.size || [...a.keys()].some(key => !b.has(key))) {
    throw new Error("The two runs do not contain the same fixture IDs");
  }
  const changed = [];
  let totalWorkerA = 0, totalWorkerB = 0;
  const table = [];
  for (const [id, left] of a) {
    const right = b.get(id);
    if (left.expected_gloss !== right.expected_gloss
      || left.trial_type !== right.trial_type || left.source_file !== right.source_file
      || left.notes !== right.notes) {
      throw new Error("Fixture provenance changed for " + id + "; cannot compare fairly");
    }
    const same = left.outcome === right.outcome && left.predicted_gloss === right.predicted_gloss;
    if (!same) changed.push(id);
    const framesA = left.pipeline?.workerFrames ?? 0;
    const framesB = right.pipeline?.workerFrames ?? 0;
    totalWorkerA += framesA;
    totalWorkerB += framesB;
    table.push({ id, expected: left.expected_gloss ?? "NO_SIGN",
      a: left.predicted_gloss, b: right.predicted_gloss,
      outcomeA: left.outcome, outcomeB: right.outcome, framesA, framesB, same });
  }
  const signA = first.filter(row => row.trial_type === "sign");
  const signB = second.filter(row => row.trial_type === "sign");
  return {
    fixtures: a.size, changed: changed.length, changedIds: changed,
    correctA: count(signA, row => row.outcome === "correct"),
    correctB: count(signB, row => row.outcome === "correct"),
    falseAcceptA: count(first, row => row.trial_type === "no_sign" && row.accepted),
    falseAcceptB: count(second, row => row.trial_type === "no_sign" && row.accepted),
    totalWorkerA, totalWorkerB, table,
  };
}

export function renderReport(result) {
  const lines = [
    "# SignRelay frame-identity replay repeatability",
    "",
    "These are two runs over the same local video fixtures, NOT independent real-signer accuracy estimates.",
    "Identical files do not guarantee identical browser frame timing or model behavior.",
    "",
    "| Metric | Run A | Run B |",
    "| --- | ---: | ---: |",
    `| Correct signed clips | ${result.correctA} | ${result.correctB} |`,
    `| Non-sign false accepts | ${result.falseAcceptA} | ${result.falseAcceptB} |`,
    `| Frames to recognition worker | ${result.totalWorkerA} | ${result.totalWorkerB} |`,
    "",
    `**${result.changed} of ${result.fixtures} fixtures changed recognized outcome or predicted label.**`,
    "",
    "| Fixture | Expected | A prediction (outcome) | B prediction (outcome) | Worker frames A/B | Stable |",
    "| --- | --- | --- | --- | ---: | --- |",
  ];
  for (const row of result.table) {
    lines.push(`| ${row.id} | ${label(row.expected)} | ${label(row.a)} (${row.outcomeA}) | ${label(row.b)} (${row.outcomeB}) | ${row.framesA}/${row.framesB} | ${row.same ? "yes" : "**no**"} |`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const [a, b, report = "work/popsign/repeatability.md"] = process.argv.slice(2);
  if (!a || !b) throw new Error("Usage: node scripts/compare-video-runs.mjs <results-a.jsonl> <results-b.jsonl> [report.md]");
  const read = async file => (await readFile(resolve(file), "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const comparison = compareVideoRuns(await read(a), await read(b));
  const output = resolve(report);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderReport(comparison));
  console.log(`Repeatability: ${comparison.changed}/${comparison.fixtures} outcomes changed; correct ${comparison.correctA} -> ${comparison.correctB}; worker frames ${comparison.totalWorkerA} -> ${comparison.totalWorkerB}`);
  console.log("Metadata report: " + output);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
