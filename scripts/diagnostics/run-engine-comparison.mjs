// Run the real camera paths on the same 15 fps recording reel. No worker output is injected.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startChrome } from "./chrome-session.mjs";

const [executable, origin, reel, truthFile, engine, output] = process.argv.slice(2);
assert(executable && origin && reel && truthFile && output && ["engine1", "v3-balanced", "v3-strict", "integrated-v3"].includes(engine),
  "Supply Chromium executable, origin, Y4M reel, truth JSON, engine1|v3-balanced|v3-strict|integrated-v3 and output JSON");
assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use a loopback export");
const isV3 = engine.startsWith("v3-");
const integrated = engine === "integrated-v3";
const clipPlan = JSON.parse(await readFile(truthFile, "utf8"));
const firstSignMs = clipPlan.segments[0].start * 1000;
// Optional: record the exact V3.1 landmark observations the integrated recognition
// worker receives, for offline comparisons on identical inputs. Not committed.
const captureFile = process.env.CAPTURE_OBSERVATIONS;

async function waitFor(browser, condition, label, attempts = 400) {
  for (let i = 0; i < attempts; i++) {
    const value = await browser.evaluate(condition);
    if (value) return value;
    await delay(50);
  }
  throw new Error(label);
}

function scores(truth, events, cameraStart) {
  const intervals = truth.map(row => ({ ...row, events: [] }));
  const idleEvents = [];
  for (const event of events) {
    const anchor = (event.anchor - cameraStart) / 1000;
    // Give both pipelines the same margin to finish a sign and reject events in
    // the rest of a two-second blank gap. Late output is reported independently.
    const interval = intervals.find(row => anchor >= row.start - 0.10 && anchor <= row.end + 0.85);
    (interval?.events ?? idleEvents).push({ ...event, anchor,
      outputAt: (event.at - cameraStart) / 1000, delayFromClipEndMs: interval ? Math.round(event.at - cameraStart - interval.end * 1000) : null });
  }
  const norm = label => label?.replaceAll("-", " ").replace(/\s+/g, " ").trim().toUpperCase();
  for (const interval of intervals) {
    const accepted = interval.events.filter(event => event.status === "accepted");
    interval.outcome = interval.category === "out_of_vocabulary"
      ? (accepted.length ? "false-accept" : "rejected")
      : !accepted.length ? "abstained" : accepted.some(event => norm(event.label) !== norm(interval.label)) ? "wrong" : "correct";
    interval.duplicateAccepts = Math.max(0, accepted.length - 1);
  }
  return { intervals, idleEvents, idleAccepts: idleEvents.filter(event => event.status === "accepted").length };
}

