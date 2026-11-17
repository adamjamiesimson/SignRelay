// Actual exported UI, Chrome camera input from a licensed local movie.
// Training landmarks and browser recognition callbacks are never injected.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { startChrome } from "./chrome-session.mjs";

const [executable, input, expected] = process.argv.slice(2);
if (!executable || !input || expected === undefined) throw new Error("Supply Chrome, an ignored Y4M, and the expected gloss or [REJECT]");
const fixture = resolve(input);
const local = relative(resolve("evaluation/raw"), fixture);
if (!local || local.startsWith("..") || isAbsolute(local) || !fixture.endsWith(".y4m")) throw new Error("Use a local fixture under evaluation/raw");
const hash = createHash("sha256");
for await (const chunk of createReadStream(fixture)) hash.update(chunk);
const fixtureSha = hash.digest("hex");
const manifest = JSON.parse(await readFile("out/runtime-manifest.json", "utf8"));
const origin = `http://127.0.0.1:${18200 + Math.floor(Math.random() * 500)}`;
const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", new URL(origin).port], { stdio: "ignore" });
async function until(check, reason, tries = 240) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error(reason);
}
let browser;
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  browser = await startChrome(executable, { proxy: "http://127.0.0.1:9", extraArgs: [`--use-file-for-fake-video-capture=${fixture}`] });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { words: [], frames: 0, handFrames: 0, tracks: [] };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      try {
        const stream = await get(options);
        window.__qa.tracks.push(...stream.getVideoTracks());
        return stream;
      } catch (error) {
        window.__qa.cameraError = error.name + ": " + error.message;
        throw error;
      }
    };
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, transfer) {
      if (message?.type === "frame") {
        window.__qa.frames++;
        if (message.frame.hands.length) window.__qa.handFrames++;
      }
      return post.call(this, message, transfer);
    };
    speechSynthesis.speak = utterance => window.__qa.words.push(utterance.text);
  })()` });
  const evaluate = browser.evaluate;
  const click = text => evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button || button.disabled) throw new Error("Unavailable button");
    button.click();
  })()`);
  await browser.send("Page.navigate", { url: origin + "/?perf" });
  await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(key => key.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
  const start = performance.now();
  await click("Start translating");
  await until(async () => {
    const state = await evaluate("({ status: document.querySelector('.status-badge')?.textContent, error: window.__qa.cameraError })");
    if (state.error) throw new Error(state.error);
    return state.status === "Active";
  }, "Camera did not activate", 360);
  const startup = performance.now() - start;
  await evaluate("document.querySelector('.switch-row.prominent input')?.click()");
  await until(() => evaluate("[...document.querySelectorAll('video')].find(video => video.srcObject)?.currentTime >= 18"), "Video did not reach the end of the sign interval");
  const snapshot = await evaluate(`({
    frames: window.__qa.frames,
    handFrames: window.__qa.handFrames,
    seconds: [...document.querySelectorAll("video")].find(video => video.srcObject).currentTime,
    spoken: window.__qa.words,
    words: [...document.querySelectorAll(".transcript-entry button[aria-label^='Edit ']")].map(b => b.getAttribute("aria-label").slice(5))
  })`);
  await click("Pause camera");
  await until(() => evaluate("window.__qa.tracks.length > 0 && window.__qa.tracks.every(track => track.readyState === 'ended')"), "Pause did not release the camera");
  assert.ok(snapshot.frames > 0, "No frames reached the recognition worker");
  assert.deepEqual(snapshot.spoken, snapshot.words, "Auto speak calls differ from the visible transcript");
  const actual = snapshot.words.map(word => word.toUpperCase());
  const outcome = actual.length ? (actual.length === 1 && actual[0] === expected ? "correct" : "wrong") : (expected === "[REJECT]" ? "rejected" : "abstained");
  console.log(JSON.stringify({ protocol: "chrome-file-camera-ui-v1", fixture_sha256: fixtureSha, worker_sha256: manifest.recognition_worker_sha256,
    expected, outcome, startup_ms: startup, fps_from_start: snapshot.frames / snapshot.seconds, ...snapshot }));
} finally { await browser?.close(); server.kill(); }
