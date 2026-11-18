// Split the verified development reel into one fake-camera file per trial.
import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";

const [reel, index, directory] = process.argv.slice(2);
assert(directory && relative("evaluation/raw", directory).split(sep)[0] !== ".."
  && resolve(directory).startsWith(resolve("evaluation/raw") + sep), "Use an ignored evaluation/raw subdirectory");
const metadata = JSON.parse(await readFile(index));
const fingerprint = async path => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
assert.equal(await fingerprint(reel), metadata.sha256);
const file = await open(reel);
let header;
try {
  const buffer = Buffer.alloc(160);
  await file.read(buffer);
  header = buffer.subarray(0, buffer.indexOf(10) + 1);
} finally { await file.close(); }
assert.match(header.toString(), /^YUV4MPEG2 W480 H640 F30:1 Ip A1:1 C420\n$/);
await mkdir(directory, { recursive: true });
const bytes = 480 * 640 * 1.5 + 6;
const shards = [];
for (const [i, original] of metadata.trials.entries()) {
  const lead = 45, tail = 36;
  const first = Math.round(original.startMs * 0.03) - lead;
  const count = lead + original.frames + tail;
  assert(first >= 0 && first + count <= metadata.frames);
  const path = resolve(directory, `trial-${i + 1}.y4m`);
  const indexPath = resolve(directory, `trial-${i + 1}.json`);
  await writeFile(path, header);
  const start = header.length + first * bytes;
  await pipeline(createReadStream(reel, { start, end: start + count * bytes - 1 }), createWriteStream(path, { flags: "a" }));
  const trial = { ...original, startMs: lead * 1000 / 30, endMs: (lead + original.frames) * 1000 / 30 };
  await writeFile(indexPath, JSON.stringify({ sha256: await fingerprint(path), durationSeconds: count / 30, trials: [trial] }));
  shards.push({ path, index: indexPath });
}
await writeFile(resolve(directory, "shards.json"), JSON.stringify(shards, null, 2));
console.log(JSON.stringify({ trials: shards.length }));
