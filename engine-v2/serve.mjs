import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { VISION_MODELS, VISION_WASM_FILES } from "../lib/vision-runtime.mjs";
import { parseModel } from "./core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const packageDir = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const handHash = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1";
const mime = { html: "text/html", css: "text/css", mjs: "text/javascript", js: "text/javascript",
  wasm: "application/wasm", json: "application/json", mp4: "video/mp4" };
const bytes = (data, type) => ({ data, type });
const asset = file => ({ file, type: mime[file.split(".").at(-1)] ?? "application/octet-stream" });
const hash = file => createHash("sha256").update(file).digest("hex");

export async function serve({ modelFile, handFile, port = 8765, diagnostics = new Map() }) {
  const files = new Map([
    ["/", asset(join(here, "index.html"))],
    ...["style.css", "core.mjs"].map(name => ["/" + name, asset(join(here, name))]),
  ]);
  const profile = process.env.SIGNRELAY_V2_VISION_PROFILE ?? "cpu";
  if (!["cpu", "cpu-on-demand", "gpu-on-demand", "gpu-framewise"].includes(profile)) throw new Error("Unknown V2 tracker profile");
  files.set("/profile.json", bytes(JSON.stringify({ handDelegate: profile.startsWith("gpu") ? "GPU" : "CPU",
    onDemandPose: profile !== "cpu", framewiseHands: profile === "gpu-framewise" }), "application/json"));
  if (modelFile) {
    const data = await readFile(modelFile);
    parseModel(JSON.parse(data));
    files.set("/model.json", bytes(data, "application/json"));
  }
  const hand = await readFile(handFile);
  if (hash(hand) !== handHash) throw new Error("Hand Landmarker failed integrity verification");
  files.set("/vision/models/hand_landmarker.task", bytes(hand, "application/octet-stream"));
  for (const descriptor of Object.values(VISION_MODELS)) {
    const data = await readFile(join(root, "public/vision/models", descriptor.file));
    if (hash(data) !== descriptor.sha256) throw new Error("Vision asset failed integrity verification");
    files.set("/vision/models/" + descriptor.file, bytes(data, "application/octet-stream"));
  }
  for (const file of VISION_WASM_FILES) files.set("/vision/wasm/" + file, asset(join(packageDir, file)));
  const compile = (file, format) => build({ entryPoints: [join(here, file)],
    bundle: true, format, platform: "browser", write: false });
  const [worker, app] = await Promise.all([compile("worker.mjs", "iife"), compile("app.mjs", "esm")]);
  files.set("/app.mjs", bytes(app.outputFiles[0].contents, "text/javascript"));
  files.set("/tracker.js", bytes(worker.outputFiles[0].contents, "text/javascript"));
  for (const entry of diagnostics) files.set(...entry);
  const server = createServer(async (request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method !== "GET" || !files.has(route)) { response.writeHead(404).end(); return; }
    const entry = files.get(route);
    response.setHeader("Content-Type", entry.type);
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:");
    response.setHeader("Permissions-Policy", "camera=(self), microphone=()");
    response.setHeader("Cache-Control", "no-store");
    if (entry.data) { response.end(entry.data); return; }
    try {
      const { size } = await stat(entry.file);
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (start > end) { response.writeHead(416, { "Content-Range": "bytes */" + size }).end(); return; }
        response.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        createReadStream(entry.file, { start, end }).on("error", () => response.destroy()).pipe(response);
        return;
      }
      response.writeHead(200, { "Content-Length": size, "Accept-Ranges": "bytes" });
      createReadStream(entry.file).on("error", () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  return server;
}

if (process.argv[1] && basename(process.argv[1]) === "serve.mjs") {
  const [handFile, modelFile = join(here, "models/landmark.json"), port = "8765"] = process.argv.slice(2);
  if (!handFile) throw new Error("Supply the pinned Hand Landmarker asset and optional model JSON");
  await serve({ modelFile, handFile, port: Number(port) });
  console.log(`SignRelay Engine V2 Lab · http://127.0.0.1:${port}`);
}
