import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function matchesAsset(path, asset) {
  try {
    if ((await stat(path)).size !== asset.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === asset.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Stream to a separate file; only replace the installed asset after verifying
 * both size and digest. Interrupted downloads can never become cached models. */
export async function installVerifiedAsset(target, asset, { attempts = 3, retryMs = 1000 } = {}) {
  if (await matchesAsset(target, asset)) return "cached";
  const path = target instanceof URL ? fileURLToPath(target) : target;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const partial = `${path}.${process.pid}.${attempt}.partial`;
    try {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw new Error(`Asset download failed: HTTP ${response.status}`);
      let bytes = 0;
      const hash = createHash("sha256");
      const check = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > asset.bytes) return callback(new Error("Asset exceeds expected size"));
        hash.update(chunk);
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), check, createWriteStream(partial, { flags: "wx" }));
      if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256) {
        throw new Error("Asset integrity check failed; refusing to install");
      }
      await rename(partial, path);
      return "installed";
    } catch (error) {
      if (attempt === attempts) throw error;
      await delay(retryMs * attempt);
    } finally {
      await rm(partial, { force: true });
    }
  }
}
