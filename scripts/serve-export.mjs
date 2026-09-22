import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { baseHeaders } from "./security-policy.mjs";

const args = process.argv.slice(2);
const port = Number((args.includes("--port") ? args[args.indexOf("--port") + 1] : undefined) || process.env.PORT || 3000);
const root = resolve("out");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm", ".woff2": "font/woff2" };
await stat(resolve(root, "index.html"));
createServer(async (request, response) => {
  for (const { key, value } of baseHeaders) response.setHeader(key, value);
  response.setHeader("Cache-Control", "public,max-age=0,must-revalidate");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path.split("/").some(part => part.startsWith(".")) || /\.(map|pem|key|log|db|sqlite|bak)$/i.test(path)) throw new Error("Private path");
    let file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(root + sep)) throw new Error("Outside export");
    try { if (!(await stat(file)).isFile()) file = (await stat(`${file}.html`).catch(() => null))?.isFile() ? `${file}.html` : resolve(file, "index.html"); }
    catch { if (!extname(file)) file += ".html"; }
    const content = await readFile(file);
    response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    response.writeHead(200); response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : await readFile(resolve(root, "404.html")));
  }
}).listen(port, "0.0.0.0", () => console.log(`Serving static export on port ${port}`));
