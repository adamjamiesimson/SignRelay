import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist-preview/", import.meta.url));
const config = JSON.parse(await readFile(new URL("./vercel.json", import.meta.url)));
const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
const mime = { ".html": "text/html", ".css": "text/css", ".mjs": "text/javascript", ".js": "text/javascript",
  ".json": "application/json", ".wasm": "application/wasm", ".task": "application/octet-stream" };

export async function servePreview() {
  const files = new Map();
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error("Unexpected preview symlink");
    if (!item.isFile()) continue;
    const file = join(item.parentPath, item.name);
    files.set("/" + file.slice(root.length).replaceAll("\\", "/"), file);
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    const file = files.get(route === "/" ? "/index.html" : route);
    if (!file || !["GET", "HEAD"].includes(request.method)) { response.writeHead(404, headers).end(); return; }
    try {
      const content = await readFile(file);
      response.writeHead(200, { ...headers, "Content-Type": mime[extname(file)], "Content-Length": content.length });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch { response.writeHead(500).end(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}
