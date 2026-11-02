// Which camera frame did the tracker actually receive, and with what timestamp?
// Drives the real rehearsal export (npm run build:rehearsal) through Chrome's
// fake camera with a synthetic frame-index pattern (no person, no landmarks).
// The production tracking worker is wrapped only to decode the index painted
// in each bitmap before the unchanged production handler runs.
//
// usage: node scripts/diagnostics/frame-identity-browser.mjs <chrome> <words|words-capture|fingerspelling> <fps> <seconds> <out.json>
// words-capture enables the opt-in word-mode capture-time clock (?perf&captureClock=capture).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openRehearsal, until, pause } from "../../tests/rehearsal-harness.mjs";
import { writeIdentityY4m, DECODE_SOURCE, analyseSchedule } from "./frame-identity.mjs";

const [chrome, mode = "words", fpsArg = "30", secondsArg = "10", out = "work/frame-identity.json"] = process.argv.slice(2);
const fps = Number(fpsArg), seconds = Number(secondsArg);
if (!chrome || !["words", "words-capture", "fingerspelling"].includes(mode) || !(fps > 0) || !(seconds > 0)) throw new Error("usage: <chrome> <words|words-capture|fingerspelling> <fps> <seconds> <out.json>");
const video = resolve(tmpdir(), `signrelay-identity-${fps}.y4m`);
writeIdentityY4m(video, { fps, frames: Math.min(4000, Math.ceil(fps * (seconds + 40))) });

for (const name of ["vision.worker", "fingerspelling-vision.worker"]) {
  writeFileSync(`out/workers/${name}.identity.js`, `${DECODE_SOURCE}
importScripts("/workers/${name}.js");
const production = self.onmessage; let canvas;
self.onmessage = async event => {
  if (event.data.type === "frame") {
    const bitmap = event.data.bitmap, w = bitmap.width, h = bitmap.height;
    if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
    self.postMessage({ type: "diagnostic-identity", index: __decodeIdentity(ctx.getImageData(0, 0, w, h).data, w, h), timestamp: event.data.timestamp, received: performance.now() });
  }
  await production(event);
};`);
}

const h = await openRehearsal(chrome, { extraArgs: [`--use-file-for-fake-video-capture=${video}`], extraInit: `
  ${DECODE_SOURCE}
  window.__identity = { tracked: [], presented: [], measuring: false };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      const tracker = /\\/(fingerspelling-)?vision\\.worker\\.js$/.test(String(url));
      super(tracker ? String(url).replace(/\\.js$/, ".identity.js") : url, options);
      if (tracker) this.addEventListener("message", event => {
        if (event.data.type === "diagnostic-identity" && window.__identity.measuring) window.__identity.tracked.push(event.data);
      });
    }
  };
  // Independent ground truth: a WebCodecs VideoFrame carries its pixels and its
  // own timestamp together, so the index decoded from it is paired exactly.
  // (Callback metadata alone can describe a different frame; see
  // snapshot-fidelity-browser.mjs.)
  const canvas = new OffscreenCanvas(240, 180), context = canvas.getContext("2d", { willReadFrequently: true });
  const watch = () => {
    const video = document.querySelector("video");
    if (!video || !video.requestVideoFrameCallback) { setTimeout(watch, 50); return; }
    const observe = (now, meta) => {
      if (window.__identity.measuring) {
        const frame = new VideoFrame(video), mediaTime = frame.timestamp / 1e6;
        context.drawImage(frame, 0, 0, 240, 180); frame.close();
        window.__identity.presented.push({ index: __decodeIdentity(context.getImageData(0, 0, 240, 180).data, 240, 180),
          mediaTime, metadataMediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames, callbackAt: now });
      }
      video.requestVideoFrameCallback(observe);
    };
    video.requestVideoFrameCallback(observe);
  };
  document.addEventListener("DOMContentLoaded", watch);
` });
try {
  await h.open(mode === "words-capture" ? "/?perf&captureClock=capture" : "/?perf");
  await h.start();
  if (mode === "fingerspelling") await h.click("Fingerspelling");
  // Let the tracker for this mode finish starting before measuring.
  await until(() => h.evaluate(`document.querySelector('.status-badge')?.textContent === 'Active'`), "Camera inactive");
  await pause(4000);
  await h.evaluate("window.__identity.measuring = true");
  await pause(seconds * 1000);
  await h.evaluate("window.__identity.measuring = false");
  const data = await h.evaluate("JSON.parse(JSON.stringify(window.__identity))");
  const presented = new Map();
  for (const frame of data.presented) if (frame.index >= 0 && !presented.has(frame.index))
    presented.set(frame.index, { ...frame, reference: frame.mediaTime * 1000 });
  const presentedIndices = [...presented.keys()].sort((a, b) => a - b);
  const sourceSpan = presentedIndices.length ? presentedIndices.at(-1) - presentedIndices[0] + 1 : 0;
  const summary = {
    kind: "synthetic frame-index pattern through Chrome fake camera and the production tracker; schedule/timing only, not recognition",
    mode, sourceFps: fps, seconds, userAgent: await h.evaluate("navigator.userAgent"),
    metadataDescribedOtherFrame: data.presented.filter(frame => Math.abs(frame.mediaTime - frame.metadataMediaTime) > 1e-4).length,
    presented: { callbacks: data.presented.length, uniqueSourceFrames: presented.size, sourceSpan, notPresented: sourceSpan - presented.size },
    schedule: analyseSchedule(data.tracked, presented, fps),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, tracked: data.tracked.map(({ index, timestamp }) => ({ index, timestamp })), presented: data.presented }, null, 1));
  console.log("FRAME-IDENTITY", JSON.stringify(summary));
} finally { await h.close(); }
