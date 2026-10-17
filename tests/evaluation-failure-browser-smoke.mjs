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
    window.__forcedCallbackFailure = false; window.__observedFrames = 0; window.__confirmedNo = false;
    window.signrelayLab.setTraceObserver(event => {
      if (event.type === 'frame') window.__observedFrames++;
      if (event.type === 'worker' && event.message.type === 'confirmed' && event.message.gloss === 'NO') window.__confirmedNo = true;
    });
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      return native.call(this, (now, info) => {
        // Count processed source frames, not callback registrations: a stepper
        // may correctly cancel speculative callbacks while waiting for seeked.
        if (window.__observedFrames >= 30 && window.__confirmedNo) window.__forcedCallbackFailure = true;
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
  assert.equal(result.forced, true, JSON.stringify(result)); assert.match(result.error, /Video frame delivery timed out/);
  const row = failedEvaluationTrial(fixture, "development", result.partial, result.error);
  assert(row.frames > 0 && row.frames < 51); assert(row.analyses > 0);
  assert(row.accepted_glosses.includes("NO")); assert.equal(row.status, "error");
  const [metrics] = summarizeTrials([row]); assert.equal(metrics.correct, 0); assert.equal(metrics.signed_errors, 1);
  await browser.send("Page.navigate", { url: `${origin}/__qa/recognition-lab.html` });
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate("!!window.signrelayLab")) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const camera = await browser.evaluate(`(async () => {
    document.getElementById('provenance').value = 'synthetic-camera interruption control';
    document.getElementById('camera').click();
    for (let i = 0; i < 300; i++) {
      if (document.getElementById('status').textContent.startsWith('Camera running')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    document.getElementById('trial').click();
    await new Promise(resolve => setTimeout(resolve, 250));
    let overlappingFile;
    try { await window.signrelayLab.evaluateFile(new File([], 'unused.webm')); }
    catch(error) { overlappingFile=String(error); }
    document.getElementById('camera').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const overlappingCamera = document.getElementById('status').textContent;
    document.getElementById('stop').click();
    for (let i = 0; i < 150; i++) {
      if (window.signrelayLab.rows.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return {row:window.signrelayLab.rows.at(-1), overlappingFile, overlappingCamera};
  })()`);
  assert.match(camera.overlappingFile, /trial is already running/);
  assert.match(camera.overlappingCamera, /Finish the active diagnostic trial/);
  assert.equal(camera.row.capture_mode, "physical-camera"); assert.equal(camera.row.status, "error");
  assert(camera.row.frames > 0); assert(camera.row.errors.some(error => error.includes("Camera trial interrupted")));
  const [cameraMetrics] = summarizeTrials([camera.row]); assert.equal(cameraMetrics.correct, 0); assert.equal(cameraMetrics.signed_errors, 1);
  console.log(JSON.stringify({ passed: true, forced_failure: true, technical_control_only: true,
    recording_sha256: fixture.recording_sha256, partial_frames: row.frames, partial_hand_frames: row.hand_frames,
    partial_analyses: row.analyses, retained_glosses: row.accepted_glosses, status: row.status,
    successful_signed_trials: metrics.correct, errors: metrics.signed_errors, no_raw_landmarks_retained: true,
    camera_stop_control: { synthetic_camera_only: true, frames: camera.row.frames, status: camera.row.status,
      signed_errors: cameraMetrics.signed_errors, successful_signed_trials: cameraMetrics.correct, overlapping_trials_rejected: true } }));
} finally { await browser?.close(); server.kill(); }
