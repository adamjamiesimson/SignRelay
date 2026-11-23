// Structured evaluation and triage report from committed evidence only. It
// reads real-video development results, the established baseline, synthetic
// regression records and known risks, and ranks open issues. It runs nothing,
// fetches nothing and never upgrades synthetic results into accuracy.
//
//   node scripts/evaluation-report.mjs [--out docs/gitex/sprint-2/evaluation-report] [--gate candidate.jsonl ...]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { gate } from "./baseline-gate.mjs";

const json = file => JSON.parse(readFileSync(file, "utf8"));
const optional = file => existsSync(file) ? json(file) : null;
const SEVERITY = { blocker: 0, high: 1, medium: 2, low: 3 };

/** @param {{ baseline: any, runtimes: any[], currentWorker: string, adversarial: any, confusion: any, temporal: any, experiments: any, risks: any,
 *   gateResult?: { ok: boolean, failures: string[], changes: object[] } | null }} input */
export function buildReport({ baseline, runtimes, currentWorker, adversarial, confusion, temporal, experiments, risks, gateResult = null }) {
  const evidence = runtimes.find(entry => entry.worker_sha256 === currentWorker) ?? null;
  const perSign = {};
  for (const trial of baseline.trials) {
    const row = perSign[trial.expected_gloss] ??= { trials: 0, correct: 0, wrong: 0, abstained: 0 };
    row.trials++; row[trial.outcome === "correct" ? "correct" : trial.outcome === "wrong" ? "wrong" : "abstained"]++;
  }
  for (const sign of ["HELLO", "THANK YOU", "PLEASE", "SORRY", "YES", "NO"]) perSign[sign] ??= { trials: 0, correct: 0, wrong: 0, abstained: 0 };
  const issues = [];
  const add = (severity, area, title, evidenceText, next) => issues.push({ severity, area, title, evidence: evidenceText, next_action: next });
  add("blocker", "evaluation", "No unseen, live-camera or new-signer evaluation exists",
    `Only ${baseline.trials.length} previously inspected publisher clips (${baseline.summary.correct} correct, ${baseline.summary.wrong} wrong, ${baseline.summary.abstained} abstained); the sealed holdout is unopened.`,
    "Collect reviewed recordings with the 144-slot plan and run the physical-camera manual gates.");
  add("blocker", "evaluation", "Real no-sign and out-of-vocabulary false acceptance is not measured", "0 real negative trials exist.", "Record no-sign and unsupported-sign takes in the reviewed collection.");
  if (!evidence) add("blocker", "runtime", "Current worker has no real-video evidence", `Worker ${String(currentWorker).slice(0, 12)} is not in evaluated-runtimes.json.`, "Run the paired video pilot and the baseline gate.");
  for (const [sign, row] of Object.entries(perSign)) {
    if (!row.trials) add("high", "recognition", `${sign} has no real-video trial`, "0 development clips.", "Include it in the reviewed collection before demonstrating it as supported.");
    else if (row.correct === 0) add("high", "recognition", `${sign} is never recognized on development clips`, `0/${row.trials} correct, ${row.abstained} abstained.`, "Diagnose with reviewed footage; see docs/gitex/sprint-2/experiments.md.");
  }
  const byGloss = adversarial.totals.accepted_by_gloss;
  add("high", "false-accepts", "Everyday movements trigger HELLO and THANK YOU in synthetic tests",
    `${adversarial.totals.runs_with_accept}/${adversarial.totals.runs} synthetic runs (${Object.entries(byGloss).map(([g, n]) => `${g} ${n}`).join(", ")}).`,
    "Keep the demo mitigation; evaluate the OFF experiments on reviewed footage before enabling any.");
  const tail = confusion.confidently_wrong_model?.wrong ?? {};
  const tailCount = Object.entries(tail).filter(([cell]) => !cell.startsWith("non-sign")).reduce((sum, [, n]) => sum + n, 0);
  if (tailCount) add("medium", "arbitration", "A model word can follow a starter confirmation on the same movement",
    `${tailCount} sign runs with an always-wrong confident model (${Object.keys(tail).filter(cell => !cell.startsWith("non-sign")).join("; ")}).`,
    "Decide on a guard that waits for a new movement onset after a starter confirmation; compare it with the baseline gate.");
  const shortPause = Object.entries(temporal.scenarios).filter(([name, s]) => /six words, (0|100) ms pause/.test(name) && s.confirmed < s.intended);
  if (shortPause.length) add("low", "segmentation", "Very short pauses (0–100 ms) lose a word", shortPause.map(([name, s]) => `${name}: ${s.confirmed}/${s.intended}`).join("; "), "Demo script keeps ≥400 ms rests with hands lowered.");
  if (gateResult && !gateResult.ok) add("blocker", "regression", "Candidate run fails the established-baseline gate", gateResult.failures.join("; "), "Fix the regression or record a reviewed explanation.");
  issues.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return {
    schema: 1, release_status: "NO-GO",
    status: "Development evidence and synthetic regression records only. Not accuracy, not live-camera or signer performance.",
    current_worker: currentWorker, current_worker_evidence: evidence ? { outcome: evidence.outcome, kind: evidence.evidence_kind } : null,
    real_video: { trials: baseline.trials.length, ...baseline.summary, per_sign: perSign, cohort: "previously inspected publisher-labelled development clips" },
    baseline_gate: gateResult ? { ok: gateResult.ok, failures: gateResult.failures, changes: gateResult.changes } : "not run in this report (runs in the CI video pilot)",
    synthetic: {
      adversarial: adversarial.totals,
      confusion_rules_wrong: confusion.rules.wrong,
      confusion_wrong_model: confusion.confidently_wrong_model.wrong,
      temporal_earliest_confirmation: temporal.earliest_confirmation,
      experiments: Object.fromEntries(Object.entries(experiments.results).map(([name, r]) => [name, {
        positives: `${r.positives.correct}/${r.positives.runs}`, sparse_yes: `${r.sparse_yes.yes}/${r.sparse_yes.runs}`, adversarial_runs_with_word: r.adversarial.runs_with_accept }])),
    },
    known_risks: Object.keys(risks.synthetic_rule_outcomes).filter(name => risks.synthetic_rule_outcomes[name].length),
    demo_mitigation: risks.demo_mitigation,
    triage: issues,
  };
}

