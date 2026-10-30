// Condition C driver: replay local clips through the production vision engine
// and recognition worker in headless Chrome. Captures stay in the given local
// output directory (ignored by git); nothing is uploaded or committed.
//
// node scripts/asl2000-eval/browser-run.mjs <chrome> <clips.json> <out-dir> <worker=url>... [--pause=ms]
//   clips.json: [{"id": string, "file": local path}]
//   worker:     name=/workers/<bundle>.js served from public/
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { startChrome } from "../diagnostics/chrome-session.mjs";

const [chrome, clipsPath, outDir, ...rest] = process.argv.slice(2);
const workers = rest.filter(arg => arg.includes("=") && !arg.startsWith("--")).map(arg => arg.split("="));
const pauses = (rest.find(arg => arg.startsWith("--pause="))?.slice(8) ?? "0").split(",").map(Number);
if (!chrome || !clipsPath || !outDir || !workers.length) throw new Error("Usage: browser-run <chrome> <clips.json> <out-dir> name=/workers/x.js... [--pause=0,1000]");
const clips = JSON.parse(await readFile(clipsPath, "utf8"));
await mkdir(outDir, { recursive: true });
const pageDir = path.resolve(outDir, ".page");
await mkdir(pageDir, { recursive: true });
await build({ entryPoints: ["scripts/asl2000-eval/browser-capture.ts"], bundle: true, format: "esm", platform: "browser",
  target: "es2020", outfile: path.join(pageDir, "capture.js"), logLevel: "warning" });
await writeFile(path.join(pageDir, "index.html"), "<!doctype html><meta charset=utf-8><title>capture</title><script type=module src=/capture/capture.js></script>");

const files = new Map(clips.map(clip => [`/clips/${encodeURIComponent(clip.id)}`, path.resolve(clip.file)]));
const roots = [["/capture/", pageDir], ["/workers/", "public/workers"], ["/models/", "public/models"], ["/vision/", "public/vision"], ["/onnx/", "public/onnx"]];
const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };
const server = createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? "/").split("?")[0]);
  let file = files.get(url.startsWith("/clips/") ? `/clips/${encodeURIComponent(url.slice(7))}` : "");
  for (const [prefix, root] of roots) if (!file && url.startsWith(prefix)) {
    const candidate = path.resolve(root, url.slice(prefix.length));
    if (candidate.startsWith(path.resolve(root))) file = candidate;
  }
  if (!file || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  const type = types[path.extname(file)] ?? (url.startsWith("/clips/") ? "video/mp4" : "application/octet-stream");
  const size = statSync(file).size;
  // Media seeking needs byte ranges.
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    response.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
  createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await startChrome(chrome);
  for (const clip of clips) for (const [name, workerUrl] of workers) for (const pause of pauses) {
    await browser.send("Page.navigate", { url: `${origin}/capture/index.html` });
    for (let i = 0; i < 100 && !(await browser.evaluate("!!window.signrelayCapture").catch(() => false)); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    let result;
    try {
      result = await browser.evaluate(`window.signrelayCapture(${JSON.stringify(`/clips/${encodeURIComponent(clip.id)}`)}, ${JSON.stringify(workerUrl)}, ${pause})`);
    } catch (error) {
      result = { error: String(error).slice(0, 500) };
    }
    await writeFile(path.join(outDir, `${clip.id}--${name}--${pause}.json`), JSON.stringify({ id: clip.id, worker: name, pauseMs: pause, ...result }));
    const confirmed = (result.messages ?? []).filter(message => message.type === "confirmed").map(message => `${message.gloss}/${message.source}`);
    console.log(JSON.stringify({ clip: clip.id, worker: name, pause, frames: result.frames?.length ?? 0, confirmed, error: result.error }));
  }
} finally {
  await browser?.close();
  server.close();
}
