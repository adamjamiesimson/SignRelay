// Actual pinned Tasks -> production worker. No raw media/landmarks in output.
// node scripts/run-recognition-video-evaluation.mjs /path/to/chrome manifest.json output.jsonl [--mirrored] [--baseline] [--reviewed-pilot]
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { startChrome } from "./diagnostics/chrome-session.mjs";
import { summarizeTrials } from "./evaluation-metrics.mjs";
import { validateManifest, aslVocabulary, fingerprint } from "./evaluation-manifest.mjs";
import { execFileSync } from "node:child_process";
const [executable, input, output, ...flags] = process.argv.slice(2);
if (!executable || !input || !output) throw new Error("Supply Chrome executable, manifest JSON and output JSONL");
const manifestBytes = await readFile(input);
const manifest = JSON.parse(manifestBytes);
if (flags.includes("--reviewed-pilot")) for (const row of manifest) row.evaluation_split = "development";
const registry = JSON.parse(await readFile("docs/evaluation/cohort-lock-2026-10-16.json", "utf8"));
const entry = registry.manifests.find(item => path.resolve(item.file) === path.resolve(input));
if (!entry || entry.sha256 !== fingerprint(manifestBytes)) throw new Error("Manifest is not frozen in the cohort lock; validate and freeze it before replay");
const related = [];
for (const item of registry.manifests) {
  if (item === entry) continue;
  const bytes = await readFile(item.file);
  if (fingerprint(bytes) !== item.sha256) throw new Error("Related cohort manifest changed after freezing");
  const rows = JSON.parse(bytes);
  if (item.role === "historical-development") for (const row of rows) row.evaluation_split = "development";
  related.push(rows);
}
const vocabulary = aslVocabulary();
if (registry.vocabulary_sha256 !== vocabulary.sha256) throw new Error("Installed ASL vocabulary changed after cohort freeze");
validateManifest(manifest, { related, vocabulary, allowHoldout: flags.includes("--final-holdout") });
const installedTasksJs = JSON.parse(await readFile("node_modules/@mediapipe/tasks-vision/package.json", "utf8")).version;
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (flags.includes("--final-holdout")) {
  if (process.env.FINAL_CANDIDATE_SHA !== sourceCommit
    || execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()) {
    throw new Error("Final holdout requires a clean frozen commit matching FINAL_CANDIDATE_SHA");
  }
  // Once-only local receipt; never remove this to rerun/tune against a holdout.
  await mkdir("evaluation/raw/holdout-receipts", { recursive: true });
  await writeFile(`evaluation/raw/holdout-receipts/${fingerprint(manifestBytes)}.json`, JSON.stringify({ sourceCommit, date: new Date().toISOString() }), { flag: "wx" });
}
for (const fixture of manifest) {
  if (fingerprint(await readFile(fixture.file)) !== fixture.recording_sha256) throw new Error(`Recording fingerprint differs before replay: ${fixture.trial_id}`);
}
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, "", { flag: "wx" }); // A failed rerun cannot leave a previous successful result.

const workerVariant = flags.includes("--baseline") ? "base" : flags.includes("--pr28") ? "pr28" : "candidate";
const workerFile = workerVariant === "base" ? "baseline-recognition.worker.js" : workerVariant === "pr28" ? "pr28-recognition.worker.js" : "recognition.worker.js";
const harnessDirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim());
const port = 17000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const workerSha = createHash("sha256").update(await readFile(`out/workers/${workerFile}`)).digest("hex");
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
let browser; const rows = [];
try {
  browser = await startChrome(executable, { forwardAssets: flags.includes("--fetch-assets-via-node") });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const fixture of manifest) {
    // Fresh Tasks tracking and model/worker state for every recording. This
    // prevents prior signers, source poses or predictions leaking between clips.
    await browser.send("Page.navigate", { url: `${origin}/__qa/recognition-lab.html${workerVariant === "base" ? "?baseline=1" : workerVariant === "pr28" ? "?pr28=1" : ""}` });
    for (let i = 0; i < 100; i++) {
      if (await browser.evaluate("!!window.signrelayLab")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const fields = { language: fixture.language, participant: fixture.participant_id,
      "trial-type": fixture.trial_type, expected: fixture.expected_gloss ?? "",
      split: flags.includes("--reviewed-pilot") ? "development" : fixture.evaluation_split ?? "development",
      provenance: `${fixture.source ?? "local consent"} ${fixture.license ?? ""}` };
    await browser.evaluate(`(() => {
      for (const [id, value] of Object.entries(${JSON.stringify(fields)})) document.getElementById(id).value = value;
      document.getElementById('independent').checked = true;
      document.getElementById('mirror-input').checked = ${flags.includes("--mirrored")};
    })()`);
    const document = await browser.send("DOM.getDocument");
    const { nodeId } = await browser.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#file" });
    await browser.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(fixture.file)] });
    let row;
    try {
      row = await browser.evaluate("window.signrelayLab.evaluateFile(document.getElementById('file').files[0])");
    } catch (error) {
      // Persist the failed recording and denominator before stopping the run.
      row = { ...fields, ...fixture, session_id: `failed-${fixture.trial_id}`, predicted_gloss: null,
        accepted: false, accepted_glosses: [], frames: 0, hand_frames: 0, analyses: 0,
        status: "error", errors: [String(error)], evaluation_split: fields.split };
    }
    if (row.status === "complete" && (row.tasks_js_version !== installedTasksJs
      || row.tasks_wasm_version !== "0.10.22-rc.20250304")) throw new Error("Diagnostic does not report the installed JS and pinned WASM versions; rebuild the lab");
    if (fixture.recording_sha256 && fixture.recording_sha256 !== row.recording_sha256) throw new Error("Recording fingerprint differs from frozen manifest");
    Object.assign(row, { trial_id: fixture.trial_id, source: fixture.source, license: fixture.license,
      worker_sha256: workerSha, manifest_sha256: fingerprint(manifestBytes), source_commit: sourceCommit, harness_dirty: harnessDirty, vocabulary_sha256: vocabulary.sha256, reviewed_pilot: flags.includes("--reviewed-pilot"),
      version: workerVariant });
    rows.push(row); await writeFile(output, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    console.log(JSON.stringify({ trial: fixture.trial_id, expected: row.expected_gloss, confirmed: row.accepted_glosses,
      frames: row.frames, hand_frames: row.hand_frames, status: row.status }));
  }
  const report = { diagnostic_only: true, source_frame_step: true, reviewed_pilot: flags.includes("--reviewed-pilot"),
    assets_fetched_via_node: flags.includes("--fetch-assets-via-node"), browser_errors: browser.errors, groups: summarizeTrials(rows) };
  await writeFile(output + ".summary.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (rows.length !== manifest.length || rows.some(row => row.status !== "complete" || row.errors?.length)) throw new Error("Evaluation contains failed/incomplete recordings; results cannot pass");
} catch (error) {
  if (browser) console.error(JSON.stringify({ browser_errors: browser.errors,
    status: await browser.evaluate("document.getElementById('status')?.textContent").catch(() => "unavailable") }));
  throw error;
} finally { await browser?.close(); server.kill(); }