const hash = createHash("sha256");
for await (const chunk of createReadStream(reel)) hash.update(chunk);
const browser = await startChrome(executable, {
  proxy: null, dismissOnboarding: integrated,
  extraArgs: [`--use-file-for-fake-video-capture=${resolve(reel)}`, "--disable-background-timer-throttling"],
});
try {
  await browser.send("Performance.enable");
  const attempted = [];
  browser.onEvent(message => {
    if (message.method !== "Network.requestWillBeSent") return;
    const url = new URL(message.params.request.url);
    if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) attempted.push(url.href);
  });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const isV3 = ${isV3}, integrated = ${integrated};
    const probe = window.__comparison = { start: null, errors: [], frames: [], events: [], tracks: [], classifications: [] };
    window.__comparisonSpoken = [];
    if (window.speechSynthesis) {
      const speak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = utterance => { window.__comparisonSpoken.push(utterance.text); return speak(utterance); };
    }
    document.addEventListener("playing", event => {
      if (event.target instanceof HTMLVideoElement && event.target.srcObject) probe.start ??= performance.now();
    }, true);
    window.addEventListener("error", event => { if (event.message) probe.errors.push(event.message); });
    window.addEventListener("unhandledrejection", event => probe.errors.push(String(event.reason)));
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await getUserMedia(options);
      probe.tracks.push(...stream.getTracks());
      return stream;
    };
    window.Worker = class extends Worker {
      constructor(url, options) {
        super(url, options);
        this.isRecognition = String(url).includes("recognition.worker.js") || String(url).endsWith("/worker.js");
        this.addEventListener("error", error => probe.errors.push(error.message || "Worker error"));
        if (!this.isRecognition) return;
        this.addEventListener("message", ({ data }) => {
          if (probe.start === null) return;
          const now = performance.now();
          if (isV3) {
            if (data.type === "frame") probe.frames.push({ at: data.ts, hands: Boolean(data.hands) });
            if (data.type === "result" && Number.isFinite(data.result?.ms)) probe.classifications.push(data.result.ms);
            if (data.type === "error") probe.errors.push(data.message);
          } else {
            if (integrated && data.type === "suggestion") probe.events.push({ status: "accepted", label: data.gloss, source: "model-suggestion", at: now, anchor: data.timestamp - performance.timeOrigin });
            if (data.type === "confirmed") probe.events.push({ status: "accepted", label: data.gloss, source: data.source, at: now, anchor: data.timestamp - performance.timeOrigin });
            if (data.type === "fault" || /could not (run|be checked)/i.test(data.feedback ?? "")) probe.errors.push(data.message ?? data.feedback);
            if (data.type === "analysis" && data.source === "model" && data.candidate) probe.events.push({
              status: "suggested", label: data.candidate, source: data.source, at: now, anchor: now,
            });
          }
        });
      }
      postMessage(message, ...rest) {
        if (!isV3 && this.isRecognition && message.type === "frame" && probe.start !== null) {
          probe.frames.push({ at: message.frame.timestamp, hands: message.frame.hands.length > 0 });
          if (${Boolean(captureFile)} && message.frame.aslV3Features) (probe.observations ??= []).push({ t: message.frame.timestamp,
            f: Array.from(message.frame.aslV3Features, value => Number.isFinite(value) ? value : null) });
        }
        return super.postMessage(message, ...rest);
      }
    };
  })();` });
  const policy = isV3 ? engine.slice(3) : integrated ? "strict" : null;
  await browser.send("Page.navigate", { url: isV3 ? `${origin}/?delegate=cpu&policy=${policy}` : `${origin}/?perf` });
  const readyCondition = isV3
    ? "document.body?.dataset.ready === '1'"
    : "Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))";
  await waitFor(browser, readyCondition, "Page did not initialize");
  const pageReadyMs = await browser.evaluate("performance.now()");
  const beforeHeap = (await browser.send("Performance.getMetrics")).metrics.find(item => item.name === "JSHeapUsedSize")?.value;
  const startButton = isV3 ? "document.querySelector('#startcam')" : integrated ? "document.querySelector('.hero-actions button')" : "document.querySelector('.figma-hero-actions button')";
  const requested = await browser.evaluate(`(() => { const now = performance.now(); ${startButton}.click(); return now; })()`);
  const activeCondition = isV3 ? "document.body?.dataset.camera === 'on'" : "document.querySelector('.status-badge')?.textContent === 'Active'";
  await waitFor(browser, `(${activeCondition}) && window.__comparison.start !== null`, "Camera did not activate");
  const startup = await browser.evaluate(`(() => {
    const {width, height, frameRate} = window.__comparison.tracks[0].getSettings();
    return { active: performance.now(), cameraStart: window.__comparison.start, camera: {width, height, frameRate} };
  })()`);
  assert(startup.active - startup.cameraStart < firstSignMs, "Tracking initialized after first sign; rerun or lengthen the preroll");
  await delay(Math.max(0, (clipPlan.duration - 0.4) * 1000 - (startup.active - startup.cameraStart)));
  const manifest = integrated ? await (await fetch(`${origin}/runtime-manifest.json`)).json() : null;
  const data = await browser.evaluate(`(() => {
    const probe = window.__comparison;
    const currentTime = [...document.querySelectorAll("video")].find(node => node.srcObject)?.currentTime;
    const lab = window.__v3?.state;
    const events = ${isV3} ? lab.events.filter(event => event.source === "camera" && event.segment).map(event => ({
      status: event.status, label: event.label, at: event.perf, anchor: event.segment[1], segment: event.segment, policy: event.policy,
    })) : probe.events;
    return { events, frames: probe.frames, errors: probe.errors, classifications: probe.classifications,
      currentTime, performance: document.querySelector("#diag, [data-perf]")?.textContent,
      cameraStatus: document.querySelector("#status, .status-badge")?.textContent,
      analysed: lab?.stats.done, skipped: lab?.stats.skipped,
      modelHash: lab?.meta.model_sha256, labRevision: lab?.meta.commit,
      transcriptEntries: document.querySelectorAll(".transcript-entry").length, spoken: window.__comparisonSpoken };
  })()`);
  if (captureFile) {
    const observations = await browser.evaluate("window.__comparison.observations ?? []");
    await writeFile(captureFile, JSON.stringify({ reel_sha256: null, cameraStart: startup.cameraStart, observations }) + "\n", { flag: "wx" });
  }
  const afterHeap = (await browser.send("Performance.getMetrics")).metrics.find(item => item.name === "JSHeapUsedSize")?.value;
  const stopButton = isV3
    ? "document.querySelector('#stopcam')"
    : "[...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Pause camera')";
  await browser.evaluate(`${stopButton}?.click()`);
  await waitFor(browser, "window.__comparison.tracks.every(track => track.readyState === 'ended')", "Stopping leaked a camera track");
  const frames = data.frames.filter(frame => (frame.at - startup.cameraStart) / 1000 < clipPlan.duration);
  const tracking = {
    analysedOrForwardedFrames: frames.length,
    handFrames: frames.filter(frame => frame.hands).length,
    analysedOrForwardedFps: frames.length / data.currentTime,
    perSign: clipPlan.segments.map(({ trial_id, start, end }) => {
      const inInterval = frames.filter(frame => frame.at >= startup.cameraStart + start * 1000 && frame.at <= startup.cameraStart + end * 1000);
      let longestHandRun = 0, handRun = 0;
      for (const frame of inInterval) {
        handRun = frame.hands ? handRun + 1 : 0;
        longestHandRun = Math.max(longestHandRun, handRun);
      }
      return { trial_id, observations: inInterval.length, handObservations: inInterval.filter(frame => frame.hands).length, longestHandRun };
    }),
  };
  const display = scores(clipPlan.segments, data.events, startup.cameraStart);
  const report = {
    scope: "publisher-labelled development footage through a Chromium fake camera; no physical camera or signer trial",
    engine, browser: execFileSync(executable, ["--version"], { encoding: "utf8" }).trim(),
    reel_sha256: hash.digest("hex"), policy, modelHash: manifest?.asl_engine?.model_sha256 ?? data.modelHash, labRevision: data.labRevision,
    applicationRevision: manifest?.application_revision, trackerHash: manifest?.asl_engine?.tracker_worker_sha256,
    outputMeaning: integrated ? "Policy-accepted model suggestions requiring manual review; scoring uses emission time, not segment end" : isV3 ? "Lab policy-accepted segments" : "Automatically confirmed starter signs",
    transcriptEntries: data.transcriptEntries, spoken: data.spoken,
    camera: startup.camera, startupMs: { pageReadyMs, cameraClickToActiveMs: startup.active - requested,
      playbackToTrackingMs: startup.active - startup.cameraStart }, playbackSeconds: data.currentTime,
    mainThreadJsHeapBytes: { before: beforeHeap, after: afterHeap },
    tracking, fixtureDurationSeconds: clipPlan.duration, performance: data.performance,
    reportedAnalysed: data.analysed, reportedSkipped: data.skipped, modelTimingMs: data.classifications,
    outboundRequests: attempted, runtimeErrors: data.errors, browserErrors: browser.errors,
    cameraStatus: data.cameraStatus, tracksStopped: true, ...display,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ engine, report: output, tracking: { frames: tracking.analysedOrForwardedFrames, fps: tracking.analysedOrForwardedFps },
    rows: display.intervals.map(({ trial_id, outcome, events }) => [trial_id, outcome, events.filter(event => event.status === "accepted").map(event => event.label)]),
    runtimeErrors: report.runtimeErrors, idleAccepts: display.idleAccepts }));
  if (integrated) {
    assert.equal(data.transcriptEntries, 0, "Unreviewed suggestions entered the transcript");
    assert.deepEqual(data.spoken, [], "Unreviewed suggestions were spoken");
  }
  assert(data.currentTime >= clipPlan.segments.at(-1).end + 1, "Camera did not play through the final trial");
  assert(data.currentTime <= clipPlan.duration, "Camera playback wrapped; results are invalid");
  assert(attempted.length === 0 && data.errors.length === 0, "The camera run saw outbound requests or runtime errors");
} finally {
  await browser.close();
}
