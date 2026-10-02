#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const sourcePath = resolve(process.argv[2] ?? "evaluation/asllvd-v1.sources.jsonl");
const outputManifest = resolve(process.argv[3] ?? "evaluation/asllvd-v1.local.jsonl");
const videoDir = resolve("evaluation/videos/asllvd-v1");

function sha256File(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    import("node:fs").then(({ createReadStream }) => {
      const stream = createReadStream(path);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolvePromise(hash.digest("hex")));
      stream.on("error", rejectPromise);
    }).catch(rejectPromise);
  });
}

function readJsonl(text) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    try {
      return [{ index: index + 1, value: JSON.parse(trimmed) }];
    } catch (error) {
      throw new Error(`Invalid JSON at ${sourcePath}:${index + 1}: ${error instanceof Error ? error.message : error}`);
    }
  });
}

async function verify(path, source) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;
  if (source.bytes != null && info.size !== source.bytes) return false;
  return await sha256File(path) === source.sha256;
}

async function download(source, path) {
  const temp = path + ".part";
  await rm(temp, { force: true });
  const response = await fetch(source.source_url, {
    redirect: "follow",
    headers: { "user-agent": "SignRelay-research-evaluation/1.0" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`${source.id}: HTTP ${response.status} from ${source.source_url}`);
  }
  await pipeline(response.body, createWriteStream(temp));
  if (!await verify(temp, source)) {
    const actual = await sha256File(temp).catch(() => "unreadable");
    const info = await stat(temp).catch(() => null);
    throw new Error(`${source.id}: integrity mismatch (bytes ${info?.size ?? "?"}, sha256 ${actual})`);
  }
  await rename(temp, path);
}

async function main() {
  const rows = readJsonl(await readFile(sourcePath, "utf8"));
  if (!rows.length) throw new Error("Source manifest is empty");
  await mkdir(videoDir, { recursive: true });
  await mkdir(dirname(outputManifest), { recursive: true });

  const ids = new Set();
  const hashes = new Set();
  const manifest = [];
  for (const { index, value: source } of rows) {
    for (const field of ["id", "language", "trial_type", "source_url", "sha256", "source"]) {
      if (!String(source[field] ?? "").trim()) throw new Error(`Source line ${index}: missing ${field}`);
    }
    if (source.trial_type === "sign" && !String(source.expected_gloss ?? "").trim()) {
      throw new Error(`Source line ${index}: sign fixture requires expected_gloss`);
    }
    if (ids.has(source.id)) throw new Error(`Duplicate fixture id: ${source.id}`);
    if (hashes.has(source.sha256)) throw new Error(`Duplicate source video hash: ${source.sha256}`);
    ids.add(source.id); hashes.add(source.sha256);

    const target = resolve(videoDir, `${source.id}.mp4`);
    if (!await verify(target, source)) {
      if (existsSync(target)) await rm(target, { force: true });
      process.stdout.write(`fetch ${source.id} (${source.expected_gloss ?? "NO_SIGN"}) ... `);
      await download(source, target);
      console.log("ok");
    } else {
      console.log(`reuse ${source.id} (verified)`);
    }

    manifest.push({
      id: source.id,
      language: source.language,
      trial_type: source.trial_type,
      expected_gloss: source.expected_gloss ?? null,
      video: relative(dirname(outputManifest), target).replaceAll("\\", "/"),
      condition: source.condition ?? "external-fixture",
      split: source.source_split ?? "external-test",
      source: source.source,
      notes: [
        source.group ? `group=${source.group}` : null,
        source.video_id ? `source_video_id=${source.video_id}` : null,
        source.source_session ? `source_session=${source.source_session}` : null,
        `source_sha256=${source.sha256}`,
      ].filter(Boolean).join("; "),
    });
  }

  await writeFile(outputManifest, manifest.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  console.log(`\nPrepared ${manifest.length} verified fixtures`);
  console.log(`Local manifest: ${outputManifest}`);
  console.log(`Raw clips stay under ignored directory: ${videoDir}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
