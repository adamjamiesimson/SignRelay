#!/usr/bin/env node
// Metadata-only paired ASL analysis; never reads or publishes video.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = ["HELLO", "THANK YOU", "PLEASE"];
const PROVENANCE = ["fixture_id", "language", "trial_type", "expected_gloss", "source_file", "notes", "participant_id", "device", "condition", "frame_mode"];
const allowed = new Set(["correct", "wrong", "rejected", "extra_prediction", "timeout", "error", "correct_reject", "false_accept"]);
const safe = value => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const pct = value => typeof value === "number" && Number.isFinite(value) ? (value * 100).toFixed(1) + "%" : "n/a";
function fingerprint(notes) {
  return /(?:^|[;\s])sha256=([a-f0-9]{64})(?:[;\s]|$)/i.exec(String(notes ?? ""))?.[1]?.toLowerCase() ?? null;
}
function collect(rows, run) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(run + ": no evaluation records");
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.fixture_id !== "string" || !row.fixture_id || map.has(row.fixture_id)) {
      throw new Error(run + ": duplicate or missing fixture ID");
    }
    if (row.language !== "asl" || !["sign", "no_sign"].includes(row.trial_type) || !allowed.has(row.outcome)) {
      throw new Error(run + ": invalid ASL trial/outcome for " + row.fixture_id);
    }
    if ((row.trial_type === "sign" && (!row.expected_gloss || typeof row.expected_gloss !== "string")) ||
        (row.trial_type === "no_sign" && row.expected_gloss !== null)) {
      throw new Error(run + ": invalid ground truth for " + row.fixture_id);
    }
    if (!fingerprint(row.notes) || !row.source_file || !row.participant_id) {
      throw new Error(run + ": missing signer/source/SHA-256 provenance for " + row.fixture_id);
    }
    if (row.outcome === "correct" && (row.predicted_gloss !== row.expected_gloss || row.accepted !== true)) {
      throw new Error(run + ": inconsistent correct outcome for " + row.fixture_id);
    }
    if (row.trial_type === "no_sign" && ((row.outcome === "false_accept" && !row.accepted) ||
        (row.outcome === "correct_reject" && row.accepted))) {
      throw new Error(run + ": inconsistent no-sign outcome for " + row.fixture_id);
    }
    map.set(row.fixture_id, row);
  }
  return map;
}
export function analyzePair(first, second) {
  const a = collect(first, "Run A"), b = collect(second, "Run B");
  if (a.size !== b.size || [...a.keys()].some(id => !b.has(id))) {
    throw new Error("Paired runs must contain exactly the same fixture IDs");
  }
  const observedHashes = new Map(), paired = [], changed = [];
  for (const [id, left] of a) {
    const right = b.get(id);
    for (const field of PROVENANCE) if (left[field] !== right[field]) {
      throw new Error("Paired fixture provenance changed at " + field + " for " + id);
    }
    const hash = fingerprint(left.notes);
    if (observedHashes.has(hash)) throw new Error("Duplicate source SHA-256 for " + id + " and " + observedHashes.get(hash));
    observedHashes.set(hash, id);
    const stable = left.predicted_gloss === right.predicted_gloss &&
      left.outcome === right.outcome && left.accepted === right.accepted;
    if (!stable) changed.push(id);
    paired.push({id,left,right,stable});
  }
  const signed = paired.filter(p => p.left.trial_type === "sign");
  const negative = paired.filter(p => p.left.trial_type === "no_sign");
  const targets = [...new Set([...TARGETS, ...signed.map(p => p.left.expected_gloss)])];
  const metrics = targets.map(gloss => {
    const group = signed.filter(p => p.left.expected_gloss === gloss);
    const calc = side => ({
      correct: group.filter(p => p[side].outcome === "correct").length,
      rejected: group.filter(p => p[side].outcome === "rejected").length,
      wrong: group.filter(p => ["wrong", "extra_prediction"].includes(p[side].outcome)).length,
      incomplete: group.filter(p => ["error", "timeout"].includes(p[side].outcome)).length,
      hand: group.length ? group.reduce((sum,p) => sum + (Number(p[side].tracker?.hand_coverage) || 0),0)/group.length : null,
    });
    return {gloss,n:group.length,signers:new Set(group.map(p=>p.left.participant_id).filter(x=>x!=="fixture")).size,a:calc("left"),b:calc("right")};
  });
  const confusion = new Map();
  for (const p of signed) for (const [run,row] of [["A",p.left],["B",p.right]]) {
    if (!["wrong","extra_prediction"].includes(row.outcome)) continue;
    const key = JSON.stringify([run,p.left.expected_gloss,row.predicted_gloss ?? "REJECT"]);
    confusion.set(key,(confusion.get(key)||0)+1);
  }
  return {
    paired,changed,metrics,total:paired.length,signed:signed.length,negative:negative.length,
    falseA:negative.filter(p=>p.left.accepted).length,falseB:negative.filter(p=>p.right.accepted).length,
    confusion:[...confusion].map(([k,count])=>({parts:JSON.parse(k),count})).sort((x,y)=>y.count-x.count),
    lowCoverage:metrics.filter(m=>TARGETS.includes(m.gloss)&&(m.n<6||m.signers<3)).map(m=>m.gloss),
    lowNegatives:negative.length<10,
  };
}
export function renderReport(r) {
  const lines=[
    "# SignRelay: paired ASL confusion diagnostics","",
    "**Diagnostic only. NOT independent-signer accuracy or release approval.**",
    "These are identical, fingerprinted fixtures replayed twice. Replay timing varies and tuned fixtures are no longer independent holdout evidence.","",
    "Paired trials: "+r.total+" ("+r.signed+" signed, "+r.negative+" non-sign). Changed outcomes or predictions: "+r.changed.length+"/"+r.total+".",
    "Non-sign false accepts: "+r.falseA+"/"+r.negative+" in A, "+r.falseB+"/"+r.negative+" in B.","",
    "## Sign-level evidence","",
    "| Expected | Clips | Signers | Correct A/B | Rejected A/B | Wrong/extra A/B | Error/timeout A/B | Mean hand coverage A/B |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for(const m of r.metrics) lines.push("| "+safe(m.gloss)+" | "+m.n+" | "+m.signers+" | "+m.a.correct+"/"+m.b.correct+" | "+m.a.rejected+"/"+m.b.rejected+" | "+m.a.wrong+"/"+m.b.wrong+" | "+m.a.incomplete+"/"+m.b.incomplete+" | "+pct(m.a.hand)+" / "+pct(m.b.hand)+" |");
  lines.push("","## Wrong accepted glosses","",
    "| Run | Expected | Predicted | Count |","| --- | --- | --- | ---: |");
  if(!r.confusion.length) lines.push("| — | — | — | 0 |");
  for(const c of r.confusion) lines.push("| "+c.parts.map(safe).join(" | ")+" | "+c.count+" |");
  lines.push("","## Unstable fixtures","",
    "| Fixture | Expected | A prediction (outcome) | B prediction (outcome) |",
    "| --- | --- | --- | --- |");
  if(!r.changed.length) lines.push("| — | — | — | — |");
  for(const p of r.paired.filter(p=>!p.stable)) lines.push("| "+[p.id,p.left.expected_gloss??"NO_SIGN",safe(p.left.predicted_gloss)+" ("+p.left.outcome+")",safe(p.right.predicted_gloss)+" ("+p.right.outcome+")"].map(safe).join(" | ")+" |");
  lines.push("","## Evidence limitations","",
    r.lowCoverage.length ? "Fewer than six clips or three identified signers for these target signs: "+r.lowCoverage.join(", ")+".": "Target-sign counts meet a suggested small pilot minimum; independence from training and tuning is **not** established.",
    r.lowNegatives ? "Fewer than ten non-sign-intent clips; a false-accept rate cannot be generalized." : "Ten or more non-sign-intent clips exist, but do not establish real-world false-accept rates.",
    "Before a release decision, obtain additional previously unseen, licensed or consented clips with verified signer and recording separation, human label review, and live-device testing.",
    "No source media, landmarks or names are included; fixture IDs must be pseudonymous.","");
  return lines.join("\n");
}
async function main() {
  const [a,b,destination="work/popsign/confusions.md"]=process.argv.slice(2);
  if(!a||!b) throw new Error("Usage: node scripts/report-asl-confusions.mjs <run-a.jsonl> <run-b.jsonl> [report.md]");
  const load=async f=>(await readFile(resolve(f),"utf8")).split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s));
  const report=analyzePair(await load(a),await load(b));
  const output=resolve(destination);
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,renderReport(report),"utf8");
  console.log("ASL paired report: "+report.changed.length+"/"+report.total+" results changed; "+output+" (not release validation).");
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
}
