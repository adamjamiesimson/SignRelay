import { VisionEngine } from "../../lib/vision-engine";
import { RecognitionSession } from "../../lib/recognition-session";
import { diagnoseHandedness } from "../../lib/handedness-diagnostic";
import { summarizeTrials } from "../evaluation-metrics.mjs";
import type { LanguageId } from "../../lib/model-adapters";
import type { VisionFrame, WorkerConfirmation } from "../../lib/vision-types";
import { TASKS_VERSION as TASKS_WASM_VERSION } from "../../lib/vision-runtime.mjs";

declare const __TASKS_JS_VERSION__: string;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => el<HTMLInputElement>(id).value.trim();
const checked = (id: string) => el<HTMLInputElement>(id).checked;
const status = (message: string) => { el("status").textContent = message; };
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const video = el<HTMLVideoElement>("video"), canvas = el<HTMLCanvasElement>("canvas");
const rows: Record<string, unknown>[] = [];
let engine: VisionEngine | null = null, stream: MediaStream | null = null, live = false, busy = false;
let trial: ReturnType<typeof startTrial> | null = null;
let sourceUrl: string | null = null;
const params = new URLSearchParams(location.search);
const workerUrl = params.get("baseline") === "1" ? "/workers/baseline-recognition.worker.js"
  : params.get("pr28") === "1" ? "/workers/pr28-recognition.worker.js" : "/workers/recognition.worker.js";
