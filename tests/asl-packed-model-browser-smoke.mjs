// Genuine Engine V3.1 ONNX inference in a clean local browser.
// Synthetic engineering input serves only to exercise the model, never to score signs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { startChrome } from "../scripts/diagnostics/chrome-session.mjs";
import { ASL_V31_ASSET_PATH, ASL_V31_ASSET_PINS, ASL_V31_POLICY } from "../lib/asl-v31-assets.mjs";

const executable = process.argv[2];
assert(executable, "Supply a Chromium executable after building the export");
const manifest = JSON.parse(await readFile("out/runtime-manifest.json", "utf8"));
assert.equal(manifest.asl_engine?.version, "engine-v3.1");
assert.equal(manifest.asl_engine?.policy, ASL_V31_POLICY);
assert.equal(manifest.asl_engine?.model_sha256, ASL_V31_ASSET_PINS["model.onnx"].sha256);
const expected = ["model.onnx", "meta.json", `policy-${ASL_V31_POLICY}.json`].map(name => ASL_V31_ASSET_PATH + "/" + name).sort();
const probe = await mkdtemp("out/__qa-asl-model-");
const deny = createServer((_request, response) => response.writeHead(403).end());
deny.on("connect", (_request, socket) => {
  socket.on("error", () => {});
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
});
let server, browser;
try {
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import * as ort from "onnxruntime-web";
        import { recognizeAslV31, warmAslV31Model } from "./lib/asl-v31-runtime";
        import { N_POINTS } from "./engine-v3/web/preprocess.mjs";
        ort.env.wasm.wasmPaths = "/workers/";
        ort.env.wasm.numThreads = 1;
        async function measure(sequence) {
          const started = performance.now();
          const phases = [];
          const result = await recognizeAslV31(sequence, { onPhase: phase => phases.push(phase) });
          return { phases, elapsedMs: performance.now() - started,
            completed: !result || Number.isFinite(result.confidence) };
        }
        self.onmessage = async () => {
          try {
            const sequence = Array.from({ length: 12 }, (_, frame) => {
              const landmarks = new Float32Array(N_POINTS * 3).fill(NaN);
              for (let point = 0; point < 21; point++)
                landmarks.set([0.4 + frame * 0.004 + (point % 5) * 0.01, 0.3 + point * 0.004, 0], point * 3);
              return landmarks;
            });
            const started = performance.now();
            await warmAslV31Model();
            const loadMs = performance.now() - started;
            self.postMessage({ loadMs, cold: await measure(sequence), warm: await measure(sequence) });
          } catch (error) {
            self.postMessage({ error: String(error) });
          }
        };
      `,
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile: join(probe, "worker.js"),
  });
  await new Promise((resolve, reject) => {
    deny.once("error", reject);
    deny.listen(0, "127.0.0.1", resolve);
  });
  const { port: denyPort } = deny.address();
  const port = 18000 + Math.floor(Math.random() * 2000);
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["scripts/serve-export.mjs", "--host", "127.0.0.1", "--port", String(port)], { stdio: "ignore" });
  let serving = false;
  for (let attempt = 0; !serving && attempt < 100; attempt++) {
    if (server.exitCode !== null) break;
    serving = await fetch(origin).then(response => response.ok).catch(() => false);
    if (!serving) await delay(100);
  }
  assert(serving, "Export server did not start");
  browser = await startChrome(executable, { proxy: `http://127.0.0.1:${denyPort}` });
  const responses = new Map(), wasmResponses = [], outbound = [];
  browser.onEvent(message => {
    if (message.method === "Target.attachedToTarget") {
      const { sessionId } = message.params;
      void browser.send("Network.enable", {}, sessionId)
        .then(() => browser.send("Runtime.runIfWaitingForDebugger", {}, sessionId))
        .catch(() => {});
    }
    if (message.method === "Network.requestWillBeSent") {
      const url = new URL(message.params.request.url);
      if (["http:", "https:"].includes(url.protocol) && url.origin !== origin) outbound.push(url.href);
    }
    if (message.method === "Network.responseReceived") {
      const { url, status } = message.params.response;
      const path = new URL(url).pathname;
      if (path.startsWith(ASL_V31_ASSET_PATH + "/")) responses.set(path, status);
      if (path === "/workers/ort-wasm-simd-threaded.jsep.wasm") wasmResponses.push(status);
    }
  });
  await browser.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await browser.send("Page.navigate", { url: origin });
  let loaded = false;
  for (let attempt = 0; !loaded && attempt < 100; attempt++) {
    loaded = await browser.evaluate(`location.origin === ${JSON.stringify(origin)} && document.readyState === "complete"`);
    if (!loaded) await delay(100);
  }
  assert(loaded, "Chromium did not load the export");
  const result = await browser.evaluate(`new Promise((resolve, reject) => {
    const worker = new Worker(${JSON.stringify("/" + basename(probe) + "/worker.js")}, { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("ASL model probe timed out")); }, 45000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
    worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(new Error(error.message)); };
    worker.postMessage(null);
  })`);
  assert.equal(result.error, undefined);
  for (const run of [result.cold, result.warm]) {
    assert.equal(run.completed, true);
    assert.equal(run.phases.filter(phase => phase === "inference").length, 1, "The ONNX execution phase must run");
    assert(Number.isFinite(run.elapsedMs));
  }
  assert.deepEqual([...responses.keys()].sort(), expected, "Worker did not load every packaged ASL model asset");
  assert([...responses.values()].every(status => status === 200), "An ASL model request failed");
  assert(wasmResponses.includes(200), "The local ONNX Runtime WASM asset was not loaded");
  assert.deepEqual(outbound, [], "Page or worker requested non-local assets");
  console.log(JSON.stringify({
    passed: true,
    control: "synthetic landmarks, real Engine V3.1 ONNX browser worker inference through a deny-all proxy",
    model_sha256: manifest.asl_engine.model_sha256,
    policy: ASL_V31_POLICY,
    model_requests: responses.size,
    cold_load_ms: result.loadMs,
    cold_inference_ms: result.cold.elapsedMs,
    warm_inference_ms: result.warm.elapsedMs,
  }));
} finally {
  await browser?.close();
  server?.kill();
  deny.close();
  await rm(probe, { recursive: true, force: true });
}
