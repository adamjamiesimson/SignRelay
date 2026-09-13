import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const directory = new URL("../public/models/rsl1000-slovo/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
const target = new URL("model.onnx", directory);
async function valid() {
  try {
    if ((await stat(target)).size !== manifest.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest("hex") === manifest.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
if (await valid()) console.log("Slovo pretrained model verified (1,000 sign classes).");
else {
  console.log("Downloading official Slovo pretrained model (141 MB, once per checkout)…");
  await mkdir(directory, { recursive: true });
  const partial = new URL(`model.${process.pid}.partial`, directory);
  try {
    const response = await fetch(manifest.url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
    let bytes = 0;
    const hash = createHash("sha256");
    const check = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > manifest.bytes) return callback(new Error("Model exceeds expected size"));
      hash.update(chunk); callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), check, createWriteStream(partial, { flags: "wx" }));
    if (bytes !== manifest.bytes || hash.digest("hex") !== manifest.sha256) throw new Error("Model integrity check failed; refusing to install");
    await rename(partial, target);
    console.log("Slovo pretrained model installed and verified.");
  } finally {
    await rm(partial, { force: true });
  }
}