const session = new RecognitionSession(() => new Worker(workerUrl, { type: "module" }), message => {
  if (!trial) return;
  if (message.type === "confirmed") trial.confirmations.push(message);
  if (message.type === "analysis") {
    trial.analyses++;
    if (message.feedback?.includes("could not run") || message.feedback?.includes("could not be checked")) {
      if (!trial.errors.includes(message.feedback)) trial.errors.push(message.feedback);
    }
    const origin = message.source ?? "none";
    trial.sources[origin] = (trial.sources[origin] ?? 0) + 1;
  }
}, state => { if (trial && state.state !== "running") trial.errors.push(state.message); });
function metadata() {
  const participant = value("participant"), split = value("split"), kind = value("trial-type");
  if (!/^[\w.-]{1,64}$/.test(participant)) throw new Error("Use a pseudonym with letters, numbers, dots or hyphens");
  if (split === "held_out" && !checked("independent")) throw new Error("Held-out trials need explicit recording and participant separation");
  if (!value("provenance")) throw new Error("Enter the source license or consent record");
  if (kind === "sign" && !value("expected")) throw new Error("Enter the expected gloss");
  return { trial_id: crypto.randomUUID(), session_id: "lab-" + Date.now(), participant_id: participant,
    language: value("language"), trial_type: kind, expected_gloss: kind === "sign" ? value("expected").toUpperCase() : null,
    evaluation_split: split, provenance: value("provenance"),
    input_mirrored: checked("mirror-input"), preview_mirrored: checked("mirror-preview"),
    tasks_version: TASKS_WASM_VERSION, tasks_js_version: __TASKS_JS_VERSION__, tasks_wasm_version: TASKS_WASM_VERSION, model_mapping: "unchanged" };
}
function startTrial() {
  const data = metadata();
  session.postMessage({ type: "templates", language: data.language as LanguageId, templates: [] });
  return { data, confirmations: [] as WorkerConfirmation[], frames: 0, hands: 0, analyses: 0,
    sources: {} as Record<string, number>, handedness: {} as Record<string, number>, errors: [] as string[], started: performance.now() };
}
function observe(frame: VisionFrame) {
  el("hands").textContent = JSON.stringify({ tasks_version: TASKS_WASM_VERSION, tasks_js_version: __TASKS_JS_VERSION__, tasks_wasm_version: TASKS_WASM_VERSION,
    input_mirrored: checked("mirror-input"), preview_mirrored: checked("mirror-preview"),
    hands: diagnoseHandedness(frame, value("physical-hand") as "Left" | "Right" | "Unknown") }, null, 2);
  if (trial) {
    trial.frames++; if (frame.hands.length) trial.hands++;
    for (const hand of diagnoseHandedness(frame, "Unknown")) {
      const key = `${hand.taskLabel}/pose:${hand.nearestPose}`;
      trial.handedness[key] = (trial.handedness[key] ?? 0) + 1;
    }
  }
  session.postMessage({ type: "frame", frame });
}
function process(timestamp: number) {
  if (!engine) return;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const context = canvas.getContext("2d")!;
  context.save(); if (checked("mirror-input")) { context.translate(canvas.width, 0); context.scale(-1, 1); }
  context.drawImage(video, 0, 0); context.restore();
  observe(engine.process(canvas, timestamp));
}
async function finishTrial(extra: Record<string, unknown> = {}) {
  // Let queued acknowledgements settle; never replay/hold a source frame to
  // manufacture more evidence. The next trial resets any late predictions.
  await sleep(300);
  if (!trial) throw new Error("No trial running");
  if (!trial.frames || !trial.analyses) trial.errors.push("No processed frames or worker acknowledgements");
  const accepted = trial.confirmations.map(message => message.gloss);
  const row = { ...trial.data, ...extra, predicted_gloss: accepted[0] ?? null, accepted: accepted.length > 0,
    accepted_glosses: accepted, confirmed_sources: trial.confirmations.map(message => message.source ?? "unknown"),
    frames: trial.frames, hand_frames: trial.hands, analyses: trial.analyses, candidate_sources: trial.sources, handedness_counts: trial.handedness,
    errors: trial.errors, status: trial.errors.length ? "error" : "complete", duration_ms: performance.now() - trial.started };
  trial = null; session.postMessage({ type: "reset" }); rows.push(row);
  el("results").textContent = JSON.stringify({ latest: row, summary: summarizeTrials(rows) }, null, 2);
  status("Trial complete. Results include every accepted word, including extra wrong words.");
  return row;
}
async function stop() {
  live = false; stream?.getTracks().forEach(track => track.stop()); stream = null;
  video.pause(); video.srcObject = null; video.removeAttribute("src"); video.load();
  engine?.close(); engine = null; session.postMessage({ type: "reset" });
  if (sourceUrl) URL.revokeObjectURL(sourceUrl); sourceUrl = null;
}
async function camera() {
  if (busy) return; await stop(); busy = true;
  try {
    engine = await VisionEngine.create(status);
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream; await video.play(); live = true;
    session.postMessage({ type: "templates", language: value("language") as LanguageId, templates: [] });
    status("Camera running. Raise one known physical hand and compare raw Tasks labels.");
    void (async () => { while (live) { if (video.readyState >= 2) process(performance.now()); await sleep(50); } })().catch(report);
  } catch (error) { await stop(); throw error; } finally { busy = false; }
}
async function evaluateFile(file: File) {
  if (busy) throw new Error("A diagnostic is already running");
  metadata(); busy = true; await stop();
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("Use a recording under 100MB");
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (rows.some(row => row.recording_sha256 === fingerprint)) throw new Error("This recording is already in the results. Export and reload for a separate repeat pass");
    engine = await VisionEngine.create(status); sourceUrl = URL.createObjectURL(file); video.src = sourceUrl;
    await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error("Video could not decode")); video.load(); });
    if (!Number.isFinite(video.duration) || video.duration > 30) throw new Error("Use a recording of at most 30 seconds");
    trial = startTrial(); const base = performance.now(); let previous = -1;
    process(base); previous = 0;
    for (let time = 0.05; time < video.duration; time += 0.05) {
      const next = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => { video.cancelVideoFrameCallback(id); reject(new Error("Video frame delivery timed out")); }, 3000);
        const id = video.requestVideoFrameCallback((_now, info) => { clearTimeout(timer); resolve(info.mediaTime); });
      });
      video.currentTime = time; const decodedTime = await next;
      if (decodedTime > previous + 0.001) { process(base + decodedTime * 1000); previous = decodedTime; }
      await sleep(50);
    }
    return await finishTrial({ recording_sha256: fingerprint, capture_mode: "unique-decoded-source-frames", source_duration_s: video.duration });
  } catch (error) {
    if (trial) { trial.errors.push(String(error)); await finishTrial(); }
    throw error;
  } finally { await stop(); busy = false; }
}
function report(error: unknown) { status(error instanceof Error ? error.message : String(error)); }
el("camera").onclick = () => { void camera().catch(report); };
el("stop").onclick = () => { void stop().then(() => status("Camera released")).catch(report); };
el("trial").onclick = () => { void (async () => {
  if (!live || trial) throw new Error("Start the camera diagnostic first, with no active trial");
  trial = startTrial(); status("Recording derived counters for 5 seconds…"); await sleep(5000);
  await finishTrial({ capture_mode: "physical-camera" });
})().catch(report); };
el("run-file").onclick = () => { const file = el<HTMLInputElement>("file").files?.[0]; if (file) void evaluateFile(file).catch(report); };
el("mirror-preview").onchange = () => { video.style.transform = checked("mirror-preview") ? "scaleX(-1)" : "none"; };
video.style.transform = "scaleX(-1)";
el("export").onclick = () => {
  try {
    summarizeTrials(rows);
    const url = URL.createObjectURL(new Blob([rows.map(row => JSON.stringify(row)).join("\n") + "\n"], { type: "application/x-ndjson" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "signrelay-derived-evaluation.jsonl"; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { report(error); }
};
window.addEventListener("pagehide", () => { void stop(); session.terminate(); });
(window as Window & { signrelayLab?: unknown }).signrelayLab = { evaluateFile, rows, stop };
