// Loopback static server for the built lab, with the same isolation headers as production.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const dir = process.argv[2] ?? new URL("./dist", import.meta.url).pathname;
const port = Number(process.argv[3] ?? 8790);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".task": "application/octet-stream", ".mp4": "video/mp4", ".webm": "video/webm" };
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
  const extra = process.env.EXTRA_DIR && p.startsWith("fixtures/") ? join(process.env.EXTRA_DIR, p.slice(9)) : null;
  try {
    const body = await readFile(extra ?? join(dir, p));
    res.writeHead(200, { "Content-Type": types[extname(p)] ?? "application/octet-stream", "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
