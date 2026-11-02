// Does a snapshot taken inside requestVideoFrameCallback contain the pixels of
// the frame its metadata describes? Synthetic frame-index pattern through
// Chrome's fake camera; no app, person, landmarks or recording involved.
//
// Every callback takes, at the same instant:
//   - a synchronous CPU read-back of the element (the pixel reference),
//   - a WebCodecs VideoFrame (pixels and their own timestamp travel together),
//   - the snapshot method under test, decoded later.
// No assumption is made about the fake camera's own frame pacing.
//
// usage: node scripts/diagnostics/snapshot-fidelity-browser.mjs <chrome> <fps> <seconds> <out.json>
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startChrome } from "./chrome-session.mjs";
import { writeIdentityY4m, DECODE_SOURCE } from "./frame-identity.mjs";

const [chrome, fpsArg = "30", secondsArg = "8", out = "work/snapshot-fidelity.json"] = process.argv.slice(2);
const fps = Number(fpsArg), seconds = Number(secondsArg);
const file = resolve(tmpdir(), `signrelay-fidelity-${fps}.y4m`);
writeIdentityY4m(file, { fps, frames: Math.min(4000, Math.ceil(fps * 60)) });

const page = `<!doctype html><title>snapshot fidelity</title><video autoplay muted playsinline></video><script>
${DECODE_SOURCE}
const methods = {
  // Production LiveVision fingerspelling path at the sprint base.
  "gpu-canvas-transfer": () => { const c = new OffscreenCanvas(640, 480); const x = c.getContext("2d"); return v => { x.drawImage(v, 0, 0, 640, 480); return c.transferToImageBitmap(); }; },
  "cpu-canvas-transfer": () => { const c = new OffscreenCanvas(640, 480); const x = c.getContext("2d", { willReadFrequently: true }); return v => { x.drawImage(v, 0, 0, 640, 480); return c.transferToImageBitmap(); }; },
  "create-image-bitmap": () => v => createImageBitmap(v),
  // Candidate: an immutable VideoFrame, converted to a bitmap afterwards.
  "video-frame-then-canvas": () => { const c = new OffscreenCanvas(640, 480); const x = c.getContext("2d"); return v => { const f = new VideoFrame(v); x.drawImage(f, 0, 0, 640, 480); f.close(); return c.transferToImageBitmap(); }; },
};
const refCanvas = new OffscreenCanvas(160, 120), refContext = refCanvas.getContext("2d", { willReadFrequently: true });
async function decode(snapshot) {
  const source = await snapshot;
  const w = source.displayWidth ?? source.width, h = source.displayHeight ?? source.height;
  const c = new OffscreenCanvas(w, h), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(source, 0, 0); source.close();
  return __decodeIdentity(x.getImageData(0, 0, w, h).data, w, h);
}
window.run = async (method, seconds, load) => {
  const video = document.querySelector("video");
  if (!video.srcObject) { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }); await video.play(); }
  const take = methods[method](), pending = [];
  let burner;
  // Optional main-thread load resembling React/overlay work between frames.
  if (load) burner = setInterval(() => { const end = performance.now() + load; while (performance.now() < end); }, 16);
  const stop = performance.now() + seconds * 1000;
  await new Promise(resolve => {
    const observe = (_now, meta) => {
      if (performance.now() > stop) { resolve(); return; }
      const started = performance.now(), snapshot = take(video), takeMs = performance.now() - started;
      const frame = new VideoFrame(video), frameTimestamp = frame.timestamp;
      refContext.drawImage(video, 0, 0, 160, 120);
      const reference = __decodeIdentity(refContext.getImageData(0, 0, 160, 120).data, 160, 120);
      pending.push(new Promise(r => setTimeout(r, 5)).then(async () => ({
        reference, takeMs, method: await decode(snapshot), videoFrame: await decode(frame),
        // Does the callback metadata describe the frame that is current now?
        metadataMatchesVideoFrame: Math.abs(frameTimestamp / 1e6 - meta.mediaTime) < 1e-4,
      })));
      video.requestVideoFrameCallback(observe);
    };
    video.requestVideoFrameCallback(observe);
  });
  clearInterval(burner);
  return Promise.all(pending);
};
</script>`;
const server = createServer((req, res) => { res.setHeader("Content-Type", "text/html"); res.end(page); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const browser = await startChrome(chrome, { proxy: null, extraArgs: [`--use-file-for-fake-video-capture=${file}`] });
const results = [];
try {
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await new Promise(r => setTimeout(r, 1500));
  for (const load of [0, 10]) for (let repeat = 0; repeat < 2; repeat++) for (const method of Object.keys({ "gpu-canvas-transfer": 1, "cpu-canvas-transfer": 1, "create-image-bitmap": 1, "video-frame-then-canvas": 1 })) {
    const rows = await browser.evaluate(`run(${JSON.stringify(method)}, ${seconds}, ${load})`);
    const valid = rows.filter(row => row.reference >= 0);
    results.push({ method, loadMsPer16ms: load, repeat, callbacks: rows.length, undecodableReference: rows.length - valid.length,
      methodDiffersFromReadback: valid.filter(row => row.method !== row.reference).length,
      videoFrameDiffersFromReadback: valid.filter(row => row.videoFrame !== row.reference).length,
      metadataNotCurrentFrame: rows.filter(row => !row.metadataMatchesVideoFrame).length,
      // Synchronous main-thread cost of the snapshot call inside the callback.
      takeMs: (() => { const t = rows.map(row => row.takeMs).sort((a, b) => a - b); return { median: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] }; })() });
    console.log("SNAPSHOT-FIDELITY", JSON.stringify(results.at(-1)));
  }
  const summary = { kind: "synthetic frame-index pattern through Chrome fake camera; snapshot pixel/metadata agreement only", sourceFps: fps, seconds,
    userAgent: await browser.evaluate("navigator.userAgent"), results };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(summary, null, 1));
} finally { await browser.close(); server.close(); }
