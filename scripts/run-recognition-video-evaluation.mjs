// Actual pinned Tasks -> production worker. No raw media/landmarks in output.
// node scripts/run-recognition-video-evaluation.mjs /path/to/chrome manifest.json output.jsonl [--mirrored] [--baseline] [--reviewed-pilot]
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { startChrome } from "./diagnostics/chrome-session.mjs";
import { summarizeTrials } from "./evaluation-metrics.mjs";
const [executable, input, output, ...flags] = process.argv.slice(2);
if (!executable || !input || !output) throw new Error("Supply Chrome executable, manifest JSON and output JSONL");
const manifest = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(manifest) || !manifest.length) throw new Error("Manifest needs trials");
const port = 17000 + Math.floor(Math.random() * 1000), origin = `http://127.0.0.1:${port}`;
const workerSha = createHash("sha256").update(await readFile(flags.includes("--baseline") ? "out/workers/baseline-recognition.worker.js" : "out/workers/recognition.worker.js")).digest("hex");
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
    await browser.send("Page.navigate", { url: `${origin}/__qa/recognition-lab.html${flags.includes("--baseline") ? "?baseline=1" : ""}` });
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
    const row = await browser.evaluate("window.signrelayLab.evaluateFile(document.getElementById('file').files[0])");
    if (fixture.recording_sha256 && fixture.recording_sha256 !== row.recording_sha256) throw new Error("Recording fingerprint differs from frozen manifest");
    Object.assign(row, { trial_id: fixture.trial_id, source: fixture.source, license: fixture.license,
      worker_sha256: workerSha, reviewed_pilot: flags.includes("--reviewed-pilot"),
      version: flags.includes("--baseline") ? "base" : "candidate" });
    rows.push(row); await writeFile(output, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    console.log(JSON.stringify({ trial: fixture.trial_id, expected: row.expected_gloss, confirmed: row.accepted_glosses,
      frames: row.frames, hand_frames: row.hand_frames, status: row.status }));
  }
  const report = { diagnostic_only: true, source_frame_step: true, reviewed_pilot: flags.includes("--reviewed-pilot"),
    assets_fetched_via_node: flags.includes("--fetch-assets-via-node"), browser_errors: browser.errors, groups: summarizeTrials(rows) };
  await writeFile(output + ".summary.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  if (browser) console.error(JSON.stringify({ browser_errors: browser.errors,
    status: await browser.evaluate("document.getElementById('status')?.textContent").catch(() => "unavailable") }));
  throw error;
} finally { await browser?.close(); server.kill(); }
