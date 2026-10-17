// Force a callback timeout after a real NO confirmation. This is a technical
// failure-path control, not another independent sign-accuracy observation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { failedEvaluationTrial } from "../scripts/evaluation-failed-trial.mjs";
import { summarizeTrials } from "../scripts/evaluation-metrics.mjs";

const executable = process.argv[2]; if (!executable) throw new Error("Supply Chrome executable after building the export and QA lab");
const fixture = JSON.parse(await readFile("docs/evaluation/popsign-development-2026-10-16.json", "utf8")).find(row => row.expected_gloss === "NO");
assert.equal(createHash("sha256").update(await readFile(fixture.file)).digest("hex"), fixture.recording_sha256);
const port = 18500 + Math.floor(Math.random() * 400), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--port", String(port)], { stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await startChrome(executable, { forwardAssets: true });
  await browser.send("Page.navigate", { url: `${origin}/__qa/recognition-lab.html` });
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate("!!window.signrelayLab")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await browser.evaluate(`(() => {
    for (const [id, value] of Object.entries(${JSON.stringify({ language: "asl", participant: fixture.participant_id,
      "trial-type": "sign", expected: "NO", split: "development", provenance: "licensed source; forced callback failure control" })})) document.getElementById(id).value = value;
    const native = HTMLVideoElement.prototype.requestVideoFrameCallback;
    let requests = 0; window.__forcedCallbackFailure = false;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      const withhold = ++requests === 30;
      return native.call(this, (now, info) => {
        if (withhold) window.__forcedCallbackFailure = true;
        else callback(now, info);
      });
    };
  })()`);
  const document = await browser.send("DOM.getDocument");
  const { nodeId } = await browser.send("DOM.querySelector", { nodeId: document.root.nodeId, selector: "#file" });
  await browser.send("DOM.setFileInputFiles", { nodeId, files: [path.resolve(fixture.file)] });
  const result = await browser.evaluate(`(async () => {
    try { await window.signrelayLab.evaluateFile(document.getElementById('file').files[0]); return {unexpected_success:true}; }
    catch (error) { return {error:String(error), forced:window.__forcedCallbackFailure, partial:window.signrelayLab.rows.at(-1)}; }
  })()`);
  assert.equal(result.forced, true); assert.match(result.error, /Video frame delivery timed out/);
  const row = failedEvaluationTrial(fixture, "development", result.partial, result.error);
  assert(row.frames > 0 && row.frames < 51); assert(row.analyses > 0);
  assert(row.accepted_glosses.includes("NO")); assert.equal(row.status, "error");
  const [metrics] = summarizeTrials([row]); assert.equal(metrics.correct, 0); assert.equal(metrics.signed_errors, 1);
  console.log(JSON.stringify({ passed: true, forced_failure: true, technical_control_only: true,
    recording_sha256: fixture.recording_sha256, partial_frames: row.frames, partial_hand_frames: row.hand_frames,
    partial_analyses: row.analyses, retained_glosses: row.accepted_glosses, status: row.status,
    successful_signed_trials: metrics.correct, errors: metrics.signed_errors, no_raw_landmarks_retained: true }));
} finally { await browser?.close(); server.kill(); }
