import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { serve } from "./serve.mjs";

const [chromePath, handFile, modelFile, fixture, indexFile, output, warmupFile] = process.argv.slice(2);
assert(output, "Supply Chrome, hand landmarker, model, Y4M reel, reel index, and output");
const index = JSON.parse(await readFile(indexFile));
const hash = createHash("sha256");
for await (const chunk of createReadStream(fixture)) hash.update(chunk);
assert.equal(hash.digest("hex"), index.sha256);
const server = await serve({ handFile, modelFile, port: 0 });
let browser;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = values => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;
try {
  browser = await startChrome(chromePath, { proxy: "http://127.0.0.1:9",
    extraArgs: ["--use-file-for-fake-video-capture=" + resolve(fixture)] });
  const origin = "http://127.0.0.1:" + server.address().port;
  const external = new Set();
  browser.onEvent(event => {
    if (event.method !== "Network.requestWillBeSent") return;
    const url = event.params.request.url;
    if (!url.startsWith(origin + "/") && !url.startsWith("blob:" + origin + "/")) external.add(url);
  });
  await browser.send("Page.navigate", { url: origin });
  for (let i = 0; i < 100 && !await browser.evaluate("typeof signRelayCameraDiagnostics === 'function'"); i++) await delay(100);
  if (warmupFile) {
    const { root } = await browser.send("DOM.getDocument");
    const { nodeId } = await browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file" });
    await browser.send("DOM.setFileInputFiles", { nodeId, files: [resolve(warmupFile)] });
    for (let i = 0; i < 320; i++) {
      const state = await browser.evaluate("document.getElementById('status').textContent");
      if (state.startsWith("File complete")) break;
      if (/failed|could not/i.test(state) || i === 319) throw new Error("Warm-up file did not complete: " + state);
      await delay(250);
    }
  }
  await browser.evaluate(`(() => {
    const video = document.getElementById('video');
    const ctx = new OffscreenCanvas(8, 8).getContext('2d', { willReadFrequently: true });
    const intervals = [];
    const preview = (_now, metadata) => {
      ctx.drawImage(video, 0, 0, 8, 8);
      const { data } = ctx.getImageData(0, 0, 8, 8);
      let low = 255, high = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = (data[i] + data[i + 1] + data[i + 2]) / 3;
        low = Math.min(low, luma);
        high = Math.max(high, luma);
      }
      // The reel consists of real clips separated by uniform gray padding.
      // Chrome's device clock can drift from nominal fixture frame numbers.
      if (high - low > 12) {
        const at = performance.timeOrigin + (metadata.captureTime ?? performance.now());
        let interval = intervals.at(-1);
        if (!interval || at - interval.end > 400) {
          interval = { start: at, end: at, presented: 0 };
          intervals.push(interval);
        }
        interval.end = at;
        interval.presented++;
      }
      video.requestVideoFrameCallback(preview);
    };
    window.reelIntervals = intervals;
    video.requestVideoFrameCallback(preview);
    document.getElementById('camera').click();
  })()`);
  const frames = new Map();
  let progress;
  const expires = performance.now() + (index.durationSeconds + 50) * 1000;
  while (performance.now() < expires) {
    progress = await browser.evaluate(`(() => {
      const current = signRelayCameraDiagnostics();
      return { status: document.getElementById('status').textContent, t: document.getElementById('video').currentTime,
        intervals: window.reelIntervals, now: performance.timeOrigin + performance.now(),
        frames: current?.frames.filter(f => f.stage === 'processed').map(f =>
          ({ id: f.id, at: f.at, sourceMs: f.sourceMs, event: f.event, hand: f.hand, ms: f.ms,
            segmentation: f.segmentation, model: f.segmentation.windows.length > 0, age: f.receivedAt - f.at })) };
    })()`);
    for (const frame of progress.frames ?? []) frames.set(frame.id, frame);
    if (progress.intervals.length >= index.trials.length && progress.now - progress.intervals[index.trials.length - 1].end >= 950) break;
    if (/failed|timed out|stopped|disconnected/i.test(progress.status)) throw new Error(progress.status);
    await delay(1500);
  }
  const intervals = progress.intervals.slice(0, index.trials.length);
  assert.equal(intervals.length, index.trials.length, "Reel did not present every clip");
  assert(progress.now - intervals.at(-1).end >= 950, "Reel did not complete");
  const processed = [...frames.values()];
  const remaining = processed.filter(frame => frame.event);
  const scoredTrial = (interval, position) => {
    const next = intervals[position + 1];
    const end = Math.min(interval.end + 750, next ? next.start - 100 : Infinity);
    return frame => frame.at >= interval.start - 100 && frame.at < end;
  };
  const reports = index.trials.map((trial, position) => {
    const interval = intervals[position];
    const span = interval.end - interval.start + 1000 / index.fps;
    assert(Math.abs(span - (trial.endMs - trial.startMs)) <= 900, "Preview clip boundaries do not match the index");
    const inTrial = scoredTrial(interval, position);
    const frames = processed.filter(frame => frame.at >= interval.start - 30 && frame.at < interval.end + 30);
    const events = remaining.filter(inTrial);
    const labels = events.map(frame => frame.event);
    const hands = frames.filter(frame => frame.hand).length;
    return { ...trial, presented: interval.presented, processed: frames.length, hands, labels,
      eventOffsetsMs: events.map(frame => frame.at - interval.start),
      duplicateWords: labels.length - new Set(labels).size,
      decisions: processed.filter(frame => frame.model && inTrial(frame))
        .map(frame => ({ at: frame.sourceMs, offsetMs: frame.at - interval.start, event: frame.event, ...frame.segmentation })),
      analyzedFps: frames.length / (span / 1000),
      handMs: median(frames.map(frame => frame.ms.hand)), modelMs: median(frames.filter(frame => frame.model)
        .map(frame => frame.ms.recognize)), ageMs: median(frames.map(frame => frame.age)),
      firstEventFromClipStartMs: events.length ? events[0].at - interval.start : null,
      outcome: !frames.length ? "unobserved" : trial.kind === "target" ? !labels.length ? "abstained"
        : labels.length === 1 && labels[0] === trial.label ? "correct" : "wrong"
        : labels.length ? "falseAccept" : "rejected" };
  });
  const outside = remaining.filter(frame => !intervals.some((interval, position) => scoredTrial(interval, position)(frame)));
  const prior = await browser.evaluate("document.getElementById('stop').click(); signRelayCameraDiagnostics()");
  assert.equal(await browser.evaluate("document.getElementById('video').srcObject"), null);
  assert.deepEqual([...external], []);
  const outcomes = Object.fromEntries(["correct", "wrong", "abstained", "falseAccept", "rejected", "unobserved"]
    .map(key => [key, reports.filter(trial => trial.outcome === key).length]));
  const result = { settings: { capture: process.env.SIGNRELAY_V2_CAPTURE, vision: process.env.SIGNRELAY_V2_VISION_PROFILE,
    rejection: process.env.SIGNRELAY_V2_REJECTION ?? "baseline",
    calibrationReplay: process.env.SIGNRELAY_V2_CALIBRATION_REPLAY === "1" },
    browser: (await browser.send("Browser.getVersion")).product, fixtureSha256: index.sha256,
    warmup: Boolean(warmupFile), startup: prior.startup, runtime: prior.runtime, fallback: prior.gpuFallback,
    outcomes, paddingSuggestions: outside.map(frame => ({ t: frame.at - intervals[0].start, label: frame.event })),
    counters: prior.counters, wallClockSourceSeconds: progress.t, actualProcessedFps: prior.counters.processed / progress.t,
    reports };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ settings: result.settings, outcomes, processedFps: result.actualProcessedFps,
    reports: reports.map(row => [row.label, row.labels, row.processed, row.hands]) }));
  if (process.env.SIGNRELAY_V2_REQUIRE_TARGETS === "1") {
    const targets = reports.filter(row => row.kind === "target");
    assert(targets.length && targets.every(trial => trial.outcome === "correct") && !outside.length,
      "Expected exactly one matching suggestion per target and no suggestions outside scored trials");
  }
} finally {
  await browser?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server.close();
}
