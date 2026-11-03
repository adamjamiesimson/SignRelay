// Release-flag smoke on a rehearsal export built with the flag ON or OFF:
//   npm run build:rehearsal                                         (on)
//   NEXT_PUBLIC_SIGNRELAY_FINGERSPELLING=off npm run build:rehearsal (off)
//   node tests/release-flag-smoke.mjs <chrome> <on|off>
// Synthetic word fixtures and a fake camera; software behaviour only.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fixtures, openRehearsal, pause, until } from "./rehearsal-harness.mjs";

const [executable, expected] = process.argv.slice(2);
if (!executable || !["on", "off"].includes(expected)) throw new Error("usage: node tests/release-flag-smoke.mjs <chrome> <on|off>");
const manifest = JSON.parse(readFileSync("out/runtime-manifest.json", "utf8"));
assert.equal(manifest.fingerspelling, expected, `export was built with fingerspelling ${manifest.fingerspelling}`);
const shipped = [...(existsSync("out/models/asl-fingerspelling") ? readdirSync("out/models/asl-fingerspelling").filter(n => n.endsWith(".onnx")) : []),
  ...["fingerspelling.worker.js", "fingerspelling-vision.worker.js"].filter(n => existsSync(`out/workers/${n}`))];
if (expected === "off") assert.deepEqual(shipped, [], "disabled export ships research assets");
else assert.ok(shipped.length >= 3, "research export is missing fingerspelling assets");

const h = await openRehearsal(executable, { extraInit: `
  const NativeWorker = window.Worker; window.__qa.workers = [];
  window.Worker = class extends NativeWorker { constructor(url, options) { window.__qa.workers.push(String(url)); super(url, options); } };
` });
const checks = [];
try {
  // A stray mode parameter must not reveal or start anything.
  await h.open("/?perf&mode=fingerspelling#fingerspelling"); await h.start();
  const selector = await h.evaluate("!!document.querySelector('.asl-mode-selector')");
  const button = await h.has("Fingerspelling");
  assert.equal(selector, expected === "on"); assert.equal(button, expected === "on");
  assert.equal(await h.evaluate("!!document.querySelector('#spelling-text')"), false, "fingerspelling workspace opened by default");
  checks.push(`mode selector ${expected === "on" ? "shown" : "absent"}; deep-link parameters ignored`);

  // Ordinary ASL word recognition, transcript and explicit speech still work.
  const { sequence } = await fixtures();
  await h.play(sequence(["HELLO"]));
  await until(async () => (await h.words()).length > 0, "Word fixture did not confirm", 600);
  assert.equal(await h.evaluate("!document.querySelector('#personal-vocabulary').hidden"), true, "personal signs hidden");
  checks.push("word recognition confirms a word; personal-sign panel available");

  if (expected === "on") {
    await h.click("Fingerspelling");
    await until(() => h.evaluate("!!document.querySelector('#spelling-text')"), "No spelling workspace");
    await h.click("Word Recognition");
    await until(() => h.evaluate("!document.querySelector('#spelling-text')"), "Mode did not return");
    checks.push("research mode reachable and reversible");
  } else {
    // The disabled build must never create its workers or fetch its model.
    await pause(1500);
    const workers = await h.evaluate("window.__qa.workers");
    assert.ok(!workers.some(url => /fingerspelling/.test(url)), `fingerspelling worker created: ${workers}`);
    const research = h.pageRequests.filter(url => /asl-fingerspelling|fingerspelling(-vision)?\.worker/.test(url));
    assert.deepEqual(research, [], "disabled build requested research assets");
    checks.push("no fingerspelling worker, model or worker-script request");
  }
  assert.deepEqual(h.nonLoopback(), [], "unexpected external request");
  console.log("RELEASE-FLAG-SMOKE", JSON.stringify({ flag: expected, passed: checks.length, checks }));
} finally { await h.close(); }
