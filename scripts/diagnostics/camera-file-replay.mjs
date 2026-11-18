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

const [executable, input, expected, reelIndex] = process.argv.slice(2);
if (!executable || !input || expected === undefined) throw new Error("Supply Chrome, an ignored Y4M, and the expected gloss or [REJECT]");
const fixture = resolve(input);
const local = relative(resolve("evaluation/raw"), fixture);
if (!local || local.startsWith("..") || isAbsolute(local) || !fixture.endsWith(".y4m")) throw new Error("Use a local fixture under evaluation/raw");
const hash = createHash("sha256");
for await (const chunk of createReadStream(fixture)) hash.update(chunk);
const fixtureSha = hash.digest("hex");
const reel = reelIndex ? JSON.parse(await readFile(reelIndex, "utf8")) : null;
if (reel) assert.equal(reel.sha256, fixtureSha, "Reel fingerprint differs from the guarded index");
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
    window.__qa = { words: [], frames: 0, handFrames: 0, tracks: [], input: [], events: [] };
    const clock = () => 1000 * ([...document.querySelectorAll('video')].find(video => video.srcObject)?.currentTime ?? 0);
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
        if (${Boolean(reel)} && window.__qa.input.length < 2000) {
          window.__qa.input.push({ t: clock(), hand: message.frame.hands.length > 0 });
        }
      }
      return post.call(this, message, transfer);
    };
    speechSynthesis.speak = utterance => {
      window.__qa.words.push(utterance.text);
      if (${Boolean(reel)}) window.__qa.events.push({ t: clock(), label: utterance.text.toUpperCase() });
    };
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
  await until(() => evaluate(`[...document.querySelectorAll('video')].find(video => video.srcObject)?.currentTime >= ${reel ? reel.durationSeconds - 0.25 : 18}`),
    "Video did not reach the end of the sign interval", reel ? Math.ceil(reel.durationSeconds * 13) + 250 : 240);
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
  if (reel) {
    const { input, events } = await evaluate("({ input: window.__qa.input, events: window.__qa.events })");
    const trials = reel.trials.map(trial => {
      const frames = input.filter(frame => frame.t >= trial.startMs - 30 && frame.t < trial.endMs);
      const labels = events.filter(event => event.t >= trial.startMs - 100 && event.t < trial.endMs + 750).map(event => event.label);
      const outcome = !frames.length ? "unobserved" : trial.kind === "target" ? !labels.length ? "abstained"
        : labels.length === 1 && labels[0] === trial.label ? "correct" : "wrong"
        : labels.length ? "falseAccept" : "rejected";
      return { ...trial, framesProcessed: frames.length, hands: frames.filter(frame => frame.hand).length, labels, outcome };
    });
    const outcomes = Object.fromEntries(["correct", "wrong", "abstained", "falseAccept", "rejected", "unobserved"]
      .map(key => [key, trials.filter(trial => trial.outcome === key).length]));
    console.log(JSON.stringify({ protocol: "chrome-file-camera-ui-v1-reel", fixture_sha256: fixtureSha,
      worker_sha256: manifest.recognition_worker_sha256, outcomes, trials,
      startupMs: startup, analyzedFps: snapshot.frames / snapshot.seconds }));
  }
  const actual = snapshot.words.map(word => word.toUpperCase());
  const outcome = actual.length ? (actual.length === 1 && actual[0] === expected ? "correct" : "wrong") : (expected === "[REJECT]" ? "rejected" : "abstained");
  if (!reel) console.log(JSON.stringify({ protocol: "chrome-file-camera-ui-v1", fixture_sha256: fixtureSha, worker_sha256: manifest.recognition_worker_sha256,
    expected, outcome, startup_ms: startup, fps_from_start: snapshot.frames / snapshot.seconds, ...snapshot }));
} finally { await browser?.close(); server.kill(); }
