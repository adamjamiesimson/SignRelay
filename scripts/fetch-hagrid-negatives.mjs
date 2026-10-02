#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const sourcePath = resolve(process.argv[2] ?? "evaluation/hagrid-no-gesture-v1.sources.jsonl");
const outputManifest = resolve(process.argv[3] ?? "evaluation/hagrid-no-gesture-v1.local.jsonl");
const workDir = resolve("evaluation/videos/hagrid-no-gesture-v1");

function readJsonl(text) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    try { return [{ line: index + 1, row: JSON.parse(trimmed) }]; }
    catch (error) { throw new Error(`Invalid JSON on source line ${index + 1}: ${error}`); }
  });
}

function sha256(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolvePromise(hash.digest("hex")));
    stream.on("error", rejectPromise);
  });
}

async function download(url, target) {
  const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "SignRelay-research-evaluation/1.0" } });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${url}`);
  await pipeline(response.body, createWriteStream(target));
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`);
}

async function main() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error("ffmpeg is required to create the local no-gesture video fixtures");

  const sources = readJsonl(await readFile(sourcePath, "utf8"));
  await mkdir(workDir, { recursive: true });
  await mkdir(dirname(outputManifest), { recursive: true });
  const manifest = [];

  for (const { line, row } of sources) {
    for (const field of ["id", "dataset", "config", "split", "row_offset", "source_image_sha256", "source_image_bytes"]) {
      if (row[field] === undefined || row[field] === null || row[field] === "") throw new Error(`Source line ${line}: missing ${field}`);
    }
    const query = new URL("https://datasets-server.huggingface.co/rows");
    query.searchParams.set("dataset", row.dataset);
    query.searchParams.set("config", row.config);
    query.searchParams.set("split", row.split);
    query.searchParams.set("offset", String(row.row_offset));
    query.searchParams.set("length", "1");
    const metadataResponse = await fetch(query, { headers: { "user-agent": "SignRelay-research-evaluation/1.0" } });
    if (!metadataResponse.ok) throw new Error(`${row.id}: dataset metadata HTTP ${metadataResponse.status}`);
    const metadata = await metadataResponse.json();
    const datasetRow = metadata.rows?.[0]?.row;
    if (!datasetRow || datasetRow.label !== row.expected_label_index) {
      throw new Error(`${row.id}: expected label index ${row.expected_label_index}, got ${datasetRow?.label}`);
    }
    const sourceUrl = datasetRow.image?.src;
    if (!sourceUrl) throw new Error(`${row.id}: image URL missing from dataset row`);

    const imagePath = resolve(workDir, `${row.id}.jpg`);
    await rm(imagePath, { force: true });
    await download(sourceUrl, imagePath);
    const info = await stat(imagePath);
    const digest = await sha256(imagePath);
    if (info.size !== row.source_image_bytes || digest !== row.source_image_sha256) {
      throw new Error(`${row.id}: source integrity mismatch (bytes=${info.size}, sha256=${digest})`);
    }

    const variants = [
      {
        suffix: "static",
        condition: "HaGRID no_gesture natural hand posture · static framing",
        filter: "scale=640:640,crop=640:480:0:80,format=yuv420p",
      },
      {
        suffix: "camera-pan",
        condition: "HaGRID no_gesture natural hand posture · synthetic camera pan",
        filter: "scale=800:800,crop=640:480:x='80+60*sin(n/10)':y=160,format=yuv420p",
      },
    ];
    for (const variant of variants) {
      const videoPath = resolve(workDir, `${row.id}-${variant.suffix}.mp4`);
      runFfmpeg([
        "-loop", "1", "-framerate", "20", "-i", imagePath,
        "-t", "3", "-vf", variant.filter,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", videoPath,
      ]);
      manifest.push({
        id: `${row.id}-${variant.suffix}`,
        language: "asl",
        trial_type: "no_sign",
        expected_gloss: null,
        video: relative(dirname(outputManifest), videoPath).replaceAll("\\", "/"),
        condition: variant.condition,
        device: "derived-still-video",
        split: "external-negative",
        source: `${row.source} (${row.license})`,
        notes: `dataset_row=${row.row_offset}; source_image_sha256=${row.source_image_sha256}; transformation=${variant.suffix}`,
      });
    }
  }

  await writeFile(outputManifest, manifest.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  console.log(`Prepared ${manifest.length} no-sign rejection fixtures at ${outputManifest}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
