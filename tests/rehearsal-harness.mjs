// Shared harness for browser checks on the rehearsal export (npm run build:rehearsal).
// Synthetic landmarks come from the same kinematic fixtures as the unit tests;
// they are labelled synthetic everywhere and are not recordings of anyone.
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { RETURNING_VISITOR } from "./helpers/returning-visitor.mjs";

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, reason, attempts = 300) {
  for (let i = 0; i < attempts; i++) { if (await check()) return; await pause(100); }
  throw new Error(reason);
}

/** Synthetic frame sequences: signs separated by rests with the hands lowered out of view. */
export async function fixtures() {
  const file = join(tmpdir(), `signrelay-rehearsal-fixtures-${process.pid}.mjs`);
  await build({ stdin: { contents: `export { makeSign } from "./tests/fixtures/asl-motion.ts"; export { NEGATIVE_CONTROLS } from "./tests/fixtures/asl-negative-controls.ts";`, resolveDir: process.cwd(), loader: "ts" },
    outfile: file, bundle: true, format: "esm", platform: "node", logLevel: "error" });
  const { makeSign, NEGATIVE_CONTROLS } = await import(pathToFileURL(file).href);
  rmSync(file, { force: true });
  const sequence = (signs, restMs = 700) => {
    const frames = [];
    for (const sign of signs) {
      const offset = frames.length ? frames.at(-1).timestamp + 50 - 1000 : 0;
      const take = makeSign(sign).map(frame => ({ ...frame, timestamp: frame.timestamp + offset }));
      frames.push(...take, ...Array.from({ length: Math.round(restMs / 50) }, (_, i) => ({ ...take.at(-1), hands: [], timestamp: take.at(-1).timestamp + (i + 1) * 50 })));
    }
    return frames;
  };
  return { sequence, negative: name => NEGATIVE_CONTROLS[name]() };
}

/** `returning: false` opens the site as a first-time visitor, who sees the tour. */
export async function openRehearsal(executable, { extraInit = "", returning = true } = {}) {
  const manifest = JSON.parse(readFileSync("out/runtime-manifest.json", "utf8"));
  if (manifest.profile !== "rehearsal") throw new Error(`out/ is the ${manifest.profile} build; run npm run build:rehearsal first`);
  const port = 18700 + Math.floor(Math.random() * 300), origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, "No static server");
  const browser = await startChrome(executable);
  const pageRequests = [];
  browser.onEvent(message => { if (message.method === "Network.requestWillBeSent") pageRequests.push(message.params.request.url); });
  if (returning) await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: RETURNING_VISITOR });
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    window.__qa = { tracks: [], spoken: [], cancels: 0 };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => { const stream = await get(options); window.__qa.tracks.push(...stream.getTracks()); return stream; };
    // Record speech instead of playing audio; headless Chromium has no voices.
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = utterance => { window.__qa.spoken.push(utterance.text); };
      window.speechSynthesis.cancel = () => { window.__qa.cancels++; };
    }
    ${extraInit}
  })();` });
  const evaluate = browser.evaluate;
  const button = text => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const harness = {
    origin, browser, evaluate, manifest, pageRequests,
    click: text => evaluate(`(() => { const b=${button(text)}; if(!b||b.disabled) throw new Error('Missing button '+${JSON.stringify(text)}); b.click(); })()`),
    has: text => evaluate(`!!${button(text)}`),
    active: () => evaluate("document.querySelector('.status-badge')?.textContent === 'Active'"),
    words: () => evaluate("[...document.querySelectorAll('.transcript-entry p')].map(p => p.textContent)"),
    play: frames => evaluate(`window.__signrelayRehearsal.play(${JSON.stringify(frames)})`),
    playing: () => evaluate("window.__signrelayRehearsal.playing"),
    async open(path = "/") {
      await browser.send("Page.navigate", { url: `${origin}${path}` });
      await until(() => evaluate("Object.keys(document.querySelector('[role=radio]') ?? {}).some(k=>k.startsWith('__reactFiber'))"), "Welcome screen did not hydrate");
    },
    async start() {
      await harness.click("Start signing");
      await until(harness.active, "Camera did not start");
      await until(() => evaluate("!!window.__signrelayRehearsal"), "Rehearsal hook missing");
    },
    nonLoopback: () => pageRequests.filter(url => { try { const { protocol, hostname } = new URL(url); return !["data:", "blob:"].includes(protocol) && !["127.0.0.1", "localhost"].includes(hostname); } catch { return true; } }),
    async close() { await browser.close(); server.kill(); },
  };
  return harness;
}
