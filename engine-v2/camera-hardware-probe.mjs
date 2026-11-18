import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { serve } from "./serve.mjs";

const [executable, handFile, modelFile, output] = process.argv.slice(2);
assert(output, "Supply Chrome, hand landmarker, model, and output");
const server = await serve({ handFile, modelFile, port: 0 });
let browser;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  browser = await startChrome(executable, { fakeDevice: false, proxy: "http://127.0.0.1:9" });
  const origin = "http://127.0.0.1:" + server.address().port;
  const external = new Set();
  browser.onEvent(event => {
    if (event.method === "Network.requestWillBeSent" && !event.params.request.url.startsWith(origin + "/")) {
      external.add(event.params.request.url);
    }
  });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.probeTracks = [];
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await get(options);
      window.probeTracks.push(...stream.getTracks());
      return stream;
    };
  })()` });
  await browser.send("Page.navigate", { url: origin });
  for (let i = 0; i < 100 && !await browser.evaluate("typeof signRelayCameraDiagnostics === 'function'"); i++) await wait(100);
  await browser.evaluate("document.getElementById('camera').click()");
  let result;
  for (let i = 0; i < 160; i++) {
    result = await browser.evaluate(`(() => {
      const video = document.getElementById('video');
      const status = document.getElementById('status').textContent;
      const trace = signRelayCameraDiagnostics();
      return { status, width: video.videoWidth, height: video.videoHeight,
        seconds: video.currentTime, counters: trace?.counters, startup: trace?.startup, runtime: trace?.runtime, fallback: trace?.gpuFallback,
        workerStage: trace?.frames.find(frame => frame.stage === 'sent')?.workerStage };
    })()`);
    if ((result.seconds >= 5 && result.counters?.processed > 0) || result.seconds >= 8
      || /failed|could not|stopped|timed out/i.test(result.status)) break;
    await wait(250);
  }
  await browser.evaluate("document.getElementById('stop').click()");
  result.released = await browser.evaluate(`document.getElementById('video').srcObject === null
    && probeTracks.every(track => track.readyState === 'ended')`);
  result.openedTracks = await browser.evaluate("probeTracks.length");
  result.externalRequests = external.size;
  result.protocol = "Physical webcam capture and release only. No labelled signer or motion.";
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  assert(result.seconds >= 5 && result.counters?.processed > 0 && result.released && external.size === 0);
} finally {
  await browser?.close().catch(error => console.warn("Chrome profile cleanup:", error.message));
  server.close();
}