export function reportMarkdown(report) {
  const lines = ["# Evaluation and triage report", "", `Release status: **${report.release_status}**. ${report.status}`, "",
    `Current worker \`${String(report.current_worker).slice(0, 12)}\`: ${report.current_worker_evidence ? `${report.current_worker_evidence.outcome.correct}/${report.current_worker_evidence.outcome.signed_trials} correct, ${report.current_worker_evidence.outcome.wrong_accepted} wrong, ${report.current_worker_evidence.outcome.abstained} abstained (${report.current_worker_evidence.kind.split(" (")[0]})` : "**no real-video evidence**"}.`, "",
    "## Real-video development result (11 inspected clips)", "", "| Sign | Trials | Correct | Wrong | Abstained |", "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.real_video.per_sign).map(([sign, r]) => `| ${sign} | ${r.trials} | ${r.correct} | ${r.wrong} | ${r.abstained} |`), "",
    "## Triage", "", "| Severity | Area | Issue | Evidence | Next action |", "| --- | --- | --- | --- | --- |",
    ...report.triage.map(issue => `| ${issue.severity} | ${issue.area} | ${issue.title} | ${issue.evidence} | ${issue.next_action} |`), "",
    "## Synthetic regression records (not accuracy)", "",
    `- Adversarial non-sign runs producing a word: ${report.synthetic.adversarial.runs_with_accept}/${report.synthetic.adversarial.runs}.`,
    `- Rules-only cross-sign confusions: ${Object.keys(report.synthetic.confusion_rules_wrong).filter(cell => !cell.startsWith("non-sign")).length}.`,
    ...Object.entries(report.synthetic.experiments).map(([name, r]) => `- ${name}: positives ${r.positives}, sparse YES ${r.sparse_yes}, adversarial runs with a word ${r.adversarial_runs_with_word}.`), "",
    `Demo mitigation: ${report.demo_mitigation}`, ""];
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  const gateIndex = args.indexOf("--gate");
  const gateFiles = gateIndex >= 0 ? args.slice(gateIndex + 1).filter(arg => !arg.startsWith("--")) : [];
  const baseline = json("docs/evaluation/established-baseline.json");
  const gateResult = gateFiles.length ? gate(baseline, gateFiles.flatMap(file => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line))),
    json("docs/evaluation/baseline-change-explanations.json"), json("docs/evaluation/cohort-lock-2026-10-16.json")) : null;
  const report = buildReport({ baseline, runtimes: json("docs/evaluation/evaluated-runtimes.json").runtimes,
    currentWorker: createHash("sha256").update(readFileSync("public/workers/recognition.worker.js")).digest("hex"),
    adversarial: json("docs/gitex/adversarial-inventory.json"), confusion: json("docs/gitex/sprint-2/confusion-matrix.json"),
    temporal: json("docs/gitex/sprint-2/temporal-stress.json"), experiments: json("docs/gitex/sprint-2/experiments.json"),
    risks: json("docs/gitex/known-false-accept-risks.json"), gateResult });
  if (optional("out/runtime-manifest.json")) report.export_runtime = optional("out/runtime-manifest.json");
  if (out) { writeFileSync(`${out}.json`, JSON.stringify(report, null, 2) + "\n"); writeFileSync(`${out}.md`, reportMarkdown(report)); }
  else console.log(reportMarkdown(report));
  if (gateResult && !gateResult.ok) process.exit(1);
}
