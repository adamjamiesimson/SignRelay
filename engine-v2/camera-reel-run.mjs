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
  await browser.evaluate("document.getElementById('camera').click()");
  const frames = new Map();
  let progress;
  const expires = performance.now() + (index.durationSeconds + 50) * 1000;
  while (performance.now() < expires) {
    progress = await browser.evaluate(`(() => {
      const current = signRelayCameraDiagnostics();
      return { status: document.getElementById('status').textContent, t: document.getElementById('video').currentTime,
        frames: current?.frames.filter(f => f.stage === 'processed').map(f =>
          ({ id: f.id, stage: f.stage, sourceMs: f.sourceMs, event: f.event, hand: f.hand, ms: f.ms,
            model: f.segmentation.windows.length > 0, age: f.receivedAt - f.at })) };
    })()`);
    for (const frame of progress.frames ?? []) frames.set(frame.id, frame);
    if (progress.t >= index.durationSeconds - 0.25) break;
    if (/failed|timed out|stopped|disconnected/i.test(progress.status)) throw new Error(progress.status);
    await delay(1500);
  }
  assert(progress.t >= index.durationSeconds - 0.25, "Reel did not complete");
  const all = [...frames.values()];
  const processed = all.filter(frame => frame.stage === "processed");
  const remaining = processed.filter(frame => frame.event);
  const reports = index.trials.map(trial => {
    const frames = processed.filter(frame => frame.sourceMs >= trial.startMs - 30 && frame.sourceMs < trial.endMs);
    const events = remaining.filter(frame => frame.sourceMs >= trial.startMs - 100 && frame.sourceMs < trial.endMs + 750);
    const labels = events.map(frame => frame.event);
    const hands = frames.filter(frame => frame.hand).length;
    return { ...trial, processed: frames.length, hands, labels, eventOffsetsMs: events.map(frame => frame.sourceMs - trial.startMs),
      analyzedFps: frames.length / ((trial.endMs - trial.startMs) / 1000),
      handMs: median(frames.map(frame => frame.ms.hand)), modelMs: median(frames.filter(frame => frame.model)
        .map(frame => frame.ms.recognize)), ageMs: median(frames.map(frame => frame.age)),
      firstEventFromClipStartMs: events.length ? events[0].sourceMs - trial.startMs : null,
      outcome: !frames.length ? "unobserved" : trial.kind === "target" ? !labels.length ? "abstained"
        : labels.length === 1 && labels[0] === trial.label ? "correct" : "wrong"
        : labels.length ? "falseAccept" : "rejected" };
  });
  const outside = remaining.filter(frame => !index.trials.some(trial =>
    frame.sourceMs >= trial.startMs - 100 && frame.sourceMs < trial.endMs + 750));
  const prior = await browser.evaluate("document.getElementById('stop').click(); signRelayCameraDiagnostics()");
  assert.equal(await browser.evaluate("document.getElementById('video').srcObject"), null);
  assert.deepEqual([...external], []);
  const outcomes = Object.fromEntries(["correct", "wrong", "abstained", "falseAccept", "rejected", "unobserved"]
    .map(key => [key, reports.filter(trial => trial.outcome === key).length]));
  const result = { settings: { capture: process.env.SIGNRELAY_V2_CAPTURE, vision: process.env.SIGNRELAY_V2_VISION_PROFILE },
    browser: (await browser.send("Browser.getVersion")).product, fixtureSha256: index.sha256,
    warmup: Boolean(warmupFile), runtime: prior.runtime, fallback: prior.gpuFallback,
    outcomes, paddingSuggestions: outside.map(frame => ({ t: frame.sourceMs, label: frame.event })),
    counters: prior.counters, wallClockSourceSeconds: progress.t, actualProcessedFps: prior.counters.processed / progress.t,
    reports };
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ settings: result.settings, outcomes, processedFps: result.actualProcessedFps,
    reports: reports.map(row => [row.label, row.labels, row.processed, row.hands]) }));
} finally {
  await browser?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server.close();
}
