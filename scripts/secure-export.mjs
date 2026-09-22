import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { documentPolicy } from "./security-policy.mjs";

let pages = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await visit(path); continue; }
    if (!path.endsWith(".html")) continue;
    let html = await readFile(path, "utf8");
    html = html.replace(/<meta name="signrelay-csp"[^>]*>/g, "");
    const hashes = new Set();
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (!/\bsrc\s*=/i.test(match[1]) && match[2]) {
        hashes.add(`'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
      }
    }
    const policy = documentPolicy([...hashes]).replaceAll('"', "&quot;");
    if (!html.includes("<head>")) throw new Error(`Missing head: ${path}`);
    html = html.replace("<head>", `<head><meta name="signrelay-csp" http-equiv="Content-Security-Policy" content="${policy}">`);
    await writeFile(path, html);
    pages++;
  }
}
await visit("out");
if (!pages) throw new Error("No exported pages to protect");
console.log(`Added hash-based script policies to ${pages} exported pages.`);
