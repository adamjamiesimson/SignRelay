// Diagnostic replay through the built worker, including its real classifier.
// Usage: node scripts/replay-landmarks.mjs capture.json EXPECTED_GLOSS [worker-path]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [input, expected, workerPath = "public/workers/recognition.worker.js"] = process.argv.slice(2);
if (!input || !expected) throw new Error("Usage: node scripts/replay-landmarks.mjs capture.json EXPECTED_GLOSS [worker-path]");
const frames = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(frames) || !frames.length) throw new Error("Capture must contain frames");
const confirmations = [];
const candidates = new Set();
const feedback = new Set();
globalThis.self = globalThis;
globalThis.postMessage = message => {
  if (message.type === "confirmed") confirmations.push({ ...message, at: performance.now() });
  if (message.type === "analysis") {
    if (message.candidate) candidates.add(message.candidate);
    if (message.feedback?.includes("could not run")) feedback.add(message.feedback);
  }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.startsWith("/models/")) {
    return new Response(await readFile(path.join(process.cwd(), "public", url)));
  }
  return originalFetch(url, options);
};
await import(pathToFileURL(path.resolve(workerPath)).href);
await self.onmessage({ data: { type: "templates", language: "asl", templates: [] } });
for (let index = 0; index < frames.length; index++) {
  if (index) await delay(Math.min(250, Math.max(0, frames[index].timestamp - frames[index - 1].timestamp)));
  await self.onmessage({ data: { type: "frame", frame: frames[index] } });
}
console.log(JSON.stringify({ diagnosticOnly: true, expected, frames: frames.length,
  candidates: [...candidates], confirmed: confirmations.map(({ gloss }) => gloss),
  matched: confirmations.some(message => message.gloss === expected),
  unexpected: confirmations.filter(message => message.gloss !== expected).map(message => message.gloss),
  modelErrors: [...feedback],
}, null, 2));
