// Generated test patterns only: no signer footage, landmarks or accuracy data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";

const executable = process.argv[2];
if (!executable) throw new Error("Supply a Chrome executable; ffmpeg is also required");
const directory = await mkdtemp(path.join(tmpdir(), "signrelay-frame-control-"));
let server, browser;
try {
  for (const rate of [10, 30]) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      `testsrc2=size=160x120:rate=${rate}:duration=1`, "-c:v", "libvpx-vp9", path.join(directory, `${rate}.webm`)], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
  }
  await build({ entryPoints: ["scripts/diagnostics/video-frame-step.ts"], bundle: true,
    format: "iife", globalName: "frameStep", platform: "browser", outfile: path.join(directory, "step.js") });
  const content = new Map([
    ["/", ["text/html", Buffer.from('<video id="video" muted preload="auto"></video><script src="/step.js"></script>')]],
    ...await Promise.all(["step.js", "10.webm", "30.webm"].map(async file => [`/${file}`,
      [file.endsWith(".js") ? "text/javascript" : "video/webm", await readFile(path.join(directory, file))]])),
  ]);
  server = createServer((request, response) => {
    const value = content.get(request.url);
    if (!value) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": value[0], "Content-Length": value[1].length }); response.end(value[1]);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await startChrome(executable);
  await browser.send("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  for (let i = 0; i < 100; i++) {
    if (await browser.evaluate("!!window.frameStep")) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const result = await browser.evaluate(`(async () => {
    const video = document.getElementById('video'), reports = [];
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function load(rate) {
      const url = URL.createObjectURL(await (await fetch('/' + rate + '.webm')).blob());
      await frameStep.loadVideoData(video, url); return url;
    }
    for (const rate of [10, 30]) {
      const runs = [];
      for (const implementation of ['previous', 'current']) {
        const url = await load(rate), pts = [0]; let seekingAtProcess = 0;
        for (let time = .05; time < video.duration; time += .05) {
          let decoded;
          if (implementation === 'current') decoded = await frameStep.seekDecodedFrame(video, time);
          else {
            const next = new Promise((resolve, reject) => {
              const timer = setTimeout(() => { video.cancelVideoFrameCallback(id); reject(new Error('old control timeout')); }, 3000);
              const id = video.requestVideoFrameCallback((_now, info) => { clearTimeout(timer); resolve(info.mediaTime); });
            }); video.currentTime = time; decoded = await next;
          }
          if (video.seeking) seekingAtProcess++;
          if (decoded > pts.at(-1) + .001) pts.push(decoded);
          await sleep(50);
        }
        runs.push({implementation, pts, seekingAtProcess});
        video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      }
      reports.push({rate, runs});
    }
    const url = await load(30), native = video.requestVideoFrameCallback.bind(video);
    // Seek completes, but no presentation callback reaches the helper.
    video.requestVideoFrameCallback = callback => native(() => {});
    let timeout; try { await frameStep.seekDecodedFrame(video, .2, {timeoutMs:250}); }
    catch(error) { timeout=String(error); }
    const controller = new AbortController();
    const pending = frameStep.seekDecodedFrame(video, .4, {signal:controller.signal});
    controller.abort(new Error('Diagnostic stopped'));
    let cancelled; try { await pending; } catch(error) { cancelled=String(error); }
    video.requestVideoFrameCallback = native;
    const afterCancellation = await frameStep.seekDecodedFrame(video, .6);
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    return {reports, timeout, cancelled, afterCancellation};
  })()`);
  for (const report of result.reports) {
    const [previous, current] = report.runs;
    assert.deepEqual(current.pts, previous.pts, `Decoded PTS changed at ${report.rate}fps`);
    assert.equal(current.pts.length, report.rate === 10 ? 10 : 20);
    assert.equal(current.seekingAtProcess, 0);
  }
  assert.match(result.timeout, /Video frame delivery timed out.*seeked=true; callback=false/);
  assert.match(result.cancelled, /Diagnostic stopped/); assert.equal(result.afterCancellation, 0.6);
  console.log(JSON.stringify({ passed: true, generated_patterns_only: true, independent_sign_accuracy_evidence: false,
    duplicate_frames_not_repeated: true, controls: result }));
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  await rm(directory, { recursive: true, force: true });
}
