import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { RESEARCH_EXPORT_MARKER } from "../lib/release-flags.mjs";
import { baseHeaders } from "./security-policy.mjs";
import { PRIVATE_EXPORT_MARKER, PRIVATE_ROUTES, privateRoutePaths } from "./exclude-private-routes.mjs";

const args = process.argv.slice(2);
function option(flag) {
  if (!args.includes(flag)) return undefined;
  const value = args[args.indexOf(flag) + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}
const port = Number(option("--port") ?? process.env.PORT ?? 3000);
const root = resolve("out");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2" };
await stat(resolve(root, "index.html"));
const privateExport = existsSync(resolve(root, PRIVATE_EXPORT_MARKER))
  || existsSync(resolve(root, RESEARCH_EXPORT_MARKER))
  || PRIVATE_ROUTES.some(route => privateRoutePaths(route).some(path => existsSync(resolve(root, path))));
const host = option("--host") ?? (privateExport ? "127.0.0.1" : "0.0.0.0");
const cert = option("--tls-cert"), key = option("--tls-key");
if (Boolean(cert) !== Boolean(key)) throw new Error("Specify both --tls-cert and --tls-key to serve over HTTPS.");
if (privateExport && !cert && !["127.0.0.1", "::1"].includes(host))
  throw new Error("Private exports require loopback HTTP or trusted HTTPS for a LAN address.");
const server = cert ? createSecureServer({ cert: await readFile(cert), key: await readFile(key) }) : createServer();
server.on("request", async (request, response) => {
  for (const { key, value } of baseHeaders) response.setHeader(key, value);
  response.setHeader("Cache-Control", privateExport ? "no-store" : "public,max-age=0,must-revalidate");
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path.includes("\\") || path.split("/").some(part => part.startsWith("."))
      || /\.(map|pem|key|log|db|sqlite|bak)$/i.test(path)) throw new Error("Private path");
    let file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(root + sep)) throw new Error("Outside export");
    try { if (!(await stat(file)).isFile()) file = (await stat(`${file}.html`).catch(() => null))?.isFile() ? `${file}.html` : resolve(file, "index.html"); }
    catch { if (!extname(file)) file += ".html"; }
    const handle = await open(file, "r");
    try {
      const fileInfo = await handle.stat();
      if (!fileInfo.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Content-Length": fileInfo.size,
      });
      if (request.method === "HEAD") response.end();
      else await pipeline(handle.createReadStream({ autoClose: false }), response);
    } finally {
      await handle.close();
    }
  } catch {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : await readFile(resolve(root, "404.html")).catch(() => "Not found"));
  }
}).on("error", error => {
  // A raw stack trace here reads like a crash of this build, while another
  // server keeps answering at the same address.
  console.error(error.code === "EADDRINUSE"
    ? `Port ${port} on ${host} is already in use by another program. Nothing was served; stop that program or pass --port.`
    : `Cannot serve on ${host}:${port}: ${error.message}`);
  process.exit(1);
}).listen(port, host, () => console.log(`Serving static export over ${cert ? "HTTPS" : "HTTP"} on ${host}:${server.address().port}`));
